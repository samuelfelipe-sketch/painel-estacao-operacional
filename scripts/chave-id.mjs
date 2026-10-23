/* Identificador público da chave dos dados (roadmap/chave-id.json).
   É um resumo SHA-256 truncado da chave — não abre nada, só diz qual chave
   está valendo. Quando o admin troca a chave pelas Configurações, o arquivo
   muda junto; um script com a chave antiga no ambiente para aqui, antes de
   gravar um arquivo que o site não conseguiria abrir. */
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

const ARQ = fileURLToPath(new URL('../roadmap/chave-id.json', import.meta.url));

/* mesmo cálculo do auth.js: base64 dos 9 primeiros bytes de SHA-256("sapatao-kid-v1:" + chave em base64) */
export function kidDe(kBuf) {
  return createHash('sha256').update('sapatao-kid-v1:' + Buffer.from(kBuf).toString('base64')).digest().subarray(0, 9).toString('base64');
}

export function confereKid(kBuf, falha) {
  if (!existsSync(ARQ)) return; /* antes da primeira troca de chave não há identificador */
  let doc = null;
  try { doc = JSON.parse(readFileSync(ARQ, 'utf8')); } catch (e) { return; }
  if (doc && doc.kid && doc.kid !== kidDe(kBuf)) {
    falha('a chave dos dados do ambiente (SAPATAO_DEK) é ANTIGA — o admin trocou a chave pelas Configurações. Atualize o segredo SAPATAO_DEK do ambiente com a chave nova e rode de novo. Nada foi gravado.');
  }
}
