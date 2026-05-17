# Painel Operacional — Estação Sapatão

Webapp responsivo para iOS, Android, tablet e desktop.

## Arquivos

- `painel-operacional-mobile.html` — App principal (contém todo o código)
- `manifest.json` — Config PWA (permite instalar como app)
- `sw.js` — Service worker (funciona offline)
- `DEPLOY.md` — Este arquivo

## Opção 1: Vercel (Recomendado — 5 min)

1. Acesse [vercel.com](https://vercel.com)
2. Clique **"Import Project"**
3. Escolha **"Other"** → conecte seu GitHub (ou faça upload dos arquivos)
4. Clique **"Deploy"**
5. Seu app estará em `https://seu-projeto.vercel.app`

## Opção 2: Netlify (Também fácil — 5 min)

1. Acesse [netlify.com](https://netlify.com)
2. Clique **"Add new site"** → **"Deploy manually"**
3. Arraste os 3 arquivos para a caixa
4. Seu app estará em `https://seu-projeto.netlify.app`

## Opção 3: GitHub Pages (Grátis, sem integração)

1. Crie um repositório no GitHub (ex: `painel-estacao`)
2. Coloque os 3 arquivos no `main`
3. Vá em **Settings** → **Pages**
4. Selecione **"Deploy from branch"** → `main`
5. Seu app estará em `https://seu-usuario.github.io/painel-estacao`

## Opção 4: Local (Para testes)

Abra `painel-operacional-mobile.html` no navegador. Funciona 100% — inclusive offline após primeira visita.

---

## Acessar no iPhone

### Via navegador
1. Abra Safari
2. Acesse a URL do seu deployed (ex: `seu-projeto.vercel.app`)
3. Toque o ícone de compartilhamento → **"Adicionar à tela inicial"**

### Como App nativo
Após instalar via Safari:
- Aparece um ícone na tela inicial
- Abre em fullscreen (sem barra de endereço)
- Funciona offline (service worker sincroniza dados)

---

## Dicas de uso

### Para atualizar dados
Edit direto no código (array `cards`, `aceleradores`, `topProdutos`) → redeploy
- Vercel: commit no GitHub → deploy automático
- Netlify: upload novo → automático
- GitHub Pages: push → automático em ~2 min

### Para customizar cores
Edit `--root color-scheme` ou as cores no CSS (ex: `#1a3a2a` é verde)

### Responsividade
- **Mobile (320px+)**: 1 coluna, cards empilhados
- **Tablet (600px+)**: 2–3 colunas
- **Desktop (1000px+)**: Layout completo com 5 cards + 3 ações por linha

---

## Troubleshooting

**App branco ao carregar?**
- Abra DevTools (F12) → Console → veja erros
- Verifique se Chart.js CDN carregou (status 200)

**Offline não funciona?**
- Service worker leva 10s para ativar
- Recarregue a página (browser reconhece o SW)
- Teste em modo avião

**Não encontra `manifest.json`?**
- Verifique se os 3 arquivos estão na mesma pasta no deploy
- MIME type correto em servidor (geralmente automático)

---

## Estrutura de pastas (opcional)

```
painel-estacao/
├── painel-operacional-mobile.html
├── manifest.json
├── sw.js
└── README.md
```

Vercel/Netlify detectam automaticamente. Nenhuma build necessária!

---

**Dúvidas?** Teste primeiro em `painel-operacional-mobile.html` local, depois faça o deploy.
