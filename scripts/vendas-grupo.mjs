/* Faturamento mensal das outras empresas do grupo para a seção "Ano a ano"
   do painel Vendas (botão "Grupo / Só postos").

   Fontes (relatórios do Argo linha a linha, gerados com o período desejado):
     - Transportadora (unidade 99, SAPATAO TRANSPORTES): "Relatório de MDF-es Emitidos",
       situação Autorizado — uma linha por MDF-e, com Emissão e Valor.
     - Holding (unidade 1, SISS EMPREENDIMENTOS): "Relatório de Vendas - Nota Avulsa",
       tipo Completo — uma linha por nota, com Emissão, Cliente e Valor Total;
       o rodapé traz "Total Geral", que o script confere contra a soma.

   O resultado vai para operacional-historico.json (cifrado), no bloco
   `empresas`, separado dos postos (`meses`):
     empresas: { holding: { nome, fonte, periodo:{de,ate}, atualizadoEm,
                 meses: { "2026-10": { fat, intra, docs } } }, transportadora: {…} }
   fat = soma dos documentos do mês; intra = parte faturada a empresas do próprio
   grupo (postos, transportadora, holding — o painel mostra o bruto e informa essa
   parte); docs = quantidade. Os meses do período do relatório são substituídos
   (mês sem documento fica 0); meses fora do período ficam como estavam.

   Uso:
     node scripts/vendas-grupo.mjs importa --pdf <relatorio.pdf> [--empresa holding|transportadora]
                                   [--entrada operacional-historico.json] [--saida …]
     node scripts/vendas-grupo.mjs confere --pdf <relatorio.pdf>     (só lê e confere; não grava)

   Logs só com meses, contagens e "ok": nenhum valor. */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { chave, cifra, decifra, falha } from './vendas-lib.mjs';

const args = process.argv.slice(2);
const modo = args[0];
function opt(nome, padrao) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; }
const num = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
const r2 = v => Math.round(v * 100) / 100;
const refDe = d => { const [dd, mm, aa] = d.split('/'); return `${aa}-${mm}`; };

const EMPRESAS = {
  transportadora: { nome: 'Transportadora', titulo: /Relatório de MDF-es Emitidos/, unidade: /SAPATAO TRANSPORTES/ },
  holding: { nome: 'Holding', titulo: /Relatório de Vendas - Nota Avulsa/, unidade: /SISS EMPREENDIMENTOS/ },
};
/* clientes que são empresas do próprio grupo (postos, transportadora, holding) */
const GRUPO = /POSTO SAPAT|SF COM(ERCIO)? DE COMB|SAFYR|SAPATAO TRANSPORTES|SISS EMPREEND/i;

