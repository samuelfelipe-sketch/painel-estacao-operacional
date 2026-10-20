/* Estado da ferramenta de Fluxo de Caixa — CIFRADO no repositório.

   fluxo/estado.enc.json guarda, no mesmo cofre dos painéis:
     { v:1, atualizadoEm, origem, dados:{DATA, DIA, PREV, …} }
   - dados = as constantes de dados da ferramenta (ver DADOS em fluxo-lib),
             a fonte da verdade da esteira (substitui a pasta Ferramenta/).

   A fonte dos extratos é o arquivo mensal permanente do OneDrive
   (Financeiro/Financeiro/Bancos - Extratos/AAAA/MM/empresa/Banco.*); não há
   "caixa de entrada" nem passo de "marcar como lido". O controle de duplicado
   é o próprio mês já carregado no diário (DIA[mes].dias): a esteira só
   carrega mês que ainda não entrou, ou completa um mês parcial.

   Uso:
     node scripts/fluxo-estado.mjs inicia --html <ferramenta.html> [--forcar]
         primeira carga: extrai os dados do HTML publicado e grava o estado
     node scripts/fluxo-estado.mjs abre --para <pasta-fora-do-repo>
         → <pasta>/estado/NOME.json (um por constante)
     node scripts/fluxo-estado.mjs grava --de <pasta-fora-do-repo>
         lê <pasta>/estado/*.json, confere e regrava o estado
         (meses do diário não somem, dias cobertos não regridem)
     node scripts/fluxo-estado.mjs pendentes
         lista os meses que a esteira ainda precisa carregar (diário incompleto)
     node scripts/fluxo-estado.mjs extrai --html <ferramenta.html> --para <pasta>
         só extrai as constantes de um HTML para inspeção (não grava estado)

   Logs sem números do caixa. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { DADOS, falha, extraiTudo, canon, chave, cifra, decifra, foraDoRepo, opt, temFlag } from './fluxo-lib.mjs';

const args = process.argv.slice(2);
const modo = args[0];
const ARQ = resolve(opt(args, 'arquivo', 'fluxo/estado.enc.json'));

function le(k) { if (!existsSync(ARQ)) falha('não existe ' + ARQ + ' — rode "inicia" primeiro.'); return decifra(JSON.parse(readFileSync(ARQ, 'utf8')), k, 'o estado'); }
function gravaEstado(estado, k) {
  const doc = cifra(estado, k);
  if (canon(decifra(doc, k, 'o estado')) !== canon(estado)) falha('conferência de ida e volta falhou — nada gravado.');
  writeFileSync(ARQ, JSON.stringify(doc));
}
function resumo(e) {
  const DIA = e.dados.DIA || {};
  const meses = Object.keys(DIA).filter(m => DIA[m] && DIA[m].dias > 0).sort();
  return `${Object.keys(e.dados).length} constantes · diário com ${meses.length} mês(es) com dados (último ${meses[meses.length - 1] || '—'}, ${meses.length ? DIA[meses[meses.length - 1]].dias : 0} dias) · atualizado em ${e.atualizadoEm}`;
}
function despeja(dados, para) {
  const dir = join(para, 'estado'); mkdirSync(dir, { recursive: true });
  for (const n of Object.keys(dados)) writeFileSync(join(dir, n + '.json'), JSON.stringify(dados[n]));
  return dir;
}

if (modo === 'inicia') {
  const htmlPath = opt(args, 'html'); if (!htmlPath) falha('informe --html <ferramenta.html>.');
  if (existsSync(ARQ) && !temFlag(args, 'forcar')) falha(ARQ + ' já existe — use "grava" para atualizar, ou --forcar para recomeçar do HTML.');
  const html = readFileSync(htmlPath, 'utf8');
  let dados; try { dados = extraiTudo(html); } catch (e) { falha(e.message); }
  const k = chave();
  const estado = { v: 1, atualizadoEm: new Date().toISOString().slice(0, 16), origem: 'html publicado', dados };
  gravaEstado(estado, k);
  console.log(`iniciado: ${ARQ} · ${resumo(estado)}`);
} else if (modo === 'abre') {
  const para = opt(args, 'para'); if (!para) falha('informe --para <pasta fora do repositório>.');
  foraDoRepo(para, '--para');
  const k = chave(); const e = le(k);
  const dir = despeja(e.dados, para);
  console.log(`aberto: ${dir}/ · ${resumo(e)}`);
} else if (modo === 'pendentes') {
  const k = chave(); const e = le(k); const DIA = e.dados.DIA || {};
  const hoje = new Date(); const mesAtual = hoje.toISOString().slice(0, 7);
  const meses = new Set(Object.keys(DIA)); meses.add(mesAtual);
  const pend = [];
  for (const m of [...meses].sort()) {
    if (m < '2026-07' || m > mesAtual) continue;
    const [a, mm] = m.split('-').map(Number); const nd = new Date(a, mm, 0).getDate(); const d = (DIA[m] || {}).dias || 0;
    if (m === mesAtual) pend.push(`${m}: mês corrente, ${d} de ${nd} dias no diário → carregar o realizado até D-1`);
    else if (d < nd) pend.push(`${m}: ${d} de ${nd} dias no diário → fechar o mês`);
  }
  console.log(pend.length ? pend.join('\n') : 'nada pendente: diário completo até ontem.');
} else if (modo === 'extrai') {
  const htmlPath = opt(args, 'html'); const para = opt(args, 'para');
  if (!htmlPath || !para) falha('informe --html <ferramenta.html> e --para <pasta fora do repositório>.');
  foraDoRepo(para, '--para');
  let dados; try { dados = extraiTudo(readFileSync(htmlPath, 'utf8')); } catch (e) { falha(e.message); }
  const dir = despeja(dados, para);
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
  /* conferências: nada do passado some */
  const dA = atual.dados.DIA || {}, dN = dados.DIA || {};
  for (const m of Object.keys(dA)) {
    if (!(m in dN)) falha(`DIA: o mês ${m} sumiria — nada gravado.`);
    if ((dN[m].dias || 0) < (dA[m].dias || 0)) falha(`DIA: os dias cobertos de ${m} regrediriam — nada gravado.`);
  }
  for (const m of Object.keys((atual.dados.DATA || {}).meses || {})) if (!((dados.DATA || {}).meses || {})[m]) falha(`DATA: o mês ${m} sumiria — nada gravado.`);
  const estado = { v: 1, atualizadoEm: new Date().toISOString().slice(0, 16), origem: 'esteira', dados };
  gravaEstado(estado, k);
  console.log(`gravado: ${ARQ} · ${resumo(estado)}`);
} else {
  falha('modo desconhecido — use "inicia", "abre", "grava", "pendentes" ou "extrai".');
}
