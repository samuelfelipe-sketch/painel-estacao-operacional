# Market Share — procedimento de atualização

Painel `mercado/index.html` (login unificado, permissão `mercado` = le|nao; admin
sempre entra). Compara as **compras de combustível do Sapatão** com as **vendas das
distribuidoras aos postos** publicadas pela ANP, por bandeira (Raízen, Ipiranga),
por produto (Otto, Diesel, consolidado), por recorte (RS, Sul, Brasil) e por
segmento (posto revendedor, só bandeirados, todos os segmentos).

## Arquivos

| Arquivo | Conteúdo | Sensível? | Quem grava |
|---|---|---|---|
| `mercado/anp-vendas.json` | mercado agregado por recorte × mês × segmento × produto × distribuidora (mil m³), desde 2020-01 | não (dado público da ANP) | workflow `mercado-anp.yml` |
| `mercado/sapatao.enc.json` | compras do Sapatão por mês × bandeira × produto (m³) — **CIFRADO** com a chave dos dados | **sim** | `scripts/mercado-sapatao.mjs` |
| `mercado/regiao-raio.json` | por unidade: CNPJ, coordenada (link do Google Maps), raio/trecho/corredor e a **lista de concorrentes escolhida pelo Samuel** (`concorrentes`) + `descartados` | não (dado público) | à mão, quando o Samuel reclassifica |
| `mercado/expansao.enc.json` | postos em avaliação para entrar na rede (CNPJ, apelido, área por raio ou a área de uma unidade nossa) — **CIFRADO**; a lista de alvos é estratégica e nunca aparece em claro, nem em commit ou log | **sim** | `scripts/mercado-expansao.mjs grava --json <arquivo fora do repo>` |
| `mercado/estimativas.enc.json` | volume de concorrentes informado pela diretoria (m³/mês, por CNPJ, mês de referência) — **CIFRADO** | **sim** | `scripts/mercado-estimativas.mjs grava --json <arquivo fora do repo>` |
| `mercado/postos-raio.json` | concorrentes da lista com bandeira/distância/situação no cadastro da ANP, `a_revisar` (posto novo na área ainda não classificado), `corredor_candidatos` (AS) e histórico | não (dado público) | workflow `mercado-postos.yml` (segunda) |
| `mercado/postos.json` | postos revendedores por bandeira e recorte, por mês de referência | não (API de Revendedores da ANP via relatório Posto Seguro) | à mão, a cada relatório recebido |

## 1. Mercado (automático)

`.github/workflows/mercado-anp.yml` roda **todo dia ~03:45 BRT** e sempre
que o próprio workflow ou `scripts/mercado-anp.mjs` mudam. Baixa `liquidos.zip`
dos dados abertos da ANP (o ambiente da nuvem do Claude Code **não alcança o
gov.br**, por isso o GitHub faz o download), lê só os `Liquidos_Vendas_*.csv`
(o histórico 2007–2017 vem sem cabeçalho e fica fora), agrega e, se mudou,
commita `chore: atualiza a base ANP do Market Share (automático)` no branch em
que rodou.

Regras do agregador (`scripts/mercado-anp.mjs`):
- produtos: Gasolina C, Etanol Hidratado, Diesel B (óleo combustível e demais
  ficam fora); `otto = gasolina + etanol`;
- segmentos da ANP → `rev` (posto bandeirado + bandeira branca), `band`, `bb`, `tot`;
- recortes: RS (UF Destino), SUL (RS+SC+PR), BR;
- distribuidoras: as 12 maiores do recorte nomeadas, o resto em "Outras";
  `RAIZEN*` (inclui Raízen Mime) = Raízen; `IPIRANGA*` = Ipiranga; Vibra inclui a
  antiga Petrobras Distribuidora;
- **mês parcial**: a ANP lista o mês assim que a primeira distribuidora declara;
  o mês fica `parcial` quando o total Brasil está abaixo de 70% da mediana dos 3
  meses anteriores ou tem menos de 60% das declarantes do mês anterior. A ANP
  fecha o mês M na segunda quinzena de M+1.
