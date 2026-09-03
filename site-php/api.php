<?php
declare(strict_types=1);

// Aucune notice, aucun avertissement PHP ne doit se mélanger au JSON :
// sinon le site affiche « Réponse serveur invalide ».
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE & ~E_WARNING);
ini_set('display_errors', '0');
ob_start();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

// Une erreur fatale renvoie quand même du JSON exploitable.
register_shutdown_function(static function () {
    $fatal = error_get_last();
    if ($fatal && in_array($fatal['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        if (ob_get_length() !== false) ob_end_clean();
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'ok' => false,
            'error' => 'Erreur PHP : ' . $fatal['message'] . ' (' . basename($fatal['file']) . ' ligne ' . $fatal['line'] . ')',
            'php' => PHP_VERSION,
        ]);
    }
});

const DATA_FILE = __DIR__ . '/data/app.json';
const PROOF_DIR = __DIR__ . '/uploads/proofs';

// Configuration facultative (liaison à l'agent hébergeur).
if (is_file(__DIR__ . '/config.php')) require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib_discord.php';
require_once __DIR__ . '/lib_maj.php';
require_once __DIR__ . '/lib_db.php';

// ----- 🔒 Protection de l'administration -----
// Deux façons d'être administrateur :
//   • connecté avec un COMPTE DISCORD autorisé (la voie normale) ;
//   • ou le mot de passe de secours de config.php (filet facultatif).
// Le site ne reste ouvert que tant que RIEN n'est configuré — ni compte, ni
// mot de passe, ni connexion Discord (pratique pour la toute première mise en
// place, signalé en rouge). Dès que la connexion Discord est prête, elle
// devient la seule porte : sans compte connecté, page d'accueil publique.
demarrer_session();
function admin_password(): string {
  return defined('SITE_ADMIN_PASSWORD') ? (string) SITE_ADMIN_PASSWORD : '';
}
// Une protection est en place dès qu'il y a un propriétaire épinglé, un
// membre d'équipe déclaré, un compte administrateur, un mot de passe —
// ou dès que la connexion Discord est configurée : à partir de là, elle
// devient la SEULE porte du site (personne n'entre sans compte connecté).
function admin_requis(): bool {
  return admin_password() !== '' || owner_id() !== '' || discord_admins() !== [] || discord_staff() !== []
    || discord_configure();
}
function admin_connecte(): bool {
  if (!admin_requis()) return true;
  if (discord_est_admin()) return true;
  return !empty($_SESSION['site_admin']);
}
function exiger_admin(): void {
  if (admin_connecte()) return;
  // Message adapté à la protection réellement en place.
  $message = !empty($_SESSION['discord']['id'])
    ? "Votre compte Discord n'est pas autorisé à modifier ce site. Demandez au propriétaire de vous ajouter (⚙️ Créateur → 🔑 Connexion Discord)."
    : (discord_admins() || discord_configure()
      ? "Connexion requise : identifiez-vous avec votre compte Discord."
      : "Connexion requise : entrez le mot de passe d'administration.");
  respond(['ok' => false, 'error' => $message, 'authRequired' => true], 401);
}
// ----- 🔎 Récupération automatique depuis le dashboard -----
// Le dashboard installé à côté contient déjà AGENT_URL et AGENT_KEY.
// Plutôt que de vous faire ressaisir ces valeurs (et risquer une erreur),
// on va les lire directement s'il est présent. Le fichier est LU (regex),
// jamais exécuté : aucun risque de conflit de constantes.
function dashboard_agent(): array {
  static $cache = null;
  if ($cache !== null) return $cache;
  $cache = ['url' => '', 'key' => '', 'source' => null];
  $pistes = [
    __DIR__ . '/dashboard/config.php',
    __DIR__ . '/../dashboard/config.php',
    __DIR__ . '/../dashboard-php/config.php',
    dirname(__DIR__) . '/config.php',
  ];
  foreach ($pistes as $chemin) {
    if (!is_file($chemin) || !is_readable($chemin)) continue;
    $contenu = (string) @file_get_contents($chemin);
    if ($contenu === '' || strpos($contenu, 'AGENT_URL') === false) continue;
    if (preg_match("/const\s+AGENT_URL\s*=\s*'([^']*)'/", $contenu, $m1)
     && preg_match("/const\s+AGENT_KEY\s*=\s*'([^']*)'/", $contenu, $m2)
     && trim($m1[1]) !== '') {
      $cache = ['url' => trim($m1[1]), 'key' => trim($m2[1]), 'source' => basename(dirname($chemin)) . '/config.php'];
      break;
    }
  }
  return $cache;
}

// Une valeur est-elle une adresse d'agent plausible ? (pas un ID Discord)
function adresse_plausible(string $v): bool {
  $v = trim($v);
  if ($v === '' || preg_match('/^\d{15,25}$/', $v)) return false;
  if (!preg_match('#^https?://#i', $v)) $v = 'http://' . $v;
  return (bool) filter_var($v, FILTER_VALIDATE_URL);
}

// ----- 💾 Réglages saisis DEPUIS LE SITE (plus besoin d'éditer un fichier) -----
// Stockés dans data/agent.php, préfixé par une balise PHP « exit » : même si
// le fichier est demandé par le web, PHP l'exécute et ne renvoie RIEN. La clé
// n'est jamais transmise au navigateur.
// (Ne JAMAIS écrire la balise fermante PHP dans un commentaire : elle sort du
//  mode PHP et le reste du fichier serait affiché tel quel.)
const AGENT_STORE = __DIR__ . '/data/agent.php';
const STORE_PREFIX = "<?php exit; ?>\n";
function agent_store(): array {
  static $c = null;
  if ($c !== null) return $c;
  $c = ['url' => '', 'key' => ''];
  $raw = @file_get_contents(AGENT_STORE);
  if ($raw !== false && strpos($raw, STORE_PREFIX) === 0) {
    $d = json_decode(substr($raw, strlen(STORE_PREFIX)), true);
    if (is_array($d)) $c = ['url' => (string) ($d['url'] ?? ''), 'key' => (string) ($d['key'] ?? '')];
  }
  return $c;
}
function agent_store_save(string $url, string $key): bool {
  $ok = @file_put_contents(AGENT_STORE, STORE_PREFIX . json_encode(['url' => $url, 'key' => $key])) !== false;
  if ($ok) { @chmod(AGENT_STORE, 0640); }
  return $ok;
}

// Adresse de l'agent, normalisée (http:// ajouté si absent). Trois sources,
// dans l'ordre : ce que vous avez saisi DANS LE SITE, puis config.php, puis
// le dashboard installé à côté.
function agent_url(): string {
  $brut = agent_store()['url'];
  if (!adresse_plausible($brut)) {
    $brut = defined('SITE_AGENT_URL') ? trim((string) SITE_AGENT_URL) : '';
  }
  if (!adresse_plausible($brut)) {
    $reprise = dashboard_agent()['url'];
    if (adresse_plausible($reprise)) $brut = $reprise;
  }
  if ($brut === '') return '';
  if (!preg_match('#^https?://#i', $brut)) $brut = 'http://' . $brut;
  return rtrim($brut, '/');
}
// D'où vient l'adresse réellement utilisée (pour l'afficher dans le site).
function agent_origine(): string {
  if (adresse_plausible(agent_store()['url'])) return 'saisi dans le site';
  if (defined('SITE_AGENT_URL') && adresse_plausible((string) SITE_AGENT_URL)) return 'config.php du site';
  $d = dashboard_agent();
  if (adresse_plausible($d['url'])) return 'repris du ' . $d['source'];
  return 'aucune';
}
// L'adresse ressemble-t-elle vraiment à celle d'un agent ? Renvoie null si
// tout va bien, sinon le problème en clair.
function agent_url_probleme(): ?string {
  $brut = agent_store()['url'] !== '' ? agent_store()['url'] : (defined('SITE_AGENT_URL') ? trim((string) SITE_AGENT_URL) : '');
  // Si l'adresse a pu être reprise du dashboard, tout va bien : on ne
  // reproche rien à l'utilisateur, la liaison fonctionne.
  if (agent_url() !== '') return null;
  if ($brut === '') {
    return "Aucune adresse d'agent : renseignez-la juste en dessous, dans « 🔗 Connexion à votre agent », "
      . "puis cliquez sur « Tester et enregistrer ». Aucun fichier à modifier.";
  }
  if (preg_match('/^\d{15,25}$/', $brut)) {
    return "« $brut » est un identifiant Discord (Client ID), pas l'adresse de votre agent. "
      . "Attendu : http://IP-de-votre-serveur:PORT (la même valeur que AGENT_URL du dashboard). "
      . "Corrigez-la dans « 🔗 Connexion à votre agent » ci-dessous.";
  }
  return "« $brut » n'est pas une adresse valide. Attendu : http://IP-de-votre-serveur:PORT — "
    . "corrigez-la dans « 🔗 Connexion à votre agent » ci-dessous.";
}
// La clé suit la MÊME source que l'adresse retenue : pas de mélange possible.
function agent_key(): string {
  $origine = agent_origine();
  if ($origine === 'saisi dans le site') return agent_store()['key'];
  if ($origine === 'config.php du site') {
    $k = defined('SITE_AGENT_KEY') ? trim((string) SITE_AGENT_KEY) : '';
    // Clé oubliée dans config.php : on prend celle du dashboard.
    if ($k === '') { $d = dashboard_agent(); if ($d['key'] !== '') return $d['key']; }
    return $k;
  }
  return dashboard_agent()['key'];
}

// Résumé de la liaison, affiché dans le site (jamais la clé elle-même).
function agent_reglages(): array {
  return [
    'adresse' => agent_url(),
    'origine' => agent_origine(),
    'cleEnregistree' => agent_key() !== '',
    // Le site peut-il écrire data/agent.php ? Sinon, le bouton
    // « Tester et enregistrer » ne servirait à rien : on prévient avant.
    'modifiable' => is_writable(dirname(AGENT_STORE)) || is_writable(AGENT_STORE),
  ];
}

// Appel HTTP vers l'agent : renvoie [code, données].
function agent_get(string $path, int $timeout = 20): array {
  $base = agent_url();
  if ($base === '') return [0, []];
  $url = $base . $path;
  $headers = ['x-cle: ' . agent_key()];
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_HTTPHEADER => $headers,
      CURLOPT_TIMEOUT => $timeout,
      CURLOPT_FOLLOWLOCATION => true,
    ]);
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE) ?: 0;
    curl_close($ch);
  } else {
    $ctx = stream_context_create(['http' => ['method' => 'GET', 'header' => implode("\r\n", $headers), 'timeout' => $timeout, 'ignore_errors' => true]]);
    $raw = @file_get_contents($url, false, $ctx);
    $code = 0;
    foreach ($http_response_header ?? [] as $h) {
      if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $code = (int) $m[1];
    }
  }
  $data = $raw === false ? null : json_decode((string) $raw, true);
  return [$code, is_array($data) ? $data : []];
}

// ----- 📏 Limites d'envoi de l'hébergeur -----
// « 8M », « 512K », « 1G » → nombre d'octets.
function taille_octets(string $valeur): int {
  $valeur = trim($valeur);
  if ($valeur === '') return 0;
  $unite = strtolower(substr($valeur, -1));
  $nombre = (int) $valeur;
  if ($unite === 'g') return $nombre * 1024 * 1024 * 1024;
  if ($unite === 'm') return $nombre * 1024 * 1024;
  if ($unite === 'k') return $nombre * 1024;
  return $nombre;
}
// Ce que l'hébergeur accepte réellement : la plus petite des deux limites.
function limite_envoi(): int {
  $u = taille_octets((string) ini_get('upload_max_filesize'));
  $p = taille_octets((string) ini_get('post_max_size'));
  $valeurs = array_filter([$u, $p]);
  return $valeurs ? (int) min($valeurs) : 0;
}
function taille_lisible(int $octets): string {
  if ($octets <= 0) return 'inconnue';
  if ($octets >= 1024 * 1024 * 1024) return round($octets / 1073741824, 1) . ' Go';
  if ($octets >= 1024 * 1024) return round($octets / 1048576, 1) . ' Mo';
  return round($octets / 1024) . ' Ko';
}

// Appel POST vers l'agent (démarrage, arrêt, mise à jour d'un bot).
function agent_post(string $path, int $timeout = 30): array {
  $base = agent_url();
  if ($base === '') return [0, []];
  $url = $base . $path;
  $headers = ['x-cle: ' . agent_key(), 'Content-Length: 0'];
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_POST => true,
      CURLOPT_POSTFIELDS => '',
      CURLOPT_HTTPHEADER => $headers,
      CURLOPT_TIMEOUT => $timeout,
    ]);
    $raw = curl_exec($ch);
    $code = (int) (curl_getinfo($ch, CURLINFO_RESPONSE_CODE) ?: 0);
    curl_close($ch);
  } else {
    $ctx = stream_context_create(['http' => [
      'method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => '',
      'timeout' => $timeout, 'ignore_errors' => true,
    ]]);
    $raw = @file_get_contents($url, false, $ctx);
    $code = 0;
    foreach ($http_response_header ?? [] as $h) {
      if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $code = (int) $m[1];
    }
  }
  $data = $raw === false ? null : json_decode((string) $raw, true);
  return [$code, is_array($data) ? $data : []];
}

