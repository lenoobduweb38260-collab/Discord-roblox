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
    <link rel="stylesheet" href="assets/css/style.css?v=2.0.0">
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
    </script>
    <script src="assets/js/app.js?v=2.0.0" defer></script>
</body>
</html>
