/* Embute o estado (JSONs) na ferramenta de Fluxo de Caixa.

   Pega o HTML base (a versão publicada, decifrada para /tmp) e troca cada
   constante de dados presente em <pasta>/estado/NOME.json pelo JSON novo,
   preservando CSS, HTML e código. Confere a ida e volta (extrair do HTML
   gerado devolve exatamente o que foi embutido) e que as constantes não
   trocadas continuam idênticas.

   Uso:
     node scripts/fluxo-embute.mjs --base <fluxo-anterior.html> --estado <pasta-fora-do-repo> --saida <fluxo-novo.html>

   Logs sem números do caixa. */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { DADOS, falha, embute, foraDoRepo, opt } from './fluxo-lib.mjs';

const args = process.argv.slice(2);
const base = opt(args, 'base'), pasta = opt(args, 'estado'), saida = opt(args, 'saida');
if (!base || !pasta || !saida) falha('informe --base <html>, --estado <pasta> e --saida <html>.');
foraDoRepo(saida, '--saida');
const dir = join(pasta, 'estado'); if (!existsSync(dir)) falha('não existe ' + dir + '.');
const dados = {};
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  const n = f.slice(0, -5);
  if (!DADOS.includes(n)) falha('arquivo inesperado em estado/: ' + f);
  try { dados[n] = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch (e) { falha(f + ' não é JSON válido.'); }
}
if (!Object.keys(dados).length) falha('nenhum JSON de dados em ' + dir + '.');
const html = readFileSync(base, 'utf8');
let r; try { r = embute(html, dados); } catch (e) { falha(e.message); }
/* card "Projeção": os rótulos de meses são literais no código da ferramenta;
   quando PROJ traz meta (fluxo-previsao proj), troca-os pelos meses atuais */
const meta = dados.PROJ && dados.PROJ.meta; let rot = 0;
if (meta) {
  const sub = (re, novo) => { const antes = r.html; r.html = r.html.replace(re, novo); if (r.html !== antes) rot++; };
  sub(/Geração projetada \([^)]*\)/, `Geração projetada (${meta.curto})`);
  sub(/Saldo projetado em \d{2}\/\d{2}/, `Saldo projetado em ${meta.fim_em}`);
  sub(/em \d{2}\/\d{2}<\/div><\/div>`:''}/, `em ${meta.base_em}</div></div>\`:''}`);
  sub(/Projeção de fluxo de caixa — [^<]*<\/h2>/, `Projeção de fluxo de caixa — ${meta.titulo}</h2>`);
  sub(/\['\w{3} \(proj\)','\w{3} \(proj\)'\]/, `['${meta.cols[0]}','${meta.cols[1]}']`);
  const i = r.html.indexOf('<h2>Premissas do cenário base</h2>'); const j = i >= 0 ? r.html.indexOf('</div></div>`', i) : -1;
  if (i >= 0 && j > i) { r.html = r.html.slice(0, i) + `<h2>Premissas do cenário base</h2>     <div class="desc" style="margin-bottom:0">     1. Entradas e saídas ordinárias = <b>mediana dos meses completos</b> (${meta.base_meses}) por empresa e por bloco de contas (receita bruta; custos; tributos e impostos; despesas; financeiras), repartida entre as contas pelo mix do último mês fechado; a mediana elimina o extraordinário (imobilizado, aquisições). O primeiro mês de uma empresa que entrou no grupo com o ano andando (arranque) fica fora da base.<br>     2. <b>Serviço da dívida e parcelas contratadas</b>: mediana dos últimos meses fechados em que aparecem, nas datas do último mês fechado.<br>     3. Captações, amortizações do giro rotativo, resgates e "outras entradas" (transferências de contas fora dos extratos) = zero. <b>Distribuições de lucros</b> entram pelo calendário combinado (ST mensal; Siss e SF no fim de cada trimestre).<br>     4. Títulos já agendados no Argo não entram nesta projeção (a rotina automática não lê o Argo). Recalculada pela rotina em ${meta.gerado_em.split('-').reverse().join('/')}.` + r.html.slice(j); rot++; }
}
writeFileSync(saida, r.html);
console.log(`embutido: ${saida} · ${r.trocadas.length} constante(s): ${r.trocadas.join(', ')}${meta ? ` · rótulos da projeção: ${rot}/6` : ''} · ${(html.length / 1024).toFixed(0)} KB → ${(r.html.length / 1024).toFixed(0)} KB`);
