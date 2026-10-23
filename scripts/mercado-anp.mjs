/* Market Share — agrega a base aberta da ANP de vendas das distribuidoras
   (arquivo Liquidos_Vendas_*.csv do pacote liquidos.zip, em
   gov.br/anp → Dados abertos → vendas de derivados de petróleo e
   biocombustíveis) em mercado/anp-vendas.json, o arquivo que o painel
   Market Share lê. Dados públicos: ficam em claro no repositório.

   Roda no GitHub Actions (.github/workflows/mercado-anp.yml), porque o
   ambiente da nuvem do Claude Code não alcança o gov.br.

   Colunas esperadas (nomes conferidos por aproximação, sem acento e em
   minúsculas — a ANP não documenta um layout estável):
     Ano; Mes; Agente Regulado; Codigo do Produto; Nome do Produto;
     Descricao do Produto; Regiao Origem; UF Origem; Regiao Destinatario;
     UF Destino; Mercado Destinatario; Quantidade de Produto (mil m3)

   Uso:
     node scripts/mercado-anp.mjs --pasta <dir com os CSVs> [--saida mercado/anp-vendas.json] [--desde 2025-01]
     node scripts/mercado-anp.mjs --pasta <dir> --inspeciona      → só descreve os arquivos (cabeçalho, valores distintos, linhas por ano)

   Saída: por escopo (RS, SUL, BR) × mês × segmento (rev = posto revendedor,
   tot = todos os segmentos) × produto (otto, gasolina, etanol, diesel) →
   volume em mil m³ por distribuidora (as maiores do escopo; o resto em
   "Outras") e o total. O script confere que distribuidoras somam o total
   e que otto = gasolina + etanol; reprovou, não grava. */
import { createReadStream, readdirSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'fs';
import { createInterface } from 'readline';
import { resolve, join, extname, basename } from 'path';

const args = process.argv.slice(2);
function opt(nome, padrao) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao; }
const flag = nome => args.includes('--' + nome);
function falha(m) { console.error('ERRO: ' + m); process.exit(1); }

const pasta = opt('pasta'); if (!pasta) falha('informe --pasta <diretório com os CSVs da ANP>.');
const saida = resolve(opt('saida', 'mercado/anp-vendas.json'));
const desde = opt('desde', '2025-01');
const inspeciona = flag('inspeciona');
const TOP = 12; /* distribuidoras nomeadas por escopo; o resto vira "Outras" */

