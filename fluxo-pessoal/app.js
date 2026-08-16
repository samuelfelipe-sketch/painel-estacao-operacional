// Os dados chegam descriptografados pelo Vault (index.html) após o login.
const D = window.__VAULT_DATA__.D;

const MN = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MFULL = ['','janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const DIM = [0,31,28,31,30,31,30,31,31,30,31,30,31];
const ANO = +D.corte.slice(0,4);
const CM = {}; D.contas.forEach(c => CM[c.id] = c);
const GRUPOS_R = [...new Set(D.contas.filter(c=>c.tipo==='R').map(c=>c.grupo))];
const GRUPOS_P = [...new Set(D.contas.filter(c=>c.tipo==='P').map(c=>c.grupo))];
const mkey = m => ANO + '-' + String(m).padStart(2,'0');
const dbr = iso => iso.slice(8,10)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4);

// ---------- agregações a partir dos lançamentos ----------
// Recalculadas em recalcBase() — no boot e após cada importação de extrato.
let CORTE_M, CORTE_D, FECHADOS, R, MED, SB, saldoFim, saldoIniAno, saldoProj;

function mediana(arr){ const a=[...arr].sort((x,y)=>x-y); const n=a.length; return n%2? a[(n-1)/2] : (a[n/2-1]+a[n/2])/2; }
function prev(cid, m){
  let v = MED[cid];
  if (m > CORTE_M) {
    if (['captacao','resgates'].includes(cid)) v = 0;               // zerado até decisão
    if (cid==='aplic') v = -1500;                                    // DCA Bitcoin agendado (política Samuel)
    if (cid === 'viagens' && (m===9||m===10||m===11)) v = Math.min(v, 0) - 10000; // lua de mel escalonada 10k set/out/nov
    if (cid === 'master') v = MED['master'];
  }
  return v;
}
// previsão proporcional para o restante do mês parcial (corte D-1)
function mesRestante(cid){
  if (CORTE_D >= DIM[CORTE_M]) return 0;
  return prev(cid, Math.min(CORTE_M+1, 12)) * (DIM[CORTE_M] - CORTE_D) / DIM[CORTE_M];
}

function recalcBase(){
  CORTE_M = +D.corte.slice(5,7); CORTE_D = +D.corte.slice(8,10);
  FECHADOS = CORTE_D >= DIM[CORTE_M] ? CORTE_M : CORTE_M - 1;
  R = {};           // R[conta][mes] = realizado
  D.contas.forEach(c => R[c.id] = Array(13).fill(0));
  for (const l of D.lanc) {
    if (l.c === 'GIRO') continue;
    R[l.c][+l.d.slice(5,7)] += l.v;
  }
  MED = {}; D.contas.forEach(c => { MED[c.id] = mediana(R[c.id].slice(1, FECHADOS+1)); });

  // saldo total (contas monitoradas) no fim de cada mês
  SB = D.saldos;
  saldoFim = Array(13).fill(0);
  for (let m=1; m<=CORTE_M; m++) saldoFim[m] = (SB.sicredi.fim[mkey(m)]||0) + (SB.nubank.fim[mkey(m)]||0);
  saldoIniAno = SB.sicredi.ini_ano + SB.nubank.ini_ano;
  saldoProj = Array(13).fill(null);
  saldoProj[CORTE_M] = saldoFim[CORTE_M] + D.contas.reduce((s,c)=>s+mesRestante(c.id),0);
  for (let m=CORTE_M+1; m<=12; m++) saldoProj[m] = saldoProj[m-1] + D.contas.reduce((s,c)=>s+prev(c.id,m),0);
}
recalcBase();

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
  h += `<tr><td class="lab">Sicredi CC</td>${Array.from({length:CORTE_M},(_,i)=>cell(SB.sicredi.fim[mkey(i+1)])).join('')}</tr>`;
  h += `<tr><td class="lab">Nubank</td>${Array.from({length:CORTE_M},(_,i)=>cell(SB.nubank.fim[mkey(i+1)])).join('')}</tr>`;
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
    ? `<span><b>Previsto</b>: mediana dos meses fechados (jan–${MN[FECHADOS].toLowerCase()})${per.v>CORTE_M?' + agendado':''}${per.v<=CORTE_M?' — referência retroativa':''}</span><span><b>Realizado</b>: extratos${per.v===CORTE_M&&CORTE_D<DIM[CORTE_M]?' até '+D.corte.slice(8,10)+'/'+D.corte.slice(5,7):''}</span><span>Toque em Recebimentos/Pagamentos abre os grupos; no grupo, as contas; na conta, os lançamentos</span>`
    : `<span>Jan–${MN[FECHADOS]}: realizado fechado${FECHADOS<CORTE_M?` · ${MN[CORTE_M]}¹: realizado até ${D.corte.slice(8,10)+'/'+D.corte.slice(5,7)}`:''}${CORTE_M<12?` · ${MN[CORTE_M+1]}–Dez*: previsto`:''}</span>`;
  if (per.t!=='m') renderMeses(meses);
  else if (sub==='semanas' && temReal) renderSemanas(per.v);
  else if (sub==='dias' && temReal) renderDias(per.v);
  else renderResumo(meses);
  document.getElementById('fnota').innerHTML =
    (per.t==='m'&&per.v===CORTE_M&&CORTE_D<DIM[CORTE_M]? `${MFULL[CORTE_M][0].toUpperCase()+MFULL[CORTE_M].slice(1)} parcial: realizado até ${D.corte.slice(8,10)}/${D.corte.slice(5,7)}; o caixa no fim do mês mostrado é projeção (realizado + previsto proporcional dos dias restantes). `:'')+
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
function renderCabecalho(){
  document.getElementById('hcorte').textContent = dbr(D.corte);
  const nCM = Object.keys(SB.sicredi.fim).length + Object.keys(SB.nubank.fim).length;
  const hb = document.getElementById('hbadge'); if (hb) hb.textContent = `✓ Conciliado no centavo — ${nCM}/${nCM} conta-mês`;
  document.getElementById('fontes').innerHTML =
    `<b>Fontes:</b> extratos OFX Sicredi CC e Nubank (jan–${D.corte.slice(8,10)}/${MN[CORTE_M].toLowerCase()}/${ANO}) · faturas Visa Infinite e do cartão Nubank conferidas contra o total declarado · IRPF ${ANO} (ano-base ${ANO-1}). Regra de ouro: saldo inicial + recebimentos − pagamentos = saldo final real de cada conta, conciliado no centavo em ${nCM} de ${nCM} conta-mês. Transferências entre contas próprias são giro e ficam fora dos totais. Nenhum valor é digitado aqui; tudo deriva dos lançamentos e das importações conciliadas.`;
}
renderCabecalho();
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

