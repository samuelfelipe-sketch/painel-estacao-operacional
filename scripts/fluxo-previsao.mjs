/* Previsão e projeção do Fluxo de Caixa — método do projeto, automatizado.

   Regras (doc de regras 5 e 6, "Previsão", com as decisões do Samuel de 23/10/2026):
   - a previsão é do ORDINÁRIO: valor mensal = MEDIANA dos meses completos (tipo
     full) em que a empresa existe, calculada por BLOCO de contas (receita bruta;
     custos; tributos + impostos sobre o lucro; despesas 3.x; financeiras) e
     repartida entre as contas do bloco pelo mix do último mês fechado — assim a
     troca de rótulo entre meses (boleto → PIX, IRPJ → DARF em Tributos) não
     derruba a mediana de cada conta;
   - mês de ARRANQUE de uma empresa (primeiro mês com dados, quando já havia mês
     fechado antes dele — ex.: Safyr em jul/2026, adquirida) fica fora da base;
   - captações, amortizações do giro rotativo, resgates, aquisições, aplicações e
     "Outras entradas" (transferências de contas fora do arquivo) = zero;
   - serviço da dívida / consórcio / parcelas contratadas (SÓ em pagamentos):
     só as contas que ainda aparecem no último mês fechado (contrato encerrado
     sai sozinho); valor = mediana dos últimos 3 meses em que aparecem, nas
     DATAS do último mês fechado;
   - um RECEBIMENTO rotulado como dívida/investimento (ex.: crédito de
     financiamento que caiu em "Serviço da dívida — parcelas") é captação:
     nunca entra na previsão (= zero), em nenhum dos dois caminhos;
   - DISTRIBUIÇÕES de lucros programadas (seção `previsao.distribuicoes` de
     fluxo/regras.enc.json — valores cifrados, nunca no código): valor fixo no
     dia combinado (dia útil anterior se cair no fim de semana), nos meses
     indicados, mais lançamentos extras pontuais por mês;
   - distribuição no mês: perfil por dia do mês (share médio no diário dos
     meses-base) define as semanas; dentro da semana, perfil de dia da semana do
     projeto (recebimentos seg→dom 30/16/15/14/15/5/5 %, pagamentos 28/20/18/18/16/0/0 %);
   - a previsão de um mês é FIXADA na abertura: o mês corrente (parcial) e os
     fechados nunca são reescritos; meses futuros (tipo prev) são recalculados
     na virada do mês, quando um mês novo fecha (--refazer);
   - títulos agendados no Argo (regra max(mediana, agendado)) NÃO entram: a
     rotina não lê o Argo — a nota do mês diz isso.
   - projeção (card "Projeção"): os DOIS meses seguintes ao último mês fechado,
     com os totais da previsão; saldo-base = caixa do grupo no fim desse mês.
     O embute troca os rótulos do card a partir de PROJ.meta.

   Uso:
     node scripts/fluxo-previsao.mjs fixa --estado <pasta>/estado [--mes AAAA-MM | --proximos N] [--refazer] [--regras fluxo/regras.enc.json | --sem-regras]
     node scripts/fluxo-previsao.mjs proj --estado <pasta>/estado
   Logs sem números do caixa. */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { falha, foraDoRepo, opt, temFlag, chave, decifra } from './fluxo-lib.mjs';
import { wkOf, nSemanas } from './fluxo-montagem.mjs';

