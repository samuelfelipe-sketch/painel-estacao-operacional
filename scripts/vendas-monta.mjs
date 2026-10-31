/* Monta o JSON do painel Vendas (Metas e Margens) a partir do TEXTO do
   relatório do Argo "Acompanhamento de Metas e Margens de Vendas".

   O texto é o que o conector Microsoft 365 devolve ao ler o PDF que o Argo
   deixa todo dia no OneDrive (Operações/Vendas/Claude/DD-MM-AAAA_Relatorio
   DeAcompanhamentoDeMetasEMargensDeVenda.pdf): as tabelas vêm achatadas, uma
   página por linha, com os números em formato brasileiro (1.234,56). A Rotina
   grava esse texto num arquivo FORA do repositório e chama este script.

   Esquema de saída = o que o cartão "Vendas" das Configurações publica
   (painel-operacional-regras.md, esquema v2): meta, linhas, grupos, fat, mix,
   decomp, unidades e escopos (rede + uma entrada por unidade).

   Uso:
     node scripts/vendas-monta.mjs --txt <relatorio.txt> --saida <fora-do-repo>/dados.json [--anterior <json-ontem>]

   O script confere as somas (filhos = pai, rede = soma das unidades, projeção
   = acumulado ÷ dias × dias do mês) e NÃO grava se algo não fechar. Os logs
   dizem só datas, contagens e "ok": nenhum valor do relatório. */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
function opt(nome, padrao) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; }
function falha(m) { console.error('ERRO: ' + m); process.exit(1); }

const txtPath = opt('txt'); if (!txtPath) falha('informe --txt <arquivo de texto do relatório>.');
const saida = opt('saida'); if (!saida) falha('informe --saida <arquivo.json fora do repositório>.');
if (resolve(saida).startsWith(resolve('.')) && !resolve(saida).startsWith('/tmp')) falha('--saida precisa apontar para fora do repositório (o JSON em claro nunca é commitado).');
const anteriorPath = opt('anterior');

/* ---------- 1. texto → tabelas ---------- */
const bruto = readFileSync(txtPath, 'utf8');

/* o produto do rodapé já mudou de nome ("Argo Service Core" até out/2026, "Argo Gerenciador v.11.10.14 - Argo Sistemas"
   desde 31/10/2026): aceita qualquer "Argo <Nome>" seguido da versão */
const rodape = /Página\s+\d+\s+de\s+\d+\s+(Argo\s+[A-Za-z][A-Za-z ]*?)\s+(v\.[\d.]+).*?GERADO EM:\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}).*?Data:\s*(\d{2}\/\d{2}\/\d{4}).*?Unidades:\s*([\d,]+)/gs;
const rod = rodape.exec(bruto);
if (!rod) falha('não achei o rodapé do Argo (GERADO EM / Data / Unidades) — o texto não parece ser o relatório.');
const META_ARGO = { versao: rod[1].trim() + ' ' + rod[2], gerado: rod[3] + ' ' + rod[4], data: rod[5], unidades: rod[6].split(',').map(s => s.trim()).join(', ') };
const texto = bruto.replace(rodape, ' ').replace(/\s+/g, ' ');

/* secções: "3 - NOME | CNPJ: x" ... e "TODAS UNIDADES" */
const cabecalho = /(?:(\d+) - ([A-ZÀ-Ú0-9 .&-]+?) \| CNPJ: ([\d./-]+)|TODAS UNIDADES)/g;
const marcas = [];
let m;
while ((m = cabecalho.exec(texto))) marcas.push({ i: m.index, fim: m.index + m[0].length, cod: m[1] || 'REDE', nome: m[1] ? m[2].trim() : 'Todas as unidades', cnpj: m[3] || null });
if (!marcas.length) falha('não achei as secções por unidade.');
const secoes = marcas.map((mk, k) => ({ ...mk, corpo: texto.slice(mk.fim, k + 1 < marcas.length ? marcas[k + 1].i : undefined) }));