// Appel POST avec un corps JSON vers l'agent (configuration, envoi de message).
function agent_post_json(string $path, array $corps, int $timeout = 20): array {
  $base = agent_url();
  if ($base === '') return [0, []];
  $json = json_encode($corps, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  $headers = ['x-cle: ' . agent_key(), 'Content-Type: application/json'];
  if (function_exists('curl_init')) {
    $ch = curl_init($base . $path);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_POST => true,
      CURLOPT_POSTFIELDS => $json,
      CURLOPT_HTTPHEADER => $headers,
      CURLOPT_TIMEOUT => $timeout,
    ]);
    $raw = curl_exec($ch);
    $code = (int) (curl_getinfo($ch, CURLINFO_RESPONSE_CODE) ?: 0);
    curl_close($ch);
  } else {
    $ctx = stream_context_create(['http' => [
      'method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $json,
      'timeout' => $timeout, 'ignore_errors' => true,
    ]]);
    $raw = @file_get_contents($base . $path, false, $ctx);
    $code = 0;
    foreach ($http_response_header ?? [] as $h) {
      if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $code = (int) $m[1];
    }
  }
  $data = $raw === false ? null : json_decode((string) $raw, true);
  return [$code, is_array($data) ? $data : []];
}

// Comme agent_post_json, mais en PUT — pour écrire le config.env d'un bot.
function agent_put_json(string $path, array $corps, int $timeout = 20): array {
  $base = agent_url();
  if ($base === '') return [0, []];
  $json = json_encode($corps, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  $headers = ['x-cle: ' . agent_key(), 'Content-Type: application/json'];
  if (function_exists('curl_init')) {
    $ch = curl_init($base . $path);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_CUSTOMREQUEST => 'PUT',
      CURLOPT_POSTFIELDS => $json,
      CURLOPT_HTTPHEADER => $headers,
      CURLOPT_TIMEOUT => $timeout,
    ]);
    $raw = curl_exec($ch);
    $code = (int) (curl_getinfo($ch, CURLINFO_RESPONSE_CODE) ?: 0);
    curl_close($ch);
  } else {
    $ctx = stream_context_create(['http' => [
      'method' => 'PUT', 'header' => implode("\r\n", $headers), 'content' => $json,
      'timeout' => $timeout, 'ignore_errors' => true,
    ]]);
    $raw = @file_get_contents($base . $path, false, $ctx);
    $code = 0;
    foreach ($http_response_header ?? [] as $h) {
      if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $code = (int) $m[1];
    }
  }
  $data = $raw === false ? null : json_decode((string) $raw, true);
  return [$code, is_array($data) ? $data : []];
}

// Message d'erreur d'un échec agent : le sien s'il en donne un, sinon le nôtre.
function erreur_agent(int $code, array $data): string {
  $detail = trim((string) ($data['error'] ?? ''));
  if ($detail !== '') return $detail;
  return $code === 0
    ? "Agent injoignable — vérifiez « 🔗 Connexion à votre agent »."
    : "L'agent a répondu HTTP $code.";
}

// Petit identifiant stable à partir d'un nom (« Colmar RP » → « colmar-rp »).
function slugify(string $value, string $fallback = 'bot'): string {
  $value = strtolower(trim($value));
  if (function_exists('iconv')) {
    $converted = @iconv('UTF-8', 'ASCII//TRANSLIT', $value);
    if ($converted !== false) $value = $converted;
  }
  $value = preg_replace('/[^a-z0-9]+/', '-', $value) ?? '';
  $value = trim((string) $value, '-');
  return $value !== '' ? substr($value, 0, 40) : $fallback;
}

function respond(array $payload, int $status = 200)
{
    if (ob_get_length() !== false) ob_end_clean();   // jette toute sortie parasite
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}

function loadState(): array
{
    // 🗄️ Base de données configurée : elle est la source de vérité.
    // En cas de panne, on retombe sur le fichier JSON plutôt que d'afficher
    // un site vide — les données restent lisibles, seules les écritures
    // signaleront le problème.
    if (db_configuree()) {
        try {
            $pdo = db();
            if ($pdo !== null) { db_init($pdo); return db_charger($pdo); }
        } catch (Throwable $e) {
            error_log('Site : base injoignable, repli sur app.json — ' . $e->getMessage());
        }
    }
    if (!is_file(DATA_FILE)) {
        respond(['ok' => false, 'error' => 'Le fichier de données est introuvable.'], 500);
    }

    $handle = fopen(DATA_FILE, 'rb');
    if ($handle === false) {
        respond(['ok' => false, 'error' => 'Impossible de lire les données.'], 500);
    }

    flock($handle, LOCK_SH);
    $raw = stream_get_contents($handle);
    flock($handle, LOCK_UN);
    fclose($handle);

    $state = json_decode((string) $raw, true);
    if (!is_array($state)) {
        respond(['ok' => false, 'error' => 'Le fichier de données est invalide.'], 500);
    }

    return $state;
}

function saveState(array $state): void
{
    // 🗄️ Vers la base si elle est configurée. Une écriture qui échoue doit se
    // voir : mieux vaut un message clair qu'une modification perdue en
    // silence.
    if (db_configuree()) {
        try {
            $pdo = db();
            if ($pdo !== null) { db_init($pdo); db_sauver($pdo, $state); return; }
        } catch (Throwable $e) {
            respond(['ok' => false, 'error' => "Enregistrement impossible : la base de données a refusé l'écriture (" . $e->getMessage() . "). Vérifiez ⚙️ Créateur → 🗄️ Base de données."], 500);
        }
    }
    $json = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    if ($json === false) {
        respond(['ok' => false, 'error' => 'Impossible de sérialiser les données.'], 500);
    }

    $handle = fopen(DATA_FILE, 'c+b');
    if ($handle === false) {
        respond(['ok' => false, 'error' => 'Impossible d’ouvrir le fichier de données en écriture.'], 500);
    }

    if (!flock($handle, LOCK_EX)) {
        fclose($handle);
        respond(['ok' => false, 'error' => 'Impossible de verrouiller les données.'], 500);
    }

    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, $json);
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
}

function body(): array
{
    // Voie de secours : certains hébergeurs mutualisés (pare-feu applicatif)
    // rejettent les POST au format JSON. Le site renvoie alors les mêmes
    // données dans un champ de formulaire « payload ».
    if (isset($_POST['payload'])) {
        $decoded = json_decode((string) $_POST['payload'], true);
        if (is_array($decoded)) return $decoded;
    }

    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (strpos($contentType, 'application/json') !== false) {
        $decoded = json_decode((string) file_get_contents('php://input'), true);
        return is_array($decoded) ? $decoded : [];
    }

    // Dernier recours : le corps est du JSON mais sans en-tête correct.
    $raw = (string) file_get_contents('php://input');
    if ($raw !== '' && ($raw[0] === '{' || $raw[0] === '[')) {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) return $decoded;
    }

    return $_POST;
}

function cleanString($value, int $max = 500): string
{
    $value = trim((string) $value);
    return function_exists('mb_substr') ? mb_substr($value, 0, $max) : substr($value, 0, $max);
}

function appendActivity(array &$state, string $type, string $label, string $detail): void
{
    array_unshift($state['activity'], [
        'type' => $type,
        'label' => $label,
        'detail' => $detail,
        'time' => 'à l’instant',
    ]);
    $state['activity'] = array_slice($state['activity'], 0, 20);
}

function findIndexById(array $items, string $id): int
{
    foreach ($items as $index => $item) {
        if (($item['id'] ?? '') === $id) {
            return $index;
        }
    }
    return -1;
}

$action = $_GET['action'] ?? $_POST['action'] ?? 'state';
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

// 🩺 Diagnostic : ouvrez api.php?action=selftest dans le navigateur pour
// savoir immédiatement ce qui bloque chez votre hébergeur.
if ($action === 'selftest') {
    $dataOk = is_file(DATA_FILE) && is_writable(DATA_FILE);
    $bgDir = __DIR__ . '/uploads/backgrounds';
    $probleme = agent_url_probleme();
    $agent = [
        'adresseUtilisee' => agent_url(),
        // D'où viennent réellement l'adresse et la clé employées.
        'origine' => agent_origine(),
        'cleFournie' => agent_key() !== '' ? 'oui' : 'non',
        'probleme' => $probleme,
        'joignable' => false,
        'bots' => [],
    ];
    if ($probleme === null) {
        [$code, $etat] = agent_get('/agent/etat', 8);
        $agent['httpAgent'] = $code;
        if ($code === 200) {
            $agent['joignable'] = true;
            foreach ($etat['bots'] ?? [] as $b) {
                $agent['bots'][] = ['nom' => $b['name'] ?? '?', 'statut' => $b['status'] ?? '?'];
            }
        } else {
            $agent['probleme'] = $code === 0
                ? "Agent injoignable : adresse/port bloqués, agent éteint, ou l'hébergeur web n'autorise pas les connexions sortantes vers ce port."
                : "L'agent a répondu HTTP $code — la clé est probablement incorrecte : corrigez-la dans ⚙️ Créateur → 🤖 Mes bots → « Connexion à votre agent ».";
        }
    }
    $conseils = [];
    if (!$dataOk) $conseils[] = "Donnez les droits d'écriture à data/app.json (chmod 664) et au dossier data/ (chmod 775).";
    if ($agent['probleme'] !== null) $conseils[] = $agent['probleme'];
    if ($agent['joignable'] && $agent['bots']) {
        $noms = implode(' · ', array_map(static fn($b) => $b['nom'], $agent['bots']));
        $conseils[] = "Bots vus chez l'agent : $noms — recopiez EXACTEMENT l'un de ces noms dans « Nom chez l'agent ».";
    }
    respond([
        'ok' => true,
        'php' => PHP_VERSION,
        'phpSuffisant' => version_compare(PHP_VERSION, '7.4', '>='),
        'donneesLisibles' => is_file(DATA_FILE),
        'donneesModifiables' => $dataOk,
        'dossierPreuves' => is_dir(PROOF_DIR) ? is_writable(PROOF_DIR) : 'absent',
        'dossierFonds' => is_dir($bgDir) ? is_writable($bgDir) : 'absent',
        'tailleEnvoiMax' => taille_lisible(limite_envoi()) . ' (upload_max_filesize=' . ini_get('upload_max_filesize') . ', post_max_size=' . ini_get('post_max_size') . ')',
        'curl' => function_exists('curl_init'),
        'allow_url_fopen' => (bool) ini_get('allow_url_fopen'),
        'agent' => $agent,
        'protection' => admin_requis()
            ? (discord_admins() ? count(discord_admins()) . ' compte(s) Discord autorisé(s)' : '')
              . (discord_admins() && admin_password() !== '' ? ' + ' : '')
              . (admin_password() !== '' ? 'mot de passe de secours' : '')
            : 'AUCUNE — le site est modifiable par tous : connectez-vous avec Discord pour en devenir propriétaire',
        'connexionDiscord' => discord_app()['clientId'] !== '' && discord_app()['clientSecret'] !== ''
            ? 'prête (' . discord_app()['origine'] . ')'
            : 'non configurée — ⚙️ Créateur → 🔑 Connexion Discord',
        'adresseDeRetourDiscord' => oauth_redirect_uri(),
        'conseils' => $conseils ?: ['Tout est bon : la synchronisation doit fonctionner.'],
    ]);
}

