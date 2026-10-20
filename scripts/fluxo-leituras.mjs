/* Recupera os extratos lidos pelo conector Microsoft 365 nesta sessão e os
   grava como texto, um por empresa/banco, prontos para o fluxo-mes.

   Por quê: o conector devolve o texto do PDF dentro do resultado da
   ferramenta; reescrever 50–80 KB à mão num arquivo é lento e sujeito a erro.
   O transcript da sessão (~/.claude/projects/<projeto>/<sessão>.jsonl) guarda
   cada resultado — e, quando o resultado foi grande demais, guarda o caminho
   do arquivo em tool-results/ onde ele foi salvo. Este script lê os dois.

   Reconhece sozinho o banco (assinatura do extrato) e a empresa (CNPJ/nome no
   cabeçalho); quando há dois extratos do mesmo banco/empresa (ex.: Sicredi
   conta-corrente e "Sicredi - Rotativo"), fica com o que tem lançamentos de
   conta-corrente e mais movimentos.

   Uso:
     node scripts/fluxo-leituras.mjs --para <pasta-fora-do-repo> [--mes AAAA-MM] [--transcript <arquivo.jsonl>]
   Saída: <pasta>/<empresa>/<banco>.txt (+ <pasta>/leituras.json com o manifesto)
   empresas: ps sf as siss st ss · bancos: sicredi stone unicred banrisul bradesco itau pagbank
   Logs sem números do caixa. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { falha, foraDoRepo, opt } from './fluxo-lib.mjs';
import { PARSERS } from './fluxo-extratos.mjs';

export function detectaBanco(t) {
  if (/Stone Institui[çc][ãa]o de Pagamento/i.test(t)) return 'stone';
  if (/B\s*A\s*N\s*R\s*I\s*S\s*U\s*L/.test(t) && /MOVIMENTOS DA CONTA CORRENTE/i.test(t)) return 'banrisul';
  if (/SALDO TOTAL DISPON[IÍ]VEL DIA/i.test(t) || /Ag[êe]ncia\s+0912\s+Conta/i.test(t)) return 'itau';
  if (/PagSeguro|PagBank/i.test(t) && /Saldo do dia/i.test(t)) return 'pagbank';
  if (/CENTRAL DE RELACIONAMENTO/i.test(t) && /Coop:\s*\d+\s*-\s*AG:/i.test(t)) return 'unicred';
  if (/Extrato Mensal|SMC\.WS|Extrato de:\s*Ag:/i.test(t)) return 'bradesco';
  if (/Cooperativa:/i.test(t) && /Extrato\s*\(Per[ií]odo de/i.test(t) && /SALDO ANTERIOR/i.test(t)) return 'sicredi';
  return null;
}
const EMP_NOME = [['ss', /SAPATAO SERVICOS|62\.?681\.?375/], ['st', /SAPATAO TRANSPORTES|36\.?667\.?966/], ['as', /SAFYR|4 COLONIAS|47\.?857\.?489/], ['siss', /SISS EMPREEND|TRES AMIGOS|0?91\.?424\.?135/], ['sf', /SF COM|SAPATAO ESTANCIA|13\.?047\.?383/], ['ps', /POSTO SAPATAO|ESTACAO SAPATAO|43\.?510\.?250/]];
const N = s => (s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/* empresa SÓ pelo titular no cabeçalho do extrato (nunca pelos memos: um PIX
   recebido de outra empresa do grupo logo no 1º dia enganaria a detecção) */
