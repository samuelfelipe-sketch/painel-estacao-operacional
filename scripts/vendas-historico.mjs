/* Histórico mensal do painel Vendas — a base da visão "Ano a ano".

   O relatório diário do Argo só enxerga três meses (o corrente acumulado, o
   anterior realizado e o mesmo mês do ano passado realizado). Este script
   guarda o que cada relatório diz sobre esses meses num arquivo CIFRADO,
   operacional-historico.json (raiz), e assim a série mensal vai se
   completando sozinha a cada dia — e pode ser semeada com relatórios antigos
   (o mesmo relatório gerado no Argo com "Data" = último dia de cada mês).

   Formato decifrado:
     { v:1, atualizadoEm, meses: { "2026-10": { fat, comb, merc, litros, margem,
       fechado:true, corte:"31/10/2026", un:{ "3":fat, "4":fat, "5":fat } },
       "2026-11": { fat (acumulado), proj, comb, merc, litros, margem, fechado:false,
       dias_dec, dias_mes, corte, un } } }
   fat/comb/merc/margem em R$, litros de combustíveis; "un" = faturamento por
   unidade (código do Argo). Mês fechado vindo de relatório mais novo substitui
   o anterior; um parcial nunca substitui um fechado.

   Uso:
     node scripts/vendas-historico.mjs anota --json <dados.json do vendas-monta> [--entrada operacional-historico.json] [--saida operacional-historico.json]
     node scripts/vendas-historico.mjs abre --para <pasta-fora-do-repo>   → <pasta>/historico.json
     node scripts/vendas-historico.mjs importa --json <historico.json em claro>   (substitui tudo)

   Logs só com meses, contagens e "ok": nenhum valor. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { chave, cifra, decifra, falha } from './vendas-lib.mjs';

const args = process.argv.slice(2);
const modo = args[0];
function opt(nome, padrao) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; }
function foraDoRepo(p) { return !(resolve(p).startsWith(resolve('.')) && !resolve(p).startsWith('/tmp')); }
function isoCorte(c) { const [d, m, a] = String(c || '').split('/'); return a && m && d ? `${a}-${m}-${d}` : ''; }

function leHist(path) {
  if (!existsSync(path)) return { v: 1, meses: {} };
  const h = decifra(JSON.parse(readFileSync(path, 'utf8')), K);
  if (!h || h.v !== 1 || typeof h.meses !== 'object') falha('o histórico publicado não tem o formato esperado.');
  return h;
}
function gravaHist(h, path) {
  h.atualizadoEm = new Date().toISOString().slice(0, 16);
  const doc = cifra(h, K);
  if (JSON.stringify(decifra(doc, K)) !== JSON.stringify(h)) falha('a conferência de ida e volta falhou — nada gravado.');
  writeFileSync(path, JSON.stringify(doc));
}

/* o que um JSON diário diz sobre os seus três meses */
function extrai(D) {
  const F = D.fat || {}, FT = F.FTOT, FC = F.FCOMB, FM = F.FMERC;
  const g = {}; (D.grupos || []).forEach(l => { g[l.cod] = l; });
  const TC = g.TOTCOMB, TM = g.TOTMERC;
  if (!FT || !FC || !FM || !TC || !TM) falha('o JSON não traz fat.FTOT/FCOMB/FMERC e os totalizadores.');
  const m = D.meta; for (const c of ['mes_ref', 'ant_ref', 'ano_ref', 'data', 'dias_dec', 'dias_mes']) if (m[c] === undefined) falha('meta sem ' + c + '.');
  const un = k => { const o = {}; (D.unidades || []).forEach(u => { if (isFinite(u[k])) o[u.cod] = u[k]; }); return o; };
  const frac = m.dias_dec / m.dias_mes, fechado = m.dias_dec === m.dias_mes;
  const r = (v) => Math.round(v * 100) / 100;
  return {
    [m.ant_ref]: { fat: r(FT.recB), comb: r(FC.recB), merc: r(FM.recB), litros: r(TC.ant), margem: r(TC.mrsAnt + TM.mrsAnt), fechado: true, corte: m.data, un: un('recB') },
    [m.ano_ref]: { fat: r(FT.recC), comb: r(FC.recC), merc: r(FM.recC), litros: r(TC.ano), margem: r(TC.mrsAno + TM.mrsAno), fechado: true, corte: m.data, un: un('recC') },
    [m.mes_ref]: Object.assign({ fat: r(FT.recA * frac), comb: r(FC.recA * frac), merc: r(FM.recA * frac), litros: r(TC.acum), margem: r((TC.mrsProj + TM.mrsProj) * frac), fechado, corte: m.data, un: un('recA') },
      fechado ? {} : { proj: r(FT.recA), dias_dec: m.dias_dec, dias_mes: m.dias_mes }),
  };
}
/* fechado substitui parcial; entre dois do mesmo tipo, vale o relatório mais novo */
function mescla(hist, novos) {
  const r = { gravados: [], mantidos: [] };
  for (const ref of Object.keys(novos)) {
    const a = hist.meses[ref], n = novos[ref];
    const ganha = !a || (n.fechado && !a.fechado) || (n.fechado === a.fechado && isoCorte(n.corte) >= isoCorte(a.corte));
    if (ganha) { hist.meses[ref] = n; r.gravados.push(ref + (n.fechado ? '' : ' (parcial)')); } else r.mantidos.push(ref);
  }
  hist.meses = Object.fromEntries(Object.keys(hist.meses).sort().map(k => [k, hist.meses[k]]));
  return r;
}

