/* Agrega as vendas anuais por município da ANP (gasolina C, etanol hidratado,
   óleo diesel) para a região de atuação do Sapatão. Dados públicos.

   Entrada: pasta com os CSVs baixados pelo workflow mercado-municipios.yml
   (um arquivo por produto; o produto vem do nome do arquivo) e a lista de
   municípios por unidade (mercado/regiao-municipios.json).
   Saída: mercado/regiao.json = por ano: total do RS e de cada município da
   região, por produto, em m³.

   Uso: node scripts/mercado-municipios.mjs --pasta /tmp/mun --regiao mercado/regiao-municipios.json --saida mercado/regiao.json */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const falha = m => { console.error('ERRO: ' + m); process.exit(1); };
const pasta = opt('pasta'), saida = opt('saida'), regArq = opt('regiao');
if (!pasta || !saida || !regArq) falha('uso: --pasta <csvs> --regiao <json> --saida <json>');
const REG = JSON.parse(readFileSync(regArq, 'utf8'));
const UF = REG.uf || 'RS';
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
const alvo = new Set(Object.values(REG.unidades).flat().map(norm));

function texto(f) { const b = readFileSync(f); const u = b.toString('utf8'); return u.includes('�') ? b.toString('latin1') : u; }
function produtoDe(nome) { const n = norm(nome); return /GASOLINA/.test(n) ? 'gasolina' : /ETANOL/.test(n) ? 'etanol' : /DIESEL/.test(n) ? 'diesel' : null; }
function num(s) { s = String(s).trim().replace(/"/g, ''); if (!s) return 0; if (/,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, ''); const v = parseFloat(s); return isFinite(v) ? v : NaN; }

const out = { v: 1, gerado_em: new Date().toISOString().slice(0, 16), fonte: 'ANP — vendas anuais de gasolina C, etanol hidratado e óleo diesel por município (dados abertos)', unidade: 'm3', uf: UF, unidades: REG.unidades, rs: {}, municipios: {} };
const arqs = readdirSync(pasta).filter(f => /\.csv$/i.test(f) && produtoDe(f));
if (!arqs.length) falha('nenhum CSV de gasolina/etanol/diesel na pasta.');
const vistos = {};
for (const f of arqs) {
  const prod = produtoDe(f), linhas = texto(join(pasta, f)).split(/\r?\n/).filter(l => l.trim());
  const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';
  const cab = linhas[0].split(sep).map(norm);
  const iAno = cab.findIndex(c => /^ANO/.test(c)), iUF = cab.findIndex(c => c === 'UF' || /^SIGLA/.test(c) || /ESTADO/.test(c)), iMun = cab.findIndex(c => /MUNICIPIO/.test(c) && !/CODIGO/.test(c)), iV = cab.findIndex(c => /VENDAS|VOLUME/.test(c));
  console.log(`${f}: produto ${prod} · sep "${sep}" · colunas ${cab.join(' | ')}`);
  if ([iAno, iUF, iMun, iV].some(i => i < 0)) falha(`colunas não reconhecidas em ${f}`);
  let n = 0;
  for (const l of linhas.slice(1)) {
    const c = l.split(sep); if (c.length < cab.length) continue;
    if (norm(c[iUF]) !== UF && norm(c[iUF]) !== 'RIO GRANDE DO SUL') continue;
    const ano = String(c[iAno]).replace(/\D/g, ''); const v = num(c[iV]); if (!/^\d{4}$/.test(ano) || !isFinite(v)) continue;
    const mun = norm(c[iMun]); n++;
    (out.rs[ano] ||= {})[prod] = ((out.rs[ano] || {})[prod] || 0) + v;
    if (alvo.has(mun)) { ((out.municipios[mun] ||= {})[ano] ||= {})[prod] = (out.municipios[mun][ano][prod] || 0) + v; vistos[mun] = 1; }
  }
  console.log(`  ${n} linhas do ${UF}`);
}
const faltam = [...alvo].filter(m => !vistos[m]);
if (faltam.length) falha('municípios não achados na base: ' + faltam.join(', '));
/* unidade: o RS vende alguns milhões de m³ de gasolina por ano; acima de 1e8 é litro */
const anos = Object.keys(out.rs).sort(); const ult = anos[anos.length - 1];
const escala = (out.rs[ult].gasolina || out.rs[ult].diesel || 0) > 1e8 ? 1 / 1000 : 1;
if (escala !== 1) { console.log('valores em litros: convertendo para m³'); for (const a of anos) for (const p in out.rs[a]) out.rs[a][p] *= escala; for (const m in out.municipios) for (const a in out.municipios[m]) for (const p in out.municipios[m][a]) out.municipios[m][a][p] *= escala; }
const arred = o => { for (const k in o) { if (typeof o[k] === 'object') arred(o[k]); else o[k] = Math.round(o[k] * 1000) / 1000; } };
arred(out.rs); arred(out.municipios);
out.anos = anos; out.ultimo_ano = ult;
/* conferência: região ⊂ RS em todos os anos e produtos */
for (const a of anos) for (const p of ['gasolina', 'etanol', 'diesel']) { const r = Object.values(out.municipios).reduce((s, m) => s + ((m[a] || {})[p] || 0), 0); if (r > (out.rs[a][p] || 0) + 1) falha(`região maior que o RS em ${a} ${p}`); }
if (existsSync(saida)) { try { const v = JSON.parse(readFileSync(saida, 'utf8')); const s = o => JSON.stringify({ ...o, gerado_em: null }); if (s(v) === s(out)) { console.log('sem mudança'); process.exit(0); } } catch (e) {} }
writeFileSync(saida, JSON.stringify(out));
console.log(`ok: ${saida} · anos ${anos[0]}–${ult} · ${Object.keys(out.municipios).length} municípios da região`);
for (const m of Object.keys(out.municipios).sort()) console.log(`  ${m}: ${ult} gasolina ${Math.round((out.municipios[m][ult] || {}).gasolina || 0)} · etanol ${Math.round((out.municipios[m][ult] || {}).etanol || 0)} · diesel ${Math.round((out.municipios[m][ult] || {}).diesel || 0)} m³`);
