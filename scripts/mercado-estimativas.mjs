/* Market Share — estimativas de venda de concorrentes informadas pelo Samuel,
   CIFRADAS em mercado/estimativas.enc.json com a chave dos dados (SAPATAO_DEK),
   no formato {enc:1,iv,ct} que o navegador abre com window.sapataoCofre.

   Conteúdo (em claro só dentro do cifrado):
     { v:1, atualizado_em, unidade:'m3/mês',
       postos:{ '<cnpj>':{ nome, total, otto?, diesel?, ref:'AAAA-MM', fonte:'Samuel', em:'AAAA-MM-DD', obs? } } }
   `total` (e, se souber, `otto`/`diesel`) = volume que a pessoa estima para o
   posto num mês típico, em m³. `ref` = mês de referência: o painel calcula o
   fator estimativa ÷ régua automática (bicos × média da bandeira) nesse mês e
   aplica o mesmo fator aos outros meses — a sazonalidade e a comparação com o
   ano anterior continuam vindo da ANP.

   Uso:
     node scripts/mercado-estimativas.mjs grava --json <arquivo em claro FORA do repo> [--substitui]
       → funde (ou substitui) os postos do arquivo no publicado
     node scripts/mercado-estimativas.mjs abre --para <pasta fora do repo>
   Logs: só contagens — nenhum volume. */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { falha, chave, cifra, decifra } from './vendas-lib.mjs';

const args = process.argv.slice(2), cmd = args[0];
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null; };
const ARQ = 'mercado/estimativas.enc.json';
const foraDoRepo = p => !resolve(p).startsWith(resolve('.')) || resolve(p).startsWith('/tmp');

if (cmd === 'abre') {
  const para = opt('para'); if (!para || !foraDoRepo(para)) falha('--para precisa apontar para fora do repositório.');
  if (!existsSync(ARQ)) falha('ainda não há estimativas publicadas.');
  mkdirSync(para, { recursive: true });
  writeFileSync(join(para, 'estimativas.json'), JSON.stringify(decifra(JSON.parse(readFileSync(ARQ, 'utf8')), chave()), null, 2));
  console.log('ok: aberto fora do repositório');
} else if (cmd === 'grava') {
  const js = opt('json'); if (!js || !foraDoRepo(js)) falha('--json precisa apontar para um arquivo fora do repositório.');
  const k = chave(), novo = JSON.parse(readFileSync(js, 'utf8'));
  if (!novo || typeof novo.postos !== 'object') falha('o arquivo precisa ter { postos: { cnpj: {...} } }.');
  for (const [cn, p] of Object.entries(novo.postos)) {
    if (!/^\d{14}$/.test(cn)) falha('CNPJ inválido na lista.');
    if (!(p.total > 0)) falha('posto sem total.');
    if (p.otto != null && p.diesel != null && Math.abs(p.otto + p.diesel - p.total) > 0.5) falha('otto + diesel diferente do total.');
    if (!/^\d{4}-\d{2}$/.test(p.ref || '')) falha('posto sem mês de referência (ref AAAA-MM).');
  }
  let atual = { v: 1, unidade: 'm3/mês', postos: {} };
  if (existsSync(ARQ) && !args.includes('--substitui')) atual = decifra(JSON.parse(readFileSync(ARQ, 'utf8')), k);
  Object.assign(atual.postos, novo.postos);
  atual.atualizado_em = new Date().toISOString().slice(0, 16);
  const doc = cifra(atual, k);
  if (JSON.stringify(decifra(doc, k)) !== JSON.stringify(atual)) falha('a conferência da cifra falhou.');
  writeFileSync(ARQ, JSON.stringify(doc) + '\n');
  console.log(`ok: ${Object.keys(atual.postos).length} postos com estimativa`);
} else falha('uso: grava --json <arquivo> | abre --para <pasta>');
