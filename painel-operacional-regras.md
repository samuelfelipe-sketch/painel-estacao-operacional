# Esquema de dados e regras de cálculo — painel Vendas

> Repositório público: os exemplos numéricos do documento original foram
> substituídos por descrições. Os valores reais vivem só no JSON cifrado.

Fonte: relatório **Acompanhamento de Metas e Margens de Vendas**, Argo Gerenciador v.11.09.02.
Extração de referência: 19/09/2026 10:16 · unidades 3, 4, 5 · corte 18/09/2026 · 1º nível de classificação.

---

## 1. Estrutura do JSON

O arquivo tem quatro blocos: `esquema`, `meta`, `linhas` / `grupos` (visão volume e margem) e `fat` (visão faturamento).

### 1.1 `meta`

| Campo | Exemplo | O que é |
|---|---|---|
| `dias_dec` | `18` | Dias decorridos até o corte |
| `dias_mes` | `30` | Dias do mês de referência |
| `dias_ant` | `31` | Dias do mês anterior — **é o que torna a comparação direta injusta** |
| `dias_ano` | `30` | Dias do mesmo mês do ano anterior |
| `data` | `"18/09/2026"` | Corte dos dados |
| `gerado` | `"19/09/2026 10:16"` | Geração do relatório no Argo |
| `unidades` | `"3, 4, 5"` | Unidades incluídas |
| `mes_rotulo` | `"Setembro 2026"` | Rótulo do cabeçalho |
| `mes_ref` / `ant_ref` / `ano_ref` | `"2026-09"` / `"2026-08"` / `"2025-09"` | **Obrigatórios**: todos os rótulos de período da tela (colunas, legendas, botões, notas, leituras) são derivados deles — nada de mês fica escrito no HTML |
| `ant_rotulo` / `ano_rotulo` | `"ago/26"` / `"set/25"` | Rótulos curtos; usados só como reserva se faltar o `*_ref` |
| `argo_versao` | `"11.09.02"` | Opcional; aparece no rodapé |

### 1.2 `linhas` e `grupos`

`linhas` traz as 11 linhas analíticas; `grupos` traz os quatro totalizadores (`TOTCOMB`, `OTTO`, `DIESEL`, `TOTMERC`). Mesmo formato nos dois. A linha **Total geral (faturamento)** no rodapé da tabela comparativa **não vem do JSON**: o site a calcula de `fat.FTOT` (receita projetada, mês anterior e ano anterior; acumulado = projeção × dias_dec/dias_mes) e da soma das margens em R$ de `TOTCOMB` + `TOTMERC` (margem % = margem ÷ receita). Litros e R$ não se somam, por isso ela fica em faturamento.

| Campo | O que é |
|---|---|
| `cod` / `nome` | Sigla do Argo e nome por extenso |
| `tipo` | `"comb"` (litros, margem em R$/L) ou `"merc"` (R$, margem em %) |
| `acum` | Acumulado até o corte, da **tabela de Projeção** |
| `proj` | Projeção do mês, da tabela de Projeção |
| `ant` / `ano` | Realizado do mês anterior / do ano anterior |
| `difAnt` / `difAno` | Variação da projeção contra mês anterior / ano anterior, em % |
| `rdAtual` / `rdAnt` / `rdAno` | Ritmo diário de cada período |
| `vrdAnt` / `vrdAno` | Variação do ritmo diário — **a comparação justa** |
| `muA` / `muB` / `muC` | Margem unitária (R$/L) atual, mês anterior, ano anterior. `null` em mercadorias |
| `mpA` / `mpB` / `mpC` | Margem percentual dos mesmos três períodos |
| `pmcA` / `pmcB` / `pmvA` / `pmvB` | Preço médio de compra e de venda |
| `mrsProj` / `mrsAnt` / `mrsAno` | Margem bruta em R$: projetada, mês anterior, ano anterior |
| `dMargPct` | Variação da margem unitária (combustíveis) ou percentual (mercadorias) contra o mês anterior |
| `dMrs` | `mrsProj − mrsAnt` — o efeito líquido de volume e preço |
| `meta` / `pctMeta` | Meta do mês e atingimento no ritmo proporcional |
| `metaOk` | Calculado no cliente: `meta > 1000`. Ver §4.1 |

### 1.4 `decomp`

Decomposição do acréscimo de faturamento, com duas chaves: `ano` (contra o mesmo mês do ano anterior) e `ant` (contra o mês anterior).

