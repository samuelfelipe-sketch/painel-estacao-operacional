/* Agrega as compras de combustível (CSVs do Argo "Relatório de Compra de
   Combustíveis") para a revisão semanal da Negociação de Preços.

   Entrada: um ou mais CSVs como o conector Microsoft 365 devolve
   (`DD-MM-AAAA_RelatorioDeCompraDeCombustiveis.csv` da pasta
   Financeiro/Compras/Painel de Negociação), gravados FORA do repositório.
   Separador `;`, decimais com vírgula, colunas: Unidade;Razão Social;Entrada;
   Descrição;Nota(s);Quantidade;Preço Custo;Total Custo;Custo Efetivo;Total Efetivo.
   Cada CSV cobre uma janela móvel (~30 dias); passe vários para fechar um mês —
   as linhas repetidas são deduplicadas (unidade + data + produto + notas; o
   arquivo passado por último prevalece).

   Regras (pedido do Samuel): unidades 3 e 4 = Raízen, 5 = Ipiranga; ARLA e GNV
   ficam de fora; volume = Quantidade, gasto = Total Custo; preço médio = gasto ÷
   volume. VP (Raízen) e GA (Ipiranga) são a mesma família "aditivada" → GA.

   Uso:
     node scripts/negociacao-compras.mjs --csv <a.csv> [--csv <b.csv> ...] --saida <fora-do-repo>/compras.json

   Saída: JSON com cobertura (datas por unidade), e por mês e no ano: total,
   por bandeira, por produto, por unidade (vol, gasto, pm; e os produtos de cada unidade — usados pelo Market Share). O script confere que
   meses somam o ano e produtos somam o total; reprovou, não grava. Os logs
   dizem só datas e contagens. */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
const csvs = []; for (let i = 0; i < args.length; i++) if (args[i] === '--csv' && args[i + 1]) csvs.push(args[++i]);
function opt(nome, padrao) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; }
function falha(m) { console.error('ERRO: ' + m); process.exit(1); }
const saida = opt('saida'); if (!csvs.length || !saida) falha('uso: --csv <arquivo> [--csv ...] --saida <json fora do repositório>.');
if (resolve(saida).startsWith(resolve('.')) && !resolve(saida).startsWith('/tmp')) falha('--saida precisa apontar para fora do repositório.');

const BANDEIRA = { '3': 'Raízen', '4': 'Raízen', '5': 'Ipiranga' };
const EXCLUI = new Set(['ARL', 'GNV']);
const PRODUTO = { VP: 'GA' };
function num(s) {
  s = String(s).trim();
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?[\d.]*\d,\d+$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return NaN;
}

const linhas = new Map(); let lidas = 0, ignoradas = 0;
for (const arq of csvs) {
  const txt = readFileSync(arq, 'utf8').replace(/^﻿/, '');
  const ls = txt.split(/\r?\n/).filter(l => l.trim());
  for (const l of ls.slice(1)) {
    const c = l.split(';');
    if (c.length !== 10) { ignoradas++; continue; }
    const uni = c[0].trim(), data = c[2].trim(), desc = c[3].trim(), notas = c[4].trim();
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data);
    if (!m || !BANDEIRA[uni]) { ignoradas++; continue; }
    const cod0 = desc.split(/[\s-]+/)[0].toUpperCase();
    lidas++;
    if (EXCLUI.has(cod0)) continue;
    const vol = num(c[5]), gasto = num(c[7]);
    if (!isFinite(vol) || !isFinite(gasto)) falha(`número ilegível em ${arq}: unidade ${uni}, ${data}, ${desc}.`);
    linhas.set(`${uni}|${data}|${desc}|${notas}`, { uni, bandeira: BANDEIRA[uni], mes: `${m[3]}-${m[2]}`, data: `${m[3]}-${m[2]}-${m[1]}`, prod: PRODUTO[cod0] || cod0, vol, gasto });
  }
}
if (!linhas.size) falha('nenhuma linha de compra reconhecida.');