// 🔧 Réglages de l'agent SAISIS DEPUIS LE SITE : on teste d'abord, on
// enregistre seulement si l'agent répond. Réservé à l'administration.
if ($action === 'agent.config') {
    exiger_admin();
    $in = body();
    // Lecture seule : sert à afficher l'état actuel dans le site.
    if (!empty($in['lire'])) {
        respond(['ok' => true, 'reglages' => agent_reglages()]);
    }
    $url = trim((string) ($in['url'] ?? ''));
    $key = trim((string) ($in['key'] ?? ''));
    if ($url === '') {           // champ vidé = on efface le réglage
        @unlink(AGENT_STORE);
        respond([
            'ok' => true, 'efface' => true,
            'note' => "Réglage effacé : le site reprendra celui du dashboard installé à côté, s'il y en a un.",
        ]);
    }
    // Clé laissée vide alors qu'une clé est déjà enregistrée : on garde
    // l'ancienne (le site ne renvoie jamais la clé au navigateur).
    if ($key === '' && agent_store()['key'] !== '') $key = agent_store()['key'];
    if (preg_match('/^\d{15,25}$/', $url)) {
        respond(['ok' => false, 'error' => "« $url » est un identifiant Discord, pas l'adresse de votre agent. Attendu : http://IP-du-serveur:PORT"], 422);
    }
    $test = preg_match('#^https?://#i', $url) ? rtrim($url, '/') : 'http://' . rtrim($url, '/');
    if (!filter_var($test, FILTER_VALIDATE_URL)) {
        respond(['ok' => false, 'error' => "« $url » n'est pas une adresse valide. Attendu : http://IP-du-serveur:PORT"], 422);
    }
    // Essai réel avant d'enregistrer.
    $ch = function_exists('curl_init') ? curl_init($test . '/agent/etat') : null;
    if ($ch) {
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ['x-cle: ' . $key], CURLOPT_TIMEOUT => 10]);
        $raw = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE) ?: 0;
        $err = curl_error($ch);
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => ['method' => 'GET', 'header' => 'x-cle: ' . $key, 'timeout' => 10, 'ignore_errors' => true]]);
        $raw = @file_get_contents($test . '/agent/etat', false, $ctx);
        $code = 0; $err = '';
        foreach ($http_response_header ?? [] as $h) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $code = (int) $m[1];
        }
    }
    if ($code === 401 || $code === 403) {
        respond(['ok' => false, 'error' => "L'agent répond bien à $test, mais REFUSE la clé (HTTP $code). Recopiez exactement AGENT_KEY du fichier config.env de votre agent."], 422);
    }
    if ($code === 404) {
        respond(['ok' => false, 'error' => "$test répond, mais n'a pas de page /agent/etat (HTTP 404) : "
            . "ce n'est pas votre agent. Ce port est sans doute celui d'un autre service (site web, bot…). "
            . "Reprenez l'adresse AGENT_URL de votre dashboard."], 422);
    }
    if ($code !== 200) {
        respond(['ok' => false, 'error' => "Aucune réponse de $test" . ($code ? " (HTTP $code)" : '')
            . ". Vérifiez que l'agent tourne, que le PORT est le bon, et que votre hébergeur autorise les connexions sortantes."
            . ($err ? " Détail : $err" : '')], 502);
    }
    $data = json_decode((string) $raw, true);
    if (!is_array($data) || !isset($data['bots'])) {
        respond(['ok' => false, 'error' => "$test répond, mais ce n'est pas un agent (réponse inattendue). Vérifiez l'adresse et le port."], 422);
    }
    if (!agent_store_save($test, $key)) {
        respond(['ok' => false, 'error' => "Connexion réussie, mais impossible d'écrire dans data/ — donnez les droits d'écriture au dossier data (chmod 775)."], 500);
    }
    $bots = [];
    foreach ($data['bots'] as $b) $bots[] = ['nom' => (string) ($b['name'] ?? ''), 'demarre' => ($b['status'] ?? '') === 'demarre'];
    respond(['ok' => true, 'adresse' => $test, 'bots' => $bots, 'reglages' => [
        'adresse' => $test, 'origine' => 'saisi dans le site',
        'cleEnregistree' => $key !== '', 'modifiable' => true,
    ]]);
}

// ══════════════════════════════════════════════════════════════════
// 🗄️ BASE DE DONNÉES — on teste, on crée les tables, on importe
// ══════════════════════════════════════════════════════════════════
if ($action === 'db.config') {
    exiger_admin();
    $in = body();
    $c = db_config();
    if (!empty($in['lire'])) {
        $sortie = [
            'type' => $c['type'], 'hote' => $c['hote'], 'port' => (int) $c['port'],
            'base' => $c['base'], 'utilisateur' => $c['utilisateur'], 'fichier' => $c['fichier'],
            'motDePasseEnregistre' => $c['motdepasse'] !== '',
            'configuree' => db_configuree(),
            'pilotes' => ['mysql' => extension_loaded('pdo_mysql'), 'sqlite' => extension_loaded('pdo_sqlite')],
            'modifiable' => is_writable(dirname(DB_STORE)) || is_writable(DB_STORE),
            'active' => false, 'stats' => null, 'erreur' => null,
        ];
        if (db_configuree()) {
            try { $pdo = db(); db_init($pdo); $sortie['active'] = true; $sortie['stats'] = db_statistiques($pdo); }
            catch (Throwable $e) { $sortie['erreur'] = $e->getMessage(); }
        }
        respond(['ok' => true, 'db' => $sortie]);
    }
    if (!empty($in['effacer'])) {
        db_effacer();
        respond(['ok' => true, 'efface' => true, 'note' => 'Le site est revenu au fichier data/app.json. Vos tables ne sont pas supprimées.']);
    }

    $type = ($in['type'] ?? 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
    if ($type === 'mysql' && !extension_loaded('pdo_mysql')) {
        respond(['ok' => false, 'error' => "Votre hébergeur n'a pas l'extension PHP « pdo_mysql » : impossible de se connecter à MySQL. Demandez-la à votre hébergeur, ou choisissez SQLite."], 422);
    }
    $neuf = [
        'type' => $type,
        'hote' => trim((string) ($in['hote'] ?? '')),
        'port' => (int) ($in['port'] ?? 3306) ?: 3306,
        'base' => trim((string) ($in['base'] ?? '')),
        'utilisateur' => trim((string) ($in['utilisateur'] ?? '')),
        // Mot de passe laissé vide = on garde celui déjà enregistré.
        'motdepasse' => ($in['motdepasse'] ?? '') !== '' ? (string) $in['motdepasse'] : $c['motdepasse'],
        'fichier' => trim((string) ($in['fichier'] ?? '')) ?: (__DIR__ . '/data/site.sqlite'),
    ];
    if ($type === 'mysql') {
        if ($neuf['hote'] === '' || $neuf['base'] === '') {
            respond(['ok' => false, 'error' => "L'hôte et le nom de la base sont obligatoires."], 422);
        }
        // « game1.exemple.fr:3306 » collé dans le champ hôte : on sépare.
        if (preg_match('/^(.+):(\d+)$/', $neuf['hote'], $m)) {
            $neuf['hote'] = $m[1];
            $neuf['port'] = (int) $m[2];
        }
    }

    // Connexion réelle AVANT d'enregistrer quoi que ce soit.
    try {
        $pdo = new PDO(db_dsn($neuf), $neuf['utilisateur'] ?: null, $neuf['motdepasse'] ?: null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 8,
        ]);
    } catch (Throwable $e) {
        $m = $e->getMessage();
        $aide = "Vérifiez l'hôte, le port, le nom de la base et les identifiants.";
        if (stripos($m, 'access denied') !== false) $aide = "Le serveur refuse ces identifiants : recopiez le nom d'utilisateur et le mot de passe depuis le panel de votre hébergeur.";
        elseif (stripos($m, 'unknown database') !== false) $aide = "Ce serveur répond, mais cette base n'existe pas. Vérifiez son nom exact.";
        elseif (stripos($m, 'timed out') !== false || stripos($m, 'connection refused') !== false) $aide = "Le serveur ne répond pas depuis votre hébergeur web : le port est peut-être fermé, ou l'accès distant n'est pas autorisé pour cette base.";
        respond(['ok' => false, 'error' => "Connexion refusée. $aide (détail : " . substr($m, 0, 220) . ')'], 422);
    }

    // Tables + import de l'existant si la base est vierge.
    $importe = 0;
    try {
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        db_init($pdo);
        if (db_vide($pdo) && is_file(DATA_FILE)) {
            $json = json_decode((string) @file_get_contents(DATA_FILE), true);
            if (is_array($json)) {
                db_sauver($pdo, $json);
                $importe = count($json['blacklist'] ?? []) + count($json['tickets'] ?? []) + count($json['archives'] ?? []);
            }
        }
    } catch (Throwable $e) {
        respond(['ok' => false, 'error' => "Connexion réussie, mais la création des tables a échoué : " . substr($e->getMessage(), 0, 240)
            . " — cet utilisateur a-t-il le droit de créer des tables (CREATE) ?"], 422);
    }

    if (!db_config_save($neuf)) {
        respond(['ok' => false, 'error' => "Base joignable, mais impossible d'écrire dans data/ — donnez les droits d'écriture au dossier data (chmod 775)."], 500);
    }
    respond(['ok' => true, 'importe' => $importe, 'stats' => db_statistiques($pdo),
        'note' => $importe > 0
            ? "Base prête, et vos $importe entrée(s) existantes ont été importées."
            : "Base prête. Elle contenait déjà des données : rien n'a été écrasé."]);
}

// 🔑 Application Discord du site (connexion des membres avec leur compte).
// Comme pour l'agent : on VÉRIFIE auprès de Discord avant d'enregistrer.
if ($action === 'discord.config') {
    exiger_admin();
    $in = body();
    $app = discord_app();
    $store = discord_store();
    if (!empty($in['lire'])) {
        respond(['ok' => true, 'discord' => [
            'clientId' => $app['clientId'],
            'secretEnregistre' => $app['clientSecret'] !== '',
            'origine' => $app['origine'],
            'redirect' => oauth_redirect_uri(),
            'admins' => discord_admins(),
            'modifiable' => is_writable(dirname(DISCORD_STORE)) || is_writable(DISCORD_STORE),
        ]]);
    }
    $clientId = preg_replace('/\D+/', '', (string) ($in['clientId'] ?? ''));
    $secret = trim((string) ($in['clientSecret'] ?? ''));
    if ($clientId === '') {                 // tout vider = on repart de zéro
        discord_store_save(['clientId' => '', 'clientSecret' => '']);
        respond(['ok' => true, 'efface' => true, 'note' => "Identifiants effacés : le site reprendra ceux du dashboard voisin, s'il y en a."]);
    }
    if (strlen($clientId) < 17 || strlen($clientId) > 20) {
        respond(['ok' => false, 'error' => "« $clientId » n'est pas un Client ID Discord : il en faut 17 à 20 chiffres "
            . "(vous en avez " . strlen($clientId) . "). Portail développeur Discord → votre application → OAuth2 → Client ID."], 422);
    }
    // Secret laissé vide alors qu'il est déjà enregistré : on garde l'ancien.
    if ($secret === '' && $store['clientSecret'] !== '') $secret = $store['clientSecret'];
    if ($secret === '') {
        respond(['ok' => false, 'error' => "Il manque la clé secrète (Client Secret). Portail développeur Discord → OAuth2 → « Reset Secret »."], 422);
    }
    // Vérification réelle du couple ID + secret auprès de Discord.
    [$st, $rep, $brut] = discord_http('https://discord.com/api/oauth2/token', 'POST', [
        'client_id' => $clientId, 'client_secret' => $secret, 'grant_type' => 'client_credentials', 'scope' => 'identify',
    ]);
    if ($st === 401) {
        respond(['ok' => false, 'error' => "Discord REFUSE ce couple Client ID + clé secrète (HTTP 401). "
            . "Vérifiez que les deux viennent de la MÊME application, et régénérez la clé si besoin (OAuth2 → Reset Secret)."], 422);
    }
    if ($st === 0) {
        respond(['ok' => false, 'error' => "Impossible de joindre Discord depuis votre hébergeur. "
            . "Les connexions sortantes en HTTPS sont peut-être bloquées."], 502);
    }
    if ($st !== 200) {
        respond(['ok' => false, 'error' => "Discord a répondu HTTP $st : " . substr(strip_tags($brut), 0, 200)], 422);
    }
    if (!discord_store_save(['clientId' => $clientId, 'clientSecret' => $secret])) {
        respond(['ok' => false, 'error' => "Identifiants valides, mais impossible d'écrire dans data/ — donnez les droits d'écriture au dossier data (chmod 775)."], 500);
    }
    respond(['ok' => true, 'clientId' => $clientId, 'redirect' => oauth_redirect_uri(), 'admins' => discord_admins()]);
}

// 🎭 L'équipe : quel identifiant Discord a quel grade.
if ($action === 'discord.staff') {
    exiger_admin();
    $in = body();
    if (!empty($in['lire'])) {
        respond(['ok' => true, 'staff' => discord_staff(), 'owner' => owner_id(),
                 'ownerEpingle' => owner_id() !== '', 'moi' => moi_id()]);
    }
    $equipe = is_array($in['staff'] ?? null) ? $in['staff'] : [];
    $owner = owner_id();
    // On ne se retire pas soi-même : ce serait se fermer la porte.
    $moi = moi_id();
    if ($moi !== '' && $moi !== $owner && !isset($equipe[$moi])) {
        respond(['ok' => false, 'error' => "Vous alliez retirer VOTRE propre compte de l'équipe : vous perdriez l'accès immédiatement."], 422);
    }
    // Sans propriétaire épinglé dans config.php, il doit rester quelqu'un.
    if ($owner === '' && !$equipe && admin_password() === '') {
        respond(['ok' => false, 'error' => "Impossible de vider l'équipe : plus personne ne pourrait administrer le site. "
            . "Renseignez d'abord votre identifiant dans SITE_OWNER_ID (config.php)."], 422);
    }
    if (!discord_staff_save($equipe)) {
        respond(['ok' => false, 'error' => "Impossible d'écrire dans data/ — donnez les droits d'écriture au dossier data (chmod 775)."], 500);
    }
    respond(['ok' => true, 'staff' => discord_staff()]);
}