- conferências antes de gravar: distribuidoras somam o total; otto = gasolina +
  etanol; bandeirado + bandeira branca = revendedor; RS ⊂ SUL ⊂ BR.

Para rodar à mão: GitHub → Actions → "Market Share — base ANP" → Run workflow
(`inspecionar` só descreve os arquivos; `desde` muda o primeiro mês da série).

## 2. Sapatão (tarefa agendada do Claude Code, todo dia ~03:40 BRT)

Fonte: `DD-MM-AAAA_RelatorioDeCompraDeCombustiveis.csv` na pasta
`Financeiro/Compras/Painel de Negociação` do OneDrive do Samuel (mesma fonte da
revisão semanal da Negociação). Cada CSV cobre **30 dias até o dia anterior** ao
da data do nome (o de `01-MM` NÃO cobre o dia 1º de um mês anterior de 31 dias).

**O Argo corrige o passado** (conferência de 04/11/2026: nota de 20/10 lançada só
em 04/11, notas que mudam de dia entre 31/10 e 01/11). Por isso o mês anterior é
**refeito todo dia** com a versão mais nova de cada data, até sair da janela de 30 dias.

### Rotina diária

1. `git pull --rebase origin main`. Abrir o arquivo publicado para saber o estado:
   `node scripts/mercado-sapatao.mjs abre --para /tmp/ms` → `/tmp/ms/sapatao-mercado.json`
   (meses gravados e quais estão `parcial`). Nada dele vai para o chat.
2. Listar a pasta pelo conector Microsoft 365 e ler **dois** CSVs: o **mais recente**
   (o de hoje, se já chegou; senão o de ontem) e o do **último dia do mês anterior**
   (ex.: em novembro, `31-10-AAAA`; em dezembro, `30-11-AAAA`), que cobre o começo do
   mês anterior. Gravar cada um, sem alterar, em `/tmp/ms/compras-DD-MM-AAAA.csv`
   (fora do repositório; o nome com a data é obrigatório). O conector devolve o texto
   com acentos trocados por `�` — não importa, os scripts só usam as colunas numéricas.
3. Compor (cada data vem do arquivo mais novo que a cobre), agregar e cifrar:
   ```
   node scripts/compras-compoe.mjs --csv /tmp/ms/compras-<último dia do mês anterior>.csv --csv /tmp/ms/compras-<mais recente>.csv \
     --mes <AAAA-MM do mês anterior> --saida /tmp/ms/composto.csv      # imprime periodo=INI:FIM
   node scripts/negociacao-compras.mjs --csv /tmp/ms/composto.csv --saida /tmp/ms/compras.json
   node scripts/mercado-sapatao.mjs grava --compras /tmp/ms/compras.json --desde <AAAA-MM do mês anterior> --periodo INI:FIM --forca
   ```
   Com `--periodo` o mês anterior sai `fechado` e o corrente `parcial`; `--forca` troca
   os dois pela leitura nova (é o que pega as correções do Argo). Se o `compras-compoe`
   reclamar de dia fora da janela (arquivo do último dia não achado), **não usar
   `--forca`**: rodar só com o CSV mais recente e `grava --desde <AAAA-MM do mês corrente>`
   (atualiza o mês em curso e mantém o anterior como está) e dizer isso na resposta.
   Mantém unidades (SF, PS, AS) e carteiras do GV.
4. Se `git status` mostrar `mercado/sapatao.enc.json` alterado: `git pull --rebase`,
   commit **só desse arquivo** com `chore: atualiza os volumes do Sapatão no Market Share (automático)`
   e push em `main`. Sem mudança, não commitar.
5. Falhas: sem CSV novo há mais de 2 dias, CSV ilegível, script reprovado ou chave
   ausente → não publicar nada e encerrar a sessão com uma linha dizendo o motivo
   (sem números). Nunca escrever volumes, preços ou nomes em log, commit ou chat.