export function detectaEmpresa(t) {
  const U = N(t.slice(0, 2500));
  const cab = [
    /ASSOCIADO:\s*([^\n]{3,60}?)\s+COOPERATIVA/,                 /* Sicredi */
    /DADOS DA CONTA\s+NOME\s+(.{3,60}?)\s+DOCUMENTO\s+([\d. \/-]+)/, /* Stone: nome + CNPJ */
    /NOME\.*:\s*([^\n]{3,60}?)\s+(?:-{3,}|IDENTIFICACAO|DIA\s+HISTORICO)/, /* Banrisul */
    /CNPJ\s+(.{3,70}?)\s+(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\s+SALDO TOTAL/, /* Itaú */
    /EXTRATO\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\s+(.{3,60}?)\s+-\s+\*\*/, /* Unicred */
    /PERIODO:\s*\d{2}\/\d{2}\/\d{4}\s+A\s+\d{2}\/\d{2}\/\d{4}\s+(.{3,60}?)\s+CNPJ:\s*([\d.\/-]+)/, /* PagBank */
  ];
  for (const re of cab) { const m = U.match(re); if (m) { const alvo = m.slice(1).join(' '); for (const [id, r] of EMP_NOME) if (r.test(alvo)) return id; } }
  /* Bradesco: nome/CNPJ só no rodapé → "CNPJ: 43.510.250/0001-84"; senão, nº da conta */
  const cnpj = N(t).match(/CNPJ:?\s*(0?\d{2}\.\d{3}\.\d{3}\/\d{4}-?\d{2})/); if (cnpj) for (const [id, r] of EMP_NOME) if (r.test(cnpj[1].replace(/^0/, ''))) return id;
  const CONTA_BRADESCO = { '0048012-6': 'ps', '0027405-4': 'sf', '0004997-2': 'siss' };
  for (const [c, e] of Object.entries(CONTA_BRADESCO)) if (t.includes(c)) return e;
  return null;
}
function transcriptMaisNovo() {
  const base = join(homedir(), '.claude', 'projects'); if (!existsSync(base)) return null;
  let melhor = null;
  for (const p of readdirSync(base)) { const d = join(base, p); if (!statSync(d).isDirectory()) continue; for (const f of readdirSync(d)) { if (!f.endsWith('.jsonl')) continue; const a = join(d, f); const m = statSync(a).mtimeMs; if (!melhor || m > melhor.m) melhor = { a, m }; } }
  return melhor && melhor.a;
}
export function leiturasDoTranscript(arq) {
  const usos = {}, res = {};
  for (const linha of readFileSync(arq, 'utf8').split('\n')) {
    if (!linha) continue; let o; try { o = JSON.parse(linha); } catch (e) { continue; }
    const c = o && o.message && o.message.content; if (!Array.isArray(c)) continue;
    for (const x of c) {
      if (!x || typeof x !== 'object') continue;
      if (x.type === 'tool_use' && /read_resource$/.test(x.name || '') && x.input && x.input.uri) usos[x.id] = x.input.uri;
      if (x.type === 'tool_result' && usos[x.tool_use_id]) {
        const cc = x.content; let txt = typeof cc === 'string' ? cc : (cc || []).map(y => (y && y.text) || '').join('\n');
        const salvo = txt.match(/Output has been saved to (\S+\.txt)/); if (salvo && existsSync(salvo[1])) txt = readFileSync(salvo[1], 'utf8');
        res[x.tool_use_id] = txt;
      }
    }
  }
  return Object.keys(usos).map(id => ({ uri: usos[id], texto: res[id] || '' })).filter(x => x.texto.length > 200);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const para = opt(args, 'para'); if (!para) falha('informe --para <pasta fora do repositório>.'); foraDoRepo(para, '--para');
  const mes = opt(args, 'mes'); const arq = opt(args, 'transcript') || transcriptMaisNovo(); if (!arq) falha('não achei o transcript da sessão — informe --transcript.');
  const leituras = leiturasDoTranscript(arq);
  const cand = {}; let ignorados = 0;
  for (const l of leituras) {
    const banco = detectaBanco(l.texto), empresa = detectaEmpresa(l.texto);
    if (!banco || !empresa) { ignorados++; continue; }
    let o; try { o = PARSERS[banco](l.texto); } catch (e) { ignorados++; continue; }
    if (!o.mov.length) { ignorados++; continue; }
    const meses = {}; for (const m of o.mov) meses[m.data.slice(0, 7)] = (meses[m.data.slice(0, 7)] || 0) + 1;
    const mesPrinc = Object.keys(meses).sort((a, b) => meses[b] - meses[a])[0];
    if (mes && mesPrinc !== mes) { ignorados++; continue; }
    const k = empresa + '/' + banco;
    cand[k] = cand[k] || [];
    if (cand[k].some(c => c.texto === l.texto || (c.de === o.periodo.de && c.ate === o.periodo.ate && c.n === o.mov.length))) continue; /* mesmo extrato lido duas vezes */
    cand[k].push({ n: o.mov.length, texto: l.texto, uri: l.uri, ok: o.ok, mes: mesPrinc, de: o.periodo.de, ate: o.periodo.ate });
  }
  mkdirSync(resolve(para), { recursive: true });
  const manifesto = [];
  /* vários extratos do mesmo banco no mês (semanais, ou mês-até-hoje repetido): grava
     todos (banco.txt, banco.2.txt…) — o fluxo-mes emenda e confere a cadeia de saldos */
  for (const k of Object.keys(cand).sort()) {
    const [e, b] = k.split('/'); mkdirSync(join(para, e), { recursive: true });
    const lista = cand[k].sort((x, y) => (x.de + x.ate).localeCompare(y.de + y.ate));
    lista.forEach((c, i) => { writeFileSync(join(para, e, b + (i ? '.' + (i + 1) : '') + '.txt'), c.texto); manifesto.push({ empresa: e, banco: b, parte: i + 1, de: lista.length, mes: c.mes, periodo: `${c.de}→${c.ate}`, lancamentos: c.n, reconcilia: c.ok, item: c.uri.split('/').pop() }); });
  }
  writeFileSync(join(para, 'leituras.json'), JSON.stringify(manifesto, null, 1));
  console.log(`leituras: ${leituras.length} resultado(s) do conector no transcript · ${manifesto.length} extrato(s) gravado(s) em ${para}/ · ${ignorados} ignorado(s) (não é extrato de conta-corrente${mes ? ', ou de outro mês' : ''})`);
  for (const m of manifesto) console.log(`  ${m.empresa}/${m.banco}${m.de > 1 ? ` (parte ${m.parte}/${m.de})` : ''}: ${m.mes} · ${m.periodo} · ${m.lancamentos} lançamentos · reconcilia ${m.reconcilia ? 'OK' : 'NÃO'}`);
}
