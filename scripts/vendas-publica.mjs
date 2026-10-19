/* Publicação automática dos dados do painel Vendas (Metas e Margens).

   Faz o mesmo que o cartão "Vendas" das Configurações faz no navegador do
   admin, só que num script, para a Rotina diária do Claude Code:
   JSON em claro (montado por scripts/vendas-monta.mjs) → AES-256-GCM com a
   chave dos dados → {enc:1, iv, ct} em operacional-conteudo.json. O formato é
   o mesmo que painel-operacional.html abre (window.sapataoCofre).

   A chave dos dados vem SÓ da variável de ambiente SAPATAO_DEK (base64 de
   32 bytes — a mesma de localStorage `sapatao-dek-v1`). Nunca passa por
   argumento, nunca é impressa, nunca vai para arquivo.

   Uso:
     node scripts/vendas-publica.mjs publica --json <fora-do-repo>/dados.json [--saida operacional-conteudo.json]
     node scripts/vendas-publica.mjs abre --para <pasta-fora-do-repo> [--entrada operacional-conteudo.json]
       → grava <pasta>/vendas-anterior.json (a versão publicada decifrada — estado do dia anterior)

   Os logs dizem só datas, contagens e "ok"; nenhum valor do painel. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { resolve, join } from 'path';

const args = process.argv.slice(2);
const modo = args[0];
function opt(nome, padrao) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; }
function falha(m) { console.error('ERRO: ' + m); process.exit(1); }

function chave() {
  const b = (process.env.SAPATAO_DEK || '').trim();
  if (!b) falha('SAPATAO_DEK não está no ambiente — guarde a chave dos dados (valor de sapatao-dek-v1 de um aparelho autorizado) como segredo do ambiente.');
  let k; try { k = Buffer.from(b, 'base64'); } catch (e) { k = Buffer.alloc(0); }
  if (k.length !== 32) falha('SAPATAO_DEK não tem o formato esperado (base64 de 32 bytes).');
  return k;
}
function cifra(obj, k) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final(), c.getAuthTag()]);
  return { enc: 1, iv: iv.toString('base64'), ct: ct.toString('base64') };
}
function decifra(doc, k) {
  if (!doc || doc.enc !== 1) falha('o arquivo publicado não está no formato cifrado esperado.');
  const ct = Buffer.from(doc.ct, 'base64'), iv = Buffer.from(doc.iv, 'base64');
  const d = createDecipheriv('aes-256-gcm', k, iv);
  d.setAuthTag(ct.subarray(ct.length - 16));
  let pt;
  try { pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]); }
  catch (e) { falha('a chave dos dados não abre o arquivo publicado (chave trocada?).'); }
  return JSON.parse(pt.toString('utf8'));
}
function resumo(d) { return `${d.meta.mes_rotulo} · corte ${d.meta.data} · ${d.linhas.length} linhas` + (d.decomp ? ' · com decomposição' : '') + (Array.isArray(d.unidades) ? ` · ${d.unidades.length} unidades` : ''); }

if (modo === 'publica') {
  const jsonPath = opt('json'); if (!jsonPath) falha('informe --json <arquivo>.');
  const saida = resolve(opt('saida', 'operacional-conteudo.json'));
  let dados; try { dados = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch (e) { falha('o arquivo não é um JSON válido.'); }
  if (!dados || !dados.meta || !dados.fat || !Array.isArray(dados.linhas) || !dados.linhas.length) falha('esse JSON não parece ser o do painel (faltam meta/linhas/fat).');
  for (const c of ['mes_ref', 'ant_ref', 'ano_ref', 'data', 'dias_dec', 'dias_mes']) if (dados.meta[c] === undefined) falha('meta sem ' + c + '.');
  if (!dados.fat.FTOT || !isFinite(dados.fat.FTOT.recA)) falha('fat.FTOT.recA ausente.');
  const k = chave();
  const doc = cifra(dados, k);
  /* conferência de ida e volta antes de gravar */
  if (JSON.stringify(decifra(doc, k)) !== JSON.stringify(dados)) falha('a conferência de ida e volta falhou — nada gravado.');
  writeFileSync(saida, JSON.stringify(doc));
  console.log(`publicado: ${saida} · ${resumo(dados)} · cifrado ${(JSON.stringify(doc).length / 1024).toFixed(0)} KB`);
} else if (modo === 'abre') {
  const para = opt('para'); if (!para) falha('informe --para <pasta fora do repositório>.');
  const entrada = resolve(opt('entrada', 'operacional-conteudo.json'));
  if (resolve(para).startsWith(resolve('.')) && !resolve(para).startsWith('/tmp')) falha('--para precisa apontar para fora do repositório (o JSON decifrado nunca é commitado).');
  if (!existsSync(entrada)) falha('não existe ' + entrada + ' — os dados ainda não foram publicados.');
  const k = chave();
  const d = decifra(JSON.parse(readFileSync(entrada, 'utf8')), k);
  mkdirSync(para, { recursive: true });
  const alvo = join(para, 'vendas-anterior.json');
  writeFileSync(alvo, JSON.stringify(d));
  console.log(`aberto: ${alvo} · ${resumo(d)} · gerado no Argo em ${d.meta.gerado || '?'}`);
} else {
  falha('modo desconhecido — use "publica" ou "abre".');
}
