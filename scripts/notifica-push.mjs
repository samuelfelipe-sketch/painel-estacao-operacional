/* Envia a notificação push nativa quando um follow-up novo chega ao
   Planejamento Estratégico. Roda no GitHub Actions:
   - a mensagem do commit traz autor e nº da ação (dados não sensíveis);
   - as inscrições dos aparelhos ficam cifradas em roadmap/push-subs.json
     (AES-GCM + RSA-OAEP) e são abertas aqui com a chave privada guardada
     como segredo do repositório;
   - o envio usa o padrão Web Push (VAPID). */
import webpush from 'web-push';
import { readFileSync } from 'fs';
import { createPrivateKey, privateDecrypt, createDecipheriv, constants } from 'crypto';

const msg = process.env.MENSAGEM_COMMIT || '';
const m = msg.match(/novo follow-up de (.+) na ação (\d+)/i);
if (!m) { console.log('commit sem follow-up novo — nada a enviar'); process.exit(0); }
const corpo = `Novo follow-up de ${m[1]} na ação ${m[2]}.`;

const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY, subsPriv = process.env.SUBS_PRIVATE_KEY_B64;
if (!pub || !priv || !subsPriv) { console.log('segredos ausentes (VAPID_PRIVATE_KEY / PUSH_SUBS_PRIVATE_KEY) — configure em Settings > Secrets'); process.exit(0); }
webpush.setVapidDetails('mailto:samuel@estacaosapatao.com.br', pub, priv);
const chave = createPrivateKey({ key: Buffer.from(subsPriv, 'base64'), format: 'der', type: 'pkcs8' });

const doc = JSON.parse(readFileSync('roadmap/push-subs.json', 'utf8'));
const entradas = Object.entries(doc.subs || {});
if (!entradas.length) { console.log('nenhum aparelho inscrito'); process.exit(0); }

let ok = 0, falha = 0;
for (const [id, ent] of entradas) {
  try {
    const aes = privateDecrypt({ key: chave, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(ent.env.ek, 'base64'));
    const iv = Buffer.from(ent.env.iv, 'base64');
    const ct = Buffer.from(ent.env.ct, 'base64');
    const dec = createDecipheriv('aes-256-gcm', aes, iv);
    dec.setAuthTag(ct.subarray(ct.length - 16));
    const sub = JSON.parse(Buffer.concat([dec.update(ct.subarray(0, ct.length - 16)), dec.final()]).toString('utf8'));
    await webpush.sendNotification(sub, JSON.stringify({ title: 'Planejamento Estratégico', body: corpo, url: '../estrategia/' }), { TTL: 3600 });
    ok++;
  } catch (e) {
    falha++;
    console.log('aparelho ' + id + ': falhou (' + (e.statusCode || e.message) + ')');
  }
}
console.log('notificações enviadas: ' + ok + ' | falhas: ' + falha);
