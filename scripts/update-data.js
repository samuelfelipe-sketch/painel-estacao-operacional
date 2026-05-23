const https = require('https');
const fs    = require('fs');
const path  = require('path');

// Contexto operacional para enriquecer as ações do Claude
const contextPath = path.join(__dirname, '..', 'context.md');
const CONTEXT = fs.existsSync(contextPath) ? fs.readFileSync(contextPath, 'utf8') : '';

const DASHBOARD_USER = process.env.DASHBOARD_USER;
const DASHBOARD_PASS = process.env.DASHBOARD_PASS;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const BASE_DASHBOARD = 'dashboard.estacaosapatao.com.br';
const BASE_CLAUDE    = 'api.anthropic.com';

// Datas: dados sao D-1
const now       = new Date();
const yesterday = new Date(now);
yesterday.setDate(now.getDate() - 1);

const YEAR      = yesterday.getFullYear();
const MONTH     = String(yesterday.getMonth() + 1).padStart(2, '0');
const DIA_ATUAL = yesterday.getDate();
const DIAS_MES  = new Date(YEAR, yesterday.getMonth() + 1, 0).getDate();

const MESES = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const PERIODO_FMT = MESES[yesterday.getMonth()] + ' de ' + YEAR;

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const bodyBuf = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    if (bodyBuf) opts.headers['Content-Length'] = bodyBuf.length;
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(text)); }
        catch(e) { reject(new Error('JSON invalido [' + res.statusCode + ']: ' + text.substring(0,300))); }
      });
    });
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function login() {
  var body = 'username=' + encodeURIComponent(DASHBOARD_USER) + '&password=' + encodeURIComponent(DASHBOARD_PASS);
  var bodyBuf = Buffer.from(body, 'utf8');
  return new Promise(function(resolve, reject) {
    var opts = {
      hostname: BASE_DASHBOARD, path: '/api/auth/login', method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': bodyBuf.length
      }
    };
    var req = https.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var text = Buffer.concat(chunks).toString('utf8');
        try {
          var d = JSON.parse(text);
          if (d.access_token) resolve(d.access_token);
          else reject(new Error('Login falhou: ' + text));
        } catch(e) { reject(new Error('Login JSON invalido: ' + text)); }
      });
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

function dashboardGet(p, token) {
  return request({
    hostname: BASE_DASHBOARD, path: p, method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  });
}

function claudePost(body) {
  return request({
    hostname: BASE_CLAUDE, path: '/v1/messages', method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    }
  }, body);
}

// ─── Severidade por indicador ────────────────────────────────────────────────
// tipo 'pp'  = gap em pontos percentuais (meta% - realizado%)
// tipo 'pct' = gap relativo em % (projeção - realizado / projeção)
const SEVERITY_CONFIG = {
  'MIX V-POWER':         { tipo: 'pp',  verde: 1.5, amarelo: 4.0 },
  'ARLA':                { tipo: 'pct', verde: 8,   amarelo: 20  },
  'EXTRAS':              { tipo: 'pct', verde: 5,   amarelo: 15  },
  'FAT. LOJA':           { tipo: 'pct', verde: 5,   amarelo: 15  },
  'COMBO FARROUPILHA':   { tipo: 'pct', verde: 8,   amarelo: 20  },
  'COMBO PAO DE QUEIJO': { tipo: 'pct', verde: 8,   amarelo: 20  },
  'PA':                  { tipo: 'pct', verde: 8,   amarelo: 20  },
  'SHELLBOX %':          { tipo: 'pp',  verde: 2,   amarelo: 5   },
  'APP NOVOS':           { tipo: 'pct', verde: 10,  amarelo: 25  },
  'PIX':                 { tipo: 'pp',  verde: 3,   amarelo: 7   },
  'CICLO OTTO':          { tipo: 'pct', verde: 3,   amarelo: 10  },
};

