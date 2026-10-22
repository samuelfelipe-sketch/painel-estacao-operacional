/* Carrega um mês de extratos no estado da ferramenta de Fluxo de Caixa.

   Entrada: a pasta de extratos em texto (<pasta>/<empresa>/<banco>.txt, como o
   fluxo-leituras grava) e a pasta do estado aberto (fluxo-estado abre →
   <pasta>/estado/*.json). Para cada empresa: lê (fluxo-extratos), classifica
   (fluxo-classifica + mapa de fornecedores + ajustes), monta semanas/dias
   (fluxo-montagem) e concilia no centavo. Depois regrava no estado:
     DATA.meses[mes]  (tipo full/parcial, empresas, nota)
     DIA[mes]         (dias, nd, empresas; `prev` existente é preservado)
     MES_WEEKS/MES_LABEL do mês, STATUS (dados_ate, atualizado, extratos) e
     PAINEL (hoje, mes, wk, saldo/ref por empresa)
   PREV/PROJ/ERP/VENDAS/METAS/COMPROMISSOS/RECEBER/PEND não são tocados aqui.

   Formatos: o fluxo-extratos decide pelo conteúdo (PDF/TXT, OFX, XLSX da Stone, XLS do
   Sicredi, CSV do Itaú, tabelas). Conta cujo arquivo não traz saldo (CSV do Itaú, XLS sem
   lançamentos) é ancorada no fechamento do mês anterior do painel (aviso no relatório).
   Conta que existia no mês anterior e não veio nesta carga BLOQUEIA a carga.

   Garantias: nenhuma empresa é gravada sem conciliar; mês já fechado (dias =
   nd) só se refaz com --refazer; empresa sem extrato nesta rodada mantém o que
   já tinha no mês (e a nota avisa). O relatório de revisão vai para um arquivo
   FORA do repositório (--relatorio) — é o que a Rotina lê para decidir ajustes.

   Uso:
     node scripts/fluxo-mes.mjs --mes AAAA-MM --extratos <pasta> --estado <pasta>/estado
          [--fornecedores <fornecedores.json aberto>] [--ajustes <ajustes.json>]
          [--ate DD] [--refazer] [--nota "texto extra"] [--relatorio <arquivo.txt>] [--so-conferir]
          [--sem <ids>] [--sem-conta <empresa:banco,…>]   (exceções SÓ com decisão do Samuel — ver RUNBOOK)
   Logs sem números do caixa (o relatório, fora do repo, tem tudo). */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { falha, foraDoRepo, opt, temFlag, contaEncerrada } from './fluxo-lib.mjs';
import { PARSERS } from './fluxo-extratos.mjs';
import { montaEmpresa, wkOf, nSemanas } from './fluxo-montagem.mjs';
import { carregaMapa } from './fluxo-fornecedores.mjs';
import { nomeDoMemo } from './fluxo-lib.mjs';

export const EMP_ID = { ps: 'sapatao', sf: 'sf', as: 'safyr', siss: 'siss', st: 'transportes', ss: 'servicos' };
export const BANCO_NOME = { sicredi: 'Sicredi', stone: 'Stone', unicred: 'Unicred', banrisul: 'Banrisul', bradesco: 'Bradesco', itau: 'Itaú (ag. 0912)', pagbank: 'PagBank' };
const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const r2 = n => Math.round(n * 100) / 100;
const dd = n => String(n).padStart(2, '0');
const brl = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function semanasDoMes(ano, mm) {
  const nd = new Date(ano, mm, 0).getDate(); const nw = nSemanas(ano, mm, nd); const out = [];
  for (let w = 0; w < nw; w++) { const dias = []; for (let d = 1; d <= nd; d++) if (wkOf(ano, mm, d) === w) dias.push(d); out.push(`S${w + 1} · ${dd(dias[0])}–${dd(dias[dias.length - 1])}`); }
  return out;
}

