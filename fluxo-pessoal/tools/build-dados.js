#!/usr/bin/env node
/**
 * Gera o arquivo `dados.enc.json` — o cofre criptografado do Fluxo de Caixa Pessoal.
 *
 * Os dados em texto puro NUNCA entram no repositório: só o resultado cifrado.
 * Criptografia idêntica à do navegador (WebCrypto):
 *   - Chave-mestra AES-GCM 256 bits gerada aleatoriamente
 *   - Payload (dados + documentos) cifrado com a chave-mestra
 *   - Para cada usuário, a chave-mestra é "embrulhada" com uma chave derivada
 *     da senha via PBKDF2-SHA256 (600.000 iterações, salt aleatório)
 *
 * Uso:
 *   node build-dados.js --data /caminho/dados-plain.json --out ../dados.enc.json \
 *     --user admin:"Administrador":admin --pass 'SENHA_DO_ADMIN'
 *
 * O JSON de entrada deve ser o objeto D da ferramenta (lanc, contas, saldos, ...).
 * Documentos começam vazios ({docs: []}).
 */
const fs = require('fs');
const { webcrypto } = require('crypto');
const subtle = webcrypto.subtle;
const getRandomValues = (arr) => webcrypto.getRandomValues(arr);

const ITER = 600000;

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}
const b64 = (buf) => Buffer.from(buf).toString('base64');

async function deriveKey(pass, salt) {
  const base = await subtle.importKey('raw', Buffer.from(pass, 'utf8'), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
}

async function main() {
  const dataPath = arg('data');
  const outPath = arg('out', 'dados.enc.json');
  const userSpec = arg('user', 'admin:Administrador:admin'); // usuario:nome:papel
  const pass = arg('pass') || process.env.ADMIN_PASS;
  if (!dataPath || !pass) {
    console.error('Uso: node build-dados.js --data dados-plain.json --out dados.enc.json --user admin:Nome:admin --pass SENHA');
    process.exit(1);
  }
  const D = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const payloadPlain = JSON.stringify({ D, docs: [] });

  const masterKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

  const pIv = getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv: pIv }, masterKey, Buffer.from(payloadPlain, 'utf8'));

  const [u, nome, role] = userSpec.split(':');
  const salt = getRandomValues(new Uint8Array(16));
  const userKey = await deriveKey(pass, salt);
  const wIv = getRandomValues(new Uint8Array(12));
  const rawMaster = await subtle.exportKey('raw', masterKey);
  const wk = await subtle.encrypt({ name: 'AES-GCM', iv: wIv }, userKey, rawMaster);

  const store = {
    v: 1,
    app: 'fluxo-pessoal',
    mod: new Date().toISOString(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iter: ITER },
    users: [{ u, nome, role, salt: b64(salt), iv: b64(wIv), wk: b64(wk), criado: new Date().toISOString().slice(0, 10) }],
    payload: { iv: b64(pIv), ct: b64(ct) },
  };
  fs.writeFileSync(outPath, JSON.stringify(store));
  console.log(`OK: ${outPath} gerado (${fs.statSync(outPath).size} bytes), usuário "${u}" (${role}).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
