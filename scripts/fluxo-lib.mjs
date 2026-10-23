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
  'WEEKS', 'MES_WEEKS', 'PEND', 'REVISAO',
];
/* REVISAO[mes][empresa] = lançamentos classificados com baixa confiança na carga (card "Transações a revisar" + CSV) */
/* o que o shell fluxo/index.html e a tela "Dia a dia por empresa" consomem */
export const CONSTS_SHELL = ['DIA', 'DATA', 'SHORT', 'EMP_FULL', 'MES_LABEL', 'STATUS'];

/* contas encerradas (decisão do Samuel): 'empresa:banco' → primeiro mês (AAAA-MM) em que a conta
   NÃO é mais esperada. Sem extrato nesse mês em diante, a conta sai do painel (saldo zero) e não
   bloqueia a carga; se um extrato ainda vier, é lido normalmente. */
export const CONTAS_ENCERRADAS = { 'ps:unicred': '2026-10', 'sf:unicred': '2026-10' }; /* Unicred em encerramento — 22/10/2026 */
export const contaEncerrada = (empresa, banco, mes) => { const d = CONTAS_ENCERRADAS[`${empresa}:${banco}`]; return !!d && mes >= d; };

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

/* ---- mapa de fornecedores (fluxo-fornecedores.mjs) ---- */
export const chave14 = s => (s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '').slice(0, 14);
const PREFIXOS_MEMO = /^(LIQUIDACAO BOLETO( SICREDI)?|PAGAMENTO PIX|PAGAMENTO|DEBITO CONVENIOS|DEBITO TED\/IB|DEBITO ARRECADACAO|DEBITO TRANSFERENCIA PIX DEB PIX \/|CREDITO RECEBIMENTO DE PIX CRED PIX \/|RECEBIMENTO PIX|TED|DOC|PIX|\(SAIDA\)|TRANSFERENCIA \| PIX|PIX \| MAQUININHA|BOLETO|NOME:)\s*/;
const GENERICOS = new Set(['COMERCIO', 'COMERCIAL', 'COM', 'DISTRIBUIDORA', 'DISTR', 'DISTRIB', 'INDUSTRIA', 'IND', 'POSTO', 'AUTO', 'CENTRO', 'CASA', 'GRUPO', 'SUPERMERCADO', 'MERCADO', 'TRANSPORTES', 'TRANSPORTE', 'SERVICOS', 'CIA', 'BANCO', 'CAIXA', 'CONDOMINIO', 'ASSOCIACAO', 'ASSOCIA', 'SIND', 'SINDICATO', 'PREFEITURA', 'ESTADO', 'SECRETARIA', 'UNIAO', 'REDE', 'LOJA', 'LOJAS', 'PADARIA', 'RESTAURANTE', 'CLINICA', 'ESCRITORIO', 'OFICINA', 'MECANICA', 'FABRICA', 'ATACADO', 'ATACADAO', 'NOVO', 'NOVA', 'SAO', 'SANTA', 'SANTO', 'VALE', 'SUL', 'BRASIL', 'MUNICIPIO', 'LTDA', 'ME', 'EIRELI', 'SA', 'EPP']);
/* nome do fornecedor como aparece no memo: tira prefixos do banco, CNPJ/CPF, documentos e códigos */
export function nomeDoMemo(desc) {
  let t = (desc || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) t = t.replace(PREFIXOS_MEMO, '');
  t = t.replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, ' ').replace(/\b\d{11,14}\b/g, ' ');
  t = t.replace(/\b(?=[A-Z0-9_.-]{4,})[A-Z]*\d[A-Z0-9_.-]*\b/g, ' ');     /* tokens com dígitos e ≥4 caracteres: documentos, CX638265, COB000002 ("2F" fica) */
  t = t.replace(/\b(PIX_DEB|PIX_CRED|TRANSFERENCIA \| PIX|PIX \| MAQUININHA|PAGAMENTO|TRANSFERENCIA|\| PIX|\|)\b/g, ' ');
  return t.replace(/[^A-Z0-9&. ]/g, ' ').replace(/\s+/g, ' ').trim();
}
const tokens = s => s.split(/[^A-Z0-9]+/).filter(Boolean);
/* devolve { conta, chave, fonte } para o memo, ou null. Ordem: aprendidos →
   chave exata de 14 → prefixo único (memo truncado) → dois primeiros nomes
   iguais → primeiro nome (≥6 letras, não genérico) único no mapa. */
export function fornecedorDoMemo(desc, mapa) {
  if (!mapa || !desc) return null;
  const nome = nomeDoMemo(desc); if (!nome) return null;
  const pal = tokens(nome); if (!pal.length) return null;
  const idx = mapa.idx || {}, nomes = mapa.nomes || {}, apr = mapa.aprendidos || {};
  for (let i = 0; i < Math.min(pal.length, 3); i++) {
    const n = chave14(pal.slice(i).join(' ')); if (n.length < 4) continue;
    if (apr[n] && apr[n].conta) return { conta: apr[n].conta, chave: n, fonte: 'aprendido' };
    if (idx[n] && (n.length === 14 || chave14(nomes[n] || '') === n)) return { conta: idx[n], chave: n, fonte: 'argo' };
  }
  const n0 = chave14(nome);
  if (n0.length >= 6 && n0.length < 14) { const cand = Object.keys(idx).filter(k => k.startsWith(n0)); if (cand.length === 1) return { conta: idx[cand[0]], chave: cand[0], fonte: 'argo~prefixo' }; const ca = Object.keys(apr).filter(k => k.startsWith(n0)); if (ca.length === 1) return { conta: apr[ca[0]].conta, chave: ca[0], fonte: 'aprendido~prefixo' }; }
  /* por nomes (palavras) */
  if (!mapa._porNome) { mapa._porNome = {}; for (const k of Object.keys(nomes)) { const tk = tokens(chaveNome(nomes[k])); if (tk.length) (mapa._porNome[tk[0]] = mapa._porNome[tk[0]] || []).push({ k, tk }); } }
  const t0 = pal[0], t1 = pal[1];
  const lista = mapa._porNome[t0] || [];
  if (t1) { const dois = lista.filter(x => x.tk[1] === t1 || (x.tk[1] || '').startsWith(t1) && t1.length >= 5); if (dois.length === 1) return { conta: idx[dois[0].k], chave: dois[0].k, fonte: 'argo~nomes' }; }
  if (t0.length >= 6 && !GENERICOS.has(t0) && lista.length === 1) return { conta: idx[lista[0].k], chave: lista[0].k, fonte: 'argo~nome' };
  return null;
}
const chaveNome = s => (s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
