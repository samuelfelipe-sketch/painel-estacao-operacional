/* Conferência do contas a pagar do Argo contra os extratos (modo conferência,
   aprovado pelo Samuel em 23/10/2026).

   O realizado do Fluxo vem SÓ do extrato do banco. Os relatórios do Argo
   ("DD-MM-AAAA_RelatorioDeContasAPagarPorPeriodo{MesCorrente,Ultimos30Dias,
   Proximos12Meses}.csv", pasta Financeiro/Fluxo de Caixa/Contas a pagar - Argo/
   Semanal, gerados toda segunda) ficam em observação: a cada semana esta
   conferência mede quanto deles bateu com o banco, sem publicar nada deles na
   ferramenta. Os três arquivos são recortes por EMISSÃO; a união dos três da
   mesma data é a "foto" do contas a pagar naquele dia.

   Duas medidas por semana (seg→dom, a partir da data da foto):
   • previsão — títulos em aberto na foto com vencimento na semana: quanto
     saiu do banco (mesma empresa, data entre vencimento −5 e +7 dias; valor
     igual com o nome no memo ou até 2 dias do vencimento; com acréscimo de até
     10% ou desconto de até 1%, só com o nome; vários títulos do mesmo
     fornecedor e vencimento pagos num débito só também casam).
   • baixas — títulos que a foto SEGUINTE dá como pagos na semana: quanto
     tem a saída correspondente no banco (valor pago, data ±3 dias).
   E a cobertura: das saídas do banco na semana (sem transferências próprias),
   quanto estava no contas a pagar (como previsão ou baixa).

   Critério para ligar o arquivo na ferramenta: acerto da previsão E
   cobertura ≥ 90% E baixas em dia (pagos no banco ainda em aberto no Argo
   ≤ 10% do pago) em duas semanas seguidas.

   Uso:
     node scripts/fluxo-conferencia.mjs pagar --extratos <pasta-mês>[,<pasta-mês>] --ate AAAA-MM-DD
          --para <arquivo.json fora do repo> [--transcript <jsonl>]
     node scripts/fluxo-conferencia.mjs grava --de <arquivo.json>    → fluxo/conferencia.enc.json (cifrado, acumula semanas)
     node scripts/fluxo-conferencia.mjs abre --para <arquivo.json>   → decifra o histórico
   Logs sem números do caixa (o arquivo de saída, fora do repo, tem tudo). */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { falha, opt, foraDoRepo, chave, cifra, decifra, nomeDoMemo } from './fluxo-lib.mjs';
import { PARSERS } from './fluxo-extratos.mjs';
import { classifica } from './fluxo-classifica.mjs';
import { leiturasDoTranscript, transcriptMaisNovo } from './fluxo-leituras.mjs';

export const ARQ_CONF = 'fluxo/conferencia.enc.json';
const r2 = n => Math.round(n * 100) / 100;
const CNPJ_EMP = { '91424135': 'siss', '13047383': 'sf', '43510250': 'ps', '47857489': 'as', '36667966': 'st', '62681375': 'ss' };
const EMP_NOME = { ps: 'Posto Sapatão', sf: 'SF', as: 'Safyr', siss: 'Siss', st: 'Transportes', ss: 'Serviços' };
const META = 0.9;