const EXCLUIR = /^Captação|amortizações do giro rotativo|^Distribuição|Resgate|aquisição|Aquisição|Imobilizado|^6 · Aplicações|^Entre empresas|^Outras entradas/i;
const PARCELAS = /^Serviço da dívida|parcelas contratadas|consórcio/i;
/* rótulos de saída (dívida, investimento) que, aparecendo em RECEBIMENTOS, são captação/estorno: fora da previsão */
const SO_SAIDA = /Serviço da dívida|^6 ·|Investimentos|financiamento|Aplicações/i;
/* blocos da mediana (conta que não casa com nenhum é bloco próprio) */
export const BLOCOS = [
  ['receita bruta', /^1 · Receita/],
  ['custos', /^2 · Custos/],
  ['tributos e impostos', /^2\.1 · Tributos|^7 · Impostos/],
  ['despesas', /^3\./],
  ['financeiras', /^5 · Despesas financeiras/],
];
const CONTA_DISTRIB = 'Distribuição de lucros';
const PESO_IN = [5, 30, 16, 15, 14, 15, 5], PESO_OUT = [0, 28, 20, 18, 18, 16, 0]; /* índice = getDay (dom=0) */
const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const r2 = n => Math.round(n * 100) / 100, sum = a => (a || []).reduce((x, y) => x + (y || 0), 0);
const med = a => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const mean = a => a.length ? sum(a) / a.length : 0;
const dd = n => String(n).padStart(2, '0');
const mesSeguinte = m => { const [a, mm] = m.split('-').map(Number); return mm === 12 ? `${a + 1}-01` : `${a}-${dd(mm + 1)}`; };
const nDias = m => { const [a, mm] = m.split('-').map(Number); return new Date(a, mm, 0).getDate(); };
export function semanasDoMes(ano, mm) { const nd = nDias(`${ano}-${dd(mm)}`); const nw = nSemanas(ano, mm, nd); const out = []; for (let w = 0; w < nw; w++) { const ds = []; for (let d = 1; d <= nd; d++) if (wkOf(ano, mm, d) === w) ds.push(d); out.push(`S${w + 1} · ${dd(ds[0])}–${dd(ds[ds.length - 1])}`); } return out; }
const blocoDe = c => { const b = BLOCOS.find(([, re]) => re.test(c)); return b ? b[0] : 'conta: ' + c; };
/* dia útil (seg–sex) do mês: cai no fim de semana → dia útil anterior; nunca passa do fim do mês */
export function diaUtil(ano, mm, dia) { const nd = nDias(`${ano}-${dd(mm)}`); let d = Math.min(Math.max(1, dia), nd); while (d > 1 && [0, 6].includes(new Date(ano, mm - 1, d).getDay())) d--; return d; }

/* regras cifradas (fluxo/regras.enc.json → previsao): distribuições programadas e meses de arranque */
export function carregaRegrasPrevisao(arquivo = 'fluxo/regras.enc.json') {
  if (!existsSync(arquivo)) return {};
  const doc = decifra(JSON.parse(readFileSync(arquivo, 'utf8')), chave(), 'as regras');
  return doc.previsao || {};
}
/* mês de arranque: primeiro mês com dados da empresa, quando já existe mês fechado anterior a ele
   (empresa que entrou no grupo com o ano andando); `regras.arranque[id]` = 'AAAA-MM' | null sobrepõe */
export function mesDeArranque(DATA, id, regras = {}) {
  const arr = regras.arranque || {};
  if (Object.prototype.hasOwnProperty.call(arr, id)) return arr[id] || null;
  const full = Object.keys(DATA.meses).filter(m => DATA.meses[m].tipo === 'full').sort();
  const comDados = full.filter(m => DATA.meses[m].empresas && DATA.meses[m].empresas[id] && (DATA.meses[m].empresas[id].contas || []).length);
  if (!comDados.length) return null;
  const m0 = comDados[0];
  return full.some(m => m < m0) ? m0 : null;
}
/* distribuições programadas da empresa no mês: [{valor, dia}] */
export function distribuicoesDoMes(regras, id, mes) {
  const cfg = ((regras || {}).distribuicoes || {})[id]; if (!cfg) return [];
  const [ano, mm] = mes.split('-').map(Number); const out = [];
  const recorrente = cfg.meses === 'todos' || (Array.isArray(cfg.meses) && cfg.meses.includes(mm));
  if (recorrente && cfg.valor) out.push({ valor: r2(cfg.valor), dia: diaUtil(ano, mm, cfg.dia || 25) });
  const ex = (cfg.extras || {})[mes];
  if (ex) { const v = typeof ex === 'number' ? ex : ex.valor; const d = typeof ex === 'number' ? (cfg.dia || 25) : (ex.dia || cfg.dia || 25); if (v) out.push({ valor: r2(v), dia: diaUtil(ano, mm, d) }); }
  return out;
}

