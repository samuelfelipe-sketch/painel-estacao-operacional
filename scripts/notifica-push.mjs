/* Envia a notificação push nativa quando chega um follow-up novo ou uma
   ação muda de estado (concluída/reaberta) no Roadmap Comercial ou no
   Planejamento Estratégico. Roda no GitHub Actions:
   - a mensagem do commit traz autor e nº da ação (dados não sensíveis);
   - as inscrições dos aparelhos ficam cifradas em roadmap/push-subs.json
     (AES-GCM + RSA-OAEP) e são abertas aqui com a chave privada guardada
     como segredo do repositório;
   - o envio usa o padrão Web Push (VAPID). */
import webpush from 'web-push';
import { readFileSync } from 'fs';
import { createPrivateKey, privateDecrypt, createDecipheriv, constants } from 'crypto';

/* o iPhone sempre acrescenta "from Sapatão" (nome do app) — então o título
   carrega o evento e o corpo diz a ação e o painel */
const msg = process.env.MENSAGEM_COMMIT || '';
let autor = '', titulo = '', corpo = '', urlAlvo = '', tipo = '';
let m = msg.match(/novo follow-up de (.+) na ação (\d+)/i);
if (m) {
  autor = m[1];
  tipo = 'fu';
  titulo = `Novo follow-up de ${m[1]}`;
  corpo = `Ação ${m[2]} do Planejamento Estratégico.`;
  urlAlvo = './estrategia/#notificacoes';
} else if ((m = msg.match(/(?:chore:\s*)?(.+?) (concluiu|reabriu) a ação (\d+) do (Roadmap Comercial|Planejamento Estratégico)/i))) {
  autor = m[1];
  tipo = 'est';
  titulo = `${m[1]} ${m[2]} uma ação`;
  corpo = `Ação ${m[3]} do ${m[4]}.`;
  urlAlvo = /roadmap/i.test(m[4]) ? './roadmap/guia.html#notificacoes' : './estrategia/#notificacoes';
} else if ((m = msg.match(/(?:chore:\s*)?(.+?) renegociou a ação (\d+) do (Roadmap Comercial|Planejamento Estratégico)/i))) {
  autor = m[1];
  tipo = 'rng';
  titulo = `${m[1]} renegociou um prazo`;
  corpo = `Ação ${m[2]} do ${m[3]}.`;
  urlAlvo = /roadmap/i.test(m[3]) ? './roadmap/guia.html#notificacoes' : './estrategia/#notificacoes';
}
if (!corpo) { console.log('commit sem novidade para avisar — nada a enviar'); process.exit(0); }

/* Segredos colados no GitHub costumam vir com espaços ou quebra de linha no
   fim — aparamos tudo antes de validar. */
const limpa = (s) => (s || '').replace(/\s+/g, '');
const pub = limpa(process.env.VAPID_PUBLIC_KEY), priv = limpa(process.env.VAPID_PRIVATE_KEY), subsPriv = limpa(process.env.SUBS_PRIVATE_KEY_B64);
if (!pub || !priv || !subsPriv) { console.log('segredos ausentes (VAPID_PRIVATE_KEY / PUSH_SUBS_PRIVATE_KEY) — configure em Settings > Secrets'); process.exit(0); }
const bytes = (b64) => { try { return Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length; } catch { return 0; } };
if (bytes(priv) !== 32 || bytes(pub) !== 65) {
  console.log('ERRO: chave VAPID com formato inesperado — regrave o secret VAPID_PRIVATE_KEY em Settings > Secrets and variables > Actions colando só o valor da chave.');
  process.exit(1);
}
webpush.setVapidDetails('mailto:samuel@estacaosapatao.com.br', pub, priv);
const chave = createPrivateKey({ key: Buffer.from(subsPriv, 'base64'), format: 'der', type: 'pkcs8' });

/* quem fez a ação não recebe o próprio aviso: o nome do commit é resolvido
   para o id de usuário via usuarios.json e os aparelhos dele são pulados */
const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
let autorId = '';
try {
  const us = JSON.parse(readFileSync('roadmap/usuarios.json', 'utf8'));
  const u = (us.usuarios || []).find((x) => norm(x.nome) === norm(autor) || norm(x.id) === norm(autor));
  if (u) autorId = u.id;
} catch { /* sem usuarios.json legível, avisa todo mundo */ }

const doc = JSON.parse(readFileSync('roadmap/push-subs.json', 'utf8'));
const entradas = Object.entries(doc.subs || {});
if (!entradas.length) { console.log('nenhum aparelho inscrito'); process.exit(0); }

let ok = 0, falha = 0, proprios = 0, optaram = 0;
for (const [id, ent] of entradas) {
  if (autorId && ent.u === autorId) { proprios++; continue; }
  const pref = ent.pref || {};
  if (pref[tipo] === false) { optaram++; continue; }
  try {
    const aes = privateDecrypt({ key: chave, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(ent.env.ek, 'base64'));
    const iv = Buffer.from(ent.env.iv, 'base64');
    const ct = Buffer.from(ent.env.ct, 'base64');
    const dec = createDecipheriv('aes-256-gcm', aes, iv);
    dec.setAuthTag(ct.subarray(ct.length - 16));
    const sub = JSON.parse(Buffer.concat([dec.update(ct.subarray(0, ct.length - 16)), dec.final()]).toString('utf8'));
    await webpush.sendNotification(sub, JSON.stringify({ title: titulo, body: corpo, url: urlAlvo }), { TTL: 3600 });
    ok++;
  } catch (e) {
    falha++;
    console.log('aparelho ' + id + ': falhou (' + (e.statusCode || e.message) + ')');
  }
}
console.log('notificações enviadas: ' + ok + ' | falhas: ' + falha + ' | aparelhos do autor pulados: ' + proprios + ' | preferiram não receber: ' + optaram);