// 👑 Comptes Discord autorisés à administrer le site.
if ($action === 'discord.admins') {
    exiger_admin();
    $in = body();
    if (!empty($in['lire'])) respond(['ok' => true, 'admins' => discord_admins()]);
    $ids = is_array($in['admins'] ?? null) ? $in['admins'] : [];
    $propres = [];
    foreach ($ids as $id) {
        $id = preg_replace('/\D+/', '', (string) $id);
        if ($id !== null && strlen($id) >= 15 && strlen($id) <= 25) $propres[] = $id;
    }
    $propres = array_values(array_unique($propres));
    // Garde-fou : on refuse de retirer TOUS les administrateurs, sinon plus
    // personne ne pourrait rien modifier (sauf mot de passe de secours).
    if (!$propres && admin_password() === '') {
        respond(['ok' => false, 'error' => "Impossible de retirer le dernier administrateur : le site deviendrait modifiable par n'importe qui. "
            . "Ajoutez d'abord un autre compte, ou renseignez un mot de passe de secours dans config.php."], 422);
    }
    // On ne se retire pas soi-même par inadvertance.
    $moi = (string) ($_SESSION['discord']['id'] ?? '');
    if ($moi !== '' && $propres && !in_array($moi, $propres, true)) {
        respond(['ok' => false, 'error' => "Vous alliez retirer VOTRE propre compte de la liste : vous perdriez l'accès immédiatement. "
            . "Demandez à un autre administrateur de le faire."], 422);
    }
    if (!discord_admins_save($propres)) {
        respond(['ok' => false, 'error' => "Impossible d'écrire dans data/ — donnez les droits d'écriture au dossier data (chmod 775)."], 500);
    }
    respond(['ok' => true, 'admins' => discord_admins()]);
}

// ══════════════════════════════════════════════════════════════════
// 🔄 MISES À JOUR — le site et tous ses bots, ensemble
// ══════════════════════════════════════════════════════════════════

// Demande à l'agent de mettre à jour chaque bot déclaré, puis de le relancer.
function maj_tous_les_bots(array $state): array {
    $rapport = [];
    foreach ($state['bots'] ?? [] as $bot) {
        $nom = trim((string) ($bot['agentName'] ?? ''));
        $affiche = (string) ($bot['name'] ?? $nom);
        if ($nom === '') {
            $rapport[] = ['bot' => $affiche, 'ok' => false, 'message' => "Aucun « nom chez l'agent » : impossible de le mettre à jour."];
            continue;
        }
        [$code] = agent_post('/agent/bots/' . rawurlencode($nom) . '/maj', 60);
        $rapport[] = $code === 200
            ? ['bot' => $affiche, 'ok' => true, 'message' => "Mis à jour et relancé."]
            : ['bot' => $affiche, 'ok' => false, 'message' => $code === 0
                ? "Agent injoignable — vérifiez « 🔗 Connexion à votre agent »."
                : ($code === 401 || $code === 403 ? "L'agent refuse la clé (HTTP $code)." : "L'agent a répondu HTTP $code.")];
    }
    return $rapport;
}

if ($action === 'maj.etat') {
    exiger_admin();
    $etat = maj_etat();
    [$derniere, $lien, $err] = maj_derniere_version();
    $installee = maj_version_installee();
    respond(['ok' => true, 'maj' => [
        'installee' => $installee,
        'derniere' => $derniere,
        'disponible' => $err === '' && maj_plus_recente($derniere, $installee),
        'erreur' => $err ?: null,
        'auto' => !empty($etat['auto']),
        'derniereMaj' => $etat['derniereMaj'] ?? 0,
        'message' => $etat['message'] ?? '',
        'zipDispo' => class_exists('ZipArchive'),
        'siteModifiable' => is_writable(__DIR__),
    ]]);
}

// Active ou coupe la mise à jour automatique.
if ($action === 'maj.auto') {
    exiger_admin();
    $etat = maj_etat();
    $etat['auto'] = !empty(body()['auto']);
    maj_etat_save($etat);
    respond(['ok' => true, 'auto' => $etat['auto']]);
}

// Lance la mise à jour : le site, puis TOUS les bots.
if ($action === 'maj.lancer') {
    exiger_admin();
    $in = body();
    $faireSite = !isset($in['site']) || !empty($in['site']);
    $faireBots = !isset($in['bots']) || !empty($in['bots']);
    $sortie = ['ok' => true, 'site' => null, 'bots' => []];
    if ($faireSite) {
        $r = maj_site();
        $sortie['site'] = $r;
        $etat = maj_etat();
        $etat['derniereMaj'] = time();
        $etat['message'] = $r['message'];
        maj_etat_save($etat);
    }
    if ($faireBots) {
        $sortie['bots'] = maj_tous_les_bots(loadState());
    }
    respond($sortie);
}

// ══════════════════════════════════════════════════════════════════
// 🎛️ CONFIGURATION RÉELLE D'UN SERVEUR — le site parle au bot
// ══════════════════════════════════════════════════════════════════

// Quel bot gère ce serveur ? (nom chez l'agent)
function bot_du_serveur(array $state, string $guildId): string {
    foreach ($state['servers'] ?? [] as $s) {
        if ((string) ($s['id'] ?? '') !== $guildId) continue;
        foreach ($state['bots'] ?? [] as $b) {
            if (in_array($b['id'] ?? '', (array) ($s['botIds'] ?? []), true) && ($b['agentName'] ?? '') !== '') {
                return (string) $b['agentName'];
            }
        }
    }
    return '';
}

// ══════════════════════════════════════════════════════════════════
// 🚫 BLACKLIST — du site vers Discord
// ══════════════════════════════════════════════════════════════════
// Une sanction posée sur le site ne servait à rien côté Discord : c'était
// une simple fiche. Elle est maintenant transmise au(x) bot(s), qui la
// font appliquer pour de vrai (message privé + bannissement sur chacun de
// leurs serveurs, et re-bannissement à toute tentative de retour).
//
// Deux portées :
//   • « globale »  → tous les bots enregistrés sur le site ;
//   • « un bot »   → uniquement celui qui est choisi.

// Les bots visés par une sanction, selon sa portée.
function blacklist_cibles(array $state, string $portee, string $botChoisi): array {
    $cibles = [];
    foreach ($state['bots'] ?? [] as $b) {
        $agent = trim((string) ($b['agentName'] ?? ''));
        $id = (string) ($b['id'] ?? '');
        $nom = (string) ($b['name'] ?? $id);
        if ($portee === 'bot' && $id !== $botChoisi) continue;
        // Sans « nom chez l'agent », le site ne sait pas joindre ce bot.
        $cibles[] = ['id' => $id, 'nom' => $nom, 'agent' => $agent];
    }
    return $cibles;
}

// Les bots visés par une fiche déjà enregistrée. Les fiches créées avant
// l'arrivée de la portée n'ont ni « portee » ni « bots » : on les traite
// comme globales, ce qu'elles étaient implicitement.
function blacklist_cibles_entree(array $state, array $entree): array {
    $portee = ($entree['portee'] ?? 'global') === 'bot' ? 'bot' : 'global';
    $ids = array_map('strval', (array) ($entree['bots'] ?? []));
    if ($portee === 'global' || !$ids) return blacklist_cibles($state, 'global', '');
    $cibles = [];
    foreach ($ids as $id) {
        foreach (blacklist_cibles($state, 'bot', $id) as $c) $cibles[] = $c;
    }
    return $cibles;
}

// Qui signe la sanction ? Le compte Discord connecté, sinon l'administration.
function moi_nom(): string {
    $n = trim((string) ($_SESSION['discord']['nom'] ?? ''));
    return $n !== '' ? $n : 'Administration';
}

// Transmet la sanction (ou sa levée) aux bots visés.
// $sens vaut 'ajouter' ou 'retirer'. Renvoie un rapport par bot : le site
// n'affirme jamais « appliqué » sans avoir la réponse du bot.
function blacklist_diffuser(array $cibles, string $sens, string $discordId, string $reason, string $acteur): array {
    $rapport = [];
    foreach ($cibles as $c) {
        if ($c['agent'] === '') {
            $rapport[] = ['bot' => $c['nom'], 'ok' => false,
                'message' => "Aucun « nom chez l'agent » renseigné : le site ne peut pas le joindre."];
            continue;
        }
        $charge = ['userId' => $discordId, 'actorId' => $acteur];
        if ($sens === 'ajouter') $charge['reason'] = $reason;
        [$code, $data] = agent_post_json(
            '/agent/bots/' . rawurlencode($c['agent']) . '/proxy/blacklist-' . $sens,
            $charge, 30
        );
        if ($code === 200) {
            $rapport[] = ['bot' => $c['nom'], 'ok' => true, 'message' => $sens === 'ajouter'
                ? ('Appliquée sur ' . (int) ($data['banned'] ?? 0) . ' serveur(s)'
                   . (empty($data['dmOk']) ? ', message privé non remis.' : ', message privé remis.'))
                : ('Levée sur ' . (int) ($data['unbanned'] ?? 0) . ' serveur(s).')];
            continue;
        }
        // 404 sur un retrait = le bot ne l'avait pas : ce n'est pas un échec.
        if ($sens === 'retirer' && $code === 404) {
            $rapport[] = ['bot' => $c['nom'], 'ok' => true, 'message' => "N'était pas blacklisté sur ce bot."];
            continue;
        }
        $rapport[] = ['bot' => $c['nom'], 'ok' => false, 'message' => $data['error'] ?? ($code === 0
            ? "Bot injoignable (éteint, ou agent hors service) — réessayez avec « Réappliquer sur Discord »."
            : "Le bot a répondu HTTP $code.")];
    }
    return $rapport;
}

// ── 📥 Le sens inverse : Discord → panel ──────────────────────────
// Une blacklist posée SUR DISCORD (commande /blacklist du staff, ou un
// ticket du QG résolu en blacklist) n'existait que dans le bot. Elle est
// maintenant rapatriée ici, avec sa preuve, pour que le panel soit la
// mémoire complète des sanctions — quel que soit l'endroit où elles ont
// été prononcées.
function blacklist_importer(array &$state): array {
    $rapport = ['ajoutees' => 0, 'completees' => 0, 'levees' => 0, 'reactivees' => 0, 'bots' => []];
    $parId = [];   // discordId → index dans $state['blacklist']
    foreach ($state['blacklist'] as $i => $e) {
        $cid = preg_replace('/\D+/', '', (string) ($e['discordId'] ?? ''));
        if ($cid !== '') $parId[$cid] = $i;
    }
    $vusParBot = [];   // botId → [discordId, …] tels que le bot les connaît

    foreach ($state['bots'] ?? [] as $b) {
        $agent = trim((string) ($b['agentName'] ?? ''));
        $botId = (string) ($b['id'] ?? '');
        $botNom = (string) ($b['name'] ?? $botId);
        if ($agent === '') continue;
        $base = '/agent/bots/' . rawurlencode($agent) . '/proxy';
        [$code, $data] = agent_get($base . '/blacklist', 20);
        if ($code !== 200 || !isset($data['blacklist'])) {
            $rapport['bots'][] = ['bot' => $botNom, 'ok' => false, 'message' => $code === 0
                ? 'Bot injoignable — ses sanctions Discord ne sont pas remontées.'
                : "Le bot a répondu HTTP $code."];
            continue;
        }
        // Les preuves vivent dans l'historique : on retient la plus récente
        // pour chaque personne (l'historique est déjà trié du plus récent).
        $preuves = [];
        [$hc, $hd] = agent_get($base . '/blacklist-historique', 20);
        if ($hc === 200) {
            foreach ((array) ($hd['historique'] ?? []) as $h) {
                $uid = preg_replace('/\D+/', '', (string) ($h['userId'] ?? ''));
                if ($uid === '' || ($h['action'] ?? '') !== 'blacklist') continue;
                if (!isset($preuves[$uid]) && trim((string) ($h['proof'] ?? '')) !== '') {
                    $preuves[$uid] = (string) $h['proof'];
                }
            }
        }

        $vus = [];
        foreach ((array) $data['blacklist'] as $r) {
            $cid = preg_replace('/\D+/', '', (string) ($r['userId'] ?? ''));
            if ($cid === '') continue;
            $vus[] = $cid;
            $quand = strtotime((string) ($r['at'] ?? '')) ?: time();

            if (isset($parId[$cid])) {
                // Déjà au panel : on complète sans rien écraser.
                $e = &$state['blacklist'][$parId[$cid]];
                $bots = array_values(array_unique(array_merge((array) ($e['bots'] ?? []), [$botId])));
                $e['bots'] = $bots;
                if (($e['reason'] ?? '') === '' && ($r['reason'] ?? '') !== '') $e['reason'] = cleanString((string) $r['reason'], 800);
                if (($e['preuveDiscord'] ?? '') === '' && isset($preuves[$cid])) {
                    $e['preuveDiscord'] = cleanString($preuves[$cid], 1000);
                    $rapport['completees']++;
                }
                // Le bot la connaît de nouveau : le drapeau « levée » tombe.
                // Il faut le COMPTER, sinon rien n'est enregistré et le
                // drapeau réapparaît au prochain chargement.
                if (!empty($e['leveeSurDiscord'])) {
                    unset($e['leveeSurDiscord']);
                    $rapport['reactivees']++;
                }
                unset($e);
                continue;
            }

            // Nouvelle fiche, créée depuis Discord. L'identifiant est déduit
            // de l'ID Discord : resynchroniser ne crée jamais de doublon.
            $entree = [
                'id' => 'BL-D-' . $cid,
                'discordId' => $cid,
                'username' => cleanString((string) ($r['tag'] ?? '') ?: $cid, 80),
                'reason' => cleanString((string) ($r['reason'] ?? '') ?: 'Aucun motif précisé sur Discord', 800),
                'severity' => 'moyenne',
                'portee' => 'bot',
                'bots' => [$botId],
                'server' => $botNom,
                'author' => 'Discord · ' . (string) ($r['by'] ?? 'staff du bot'),
                'date' => date('Y-m-d', $quand),
                'origine' => 'discord',
                'preuveDiscord' => isset($preuves[$cid]) ? cleanString($preuves[$cid], 1000) : '',
                'diffusion' => [['bot' => $botNom, 'ok' => true, 'message' => 'Prononcée sur Discord, déjà appliquée.']],
                'proofs' => [],
            ];
            $state['blacklist'][] = $entree;
            $parId[$cid] = count($state['blacklist']) - 1;
            $rapport['ajoutees']++;
        }
        $vusParBot[$botId] = $vus;
        $rapport['bots'][] = ['bot' => $botNom, 'ok' => true,
            'message' => count($vus) . ' sanction(s) active(s) sur ce bot.'];
    }

    // Levée côté Discord : on le SIGNALE, on ne supprime pas. Une fiche peut
    // porter des preuves téléversées ici : les effacer sans demander serait
    // une perte sèche.
    foreach ($state['blacklist'] as $i => $e) {
        $cid = preg_replace('/\D+/', '', (string) ($e['discordId'] ?? ''));
        if ($cid === '' || ($e['origine'] ?? '') !== 'discord') continue;
        $encore = false;
        foreach ((array) ($e['bots'] ?? []) as $bid) {
            if (isset($vusParBot[$bid]) && in_array($cid, $vusParBot[$bid], true)) { $encore = true; break; }
        }
        // Seuls les bots réellement interrogés comptent : un bot éteint ne
        // doit pas faire passer ses sanctions pour levées.
        $interroge = false;
        foreach ((array) ($e['bots'] ?? []) as $bid) if (isset($vusParBot[$bid])) $interroge = true;
        if ($interroge && !$encore && empty($e['leveeSurDiscord'])) {
            $state['blacklist'][$i]['leveeSurDiscord'] = true;
            $rapport['levees']++;
        }
    }
    return $rapport;
}