const args = process.argv.slice(2);
const mes = opt(args, 'mes'); if (!/^\d{4}-\d{2}$/.test(mes || '')) falha('informe --mes AAAA-MM.');
const pastaExt = opt(args, 'extratos'), pastaEst = opt(args, 'estado'); if (!pastaExt || !pastaEst) falha('informe --extratos <pasta> e --estado <pasta>/estado.');
foraDoRepo(pastaExt, '--extratos'); foraDoRepo(pastaEst, '--estado');
const [ano, mm] = mes.split('-').map(Number); const nd = new Date(ano, mm, 0).getDate();
const hoje = new Date(); const hojeISO = hoje.toISOString().slice(0, 10);
const le = n => { const p = join(pastaEst, n + '.json'); if (!existsSync(p)) falha('falta ' + p); return JSON.parse(readFileSync(p, 'utf8')); };
const grava = (n, v) => writeFileSync(join(pastaEst, n + '.json'), JSON.stringify(v));
const DATA = le('DATA'), DIA = le('DIA'), MES_WEEKS = le('MES_WEEKS'), MES_LABEL = le('MES_LABEL'), STATUS = le('STATUS'), PAINEL = le('PAINEL');
const fornArq = opt(args, 'fornecedores');
const fornMap = fornArq ? JSON.parse(readFileSync(fornArq, 'utf8')) : carregaMapa();
if (!fornMap) console.log('aviso: sem mapa de fornecedores (fluxo/fornecedores.enc.json) — só regras de memo.');
const ajustes = opt(args, 'ajustes') ? JSON.parse(readFileSync(opt(args, 'ajustes'), 'utf8')) : [];
const refazer = temFlag(args, 'refazer'), soConferir = temFlag(args, 'so-conferir');
const semEmp = (opt(args, 'sem') || '').split(',').filter(Boolean); /* empresas deliberadamente fora desta carga (só 'ss' é aceita sem pergunta — RUNBOOK) */

/* mês já fechado? */
const diaAtual = DIA[mes];
if (diaAtual && diaAtual.dias >= nd && !refazer) falha(`${mes} já está fechado no diário (${nd} dias) — use --refazer para reprocessar.`);

