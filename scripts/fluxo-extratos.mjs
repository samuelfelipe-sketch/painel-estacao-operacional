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
  t = t.trim().replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = parseFloat(t);
  return neg ? -v : v;
}
const iso = (d, m, a) => `${a.length === 2 ? '20' + a : a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
function fecha(o) {
  const soma = o.mov.reduce((a, x) => a + x.valor, 0);
  o.dif = round2(o.saldoAnterior + soma - o.saldoFinal);
  o.ok = Math.abs(o.dif) <= CENTAVO;
  if (o.mov.length) { o.periodo = o.periodo || {}; o.periodo.de = o.periodo.de || o.mov[0].data; o.periodo.ate = o.periodo.ate || o.mov[o.mov.length - 1].data; }
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
  const re2 = /(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+R\$\s*([\d.,]+)\s+(-?)\s*R\$\s*([\d.,]+)/g;
  let m;
  while ((m = re2.exec(linhas))) {
    const data = iso(m[1], m[2], m[3]);
    if (/^Saldo em/i.test(m[4])) continue;
    const saldo = num(m[5]);
    const valor = round2(saldo - prev); prev = saldo;
    const desc = m[4].replace(/\(\s*Doc\.?:\s*/i, '').replace(/\)\s*$/, '').replace(/\s{2,}/g, ' ').trim();
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
  const re = /(\d{2})\/(\d{2})\/(\d{2})\s+(Entrada|Saída)\s+(.+?)\s+(-?\s*R\$\s*[\d.,]+)\s+(R\$\s*[\d.,]+)/g;
  let m; const bruto = [];
  const linhas = txt.replace(/\s+/g, ' ');
  while ((m = re.exec(linhas))) {
    bruto.push({ data: iso(m[1], m[2], m[3]), tipo: m[4], desc: m[5].trim(), valor: num(m[6]), saldo: num(m[7]) });
  }
  if (!bruto.length) throw new Error('Stone: nenhum lançamento reconhecido');
  const sgn = x => x.tipo === 'Saída' ? -1 : 1;
  const ordem = bruto.slice().reverse(); /* o PDF vem do mais novo ao mais antigo */
  const saldoFinal = bruto[0].saldo;      /* 1ª linha do PDF = último dia */
  const a0 = ordem[0];
  const saldoAnterior = round2(a0.saldo - sgn(a0) * Math.abs(a0.valor));
  const mov = ordem.map(x => ({ data: x.data, desc: (x.tipo === 'Saída' ? '(saída) ' : '') + x.desc, valor: sgn(x) * Math.abs(x.valor) }));
  return fecha({ banco: 'stone', saldoAnterior, saldoFinal, mov, periodo: {} });
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

export const PARSERS = { bradesco, unicred, sicredi, stone, banrisul, itau, pagbank };

if (import.meta.url === `file://${process.argv[1]}`) {
  const banco = process.argv[2], arq = process.argv[3];
  if (!banco || !arq || !PARSERS[banco]) { console.error('uso: node fluxo-extratos.mjs <' + Object.keys(PARSERS).join('|') + '> <arquivo.txt>'); process.exit(1); }
  const o = PARSERS[banco](readFileSync(arq, 'utf8'));
  console.log(`${banco}: ${o.mov.length} lançamentos · período ${o.periodo.de || '?'}–${o.periodo.ate || '?'} · anterior ${o.saldoAnterior} → final ${o.saldoFinal} · reconcilia: ${o.ok ? 'OK (centavo)' : 'NÃO (dif ' + o.dif + ')'}` + (o.diasNaoBatem && o.diasNaoBatem.length ? ` · dias que não batem: ${o.diasNaoBatem.join(', ')}` : ''));
}
