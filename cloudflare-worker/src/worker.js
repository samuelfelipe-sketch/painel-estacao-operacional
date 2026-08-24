/**
 * Cloudflare Worker — Painel Estação Sapatão
 *
 * Dispara o workflow `update-data.yml` no GitHub via API. Roda em horários fixos
 * configurados em `wrangler.toml` (cron triggers). Substitui/reforça o cron do
 * GitHub Actions, que tem se mostrado instável.
 *
 * Secret necessário: GH_PAT (Personal Access Token com escopo `workflow`).
 */

const REPO = "samuelfelipe-sketch/painel-estacao-operacional";
const WORKFLOW = "update-data.yml";
const BRANCH = "main";

async function dispatchWorkflow(env) {
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GH_PAT}`,
      "User-Agent": "painel-estacao-trigger",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: BRANCH }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Falha ao disparar workflow: ${res.status} ${text}`);
    return { ok: false, status: res.status, body: text };
  }
  console.log(`Workflow ${WORKFLOW} disparado em ${BRANCH}`);
  return { ok: true, status: res.status };
}

export default {
  // Cron trigger — executado nos horários definidos em wrangler.toml
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchWorkflow(env));
  },

  // HTTP endpoint — permite disparo manual via GET/POST autenticado
  async fetch(request, env) {
    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${env.GH_PAT}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    const result = await dispatchWorkflow(env);
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 502,
      headers: { "content-type": "application/json" },
    });
  },
};
