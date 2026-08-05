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

// ----- 🔒 Protection de l'administration -----
// Sans mot de passe défini, le site reste ouvert (pratique en local).
// Dès qu'un mot de passe est renseigné dans config.php, TOUTE modification
// exige d'être connecté.
session_start();
function admin_password(): string {
  return defined('SITE_ADMIN_PASSWORD') ? (string) SITE_ADMIN_PASSWORD : '';
}
function admin_requis(): bool { return admin_password() !== ''; }
function admin_connecte(): bool { return !admin_requis() || !empty($_SESSION['site_admin']); }
function exiger_admin(): void {
  if (!admin_connecte()) {
    respond(['ok' => false, 'error' => 'Connexion requise : entrez le mot de passe d\'administration.', 'authRequired' => true], 401);
  }
}
function agent_url(): string { return defined('SITE_AGENT_URL') ? rtrim(SITE_AGENT_URL, '/') : ''; }
function agent_key(): string { return defined('SITE_AGENT_KEY') ? SITE_AGENT_KEY : ''; }

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
    respond([
        'ok' => true,
        'php' => PHP_VERSION,
        'phpSuffisant' => version_compare(PHP_VERSION, '7.4', '>='),
        'donneesLisibles' => is_file(DATA_FILE),
        'donneesModifiables' => $dataOk,
        'dossierPreuves' => is_dir(PROOF_DIR) ? is_writable(PROOF_DIR) : 'absent',
        'dossierFonds' => is_dir($bgDir) ? is_writable($bgDir) : 'absent',
        'curl' => function_exists('curl_init'),
        'allow_url_fopen' => (bool) ini_get('allow_url_fopen'),
        'agentConfigure' => agent_url() !== '',
        'conseil' => $dataOk
            ? 'Tout est bon : les enregistrements doivent fonctionner.'
            : 'Donnez les droits d\'écriture à data/app.json (chmod 664) et au dossier data/ (chmod 775).',
    ]);
}

if ($method === 'GET' && $action === 'state') {
    respond(['ok' => true, 'state' => loadState(), 'authRequired' => admin_requis(), 'authOk' => admin_connecte()]);
}

if ($method !== 'POST') {
    respond(['ok' => false, 'error' => 'Méthode non autorisée.'], 405);
}

$state = loadState();
$input = body();
$action = $input['action'] ?? $action;

// ----- 🔑 Connexion / déconnexion de l'administration -----
if ($action === 'auth.login') {
    if (!admin_requis()) respond(['ok' => true, 'authOk' => true, 'note' => 'Aucun mot de passe configuré.']);
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

// Toutes les autres écritures exigent d'être connecté.
exiger_admin();

switch ($action) {
    case 'blacklist.add':
        $username = cleanString($input['username'] ?? '', 80);
        $discordId = preg_replace('/\D+/', '', (string) ($input['discordId'] ?? ''));
        $reason = cleanString($input['reason'] ?? '', 800);
        $server = cleanString($input['server'] ?? '', 120);
        $severity = cleanString($input['severity'] ?? 'moyenne', 20);

        if ($username === '' || $discordId === '' || $reason === '') {
            respond(['ok' => false, 'error' => 'Nom, identifiant Discord et motif sont obligatoires.'], 422);
        }

        $entry = [
            'id' => 'BL-' . random_int(1100, 9999),
            'discordId' => $discordId,
            'username' => $username,
            'reason' => $reason,
            'severity' => in_array($severity, ['faible', 'moyenne', 'élevée', 'critique'], true) ? $severity : 'moyenne',
            'server' => $server !== '' ? $server : 'Global',
            'author' => 'Kirito_Admin',
            'date' => date('Y-m-d'),
            'proofs' => [],
        ];

        array_unshift($state['blacklist'], $entry);
        appendActivity($state, 'blacklist', 'Utilisateur blacklisté', $username);
        saveState($state);
        respond(['ok' => true, 'entry' => $entry, 'state' => $state]);

    case 'blacklist.delete':
        $id = cleanString($input['id'] ?? '', 40);
        $index = findIndexById($state['blacklist'], $id);
        if ($index < 0) {
            respond(['ok' => false, 'error' => 'Entrée introuvable.'], 404);
        }
        $removed = $state['blacklist'][$index];
        array_splice($state['blacklist'], $index, 1);
        appendActivity($state, 'blacklist', 'Blacklist retirée', (string) ($removed['username'] ?? $id));
        saveState($state);
        respond(['ok' => true, 'state' => $state]);

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
        if (agent_url() === '') {
            respond(['ok' => false, 'error' => "Aucun agent configuré : renseignez SITE_AGENT_URL et SITE_AGENT_KEY dans config.php."], 422);
        }
        [$code, $etat] = agent_get('/agent/etat');
        if ($code !== 200) {
            respond(['ok' => false, 'error' => $code === 0
                ? "Agent injoignable (adresse/port bloqués, ou agent éteint)."
                : "L'agent a répondu HTTP $code — vérifiez SITE_AGENT_KEY."], 502);
        }
        $enLigne = [];
        foreach ($etat['bots'] ?? [] as $bot) {
            if (($bot['status'] ?? '') === 'demarre') $enLigne[] = (string) ($bot['name'] ?? '');
        }
        $servers = [];
        $rapport = [];
        foreach ($state['bots'] as $index => $bot) {
            $agentName = (string) ($bot['agentName'] ?? '');
            if ($agentName === '') { $rapport[] = ['bot' => $bot['name'], 'ok' => false, 'message' => 'Aucun « nom chez l\'agent » renseigné.']; continue; }
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

    case 'site.background.upload':
        // Fond personnalisé du site : image téléversée par le créateur.
        if (!isset($_FILES['background']) || $_FILES['background']['error'] !== UPLOAD_ERR_OK) {
            respond(['ok' => false, 'error' => 'Aucune image valide reçue.'], 422);
        }
        $file = $_FILES['background'];
        if ((int) $file['size'] > 10 * 1024 * 1024) {
            respond(['ok' => false, 'error' => "L'image dépasse 10 Mo."], 422);
        }
        $allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
        $mime = function_exists('mime_content_type') ? (mime_content_type((string) $file['tmp_name']) ?: '') : cleanString($file['type'] ?? '', 100);
        if (!in_array($mime, $allowed, true)) {
            respond(['ok' => false, 'error' => 'Formats acceptés : PNG, JPG, WEBP ou GIF (animé accepté).'], 422);
        }
        $bgDir = __DIR__ . '/uploads/backgrounds';
        if (!is_dir($bgDir) && !mkdir($bgDir, 0775, true) && !is_dir($bgDir)) {
            respond(['ok' => false, 'error' => 'Impossible de créer le dossier des fonds.'], 500);
        }
        $extension = strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
        if (!in_array($extension, ['png', 'jpg', 'jpeg', 'webp', 'gif'], true)) {
            $extension = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/gif' => 'gif'][$mime] ?? 'png';
        }
        $safeName = 'bg_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . '.' . $extension;
        if (!move_uploaded_file((string) $file['tmp_name'], $bgDir . '/' . $safeName)) {
            respond(['ok' => false, 'error' => "Impossible d'enregistrer l'image."], 500);
        }
        $path = 'uploads/backgrounds/' . $safeName;
        $state['siteConfig']['bgImage'] = $path;
        $state['siteConfig']['bgType'] = 'image';
        appendActivity($state, 'config', 'Fond du site remplacé', $safeName);
        saveState($state);
        respond(['ok' => true, 'path' => $path, 'state' => $state]);

    default:
        respond(['ok' => false, 'error' => 'Action inconnue.'], 404);
}