// ================================================================
// Importador de extratos OFX — classifica, concilia e incorpora
// Regras portadas de pipeline/p3_pipeline.py (fonte da verdade).
// ================================================================
const round2 = v => Math.round(v*100)/100;

// ---- classificador: itens de cartão (cat_card) ----
function catCard(desc, val){
  const d = String(desc).toUpperCase();
  const has = (...ks) => ks.some(k => d.includes(k));
  if (has('IOF','ANUIDADE','TRANSACAO')) return 'fin';
  if (has('DEVOLUCAO')) return 'casa_mov';                    // devoluções ML/compras
  if (has('BENNU')) return 'restaurantes';                    // Estação Bennu = restaurante (não é posto)
  if (has('POSTO','SAPATAO','SAFYR','ABASTECEDORA','COMERCIAL DE COMBUST','SHELL','4 COLONIAS'))
    return (val == null || val > 180) ? 'combustivel' : 'mercado';  // ≤R$180 = conveniência (regra Samuel)
  if (has('RISSUL','BOURBON','MARANADOCE','QUEIJARIA','EMPORIO','BECKER HAUS','CACAU','KOPENHAGEN','VISTAMONTES','GROWTH')) return 'mercado';
  if (has('ZP NOBLE')) return 'casamento';
  if (has('JIM')) return 'vestuario';
  if (has('IFD','LOCATELLI','TOAST','GRILL','RESTAUR','ACAI','ALABAMA','BURGER','SUSHI','MAGATTA','MOKAI','CAFE','COFFEE','FEIJOADA','KACHURRASCO','CHURRASCARIA','AMECHICKEN','OH BRUDER','DI PAOLO','IL CAMPANAR','LEAO DO VALE','WJD','MERIDIANO','VIDEIRAS','ADEGA','BODEGA','PIZZAENTREVINHOS','CLANDESTINA','SCHWANTES','FERDAS','LUGU')) return 'restaurantes';
  if (has('APPLE','GOOGLE','YOUTUBE','MICROSOFT','SETAPP','PADDLE','HBO','MELIMAIS','LINKTREE','VIVO','ANTHROPIC','CLAUDE','AMAZON','TEMU','NOAR','HBL','SHELL BOX','EVINO','OLYMPIKUS','CPQ','LINKER','ATGF','ZARCOIN','MAQU','MERCADOLIVRE','MAGALU','QMS','CONECTC'))
    return has('APPLE','GOOGLE','YOUTUBE','MICROSOFT','SETAPP','PADDLE','HBO','MELIMAIS','LINKTREE','VIVO','ANTHROPIC','CLAUDE','AMAZON PRIME','HBL','SHELL BOX') ? 'assinaturas' : 'casa_mov';
  if (has('SAINT PAUL','COURSIV','KIWIFY','GREENN','GAL CONTEUDOS','AUDITHORIUM')) return 'educacao';
  if (has('PANVEL','FARMACIA','DROGARIA','LABORAT','DR PETTERSON','SANTE SPA','RDO','IMUNI','LILIANABEATRIZ')) return 'saude';
  if (has('PRUDENTIAL','PRUDENT')) return 'seguros';
  if (has('BROOKSFIELD','ARAMIS','CALCADOS','NORDWEG','LUPO','MINIMALCLUB','MISS PIJAMA','CASA ALBERTO','FRATEX','ANJINHOS','TNF','NORTH FACE')) return 'vestuario';
  if (has('ARMAZEM DO SOFA','IND','FORMAS','SCS','PETZ','COBASI','NATIVA','AGROPECUARIA','MAGO DAS CHAVES','HARTMANN','MAGALU')) return 'casa_mov';
  if (has('LBTRAVEL','BOOKING','HOTEL','MERCURE','WI FI','ONBOARD','DPSSA','VISTA IBIRAPUERA','SKYLINE','BUSLOG','RIO HOTEL','MICHELON','MICHEL','QMS','SMILES')) return 'viagens';
  if (has('UBER','ESTAPAR','PARK','PARE CERTO','INDIGO','ESTACIONAMENTO','AGE ','LYON','PEDAGIO','MONTE BIANCO','VOLTARE')) return 'pedagio';
  if (has('WEISS','PRO BIKE','VIC CENTER','ANDGO','LGND','CLICRUN','QUADRAS','TIKETO','TKTR','CLOVIS PIRES')) return 'esportes';
  if (has('RHEMA')) return 'doacoes';
  if (has('VEROO')) return 'mercado';
  if (has('CONSORCIO EMPREENDED')) return 'fin';
  if (has('KALITYCHI')) return 'esportes';                    // equipamentos bike/triathlon
  if (has('LUCIANA BORGES','FILIPEJESKE','ROSEMERI','ASSINY','LENDA VIVA')) return 'servicos';
  return 'servicos';
}