function calcularSeveridade(acelerador, a) {
  var cfg = SEVERITY_CONFIG[normalize(acelerador)] || SEVERITY_CONFIG[acelerador];
  // tenta match normalizado
  if (!cfg) {
    for (var k of Object.keys(SEVERITY_CONFIG)) {
      if (normalize(k) === normalize(acelerador)) { cfg = SEVERITY_CONFIG[k]; break; }
    }
  }
  if (!cfg) return 'AMARELO';
  var gap;
  if (cfg.tipo === 'pp') {
    gap = (a.meta != null && a.realizado != null) ? (a.meta - a.realizado) : (1 - (a.pct_proj || 0.85)) * 100;
  } else {
    gap = a.pct_proj != null ? (1 - a.pct_proj) * 100 : 15;
  }
  if (gap <= 0)            return 'VERDE';
  if (gap <= cfg.verde)    return 'VERDE';
  if (gap <= cfg.amarelo)  return 'AMARELO';
  return 'VERMELHO';
}

// ─── Treinamento completo da IA ──────────────────────────────────────────────
const TREINAMENTO_IA = `
IDENTIDADE E TOM (inegociável):
Manifesto: "Somos mais do que um posto de combustível. Somos um local para parar, ficar e voltar."
Tom: energético, próximo, "a gente" e verbos de ação. NUNCA corporativo.
Script = benefício consultivo → pergunta gatilho → meta operacional.
Perguntas gatilho aprovadas: "já experimentou assim?" | "quer aproveitar hoje?" | "aproveita essa combinação?" | "faz esse upgrade hoje?" | "coloco?"

SCRIPTS E OBJEÇÕES POR INDICADOR:

MIX V-POWER (Frentista | ANTES do abastecimento — bico encaixado = perdido):
  script_base: "A V-Power limpa, protege e melhora o desempenho — quer aproveitar hoje? Com o app do Sapatão ainda ganha cashback maior nessa."
  script_recorrente: "Hoje tem cashback turbinado na V-Power pelo app — vale a pena nessa."
  script_viagem: "Vai pra estrada? A V-Power rende mais e protege o motor na viagem — coloco hoje?"
  objecao_caro: "A diferença você recupera no cashback do app — no fim sai quase igual e o motor ganha. Coloco?"
  objecao_nao_faz_diferenca: "Quem testa por 2-3 tanques sente. Hoje a gente tá com cashback bom — vale experimentar."
  acao_gerencial_amarelo: "Briefing pré-turno 3 min com script + 1 objeção. Observar quem converte mais no 1º turno."
  acao_gerencial_vermelho: "Alocar frentista de maior conversão histórica no pico 17h-19h. Revisar cavalete da pista."
  gap_formula: "gap_pp × volume_gasolina_dia ÷ ticket_médio_vpower ÷ turnos_restantes ÷ frentistas_turno = 1 V-Power a cada ~N abastecimentos"

ARLA (Frentista+Caixa | durante diesel — janela 2-4 min | B2B é prioridade p/ vermelho):
  script_base_b2c: "Enquanto está aqui, já aproveita e completa o tanquinho de Arla? Evita parada extra na semana."
  script_base_b2b: "Já completa o Arla? Posso ver se tem mais algum veículo da frota que precisa também."
  script_recorrente: "Tanquinho de Arla hoje também? Aproveita que já tá parado."
  script_viagem: "Vai viajar? Melhor sair com o Arla cheio — Arla na estrada não é fácil de achar."
  script_caixa: "Já completou o tanquinho de Arla na pista? Se quiser eu aviso o frentista antes de você sair."
  objecao_nao_acabou: "Tranquilo. Quer que eu confira o nível pra você? É rápido."
  objecao_nao_preciso: "Se for diesel novo (a partir de 2012), tem SCR — Arla é obrigatório. Posso conferir o nível?"
  acao_gerencial_amarelo: "Mapear horários de pico de diesel. Escalar frentista treinado nesses horários."
  acao_gerencial_vermelho: "Ativar carteira B2B: ligar para os 20 maiores clientes diesel com condição especial."
  gap_formula: "gap_litros ÷ dias_restantes ÷ frentistas_pista_diesel = ~N ARLAs por turno (1 a cada ~8 abastecimentos diesel)"

EXTRAS (Atendente | no pedido — antes de fechar no sistema):
  script_queijo: "Esse bife fica incrível com queijo derretido — já experimentou assim?"
  script_cebola: "Uma cebola caramelizada deixa o bife no outro nível — coloco?"
  script_combo_extras: "Aproveita essa combinação — queijo e cebola caramelizada juntos? Sai bem mais em conta no combinado."
  objecao_caro: "Entendo. O queijo costuma ser o que mais agrada — só ele já transforma o prato. Coloco só esse?"
  objecao_engordar: "Tranquilo — então uma cebola caramelizada que não pesa e dá um sabor incrível, coloco?"
  acao_gerencial_amarelo: "Identificar atendente com maior conversão de extras na semana. Usar como referência no briefing."
  acao_gerencial_vermelho: "Revisar cardápio visual — extras estão evidentes? Conferir mix: falta de queijo derruba conversão."
  gap_formula: "gap_absoluto ÷ dias_restantes ÷ atendentes_turno = 1 extra a cada ~N pedidos"

FAT. LOJA (Caixa | fechamento do atendimento — após produto principal):
  script_promocao: "Temos uma promoção de chocolate agora — aproveita pra complementar?"
  script_sem_promocao: "Tem um chocolate aqui que tá fazendo sucesso — aproveita?"
  script_viagem: "Uma bala ou chiclete pra viagem? Fica aqui no balcão."
  objecao_passagem: "Tranquilo — então uma bala pra viagem, fica fácil de levar."
  objecao_dieta: "Entendo. Tem aqui umas opções zero açúcar — quer dar uma olhada rápido?"
  acao_gerencial_amarelo: "Auditar visual do balcão — bomboniere no campo de visão direto no fechamento?"
  acao_gerencial_vermelho: "Revisar planograma. Testar mix temático por 2 semanas. Treinar caixa em combo (chocolate + bala)."
  gap_formula: "gap_R$ ÷ dias_restantes = R$/dia → ~N chocolates a mais por dia (ticket médio ~R$ 32)"

COMBO FARROUPILHA (Atendente | café manhã 6-10h e tarde 15-18h | NUNCA NO ALMOÇO):
  script_base: "O Farroupilha é pão com queijo e mortadela, já vem com o café — sai bem mais em conta no combo, quer aproveitar?"
  script_frio_chuva: "Dia frio combina com Farroupilha quentinho e café — quer aproveitar?"
  script_recorrente: "Hoje o Farroupilha tá fresquinho — vai no combo de novo?"
  objecao_nao_conhece: "É o clássico gaúcho — pão cacetinho com queijo e mortadela bolonha + café. Vale experimentar uma vez."
  objecao_so_cafe: "Tranquilo. Mas no combo o pão sai por bem pouco a mais — quer aproveitar?"
  acao_gerencial_amarelo: "Garantir cavalete do combo em manhã e tarde. Confirmar disponibilidade de mortadela bolonha."
  acao_gerencial_vermelho: "Banner externo se possível. Treinar atendentes em oferta ativa ANTES do cliente pedir."
  gap_formula: "gap_absoluto ÷ janelas_café_restantes ÷ atendentes_janela = 1 Farroupilha a cada ~N pedidos de café"

COMBO PAO DE QUEIJO (Atendente | café manhã 6-10h e tarde 15-18h | NUNCA NO ALMOÇO):
  script_base: "O pão de queijo saiu agora do forno — no combo com café sai bem mais em conta, quer aproveitar?"
  script_frio_chuva: "Dia frio pede pão de queijo quentinho — combo com café, faz?"
  script_recorrente: "Pão de queijo no combo de novo? Saiu fresco há pouco."
  objecao_ja_comi: "Tranquilo — guarda pra depois. No combo já sai por bem menos."
  objecao_so_cafe: "Show. Mas no combo com pão de queijo sai por pouco a mais — fresquinho."
  acao_gerencial_amarelo: "Confirmar frescor do pão durante o dia — fornadas regulares. Cavalete em manhã e tarde."
  acao_gerencial_vermelho: "Auditar processo de assamento — produto frio derruba venda. Comunicação visual reforçada."
  gap_formula: "gap_absoluto ÷ janelas_café_restantes ÷ atendentes_janela = 1 combo a cada ~N pedidos de café"

PA — Produtos Automotivos (Frentista: óleo+palhetas | Caixa: perfume automotivo):
  script_oleo: "Posso dar uma olhada no óleo enquanto abastece? É rapidinho."
  script_palhetas_chuva: "Vi que tá chovendo — as palhetas estão limpando bem? Tenho aqui no estoque."
  script_perfume_caixa: "Tem um perfume automotivo aqui que tá fazendo muito sucesso — quer dar uma olhada?"
  script_troca_oleo: "Sabia que a gente faz troca de óleo aqui? Se quiser, eu confiro pra você."
  objecao_ja_troquei: "Tranquilo. Posso só conferir o nível pra garantir? Em 30 segundos."
  objecao_mais_barato: "Entendo. Aqui a vantagem é não precisar parar de novo. Mas fica à vontade."
  acao_gerencial_amarelo: "Dias de chuva: foco total em palhetas. Auditar exposição de perfume no caixa."
  acao_gerencial_vermelho: "Treinar frentistas em verificação de óleo. Revisar mix exposto — produtos sem giro fora do lugar."
  gap_formula: "gap_absoluto ÷ dias_restantes ÷ conversores_ativos = 1 PA a cada ~N atendimentos"

SHELLBOX % (Frentista | ANTES do cliente pegar cartão — depois é tarde):
  script_base: "Você tem o app Shell? Quer usar o cashback aqui no abastecimento?"
  script_cliente_com_app: "Hoje vai pelo app de novo? Cashback liberado."
  script_vpower: "Pelo app o cashback na V-Power é maior — quer pagar por ali?"
  objecao_nao_tem: "Tranquilo. Quando quiser, baixa — o cashback compensa rápido."
  objecao_nao_confia: "É o app oficial da Shell — só desconto, sem cobrar nada."
  acao_gerencial_amarelo: "Briefing: barreira é uso ativo, não download. Verificar se terminal mostra quando cliente tem app."
  acao_gerencial_vermelho: "Comunicação visual de cashback nas bombas. Cruzar com APP NOVOS — base toda em risco."
  gap_formula: "gap_pp × abastecimentos_dia ÷ frentistas_turno = 1 Shell Box a cada ~N abastecimentos"

APP NOVOS (Caixa | qualquer atendimento | argumento central = cashback):
  script_base: "Com o app do Sapatão você ganha cashback em tudo que compra aqui — tem o aplicativo?"
  script_recorrente_sem_app: "Vejo que tu vem aqui com frequência — com o app já teria juntado um cashback bom. Quer baixar?"
  script_apos_compra_alta: "Essa compra hoje renderia um cashback bom no app — quer baixar agora? Em 30 segundos faz."
  objecao_muitos_apps: "Esse vale a pena — só pra acumular cashback aqui, não tem outras notificações chatas."
  objecao_nao_da_agora: "Tranquilo. Toma o cartãozinho aqui — quando puder baixa. Funciona pra próxima compra também."
  acao_gerencial_amarelo: "Cartãozinho de 'baixe e ganhe' no balcão. Briefing: argumento é cashback, não tecnologia."
  acao_gerencial_vermelho: "Prêmio simbólico para caixa de maior conversão na semana. Cruzar base de recorrentes sem app."
  gap_formula: "gap_absoluto ÷ dias_restantes ÷ caixas_ativos = 1 download a cada ~N atendimentos"

PIX (Frentista/Caixa | ANTES do cartão — depois é irreversível):
  script_base: "Vai pagar com PIX? Pode ser direto aqui."
  script_apos_cartao: "PIX também serve, se preferir — fica liberado direto."
  objecao_ja_com_cartao: "Tranquilo, pode ser no cartão. Mas o PIX é direto e sem taxa, se quiser pra próxima."
  objecao_nao_confia: "É só transferência direta — entra no caixa na hora."
  acao_gerencial_amarelo: "Briefing: oferta de PIX vem ANTES do cartão. QR code visível na bomba e no balcão."
  acao_gerencial_vermelho: "Medir taxa de oferta de PIX por turno (auditoria 1h). QR code físico em todos os pontos."
  gap_formula: "gap_pp × atendimentos_dia ÷ conversores_turno = 1 PIX a cada ~N atendimentos"

CICLO OTTO (Frentista | durante abastecimento | completar tanque é a alavanca principal):
  script_base: "Completo o tanque? Com o cashback do app a diferença é pequena e você sai com tanque cheio."
  script_servicos: "Posso calibrar os pneus enquanto abastece? É rápido e sem custo."
  script_viagem: "Vai pra estrada? Vale completar — encher tanque agora rende mais que parar de novo lá na frente."
  script_b2b: "O senhor tem frota? A gente tem condição especial em combustível pra empresa — posso pegar um contato?"
  objecao_so_50: "Tranquilo. Mas se quiser, completo — sai bem mais em conta por litro do que parar de novo."
  objecao_sem_tempo: "Show. Mas em 1 minuto a mais já tá cheio."
  acao_gerencial_amarelo: "Garantir serviços adicionais ativos no turno (calibrador, água). Foco: completar tanque."
  acao_gerencial_vermelho: "Comparar preço diário com concorrência. Auditar tempo de espera na pista — fluxo lento perde cliente."
  gap_formula: "gap_litros ÷ dias_restantes ÷ frentistas_turno = ~N litros/frentista/turno (~completar tanque em N abastecimentos a mais)"
`;

