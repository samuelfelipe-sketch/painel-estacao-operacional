/* Market Share — volumes do Sapatão (compras às distribuidoras), CIFRADOS em
   mercado/sapatao.enc.json com a chave dos dados (SAPATAO_DEK), no mesmo
   formato {enc:1,iv,ct} que o navegador abre com window.sapataoCofre.

   A comparação com a ANP é compra do posto = venda da distribuidora ao
   posto revendedor; por isso a fonte é o relatório de compras do Argo,
   agregado por scripts/negociacao-compras.mjs (compras.json), e não a venda
   na pista. Unidades 3 e 4 = Raízen, 5 = Ipiranga (regra do compras.json).

   Conteúdo (em claro só dentro do cifrado):
     { v:1, atualizado_em, unidade:'m3', postos:{Raízen:2, Ipiranga:1},
       unidades:{ '3':{nome:'SF',bandeira:'Raízen'}, '4':{nome:'PS',bandeira:'Raízen'}, '5':{nome:'AS',bandeira:'Ipiranga'} },  (SF = SF Comércio, PS = Posto Sapatão, AS = Auto Posto Safyr)
       meses:{ 'AAAA-MM': { fonte:'csv'|'manual', parcial:bool, cobertura:{de,ate}|null,
                            band:{ 'Raízen':{otto,gasolina,etanol,diesel}, 'Ipiranga':{...} },
                            unid:{ '3':{otto,gasolina,etanol,diesel}, '4':{...}, '5':{...} } } } }
   (`unid` só existe quando a fonte traz a abertura por unidade; o painel usa `band` quando falta)
   carteiras:{ 'Raízen':{gerente:'GV', fracao, escopo}, ... } = fatia da bandeira no recorte que fica na carteira do
   Gerente de Vendas (GV) da bandeira (fracao 0–1; vazia = ainda a definir). O painel mostra participação ÷ fracao.
   Só o cargo, nunca o nome da pessoa.
   Volumes em m³ (o compras.json vem em litros; a ANP publica mil m³ — o
   painel converte na tela).

   Uso:
     node scripts/mercado-sapatao.mjs grava --compras <compras.json> [--desde AAAA-MM] [--periodo AAAA-MM-DD:AAAA-MM-DD] [--manual <meses.json>] [--unidades '3=SF:Raízen,4=PS:Raízen,5=AS:Ipiranga'] [--carteiras 'Raízen=GV:0.5:RS,Ipiranga=GV:0.5:RS'] [--saida mercado/sapatao.enc.json]
       → funde os meses do compras.json (e do manual) no arquivo publicado; meses já gravados
         só são trocados quando a leitura nova cobre o mês inteiro (ou com --forca)
     node scripts/mercado-sapatao.mjs abre --para <pasta fora do repo> [--entrada mercado/sapatao.enc.json]
       → grava <pasta>/sapatao-mercado.json decifrado, para conferência

   Formato do --manual (litros, por mês; chave = código da unidade (3, 4, 5) ou nome da bandeira;
   produtos GC, GA, ET, S10, S500 ou já otto/diesel):
     { "2025-01": { "3": { "GC": 300000, "GA": 50000, "S10": 200000, "S500": 100000 },
                    "4": { "GC": 500000, "GA": 150000, "ET": 30000, "S10": 600000, "S500": 200000 },
                    "5": { "otto": 120000, "diesel": 40000 } }, ... }

   Logs: só meses, contagens e "ok" — nenhum volume. */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { resolve, join } from 'path';
import { confereKid } from './chave-id.mjs';

const args = process.argv.slice(2);
const modo = args[0];
function opt(nome, padrao) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao; }
const flag = nome => args.includes('--' + nome);
function falha(m) { console.error('ERRO: ' + m); process.exit(1); }

