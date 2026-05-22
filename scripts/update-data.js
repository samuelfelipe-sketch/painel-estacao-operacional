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
  const abaixo = aceleradores.filter(function(a) {
    return a.pct_proj != null && a.pct_proj < 1.0;
  });
  if (!abaixo.length) return [];

  const linhas = abaixo.map(function(a) {
    var pct = Math.round(a.pct_proj * 100);

    // Gap absoluto até a meta (usa projecao para itens com serie temporal, realizado para pct)
    var gapStr = '';
    if (!a.is_pct && a.projecao != null && a.meta != null) {
      var gap = a.meta - a.projecao;
      gapStr = ', faltam ' + fmtVal(gap, a.is_currency, false) + ' para bater a meta';
    } else if (a.is_pct && a.realizado != null && a.meta != null) {
      var gapPct = (a.meta - a.realizado).toFixed(1);
      gapStr = ', faltam ' + gapPct + ' p.p. para a meta';
    }

    // Ritmo diário: está acima ou abaixo do necessário?
    var ritmoStr = '';
    if (a.media_dia != null && a.meta_dia != null) {
      var ritmo = Math.round((a.media_dia / a.meta_dia) * 100);
      var delta = Math.round(a.media_dia - a.meta_dia);
      var sinal = delta >= 0 ? '+' : '';
      ritmoStr = ', ritmo/dia: ' + ritmo + '% do necessário (' + sinal + fmtVal(delta, a.is_currency, false) + '/dia)';
    }

    return '- "' + a.acelerador + '" (' + a.grupo + '): '
      + pct + '% da meta' + gapStr + ritmoStr;
  }).join('\n');

  var prompt = 'Você é o supervisor de operações da Estação Sapatão — posto de combustível + loja de conveniência no RS.\n\n';
  if (CONTEXT) prompt += '## CONTEXTO OPERACIONAL\n' + CONTEXT + '\n\n';
  prompt += '## SITUAÇÃO HOJE — Dia ' + DIA_ATUAL + ' de ' + DIAS_MES + ' (' + MONTH + '/' + YEAR + ')\n';
  prompt += 'Indicadores abaixo da meta:\n' + linhas + '\n\n';
  prompt += '## DESTINATÁRIO DAS AÇÕES\n';
  prompt += 'Você está escrevendo para os GERENTES DE UNIDADE (não para o time operacional diretamente).\n';
  prompt += 'O gerente vai ler a ação, entender o ponto crítico e repassar para o time de frentistas, atendentes e caixas.\n';
  prompt += 'Esse time tem linguagem simples — a ação precisa ser fácil de explicar e replicar.\n\n';
  prompt += '## FORMATO DA AÇÃO\n';
  prompt += '[Cargo]: "[benefício consultivo — como amigo recomendando] — [pergunta gatilho]?" — faltam [gap].\n\n';
  prompt += 'PADRÃO DO SCRIPT (3 partes):\n';
  prompt += '1. Benefício consultivo: descreve a experiência ou resultado de forma natural, não como pitch de vendas\n';
  prompt += '2. Pergunta gatilho: convida o cliente a se imaginar fazendo a escolha — não pede permissão nem fecha direto\n';
  prompt += '   BOM: "já experimentou assim?" / "faz esse upgrade hoje?" / "aproveita essa combinação?"\n';
  prompt += '   EVITAR: "posso colocar?" / "quer adicionar?" / "aproveita?" (muito direto ou muito passivo)\n\n';
  prompt += 'EXEMPLOS:\n';
  prompt += '- Atendente (EXTRAS): "Esse bife fica incrível com queijo derretido — já experimentou assim?" — faltam 128 extras.\n';
  prompt += '- Frentista (V-POWER): "A V-Power limpa, protege e melhora o desempenho — quer aproveitar hoje? Com o app do Sapatão ainda ganha cashback." — faltam 2,9 p.p.\n';
  prompt += '- Caixa (FAT. LOJA): "Temos uma promoção de chocolate agora — aproveita pra complementar?" — faltam R$ 11.859.\n\n';
  prompt += 'REGRAS:\n';
  prompt += '1. Máximo 25 palavras — UM script por ação, sem contexto extra\n';
  prompt += '2. Tom: consultivo e caloroso — como alguém de dentro da equipe indicando, nunca vendendo\n';
  prompt += '3. Só cargo, script e gap — sem horário, turno ou explicações adicionais\n';
  prompt += '4. EXTRAS: foco em queijo ou cebola no bife — não fritas nem polenta\n';
  prompt += '5. COMBOS: pergunta gatilho SEMPRE "quer aproveitar?" — nunca "vai querer?"\n';
  prompt += '6. V-POWER: SEMPRE mencionar cashback do app do Sapatão + terminar com "quer aproveitar hoje?"\n';
  prompt += '7. PA: revezar entre frentista abrindo capô (óleo) e caixa oferecendo perfume automotivo\n';
  prompt += '8. FAT. LOJA: caixa sugere promoção de chocolate para complementar a venda\n\n';
  prompt += 'CRÍTICO: O campo "acelerador" no JSON deve ser EXATAMENTE o nome entre aspas acima — sem grupo, colchetes ou sufixo.\n';
  prompt += 'CRÍTICO: UMA entrada por indicador — sem duplicatas.\n\n';
  prompt += 'Responda SOMENTE com JSON válido, sem markdown:\n';
  prompt += '[{"acelerador":"NOME EXATO","acao":"frase"}]';

  var resp = await claudePost({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });

  if (!resp.content || !resp.content[0]) {
    throw new Error('Resposta invalida do Claude: ' + JSON.stringify(resp).substring(0,200));
  }

  var text = resp.content[0].text.trim();
  var match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Claude nao retornou JSON: ' + text.substring(0,200));
  var acoes = JSON.parse(match[0]);

  // Garantia final: trunca em 25 palavras preservando frase completa
  acoes = acoes.map(function(a) {
    var words = a.acao.split(/\s+/);
    if (words.length <= 25) return a;
    // Tenta cortar em ponto final, travessão ou ponto de interrogação dentro das 25 palavras
    var truncated = words.slice(0, 25).join(' ');
    var lastStop = Math.max(truncated.lastIndexOf('?'), truncated.lastIndexOf('.'), truncated.lastIndexOf('—'));
    if (lastStop > 20) {
      truncated = truncated.substring(0, lastStop + 1).trim();
    }
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
