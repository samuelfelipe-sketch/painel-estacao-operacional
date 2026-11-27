/* Market Share — vendas diárias de combustíveis no RS (ANP, painel dinâmico "Volume de Vendas RS").
   Lê o CSV baixado do painel (Data;"Combustivel";Qtd Litros, em litros, vírgula decimal) e grava
   mercado/anp-diario.json: { v, fonte, gerado_em, desde, ultimo, dias:{ 'AAAA-MM-DD':[otto_m3, diesel_m3] } }.
   Otto = ETANOL + GASOLINA C; diesel = S10 + S500. Dado público (não cifrado).
   Uso: node scripts/mercado-anp-diario.mjs --csv <arquivo.csv> [--desde 2024-01-01] */
import { readFileSync, writeFileSync, existsSync } from 'fs';
const args = process.argv.slice(2), opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const csv = opt('csv'), desde = opt('desde') || '2020-01-01';
if (!csv) { console.error('uso: --csv <arquivo>'); process.exit(1); }
const dia = {};
let lidas = 0;
for (const l of readFileSync(csv, 'utf8').split(/\r?\n/).slice(1)) {
  const c = l.split(';'); if (c.length < 3) continue;
  const d = c[0].trim(), p = c[1].replace(/"/g, '').trim(), q = parseFloat(c[2].replace(',', '.'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !isFinite(q)) continue;
  const i = /^(ETANOL|GASOLINA C)$/.test(p) ? 0 : /^OLEO DIESEL S(10|500)$/.test(p) ? 1 : -1;
  if (i < 0) continue;
  lidas++; if (d < desde) continue;
  (dia[d] = dia[d] || [0, 0])[i] += q / 1000;
}
const ds = Object.keys(dia).sort();
if (!ds.length) { console.error('nenhum dia lido'); process.exit(2); }
const out = { v: 1, fonte: 'ANP — Painel Dinâmico de Preços, dados abertos "Volume de Vendas RS" (vendas diárias no RS)', unidade: 'm3', colunas: ['otto', 'diesel'], gerado_em: new Date().toISOString().slice(0, 16), desde, ultimo: ds[ds.length - 1], dias: Object.fromEntries(ds.map(d => [d, [Math.round(dia[d][0] * 10) / 10, Math.round(dia[d][1] * 10) / 10]])) };
const alvo = new URL('../mercado/anp-diario.json', import.meta.url);
/* nada novo: não mexe no arquivo (assim a rotina diária só commita quando há dia novo ou correção) */
if (existsSync(alvo)) { try { const ant = JSON.parse(readFileSync(alvo, 'utf8')); if (JSON.stringify(ant.dias) === JSON.stringify(out.dias)) { console.log(`sem mudança: ${ds.length} dias até ${out.ultimo}`); process.exit(0); } } catch (e) {} }
writeFileSync(alvo, JSON.stringify(out) + '\n');
console.log(`ok: ${ds.length} dias de ${ds[0]} a ${out.ultimo} (${lidas} linhas lidas)`);
