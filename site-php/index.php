<?php
declare(strict_types=1);

$dataFile = __DIR__ . '/data/app.json';
$bootState = [];
if (is_file($dataFile)) {
    $decoded = json_decode((string) file_get_contents($dataFile), true);
    if (is_array($decoded)) {
        $bootState = $decoded;
    }
}
$siteName = htmlspecialchars((string) ($bootState['siteConfig']['siteName'] ?? 'Aincrad Control Panel'), ENT_QUOTES, 'UTF-8');

// 🔒 Qui est connecté, et le site est-il protégé ?
if (is_file(__DIR__ . '/config.php')) require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib_discord.php';
if (session_status() !== PHP_SESSION_ACTIVE) session_start();

$motDePasse = defined('SITE_ADMIN_PASSWORD') ? (string) SITE_ADMIN_PASSWORD : '';
// Le site est protégé dès qu'un propriétaire est épinglé, qu'un compte est
// autorisé, ou qu'un mot de passe de secours existe.
$authRequired = $motDePasse !== '' || owner_id() !== '' || discord_admins() !== [] || discord_staff() !== [];
$authOk = !$authRequired || discord_est_admin() || !empty($_SESSION['site_admin']);

// Profil Discord de la session (jamais de secret ici).
$moi = null;
if (!empty($_SESSION['discord']['id'])) {
    $u = $_SESSION['discord'];
    $moi = [
        'id' => (string) $u['id'],
        'nom' => (string) ($u['nom'] ?? 'Membre'),
        'pseudo' => (string) ($u['pseudo'] ?? ''),
        'avatar' => (string) ($u['avatar'] ?? ''),
        'admin' => discord_est_admin(),
        'owner' => est_owner(),
        'grade' => mon_grade(),
        'staff' => est_staff(),
        'serveurs' => count($_SESSION['discord_guilds'] ?? []),
        'premier' => !empty($_SESSION['discord_premier']),
    ];
    unset($_SESSION['discord_premier']);
}
$app = discord_app();
$discordPret = $app['clientId'] !== '' && $app['clientSecret'] !== '';

// 🌐 Marque les serveurs où le membre connecté est réellement présent, dès
// le premier affichage — sans quoi il faudrait attendre un appel à l'API.
$bootState = marquer_mes_serveurs($bootState);
$mesServeursSansBot = (est_staff() || $authOk) ? mes_serveurs_sans_bot($bootState) : [];
$nbMesServeurs = count(mes_guildes());

// 🌐 Un visiteur qui n'est pas du staff ne doit PAS recevoir les tickets ni
// la blacklist : la page publique n'embarque que ce qu'elle affiche.
if (!est_staff() && !$authOk) {
    $bootState = [
        'bots' => $bootState['bots'] ?? [],
        'siteConfig' => $bootState['siteConfig'] ?? [],
        'servers' => [], 'blacklist' => [], 'tickets' => [],
        'archives' => [], 'activity' => [], 'serverSettings' => new stdClass(),
    ];
}
// Message d'erreur éventuel du retour OAuth2, traduit en clair.
$oauthErreurs = [
    'discord_non_configure' => "La connexion Discord n'est pas encore configurée sur ce site (⚙️ Créateur → 🔑 Connexion Discord).",
    'oauth_etat' => "Connexion interrompue (jeton de sécurité expiré). Réessayez.",
    'oauth_echange' => "Discord a refusé la connexion. Vérifiez la clé secrète, et que l'adresse de retour est bien déclarée dans OAuth2 → Redirects.",
    'discord_profil' => "Discord n'a pas renvoyé votre profil. Réessayez dans un instant.",
];
$oauthErreur = $oauthErreurs[$_GET['erreur'] ?? ''] ?? null;
$oauthDetail = $oauthErreur !== null ? (string) ($_SESSION['oauth_detail'] ?? '') : '';
unset($_SESSION['oauth_detail']);

// 🧹 Empreinte des fichiers statiques : elle change dès que le CSS ou le JS
// change (mise à jour automatique comprise). Sans elle, le navigateur garderait
// l'ancienne version en cache et la mise à jour resterait invisible.
function empreinte_assets(): string
{
    $parts = [];
    foreach (['/assets/js/app.js', '/assets/css/style.css'] as $f) {
        $parts[] = (string) @filemtime(__DIR__ . $f);
    }
    $parts[] = trim((string) @file_get_contents(__DIR__ . '/data/version.txt'));
    return substr(md5(implode('|', $parts)), 0, 10);
}

