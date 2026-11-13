/* Postos concorrentes no raio de cada unidade do Sapatão (dados públicos).

   Entrada: cadastro de revendedores varejistas da ANP (CSV `;`, latin1:
   CODIGOISIMP;AUTORIZACAO;DATAPUBLICACAO;RAZAOSOCIAL;CNPJ;ENDERECO;COMPLEMENTO;
   BAIRRO;CEP;UF;MUNICIPIO;BANDEIRA;DATAVINCULACAO) e mercado/regiao-raio.json
   (CNPJ e raio de cada unidade, municípios candidatos).
   Coordenadas: OpenStreetMap (Nominatim), pelo endereço; se não achar, pelo CEP;
   se não, pela rua na cidade. Cache em mercado/postos-geo.json (só geocodifica o
   que é novo ou mudou de endereço, 1 consulta por segundo, como pede o Nominatim).
   Saída: mercado/postos-raio.json — total de postos do RS (e por bandeira) e,
   por unidade, os postos no raio com bandeira, distância e precisão da coordenada;
   histórico das contagens para ver posto que abre ou fecha.

   Uso: node scripts/mercado-postos.mjs --cadastro <csv> --config mercado/regiao-raio.json \
          --cache mercado/postos-geo.json --saida mercado/postos-raio.json [--max-geo 600] */
import { readFileSync, writeFileSync, existsSync } from 'fs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const falha = m => { console.error('ERRO: ' + m); process.exit(1); };
const CAD = opt('cadastro'), CFG = JSON.parse(readFileSync(opt('config'), 'utf8')), CACHE = opt('cache'), SAIDA = opt('saida');
const MAXGEO = +opt('max-geo', 600);
if (!CAD || !CACHE || !SAIDA) falha('uso: --cadastro --config --cache --saida');
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const UA = 'painel-estacao-operacional/1.0 (github.com/samuelfelipe-sketch/painel-estacao-operacional)';

/* ---- cadastro ---- */
const buf = readFileSync(CAD); let txt = buf.toString('utf8'); if (txt.includes('�')) txt = buf.toString('latin1');
const linhas = txt.split(/\r?\n/).filter(l => l.trim());
const cab = linhas[0].split(';').map(norm), ix = n => cab.indexOf(n);
for (const c of ['CNPJ', 'RAZAOSOCIAL', 'ENDERECO', 'BAIRRO', 'CEP', 'UF', 'MUNICIPIO', 'BANDEIRA']) if (ix(c) < 0) falha('coluna ausente no cadastro: ' + c);
const postos = linhas.slice(1).map(l => l.split(';')).filter(c => c.length >= cab.length).map(c => ({
  cnpj: c[ix('CNPJ')].replace(/\D/g, ''), nome: c[ix('RAZAOSOCIAL')].trim(), end: c[ix('ENDERECO')].replace(/\s+/g, ' ').trim(),
  bairro: c[ix('BAIRRO')].trim(), cep: c[ix('CEP')].replace(/\D/g, ''), uf: norm(c[ix('UF')]), mun: norm(c[ix('MUNICIPIO')]), bandeira: c[ix('BANDEIRA')].trim()
}));
const rs = postos.filter(p => p.uf === CFG.uf);
const porBand = {}; rs.forEach(p => { porBand[p.bandeira] = (porBand[p.bandeira] || 0) + 1; });
const cand = new Set(CFG.municipios_candidatos.map(norm));
const alvo = rs.filter(p => cand.has(p.mun));
for (const u of Object.values(CFG.unidades)) if (!rs.some(p => p.cnpj === u.cnpj)) falha('unidade não achada no cadastro: ' + u.cnpj);
console.log(`cadastro: ${postos.length} postos · ${rs.length} no ${CFG.uf} · ${alvo.length} nos municípios candidatos`);