/* previsão de um mês para todas as empresas, a partir do estado */
export function calculaPrevisao(est, mes, regras = {}) {
  const { DATA, DIA } = est;
  const [ano, mm] = mes.split('-').map(Number); const nd = nDias(mes), nw = nSemanas(ano, mm, nd);
  const full = Object.keys(DATA.meses).filter(m => m < mes && DATA.meses[m].tipo === 'full').sort();
  if (!full.length) throw new Error('nenhum mês fechado antes de ' + mes);
  const empresas = [...new Set(full.flatMap(m => Object.keys(DATA.meses[m].empresas || {})))];
  const prevM = { empresas: {} }, prevD = {}; const notas = [];
  const arranques = [];
  const semanaDe = dias => { const sem = new Array(nw).fill(0); dias.forEach((v, d) => { const w = wkOf(ano, mm, d + 1); sem[w] = r2(sem[w] + v); }); return sem; };
  const reparte = (total, perfil) => {
    const sp = sum(perfil); const dias = perfil.map(p => r2(total * p / sp));
    const resto = r2(total - sum(dias)); if (Math.abs(resto) >= 0.01) { let k = dias.length - 1; while (k > 0 && !dias[k]) k--; dias[k] = r2(dias[k] + resto); }
    return dias;
  };
  for (const id of empresas) {
    const arranque = mesDeArranque(DATA, id, regras); if (arranque) arranques.push(`${id} ${MESES_PT[+arranque.slice(5) - 1].toLowerCase()}`);
    const baseE = full.filter(m => m !== arranque && DATA.meses[m].empresas[id] && (DATA.meses[m].empresas[id].contas || []).length);
    const out = { cin: {}, cout: {} }, outD = { cin: {}, cout: {} };
    const valorDe = (m, t, c) => sum((DATA.meses[m].empresas[id][t] || {})[c]);
    const diario = (m, t, c) => { const e = (DIA[m] || {}).empresas; return e && e[id] && e[id][t] && e[id][t][c]; };
    /* perfil por dia do mês da conta: share médio no diário dos meses-base; sem diário → dia da semana */
    const perfilConta = (t, c) => {
      const shares = [...Array(nd)].map(() => []);
      for (const m of baseE) { const arr = diario(m, t, c); const tm = sum(arr); if (!arr || !tm) continue; for (let d = 0; d < nd; d++) shares[d].push((arr[Math.min(d, arr.length - 1)] || 0) / tm); }
      let perfil = shares.map(s => mean(s));
      if (!sum(perfil)) perfil = [...Array(nd)].map((_, d) => (t === 'cin' ? PESO_IN : PESO_OUT)[new Date(ano, mm - 1, d + 1).getDay()] || 0);
      if (!sum(perfil)) perfil = new Array(nd).fill(1);
      /* semanas pelo perfil do dia do mês; dias dentro da semana pelo dia da semana */
      const semana = new Array(nw).fill(0); perfil.forEach((p, d) => { semana[wkOf(ano, mm, d + 1)] += p; });
      const peso = t === 'cin' ? PESO_IN : PESO_OUT; const diasW = [...Array(nw)].map(() => []); for (let d = 1; d <= nd; d++) diasW[wkOf(ano, mm, d)].push(d);
      const novo = new Array(nd).fill(0);
      for (let w = 0; w < nw; w++) { const ps = diasW[w].map(d => peso[new Date(ano, mm - 1, d).getDay()]); const sp = sum(ps) || diasW[w].length; diasW[w].forEach((d, i) => { novo[d - 1] = semana[w] * ((sum(ps) ? ps[i] : 1) / sp); }); }
      return novo;
    };
    const poe = (t, c, total, perfil) => { total = r2(total); if (!total) return; const dias = reparte(total, perfil); out[t][c] = semanaDe(dias); outD[t][c] = dias; };
    if (baseE.length) for (const t of ['cin', 'cout']) {
      const contas = [...new Set(baseE.flatMap(m => Object.keys(DATA.meses[m].empresas[id][t] || {})))].filter(c => !EXCLUIR.test(c) && !(t === 'cin' && SO_SAIDA.test(c)));
      const ultimo = baseE[baseE.length - 1];
      const blocos = {};
      for (const c of contas) {
        if (t === 'cout' && PARCELAS.test(c)) {
          /* cronograma: só o que ainda aparece no ÚLTIMO mês fechado (contrato
             encerrado ou relabelado sai sozinho); valor = mediana dos últimos 3
             meses em que aparece; datas = as do último mês fechado */
          const comValor = baseE.filter(m => valorDe(m, t, c) > 0);
          if (comValor.slice(-1)[0] !== ultimo) continue;
          const total = med(comValor.slice(-3).map(m => valorDe(m, t, c)));
          const arr = diario(ultimo, t, c); let perfil = null;
          if (arr && sum(arr) > 0) { perfil = new Array(nd).fill(0); arr.forEach((v, i) => { perfil[Math.min(i, nd - 1)] += v / sum(arr); }); }
          poe(t, c, total, perfil || perfilConta(t, c));
          continue;
        }
        (blocos[blocoDe(c)] = blocos[blocoDe(c)] || []).push(c);
      }
      /* mediana por bloco; mix do último mês fechado em que o bloco teve valor */
      for (const membros of Object.values(blocos)) {
        const totais = baseE.map(m => membros.reduce((a, c) => a + valorDe(m, t, c), 0));
        const total = r2(med(totais)); if (!total) continue;
        let ref = null; for (let i = baseE.length - 1; i >= 0; i--) if (totais[i] > 0) { ref = baseE[i]; break; }
        if (!ref) continue;
        const tRef = membros.reduce((a, c) => a + valorDe(ref, t, c), 0);
        const partes = membros.map(c => ({ c, v: r2(total * valorDe(ref, t, c) / tRef) })).filter(p => p.v > 0);
        const resto = r2(total - partes.reduce((a, p) => a + p.v, 0)); if (partes.length && Math.abs(resto) >= 0.01) partes[0].v = r2(partes[0].v + resto);
        for (const p of partes) poe(t, p.c, p.v, perfilConta(t, p.c));
      }
    }
    /* distribuições programadas (decisão do Samuel, 23/10/2026): valor fixo no dia combinado */
    for (const { valor, dia } of distribuicoesDoMes(regras, id, mes)) {
      const dias = (outD.cout[CONTA_DISTRIB] || new Array(nd).fill(0)).slice(); dias[dia - 1] = r2(dias[dia - 1] + valor);
      outD.cout[CONTA_DISTRIB] = dias; out.cout[CONTA_DISTRIB] = semanaDe(dias);
    }
    if (!Object.keys(out.cin).length && !Object.keys(out.cout).length) continue;
    prevM.empresas[id] = out; prevD[id] = outD;
  }
  notas.push(`base: ${full.map(m => MESES_PT[+m.slice(5) - 1].toLowerCase()).join(', ')}`);
  if (arranques.length) notas.push(`arranque fora da base: ${arranques.join(', ')}`);
  const comDistrib = Object.keys(prevM.empresas).filter(id => prevM.empresas[id].cout[CONTA_DISTRIB]);
  if (comDistrib.length) notas.push(`distribuições programadas: ${comDistrib.join(', ')}`);
  return { prev: prevM, prevDia: prevD, nd, nw, base: full, notas };
}