// ── 🚨 Échantillons anti-scam communs à TOUS les bots ────────────
// Chaque bot a sa propre base : un échantillon ajouté sur l'un ne valait
// que pour lui. Le site fait la mise en commun — il lit ce que chacun
// possède, en fait l'union, puis distribue à chaque bot ce qui lui
// manque. Seules les EMPREINTES circulent (SHA-256 + dHash), pas les
// images.
//
// Le site retient aussi les empreintes RETIRÉES : sans cela, un
// échantillon supprimé sur un bot serait aussitôt remis par l'union
// venant des autres.
function scam_mettre_en_commun(array &$state): array {
    $rapport = ['connus' => 0, 'distribues' => 0, 'bots' => []];
    $retires = array_flip(array_map('strval', (array) ($state['scamRetires'] ?? [])));
    $union = [];        // sha256 => échantillon
    $possede = [];      // botId => [sha256 => true]
    $joignables = [];

    foreach ($state['bots'] ?? [] as $b) {
        $agent = trim((string) ($b['agentName'] ?? ''));
        $botId = (string) ($b['id'] ?? '');
        $botNom = (string) ($b['name'] ?? $botId);
        if ($agent === '') continue;
        [$code, $data] = agent_get('/agent/bots/' . rawurlencode($agent) . '/proxy/scam-echantillons', 20);
        if ($code !== 200 || !isset($data['echantillons'])) {
            $rapport['bots'][] = ['bot' => $botNom, 'ok' => false, 'message' => $code === 0
                ? 'Bot injoignable — laissé de côté pour cette fois.'
                : ($code === 404
                    ? "Ce bot est trop ancien : mettez-le à jour pour partager les échantillons."
                    : "Le bot a répondu HTTP $code.")];
            continue;
        }
        $joignables[$botId] = ['agent' => $agent, 'nom' => $botNom];
        $possede[$botId] = [];
        foreach ((array) $data['echantillons'] as $e) {
            $sha = strtolower(trim((string) ($e['sha256'] ?? '')));
            if (!preg_match('/^[0-9a-f]{64}$/', $sha)) continue;
            $possede[$botId][$sha] = true;
            if (isset($retires[$sha])) continue;   // retiré volontairement
            if (!isset($union[$sha])) {
                $union[$sha] = [
                    'sha256' => $sha,
                    'dhash' => (string) ($e['dhash'] ?? ''),
                    'nom' => (string) ($e['nom'] ?? ''),
                    'parQui' => (string) ($e['parQui'] ?? ''),
                    'quand' => (string) ($e['quand'] ?? ''),
                ];
            } elseif (($union[$sha]['dhash'] ?? '') === '' && ($e['dhash'] ?? '') !== '') {
                // Un bot sans jimp enregistre l'empreinte exacte seule :
                // on garde l'empreinte visuelle dès qu'un bot l'a calculée.
                $union[$sha]['dhash'] = (string) $e['dhash'];
            }
        }
    }
    $rapport['connus'] = count($union);

    // Distribution : chaque bot reçoit ce qui lui manque, et perd ce qui a
    // été retiré.
    foreach ($joignables as $botId => $info) {
        $ajouts = 0; $suppressions = 0; $echecs = 0;
        foreach ($union as $sha => $e) {
            if (isset($possede[$botId][$sha])) continue;
            [$c] = agent_post_json('/agent/bots/' . rawurlencode($info['agent']) . '/proxy/scam-echantillon-ajouter', [
                'sha256' => $e['sha256'], 'dhash' => $e['dhash'],
                'nom' => $e['nom'], 'parQui' => $e['parQui'], 'quand' => $e['quand'],
            ], 20);
            if ($c === 200) { $ajouts++; $rapport['distribues']++; } else { $echecs++; }
        }
        foreach (array_keys($possede[$botId]) as $sha) {
            if (!isset($retires[$sha])) continue;
            [$c] = agent_post_json('/agent/bots/' . rawurlencode($info['agent']) . '/proxy/scam-echantillon-retirer',
                ['sha256' => $sha], 20);
            if ($c === 200) $suppressions++; else $echecs++;
        }
        $morceaux = [];
        if ($ajouts) $morceaux[] = "$ajouts reçu(s)";
        if ($suppressions) $morceaux[] = "$suppressions retiré(s)";
        if ($echecs) $morceaux[] = "$echecs en échec";
        $rapport['bots'][] = ['bot' => $info['nom'], 'ok' => $echecs === 0,
            'message' => $morceaux ? implode(', ', $morceaux) . '.' : 'Déjà à jour.'];
    }

    // Mémoire du site : la liste commune, pour l'afficher sans réinterroger.
    $state['scamEchantillons'] = array_values($union);
    return $rapport;
}

// Vérifie le droit de toucher à ce serveur, puis renvoie le nom du bot.
function exiger_serveur(string $guildId): array {
    $etat = loadState();
    if ($guildId === '' || !peut_gerer_serveur($etat, $guildId)) {
        respond(['ok' => false, 'error' => moi_id() === ''
            ? "Connectez-vous avec Discord pour configurer un serveur."
            : "Vous n'êtes ni propriétaire ni administrateur de ce serveur Discord."], 403);
    }
    $bot = bot_du_serveur($etat, $guildId);
    if ($bot === '') {
        respond(['ok' => false, 'error' => "Aucun bot relié à ce serveur. Vérifiez « Nom chez l'agent » dans ⚙️ Créateur → 🤖 Mes bots, puis synchronisez."], 422);
    }
    return [$etat, $bot];
}

// 📋 Rôles, salons, catégories et configuration actuelle du serveur : c'est
// ce qui alimente TOUTES les listes déroulantes du site.
if ($action === 'serveur.parametres') {
    $guildId = preg_replace('/\D+/', '', (string) (body()['serveur'] ?? $_GET['serveur'] ?? ''));
    [, $bot] = exiger_serveur((string) $guildId);
    [$code, $data] = agent_get('/agent/bots/' . rawurlencode($bot) . '/proxy/parametres?guild=' . rawurlencode((string) $guildId), 15);
    if ($code !== 200) {
        // L'agent et le bot savent maintenant DIRE pourquoi (démarrage en
        // cours, token refusé, plantage…) : leur message passe en priorité.
        $detail = is_array($data) ? trim((string) ($data['error'] ?? '')) : '';
        respond(['ok' => false, 'error' => $detail !== '' ? $detail : ($code === 0
            ? "Le bot ne répond pas — est-il démarré ? (agent injoignable ou API interne arrêtée)"
            : "Le bot a répondu HTTP $code. S'il est ancien, mettez-le à jour (⚙️ Créateur → 🔄 Mises à jour).")], 502);
    }
    respond(['ok' => true] + $data);
}

// 💾 Enregistre UN réglage dans le bot (salon, rôle, interrupteur, texte…).
if ($action === 'serveur.config') {
    $in = body();
    $guildId = preg_replace('/\D+/', '', (string) ($in['serveur'] ?? ''));
    [, $bot] = exiger_serveur((string) $guildId);
    [$code, $data] = agent_post_json('/agent/bots/' . rawurlencode($bot) . '/proxy/config', [
        'guildId' => (string) $guildId,
        'key' => (string) ($in['cle'] ?? ''),
        'value' => $in['valeur'] ?? null,
    ], 15);
    if ($code !== 200) {
        respond(['ok' => false, 'error' => $data['error'] ?? ($code === 0
            ? "Le bot ne répond pas — est-il démarré ?"
            : "Le bot a répondu HTTP $code.")], 502);
    }
    respond(['ok' => true, 'valeur' => $data['value'] ?? null]);
}

// 🎭 Donne les rôles automatiques à TOUS les membres déjà présents.
if ($action === 'serveur.autorole.rattraper') {
    $guildId = preg_replace('/\D+/', '', (string) (body()['serveur'] ?? ''));
    [, $bot] = exiger_serveur((string) $guildId);
    // Un gros serveur prend du temps : on laisse largement respirer.
    [$code, $data] = agent_post_json('/agent/bots/' . rawurlencode($bot) . '/proxy/autorole-rattraper',
        ['guildId' => (string) $guildId], 300);
    if ($code !== 200) {
        respond(['ok' => false, 'error' => $data['error'] ?? ($code === 0
            ? "Le bot ne répond pas, ou l'opération a dépassé le temps imparti. Sur un très grand serveur, relancez : les membres déjà traités seront ignorés."
            : "Le bot a répondu HTTP $code.")], 502);
    }
    respond(['ok' => true] + $data);
}

// 📨 Publie sur Discord le message composé dans le site.
if ($action === 'serveur.message') {
    $in = body();
    $guildId = preg_replace('/\D+/', '', (string) ($in['serveur'] ?? ''));
    [, $bot] = exiger_serveur((string) $guildId);
    $charge = $in['message'] ?? [];
    $charge['guildId'] = (string) $guildId;
    $charge['channelId'] = preg_replace('/\D+/', '', (string) ($in['salon'] ?? ''));
    if (!empty($in['test'])) $charge['test'] = true;
    if ($charge['channelId'] === '') {
        respond(['ok' => false, 'error' => 'Choisissez le salon de destination.'], 422);
    }
    [$code, $data] = agent_post_json('/agent/bots/' . rawurlencode($bot) . '/proxy/message-envoyer', $charge, 25);
    if ($code !== 200) {
        respond(['ok' => false, 'error' => $data['error'] ?? ($code === 0
            ? "Le bot ne répond pas — est-il démarré ?"
            : "Le bot a répondu HTTP $code. Mettez-le à jour si l'envoi de messages est inconnu de lui.")], 502);
    }
    respond(['ok' => true, 'note' => $data['note'] ?? 'Message publié.', 'messageId' => $data['messageId'] ?? null]);
}

// 🎭 Grade réel du membre connecté sur un serveur donné (rôles du bot).
if ($action === 'moi.grade') {
    $guildId = preg_replace('/\D+/', '', (string) (body()['serveur'] ?? $_GET['serveur'] ?? ''));
    if ($guildId === '' || moi_id() === '') respond(['ok' => true, 'grade' => null]);
    $g = grade_discord_du_membre(loadState(), $guildId);
    respond(['ok' => true, 'grade' => $g, 'serveur' => $guildId]);
}

