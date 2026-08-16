// Os dados chegam descriptografados pelo Vault (index.html) após o login.
const D = window.__VAULT_DATA__.D;

const MN = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MFULL = ['','janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const DIM = [0,31,28,31,30,31,30,31,31,30,31,30,31];
const CORTE_M = 8, CORTE_D = 14, FECHADOS = 7;
const CM = {}; D.contas.forEach(c => CM[c.id] = c);
const GRUPOS_R = [...new Set(D.contas.filter(c=>c.tipo==='R').map(c=>c.grupo))];
const GRUPOS_P = [...new Set(D.contas.filter(c=>c.tipo==='P').map(c=>c.grupo))];

// ---------- agregações a partir dos lançamentos ----------
const R = {};           // R[conta][mes] = realizado
D.contas.forEach(c => R[c.id] = Array(13).fill(0));
for (const l of D.lanc) {
  if (l.c === 'GIRO') continue;
  R[l.c][+l.d.slice(5,7)] += l.v;
}
function mediana(arr){ const a=[...arr].sort((x,y)=>x-y); const n=a.length; return n%2? a[(n-1)/2] : (a[n/2-1]+a[n/2])/2; }
const MED = {}; D.contas.forEach(c => { MED[c.id] = mediana(R[c.id].slice(1, FECHADOS+1)); });
function prev(cid, m){
  let v = MED[cid];
  if (m >= 9) {
    if (['captacao','resgates'].includes(cid)) v = 0;               // zerado até decisão
    if (cid==='aplic') v = -1500;                                    // DCA Bitcoin agendado (política Samuel)
    if (cid === 'viagens' && (m===9||m===10||m===11)) v = Math.min(v, 0) - 10000; // lua de mel escalonada 10k set/out/nov
    if (cid === 'master') v = MED['master'];
  }
  return v;
}
function agoRestante(cid){ return prev(cid, 9) * (31 - CORTE_D) / 31; }

// saldo total (contas monitoradas) no fim de cada mês
const saldoFim = Array(13).fill(0);
const SB = D.saldos;
for (let m=1; m<=CORTE_M; m++) saldoFim[m] = SB.sicredi.fim['2026-0'+m] + SB.nubank.fim['2026-0'+m];
const saldoIniAno = SB.sicredi.ini_ano + SB.nubank.ini_ano;
let projAgo = saldoFim[CORTE_M] + D.contas.reduce((s,c)=>s+agoRestante(c.id),0);
const saldoProj = Array(13).fill(null);
saldoProj[CORTE_M] = projAgo;
for (let m=9; m<=12; m++) saldoProj[m] = saldoProj[m-1] + D.contas.reduce((s,c)=>s+prev(c.id,m),0);
function saldoNoFim(m){ return m < CORTE_M ? saldoFim[m] : saldoProj[m]; }
function saldoNoInicio(m){ return m===1 ? saldoIniAno : saldoNoFim(m-1); }

// ---------- estado ----------
let per = {t:'m', v: CORTE_M};   // mês corrente
let centro = 'Consolidado';
let sub = 'resumo';
let abertos = new Set(['Renda','Financeiro','Viagens e casamento']);
let secs = new Set();
function tgSec(k){ secs.has(k)?secs.delete(k):secs.add(k); render(); }

function contasAtivas(){ return D.contas.filter(c => centro==='Consolidado' || c.centro===centro); }
function mesesDo(p){ if(p.t==='m') return [p.v]; if(p.t==='t') return [3*p.v-2,3*p.v-1,3*p.v]; return [1,2,3,4,5,6,7,8,9,10,11,12]; }

const fmt = v => { const n = Math.round(v); const s = Math.abs(n).toLocaleString('pt-BR');
  return (n<0?'−':'') + s; };
function cell(v, cls){ if (v===null||v===undefined||Math.round(v)===0) return `<td class="${cls||''}">·</td>`;
  return `<td class="${cls||''}${v<0?' neg':''}">${fmt(v)}</td>`; }

// ---------- render seletores ----------
function pills(){
  const sel = document.getElementById('selper');
  if (!sel.options.length){
    let h = '<optgroup label="Meses">';
    for (let m=1;m<=12;m++) h += `<option value="m:${m}">${MFULL[m][0].toUpperCase()+MFULL[m].slice(1)}</option>`;
    h += '</optgroup><optgroup label="Trimestres">';
    for (let t=1;t<=4;t++) h += `<option value="t:${t}">${t}º trimestre</option>`;
    h += '</optgroup><optgroup label="Ano"><option value="y:0">2026 completo</option></optgroup>';
    sel.innerHTML = h;
  }
  sel.value = per.t+':'+per.v;
  const CS = ['Consolidado','Samuel','Casa','Investimentos'];
  document.getElementById('centros').innerHTML = CS.map(c =>
    `<span class="pill ctr ${centro===c?'on':''}" onclick="centro='${c}';render()">${c}</span>`).join('');
}
function selPer(v){ const [t,n]=v.split(':'); setPer({t, v:+n}); }
let page='fluxo';
function showPage(p){
  page=p;
  for (const k of ['fluxo','plano','patri','estr','pend','docs','acessos'])
    document.getElementById('page-'+k).style.display = k===p?'':'none';
  document.querySelectorAll('#ptabs span').forEach(t=>t.classList.toggle('on', t.dataset.p===p));
}
function setPer(p){ per = {t:p.t, v:p.v}; if (per.t!=='m') sub='resumo'; render(); }
function navPer(d){
  if (per.t==='m'){ const v=per.v+d; if(v>=1&&v<=12){per.v=v; render();} }
  else if (per.t==='t'){ const v=per.v+d; if(v>=1&&v<=4){per.v=v; render();} }
}
function renderPlano(){
  const st={ok:['✓','#0E5C46'],alto:['▲','#B73D24'],novo:['●','#EC6C22'],dec:['◆','#004438'],zero:['?','#8A9089']};
  let h='<table><thead><tr><th class="lab"></th><th>Plano</th><th>Real</th><th></th></tr></thead><tbody>';
  for (const r of D.plano.linhas){
    if (r[2]===null){ h+=`<tr class="caixa"><td class="lab">${r[0]}</td><td></td><td></td><td></td></tr>`; continue; }
    const [ic,cor]=st[r[3]];
    h+=`<tr><td class="lab">${r[0]}${r[4]?`<div style="font-size:.68rem;color:var(--muted)">${r[4]}</div>`:''}</td><td class="prevcol">${r[1]?fmt(r[1]):'·'}</td><td><b>${fmt(r[2])}</b></td><td style="color:${cor};font-weight:900">${ic}</td></tr>`;
  }
  h+='</tbody></table>';
  document.getElementById('planotab').innerHTML=h;
  document.getElementById('planorem').innerHTML = D.plano.remuneracao.map(x=>
    `<div class="kv"><span class="k">${x[0]}<small>${x[2]}</small></span><span class="v">${fmt(x[1])}</span></div>`).join('');
  document.getElementById('planoins').innerHTML = D.plano.insights.map((x,i)=>
    `<div class="it"><span>${x}</span></div>`).join('');
}
function renderEstrategia(){
  const item = i => i.big
    ? `<div class="numrow"><span class="big">${i.big}</span><span>${i.d||''}</span></div>`
    : `<div class="it">${i.h?`<b>${i.h}</b>`:''}${i.d?`<span>${i.d}</span>`:''}${i.pts?`<ul class="pts">${i.pts.map(p=>`<li>${p}</li>`).join('')}</ul>`:''}</div>`;
  document.getElementById('estrategia').innerHTML = (D.estrategia||[]).map(b=> b.fold
    ? `<details><summary>${b.t}</summary>${b.itens.map(item).join('')}</details>`
    : `<div class="bl"><b>${b.t}</b>${b.itens.map(item).join('')}</div>`).join('');
}

// ---------- fluxo: resumo (P × R) ----------
function realPer(cid, meses){ return meses.filter(m=>m<=CORTE_M).reduce((s,m)=>s+R[cid][m],0); }
function prevPer(cid, meses){ return meses.reduce((s,m)=>s+prev(cid,m),0); }

function linha(nome, pv, rv, cls, extra){
  return `<tr class="${cls}" ${extra||''}><td class="lab">${nome}</td>${cell(pv,'prevcol')}${cell(rv)}</tr>`;
}
function blocoGrupos(tipo, meses, out){
  const grupos = tipo==='R' ? GRUPOS_R : GRUPOS_P;
  let tp=0, tr=0, rows='';
  for (const g of grupos){
    const cs = contasAtivas().filter(c=>c.grupo===g && c.tipo===tipo);
    if (!cs.length) continue;
    const pv = cs.reduce((s,c)=>s+prevPer(c.id,meses),0);
    const rv = cs.reduce((s,c)=>s+realPer(c.id,meses),0);
    tp+=pv; tr+=rv;
    if (Math.round(pv)===0 && Math.round(rv)===0) continue;
    rows += linha(g, pv, rv, 'grp'+(abertos.has(g)?' open':''), `onclick="tg('${g}')"`);
    if (abertos.has(g)) for (const c of cs){
      const cp=prevPer(c.id,meses), cr=realPer(c.id,meses);
      if (Math.round(cp)===0 && Math.round(cr)===0) continue;
      rows += `<tr class="sub"><td class="lab" onclick="verLanc('${c.id}')">${c.nome}</td>${cell(cp,'prevcol')}${cell(cr)}</tr>`;
    }
  }
  out.rows=rows; out.tp=tp; out.tr=tr;
}
function tg(g){ abertos.has(g)?abertos.delete(g):abertos.add(g); render(); }

function renderResumo(meses){
  const temReal = meses.some(m=>m<=CORTE_M);
  const rec={}, pag={};
  blocoGrupos('R', meses, rec); blocoGrupos('P', meses, pag);
  const ini = saldoNoInicio(meses[0]), fim = saldoNoFim(meses[meses.length-1]);
  const fimPrev = ini + rec.tp + pag.tp;
  let h = `<table><thead><tr><th class="lab"></th><th>Previsto</th><th>Realizado</th></tr></thead><tbody>`;
  h += `<tr class="caixa"><td class="lab">Caixa no início</td>${cell(ini,'prevcol')}${cell(ini)}</tr>`;
  h += linha('Recebimentos', rec.tp, temReal?rec.tr:null, 'tot sec'+(secs.has('R')?' open':''), `onclick="tgSec('R')"`);
  if (secs.has('R')) h += rec.rows;
  h += linha('Pagamentos', pag.tp, temReal?pag.tr:null, 'tot sec'+(secs.has('P')?' open':''), `onclick="tgSec('P')"`);
  if (secs.has('P')) h += pag.rows;
  h += linha('FLUXO DE CAIXA', rec.tp+pag.tp, temReal?(rec.tr+pag.tr):null, 'fluxo');
  h += `<tr class="caixa"><td class="lab">Caixa no fim</td>${cell(fimPrev,'prevcol')}${temReal?cell(fim):'<td>·</td>'}</tr>`;
  h += '</tbody></table>';
  document.getElementById('ftabela').innerHTML = h;
}

// ---------- fluxo: visão ano/tri por meses ----------
function renderMeses(meses){
  const cs = contasAtivas();
  const val = (ids, m) => m<=CORTE_M ? ids.reduce((s,c)=>s+R[c.id][m],0) : ids.reduce((s,c)=>s+prev(c.id,m),0);
  let h = `<table><thead><tr><th class="lab"></th>${meses.map(m=>`<th>${MN[m]}${m>CORTE_M?'*':(m===CORTE_M?'¹':'')}</th>`).join('')}<th>Total</th></tr></thead><tbody>`;
  const linhaM = (nome, ids, cls, extra, labExtra) => {
    const vs = meses.map(m=>val(ids,m)); const tot=vs.reduce((a,b)=>a+b,0);
    if (cls==='sub' && Math.round(Math.abs(tot))===0) return '';
    return `<tr class="${cls}" ${extra||''}><td class="lab" ${labExtra||''}>${nome}</td>${vs.map((v,i)=>cell(v, meses[i]>CORTE_M?'prevcol':'')).join('')}${cell(tot)}</tr>`;
  };
  h += `<tr class="caixa"><td class="lab">Caixa no início</td>${meses.map(m=>cell(saldoNoInicio(m), m>CORTE_M?'prevcol':'')).join('')}<td>·</td></tr>`;
  const recIds = cs.filter(c=>c.tipo==='R'), pagIds = cs.filter(c=>c.tipo==='P');
  const bloco = (grupos, pool) => {
    for (const g of grupos){
      const ids = pool.filter(c=>c.grupo===g); if (!ids.length) continue;
      h += linhaM(g, ids, 'grp'+(abertos.has(g)?' open':''), `onclick="tg('${g}')"`);
      if (abertos.has(g)) for (const c of ids) h += linhaM(c.nome, [c], 'sub', '', `onclick="event.stopPropagation();verLanc('${c.id}')"`);
    }
  };
  h += linhaM('Recebimentos', recIds, 'tot sec'+(secs.has('R')?' open':''), `onclick="tgSec('R')"`);
  if (secs.has('R')) bloco(GRUPOS_R, recIds);
  h += linhaM('Pagamentos', pagIds, 'tot sec'+(secs.has('P')?' open':''), `onclick="tgSec('P')"`);
  if (secs.has('P')) bloco(GRUPOS_P, pagIds);
  h += linhaM('FLUXO DE CAIXA', cs, 'fluxo');
  h += `<tr class="caixa"><td class="lab">Caixa no fim</td>${meses.map(m=>cell(saldoNoFim(m), m>CORTE_M?'prevcol':'')).join('')}<td>·</td></tr>`;
  h += '</tbody></table>';
  document.getElementById('ftabela').innerHTML = h;
}

// ---------- semanas (seg–dom dentro do mês) ----------
function semanasDo(m){
  const semanas=[]; let ini=1;
  while (ini<=DIM[m]){
    const dow = new Date(2026,m-1,ini).getDay();            // 0=dom
    const ateDom = dow===0 ? 0 : 7-dow;
    let fim = Math.min(ini+ateDom, DIM[m]);
    if (dow===0) fim = ini;                                  // domingo isolado fecha semana
    semanas.push([ini,fim]); ini = fim+1;
  }
  // mescla semanas de 1 dia iniciadas em domingo com a anterior? mantém simples: seg–dom estrito
  const out=[]; for(const s of semanas){ if(out.length && (new Date(2026,m-1,s[0]).getDay()!==1)) {out[out.length-1][1]=s[1];} else out.push(s);} return out;
}
function renderSemanas(m){
  const sem = semanasDo(m);
  const cs = contasAtivas();
  const somaSem = (ids,[a,b]) => D.lanc.reduce((s,l)=>{
    if(l.c==='GIRO') return s; const lm=+l.d.slice(5,7), ld=+l.d.slice(8,10);
    if(lm!==m||ld<a||ld>b) return s; return ids.some(c=>c.id===l.c)? s+l.v : s; },0);
  let h = `<table><thead><tr><th class="lab"></th>${sem.map(s=>`<th>${String(s[0]).padStart(2,'0')}–${String(s[1]).padStart(2,'0')}</th>`).join('')}<th>Total</th></tr></thead><tbody>`;
  const lr = (nome, ids, cls, skipVazio, extra, labExtra) => { const vs=sem.map(s=>somaSem(ids,s)); const t=vs.reduce((a,b)=>a+b,0);
    if (skipVazio && Math.round(Math.abs(t))===0) return '';
    return `<tr class="${cls}" ${extra||''}><td class="lab" ${labExtra||''}>${nome}</td>${vs.map(v=>cell(v)).join('')}${cell(t)}</tr>`; };
  const recIds=cs.filter(c=>c.tipo==='R'), pagIds=cs.filter(c=>c.tipo==='P');
  const bloco = (grupos, pool) => {
    for (const g of grupos){
      const ids = pool.filter(c=>c.grupo===g); if (!ids.length) continue;
      const gr = lr(g, ids, 'grp'+(abertos.has(g)?' open':''), true, `onclick="tg('${g}')"`);
      if (!gr) continue;
      h += gr;
      if (abertos.has(g)) for (const c of ids) h += lr(c.nome, [c], 'sub', true, '', `onclick="event.stopPropagation();verLanc('${c.id}')"`);
    }
  };
  h += lr('Recebimentos', recIds, 'tot sec'+(secs.has('R')?' open':''), false, `onclick="tgSec('R')"`);
  if (secs.has('R')) bloco(GRUPOS_R, recIds);
  h += lr('Pagamentos', pagIds, 'tot sec'+(secs.has('P')?' open':''), false, `onclick="tgSec('P')"`);
  if (secs.has('P')) bloco(GRUPOS_P, pagIds);
  h += lr('FLUXO DE CAIXA', cs, 'fluxo');
  h += '</tbody></table>';
  document.getElementById('ftabela').innerHTML = h;
}

// ---------- dias ----------
function renderDias(m){
  const cs = new Set(contasAtivas().map(c=>c.id));
  const dias = {};
  for (const l of D.lanc){
    if (l.c==='GIRO' || +l.d.slice(5,7)!==m || !cs.has(l.c)) continue;
    const d=+l.d.slice(8,10); dias[d]=dias[d]||{r:0,p:0};
    l.v>0? dias[d].r+=l.v : dias[d].p+=l.v;
  }
  let saldo = saldoNoInicio(m);
  const lim = m===CORTE_M? CORTE_D : DIM[m];
  let h = `<table><thead><tr><th class="lab">Dia</th><th>Entradas</th><th>Saídas</th><th>Fluxo</th><th>Caixa</th></tr></thead><tbody>`;
  for (let d=1; d<=lim; d++){
    const x = dias[d]||{r:0,p:0}; const f=x.r+x.p; saldo+=f;
    if (!x.r && !x.p) continue;
    h += `<tr><td class="lab">${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')} · ${['dom','seg','ter','qua','qui','sex','sáb'][new Date(2026,m-1,d).getDay()]}</td>${cell(x.r)}${cell(x.p)}${cell(f)}${cell(saldo)}</tr>`;
  }
  h += '</tbody></table>';
  document.getElementById('ftabela').innerHTML = h;
}

// ---------- lançamentos de uma conta (modal) ----------
function verLanc(cid){
  const meses = mesesDo(per);
  const ls = D.lanc.filter(l => l.c===cid && meses.includes(+l.d.slice(5,7)))
    .sort((a,b)=> b.d.localeCompare(a.d) || Math.abs(b.v)-Math.abs(a.v));
  const tot = ls.reduce((s,l)=>s+l.v,0);
  document.getElementById('mtit').textContent = CM[cid].nome;
  document.getElementById('msub').textContent = `${tituloPer()} · ${ls.length} lançamento${ls.length===1?'':'s'} · total ${fmt(tot)}`;
  document.getElementById('mlist').innerHTML = ls.map(l =>
    `<li><span class="q">${l.m.slice(0,52)}<span class="f">${l.d.slice(8,10)}/${l.d.slice(5,7)} · ${({sicredi:'Conta Sicredi',nubank:'Conta Nubank',visa:'Visa Infinite',nucard:'Cartão Nubank',master:'Mastercard (estimado)'})[l.o]}</span></span><span class="v${l.v<0?' neg':''}">${fmt(l.v)}</span></li>`).join('')
    || '<li>Sem lançamentos no período.</li>';
  document.getElementById('modal').classList.add('on');
}

// ---------- barras ----------
function renderBarras(meses){
  const temReal = meses.some(m=>m<=CORTE_M);
  const gs = GRUPOS_P.map(g=>{
    const ids = contasAtivas().filter(c=>c.grupo===g&&c.tipo==='P');
    const v = temReal ? ids.reduce((s,c)=>s+realPer(c.id,meses),0) : ids.reduce((s,c)=>s+prevPer(c.id,meses),0);
    return {g, v:-v};
  }).filter(x=>x.v>0.5).sort((a,b)=>b.v-a.v);
  const max = gs[0]?gs[0].v:1;
  document.getElementById('barras').innerHTML = gs.map(x=>
    `<div class="row"><span class="n">${x.g}</span><span class="track"><span class="fill" style="width:${(100*x.v/max).toFixed(1)}%"></span></span><span class="v">${fmt(-x.v)}</span></div>`).join('');
  document.getElementById('btitulo').textContent = (temReal?'realizado':'previsto')+' · '+tituloPer();
}

// ---------- cards estáticos ----------
function renderContas(){
  let h = `<table><thead><tr><th class="lab">Conta</th>${Array.from({length:CORTE_M},(_,i)=>`<th>${MN[i+1]}</th>`).join('')}</tr></thead><tbody>`;
  h += `<tr><td class="lab">Sicredi CC</td>${Array.from({length:CORTE_M},(_,i)=>cell(SB.sicredi.fim['2026-0'+(i+1)])).join('')}</tr>`;
  h += `<tr><td class="lab">Nubank</td>${Array.from({length:CORTE_M},(_,i)=>cell(SB.nubank.fim['2026-0'+(i+1)])).join('')}</tr>`;
  h += `<tr class="tot"><td class="lab">Total</td>${Array.from({length:CORTE_M},(_,i)=>cell(saldoFim[i+1])).join('')}</tr>`;
  h += '</tbody></table>';
  document.getElementById('contas').innerHTML = h;
}
function renderReservas(){
  const kv = x => `<div class="kv"><span class="k">${x[0]}<small>${x[2]||''}</small></span><span class="v">${fmt(x[1])}</span></div>`;
  const sub = (t,a) => `<div class="kv tt"><span class="k">${t}</span><span class="v">${fmt(a.reduce((s,x)=>s+x[1],0))}</span></div>`;
  document.getElementById('reservas').innerHTML =
    D.reservas_liq.map(kv).join('') + sub('Disponível (resgatável)', D.reservas_liq) +
    '<div style="height:10px"></div>' +
    D.reservas_lp.map(kv).join('') + sub('Reserva de futuro (sem resgate)', D.reservas_lp);
}
function renderPatrimonio(){
  const P = D.patrimonio;
  let h = P.bens.map(x=>`<div class="kv"><span class="k">${x[0]}<small>${x[2]||''}</small></span><span class="v">${fmt(x[1])}</span></div>`).join('');
  h += `<div class="kv tt"><span class="k">Bens (${P.ref})</span><span class="v">${fmt(P.bens.reduce((s,x)=>s+x[1],0))}</span></div>`;
  h += P.dividas.map(x=>`<div class="kv"><span class="k">${x[0]}<small>${x[2]||''}</small></span><span class="v neg">${fmt(x[1])}</span></div>`).join('');
  const pl = P.bens.reduce((s,x)=>s+x[1],0)+P.dividas.reduce((s,x)=>s+x[1],0);
  h += `<div class="kv tt"><span class="k">Posição líquida declarada</span><span class="v${pl<0?' neg':''}">${fmt(pl)}</span></div>`;
  h += `<div class="note">${P.notas}</div>`;
  document.getElementById('patrimonio').innerHTML = h;
}
function renderAgenda(){
  document.getElementById('agenda').innerHTML = D.agenda.map(a=>
    `<li><span class="q">${a.q}<span class="f">${a.freq}</span></span><span class="v${a.v<0?' neg':''}">${a.v===null?'a definir':fmt(a.v)}</span></li>`).join('');
}
function renderPend(){
  document.getElementById('pendencias').innerHTML = D.pendencias.map(p=>`<li>${p}</li>`).join('');
}

// ---------- título / nota / orquestração ----------
function tituloPer(){
  if (per.t==='m') return MFULL[per.v]+' 2026';
  if (per.t==='t') return per.v+'º trimestre 2026';
  return 'ano 2026';
}
function render(){
  pills();
  const noNav = per.t==='y';
  const atMin = (per.t==='m'&&per.v===1)||(per.t==='t'&&per.v===1);
  const atMax = (per.t==='m'&&per.v===12)||(per.t==='t'&&per.v===4);
  document.getElementById('nprev').classList.toggle('off', noNav||atMin);
  document.getElementById('nnext').classList.toggle('off', noNav||atMax);

  const meses = mesesDo(per);
  document.getElementById('ftitulo').textContent = tituloPer() + ' · ' + centro;
  const st = document.getElementById('subtabs');
  st.style.display = per.t==='m' ? 'inline-flex' : 'none';
  st.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on', t.dataset.v===sub));
  const temReal = per.t==='m' && per.v<=CORTE_M;
  st.querySelectorAll('.tab').forEach(t=>{ if(t.dataset.v!=='resumo') t.style.display = temReal?'':'none'; });
  document.getElementById('flegend').innerHTML =
    per.t==='m'
    ? `<span><b>Previsto</b>: mediana dos meses fechados (jan–jul)${per.v>=9?' + agendado':''}${per.v<=CORTE_M?' — referência retroativa':''}</span><span><b>Realizado</b>: extratos${per.v===CORTE_M?' até 14/08':''}</span><span>Toque em Recebimentos/Pagamentos abre os grupos; no grupo, as contas; na conta, os lançamentos</span>`
    : `<span>Jan–Jul: realizado fechado · Ago¹: realizado até 14/08 · Set–Dez*: previsto</span>`;
  if (per.t!=='m') renderMeses(meses);
  else if (sub==='semanas' && temReal) renderSemanas(per.v);
  else if (sub==='dias' && temReal) renderDias(per.v);
  else renderResumo(meses);
  document.getElementById('fnota').innerHTML =
    (per.t==='m'&&per.v===CORTE_M? 'Agosto parcial: realizado até 14/08; o caixa no fim do mês mostrado é projeção (realizado + previsto proporcional dos dias restantes). ':'')+
    ((per.t==='m'&&[9,10,11].includes(per.v))? 'A lua de mel está escalonada na previsão: ~R$ 10 mil em set (hotéis), ~10 mil em out e ~10 mil em nov (gastos da viagem na fatura). O casamento é por conta dos pais. ':'')+
    'Faturas de cartão entram no dia do pagamento, abertas por categoria conforme a fatura; o Mastercard (encerrado, substituído pelo Visa) foi aberto por estimativa usando o mix de categorias do Visa de jan–mar. Captação e resgates estão zerados na previsão; aplicações carregam o DCA de Bitcoin (R$ 1,5 mil/mês, política de reserva de futuro).';
  renderBarras(meses);
}
document.getElementById('ptabs').addEventListener('click', e=>{
  const it = e.target.closest('[data-p]');
  if (it){ showPage(it.dataset.p); document.body.classList.remove('sb-open'); window.scrollTo(0,0); }
});
document.getElementById('subtabs').addEventListener('click', e=>{
  if (e.target.dataset.v){ sub = e.target.dataset.v; render(); }
});
document.getElementById('hcorte').textContent = '14/08/2026';
document.getElementById('fontes').innerHTML =
  `<b>Fontes:</b> extratos OFX Sicredi CC e Nubank (jan–14/ago/2026) · 7 faturas Visa Infinite (venc. fev–ago) e 8 faturas do cartão Nubank, todas conferidas contra o total declarado · IRPF 2026 (ano-base 2025). Regra de ouro: saldo inicial + recebimentos − pagamentos = saldo final real de cada conta, conciliado no centavo em 16 de 16 conta-mês. Transferências entre contas próprias são giro e ficam fora dos totais. Ferramenta gerada em 15/08/2026 — nenhum valor é digitado aqui; tudo deriva dos lançamentos embutidos.`;
// ================================================================
// Documentos — extratos, faturas e outros arquivos guardados no cofre
// ================================================================
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtBytes = n => n > 1048576 ? (n/1048576).toFixed(1)+' MB' : n > 1024 ? Math.round(n/1024)+' KB' : (n||0)+' B';
const TAM_MAX_ARQ = 3 * 1048576; // documentos maiores que isso estouram o armazenamento do navegador

function renderSync(){
  const h = Vault.dirtyLocal
    ? `<h2>Sincronização</h2>
       <p class="mini" style="margin-bottom:10px">Há alterações salvas <b>somente neste navegador</b> (usuários e/ou documentos).
       Para que valham em todos os dispositivos, baixe o arquivo atualizado e substitua o <b>dados.enc.json</b> na hospedagem.</p>
       <button class="btn" onclick="Vault.exportFile()">⬇ Baixar dados.enc.json atualizado</button>`
    : `<h2>Sincronização</h2>
       <p class="mini">Nenhuma alteração pendente — este navegador está igual ao arquivo publicado.
       Sempre que criar usuários ou adicionar documentos, aparece aqui o botão para baixar o arquivo atualizado.</p>`;
  for (const id of ['sync-card','sync-docs']){ const el = document.getElementById(id); if (el) el.innerHTML = h; }
}

function renderDocs(){
  const docs = Vault.data.docs || [];
  const el = document.getElementById('doc-lista');
  if (!docs.length){ el.innerHTML = '<p class="mini">Nenhum documento guardado ainda. Adicione o primeiro extrato acima.</p>'; renderSync(); return; }
  let h = '<table><thead><tr><th class="lab">Documento</th><th>Tipo</th><th>Referência</th><th>Tamanho</th><th>Adicionado</th><th></th></tr></thead><tbody>';
  for (const d of [...docs].sort((a,b)=> (b.ref||'').localeCompare(a.ref||'') || (b.add||'').localeCompare(a.add||''))){
    const ref = d.ref ? d.ref.slice(5,7)+'/'+d.ref.slice(0,4) : '·';
    h += `<tr><td class="lab">${esc(d.desc)||esc(d.nome)||'(sem descrição)'}${d.nome?`<div style="font-size:.68rem;color:var(--muted)">${esc(d.nome)}</div>`:''}</td>
      <td>${esc(d.t)}</td><td>${ref}</td><td>${fmtBytes(d.size)}</td><td>${d.add?d.add.slice(8,10)+'/'+d.add.slice(5,7)+'/'+d.add.slice(2,4):'·'}</td>
      <td style="white-space:nowrap"><button class="btn sm" onclick="docBaixar('${d.id}')">baixar</button>
      ${d.txt?`<button class="btn sm" onclick="docVer('${d.id}')">ver</button>`:''}
      <button class="btn sm danger" onclick="docExcluir('${d.id}')">excluir</button></td></tr>`;
  }
  el.innerHTML = h + '</tbody></table>';
  renderSync();
}

async function docAdd(){
  const msg = document.getElementById('doc-msg');
  const tipo = document.getElementById('doc-tipo').value;
  const ref  = document.getElementById('doc-ref').value;
  const desc = document.getElementById('doc-desc').value.trim();
  const file = document.getElementById('doc-file').files[0];
  const txt  = document.getElementById('doc-txt').value.trim();
  msg.textContent = '';
  if (!file && !txt){ msg.textContent = 'Anexe um arquivo ou cole o conteúdo do documento.'; return; }
  if (file && file.size > TAM_MAX_ARQ){ msg.textContent = `Arquivo muito grande (${fmtBytes(file.size)}). O limite é ${fmtBytes(TAM_MAX_ARQ)} — para arquivos maiores, guarde fora da ferramenta.`; return; }
  const doc = { id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random().toString(16).slice(2)),
    t: tipo, ref, desc, add: new Date().toISOString().slice(0,10) };
  if (file){
    doc.nome = file.name; doc.mime = file.type || 'application/octet-stream'; doc.size = file.size;
    doc.b64 = Vault.b64e(await file.arrayBuffer());
  } else {
    doc.txt = txt; doc.size = new Blob([txt]).size;
  }
  (Vault.data.docs = Vault.data.docs || []).push(doc);
  await Vault.save();
  document.getElementById('doc-desc').value = ''; document.getElementById('doc-file').value = ''; document.getElementById('doc-txt').value = '';
  msg.textContent = '✓ Documento guardado (criptografado). Baixe o dados.enc.json atualizado para sincronizar com a hospedagem.';
  renderDocs();
}

