/* Market Share — lógica do painel. Recebe window.DADOS_MERCADO = {anp, sapatao, postos}
   (ver index.html) e desenha tudo na tela; window.renderMercado(D) redesenha quando
   um arquivo publicado muda. Nenhum número fica escrito aqui: tudo vem dos arquivos.

   anp.dados[escopo][AAAA-MM][segmento][produto] = {Raízen, Ipiranga, Vibra, …, Outras, Total} em mil m³
   sapatao.meses[AAAA-MM] = {parcial, cobertura, band:{Raízen:{otto,gasolina,etanol,diesel}, Ipiranga:{…}}} em m³
   postos.escopos[escopo][AAAA-MM] = {Total, Raízen, Ipiranga, …} (postos revendedores) */
(function () {
  'use strict';
  var D = window.DADOS_MERCADO;
  var ESC_NOME = { RS: 'Rio Grande do Sul', SUL: 'Região Sul', BR: 'Brasil' };
  var ESC_CURTO = { RS: 'no RS', SUL: 'no Sul', BR: 'no Brasil' };
  var SEG_NOME = { rev: 'posto revendedor', band: 'postos bandeirados', bb: 'postos bandeira branca', tot: 'todos os segmentos' };
  var PROD_NOME = { tot: 'Consolidado', otto: 'Ciclo Otto', diesel: 'Diesel' };
  var MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var BANDS = ['Raízen', 'Ipiranga'];

  /* ---------- estado (lembrado por aparelho) ---------- */
  var st = { prod: 'tot', esc: 'RS', seg: 'rev', per: 'mes', mes: null, un: null, aba: 'unidades', serie: 'sap' }; /* un: null = todas as unidades; senão lista de códigos */
  try { var g = JSON.parse(localStorage.getItem('sapatao-mercado-estado-v1') || 'null'); if (g) ['prod', 'esc', 'seg', 'per', 'un', 'aba', 'serie'].forEach(function (k) { if (g[k]) st[k] = g[k]; }); } catch (e) {}
  try { var hb = (location.hash || '').replace('#', ''); if (/^(unidades|mensal|bandeiras|anual|fontes)$/.test(hb)) st.aba = hb; } catch (e) {}
  function guarda() { try { localStorage.setItem('sapatao-mercado-estado-v1', JSON.stringify({ prod: st.prod, esc: st.esc, seg: st.seg, per: st.per, un: st.un, aba: st.aba, serie: st.serie })); } catch (e) {} }

  /* ---------- formatação ---------- */
  var nf = {};
  function num(x, d) { if (x == null || !isFinite(x)) return '—'; var k = d || 0; nf[k] = nf[k] || new Intl.NumberFormat('pt-BR', { minimumFractionDigits: k, maximumFractionDigits: k }); return nf[k].format(x); }
  function pct(x, d) { if (x == null || !isFinite(x)) return '—'; return num(x, d == null ? (x < 1 ? 2 : 1) : d) + '%'; }
  function pp(x) { if (x == null || !isFinite(x)) return ''; if (Math.abs(x) < 0.005) return '0,00 p.p.'; return (x > 0 ? '+' : '') + num(x, 2) + ' p.p.'; }
  function cls(x) { return x == null || !isFinite(x) ? 'ne' : x > 0 ? 'up' : x < 0 ? 'dn' : 'ne'; }
  function mesLbl(ym) { var a = ym.split('-'); return MESES_PT[+a[1] - 1] + '/' + a[0].slice(2); }
  function mesLongo(ym) { var a = ym.split('-'); var n = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']; return n[+a[1] - 1] + ' de ' + a[0]; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el(id) { return document.getElementById(id); }
  function anoDe(ym) { return ym.slice(0, 4); }
  function anoAnt(ym) { return (+ym.slice(0, 4) - 1) + ym.slice(4); }

  /* ---------- acesso aos dados ---------- */
  function anpMes(ym, escopo) { return D.anp && D.anp.dados && D.anp.dados[escopo] && D.anp.dados[escopo][ym] || null; }
  function anpParcial(ym) { return !!(D.anp.status && D.anp.status[ym] && D.anp.status[ym].parcial); }
  /* mercado do mês para o estado atual: {Total, Raízen, Ipiranga, …, Outras} em mil m³ */
  function mkt(ym, escopo, seg, prod) {
    var m = anpMes(ym, escopo || st.esc); if (!m) return null;
    var s = m[seg || st.seg]; if (!s) return null;
    var p = prod || st.prod;
    if (p !== 'tot') return s[p] || null;
    var o = s.otto, d = s.diesel, r = {};
    Object.keys(o).forEach(function (k) { r[k] = (o[k] || 0) + (d[k] || 0); });
    return r;
  }
  /* Sapatão do mês: {total, Raízen, Ipiranga} em m³ */
  /* unidades da rede: código → {nome, bandeira}; ordem por código */
  function UNID() { return D.sapatao.unidades || {}; }
  function codigosUn() { return Object.keys(UNID()).sort(); }
  function unSel() { var sel = st.un && st.un.length ? st.un.filter(function (u) { return UNID()[u]; }) : codigosUn(); if (!sel.length) sel = codigosUn(); return sel; }
  function todasUn() { return unSel().length === codigosUn().length; }
  /* nº de unidades selecionadas por bandeira (para "x de N postos" e volume por posto) */
  function postosSel() { var r = { total: 0 }; BANDS.forEach(function (b) { r[b] = 0; }); unSel().forEach(function (u) { var b = UNID()[u].bandeira; r[b] = (r[b] || 0) + 1; r.total++; }); if (!codigosUn().length) { Object.keys(D.sapatao.postos || {}).forEach(function (b) { r[b] = D.sapatao.postos[b]; r.total += D.sapatao.postos[b]; }); } return r; }
  /* carteira do gerente de vendas da bandeira no recorte: participação ÷ fração da carteira */
  function carteira(b) { var c = D.sapatao.carteiras && D.sapatao.carteiras[b]; return (c && (c.escopo || 'RS') === st.esc) ? c : null; }
  function naCarteira(b, shB) { var c = carteira(b); if (!c || shB == null) return null; return c.fracao ? shB / c.fracao : null; }
  function cartTxt(b, shB) {
    var c = carteira(b); if (!c) return '';
    var v = naCarteira(b, shB);
    return '<div class="sub cart">' + (v != null ? '≈ <b>' + pct(v) + '</b> da carteira do GV <small>(' + num(c.fracao * 100, 0) + '% da ' + b + ' ' + ESC_CURTO[st.esc] + ')</small>' : 'Carteira do GV: fração a definir') + '</div>';
  }
  function volDe(v, p) { return v ? (p === 'tot' ? (v.otto || 0) + (v.diesel || 0) : (v[p] || 0)) : 0; }
  function sap(ym, prod, unidades) {
    var m = D.sapatao && D.sapatao.meses && D.sapatao.meses[ym]; if (!m) return null;
    var p = prod || st.prod, r = { total: 0 };
    BANDS.forEach(function (b) { r[b] = 0; });
    var sel = unidades || unSel();
    var todas = !unidades && todasUn();
    if (m.unid && (!todas || unidades)) {
      sel.forEach(function (u) { var b = UNID()[u].bandeira; var x = volDe(m.unid[u], p); r[b] = (r[b] || 0) + x; r.total += x; });
    } else if (todas) {
      BANDS.forEach(function (b) { var x = volDe(m.band[b], p); r[b] = x; r.total += x; });
    } else return null; /* mês sem abertura por unidade e seleção parcial: sem dado */
    r.parcial = !!m.parcial; r.cobertura = m.cobertura || null;
    return r;
  }
  function sapParcial(ym) { var m = D.sapatao.meses[ym]; return !!(m && m.parcial); }
  function mesesSap() { return Object.keys(D.sapatao.meses || {}).sort(); }
  function mesesAnp() { return (D.anp.meses || []).slice().sort(); }
  /* meses do período: 'mes' = [mes]; 'ano' = meses do ano até o mês selecionado que tenham Sapatão e ANP */
  function mesesPeriodo(ym, per) {
    per = per || st.per;
    if (per === 'mes') return [ym];
    var a = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var ini = per === 'ano' ? 1 : per === 'sem' ? (m <= 6 ? 1 : 7) : Math.floor((m - 1) / 3) * 3 + 1;
    var out = []; for (var k = ini; k <= m; k++) out.push(a + '-' + String(k).padStart(2, '0'));
    return out;
  }
  function shiftMes(ym, d) { var a = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + d; var y = a + Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + String(m + 1).padStart(2, '0'); }
  /* mesmo período imediatamente anterior (mês anterior, trimestre anterior…) */
  function periodoAnterior(meses, per) { per = per || st.per; var len = per === 'mes' ? 1 : per === 'tri' ? 3 : per === 'sem' ? 6 : 12; return meses.map(function (m) { return shiftMes(m, -len); }); }
  /* rótulo do período: set/26 · 3º tri/26 (jul–set) · 2º sem/26 (jul–set) · 2026 (jan–set) */
  function perLbl(ym, per) {
    per = per || st.per; if (per === 'mes') return mesLbl(ym);
    var ms = mesesPeriodo(ym, per), a = ym.slice(2, 4), m = +ym.slice(5, 7);
    var nome = per === 'ano' ? ym.slice(0, 4) : per === 'sem' ? (m <= 6 ? '1º' : '2º') + ' sem/' + a : Math.ceil(m / 3) + 'º tri/' + a;
    var ini = mesLbl(ms[0]).slice(0, 3), fim = mesLbl(ym).slice(0, 3);
    return nome + ' (' + (ms.length === 1 ? ini : ini + '–' + fim) + ')';
  }
  /* soma de mercado e Sapatão sobre uma lista de meses (só meses com os dois lados) */
  function soma(meses, escopo, seg, prod, unidades) {
    var M = null, S = { total: 0, 'Raízen': 0, 'Ipiranga': 0 }, usados = [], parcial = false;
    meses.forEach(function (m) {
      var mm = mkt(m, escopo, seg, prod), ss = sap(m, prod, unidades);
      if (!mm || !ss) return;
      usados.push(m);
      if (!M) { M = {}; Object.keys(mm).forEach(function (k) { M[k] = 0; }); }
      Object.keys(mm).forEach(function (k) { M[k] = (M[k] || 0) + mm[k]; });
      BANDS.forEach(function (b) { S[b] += ss[b]; }); S.total += ss.total;
      if (ss.parcial || anpParcial(m)) parcial = true;
    });
    return { M: M, S: S, meses: usados, parcial: parcial };
  }
  /* participações em % a partir de um par {M,S}: Sapatão (m³) ÷ mercado (mil m³ × 1000) */
  function shares(par) {
    if (!par.M || !par.meses.length) return null;
    var r = { mercado: par.M.Total > 0 ? par.S.total / (par.M.Total * 1000) * 100 : null };
    BANDS.forEach(function (b) { r[b] = par.M[b] > 0 ? par.S[b] / (par.M[b] * 1000) * 100 : null; });
    return r;
  }
  function postosSnap(escopo, ym) {
    var P = D.postos && D.postos.escopos && D.postos.escopos[escopo]; if (!P) return null;
    var ks = Object.keys(P).filter(function (k) { return k <= ym; }).sort();
    if (!ks.length) ks = Object.keys(P).sort();
    var k = ks[ks.length - 1]; return k ? { em: k, p: P[k] } : null;
  }

  /* ---------- seletor de mês ---------- */
  function montaMeses() {
    var sel = el('selMes');
    var todos = {}; mesesSap().forEach(function (m) { todos[m] = 1; }); mesesAnp().forEach(function (m) { todos[m] = 1; });
    var lista = Object.keys(todos).sort().reverse();
    if (!st.mes || !todos[st.mes]) {
      /* padrão: último mês com Sapatão fechado e ANP fechada; senão o último com Sapatão */
      var ok = mesesSap().filter(function (m) { return !sapParcial(m) && anpMes(m, st.esc) && !anpParcial(m); });
      st.mes = ok.length ? ok[ok.length - 1] : (mesesSap().slice(-1)[0] || lista[0]);
    }
    sel.innerHTML = lista.map(function (m) {
      var tags = [];
      if (!D.sapatao.meses[m]) tags.push('sem Sapatão'); else if (sapParcial(m)) tags.push('Sapatão parcial');
      if (!anpMes(m, st.esc)) tags.push('sem ANP'); else if (anpParcial(m)) tags.push('ANP parcial');
      return '<option value="' + m + '"' + (m === st.mes ? ' selected' : '') + '>' + mesLbl(m) + (tags.length ? ' · ' + tags.join(', ') : '') + '</option>';
    }).join('');
  }

  /* ---------- chips de contexto ---------- */
  function chips() {
    var c = [];
    var uf = D.anp.ultimo_fechado, ms = mesesSap(), ult = ms[ms.length - 1];
    c.push('<span class="chip">ANP até <b>' + (uf ? mesLbl(uf) : '—') + '</b> · Sapatão até <b>' + (ult ? mesLbl(ult) + (sapParcial(ult) && D.sapatao.meses[ult].cobertura ? ' (dia ' + D.sapatao.meses[ult].cobertura.ate.slice(8) + ')' : '') : '—') + '</b></span>');
    if (st.per !== 'mes') c.push('<span class="chip"><b>' + perLbl(st.mes) + '</b></span>');
    if (anpParcial(st.mes)) c.push('<span class="chip alerta">ANP ainda fechando ' + mesLbl(st.mes) + '</span>');
    if (sapParcial(st.mes)) c.push('<span class="chip alerta">Compras de ' + mesLbl(st.mes) + ' em curso</span>');
    if (!D.sapatao.meses[st.mes]) c.push('<span class="chip alerta">Sem compras do Sapatão em ' + mesLbl(st.mes) + '</span>');
    el('chips').innerHTML = c.join('');
    el('ref').textContent = 'ANP ' + (D.anp.gerado_em || '').slice(0, 10).split('-').reverse().join('/') + ' · Sapatão ' + (D.sapatao.atualizado_em || '').slice(0, 10).split('-').reverse().join('/');
  }

  /* ---------- KPIs ---------- */
  var kAbertos = {}; /* cartões abertos por unidade (toque no cartão) */
  function kpis() {
    var meses = mesesPeriodo(st.mes), par = soma(meses), sh = shares(par);
    var antMeses = periodoAnterior(meses), shAnt = shares(soma(antMeses));
    var shAno = shares(soma(meses.map(anoAnt)));
    var h = '';
    function bomba(cl, lbl, val, sub, deltas, extra, k, media) {
      var det = k ? detUn(k, media) : '', ab = !!(det && kAbertos[k]);
      return '<div class="bomba ' + cl + '"' + (det ? ' data-k="' + k + '" role="button" tabindex="0" aria-expanded="' + ab + '"' : '') + '><div class="lbl">' + lbl + '</div><div class="val">' + val + '</div><div class="sub">' + sub + '</div>' + (extra || '') + (deltas ? '<div class="deltas">' + deltas + '</div>' : '') +
        (det ? '<div class="abre">' + (ab ? 'Fechar' : 'Ver por unidade') + '</div>' + (ab ? det : '') : '') + '</div>';
    }
    /* abertura do cartão por unidade: k = 'mercado' | bandeira | 'posto' (media = m³/mês do posto médio do recorte) */
    function detUn(k, media) {
      var us = unSel().filter(function (u) { return k === 'mercado' || k === 'posto' || UNID()[u].bandeira === k; });
      if (!us.length || !meses.some(function (m) { return D.sapatao.meses[m] && D.sapatao.meses[m].unid; })) return '';
      var ref = perLbl(anoAnt(st.mes));
      var ls = us.map(function (u) {
        var nome = esc(UNID()[u].nome), p = soma(meses, st.esc, st.seg, st.prod, [u]), s = shares(p);
        if (!s) return '<div class="un"><b>' + nome + '</b><span class="v">—</span><span></span></div>';
        var n = p.meses.length || 1;
        if (k === 'posto') {
          var mm = p.S.total / n;
          return '<div class="un"><b>' + nome + '</b><span class="v">' + (media ? num(mm / media, 1) + '×' : num(mm, 0)) + '</span><small>' + num(mm, 0) + ' m³/mês</small></div>';
        }
        var pa = soma(meses.map(anoAnt), st.esc, st.seg, st.prod, [u]), a = pa.S.total > 0 ? shares(pa) : null, nova = !!(pa.M && pa.S.total === 0);
        var v = s[k], d = (a && a[k] != null && v != null) ? v - a[k] : null;
        var gv = k !== 'mercado' ? naCarteira(k, v) : null;
        return '<div class="un"><b>' + nome + '</b><span class="v">' + (v != null ? pct(v) : '—') + '</span><small>' + num(p.S.total, 0) + ' m³</small>' +
          (d != null ? '<span class="delta ' + cls(d) + '">' + pp(d) + '</span>' : nova ? '<span class="delta" title="Sem compras no período de comparação">nova</span>' : '<span></span>') +
          (gv != null ? '<small class="gv">≈ ' + pct(gv) + ' da carteira do GV</small>' : '') + '</div>';
      });
      return '<div class="porun"><div class="cab">Por unidade' + (k !== 'posto' ? ' · vs ' + ref : '') + '</div>' + ls.join('') + '</div>';
    }
    function deltas(k) {
      var s = '';
      if (k !== 'mercado' && !postosSel()[k]) return '';
      if (shAnt && sh && shAnt[k] != null && sh[k] != null) s += '<span class="delta ' + cls(sh[k] - shAnt[k]) + '">' + pp(sh[k] - shAnt[k]) + ' vs ' + perLbl(antMeses[antMeses.length - 1]) + '</span>';
      if (shAno && sh && shAno[k] != null && sh[k] != null) s += '<span class="delta ' + cls(sh[k] - shAno[k]) + '">' + pp(sh[k] - shAno[k]) + ' vs ' + perLbl(anoAnt(st.mes)) + '</span>';
      return s;
    }
    var quem = todasUn() ? 'Sapatão' : unSel().map(function (u) { return UNID()[u].nome; }).join(' + ');
    if (!sh) {
      var motivo = !D.sapatao.meses[st.mes] ? 'Sem compras em ' + mesLbl(st.mes) : (!todasUn() && !D.sapatao.meses[st.mes].unid) ? 'Mês sem abertura por unidade' : 'ANP sem ' + mesLbl(st.mes) + ' neste recorte';
      h += bomba('', 'Participação ' + ESC_CURTO[st.esc], '—', motivo) + bomba('raizen', 'Dentro da Raízen', '—', '') + bomba('ipiranga', 'Dentro da Ipiranga', '—', '');
    } else {
      h += bomba('', 'Participação ' + ESC_CURTO[st.esc], pct(sh.mercado), num(par.S.total, 0) + ' m³ de ' + num(par.M.Total, 0) + ' mil m³' + (par.parcial ? ' · <span class="dn">parcial</span>' : ''), deltas('mercado'), '', 'mercado');
      h += bomba('raizen', 'Dentro da Raízen', postosSel()['Raízen'] ? pct(sh['Raízen']) : '—', postosSel()['Raízen'] ? num(par.S['Raízen'], 0) + ' m³ de ' + num(par.M['Raízen'], 0) + ' mil m³' : 'Sem unidade Raízen na seleção', deltas('Raízen'), postosSel()['Raízen'] ? cartTxt('Raízen', sh['Raízen']) : '', postosSel()['Raízen'] ? 'Raízen' : '');
      h += bomba('ipiranga', 'Dentro da Ipiranga', postosSel()['Ipiranga'] ? pct(sh['Ipiranga']) : '—', postosSel()['Ipiranga'] ? num(par.S['Ipiranga'], 0) + ' m³ de ' + num(par.M['Ipiranga'], 0) + ' mil m³' : 'Sem unidade Ipiranga na seleção', deltas('Ipiranga'), postosSel()['Ipiranga'] ? cartTxt('Ipiranga', sh['Ipiranga']) : '', postosSel()['Ipiranga'] ? 'Ipiranga' : '');
    }
    var snap = postosSnap(st.esc, st.mes), nUn = postosSel().total;
    if (sh && snap && snap.p.Total && nUn && st.seg !== 'tot') {
      var n = par.meses.length, porUn = par.S.total / n / nUn, media = par.M.Total * 1000 / n / snap.p.Total;
      h += bomba('verde', 'Volume por posto', num(porUn / media, 1) + '<small>× a média</small>', num(porUn, 0) + ' m³/mês por unidade · média ' + ESC_CURTO[st.esc] + ' ' + num(media, 0) + ' m³', '', '', 'posto', media);
    } else if (sh && nUn) {
      h += bomba('verde', 'Volume por unidade', num(par.S.total / (par.meses.length || 1) / nUn, 0) + '<small>m³/mês</small>', st.seg === 'tot' ? 'Média por posto só vale em postos' : 'Sem contagem de postos para ' + ESC_NOME[st.esc], '', '', 'posto', null);
    }
    el('kpis').innerHTML = h;
  }
  function prevMes(ym) { var a = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1; if (m === 0) { m = 12; a--; } return a + '-' + String(m).padStart(2, '0'); }

  /* ---------- série mensal ---------- */
  function serie() {
    var vista = st.serie === 'mkt' ? 'mkt' : 'sap';
    var pts, series, tipHtml;
    if (vista === 'sap') {
      pts = mesesSap().filter(function (m) { return anpMes(m, st.esc); }).map(function (m) { var par = soma([m]); var sh = shares(par); return { m: m, sh: sh, par: par, parcial: sapParcial(m) || anpParcial(m) }; }).filter(function (p) { return p.sh; });
      series = [{ k: 'mercado', cor: '#EC6C22', nome: 'No mercado' }, { k: 'Raízen', cor: '#6F2DA8', nome: 'Dentro da Raízen' }, { k: 'Ipiranga', cor: '#3E6BD6', nome: 'Dentro da Ipiranga' }];
      tipHtml = function (p) { return '<b>' + mesLbl(p.m) + (p.parcial ? ' · parcial' : '') + '</b><br>no mercado ' + pct(p.sh.mercado) + '<br>Raízen ' + pct(p.sh['Raízen']) + ' · Ipiranga ' + pct(p.sh['Ipiranga']) + '<br>' + num(p.par.S.total, 0) + ' m³ · ' + num(p.par.M.Total, 1) + ' mil m³'; };
      el('n-serie').textContent = (todasUn() ? 'Rede inteira' : unSel().map(function (u) { return UNID()[u].nome; }).join(' + ')) + ' · ' + PROD_NOME[st.prod] + ' · ' + ESC_NOME[st.esc] + '. Só os meses com compras do Sapatão carregadas.';
    } else {
      pts = mesesAnp().filter(function (m) { return mkt(m); }).map(function (m) { var M = mkt(m); var sh = {}; ['Raízen', 'Ipiranga', 'Vibra'].forEach(function (k) { sh[k] = (M.Total > 0 && M[k] != null) ? M[k] / M.Total * 100 : null; }); return { m: m, M: M, sh: sh, parcial: anpParcial(m) }; });
      series = [{ k: 'Raízen', cor: '#6F2DA8', nome: 'Raízen' }, { k: 'Ipiranga', cor: '#3E6BD6', nome: 'Ipiranga' }, { k: 'Vibra', cor: '#8A95A3', nome: 'Vibra' }];
      tipHtml = function (p) { return '<b>' + mesLbl(p.m) + (p.parcial ? ' · parcial' : '') + '</b><br>mercado ' + num(p.M.Total, 1) + ' mil m³<br>Raízen ' + pct(p.sh['Raízen'], 1) + ' · Ipiranga ' + pct(p.sh['Ipiranga'], 1) + ' · Vibra ' + pct(p.sh['Vibra'], 1); };
      el('n-serie').textContent = 'Fatia de cada bandeira no volume vendido aos postos · ' + PROD_NOME[st.prod] + ' · ' + ESC_NOME[st.esc] + '. Toda a série da ANP.';
    }
    el('legSerie').innerHTML = series.map(function (s) { return '<span><i class="linha" style="background:' + s.cor + '"></i>' + s.nome + '</span>'; }).join('') + '<span><i style="background:#fff;border:2px solid var(--tinta-fraca);width:8px;height:8px;border-radius:50%"></i>Mês parcial</span>';
    document.querySelectorAll('#segSerie button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === vista)); });
    var svg = el('cSerie'), tip = el('tipSerie');
    if (!pts.length) { svg.setAttribute('viewBox', '0 0 640 60'); svg.innerHTML = '<text x="320" y="36" text-anchor="middle">Sem dados para este recorte.</text>'; return tabelaSerie([], vista); }
    var W = 680, H = 250, L = 46, R = 16, T = 16, B = 34;
    var max = 0, min = Infinity; pts.forEach(function (p) { series.forEach(function (s) { var v = p.sh[s.k]; if (v == null) return; if (v > max) max = v; if (v < min) min = v; }); });
    max = max > 0 ? max * 1.15 : 1;
    /* na vista do mercado as fatias andam numa faixa estreita: o eixo começa perto do menor valor */
    var lo = (vista === 'mkt' && isFinite(min) && min > 0) ? Math.floor(min * 0.8) : 0;
    if (vista === 'mkt') max = max * 1.05;
    var n = pts.length, x = function (i) { return n === 1 ? (L + (W - L - R) / 2) : L + (W - L - R) * i / (n - 1); }, y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (max - lo)); };
    var passo = (max - lo) / 4, grid = '', eixoY = '';
    for (var g = 0; g <= 4; g++) { var v = lo + passo * g, yy = y(v); grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="#EEF1F5"/>'; eixoY += '<text x="' + (L - 6) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end">' + num(v, max < 2 ? 2 : max < 10 ? 1 : 0) + '%</text>'; }
    var eixoX = '', stepLbl = Math.max(1, Math.ceil(n / 8));
    pts.forEach(function (p, i) { if ((n - 1 - i) % stepLbl === 0) eixoX += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="' + (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') + '">' + mesLbl(p.m) + '</text>'; });
    var linhas = '', marcas = '';
    series.forEach(function (s) {
      var d = '', ant = null;
      pts.forEach(function (p, i) { var v = p.sh[s.k]; if (v == null) { ant = null; return; } var px = x(i), py = y(v); d += (ant == null ? 'M' : 'L') + px.toFixed(1) + ' ' + py.toFixed(1); ant = v; });
      linhas += '<path d="' + d + '" fill="none" stroke="' + s.cor + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      pts.forEach(function (p, i) { var v = p.sh[s.k]; if (v == null) return; marcas += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="' + (i === n - 1 ? 5 : n > 14 ? 2.5 : 3.5) + '" fill="' + (p.parcial ? '#fff' : s.cor) + '" stroke="' + s.cor + '" stroke-width="2"/>'; });
    });
    /* mês selecionado em destaque */
    var sel = pts.findIndex(function (p) { return p.m === st.mes; });
    var destaque = sel >= 0 ? '<line x1="' + x(sel).toFixed(1) + '" x2="' + x(sel).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#EC6C22" stroke-dasharray="3 4" stroke-opacity=".5"/>' : '';
    var alvo = ''; pts.forEach(function (p, i) { alvo += '<rect data-i="' + i + '" x="' + (x(i) - (W - L - R) / Math.max(n - 1, 1) / 2).toFixed(1) + '" y="' + T + '" width="' + ((W - L - R) / Math.max(n - 1, 1)).toFixed(1) + '" height="' + (H - T - B) + '" fill="transparent"/>'; });
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = grid + eixoY + '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(lo).toFixed(1) + '" y2="' + y(lo).toFixed(1) + '" stroke="#D4DAE3"/>' + destaque + eixoX + linhas + marcas + '<g id="alvos">' + alvo + '</g>';
    svg.onmousemove = function (ev) {
      var r = ev.target.getAttribute && ev.target.getAttribute('data-i'); if (r == null) { tip.hidden = true; return; }
      var p = pts[+r], box = svg.getBoundingClientRect(), host = svg.parentNode.getBoundingClientRect();
      var fx = box.width / W, fy = box.height / H;
      tip.innerHTML = tipHtml(p);
      tip.hidden = false;
      tip.style.left = (box.left - host.left + x(+r) * fx) + 'px';
      tip.style.top = (box.top - host.top + y(p.sh[series[0].k] || 0) * fy - 10) + 'px';
    };
    svg.onmouseleave = function () { tip.hidden = true; };
    tabelaSerie(pts.slice().reverse(), vista);
  }
  function tabelaSerie(pts, vista) {
    var t = el('tSerie');
    if (vista === 'mkt') {
      t.querySelector('thead').innerHTML = '<tr><th>Mês</th><th class="num">Mercado (mil m³)</th><th class="num">Raízen</th><th class="num">Ipiranga</th><th class="num">Vibra</th><th class="num">Mercado vs ano ant.</th></tr>';
      t.querySelector('tbody').innerHTML = pts.map(function (p) {
        var Ma = mkt(anoAnt(p.m)); var v = (Ma && Ma.Total > 0) ? (p.M.Total / Ma.Total - 1) * 100 : null;
        return '<tr' + (p.m === st.mes ? ' class="dest"' : '') + '><td>' + mesLbl(p.m) + (p.parcial ? '<span class="parc">PARCIAL</span>' : '') + '</td><td class="num">' + num(p.M.Total, 1) + '</td><td class="num">' + pct(p.sh['Raízen'], 1) + '</td><td class="num">' + pct(p.sh['Ipiranga'], 1) + '</td><td class="num">' + pct(p.sh['Vibra'], 1) + '</td><td class="num ' + cls(v) + '">' + (v == null ? '<span class="falta">—</span>' : (v > 0 ? '+' : '') + num(v, 1) + '%') + '</td></tr>';
      }).join('') || '<tr><td colspan="6" class="falta">Sem meses.</td></tr>';
      return;
    }
    t.querySelector('thead').innerHTML = '<tr><th>Mês</th><th class="num">Sapatão (m³)</th><th class="num">Mercado (mil m³)</th><th class="num">No mercado</th><th class="num">Raízen</th><th class="num">Ipiranga</th><th class="num">vs ano ant.</th></tr>';
    t.querySelector('tbody').innerHTML = pts.map(function (p) {
      var shAno = shares(soma([anoAnt(p.m)]));
      var d = shAno && shAno.mercado != null ? p.sh.mercado - shAno.mercado : null;
      return '<tr' + (p.m === st.mes ? ' class="dest"' : '') + '><td>' + mesLbl(p.m) + (p.parcial ? '<span class="parc">PARCIAL</span>' : '') + '</td><td class="num">' + num(p.par.S.total, 0) + '</td><td class="num">' + num(p.par.M.Total, 1) + '</td><td class="num">' + pct(p.sh.mercado) + '</td><td class="num">' + pct(p.sh['Raízen']) + '</td><td class="num">' + pct(p.sh['Ipiranga']) + '</td><td class="num ' + cls(d) + '">' + (d == null ? '<span class="falta">—</span>' : pp(d)) + '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="falta">Sem meses com compras do Sapatão.</td></tr>';
  }

  /* ---------- bandeiras ---------- */
  function bandeiras() {
    var meses = mesesPeriodo(st.mes);
    /* mercado do período (todos os meses com ANP, mesmo sem Sapatão) e Sapatão onde houver */
    var M = null; meses.forEach(function (m) { var mm = mkt(m); if (!mm) return; if (!M) { M = {}; Object.keys(mm).forEach(function (k) { M[k] = 0; }); } Object.keys(mm).forEach(function (k) { M[k] = (M[k] || 0) + mm[k]; }); });
    var par = soma(meses), sh = shares(par);
    el('n-band').textContent = 'Mil m³ vendidos aos postos, ' + ESC_NOME[st.esc] + ', ' + perLbl(st.mes) + '. O traço laranja é o Sapatão dentro da bandeira.';
    var box = el('barras');
    if (!M) { box.innerHTML = '<p class="falta">A ANP ainda não publicou este mês para o recorte.</p>'; el('postos').innerHTML = ''; return; }
    var itens = Object.keys(M).filter(function (k) { return k !== 'Total' && k !== 'Outras'; }).map(function (k) { return { k: k, v: M[k] }; }).sort(function (a, b) { return b.v - a.v; });
    var outras = M.Outras || 0; itens.push({ k: 'Outras', v: outras, outras: true });
    var maxV = itens[0].v || 1;
    var h = itens.map(function (it) {
      var share = M.Total ? it.v / M.Total * 100 : 0;
      var cl = it.k === 'Raízen' ? ' raizen' : it.k === 'Ipiranga' ? ' ipiranga' : '';
      var marca = '';
      if (sh && (it.k === 'Raízen' || it.k === 'Ipiranga') && sh[it.k] != null) marca = '<i style="left:' + Math.min(100, sh[it.k]).toFixed(2) + '%" title="Sapatão ' + pct(sh[it.k]) + ' dentro da ' + it.k + '"></i>';
      return '<div class="barra' + cl + '"><span class="n" title="' + esc(it.k) + '">' + esc(it.k) + '</span><span class="tr" title="' + esc(it.k) + ': ' + num(it.v, 1) + ' mil m³ · ' + pct(share, 1) + '"><b style="width:' + (it.v / maxV * 100).toFixed(2) + '%"></b>' + marca + '</span><span class="v">' + num(it.v, 1) + ' <small>· ' + pct(share, 1) + '</small></span></div>';
    }).join('');
    if (sh) h += '<div class="barra sapatao"><span class="n">Sapatão</span><span class="tr" title="Sapatão: ' + num(par.S.total / 1000, 2) + ' mil m³ · ' + pct(sh.mercado) + '"><b style="width:' + Math.max(0.6, par.S.total / 1000 / maxV * 100).toFixed(2) + '%"></b></span><span class="v">' + num(par.S.total / 1000, 2) + ' <small>· ' + pct(sh.mercado) + '</small></span></div>';
    box.innerHTML = h;
    /* postos por bandeira */
    var snap = postosSnap(st.esc, st.mes), ph = '';
    if (snap && st.seg !== 'tot') {
      var n = par.meses.length || 1;
      BANDS.forEach(function (b) {
        var meus = postosSel()[b] || 0, deles = snap.p[b];
        if (!deles || !meus) return;
        var shPostos = meus / deles * 100;
        var razao = (sh && sh[b] != null && shPostos > 0) ? sh[b] / shPostos : null;
        var mediaPosto = (M[b] * 1000) / n / deles;
        ph += '<div class="mini"><div class="lbl">Sapatão nos postos ' + b + '</div><div class="val">' + pct(shPostos) + '</div><div class="sub">' + meus + ' de ' + num(deles, 0) + ' postos ' + b + ' ' + ESC_CURTO[st.esc] + ' (' + mesLbl(snap.em) + ')' + (razao != null ? ' · volume ' + pct(sh[b]) + ' → <b>' + num(razao, 1) + '×</b> a média de ' + num(mediaPosto, 0) + ' m³/posto/mês' : '') + '</div></div>';
      });
    } else if (st.seg === 'tot') {
      ph = '<div class="mini"><div class="lbl">Postos</div><div class="sub">A leitura por posto vale para o segmento posto revendedor; em "todos os segmentos" entram TRR e consumidor final.</div></div>';
    } else {
      ph = '<div class="mini"><div class="lbl">Postos</div><div class="sub">Sem contagem de postos por bandeira para ' + ESC_NOME[st.esc] + ' em mercado/postos.json.</div></div>';
    }
    el('postos').innerHTML = ph;
  }

  /* ---------- comparativo anual ---------- */
  function anual() {
    var ano = anoDe(st.mes), ant = String(+ano - 1);
    var mesesAno = mesesPeriodo(st.mes, st.per === 'mes' ? 'ano' : st.per);
    var mesesMkt = mesesAno.filter(function (m) { return anpMes(m, st.esc); });
    var mesesMktAnt = mesesMkt.map(anoAnt).filter(function (m) { return anpMes(m, st.esc); });
    el('n-anual').textContent = perLbl(st.mes, st.per === 'mes' ? 'ano' : st.per) + ' contra ' + perLbl(anoAnt(st.mes), st.per === 'mes' ? 'ano' : st.per) + ' · ' + PROD_NOME[st.prod] + ' · ' + ESC_NOME[st.esc] + '. Mercado em mil m³, Sapatão em m³.';
    var t = el('tAnual');
    t.querySelector('thead').innerHTML = '<tr><th>Linha</th><th class="num">' + ant + '</th><th class="num">' + ano + '</th><th class="num">Var.</th><th class="num">Sapatão ' + ant + '</th><th class="num">Sapatão ' + ano + '</th><th class="num">Dif.</th></tr>';
    var linhas = [], faltaAnt = false;
    [st.prod].forEach(function (p) {
      /* mercado: soma dos meses da ANP (independe do Sapatão) */
      function somaM(ms, k) { var s = 0, ok = false; ms.forEach(function (m) { var mm = mkt(m, st.esc, st.seg, p); if (mm) { s += mm[k] || 0; ok = true; } }); return ok ? s : null; }
      var mA = somaM(mesesMktAnt, 'Total'), mB = somaM(mesesMkt, 'Total');
      /* Sapatão: meses do ano com compras; no ano anterior, os mesmos meses */
      var parB = soma(mesesAno, st.esc, st.seg, p), parA = soma(mesesAno.map(anoAnt), st.esc, st.seg, p);
      var shB = shares(parB), shA = shares(parA);
      if (!shA) faltaAnt = true;
      linhas.push({ nome: 'Mercado ' + ESC_CURTO[st.esc], a: mA, b: mB, fmt: function (v) { return num(v, 1); }, shA: shA && shA.mercado, shB: shB && shB.mercado, dest: p === st.prod });
      BANDS.forEach(function (b) {
        var bA = somaM(mesesMktAnt, b), bB = somaM(mesesMkt, b);
        linhas.push({ nome: b, a: bA, b: bB, fmt: function (v) { return num(v, 1); }, shA: shA && shA[b], shB: shB && shB[b], sub: true, cor: b === 'Raízen' ? 'r' : 'i' });
      });
      linhas.push({ nome: (todasUn() ? 'Sapatão' : unSel().map(function (u) { return UNID()[u].nome; }).join(' + ')) + ' (m³)', a: shA ? parA.S.total : null, b: shB ? parB.S.total : null, fmt: function (v) { return num(v, 0); }, sapatao: true, meses: parB.meses.length });
    });
    t.querySelector('tbody').innerHTML = linhas.map(function (l) {
      var var_ = (l.a != null && l.b != null && l.a > 0) ? (l.b / l.a - 1) * 100 : null;
      var dif = (l.shA != null && l.shB != null) ? l.shB - l.shA : null;
      var nome = (l.cor ? '<span class="ponto ' + l.cor + '"></span>' : l.sapatao ? '<span class="ponto s"></span>' : '') + esc(l.nome) + (l.sapatao && l.meses ? ' <small class="falta">(' + l.meses + ' ' + (l.meses > 1 ? 'meses' : 'mês') + ')</small>' : '');
      return '<tr class="' + (l.dest ? 'total' : '') + (l.sapatao ? ' dest' : '') + '"><td>' + nome + '</td><td class="num">' + (l.a == null ? '<span class="falta">—</span>' : l.fmt(l.a)) + '</td><td class="num">' + (l.b == null ? '<span class="falta">—</span>' : l.fmt(l.b)) + '</td><td class="num ' + cls(var_) + '">' + (var_ == null ? '<span class="falta">—</span>' : (var_ > 0 ? '+' : '') + num(var_, 1) + '%') + '</td><td class="num">' + (l.sapatao ? '' : (l.shA == null ? '<span class="falta">—</span>' : pct(l.shA))) + '</td><td class="num">' + (l.sapatao ? '' : (l.shB == null ? '<span class="falta">—</span>' : pct(l.shB))) + '</td><td class="num ' + cls(dif) + '">' + (l.sapatao ? '' : (dif == null ? '<span class="falta">—</span>' : pp(dif))) + '</td></tr>';
    }).join('');
    crescimento(mesesPeriodo(st.mes));
    var av = el('a-anual');
    if (faltaAnt) { av.hidden = false; av.textContent = 'Falta carregar as compras de ' + ant + '; por isso a coluna Sapatão ' + ant + ' está vazia.'; }
    else av.hidden = true;
  }

  /* ---------- crescimento: unidades × bandeiras ---------- */
  function cresc(a, b) { return (a != null && b != null && a > 0) ? (b / a - 1) * 100 : null; }
  function fmtVar(v) { return v == null ? '<span class="falta">—</span>' : '<span class="' + cls(v) + '">' + (v > 0 ? '+' : '') + num(v, 1) + '%</span>'; }
  function fmtDif(v) { return v == null ? '<span class="falta">—</span>' : '<b class="' + cls(v) + '">' + (v > 0 ? '+' : '') + num(v, 1) + ' p.p.</b>'; }
  function crescimento(meses) {
    var t = el('tCresc'); if (!t) return;
    var antP = periodoAnterior(meses), antA = meses.map(anoAnt);
    el('n-cresc').textContent = perLbl(st.mes) + ' · quanto cada unidade cresceu contra a bandeira dela. Diferença positiva = ganhou participação.';
    t.querySelector('thead').innerHTML = '<tr><th rowspan="2">Unidade</th><th rowspan="2" class="num">m³</th><th colspan="3" style="text-align:center;border-left:1px solid rgba(255,255,255,.25)">vs ' + perLbl(antP[antP.length - 1]) + '</th><th colspan="3" style="text-align:center;border-left:1px solid rgba(255,255,255,.25)">vs ' + perLbl(anoAnt(st.mes)) + '</th></tr>'
      + '<tr><th class="num" style="border-left:1px solid rgba(255,255,255,.25)">Unidade</th><th class="num">Bandeira</th><th class="num">Dif.</th><th class="num" style="border-left:1px solid rgba(255,255,255,.25)">Unidade</th><th class="num">Bandeira</th><th class="num">Dif.</th></tr>';
    /* volumes de mercado da bandeira (ou total) em cada janela, só nos meses com ANP */
    function volM(ms, k) { var s = 0, ok = false; ms.forEach(function (m) { var mm = mkt(m); if (mm) { s += mm[k] || 0; ok = true; } }); return ok ? s : null; }
    function volS(ms, unidades) { var par = soma(ms, st.esc, st.seg, st.prod, unidades); return par.meses.length === ms.length && par.meses.length ? par.S.total : null; }
    var linhas = codigosUn().map(function (u) {
      var meta = UNID()[u], b = meta.bandeira;
      var cur = volS(meses, [u]), vP = volS(antP, [u]), vA = volS(antA, [u]);
      var gU_P = cresc(vP, cur), gB_P = cresc(volM(antP, b), volM(meses, b));
      var gU_A = cresc(vA, cur), gB_A = cresc(volM(antA, b), volM(meses, b));
      var sel = st.un && st.un.length === 1 && st.un[0] === u;
      return '<tr' + (sel ? ' class="dest"' : '') + '><td><span class="ponto ' + (b === 'Raízen' ? 'r' : 'i') + '"></span>' + esc(meta.nome) + ' <small class="falta">' + esc(b) + '</small></td><td class="num">' + (cur == null ? '<span class="falta">—</span>' : num(cur, 0)) + '</td>'
        + '<td class="num" style="border-left:1px solid var(--linha)">' + fmtVar(gU_P) + '</td><td class="num">' + fmtVar(gB_P) + '</td><td class="num">' + fmtDif(gU_P != null && gB_P != null ? gU_P - gB_P : null) + '</td>'
        + '<td class="num" style="border-left:1px solid var(--linha)">' + fmtVar(gU_A) + '</td><td class="num">' + fmtVar(gB_A) + '</td><td class="num">' + fmtDif(gU_A != null && gB_A != null ? gU_A - gB_A : null) + '</td></tr>';
    });
    var curT = volS(meses, codigosUn()), pT = volS(antP, codigosUn()), aT = volS(antA, codigosUn());
    var gT_P = cresc(pT, curT), gM_P = cresc(volM(antP, 'Total'), volM(meses, 'Total')), gT_A = cresc(aT, curT), gM_A = cresc(volM(antA, 'Total'), volM(meses, 'Total'));
    linhas.push('<tr class="total"><td>Rede <small class="falta">vs mercado ' + ESC_CURTO[st.esc] + '</small></td><td class="num">' + (curT == null ? '—' : num(curT, 0)) + '</td>'
      + '<td class="num" style="border-left:1px solid var(--linha)">' + fmtVar(gT_P) + '</td><td class="num">' + fmtVar(gM_P) + '</td><td class="num">' + fmtDif(gT_P != null && gM_P != null ? gT_P - gM_P : null) + '</td>'
      + '<td class="num" style="border-left:1px solid var(--linha)">' + fmtVar(gT_A) + '</td><td class="num">' + fmtVar(gM_A) + '</td><td class="num">' + fmtDif(gT_A != null && gM_A != null ? gT_A - gM_A : null) + '</td></tr>');
    t.querySelector('tbody').innerHTML = linhas.join('');
  }

  /* ---------- fontes ---------- */
  function fontes() {
    var A = D.anp, S = D.sapatao, P = D.postos;
    var ms = mesesSap(), parc = ms.filter(sapParcial);
    var li = [];
    li.push('<li><b>Mercado:</b> ' + esc(A.fonte || 'ANP') + '. Série de ' + mesLbl(A.meses[0]) + ' a ' + mesLbl(A.meses[A.meses.length - 1]) + '; fechada até ' + (A.ultimo_fechado ? mesLbl(A.ultimo_fechado) : '—') + (A.meses.filter(anpParcial).length ? '; parcial: ' + A.meses.filter(anpParcial).map(mesLbl).join(', ') : '') + '. Base gerada em ' + esc(A.gerado_em || '?') + ' pelo workflow do GitHub (dias 6 e 22).</li>');
    li.push('<li><b>Sapatão:</b> ' + esc(S.fonte || 'compras') + '. Meses ' + (ms.length ? mesLbl(ms[0]) + ' a ' + mesLbl(ms[ms.length - 1]) : '—') + (parc.length ? '; parcial: ' + parc.map(mesLbl).join(', ') : '') + '. Arquivo cifrado atualizado em ' + esc(S.atualizado_em || '?') + '. Unidades: ' + Object.keys(S.postos || {}).map(function (b) { return S.postos[b] + ' ' + b; }).join(', ') + '.</li>');
    if (S.carteiras) li.push('<li><b>Carteira do Gerente de Vendas (GV):</b> ' + Object.keys(S.carteiras).map(function (b) { var c = S.carteiras[b]; return 'GV ' + b + (c.fracao ? ' ≈ ' + num(c.fracao * 100, 0) + '% da bandeira ' + ESC_CURTO[c.escopo || 'RS'] : ' (fração a definir)'); }).join('; ') + '. Participação na carteira = participação na bandeira ÷ fração do GV.</li>');
    if (P) li.push('<li><b>Postos por bandeira:</b> ' + esc(P.fonte || '') + (P.nota ? ' ' + esc(P.nota) : '') + '</li>');
    (A.notas || []).forEach(function (n) { li.push('<li>' + esc(n) + '</li>'); });
    li.push('<li><b>Como se lê:</b> participação = compras do Sapatão ÷ vendas das distribuidoras ao segmento, no mesmo mês e recorte. "Dentro da Raízen" usa só as unidades Raízen do Sapatão contra o volume da Raízen no recorte; idem Ipiranga. Otto = gasolina C + etanol hidratado; Diesel = óleo diesel B.</li>');
    el('fontes').innerHTML = li.join('');
    el('rodape').textContent = 'Dados do Sapatão cifrados no navegador · mercado em dados públicos da ANP · ' + ESC_NOME[st.esc];
  }

  /* ---------- por unidade (sempre a rede inteira, lado a lado) ---------- */
  function porUnidade() {
    var t = el('tUn'), meses = mesesPeriodo(st.mes), snap = postosSnap(st.esc, st.mes);
    var temUnid = meses.some(function (m) { return D.sapatao.meses[m] && D.sapatao.meses[m].unid; });
    el('n-un').textContent = PROD_NOME[st.prod] + ' · ' + ESC_NOME[st.esc] + ' · ' + perLbl(st.mes) + '. Clique numa linha para ver o painel só dela.';
    var temCart = BANDS.some(function (b) { return carteira(b); });
    t.querySelector('thead').innerHTML = '<tr><th>Unidade</th><th>Bandeira</th><th class="num">m³</th><th class="num">No mercado</th><th class="num">Na bandeira</th>' + (temCart ? '<th class="num">Carteira GV</th>' : '') + '<th class="num">× posto médio</th><th class="num">vs ano ant.</th></tr>';
    if (!temUnid) { t.querySelector('tbody').innerHTML = '<tr><td colspan="7" class="falta">Este período não tem abertura por unidade (meses carregados só por bandeira).</td></tr>'; return; }
    var linhas = codigosUn().map(function (u) {
      var meta = UNID()[u], par = soma(meses, st.esc, st.seg, st.prod, [u]), sh = shares(par);
      var shAno = shares(soma(meses.map(anoAnt), st.esc, st.seg, st.prod, [u]));
      var n = par.meses.length || 1, deles = snap && snap.p[meta.bandeira];
      var mediaPosto = (par.M && deles) ? par.M[meta.bandeira] * 1000 / n / deles : null;
      var razao = mediaPosto ? (par.S.total / n) / mediaPosto : null;
      var dif = (sh && shAno && sh.mercado != null && shAno.mercado != null) ? sh.mercado - shAno.mercado : null;
      var sel = st.un && st.un.length === 1 && st.un[0] === u;
      return '<tr data-u="' + u + '" class="' + (sel ? 'dest' : '') + '" style="cursor:pointer" title="Filtrar o painel por ' + esc(meta.nome) + '"><td><span class="ponto s"></span>' + esc(meta.nome) + ' <small class="falta">(' + u + ')</small></td><td><span class="ponto ' + (meta.bandeira === 'Raízen' ? 'r' : 'i') + '"></span>' + esc(meta.bandeira) + '</td><td class="num">' + (sh ? num(par.S.total, 0) : '<span class="falta">—</span>') + '</td><td class="num">' + (sh ? pct(sh.mercado) : '—') + '</td><td class="num">' + (sh ? pct(sh[meta.bandeira]) : '—') + '</td>' + (temCart ? '<td class="num" title="' + 'Carteira do Gerente de Vendas ' + esc(meta.bandeira) + '">' + (sh && naCarteira(meta.bandeira, sh[meta.bandeira]) != null ? pct(naCarteira(meta.bandeira, sh[meta.bandeira])) : '<span class="falta">—</span>') + '</td>' : '') + '<td class="num">' + (razao != null ? num(razao, 1) + '×' : '<span class="falta">—</span>') + '</td><td class="num ' + cls(dif) + '">' + (dif == null ? '<span class="falta">—</span>' : pp(dif)) + '</td></tr>';
    });
    var parT = soma(meses, st.esc, st.seg, st.prod, codigosUn()), shT = shares(parT); /* sempre a rede inteira, seja qual for o filtro */
    linhas.push('<tr class="total" data-u=""' + (todasUn() ? '' : ' title="Voltar à rede inteira" style="cursor:pointer"') + '><td>Rede inteira</td><td>' + BANDS.filter(function (b) { return codigosUn().some(function (u) { return UNID()[u].bandeira === b; }); }).join(' + ') + '</td><td class="num">' + (shT ? num(parT.S.total, 0) : '—') + '</td><td class="num">' + (shT ? pct(shT.mercado) : '—') + '</td><td class="num">' + (shT ? BANDS.map(function (b) { return b[0] + ' ' + pct(shT[b]); }).join(' · ') : '—') + '</td>' + (temCart ? '<td class="num">' + (shT ? BANDS.map(function (b) { var v = naCarteira(b, shT[b]); return v != null ? b[0] + ' ' + pct(v) : null; }).filter(Boolean).join(' · ') || '—' : '—') + '</td>' : '') + '<td class="num"></td><td class="num"></td></tr>');
    t.querySelector('tbody').innerHTML = linhas.join('');
  }
  function montaUnidades() {
    var box = el('segUn'); if (!box) return;
    var cods = codigosUn();
    if (!cods.length) { box.hidden = true; return; }
    box.hidden = false;
    var sel = unSel(), todas = todasUn();
    box.innerHTML = '<button type="button" data-v="" aria-pressed="' + todas + '">Todas</button>' + cods.map(function (u) { return '<button type="button" data-v="' + u + '" aria-pressed="' + (!todas && sel.indexOf(u) >= 0) + '">' + esc(UNID()[u].nome) + '</button>'; }).join('');
  }
  function alternaUn(u) {
    if (!u) { st.un = null; }
    else {
      var atual = todasUn() ? [] : unSel().slice();
      var i = atual.indexOf(u);
      if (i >= 0) atual.splice(i, 1); else atual.push(u);
      st.un = atual.length && atual.length < codigosUn().length ? atual.sort() : null;
    }
    guarda(); desenha();
  }

  /* ---------- controles ---------- */
  function mostraAba() {
    document.querySelectorAll('.aba').forEach(function (s) { s.hidden = s.dataset.aba !== st.aba; });
    document.querySelectorAll('#abas button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.aba === st.aba)); });
    if (st.aba === 'mensal') serie(); /* o SVG mede a tela quando aparece */
  }
  function liga(id, chave) {
    el(id).addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b || b.disabled) return;
      st[chave] = b.dataset.v; guarda(); desenha();
    });
  }
  function marca(id, v) { el(id).querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === v)); }); }
  var ligado = false;
  function desenha() {
    montaMeses();
    marca('segProd', st.prod); marca('segEsc', st.esc); marca('segPer', st.per); el('selSeg').value = st.seg;
    montaUnidades(); chips(); kpis(); porUnidade(); serie(); bandeiras(); anual(); fontes(); mostraAba();
  }
  window.renderMercado = function (dados) { D = dados || D; st.mes = st.mes && (D.sapatao.meses[st.mes] || anpMes(st.mes, st.esc)) ? st.mes : null; desenha(); };
  if (!ligado) {
    ligado = true;
    liga('segProd', 'prod'); liga('segEsc', 'esc'); liga('segPer', 'per');
    el('selSeg').addEventListener('change', function () { st.seg = this.value; guarda(); desenha(); });
    /* toque/clique num cartão abre (ou fecha) a abertura por unidade */
    function abreK(ev) { var c = ev.target.closest('.bomba[data-k]'); if (!c) return; kAbertos[c.dataset.k] = !kAbertos[c.dataset.k]; kpis(); var n = el('kpis').querySelector('.bomba[data-k="' + c.dataset.k + '"]'); if (n && ev.type === 'keydown') n.focus(); }
    el('kpis').addEventListener('click', abreK);
    el('kpis').addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abreK(ev); } });
    el('segSerie').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; st.serie = b.dataset.v; guarda(); serie(); });
    el('abas').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; st.aba = b.dataset.aba; guarda(); try { history.replaceState(null, '', '#' + st.aba); } catch (e) {} mostraAba(); });
    el('selMes').addEventListener('change', function () { st.mes = this.value; desenha(); });
    el('segUn').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; alternaUn(b.dataset.v); });
    el('tUn').addEventListener('click', function (ev) { var tr = ev.target.closest('tr[data-u]'); if (!tr) return; var u = tr.dataset.u; if (!u) { st.un = null; } else { st.un = (st.un && st.un.length === 1 && st.un[0] === u) ? null : [u]; } guarda(); desenha(); });
    window.addEventListener('resize', function () { if (window.DADOS_MERCADO) serie(); });
  }
  desenha();
})();
