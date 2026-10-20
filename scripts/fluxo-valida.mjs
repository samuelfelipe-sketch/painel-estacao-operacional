/* Validação da ferramenta de Fluxo de Caixa antes de publicar.

   Confere o contrato que o shell fluxo/index.html espera, a coerência
   interna dos números (conciliação por empresa/mês, sem receita diária
   negativa) e abre o HTML no Chromium em 1440px e 390px (zero erros de JS,
   sem rolagem lateral, selects populados, UI preservada).
   Imprime só "ok"/"falhou"/"aviso" por item — nunca os valores da ferramenta.

   Uso:
     node scripts/fluxo-valida.mjs --html <ferramenta.html> [--pw <pasta do pacote playwright>]
   Playwright: o ambiente já tem o Chromium (PLAYWRIGHT_BROWSERS_PATH); o pacote
   npm é instalado fora do repositório, ex.: mkdir -p /tmp/pw && cd /tmp/pw && npm i playwright@1.54
   Sai com código 0 quando tudo passa; 1 quando algum item obrigatório falha. */
import { readFileSync, statSync } from 'fs';
import { createRequire } from 'module';
import { extraiTudo, CONSTS_SHELL } from './fluxo-lib.mjs';

const args = process.argv.slice(2);
function opt(nome, padrao) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; }
const htmlPath = opt('html'); if (!htmlPath) { console.error('informe --html <arquivo>'); process.exit(1); }
const pwDir = opt('pw', '/tmp/pw/node_modules/playwright');
const html = readFileSync(htmlPath, 'utf8');
const itens = []; let falhou = false;
function item(nome, ok, obrigatorio = true, nota) { itens.push({ nome, ok, obrigatorio, nota }); if (!ok && obrigatorio) falhou = true; }

/* ---- contrato estático ---- */
item('arquivo até 2 MB', statSync(htmlPath).size <= 2 * 1024 * 1024);
item('sem <script src> (tudo embutido)', !/<script[^>]+src=/i.test(html));
const deps = (html.match(/<(?:script|link|img|iframe|source|video|audio)\b[^>]*\b(?:src|href)="(https?:[^"]+)"/g) || []).map(t => t.replace(/^.*="(https?:[^"]+)"$/, '$1'))
  .concat((html.match(/(?:url\(|@import\s+)['"]?(https?:[^'")\s]+)/g) || []).map(t => t.replace(/^.*?(https?:[^'")\s]+)$/, '$1')));
const externos = deps.filter(u => !/^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(u));
item('só a fonte do Google como dependência externa', externos.length === 0, true, externos.length ? externos.length + ' externa(s)' : '');
item('constantes que o site consome presentes (' + CONSTS_SHELL.join(', ') + ')', CONSTS_SHELL.every(n => new RegExp('^\\s*const\\s+' + n + '\\s*=', 'm').test(html)));
item('selects de empresa e período (#selEmp, #selMes)', /id="selEmp"/.test(html) && /id="selMes"/.test(html));
item('função render() presente', /function render\s*\(/.test(html));
item('UI preservada: linha CAIXA FINAL (tr.cxfim) e marcador do período (curbox)', /cxfim/.test(html) && /curbox/.test(html));
item('UI preservada: alerta de caixa negativo (negcx/alertneg)', /negcx/.test(html) && /alertneg/.test(html));
item('UI preservada: botões de coluna prevista / tendência (fcbtn)', /fcbtn/.test(html));

/* ---- coerência dos números (lê as constantes embutidas) ---- */
let D = null;
try { D = extraiTudo(html); } catch (e) { item('constantes de dados avaliáveis', false, true, e.message.slice(0, 60)); }
if (D) {
  const sObj = o => Object.values(o || {}).reduce((a, v) => a + v.reduce((x, y) => x + (+y || 0), 0), 0);
  const sArr = a => (a || []).reduce((x, y) => x + (+y || 0), 0);
  const meses = (D.DATA && D.DATA.meses) || {};
  let piorConc = 0, conc = 0; const negs = [];
  for (const m of Object.keys(meses)) {
    const MM = meses[m]; if (!MM.empresas) continue;
    for (const e of Object.keys(MM.empresas)) {
      const d = MM.empresas[e]; if (!d.contas || !d.contas.length) continue;
      const ini = d.contas.reduce((a, c) => a + (+c.ini || 0), 0), fim = d.contas.reduce((a, c) => a + (+c.fim || 0), 0);
      const dif = Math.abs(ini + sObj(d.cin) - sObj(d.cout) + sArr(d.icw) - fim);
      piorConc = Math.max(piorConc, dif); conc++;
    }
  }
  /* receita diária negativa em qualquer conta de entrada */
  for (const m of Object.keys(D.DIA || {})) {
    const D2 = D.DIA[m]; if (!D2.empresas) continue;
    for (const e of Object.keys(D2.empresas)) {
      for (const [c, v] of Object.entries(D2.empresas[e].cin || {})) {
        if ((v || []).some(x => x < -0.005)) negs.push(`${m}/${e}/${c}`);
      }
    }
  }
  item('conciliação ini+entradas−saídas+intercompany = fim (por empresa/mês)', piorConc < 1.0, true, 'pior diferença ' + (piorConc < 0.01 ? '< 1 centavo' : piorConc < 1 ? '< R$ 1' : '≥ R$ 1') + ' em ' + conc + ' escopos');
  item('nenhuma receita diária negativa', negs.length === 0, true, negs.length ? negs.length + ' caso(s)' : '');
}

/* ---- Chromium: render em 1440px e 390px ---- */
(async () => {
  let chromium;
  try { chromium = createRequire(import.meta.url)(pwDir).chromium; }
  catch (e) { item('playwright disponível em ' + pwDir, false); return fim(); }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  for (const w of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const p = await ctx.newPage(); const erros = [];
    p.on('pageerror', e => erros.push(String(e)));
    await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
    await p.setContent(html, { waitUntil: 'load' }); await p.waitForTimeout(500);
    const m = await p.evaluate(() => ({
      sx: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      emp: (document.getElementById('selEmp') || {}).length || 0,
      mes: (document.getElementById('selMes') || {}).length || 0,
      sheets: document.querySelectorAll('table.sheet').length,
    }));
    item(`${w}px: zero erros de JS`, erros.length === 0, true, erros.length ? erros[0].slice(0, 80) : '');
    item(`${w}px: sem rolagem lateral`, m.sx <= m.cw + 1);
    if (w === 1440) {
      item('selects populados (empresas e períodos)', m.emp >= 3 && m.mes >= 1, true, m.emp + ' empresas, ' + m.mes + ' períodos');
      item('tabela de fluxo renderizada', m.sheets >= 1);
    }
    await ctx.close();
  }
  await browser.close();
  fim();
})().catch(e => { console.error('erro na validação: ' + e.message); process.exit(1); });

function fim() {
  for (const it of itens) console.log((it.ok ? '  ok   ' : (it.obrigatorio ? 'FALHOU ' : 'aviso  ')) + it.nome + (it.nota ? ' (' + it.nota + ')' : ''));
  console.log(falhou ? 'RESULTADO: reprovado — não publicar.' : 'RESULTADO: aprovado.');
  process.exit(falhou ? 1 : 0);
}
