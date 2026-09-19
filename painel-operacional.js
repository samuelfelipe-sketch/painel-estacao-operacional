(function(){
"use strict";
var D = window.DADOS_PAINEL;
var LIN = D.linhas, GRP = D.grupos;
var byCod = {}; LIN.concat(GRP).forEach(function(l){ byCod[l.cod]=l; l.metaOk = l.meta > 1000; });
var COMB = ['GC','DS','DC','GA','ET','GNV','ARL'];
var MERC = ['LOJA','AUTO','LAV','ARLAV'];

var nf0=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0});
var nf1=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
var nf2=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
var nf3=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:3});
function pct(v){ if(!isFinite(v)) v=0; return (v>0?'+':'')+nf1.format(v)+'%'; }
function sgn(v){ return v>0.05?'up':(v<-0.05?'dn':'fl'); }
function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

/* ---------- KPIs ---------- */
var totComb=byCod.TOTCOMB, totMerc=byCod.TOTMERC;
var margTotProj = totComb.mrsProj + totMerc.mrsProj;
var margTotAnt  = totComb.mrsAnt  + totMerc.mrsAnt;
var margTotAno  = totComb.mrsAno  + totMerc.mrsAno;

function dl(lbl,v){ return '<span class="dl '+sgn(v)+'"><em>'+lbl+'</em>'+pct(v)+'</span>'; }
var kpis=[
 {lbl:'Volume combustíveis · projeção', big:nf0.format(totComb.proj), unit:'L',
  sub:nf0.format(totComb.acum)+' L acumulados · meta '+nf0.format(totComb.meta)+' L',
  d:[['vs ago/26',totComb.difAnt],['vs set/25',totComb.difAno]]},
 {lbl:'Mercadorias · projeção', big:'R$ '+nf0.format(totMerc.proj), unit:'',
  sub:'R$ '+nf0.format(totMerc.acum)+' acumulados · meta R$ '+nf0.format(totMerc.meta),
  d:[['vs ago/26',totMerc.difAnt],['vs set/25',totMerc.difAno]]},
 {lbl:'Margem bruta total · projeção', big:'R$ '+nf0.format(margTotProj), unit:'',
  sub:'combustíveis R$ '+nf0.format(totComb.mrsProj)+' + mercadorias R$ '+nf0.format(totMerc.mrsProj),
  d:[['vs ago/26',(margTotProj/margTotAnt-1)*100],['vs set/25',(margTotProj/margTotAno-1)*100]]},
 {lbl:'Margem média combustíveis', big:nf3.format(totComb.muA), unit:'R$/L',
  sub:'ago/26 '+nf3.format(totComb.muB)+' · set/25 '+nf3.format(totComb.muC)+' R$/L',
  d:[['vs ago/26',(totComb.muA/totComb.muB-1)*100],['vs set/25',(totComb.muA/totComb.muC-1)*100]]}
];
document.getElementById('kpis').innerHTML = kpis.map(function(k){
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
document.getElementById('rail').innerHTML = railItems.map(function(it){
  var l=byCod[it.cod], prog=l.acum/l.meta, cls=l.pctMeta>=0?'good':'bad';
  var w=Math.min(prog,1)*100;
  return '<div class="railcell"><div class="railtop"><span class="railname">'+it.nome+
   '</span><span class="railpct num" style="color:var(--'+cls+')">'+pct(l.pctMeta)+'</span></div>'+
   '<div class="railval num">'+(it.un==='R$'?'R$ ':'')+nf0.format(l.acum)+(it.un==='L'?' L':'')+
   ' de '+(it.un==='R$'?'R$ ':'')+nf0.format(l.meta)+'</div>'+
   '<div class="track"><div class="fill" style="width:'+w.toFixed(1)+'%;background:var(--'+cls+')"></div>'+
   '<div class="tick" style="left:'+(FRAC*100).toFixed(1)+'%"></div></div></div>';
}).join('');

/* ---------- tooltip ---------- */
var tip=document.getElementById('tip');
function showTip(e,html){ tip.innerHTML=html; tip.hidden=false; moveTip(e); }
function moveTip(e){
  var r=tip.getBoundingClientRect(), x=e.clientX+14, y=e.clientY+14;
  if(x+r.width>innerWidth-8) x=e.clientX-r.width-14;
  if(y+r.height>innerHeight-8) y=e.clientY-r.height-14;
  tip.style.left=Math.max(8,x)+'px'; tip.style.top=Math.max(8,y)+'px';
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
function SVG(t,a){ var e=document.createElementNS('http://www.w3.org/2000/svg',t);
  for(var k in a) e.setAttribute(k,a[k]); return e; }

/* ---------- faturamento ---------- */
var F = D.fat;
var FTREE = {cod:'FTOT', filhos:[
  {cod:'FCOMB', filhos:[
    {cod:'FOTTO',   filhos:[{cod:'GC'},{cod:'GA'},{cod:'GNV'},{cod:'ET'}]},
    {cod:'FDIESEL', filhos:[{cod:'DS'},{cod:'DC'},{cod:'ARL'}]}
  ]},
  {cod:'FMERC', filhos:[{cod:'LOJA'},{cod:'AUTO'},{cod:'LAV'},{cod:'ARLAV'}]}
]};
var fatAberto={FTOT:true,FCOMB:true,FOTTO:true,FDIESEL:true,FMERC:true};
var fatBase='ano';   /* 'ano' | 'ant' */
var CODES={FOTTO:'OTTO',FDIESEL:'DIESEL'};

function brl(v){ return 'R$ '+nf0.format(Math.round(v)); }
function brlCurto(v){
  if(v>=1e6) return 'R$ '+nf2.format(v/1e6)+' mi';
  if(v>=1e3) return 'R$ '+nf0.format(v/1e3)+' mil';
  return brl(v);
}
function fD(f){ return fatBase==='ano'? f.dAno : f.dAnt; }
function fC(f){ return fatBase==='ano'? f.cAno : f.cAnt; }
function fQ(f){ return fatBase==='ano'? f.qAno : f.qAnt; }

(function heroFat(){
  var t=F.FTOT;
  document.getElementById('fatBig').innerHTML = brlCurto(t.recA)+'<small> · '+brl(t.recA)+'</small>';
  document.getElementById('fatSub').textContent =
    'Combustíveis a preço médio de venda de setembro aplicado ao volume projetado, somados a mercadorias e serviços.';
  var boxes=[
    {k:'vs ago/26', v:pct(t.vAnt), b:brlCurto(t.recB), c:t.vAnt>=0},
    {k:'vs set/25', v:pct(t.vAno), b:brlCurto(t.recC), c:t.vAno>=0},
    {k:'Combustíveis', v:nf1.format(F.FCOMB.part)+'%', b:brlCurto(F.FCOMB.recA), c:null},
    {k:'Mercadorias', v:nf1.format(F.FMERC.part)+'%', b:brlCurto(F.FMERC.recA), c:null}
  ];
  document.getElementById('fatBoxes').innerHTML = boxes.map(function(x){
    var col = x.c===null?'var(--ink)':(x.c?'var(--good)':'var(--bad)');
    return '<div class="fbox"><div class="k">'+x.k+'</div><div class="v" style="color:'+col+'">'+x.v+'</div><div class="b">'+x.b+'</div></div>';
  }).join('');
})();

function flatFat(node, nivel, out, visivel){
  out.push({cod:node.cod, nivel:nivel, filhos:node.filhos, visivel:visivel});
  if(node.filhos) node.filhos.forEach(function(f){ flatFat(f, nivel+1, out, visivel && !!fatAberto[node.cod]); });
}
function drawFat(){
  var el=document.getElementById('fatTree'), rows=[];
  flatFat(FTREE,1,rows,true);
  var vis=rows.filter(function(r){ return r.visivel; });
  var maxD=Math.max.apply(null, rows.filter(function(r){return r.nivel>1;}).map(function(r){ return Math.abs(fD(F[r.cod])); }));
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
              '<em>'+(f.qNota?f.qNota:(fatBase==='ano'?'vs set/25':'vs ago/26'))+'</em></span>';
      }
    }
    var delta = r.nivel===1
      ? '<b style="color:var(--good)">'+(pos?'+':'−')+brl(Math.abs(d))+'</b><div class="c"><span>crescimento total</span></div>'
      : '<b style="color:'+(pos?'var(--good)':'var(--bad)')+'">'+(pos?'+':'−')+brl(Math.abs(d))+'</b>'+
        '<div class="c"><span class="growbar"><i style="width:'+(Math.abs(d)/maxD*100).toFixed(1)+'%;background:'+(pos?'var(--p2)':'var(--bad)')+'"></i></span><span>'+nf0.format(c)+'%</span></div>';
    var chip = (r.nivel>=3) ? '<span class="code">'+(CODES[r.cod]||r.cod)+'</span>' : '';
    return '<div class="frow '+cls+'" data-f="'+r.cod+'">'+
      '<span class="tname">'+
        (temF?'<button class="tw" data-ft="'+r.cod+'" aria-expanded="'+(!!fatAberto[r.cod])+'" aria-label="Abrir '+esc(f.nome)+'">'+(fatAberto[r.cod]?'−':'+')+'</button>'
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
    var rs=[['set/2025',brl(f.recC)],['ago/2026',brl(f.recB)],['set/2026 projeção',brl(f.recA)],
            ['Δ ano',(f.dAno>=0?'+':'−')+brl(Math.abs(f.dAno))],
            ['Δ mês',(f.dAnt>=0?'+':'−')+brl(Math.abs(f.dAnt))],
            ['participação',nf1.format(f.part)+'% do faturamento']];
    if(f.qtdA!=null){
      rs.push(['quantidade set/26',nf0.format(Math.round(f.qtdA))+' '+f.un]);
      if(f.qtdC!=null) rs.push(['quantidade set/25',nf0.format(Math.round(f.qtdC))+' '+f.un]);
    }
    bind(row, ttRows(f.nome, rs));
  });
  Array.prototype.forEach.call(el.querySelectorAll('.tw[data-ft]'), function(btn){
    btn.addEventListener('click', function(){
      var c=btn.getAttribute('data-ft'); fatAberto[c]=!fatAberto[c]; drawFat(); sincFat();
    });
  });
}
function sincFat(){
  var ks=Object.keys(fatAberto);
  document.getElementById('fAll').setAttribute('aria-pressed', ks.every(function(k){return fatAberto[k];})?'true':'false');
  document.getElementById('fTop').setAttribute('aria-pressed', ks.every(function(k){return !fatAberto[k];})?'true':'false');
}
function setFatBase(b){
  fatBase=b;
  document.getElementById('fAno').setAttribute('aria-pressed', b==='ano'?'true':'false');
  document.getElementById('fMes').setAttribute('aria-pressed', b==='ant'?'true':'false');
  document.getElementById('fhDelta').textContent = b==='ano'?'crescimento ano':'crescimento mês';
  drawFat();
}
document.getElementById('fAno').addEventListener('click',function(){ setFatBase('ano'); });
document.getElementById('fMes').addEventListener('click',function(){ setFatBase('ant'); });
document.getElementById('fAll').addEventListener('click',function(){
  Object.keys(fatAberto).forEach(function(k){ fatAberto[k]=true; }); drawFat(); sincFat(); });
