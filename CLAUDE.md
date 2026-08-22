# Estação Sapatão — Painéis e Roadmap Comercial

Site estático (GitHub Pages) do repositório `samuelfelipe-sketch/painel-estacao-operacional`.
URL base: https://samuelfelipe-sketch.github.io/painel-estacao-operacional/
Dono: Samuel Felipe (samuel@estacaosapatao.com.br). Responda sempre em português do Brasil.

## Mapa do site (estado em 21/08/2026)

| Caminho | O que é | Acesso |
|---|---|---|
| `index.html` | **Central de acessos** (porta de entrada): 3 cartões | aberto |
| `roadmap/guia.html` | **Guia de Execução** — app principal do Roadmap Comercial (método PACE, 17 ações) | senha |
| `roadmap/plano-de-acao.html` | Plano de Ação formatado para impressão (A4 paisagem) | senha |
| `roadmap/resumo.html` | **Método Reborn** — resumo da imersão Club Reborn. Identidade própria (navy/dourado). **Não alterar o layout.** | aberto de propósito (compartilhável) |
| `roadmap/index.html` | só redireciona para a central | — |
| `roadmap/auth.js` | portão de login (SHA-256 client-side) | — |
| `roadmap/execucoes.json` | **base de dados** do Plano de Ação (status/data/obs das 17 ações) — commits automáticos feitos pelo próprio site | — |
| `roadmap/icon.svg` | favicon: funil de vendas em etapas, fechamento em laranja | — |
| `estrategia/index.html` | **Planejamento Estratégico** — 25 ações do PE Reborn (KPI, meta, G×U×T, prazos, follow-ups por reunião) + abas de consulta (maturidade, SWOT, BCG, cenário, ICP, modelo de negócio). Usa o MESMO `roadmap/auth.js` (senha e sessão unificadas) e a mesma chave de publicação | senha |
| `estrategia/pe-execucoes.json` | **base de dados** do PE (status/novo prazo/follow-ups por ação) — commits automáticos `chore: sincroniza follow-ups do Planejamento Estratégico (automático)` | — |
| `painel-operacional.html` | Painel Operacional (faturamento por canal). **Desativado por ora** — `data.json` vazio desde maio (token da API do dashboard expirou) | aberto |
| `fluxo-pessoal/` | app de finanças pessoais (projeto separado, não mexer sem pedido) | — |
| `reborn-imersao.html`, `context.md`, `scripts/`, `.github/workflows/` | legado do painel operacional | — |

## Identidade visual (todas as páginas, exceto o Método Reborn)
- Cores: verde `#004438` (escuro `#00352C`, suave `#3D6B60`), laranja `#EC6C22` (escuro `#C2531A`), fundo `#EBEBEA`, cartão `#FFF`, linha `#D8D8D3`.
- Fontes (Google Fonts): **Fraunces** (títulos, itálico laranja para destaque), **Archivo** (corpo), **IBM Plex Mono** (rótulos/eyebrows em caixa alta).
- Ícones/favicons seguem a família do `fluxo-pessoal/icon.svg`: fundo verde degradê, formas creme `#F5F3EC`, acento laranja.

## Como o Guia funciona (roadmap/guia.html)
- Seções no menu lateral: Painel (início), pilares PACE, Cola Rápida, Roadmap Oficial, Plano de Ação, **Configurações**, Sair.
- **Painel de início** é dinâmico: espelha o Plano de Ação — pendentes por mês em ordem de prazo (aviso "atrasada"), concluídas no fim, riscadas, com data e contador.
- **Plano de Ação**: tabela (desktop) / cartões (celular) das 17 ações (`ACOES` no script) com status/data/observações. Ordenação padrão por **prazo**; G×U×T é opção. Botões Exportar/Importar JSON (backup manual).
- **Sincronização automática entre aparelhos** (chave `sapatao-execucoes-v1` no localStorage, formato `{v:2,salvoEm,dados}`): o site lê `roadmap/execucoes.json` pela GitHub Contents API (leitura pública) e, ao alterar, faz PUT/commit automático com mensagem `chore: sincroniza execuções do Roadmap Comercial (automático)`. Vale a última alteração (`salvoEm`). Publicar exige um **fine-grained token do GitHub (Contents: Read/Write só neste repo)** colado uma vez na aba Configurações (localStorage `sapatao-sync-token`); ele também fica guardado **criptografado pela senha do site** em `roadmap/chave.enc.json` (AES-GCM, PBKDF2 310k) — os outros aparelhos recebem a chave sozinhos ao entrar digitando a senha. **Nunca** colocar token em texto claro no código.
- **Configurações**: estado da nuvem + chave de publicação; **troca de senha** (valida a atual, 6+ caracteres, reescreve `HASH_SENHA` no `auth.js` via Contents API — precisa da chave); botão Sair.
- **Login** (`auth.js`): compara SHA-256 da senha com `HASH_SENHA`; "manter conectado" grava o hash no localStorage (`sapatao-roadmap-auth-v1`). Se a senha falhar localmente, confere a versão fresca do `auth.js` no raw.githubusercontent (à prova de cache após troca). Sessões lembradas revalidam em segundo plano. `window.sapataoAuth` e `window.sapataoSair()` ficam expostos.
- Navegação: "← Página inicial"/"Voltar" sempre levam à central (`../index.html`).

## Regras de trabalho
- **Antes de commitar, sempre `git pull --rebase`**: o site faz commits automáticos (execucoes.json, auth.js) e o Samuel abre PRs por sessões na nuvem.
- Conflito em `roadmap/execucoes.json`: ficar com a versão remota (é a base de dados viva).
- Repositório é **público**: nada de tokens, senhas em texto claro ou dados sensíveis.
- Testar localmente com `python3 -m http.server` (as páginas usam `auth.js` externo e fetch — não funcionam bem abrindo o arquivo direto).
- GitHub Pages publica em ~1–2 min após o push; favicon e `auth.js` podem ficar até ~10 min no cache do navegador.
- Trocar a senha do site: usar a aba Configurações (self-service). Manualmente: `HASH_SENHA` em `roadmap/auth.js` = SHA-256 da senha.
- Mensagens de commit em português, estilo `feat:`/`fix:`/`chore:`.

## Pendências conhecidas
- Painel Operacional: reativar exige nova chave da API `dashboard.estacaosapatao.com.br` (segredo do workflow `update-data.yml`).
- Possível evolução: criptografar `execucoes.json` (repo público), esconder/mostrar concluídas no Painel.