| Campo | O que é |
|---|---|
| `totBase` / `totProj` / `dTot` | Faturamento do período base, projetado e a diferença |
| `vol` | Efeito volume: `(Q1 − Q0) × P̄0`, onde `P̄0` é o preço médio do período base |
| `mix` | Efeito mix: `Q1 × (Σ sᵢ¹·pᵢ⁰ − P̄0)` — deslocamento entre combustíveis de preços diferentes |
| `pre` | Efeito preço: `Σ qᵢ¹ × (pᵢ¹ − pᵢ⁰)` |
| `merc` | Variação de mercadorias e serviços |
| `linhas[]` | Por combustível: `vol`, `pre`, `p0`, `p1`, `q0`, `q1`, `drec` |

`vol + mix + pre + merc = dTot`, exatamente. Se não fechar, a alteração está errada.

A decomposição aparece no painel como gaveta fechada no rodapé do totalizador de faturamento (`<details id="decBox">`); sem o bloco `decomp` no JSON, a gaveta fica oculta.

### 1.6 `unidades` (opcional)

Faturamento total de cada unidade nos três períodos, para a gaveta da decomposição mostrar **quanto do acréscimo veio de cada unidade** (e, em especial, da unidade nova):

```json
"unidades": [
  {"cod": "3", "nome": "SF",     "recA": 0, "recB": 0, "recC": 0},
  {"cod": "4", "nome": "Sapatão","recA": 0, "recB": 0, "recC": 0},
  {"cod": "5", "nome": "Safyr",  "nova": true, "desde": "2026-03", "recA": 0, "recB": 0, "recC": 0}
]
```

| Campo | O que é |
|---|---|
| `cod` / `nome` | Número da unidade no Argo e nome curto |
| `recA` / `recB` / `recC` | Faturamento da unidade: projetado, mês anterior, ano anterior — calculado como o consolidado (combustíveis = volume × PMV do próprio período; mercadorias = R$ do relatório), a partir da seção da unidade no relatório |
| `nova` / `desde` | `true` quando a unidade não existia no período base (`recC = 0`); `desde` é o mês de abertura |

Conferência: `Σ recA = fat.FTOT.recA`, `Σ recB = fat.FTOT.recB`, `Σ recC = fat.FTOT.recC` (o painel mostra uma linha "Diferença" se não fechar). Sem o bloco, a gaveta mostra só volume/preço/mix/mercadorias.

### 1.5 `leituras` (opcional)

Sem este bloco, o painel **gera as leituras a partir dos dados** (linha que cresce e perde margem, linhas abaixo da meta, margem recomposta com volume parado, agregado, mix V-Power, metas inválidas) — o texto muda de sinal e de protagonista conforme o mês. Se o JSON trouxer `leituras: [{k, t, p, a}]` (`k` = `crit` | `ok` | `wn`; `t` título, `p` parágrafo, `a` pergunta para a reunião), elas substituem as automáticas. Texto puro: HTML é escapado.

### 1.3 `fat`

Objeto indexado por código, com as sete siglas de combustível, as quatro de mercadorias e cinco totalizadores: `FTOT`, `FCOMB`, `FOTTO`, `FDIESEL`, `FMERC`.

| Campo | O que é |
|---|---|
| `recA` / `recB` / `recC` | Faturamento projetado / mês anterior / ano anterior, em R$ |
| `qtdA` / `qtdB` / `qtdC` | Quantidade nos mesmos três períodos. `null` quando não é comparável |
| `un` | `"L"`, `"itens"`, `"lav."` ou `"unid."` |
| `vAnt` / `vAno` | Crescimento do faturamento em % |
| `qAnt` / `qAno` | Crescimento da quantidade em % |
| `dAnt` / `dAno` | Crescimento do faturamento em R$ |
| `cAnt` / `cAno` | Contribuição da linha para o crescimento total, em % |
| `part` | Participação no faturamento total |
| `qNota` | Ressalva sobre a quantidade. Hoje só `"sem lavagem"` em `FMERC` |

---

## 2. Fórmulas

Todas replicam o que o próprio Argo faz, exceto onde indicado.

```
projeção          = acumulado ÷ dias_dec × dias_mes
% meta            = acumulado ÷ (meta × dias_dec ÷ dias_mes) − 1      ← proporcional ao período
dif. venda %      = projeção ÷ realizado_do_período_comparado − 1
ritmo diário      = quantidade_do_período ÷ dias_do_período
var. ritmo diário = rdAtual ÷ rdAnt − 1                               ← NOSSO, não do Argo
```

O Argo compara a projeção do mês corrente com o mês anterior fechado, que pode ter mais dias. Isso distorce o crescimento — o ritmo diário corrige. O painel mostra os dois e deixa o botão "Ritmo diário" à mão.

