/* Validação da ferramenta de Negociação de Preços antes de publicar.

   Confere o contrato que o shell negociacao/index.html espera e a coerência
   interna dos números (somas), abrindo o HTML no Chromium em 1440px e 390px.
   Imprime só "ok"/"falhou" por item — nunca os valores da ferramenta.

   Uso:
     node scripts/negociacao-valida.mjs --html <ferramenta.html> [--pw <pasta do pacote playwright>]
   Playwright: o ambiente já tem o Chromium (PLAYWRIGHT_BROWSERS_PATH); o pacote
   npm é instalado fora do repositório, ex.: mkdir -p /tmp/pw && cd /tmp/pw && npm i playwright@1.54
   Sai com código 0 quando tudo passa; 1 quando algum item obrigatório falha. */
import { readFileSync, statSync } from 'fs';
import { createRequire } from 'module';

const args = process.argv.slice(2);
function opt(nome, padrao) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; }
const htmlPath = opt('html'); if (!htmlPath) { console.error('informe --html <arquivo>'); process.exit(1); }
const pwDir = opt('pw', '/tmp/pw/node_modules/playwright');
const html = readFileSync(htmlPath, 'utf8');
const itens = []; let falhou = false;
function item(nome, ok, obrigatorio = true, nota) { itens.push({ nome, ok, obrigatorio, nota }); if (!ok && obrigatorio) falhou = true; }

/* ---- contrato estático ---- */
item('arquivo até 300 KB', statSync(htmlPath).size <= 300 * 1024);
item('sem <script src> (tudo embutido)', !/<script[^>]+src=/i.test(html));
/* dependências = o que o navegador baixa: src/href de script, link, img, iframe e url()/@import no CSS (links de texto não contam) */
const deps = (html.match(/<(?:script|link|img|iframe|source|video|audio)\b[^>]*\b(?:src|href)="(https?:[^"]+)"/g) || []).map(t => t.replace(/^.*="(https?:[^"]+)"$/, '$1'))
  .concat((html.match(/(?:url\(|@import\s+)['"]?(https?:[^'")\s]+)/g) || []).map(t => t.replace(/^.*?(https?:[^'")\s]+)$/, '$1')));
const externos = deps.filter(u => !/^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(u));
item('só a fonte do Google como dependência externa', externos.length === 0, true, externos.length ? externos.length + ' dependência(s) externa(s)' : '');
item('não lê nada em tempo de execução (fetch/localStorage)', !/\b(fetch\(|localStorage|sessionStorage|XMLHttpRequest)\b/.test(html));
item('.topbar com .ref', /class="topbar"/.test(html) && /class="ref"/.test(html));
item('#menuNav e #menuBackdrop', /id="menuNav"/.test(html) && /id="menuBackdrop"/.test(html));
const ids = new Set((html.match(/id="([^"]+)"/g) || []).map(x => x.slice(4, -1)));
const alvos = (html.match(/<nav[^>]*id="menuNav"[\s\S]*?<\/nav>/) || [''])[0].match(/href="#([^"]+)"/g) || [];
const semAlvo = alvos.map(a => a.slice(7, -1)).filter(id => !ids.has(id));
item('todo link do menu aponta para uma seção que existe', alvos.length >= 6 && semAlvo.length === 0, true, semAlvo.length ? semAlvo.length + ' sem alvo' : alvos.length + ' links');
item('seções 01 a 06 presentes', ['resumo', 'mapa', 'impacto', 'consolidado', 'compras2026', 'margens'].every(id => ids.has(id)));
item('tema claro fixo (color-scheme:light)', /color-scheme\s*:\s*light/.test(html));

/* ---- datas: nenhuma data DD/MM/AAAA no futuro ---- */
const hoje = new Date(); hoje.setHours(23, 59, 59, 999);
const futuras = (html.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g) || []).filter(d => { const [dd, mm, aa] = d.split('/').map(Number); return new Date(aa, mm - 1, dd) > hoje; });
item('nenhuma data completa no futuro', futuras.length === 0, true, futuras.length ? futuras.length + ' data(s)' : '');