function leRelatorio(pdf, empresaOpt) {
  let txt;
  try { txt = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { falha('pdftotext falhou (poppler instalado?): ' + (e.message || e)); }
  const cab = txt.slice(0, 3000);
  const empresa = empresaOpt || Object.keys(EMPRESAS).find(k => EMPRESAS[k].titulo.test(cab));
  if (!empresa || !EMPRESAS[empresa]) falha('não reconheci o relatório — informe --empresa holding|transportadora.');
  const E = EMPRESAS[empresa];
  if (!E.titulo.test(cab)) falha(`o PDF não é o relatório esperado para ${E.nome}.`);
  if (!E.unidade.test(txt)) falha(`o relatório não é da unidade de negócio da ${E.nome}.`);
  const per = cab.match(/Emiss(?:ão|ao):\s*(\d{2}\/\d{2}\/\d{4})\s+a\s+(\d{2}\/\d{2}\/\d{4})/);
  if (!per) falha('não achei o período de emissão no cabeçalho.');
  const de = refDe(per[1]), ate = refDe(per[2]);

  const linhas = txt.split('\n');
  const docs = [];
  for (const l of linhas) {
    const m = l.match(/^\s*(.*?)(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}\s+(.*?)(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/);
    if (!m) continue;
    const antes = m[1], data = m[2], depois = m[3], valor = num(m[4]);
    let cliente;
    if (empresa === 'transportadora') { const c = antes.match(/^\s*\d+\s+\d+\s+(.+?)\s*$/); if (!c) continue; cliente = c[1]; if (!/^\d{40,44}\b/.test(depois.trim())) continue; } /* a chave de 44 dígitos quebra em 42 + 2 na linha seguinte */
    else { const c = depois.match(/^\s*\d+\s+NA\s+(.+?)\s{2,}/); if (!c) continue; cliente = c[1]; }
    docs.push({ data, ref: refDe(data), cliente: cliente.trim(), valor });
  }
  if (!docs.length) falha('nenhuma linha de documento reconhecida no relatório.');
  const fora = docs.filter(d => d.ref < de || d.ref > ate);
  if (fora.length) falha(`${fora.length} documento(s) fora do período do cabeçalho.`);
  /* conferências: Total Geral do rodapé (quando existe) e contagem por número de documento, se sequencial */
  const soma = r2(docs.reduce((s, d) => s + d.valor, 0));
  const tg = txt.match(/Total Geral:\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/);
  if (tg && Math.abs(num(tg[1]) - soma) > 0.011) falha('a soma das linhas não bate com o "Total Geral" do relatório — texto incompleto?');
  /* meses do período, todos presentes (0 quando sem documento) */
  const meses = {};
  for (let [a, m] = de.split('-').map(Number); ; ) {
    const ref = `${a}-${String(m).padStart(2, '0')}`;
    meses[ref] = { fat: 0, intra: 0, docs: 0 };
    if (ref === ate) break;
    if (++m > 12) { m = 1; a++; }
  }
  for (const d of docs) { const x = meses[d.ref]; x.fat = r2(x.fat + d.valor); x.docs++; if (GRUPO.test(d.cliente)) x.intra = r2(x.intra + d.valor); }
  return { empresa, nome: E.nome, fonte: cab.match(/Relatório de [^\n]+?(?=\s{3,}|$)/m)[0].trim(), de, ate, docs: docs.length, meses, conferiuTotal: !!tg };
}

const pdf = opt('pdf'); if (!pdf) falha('informe --pdf <relatorio.pdf>.');
const R = leRelatorio(pdf, opt('empresa'));
const comDocs = Object.keys(R.meses).filter(k => R.meses[k].docs);
const resumo = `${R.nome} · ${R.fonte} · ${R.de} → ${R.ate} · ${R.docs} documentos · ${comDocs.length} meses com movimento (${comDocs[0] || '—'} → ${comDocs[comDocs.length - 1] || '—'})` + (R.conferiuTotal ? ' · Total Geral conferido' : ' · sem Total Geral no relatório');

if (modo === 'confere') {
  console.log('ok: ' + resumo);
} else if (modo === 'importa') {
  const entrada = resolve(opt('entrada', 'operacional-historico.json')), saida = resolve(opt('saida', entrada));
  const K = chave();
  let h = { v: 1, meses: {} };
  if (existsSync(entrada)) { h = decifra(JSON.parse(readFileSync(entrada, 'utf8')), K); if (!h || h.v !== 1) falha('o histórico publicado não tem o formato esperado.'); }
  h.empresas = h.empresas || {};
  const atual = h.empresas[R.empresa] || { meses: {} };
  const meses = Object.assign({}, atual.meses || {}, R.meses);
  h.empresas[R.empresa] = { nome: R.nome, fonte: R.fonte, periodo: { de: R.de, ate: R.ate }, atualizadoEm: new Date().toISOString().slice(0, 16), meses: Object.fromEntries(Object.keys(meses).sort().map(k => [k, meses[k]])) };
  h.atualizadoEm = new Date().toISOString().slice(0, 16);
  const doc = cifra(h, K);
  if (JSON.stringify(decifra(doc, K)) !== JSON.stringify(h)) falha('a conferência de ida e volta falhou — nada gravado.');
  writeFileSync(saida, JSON.stringify(doc));
  console.log(`ok: ${saida} · ${resumo}`);
} else {
  falha('modo desconhecido — use "importa" ou "confere".');
}