const ROTULOS_ANALISE = {
  'GNV': 'GNV', 'GC': 'GC', 'GA': 'GA', 'ET': 'ET', 'DS': 'DS', 'DC': 'DC', 'ARL': 'ARL',
  'TOTAL SIGLAS ET;GA;GC;GNV': 'OTTO', 'TOTAL SIGLAS DC;DS;DSA': 'DIESEL', 'GA;GC META MIX PERCENTUAL': 'MIX',
  'TOTAL COMBUSTÍVEIS': 'TOTCOMB', '2 - PRODUTOS AUTOMOTIVOS': 'AUTO', '3 - LOJA': 'LOJA', '4 - ARLA': 'ARLAV',
  '5 - LAVAGEM': 'LAV', '6 - OUTROS': 'OUTROS', 'TOTAL MERCADORIAS': 'TOTMERC',
};
const ROTULOS_PROJ = {
  'ARL - ARLA': 'ARL', 'DC - DIESEL S-500': 'DC', 'DS - DIESEL S-10 ADITIVADO V-POWER': 'DS', 'ET - ETANOL COMUM': 'ET',
  'GC - GASOLINA COMUM': 'GC', 'GNV - GÁS NATURAL VEICULAR': 'GNV', 'VP - GASOLINA ADITIVADA V-POWER': 'GA',
  'TOTAL SIGLAS DC;DS;DSA': 'DIESEL', 'TOTAL SIGLAS ET;GA;GC;GNV': 'OTTO', 'GA;GC META MIX PERCENTUAL': 'MIX',
  'TOTAL COMBUSTÍVEIS': 'TOTCOMB', '2 - PRODUTOS AUTOMOTIVOS': 'AUTO', '3 - LOJA': 'LOJA', '4 - ARLA': 'ARLAV',
  '5 - LAVAGEM': 'LAV', '6 - OUTROS': 'OUTROS', 'MERCADORIAS': 'TOTMERC',
};
const NUM = /^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/;
const num = s => parseFloat(s.replace(/\./g, '').replace(',', '.'));

/* corta o texto de uma secção nas três tabelas */
function tabelas(corpo) {
  const iD = corpo.indexOf('Análise Diária'), iM = corpo.indexOf('Análise Mensal'), iP = corpo.indexOf('Projeção de Vendas');
  if (iM < 0 || iP < 0) falha('secção sem "Análise Mensal" ou "Projeção de Vendas".');
  return { mensal: corpo.slice(iM, iP), proj: corpo.slice(iP), diaria: iD >= 0 ? corpo.slice(iD, iM) : '' };
}

/* texto achatado de uma tabela → { chave: [números] } */
function linhasDaTabela(seg, rotulos, esperado) {
  const toks = seg.split(' ').filter(Boolean);
  const nomes = Object.keys(rotulos).sort((a, b) => b.length - a.length);
  const out = {};
  let palavras = [], nums = [];
  function fecha() {
    if (nums.length) {
      const rot = nomes.find(n => palavras.join(' ').endsWith(n));
      if (rot) {
        let v = nums.slice();
        /* números largos quebram em dois tokens na extração ("140.719,7 9"): junta até fechar a contagem */
        for (let i = 0; i < v.length - 1 && v.length > esperado; i++) {
          if (/,\d$/.test(v[i]) && /^\d$/.test(v[i + 1])) { v.splice(i, 2, v[i] + v[i + 1]); i--; }
        }
        if (v.length !== esperado) falha(`linha "${rot}" com ${v.length} números (esperava ${esperado}) — texto do relatório incompleto ou mal copiado.`);
        out[rotulos[rot]] = v.map(num);
      }
    }
    palavras = []; nums = [];
  }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const ehRotuloNumerado = /^\d$/.test(t) && toks[i + 1] === '-';
    if (NUM.test(t) && !ehRotuloNumerado) { nums.push(t); }
    else { if (nums.length) fecha(); palavras.push(t); }
  }
  fecha();
  return out;
}