// Taille maximale d'un envoi, telle que la impose l'hébergeur (la plus petite
// des deux limites PHP). Affichée sous le champ de téléversement.
function taille_envoi_lisible(): string
{
    $lire = static function (string $v): int {
        $v = trim($v);
        if ($v === '') return 0;
        $u = strtolower(substr($v, -1));
        $n = (int) $v;
        if ($u === 'g') return $n * 1073741824;
        if ($u === 'm') return $n * 1048576;
        if ($u === 'k') return $n * 1024;
        return $n;
    };
    $limites = array_filter([$lire((string) ini_get('upload_max_filesize')), $lire((string) ini_get('post_max_size'))]);
    if (!$limites) return '';
    $octets = min($limites);
    if ($octets >= 1073741824) return round($octets / 1073741824, 1) . ' Go';
    if ($octets >= 1048576) return round($octets / 1048576, 1) . ' Mo';
    return round($octets / 1024) . ' Ko';
}
?>
<!doctype html>
<html lang="fr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#03121f">
    <meta name="description" content="Interface PHP de gestion de bots Discord inspirée d’Aincrad.">
    <title><?= $siteName ?></title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Exo+2:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Orbitron:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700;800&family=Poppins:wght@400;500;600;700;800&display=swap">
    <link rel="stylesheet" href="assets/css/style.css?v=<?= empreinte_assets() ?>">
</head>
<body>
<?php
    // Écran de chargement entièrement personnalisable depuis le Site builder.
    $cfg = $bootState['siteConfig'] ?? [];
    $bootLogo = trim((string) ($cfg['bootLogo'] ?? $cfg['logo'] ?? '⚔️'));
    $bootTitle = htmlspecialchars((string) ($cfg['bootTitle'] ?? 'INITIALISATION'), ENT_QUOTES, 'UTF-8');
    $bootSub = htmlspecialchars((string) ($cfg['bootSubtitle'] ?? 'Chargement du système…'), ENT_QUOTES, 'UTF-8');
    $bootLogoHtml = preg_match('#^(https?://|uploads/|assets/)#', $bootLogo)
        ? '<img src="' . htmlspecialchars($bootLogo, ENT_QUOTES, 'UTF-8') . '" alt="">'
        : htmlspecialchars($bootLogo !== '' ? $bootLogo : '⚔️', ENT_QUOTES, 'UTF-8');
    ?>
    <div id="boot-screen" class="boot-screen" aria-hidden="true">
        <div class="boot-core">
            <div class="boot-ring"></div>
            <div class="boot-logo"><?= $bootLogoHtml ?></div>
            <strong><?= $bootTitle ?></strong>
            <span><?= $bootSub ?></span>
        </div>
    </div>

    <div class="sky-layer" aria-hidden="true"></div>
    <div id="particle-field" class="particle-field" aria-hidden="true"></div>
    <div class="scanline" aria-hidden="true"></div>
    <div id="cursor-aura" aria-hidden="true"></div>

    <main id="app" aria-live="polite"></main>
    <div id="modal-root"></div>
    <div id="toast-root" class="toast-root"></div>

    <script>
        window.AINCRAD_BOOT_STATE = <?= json_encode($bootState, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?>;
        window.AINCRAD_API = 'api.php';
        window.AINCRAD_AUTH = <?= json_encode(['required' => $authRequired, 'ok' => $authOk, 'motDePasse' => $motDePasse !== '']) ?>;
        // 🔑 Compte Discord connecté (null si personne) + état de la liaison.
        window.AINCRAD_MOI = <?= json_encode($moi, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?>;
        window.AINCRAD_DISCORD = <?= json_encode([
            'pret' => $discordPret,
            'redirect' => oauth_redirect_uri(),
            'erreur' => $oauthErreur,
            'detail' => $oauthDetail,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?>;
        // Limite d'envoi de l'hébergeur : sert à prévenir avant de téléverser
        // une vidéo trop lourde.
        window.AINCRAD_UPLOAD_MAX = <?= json_encode(taille_envoi_lisible(), JSON_UNESCAPED_UNICODE) ?>;
        // 🌐 Vos serveurs Discord : ceux sans le bot, et leur nombre total.
        window.AINCRAD_MES_SERVEURS = <?= json_encode([
            'sansBot' => $mesServeursSansBot,
            'total' => $nbMesServeurs,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?>;
    </script>
    <script src="assets/js/app.js?v=<?= empreinte_assets() ?>" defer></script>
</body>
</html>
