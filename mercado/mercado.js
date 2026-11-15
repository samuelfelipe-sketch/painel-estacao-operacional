/* Market Share — lógica do painel na visão TAM · SAM · SOM (refeito em 15/11/2026).
   Recebe window.DADOS_MERCADO = {anp, sapatao, raio, estim, exp, regiao, frota} (ver index.html) e desenha
   tudo na tela; window.renderMercado(D) redesenha quando um arquivo publicado muda.
   Nenhum número fica escrito aqui: tudo vem dos arquivos.

   anp.dados.RS[AAAA-MM][segmento][produto] = {Raízen, Ipiranga, …, Outras, Total} em mil m³
   sapatao.meses[AAAA-MM] = {parcial, cobertura, band:{…}, unid:{cod:{otto,gasolina,etanol,diesel}}} em m³
   raio.unidades[cod] = {postos:[concorrentes escolhidos], a_revisar, infra, …} (mercado/postos-raio.json)
   estim.postos[cnpj] = volume informado pela diretoria (mercado/estimativas.enc.json, cifrado)

   TAM = vendas das distribuidoras aos postos revendedores do RS.
   SAM = área de cada unidade: nossas compras + volume estimado dos concorrentes escolhidos.
   SOM = nossas compras ÷ SAM.
   PRÉVIA: mês sem ANP = mês anterior × (mesmo mês ÷ mês anterior, no ano passado), em cadeia;
   mês em curso do Sapatão = compras até o dia coberto, projetadas pelo ritmo para o mês inteiro. */
