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
let CORTE_M, CORTE_D, FECHADOS, R, MED, MEDC, FPROJ, PERFIL, SB, saldoFim, saldoIniAno, saldoProj;

function mediana(arr){ const a=[...arr].sort((x,y)=>x-y); const n=a.length; return n%2? a[(n-1)/2] : (a[n/2-1]+a[n/2])/2; }

// marcador de parcela nas descrições de cartão: "01/03", "PARC 2/6", "(1/3)"…
function parseParcela(txt){
  let best = null;
  for (const m of String(txt).matchAll(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/g)){
    const k = +m[1], n = +m[2];
    if (k >= 1 && n >= 2 && k <= n && n <= 24) best = { k, n };
  }
  return best;
}

const CARDS = ['visa','nucard','master'];
// tipico=true ignora faturas guardadas/parcelas (usado no rateio do mês parcial)
function prev(cid, m, tipico){
  let v = MED[cid];
  if (m > CORTE_M) {
    // agendados da previsão vêm do cofre criptografado (D.agendados)
    const ag = D.agendados; let travado = false;
    if (ag){
      if ((ag.zerar||[]).includes(cid)){ v = 0; travado = true; }
      if (ag.fixos && cid in ag.fixos){ v = ag.fixos[cid]; travado = true; }
      for (const e of (ag.extras||[])) if (e.c === cid && e.meses.includes(m)) v = Math.min(v, 0) + e.v;
    }
    // compromissos conhecidos dos cartões: fatura guardada substitui o componente
    // típico do cartão no mês do pagamento; parcelas futuras garantem piso conhecido
    if (!tipico && !travado && FPROJ){
      for (const card of CARDS){
        const full = FPROJ.full[m] && FPROJ.full[m][card];
        const parc = FPROJ.parc[m] && FPROJ.parc[m][card];
        const tip = (MEDC[card] && MEDC[card][cid]) || 0;
        if (full) v = v - tip + (full[cid] || 0);
        else if (parc && parc[cid] != null) v = v - tip + Math.min(tip, parc[cid]);
      }
    }
  }
  return v;
}
// previsão proporcional para o restante do mês parcial (corte D-1)
function mesRestante(cid){
  if (CORTE_D >= DIM[CORTE_M]) return 0;
  return prev(cid, Math.min(CORTE_M+1, 12), true) * (DIM[CORTE_M] - CORTE_D) / DIM[CORTE_M];
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

  // perfil intramensal: em que dia do mês cada conta costuma acontecer, pelo
  // histórico dos meses fechados — usado para distribuir a projeção nas semanas
  PERFIL = {}; const perfAbs = {};
  D.contas.forEach(c => { PERFIL[c.id] = Array(32).fill(0); perfAbs[c.id] = 0; });
  for (const l of D.lanc){
    if (l.c === 'GIRO' || +l.d.slice(5,7) > FECHADOS) continue;
    PERFIL[l.c][+l.d.slice(8,10)] += Math.abs(l.v);
    perfAbs[l.c] += Math.abs(l.v);
  }
  D.contas.forEach(c => { PERFIL[c.id] = perfAbs[c.id] > 0 ? PERFIL[c.id].map(v => v/perfAbs[c.id]) : null; });

  // mediana do componente de cada cartão por categoria (p/ trocar típico por conhecido)
  const RC = {}; CARDS.forEach(cd => { RC[cd] = {}; D.contas.forEach(c => RC[cd][c.id] = Array(13).fill(0)); });
  for (const l of D.lanc){
    if (l.c === 'GIRO' || !RC[l.o]) continue;
    RC[l.o][l.c][+l.d.slice(5,7)] += l.v;
  }
  MEDC = {}; CARDS.forEach(cd => { MEDC[cd] = {}; D.contas.forEach(c => {
    MEDC[cd][c.id] = FECHADOS > 0 ? mediana(RC[cd][c.id].slice(1, FECHADOS+1)) : 0; }); });

  // compromissos conhecidos: fatura guardada projeta o pagamento no mês seguinte
  // ao de referência; parcelas k/n projetam as próximas nos meses subsequentes
  FPROJ = { full:{}, parc:{}, venc:{} };
  const addF = (bag, m, card, cid, v) => {
    if (m < 1 || m > 12) return;
    (bag[m] = bag[m] || {}); (bag[m][card] = bag[m][card] || {});
    bag[m][card][cid] = (bag[m][card][cid] || 0) + v;
  };
  for (const p of (D.fat_pend || [])){
    let P = null;   // mês do pagamento: vencimento real quando conhecido; senão, mês seguinte ao de referência
    if (p.venc && +p.venc.slice(0,4) === ANO) P = +p.venc.slice(5,7);
    else if (p.ref && +p.ref.slice(0,4) === ANO) P = +p.ref.slice(5,7) + 1;
    if (P == null) continue;
    for (const it of p.items){
      addF(FPROJ.full, P, p.cartao, it.c, -it.val);
      const pc = it.parc || parseParcela(it.desc);
      if (pc) for (let j = 1; j <= pc.n - pc.k; j++) addF(FPROJ.parc, P + j, p.cartao, it.c, -it.val);
    }
    if (p.venc && P >= 1 && P <= 12) (FPROJ.venc[P] = FPROJ.venc[P] || {})[p.cartao] = +p.venc.slice(8,10);
  }
  // parcelas de faturas já incorporadas (lançamentos de cartão com marcador k/n)
  for (const l of D.lanc){
    if (l.c === 'GIRO' || !MEDC[l.o]) continue;
    const pc = parseParcela(l.m || '');
    if (!pc) continue;
    const m0 = +l.d.slice(5,7);
    for (let j = 1; j <= pc.n - pc.k; j++){
      const mj = m0 + j;
      if (FPROJ.full[mj] && FPROJ.full[mj][l.o]) continue;   // fatura guardada desse mês é a fonte
      addF(FPROJ.parc, mj, l.o, l.c, l.v);
    }
  }

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
    h += '</optgroup><optgroup label="Ano"><option value="y:0">2026 completo</option><option value="y27:0">2027 — projeção</option></optgroup>';
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
  for (const k of ['fluxo','plano','patri','estr','pend','docs','config']){
    const el = document.getElementById('page-'+k);
    if (el) el.style.display = k===p?'':'none';
  }
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

// ---------- 2027: projeção com premissas de crescimento ----------
// Base: mediana dos meses fechados de 2026, com as políticas dos agendados
// (contas zeradas e valores fixos como o DCA). Sobre a base, aplicam-se as
// premissas guardadas no cofre: crescimento da renda (grupo Renda) e
// reajuste das demais receitas/despesas. Extras pontuais de 2026 não repetem.
function proj27Cfg(){ return D.proj27 || { renda: 10, desp: 5 }; }
function prev27(cid){
  let v = MED[cid];
  const ag = D.agendados;
  if (ag){
    if ((ag.zerar||[]).includes(cid)) return 0;
    if (ag.fixos && cid in ag.fixos) return ag.fixos[cid];
  }
  const cfg = proj27Cfg(), c = CM[cid];
  if (c.tipo === 'R' && c.grupo === 'Renda') return v * (1 + (cfg.renda||0)/100);
  if (c.tipo === 'P') return v * (1 + (cfg.desp||0)/100);
  return v;
}
async function p27Salvar(){
  const num = id => { const v = parseFloat(document.getElementById(id).value.replace(',','.')); return isNaN(v) ? 0 : v; };
  D.proj27 = { renda: num('p27-renda'), desp: num('p27-desp') };
  await Vault.save();
  const msg = document.getElementById('p27-msg');
  if (msg) msg.textContent = '✓ Premissas aplicadas — a visão "2027 — projeção" já reflete os novos percentuais.';
  render();
}
// preenche os formulários de Configurações com o que está guardado no cofre
function renderConfigForms(){
  const p = proj27Cfg(), m = metasCfg();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('p27-renda', p.renda); set('p27-desp', p.desp);
  set('mt-meses', m.emerg_meses); set('mt-meta1', m.emerg_meta1); set('mt-alvo', m.alvo); set('mt-rend', m.rend_aa);
}
function renderAno27(){
  const meses = [1,2,3,4,5,6,7,8,9,10,11,12];
  const cs = contasAtivas();
  const cfg = proj27Cfg();
  // premissas em modo leitura — o ajuste vive na aba Configurações
  document.getElementById('fcontrols').innerHTML =
    `<div class="mini" style="margin-bottom:10px">Premissas: renda <b>${cfg.renda>=0?'+':''}${cfg.renda}%</b> · despesas <b>${cfg.desp>=0?'+':''}${cfg.desp}%</b> ao ano — ajuste na aba <b>Configurações</b>.</div>`;
  let h = `<table><thead><tr><th class="lab"></th>${meses.map(m=>`<th>${MN[m]}*</th>`).join('')}<th>Ano</th></tr></thead><tbody>`;
  const linha27 = (nome, ids, cls, extra, labExtra) => {
    const vm = ids.reduce((s,c)=>s+prev27(c.id),0);
    if (cls==='sub' && Math.round(Math.abs(vm*12))===0) return '';
    return `<tr class="${cls}" ${extra||''}><td class="lab" ${labExtra||''}>${nome}</td>${meses.map(()=>cell(vm,'prevcol')).join('')}${cell(vm*12,'prevcol')}</tr>`;
  };
  const iniAno = saldoProj[12];
  const fluxoTot = D.contas.reduce((s,c)=>s+prev27(c.id),0);
  h += `<tr class="caixa"><td class="lab">Caixa no início</td>${meses.map((m,i)=>cell(iniAno + fluxoTot*i, 'prevcol')).join('')}<td>·</td></tr>`;
  const recIds = cs.filter(c=>c.tipo==='R'), pagIds = cs.filter(c=>c.tipo==='P');
  const bloco = (grupos, pool) => {
    for (const g of grupos){
      const ids = pool.filter(c=>c.grupo===g); if (!ids.length) continue;
      h += linha27(g, ids, 'grp'+(abertos.has(g)?' open':''), `onclick="tg('${g}')"`);
      if (abertos.has(g)) for (const c of ids) h += linha27(c.nome, [c], 'sub', '', '');
    }
  };
  h += linha27('Recebimentos', recIds, 'tot sec'+(secs.has('R')?' open':''), `onclick="tgSec('R')"`);
  if (secs.has('R')) bloco(GRUPOS_R, recIds);
  h += linha27('Pagamentos', pagIds, 'tot sec'+(secs.has('P')?' open':''), `onclick="tgSec('P')"`);
  if (secs.has('P')) bloco(GRUPOS_P, pagIds);
  h += linha27('FLUXO DE CAIXA', cs, 'fluxo');
  h += `<tr class="caixa"><td class="lab">Caixa no fim</td>${meses.map(m=>cell(iniAno + fluxoTot*m, 'prevcol')).join('')}<td>·</td></tr>`;
  h += '</tbody></table>';
  document.getElementById('ftabela').innerHTML = h;
}

// fração do previsto de uma conta que cai nos dias [a..b]: segue o padrão
// histórico do dia do mês em que a conta costuma acontecer (pró-labore,
// contas fixas, DCA…), com o perfil normalizado na janela projetada
// [ini..fim]; sem histórico, rateio uniforme. Os totais do mês não mudam.
function perfilFaixa(cid, a, b, ini, fim){
  const dp = Math.max(0, Math.min(b, fim) - Math.max(a, ini) + 1);
  if (dp <= 0) return 0;
  const p = PERFIL[cid];
  if (!p) return dp / (fim - ini + 1);
  let mass = 0, tot = 0;
  for (let d = ini; d <= fim; d++){
    let f = p[d] || 0;
    if (d === fim) for (let x = fim+1; x <= 31; x++) f += p[x] || 0;   // dias 29–31 caem no último dia do mês
    tot += f;
    if (d >= a && d <= b) mass += f;
  }
  if (tot < 1e-9) return dp / (fim - ini + 1);
  return mass / tot;
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
  const proj = m > CORTE_M;                              // mês inteiro projetado
  const parcial = m === CORTE_M && CORTE_D < DIM[m];     // mês corrente com dias restantes
  const diasProj = ([a,b]) => proj ? (b-a+1) : parcial ? Math.max(0, b - Math.max(a-1, CORTE_D)) : 0;

  // faturas guardadas pagas neste mês: valor conhecido entra na semana do vencimento
  const fatW = {};
  if (proj && FPROJ.full[m]) for (const card of CARDS){
    const f = FPROJ.full[m][card]; if (!f) continue;
    const dia = (FPROJ.venc[m] && FPROJ.venc[m][card]) || 10;
    for (const cid in f) (fatW[cid] = fatW[cid]||[]).push({ v: f[cid], dia });
  }
  const fatTot = cid => (fatW[cid]||[]).reduce((s,x)=>s+x.v,0);

  const somaReal = (ids,[a,b]) => proj ? 0 : D.lanc.reduce((s,l)=>{
    if(l.c==='GIRO') return s; const lm=+l.d.slice(5,7), ld=+l.d.slice(8,10);
    if(lm!==m||ld<a||ld>b) return s; return ids.some(c=>c.id===l.c)? s+l.v : s; },0);
  const perfilSemana = (cid, [a,b]) => perfilFaixa(cid, a, b, proj ? 1 : CORTE_D + 1, DIM[m]);
  const somaPrev = (ids,s) => { if (!diasProj(s)) return 0;
    return ids.reduce((sum,c)=>{
      if (proj){
        let v = (prev(c.id, m) - fatTot(c.id)) * perfilSemana(c.id, s);
        for (const x of (fatW[c.id]||[])) if (x.dia >= s[0] && x.dia <= s[1]) v += x.v;
        return sum + v;
      }
      // mês parcial: o restante previsto do mês (mesma régua do caixa projetado), no padrão histórico
      const restante = prev(c.id, Math.min(CORTE_M+1,12), true) * (DIM[m]-CORTE_D) / DIM[m];
      return sum + restante * perfilSemana(c.id, s);
    }, 0); };
  const somaSem = (ids,s) => somaReal(ids,s) + somaPrev(ids,s);
  const colPrev = s => diasProj(s) > 0;

  let h = `<table><thead><tr><th class="lab"></th>${sem.map(s=>`<th>${String(s[0]).padStart(2,'0')}–${String(s[1]).padStart(2,'0')}${colPrev(s)?'*':''}</th>`).join('')}<th>Total</th></tr></thead><tbody>`;
  let saldoIni = saldoNoInicio(m);
  h += `<tr class="caixa"><td class="lab">Caixa no início</td>${sem.map(s => { const c = cell(saldoIni, colPrev(s)?'prevcol':''); saldoIni += somaSem(D.contas, s); return c; }).join('')}<td>·</td></tr>`;
  const lr = (nome, ids, cls, skipVazio, extra, labExtra) => { const vs=sem.map(s=>somaSem(ids,s)); const t=vs.reduce((a,b)=>a+b,0);
    if (skipVazio && Math.round(Math.abs(t))===0) return '';
    return `<tr class="${cls}" ${extra||''}><td class="lab" ${labExtra||''}>${nome}</td>${vs.map((v,i)=>cell(v, colPrev(sem[i])?'prevcol':'')).join('')}${cell(t)}</tr>`; };
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
  // caixa ao fim de cada semana — sempre consolidado, como na visão mensal
  let saldo = saldoNoInicio(m);
  const caixaCells = sem.map(s => { saldo += somaSem(D.contas, s); return cell(saldo, colPrev(s)?'prevcol':''); }).join('');
  h += `<tr class="caixa"><td class="lab">Caixa no fim</td>${caixaCells}${cell(saldo)}</tr>`;
  h += '</tbody></table>';
  document.getElementById('ftabela').innerHTML = h;
}

// ---------- dias ----------
function renderDias(m){
  const cAtivas = contasAtivas();
  const cs = new Set(cAtivas.map(c=>c.id));
  const proj = m > CORTE_M;
  const parcial = m === CORTE_M && CORTE_D < DIM[m];
  const dias = {};
  if (!proj) for (const l of D.lanc){
    if (l.c==='GIRO' || +l.d.slice(5,7)!==m || !cs.has(l.c)) continue;
    const d=+l.d.slice(8,10); dias[d]=dias[d]||{r:0,p:0};
    l.v>0? dias[d].r+=l.v : dias[d].p+=l.v;
  }
  // dias sem extrato: estimativa pelo padrão histórico de cada conta,
  // com faturas guardadas cravadas no dia do vencimento
  const limReal = proj ? 0 : (m===CORTE_M ? CORTE_D : DIM[m]);
  const ini = proj ? 1 : CORTE_D + 1;
  const totProj = {}, fatDia = {};
  if (proj || parcial){
    for (const c of cAtivas)
      totProj[c.id] = proj ? prev(c.id, m)
        : prev(c.id, Math.min(CORTE_M+1,12), true) * (DIM[m]-CORTE_D)/DIM[m];
    if (proj && FPROJ.full[m]) for (const card of CARDS){
      const f = FPROJ.full[m][card]; if (!f) continue;
      const dia = Math.min((FPROJ.venc[m] && FPROJ.venc[m][card]) || 10, DIM[m]);
      for (const cid in f){
        if (!cs.has(cid)) continue;
        totProj[cid] = (totProj[cid]||0) - f[cid];   // sai da distribuição por padrão…
        fatDia[dia] = fatDia[dia]||{r:0,p:0};
        f[cid]>0? fatDia[dia].r+=f[cid] : fatDia[dia].p+=f[cid];   // …e entra no dia do vencimento
      }
    }
  }
  let saldo = saldoNoInicio(m);
  let h = `<table><thead><tr><th class="lab">Dia</th><th>Entradas</th><th>Saídas</th><th>Fluxo</th><th>Caixa</th></tr></thead><tbody>`;
  h += `<tr class="caixa"><td class="lab">Caixa no início</td><td>·</td><td>·</td><td>·</td>${cell(saldo)}</tr>`;
  for (let d=1; d<=DIM[m]; d++){
    const isProj = d > limReal;
    let r=0, p=0;
    if (!isProj){ const x = dias[d]||{r:0,p:0}; r=x.r; p=x.p; }
    else if (proj || parcial){
      for (const c of cAtivas){
        const v = (totProj[c.id]||0) * perfilFaixa(c.id, d, d, ini, DIM[m]);
        v>0? r+=v : p+=v;
      }
      if (fatDia[d]){ r+=fatDia[d].r; p+=fatDia[d].p; }
    } else break;
    const f=r+p; saldo+=f;
    if (Math.round(Math.abs(r))===0 && Math.round(Math.abs(p))===0) continue;
    const cls = isProj ? 'prevcol' : '';
    h += `<tr><td class="lab">${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')} · ${['dom','seg','ter','qua','qui','sex','sáb'][new Date(2026,m-1,d).getDay()]}${isProj?' *':''}</td>${cell(r,cls)}${cell(p,cls)}${cell(f,cls)}${cell(saldo,cls)}</tr>`;
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
  const ano27 = per.t==='y27';
  const temReal = !ano27 && meses.some(m=>m<=CORTE_M);
  const gs = GRUPOS_P.map(g=>{
    const ids = contasAtivas().filter(c=>c.grupo===g&&c.tipo==='P');
    const v = ano27 ? ids.reduce((s,c)=>s+12*prev27(c.id),0)
      : temReal ? ids.reduce((s,c)=>s+realPer(c.id,meses),0) : ids.reduce((s,c)=>s+prevPer(c.id,meses),0);
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
// ---------- metas: reserva de emergência e 1º milhão ----------
function metasCfg(){ return Object.assign({ emerg_meses: 6, emerg_meta1: 3, alvo: 1000000, rend_aa: 0 }, D.metas || {}); }
async function metasSalvar(){
  const num = id => { const v = parseFloat(document.getElementById(id).value.replace(/\./g,'').replace(',','.')); return isNaN(v) ? 0 : v; };
  D.metas = { emerg_meses: num('mt-meses') || 6, emerg_meta1: num('mt-meta1') || 3, alvo: num('mt-alvo') || 1000000, rend_aa: num('mt-rend') };
  await Vault.save();
  const msg = document.getElementById('mt-msg');
  if (msg) msg.textContent = '✓ Metas aplicadas — o progresso atualizado está na aba Patrimônio.';
  renderMetas();
}
function renderMetas(){
  const el = document.getElementById('metas'); if (!el) return;
  const cfg = metasCfg();
  // custo essencial mensal: mediana dos meses fechados, sem aplicações
  // nem eventos do ano (casamento e viagens) — a régua honesta da emergência
  const NAO_ESSENCIAL = ['aplic','casamento','viagens'];
  const desp = [];
  for (let mm = 1; mm <= FECHADOS; mm++){
    let s = 0;
    for (const c of D.contas) if (c.tipo === 'P' && !NAO_ESSENCIAL.includes(c.id)) s += R[c.id][mm];
    desp.push(-s);
  }
  const despRef = desp.length ? mediana(desp) : 0;
  const liq = D.reservas_liq.reduce((s,x)=>s+x[1],0);
  const lp = D.reservas_lp.reduce((s,x)=>s+x[1],0);
  const caixa = saldoFim[CORTE_M] || 0;

  // reserva de emergência: só o que resgata em até D+30 (4º campo da reserva);
  // item sem prazo declarado conta, por compatibilidade. Caixa em conta fica fora.
  const prazo = x => x.length > 3 ? x[3] : 0;
  const liq30 = D.reservas_liq.filter(x => prazo(x) <= 30).reduce((s,x)=>s+x[1],0);
  const liq5 = D.reservas_liq.filter(x => prazo(x) <= 5).reduce((s,x)=>s+x[1],0);
  const alvoE = cfg.emerg_meses * despRef;
  const alvoE1 = cfg.emerg_meta1 * despRef;
  const mesesCob = despRef > 0 ? liq30 / despRef : 0;
  const meta1Ok = liq30 >= alvoE1;
  const pctE = alvoE1 > 0 ? Math.min(100, 100 * liq30 / (meta1Ok ? alvoE : alvoE1)) : 0;

  // 1º milhão: patrimônio financeiro (caixa + reservas) crescendo no ritmo projetado
  const fluxoTipico = D.contas.reduce((s,c)=>s+prev(c.id, Math.min(CORTE_M+1,12), true),0);
  const aplicMes = -(((D.agendados||{}).fixos||{}).aplic || 0);
  const ritmo = fluxoTipico + aplicMes;   // sobra de caixa + o que já vai para a reserva
  const P0 = caixa + liq + lp;
  const pctM = Math.min(100, 100 * P0 / cfg.alvo);
  let quando = null, faltam = null;
  if (P0 >= cfg.alvo) quando = 'meta já atingida ✓';
  else if (ritmo > 0){
    const i = cfg.rend_aa > 0 ? Math.pow(1 + cfg.rend_aa/100, 1/12) - 1 : 0;
    let P = P0, n = 0;
    while (P < cfg.alvo && n < 600){ P = P * (1 + i) + ritmo; n++; }
    if (n < 600){
      faltam = n;
      const mAbs = CORTE_M - 1 + n, ano = ANO + Math.floor(mAbs / 12), mes = (mAbs % 12) + 1;
      quando = `~${MN[mes].toLowerCase()}/${ano} (${n >= 12 ? Math.floor(n/12)+' ano'+(n>=24?'s':'')+(n%12?' e '+(n%12)+' mes'+(n%12>1?'es':''):'') : n+' meses'})`;
    }
  }
  const barra = (pct, cor) => `<span style="flex:1;height:16px;background:#F0EDE4;border-radius:4px;overflow:hidden;display:block"><span style="display:block;height:100%;width:${pct.toFixed(1)}%;background:${cor||'var(--laranja)'};border-radius:4px;min-width:2px"></span></span>`;

  let h = `<div class="kv tt"><span class="k">Reserva de emergência<small>só o que resgata em até D+30 · custo essencial (mediana ${ANO}, sem aplicações, casamento e viagens): ${fmt(-despRef)}/mês</small></span><span class="v">${mesesCob.toFixed(1)} meses</span></div>
    <div class="row" style="display:flex;align-items:center;gap:10px;margin:4px 0 4px">${barra(pctE, meta1Ok?'#0E5C46':'var(--laranja)')}<span class="mini" style="white-space:nowrap">${fmt(liq30)} de ${fmt(meta1Ok ? alvoE : alvoE1)} · ${pctE.toFixed(0)}%</span></div>
    <div class="mini" style="margin-bottom:4px">${meta1Ok
      ? `✓ Meta intermediária (${cfg.emerg_meta1} meses) atingida — rumo ao alvo final de ${cfg.emerg_meses} meses (${fmt(alvoE)}).`
      : `Meta intermediária: <b>${cfg.emerg_meta1} meses (${fmt(alvoE1)})</b> · alvo final: ${cfg.emerg_meses} meses (${fmt(alvoE)}).`}</div>
    <div class="mini" style="margin-bottom:14px;color:var(--muted)">Disponível em até D+5: ${fmt(liq5)} (${liq30>0?Math.round(100*liq5/liq30):0}% da emergência). Caixa em conta e Bitcoin ficam fora desta conta por política.</div>`;
  h += `<div class="kv tt"><span class="k">1º milhão<small>caixa + reservas hoje: ${fmt(P0)} · ritmo projetado: ${fmt(ritmo)}/mês${cfg.rend_aa?` · rendimento ${cfg.rend_aa}% a.a.`:''}</small></span><span class="v">${pctM.toFixed(1)}%</span></div>
    <div class="row" style="display:flex;align-items:center;gap:10px;margin:4px 0 6px">${barra(pctM)}<span class="mini" style="white-space:nowrap">${fmt(P0)} de ${fmt(cfg.alvo)}</span></div>`;
  h += `<div class="mini" style="margin-bottom:6px">${quando ? 'Chegada estimada: <b>'+quando+'</b>' : 'No ritmo projetado atual a meta não é atingida — ajuste o ritmo ou a premissa de rendimento.'}</div>`;
  h += `<div class="mini" style="color:var(--muted)">Alvos ajustáveis na aba <b>Configurações</b>.</div>`;
  el.innerHTML = h;
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
  if (per.t==='y27') return 'ano 2027 — projeção';
  return 'ano 2026';
}
function render(){
  pills();
  const noNav = per.t==='y' || per.t==='y27';
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
  document.getElementById('flegend').innerHTML =
    per.t==='y27'
    ? `<span><b>2027 inteiro é projeção</b>: mediana dos meses fechados de 2026 + premissas de crescimento (ajustáveis acima da tabela). O caixa parte do fim projetado de 2026.</span>`
    : per.t==='m'
    ? `<span><b>Previsto</b>: mediana dos meses fechados (jan–${MN[FECHADOS].toLowerCase()})${per.v>CORTE_M?' + agendado':''}${per.v<=CORTE_M?' — referência retroativa':''}</span><span><b>Realizado</b>: ${(()=>{
        const cob = D.cobertura || {};
        if (cob.sicredi && cob.nubank && cob.sicredi !== cob.nubank)
          return `Sicredi até ${dbr(cob.sicredi).slice(0,5)} · Nubank até ${dbr(cob.nubank).slice(0,5)} — o consolidado avança quando as duas contas cobrem a data (importe a que falta)`;
        return 'extratos' + (per.v===CORTE_M&&CORTE_D<DIM[CORTE_M]?' até '+D.corte.slice(8,10)+'/'+D.corte.slice(5,7):'');
      })()}</span><span>Toque em Recebimentos/Pagamentos abre os grupos; no grupo, as contas; na conta, os lançamentos</span>`
    : `<span>Jan–${MN[FECHADOS]}: realizado fechado${FECHADOS<CORTE_M?` · ${MN[CORTE_M]}¹: realizado até ${D.corte.slice(8,10)+'/'+D.corte.slice(5,7)}`:''}${CORTE_M<12?` · ${MN[CORTE_M+1]}–Dez*: previsto`:''}</span>`;
  // cards de contexto de 2026 (agenda set–dez e saldos bancários) não valem para a visão 2027
  for (const id of ['card-agenda','card-contas']){
    const el = document.getElementById(id);
    if (el) el.style.display = per.t==='y27' ? 'none' : '';
  }
  document.getElementById('fcontrols').innerHTML = '';
  if (per.t==='y27') renderAno27();
  else if (per.t!=='m') renderMeses(meses);
  else if (sub==='semanas') renderSemanas(per.v);
  else if (sub==='dias') renderDias(per.v);
  else renderResumo(meses);
  const mesesAg = ((D.agendados||{}).extras||[]).flatMap(e=>e.meses);
  document.getElementById('fnota').innerHTML =
    (per.t==='m'&&(sub==='semanas'||sub==='dias')&&(per.v>CORTE_M||(per.v===CORTE_M&&CORTE_D<DIM[CORTE_M]))? 'Linhas/colunas com * são projeção: cada conta segue o padrão histórico do dia do mês em que costuma acontecer (extratos já importados), com faturas guardadas no dia/semana do vencimento. ':'')+
    (per.t==='m'&&per.v===CORTE_M&&CORTE_D<DIM[CORTE_M]? `${MFULL[CORTE_M][0].toUpperCase()+MFULL[CORTE_M].slice(1)} parcial: realizado até ${D.corte.slice(8,10)}/${D.corte.slice(5,7)}; o caixa no fim do mês mostrado é projeção (realizado + previsto proporcional dos dias restantes). `:'')+
    ((per.t==='m'&&mesesAg.includes(per.v)&&D.notas&&D.notas.agendado)? D.notas.agendado+' ':'')+
    ((D.notas&&D.notas.geral) || 'Faturas de cartão entram no dia do pagamento, abertas por categoria conforme a fatura.');
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
  // notas pessoais vêm do cofre criptografado
  const N = D.notas || {};
  if (N.contas) document.getElementById('nota-contas').innerHTML = 'Giro entre contas próprias fica fora do fluxo. ' + esc(N.contas);
  for (const [id, key] of [['nota-reservas','reservas'],['nota-estrategia','estrategia']]){
    const el = document.getElementById(id);
    if (el && N[key]){ el.textContent = N[key]; el.style.display = ''; }
  }
  const nCM = Object.keys(SB.sicredi.fim).length + Object.keys(SB.nubank.fim).length;
  document.getElementById('fontes').innerHTML =
    `<b>Fontes:</b> extratos OFX Sicredi CC e Nubank (jan–${D.corte.slice(8,10)}/${MN[CORTE_M].toLowerCase()}/${ANO}) · faturas Visa Infinite e do cartão Nubank conferidas contra o total declarado · IRPF ${ANO} (ano-base ${ANO-1}). Regra de ouro: saldo inicial + recebimentos − pagamentos = saldo final real de cada conta, conciliado no centavo em ${nCM} de ${nCM} conta-mês. Transferências entre contas próprias são giro e ficam fora dos totais. Nenhum valor é digitado aqui; tudo deriva dos lançamentos e das importações conciliadas.`;
}
// ================================================================
// Documentos — extratos, faturas e outros arquivos guardados no cofre
// ================================================================
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtBytes = n => n > 1048576 ? (n/1048576).toFixed(1)+' MB' : n > 1024 ? Math.round(n/1024)+' KB' : (n||0)+' B';
const TAM_MAX_ARQ = 3 * 1048576; // documentos maiores que isso estouram o armazenamento do navegador

function renderSync(){
  const auto = !!(Vault.data.sync && Vault.data.sync.token);
  let h = '';
  if (auto){
    if (Vault.pubStatus === 'publicando' || (Vault.dirtyLocal && Vault.pubStatus !== 'erro'))
      h += `<p class="mini">⏳ Publicando alterações na base…</p>`;
    else if (Vault.pubStatus === 'erro')
      h += `<p class="mini" style="color:var(--vermelho);margin-bottom:10px">Falha ao publicar automaticamente (${esc(Vault.pubErro||'')}). Confira a internet ou a chave na aba Acessos — ou baixe o arquivo e substitua manualmente:</p>
        <button class="btn" onclick="Vault.exportFile()">⬇ Baixar dados.enc.json</button>
        <button class="btn sm" onclick="Vault.autoPublish()">tentar de novo</button>`;
    else
      h += `<p class="mini" style="color:#0E5C46">✓ Publicação automática ativa${Vault.pubHora ? ` — última publicação às ${Vault.pubHora}` : ' — nenhuma alteração pendente'}. Toda alteração vai sozinha para a base (~1 min para valer nos outros aparelhos).</p>`;
  } else if (Vault.dirtyLocal){
    h += `<p class="mini" style="margin-bottom:10px">Há alterações salvas <b>somente neste navegador</b> (usuários, importações e/ou documentos).
      Para que valham em todos os dispositivos, baixe o arquivo atualizado e substitua o <b>dados.enc.json</b> na hospedagem — ou ative a publicação automática na aba Acessos.</p>
      <button class="btn" onclick="Vault.exportFile()">⬇ Baixar dados.enc.json atualizado</button>`;
  } else {
    h += `<p class="mini">Nenhuma alteração pendente — este navegador está igual ao arquivo publicado.
      Dica: na aba Acessos dá para ativar a <b>publicação automática</b>, que dispensa este passo manual.</p>`;
  }
  for (const id of ['sync-card','sync-docs']){ const el = document.getElementById(id); if (el) el.innerHTML = h; }
}

// ---- publicação automática (config no card da aba Acessos) ----
function renderGh(){
  const on = !!(Vault.data.sync && Vault.data.sync.token);
  const st = document.getElementById('gh-status'); if (!st) return;
  st.innerHTML = on
    ? '<b style="color:#0E5C46">✓ Ativa</b> — as alterações desta ferramenta são publicadas sozinhas na base.'
    : '<b>Inativa</b> — alterações precisam ser baixadas e substituídas manualmente na hospedagem.';
  document.getElementById('gh-off').style.display = on ? '' : 'none';
  document.getElementById('gh-form').style.display = on ? 'none' : '';
  document.getElementById('gh-save').style.display = on ? 'none' : '';
}

async function ghAtivar(){
  const msg = document.getElementById('gh-msg');
  const token = document.getElementById('gh-token').value.trim();
  if (!token){ msg.textContent = 'Cole a chave gerada no GitHub.'; return; }
  msg.textContent = 'Ativando e publicando…';
  Vault.data.sync = { token, repo:'samuelfelipe-sketch/painel-estacao-operacional', branch:'main', path:'fluxo-pessoal/dados.enc.json' };
  await Vault.save();
  document.getElementById('gh-token').value = '';
  const espera = () => new Promise(r=>setTimeout(r,400));
  for (let i=0;i<25 && Vault.pubStatus==='publicando';i++) await espera();
  if (Vault.pubStatus === 'erro'){
    msg.textContent = `A chave não funcionou (${Vault.pubErro||'erro'}). Confira as permissões (Contents: Read and write, só neste repositório) e tente de novo.`;
    delete Vault.data.sync; await Vault.save();
  } else {
    msg.textContent = '✓ Publicação automática ativada — esta alteração já foi publicada na base.';
  }
  renderGh(); renderSync();
}

async function ghDesativar(){
  if (!confirm('Desativar a publicação automática? As próximas alterações voltarão a exigir o download manual do dados.enc.json.')) return;
  delete Vault.data.sync;
  await Vault.save();
  document.getElementById('gh-msg').textContent = 'Desativada. Baixe o dados.enc.json atualizado (abaixo) para a base ficar sem a chave.';
  renderGh(); renderSync();
}

// ================================================================
// Classificação inteligente (IA) — Claude direto no navegador.
// A chave fica criptografada no cofre (Vault.data.ia). Só descrições
// e valores dos lançamentos em revisão são enviados — nunca saldos,
// documentos ou o restante da base.
// ================================================================
const IA_MODEL = 'claude-opus-5';
function iaCfg(){ return (Vault.data.ia && Vault.data.ia.key) ? Vault.data.ia : null; }

async function iaChamar(sistema, texto, schema, maxTokens){
  const cfg = iaCfg(); if (!cfg) throw new Error('IA não ativada');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: IA_MODEL,
      max_tokens: maxTokens || 8000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      system: [{ type: 'text', text: sistema }],
      messages: [{ role: 'user', content: texto }]
    })
  });
  if (!resp.ok){
    let m = 'HTTP ' + resp.status;
    try { const j = await resp.json(); if (j.error && j.error.message) m = j.error.message; } catch(e){}
    throw new Error(m);
  }
  const j = await resp.json();
  if (j.stop_reason === 'refusal') throw new Error('a IA recusou a solicitação');
  const bloco = (j.content || []).find(b => b.type === 'text');
  if (!bloco) throw new Error('resposta sem conteúdo');
  return JSON.parse(bloco.text);
}

function iaSistemaClassificacao(permitirGiro){
  const contas = D.contas.map(c => `${c.id} = ${c.nome} (${c.tipo==='R'?'entrada':'saída'} · ${c.grupo})`).join('\n');
  const regra = r => {
    const alvo = r.sf ? 'entrada parecida com o pró-labore de referência → prolabore; outra entrada → lucros; saída → GIRO'
      : r.limiar ? `acima de R$${r.limiar} → ${r.cAcima}; até R$${r.limiar} → ${r.cAbaixo}`
      : r.cPos ? `entrada → ${r.cPos}; saída → ${r.cNeg}`
      : `→ ${r.c}`;
    return `- contém ${r.match.map(m=>'"'+m+'"').join(' ou ')}: ${alvo}`;
  };
  return [
    'Você classifica lançamentos financeiros pessoais (Brasil) nas categorias do fluxo de caixa do usuário.',
    'Categorias válidas (responda exatamente com o id):',
    contas,
    permitirGiro ? 'GIRO = transferência entre contas do próprio dono, fica fora dos totais. Use GIRO para PIX/TED/transferências entre contas próprias e aplicações/resgates espelhados.' : '',
    'Diretrizes da metodologia:',
    '- Posto de combustível: até R$180 costuma ser conveniência (mercado); acima disso, combustível.',
    '- Devoluções e estornos de compras → casa_mov. IOF, juros, tarifas e anuidades → fin.',
    '- Restaurantes, delivery (iFood) e cafés → restaurantes. Supermercados e empórios → mercado.',
    '- Assinaturas digitais (streaming, apps, telefonia) → assinaturas.',
    '- Na dúvida, escolha a categoria mais provável pelo nome do estabelecimento.',
    'Regras pessoais já conhecidas (têm prioridade sobre as diretrizes):',
    ...(D.regras_card||[]).map(regra),
    ...(D.regras_bank||[]).map(regra),
    'Responda somente com o JSON pedido.'
  ].filter(Boolean).join('\n');
}

async function iaClassificarItens(itens, permitirGiro){
  const ids = D.contas.map(c=>c.id);
  if (permitirGiro) ids.push('GIRO');
  const schema = {
    type:'object', additionalProperties:false, required:['itens'],
    properties:{ itens:{ type:'array', items:{
      type:'object', additionalProperties:false, required:['i','c'],
      properties:{ i:{type:'integer'}, c:{type:'string', enum:ids} } } } }
  };
  const linhas = itens.map(it => `${it.i}\t${it.desc}\t${it.val.toFixed(2)}`).join('\n');
  const out = await iaChamar(iaSistemaClassificacao(permitirGiro),
    'Classifique cada lançamento (formato: i<TAB>descrição<TAB>valor; valor negativo = saída):\n'+linhas, schema, 8000);
  const mapa = {};
  for (const o of (out.itens||[])) if (ids.includes(o.c)) mapa[o.i] = o.c;
  return mapa;
}

// refina itens de fatura que caíram no genérico "servicos" (fallback das regras fixas)
async function iaRefinarFatura(items, rerender){
  if (!iaCfg()) return;
  const alvo = items.map((it,j)=>({i:j, desc:it.desc, val:-Math.abs(it.val)}))
    .filter(x => items[x.i].c === 'servicos');
  if (!alvo.length) return;
  try {
    const mapa = await iaClassificarItens(alvo, false);
    let mudou = false;
    for (const k in mapa){
      const it = items[+k];
      if (it && it.c === 'servicos'){ it.c = mapa[k]; it.ia = true; mudou = true; }
    }
    if (mudou) rerender();
  } catch(e){ console.warn('IA (fatura):', e.message); }
}

// refina lançamentos do extrato que ficaram incertos (diversos / conferir)
async function iaRefinarExtrato(imp){
  if (!iaCfg()) return;
  const alvo = imp.rows.map((r,i)=>({i, r}))
    .filter(x => x.r.kind === 'conta' && (x.r.incerto || x.r.c === 'diversos'));
  if (!alvo.length) return;
  try {
    const mapa = await iaClassificarItens(alvo.map(x=>({i:x.i, desc:x.r.m, val:x.r.v})), true);
    let mudou = false;
    for (const k in mapa){
      const r = imp.rows[+k];
      if (r && r.kind === 'conta' && (r.incerto || r.c === 'diversos')){
        r.c = mapa[k]; r.incerto = false; r.ia = true; mudou = true;
      }
    }
    if (mudou && IMP === imp) impRender();
  } catch(e){ console.warn('IA (extrato):', e.message); }
}

// leitura de fatura em texto livre/bagunçado quando o parser fixo não entende
async function iaExtrairItens(texto){
  const schema = { type:'object', additionalProperties:false, required:['itens'], properties:{
    itens:{ type:'array', items:{ type:'object', additionalProperties:false, required:['desc','val'],
      properties:{ desc:{type:'string'}, val:{type:'number'} } } } } };
  const sis = 'Você extrai as compras de faturas de cartão de crédito coladas em texto livre, possivelmente bagunçado (Brasil). ' +
    'Retorne cada compra com a descrição e o valor em reais: positivo para compra, negativo para estorno/crédito. ' +
    'Ignore totais, saldos, limites, pagamentos de fatura, juros informativos, cabeçalhos e rodapés. Responda somente com o JSON pedido.';
  const out = await iaChamar(sis, texto.slice(0, 30000), schema, 12000);
  return (out.itens||[]).filter(x => x.desc && typeof x.val === 'number' && x.val)
    .map(x => ({ desc: String(x.desc).slice(0,60), val: round2(x.val), c: catCard(x.desc, x.val), ia: true }));
}

async function iaLerFaturaTxt(){
  const msg = document.getElementById('imp-msg');
  const f = document.getElementById('imp-file').files[0];
  const texto = f ? await f.text() : document.getElementById('imp-txt').value.trim();
  msg.textContent = '✨ Lendo a fatura com IA…';
  try {
    const items = await iaExtrairItens(texto);
    if (!items.length){ msg.textContent = 'A IA não encontrou compras neste texto.'; return; }
    const cartao = detectCartao(texto);
    FIMP = { cartao: cartao || 'visa', cartaoAuto: !!cartao, ref: detectRef(texto), venc: detectVenc(texto), items,
      total: round2(items.reduce((s,it)=>s+it.val,0)), ignoradas: 0, viaIA: true };
    msg.textContent = '';
    fatRender();
    const ref = FIMP;
    iaRefinarFatura(ref.items, () => { if (FIMP === ref) fatRender(); });
  } catch(e){ msg.textContent = 'Falha na leitura com IA: ' + e.message; }
}

async function iaLerFaturaImp(i){
  const r = IMP.rows[i];
  const msg = document.getElementById('imp-fat-msg-'+i);
  const texto = document.getElementById('imp-fat-'+i).value;
  msg.textContent = '✨ Lendo a fatura com IA…';
  try {
    const items = await iaExtrairItens(texto);
    if (!items.length){ msg.textContent = 'A IA não encontrou compras neste texto.'; return; }
    const soma = round2(items.reduce((s,it)=>s+it.val,0));
    const dif = round2(Math.abs(r.v) - soma);
    if (Math.abs(dif) > 1.00){
      msg.textContent = `A IA leu ${items.length} item(ns), mas a soma (${fmtMoeda(soma)}) não bate com o pagamento (${fmtMoeda(Math.abs(r.v))}) — diferença de ${fmtMoeda(dif)}. Confira se o texto traz a fatura completa.`;
      return;
    }
    r.fat = { items, ok: true, ajuste: Math.abs(dif) >= 0.01 ? dif : 0, ignoradas: 0 };
    impRender();
  } catch(e){ msg.textContent = 'Falha na leitura com IA: ' + e.message; }
}

function renderIa(){
  const on = !!iaCfg();
  const st = document.getElementById('ia-status'); if (!st) return;
  st.innerHTML = on
    ? '<b style="color:#0E5C46">✓ Ativa</b> — o que as regras fixas não reconhecerem é classificado pelo Claude, e faturas em formato bagunçado podem ser lidas por ele.'
    : '<b>Inativa</b> — a classificação usa somente as regras fixas; o que não for reconhecido cai em "conferir".';
  document.getElementById('ia-off').style.display = on ? '' : 'none';
  document.getElementById('ia-form').style.display = on ? 'none' : '';
  document.getElementById('ia-save').style.display = on ? 'none' : '';
}

async function iaAtivar(){
  const msg = document.getElementById('ia-msg');
  const key = document.getElementById('ia-key').value.trim();
  if (!key){ msg.textContent = 'Cole a chave criada no console da Anthropic.'; return; }
  msg.textContent = 'Testando a chave…';
  Vault.data.ia = { key };
  try {
    const schema = { type:'object', additionalProperties:false, required:['ok'], properties:{ ok:{type:'boolean'} } };
    await iaChamar('Responda somente com o JSON pedido.', 'Retorne {"ok": true}.', schema, 4000);
    await Vault.save();
    document.getElementById('ia-key').value = '';
    msg.textContent = '✓ Classificação com IA ativada — a chave ficou guardada criptografada no cofre.';
  } catch(e){
    delete Vault.data.ia;
    msg.textContent = 'A chave não funcionou (' + e.message + '). Confira em console.anthropic.com → API Keys e tente de novo.';
  }
  renderIa();
}

async function iaDesativar(){
  if (!confirm('Desativar a classificação com IA? A chave será removida do cofre.')) return;
  delete Vault.data.ia;
  await Vault.save();
  document.getElementById('ia-msg').textContent = 'Desativada — a chave foi removida do cofre.';
  renderIa();
}

// ================================================================
// Transações — todos os lançamentos, agrupados e filtráveis
// ================================================================
const TX_ORG = { sicredi:'Sicredi CC', nubank:'Nubank', visa:'Visa Infinite', nucard:'Cartão Nubank', master:'Mastercard' };
// mês de competência: compra de cartão conta no mês anterior ao pagamento da fatura
function txCompMes(l){
  const m = +l.d.slice(5,7);
  return CARDS.includes(l.o) ? m - 1 : m;   // 0 = dezembro do ano anterior
}
function txVal(id){ const el = document.getElementById(id); return el ? el.value : ''; }
function renderTxFiltros(){
  const cat = document.getElementById('tx-cat'); if (!cat || cat.options.length) return;
  let h = '<option value="">Todas</option><option value="GIRO">Giro entre contas</option>';
  for (const tipo of ['R','P']){
    for (const g of (tipo==='R'?GRUPOS_R:GRUPOS_P)){
      const cs = D.contas.filter(c=>c.grupo===g && c.tipo===tipo);
      if (!cs.length) continue;
      h += `<optgroup label="${esc(g)}">` + cs.map(c=>`<option value="${c.id}">${esc(c.nome)}</option>`).join('') + '</optgroup>';
    }
  }
  cat.innerHTML = h;
  document.getElementById('tx-org').innerHTML =
    '<option value="">Todas</option>' + Object.entries(TX_ORG).map(([k,n])=>`<option value="${k}">${n}</option>`).join('');
}
function renderTx(){
  const el = document.getElementById('tx-lista'); if (!el) return;
  renderTxFiltros();
  const regime = txVal('tx-regime') || 'pag', grupo = txVal('tx-grupo') || 'mes';
  const cat = txVal('tx-cat'), org = txVal('tx-org'), busca = txVal('tx-busca').trim().toLowerCase();
  let ls = D.lanc.slice();
  if (cat) ls = ls.filter(l => l.c === cat);
  if (org) ls = ls.filter(l => l.o === org);
  if (busca) ls = ls.filter(l => (l.m||'').toLowerCase().includes(busca));

  const grupos = new Map();
  for (const l of ls){
    const key = grupo === 'mes' ? String(regime === 'comp' ? txCompMes(l) : +l.d.slice(5,7)).padStart(2,'0') : l.c;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(l);
  }
  const nomeGrupo = key => {
    if (grupo !== 'mes') return key === 'GIRO' ? 'Giro entre contas (fora dos totais)' : esc((CM[key]||{}).nome || key);
    const m = +key;
    return m === 0 ? `dezembro ${ANO-1}` : `${MFULL[m]} ${ANO}`;
  };
  const chaves = [...grupos.keys()].sort((a,b)=>{
    if (grupo === 'mes') return b.localeCompare(a);                     // mês mais recente primeiro
    const tot = k => Math.abs(grupos.get(k).filter(l=>l.c!=='GIRO').reduce((s,l)=>s+l.v,0));
    return tot(b) - tot(a);                                             // categoria de maior volume primeiro
  });

  if (!chaves.length){ el.innerHTML = '<p class="mini">Nenhuma transação com esses filtros.</p>'; return; }
  let h = '';
  chaves.forEach((key, idx) => {
    const rows = grupos.get(key).sort((a,b)=> b.d.localeCompare(a.d) || Math.abs(b.v)-Math.abs(a.v));
    const tot = rows.filter(l=>l.c!=='GIRO').reduce((s,l)=>s+l.v,0);
    h += `<details class="card cfg" style="padding:12px 16px;margin-bottom:10px"${idx===0?' open':''}>
      <summary>${nomeGrupo(key)} · ${rows.length} transaç${rows.length===1?'ão':'ões'} · <span style="color:${tot<0?'var(--vermelho)':'#0E5C46'}">${fmtMoeda(tot)}</span></summary>
      <div class="tbl-wrap"><table><thead><tr><th class="lab">Data · Descrição</th><th style="text-align:left">${grupo==='mes'?'Categoria':'Mês'}</th><th style="text-align:left">Origem</th><th>Valor</th></tr></thead><tbody>`;
    for (const l of rows){
      const giro = l.c === 'GIRO';
      const col2 = grupo === 'mes'
        ? (giro ? 'Giro (fora dos totais)' : esc((CM[l.c]||{}).nome || l.c))
        : `${l.d.slice(8,10)}/${l.d.slice(5,7)}`;
      h += `<tr${giro?' style="opacity:.6"':''}><td class="lab" style="white-space:normal">${l.d.slice(8,10)}/${l.d.slice(5,7)} · ${esc((l.m||'').slice(0,48))}</td><td style="text-align:left;font-size:.78rem">${col2}</td><td style="text-align:left;font-size:.78rem">${TX_ORG[l.o]||esc(l.o||'·')}</td>${cellM(l.v)}</tr>`;
    }
    h += '</tbody></table></div></details>';
  });
  el.innerHTML = h;
}

function renderDocs(){
  const docs = Vault.data.docs || [];
  const pend = D.fat_pend || [];
  const el = document.getElementById('doc-lista');
  if (!docs.length && !pend.length){ el.innerHTML = '<p class="mini">Nenhum documento guardado ainda — importe o primeiro extrato OFX ou fatura na aba Configurações; eles serão arquivados aqui automaticamente.</p>'; renderSync(); return; }
  let h = '<table><thead><tr><th class="lab">Documento</th><th>Tipo</th><th>Referência</th><th>Tamanho</th><th>Adicionado</th><th></th></tr></thead><tbody>';
  for (const p of [...pend].sort((a,b)=> (b.ref||'').localeCompare(a.ref||''))){
    const ref = p.ref ? p.ref.slice(5,7)+'/'+p.ref.slice(0,4) : '·';
    h += `<tr style="background:#FBF4EC"><td class="lab" style="background:#FBF4EC">Fatura ${CARTAO_NOME[p.cartao]} — ${fmtMoeda(p.total)} · ${p.items.length} itens</td>
      <td>⏳ Aguardando pagamento</td><td>${ref}</td><td>·</td><td>${p.add?p.add.slice(8,10)+'/'+p.add.slice(5,7)+'/'+p.add.slice(2,4):'·'}</td>
      <td style="white-space:nowrap"><button class="btn sm" onclick="fatPendVer('${p.id}')">ver</button>
      <button class="btn sm danger" onclick="fatPendExcluir('${p.id}')">excluir</button></td></tr>`;
  }
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

// ---- classificadores ----
// Duas camadas: regras PESSOAIS (contrapartes, documentos, valores de referência)
// vêm do cofre criptografado (D.regras_card / D.regras_bank) e nunca aparecem
// neste arquivo público; aqui ficam só regras genéricas de estabelecimentos.
function regraPessoal(regras, texto, amt){
  for (const r of (regras || [])){
    if (!r.match.some(k => texto.includes(k))) continue;
    if (r.amtNeg && !(amt < 0)) continue;
    if (r.sf){
      if (amt > 0) return {kind:'conta', c: Math.abs(amt - r.ref) < 2 ? 'prolabore' : 'lucros'};
      return {kind:'giro'};
    }
    if (r.limiar) return {kind:'conta', c: Math.abs(amt) > r.limiar ? r.cAcima : r.cAbaixo};
    if (r.cPos) return {kind:'conta', c: amt > 0 ? r.cPos : r.cNeg};
    return {kind:'conta', c: r.c};
  }
  return null;
}

function catCard(desc, val){
  const d = String(desc).toUpperCase();
  const has = (...ks) => ks.some(k => d.includes(k));
  const rp = regraPessoal(D.regras_card, d, -(val==null?1:val));
  if (rp) return rp.c;
  if (has('IOF','ANUIDADE','TRANSACAO')) return 'fin';
  if (has('DEVOLUCAO')) return 'casa_mov';
  if (has('BENNU')) return 'restaurantes';
  if (has('POSTO','SAPATAO','SAFYR','ABASTECEDORA','COMERCIAL DE COMBUST','SHELL','4 COLONIAS'))
    return (val == null || val > 180) ? 'combustivel' : 'mercado';  // ≤R$180 = conveniência
  if (has('RISSUL','BOURBON','MARANADOCE','QUEIJARIA','EMPORIO','BECKER HAUS','CACAU','KOPENHAGEN','VISTAMONTES','GROWTH')) return 'mercado';
  if (has('JIM')) return 'vestuario';
  if (has('IFD','LOCATELLI','TOAST','GRILL','RESTAUR','ACAI','ALABAMA','BURGER','SUSHI','MAGATTA','MOKAI','CAFE','COFFEE','FEIJOADA','KACHURRASCO','CHURRASCARIA','AMECHICKEN','OH BRUDER','DI PAOLO','IL CAMPANAR','LEAO DO VALE','WJD','MERIDIANO','VIDEIRAS','ADEGA','BODEGA','PIZZAENTREVINHOS','CLANDESTINA','SCHWANTES','FERDAS','LUGU')) return 'restaurantes';
  if (has('APPLE','GOOGLE','YOUTUBE','MICROSOFT','SETAPP','PADDLE','HBO','MELIMAIS','LINKTREE','VIVO','ANTHROPIC','CLAUDE','AMAZON','TEMU','NOAR','HBL','SHELL BOX','EVINO','OLYMPIKUS','CPQ','LINKER','ATGF','ZARCOIN','MAQU','MERCADOLIVRE','MAGALU','QMS','CONECTC'))
    return has('APPLE','GOOGLE','YOUTUBE','MICROSOFT','SETAPP','PADDLE','HBO','MELIMAIS','LINKTREE','VIVO','ANTHROPIC','CLAUDE','AMAZON PRIME','HBL','SHELL BOX') ? 'assinaturas' : 'casa_mov';
  if (has('SAINT PAUL','COURSIV','KIWIFY','GREENN','GAL CONTEUDOS','AUDITHORIUM')) return 'educacao';
  if (has('PANVEL','FARMACIA','DROGARIA','LABORAT','SANTE SPA','RDO','IMUNI')) return 'saude';
  if (has('PRUDENTIAL','PRUDENT')) return 'seguros';
  if (has('BROOKSFIELD','ARAMIS','CALCADOS','NORDWEG','LUPO','MINIMALCLUB','MISS PIJAMA','CASA ALBERTO','FRATEX','ANJINHOS','TNF','NORTH FACE')) return 'vestuario';
  if (has('ARMAZEM DO SOFA','IND','FORMAS','SCS','PETZ','COBASI','NATIVA','AGROPECUARIA','MAGO DAS CHAVES','HARTMANN','MAGALU')) return 'casa_mov';
  if (has('LBTRAVEL','BOOKING','HOTEL','MERCURE','WI FI','ONBOARD','DPSSA','VISTA IBIRAPUERA','SKYLINE','BUSLOG','RIO HOTEL','MICHELON','MICHEL','QMS','SMILES')) return 'viagens';
  if (has('UBER','ESTAPAR','PARK','PARE CERTO','INDIGO','ESTACIONAMENTO','AGE ','LYON','PEDAGIO','MONTE BIANCO','VOLTARE')) return 'pedagio';
  if (has('WEISS','PRO BIKE','VIC CENTER','ANDGO','LGND','CLICRUN','QUADRAS','TIKETO','TKTR')) return 'esportes';
  if (has('RHEMA')) return 'doacoes';
  if (has('VEROO')) return 'mercado';
  if (has('CONSORCIO EMPREENDED')) return 'fin';
  return 'servicos';
}

// retorna {kind:'giro'|'conta'|'fatura', c, cartao}
function catBank(memo, amt){
  const m = String(memo).toUpperCase();
  const has = (...ks) => ks.some(k => m.includes(k));
  if (m.includes('DEBITO TED/IB') && has('SAMUEL F')) return {kind:'conta', c:'aplic'};   // TED p/ conta própria não monitorada
  if (has('SAMUEL FE','SAMUEL F') && has('PIX','TED','TRANSF')) return {kind:'giro'};
  if (has('DEB TRANSF CC/PP','TRANSFERENCIA DA POUPANCA')) return {kind:'giro'};
  if (m.includes('PAGAMENTO DE FATURA')) return {kind:'fatura', cartao:'nucard'};
  if (m.includes('DEB.CTA.FATURA')) return {kind:'fatura', cartao:'visa'};
  if (has('PAGTO FATURA MASTER','EST PAGTO FATURA MASTER')) return {kind:'fatura', cartao:'master'};
  const rp = regraPessoal(D.regras_bank, m.replace(/Ã/g,''), amt);
  if (rp) return rp;
  if (m.includes('POSTO SAPATAO'))
    return {kind:'conta', c: Math.abs(amt) > 180 ? 'combustivel' : 'mercado'};
  if (has('APLIC. FINANC','APLIC FUNDOS')) return {kind:'conta', c:'aplic'};
  if (has('RESGATE APLIC')) return {kind:'conta', c:'resgates'};
  if (m.includes('PLANO INT CAPITAL')) return {kind:'conta', c:'aplic'};
  if (has('CREDITO CONSORCIO','LIBERACAO CREDITO')) return {kind:'conta', c:'captacao'};
  if (has('LIQUIDACAO DE PARCELA','LIQUIDACAO CONTRATO','DEBITO CONVENIOS-CONSORCIO')) return {kind:'conta', c:'amort'};
  if (has('IOF','JUROS UTILIZ','TARIFA','ENC0')) return {kind:'conta', c:'fin'};
  if (m.includes('RGE')) return {kind:'conta', c:'energia'};
  if (has('DEFFERRARI','TELEF')) return {kind:'conta', c:'internet'};
  if (has('PMDOISI','ARRECADACAO ESTADUAL','GADE','DARF','GNRE')) return {kind:'conta', c:'impostos'};
  if (has('MAPFRE','TOKIOM')) return {kind:'conta', c:'seguros'};
  if (has('RHEMA','MINIS')) return {kind:'conta', c:'doacoes'};
  if (has('PASSAGEM PEDAGIO','STAR PARK','ESTACI')) return {kind:'conta', c:'pedagio'};
  if (has('BIKE','VIC CENTER','WEISS')) return {kind:'conta', c:'esportes'};
  if (has('POUSADA')) return {kind:'conta', c:'viagens'};
  if (has('CAMISARIA')) return {kind:'conta', c:'vestuario'};
  if (has('VINHO')) return {kind:'conta', c:'restaurantes'};
  if (has('CLINI','IMUNI','NUTRI')) return {kind:'conta', c:'saude'};
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

// ---- fatura: parser de itens (texto colado ou CSV exportado do banco) ----
// Criterioso: só aceita como valor algo em formato de dinheiro (vírgula e
// centavos), descarta linhas de cabeçalho/estruturais (cooperativa, conta,
// número do cartão, vencimento, totais) e aproveita o "Valor Total" declarado
// no arquivo como conferência da soma. A trava real segue no pagamento.
const FAT_META = /^(TOTAL|VALOR TOTAL|VALOR M|SALDO|LIMITE|VENCIMENTO|DATA DE|PAGAMENTO|PAG\b|PGTO|CREDITO DE PAGAMENTO|DEB\.?\s?CTA|FATURA|COOPERATIVA|CONTA CORRENTE|AG[ÊE]NCIA|AGENCIA\b|TITULAR|PORTADOR|ASSOCIADO|CPF|CART[ÃA]O|MELHOR DIA|PARCELAMENTO)/i;
const FAT_VAL = /-?\s?(?:R\$\s*)?\d[\d.]*,\d{2}/g;
function parseFaturaItens(text){
  const items = []; const ignoradas = []; let declTotal = null;
  for (const raw of text.split(/\n/)){
    const line = raw.trim().replace(/"/g,'').replace(/[;,\t]+$/,'');
    if (!line) continue;
    // último valor em formato monetário da linha (ignorando colunas em US$)
    let tok = null;
    for (const m of line.matchAll(FAT_VAL)){
      const antes = line.slice(Math.max(0, m.index-4), m.index).toUpperCase();
      if (antes.includes('US$') || antes.includes('U$')) continue;
      tok = m;
    }
    if (!tok){ ignoradas.push(line); continue; }
    let vs = tok[0].replace(/[R$\s]/g,''), neg = vs.startsWith('-');
    vs = vs.replace('-','').replace(/\./g,'').replace(',','.');
    const val = parseFloat(vs);
    if (isNaN(val)){ ignoradas.push(line); continue; }
    const depois = line.slice(tok.index + tok[0].length).replace(/^[;,\t\s]+/,'');
    if (/^C(\b|$)/i.test(depois)) neg = !neg;   // sufixo C = crédito/estorno
    let desc = line.slice(0, tok.index).replace(/[;,\t]+\s*$/,'').trim()
      .replace(/^\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*[-–]?\s*/,'').replace(/^\d{4}-\d{2}-\d{2}\s*/,'')
      .replace(/^[;,\t]+\s*/,'').replace(/[;,\t]+/g,' · ').trim();
    if (!desc) desc = depois.replace(/^[DC](\b|$)\s*/i,'').replace(/^[;,\t]+\s*/,'').trim();
    if (FAT_META.test(desc)){
      if (/^(VALOR\s+)?TOTAL/i.test(desc)) declTotal = Math.abs(val);
      ignoradas.push(line); continue;
    }
    if (!/[A-Za-zÀ-ÿ]/.test(desc)){ ignoradas.push(line); continue; }   // linha sem descrição de verdade
    const v = neg ? -val : val;
    const pc = parseParcela(desc);
    items.push({ desc: desc.slice(0,60), val: round2(v), c: catCard(desc, v), ...(pc ? {parc: pc} : {}) });
  }
  return items.length ? { items, ignoradas, declTotal }
    : { erro: 'Não encontrei itens com valor. Anexe o CSV da fatura ou cole uma linha por compra, com o valor no fim.' };
}

// ---- estado da importação em revisão ----
let IMP = null;
let FIMP = null;   // fatura em revisão (fluxo "Fatura de cartão")
const genId = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random().toString(16).slice(2);
const cellM = v => `<td class="${v<0?'neg':''}">${fmtMoeda(v)}</td>`;
const CARTAO_NOME = { visa:'Visa Infinite', nucard:'Cartão Nubank', master:'Mastercard' };
const ACC_NOME = { sicredi:'Sicredi CC', nubank:'Nubank' };

function cobertura(){
  if (!D.cobertura) D.cobertura = { sicredi: D.corte, nubank: D.corte };
  return D.cobertura;
}

// ================================================================
// Fatura de cartão enviada a qualquer momento (antes do pagamento):
// fica guardada criptografada em D.fat_pend e entra no caixa quando o
// débito da fatura aparecer na importação do extrato.
// ================================================================
// ---- envio único: a ferramenta descobre sozinha o que é o arquivo ----
async function impEnviar(){
  const msg = document.getElementById('imp-msg');
  msg.textContent = ''; document.getElementById('imp-review').innerHTML = ''; IMP = null; FIMP = null;
  const f = document.getElementById('imp-file').files[0];
  const colado = document.getElementById('imp-txt').value.trim();
  if (!f && !colado){ msg.textContent = 'Anexe o arquivo (extrato OFX ou fatura do cartão) — ou cole o texto da fatura.'; return; }
  const text = f ? await f.text() : colado;
  if (/<OFX|OFXHEADER|<STMTTRN/i.test(text)) return impLer(text, f ? f.name : 'extrato.ofx');
  return fatLer(text);
}

// detecção do cartão e do mês de referência a partir do conteúdo da fatura
function detectCartao(text){
  const t = text.toUpperCase();
  if (/MASTERCARD|MASTER\b/.test(t)) return 'master';
  if (t.includes('VISA')) return 'visa';
  if (/NUBANK|NU PAGAMENTOS|NUCARD/.test(t)) return 'nucard';
  if (t.includes('SICREDI')) return 'visa';   // fatura Sicredi sem bandeira explícita: cartão principal
  return null;
}
function detectVenc(text){
  const m = text.match(/VENCIMENTO[^\d]{0,20}(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  const aa = m[3].length === 2 ? '20'+m[3] : m[3];
  return `${aa}-${String(+m[2]).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`;
}
function detectRef(text){
  let m = text.match(/(?:REFER[ÊE]NCIA|FATURA DE)[^\d]{0,20}(\d{1,2})\/(\d{4})/i);
  if (m) return `${m[2]}-${String(+m[1]).padStart(2,'0')}`;
  // vencimento em dd/mm/aaaa: a fatura é do mês anterior ao vencimento
  const venc = detectVenc(text);
  if (venc){
    let aa = +venc.slice(0,4), mm = +venc.slice(5,7) - 1;
    if (mm === 0){ mm = 12; aa--; }
    return `${aa}-${String(mm).padStart(2,'0')}`;
  }
  const meses = {};
  for (const dm of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)){
    const ano = dm[3].length === 2 ? '20'+dm[3] : dm[3], mn = +dm[2];
    if (mn >= 1 && mn <= 12){ const k = `${ano}-${String(mn).padStart(2,'0')}`; meses[k] = (meses[k]||0)+1; }
  }
  const top = Object.entries(meses).sort((a,b)=>b[1]-a[1])[0];
  if (top) return top[0];
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`;
}

async function fatLer(texto){
  const msg = document.getElementById('imp-msg');
  const res = parseFaturaItens(texto);
  if (res.erro){
    msg.innerHTML = esc(res.erro) + (iaCfg() ? ' <button class="btn sm" onclick="iaLerFaturaTxt()">✨ Tentar ler com IA</button>' : '');
    return;
  }
  const cartao = detectCartao(texto);
  FIMP = { cartao: cartao || 'visa', cartaoAuto: !!cartao, ref: detectRef(texto), venc: detectVenc(texto), items: res.items,
    total: round2(res.items.reduce((s,it)=>s+it.val,0)), ignoradas: res.ignoradas.length, declTotal: res.declTotal };
  fatRender();
  const ref = FIMP;
  iaRefinarFatura(ref.items, () => { if (FIMP === ref) fatRender(); });
}

function fatRender(){
  const el = document.getElementById('imp-review');
  let h = `<div class="note" style="margin-bottom:10px"><b>Fatura de cartão</b> · ${FIMP.items.length} item(ns) · total ${fmtMoeda(FIMP.total)}${FIMP.ignoradas?` · ${FIMP.ignoradas} linha(s) de cabeçalho/total ignorada(s)`:''}</div>`;
  if (FIMP.declTotal != null){
    const difT = round2(FIMP.declTotal - FIMP.total);
    h += Math.abs(difT) <= 1
      ? `<div class="mini" style="margin-bottom:10px;color:#0E5C46"><b>✓ Confere com o arquivo:</b> o total declarado na fatura (${fmtMoeda(FIMP.declTotal)}) bate com a soma dos itens lidos.</div>`
      : `<div class="mini" style="margin-bottom:10px;color:var(--laranja)"><b>⚠ Atenção:</b> o arquivo declara total de ${fmtMoeda(FIMP.declTotal)}, mas a soma dos itens lidos dá ${fmtMoeda(FIMP.total)} (diferença de ${fmtMoeda(difT)}). Pode ser fatura ainda aberta ou linha não lida — confira a lista abaixo. A trava final continua no dia do pagamento.</div>`;
  }
  h += `<div class="formgrid" style="margin-bottom:10px">
    <label>Cartão${FIMP.cartaoAuto?' <span class="mini" style="font-weight:400">(detectado)</span>':' <span class="mini" style="color:var(--laranja);font-weight:400">(confira)</span>'}
      <select id="fat-sel-cartao" onchange="FIMP.cartao=this.value">${Object.entries(CARTAO_NOME).map(([k,n])=>`<option value="${k}" ${FIMP.cartao===k?'selected':''}>${n}</option>`).join('')}</select></label>
    <label>Mês de referência <span class="mini" style="font-weight:400">(detectado)</span>
      <input type="month" id="fat-sel-ref" value="${FIMP.ref}" onchange="FIMP.ref=this.value"></label>
  </div>`;
  h += '<div class="tbl-wrap"><table><thead><tr><th class="lab">Compra</th><th>Valor</th><th style="text-align:left">Categoria</th></tr></thead><tbody>';
  FIMP.items.forEach((it,j)=>{
    h += `<tr><td class="lab" style="white-space:normal">${esc(it.desc.slice(0,50))}${it.ia?' <span title="classificado pela IA — confira">✨</span>':''}</td>${cellM(-it.val)}<td style="text-align:left"><select style="font-size:.78rem;max-width:230px" onchange="FIMP.items[${j}].c=this.value">${optsConta(it.c)}</select></td></tr>`;
  });
  h += '</tbody></table></div>';
  const mesPg = +FIMP.ref.slice(5,7) + 1;
  const nParc = FIMP.items.filter(it => it.parc && it.parc.k < it.parc.n).length;
  h += `<div class="note" style="margin-top:10px">Regime de caixa: esta fatura <b>não mexe nos números agora</b>. Ela fica guardada (criptografada) e entra no caixa no dia do pagamento — quando o débito da fatura aparecer na importação do extrato, é só clicar em "usar fatura guardada".` +
    (mesPg <= 12 ? ` Ao guardar, o pagamento (${fmtMoeda(-FIMP.total)}) já entra <b>projetado</b> no fluxo de ${MFULL[mesPg]}, categoria por categoria.` : '') +
    (nParc ? ` Encontrei <b>${nParc} compra(s) parcelada(s)</b> — as próximas parcelas entram na projeção dos meses seguintes.` : '') +
    ` Pode reenviar uma versão mais completa depois: a nova substitui a anterior do mesmo cartão/mês.</div>`;
  h += `<div style="margin-top:10px;display:flex;gap:8px">
    <button class="btn" onclick="fatGuardar()">Guardar fatura</button>
    <button class="btn sm" onclick="FIMP=null;document.getElementById('imp-review').innerHTML='';document.getElementById('imp-msg').textContent='Fatura descartada.'">descartar</button>
  </div>`;
  el.innerHTML = h;
}

async function fatGuardar(){
  if (!FIMP) return;
  const ref = FIMP.ref;
  const ex = (D.fat_pend||[]).find(p => p.cartao === FIMP.cartao && p.ref === ref);
  if (ex && !confirm('Já existe uma fatura guardada deste cartão para este mês. Substituir pela versão nova?')) return;
  D.fat_pend = (D.fat_pend||[]).filter(p => !(p.cartao === FIMP.cartao && p.ref === ref));
  D.fat_pend.push({ id: genId(), cartao: FIMP.cartao, ref, venc: FIMP.venc || null, total: FIMP.total, items: FIMP.items,
    add: new Date().toISOString().slice(0,10) });
  await Vault.save();
  const mesPg = ref ? +ref.slice(5,7) + 1 : 13;
  FIMP = null;
  document.getElementById('imp-review').innerHTML = '';
  document.getElementById('imp-file').value = ''; document.getElementById('imp-txt').value = '';
  document.getElementById('imp-msg').textContent = '✓ Fatura guardada (criptografada). Ela entra no caixa no dia do pagamento — ao importar o extrato com o débito da fatura, use o botão "usar fatura guardada".' +
    (mesPg <= 12 ? ` O pagamento já está projetado no fluxo de ${MFULL[mesPg]}.` : '');
  recalcBase();
  renderCabecalho(); renderDocs(); render();
}

function fatPendVer(id){
  const p = (D.fat_pend||[]).find(x=>x.id===id); if (!p) return;
  document.getElementById('mtit').textContent = `Fatura ${CARTAO_NOME[p.cartao]} — aguardando pagamento`;
  document.getElementById('msub').textContent = `${p.ref? p.ref.slice(5,7)+'/'+p.ref.slice(0,4)+' · ':''}${p.items.length} item(ns) · total ${fmtMoeda(p.total)}`;
  document.getElementById('mlist').innerHTML = p.items.map(it =>
    `<li><span class="q">${esc(it.desc.slice(0,44))}<span class="f">${esc((CM[it.c]||{}).nome||it.c)}</span></span><span class="v${it.val>0?' neg':''}">${fmt(-it.val)}</span></li>`).join('');
  document.getElementById('modal').classList.add('on');
}

async function fatPendExcluir(id){
  const p = (D.fat_pend||[]).find(x=>x.id===id); if (!p) return;
  if (!confirm(`Excluir a fatura guardada (${CARTAO_NOME[p.cartao]}${p.ref?' · '+p.ref.slice(5,7)+'/'+p.ref.slice(0,4):''})?`)) return;
  D.fat_pend = D.fat_pend.filter(x=>x.id!==id);
  await Vault.save();
  recalcBase();
  renderCabecalho(); renderDocs(); render();
}

function impUsarFatPend(i, id){
  const r = IMP.rows[i];
  const p = (D.fat_pend||[]).find(x=>x.id===id); if (!p) return;
  const dif = round2(Math.abs(r.v) - p.total);
  const msg = () => document.getElementById('imp-fat-msg-'+i);
  if (Math.abs(dif) > 1.00){
    msg().textContent = `A fatura guardada soma ${fmtMoeda(p.total)}, mas o pagamento é de ${fmtMoeda(Math.abs(r.v))} — diferença de ${fmtMoeda(dif)}. Se a fatura guardada estiver incompleta (foi enviada antes de fechar), anexe/cole a versão final abaixo.`;
    return;
  }
  r.fat = { items: JSON.parse(JSON.stringify(p.items)), ok: true,
    ajuste: Math.abs(dif) >= 0.01 ? dif : 0, ignoradas: 0, fromPend: id };
  impRender();
}

let IMP_SRC = null;   // último OFX lido, para o caso raro de banco não detectado
function impLerForcado(acc){ if (IMP_SRC) impLer(IMP_SRC.text, IMP_SRC.nome, acc); }

async function impLer(text, nome, accForcada){
  const msg = document.getElementById('imp-msg');
  msg.textContent = ''; document.getElementById('imp-review').innerHTML = ''; IMP = null;
  const p = parseOFX(text);
  if (!p.txs.length){ msg.textContent = 'Nenhum lançamento encontrado no arquivo. É um OFX de extrato?'; return; }
  const acc = accForcada || p.acc;
  if (!acc){
    IMP_SRC = { text, nome };
    msg.innerHTML = `Não reconheci o banco deste extrato. De qual conta ele é?
      <button class="btn sm" onclick="impLerForcado('sicredi')">Sicredi CC</button>
      <button class="btn sm" onclick="impLerForcado('nubank')">Nubank</button>`;
    return;
  }
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
  IMP = { acc, rows, ledger: p.ledger, fimData, ignorados, arquivo: nome, texto: text };
  impRender();
  iaRefinarExtrato(IMP);
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
        ? `✓ ${r.fat.items.length} itens conferem${r.fat.ignoradas?` · ${r.fat.ignoradas} linha(s) de cabeçalho/total ignorada(s)`:''}${r.fat.ajuste?` (ajuste de ${fmtMoeda(r.fat.ajuste)} em Despesas financeiras)`:''}`
        : 'itens da fatura pendentes';
      h += `<tr><td class="lab" style="white-space:normal">${r.d.slice(8,10)}/${r.d.slice(5,7)} · ${esc(r.m.slice(0,60))}</td>${cellM(r.v)}<td style="text-align:left;font-size:.78rem">Fatura ${CARTAO_NOME[r.cartao]} — ${status}</td></tr>`;
      h += `<tr><td colspan="3" style="text-align:left;white-space:normal;background:#FBF9F2">`;
      if (!(r.fat && r.fat.ok)){
        const pends = (D.fat_pend||[]).filter(p => p.cartao === r.cartao);
        if (pends.length){
          h += `<div class="mini" style="margin:4px 0 4px"><b>Você já guardou fatura(s) deste cartão:</b></div><div style="margin-bottom:8px">` +
            pends.map(p => `<button class="btn sm" style="background:var(--verde);color:#fff" onclick="impUsarFatPend(${i},'${p.id}')">usar fatura ${p.ref? p.ref.slice(5,7)+'/'+p.ref.slice(0,4)+' ' : ''}· ${fmtMoeda(p.total)} · ${p.items.length} itens</button>`).join(' ') + `</div>`;
        }
        h += `<div class="mini" style="margin:4px 0 6px">Regime de caixa: as compras desta fatura entram hoje (${r.d.slice(8,10)}/${r.d.slice(5,7)}), abertas por categoria. ${pends.length?'Ou a':'A'}nexe o arquivo da fatura (CSV do banco) ou cole os itens — uma linha por compra, valor no fim (ex.: <i>POSTO SAPATAO  81,40</i>). A soma deve bater com o pagamento (${fmtMoeda(-r.v)}).</div>
          <input type="file" id="imp-fatfile-${i}" onchange="impFatArquivo(${i}, this)" style="margin:2px 0 8px;font-size:.8rem;max-width:100%">
          <textarea id="imp-fat-${i}" rows="5" style="width:100%;font:inherit;font-size:.8rem;border:1px solid var(--borda);border-radius:8px;padding:8px" placeholder="ou cole os itens aqui"></textarea>
          <div style="margin-top:6px"><button class="btn sm" onclick="impFatura(${i})">Processar itens</button></div>
          <div class="mini" id="imp-fat-msg-${i}" style="margin-top:4px"></div>`;
      } else {
        h += `<table style="margin:4px 0">` + r.fat.items.map((it,j)=>
          `<tr><td class="lab" style="position:static;font-size:.78rem">${esc(it.desc.slice(0,45))}${it.ia?' <span title="classificado pela IA — confira">✨</span>':''}</td>${cellM(-it.val)}<td style="text-align:left"><select style="font-size:.75rem" onchange="IMP.rows[${i}].fat.items[${j}].c=this.value">${optsConta(it.c)}</select></td></tr>`).join('') +
          `</table><div style="margin-top:4px"><button class="btn sm" onclick="IMP.rows[${i}].fat=null;impRender()">refazer itens</button></div>`;
      }
      h += `</td></tr>`;
    } else {
      h += `<tr${r.kind==='giro'||r.c==='GIRO'?' style="opacity:.65"':''}><td class="lab" style="white-space:normal">${r.d.slice(8,10)}/${r.d.slice(5,7)} · ${esc(r.m.slice(0,60))}${r.ia?' <span style="color:#7C5CBF">✨ IA — confira</span>':(r.incerto?' <span style="color:var(--laranja)">● conferir</span>':'')}</td>${cellM(r.v)}<td style="text-align:left"><select style="font-size:.78rem;max-width:230px" onchange="IMP.rows[${i}].c=this.value">${optsConta(r.c)}</select></td></tr>`;
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

async function impFatArquivo(i, inp){
  const f = inp.files[0]; if (!f) return;
  document.getElementById('imp-fat-'+i).value = await f.text();
  impFatura(i);
}

function impFatura(i){
  const r = IMP.rows[i];
  const res = parseFaturaItens(document.getElementById('imp-fat-'+i).value);
  const msg = document.getElementById('imp-fat-msg-'+i);
  if (res.erro){
    msg.innerHTML = esc(res.erro) + (iaCfg() ? ` <button class="btn sm" onclick="iaLerFaturaImp(${i})">✨ Tentar ler com IA</button>` : '');
    return;
  }
  const soma = round2(res.items.reduce((s,it)=>s+it.val,0));
  const dif = round2(Math.abs(r.v) - soma);   // pago − itens (residual de centavos vira Despesas financeiras)
  if (Math.abs(dif) > 1.00){
    msg.textContent = `Li ${res.items.length} item(ns)${res.ignoradas.length?` (${res.ignoradas.length} linha(s) ignorada(s))`:''}, mas a soma (${fmtMoeda(soma)}) não bate com o pagamento (${fmtMoeda(Math.abs(r.v))}) — diferença de ${fmtMoeda(dif)}. Confira se este é o CSV da fatura certa e se nenhuma compra ficou de fora.`;
    return;
  }
  r.fat = { items: res.items, ok: true, ajuste: Math.abs(dif) >= 0.01 ? dif : 0, ignoradas: res.ignoradas.length };
  impRender();
  const impRef = IMP, fatRef = r.fat;
  iaRefinarFatura(fatRef.items, () => { if (IMP === impRef && r.fat === fatRef) impRender(); });
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

  // faturas guardadas que foram usadas saem da fila de pendentes
  const usadas = IMP.rows.filter(r => r.fat && r.fat.fromPend).map(r => r.fat.fromPend);
  if (usadas.length) D.fat_pend = (D.fat_pend||[]).filter(p => !usadas.includes(p.id));

  cob[acc] = IMP.fimData;
  const novoCorte = [cob.sicredi, cob.nubank].sort()[0];
  if (novoCorte > D.corte) D.corte = novoCorte;

  // guarda o próprio OFX (e as faturas processadas) no arquivo de documentos criptografado
  const novoId = () => crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
  (D.docs = D.docs||[]).push({ id:novoId(),
    t:'Extrato bancário (OFX)', ref:IMP.fimData.slice(0,7), desc:`Extrato ${ACC_NOME[acc]} importado até ${dbr(IMP.fimData)}`,
    txt:IMP.texto, size:new Blob([IMP.texto]).size, add:D.corte });
  for (const r of IMP.rows){
    if (r.kind !== 'fatura' || !(r.fat && r.fat.ok)) continue;
    const txt = r.fat.items.map(it => `${it.desc}  ${it.val.toFixed(2)}`).join('\n');
    D.docs.push({ id:novoId(), t:'Fatura de cartão', ref:r.d.slice(0,7),
      desc:`Fatura ${CARTAO_NOME[r.cartao]} paga em ${dbr(r.d)} (${r.fat.items.length} itens)`,
      txt, size:new Blob([txt]).size, add:D.corte });
  }

  const resumo = `✓ ${IMP.rows.length} lançamento(s) incorporados e conciliados no centavo. Cobertura ${ACC_NOME[acc]}: ${dbr(cob[acc])}. ` +
    (cob.sicredi !== cob.nubank
      ? `O corte geral segue em ${dbr(D.corte)} — importe também o extrato da outra conta (${cob.sicredi < cob.nubank ? 'Sicredi' : 'Nubank'}) para avançar.`
      : `Corte geral atualizado para ${dbr(D.corte)}.`);
  IMP = null;
  document.getElementById('imp-review').innerHTML = '';
  document.getElementById('imp-file').value = ''; document.getElementById('imp-txt').value = '';
  document.getElementById('imp-msg').textContent = resumo + ' Baixe o dados.enc.json atualizado (card Sincronização) para valer em todos os aparelhos.';

  Vault.save().then(()=>{
    recalcBase();
    renderCabecalho(); renderContas(); renderMetas(); renderDocs(); renderTx(); render();
  });
}

// Liga um botão pelo id, tolerando elemento ausente: se o navegador estiver
// com um index.html de versão diferente em cache (janela de propagação da
// hospedagem), o boot não pode quebrar — o vigia de versão recarrega em
// seguida e tudo se alinha.
const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
on('imp-ler', impEnviar);

// ---- desconexão automática de todos os acessos quando sai versão nova ----
// Cada aba aberta compara a "etiqueta" (ETag/Last-Modified) dos arquivos da
// ferramenta na hospedagem; mudou = nova versão publicada → volta ao login.
let VER_TAG = null;
async function verTag(){
  try {
    const rs = await Promise.all(['index.html','app.js'].map(f => fetch(f, { method:'HEAD', cache:'no-store' })));
    const tags = rs.map(r => r.headers.get('etag') || r.headers.get('last-modified') || '');
    return tags.every(t => !t) ? null : tags.join('|');
  } catch(e){ return null; }
}
async function verCheck(){
  const t = await verTag();
  if (t == null) return;
  if (VER_TAG == null){ VER_TAG = t; return; }
  if (t !== VER_TAG){
    if (IMP || FIMP) return;   // não derruba no meio de uma revisão aberta
    sessionStorage.setItem('fp-atualizado','1');
    location.reload();
  }
}
verTag().then(t => { VER_TAG = t; });
setInterval(verCheck, 120000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) verCheck(); });

// ---- vigia de dados: outro aparelho publicou → esta tela recarrega ----
// Evita sessões desatualizadas (que mostram dados velhos e, pior, poderiam
// salvar dados velhos por cima dos novos). Nunca derruba no meio de uma
// revisão aberta nem com alterações locais ainda não publicadas.
let DATA_TAG = null;
async function dataTag(){
  try {
    const r = await fetch('dados.enc.json', { method:'HEAD', cache:'no-store' });
    return r.headers.get('etag') || r.headers.get('last-modified') || null;
  } catch(e){ return null; }
}
window.__dataTagRefresh = () => dataTag().then(t => { if (t != null) DATA_TAG = t; });
async function dataCheck(){
  const t = await dataTag();
  if (t == null) return;
  if (DATA_TAG == null){ DATA_TAG = t; return; }
  if (t !== DATA_TAG){
    if (IMP || FIMP || Vault.dirtyLocal || Vault.pubStatus === 'publicando') return;
    sessionStorage.setItem('fp-dados','1');
    location.reload();
  }
}
dataTag().then(t => { DATA_TAG = t; });
setInterval(dataCheck, 120000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) dataCheck(); });
on('gh-save', ghAtivar);
on('gh-off', ghDesativar);
renderGh();
on('ia-save', iaAtivar);
on('ia-off', iaDesativar);
renderIa();
on('p27-aplicar', p27Salvar);
on('mt-aplicar', metasSalvar);
renderConfigForms();
if (Vault.dirtyLocal) Vault.autoPublish();   // descarrega pendências antigas ao entrar
on('ac-add', acCriar);
on('pw-change', pwTrocar);
for (const id of ['tx-regime','tx-grupo','tx-cat','tx-org']){
  const el = document.getElementById(id); if (el) el.addEventListener('change', renderTx);
}
{ const el = document.getElementById('tx-busca'); if (el) el.addEventListener('input', renderTx); }

renderCabecalho();
renderContas(); renderReservas(); renderMetas(); renderPatrimonio(); renderAgenda(); renderPend(); renderEstrategia(); renderPlano();
renderDocs(); renderTx(); renderAcessos();
render();

// se o HTML em cache for de outra versão (falta a página de Configurações),
// recarrega uma única vez para realinhar — o vigia de versão cobre o resto
if (!document.getElementById('page-config')){
  if (!sessionStorage.getItem('fp-skew')){ sessionStorage.setItem('fp-skew','1'); location.reload(); }
} else sessionStorage.removeItem('fp-skew');