/* lê os extratos */
const empresas = readdirSync(pastaExt).filter(e => EMP_ID[e] && existsSync(join(pastaExt, e)) && readdirSync(join(pastaExt, e)).some(f => f.endsWith('.txt'))).sort();
if (!empresas.length) falha('nenhuma pasta de empresa com extratos em ' + pastaExt);
/* mês anterior no painel: âncora dos formatos sem saldo e lista das contas esperadas */
const mesAnt = mm === 1 ? `${ano - 1}-12` : `${ano}-${dd(mm - 1)}`;
const antM = (DATA.meses[mesAnt] || {}).empresas || {};
const semConta = (opt(args, 'sem-conta') || '').split(',').filter(Boolean); /* "ps:unicred,…" — conta deliberadamente fora (só com decisão do Samuel) */
const resultados = {}; const rel = []; let ultimoDia = 0; const avisos = []; const formatosUsados = new Set(); const faltamContas = []; const encerradas = [];
for (const e of empresas) {
  const extratos = [];
  const porBanco = {};
  for (const f of readdirSync(join(pastaExt, e)).filter(f => f.endsWith('.txt')).sort()) {
    const m = f.match(/^([a-z]+)(?:\.(\d+))?\.txt$/); const banco = m && m[1];
    if (!banco || !PARSERS[banco]) { avisos.push(`${e}/${f}: banco desconhecido, ignorado`); continue; }
    let o; try { o = PARSERS[banco](readFileSync(join(pastaExt, e, f), 'utf8')); } catch (err) { falha(`${e}/${f}: ${err.message}`); }
    if (!o.ok) falha(`${e}/${f}: o extrato não reconcilia (dif ${o.dif}) — leitura incompleta? Nada gravado.`);
    if (o.formato === 'ofx') avisos.push(`${e}/${banco}: OFX (saldo inicial derivado do saldo final; a virada de saldo é a conferência)`);
    formatosUsados.add(o.formato === 'pdf' ? 'PDF/TXT' : o.formato.toUpperCase());
    (porBanco[banco] = porBanco[banco] || []).push(o);
  }
  /* contas esperadas = as que a empresa tinha no mês anterior (ou já neste mês): nunca
     carregar a empresa com conta faltando — a conciliação ficaria errada em silêncio */
  const id = EMP_ID[e];
  const esperadasB = new Set([...((antM[id] || {}).contas || []), ...(((DATA.meses[mes] || {}).empresas || {})[id] || {}).contas || []].map(c => c.banco));
  const presentes = new Set(Object.keys(porBanco).map(b => BANCO_NOME[b]));
  for (const nome of esperadasB) {
    const b = Object.keys(BANCO_NOME).find(k => BANCO_NOME[k] === nome);
    if (presentes.has(nome) || semConta.includes(`${e}:${b}`)) continue;
    if (contaEncerrada(e, b, mes)) { encerradas.push(`${EMP_ID[e]}·${nome}`); continue; } /* sai do painel: saldo zero daqui em diante */
    faltamContas.push(`${e}/${b}`);
  }
  for (const banco of Object.keys(porBanco)) {
    let o = porBanco[banco][0];
    if (porBanco[banco].length > 1) {
      /* emenda: fica o extrato que vai mais longe; os outros só contribuem com os
         dias ANTERIORES ao início dele (semanais em pedaços ou mês-até-hoje repetido).
         A cadeia tem de fechar: saldo anterior do 1º + Σ = saldo final do último. */
      const ps = porBanco[banco].slice().sort((a, b) => (a.periodo.ate || '').localeCompare(b.periodo.ate || '') || (a.periodo.de || '').localeCompare(b.periodo.de || ''));
      const base = ps[ps.length - 1]; let mov = base.mov.slice(); let saldoAnterior = base.saldoAnterior; let de = base.periodo.de;
      for (const p of ps.slice(0, -1).reverse()) {
        const antes = p.mov.filter(x => x.data < de);
        if (!antes.length) continue;
        mov = antes.concat(mov); de = p.periodo.de; saldoAnterior = p.saldoAnterior;
      }
      const semSaldo = ps.some(p => p.semSaldo);
      if (!semSaldo) {
        const dif = r2(saldoAnterior + mov.reduce((a, x) => a + x.valor, 0) - base.saldoFinal);
        if (Math.abs(dif) > 0.015) falha(`${e}/${banco}: as ${ps.length} partes não formam uma cadeia contínua (dif ${dif}) — falta uma semana ou há sobreposição com valores diferentes. Nada gravado.`);
      }
      o = { ...base, saldoAnterior: semSaldo ? null : saldoAnterior, saldoFinal: semSaldo ? null : base.saldoFinal, semSaldo, mov, periodo: { de, ate: base.periodo.ate } };
      avisos.push(`${e}/${banco}: ${ps.length} partes emendadas (${de}→${base.periodo.ate})${semSaldo ? ' — partes sem saldo: cadeia não conferível' : ''}`);
    }
    /* o extrato tem de cobrir a conta desde o 1º dia do mês (extrato semanal avulso
       sem as semanas anteriores deixaria os primeiros dias zerados em silêncio) */
    const deCob = (o.periodo && o.periodo.de) || (o.mov[0] || {}).data || '';
    if (deCob > mes + '-01' && deCob.slice(0, 7) === mes && (o.mov.length || deCob > mes + '-01')) falha(`${e}/${banco}: o extrato cobre a conta só a partir de ${deCob.slice(8, 10)}/${deCob.slice(5, 7)} — faltam os dias anteriores do mês (extratos semanais anteriores ou o extrato do mês inteiro). Nada gravado.`);
    const foraDoMes = o.mov.filter(m => m.data.slice(0, 7) !== mes);
    if (foraDoMes.length) {
      /* extrato com outro mês junto: mantém só o mês pedido e recalcula o saldo inicial */
      const antes = o.mov.filter(m => m.data < mes + '-01').reduce((a, m) => a + m.valor, 0);
      const depois = o.mov.filter(m => m.data > mes + '-31').reduce((a, m) => a + m.valor, 0);
      if (o.saldoAnterior != null) { o.saldoAnterior = r2(o.saldoAnterior + antes); o.saldoFinal = r2(o.saldoFinal - depois); }
      o.mov = o.mov.filter(m => m.data.slice(0, 7) === mes);
      avisos.push(`${e}/${banco}: ${foraDoMes.length} lançamento(s) de outro mês descartado(s)`);
    }
    /* formato sem saldo (CSV do Itaú, XLS do Sicredi sem lançamentos ou ilegível):
       saldo inicial = fechamento do mês anterior no painel; sem conferência independente */
    if (o.saldoAnterior == null) {
      const ca = ((antM[id] || {}).contas || []).find(x => x.banco === BANCO_NOME[banco]);
      if (!ca) falha(`${e}/${banco}: o arquivo (${o.formato}) não traz saldo e não há fechamento de ${mesAnt} no painel para ancorar a conta — peça o extrato em PDF ou OFX. Nada gravado.`);
      o.saldoAnterior = r2(ca.fim); o.saldoFinal = r2(ca.fim + o.mov.reduce((a, m) => a + m.valor, 0));
      avisos.push(`${e}/${banco}: ${o.formato.toUpperCase()} sem saldo no arquivo — saldo inicial tomado do fechamento de ${MES_LABEL[mesAnt] || mesAnt} no painel${o.mov.length ? '' : ' (sem lançamentos no período)'}; nenhuma conferência independente de saldo — prefira OFX ou PDF`);
    } else if (o.saldoFinalDerivado) {
      avisos.push(`${e}/${banco}: ${o.formato.toUpperCase()} com saldos ilegíveis ("####") — cadeia conferida só até ${o.ancoradoAte ? o.ancoradoAte.slice(8, 10) + '/' + o.ancoradoAte.slice(5, 7) : 'o saldo anterior'}; o saldo final é derivado (${o.saldosLegiveis || 0} de ${o.mov.length} saldos legíveis${o.valoresDerivados ? `, ${o.valoresDerivados} valor(es) derivado(s) do saldo` : ''}) — prefira OFX ou PDF`);
    }
    for (const m of o.mov) { const d = +m.data.slice(8, 10); if (d > ultimoDia) ultimoDia = d; }
    extratos.push({ banco, saldoAnterior: o.saldoAnterior, saldoFinal: o.saldoFinal, mov: o.mov });
  }
  if (!extratos.length) continue;
  const r = montaEmpresa({ empresa: e, mes, extratos, fornMap, ajustes });
  if (!r.reconcilia) falha(`${e}: a montagem não concilia (dif ${r.dif}) — nada gravado.`);
  resultados[e] = r;
}
if (encerradas.length) avisos.push(`conta(s) encerrada(s) sem extrato — saem do painel a partir deste mês (saldo zero): ${encerradas.join(', ')}`);
if (faltamContas.length) {
  const msg = `conta(s) sem extrato nesta carga: ${faltamContas.join(', ')} (existiam em ${MES_LABEL[mesAnt] || mesAnt}/${mesAnt.slice(0, 4)}) — não se carrega empresa com conta faltando; traga o extrato (qualquer formato) ou, só com decisão do Samuel, --sem-conta ${faltamContas.map(x => x.replace('/', ':')).join(',')}.`;
  if (soConferir) avisos.unshift('BLOQUEIO: ' + msg + ' Nada será gravado.'); else falha(msg + ' Nada gravado.');
}

