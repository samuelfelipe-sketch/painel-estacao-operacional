(function(){
"use strict";
/* Tudo que depende dos dados vive em renderPainel(D): a página chama de novo
   quando baixa um arquivo mais novo que o cache, sem recarregar. Os botões
   fixos são ligados uma vez e chamam sempre a renderização corrente (S). */

var nf0=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0});
var nf1=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
var nf2=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
var nf3=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:3});
function pct(v){ if(!isFinite(v)) v=0; return (v>0?'+':'')+nf1.format(v)+'%'; }
function sgn(v){ return v>0.05?'up':(v<-0.05?'dn':'fl'); }
function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function brl(v){ return 'R$ '+nf0.format(Math.round(v)); }
function brlCurto(v){
  if(v>=1e6) return 'R$ '+nf2.format(v/1e6)+' mi';
  if(v>=1e3) return 'R$ '+nf0.format(v/1e3)+' mil';
  return brl(v);
}
function mais(v){ return (v>=0?'+':'−'); }
function byId(id){ return document.getElementById(id); }
function SVG(t,a){ var e=document.createElementNS('http://www.w3.org/2000/svg',t);
  for(var k in a) e.setAttribute(k,a[k]); return e; }

var COMB = ['GC','DS','DC','GA','ET','GNV','ARL'];
var MERC = ['LOJA','AUTO','LAV','ARLAV'];
var FTREE = {cod:'FTOT', filhos:[
  {cod:'FCOMB', filhos:[
    {cod:'FOTTO',   filhos:[{cod:'GC'},{cod:'GA'},{cod:'GNV'},{cod:'ET'}]},
    {cod:'FDIESEL', filhos:[{cod:'DS'},{cod:'DC'},{cod:'ARL'}]}
  ]},
  {cod:'FMERC', filhos:[{cod:'LOJA'},{cod:'AUTO'},{cod:'LAV'},{cod:'ARLAV'}]}
]};
var CODES={FOTTO:'OTTO',FDIESEL:'DIESEL'};

/* ---------- rótulos de período, a partir de meta.*_ref ---------- */
var MES_ABR=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
var MES_NOME=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function partesRef(ref){
  var m=/^(\d{4})-(\d{2})/.exec(ref||''); if(m) return {a:+m[1], m:+m[2]-1};
  /* "Setembro 2026" / "set/26" */
  var s=String(ref||'').toLowerCase(), i=-1, k;
  for(k=0;k<12;k++){ if(s.indexOf(MES_ABR[k])===0){ i=k; break; } }
  var y=/(\d{4})|\/(\d{2})/.exec(s);
  return i<0?null:{a:y?(y[1]?+y[1]:2000+ +y[2]):NaN, m:i};
}
function rotulos(meta){
  var cur=partesRef(meta.mes_ref)||partesRef(meta.mes_rotulo);
  var ant=partesRef(meta.ant_ref)||partesRef(meta.ant_rotulo);
  var ano=partesRef(meta.ano_ref)||partesRef(meta.ano_rotulo);
  function curto(p,fb){ return p?MES_ABR[p.m]+'/'+String(p.a).slice(-2):(fb||'—'); }
  function longo(p,fb){ if(!p) return fb||'—'; var c=curto(p); return c.charAt(0).toUpperCase()+MES_ABR[p.m].slice(1)+'/'+p.a; }
  function nome(p){ return p?MES_NOME[p.m]:'o mês'; }
  return {
    cur:curto(cur), ant:curto(ant,meta.ant_rotulo), ano:curto(ano,meta.ano_rotulo),
    antMes:ant?MES_ABR[ant.m]:curto(ant,meta.ant_rotulo).split('/')[0],
    curL:longo(cur), antL:longo(ant), anoL:longo(ano),
    curN:nome(cur), antN:nome(ant), anoN:nome(ano)+(ano?' de '+ano.a:''),
    curAno:cur?cur.a:''
  };
}

/* ---------- estado da interface (sobrevive à re-renderização) ---------- */
var UI={ fatAberto:{FTOT:true,FCOMB:false,FOTTO:false,FDIESEL:false,FMERC:false}, fatBase:'ano', modoDia:false, ordem:'vol' };
var S={}; /* funções da renderização corrente */

/* ---------- tooltip ---------- */
var tip=byId('tip');
function showTip(e,html){ tip.innerHTML=html; tip.hidden=false; moveTip(e); }
function moveTip(e){
  /* sob zoom CSS (telas largas) o mouse vem em px da tela e left/top do
     tooltip ficam em px da página: k converte um no outro */
  tip.style.left='100px'; var k=tip.getBoundingClientRect().left/100||1;
  var r=tip.getBoundingClientRect(), x=e.clientX+14, y=e.clientY+14;
  if(x+r.width>innerWidth-8) x=e.clientX-r.width-14;
  if(y+r.height>innerHeight-8) y=e.clientY-r.height-14;
  tip.style.left=Math.max(8,x)/k+'px'; tip.style.top=Math.max(8,y)/k+'px';
}
function hideTip(){ tip.hidden=true; }
function bind(el,html){
  el.addEventListener('mouseenter',function(e){showTip(e,html);});
  el.addEventListener('mousemove',moveTip);
  el.addEventListener('mouseleave',hideTip);
}
function ttRows(title,rows){
  return '<div class="tt">'+esc(title)+'</div>'+rows.map(function(r){
    return '<div class="tr"><span>'+esc(r[0])+'</span><b>'+r[1]+'</b></div>';}).join('');
}
function niceMax(v){
  if(!(v>0)) return 1;
  var p=Math.pow(10,Math.floor(Math.log10(v))), n=v/p;
  var s=n<=1?1:n<=1.2?1.2:n<=1.5?1.5:n<=2?2:n<=2.5?2.5:n<=3?3:n<=4?4:n<=5?5:n<=6?6:n<=8?8:10;
  return s*p;
}