const GRUPO_MAP = {
  'FAT. LOJA':           'loja',
  'CLIENTES':            'loja',
  'TICKET MEDIO LOJA':   'loja',
  'REFEICOES':           'loja',
  'EXTRAS':              'loja',
  'ALAMINUTA':           'loja',
  'COMBO FARROUPILHA':   'loja',
  'COMBO PAO DE QUEIJO': 'loja',
  'CICLO OTTO':          'postos',
  'MIX V-POWER':         'postos',
  'CICLO DIESEL':        'postos',
  'ARLA':                'postos',
  'PA':                  'postos',
  'LAVAGEM - CUPONS':    'postos',
  'PIX':                 'postos',
  'SHELLBOX %':          'postos',
  'APP NOVOS':           'fidelidade',
};

function normalize(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function getGrupo(acelerador) {
  const norm = normalize(acelerador);
  for (const key of Object.keys(GRUPO_MAP)) {
    if (normalize(key) === norm) return GRUPO_MAP[key];
  }
  return 'postos';
}

function fmtVal(val, is_currency, is_pct) {
  if (val == null) return '-';
  if (is_pct)      return val.toFixed(1) + '%';
  if (is_currency) return 'R$ ' + Math.round(val).toLocaleString('en-US').replace(/,/g, '.');
  return Math.round(val).toLocaleString('en-US').replace(/,/g, '.');
}

async function gerarAcoes(aceleradores) {
  var abaixo = aceleradores.filter(function(a) {
    return a.pct_proj != null && a.pct_proj < 1.0;
  });
  if (!abaixo.length) return [];

  // Pré-calcular severidade para cada indicador abaixo da meta
  var linhas = abaixo.map(function(a) {
    var sev = calcularSeveridade(a.acelerador, a);
    var pct = Math.round(a.pct_proj * 100);
    var diasRestantes = DIAS_MES - DIA_ATUAL;

    var gapStr = '';
    if (!a.is_pct && a.projecao != null && a.meta != null) {
      var gap = a.meta - a.projecao;
      gapStr = ', faltam ' + fmtVal(gap, a.is_currency, false) + ' para a meta';
    } else if (a.is_pct && a.realizado != null && a.meta != null) {
      var gapPct = (a.meta - a.realizado).toFixed(1);
      gapStr = ', faltam ' + gapPct + ' p.p. para a meta';
    }

    var ritmoStr = '';
    if (a.media_dia != null && a.meta_dia != null) {
      var ritmo = Math.round((a.media_dia / a.meta_dia) * 100);
      var delta = Math.round(a.media_dia - a.meta_dia);
      var sinal = delta >= 0 ? '+' : '';
      ritmoStr = ', ritmo/dia: ' + ritmo + '% do necessário (' + sinal + fmtVal(delta, a.is_currency, false) + '/dia)';
    }

    return '- "' + a.acelerador + '" (' + a.grupo + ') [' + sev + ']: '
      + pct + '% da projeção' + gapStr + ritmoStr
      + ' | dias restantes: ' + diasRestantes;
  }).join('\n');

  var prompt = '## TREINAMENTO E SCRIPTS DA ESTAÇÃO SAPATÃO\n';
  prompt += TREINAMENTO_IA + '\n\n';
  if (CONTEXT) prompt += '## CONTEXTO OPERACIONAL DA REDE\n' + CONTEXT + '\n\n';
  prompt += '## SITUAÇÃO ATUAL — Dia ' + DIA_ATUAL + ' de ' + DIAS_MES + ' (' + MONTH + '/' + YEAR + ')\n';
  prompt += 'Indicadores abaixo da projeção (severidade já calculada):\n' + linhas + '\n\n';
  prompt += '## INSTRUÇÕES DE GERAÇÃO\n';
  prompt += 'Gere UMA ação por indicador listado acima.\n';
  prompt += 'Use os scripts do treinamento acima como base — adapte ao contexto do dia, nunca invente scripts fora do padrão.\n';
  prompt += 'O leitor é o GERENTE DE UNIDADE que vai repassar ao time (frentistas, atendentes, caixas).\n\n';
  prompt += 'REGRAS INEGOCIÁVEIS:\n';
  prompt += '1. "acao" = script principal — máx 25 palavras — benefício consultivo → pergunta gatilho.\n';
  prompt += '2. "meta_operacional" = gap traduzido na unidade do conversor (ex: "1 V-Power a cada ~12 abastecimentos por frentista").\n';
  prompt += '3. "script_alternativo" = versão para cliente recorrente/já abordado — máx 25 palavras.\n';
  prompt += '4. "objecao" = "Se ouvir \'<frase do cliente>\': <resposta consultiva>" — máx 20 palavras na resposta.\n';
  prompt += '5. "acao_gerencial" = o que o GERENTE faz, não o time — máx 15 palavras.\n';
  prompt += '6. "validacao" = micro-KPI para verificar amanhã — máx 10 palavras.\n';
  prompt += '7. "severidade" = use a severidade já calculada em colchetes acima.\n';
  prompt += '8. EXTRAS: queijo ou cebola no bife — não fritas. COMBOS: nunca no almoço.\n';
  prompt += '9. V-POWER: SEMPRE mencionar cashback do app. PA: revezar frentista (óleo) e caixa (perfume).\n';
  prompt += '10. Campo "acelerador" = EXATAMENTE o nome entre aspas — sem grupo ou sufixo. UMA entrada por indicador.\n\n';
  prompt += 'Responda SOMENTE com JSON válido, sem markdown:\n';
  prompt += '[{"acelerador":"NOME EXATO","severidade":"VERDE|AMARELO|VERMELHO","acao":"script principal","meta_operacional":"gap em unidade operacional","script_alternativo":"script para recorrente","objecao":"Se ouvir X: resposta","acao_gerencial":"acao do gerente","validacao":"kpi amanha"}]';

  var resp = await claudePost({
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });

  if (!resp.content || !resp.content[0]) {
    throw new Error('Resposta invalida do Claude: ' + JSON.stringify(resp).substring(0,200));
  }

  var text = resp.content[0].text.trim();
  var match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Claude nao retornou JSON: ' + text.substring(0,200));
  var acoes = JSON.parse(match[0]);

  // Garantia: trunca campo "acao" em 25 palavras preservando frase completa
  acoes = acoes.map(function(a) {
    var words = (a.acao || '').split(/\s+/);
    if (words.length <= 25) return a;
    var truncated = words.slice(0, 25).join(' ');
    var lastStop = Math.max(truncated.lastIndexOf('?'), truncated.lastIndexOf('.'), truncated.lastIndexOf('—'));
    if (lastStop > 20) truncated = truncated.substring(0, lastStop + 1).trim();
    a.acao = truncated;
    console.log('Truncado (' + words.length + '->' + a.acao.split(/\s+/).length + 'p): ' + a.acelerador);
    return a;
  });

  return acoes;
}

(async function() {
  try {
    console.log('Fazendo login no dashboard...');
    var token = await login();
    console.log('Login OK. Buscando dados da API...');

    var results = await Promise.all([
      dashboardGet('/api/dashboard/cards?ano=' + YEAR + '&meses=' + MONTH, token),
      dashboardGet('/api/dashboard/aceleradores?ano=' + YEAR + '&meses=' + MONTH, token),
      dashboardGet('/api/dashboard/top-produtos?ano=' + YEAR + '&meses=' + MONTH, token),
    ]);

    var cardsRaw = results[0];
    var acelRaw  = results[1];
    var prodRaw  = results[2];

    if (!Array.isArray(cardsRaw)) throw new Error('Token invalido. Cards: ' + JSON.stringify(cardsRaw));
    if (!Array.isArray(acelRaw))  throw new Error('Token invalido. Acel: '  + JSON.stringify(acelRaw));
    if (!Array.isArray(prodRaw))  throw new Error('Token invalido. Prod: '  + JSON.stringify(prodRaw));

    console.log('OK: ' + cardsRaw.length + ' cards, ' + acelRaw.length + ' aceleradores, ' + prodRaw.length + ' produtos');

    var dataPath = path.join(__dirname, '..', 'data.json');
    var current = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

    current.meta.periodo     = PERIODO_FMT;
    current.meta.dia_atual   = DIA_ATUAL;
    current.meta.dias_no_mes = DIAS_MES;
    current.meta.atualizado_em = now.toISOString().split('T')[0];

    current.cards = cardsRaw.map(function(c) {
      return {
        canal:       c.canal === 'PRODUTOS AUTOMOTIVOS' ? 'PROD. AUTO' : c.canal,
        is_qtd:      c.is_qtd,
        metrica:     c.metrica,
        projecao:    c.projecao,
        meta:        c.meta,
        pct_proj:    c.pct_proj,
        mix_vpower:  c.mix_vpower != null ? c.mix_vpower : null,
        dia_atual:   c.dia_atual,
        dias_no_mes: c.dias_no_mes,
      };
    });

    current.aceleradores = acelRaw.map(function(a) {
      return {
        grupo:       getGrupo(a.acelerador),
        acelerador:  a.acelerador,
        realizado:   a.realizado,
        meta:        a.meta != null ? a.meta : null,
        meta_dia:    a.meta_dia != null ? a.meta_dia : null,
        media_dia:   a.media_dia != null ? a.media_dia : null,
        projecao:    a.projecao != null ? a.projecao : null,
        pct_proj:    a.pct_proj != null ? a.pct_proj : null,
        is_currency: a.is_currency || false,
        is_pct:      a.is_percent || false,
      };
    });

    current.top_produtos = prodRaw.map(function(p, i) {
      return { rank: i + 1, produto: p.produto, qtd: p.qtd, faturamento: p.faturamento };
    });

    console.log('Gerando acoes com Claude...');
    var acoes = await gerarAcoes(current.aceleradores);
    current.acoes = acoes;
    console.log('OK: ' + acoes.length + ' acoes geradas');

    fs.writeFileSync(dataPath, JSON.stringify(current, null, 2) + '\n');
    console.log('data.json atualizado: ' + PERIODO_FMT + ' - Dia ' + DIA_ATUAL + '/' + DIAS_MES);

  } catch(err) {
    console.error('ERRO:', err.message);
    process.exit(1);
  }
})();