/* até que dia o mês está coberto */
const fimDoMes = new Date(ano, mm - 1, nd); const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
let dias = opt(args, 'ate') ? +opt(args, 'ate') : (hoje > fimDoMes ? nd : Math.min(ultimoDia, ontem.getMonth() + 1 === mm && ontem.getFullYear() === ano ? ontem.getDate() : nd));
if (dias < 1 || dias > nd) falha('--ate fora do mês.');
const tipo = dias >= nd ? 'full' : 'parcial';

/* virada: saldo inicial de cada conta = saldo final do mês anterior (quando existe) */
const viradas = [];
/* cobertura por empresa: o mês só avança para TODAS as empresas juntas. Empresa que
   já tinha dados no mês (ou que existia no mês anterior fechado) e não veio nesta
   carga trava a rodada — a não ser que esteja em --sem (fica com o que tinha e a
   nota/STATUS avisam). Evita mês "fechado" com uma empresa parada em dias antigos. */
const idsCarregados = Object.keys(resultados).map(e => EMP_ID[e]);
const cobAnt = { ...((DIA[mes] && DIA[mes].cobertura) || {}) };
/* meses carregados antes do controle de cobertura: assume os dias registrados no diário */
for (const id of Object.keys(((DATA.meses[mes] || {}).empresas) || {})) if (cobAnt[id] == null) cobAnt[id] = (DIA[mes] || {}).dias || 0;
const esperadas = new Set([...Object.keys(((DATA.meses[mes] || {}).empresas) || {}), ...Object.keys(antM)]);
const faltantes = [...esperadas].filter(id => !idsCarregados.includes(id) && (cobAnt[id] || 0) < dias && !semEmp.includes(Object.keys(EMP_ID).find(k => EMP_ID[k] === id)));
if (faltantes.length) falha(`empresa(s) sem extrato nesta carga: ${faltantes.join(', ')} — o mês não avança até ${dd(dias)} sem elas (todas as contas de todas as empresas, ou --sem <ids> para deixar explicitamente de fora). Nada gravado.`);
if (diaAtual && dias < (diaAtual.dias || 0)) falha(`o mês já cobria ${diaAtual.dias} dias; esta carga cobre ${dias} — nada gravado.`);