```
margem R$ (combustível) = litros × margem_unitária
margem R$ (mercadoria)  = faturamento × margem_% ÷ 100
Δ margem R$             = margem_projetada − margem_do_mês_anterior
```

```
faturamento (combustível) = volume × preço médio de venda do próprio período
faturamento (mercadoria)  = o valor da coluna "LITROS/R$" do relatório, que já é R$
quantidade (mercadoria)   = faturamento ÷ preço médio de venda
```

O Argo projeta apenas volume. O faturamento projetado aplica o **PMV do mês corrente** ao volume projetado; para agosto e setembro/25 usa volume e PMV de cada mês fechado.

```
contribuição para o crescimento = Δ_da_linha ÷ Δ_do_total × 100
```

Pode ser negativa — uma linha que encolheu contribui negativamente para o crescimento total.

```
decomposição do acréscimo de faturamento (combustíveis):
  volume = (Q1 − Q0) × P̄0                 P̄0 = faturamento_base ÷ litros_base
  mix    = Σ q1ᵢ·p0ᵢ − Q1 × P̄0
  preço  = Σ q1ᵢ × (p1ᵢ − p0ᵢ)
  volume + mix + preço + Δ_mercadorias = Δ_faturamento_total
```

---

## 3. Hierarquia

Os filhos somam exatamente o pai nos dois lados. Se uma alteração quebrar isso, a alteração está errada.

```
Faturamento total (FTOT)
├── Combustíveis (FCOMB)
│   ├── Ciclo Otto (FOTTO) ....... GC · GA · GNV · ET
│   └── Ciclo Diesel (FDIESEL) ... DS · DC · ARL
└── Mercadorias e serviços (FMERC)
    └── LOJA · AUTO · LAV · ARLAV
```

Conferência obrigatória a cada mês: Otto + Diesel = Combustíveis; Combustíveis + Mercadorias = Total, no centavo, com os números do próprio mês.

---

## 4. Inconsistências do Argo — tratadas, não escondidas

### 4.1 Meta do V-Power cadastrada errada
O campo de meta de volume da sigla VP recebeu o **percentual de mix**, não os litros. Por isso o relatório imprime um "% meta" absurdo, com centenas de milhares por cento. O mesmo aconteceu no mês anterior.

**Tratamento:** o painel considera meta válida só acima de 1.000 (`metaOk`) e mostra **"meta inválida"** em vez do percentual. A correção é no cadastro do Argo, não no código.

### 4.2 Preço médio da lavagem no histórico
O PMV da lavagem nos meses históricos está uma ordem de grandeza abaixo do valor do mês corrente. Com o preço atual, a quantidade de lavagens estimada faz sentido; com o histórico, daria dez vezes mais, o que não faz.

**Tratamento:** `qtdB` e `qtdC` da lavagem ficam `null`. O crescimento de unidades de mercadorias é calculado sobre LOJA + AUTO + ARLAV e marcado `"sem lavagem"`. O faturamento da lavagem entra inteiro em todas as colunas de R$.

### 4.3 Dois volumes acumulados diferentes
A tabela de margens e a de projeção acumulam volumes de combustíveis ligeiramente diferentes (menos de 1%). São cortes de data distintos dentro do próprio sistema.

**Tratamento:** margens vêm da primeira tabela, volumes e projeções da segunda. Está declarado no rodapé do painel.

### 4.4 Arla em duas linhas
`ARL` aparece em litros dentro do ciclo diesel e `ARLA` em R$ dentro das mercadorias. São SKUs distintos — pista e loja — e não se anulam. Mantidos separados, como no Argo, e explicado no rodapé.

---

## 5. Atualizar (rotina diária automática)

Desde 19/10/2026 a atualização é diária e automática: o Argo deixa o PDF do relatório no OneDrive (`Operações/Vendas/Claude/`), a Rotina do Claude Code lê o texto pelo conector, `scripts/vendas-monta.mjs` transcreve e calcula tudo o que está neste documento (e recusa gravar se as conferências da §3 não fecharem), `scripts/vendas-publica.mjs` cifra e o commit sobe para o site. Procedimento completo em `painel-operacional-RUNBOOK.md`. O passo a passo manual abaixo continua valendo como reserva.

### 5.1 Manual (reserva)

