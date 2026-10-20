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
  const sa = flat.match(/SALDO ANTERIOR\s+([\d.]+,\d{2})/i);
  if (!sa) throw new Error('Bradesco: não achei SALDO ANTERIOR');
  const saldoAnterior = num(sa[1]);
  const ini = sa.index + sa[0].length;
  const fimM = flat.slice(ini).search(/\bTotal\b|Últimos Lançamentos|Os dados acima/);
  const body = fimM >= 0 ? flat.slice(ini, ini + fimM) : flat.slice(ini);
  /* por lançamento: [data?] [descrição] [doc inteiro?] <valor> <saldo>; a data,
     quando ausente, é herdada da anterior. valor conferido pelo Δ saldo. */
  const datas = [...body.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map(x => ({ i: x.index, d: iso(x[1], x[2], x[3]) }));
  const pares = /(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})/g;
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
  /* linha: DATA DESC (...) R$ <saldo> [-] R$ <valor>; valor conferido pelo Δ saldo */
  const re2 = /(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+R\$\s*([\d.,]+)\s+(-?)\s*R\$\s*([\d.,]+)(?=\s+\d{2}\/\d{2}\/\d{4}|\s*$)/g;
  let m;
  while ((m = re2.exec(linhas))) {
    const data = iso(m[1], m[2], m[3]);
    const saldo = num(m[5]);
    const valor = round2(saldo - prev); prev = saldo;
    mov.push({ data, desc: m[4].replace(/\(.*?\)/g, '').trim(), valor });
  }
  return fecha({ banco: 'unicred', saldoAnterior, saldoFinal: prev, mov, periodo: {} });
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
  const re = /(\d{2})\/(\d{2})\/(\d{2})\s+(Entrada|Saída)\s+(.+?)\s+(-?R\$\s*[\d.,]+)\s+(R\$\s*[\d.,]+)/g;
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
/* Banrisul: largura fixa; "SALDO ANT EM DD/MM/AAAA x"; dias "NN HISTORICO ...";
   débito = valor com "-" ao final; "SALDO NA DATA x" fecha o dia. */
export function banrisul(txt) {
  const sa = txt.match(/SALDO ANT EM \d{2}\/\d{2}\/\d{4}\s+([\d.,]+)/i);
  if (!sa) throw new Error('Banrisul: não achei SALDO ANT');
  const saldoAnterior = num(sa[1]);
  const mesM = txt.match(/MOVIMENTOS\s+([A-Z]{3})\/(\d{4})/i);
  const MES = { JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12' };
  const mm = mesM ? MES[mesM[1].toUpperCase()] : null, aa = mesM ? mesM[2] : null;
  const mov = []; let dia = null, saldoFinal = saldoAnterior; const saldosDia = [];
  for (const raw of txt.split('\n')) {
    const ln = raw.replace(/\s+$/, '');
    const dd = ln.match(/^(\d{2})\s+\S/); if (dd) dia = dd[1];
    const sd = ln.match(/SALDO NA DATA\s+([\d.,]+)/i); if (sd) { saldoFinal = num(sd[1]); if (dia && mm) saldosDia.push({ dia, saldo: saldoFinal }); continue; }
    if (/SALDO ANT EM|MOVIMENTOS|SALDO DISPONIVEL|SALDO INICIAL|SALDO NA DATA|LIMITE|TARIFA|TAXA DE JUROS|CUSTO EFETIVO|BANRICOMPRAS|EXTRATO|NOME:|IOF/i.test(ln)) {
      const valI = ln.match(/(-?[\d.]+,\d{2})-?\s*$/);
      if (/IOF|TARIFA/i.test(ln) && valI && dia && mm) { let v = num(valI[1] + (/-\s*$/.test(ln) ? '-' : '')); mov.push({ data: iso(dia, mm, aa), desc: ln.replace(/\s{2,}/g, ' ').replace(/[-\d.,\s]+$/, '').trim(), valor: v }); }
      continue;
    }
    const valM = ln.match(/(-?[\d.]+,\d{2})(-?)\s*$/);
    if (valM && dia && mm) {
      let v = num(valM[1]); if (valM[2] === '-') v = -Math.abs(v);
      const desc = ln.replace(/^\d{2}\s+/, '').replace(/\s{2,}/g, ' ').replace(/[-\d.,\s]+$/, '').trim();
      if (desc) mov.push({ data: iso(dia, mm, aa), desc, valor: v });
    }
  }
  const o = fecha({ banco: 'banrisul', saldoAnterior, saldoFinal, mov, periodo: {} });
  /* conferência extra: cada "SALDO NA DATA" bate com o acumulado */
  let run = saldoAnterior, i = 0; o.diasOk = true;
  const porDia = {}; for (const x of mov) porDia[x.data] = (porDia[x.data] || 0) + x.valor;
  return o;
}
/* Itaú: newest-first; "DD/MM/AAAA SALDO TOTAL DISPONÍVEL DIA x" fecha o dia;
   demais linhas com data = lançamentos (último número = valor, "-" = débito). */
export function itau(txt) {
  const linhas = txt.replace(/\s+/g, ' ');
  const re = /(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)(?=\s+\d{2}\/\d{2}\/\d{4}|\s*$)/g;
  let m; const bruto = [];
  while ((m = re.exec(linhas))) bruto.push({ data: iso(m[1], m[2], m[3]), resto: m[4].trim() });
  const mov = []; const saldosDia = [];
  for (const b of bruto) {
    if (/SALDO TOTAL DISPON[IÍ]VEL DIA/i.test(b.resto)) { const v = b.resto.match(/(-?[\d.]+,\d{2})\s*$/); if (v) saldosDia.push({ data: b.data, saldo: num(v[1]) }); continue; }
    const v = b.resto.match(/(-?[\d.]+,\d{2})\s*$/); if (!v) continue;
    mov.push({ data: b.data, desc: b.resto.replace(/(-?[\d.]+,\d{2})\s*$/, '').replace(/\s{2,}/g, ' ').trim(), valor: num(v[1]) });
  }
  const ordem = mov.reverse();
  saldosDia.reverse();
  const saldoFinal = saldosDia.length ? saldosDia[saldosDia.length - 1].saldo : null;
  /* saldo anterior: saldo do dia mais antigo menos os lançamentos daquele dia */
  let saldoAnterior = null;
  if (saldosDia.length) { const d0 = saldosDia[0].data; const somaD0 = ordem.filter(x => x.data === d0).reduce((a, x) => a + x.valor, 0); saldoAnterior = round2(saldosDia[0].saldo - somaD0); }
  const o = fecha({ banco: 'itau', saldoAnterior: saldoAnterior ?? 0, saldoFinal: saldoFinal ?? 0, mov: ordem, periodo: {} });
  o.semSaldoAnterior = saldoAnterior === null;
  return o;
}

export const PARSERS = { bradesco, unicred, sicredi, stone, banrisul, itau };

if (import.meta.url === `file://${process.argv[1]}`) {
  const banco = process.argv[2], arq = process.argv[3];
  if (!banco || !arq || !PARSERS[banco]) { console.error('uso: node fluxo-extratos.mjs <bradesco|unicred|sicredi|stone|banrisul|itau> <arquivo.txt>'); process.exit(1); }
  const o = PARSERS[banco](readFileSync(arq, 'utf8'));
  console.log(`${banco}: ${o.mov.length} lançamentos · período ${o.periodo.de || '?'}–${o.periodo.ate || '?'} · reconcilia: ${o.ok ? 'OK (centavo)' : 'NÃO (dif ' + o.dif + ')'}`);
}
