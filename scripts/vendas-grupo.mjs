/* Faturamento mensal das outras empresas do grupo para o painel Vendas
   (botão "Postos / Grupo": linha "Outras empresas do grupo" e seção Ano a ano).

   Fontes (relatórios do Argo linha a linha):
     - ST · Sapatão Transportes (unidade 99): "Relatório de Documentos Fiscais Emitidos",
       tipo CT-e, situação Autorizada — uma linha por CT-e, agrupadas por "Data de Emissão",
       com "Total:" por dia e "Total Unidade de Negócio" no fim (as duas somas são conferidas).
     - SE · Siss Empreendimentos (unidade 1, holding): "Relatório de Vendas - Nota Avulsa",
       tipo Completo — uma linha por nota; confere o "Total Geral" do rodapé.
   (O relatório de MDF-es usado na primeira carga foi trocado pelo de CT-e em 04/11/2026:
   MDF-e é o manifesto da carga, o faturamento do frete é o CT-e.)

   Entrada: o PDF (--pdf, lido com pdftotext) ou o TEXTO que o conector Microsoft 365
   devolve ao ler o PDF no OneDrive (--txt, uma página por linha). Os dois viram o mesmo
   texto achatado e passam pelo mesmo leitor.

   Gravação: operacional-historico.json (cifrado), bloco `empresas`:
     empresas: { transportadora|holding: { nome, fonte, periodo:{de,ate}, gerado, atualizadoEm,
                 meses: { "2026-10": { fat, intra, docs [, parcial:true, dia:N] } } } }
   fat = soma do mês; intra = parte faturada a empresas do próprio grupo; docs = quantidade.
   Os meses cobertos pelo período do relatório são substituídos (mês sem documento = 0);
   o 1º mês só entra se o período começa no dia 1º; o último fica `parcial` com o dia de
   corte se o período termina antes do fim do mês. Troca de fonte (ex.: MDF-e → CT-e)
   descarta os meses antigos daquela empresa. Relatório com o mesmo "GERADO EM" do que
   já foi importado é ignorado (a rotina diária pode rodar de novo sem efeito).

   Uso:
     node scripts/vendas-grupo.mjs importa (--pdf <arquivo.pdf> | --txt <texto.txt>) [--forca]
                                   [--entrada operacional-historico.json] [--saida …]
     node scripts/vendas-grupo.mjs confere (--pdf … | --txt …)      (só lê e confere; não grava)

   Logs só com meses, contagens e "ok": nenhum valor. */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { chave, cifra, decifra, falha } from './vendas-lib.mjs';

const args = process.argv.slice(2);
const modo = args[0];
function opt(nome, padrao) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; }
const tem = nome => args.includes('--' + nome);
const num = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
const r2 = v => Math.round(v * 100) / 100;
const VAL = '-?\\d{1,3}(?:\\.\\d{3})*,\\d{2}';
const iso = d => { const [dd, mm, aa] = d.split('/'); return `${aa}-${mm}-${dd}`; };
const diasNoMes = (a, m) => new Date(a, m, 0).getDate();

/* clientes que são empresas do próprio grupo (postos, transportadora, holding) */
const GRUPO = /POSTO SAPAT|SF COM(ERCIO)? DE COMB|SAFYR|SAPATAO TRANSPORTES|SAPATÃO TRANSPORTES|SISS EMPREEND/i;

