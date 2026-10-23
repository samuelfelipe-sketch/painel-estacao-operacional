<?php
/* Modelo da configuração do servidor do painel.
   Copie para  /home/<seu-usuario-cpanel>/painel-privado/config.php
   (pasta IRMÃ da pasta do site — NUNCA dentro do public_html) e preencha.
   Este arquivo nunca vai para o GitHub preenchido. */
return [
    /* fine-grained token do GitHub: só este repositório, Contents = Read and write */
    'github_token' => 'COLE_AQUI_O_TOKEN_DO_GITHUB',
    'repo'         => 'samuelfelipe-sketch/painel-estacao-operacional',
    'branch'       => 'main',
    /* endereço do painel: gravações de outra origem são recusadas */
    'origem'       => 'https://painel.estacaosapatao.com.br',
    /* opcionais */
    'sessao_horas' => 12,   /* sem "manter conectado": sai após 12 h parado */
    'lembrar_dias' => 30,   /* com "manter conectado" */
];