**Histórico e fechamento pelo PDF do Argo:** o "Relatório de Compra de Combustíveis"
em PDF (Tipo Completo, qualquer período, todas as unidades) é a fonte mais completa.
Carregado em 24/10/2026 o período 01/01/2025 → 30/09/2026 (jul–set/26 trocados pela
versão do PDF). Em 27/11/2026 entrou o PDF de 01/01/2020 a 31/12/2024 (SF desde 2020, PS desde 25/02/2022,
AS só em 2026), 60 meses novos sem alterar nenhum de 2025 em diante; `compras-pdf.mjs` passou a ler também item
com descrição comprida encostada na coluna das notas (ex.: GNV). Passos, tudo fora do repositório:
```
pdftotext -layout relatorio.pdf /tmp/ms/rel.txt
node scripts/compras-pdf.mjs --txt /tmp/ms/rel.txt --saida /tmp/ms/compras-pdf.csv
node scripts/negociacao-compras.mjs --csv /tmp/ms/compras-pdf.csv --saida /tmp/ms/compras.json
node scripts/mercado-sapatao.mjs grava --compras /tmp/ms/compras.json --periodo AAAA-MM-DD:AAAA-MM-DD
```
O `compras-pdf` confere cada "Total:" do dia, cada "Total Unidade de Negócio" e o
"Total Geral" (reprovou, não grava). `--periodo` = o período impresso no cabeçalho do
PDF (assim um mês cuja 1ª compra caiu no dia 2 não fica `parcial`).
**Atenção — lançamento tardio:** na conferência de 24/10/2026, notas lançadas no Argo
depois da janela de 30 dias não apareceram em nenhum CSV diário (jul e ago/26 ficaram
menores que no PDF). Mês fechado só pelos CSVs diários pode ficar incompleto; o PDF do
mês fechado corrige. Alternativa: `--manual meses.json` com os litros por mês ×
bandeira × produto (GC, GA, ET, S10, S500 ou otto/diesel).

**Carteira do Gerente de Vendas (GV):** `--carteiras 'Raízen=GV:0.5:RS,Ipiranga=GV:0.5:RS'`
grava, no mesmo arquivo cifrado, a fatia da bandeira no recorte que fica na carteira do GV
(fração 0–1; vazia = a definir). O painel mostra participação na bandeira ÷ fração como
"≈ x% da carteira do GV", só no recorte da carteira. Usar só o cargo, nunca o nome da pessoa.
Frações informadas pelo Samuel (23/10/2026: 50% nas duas bandeiras, RS).

Chave dos dados: segredo `SAPATAO_DEK` do ambiente (valor de `sapatao-dek-v1`),
nunca em chat, arquivo ou log. Logs só com meses e contagens.

## 3. Postos por bandeira (à mão)

A cada "Comparativo das Bandeiras" da Posto Seguro recebido, acrescentar em
`mercado/postos.json` o mês de referência com `Total`, `Raízen`, `Ipiranga` (e
as demais que valerem) nas páginas RS — Revendedor, Sul — Revendedor e Brasil —
Revendedor. O painel usa o último mês ≤ ao mês selecionado.

## 4. Como o painel calcula

Painel refeito em 15/11/2026 na visão **TAM · SAM · SOM** (decisões do Samuel). Tudo em
`mercado/mercado.js`, calculado no navegador; recorte fixo no RS (Sul/Brasil e o seletor de
segmento saíram).

- **TAM** = vendas das distribuidoras aos postos revendedores do RS (`rev`), mês a mês.
- **SAM** = área de cada unidade: nossas compras + volume estimado de cada concorrente da
  lista (`mercado/postos-raio.json`, escolhida pelo Samuel em `mercado/regiao-raio.json`:
  SF 5, PS 19, AS 9). Concorrente = média por posto da bandeira no RS no mês (segmento
  `band` da distribuidora ÷ postos da bandeira em `rs_bandeiras`; bandeira branca = `bb` ÷
  postos de bandeira branca; sem dado = `rev` ÷ `rs_postos`) × tamanho do posto (bicos do
  posto ÷ bicos médios da bandeira, Otto e Diesel separados; bicos da API de Revendedores
  da ANP, lidos pelo `mercado-postos.mjs`). Posto com volume informado
  (`mercado/estimativas.enc.json`, cifrado) usa fator = informado ÷ régua no mês `ref`.
  Conferida nas nossas unidades, a régua erra perto de 10% no total por posto.