function textoAchatado() {
  const pdf = opt('pdf'), txt = opt('txt');
  if (!pdf && !txt) falha('informe --pdf <arquivo.pdf> ou --txt <texto do conector>.');
  let bruto;
  if (pdf) {
    try { bruto = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
    catch (e) { falha('pdftotext falhou (poppler instalado?): ' + (e.message || e)); }
  } else bruto = readFileSync(txt, 'utf8');
  return bruto.replace(/\s+/g, ' ');
}

/* ---------- leitores ---------- */
function leCTe(t) {
  const re = new RegExp(`Data de Emissão (\\d{2}/\\d{2}/\\d{4})|(\\d+) (\\d+) CT-e (\\S+) (.+?) (\\d{2}\\.\\d{3}\\.\\d{3}/\\d{4}-\\d{2}|\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}) (\\d{2}:\\d{2}) (\\S+) (Autorizada|Cancelada|Denegada|Inutilizada) (${VAL})|Total Unidade de Negócio: (${VAL})|Total: (${VAL})`, 'g');
  const docs = [], erros = [], ops = {};
  let data = null, somaDia = 0, totUnidade = null, dias = 0, vistos = new Set();
  for (const m of t.matchAll(re)) {
    if (m[1]) { data = m[1]; continue; }
    if (m[2]) {
      if (!data) { erros.push('CT-e antes de qualquer "Data de Emissão"'); continue; }
      const chaveDoc = m[2] + '/' + m[3];
      if (vistos.has(chaveDoc)) { erros.push(`CT-e ${chaveDoc} repetido no texto`); continue; }
      vistos.add(chaveDoc);
      if (m[9] !== 'Autorizada') continue;
      const v = num(m[10]); somaDia += v; ops[m[4]] = (ops[m[4]] || 0) + 1;
      const cliente = m[5].replace(/^\d+ (Sim|Não|Nao) /, '');
      docs.push({ data, cliente, valor: v });
      continue;
    }
    if (m[11]) { totUnidade = num(m[11]); continue; }
    if (m[12]) { if (Math.abs(num(m[12]) - somaDia) > 0.011) erros.push(`total do dia ${data} não bate com a soma das linhas`); somaDia = 0; dias++; }
  }
  const soma = r2(docs.reduce((s, d) => s + d.valor, 0));
  if (totUnidade === null) erros.push('faltou o "Total Unidade de Negócio" (texto incompleto?)');
  else if (Math.abs(totUnidade - soma) > 0.011) erros.push('a soma dos CT-e não bate com o "Total Unidade de Negócio"');
  return { docs, erros, extra: `${dias} dias com total conferido · operações: ${Object.entries(ops).map(([k, v]) => k + ' ' + v).join(', ') || '—'}` };
}

function leNotaAvulsa(t) {
  const re = new RegExp(`(\\d{2}/\\d{2}/\\d{4}) (\\d{2}:\\d{2}) (\\d+) (\\S+) (.+?) (${VAL})(?= |$)|Total Geral: (${VAL})`, 'g');
  const docs = [], erros = [];
  let tg = null;
  for (const m of t.matchAll(re)) {
    if (m[7]) { tg = num(m[7]); continue; }
    if (!/^[A-Z]{1,3}$/.test(m[4])) continue; /* série da nota (NA): descarta casamentos fora da tabela */
    const cliente = m[5].split(/ \d+ - DRE /)[0];
    docs.push({ data: m[1], cliente, valor: num(m[6]) });
  }
  const soma = r2(docs.reduce((s, d) => s + d.valor, 0));
  if (tg === null) erros.push('faltou o "Total Geral" (texto incompleto?)');
  else if (Math.abs(tg - soma) > 0.011) erros.push('a soma das notas não bate com o "Total Geral"');
  return { docs, erros, extra: 'Total Geral conferido' };
}

const TIPOS = [
  { empresa: 'transportadora', nome: 'Sapatão Transportes', fonte: 'CT-e (Documentos Fiscais Emitidos)', titulo: /Relatório de Documentos Fiscais Emitidos/, exige: [/Conhecimento de Transporte Eletrônico \(CT-e\)/, /SAPATAO TRANSPORTES/], le: leCTe },
  { empresa: 'holding', nome: 'Siss Empreendimentos', fonte: 'Nota Avulsa (Relatório de Vendas)', titulo: /Relatório de Vendas - Nota Avulsa/, exige: [/SISS EMPREENDIMENTOS/], le: leNotaAvulsa },
];

function leRelatorio() {
  const t = textoAchatado();
  if (/Relatório de MDF-es Emitidos/.test(t)) falha('relatório de MDF-es: a Transportadora agora vem do "Relatório de Documentos Fiscais Emitidos" (CT-e, situação Autorizada).');
  const T = TIPOS.find(x => x.titulo.test(t));
  if (!T) falha('não reconheci o relatório (esperado: Documentos Fiscais Emitidos de CT-e da unidade 99, ou Vendas - Nota Avulsa da unidade 1).');
  for (const r of T.exige) if (!r.test(t)) falha(`o relatório não é o esperado para ${T.nome} (falta ${r.source}).`);
  if (T.empresa === 'transportadora' && !/Situação Documento: Autorizada/.test(t)) falha('gere o relatório de CT-e com "Situação Documento: Autorizada".');
  const per = t.match(/Emissão: (\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})/);
  if (!per) falha('não achei o período de emissão no cabeçalho.');
  const ger = t.match(/GERADO EM: (\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2})/);
  const de = iso(per[1]), ate = iso(per[2]);
  const L = T.le(t);
  if (!L.docs.length && !L.erros.length) L.erros.push('nenhuma linha de documento reconhecida');
  const fora = L.docs.filter(d => iso(d.data) < de || iso(d.data) > ate);
  if (fora.length) L.erros.push(`${fora.length} documento(s) fora do período do cabeçalho`);
  if (L.erros.length) falha('relatório reprovado: ' + [...new Set(L.erros)].slice(0, 6).join('; ') + '. Nada gravado.');

  /* meses cobertos pelo período */
  const meses = {}, pulados = [];
  let [a, m] = de.slice(0, 7).split('-').map(Number);
  const fim = ate.slice(0, 7);
  for (;;) {
    const ref = `${a}-${String(m).padStart(2, '0')}`;
    if (ref === de.slice(0, 7) && de.slice(8) !== '01') pulados.push(ref);
    else {
      meses[ref] = { fat: 0, intra: 0, docs: 0 };
      if (ref === fim && +ate.slice(8) < diasNoMes(a, m)) { meses[ref].parcial = true; meses[ref].dia = +ate.slice(8); }
    }
    if (ref === fim) break;
    if (++m > 12) { m = 1; a++; }
  }
  for (const d of L.docs) {
    const x = meses[iso(d.data).slice(0, 7)]; if (!x) continue;
    x.fat = r2(x.fat + d.valor); x.docs++; if (GRUPO.test(d.cliente)) x.intra = r2(x.intra + d.valor);
  }
  return { ...T, de, ate, gerado: ger ? `${ger[1]} ${ger[2]}` : null, docs: L.docs.length, meses, pulados, extra: L.extra };
}