function chave() {
  const b = (process.env.SAPATAO_DEK || '').trim();
  if (!b) falha('SAPATAO_DEK não está no ambiente.');
  let k; try { k = Buffer.from(b, 'base64'); } catch (e) { k = Buffer.alloc(0); }
  if (k.length !== 32) falha('SAPATAO_DEK não tem o formato esperado (base64 de 32 bytes).');
  confereKid(k, falha);
  return k;
}
function cifra(obj, k) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final(), c.getAuthTag()]);
  return { enc: 1, iv: iv.toString('base64'), ct: ct.toString('base64') };
}
function decifra(doc, k) {
  if (!doc || doc.enc !== 1) falha('o arquivo não está no formato cifrado esperado.');
  const ct = Buffer.from(doc.ct, 'base64'), iv = Buffer.from(doc.iv, 'base64');
  const d = createDecipheriv('aes-256-gcm', k, iv);
  d.setAuthTag(ct.subarray(ct.length - 16));
  let pt;
  try { pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]); }
  catch (e) { falha('a chave dos dados não abre o arquivo (chave trocada?).'); }
  return JSON.parse(pt.toString('utf8'));
}

/* produto do Argo → família do painel */
const FAMILIA = { GC: 'gasolina', GA: 'gasolina', VP: 'gasolina', ET: 'etanol', DS: 'diesel', DC: 'diesel', S10: 'diesel', S500: 'diesel', GASOLINA: 'gasolina', ETANOL: 'etanol', DIESEL: 'diesel' };
const r3 = x => Math.round(x * 1000) / 1000;
function vazio() { return { otto: 0, gasolina: 0, etanol: 0, diesel: 0 }; }
function somaProduto(acc, cod, litros) {
  const c = String(cod).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c === 'OTTO') { acc.otto += litros / 1000; return true; }
  const fam = FAMILIA[c];
  if (!fam) return false;
  acc[fam] += litros / 1000;
  if (fam !== 'diesel') acc.otto += litros / 1000;
  return true;
}
function fecha(acc) { for (const k of Object.keys(acc)) acc[k] = r3(acc[k]); return acc; }
function ultimoDia(ym) { const [a, m] = ym.split('-').map(Number); return new Date(a, m, 0).getDate(); }

if (modo === 'abre') {
  const para = opt('para'); if (!para) falha('informe --para <pasta fora do repositório>.');
  if (resolve(para).startsWith(resolve('.')) && !resolve(para).startsWith('/tmp')) falha('--para precisa apontar para fora do repositório.');
  const entrada = resolve(opt('entrada', 'mercado/sapatao.enc.json'));
  if (!existsSync(entrada)) falha('não existe ' + entrada);
  const ab = decifra(JSON.parse(readFileSync(entrada, 'utf8')), chave());
  mkdirSync(para, { recursive: true });
  const alvo = join(para, 'sapatao-mercado.json');
  writeFileSync(alvo, JSON.stringify(ab, null, 1));
  console.log(`aberto: ${alvo} · ${Object.keys(ab.meses || {}).length} meses · atualizado em ${ab.atualizado_em || '?'}`);
  process.exit(0);
}
if (modo !== 'grava') falha('modo desconhecido — use "grava" ou "abre".');