// ---- classificador: lançamentos bancários (cat_bank) ----
// retorna {kind:'giro'|'conta'|'fatura', c, cartao}
function catBank(memo, amt){
  const m = String(memo).toUpperCase();
  const has = (...ks) => ks.some(k => m.includes(k));
  if (m.includes('DEBITO TED/IB') && has('SAMUEL F')) return {kind:'conta', c:'aplic'};   // TED p/ conta própria não monitorada (XP)
  if (has('SAMUEL FE','SAMUEL F') && has('PIX','TED','TRANSF')) return {kind:'giro'};
  if (has('DEB TRANSF CC/PP','TRANSFERENCIA DA POUPANCA')) return {kind:'giro'};
  if (m.includes('PAGAMENTO DE FATURA')) return {kind:'fatura', cartao:'nucard'};
  if (m.includes('DEB.CTA.FATURA')) return {kind:'fatura', cartao:'visa'};
  if (has('PAGTO FATURA MASTER','EST PAGTO FATURA MASTER')) return {kind:'fatura', cartao:'master'};
  if (has('44245623000108','DORA ENOTURIS','VISTA VIGNETI','49256547000141','BELLMONTE','50567595000130')) return {kind:'conta', c:'casamento'};
  if (has('00273563025','30505111000110','24740724000130','08834195990','30595294000102')) return {kind:'conta', c:'casamento'};
  if (m.includes('52424421153')) return {kind:'conta', c:'impostos'};        // Eliana = cartório da compra do apto financiado
  if (m.includes('02335383051') || m.includes('HANGAR')) return {kind:'conta', c:'esportes'};
  if (m.includes('POSTO SAPATAO') || m.includes('43510250000184'))
    return {kind:'conta', c: Math.abs(amt) > 180 ? 'combustivel' : 'mercado'};
  if (m.includes('52109749000175')) return {kind:'conta', c:'casa_mov'};     // BBX Vidros = casa
  if (m.includes('00492547076')) return {kind:'conta', c:'restaurantes'};    // Marcelo Scheeren = chef
  if (m.includes('43403222000168')){                                          // SF Consultoria
    if (amt > 0) return {kind:'conta', c: Math.abs(amt-3341) < 2 ? 'prolabore' : 'lucros'};
    return {kind:'giro'};
  }
  if (has('APLIC. FINANC','APLIC FUNDOS')) return {kind:'conta', c:'aplic'};
  if (has('RESGATE APLIC')) return {kind:'conta', c:'resgates'};
  if (m.includes('PLANO INT CAPITAL')) return {kind:'conta', c:'aplic'};
  if (has('CREDITO CONSORCIO','LIBERACAO CREDITO')) return {kind:'conta', c:'captacao'};
  if (has('LIQUIDACAO DE PARCELA','LIQUIDACAO CONTRATO','DEBITO CONVENIOS-CONSORCIO')) return {kind:'conta', c:'amort'};
  if (m.includes('07808907') && amt < 0) return {kind:'conta', c:'amort'};   // boleto Adm Consórcio
  if (has('IOF','JUROS UTILIZ','TARIFA','ENC0')) return {kind:'conta', c:'fin'};
  if (m.includes('RGE')) return {kind:'conta', c:'energia'};
  if (has('26887377','BRWEB','05489384')) return {kind:'conta', c:'condominio'};
  if (has('DEFFERRARI','TELEF','08190344')) return {kind:'conta', c:'internet'};
  if (has('PMDOISI','88254883','ARRECADACAO ESTADUAL','GADE','DARF','GNRE')) return {kind:'conta', c:'impostos'};
  if (has('MAPFRE','TOKIOM')) return {kind:'conta', c:'seguros'};
  if (has('RHEMA','MINIS')) return {kind:'conta', c:'doacoes'};
  if (m.includes('26608804091') || m.includes('SERGIO') || m.includes('32961723000') || m.replace(/Ã/g,'').includes('IVANA'))
    return {kind:'conta', c: amt > 0 ? 'casamento' : 'familia'};             // créditos = ressarcimento casamento; débitos = empréstimo pai
  if (m.includes('33630661000150')) return {kind:'conta', c:'aplic'};        // Gowd/Latam Gateway = Pix p/ Binance (BTC)
  if (m.includes('78220394072')) return {kind:'conta', c:'esportes'};        // personal trainer
  if (has('PASSAGEM PEDAGIO','STAR PARK','ESTACI')) return {kind:'conta', c:'pedagio'};
  if (has('BIKE','VIC CENTER','WEISS')) return {kind:'conta', c:'esportes'};
  if (has('POUSADA','CAMILA MILANI')) return {kind:'conta', c:'viagens'};
  if (has('CAMISARIA')) return {kind:'conta', c:'vestuario'};
  if (has('VINHO')) return {kind:'conta', c:'restaurantes'};
  if (has('CLINI','IMUNI','NUTRI','GUEDES','44350888')) return {kind:'conta', c:'saude'};
  if (has('KIWIFY','EDUZZ','GREENN','ECOSS')) return {kind:'conta', c:'educacao'};
  if (has('SICREDI CASHB')) return {kind:'conta', c:'outras_ent'};
  if (has('RECEITA C','SECR. DA')) return {kind:'conta', c:'outras_ent'};
  if (amt > 0) return {kind:'conta', c:'outras_ent'};
  return {kind:'conta', c:'diversos', incerto:true};
}

