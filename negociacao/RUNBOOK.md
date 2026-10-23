# Negociação de Preços — rotina diária de atualização e publicação

Procedimento que a Rotina do Claude Code segue todo dia para atualizar a ferramenta de Negociação de Preços e publicá-la no site. Este arquivo é só o **procedimento**: as regras de negócio (alavancas, cálculos, o que pedir a cada bandeira) ficam no diário de negociação e no pedido do Samuel, fora deste repositório.

## Pré-requisitos (uma vez)

| O quê | Quem | Como |
|---|---|---|
| Chave dos dados como segredo do ambiente, variável `SAPATAO_DEK` | Samuel | É o valor de `sapatao-dek-v1` do localStorage de um aparelho autorizado (base64, 32 bytes). Vai no ambiente do Claude Code: menu do ambiente → Editar → Network secrets (ou variável de ambiente). Nunca em chat, e-mail ou arquivo. |
| Conector Microsoft 365 na sessão | Samuel | É o mesmo que lê o OneDrive do Fluxo de Caixa. |
| Fontes alcançáveis da nuvem | Samuel | NFs das 3 unidades, relatório do BI VPricing e diário de negociação em e-mail ou numa pasta do OneDrive (ver "Fontes"). |
| Playwright na sessão | Rotina | `mkdir -p /tmp/pw && cd /tmp/pw && npm i playwright@1.54` (o Chromium já está em `/opt/pw-browsers`). |

Sem `SAPATAO_DEK`, a rotina para na primeira etapa e avisa; não tenta nada.

## Fontes

Pasta de referência no OneDrive: `Financeiro/Compras/Painel de Negociação` no OneDrive do Samuel (caminho definido em 18/10/2026; substitui `Financeiro/Negociação de Preços/`). Lá chega todo dia o `DD-MM-AAAA_RelatorioDeCompraDeCombustiveis.csv` (compras por unidade/produto, acumulado dos últimos ~80 dias): ler o do dia (ou o mais recente) pelo conector (`file:///me/...` listando a pasta). Tudo que trata de preços e chega por e-mail de qualquer remetente `@valenciopricing.com.br` (ex.: `bruno@`, `infosys@`, e quem mais surgir) é fonte válida: resumo diário ("VPricing DIRETORIA | Petróleo & Combs - Resumo DD/Mês/AAAA"), alertas, relatórios e anexos. Buscar por remetente/domínio `valenciopricing.com.br` desde a data de referência da versão anterior.

| Fonte | Onde | Atualiza |
|---|---|---|
| NFs de compra de combustível das 3 unidades | e-mail ou pasta `NFs/` (XML/PDF), janela dos últimos 30 dias | compras do mês em curso, volumes de referência, custo de timing |
| Relatório do BI VPricing (Resumo Diário, Análise de Compras) | e-mail diário ou pasta `BI/` | margens por produto e por fornecedor, Brent, dólar |
| Diário de negociação | `negociacao/diario.enc.json` (CIFRADO no repositório, append-only): `node scripts/negociacao-diario.mjs abre --para /tmp/neg` → `/tmp/neg/diario.md` | alavancas: concedido, saldo, prazos, pedidos em aberto, avisos permanentes do cabeçalho |
| Checagem externa (subvenções, mistura, MPs) | busca na web, quando a política de rede permitir | notas de contexto, prioridade nº 1 |

Fonte indisponível no dia → a seção correspondente fica com a leitura anterior **marcada como tal** ("leitura de DD/MM, fonte indisponível em DD/MM"). Nunca inventar número.

## Passos (todo dia, ~06:00 Brasília)

1. **Estado de ontem.** `node scripts/negociacao-publica.mjs abre --para /tmp/neg` → `/tmp/neg/negociacao-anterior.html` (a versão no ar, decifrada). É a base da edição; fora do repositório.
2. **Fontes novas.** Ler pelo conector só o que mudou desde a referência da versão anterior (a data em `.topbar .ref`).
3. **Atualizar** `/tmp/neg/negociacao-novo.html` a partir do anterior: compras, margens, prioridade nº 1, alavancas, top 3, referência do dia. Manter estrutura, seções, ids e identidade. As regras de cálculo são as do pedido do Samuel (impacto = R$/L do saldo × volume de referência; mês ×3 = trimestre; ×12 = ano; conservador = mínimos; timing = comparação com o menor preço da mesma bandeira nos 5 dias anteriores).
4. **Validar.** `node scripts/negociacao-valida.mjs --html /tmp/neg/negociacao-novo.html --pw /tmp/pw/node_modules/playwright`. Reprovado → **não publica**; corrige se for erro de edição, senão avisa o Samuel com a lista de itens e encerra com a versão anterior no ar.
5. **Publicar.** `node scripts/negociacao-publica.mjs publica --html /tmp/neg/negociacao-novo.html` grava `negociacao/dados.enc.json` cifrado.
6. **Commit na branch principal.** `git pull --rebase origin main` → `git add negociacao/dados.enc.json` → commit `chore: publica a ferramenta de Negociação de Preços (automático)` → `git push origin HEAD:main`. Se o push for recusado, abrir um PR com o mesmo título e mesclá-lo (squash). O site mostra a versão nova em 1 a 2 minutos.
7. **Avisar** o Samuel em uma mensagem curta: referência publicada, o que mudou (sem valores sigilosos fora do site), fontes que faltaram. Sem mudança nenhuma nas fontes → não publica e avisa em uma linha.

## O que a rotina nunca faz