const saida = resolve(opt('saida', 'mercado/sapatao.enc.json'));
const k = chave();
let atual = { v: 1, unidade: 'm3', meses: {} };
if (existsSync(saida)) { atual = decifra(JSON.parse(readFileSync(saida, 'utf8')), k); atual.meses ||= {}; }
/* unidades da rede: código do Argo → nome curto e bandeira (regra do negociacao-compras: 3 e 4 Raízen, 5 Ipiranga) */
let UNIDADES = atual.unidades || { '3': { nome: 'SF', bandeira: 'Raízen' }, '4': { nome: 'PS', bandeira: 'Raízen' }, '5': { nome: 'AS', bandeira: 'Ipiranga' } };
const unArg = opt('unidades');
if (unArg) { UNIDADES = {}; for (const par of unArg.split(',')) { const m = /^\s*(\w+)\s*=\s*([^:]+):(.+)$/.exec(par); if (!m) falha('--unidades: use codigo=Nome:Bandeira,...'); UNIDADES[m[1]] = { nome: m[2].trim(), bandeira: m[3].trim() }; } }
atual.unidades = UNIDADES;
atual.postos = {}; for (const u of Object.values(UNIDADES)) atual.postos[u.bandeira] = (atual.postos[u.bandeira] || 0) + 1;
const cartArg = opt('carteiras');
if (cartArg) {
  atual.carteiras = {};
  for (const par of cartArg.split(',')) {
    const m = /^\s*([^=]+)=([^:]*):([^:]*):?(\w*)\s*$/.exec(par); if (!m) falha("--carteiras: use 'Bandeira=Gerente:fracao:ESCOPO,...' (fracao 0–1 ou vazia).");
    const fr = m[3].trim() === '' ? null : parseFloat(m[3]);
    if (fr != null && !(fr > 0 && fr <= 1)) falha('--carteiras: fração fora de 0–1 em ' + m[1]);
    atual.carteiras[m[1].trim()] = { gerente: m[2].trim(), fracao: fr, escopo: m[4] || 'RS' };
  }
}
function bandDeUnid(unid) { const band = {}; for (const [u, v] of Object.entries(unid)) { const b = (UNIDADES[u] || {}).bandeira || 'Outra'; band[b] ||= vazio(); for (const k of Object.keys(v)) band[b][k] += v[k]; } for (const b of Object.keys(band)) fecha(band[b]); return band; }

const desde = opt('desde', '2000-01'); /* meses anteriores ficam de fora (ex.: mês com 3 dias de cobertura) */
const novos = {}; /* ym → registro */
let ignoradosProd = 0;

