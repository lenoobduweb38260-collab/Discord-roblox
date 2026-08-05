<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

const DATA_FILE = __DIR__ . '/data/app.json';
const PROOF_DIR = __DIR__ . '/uploads/proofs';

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
