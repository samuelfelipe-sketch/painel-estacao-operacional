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
    if (app === 'config') return 'edita'; /* todo usuário gerencia a própria conta */
    if (user.admin) return 'edita';
    return (user.perm || {})[app] || 'nao';
  }
  /* compara nomes de usuário ignorando maiúsculas e acentos */
  function normUser(s) {
    return (s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
    if (document.querySelector('.sptx-gate')) return; /* já está na tela — não duplica nem pisca */
    garanteEstilo();
    document.documentElement.classList.add('sptx-lock');
    var d = document.createElement('div');
    d.className = 'sptx-gate';
    d.innerHTML = '<div class="sptx-card"><div class="sptx-eyebrow">Estação Sapatão</div>'
      + '<h1 class="sptx-titulo">Sem <i>acesso</i></h1>'
      + '<p class="sptx-sub">O usuário <b>' + (A.user ? A.user.nome : '') + '</b> não tem acesso a este painel. Fale com o administrador para liberar a permissão.</p>'
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
    /* baixa e abre o envelope do usuário logado (quando falta a chave de
       publicação OU a chave dos dados — um token velho no aparelho não pode
       impedir a recuperação: o envelope traz o token atual e a DEK juntos) */
    busca: function () {
      if (!A.user || !A.pw || !window.crypto || !crypto.subtle) return Promise.resolve(false);
      if (C.token() && window.sapataoCofre.dek()) return Promise.resolve(false); /* já tem tudo */
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
              var p = null; try { p = JSON.parse(t); } catch (e) {}
              if (p && p.t) { C.grava(p.t); if (p.k) window.sapataoCofre.gravaDek(p.k); }
              else C.grava(t);
              /* envelope antigo sem a DEK: tenta o canal reserva com o token
                 recém-recebido (dek.enc.json embrulhado pelo token) */
              if (!window.sapataoCofre.dek()) return window.sapataoCofre.baixaDekPeloToken().then(function () { return true; });
              return true;
            }).catch(function () { return tenta(i + 1); });
          };
          return tenta(0);
        }).catch(function () { return false; });
    },
    /* garante que o envelope do usuário logado existe na nuvem (v2),
       preservando os envelopes dos outros usuários */
    garante: function () {
      if (!A.user || !A.pw) return Promise.resolve(false);
      return C.garantePara(A.user.id, A.pw);
    },
    /* grava o envelope de QUALQUER usuário (o admin usa ao criar um usuário
       ou redefinir a senha dele — a chave chega sozinha nos aparelhos da pessoa) */
    garantePara: function (userId, pw) {
      var token = C.token();
      if (!token || !userId || !pw || !window.crypto || !crypto.subtle) return Promise.resolve(false);
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
            return abreEnvelope(doc, pw).then(function () { /* é nosso: será reescrito */ })
              .catch(function () { envelopes._antiga = { salt: doc.salt, iv: doc.iv, ct: doc.ct }; });
          }
        })
        .catch(function () { /* arquivo ainda não existe */ })
        .then(function () {
          if (envelopes[userId]) {
            /* já existe: confere se a senha abre e se o conteúdo está atual */
            return abreEnvelope(envelopes[userId], pw).then(function (t) {
              var p = null; try { p = JSON.parse(t); } catch (e) { p = { t: t }; }
              var dek = window.sapataoCofre.dek();
              return (p.t === token && (!dek || p.k === dek)) ? 'ok' : 'regrava';
            }).catch(function () { return 'regrava'; });
          }
          return 'regrava';
        })
        .then(function (st) {
          if (st === 'ok') return true;
          var carga = { t: token };
          if (window.sapataoCofre.dek()) carga.k = window.sapataoCofre.dek();
          return fechaEnvelope(JSON.stringify(carga), pw).then(function (env) {
            envelopes[userId] = env;
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

  /* ---------- cofre dos DADOS (criptografia de ponta a ponta) ----------
     Os arquivos sensíveis do site ficam cifrados (AES-256-GCM) com uma
     chave de dados (DEK) aleatória. A DEK viaja: (a) dentro do envelope
     de cada usuário ({t: token, k: dek}, aberto pela senha) e (b) em
     roadmap/dek.enc.json, embrulhada pela própria chave de publicação —
     assim qualquer aparelho autorizado destrava. Sem usuário e senha
     válidos, os arquivos são ilegíveis. */
  var LS_DEK = 'sapatao-dek-v1';
  var DEK_URL = API_BASE + 'roadmap/dek.enc.json';
  var K = window.sapataoCofre = {
    ls: LS_DEK,
    dek: function () { try { return localStorage.getItem(LS_DEK) || ''; } catch (e) { return ''; } },
    gravaDek: function (d) { try { if (d) localStorage.setItem(LS_DEK, d); else localStorage.removeItem(LS_DEK); } catch (e) {} },
    gera: function () { return b64bytes(crypto.getRandomValues(new Uint8Array(32))); },
    chaveAes: function () { return crypto.subtle.importKey('raw', bytesB64(K.dek()), 'AES-GCM', false, ['encrypt', 'decrypt']); },
    /* objeto → {enc:1, iv, ct} */
    cifra: function (obj) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return K.chaveAes().then(function (key) {
        return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
      }).then(function (ct) { return { enc: 1, iv: b64bytes(iv), ct: b64bytes(new Uint8Array(ct)) }; });
    },
    /* {enc:1,...} → objeto (null se não abrir); documento aberto passa direto */
    decifra: function (doc) {
      if (!doc || doc.enc !== 1) return Promise.resolve(doc);
      if (!K.dek()) return Promise.resolve(null);
      return K.chaveAes().then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytesB64(doc.iv) }, key, bytesB64(doc.ct));
      }).then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); })
        .catch(function () { return null; });
    },
    /* canal reserva: DEK embrulhada pela chave de publicação */
    baixaDekPeloToken: function () {
      var token = C.token();
      if (K.dek() || !token) return Promise.resolve(!!K.dek());
      return fetch(DEK_URL + '?ref=main&t=' + Date.now(), { headers: { 'Accept': 'application/vnd.github+json' }, cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (j) { return abreEnvelope(JSON.parse(b64dec(j.content)), token); })
        .then(function (d) { if (d) { K.gravaDek(d); return true; } return false; })
        .catch(function () { return false; });
    },
    publicaDekPeloToken: function () {
      var token = C.token();
      if (!token || !K.dek()) return Promise.resolve(false);
      var h = { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
      var sha = null;
      return fetch(DEK_URL + '?ref=main&t=' + Date.now(), { headers: h, cache: 'no-store' })
        .then(function (g) { if (g.ok) return g.json(); }).then(function (j) { if (j) sha = j.sha; })
        .catch(function () {})
        .then(function () { return fechaEnvelope(K.dek(), token); })
        .then(function (env) {
          var body = { message: 'chore: guarda a chave dos dados criptografada (nuvem)', branch: 'main', content: b64enc(JSON.stringify(env, null, 2)) };
          if (sha) body.sha = sha;
          return fetch(DEK_URL, { method: 'PUT', headers: h, body: JSON.stringify(body) }).then(function (r) { return r.ok; });
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
    '.sptx-gate input[type=password],.sptx-gate input[type=text]{width:100%;box-sizing:border-box;font-family:inherit;font-size:16px;padding:12px 14px;border:1.5px solid #D8D8D3;border-radius:10px;color:#004438;outline:none;background:#fff}' +
    '.sptx-gate input[type=password]:focus,.sptx-gate input[type=text]:focus{border-color:#EC6C22}' +
    '.sptx-campo{margin-bottom:14px}' +
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
  /* login programático (usado pelo campo de login da central) */
  A.login = function (usuarioDig, senha, lembrar) {
    var dig = normUser(usuarioDig), h = sha256(senha);
    if (!dig || !senha) return Promise.resolve(null);
    function bate(lista) {
      for (var i = 0; i < lista.length; i++) {
        var u = lista[i];
        if (u.ativo === false) continue;
        if ((normUser(u.nome) === dig || normUser(u.id) === dig) && u.hash === h) return u;
      }
      return null;
    }
    function fim(u) {
      if (!u) return null;
      gravaSessao(u, h, lembrar !== false);
      A.user = u; A.pw = senha;
      anuncia();
      try { document.dispatchEvent(new CustomEvent('sapatao-login')); } catch (e) {}
      return u;
    }
    var u = bate(A.usuarios);
    if (u) return Promise.resolve(fim(u));
    return usuariosFrescos().then(function (l) { A.usuarios = l; return fim(bate(l)); }).catch(function () { return null; });
  };
  if (APP === 'central') {
    /* a central é aberta: nunca trava; só resolve a sessão, se houver */
    if (s) {
      var uc = null;
      if (s.u) { A.usuarios.forEach(function (x) { if (x.id === s.u && x.hash === s.h && x.ativo !== false) uc = x; }); }
      if (!uc) uc = achaPorHash(A.usuarios, s.h);
      if (uc) {
        A.user = uc; anuncia();
        usuariosFrescos().then(function (lista) {
          A.usuarios = lista;
          var v2 = null;
          lista.forEach(function (x) { if (x.hash === s.h && x.ativo !== false) v2 = x; });
          A.user = v2; anuncia();
        }).catch(function () {});
      }
    }
    return;
  }
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
        /* sem permissão confirmada na lista fresca: se a tela "Sem acesso" já
           está no ar, fica como está (recarregar aqui fazia a tela piscar em
           loop); se a página estava aberta (acesso revogado agora), recarrega
           uma única vez para limpar o conteúdo — na volta o cache já vem
           atualizado e a tela trava antes de qualquer conteúdo entrar */
        if (!A.temAcesso(APP)) {
          if (document.querySelector('.sptx-gate')) return;
          location.reload(); return;
        }
        /* tinha caído na tela "Sem acesso" pelo cache, mas a permissão acabou
           de ser liberada: um único reload destrava (sem loop — na volta há acesso) */
        if (document.querySelector('.sptx-gate')) { location.reload(); return; }
        anuncia();
      }).catch(function () {});
      if (!A.temAcesso(APP)) { bloqueiaSemAcesso(); return; }
      anuncia();
      return; /* sessão válida — libera a página */
    }
    /* sessão não bate com ninguém do cache: revalida contra a lista fresca
       antes de pedir senha (pode ser troca recente) */
  }


  /* O login agora acontece só na CENTRAL DE ACESSOS.
     Sem sessão válida aqui, a página manda para lá. */
  function vaiParaCentral() { location.replace('../index.html'); }
  if (s) {
    /* a sessão não bateu com o cache local: confere a lista fresca
       (senha trocada há pouco / usuário novo) antes de redirecionar */
    garanteEstilo();
    document.documentElement.classList.add('sptx-lock');
    usuariosFrescos().then(function (lista) {
      A.usuarios = lista;
      var v = null;
      lista.forEach(function (x) { if (x.hash === s.h && x.ativo !== false) v = x; });
      if (!v) { vaiParaCentral(); return; }
      A.user = v;
      if (!A.temAcesso(APP)) { document.documentElement.classList.remove('sptx-lock'); bloqueiaSemAcesso(); return; }
      document.documentElement.classList.remove('sptx-lock');
      anuncia();
      try { document.dispatchEvent(new CustomEvent('sapatao-login')); } catch (e) {}
    }).catch(function () { vaiParaCentral(); });
  } else {
    vaiParaCentral();
  }
})();
