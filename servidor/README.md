# Servidor do painel (HostGator)

O painel roda em **https://painel.estacaosapatao.com.br**. As páginas são as mesmas do repositório. A diferença é a pasta `api/`, um pequeno servidor em PHP que fica entre o navegador e o GitHub.

## O que o servidor faz

- **Login**: confere a senha no servidor, contra `roadmap/usuarios.json` em PBKDF2, e cria um cookie de sessão `HttpOnly`, `Secure` e `SameSite=Strict`. O navegador nunca recebe o verificador de senha.
- **Tentativas erradas**: com 5 erros em 15 minutos para o mesmo usuário, ou 20 em 1 hora para o mesmo endereço, o login trava por 15 minutos.
- **Permissões**: cada arquivo só sai para quem tem permissão no painel dele, e cada gravação passa pelas regras do servidor. Quem não é admin recebe só o próprio registro da lista de usuários e só o próprio envelope do cofre.
- **Token do GitHub**: fica só no `config.php` do servidor.
- **Dados cifrados de ponta a ponta**: o servidor só passa adiante `{enc:1, iv, ct}`. Gravação de base em texto claro é recusada.
- **Mensagens de commit**: quem não é admin só grava as mensagens que o site gera, com o próprio nome. Isso impede notificações push falsas.
- **Rota git**: só o admin usa, e só para arquivos `.json` de dados. Ela existe para a troca da chave dos dados. Código e workflows nunca mudam pelo site.
- **Registro de acessos**: cada pedido é anotado com data, IP, usuário, rota e status, sem nenhum conteúdo. O arquivo fica em `painel-privado/log/acessos-AAAA-MM.log`.

## Pastas na HostGator

```
/home/<usuario-cpanel>/
├── painel.estacaosapatao.com.br/   ← raiz do subdomínio (o deploy escreve aqui)
│   ├── .htaccess                   ← servidor/raiz.htaccess
│   ├── api/index.php, api/.htaccess
│   └── index.html, roadmap/, estrategia/, fluxo/ …
└── painel-privado/                 ← FORA da raiz pública; o deploy não toca
    ├── config.php                  ← token do GitHub (modelo: servidor/config.exemplo.php)
    ├── sessoes/  cache/  limites/  log/   ← criadas sozinhas
```

`api/index.php` procura o `config.php` em `../painel-privado/`, ao lado da raiz do subdomínio. Também aceita a variável de ambiente `SAPATAO_CONFIG`.

## Publicação

O workflow `.github/workflows/deploy-hostgator.yml` roda a cada mudança de código na `main`. Ele monta uma pasta só com HTML, JS, CSS, ícones e a API e envia por FTP com TLS. Uma trava faz o job falhar se algum `.json` de dados entrar na pasta.

O workflow usa três segredos do repositório:

- `HOSTGATOR_FTP_HOST`
- `HOSTGATOR_FTP_USUARIO`
- `HOSTGATOR_FTP_SENHA`

## Modo servidor no navegador

O `roadmap/auth.js` detecta o endereço. Fora do `github.io`, ele entra no modo servidor:

- as chamadas que as páginas fazem ao GitHub passam a ir para `/api/`;
- o login, a sessão e o Sair passam pelo servidor;
- os envelopes guardam só a chave dos dados.

Enquanto o GitHub Pages estiver no ar, o mesmo código funciona nos dois endereços.

## Testar localmente

Use o servidor embutido do PHP com um roteador que imite o `.htaccess`. Aponte o `config.php` de teste para um GitHub simulado, com `github_api` e `cookie_seguro => false`. Nunca use o token real em teste.