- Não grava o HTML decifrado dentro do repositório (só em `/tmp`). Nenhum número da ferramenta vai para commit, log, PR ou mensagem.
- Não "ajusta" número para fechar soma: diferença vira nota na própria seção e aviso ao Samuel.
- Não muda os pontos de encaixe do shell (`.topbar .ref`, `#menuNav`, `#menuBackdrop`, ids das seções) nem traz bibliotecas externas.
- Não publica sem a validação aprovada. Não apaga a versão anterior: ela continua no histórico do git, cifrada.
- Não toca em nenhum outro arquivo do site.

## Revisão semanal (terça, ~06:25 Brasília)

Mesma esteira da rotina diária (abrir a versão no ar → editar em `/tmp/neg` → validar → cifrar → commit na main), com escopo maior. Roda DEPOIS da rotina diária de terça: a base da edição é a versão que a diária acabou de publicar.

O que a semanal faz a mais:

1. **Reconciliação das compras (seção 05, "compras do ano")** — é a razão de ser da semanal. Listar a pasta `Financeiro/Compras/Painel de Negociação` e ler pelo conector os CSVs necessários para cobrir o mês em curso **e o mês anterior desde o dia 1º** (cada CSV cobre uma janela de ~30 dias; se o dia de hoje for ≤ 10, ler também os CSVs dos dias 01 a 07 do mês e o último do mês anterior). Gravar cada CSV, sem alterar, em `/tmp/neg/compras-DD-MM-AAAA.csv` e rodar:

   ```
   node scripts/negociacao-compras.mjs --csv /tmp/neg/compras-A.csv --csv /tmp/neg/compras-B.csv --saida /tmp/neg/compras.json
   ```

   O script deduplica linhas repetidas entre arquivos, exclui ARLA e GNV, agrupa por mês × bandeira (3 e 4 = Raízen, 5 = Ipiranga) × produto (VP e GA = aditivada) × unidade, calcula preço médio = gasto ÷ volume e confere que meses somam o ano e produtos somam o total; reprovado, não grava. A seção 05 recebe os números do `compras.json`: soma dos meses = total do ano, soma dos produtos = total do ano, em volume e em gasto. Mês cuja cobertura (`cobertura` no JSON) não chega ao dia 1º fica marcado "parcial (desde DD/MM)"; meses anteriores à janela disponível mantêm o número guardado, marcados "leitura de DD/MM". Divergência entre o que a diária publicou e o CSV: prevalece o CSV, e a diferença vai na nota da seção.
2. **VPricing dos últimos 7 dias** (e-mail, qualquer remetente `@valenciopricing.com.br`): Resumo Diário (Brent, dólar), Boletim mensal e "Análise de Compras" (margem por produto e por fornecedor) → seções 06 e contexto. O relatório de Paridade de Importação só entra se bater com o Resumo Diário do mesmo dia.
3. **Diário de negociação** (`node scripts/negociacao-diario.mjs abre --para /tmp/neg` → `/tmp/neg/diario.md`): ler TODOS os avisos do cabeçalho (regras permanentes) e as entradas dos últimos 7 dias. Concessões obtidas, pedidos em aberto, prazos, saldos. Concessão que não está no diário não existe.
4. **Checagem externa** (busca na web em fontes primárias: Planalto/DOU, gov.br, ANP): subvenções PIS/COFINS, mistura, MP do diesel, prazos regulatórios — só o que mudou, com a data da checagem.
5. **Recalcular as alavancas** com a decisão de 07/10/2026: impacto de cada alavanca = SÓ o saldo ainda não concedido = (alvo − já concedido) × volume de referência do último mês fechado (do `compras.json`); ×3 trimestre; ×12 ano. Conservador = (mínimo − já concedido, piso zero); timing entra com 20% do teto medido. "Já concedido" aparece na caixa, fora da soma. Não propor troca de produto aditivado por comum (veto permanente). Painel prospectivo: nada de cobrança retroativa como destaque.
6. **Conferência completa** com `scripts/negociacao-valida.mjs` (inclui as somas da seção 05) e, além dela: "se executar até o fim do mês" = alvo mensal × dias restantes ÷ dias do mês; toda data ≤ hoje, exceto prazos futuros.
7. **Entrada no diário**: escrever `/tmp/neg/entrada.md` com UMA entrada `## DD/MM/AAAA (ter) — semanal: …` (o que foi reconciliado, valor antigo → novo e por quê, o que mudou nas alavancas, o que não foi lido) e rodar `node scripts/negociacao-diario.mjs anexa --entrada /tmp/neg/entrada.md`. O script só aceita acréscimo de exatamente uma entrada e recusa qualquer mudança no cabeçalho ou no histórico.
8. **Commit** de `negociacao/dados.enc.json` e `negociacao/diario.enc.json` juntos, com a mensagem `chore: publica a ferramenta de Negociação de Preços (revisão semanal, automático)`.
9. **Resumo ao Samuel**, em lista, uma linha por item, sem valores sigilosos: (1) o que mudou de força nas alavancas; (2) prioridade nº 1 e prazo; (3) se o cenário-alvo e o conservador subiram ou caíram em relação à semana anterior; (4) pendências com as bandeiras; (5) o que não conseguiu ler e o que ficou marcado como leitura anterior.

## Chave dos dados trocada

Se um script parar dizendo que a `SAPATAO_DEK` do ambiente é **ANTIGA**, o admin trocou a chave pelas Configurações. Não publique nada e não tente contornar: avise o Samuel em uma linha para colar a chave nova no segredo `SAPATAO_DEK` do ambiente da rotina.
