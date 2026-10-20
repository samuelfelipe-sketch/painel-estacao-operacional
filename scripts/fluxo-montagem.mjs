/* Montagem do Fluxo de Caixa de uma empresa num mês, a partir dos extratos
   já lidos (fluxo-extratos) e classificados (fluxo-classifica).

   - Junta as contas da empresa; o caixa inicial/final da empresa é a soma
     dos saldos das contas.
   - Casa sweeps entre contas próprias (saída −X num dia bate com entrada +X
     no mesmo dia noutra conta da mesma empresa) e os neutraliza: giro e
     intercompany vão para a linha "Entre empresas e financiamentos (líquido
     — fora do total)" (icw), não para cin/cout operacionais.
   - Agrega em semanas seg→dom (DATA) e por dia (DIA), por conta do plano.
   - Concilia: Σini + Σcin − Σcout + Σicw = Σfim, por empresa e mês, no centavo.

   Produz objetos no formato que a ferramenta usa:
     DATA.meses[mes].empresas[empresa] = { cin, cout, icw, contas }
     DIA[mes].empresas[empresa]        = { cin, cout, icw }

   Uso (teste): node scripts/fluxo-montagem.mjs <empresa> <mes AAAA-MM> <banco:arq.txt> [banco:arq.txt ...] */
import { readFileSync } from 'fs';
import { PARSERS } from './fluxo-extratos.mjs';
import { classifica } from './fluxo-classifica.mjs';

const round2 = n => Math.round(n * 100) / 100;
export function wkOf(ano, mes, dia) { const off = (new Date(ano, mes - 1, 1).getDay() + 6) % 7; return Math.floor((dia - 1 + off) / 7); }
export function nSemanas(ano, mes, nd) { return wkOf(ano, mes, nd) + 1; }
const arredObj = o => { const r = {}; for (const k of Object.keys(o)) r[k] = o[k].map(round2); return r; };

/* ajustes = [{empresa?, banco?, data?, valor?, contem?, conta, giro?}]: decisões da
   Rotina (ou do Samuel) que prevalecem sobre a classificação automática */
