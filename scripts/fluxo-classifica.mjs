/* Classificador de lançamentos do Fluxo de Caixa.

   Recebe um lançamento já extraído do extrato ({data, desc, valor}) e o
   encaixa numa conta do plano (os rótulos exatos que a ferramenta usa, ver
   CONTAS abaixo), seguindo o passo 3 do doc de Configuração e as regras 5–7
   e 15 das Regras de Atualização. Marca giro (transferência entre contas
   próprias) e intercompany (entre empresas do grupo) para a etapa de
   montagem neutralizar. NÃO concilia nem monta semanas — isso é o passo
   seguinte; aqui só rotula, com um nível de confiança por lançamento.

   As regras são heurísticas de memo; o diário de negociação não se aplica
   aqui. Lançamento que cai num rótulo por palavra-chave específica vem com
   confia=true; o que cai num padrão genérico (PIX/TED diversos, Outras
   entradas/saídas, mercadorias) vem confia=false para revisão.

   Uso (teste): node scripts/fluxo-classifica.mjs <empresa> <arquivo-mov.json>
   onde mov.json = [{data,desc,valor}] e empresa ∈ ps|sf|as|siss|st|ss */
import { readFileSync } from 'fs';

/* empresas do grupo: id → fragmentos do nome que aparecem nos memos */
export const EMPRESAS = {
  ps: ['POSTO SAPATAO COMERCIO', 'POSTO SAPATAO COM LTDA', '43510250', '43.510.250'],
  sf: ['SF COMERCIO', 'SF CONSULTORIA', '13047383', '13.047.383', '43403222', '43.403.222'],
  as: ['AUTO POSTO SAFYR', 'SAFYR', '47857489', '47.857.489'],
  siss: ['SISS EMPREENDIMENTOS', 'SISS ', '91424135', '91.424.135'],
  st: ['SAPATAO TRANSPORTES', '36667966', '36.667.966'],
  ss: ['SAPATAO SERVICOS', 'SAPATAO SERVIÇOS', 'SAPATÃO SERVIÇOS'],
};
export const CONTAS = {
  CARTOES: '1 · Receita — Cartões e adquirência',
  COBRANCAS: '1 · Receita — Cobranças emitidas (clientes)',
  DINHEIRO: '1 · Receita — Dinheiro (coleta/depósito)',
  PIX_CLI: '1 · Receita — PIX/TED de clientes',
  REND: '4 · Receitas não operacionais (rendimentos)',
  RESGATE: '4 · Resgate de aplicações — XP (não operacional)',
  CAP_ROT: c => `Captação de financiamento (giro — contrato ${c})`,
  CAP_NAOOP: 'Captação de financiamento (não operacional)',
  OUTRAS_IN: 'Outras entradas',
  COMBUSTIVEL: '2 · Custos — Combustível',
  LUBRIF: '2 · Custos — Lubrificantes e automotivo',
  MERCADORIAS: '2 · Custos — Mercadorias e fornecedores (loja)',
  TRIBUTOS: '2.1 · Tributos sobre receitas e guias (ICMS, DARF, Simples)',
  SALARIOS: '3.1 · Pessoas — Salários e férias',
  BENEFICIOS: '3.1.6 · Pessoas — Benefícios',
  FOLHA_IMP: '3.1.8 · Pessoas — Impostos da folha (FGTS/GPS)',
  CARTAO_CORP: '3.2 · Cartão de crédito corporativo (fatura)',
  ALUGUEIS: '3.2 · Operacionais — Aluguéis, água e outros',
  ENERGIA: '3.2 · Operacionais — Energia elétrica',
  PIX_DIV: '3.2 · Operacionais — PIX/TED pagamentos diversos',
  PEDAGIO: '3.2 · Operacionais — Pedágio (frota)',
  NAOOP: '3.3 · Não operacionais (jurídico, Brinks, sindicatos)',
  MANUTENCAO: '3.4 · Manutenções',
  SISTEMAS: '3.5 · Sistemas, licenças e monitoramento',
  TERCEIROS: '3.6 · Serviços de terceiros',
  MARKETING: '3.7 · Marketing e comercial',
  FINANCEIRAS: '5 · Despesas financeiras (tarifas, juros)',
  AMORT_ROT: c => `Serviço da dívida — amortizações do giro rotativo ${c}`,
  CONSORCIO: 'Serviço da dívida — consórcio Sicredi',
  PARC_698: 'Serviço da dívida — parcela C698309290 (giro 48x)',
  PARCELAS: 'Serviço da dívida — parcelas de financiamentos',
  INVEST: '6 · Aplicações e investimentos',
  DISTRIB: 'Distribuição de lucros',
  OUTRAS_OUT: 'Outras saídas',
  GIRO: 'Entre empresas e financiamentos (líquido — fora do total)',
};
const norm = s => (s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const tem = (t, ...ks) => ks.some(k => t.includes(k));
export function empresaDoMemo(desc) {
  const t = norm(desc);
  for (const [id, frs] of Object.entries(EMPRESAS)) if (frs.some(f => t.includes(norm(f)))) return id;
  return null;
}

/* classifica um lançamento. ctx = { empresa, fornMap? } */
export function classifica(mov, ctx = {}) {
  const t = norm(mov.desc);
  const v = mov.valor;
  const outra = empresaDoMemo(mov.desc);
  const ehProprio = outra && outra === ctx.empresa;
  const ehGrupo = outra && outra !== ctx.empresa;
  const r = (conta, confia = true, flags = {}) => ({ ...mov, conta, confia, ...flags });

  /* contrato de giro rotativo citado no memo */
  const contrato = (t.match(/C\d{8,}/) || [])[0] || null;

  /* --- transferências próprias (giro), intercompany e transferência ao sócio --- */
  /* giro = entre contas DA PRÓPRIA empresa, ou aplicação/resgate automático */
  if ((ehProprio && /TRANSF|PIX|TED|APLICAC|RESGATE/.test(t)) || /APLICACAO AUTOMATICA|RESGATE AUTOMATICO|APLIC\.?\s*AUT/.test(t)) {
    return r(CONTAS.GIRO, true, { giro: true });
  }
  if (ehGrupo) {
    if (tem(t, 'ALUGUEL', 'FRETE', 'TRANSPORTE')) return v < 0 ? r(CONTAS.ALUGUEIS, true, { intercompany: true }) : r(CONTAS.PIX_CLI, true, { intercompany: true });
    return r(CONTAS.GIRO, true, { intercompany: true, giro: true });
  }
  /* "transf entre contas" para fora da empresa, sem ser grupo: CPF (11 díg.) =
     transferência ao sócio (distribuição, revisar); senão saída a classificar */
  if (/TRANSF ENTRE CONTAS|TRANSFERENCIA ENTRE CONTAS/.test(t)) {
    return /\b\d{11}\b/.test(t) ? r(CONTAS.DISTRIB, false) : r(CONTAS.OUTRAS_OUT, false);
  }

  /* --- captação e serviço da dívida (sempre visíveis) --- */
  if (tem(t, 'LIBERACAO CREDITO')) return r(contrato && /C59830287|C69830413/.test(contrato) ? CONTAS.CAP_ROT(contrato) : CONTAS.CAP_NAOOP, true, { captacao: true });
  if (tem(t, 'AMORTIZACAO CONTRATO', 'LIQUIDACAO DE PARCELA') && contrato && /C59830287|C69830413/.test(contrato)) return r(CONTAS.AMORT_ROT(contrato), true, { divida: true });
  if (tem(t, 'CONSORCIO')) return r(CONTAS.CONSORCIO, true, { divida: true });
  if (t.includes('C698309290')) return r(CONTAS.PARC_698, true, { divida: true });
  if (tem(t, 'AMORTIZACAO', 'LIQUIDACAO DE PARCELA', 'PRESTACAO', 'FINANCIAMENTO', 'PARCELA EMPREST')) return r(CONTAS.PARCELAS, true, { divida: true });

  if (v >= 0) {
    /* ENTRADAS */
    if (tem(t, 'RENTAB', 'REND PAGO', 'RENDIMENTO', 'REND APLIC')) return r(CONTAS.REND);
    if (tem(t, 'RESGATE', ' XP')) return r(CONTAS.RESGATE);
    if (tem(t, 'LIQ.COBRANCA', 'COBRANCA SIMPLES', 'COB0', 'LIQUIDACAO COBRANCA', 'LIQ COBRANCA')) return r(CONTAS.COBRANCAS);
    if (tem(t, 'RECEBIMENTO VENDAS', 'MAQUININHA', 'VERO', 'BANRICARD', 'ABASTECE AI', 'TICKET SERVICOS', 'VR BENE', 'PLUXEE', 'SIPAG', 'CIELO', 'GETNET', 'REDE ', 'VISA', 'MASTERCARD', 'MAESTRO', 'ELO ', 'CREDITO VERO', 'RECEBIMENTOS')) return r(CONTAS.CARTOES);
    if (tem(t, 'COFRE', 'DEPOSITO', 'COLETA', 'DINHEIRO', 'MOEDA', 'NUMERARIO')) return r(CONTAS.DINHEIRO);
    if (tem(t, 'PIX RECEBIDO', 'CRED PIX', 'RECEBIMENTO DE PIX', 'RECEBIMENTO PIX', 'TED RECEBIDA', 'CREDITO TED', 'DOC RECEBIDO')) return r(CONTAS.PIX_CLI);
    if (tem(t, 'CREDITO REGULARIZACAO', 'ESTORNO', 'DEVOLUCAO')) return r(CONTAS.COBRANCAS, false); /* devolução de cheque abate cobranças (regra d) */
    return r(CONTAS.OUTRAS_IN, false);
  }
  /* SAÍDAS */
  if (tem(t, 'FOLHA', 'SALARIO', 'RESCISAO', 'FERIAS', 'PAGTO FOLHA', 'DEB. FOLHA')) return r(CONTAS.SALARIOS);
  if (tem(t, 'FGTS', 'GPS', 'GRF', 'GRRF', 'INSS', 'GUIA FGTS')) return r(CONTAS.FOLHA_IMP);
  if (tem(t, 'DARF', 'ICMS', 'GNRE', 'SIMPLES', 'DAS ', 'GARE', 'GUIA ', 'ARRECADACAO', 'TRIBUTO', 'PIS/COFINS')) return r(CONTAS.TRIBUTOS);
  if (tem(t, 'RAIZEN POWER', 'COMERCIALIZADORA DE ENERGIA', 'RGE', 'CEEE', 'CEMIG', 'CELESC', 'ENERGIA ELETRICA', 'DIST DE ENERGIA')) return r(CONTAS.ENERGIA);
  if (tem(t, 'SEM PARAR', 'VIA FACIL', 'CONECTCAR', 'VELOE', 'PEDAGIO', 'C/ PEDAGIO')) return r(CONTAS.PEDAGIO);
  if (tem(t, 'ALUGUEL', 'CORSAN', 'AGUA', 'SANEAMENTO', 'IMOBILIARIA')) return r(CONTAS.ALUGUEIS);
  if (tem(t, 'RAIZEN', 'SHELL', 'IPIRANGA', 'VIBRA', 'PETROBRAS', 'BR DISTRIBUIDORA', 'CHARRUA', 'COMBUSTIVEL')) return r(CONTAS.COMBUSTIVEL);
  if (tem(t, 'LUBRIFIC', 'OLEO', 'AUTOMOTIVO', 'PNEU', 'LUBRAX')) return r(CONTAS.LUBRIF);
  if (tem(t, 'TARIFA', 'IOF', 'JUROS', 'CESTA', 'MANUTENCAO DE TITULOS', 'BAIXA DE TITULOS', 'COBR.TITULOS', 'ANUIDADE', 'SERV.COBR')) return r(CONTAS.FINANCEIRAS);
  if (tem(t, 'FATURA CARTAO', 'CARTAO CORPORATIVO', 'CARTAO DE CREDITO')) return r(CONTAS.CARTAO_CORP);
  if (tem(t, 'SOFTWARE', 'LICENCA', 'SISTEMA', 'MONITOR', 'ARGO SISTEMAS', 'NUVEM', 'HOSPEDAGEM', 'ASSINATURA')) return r(CONTAS.SISTEMAS);
  if (tem(t, 'MARKETING', 'PUBLICIDADE', 'AGENCIA', 'ANUNCIO', 'PROPAGANDA', 'ESTUDIO', 'G3', 'MIDIA')) return r(CONTAS.MARKETING);
  if (tem(t, 'ADVOCAC', 'JURIDIC', 'BRINKS', 'SINDICAT', 'CARTORIO')) return r(CONTAS.NAOOP);
  if (tem(t, 'CONTABIL', 'PERFECT CONTABILIDADE', 'CONSULTORIA', 'ASSESSORIA', 'HONORARIO')) return r(CONTAS.TERCEIROS);
  if (tem(t, 'MANUTENC', 'REPARO', 'CONSERTO', 'OTIMIZA PROJETOS', 'OBRA')) return r(CONTAS.MANUTENCAO);
  if (tem(t, 'UNIMED', 'PLANO DE SAUDE', 'ODONTO', 'FARMAC', 'VALE ', 'BENEFICIO')) return r(CONTAS.BENEFICIOS);
  if (ctx.fornMap && ctx.fornMap[chaveForn(mov.desc)]) return r(ctx.fornMap[chaveForn(mov.desc)], true);
  if (tem(t, 'LIQUIDACAO BOLETO', 'BOLETO', 'FORNECEDOR', 'SISPAG')) return r(CONTAS.MERCADORIAS, false);
  if (tem(t, 'PIX', 'TED', 'PAGAMENTO PIX', 'DEB PIX')) return r(CONTAS.PIX_DIV, false);
  return r(CONTAS.OUTRAS_OUT, false);
}
/* chave de fornecedor = CNPJ do memo, se houver (o forn_map é por CNPJ) */
export function chaveForn(desc) { const m = norm(desc).match(/\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/); return m ? m[0].replace(/\D/g, '') : null; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const empresa = process.argv[2], arq = process.argv[3];
  const movs = JSON.parse(readFileSync(arq, 'utf8'));
  let conf = 0; const tot = {};
  for (const m of movs) { const c = classifica(m, { empresa }); if (c.confia) conf++; tot[c.conta] = (tot[c.conta] || 0) + 1; console.log((c.confia ? '  ' : '? ') + String(m.valor).padStart(12) + ' ' + c.conta + (c.giro ? ' [giro]' : '') + (c.intercompany ? ' [intercompany]' : '') + '  « ' + m.desc.slice(0, 44)); }
  console.log(`\n${movs.length} lançamentos · ${conf} com confiança · ${movs.length - conf} para revisão`);
}
