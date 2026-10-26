/* Recupera os extratos lidos pelo conector Microsoft 365 nesta sessão e os
   grava como texto, um por empresa/banco, prontos para o fluxo-mes.

   Por quê: o conector devolve o conteúdo do arquivo dentro do resultado da
   ferramenta; reescrever 50–200 KB à mão num arquivo é lento e sujeito a erro.
   O transcript da sessão (~/.claude/projects/<projeto>/<sessão>.jsonl) guarda
   cada resultado — e, quando o resultado foi grande demais, guarda o caminho
   do arquivo em tool-results/ onde ele foi salvo. Este script lê os dois.

   Formatos: PDF (texto por banco), OFX salvo como .txt, XLSX da Stone, XLS do
   Sicredi (convertido pelo conector), TXT do Banrisul, TXT/CSV do Itaú e tabelas
   CSV/XLSX genéricas — o formato é reconhecido pelo CONTEÚDO (fluxo-extratos
   .detectaFormato), não pela extensão. Arquivos lidos em várias chamadas
   (rodapé "[truncated: pages 1–N of M — re-call with startPage=N+1]") são
   emendados na ordem das páginas. O nome do arquivo (da listagem da pasta que
   também fica no transcript) só ajuda quando o conteúdo não diz a empresa
   (TXT do Itaú: agência_conta no nome).

   Reconhece sozinho o banco e a empresa (titular no cabeçalho, CNPJ, número da
   conta — nunca pelos memos). Havendo mais de um arquivo do mesmo banco/empresa
   no mês, fica com os de melhor qualidade (OFX/XLSX > PDF > XLS/tabela > CSV
   sem saldo) e grava todos esses (banco.txt, banco.2.txt…) — o fluxo-mes emenda.

   Uso:
     node scripts/fluxo-leituras.mjs --para <pasta-fora-do-repo> [--mes AAAA-MM] [--transcript <arquivo.jsonl>]
   Saída: <pasta>/<empresa>/<banco>.txt (+ <pasta>/leituras.json com o manifesto)
   empresas: ps sf as siss st ss · bancos: sicredi stone unicred banrisul bradesco itau pagbank
   Logs sem números do caixa. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { falha, foraDoRepo, opt, contaEncerrada, contasBancarias } from './fluxo-lib.mjs';
import { PARSERS, ehOFX, ofx, detectaFormato, stoneXlsx, sicrediXls, sicrediXlsConta, stoneXlsxConta, itauCsv, tabela, ofxContas } from './fluxo-extratos.mjs';

const BANCOS = ['sicredi', 'stone', 'unicred', 'banrisul', 'bradesco', 'itau', 'pagbank'];
const N = s => (s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/* pistas no NOME do arquivo (só reserva: o conteúdo manda) */
const BANCO_NOME_ARQ = [['sicredi', /SICREDI/], ['stone', /STONE/], ['unicred', /UNICRED/], ['banrisul', /BANRISUL/], ['bradesco', /BRADESCO/], ['itau', /ITAU|(?<!\d)0912(?!\d)/], ['pagbank', /PAGBANK|PAGSEGURO/]];
/* texto que não é texto: .xls/.ofx binário copiado com extensão .txt (o conector devolve
   bytes como caracteres de controle/substituição) — não é extrato legível */
/* relatório do Argo (contas a pagar/receber, vendas, compras, DRE): a rotina lê esses arquivos na
   mesma sessão para a conferência do contas a pagar — nunca são extrato bancário */
export const ehRelatorioArgo = (t, nome) => /^\s*(cod_fornec;|Tipo Documento;Cliente;)/.test(t) || /Relatorio(De)?(ContasA|Vendas|Compra|Acompanhamento)|Demonstrativo|Contas a (pagar|receber)/i.test(nome || '');
export const ehBinario = t => { const a = t.slice(0, 4000); const ruins = (a.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g) || []).length; return a.length > 200 && ruins / a.length > 0.02; };
const EMP_NOME_ARQ = [['siss', /\bSISS\b/], ['st', /\bST\b|TRANSPORTES/], ['ss', /\bSS\b|SERVICOS/], ['as', /\bAS\b|SAFYR|COLONIAS/], ['sf', /\bSF\b|ESTANCIA/], ['ps', /\bPS\b|POSTO SAPATAO|ESTACAO/]];