export function calculaProjecao(est) {
  const { DATA, PREV } = est;
  const full = Object.keys(DATA.meses).filter(m => DATA.meses[m].tipo === 'full').sort(); const baseM = full.pop();
  if (!baseM) throw new Error('nenhum mês fechado');
  const m1 = mesSeguinte(baseM), m2 = mesSeguinte(m1);
  if (!PREV[m1] || !PREV[m2]) throw new Error(`falta previsão de ${m1}/${m2} — rode "fixa" antes.`);
  const empresas = {};
  for (const id of new Set([...Object.keys(PREV[m1].empresas), ...Object.keys(PREV[m2].empresas)])) {
    const e = { cin: {}, cout: {} };
    for (const t of ['cin', 'cout']) for (const c of new Set([...Object.keys((PREV[m1].empresas[id] || { [t]: {} })[t]), ...Object.keys((PREV[m2].empresas[id] || { [t]: {} })[t])])) e[t][c] = [r2(sum(((PREV[m1].empresas[id] || {})[t] || {})[c])), r2(sum(((PREV[m2].empresas[id] || {})[t] || {})[c]))];
    empresas[id] = e;
  }
  const saldo_base = r2(Object.values(DATA.meses[baseM].empresas).reduce((a, e) => a + (e.contas || []).reduce((x, c) => x + (c.fim || 0), 0), 0));
  const [ba, bm] = baseM.split('-').map(Number);
  const rot = m => MESES_PT[+m.slice(5) - 1]; const nome = m => ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][+m.slice(5) - 1];
  return { empresas, saldo_base, meta: { base_mes: baseM, meses: [m1, m2], base_em: `${dd(nDias(baseM))}/${dd(bm)}`, fim_em: `${dd(nDias(m2))}/${m2.slice(5)}`, curto: `${rot(m1)}+${rot(m2)}`, titulo: `${nome(m1)} e ${nome(m2)}/${m2.slice(0, 4)}`, cols: [`${rot(m1)} (proj)`, `${rot(m2)} (proj)`], base_meses: Object.keys(DATA.meses).filter(m => DATA.meses[m].tipo === 'full').map(m => rot(m).toLowerCase()).join(', '), gerado_em: new Date().toISOString().slice(0, 10) } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2); const modo = args[0];
  const pasta = opt(args, 'estado'); if (!pasta) falha('informe --estado <pasta>/estado.'); foraDoRepo(pasta, '--estado');
  const le = n => JSON.parse(readFileSync(join(pasta, n + '.json'), 'utf8')), grava = (n, v) => writeFileSync(join(pasta, n + '.json'), JSON.stringify(v));
  const est = { DATA: le('DATA'), DIA: le('DIA'), PREV: le('PREV'), MES_WEEKS: le('MES_WEEKS'), MES_LABEL: le('MES_LABEL') };
  if (modo === 'fixa') {
    const refazer = temFlag(args, 'refazer');
    const regras = temFlag(args, 'sem-regras') ? {} : carregaRegrasPrevisao(opt(args, 'regras', 'fluxo/regras.enc.json'));
    if (!temFlag(args, 'sem-regras') && !regras.distribuicoes) console.log('aviso: regras cifradas sem seção "previsao" — sem distribuições programadas.');
    const parcial = Object.keys(est.DATA.meses).filter(m => est.DATA.meses[m].tipo === 'parcial').sort().pop();
    const ultimoFull = Object.keys(est.DATA.meses).filter(m => est.DATA.meses[m].tipo === 'full').sort().pop();
    const inicio = mesSeguinte(parcial || ultimoFull);
    let alvos = [];
    if (opt(args, 'mes')) alvos = [opt(args, 'mes')];
    else { const n = +(opt(args, 'proximos') || 3); let m = inicio; for (let i = 0; i < n; i++) { alvos.push(m); m = mesSeguinte(m); } if (refazer) for (const m of Object.keys(est.DATA.meses)) if (est.DATA.meses[m].tipo === 'prev' && m >= inicio && !alvos.includes(m)) alvos.push(m); }
    alvos.sort(); let feitos = 0, pulados = 0;
    for (const mes of alvos) {
      const tipo = (est.DATA.meses[mes] || {}).tipo;
      if (tipo && tipo !== 'prev') { pulados++; continue; }                       /* mês com realizado: previsão fixada, não se mexe */
      if (est.PREV[mes] && !refazer) { pulados++; continue; }
      /* mês que já começou no calendário tem previsão fixada na abertura: só se refaz pedindo o mês explicitamente */
      if (est.PREV[mes] && refazer && !opt(args, 'mes') && mes <= new Date().toISOString().slice(0, 7)) { pulados++; continue; }
      let r; try { r = calculaPrevisao(est, mes, regras); } catch (e) { falha(e.message); }
      const [ano, mm] = mes.split('-').map(Number);
      const refeita = !!est.PREV[mes];
      est.PREV[mes] = r.prev;
      est.DIA[mes] = { ...(est.DIA[mes] || { dias: 0, empresas: {} }), nd: r.nd, prev: r.prevDia };
      if (!est.DATA.meses[mes]) est.DATA.meses[mes] = { tipo: 'prev' };
      if (!est.MES_WEEKS[mes]) est.MES_WEEKS[mes] = semanasDoMes(ano, mm);
      if (!est.MES_LABEL[mes]) est.MES_LABEL[mes] = MESES_PT[mm - 1];
      feitos++; console.log(`previsão ${mes}: ${Object.keys(r.prev.empresas).length} empresas · ${r.notas.join(' · ')}${refeita ? ' (refeita)' : ''}`);
    }
    /* ordena DATA.meses e MES_LABEL por mês (a ferramenta lê na ordem das chaves) */
    for (const k of ['DATA', 'MES_WEEKS', 'MES_LABEL']) { const o = k === 'DATA' ? est.DATA.meses : est[k]; const ord = {}; for (const m of Object.keys(o).sort()) ord[m] = o[m]; if (k === 'DATA') est.DATA.meses = ord; else est[k] = ord; }
    grava('DATA', est.DATA); grava('DIA', est.DIA); grava('PREV', est.PREV); grava('MES_WEEKS', est.MES_WEEKS); grava('MES_LABEL', est.MES_LABEL);
    console.log(`fixa: ${feitos} mês(es) previsto(s), ${pulados} mantido(s)`);
  } else if (modo === 'proj') {
    let p; try { p = calculaProjecao(est); } catch (e) { falha(e.message); }
    grava('PROJ', p); console.log(`projeção: ${p.meta.curto} a partir de ${p.meta.base_em} · ${Object.keys(p.empresas).length} empresas`);
  } else falha('modo desconhecido — use "fixa" ou "proj".');
}
