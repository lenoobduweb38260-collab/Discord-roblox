<?php
// 🎛️ Dashboard web façon DraftBot — version PHP pour hébergement mutualisé
// (dossier public_html). Connexion avec Discord (OAuth2) : chaque staff ne
// voit que les serveurs qu'il administre ET où l'un de vos bots est présent.
// Relié aux bots via l'agent hébergeur (pack-hebergeur.zip) — la clé AGENT_KEY
// reste côté serveur, jamais dans le navigateur.

error_reporting(E_ALL & ~E_DEPRECATED);
ini_set('display_errors', '0');

$configFile = __DIR__ . '/config.php';
if (!file_exists($configFile)) {
  http_response_code(500);
  exit('⚠️ Fichier config.php manquant — envoyez-le à côté de index.php et remplissez-le (voir LISEZMOI).');
}
require $configFile;

// 🧪 Mode démo (DASH_DEMO = true dans config.php) : le dashboard fonctionne
// SANS Discord ni agent — connexion automatique et données fictives, pour
// tester l'interface en local (php -S 127.0.0.1:8000). À laisser sur false
// en production.
define('DEMO', defined('DASH_DEMO') && DASH_DEMO === true);

// Page de diagnostic (?p=diag) : toujours accessible, même config incomplète,
// pour aider à finaliser l'installation.
if (!DEMO && ($_GET['p'] ?? '') !== 'diag') {
  $manquants = [];
  foreach (['DASH_CLIENT_ID', 'DASH_CLIENT_SECRET', 'DASH_URL', 'AGENT_URL', 'AGENT_KEY'] as $c) {
    if (!defined($c) || constant($c) === '') $manquants[] = $c;
  }
  if ($manquants) {
    http_response_code(500);
    exit('⚠️ Configuration incomplète : ' . htmlspecialchars(implode(', ', $manquants)) . ' à remplir dans config.php.'
      . ' (Astuce : ouvrez index.php?p=diag pour un diagnostic guidé, ou mettez DASH_DEMO = true pour tester l\'interface en local.)');
  }
}
$DASH_URL = defined('DASH_URL') && DASH_URL !== '' ? DASH_URL : '';

// Personnalisation optionnelle (constantes facultatives de config.php).
$NOM_BOT = defined('DASH_NOM') && DASH_NOM !== '' ? DASH_NOM : 'Mon Bot';
$URL_SUPPORT = defined('DASH_SUPPORT_URL') ? DASH_SUPPORT_URL : '';
$URL_DOCS = defined('DASH_DOCS_URL') && DASH_DOCS_URL !== '' ? DASH_DOCS_URL : 'https://github.com/lenoobduweb38260-collab/Discord-roblox#readme';

session_set_cookie_params([
  'lifetime' => 604800,
  'path' => '/',
  'httponly' => true,
  'samesite' => 'Lax',
  'secure' => str_starts_with($DASH_URL, 'https://'),
]);
session_start();

// Base d'URL pour les redirections (en démo : l'hôte courant).
function base_url(): string {
  global $DASH_URL;
  if ($DASH_URL !== '') return $DASH_URL;
  $scheme = (($_SERVER['HTTPS'] ?? '') === 'on') ? 'https' : 'http';
  return $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}

// ----- Données fictives du mode démo -----
function demo_servers(): array {
  return [
    ['id' => '900000000000000001', 'name' => 'Colmar RP', 'icon' => null, 'membres' => 842, 'bot' => 'Colmar_rp', 'enligne' => true],
    ['id' => '900000000000000002', 'name' => 'Shadow Community', 'icon' => null, 'membres' => 1287, 'bot' => 'Shadow_community', 'enligne' => true],
    ['id' => '900000000000000003', 'name' => 'Lyon RP', 'icon' => null, 'membres' => 356, 'bot' => 'Colmar_rp', 'enligne' => false],
  ];
}
function demo_parametres(): array {
  return [
    'config' => [
      'rp_enabled' => 1, 'rp_locked' => 0, 'staff_role_id' => '10', 'admin_role_id' => '11',
      'staff_role_ids' => '["10","12"]', 'admin_role_ids' => '["11"]', 'service_role_id' => '13',
      'log_channel_id' => '20', 'level_channel_id' => '21', 'service_channel_id' => '22',
      'staff_channel_id' => '23', 'member_channel_id' => '24', 'update_channel_id' => null,
      'proof_channel_id' => '26',
      'welcome_message' => 'Bienvenue à {user} sur **{server}** ! 🎉\nPense à lire le règlement.',
      'goodbye_message' => null, 'welcome_mention' => 1,
      'xp_text' => 20, 'xp_voice' => 10, 'xp_cooldown' => 60,
    ],
    'roles' => [
      ['id' => '10', 'name' => 'Staff'], ['id' => '11', 'name' => 'Administration'], ['id' => '12', 'name' => 'Modérateur'],
      ['id' => '13', 'name' => 'En service'], ['id' => '14', 'name' => 'Police'], ['id' => '15', 'name' => 'Gérant Police'],
    ],
    'channels' => [
      ['id' => '20', 'name' => 'logs'], ['id' => '21', 'name' => 'niveaux'], ['id' => '22', 'name' => 'services'],
      ['id' => '23', 'name' => 'staff'], ['id' => '24', 'name' => 'bienvenue'], ['id' => '25', 'name' => 'général'],
      ['id' => '26', 'name' => 'preuves'],
    ],
    'categories' => [['id' => '30', 'name' => 'TICKETS'], ['id' => '31', 'name' => 'AIDE']],
    'whitelist' => [['roleId' => '14', 'managerId' => '15', 'role' => 'Police', 'manager' => 'Gérant Police']],
    'tickets' => [
      ['id' => 1, 'label' => 'Support', 'emoji' => '🛠️', 'description' => 'Une question, un souci ?', 'categorie' => 'TICKETS', 'support' => 'Staff'],
      ['id' => 2, 'label' => 'Plainte', 'emoji' => '⚖️', 'description' => 'Signaler un membre', 'categorie' => 'AIDE', 'support' => 'Modérateur'],
    ],
    'profils' => [
      ['id' => 1, 'name' => 'Support Colmar RP', 'avatar' => 'https://cdn.discordapp.com/embed/avatars/2.png'],
    ],
    'bans' => [],
  ];
}
function demo_apercu(): array {
  return [
    'serveur' => ['name' => 'Colmar RP', 'membres' => 842, 'icon' => null],
    'stats' => ['cartes' => 128, 'permis' => 74, 'entreprises' => 12, 'ticketsOuverts' => 3, 'whitelist' => 41, 'vehicules' => 26],
    'top' => [
      ['user' => 'shadow', 'level' => 42, 'xp' => 18400],
      ['user' => 'Alex', 'level' => 37, 'xp' => 14200],
      ['user' => 'Marie', 'level' => 31, 'xp' => 9800],
    ],
  ];
}
// En démo, l'utilisateur est CRÉATEUR (accès Staff + Créateur).
function demo_role(): array {
  return ['creator' => true, 'staff' => true, 'rank' => 'Créateur', 'perms' => ['blacklist', 'tickets', 'staff']];
}
function demo_blacklist(): array {
  return ['blacklist' => [
    ['userId' => '700000000000000010', 'tag' => 'ScammeurX', 'reason' => 'Arnaque MrBeast', 'by' => '0', 'at' => '2026-07-20T14:00:00Z'],
    ['userId' => '700000000000000011', 'tag' => null, 'reason' => 'Spam massif', 'by' => '0', 'at' => '2026-07-19T09:30:00Z'],
  ]];
}
function demo_botstaff(): array {
  return [
    'staff' => [
      ['userId' => '800000000000000001', 'tag' => 'Alex', 'rank' => 'Responsable', 'perms' => ['blacklist', 'tickets', 'staff']],
      ['userId' => '800000000000000002', 'tag' => 'Marie', 'rank' => 'Modérateur', 'perms' => ['tickets']],
    ],
    'grades' => ['Responsable', 'Modérateur', 'Support'],
    'perms' => ['blacklist' => '🚫 Blacklist', 'tickets' => '🎫 Tickets du QG', 'staff' => '🛡️ Gestion du staff'],
  ];
}
// Tickets de bannissement remontés au QG (mode staff).
function demo_qg_tickets(): array {
  return ['tickets' => [
    ['id' => 42, 'kind' => 'ban', 'guildName' => 'Colmar RP', 'guildId' => '900000000000000001', 'targetId' => '700000000000000030', 'targetTag' => 'Fraudeur', 'reporterId' => null, 'reason' => 'Ban : publicité + insultes', 'status' => 'ouvert', 'claimedBy' => null, 'resolution' => null, 'at' => '2026-07-22T08:10:00Z'],
    ['id' => 41, 'kind' => 'ban', 'guildName' => 'Shadow Community', 'guildId' => '900000000000000002', 'targetId' => '700000000000000031', 'targetTag' => 'Troll', 'reporterId' => null, 'reason' => 'Ban : spam', 'status' => 'claim', 'claimedBy' => '800000000000000001', 'resolution' => null, 'at' => '2026-07-21T19:44:00Z'],
    ['id' => 40, 'kind' => 'ban', 'guildName' => 'Colmar RP', 'guildId' => '900000000000000001', 'targetId' => '700000000000000010', 'targetTag' => 'ScammeurX', 'reporterId' => null, 'reason' => 'Ban : arnaque', 'status' => 'traite', 'claimedBy' => '800000000000000001', 'resolution' => 'blacklist', 'at' => '2026-07-20T13:55:00Z'],
  ]];
}
// Base de données : historique permanent des blacklists.
function demo_historique(): array {
  return ['historique' => [
    ['id' => 3, 'userId' => '700000000000000010', 'tag' => 'ScammeurX', 'action' => 'blacklist', 'reason' => 'Arnaque MrBeast', 'proof' => 'https://cdn.discordapp.com/preuve1.png', 'by' => '800000000000000001', 'at' => '2026-07-20T14:00:00Z'],
    ['id' => 2, 'userId' => '700000000000000011', 'tag' => null, 'action' => 'blacklist', 'reason' => 'Spam massif', 'proof' => null, 'by' => '0', 'at' => '2026-07-19T09:30:00Z'],
    ['id' => 1, 'userId' => '700000000000000009', 'tag' => 'Repenti', 'action' => 'deblacklist', 'reason' => null, 'proof' => null, 'by' => '0', 'at' => '2026-07-18T16:20:00Z'],
  ]];
}
// Messages récupérés automatiquement du salon preuves du Discord principal.
function demo_preuves(): array {
  return ['preuves' => [
    ['id' => 5, 'authorId' => '800000000000000001', 'authorTag' => 'Alex', 'content' => 'Preuve arnaque ScammeurX — capture ci-jointe', 'attachments' => ['https://cdn.discordapp.com/preuve1.png'], 'at' => '2026-07-20T13:58:00Z'],
    ['id' => 4, 'authorId' => '800000000000000002', 'authorTag' => 'Marie', 'content' => 'Logs du spam de Troll', 'attachments' => ['https://cdn.discordapp.com/logs.txt'], 'at' => '2026-07-21T19:40:00Z'],
  ]];
}

// ----- Requêtes HTTP sortantes (cURL, sinon flux natifs) -----
function http_req(string $url, string $method = 'GET', $body = null, array $headers = [], bool $form = false): array {
  $payload = $body === null ? null : ($form ? http_build_query($body) : json_encode($body));
  if ($payload !== null) $headers[] = 'Content-Type: ' . ($form ? 'application/x-www-form-urlencoded' : 'application/json');
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_CUSTOMREQUEST => $method,
      CURLOPT_HTTPHEADER => $headers,
      CURLOPT_TIMEOUT => 10,
      CURLOPT_FOLLOWLOCATION => true,
    ]);
    if ($payload !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    $raw = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE) ?: 0;
    curl_close($ch);
  } else {
    $ctx = stream_context_create(['http' => [
      'method' => $method,
      'header' => implode("\r\n", $headers),
      'content' => $payload ?? '',
      'timeout' => 10,
      'ignore_errors' => true,
    ]]);
    $raw = @file_get_contents($url, false, $ctx);
    $status = 0;
    foreach ($http_response_header ?? [] as $h) {
      if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $status = (int) $m[1];
    }
  }
  $data = $raw === false ? null : json_decode((string) $raw, true);
  return [$status, is_array($data) ? $data : [], (string) $raw];
}

function agent_call(string $path, string $method = 'GET', $body = null): array {
  [$status, $data] = http_req(AGENT_URL . $path, $method, $body, ['x-cle: ' . AGENT_KEY]);
  return [$status, $data];
}

// ----- Carte serveur Discord → bot de l'agent (cache fichier 30 s) -----
// Le cache est un fichier .php préfixé par « exit » : impossible à télécharger
// depuis le web (il s'exécute et ne renvoie rien).
const CACHE_PREFIX = "<?php exit; ?>\n";
function cache_read(): ?array {
  $raw = @file_get_contents(__DIR__ . '/cache-serveurs.php');
  if ($raw === false || !str_starts_with($raw, CACHE_PREFIX)) return null;
  $data = json_decode(substr($raw, strlen(CACHE_PREFIX)), true);
  return is_array($data) ? $data : null;
}
function guild_map(): array {
  $cache = cache_read();
  if ($cache !== null && isset($cache['at']) && time() - $cache['at'] < 30) {
    return [$cache['map'] ?? [], $cache['infos'] ?? []];
  }
  $map = [];
  $infos = [];
  [$st, $etat] = agent_call('/agent/etat');
  if ($st === 200) {
    foreach ($etat['bots'] ?? [] as $bot) {
      if (($bot['status'] ?? '') !== 'demarre') continue;
      [$st2, $data] = agent_call('/agent/bots/' . rawurlencode($bot['name']) . '/proxy/infos');
      if ($st2 !== 200) continue;
      foreach ($data['guilds'] ?? [] as $g) {
        if (!isset($map[$g['id']])) {
          $map[$g['id']] = $bot['name'];
          $infos[$g['id']] = ['name' => $g['name'], 'memberCount' => $g['memberCount'] ?? null];
        }
      }
    }
    @file_put_contents(__DIR__ . '/cache-serveurs.php', CACHE_PREFIX . json_encode(['at' => time(), 'map' => $map, 'infos' => $infos]));
  } elseif ($cache !== null) {
    return [$cache['map'] ?? [], $cache['infos'] ?? []]; // agent injoignable : on garde l'ancien cache
  }
  return [$map, $infos];
}

