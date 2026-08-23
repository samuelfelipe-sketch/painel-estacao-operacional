/* Lembretes diários de prazo dos painéis: lê roadmap/calendario.json
   (só nº da ação + prazo + status — nada de conteúdo do cofre) e avisa
   por Web Push o que vence hoje, amanhã ou está atrasado. Um aviso por
   painel, para os aparelhos com o lembrete de prazo ligado (pref.przo). */
import webpush from 'web-push';
import { readFileSync } from 'fs';
import { createPrivateKey, privateDecrypt, createDecipheriv, constants } from 'crypto';

const limpa = (s) => (s || '').replace(/\s+/g, '');
const pub = limpa(process.env.VAPID_PUBLIC_KEY), priv = limpa(process.env.VAPID_PRIVATE_KEY), subsPriv = limpa(process.env.SUBS_PRIVATE_KEY_B64);
if (!pub || !priv || !subsPriv) { console.log('segredos ausentes (VAPID_PRIVATE_KEY / PUSH_SUBS_PRIVATE_KEY) — configure em Settings > Secrets'); process.exit(0); }
webpush.setVapidDetails('mailto:samuel@estacaosapatao.com.br', pub, priv);
const chave = createPrivateKey({ key: Buffer.from(subsPriv, 'base64'), format: 'der', type: 'pkcs8' });

let cal = null;
try { cal = JSON.parse(readFileSync('roadmap/calendario.json', 'utf8')); }
catch { console.log('sem roadmap/calendario.json ainda — o site publica na próxima alteração dos painéis'); process.exit(0); }

const dia = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(t);
const hoje = dia(new Date()), amanha = dia(new Date(Date.now() + 864e5)), ontem = dia(new Date(Date.now() - 864e5)), seteDias = dia(new Date(Date.now() + 7 * 864e5));
const ddmm = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const listaIds = (ids) => (ids.length > 1 ? 'ações ' : 'ação ') + ids.join(', ');

const PAINEIS = [
  ['rc', 'Roadmap Comercial', './roadmap/guia.html#notificacoes'],
  ['pe', 'Planejamento Estratégico', './estrategia/#notificacoes'],
];
const avisos = [];
for (const [k, nome, url] of PAINEIS) {
  const acoes = cal[k] || {};
  const vHoje = [], vAmanha = [], vSemana = [], recem = [], antigas = [];
  for (const id of Object.keys(acoes)) {
    const a = acoes[id];
    if (!a || !a.p || a.s === 'concluido') continue;
    if (a.p === hoje) vHoje.push(id);
    else if (a.p === amanha) vAmanha.push(id);
    else if (a.p === seteDias) vSemana.push(id);
    else if (a.p === ontem) recem.push(id);
    else if (a.p < hoje) antigas.push(id);
  }
  /* avisa quando algo vence hoje/amanhã, entra na janela de 7 dias ou acabou
     de atrasar; as atrasadas antigas só pegam carona (não apita todo dia) */
  if (!vHoje.length && !vAmanha.length && !vSemana.length && !recem.length) continue;
  const partes = [];
  if (vHoje.length) partes.push('Vence hoje: ' + listaIds(vHoje) + '.');
  if (vAmanha.length) partes.push('Vence amanhã (' + ddmm(amanha) + '): ' + listaIds(vAmanha) + '.');
  if (vSemana.length) partes.push('Vence em 7 dias (' + ddmm(seteDias) + '): ' + listaIds(vSemana) + '.');
  if (recem.length) partes.push('Atrasou: ' + listaIds(recem) + ' (venceu ' + ddmm(ontem) + ').');
  if (antigas.length) partes.push('Já atrasada' + (antigas.length > 1 ? 's' : '') + ': ' + listaIds(antigas) + '.');
  avisos.push({ titulo: 'Prazos do ' + nome, corpo: partes.join(' '), url });
}
if (!avisos.length) { console.log('nenhum prazo vencendo hoje ou amanhã — nada a enviar'); process.exit(0); }
avisos.forEach((av) => console.log('aviso: [' + av.titulo + '] ' + av.corpo));

const doc = JSON.parse(readFileSync('roadmap/push-subs.json', 'utf8'));
const entradas = Object.entries(doc.subs || {});
if (!entradas.length) { console.log('nenhum aparelho inscrito'); process.exit(0); }

let ok = 0, falha = 0, optaram = 0;
for (const [id, ent] of entradas) {
  const pref = ent.pref || {};
  if (pref.przo === false) { optaram++; continue; }
  try {
    const aes = privateDecrypt({ key: chave, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(ent.env.ek, 'base64'));
    const iv = Buffer.from(ent.env.iv, 'base64');
    const ct = Buffer.from(ent.env.ct, 'base64');
    const dec = createDecipheriv('aes-256-gcm', aes, iv);
    dec.setAuthTag(ct.subarray(ct.length - 16));
    const sub = JSON.parse(Buffer.concat([dec.update(ct.subarray(0, ct.length - 16)), dec.final()]).toString('utf8'));
    for (const av of avisos) {
      await webpush.sendNotification(sub, JSON.stringify({ title: av.titulo, body: av.corpo, url: av.url }), { TTL: 43200 });
    }
    ok++;
  } catch (e) {
    falha++;
    console.log('aparelho ' + id + ': falhou (' + (e.statusCode || e.message) + ')');
  }
}
console.log('lembretes: ' + avisos.length + ' aviso(s) | aparelhos ok: ' + ok + ' | falhas: ' + falha + ' | preferiram não receber: ' + optaram);
