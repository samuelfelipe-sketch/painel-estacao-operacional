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
writeFileSync(saida, r.html);
console.log(`embutido: ${saida} · ${r.trocadas.length} constante(s): ${r.trocadas.join(', ')} · ${(html.length / 1024).toFixed(0)} KB → ${(r.html.length / 1024).toFixed(0)} KB`);