const ESC = secoes.map(s => {
  const t = tabelas(s.corpo);
  const mensal = linhasDaTabela(t.mensal, ROTULOS_ANALISE, 15);
  const proj = linhasDaTabela(t.proj, ROTULOS_PROJ, 10);
  const M = {};
  for (const k of Object.keys(mensal)) { const v = mensal[k]; M[k] = { A: { q: v[0], pmc: v[1], pmv: v[2], mg: v[3], mp: v[4] }, B: { q: v[5], pmc: v[6], pmv: v[7], mg: v[8], mp: v[9] }, C: { q: v[10], pmc: v[11], pmv: v[12], mg: v[13], mp: v[14] } }; }
  const P = {};
  for (const k of Object.keys(proj)) { const v = proj[k]; P[k] = { meta: v[0], acum: v[1], pctMeta: v[2], proj: v[3], metaAnt: v[4], realAnt: v[5], pctMetaAnt: v[6], difAnt: v[7], realAno: v[8], difAno: v[9] }; }
  return { cod: s.cod, nome: s.nome, cnpj: s.cnpj, M, P };
});
const REDE = ESC.find(e => e.cod === 'REDE'); if (!REDE) falha('não achei a secção TODAS UNIDADES.');
const UNIS = ESC.filter(e => e.cod !== 'REDE');

/* ---------- 2. meta (datas) ---------- */
const [dd, mm, aaaa] = META_ARGO.data.split('/').map(Number);
const diasNoMes = (a, m) => new Date(a, m, 0).getDate();
const mAnt = mm === 1 ? 12 : mm - 1, aAnt = mm === 1 ? aaaa - 1 : aaaa;
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const curto = (m, a) => MESES[m - 1].slice(0, 3).toLowerCase() + '/' + String(a).slice(2);
const p2 = n => String(n).padStart(2, '0');
const meta = {
  dias_dec: dd, dias_mes: diasNoMes(aaaa, mm), dias_ant: diasNoMes(aAnt, mAnt), dias_ano: diasNoMes(aaaa - 1, mm),
  data: META_ARGO.data, gerado: META_ARGO.gerado, unidades: META_ARGO.unidades, versao_argo: META_ARGO.versao,
  mes_rotulo: MESES[mm - 1] + ' ' + aaaa, mes_ref: aaaa + '-' + p2(mm), ant_ref: aAnt + '-' + p2(mAnt), ano_ref: (aaaa - 1) + '-' + p2(mm),
  ant_rotulo: curto(mAnt, aAnt), ano_rotulo: curto(mm, aaaa - 1),
};

/* ---------- 3. cálculo (fórmulas de painel-operacional-regras.md §2) ---------- */
const r6 = x => (x === null || x === undefined || !isFinite(x)) ? null : Math.round(x * 1e6) / 1e6;
const pct = (a, b) => (a === null || b === null || !b) ? null : r6((a / b - 1) * 100);
const ORDEM = ['GC', 'DS', 'DC', 'GA', 'ET', 'GNV', 'ARL', 'LOJA', 'AUTO', 'LAV', 'ARLAV'];
const NOME = { GC: 'Gasolina Comum', DS: 'Diesel S-10 V-Power', DC: 'Diesel S-500', GA: 'Gasolina Ad. V-Power', ET: 'Etanol Comum', GNV: 'GNV', ARL: 'Arla (litros)', LOJA: 'Loja de Conveniência', AUTO: 'Produtos Automotivos', LAV: 'Lavagem', ARLAV: 'Arla (R$)' };
const NOME_CURTO = { DS: 'Diesel S-10', GA: 'V-Power', GC: 'Gasolina Comum', DC: 'Diesel S-500', ET: 'Etanol', GNV: 'GNV', ARL: 'Arla pista' };
const COMB = ['GC', 'DS', 'DC', 'GA', 'ET', 'GNV', 'ARL'], OTTO = ['GC', 'GA', 'ET', 'GNV'], DIESEL = ['DS', 'DC'], MERC = ['LOJA', 'AUTO', 'LAV', 'ARLAV'];
const GRUPOS = [['TOTCOMB', 'Total Combustíveis', 'comb'], ['OTTO', 'Ciclo Otto', 'comb'], ['DIESEL', 'Ciclo Diesel', 'comb'], ['TOTMERC', 'Total Mercadorias', 'merc']];

