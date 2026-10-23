/* Leitor de extratos bancários (texto que o conector Microsoft 365 devolve
   ao ler o PDF do arquivo mensal do OneDrive). Um parser por banco.

   Estratégia: onde o extrato imprime o SALDO CORRIDO a cada lançamento
   (Bradesco, Unicred, Sicredi, Stone), o VALOR de cada lançamento é a
   diferença entre saldos — não se adivinha o sinal. Onde só há saldo por dia
   (Banrisul, Itaú), o valor vem do próprio lançamento e o dia é conferido
   contra o "saldo na data". Em todos, a leitura é validada contra o saldo
   final que o próprio extrato declara.

   Cada parser devolve:
     { banco, periodo:{de:'AAAA-MM-DD', ate:'AAAA-MM-DD'},
       saldoAnterior, saldoFinal, mov:[{data:'AAAA-MM-DD', desc, valor}],
       ok, dif }           // ok = reconciliou no centavo; dif = diferença
   Este módulo NÃO classifica (categorias do DRE, sweeps, intercompany): isso
   é a etapa seguinte, com as regras do projeto. Aqui só lê e confere.

   Uso (teste manual):
     node scripts/fluxo-extratos.mjs <banco> <arquivo-de-texto.txt>
   bancos: bradesco | unicred | sicredi | stone | banrisul | itau */
import { readFileSync } from 'fs';

const CENTAVO = 0.015;
const round2 = n => Math.round(n * 100) / 100;

