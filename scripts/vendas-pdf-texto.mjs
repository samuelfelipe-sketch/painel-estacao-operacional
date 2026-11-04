/* PDF do relatório "Acompanhamento de Metas e Margens de Vendas" → texto no
   formato que o conector Microsoft 365 devolve (uma página por linha, tabelas
   achatadas em ordem de linha, rodapé "Página N de M  Argo … GERADO EM … Data …
   Unidades …" no fim de cada página), para o scripts/vendas-monta.mjs ler.

   Serve para relatórios que chegam como ARQUIVO (upload numa sessão, semeadura
   do histórico) em vez de pela pasta do OneDrive. Usa o `pdftotext -bbox-layout`
   (poppler) para ter cada palavra com a sua posição e remonta as linhas da
   tabela pela geometria: o rótulo da linha (coluna da esquerda) é a âncora e
   cada número vai para a linha mais próxima — é o que resolve o número largo
   que o Argo quebra em duas linhas dentro da célula ("235.339,3" + "9"), que o
   `-layout` espalhava nas linhas vizinhas. O cabeçalho de página, que no PDF
   fica no topo, é reescrito como o rodapé que o montador espera.

   Uso:
     node scripts/vendas-pdf-texto.mjs --pdf <relatorio.pdf> --saida <fora-do-repo>/relatorio.txt

   Log: páginas, Data e unidades do relatório. Nenhum valor. */
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
function opt(nome, padrao) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; }
function falha(m) { console.error('ERRO: ' + m); process.exit(1); }

const pdf = opt('pdf'); if (!pdf) falha('informe --pdf <arquivo.pdf>.');
const saida = opt('saida'); if (!saida) falha('informe --saida <arquivo.txt fora do repositório>.');
if (resolve(saida).startsWith(resolve('.')) && !resolve(saida).startsWith('/tmp')) falha('--saida precisa apontar para fora do repositório (o texto do relatório nunca é commitado).');

let bruto;
try { bruto = execFileSync('pdftotext', ['-bbox-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
catch (e) { falha('pdftotext falhou (poppler instalado?): ' + (e.message || e)); }

const ent = t => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
const paginasHtml = [...bruto.matchAll(/<page [^>]*>([\s\S]*?)<\/page>/g)].map(m => m[1]);
if (!paginasHtml.length) falha('o PDF não tem texto (digitalizado?).');

/* palavras com posição → linhas da tabela pela geometria */
function linhasDaPagina(html) {
  const ws = [...html.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g)]
    .map(m => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: ent(m[5]).trim() })).filter(w => w.t);
  ws.forEach(w => { w.yc = (w.y0 + w.y1) / 2; });
  const X_ANCORA = 40, TOL_ANCORA = 9, TOL_LIVRE = 3;
  /* âncoras: palavras na coluna da esquerda (rótulos, títulos, cabeçalho) agrupadas por altura */
  const linhas = [];
  for (const w of ws.filter(w => w.x0 < X_ANCORA).sort((a, b) => a.yc - b.yc)) {
    const l = linhas.find(l => Math.abs(l.yc - w.yc) <= TOL_LIVRE);
    if (l) l.ws.push(w); else linhas.push({ yc: w.yc, ws: [w], ancora: true });
  }
  for (const w of ws.filter(w => w.x0 >= X_ANCORA)) {
    let melhor = null, d = Infinity;
    for (const l of linhas) { const dd = Math.abs(l.yc - w.yc); if (dd < d && ((l.ancora && dd <= TOL_ANCORA) || (!l.ancora && dd <= TOL_LIVRE))) { d = dd; melhor = l; } }
    if (melhor) melhor.ws.push(w); else linhas.push({ yc: w.yc, ws: [w], ancora: false });
  }
  linhas.sort((a, b) => a.yc - b.yc);
  return linhas.map(l => {
    const ord = l.ws.slice().sort((a, b) => a.x0 - b.x0);
    const out = [];
    for (const w of ord) {
      const p = out[out.length - 1];
      if (p && w.x0 < p.x1 - 0.5) { /* pedaços empilhados da mesma célula: junta na ordem de cima para baixo */
        const cima = p.y0 <= w.y0 ? p : w, baixo = cima === p ? w : p;
        p.t = cima.t + baixo.t; p.x1 = Math.max(p.x1, w.x1); p.y0 = Math.min(p.y0, w.y0);
      } else out.push({ t: w.t, x0: w.x0, x1: w.x1, y0: w.y0 });
    }
    return out.map(w => w.t).join(' ');
  });
}

const paginas = paginasHtml;
let meta = null;
const linhasSaida = paginas.map((pag, idx) => {
  const linhas = linhasDaPagina(pag);
  /* cabeçalho: da 1ª linha até a linha "Data: … | Unidades: …" */
  const iData = linhas.findIndex(l => /^Data:\s*\d{2}\/\d{2}\/\d{4}/.test(l) && /Unidades:/.test(l));
  if (iData < 0) falha(`página ${idx + 1} sem a linha "Data: … Unidades: …".`);
  const cab = linhas.slice(0, iData + 1), corpo = linhas.slice(iData + 1).filter(l => !/^Página\s+\d+\s+de\s+\d+$/.test(l));
  const l1 = cab.find(l => /^Argo\s/.test(l)) || '';
  const mArgo = l1.match(/^(Argo\s+[A-Za-z][A-Za-z ]*?)\s+(v\.[\d.]+)/);
  const mGer = cab.join(' ').match(/GERADO EM:\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/);
  const linhaData = cab[iData];
  if (!mArgo || !mGer) falha(`página ${idx + 1}: cabeçalho do Argo fora do esperado.`);
  const m = { nome: mArgo[1].trim(), versao: mArgo[2], gerado: mGer[1] + ' ' + mGer[2], linhaData };
  if (!meta) meta = m;
  else if (m.linhaData !== meta.linhaData || m.gerado !== meta.gerado) falha(`página ${idx + 1} com cabeçalho diferente da página 1 (PDFs misturados?).`);
  const rodape = `Página ${idx + 1} de ${paginas.length}  ${m.nome} ${m.versao} - Argo Sistemas  ESTAÇÃO SAPATÃO (100)  Acompanhamento de Metas e Margens de Vendas   GERADO EM: ${m.gerado}  ${linhaData}`;
  return (corpo.length ? corpo.join(' ') + '  ' : '') + rodape;
});

writeFileSync(saida, linhasSaida.join('\n') + '\n');
const d = meta.linhaData.match(/Data:\s*(\S+)/), u = meta.linhaData.match(/Unidades:\s*([\d,]+)/);
console.log(`ok: ${saida} · ${paginas.length} páginas · Data ${d ? d[1] : '?'} · unidades ${u ? u[1] : '?'} · ${meta.nome} ${meta.versao} · gerado ${meta.gerado}`);