function linha(cod, nome, tipo, m, p, semAno) {
  if (!m || !p) falha(`faltou a linha ${cod} na análise mensal ou na projeção.`);
  const comb = tipo === 'comb';
  const L = { cod, nome, tipo, ant: m.B.q, ano: semAno ? null : m.C.q };
  L.muA = comb ? m.A.mg : null; L.muB = comb ? m.B.mg : null; L.muC = comb && !semAno ? m.C.mg : null;
  L.mpA = m.A.mp; L.mpB = m.B.mp; L.mpC = semAno ? null : m.C.mp;
  L.pmcA = m.A.pmc; L.pmcB = m.B.pmc; L.pmvA = m.A.pmv; L.pmvB = m.B.pmv; L.pmvC = semAno ? 0 : m.C.pmv;
  L.mrsAnt = comb ? r6(m.B.q * m.B.mg) : m.B.mg; L.mrsAno = semAno ? null : (comb ? r6(m.C.q * m.C.mg) : m.C.mg);
  L.meta = p.meta; L.acum = p.acum; L.pctMeta = p.pctMeta; L.proj = p.proj; L.difAnt = p.difAnt; L.difAno = semAno ? null : p.difAno;
  L.metaOk = p.meta > 1000;
  L.rdAtual = r6(p.acum / meta.dias_dec); L.rdAnt = r6(m.B.q / meta.dias_ant); L.rdAno = semAno ? null : r6(m.C.q / meta.dias_ano);
  L.vrdAnt = pct(L.rdAtual, L.rdAnt); L.vrdAno = semAno ? null : pct(L.rdAtual, L.rdAno);
  L.mrsProj = comb ? r6(p.proj * m.A.mg) : r6(p.proj * m.A.mp / 100);
  L.dMargPct = comb ? pct(m.A.mg, m.B.mg) : pct(m.A.mp, m.B.mp);
  L.dMrs = r6(L.mrsProj - L.mrsAnt);
  return L;
}

function fatLinha(L, semAno) {
  const comb = L.tipo === 'comb';
  const F = { nome: L.nome, un: comb ? 'L' : (L.cod === 'LAV' ? 'lav.' : 'itens') };
  if (comb) { F.recA = r6(L.proj * L.pmvA); F.recB = r6(L.ant * L.pmvB); F.recC = semAno ? null : r6(L.ano * L.pmvC); F.qtdA = L.proj; F.qtdB = L.ant; F.qtdC = semAno ? null : L.ano; }
  else {
    F.recA = L.proj; F.recB = L.ant; F.recC = semAno ? null : L.ano;
    F.qtdA = L.pmvA ? r6(L.proj / L.pmvA) : null;
    F.qtdB = L.cod === 'LAV' ? null : (L.pmvB ? r6(L.ant / L.pmvB) : null);
    F.qtdC = (L.cod === 'LAV' || semAno) ? null : (L.pmvC ? r6(L.ano / L.pmvC) : null);
  }
  return F;
}
function fatSoma(nome, un, itens, campos) {
  const F = { nome, un };
  for (const c of campos) { const vs = itens.map(i => i[c]); F[c] = vs.some(v => v === null) ? null : r6(vs.reduce((a, b) => a + b, 0)); }
  return F;
}
function fechaFat(F, TOT) {
  F.vAnt = pct(F.recA, F.recB); F.vAno = pct(F.recA, F.recC);
  F.part = r6(F.recA / TOT.recA * 100);
  F.qAnt = (F.qtdA !== null && F.qtdB !== null) ? pct(F.qtdA, F.qtdB) : null;
  F.qAno = (F.qtdA !== null && F.qtdC !== null) ? pct(F.qtdA, F.qtdC) : null;
  F.dAnt = r6(F.recA - F.recB); F.dAno = F.recC === null ? null : r6(F.recA - F.recC);
  F.cAnt = r6(F.dAnt / TOT.dAnt * 100); F.cAno = (F.dAno === null || TOT.dAno === null) ? null : r6(F.dAno / TOT.dAno * 100);
}