const comprasPath = opt('compras');
if (comprasPath) {
  const cj = JSON.parse(readFileSync(comprasPath, 'utf8'));
  if (!cj.meses) falha('o compras.json não tem "meses".');
  /* cobertura global (menor "de" e maior "ate" entre as unidades) */
  const cobs = Object.values(cj.cobertura || {}).filter(Boolean);
  let de = cobs.map(c => c.de).sort()[0], ate = cobs.map(c => c.ate).sort().slice(-1)[0];
  /* --periodo: o período pedido no relatório (ex.: PDF de 01/01/2025 a 30/09/2026) — vale mais que a 1ª/última compra, que pode cair num feriado */
  const per = opt('periodo');
  if (per) { const m = /^(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(per); if (!m) falha('--periodo: use AAAA-MM-DD:AAAA-MM-DD.'); if (m[1] > de || m[2] < ate) falha('--periodo não contém as compras do arquivo.'); de = m[1]; ate = m[2]; }
  for (const [ym, g] of Object.entries(cj.meses)) {
    if (ym < desde) continue;
    const band = {};
    for (const [b, x] of Object.entries(g.bandeiras || {})) {
      const acc = vazio();
      for (const [p, y] of Object.entries(x.produtos || {})) if (!somaProduto(acc, p, y.vol)) ignoradosProd++;
      band[b] = fecha(acc);
    }
    /* por unidade (compras.json novo traz produtos por unidade; o antigo não) */
    let unid = null;
    const us = Object.entries(g.unidades || {}).filter(([, x]) => x.produtos);
    if (us.length) {
      unid = {};
      for (const [u, x] of us) { const acc = vazio(); for (const [p, y] of Object.entries(x.produtos)) somaProduto(acc, p, y.vol); unid[u] = fecha(acc); if (!UNIDADES[u]) falha(`unidade ${u} do compras.json não está em --unidades.`); }
      const bu = bandDeUnid(unid);
      for (const b of Object.keys(band)) if (Math.abs((bu[b] || vazio()).otto - band[b].otto) > 0.002 || Math.abs((bu[b] || vazio()).diesel - band[b].diesel) > 0.002) falha(`${ym} ${b}: unidades não somam a bandeira.`);
    }
    const ini = `${ym}-01`, fim = `${ym}-${String(ultimoDia(ym)).padStart(2, '0')}`;
    const parcial = !(de && ate && de <= ini && ate >= fim);
    novos[ym] = { fonte: 'csv', parcial, cobertura: { de: de > ini ? de : ini, ate: ate < fim ? ate : fim }, band, ...(unid ? { unid } : {}) };
  }
}
const manualPath = opt('manual');
if (manualPath) {
  const mj = JSON.parse(readFileSync(manualPath, 'utf8'));
  for (const [ym, bands] of Object.entries(mj)) {
    if (!/^\d{4}-\d{2}$/.test(ym)) falha('mês inválido no manual: ' + ym);
    const band = {}, unid = {};
    for (const [chave, prods] of Object.entries(bands)) {
      const acc = vazio();
      for (const [p, litros] of Object.entries(prods)) if (!somaProduto(acc, p, Number(litros))) falha(`produto desconhecido no manual (${ym}, ${chave}): ${p}`);
      if (/^\d+$/.test(chave)) { if (!UNIDADES[chave]) falha(`unidade ${chave} do manual não está em --unidades.`); unid[chave] = fecha(acc); }
      else band[chave] = fecha(acc);
    }
    const temUnid = Object.keys(unid).length > 0;
    if (temUnid && Object.keys(band).length) falha(`${ym}: no manual, use só unidades ou só bandeiras.`);
    novos[ym] = { fonte: 'manual', parcial: false, cobertura: null, band: temUnid ? bandDeUnid(unid) : band, ...(temUnid ? { unid } : {}) };
  }
}
if (!Object.keys(novos).length && !cartArg && !unArg) falha('nada para gravar — informe --compras, --manual, --unidades ou --carteiras.');

/* fusão: mês novo entra; mês existente só é trocado se o novo cobre o mês inteiro, salvo --forca */
const forca = flag('forca');
let entraram = 0, trocados = 0, mantidos = 0;
for (const [ym, reg] of Object.entries(novos)) {
  const velho = atual.meses[ym];
  if (!velho) { atual.meses[ym] = reg; entraram++; continue; }
  if (forca || !reg.parcial || velho.parcial) { atual.meses[ym] = reg; trocados++; }
  else mantidos++;
}
atual.v = 1; atual.unidade = 'm3';
atual.atualizado_em = new Date().toISOString().slice(0, 16);
atual.fonte = 'Relatório de compra de combustíveis (Argo), unidades 3 e 4 Raízen, 5 Ipiranga; exclui Arla e GNV';

/* conferências: otto = gasolina + etanol; nada negativo */
for (const [ym, reg] of Object.entries(atual.meses)) for (const [b, v] of Object.entries(reg.band)) {
  if (Math.abs(v.gasolina + v.etanol - v.otto) > 0.002) falha(`${ym} ${b}: gasolina + etanol ≠ otto`);
  for (const x of Object.values(v)) if (x < 0) falha(`${ym} ${b}: volume negativo`);
}

const doc = cifra(atual, k);
const volta = decifra(doc, k);
if (JSON.stringify(volta) !== JSON.stringify(atual)) falha('a conferência de ida e volta falhou — nada gravado.');
mkdirSync(resolve(saida, '..'), { recursive: true });
writeFileSync(saida, JSON.stringify(doc));
const meses = Object.keys(atual.meses).sort();
console.log(`ok: ${saida} · ${meses.length} meses (${meses[0]} → ${meses[meses.length - 1]}) · ${entraram} novos, ${trocados} trocados, ${mantidos} mantidos · parciais: ${meses.filter(m => atual.meses[m].parcial).join(', ') || 'nenhum'}${ignoradosProd ? ` · ${ignoradosProd} produto(s) fora das famílias ignorado(s)` : ''}`);