// Le membre connecté administre-t-il ce serveur ?
function manages_guild(string $guildId): bool {
  if (DEMO) {
    foreach (demo_servers() as $s) if ($s['id'] === $guildId) return true;
    return false;
  }
  foreach ($_SESSION['guilds'] ?? [] as $g) {
    if ($g['id'] !== $guildId) continue;
    if (!empty($g['owner'])) return true;
    return ((int) $g['permissions'] & 0x28) !== 0; // ADMINISTRATOR | MANAGE_GUILD
  }
  return false;
}

function bot_api(string $guildId, string $path, string $method = 'GET', $body = null): array {
  [$map] = guild_map();
  $botName = $map[$guildId] ?? null;
  if (!$botName) return [404, ['error' => 'Aucun bot en ligne sur ce serveur.']];
  return agent_call('/agent/bots/' . rawurlencode($botName) . '/proxy' . $path, $method, $body);
}

// Appel « global » (blacklist, staff du bot, config du dashboard) : ces
// données sont propres au bot, pas à un serveur — on interroge le premier
// bot en ligne.
function first_bot_api(string $path, string $method = 'GET', $body = null): array {
  [$map] = guild_map();
  $botName = null;
  foreach ($map as $b) { $botName = $b; break; }
  if (!$botName) return [404, ['error' => 'Aucun bot en ligne.']];
  return agent_call('/agent/bots/' . rawurlencode($botName) . '/proxy' . $path, $method, $body);
}
// Appel vers un bot NOMMÉ (statut personnalisé par bot).
function named_bot_api(string $botName, string $path, string $method = 'GET', $body = null): array {
  if (!preg_match('/^[a-zA-Z0-9_-]{1,32}$/', $botName)) return [400, ['error' => 'Bot invalide.']];
  return agent_call('/agent/bots/' . rawurlencode($botName) . '/proxy' . $path, $method, $body);
}
// Liste des bots (noms uniques) présents pour ce membre.
function my_bots(): array {
  [$map, $infos] = guild_map();
  $bots = [];
  foreach ($map as $gid => $b) {
    if (!$bots[$b] ?? false) $bots[$b] = ['name' => $b, 'serveurs' => 0];
    $bots[$b] = ['name' => $b, 'serveurs' => ($bots[$b]['serveurs'] ?? 0) + 1];
  }
  return array_values($bots);
}

// Modules du dashboard (activables par le créateur). Ordre = ordre d'affichage.
const DASH_MODULES = [
  'apercu' => ['📊', 'Vue d\'ensemble'],
  'module' => ['🎭', 'Module RP'],
  'membres' => ['👋', 'Arrivées et départs'],
  'roles' => ['👮', 'Rôles & sécurité'],
  'salons' => ['📢', 'Salons & logs'],
  'niveaux' => ['📈', 'Niveaux'],
  'whitelist' => ['📋', 'Whitelist métiers'],
  'tickets' => ['🎫', 'Tickets'],
];
function dash_defaults(): array {
  return [
    'nom' => defined('DASH_NOM') && DASH_NOM !== '' ? DASH_NOM : 'Mon Bot',
    'accent' => '#d8734f',
    'accroche' => 'Le Roleplay',
    'modules' => array_fill_keys(array_keys(DASH_MODULES), true),
  ];
}
function dash_config_get(): array {
  if (DEMO) $cfg = ['nom' => 'Zetku', 'accent' => '#d8734f', 'accroche' => 'Le Roleplay', 'modules' => ['apercu' => true, 'module' => true, 'membres' => true, 'roles' => true, 'salons' => true, 'niveaux' => true, 'whitelist' => false, 'tickets' => true]];
  else { [$st, $d] = first_bot_api('/dashboard-config'); $cfg = ($st === 200 && !empty($d['config'])) ? $d['config'] : []; }
  return array_replace_recursive(dash_defaults(), is_array($cfg) ? $cfg : []);
}

function send_json(int $code, array $data): never {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  exit(json_encode($data));
}

function json_body(): array {
  $data = json_decode((string) file_get_contents('php://input'), true);
  return is_array($data) ? $data : [];
}

// Réglages autorisés depuis le web (validés ensuite par le bot lui-même).
const WEB_KEYS = [
  'staff_role_ids', 'admin_role_ids', 'service_role_id',
  'log_channel_id', 'level_channel_id', 'service_channel_id', 'staff_channel_id', 'member_channel_id', 'update_channel_id',
  'welcome_message', 'goodbye_message', 'welcome_mention',
  'rp_enabled', 'xp_text', 'xp_voice', 'xp_cooldown',
];

$p = $_GET['p'] ?? '';

// 🧪 Démo : connexion automatique avec un compte fictif (aucun Discord requis).
if (DEMO && empty($_SESSION['user'])) {
  $_SESSION['user'] = ['id' => '0', 'username' => 'Démo', 'avatar' => null];
  $_SESSION['guilds'] = array_map(fn($s) => ['id' => $s['id'], 'name' => $s['name'], 'icon' => null, 'owner' => true, 'permissions' => '8'], demo_servers());
}

// ----- Connexion Discord (OAuth2) -----
if ($p === 'login') {
  if (DEMO) { header('Location: ' . base_url() . '/index.php'); exit; }
  $state = bin2hex(random_bytes(16));
  $_SESSION['oauth_state'] = $state;
  header('Location: https://discord.com/oauth2/authorize?response_type=code'
    . '&client_id=' . DASH_CLIENT_ID
    . '&redirect_uri=' . rawurlencode(DASH_URL . '/index.php?p=callback')
    . '&scope=identify%20guilds'
    . '&state=' . $state);
  exit;
}

if ($p === 'callback') {
  $code = $_GET['code'] ?? '';
  $state = $_GET['state'] ?? '';
  if (!$code || !$state || $state !== ($_SESSION['oauth_state'] ?? null)) {
    header('Location: ' . base_url() . '/index.php');
    exit;
  }
  unset($_SESSION['oauth_state']);
  [$st, $token, $raw] = http_req('https://discord.com/api/oauth2/token', 'POST', [
    'client_id' => DASH_CLIENT_ID,
    'client_secret' => DASH_CLIENT_SECRET,
    'grant_type' => 'authorization_code',
    'code' => $code,
    'redirect_uri' => DASH_URL . '/index.php?p=callback',
  ], [], true);
  if ($st !== 200 || empty($token['access_token'])) {
    error_log("Dashboard : échange OAuth2 refusé (HTTP $st) — vérifiez DASH_CLIENT_SECRET et l'URL de redirection. $raw");
    header('Location: ' . DASH_URL . '/index.php?erreur=oauth');
    exit;
  }
  $auth = ['Authorization: Bearer ' . $token['access_token']];
  [, $user] = http_req('https://discord.com/api/users/@me', 'GET', null, $auth);
  [, $guilds] = http_req('https://discord.com/api/users/@me/guilds', 'GET', null, $auth);
  if (empty($user['id']) || !is_array($guilds)) {
    header('Location: ' . DASH_URL . '/index.php?erreur=discord');
    exit;
  }
  session_regenerate_id(true);
  $_SESSION['user'] = [
    'id' => $user['id'],
    'username' => $user['global_name'] ?? $user['username'],
    'avatar' => !empty($user['avatar']) ? "https://cdn.discordapp.com/avatars/{$user['id']}/{$user['avatar']}.png?size=64" : null,
  ];
  $_SESSION['guilds'] = array_map(
    fn($g) => ['id' => $g['id'], 'name' => $g['name'], 'icon' => $g['icon'] ?? null, 'owner' => $g['owner'] ?? false, 'permissions' => $g['permissions'] ?? '0'],
    $guilds
  );
  header('Location: ' . base_url() . '/index.php');
  exit;
}

if ($p === 'logout') {
  session_destroy();
  header('Location: ' . base_url() . '/index.php');
  exit;
}

