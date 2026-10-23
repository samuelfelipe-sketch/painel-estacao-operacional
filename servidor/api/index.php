<?php
/* =====================================================================
   Estação Sapatão — API do painel (porteiro entre o navegador e o GitHub)
   ---------------------------------------------------------------------
   Roda na HostGator em painel.estacaosapatao.com.br/api/.
   - O login é conferido AQUI (PBKDF2 contra roadmap/usuarios.json) e vira
     um cookie de sessão HttpOnly. Nenhum navegador recebe o token do GitHub.
   - Cada leitura e gravação passa pela permissão do usuário no painel do
     arquivo. Os dados continuam cifrados de ponta a ponta: o servidor só
     enxerga o envelope {enc:1, iv, ct}, nunca o conteúdo.
   - O token do GitHub e as sessões ficam na pasta privada, FORA do
     public_html (config.php — veja servidor/README.md).
   Rotas (todas sob /api/):
     GET  saude                 sem login, só diz que está no ar
     POST login                 {usuario, senha, lembrar}
     POST sair
     GET  eu                    usuário da sessão (sem verificador de senha)
     POST senha                 {atual, nova} troca a própria senha
     GET  contents/<arquivo>    igual à Contents API do GitHub
     PUT  contents/<arquivo>    idem, com as regras de permissão
     GET  raw/<arquivo>         conteúdo puro
     *    git/<...>             Git Data API, só admin e só arquivos .json
     GET  pessoal               fluxo-pessoal/dados.enc.json (app com login próprio)
   ===================================================================== */
declare(strict_types=1);

const VERSAO_API = '1.0';
const KDF_IT = 600000;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$CFG = carregaConfig();
date_default_timezone_set('America/Sao_Paulo');