let K;
if (modo === 'anota') {
  const jsonPath = opt('json'); if (!jsonPath) falha('informe --json <dados.json>.');
  const entrada = resolve(opt('entrada', 'operacional-historico.json')), saida = resolve(opt('saida', entrada));
  let D; try { D = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch (e) { falha('o arquivo não é um JSON válido.'); }
  K = chave();
  const h = leHist(entrada);
  const r = mescla(h, extrai(D));
  gravaHist(h, saida);
  console.log(`ok: ${saida} · corte ${D.meta.data} · gravados ${r.gravados.join(', ') || 'nenhum'}${r.mantidos.length ? ' · mantidos ' + r.mantidos.join(', ') : ''} · ${Object.keys(h.meses).length} meses no histórico`);
} else if (modo === 'abre') {
  const para = opt('para'); if (!para) falha('informe --para <pasta fora do repositório>.');
  if (!foraDoRepo(para)) falha('--para precisa apontar para fora do repositório (o JSON decifrado nunca é commitado).');
  const entrada = resolve(opt('entrada', 'operacional-historico.json'));
  if (!existsSync(entrada)) falha('não existe ' + entrada + ' — o histórico ainda não foi publicado.');
  K = chave();
  const h = leHist(entrada);
  mkdirSync(para, { recursive: true });
  const alvo = join(para, 'historico.json');
  writeFileSync(alvo, JSON.stringify(h, null, 1));
  const ks = Object.keys(h.meses);
  console.log(`aberto: ${alvo} · ${ks.length} meses (${ks[0] || '—'} → ${ks[ks.length - 1] || '—'})`);
} else if (modo === 'importa') {
  const jsonPath = opt('json'); if (!jsonPath) falha('informe --json <historico.json>.');
  const saida = resolve(opt('saida', 'operacional-historico.json'));
  let h; try { h = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch (e) { falha('o arquivo não é um JSON válido.'); }
  if (!h || h.v !== 1 || typeof h.meses !== 'object') falha('esse JSON não parece ser o histórico (v:1, meses).');
  for (const [ref, m] of Object.entries(h.meses)) { if (!/^\d{4}-\d{2}$/.test(ref) || !isFinite(m.fat)) falha('mês inválido: ' + ref); }
  K = chave();
  gravaHist(h, saida);
  console.log(`importado: ${saida} · ${Object.keys(h.meses).length} meses`);
} else {
  falha('modo desconhecido — use "anota", "abre" ou "importa".');
}