for (const e of Object.keys(resultados)) for (const c of resultados[e].DATA.contas) {
  const nome = BANCO_NOME[c.banco]; const ca = ((antM[EMP_ID[e]] || {}).contas || []).find(x => x.banco === nome);
  if (ca && Math.abs(ca.fim - c.ini) > 0.015) viradas.push(`${EMP_ID[e]}·${nome}: fim de ${MES_LABEL[mesAnt] || mesAnt} no painel ${brl(ca.fim)} ≠ início do extrato ${brl(c.ini)}`);
}

/* relatório (fora do repo) */
rel.push(`# Fluxo de Caixa — carga de ${mes} (${tipo}, dias 01–${dd(dias)}) em ${hojeISO}`);
for (const e of Object.keys(resultados)) {
  const r = resultados[e];
  rel.push(`\n## ${EMP_ID[e]} — ini ${brl(r.ini)} → fim ${brl(r.fim)} · entradas ${brl(r.totalIn)} · saídas ${brl(r.totalOut)} · entre empresas ${brl(r.icwTotal)} · concilia ${r.reconcilia ? 'OK' : 'NÃO'}`);
  rel.push(`contas: ${r.DATA.contas.map(c => `${BANCO_NOME[c.banco]} ${brl(c.ini)} → ${brl(c.fim)}`).join(' · ')}`);
  rel.push(`${r.lancamentos} lançamentos · ${r.sweepsCasados} sweeps casados · ${r.giroSemPar} transferência(s) própria(s) sem par · rotativo captado/amortizado ${brl(r.DATA.giro[0])}/${brl(r.DATA.giro[1])}`);
  const porConta = {}; for (const c of r.classificados) { const k = (c.giro ? '[giro] ' : '') + c.conta; porConta[k] = (porConta[k] || 0) + c.valor; }
  rel.push('por conta: ' + Object.entries(porConta).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => `${k} ${brl(v)}`).join(' | '));
  const rev = r.classificados.filter(c => !c.confia).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  rel.push(`para revisão (${rev.length}):`);
  for (const c of rev) rel.push(`  ${c.banco.padEnd(8)} ${c.data} ${brl(c.valor).padStart(14)}  ${c.conta}${c.semPar ? ' [sem par]' : ''}${c.intercompany ? ' [grupo]' : ''}  « ${c.desc.slice(0, 90)}`);
  const agg = {}; for (const c of rev) { if (c.valor >= 0 && !c.semPar) continue; const n = nomeDoMemo(c.desc).split(' ').slice(0, 3).join(' ') || '(sem nome)'; const a = agg[n] = agg[n] || { n: 0, v: 0, conta: c.conta }; a.n++; a.v += c.valor; }
  const top = Object.entries(agg).sort((a, b) => Math.abs(b[1].v) - Math.abs(a[1].v)).slice(0, 40);
  if (top.length) { rel.push(`fornecedores/contrapartes sem mapa (agregado — uma decisão cobre todas as linhas; grave com "fluxo-fornecedores.mjs aprende --nome ... --conta ..."):`); for (const [n, a] of top) rel.push(`  ${brl(a.v).padStart(14)}  ${String(a.n).padStart(3)}×  ${n.padEnd(34)} → hoje em: ${a.conta}`); }
  const ic = r.classificados.filter(c => c.intercompany || c.ajustado);
  if (ic.length) { rel.push(`entre empresas do grupo / ajustados (${ic.length}):`); for (const c of ic) rel.push(`  ${c.banco.padEnd(8)} ${c.data} ${brl(c.valor).padStart(14)}  ${c.conta}${c.ajustado ? ' [ajuste]' : ''}  « ${c.desc.slice(0, 90)}`); }
}
if (viradas.length) rel.push('\n## Virada de saldos (conferir)\n' + viradas.map(v => '- ' + v).join('\n'));
if (avisos.length) rel.push('\n## Avisos\n' + avisos.map(v => '- ' + v).join('\n'));
const relArq = opt(args, 'relatorio'); if (relArq) { foraDoRepo(relArq, '--relatorio'); writeFileSync(relArq, rel.join('\n') + '\n'); }

