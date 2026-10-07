/* Publicação automática da ferramenta de Negociação de Preços.

   Faz o mesmo que o cartão "Negociação de Preços" das Configurações faz no
   navegador do admin, só que num script, para a Rotina diária do Claude Code:
   HTML → gzip+base64 → {v:1, em, gz} → AES-256-GCM com a chave dos dados →
   {enc:1, iv, ct} em negociacao/dados.enc.json. O formato é o mesmo que o
   shell negociacao/index.html abre (window.sapataoCofre).

   A chave dos dados vem SÓ da variável de ambiente SAPATAO_DEK (base64 de
   32 bytes — a mesma de localStorage `sapatao-dek-v1`, copiada pelo botão
   "Copiar a chave dos dados" das Configurações). Nunca passa por argumento,
   nunca é impressa, nunca vai para arquivo.

   Uso:
     node scripts/negociacao-publica.mjs publica --html <ferramenta.html> [--saida negociacao/dados.enc.json]
     node scripts/negociacao-publica.mjs abre --para <pasta-fora-do-repo> [--entrada negociacao/dados.enc.json]
       → grava <pasta>/negociacao-anterior.html (a versão publicada decifrada — estado do dia anterior)

   Os logs dizem só tamanhos, datas e "ok"; nenhum conteúdo da ferramenta. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { gzipSync, gunzipSync } from 'zlib';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { resolve, join } from 'path';

const args = process.argv.slice(2);
const modo = args[0];
function opt(nome, padrao) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; }
function falha(m) { console.error('ERRO: ' + m); process.exit(1); }

function chave() {
  const b = (process.env.SAPATAO_DEK || '').trim();
  if (!b) falha('SAPATAO_DEK não está no ambiente — guarde a chave dos dados (valor de sapatao-dek-v1 de um aparelho autorizado) como segredo do ambiente.');
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
  if (!doc || doc.enc !== 1) falha('o arquivo publicado não está no formato cifrado esperado.');
  const ct = Buffer.from(doc.ct, 'base64'), iv = Buffer.from(doc.iv, 'base64');
  const d = createDecipheriv('aes-256-gcm', k, iv);
  d.setAuthTag(ct.subarray(ct.length - 16));
  let pt;
  try { pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]); }
  catch (e) { falha('a chave dos dados não abre o arquivo publicado (chave trocada?).'); }
  return JSON.parse(pt.toString('utf8'));
}

if (modo === 'publica') {
  const htmlPath = opt('html'); if (!htmlPath) falha('informe --html <arquivo>.');
  const saida = resolve(opt('saida', 'negociacao/dados.enc.json'));
  const html = readFileSync(htmlPath, 'utf8');
  if (!/<html|<body|<!doctype/i.test(html.slice(0, 2000))) falha('o arquivo não parece ser a ferramenta (esperava um HTML).');
  if (!/id="menuNav"/.test(html) || !/class="topbar"/.test(html)) falha('o HTML não traz os pontos de encaixe do shell (#menuNav, .topbar).');
  const k = chave();
  const carga = { v: 1, em: new Date().toISOString().slice(0, 16), gz: gzipSync(Buffer.from(html, 'utf8')).toString('base64') };
  const doc = cifra(carga, k);
  /* conferência de ida e volta antes de gravar */
  const volta = decifra(doc, k);
  if (gunzipSync(Buffer.from(volta.gz, 'base64')).toString('utf8') !== html) falha('a conferência de ida e volta falhou — nada gravado.');
  writeFileSync(saida, JSON.stringify(doc));
  console.log(`publicado: ${saida} · HTML ${(html.length / 1024).toFixed(0)} KB → cifrado ${(JSON.stringify(doc).length / 1024).toFixed(0)} KB · em ${carga.em}`);
} else if (modo === 'abre') {
  const para = opt('para'); if (!para) falha('informe --para <pasta fora do repositório>.');
  const entrada = resolve(opt('entrada', 'negociacao/dados.enc.json'));
  if (resolve(para).startsWith(resolve('.')) && !resolve(para).startsWith('/tmp')) falha('--para precisa apontar para fora do repositório (o HTML decifrado nunca é commitado).');
  if (!existsSync(entrada)) falha('não existe ' + entrada + ' — a ferramenta ainda não foi publicada.');
  const k = chave();
  const ab = decifra(JSON.parse(readFileSync(entrada, 'utf8')), k);
  const html = ab.html || (ab.gz ? gunzipSync(Buffer.from(ab.gz, 'base64')).toString('utf8') : '');
  if (!html) falha('a publicação não traz HTML.');
  mkdirSync(para, { recursive: true });
  const alvo = join(para, 'negociacao-anterior.html');
  writeFileSync(alvo, html);
  console.log(`aberto: ${alvo} · ${(html.length / 1024).toFixed(0)} KB · publicado em ${ab.em || '?'}`);
} else {
  falha('modo desconhecido — use "publica" ou "abre".');
}
