/* Funções comuns da esteira do Fluxo de Caixa (usadas por fluxo-estado,
   fluxo-embute e fluxo-valida).

   A ferramenta é um HTML autossuficiente com os DADOS embutidos como
   constantes JavaScript de nível superior (`const NOME = …;`). Este módulo
   sabe extrair essas constantes, avaliá-las como literais e embuti-las de
   volta sem tocar no restante do arquivo (CSS, HTML, código).

   Nada aqui imprime valores de negócio. */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { resolve } from 'path';

/* constantes de DADOS (literais puros, na ordem em que aparecem no HTML).
   MESES e PERIODOS ficam de fora: são derivadas por código a partir de DATA. */
export const DADOS = [
  'DATA', 'METAS', 'METAS_MESES', 'PREV', 'PROJ', 'ERP', 'VENDAS', 'PAINEL', 'COMPROMISSOS',
  'DIA', 'RECEBER', 'STATUS', 'EMP_ORDER', 'EMP_FULL', 'SHORT', 'PER_LABEL', 'MES_LABEL',
  'WEEKS', 'MES_WEEKS', 'PEND',
];
/* o que o shell fluxo/index.html e a tela "Dia a dia por empresa" consomem */
export const CONSTS_SHELL = ['DIA', 'DATA', 'SHORT', 'EMP_FULL', 'MES_LABEL', 'STATUS'];

export function falha(m) { console.error('ERRO: ' + m); process.exit(1); }

/* localiza `const NOME = …;\n` seguido da próxima declaração ou código
   (const/let/var/function/comentário/fim do script — padrão do RUNBOOK,
   que só previa `const`; no HTML atual MES_WEEKS é seguida de uma function
   e PEND de um `let`) */
export function achaConst(html, nome) {
  const decl = new RegExp('^[ \\t]*const\\s+' + nome + '\\s*=', 'mg');
  const ocorr = html.match(decl) || [];
  if (ocorr.length !== 1) throw new Error(`const ${nome}: esperava 1 declaração, achei ${ocorr.length}`);
  const re = new RegExp('(^[ \\t]*const\\s+' + nome + '\\s*=\\s*)([\\s\\S]*?);\\n(?=\\s*(?:const|let|var|function|async|class|\\/\\*|\\/\\/|<\\/script>))', 'm');
  const m = re.exec(html);
  if (!m) throw new Error(`const ${nome}: não achei o fim ";\\n" seguido de outra declaração`);
  const inicio = m.index + m[1].length;
  return { texto: m[2], inicio, fim: inicio + m[2].length };
}
export function avalia(texto, nome) {
  try { return Function('"use strict"; return (' + texto + ');')(); }
  catch (e) { throw new Error(`const ${nome}: não é um literal avaliável (${e.message})`); }
}
export function extraiTudo(html, nomes = DADOS) {
  const out = {};
  for (const n of nomes) out[n] = avalia(achaConst(html, n).texto, n);
  return out;
}
/* JSON compacto, seguro dentro de <script> */
export function serializa(v) { return JSON.stringify(v).replace(/<\//g, '<\\/'); }
export function canon(v) { return JSON.stringify(v); }

/* troca as constantes presentes em `dados` e confere a ida e volta */
export function embute(html, dados) {
  let novo = html;
  const nomes = DADOS.filter(n => Object.prototype.hasOwnProperty.call(dados, n));
  for (const n of nomes) {
    const { inicio, fim } = achaConst(novo, n);
    novo = novo.slice(0, inicio) + serializa(dados[n]) + novo.slice(fim);
  }
  const volta = extraiTudo(novo, nomes);
  for (const n of nomes) if (canon(volta[n]) !== canon(dados[n])) throw new Error(`const ${n}: ida e volta não bate`);
  /* o que não era dado continua idêntico */
  const antes = extraiTudo(html, DADOS.filter(n => !nomes.includes(n)));
  const depois = extraiTudo(novo, DADOS.filter(n => !nomes.includes(n)));
  for (const n of Object.keys(antes)) if (canon(antes[n]) !== canon(depois[n])) throw new Error(`const ${n} mudou sem querer`);
  return { html: novo, trocadas: nomes };
}

/* ---------- cofre (mesmo formato dos outros painéis) ---------- */
export function chave() {
  const b = (process.env.SAPATAO_DEK || '').trim();
  if (!b) falha('SAPATAO_DEK não está no ambiente — guarde a chave dos dados (valor de sapatao-dek-v1 de um aparelho autorizado) como segredo do ambiente.');
  let k; try { k = Buffer.from(b, 'base64'); } catch (e) { k = Buffer.alloc(0); }
  if (k.length !== 32) falha('SAPATAO_DEK não tem o formato esperado (base64 de 32 bytes).');
  return k;
}
export function cifra(obj, k) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final(), c.getAuthTag()]);
  return { enc: 1, iv: iv.toString('base64'), ct: ct.toString('base64') };
}
export function decifra(doc, k, oque = 'o arquivo') {
  if (!doc || doc.enc !== 1) falha(oque + ' não está no formato cifrado esperado.');
  const ct = Buffer.from(doc.ct, 'base64'), iv = Buffer.from(doc.iv, 'base64');
  const d = createDecipheriv('aes-256-gcm', k, iv);
  d.setAuthTag(ct.subarray(ct.length - 16));
  let pt;
  try { pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]); }
  catch (e) { falha('a chave dos dados não abre ' + oque + ' (chave trocada?).'); }
  return JSON.parse(pt.toString('utf8'));
}
/* pastas de trabalho ficam fora do repositório (ou em /tmp) */
export function foraDoRepo(p, rotulo) {
  if (resolve(p).startsWith(resolve('.')) && !resolve(p).startsWith('/tmp')) falha(rotulo + ' precisa apontar para fora do repositório (nada decifrado é commitado).');
}
export function opt(args, nome, padrao) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; }
export function temFlag(args, nome) { return args.includes('--' + nome); }