const r6 = x => Math.round(x * 1e6) / 1e6;
function novo() { return { vol: 0, gasto: 0 }; }
function soma(a, l) { a.vol += l.vol; a.gasto += l.gasto; }
function fecha(a) { a.vol = r6(a.vol); a.gasto = r6(a.gasto); a.pm = a.vol ? r6(a.gasto / a.vol) : null; return a; }
function agrupa(ls) {
  const g = { total: novo(), bandeiras: {}, produtos: {}, unidades: {} };
  for (const l of ls) {
    soma(g.total, l);
    (g.bandeiras[l.bandeira] ||= { ...novo(), produtos: {} }); soma(g.bandeiras[l.bandeira], l);
    (g.bandeiras[l.bandeira].produtos[l.prod] ||= novo()); soma(g.bandeiras[l.bandeira].produtos[l.prod], l);
    (g.produtos[l.prod] ||= novo()); soma(g.produtos[l.prod], l);
    (g.unidades[l.uni] ||= { ...novo(), produtos: {} }); soma(g.unidades[l.uni], l);
    (g.unidades[l.uni].produtos[l.prod] ||= novo()); soma(g.unidades[l.uni].produtos[l.prod], l);
  }
  fecha(g.total);
  for (const b of Object.values(g.bandeiras)) { fecha(b); for (const p of Object.values(b.produtos)) fecha(p); }
  for (const p of Object.values(g.produtos)) fecha(p);
  for (const u of Object.values(g.unidades)) { fecha(u); for (const p of Object.values(u.produtos)) fecha(p); }
  return g;
}

const todas = [...linhas.values()];
const meses = {};
for (const l of todas) (meses[l.mes] ||= []).push(l);
const out = { gerado_em: new Date().toISOString().slice(0, 10), arquivos: csvs.length, linhas: todas.length, cobertura: {}, meses: {}, ano: {} };
for (const u of Object.keys(BANDEIRA)) {
  const ds = todas.filter(l => l.uni === u).map(l => l.data).sort();
  out.cobertura[u] = ds.length ? { de: ds[0], ate: ds[ds.length - 1], linhas: ds.length } : null;
}
for (const m of Object.keys(meses).sort()) out.meses[m] = agrupa(meses[m]);
const anos = [...new Set(todas.map(l => l.mes.slice(0, 4)))].sort();
for (const a of anos) out.ano[a] = agrupa(todas.filter(l => l.mes.startsWith(a)));

/* conferências */
const erros = [];
const perto = (x, y) => Math.abs(x - y) <= 0.5;
for (const a of anos) {
  const ms = Object.keys(out.meses).filter(m => m.startsWith(a));
  if (!perto(ms.reduce((s, m) => s + out.meses[m].total.vol, 0), out.ano[a].total.vol) || !perto(ms.reduce((s, m) => s + out.meses[m].total.gasto, 0), out.ano[a].total.gasto)) erros.push(`${a}: meses ≠ ano`);
  const ps = Object.values(out.ano[a].produtos);
  if (!perto(ps.reduce((s, p) => s + p.vol, 0), out.ano[a].total.vol) || !perto(ps.reduce((s, p) => s + p.gasto, 0), out.ano[a].total.gasto)) erros.push(`${a}: produtos ≠ total`);
  const bs = Object.values(out.ano[a].bandeiras);
  if (!perto(bs.reduce((s, b) => s + b.gasto, 0), out.ano[a].total.gasto)) erros.push(`${a}: bandeiras ≠ total`);
}
for (const m of Object.keys(out.meses)) { const g = out.meses[m]; if (!perto(Object.values(g.unidades).reduce((s, u) => s + u.gasto, 0), g.total.gasto)) erros.push(`${m}: unidades ≠ total`); }
if (erros.length) { console.error('REPROVADO — nada gravado:'); for (const e of erros) console.error(' - ' + e); process.exit(2); }

writeFileSync(saida, JSON.stringify(out, null, 1));
const cob = Object.entries(out.cobertura).map(([u, c]) => `${u}: ${c ? c.de + ' → ' + c.ate : 'sem linhas'}`).join(' · ');
console.log(`ok: ${saida} · ${csvs.length} arquivo(s) · ${lidas} linhas lidas, ${todas.length} úteis após deduplicar/excluir ARLA e GNV, ${ignoradas} ignoradas · meses ${Object.keys(out.meses).join(', ')} · cobertura ${cob}`);