function decompBase(base, linhas, fat) {
  const kr = base === 'ano' ? 'recC' : 'recB', kq = base === 'ano' ? 'qtdC' : 'qtdB', kp = base === 'ano' ? 'pmvC' : 'pmvB';
  if (fat.FCOMB[kr] === null) return null;
  const R0 = fat.FCOMB[kr], R1 = fat.FCOMB.recA, Q0 = fat.FCOMB[kq], Q1 = fat.FCOMB.qtdA;
  const P0 = r6(R0 / Q0), P1 = r6(R1 / Q1);
  const vol = r6((Q1 - Q0) * P0);
  let pre = 0; const ls = [];
  for (const L of linhas.filter(l => l.tipo === 'comb')) {
    const q0 = L[base === 'ano' ? 'ano' : 'ant'], q1 = L.proj, p0 = L[kp], p1 = L.pmvA;
    const v = r6((q1 - q0) * p0), pr = r6(q1 * (p1 - p0));
    pre += pr;
    ls.push({ cod: L.cod, nome: NOME_CURTO[L.cod], vol: v, pre: pr, p0, p1, q0, q1, drec: r6(fat[L.cod].recA - fat[L.cod][kr]) });
  }
  pre = r6(pre);
  const merc = r6(fat.FMERC.recA - fat.FMERC[kr]);
  const totBase = fat.FTOT[kr], totProj = fat.FTOT.recA, dTot = r6(totProj - totBase);
  const mix = r6(dTot - merc - vol - pre); /* resíduo: vol + mix + pre + merc = dTot, exatamente */
  ls.sort((a, b) => Math.abs(b.drec) - Math.abs(a.drec));
  return { R0, R1, Q0, Q1, P0, P1, vol, mix, pre, merc, totBase, totProj, dTot, linhas: ls };
}

