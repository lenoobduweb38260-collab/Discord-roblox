<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

const DATA_FILE = __DIR__ . '/data/app.json';
const PROOF_DIR = __DIR__ . '/uploads/proofs';

// Configuration facultative (liaison à l'agent hébergeur).
if (is_file(__DIR__ . '/config.php')) require_once __DIR__ . '/config.php';
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

function respond(array $payload, int $status = 200): never
{
    http_response_code($status);
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
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (str_contains($contentType, 'application/json')) {
        $decoded = json_decode((string) file_get_contents('php://input'), true);
        return is_array($decoded) ? $decoded : [];
    }

    return $_POST;
}

function cleanString(mixed $value, int $max = 500): string
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

if ($method === 'GET' && $action === 'state') {
    respond(['ok' => true, 'state' => loadState()]);
}

if ($method !== 'POST') {
    respond(['ok' => false, 'error' => 'Méthode non autorisée.'], 405);
}

$state = loadState();
$input = body();
$action = $input['action'] ?? $action;

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
        appendActivity($state, 'ticket', 'Statut du ticket modifié', $ticketId . ' · ' . $status);
        saveState($state);
        respond(['ok' => true, 'state' => $state]);

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
        $state['bots'] = $bots;
        // Les serveurs qui référencent un bot supprimé sont nettoyés.
        $ids = array_column($bots, 'id');
        foreach ($state['servers'] as $index => $server) {
            $state['servers'][$index]['botIds'] = array_values(array_intersect($server['botIds'] ?? [], $ids));
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
