<?php
declare(strict_types=1);

// 🔑 Fonctions communes à la connexion Discord — utilisées par oauth.php
// (redirections) ET par api.php (JSON). Aucune sortie ici.

if (!defined('DISCORD_STORE')) {
  // Comme pour l'agent : le fichier commence par une balise PHP « exit »,
  // donc le web ne peut RIEN en lire, même en le demandant directement.
  define('DISCORD_STORE', __DIR__ . '/data/discord.php');
  define('DISCORD_PREFIX', "<?php exit; ?>\n");
}

// ----- Adresse réelle du site (détectée, jamais à recopier) -----
function req_scheme(): string {
  $fw = strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0]));
  if ($fw === 'https' || $fw === 'http') return $fw;
  $https = (string) ($_SERVER['HTTPS'] ?? '');
  if ($https !== '' && strtolower($https) !== 'off') return 'https';
  if ((int) ($_SERVER['SERVER_PORT'] ?? 0) === 443) return 'https';
  return 'http';
}
function req_host(): string {
  $fw = trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_HOST'] ?? ''))[0]);
  return $fw !== '' ? $fw : (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
}
// Dossier du site, sans le nom du fichier (ex : « /site » ou «  »).
function site_url(): string {
  $script = strtok((string) ($_SERVER['SCRIPT_NAME'] ?? '/index.php'), '?');
  $dossier = rtrim(str_replace('\\', '/', dirname('/' . ltrim((string) $script, '/'))), '/');
  return req_scheme() . '://' . req_host() . $dossier;
}
// L'adresse que Discord doit rappeler. C'est CETTE valeur qu'il faut coller
// dans le portail développeur (OAuth2 → Redirects).
function oauth_redirect_uri(): string {
  return site_url() . '/oauth.php?p=callback';
}

// ----- 💾 Identifiants de l'application Discord, saisis dans le site -----
// Le cache passe par une variable globale (et non un « static ») pour qu'une
// écriture le rafraîchisse immédiatement dans la même requête.
function discord_store(): array {
  if (isset($GLOBALS['__discord_store'])) return $GLOBALS['__discord_store'];
  $c = ['clientId' => '', 'clientSecret' => '', 'admins' => []];
  $brut = @file_get_contents(DISCORD_STORE);
  if ($brut !== false && strpos($brut, DISCORD_PREFIX) === 0) {
    $d = json_decode(substr($brut, strlen(DISCORD_PREFIX)), true);
    if (is_array($d)) {
      $c['clientId'] = (string) ($d['clientId'] ?? '');
      $c['clientSecret'] = (string) ($d['clientSecret'] ?? '');
      $c['admins'] = array_values(array_filter(array_map('strval', (array) ($d['admins'] ?? []))));
    }
  }
  $GLOBALS['__discord_store'] = $c;
  return $c;
}
// Enregistrement partiel : les clés absentes gardent leur valeur actuelle.
function discord_store_save(array $valeurs): bool {
  $actuel = discord_store();
  $nouveau = [
    'clientId' => (string) ($valeurs['clientId'] ?? $actuel['clientId']),
    'clientSecret' => (string) ($valeurs['clientSecret'] ?? $actuel['clientSecret']),
    'admins' => array_values(array_unique(array_map('strval', (array) ($valeurs['admins'] ?? $actuel['admins'])))),
  ];
  $ok = @file_put_contents(DISCORD_STORE, DISCORD_PREFIX . json_encode($nouveau)) !== false;
  if ($ok) {
    @chmod(DISCORD_STORE, 0640);
    $GLOBALS['__discord_store'] = $nouveau;
  }
  return $ok;
}

// L'application Discord utilisée : ce qui est saisi dans le site, sinon les
// identifiants du dashboard installé à côté (rien à ressaisir).
function discord_app(): array {
  $s = discord_store();
  if ($s['clientId'] !== '' && $s['clientSecret'] !== '') {
    return ['clientId' => $s['clientId'], 'clientSecret' => $s['clientSecret'], 'origine' => 'saisi dans le site'];
  }
  $d = dashboard_discord();
  if ($d['clientId'] !== '' && $d['clientSecret'] !== '') {
    return ['clientId' => $d['clientId'], 'clientSecret' => $d['clientSecret'], 'origine' => 'repris du ' . $d['source']];
  }
  return ['clientId' => $s['clientId'], 'clientSecret' => $s['clientSecret'], 'origine' => 'aucune'];
}

// Lecture (par expression régulière, jamais d'exécution) du config.php du
// dashboard voisin, pour réutiliser la même application Discord.
function dashboard_discord(): array {
  static $cache = null;
  if ($cache !== null) return $cache;
  $cache = ['clientId' => '', 'clientSecret' => '', 'source' => null];
  $pistes = [
    __DIR__ . '/dashboard/config.php',
    __DIR__ . '/../dashboard/config.php',
    __DIR__ . '/../dashboard-php/config.php',
    dirname(__DIR__) . '/config.php',
  ];
  foreach ($pistes as $chemin) {
    if (!is_file($chemin) || !is_readable($chemin)) continue;
    $contenu = (string) @file_get_contents($chemin);
    if (strpos($contenu, 'DASH_CLIENT_ID') === false) continue;
    if (preg_match("/const\s+DASH_CLIENT_ID\s*=\s*'([^']*)'/", $contenu, $m1)
     && preg_match("/const\s+DASH_CLIENT_SECRET\s*=\s*'([^']*)'/", $contenu, $m2)
     && trim($m1[1]) !== '' && trim($m2[1]) !== '') {
      $cache = ['clientId' => trim($m1[1]), 'clientSecret' => trim($m2[1]), 'source' => basename(dirname($chemin)) . '/config.php'];
      break;
    }
  }
  return $cache;
}

// ----- 👑 Comptes Discord autorisés à administrer le site -----
function discord_admins(): array {
  return discord_store()['admins'];
}
function discord_admins_save(array $ids): bool {
  $propres = [];
  foreach ($ids as $id) {
    $id = preg_replace('/\D+/', '', (string) $id);
    if ($id !== null && $id !== '' && strlen($id) >= 15) $propres[] = $id;
  }
  return discord_store_save(['admins' => array_values(array_unique($propres))]);
}
// Le visiteur connecté est-il l'un des comptes autorisés ?
function discord_est_admin(): bool {
  $id = (string) ($_SESSION['discord']['id'] ?? '');
  if ($id === '') return false;
  $admins = discord_admins();
  return $admins ? in_array($id, $admins, true) : false;
}

// ----- Appel HTTP vers l'API Discord -----
// Renvoie [code, données décodées, corps brut].
function discord_http(string $url, string $methode = 'GET', ?array $corps = null, array $entetes = []): array {
  $entetes[] = 'Accept: application/json';
  $donnees = null;
  if ($corps !== null) {
    $donnees = http_build_query($corps);
    $entetes[] = 'Content-Type: application/x-www-form-urlencoded';
  }
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_CUSTOMREQUEST => $methode,
      CURLOPT_HTTPHEADER => $entetes,
      CURLOPT_TIMEOUT => 15,
    ]);
    if ($donnees !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $donnees);
    $brut = curl_exec($ch);
    $code = (int) (curl_getinfo($ch, CURLINFO_RESPONSE_CODE) ?: 0);
    curl_close($ch);
  } else {
    $ctx = stream_context_create(['http' => [
      'method' => $methode,
      'header' => implode("\r\n", $entetes),
      'content' => $donnees,
      'timeout' => 15,
      'ignore_errors' => true,
    ]]);
    $brut = @file_get_contents($url, false, $ctx);
    $code = 0;
    foreach ($http_response_header ?? [] as $h) {
      if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $code = (int) $m[1];
    }
  }
  $data = $brut === false ? null : json_decode((string) $brut, true);
  return [$code, is_array($data) ? $data : [], (string) $brut];
}