- **SOM** = nossas compras ÷ SAM. Sem meta definida (o Samuel avalia o painel antes).
- **Prévia** (regra de 16/11/2026, substitui a de 15/11): mês sem ANP = o MESMO MÊS DO ANO
  PASSADO × o crescimento médio dos últimos 12 meses fechados (soma dos 12 ÷ soma dos mesmos 12
  um ano antes), por segmento e grupo de produto (`tendencia()` e `mktP` no `mercado.js`, até 6
  meses à frente; mínimo de 3 meses comparáveis). Não parte mais do último mês fechado, que
  sozinho pode ser atípico. A repartição entre distribuidoras segue o último mês fechado. Por
  isso a base da ANP começa em 2020-01 desde 27/11/2026 (antes 2024-01; `--desde` do `mercado-anp.mjs`). No teste contra os meses
  já publicados a regra nova errou menos que a antiga. Mês em curso = compras até o dia coberto
  × dias do mês ÷ dias cobertos. Tudo o que é prévia leva o selo PRÉVIA e some quando a ANP
  publica. O mês padrão ao abrir é o último com compras fechadas (publicado ou prévia).
- **Período = total do período** (pedido do Samuel, 16/11/2026): em Trimestre, Semestre e Ano os
  cartões (TAM, SAM, SOM), a tabela de unidades e o ranking da área mostram a SOMA do período,
  não a média por mês (`uniVol()`/`noPer()` no `mercado.js`; o `calc()` segue devolvendo médias).
  Unidade nova soma só os meses em que já comprava. A aba Expansão continua em m³ por mês, porque
  volume de posto e projeção são ritmo mensal.
- **Litros por bico por mês** (18/11/2026, aba Unidades): nossas compras ÷ bicos da unidade no
  cadastro da ANP (`infra` do `postos-raio.json`), no produto do filtro (Otto = bicos de
  gasolina/etanol; Diesel = bicos de diesel; consolidado = todos), em mil litros. Referência =
  mercado dos postos do RS ÷ bicos de todos os postos do RS (`rs_infra`), na nota da tabela e no
  "vs RS" de cada unidade. Sempre média por mês, mesmo em trimestre/semestre/ano (é ritmo). A
  linha Rede pondera pelos meses em que cada unidade comprou. No celular aparece abaixo do nome
  da unidade. Funções `lbicoUn`, `lbicoRS`, `bicosRS`.
- **Botão "?" da Expansão** (18/11/2026): ao lado da linha "Rampa"; ao passar o mouse, focar ou
  tocar mostra o racional de cada conta (hoje, padrão, projeção, teto, rede, na área, SOM com ele,
  município). Texto gerado em `ajudaExp()` com a rampa e as referências do cifrado; se mudar uma
  regra de cálculo da aba, atualize esse texto junto.
  Cada ficha tem também o seu "?" (`ajudaPosto()`), com a conta DAQUELE posto e os números dele
  (bicos × padrão, teto, marcos da rampa, posição na área, SOM, município); segue o filtro de produto
  e período.
- **Base mensal da ANP por tarefa agendada** (27/11/2026): o gov.br recusa com frequência as conexões do GitHub
  (curl 35), então a tarefa agendada "Market Share — base ANP (vendas mensais) diária" (~04:12 BRT, ambiente Default
  com `www.gov.br` em `allowed_hosts`) baixa o `liquidos.zip` daqui, roda `mercado-anp.mjs --desde 2020-01` e só commita
  se mudou. O workflow `mercado-anp.yml` segue como reserva (agora não falha quando o gov.br não responde). Se a tarefa
  disser que o host está bloqueado, conferir `allowed_hosts` do ambiente (Edit do ambiente na barra de título).
