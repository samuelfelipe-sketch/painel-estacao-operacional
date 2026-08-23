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
const paineis = [];
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
  if (!vHoje.length && !vAmanha.length && !vSemana.length && !recem.length) continue;
  paineis.push({ nome, url, vHoje, vAmanha, vSemana, recem, antigas });
}
if (!paineis.length) { console.log('nenhum prazo vencendo hoje, amanhã ou em 7 dias — nada a enviar'); process.exit(0); }
paineis.forEach((pl) => console.log('painel [' + pl.nome + '] hoje=' + pl.vHoje + ' amanhã=' + pl.vAmanha + ' 7dias=' + pl.vSemana + ' atrasou=' + pl.recem + ' antigas=' + pl.antigas));

/* cada aparelho recebe só as etapas que deixou ligadas nas Configurações
   (pref antiga przo, tudo junto, vale como padrão das quatro novas) */
function avisosPara(pref) {
  const base = pref.przo !== false;
  const quer = (k) => (pref[k] !== undefined ? pref[k] !== false : base);
  const avisos = [];
  for (const pl of paineis) {
    const partes = [];
    if (quer('przo0') && pl.vHoje.length) partes.push('Vence hoje: ' + listaIds(pl.vHoje) + '.');
    if (quer('przo1') && pl.vAmanha.length) partes.push('Vence amanhã (' + ddmm(amanha) + '): ' + listaIds(pl.vAmanha) + '.');
    if (quer('przo7') && pl.vSemana.length) partes.push('Vence em 7 dias (' + ddmm(seteDias) + '): ' + listaIds(pl.vSemana) + '.');
    if (quer('przoAt') && pl.recem.length) partes.push('Atrasou: ' + listaIds(pl.recem) + ' (venceu ' + ddmm(ontem) + ').');
    if (quer('przoAt') && partes.length && pl.antigas.length) partes.push('Já atrasada' + (pl.antigas.length > 1 ? 's' : '') + ': ' + listaIds(pl.antigas) + '.');
    if (partes.length) avisos.push({ titulo: 'Prazos do ' + pl.nome, corpo: partes.join(' '), url: pl.url });
  }
  return avisos;
}

const doc = JSON.parse(readFileSync('roadmap/push-subs.json', 'utf8'));
const entradas = Object.entries(doc.subs || {});
if (!entradas.length) { console.log('nenhum aparelho inscrito'); process.exit(0); }

let ok = 0, falha = 0, optaram = 0;
for (const [id, ent] of entradas) {
  const avisos = avisosPara(ent.pref || {});
  if (!avisos.length) { optaram++; continue; }
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
console.log('lembretes: aparelhos ok: ' + ok + ' | falhas: ' + falha + ' | sem nada a receber (preferências): ' + optaram);
