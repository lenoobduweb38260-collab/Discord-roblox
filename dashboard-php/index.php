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

// Version de CE fichier, tamponnée par la CI au build (v1.0.<n°>). En dehors
// d'une release (fichier « dev »), la version est inconnue et la mise à jour
// automatique ne se déclenche pas tant qu'aucune version n'est identifiée.
const DASH_BUILD = 'dev';

// Page de diagnostic (?p=diag) : toujours accessible, même config incomplète,
// pour aider à finaliser l'installation.
if (!DEMO && ($_GET['p'] ?? '') !== 'diag') {
  $manquants = [];
  // DASH_URL n'est plus obligatoire : l'URL est auto-détectée depuis la requête.
  foreach (['DASH_CLIENT_ID', 'DASH_CLIENT_SECRET', 'AGENT_URL', 'AGENT_KEY'] as $c) {
    if (!defined($c) || constant($c) === '') $manquants[] = $c;
  }
  if ($manquants) {
    http_response_code(500);
    exit('⚠️ Configuration incomplète : ' . htmlspecialchars(implode(', ', $manquants)) . ' à remplir dans config.php.'
      . ' (Astuce : ouvrez index.php?p=diag pour un diagnostic guidé, ou mettez DASH_DEMO = true pour tester l\'interface en local.)');
  }
}
$DASH_URL = defined('DASH_URL') && DASH_URL !== '' ? rtrim(DASH_URL, '/') : '';

// Personnalisation optionnelle (constantes facultatives de config.php).
$NOM_BOT = defined('DASH_NOM') && DASH_NOM !== '' ? DASH_NOM : 'Mon Bot';
$URL_SUPPORT = defined('DASH_SUPPORT_URL') ? DASH_SUPPORT_URL : '';
$URL_DOCS = defined('DASH_DOCS_URL') && DASH_DOCS_URL !== '' ? DASH_DOCS_URL : 'https://github.com/lenoobduweb38260-collab/Discord-roblox#readme';

// ----- URL réelle de la page (auto-détection) -----
// L'URL de redirection OAuth2 est construite depuis la requête RÉELLE du
// navigateur (schéma, hôte, dossier — y compris derrière un proxy) : elle
// correspond donc TOUJOURS à l'adresse visitée. Fini les erreurs
// « redirect_uri non valide » dues à un DASH_URL mal recopié : DASH_URL
// devient un simple réglage facultatif.
function request_scheme(): string {
  $fw = strtolower(trim(explode(',', $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')[0]));
  if ($fw === 'https' || $fw === 'http') return $fw;
  $https = $_SERVER['HTTPS'] ?? '';
  if ($https !== '' && strtolower($https) !== 'off') return 'https';
  if ((int) ($_SERVER['SERVER_PORT'] ?? 0) === 443) return 'https';
  return 'http';
}
function request_host(): string {
  $fw = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_HOST'] ?? '')[0]);
  return $fw !== '' ? $fw : ($_SERVER['HTTP_HOST'] ?? 'localhost');
}
// Chemin du script tel que servi (ex : /index.php ou /dashboard/index.php).
function request_script(): string {
  $path = strtok($_SERVER['SCRIPT_NAME'] ?? ($_SERVER['PHP_SELF'] ?? '/index.php'), '?');
  return '/' . ltrim($path, '/');
}
// URL de redirection OAuth2. UNE SEULE source de vérité :
//  • DASH_URL renseignée → valeur ÉPINGLÉE (comme avant : les installations
//    existantes et les montages proxy/tunnel qui ne transmettent pas les
//    en-têtes X-Forwarded-* continuent de fonctionner à l'identique) ;
//  • DASH_URL vide (recommandé) → auto-détection depuis la page réelle.
function oauth_redirect_uri(): string {
  global $DASH_URL;
  if ($DASH_URL !== '') return $DASH_URL . '/index.php?p=callback';
  return request_scheme() . '://' . request_host() . request_script() . '?p=callback';
}
// Base d'URL pour les redirections internes — MÊME source de vérité que le
// redirect_uri (sinon la session se pose sur un hôte et l'utilisateur est
// renvoyé sur un autre → déconnecté juste après une connexion réussie).
function base_url(): string {
  global $DASH_URL;
  if ($DASH_URL !== '') return $DASH_URL;
  return request_scheme() . '://' . request_host() . rtrim(dirname(request_script()), '/');
}

session_set_cookie_params([
  'lifetime' => 604800,
  'path' => '/',
  'httponly' => true,
  'samesite' => 'Lax',
  // Cookie « secure » si la connexion réelle est en https OU si DASH_URL
  // l'impose (frontal TLS qui ne transmet pas X-Forwarded-Proto) — jamais
  // moins protégé qu'avant.
  'secure' => request_scheme() === 'https' || str_starts_with($DASH_URL, 'https://'),
]);
session_start();

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
      ['id' => 1, 'label' => 'Support', 'emoji' => '🛠️', 'description' => 'Une question, un souci ?', 'categorie' => 'TICKETS', 'support' => 'Staff', 'supports' => [['id' => '10', 'name' => 'Staff'], ['id' => '12', 'name' => 'Modérateur']]],
      ['id' => 2, 'label' => 'Plainte', 'emoji' => '⚖️', 'description' => 'Signaler un membre', 'categorie' => 'AIDE', 'support' => 'Modérateur', 'supports' => [['id' => '12', 'name' => 'Modérateur']]],
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
          $infos[$g['id']] = ['name' => $g['name'], 'memberCount' => $g['memberCount'] ?? null, 'icon' => $g['icon'] ?? null];
        }
      }
    }
    @file_put_contents(__DIR__ . '/cache-serveurs.php', CACHE_PREFIX . json_encode(['at' => time(), 'map' => $map, 'infos' => $infos]));
  } elseif ($cache !== null) {
    return [$cache['map'] ?? [], $cache['infos'] ?? []]; // agent injoignable : on garde l'ancien cache
  }
  return [$map, $infos];
}