const R = leRelatorio();
const ks = Object.keys(R.meses), comDocs = ks.filter(k => R.meses[k].docs), parc = ks.filter(k => R.meses[k].parcial);
const resumo = `${R.nome} · ${R.fonte} · ${R.de} → ${R.ate} · ${R.docs} documentos · ${R.extra} · ${comDocs.length} meses com movimento (${comDocs[0] || '—'} → ${comDocs[comDocs.length - 1] || '—'})` +
  (parc.length ? ` · ${parc[0]} parcial até o dia ${R.meses[parc[0]].dia}` : '') + (R.pulados.length ? ` · ${R.pulados.join(', ')} fora (o período não começa no dia 1º)` : '');

if (modo === 'confere') {
  console.log('ok: ' + resumo);
} else if (modo === 'importa') {
  const entrada = resolve(opt('entrada', 'operacional-historico.json')), saida = resolve(opt('saida', entrada));
  const K = chave();
  let h = { v: 1, meses: {} };
  if (existsSync(entrada)) { h = decifra(JSON.parse(readFileSync(entrada, 'utf8')), K); if (!h || h.v !== 1) falha('o histórico publicado não tem o formato esperado.'); }
  h.empresas = h.empresas || {};
  const atual = h.empresas[R.empresa];
  if (atual && atual.fonte === R.fonte && atual.gerado && atual.gerado === R.gerado && !tem('forca')) {
    console.log(`já importado: ${R.nome} · relatório gerado em ${R.gerado} · nada mudou`);
    process.exit(0);
  }
  let base = (atual && atual.meses) || {};
  let aviso = '';
  if (atual && atual.fonte !== R.fonte) { base = {}; aviso = ` · fonte trocada (${atual.fonte} → ${R.fonte}): meses antigos descartados`; }
  const meses = Object.assign({}, base, R.meses);
  h.empresas[R.empresa] = { nome: R.nome, fonte: R.fonte, periodo: { de: R.de, ate: R.ate }, gerado: R.gerado, atualizadoEm: new Date().toISOString().slice(0, 16),
    meses: Object.fromEntries(Object.keys(meses).sort().map(k => [k, meses[k]])) };
  h.atualizadoEm = new Date().toISOString().slice(0, 16);
  const doc = cifra(h, K);
  if (JSON.stringify(decifra(doc, K)) !== JSON.stringify(h)) falha('a conferência de ida e volta falhou — nada gravado.');
  writeFileSync(saida, JSON.stringify(doc));
  const todos = Object.keys(h.empresas[R.empresa].meses).filter(k => h.empresas[R.empresa].meses[k].docs);
  console.log(`ok: ${saida} · ${resumo}${aviso} · no histórico: ${todos.length} meses com movimento (${todos[0] || '—'} → ${todos[todos.length - 1] || '—'})`);
} else {
  falha('modo desconhecido — use "importa" ou "confere".');
}