window.renderPainel=function(D){
hideTip();
var LIN = D.linhas, GRP = D.grupos, F = D.fat, R = rotulos(D.meta||{});
var byCod = {}; LIN.concat(GRP).forEach(function(l){ byCod[l.cod]=l; l.metaOk = l.meta > 1000; });
var VS_ANT='vs '+R.ant, VS_ANO='vs '+R.ano;

/* rótulos fixos da página */
Array.prototype.forEach.call(document.querySelectorAll('[data-r]'), function(el){ var v=R[el.getAttribute('data-r')]; if(v!=null) el.textContent=v; });
byId('fAno').textContent='Δ '+VS_ANO; byId('fMes').textContent='Δ '+VS_ANT;
byId('fatEyebrow').textContent='Faturamento total · projeção '+R.curN+'/'+R.curAno;
byId('railNota').textContent='A barra mostra o acumulado do mês; o traço vertical marca onde a meta deveria estar no '+D.meta.dias_dec+'º dia ('+Math.round(D.meta.dias_dec/D.meta.dias_mes*100)+'% do mês). O percentual compara os dois.';
byId('volNota').textContent='Projeção linear do mês (acumulado ÷ '+D.meta.dias_dec+' × '+D.meta.dias_mes+') contra '+R.antL+' e '+R.anoL+' fechados.';
byId('lgNota').textContent = D.meta.dias_ant!==D.meta.dias_mes
  ? '— '+R.antN+' tem '+D.meta.dias_ant+' dias; '+R.curN+', '+D.meta.dias_mes+'. O ritmo diário neutraliza isso.'
  : '— os dois meses têm '+D.meta.dias_mes+' dias.';
byId('deltaNota').textContent='Diferença entre a margem bruta projetada para '+R.curN+' e a margem realizada em '+R.antN+', linha a linha. É o efeito líquido de volume e preço juntos.';
byId('quadNota').textContent='Eixo horizontal: variação do volume no ritmo diário contra '+R.antN+'. Eixo vertical: variação da margem unitária. O que cai no quadrante inferior direito cresce vendendo mais barato.';

/* ---------- KPIs ---------- */
var totComb=byCod.TOTCOMB, totMerc=byCod.TOTMERC;
var margTotProj = totComb.mrsProj + totMerc.mrsProj;
var margTotAnt  = totComb.mrsAnt  + totMerc.mrsAnt;
var margTotAno  = totComb.mrsAno  + totMerc.mrsAno;

function dl(lbl,v){ return '<span class="dl '+sgn(v)+'"><em>'+lbl+'</em>'+pct(v)+'</span>'; }
var kpis=[
 {lbl:'Volume combustíveis · projeção', big:nf0.format(totComb.proj), unit:'L',
  sub:nf0.format(totComb.acum)+' L acumulados · meta '+nf0.format(totComb.meta)+' L',
  d:[[VS_ANT,totComb.difAnt],[VS_ANO,totComb.difAno]]},
 {lbl:'Mercadorias · projeção', big:'R$ '+nf0.format(totMerc.proj), unit:'',
  sub:'R$ '+nf0.format(totMerc.acum)+' acumulados · meta R$ '+nf0.format(totMerc.meta),
  d:[[VS_ANT,totMerc.difAnt],[VS_ANO,totMerc.difAno]]},
 {lbl:'Margem bruta total · projeção', big:'R$ '+nf0.format(margTotProj), unit:'',
  sub:'combustíveis R$ '+nf0.format(totComb.mrsProj)+' + mercadorias R$ '+nf0.format(totMerc.mrsProj),
  d:[[VS_ANT,(margTotProj/margTotAnt-1)*100],[VS_ANO,(margTotProj/margTotAno-1)*100]]},
 {lbl:'Margem média combustíveis', big:nf3.format(totComb.muA), unit:'R$/L',
  sub:R.ant+' '+nf3.format(totComb.muB)+' · '+R.ano+' '+nf3.format(totComb.muC)+' R$/L',
  d:[[VS_ANT,(totComb.muA/totComb.muB-1)*100],[VS_ANO,(totComb.muA/totComb.muC-1)*100]]}
];
byId('kpis').innerHTML = kpis.map(function(k){
  return '<div class="kpi"><div class="lbl">'+k.lbl+'</div><div class="big">'+k.big+
    (k.unit?'<small>'+k.unit+'</small>':'')+'</div><div class="sub">'+k.sub+'</div><div class="deltas">'+
    k.d.map(function(x){return dl(x[0],x[1]);}).join('')+'</div></div>';
}).join('');

/* ---------- meta rail ---------- */
var FRAC = D.meta.dias_dec / D.meta.dias_mes;
var railItems=[
 {cod:'TOTCOMB', nome:'Total combustíveis', un:'L'},
 {cod:'TOTMERC', nome:'Total mercadorias', un:'R$'},
 {cod:'LOJA',    nome:'Loja de conveniência', un:'R$'},
 {cod:'AUTO',    nome:'Produtos automotivos', un:'R$'}
];
byId('rail').innerHTML = railItems.map(function(it){
  var l=byCod[it.cod], prog=l.meta>0?l.acum/l.meta:0, cls=l.pctMeta>=0?'good':'bad';
  var w=Math.min(prog,1)*100;
  return '<div class="railcell"><div class="railtop"><span class="railname">'+it.nome+
   '</span><span class="railpct num" style="color:var(--'+cls+')">'+(l.metaOk?pct(l.pctMeta):'—')+'</span></div>'+
   '<div class="railval num">'+(it.un==='R$'?'R$ ':'')+nf0.format(l.acum)+(it.un==='L'?' L':'')+
   ' de '+(it.un==='R$'?'R$ ':'')+nf0.format(l.meta)+'</div>'+
   '<div class="track"><div class="fill" style="width:'+w.toFixed(1)+'%;background:var(--'+cls+')"></div>'+
   '<div class="tick" style="left:'+(FRAC*100).toFixed(1)+'%"></div></div></div>';
}).join('');

/* ---------- faturamento ---------- */
function fD(f){ return UI.fatBase==='ano'? f.dAno : f.dAnt; }
function fC(f){ return UI.fatBase==='ano'? f.cAno : f.cAnt; }
function fQ(f){ return UI.fatBase==='ano'? f.qAno : f.qAnt; }

(function heroFat(){
  var t=F.FTOT;
  byId('fatBig').innerHTML = brlCurto(t.recA)+'<small> · '+brl(t.recA)+'</small>';
  byId('fatSub').textContent =
    'Combustíveis a preço médio de venda de '+R.curN+' aplicado ao volume projetado, somados a mercadorias e serviços.';
  var boxes=[
    {k:VS_ANT, v:pct(t.vAnt), b:brlCurto(t.recB), c:t.vAnt>=0},
    {k:VS_ANO, v:pct(t.vAno), b:brlCurto(t.recC), c:t.vAno>=0},
    {k:'Combustíveis', v:nf1.format(F.FCOMB.part)+'%', b:brlCurto(F.FCOMB.recA), c:null},
    {k:'Mercadorias', v:nf1.format(F.FMERC.part)+'%', b:brlCurto(F.FMERC.recA), c:null}
  ];
  byId('fatBoxes').innerHTML = boxes.map(function(x){
    var col = x.c===null?'var(--ink)':(x.c?'var(--good)':'var(--bad)');
    return '<div class="fbox"><div class="k">'+x.k+'</div><div class="v" style="color:'+col+'">'+x.v+'</div><div class="b">'+x.b+'</div></div>';
  }).join('');
})();

function flatFat(node, nivel, out, visivel){
  out.push({cod:node.cod, nivel:nivel, filhos:node.filhos, visivel:visivel});
  if(node.filhos) node.filhos.forEach(function(f){ flatFat(f, nivel+1, out, visivel && !!UI.fatAberto[node.cod]); });
}
function drawFat(){
  var el=byId('fatTree'), rows=[];
  flatFat(FTREE,1,rows,true);
  var vis=rows.filter(function(r){ return r.visivel; });
  var maxD=Math.max.apply(null, rows.filter(function(r){return r.nivel>1;}).map(function(r){ return Math.abs(fD(F[r.cod])); }))||1;
  el.innerHTML = vis.map(function(r){
    var f=F[r.cod], temF=!!(r.filhos&&r.filhos.length);
    var cls='f'+r.nivel+(temF?' pai':'');
    var d=fD(f), c=fC(f), pos=d>=0;
    var qAlt=fQ(f);
    var qt;
    if(f.qtdA==null){ qt='<span style="color:var(--ink3)">&mdash;</span>'; }
    else {
      qt = nf0.format(Math.round(f.qtdA))+'<small>'+f.un+'</small>';
      if(qAlt!=null){
        qt += '<span class="qd" style="color:'+(qAlt>=0?'var(--good)':'var(--bad)')+'">'+pct(qAlt)+
              '<em>'+(f.qNota?f.qNota:(UI.fatBase==='ano'?VS_ANO:VS_ANT))+'</em></span>';
      }
    }
    var delta = r.nivel===1
      ? '<b style="color:'+(pos?'var(--good)':'var(--bad)')+'">'+mais(d)+brl(Math.abs(d))+'</b><div class="c"><span>crescimento total</span></div>'
      : '<b style="color:'+(pos?'var(--good)':'var(--bad)')+'">'+mais(d)+brl(Math.abs(d))+'</b>'+
        '<div class="c"><span class="growbar"><i style="width:'+(Math.abs(d)/maxD*100).toFixed(1)+'%;background:'+(pos?'var(--p2)':'var(--bad)')+'"></i></span><span>'+nf0.format(c)+'%</span></div>';
    var chip = (r.nivel>=3) ? '<span class="code">'+(CODES[r.cod]||r.cod)+'</span>' : '';
    return '<div class="frow '+cls+'" data-f="'+r.cod+'">'+
      '<span class="tname">'+
        (temF?'<button class="tw" data-ft="'+r.cod+'" aria-expanded="'+(!!UI.fatAberto[r.cod])+'" aria-label="Abrir '+esc(f.nome)+'">'+(UI.fatAberto[r.cod]?'−':'+')+'</button>'
             :'<span class="tw leaf"></span>')+
        chip+'<span class="lbl">'+esc(f.nome)+'</span></span>'+
      '<span class="n old">'+nf0.format(Math.round(f.recC))+'</span>'+
      '<span class="n old">'+nf0.format(Math.round(f.recB))+'</span>'+
      '<span class="n cur">'+brl(f.recA)+'</span>'+
      '<span class="n"><span style="font-size:11px">'+nf1.format(f.part)+'%</span>'+
        '<span class="partbar"><i style="width:'+Math.min(100,f.part).toFixed(1)+'%"></i></span></span>'+
      '<span class="n" style="font-weight:600;color:'+(f.vAnt>=0?'var(--good)':'var(--bad)')+'">'+pct(f.vAnt)+'</span>'+
      '<span class="n" style="font-weight:600;color:'+(f.vAno>=0?'var(--good)':'var(--bad)')+'">'+pct(f.vAno)+'</span>'+
      '<span class="dn2">'+delta+'</span>'+
      '<span class="qt">'+qt+'</span>'+
    '</div>';
  }).join('');
  Array.prototype.forEach.call(el.querySelectorAll('.frow'), function(row){
    var f=F[row.getAttribute('data-f')];
    var rs=[[R.anoL.toLowerCase(),brl(f.recC)],[R.antL.toLowerCase(),brl(f.recB)],[R.curL.toLowerCase()+' projeção',brl(f.recA)],
            ['Δ ano',mais(f.dAno)+brl(Math.abs(f.dAno))],
            ['Δ mês',mais(f.dAnt)+brl(Math.abs(f.dAnt))],
            ['participação',nf1.format(f.part)+'% do faturamento']];
    if(f.qtdA!=null){
      rs.push(['quantidade '+R.cur,nf0.format(Math.round(f.qtdA))+' '+f.un]);
      if(f.qtdC!=null) rs.push(['quantidade '+R.ano,nf0.format(Math.round(f.qtdC))+' '+f.un]);
    }
    bind(row, ttRows(f.nome, rs));
  });
  Array.prototype.forEach.call(el.querySelectorAll('.tw[data-ft]'), function(btn){
    btn.addEventListener('click', function(){
      var c=btn.getAttribute('data-ft'); UI.fatAberto[c]=!UI.fatAberto[c]; drawFat(); sincFat();
    });
  });
}
function sincFat(){
  var ks=Object.keys(UI.fatAberto);
  byId('fAll').setAttribute('aria-pressed', ks.every(function(k){return UI.fatAberto[k];})?'true':'false');
  byId('fTop').setAttribute('aria-pressed', ks.every(function(k){return k==='FTOT'?UI.fatAberto[k]:!UI.fatAberto[k];})?'true':'false');
}
function setFatBase(b){
  UI.fatBase=b;
  byId('fAno').setAttribute('aria-pressed', b==='ano'?'true':'false');
  byId('fMes').setAttribute('aria-pressed', b==='ant'?'true':'false');
  byId('fhDelta').textContent = b==='ano'?'crescimento ano':'crescimento mês';
  drawFat();
}
S.drawFat=drawFat; S.sincFat=sincFat; S.setFatBase=setFatBase;
setFatBase(UI.fatBase); sincFat();

/* ---------- grouped bar charts ---------- */
function drawVol(svgId, cods, unidade){
  var svg=byId(svgId); svg.textContent='';
  var modoDia=UI.modoDia;
  var items=cods.map(function(c){ return byCod[c]; }).sort(function(a,b){
    return (modoDia?b.rdAtual-a.rdAtual : b.proj-a.proj); });
  var LBL=138, PAD_R=64, BH=11, GAP=3, ROW=BH*3+GAP*2+20, TOP=26;
  var W=Math.max(560, Math.min(1360, (svg.parentNode.clientWidth||880)));
  var PW=W-LBL-PAD_R, H=TOP+items.length*ROW+8;
  svg.setAttribute('viewBox','0 0 '+W+' '+H);
  svg.setAttribute('width',W); svg.setAttribute('height',H);
  var vals=function(l){ return modoDia?[l.rdAno,l.rdAnt,l.rdAtual]:[l.ano,l.ant,l.proj]; };
  var max=niceMax(Math.max.apply(null,items.map(function(l){return Math.max.apply(null,vals(l));})));
  var x=function(v){ return LBL+v/max*PW; };
  for(var t=0;t<=4;t++){
    var v=max*t/4;
    svg.appendChild(SVG('line',{x1:x(v),x2:x(v),y1:TOP-8,y2:H-6,class:'grid'}));
    var tx=SVG('text',{x:x(v),y:TOP-13,class:'axis','text-anchor':t===0?'start':(t===4?'end':'middle')});
    tx.textContent = v>=1000? nf0.format(v/1000)+'k' : nf0.format(v);
    svg.appendChild(tx);
  }
  var ax=SVG('text',{x:LBL,y:11,class:'axis','text-anchor':'start'});
  ax.textContent = unidade + (modoDia?' por dia':' no mês');
  svg.appendChild(ax);
  var cols=['var(--p1)','var(--p2)','var(--p3)'];
  var per=[R.anoL,R.antL,R.curL+' proj.'];
  items.forEach(function(l,i){
    var y0=TOP+i*ROW+4;
    var nm=SVG('text',{x:LBL-12,y:y0+BH*1.5+GAP+2,class:'catlbl cat','text-anchor':'end'});
    nm.textContent=l.cod; svg.appendChild(nm);
    var nm2=SVG('text',{x:LBL-12,y:y0+BH*1.5+GAP+15,class:'vallbl cat','text-anchor':'end'});
    nm2.textContent=l.nome.length>21?l.nome.slice(0,20)+'…':l.nome; svg.appendChild(nm2);
    var vv=vals(l);
    vv.forEach(function(v,j){
      var w=Math.max(1,x(v)-LBL);
      var r=SVG('rect',{x:LBL,y:y0+j*(BH+GAP),width:w,height:BH,rx:4,fill:cols[j],class:'bar'});
      r.setAttribute('stroke','var(--surf)'); r.setAttribute('stroke-width','2');
      var dA=modoDia?l.vrdAnt:l.difAnt, dN=modoDia?l.vrdAno:l.difAno;
      bind(r, ttRows(l.cod+' · '+l.nome,[
        [per[j], nf0.format(v)+' '+(unidade==='litros'?'L':'R$')+(modoDia?'/dia':'')],
        [VS_ANT, pct(dA)], [VS_ANO, pct(dN)],
        ['margem', l.tipo==='comb'? nf3.format(l.muA)+' R$/L' : nf1.format(l.mpA)+'%']
      ]));
      svg.appendChild(r);
    });
    var d=modoDia?l.vrdAnt:l.difAnt;
    var lb=SVG('text',{x:Math.min(W-6,x(vv[2])+7),y:y0+BH*1.5+GAP+4,class:'vallbl','text-anchor':'start'});
    lb.setAttribute('fill', d>0.05?'var(--good)':(d<-0.05?'var(--bad)':'var(--ink3)'));
    lb.setAttribute('font-weight','600'); lb.textContent=pct(d);
    svg.appendChild(lb);
  });
}

/* ---------- margem dumbbell ---------- */
function drawMarg(){
  var svg=byId('cMarg'); svg.textContent='';
  var items=COMB.map(function(c){return byCod[c];}).sort(function(a,b){return b.muA-a.muA;});
  var LBL=138, PAD_R=76, ROW=34, TOP=30;
  var W=Math.max(560,Math.min(1360,(svg.parentNode.clientWidth||880)));
  var PW=W-LBL-PAD_R, H=TOP+items.length*ROW+10;
  svg.setAttribute('viewBox','0 0 '+W+' '+H); svg.setAttribute('width',W); svg.setAttribute('height',H);
  var max=niceMax(Math.max.apply(null,items.map(function(l){return Math.max(l.muA,l.muB,l.muC);})));
  var x=function(v){return LBL+v/max*PW;};
  for(var t=0;t<=4;t++){
    var v=max*t/4;
    svg.appendChild(SVG('line',{x1:x(v),x2:x(v),y1:TOP-10,y2:H-8,class:'grid'}));
    var tx=SVG('text',{x:x(v),y:TOP-15,class:'axis','text-anchor':t===0?'start':(t===4?'end':'middle')});
    tx.textContent=nf2.format(v); svg.appendChild(tx);
  }
  var ax=SVG('text',{x:LBL,y:11,class:'axis'}); ax.textContent='R$ de margem por litro'; svg.appendChild(ax);
  items.forEach(function(l,i){
    var cy=TOP+i*ROW+12;
    var nm=SVG('text',{x:LBL-12,y:cy+4,class:'catlbl cat','text-anchor':'end'}); nm.textContent=l.cod; svg.appendChild(nm);
    var lo=Math.min(l.muA,l.muB,l.muC), hi=Math.max(l.muA,l.muB,l.muC);
    svg.appendChild(SVG('line',{x1:x(lo),x2:x(hi),y1:cy,y2:cy,stroke:'var(--line2)','stroke-width':2,'stroke-linecap':'round'}));
    [[l.muC,'var(--p1)',R.anoL],[l.muB,'var(--p2)',R.antL],[l.muA,'var(--p3)',R.curL]].forEach(function(p,j){
      var c=SVG('circle',{cx:x(p[0]),cy:cy,r:j===2?6.5:5,fill:p[1],stroke:'var(--surf)','stroke-width':2});
      bind(c, ttRows(l.cod+' · '+l.nome,[
        [p[2], nf3.format(p[0])+' R$/L'],
        ['margem %', nf2.format(j===0?l.mpC:(j===1?l.mpB:l.mpA))+'%'],
        ['custo médio', j===0?'-':nf3.format(j===2?l.pmcA:l.pmcB)],
        ['Δ margem '+VS_ANT, pct(l.dMargPct)]
      ]));
      svg.appendChild(c);
    });
    var d=l.dMargPct;
    var lb=SVG('text',{x:Math.min(W-6,x(hi)+11),y:cy+4,class:'vallbl','text-anchor':'start','font-weight':600});
    lb.setAttribute('fill', d>0.05?'var(--good)':(d<-0.05?'var(--bad)':'var(--ink3)'));
    lb.textContent=pct(d); svg.appendChild(lb);
  });
}

/* ---------- delta margem ---------- */
function drawDelta(){
  var svg=byId('cDelta'); svg.textContent='';
  var items=COMB.concat(MERC).map(function(c){return byCod[c];}).sort(function(a,b){return b.dMrs-a.dMrs;});
  var LBL=138, PAD_R=20, BH=15, ROW=25, TOP=28;
  var W=Math.max(560,Math.min(1360,(svg.parentNode.clientWidth||880)));
  var PW=W-LBL-PAD_R, H=TOP+items.length*ROW+12;
  svg.setAttribute('viewBox','0 0 '+W+' '+H); svg.setAttribute('width',W); svg.setAttribute('height',H);
  var m=Math.max.apply(null,items.map(function(l){return Math.abs(l.dMrs);}));
  var max=niceMax(m), zero=LBL+PW*0.42;
  var negW=zero-LBL, posW=W-PAD_R-zero;
  var sc=Math.min(negW/max, posW/max);
  var x=function(v){return zero+v*sc;};
  svg.appendChild(SVG('line',{x1:zero,x2:zero,y1:TOP-10,y2:H-8,stroke:'var(--line2)','stroke-width':1.5}));
  var ax=SVG('text',{x:LBL,y:11,class:'axis'}); ax.textContent='R$ de margem bruta a mais (ou a menos) que '+R.antN; svg.appendChild(ax);
  items.forEach(function(l,i){
    var y0=TOP+i*ROW;
    var nm=SVG('text',{x:LBL-12,y:y0+BH-2,class:'catlbl cat','text-anchor':'end'}); nm.textContent=l.cod; svg.appendChild(nm);
    var v=l.dMrs, pos=v>=0, w=Math.max(1.5,Math.abs(v)*sc);
    var r=SVG('rect',{x:pos?zero:zero-w,y:y0,width:w,height:BH,rx:4,fill:pos?'var(--p2)':'var(--bad)',class:'bar'});
    bind(r, ttRows(l.cod+' · '+l.nome,[
      ['margem projetada','R$ '+nf0.format(l.mrsProj)],
      ['margem '+R.ant,'R$ '+nf0.format(l.mrsAnt)],
      ['diferença',mais(v)+'R$ '+nf0.format(Math.abs(v))],
      ['volume (ritmo)',pct(l.vrdAnt)],
      ['margem unitária',pct(l.dMargPct)]
    ]));
    svg.appendChild(r);
    var lb=SVG('text',{x:pos?zero+w+8:zero-w-8,y:y0+BH-3,class:'vallbl','text-anchor':pos?'start':'end','font-weight':600});
    lb.setAttribute('fill',pos?'var(--good)':'var(--bad)');
    lb.textContent=mais(v)+nf0.format(Math.abs(v)); svg.appendChild(lb);
  });
}

/* ---------- quadrante ---------- */
function drawQuad(){
  var svg=byId('cQuad'); svg.textContent='';
  var items=COMB.concat(['LOJA','AUTO','LAV']).map(function(c){return byCod[c];});
  var W=Math.max(560,Math.min(1360,(svg.parentNode.clientWidth||880))), H=400;
  var M={t:26,r:22,b:44,l:62};
  svg.setAttribute('viewBox','0 0 '+W+' '+H); svg.setAttribute('width',W); svg.setAttribute('height',H);
  var xs=items.map(function(l){return l.vrdAnt;}), ys=items.map(function(l){return l.dMargPct;});
  var xmin=Math.min(0,Math.min.apply(null,xs))-4, xmax=Math.max(0,Math.max.apply(null,xs))+6;
  var ymin=Math.min(0,Math.min.apply(null,ys))-5, ymax=Math.max(0,Math.max.apply(null,ys))+7;
  var PX=function(v){return M.l+(v-xmin)/(xmax-xmin)*(W-M.l-M.r);};
  var PY=function(v){return H-M.b-(v-ymin)/(ymax-ymin)*(H-M.t-M.b);};
  var z0x=PX(0), z0y=PY(0);
  svg.appendChild(SVG('rect',{x:z0x,y:PY(ymax),width:W-M.r-z0x,height:z0y-PY(ymax),fill:'var(--good)','fill-opacity':.06}));
  svg.appendChild(SVG('rect',{x:z0x,y:z0y,width:W-M.r-z0x,height:PY(ymin)-z0y,fill:'var(--bad)','fill-opacity':.06}));
  var i,v;
  for(i=0;i<=4;i++){ v=xmin+(xmax-xmin)*i/4;
    svg.appendChild(SVG('line',{x1:PX(v),x2:PX(v),y1:M.t,y2:H-M.b,class:'grid'}));
    var tx=SVG('text',{x:PX(v),y:H-M.b+16,class:'axis','text-anchor':'middle'}); tx.textContent=pct(v); svg.appendChild(tx); }
  for(i=0;i<=4;i++){ v=ymin+(ymax-ymin)*i/4;
    svg.appendChild(SVG('line',{x1:M.l,x2:W-M.r,y1:PY(v),y2:PY(v),class:'grid'}));
    var ty=SVG('text',{x:M.l-9,y:PY(v)+3.5,class:'axis','text-anchor':'end'}); ty.textContent=pct(v); svg.appendChild(ty); }
  svg.appendChild(SVG('line',{x1:z0x,x2:z0x,y1:M.t,y2:H-M.b,stroke:'var(--line2)','stroke-width':1.5,'stroke-dasharray':'4 3'}));
  svg.appendChild(SVG('line',{x1:M.l,x2:W-M.r,y1:z0y,y2:z0y,stroke:'var(--line2)','stroke-width':1.5,'stroke-dasharray':'4 3'}));
  var q1=SVG('text',{x:W-M.r-8,y:M.t+14,class:'axis cat','text-anchor':'end','font-weight':600,fill:'var(--good)'});
  q1.textContent='cresce e melhora margem'; svg.appendChild(q1);
  var q2=SVG('text',{x:W-M.r-8,y:H-M.b-8,class:'axis cat','text-anchor':'end','font-weight':600,fill:'var(--bad)'});
  q2.textContent='cresce cedendo margem'; svg.appendChild(q2);
  var axx=SVG('text',{x:(M.l+W-M.r)/2,y:H-8,class:'axis cat','text-anchor':'middle'});
  axx.textContent='variação do volume no ritmo diário '+VS_ANT; svg.appendChild(axx);
  var axy=SVG('text',{x:14,y:(M.t+H-M.b)/2,class:'axis cat','text-anchor':'middle',transform:'rotate(-90 14 '+((M.t+H-M.b)/2)+')'});
  axy.textContent='variação da margem unitária'; svg.appendChild(axy);
  var rmax=Math.max.apply(null,items.map(function(z){return Math.abs(z.mrsProj);}))||1;
  items.forEach(function(l){
    var cx=PX(l.vrdAnt), cy=PY(l.dMargPct);
    var g=SVG('g',{});
    var r=6+Math.sqrt(Math.abs(l.mrsProj)/rmax)*8;
    g.appendChild(SVG('circle',{cx:cx,cy:cy,r:r,fill:l.dMrs>=0?'var(--p2)':'var(--bad)','fill-opacity':.85,stroke:'var(--surf)','stroke-width':2}));
    var lb=SVG('text',{x:cx,y:cy-r-5,class:'catlbl cat','text-anchor':'middle','font-size':11});
    lb.textContent=l.cod; g.appendChild(lb);
    bind(g, ttRows(l.cod+' · '+l.nome,[
      ['volume (ritmo)',pct(l.vrdAnt)],
      ['margem unitária',pct(l.dMargPct)],
      ['margem projetada','R$ '+nf0.format(l.mrsProj)],
      ['Δ margem R$',mais(l.dMrs)+'R$ '+nf0.format(Math.abs(l.dMrs))]
    ]));
    svg.appendChild(g);
  });
  var nota=SVG('text',{x:M.l,y:11,class:'axis cat'});
  nota.textContent='o tamanho do círculo é a margem bruta projetada da linha'; svg.appendChild(nota);
}

/* ---------- tabela ---------- */
function drawTbl(){
  var t=byId('tbl');
  var cols=['Linha','Acum.','Projeção','% meta','vs '+R.ant.split('/')[0],'ritmo/d',VS_ANO,'Marg. un.',R.ant,R.ano,'Margem R$','Δ vs '+R.ant.split('/')[0]];
  t.tHead.innerHTML='<tr>'+cols.map(function(c){return '<th>'+c+'</th>';}).join('')+'</tr>';
  var linhas=LIN.slice().sort(function(a,b){
    if(UI.ordem==='mar') return b.dMrs-a.dMrs;
    var ra=a.tipo==='comb'?0:1, rb=b.tipo==='comb'?0:1;
    return ra-rb || b.proj-a.proj;
  });
  var rows=[];
  function tr(l,isGrp){
    var un=l.tipo==='comb'?'':'R$ ';
    var marg = l.tipo==='comb'? nf3.format(l.muA) : nf1.format(l.mpA)+'%';
    var margB= l.tipo==='comb'? nf3.format(l.muB) : nf1.format(l.mpB)+'%';
    var margC= l.tipo==='comb'? nf3.format(l.muC) : nf1.format(l.mpC)+'%';
    function c(v){ return '<span class="'+(v>0.05?'pos':(v<-0.05?'neg':''))+'">'+pct(v)+'</span>'; }
    return '<tr'+(isGrp?' class="grp"':'')+'><td><span class="code">'+l.cod+'</span>'+esc(l.nome)+'</td>'+
      '<td class="n">'+un+nf0.format(l.acum)+'</td>'+
      '<td class="n"><b>'+un+nf0.format(l.proj)+'</b></td>'+
      '<td class="n">'+(l.metaOk?c(l.pctMeta):(l.meta>0?'<span style="color:var(--warn);font-weight:600" title="meta cadastrada como '+esc(l.meta)+' (percentual de mix) no lugar dos litros">meta inválida</span>':'<span style="color:var(--ink3)">—</span>'))+'</td>'+
      '<td class="n">'+c(l.difAnt)+'</td>'+
      '<td class="n">'+c(l.vrdAnt)+'</td>'+
      '<td class="n">'+c(l.difAno)+'</td>'+
      '<td class="n"><b>'+marg+'</b></td>'+
      '<td class="n" style="color:var(--ink3)">'+margB+'</td>'+
      '<td class="n" style="color:var(--ink3)">'+margC+'</td>'+
      '<td class="n">R$ '+nf0.format(l.mrsProj)+'</td>'+
      '<td class="n"><span class="'+(l.dMrs>0?'pos':'neg')+'">'+mais(l.dMrs)+nf0.format(Math.abs(l.dMrs))+'</span></td></tr>';
  }
  linhas.forEach(function(l){ rows.push(tr(l,false)); });
  ['OTTO','DIESEL','TOTCOMB','TOTMERC'].forEach(function(c){ if(byCod[c]) rows.push(tr(byCod[c],true)); });
  t.tBodies[0].innerHTML=rows.join('');
}
S.drawTbl=drawTbl;

/* ---------- leituras: geradas dos dados (ou redigidas no JSON) ---------- */
function unL(l){ return l.cod==='GNV'?'m³':'litro'; }
function b(s){ return '<b>'+s+'</b>'; }
function leiturasAutomaticas(){
  var out=[], comb=COMB.map(function(c){return byCod[c];}).filter(Boolean);
  var todas=LIN.slice();

  /* 1. volume que não vira margem: cresce no ritmo e perde margem R$ */
  var perde=comb.filter(function(l){return l.vrdAnt>2&&l.dMrs<0;}).sort(function(a,c){return a.dMrs-c.dMrs;})[0];
  if(perde){
    var l=perde, dc=(l.pmcA/l.pmcB-1)*100, dv=(l.pmvA/l.pmvB-1)*100;
    out.push({k:'crit',t:l.nome+': volume que não vira margem',
      p:'A linha cresce '+b(pct(l.vrdAnt))+' no ritmo diário, mas o custo médio '+(dc>=0?'subiu':'caiu')+' de R$ '+nf3.format(l.pmcB)+' para R$ '+nf3.format(l.pmcA)+' ('+pct(dc)+') e o preço de venda '+(dv>=0?'só acompanhou ':'recuou ')+pct(dv)+'. A margem foi de R$ '+nf3.format(l.muB)+' para R$ '+nf3.format(l.muA)+' por '+unL(l)+' ('+b(pct(l.dMargPct))+'). Resultado: '+pct(l.vrdAnt)+' de volume e '+b('R$ '+nf0.format(Math.abs(l.dMrs))+' a menos')+' de margem que '+R.antN+'.',
      a:'Repasse de custo em '+l.nome+' — quanto do aumento ainda não foi para a bomba, e por quê?'});
  }

  /* 2. metas: quem está abaixo (só metas válidas) */
  var comMeta=todas.filter(function(l){return l.metaOk;});
  var abaixo=comMeta.filter(function(l){return l.pctMeta<0;}).sort(function(a,c){return a.pctMeta-c.pctMeta;});
  if(abaixo.length===1){
    var m=abaixo[0], unM=m.tipo==='comb'?' L':'', pre=m.tipo==='comb'?'':'R$ ';
    out.push({k:'crit',t:m.nome+' é a única linha abaixo da meta',
      p:'Projeção de '+b(pre+nf0.format(m.proj)+unM)+' contra meta de '+pre+nf0.format(m.meta)+unM+' — '+b(pct(m.pctMeta))+' no ritmo proporcional. '+
        (m.dMargPct<0?'A margem também cedeu ('+(m.tipo==='comb'?nf3.format(m.muB)+' → '+nf3.format(m.muA)+' R$/'+unL(m):nf2.format(m.mpB)+'% → '+nf2.format(m.mpA)+'%'):'A margem '+(m.dMargPct>0?'melhorou':'ficou estável')+' ('+(m.tipo==='comb'?nf3.format(m.muB)+' → '+nf3.format(m.muA)+' R$/'+unL(m):nf2.format(m.mpB)+'% → '+nf2.format(m.mpA)+'%'))+
        '), o que '+(m.dMrs<0?'tira ':'soma ')+b('R$ '+nf0.format(Math.abs(m.dMrs)))+' de margem contra '+R.antN+'.',
      a:'O que trava '+m.nome+': fluxo, conversão ou ticket? No ritmo diário o combustível varia '+pct(totComb.vrdAnt)+' e esta linha '+pct(m.vrdAnt)+'.'});
  } else if(abaixo.length>1){
    out.push({k:'crit',t:abaixo.length+' linhas abaixo da meta',
      p:abaixo.map(function(m){return b(m.nome)+' '+pct(m.pctMeta);}).join(' · ')+' — no ritmo proporcional ao '+D.meta.dias_dec+'º dia.',
      a:'Qual das metas está defasada e qual é problema de venda? Separar antes de reagir.'});
  } else if(comMeta.length){
    out.push({k:'ok',t:'Todas as metas válidas no ritmo',
      p:comMeta.map(function(m){return m.nome+' '+b(pct(m.pctMeta));}).join(' · ')+'.',
      a:'Se todas rodam acima do ritmo, as metas estão calibradas?'});
  }

  /* 3. margem recomposta com volume parado */
  var recomp=comb.filter(function(l){return l.dMargPct>5&&l.vrdAnt<3&&l!==perde;}).sort(function(a,c){return c.dMargPct-a.dMargPct;})[0];
  if(recomp){
    var g=recomp;
    out.push({k:'ok',t:g.nome+': margem recomposta, volume '+(g.vrdAnt<-2?'em queda':'estagnado'),
      p:'Margem saltou de R$ '+nf3.format(g.muB)+' para R$ '+nf3.format(g.muA)+' por '+unL(g)+' ('+b(pct(g.dMargPct))+'), somando '+b(mais(g.dMrs)+'R$ '+nf0.format(Math.abs(g.dMrs)))+'. Mas o volume está '+(g.vrdAnt<-2?'caindo':'praticamente parado')+' contra '+R.antN+' ('+pct(g.vrdAnt)+') e '+b(pct(g.difAno))+' contra '+R.anoN+'.',
      a:'A recomposição de preço está custando volume? Vale testar elasticidade antes de consolidar.'});
  }

  /* 4. agregado: o crescimento paga? */
  var vAnt=(margTotProj/margTotAnt-1)*100, vAno=(margTotProj/margTotAno-1)*100, paga=vAnt>=0&&vAno>=0;
  var exemplo=comb.filter(function(l){return l.vrdAnt>0&&l.dMrs>0;}).sort(function(a,c){return c.dMrs-a.dMrs;})[0];
  var metaTxt=totComb.metaOk?' Combustíveis rodam a '+b(pct(totComb.pctMeta))+' da meta proporcional.':'';
  out.push({k:paga?'ok':'crit',t:paga?'O crescimento, no agregado, paga':'A margem total recua',
    p:'Margem bruta total projetada de '+b('R$ '+nf0.format(margTotProj))+' — '+b(pct(vAnt))+' sobre '+R.antN+' e '+b(pct(vAno))+' sobre '+R.anoN+'.'+metaTxt+
      (exemplo?' '+exemplo.nome+' é o melhor exemplo: '+pct(exemplo.vrdAnt)+' de volume'+(exemplo.dMargPct<0?' mesmo cedendo '+nf1.format(Math.abs(exemplo.dMargPct))+'% de margem unitária':'')+', e ainda entrega +R$ '+nf0.format(exemplo.dMrs)+'.':''),
    a:paga?(totComb.metaOk&&totComb.pctMeta>10?'A meta de combustíveis está calibrada? Rodar '+pct(totComb.pctMeta)+' acima do ritmo sugere meta defasada.':'Onde reinvestir a margem extra sem perder o ritmo?'):'Que linha está drenando a margem, e é preço ou volume?'});

  /* 5. mix V-Power */
  var GA=byCod.GA;
  if(D.mix&&isFinite(D.mix.proj)&&GA){
    var acima=D.mix.proj>=D.mix.meta;
    out.push({k:acima?'wn':'crit',t:'Mix V-Power '+(acima?'acima':'abaixo')+' da meta',
      p:'A meta de mix GA/GC é '+nf0.format(D.mix.meta)+'% e a projeção está em '+b(nf2.format(D.mix.proj)+'%')+'. O V-Power varia '+pct(GA.vrdAnt)+' no ritmo diário e '+b(pct(GA.difAno))+' contra o ano passado, com margem '+(Math.abs(GA.dMargPct)<2?'estável':(GA.dMargPct>0?'em alta':'em queda'))+' em R$ '+nf3.format(GA.muA)+'/L — '+b(mais(GA.dMrs)+'R$ '+nf0.format(Math.abs(GA.dMrs)))+' de margem.',
      a:acima?'Rever a meta de mix para cima e replicar a abordagem de pista que está funcionando.':'O que mudou na oferta do V-Power na pista?'});
  }

  /* 6. metas inválidas no Argo */
  var inval=todas.filter(function(l){return l.meta>0&&!l.metaOk;});
  if(inval.length){
    out.push({k:'wn',t:'Meta '+(inval.length>1?'de '+inval.length+' linhas está':'do '+inval[0].nome+' está')+' errada no Argo',
      p:inval.map(function(l){return b(l.nome)+' (meta cadastrada = '+esc(l.meta)+')';}).join(', ')+' mostra um "% meta" absurdo porque o campo de meta de volume recebeu um percentual, não os litros. O painel marca '+b('meta inválida')+'; o indicador fica inutilizável enquanto o cadastro não for corrigido.',
      a:'Corrigir o cadastro de meta no Argo antes do fechamento.'});
  }
  return out;
}
var reads = (Array.isArray(D.leituras)&&D.leituras.length)
  ? D.leituras.map(function(r){ return {k:({crit:1,ok:1,wn:1})[r.k]?r.k:'wn', t:r.t||'', p:esc(r.p||''), a:r.a||''}; })
  : leiturasAutomaticas();
byId('reads').innerHTML=reads.map(function(r){
  var nome={crit:'atenção',ok:'no rumo',wn:'ajuste'}[r.k];
  return '<div class="read '+r.k+'"><h3><span class="tag '+r.k+'">'+nome+'</span>'+esc(r.t)+'</h3><p>'+r.p+'</p>'+
   (r.a?'<div class="ask"><b>Pergunta para a reunião</b>'+esc(r.a)+'</div>':'')+'</div>';
}).join('');

/* ---------- decomposição · gaveta ---------- */
(function(){
  var alvo=byId('decTabs'), caixa=byId('decBox');
  if(!alvo||!caixa) return;
  /* dados publicados antes desta visão não têm decomp — a gaveta some */
  if(!D.decomp||!D.decomp.ano||!D.decomp.ant){ caixa.hidden=true; alvo.innerHTML=''; return; }
  caixa.hidden=false;
  /* faturamento por unidade nos três períodos (opcional no JSON): o mesmo
     acréscimo repartido entre as unidades — a nova entra inteira contra o
     período em que ainda não existia */
  var UNIS=Array.isArray(D.unidades)?D.unidades.filter(function(u){return u&&isFinite(u.recA);}):[];
  function linhaDt(rot,v,t,cls){
    var pos=v>=0, cor=pos?'var(--good)':'var(--bad)';
    return '<tr'+(cls?' class="'+cls+'"':'')+'><td>'+rot+'</td>'+
      '<td class="v" style="color:'+cor+'">'+mais(v)+brl(Math.abs(v))+'</td>'+
      '<td class="p" style="color:'+cor+'">'+(t?nf1.format(v/t*100):'—')+'%</td></tr>';
  }
  function bloco(base, rot){
    var d=D.decomp[base], t=d.dTot, tPos=t>=0, kr=base==='ano'?'recC':'recB';
    var rows=[
      ['Volume de combustível', d.vol],
      ['Preço do litro',        d.pre],
      ['Mix entre combustíveis',d.mix],
      ['Mercadorias e serviços',d.merc]
    ];
    var porUnidade='';
    var unis=UNIS.filter(function(u){return isFinite(u[kr]);});
    if(unis.length){
      var soma=0;
      porUnidade='<tr class="grp"><td colspan="3">Por unidade</td></tr>'+unis.map(function(u){
        var v=u.recA-u[kr]; soma+=v;
        var nome=esc(u.nome||('Unidade '+u.cod))+(u.nova?'<span class="tagnova">nova</span>':'');
        return linhaDt(nome,v,t);
      }).join('');
      if(Math.abs(soma-t)>Math.max(1,Math.abs(t)*0.005)) porUnidade+=linhaDt('Diferença (ajuste)',t-soma,t);
    }
    return '<div class="dect">'+
      '<div class="dech"><span class="lb">vs '+esc(rot)+'</span>'+
        '<span class="tt" style="color:'+(tPos?'var(--good)':'var(--bad)')+'">'+mais(t)+brl(Math.abs(t))+'</span></div>'+
      '<table class="dt"><tbody>'+ rows.map(function(r){ return linhaDt(r[0],r[1],t); }).join('') + porUnidade +'</tbody></table></div>';
  }
  var novas=UNIS.filter(function(u){return u.nova;});
  alvo.innerHTML = bloco('ano', R.ano) + bloco('ant', R.ant) +
    '<p class="decnota"><b>Volume</b>: litros a mais avaliados ao preço do período anterior · '+
    '<b>Preço</b>: variação do R$/litro aplicada ao volume atual · '+
    '<b>Mix</b>: deslocamento entre combustíveis de preços diferentes. Os efeitos somam exatamente o acréscimo.'+
    (UNIS.length?' <b>Por unidade</b>: o mesmo acréscimo repartido entre as unidades da rede'+(novas.length?' — '+novas.map(function(u){return esc(u.nome||('Unidade '+u.cod));}).join(', ')+' entra inteira contra o período em que ainda não existia':'')+'.':'')+
    '</p>';
})();

/* ---------- cabeçalho e rodapé ---------- */
byId('hdPeriodo').textContent=D.meta.mes_rotulo||R.curL;
byId('hdMeta').textContent='Unidades '+D.meta.unidades+' · fechamento '+D.meta.data+' · '+D.meta.dias_dec+' de '+D.meta.dias_mes+' dias';
byId('foot').innerHTML =
 'Relatório de origem: <b>Acompanhamento de Metas e Margens de Vendas</b> — Argo Gerenciador'+(D.meta.argo_versao?' v.'+esc(D.meta.argo_versao):'')+', gerado em '+esc(D.meta.gerado)+', unidades '+esc(D.meta.unidades)+', 1º nível de classificação.<br>'+
 'Projeção linear: acumulado até '+esc(D.meta.data)+' ÷ '+D.meta.dias_dec+' × '+D.meta.dias_mes+' dias, como o próprio Argo calcula. A comparação com o mês anterior usa o mês fechado ('+D.meta.dias_ant+' dias); a coluna "ritmo/dia" corrige a diferença de calendário.<br>'+
 'A tabela de margens do Argo acumula um volume de combustíveis ligeiramente diferente do da tabela de projeção (corte de data distinto no sistema). As margens usam a primeira; volumes e projeções, a segunda.<br>'+
 'Faturamento: volume projetado × preço médio de venda do mês para combustíveis; para mercadorias, o valor do próprio relatório. Quantidades de mercadorias = faturamento ÷ preço médio unitário.<br>'+
 'O Arla aparece em duas linhas, como no Argo: ARL em litros dentro do ciclo diesel e ARLA em R$ dentro das mercadorias (SKUs distintos: pista e loja).<br>'+
 (F.LAV&&F.LAV.qtdB==null?'O preço médio da lavagem no histórico do Argo está inconsistente (uma ordem de grandeza abaixo do valor atual), então a quantidade histórica de lavagens não é comparável e fica fora do crescimento de unidades das mercadorias.<br>':'')+
 'Visão consolidada da rede — o relatório de origem não traz quebra por unidade.';

/* ---------- redesenho ---------- */
function redraw(){
  drawVol('cVolComb',COMB,'litros');
  drawVol('cVolMerc',MERC,'R$');
  drawMarg(); drawDelta(); drawQuad();
}
S.redraw=redraw; S.drawVol=function(){ drawVol('cVolComb',COMB,'litros'); drawVol('cVolMerc',MERC,'R$'); };
redraw(); drawTbl();
};