/* ---------------------------------------------------------------- base */
function carregaConfig(): array {
    $cands = [];
    if (getenv('SAPATAO_CONFIG')) $cands[] = getenv('SAPATAO_CONFIG');
    if (!empty($_SERVER['DOCUMENT_ROOT'])) $cands[] = dirname(rtrim($_SERVER['DOCUMENT_ROOT'], '/')) . '/painel-privado/config.php';
    $cands[] = dirname(__DIR__, 2) . '/painel-privado/config.php';
    foreach ($cands as $c) {
        if (is_file($c)) {
            $cfg = require $c;
            if (!is_array($cfg) || empty($cfg['github_token']) || empty($cfg['repo'])) sai(500, 'configuração incompleta no servidor');
            $cfg['dir_privado'] = $cfg['dir_privado'] ?? dirname($c);
            $cfg['branch'] = $cfg['branch'] ?? 'main';
            $cfg['github_api'] = rtrim($cfg['github_api'] ?? 'https://api.github.com', '/');
            $cfg['cookie_seguro'] = $cfg['cookie_seguro'] ?? true;
            $cfg['sessao_horas'] = (int)($cfg['sessao_horas'] ?? 12);
            $cfg['lembrar_dias'] = (int)($cfg['lembrar_dias'] ?? 30);
            foreach (['sessoes', 'cache', 'limites', 'log'] as $d) {
                $p = $cfg['dir_privado'] . '/' . $d;
                if (!is_dir($p)) @mkdir($p, 0700, true);
            }
            /* reforço: se a pasta privada cair dentro de uma área pública por
               engano, nada dela sai pela web */
            $trava = $cfg['dir_privado'] . '/.htaccess';
            if (!is_file($trava)) @file_put_contents($trava, "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Deny from all\n</IfModule>\n");
            return $cfg;
        }
    }
    sai(500, 'servidor sem configuração (painel-privado/config.php)');
}
function sai(int $codigo, string $msg, array $extra = []): void {
    http_response_code($codigo);
    echo json_encode(['erro' => $msg] + $extra, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    registra($codigo);
    exit;
}
function responde(int $codigo, $obj): void {
    http_response_code($codigo);
    echo is_string($obj) ? $obj : json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    registra($codigo);
    exit;
}
function ip(): string { return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'; }
/* registro de acessos (sem conteúdo): data, ip, usuário, método, rota, status */
function registra(int $codigo): void {
    global $CFG, $USUARIO, $ROTA;
    if (empty($CFG['dir_privado'])) return;
    $linha = json_encode([
        't' => date('c'), 'ip' => ip(), 'u' => $USUARIO['id'] ?? null,
        'm' => $_SERVER['REQUEST_METHOD'] ?? '', 'r' => $ROTA ?? '', 's' => $codigo,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    @file_put_contents($CFG['dir_privado'] . '/log/acessos-' . date('Y-m') . '.log', $linha . "\n", FILE_APPEND | LOCK_EX);
}
function corpoJson(): array {
    $t = file_get_contents('php://input');
    if ($t === false || strlen($t) > 25 * 1024 * 1024) sai(413, 'corpo grande demais');
    $j = json_decode($t, true);
    if (!is_array($j)) sai(400, 'corpo inválido');
    return $j;
}

/* ------------------------------------------------------------- GitHub */
function gh(string $metodo, string $caminho, $corpo = null, array $cab = []): array {
    global $CFG;
    $url = $CFG['github_api'] . '/' . ltrim($caminho, '/');
    $h = array_merge([
        'Accept: application/vnd.github+json',
        'Authorization: Bearer ' . $CFG['github_token'],
        'User-Agent: sapatao-painel',
        'X-GitHub-Api-Version: 2022-11-28',
    ], $cab);
    $ch = curl_init($url);
    $hdrs = [];
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $metodo,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 40,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HEADERFUNCTION => function ($c, $l) use (&$hdrs) {
            $p = explode(':', $l, 2);
            if (count($p) === 2) $hdrs[strtolower(trim($p[0]))] = trim($p[1]);
            return strlen($l);
        },
    ]);
    if ($corpo !== null) {
        $h[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($corpo) ? $corpo : json_encode($corpo, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $h);
    $b = curl_exec($ch);
    if ($b === false) { $e = curl_error($ch); curl_close($ch); sai(502, 'GitHub fora do ar: ' . $e); }
    $st = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return [$st, $hdrs, (string)$b];
}
/* leitura de arquivo com cache por ETag: resposta 304 não gasta o limite da API */
function arquivoGh(string $p, bool $fresco = false): ?array {
    global $CFG;
    $cache = $CFG['dir_privado'] . '/cache/' . sha1($p) . '.json';
    $c = (!$fresco && is_file($cache)) ? json_decode((string)file_get_contents($cache), true) : null;
    if ($c && !$fresco && (time() - ($c['em'] ?? 0)) < 15) return $c['j'];
    $cab = ($c && !empty($c['etag'])) ? ['If-None-Match: ' . $c['etag']] : [];
    [$st, $h, $b] = gh('GET', 'repos/' . $CFG['repo'] . '/contents/' . rawurlPath($p) . '?ref=' . rawurlencode($CFG['branch']), null, $cab);
    if ($st === 304 && $c) { $c['em'] = time(); @file_put_contents($cache, json_encode($c), LOCK_EX); return $c['j']; }
    if ($st === 404) { @unlink($cache); return null; }
    if ($st !== 200) sai(502, 'GitHub respondeu ' . $st);
    $j = json_decode($b, true);
    if (!is_array($j) || !isset($j['sha'])) sai(502, 'resposta inesperada do GitHub');
    if (($j['encoding'] ?? '') !== 'base64' || ($j['content'] ?? '') === '') {
        /* arquivo acima de 1 MB: a Contents API não traz o conteúdo — busca o blob */
        [$s2, , $b2] = gh('GET', 'repos/' . $CFG['repo'] . '/git/blobs/' . $j['sha']);
        $jb = json_decode($b2, true);
        if ($s2 !== 200 || empty($jb['content'])) sai(502, 'não consegui ler ' . $p);
        $j['content'] = $jb['content']; $j['encoding'] = 'base64';
    }
    $j = ['sha' => $j['sha'], 'path' => $j['path'], 'name' => $j['name'], 'size' => $j['size'] ?? 0, 'encoding' => 'base64', 'content' => preg_replace('/\s+/', '', $j['content'])];
    @file_put_contents($cache, json_encode(['em' => time(), 'etag' => $h['etag'] ?? '', 'j' => $j]), LOCK_EX);
    return $j;
}
function rawurlPath(string $p): string { return implode('/', array_map('rawurlencode', explode('/', $p))); }
function textoDe(array $j): string { return (string)base64_decode($j['content']); }
function gravaGh(string $p, string $textoB64, ?string $sha, string $msg): array {
    global $CFG;
    $corpo = ['message' => $msg, 'content' => $textoB64, 'branch' => $CFG['branch']];
    if ($sha) $corpo['sha'] = $sha;
    [$st, , $b] = gh('PUT', 'repos/' . $CFG['repo'] . '/contents/' . rawurlPath($p), $corpo);
    @unlink($CFG['dir_privado'] . '/cache/' . sha1($p) . '.json');
    return [$st, $b];
}

/* ------------------------------------------------------------ usuários */
function usuarios(bool $fresco = false): array {
    $j = arquivoGh('roadmap/usuarios.json', $fresco);
    if (!$j) sai(500, 'lista de usuários não encontrada');
    $d = json_decode(textoDe($j), true);
    if (!is_array($d) || !isset($d['usuarios'])) sai(500, 'lista de usuários ilegível');
    $d['_sha'] = $j['sha'];
    return $d;
}
function verificador(array $u): string { return (string)($u['kdf']['h'] ?? ($u['hash'] ?? '')); }
function confereSenha(array $u, string $senha): bool {
    if (!empty($u['kdf']['h']) && !empty($u['kdf']['s'])) {
        $sal = base64_decode((string)$u['kdf']['s'], true);
        if ($sal === false) return false;
        $it = (int)($u['kdf']['i'] ?? KDF_IT);
        if ($it < 100000 || $it > 5000000) return false;
        $h = base64_encode(hash_pbkdf2('sha256', $senha, $sal, $it, 32, true));
        return hash_equals((string)$u['kdf']['h'], $h);
    }
    if (!empty($u['hash'])) return hash_equals((string)$u['hash'], hash('sha256', $senha));
    return false;
}
function normaliza(string $s): string {
    $s = mb_strtolower(trim($s), 'UTF-8');
    if (class_exists('Normalizer')) $s = (string)Normalizer::normalize($s, Normalizer::FORM_D);
    $s = preg_replace('/\p{Mn}/u', '', $s);
    return (string)$s;
}
function publico(array $u): array {
    return ['id' => $u['id'], 'nome' => $u['nome'], 'admin' => !empty($u['admin']), 'ativo' => ($u['ativo'] ?? true) !== false,
            'perm' => (object)($u['perm'] ?? []), 'trocar' => !empty($u['trocar'])];
}
function perm(array $u, string $app): string {
    if (!empty($u['admin'])) return 'edita';
    return (string)(($u['perm'] ?? [])[$app] ?? 'nao');
}
/* mesma regra do auth.js (senhaProblema) */
function senhaProblema(string $pw, array $u): string {
    if (mb_strlen($pw, 'UTF-8') < 12) return 'A senha precisa de pelo menos 12 caracteres.';
    if (preg_match('/^(.)\1+$/u', $pw)) return 'A senha não pode ser um caractere repetido.';
    $baixa = preg_replace('/[^a-z0-9]/', '', normaliza($pw));
    $proib = ['sapatao', 'estacao', 'senha', '123456', 'qwerty',
              preg_replace('/[^a-z0-9]/', '', normaliza((string)$u['id'])), preg_replace('/[^a-z0-9]/', '', normaliza((string)$u['nome']))];
    foreach ($proib as $p) if ($p !== '' && strlen($p) >= 3 && strpos($baixa, $p) !== false) return 'A senha não pode conter o nome da pessoa, "Sapatão", "senha" ou sequências como 123456.';
    return '';
}

/* -------------------------------------------- limite de tentativas */
function limiteArq(string $chave): string { global $CFG; return $CFG['dir_privado'] . '/limites/' . sha1($chave) . '.json'; }
function falhasRecentes(string $chave, int $janela): int {
    $f = limiteArq($chave);
    if (!is_file($f)) return 0;
    $l = json_decode((string)file_get_contents($f), true) ?: [];
    $agora = time();
    return count(array_filter($l, fn($t) => $agora - $t < $janela));
}
function marcaFalha(string $chave): void {
    $f = limiteArq($chave);
    $l = is_file($f) ? (json_decode((string)file_get_contents($f), true) ?: []) : [];
    $agora = time();
    $l = array_values(array_filter($l, fn($t) => $agora - $t < 86400));
    $l[] = $agora;
    @file_put_contents($f, json_encode($l), LOCK_EX);
}
function limpaFalhas(string $chave): void { @unlink(limiteArq($chave)); }
function bloqueado(string $usuarioDig): bool {
    return falhasRecentes('u:' . normaliza($usuarioDig), 900) >= 5 || falhasRecentes('ip:' . ip(), 3600) >= 20;
}

/* --------------------------------------------------------------- sessão */
function iniciaSessao(): void {
    global $CFG;
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', (string)($CFG['lembrar_dias'] * 86400));
    session_save_path($CFG['dir_privado'] . '/sessoes');
    session_name('sapatao_sessao');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => (bool)$CFG['cookie_seguro'], 'httponly' => true, 'samesite' => 'Strict']);
    session_start();
}
function cookieSessao(bool $lembrar): void {
    global $CFG;
    setcookie(session_name(), session_id(), [
        'expires' => $lembrar ? time() + $CFG['lembrar_dias'] * 86400 : 0,
        'path' => '/', 'secure' => (bool)$CFG['cookie_seguro'], 'httponly' => true, 'samesite' => 'Strict',
    ]);
}
function encerraSessao(): void {
    global $CFG;
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) session_destroy();
    setcookie('sapatao_sessao', '', ['expires' => time() - 3600, 'path' => '/', 'secure' => (bool)$CFG['cookie_seguro'], 'httponly' => true, 'samesite' => 'Strict']);
}
/* usuário da sessão, conferido de novo contra a lista a cada pedido:
   desativado, senha trocada ou sessão vencida = fora na hora */
function usuarioDaSessao(): ?array {
    global $CFG;
    if (empty($_SESSION['uid'])) return null;
    $agora = time();
    if (($_SESSION['expira'] ?? 0) < $agora) { encerraSessao(); return null; }
    $lista = usuarios();
    foreach ($lista['usuarios'] as $u) {
        if (($u['id'] ?? '') === $_SESSION['uid']) {
            if (($u['ativo'] ?? true) === false || !hash_equals((string)($_SESSION['verif'] ?? ''), sha1(verificador($u)))) { encerraSessao(); return null; }
            if (empty($_SESSION['lembrar'])) $_SESSION['expira'] = $agora + $CFG['sessao_horas'] * 3600; /* renova enquanto usa */
            return $u;
        }
    }
    encerraSessao();
    return null;
}
function exigeUsuario(): array {
    global $USUARIO;
    $USUARIO = usuarioDaSessao();
    if (!$USUARIO) sai(401, 'sessão expirada — entre de novo');
    return $USUARIO;
}
/* gravação só a partir das páginas do próprio painel */
function exigeMesmaOrigem(): void {
    global $CFG;
    $o = $_SERVER['HTTP_ORIGIN'] ?? '';
    $sf = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    if ($o !== '' && !empty($CFG['origem']) && rtrim($o, '/') !== rtrim($CFG['origem'], '/')) sai(403, 'origem não permitida');
    if ($o === '' && $sf !== '' && $sf !== 'same-origin') sai(403, 'origem não permitida');
}

/* ----------------------------------------------- permissão por arquivo */
function caminhoValido(string $p): bool {
    return (bool)preg_match('#^[A-Za-z0-9][A-Za-z0-9_\-./]*\.json$#', $p)
        && strpos($p, '..') === false && strpos($p, '//') === false
        && !preg_match('#^(\.github|scripts|servidor)/#', $p);
}
function podeLer(array $u, string $p): bool {
    if (!empty($u['admin'])) return true;
    if (in_array($p, ['roadmap/calendario.json', 'roadmap/chave-id.json', 'roadmap/chave.enc.json', 'roadmap/usuarios.json', 'roadmap/push-subs.json'], true)) return true; /* os dois do meio saem filtrados */
    if (in_array($p, ['roadmap/execucoes.json', 'roadmap/guia-conteudo.json'], true)) return perm($u, 'roadmap') !== 'nao';
    if (strpos($p, 'estrategia/') === 0) return perm($u, 'pe') !== 'nao';
    if (strpos($p, 'fluxo/') === 0) return perm($u, 'fluxo') !== 'nao';
    if (strpos($p, 'negociacao/') === 0) return perm($u, 'negociacao') !== 'nao';
    if (strpos($p, 'mercado/') === 0) return perm($u, 'mercado') !== 'nao';
    if ($p === 'operacional-conteudo.json') return perm($u, 'operacional') !== 'nao';
    return false;
}
function podeGravar(array $u, string $p): bool {
    if (!empty($u['admin'])) return $p !== 'roadmap/chave-id.json'; /* o identificador só muda na troca de chave (git) */
    if ($p === 'roadmap/execucoes.json') return perm($u, 'roadmap') === 'edita';
    if ($p === 'estrategia/pe-execucoes.json') return in_array(perm($u, 'pe'), ['edita', 'followup'], true);
    if ($p === 'roadmap/calendario.json') return perm($u, 'roadmap') === 'edita' || in_array(perm($u, 'pe'), ['edita', 'followup'], true);
    if ($p === 'roadmap/chave.enc.json' || $p === 'roadmap/push-subs.json') return true; /* só a parte da própria pessoa */
    return false;
}
/* mensagens de commit de quem não é admin: só os formatos do site, com o
   próprio nome — o robô do push lê o nome e a ação da mensagem */
function mensagemSegura(array $u, string $msg, string $p): string {
    $n = preg_quote((string)$u['nome'], '/');
    $ok = [
        '/^chore: sincroniza execuções do Planejamento Comercial \(automático\)$/u',
        '/^chore: sincroniza follow-ups do Planejamento Estratégico \(automático\)$/u',
        '/^chore: ' . $n . ' (concluiu|reabriu) a ação \d{1,3} do Planejamento (Comercial|Estratégico) \(automático\)$/u',
        '/^chore: ' . $n . ' renegociou a ação \d{1,3} do Planejamento Estratégico \(automático\)$/u',
        '/^chore: novo follow-up de ' . $n . ' na ação \d{1,3} \(automático\)$/u',
        '/^chore: atualiza calendário de prazos \(automático\)$/u',
        '/^chore: guarda a chave de publicação criptografada \(nuvem\)$/u',
    ];
    foreach ($ok as $re) if (preg_match($re, $msg)) return $msg;
    return 'chore: atualiza ' . $p . ' (via painel, ' . $u['id'] . ')';
}

/* ---------------------------------------------- filtros de leitura */
function filtraLeitura(array $u, string $p, array $j): array {
    if (!empty($u['admin'])) return $j;
    if ($p === 'roadmap/chave.enc.json') {
        $d = json_decode(textoDe($j), true) ?: [];
        $meu = $d['envelopes'][$u['id']] ?? null;
        $d = ['v' => 2, 'envelopes' => $meu ? [$u['id'] => $meu] : (object)[]];
        $j['content'] = base64_encode(json_encode($d, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    } elseif ($p === 'roadmap/usuarios.json') {
        $d = json_decode(textoDe($j), true) ?: [];
        $eu = array_values(array_filter($d['usuarios'] ?? [], fn($x) => ($x['id'] ?? '') === $u['id']));
        $d = ['v' => $d['v'] ?? 1, 'usuarios' => array_map('publico', $eu)];
        $j['content'] = base64_encode(json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
    return $j;
}

/* ================================================================ rotas */
$USUARIO = null;
$caminhoUrl = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$pos = strpos($caminhoUrl, '/api/');
$ROTA = $pos === false ? '' : rawurldecode(substr($caminhoUrl, $pos + 5));
if (isset($_GET['rota']) && $ROTA === '') $ROTA = (string)$_GET['rota'];
$M = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($ROTA === 'saude') responde(200, ['ok' => true, 'versao' => VERSAO_API]);

/* app pessoal: o arquivo é cifrado pelo próprio app (login dele); fica
   acessível como no GitHub Pages, só para leitura */
if ($ROTA === 'pessoal') {
    $j = arquivoGh('fluxo-pessoal/dados.enc.json');
    if (!$j) sai(404, 'não encontrado');
    header('ETag: "' . $j['sha'] . '"');
    if ($M === 'HEAD') responde(200, '');
    responde(200, textoDe($j));
}

iniciaSessao();

if ($ROTA === 'login' && $M === 'POST') {
    exigeMesmaOrigem();
    $b = corpoJson();
    $dig = (string)($b['usuario'] ?? ''); $senha = (string)($b['senha'] ?? '');
    if ($dig === '' || $senha === '' || strlen($senha) > 512) sai(400, 'usuário e senha');
    if (bloqueado($dig)) sai(429, 'muitas tentativas — espere 15 minutos');
    $alvo = normaliza($dig); $achou = null;
    foreach (usuarios()['usuarios'] as $u) {
        if (($u['ativo'] ?? true) === false) continue;
        if (normaliza((string)$u['nome']) !== $alvo && normaliza((string)$u['id']) !== $alvo) continue;
        if (confereSenha($u, $senha)) { $achou = $u; break; }
    }
    if (!$achou) {
        marcaFalha('u:' . $alvo); marcaFalha('ip:' . ip());
        usleep(400000);
        sai(401, 'usuário ou senha incorretos');
    }
    limpaFalhas('u:' . $alvo);
    session_regenerate_id(true);
    $lembrar = !empty($b['lembrar']);
    $_SESSION = ['uid' => $achou['id'], 'verif' => sha1(verificador($achou)), 'lembrar' => $lembrar, 'criada' => time(),
                 'expira' => time() + ($lembrar ? $CFG['lembrar_dias'] * 86400 : $CFG['sessao_horas'] * 3600)];
    cookieSessao($lembrar);
    $USUARIO = $achou;
    responde(200, ['user' => publico($achou)]);
}

if ($ROTA === 'sair') {
    exigeMesmaOrigem();
    $USUARIO = usuarioDaSessao();
    encerraSessao();
    responde(200, ['ok' => true]);
}

if ($ROTA === 'eu') {
    $u = exigeUsuario();
    responde(200, ['user' => publico($u)]);
}

if ($ROTA === 'senha' && $M === 'POST') {
    exigeMesmaOrigem();
    $u = exigeUsuario();
    $b = corpoJson();
    $atual = (string)($b['atual'] ?? ''); $nova = (string)($b['nova'] ?? '');
    if (bloqueado((string)$u['id'])) sai(429, 'muitas tentativas — espere 15 minutos');
    if (!confereSenha($u, $atual)) { marcaFalha('u:' . normaliza((string)$u['id'])); marcaFalha('ip:' . ip()); sai(403, 'a senha atual não confere'); }
    if ($nova === $atual) sai(400, 'a senha nova precisa ser diferente da atual');
    $pr = senhaProblema($nova, $u);
    if ($pr !== '') sai(400, $pr);
    $doc = usuarios(true); $sha = $doc['_sha']; unset($doc['_sha']);
    $sal = random_bytes(16);
    foreach ($doc['usuarios'] as &$x) {
        if (($x['id'] ?? '') !== $u['id']) continue;
        $x['kdf'] = ['alg' => 'pbkdf2-sha256', 'i' => KDF_IT, 's' => base64_encode($sal), 'h' => base64_encode(hash_pbkdf2('sha256', $nova, $sal, KDF_IT, 32, true))];
        unset($x['hash'], $x['trocar']);
        $novoU = $x;
    }
    unset($x);
    if (empty($novoU)) sai(404, 'usuário não encontrado');
    [$st, $bd] = gravaGh('roadmap/usuarios.json', base64_encode(json_encode($doc, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)), $sha,
                         'chore: altera a senha do usuário ' . $u['nome'] . ' (via Configurações)');
    if ($st >= 300) sai(502, 'não consegui gravar a senha (GitHub ' . $st . ')');
    $_SESSION['verif'] = sha1(verificador($novoU));
    responde(200, ['ok' => true, 'user' => publico($novoU)]);
}

/* ---- arquivos de dados (formato da Contents API do GitHub) ---- */
if (strpos($ROTA, 'contents/') === 0 || strpos($ROTA, 'raw/') === 0) {
    $u = exigeUsuario();
    $raw = strpos($ROTA, 'raw/') === 0;
    $p = substr($ROTA, $raw ? 4 : 9);
    if (!caminhoValido($p)) sai(403, 'arquivo não permitido');

    if ($M === 'GET') {
        if (!podeLer($u, $p)) sai(403, 'sem permissão para este painel');
        $j = arquivoGh($p);
        if (!$j) sai(404, 'não encontrado');
        $j = filtraLeitura($u, $p, $j);
        if ($raw) { header('Content-Type: application/json; charset=utf-8'); responde(200, textoDe($j)); }
        responde(200, $j);
    }

    if ($M === 'PUT' && !$raw) {
        exigeMesmaOrigem();
        if (!podeGravar($u, $p)) sai(403, 'sem permissão para gravar este arquivo');
        $b = corpoJson();
        $conteudo = (string)($b['content'] ?? '');
        $texto = base64_decode(preg_replace('/\s+/', '', $conteudo), true);
        if ($texto === false || json_decode($texto) === null) sai(400, 'conteúdo precisa ser JSON em base64');
        $msg = substr(preg_replace('/[\r\n]+/', ' ', (string)($b['message'] ?? 'chore: atualiza ' . $p)), 0, 300);
        $sha = isset($b['sha']) ? (string)$b['sha'] : null;
        $admin = !empty($u['admin']);

        if (!$admin) {
            $msg = mensagemSegura($u, $msg, $p);
            if ($p === 'roadmap/chave.enc.json') {
                /* cada pessoa só grava o PRÓPRIO envelope; os outros ficam como estão */
                $sub = json_decode($texto, true);
                $env = $sub['envelopes'][$u['id']] ?? null;
                if (!is_array($env) || empty($env['salt']) || empty($env['iv']) || empty($env['ct'])) sai(400, 'envelope inválido');
                $atualJ = arquivoGh($p, true);
                $d = $atualJ ? (json_decode(textoDe($atualJ), true) ?: []) : [];
                if (($d['v'] ?? 0) !== 2) $d = ['v' => 2, 'envelopes' => []];
                $d['envelopes'][$u['id']] = array_intersect_key($env, array_flip(['i', 'salt', 'iv', 'ct']));
                $texto = json_encode($d, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
                $sha = $atualJ['sha'] ?? null;
            } elseif ($p === 'roadmap/push-subs.json') {
                /* inscrições de push: mexe só nas do próprio usuário */
                $sub = json_decode($texto, true);
                $atualJ = arquivoGh($p, true);
                $d = $atualJ ? (json_decode(textoDe($atualJ), true) ?: []) : [];
                $d['v'] = 1; $d['subs'] = $d['subs'] ?? [];
                foreach ($d['subs'] as $k => $e) if (($e['u'] ?? '') === $u['id'] && (($sub['subs'][$k]['u'] ?? '') !== $u['id'])) unset($d['subs'][$k]);
                foreach (($sub['subs'] ?? []) as $k => $e) {
                    if (($e['u'] ?? '') !== $u['id']) continue;
                    if (isset($d['subs'][$k]) && ($d['subs'][$k]['u'] ?? '') !== $u['id']) continue;
                    $d['subs'][$k] = $e;
                }
                if (!$d['subs']) $d['subs'] = (object)[];
                $texto = json_encode($d, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
                $sha = $atualJ['sha'] ?? null;
            } elseif ($p !== 'roadmap/calendario.json') {
                /* bases de dados dos painéis: só aceitam o formato cifrado */
                $d = json_decode($texto, true);
                if (($d['enc'] ?? 0) !== 1 || empty($d['iv']) || empty($d['ct'])) sai(400, 'a base precisa ir cifrada');
            }
        }
        [$st, $bd] = gravaGh($p, base64_encode($texto), $sha, $msg);
        responde($st, $bd);
    }
    sai(405, 'método não permitido');
}

/* ---- Git Data API: só admin (troca da chave dos dados) ---- */
if (strpos($ROTA, 'git/') === 0) {
    $u = exigeUsuario();
    if (empty($u['admin'])) sai(403, 'só o administrador');
    $resto = substr($ROTA, 4);
    if (!preg_match('#^(ref/heads/[A-Za-z0-9_\-]+|refs/heads/[A-Za-z0-9_\-]+|commits(/[0-9a-f]{40})?|trees(/[0-9a-f]{40})?|blobs/[0-9a-f]{40})$#', $resto)) sai(403, 'rota git não permitida');
    $qs = $_SERVER['QUERY_STRING'] ?? '';
    $qs = preg_match('/(^|&)recursive=1(&|$)/', $qs) ? '?recursive=1' : '';
    $corpo = null;
    if ($M !== 'GET') {
        exigeMesmaOrigem();
        $corpo = corpoJson();
        if (preg_match('#^refs?/heads/#', $resto) && strpos($resto, 'heads/' . $CFG['branch']) === false) sai(403, 'só a branch principal');
        if ($resto === 'trees') {
            /* a troca de chave só mexe em arquivos .json de dados — nunca em código ou workflows */
            foreach (($corpo['tree'] ?? []) as $e) if (!caminhoValido((string)($e['path'] ?? ''))) sai(403, 'arquivo não permitido: ' . ($e['path'] ?? ''));
        }
        if (isset($corpo['force'])) $corpo['force'] = false;
    }
    [$st, , $bd] = gh($M, 'repos/' . $CFG['repo'] . '/git/' . $resto . $qs, $corpo);
    responde($st, $bd);
}

sai(404, 'rota desconhecida');
