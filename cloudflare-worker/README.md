# Cloudflare Worker — Painel Estação Sapatão

Worker que dispara o workflow `update-data.yml` via API do GitHub em horários fixos.
Existe porque o cron nativo do GitHub Actions tem pulado execuções silenciosamente.

## O que ele faz

- **Cron trigger:** roda às 04:47, 06:47 e 08:47 UTC (01:47, 03:47 e 05:47 BR) todos os dias
- **Cada execução** faz um `POST` na API do GitHub pedindo `workflow_dispatch` em `main`
- **Endpoint HTTP** opcional: permite disparar manualmente via `curl` (precisa do PAT no `Authorization`)

## Pré-requisito: gerar o GitHub PAT

1. Acesse https://github.com/settings/tokens/new
2. Nome: `painel-cloudflare-trigger`
3. Expiração: 1 ano (ou No expiration se preferir)
4. Escopo: marque apenas **`workflow`** (já inclui acesso necessário a Actions)
5. Clique em "Generate token" e **copie o valor** — só aparece uma vez

## Publicação — opção A: dashboard da Cloudflare (5 min)

1. Acesse https://dash.cloudflare.com/ → Workers & Pages → **Create application** → **Create Worker**
2. Nome: `painel-estacao-trigger` → **Deploy**
3. Clique em **Edit code** → cole o conteúdo de `src/worker.js` → **Deploy**
4. **Settings → Variables and Secrets**:
   - Add → tipo **Secret** → nome `GH_PAT` → valor: o token gerado acima → **Save**
5. **Settings → Triggers → Cron Triggers** → Add Cron Trigger:
   - `47 4 * * *`
   - `47 6 * * *`
   - `47 8 * * *`
6. Pronto. O primeiro disparo será no próximo horário cron.

## Publicação — opção B: wrangler CLI (se preferir terminal)

```bash
# 1. Instalar wrangler (se ainda não tiver)
npm install -g wrangler

# 2. Login na sua conta Cloudflare
wrangler login

# 3. Dentro do diretório cloudflare-worker/
cd cloudflare-worker

# 4. Configurar o secret
wrangler secret put GH_PAT
# cola o token quando pedir

# 5. Publicar
wrangler deploy
```

## Teste manual

Depois de publicado, descobre a URL do Worker (algo como
`https://painel-estacao-trigger.<seu-subdomain>.workers.dev`) e:

```bash
curl -H "Authorization: Bearer <SEU_GH_PAT>" \
  https://painel-estacao-trigger.<seu-subdomain>.workers.dev
```

Resposta esperada: `{"ok": true, "status": 204}` e um novo commit
`chore: update dashboard data - ...` aparece em ~60 segundos.

## Manutenção

- **Rotacionar PAT:** gere um novo no GitHub e rode `wrangler secret put GH_PAT`
  (ou re-edite o secret no dashboard)
- **Mudar horários:** edite `wrangler.toml` e re-publique (ou edite no dashboard)
- **Logs:** dashboard da Cloudflare → Workers & Pages → o worker →
  **Logs** mostra as execuções dos crons