function arquivos(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...arquivos(p));
    else if (extname(n).toLowerCase() === '.csv' && /^Liquidos_Vendas_/i.test(n) && !/2007_a_2017/.test(n)) out.push(p); /* só a base de vendas; o histórico 2007–2017 vem sem cabeçalho e fica fora */
  }
  return out.sort();
}
const csvs = arquivos(pasta);
if (!csvs.length) falha('nenhum Liquidos_Vendas_*.csv em ' + pasta);

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normU = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/* separa uma linha CSV com ; respeitando aspas */
function split(linha) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (q) { if (c === '"') { if (linha[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function num(s) {
  s = String(s).trim().replace(/\./g, '').replace(',', '.');
  const v = parseFloat(s);
  return isFinite(v) ? v : NaN;
}

/* decide a codificação pelo cabeçalho: latin1 que "parece" UTF-8 mal lido vira utf8 */
function codificacao(arq) {
  const buf = Buffer.alloc(1 << 20);
  const fd = openSync(arq, 'r'); const n = readSync(fd, buf, 0, buf.length, 0); closeSync(fd);
  const u = buf.subarray(0, n).toString('utf8');
  if (/�/.test(u)) return 'latin1';
  return 'utf8';
}

const COL = { ano: ['ano'], mes: ['mes'], agente: ['agente regulado', 'distribuidor', 'razao social'], produto: ['nome do produto', 'produto'], descricao: ['descricao do produto'], regdest: ['regiao destinatario', 'regiao destino'], ufdest: ['uf destino', 'uf destinatario', 'uf'], mercado: ['mercado destinatario', 'segmento', 'mercado'], qtd: ['quantidade de produto mil m3', 'quantidade', 'volume'] };
function mapeia(cab) {
  const n = cab.map(norm), idx = {};
  for (const [k, cands] of Object.entries(COL)) {
    let i = -1;
    for (const c of cands) { i = n.findIndex(x => x === c); if (i >= 0) break; }
    if (i < 0) for (const c of cands) { i = n.findIndex(x => x.startsWith(c)); if (i >= 0) break; }
    idx[k] = i;
  }
  return idx;
}

function produtoDe(nome) {
  const n = normU(nome);
  if (/GASOLINA/.test(n) && !/AVIACAO/.test(n)) return 'gasolina';
  if (/ETANOL/.test(n) && /HIDRAT/.test(n)) return 'etanol';
  if (/DIESEL/.test(n) && !/MARITIMO/.test(n)) return 'diesel';
  return null;
}
/* segmentos da ANP: "POSTO DE COMBUSTÍVEIS - BANDEIRADO", "POSTO DE COMBUSTÍVEIS - BANDEIRA BRANCA",
   "CONSUMIDOR FINAL", "TRR", "TRRNI". O painel guarda rev (os dois tipos de posto),
   band (só bandeirados), bb (só bandeira branca) e tot (tudo). */
function segmentoDe(mercado) {
  const n = normU(mercado);
  if (/POSTO|REVENDEDOR/.test(n) && !/TRR/.test(n)) return /BRANCA/.test(n) ? 'bb' : 'band';
  if (/TRR|RETALHISTA/.test(n)) return 'trr';
  if (/CONSUMIDOR/.test(n)) return 'cf';
  return 'outro';
}
const SEGS = ['rev', 'band', 'bb', 'tot'];
function segsDe(seg) { return seg === 'band' ? ['rev', 'band', 'tot'] : seg === 'bb' ? ['rev', 'bb', 'tot'] : ['tot']; }
/* nome curto da distribuidora — as três grandes unificadas pela raiz do nome */
function distribuidoraDe(agente) {
  const n = normU(agente);
  if (/^RAIZEN/.test(n)) return 'Raízen';
  if (/^IPIRANGA/.test(n)) return 'Ipiranga';
  if (/^VIBRA|^PETROBRAS DISTRIBUIDORA/.test(n)) return 'Vibra';
  const limpo = n.replace(/[^A-Z0-9 ]/g, ' ').replace(/\b(S ?A|SA|LTDA|EIRELI|ME|EPP|DISTRIBUIDORA|DISTRIBUIDOR|DISTRIBUICAO|DE|DO|DA|DOS|DAS|E|COMBUSTIVEIS|COMBUSTIVEL|PETROLEO|PRODUTOS|DERIVADOS|ENERGIA|COMERCIO|COMERCIAL|INDUSTRIA|CIA|COMPANHIA)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const partes = limpo.split(' ').filter(Boolean).slice(0, 2);
  /* siglas curtas ficam em maiúsculas (SIM, GP, ON); o resto em caixa alta inicial (Santa Lucia) */
  const curto = partes.map(w => w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase()).join(' ');
  return curto || n;
}
const UF_SUL = new Set(['RS', 'SC', 'PR']);
function escoposDe(uf, regiao) {
  const u = normU(uf), r = normU(regiao);
  const out = ['BR'];
  const ehRS = u === 'RS' || /RIO GRANDE DO SUL/.test(u);
  const ehSul = UF_SUL.has(u) || /PARANA|SANTA CATARINA|RIO GRANDE DO SUL/.test(u) || (/^SUL$|REGIAO SUL/.test(r) && !/SUDESTE/.test(r));
  if (ehSul) out.push('SUL');
  if (ehRS) out.push('RS');
  return out;
}

/* ---------- leitura ---------- */
async function le(arq, onLinha, onCab) {
  const enc = codificacao(arq);
  const rl = createInterface({ input: createReadStream(arq, { encoding: enc }), crlfDelay: Infinity });
  let cab = null, idx = null, n = 0;
  for await (const linha of rl) {
    if (!linha.trim()) continue;
    const c = split(linha.replace(/^﻿/, ''));
    if (!cab) { cab = c; idx = mapeia(cab); onCab(cab, idx, enc); continue; }
    n++;
    onLinha(c, idx);
  }
  return n;
}

if (inspeciona) {
  for (const arq of csvs) {
    const anos = {}, mercados = {}, produtos = {}, ufs = new Set(), agentes = {};
    let n = 0;
    await le(arq, (c, idx) => {
      n++;
      const a = c[idx.ano], m = c[idx.mes];
      anos[a] ||= {}; anos[a][m] = (anos[a][m] || 0) + 1;
      const mk = c[idx.mercado]; mercados[mk] = (mercados[mk] || 0) + 1;
      const pk = c[idx.produto]; produtos[pk] = (produtos[pk] || 0) + 1;
      ufs.add(c[idx.ufdest]);
      const ag = normU(c[idx.agente]); if (/RAIZEN|IPIRANGA|VIBRA|PETROBRAS/.test(ag)) agentes[ag] = (agentes[ag] || 0) + 1;
    }, (cab, idx, enc) => {
      console.log(`\n=== ${basename(arq)} · ${(statSync(arq).size / 1048576).toFixed(1)} MB · ${enc}`);
      console.log('cabeçalho:', JSON.stringify(cab));
      console.log('mapa:', JSON.stringify(idx));
    });
    console.log('linhas:', n);
    console.log('anos/meses (linhas):', JSON.stringify(anos));
    console.log('mercado destinatário:', JSON.stringify(mercados));
    console.log('produtos:', JSON.stringify(produtos));
    console.log('UFs destino:', [...ufs].sort().join(', '));
    console.log('agentes das três grandes:', JSON.stringify(agentes));
  }
  process.exit(0);
}

/* ---------- agregação ---------- */
/* chave: escopo|mes|seg|prod → Map(dist → vol) */
const cel = new Map();
const porMesAgente = new Map(); /* BR|mes → Set(agentes), para detectar mês parcial */
let lidas = 0, uteis = 0, ignoradasProd = 0, foraPeriodo = 0, semMapa = null;
const faltam = [];
for (const arq of csvs) {
  let pula = false;
  const n = await le(arq, (c, idx) => {
    if (pula) return;
    lidas++;
    const ano = String(c[idx.ano]).trim(), mes = String(c[idx.mes]).trim().padStart(2, '0');
    const ym = `${ano}-${mes}`;
    if (!/^\d{4}-\d{2}$/.test(ym) || ym < desde) { foraPeriodo++; return; }
    const prod = produtoDe(c[idx.produto]);
    if (!prod) { ignoradasProd++; return; }
    const v = num(c[idx.qtd]);
    if (!isFinite(v)) return;
    const seg = segmentoDe(c[idx.mercado]);
    const dist = distribuidoraDe(c[idx.agente]);
    const escopos = escoposDe(c[idx.ufdest], idx.regdest >= 0 ? c[idx.regdest] : '');
    uteis++;
    for (const e of escopos) {
      for (const s of segsDe(seg)) {
        for (const p of [prod, 'otto'].filter(p => p !== 'otto' || prod !== 'diesel')) {
          const k = `${e}|${ym}|${s}|${p}`;
          let m = cel.get(k); if (!m) { m = new Map(); cel.set(k, m); }
          m.set(dist, (m.get(dist) || 0) + v);
        }
      }
      if (e === 'BR') { let s = porMesAgente.get(ym); if (!s) { s = new Set(); porMesAgente.set(ym, s); } s.add(c[idx.agente]); }
    }
  }, (cab, idx, enc) => {
    const falt = Object.entries(idx).filter(([k, i]) => i < 0 && k !== 'descricao' && k !== 'regdest').map(([k]) => k);
    if (falt.length) { pula = true; faltam.push(`${basename(arq)}: colunas não encontradas → ${falt.join(', ')} · cabeçalho ${JSON.stringify(cab)}`); }
    console.log(`lendo ${basename(arq)} (${enc})${pula ? ' — PULADO (cabeçalho desconhecido)' : ''}`);
  });
  console.log(`  ${n} linhas`);
}
if (faltam.length) console.warn('AVISO:\n' + faltam.join('\n'));
if (!uteis) falha('nenhuma linha útil (período desde ' + desde + ').');

const meses = [...new Set([...cel.keys()].map(k => k.split('|')[1]))].sort();
const ESCOPOS = ['RS', 'SUL', 'BR'];
const r3 = x => Math.round(x * 1000) / 1000;

/* distribuidoras nomeadas por escopo: as maiores no segmento revendedor, somando o período */
const nomeadas = {};
for (const e of ESCOPOS) {
  const tot = new Map();
  for (const [k, m] of cel) { const [esc, , s, p] = k.split('|'); if (esc !== e || s !== 'rev' || p !== 'otto') continue; for (const [d, v] of m) tot.set(d, (tot.get(d) || 0) + v); }
  for (const [k, m] of cel) { const [esc, , s, p] = k.split('|'); if (esc !== e || s !== 'rev' || p !== 'diesel') continue; for (const [d, v] of m) tot.set(d, (tot.get(d) || 0) + v); }
  const ordem = [...tot.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const fixas = ['Raízen', 'Ipiranga', 'Vibra'];
  nomeadas[e] = [...new Set([...fixas, ...ordem])].slice(0, TOP);
}

const dados = {};
for (const e of ESCOPOS) {
  dados[e] = {};
  for (const ym of meses) {
    const mesObj = {};
    for (const s of SEGS) {
      const segObj = {};
      for (const p of ['otto', 'gasolina', 'etanol', 'diesel']) {
        const m = cel.get(`${e}|${ym}|${s}|${p}`) || new Map();
        const o = {}; let outras = 0, total = 0;
        for (const [d, v] of m) { total += v; if (nomeadas[e].includes(d)) o[d] = r3((o[d] || 0) + v); else outras += v; }
        for (const d of nomeadas[e]) if (!(d in o)) o[d] = 0;
        o.Outras = r3(outras); o.Total = r3(total);
        segObj[p] = o;
      }
      mesObj[s] = segObj;
    }
    dados[e][ym] = mesObj;
  }
}

/* mês parcial: a ANP lista o mês assim que a primeira distribuidora declara.
   Critério: total BR (tot/otto+diesel) abaixo de 70% da mediana dos 3 meses
   anteriores, ou menos de 60% das distribuidoras declarantes do mês anterior. */
function totalBR(ym) { const t = dados.BR[ym].tot; return t.otto.Total + t.diesel.Total; }
const status = {};
for (let i = 0; i < meses.length; i++) {
  const ym = meses[i];
  const ant = meses.slice(Math.max(0, i - 3), i);
  let parcial = false;
  if (ant.length) {
    const med = ant.map(totalBR).sort((a, b) => a - b)[Math.floor(ant.length / 2)];
    if (totalBR(ym) < 0.7 * med) parcial = true;
    const ag = porMesAgente.get(ym)?.size || 0, agAnt = porMesAgente.get(ant[ant.length - 1])?.size || 0;
    if (agAnt && ag < 0.6 * agAnt) parcial = true;
  }
  status[ym] = { parcial, distribuidoras: porMesAgente.get(ym)?.size || 0 };
}
const fechados = meses.filter(m => !status[m].parcial);

/* conferências */
const erros = [];
const perto = (a, b) => Math.abs(a - b) <= 0.01 + Math.abs(b) * 1e-6;
for (const e of ESCOPOS) for (const ym of meses) for (const s of SEGS) {
  const g = dados[e][ym][s];
  for (const p of ['otto', 'gasolina', 'etanol', 'diesel']) {
    const o = g[p]; const soma = Object.entries(o).filter(([k]) => k !== 'Total').reduce((a, [, v]) => a + v, 0);
    if (!perto(soma, o.Total)) erros.push(`${e} ${ym} ${s} ${p}: distribuidoras ${soma} ≠ total ${o.Total}`);
  }
  if (!perto(g.gasolina.Total + g.etanol.Total, g.otto.Total)) erros.push(`${e} ${ym} ${s}: gasolina + etanol ≠ otto`);
  if (s === 'rev') for (const p of ['otto', 'diesel']) {
    if (g[p].Total > dados[e][ym].tot[p].Total + 0.01) erros.push(`${e} ${ym} ${p}: revendedor > total`);
    if (!perto(dados[e][ym].band[p].Total + dados[e][ym].bb[p].Total, g[p].Total)) erros.push(`${e} ${ym} ${p}: bandeirado + bandeira branca ≠ revendedor`);
  }
}
for (const ym of meses) for (const p of ['otto', 'diesel']) {
  if (dados.RS[ym].rev[p].Total > dados.SUL[ym].rev[p].Total + 0.01 || dados.SUL[ym].rev[p].Total > dados.BR[ym].rev[p].Total + 0.01) erros.push(`${ym} ${p}: RS ⊄ SUL ⊄ BR`);
}
if (erros.length) { console.error('REPROVADO — nada gravado:'); erros.slice(0, 30).forEach(x => console.error(' - ' + x)); process.exit(2); }

const out = {
  v: 1,
  gerado_em: new Date().toISOString().slice(0, 16),
  fonte: 'ANP — Dados abertos: vendas de derivados de petróleo e biocombustíveis pelas distribuidoras (liquidos.zip)',
  unidade: 'mil m³',
  desde, meses, fechados, ultimo_fechado: fechados[fechados.length - 1] || null, status,
  segmentos: { rev: 'Posto revendedor (bandeirados + bandeira branca)', band: 'Postos bandeirados', bb: 'Postos bandeira branca', tot: 'Todos os segmentos (postos, TRR, consumidor final)' },
  produtos: { otto: 'Ciclo Otto (gasolina C + etanol hidratado)', gasolina: 'Gasolina C', etanol: 'Etanol hidratado', diesel: 'Óleo diesel B' },
  escopos: { RS: 'Rio Grande do Sul', SUL: 'Região Sul (RS, SC, PR)', BR: 'Brasil' },
  nomeadas,
  notas: ['Raízen soma todas as razões sociais que começam por RAIZEN (inclui Raízen Mime).', 'Vibra inclui a antiga Petrobras Distribuidora.', 'Um mês marcado parcial ainda está recebendo declarações das distribuidoras na ANP.'],
  dados
};
writeFileSync(saida, JSON.stringify(out));
console.log(`ok: ${saida} · ${lidas} linhas lidas · ${uteis} úteis · ${ignoradasProd} de outros produtos · ${foraPeriodo} antes de ${desde} · meses ${meses[0]} → ${meses[meses.length - 1]} · fechados até ${out.ultimo_fechado} · ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
