/* Mapa de fornecedores do Fluxo de Caixa — CIFRADO em fluxo/fornecedores.enc.json.

   Origem: o forn_map.json do Argo (533 fornecedores → conta do DRE), que
   ficava na pasta Ferramenta do OneDrive. Aqui ele vira:
     { v:1, origem, atualizadoEm,
       idx:   { CHAVE14: 'rótulo do plano da ferramenta' },   // chave = 14 primeiros
       nomes: { CHAVE14: 'NOME COMPLETO NO ARGO' },           //   alfanuméricos do nome
       aprendidos: { CHAVE14: { conta, nome, em, por } } }    // decisões da esteira
   A CHAVE14 é o que cabe no memo do extrato ("PERFECT CONTABI" → PERFECTCONTABI).
   `aprendidos` prevalece sobre `idx`: é onde a Rotina registra fornecedores
   novos ou correções, para a decisão valer nos meses seguintes.

   Uso:
     node scripts/fluxo-fornecedores.mjs importa --de <forn_map.json>   (1ª carga, ou --forcar)
     node scripts/fluxo-fornecedores.mjs abre --para <pasta-fora-do-repo> → <pasta>/fornecedores.json
     node scripts/fluxo-fornecedores.mjs grava --de <pasta-fora-do-repo>   (regrava a partir do JSON editado)
     node scripts/fluxo-fornecedores.mjs aprende --nome "<nome como no memo>" --conta "<rótulo do plano>" [--por esteira]
   Logs sem nomes de fornecedores. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { falha, chave, cifra, decifra, canon, foraDoRepo, opt, temFlag, chave14, fornecedorDoMemo } from './fluxo-lib.mjs';
import { CONTAS } from './fluxo-classifica.mjs';

export const ARQ_FORN = 'fluxo/fornecedores.enc.json';
export function contaDoPlano(contaArgo, label) {
  const segs = contaArgo.split('/').map(s => s.trim());
  const L = (label || '').toUpperCase();
  const g = segs[1] || '', sub = (segs[2] || '').replace(/\s*-.*$/, '');
  if (/^0 - CO/.test(segs[0]) || /COMPRA/.test(segs[0])) {
    if (/COMBUSTIVEL/.test(segs[1] || segs[0])) return CONTAS.COMBUSTIVEL;
    if (/AUTOMOTIVO/.test(segs[1] || segs[0])) return CONTAS.LUBRIF;
    return CONTAS.MERCADORIAS;
  }
  if (/^5 - OU/.test(segs[0]) || /DISTRIBUI/.test(L)) return CONTAS.DISTRIB;
  if (/^1 - R/.test(g)) return CONTAS.TRIBUTOS; /* IPTU/ISSQN */
  if (/^2 - D/.test(g)) { if (sub.startsWith('2.1')) return CONTAS.TRIBUTOS; if (sub.startsWith('2.3') || /FRETE/.test(L)) return CONTAS.TERCEIROS; return CONTAS.MERCADORIAS; }
  if (/^3 - D/.test(g)) {
    if (sub.startsWith('3.1')) { if (sub.startsWith('3.1.8') || /FGTS|GPS|INSS|PREVID/.test(L)) return CONTAS.FOLHA_IMP; if (sub.startsWith('3.1.6') || /PLANO DE SA|VALE|CESTA|CONV[EÊ]NIO|SEGURO DE VIDA|PREMIA|UNIFORME|EPI/.test(L)) return CONTAS.BENEFICIOS; return CONTAS.SALARIOS; }
    if (sub.startsWith('3.2')) { if (/ENERGIA/.test(L)) return CONTAS.ENERGIA; if (/PEDAGIO|PEDÁGIO/.test(L)) return CONTAS.PEDAGIO; if (/MANUTEN|CONSERTO|PECAS|PEÇAS/.test(L)) return CONTAS.MANUTENCAO; if (/SISTEMA|RASTREADOR|LICEN/.test(L)) return CONTAS.SISTEMAS; return CONTAS.ALUGUEIS; }
    if (sub.startsWith('3.3')) return CONTAS.NAOOP;
    if (sub.startsWith('3.4')) return CONTAS.MANUTENCAO;
    if (sub.startsWith('3.5')) return CONTAS.SISTEMAS;
    if (sub.startsWith('3.6')) return CONTAS.TERCEIROS;
    if (sub.startsWith('3.7')) return CONTAS.MARKETING;
  }
  if (/^5 - D/.test(g)) return CONTAS.FINANCEIRAS;
  if (/^6 - I/.test(g) || /^6 - INVEST/.test(g)) return CONTAS.INVEST_PARC;
  return null;
}
export function converteArgo(fm) {
  const idx = {}, nomes = {}, semMapa = [];
  for (const [nome, v] of Object.entries(fm.MAP || {})) {
    const k = chave14(nome); if (!k) continue;
    const c = contaDoPlano(v.conta || '', v.label || '');
    if (!c) { semMapa.push(k); continue; }
    idx[k] = c; nomes[k] = nome;
  }
  return { idx, nomes, semMapa };
}
export function carregaMapa(arq = ARQ_FORN) {
  const p = resolve(arq); if (!existsSync(p)) return null;
  return decifra(JSON.parse(readFileSync(p, 'utf8')), chave(), 'o mapa de fornecedores');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2); const modo = args[0]; const ARQ = resolve(opt(args, 'arquivo', ARQ_FORN));
  const grava = m => { const k = chave(); const doc = cifra(m, k); if (canon(decifra(doc, k)) !== canon(m)) falha('ida e volta falhou'); writeFileSync(ARQ, JSON.stringify(doc)); };
  const resumo = m => `${Object.keys(m.idx).length} fornecedores do Argo · ${Object.keys(m.aprendidos || {}).length} aprendidos · atualizado em ${m.atualizadoEm}`;
  if (modo === 'importa') {
    const de = opt(args, 'de'); if (!de) falha('informe --de <forn_map.json>.');
    if (existsSync(ARQ) && !temFlag(args, 'forcar')) falha(ARQ + ' já existe — use --forcar para substituir (os aprendidos são preservados).');
    const t = readFileSync(de, 'utf8'); const fm = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    const { idx, nomes, semMapa } = converteArgo(fm);
    const antes = existsSync(ARQ) ? carregaMapa(ARQ) : null;
    const m = { v: 1, origem: 'forn_map.json do Argo', atualizadoEm: new Date().toISOString().slice(0, 16), idx, nomes, aprendidos: (antes && antes.aprendidos) || {} };
    grava(m); console.log(`importado: ${resumo(m)} · ${semMapa.length} sem conta no plano (ficam para as regras de memo)`);
  } else if (modo === 'abre') {
    const para = opt(args, 'para'); if (!para) falha('informe --para <pasta fora do repositório>.'); foraDoRepo(para, '--para');
    const m = carregaMapa(ARQ); if (!m) falha('não existe ' + ARQ);
    mkdirSync(para, { recursive: true }); writeFileSync(join(para, 'fornecedores.json'), JSON.stringify(m, null, 1));
    console.log(`aberto: ${join(para, 'fornecedores.json')} · ${resumo(m)}`);
  } else if (modo === 'grava') {
    const de = opt(args, 'de'); if (!de) falha('informe --de <pasta>.'); foraDoRepo(de, '--de');
    const m = JSON.parse(readFileSync(join(de, 'fornecedores.json'), 'utf8'));
    if (!m.idx || !m.nomes) falha('fornecedores.json sem idx/nomes.');
    m.atualizadoEm = new Date().toISOString().slice(0, 16); grava(m); console.log(`gravado: ${resumo(m)}`);
  } else if (modo === 'aprende') {
    const nome = opt(args, 'nome'), conta = opt(args, 'conta'); if (!nome || !conta) falha('informe --nome e --conta.');
    if (!Object.values(CONTAS).includes(conta) && !/^Captação|^Serviço da dívida|^6 · /.test(conta)) falha('conta fora do plano da ferramenta.');
    const m = carregaMapa(ARQ) || { v: 1, origem: 'esteira', idx: {}, nomes: {}, aprendidos: {} };
    m.aprendidos = m.aprendidos || {}; m.aprendidos[chave14(nome)] = { conta, nome, em: new Date().toISOString().slice(0, 10), por: opt(args, 'por', 'esteira') };
    m.atualizadoEm = new Date().toISOString().slice(0, 16); grava(m); console.log(`aprendido: 1 fornecedor · ${resumo(m)}`);
  } else falha('modo desconhecido — use importa, abre, grava ou aprende.');
}
