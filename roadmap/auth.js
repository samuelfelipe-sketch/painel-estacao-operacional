/* ============================================================
   Acesso restrito — Roadmap Comercial · Estação Sapatão
   ------------------------------------------------------------
   A senha não aparece em texto claro: o que fica aqui é o
   hash SHA-256 dela. Para trocar a senha, use a aba
   Configurações do Guia (precisa da chave de publicação) —
   ela reescreve o HASH_SENHA abaixo automaticamente.
   Obs.: é uma proteção de acesso simples de site estático —
   suficiente para uso interno, não para dados sensíveis.
   ============================================================ */
(function () {
  var HASH_SENHA = '9b8769a4a742959a2d0298c36fb70623f2dfacda8436237df08d8dfd5b37374c';
  var CHAVE = 'sapatao-roadmap-auth-v1';

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
        var a = hash[0], e = hash[4];
        var temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ (~e & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0);
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

  function lembrado() {
    var v = null;
    try { v = sessionStorage.getItem(CHAVE) || localStorage.getItem(CHAVE); } catch (e) {}
    if (!v) return false;
    if (v === HASH_SENHA) return true;
    /* hash guardado difere do arquivo (possível cache após troca de senha):
       revalida em segundo plano contra a versão fresca e só desconecta se
       realmente não bater */
    fetch('https://raw.githubusercontent.com/samuelfelipe-sketch/painel-estacao-operacional/main/roadmap/auth.js?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (src) {
        var m = src.match(/HASH_SENHA = '([0-9a-f]{64})'/);
        if (!m || v !== m[1]) window.sapataoSair();
      }).catch(function () {});
    return true;
  }

  /* usado pela aba Configurações do guia para validar e trocar a senha */
  window.sapataoAuth = { hash: HASH_SENHA, sha256: sha256, chave: CHAVE };

  window.sapataoSair = function () {
    try { sessionStorage.removeItem(CHAVE); } catch (e) {}
    try { localStorage.removeItem(CHAVE); } catch (e) {}
    location.reload();
  };

  if (lembrado()) return;

  /* Trava a página até a senha certa */
  document.documentElement.classList.add('sptx-lock');
  var estilo = document.createElement('style');
  estilo.textContent =
    'html.sptx-lock body{overflow:hidden}' +
    'html.sptx-lock body>*:not(.sptx-gate){display:none!important}' +
    '.sptx-gate{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:22px;background:#004438;font-family:"Archivo",-apple-system,sans-serif}' +
    '.sptx-card{background:#fff;border-radius:16px;padding:36px 30px 30px;width:100%;max-width:390px;box-shadow:0 24px 60px rgba(0,0,0,.35)}' +
    '.sptx-eyebrow{font-family:"IBM Plex Mono",monospace;font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:#EC6C22;margin-bottom:10px}' +
    '.sptx-titulo{font-family:"Fraunces",Georgia,serif;font-weight:600;font-size:30px;line-height:1.1;color:#004438;margin:0 0 6px}' +
    '.sptx-titulo i{color:#EC6C22;font-style:italic}' +
    '.sptx-sub{font-size:13.5px;color:#3D6B60;margin:0 0 18px}' +
    '.sptx-faixa{height:6px;border-radius:3px;background:repeating-linear-gradient(90deg,#EC6C22 0 28px,#004438 28px 48px);margin:0 0 22px}' +
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
  (document.head || document.documentElement).appendChild(estilo);

  function montaGate() {
    var gate = document.createElement('div');
    gate.className = 'sptx-gate';
    gate.innerHTML =
      '<form class="sptx-card" autocomplete="off">' +
      '<div class="sptx-eyebrow">Estação Sapatão · Acesso restrito</div>' +
      '<h1 class="sptx-titulo">Roadmap <i>Comercial</i></h1>' +
      '<p class="sptx-sub">Material interno da área comercial. Digite a senha para continuar.</p>' +
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
    function entra(hash) {
      try { sessionStorage.setItem(CHAVE, hash); } catch (e) {}
      if (lembrar.checked) { try { localStorage.setItem(CHAVE, hash); } catch (e) {} }
      gate.remove();
      document.documentElement.classList.remove('sptx-lock');
    }
    function recusa() {
      erro.classList.add('on');
      form.classList.add('shake');
      campo.select();
      setTimeout(function () { form.classList.remove('shake'); }, 400);
    }
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var h = sha256(campo.value);
      if (h === HASH_SENHA) { entra(HASH_SENHA); return; }
      /* a senha pode ter sido trocada há pouco e este arquivo ainda estar em
         cache — confere a versão fresca do repositório antes de recusar */
      fetch('https://raw.githubusercontent.com/samuelfelipe-sketch/painel-estacao-operacional/main/roadmap/auth.js?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.text(); })
        .then(function (src) {
          var m = src.match(/HASH_SENHA = '([0-9a-f]{64})'/);
          if (m && h === m[1]) entra(m[1]); else recusa();
        })
        .catch(recusa);
    });
  }

  if (document.body) montaGate();
  else document.addEventListener('DOMContentLoaded', montaGate);
})();