// 🤖 Liste des bots déclarés chez l'agent (pour remplir « Nom chez l'agent »).
// ── 🆕 Cycle de vie d'un bot chez l'agent, piloté depuis le site ──────
// Lire le .env d'un nom inconnu CRÉE son dossier bots/<nom> chez l'agent :
// c'est ainsi qu'un nom tapé dans « ➕ Créer un nouveau bot » devient un
// bot réel, configurable et démarrable sans quitter le site.
if ($action === 'bot.env.lire') {
    exiger_admin();
    $nom = trim((string) (body()['nom'] ?? ''));
    if ($nom === '') respond(['ok' => false, 'error' => 'Nom du bot manquant.'], 422);
    [$code, $data] = agent_get('/agent/bots/' . rawurlencode($nom) . '/env', 12);
    if ($code !== 200) respond(['ok' => false, 'error' => erreur_agent($code, $data)], 502);
    respond(['ok' => true, 'contenu' => (string) ($data['content'] ?? '')]);
}
if ($action === 'bot.env.ecrire') {
    exiger_admin();
    $in = body();
    $nom = trim((string) ($in['nom'] ?? ''));
    if ($nom === '') respond(['ok' => false, 'error' => 'Nom du bot manquant.'], 422);
    [$code, $data] = agent_put_json('/agent/bots/' . rawurlencode($nom) . '/env',
        ['content' => (string) ($in['contenu'] ?? '')], 12);
    if ($code !== 200) respond(['ok' => false, 'error' => erreur_agent($code, $data)], 502);
    respond(['ok' => true]);
}
if ($action === 'bot.demarrer' || $action === 'bot.arreter') {
    exiger_admin();
    $nom = trim((string) (body()['nom'] ?? ''));
    if ($nom === '') respond(['ok' => false, 'error' => 'Nom du bot manquant.'], 422);
    $route = $action === 'bot.demarrer' ? 'demarrer' : 'arreter';
    [$code, $data] = agent_post('/agent/bots/' . rawurlencode($nom) . '/' . $route, 30);
    if ($code !== 200) respond(['ok' => false, 'error' => erreur_agent($code, $data)], 502);
    respond(['ok' => true] + $data);
}

if ($action === 'agent.bots') {
    // L'adresse de l'agent ne sort que pour l'administration connectée.
    $reglages = admin_connecte() ? agent_reglages() : null;
    $probleme = agent_url_probleme();
    if ($probleme !== null) respond(['ok' => false, 'error' => $probleme, 'reglages' => $reglages], 422);
    [$code, $etat] = agent_get('/agent/etat', 10);
    if ($code !== 200) {
        respond(['ok' => false, 'reglages' => $reglages, 'error' => $code === 0
            ? "Agent injoignable à l'adresse " . agent_url() . " (port bloqué, agent éteint, ou sorties réseau interdites par l'hébergeur)."
            : ($code === 401 || $code === 403
                ? "L'agent répond bien, mais REFUSE la clé (HTTP $code) — corrigez-la ci-dessous puis « Tester et enregistrer »."
                : "L'agent a répondu HTTP $code — adresse ou port inattendu.")], 502);
    }
    $bots = [];
    foreach ($etat['bots'] ?? [] as $b) {
        $bots[] = ['nom' => (string) ($b['name'] ?? ''), 'demarre' => ($b['status'] ?? '') === 'demarre'];
    }
    respond(['ok' => true, 'adresse' => admin_connecte() ? agent_url() : '', 'bots' => $bots, 'reglages' => $reglages]);
}

// 🔑 Qui suis-je ? Profil Discord de la session en cours (sans secret).
function moi_discord(): ?array {
    if (empty($_SESSION['discord']['id'])) return null;
    $u = $_SESSION['discord'];
    return [
        'id' => (string) $u['id'],
        'nom' => (string) ($u['nom'] ?? 'Membre'),
        'pseudo' => (string) ($u['pseudo'] ?? ''),
        'avatar' => (string) ($u['avatar'] ?? ''),
        'admin' => discord_est_admin(),
        'serveurs' => count($_SESSION['discord_guilds'] ?? []),
        // Vrai uniquement au tout premier passage : le site vient de vous
        // reconnaître comme propriétaire.
        'premier' => !empty($_SESSION['discord_premier']),
    ];
}

// 🔄 Mise à jour automatique : un hébergeur PHP mutualisé n'a pas de tâche
// planifiée, alors on profite des visites. Le contrôle est limité à une fois
// toutes les 6 h, et une seule requête à la fois grâce au verrou.
function maj_auto_si_besoin(): void {
    $etat = maj_etat();
    if (empty($etat['auto'])) return;
    if (time() - (int) ($etat['dernierTest'] ?? 0) < 6 * 3600) return;
    $etat['dernierTest'] = time();
    maj_etat_save($etat);                        // écrit AVANT : pas de rafale
    [$derniere, $lien, $err] = maj_derniere_version();
    if ($err !== '' || !maj_plus_recente($derniere, maj_version_installee())) {
        $etat['disponible'] = $err === '' ? '' : $derniere;
        maj_etat_save($etat);
        return;
    }
    $r = maj_site($derniere, $lien);
    $etat['derniereMaj'] = time();
    $etat['message'] = ($r['ok'] ? '✅ ' : '❌ ') . $r['message'];
    $etat['disponible'] = $r['ok'] ? '' : $derniere;
    maj_etat_save($etat);
    if ($r['ok']) {
        // Le site vient de changer de version : on aligne les bots.
        maj_tous_les_bots(loadState());
    }
}

// 🌐 Le site public n'a pas à divulguer les tickets et la blacklist :
// seul le staff (identifiants Discord autorisés) reçoit tout.
function state_public(array $state): array {
    return [
        'bots' => $state['bots'] ?? [],
        'siteConfig' => $state['siteConfig'] ?? [],
        'servers' => [],
        'blacklist' => [],
        'tickets' => [],
        'archives' => [],
        'activity' => [],
        'serverSettings' => new stdClass(),
    ];
}

// 🏠 Vue d'un gestionnaire de ses propres serveurs : il voit SES serveurs,
// les tickets qui en proviennent, et rien d'autre. La blacklist est
// mutualisée entre serveurs : elle reste réservée à l'équipe du site.
function state_pour_gestionnaire(array $state, array $ids): array {
    $garde = array_flip($ids);
    $noms = [];
    $serveurs = [];
    foreach ($state['servers'] ?? [] as $s) {
        if (!isset($garde[(string) ($s['id'] ?? '')])) continue;
        $serveurs[] = $s;
        $noms[(string) ($s['name'] ?? '')] = true;
    }
    // Les tickets ne portent que le NOM du serveur : on filtre là-dessus.
    $filtreTickets = static function (array $liste) use ($noms): array {
        $out = [];
        foreach ($liste as $t) if (isset($noms[(string) ($t['server'] ?? '')])) $out[] = $t;
        return array_values($out);
    };
    $reglages = [];
    foreach ($ids as $id) {
        if (isset($state['serverSettings'][$id])) $reglages[$id] = $state['serverSettings'][$id];
    }
    return [
        'bots' => $state['bots'] ?? [],
        'siteConfig' => $state['siteConfig'] ?? [],
        'servers' => $serveurs,
        'blacklist' => [],
        'tickets' => $filtreTickets($state['tickets'] ?? []),
        'archives' => $filtreTickets($state['archives'] ?? []),
        'activity' => [],
        'serverSettings' => $reglages ?: new stdClass(),
    ];
}

// 🎭 Demande au BOT le grade réel du membre sur un serveur : ce sont les
// rôles staff / administration / police configurés dans le bot qui font foi,
// pas une liste tenue à la main dans le site.
// Le résultat est gardé 5 minutes en session : sans cela, chaque affichage
// de page interrogerait l'agent.
function grade_discord_du_membre(array $state, string $guildId): ?array {
    $moi = moi_id();
    if ($moi === '' || $guildId === '') return null;
    $cle = $moi . ':' . $guildId;
    $cache = $_SESSION['grades_serveur'] ?? [];
    if (isset($cache[$cle]) && (time() - (int) $cache[$cle]['t']) < 300) {
        return $cache[$cle]['v'];
    }
    // Quel bot est présent sur ce serveur ?
    $agentName = '';
    foreach ($state['servers'] ?? [] as $s) {
        if ((string) ($s['id'] ?? '') !== $guildId) continue;
        foreach ($state['bots'] ?? [] as $b) {
            if (in_array($b['id'] ?? '', (array) ($s['botIds'] ?? []), true) && ($b['agentName'] ?? '') !== '') {
                $agentName = (string) $b['agentName'];
                break 2;
            }
        }
    }
    if ($agentName === '') return null;
    [$code, $data] = agent_get('/agent/bots/' . rawurlencode($agentName)
        . '/proxy/membre?guild=' . rawurlencode($guildId) . '&user=' . rawurlencode($moi), 10);
    $valeur = ($code === 200 && !empty($data['grade'])) ? $data : null;
    $cache[$cle] = ['t' => time(), 'v' => $valeur];
    $_SESSION['grades_serveur'] = array_slice($cache, -40, null, true);
    return $valeur;
}

if ($method === 'GET' && $action === 'state') {
    $moi = moi_discord();
    unset($_SESSION['discord_premier']);   // le bandeau ne s'affiche qu'une fois
    maj_auto_si_besoin();
    $complet = marquer_mes_serveurs(loadState());
    $staff = est_staff() || admin_connecte();
    // 🏠 Ni équipe du site, ni administration : peut-être gère-t-il malgré
    // tout ses propres serveurs (propriétaire/admin d'une guilde où le bot est).
    $miens = $staff ? [] : mes_serveurs_geres($complet);
    $vue = $staff ? $complet : ($miens ? state_pour_gestionnaire($complet, $miens) : state_public($complet));
    respond([
        'ok' => true,
        'state' => $vue,
        'mesServeursSansBot' => ($staff || $miens) ? mes_serveurs_sans_bot($complet) : [],
        'nbMesServeurs' => count(mes_guildes()),
        // Ce que la personne a le droit de faire, dit clairement au front.
        'acces' => [
            'gestion' => $staff || $miens !== [],
            'siteEntier' => $staff,
            'mesServeurs' => $miens,
        ],
        // 🩺 De quoi expliquer précisément un refus d'accès.
        'diagnostic' => acces_diagnostic($complet),
        'authRequired' => admin_requis(), 'authOk' => admin_connecte(),
        'moi' => $moi,
        'staff' => $staff,
        'grade' => mon_grade(),
        'discordPret' => discord_app()['clientId'] !== '' && discord_app()['clientSecret'] !== '',
        // Sert à prévenir AVANT l'envoi qu'une vidéo est trop lourde.
        'limiteEnvoi' => ['octets' => limite_envoi(), 'lisible' => taille_lisible(limite_envoi())],
    ]);
}

if ($method !== 'POST') {
    respond(['ok' => false, 'error' => 'Méthode non autorisée.'], 405);
}

$state = loadState();
$input = body();
$action = $input['action'] ?? $action;

// ----- 🔑 Connexion / déconnexion de l'administration -----
if ($action === 'auth.login') {
    if (!admin_requis()) respond(['ok' => true, 'authOk' => true, 'note' => 'Aucune protection configurée.']);
    // ⚠️ Sans mot de passe de secours, cette voie est FERMÉE : sinon une
    // requête avec un mot de passe vide passerait le hash_equals ci-dessous
    // et donnerait les pleins pouvoirs à n'importe qui.
    if (admin_password() === '') {
        respond(['ok' => false, 'error' => "Ce site n'a pas de mot de passe de secours : connectez-vous avec votre compte Discord."], 403);
    }
    $saisi = (string) ($input['password'] ?? '');
    // Petite temporisation : décourage les tentatives en série.
    usleep(300000);
    if (!hash_equals(admin_password(), $saisi)) {
        respond(['ok' => false, 'error' => 'Mot de passe incorrect.'], 403);
    }
    session_regenerate_id(true);
    $_SESSION['site_admin'] = true;
    respond(['ok' => true, 'authOk' => true]);
}
if ($action === 'auth.logout') {
    unset($_SESSION['site_admin']);
    respond(['ok' => true, 'authOk' => false]);
}

// 🏠 Exception : configurer SON PROPRE serveur ne demande pas d'être de
// l'équipe du site. Un propriétaire (ou administrateur) d'un serveur Discord
// où le bot est présent peut régler CE serveur — et uniquement celui-là.
if ($action === 'server.module.save' && !admin_connecte()) {
    $cible = cleanString($input['serverId'] ?? '', 80);
    $etatComplet = loadState();
    if ($cible === '' || !peut_gerer_serveur($etatComplet, $cible)) {
        respond(['ok' => false, 'error' => moi_id() === ''
            ? "Connectez-vous avec Discord pour configurer un serveur."
            : "Vous n'êtes ni propriétaire ni administrateur de ce serveur Discord : vous ne pouvez pas le configurer ici.",
            'authRequired' => moi_id() === ''], 403);
    }
    // Autorisé : on laisse le traitement normal se poursuivre plus bas.
} else {
    // Toutes les autres écritures exigent d'être connecté à l'administration.
    exiger_admin();
}