/* ---- coordenadas ---- */
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const chave = p => `${p.end}|${p.mun}|${p.cep}`;
const dorme = ms => new Promise(r => setTimeout(r, ms));
let consultas = 0;
async function nomi(params) {
  if (consultas >= MAXGEO) return null;
  consultas++; await dorme(1100);
  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br', ...params });
  for (let t = 0; t < 3; t++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' } }); if (r.ok) { const j = await r.json(); return j[0] ? { lat: +j[0].lat, lon: +j[0].lon } : null; } }
    catch (e) {}
    await dorme(3000 * (t + 1));
  }
  return null;
}
function partes(end) { const m = /^(.*?),\s*(\S+)/.exec(end); return m ? { rua: m[1].trim(), num: /^\d+$/.test(m[2]) ? m[2] : '' } : { rua: end, num: '' }; }
async function geo(p) {
  const c = cache[p.cnpj]; if (c && c.chave === chave(p)) return c;
  const { rua, num } = partes(p.end), cidade = p.mun, cepF = p.cep.length === 8 ? p.cep.slice(0, 5) + '-' + p.cep.slice(5) : '';
  let r = null, prec = '';
  if (num) { r = await nomi({ street: `${num} ${rua}`, city: cidade, state: 'Rio Grande do Sul' }); prec = 'endereco'; }
  if (!r && cepF) { r = await nomi({ postalcode: cepF, country: 'Brasil' }); prec = 'cep'; }
  if (!r) { r = await nomi({ street: rua, city: cidade, state: 'Rio Grande do Sul' }); prec = 'rua'; }
  if (!r && p.bairro) { r = await nomi({ q: `${p.bairro}, ${cidade}, Rio Grande do Sul` }); prec = 'bairro'; }
  if (!r) return null;
  return (cache[p.cnpj] = { chave: chave(p), lat: +r.lat.toFixed(6), lon: +r.lon.toFixed(6), prec });
}
const R = 6371, rad = x => x * Math.PI / 180;
const dist = (a, b) => { const dLa = rad(b.lat - a.lat), dLo = rad(b.lon - a.lon); const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const naBR = (p, nome) => norm(p.end).replace(/[^A-Z0-9]/g, '').includes(norm(nome).replace(/[^A-Z0-9]/g, ''));

let semGeo = 0;
for (const p of alvo) { const g = await geo(p); if (!g) semGeo++; }
writeFileSync(CACHE, JSON.stringify(cache));
console.log(`coordenadas: ${consultas} consultas novas · sem coordenada: ${semGeo}`);

/* ---- ponto exato: postos mapeados no OpenStreetMap (amenity=fuel) ----
   O endereço quase nunca acha o número no Brasil e cai no meio da rua. Cada posto
   da ANP é casado com o posto do OSM mais parecido (número + rua, nome, bandeira)
   perto da coordenada aproximada; casou, vale a coordenada do OSM (prec 'osm'). */
const STOP = new Set('POSTO POSTOS COMBUSTIVEIS COMBUSTIVEL COMERCIO COMERCIAL DE DO DA DOS DAS E LTDA EIRELI ME EPP SA S A DERIVADOS PETROLEO ABASTECEDORA AUTO REDE SERVICO SERVICOS LUBRIFICANTES CONVENIENCIA'.split(' '));
const toks = s => norm(s).replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter(t => t.length > 1 && !STOP.has(t));
const MARCA = { RAIZEN: /SHELL|RAIZEN/, VIBRA: /PETROBRAS|VIBRA|\bBR\b/, IPIRANGA: /IPIRANGA/, RODOIL: /RODOIL/, CHARRUA: /CHARRUA/, STANG: /STANG/, MAXSUL: /MAXSUL/, SIM: /\bSIM\b/ };
let osm = [];
try {
  const q = '[out:json][timeout:90];nwr["amenity"="fuel"](-29.95,-51.45,-29.45,-50.85);out center tags;';
  for (const host of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try { const r = await fetch(host, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) }); if (r.ok) { osm = (await r.json()).elements || []; break; } } catch (e) {}
  }
} catch (e) {}
osm = osm.map(e => ({ id: e.type + '/' + e.id, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, t: e.tags || {} })).filter(e => e.lat != null);
console.log(`OSM: ${osm.length} postos mapeados na área`);
const usado = new Set(); const pares = [];
for (const p of alvo) {
  const g = cache[p.cnpj]; if (!g) continue;
  const { rua, num } = partes(p.end), tRua = toks(rua), tNome = toks(p.nome), marca = MARCA[norm(p.bandeira)];
  const longe = /RODOVIA|BR-?\d|RS-?\d|ERS|ESTRADA/i.test(rua) ? 8 : 4;
  for (const o of osm) {
    const d = dist(g, o); if (d > longe) continue;
    const oNome = norm([o.t.name, o.t.brand, o.t.operator].filter(Boolean).join(' ')), oRua = toks(o.t['addr:street'] || ''), oNum = String(o.t['addr:housenumber'] || '').replace(/\D/g, '');
    let sc = 0;
    if (num && oNum && num === oNum && oRua.some(t => tRua.includes(t))) sc += 6;
    const nomeComum = tNome.filter(t => t.length > 2 && oNome.includes(t));
    if (nomeComum.length) sc += 3 + Math.min(nomeComum.length, 2);
    if (marca && marca.test(oNome)) sc += 2;
    if (oRua.some(t => tRua.includes(t))) sc += 1;
    sc -= d / 4;
    if (sc >= 3) pares.push({ p, o, sc });
  }
}
pares.sort((a, b) => b.sc - a.sc);
const casou = new Set();
for (const { p, o } of pares) {
  if (casou.has(p.cnpj) || usado.has(o.id)) continue;
  casou.add(p.cnpj); usado.add(o.id);
  cache[p.cnpj] = { ...cache[p.cnpj], lat: +o.lat.toFixed(6), lon: +o.lon.toFixed(6), prec: 'osm', osm: o.id };
}
/* quem não casou fica com a coordenada do endereço (aproximada) */
for (const p of alvo) if (cache[p.cnpj] && !casou.has(p.cnpj) && cache[p.cnpj].prec === 'osm') cache[p.cnpj].prec = 'aprox';
writeFileSync(CACHE, JSON.stringify(cache));
console.log(`casados com o OSM: ${casou.size} de ${alvo.filter(p => cache[p.cnpj]).length} · postos do OSM sem par na ANP: ${osm.length - usado.size}`);

