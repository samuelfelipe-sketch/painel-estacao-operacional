# Fluxo de Caixa Pessoal — versão protegida por login

Ferramenta pessoal de fluxo de caixa do Samuel, pronta para hospedar on-line.
Os dados financeiros **não existem em texto legível em nenhum arquivo publicado**:
ficam no `dados.enc.json`, criptografado com AES-256-GCM. A senha de cada usuário
é a chave que abre os dados — sem login, o arquivo é ilegível.

## Arquivos

| Arquivo | O que é | Contém dado sensível? |
|---|---|---|
| `index.html` | Tela de login + telas da ferramenta (vazias até o login) | Não |
| `app.js` | Lógica de cálculo e renderização | Não |
| `dados.enc.json` | Cofre: usuários + dados + documentos, tudo cifrado | Só cifrado |
| `tools/build-dados.js` | Gerador do cofre a partir de dados em texto puro | Não |

## Como funciona a segurança

- Uma **chave-mestra AES-256** cifra todos os dados (lançamentos, saldos, documentos).
- Para cada usuário, essa chave-mestra é guardada "embrulhada" pela senha dele
  (PBKDF2-SHA256, 600 mil iterações). Login correto → desembrulha a chave → abre os dados.
- Nenhuma senha fica gravada em lugar nenhum — nem em hash. Tudo roda no navegador
  (WebCrypto); nada de dado em texto puro sai do aparelho.
- **Consequência importante: não existe "esqueci minha senha".** Se todos os usuários
  perderem a senha, os dados do arquivo ficam irrecuperáveis (guarde a senha do admin
  num gerenciador de senhas).

## Abas novas

- **Documentos** — duas funções:
  1. **Importador de extratos OFX** (Sicredi e Nubank): a ferramenta lê o arquivo, ignora o
     que já está conciliado, classifica cada lançamento pelas regras do pipeline
     (`p3_pipeline.py` portado para o navegador) e mostra tudo para conferência, com a
     categoria editável. Pagamentos de fatura pedem os itens da fatura (regime de caixa:
     compras entram no dia do pagamento, abertas por categoria pelo classificador de cartão).
     **Nada entra sem a conciliação no centavo fechar** contra o saldo do extrato; diferenças
     pequenas (≤ R$ 50) podem virar ajuste explícito (Rendimentos/Despesas financeiras),
     diferenças maiores bloqueiam. O corte geral só avança quando as duas contas estão
     cobertas; os saldos de fim de mês e todas as telas se recalculam sozinhos.
  2. **Arquivo de documentos** — extratos, faturas e comprovantes guardados criptografados
     (upload ou texto colado). OFX importados são arquivados automaticamente.
     Limite: 3 MB por arquivo.
- **Acessos** — o administrador cria e exclui usuários; qualquer usuário troca a própria
  senha. Papéis: *Administrador* (gerencia acessos) e *Usuário* (só consulta e documentos).

## Alterações e sincronização

Alterações (novo usuário, novo documento, troca de senha) são recriptografadas e salvas
**no navegador** na hora. Para valerem em todos os aparelhos:

1. Aba **Acessos** (ou Documentos) → card **Sincronização** → *Baixar dados.enc.json atualizado*;
2. Substitua o `dados.enc.json` na hospedagem (no GitHub: abrir o arquivo → ✏️ → upload do novo).

## Hospedar on-line

Qualquer host estático serve. Mais simples:

- **Vercel/Netlify**: importe o repositório e aponte o diretório raiz para `fluxo-pessoal/`.
- **GitHub Pages**: já ativo neste repositório — a pasta fica acessível em
  `https://<usuario>.github.io/<repo>/fluxo-pessoal/`.

A página pode até ficar numa URL pública: sem login ela não mostra (nem contém) nada legível.

Para testar localmente, não abra o `index.html` com clique duplo (o navegador bloqueia o
carregamento do `dados.enc.json`); sirva a pasta: `python3 -m http.server` e acesse
`http://localhost:8000`.

## Atualizar os dados

**Fluxo mensal normal — sem sair da ferramenta:** aba Documentos → *Importar extrato (OFX)*
para cada conta → conferir categorias → confirmar → baixar o `dados.enc.json` atualizado
(card Sincronização) e substituir na hospedagem.

**Reconstrução completa do cofre** (raro — ex.: refazer a base pelo pipeline Python):

```bash
node tools/build-dados.js \
  --data /caminho/dados-plain.json \
  --out dados.enc.json \
  --user 'admin:Administrador:admin' \
  --pass 'SENHA_DO_ADMIN'
```

Atenção: isso gera um cofre **novo** (chave-mestra nova) apenas com o usuário informado —
os demais usuários precisam ser recriados na aba Acessos. O JSON de entrada é o objeto `D`
da ferramenta (`lanc`, `contas`, `saldos`, …).

## Regras de ouro

1. **Nunca** commitar dados em texto puro: nada de `data.json`, OFX, CSV ou fatura neste
   repositório (o `.gitignore` da pasta já bloqueia os padrões comuns).
2. Este repositório é **público** — só o `dados.enc.json` cifrado pode entrar. Ideal a
   médio prazo: migrar esta pasta para um repositório privado, separado do painel da empresa.
3. Senhas longas (12+ caracteres). O arquivo cifrado público pode sofrer tentativa de
   quebra por força bruta — senha forte é o que torna isso inviável.
4. Troque a senha inicial do admin no primeiro acesso (aba Acessos → Alterar minha senha).