export function detectaBanco(t, nomeArq) {
  const f = detectaFormato(t);
  if (f === 'ofx') { try { return ofx(t).banco; } catch (e) { return null; } }
  if (f === 'xlsx') return 'stone';
  if (f === 'xls') return 'sicredi';
  if (f === 'csv') return 'itau';
  if (f === 'tabela') { /* banco pelo nome do arquivo ou por menção no conteúdo */
    const U = N(nomeArq); for (const [b, re] of BANCO_NOME_ARQ) if (re.test(U)) return b;
    const C = N(t.slice(0, 4000));
    if (/ASSOCIADO:.{0,80}COOPERATIVA:/.test(C) || /COOPERATIVA DE CREDITO.*SICREDI|\bSICREDI\b/.test(C)) return 'sicredi'; /* planilha do Sicredi salva como .xlsx */
    /* planilha "Extrato_Lançamentos" do app do Itaú: "Agência: 0912", "SALDO TOTAL DISPONÍVEL DIA" */
    if (/AGENCIA:?\s*0912(?!\d)/.test(C) || /SALDO TOTAL DISPONIVEL DIA/.test(C) || /\bITAU\b/.test(C)) return 'itau';
    for (const [b, re] of BANCO_NOME_ARQ) if (b !== 'itau' && re.test(C)) return b;
    return null;
  }
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
/* empresa SÓ pelo titular/conta no cabeçalho do extrato (nunca pelos memos: um PIX
   recebido de outra empresa do grupo logo no 1º dia enganaria a detecção) */
export function detectaEmpresa(t, banco, nomeArq) {
  const f = detectaFormato(t);
  if (f === 'ofx') { try { return ofx(t).empresa; } catch (e) { return null; } }
  /* a empresa vem da CONTA no arquivo, não do sucesso do parse: um extrato ilegível
     ("####" no XLS) tem de ser citado com a empresa certa e o motivo real */
  if (f === 'xlsx') return stoneXlsxConta(t).empresa;
  if (f === 'xls') return sicrediXlsConta(t).empresa;
  if (f === 'csv' || f === 'tabela') {
    /* 1) conta no nome do arquivo (Itaú: Extrato_0912_123882_…); 2) empresa no nome;
       3) CNPJ/conta no conteúdo; 4) banco com uma única conta no grupo */
    const digs = (nomeArq || '').match(/\d{4,}/g) || [];
    for (const d of digs) { const c = ofxContas().find(([b, dd]) => (!banco || b === banco) && (d.endsWith(dd) || dd.endsWith(d)) && d.length >= 5); if (c) return c[2]; }
    const U = N(nomeArq); for (const [id, re] of EMP_NOME_ARQ) if (re.test(U)) return id;
    const C = N(t.slice(0, 3000)); const cnpj = C.match(/(0?\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/); if (cnpj) for (const [id, r] of EMP_NOME) if (r.test(cnpj[1])) return id;
    /* número da conta no conteúdo ("24425-1", "0604545302"…) → ofxContas() do banco */
    for (const m of t.matchAll(/\b(\d{4,10}-?\d)\b/g)) { const d = m[1].replace(/\D/g, ''); const c = ofxContas().find(([b, dd]) => (!banco || b === banco) && d.length >= 5 && d.endsWith(dd)); if (c) return c[2]; }
    const unicas = ofxContas().filter(([b]) => b === banco); if (banco && unicas.length && unicas.every(c => c[2] === unicas[0][2])) return unicas[0][2];
    return null;
  }
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
  /* Bradesco: nome/CNPJ só no rodapé ("CNPJ: <cnpj da empresa>"); senão, nº da conta */
  const cnpj = N(t).match(/CNPJ:?\s*(0?\d{2}\.\d{3}\.\d{3}\/\d{4}-?\d{2})/); if (cnpj) for (const [id, r] of EMP_NOME) if (r.test(cnpj[1].replace(/^0/, ''))) return id;
  const CONTA_BRADESCO = contasBancarias().bradesco; /* cifrado em fluxo/regras.enc.json */
  for (const [c, e] of Object.entries(CONTA_BRADESCO)) if (t.includes(c)) return e;
  return null;
}
export function transcriptMaisNovo() {
  const base = join(homedir(), '.claude', 'projects'); if (!existsSync(base)) return null;
  let melhor = null;
  for (const p of readdirSync(base)) { const d = join(base, p); if (!statSync(d).isDirectory()) continue; for (const f of readdirSync(d)) { if (!f.endsWith('.jsonl')) continue; const a = join(d, f); const m = statSync(a).mtimeMs; if (!melhor || m > melhor.m) melhor = { a, m }; } }
  return melhor && melhor.a;
}
const RODAPE = /\s*\[(?:truncated:[^\]]*|pages?\s+\d+[^\]]*|page\s+\d+[^\]]*)\]\s*$/;
/* emenda as partes de um mesmo arquivo lidas em chamadas sucessivas: a 1ª chamada
   pode ter sido cortada no meio de uma página (limite de tamanho) e a seguinte
   recomeça nessa página — a sobreposição é removida pelo prefixo comum */