// ----- 🔄 Mise à jour automatique du dashboard (créateur) -----
// Le dashboard se met à jour comme le bot : il récupère la dernière release
// GitHub, en extrait index.php (depuis pack-dashboard-php.zip) et se réécrit
// lui-même après sauvegarde. config.php n'est JAMAIS touché (réglages conservés).
function dash_repo(): string {
  return defined('DASH_REPO') && DASH_REPO !== '' ? DASH_REPO : 'lenoobduweb38260-collab/Discord-roblox';
}
// Version de ce fichier (tamponnée au build) ; null si « dev » (inconnue).
function dash_current_version(): ?string {
  return (defined('DASH_BUILD') && DASH_BUILD !== 'dev' && DASH_BUILD !== '') ? DASH_BUILD : null;
}
// Compare deux tags vX.Y.Z : true si $a est STRICTEMENT plus récent que $b.
function dash_ver_newer(string $a, string $b): bool {
  $num = function (string $t): array {
    $t = ltrim($t, 'vV');
    $p = array_map('intval', explode('.', $t));
    return [$p[0] ?? 0, $p[1] ?? 0, $p[2] ?? 0];
  };
  return ($num($a) <=> $num($b)) === 1;
}
// Dernière version publiée + état d'écriture, sans rien modifier.
function dash_update_info(): array {
  $writable = is_writable(__DIR__ . '/index.php');
  [$st, $rel] = http_req('https://api.github.com/repos/' . dash_repo() . '/releases/latest', 'GET', null,
    ['User-Agent: dashboard-php', 'Accept: application/vnd.github+json']);
  $latest = ($st === 200 && !empty($rel['tag_name'])) ? $rel['tag_name'] : null;
  $current = dash_current_version();
  return [
    'current' => $current,
    'latest' => $latest,
    'updateAvailable' => $latest !== null && $current !== null && dash_ver_newer($latest, $current),
    'auto' => dash_autoupdate_enabled(),
    'writable' => $writable,
    'error' => $latest === null ? "Release introuvable (HTTP $st)." : null,
  ];
}
// Interrupteur de la mise à jour automatique (activée par défaut). Un fichier
// drapeau protégé « .dash-noauto.php » la désactive.
function dash_autoupdate_enabled(): bool {
  return !file_exists(__DIR__ . '/.dash-noauto.php');
}
function dash_set_autoupdate(bool $on): void {
  $f = __DIR__ . '/.dash-noauto.php';
  if ($on) { @unlink($f); } else { @file_put_contents($f, CACHE_PREFIX . 'off'); }
}
// Mise à jour 100 % automatique : appelée à chaque chargement de page, mais
// limitée à une vérification toutes les 6 h (jalon horodaté) pour ne pas
// solliciter l'API GitHub à chaque visite. Silencieuse : la nouvelle version
// s'applique et sera servie au chargement suivant.
function dash_auto_update_tick(): void {
  if (DEMO || !dash_autoupdate_enabled() || dash_current_version() === null) return;
  if (!is_writable(__DIR__ . '/index.php')) return;
  $stamp = __DIR__ . '/.dash-check.php';
  $last = 0;
  $raw = @file_get_contents($stamp);
  if ($raw !== false && str_starts_with($raw, CACHE_PREFIX)) $last = (int) substr($raw, strlen(CACHE_PREFIX));
  if (time() - $last < 21600) return; // au plus 1 vérification / 6 h
  @file_put_contents($stamp, CACHE_PREFIX . time()); // pose le jalon AVANT (évite les vérifs concurrentes)
  $info = dash_update_info();
  if (!empty($info['updateAvailable'])) dash_self_update();
}
// Applique la mise à jour : renvoie ['ok'=>true,'version'=>tag] ou ['error'=>…].
function dash_self_update(): array {
  $self = __DIR__ . '/index.php';
  if (!is_writable($self)) {
    return ['error' => "index.php n'est pas modifiable par PHP sur cet hébergeur : ré-uploadez-le à la main, ou donnez les droits d'écriture (chmod 644/664)."];
  }
  [$st, $rel] = http_req('https://api.github.com/repos/' . dash_repo() . '/releases/latest', 'GET', null,
    ['User-Agent: dashboard-php', 'Accept: application/vnd.github+json']);
  if ($st !== 200 || empty($rel['tag_name'])) return ['error' => "Release introuvable (HTTP $st)."];
  $tag = $rel['tag_name'];
  $asset = null;
  foreach ($rel['assets'] ?? [] as $a) if (($a['name'] ?? '') === 'pack-dashboard-php.zip') { $asset = $a; break; }
  if (!$asset || empty($asset['browser_download_url'])) return ['error' => "Version $tag publiée sans pack-dashboard-php.zip."];
  [$st2, , $rawZip] = http_req($asset['browser_download_url'], 'GET', null, ['User-Agent: dashboard-php']);
  if ($st2 !== 200 || $rawZip === '') return ['error' => "Téléchargement du pack impossible (HTTP $st2)."];
  if (!class_exists('ZipArchive')) return ['error' => "Extension PHP ZipArchive absente chez votre hébergeur — mise à jour auto indisponible."];
  $tmp = tempnam(sys_get_temp_dir(), 'dashmaj');
  file_put_contents($tmp, $rawZip);
  $newCode = null;
  $zip = new ZipArchive();
  if ($zip->open($tmp) === true) {
    for ($i = 0; $i < $zip->numFiles; $i++) {
      if (basename((string) $zip->getNameIndex($i)) === 'index.php') { $newCode = $zip->getFromIndex($i); break; }
    }
    $zip->close();
  }
  @unlink($tmp);
  if ($newCode === null || $newCode === '') return ['error' => 'index.php introuvable dans le pack téléchargé.'];
  // Garde-fou : le fichier doit être un index.php de dashboard valide.
  if (strpos($newCode, '<?php') !== 0 || strpos($newCode, 'p=api-global') === false || strpos($newCode, 'function renderHome') === false) {
    return ['error' => 'Fichier téléchargé non reconnu — mise à jour annulée par sécurité.'];
  }
  @copy($self, __DIR__ . '/index.php.bak');
  // Écriture atomique : on écrit un fichier temporaire puis on le renomme
  // (rename est atomique sur le même système de fichiers) — jamais d'index.php
  // à moitié écrit, même si deux visites déclenchent la mise à jour en même temps.
  $tmpNew = __DIR__ . '/.index.php.new';
  if (@file_put_contents($tmpNew, $newCode) === false || !@rename($tmpNew, $self)) {
    @unlink($tmpNew);
    return ['error' => "Écriture de index.php impossible."];
  }
  return ['ok' => true, 'version' => $tag];
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

// Nom d'affichage d'un bot : « Shadow_community » → « Shadow Community »,
// « Colmar_rp » → « Colmar RP ».
function bot_label(string $name): string {
  $words = preg_split('/[_\-]+/', $name) ?: [$name];
  $words = array_map(fn($w) => strtolower($w) === 'rp' ? 'RP' : ucfirst($w), $words);
  return trim(implode(' ', $words));
}

// Catalogue des bots de l'agent avec leur lien d'invitation (chaque bot a son
// propre CLIENT_ID) — affiché sur la page d'accueil pour que le visiteur
// choisisse LE bot qu'il veut inviter sur son serveur. Cache fichier 5 min.
function bots_catalog(): array {
  if (DEMO) {
    return [
      ['name' => 'Shadow_community', 'invite' => 'https://discord.com/oauth2/authorize?client_id=100000000000000001&scope=bot+applications.commands&permissions=8', 'serveurs' => 1],
      ['name' => 'Colmar_rp', 'invite' => 'https://discord.com/oauth2/authorize?client_id=100000000000000002&scope=bot+applications.commands&permissions=8', 'serveurs' => 2],
    ];
  }
  $file = __DIR__ . '/cache-bots.php';
  $old = null;
  $raw = @file_get_contents($file);
  if ($raw !== false && str_starts_with($raw, CACHE_PREFIX)) {
    $old = json_decode(substr($raw, strlen(CACHE_PREFIX)), true);
    if (is_array($old) && isset($old['at']) && time() - $old['at'] < 300) return $old['bots'] ?? [];
  }
  [$st, $etat] = agent_call('/agent/etat');
  if ($st !== 200) {
    // Agent injoignable : on garde l'ancien catalogue et on ne réessaie que
    // dans 60 s (cache anti-daté) — la page d'accueil reste rapide.
    $bots = is_array($old) ? ($old['bots'] ?? []) : [];
    @file_put_contents($file, CACHE_PREFIX . json_encode(['at' => time() - 240, 'bots' => $bots]));
    return $bots;
  }
  [$map] = guild_map();
  $counts = [];
  foreach ($map as $b) $counts[$b] = ($counts[$b] ?? 0) + 1;
  $bots = [];
  foreach ($etat['bots'] ?? [] as $bot) {
    if (($bot['status'] ?? '') !== 'demarre') continue;
    [$st2, $inv] = agent_call('/agent/bots/' . rawurlencode($bot['name']) . '/invitation');
    $bots[] = [
      'name' => $bot['name'],
      'invite' => ($st2 === 200 && !empty($inv['url'])) ? $inv['url'] : null,
      'serveurs' => $counts[$bot['name']] ?? 0,
    ];
  }
  @file_put_contents($file, CACHE_PREFIX . json_encode(['at' => time(), 'bots' => $bots]));
  return $bots;
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
    'accent' => '#4dc3ff',
    'accroche' => 'Le Roleplay',
    'modules' => array_fill_keys(array_keys(DASH_MODULES), true),
    'annonces' => [],
  ];
}
function dash_config_get(): array {
  if (DEMO) $cfg = ['nom' => 'Zetku', 'accent' => '#4dc3ff', 'accroche' => 'Le Roleplay', 'modules' => ['apercu' => true, 'module' => true, 'membres' => true, 'roles' => true, 'salons' => true, 'niveaux' => true, 'whitelist' => false, 'tickets' => true], 'annonces' => [
    ['titre' => '🎉 Ouverture de la saison 3', 'texte' => 'Le serveur rouvre ses portes vendredi à 20 h — nouvelles entreprises, nouveaux métiers et une carte agrandie !'],
    ['titre' => '🛠️ Maintenance', 'texte' => 'Une maintenance est prévue dimanche matin. Le bot restera disponible pendant toute la durée.'],
    ['titre' => '⚔️ Événement PvP', 'texte' => 'Tournoi d\'arène samedi soir : inscrivez-vous avec /ticket, les 3 premiers gagnent un grade exclusif.'],
  ]];
  else { [$st, $d] = first_bot_api('/dashboard-config'); $cfg = ($st === 200 && !empty($d['config'])) ? $d['config'] : []; }
  $cfg = array_replace_recursive(dash_defaults(), is_array($cfg) ? $cfg : []);
  // Les annonces sont une LISTE : on prend telles quelles celles enregistrées
  // (array_replace_recursive fusionnerait mal des listes de tailles différentes).
  if (isset($cfg['annonces']) && !is_array($cfg['annonces'])) $cfg['annonces'] = [];
  return $cfg;
}
// Version mise en cache 60 s pour la page d'accueil publique : évite un
// aller-retour agent à CHAQUE visite anonyme.
function dash_config_cached(): array {
  if (DEMO) return dash_config_get();
  $file = __DIR__ . '/cache-dash.php';
  $raw = @file_get_contents($file);
  if ($raw !== false && str_starts_with($raw, CACHE_PREFIX)) {
    $c = json_decode(substr($raw, strlen(CACHE_PREFIX)), true);
    if (is_array($c) && isset($c['at'], $c['cfg']) && time() - $c['at'] < 60) return $c['cfg'];
  }
  $cfg = dash_config_get();
  @file_put_contents($file, CACHE_PREFIX . json_encode(['at' => time(), 'cfg' => $cfg]));
  return $cfg;
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
  // Le redirect_uri est auto-détecté depuis la page réelle, et mémorisé pour
  // renvoyer EXACTEMENT la même valeur lors de l'échange de code (exigence
  // Discord) — quel que soit le réglage de DASH_URL.
  $redirect = oauth_redirect_uri();
  $_SESSION['oauth_redirect'] = $redirect;
  header('Location: https://discord.com/oauth2/authorize?response_type=code'
    . '&client_id=' . DASH_CLIENT_ID
    . '&redirect_uri=' . rawurlencode($redirect)
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
  $redirect = $_SESSION['oauth_redirect'] ?? oauth_redirect_uri();
  unset($_SESSION['oauth_redirect']);
  [$st, $token, $raw] = http_req('https://discord.com/api/oauth2/token', 'POST', [
    'client_id' => DASH_CLIENT_ID,
    'client_secret' => DASH_CLIENT_SECRET,
    'grant_type' => 'authorization_code',
    'code' => $code,
    'redirect_uri' => $redirect,
  ], [], true);
  if ($st !== 200 || empty($token['access_token'])) {
    error_log("Dashboard : échange OAuth2 refusé (HTTP $st) — vérifiez DASH_CLIENT_SECRET et que « $redirect » est bien dans OAuth2 → Redirects. $raw");
    header('Location: ' . base_url() . '/index.php?erreur=oauth');
    exit;
  }
  $auth = ['Authorization: Bearer ' . $token['access_token']];
  [, $user] = http_req('https://discord.com/api/users/@me', 'GET', null, $auth);
  [, $guilds] = http_req('https://discord.com/api/users/@me/guilds', 'GET', null, $auth);
  if (empty($user['id']) || !is_array($guilds)) {
    header('Location: ' . base_url() . '/index.php?erreur=discord');
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
  $checks[] = ['Client ID Discord renseigné', $cid !== '', 'Portail développeur Discord → votre application → OAuth2 → Client ID.'];
  $checks[] = ['Client Secret Discord renseigné', $csec !== '', 'Portail développeur Discord → OAuth2 → « Reset Secret ».'];
  $checks[] = ['URL du dashboard détectée automatiquement : ' . request_scheme() . '://' . request_host() . request_script(), true, ''];
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

  $selfWritable = is_writable(__DIR__ . '/index.php');
  $majNote = $selfWritable
    ? '<div class="box" style="border-color:#3ba55d">🔄 <b style="color:#4bd07f">Mise à jour automatique disponible</b> : le créateur peut mettre le dashboard à jour en un clic depuis l\'espace Créateur.</div>'
    : '<div class="box">🔄 <b>Mise à jour automatique indisponible</b> : PHP ne peut pas réécrire index.php ici. Donnez les droits d\'écriture (chmod 644) pour l\'activer, sinon ré-uploadez le fichier à la main lors des mises à jour.</div>';

  $redirect = htmlspecialchars(oauth_redirect_uri());
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
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',system-ui,sans-serif;background:radial-gradient(900px 420px at 80% -10%,#14305c55,transparent 60%),#0a1122;color:#e7f1ff;padding:32px 18px;line-height:1.5;min-height:100vh}
.card{max-width:680px;margin:0 auto;background:#101a30;border:1px solid #24395e;border-radius:14px;padding:26px;box-shadow:0 12px 40px rgba(3,10,25,.5)}
h1{font-size:22px;margin-bottom:4px}.sub{color:#8aa2c8;font-size:13.5px;margin-bottom:18px}
.bn{border-radius:10px;padding:12px 15px;font-weight:600;font-size:14px;margin-bottom:18px}
.bn.ok{background:#43d68b22;color:#5fe3a1}.bn.ko{background:#ff9b3d22;color:#ffb066}
.row{display:flex;gap:11px;align-items:flex-start;padding:11px 0;border-top:1px solid #24395e}
.ic{font-size:16px;line-height:1.4}.lbl{font-size:14px;font-weight:500}.hint{color:#8aa2c8;font-size:12.5px;margin-top:2px}
.box{background:#0b1526;border:1px solid #24395e;border-radius:9px;padding:12px 14px;margin-top:18px}
.box b{color:#4dc3ff}code{background:#050b18;padding:2px 7px;border-radius:5px;font-size:13px;word-break:break-all;display:inline-block;margin-top:5px;border:1px solid #1c2f4e}
.copy{margin-top:8px;background:#16233f;border:1px solid #2a4a78;color:#bfe3ff;border-radius:7px;padding:6px 12px;font-size:12.5px;cursor:pointer;font-family:inherit}
a.btn{display:inline-block;margin-top:20px;background:linear-gradient(135deg,#39b6f5,#1f8fe0);color:#04121f;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:700;font-size:14px;box-shadow:0 0 14px rgba(77,195,255,.3)}
</style></head><body><div class="card">
<h1>🔧 Diagnostic du dashboard</h1><div class="sub">Vérification de la configuration (config.php) et de la liaison au bot.</div>
$banner
$rows
<div class="box">🔗 <b>URL de redirection à coller</b> dans Portail développeur Discord → OAuth2 → Redirects (auto-détectée depuis CETTE page — copiez-la telle quelle) :<br><code id="cburi">$redirect</code><br>
<button class="copy" onclick="navigator.clipboard.writeText(document.getElementById('cburi').textContent).then(()=>{this.textContent='✅ Copiée !'})">📋 Copier l'URL</button></div>
$majNote
<a class="btn" href="index.php">← Retour au dashboard</a>
</div></body></html>
HTML;
  exit;
}

// « Ajouter à Discord » : lien d'invitation d'un bot précis (?bot=nom) —
// chaque bot a son propre CLIENT_ID, l'utilisateur choisit EXACTEMENT lequel
// il veut sur son serveur. Sans ?bot, premier bot en ligne (comme avant).
if ($p === 'inviter') {
  $want = (string) ($_GET['bot'] ?? '');
  foreach (bots_catalog() as $b) {
    if (($want === '' || $b['name'] === $want) && !empty($b['invite'])) {
      header('Location: ' . $b['invite']);
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
    if (DEMO) {
      $out = ['user' => $_SESSION['user'], 'servers' => demo_servers(), 'role' => $role, 'dash' => $dash];
      if (!empty($role['creator'])) {
        // Sections créateur : TOUS les serveurs de chaque bot (même ceux où le
        // créateur n'est pas membre — ex. « Berlin RP » ci-dessous).
        $tous = array_merge(demo_servers(), [
          ['id' => '900000000000000004', 'name' => 'Berlin RP', 'icon' => null, 'membres' => 204, 'bot' => 'Colmar_rp', 'enligne' => true, 'creatorOnly' => true],
        ]);
        $byBot = [];
        foreach ($tous as $s) $byBot[$s['bot']][] = $s;
        $pb = [];
        foreach ($byBot as $b => $list) $pb[] = ['bot' => $b, 'label' => bot_label($b), 'servers' => $list];
        $out['parBot'] = $pb;
      }
      send_json(200, $out);
    }
    [$map, $infos] = guild_map();
    $servers = [];
    $mine = [];
    foreach ($_SESSION['guilds'] as $g) {
      if (!isset($map[$g['id']]) || !manages_guild($g['id'])) continue;
      $mine[$g['id']] = true;
      $servers[] = [
        'id' => $g['id'],
        'name' => $g['name'],
        'icon' => $g['icon'] ? "https://cdn.discordapp.com/icons/{$g['id']}/{$g['icon']}.png?size=128" : null,
        'membres' => $infos[$g['id']]['memberCount'] ?? null,
        'bot' => $map[$g['id']],
        'enligne' => true,
      ];
    }
    $out = ['user' => $_SESSION['user'], 'servers' => $servers, 'role' => $role, 'dash' => $dash];
    // ⚙️ Créateur : une section PAR BOT listant TOUS les serveurs où ce bot est
    // présent — y compris ceux où le créateur n'est pas membre (accès créateur).
    if (!empty($role['creator'])) {
      $byBot = [];
      foreach ($map as $gid2 => $bname) {
        $byBot[$bname][] = [
          'id' => $gid2,
          'name' => $infos[$gid2]['name'] ?? $gid2,
          'icon' => $infos[$gid2]['icon'] ?? null,
          'membres' => $infos[$gid2]['memberCount'] ?? null,
          'bot' => $bname,
          'enligne' => true,
          'creatorOnly' => empty($mine[$gid2]),
        ];
      }
      $pb = [];
      foreach ($byBot as $b => $list) $pb[] = ['bot' => $b, 'label' => bot_label($b), 'servers' => $list];
      $out['parBot'] = $pb;
    }
    send_json(200, $out);
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
    // 🔄 Version installée vs dernière release (créateur).
    if ($a === 'dash-version' && $_SERVER['REQUEST_METHOD'] === 'GET') {
      if (empty($role['creator'])) send_json(403, ['error' => 'Réservé au créateur du bot.']);
      if (DEMO) send_json(200, ['current' => 'v1.0.46', 'latest' => 'v1.0.47', 'updateAvailable' => true, 'auto' => true, 'writable' => true, 'error' => null]);
      send_json(200, dash_update_info());
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
        // La page d'accueil publique utilise un cache 60 s : on l'invalide pour
        // que les nouveaux messages défilants apparaissent immédiatement.
        if ($st === 200) @unlink(__DIR__ . '/cache-dash.php');
        send_json($st ?: 502, $d ?: ['error' => 'Bot injoignable.']);
      }
      if ($a === 'bot-status-save') {
        if (empty($role['creator'])) send_json(403, ['error' => 'Réservé au créateur du bot.']);
        [$st, $d] = named_bot_api((string) ($post['bot'] ?? ''), '/bot-status', 'POST', ['actorId' => $uid, 'status' => $post['status'] ?? null]);
        send_json($st ?: 502, $d ?: ['error' => 'Bot injoignable.']);
      }
      // 🔄 Mise à jour du dashboard : se réécrit avec la dernière release.
      if ($a === 'dash-maj') {
        if (empty($role['creator'])) send_json(403, ['error' => 'Réservé au créateur du bot.']);
        $r = dash_self_update();
        send_json(isset($r['error']) ? 400 : 200, $r);
      }
      // 🔁 Activer / désactiver la mise à jour automatique.
      if ($a === 'dash-auto') {
        if (empty($role['creator'])) send_json(403, ['error' => 'Réservé au créateur du bot.']);
        dash_set_autoupdate(!empty($post['on']));
        send_json(200, ['ok' => true, 'auto' => dash_autoupdate_enabled()]);
      }
    }
    send_json(404, ['error' => 'Action inconnue.']);
  }

  // api-serveur : &gid=…&a=…
  $gid = $_GET['gid'] ?? '';
  $a = $_GET['a'] ?? '';
  if (!preg_match('/^\d{5,25}$/', $gid)) send_json(400, ['error' => 'Serveur invalide.']);
  // Le CRÉATEUR du bot peut gérer tous les serveurs où ses bots sont présents,
  // même sans y être membre ; les autres doivent administrer le serveur.
  if (!manages_guild($gid)) {
    $roleSrv = my_role();
    if (empty($roleSrv['creator'])) send_json(403, ['error' => 'Vous n\'administrez pas ce serveur.']);
  }

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
  /* ⚔️ Thème « Aincrad » (Sword Art Online) : ciel nocturne du château
     flottant, panneaux d'acier bleuté et lueurs cyan des fenêtres système. */
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --bg:#0a1122; --bg2:#070d1a; --panel:#101a30; --panel2:#16233f; --border:#24395e; --text:#e7f1ff;
          --muted:#8aa2c8; --accent:#4dc3ff; --accent2:#2ea8e8; --green:#43d68b; --red:#ff5f6b; --blue:#62b8ff;
          --gold:#ff9b3d; }
  body { font-family:'Segoe UI',system-ui,sans-serif; color:var(--text); min-height:100vh;
         background:radial-gradient(1.4px 1.4px at 12% 18%, rgba(231,241,255,.30), transparent 55%),
                    radial-gradient(1.2px 1.2px at 38% 64%, rgba(231,241,255,.22), transparent 55%),
                    radial-gradient(1.6px 1.6px at 63% 28%, rgba(231,241,255,.26), transparent 55%),
                    radial-gradient(1.2px 1.2px at 86% 70%, rgba(231,241,255,.18), transparent 55%),
                    radial-gradient(1.4px 1.4px at 74% 6%, rgba(231,241,255,.24), transparent 55%),
                    radial-gradient(1.2px 1.2px at 22% 86%, rgba(231,241,255,.18), transparent 55%),
                    radial-gradient(1100px 520px at 82% -12%, #14305c66, transparent 60%),
                    radial-gradient(900px 460px at 8% 112%, #0e3a5e44, transparent 60%),
                    linear-gradient(180deg, #0a1122 0%, #0b142a 100%);
         background-attachment:fixed;
         background-color:var(--bg); }
  a { color:inherit; text-decoration:none; }
  button { background:var(--panel2); color:var(--text); border:1px solid var(--border); border-radius:8px;
           padding:9px 16px; font-size:13.5px; cursor:pointer; font-family:inherit; transition:filter .12s, box-shadow .15s, border-color .15s; }
  button:hover { filter:brightness(1.15); border-color:#2a4a78; }
  button.accent { background:linear-gradient(135deg, #39b6f5, #1f8fe0); border-color:#57c8ff; color:#04121f;
                  font-weight:700; box-shadow:0 0 14px rgba(77,195,255,.35); }
  input, select, textarea { background:#0b1526; border:1px solid var(--border); color:var(--text);
           border-radius:9px; padding:11px 13px; font-size:13.5px; width:100%; font-family:inherit; }
  input:focus, select:focus, textarea:focus { outline:none; border-color:var(--accent);
           box-shadow:0 0 0 2px rgba(77,195,255,.18); }
  /* ---- barre du haut (fenêtre système translucide) ---- */
  .nav { display:flex; align-items:center; gap:26px; padding:0 26px; height:64px; background:rgba(7,13,26,.88);
         backdrop-filter:blur(10px); border-bottom:1px solid var(--border); position:sticky; top:0; z-index:20;
         box-shadow:0 6px 24px rgba(3,10,25,.35); }
  .nav .brand { display:flex; align-items:center; gap:10px; font-weight:800; font-size:19px; letter-spacing:.06em; color:var(--accent); text-shadow:0 0 14px rgba(77,195,255,.45); }
  .nav .brand .lg { font-size:24px; }
  .nav .links { display:flex; gap:22px; font-size:13px; font-weight:700; letter-spacing:.06em; }
  .nav .links a { color:var(--text); opacity:.85; } .nav .links a:hover { color:var(--accent); opacity:1; }
  .nav .spacer { margin-left:auto; }
  .nav .supportbtn { border:1.5px solid var(--accent); color:var(--accent); background:transparent; border-radius:22px;
                     padding:9px 22px; font-weight:700; letter-spacing:.05em; font-size:12.5px; }
  .nav .me { display:flex; align-items:center; gap:9px; font-weight:600; font-size:14px; }
  .nav .me img { width:36px; height:36px; border-radius:50%; border:2px solid var(--accent); box-shadow:0 0 10px rgba(77,195,255,.35); }
  /* Barre de vie sous le pseudo — clin d'œil SAO. */
  .nav .me .meinfo { display:flex; flex-direction:column; gap:3px; align-items:flex-start; }
  .nav .me .hpbar { width:104px; height:5px; background:#20344f; border-radius:3px; overflow:hidden; }
  .nav .me .hpbar i { display:block; height:100%; width:86%; border-radius:3px;
                      background:linear-gradient(90deg,#43d68b,#2fbf76); box-shadow:0 0 6px rgba(67,214,139,.7); }
  .sub { color:var(--muted); font-size:13.5px; margin-bottom:14px; }
  /* ---- interrupteurs façon DraftBot ---- */
  .switch { position:relative; width:46px; height:25px; flex-shrink:0; display:inline-block; }
  .switch input { opacity:0; width:0; height:0; }
  .switch .sl { position:absolute; inset:0; background:#253a5c; border-radius:25px; transition:.18s; cursor:pointer; }
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
  .rail .ric.on { border-color:var(--accent); box-shadow:0 0 12px rgba(77,195,255,.45); }
  .side { width:250px; background:var(--panel); border-right:1px solid var(--border); flex-shrink:0; }
  .side .head { padding:20px 16px; text-align:center; border-bottom:1px solid var(--border);
                background:linear-gradient(180deg, rgba(77,195,255,.06), transparent); }
  .side .head img, .side .head .noicon { width:76px; height:76px; border-radius:50%; margin-bottom:9px;
                border:2px solid var(--border); box-shadow:0 0 18px rgba(77,195,255,.15); }
  .side .head .noicon { background:var(--panel2); display:inline-flex; align-items:center; justify-content:center; font-size:30px; }
  .side .head .nm { font-family:'Georgia',serif; font-weight:700; font-size:16px; }
  .side .item { display:flex; align-items:center; gap:10px; padding:11px 16px; font-size:13.5px; color:var(--muted);
                cursor:pointer; border-left:3px solid transparent; transition:background .12s, color .12s; }
  .side .item:hover { background:var(--panel2); color:var(--text); }
  .side .item.on { background:linear-gradient(90deg, rgba(77,195,255,.14), transparent); color:var(--accent);
                   border-left-color:var(--accent); font-weight:700; text-shadow:0 0 12px rgba(77,195,255,.35); }
  .main { flex:1; padding:34px 42px; min-width:0; max-width:1150px; }
  h1.pagetitle { font-size:25px; font-weight:800; margin-bottom:26px; letter-spacing:.02em; position:relative; padding-bottom:12px; }
  h1.pagetitle::after { content:''; position:absolute; left:0; bottom:0; width:64px; height:3px; border-radius:2px;
                        background:linear-gradient(90deg, var(--accent), transparent); box-shadow:0 0 10px rgba(77,195,255,.5); }
  /* Chaque section est une « fenêtre système » translucide. */
  .sec { margin-bottom:26px; background:rgba(16,26,48,.55); border:1px solid var(--border); border-radius:14px;
         padding:20px 22px; box-shadow:inset 0 1px 0 rgba(191,227,255,.07), 0 8px 26px rgba(3,10,25,.25); }
  .sechead { display:flex; align-items:flex-start; gap:14px; margin-bottom:8px; }
  .sechead .t { font-size:16.5px; font-weight:700; }
  .sechead .t::before { content:'◆'; color:var(--accent); margin-right:8px; font-size:11px; vertical-align:2px;
                        text-shadow:0 0 8px rgba(77,195,255,.8); }
  .sechead .d { color:var(--muted); font-size:13px; margin-top:3px; }
  .sechead .sw { margin-left:auto; }
  .flabel { font-size:11px; letter-spacing:.08em; font-weight:800; color:#a9c2e8; text-transform:uppercase; margin:16px 0 7px; }
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
  .tile { background:linear-gradient(160deg, #121f3a, #0e1830); border:1px solid var(--border); border-radius:12px;
          padding:16px; transition:.15s; }
  .tile:hover { border-color:#2a4a78; transform:translateY(-2px); }
  .tile .tv { font-size:24px; font-weight:800; color:var(--accent); text-shadow:0 0 14px rgba(77,195,255,.45); }
  .tile .tl { color:var(--muted); font-size:12px; margin-top:4px; }
  .row { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:11px 15px;
         margin-bottom:8px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:13.5px;
         transition:border-color .15s; }
  .row:hover { border-color:#2a4a78; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:15px; }
  /* Cartes serveur façon carte de quête. */
  .scard { background:linear-gradient(160deg, #121f3a, #0d1730); border:1px solid var(--border); border-radius:14px;
           padding:19px; display:flex; align-items:center; gap:14px; cursor:pointer; transition:.18s;
           position:relative; overflow:hidden; }
  .scard::before { content:''; position:absolute; left:0; top:0; bottom:0; width:3px;
                   background:linear-gradient(180deg, var(--accent), transparent); opacity:0; transition:.18s; }
  .scard:hover { border-color:var(--accent); transform:translateY(-3px);
                 box-shadow:0 12px 30px rgba(3,10,25,.5), 0 0 18px rgba(77,195,255,.12); }
  .scard:hover::before { opacity:1; }
  .scard img, .scard .noicon { width:54px; height:54px; border-radius:50%; }
  .scard .noicon { background:var(--panel2); display:flex; align-items:center; justify-content:center; font-size:22px; }
  /* Pastille « accès créateur » + têtes de section par bot (espace créateur). */
  .ownchip { background:rgba(255,155,61,.12); border:1px solid rgba(255,155,61,.5); color:#ffb066; font-size:10.5px;
             border-radius:10px; padding:1px 8px; font-weight:700; letter-spacing:.04em; white-space:nowrap; }
  .botsec { display:flex; align-items:center; gap:10px; margin:26px 0 14px; }
  .botsec .bt { font-size:17px; font-weight:800; color:var(--accent); text-shadow:0 0 12px rgba(77,195,255,.35); }
  .botsec .bn2 { color:var(--muted); font-size:12.5px; }
  .botsec::after { content:''; flex:1; height:1px; background:linear-gradient(90deg, var(--border), transparent); }
  .toast { position:fixed; bottom:24px; right:24px; background:rgba(22,35,63,.92); backdrop-filter:blur(8px);
           border:1px solid var(--accent); border-radius:10px; padding:13px 18px; font-size:13.5px; opacity:0;
           transform:translateY(10px); transition:opacity .22s, transform .22s; z-index:60;
           box-shadow:0 10px 30px rgba(0,0,0,.35); pointer-events:none; }
  .toast.on { opacity:1; transform:translateY(0); }
  .toast.ok { border-color:var(--green); }
  .toast.err { border-color:var(--red); }
  .empty { color:var(--muted); padding:48px; text-align:center; }
  .wrap { max-width:1100px; margin:0 auto; padding:30px 20px; }
  /* ---- onglets (espace staff) ---- */
  .tabbar { display:flex; gap:4px; border-bottom:1px solid var(--border); margin:16px 0 22px; flex-wrap:wrap; }
  .tab { padding:10px 18px; font-size:13.5px; color:var(--muted); cursor:pointer; border-bottom:2px solid transparent;
         margin-bottom:-1px; border-radius:8px 8px 0 0; transition:background .12s, color .12s; }
  .tab:hover { color:var(--text); background:rgba(77,195,255,.05); }
  .tab.on { color:var(--accent); border-bottom-color:var(--accent); font-weight:700; text-shadow:0 0 10px rgba(77,195,255,.4); }
  .chip { background:#0b1526; border:1px solid var(--border); border-radius:14px; padding:4px 11px; font-size:12.5px;
          display:inline-flex; gap:6px; align-items:center; }
  .chip button { padding:0 5px; font-size:11px; background:transparent; border:0; color:var(--muted); }
  /* ---- bouton flottant Créateur (en bas à gauche) ---- */
  .cfab { position:fixed; bottom:22px; left:22px; width:52px; height:52px; border-radius:50%;
          background:linear-gradient(135deg,#39b6f5,#1f8fe0); color:#04121f; font-size:24px; display:flex;
          align-items:center; justify-content:center; cursor:pointer; z-index:40; transition:transform .15s;
          animation:cpulse 2.6s ease-in-out infinite; }
  .cfab:hover { transform:scale(1.08); }
  @keyframes cpulse { 0%,100% { box-shadow:0 8px 26px rgba(0,0,0,.4), 0 0 10px rgba(77,195,255,.25); }
                      50% { box-shadow:0 8px 26px rgba(0,0,0,.4), 0 0 26px rgba(77,195,255,.6); } }
  /* ---- barre de défilement raffinée ---- */
  ::-webkit-scrollbar { width:10px; height:10px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:#28405f; border-radius:6px; border:2px solid var(--bg); }
  ::-webkit-scrollbar-thumb:hover { background:#33507a; }
  * { scrollbar-width:thin; scrollbar-color:#28405f transparent; }
  :focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
  /* ---- chargement (spinner) ---- */
  .spin { width:34px; height:34px; border:3px solid var(--border); border-top-color:var(--accent);
          border-radius:50%; animation:spin .7s linear infinite; margin:44px auto; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .loadbox { display:flex; flex-direction:column; align-items:center; gap:12px; padding:40px; color:var(--muted); font-size:13.5px; }
  /* ---- pastille de statut (bot en ligne) ---- */
  .dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; display:inline-block; }
  .dot.up { background:var(--green); box-shadow:0 0 7px rgba(67,214,139,.8); }
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

// 🔄 Mise à jour 100 % automatique : à chaque chargement de page (hors routes
// API/OAuth qui sortent plus haut), on vérifie — au plus toutes les 6 h — si une
// nouvelle release existe et on l'installe silencieusement.
dash_auto_update_tick();

$navLinks = '<span class="links"><a href="' . htmlspecialchars($URL_DOCS) . '" target="_blank">DOCUMENTATION</a></span>';
$navSupport = $URL_SUPPORT !== '' ? '<a href="' . htmlspecialchars($URL_SUPPORT) . '" target="_blank"><button class="supportbtn">SUPPORT</button></a>' : '';
$NOM_HTML = htmlspecialchars($NOM_BOT);

if (empty($_SESSION['user'])) {
  header('Content-Type: text/html; charset=utf-8');
  // Aide à la connexion : l'URL de redirection exacte à enregistrer côté
  // Discord est affichée sur la page (auto-détectée), avec bouton copier,
  // ainsi que le Client ID utilisé (avec plusieurs bots = plusieurs
  // applications Discord, l'URL doit être enregistrée dans LA BONNE).
  $oauthUri = htmlspecialchars(oauth_redirect_uri());
  $cidHtml = htmlspecialchars(defined('DASH_CLIENT_ID') ? DASH_CLIENT_ID : '');
  // La page d'accueil est COMPOSÉE par le créateur (Espace Créateur → Page
  // d'accueil) : nom, couleur, accroche et messages défilants (cache 60 s).
  $dashCfg = dash_config_cached();
  $cut = fn($s, $n) => function_exists('mb_substr') ? mb_substr($s, 0, $n) : substr($s, 0, $n);
  $nomLanding = trim((string) ($dashCfg['nom'] ?? '')) !== '' ? $dashCfg['nom'] : $NOM_BOT;
  $NOMD = htmlspecialchars($nomLanding);
  $ACCENT_CSS = preg_match('/^#[0-9a-fA-F]{6}$/', (string) ($dashCfg['accent'] ?? '')) ? $dashCfg['accent'] : '#4dc3ff';
  $accroche = trim((string) ($dashCfg['accroche'] ?? ''));
  $taglineHtml = $accroche !== '' ? '<div class="tagline">Un bot pour <b>' . htmlspecialchars($accroche) . '</b></div>' : '';
  // Messages défilants de la page d'accueil (max 8, composés par le créateur).
  $annonces = [];
  foreach (($dashCfg['annonces'] ?? []) as $an) {
    if (!is_array($an)) continue;
    $ti = trim((string) ($an['titre'] ?? ''));
    $tx = trim((string) ($an['texte'] ?? ''));
    if ($ti === '' && $tx === '') continue;
    $annonces[] = ['titre' => $cut($ti, 80), 'texte' => $cut($tx, 400)];
    if (count($annonces) >= 8) break;
  }
  $annJson = json_encode($annonces, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE) ?: '[]';
  $annHtml = $annonces ? '<div class="annwin"><div class="anhead">A N N O N C E S</div>'
    . '<button class="anv" id="anprev" aria-label="Message précédent">‹</button>'
    . '<div class="anbody" id="anbody"><div class="antitre" id="antitre"></div><div class="antexte" id="antexte"></div></div>'
    . '<button class="anv" id="annext" aria-label="Message suivant">›</button>'
    . '<div class="andots" id="andots"></div></div>' : '';
  // Choix du bot à inviter : chaque bot de l'agent a sa propre application
  // Discord (CLIENT_ID) — l'utilisateur choisit exactement lequel il ajoute.
  $botsCat = array_values(array_filter(bots_catalog(), fn($b) => !empty($b['invite'])));
  $botBtns = '';
  foreach ($botsCat as $b) {
    $nsrv = (int) ($b['serveurs'] ?? 0);
    $botBtns .= '<a href="index.php?p=inviter&bot=' . htmlspecialchars(rawurlencode($b['name'])) . '">'
      . '<button class="addbtn">🤖 Inviter <b>' . htmlspecialchars(bot_label($b['name'])) . '</b>'
      . ($nsrv > 0 ? '<span class="bcount">' . $nsrv . ' serveur' . ($nsrv > 1 ? 's' : '') . '</span>' : '')
      . '</button></a>';
  }
  $botPick = $botBtns === ''
    ? '<a href="index.php?p=inviter"><button class="addbtn">🎮 Inviter le bot sur un serveur</button></a>'
    : (count($botsCat) > 1 ? '<div class="bphead">🎮 CHOISISSEZ VOTRE BOT</div>' : '') . $botBtns;
  $err = $_GET['erreur'] ?? '';
  $errHtml = '';
  if ($err === 'oauth') {
    $errHtml = '<div class="saowarn"><div class="wt">⚠ SYSTEM ALERT</div>Discord a refusé la connexion.<br>'
      . '1️⃣ Vérifiez le <b>Client Secret</b> dans config.php (application <b>' . $cidHtml . '</b>).<br>'
      . '2️⃣ Vérifiez que l\'URL affichée plus bas est dans <b>OAuth2 → Redirects</b> de CETTE application (puis Save Changes).</div>';
  } elseif ($err !== '') {
    $errHtml = '<div class="saowarn"><div class="wt">⚠ SYSTEM ALERT</div>La connexion Discord a échoué — réessayez dans un instant.</div>';
  }
  echo <<<HTML
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>$NOMD — Aincrad</title>
<style>$THEME
  :root { --accent:$ACCENT_CSS; }
  /* ================== 🗡️ ENTRÉE DANS L'AINCRAD ================== */
  .hero { position:relative; min-height:calc(100vh - 64px); display:flex; flex-direction:column; align-items:center;
          justify-content:center; text-align:center; padding:20px 20px 170px; overflow:hidden; }
  .star { position:absolute; background:#fff; border-radius:50%; opacity:.5; animation:tw 3s infinite; }
  @keyframes tw { 0%,100% { opacity:.12; } 50% { opacity:.75; } }
  .shoot { position:absolute; width:120px; height:2px; border-radius:2px; pointer-events:none;
           background:linear-gradient(90deg, rgba(191,227,255,.9), transparent); opacity:0; animation:shoot 1.4s linear forwards; }
  @keyframes shoot { 0% { opacity:0; transform:translate(0,0) rotate(24deg); } 8% { opacity:.9; }
                     100% { opacity:0; transform:translate(-340px,150px) rotate(24deg); } }
  /* --- château d'Aincrad flottant --- */
  .aincrad { position:absolute; left:50%; top:44%; transform:translate(-50%,-50%); width:min(560px,86vw);
             opacity:.5; pointer-events:none; animation:hover 9s ease-in-out infinite; z-index:0; }
  @keyframes hover { 0%,100% { transform:translate(-50%,-50%); } 50% { transform:translate(-50%,calc(-50% - 16px)); } }
  .cloud { position:absolute; border-radius:50%; background:#9fc4ff; filter:blur(26px); opacity:.09; pointer-events:none; }
  .c1 { width:420px; height:90px; top:26%; animation:drift 65s linear infinite; }
  .c2 { width:300px; height:70px; top:58%; animation:drift 45s linear infinite; animation-delay:-20s; }
  .c3 { width:520px; height:110px; top:74%; animation:drift 85s linear infinite; animation-delay:-48s; }
  @keyframes drift { from { left:-40%; } to { left:110%; } }
  /* --- titre --- */
  .fg { position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; }
  .gametitle { font-size:clamp(34px,7vw,64px); font-weight:900; letter-spacing:.14em; line-height:1.1;
               background:linear-gradient(180deg,#eaf7ff 20%,#69ccff 70%,#2ea8e8); -webkit-background-clip:text;
               background-clip:text; color:transparent; filter:drop-shadow(0 0 22px rgba(77,195,255,.35)); animation:fadeup 1s ease .1s both; }
  .subtitle { color:var(--muted); letter-spacing:.55em; font-size:12px; font-weight:700; margin:10px 0 4px; text-transform:uppercase; animation:fadeup 1s ease .3s both; }
  .floor { color:#bfe3ff; font-size:13.5px; margin-bottom:14px; animation:fadeup 1s ease .45s both; }
  .floor b { color:var(--accent); }
  .quote { color:var(--muted); font-style:italic; font-size:14px; max-width:520px; min-height:42px; line-height:1.5;
           transition:opacity .4s; margin-bottom:24px; animation:fadeup 1s ease .6s both; }
  @keyframes fadeup { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:none; } }
  /* --- fenêtre système SAO --- */
  .syswin { position:relative; z-index:2; background:rgba(16,26,48,.72); border:1px solid #2a4a78; border-radius:14px;
            padding:22px 26px 20px; min-width:min(430px,92vw); backdrop-filter:blur(8px); animation:fadeup 1s ease .75s both;
            box-shadow:0 18px 60px rgba(3,10,25,.55), inset 0 1px 0 rgba(191,227,255,.12); }
  .syswin .swhead { display:flex; align-items:center; gap:8px; justify-content:center; margin-bottom:14px;
                    color:#9fc9ef; font-size:10.5px; letter-spacing:.35em; font-weight:800; }
  .syswin .swhead i { width:7px; height:7px; border-radius:50%; background:#4dc3ff; box-shadow:0 0 8px rgba(77,195,255,.9); display:inline-block; }
  .linkstart { display:block; width:100%; background:linear-gradient(135deg,#39b6f5,#1f8fe0); border:0; color:#04121f;
               font-size:19px; font-weight:900; letter-spacing:.22em; padding:16px 30px; border-radius:10px;
               box-shadow:0 0 24px rgba(77,195,255,.45); animation:pulse 2.2s ease-in-out infinite; cursor:pointer; }
  .linkstart:hover { filter:brightness(1.12); }
  @keyframes pulse { 0%,100% { box-shadow:0 0 16px rgba(77,195,255,.35); } 50% { box-shadow:0 0 34px rgba(77,195,255,.75); } }
  .linksub { color:var(--muted); font-size:11.5px; margin-top:8px; }
  .addbtn { margin-top:14px; background:transparent; border:1.5px solid #2a4a78; color:#bfe3ff; font-size:13px;
            font-weight:600; padding:11px 22px; border-radius:9px; width:100%; }
  /* --- alerte système (façon annonce du jeu) --- */
  .saowarn { position:relative; z-index:2; background:rgba(60,26,6,.66); border:1.5px solid #ff9b3d; border-radius:12px;
             padding:14px 18px; font-size:13.5px; color:#ffd9b0; max-width:560px; margin-bottom:22px; line-height:1.65;
             backdrop-filter:blur(6px); box-shadow:0 0 26px rgba(255,155,61,.25); text-align:left; }
  .saowarn .wt { color:#ff9b3d; font-weight:900; letter-spacing:.3em; font-size:12px; margin-bottom:6px; text-align:center; }
  /* --- encart URL de redirection --- */
  .cbx { margin-top:26px; background:#0b152699; border:1px solid var(--border); border-radius:10px; padding:12px 16px;
         font-size:12.5px; color:var(--muted); max-width:600px; line-height:1.6; position:relative; z-index:2; backdrop-filter:blur(6px); }
  .cbx code { background:#050b18; border:1px solid #1c2f4e; border-radius:5px; padding:2px 7px; font-size:12px;
              word-break:break-all; display:inline-block; margin:4px 0; color:#bfe3ff; }
  .cbx button { padding:4px 10px; font-size:11.5px; border-radius:6px; margin-left:4px; }
  .wave { position:absolute; bottom:-4px; left:0; right:0; pointer-events:none; }
  .lore { position:absolute; bottom:12px; left:0; right:0; text-align:center; color:#5a7ba8; font-size:11.5px; letter-spacing:.08em; z-index:2; }
  /* --- accroche + choix du bot + annonces défilantes --- */
  .tagline { color:#bfe3ff; font-size:15px; margin-bottom:12px; animation:fadeup 1s ease .5s both; }
  .tagline b { color:var(--accent); }
  .bphead { color:#9fc9ef; font-size:10.5px; letter-spacing:.3em; font-weight:800; margin:16px 0 2px; }
  .addbtn b { color:var(--accent); }
  .bcount { color:var(--muted); font-weight:400; font-size:11px; margin-left:7px; }
  .annwin { position:relative; z-index:2; margin-top:26px; background:rgba(16,26,48,.72); border:1px solid #2a4a78;
            border-radius:14px; padding:18px 14px 20px; width:min(560px,92vw); backdrop-filter:blur(8px);
            box-shadow:0 18px 60px rgba(3,10,25,.45), inset 0 1px 0 rgba(191,227,255,.12);
            display:flex; align-items:center; gap:8px; animation:fadeup 1s ease .9s both; }
  .annwin .anhead { position:absolute; top:-9px; left:50%; transform:translateX(-50%); background:#101a30;
                    border:1px solid #2a4a78; border-radius:12px; color:#9fc9ef; font-size:9.5px; letter-spacing:.25em;
                    font-weight:800; padding:2px 12px; white-space:nowrap; }
  .annwin .anbody { flex:1; min-width:0; min-height:56px; transition:opacity .3s; text-align:left; }
  .annwin .antitre { font-weight:800; font-size:14.5px; color:var(--accent); margin-bottom:4px; }
  .annwin .antexte { color:var(--text); font-size:13px; line-height:1.55; white-space:pre-wrap; }
  .annwin .anv { background:transparent; border:0; color:#8aa2c8; font-size:24px; cursor:pointer; padding:0 8px; flex-shrink:0; line-height:1; }
  .annwin .anv:hover { color:var(--accent); }
  .andots { position:absolute; bottom:-7px; left:50%; transform:translateX(-50%); display:flex; gap:6px; }
  .andots i { width:8px; height:8px; border-radius:50%; background:#253a5c; cursor:pointer; border:1px solid #2a4a78; }
  .andots i.on { background:var(--accent); box-shadow:0 0 7px rgba(77,195,255,.8); }
  /* ================== ⚡ SÉQUENCE « LINK START » ================== */
  #ls { position:fixed; inset:0; background:#000; z-index:100; display:flex; align-items:center; justify-content:center;
        overflow:hidden; cursor:pointer; transition:opacity .5s; }
  #ls .lstxt { color:#fff; font-size:clamp(30px,7vw,58px); font-weight:900; letter-spacing:.3em; opacity:0;
               animation:lstxt 1.1s ease .15s forwards; text-shadow:0 0 30px rgba(255,255,255,.6); }
  @keyframes lstxt { 0% { opacity:0; transform:scale(.92); } 25% { opacity:1; transform:scale(1); }
                     85% { opacity:1; } 100% { opacity:0; transform:scale(1.06); } }
  #ls .ray { position:absolute; left:50%; top:50%; width:3px; height:3px; border-radius:3px; opacity:0; }
  @keyframes ray { 0% { opacity:0; transform:rotate(var(--a)) translateY(0) scaleY(.2); }
                   20% { opacity:1; } 100% { opacity:0; transform:rotate(var(--a)) translateY(-130vmax) scaleY(60); } }
  @media (prefers-reduced-motion: reduce) { #ls { display:none; } .aincrad, .linkstart { animation:none; } }
</style>
</head>
<body>
<div id="ls"><div class="lstxt">LINK&nbsp;START</div></div>
<div class="nav">
  <span class="brand"><span class="lg">⚔️</span>$NOMD</span>
  $navLinks
  <span class="spacer"></span>
  $navSupport
  <a href="index.php?p=login"><button class="accent">Se connecter</button></a>
</div>
<div class="hero" id="hero">
  <div class="cloud c1"></div><div class="cloud c2"></div><div class="cloud c3"></div>
  <svg class="aincrad" viewBox="0 0 560 380" aria-hidden="true">
    <defs><linearGradient id="ac" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3f6ea8"/><stop offset="1" stop-color="#101a30"/></linearGradient></defs>
    <g fill="url(#ac)" stroke="#7fb7e8" stroke-opacity=".35" stroke-width="1.5">
      <polygon points="280,4 292,44 268,44"/>
      <rect x="262" y="44" width="36" height="22" rx="3"/>
      <polygon points="215,66 345,66 355,92 205,92"/>
      <polygon points="185,96 375,96 390,126 170,126"/>
      <polygon points="150,130 410,130 430,166 130,166"/>
      <polygon points="110,170 450,170 475,212 85,212"/>
      <polygon points="65,216 495,216 520,264 40,264"/>
      <polygon points="40,268 520,268 445,330 280,376 115,330"/>
    </g>
    <g fill="#ffe9a8" opacity=".8">
      <circle cx="240" cy="240" r="2.2"/><circle cx="330" cy="238" r="2.2"/><circle cx="180" cy="190" r="2"/>
      <circle cx="390" cy="192" r="2"/><circle cx="285" cy="150" r="2"/><circle cx="140" cy="242" r="2"/>
      <circle cx="425" cy="244" r="2"/><circle cx="300" cy="110" r="1.8"/><circle cx="255" cy="80" r="1.6"/>
    </g>
    <ellipse cx="280" cy="372" rx="150" ry="9" fill="#4dc3ff" opacity=".28"/>
  </svg>
  <div class="fg">
    $errHtml
    <div class="gametitle">$NOMD</div>
    <div class="subtitle">— Aincrad Online —</div>
    <div class="floor">🗡️ <b>Étage 1</b> · Ville des Débuts</div>
    $taglineHtml
    <div class="quote" id="quote">« Ceci est peut-être un jeu, mais ce n'est pas quelque chose à quoi on joue. »</div>
    <div class="syswin">
      <div class="swhead"><i></i><i></i><i></i>&nbsp;&nbsp;S Y S T È M E&nbsp;&nbsp;<i></i><i></i><i></i></div>
      <a href="index.php?p=login"><button class="linkstart">▶ LINK START</button></a>
      <div class="linksub">Connexion avec votre compte Discord — gérez vos serveurs</div>
      $botPick
    </div>
    $annHtml
    <div class="cbx">🔗 <b style="color:var(--accent)">Première connexion ?</b> Enregistrez cette URL dans
      <b>Portail développeur Discord → OAuth2 → Redirects</b> puis <b>Save Changes</b> (une seule fois) :<br>
      <code id="cburi">$oauthUri</code>
      <button onclick="navigator.clipboard.writeText(document.getElementById('cburi').textContent).then(()=>{this.textContent='✅ Copiée'})">📋 Copier</button><br>
      ⚠️ Plusieurs bots = plusieurs applications Discord : faites-le dans l'application <b style="color:#bfe3ff">$cidHtml</b>
      (celle du Client ID de config.php), pas une autre.
    </div>
    <a href="index.php?p=diag" style="margin-top:16px;color:var(--muted);font-size:12.5px">🔧 Vérifier ma configuration</a>
  </div>
  <svg class="wave" viewBox="0 0 1440 180" preserveAspectRatio="none" height="150">
    <path fill="#1f8fe0" d="M0,96 C240,150 480,40 720,80 C960,120 1200,150 1440,90 L1440,180 L0,180 Z" opacity=".45"/>
    <path fill="#101a30" d="M0,130 C260,170 520,80 760,110 C1000,140 1240,170 1440,120 L1440,180 L0,180 Z"/>
  </svg>
  <div class="lore">⚔️ Château flottant d'Aincrad · 100 étages · « Vaincre le boss de l'étage pour accéder au suivant »</div>
</div>
<script>
// ---- Séquence LINK START (une fois par session, clic pour passer) ----
var ls = document.getElementById('ls');
function endLS(){ if (!ls) return; ls.style.opacity = 0; setTimeout(function(){ if (ls && ls.parentNode) ls.parentNode.removeChild(ls); ls = null; }, 500); }
try {
  if (sessionStorage.getItem('ls_done')) { endLS(); }
  else {
    sessionStorage.setItem('ls_done', '1');
    var hues = [0, 30, 55, 120, 180, 210, 260, 300];
    setTimeout(function(){
      if (!ls) return;
      for (var r = 0; r < 90; r++) {
        var d = document.createElement('div');
        d.className = 'ray';
        var hue = hues[Math.floor(Math.random() * hues.length)];
        d.style.background = 'hsl(' + hue + ', 90%, 65%)';
        d.style.setProperty('--a', (Math.random() * 360) + 'deg');
        d.style.animation = 'ray ' + (0.7 + Math.random() * 0.6) + 's linear ' + (Math.random() * 0.35) + 's forwards';
        ls.appendChild(d);
      }
    }, 1000);
    setTimeout(endLS, 2350);
    ls.addEventListener('click', endLS);
  }
} catch (e) { endLS(); }
// ---- Ciel : étoiles + étoiles filantes ----
var hero = document.getElementById('hero');
for (var i = 0; i < 110; i++) {
  var s = document.createElement('div');
  s.className = 'star';
  var size = Math.random() * 2.4 + 1;
  s.style.width = size + 'px'; s.style.height = size + 'px';
  s.style.left = Math.random() * 100 + '%'; s.style.top = Math.random() * 82 + '%';
  s.style.animationDelay = (Math.random() * 3) + 's';
  hero.appendChild(s);
}
setInterval(function(){
  var f = document.createElement('div');
  f.className = 'shoot';
  f.style.left = (30 + Math.random() * 65) + '%';
  f.style.top = (Math.random() * 40) + '%';
  hero.appendChild(f);
  setTimeout(function(){ if (f.parentNode) f.parentNode.removeChild(f); }, 1600);
}, 3400);
// ---- Parallaxe légère du château à la souris ----
var castle = document.querySelector('.aincrad');
document.addEventListener('mousemove', function(e){
  if (!castle) return;
  var dx = (e.clientX / window.innerWidth - 0.5) * 14;
  var dy = (e.clientY / window.innerHeight - 0.5) * 8;
  castle.style.marginLeft = dx + 'px';
  castle.style.marginTop = dy + 'px';
});
// ---- Citations de la série (rotation) ----
var quotes = [
  '« Ceci est peut-être un jeu, mais ce n’est pas quelque chose à quoi on joue. » — Kayaba',
  '« Le monde a beau être virtuel, ce que l’on y ressent est bien réel. »',
  '« La seule façon de sortir du jeu : atteindre le sommet de l’Aincrad. »',
  '« Je préfère rester moi-même jusqu’au bout plutôt que de survivre en trichant. »',
  '« Un jour, forger sa propre épée… et protéger les siens. »'
];
var qi = 0, q = document.getElementById('quote');
setInterval(function(){
  q.style.opacity = 0;
  setTimeout(function(){ qi = (qi + 1) % quotes.length; q.textContent = quotes[qi]; q.style.opacity = 1; }, 400);
}, 5200);
// ---- Annonces défilantes composées par le créateur ----
var ANN = $annJson;
var ai = 0, annT = null;
function annShow(k){
  var t = document.getElementById('antitre'), x = document.getElementById('antexte'), b = document.getElementById('anbody');
  if (!t || !ANN.length) return;
  ai = ((k % ANN.length) + ANN.length) % ANN.length;
  if (b) b.style.opacity = 0;
  setTimeout(function(){
    t.textContent = ANN[ai].titre || '';
    x.textContent = ANN[ai].texte || '';
    var dots = document.querySelectorAll('#andots i');
    for (var d = 0; d < dots.length; d++) dots[d].className = d === ai ? 'on' : '';
    if (b) b.style.opacity = 1;
  }, 220);
}
function annArm(){ clearInterval(annT); if (ANN.length > 1) annT = setInterval(function(){ annShow(ai + 1); }, 6000); }
if (ANN.length){
  var dz = document.getElementById('andots');
  if (dz) for (var an2 = 0; an2 < ANN.length; an2++) (function(n){
    var dd = document.createElement('i');
    dd.onclick = function(){ annShow(n); annArm(); };
    dz.appendChild(dd);
  })(an2);
  annShow(0); annArm();
  var apv = document.getElementById('anprev'), anx = document.getElementById('annext');
  if (apv) apv.onclick = function(){ annShow(ai - 1); annArm(); };
  if (anx) anx.onclick = function(){ annShow(ai + 1); annArm(); };
  if (ANN.length < 2){ if (apv) apv.style.display = 'none'; if (anx) anx.style.display = 'none'; }
}
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
  <span class="brand" style="cursor:pointer" onclick="renderHome()"><span class="lg">⚔️</span>$NOM_HTML</span>
  $navLinks
  <span class="spacer"></span>
  $navSupport
  <span class="me"><img id="h_avatar" style="display:none"><span class="meinfo"><span id="h_name"></span><span class="hpbar" title="PV — clin d'œil SAO"><i></i></span></span></span>
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
var DASH = { nom: 'Mon Bot', accent: '#4dc3ff', modules: {} };
var TK = null; // paramètres tickets (raisons, profils) pour la prévisualisation
function canPerm(p){ return ROLE.creator || (ROLE.perms || []).indexOf(p) >= 0; }
// Nom d'affichage d'un bot : « Shadow_community » → « Shadow Community ».
function botLabel(n){
  return String(n || '').split(/[_-]+/).map(function(w){
    return w.toLowerCase() === 'rp' ? 'RP' : (w.charAt(0).toUpperCase() + w.slice(1));
  }).join(' ');
}
// Carte serveur (accueil + sections créateur par bot).
function scardHtml(s){
  return '<div class="scard" data-g="' + s.id + '">' +
    (s.icon ? '<img src="' + s.icon + '">' : '<div class="noicon">🌐</div>') +
    '<div style="min-width:0"><div style="font-weight:700">' + esc(s.name) +
    (s.creatorOnly ? ' <span class="ownchip">👑 accès créateur</span>' : '') + '</div>' +
    '<div style="color:var(--muted);font-size:12px">' + (s.membres ? s.membres + ' membres · ' : '') + '🤖 ' + esc(botLabel(s.bot)) + '</div></div></div>';
}

// ----- Accueil : grille des serveurs -----
function renderHome(){
  gid = null;
  var own = moi.servers.filter(function(s){ return !s.creatorOnly; });
  var h = '<div class="wrap"><h1 class="pagetitle">Mes serveurs</h1>';
  if (!own.length) h += '<div class="empty">Aucun serveur — invitez le bot sur votre serveur (bouton « Ajouter à Discord » de la page d\'accueil), puis rechargez.</div>';
  h += '<div class="grid">';
  own.forEach(function(s){ h += scardHtml(s); });
  h += '</div>';
  // ⚙️ Créateur : une section PAR BOT avec TOUS ses serveurs (même ceux où le
  // créateur n'est pas membre — pastille « accès créateur »).
  if (moi.parBot && moi.parBot.length){
    h += '<h1 class="pagetitle" style="margin-top:38px">🗺️ Tous les serveurs, bot par bot</h1>';
    moi.parBot.forEach(function(gb){
      var n = (gb.servers || []).length;
      h += '<div class="botsec"><span class="bt">🤖 ' + esc(gb.label || botLabel(gb.bot)) + '</span><span class="bn2">' + n + ' serveur' + (n > 1 ? 's' : '') + '</span></div>';
      h += '<div class="grid">';
      (gb.servers || []).forEach(function(s){ h += scardHtml(s); });
      h += '</div>';
    });
  }
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
        '<p style="color:var(--muted);margin:-18px 0 8px">' + d.serveur.membres + ' membres · géré par 🤖 ' + esc(botLabel(srv ? srv.bot : '')) + '</p>';
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
        '<div><div class="flabel">Couleur</div><input id="tp_col" type="color" value="#4dc3ff" style="width:64px;height:36px;padding:2px"></div>' +
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
        var sup = (t.supports && t.supports.length) ? t.supports.map(function(s){ return '@' + esc(s.name); }).join(' ') : (t.support ? '@' + esc(t.support) : '');
        tk += '<div class="row">' + (t.emoji ? esc(t.emoji) + ' ' : '') + '<b>' + esc(t.label) + '</b>' + (t.description ? ' <span style="color:var(--muted)">— ' + esc(t.description) + '</span>' : '') +
          '<span style="color:var(--muted);font-size:12px">📁 ' + esc(t.categorie) + (sup ? ' · 🛎️ ' + sup : '') + '</span>' +
          '<button class="tk-del" data-id="' + t.id + '" style="margin-left:auto;padding:4px 11px;font-size:12px">🗑</button></div>';
      });
      if (!p.tickets.length) tk += '<div class="row" style="color:var(--muted)"><i>Aucune raison de ticket.</i></div>';
      h += sec('Raisons de tickets', 'Chaque raison a sa <b>propre catégorie</b> Discord : un ticket ouvert avec cette raison sera créé dedans.', tk, '');
      var addt = '<div class="fields">' +
        '<div style="display:flex;gap:9px;flex-wrap:wrap;align-items:flex-end">' +
        '<div style="min-width:150px"><div class="flabel">Nom de la raison</div><input id="wt_nom" placeholder="Support"></div>' +
        '<div style="min-width:80px;max-width:100px"><div class="flabel">Emoji</div><input id="wt_emoji" placeholder="🎫"></div>' +
        '<div style="flex:1;min-width:200px">' + fsel3('wt_cat', 'Catégorie dédiée à cette raison', p.categories) + '</div>' +
        '<div style="flex:1;min-width:200px"><div class="flabel">Rôles support (plusieurs possibles)</div>' +
        '<select id="wt_roles" multiple size="4" style="height:auto">' + (p.roles || []).map(function(r){ return '<option value="' + r.id + '">@' + esc(r.name) + '</option>'; }).join('') + '</select>' +
        '<div style="color:var(--muted);font-size:11px;margin-top:3px">Ctrl (Windows) ou ⌘ (Mac) pour en sélectionner plusieurs.</div></div></div>' +
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
      var wtRoles = $('wt_roles') ? Array.prototype.slice.call($('wt_roles').selectedOptions).map(function(o){ return o.value; }) : [];
      api('POST', su('tickets-type'), { label: $('wt_nom').value, emoji: $('wt_emoji').value, categoryId: $('wt_cat').value, supportRoleIds: wtRoles, description: $('wt_desc') ? $('wt_desc').value : '' }).then(reload);
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
      '<div class="flabel" style="margin-top:12px">Couleur d\'accent</div><input id="cr_accent" type="color" value="' + esc(cfg.accent || '#4dc3ff') + '" style="width:70px;height:38px;padding:3px">' +
      '</div>', '');
    // 🏠 Builder de la page d'accueil : messages défilants (max 8).
    h += sec('🏠 Page d\'accueil — messages défilants',
      'Composez votre page d\'accueil : ces messages défilent dans un panneau « ANNONCES » sous le bouton LINK START (événements, règlement, nouveautés…). Réordonnez avec ▲▼.',
      '<div id="an_list"></div><button id="an_add" style="margin-top:4px">➕ Ajouter un message</button>', '');
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
    // Mises à jour du dashboard (auto-update depuis GitHub, comme le bot)
    h += sec('🔄 Mises à jour du dashboard', 'Le dashboard se met à jour tout seul depuis GitHub, comme le bot. Le fichier config.php et vos réglages sont conservés (une sauvegarde index.php.bak est créée).',
      '<div id="maj_box" style="color:var(--muted)">Vérification…</div>', '');
    h += '</div>';

    $('content').innerHTML = h;
    if ($('cr-home')) $('cr-home').onclick = renderHome;
    // ----- Messages défilants de la page d'accueil (builder) -----
    var AN = (cfg.annonces || []).map(function(a){ return { titre: (a && a.titre) || '', texte: (a && a.texte) || '' }; }).slice(0, 8);
    var drawAnn = function(){
      var box = $('an_list'); if (!box) return;
      var ht = '';
      if (!AN.length) ht = '<div class="row" style="color:var(--muted)"><i>Aucun message — la page d\'accueil affiche uniquement les citations par défaut.</i></div>';
      AN.forEach(function(a, i){
        ht += '<div class="row" style="align-items:flex-start;gap:9px">' +
          '<div style="display:flex;flex-direction:column;gap:3px">' +
          '<button class="an-up" data-i="' + i + '" style="padding:2px 8px;font-size:11px"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
          '<button class="an-dn" data-i="' + i + '" style="padding:2px 8px;font-size:11px"' + (i === AN.length - 1 ? ' disabled' : '') + '>▼</button></div>' +
          '<div style="flex:1;min-width:220px">' +
          '<input class="an-ti" data-i="' + i + '" placeholder="Titre (ex : 🎉 Événement samedi)" maxlength="80" value="' + esc(a.titre) + '">' +
          '<textarea class="an-tx" data-i="' + i + '" rows="2" placeholder="Texte du message…" maxlength="400" style="margin-top:6px">' + esc(a.texte) + '</textarea></div>' +
          '<button class="an-del" data-i="' + i + '" style="padding:4px 11px;font-size:12px">🗑</button></div>';
      });
      box.innerHTML = ht;
      Array.prototype.forEach.call(box.querySelectorAll('.an-ti'), function(el){ el.oninput = function(){ AN[+el.getAttribute('data-i')].titre = el.value; }; });
      Array.prototype.forEach.call(box.querySelectorAll('.an-tx'), function(el){ el.oninput = function(){ AN[+el.getAttribute('data-i')].texte = el.value; }; });
      Array.prototype.forEach.call(box.querySelectorAll('.an-del'), function(el){ el.onclick = function(){ AN.splice(+el.getAttribute('data-i'), 1); drawAnn(); }; });
      Array.prototype.forEach.call(box.querySelectorAll('.an-up'), function(el){ el.onclick = function(){ var i2 = +el.getAttribute('data-i'); var t2 = AN[i2 - 1]; AN[i2 - 1] = AN[i2]; AN[i2] = t2; drawAnn(); }; });
      Array.prototype.forEach.call(box.querySelectorAll('.an-dn'), function(el){ el.onclick = function(){ var i2 = +el.getAttribute('data-i'); var t2 = AN[i2 + 1]; AN[i2 + 1] = AN[i2]; AN[i2] = t2; drawAnn(); }; });
    };
    drawAnn();
    if ($('an_add')) $('an_add').onclick = function(){
      if (AN.length >= 8){ toast('⚠️ 8 messages maximum.', 'err'); return; }
      AN.push({ titre: '', texte: '' }); drawAnn();
    };
    // ----- Mises à jour -----
    var loadMaj = function(){
      var box = $('maj_box'); if (!box) return;
      api('GET', gu('dash-version')).then(function(j){
        box = $('maj_box'); if (!box) return;
        if (!j || j.error){ box.innerHTML = '<span style="color:#ffb066">Vérification impossible : ' + esc((j && j.error) || 'réseau') + '</span>'; return; }
        var cur = j.current || 'inconnue (dev)', lat = j.latest || '?';
        var html = '<div>Version installée : <b>' + esc(cur) + '</b> · Dernière version publiée : <b>' + esc(lat) + '</b></div>';
        // Interrupteur mise à jour automatique
        html += '<div class="row" style="border:0;padding:10px 0 4px"><b>🔁 Mise à jour automatique</b>' +
          '<span style="color:var(--muted);font-size:12px;margin-left:8px">le dashboard s\'actualise seul (vérif. toutes les 6 h)</span>' +
          '<span class="sw" style="margin-left:auto">' + tog('maj_auto', j.auto !== false) + '</span></div>';
        if (!j.writable){
          html += '<div style="color:#ffb066;font-size:12.5px;margin-top:6px">⚠️ Ici, PHP ne peut pas réécrire index.php : la mise à jour automatique est en pause. Donnez les droits d\'écriture au fichier (chmod 644) ou ré-uploadez-le à la main.</div>';
        } else if (j.updateAvailable){
          html += '<div style="margin-top:10px;color:#4bd07f;font-size:12.5px">⬇️ Nouvelle version disponible — elle s\'installera automatiquement. Vous pouvez aussi l\'appliquer tout de suite :</div>' +
            '<div style="margin-top:8px"><button id="maj_go" class="accent">Mettre à jour vers ' + esc(lat) + ' maintenant</button></div>';
        } else if (j.current === null){
          html += '<div style="margin-top:8px;color:var(--muted);font-size:12.5px">Version « dev » (non tamponnée) : l\'auto-update s\'activera dès que vous installerez une version publiée. Vous pouvez la récupérer maintenant :</div>' +
            '<div style="margin-top:8px"><button id="maj_go" class="accent">⬇️ Installer la dernière version (' + esc(lat) + ')</button></div>';
        } else {
          html += '<div style="color:#4bd07f;font-size:13px;margin-top:6px">✅ Dashboard à jour.</div>';
        }
        box.innerHTML = html;
        if ($('maj_auto')) $('maj_auto').onchange = function(){
          api('POST', gu('dash-auto'), { on: $('maj_auto').checked }).then(function(r){ if (r && !r.error) toast(r.auto ? '🔁 Mise à jour automatique activée' : '⏸️ Mise à jour automatique désactivée', 'ok'); });
        };
        if ($('maj_go')) $('maj_go').onclick = function(){
          if (!confirm('Mettre à jour le dashboard maintenant ?\nindex.php sera remplacé par la dernière version (sauvegarde automatique, config.php conservé).')) return;
          $('maj_go').disabled = true; $('maj_go').textContent = '⏳ Mise à jour…';
          api('POST', gu('dash-maj')).then(function(r){
            if (r && !r.error){ toast('✅ Dashboard mis à jour' + (r.version ? ' — ' + r.version : ''), 'ok'); setTimeout(function(){ location.reload(); }, 1300); }
            else { loadMaj(); }
          });
        };
      });
    };
    loadMaj();
    $('cr_save').onclick = function(){
      var modules = {};
      Object.keys(mods).forEach(function(k){ if (k === 'apercu') { modules[k] = true; return; } modules[k] = $('crm_' + k) ? $('crm_' + k).checked : true; });
      var annonces = AN.map(function(a){ return { titre: (a.titre || '').trim().slice(0, 80), texte: (a.texte || '').trim().slice(0, 400) }; })
        .filter(function(a){ return a.titre || a.texte; });
      var newCfg = { nom: $('cr_nom').value.trim() || 'Mon Bot', accroche: $('cr_accroche').value.trim() || 'Le Roleplay', accent: $('cr_accent').value, modules: modules, annonces: annonces };
      api('POST', gu('dashconfig-save'), { config: newCfg }).then(function(j){
        if (j && !j.error){ toast('✅ Configuration enregistrée — la page d\'accueil est à jour', 'ok'); DASH = newCfg; applyBrand(); }
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
  if (DASH.nom){ var b = document.querySelector('.nav .brand'); if (b) b.innerHTML = '<span class="lg">⚔️</span>' + esc(DASH.nom); document.title = DASH.nom + ' — Dashboard'; }
}

api('GET', 'index.php?p=api-moi').then(function(j){
  if (!j || j.error) { location.href = 'index.php'; return; }
  moi = j;
  // Créateur : les serveurs où il n'est pas membre (sections par bot) sont
  // ajoutés à sa liste pour que le rail et la vue serveur fonctionnent aussi.
  if (j.parBot){
    var have = {};
    moi.servers.forEach(function(s){ have[s.id] = true; });
    j.parBot.forEach(function(gb){
      (gb.servers || []).forEach(function(s){ if (!have[s.id]){ have[s.id] = true; moi.servers.push(s); } });
    });
  }
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
