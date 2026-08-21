# Roadmap Comercial — Estação Sapatão

Site estático com os materiais da Imersão Comercial Club Reborn (25-26/07/2026).

## Estrutura

| Arquivo | Conteúdo |
|---|---|
| `index.html` | Página inicial com links para os três materiais |
| `guia.html` | Guia de Execução: painel das 17 ações (status, data, observações), ordenação por Prazo/G×U×T, aviso de atrasadas, visão de cartões no celular, pilares PACE, cola rápida e Roadmap oficial |
| `resumo.html` | Resumo dos Aprendizados por pilares do método PACE (versão Club Reborn) |
| `plano-de-acao.html` | Tabela do plano de ação formatada para impressão (A4 paisagem) |

Além das páginas, o arquivo `auth.js` contém o portão de acesso (login por senha) usado por todas elas.

Tudo é HTML puro — sem build, sem dependências, sem backend. As fontes vêm do Google Fonts (precisa de internet ao abrir).

## Acesso (login e senha)

Todas as páginas pedem senha antes de abrir. A validação é feita no navegador comparando o **hash SHA-256** — a senha não aparece em texto claro no código.

- **Senha inicial:** `pass123`
- Marcando "Manter conectado neste dispositivo", não pede de novo naquele aparelho. O link **Sair** no rodapé da página inicial desconecta.
- **Para trocar a senha:** gere o SHA-256 da nova senha (peça ao Claude ou rode `echo -n "novasenha" | shasum -a 256`) e substitua o valor de `HASH_SENHA` no `auth.js`.
- É uma proteção simples de site estático (client-side): serve para restringir o acesso interno, não para guardar dados sensíveis.

## Publicação atual

O site vive dentro do repositório do Painel Operacional e é publicado junto com ele no GitHub Pages, com link exclusivo:

**https://samuelfelipe-sketch.github.io/painel-estacao-operacional/roadmap/**

O rodapé do painel principal também tem o atalho "Roadmap Comercial →".

## Como publicar

**GitHub Pages** (sugestão pelo Claude Code):
```bash
git init && git add . && git commit -m "Roadmap Comercial Sapatão"
gh repo create sapatao-roadmap --private --source=. --push
gh api repos/{owner}/sapatao-roadmap/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```
O site fica em `https://<usuario>.github.io/sapatao-roadmap/`.

**Netlify / Vercel / Cloudflare Pages:** arraste a pasta inteira no painel (deploy de site estático, sem configuração).

> Conteúdo interno da Rede Sapatão — se publicar no GitHub Pages, prefira avaliar a visibilidade (Pages de repositório privado exige plano pago; alternativa: Netlify com proteção por senha).

## Observações

- Os campos de execução do `guia.html` (status, data, observações) são salvos no navegador **e sincronizados automaticamente entre aparelhos**: a base de dados é o arquivo `roadmap/execucoes.json` deste repositório (cada alteração vira um commit automático, com histórico).
  - **Ler** é automático em qualquer aparelho — ao abrir o guia, ele baixa a versão mais recente.
  - **Publicar** exige uma chave do GitHub colada uma única vez por aparelho: clique no chip **☁ Nuvem** no topo do Plano de Ação e cole um fine-grained token com permissão *Contents: Read and write* somente neste repositório (crie em github.com → Settings → Developer settings → Fine-grained tokens; é o mesmo tipo de chave usado pelo app `fluxo-pessoal`). A chave fica só no localStorage do aparelho, nunca no código.
  - Vale a última alteração (comparação por data/hora). Sem internet, tudo continua funcionando localmente e publica quando reconectar.
  - **Atenção**: o repositório é público, então o conteúdo de `execucoes.json` (status, datas, observações) é legível por quem achar o repositório — evite dados sensíveis nas observações.
- Os botões **Exportar dados / Importar** continuam existindo como backup manual em JSON.
- A detecção de ações atrasadas usa a data do dispositivo do visitante.
- Para atualizar prazos, responsáveis ou ações, edite o array `ACOES` no mesmo `<script>` do `guia.html`.