/* ---------- datas ---------- */
const isoBR = s => { const m = (s || '').match(/(\d{2})\/(\d{2})\/(\d{2,4})/); if (!m) return null; return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2]}-${m[1]}`; };
const somaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const numBR = s => { const t = (s || '').trim(); if (!t) return 0; return +(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t) || 0; };

/* ---------- Argo: lê as fotos ---------- */
export function lePagar(txt) {
  const linhas = txt.replace(/\r/g, '').split('\n').filter(l => l.trim());
  const cab = (linhas.shift() || '').split(';');
  if (!/cod_fornec/.test(cab[0]) || !cab.some(c => /saldo_doc/.test(c))) return null;
  const out = [];
  for (const l of linhas) {
    if (/^cod_fornec;/.test(l)) continue; /* cabeçalho repetido nas páginas */
    const c = l.split(';'); if (c.length < 14) continue;
    const cnpj = ((c[9] || '').match(/CNPJ:\s*([\d.]+)/) || [])[1]; const emp = cnpj && CNPJ_EMP[cnpj.replace(/\D/g, '').slice(0, 8)];
    if (!emp) continue;
    out.push({ cod: c[0].trim(), forn: c[1].replace(/�/g, '').trim(), doc: c[2].trim(), emissao: isoBR(c[3]), venc: isoBR(c[4]), valor: r2(numBR(c[5])), saldo: r2(numBR(c[6])),
      pago: isoBR(c[7]), conta: (c[8] || '').replace(/�/g, '').replace(/\s+/g, ' ').trim(), emp, valorPago: r2(numBR(c[13])), manual: !c[0].trim() && /MANUAL/.test(c[1]) });
  }
  return out;
}
const chaveTitulo = t => [t.emp, t.cod || t.forn, t.doc, t.venc, t.valor.toFixed(2), t.emissao].join('|');
export function fotos(leituras) {
  const porData = {};
  for (const l of leituras) {
    const m = (l.nome || '').match(/^(\d{2})-(\d{2})-(\d{4})_RelatorioDeContasAPagarPorPeriodo(MesCorrente|Ultimos30Dias|Proximos12Meses)/i); if (!m) continue;
    const data = `${m[3]}-${m[2]}-${m[1]}`; const tit = lePagar(l.texto); if (!tit) continue;
    const f = (porData[data] = porData[data] || { data, partes: {}, titulos: {} });
    f.partes[m[4]] = tit.length;
    for (const t of tit) { const k = chaveTitulo(t); if (!f.titulos[k]) f.titulos[k] = t; }
  }
  return Object.values(porData).map(f => ({ data: f.data, completa: ['MesCorrente', 'Ultimos30Dias', 'Proximos12Meses'].every(p => f.partes[p] != null), partes: f.partes, titulos: Object.values(f.titulos) })).sort((a, b) => a.data.localeCompare(b.data));
}

/* ---------- banco: saídas por empresa ---------- */
export function saidas(pastas, ate) {
  const out = [];
  for (const pasta of pastas) for (const e of readdirSync(pasta).filter(d => EMP_NOME[d] && existsSync(join(pasta, d)))) {
    for (const f of readdirSync(join(pasta, e)).filter(f => /^[a-z]+(\.\d+)?\.txt$/.test(f))) {
      const banco = f.split('.')[0]; if (!PARSERS[banco]) continue;
      let o; try { o = PARSERS[banco](readFileSync(join(pasta, e, f), 'utf8')); } catch (err) { continue; }
      for (const m of o.mov) {
        if (m.valor >= 0 || m.data > ate) continue;
        const c = classifica(m, { empresa: e });
        if (c.giro && !c.intercompany) continue; /* transferência entre contas da própria empresa */
        out.push({ emp: e, banco, data: m.data, valor: r2(-m.valor), desc: m.desc, intercompany: !!c.intercompany, conta: c.conta, id: `${e}|${banco}|${m.data}|${m.valor}|${m.desc}` });
      }
    }
  }
  /* o mesmo lançamento pode vir em dois arquivos do mesmo banco: fica um */
  const vistos = new Map(); for (const s of out) { const n = (vistos.get(s.id) || 0) + 1; vistos.set(s.id, n); s.id += '#' + n; }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

/* ---------- casamento ---------- */
const palavras = s => new Set(nomeDoMemo(s).split(' ').filter(w => w.length >= 4 && !/^(LTDA|COMERCIO|DISTRIB|DISTRIBUIDORA|ALIMENTOS|PRODUTOS|SERVICOS|INDUSTRIA)$/.test(w)));
const nomeBate = (forn, desc) => { const a = palavras(forn), b = palavras(desc); for (const w of a) if (b.has(w) || [...b].some(x => x.length >= 5 && (x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5))))) return true; return false; };
function acha(livres, emp, valor, de, ate, forn, alvo, folga = 0) {
  let melhor = null;
  for (const s of livres) {
    if (s.usado || s.emp !== emp || s.data < de || s.data > ate) continue;
    const dif = r2(s.valor - valor); if (dif < -Math.max(0.02, valor * 0.01) || dif > Math.max(0.02, valor * folga)) continue;
    const nome = nomeBate(forn, s.desc), dias = Math.abs((new Date(s.data) - new Date(alvo)) / 864e5), exato = Math.abs(dif) <= 0.02;
    /* valor exato: vale com o nome no memo ou até 2 dias da data; com acréscimo, só com o nome */
    if (exato ? !(nome || dias <= 2) : !nome) continue;
    const nota = (exato ? 0 : 10) + dias - (nome ? 3 : 0);
    if (!melhor || nota < melhor.nota) melhor = { s, nota, dif, nome };
  }
  return melhor;
}
/* passa no critério: previsão e cobertura ≥ 90% e baixas em dia (pendentes ≤ 10% do pago)
   — com baixa atrasada, título já pago continua "a pagar" e a previsão contaria duas vezes */
export const passa = s => (s.previsao.acerto || 0) >= META && (s.cobertura.pct || 0) >= META && (!s.baixaPendente || (s.baixaPendente.pctPago ?? 1) <= 1 - META);
const item = t => ({ emp: t.emp, forn: t.forn, doc: t.doc, venc: t.venc, valor: t.saldo || t.valor, conta: t.conta.split(' - ').pop() });

export function confere({ fotosAll, sai, ate }) {
  const semanas = [];
    for (let i = 0; i < fotosAll.length; i++) {
    const f = fotosAll[i]; const de = f.data, fim = somaDias(f.data, 6), ateS = fim < ate ? fim : ate;
    if (de > ate) continue;
    const livres = sai.map(s => ({ ...s, usado: false }));
    /* previsão: títulos em aberto na foto com vencimento na semana */
    const prev = f.titulos.filter(t => t.saldo > 0.009 && t.venc >= de && t.venc <= fim);
    const vencidosAbertos = f.titulos.filter(t => t.saldo > 0.009 && t.venc < de);
    const confirmados = [], comAcrescimo = [], naoPagos = [], pendentes = [];
    /* grupo do mesmo fornecedor e vencimento pago num débito só (PIX único para vários títulos) */
    const jaGrupo = new Set(); const gr = {};
    for (const t of prev) (gr[[t.emp, t.cod || t.forn, t.venc].join('|')] = gr[[t.emp, t.cod || t.forn, t.venc].join('|')] || []).push(t);
    for (const g of Object.values(gr)) { if (g.length < 2) continue; const tot = r2(g.reduce((a, t) => a + t.saldo, 0)); const m = acha(livres, g[0].emp, tot, somaDias(g[0].venc, -5), somaDias(g[0].venc, 7), g[0].forn, g[0].venc, 0.10);
      if (m && m.nome) { m.s.usado = true; for (const t of g) { jaGrupo.add(t); confirmados.push({ ...item(t), pagoEm: m.s.data, banco: m.s.banco, pagoValor: m.s.valor, agrupado: g.length }); } } }
    for (const t of prev.filter(t => !jaGrupo.has(t)).sort((a, b) => b.saldo - a.saldo)) {
      const lim = somaDias(t.venc, 7);
      const m = acha(livres, t.emp, t.saldo, somaDias(t.venc, -5), lim, t.forn, t.venc, 0.10);
      if (m) { m.s.usado = true; (Math.abs(m.dif) <= 0.02 ? confirmados : comAcrescimo).push({ ...item(t), pagoEm: m.s.data, banco: m.s.banco, pagoValor: m.s.valor, nome: m.nome }); }
      else if (lim > ate) pendentes.push(item(t));
      else naoPagos.push(item(t));
    }
    /* baixas: a foto seguinte diz o que foi pago na semana */
    const prox = fotosAll[i + 1];
    let baixas = null;
    if (prox) {
      const bx = prox.titulos.filter(t => t.pago && t.pago >= de && t.pago <= ateS && t.valorPago > 0);
      const casadas = [], semBanco = [];
      for (const t of bx.sort((a, b) => b.valorPago - a.valorPago)) {
        const m = acha(livres, t.emp, t.valorPago, somaDias(t.pago, -3), somaDias(t.pago, 3), t.forn, t.pago, 0)
          || (livres.find(s => s.usado && s.emp === t.emp && Math.abs(s.valor - t.valorPago) <= 0.02 && Math.abs((new Date(s.data) - new Date(t.pago)) / 864e5) <= 3) ? { jaCasada: true } : null);
        if (m && m.s) m.s.usado = true;
        if (m) casadas.push(t); else semBanco.push({ emp: t.emp, forn: t.forn, doc: t.doc, pago: t.pago, valor: t.valorPago, conta: t.conta.split(' - ').pop(), manual: t.manual });
      }
      baixas = { n: bx.length, valor: r2(bx.reduce((a, t) => a + t.valorPago, 0)), casadas: casadas.length, valorCasado: r2(casadas.reduce((a, t) => a + t.valorPago, 0)), semBanco: semBanco.sort((a, b) => b.valor - a.valor) };
    }
    /* registro: saída da semana que não estava prevista na segunda, mas cujo título existe
       na foto seguinte (emitido durante a semana — compra de combustível com vencimento em 1–3
       dias — ou baixado com atraso) */
    const registradas = [];
    const titProx = prox ? prox.titulos.filter(t => !t.manual) : [];
    const usadosTit = new Set();
    for (const s of livres.filter(s => !s.usado && s.data >= de && s.data <= ateS).sort((a, b) => b.valor - a.valor)) {
      let melhor = null;
      for (const t of titProx) {
        const k = chaveTitulo(t); if (usadosTit.has(k) || t.emp !== s.emp || !t.venc || t.venc < somaDias(s.data, -7) || t.venc > somaDias(s.data, 5)) continue;
        const base = t.saldo > 0.009 ? t.saldo : t.valor; const dif = r2(s.valor - base); if (dif < -Math.max(0.02, base * 0.01) || dif > Math.max(0.02, base * 0.10)) continue;
        const nome = nomeBate(t.forn, s.desc), dias = Math.abs((new Date(s.data) - new Date(t.venc)) / 864e5), exato = Math.abs(dif) <= 0.02;
        if (exato ? !(nome || dias <= 2) : !nome) continue;
        const nota = (exato ? 0 : 10) + dias - (nome ? 3 : 0);
        if (!melhor || nota < melhor.nota) melhor = { t, nota, k };
      }
      if (melhor) { s.usado = true; s.registro = true; usadosTit.add(melhor.k); registradas.push({ s, t: melhor.t }); }
    }
    /* baixa pendente: pago no banco, ainda em aberto no Argo na foto seguinte */
    const abertoNaProx = new Map(titProx.filter(t => t.saldo > 0.009).map(t => [[t.emp, t.cod || t.forn, t.doc, t.venc, t.valor.toFixed(2)].join('|'), t]));
    const pend = [];
    if (prox) {
      for (const c of [...confirmados, ...comAcrescimo]) { const t = abertoNaProx.get([c.emp, prev.find(x => x.forn === c.forn && x.doc === c.doc && x.venc === c.venc)?.cod || c.forn, c.doc, c.venc, (prev.find(x => x.forn === c.forn && x.doc === c.doc && x.venc === c.venc)?.valor || 0).toFixed(2)].join('|')); if (t) pend.push({ emp: c.emp, forn: c.forn, doc: c.doc, venc: c.venc, valor: c.valor, pagoEm: c.pagoEm, banco: c.banco }); }
      for (const { s, t } of registradas) if (t.saldo > 0.009) pend.push({ emp: t.emp, forn: t.forn, doc: t.doc, venc: t.venc, valor: t.saldo, pagoEm: s.data, banco: s.banco });
    }
    /* cobertura: saídas da semana que estavam no contas a pagar */
    const daSemana = livres.filter(s => s.data >= de && s.data <= ateS);
    const consideradas = daSemana.filter(s => s.usado || !s.intercompany); /* empréstimo entre empresas sem título não conta */
    const semTitulo = consideradas.filter(s => !s.usado).map(s => ({ emp: s.emp, banco: s.banco, data: s.data, valor: s.valor, desc: s.desc, conta: s.conta })).sort((a, b) => b.valor - a.valor);
    const tot = r2(consideradas.reduce((a, s) => a + s.valor, 0)), cas = r2(consideradas.filter(s => s.usado).reduce((a, s) => a + s.valor, 0));
    const soma = l => r2(l.reduce((a, t) => a + t.valor, 0));
    const valPrev = soma(prev.map(item)), valConf = r2(soma(confirmados) + soma(comAcrescimo)), valAvaliado = r2(valPrev - soma(pendentes));
    semanas.push({
      semana: de, fim, ate: ateS, foto: f.data, fotoCompleta: f.completa, fotoSeguinte: prox ? prox.data : null,
      previsao: { n: prev.length, valor: valPrev, confirmados: confirmados.length, comAcrescimo: comAcrescimo.length, valorConfirmado: valConf, naoPagos: naoPagos.sort((a, b) => b.valor - a.valor), pendentes, acerto: valAvaliado > 0 ? r2(valConf / valAvaliado) : null },
      baixas: baixas && { ...baixas, acerto: baixas.valor > 0 ? r2(baixas.valorCasado / baixas.valor) : null },
      cobertura: { saidas: consideradas.length, valor: tot, valorCasado: cas, pct: tot > 0 ? r2(cas / tot) : null, semTitulo,
        visivelSegunda: tot > 0 ? r2(r2(consideradas.filter(s => s.usado && !s.registro).reduce((a, s) => a + s.valor, 0)) / tot) : null,
        emitidosNaSemana: registradas.length, valorEmitidosNaSemana: r2(registradas.reduce((a, x) => a + x.s.valor, 0)) },
      baixaPendente: prox ? { n: pend.length, valor: soma(pend), pctPago: cas > 0 ? r2(soma(pend) / cas) : null, itens: pend.sort((a, b) => b.valor - a.valor) } : null,
      vencidosAbertos: { n: vencidosAbertos.length, valor: soma(vencidosAbertos.map(item)), itens: vencidosAbertos.map(item).sort((a, b) => b.valor - a.valor).slice(0, 40) },
      completa: ateS === fim && !!prox,
    });
  }
  /* critério: duas semanas completas seguidas com previsão e cobertura ≥ 90% */
  let seguidas = 0, liberado = false;
  for (const s of semanas.filter(s => s.completa)) { const ok = passa(s); seguidas = ok ? seguidas + 1 : 0; s.passou = ok; if (seguidas >= 2) liberado = true; }
  return { arquivo: 'contas a pagar', meta: META, semanas, liberado, seguidas };
}

/* ---------- CLI ---------- */
if (import.meta.url === `file://${process.argv[1]}`) {
  const [modo, ...args] = process.argv.slice(2);
  if (modo === 'pagar') {
    const pastas = (opt(args, 'extratos') || '').split(',').filter(Boolean); const ate = opt(args, 'ate'); const para = opt(args, 'para');
    if (!pastas.length || !/^\d{4}-\d{2}-\d{2}$/.test(ate || '') || !para) falha('informe --extratos <pasta>[,<pasta>], --ate AAAA-MM-DD e --para <arquivo.json>.');
    foraDoRepo(para, '--para');
    const arq = opt(args, 'transcript') || transcriptMaisNovo(); if (!arq) falha('não achei o transcript — informe --transcript.');
    const fs_ = fotos(leiturasDoTranscript(arq));
    if (!fs_.length) falha('nenhum relatório de contas a pagar do Argo lido nesta sessão (leia a pasta Semanal pelo conector).');
    const r = confere({ fotosAll: fs_, sai: saidas(pastas, ate), ate });
    r.geradoEm = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16); /* horário de Brasília */ r.ate = ate; r.fotos = fs_.map(f => ({ data: f.data, completa: f.completa, titulos: f.titulos.length }));
    writeFileSync(para, JSON.stringify(r, null, 1));
    console.log(`conferência do contas a pagar: ${fs_.length} foto(s) do Argo (${fs_.filter(f => f.completa).length} completas) · ${r.semanas.length} semana(s) · ${r.semanas.filter(s => s.completa).length} completa(s) · semanas no critério: ${r.semanas.filter(s => s.passou).map(s => s.semana).join(', ') || 'nenhuma'} · ${r.liberado ? 'LIBERADO para entrar na ferramenta' : 'segue em conferência'} · detalhes em ${para}`);
  } else if (modo === 'grava') {
    const de = opt(args, 'de'); if (!de) falha('informe --de <arquivo.json>.');
    const k = chave(); const novo = JSON.parse(readFileSync(de, 'utf8'));
    const hist = existsSync(ARQ_CONF) ? decifra(JSON.parse(readFileSync(ARQ_CONF, 'utf8')), k, ARQ_CONF) : { v: 1, pagar: { semanas: [] } };
    const porSem = Object.fromEntries((hist.pagar.semanas || []).map(s => [s.semana, s]));
    for (const s of novo.semanas) { const ant = porSem[s.semana]; if (!ant || !ant.completa || s.completa) porSem[s.semana] = s; } /* semana completa não é trocada por uma parcial */
    const semanas = Object.values(porSem).sort((a, b) => a.semana.localeCompare(b.semana));
    let seguidas = 0, liberado = false; for (const s of semanas.filter(s => s.completa)) { seguidas = s.passou ? seguidas + 1 : 0; if (seguidas >= 2) liberado = true; }
    hist.pagar = { arquivo: novo.arquivo, meta: novo.meta, semanas, liberado: liberado || !!hist.pagar.liberado, liberadoEm: hist.pagar.liberadoEm || (liberado ? novo.geradoEm : null), seguidas, ate: novo.ate, fotos: novo.fotos };
    hist.atualizadoEm = novo.geradoEm;
    writeFileSync(ARQ_CONF, JSON.stringify(cifra(hist, k)) + '\n');
    console.log(`gravado: ${ARQ_CONF} · ${semanas.length} semana(s) no histórico · ${hist.pagar.liberado ? 'contas a pagar LIBERADO' : 'contas a pagar em conferência'}`);
  } else if (modo === 'abre') {
    const para = opt(args, 'para'); if (!para) falha('informe --para <arquivo.json>.'); foraDoRepo(para, '--para');
    if (!existsSync(ARQ_CONF)) falha('ainda não há ' + ARQ_CONF + '.');
    writeFileSync(para, JSON.stringify(decifra(JSON.parse(readFileSync(ARQ_CONF, 'utf8')), chave(), ARQ_CONF), null, 1));
    console.log('aberto: ' + para);
  } else falha('modo: pagar | grava | abre');
}