- **Venda diária da ANP** (23/11/2026, `mercado/anp-diario.json`, público): vendas diárias de gasolina C + etanol
  (otto) e diesel S10 + S500 no RS, do painel dinâmico de preços da ANP ("Volume de Vendas RS"), em m³ por dia,
  desde 2020-01. Gerado por `node scripts/mercado-anp-diario.mjs --csv <CombustiveisVolumeVendas.csv>`. Serve ao mês
  que a ANP ainda não fechou: o TAM sai do total diário × calibração (razão entre o fechamento mensal de
  revendedores e a soma diária, média dos 12 últimos meses fechados; erro medido contra meses fechados ≈ 1%) e a
  repartição por distribuidora vem do último mês fechado; no mês em curso os dias que faltam entram pela média do
  mesmo dia da semana nas últimas 4 semanas (`diaMes`, `calibDiario`, `fatorDiario` no `mercado.js`). Sem esse arquivo
  vale a prévia antiga (mesmo mês do ano passado × tendência de 12 meses). Atualização: o CSV precisa ser baixado do
  Fonte real: Receita Dados da Sefaz-RS ("volume de combustíveis adquiridos pelos postos do RS", por isso bate com o
  segmento revendedores da ANP), `https://receitadados.sefaz.rs.gov.br/Arquivos/CombustiveisVolumeVendas.csv`. O workflow
  `mercado-diario.yml` baixa todo dia ~06:30 BRT e só commita quando o arquivo muda; se o site não responder, mantém o
  anterior com um aviso (sem falhar). Mesma página tem `CombustiveisVariacaoPMPF*.csv` (preço médio por município).
- **Mês a mês com todos os anos** (16/11/2026): a tabela da aba Evolução lista todos os meses
  desde o primeiro mês de compras, com a linha de total de cada ano (`tr.ano`) e volumes
  absolutos (TAM e compras) além das variações; no celular ficam só as variações e a fatia.
- **Mesmas unidades**: a variação contra o ano anterior (SOM da rede e veredito) tira a
  unidade que não comprava no período base; o crescimento nominal da rede, com unidade
  nova, e a fatia do TAM ficam na aba Evolução.
- **Topo**: funil TAM → SAM → SOM do período (com variação) e o veredito — ganhando /
  em linha / perdendo participação = crescimento das mesmas unidades menos o do TAM,
  faixa de ±1 p.p.
- **Abas**: *Unidades* (SAM, SOM e posição de cada unidade; tocar abre o ranking da área,
  do maior para o menor, com "nós vs ele" e os avisos de posto novo/saiu do cadastro) ·
  *Evolução* (SOM mês a mês por unidade; crescimento mês a mês contra o TAM; crescimento
  nominal da rede: mesmas unidades × unidades novas × TAM e fatia do TAM) · *Bandeiras*
  (apoio à negociação: dentro da Raízen/Ipiranga, carteira do GV, crescimento da unidade
  contra a bandeira, quem vende para os postos do RS) · *Fontes e método* (legenda).
- **Pouco texto na tela** (pedido do Samuel, 15/11/2026): notas de uma linha, explicação longa
  só em `title` ou na aba Fontes e método; não voltar a encher os cartões de texto.
- **Opções fixas no topo** (pedido do Samuel, 16/11/2026): a barra de opções (`#fixo`: produto,
  unidades, mês, período) e as abas ficam presas abaixo da barra do site ao rolar, em todas as abas;
  no celular as opções ocupam duas linhas (Tri/Sem abreviados) e as abas rolam para o lado. Trocar
  uma opção não tira a tela do lugar: o `desenha()` mede onde a seção aberta estava e compensa a
  rolagem (se a página encurtar, `#folga` dá a altura que falta); trocar de aba com a página rolada
  põe a aba nova logo abaixo da barra. Alturas vêm de `medeFixos()` (`--tb-h`, `--ctl-h`), por causa
  do zoom do tema.