function emendaPartes(partes) {
  partes.sort((a, b) => (a.pagina || 1) - (b.pagina || 1));
  let txt = '';
  for (const p of partes) {
    let t = p.texto.replace(RODAPE, '');
    if (txt) {
      const ultima = txt.slice(txt.lastIndexOf('\n') + 1);
      if (ultima.length >= 40 && t.startsWith(ultima.slice(0, 40))) txt = txt.slice(0, txt.lastIndexOf('\n') + 1); /* página repetida (cortada antes) */
      else if (ultima.length >= 40 && t.startsWith(ultima)) t = t.slice(ultima.length);
      txt = txt.replace(/\n?$/, '\n') + t;
    } else txt = t;
  }
  return txt;
}
export function leiturasDoTranscript(arq) {
  const usos = {}, res = {}, nomes = {};
  for (const linha of readFileSync(arq, 'utf8').split('\n')) {
    if (!linha) continue; let o; try { o = JSON.parse(linha); } catch (e) { continue; }
    const c = o && o.message && o.message.content; if (!Array.isArray(c)) continue;
    for (const x of c) {
      if (!x || typeof x !== 'object') continue;
      if (x.type === 'tool_use' && /read_resource$/.test(x.name || '') && x.input && x.input.uri) usos[x.id] = { uri: x.input.uri, pagina: +x.input.startPage || 1 };
      if (x.type === 'tool_result' && usos[x.tool_use_id]) {
        const cc = x.content; let txt = typeof cc === 'string' ? cc : (cc || []).map(y => (y && y.text) || '').join('\n');
        const salvo = txt.match(/Output has been saved to (\S+\.txt)/); if (salvo && existsSync(salvo[1])) txt = readFileSync(salvo[1], 'utf8');
        res[x.tool_use_id] = txt;
        /* listagem de pasta: "nome (file, N bytes) file:///drive/ITEM" → nome por item */
        for (const m of txt.matchAll(/^(.+?) \((?:file|folder), [^)]*\) (file:\/\/\/\S+)$/gm)) nomes[m[2]] = m[1];
      }
    }
  }
  const porUri = {};
  for (const id of Object.keys(usos)) {
    const u = usos[id]; const texto = res[id] || ''; if (texto.length < 200 || /^Error:/.test(texto.trim())) continue;
    const lista = porUri[u.uri] = porUri[u.uri] || [];
    /* a mesma página lida duas vezes (releitura) não pode virar duas cópias dos lançamentos: fica a última */
    const i = lista.findIndex(p => p.pagina === u.pagina); if (i >= 0) lista[i] = { pagina: u.pagina, texto }; else lista.push({ pagina: u.pagina, texto });
  }
  return Object.keys(porUri).map(uri => ({ uri, nome: nomes[uri] || uri.split('/').pop(), texto: emendaPartes(porUri[uri]), partes: porUri[uri].length }));
}
/* o arquivo cobre (parte d)o mês pedido? — um XLSX da Stone traz vários meses; o fluxo-mes recorta */
function cobreMes(o, mes) {
  const de = (o.periodo && o.periodo.de) || (o.mov[0] || {}).data || null, ate = (o.periodo && o.periodo.ate) || (o.mov[o.mov.length - 1] || {}).data || null;
  if (!de && !ate) return false;
  return (!de || de <= mes + '-31') && (!ate || ate >= mes + '-01');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const para = opt(args, 'para'); if (!para) falha('informe --para <pasta fora do repositório>.'); foraDoRepo(para, '--para');
  const mes = opt(args, 'mes'); const arq = opt(args, 'transcript') || transcriptMaisNovo(); if (!arq) falha('não achei o transcript da sessão — informe --transcript.');
  const leituras = leiturasDoTranscript(arq);
  const cand = {}; let ignorados = 0; const motivos = [];
  const ROTULO = f => (f === 'pdf' ? 'texto (pdf/txt)' : f);
  for (const l of leituras) {
    if (/^\S.* \((?:file|folder), [^)]*\) file:\/\/\//m.test(l.texto.slice(0, 2000))) continue; /* listagem de pasta */
    if (ehRelatorioArgo(l.texto, l.nome)) { ignorados++; continue; } /* relatório do Argo (conferência), não é extrato */
    if (ehBinario(l.texto)) { ignorados++; motivos.push(`${l.nome}: arquivo binário salvo como texto (.xls/.ofx copiado como .txt?) — ilegível; só OFX em texto, .xlsx, .xls, PDF, TXT ou CSV`); continue; }
    const formato = detectaFormato(l.texto);
    const banco = detectaBanco(l.texto, l.nome); const empresa = detectaEmpresa(l.texto, banco, l.nome);
    if (!banco || !empresa) { ignorados++; if (formato !== 'pdf' || /SALDO|EXTRATO/i.test(l.texto.slice(0, 3000))) motivos.push(`${l.nome}: ${ROTULO(formato)}, banco ${banco || '?'}, empresa ${empresa || '?'} — não reconhecido`); continue; }
    let o; try { o = PARSERS[banco](l.texto); } catch (e) { ignorados++; motivos.push(`${l.nome} (${empresa}/${banco}, ${ROTULO(formato)}): ${e.message}`); continue; }
    if (!o.mov.length && !o.semSaldo) { ignorados++; continue; }
    if (mes && !cobreMes(o, mes)) { ignorados++; motivos.push(`${l.nome} (${empresa}/${banco}, ${ROTULO(o.formato)}): cobre ${o.periodo.de || '?'}→${o.periodo.ate || '?'}, não ${mes} — arquivo antigo na pasta`); continue; }
    const k = empresa + '/' + banco;
    cand[k] = cand[k] || [];
    if (cand[k].some(c => c.texto === l.texto || (c.de === o.periodo.de && c.ate === o.periodo.ate && c.n === o.mov.length && c.formato === o.formato))) continue; /* mesmo extrato lido duas vezes */
    cand[k].push({ n: o.mov.length, texto: l.texto, nome: l.nome, partes: l.partes, ok: o.ok, de: o.periodo.de, ate: o.periodo.ate, formato: o.formato, qualidade: o.qualidade || 0, semSaldo: !!o.semSaldo, derivado: !!o.saldoFinalDerivado, ancoradoAte: o.ancoradoAte || null });
  }
  mkdirSync(resolve(para), { recursive: true });
  const manifesto = [];
  /* vários extratos do mesmo banco no mês (semanais, ou mês-até-hoje repetido): fica a
     melhor qualidade de fonte e grava todos (banco.txt, banco.2.txt…) — o fluxo-mes
     emenda e confere a cadeia de saldos */
  for (const k of Object.keys(cand).sort()) {
    const [e, b] = k.split('/'); mkdirSync(join(para, e), { recursive: true });
    let lista = cand[k].sort((x, y) => ((x.de || '') + (x.ate || '')).localeCompare((y.de || '') + (y.ate || '')));
    /* qualidade decide só entre arquivos do MESMO período: um CSV de 01–16 e um XLSX de 19–25 são
       partes diferentes e ficam os dois; um XLS de 01–18 ao lado de um OFX de 01–22 sai */
    lista = lista.filter(c => !lista.some(o => o !== c && o.qualidade > c.qualidade && o.de && o.ate && c.de && c.ate && o.de <= c.de && o.ate >= c.ate));
    /* exportação mais longa que CONTÉM outra (mesmo banco, mesma qualidade) substitui a contida —
       ex.: OFX 01/09→22/10 e OFX 01/10→22/10: fica o primeiro (o fluxo-mes recorta o mês) */
    lista = lista.filter(c => !lista.some(o => o !== c && o.de && o.ate && c.de && c.ate && o.de <= c.de && o.ate >= c.ate && o.n >= c.n && (o.de < c.de || o.ate > c.ate || o.n > c.n)));
    lista.forEach((c, i) => { writeFileSync(join(para, e, b + (i ? '.' + (i + 1) : '') + '.txt'), c.texto); manifesto.push({ empresa: e, banco: b, parte: i + 1, de: lista.length, periodo: `${c.de || '?'}→${c.ate || '?'}`, lancamentos: c.n, reconcilia: c.ok, formato: c.formato, semSaldo: c.semSaldo, saldoFinalDerivado: c.derivado, ancoradoAte: c.ancoradoAte, arquivo: c.nome, chamadas: c.partes }); });
  }
  writeFileSync(join(para, 'leituras.json'), JSON.stringify(manifesto, null, 1));
  console.log(`leituras: ${leituras.length} arquivo(s) lido(s) pelo conector no transcript · ${manifesto.length} extrato(s) gravado(s) em ${para}/ · ${ignorados} ignorado(s) (não é extrato de conta-corrente${mes ? ', ou não cobre o mês' : ''})`);
  for (const m of manifesto) console.log(`  ${m.empresa}/${m.banco}${m.de > 1 ? ` (parte ${m.parte}/${m.de})` : ''}: ${m.periodo} · ${m.lancamentos} lançamentos · ${ROTULO(m.formato)}${m.chamadas > 1 ? ` (${m.chamadas} chamadas emendadas)` : ''} · ${m.semSaldo ? 'SEM SALDO no arquivo (inicial virá do mês anterior)' : 'reconcilia ' + (m.reconcilia ? 'OK' : 'NÃO') + (m.saldoFinalDerivado ? ` (saldo final derivado; conferido até ${m.ancoradoAte || 'início'})` : '')} « ${m.arquivo}`);
  for (const m of motivos) console.log('  ignorado: ' + m);
  /* bancos esperados por empresa (RUNBOOK): avisa o que falta nesta leitura */
  const ESPERADOS = { ps: ['sicredi', 'stone', 'unicred', 'banrisul', 'bradesco'], sf: ['sicredi', 'stone', 'unicred', 'banrisul', 'bradesco'], as: ['sicredi', 'stone', 'banrisul', 'itau'], siss: ['sicredi', 'banrisul', 'bradesco'], st: ['sicredi'], ss: ['sicredi', 'pagbank'] };
  const faltam = [];
  for (const [e, bs] of Object.entries(ESPERADOS)) for (const b of bs) if (!manifesto.some(m => m.empresa === e && m.banco === b) && !(mes && contaEncerrada(e, b, mes))) faltam.push(`${e}/${b}`);
  if (faltam.length) console.log(`  faltam na pasta (nenhum arquivo reconhecido): ${faltam.join(', ')} — o fluxo-mes não carrega empresa com conta faltando`);
}
