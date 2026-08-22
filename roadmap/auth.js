/* ============================================================
   Acesso restrito — Estação Sapatão (Roadmap + Planejamento)
   ------------------------------------------------------------
   v2 — com USUÁRIOS: cada pessoa tem a própria senha (o que fica
   aqui e em roadmap/usuarios.json é só o hash SHA-256) e permissões
   por painel: roadmap (Guia) e pe (Planejamento Estratégico),
   cada uma 'edita' | 'le' | 'nao'. Admin gerencia tudo.
   A página define window.SAPATAO_APP = 'roadmap' | 'pe' antes
   deste script; sem definir, vale 'roadmap'.
   O login é só pela senha: o hash identifica quem entrou.
   Obs.: é uma proteção de acesso simples de site estático —
   suficiente para uso interno, não para dados sensíveis.
   ============================================================ */
(function () {
  /* Fallback embutido (mantém o Samuel entrando mesmo sem rede).
     A lista viva fica em roadmap/usuarios.json. */
  var USUARIOS_FALLBACK = [
    { id: 'samuel', nome: 'Samuel', hash: 'd2a841835b53ff10c938d88d247151e4cb36bb6c9047c8f7b9affe799d97f7c1', admin: true, ativo: true, perm: { roadmap: 'edita', pe: 'edita' } }
  ];
  var RAW_BASE = 'https://raw.githubusercontent.com/samuelfelipe-sketch/painel-estacao-operacional/main/';
  var API_BASE = 'https://api.github.com/repos/samuelfelipe-sketch/painel-estacao-operacional/contents/';
  var CHAVE = 'sapatao-roadmap-auth-v1';
  var CACHE_US = 'sapatao-usuarios-cache-v1';
  var LS_TOKEN = 'sapatao-sync-token';
  var APP = (typeof window.SAPATAO_APP === 'string' && window.SAPATAO_APP) || 'roadmap';

  /* SHA-256 em JS puro (domínio público — geraintluff/sha256) */
  function sha256(ascii) {
    ascii = unescape(encodeURIComponent(ascii)); // acentos viram bytes UTF-8
    function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
    var mathPow = Math.pow, maxWord = mathPow(2, 32), result = '', i, j;
    var words = [], asciiBitLength = ascii.length * 8;
    var hash = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [];
    var primeCounter = k.length, isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return '';
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var s0 = w15 && (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3));
        var s1 = w2 && (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10));
        if (i >= 16) w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        var e = hash[4];
        var temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ (~e & hash[6]))
          + k[i] + w[i];
        var a = hash[0];
        var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? 0 : '') + b.toString(16);
      }
    }
    return result;
  }

  /* ---------- usuários ---------- */
  function usuariosLocais() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_US) || 'null');
      if (c && c.usuarios && c.usuarios.length) return c.usuarios;
    } catch (e) {}
    return USUARIOS_FALLBACK;
  }
  function guardaCache(lista) {
    try { localStorage.setItem(CACHE_US, JSON.stringify({ v: 1, usuarios: lista })); } catch (e) {}
  }
  function usuariosFrescos() {
    return fetch(RAW_BASE + 'roadmap/usuarios.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) {
        var lista = (j && j.usuarios) || null;
        if (lista && lista.length) { guardaCache(lista); return lista; }
        throw 0;
      });
  }
  function achaPorHash(lista, h) {
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].ativo !== false && lista[i].hash === h) return lista[i];
    }
    return null;
  }
  function permDe(user, app) {
    if (!user) return 'nao';
    if (user.admin) return 'edita';
    return (user.perm || {})[app] || 'nao';
  }

  /* ---------- sessão ---------- */
  function leSessao() {
    var v = null;
    try { v = sessionStorage.getItem(CHAVE) || localStorage.getItem(CHAVE); } catch (e) {}
    if (!v) return null;
    if (/^[0-9a-f]{64}$/.test(v)) return { h: v };          /* formato antigo: só o hash */
    try { var j = JSON.parse(v); if (j && j.h) return j; } catch (e) {}
    return null;
  }
  function gravaSessao(user, h, lembrar) {
    var v = JSON.stringify({ u: user.id, h: h });
    try { sessionStorage.setItem(CHAVE, v); } catch (e) {}
    if (lembrar) { try { localStorage.setItem(CHAVE, v); } catch (e) {} }
  }

  var A = window.sapataoAuth = {
    sha256: sha256, chave: CHAVE, app: APP,
    usuarios: usuariosLocais(),
    user: null, pw: null,
    permDe: permDe,
    podeEditar: function (app) { return permDe(A.user, app || APP) === 'edita'; },
    temAcesso: function (app) { return permDe(A.user, app || APP) !== 'nao'; },
    /* compat com código antigo que lia .hash */
    get hash() { return A.user ? A.user.hash : ''; }
  };
  window.sapataoSair = function () {
    try { sessionStorage.removeItem(CHAVE); } catch (e) {}
    try { localStorage.removeItem(CHAVE); } catch (e) {}
    location.reload();
  };

  function anuncia() { try { document.dispatchEvent(new CustomEvent('sapatao-auth', { detail: { user: A.user } })); } catch (e) {} }

  function bloqueiaSemAcesso() {
    garanteEstilo();
    document.documentElement.classList.add('sptx-lock');
    var d = document.createElement('div');
    d.className = 'sptx-gate';
    d.innerHTML = '<div class="sptx-card"><div class="sptx-eyebrow">Estação Sapatão</div>'
      + '<h1 class="sptx-titulo">Sem <i>acesso</i></h1>'
      + '<p class="sptx-sub">O usuário <b>' + (A.user ? A.user.nome : '') + '</b> não tem acesso a este painel. Fale com o Samuel para liberar a permissão.</p>'
      + '<button type="button" class="sptx-btn" onclick="location.href=\'../index.html\'">&#8592; Voltar à página inicial</button>'
      + '<button type="button" class="sptx-btn" style="background:none;color:#3D6B60;margin-top:8px" onclick="window.sapataoSair()">Entrar com outro usuário</button></div>';
    function poe() { document.body.appendChild(d); }
    if (document.body) poe(); else document.addEventListener('DOMContentLoaded', poe);
  }

  /* ---------- cofre da chave de publicação (compartilhado entre os painéis) ----------
     roadmap/chave.enc.json v2: {v:2, envelopes:{usuarioId:{salt,iv,ct}}} — o token
     criptografado com a senha de cada usuário (AES-GCM, PBKDF2 310k).
     Compatível com o formato v1 (um único envelope na raiz). */
  function b64bytes(u8) { var s = ''; u8.forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s); }
  function bytesB64(b64) { return Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); }); }
  function b64enc(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64dec(str) { return decodeURIComponent(escape(atob(str.replace(/\s/g, '')))); }
  function kdf(pw, saltU8) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: saltU8, iterations: 310000 }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }
  function abreEnvelope(env, pw) {
    return kdf(pw, bytesB64(env.salt)).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytesB64(env.iv) }, key, bytesB64(env.ct));
    }).then(function (pt) { return new TextDecoder().decode(pt); });
  }
  function fechaEnvelope(token, pw) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    return kdf(pw, salt).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(token));
    }).then(function (ct) { return { salt: b64bytes(salt), iv: b64bytes(iv), ct: b64bytes(new Uint8Array(ct)) }; });
  }
  var KEY_URL = API_BASE + 'roadmap/chave.enc.json';
  var C = window.sapataoChave = {
    ls: LS_TOKEN,
    token: function () { try { return localStorage.getItem(LS_TOKEN) || ''; } catch (e) { return ''; } },
    grava: function (t) { try { if (t) localStorage.setItem(LS_TOKEN, t); else localStorage.removeItem(LS_TOKEN); } catch (e) {} },
    /* baixa e abre o envelope do usuário logado (quando não há chave local) */
    busca: function () {
      if (C.token() || !A.user || !A.pw || !window.crypto || !crypto.subtle) return Promise.resolve(false);
      return fetch(KEY_URL + '?ref=main&t=' + Date.now(), { headers: { 'Accept': 'application/vnd.github+json' }, cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (j) {
          var doc = JSON.parse(b64dec(j.content));
          var envs = [];
          if (doc.v === 2 && doc.envelopes) {
            if (doc.envelopes[A.user.id]) envs.push(doc.envelopes[A.user.id]);
            if (doc.envelopes._antiga) envs.push(doc.envelopes._antiga);
          } else if (doc.ct) envs.push(doc); /* formato v1 */
          var tenta = function (i) {
            if (i >= envs.length) return false;
            return abreEnvelope(envs[i], A.pw).then(function (t) {
              if (!t) return tenta(i + 1);
              C.grava(t); return true;
            }).catch(function () { return tenta(i + 1); });
          };
          return tenta(0);
        }).catch(function () { return false; });
    },
    /* garante que o envelope do usuário logado existe na nuvem (v2),
       preservando os envelopes dos outros usuários */
    garante: function () {
      var token = C.token();
      if (!token || !A.user || !A.pw || !window.crypto || !crypto.subtle) return Promise.resolve(false);
      var h = { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
      var sha = null, envelopes = {};
      return fetch(KEY_URL + '?ref=main&t=' + Date.now(), { headers: h, cache: 'no-store' })
        .then(function (g) { if (!g.ok) throw 0; return g.json(); })
        .then(function (j) {
          sha = j.sha;
          var doc = JSON.parse(b64dec(j.content));
          if (doc.v === 2 && doc.envelopes) envelopes = doc.envelopes;
          else if (doc.ct) {
            /* migra o v1: se a senha atual abre, o envelope é deste usuário;
               senão preserva como _antiga para não perder ninguém */
            return abreEnvelope(doc, A.pw).then(function () { /* é nosso: será reescrito */ })
              .catch(function () { envelopes._antiga = { salt: doc.salt, iv: doc.iv, ct: doc.ct }; });
          }
        })
        .catch(function () { /* arquivo ainda não existe */ })
        .then(function () {
          if (envelopes[A.user.id]) {
            /* já existe: confere se a senha atual abre; se abrir, nada a fazer */
            return abreEnvelope(envelopes[A.user.id], A.pw).then(function () { return 'ok'; }).catch(function () { return 'regrava'; });
          }
          return 'regrava';
        })
        .then(function (st) {
          if (st === 'ok') return true;
          return fechaEnvelope(token, A.pw).then(function (env) {
            envelopes[A.user.id] = env;
            var body = {
              message: 'chore: guarda a chave de publicação criptografada (nuvem)', branch: 'main',
              content: b64enc(JSON.stringify({ v: 2, envelopes: envelopes }, null, 2))
            };
            if (sha) body.sha = sha;
            return fetch(KEY_URL, { method: 'PUT', headers: h, body: JSON.stringify(body) }).then(function (r) { return r.ok; });
          });
        }).catch(function () { return false; });
    }
  };

  function garanteEstilo() {
    if (document.getElementById('sptx-estilo')) return;
    var estilo = document.createElement('style');
    estilo.id = 'sptx-estilo';
    estilo.textContent = SPTX_CSS;
    (document.head || document.documentElement).appendChild(estilo);
  }
  var SPTX_CSS =
    'html.sptx-lock body{overflow:hidden}' +
    'html.sptx-lock body>*:not(.sptx-gate){display:none!important}' +
    '.sptx-gate{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:22px;background:#004438;font-family:"Archivo",-apple-system,sans-serif}' +
    '.sptx-card{background:#fff;border-radius:16px;padding:36px 30px 30px;width:100%;max-width:390px;box-shadow:0 24px 60px rgba(0,0,0,.35)}' +
    '.sptx-eyebrow{font-family:"IBM Plex Mono",monospace;font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:#EC6C22;margin-bottom:10px}' +
    '.sptx-titulo{font-family:"Fraunces",Georgia,serif;font-weight:600;font-size:30px;line-height:1.1;color:#004438;margin:0 0 6px}' +
    '.sptx-titulo i{color:#EC6C22;font-style:italic}' +
    '.sptx-sub{font-size:13.5px;color:#3D6B60;margin:0 0 18px}' +
    '.sptx-faixa{height:1px;background:#D8D8D3;margin:0 0 22px}' +
    '.sptx-gate label.sptx-l{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#3D6B60;margin-bottom:6px}' +
    '.sptx-gate input[type=password]{width:100%;box-sizing:border-box;font-family:inherit;font-size:16px;padding:12px 14px;border:1.5px solid #D8D8D3;border-radius:10px;color:#004438;outline:none}' +
    '.sptx-gate input[type=password]:focus{border-color:#EC6C22}' +
    '.sptx-erro{display:none;color:#8C1D18;background:#F9DEDC;border:1px solid #E8B3AE;border-radius:8px;font-size:13px;padding:8px 12px;margin-top:10px}' +
    '.sptx-erro.on{display:block}' +
    '.sptx-lembrar{display:flex;align-items:center;gap:8px;font-size:13px;color:#3D6B60;margin:14px 0 18px;cursor:pointer}' +
    '.sptx-lembrar input{accent-color:#004438;width:16px;height:16px}' +
    '.sptx-btn{width:100%;font-family:inherit;font-size:15px;font-weight:700;color:#fff;background:#EC6C22;border:none;border-radius:10px;padding:13px;cursor:pointer;transition:background .15s}' +
    '.sptx-btn:hover{background:#C2531A}' +
    '.sptx-rodape{font-size:11.5px;color:#3D6B60;text-align:center;margin-top:16px}' +
    '@keyframes sptxShake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}' +
    '.sptx-card.shake{animation:sptxShake .35s}';

  /* ---------- fluxo de entrada ---------- */
  var s = leSessao();
  if (s) {
    var u = null;
    if (s.u) { A.usuarios.forEach(function (x) { if (x.id === s.u && x.hash === s.h && x.ativo !== false) u = x; }); }
    if (!u) u = achaPorHash(A.usuarios, s.h);
    if (u) {
      A.user = u;
      /* revalida em segundo plano contra a lista fresca (senha trocada,
         usuário desativado, permissão alterada) */
      usuariosFrescos().then(function (lista) {
        A.usuarios = lista;
        var v = null;
        lista.forEach(function (x) { if (x.hash === s.h && x.ativo !== false) v = x; });
        if (!v) { window.sapataoSair(); return; }
        A.user = v;
        if (!A.temAcesso(APP)) { location.reload(); return; }
        anuncia();
      }).catch(function () {});
      if (!A.temAcesso(APP)) { bloqueiaSemAcesso(); return; }
      anuncia();
      return; /* sessão válida — libera a página */
    }
    /* sessão não bate com ninguém do cache: revalida contra a lista fresca
       antes de pedir senha (pode ser troca recente) */
  }


  /* Trava a página até a senha certa */
  garanteEstilo();
  document.documentElement.classList.add('sptx-lock');

  function montaGate() {
    var gate = document.createElement('div');
    gate.className = 'sptx-gate';
    gate.innerHTML =
      '<form class="sptx-card" autocomplete="off">' +
      '<div class="sptx-eyebrow">Estação Sapatão · Acesso restrito</div>' +
      '<h1 class="sptx-titulo">' + (APP === 'pe' ? 'Planejamento <i>Estratégico</i>' : 'Roadmap <i>Comercial</i>') + '</h1>' +
      '<p class="sptx-sub">Material interno. Digite a sua senha para continuar — ela identifica o seu usuário.</p>' +
      '<div class="sptx-faixa"></div>' +
      '<label class="sptx-l" for="sptx-senha">Senha</label>' +
      '<input type="password" id="sptx-senha" placeholder="••••••••" autofocus>' +
      '<div class="sptx-erro" id="sptx-erro">Senha incorreta. Tente de novo.</div>' +
      '<label class="sptx-lembrar"><input type="checkbox" id="sptx-lembrar" checked> Manter conectado neste dispositivo</label>' +
      '<button type="submit" class="sptx-btn">Entrar</button>' +
      '<div class="sptx-rodape">Um lugar para parar, ficar e voltar.</div>' +
      '</form>';
    document.body.appendChild(gate);
    var form = gate.querySelector('form'),
        campo = gate.querySelector('#sptx-senha'),
        erro = gate.querySelector('#sptx-erro'),
        lembrar = gate.querySelector('#sptx-lembrar');
    campo.focus();
    function entra(user, h, senha) {
      gravaSessao(user, h, lembrar.checked);
      A.user = user;
      /* senha só em memória (nunca gravada): abre o cofre da chave de publicação */
      A.pw = senha || null;
      gate.remove();
      document.documentElement.classList.remove('sptx-lock');
      if (!A.temAcesso(APP)) { bloqueiaSemAcesso(); return; }
      anuncia();
      try { document.dispatchEvent(new CustomEvent('sapatao-login')); } catch (e) {}
    }
    function recusa(msg) {
      erro.textContent = msg || 'Senha incorreta. Tente de novo.';
      erro.classList.add('on');
      form.classList.add('shake');
      campo.select();
      setTimeout(function () { form.classList.remove('shake'); }, 400);
    }
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var senha = campo.value, h = sha256(senha);
      var u = achaPorHash(A.usuarios, h);
      if (u) { entra(u, h, senha); return; }
      /* a lista local pode estar velha (senha trocada há pouco, usuário novo):
         confere a versão fresca do repositório antes de recusar */
      usuariosFrescos().then(function (lista) {
        A.usuarios = lista;
        var v = achaPorHash(lista, h);
        if (v) entra(v, h, senha); else recusa();
      }).catch(function () { recusa(); });
    });
  }

  if (document.body) montaGate();
  else document.addEventListener('DOMContentLoaded', montaGate);
})();
