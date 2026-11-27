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
  /* Prévia (regra de 16/11/2026, pedido do Samuel): mês que a ANP ainda não publicou = o MESMO MÊS
     DO ANO PASSADO × o crescimento médio dos últimos 12 meses fechados (soma dos 12 ÷ soma dos
     mesmos 12 um ano antes), por segmento e por grupo de produto. Não parte mais do último mês
     fechado, que sozinho pode ser um mês atípico. A repartição entre distribuidoras segue o último
     mês fechado (a fatia de cada bandeira muda ao longo do ano). Vale até 6 meses à frente. */
  var memo = {};
  function fechadosAnp() { return mesesAnp().filter(function (m) { return !anpParcial(m); }); }
  function tendencia(seg, prod) {
    var k = 'tend|' + seg + '|' + prod; if (k in memo) return memo[k];
    var ms = fechadosAnp(), a = 0, b = 0, n = 0;
    for (var i = ms.length - 1; i >= 0 && n < 12; i--) {
      var x = mktReal(ms[i], seg, prod), y = mktReal(anoAnt(ms[i]), seg, prod);
      if (x && y && y.Total > 0) { a += x.Total; b += y.Total; n++; }
    }
    return (memo[k] = n >= 3 && b > 0 ? { f: a / b, n: n } : null);
  }
  /* ---- venda diária no RS (ANP, painel "Volume de Vendas RS"; mercado/anp-diario.json) ----
     Cobre o mês que a ANP ainda não fechou. Dias que faltam no mês corrente entram pela média do mesmo
     dia da semana nas últimas 4 semanas. Calibração = razão entre o fechamento mensal da ANP (postos) e
     a soma diária, média dos últimos 12 meses fechados (erro medido contra meses fechados: cerca de 1%). */
  function diaMes(ym, g) {
    var DD = D.diario && D.diario.dias; if (!DD) return null;
    var n = ultimoDia(ym), s = 0, tem = 0, ult = null, d, k;
    for (d = 1; d <= n; d++) { k = ym + '-' + String(d).padStart(2, '0'); if (DD[k]) { s += DD[k][g]; tem++; ult = d; } }
    if (!tem) return null;
    if (tem < n) {
      var med = {}, ct = {}, base = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, ult);
      for (var b = 0; b < 28; b++) { var dt = new Date(base.getTime() - b * 864e5), kk = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); if (DD[kk]) { var w = dt.getDay(); med[w] = (med[w] || 0) + DD[kk][g]; ct[w] = (ct[w] || 0) + 1; } }
      for (d = ult + 1; d <= n; d++) { var w2 = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, d).getDay(); if (!ct[w2]) return null; s += med[w2] / ct[w2]; }
    }
    return s;
  }
  function calibDiario(g) {
    var k = 'cal|' + g; if (k in memo) return memo[k];
    var ms = fechadosAnp().slice(-12), a = 0, b = 0, n = 0;
    ms.forEach(function (m) { var dm = diaMes(m, g), x = mktReal(m, 'rev', g ? 'diesel' : 'otto'); if (dm && x && ultimoDia(m) && D.diario.dias[m + '-' + String(ultimoDia(m)).padStart(2, '0')]) { a += x.Total * 1000; b += dm; n++; } });
    return (memo[k] = n >= 6 && b > 0 ? a / b : null);
  }
  /* fator pelo qual a repartição do último mês fechado é multiplicada para chegar ao mês ym; null sem dado diário */
  function fatorDiario(ym, prod, ultFechado) {
    var g = prod === 'otto' ? 0 : prod === 'diesel' ? 1 : -1; if (g < 0 || !D.diario) return null;
    var dm = diaMes(ym, g), c = calibDiario(g), ult = mktReal(ultFechado, 'rev', prod);
    return dm && c && ult && ult.Total > 0 ? dm * c / 1000 / ult.Total : null;
  }
  function mktP(ym, seg, prod) {
    seg = seg || 'rev'; prod = prod || st.prod;
    var k = ym + '|' + seg + '|' + prod; if (k in memo) return memo[k];
    var r = mktReal(ym, seg, prod);
    if (!r) {
      var ms = mesesAnp(), ult = ms[ms.length - 1];
      if (ult && ym > ult && ym <= shiftMes(ult, 6)) {
        if (prod === 'tot') {
          var o = mktP(ym, seg, 'otto'), d = mktP(ym, seg, 'diesel');
          if (o && d) { r = { _prev: true }; if (o._dia && d._dia) r._dia = true; Object.keys(o).forEach(function (kk) { if (kk !== '_prev' && kk !== '_dia') r[kk] = (o[kk] || 0) + (d[kk] || 0); }); }
        } else {
          var a = mktReal(anoAnt(ym), seg, prod), t = tendencia(seg, prod), fs = fechadosAnp(), mix = mktReal(fs[fs.length - 1], seg, prod);
          var kd = fatorDiario(ym, prod, fs[fs.length - 1]);
          if (kd && mix) {
            /* mês sem fechamento da ANP, mas com a venda diária do RS: total do dia a dia × calibração, repartição do último mês fechado */
            r = { _prev: true, _dia: true }; Object.keys(mix).forEach(function (kk) { r[kk] = mix[kk] * kd; });
          } else if (a && t && a.Total > 0) {
            var total = a.Total * t.f, base = mix && mix.Total > 0 ? mix : a, fx = total / base.Total;
            r = { _prev: true }; Object.keys(base).forEach(function (kk) { r[kk] = base[kk] * fx; });
          }
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
  /* Período maior que um mês mostra o TOTAL do período (pedido do Samuel, 16/11/2026), não a média
     por mês: calc() devolve médias (o SOM e as contas da Expansão dependem delas) e a tela
     multiplica pelos meses contados (a.n). */
  function uniVol() { return st.per === 'mes' ? 'm³/mês' : 'm³'; }
  function noPer(a, v) { return st.per === 'mes' ? v : v * a.n; }
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
    var pDia = prev.filter(function (m) { var x = mktP(m, 'rev'); return x && x._dia; }), pFor = prev.filter(function (m) { return pDia.indexOf(m) < 0; });
    if (pDia.length) c.push('<span class="chip alerta" title="A ANP ainda não fechou o mês: usamos a venda diária do RS publicada por ela (calibrada com os últimos 12 meses fechados). O mês em curso completa os dias que faltam pela média do mesmo dia da semana.">Mercado de ' + pDia.map(mesLbl).join(', ') + ' pela venda diária da ANP</span>');
    if (pFor.length) c.push('<span class="chip alerta" title="A ANP ainda não publicou: mesmo mês do ano passado × crescimento médio dos últimos 12 meses">Prévia: mercado de ' + pFor.map(mesLbl).join(', ') + ' projetado</span>');
    if (curso.length) c.push('<span class="chip alerta" title="Compras até o último dia lançado, projetadas pelo ritmo para o mês inteiro">' + curso.map(mesLbl).join(', ') + ' em curso (até dia ' + sapMes(curso[0]).cobertura.ate.slice(8) + ')</span>');
    meses.filter(function (m) { return !ehPrevia(m) && anpParcial(m); }).forEach(function (m) { c.push('<span class="chip alerta">ANP ainda fechando ' + mesLbl(m) + '</span>'); });
    el('chips').innerHTML = c.join('');
    el('ref').textContent = 'ANP ' + (D.anp.gerado_em || '').slice(0, 10).split('-').reverse().join('/') + ' · Sapatão ' + (D.sapatao.atualizado_em || '').slice(0, 10).split('-').reverse().join('/');
  }

  /* ---------- funil do período: TAM → SAM → SOM e o veredito ---------- */
  function funil() {
    var r = resumo(), us = r.us, baseTxt = perLbl(anoAnt(st.mes));
    function delta(v, txt) { return v == null ? '' : '<span class="delta ' + cls(v) + '">' + txt + '</span>'; }
    function card(sig, nome, val, sub, deltas, extra) {
      return '<div class="bomba fn"><div class="lbl"><b>' + sig + '</b> · ' + nome + '</div><div class="val">' + val + '</div><div class="sub">' + sub + '</div>' + (deltas ? '<div class="deltas">' + deltas + '</div>' : '') + (extra || '') + '</div>';
    }
    if (!r.n) { el('funil').innerHTML = card('TAM', 'mercado dos postos do RS', '—', 'Sem mercado e compras para ' + esc(perLbl(st.mes)) + '.'); el('veredito').innerHTML = ''; return; }
    var h = '';
    /* TAM */
    h += card('TAM', 'postos do RS', num(r.tam / 1000, 1) + '<small>mil m³</small>',
      esc(quem()) + ': <b>' + pct(r.fat, 2) + '</b>' + (r.fatA != null ? ' <small>(era ' + pct(r.fatA, 2) + ')</small>' : ''),
      delta(r.gTam, sinal(r.gTam) + ' vs ' + baseTxt));
    /* SAM e SOM */
    var S = temRaio() ? somSel(r.meses, us) : null;
    if (!S) {
      h += card('SAM', 'nossas áreas', '—', temRaio() ? 'Sem compras no período.' : 'Sem lista de concorrentes.');
      h += card('SOM', 'nossa fatia', '—', '');
    } else {
      var nConc = uniao(us).length, samA = r.temBase ? calc(r.base, us, uniao(us)) : null, gSam = samA && samA.n === S.a.n ? cresc(samA.sam, S.a.sam) : null;
      h += card('SAM', us.length > 1 ? 'nossas áreas' : 'área do ' + esc(nomes(us)), num(noPer(S.a, S.a.sam), 0) + '<small>' + uniVol() + '</small>',
        'Nós + ' + nConc + ' concorrentes',
        delta(gSam, sinal(gSam) + ' vs ' + baseTxt));
      var soMesmas = S.uB.length && S.uB.length < us.length;
      h += card('SOM', 'nossa fatia', pct(S.a.som, 1), num(noPer(S.a, S.a.nos), 0) + ' de ' + num(noPer(S.a, S.a.sam), 0) + ' ' + uniVol(),
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

  /* Litros por bico por mês (18/11/2026): nossas compras ÷ bicos da unidade no cadastro da ANP, no
     produto do filtro (Otto = bicos de gasolina/etanol; Diesel = bicos de diesel; consolidado = todos).
     Referência: o mercado dos postos do RS ÷ os bicos de todos os postos do RS (rs_infra). Sempre em
     média por mês — é ritmo, não total do período. Em m³ por bico = mil litros por bico. */
  function bicosRS() { var I = D.raio.rs_infra || {}, b = 0; Object.keys(I).forEach(function (k) { b += bicosDe(I[k], st.prod); }); return b; }
  function lbicoRS(ms) { var tm = tamDe(ms), b = bicosRS(); return tm && b && ms.length ? tm / ms.length / b : null; }
  function lbicoUn(u, a) { var b = bicosDe((D.raio.unidades[u] || {}).infra, st.prod); return a && b ? a.nos / b : null; }
  function vsRS(x, rs) { if (x == null || !rs) return ''; var d = (x / rs - 1) * 100; return '<span class="' + cls(d) + '">' + (d > 0 ? '+' : '') + num(d, 0) + '% vs RS</span>'; }
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
    var rsG = lbicoRS(meses);
    el('n-reg').textContent = 'Toque numa unidade para ver os concorrentes da área.' + (rsG ? ' Postos do RS: ' + num(rsG, 1) + ' mil L/bico/mês.' : '');
    t.querySelector('thead').innerHTML = '<tr><th>Unidade</th><th class="num">SAM (' + uniVol() + ')</th><th class="num mo">Nossas compras (' + uniVol() + ')</th><th class="num">SOM</th><th class="num mo">SOM ano anterior</th><th class="num">Var.</th><th class="num mo" title="Mil litros por bico por mês: nossas compras ÷ bicos da unidade no cadastro da ANP, no produto escolhido. RS = mercado dos postos ÷ bicos de todos os postos do RS.">Mil L/bico</th></tr>';
    var redeV = 0, redeB = 0;
    function linha(u) {
      var rk = rankDe(u, meses), a = rk && rk.a, b = a ? calc(a.ms.map(anoAnt), [u], lista(u)) : null;
      if (b && b.n !== a.n) b = null;
      var x = R.unidades[u], nov = (x.a_revisar || []).length, aberto = !!ABERTOS[u];
      var sub = rk ? rk.pos + 'º de ' + rk.ls.length + ' na área' : lista(u).length + ' concorrentes';
      if (a && a.n < meses.length) sub += ' · ' + a.n + (a.n > 1 ? ' meses' : ' mês') + ' com compra';
      if (nov) sub += ' · ' + nov + (nov > 1 ? ' postos novos' : ' posto novo') + ' a classificar';
      var lb = lbicoUn(u, a), rs = a ? lbicoRS(a.ms) : null;
      if (lb != null) { redeV += a.nos * a.n; redeB += bicosDe(x.infra, st.prod) * a.n; }
      var lbCel = '<td class="num mo">' + (lb != null ? '<b>' + num(lb, 1) + '</b><br><small>' + vsRS(lb, rs) + '</small>' : traco()) + '</td>';
      var lbSub = lb != null ? '<small class="so-cel lb"><br><b>' + num(lb, 1) + '</b> mil L/bico · ' + vsRS(lb, rs) + '</small>' : '';
      return '<tr class="un-abre" data-u="' + esc(u) + '" tabindex="0" role="button" aria-expanded="' + aberto + '"><td><b><span class="seta">' + (aberto ? '▾' : '▸') + '</span> ' + esc(UNID()[u].nome) + '</b><br><small class="falta">' + esc(sub) + '</small>' + lbSub + '</td><td class="num">' + (a ? num(noPer(a, a.sam), 0) : traco()) + '</td><td class="num mo">' + (a ? num(noPer(a, a.nos), 0) : traco()) + '</td><td class="num"><b>' + (a ? pct(a.som, 1) : '—') + '</b></td><td class="num mo">' + (b ? pct(b.som, 1) : '<span class="falta">' + (a ? 'nova' : '—') + '</span>') + '</td><td class="num">' + (a && b ? fmtDif(a.som - b.som) : traco()) + '</td>' + lbCel + '</tr>' +
        (aberto ? '<tr class="rk-det"><td colspan="7">' + ranking(u, rk) + '</td></tr>' : '');
    }
    function ranking(u, rk) {
      if (!rk) return '<p class="falta">Sem compras desta unidade no período.</p>';
      var a = rk.a, x = R.unidades[u];
      var cab = '';
      var avisos = [];
      if ((x.a_revisar || []).length) avisos.push(x.a_revisar.length + (x.a_revisar.length > 1 ? ' postos novos' : ' posto novo') + ' na área a classificar: ' + x.a_revisar.map(function (p) { return nomePosto(p.nome); }).join(', ') + '.');
      if (x.fora_do_cadastro) avisos.push(x.fora_do_cadastro + ' concorrente saiu do cadastro da ANP (fechou ou trocou de CNPJ).');
      return cab + '<div class="tabela"><table class="rk"><thead><tr><th class="num">#</th><th>Posto</th><th class="num">' + uniVol() + '</th><th class="num mo">Fatia do SAM</th><th class="num" title="Nosso volume comparado ao do concorrente: +50% = vendemos 50% a mais">Nós vs ele</th></tr></thead><tbody>' + rk.ls.map(function (q, i) {
        if (q.nos) return '<tr class="dest"><td class="num">' + (i + 1) + '</td><td><span class="ponto s"></span>' + esc(UNID()[u].nome) + ' (nós)</td><td class="num">' + num(noPer(a, q.v), 0) + '</td><td class="num mo">' + pct(q.v / a.sam * 100, 1) + '</td><td class="num">—</td></tr>';
        var p = q.p, onde = [p.bairro, p.municipio].filter(Boolean).map(nomeCidade).join(' · '), d = q.v ? (a.nos / q.v - 1) * 100 : null;
        return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(nomePosto(p.nome)) + (informada(p) ? ' <small class="selo">informada</small>' : '') + '<br><small class="falta">' + esc(nomeBand(p.bandeira)) + ' · ' + esc(onde) + (p.km != null ? ' · ' + num(p.km, 1) + ' km' : '') + '</small></td><td class="num">' + num(noPer(a, q.v), 0) + '</td><td class="num mo">' + pct(q.v / a.sam * 100, 1) + '</td><td class="num"><b class="' + cls(d) + '">' + (d == null ? '—' : (d > 0 ? '+' : '') + num(d, 0) + '%') + '</b></td></tr>';
      }).join('') + '</tbody></table></div>' + (avisos.length ? '<div class="aviso">' + esc(avisos.join(' ')) + '</div>' : '');
    }
    var linhas = us.filter(function (u) { return R.unidades[u]; }).map(linha);
    if (us.length > 1) {
      var S = somSel(meses, us), so = S && S.uB.length && S.uB.length < us.length;
      linhas.push('<tr class="total"><td><b>' + (todasUn() ? 'Rede' : 'Seleção') + '</b><br><small class="falta">' + uniao(us).length + ' concorrentes</small></td><td class="num">' + (S ? num(noPer(S.a, S.a.sam), 0) : traco()) + '</td><td class="num mo">' + (S ? num(noPer(S.a, S.a.nos), 0) : traco()) + '</td><td class="num"><b>' + (S ? pct(S.a.som, 1) : '—') + '</b></td><td class="num mo">' + (S && S.b ? pct(S.b.som, 1) + (so ? '<br><small class="falta">só ' + esc(nomes(S.uB)) + '</small>' : '') : traco()) + '</td><td class="num">' + (S ? fmtDif(S.dif) : traco()) + '</td><td class="num mo">' + (redeB ? '<b>' + num(redeV / redeB, 1) + '</b><br><small>' + vsRS(redeV / redeB, rsG) + '</small>' : traco()) + '</td></tr>');
      if (redeB) linhas[linhas.length - 1] = linhas[linhas.length - 1].replace('</small></td>', '</small><small class="so-cel lb"><br><b>' + num(redeV / redeB, 1) + '</b> mil L/bico · ' + vsRS(redeV / redeB, rsG) + '</small></td>');
    }
    t.querySelector('tbody').innerHTML = meses.length ? linhas.join('') : '<tr><td colspan="7" class="falta">Sem mercado e compras para ' + esc(perLbl(st.mes)) + '.</td></tr>';
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
  /* Ano a ano (pedido de 27/11/2026): barras do crescimento do mercado (TAM) e do Sapatão nas mesmas unidades
     contra o ano anterior, e o SOM de cada ano embaixo. O ano em curso é parcial: compara o mesmo período. */
  function graficoAno(anos, us) {
    var svg = el('cAno'), ys = Object.keys(anos).sort(), dados = [];
    ys.forEach(function (a) {
      var ms = anos[a], base = ms.map(anoAnt), tam = tamDe(ms), n = nosDe(ms, us);
      var tamA = base.every(function (b) { return mktReal(b, 'rev'); }) ? tamDe(base) : null, nA = base.every(sapMes) ? nosDe(base, us) : null;
      var mesmas = nA != null ? us.filter(function (u) { return nosDe(base, [u]) > 0 && nosDe(ms, [u]) > 0; }) : [];
      var gM = mesmas.length ? cresc(nosDe(base, mesmas), nosDe(ms, mesmas)) : null;
      var som = temRaio() ? calc(ms, us, uniao(us)) : null;
      dados.push({ a: a, parcial: ms.some(function (m) { return ehPrevia(m) || sapParcial(m); }), parte: ms.length < 12, gT: cresc(tamA, tam), gM: gM, som: som ? som.som : null });
    });
    el('n-ano').textContent = 'Crescimento contra o ano anterior (' + (todasUn() ? 'unidades que já existiam' : 'seleção') + ') e SOM de cada ano.';
    el('legAno').innerHTML = '<span><i style="background:#9AA8BA"></i>Mercado (TAM)</span><span><i style="background:#004438"></i>' + esc(quem()) + '</span>';
    var com = dados.filter(function (d) { return d.gT != null || d.gM != null; });
    if (!dados.length) { svg.setAttribute('viewBox', '0 0 640 60'); svg.innerHTML = '<text x="320" y="36" text-anchor="middle">Sem dados.</text>'; return; }
    var W = 680, H = 270, L = 40, Rg = 12, T = 22, B = 56, mn = 0, mx = 0;
    com.forEach(function (d) { [d.gT, d.gM].forEach(function (v) { if (v != null) { mn = Math.min(mn, v); mx = Math.max(mx, v); } }); });
    var passo = Math.max(5, Math.ceil(Math.max(mx, -mn) / 3 / 5) * 5); mx = Math.ceil(mx / passo) * passo || passo; mn = Math.floor(mn / passo) * passo;
    var y = function (v) { return T + (H - T - B) * (1 - (v - mn) / (mx - mn)); }, n = dados.length, larg = (W - L - Rg) / n, g = '', i;
    for (var v = mn; v <= mx + 0.001; v += passo) g += '<line x1="' + L + '" x2="' + (W - Rg) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" stroke="' + (v === 0 ? '#D4DAE3' : '#EEF1F5') + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + (v > 0 ? '+' : '') + v + '%</text>';
    var barras = '', rot = '';
    dados.forEach(function (d, k) {
      var cx = L + larg * (k + 0.5), bw = Math.min(30, larg * 0.32);
      [[d.gT, '#9AA8BA', -1], [d.gM, '#004438', 1]].forEach(function (b) {
        if (b[0] == null) return;
        var x0 = cx + (b[2] < 0 ? -bw - 2 : 2), y0 = y(0), y1 = y(b[0]), topo = Math.min(y0, y1), alt = Math.abs(y1 - y0);
        barras += '<rect x="' + x0.toFixed(1) + '" y="' + topo.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(alt, 1).toFixed(1) + '" rx="3" fill="' + b[1] + '"' + (d.parcial ? ' fill-opacity=".6"' : '') + '><title>' + d.a + ': ' + sinal(b[0]) + '</title></rect>' +
          '<text x="' + (x0 + bw / 2).toFixed(1) + '" y="' + (b[0] >= 0 ? topo - 4 : topo + alt + 12).toFixed(1) + '" text-anchor="middle" style="font-size:11px;fill:#16211C;font-weight:600">' + (b[0] > 0 ? '+' : '') + num(b[0], 1) + '</text>';
      });
      rot += '<text x="' + cx.toFixed(1) + '" y="' + (H - 30) + '" text-anchor="middle" style="font-size:12px;fill:#16211C;font-weight:700">' + d.a + (d.parte ? '*' : '') + '</text>' +
        '<text x="' + cx.toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle" style="font-size:11px">' + (d.som != null ? 'SOM ' + num(d.som, 1) + '%' : '—') + '</text>';
    });
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = g + barras + rot;
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
    /* 2) mês a mês desde o primeiro mês de compras, com o total de cada ano (pedido de 16/11/2026:
          2025 também na página). Variações contra o mesmo período do ano anterior. */
    el('n-evoT').textContent = 'Var. contra o mesmo período do ano anterior. Dif. = mesmas unidades menos TAM.';
    var t = el('tEvo');
    t.querySelector('thead').innerHTML = '<tr><th>Período</th><th class="num mo">TAM (mil m³)</th><th class="num">TAM var.</th><th class="num">' + esc(quem()) + ' (m³)</th><th class="num">Var.</th><th class="num mo">Mesmas unidades</th><th class="num">Dif. vs TAM</th><th class="num">Fatia do TAM</th><th class="num mo">SOM</th></tr>';
    function linhaEvo(rot, ms, clsTr) {
      var base = ms.map(anoAnt), tam = tamDe(ms), n = nosDe(ms, us);
      var tamA = base.every(function (b) { return mktReal(b, 'rev'); }) ? tamDe(base) : null, nA = base.every(sapMes) ? nosDe(base, us) : null;
      var mesmas = nA != null ? us.filter(function (u) { return nosDe(base, [u]) > 0 && nosDe(ms, [u]) > 0; }) : [];
      var gT = cresc(tamA, tam), gN = cresc(nA, n), gM = mesmas.length ? cresc(nosDe(base, mesmas), nosDe(ms, mesmas)) : null;
      var som = temRaio() ? calc(ms, us, uniao(us)) : null;
      return '<tr' + (clsTr ? ' class="' + clsTr + '"' : '') + '><td>' + rot + '</td><td class="num mo">' + (tam ? num(tam / 1000, 1) : traco()) + '</td><td class="num">' + fmtVar(gT) + '</td><td class="num">' + (n != null ? num(n, 0) : traco()) + '</td><td class="num">' + fmtVar(gN) + '</td><td class="num mo">' + fmtVar(gM) + '</td><td class="num">' + fmtDif(gM != null && gT != null ? gM - gT : null) + '</td><td class="num">' + (tam && n != null ? pct(n / tam * 100, 2) : traco()) + '</td><td class="num mo">' + (som ? pct(som.som, 1) : traco()) + '</td></tr>';
    }
    var anos = {}, linhas = [];
    todos.forEach(function (m) { (anos[m.slice(0, 4)] = anos[m.slice(0, 4)] || []).push(m); });
    graficoAno(anos, us);
    Object.keys(anos).sort().reverse().forEach(function (a) {
      var ms = anos[a], pv = ms.some(function (m) { return ehPrevia(m) || sapParcial(m); });
      linhas.push(linhaEvo('<b>' + a + '</b> <small class="falta">' + mesLbl(ms[0]).slice(0, 3) + (ms.length > 1 ? '–' + mesLbl(ms[ms.length - 1]).slice(0, 3) : '') + '</small>' + (pv ? '<span class="parc">PRÉVIA</span>' : ''), ms, 'total ano'));
      ms.slice().reverse().forEach(function (m) {
        var p1 = ehPrevia(m) || sapParcial(m);
        linhas.push(linhaEvo(mesLbl(m) + (p1 ? '<span class="parc">' + (sapParcial(m) ? 'EM CURSO' : 'PRÉVIA') + '</span>' : ''), [m], m === st.mes ? 'dest' : ''));
      });
    });
    t.querySelector('tbody').innerHTML = linhas.join('') || '<tr><td colspan="9" class="falta">Sem meses.</td></tr>';
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
  function mktSoma(ms, seg) { var M = null; ms.forEach(function (m) { var x = mktP(m, seg); if (!x) return; M = M || {}; Object.keys(x).forEach(function (k) { if (k !== '_prev' && k !== '_dia') M[k] = (M[k] || 0) + x[k]; }); }); return M; }
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
  /* volume médio do posto num produto, seja qual for o filtro da tela */
  function mediaEstProd(ms, p, prod) { var a = st.prod, v; st.prod = prod; try { v = mediaEst(ms, p); } finally { st.prod = a; } return v; }
  /* Projeção de um posto novo por PERFIL (decisão de 16/11/2026): urbano e rodovia, cada um com as
     unidades de referência dele (perfis do arquivo cifrado). Por grupo de produto (gasolina/etanol e
     diesel): padrão cheio (36 meses) = litros por bico por mês da referência (volume ÷ bicos do cadastro
     da ANP, média dos últimos 12 meses fechados; GNV fora); 6, 12 e 24 meses = a rampa (frações do
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
      if (!pf.mix) out[k] = { nome: pf.nome || k, us: us, g: g, rot: nomes(us) };
    });
    /* perfil MISTO (21/11/2026): cada produto vem de outro perfil, numa fração dele —
       mix:{otto:{de:'urbano',f:0.7},diesel:{de:'rodovia',f:0.8}} (litros por bico × f) */
    Object.keys(D.exp.perfis || {}).forEach(function (k) {
      var pf = D.exp.perfis[k]; if (!pf.mix) return;
      var g = {}, us = [], rot = [];
      GRUPOS.forEach(function (G) {
        var m = pf.mix[G[0]], b = m && out[m.de], x = b && b.g[G[0]];
        /* teto do misto = a maior unidade de referência da rede naquele produto (o da origem × f
           prenderia um posto grande ao tamanho de uma unidade pequena) */
        var tt = 0; Object.keys(out).forEach(function (o) { var y = out[o].g[G[0]]; if (y && y.teto > tt) tt = y.teto; });
        g[G[0]] = x ? { l: x.l * m.f, teto: tt } : null;
        if (x) { rot.push(G[2].toLowerCase() + ' ' + num(m.f * 100, 0) + '% do ' + b.nome); b.us.forEach(function (u) { if (us.indexOf(u) < 0) us.push(u); }); }
      });
      out[k] = { nome: pf.nome || k, us: us, g: g, rot: rot.join(' · ') };
    });
    return out;
  }
  /* rampa da Expansão (18/11/2026): marcos em meses e fração do padrão; o último marco é sempre 100%.
     Arquivo cifrado: {m6,m12,m24} = frações e o padrão cheio em 36 meses; formato antigo {m6,m12} = 100% em 24. */
  function rampaExp() {
    var R = (D.exp && D.exp.rampa) || {}, a = [];
    if (R.m24 != null) { [[6, R.m6], [12, R.m12], [24, R.m24]].forEach(function (x) { if (x[1]) a.push({ m: x[0], f: x[1] }); }); a.push({ m: 36, f: 1 }); }
    else { [[6, R.m6], [12, R.m12]].forEach(function (x) { if (x[1]) a.push({ m: x[0], f: x[1] }); }); a.push({ m: 24, f: 1 }); }
    return a;
  }
  /* botão "?" da Expansão (18/11/2026): o racional de cada conta, ao passar o mouse, focar ou tocar */
  function ajudaExp(PF, RP, comTeto) {
    var refs = Object.keys(PF).map(function (k) { return PF[k].nome + ' = ' + PF[k].rot; }).join('; ');
    var li = [
      ['Hoje', 'Volume informado por você, quando há. Sem ele, estimativa: média por posto da bandeira dele no RS (ANP) × bicos do posto ÷ bicos médios da bandeira.'],
      ['Padrão', 'Litros por bico por mês da unidade de referência do perfil (' + refs + '): compras dos últimos 12 meses fechados ÷ bicos do cadastro da ANP, separado em gasolina/etanol e diesel.'],
      ['Projeção', 'Por produto: bicos do posto × padrão × fração da rampa (' + RP.map(function (r) { return num(r.f * 100, 0) + '% em ' + r.m; }).join(', ') + ' meses), nunca abaixo do volume de hoje naquele produto. Em "Ajustar" dá para informar o volume de hoje por produto e mudar o alvo (% do padrão) de cada um.'],
      comTeto ? ['Teto', 'O posto novo não passa do volume médio da unidade de referência em cada produto: mais bicos não trazem mais clientes na mesma proporção.'] : null,
      ['Rede', 'Volume projetado no último marco ÷ compras médias da rede no período escolhido.'],
      ['Na área', 'Posição do posto pelo volume entre os postos da área (raio ou área de uma unidade nossa); fatia = volume dele ÷ soma da área.'],
      ['SOM com ele', 'SOM da unidade se o volume dele passasse a ser nosso: (nossas compras + volume dele) ÷ SAM da área.'],
      ['Município', 'Mercado anual da ANP, por posto cadastrado, crescimento do último ano e frota de veículos (Senatran).']
    ].filter(Boolean);
    return ajudaBox(li, 'Como as contas são feitas');
  }
  function ajudaBox(li, rotulo) {
    return '<span class="ajuda"><button type="button" class="aj-bt" aria-label="' + esc(rotulo) + '" aria-expanded="false">?</button><span class="aj-box" role="tooltip">' + li.map(function (x) { return '<span class="aj-i"><b>' + esc(x[0]) + '</b>' + esc(x[1]).replace(/\n/g, '<br>') + '</span>'; }).join('') + '</span></span>';
  }
  /* "?" ao lado do campo Perfil (21/11/2026): mil litros por bico por mês de cada perfil, por produto,
     com a média da rede e a dos postos do RS nos mesmos 12 meses fechados */
  function ajudaPerfis() {
    var PF = perfis(), R = D.raio, mil = function (x) { return x == null ? '—' : num(x, 1); };
    var lin = function (g) { return GRUPOS.map(function (G) { return G[2].toLowerCase() + ' ' + mil(g[G[0]]); }).join(' · '); };
    var li = Object.keys(PF).map(function (k) { var g = {}; GRUPOS.forEach(function (G) { var x = PF[k].g[G[0]]; g[G[0]] = x ? x.l : null; }); return [PF[k].nome + ' (' + PF[k].rot + ')', lin(g)]; });
    var fs = mesesSap().filter(function (m) { return !sapParcial(m); }).slice(-12), rede = {}, rs = {};
    GRUPOS.forEach(function (G) {
      var v = 0, b = 0;
      codigosUn().forEach(function (u) { var inf = R.unidades[u] && R.unidades[u].infra; if (!inf) return; var ms = fs.filter(function (m) { return brutoUn(m, u, 'tot') > 0; }); if (!ms.length) return; var t = 0; ms.forEach(function (m) { t += brutoUn(m, u, G[0]); }); v += t / ms.length; b += inf['b' + G[1]]; });
      rede[G[0]] = b ? v / b : null;
      var t = 0, n = 0, bb = 0, I = R.rs_infra || {};
      fs.forEach(function (m) { var x = mktP(m, 'rev', G[0]); if (x) { t += x.Total * 1000; n++; } });
      Object.keys(I).forEach(function (k) { bb += I[k]['b' + G[1]] || 0; });
      rs[G[0]] = n && bb ? t / n / bb : null;
    });
    li.push(['Média da rede (' + nomes(codigosUn().filter(function (u) { return R.unidades[u] && R.unidades[u].infra; })) + ')', lin(rede)]);
    li.push(['Média dos postos do RS', lin(rs)]);
    li.push(['Como é medido', 'Mil litros por bico por mês: volume médio dos últimos 12 meses fechados ÷ bicos do cadastro da ANP. GNV e Arla ficam fora.']);
    return ajudaBox(li, 'Litros por bico de cada perfil');
  }
  /* "?" de cada ficha: o racional do cálculo DESTE posto, com os números dele */
  function ajudaPosto(o) {
    var semHtml = function (x) { return String(x || '').replace(/<[^>]+>/g, ''); }, li = [];
    li.push(['Hoje', num(o.vol, 0) + ' m³/mês (' + PROD_NOME[st.prod] + ', ' + perLbl(st.mes) + '). ' + '\n' + (o.inf ? 'Volume informado por você (' + num(o.inf.total, 0) + ' m³/mês por mês típico), ajustado mês a mês pela ANP.' : 'Estimado: média por posto da bandeira ' + nomeBand(o.p.bandeira) + ' no RS × bicos dele ÷ bicos médios da bandeira.')]);
    if (!o.bc || !o.pf) li.push(['Projeção', 'Sem projeção: ' + (!o.pf ? 'o perfil do posto não tem unidade de referência.' : 'o cadastro da ANP não traz os bicos deste posto.')]);
    else {
      li.push(['Padrão', o.pf.nome + ' (referência ' + o.pf.rot + ')' + (o.gs.length ? ':\n' + o.gs.map(function (g) { return g.nome + ': ' + g.b + ' bicos × ' + num(g.l, 1) + ' mil L = ' + num(g.bruto, 0) + ' m³' + (g.cortou ? ' → teto de ' + num(g.teto, 0) : '') + (g.aj !== 1 ? ' × alvo ' + num(g.aj * 100, 0) + '%' : '') + (g.f24 !== 1 ? ' × 24 h ' + sinal((g.f24 - 1) * 100, 0) : '') + (g.aj !== 1 || g.f24 !== 1 ? ' = ' + num(g.alvo, 0) : '') + ' (hoje ' + num(g.hoje, 0) + ')'; }).join('\n') : '')]);
      li.push(['Projeção', o.passos.map(function (q) { return q.m + ' meses (' + num(q.f * 100, 0) + '%): ' + num(q.v, 0) + (q.pisos.length ? ' — ' + q.pisos.join(' e ') + ' mantém hoje' : ''); }).join('\n') + '\nEm cada produto, o maior entre o volume de hoje e padrão × fração; o total é a soma.']);
      li.push(['Rede', 'Último marco ' + num(o.fim, 0) + ' ÷ compras médias da rede ' + num(o.nosRede, 0) + ' m³/mês\n= ' + sinal(o.fim / o.nosRede * 100, 0) + ' sobre a rede.']);
    }
    li.push(['Na área', o.pos + 'º entre ' + o.n + ' postos (' + o.rot + ')\n' + pct(o.vol / o.sam * 100, 1) + ' de ' + num(o.sam, 0) + ' m³/mês, a soma da área.']);
    li.push(['SOM com ele', o.efeitos.length ? o.efeitos.map(semHtml).join('\n') + '\n(compras + volume dele) ÷ SAM da área.' : 'Nenhuma unidade nossa o tem hoje como concorrente: área nova para a rede.']);
    if (o.munTxt) li.push(['Município', semHtml(o.munTxt + o.frTxt).replace(/ · /g, '\n') + '\nFontes: ANP anual e frota do Senatran.']);
    return ajudaBox(li, 'Como as contas deste posto são feitas');
  }
  var EXP_ABERTOS = {};
  function expansao() {
    var bt = document.querySelector('#abas button[data-aba="expansao"]'), box = el('expFichas');
    var gere = podeGerir();
    if (bt) bt.hidden = !(temExp() || gere);
    if (el('expAdd')) el('expAdd').hidden = !gere;
    if (!box) return;
    if (!temExp()) { box.innerHTML = ''; el('expPadrao').innerHTML = ''; el('n-exp').textContent = gere ? 'Nenhum posto em avaliação.' : ''; if (!gere && st.aba === 'expansao') st.aba = 'unidades'; return; }
    var meses = mesesValidos(), R = D.raio, todas = codigosUn();
    el('n-exp').textContent = 'Volumes estimados' + (st.per === 'mes' ? '' : ', em média por mês') + '; o número real só vem do vendedor.';
    if (!meses.length) { box.innerHTML = '<p class="falta">Sem mercado e compras para ' + esc(perLbl(st.mes)) + '.</p>'; return; }
    var nosRede = nosDe(meses, todas) / meses.length;
    var PF = perfis(), mil = function (v) { return v == null ? '—' : num(v, 1); }, RP = rampaExp(), comTeto = D.exp.teto !== false;
    var gs = GRUPOS.filter(function (G) { return st.prod === 'tot' || st.prod === G[0]; });
    el('expPadrao').innerHTML = '<p class="exp-pad">' + ajudaExp(PF, RP, comTeto) + 'Rampa: ' + RP.map(function (r) { return '<b>' + num(r.f * 100, 0) + '%</b> em ' + r.m; }).join(' · ') + ' meses</p>' +
      '<details class="dobra"><summary>Padrões por perfil</summary><div class="tabela"><table class="rk"><thead><tr><th>Perfil</th><th>Produto</th>' + RP.map(function (r) { return '<th class="num"' + (r === RP[0] ? ' title="Mil litros por bico por mês"' : '') + '>' + r.m + ' meses</th>'; }).join('') + '<th class="num" title="Volume máximo do posto novo: o da unidade de referência">Teto (m³)</th></tr></thead><tbody>' + Object.keys(PF).map(function (k) {
        var pf = PF[k];
        return gs.map(function (G, i) { var x = pf.g[G[0]]; return '<tr><td>' + (i ? '' : '<b>' + esc(pf.nome) + '</b> <small class="falta">' + esc(pf.rot) + '</small>') + '</td><td>' + G[2] + '</td>' + RP.map(function (r) { return '<td class="num">' + (x ? mil(x.l * r.f) : '—') + '</td>'; }).join('') + '<td class="num">' + (x && comTeto ? num(x.teto, 0) : '—') + '</td></tr>'; }).join('');
      }).join('') + '</tbody></table></div><p class="nota">Mil litros por bico por mês.</p></details>';
    box.innerHTML = D.exp.candidatos.map(function (c, idx) {
      var p = postoArea(c.cnpj);
      if (!p) return '<div class="ficha"><div class="ficha-topo"><h3>' + esc(c.apelido) + '</h3>' + (gere ? '<button type="button" class="exp-rem" data-rem="' + esc(c.cnpj) + '">Remover</button>' : '') + '</div><p class="falta">Posto não encontrado no cadastro da ANP da região.</p></div>';
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
      /* projeção POR PRODUTO (21/11/2026): em cada produto vale o maior entre o volume de hoje e
         bicos × padrão × fração da rampa × alvo do posto (c.ajuste, 1 = padrão cheio); o total é a soma.
         Posto que já vende acima do padrão num produto mantém esse volume e ainda cresce no outro. */
      var bc = bicosDe(p.infra, st.prod), pf = PF[c.perfil] || null, aj = c.ajuste || {};
      /* posto 24 horas (21/11/2026): o padrão vem de unidades que abrem 5h–23h; quem fica aberto a noite
         toda ganha o fator h24 do cifrado (padrão +10%) sobre o alvo de cada produto */
      var f24 = c.h24 ? (D.exp.h24 > 1 ? D.exp.h24 : 1.1) : 1;
      var gsP = [], fixo = 0;
      GRUPOS.forEach(function (G) {
        if (st.prod !== 'tot' && st.prod !== G[0]) return;
        var x = pf && pf.g[G[0]], b = p.infra ? p.infra['b' + G[1]] : 0, hj = mediaEstProd(meses, p, G[0]) || 0;
        if (!x || !b) { fixo += hj; return; }
        var bruto = b * x.l, cortou = comTeto && bruto > x.teto, a = aj[G[0]] > 0 ? aj[G[0]] : 1;
        gsP.push({ k: G[0], nome: G[2], b: b, l: x.l, bruto: bruto, teto: x.teto, cortou: cortou, aj: a, f24: f24, hoje: hj, alvo: (cortou ? x.teto : bruto) * a * f24, ant: hj });
      });
      var temProj = !!(bc && pf && gsP.length), sp = [], pas = [], fimV = vol, cheio = fixo;
      gsP.forEach(function (g) { cheio += g.alvo; });
      RP.forEach(function (r) {
        if (!temProj) { sp.push(null); return; }
        var v = fixo, pisos = [], sobem = [];
        gsP.forEach(function (g) { var pv = g.alvo * r.f; (g.ant > pv + 0.5 ? pisos : sobem).push(g.nome.toLowerCase()); g.ant = Math.max(g.ant, pv); v += g.ant; });
        sp.push({ v: v, f: r.f, pisos: pisos, sobem: sobem, teto: gsP.some(function (g) { return g.cortou; }) });
        pas.push({ m: r.m, f: r.f, v: v, pisos: pisos }); fimV = v;
      });
      gsP.forEach(function (g) { g.fim = g.ant; });
      var aberto = !!EXP_ABERTOS[idx];
      var ajP = ajudaPosto({ vol: vol, inf: inf, p: p, bc: bc, pf: pf, gs: gsP, cheio: cheio, passos: pas, fim: fimV, nosRede: nosRede, n: linhas.length, rot: rot, pos: pos, sam: sam, efeitos: efeitos, munTxt: munTxt, frTxt: frTxt });
      var h = '<div class="ficha"><div class="ficha-topo"><div class="ficha-tt">' + ajP + '<h3>' + esc(c.apelido) + '</h3></div>' + (gere ? '<span class="exp-bts"><button type="button" class="exp-rem" data-aj="' + esc(c.cnpj) + '" title="Perfil, área, volume de hoje por produto e alvo da projeção">Ajustar</button><button type="button" class="exp-rem" data-rem="' + esc(c.cnpj) + '">Remover</button></span>' : '') + '</div><p class="nota">' + (pf ? '<b>' + esc(pf.nome) + '</b> · ' : '') + (c.h24 ? '<span title="Aberto 24 horas: alvo ' + sinal((f24 - 1) * 100, 0) + ' sobre o padrão, que vem de unidades abertas das 5h às 23h">24 h</span> · ' : '') + esc(nomeBand(p.bandeira)) + ' · ' + esc(nomeCidade(mun)) + (dists ? ' · ' + esc(dists) : '') + '</p>';
      var passo = function (rt, v, sub) { return '<div class="mini"><div class="lbl">' + rt + '</div><div class="val">' + num(v, 0) + '<small>m³/mês</small>' + (v > vol * 1.005 ? ' <small class="up">' + sinal((v / vol - 1) * 100, 0) + '</small>' : '') + '</div><div class="sub">' + sub + '</div></div>'; };
      h += '<div class="quad">' + passo('Hoje' + (inf ? ' · informado' : ' · estimado'), vol, p.infra ? p.infra.bo + ' + ' + p.infra.bd + ' bicos' : '') +
        RP.map(function (r, k) { var x = sp[k], ult = k === RP.length - 1; if (!x) return '';
          var pc = num(r.f * 100, 0) + '% do ' + (gsP.some(function (g) { return g.aj !== 1 || g.f24 !== 1; }) ? 'alvo' : 'padrão');
          var sub = !x.pisos.length ? pc : !x.sobem.length ? '<span title="Neste marco o padrão fica abaixo do volume de hoje em todos os produtos: a projeção mantém o de hoje.">mantém hoje</span>' : '<span title="' + esc(x.sobem.join(' e ')) + ' chega a ' + pc + ' neste marco. Em ' + esc(x.pisos.join(' e ')) + ' o alvo fica abaixo do volume de hoje: mantém o de hoje.">cresce só ' + esc(x.sobem.join(' e ')) + (ult ? '' : ' · ' + pc) + '</span>';
          return passo('Em ' + r.m + ' meses', x.v, ult ? (x.pisos.length ? sub + ' · ' : x.teto ? 'no teto · ' : '') + 'rede ' + sinal(x.v / nosRede * 100, 0) : sub); }).join('') +
        '<div class="mini"><div class="lbl">Na área</div><div class="val">' + pos + 'º<small>de ' + linhas.length + '</small></div><div class="sub">' + pct(vol / sam * 100, 1) + ' de ' + num(sam, 0) + ' m³/mês · ' + esc(rot) + '</div></div></div>';
      if (temProj && gsP.length > 1) h += '<p class="nota exp-prod">' + gsP.map(function (g) { return '<b>' + g.nome + '</b> ' + num(g.hoje, 0) + ' → ' + num(g.fim, 0) + (g.aj !== 1 ? ' <small class="falta">alvo ' + num(g.aj * 100, 0) + '%</small>' : ''); }).join(' · ') + ' <small class="falta">m³/mês, hoje → ' + RP[RP.length - 1].m + ' meses</small></p>';
      h += '<p class="exp-ef">' + (efeitos.length ? '<b>SOM com ele:</b> ' + efeitos.join(' · ') : '<b>Área nova</b> para a rede') + (munTxt ? '<br><span class="falta">' + munTxt + frTxt + '</span>' : '') + '</p>';
      h += '<details class="dobra" data-exp="' + idx + '"' + (aberto ? ' open' : '') + '><summary>Ver os ' + linhas.length + ' postos da área</summary><div class="tabela"><table class="rk"><thead><tr><th class="num">#</th><th>Posto</th><th class="num mo">km</th><th class="num">m³/mês</th><th class="num">Fatia</th></tr></thead><tbody>' + linhas.map(function (l, i) {
        if (l.cand) return '<tr class="dest"><td class="num">' + (i + 1) + '</td><td>' + esc(c.apelido) + ' (em avaliação)</td><td class="num mo">—</td><td class="num">' + num(l.v, 0) + '</td><td class="num">' + pct(l.v / sam * 100, 1) + '</td></tr>';
        if (l.nosso) return '<tr><td class="num">' + (i + 1) + '</td><td><span class="ponto s"></span><b>' + esc(UNID()[l.nosso].nome) + '</b> (nosso)</td><td class="num mo">' + (l.km != null ? num(l.km, 1) : '—') + '</td><td class="num">' + num(l.v, 0) + '</td><td class="num">' + pct(l.v / sam * 100, 1) + '</td></tr>';
        var q = l.p, outro = D.exp.candidatos.filter(function (o) { return o.cnpj === q.cnpj; })[0]; return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(nomePosto(q.nome)) + (outro ? ' <small class="selo">também em avaliação</small>' : '') + (informada(q) ? ' <small class="selo">informada</small>' : '') + '<br><small class="falta">' + esc(nomeBand(q.bandeira)) + ' · ' + esc([q.bairro, q.municipio].filter(Boolean).map(nomeCidade).join(' · ')) + '</small></td><td class="num mo">' + (l.km != null ? num(l.km, 1) : '—') + '</td><td class="num">' + num(l.v, 0) + '</td><td class="num">' + pct(l.v / sam * 100, 1) + '</td></tr>';
      }).join('') + '</tbody></table></div></details></div>';
      return h;
    }).join('');
  }

  /* ---------- Expansão: adicionar e remover posto em avaliação (só admin, 16/11/2026) ----------
     O posto é escolhido no cadastro público da região (raio.area); o que é estratégico — quem está
     em avaliação, apelido, perfil, área e volume informado — é cifrado no navegador e gravado em
     expansao.enc.json / estimativas.enc.json pela API do GitHub (mesmo caminho das Configurações).
     Antes de gravar, o arquivo é relido da nuvem: nada de outro aparelho é sobrescrito. */
  var GH_MERC = 'https://api.github.com/repos/samuelfelipe-sketch/painel-estacao-operacional/contents/mercado/';
  function podeGerir() { var A = window.sapataoAuth, K = window.sapataoCofre; return !!(A && A.user && A.user.admin && D.exp && D.exp.perfis && temRaio() && K && K.cifra); }
  function semAcento(x) { return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function hojeIso() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var MODO = /(^|\.)github\.io$/i.test(location.hostname) ? 'github.io' : 'servidor';
  var SEM_CHAVE = 'a chave de publicação ou a sessão deste aparelho venceu — toque em Sair, entre de novo e tente outra vez';
  async function gravaCifrado(arq, cache, msg, muda) {
    var K = window.sapataoCofre, tok = window.sapataoChave && window.sapataoChave.token();
    if (!tok) throw new Error('este aparelho não tem a chave de publicação — saia e entre com a senha');
    if (!K.dek()) throw new Error('este aparelho não tem a chave dos dados — saia e entre com a senha');
    var h = { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' };
    var g = await fetch(GH_MERC + arq + '?ref=main&t=' + Date.now(), { headers: h, cache: 'no-store' }), sha = null, atual = null;
    if (g.ok) {
      var j = await g.json(); sha = j.sha;
      atual = await K.decifra(JSON.parse(atob(String(j.content || '').replace(/\s/g, ''))));
      if (!atual) throw new Error('não consegui abrir o arquivo atual');
    } else if (g.status === 401 || g.status === 403) throw new Error(SEM_CHAVE + ' [leitura ' + g.status + ', ' + MODO + ']');
    else if (g.status !== 404) throw new Error('HTTP ' + g.status);
    var novo = muda(atual); novo.atualizado_em = new Date().toISOString().slice(0, 16);
    var doc = await K.cifra(novo), body = { message: msg, branch: 'main', content: btoa(JSON.stringify(doc)) };
    if (sha) body.sha = sha;
    var r = await fetch(GH_MERC + arq, { method: 'PUT', headers: h, body: JSON.stringify(body) });
    if (r.status === 401 || r.status === 403) throw new Error(SEM_CHAVE + ' [gravação ' + r.status + ', ' + MODO + ']');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    try { localStorage.setItem(cache, JSON.stringify(doc)); } catch (e) {}
    return novo;
  }
  var expSel = null;
  function expMsg(t) { el('expMsg').textContent = t || ''; }
  function expAchados(pedido) {
    var q = semAcento(el('expBusca').value).split(/\s+/).filter(Boolean), box = el('expAchados');
    if (!q.length || q.join('').length < 3) { box.innerHTML = pedido === true ? '<small class="falta">Digite pelo menos 3 letras.</small>' : ''; return; }
    var ja = {}; (D.exp.candidatos || []).forEach(function (c) { ja[c.cnpj] = 1; });
    var ls = (D.raio.area || []).filter(function (p) {
      if (ja[p.cnpj] || nossaDe(p.cnpj)) return false;
      var t = semAcento([p.nome, p.bairro, p.municipio, p.end, p.bandeira, p.cnpj].join(' '));
      return q.every(function (w) { return t.indexOf(w) >= 0; });
    }).slice(0, 8);
    box.innerHTML = ls.map(function (p) {
      return '<button type="button" data-cnpj="' + esc(p.cnpj) + '"><b>' + esc(nomePosto(p.nome)) + '</b><br><small>' + esc(nomeBand(p.bandeira)) + ' · ' + esc([p.end, p.bairro, p.municipio].filter(Boolean).map(nomeCidade).join(' · ')) + '</small></button>';
    }).join('') || '<small class="falta">Nada encontrado nos municípios mapeados.</small>';
  }
  function expEscolhe(cnpj) {
    var p = postoArea(cnpj); if (!p) return;
    expSel = p; el('expAchados').innerHTML = ''; el('expBusca').value = '';
    el('expEsc').innerHTML = '<b>' + esc(nomePosto(p.nome)) + '</b> <small>' + esc(nomeBand(p.bandeira)) + ' · ' + esc([p.bairro, p.municipio].filter(Boolean).map(nomeCidade).join(' · ')) + (p.infra ? ' · ' + p.infra.bo + ' + ' + p.infra.bd + ' bicos' : ' · sem bicos no cadastro') + '</small>';
    var ja = (D.exp.candidatos || []).filter(function (c) { return c.cnpj === cnpj; })[0] || null;
    el('expApelido').value = ja ? ja.apelido : nomePosto(p.nome).slice(0, 40);
    el('expPerfil').innerHTML = Object.keys(D.exp.perfis).map(function (k) { return '<option value="' + esc(k) + '">' + esc(D.exp.perfis[k].nome || k) + '</option>'; }).join('');
    var kms = [2, 3, 5]; (D.exp.candidatos || []).forEach(function (c) { if (c.cnpj === cnpj && c.area.tipo === 'raio' && kms.indexOf(c.area.km) < 0) kms.push(c.area.km); });
    el('expArea').innerHTML = kms.map(function (k) { return '<option value="raio:' + k + '"' + (k === 3 ? ' selected' : '') + '>Raio de ' + k + ' km</option>'; }).join('') +
      codigosUn().filter(function (u) { return D.raio.unidades[u]; }).map(function (u) { return '<option value="un:' + esc(u) + '">Área do ' + esc(UNID()[u].nome) + '</option>'; }).join('');
    el('expPerfilAj').innerHTML = ajudaPerfis();
    if (ja) { el('expPerfil').value = ja.perfil; el('expArea').value = ja.area.tipo === 'unidade' ? 'un:' + ja.area.u : 'raio:' + ja.area.km; }
    var inf = informada(p), split = inf && inf.otto != null && inf.diesel != null, aj0 = (ja && ja.ajuste) || {};
    el('expVol').value = inf ? inf.total : ''; el('expVolO').value = split ? inf.otto : ''; el('expVolD').value = split ? inf.diesel : '';
    el('expH24').checked = !!(ja && ja.h24);
    el('expAjO').value = aj0.otto > 0 ? Math.round(aj0.otto * 100) : ''; el('expAjD').value = aj0.diesel > 0 ? Math.round(aj0.diesel * 100) : '';
    el('expCampos').hidden = false; expMsg(''); el('expApelido').focus();
  }
  function expFecha() { expSel = null; el('expForm').hidden = true; el('expCampos').hidden = true; el('expAchados').innerHTML = ''; el('expBusca').value = ''; expMsg(''); }
  async function expSalva(ev) {
    ev.preventDefault(); if (!podeGerir()) return;
    if (!expSel) { expAchados(true); return; }   /* Enter no campo de busca: procura, não grava */
    var p = expSel, apelido = el('expApelido').value.trim(), ar = el('expArea').value.split(':'), vol = +el('expVol').value || 0, bt = el('expSalva');
    if (!apelido) { expMsg('Dê um apelido ao posto.'); return; }
    var cand = { cnpj: p.cnpj, apelido: apelido, perfil: el('expPerfil').value, area: ar[0] === 'un' ? { tipo: 'unidade', u: ar[1] } : { tipo: 'raio', km: +ar[1] } };
    var antes = (D.exp.candidatos || []).filter(function (c) { return c.cnpj === p.cnpj; })[0];
    if (antes && antes.descartados) cand.descartados = antes.descartados;
    if (antes && antes.nota) cand.nota = antes.nota;
    /* alvo da projeção por produto, em % do padrão do perfil (em branco ou 100 = padrão cheio) */
    var ajO = +el('expAjO').value || 0, ajD = +el('expAjD').value || 0, aj = {};
    if ((ajO && (ajO < 10 || ajO > 300)) || (ajD && (ajD < 10 || ajD > 300))) { expMsg('O alvo vai de 10% a 300% do padrão.'); return; }
    if (ajO && ajO !== 100) aj.otto = ajO / 100; if (ajD && ajD !== 100) aj.diesel = ajD / 100;
    if (aj.otto || aj.diesel) cand.ajuste = aj;
    if (el('expH24').checked) cand.h24 = true;
    /* volume de hoje: por produto (os dois campos) ou só o total */
    var sO = el('expVolO').value.trim(), sD = el('expVolD').value.trim(), vO = +sO || 0, vD = +sD || 0, porProd = sO !== '' && sD !== '' && vO + vD > 0;
    if ((sO !== '') !== (sD !== '')) { expMsg('Preencha gasolina/etanol e diesel (use 0 se não vende), ou só o total.'); return; }
    if (porProd) vol = vO + vD;
    bt.disabled = true; expMsg('Cifrando e gravando…');
    try {
      var ex = await gravaCifrado('expansao.enc.json', 'sapatao-mercado-v1-exp', 'chore: atualiza os postos em avaliação do Market Share (manual)', function (x) {
        if (!x || !x.perfis) throw new Error('o arquivo de avaliação não abriu');
        var k = -1; (x.candidatos || []).forEach(function (c, n) { if (c.cnpj === cand.cnpj) k = n; });
        x.candidatos = x.candidatos || []; if (k >= 0) x.candidatos[k] = cand; else x.candidatos.push(cand); return x;
      });
      D.exp = ex;
      var inf = informada(p);
      var igual = inf && inf.total === vol && (porProd ? inf.otto === vO && inf.diesel === vD : inf.otto == null);
      if (vol > 0 && !igual) {
        D.estim = await gravaCifrado('estimativas.enc.json', 'sapatao-mercado-v1-est', 'chore: atualiza as estimativas de concorrentes do Market Share (manual)', function (x) {
          x = x || { v: 1, unidade: 'm3/mês', postos: {} }; x.postos = x.postos || {};
          var reg = { nome: nomePosto(p.nome), total: vol, ref: D.anp.ultimo_fechado, fonte: window.sapataoAuth.user.nome, em: hojeIso() };
          if (porProd) { reg.otto = vO; reg.diesel = vD; }
          var ant = x.postos[p.cnpj]; if (ant && ant.obs) reg.obs = ant.obs;
          x.postos[p.cnpj] = reg; return x;
        });
      }
      expFecha(); desenha(); el('n-exp').textContent = 'Posto gravado. Nos outros aparelhos aparece em 1–2 minutos.';
    } catch (e) { expMsg('Não consegui gravar (' + e.message + ').'); }
    bt.disabled = false;
  }
  async function expRemove(cnpj) {
    var c = (D.exp.candidatos || []).filter(function (x) { return x.cnpj === cnpj; })[0];
    if (!c || !podeGerir() || !window.confirm('Tirar "' + c.apelido + '" dos postos em avaliação?')) return;
    el('n-exp').textContent = 'Gravando…';
    try {
      D.exp = await gravaCifrado('expansao.enc.json', 'sapatao-mercado-v1-exp', 'chore: atualiza os postos em avaliação do Market Share (manual)', function (x) {
        if (!x || !x.perfis) throw new Error('o arquivo de avaliação não abriu');
        x.candidatos = (x.candidatos || []).filter(function (o) { return o.cnpj !== cnpj; }); return x;
      });
      desenha(); el('n-exp').textContent = 'Posto retirado da avaliação.';
    } catch (e) { el('n-exp').textContent = 'Não consegui gravar (' + e.message + ').'; }
  }

  /* ---------- aba Fontes e método ---------- */
  function fontes() {
    var A = D.anp, S = D.sapatao, R = D.raio, ms = mesesSap(), ma = mesesAnp(), li = [];
    li.push('<li><b>TAM:</b> vendas das distribuidoras aos postos do RS (ANP), de ' + mesLbl(ma[0]) + ' a ' + mesLbl(ma[ma.length - 1]) + '. A ANP publica com cerca de dois meses de atraso.</li>');
    li.push('<li><b>Sapatão:</b> compras às distribuidoras (Argo), até ' + (ms.length ? mesLbl(ms[ms.length - 1]) : '—') + '.</li>');
    li.push('<li><b>Prévia:</b> mês sem ANP = mesmo mês do ano passado × crescimento médio dos últimos 12 meses. Mês em curso = compras projetadas pelo ritmo.</li>');
    if (R) li.push('<li><b>Concorrentes:</b> lista escolhida pela diretoria; cada um vale a média da bandeira no RS ajustada pelos bicos do posto, ou o volume informado. Cadastro da ANP conferido toda semana.</li>');
    if (R && R.rs_infra) li.push('<li><b>Litros por bico:</b> nossas compras ÷ bicos da unidade no cadastro da ANP, por mês e no produto escolhido. RS = mercado dos postos ÷ bicos de todos os postos do RS.</li>');
    li.push('<li><b>Mesmas unidades:</b> a comparação com o ano anterior deixa de fora a unidade que ainda não existia.</li>');
    if (S.carteiras) li.push('<li><b>Carteira do GV:</b> participação na bandeira ÷ fração da carteira (' + Object.keys(S.carteiras).map(function (b) { var c = S.carteiras[b]; return b + ' ' + (c.fracao ? num(c.fracao * 100, 0) + '%' : 'a definir'); }).join(', ') + ').</li>');
    if (temExp()) li.push('<li><b>Projeção da Expansão:</b> bicos do posto × litros por bico da unidade de referência do perfil (urbano ou rodovia), por produto, com rampa em 6, 12, 24 e 36 meses e teto no volume da referência.</li>');
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
  /* barra de opções e abas ficam fixas ao rolar: mede a topbar e a barra para o CSS (--tb-h, --ctl-h) */
  function medeFixos() {
    var tb = document.querySelector('.topbar'), fx = el('fixo'), r = document.documentElement.style;
    if (tb) r.setProperty('--tb-h', tb.offsetHeight + 'px');
    if (fx) r.setProperty('--ctl-h', fx.offsetHeight + 'px');
  }
  function secAtiva() { return document.querySelector('.aba[data-aba="' + st.aba + '"]'); }
  var desenhou = false;
  function desenha() {
    /* trocar uma opção não tira a tela do lugar: a seção aberta fica onde estava, mesmo que o que vem acima mude de altura */
    var sec = desenhou ? secAtiva() : null, t0 = sec ? sec.getBoundingClientRect().top : 0, app = el('app');
    var fg = el('folga'); if (fg) { fg.hidden = true; fg.style.height = ''; }
    memo = {};
    montaMeses();
    marca('segProd', st.prod); marca('segPer', st.per);
    montaUnidades(); chips(); funil(); unidades(); evolucao(); bandeiras(); expansao(); fontes(); mostraAba();
    medeFixos();
    if (sec && sec === secAtiva()) {
      var dif = sec.getBoundingClientRect().top - t0, de = document.documentElement;
      /* se o conteúdo novo ficou curto demais para a tela continuar onde estava, a página ganha altura até lá */
      var alvo = window.scrollY + dif, z = app && app.offsetHeight ? app.getBoundingClientRect().height / app.offsetHeight : 1, h = 0;
      for (var k = 0; fg && k < 3; k++) {   /* scrollHeight não desce abaixo da altura da tela: confere de novo depois de dar a folga */
        var falta = alvo - (de.scrollHeight - window.innerHeight); if (falta < 1) break;
        h += falta / (z || 1); fg.hidden = false; fg.style.height = Math.ceil(h) + 'px';
      }
      if (Math.abs(dif) > 1) window.scrollBy(0, dif);
    }
    desenhou = true;
  }
  /* trocar de aba com a página rolada: a aba nova começa logo abaixo da barra fixa, em vez de cair no meio */
  function alinhaAba() {
    var sec = secAtiva(), ab = el('abas'); if (!sec || !ab) return;
    var lim = ab.getBoundingClientRect().bottom + 14, top = sec.getBoundingClientRect().top;
    if (top < lim - 1) window.scrollBy(0, top - lim);
  }
  window.renderMercado = function (dados) { D = dados || D; desenha(); };
  liga('segProd', 'prod'); liga('segPer', 'per');
  el('abas').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; st.aba = b.dataset.aba; guarda(); try { history.replaceState(null, '', '#' + st.aba); } catch (e) {} mostraAba(); alinhaAba(); });
  window.addEventListener('resize', medeFixos);
  /* a altura da barra muda quando a fonte carrega ou as opções quebram de linha */
  try { if (window.ResizeObserver) { var ro = new ResizeObserver(medeFixos); ro.observe(el('fixo')); var tbE = document.querySelector('.topbar'); if (tbE) ro.observe(tbE); } } catch (e) {}
  el('selMes').addEventListener('change', function () { st.mes = this.value; desenha(); });
  el('segUn').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; alternaUn(b.dataset.v); });
  function abreUn(ev) {
    var tr = ev.target.closest('tr.un-abre'); if (!tr) return;
    if (ev.type === 'keydown') { if (ev.key !== 'Enter' && ev.key !== ' ') return; ev.preventDefault(); }
    var u = tr.getAttribute('data-u'); ABERTOS[u] = !ABERTOS[u]; unidades();
  }
  el('expFichas').addEventListener('toggle', function (ev) { var d = ev.target; if (d && d.dataset && d.dataset.exp != null) EXP_ABERTOS[d.dataset.exp] = d.open; }, true);
  /* "?" no toque: abre e fecha (no mouse, o hover e o foco já mostram) */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('.aj-bt'), abertos = document.querySelectorAll('.ajuda.aberto');
    abertos.forEach(function (a) { if (!b || a !== b.parentNode) { a.classList.remove('aberto'); a.firstChild.setAttribute('aria-expanded', 'false'); } });
    if (b) { var on = b.parentNode.classList.toggle('aberto'); b.setAttribute('aria-expanded', String(on)); }
  });
  el('expAdd').addEventListener('click', function () { var f = el('expForm'); if (f.hidden) { f.hidden = false; el('expBusca').focus(); } else expFecha(); });
  el('expBusca').addEventListener('input', expAchados);
  el('expBuscar').addEventListener('click', function () { expAchados(true); el('expBusca').blur(); });
  el('expAchados').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-cnpj]'); if (b) expEscolhe(b.dataset.cnpj); });
  el('expCancela').addEventListener('click', expFecha);
  el('expForm').addEventListener('submit', expSalva);
  el('expFichas').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-rem]'); if (b) { expRemove(b.dataset.rem); return; }
    var a = ev.target.closest('button[data-aj]'); if (a) { el('expForm').hidden = false; expEscolhe(a.dataset.aj); el('expForm').scrollIntoView({ block: 'center' }); }
  });
  el('tReg').addEventListener('click', abreUn); el('tReg').addEventListener('keydown', abreUn);
  desenha();
})();
