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
| `roadmap/auth.js` | portão de login (usuário + senha, SHA-256 client-side; apps definem `window.SAPATAO_APP`) | — |
| `roadmap/usuarios.json` | **usuários e permissões** (nome, hash da senha, admin, perm roadmap/pe) — editado pela aba Configurações do PE | — |
| `roadmap/execucoes.json` | **base de dados** do Plano de Ação — CIFRADA (AES-256-GCM, `{enc:1,iv,ct}`) — commits automáticos feitos pelo próprio site | — |
| `roadmap/guia-conteudo.json` | conteúdo sensível do Guia (ações, execuções-semente, seções) — CIFRADO | — |
| `roadmap/dek.enc.json` | chave dos dados (DEK) embrulhada pela chave de publicação — canal reserva de destravamento | — |
| `roadmap/icon.svg` | favicon: funil de vendas em etapas, fechamento em laranja | — |
| `estrategia/index.html` | **Planejamento Estratégico** — 25 ações do PE Reborn (KPI, meta, G×U×T, prazos, follow-ups por reunião) + abas de consulta (maturidade, SWOT, BCG, cenário, ICP, modelo de negócio). Usa o MESMO `roadmap/auth.js` (senha e sessão unificadas) e a mesma chave de publicação | senha |
| `estrategia/pe-execucoes.json` | **base de dados** do PE (status/novo prazo/follow-ups) — CIFRADA — commits automáticos `chore: sincroniza follow-ups do Planejamento Estratégico (automático)` | — |
| `estrategia/pe-conteudo.json` | conteúdo sensível do PE (25 ações, diagnóstico, SWOT etc.) — CIFRADO | — |
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
- **Configurações** (SÓ ADMIN vê, nos dois painéis): estado da nuvem + chave de publicação; **troca de senha** do usuário logado (valida a atual, 6+ caracteres, grava em `roadmap/usuarios.json` via Contents API — precisa da chave); no PE também a **administração de usuários**; botão Sair.
- **Login** (`auth.js` v2, compartilhado pelo Guia e pelo PE via `window.SAPATAO_APP`): usuário digitado (campo aberto, sem lista) + senha; a lista vive em `roadmap/usuarios.json` (nome, hash SHA-256 da senha, admin, ativo, permissões `roadmap`/`pe` = edita|le|nao) com fallback embutido do Samuel e cache local. "Manter conectado" grava `{u,h}` no localStorage (`sapatao-roadmap-auth-v1`; formato antigo só-hash ainda vale). Sessões revalidam em segundo plano; sem permissão = tela "Sem acesso"; permissão "le" = interface travada (`body.so-leitura`). A chave de publicação fica criptografada por usuário em `roadmap/chave.enc.json` (v2, envelopes AES-GCM/PBKDF2; o admin gera o envelope ao criar usuário/redefinir senha). `window.sapataoAuth` (user, pw, podeEditar) e `window.sapataoChave` (busca/garante/garantePara) ficam expostos.
- Navegação: "← Página inicial"/"Voltar" sempre levam à central (`../index.html`).

## Regras de trabalho
- **Antes de commitar, sempre `git pull --rebase`**: o site faz commits automáticos (execucoes.json, auth.js) e o Samuel abre PRs por sessões na nuvem.
- Conflito em `roadmap/execucoes.json`: ficar com a versão remota (é a base de dados viva).
- Repositório é **público** e os DADOS SÃO SENSÍVEIS: todo conteúdo de negócio vive CIFRADO (AES-256-GCM) nos arquivos `*-conteudo.json`, `execucoes.json` e `pe-execucoes.json`. A chave dos dados (DEK) só existe: no localStorage dos aparelhos autorizados (`sapatao-dek-v1`), dentro dos envelopes por usuário (`chave.enc.json`, aberto pela senha) e em `dek.enc.json` (aberto pela chave de publicação). **NUNCA commitar dados de negócio em texto claro** — nem em HTML, nem em JSON, nem em commits antigos (o histórico foi limpo por isso). Os apps cifram/decifram no navegador via `window.sapataoCofre`.
- Nada de tokens ou senhas em texto claro no código.
- Testar localmente com `python3 -m http.server` (as páginas usam `auth.js` externo e fetch — não funcionam bem abrindo o arquivo direto).
- GitHub Pages publica em ~1–2 min após o push; favicon e `auth.js` podem ficar até ~10 min no cache do navegador.
- Senhas/usuários: gerir pela aba Configurações (admin) — grava `roadmap/usuarios.json`. Manualmente: hash = SHA-256 da senha no `usuarios.json` (e o fallback do Samuel em `auth.js`).
- Mensagens de commit em português, estilo `feat:`/`fix:`/`chore:`.

## Pendências conhecidas
- Painel Operacional: reativar exige nova chave da API `dashboard.estacaosapatao.com.br` (segredo do workflow `update-data.yml`).
- Possível evolução: criptografar `execucoes.json` (repo público), esconder/mostrar concluídas no Painel.