// 🔧 Diagnostic : vérifie la configuration et la liaison au bot (accessible
// SANS connexion, pour dépanner l'installation). Ne révèle aucun secret.
if ($p === 'diag') {
  header('Content-Type: text/html; charset=utf-8');
  $checks = [];
  $checks[] = ['PHP ' . PHP_VERSION, version_compare(PHP_VERSION, '7.4', '>='), 'PHP 7.4 ou plus est requis (réglable chez votre hébergeur).'];
  $net = function_exists('curl_init') ? 'cURL' : ((bool) ini_get('allow_url_fopen') ? 'flux natifs' : 'aucun');
  $checks[] = ['Requêtes HTTP sortantes : ' . $net, $net !== 'aucun', 'Activez cURL ou allow_url_fopen chez votre hébergeur.'];
  $checks[] = ['Sessions PHP actives', session_status() === PHP_SESSION_ACTIVE, 'Les sessions PHP doivent fonctionner.'];
  $demoOn = defined('DASH_DEMO') && DASH_DEMO === true;
  $checks[] = ['Mode démo ' . ($demoOn ? 'ACTIVÉ' : 'désactivé'), !$demoOn, 'Passez DASH_DEMO à false dans config.php pour la mise en ligne (sinon tout le monde entre sans Discord).'];
  $cid = defined('DASH_CLIENT_ID') ? DASH_CLIENT_ID : '';
  $csec = defined('DASH_CLIENT_SECRET') ? DASH_CLIENT_SECRET : '';
  $durl = defined('DASH_URL') ? DASH_URL : '';
  $checks[] = ['Client ID Discord renseigné', $cid !== '', 'Portail développeur Discord → votre application → OAuth2 → Client ID.'];
  $checks[] = ['Client Secret Discord renseigné', $csec !== '', 'Portail développeur Discord → OAuth2 → « Reset Secret ».'];
  $checks[] = ['URL publique (DASH_URL) renseignée', $durl !== '', 'Ex : https://monsite.fr (l\'adresse où se trouve ce dashboard).'];
  $aurl = defined('AGENT_URL') ? AGENT_URL : '';
  $akey = defined('AGENT_KEY') ? AGENT_KEY : '';
  $checks[] = ['Adresse de l\'agent (AGENT_URL) renseignée', $aurl !== '', 'Ex : http://IP-de-votre-serveur:9999 (le pack hébergeur qui fait tourner les bots).'];
  $checks[] = ['Clé de l\'agent (AGENT_KEY) renseignée', $akey !== '', 'La même clé que dans la configuration du pack hébergeur.'];
  $agentOk = false; $botCount = 0; $srvCount = 0; $agentMsg = '';
  if ($aurl !== '') {
    [$st, $etat] = agent_call('/agent/etat');
    if ($st === 200) {
      $agentOk = true;
      foreach ($etat['bots'] ?? [] as $b) if (($b['status'] ?? '') === 'demarre') $botCount++;
      [$map] = guild_map();
      $srvCount = count($map);
    } else {
      $agentMsg = $st === 0 ? 'Agent injoignable (adresse/port bloqués ou agent éteint).' : "Réponse HTTP $st — vérifiez AGENT_URL et AGENT_KEY.";
    }
  }
  $checks[] = ['Liaison au bot via l\'agent' . ($agentOk ? " — $botCount bot(s) démarré(s), $srvCount serveur(s)" : ''), $agentOk, $agentMsg ?: 'Renseignez d\'abord AGENT_URL et AGENT_KEY.'];

  $redirect = htmlspecialchars(($durl !== '' ? $durl : rtrim(base_url(), '/')) . '/index.php?p=callback');
  $rows = '';
  $allOk = true;
  foreach ($checks as $c) {
    if (!$c[1]) $allOk = false;
    $rows .= '<div class="row"><span class="ic">' . ($c[1] ? '✅' : '❌') . '</span><div><div class="lbl">' . htmlspecialchars($c[0]) . '</div>'
      . ($c[1] ? '' : '<div class="hint">' . htmlspecialchars($c[2]) . '</div>') . '</div></div>';
  }
  $banner = $allOk
    ? '<div class="bn ok">✅ Tout est prêt : votre dashboard est correctement relié au bot.</div>'
    : '<div class="bn ko">⚠️ Configuration incomplète — corrigez les lignes ❌ ci-dessous, puis rechargez cette page.</div>';
  echo <<<HTML
<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diagnostic — Dashboard</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',system-ui,sans-serif;background:#1e2126;color:#e8e9ed;padding:32px 18px;line-height:1.5}
.card{max-width:680px;margin:0 auto;background:#24272d;border:1px solid #33373f;border-radius:14px;padding:26px}
h1{font-size:22px;margin-bottom:4px}.sub{color:#8f919b;font-size:13.5px;margin-bottom:18px}
.bn{border-radius:10px;padding:12px 15px;font-weight:600;font-size:14px;margin-bottom:18px}
.bn.ok{background:#3ba55d22;color:#4bd07f}.bn.ko{background:#d8734f22;color:#ec8a67}
.row{display:flex;gap:11px;align-items:flex-start;padding:11px 0;border-top:1px solid #33373f}
.ic{font-size:16px;line-height:1.4}.lbl{font-size:14px;font-weight:500}.hint{color:#8f919b;font-size:12.5px;margin-top:2px}
.box{background:#191b1f;border:1px solid #33373f;border-radius:9px;padding:12px 14px;margin-top:18px}
.box b{color:#d8734f}code{background:#000;padding:2px 7px;border-radius:5px;font-size:13px;word-break:break-all;display:inline-block;margin-top:5px}
a.btn{display:inline-block;margin-top:20px;background:#d8734f;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:600;font-size:14px}
</style></head><body><div class="card">
<h1>🔧 Diagnostic du dashboard</h1><div class="sub">Vérification de la configuration (config.php) et de la liaison au bot.</div>
$banner
$rows
<div class="box">🔗 <b>URL de redirection à coller</b> dans Portail développeur Discord → OAuth2 → Redirects :<br><code>$redirect</code></div>
<a class="btn" href="index.php">← Retour au dashboard</a>
</div></body></html>
HTML;
  exit;
}

// « Ajouter à Discord » : lien d'invitation du premier bot en ligne de l'agent.
if ($p === 'inviter') {
  [, $etat] = agent_call('/agent/etat');
  foreach ($etat['bots'] ?? [] as $bot) {
    [$st2, $inv] = agent_call('/agent/bots/' . rawurlencode($bot['name']) . '/invitation');
    if ($st2 === 200 && !empty($inv['url'])) {
      header('Location: ' . $inv['url']);
      exit;
    }
  }
  header('Location: ' . base_url() . '/index.php');
  exit;
}

// Rôle du membre connecté vis-à-vis du bot (créateur / staff).
function my_role(): array {
  if (DEMO) return demo_role();
  $uid = $_SESSION['user']['id'] ?? '';
  [$st, $d] = first_bot_api('/whoami?userId=' . rawurlencode($uid));
  return ($st === 200) ? $d : ['creator' => false, 'staff' => false, 'rank' => null, 'perms' => []];
}

// ----- API (session requise) -----
if ($p === 'api-moi' || $p === 'api-serveur' || $p === 'api-global') {
  if (empty($_SESSION['user'])) send_json(401, ['error' => 'Non connecté — rechargez la page.']);

  if ($p === 'api-moi') {
    $role = my_role();
    $dash = dash_config_get();
    if (DEMO) send_json(200, ['user' => $_SESSION['user'], 'servers' => demo_servers(), 'role' => $role, 'dash' => $dash]);
    [$map, $infos] = guild_map();
    $servers = [];
    foreach ($_SESSION['guilds'] as $g) {
      if (!isset($map[$g['id']]) || !manages_guild($g['id'])) continue;
      $servers[] = [
        'id' => $g['id'],
        'name' => $g['name'],
        'icon' => $g['icon'] ? "https://cdn.discordapp.com/icons/{$g['id']}/{$g['icon']}.png?size=128" : null,
        'membres' => $infos[$g['id']]['memberCount'] ?? null,
        'bot' => $map[$g['id']],
        'enligne' => true,
      ];
    }
    send_json(200, ['user' => $_SESSION['user'], 'servers' => $servers, 'role' => $role, 'dash' => $dash]);
  }

  // ----- Espace Staff / Créateur (données globales du bot) -----
  if ($p === 'api-global') {
    $a = $_GET['a'] ?? '';
    $role = my_role();
    $uid = $_SESSION['user']['id'] ?? '';
    $post = ($_SERVER['REQUEST_METHOD'] === 'POST') ? json_body() : [];

    // Lecture blacklist / staff : accès staff (ou créateur).
    if ($a === 'blacklist' && $_SERVER['REQUEST_METHOD'] === 'GET') {
      if (empty($role['staff'])) send_json(403, ['error' => 'Réservé au staff du bot.']);
      if (DEMO) send_json(200, demo_blacklist());
      [$st, $d] = first_bot_api('/blacklist');
      send_json($st ?: 502, $d ?: ['error' => 'Bot injoignable.']);
    }
    if ($a === 'botstaff' && $_SERVER['REQUEST_METHOD'] === 'GET') {
      if (empty($role['staff'])) send_json(403, ['error' => 'Réservé au staff du bot.']);
      if (DEMO) send_json(200, demo_botstaff());
      [$st, $d] = first_bot_api('/botstaff');
      send_json($st ?: 502, $d ?: ['error' => 'Bot injoignable.']);
    }
    if ($a === 'dashconfig' && $_SERVER['REQUEST_METHOD'] === 'GET') {
      send_json(200, ['config' => dash_config_get(), 'modules' => DASH_MODULES, 'bots' => DEMO ? [['name' => 'Colmar_rp', 'serveurs' => 2], ['name' => 'Shadow_community', 'serveurs' => 1]] : my_bots()]);
    }
    // Statut personnalisé d'un bot précis (créateur).
    if ($a === 'bot-status' && $_SERVER['REQUEST_METHOD'] === 'GET') {
      if (empty($role['creator'])) send_json(403, ['error' => 'Réservé au créateur du bot.']);
      if (DEMO) send_json(200, ['status' => ['type' => 'watching', 'text' => 'les serveurs RP', 'presence' => 'online'], 'tag' => 'Colmar_rp#0001']);
      [$st, $d] = named_bot_api((string) ($_GET['bot'] ?? ''), '/bot-status');
      send_json($st ?: 502, $d ?: ['error' => 'Bot injoignable.']);
    }
    // 🎫 Tickets de bannissement du QG (lecture : staff).
    if ($a === 'qg-tickets' && $_SERVER['REQUEST_METHOD'] === 'GET') {
      if (empty($role['staff'])) send_json(403, ['error' => 'Réservé au staff du bot.']);
      if (DEMO) send_json(200, demo_qg_tickets());
      [$st, $d] = first_bot_api('/qg-tickets');
      send_json($st ?: 502, $d ?: ['error' => 'Bot injoignable.']);
    }
    // 🗂️ Base de données : historique des blacklists (recherche via ?q=).
    if ($a === 'blacklist-historique' && $_SERVER['REQUEST_METHOD'] === 'GET') {
      if (empty($role['staff'])) send_json(403, ['error' => 'Réservé au staff du bot.']);
      $q = trim((string) ($_GET['q'] ?? ''));
      if (DEMO) send_json(200, demo_historique());
      [$st, $d] = first_bot_api('/blacklist-historique' . ($q !== '' ? '?q=' . rawurlencode($q) : ''));
      send_json($st ?: 502, $d ?: ['error' => 'Bot injoignable.']);
    }
    // 🖼️ Preuves : messages récupérés du salon preuves (recherche via ?q=).
    if ($a === 'preuves' && $_SERVER['REQUEST_METHOD'] === 'GET') {
      if (empty($role['staff'])) send_json(403, ['error' => 'Réservé au staff du bot.']);
      $q = trim((string) ($_GET['q'] ?? ''));
      if (DEMO) send_json(200, demo_preuves());
      [$st, $d] = first_bot_api('/preuves' . ($q !== '' ? '?q=' . rawurlencode($q) : ''));
      send_json($st ?: 502, $d ?: ['error' => 'Bot injoignable.']);
    }

    // Écritures : le bot revérifie la permission via actorId.
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
      if (empty($role['staff'])) send_json(403, ['error' => 'Réservé au staff du bot.']);
      $post['actorId'] = $uid;
      if (DEMO) send_json(200, ['ok' => true, 'note' => 'Démo — action simulée']);
      $map = [
        'blacklist-ajouter' => '/blacklist-ajouter', 'blacklist-retirer' => '/blacklist-retirer',
        'botstaff-ajouter' => '/botstaff-ajouter', 'botstaff-retirer' => '/botstaff-retirer',
        'botstaff-perm' => '/botstaff-perm', 'botstaff-grade' => '/botstaff-grade', 'botstaff-grade-suppr' => '/botstaff-grade-suppr',
        'qg-claim' => '/qg-claim', 'qg-invite' => '/qg-invite', 'qg-traiter' => '/qg-traiter',
      ];
      if (isset($map[$a])) {
        [$st, $d] = first_bot_api($map[$a], 'POST', $post);
        send_json($st ?: 502, $d ?: ['error' => 'Bot injoignable.']);
      }
      if ($a === 'dashconfig-save') {
        if (empty($role['creator'])) send_json(403, ['error' => 'Réservé au créateur du bot.']);
        [$st, $d] = first_bot_api('/dashboard-config', 'POST', ['actorId' => $uid, 'config' => $post['config'] ?? []]);
        send_json($st ?: 502, $d ?: ['error' => 'Bot injoignable.']);
      }
      if ($a === 'bot-status-save') {
        if (empty($role['creator'])) send_json(403, ['error' => 'Réservé au créateur du bot.']);
        [$st, $d] = named_bot_api((string) ($post['bot'] ?? ''), '/bot-status', 'POST', ['actorId' => $uid, 'status' => $post['status'] ?? null]);
        send_json($st ?: 502, $d ?: ['error' => 'Bot injoignable.']);
      }
    }
    send_json(404, ['error' => 'Action inconnue.']);
  }

  // api-serveur : &gid=…&a=…
  $gid = $_GET['gid'] ?? '';
  $a = $_GET['a'] ?? '';
  if (!preg_match('/^\d{5,25}$/', $gid)) send_json(400, ['error' => 'Serveur invalide.']);
  if (!manages_guild($gid)) send_json(403, ['error' => 'Vous n\'administrez pas ce serveur.']);

  // 🧪 Démo : données fictives et écritures acceptées sans effet.
  if (DEMO) {
    if ($a === 'apercu') send_json(200, demo_apercu());
    if ($a === 'parametres') send_json(200, demo_parametres());
    if ($_SERVER['REQUEST_METHOD'] === 'POST') send_json(200, ['ok' => true, 'note' => 'Démo — modification simulée (non enregistrée)']);
    send_json(404, ['error' => 'Action inconnue.']);
  }

  if ($a === 'apercu') {
    [$st, $data] = bot_api($gid, "/dashboard?guild=$gid");
    send_json($st ?: 502, $data ?: ['error' => 'Bot injoignable.']);
  }
  if ($a === 'parametres') {
    [$st, $data] = bot_api($gid, "/parametres?guild=$gid");
    send_json($st ?: 502, $data ?: ['error' => 'Bot injoignable.']);
  }
  if ($a === 'config' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_body();
    $key = (string) ($body['key'] ?? '');
    if (!in_array($key, WEB_KEYS, true)) send_json(400, ['error' => "Réglage non modifiable depuis le web : $key"]);
    if ($key === 'rp_enabled') {
      [, $check] = bot_api($gid, "/parametres?guild=$gid");
      if (!empty($check['config']['rp_locked'])) {
        send_json(403, ['error' => '🔒 Réglage verrouillé par l\'administrateur du bot.']);
      }
    }
    [$st, $data] = bot_api($gid, '/config', 'POST', ['guildId' => $gid, 'key' => $key, 'value' => $body['value'] ?? null]);
    send_json($st ?: 502, $data ?: ['error' => 'Bot injoignable.']);
  }
  if (in_array($a, ['tickets-type', 'tickets-type-suppr', 'whitelist-ajouter', 'whitelist-retirer', 'ticket-panneau', 'profil-ajouter', 'profil-suppr'], true) && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_body();
    $body['guildId'] = $gid;
    [$st, $data] = bot_api($gid, "/$a", 'POST', $body);
    send_json($st ?: 502, $data ?: ['error' => 'Bot injoignable.']);
  }
  send_json(404, ['error' => 'Action inconnue.']);
}

// ============================ INTERFACE ============================

$THEME = <<<'CSS'
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --bg:#1e2126; --bg2:#17191d; --panel:#24272d; --panel2:#2b2f36; --border:#33373f; --text:#e8e9ed;
          --muted:#8f919b; --accent:#d8734f; --accent2:#c05f3d; --green:#43b581; --red:#f04747; --blue:#4d9de0; }
  body { font-family:'Segoe UI',system-ui,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; }
  a { color:inherit; text-decoration:none; }
  button { background:var(--panel2); color:var(--text); border:1px solid var(--border); border-radius:8px;
           padding:9px 16px; font-size:13.5px; cursor:pointer; font-family:inherit; }
  button:hover { filter:brightness(1.12); }
  button.accent { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; }
  input, select, textarea { background:#191b1f; border:1px solid var(--border); color:var(--text);
           border-radius:9px; padding:11px 13px; font-size:13.5px; width:100%; font-family:inherit; }
  input:focus, select:focus, textarea:focus { outline:none; border-color:var(--accent); }
  /* ---- barre du haut ---- */
  .nav { display:flex; align-items:center; gap:26px; padding:0 26px; height:64px; background:var(--bg2);
         border-bottom:1px solid var(--border); position:sticky; top:0; z-index:20; }
  .nav .brand { display:flex; align-items:center; gap:10px; font-weight:800; font-size:19px; letter-spacing:.02em; color:var(--accent); }
  .nav .brand .lg { font-size:24px; }
  .nav .links { display:flex; gap:22px; font-size:13px; font-weight:700; letter-spacing:.06em; }
  .nav .links a { color:var(--text); opacity:.85; } .nav .links a:hover { color:var(--accent); opacity:1; }
  .nav .spacer { margin-left:auto; }
  .nav .supportbtn { border:1.5px solid var(--accent); color:var(--accent); background:transparent; border-radius:22px;
                     padding:9px 22px; font-weight:700; letter-spacing:.05em; font-size:12.5px; }
  .nav .me { display:flex; align-items:center; gap:9px; font-weight:600; font-size:14px; }
  .nav .me img { width:36px; height:36px; border-radius:50%; border:2px solid var(--border); }
  /* ---- interrupteurs façon DraftBot ---- */
  .switch { position:relative; width:46px; height:25px; flex-shrink:0; display:inline-block; }
  .switch input { opacity:0; width:0; height:0; }
  .switch .sl { position:absolute; inset:0; background:#3a3e47; border-radius:25px; transition:.18s; cursor:pointer; }
  .switch .sl:before { content:''; position:absolute; width:19px; height:19px; border-radius:50%; background:#fff; top:3px; left:3px; transition:.18s; }
  .switch input:checked + .sl { background:var(--accent); }
  .switch input:checked + .sl:before { transform:translateX(21px); }
  /* ---- disposition application ---- */
  .layout { display:flex; min-height:calc(100vh - 64px); }
  .rail { width:68px; background:var(--bg2); border-right:1px solid var(--border); padding:12px 0; display:flex;
          flex-direction:column; align-items:center; gap:10px; flex-shrink:0; }
  .rail .ric { width:46px; height:46px; border-radius:50%; cursor:pointer; border:2px solid transparent; transition:.15s;
               background:var(--panel2); display:flex; align-items:center; justify-content:center; font-size:19px; overflow:hidden; }
  .rail .ric img { width:100%; height:100%; object-fit:cover; }
  .rail .ric:hover { border-color:var(--muted); border-radius:16px; }
  .rail .ric.on { border-color:var(--accent); }
  .side { width:250px; background:var(--panel); border-right:1px solid var(--border); flex-shrink:0; }
  .side .head { padding:20px 16px; text-align:center; border-bottom:1px solid var(--border); }
  .side .head img, .side .head .noicon { width:76px; height:76px; border-radius:50%; margin-bottom:9px; }
  .side .head .noicon { background:var(--panel2); display:inline-flex; align-items:center; justify-content:center; font-size:30px; }
  .side .head .nm { font-family:'Georgia',serif; font-weight:700; font-size:16px; }
  .side .item { display:flex; align-items:center; gap:10px; padding:11px 16px; font-size:13.5px; color:var(--muted);
                cursor:pointer; border-left:3px solid transparent; }
  .side .item:hover { background:var(--panel2); color:var(--text); }
  .side .item.on { background:var(--panel2); color:var(--text); border-left-color:var(--accent); font-weight:600; }
  .main { flex:1; padding:34px 42px; min-width:0; max-width:1150px; }
  h1.pagetitle { font-size:26px; font-weight:700; margin-bottom:26px; }
  .sec { margin-bottom:34px; }
  .sechead { display:flex; align-items:flex-start; gap:14px; margin-bottom:8px; }
  .sechead .t { font-size:17px; font-weight:700; }
  .sechead .d { color:var(--muted); font-size:13px; margin-top:3px; }
  .sechead .sw { margin-left:auto; }
  .flabel { font-size:11px; letter-spacing:.08em; font-weight:800; color:#b9bac3; text-transform:uppercase; margin:16px 0 7px; }
  .fields { max-width:640px; }
  .cols { display:flex; gap:34px; flex-wrap:wrap; }
  .cols > div { flex:1; min-width:320px; }
  .togline { display:flex; align-items:center; gap:12px; font-size:13.5px; color:var(--muted); margin:14px 0; }
  .count { text-align:right; font-size:11.5px; color:var(--muted); margin-top:3px; }
  .count b { color:var(--accent); font-weight:600; }
  /* ---- prévisualisation Discord ---- */
  .dprev { background:#313338; border-radius:10px; padding:14px 16px; font-size:14px; }
  .dprev .dtop { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .dprev .dtop img { width:38px; height:38px; border-radius:50%; }
  .dprev .dtop .bn { font-weight:600; }
  .dprev .dtop .badge { background:#5865f2; color:#fff; font-size:10px; font-weight:700; border-radius:4px; padding:1px 5px; }
  .dprev .dtop .ts { color:#949ba4; font-size:11.5px; }
  .dprev .dcard { border-left:4px solid var(--accent); background:#2b2d31; border-radius:5px; padding:11px 13px; margin-top:4px; }
  .dprev .dcard .dt { font-weight:700; margin-bottom:5px; }
  .dprev .dcard .dd { color:#dbdee1; font-size:13.5px; line-height:1.55; white-space:pre-wrap; }
  .dprev .dcard .df { color:#949ba4; font-size:11.5px; margin-top:9px; }
  .dprev .mention { background:rgba(88,101,242,.3); color:#c9cdfb; border-radius:3px; padding:0 3px; }
  /* ---- tuiles / lignes ---- */
  .tiles { display:grid; grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); gap:13px; margin:18px 0; }
  .tile { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:16px; }
  .tile .tv { font-size:23px; font-weight:800; color:var(--accent); }
  .tile .tl { color:var(--muted); font-size:12px; margin-top:4px; }
  .row { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:11px 15px;
         margin-bottom:8px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:13.5px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:15px; }
  .scard { background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:19px;
           display:flex; align-items:center; gap:14px; cursor:pointer; transition:.15s; }
  .scard:hover { border-color:var(--accent); transform:translateY(-2px); }
  .scard img, .scard .noicon { width:54px; height:54px; border-radius:50%; }
  .scard .noicon { background:var(--panel2); display:flex; align-items:center; justify-content:center; font-size:22px; }
  .toast { position:fixed; bottom:24px; right:24px; background:var(--panel2); border:1px solid var(--accent);
           border-radius:10px; padding:13px 18px; font-size:13.5px; opacity:0; transform:translateY(10px);
           transition:opacity .22s, transform .22s; z-index:60; box-shadow:0 10px 30px rgba(0,0,0,.35); pointer-events:none; }
  .toast.on { opacity:1; transform:translateY(0); }
  .toast.ok { border-color:var(--green); }
  .toast.err { border-color:var(--red); }
  .empty { color:var(--muted); padding:48px; text-align:center; }
  .wrap { max-width:1100px; margin:0 auto; padding:30px 20px; }
  /* ---- onglets (espace staff) ---- */
  .tabbar { display:flex; gap:4px; border-bottom:1px solid var(--border); margin:16px 0 22px; flex-wrap:wrap; }
  .tab { padding:10px 18px; font-size:13.5px; color:var(--muted); cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; }
  .tab:hover { color:var(--text); }
  .tab.on { color:var(--accent); border-bottom-color:var(--accent); font-weight:600; }
  .chip { background:#101114; border:1px solid var(--border); border-radius:14px; padding:4px 11px; font-size:12.5px;
          display:inline-flex; gap:6px; align-items:center; }
  .chip button { padding:0 5px; font-size:11px; background:transparent; border:0; color:var(--muted); }
  /* ---- bouton flottant Créateur (en bas à gauche) ---- */
  .cfab { position:fixed; bottom:22px; left:22px; width:52px; height:52px; border-radius:50%; background:var(--accent);
          color:#fff; font-size:24px; display:flex; align-items:center; justify-content:center; cursor:pointer;
          box-shadow:0 8px 26px rgba(0,0,0,.4); z-index:40; transition:transform .15s; }
  .cfab:hover { transform:scale(1.08); }
  /* ---- barre de défilement raffinée ---- */
  ::-webkit-scrollbar { width:10px; height:10px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:#3a3e47; border-radius:6px; border:2px solid var(--bg); }
  ::-webkit-scrollbar-thumb:hover { background:#4a4f59; }
  * { scrollbar-width:thin; scrollbar-color:#3a3e47 transparent; }
  :focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
  /* ---- chargement (spinner) ---- */
  .spin { width:34px; height:34px; border:3px solid var(--border); border-top-color:var(--accent);
          border-radius:50%; animation:spin .7s linear infinite; margin:44px auto; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .loadbox { display:flex; flex-direction:column; align-items:center; gap:12px; padding:40px; color:var(--muted); font-size:13.5px; }
  /* ---- pastille de statut (bot en ligne) ---- */
  .dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; display:inline-block; }
  .dot.up { background:var(--green); box-shadow:0 0 7px rgba(67,181,129,.8); }
  .dot.down { background:var(--red); }
  .rail .ric { position:relative; }
  .rail .ric .st { position:absolute; bottom:-1px; right:-1px; width:13px; height:13px; border-radius:50%; border:2.5px solid var(--bg2); }
  .rail .ric .st.up { background:var(--green); } .rail .ric .st.down { background:var(--red); }
  .side .head .stline { display:flex; align-items:center; justify-content:center; gap:6px; color:var(--muted); font-size:12px; margin-top:5px; }
  /* ---- transition d'apparition des pages ---- */
  .fade { animation:fade .25s ease; }
  @keyframes fade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
  /* ---- écran d'erreur avec réessai ---- */
  .errbox { text-align:center; padding:52px 20px; color:var(--muted); }
  .errbox .ei { font-size:44px; margin-bottom:12px; }
  .errbox .em { font-size:15px; margin-bottom:18px; max-width:440px; margin-left:auto; margin-right:auto; line-height:1.55; }
  /* ---- menu mobile (masqué en bureau) ---- */
  .burger { display:none; background:transparent; border:0; font-size:22px; padding:4px 8px; cursor:pointer; color:var(--text); }
  @media (max-width:860px) {
    html, body { overflow-x:hidden; }
    .nav { gap:10px; padding:0 12px; }
    .nav .links, .nav .me span, .nav .supportbtn { display:none; }
    .nav .brand { font-size:16px; }
    .nav button { padding:8px 12px; font-size:12.5px; }
    .burger { display:block; }
    .wrap { padding:22px 14px; }
    .grid { grid-template-columns:1fr; }
    .layout { flex-direction:column; }
    .rail { width:100%; flex-direction:row; overflow-x:auto; padding:10px; border-right:0; border-bottom:1px solid var(--border); }
    .side { width:100%; border-right:0; border-bottom:1px solid var(--border); display:none; }
    .side.open { display:block; }
    .side .head { padding:14px; }
    .side .head img, .side .head .noicon { width:54px; height:54px; }
    .main { padding:20px 16px; max-width:100%; }
    .cols { gap:20px; }
    .cols > div { min-width:100%; }
    h1.pagetitle { font-size:22px; margin-bottom:18px; }
  }
CSS;

$navLinks = '<span class="links"><a href="' . htmlspecialchars($URL_DOCS) . '" target="_blank">DOCUMENTATION</a></span>';
$navSupport = $URL_SUPPORT !== '' ? '<a href="' . htmlspecialchars($URL_SUPPORT) . '" target="_blank"><button class="supportbtn">SUPPORT</button></a>' : '';
$NOM_HTML = htmlspecialchars($NOM_BOT);

if (empty($_SESSION['user'])) {
  header('Content-Type: text/html; charset=utf-8');
  echo <<<HTML
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>$NOM_HTML — Dashboard</title>
<style>$THEME
  .hero { position:relative; min-height:calc(100vh - 64px); display:flex; flex-direction:column; align-items:center;
          justify-content:center; text-align:center; padding:20px 20px 150px; overflow:hidden; background:var(--bg); }
  .star { position:absolute; background:#fff; border-radius:50%; opacity:.5; animation:tw 3s infinite; }
  @keyframes tw { 0%,100% { opacity:.15; } 50% { opacity:.7; } }
  .biglogo { font-size:96px; margin-bottom:18px; filter:drop-shadow(0 6px 24px rgba(216,115,79,.35)); }
  .hero .pre { color:var(--muted); font-size:21px; }
  .hero .word { color:var(--accent); font-size:32px; font-weight:700; min-height:44px; margin-bottom:26px; transition:opacity .3s; }
  .addbtn { background:var(--accent); border:0; color:#fff; font-size:15.5px; font-weight:600; padding:14px 28px; border-radius:9px; }
  .connectbtn { margin-top:14px; background:transparent; border:1.5px solid var(--border); color:var(--muted); border-radius:9px; }
  .wave { position:absolute; bottom:-4px; left:0; right:0; pointer-events:none; }
</style>
</head>
<body>
<div class="nav">
  <span class="brand"><span class="lg">🎛️</span>$NOM_HTML</span>
  $navLinks
  <span class="spacer"></span>
  $navSupport
  <a href="index.php?p=login"><button class="accent">Se connecter</button></a>
</div>
<div class="hero" id="hero">
  <div class="biglogo">🎛️</div>
  <div class="pre">Un bot pour</div>
  <div class="word" id="word">Le Roleplay</div>
  <a href="index.php?p=inviter"><button class="addbtn">🎮 Ajouter à Discord</button></a>
  <a href="index.php?p=login"><button class="connectbtn">🔗 Se connecter avec Discord pour gérer vos serveurs</button></a>
  <a href="index.php?p=diag" style="margin-top:16px;color:var(--muted);font-size:12.5px">🔧 Vérifier ma configuration</a>
  <svg class="wave" viewBox="0 0 1440 180" preserveAspectRatio="none" height="150">
    <path fill="#d8734f" d="M0,96 C240,150 480,40 720,80 C960,120 1200,150 1440,90 L1440,180 L0,180 Z" opacity=".9"/>
    <path fill="#2b2f36" d="M0,130 C260,170 520,80 760,110 C1000,140 1240,170 1440,120 L1440,180 L0,180 Z"/>
  </svg>
</div>
<script>
var hero = document.getElementById('hero');
for (var i = 0; i < 90; i++) {
  var s = document.createElement('div');
  s.className = 'star';
  var size = Math.random() * 2.4 + 1;
  s.style.width = size + 'px'; s.style.height = size + 'px';
  s.style.left = Math.random() * 100 + '%'; s.style.top = Math.random() * 82 + '%';
  s.style.animationDelay = (Math.random() * 3) + 's';
  hero.appendChild(s);
}
var mots = ['Le Roleplay', 'La Modération', 'Les Niveaux', 'Les Tickets', 'La Communauté'];
var wi = 0, w = document.getElementById('word');
setInterval(function(){
  w.style.opacity = 0;
  setTimeout(function(){ wi = (wi + 1) % mots.length; w.textContent = mots[wi]; w.style.opacity = 1; }, 300);
}, 2600);
</script>
</body>
</html>
HTML;
  exit;
}

header('Content-Type: text/html; charset=utf-8');
echo <<<HTML
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>$NOM_HTML — Dashboard</title>
<style>$THEME</style>
</head>
<body>
<div class="nav">
  <span class="brand" style="cursor:pointer" onclick="renderHome()"><span class="lg">🎛️</span>$NOM_HTML</span>
  $navLinks
  <span class="spacer"></span>
  $navSupport
  <span class="me"><img id="h_avatar" style="display:none"><span id="h_name"></span></span>
  <a href="index.php?p=logout"><button>Déconnexion</button></a>
</div>
<div id="content"><div class="loadbox"><div class="spin"></div>Chargement…</div></div>
<div id="toast" class="toast"></div>
HTML;
echo <<<'SCRIPT'
<script>
var moi = null, gid = null, page = 'apercu';
function $(id){ return document.getElementById(id); }
function esc(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
var toastTimer;
function toast(msg, kind){ var t = $('toast'); t.textContent = msg; t.className = 'toast on ' + (kind || ''); clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.className = 'toast ' + (kind || ''); }, 3200); }
function su(a){ return 'index.php?p=api-serveur&gid=' + gid + '&a=' + a; }
function spinner(){ return '<div class="loadbox"><div class="spin"></div>Chargement…</div>'; }
function errScreen(msg, retry){
  var h = '<div class="errbox fade"><div class="ei">😕</div><div class="em">' + esc(msg) + '</div>';
  if (retry) h += '<button class="accent" id="retrybtn">↻ Réessayer</button>';
  h += '</div>';
  return h;
}
function api(method, path, body){
  return fetch(path, { method: method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) })
    .then(function(r){ return r.json(); })
    .then(function(j){ if (j && j.error) toast('⚠️ ' + j.error, 'err'); return j; })
    .catch(function(){ toast('⚠️ Connexion au serveur impossible.', 'err'); return { error: 'réseau' }; });
}
function save(key, value){
  api('POST', su('config'), { key: key, value: value }).then(function(j){ if (j && !j.error) toast('✅ Enregistré', 'ok'); });
}
// Interrupteur façon DraftBot.
function tog(id, checked){
  return '<label class="switch"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><span class="sl"></span></label>';
}

var ROLE = { creator: false, staff: false, perms: [] };
var DASH = { nom: 'Mon Bot', accent: '#d8734f', modules: {} };
var TK = null; // paramètres tickets (raisons, profils) pour la prévisualisation
function canPerm(p){ return ROLE.creator || (ROLE.perms || []).indexOf(p) >= 0; }

// ----- Accueil : grille des serveurs -----
function renderHome(){
  gid = null;
  var h = '<div class="wrap"><h1 class="pagetitle">Mes serveurs</h1>';
  if (!moi.servers.length) h += '<div class="empty">Aucun serveur — invitez le bot sur votre serveur (bouton « Ajouter à Discord » de la page d\'accueil), puis rechargez.</div>';
  h += '<div class="grid">';
  moi.servers.forEach(function(s){
    h += '<div class="scard" data-g="' + s.id + '">' +
      (s.icon ? '<img src="' + s.icon + '">' : '<div class="noicon">🌐</div>') +
      '<div><div style="font-weight:700">' + esc(s.name) + '</div>' +
      '<div style="color:var(--muted);font-size:12px">' + (s.membres ? s.membres + ' membres · ' : '') + '🤖 ' + esc(s.bot) + '</div></div></div>';
  });
  h += '</div>';
  // Accès Staff / Créateur (réservés à l'équipe du bot)
  if (ROLE.staff || ROLE.creator){
    h += '<h1 class="pagetitle" style="margin-top:34px">Espace équipe du bot</h1><div class="grid">';
    if (ROLE.staff) h += '<div class="scard" id="go-staff"><div class="noicon">🛡️</div><div><div style="font-weight:700">Staff du bot</div><div style="color:var(--muted);font-size:12px">Blacklist · Équipe du bot</div></div></div>';
    if (ROLE.creator) h += '<div class="scard" id="go-createur"><div class="noicon">⚙️</div><div><div style="font-weight:700">Créateur</div><div style="color:var(--muted);font-size:12px">Configurer le dashboard</div></div></div>';
    h += '</div>';
  }
  h += '</div>';
  $('content').innerHTML = h;
  Array.prototype.forEach.call(document.querySelectorAll('.scard[data-g]'), function(el){
    el.onclick = function(){ gid = el.getAttribute('data-g'); page = 'apercu'; renderServer(); };
  });
  if ($('go-staff')) $('go-staff').onclick = function(){ renderStaff('blacklist'); };
  if ($('go-createur')) $('go-createur').onclick = renderCreateur;
  // Bouton flottant « Créateur » en bas à gauche (créateur uniquement).
  var old = $('cfab'); if (old) old.remove();
  if (ROLE.creator){
    var fab = document.createElement('div');
    fab.id = 'cfab'; fab.className = 'cfab'; fab.title = 'Espace Créateur';
    fab.innerHTML = '⚙️'; fab.onclick = renderCreateur;
    document.body.appendChild(fab);
  }
}

// ----- Vue serveur : rail d'icônes + sidebar + page -----
var ALL_PAGES = [
  ['apercu', '📊', 'Vue d\'ensemble'],
  ['module', '🎭', 'Module RP'],
  ['membres', '👋', 'Arrivées et départs'],
  ['roles', '👮', 'Rôles & sécurité'],
  ['salons', '📢', 'Salons & logs'],
  ['niveaux', '📈', 'Niveaux'],
  ['whitelist', '📋', 'Whitelist métiers'],
  ['tickets', '🎫', 'Tickets']
];
// Seules les pages dont le module est activé par le créateur s'affichent.
function pagesActives(){
  return ALL_PAGES.filter(function(p){ return p[0] === 'apercu' || DASH.modules[p[0]] !== false; });
}
var PAGES = ALL_PAGES;
function renderServer(){
  var srv = null;
  moi.servers.forEach(function(s){ if (s.id === gid) srv = s; });
  var h = '<div class="layout">';
  // rail : tous mes serveurs en icônes rondes (pastille verte = bot en ligne)
  h += '<button class="burger" id="burger" style="margin:8px">☰ ' + esc(srv ? srv.name : '') + '</button>';
  h += '<div class="rail">';
  moi.servers.forEach(function(s){
    h += '<div class="ric' + (s.id === gid ? ' on' : '') + '" data-g="' + s.id + '" title="' + esc(s.name) + '">' +
      (s.icon ? '<img src="' + s.icon + '">' : '🌐') +
      '<span class="st ' + (s.enligne === false ? 'down' : 'up') + '"></span></div>';
  });
  h += '</div>';
  // sidebar : serveur + statut + catégories
  h += '<div class="side" id="side"><div class="head">' +
    (srv && srv.icon ? '<img src="' + srv.icon + '">' : '<div class="noicon">🌐</div>') +
    '<div class="nm">' + esc(srv ? srv.name : '') + '</div>' +
    '<div class="stline"><span class="dot ' + (srv && srv.enligne === false ? 'down' : 'up') + '"></span>' +
    (srv && srv.enligne === false ? 'Bot hors ligne' : 'Bot en ligne') + '</div></div>';
  var pages = pagesActives();
  if (!pages.some(function(p){ return p[0] === page; })) page = 'apercu';
  pages.forEach(function(pg){
    h += '<div class="item' + (pg[0] === page ? ' on' : '') + '" data-p="' + pg[0] + '"><span>' + pg[1] + '</span> ' + pg[2] + '</div>';
  });
  h += '<div class="item" id="side-home">⬅ Mes serveurs</div>';
  h += '</div><div class="main" id="main">' + spinner() + '</div></div>';
  $('content').innerHTML = h;
  if ($('burger')) $('burger').onclick = function(){ $('side').classList.toggle('open'); };
  Array.prototype.forEach.call(document.querySelectorAll('.rail .ric'), function(el){
    el.onclick = function(){ gid = el.getAttribute('data-g'); page = 'apercu'; renderServer(); };
  });
  Array.prototype.forEach.call(document.querySelectorAll('.side .item[data-p]'), function(el){
    el.onclick = function(){ page = el.getAttribute('data-p'); if ($('side')) $('side').classList.remove('open'); renderServer(); };
  });
  if ($('side-home')) $('side-home').onclick = renderHome;
  loadPage(srv);
}

// ----- Aides de mise en page façon DraftBot -----
function sec(title, desc, inner, togHtml){
  return '<div class="sec"><div class="sechead"><div><div class="t">' + title + '</div>' +
    (desc ? '<div class="d">' + desc + '</div>' : '') + '</div>' +
    (togHtml ? '<div class="sw">' + togHtml + '</div>' : '') + '</div>' + inner + '</div>';
}
function fsel(key, label, list, current, prefix){
  var h = '<div class="flabel">' + label + '</div>';
  h += '<select class="wsave" data-k="' + key + '"><option value="">— Désactivé —</option>';
  list.forEach(function(x){ h += '<option value="' + x.id + '"' + (x.id === current ? ' selected' : '') + '>' + (prefix || '') + esc(x.name) + '</option>'; });
  h += '</select>';
  return h;
}
function fmulti(key, label, list, currentJson){
  var current = [];
  try { current = JSON.parse(currentJson || '[]'); } catch (e) {}
  var h = '<div class="flabel">' + label + '</div>';
  h += '<select multiple size="6" class="wmulti" data-k="' + key + '" style="height:auto">';
  list.forEach(function(x){ h += '<option value="' + x.id + '"' + (current.indexOf(x.id) >= 0 ? ' selected' : '') + '>@' + esc(x.name) + '</option>'; });
  h += '</select><br><button class="wmultisave accent" data-k="' + key + '" style="margin-top:9px">💾 Enregistrer la sélection</button>';
  return h;
}
function fnum(key, label, value, min, max){
  return '<div class="flabel">' + label + '</div>' +
    '<div style="display:flex;gap:8px"><input type="number" class="wnum" data-k="' + key + '" value="' + value + '" min="' + min + '" max="' + max + '" style="width:140px">' +
    '<button class="wnumsave" data-k="' + key + '">💾</button></div>';
}

// Prévisualisation Discord du message de bienvenue (variables + gras).
function prevBienvenue(srv){
  var raw = $('w_wel') ? ($('w_wel').value || '') : '';
  if (!raw.trim()) raw = 'Bienvenue à {user} sur **{server}** ! 🎉';
  var txt = esc(raw)
    .replace(/\{user\.username\}/g, moi.user.username)
    .replace(/\{user\.mention\}|\{user\}/g, '<span class="mention">@' + esc(moi.user.username) + '</span>')
    .replace(/\{server\}/g, esc(srv ? srv.name : 'Mon Serveur'))
    .replace(/\{membercount\}/g, srv && srv.membres ? srv.membres : '128')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>');
  var mention = $('w_mention') && $('w_mention').checked ? '<div style="margin-bottom:5px"><span class="mention">@' + esc(moi.user.username) + '</span></div>' : '';
  $('w_pv').innerHTML =
    '<div class="dprev"><div class="dtop"><img src="' + (srv && srv.icon ? srv.icon : 'https://cdn.discordapp.com/embed/avatars/1.png') + '">' +
    '<span class="bn">' + esc(srv ? srv.bot : 'Bot') + '</span><span class="badge">✔ APP</span><span class="ts">Aujourd\'hui</span></div>' +
    mention +
    '<div class="dcard"><div class="dt">📥 Arrivée d\'un membre</div><div class="dd">' + txt + '</div>' +
    '<div class="df">💬 ' + esc(moi.user.username) + ' · 👥 Membre n°' + (srv && srv.membres ? srv.membres : '128') + ' · 📅 Compte créé le 12/01/2023</div></div></div>';
}

function loadPage(srv){
  var m = $('main');
  m.innerHTML = spinner();
  if (page === 'apercu'){
    api('GET', su('apercu')).then(function(d){
      if (d.error) { m.innerHTML = errScreen('Impossible de charger ce serveur : ' + d.error, true); if ($('retrybtn')) $('retrybtn').onclick = function(){ loadPage(srv); }; return; }
      var h = '<div class="fade"><h1 class="pagetitle">' + esc(d.serveur.name) + '</h1>' +
        '<p style="color:var(--muted);margin:-18px 0 8px">' + d.serveur.membres + ' membres · géré par 🤖 ' + esc(srv ? srv.bot : '') + '</p>';
      var labels = { cartes: "🪪 Cartes d'identité", permis: '🚗 Permis', entreprises: '🏢 Entreprises', ticketsOuverts: '🎫 Tickets ouverts', whitelist: '📋 Whitelist métiers', vehicules: '🛡️ Véhicules assurés' };
      h += '<div class="tiles">';
      Object.keys(labels).forEach(function(k){ h += '<div class="tile"><div class="tv">' + (d.stats[k] || 0) + '</div><div class="tl">' + labels[k] + '</div></div>'; });
      h += '</div>';
      if (d.top && d.top.length){
        h += '<div class="flabel">🏆 Top niveaux (écrit)</div>';
        d.top.forEach(function(t, i){ h += '<div class="row">' + (i + 1) + '. <b>' + esc(t.user) + '</b> — niveau ' + t.level + ' (' + t.xp + ' XP)</div>'; });
      }
      m.innerHTML = h + '</div>';
    });
    return;
  }
  api('GET', su('parametres')).then(function(p){
    if (p.error) { m.innerHTML = errScreen('Impossible de charger la configuration : ' + p.error, true); if ($('retrybtn')) $('retrybtn').onclick = function(){ loadPage(srv); }; return; }
    var cfg = p.config, h = '<div class="fade">';
    if (page === 'module'){
      h += '<h1 class="pagetitle">Module RP</h1>';
      if (cfg.rp_locked){
        h += sec('Module RP 🔒', 'Réglage verrouillé par l\'administrateur du bot — modifiable uniquement depuis son gestionnaire.',
          '<div class="row">État actuel : ' + (cfg.rp_enabled ? '🟢 <b>Activé</b>' : '🔴 <b>Désactivé</b>') + '</div>', '');
      } else {
        h += sec('Module RP', 'Cartes d\'identité, permis, entreprises, assurances, service et temps. Désactivé, ces commandes sont retirées de la liste du serveur.',
          '<div class="togline">Activer le Module RP sur ce serveur</div>', tog('w_rp', cfg.rp_enabled));
      }
    } else if (page === 'membres'){
      h += '<h1 class="pagetitle">Arrivées et Départs</h1>';
      var inner = '<div class="cols"><div class="fields">';
      inner += fsel('member_channel_id', 'Salon des messages de bienvenue', p.channels, cfg.member_channel_id, '# ');
      inner += '<div class="flabel">Message personnalisé</div>';
      inner += '<textarea id="w_wel" rows="6">' + esc(cfg.welcome_message || '') + '</textarea>';
      inner += '<div class="count"><b id="w_count">' + (cfg.welcome_message || '').length + '</b> /1500 — variables : {user} {user.username} {server} {membercount}</div>';
      inner += '<button id="w_savew" class="accent" style="margin-top:8px">💾 Enregistrer le message</button>';
      inner += '<div class="togline">' + tog('w_mention', cfg.welcome_mention) + ' Mentionner le membre dans le message de bienvenue.</div>';
      inner += '</div><div><div class="flabel">Prévisualisation</div><div id="w_pv"></div></div></div>';
      h += sec('Message de Bienvenue', 'Configurez des messages de bienvenue pour les nouveaux membres.', inner, '');
      var bye = '<div class="fields"><div class="flabel">Message personnalisé</div>' +
        '<textarea id="w_bye" rows="4">' + esc(cfg.goodbye_message || '') + '</textarea>' +
        '<div class="count">variables : {user.username} {server} {membercount}</div>' +
        '<button id="w_saveb" class="accent" style="margin-top:8px">💾 Enregistrer le message</button></div>';
      h += sec('Message d\'Au Revoir', 'Configurez des messages d\'au revoir pour les anciens membres (même salon).', bye, '');
    } else if (page === 'roles'){
      h += '<h1 class="pagetitle">Rôles & sécurité</h1>';
      h += sec('Rôles Staff', 'Grade 2 — accès aux commandes staff : cartes, permis, modération, tickets… Plusieurs rôles possibles (Ctrl+clic).',
        '<div class="fields">' + fmulti('staff_role_ids', 'Rôles staff', p.roles, cfg.staff_role_ids || (cfg.staff_role_id ? JSON.stringify([cfg.staff_role_id]) : null)) + '</div>', '');
      h += sec('Rôles Administration', 'Grade 3 — accès aux réglages sensibles et /banglobal.',
        '<div class="fields">' + fmulti('admin_role_ids', 'Rôles administration', p.roles, cfg.admin_role_ids || (cfg.admin_role_id ? JSON.stringify([cfg.admin_role_id]) : null)) + '</div>', '');
      h += sec('Rôle « En service »', 'Ajouté et retiré automatiquement par /service.',
        '<div class="fields">' + fsel('service_role_id', 'Rôle en service', p.roles, cfg.service_role_id, '@ ') + '</div>', '');
    } else if (page === 'salons'){
      h += '<h1 class="pagetitle">Salons & logs</h1>';
      h += sec('Journal de sécurité', 'Actions staff, messages supprimés/modifiés, vocal, transcripts de tickets.',
        '<div class="fields">' + fsel('log_channel_id', 'Salon des logs', p.channels, cfg.log_channel_id, '# ') + '</div>', '');
      h += sec('Annonces du staff', 'Arrivées et départs de poste (/arrivee, /depart) et services RP.',
        '<div class="fields">' + fsel('staff_channel_id', 'Salon staff', p.channels, cfg.staff_channel_id, '# ') +
        fsel('service_channel_id', 'Salon des services RP', p.channels, cfg.service_channel_id, '# ') + '</div>', '');
      h += sec('Mises à jour du bot', 'Annonces « mise à jour prête / installée » avec mention du staff. Sans salon : #shadow-logs est créé automatiquement (visible du staff uniquement).',
        '<div class="fields">' + fsel('update_channel_id', 'Salon des annonces de mise à jour', p.channels, cfg.update_channel_id, '# ') + '</div>', '');
      h += sec('🖼️ Salon des preuves', 'Salon du Discord principal où le staff poste les preuves. Le bot y récupère automatiquement chaque message (auteur, texte, pièces jointes) pour la base de données du staff.',
        '<div class="fields">' + fsel('proof_channel_id', 'Salon des preuves', p.channels, cfg.proof_channel_id, '# ') + '</div>', '');
    } else if (page === 'niveaux'){
      h += '<h1 class="pagetitle">Niveaux</h1>';
      h += sec('Annonces de niveau', 'Salon où le bot annonce les montées de niveau (écrit et vocal).',
        '<div class="fields">' + fsel('level_channel_id', 'Salon des annonces', p.channels, cfg.level_channel_id, '# ') + '</div>', '');
      h += sec('Gains d\'XP', 'Réglez la vitesse de progression de vos membres.',
        '<div class="fields">' + fnum('xp_text', 'XP par message', cfg.xp_text, 1, 1000) +
        fnum('xp_voice', 'XP par minute en vocal', cfg.xp_voice, 1, 1000) +
        fnum('xp_cooldown', 'Cooldown XP texte (secondes)', cfg.xp_cooldown, 5, 3600) + '</div>', '');
    } else if (page === 'whitelist'){
      h += '<h1 class="pagetitle">Whitelist métiers</h1>';
      var wl = '';
      p.whitelist.forEach(function(w){
        wl += '<div class="row">👮 <b>@' + esc(w.role) + '</b> — géré par @' + esc(w.manager) +
          '<button class="wl-del" data-r="' + w.roleId + '" data-m="' + w.managerId + '" style="margin-left:auto;padding:4px 11px;font-size:12px">🗑</button></div>';
      });
      if (!p.whitelist.length) wl += '<div class="row" style="color:var(--muted)"><i>Aucune autorisation configurée.</i></div>';
      h += sec('Autorisations des gérants', 'Un gérant peut whitelister des recrues sur son rôle métier — le bot attribue le rôle automatiquement.', wl, '');
      var add = '<div class="fields" style="display:flex;gap:9px;flex-wrap:wrap;align-items:flex-end">' +
        '<div style="flex:1;min-width:190px">' + fsel2('ww_role', 'Rôle métier', p.roles) + '</div>' +
        '<div style="flex:1;min-width:190px">' + fsel2('ww_mgr', 'Rôle gérant', p.roles) + '</div>' +
        '<button id="ww_add" class="accent">➕ Ajouter</button></div>';
      h += sec('Nouvelle autorisation', '', add, '');
    } else if (page === 'tickets'){
      TK = p; // mémorise pour la prévisualisation en direct
      h += '<h1 class="pagetitle">Tickets</h1>';
      // ---- Éditeur du panneau : message + embed + profil + salon + preview ----
      var profOpts = (p.profils || []).map(function(pr){ return '<option value="' + pr.id + '">' + esc(pr.name) + '</option>'; }).join('');
      var editor = '<div class="cols"><div class="fields">' +
        '<div class="flabel">Mode d\'ouverture</div><select id="tp_ouv"><option value="menu">📋 Menu déroulant (sélecteur de raison)</option><option value="boutons">🔘 Boutons</option></select>' +
        '<div class="flabel" style="margin-top:12px">Profil d\'envoi (nom + avatar du bot pour ce message)</div>' +
        '<select id="tp_prof"><option value="">— Le bot lui-même —</option>' + profOpts + '</select>' +
        '<div class="flabel" style="margin-top:12px">Message (au-dessus de l\'embed)</div><input id="tp_msg" placeholder="🎫 Besoin d\'aide ?">' +
        '<div class="flabel" style="margin-top:12px">— Embed (laissez vide pour un simple message) —</div>' +
        '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:6px 0">' + tog('tp_embed', true) + ' Utiliser un embed</label>' +
        '<div class="flabel">Titre</div><input id="tp_titre" value="Ouvrir un ticket">' +
        '<div class="flabel" style="margin-top:10px">Description</div><textarea id="tp_desc" rows="3">Choisissez une raison pour contacter le staff.</textarea>' +
        '<div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:10px">' +
        '<div><div class="flabel">Couleur</div><input id="tp_col" type="color" value="#d8734f" style="width:64px;height:36px;padding:2px"></div>' +
        '<div style="flex:1;min-width:180px"><div class="flabel">Auteur (haut de l\'embed)</div><input id="tp_auteur"></div></div>' +
        '<div class="flabel" style="margin-top:10px">Grande image (URL)</div><input id="tp_img">' +
        '<div class="flabel" style="margin-top:10px">Miniature (URL)</div><input id="tp_thumb">' +
        '<div class="flabel" style="margin-top:10px">Pied de page</div><input id="tp_footer">' +
        '<div class="flabel" style="margin-top:14px">Publier dans le salon</div>' + fsel3b('tp_salon', p.channels) +
        '<button id="tp_pub" class="accent" style="margin-top:12px">📤 Publier le panneau</button>' +
        '</div><div style="flex:1;min-width:320px"><div class="flabel">Prévisualisation en direct</div><div id="tp_pv"></div></div></div>';
      h += sec('🎨 Éditeur du panneau', 'Écrivez le message, créez l\'embed, choisissez un profil d\'envoi et publiez — comme sur Ticket Tool.', editor, '');
      // ---- Profils d'envoi ----
      var pf = '';
      (p.profils || []).forEach(function(pr){
        pf += '<div class="row">' + (pr.avatar ? '<img src="' + esc(pr.avatar) + '" style="width:26px;height:26px;border-radius:50%">' : '👤') + ' <b>' + esc(pr.name) + '</b>' +
          '<button class="pf-del" data-id="' + pr.id + '" style="margin-left:auto;padding:4px 11px;font-size:12px">🗑</button></div>';
      });
      if (!(p.profils || []).length) pf += '<div class="row" style="color:var(--muted)"><i>Aucun profil — le bot envoie sous son propre nom.</i></div>';
      pf += '<div class="fields" style="display:flex;gap:9px;flex-wrap:wrap;align-items:flex-end;margin-top:8px">' +
        '<div style="min-width:170px"><div class="flabel">Nom du profil</div><input id="pf_nom" placeholder="Support Colmar RP"></div>' +
        '<div style="flex:1;min-width:220px"><div class="flabel">URL de l\'avatar</div><input id="pf_ava" placeholder="https://…/avatar.png"></div>' +
        '<button id="pf_add" class="accent">➕ Créer le profil</button></div>';
      h += sec('👤 Profils d\'envoi', 'Nom + avatar personnalisés : le bot enverra le panneau sous cette identité (via un webhook).', pf, '');
      // ---- Raisons ----
      var tk = '';
      p.tickets.forEach(function(t){
        tk += '<div class="row">' + (t.emoji ? esc(t.emoji) + ' ' : '') + '<b>' + esc(t.label) + '</b>' + (t.description ? ' <span style="color:var(--muted)">— ' + esc(t.description) + '</span>' : '') +
          '<span style="color:var(--muted);font-size:12px">📁 ' + esc(t.categorie) + (t.support ? ' · 🛎️ @' + esc(t.support) : '') + '</span>' +
          '<button class="tk-del" data-id="' + t.id + '" style="margin-left:auto;padding:4px 11px;font-size:12px">🗑</button></div>';
      });
      if (!p.tickets.length) tk += '<div class="row" style="color:var(--muted)"><i>Aucune raison de ticket.</i></div>';
      h += sec('Raisons de tickets', 'Chaque raison a sa <b>propre catégorie</b> Discord : un ticket ouvert avec cette raison sera créé dedans.', tk, '');
      var addt = '<div class="fields">' +
        '<div style="display:flex;gap:9px;flex-wrap:wrap;align-items:flex-end">' +
        '<div style="min-width:150px"><div class="flabel">Nom de la raison</div><input id="wt_nom" placeholder="Support"></div>' +
        '<div style="min-width:80px;max-width:100px"><div class="flabel">Emoji</div><input id="wt_emoji" placeholder="🎫"></div>' +
        '<div style="flex:1;min-width:200px">' + fsel3('wt_cat', 'Catégorie dédiée à cette raison', p.categories) + '</div>' +
        '<div style="flex:1;min-width:170px">' + fsel2('wt_role', 'Rôle support (optionnel)', p.roles) + '</div></div>' +
        '<div class="flabel" style="margin-top:10px">Description (affichée sous la raison dans le menu déroulant)</div><input id="wt_desc" placeholder="Ex : Une question, un souci ? Ouvrez ici.">' +
        '<button id="wt_add" class="accent" style="margin-top:10px">➕ Ajouter la raison</button></div>';
      h += sec('Nouvelle raison (avec sa catégorie)', 'La config avancée du sélecteur : chaque raison peut pointer vers une catégorie différente.', addt, '');
    }
    m.innerHTML = h + '</div>';
    var reload = function(j){ if (j && !j.error) { toast('✅ ' + (j.note || 'Enregistré'), 'ok'); loadPage(srv); } };
    if ($('w_rp')) $('w_rp').onchange = function(){ save('rp_enabled', $('w_rp').checked ? 1 : 0); };
    if ($('w_mention')) $('w_mention').onchange = function(){ save('welcome_mention', $('w_mention').checked ? 1 : 0); prevBienvenue(srv); };
    if ($('w_wel')) {
      $('w_wel').addEventListener('input', function(){ $('w_count').textContent = $('w_wel').value.length; prevBienvenue(srv); });
      prevBienvenue(srv);
    }
    if ($('w_savew')) $('w_savew').onclick = function(){ save('welcome_message', $('w_wel').value.trim() || null); };
    if ($('w_saveb')) $('w_saveb').onclick = function(){ save('goodbye_message', $('w_bye').value.trim() || null); };
    if ($('ww_add')) $('ww_add').onclick = function(){
      if (!$('ww_role').value || !$('ww_mgr').value) { toast('⚠️ Choisissez les deux rôles.'); return; }
      api('POST', su('whitelist-ajouter'), { roleId: $('ww_role').value, managerRoleId: $('ww_mgr').value }).then(reload);
    };
    Array.prototype.forEach.call(m.querySelectorAll('.wl-del'), function(el){
      el.onclick = function(){ api('POST', su('whitelist-retirer'), { roleId: el.getAttribute('data-r'), managerRoleId: el.getAttribute('data-m') }).then(reload); };
    });
    if ($('wt_add')) $('wt_add').onclick = function(){
      if (!$('wt_nom').value.trim() || !$('wt_cat').value) { toast('⚠️ Nom et catégorie requis.'); return; }
      api('POST', su('tickets-type'), { label: $('wt_nom').value, emoji: $('wt_emoji').value, categoryId: $('wt_cat').value, supportRoleId: $('wt_role').value || null, description: $('wt_desc') ? $('wt_desc').value : '' }).then(reload);
    };
    // Éditeur de panneau : prévisualisation en direct + publication.
    if ($('tp_pv')){
      ['tp_ouv','tp_prof','tp_msg','tp_embed','tp_titre','tp_desc','tp_col','tp_auteur','tp_img','tp_thumb','tp_footer'].forEach(function(id){
        var el = $(id); if (el) el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', function(){ prevTicket(srv); });
      });
      prevTicket(srv);
      $('tp_pub').onclick = function(){
        if (!$('tp_salon').value){ toast('⚠️ Choisissez le salon de publication.', 'err'); return; }
        if (!(TK.tickets || []).length){ toast('⚠️ Ajoutez au moins une raison.', 'err'); return; }
        var options = { ouverture: $('tp_ouv').value, texte: $('tp_msg').value };
        if ($('tp_embed').checked){
          options.mode = 'embed';
          options.titre = $('tp_titre').value; options.description = $('tp_desc').value;
          options.couleur = $('tp_col').value; options.auteur = $('tp_auteur').value;
          options.image = $('tp_img').value; options.miniature = $('tp_thumb').value; options.footer = $('tp_footer').value;
        }
        api('POST', su('ticket-panneau'), { channelId: $('tp_salon').value, options: options, profileId: $('tp_prof').value || null })
          .then(function(j){ if (j && !j.error) toast('📤 ' + (j.note || 'Panneau publié !'), 'ok'); });
      };
    }
    if ($('pf_add')) $('pf_add').onclick = function(){
      if (!$('pf_nom').value.trim()){ toast('⚠️ Nom du profil requis.', 'err'); return; }
      api('POST', su('profil-ajouter'), { name: $('pf_nom').value, avatarUrl: $('pf_ava').value }).then(reload);
    };
    Array.prototype.forEach.call(m.querySelectorAll('.pf-del'), function(el){
      el.onclick = function(){ if (confirm('Supprimer ce profil ?')) api('POST', su('profil-suppr'), { id: el.getAttribute('data-id') }).then(reload); };
    });
    Array.prototype.forEach.call(m.querySelectorAll('.tk-del'), function(el){
      el.onclick = function(){ if (confirm('Supprimer ce type de ticket ?')) api('POST', su('tickets-type-suppr'), { id: el.getAttribute('data-id') }).then(reload); };
    });
    Array.prototype.forEach.call(m.querySelectorAll('.wsave'), function(el){
      el.onchange = function(){ save(el.getAttribute('data-k'), el.value || null); };
    });
    Array.prototype.forEach.call(m.querySelectorAll('.wnumsave'), function(el){
      el.onclick = function(){ save(el.getAttribute('data-k'), m.querySelector('.wnum[data-k="' + el.getAttribute('data-k') + '"]').value); };
    });
    Array.prototype.forEach.call(m.querySelectorAll('.wmultisave'), function(el){
      el.onclick = function(){
        var s = m.querySelectorAll('.wmulti[data-k="' + el.getAttribute('data-k') + '"]')[0];
        var vals = Array.prototype.filter.call(s.options, function(o){ return o.selected; }).map(function(o){ return o.value; });
        save(el.getAttribute('data-k'), vals.length ? vals : null);
      };
    });
  });
}

// Sélecteurs simples (formulaires whitelist/tickets, sans data-k).
function fsel2(id, label, list){
  var h = '<div class="flabel">' + label + '</div><select id="' + id + '"><option value="">—</option>';
  list.forEach(function(x){ h += '<option value="' + x.id + '">@' + esc(x.name) + '</option>'; });
  return h + '</select>';
}
function fsel3(id, label, list){
  var h = '<div class="flabel">' + label + '</div><select id="' + id + '"><option value="">—</option>';
  list.forEach(function(x){ h += '<option value="' + x.id + '">' + esc(x.name) + '</option>'; });
  return h + '</select>';
}
function fsel3b(id, list){
  var h = '<select id="' + id + '"><option value="">— Choisir un salon —</option>';
  list.forEach(function(x){ h += '<option value="' + x.id + '">#' + esc(x.name) + '</option>'; });
  return h + '</select>';
}
function gu(a){ return 'index.php?p=api-global&a=' + a; }

// Prévisualisation en direct du panneau de tickets (message + embed + sélecteur/boutons).
function prevTicket(srv){
  if (!$('tp_pv') || !TK) return;
  var prof = null;
  (TK.profils || []).forEach(function(pr){ if (String(pr.id) === $('tp_prof').value) prof = pr; });
  var nom = prof ? prof.name : (srv ? srv.bot : 'Bot');
  var ava = prof && prof.avatar ? prof.avatar : 'https://cdn.discordapp.com/embed/avatars/1.png';
  var h = '<div class="dprev"><div class="dtop"><img src="' + esc(ava) + '"><span class="bn">' + esc(nom) + '</span><span class="badge">✔ APP</span></div>';
  if ($('tp_msg').value) h += '<div style="margin:4px 0 6px;white-space:pre-wrap">' + esc($('tp_msg').value) + '</div>';
  if ($('tp_embed').checked){
    h += '<div class="dcard" style="border-left-color:' + $('tp_col').value + '">';
    if ($('tp_auteur').value) h += '<div style="font-size:12.5px;font-weight:600;margin-bottom:4px">' + esc($('tp_auteur').value) + '</div>';
    if ($('tp_titre').value) h += '<div class="dt">' + esc($('tp_titre').value) + '</div>';
    if ($('tp_desc').value) h += '<div class="dd">' + esc($('tp_desc').value) + '</div>';
    if ($('tp_thumb').value) h += '<img src="' + esc($('tp_thumb').value) + '" style="width:60px;height:60px;border-radius:6px;float:right;margin:-30px 0 0">';
    if ($('tp_img').value) h += '<img src="' + esc($('tp_img').value) + '" style="max-width:100%;border-radius:6px;margin-top:8px">';
    if ($('tp_footer').value) h += '<div class="df">' + esc($('tp_footer').value) + '</div>';
    h += '</div>';
  }
  // Sélecteur ou boutons selon le mode.
  if ($('tp_ouv').value === 'menu'){
    var opts = '';
    (TK.tickets || []).forEach(function(t){ opts += '<option>' + (t.emoji ? esc(t.emoji) + ' ' : '') + esc(t.label) + (t.description ? ' — ' + esc(t.description) : '') + '</option>'; });
    h += '<div style="margin-top:10px"><select style="pointer-events:none"><option>🎫 Choisissez une raison…</option>' + opts + '</select></div>';
  } else {
    var btns = '';
    (TK.tickets || []).forEach(function(t){ btns += '<button style="background:#5865f2;border:0;color:#fff;pointer-events:none;margin:2px">' + (t.emoji ? esc(t.emoji) + ' ' : '') + esc(t.label) + '</button>'; });
    h += '<div style="margin-top:10px;display:flex;gap:4px;flex-wrap:wrap">' + (btns || '<i style="color:var(--muted)">Ajoutez des raisons</i>') + '</div>';
  }
  h += '</div>';
  $('tp_pv').innerHTML = h;
}

// ================= 🛡️ ESPACE STAFF DU BOT =================
function staffShell(active, inner){
  var tabs = [['blacklist', '🚫 Blacklist'], ['tickets', '🎫 Tickets de ban'], ['bdd', '🗂️ Base de données'], ['equipe', '🛡️ Équipe du bot']];
  var h = '<div class="wrap"><div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">' +
    '<h1 class="pagetitle" style="margin:0">🛡️ Staff du bot</h1>' +
    '<button id="staff-home" style="margin-left:auto">⬅ Mes serveurs</button></div>' +
    '<p class="sub">Espace réservé à l\'équipe du bot (valable sur tous les serveurs).</p>';
  h += '<div class="tabbar">';
  tabs.forEach(function(t){ h += '<div class="tab' + (t[0] === active ? ' on' : '') + '" data-t="' + t[0] + '">' + t[1] + '</div>'; });
  h += '</div><div id="staffmain">' + inner + '</div></div>';
  $('content').innerHTML = h;
  if ($('staff-home')) $('staff-home').onclick = renderHome;
  Array.prototype.forEach.call(document.querySelectorAll('.tab[data-t]'), function(el){
    el.onclick = function(){ renderStaff(el.getAttribute('data-t')); };
  });
}
function renderStaff(tab){
  staffShell(tab, spinner());
  var m = function(){ return $('staffmain'); };
  if (tab === 'blacklist'){
    api('GET', gu('blacklist')).then(function(d){
      if (!d || d.error) { m().innerHTML = errScreen((d && d.error) || 'Erreur', false); return; }
      var h = '<div class="fade">';
      if (canPerm('blacklist')){
        h += sec('Blacklister un utilisateur', 'Il reçoit un MP (raison + serveur de déban), est banni de tous les serveurs du bot et re-banni à chaque arrivée.',
          '<div class="fields" style="display:flex;gap:9px;flex-wrap:wrap;align-items:flex-end">' +
          '<div style="min-width:210px"><div class="flabel">ID Discord</div><input id="bl_id" placeholder="123456789012345678"></div>' +
          '<div style="flex:1;min-width:220px"><div class="flabel">Raison</div><input id="bl_reason" placeholder="Motif de la blacklist"></div>' +
          '<div style="flex:1;min-width:220px"><div class="flabel">Preuve (lien, facultatif)</div><input id="bl_proof" placeholder="https://…"></div>' +
          '<button id="bl_add" class="accent">🚫 Blacklister</button></div>', '');
      }
      var list = (d.blacklist || []);
      var rows = '';
      list.forEach(function(b){
        rows += '<div class="row">🚫 <b>' + esc(b.tag || ('ID ' + b.userId)) + '</b> <span style="color:var(--muted)">' + esc(b.userId) + '</span>' +
          (b.reason ? ' — ' + esc(b.reason) : '') +
          (canPerm('blacklist') ? '<button class="bl-del" data-u="' + b.userId + '" style="margin-left:auto;padding:4px 11px;font-size:12px">Débannir</button>' : '') + '</div>';
      });
      if (!list.length) rows = '<div class="row" style="color:var(--muted)"><i>Personne n\'est blacklisté.</i></div>';
      h += sec('Blacklist (' + list.length + ')', '', rows, '');
      m().innerHTML = h + '</div>';
      if ($('bl_add')) $('bl_add').onclick = function(){
        if (!/^\d{5,25}$/.test($('bl_id').value.trim())) { toast('⚠️ ID Discord invalide.', 'err'); return; }
        api('POST', gu('blacklist-ajouter'), { userId: $('bl_id').value.trim(), reason: $('bl_reason').value, proof: ($('bl_proof') ? $('bl_proof').value : '') }).then(function(j){ if (j && !j.error){ toast('🚫 ' + (j.tag || 'Utilisateur') + ' blacklisté' + (j.banned != null ? ' (' + j.banned + ' serveur(s))' : ''), 'ok'); renderStaff('blacklist'); } });
      };
      Array.prototype.forEach.call(m().querySelectorAll('.bl-del'), function(el){
        el.onclick = function(){ if (confirm('Débannir cet utilisateur partout ?')) api('POST', gu('blacklist-retirer'), { userId: el.getAttribute('data-u') }).then(function(j){ if (j && !j.error){ toast('🔓 Blacklist levée', 'ok'); renderStaff('blacklist'); } }); };
      });
    });
    return;
  }
  // 🎫 Tickets de bannissement remontés au QG
  if (tab === 'tickets'){
    api('GET', gu('qg-tickets')).then(function(d){
      if (!d || d.error) { m().innerHTML = errScreen((d && d.error) || 'Erreur', false); return; }
      var list = (d.tickets || []);
      var badge = { 'ouvert': ['🟢 Ouvert', '#3ba55d'], 'claim': ['🖐 Claim', '#faa61a'], 'traite': ['✅ Traité', 'var(--muted)'] };
      var res = { 'blacklist': '🚫 Blacklist appliquée', 'aucune': '— Aucune action' };
      var rows = '';
      list.forEach(function(t){
        var b = badge[t.status] || ['?', 'var(--muted)'];
        rows += '<div class="row" style="flex-wrap:wrap;gap:8px" data-id="' + t.id + '">' +
          '<span style="min-width:44px;font-weight:700">#' + t.id + '</span>' +
          '<div style="min-width:170px"><b>' + esc(t.targetTag || ('ID ' + t.targetId)) + '</b><div style="color:var(--muted);font-size:11.5px">' + esc(t.targetId) + '</div></div>' +
          '<div style="min-width:150px;font-size:12.5px">🌐 ' + esc(t.guildName || t.guildId) + '</div>' +
          '<div style="flex:1;min-width:150px;color:var(--muted);font-size:12.5px">' + (t.reason ? esc(t.reason) : '<i>Sans motif</i>') + '</div>' +
          '<span class="chip" style="background:' + b[1] + '22;color:' + b[1] + '">' + b[0] + '</span>';
        if (t.status === 'traite'){
          rows += '<span style="color:var(--muted);font-size:12px;width:100%">' + (res[t.resolution] || '') + '</span>';
        } else if (canPerm('tickets')){
          rows += '<div style="display:flex;gap:5px;flex-wrap:wrap;width:100%;margin-top:4px">' +
            (t.status !== 'claim' ? '<button class="qg-claim" data-id="' + t.id + '" style="padding:4px 11px;font-size:12px">🖐 Claim</button>' : '<span style="font-size:12px;color:var(--muted);align-self:center">Claim par ' + esc(t.claimedBy || '?') + '</span>') +
            '<button class="qg-inv" data-id="' + t.id + '" style="padding:4px 11px;font-size:12px">✉️ M\'inviter</button>' +
            '<button class="qg-none" data-id="' + t.id + '" style="padding:4px 11px;font-size:12px">Ne rien faire</button>' +
            (canPerm('blacklist') ? '<button class="qg-bl accent" data-id="' + t.id + '" data-tag="' + esc(t.targetTag || t.targetId) + '" style="padding:4px 11px;font-size:12px">🚫 Blacklist + preuves</button>' : '') +
            '</div>';
        }
        rows += '</div>';
      });
      if (!list.length) rows = '<div class="row" style="color:var(--muted)"><i>Aucun ticket de bannissement.</i></div>';
      m().innerHTML = '<div class="fade">' + sec('Tickets de bannissement (' + list.length + ')',
        'À chaque bannissement sur un serveur du bot, un ticket arrive ici. Claim, faites-vous inviter, puis traitez : « ne rien faire » ou blacklist (preuves obligatoires).', rows, '') + '</div>';
      Array.prototype.forEach.call(m().querySelectorAll('.qg-claim'), function(el){
        el.onclick = function(){ api('POST', gu('qg-claim'), { ticketId: el.getAttribute('data-id') }).then(function(j){ if (j && !j.error){ toast('🖐 Ticket claim', 'ok'); renderStaff('tickets'); } }); };
      });
      Array.prototype.forEach.call(m().querySelectorAll('.qg-inv'), function(el){
        el.onclick = function(){ api('POST', gu('qg-invite'), { ticketId: el.getAttribute('data-id') }).then(function(j){ if (j && !j.error){ prompt('Invitation (valable 1h, 1 usage) :', j.url || ''); } }); };
      });
      Array.prototype.forEach.call(m().querySelectorAll('.qg-none'), function(el){
        el.onclick = function(){ if (confirm('Clôturer ce ticket sans action ?')) api('POST', gu('qg-traiter'), { ticketId: el.getAttribute('data-id'), resolution: 'aucune' }).then(function(j){ if (j && !j.error){ toast('✅ Ticket traité', 'ok'); renderStaff('tickets'); } }); };
      });
      Array.prototype.forEach.call(m().querySelectorAll('.qg-bl'), function(el){
        el.onclick = function(){
          var proof = prompt('Blacklist de ' + el.getAttribute('data-tag') + '.\nPreuves OBLIGATOIRES (lien capture / logs) :', '');
          if (proof === null) return;
          if (!proof.trim()) { toast('⚠️ Les preuves sont obligatoires.', 'err'); return; }
          api('POST', gu('qg-traiter'), { ticketId: el.getAttribute('data-id'), resolution: 'blacklist', proof: proof.trim() }).then(function(j){ if (j && !j.error){ toast('🚫 Blacklist appliquée' + (j.banned != null ? ' (' + j.banned + ' serveur(s))' : ''), 'ok'); renderStaff('tickets'); } });
        };
      });
    });
    return;
  }
  // 🗂️ Base de données : historique des blacklists + preuves du salon principal
  if (tab === 'bdd'){
    var draw = function(hist, preuves){
      var act = { 'blacklist': ['🚫 Blacklist', '#e74c3c'], 'deblacklist': ['🔓 Déban', '#3ba55d'] };
      var hrows = '';
      (hist || []).forEach(function(r){
        var a = act[r.action] || [r.action, 'var(--muted)'];
        hrows += '<div class="row" style="flex-wrap:wrap;gap:7px">' +
          '<span class="chip" style="background:' + a[1] + '22;color:' + a[1] + '">' + a[0] + '</span>' +
          '<div style="min-width:160px"><b>' + esc(r.tag || ('ID ' + r.userId)) + '</b><div style="color:var(--muted);font-size:11.5px">' + esc(r.userId) + '</div></div>' +
          '<div style="flex:1;min-width:150px;font-size:12.5px">' + (r.reason ? esc(r.reason) : '<i style="color:var(--muted)">—</i>') + '</div>' +
          (r.proof ? '<a href="' + esc(r.proof) + '" target="_blank" class="chip" style="text-decoration:none">📎 Preuve</a>' : '') +
          '<span style="color:var(--muted);font-size:11.5px;width:100%">' + esc((r.at || '').replace('T', ' ').replace(/\..*/, '')) + ' · par ' + esc(r.by || '?') + '</span>' +
          '</div>';
      });
      if (!(hist || []).length) hrows = '<div class="row" style="color:var(--muted)"><i>Aucune blacklist enregistrée.</i></div>';
      var prows = '';
      (preuves || []).forEach(function(pv){
        prows += '<div class="row" style="flex-wrap:wrap;gap:6px">' +
          '<div style="min-width:150px"><b>' + esc(pv.authorTag || pv.authorId) + '</b></div>' +
          '<div style="flex:1;min-width:170px;font-size:12.5px;white-space:pre-wrap">' + (pv.content ? esc(pv.content) : '') + '</div>' +
          ((pv.attachments || []).map(function(u){ return '<a href="' + esc(u) + '" target="_blank" class="chip" style="text-decoration:none">📎 Fichier</a>'; }).join('')) +
          '<span style="color:var(--muted);font-size:11.5px;width:100%">' + esc((pv.at || '').replace('T', ' ').replace(/\..*/, '')) + '</span>' +
          '</div>';
      });
      if (!(preuves || []).length) prows = '<div class="row" style="color:var(--muted)"><i>Aucun message récupéré (configurez le salon des preuves dans Salons & logs).</i></div>';
      m().innerHTML = '<div class="fade">' +
        '<div class="fields" style="display:flex;gap:8px;margin-bottom:12px"><input id="bdd_q" placeholder="🔎 Rechercher (ID, pseudo, raison…)" style="flex:1"><button id="bdd_go" class="accent">Rechercher</button></div>' +
        sec('Historique des blacklists', 'Chaque blacklist / déban depuis le début, avec la preuve fournie.', hrows, '') +
        sec('🖼️ Salon des preuves', 'Messages récupérés automatiquement dans le salon des preuves du Discord principal.', prows, '') +
        '</div>';
      var run = function(){
        var q = $('bdd_q') ? encodeURIComponent($('bdd_q').value.trim()) : '';
        m().innerHTML = spinner();
        Promise.all([api('GET', gu('blacklist-historique') + (q ? '&q=' + q : '')), api('GET', gu('preuves') + (q ? '&q=' + q : ''))]).then(function(r){
          draw((r[0] && r[0].historique) || [], (r[1] && r[1].preuves) || []);
        });
      };
      if ($('bdd_go')) $('bdd_go').onclick = run;
      if ($('bdd_q')) $('bdd_q').onkeydown = function(e){ if (e.key === 'Enter') run(); };
    };
    Promise.all([api('GET', gu('blacklist-historique')), api('GET', gu('preuves'))]).then(function(r){
      if (r[0] && r[0].error) { m().innerHTML = errScreen(r[0].error, false); return; }
      draw((r[0] && r[0].historique) || [], (r[1] && r[1].preuves) || []);
    });
    return;
  }
  // Équipe du bot (grades + permissions par personne)
  api('GET', gu('botstaff')).then(function(d){
    if (!d || d.error) { m().innerHTML = errScreen((d && d.error) || 'Erreur', false); return; }
    var permKeys = Object.keys(d.perms || {});
    var manage = canPerm('staff');
    var h = '<div class="fade">';
    if (manage){
      var gr = '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">';
      (d.grades || []).forEach(function(g){ gr += '<span class="chip">' + esc(g) + (manage ? '<button class="bsg-del" data-g="' + esc(g) + '">✕</button>' : '') + '</span>'; });
      gr += '<input id="bsg_new" placeholder="Nouveau grade" style="max-width:190px"><button id="bsg_add" class="accent" style="padding:5px 12px">➕</button></div>';
      h += sec('📛 Grades', 'Créez vos grades librement (Responsable, Modérateur, Support…).', gr, '');
    }
    var rows = '';
    (d.staff || []).forEach(function(s){
      rows += '<div class="row"><div style="min-width:150px"><b>' + esc(s.tag || ('ID ' + s.userId)) + '</b><div style="color:var(--muted);font-size:11.5px">' + esc(s.userId) + '</div></div>';
      if (manage){
        rows += '<select class="bs-rank" data-u="' + s.userId + '" style="max-width:150px">';
        var seen = false;
        (d.grades || []).forEach(function(g){ if (g === s.rank) seen = true; rows += '<option' + (g === s.rank ? ' selected' : '') + '>' + esc(g) + '</option>'; });
        if (!seen) rows += '<option selected>' + esc(s.rank) + '</option>';
        rows += '</select>';
        permKeys.forEach(function(pk){ rows += '<label style="display:flex;gap:4px;align-items:center;font-size:12px"><input type="checkbox" class="bs-perm" data-u="' + s.userId + '" data-p="' + pk + '"' + (s.perms.indexOf(pk) >= 0 ? ' checked' : '') + ' style="width:auto"> ' + d.perms[pk] + '</label>'; });
        rows += '<button class="bs-del" data-u="' + s.userId + '" style="margin-left:auto;padding:4px 10px;font-size:12px">🗑</button>';
      } else {
        rows += '<span style="color:var(--muted)">' + esc(s.rank) + ' — ' + (s.perms.map(function(pk){ return d.perms[pk] || pk; }).join(' · ') || 'aucune') + '</span>';
      }
      rows += '</div>';
    });
    if (!(d.staff || []).length) rows = '<div class="row" style="color:var(--muted)"><i>Aucun membre dans le staff du bot.</i></div>';
    h += sec('Membres du staff', manage ? 'Grade et permissions par personne.' : 'Vous n\'avez pas la gestion du staff.', rows, '');
    if (manage){
      h += sec('➕ Ajouter un staff', '', '<div class="fields" style="display:flex;gap:9px;flex-wrap:wrap;align-items:flex-end">' +
        '<div style="min-width:210px"><div class="flabel">ID Discord</div><input id="bs_id" placeholder="123456789012345678"></div>' +
        '<div style="min-width:150px"><div class="flabel">Grade</div><select id="bs_rank">' + (d.grades || []).map(function(g){ return '<option>' + esc(g) + '</option>'; }).join('') + '</select></div>' +
        '<button id="bs_add" class="accent">Ajouter</button></div>', '');
    }
    m().innerHTML = h + '</div>';
    var rr = function(){ renderStaff('equipe'); };
    if ($('bsg_add')) $('bsg_add').onclick = function(){ if ($('bsg_new').value.trim()) api('POST', gu('botstaff-grade'), { name: $('bsg_new').value }).then(function(j){ if (j && !j.error) rr(); }); };
    Array.prototype.forEach.call(m().querySelectorAll('.bsg-del'), function(el){ el.onclick = function(){ api('POST', gu('botstaff-grade-suppr'), { name: el.getAttribute('data-g') }).then(function(j){ if (j && !j.error) rr(); }); }; });
    if ($('bs_add')) $('bs_add').onclick = function(){ if (!/^\d{5,25}$/.test($('bs_id').value.trim())){ toast('⚠️ ID invalide.', 'err'); return; } api('POST', gu('botstaff-ajouter'), { userId: $('bs_id').value.trim(), rank: $('bs_rank').value }).then(function(j){ if (j && !j.error){ toast('✅ Ajouté', 'ok'); rr(); } }); };
    Array.prototype.forEach.call(m().querySelectorAll('.bs-rank'), function(el){ el.onchange = function(){ api('POST', gu('botstaff-ajouter'), { userId: el.getAttribute('data-u'), rank: el.value }).then(function(j){ if (j && !j.error) toast('✅ Grade mis à jour', 'ok'); }); }; });
    Array.prototype.forEach.call(m().querySelectorAll('.bs-perm'), function(el){ el.onchange = function(){ api('POST', gu('botstaff-perm'), { userId: el.getAttribute('data-u'), perm: el.getAttribute('data-p'), on: el.checked }).then(function(j){ if (j && !j.error) toast('✅ Permission mise à jour', 'ok'); }); }; });
    Array.prototype.forEach.call(m().querySelectorAll('.bs-del'), function(el){ el.onclick = function(){ if (confirm('Retirer ce membre du staff ?')) api('POST', gu('botstaff-retirer'), { userId: el.getAttribute('data-u') }).then(function(j){ if (j && !j.error) rr(); }); }; });
  });
}

// ================= ⚙️ ESPACE CRÉATEUR (config du dashboard) =================
function renderCreateur(){
  gid = null;
  $('content').innerHTML = '<div class="wrap">' + spinner() + '</div>';
  api('GET', gu('dashconfig')).then(function(d){
    if (!d || d.error) { $('content').innerHTML = '<div class="wrap">' + errScreen((d && d.error) || 'Erreur', false) + '</div>'; return; }
    var cfg = d.config, mods = d.modules;
    var h = '<div class="wrap fade"><div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">' +
      '<h1 class="pagetitle" style="margin:0">⚙️ Créateur — configurer le dashboard</h1>' +
      '<button id="cr-home" style="margin-left:auto">⬅ Mes serveurs</button></div>' +
      '<p class="sub">Personnalisez le dashboard de A à Z : marque et modules affichés à vos staffs. Appliqué à tout le monde.</p>';
    // Marque
    h += sec('🎨 Marque du dashboard', 'Nom, couleur d\'accent et accroche de la page d\'accueil.',
      '<div class="fields">' +
      '<div class="flabel">Nom affiché</div><input id="cr_nom" value="' + esc(cfg.nom || '') + '">' +
      '<div class="flabel" style="margin-top:12px">Accroche (page d\'accueil : « Un bot pour … »)</div><input id="cr_accroche" value="' + esc(cfg.accroche || '') + '">' +
      '<div class="flabel" style="margin-top:12px">Couleur d\'accent</div><input id="cr_accent" type="color" value="' + esc(cfg.accent || '#d8734f') + '" style="width:70px;height:38px;padding:3px">' +
      '</div>', '');
    // Modules
    var mi = '';
    Object.keys(mods).forEach(function(k){
      if (k === 'apercu') return; // la vue d'ensemble reste toujours active
      var on = cfg.modules[k] !== false;
      mi += '<div class="row"><span style="font-size:18px">' + mods[k][0] + '</span> <b>' + mods[k][1] + '</b>' +
        '<span class="sw" style="margin-left:auto">' + tog('crm_' + k, on) + '</span></div>';
    });
    h += sec('🧩 Modules affichés', 'Activez ou désactivez les pages visibles par vos staffs dans la configuration des serveurs.', mi, '');
    h += '<button id="cr_save" class="accent" style="font-size:14px;padding:11px 22px">💾 Enregistrer la configuration</button>';

    // Statut personnalisé par bot
    var bots = d.bots || [];
    var bopts = bots.map(function(b){ return '<option value="' + esc(b.name) + '">' + esc(b.name) + ' (' + b.serveurs + ' serveur' + (b.serveurs > 1 ? 's' : '') + ')</option>'; }).join('');
    var typeOpts = [['custom','Personnalisé'],['playing','Joue à'],['watching','Regarde'],['listening','Écoute'],['competing','Participe à'],['streaming','En live (Twitch)']]
      .map(function(t){ return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('');
    var presOpts = [['online','🟢 En ligne'],['idle','🌙 Inactif'],['dnd','⛔ Ne pas déranger'],['invisible','⚪ Invisible']]
      .map(function(p){ return '<option value="' + p[0] + '">' + p[1] + '</option>'; }).join('');
    var stat = '<div class="fields">' +
      '<div class="flabel">Bot concerné</div><select id="st_bot">' + (bopts || '<option value="">— Aucun bot en ligne —</option>') + '</select>' +
      '<div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:12px">' +
      '<div style="min-width:150px"><div class="flabel">Type</div><select id="st_type">' + typeOpts + '</select></div>' +
      '<div style="flex:1;min-width:220px"><div class="flabel">Texte du statut</div><input id="st_text" placeholder="ex : les serveurs RP"></div>' +
      '<div style="min-width:170px"><div class="flabel">Présence</div><select id="st_pres">' + presOpts + '</select></div></div>' +
      '<div class="flabel" id="st_urlL" style="margin-top:12px;display:none">URL Twitch (pour « En live »)</div><input id="st_url" placeholder="https://twitch.tv/…" style="display:none">' +
      '<div style="margin-top:12px;display:flex;gap:9px"><button id="st_save" class="accent">💾 Appliquer le statut</button><button id="st_clear">🧹 Retirer le statut</button></div></div>';
    h += sec('🟢 Statut personnalisé par bot', 'Définissez l\'activité et la présence Discord affichées par un bot précis.', stat, '');
    h += '</div>';

    $('content').innerHTML = h;
    if ($('cr-home')) $('cr-home').onclick = renderHome;
    $('cr_save').onclick = function(){
      var modules = {};
      Object.keys(mods).forEach(function(k){ if (k === 'apercu') { modules[k] = true; return; } modules[k] = $('crm_' + k) ? $('crm_' + k).checked : true; });
      var newCfg = { nom: $('cr_nom').value.trim() || 'Mon Bot', accroche: $('cr_accroche').value.trim() || 'Le Roleplay', accent: $('cr_accent').value, modules: modules };
      api('POST', gu('dashconfig-save'), { config: newCfg }).then(function(j){
        if (j && !j.error){ toast('✅ Configuration enregistrée', 'ok'); DASH = newCfg; applyBrand(); }
      });
    };
    // Statut : affiche le champ URL uniquement pour « streaming », charge l'existant.
    var toggleUrl = function(){ var on = $('st_type').value === 'streaming'; $('st_url').style.display = on ? '' : 'none'; $('st_urlL').style.display = on ? '' : 'none'; };
    if ($('st_type')) $('st_type').onchange = toggleUrl;
    var loadStatus = function(){
      if (!$('st_bot') || !$('st_bot').value) return;
      api('GET', gu('bot-status') + '&bot=' + encodeURIComponent($('st_bot').value)).then(function(j){
        var s = (j && j.status) || {};
        if ($('st_type')) $('st_type').value = s.type || 'custom';
        if ($('st_text')) $('st_text').value = s.text || '';
        if ($('st_pres')) $('st_pres').value = s.presence || 'online';
        if ($('st_url')) $('st_url').value = s.url || '';
        toggleUrl();
      });
    };
    if ($('st_bot')) { $('st_bot').onchange = loadStatus; loadStatus(); }
    if ($('st_save')) $('st_save').onclick = function(){
      if (!$('st_bot').value) { toast('⚠️ Aucun bot.', 'err'); return; }
      var status = { type: $('st_type').value, text: $('st_text').value.trim(), presence: $('st_pres').value, url: $('st_url').value.trim() };
      api('POST', gu('bot-status-save'), { bot: $('st_bot').value, status: status }).then(function(j){ if (j && !j.error) toast('✅ Statut appliqué', 'ok'); });
    };
    if ($('st_clear')) $('st_clear').onclick = function(){
      if (!$('st_bot').value) return;
      api('POST', gu('bot-status-save'), { bot: $('st_bot').value, status: null }).then(function(j){ if (j && !j.error){ toast('🧹 Statut retiré', 'ok'); $('st_text').value = ''; } });
    };
  });
}

// Applique la marque (nom + couleur d'accent) définie par le créateur.
function applyBrand(){
  if (DASH.accent) document.documentElement.style.setProperty('--accent', DASH.accent);
  if (DASH.nom){ var b = document.querySelector('.nav .brand'); if (b) b.innerHTML = '<span class="lg">🎛️</span>' + esc(DASH.nom); document.title = DASH.nom + ' — Dashboard'; }
}

api('GET', 'index.php?p=api-moi').then(function(j){
  if (!j || j.error) { location.href = 'index.php'; return; }
  moi = j;
  ROLE = j.role || ROLE;
  DASH = j.dash || DASH;
  applyBrand();
  if (moi.user.avatar) { $('h_avatar').src = moi.user.avatar; $('h_avatar').style.display = ''; }
  $('h_name').textContent = moi.user.username;
  renderHome();
});
</script>
</body>
</html>
SCRIPT;