/* ---- raio de cada unidade ---- */
const ant = existsSync(SAIDA) ? JSON.parse(readFileSync(SAIDA, 'utf8')) : null;
const out = { v: 1, gerado_em: new Date().toISOString().slice(0, 16), fonte: 'ANP — dados cadastrais dos revendedores varejistas; coordenadas: OpenStreetMap (Nominatim)', uf: CFG.uf, rs_postos: rs.length, rs_bandeiras: porBand, unidades: {}, historico: (ant && ant.historico) || {} };
const hoje = out.gerado_em.slice(0, 10), contagem = {};
for (const [cod, u] of Object.entries(CFG.unidades)) {
  const eu = rs.find(p => p.cnpj === u.cnpj), ge = cache[eu.cnpj];
  if (!ge) falha(`sem coordenada para a unidade ${cod}`);
  const lista = [];
  for (const p of alvo) {
    const g = cache[p.cnpj]; if (!g || p.cnpj === u.cnpj) continue;
    const d = dist(ge, g), br = u.rodovia && naBR(p, u.rodovia.nome) && d <= u.rodovia.raio_km;
    if (d <= u.raio_km || br) lista.push({ cnpj: p.cnpj, nome: p.nome, bandeira: p.bandeira, municipio: p.mun, bairro: p.bairro, km: +d.toFixed(2), prec: g.prec, ...(br ? { rodovia: true } : {}) });
  }
  lista.sort((a, b) => a.km - b.km);
  const resumo = {}; lista.forEach(p => { resumo[p.bandeira] = (resumo[p.bandeira] || 0) + 1; });
  out.unidades[cod] = { nome: eu.nome, endereco: `${eu.end} · ${eu.bairro} · ${eu.mun}`, bandeira: eu.bandeira, lat: ge.lat, lon: ge.lon, prec: ge.prec, raio_km: u.raio_km, rodovia: u.rodovia || null, concorrentes: lista.length, por_bandeira: resumo, postos: lista };
  contagem[cod] = lista.length;
  console.log(`unidade ${cod}: coordenada por ${ge.prec} · ${lista.length} concorrentes (${lista.filter(p => p.rodovia).length} pela rodovia) · precisão: ${['osm', 'endereco', 'cep', 'rua', 'bairro', 'aprox'].map(k => k + ' ' + lista.filter(p => p.prec === k).length).join(', ')}`);
}
const ultimo = Object.keys(out.historico).sort().pop();
if (!ultimo || JSON.stringify(out.historico[ultimo]) !== JSON.stringify(contagem)) out.historico[hoje] = contagem;
if (ant) { const s = o => JSON.stringify({ ...o, gerado_em: null }); if (s(ant) === s(out)) { console.log('sem mudança'); process.exit(0); } }
writeFileSync(SAIDA, JSON.stringify(out));
console.log('ok: ' + SAIDA);