/* ---- números: somas das tabelas (lidas do DOM no navegador) ---- */
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
    await p.setContent(html, { waitUntil: 'load' }); await p.waitForTimeout(400);
    const m = await p.evaluate(() => ({ sx: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, menu: getComputedStyle(document.getElementById('menuNav')).position }));
    item(`${w}px: zero erros de JS`, erros.length === 0, true, erros.length ? erros.length + ' erro(s)' : '');
    item(`${w}px: sem rolagem lateral`, m.sx <= m.cw + 1);
    if (w === 390) item('390px: menu vira gaveta (position fixed)', m.menu === 'fixed');
    if (w === 1440) {
      const somas = await p.evaluate(() => {
        const num = t => { const s = (t || '').replace(/\s/g, '').replace(/[R$milL]/g, ''); if (!/\d/.test(s) || /—/.test(s)) return null; return parseFloat(s.replace(/\./g, '').replace(',', '.')); };
        const linhas = tbl => Array.from(tbl.querySelectorAll('tbody tr, tr')).filter(tr => tr.querySelectorAll('td').length >= 3)
          .map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()));
        const r = {};
        /* 04 consolidado: colunas mês/trimestre/ano, linha "Total cenário-alvo" = soma das alavancas */
        const cons = document.querySelector('#consolidado table');
        if (cons) {
          const ls = linhas(cons); const tot = ls.find(l => /total cenário/i.test(l[0])); const alav = ls.filter(l => /^[A-F]\./.test(l[0]));
          if (tot && alav.length) {
            const n = tot.length; const cols = [n - 3, n - 2, n - 1];
            r.consolidado = cols.every(c => { const s = alav.reduce((a, l) => a + (num(l[l.length - (n - c)]) || 0), 0); const t = num(tot[c]); return t !== null && Math.abs(s - t) <= Math.max(1, Math.abs(t) * 0.001); });
            const conserv = ls.find(l => /conservador/i.test(l[0]));
            r.conservadorMenor = !conserv || cols.every(c => (num(conserv[c]) || 0) <= (num(tot[c]) || 0) + 0.5);
          }
        }
        /* 05 compras: meses somam o "Total 2026"; produtos somam o total (ou avisam) */
        const tabs = Array.from(document.querySelectorAll('#compras2026 table'));
        const tMes = tabs.find(t => /janeiro/i.test(t.textContent)), tProd = tabs.find(t => /gasolina comum/i.test(t.textContent));
        if (tMes) {
          const ls = linhas(tMes); const tot = ls.find(l => /^total/i.test(l[0]));
          const meses = ls.filter(l => /^(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/i.test(l[0]) && !/em curso/i.test(l[0]));
          if (tot && meses.length) {
            const v = meses.reduce((a, l) => a + (num(l[1]) || 0), 0), g = meses.reduce((a, l) => a + (num(l[2]) || 0), 0);
            r.comprasMeses = Math.abs(v - num(tot[1])) <= 1000 && Math.abs(g - num(tot[2])) <= 1000;
            const pm = num(tot[3]); r.precoMedio = pm !== null && Math.abs(num(tot[2]) / num(tot[1]) - pm) < 0.001;
            if (tProd) { const lp = linhas(tProd).filter(l => !/^total/i.test(l[0])); const vp = lp.reduce((a, l) => a + (num(l[1]) || 0), 0); r.comprasProdutos = Math.abs(vp - num(tot[1])) <= 1000; }
          }
        }
        return r;
      });
      item('04 · total cenário-alvo = soma das alavancas (mês, trimestre, ano)', somas.consolidado === true);
      item('04 · conservador ≤ alvo', somas.conservadorMenor !== false);
      item('05 · meses somam o total do ano (volume e gasto)', somas.comprasMeses === true);
      item('05 · preço médio = gasto ÷ volume', somas.precoMedio === true);
      item('05 · produtos somam o total do ano', somas.comprasProdutos === true, false, somas.comprasProdutos === false ? 'tabela por produto desatualizada — marcar como leitura anterior' : '');
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
