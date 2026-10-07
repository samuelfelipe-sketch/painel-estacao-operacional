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

Pasta de referência no OneDrive: `Financeiro/Negociação de Preços/` (o Samuel confirma o caminho).

| Fonte | Onde | Atualiza |
|---|---|---|
| NFs de compra de combustível das 3 unidades | e-mail ou pasta `NFs/` (XML/PDF), janela dos últimos 30 dias | compras do mês em curso, volumes de referência, custo de timing |
| Relatório do BI VPricing (Resumo Diário, Análise de Compras) | e-mail diário ou pasta `BI/` | margens por produto e por fornecedor, Brent, dólar |
| Diário de negociação | `diario.md` (ou `.docx`) na pasta | alavancas: concedido, saldo, prazos, pedidos em aberto, avisos manuais |
| Checagem externa (subvenções, mistura, MPs) | busca na web, quando a política de rede permitir | notas de contexto, prioridade nº 1 |

Fonte indisponível no dia → a seção correspondente fica com a leitura anterior **marcada como tal** ("leitura de DD/MM, fonte indisponível em DD/MM"). Nunca inventar número.

## Passos (todo dia, 07:30 Brasília)

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