document.getElementById('fTop').addEventListener('click',function(){
  Object.keys(fatAberto).forEach(function(k){ fatAberto[k]=false; }); drawFat(); sincFat(); });
drawFat();

/* ---------- grouped bar charts ---------- */
var modoDia=false;
function niceMax(v){
  var p=Math.pow(10,Math.floor(Math.log10(v))), n=v/p;
  var s=n<=1?1:n<=1.2?1.2:n<=1.5?1.5:n<=2?2:n<=2.5?2.5:n<=3?3:n<=4?4:n<=5?5:n<=6?6:n<=8?8:10;
  return s*p;
}
function drawVol(svgId, cods, unidade){
  var svg=document.getElementById(svgId); svg.textContent='';
  var items=cods.map(function(c){ return byCod[c]; }).sort(function(a,b){
    return (modoDia?b.rdAtual-a.rdAtual : b.proj-a.proj); });
  var LBL=138, PAD_R=64, BH=11, GAP=3, ROW=BH*3+GAP*2+20, TOP=26;
  var W=Math.max(560, Math.min(1100, (svg.parentNode.clientWidth||880)));
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
  var ax=SVG('text',{x:LBL,y:12,class:'axis'});
  ax.textContent = unidade + (modoDia?' por dia':' no mês');
  ax.setAttribute('text-anchor','start'); ax.setAttribute('x',LBL); ax.setAttribute('y',11);
  var cols=['var(--p1)','var(--p2)','var(--p3)'];
  var per=['Set/2025','Ago/2026','Set/2026 proj.'];
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
        ['vs ago/26', pct(dA)], ['vs set/25', pct(dN)],
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
  var svg=document.getElementById('cMarg'); svg.textContent='';
  var items=COMB.map(function(c){return byCod[c];}).sort(function(a,b){return b.muA-a.muA;});
  var LBL=138, PAD_R=76, ROW=34, TOP=30;
  var W=Math.max(560,Math.min(1100,(svg.parentNode.clientWidth||880)));
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
    [[l.muC,'var(--p1)','Set/2025'],[l.muB,'var(--p2)','Ago/2026'],[l.muA,'var(--p3)','Set/2026']].forEach(function(p,j){
      var c=SVG('circle',{cx:x(p[0]),cy:cy,r:j===2?6.5:5,fill:p[1],stroke:'var(--surf)','stroke-width':2});
      bind(c, ttRows(l.cod+' · '+l.nome,[
        [p[2], nf3.format(p[0])+' R$/L'],
        ['margem %', nf2.format(j===0?l.mpC:(j===1?l.mpB:l.mpA))+'%'],
        ['custo médio', nf3.format(j===2?l.pmcA:(j===1?l.pmcB:'-'))],
        ['Δ margem vs ago', pct(l.dMargPct)]
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
  var svg=document.getElementById('cDelta'); svg.textContent='';
  var items=COMB.concat(MERC).map(function(c){return byCod[c];}).sort(function(a,b){return b.dMrs-a.dMrs;});
  var LBL=138, PAD_R=20, BH=15, ROW=25, TOP=28;
  var W=Math.max(560,Math.min(1100,(svg.parentNode.clientWidth||880)));
  var PW=W-LBL-PAD_R, H=TOP+items.length*ROW+12;
  svg.setAttribute('viewBox','0 0 '+W+' '+H); svg.setAttribute('width',W); svg.setAttribute('height',H);
  var m=Math.max.apply(null,items.map(function(l){return Math.abs(l.dMrs);}));
  var max=niceMax(m), zero=LBL+PW*0.42, sc=Math.max(PW-(zero-LBL), zero-LBL)/max;
  var negW=zero-LBL, posW=W-PAD_R-zero;
  sc=Math.min(negW/max, posW/max);
  var x=function(v){return zero+v*sc;};
  svg.appendChild(SVG('line',{x1:zero,x2:zero,y1:TOP-10,y2:H-8,stroke:'var(--line2)','stroke-width':1.5}));
  var ax=SVG('text',{x:LBL,y:11,class:'axis'}); ax.textContent='R$ de margem bruta a mais (ou a menos) que agosto'; svg.appendChild(ax);
  items.forEach(function(l,i){
    var y0=TOP+i*ROW;
    var nm=SVG('text',{x:LBL-12,y:y0+BH-2,class:'catlbl cat','text-anchor':'end'}); nm.textContent=l.cod; svg.appendChild(nm);
    var v=l.dMrs, pos=v>=0, w=Math.max(1.5,Math.abs(v)*sc);
    var r=SVG('rect',{x:pos?zero:zero-w,y:y0,width:w,height:BH,rx:4,fill:pos?'var(--p2)':'var(--bad)',class:'bar'});
    bind(r, ttRows(l.cod+' · '+l.nome,[
      ['margem projetada','R$ '+nf0.format(l.mrsProj)],
      ['margem ago/26','R$ '+nf0.format(l.mrsAnt)],
      ['diferença',(v>=0?'+':'−')+'R$ '+nf0.format(Math.abs(v))],
      ['volume (ritmo)',pct(l.vrdAnt)],
      ['margem unitária',pct(l.dMargPct)]
    ]));
    svg.appendChild(r);
    var lb=SVG('text',{x:pos?zero+w+8:zero-w-8,y:y0+BH-3,class:'vallbl','text-anchor':pos?'start':'end','font-weight':600});
    lb.setAttribute('fill',pos?'var(--good)':'var(--bad)');
    lb.textContent=(pos?'+':'−')+nf0.format(Math.abs(v)); svg.appendChild(lb);
  });
}

/* ---------- quadrante ---------- */
function drawQuad(){
  var svg=document.getElementById('cQuad'); svg.textContent='';
  var items=COMB.concat(['LOJA','AUTO','LAV']).map(function(c){return byCod[c];});
  var W=Math.max(560,Math.min(1100,(svg.parentNode.clientWidth||880))), H=400;
  var M={t:26,r:22,b:44,l:62};
  svg.setAttribute('viewBox','0 0 '+W+' '+H); svg.setAttribute('width',W); svg.setAttribute('height',H);
  var xs=items.map(function(l){return l.vrdAnt;}), ys=items.map(function(l){return l.dMargPct;});
  var xmin=Math.min(0,Math.min.apply(null,xs))-4, xmax=Math.max.apply(null,xs)+6;
  var ymin=Math.min(0,Math.min.apply(null,ys))-5, ymax=Math.max.apply(null,ys)+7;
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
  axx.textContent='variação do volume no ritmo diário vs ago/26'; svg.appendChild(axx);
  var axy=SVG('text',{x:14,y:(M.t+H-M.b)/2,class:'axis cat','text-anchor':'middle',transform:'rotate(-90 14 '+((M.t+H-M.b)/2)+')'});
  axy.textContent='variação da margem unitária'; svg.appendChild(axy);
  items.forEach(function(l){
    var cx=PX(l.vrdAnt), cy=PY(l.dMargPct);
    var g=SVG('g',{});
    var rmax=Math.max.apply(null,items.map(function(z){return Math.abs(z.mrsProj);}));
    var r=6+Math.sqrt(Math.abs(l.mrsProj)/rmax)*8;
    g.appendChild(SVG('circle',{cx:cx,cy:cy,r:r,fill:l.dMrs>=0?'var(--p2)':'var(--bad)','fill-opacity':.85,stroke:'var(--surf)','stroke-width':2}));
    var lb=SVG('text',{x:cx,y:cy-r-5,class:'catlbl cat','text-anchor':'middle','font-size':11});
    lb.textContent=l.cod; g.appendChild(lb);
    bind(g, ttRows(l.cod+' · '+l.nome,[
      ['volume (ritmo)',pct(l.vrdAnt)],
      ['margem unitária',pct(l.dMargPct)],
      ['margem projetada','R$ '+nf0.format(l.mrsProj)],
      ['Δ margem R$',(l.dMrs>=0?'+':'−')+'R$ '+nf0.format(Math.abs(l.dMrs))]
    ]));
    svg.appendChild(g);
  });
  var nota=SVG('text',{x:M.l,y:11,class:'axis cat'});
  nota.textContent='o tamanho do círculo é a margem bruta projetada da linha'; svg.appendChild(nota);
}

/* ---------- tabela ---------- */
var ordem='vol';
function drawTbl(){
  var t=document.getElementById('tbl');
  var cols=['Linha','Acum.','Projeção','% meta','vs ago','ritmo/d','vs set/25','Marg. un.','ago/26','set/25','Margem R$','Δ vs ago'];
  t.tHead.innerHTML='<tr>'+cols.map(function(c,i){return '<th'+(i===0?'':'')+'>'+c+'</th>';}).join('')+'</tr>';
  var linhas=LIN.slice().sort(function(a,b){
    if(ordem==='mar') return b.dMrs-a.dMrs;
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
      '<td class="n">'+(l.metaOk?c(l.pctMeta):(l.meta>0?'<span style="color:var(--warn);font-weight:600" title="meta cadastrada como 24 (percentual de mix) no lugar dos litros">meta inválida</span>':'<span style="color:var(--ink3)">—</span>'))+'</td>'+
      '<td class="n">'+c(l.difAnt)+'</td>'+
      '<td class="n">'+c(l.vrdAnt)+'</td>'+
      '<td class="n">'+c(l.difAno)+'</td>'+
      '<td class="n"><b>'+marg+'</b></td>'+
      '<td class="n" style="color:var(--ink3)">'+margB+'</td>'+
      '<td class="n" style="color:var(--ink3)">'+margC+'</td>'+
      '<td class="n">R$ '+nf0.format(l.mrsProj)+'</td>'+
      '<td class="n"><span class="'+(l.dMrs>0?'pos':'neg')+'">'+(l.dMrs>=0?'+':'−')+nf0.format(Math.abs(l.dMrs))+'</span></td></tr>';
  }
  linhas.forEach(function(l){ rows.push(tr(l,false)); });
  ['OTTO','DIESEL','TOTCOMB','TOTMERC'].forEach(function(c){ rows.push(tr(byCod[c],true)); });
  t.tBodies[0].innerHTML=rows.join('');
}

/* ---------- leituras ---------- */
var DS=byCod.DS, LOJA=byCod.LOJA, GNV=byCod.GNV, DC=byCod.DC, GA=byCod.GA;
var reads=[
 {k:'crit',t:'Diesel S-10: volume que não vira margem',
  p:'O S-10 cresce <b>'+pct(DS.vrdAnt)+'</b> no ritmo diário, mas o custo médio subiu de R$ '+nf3.format(DS.pmcB)+' para R$ '+nf3.format(DS.pmcA)+' (+'+nf1.format((DS.pmcA/DS.pmcB-1)*100)+'%) e o preço de venda só acompanhou +'+nf1.format((DS.pmvA/DS.pmvB-1)*100)+'%. A margem caiu de R$ '+nf3.format(DS.muB)+' para R$ '+nf3.format(DS.muA)+' por litro (<b>'+pct(DS.dMargPct)+'</b>). Resultado: '+pct(DS.vrdAnt)+' de litros e <b>R$ '+nf0.format(Math.abs(DS.dMrs))+' a menos</b> de margem que o mês anterior.',
  a:'Repasse de custo no S-10 — quanto do aumento ainda não foi para a bomba, e por quê?'},
 {k:'crit',t:'Loja é a única linha abaixo da meta',
  p:'Projeção de <b>R$ '+nf0.format(LOJA.proj)+'</b> contra meta de R$ '+nf0.format(LOJA.meta)+' — <b>'+pct(LOJA.pctMeta)+'</b> no ritmo proporcional. A margem também cedeu ('+nf2.format(LOJA.mpB)+'% → '+nf2.format(LOJA.mpA)+'%), o que tira <b>R$ '+nf0.format(Math.abs(LOJA.dMrs))+'</b> de margem contra agosto. É a maior linha de mercadorias: cada ponto de margem aqui vale mais que o resto somado.',
  a:'Mix da loja e conversão de pista: no ritmo diário o combustível cresce '+pct(totComb.vrdAnt)+' e a loja só '+pct(LOJA.vrdAnt)+'.'},
 {k:'ok',t:'GNV: margem recomposta, volume estagnado',
  p:'Margem saltou de R$ '+nf3.format(GNV.muB)+' para R$ '+nf3.format(GNV.muA)+' por m³ (<b>'+pct(GNV.dMargPct)+'</b>), somando <b>+R$ '+nf0.format(GNV.dMrs)+'</b>. Mas o volume está praticamente parado contra agosto ('+pct(GNV.vrdAnt)+') e <b>'+pct(GNV.difAno)+'</b> contra setembro de 2025.',
  a:'A recomposição de preço está custando volume? Vale testar elasticidade antes de consolidar.'},
 {k:'ok',t:'O crescimento, no agregado, paga',
  p:'Margem bruta total projetada de <b>R$ '+nf0.format(margTotProj)+'</b> — <b>'+pct((margTotProj/margTotAnt-1)*100)+'</b> sobre agosto e <b>'+pct((margTotProj/margTotAno-1)*100)+'</b> sobre setembro de 2025. Combustíveis rodam a <b>'+pct(totComb.pctMeta)+'</b> da meta proporcional. O S-500 é o melhor exemplo: '+pct(DC.vrdAnt)+' de volume mesmo cedendo '+nf1.format(Math.abs(DC.dMargPct))+'% de margem unitária, e ainda entrega +R$ '+nf0.format(DC.dMrs)+'.',
  a:'A meta de combustíveis está calibrada? Rodar '+pct(totComb.pctMeta)+' acima do ritmo sugere meta defasada.'},
 {k:'wn',t:'Mix V-Power acima da meta',
  p:'A meta de mix GA/GC é '+nf0.format(D.mix.meta)+'% e a projeção está em <b>'+nf2.format(D.mix.proj)+'%</b>. O V-Power cresce '+pct(GA.vrdAnt)+' no ritmo diário e <b>'+pct(GA.difAno)+'</b> contra o ano passado, com margem estável em R$ '+nf3.format(GA.muA)+'/L — <b>+R$ '+nf0.format(GA.dMrs)+'</b> de margem. É a segunda maior contribuição de margem entre os combustíveis.',
  a:'Rever a meta de mix para cima e replicar a abordagem de pista que está funcionando.'},
 {k:'wn',t:'Meta do V-Power está errada no Argo',
  p:'A linha VP mostra um "% meta" absurdo, de centenas de milhares por cento, porque o campo de meta de volume recebeu o <b>percentual de mix</b>, não os litros — no mês anterior também. O painel marca <b>meta inválida</b>; o indicador fica inutilizável enquanto o cadastro não for corrigido.',
  a:'Rafael/Maicon: corrigir o cadastro de meta da sigla VP no Argo antes do fechamento.'}
];
document.getElementById('reads').innerHTML=reads.map(function(r){
  var nome={crit:'atenção',ok:'no rumo',wn:'ajuste'}[r.k];
  return '<div class="read '+r.k+'"><h3><span class="tag '+r.k+'">'+nome+'</span>'+esc(r.t)+'</h3><p>'+r.p+'</p>'+
   (r.a?'<div class="ask"><b>Pergunta para a reunião</b>'+esc(r.a)+'</div>':'')+'</div>';
}).join('');

/* ---------- cabeçalho ---------- */
(function(){
  var b=document.getElementById('hdPeriodo'); if(b) b.textContent=D.meta.mes_rotulo||'';
  var m=document.getElementById('hdMeta');
  if(m) m.textContent='Unidades '+D.meta.unidades+' · fechamento '+D.meta.data+
        ' · '+D.meta.dias_dec+' de '+D.meta.dias_mes+' dias';
})();

document.getElementById('foot').innerHTML =
 'Relatório de origem: <b>Acompanhamento de Metas e Margens de Vendas</b> — Argo Gerenciador v.11.09.02, gerado em '+D.meta.gerado+', unidades '+D.meta.unidades+', 1º nível de classificação.<br>'+
 'Projeção linear: acumulado até '+D.meta.data+' ÷ '+D.meta.dias_dec+' × '+D.meta.dias_mes+' dias, como o próprio Argo calcula. A comparação com o mês anterior usa o mês fechado ('+D.meta.dias_ant+' dias); a coluna "ritmo/dia" corrige a diferença de calendário.<br>'+
 'A tabela de margens do Argo acumula um volume de combustíveis ligeiramente diferente do da tabela de projeção (corte de data distinto no sistema). As margens usam a primeira; volumes e projeções, a segunda.<br>'+
 'Faturamento: volume projetado × preço médio de venda do mês para combustíveis; para mercadorias, o valor do próprio relatório. Quantidades de mercadorias = faturamento ÷ preço médio unitário.<br>'+
 'O Arla aparece em duas linhas, como no Argo: ARL em litros dentro do ciclo diesel e ARLA em R$ dentro das mercadorias (SKUs distintos: pista e loja).<br>'+
 'O preço médio da lavagem no histórico do Argo está inconsistente (uma ordem de grandeza abaixo do valor atual), então a quantidade histórica de lavagens não é comparável e fica fora do crescimento de unidades das mercadorias.<br>'+
 'Visão consolidada da rede — o relatório de origem não traz quebra por unidade.';

/* ---------- eventos ---------- */
function redraw(){
  drawVol('cVolComb',COMB,'litros');
  drawVol('cVolMerc',MERC,'R$');
  drawMarg(); drawDelta(); drawQuad();
}
document.getElementById('bMes').addEventListener('click',function(){
  modoDia=false; this.setAttribute('aria-pressed','true');
  document.getElementById('bDia').setAttribute('aria-pressed','false');
  drawVol('cVolComb',COMB,'litros'); drawVol('cVolMerc',MERC,'R$');
});
document.getElementById('bDia').addEventListener('click',function(){
  modoDia=true; this.setAttribute('aria-pressed','true');
  document.getElementById('bMes').setAttribute('aria-pressed','false');
  drawVol('cVolComb',COMB,'litros'); drawVol('cVolMerc',MERC,'R$');
});
document.getElementById('oVol').addEventListener('click',function(){
  ordem='vol'; this.setAttribute('aria-pressed','true');
  document.getElementById('oMar').setAttribute('aria-pressed','false'); drawTbl();
});
document.getElementById('oMar').addEventListener('click',function(){
  ordem='mar'; this.setAttribute('aria-pressed','true');
  document.getElementById('oVol').setAttribute('aria-pressed','false'); drawTbl();
});
var rt; addEventListener('resize',function(){ clearTimeout(rt); rt=setTimeout(redraw,140); });
redraw(); drawTbl();
})();