function escopo(E) {
  const semAno = !!(E.M.TOTCOMB && E.M.TOTCOMB.C.q === 0 && E.M.TOTMERC && E.M.TOTMERC.C.q === 0);
  const presentes = ORDEM.filter(c => E.M[c]);
  const linhas = presentes.map(c => linha(c, NOME[c], COMB.includes(c) ? 'comb' : 'merc', E.M[c], E.P[c], semAno));
  const grupos = GRUPOS.map(([c, n, t]) => linha(c, n, t, E.M[c], E.P[c], semAno));
  const fat = {};
  for (const L of linhas) fat[L.cod] = fatLinha(L, semAno);
  const campos = ['recA', 'recB', 'recC', 'qtdA', 'qtdB', 'qtdC'];
  const pick = cs => cs.filter(c => fat[c]).map(c => fat[c]);
  fat.FOTTO = fatSoma('Ciclo Otto', 'L', pick(OTTO), campos);
  fat.FDIESEL = fatSoma('Ciclo Diesel', 'L', pick(DIESEL), campos);
  fat.FCOMB = fatSoma('Combustíveis', 'L', pick(COMB), campos);
  fat.FMERC = fatSoma('Mercadorias e serviços', 'unid.', pick(MERC), ['recA', 'recB', 'recC']);
  const semLav = fatSoma('', '', pick(MERC.filter(c => c !== 'LAV')), ['qtdA', 'qtdB', 'qtdC']);
  fat.FMERC.qtdA = semLav.qtdA; fat.FMERC.qtdB = semLav.qtdB; fat.FMERC.qtdC = semLav.qtdC; if (fat.LAV) fat.FMERC.qNota = 'sem lavagem';
  fat.FTOT = { nome: 'Faturamento total', un: null, recA: r6(fat.FCOMB.recA + fat.FMERC.recA), recB: r6(fat.FCOMB.recB + fat.FMERC.recB), recC: semAno ? null : r6(fat.FCOMB.recC + fat.FMERC.recC), qtdA: null, qtdB: null, qtdC: null };
  fat.FTOT.dAnt = r6(fat.FTOT.recA - fat.FTOT.recB); fat.FTOT.dAno = semAno ? null : r6(fat.FTOT.recA - fat.FTOT.recC);
  for (const k of Object.keys(fat)) if (k !== 'FTOT') fechaFat(fat[k], fat.FTOT);
  fat.FTOT.vAnt = pct(fat.FTOT.recA, fat.FTOT.recB); fat.FTOT.vAno = semAno ? null : pct(fat.FTOT.recA, fat.FTOT.recC);
  fat.FTOT.part = 100; fat.FTOT.qAnt = null; fat.FTOT.qAno = null; fat.FTOT.cAnt = 100; fat.FTOT.cAno = semAno ? null : 100;
  const mx = E.P.MIX;
  const mix = mx ? { meta: mx.meta, acum: mx.acum, pct_meta: mx.pctMeta, proj: mx.proj, meta_ant: mx.metaAnt, real_ant: mx.realAnt, dif_ant: mx.difAnt, real_ano: mx.realAno, dif_ano: mx.difAno } : null;
  const decomp = { ano: decompBase('ano', linhas, fat), ant: decompBase('ant', linhas, fat) };
  return { cod: E.cod, nome: E.nome, cnpj: E.cnpj, semBaseAno: semAno, linhas, grupos, fat, mix, decomp };
}

const escopos = [...ESC.filter(e => e.cod === 'REDE'), ...ESC.filter(e => e.cod !== 'REDE')].map(escopo);
const rede = escopos.find(e => e.cod === 'REDE');
const NOME_UNI = { '3': 'SF', '4': 'Sapatão', '5': 'Safyr' };
const unidades = escopos.filter(e => e.cod !== 'REDE').map(e => {
  const u = { cod: e.cod, nome: NOME_UNI[e.cod] || e.nome };
  if (e.semBaseAno) u.nova = true;
  u.recA = e.fat.FTOT.recA; u.recB = e.fat.FTOT.recB; u.recC = e.semBaseAno ? 0 : e.fat.FTOT.recC;
  return u;
});

const D = {
  esquema: { versao: 2, compat_v1: true, gerado_por: 'Relatório Argo "Acompanhamento de Metas e Margens de Vendas"', doc: 'painel-operacional-regras.md', diesel_inclui_arla: false },
  meta, escopos, linhas: rede.linhas, grupos: rede.grupos, fat: rede.fat, mix: rede.mix, decomp: rede.decomp, unidades,
};

