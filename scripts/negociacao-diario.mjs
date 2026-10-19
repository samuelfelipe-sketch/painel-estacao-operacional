/* Diário de negociação de combustíveis — vive CIFRADO no repositório em
   negociacao/diario.enc.json (AES-256-GCM com a chave dos dados, mesmo cofre
   dos outros arquivos de negócio). É APPEND-ONLY: as rotinas só acrescentam
   entradas no topo, logo abaixo do cabeçalho; nunca reescrevem o histórico.

   Formato em claro (Markdown):
     # Diário de negociação
     (avisos permanentes / regras)
     ---
     ## DD/MM/AAAA (dia) — título da entrada
     texto...
     ## DD/MM/AAAA ...

   A chave vem SÓ da variável de ambiente SAPATAO_DEK. O texto decifrado só
   existe fora do repositório (/tmp). Logs sem conteúdo.

   Uso:
     node scripts/negociacao-diario.mjs abre --para <pasta fora do repo>        → <pasta>/diario.md
     node scripts/negociacao-diario.mjs anexa --entrada <entrada.md>            (uma entrada nova, começando por "## DD/MM/AAAA")
     node scripts/negociacao-diario.mjs importa --md <diario.md> [--forcar]     (substitui tudo — migração ou edição manual do Samuel)
   Depois: git add negociacao/diario.enc.json e commit "chore: atualiza o diário de negociação (automático)". */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { resolve, join } from 'path';

const ARQ = resolve('negociacao/diario.enc.json');
const args = process.argv.slice(2);
const modo = args[0];
function opt(nome, padrao) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; }
const flag = nome => args.includes('--' + nome);
function falha(m) { console.error('ERRO: ' + m); process.exit(1); }

function chave() {
  const b = (process.env.SAPATAO_DEK || '').trim();
  if (!b) falha('SAPATAO_DEK não está no ambiente.');
  let k; try { k = Buffer.from(b, 'base64'); } catch (e) { k = Buffer.alloc(0); }
  if (k.length !== 32) falha('SAPATAO_DEK não tem o formato esperado (base64 de 32 bytes).');
  return k;
}
function cifra(obj, k) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final(), c.getAuthTag()]);
  return { enc: 1, iv: iv.toString('base64'), ct: ct.toString('base64') };
}
function decifra(doc, k) {
  if (!doc || doc.enc !== 1) falha('o diário publicado não está no formato cifrado esperado.');
  const ct = Buffer.from(doc.ct, 'base64'), iv = Buffer.from(doc.iv, 'base64');
  const d = createDecipheriv('aes-256-gcm', k, iv);
  d.setAuthTag(ct.subarray(ct.length - 16));
  let pt;
  try { pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]); }
  catch (e) { falha('a chave dos dados não abre o diário (chave trocada?).'); }
  return JSON.parse(pt.toString('utf8'));
}
function le(k) { if (!existsSync(ARQ)) falha('não existe ' + ARQ + ' — importe o diário primeiro (modo importa).'); return decifra(JSON.parse(readFileSync(ARQ, 'utf8')), k); }
function grava(md, k) {
  const doc = cifra({ v: 1, atualizadoEm: new Date().toISOString().slice(0, 16), md }, k);
  if (decifra(doc, k).md !== md) falha('conferência de ida e volta falhou — nada gravado.');
  writeFileSync(ARQ, JSON.stringify(doc));
}
const entradas = md => (md.match(/^## /gm) || []).length;
function partes(md) {
  const i = md.search(/^---\s*$/m);
  if (i < 0) falha('o diário precisa de uma linha "---" separando o cabeçalho das entradas.');
  const fim = md.indexOf('\n', i);
  return { cab: md.slice(0, fim + 1), corpo: md.slice(fim + 1) };
}
const ENTRADA = /^## \d{2}\/\d{2}\/\d{4}\b/;

if (modo === 'abre') {
  const para = opt('para'); if (!para) falha('informe --para <pasta fora do repositório>.');
  if (resolve(para).startsWith(resolve('.')) && !resolve(para).startsWith('/tmp')) falha('--para precisa apontar para fora do repositório.');
  const k = chave(); const d = le(k);
  mkdirSync(para, { recursive: true });
  const alvo = join(para, 'diario.md'); writeFileSync(alvo, d.md);
  console.log(`aberto: ${alvo} · ${entradas(d.md)} entradas · atualizado em ${d.atualizadoEm}`);
} else if (modo === 'anexa') {
  const ent = opt('entrada'); if (!ent) falha('informe --entrada <arquivo .md com UMA entrada>.');
  const k = chave(); const d = le(k);
  const nova = readFileSync(ent, 'utf8').trim() + '\n';
  if (!ENTRADA.test(nova)) falha('a entrada precisa começar por "## DD/MM/AAAA".');
  if (entradas(nova) !== 1) falha('o arquivo da entrada deve conter exatamente uma entrada (um título "## ").');
  const { cab, corpo } = partes(d.md);
  const md = cab + '\n' + nova + '\n' + corpo.replace(/^\n+/, '');
  if (entradas(md) !== entradas(d.md) + 1) falha('a contagem de entradas não subiu em exatamente 1 — nada gravado.');
  if (!md.startsWith(cab)) falha('o cabeçalho mudaria — nada gravado.');
  grava(md, k);
  console.log(`anexado: ${entradas(md)} entradas agora (${nova.split('\n')[0].slice(3, 30)}…)`);
} else if (modo === 'importa') {
  const p = opt('md'); if (!p) falha('informe --md <diario.md>.');
  const k = chave();
  const md = readFileSync(p, 'utf8');
  partes(md);
  if (existsSync(ARQ) && !flag('forcar')) {
    const atual = le(k);
    if (entradas(md) < entradas(atual.md)) falha(`o novo diário tem ${entradas(md)} entradas e o atual ${entradas(atual.md)} — use --forcar se for intencional.`);
  }
  grava(md, k);
  console.log(`importado: ${entradas(md)} entradas`);
} else {
  falha('modo desconhecido — use "abre", "anexa" ou "importa".');
}