const totalRev = Object.values(resultados).reduce((a, r) => a + r.classificados.filter(c => !c.confia).length, 0);
console.log(`${mes}: ${Object.keys(resultados).length} empresa(s) · ${Object.values(resultados).reduce((a, r) => a + r.DATA.contas.length, 0)} contas · dias 01–${dd(dias)} (${tipo}) · todas conciliadas no centavo · ${totalRev} lançamento(s) para revisão · ${viradas.length} virada(s) a conferir · ${avisos.length} aviso(s)` + (relArq ? ` · relatório em ${relArq}` : ''));
if (soConferir) { if (faltamContas.length) { console.error('ERRO: ' + avisos[0]); process.exit(1); } process.exit(0); }

/* grava no estado */
const mesD = DATA.meses[mes] && DATA.meses[mes].empresas ? DATA.meses[mes] : { tipo, empresas: {} };
const diaM = DIA[mes] || { dias: 0, nd, empresas: {} };
const mantidas = Object.keys(mesD.empresas).filter(id => !Object.values(EMP_ID).filter(x => Object.keys(resultados).map(e => EMP_ID[e]).includes(x)).includes(id));
for (const e of Object.keys(resultados)) {
  const r = resultados[e], id = EMP_ID[e];
  mesD.empresas[id] = { cin: r.DATA.cin, cout: r.DATA.cout, icw: r.DATA.icw, giro: r.DATA.giro, icin: {}, icout: {}, contas: r.DATA.contas.map(c => ({ banco: BANCO_NOME[c.banco], ini: c.ini, fim: c.fim })) };
  diaM.empresas[id] = { cin: r.DIA.cin, cout: r.DIA.cout, icw: r.DIA.icw };
}
mesD.tipo = tipo;
diaM.cobertura = { ...cobAnt }; for (const id of idsCarregados) diaM.cobertura[id] = dias;
const foraDesta = [...esperadas].filter(id => !idsCarregados.includes(id));
const sem = semanasDoMes(ano, mm);
const nota = [`${tipo === 'full' ? 'Mês fechado' : 'Mês parcial'} pela rotina em ${dd(hoje.getDate())}/${dd(hoje.getMonth() + 1)}/${hoje.getFullYear()}: realizado 01–${dd(dias)}/${dd(mm)} lido dos extratos da pasta semanal do OneDrive (${[...formatosUsados].sort().join('/')}), conciliado no centavo em ${Object.values(resultados).reduce((a, r) => a + r.DATA.contas.length, 0)} contas de ${Object.keys(resultados).length} empresas.`,
  `Semanas seg→dom (${sem.map(s => s.replace(' · ', ' ')).join(' · ')}).`,
  `Classificação pelas regras de memo e pelo mapa de fornecedores do Argo; ${totalRev} lançamento(s) ficaram marcados para revisão${ajustes.length ? `; ${ajustes.length} ajuste(s) aplicado(s)` : ''}.`,
  encerradas.length ? `Conta(s) encerrada(s), fora do painel a partir deste mês: ${encerradas.join(', ')}.` : '',
  foraDesta.length ? `Fora desta carga (ficam com o realizado até o dia ${dd(Math.max(...foraDesta.map(id => cobAnt[id] || 0)))}, por falta de extrato): ${foraDesta.join(', ')}.` : '',
  viradas.length ? `Virada de saldos a conferir: ${viradas.join('; ')}.` : '',
  opt(args, 'nota') || ''].filter(Boolean).join(' ');
