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
da data do nome (o de `01-MM` cobre o mês anterior inteiro).

### Rotina diária

1. `git pull --rebase origin main`. Abrir o arquivo publicado para saber o estado:
   `node scripts/mercado-sapatao.mjs abre --para /tmp/ms` → `/tmp/ms/sapatao-mercado.json`
   (meses gravados e quais estão `parcial`). Nada dele vai para o chat.
2. Listar a pasta pelo conector Microsoft 365 e ler o CSV **mais recente**
   (o de hoje, se já chegou; senão o de ontem). Se o **mês anterior** ainda estiver
   `parcial` no arquivo publicado (ou não existir), ler também o CSV do dia `01`
   do mês corrente, que fecha o mês anterior. Gravar cada CSV, sem alterar, em
   `/tmp/ms/compras-DD-MM-AAAA.csv` (fora do repositório). O conector devolve o texto
   com acentos trocados por `�` — não importa, o script só usa as colunas numéricas.
3. Agregar e cifrar (`--desde` = mês anterior, para não gravar meses com poucos
   dias de cobertura nas bordas da janela):
   ```
   node scripts/negociacao-compras.mjs --csv /tmp/ms/compras-A.csv [--csv /tmp/ms/compras-B.csv] --saida /tmp/ms/compras.json
   node scripts/mercado-sapatao.mjs grava --compras /tmp/ms/compras.json --desde AAAA-MM
   ```
   O `grava` funde os meses no arquivo publicado: mês novo entra; mês em curso
   (`parcial`) é trocado pela leitura nova; mês já fechado só é trocado quando a
   leitura nova também cobre o mês inteiro. Mantém unidades (SF, PS, AS) e carteiras do GV.
4. Se `git status` mostrar `mercado/sapatao.enc.json` alterado: `git pull --rebase`,
   commit **só desse arquivo** com `chore: atualiza os volumes do Sapatão no Market Share (automático)`
   e push em `main`. Sem mudança, não commitar.
5. Falhas: sem CSV novo há mais de 2 dias, CSV ilegível, script reprovado ou chave
   ausente → não publicar nada e encerrar a sessão com uma linha dizendo o motivo
   (sem números). Nunca escrever volumes, preços ou nomes em log, commit ou chat.

**Histórico e fechamento pelo PDF do Argo:** o "Relatório de Compra de Combustíveis"
em PDF (Tipo Completo, qualquer período, todas as unidades) é a fonte mais completa.
Carregado em 24/10/2026 o período 01/01/2025 → 30/09/2026 (jul–set/26 trocados pela
versão do PDF). Passos, tudo fora do repositório:
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
