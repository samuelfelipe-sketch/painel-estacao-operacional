/* Cofre das rotinas do painel Vendas: a chave dos dados vem SÓ da variável de
   ambiente SAPATAO_DEK (base64 de 32 bytes — o mesmo valor de localStorage
   `sapatao-dek-v1`). Nunca passa por argumento, nunca é impressa, nunca vai
   para arquivo. O formato {enc:1, iv, ct} é o que window.sapataoCofre abre. */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { confereKid } from './chave-id.mjs';

export function falha(m) { console.error('ERRO: ' + m); process.exit(1); }

export function chave() {
  const b = (process.env.SAPATAO_DEK || '').trim();
  if (!b) falha('SAPATAO_DEK não está no ambiente — guarde a chave dos dados (valor de sapatao-dek-v1 de um aparelho autorizado) como segredo do ambiente.');
  let k; try { k = Buffer.from(b, 'base64'); } catch (e) { k = Buffer.alloc(0); }
  if (k.length !== 32) falha('SAPATAO_DEK não tem o formato esperado (base64 de 32 bytes).');
  confereKid(k, falha);
  return k;
}
export function cifra(obj, k) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final(), c.getAuthTag()]);
  return { enc: 1, iv: iv.toString('base64'), ct: ct.toString('base64') };
}
export function decifra(doc, k) {
  if (!doc || doc.enc !== 1) falha('o arquivo publicado não está no formato cifrado esperado.');
  const ct = Buffer.from(doc.ct, 'base64'), iv = Buffer.from(doc.iv, 'base64');
  const d = createDecipheriv('aes-256-gcm', k, iv);
  d.setAuthTag(ct.subarray(ct.length - 16));
  let pt;
  try { pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]); }
  catch (e) { falha('a chave dos dados não abre o arquivo publicado (chave trocada?).'); }
  return JSON.parse(pt.toString('utf8'));
}