mesD.nota = nota;
DATA.meses[mes] = mesD;
diaM.dias = dias; diaM.nd = nd; DIA[mes] = diaM;
if (!MES_WEEKS[mes]) MES_WEEKS[mes] = sem;
if (!MES_LABEL[mes]) MES_LABEL[mes] = MESES_PT[mm - 1];
const refBR = `${dd(dias)}/${dd(mm)}`;
STATUS.dados_ate = `${dd(dias)}/${dd(mm)}/${ano}`; STATUS.atualizado = `${dd(hoje.getDate())}/${dd(hoje.getMonth() + 1)}/${hoje.getFullYear()}`;
const bancos = [...new Set(Object.values(resultados).flatMap(r => r.DATA.contas.map(c => BANCO_NOME[c.banco])))];
STATUS.extratos = `${bancos.join(', ')} até ${refBR} — extratos da pasta semanal do OneDrive (Financeiro/Fluxo de Caixa/Extratos/Fluxo On-line; formatos ${[...formatosUsados].sort().join(', ')}), lidos pela rotina automática em ${STATUS.atualizado}; ${mes} ${tipo === 'full' ? 'FECHADO' : 'parcial'}${foraDesta.length ? `; sem extrato completo neste mês: ${foraDesta.join(', ')} (realizado parado no dia ${dd(Math.max(...foraDesta.map(id => cobAnt[id] || 0)))})` : ''}`;
if (!PAINEL.empresas) PAINEL.empresas = {};
for (const e of Object.keys(resultados)) { const id = EMP_ID[e]; PAINEL.empresas[id] = { ...(PAINEL.empresas[id] || {}), saldo: resultados[e].fim, ref: refBR }; }
/* o painel aponta para o último mês com dados realizados */
const ultimoMesComDados = Object.keys(DIA).filter(m => DIA[m] && DIA[m].dias > 0).sort().pop();
if (ultimoMesComDados === mes) { PAINEL.hoje = `${dd(hoje.getDate())}/${dd(hoje.getMonth() + 1)}/${hoje.getFullYear()}`; PAINEL.mes = mes; PAINEL.wk = wkOf(ano, mm, dias) + 1; }
grava('DATA', DATA); grava('DIA', DIA); grava('MES_WEEKS', MES_WEEKS); grava('MES_LABEL', MES_LABEL); grava('STATUS', STATUS); grava('PAINEL', PAINEL);
console.log(`estado atualizado em ${pastaEst}: DATA.meses[${mes}] (${tipo}), DIA[${mes}] (${dias} dias), MES_WEEKS, MES_LABEL, STATUS, PAINEL`);
