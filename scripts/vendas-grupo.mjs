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

   Entrada: o PDF (--pdf, lido com pdftotext), o TEXTO que o conector Microsoft 365
   devolve ao ler o PDF no OneDrive (--txt, uma página por linha) ou o CSV que o Argo
   exporta todo dia na pasta Operações/Vendas/Claude/Painel de Vendas (--txt também;
   hoje só o de CT-e: DD-MM-AAAA_RelatorioDeDocumentosFiscaisEmitidos.csv). O CSV não traz
   o período nem totais: o período vem do nome do arquivo (--data DD-MM-AAAA) e da janela
   da exportação (--janela, padrão 30 dias: de data−30 a data−1) — ou de --de/--ate.

   Gravação: operacional-historico.json (cifrado), bloco `empresas`:
     empresas: { transportadora|holding: { nome, fonte, cobertura:[[de,ate],…], importados:[…],
                 dias: { "2026-10-05": { fat, intra, docs } },
                 meses: { "2026-10": { fat, intra, docs [, parcial:true, dia:N | incompleto:true, diasDe, diasAte, diasCobertos] } } } }
   O faturamento fica POR DIA: cada relatório substitui os dias do seu período (dia sem
   documento = 0) e os períodos vão se encaixando — a janela móvel de 30 dias da rotina
   diária completa os meses aos poucos. `meses` é derivado dos dias: mês inteiro coberto =
   fechado; coberto do dia 1º até o último dia carregado = `parcial` com `dia` (em andamento,
   o painel projeta); faltando dias = `incompleto` com `diasDe`/`diasAte`/`diasCobertos`
   (entra no painel com o que está lançado, sem projeção, marcado como parcial).
   Troca de fonte (ex.: MDF-e → CT-e) descarta os dias antigos daquela empresa. Arquivo
   já importado (mesmo GERADO EM, ou mesmo conteúdo no CSV) é ignorado.

   Uso:
     node scripts/vendas-grupo.mjs importa (--pdf <arquivo.pdf> | --txt <texto ou CSV>) [--data DD-MM-AAAA] [--janela 30]
                                   [--de DD/MM/AAAA --ate DD/MM/AAAA] [--forca] [--entrada …] [--saida …]
     node scripts/vendas-grupo.mjs confere (mesmas opções)      (só lê e confere; não grava)

   Logs só com meses, contagens e "ok": nenhum valor. */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
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
  return bruto;
}
const achata = t => t.replace(/\s+/g, ' ');

/* CSV do Argo (Documentos Fiscais Emitidos): 14 colunas separadas por ";"; o conector
   pode repetir o cabeçalho a cada página e acrescentar linhas "[page …]" */
function ehCSV(t) { return /Total Nota\s*$/m.test(t) && /;CT-e;/.test(t); }
function leCTeCSV(t) {
  const docs = [], erros = [], vistos = new Set(), ops = {};
  let unidadeOk = true;
  for (const linha of t.split(/\r?\n/)) {
    const l = linha.trim();
    if (!l || l.startsWith('[') || /Total Nota$/.test(l)) continue;
    const c = l.split(';');
    if (c.length !== 14) { erros.push(`linha com ${c.length} colunas (esperava 14)`); continue; }
    if (!/SAPATAO TRANSPORTES/.test(c[0])) unidadeOk = false;
    if (c[5] !== 'CT-e') continue;
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(c[1]) || !new RegExp('^' + VAL + '$').test(c[13])) { erros.push('linha com data ou valor fora do formato'); continue; }
    const chaveDoc = c[3] + '/' + c[4];
    if (vistos.has(chaveDoc)) { erros.push(`CT-e ${chaveDoc} repetido`); continue; }
    vistos.add(chaveDoc);
    if (!/^Autorizad/.test(c[10])) continue;
    ops[c[6]] = (ops[c[6]] || 0) + 1;
    docs.push({ data: c[1], cliente: c[7], valor: num(c[13]) });
  }
  if (!unidadeOk) erros.push('há linha de outra unidade de negócio (esperava só a 99 - SAPATAO TRANSPORTES)');
  return { docs, erros, extra: `CSV · ${vistos.size} CT-e lidos · operações: ${Object.entries(ops).map(([k, v]) => k + ' ' + v).join(', ') || '—'} · sem totais no arquivo (conferência = colunas, datas e números de documento)` };
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

