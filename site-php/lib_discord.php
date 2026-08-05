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
  $c = ['clientId' => '', 'clientSecret' => '', 'admins' => [], 'staff' => []];
  $brut = @file_get_contents(DISCORD_STORE);
  if ($brut !== false && strpos($brut, DISCORD_PREFIX) === 0) {
    $d = json_decode(substr($brut, strlen(DISCORD_PREFIX)), true);
    if (is_array($d)) {
      $c['clientId'] = (string) ($d['clientId'] ?? '');
      $c['clientSecret'] = (string) ($d['clientSecret'] ?? '');
      $c['admins'] = array_values(array_filter(array_map('strval', (array) ($d['admins'] ?? []))));
      $c['staff'] = is_array($d['staff'] ?? null) ? $d['staff'] : [];
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
    'staff' => (array) ($valeurs['staff'] ?? $actuel['staff']),
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

// ----- 👑 LE propriétaire, défini dans config.php -----
// Renseigné, il l'emporte sur tout : impossible de le retirer depuis le site,
// et le site est protégé DÈS L'INSTALLATION (aucun inconnu ne peut s'en
// emparer en se connectant le premier).
function owner_id(): string {
  if (!defined('SITE_OWNER_ID')) return '';
  $id = preg_replace('/\D+/', '', (string) SITE_OWNER_ID);
  return ($id !== null && strlen($id) >= 15 && strlen($id) <= 25) ? $id : '';
}
function moi_id(): string { return (string) ($_SESSION['discord']['id'] ?? ''); }
function est_owner(): bool {
  $moi = moi_id();
  if ($moi === '') return false;
  $owner = owner_id();
  if ($owner !== '') return $moi === $owner;
  // Sans propriétaire épinglé, le premier compte enregistré fait office.
  $admins = discord_admins();
  return $admins && $moi === $admins[0];
}

// ----- 🎭 L'équipe : qui a droit à quoi, par identifiant Discord -----
// { "identifiant" : "grade" } — les grades sont ceux du site
// (membre, police, staff, admin, bot-tickets, bot-blacklist, bot-staff, createur).
function discord_staff(): array {
  $s = discord_store();
  $equipe = is_array($s['staff'] ?? null) ? $s['staff'] : [];
  // Le propriétaire est TOUJOURS créateur, quoi qu'il y ait dans le fichier.
  $owner = owner_id();
  if ($owner !== '') $equipe[$owner] = 'createur';
  return $equipe;
}
function discord_staff_save(array $equipe): bool {
  $propre = [];
  foreach ($equipe as $id => $grade) {
    $id = preg_replace('/\D+/', '', (string) $id);
    $grade = preg_replace('/[^a-z\-]/', '', strtolower((string) $grade));
    if ($id !== null && strlen($id) >= 15 && strlen($id) <= 25 && $grade !== '') $propre[$id] = $grade;
  }
  $owner = owner_id();
  if ($owner !== '') $propre[$owner] = 'createur';
  return discord_store_save(['staff' => $propre]);
}
// Le grade du visiteur connecté. null = simple visiteur, sans accès à
// l'espace de gestion.
function mon_grade(): ?string {
  if (est_owner()) return 'createur';
  $moi = moi_id();
  if ($moi === '') return null;
  $equipe = discord_staff();
  if (isset($equipe[$moi])) return $equipe[$moi];
  // Compatibilité : les comptes de l'ancienne liste « admins » sont créateurs.
  return in_array($moi, discord_admins(), true) ? 'createur' : null;
}
// A-t-il un grade dans l'équipe DU SITE (tickets, blacklist, créateur) ?
function est_staff(): bool { return mon_grade() !== null; }

// ----- 🏠 Gestionnaire de SES propres serveurs -----
// Quelqu'un qui n'est pas de l'équipe du site, mais qui est propriétaire ou
// administrateur d'un serveur Discord OÙ LE BOT EST PRÉSENT, doit pouvoir
// gérer CE serveur — et seulement celui-là. C'est le fonctionnement attendu
// d'un dashboard de bot : chacun configure chez soi.
function mes_serveurs_geres(array $state): array {
  $ids = [];
  $miens = mes_guildes_index();
  if (!$miens) return $ids;
  foreach ($state['servers'] ?? [] as $s) {
    $id = (string) ($s['id'] ?? '');
    if ($id === '' || !isset($miens[$id])) continue;
    // Seuls ceux qui peuvent réellement administrer le serveur Discord.
    if (in_array(role_sur_guilde($miens[$id]), ['Propriétaire', 'Administrateur', 'Gestionnaire'], true)) {
      $ids[] = $id;
    }
  }
  return $ids;
}
// Peut-il ouvrir l'espace de gestion, à un titre ou à un autre ?
function a_acces_gestion(array $state): bool {
  return est_staff() || mes_serveurs_geres($state) !== [];
}
// A-t-il le droit de configurer CE serveur précis ?
function peut_gerer_serveur(array $state, string $guildId): bool {
  if (est_staff()) return true;                       // équipe du site : partout
  return in_array($guildId, mes_serveurs_geres($state), true);
}

// ----- 👑 Comptes Discord autorisés à administrer le site -----
function discord_admins(): array {
  $admins = discord_store()['admins'];
  $owner = owner_id();
  // Le propriétaire figure toujours en tête et ne peut pas disparaître.
  if ($owner !== '') {
    $admins = array_values(array_diff($admins, [$owner]));
    array_unshift($admins, $owner);
  }
  return $admins;
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
  if (est_owner()) return true;
  $id = moi_id();
  if ($id === '') return false;
  // Le grade « createur » donne les pleins pouvoirs sur le site.
  if (mon_grade() === 'createur') return true;
  $admins = discord_admins();
  return $admins ? in_array($id, $admins, true) : false;
}

// ----- 🌐 Les serveurs Discord du membre connecté -----
// Discord nous renvoie, à la connexion, la liste de SES serveurs. On s'en
// sert pour ne montrer à chacun que ce qui le concerne.
function mes_guildes(): array {
  $g = $_SESSION['discord_guilds'] ?? [];
  return is_array($g) ? $g : [];
}
// Quel pouvoir le membre a-t-il sur ce serveur ?
// 0x8 = Administrateur, 0x20 = Gérer le serveur.
function role_sur_guilde(array $g): string {
  if (!empty($g['proprietaire'])) return 'Propriétaire';
  $p = (int) ($g['permissions'] ?? 0);
  if ($p & 0x8) return 'Administrateur';
  if ($p & 0x20) return 'Gestionnaire';
  return 'Membre';
}
// Identifiants des serveurs du membre, pour un croisement rapide.
function mes_guildes_index(): array {
  $index = [];
  foreach (mes_guildes() as $g) {
    $id = (string) ($g['id'] ?? '');
    if ($id !== '') $index[$id] = $g;
  }
  return $index;
}

// 🌐 Croise les serveurs synchronisés depuis l'agent avec CEUX DU MEMBRE
// connecté. Après une synchronisation, l'identifiant d'un serveur du site est
// l'identifiant Discord de la guilde : la correspondance est donc directe.
function marquer_mes_serveurs(array $state): array {
    $miens = mes_guildes_index();
    if (!$miens) return $state;
    foreach ($state['servers'] ?? [] as $i => $s) {
        $g = $miens[(string) ($s['id'] ?? '')] ?? null;
        $state['servers'][$i]['mien'] = $g !== null;
        if ($g !== null) {
            // Le rôle affiché devient celui que le membre a VRAIMENT.
            $state['servers'][$i]['role'] = role_sur_guilde($g);
        }
    }
    return $state;
}

// Serveurs du membre où le bot n'est PAS encore présent : on les propose,
// avec le lien d'invitation, plutôt que de les passer sous silence.
function mes_serveurs_sans_bot(array $state): array {
    $connus = [];
    foreach ($state['servers'] ?? [] as $s) $connus[(string) ($s['id'] ?? '')] = true;
    $sortie = [];
    foreach (mes_guildes() as $g) {
        $id = (string) ($g['id'] ?? '');
        if ($id === '' || isset($connus[$id])) continue;
        $role = role_sur_guilde($g);
        // Seuls les serveurs où le membre peut réellement inviter un bot.
        if (!in_array($role, ['Propriétaire', 'Administrateur', 'Gestionnaire'], true)) continue;
        $sortie[] = [
            'id' => $id,
            'name' => (string) ($g['nom'] ?? $id),
            'icon' => $g['icone'] ?? null,
            'role' => $role,
        ];
    }
    return $sortie;
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