function docBaixar(id){
  const d = (Vault.data.docs||[]).find(x=>x.id===id); if (!d) return;
  const blob = d.b64 ? new Blob([Vault.b64d(d.b64)], {type:d.mime}) : new Blob([d.txt], {type:'text/plain;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = d.nome || ((d.desc||'documento').replace(/[^\w\d-]+/g,'-') + '.txt');
  a.click(); URL.revokeObjectURL(a.href);
}

function docVer(id){
  const d = (Vault.data.docs||[]).find(x=>x.id===id); if (!d || !d.txt) return;
  document.getElementById('mtit').textContent = d.desc || 'Documento';
  document.getElementById('msub').textContent = `${d.t}${d.ref? ' · '+d.ref.slice(5,7)+'/'+d.ref.slice(0,4):''}`;
  document.getElementById('mlist').innerHTML = `<li><pre style="white-space:pre-wrap;font-size:.72rem;max-height:50vh;overflow:auto">${esc(d.txt)}</pre></li>`;
  document.getElementById('modal').classList.add('on');
}

async function docExcluir(id){
  const d = (Vault.data.docs||[]).find(x=>x.id===id); if (!d) return;
  if (!confirm(`Excluir "${d.desc||d.nome}"? Essa ação não pode ser desfeita.`)) return;
  Vault.data.docs = Vault.data.docs.filter(x=>x.id!==id);
  await Vault.save(); renderDocs();
}

// ================================================================
// Acessos — usuários e senhas (admin cria/exclui; todos trocam a própria senha)
// ================================================================
function renderAcessos(){
  const isAdmin = Vault.user.role === 'admin';
  const el = document.getElementById('ac-lista');
  let h = '<table><thead><tr><th class="lab">Usuário</th><th>Nome</th><th>Papel</th><th>Criado em</th>' + (isAdmin?'<th></th>':'') + '</tr></thead><tbody>';
  for (const u of Vault.store.users){
    const eu = u.u === Vault.user.u;
    h += `<tr><td class="lab">${esc(u.u)}${eu?' <span style="color:var(--laranja);font-size:.7rem">(você)</span>':''}</td>
      <td>${esc(u.nome)}</td><td>${u.role==='admin'?'Administrador':'Usuário'}</td><td>${esc(u.criado||'·')}</td>
      ${isAdmin ? `<td>${eu?'·':`<button class="btn sm danger" onclick="acExcluir('${esc(u.u)}')">excluir</button>`}</td>` : ''}</tr>`;
  }
  el.innerHTML = h + '</tbody></table>';
  renderSync();
}

async function acCriar(){
  const msg = document.getElementById('ac-msg');
  const u = document.getElementById('ac-user').value.trim();
  const nome = document.getElementById('ac-nome').value.trim();
  const role = document.getElementById('ac-role').value;
  const p1 = document.getElementById('ac-pass').value, p2 = document.getElementById('ac-pass2').value;
  msg.textContent = '';
  if (!u || !nome){ msg.textContent = 'Preencha usuário e nome.'; return; }
  if (p1.length < 8){ msg.textContent = 'A senha precisa ter pelo menos 8 caracteres (quanto mais longa, melhor).'; return; }
  if (p1 !== p2){ msg.textContent = 'As senhas não conferem.'; return; }
  msg.textContent = 'Criando usuário…';
  try{
    await Vault.addUser(u, nome, role, p1);
    ['ac-user','ac-nome','ac-pass','ac-pass2'].forEach(i=>document.getElementById(i).value='');
    msg.textContent = `✓ Usuário "${u}" criado. Baixe o dados.enc.json atualizado (abaixo) para o acesso valer na hospedagem.`;
    renderAcessos();
  } catch(e){ msg.textContent = e.message; }
}

async function acExcluir(u){
  if (!confirm(`Excluir o acesso de "${u}"? A pessoa não conseguirá mais entrar.`)) return;
  try{ await Vault.delUser(u); renderAcessos(); }
  catch(e){ alert(e.message); }
}

async function pwTrocar(){
  const msg = document.getElementById('pw-msg');
  const o = document.getElementById('pw-old').value, n1 = document.getElementById('pw-new').value, n2 = document.getElementById('pw-new2').value;
  msg.textContent = '';
  if (n1.length < 8){ msg.textContent = 'A nova senha precisa ter pelo menos 8 caracteres.'; return; }
  if (n1 !== n2){ msg.textContent = 'As novas senhas não conferem.'; return; }
  msg.textContent = 'Alterando…';
  try{
    await Vault.changePass(o, n1);
    ['pw-old','pw-new','pw-new2'].forEach(i=>document.getElementById(i).value='');
    msg.textContent = '✓ Senha alterada. Baixe o dados.enc.json atualizado (abaixo) para valer na hospedagem e em outros aparelhos.';
    renderSync();
  } catch(e){ msg.textContent = e.message; }
}

document.getElementById('doc-add').addEventListener('click', docAdd);
document.getElementById('ac-add').addEventListener('click', acCriar);
document.getElementById('pw-change').addEventListener('click', pwTrocar);

renderContas(); renderReservas(); renderPatrimonio(); renderAgenda(); renderPend(); renderEstrategia(); renderPlano();
renderDocs(); renderAcessos();
render();