const brData = d => { const m = String(d || '').match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const somaDias = (isoD, n) => { const d = new Date(isoD + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function leRelatorio() {
  const bruto = textoAchatado();
  /* CSV de CT-e da exportação diária */
  if (ehCSV(bruto)) {
    let de = brData(opt('de')), ate = brData(opt('ate'));
    if (!de || !ate) {
      const d = brData(opt('data')); if (!d) falha('CSV sem período: informe --data DD-MM-AAAA (a data do nome do arquivo) ou --de/--ate.');
      const j = +opt('janela', '30'); de = somaDias(d, -j); ate = somaDias(d, -1);
    }
    const L = leCTeCSV(bruto);
    return fecha({ empresa: 'transportadora', nome: 'Sapatão Transportes', fonte: 'CT-e (Documentos Fiscais Emitidos)' }, de, ate,
      'CSV ' + createHash('sha256').update(bruto).digest('hex').slice(0, 16), L);
  }
  const t = achata(bruto);
  if (/Relatório de MDF-es Emitidos/.test(t) || /;MDF-?e;/i.test(bruto) || /RelatorioDeMdf/i.test(opt('txt', '') + opt('pdf', ''))) falha('relatório de MDF-es: a Transportadora vem do "Relatório de Documentos Fiscais Emitidos" (CT-e, situação Autorizada).');
  if (/Nota Avulsa/.test(t) && /\d,\d{3}\.\d{2}/.test(t) && !new RegExp(VAL).test(t.replace(/\d{1,3}(,\d{3})*\.\d{2}/g, ''))) falha('a nota avulsa veio em XLS (números no formato americano e linhas embaralhadas na leitura pelo conector): exporte o "Relatório de Vendas - Nota Avulsa" em CSV ou PDF.');
  const T = TIPOS.find(x => x.titulo.test(t));
  if (!T) falha('não reconheci o relatório (esperado: Documentos Fiscais Emitidos de CT-e da unidade 99, em PDF ou CSV, ou Vendas - Nota Avulsa da unidade 1).');
  for (const r of T.exige) if (!r.test(t)) falha(`o relatório não é o esperado para ${T.nome} (falta ${r.source}).`);
  if (T.empresa === 'transportadora' && !/Situação Documento: Autorizada/.test(t)) falha('gere o relatório de CT-e com "Situação Documento: Autorizada".');
  const per = t.match(/Emissão: (\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})/);
  if (!per) falha('não achei o período de emissão no cabeçalho.');
  const ger = t.match(/GERADO EM: (\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2})/);
  return fecha(T, iso(per[1]), iso(per[2]), ger ? `${ger[1]} ${ger[2]}` : null, T.le(t));
}

/* documentos → dias do período (dia sem documento = 0) */
function fecha(T, de, ate, assinatura, L) {
  if (de > ate) falha('período invertido.');
  if (!L.docs.length && !L.erros.length) L.erros.push('nenhuma linha de documento reconhecida');
  const fora = L.docs.filter(d => iso(d.data) < de || iso(d.data) > ate);
  if (fora.length) L.erros.push(`${fora.length} documento(s) fora do período ${de} → ${ate}`);
  if (L.erros.length) falha('relatório reprovado: ' + [...new Set(L.erros)].slice(0, 6).join('; ') + '. Nada gravado.');
  const dias = {};
  for (let d = de; d <= ate; d = somaDias(d, 1)) dias[d] = { fat: 0, intra: 0, docs: 0 };
  for (const x of L.docs) { const y = dias[iso(x.data)]; y.fat = r2(y.fat + x.valor); y.docs++; if (GRUPO.test(x.cliente)) y.intra = r2(y.intra + x.valor); }
  return { empresa: T.empresa, nome: T.nome, fonte: T.fonte, de, ate, assinatura, docs: L.docs.length, dias, extra: L.extra };
}

/* períodos carregados → intervalos fundidos; dias → meses (fechado / parcial / lacuna) */
function fundeCobertura(lista) {
  const v = lista.slice().sort((a, b) => a[0] < b[0] ? -1 : 1), out = [];
  for (const [a, b] of v) { const u = out[out.length - 1]; if (u && somaDias(u[1], 1) >= a) { if (b > u[1]) u[1] = b; } else out.push([a, b]); }
  return out;
}
function derivaMeses(dias, cobertura) {
  const coberto = d => cobertura.some(([a, b]) => d >= a && d <= b);
  const fimGeral = cobertura.length ? cobertura[cobertura.length - 1][1] : '';
  const refs = [...new Set(Object.keys(dias).map(d => d.slice(0, 7)))].sort(), meses = {};
  for (const ref of refs) {
    const [a, m] = ref.split('-').map(Number), n = diasNoMes(a, m);
    const x = { fat: 0, intra: 0, docs: 0 }, cob = [];
    for (let i = 1; i <= n; i++) {
      const d = `${ref}-${String(i).padStart(2, '0')}`;
      if (!coberto(d)) continue;
      cob.push(i); const y = dias[d]; if (y) { x.fat = r2(x.fat + y.fat); x.intra = r2(x.intra + y.intra); x.docs += y.docs; }
    }
    const ini = cob[0], fim = cob[cob.length - 1], continuo = cob.length === fim - ini + 1;
    if (cob.length === n) { /* fechado */ }
    else if (ini === 1 && continuo && `${ref}-${String(fim).padStart(2, '0')}` === fimGeral) { x.parcial = true; x.dia = fim; } /* mês em andamento: o painel projeta pelo ritmo */
    else { x.incompleto = true; x.diasDe = ini; x.diasAte = fim; x.diasCobertos = cob.length; } /* faltam dias: entra com o que está lançado, sem projeção, marcado no painel */
    meses[ref] = x;
  }
  return meses;
}

const R = leRelatorio();
const ksR = Object.keys(R.dias), comDocs = [...new Set(ksR.filter(k => R.dias[k].docs).map(k => k.slice(0, 7)))];
const resumo = `${R.nome} · ${R.fonte} · ${R.de} → ${R.ate} · ${R.docs} documentos · ${R.extra} · ${comDocs.length} meses com movimento (${comDocs[0] || '—'} → ${comDocs[comDocs.length - 1] || '—'})`;

if (modo === 'confere') {
  console.log('ok: ' + resumo);
} else if (modo === 'importa') {
  const entrada = resolve(opt('entrada', 'operacional-historico.json')), saida = resolve(opt('saida', entrada));
  const K = chave();
  let h = { v: 1, meses: {} };
  if (existsSync(entrada)) { h = decifra(JSON.parse(readFileSync(entrada, 'utf8')), K); if (!h || h.v !== 1) falha('o histórico publicado não tem o formato esperado.'); }
  h.empresas = h.empresas || {};
  const atual = h.empresas[R.empresa];
  if (atual && atual.fonte === R.fonte && Array.isArray(atual.importados) && atual.importados.includes(R.assinatura) && !tem('forca')) {
    console.log(`já importado: ${R.nome} · ${R.assinatura.startsWith('CSV') ? 'mesmo conteúdo' : 'relatório gerado em ' + R.assinatura} · nada mudou`);
    process.exit(0);
  }
  let dias = {}, cobertura = [], importados = [], aviso = '';
  if (atual && atual.fonte === R.fonte && atual.dias) { dias = atual.dias; cobertura = atual.cobertura || []; importados = atual.importados || []; }
  else if (atual) aviso = atual.fonte !== R.fonte ? ` · fonte trocada (${atual.fonte} → ${R.fonte}): dias antigos descartados` : ' · carga mensal antiga convertida para carga por dia';
  for (const d of Object.keys(dias)) if (d >= R.de && d <= R.ate) delete dias[d];
  Object.assign(dias, R.dias);
  cobertura = fundeCobertura(cobertura.concat([[R.de, R.ate]]));
  importados = importados.filter(x => x !== R.assinatura).concat([R.assinatura]).slice(-60);
  const diasOrd = Object.fromEntries(Object.keys(dias).sort().map(k => [k, dias[k]]));
  const meses = derivaMeses(diasOrd, cobertura);
  h.empresas[R.empresa] = { nome: R.nome, fonte: R.fonte, periodo: { de: cobertura[0][0], ate: cobertura[cobertura.length - 1][1] }, cobertura, importados,
    atualizadoEm: new Date().toISOString().slice(0, 16), dias: diasOrd, meses };
  h.atualizadoEm = new Date().toISOString().slice(0, 16);
  const doc = cifra(h, K);
  if (JSON.stringify(decifra(doc, K)) !== JSON.stringify(h)) falha('a conferência de ida e volta falhou — nada gravado.');
  writeFileSync(saida, JSON.stringify(doc));
  const ms = Object.keys(meses), f = ms.filter(k => !meses[k].parcial && !meses[k].incompleto), p = ms.filter(k => meses[k].parcial), l = ms.filter(k => meses[k].incompleto);
  console.log(`ok: ${saida} · ${resumo}${aviso} · cobertura ${cobertura.map(c => c.join('→')).join(', ')} · meses fechados ${f.length}${p.length ? ' · em andamento ' + p.map(k => k + ' até o dia ' + meses[k].dia).join(', ') : ''}${l.length ? ' · incompletos (entram com o lançado, marcados): ' + l.map(k => k + ' dias ' + meses[k].diasDe + '–' + meses[k].diasAte + (meses[k].diasCobertos < meses[k].diasAte - meses[k].diasDe + 1 ? ' com falhas' : '')).join(', ') : ''}`);
} else {
  falha('modo desconhecido — use "importa" ou "confere".');
}