switch ($action) {
    case 'blacklist.add':
        $username = cleanString($input['username'] ?? '', 80);
        $discordId = preg_replace('/\D+/', '', (string) ($input['discordId'] ?? ''));
        $reason = cleanString($input['reason'] ?? '', 800);
        $severity = cleanString($input['severity'] ?? 'moyenne', 20);
        // Portée : « global » (tous les bots) ou « bot » (celui qui est choisi).
        $portee = ($input['portee'] ?? 'global') === 'bot' ? 'bot' : 'global';
        $botChoisi = cleanString($input['bot'] ?? '', 60);

        if ($username === '' || $discordId === '' || $reason === '') {
            respond(['ok' => false, 'error' => 'Nom, identifiant Discord et motif sont obligatoires.'], 422);
        }
        if ($portee === 'bot' && $botChoisi === '') {
            respond(['ok' => false, 'error' => 'Choisissez le bot sur lequel appliquer la sanction.'], 422);
        }

        $cibles = blacklist_cibles($state, $portee, $botChoisi);
        if (!$cibles) {
            respond(['ok' => false, 'error' => $portee === 'bot'
                ? "Ce bot n'existe plus dans la liste."
                : "Aucun bot enregistré : ajoutez-en un dans ⚙️ Créateur → 🤖 Mes bots."], 422);
        }

        $entry = [
            'id' => 'BL-' . random_int(1100, 9999),
            'discordId' => $discordId,
            'username' => $username,
            'reason' => $reason,
            'severity' => in_array($severity, ['faible', 'moyenne', 'élevée', 'critique'], true) ? $severity : 'moyenne',
            'portee' => $portee,
            'bots' => array_column($cibles, 'id'),
            // Colonne historique du tableau : on y met la portée en clair.
            'server' => $portee === 'global' ? 'Global' : (string) $cibles[0]['nom'],
            'author' => moi_nom(),
            'date' => date('Y-m-d'),
            'origine' => 'site',
            'proofs' => [],
        ];

        // On applique sur Discord AVANT d'enregistrer : si le bot refuse (membre
        // immunisé, créateur…), aucune fiche fantôme ne reste sur le site.
        $diffusion = blacklist_diffuser($cibles, 'ajouter', $discordId, $reason, moi_id());
        $reussites = array_filter($diffusion, static fn($r) => $r['ok']);
        if (!$reussites) {
            respond(['ok' => false, 'diffusion' => $diffusion,
                'error' => "Aucun bot n'a pu appliquer la sanction : " . $diffusion[0]['message']], 502);
        }
        $entry['diffusion'] = $diffusion;

        array_unshift($state['blacklist'], $entry);
        appendActivity($state, 'blacklist', 'Utilisateur blacklisté', $username);
        saveState($state);
        respond(['ok' => true, 'entry' => $entry, 'diffusion' => $diffusion, 'state' => $state]);

    case 'blacklist.delete':
        $id = cleanString($input['id'] ?? '', 40);
        $index = findIndexById($state['blacklist'], $id);
        if ($index < 0) {
            respond(['ok' => false, 'error' => 'Entrée introuvable.'], 404);
        }
        $removed = $state['blacklist'][$index];
        // Le déban part vers les mêmes bots que la sanction d'origine.
        $diffusion = blacklist_diffuser(
            blacklist_cibles_entree($state, $removed), 'retirer',
            preg_replace('/\D+/', '', (string) ($removed['discordId'] ?? '')), '', moi_id()
        );
        array_splice($state['blacklist'], $index, 1);
        appendActivity($state, 'blacklist', 'Blacklist retirée', (string) ($removed['username'] ?? $id));
        saveState($state);
        respond(['ok' => true, 'diffusion' => $diffusion, 'state' => $state]);

    // 📥 Rapatrie dans le panel les blacklists prononcées sur Discord, et met
    // au passage les échantillons anti-scam en commun entre tous les bots.
    case 'blacklist.import':
        $rapport = blacklist_importer($state);
        $avant = json_encode($state['scamEchantillons'] ?? []);
        $scam = scam_mettre_en_commun($state);
        $scamBouge = $scam['distribues'] > 0 || json_encode($state['scamEchantillons'] ?? []) !== $avant;
        if ($rapport['ajoutees'] || $rapport['completees'] || $rapport['levees'] || $rapport['reactivees'] || $scamBouge) {
            appendActivity($state, 'blacklist', 'Import depuis Discord',
                $rapport['ajoutees'] . ' ajoutée(s), ' . $rapport['completees'] . ' complétée(s)');
            saveState($state);
        }
        respond(['ok' => true, 'import' => $rapport, 'scam' => $scam, 'state' => $state]);

    // 🚨 Retire un échantillon anti-scam de TOUS les bots.
    case 'scam.retirer':
        $sha = strtolower(trim((string) ($input['sha256'] ?? '')));
        if (!preg_match('/^[0-9a-f]{64}$/', $sha)) {
            respond(['ok' => false, 'error' => 'Empreinte invalide.'], 422);
        }
        // Mémorisé comme retiré AVANT la distribution : sinon l'union le
        // remettrait aussitôt depuis les autres bots.
        $state['scamRetires'] = array_values(array_unique(array_merge(
            array_map('strval', (array) ($state['scamRetires'] ?? [])), [$sha]
        )));
        $scam = scam_mettre_en_commun($state);
        saveState($state);
        respond(['ok' => true, 'scam' => $scam, 'state' => $state]);

    // 🔁 Réapplique une sanction sur Discord : sert quand un bot était éteint
    // au moment de l'ajout, ou pour les fiches créées avant que le site ne
    // sache parler aux bots (elles n'étaient alors que du papier).
    case 'blacklist.resync':
        $id = cleanString($input['id'] ?? '', 40);
        $index = findIndexById($state['blacklist'], $id);
        if ($index < 0) {
            respond(['ok' => false, 'error' => 'Entrée introuvable.'], 404);
        }
        $e = $state['blacklist'][$index];
        $cid = preg_replace('/\D+/', '', (string) ($e['discordId'] ?? ''));
        if ($cid === '') {
            respond(['ok' => false, 'error' => "Cette fiche n'a pas d'identifiant Discord : impossible de l'appliquer."], 422);
        }
        $diffusion = blacklist_diffuser(
            blacklist_cibles_entree($state, $e), 'ajouter', $cid, (string) ($e['reason'] ?? ''), moi_id()
        );
        $state['blacklist'][$index]['diffusion'] = $diffusion;
        saveState($state);
        respond(['ok' => true, 'diffusion' => $diffusion, 'state' => $state]);

    case 'blacklist.proof':
        $id = cleanString($_POST['id'] ?? '', 40);
        $index = findIndexById($state['blacklist'], $id);
        if ($index < 0) {
            respond(['ok' => false, 'error' => 'Entrée blacklist introuvable.'], 404);
        }
        if (!isset($_FILES['proof']) || $_FILES['proof']['error'] !== UPLOAD_ERR_OK) {
            respond(['ok' => false, 'error' => 'Aucun fichier valide reçu.'], 422);
        }

        $file = $_FILES['proof'];
        if ((int) $file['size'] > 8 * 1024 * 1024) {
            respond(['ok' => false, 'error' => 'La preuve dépasse 8 Mo.'], 422);
        }

        $allowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'];
        $mime = function_exists('mime_content_type') ? (mime_content_type((string) $file['tmp_name']) ?: '') : cleanString($file['type'] ?? '', 100);
        if (!in_array($mime, $allowed, true)) {
            respond(['ok' => false, 'error' => 'Format de preuve non autorisé.'], 422);
        }

        if (!is_dir(PROOF_DIR) && !mkdir(PROOF_DIR, 0775, true) && !is_dir(PROOF_DIR)) {
            respond(['ok' => false, 'error' => 'Impossible de créer le dossier de preuves.'], 500);
        }

        $extension = strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
        $safeName = $id . '_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . ($extension ? '.' . $extension : '');
        $destination = PROOF_DIR . '/' . $safeName;

        if (!move_uploaded_file((string) $file['tmp_name'], $destination)) {
            respond(['ok' => false, 'error' => 'Impossible d’enregistrer la preuve.'], 500);
        }

        $state['blacklist'][$index]['proofs'][] = $safeName;
        appendActivity($state, 'proof', 'Preuve ajoutée', $id);
        saveState($state);
        respond(['ok' => true, 'filename' => $safeName, 'state' => $state]);

    case 'ticket.message':
        $ticketId = cleanString($input['ticketId'] ?? '', 40);
        $content = cleanString($input['content'] ?? '', 1500);
        $index = findIndexById($state['tickets'], $ticketId);
        if ($index < 0) {
            respond(['ok' => false, 'error' => 'Ticket introuvable.'], 404);
        }
        if ($content === '') {
            respond(['ok' => false, 'error' => 'Le message ne peut pas être vide.'], 422);
        }

        $message = [
            'author' => 'Staff · Kirito_Admin',
            'staff' => true,
            'time' => date('H:i'),
            'content' => $content,
        ];
        $state['tickets'][$index]['messages'][] = $message;
        if (($state['tickets'][$index]['status'] ?? '') === 'fermé') {
            $state['tickets'][$index]['status'] = 'ouvert';
        }
        appendActivity($state, 'ticket', 'Réponse envoyée', $ticketId);
        saveState($state);
        respond(['ok' => true, 'message' => $message, 'state' => $state]);

    case 'ticket.status':
        $ticketId = cleanString($input['ticketId'] ?? '', 40);
        $status = cleanString($input['status'] ?? '', 30);
        $allowedStatuses = ['ouvert', 'en attente', 'fermé'];
        if (!in_array($status, $allowedStatuses, true)) {
            respond(['ok' => false, 'error' => 'Statut invalide.'], 422);
        }
        $index = findIndexById($state['tickets'], $ticketId);
        if ($index < 0) {
            respond(['ok' => false, 'error' => 'Ticket introuvable.'], 404);
        }
        $state['tickets'][$index]['status'] = $status;
        // 🗄️ Fermeture = archivage : le ticket quitte les tickets en cours et
        // rejoint les archives (conservées avec toute la conversation).
        if ($status === 'fermé') {
            $archive = $state['tickets'][$index];
            $archive['closedAt'] = date('Y-m-d H:i');
            $archive['closedBy'] = cleanString($input['by'] ?? 'Staff', 60);
            if (!isset($state['archives']) || !is_array($state['archives'])) $state['archives'] = [];
            array_unshift($state['archives'], $archive);
            $state['archives'] = array_slice($state['archives'], 0, 500);
            array_splice($state['tickets'], $index, 1);
            appendActivity($state, 'ticket', 'Ticket fermé et archivé', $ticketId);
            saveState($state);
            respond(['ok' => true, 'archived' => true, 'state' => $state]);
        }
        appendActivity($state, 'ticket', 'Statut du ticket modifié', $ticketId . ' · ' . $status);
        saveState($state);
        respond(['ok' => true, 'state' => $state]);

    // 🗄️ Rouvrir un ticket archivé (il revient dans les tickets en cours).
    case 'ticket.restore': {
        $ticketId = cleanString($input['ticketId'] ?? '', 40);
        $archives = $state['archives'] ?? [];
        $index = findIndexById($archives, $ticketId);
        if ($index < 0) respond(['ok' => false, 'error' => 'Ticket archivé introuvable.'], 404);
        $ticket = $archives[$index];
        unset($ticket['closedAt'], $ticket['closedBy']);
        $ticket['status'] = 'ouvert';
        array_splice($state['archives'], $index, 1);
        array_unshift($state['tickets'], $ticket);
        appendActivity($state, 'ticket', 'Ticket rouvert depuis les archives', $ticketId);
        saveState($state);
        respond(['ok' => true, 'state' => $state]);
    }

    // 🗑️ Supprimer définitivement un ticket archivé.
    case 'ticket.purge': {
        $ticketId = cleanString($input['ticketId'] ?? '', 40);
        $index = findIndexById($state['archives'] ?? [], $ticketId);
        if ($index < 0) respond(['ok' => false, 'error' => 'Ticket archivé introuvable.'], 404);
        array_splice($state['archives'], $index, 1);
        appendActivity($state, 'ticket', 'Archive supprimée', $ticketId);
        saveState($state);
        respond(['ok' => true, 'state' => $state]);
    }

    case 'server.module.save':
        $serverId = cleanString($input['serverId'] ?? '', 80);
        $module = cleanString($input['module'] ?? '', 60);
        $settings = $input['settings'] ?? null;
        $allowedModules = ['overview', 'rp', 'arrivals', 'roles', 'channels', 'levels', 'whitelist', 'tickets'];
        if ($serverId === '' || !in_array($module, $allowedModules, true) || !is_array($settings)) {
            respond(['ok' => false, 'error' => 'Données de module invalides.'], 422);
        }

        if (!isset($state['serverSettings'][$serverId])) {
            $state['serverSettings'][$serverId] = $state['serverSettings']['srv-aincrad'] ?? [];
        }
        $state['serverSettings'][$serverId][$module] = $settings;
        appendActivity($state, 'config', 'Configuration modifiée', ucfirst($module));
        saveState($state);
        respond(['ok' => true, 'state' => $state]);

    case 'site.config.save':
        $config = $input['config'] ?? null;
        if (!is_array($config)) {
            respond(['ok' => false, 'error' => 'Configuration invalide.'], 422);
        }
        $state['siteConfig'] = array_merge($state['siteConfig'], $config);
        appendActivity($state, 'config', 'Configuration du site enregistrée', 'Site builder');
        saveState($state);
        respond(['ok' => true, 'state' => $state]);

    // ── 🤖 Bots : enregistrement de la liste (autant que vous voulez) ──
    case 'bots.save': {
        $incoming = $input['bots'] ?? null;
        if (!is_array($incoming)) {
            respond(['ok' => false, 'error' => 'Liste de bots invalide.'], 422);
        }
        $accents = ['cyan', 'rose', 'gold', 'green', 'violet'];
        $bots = [];
        $used = [];
        foreach ($incoming as $raw) {
            if (!is_array($raw)) continue;
            $name = cleanString($raw['name'] ?? '', 60);
            if ($name === '') continue;
            $id = slugify((string) ($raw['id'] ?? $name), 'bot');
            while (in_array($id, $used, true)) $id .= '-2';
            $used[] = $id;
            $accent = cleanString($raw['accent'] ?? 'cyan', 12);
            $bots[] = [
                'id' => $id,
                'name' => $name,
                'tag' => cleanString($raw['tag'] ?? 'BOT', 30),
                'status' => 'online',
                'description' => cleanString($raw['description'] ?? '', 300),
                'accent' => in_array($accent, $accents, true) ? $accent : 'cyan',
                // Liaison technique : nom du bot chez l'agent + Client ID Discord.
                'agentName' => cleanString($raw['agentName'] ?? '', 40),
                'clientId' => preg_replace('/\D+/', '', (string) ($raw['clientId'] ?? '')),
                'servers' => (int) ($raw['servers'] ?? 0),
                'users' => (int) ($raw['users'] ?? 0),
                'latency' => (int) ($raw['latency'] ?? 0),
            ];
        }
        // Renommer un bot change son identifiant : on reporte l'ancien
        // identifiant sur le nouveau (même position) pour que les serveurs
        // déjà liés ne se retrouvent pas orphelins.
        $anciens = array_column($state['bots'] ?? [], 'id');
        $nouveaux = array_column($bots, 'id');
        $remap = [];
        foreach ($anciens as $position => $ancien) {
            if (isset($nouveaux[$position])) $remap[$ancien] = $nouveaux[$position];
        }
        // On conserve aussi l'avatar Discord déjà récupéré pour ce bot.
        foreach ($bots as $i => $bot) {
            $precedent = $state['bots'][$i] ?? null;
            if ($precedent && !empty($precedent['avatar']) && empty($bot['avatar'])) {
                $bots[$i]['avatar'] = $precedent['avatar'];
            }
        }
        $state['bots'] = $bots;
        foreach ($state['servers'] as $index => $server) {
            $liens = [];
            foreach ($server['botIds'] ?? [] as $ancien) {
                $cible = $remap[$ancien] ?? (in_array($ancien, $nouveaux, true) ? $ancien : null);
                if ($cible !== null) $liens[] = $cible;
            }
            // Un serveur sans aucun bot resterait invisible : on le rattache
            // au premier bot déclaré plutôt que de le faire disparaître.
            if (!$liens && $nouveaux) $liens[] = $nouveaux[0];
            $state['servers'][$index]['botIds'] = array_values(array_unique($liens));
        }
        appendActivity($state, 'config', 'Liste des bots enregistrée', count($bots) . ' bot(s)');
        saveState($state);
        respond(['ok' => true, 'state' => $state]);
    }

    // ── 🔄 Synchronisation avec l'agent : vrais serveurs de chaque bot ──
    case 'agent.sync': {
        $probleme = agent_url_probleme();
        if ($probleme !== null) {
            respond(['ok' => false, 'error' => $probleme], 422);
        }
        [$code, $etat] = agent_get('/agent/etat');
        if ($code !== 200) {
            respond(['ok' => false, 'error' => $code === 0
                ? "Agent injoignable (adresse/port bloqués, ou agent éteint)."
                : "L'agent a répondu HTTP $code — vérifiez la clé dans « 🔗 Connexion à votre agent »."], 502);
        }
        $enLigne = [];
        foreach ($etat['bots'] ?? [] as $bot) {
            if (($bot['status'] ?? '') === 'demarre') $enLigne[] = (string) ($bot['name'] ?? '');
        }
        $servers = [];
        $rapport = [];
        foreach ($state['bots'] as $index => $bot) {
            // Un bot non relié ou injoignable ne doit pas garder de chiffres
            // de démonstration : on remet ses compteurs à zéro.
            $state['bots'][$index]['servers'] = 0;
            $state['bots'][$index]['users'] = 0;
            $agentName = (string) ($bot['agentName'] ?? '');
            if ($agentName === '') { $rapport[] = ['bot' => $bot['name'], 'ok' => false, 'message' => 'Aucun « nom chez l\'agent » renseigné — choisissez-le dans la liste déroulante.']; continue; }
            if (!in_array($agentName, $enLigne, true)) { $rapport[] = ['bot' => $bot['name'], 'ok' => false, 'message' => "« $agentName » n'est pas démarré chez l'agent."]; continue; }
            [$c2, $infos] = agent_get('/agent/bots/' . rawurlencode($agentName) . '/proxy/infos');
            if ($c2 !== 200) {
                $rapport[] = ['bot' => $bot['name'], 'ok' => false, 'message' => $c2 === 0
                    ? "Le bot ne répond pas (API interne arrêtée ou délai dépassé)."
                    : "Réponse HTTP $c2 du bot (version trop ancienne ?)."];
                continue;
            }
            $guilds = $infos['guilds'] ?? [];
            $membres = 0;
            foreach ($guilds as $g) {
                $gid = (string) ($g['id'] ?? '');
                if ($gid === '') continue;
                $membres += (int) ($g['memberCount'] ?? 0);
                if (!isset($servers[$gid])) {
                    $nom = (string) ($g['name'] ?? $gid);
                    $servers[$gid] = [
                        'id' => $gid,
                        'name' => $nom,
                        'short' => strtoupper(substr(preg_replace('/[^A-Za-z0-9]/', '', $nom) ?: 'SV', 0, 2)),
                        'members' => (int) ($g['memberCount'] ?? 0),
                        'online' => 0,
                        'region' => 'Discord',
                        'verified' => true,
                        'botIds' => [],
                        'role' => 'Administrateur',
                        'level' => 100,
                        'activity' => 75,
                        'icon' => $g['icon'] ?? null,
                    ];
                }
                $servers[$gid]['botIds'][] = $bot['id'];
            }
            $state['bots'][$index]['servers'] = count($guilds);
            $state['bots'][$index]['users'] = $membres;
            // Photo de profil et pseudo Discord réels du bot.
            if (!empty($infos['bot']['avatar'])) $state['bots'][$index]['avatar'] = (string) $infos['bot']['avatar'];
            if (!empty($infos['bot']['tag'])) $state['bots'][$index]['discordTag'] = (string) $infos['bot']['tag'];
            if (!empty($infos['bot']['clientId']) && empty($bot['clientId'])) {
                $state['bots'][$index]['clientId'] = preg_replace('/\D+/', '', (string) $infos['bot']['clientId']);
            }
            $rapport[] = ['bot' => $bot['name'], 'ok' => true, 'message' => count($guilds) . ' serveur(s) récupéré(s).'];
        }
        if ($servers) $state['servers'] = array_values($servers);
        appendActivity($state, 'config', 'Synchronisation avec l\'agent', count($servers) . ' serveur(s)');
        saveState($state);
        respond(['ok' => true, 'rapport' => $rapport, 'state' => $state]);
    }

    case 'site.background.upload': {
        // Fond personnalisé du site : image, GIF animé ou VIDÉO MP4.
        // Un envoi plus lourd que post_max_size arrive VIDE chez PHP : sans
        // ce test, on afficherait « aucun fichier reçu » alors que le vrai
        // problème est la limite de l'hébergeur.
        $envoi = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if (!$_FILES && $envoi > 0 && $envoi > taille_octets((string) ini_get('post_max_size'))) {
            respond(['ok' => false, 'error' => "Fichier trop lourd pour votre hébergeur : "
                . taille_lisible($envoi) . " envoyés, mais PHP n'accepte que "
                . taille_lisible(limite_envoi()) . " (post_max_size / upload_max_filesize). "
                . "Compressez la vidéo, ou hébergez-la ailleurs et collez son URL dans « Adresse de la vidéo »."], 413);
        }
        if (!isset($_FILES['background']) || !is_array($_FILES['background'])) {
            respond(['ok' => false, 'error' => 'Aucun fichier reçu.'], 422);
        }
        $file = $_FILES['background'];
        $err = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
            respond(['ok' => false, 'error' => "Fichier trop lourd pour votre hébergeur : la limite de PHP est "
                . taille_lisible(limite_envoi()) . " (upload_max_filesize). "
                . "Compressez la vidéo, ou hébergez-la ailleurs et collez son URL dans « Adresse de la vidéo »."], 413);
        }
        if ($err === UPLOAD_ERR_PARTIAL) {
            respond(['ok' => false, 'error' => "L'envoi a été interrompu avant la fin. Réessayez ; si le fichier est gros, préférez une URL."], 422);
        }
        if ($err !== UPLOAD_ERR_OK) {
            respond(['ok' => false, 'error' => "Aucun fichier valide reçu (code PHP $err)."], 422);
        }

        // Type reconnu par l'extension ET par le contenu réel du fichier.
        $extension = strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
        $mime = function_exists('mime_content_type') ? (mime_content_type((string) $file['tmp_name']) ?: '') : cleanString($file['type'] ?? '', 100);
        $imagesOk = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp', 'gif' => 'image/gif'];
        // Certains serveurs annoncent application/octet-stream pour un MP4 :
        // l'extension fait alors foi, à condition que le contenu ne soit pas
        // reconnu comme autre chose (une image ou du texte, par exemple).
        $videosOk = ['mp4' => 'video/mp4', 'webm' => 'video/webm'];
        $estVideo = isset($videosOk[$extension]) && (strpos($mime, 'video/') === 0 || $mime === '' || $mime === 'application/octet-stream');
        $estImage = isset($imagesOk[$extension]) && $imagesOk[$extension] === $mime;
        if (!$estVideo && !$estImage) {
            respond(['ok' => false, 'error' => "Format non accepté (« $extension », détecté « $mime »). "
                . "Acceptés : PNG, JPG, WEBP, GIF animé, et vidéo MP4 ou WEBM."], 422);
        }

        $maxi = $estVideo ? 60 * 1024 * 1024 : 10 * 1024 * 1024;
        if ((int) $file['size'] > $maxi) {
            respond(['ok' => false, 'error' => ($estVideo ? 'La vidéo' : "L'image") . ' dépasse '
                . taille_lisible($maxi) . ' (' . taille_lisible((int) $file['size']) . ' envoyés).'
                . ($estVideo ? " Une vidéo de fond gagne à rester courte et compressée : elle est téléchargée par CHAQUE visiteur." : '')], 422);
        }

        $bgDir = __DIR__ . '/uploads/backgrounds';
        if (!is_dir($bgDir) && !mkdir($bgDir, 0775, true) && !is_dir($bgDir)) {
            respond(['ok' => false, 'error' => 'Impossible de créer le dossier des fonds.'], 500);
        }
        $safeName = 'bg_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.' . $extension;
        if (!move_uploaded_file((string) $file['tmp_name'], $bgDir . '/' . $safeName)) {
            respond(['ok' => false, 'error' => "Impossible d'enregistrer le fichier — vérifiez les droits d'écriture sur uploads/backgrounds (chmod 775)."], 500);
        }
        $path = 'uploads/backgrounds/' . $safeName;
        if ($estVideo) {
            $state['siteConfig']['bgVideo'] = $path;
            $state['siteConfig']['bgType'] = 'video';
        } else {
            $state['siteConfig']['bgImage'] = $path;
            $state['siteConfig']['bgType'] = 'image';
        }
        appendActivity($state, 'config', $estVideo ? 'Vidéo de fond remplacée' : 'Fond du site remplacé', $safeName);
        saveState($state);
        respond(['ok' => true, 'path' => $path, 'video' => $estVideo, 'state' => $state]);
    }

    default:
        respond(['ok' => false, 'error' => 'Action inconnue.'], 404);
}