- **Aba Expansão** (15/11/2026; só aparece quando `expansao.enc.json` tem candidatos): uma
  ficha por posto em avaliação — volume estimado (régua dos bicos ou volume informado), a
  área dele (vizinhança automática por raio, montada no navegador a partir de `area` do
  `postos-raio.json` = todos os postos dos municípios candidatos com coordenada e bicos; ou
  a mesma área de uma unidade nossa), posição e fatia na área, efeito na rede (volume e
  fatia do TAM), efeito no SOM das unidades que hoje o têm como concorrente (a área não
  muda, o SOM soma) e o município (base anual `mercado/regiao.json`, postos do cadastro,
  frota `mercado/frota.json`). **Projeção na rede** (regra do Samuel, 16/11/2026) por
  PERFIL — urbano (referência SF) ou rodovia (referência PS), campo `perfis` do cifrado — e
  por produto (gasolina/etanol e diesel): padrão cheio (36 meses) = litros por bico por mês da
  unidade de referência (compras ÷ bicos do cadastro da ANP, média dos últimos 12 meses
  fechados; GNV fora); 6, 12 e 24 meses = `rampa` (50%, 75% e 87% do padrão desde 18/11/2026; 100% em 36 meses; no cifrado); `teto` = o
  posto novo chega, no máximo, ao volume médio da referência em cada produto (mais bicos
  não trazem mais clientes na mesma proporção); nunca abaixo do volume de hoje
  (`perfis()` e `projeta()` no `mercado.js`). Quando o AS amadurecer (12 meses), entra em
  `ref` do perfil rodovia.
  **Botão "+ Adicionar posto"** (16/11/2026, só admin): na própria aba, busca o posto no cadastro
  público da região (`area`), pede apelido, perfil, área (raio de 2/3/5 km ou a área de uma
  unidade nossa) e, se souber, o volume de hoje; o navegador relê o arquivo da nuvem, cifra e
  grava `expansao.enc.json` (e `estimativas.enc.json` quando há volume) pela API do GitHub, com
  commits `chore: atualiza os postos em avaliação do Market Share (manual)` e `chore: atualiza
  as estimativas de concorrentes do Market Share (manual)`. Cada ficha tem "Remover". Perfis,
  rampa e teto não são editados pela tela. Posto de município fora da região não aparece na
  busca: segue o caminho abaixo.
  **Incluir um posto em avaliação pelo chat** (alternativa ao botão; o Samuel informa nome ou endereço, perfil e, se
  souber, o volume): 1) achar o CNPJ em `area` do `postos-raio.json` (nome/endereço); 2)
  `mercado-expansao.mjs abre`, acrescentar `{cnpj, apelido, perfil, area}` (raio 3 km para
  urbano; `{tipo:'unidade',u}` quando fica no corredor de uma unidade nossa) e `grava`; 3)
  volume informado → `mercado-estimativas.mjs grava`; 4) commit sem citar o posto.
  Município fora da região: acrescentar em
  `municipios_candidatos` (`regiao-raio.json`), em `regiao-municipios.json` e rodar os
  workflows `mercado-postos`, `mercado-municipios` e `mercado-frota`.
- Lista de concorrentes: o workflow `mercado-postos.yml` relê toda segunda o cadastro da
  ANP; posto novo na área (SF raio 5 km; PS 10 km + BR-116 km 220–250; AS corredor da
  RS-239) que não está nem em `concorrentes` nem em `descartados` entra em `a_revisar`.
  Para classificar: mover o CNPJ em `regiao-raio.json` e dar push.
- `mercado/regiao.json` (workflow `mercado-municipios.yml`, base municipal anual) e
  `mercado/frota.json` (workflow `mercado-frota.yml`) servem só à aba Expansão.
  `mercado/postos.json` ficou fora de uso em 15/11/2026.

## Chave dos dados trocada

Se um script parar dizendo que a `SAPATAO_DEK` do ambiente é **ANTIGA**, o admin trocou a chave pelas Configurações. Não publique nada e não tente contornar: avise o Samuel em uma linha para colar a chave nova no segredo `SAPATAO_DEK` do ambiente da rotina.
