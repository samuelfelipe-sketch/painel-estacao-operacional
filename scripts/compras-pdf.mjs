/* Converte o PDF do Argo "Relatório de Compra de Combustíveis" (texto extraído
   com `pdftotext -layout`) no mesmo CSV que o conector devolve para
   `DD-MM-AAAA_RelatorioDeCompraDeCombustiveis.csv` — assim a carga histórica
   (um período longo exportado de uma vez) passa pela mesma esteira:
   compras-pdf → negociacao-compras → mercado-sapatao grava.

   Uso:
     pdftotext -layout relatorio.pdf /tmp/rel.txt
     node scripts/compras-pdf.mjs --txt /tmp/rel.txt --saida /tmp/compras.csv

   Conferências (reprovou, não grava): cada "Total:" do dia bate com a soma dos
   itens (volume e custo, também quando o dia atravessa a página), cada "Total
   Unidade de Negócio" e o "Total Geral" batem com a soma dos itens, e nenhuma
   linha com cara de item fica sem ler. Os logs dizem só datas e contagens. */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
function opt(nome) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] ? args[i + 1] : null; }
function falha(m) { console.error('ERRO: ' + m); process.exit(1); }
const txt = opt('txt'), saida = opt('saida');
if (!txt || !saida) falha('uso: --txt <texto do pdftotext -layout> --saida <csv fora do repositório>.');
if (resolve(saida).startsWith(resolve('.')) && !resolve(saida).startsWith('/tmp')) falha('--saida precisa apontar para fora do repositório.');

const N = '(-?[\\d.]+,\\d+)';
const RE_UNI = /^\s*(\d+) - (.+?) \| CNPJ:/;
const RE_DATA = /^\s+(\d{2}\/\d{2}\/\d{4})\s*$/;
const RE_ITEM = new RegExp(`^\\s{4,}([A-Z0-9]{1,4} - .+?)\\s{2,}(\\S.*?)\\s{2,}${N}\\s+${N}\\s+${N}\\s+${N}\\s+${N}\\s*$`);
const RE_CODIGO = /^\s{4,}[A-Z0-9]{1,4} - /;
const RE_TOT = new RegExp(`^\\s+Total:\\s+${N}\\s+${N}\\s+${N}\\s*$`);
const RE_TUNI = new RegExp(`^\\s+Total Unidade de Negócio:\\s+${N}\\s+${N}\\s+${N}\\s*$`);
const RE_TGER = new RegExp(`^\\s+Total Geral:\\s+${N}\\s+${N}\\s+${N}\\s*$`);
const num = s => parseFloat(s.replace(/\./g, '').replace(',', '.'));
const igual = (a, b) => Math.abs(a - b) < 0.015;

const linhas = readFileSync(txt, 'utf8').split(/\r?\n/);
const itens = []; let uni = null, razao = '', data = null, ult = null;
let dia = { vol: 0, custo: 0, n: 0 }, tUni = { vol: 0, custo: 0 }, tGer = { vol: 0, custo: 0 };
let dias = 0, unidades = 0;
for (let i = 0; i < linhas.length; i++) {
  const l = linhas[i];
  let m;
  if ((m = RE_UNI.exec(l))) { if (uni !== m[1]) { uni = m[1]; razao = m[2].trim(); } ult = null; continue; }
  if ((m = RE_DATA.exec(l))) { if (data !== m[1]) { data = m[1]; } ult = null; continue; }
  if ((m = RE_ITEM.exec(l))) {
    if (!uni || !data) falha(`item sem unidade/data na linha ${i + 1}.`);
    const it = { uni, razao, data, desc: m[1].trim(), notas: m[2].trim(), q: m[3], pc: m[4], tc: m[5], ce: m[6], te: m[7] };
    itens.push(it); ult = it;
    const v = num(it.q), c = num(it.tc);
    dia.vol += v; dia.custo += c; dia.n++; tUni.vol += v; tUni.custo += c; tGer.vol += v; tGer.custo += c;
    continue;
  }
  if (RE_CODIGO.test(l)) falha(`linha ${i + 1} parece item, mas não foi lida.`);
  if ((m = RE_TOT.exec(l))) {
    if (!igual(dia.vol, num(m[1])) || !igual(dia.custo, num(m[2]))) falha(`total do dia não bate (unidade ${uni}, ${data}).`);
    dia = { vol: 0, custo: 0, n: 0 }; dias++; ult = null; continue;
  }
  if ((m = RE_TUNI.exec(l))) {
    if (!igual(tUni.vol, num(m[1])) || !igual(tUni.custo, num(m[2]))) falha(`total da unidade ${uni} não bate.`);
    tUni = { vol: 0, custo: 0 }; unidades++; ult = null; continue;
  }
  if ((m = RE_TGER.exec(l))) {
    if (!igual(tGer.vol, num(m[1])) || !igual(tGer.custo, num(m[2]))) falha('total geral não bate.');
    tGer = null; continue;
  }
  // continuação da descrição (ex.: "POWER" na linha de baixo)
  const resto = l.trim();
  if (ult && resto && /^[A-ZÀ-Ú0-9 .\-\/]+$/.test(resto) && /^\s{6,}\S/.test(l) && !/Descrição|Entrada|Página/.test(resto)) { ult.desc += ' ' + resto; continue; }
  if (resto && !/^(Argo Gerenciador|Relatório de Compra|Data Entrada:|Entrada$|Descrição|Página \d+ de \d+)/.test(resto)) ult = null;
}
if (tGer !== null) falha('o texto não traz o "Total Geral" (arquivo cortado?).');
if (dia.n) falha('sobrou dia sem "Total:".');

const cab = 'Unidade;Razão Social;Entrada;Descrição;Nota(s);Quantidade;Preço Custo;Total Custo;Custo Efetivo;Total Efetivo';
const csv = [cab, ...itens.map(t => [t.uni, t.razao, t.data, t.desc, t.notas, t.q, t.pc, t.tc, t.ce, t.te].map(x => String(x).replace(/;/g, ',')).join(';'))].join('\n') + '\n';
writeFileSync(saida, csv);
const datas = itens.map(t => t.data.split('/').reverse().join('-')).sort();
console.log(`ok: ${itens.length} itens, ${dias} totais de dia e ${unidades} unidades conferidos; ${datas[0]} a ${datas[datas.length - 1]}.`);