1. Gerar no Argo o mesmo relatório: *Acompanhamento de Metas e Margens de Vendas*, unidades 3/4/5, 1º nível, análise mensal.
2. Transcrever para o JSON: a **Análise Mensal** alimenta quantidade, PMC, PMV e margem dos três períodos; a **Projeção de Vendas** alimenta `acum`, `proj`, `meta`, `pctMeta`, `difAnt` e `difAno`.
3. Atualizar `meta`: `dias_dec`, `dias_mes`, `dias_ant`, `dias_ano`, `data`, `gerado` e os rótulos. **Conferir os dias do mês anterior** — é o que sustenta a coluna de ritmo diário.
4. Recalcular os campos derivados pelas fórmulas da §2.
5. Conferir a hierarquia da §3 antes de cifrar.
6. Publicar pelo cartão **Vendas** nas Configurações do site (admin): o navegador cifra o JSON e commita apenas o envelope `operacional-conteudo.json`. O JSON em claro nunca entra no repositório.
7. Nos outros aparelhos o painel abre do cache e, ao ver que o arquivo publicado mudou, **redesenha tudo sozinho** na mesma visita (sem precisar de Sair). O Sair também limpa esse cache.

**Conferência mínima antes de publicar:** a projeção de cada linha bate com a coluna PROJEÇÃO do PDF; os filhos somam o pai nos dois lados; nenhum `% meta` absurdo passou sem a marca de meta inválida.

Se as inconsistências da §4 tiverem sido corrigidas no Argo, remover o tratamento correspondente — e comemorar.

## Histórico mensal e seção "Ano a ano"

Arquivo `operacional-historico.json` (raiz), CIFRADO como o `operacional-conteudo.json`, mantido por `scripts/vendas-historico.mjs` (procedimento no RUNBOOK). Decifrado:

```json
{ "v": 1, "atualizadoEm": "2026-11-03T16:18",
  "meses": {
    "2026-10": { "fat": 0, "comb": 0, "merc": 0, "litros": 0, "margem": 0, "fechado": true,  "corte": "02/11/2026", "un": { "3": 0, "4": 0, "5": 0 } },
    "2026-11": { "fat": 0, "proj": 0, "comb": 0, "merc": 0, "litros": 0, "margem": 0, "fechado": false, "dias_dec": 2, "dias_mes": 30, "corte": "02/11/2026", "un": { "3": 0, "4": 0, "5": 0 } }
  } }
```

| Campo | Origem no JSON diário |
|---|---|
| `fat` / `comb` / `merc` | `fat.FTOT/FCOMB/FMERC` → `recB` (mês anterior), `recC` (ano passado), `recA × dias_dec/dias_mes` (mês corrente, acumulado) |
| `proj` | `fat.FTOT.recA` — só no mês parcial |
| `litros` | `grupos.TOTCOMB` → `ant` / `ano` / `acum` |
| `margem` | `TOTCOMB.mrs* + TOTMERC.mrs*` (no parcial, `mrsProj × dias_dec/dias_mes`) |
| `un` | `unidades[].recB/recC/recA` por código do Argo |
| `fechado` / `corte` | fechado = mês inteiro; `corte` = `meta.data` do relatório que gravou |

Regras de mesclagem: fechado substitui parcial; entre dois do mesmo tipo vale o relatório de corte mais novo. A seção no painel (`window.renderHistorico`, `painel-operacional.js`) desenha cartões, tabela e gráfico (barras ano anterior × atual, linha de crescimento) do ano de `meta.mes_ref` contra o anterior: mês parcial é comparado ao mesmo mês do ano anterior **no ritmo proporcional** (× dias_dec/dias_mes), a mesma regra das metas; meses sem os dois anos ficam fora dos totais e são listados no rodapé; "Ano inteiro" = ano anterior realizado (12 meses) × projeção do corrente (fechados + mês corrente projetado + meses restantes no mesmo mês do ano anterior × crescimento do período). Sem o arquivo, a seção fica oculta.

## Meses arquivados (seletor de mês)

`operacional-meses/AAAA-MM.json` = o JSON do painel de um mês **fechado** (relatório com `Data` no último dia do mês, `dias_dec = dias_mes`), cifrado como o `operacional-conteudo.json`; `operacional-meses/indice.json` = `{ "v": 1, "meses": ["2026-10", "2026-09"] }` em claro (só a lista). O `vendas-publica.mjs` arquiva sozinho no `publica` do dia 1º e tem o modo `arquiva --json` para semear. No painel, o seletor "Mês" do topo lista o mês ao vivo mais os do índice; ao trocar, a página baixa e decifra o arquivo, chama `renderPainel` com ele (os botões do topo seguem funcionando) e mostra a nota "Mês fechado · valores realizados" — num mês fechado a projeção é o realizado. Voltar ao mês ao vivo não refaz download. A seção Ano a ano não muda com o seletor.