/* ---------- botões fixos: ligados uma vez, agem sobre a renderização corrente ---------- */
byId('fAno').addEventListener('click',function(){ S.setFatBase('ano'); });
byId('fMes').addEventListener('click',function(){ S.setFatBase('ant'); });
byId('fAll').addEventListener('click',function(){
  Object.keys(UI.fatAberto).forEach(function(k){ UI.fatAberto[k]=true; }); S.drawFat(); S.sincFat(); });
byId('fTop').addEventListener('click',function(){
  Object.keys(UI.fatAberto).forEach(function(k){ UI.fatAberto[k]=(k==='FTOT'); }); S.drawFat(); S.sincFat(); });
byId('bMes').addEventListener('click',function(){
  UI.modoDia=false; this.setAttribute('aria-pressed','true');
  byId('bDia').setAttribute('aria-pressed','false'); S.drawVol();
});
byId('bDia').addEventListener('click',function(){
  UI.modoDia=true; this.setAttribute('aria-pressed','true');
  byId('bMes').setAttribute('aria-pressed','false'); S.drawVol();
});
byId('oVol').addEventListener('click',function(){
  UI.ordem='vol'; this.setAttribute('aria-pressed','true');
  byId('oMar').setAttribute('aria-pressed','false'); S.drawTbl();
});
byId('oMar').addEventListener('click',function(){
  UI.ordem='mar'; this.setAttribute('aria-pressed','true');
  byId('oVol').setAttribute('aria-pressed','false'); S.drawTbl();
});
var rt; addEventListener('resize',function(){ clearTimeout(rt); rt=setTimeout(function(){ S.redraw(); },140); });

window.renderPainel(window.DADOS_PAINEL);
})();
