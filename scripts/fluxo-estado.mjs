/* Estado da ferramenta de Fluxo de Caixa — CIFRADO no repositório.

   fluxo/estado.enc.json guarda, no mesmo cofre dos painéis:
     { v:1, atualizadoEm, origem, dados:{DATA, DIA, PREV, …}, leitura:"<markdown>" }
   - dados   = as constantes de dados da ferramenta (ver DADOS em fluxo-lib),
               a fonte da verdade da esteira (substitui a pasta Ferramenta/).
   - leitura = log de leitura de extratos (Markdown, append-only: cabeçalho,
               `---`, uma linha de tabela por arquivo lido).

   Uso:
     node scripts/fluxo-estado.mjs inicia --html <ferramenta.html> [--forcar]
         primeira carga: extrai os dados do HTML publicado e grava o estado
     node scripts/fluxo-estado.mjs abre --para <pasta-fora-do-repo>
         → <pasta>/estado/NOME.json (um por constante) + <pasta>/estado/leitura.md
     node scripts/fluxo-estado.mjs grava --de <pasta-fora-do-repo>
         lê <pasta>/estado/*.json + leitura.md, confere e regrava o estado
         (meses do diário não somem, dias cobertos não regridem, cabeçalho
         do log não muda, log só cresce)
     node scripts/fluxo-estado.mjs extrai --html <ferramenta.html> --para <pasta>
         só extrai as constantes de um HTML para inspeção (não grava estado)

   Logs sem números do caixa. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { DADOS, falha, extraiTudo, canon, chave, cifra, decifra, foraDoRepo, opt, temFlag } from './fluxo-lib.mjs';

const args = process.argv.slice(2);
const modo = args[0];
const ARQ = resolve(opt(args, 'arquivo', 'fluxo/estado.enc.json'));
const CAB_PADRAO = '# Leitura de extratos — Fluxo de Caixa\n\nUma linha por arquivo lido: empresa, banco/conta, período coberto, data da leitura, observação. O log só cresce; nunca se apaga linha.\n\n---\n\n| Arquivo | Empresa | Banco / conta | Período lido | Lido em | Obs |\n|---|---|---|---|---|---|\n';

function le(k) { if (!existsSync(ARQ)) falha('não existe ' + ARQ + ' — rode "inicia" primeiro.'); return decifra(JSON.parse(readFileSync(ARQ, 'utf8')), k, 'o estado'); }
function gravaEstado(estado, k) {
  const doc = cifra(estado, k);
  if (canon(decifra(doc, k, 'o estado')) !== canon(estado)) falha('conferência de ida e volta falhou — nada gravado.');
  writeFileSync(ARQ, JSON.stringify(doc));
}
function resumo(e) {
  const DIA = e.dados.DIA || {};
  const meses = Object.keys(DIA).filter(m => DIA[m] && DIA[m].dias > 0).sort();
  const linhas = (e.leitura.split('\n').filter(l => /^\|/.test(l)).length - 2);
  return `${Object.keys(e.dados).length} constantes · diário com ${meses.length} mês(es) com dados (último ${meses[meses.length - 1] || '—'}, ${meses.length ? DIA[meses[meses.length - 1]].dias : 0} dias) · log com ${Math.max(0, linhas)} leitura(s) · atualizado em ${e.atualizadoEm}`;
}
function despeja(dados, leitura, para) {
  const dir = join(para, 'estado'); mkdirSync(dir, { recursive: true });
  for (const n of Object.keys(dados)) writeFileSync(join(dir, n + '.json'), JSON.stringify(dados[n]));
  writeFileSync(join(dir, 'leitura.md'), leitura);
  return dir;
}
function cabecalho(md) { const i = md.search(/^---\s*$/m); return i < 0 ? null : md.slice(0, i); }
function nLinhas(md) { return md.split('\n').filter(l => /^\|\s*[^|\s-]/.test(l) && !/^\|\s*Arquivo/.test(l)).length; }

if (modo === 'inicia') {
  const htmlPath = opt(args, 'html'); if (!htmlPath) falha('informe --html <ferramenta.html>.');
  if (existsSync(ARQ) && !temFlag(args, 'forcar')) falha(ARQ + ' já existe — use "grava" para atualizar, ou --forcar para recomeçar do HTML.');
  const html = readFileSync(htmlPath, 'utf8');
  let dados; try { dados = extraiTudo(html); } catch (e) { falha(e.message); }
  const k = chave();
  const estado = { v: 1, atualizadoEm: new Date().toISOString().slice(0, 16), origem: 'html publicado', dados, leitura: CAB_PADRAO };
  gravaEstado(estado, k);
  console.log(`iniciado: ${ARQ} · ${resumo(estado)}`);
} else if (modo === 'abre') {
  const para = opt(args, 'para'); if (!para) falha('informe --para <pasta fora do repositório>.');
  foraDoRepo(para, '--para');
  const k = chave(); const e = le(k);
  const dir = despeja(e.dados, e.leitura, para);
  console.log(`aberto: ${dir}/ · ${resumo(e)}`);
} else if (modo === 'extrai') {
  const htmlPath = opt(args, 'html'); const para = opt(args, 'para');
  if (!htmlPath || !para) falha('informe --html <ferramenta.html> e --para <pasta fora do repositório>.');
  foraDoRepo(para, '--para');
  let dados; try { dados = extraiTudo(readFileSync(htmlPath, 'utf8')); } catch (e) { falha(e.message); }
  const dir = despeja(dados, CAB_PADRAO, para);
  console.log(`extraído: ${dir}/ · ${Object.keys(dados).length} constantes`);
} else if (modo === 'grava') {
  const de = opt(args, 'de'); if (!de) falha('informe --de <pasta fora do repositório>.');
  foraDoRepo(de, '--de');
  const dir = join(de, 'estado'); if (!existsSync(dir)) falha('não existe ' + dir + '.');
  const k = chave(); const atual = le(k);
  const dados = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const n = f.slice(0, -5);
    if (!DADOS.includes(n)) falha('arquivo inesperado em estado/: ' + f);
    try { dados[n] = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch (e) { falha(f + ' não é JSON válido.'); }
  }
  for (const n of Object.keys(atual.dados)) if (!(n in dados)) falha('faltou estado/' + n + '.json — o estado é gravado inteiro.');
  const leitura = existsSync(join(dir, 'leitura.md')) ? readFileSync(join(dir, 'leitura.md'), 'utf8') : atual.leitura;
  /* conferências: nada do passado some */
  const dA = atual.dados.DIA || {}, dN = dados.DIA || {};
  for (const m of Object.keys(dA)) {
    if (!(m in dN)) falha(`DIA: o mês ${m} sumiria — nada gravado.`);
    if ((dN[m].dias || 0) < (dA[m].dias || 0)) falha(`DIA: os dias cobertos de ${m} regrediriam — nada gravado.`);
  }
  for (const m of Object.keys((atual.dados.DATA || {}).meses || {})) if (!((dados.DATA || {}).meses || {})[m]) falha(`DATA: o mês ${m} sumiria — nada gravado.`);
  const cabA = cabecalho(atual.leitura), cabN = cabecalho(leitura);
  if (!cabN) falha('leitura.md precisa de uma linha "---" separando o cabeçalho das linhas.');
  if (cabA && cabN !== cabA && !temFlag(args, 'forcar')) falha('o cabeçalho do log de leitura mudaria — nada gravado (use --forcar se for intencional).');
  if (nLinhas(leitura) < nLinhas(atual.leitura)) falha('o log de leitura encolheria — nada gravado.');
  const estado = { v: 1, atualizadoEm: new Date().toISOString().slice(0, 16), origem: 'esteira', dados, leitura };
  gravaEstado(estado, k);
  console.log(`gravado: ${ARQ} · ${resumo(estado)} · leituras novas: ${nLinhas(leitura) - nLinhas(atual.leitura)}`);
} else {
  falha('modo desconhecido — use "inicia", "abre", "grava" ou "extrai".');
}