### Outras empresas do grupo (botão "Grupo / Só postos")

O mesmo `operacional-historico.json` traz o bloco `empresas`, gravado por `scripts/vendas-grupo.mjs importa (--txt <texto do conector> | --pdf <arquivo>)` a partir de dois relatórios do Argo linha a linha (rotina diária, passo 4c do RUNBOOK): **ST · Sapatão Transportes** (unidade 99, "Relatório de Documentos Fiscais Emitidos", CT-e, situação Autorizada — soma do Total Nota por mês de emissão; confere o "Total:" de cada dia e o "Total Unidade de Negócio") e **SE · Siss Empreendimentos** (holding, unidade 1, "Relatório de Vendas - Nota Avulsa", tipo Completo — soma do Valor Total por mês; confere o "Total Geral"). Até 04/11/2026 a transportadora vinha do relatório de MDF-es, que é o manifesto da carga e não o faturamento; a troca de fonte descartou aqueles meses.

```json
"empresas": { "holding": { "nome": "Holding", "fonte": "Relatório de Vendas - Nota Avulsa", "periodo": { "de": "2025-01-01", "ate": "2026-10-31" }, "gerado": "04/11/2026 15:53", "atualizadoEm": "…",
  "cobertura": [["2025-01-01", "2026-10-31"]], "importados": ["04/11/2026 15:53"],
  "dias": { "2026-10-31": { "fat": 0, "intra": 0, "docs": 0 } },
  "meses": { "2026-10": { "fat": 0, "intra": 0, "docs": 0 }, "2026-11": { "fat": 0, "intra": 0, "docs": 0, "parcial": true, "dia": 3 }, "2026-10": { "…": 0, "incompleto": true, "diasDe": 5, "diasAte": 31, "diasCobertos": 27 } } }, "transportadora": { … } }
```

`fat` = bruto do mês; `intra` = parte faturada a empresas do próprio grupo (clientes POSTO SAPATÃO, SF, SAFYR, SAPATAO TRANSPORTES, SISS — aluguéis, energia e fretes internos), informada no rodapé da seção e **somada no bruto**; `docs` = quantidade. Reimportar substitui os meses do período do relatório. No painel, "Postos" (padrão) usa só `meses`; "Grupo" soma `empresas[*].meses[ref].fat` ao faturamento dos postos em cada mês do Ano a ano (inclusive na projeção do mês corrente, quando a empresa tem o mês) e também no painel do mês exibido: a página redesenha com uma cópia do JSON em que `fat.FTOT` ganha o acréscimo nos três períodos (`mes_ref`, `ant_ref`, `ano_ref`) e surge a linha `FGRUPO` "Outras empresas do grupo" (sem quantidade) na árvore, no cartão de faturamento e nas caixas do painel; participações e contribuições são recalculadas sobre o novo total. Só acontece quando as empresas têm o mês exibido lançado; senão a nota do topo avisa e os números do mês ficam só dos postos. Volumes, margens, metas, decomposição e a linha "Total geral (postos)" da tabela seguem sendo dos postos (o Argo só projeta os postos).

Regras de soma das empresas (04/11/2026): mês `parcial` (período do relatório termina antes do fim do mês, `dia` = último dia coberto) é projetado pelo ritmo no painel do mês (`fat ÷ dia × dias do mês`, a mesma régua do `recA` dos postos) e, no Ano a ano, levado ao mesmo dia dos postos; no painel do mês, a empresa só soma se tem o mês exibido lançado (senão a pílula diz "sem lançamento"); no Ano a ano, só soma no mês em que tem **os dois anos** lançados, para o crescimento comparar igual com igual — o rodapé diz até quando cada uma está lançada e em quantos meses entrou.

Desde 04/11/2026 o bloco de cada empresa guarda o faturamento **por dia** (`dias`) e os períodos já carregados (`cobertura`, intervalos fundidos); `meses` é derivado: todos os dias do mês cobertos = fechado; coberto do dia 1º até o último dia carregado = `parcial` + `dia`; faltando dias = `incompleto` com `diasDe`/`diasAte`/`diasCobertos` — entra no painel com o que está lançado, sem projeção, e aparece como "parcial: ST dias 5 a 31" na pílula do Grupo e no rodapé do Ano a ano (decisão do Samuel em 04/11/2026; antes ficava fora). Assim a janela móvel de 30 dias da exportação diária (CSV sem período: período = data do arquivo −30 a −1) se encaixa com as cargas completas. `importados` guarda as assinaturas (GERADO EM do PDF, ou hash do CSV) para ignorar o arquivo repetido.