(function () {
  'use strict';
  var D = window.DADOS_MERCADO;
  var ESC = 'RS';
  var PROD_NOME = { tot: 'Consolidado', otto: 'Ciclo Otto', diesel: 'Diesel' };
  var MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var BANDS = ['Raízen', 'Ipiranga'];
  var FAIXA = 1; /* até ±1 p.p. de diferença de crescimento = em linha com o mercado */
  var COR_UN = ['#004438', '#EC6C22', '#3E6BD6', '#8A5A00', '#6F2DA8'];

  /* ---------- estado (lembrado por aparelho) ---------- */
  var st = { prod: 'tot', per: 'mes', mes: null, un: null, aba: 'unidades' }; /* un: null = todas as unidades */
  try { var g = JSON.parse(localStorage.getItem('sapatao-mercado-estado-v2') || 'null'); if (g) ['prod', 'per', 'un', 'aba'].forEach(function (k) { if (g[k]) st[k] = g[k]; }); } catch (e) {}
  try { var hb = (location.hash || '').replace('#', ''); if (/^(unidades|evolucao|bandeiras|expansao|fontes)$/.test(hb)) st.aba = hb; } catch (e) {}
  if (!/^(unidades|evolucao|bandeiras|expansao|fontes)$/.test(st.aba)) st.aba = 'unidades';
  function guarda() { try { localStorage.setItem('sapatao-mercado-estado-v2', JSON.stringify({ prod: st.prod, per: st.per, un: st.un, aba: st.aba })); } catch (e) {} }

  /* ---------- formatação ---------- */
  var nf = {};
  function num(x, d) { if (x == null || !isFinite(x)) return '—'; var k = d || 0; nf[k] = nf[k] || new Intl.NumberFormat('pt-BR', { minimumFractionDigits: k, maximumFractionDigits: k }); return nf[k].format(x); }
  function pct(x, d) { if (x == null || !isFinite(x)) return '—'; return num(x, d == null ? (x < 1 ? 2 : 1) : d) + '%'; }
  function pp(x, d) { if (x == null || !isFinite(x)) return ''; var k = d == null ? 2 : d; if (Math.abs(x) < 0.5 / Math.pow(10, k)) return '0 p.p.'; return (x > 0 ? '+' : '') + num(x, k) + ' p.p.'; }
  function sinal(x, d) { return x == null ? '—' : (x > 0 ? '+' : '') + num(x, d == null ? 1 : d) + '%'; }
  function cls(x) { return x == null || !isFinite(x) ? 'ne' : x > 0 ? 'up' : x < 0 ? 'dn' : 'ne'; }
  function mesLbl(ym) { var a = ym.split('-'); return MESES_PT[+a[1] - 1] + '/' + a[0].slice(2); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el(id) { return document.getElementById(id); }
  function anoAnt(ym) { return (+ym.slice(0, 4) - 1) + ym.slice(4); }
  function shiftMes(ym, d) { var a = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + d; var y = a + Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + String(m + 1).padStart(2, '0'); }
  function ultimoDia(ym) { return new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(); }
  function cresc(a, b) { return (a != null && b != null && a > 0) ? (b / a - 1) * 100 : null; }
  function fmtVar(v) { return v == null ? '<span class="falta">—</span>' : '<span class="' + cls(v) + '">' + sinal(v) + '</span>'; }
  function fmtDif(v, d) { return v == null ? '<span class="falta">—</span>' : '<b class="' + cls(v) + '">' + pp(v, d == null ? 1 : d) + '</b>'; }
  function traco() { return '<span class="falta">—</span>'; }
  var CIDADES = { 'ESTANCIA VELHA': 'Estância Velha', 'PORTAO': 'Portão', 'DOIS IRMAOS': 'Dois Irmãos', 'SAO LEOPOLDO': 'São Leopoldo' };
  function nomeCidade(m) { if (CIDADES[m]) return CIDADES[m]; return String(m).toLowerCase().split(' ').map(function (w) { return /^(de|do|da|dos|das|e)$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1); }).join(' '); }
  function nomePosto(n) { return nomeCidade(String(n || '').replace(/\s+EM RECUPERACAO JUDICIAL/i, '').replace(/\s+(LTDA\.?|EIRELI|S\.?A\.?|ME|EPP)\s*$/i, '').trim()); }
  function nomeBand(b) { return !b ? '—' : /BRANCA/i.test(b) ? 'Bandeira branca' : /RAIZEN/i.test(b) ? 'Raízen' : nomeCidade(b); }

  /* ---------- mercado (ANP) com prévia ---------- */
  function anpMes(ym) { return D.anp && D.anp.dados && D.anp.dados[ESC] && D.anp.dados[ESC][ym] || null; }
  function anpParcial(ym) { return !!(D.anp.status && D.anp.status[ym] && D.anp.status[ym].parcial); }
  function mesesAnp() { return Object.keys((D.anp.dados || {})[ESC] || {}).sort(); }
  function ehPrevia(ym) { return !anpMes(ym); }
  /* mercado publicado: {Total, Raízen, …} em mil m³, ou null */
  function mktReal(ym, seg, prod) {
    var m = anpMes(ym); if (!m) return null;
    var s = m[seg || 'rev']; if (!s) return null;
    var p = prod || st.prod;
    if (p !== 'tot') return s[p] || null;
    var o = s.otto, d = s.diesel, r = {};
    Object.keys(o).forEach(function (k) { r[k] = (o[k] || 0) + (d[k] || 0); });
    return r;
  }
  /* mercado publicado ou, depois do último mês da ANP, projetado: mês anterior × sazonalidade do ano passado */
  var memo = {};
  function mktP(ym, seg, prod) {
    seg = seg || 'rev'; prod = prod || st.prod;
    var k = ym + '|' + seg + '|' + prod; if (k in memo) return memo[k];
    var r = mktReal(ym, seg, prod);
    if (!r) {
      var ms = mesesAnp(), ult = ms[ms.length - 1];
      if (ult && ym > ult && ym <= shiftMes(ult, 6)) {
        if (prod === 'tot') {
          var o = mktP(ym, seg, 'otto'), d = mktP(ym, seg, 'diesel');
          if (o && d) { r = { _prev: true }; Object.keys(o).forEach(function (kk) { if (kk !== '_prev') r[kk] = (o[kk] || 0) + (d[kk] || 0); }); }
        } else {
          var p = shiftMes(ym, -1), base = mktP(p, seg, prod), a = mktReal(anoAnt(ym), seg, prod), b = mktReal(anoAnt(p), seg, prod);
          if (base && a && b && b.Total > 0) { var f = a.Total / b.Total; r = { _prev: true }; Object.keys(base).forEach(function (kk) { if (kk !== '_prev') r[kk] = base[kk] * f; }); }
        }
      }
    }
    return (memo[k] = r || null);
  }

  /* ---------- Sapatão (compras) ---------- */
  function UNID() { return D.sapatao.unidades || {}; }
  function codigosUn() { return Object.keys(UNID()).sort(); }
  function unSel() { var sel = st.un && st.un.length ? st.un.filter(function (u) { return UNID()[u]; }) : codigosUn(); if (!sel.length) sel = codigosUn(); return sel; }
  function todasUn() { return unSel().length === codigosUn().length; }
  function nomes(uu) { return uu.map(function (u) { return UNID()[u].nome; }).join(' + '); }
  function quem() { return todasUn() ? 'Sapatão' : nomes(unSel()); }
  function sapMes(ym) { return D.sapatao && D.sapatao.meses && D.sapatao.meses[ym] || null; }
  function sapParcial(ym) { var m = sapMes(ym); return !!(m && m.parcial); }
  function mesesSap() { return Object.keys(D.sapatao.meses || {}).sort(); }
  function volDe(v, p) { return v ? (p === 'tot' ? (v.otto || 0) + (v.diesel || 0) : (v[p] || 0)) : 0; }
  /* mês em curso: compras até o dia coberto × (dias do mês ÷ dias cobertos) */
  function fatorCurso(ym) {
    var m = sapMes(ym); if (!m || !m.parcial || !m.cobertura) return 1;
    var cob = +m.cobertura.ate.slice(8) - +m.cobertura.de.slice(8) + 1;
    return cob > 0 ? ultimoDia(ym) / cob : 1;
  }
  /* compras das unidades uu no mês (m³), já projetadas se o mês está em curso; null sem dado */
  function nos(ym, uu, prod) {
    var m = sapMes(ym); if (!m) return null;
    var p = prod || st.prod, s = 0;
    if (m.unid) uu.forEach(function (u) { s += volDe(m.unid[u], p); });
    else if (uu.length === codigosUn().length) BANDS.forEach(function (b) { s += volDe(m.band[b], p); });
    else return null;
    return s * fatorCurso(ym);
  }
  function nosDe(ms, uu, prod) { var s = 0; for (var i = 0; i < ms.length; i++) { var v = nos(ms[i], uu, prod); if (v == null) return null; s += v; } return ms.length ? s : null; }
  function tamDe(ms) { var s = 0; for (var i = 0; i < ms.length; i++) { var x = mktP(ms[i], 'rev'); if (!x) return null; s += x.Total * 1000; } return ms.length ? s : null; }
  /* carteira do gerente de vendas (GV) da bandeira: participação na bandeira ÷ fração da carteira */
  function carteira(b) { var c = D.sapatao.carteiras && D.sapatao.carteiras[b]; return (c && (c.escopo || 'RS') === ESC) ? c : null; }
  function naCarteira(b, shB) { var c = carteira(b); if (!c || shB == null) return null; return c.fracao ? shB / c.fracao : null; }

  /* ---------- períodos ---------- */
  function mesesPeriodo(ym, per) {
    per = per || st.per;
    if (per === 'mes') return [ym];
    var a = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var ini = per === 'ano' ? 1 : per === 'sem' ? (m <= 6 ? 1 : 7) : Math.floor((m - 1) / 3) * 3 + 1;
    var out = []; for (var k = ini; k <= m; k++) out.push(a + '-' + String(k).padStart(2, '0'));
    return out;
  }
  function perLbl(ym, per) {
    per = per || st.per; if (per === 'mes') return mesLbl(ym);
    var ms = mesesPeriodo(ym, per), a = ym.slice(2, 4), m = +ym.slice(5, 7);
    var nome = per === 'ano' ? ym.slice(0, 4) : per === 'sem' ? (m <= 6 ? '1º' : '2º') + ' sem/' + a : Math.ceil(m / 3) + 'º tri/' + a;
    var ini = mesLbl(ms[0]).slice(0, 3), fim = mesLbl(ym).slice(0, 3);
    return nome + ' (' + (ms.length === 1 ? ini : ini + '–' + fim) + ')';
  }
  /* meses do período que têm mercado (publicado ou prévia) e compras do Sapatão */
  function mesesValidos() { return mesesPeriodo(st.mes).filter(function (m) { return mktP(m, 'rev') && sapMes(m); }); }

  /* ---------- concorrentes: volume estimado de cada posto ---------- */
  var BAND_ANP = { VIBRA: 'Vibra', RAIZEN: 'Raízen', IPIRANGA: 'Ipiranga', RODOIL: 'Rodoil', CHARRUA: 'Charrua', POTENCIAL: 'Potencial', 'SANTA LUCIA': 'Santa Lucia', STANG: 'Stang', CIAPETRO: 'Ciapetro' };
  function temRaio() { return !!(D.raio && D.raio.unidades && D.raio.rs_postos); }
  /* média por posto da bandeira b no RS no mês, num grupo de produto ('otto' ou 'diesel') */
  function mediaPosto(ym, b, prod) {
    var R = D.raio, cad = R.rs_bandeiras || {};
    if (/BRANCA/i.test(b || '')) { var bb = mktP(ym, 'bb', prod); if (bb && cad['BANDEIRA BRANCA']) return bb.Total * 1000 / cad['BANDEIRA BRANCA']; }
    else if (BAND_ANP[b] && cad[b]) { var bd = mktP(ym, 'band', prod); if (bd && bd[BAND_ANP[b]] > 0) return bd[BAND_ANP[b]] * 1000 / cad[b]; }
    var rv = mktP(ym, 'rev', prod); return rv && R.rs_postos ? rv.Total * 1000 / R.rs_postos : null;
  }
  /* bicos médios por posto da bandeira no RS (API de Revendedores); bandeira pequena usa o RS todo */
  function bicosMedios(b, g) {
    var I = D.raio.rs_infra; if (!I) return null;
    var s = I[b]; if (s && s.n >= 5 && s['b' + g] > 0) return s['b' + g] / s.n;
    var n = 0, t = 0; Object.keys(I).forEach(function (k) { n += I[k].n; t += I[k]['b' + g]; }); return n ? t / n : null;
  }
  /* régua automática por grupo: média da bandeira × (bicos do posto ÷ bicos médios da bandeira); sem bicos, a média */
  function autoPosto(ym, p, prod) {
    var g = prod === 'otto' ? 'o' : 'd', m = mediaPosto(ym, p.bandeira, prod); if (m == null) return null;
    var bm = p.infra ? bicosMedios(p.bandeira, g) : null;
    return m * (p.infra && bm ? p.infra['b' + g] / bm : 1);
  }
  /* estimativa informada: fator = informado ÷ régua no mês de referência, aplicado à régua de cada mês */
  function informada(p) { var E = D.estim && D.estim.postos; return E && E[p.cnpj] || null; }
  function fatores(p) {
    var e = informada(p); if (!e) return null;
    var ref = anpMes(e.ref) ? e.ref : D.anp.ultimo_fechado;
    var o = autoPosto(ref, p, 'otto') || 0, d = autoPosto(ref, p, 'diesel') || 0;
    if (e.otto != null && e.diesel != null) return { otto: o ? e.otto / o : null, diesel: d ? e.diesel / d : null, fixo: { otto: o ? null : e.otto, diesel: d ? null : e.diesel } };
    var f = o + d ? e.total / (o + d) : null; return { otto: f, diesel: f, fixo: { otto: f == null ? e.total * 0.5 : null, diesel: f == null ? e.total * 0.5 : null } };
  }
  function estPosto(ym, p) {
    var gs = st.prod === 'tot' ? ['otto', 'diesel'] : [st.prod], t = 0, F = fatores(p);
    for (var i = 0; i < gs.length; i++) {
      if (F && F.fixo[gs[i]] != null) { t += F.fixo[gs[i]]; continue; }
      var a = autoPosto(ym, p, gs[i]); if (a == null) return null;
      t += a * (F && F[gs[i]] != null ? F[gs[i]] : 1);
    }
    return t;
  }
  function lista(u) { return ((D.raio.unidades[u] || {}).postos || []).filter(function (p) { return !p.fora_do_cadastro; }); }
  function uniao(uu) { var vis = {}, r = []; uu.forEach(function (u) { lista(u).forEach(function (p) { if (!vis[p.cnpj]) { vis[p.cnpj] = 1; r.push(p); } }); }); return r; }
  function conc(ms, ps) { var s = 0; for (var i = 0; i < ms.length; i++) for (var j = 0; j < ps.length; j++) { var a = estPosto(ms[i], ps[j]); if (a == null) return null; s += a; } return s; }
  /* SAM e SOM (média por mês) das unidades uu contra os concorrentes ps; só meses em que alguma delas comprou */
  function calc(ms, uu, ps) {
    ms = ms.filter(function (m) { return mktP(m, 'rev') && uu.some(function (u) { return nos(m, [u]) > 0; }); });
    if (!ms.length) return null;
    var n = nosDe(ms, uu), c = conc(ms, ps); if (c == null || n == null) return null;
    return { n: ms.length, ms: ms, sam: (c + n) / ms.length, nos: n / ms.length, conc: c / ms.length / (ps.length || 1), som: n / (c + n) * 100 };
  }
  /* SOM da seleção e a variação contra o ano anterior nas MESMAS unidades (unidade nova não infla a conta) */
  function somSel(meses, uu) {
    var a = calc(meses, uu, uniao(uu)); if (!a) return null;
    var uB = uu.filter(function (u) { var x = calc(meses, [u], lista(u)); return x && calc(x.ms.map(anoAnt), [u], lista(u)); });
    var aV = uB.length === uu.length ? a : uB.length ? calc(meses, uB, uniao(uB)) : null;
    var b = aV ? calc(aV.ms.map(anoAnt), uB, uniao(uB)) : null;
    if (b && aV && b.n !== aV.n) b = null;
    return { a: a, aV: aV, b: b, uB: uB, dif: aV && b ? aV.som - b.som : null };
  }

  /* ---------- resumo do período: TAM, rede e mesmas unidades ---------- */
  function resumo() {
    var us = unSel(), meses = mesesValidos(), base = meses.map(anoAnt);
    var temBase = meses.length > 0 && base.every(function (m) { return mktReal(m, 'rev') && sapMes(m); });
    var r = { us: us, meses: meses, base: base, temBase: temBase, n: meses.length };
    r.tam = tamDe(meses); r.nos = nosDe(meses, us);
    r.tamA = temBase ? tamDe(base) : null; r.nosA = temBase ? nosDe(base, us) : null;
    r.mesmas = temBase ? us.filter(function (u) { return nosDe(base, [u]) > 0 && nosDe(meses, [u]) > 0; }) : [];
    r.novas = temBase ? us.filter(function (u) { return !(nosDe(base, [u]) > 0) && nosDe(meses, [u]) > 0; }) : [];
    r.nosM = r.mesmas.length ? nosDe(meses, r.mesmas) : null; r.nosMA = r.mesmas.length ? nosDe(base, r.mesmas) : null;
    r.gTam = cresc(r.tamA, r.tam); r.gNos = cresc(r.nosA, r.nos); r.gMesmas = cresc(r.nosMA, r.nosM);
    r.fat = r.tam && r.nos != null ? r.nos / r.tam * 100 : null; r.fatA = r.tamA && r.nosA != null ? r.nosA / r.tamA * 100 : null;
    r.previa = meses.some(ehPrevia); r.curso = meses.some(sapParcial);
    return r;
  }
  function seloPrevia(r) { return r.previa || r.curso ? ' <span class="parc">PRÉVIA</span>' : ''; }

  /* ---------- seletor de mês ---------- */
  function montaMeses() {
    var sel = el('selMes'), lista = mesesSap().filter(function (m) { return mktP(m, 'rev'); }).reverse();
    if (!st.mes || lista.indexOf(st.mes) < 0) {
      /* padrão: último mês com compras fechadas (com ANP publicada ou em prévia) */
      var ok = lista.filter(function (m) { return !sapParcial(m); });
      st.mes = ok[0] || lista[0] || null;
    }
    sel.innerHTML = lista.map(function (m) {
      var tag = sapParcial(m) ? ' · em curso' : ehPrevia(m) ? ' · prévia' : anpParcial(m) ? ' · ANP fechando' : '';
      return '<option value="' + m + '"' + (m === st.mes ? ' selected' : '') + '>' + mesLbl(m) + tag + '</option>';
    }).join('');
  }

  /* ---------- chips de contexto ---------- */
  function chips() {
    var c = [], ma = mesesAnp(), ultA = ma[ma.length - 1], ms = mesesSap(), ult = ms[ms.length - 1];
    var cob = ult && sapMes(ult).cobertura ? sapMes(ult).cobertura.ate : null;
    c.push('<span class="chip">ANP até <b>' + (ultA ? mesLbl(ultA) : '—') + '</b> · compras até <b>' + (cob ? cob.slice(8) + '/' + cob.slice(5, 7) : ult ? mesLbl(ult) : '—') + '</b></span>');
    if (st.per !== 'mes') c.push('<span class="chip"><b>' + perLbl(st.mes) + '</b></span>');
    var meses = mesesValidos(), prev = meses.filter(ehPrevia), curso = meses.filter(sapParcial);
    if (prev.length) c.push('<span class="chip alerta" title="A ANP ainda não publicou: mercado projetado pela variação do mesmo mês no ano passado">Prévia: mercado de ' + prev.map(mesLbl).join(', ') + ' projetado</span>');
    if (curso.length) c.push('<span class="chip alerta" title="Compras até o último dia lançado, projetadas pelo ritmo para o mês inteiro">' + curso.map(mesLbl).join(', ') + ' em curso (até dia ' + sapMes(curso[0]).cobertura.ate.slice(8) + ')</span>');
    meses.filter(function (m) { return !ehPrevia(m) && anpParcial(m); }).forEach(function (m) { c.push('<span class="chip alerta">ANP ainda fechando ' + mesLbl(m) + '</span>'); });
    el('chips').innerHTML = c.join('');
    el('ref').textContent = 'ANP ' + (D.anp.gerado_em || '').slice(0, 10).split('-').reverse().join('/') + ' · Sapatão ' + (D.sapatao.atualizado_em || '').slice(0, 10).split('-').reverse().join('/');
  }

  /* ---------- funil do período: TAM → SAM → SOM e o veredito ---------- */
  function funil() {
    var r = resumo(), us = r.us, baseTxt = perLbl(anoAnt(st.mes)), porMes = r.n > 1 ? '/mês' : '';
    function delta(v, txt) { return v == null ? '' : '<span class="delta ' + cls(v) + '">' + txt + '</span>'; }
    function card(sig, nome, val, sub, deltas, extra) {
      return '<div class="bomba fn"><div class="lbl"><b>' + sig + '</b> · ' + nome + '</div><div class="val">' + val + '</div><div class="sub">' + sub + '</div>' + (deltas ? '<div class="deltas">' + deltas + '</div>' : '') + (extra || '') + '</div>';
    }
    if (!r.n) { el('funil').innerHTML = card('TAM', 'mercado dos postos do RS', '—', 'Sem mercado e compras para ' + esc(perLbl(st.mes)) + '.'); el('veredito').innerHTML = ''; return; }
    var h = '';
    /* TAM */
    h += card('TAM', 'postos do RS', num(r.tam / r.n / 1000, 1) + '<small>mil m³' + porMes + '</small>',
      esc(quem()) + ': <b>' + pct(r.fat, 2) + '</b>' + (r.fatA != null ? ' <small>(era ' + pct(r.fatA, 2) + ')</small>' : ''),
      delta(r.gTam, sinal(r.gTam) + ' vs ' + baseTxt));
    /* SAM e SOM */
    var S = temRaio() ? somSel(r.meses, us) : null;
    if (!S) {
      h += card('SAM', 'nossas áreas', '—', temRaio() ? 'Sem compras no período.' : 'Sem lista de concorrentes.');
      h += card('SOM', 'nossa fatia', '—', '');
    } else {
      var nConc = uniao(us).length, samA = r.temBase ? calc(r.base, us, uniao(us)) : null, gSam = samA && samA.n === S.a.n ? cresc(samA.sam, S.a.sam) : null;
      h += card('SAM', us.length > 1 ? 'nossas áreas' : 'área do ' + esc(nomes(us)), num(S.a.sam, 0) + '<small>m³/mês</small>',
        'Nós + ' + nConc + ' concorrentes',
        delta(gSam, sinal(gSam) + ' vs ' + baseTxt));
      var soMesmas = S.uB.length && S.uB.length < us.length;
      h += card('SOM', 'nossa fatia', pct(S.a.som, 1), num(S.a.nos, 0) + ' de ' + num(S.a.sam, 0) + ' m³/mês',
        S.dif != null ? delta(S.dif, pp(S.dif, 1) + ' vs ' + baseTxt + (soMesmas ? ' (' + esc(nomes(S.uB)) + ')' : '')) : '');
    }
    el('funil').innerHTML = h;
    /* veredito: o Sapatão cresce mais ou menos que o mercado dos postos? */
    var v = el('veredito');
    if (!r.temBase || r.gTam == null) { v.innerHTML = ''; return; }
    var gRef = r.gMesmas != null ? r.gMesmas : r.gNos, d = gRef != null ? gRef - r.gTam : null;
    var titulo = d == null ? 'Sem base de comparação' : d > FAIXA ? 'Ganhando participação' : d < -FAIXA ? 'Perdendo participação' : 'Em linha com o mercado';
    var frase = '<b class="' + (d > FAIXA ? 'up' : d < -FAIXA ? 'dn' : '') + '">' + titulo + '.</b>' + seloPrevia(r) + ' ' + esc(quem()) + ' <b class="' + cls(r.gNos) + '">' + sinal(r.gNos) + '</b>' +
      (r.novas.length && r.gMesmas != null ? ' (' + sinal(r.gMesmas) + ' sem ' + esc(nomes(r.novas)) + ')' : '') + ' contra <b>' + sinal(r.gTam) + '</b> do TAM, vs ' + esc(baseTxt) + '.';
    v.innerHTML = '<div class="frase">' + frase + '</div>';
  }

  /* ---------- aba Unidades: SAM e SOM de cada unidade, com o ranking da área ao tocar ---------- */
  var ABERTOS = {};
  function rankDe(u, meses) {
    var a = calc(meses, [u], lista(u)); if (!a) return null;
    var ls = lista(u).map(function (p) { var s = 0; for (var i = 0; i < a.ms.length; i++) { var e = estPosto(a.ms[i], p); if (e == null) return null; s += e; } return { p: p, v: s / a.ms.length }; }).filter(Boolean);
    ls.push({ nos: true, v: a.nos });
    ls.sort(function (q, r) { return r.v - q.v; });
    var pos = 0; ls.forEach(function (q, i) { if (q.nos) pos = i + 1; });
    return { a: a, ls: ls, pos: pos };
  }
  function unidades() {
    var t = el('tReg'), meses = mesesValidos(), us = unSel();
    if (!temRaio()) { el('n-reg').textContent = 'A lista de concorrentes ainda não foi publicada (mercado/postos-raio.json).'; t.querySelector('thead').innerHTML = ''; t.querySelector('tbody').innerHTML = ''; return; }
    var R = D.raio;
    el('n-reg').textContent = 'Toque numa unidade para ver os concorrentes da área.';
    t.querySelector('thead').innerHTML = '<tr><th>Unidade</th><th class="num">SAM (m³/mês)</th><th class="num mo">Nossas compras (m³/mês)</th><th class="num">SOM</th><th class="num mo">SOM ano anterior</th><th class="num">Var.</th></tr>';
    function linha(u) {
      var rk = rankDe(u, meses), a = rk && rk.a, b = a ? calc(a.ms.map(anoAnt), [u], lista(u)) : null;
      if (b && b.n !== a.n) b = null;
      var x = R.unidades[u], nov = (x.a_revisar || []).length, aberto = !!ABERTOS[u];
      var sub = rk ? rk.pos + 'º de ' + rk.ls.length + ' na área' : lista(u).length + ' concorrentes';
      if (a && a.n < meses.length) sub += ' · ' + a.n + (a.n > 1 ? ' meses' : ' mês') + ' com compra';
      if (nov) sub += ' · ' + nov + (nov > 1 ? ' postos novos' : ' posto novo') + ' a classificar';
      return '<tr class="un-abre" data-u="' + esc(u) + '" tabindex="0" role="button" aria-expanded="' + aberto + '"><td><b><span class="seta">' + (aberto ? '▾' : '▸') + '</span> ' + esc(UNID()[u].nome) + '</b><br><small class="falta">' + esc(sub) + '</small></td><td class="num">' + (a ? num(a.sam, 0) : traco()) + '</td><td class="num mo">' + (a ? num(a.nos, 0) : traco()) + '</td><td class="num"><b>' + (a ? pct(a.som, 1) : '—') + '</b></td><td class="num mo">' + (b ? pct(b.som, 1) : '<span class="falta">' + (a ? 'nova' : '—') + '</span>') + '</td><td class="num">' + (a && b ? fmtDif(a.som - b.som) : traco()) + '</td></tr>' +
        (aberto ? '<tr class="rk-det"><td colspan="6">' + ranking(u, rk) + '</td></tr>' : '');
    }
    function ranking(u, rk) {
      if (!rk) return '<p class="falta">Sem compras desta unidade no período.</p>';
      var a = rk.a, x = R.unidades[u];
      var cab = '';
      var avisos = [];
      if ((x.a_revisar || []).length) avisos.push(x.a_revisar.length + (x.a_revisar.length > 1 ? ' postos novos' : ' posto novo') + ' na área a classificar: ' + x.a_revisar.map(function (p) { return nomePosto(p.nome); }).join(', ') + '.');
      if (x.fora_do_cadastro) avisos.push(x.fora_do_cadastro + ' concorrente saiu do cadastro da ANP (fechou ou trocou de CNPJ).');
      return cab + '<div class="tabela"><table class="rk"><thead><tr><th class="num">#</th><th>Posto</th><th class="num">m³/mês</th><th class="num mo">Fatia do SAM</th><th class="num" title="Nosso volume comparado ao do concorrente: +50% = vendemos 50% a mais">Nós vs ele</th></tr></thead><tbody>' + rk.ls.map(function (q, i) {
        if (q.nos) return '<tr class="dest"><td class="num">' + (i + 1) + '</td><td><span class="ponto s"></span>' + esc(UNID()[u].nome) + ' (nós)</td><td class="num">' + num(q.v, 0) + '</td><td class="num mo">' + pct(q.v / a.sam * 100, 1) + '</td><td class="num">—</td></tr>';
        var p = q.p, onde = [p.bairro, p.municipio].filter(Boolean).map(nomeCidade).join(' · '), d = q.v ? (a.nos / q.v - 1) * 100 : null;
        return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(nomePosto(p.nome)) + (informada(p) ? ' <small class="selo">informada</small>' : '') + '<br><small class="falta">' + esc(nomeBand(p.bandeira)) + ' · ' + esc(onde) + (p.km != null ? ' · ' + num(p.km, 1) + ' km' : '') + '</small></td><td class="num">' + num(q.v, 0) + '</td><td class="num mo">' + pct(q.v / a.sam * 100, 1) + '</td><td class="num"><b class="' + cls(d) + '">' + (d == null ? '—' : (d > 0 ? '+' : '') + num(d, 0) + '%') + '</b></td></tr>';
      }).join('') + '</tbody></table></div>' + (avisos.length ? '<div class="aviso">' + esc(avisos.join(' ')) + '</div>' : '');
    }
    var linhas = us.filter(function (u) { return R.unidades[u]; }).map(linha);
    if (us.length > 1) {
      var S = somSel(meses, us), so = S && S.uB.length && S.uB.length < us.length;
      linhas.push('<tr class="total"><td><b>' + (todasUn() ? 'Rede' : 'Seleção') + '</b><br><small class="falta">' + uniao(us).length + ' concorrentes</small></td><td class="num">' + (S ? num(S.a.sam, 0) : traco()) + '</td><td class="num mo">' + (S ? num(S.a.nos, 0) : traco()) + '</td><td class="num"><b>' + (S ? pct(S.a.som, 1) : '—') + '</b></td><td class="num mo">' + (S && S.b ? pct(S.b.som, 1) + (so ? '<br><small class="falta">só ' + esc(nomes(S.uB)) + '</small>' : '') : traco()) + '</td><td class="num">' + (S ? fmtDif(S.dif) : traco()) + '</td></tr>');
    }
    t.querySelector('tbody').innerHTML = meses.length ? linhas.join('') : '<tr><td colspan="6" class="falta">Sem mercado e compras para ' + esc(perLbl(st.mes)) + '.</td></tr>';
  }

  /* ---------- aba Evolução ---------- */
  function grafico(svg, tip, pts, series, tipHtml) {
    if (!pts.length) { svg.setAttribute('viewBox', '0 0 640 60'); svg.innerHTML = '<text x="320" y="36" text-anchor="middle">Sem dados.</text>'; return; }
    var W = 680, H = 260, L = 44, Rg = 16, T = 16, B = 34;
    var max = 0; pts.forEach(function (p) { series.forEach(function (s) { var v = p.v[s.k]; if (v != null && v > max) max = v; }); });
    /* eixo com passos redondos (1, 2, 2,5, 5, 10 …) */
    var alvo4 = (max > 0 ? max * 1.08 : 1) / 4, pot = Math.pow(10, Math.floor(Math.log(alvo4) / Math.LN10)), fr = alvo4 / pot;
    max = (fr <= 1 ? 1 : fr <= 2 ? 2 : fr <= 2.5 ? 2.5 : fr <= 5 ? 5 : 10) * pot * 4;
    var n = pts.length, x = function (i) { return n === 1 ? (L + (W - L - Rg) / 2) : L + (W - L - Rg) * i / (n - 1); }, y = function (v) { return T + (H - T - B) * (1 - v / max); };
    var grid = '', eixoY = '';
    for (var g = 0; g <= 4; g++) { var v = max / 4 * g, yy = y(v); grid += '<line x1="' + L + '" x2="' + (W - Rg) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="#EEF1F5"/>'; eixoY += '<text x="' + (L - 6) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end">' + num(v, (max / 4) % 1 ? 1 : 0) + '%</text>'; }
    var eixoX = '', passo = Math.max(1, Math.ceil(n / 8));
    pts.forEach(function (p, i) { if ((n - 1 - i) % passo === 0) eixoX += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="' + (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') + '">' + mesLbl(p.m) + '</text>'; });
    var linhas = '', marcas = '';
    series.forEach(function (s) {
      var d = '', ant = false;
      pts.forEach(function (p, i) { var v = p.v[s.k]; if (v == null) { ant = false; return; } d += (ant ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); ant = true; });
      linhas += '<path d="' + d + '" fill="none" stroke="' + s.cor + '" stroke-width="' + (s.grossa ? 2.6 : 2) + '"' + (s.traco ? ' stroke-dasharray="5 4"' : '') + ' stroke-linejoin="round" stroke-linecap="round"/>';
      pts.forEach(function (p, i) { var v = p.v[s.k]; if (v == null) return; marcas += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="' + (n > 14 ? 2.6 : 3.5) + '" fill="' + (p.previa ? '#fff' : s.cor) + '" stroke="' + s.cor + '" stroke-width="2"/>'; });
    });
    var sel = -1; pts.forEach(function (p, i) { if (p.m === st.mes) sel = i; });
    var destaque = sel >= 0 ? '<line x1="' + x(sel).toFixed(1) + '" x2="' + x(sel).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#EC6C22" stroke-dasharray="3 4" stroke-opacity=".5"/>' : '';
    var larg = (W - L - Rg) / Math.max(n - 1, 1), alvo = '';
    pts.forEach(function (p, i) { alvo += '<rect data-i="' + i + '" x="' + (x(i) - larg / 2).toFixed(1) + '" y="' + T + '" width="' + larg.toFixed(1) + '" height="' + (H - T - B) + '" fill="transparent"/>'; });
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = grid + eixoY + '<line x1="' + L + '" x2="' + (W - Rg) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="#D4DAE3"/>' + destaque + eixoX + linhas + marcas + '<g>' + alvo + '</g>';
    function mostra(ev) {
      var r = ev.target.getAttribute && ev.target.getAttribute('data-i'); if (r == null) { tip.hidden = true; return; }
      var p = pts[+r], box = svg.getBoundingClientRect(), host = svg.parentNode.getBoundingClientRect(), topo = 0;
      series.forEach(function (s) { if (p.v[s.k] != null && p.v[s.k] > topo) topo = p.v[s.k]; });
      tip.innerHTML = tipHtml(p); tip.hidden = false;
      tip.style.left = Math.max(70, Math.min(host.width - 70, box.left - host.left + x(+r) * box.width / W)) + 'px';
      tip.style.top = (box.top - host.top + y(topo) * box.height / H - 10) + 'px';
    }
    svg.onmousemove = mostra; svg.onclick = mostra;
    svg.onmouseleave = function () { tip.hidden = true; };
  }
  function evolucao() {
    var us = unSel(), todos = mesesSap().filter(function (m) { return mktP(m, 'rev'); });
    /* 1) SOM mês a mês por unidade */
    var series = [], pts = [];
    if (temRaio()) {
      us.forEach(function (u) { series.push({ k: u, cor: COR_UN[codigosUn().indexOf(u) % COR_UN.length], nome: UNID()[u].nome }); });
      if (us.length > 1) series.push({ k: 'rede', cor: '#16211C', nome: todasUn() ? 'Rede' : 'Seleção', traco: true, grossa: true });
      pts = todos.map(function (m) {
        var v = {}; us.forEach(function (u) { var c = calc([m], [u], lista(u)); v[u] = c ? c.som : null; });
        if (us.length > 1) { var c2 = calc([m], us, uniao(us)); v.rede = c2 ? c2.som : null; }
        return { m: m, v: v, previa: ehPrevia(m) || sapParcial(m) };
      }).filter(function (p) { return series.some(function (s) { return p.v[s.k] != null; }); });
    }
    el('n-evo').textContent = '';
    el('legEvo').innerHTML = series.map(function (s) { return '<span><i class="linha" style="background:' + s.cor + '"></i>' + esc(s.nome) + '</span>'; }).join('') + '<span><i style="background:#fff;border:2px solid var(--tinta-fraca);width:8px;height:8px;border-radius:50%"></i>Prévia</span>';
    grafico(el('cEvo'), el('tipEvo'), pts, series, function (p) { return '<b>' + mesLbl(p.m) + (p.previa ? ' · prévia' : '') + '</b><br>' + series.map(function (s) { return esc(s.nome) + ' ' + (p.v[s.k] == null ? '—' : pct(p.v[s.k], 1)); }).join('<br>'); });
    /* 2) crescimento contra o mesmo mês do ano anterior */
    el('n-evoT').textContent = 'Contra o mesmo mês do ano anterior. Dif. = mesmas unidades menos TAM.';
    var t = el('tEvo');
    t.querySelector('thead').innerHTML = '<tr><th>Mês</th><th class="num">TAM</th><th class="num">' + esc(quem()) + '</th><th class="num mo">Mesmas unidades</th><th class="num">Dif. vs TAM</th><th class="num">Fatia do TAM</th><th class="num mo">SOM</th></tr>';
    var linhas = todos.slice(-13).reverse().map(function (m) {
      var b = anoAnt(m), tam = tamDe([m]), tamA = mktReal(b, 'rev') ? tamDe([b]) : null, n = nosDe([m], us), nA = sapMes(b) ? nosDe([b], us) : null;
      var mesmas = nA != null ? us.filter(function (u) { return nos(b, [u]) > 0 && nos(m, [u]) > 0; }) : [];
      var gT = cresc(tamA, tam), gN = cresc(nA, n), gM = mesmas.length ? cresc(nosDe([b], mesmas), nosDe([m], mesmas)) : null;
      var som = temRaio() ? calc([m], us, uniao(us)) : null, pv = ehPrevia(m) || sapParcial(m);
      return '<tr' + (m === st.mes ? ' class="dest"' : '') + '><td>' + mesLbl(m) + (pv ? '<span class="parc">' + (sapParcial(m) ? 'EM CURSO' : 'PRÉVIA') + '</span>' : '') + '</td><td class="num">' + fmtVar(gT) + '</td><td class="num">' + fmtVar(gN) + '</td><td class="num mo">' + fmtVar(gM) + '</td><td class="num">' + fmtDif(gM != null && gT != null ? gM - gT : null) + '</td><td class="num">' + (tam && n != null ? pct(n / tam * 100, 2) : traco()) + '</td><td class="num mo">' + (som ? pct(som.som, 1) : traco()) + '</td></tr>';
    });
    t.querySelector('tbody').innerHTML = linhas.join('') || '<tr><td colspan="7" class="falta">Sem meses.</td></tr>';
    /* 3) crescimento nominal da rede no período: mesmas unidades × unidades novas × TAM */
    var r = resumo(), tr = el('tRede'), baseTxt = perLbl(anoAnt(st.mes));
    el('n-rede').textContent = perLbl(st.mes) + ' contra ' + baseTxt + ', em m³.' + (r.previa || r.curso ? ' Inclui prévia.' : '');
    tr.querySelector('thead').innerHTML = '<tr><th>Linha</th><th class="num">' + esc(baseTxt) + '</th><th class="num">' + esc(perLbl(st.mes)) + '</th><th class="num mo">Dif. (m³)</th><th class="num">Var.</th></tr>';
    if (!r.n || !r.temBase) { tr.querySelector('tbody').innerHTML = '<tr><td colspan="5" class="falta">Sem ' + esc(baseTxt) + ' para comparar.</td></tr>'; return; }
    function lr(nome, a, b, clsTr, fmt, novo) {
      fmt = fmt || function (v) { return num(v, 0); };
      return '<tr' + (clsTr ? ' class="' + clsTr + '"' : '') + '><td>' + nome + '</td><td class="num">' + (a == null || novo ? traco() : fmt(a)) + '</td><td class="num">' + (b == null ? traco() : fmt(b)) + '</td><td class="num mo">' + (a != null && b != null ? '<span class="' + cls(b - a) + '">' + (b - a > 0 ? '+' : '') + fmt(b - a) + '</span>' : traco()) + '</td><td class="num">' + (novo ? '<span class="falta">nova</span>' : fmtVar(cresc(a, b))) + '</td></tr>';
    }
    var hr = us.map(function (u) { var a = nosDe(r.base, [u]), b = nosDe(r.meses, [u]); return lr('<span class="ponto s"></span>' + esc(UNID()[u].nome), a, b, '', null, !(a > 0) && b > 0); });
    if (r.novas.length && r.mesmas.length) hr.push(lr('Mesmas unidades <small class="falta">(' + esc(nomes(r.mesmas)) + ')</small>', r.nosMA, r.nosM, 'total'));
    if (us.length > 1) hr.push(lr('<b>' + (todasUn() ? 'Rede' : 'Seleção') + ' (total)</b>', r.nosA, r.nos, r.novas.length && r.mesmas.length ? '' : 'total'));
    hr.push(lr('<b>TAM</b> · postos do RS <small class="falta">(mil m³)</small>', r.tamA / 1000, r.tam / 1000, 'total', function (v) { return num(v, 1); }));
    hr.push('<tr class="dest"><td>Fatia do TAM</td><td class="num">' + pct(r.fatA, 2) + '</td><td class="num">' + pct(r.fat, 2) + '</td><td class="num mo"></td><td class="num">' + fmtDif(r.fat != null && r.fatA != null ? r.fat - r.fatA : null, 2) + '</td></tr>');
    tr.querySelector('tbody').innerHTML = hr.join('');
  }

  /* ---------- aba Bandeiras (apoio à negociação) ---------- */
  function mktSoma(ms, seg) { var M = null; ms.forEach(function (m) { var x = mktP(m, seg); if (!x) return; M = M || {}; Object.keys(x).forEach(function (k) { if (k !== '_prev') M[k] = (M[k] || 0) + x[k]; }); }); return M; }
  function bandeiras() {
    var meses = mesesValidos(), base = meses.map(anoAnt), us = unSel(), baseTxt = perLbl(anoAnt(st.mes));
    var temBase = meses.length > 0 && base.every(function (m) { return mktReal(m, 'rev') && sapMes(m); });
    var M = mktSoma(meses, 'rev'), MA = temBase ? mktSoma(base, 'rev') : null;
    el('n-bandUn').textContent = perLbl(st.mes) + ' contra ' + baseTxt + '.';
    function daBand(b) { return us.filter(function (u) { return UNID()[u].bandeira === b; }); }
    /* cartões: dentro da Raízen / dentro da Ipiranga */
    el('bandMinis').innerHTML = BANDS.map(function (b) {
      var uu = daBand(b); if (!uu.length || !M) return '';
      var n = nosDe(meses, uu), sh = M[b] > 0 && n != null ? n / (M[b] * 1000) * 100 : null;
      var nA = MA ? nosDe(base, uu) : null, shA = MA && MA[b] > 0 && nA > 0 ? nA / (MA[b] * 1000) * 100 : null;
      var gv = naCarteira(b, sh), c = carteira(b);
      return '<div class="mini"><div class="lbl"><span class="ponto ' + (b === 'Raízen' ? 'r' : 'i') + '"></span>Dentro da ' + b + '</div><div class="val">' + pct(sh) + (shA != null ? ' <small class="' + cls(sh - shA) + '">' + pp(sh - shA) + '</small>' : '') + '</div><div class="sub">' + esc(nomes(uu)) + ' · ' + num(n, 0) + ' m³' + (gv != null ? ' · ≈ <b>' + pct(gv) + '</b> da carteira do GV' : '') + '</div></div>';
    }).join('');
    /* tabela: unidade × bandeira */
    var t = el('tBand');
    t.querySelector('thead').innerHTML = '<tr><th>Unidade</th><th class="num">m³</th><th class="num">Na bandeira</th><th class="num mo">Carteira GV</th><th class="num">Cresc. unidade</th><th class="num">Cresc. bandeira</th><th class="num">Dif.</th></tr>';
    t.querySelector('tbody').innerHTML = !M ? '<tr><td colspan="7" class="falta">Sem mercado para ' + esc(perLbl(st.mes)) + '.</td></tr>' : us.map(function (u) {
      var b = UNID()[u].bandeira, n = nosDe(meses, [u]), nA = MA ? nosDe(base, [u]) : null;
      var sh = M[b] > 0 && n != null ? n / (M[b] * 1000) * 100 : null, gU = nA > 0 ? cresc(nA, n) : null, gB = MA ? cresc(MA[b], M[b]) : null, gv = naCarteira(b, sh);
      return '<tr><td><span class="ponto ' + (b === 'Raízen' ? 'r' : 'i') + '"></span>' + esc(UNID()[u].nome) + ' <small class="falta">' + esc(b) + '</small></td><td class="num">' + num(n, 0) + '</td><td class="num">' + pct(sh) + '</td><td class="num mo">' + (gv != null ? pct(gv) : traco()) + '</td><td class="num">' + (gU == null && MA && n > 0 ? '<span class="falta">nova</span>' : fmtVar(gU)) + '</td><td class="num">' + fmtVar(gB) + '</td><td class="num">' + fmtDif(gU != null && gB != null ? gU - gB : null) + '</td></tr>';
    }).join('');
    /* quem vende para os postos do RS */
    el('n-band').textContent = 'Mil m³ em ' + perLbl(st.mes) + '. Traço laranja = Sapatão na bandeira.';
    var box = el('barras');
    if (!M) { box.innerHTML = '<p class="falta">Sem mercado para este período.</p>'; return; }
    var itens = Object.keys(M).filter(function (k) { return k !== 'Total' && k !== 'Outras'; }).map(function (k) { return { k: k, v: M[k] }; }).sort(function (a, b) { return b.v - a.v; });
    itens.push({ k: 'Outras', v: M.Outras || 0 });
    var maxV = itens[0].v || 1, nT = nosDe(meses, us);
    var h = itens.map(function (it) {
      var share = M.Total ? it.v / M.Total * 100 : 0, cl = it.k === 'Raízen' ? ' raizen' : it.k === 'Ipiranga' ? ' ipiranga' : '', marca = '';
      if (BANDS.indexOf(it.k) >= 0 && daBand(it.k).length && it.v > 0) { var s2 = nosDe(meses, daBand(it.k)) / (it.v * 1000) * 100; marca = '<i style="left:' + Math.min(100, s2).toFixed(2) + '%" title="Sapatão ' + pct(s2) + ' dentro da ' + it.k + '"></i>'; }
      return '<div class="barra' + cl + '"><span class="n" title="' + esc(it.k) + '">' + esc(it.k) + '</span><span class="tr" title="' + esc(it.k) + ': ' + num(it.v, 1) + ' mil m³ · ' + pct(share, 1) + '"><b style="width:' + (it.v / maxV * 100).toFixed(2) + '%"></b>' + marca + '</span><span class="v">' + num(it.v, 1) + ' <small>· ' + pct(share, 1) + '</small></span></div>';
    }).join('');
    if (nT != null) h += '<div class="barra sapatao"><span class="n">' + esc(quem()) + '</span><span class="tr"><b style="width:' + Math.max(0.6, nT / 1000 / maxV * 100).toFixed(2) + '%"></b></span><span class="v">' + num(nT / 1000, 2) + ' <small>· ' + pct(nT / (M.Total * 1000) * 100, 2) + '</small></span></div>';
    box.innerHTML = h;
  }

  /* ---------- aba Expansão: postos em avaliação (mercado/expansao.enc.json, cifrado) ----------
     Para cada candidato: volume estimado, a área dele (vizinhança por raio ou a área de uma
     unidade nossa), o efeito na rede e no SOM das unidades que hoje concorrem com ele, e o
     município (base anual da ANP e frota do Senatran). A lista de alvos é estratégica e só
     existe cifrada; a vizinhança é montada aqui a partir do cadastro público (raio.area). */
  function distKm(a, b) { var R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r; var h = Math.pow(Math.sin(dLa / 2), 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.pow(Math.sin(dLo / 2), 2); return 2 * R * Math.asin(Math.sqrt(h)); }
  function temExp() { return !!(D.exp && D.exp.candidatos && D.exp.candidatos.length && temRaio()); }
  function nossaDe(cnpj) { var r = null; codigosUn().forEach(function (u) { if ((D.raio.unidades[u] || {}).cnpj === cnpj) r = u; }); return r; }
  function postoArea(cnpj) {
    var a = (D.raio.area || []).filter(function (p) { return p.cnpj === cnpj; })[0]; if (a) return a;
    var r = null; codigosUn().forEach(function (u) { ((D.raio.unidades[u] || {}).postos || []).forEach(function (p) { if (p.cnpj === cnpj) r = p; }); }); return r;
  }
  function mediaEst(ms, p) { var s = 0; for (var i = 0; i < ms.length; i++) { var e = estPosto(ms[i], p); if (e == null) return null; s += e; } return ms.length ? s / ms.length : null; }
  /* Projeção de um posto novo por PERFIL (decisão de 16/11/2026): urbano e rodovia, cada um com as
     unidades de referência dele (perfis do arquivo cifrado). Por grupo de produto (gasolina/etanol e
     diesel): padrão de 24 meses = litros por bico por mês da referência (volume ÷ bicos do cadastro
     da ANP, média dos últimos 12 meses fechados; GNV fora); 6 e 12 meses = a rampa (frações do
     padrão, também no cifrado). Teto: o posto novo chega, no máximo, ao volume médio da unidade de
     referência em cada produto — mais bicos não trazem mais clientes na mesma proporção.
     Volumes em m³ = mil litros. */
  var GRUPOS = [['otto', 'o', 'Gasolina/etanol'], ['diesel', 'd', 'Diesel']];
  function bicosDe(inf, prod) { return !inf ? 0 : prod === 'tot' ? inf.bo + inf.bd : prod === 'otto' ? inf.bo : inf.bd; }
  function brutoUn(m, u, prod) { var x = sapMes(m); return x && x.unid ? volDe(x.unid[u], prod) : 0; }
  function perfis() {
    var fs = mesesSap().filter(function (m) { return !sapParcial(m); }), R = D.raio.unidades, out = {};
    Object.keys(D.exp.perfis || {}).forEach(function (k) {
      var pf = D.exp.perfis[k], us = (pf.ref || []).filter(function (u) { return R[u] && R[u].infra; }), g = {};
      GRUPOS.forEach(function (G) {
        var vol = 0, bic = 0, n = 0;
        us.forEach(function (u) {
          var ms = fs.filter(function (m) { return brutoUn(m, u, 'tot') > 0; }).slice(-12); if (!ms.length) return;
          var s = 0; ms.forEach(function (m) { s += brutoUn(m, u, G[0]); });
          vol += s / ms.length; bic += R[u].infra['b' + G[1]]; n++;
        });
        g[G[0]] = n && bic ? { l: vol / bic, teto: vol / n } : null;
      });
      out[k] = { nome: pf.nome || k, us: us, g: g };
    });
    return out;
  }
  /* volume projetado do posto (infra) no perfil pf, na fração f do padrão; null sem padrão */
  function projeta(inf, pf, f, comTeto) {
    var t = 0, ok = false, noTeto = false;
    GRUPOS.forEach(function (G) {
      if (st.prod !== 'tot' && st.prod !== G[0]) return;
      var x = pf && pf.g[G[0]], b = inf ? inf['b' + G[1]] : 0; if (!x) return;
      var v = b * x.l; if (comTeto && v > x.teto) { v = x.teto; noTeto = true; }
      t += v * f; ok = true;
    });
    return ok ? { v: t, teto: noTeto } : null;
  }
  var EXP_ABERTOS = {};
  function expansao() {
    var bt = document.querySelector('#abas button[data-aba="expansao"]'), box = el('expFichas');
    if (bt) bt.hidden = !temExp();
    if (!box) return;
    if (!temExp()) { box.innerHTML = ''; if (st.aba === 'expansao') st.aba = 'unidades'; return; }
    var meses = mesesValidos(), R = D.raio, todas = codigosUn();
    el('n-exp').textContent = 'Volumes estimados; o número real só vem do vendedor.';
    if (!meses.length) { box.innerHTML = '<p class="falta">Sem mercado e compras para ' + esc(perLbl(st.mes)) + '.</p>'; return; }
    var nosRede = nosDe(meses, todas) / meses.length;
    var PF = perfis(), mil = function (v) { return v == null ? '—' : num(v, 1); }, RA = D.exp.rampa || {}, f6 = RA.m6 || null, f12 = RA.m12 || null, comTeto = D.exp.teto !== false;
    var gs = GRUPOS.filter(function (G) { return st.prod === 'tot' || st.prod === G[0]; });
    el('expPadrao').innerHTML = '<p class="exp-pad">Rampa: <b>' + (f6 ? num(f6 * 100, 0) + '%</b> do padrão em 6 meses · <b>' : '') + (f12 ? num(f12 * 100, 0) + '%</b> em 12 · <b>' : '') + '100%</b> em 24</p>' +
      '<details class="dobra"><summary>Padrões por perfil</summary><div class="tabela"><table class="rk"><thead><tr><th>Perfil</th><th>Produto</th><th class="num" title="Mil litros por bico por mês">6 meses</th><th class="num">12 meses</th><th class="num">24 meses</th><th class="num" title="Volume máximo do posto novo: o da unidade de referência">Teto (m³)</th></tr></thead><tbody>' + Object.keys(PF).map(function (k) {
        var pf = PF[k];
        return gs.map(function (G, i) { var x = pf.g[G[0]]; return '<tr><td>' + (i ? '' : '<b>' + esc(pf.nome) + '</b> <small class="falta">' + esc(nomes(pf.us)) + '</small>') + '</td><td>' + G[2] + '</td><td class="num">' + (x && f6 ? mil(x.l * f6) : '—') + '</td><td class="num">' + (x && f12 ? mil(x.l * f12) : '—') + '</td><td class="num">' + (x ? mil(x.l) : '—') + '</td><td class="num">' + (x && comTeto ? num(x.teto, 0) : '—') + '</td></tr>'; }).join('');
      }).join('') + '</tbody></table></div><p class="nota">Mil litros por bico por mês.</p></details>';
    box.innerHTML = D.exp.candidatos.map(function (c, idx) {
      var p = postoArea(c.cnpj);
      if (!p) return '<div class="ficha"><h3>' + esc(c.apelido) + '</h3><p class="falta">Posto não encontrado no cadastro da ANP da região.</p></div>';
      var vol = mediaEst(meses, p), inf = informada(p), viz = [], rot = '';
      /* a área do candidato */
      if (c.area.tipo === 'unidade' && R.unidades[c.area.u]) {
        viz = lista(c.area.u).filter(function (q) { return q.cnpj !== c.cnpj; }).map(function (q) { return { p: q }; });
        viz.push({ nosso: c.area.u });
        rot = 'área do ' + UNID()[c.area.u].nome;
      } else {
        var fora = {}; (c.descartados || []).forEach(function (x) { fora[x] = 1; });
        (R.area || []).forEach(function (q) { if (q.cnpj === c.cnpj || fora[q.cnpj] || q.lat == null || p.lat == null) return; var d = distKm(p, q); if (d > c.area.km) return; var u = nossaDe(q.cnpj); viz.push(u ? { nosso: u, km: d } : { p: q, km: d }); });
        rot = 'raio de ' + num(c.area.km, 0) + ' km';
      }
      viz.forEach(function (v) { v.v = v.nosso ? nosDe(meses, [v.nosso]) / meses.length : mediaEst(meses, v.p); if (v.km == null && p.lat != null) { var q = v.nosso ? R.unidades[v.nosso] : postoArea(v.p.cnpj); if (q && q.lat != null) v.km = distKm(p, q); } });
      viz = viz.filter(function (v) { return v.v != null; });
      var linhas = viz.concat([{ cand: true, v: vol }]).sort(function (a, b) { return b.v - a.v; });
      var sam = 0; linhas.forEach(function (l) { sam += l.v; });
      var pos = 0; linhas.forEach(function (l, i) { if (l.cand) pos = i + 1; });
      /* unidades nossas que hoje têm o candidato na lista de concorrentes */
      var conc = todas.filter(function (u) { return lista(u).some(function (q) { return q.cnpj === c.cnpj; }); });
      var efeitos = conc.map(function (u) { var a = calc(meses, [u], lista(u)); if (!a) return null; var v = mediaEst(a.ms, p); return v == null ? null : UNID()[u].nome + ' ' + pct(a.som, 1) + ' → <b>' + pct((a.nos + v) / a.sam * 100, 1) + '</b>'; }).filter(Boolean);
      var dists = todas.map(function (u) { var x = R.unidades[u]; return x && x.lat != null && p.lat != null ? UNID()[u].nome + ' ' + num(distKm(p, x), 1) + ' km' : null; }).filter(Boolean).join(' · ');
      /* município: mercado anual (ANP), postos do cadastro e frota (Senatran) */
      var mun = p.municipio, G = D.regiao, ps = st.prod === 'otto' ? ['gasolina', 'etanol'] : st.prod === 'diesel' ? ['diesel'] : ['gasolina', 'etanol', 'diesel'], munTxt = '';
      function volAno(base, a) { var x = base && base[a]; if (!x) return null; var s = 0; ps.forEach(function (k) { s += x[k] || 0; }); return s; }
      if (G && G.municipios && G.municipios[mun]) {
        var ano = G.ultimo_ano, ant = String(+ano - 1), vM = volAno(G.municipios[mun], ano), vMa = volAno(G.municipios[mun], ant), vR = volAno(G.rs, ano), vRa = volAno(G.rs, ant);
        var nPostos = (R.area || []).filter(function (q) { return q.municipio === mun; }).length;
        munTxt = nomeCidade(mun) + ': ' + num(vM / 12, 0) + ' m³/mês' + (nPostos ? ' · ' + num(vM / 12 / nPostos, 0) + ' por posto' : '') + ' · ' + ano + ' <b class="' + cls(cresc(vMa, vM)) + '">' + sinal(cresc(vMa, vM)) + '</b> (RS ' + sinal(cresc(vRa, vR)) + ')';
      }
      var F = D.frota, frTxt = '';
      if (F && F.meses) {
        var fm = F.ultimo_mes, fa = anoAnt(fm), x1 = F.meses[fm] && F.meses[fm].municipios[mun], x0 = F.meses[fa] && F.meses[fa].municipios[mun];
        if (x1 && x0) frTxt = ' · frota <b class="' + cls(cresc(x0.total, x1.total)) + '">' + sinal(cresc(x0.total, x1.total)) + '</b>';
      }
      /* projeção: bicos do posto × litros por bico da rede (nunca abaixo do volume de hoje) */
      var bc = bicosDe(p.infra, st.prod), pf = PF[c.perfil] || null;
      var passoV = function (f, ant) { var x = f && bc ? projeta(p.infra, pf, f, comTeto) : null; return x ? { v: Math.max(ant, x.v), teto: x.teto } : null; };
      var s6 = passoV(f6, vol), s12 = passoV(f12, s6 ? s6.v : vol), s24 = passoV(1, s12 ? s12.v : s6 ? s6.v : vol);
      var aberto = !!EXP_ABERTOS[idx];
      var h = '<div class="ficha"><h3>' + esc(c.apelido) + '</h3><p class="nota">' + (pf ? '<b>' + esc(pf.nome) + '</b> · ' : '') + esc(nomeBand(p.bandeira)) + ' · ' + esc(nomeCidade(mun)) + (dists ? ' · ' + esc(dists) : '') + '</p>';
      var passo = function (rt, v, sub) { return '<div class="mini"><div class="lbl">' + rt + '</div><div class="val">' + num(v, 0) + '<small>m³/mês</small>' + (v > vol * 1.005 ? ' <small class="up">' + sinal((v / vol - 1) * 100, 0) + '</small>' : '') + '</div><div class="sub">' + sub + '</div></div>'; };
      h += '<div class="quad">' + passo('Hoje' + (inf ? ' · informado' : ' · estimado'), vol, p.infra ? p.infra.bo + ' + ' + p.infra.bd + ' bicos' : '') +
        (s6 ? passo('Em 6 meses', s6.v, num(f6 * 100, 0) + '% do padrão') : '') +
        (s12 ? passo('Em 12 meses', s12.v, num(f12 * 100, 0) + '% do padrão') : '') +
        (s24 ? passo('Em 24 meses', s24.v, (s24.teto ? 'no teto · ' : '') + 'rede ' + sinal(s24.v / nosRede * 100, 0)) : '') +
        '<div class="mini"><div class="lbl">Na área</div><div class="val">' + pos + 'º<small>de ' + linhas.length + '</small></div><div class="sub">' + pct(vol / sam * 100, 1) + ' de ' + num(sam, 0) + ' m³/mês · ' + esc(rot) + '</div></div></div>';
      h += '<p class="exp-ef">' + (efeitos.length ? '<b>SOM com ele:</b> ' + efeitos.join(' · ') : '<b>Área nova</b> para a rede') + (munTxt ? '<br><span class="falta">' + munTxt + frTxt + '</span>' : '') + '</p>';
      h += '<details class="dobra" data-exp="' + idx + '"' + (aberto ? ' open' : '') + '><summary>Ver os ' + linhas.length + ' postos da área</summary><div class="tabela"><table class="rk"><thead><tr><th class="num">#</th><th>Posto</th><th class="num mo">km</th><th class="num">m³/mês</th><th class="num">Fatia</th></tr></thead><tbody>' + linhas.map(function (l, i) {
        if (l.cand) return '<tr class="dest"><td class="num">' + (i + 1) + '</td><td>' + esc(c.apelido) + ' (em avaliação)</td><td class="num mo">—</td><td class="num">' + num(l.v, 0) + '</td><td class="num">' + pct(l.v / sam * 100, 1) + '</td></tr>';
        if (l.nosso) return '<tr><td class="num">' + (i + 1) + '</td><td><span class="ponto s"></span><b>' + esc(UNID()[l.nosso].nome) + '</b> (nosso)</td><td class="num mo">' + (l.km != null ? num(l.km, 1) : '—') + '</td><td class="num">' + num(l.v, 0) + '</td><td class="num">' + pct(l.v / sam * 100, 1) + '</td></tr>';
        var q = l.p, outro = D.exp.candidatos.filter(function (o) { return o.cnpj === q.cnpj; })[0]; return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(nomePosto(q.nome)) + (outro ? ' <small class="selo">também em avaliação</small>' : '') + (informada(q) ? ' <small class="selo">informada</small>' : '') + '<br><small class="falta">' + esc(nomeBand(q.bandeira)) + ' · ' + esc([q.bairro, q.municipio].filter(Boolean).map(nomeCidade).join(' · ')) + '</small></td><td class="num mo">' + (l.km != null ? num(l.km, 1) : '—') + '</td><td class="num">' + num(l.v, 0) + '</td><td class="num">' + pct(l.v / sam * 100, 1) + '</td></tr>';
      }).join('') + '</tbody></table></div></details></div>';
      return h;
    }).join('');
  }

  /* ---------- aba Fontes e método ---------- */
  function fontes() {
    var A = D.anp, S = D.sapatao, R = D.raio, ms = mesesSap(), ma = mesesAnp(), li = [];
    li.push('<li><b>TAM:</b> vendas das distribuidoras aos postos do RS (ANP), de ' + mesLbl(ma[0]) + ' a ' + mesLbl(ma[ma.length - 1]) + '. A ANP publica com cerca de dois meses de atraso.</li>');
    li.push('<li><b>Sapatão:</b> compras às distribuidoras (Argo), até ' + (ms.length ? mesLbl(ms[ms.length - 1]) : '—') + '.</li>');
    li.push('<li><b>Prévia:</b> mês sem ANP = mês anterior × a variação do mesmo mês no ano passado. Mês em curso = compras projetadas pelo ritmo.</li>');
    if (R) li.push('<li><b>Concorrentes:</b> lista escolhida pela diretoria; cada um vale a média da bandeira no RS ajustada pelos bicos do posto, ou o volume informado. Cadastro da ANP conferido toda semana.</li>');
    li.push('<li><b>Mesmas unidades:</b> a comparação com o ano anterior deixa de fora a unidade que ainda não existia.</li>');
    if (S.carteiras) li.push('<li><b>Carteira do GV:</b> participação na bandeira ÷ fração da carteira (' + Object.keys(S.carteiras).map(function (b) { var c = S.carteiras[b]; return b + ' ' + (c.fracao ? num(c.fracao * 100, 0) + '%' : 'a definir'); }).join(', ') + ').</li>');
    if (temExp()) li.push('<li><b>Projeção da Expansão:</b> bicos do posto × litros por bico da unidade de referência do perfil (urbano ou rodovia), por produto, com rampa em 6, 12 e 24 meses e teto no volume da referência.</li>');
    li.push('<li>Otto = gasolina + etanol. Arla e GNV ficam fora.</li>');
    el('fontes').innerHTML = li.join('');
    el('rodape').textContent = 'Dados do Sapatão cifrados no navegador · mercado em dados públicos da ANP';
  }

  /* ---------- controles ---------- */
  function montaUnidades() {
    var box = el('segUn'), cods = codigosUn();
    if (!cods.length) { box.hidden = true; return; }
    box.hidden = false;
    var sel = unSel(), todas = todasUn();
    box.innerHTML = '<button type="button" data-v="" aria-pressed="' + todas + '">Todas</button>' + cods.map(function (u) { return '<button type="button" data-v="' + u + '" aria-pressed="' + (!todas && sel.indexOf(u) >= 0) + '">' + esc(UNID()[u].nome) + '</button>'; }).join('');
  }
  function alternaUn(u) {
    if (!u) st.un = null;
    else {
      var atual = todasUn() ? [] : unSel().slice(), i = atual.indexOf(u);
      if (i >= 0) atual.splice(i, 1); else atual.push(u);
      st.un = atual.length && atual.length < codigosUn().length ? atual.sort() : null;
    }
    guarda(); desenha();
  }
  function mostraAba() {
    document.querySelectorAll('.aba').forEach(function (s) { s.hidden = s.dataset.aba !== st.aba; });
    document.querySelectorAll('#abas button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.aba === st.aba)); });
  }
  function marca(id, v) { el(id).querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === v)); }); }
  function liga(id, chave) { el(id).addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b || b.disabled) return; st[chave] = b.dataset.v; guarda(); desenha(); }); }
  function desenha() {
    memo = {};
    montaMeses();
    marca('segProd', st.prod); marca('segPer', st.per);
    montaUnidades(); chips(); funil(); unidades(); evolucao(); bandeiras(); expansao(); fontes(); mostraAba();
  }
  window.renderMercado = function (dados) { D = dados || D; desenha(); };
  liga('segProd', 'prod'); liga('segPer', 'per');
  el('abas').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; st.aba = b.dataset.aba; guarda(); try { history.replaceState(null, '', '#' + st.aba); } catch (e) {} mostraAba(); });
  el('selMes').addEventListener('change', function () { st.mes = this.value; desenha(); });
  el('segUn').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; alternaUn(b.dataset.v); });
  function abreUn(ev) {
    var tr = ev.target.closest('tr.un-abre'); if (!tr) return;
    if (ev.type === 'keydown') { if (ev.key !== 'Enter' && ev.key !== ' ') return; ev.preventDefault(); }
    var u = tr.getAttribute('data-u'); ABERTOS[u] = !ABERTOS[u]; unidades();
  }
  el('expFichas').addEventListener('toggle', function (ev) { var d = ev.target; if (d && d.dataset && d.dataset.exp != null) EXP_ABERTOS[d.dataset.exp] = d.open; }, true);
  el('tReg').addEventListener('click', abreUn); el('tReg').addEventListener('keydown', abreUn);
  desenha();
})();
