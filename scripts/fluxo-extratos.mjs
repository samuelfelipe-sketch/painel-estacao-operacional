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
const numOFX = s => { if (s == null) return null; const t = String(s).trim().replace(/\s/g, ''); const v = /,\d{1,2}$/.test(t) && !/\.\d{1,2}$/.test(t) ? parseFloat(t.replace(/\./g, '').replace(',', '.')) : parseFloat(t.replace(/,/g, '')); return isNaN(v) ? null : v; };
export function ofx(txt) {
  const bankid = (tag(txt, 'BANKID') || '').replace(/\D/g, '').padStart(3, '0').slice(-3);
  const banco = OFX_BANCOS[bankid] || null;
  const acct = (tag(txt, 'ACCTID') || '').replace(/\D/g, '');
  const empresa = (OFX_CONTAS.find(([b, d]) => (!banco || b === banco) && acct.endsWith(d)) || [])[2] || null;
  const mov = [];
  for (const m of txt.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi)) {
    const b = m[1]; const data = dataOFX(tag(b, 'DTPOSTED')); const valor = numOFX(tag(b, 'TRNAMT'));
    if (!data || valor == null) continue;
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
const _P = { bradesco, unicred, sicredi, stone, banrisul, itau, pagbank };
export const PARSERS = Object.fromEntries(Object.entries(_P).map(([k, f]) => [k, txt => ehOFX(txt) ? ofx(txt) : comCabecalho(f(txt), txt)]));
PARSERS.ofx = ofx;

if (import.meta.url === `file://${process.argv[1]}`) {
  const banco = process.argv[2], arq = process.argv[3];
  if (!banco || !arq || !PARSERS[banco]) { console.error('uso: node fluxo-extratos.mjs <' + Object.keys(PARSERS).join('|') + '> <arquivo.txt>'); process.exit(1); }
  const o = PARSERS[banco](readFileSync(arq, 'utf8'));
  console.log(`${banco}: ${o.mov.length} lançamentos · período ${o.periodo.de || '?'}–${o.periodo.ate || '?'} · anterior ${o.saldoAnterior} → final ${o.saldoFinal} · reconcilia: ${o.ok ? 'OK (centavo)' : 'NÃO (dif ' + o.dif + ')'}` + (o.diasNaoBatem && o.diasNaoBatem.length ? ` · dias que não batem: ${o.diasNaoBatem.join(', ')}` : ''));
}