// ---- parser OFX (SGML 1.x e XML 2.x — Sicredi e Nubank) ----
function parseOFX(text){
  const tag = (block, name) => {
    const m = block.match(new RegExp('<'+name+'>\\s*([^<\\r\\n]*)','i'));
    return m ? m[1].trim() : null;
  };
  const num = s => {
    if (s == null) return null;
    s = s.replace(/[^\d.,-]/g,'');
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g,'').replace(',','.');
    else if (s.includes(',')) s = s.replace(',','.');
    const v = parseFloat(s); return isNaN(v) ? null : v;
  };
  const dt = s => { const m = s && s.match(/(\d{4})(\d{2})(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

  const txs = [];
  for (const chunk0 of text.split(/<STMTTRN>/i).slice(1)){
    const chunk = chunk0.split(/<\/STMTTRN>|<\/BANKTRANLIST>|<LEDGERBAL>/i)[0];
    const d = dt(tag(chunk,'DTPOSTED')), v = num(tag(chunk,'TRNAMT'));
    if (d == null || v == null) continue;
    txs.push({ d, v: round2(v), m: tag(chunk,'MEMO') || tag(chunk,'NAME') || '', f: tag(chunk,'FITID') || null });
  }
  const ledgerBlock = (text.split(/<LEDGERBAL>/i)[1] || '');
  const ledger = num(tag(ledgerBlock,'BALAMT'));
  const dtasof = dt(tag(ledgerBlock,'DTASOF'));
  const dtend = dt(tag(text,'DTEND'));
  const bankid = tag(text,'BANKID') || '', org = (tag(text,'ORG') || '').toUpperCase();
  let acc = null;
  if (bankid.includes('748') || org.includes('SICREDI')) acc = 'sicredi';
  else if (bankid.includes('260') || org.includes('NU ') || org.includes('NUBANK') || org.includes('NU PAGAMENTOS')) acc = 'nubank';
  return { txs, ledger, dtasof, dtend, acc };
}

// ---- fatura: parser de itens colados (uma linha por compra, valor no fim) ----
function parseFaturaItens(text){
  const items = [];
  for (const raw of text.split(/\n/)){
    const line = raw.trim().replace(/[;,\t]+$/,'');
    if (!line) continue;
    const m = line.match(/(-?\s*(?:R\$\s*)?[\d][\d.,]*)\s*$/);
    if (!m) return { erro: `Não achei o valor no fim da linha: "${line.slice(0,50)}"` };
    let vs = m[1].replace(/\s|R\$/g,''), neg = vs.startsWith('-');
    vs = vs.replace('-','');
    if (vs.includes(',') && vs.includes('.')) vs = vs.replace(/\./g,'').replace(',','.');
    else if (vs.includes(',')) vs = vs.replace(',','.');
    const val = parseFloat(vs);
    if (isNaN(val)) return { erro: `Valor inválido na linha: "${line.slice(0,50)}"` };
    let desc = line.slice(0, m.index).replace(/[;,\t]+\s*$/,'').trim()
      .replace(/^\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*[-–]?\s*/,'').replace(/^\d{4}-\d{2}-\d{2}\s*/,'');
    if (!desc) desc = '(sem descrição)';
    const v = neg ? -val : val;
    items.push({ desc, val: round2(v), c: catCard(desc, v) });
  }
  return items.length ? { items } : { erro: 'Cole ao menos uma linha (descrição e valor).' };
}

// ---- estado da importação em revisão ----
let IMP = null;
const cellM = v => `<td class="${v<0?'neg':''}">${fmtMoeda(v)}</td>`;
const CARTAO_NOME = { visa:'Visa Infinite', nucard:'Cartão Nubank', master:'Mastercard' };
const ACC_NOME = { sicredi:'Sicredi CC', nubank:'Nubank' };

function cobertura(){
  if (!D.cobertura) D.cobertura = { sicredi: D.corte, nubank: D.corte };
  return D.cobertura;
}

async function impLer(){
  const msg = document.getElementById('imp-msg');
  const file = document.getElementById('imp-file').files[0];
  msg.textContent = ''; document.getElementById('imp-review').innerHTML = ''; IMP = null;
  if (!file){ msg.textContent = 'Escolha o arquivo OFX do extrato.'; return; }
  const text = await file.text();
  const p = parseOFX(text);
  const acc = document.getElementById('imp-acc').value || p.acc;
  if (!acc){ msg.textContent = 'Não reconheci o banco — escolha a conta (Sicredi ou Nubank) e tente de novo.'; return; }
  if (!p.txs.length){ msg.textContent = 'Nenhum lançamento encontrado no arquivo. É um OFX de extrato?'; return; }
  if (p.txs.some(t => +t.d.slice(0,4) !== ANO)){ msg.textContent = `Este arquivo tem lançamentos fora de ${ANO} — a ferramenta cobre ${ANO}.`; return; }

  const cob = cobertura()[acc];
  const fitsExist = new Set(D.lanc.map(l => l.f).filter(Boolean));
  const novos = p.txs.filter(t => t.d > cob && !(t.f && fitsExist.has(t.f))).sort((a,b)=>a.d.localeCompare(b.d));
  const ignorados = p.txs.length - novos.length;
  if (!novos.length){ msg.textContent = `Nada novo: os ${ignorados} lançamentos do arquivo já estão conciliados (cobertura da conta ${ACC_NOME[acc]} vai até ${dbr(cob)}).`; return; }

  const maxTx = novos[novos.length-1].d;
  const fimData = [p.dtend, p.dtasof, maxTx].filter(Boolean).sort().pop();
  const rows = novos.map(t => {
    const cl = catBank(t.m, t.v);
    return { ...t, kind: cl.kind, c: cl.kind==='giro' ? 'GIRO' : cl.c, cartao: cl.cartao || null, incerto: !!cl.incerto, fat: null };
  });
  IMP = { acc, rows, ledger: p.ledger, fimData, ignorados, arquivo: file.name, texto: text };
  impRender();
}

function optsConta(sel){
  let h = `<option value="GIRO" ${sel==='GIRO'?'selected':''}>— Giro entre contas (fora dos totais)</option>`;
  for (const tipo of ['R','P']){
    for (const g of (tipo==='R'?GRUPOS_R:GRUPOS_P)){
      const cs = D.contas.filter(c=>c.grupo===g && c.tipo===tipo);
      if (!cs.length) continue;
      h += `<optgroup label="${esc(g)}">` + cs.map(c=>`<option value="${c.id}" ${sel===c.id?'selected':''}>${esc(c.nome)}</option>`).join('') + '</optgroup>';
    }
  }
  return h;
}

function impConciliacao(){
  const somaNovos = round2(IMP.rows.reduce((s,r)=>s+r.v,0));
  const base = SB[IMP.acc].fim[mkey(+cobertura()[IMP.acc].slice(5,7))];
  const esperado = round2(base + somaNovos);
  const dif = IMP.ledger == null ? null : round2(IMP.ledger - esperado);
  return { somaNovos, base, esperado, dif };
}

function impRender(){
  const el = document.getElementById('imp-review');
  const faturasPendentes = IMP.rows.filter(r=>r.kind==='fatura' && !(r.fat && r.fat.ok)).length;
  let h = `<div class="note" style="margin-bottom:10px"><b>${ACC_NOME[IMP.acc]}</b> · ${esc(IMP.arquivo)} · ${IMP.rows.length} lançamento(s) novo(s)` +
    (IMP.ignorados ? ` · ${IMP.ignorados} já conciliado(s), ignorado(s)` : '') +
    ` · cobertura passa a ${dbr(IMP.fimData)}</div>`;
  h += '<div class="tbl-wrap"><table><thead><tr><th class="lab">Data · Descrição</th><th>Valor</th><th style="text-align:left">Categoria</th></tr></thead><tbody>';
  IMP.rows.forEach((r,i)=>{
    if (r.kind === 'fatura'){
      const status = r.fat && r.fat.ok
        ? `✓ ${r.fat.items.length} itens conferem${r.fat.ajuste?` (ajuste de ${fmtMoeda(r.fat.ajuste)} em Despesas financeiras)`:''}`
        : 'itens da fatura pendentes';
      h += `<tr><td class="lab" style="white-space:normal">${r.d.slice(8,10)}/${r.d.slice(5,7)} · ${esc(r.m.slice(0,60))}</td>${cellM(r.v)}<td style="text-align:left;font-size:.78rem">Fatura ${CARTAO_NOME[r.cartao]} — ${status}</td></tr>`;
      h += `<tr><td colspan="3" style="text-align:left;white-space:normal;background:#FBF9F2">`;
      if (!(r.fat && r.fat.ok)){
        h += `<div class="mini" style="margin:4px 0 6px">Regime de caixa: as compras desta fatura entram hoje (${r.d.slice(8,10)}/${r.d.slice(5,7)}), abertas por categoria. Cole abaixo os itens — uma linha por compra, valor no fim (ex.: <i>POSTO SAPATAO  81,40</i>). A soma deve bater com o pagamento (${fmtMoeda(-r.v)}).</div>
          <textarea id="imp-fat-${i}" rows="5" style="width:100%;font:inherit;font-size:.8rem;border:1px solid var(--borda);border-radius:8px;padding:8px"></textarea>
          <div style="margin-top:6px"><button class="btn sm" onclick="impFatura(${i})">Processar itens</button></div>
          <div class="mini" id="imp-fat-msg-${i}" style="margin-top:4px"></div>`;
      } else {
        h += `<table style="margin:4px 0">` + r.fat.items.map((it,j)=>
          `<tr><td class="lab" style="position:static;font-size:.78rem">${esc(it.desc.slice(0,45))}</td>${cellM(-it.val)}<td style="text-align:left"><select style="font-size:.75rem" onchange="IMP.rows[${i}].fat.items[${j}].c=this.value">${optsConta(it.c)}</select></td></tr>`).join('') +
          `</table><div style="margin-top:4px"><button class="btn sm" onclick="IMP.rows[${i}].fat=null;impRender()">refazer itens</button></div>`;
      }
      h += `</td></tr>`;
    } else {
      h += `<tr${r.kind==='giro'||r.c==='GIRO'?' style="opacity:.65"':''}><td class="lab" style="white-space:normal">${r.d.slice(8,10)}/${r.d.slice(5,7)} · ${esc(r.m.slice(0,60))}${r.incerto?' <span style="color:var(--laranja)">● conferir</span>':''}</td>${cellM(r.v)}<td style="text-align:left"><select style="font-size:.78rem;max-width:230px" onchange="IMP.rows[${i}].c=this.value">${optsConta(r.c)}</select></td></tr>`;
    }
  });
  h += '</tbody></table></div>';

  // conciliação no centavo
  const c = impConciliacao();
  h += `<div class="note" style="margin-top:10px"><b>Conciliação no centavo — ${ACC_NOME[IMP.acc]}</b><br>
    Saldo conciliado em ${dbr(cobertura()[IMP.acc])}: <b>${fmtMoeda(c.base)}</b> · movimento novo: <b>${fmtMoeda(c.somaNovos)}</b> · saldo esperado em ${dbr(IMP.fimData)}: <b>${fmtMoeda(c.esperado)}</b><br>`;
  if (c.dif == null){
    h += `O arquivo não traz o saldo final. Informe o saldo da conta em ${dbr(IMP.fimData)}: <input id="imp-saldo" type="text" inputmode="decimal" style="width:130px;font:inherit;border:1px solid var(--borda);border-radius:6px;padding:4px 8px" placeholder="ex.: 22.242,34"> <button class="btn sm" onclick="impSaldoManual()">verificar</button></div>`;
  } else if (Math.abs(c.dif) < 0.01){
    h += `Saldo do extrato: <b>${fmtMoeda(IMP.ledger)}</b> — <b style="color:#0E5C46">✓ conciliado no centavo</b>.</div>`;
  } else {
    h += `Saldo do extrato: <b>${fmtMoeda(IMP.ledger)}</b> — <b style="color:var(--vermelho)">diferença de ${fmtMoeda(c.dif)}</b>.<br>`;
    if (Math.abs(c.dif) <= 50){
      h += `<label style="font-weight:400"><input type="checkbox" id="imp-ajuste" onchange="impRenderBotao()"> Lançar a diferença como ${c.dif>0?'<b>Rendimentos</b> (ex.: rendimento NuConta sem linha no OFX)':'<b>Despesas financeiras</b>'} — ajuste de conciliação</label></div>`;
    } else {
      h += `Diferença grande demais para ajuste automático. Confira se não falta um extrato anterior (a cobertura desta conta vai até ${dbr(cobertura()[IMP.acc])}) ou se alguma categoria/fatura ficou de fora. A importação fica bloqueada até fechar no centavo.</div>`;
    }
  }
  h += `<div style="margin-top:10px;display:flex;gap:8px;align-items:center">
    <button class="btn" id="imp-conf" onclick="impConfirmar()">Confirmar importação</button>
    <button class="btn sm" onclick="IMP=null;document.getElementById('imp-review').innerHTML='';document.getElementById('imp-msg').textContent='Importação descartada.'">descartar</button>
  </div>`;
  el.innerHTML = h;
  IMP.podeBase = faturasPendentes === 0;
  impRenderBotao();
}

function fmtMoeda(v){ return (v<0?'−':'') + 'R$ ' + Math.abs(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }

function impRenderBotao(){
  const btn = document.getElementById('imp-conf'); if (!btn || !IMP) return;
  const c = impConciliacao();
  const ajusteOk = c.dif != null && Math.abs(c.dif) >= 0.01 && Math.abs(c.dif) <= 50 && document.getElementById('imp-ajuste') && document.getElementById('imp-ajuste').checked;
  const concOk = c.dif != null && (Math.abs(c.dif) < 0.01 || ajusteOk);
  btn.disabled = !(IMP.podeBase && concOk);
}

function impSaldoManual(){
  const s = document.getElementById('imp-saldo').value.trim();
  let vs = s.replace(/\s|R\$/g,'');
  if (vs.includes(',') && vs.includes('.')) vs = vs.replace(/\./g,'').replace(',','.');
  else if (vs.includes(',')) vs = vs.replace(',','.');
  const v = parseFloat(vs);
  if (isNaN(v)){ alert('Valor inválido.'); return; }
  IMP.ledger = round2(v);
  impRender();
}

function impFatura(i){
  const r = IMP.rows[i];
  const res = parseFaturaItens(document.getElementById('imp-fat-'+i).value);
  const msg = document.getElementById('imp-fat-msg-'+i);
  if (res.erro){ msg.textContent = res.erro; return; }
  const soma = round2(res.items.reduce((s,it)=>s+it.val,0));
  const dif = round2(Math.abs(r.v) - soma);   // pago − itens (residual de centavos vira Despesas financeiras)
  if (Math.abs(dif) > 1.00){
    msg.textContent = `A soma dos itens (${fmtMoeda(soma)}) não bate com o pagamento (${fmtMoeda(Math.abs(r.v))}) — diferença de ${fmtMoeda(dif)}. Confira as linhas.`;
    return;
  }
  r.fat = { items: res.items, ok: true, ajuste: Math.abs(dif) >= 0.01 ? dif : 0 };
  impRender();
}

function impConfirmar(){
  if (!IMP) return;
  const acc = IMP.acc, cob = cobertura();
  const antes = cob[acc];
  const c = impConciliacao();

  for (const r of IMP.rows){
    if (r.kind === 'fatura' && r.fat && r.fat.ok){
      for (const it of r.fat.items)
        D.lanc.push({ d:r.d, v:round2(-it.val), c:it.c, o:r.cartao, m:it.desc.slice(0,60) });
      if (r.fat.ajuste) D.lanc.push({ d:r.d, v:round2(-r.fat.ajuste), c:'fin', o:r.cartao, m:'Ajuste centavos fatura' });
    } else {
      D.lanc.push({ d:r.d, v:r.v, c:r.c, o:acc, m:r.m.slice(0,60), ...(r.f?{f:r.f}:{}) });
    }
  }
  if (c.dif != null && Math.abs(c.dif) >= 0.01){
    D.lanc.push({ d:IMP.fimData, v:c.dif, c: c.dif>0?'rendimentos':'fin', o:acc,
      m:'Ajuste de conciliação (importação '+dbr(IMP.fimData)+')' });
  }
  D.lanc.sort((a,b)=>a.d.localeCompare(b.d));

  // saldos de fim de mês da conta, rolando do último ponto conciliado até a nova cobertura
  const mapAcc = l => l.o===acc || (acc==='sicredi' && (l.o==='visa'||l.o==='master')) || (acc==='nubank' && l.o==='nucard');
  let bal = SB[acc].fim[mkey(+antes.slice(5,7))];
  for (let m = +antes.slice(5,7); m <= +IMP.fimData.slice(5,7); m++){
    const soma = D.lanc.filter(l => mapAcc(l) && +l.d.slice(5,7)===m && l.d > antes && l.d <= IMP.fimData)
      .reduce((s,l)=>s+l.v, 0);
    bal = round2(bal + soma);
    SB[acc].fim[mkey(m)] = bal;
  }

  cob[acc] = IMP.fimData;
  const novoCorte = [cob.sicredi, cob.nubank].sort()[0];
  if (novoCorte > D.corte) D.corte = novoCorte;

  // guarda o próprio OFX no arquivo de documentos (criptografado)
  (D.docs = D.docs||[]).push({ id:(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)),
    t:'Extrato bancário (OFX)', ref:IMP.fimData.slice(0,7), desc:`Extrato ${ACC_NOME[acc]} importado até ${dbr(IMP.fimData)}`,
    txt:IMP.texto, size:new Blob([IMP.texto]).size, add:D.corte });

  const resumo = `✓ ${IMP.rows.length} lançamento(s) incorporados e conciliados no centavo. Cobertura ${ACC_NOME[acc]}: ${dbr(cob[acc])}. ` +
    (cob.sicredi !== cob.nubank
      ? `O corte geral segue em ${dbr(D.corte)} — importe também o extrato da outra conta (${cob.sicredi < cob.nubank ? 'Sicredi' : 'Nubank'}) para avançar.`
      : `Corte geral atualizado para ${dbr(D.corte)}.`);
  IMP = null;
  document.getElementById('imp-review').innerHTML = '';
  document.getElementById('imp-file').value = '';
  document.getElementById('imp-msg').textContent = resumo + ' Baixe o dados.enc.json atualizado (card Sincronização) para valer em todos os aparelhos.';

  Vault.save().then(()=>{
    recalcBase();
    renderCabecalho(); renderContas(); renderDocs(); render();
  });
}

document.getElementById('imp-ler').addEventListener('click', impLer);
document.getElementById('doc-add').addEventListener('click', docAdd);
document.getElementById('ac-add').addEventListener('click', acCriar);
document.getElementById('pw-change').addEventListener('click', pwTrocar);

renderContas(); renderReservas(); renderPatrimonio(); renderAgenda(); renderPend(); renderEstrategia(); renderPlano();
renderDocs(); renderAcessos();
render();
