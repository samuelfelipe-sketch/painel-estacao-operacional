# Market Share — procedimento de atualização

Painel `mercado/index.html` (login unificado, permissão `mercado` = le|nao; admin
sempre entra). Compara as **compras de combustível do Sapatão** com as **vendas das
distribuidoras aos postos** publicadas pela ANP, por bandeira (Raízen, Ipiranga),
por produto (Otto, Diesel, consolidado), por recorte (RS, Sul, Brasil) e por
segmento (posto revendedor, só bandeirados, todos os segmentos).

## Arquivos

| Arquivo | Conteúdo | Sensível? | Quem grava |
|---|---|---|---|
| `mercado/anp-vendas.json` | mercado agregado por recorte × mês × segmento × produto × distribuidora (mil m³), desde 2025-01 | não (dado público da ANP) | workflow `mercado-anp.yml` |
| `mercado/sapatao.enc.json` | compras do Sapatão por mês × bandeira × produto (m³) — **CIFRADO** com a chave dos dados | **sim** | `scripts/mercado-sapatao.mjs` |
| `mercado/postos.json` | postos revendedores por bandeira e recorte, por mês de referência | não (API de Revendedores da ANP via relatório Posto Seguro) | à mão, a cada relatório recebido |

## 1. Mercado (automático)

`.github/workflows/mercado-anp.yml` roda nos dias **6 e 22** (09:00 BRT) e sempre
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

## 2. Sapatão (rotina mensal do Claude Code, após o dia 6)

Fonte: `DD-MM-AAAA_RelatorioDeCompraDeCombustiveis.csv` na pasta
`Financeiro/Compras/Painel de Negociação` do OneDrive do Samuel (mesma fonte da
revisão semanal da Negociação). Cada CSV cobre **30 dias até o dia anterior** ao
da data do nome.

1. Ler pelo conector os CSVs que cubram o mês fechado inteiro (o do dia 1º do
   mês seguinte cobre do dia 1º ao último dia do mês; se faltar, dois arquivos
   que se emendem). Gravar cada um, sem alterar, em `/tmp/ms/compras-DD-MM-AAAA.csv`
   (fora do repositório).
2. Agregar e cifrar:
   ```
   node scripts/negociacao-compras.mjs --csv /tmp/ms/compras-A.csv [--csv ...] --saida /tmp/ms/compras.json
   node scripts/mercado-sapatao.mjs grava --compras /tmp/ms/compras.json --desde AAAA-MM
   ```
   O `grava` funde os meses no arquivo publicado: mês novo entra; mês já gravado
   só é trocado quando a leitura nova cobre o mês inteiro (`--forca` ignora a
   regra). Um mês cuja cobertura não vai do dia 1º ao último dia fica `parcial`
   e aparece assim no painel. `--desde` deixa de fora meses com poucos dias de
   cobertura no CSV (ex.: 3 dias do mês anterior).
3. Conferir: `node scripts/mercado-sapatao.mjs abre --para /tmp/ms` grava o JSON
   decifrado para leitura; nada dele vai para o repositório nem para o chat.
4. Commit `chore: atualiza os volumes do Sapatão no Market Share (automático)`
   só de `mercado/sapatao.enc.json`, com `git pull --rebase` antes.

**Histórico (2025 e jan–jun/2026):** o Argo exporta o mesmo relatório para
qualquer período. Com um CSV (ou vários) cobrindo 01/01/2025 → 30/06/2026, o
passo 2 carrega tudo de uma vez. Alternativa: `--manual meses.json` com os
litros por mês × bandeira × produto (GC, GA, ET, S10, S500 ou otto/diesel).

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

- participação = compras do Sapatão (m³) ÷ vendas das distribuidoras ao segmento
  (mil m³ × 1000), no mesmo mês, recorte e produto;
- "dentro da Raízen" = unidades 3 e 4 ÷ volume da Raízen no recorte; "dentro da
  Ipiranga" = unidade 5 ÷ Ipiranga;
- acumulado do ano = soma dos meses do ano, até o mês escolhido, **que têm as
  duas fontes**; o mercado é somado nos mesmos meses;
- volume por posto = (Sapatão ÷ nº de unidades) ÷ (mercado do segmento ÷ nº de
  postos do recorte em `postos.json`);
- comparativo anual = mesmos meses de janeiro ao mês escolhido nos dois anos;
  crescimento das bandeiras pela ANP (independe do Sapatão); participação do
  Sapatão no ano anterior só quando houver compras publicadas daqueles meses.

## Chave dos dados trocada

Se um script parar dizendo que a `SAPATAO_DEK` do ambiente é **ANTIGA**, o admin trocou a chave pelas Configurações. Não publique nada e não tente contornar: avise o Samuel em uma linha para colar a chave nova no segredo `SAPATAO_DEK` do ambiente da rotina.