/* "1.347,80" | "29.000,00-" | "-R$ 145.228,47" | "- R$ 38.210,82" → number */
export function num(s) {
  if (s == null) return null;
  let t = String(s).replace(/R\$/g, '').trim();
  let neg = false;
  if (/-\s*$/.test(t)) { neg = true; t = t.replace(/-\s*$/, ''); }
  if (/^-/.test(t)) { neg = true; t = t.replace(/^-\s*/, ''); }
  t = t.trim();
  if (/^\d+\.\d{1,2}$/.test(t) && !t.includes(',')) { /* "0.10": decimal com ponto (Stone, tarifas) */ }
  else t = t.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = parseFloat(t);
  return neg ? -v : v;
}
const iso = (d, m, a) => `${a.length === 2 ? '20' + a : a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
/* período declarado no cabeçalho ("Período de 01/10/2026 a 20/10/2026", "01/10/2026 até
   31/10/2026", Banrisul "MOVIMENTOS OUT/2026"): diz desde quando o extrato cobre a
   conta, mesmo sem lançamento nos primeiros dias */
const MES3 = { JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12' };
export function periodoCabecalho(txt) {
  const cab = txt.slice(0, 1500).replace(/\s+/g, ' ');
  let m = cab.match(/Per[ií]odo:?\s*(?:de\s*)?(\d{2})\/(\d{2})\/(\d{2,4})\s*(?:a|até|-)\s*(\d{2})\/(\d{2})\/(\d{2,4})/i) || cab.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(?:até|a)\s+(\d{2})\/(\d{2})\/(\d{4})/) || cab.match(/Extrato de:.*?(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return { de: iso(m[1], m[2], m[3]), ate: iso(m[4], m[5], m[6]) };
  m = cab.match(/MOVIMENTOS\s+([A-Z]{3})\/(\d{4})/i) || txt.match(/MOVIMENTOS\s+([A-Z]{3})\/(\d{4})/i);
  if (m && MES3[m[1].toUpperCase()]) return { de: `${m[2]}-${MES3[m[1].toUpperCase()]}-01`, ate: null };
  return null;
}
function fecha(o) {
  const soma = o.mov.reduce((a, x) => a + x.valor, 0);
  o.dif = round2(o.saldoAnterior + soma - o.saldoFinal);
  o.ok = Math.abs(o.dif) <= CENTAVO;
  o.periodo = o.periodo || {};
  if (o.mov.length) { o.periodo.de = o.periodo.de || o.mov[0].data; o.periodo.ate = o.periodo.ate || o.mov[o.mov.length - 1].data; }
  return o;
}
/* aplica o período do cabeçalho por cima do inferido dos lançamentos */
function comCabecalho(o, txt) {
  const pc = periodoCabecalho(txt);
  if (pc) { o.periodo = o.periodo || {}; if (pc.de && (!o.periodo.de || pc.de < o.periodo.de)) o.periodo.de = pc.de; if (pc.ate && (!o.periodo.ate || pc.ate > o.periodo.ate)) o.periodo.ate = pc.ate; o.periodoDeclarado = pc; }
  return o;
}

/* ---- bancos com saldo corrido: valor = Δ saldo ---- */
/* Bradesco: "SALDO ANTERIOR x", linhas de lançamento terminam em <valor> <saldo>;
   corta na seção de investimento ("Últimos Lançamentos" / "Os dados acima"). */
export function bradesco(txt) {
  const flat = txt.replace(/\s+/g, ' ');
  const sa = flat.match(/SALDO ANTERIOR\s+(-?[\d.]+,\d{2})/i);
  if (!sa) throw new Error('Bradesco: não achei SALDO ANTERIOR');
  const saldoAnterior = num(sa[1]);
  const ini = sa.index + sa[0].length;
  const fimM = flat.slice(ini).search(/\bTotal\b|Últimos Lançamentos|Os dados acima/);
  const body = fimM >= 0 ? flat.slice(ini, ini + fimM) : flat.slice(ini);
  /* por lançamento: [data?] [descrição] [doc inteiro?] <valor> <saldo>; a data,
     quando ausente, é herdada da anterior. valor conferido pelo Δ saldo. */
  const datas = [...body.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map(x => ({ i: x.index, d: iso(x[1], x[2], x[3]) }));
  const pares = /(-?[\d.]+,\d{2})(?!\s*%)\s+(-?[\d.]+,\d{2})(?!\s*%)/g;
  let m; const mov = []; let prev = saldoAnterior, lastEnd = 0;
  while ((m = pares.exec(body))) {
    const saldo = num(m[2]);
    const data = (datas.filter(x => x.i < m.index).pop() || {}).d || null;
    const desc = body.slice(lastEnd, m.index).replace(/\d{2}\/\d{2}\/\d{4}/g, '').replace(/\b\d{3,}\b/g, '').replace(/\s{2,}/g, ' ').trim() || 'lançamento';
    mov.push({ data, desc, valor: round2(saldo - prev) }); prev = saldo; lastEnd = m.index + m[0].length;
  }
  return fecha({ banco: 'bradesco', saldoAnterior, saldoFinal: prev, mov, periodo: {} });
}
/* Unicred: "Saldo em DD/MM/AAAA: R$ x", linhas "DD/MM/AAAA DESC (...) R$ <saldo> R$ <valor>" */
export function unicred(txt) {
  const sa = txt.match(/Saldo em \d{2}\/\d{2}\/\d{4}:\s*R\$\s*([\d.,]+)/i);
  if (!sa) throw new Error('Unicred: não achei o saldo inicial');
  const saldoAnterior = num(sa[1]);
  let prev = saldoAnterior; const mov = [];
  let linhas = txt.replace(/\s+/g, ' ');
  /* corta o cabeçalho (resumo de saldos/limites) até o 1º lançamento datado */
  const ini = linhas.search(/\d{2}\/\d{2}\/\d{4}\s+(CR[EÉ]DITO|D[EÉ]BITO)/i);
  if (ini > 0) linhas = linhas.slice(ini);
  /* linha: DATA DESC ( Doc.: X / CONTRAPARTE ) R$ <saldo> [-] R$ <valor>; valor
     conferido pelo Δ saldo. Cabeçalhos de página ficam entre linhas — por isso
     sem lookahead. A contraparte fica na descrição (sweeps para a própria
     empresa precisam ser reconhecidos). */
  const re2 = /(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+(-?)\s*R\$\s*([\d.,]+)\s+(-?)\s*R\$\s*([\d.,]+)/g;
  let m;
  while ((m = re2.exec(linhas))) {
    const data = iso(m[1], m[2], m[3]);
    if (/^Saldo em/i.test(m[4])) continue;
    const saldo = num(m[5] + m[6]);
    const valor = round2(saldo - prev); prev = saldo;
    const desc = m[4].replace(/\(\s*Doc\.?:\s*/i, '').replace(/\)\s*$/, '').replace(/\s{2,}/g, ' ').replace(/\s*-\s*$/, '').trim();
    mov.push({ data, desc, valor });
  }
  const fim = txt.replace(/\s+/g, ' ').match(/Saldo no final do per[ií]odo\s+(-?)\s*R\$\s*([\d.,]+)/i);
  const saldoFinal = fim ? num((fim[1] || '') + fim[2]) : prev;
  const o = fecha({ banco: 'unicred', saldoAnterior, saldoFinal, mov, periodo: {} });
  o.finalDeclarado = !!fim;
  return o;
}
/* Sicredi: "SALDO ANTERIOR x", linhas "DD/MM/AAAA DESC [doc] <valor> <saldo>";
   corta em "Lançamentos Futuros" */
export function sicredi(txt) {
  const corte = txt.search(/Lançamentos Futuros/i);
  const body = corte > 0 ? txt.slice(0, corte) : txt;
  const sa = body.match(/SALDO ANTERIOR\s+([\d.]+,\d{2})/i);
  if (!sa) throw new Error('Sicredi: não achei SALDO ANTERIOR');
  const saldoAnterior = num(sa[1]);
  let prev = saldoAnterior; const mov = [];
  const re = /(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+(-?[\d.]*,\d{2})\s+(-?[\d.]*,\d{2})(?=\s+\d{2}\/\d{2}\/\d{4}|\s*$)/gs;
  let m; const linhas = body.replace(/\s+/g, ' ').slice(body.replace(/\s+/g, ' ').indexOf(sa[1]) + sa[1].length);
  while ((m = re.exec(linhas))) {
    const data = iso(m[1], m[2], m[3]);
    const saldo = num(m[6]);
    const valor = round2(saldo - prev); prev = saldo;
    mov.push({ data, desc: m[4].trim(), valor });
  }
  return fecha({ banco: 'sicredi', saldoAnterior, saldoFinal: prev, mov, periodo: {} });
}
/* Stone: newest-first; "DD/MM/AA Entrada|Saída DESC ... VALOR SALDO CONTRAPARTE".
   Reordena por data; saldo corrido confirma. */
export function stone(txt) {
  const re = /(\d{2})\/(\d{2})\/(\d{2})\s+(Entrada|Saída)\s+(.+?)\s+(-?\s*R\$\s*[\d.,]+)\s+(-?\s*R\$\s*[\d.,]+)/g;
  let m; const bruto = [];
  const linhas = txt.replace(/\s+/g, ' ');
  while ((m = re.exec(linhas))) {
    const vImp = num(m[6]); const sinal = (/-/.test(m[6]) || m[4] === 'Saída') ? -1 : 1;
    bruto.push({ data: iso(m[1], m[2], m[3]), tipo: m[4], desc: m[5].trim(), vImp: sinal * Math.abs(vImp), saldo: num(m[7]) });
  }
  if (!bruto.length) throw new Error('Stone: nenhum lançamento reconhecido');
  const ordem = bruto.slice().reverse(); /* o PDF vem do mais novo ao mais antigo */
  const saldoFinal = bruto[0].saldo;      /* 1ª linha do PDF = último dia */
  const a0 = ordem[0];
  const saldoAnterior = round2(a0.saldo - a0.vImp);
  /* valor = Δ do saldo corrido (o impresso confirma; o Δ manda — tarifas vêm com
     tipo "Entrada" e valor negativo, e a ordem dentro do dia pode variar) */
  /* a Stone imprime, em pares "venda + tarifa", o MESMO saldo nas duas linhas;
     por isso o valor impresso (com sinal) é o preferido quando a soma dos
     impressos fecha com o saldo final; senão, Δ do saldo corrido */
  const somaImp = round2(ordem.reduce((a, x) => a + x.vImp, 0));
  const usaImpresso = Math.abs(round2(saldoAnterior + somaImp - saldoFinal)) <= 0.015;
  let prev = saldoAnterior;
  const mov = ordem.map(x => { const dv = round2(x.saldo - prev); prev = x.saldo; const v = usaImpresso ? x.vImp : dv; return { data: x.data, desc: (v < 0 ? '(saída) ' : '') + x.desc, valor: v }; });
  const o = fecha({ banco: 'stone', saldoAnterior, saldoFinal, mov, periodo: {} });
  o.metodo = usaImpresso ? 'impresso' : 'delta-saldo';
  return o;
}
/* ---- bancos com saldo por dia ---- */
/* Banrisul: o PDF vem ACHATADO (sem quebras; o cabeçalho até com letras
   espaçadas). Blocos: "SALDO ANT EM DD/MM/AAAA x", "MOVIMENTOS MMM/AAAA",
   depois dias: "NN HISTORICO DOC VALOR[-] ... SALDO NA DATA x". Débito = "-"
   ao final. "NOME: …" após um PIX é a contraparte (vai para a descrição). */
export function banrisul(txt) {
  const flat = txt.replace(/\s+/g, ' ');
  const sa = flat.match(/SALDO ANT EM (\d{2})\/(\d{2})\/(\d{4})\s+([\d.]+,\d{2})(-?)/i);
  if (!sa) throw new Error('Banrisul: não achei SALDO ANT');
  const saldoAnterior = num(sa[4] + sa[5]);
  const MES = { JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12' };
  const mesM = flat.match(/MOVIMENTOS\s+([A-Z]{3})\/(\d{4})/i);
  if (!mesM) throw new Error('Banrisul: não achei "MOVIMENTOS MMM/AAAA"');
  const mm = MES[mesM[1].toUpperCase()], aa = mesM[2];
  let body = flat.slice(mesM.index + mesM[0].length);
  const fimM = body.search(/EXTRATO EMITIDO|IDENTIFICACAO:|SAC 0800/i); if (fimM > 0) body = body.slice(0, fimM);
  /* separa por dia: cada "SALDO NA DATA x" fecha um dia; o bloco começa com "NN " */
  const mov = []; const saldosDia = []; let saldoFinal = saldoAnterior;
  const blocos = body.split(/SALDO NA DATA\s+([\d.]+,\d{2})(-?)/i);
  /* históricos conhecidos do Banrisul (do mais longo ao mais curto): separam o
     "NOME: contraparte" do lançamento anterior do início do lançamento seguinte */
  const HIST = ['VERO BANRICARD ALIMENTACAO', 'VERO BANRICARD REFEICAO', 'VERO BANRICARD OUTROS', 'VERO BANRICARD AUTO', 'CREDITO REGULARIZACAO RETR', 'DEPOSITO DINHEIRO ETV', 'COFRE INTELIGENTE', 'BANRI A VISTA', 'CREDITO VERO', 'VERO DEBITO', 'VERO PRAZO', 'PIX RECEBIDO', 'IOF ADICIONAL', 'PACOTE SERVICOS', 'RENOV.CADASTRO', 'TARIFA', 'JUROS', 'IOF', 'PIX', 'TED', 'DOC', 'SAQUE', 'DEPOSITO', 'CHEQUE', 'BOLETO', 'PAGAMENTO', 'TRANSFERENCIA', 'DEBITO', 'CREDITO', 'ESTORNO', 'TARIFA'];
  const reHist = new RegExp('\\b(' + HIST.map(h => h.replace(/[.]/g, '\\.')).join('|') + ')\\b', 'g');
  /* split com grupos → [bloco0, saldo0, sinal0, bloco1, saldo1, sinal1, …] */
  for (let i = 0; i + 2 < blocos.length; i += 3) {
    const bloco = blocos[i].trim(); const sd = num(blocos[i + 1] + blocos[i + 2]);
    const dd = bloco.match(/^(\d{2})\s/); if (!dd) continue;
    const dia = dd[1]; const data = iso(dia, mm, aa);
    const resto = bloco.slice(2).trim();
    /* corta por valores: cada lançamento termina em "<valor>[-]"; o trecho antes
       é "[NOME: contraparte-do-anterior] HISTORICO DOC" */
    const reVal = /\s([\d.]+,\d{2})(-?)(?=\s|$)/g;
    let m, ini = 0;
    while ((m = reVal.exec(resto))) {
      let seg = resto.slice(ini, m.index).trim(); ini = m.index + m[0].length;
      let v = num(m[1]); if (m[2] === '-') v = -Math.abs(v);
      /* NOME: do lançamento anterior */
      let nome = null;
      if (/^NOME:/i.test(seg)) {
        let ultimo = -1, mh; reHist.lastIndex = 0;
        while ((mh = reHist.exec(seg))) ultimo = mh.index;
        if (ultimo > 0) { nome = seg.slice(5, ultimo).trim(); seg = seg.slice(ultimo); }
        else { const ws = seg.split(' '); nome = ws.slice(1, -3).join(' '); seg = ws.slice(-3).join(' '); }
        if (nome && mov.length) mov[mov.length - 1].desc += ' NOME: ' + nome;
      }
      const toks = seg.split(' ').filter(Boolean);
      let doc = null;
      if (toks.length > 1 && /^[A-Z0-9]{4,}$/i.test(toks[toks.length - 1])) doc = toks.pop();
      const desc = toks.join(' ').trim();
      if (!desc) continue;
      mov.push({ data, desc: desc + (doc ? ' ' + doc : ''), valor: v });
    }
    /* NOME: pendente no fim do bloco (último lançamento do dia) */
    const cauda = resto.slice(ini).trim();
    if (/^NOME:/i.test(cauda) && mov.length) mov[mov.length - 1].desc += ' NOME: ' + cauda.slice(5).trim();
    saldosDia.push({ data, saldo: sd }); saldoFinal = sd;
  }
  const o = fecha({ banco: 'banrisul', saldoAnterior, saldoFinal, mov, periodo: {} });
  /* conferência por dia: acumulado = "SALDO NA DATA" */
  let run = saldoAnterior; const diasNaoBatem = [];
  for (const sdia of saldosDia) { run = round2(run + mov.filter(x => x.data === sdia.data).reduce((a, x) => a + x.valor, 0)); if (Math.abs(run - sdia.saldo) > CENTAVO) diasNaoBatem.push(sdia.data); run = sdia.saldo; }
  o.diasNaoBatem = diasNaoBatem;
  return o;
}
/* Itaú (export "Entradas e Saídas" do app ou extrato): newest-first; "DD/MM/AAAA
   SALDO TOTAL DISPONÍVEL DIA x" fecha o dia; "DD/MM/AAAA SALDO ANTERIOR x" no fim;
   demais linhas com data = lançamentos (último número = valor, "-" = débito). */
export function itau(txt) {
  const linhas = txt.replace(/\s+/g, ' ');
  const re = /(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)(?=\s+\d{2}\/\d{2}\/\d{4}\s|\s*$)/g;
  let m; const bruto = [];
  while ((m = re.exec(linhas))) bruto.push({ data: iso(m[1], m[2], m[3]), resto: m[4].trim() });
  const mov = []; const saldosDia = []; let saldoAnterior = null;
  for (const b of bruto) {
    if (/^SALDO ANTERIOR/i.test(b.resto)) { const v = b.resto.match(/(-?[\d.]+,\d{2})/); if (v) saldoAnterior = num(v[1]); continue; }
    if (/SALDO TOTAL DISPON[IÍ]VEL DIA/i.test(b.resto)) { const v = b.resto.match(/(-?[\d.]+,\d{2})\s*$/); if (v) saldosDia.push({ data: b.data, saldo: num(v[1]) }); continue; }
    if (/^(Lançamentos do per|Os saldos acima|Em caso de d)/i.test(b.resto)) continue;
    const v = b.resto.match(/(-?[\d.]+,\d{2})\s*$/); if (!v) continue;
    mov.push({ data: b.data, desc: b.resto.replace(/(-?[\d.]+,\d{2})\s*$/, '').replace(/\s{2,}/g, ' ').trim(), valor: num(v[1]) });
  }
  const ordem = mov.reverse(); saldosDia.reverse();
  const saldoFinal = saldosDia.length ? saldosDia[saldosDia.length - 1].saldo : null;
  if (saldoAnterior === null && saldosDia.length) { const d0 = saldosDia[0].data; const somaD0 = ordem.filter(x => x.data === d0).reduce((a, x) => a + x.valor, 0); saldoAnterior = round2(saldosDia[0].saldo - somaD0); }
  const o = fecha({ banco: 'itau', saldoAnterior: saldoAnterior ?? 0, saldoFinal: saldoFinal ?? 0, mov: ordem, periodo: {} });
  o.saldoAnteriorDeclarado = bruto.some(b => /^SALDO ANTERIOR/i.test(b.resto));
  return o;
}
/* PagBank: "DD/MM/AAAA Descrição [-]R$ valor" em ordem cronológica, com
   "Saldo do dia DD/MM/AAAA R$ x" fechando cada dia. Saldo anterior = saldo do
   1º dia menos os lançamentos do dia. */
export function pagbank(txt) {
  let flat = txt.replace(/\s+/g, ' ');
  /* corta o cabeçalho (emissão, período, CNPJ) até a 1ª tabela */
  const cab = flat.search(/Descri[çc][ãa]o\s+Data\s+Valor/i); if (cab > 0) flat = flat.slice(cab);
  const reDia = /Saldo do dia (\d{2})\/(\d{2})\/(\d{4})\s+(-?)\s*R\$\s*([\d.]+,\d{2})/g;
  const saldosDia = []; let m; while ((m = reDia.exec(flat))) saldosDia.push({ data: iso(m[1], m[2], m[3]), saldo: num(m[4] + m[5]) });
  /* tira os fechos de dia e os cabeçalhos repetidos de página antes de ler os lançamentos */
  const corpo = flat.replace(reDia, ' ').replace(/Descri[çc][ãa]o\s+Data\s+Valor/gi, ' ');
  const re = /(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+(-?)\s*R\$\s*([\d.]+,\d{2})/g;
  const mov = [];
  while ((m = re.exec(corpo))) mov.push({ data: iso(m[1], m[2], m[3]), desc: m[4].replace(/\s{2,}/g, ' ').trim(), valor: num(m[5] + m[6]) });
  const saldoFinal = saldosDia.length ? saldosDia[saldosDia.length - 1].saldo : 0;
  let saldoAnterior = 0;
  if (saldosDia.length) { const d0 = saldosDia[0].data; saldoAnterior = round2(saldosDia[0].saldo - mov.filter(x => x.data === d0).reduce((a, x) => a + x.valor, 0)); }
  return fecha({ banco: 'pagbank', saldoAnterior, saldoFinal, mov, periodo: {} });
}

/* ---- OFX (qualquer banco) ---- */
/* OFX é texto (SGML ou XML). O conector do Microsoft 365 só o entrega quando o
   arquivo é salvo com extensão .txt (ex.: "Sicredi-PS.ofx.txt"). Valores exatos,
   sem layout de PDF: é a fonte preferida quando existe. Não há saldo inicial no
   OFX: saldoAnterior = LEDGERBAL − Σ lançamentos (a virada de saldo no fluxo-mes
   é a conferência independente). */
export const OFX_BANCOS = { '748': 'sicredi', '041': 'banrisul', '237': 'bradesco', '341': 'itau', '136': 'unicred', '197': 'stone', '290': 'pagbank' };
export const OFX_CONTAS = [ /* dígitos finais da conta → empresa (com o banco) */
  ['sicredi', '394302', 'ps'], ['sicredi', '157543', 'sf'], ['sicredi', '447909', 'as'], ['sicredi', '808482', 'siss'], ['sicredi', '244251', 'st'], ['sicredi', '314850', 'ss'],
  ['banrisul', '0604545302', 'ps'], ['banrisul', '0602546603', 'sf'], ['banrisul', '0626356003', 'as'], ['banrisul', '0601011307', 'siss'],
  ['bradesco', '480126', 'ps'], ['bradesco', '274054', 'sf'], ['bradesco', '49972', 'siss'],
  ['unicred', '117510', 'ps'], ['unicred', '117579', 'sf'], ['itau', '123882', 'as'],
  ['stone', '84845510', 'ps'], ['stone', '101399749', 'sf'], ['stone', '794672931', 'as'], ['pagbank', '861328607', 'ss'],
];
export const ehOFX = txt => /OFXHEADER|<OFX>/i.test(txt.slice(0, 4000));
const tag = (bloco, t) => { const m = bloco.match(new RegExp('<' + t + '>\\s*([^<\\r\\n]*)', 'i')); return m ? m[1].trim() : null; };
const dataOFX = s => { const m = (s || '').match(/^(\d{4})(\d{2})(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
/* valores OFX: "-1234.56" (padrão), "1.234,56" (BR) e até "R$ 51.561,88" (PagBank no LEDGERBAL) */
const numOFX = s => { if (s == null) return null; const t = String(s).trim().replace(/R\$/g, '').replace(/\s/g, ''); const v = /,\d{1,2}$/.test(t) && !/\.\d{1,2}$/.test(t) ? parseFloat(t.replace(/\./g, '').replace(',', '.')) : parseFloat(t.replace(/,/g, '')); return isNaN(v) ? null : v; };
export function ofx(txt) {
  const bankid = (tag(txt, 'BANKID') || '').replace(/\D/g, '').padStart(3, '0').slice(-3);
  const banco = OFX_BANCOS[bankid] || null;
  const acct = (tag(txt, 'ACCTID') || '').replace(/\D/g, '');
  const empresa = (OFX_CONTAS.find(([b, d]) => (!banco || b === banco) && acct.endsWith(d)) || [])[2] || null;
  const mov = [];
  for (const m of txt.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi)) {
    const b = m[1]; const data = dataOFX(tag(b, 'DTPOSTED')); let valor = numOFX(tag(b, 'TRNAMT'));
    if (!data || valor == null) continue;
    const trntype = (tag(b, 'TRNTYPE') || '').toUpperCase();
    if (valor > 0 && /^(DEBIT|OUT|PAYMENT|FEE|SRVCHG|CHECK|XFER_OUT|ATM|POS|REPEATPMT)$/.test(trntype)) valor = -valor; /* débito escrito positivo */
    const desc = [tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || (tag(b, 'TRNTYPE') || 'lançamento');
    mov.push({ data, desc, valor: round2(valor), fitid: tag(b, 'FITID') });
  }
  mov.sort((a, b) => a.data.localeCompare(b.data));
  const ledger = txt.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>)/i);
  const saldoFinal = ledger ? numOFX(tag(ledger[1], 'BALAMT')) : null;
  if (saldoFinal == null) throw new Error('OFX sem LEDGERBAL (saldo final) — não dá para ancorar o extrato');
  const soma = mov.reduce((a, x) => a + x.valor, 0);
  const saldoAnterior = round2(saldoFinal - soma);
  const o = fecha({ banco: banco || 'ofx', saldoAnterior, saldoFinal: round2(saldoFinal), mov, periodo: { de: dataOFX(tag(txt, 'DTSTART')), ate: dataOFX(tag(txt, 'DTEND')) } });
  o.formato = 'ofx'; o.empresa = empresa; o.bankid = bankid; o.conta = acct; o.saldoAnteriorDerivado = true;
  return o;
}
/* ---- outros formatos que chegam na pasta semanal (além de PDF e OFX) ----
   O conector Microsoft 365 devolve: .xlsx como "Workbook: … / ## Sheet: …" com
   linhas separadas por TAB; .xls convertido para PDF (texto achatado, com as
   colunas da direita em páginas separadas e células estreitas como "#####");
   .txt e .csv como texto puro. Cada leitor abaixo reconhece o seu formato pelo
   conteúdo (não pela extensão — o nome do arquivo não é confiável). */

/* "R$40,233.81" | "(R$13.00)" | "-R$1,000.00" → number (formato americano do XLS convertido) */
export function numUS(s) {
  if (s == null) return null;
  let t = String(s).trim(); let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  t = t.replace(/R\$/g, '').replace(/\s/g, '');
  if (/^-/.test(t)) { neg = true; t = t.slice(1); }
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(t)) return null;
  const v = parseFloat(t.replace(/,/g, ''));
  return neg ? -v : v;
}
/* extrato sem saldo no arquivo (CSV do Itaú, XLS do Sicredi sem lançamentos ou
   com todos os saldos ilegíveis): a leitura é válida, mas o saldo inicial tem de
   vir de fora — o fluxo-mes usa o fechamento do mês anterior no estado */
function fechaSemSaldo(o) {
  o.saldoAnterior = null; o.saldoFinal = null; o.semSaldo = true; o.ok = true; o.dif = 0;
  o.periodo = o.periodo || {};
  if (o.mov.length) { o.periodo.de = o.periodo.de || o.mov[0].data; o.periodo.ate = o.periodo.ate || o.mov[o.mov.length - 1].data; }
  return o;
}
const limpa = s => (s || '').replace(/\s+/g, ' ').trim();
const semDesconhecido = s => (s && !/^desconhecido$/i.test(s.trim()) ? s.trim() : '');

/* ---- Stone .xlsx ("Comprovante de Extrato.xlsx") ----
   Colunas: Movimentação (Crédito/Débito), Tipo, Valor, Saldo antes, Saldo
   depois, Tarifa, Data (DD/MM/AAAA HH:MM), Nosso Número, Situação, Destino,
   Destino Documento, Destino Instituição, Destino Agência, Destino Conta,
   Origem, Origem Documento, Origem Instituição, Origem Agência, Origem Conta.
   Do mais novo ao mais antigo. Valor = Δ(saldo depois − saldo antes); quando
   o Δ difere do "Valor" exatamente pela "Tarifa", a tarifa vira lançamento
   próprio (como no PDF, em que venda e tarifa vinham em linhas separadas).
   A conta própria é a conta Stone que aparece em todas as linhas. */
export const ehStoneXlsx = txt => /^Workbook:/m.test(txt.slice(0, 400)) && /Movimenta[çc][ãa]o\tTipo\tValor\tSaldo antes\tSaldo depois/i.test(txt.slice(0, 4000));
const STONE_PROPRIA = /^stone\b/i;
export function stoneXlsx(txt) {
  const linhas = txt.replace(/\r/g, '').split('\n');
  const hi = linhas.findIndex(l => /^Movimenta[çc][ãa]o\tTipo\tValor/i.test(l));
  if (hi < 0) throw new Error('Stone XLSX: não achei o cabeçalho da tabela');
  const cab = linhas[hi].split('\t').map(s => s.trim().toLowerCase());
  const col = nome => cab.indexOf(nome.toLowerCase());
  const I = { mov: col('Movimentação'), tipo: col('Tipo'), val: col('Valor'), ant: col('Saldo antes'), dep: col('Saldo depois'), tar: col('Tarifa'), data: col('Data'), dest: col('Destino'), destDoc: col('Destino Documento'), destInst: col('Destino Instituição'), destCta: col('Destino Conta'), ori: col('Origem'), oriDoc: col('Origem Documento'), oriInst: col('Origem Instituição'), oriCta: col('Origem Conta') };
  for (const k of ['mov', 'tipo', 'val', 'ant', 'dep', 'data']) if (I[k] < 0) throw new Error('Stone XLSX: falta a coluna ' + k);
  const g = (c, k) => (I[k] >= 0 ? (c[I[k]] || '').trim() : '');
  const rows = [];
  for (const l of linhas.slice(hi + 1)) {
    if (!l.trim() || /^## |^Formulas/i.test(l)) continue;
    const c = l.split('\t');
    const dm = g(c, 'data').match(/(\d{2})\/(\d{2})\/(\d{4})/); if (!dm) continue;
    const valor = num(g(c, 'val')), antes = num(g(c, 'ant')), depois = num(g(c, 'dep'));
    if (valor == null || antes == null || depois == null) throw new Error('Stone XLSX: linha sem valor/saldo legível em ' + g(c, 'data'));
    rows.push({ data: iso(dm[1], dm[2], dm[3]), credito: /^cr[eé]dito/i.test(g(c, 'mov')), tipo: g(c, 'tipo'), valor, antes, depois, tarifa: num(g(c, 'tar')) || 0, dest: g(c, 'dest'), destDoc: g(c, 'destDoc'), destInst: g(c, 'destInst'), destCta: g(c, 'destCta'), ori: g(c, 'ori'), oriDoc: g(c, 'oriDoc'), oriInst: g(c, 'oriInst'), oriCta: g(c, 'oriCta') });
  }
  if (!rows.length) throw new Error('Stone XLSX: nenhum lançamento reconhecido');
  /* ordem cronológica: a cadeia "saldo depois" de um lançamento = "saldo antes" do seguinte diz qual é */
  const quebras = lista => { let q = 0; for (let i = 0; i + 1 < lista.length; i++) if (Math.abs(lista[i].depois - lista[i + 1].antes) > CENTAVO) q++; return q; };
  let ordem = rows.slice().reverse(); let qb = quebras(ordem);
  if (qb && quebras(rows) < qb) { ordem = rows.slice(); qb = quebras(ordem); }
  /* conta própria: a conta Stone mais frequente (destino nos créditos, origem nos débitos) */
  const freq = {};
  for (const r of ordem) { const [inst, cta] = r.credito ? [r.destInst, r.destCta] : [r.oriInst, r.oriCta]; if (STONE_PROPRIA.test(inst) && cta) freq[cta] = (freq[cta] || 0) + 1; }
  const contaProp = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0] || null;
  const acct = (contaProp || '').replace(/\D/g, '');
  const empresa = (OFX_CONTAS.find(([b, d]) => b === 'stone' && acct && acct.endsWith(d)) || [])[2] || null;
  const mov = [];
  for (const r of ordem) {
    const dv = round2(r.depois - r.antes);
    const [nome, doc, inst] = r.credito ? [r.ori, r.oriDoc, r.oriInst] : [r.dest, r.destDoc, r.destInst];
    const contra = [semDesconhecido(nome), semDesconhecido(doc), semDesconhecido(inst)].filter(Boolean).join(' ');
    const tipo = r.tipo.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    let desc;
    if (/RECEBIVEL DE CARTAO/.test(tipo)) desc = 'RECEBIVEL DE CARTAO Stone';
    else if (/ENTRE CONTAS STONE/.test(tipo)) desc = 'TRANSFERENCIA ENTRE CONTAS STONE ' + (r.credito ? 'recebida de ' : 'enviada para ') + contra;
    else if (/^PIX$/.test(tipo)) desc = (r.credito ? 'PIX RECEBIDO ' : 'PIX ENVIADO ') + contra;
    else if (/^TED$/.test(tipo)) desc = (r.credito ? 'TED RECEBIDA ' : 'TED ENVIADA ') + contra;
    else if (/^TRANSACAO$/.test(tipo)) desc = (r.credito ? 'PIX RECEBIDO (transação) ' : 'TRANSACAO ENVIADA ') + contra;
    else desc = tipo + ' Stone ' + contra;
    desc = limpa((dv < 0 ? '(saída) ' : '') + desc);
    if (Math.abs(dv - r.valor) > CENTAVO && r.tarifa && Math.abs(round2(r.valor - r.tarifa) - dv) <= CENTAVO) {
      mov.push({ data: r.data, desc, valor: round2(r.valor) });
      mov.push({ data: r.data, desc: limpa('(saída) TARIFA Stone ' + r.tipo), valor: round2(-r.tarifa) });
    } else mov.push({ data: r.data, desc, valor: dv }); /* o Δ do saldo manda */
  }
  const o = fecha({ banco: 'stone', saldoAnterior: round2(ordem[0].antes), saldoFinal: round2(ordem[ordem.length - 1].depois), mov, periodo: {} });
  o.formato = 'xlsx'; o.empresa = empresa; o.conta = acct || null; o.quebrasDeCadeia = qb;
  return o;
}

/* ---- Sicredi .xls (export "extrato.xls" do internet banking) ----
   O conector converte a planilha em PDF e devolve o texto por página: primeiro
   TODAS as páginas com Data / Descrição / Documento, depois TODAS as páginas com
   Valor (R$) / Saldo (R$) (a planilha é mais larga que a folha). Os valores vêm
   no formato americano ("R$1,234.56", negativos entre parênteses) e as células
   estreitas demais aparecem como "###########" — quase sempre o Saldo. Por isso:
   o i-ésimo lançamento casa com o i-ésimo par (valor, saldo); os saldos legíveis
   são pontos de conferência da cadeia (saldo anterior + Σ valores); o saldo final
   é o último legível, ou derivado quando os últimos estão ilegíveis
   (saldoFinalDerivado — o fluxo-mes avisa). Sem lançamentos no período, o
   extrato vale como "sem movimento" e o saldo vem do mês anterior. */
export const ehSicrediXls = txt => /Associado:\s+Cooperativa:\s+Conta:/.test(txt.slice(0, 600)) && /Lan[çc]amentos Futuros|Saldo da Conta em|Dados referentes ao per[ií]odo|N[ãa]o h[áa] lan[çc]amentos no per[ií]odo/i.test(txt);
export function sicrediXls(txt) {
  /* quebra de página = quebra de linha simples; vira separador de células (2+ espaços) */
  const t = txt.replace(/\r/g, '').replace(/\[(?:truncated|pages?)\b[^\]]*\]/g, ' ').replace(/\n/g, '  \n');
  const per = t.match(/per[ií]odo de (\d{2})\/(\d{2})\/(\d{4}) a (\d{2})\/(\d{2})\/(\d{4})/i);
  const periodo = per ? { de: iso(per[1], per[2], per[3]), ate: iso(per[4], per[5], per[6]) } : {};
  /* conta ("24425-1") → empresa */
  const contas = [...t.matchAll(/\b(\d{4,6}-\d)\b/g)].map(m => m[1].replace(/\D/g, ''));
  const acct = contas.find(d => OFX_CONTAS.some(([b, dd]) => b === 'sicredi' && d.endsWith(dd))) || null;
  const empresa = acct ? (OFX_CONTAS.find(([b, d]) => b === 'sicredi' && acct.endsWith(d)) || [])[2] || null : null;
  const base = o => { o.formato = 'xls'; o.empresa = empresa; o.conta = acct; if (per) o.periodoDeclarado = { ...periodo }; return o; };
  if (/N[ãa]o h[áa] lan[çc]amentos no per[ií]odo/i.test(t)) return base(fechaSemSaldo({ banco: 'sicredi', mov: [], periodo: { ...periodo } }));
  const iSA = t.search(/Saldo Anterior/); const cabVal = t.match(/Valor \(R\$\)\s+Saldo \(R\$\)/);
  if (iSA < 0 || !cabVal) throw new Error('Sicredi XLS: não achei "Saldo Anterior" ou o cabeçalho "Valor (R$) Saldo (R$)"');
  /* região das descrições: entre "Saldo Anterior" e o cabeçalho dos valores, sem
     os rodapés de página e sem o bloco-resumo (saldos/limites/lançamentos futuros) */
  let descReg = t.slice(iSA + 'Saldo Anterior'.length, cabVal.index);
  /* rodapé: "NOME DO TITULAR [ nnn ] Extrato Dados referentes ao período de … a ….";
     o nome tem espaços simples — dois espaços seguidos já são o separador de células */
  descReg = descReg.replace(/\s{2,}[A-Z][A-Z0-9.&-]*(?: [A-Z0-9.&-]+)*(?:\s{2,}\d+)?\s{2,}Extrato\s{2,}Dados referentes ao per[ií]odo de \d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4}\./g, ' ');
  const corte = descReg.search(/\s{2,}(?:#{4,}|R\$|\d+\.\d{2}%|Lan[çc]amentos Futuros|Saldo atual|Valores das opera|Saldo da Conta em)/);
  if (corte >= 0) descReg = descReg.slice(0, corte);
  const rows = []; const reRow = /(\d{2})\/(\d{2})\/(\d{4})\s{2,}([\s\S]*?)(?=\s{2,}\d{2}\/\d{2}\/\d{4}\s{2,}|\s*$)/g;
  let m; while ((m = reRow.exec(descReg))) rows.push({ data: iso(m[1], m[2], m[3]), desc: limpa(m[4]) });
  if (!rows.length) throw new Error('Sicredi XLS: nenhum lançamento reconhecido na região de descrições');
  const toks = [...t.slice(cabVal.index + cabVal[0].length).matchAll(/\(R\$\s?[\d,]+\.\d{2}\)|-?R\$\s?[\d,]+\.\d{2}|#{4,}/g)].map(x => x[0]);
  const precisa = 1 + 2 * rows.length;
  if (toks.length < precisa) throw new Error(`Sicredi XLS: ${rows.length} lançamentos mas só ${toks.length} células de valor/saldo (esperava ${precisa}) — arquivo truncado? Releia todas as páginas (startPage).`);
  const extras = toks.length - precisa;
  if (extras && !(/Lan[çc]amentos Futuros/i.test(t) && !/N[ãa]o h[áa] lan[çc]amentos futuros/i.test(t) && extras <= 3)) throw new Error(`Sicredi XLS: ${extras} célula(s) de valor a mais do que lançamentos — não dá para casar linhas e valores com segurança.`);
  const ehIlegivel = s => /^#+$/.test(s);
  const valores = [], saldos = [];
  for (let i = 0; i < rows.length; i++) {
    const tv = toks[1 + 2 * i], ts = toks[2 + 2 * i];
    const v = ehIlegivel(tv) ? null : numUS(tv); if (!ehIlegivel(tv) && v == null) throw new Error(`Sicredi XLS: valor não numérico "${tv}" no lançamento ${i + 1}`);
    valores.push(v); saldos.push(ehIlegivel(ts) ? null : numUS(ts));
  }
  /* ancoragem: saldo anterior legível, ou derivado do 1º saldo legível (se todos
     os valores até ele forem legíveis) */
  let saldoAnterior = ehIlegivel(toks[0]) ? null : numUS(toks[0]);
  if (saldoAnterior == null) { let acc = 0; for (let i = 0; i < rows.length; i++) { if (valores[i] == null) break; acc = round2(acc + valores[i]); if (saldos[i] != null) { saldoAnterior = round2(saldos[i] - acc); break; } } }
  const mov = [];
  if (saldoAnterior == null) {
    if (valores.some(v => v == null)) throw new Error('Sicredi XLS: saldo anterior e valores ilegíveis ("####") — peça o extrato em PDF ou OFX.');
    for (let i = 0; i < rows.length; i++) mov.push({ data: rows[i].data, desc: rows[i].desc, valor: round2(valores[i]) });
    const o = base(fechaSemSaldo({ banco: 'sicredi', mov, periodo: { ...periodo } })); o.saldosIlegiveis = true; return o;
  }
  /* caminhada: valor ilegível é derivado do saldo da própria linha (saldo − saldo
     corrido); cada saldo legível é um ponto de conferência da cadeia */
  let run = saldoAnterior; const naoBatem = []; let ultimoLegivel = -1; let derivados = 0;
  for (let i = 0; i < rows.length; i++) {
    let v = valores[i];
    if (v == null) {
      if (saldos[i] == null) throw new Error(`Sicredi XLS: valor e saldo ilegíveis ("####") no lançamento ${i + 1} (${rows[i].data}) — peça o extrato em PDF ou OFX.`);
      v = round2(saldos[i] - run); derivados++;
    }
    mov.push({ data: rows[i].data, desc: rows[i].desc, valor: round2(v) });
    run = round2(run + v);
    if (saldos[i] != null) { ultimoLegivel = i; if (Math.abs(run - saldos[i]) > CENTAVO) naoBatem.push(rows[i].data); run = saldos[i]; }
  }
  const saldoFinal = ultimoLegivel === rows.length - 1 ? saldos[ultimoLegivel] : run;
  const o = base(fecha({ banco: 'sicredi', saldoAnterior, saldoFinal, mov, periodo: { ...periodo } }));
  if (naoBatem.length) { o.ok = false; o.dif = o.dif || 0.01; o.diasNaoBatem = naoBatem; }
  o.saldoFinalDerivado = ultimoLegivel !== rows.length - 1;
  o.ancoradoAte = ultimoLegivel >= 0 ? rows[ultimoLegivel].data : null;
  o.saldosLegiveis = saldos.filter(s => s != null).length; o.valoresDerivados = derivados;
  return o;
}

/* ---- Itaú .txt (export "Extrato_0912_123882_DD-MM-AAAA.txt") ----
   "DD/MM/AAAA;descrição;valor;" por linha, sem cabeçalho e SEM saldo. A conta
   vem só do nome do arquivo (agência_conta) — o fluxo-leituras usa o nome; sem
   ele, o Itaú tem uma única conta no grupo. Saldo inicial: fechamento do mês
   anterior (fluxo-mes). */
export const ehItauCsv = txt => { const ls = txt.replace(/\r/g, '').split('\n').filter(l => l.trim()); return ls.length > 0 && ls.every(l => /^\d{2}\/\d{2}\/\d{4};[^;]*;-?\d+(?:[.,]\d{1,2})?;?\s*$/.test(l)); };
export function itauCsv(txt) {
  const mov = [];
  for (const l of txt.replace(/\r/g, '').split('\n')) {
    if (!l.trim()) continue;
    const c = l.split(';'); const d = c[0].match(/(\d{2})\/(\d{2})\/(\d{4})/); const v = num(c[2]);
    if (!d || v == null) throw new Error('Itaú TXT: linha ilegível: ' + l.slice(0, 40));
    mov.push({ data: iso(d[1], d[2], d[3]), desc: limpa(c[1]) || 'lançamento', valor: round2(v) });
  }
  mov.sort((a, b) => a.data.localeCompare(b.data));
  const o = fechaSemSaldo({ banco: 'itau', mov, periodo: {} });
  o.formato = 'csv'; o.empresa = null; return o;
}

/* ---- tabela genérica (CSV/TSV/XLSX de qualquer banco com cabeçalho) ----
   Para formatos ainda não vistos: acha a linha de cabeçalho (colunas de data,
   descrição e valor — ou crédito/débito — e, se houver, saldo), lê as linhas,
   decide a ordem cronológica pela cadeia de saldos e reconcilia. Sem coluna de
   saldo, vale como "sem saldo" (saldo inicial do mês anterior). Números em
   formato brasileiro ou americano. */
const NRM = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const COLS = {
  data: /^(DATA|DT|DATA (DO |DE )?(LANC|MOV|OPER)|DATA LANCAMENTO|DATA MOVIMENTO|DATE)/,
  desc: /(HIST|DESCRI|LANCAMENTO|MEMO|DETALHE|TITULO|TIPO DE (LANC|TRANS)|NOME|FAVORECIDO|CONTRAPARTE|BENEFICIARIO|DOC)/,
  valor: /^(VALOR|VLR|VALOR \(R\$\)|MONTANTE|QUANTIA|AMOUNT)/,
  credito: /^(CREDITO|CREDITOS|ENTRADA|ENTRADAS|CREDITO \(R\$\)|CREDIT|C)$/,
  debito: /^(DEBITO|DEBITOS|SAIDA|SAIDAS|DEBITO \(R\$\)|DEBIT|D)$/,
  saldo: /^(SALDO|SALDO \(R\$\)|SALDO DEPOIS|SALDO FINAL|SALDO ATUAL|BALANCE)/,
  dc: /^(D\/C|C\/D|TIPO|NATUREZA|SINAL|MOVIMENTACAO)$/,
};
function numQualquer(s) {
  if (s == null) return null; let t = String(s).trim().replace(/R\$/g, '').trim(); if (!t) return null;
  let neg = false; if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
  if (/^-/.test(t)) { neg = true; t = t.slice(1).trim(); } if (/-\s*$/.test(t)) { neg = true; t = t.replace(/-\s*$/, '').trim(); }
  if (/^[CD]$/i.test(t)) return null;
  let v;
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$|^\d+,\d{1,2}$/.test(t)) v = parseFloat(t.replace(/\./g, '').replace(',', '.'));
  else if (/^\d{1,3}(,\d{3})+\.\d{1,2}$|^\d+\.\d{1,2}$/.test(t)) v = parseFloat(t.replace(/,/g, ''));
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) v = parseFloat(t.replace(/\./g, ''));
  else if (/^\d+$/.test(t)) v = parseFloat(t);
  else return null;
  return neg ? -v : v;
}
function dataQualquer(s) {
  const t = String(s || '').trim(); let m;
  if ((m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/))) return iso(m[1], m[2], m[3]);
  if ((m = t.match(/^(\d{2})\/(\d{2})\/(\d{2})(?!\d)/))) return iso(m[1], m[2], m[3]);
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{2})-(\d{2})-(\d{4})/))) return iso(m[1], m[2], m[3]);
  return null;
}
function linhasTabela(txt) {
  let t = txt.replace(/\r/g, '').replace(/^﻿/, '');
  const i = t.search(/^## Sheet:.*\n/m); if (/^Workbook:/m.test(t.slice(0, 400)) && i >= 0) t = t.slice(t.indexOf('\n', i) + 1);
  const ls = t.split('\n').filter(l => l.trim() && !/^## Sheet|^Formulas|^\[(truncated|pages?)\b/i.test(l));
  const sep = ['\t', ';', ','].map(s => ({ s, n: ls.slice(0, 30).reduce((a, l) => a + l.split(s).length - 1, 0) })).sort((a, b) => b.n - a.n)[0];
  if (!sep || !sep.n) return null;
  const celulas = l => { /* respeita aspas */
    const out = []; let cur = '', q = false;
    for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep.s && !q) { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur); return out.map(c => c.replace(/^"|"$/g, '').trim());
  };
  return { ls, sep: sep.s, celulas };
}
export function ehTabela(txt) {
  const T = linhasTabela(txt); if (!T) return false;
  for (const l of T.ls.slice(0, 40)) { const cs = T.celulas(l).map(NRM); if (cs.length >= 3 && cs.some(c => COLS.data.test(c)) && cs.some(c => COLS.valor.test(c) || COLS.credito.test(c) || COLS.debito.test(c))) return true; }
  return false;
}
export function tabela(txt, { banco } = {}) {
  const T = linhasTabela(txt); if (!T) throw new Error('tabela: não achei um separador de colunas');
  let hi = -1, map = null;
  for (let i = 0; i < Math.min(T.ls.length, 40); i++) {
    const cs = T.celulas(T.ls[i]).map(NRM);
    const m = { data: cs.findIndex(c => COLS.data.test(c)), valor: cs.findIndex(c => COLS.valor.test(c)), credito: cs.findIndex(c => COLS.credito.test(c)), debito: cs.findIndex(c => COLS.debito.test(c)), saldo: cs.findIndex(c => COLS.saldo.test(c)), dc: cs.findIndex(c => COLS.dc.test(c)), desc: cs.map((c, k) => (COLS.desc.test(c) && !COLS.data.test(c) ? k : -1)).filter(k => k >= 0) };
    if (m.data >= 0 && (m.valor >= 0 || (m.credito >= 0 && m.debito >= 0))) { hi = i; map = m; break; }
  }
  if (!map) throw new Error('tabela: não achei a linha de cabeçalho (data + valor ou crédito/débito)');
  if (!map.desc.length) map.desc = T.celulas(T.ls[hi]).map((c, k) => k).filter(k => ![map.data, map.valor, map.credito, map.debito, map.saldo, map.dc].includes(k));
  const rows = []; let saldoAnteriorDecl = null, dataAnterior = null;
  for (const l of T.ls.slice(hi + 1)) {
    const c = T.celulas(l); const data = dataQualquer(c[map.data]);
    const desc = limpa(map.desc.map(k => c[k]).filter(Boolean).join(' '));
    const saldo = map.saldo >= 0 ? numQualquer(c[map.saldo]) : null;
    let valor = null;
    if (map.valor >= 0) valor = numQualquer(c[map.valor]);
    if (valor == null && map.credito >= 0 && map.debito >= 0) { const cr = numQualquer(c[map.credito]), db = numQualquer(c[map.debito]); if (cr != null || db != null) valor = round2((cr || 0) - Math.abs(db || 0)); }
    if (valor != null && map.dc >= 0) { const dc = NRM(c[map.dc]); if (/^(D|DEBITO|DEB|SAIDA)$/.test(dc) && valor > 0) valor = -valor; }
    if (valor == null) { if (/SALDO (ANTERIOR|INICIAL)/.test(NRM(desc)) && saldo != null) { saldoAnteriorDecl = saldo; dataAnterior = data; } continue; }
    if (!data) continue;
    rows.push({ data, desc: desc || 'lançamento', valor: round2(valor), saldo });
  }
  if (!rows.length) throw new Error('tabela: nenhum lançamento com data e valor');
  const temSaldo = rows.some(r => r.saldo != null);
  if (!temSaldo) {
    const mov = rows.slice().sort((a, b) => a.data.localeCompare(b.data)).map(({ data, desc, valor }) => ({ data, desc, valor }));
    const o = fechaSemSaldo({ banco: banco || 'tabela', mov, periodo: {} }); o.formato = 'tabela'; if (saldoAnteriorDecl != null) { o.saldoAnterior = saldoAnteriorDecl; o.saldoFinal = round2(saldoAnteriorDecl + mov.reduce((a, x) => a + x.valor, 0)); o.semSaldo = false; o.saldoFinalDerivado = true; } return comCabecalho(comAnterior(o, dataAnterior), txt);
  }
  /* ordem cronológica = a que faz a cadeia de saldos fechar */
  const quebras = lista => { let q = 0, prev = null; for (const r of lista) { if (r.saldo != null && prev != null && Math.abs(round2(prev + r.valor) - r.saldo) > CENTAVO) q++; if (r.saldo != null) prev = r.saldo; } return q; };
  const asc = rows.slice(), desc = rows.slice().reverse();
  const ordem = quebras(desc) < quebras(asc) ? desc : asc;
  const i0 = ordem.findIndex(r => r.saldo != null);
  const saldoAnterior = saldoAnteriorDecl != null ? saldoAnteriorDecl : round2(ordem[i0].saldo - ordem.slice(0, i0 + 1).reduce((a, r) => a + r.valor, 0));
  const ultimo = [...ordem].reverse().find(r => r.saldo != null);
  const mov = ordem.map(({ data, desc, valor }) => ({ data, desc, valor }));
  const soma = mov.reduce((a, x) => a + x.valor, 0);
  const saldoFinal = ordem[ordem.length - 1].saldo != null ? ordem[ordem.length - 1].saldo : round2(saldoAnterior + soma);
  const o = fecha({ banco: banco || 'tabela', saldoAnterior, saldoFinal, mov, periodo: {} });
  o.formato = 'tabela'; o.saldoFinalDerivado = ordem[ordem.length - 1].saldo == null; o.ancoradoAte = ultimo ? ultimo.data : null;
  return comCabecalho(comAnterior(o, dataAnterior), txt);
}
/* a linha "DD/MM/AAAA SALDO ANTERIOR x" diz desde quando a conta está coberta: o saldo
   daquela data vale para os dias seguintes mesmo sem lançamento (ex.: transcrição de
   print que começa dias antes do primeiro movimento) */
function comAnterior(o, dataAnterior) {
  if (dataAnterior) { o.periodo = o.periodo || {}; if (!o.periodo.de || dataAnterior < o.periodo.de) o.periodo.de = dataAnterior; o.saldoAnteriorEm = dataAnterior; }
  return o;
}

/* ---- despacho por formato ---- */
/* qualidade da fonte (quando há mais de um arquivo do mesmo banco no mês, o
   fluxo-leituras fica com a melhor): OFX e XLSX da Stone trazem valores e
   saldos exatos; PDF idem; o XLS convertido perde saldos; CSV sem saldo depende
   do mês anterior */
export const QUALIDADE = { ofx: 4, xlsx: 4, pdf: 3, tabela: 2, xls: 2, csv: 1 };
export function detectaFormato(txt) {
  if (ehOFX(txt)) return 'ofx';
  if (ehStoneXlsx(txt)) return 'xlsx';
  if (ehSicrediXls(txt)) return 'xls';
  if (ehItauCsv(txt)) return 'csv';
  if (ehTabela(txt)) return 'tabela';
  return 'pdf';
}
const _P = { bradesco, unicred, sicredi, stone, banrisul, itau, pagbank };
function porFormato(banco, txt) {
  const f = detectaFormato(txt);
  let o;
  if (f === 'ofx') o = ofx(txt);
  else if (f === 'xlsx') o = stoneXlsx(txt);
  else if (f === 'xls') o = sicrediXls(txt);
  else if (f === 'csv') o = itauCsv(txt);
  else if (f === 'tabela') o = tabela(txt, { banco });
  else { if (!banco || !_P[banco]) throw new Error('texto de PDF sem banco reconhecido — informe o banco'); o = comCabecalho(_P[banco](txt), txt); o.formato = 'pdf'; }
  if (banco && o.banco !== banco && o.banco !== 'ofx' && o.banco !== 'tabela') throw new Error(`o arquivo é um extrato ${o.banco}, não ${banco}`);
  if (banco && (o.banco === 'ofx' || o.banco === 'tabela')) o.banco = banco;
  /* tabela genérica com saldo em todas as linhas (ex.: planilha do Sicredi salva como .xlsx) vale como OFX/XLSX; sem saldo, vale como CSV */
  o.qualidade = o.semSaldo ? QUALIDADE.csv : o.formato === 'tabela' ? (o.saldoFinalDerivado ? QUALIDADE.xls : QUALIDADE.xlsx) : (QUALIDADE[o.formato] || 0);
  return o;
}
export const PARSERS = Object.fromEntries(Object.keys(_P).map(k => [k, txt => porFormato(k, txt)]));
PARSERS.ofx = ofx; PARSERS.xlsx = stoneXlsx; PARSERS.xls = sicrediXls; PARSERS.csv = itauCsv; PARSERS.tabela = txt => tabela(txt);
/* leitura sem dizer o banco: descobre formato e banco pelo conteúdo (PDF exige o banco) */
export function leQualquer(txt, banco) { return porFormato(banco || null, txt); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const banco = process.argv[2], arq = process.argv[3];
  if (!banco || !arq || (banco !== 'auto' && !PARSERS[banco])) { console.error('uso: node fluxo-extratos.mjs <auto|' + Object.keys(PARSERS).join('|') + '> <arquivo.txt>   (auto = descobre formato e banco pelo conteúdo; PDF exige o banco)'); process.exit(1); }
  const o = banco === 'auto' ? leQualquer(readFileSync(arq, 'utf8')) : PARSERS[banco](readFileSync(arq, 'utf8'));
  console.log(`${o.banco}${o.empresa ? ' (' + o.empresa + ')' : ''} · formato ${o.formato}: ${o.mov.length} lançamentos · período ${o.periodo.de || '?'}–${o.periodo.ate || '?'} · anterior ${o.saldoAnterior} → final ${o.saldoFinal}${o.semSaldo ? ' (sem saldo no arquivo)' : ''}${o.saldoFinalDerivado ? ' (final derivado; ancorado até ' + o.ancoradoAte + ')' : ''} · reconcilia: ${o.ok ? 'OK (centavo)' : 'NÃO (dif ' + o.dif + ')'}` + (o.diasNaoBatem && o.diasNaoBatem.length ? ` · dias que não batem: ${o.diasNaoBatem.join(', ')}` : ''));
}