export function aplicaAjuste(c, ajustes, empresa) {
  for (const a of ajustes || []) {
    if (a.empresa && a.empresa !== empresa) continue;
    if (a.banco && a.banco !== c.banco) continue;
    if (a.data && a.data !== c.data) continue;
    if (a.valor != null && Math.abs(Math.abs(a.valor) - Math.abs(c.valor)) > 0.005) continue;
    if (a.contem && !c.desc.toUpperCase().includes(String(a.contem).toUpperCase())) continue;
    c.conta = a.conta; c.confia = true; c.ajustado = true; c.intercompany = false; c.abate = !!a.abate;
    c.giro = a.giro === true; c.proprio = a.giro === true; c.pix = false; c.sispag = false;
    return c;
  }
  return c;
}
export function montaEmpresa({ empresa, mes, extratos, fornMap, ajustes }) {
  const [ano, mm] = mes.split('-').map(Number);
  const nd = new Date(ano, mm, 0).getDate();
  const nw = nSemanas(ano, mm, nd);
  const cinW = {}, coutW = {}, cinD = {}, coutD = {};
  const icwW = new Array(nw).fill(0), icwD = new Array(nd).fill(0);
  const contas = [];
  const classificados = [];
  for (const ex of extratos) {
    contas.push({ banco: ex.banco, ini: round2(ex.saldoAnterior), fim: round2(ex.saldoFinal) });
    for (const m of ex.mov) classificados.push(aplicaAjuste({ ...classifica(m, { empresa, fornMap }), banco: ex.banco }, ajustes, empresa));
  }
  /* casamento de sweeps: saída e entrada próprias, mesmo dia e |valor|, contas diferentes */
  const giro = classificados.filter(c => c.giro && c.proprio);
  const casados = new Set();
  for (let i = 0; i < giro.length; i++) {
    if (casados.has(i)) continue;
    for (let j = 0; j < giro.length; j++) {
      if (i === j || casados.has(j)) continue;
      if (giro[i].data === giro[j].data && giro[i].banco !== giro[j].banco && round2(giro[i].valor + giro[j].valor) === 0) { casados.add(i); casados.add(j); giro[i].sweepCasado = giro[j].sweepCasado = true; break; }
    }
  }
  /* sem par (todas as contas lidas): entrada PIX em nome próprio = liquidação
     de maquininha/QR (Sipag) = Cartões (regra 7); SISPAG sem par = fornecedor
     (mercadorias); o resto fica como "Outras entradas/saídas" marcado para
     revisão — a linha "Entre empresas" fica só para empréstimos entre empresas */
  let giroSemPar = 0;
  for (const c of giro) {
    if (c.sweepCasado) continue;
    if (c.valor > 0 && c.pix) { c.giro = false; c.proprio = false; c.conta = '1 · Receita — Cartões e adquirência'; c.confia = true; }
    else if (c.sispag) { c.giro = false; c.proprio = false; /* mantém conta=mercadorias, confia=false */ }
    else { c.giro = false; c.proprio = false; c.conta = c.valor > 0 ? 'Outras entradas' : 'Outras saídas'; c.confia = false; c.semPar = true; giroSemPar++; }
  }
  let revisao = 0;
  for (const c of classificados) {
    const dd = +c.data.split('-')[2], w = wkOf(ano, mm, dd), di = dd - 1;
    if (c.giro) { icwW[w] += c.valor; icwD[di] += c.valor; if (!c.confia) revisao++; continue; } /* intercompany operacional (aluguel, frete, boleto) fica em cin/cout */
    if (!c.confia) revisao++;
    if (c.abate) { /* estorno/devolução abate a conta de receita correspondente */
      (cinW[c.conta] = cinW[c.conta] || new Array(nw).fill(0))[w] += c.valor; (cinD[c.conta] = cinD[c.conta] || new Array(nd).fill(0))[di] += c.valor; continue;
    }
    if (c.valor >= 0) { (cinW[c.conta] = cinW[c.conta] || new Array(nw).fill(0))[w] += c.valor; (cinD[c.conta] = cinD[c.conta] || new Array(nd).fill(0))[di] += c.valor; }
    else { (coutW[c.conta] = coutW[c.conta] || new Array(nw).fill(0))[w] += -c.valor; (coutD[c.conta] = coutD[c.conta] || new Array(nd).fill(0))[di] += -c.valor; }
  }
  /* giro rotativo do mês: [captado, amortizado] (contratos C59830287 PS / C69830413 SF) */
  const captado = classificados.filter(c => c.captacao && /C59830287|C69830413/.test(c.conta)).reduce((a, c) => a + c.valor, 0);
  const amortizado = classificados.filter(c => c.divida && /giro rotativo/.test(c.conta)).reduce((a, c) => a - c.valor, 0);
  const sum = o => Object.values(o).reduce((a, v) => a + v.reduce((x, y) => x + y, 0), 0);
  const ini = contas.reduce((a, c) => a + c.ini, 0), fim = contas.reduce((a, c) => a + c.fim, 0);
  const sIn = sum(cinW), sOut = sum(coutW), sIcw = icwW.reduce((a, b) => a + b, 0);
  const dif = round2(ini + sIn - sOut + sIcw - fim);
  return {
    empresa, mes, nd, nw,
    DATA: { cin: arredObj(cinW), cout: arredObj(coutW), icw: icwW.map(round2), contas, giro: [round2(captado), round2(amortizado)], icin: {}, icout: {} },
    DIA: { cin: arredObj(cinD), cout: arredObj(coutD), icw: icwD.map(round2) },
    reconcilia: Math.abs(dif) <= 0.015, dif,
    ini: round2(ini), fim: round2(fim), totalIn: round2(sIn), totalOut: round2(sOut), icwTotal: round2(sIcw),
    lancamentos: classificados.length, revisao, sweepsCasados: casados.size / 2, giroSemPar,
    classificados,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const empresa = process.argv[2], mes = process.argv[3];
  const extratos = process.argv.slice(4).map(a => {
    const [banco, arq] = a.split(':');
    const o = PARSERS[banco](readFileSync(arq, 'utf8'));
    return { banco, saldoAnterior: o.saldoAnterior, saldoFinal: o.saldoFinal, mov: o.mov };
  });
  const r = montaEmpresa({ empresa, mes, extratos });
  console.log(`${empresa} ${mes}: ini ${r.ini} → fim ${r.fim}`);
  console.log(`  entradas ${r.totalIn} · saídas ${r.totalOut} · entre empresas/giro ${r.icwTotal}`);
  console.log(`  ${r.lancamentos} lançamentos · ${r.sweepsCasados} sweeps casados · ${r.giroSemPar} giro(s) sem par · ${r.revisao} p/ revisão · rotativo captado/amortizado ${r.DATA.giro.join(' / ')}`);
  console.log(`  concilia: ${r.reconcilia ? 'OK (centavo)' : 'NÃO (dif ' + r.dif + ')'}`);
}