/* ---------- 4. conferências (reprovou → não grava) ---------- */
const erros = [];
const perto = (a, b, tol) => Math.abs(a - b) <= tol;
function confereEscopo(E, e) {
  const q = (k, per) => E.M[k] ? E.M[k][per].q : 0;
  for (const per of ['A', 'B', 'C']) {
    if (e.semBaseAno && per === 'C') continue;
    const otto = OTTO.reduce((s, c) => s + q(c, per), 0), dies = DIESEL.reduce((s, c) => s + q(c, per), 0);
    if (E.M.OTTO && !perto(otto, q('OTTO', per), 2)) erros.push(`${E.cod}: Otto ≠ soma das linhas (${per})`);
    if (E.M.DIESEL && !perto(dies, q('DIESEL', per), 2)) erros.push(`${E.cod}: Diesel ≠ soma das linhas (${per})`);
    if (!perto(otto + dies + q('ARL', per), q('TOTCOMB', per), 3)) erros.push(`${E.cod}: Combustíveis ≠ Otto + Diesel + Arla (${per})`);
    const merc = MERC.reduce((s, c) => s + q(c, per), 0) + q('OUTROS', per);
    if (!perto(merc, q('TOTMERC', per), Math.max(3, q('TOTMERC', per) * 1e-4))) erros.push(`${E.cod}: Mercadorias ≠ soma das linhas (${per})`);
  }
  for (const L of e.linhas) {
    const esperado = L.acum / meta.dias_dec * meta.dias_mes;
    if (L.proj && !perto(L.proj, esperado, Math.max(2, esperado * 0.005))) erros.push(`${E.cod}/${L.cod}: projeção não bate com acumulado ÷ dias × dias do mês`);
  }
  const d = e.decomp;
  for (const b of ['ano', 'ant']) if (d[b] && !perto(d[b].vol + d[b].mix + d[b].pre + d[b].merc, d[b].dTot, 0.01)) erros.push(`${E.cod}: decomposição (${b}) não fecha`);
}
for (const E of ESC) confereEscopo(E, escopos.find(e => e.cod === E.cod));
/* rede = soma das unidades, linha a linha (pega erro de cópia nas tabelas por unidade) */
for (const c of [...ORDEM, 'TOTCOMB', 'TOTMERC']) {
  if (!REDE.M[c]) continue;
  for (const per of ['A', 'B', 'C']) {
    const soma = UNIS.reduce((s, u) => s + (u.M[c] ? u.M[c][per].q : 0), 0);
    if (!perto(soma, REDE.M[c][per].q, Math.max(3, REDE.M[c][per].q * 1e-4))) erros.push(`rede ≠ soma das unidades em ${c} (${per})`);
  }
  if (REDE.P[c]) { const soma = UNIS.reduce((s, u) => s + (u.P[c] ? u.P[c].acum : 0), 0); if (!perto(soma, REDE.P[c].acum, Math.max(3, REDE.P[c].acum * 1e-4))) erros.push(`rede ≠ soma das unidades em ${c} (acumulado da projeção)`); }
}
const somaU = unidades.reduce((s, u) => s + u.recA, 0);
if (!perto(somaU, D.fat.FTOT.recA, D.fat.FTOT.recA * 0.002)) erros.push('faturamento projetado da rede ≠ soma das unidades (acima de 0,2%)');
if (!D.linhas.length || !D.fat.FTOT.recA) erros.push('rede sem linhas ou sem faturamento.');
if (anteriorPath) {
  try {
    const A = JSON.parse(readFileSync(anteriorPath, 'utf8'));
    if (A.meta && A.meta.mes_ref === meta.mes_ref) {
      if (A.meta.dias_dec > meta.dias_dec) erros.push('o relatório é mais antigo que o já publicado (corte anterior).');
      for (const L of D.linhas) { const La = (A.linhas || []).find(x => x.cod === L.cod); if (La && L.tipo === 'comb' && L.acum + 1 < La.acum) erros.push(`${L.cod}: acumulado menor que o publicado ontem no mesmo mês`); }
    }
  } catch (e) { console.log('aviso: não consegui ler o JSON anterior (' + e.message + '); sigo sem a comparação.'); }
}
if (erros.length) { console.error('REPROVADO — nada gravado:'); for (const e of erros) console.error(' - ' + e); process.exit(2); }

writeFileSync(saida, JSON.stringify(D));
console.log(`ok: ${saida} · corte ${meta.data} (${meta.mes_rotulo}, dia ${meta.dias_dec}/${meta.dias_mes}) · gerado no Argo em ${meta.gerado} · ${D.linhas.length} linhas · ${unidades.length} unidades · conferências aprovadas`);
