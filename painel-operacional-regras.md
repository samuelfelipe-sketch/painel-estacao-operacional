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

`linhas` traz as 11 linhas analíticas; `grupos` traz os quatro totalizadores (`TOTCOMB`, `OTTO`, `DIESEL`, `TOTMERC`). Mesmo formato nos dois.

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

## 5. Atualizar no mês seguinte

1. Gerar no Argo o mesmo relatório: *Acompanhamento de Metas e Margens de Vendas*, unidades 3/4/5, 1º nível, análise mensal.
2. Transcrever para o JSON: a **Análise Mensal** alimenta quantidade, PMC, PMV e margem dos três períodos; a **Projeção de Vendas** alimenta `acum`, `proj`, `meta`, `pctMeta`, `difAnt` e `difAno`.
3. Atualizar `meta`: `dias_dec`, `dias_mes`, `dias_ant`, `dias_ano`, `data`, `gerado` e os rótulos. **Conferir os dias do mês anterior** — é o que sustenta a coluna de ritmo diário.
4. Recalcular os campos derivados pelas fórmulas da §2.
5. Conferir a hierarquia da §3 antes de cifrar.
6. Publicar pelo cartão **Vendas** nas Configurações do site (admin): o navegador cifra o JSON e commita apenas o envelope `operacional-conteudo.json`. O JSON em claro nunca entra no repositório.
7. Nos outros aparelhos o painel abre do cache e, ao ver que o arquivo publicado mudou, **redesenha tudo sozinho** na mesma visita (sem precisar de Sair). O Sair também limpa esse cache.

**Conferência mínima antes de publicar:** a projeção de cada linha bate com a coluna PROJEÇÃO do PDF; os filhos somam o pai nos dois lados; nenhum `% meta` absurdo passou sem a marca de meta inválida.

Se as inconsistências da §4 tiverem sido corrigidas no Argo, remover o tratamento correspondente — e comemorar.
