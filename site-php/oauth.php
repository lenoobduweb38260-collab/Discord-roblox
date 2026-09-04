<?php
declare(strict_types=1);

// 🔑 Connexion au site avec un COMPTE DISCORD (OAuth2).
// Ce fichier ne renvoie pas de JSON : il redirige le navigateur.
//   oauth.php?p=login     → envoie chez Discord
//   oauth.php?p=callback  → retour de Discord, ouvre la session
//   oauth.php?p=logout    → ferme la session
//
// Les identifiants Discord (Client ID + Client Secret) se saisissent DANS le
// site (⚙️ Créateur → 🔑 Connexion Discord) — aucun fichier à éditer.

require_once __DIR__ . '/lib_discord.php';

demarrer_session();

$p = $_GET['p'] ?? '';
$retour = site_url() . '/index.php';

// ----- Départ vers Discord -----
if ($p === 'login') {
  $app = discord_app();
  if ($app['clientId'] === '' || $app['clientSecret'] === '') {
    header('Location: ' . $retour . '?erreur=discord_non_configure');
    exit;
  }
  $etat = bin2hex(random_bytes(16));
  $_SESSION['oauth_state'] = $etat;
  // Ceinture ET bretelles : le jeton part AUSSI dans un cookie dédié posé en
  // SameSite=Lax. Si la session ne survit pas à l'aller-retour chez Discord
  // (hébergeur qui impose Strict, session recyclée…), le cookie, lui, revient.
  setcookie('oauth_state_c', $etat, [
    'expires' => time() + 600, 'path' => '/',
    'secure' => req_scheme() === 'https', 'httponly' => true, 'samesite' => 'Lax',
  ]);
  // On mémorise l'adresse de retour EXACTE : Discord exige qu'elle soit
  // identique entre l'autorisation et l'échange du code.
  $redirect = oauth_redirect_uri();
  $_SESSION['oauth_redirect'] = $redirect;
  // « prompt=consent » force Discord à réafficher le choix du compte, au lieu
  // de reconnecter silencieusement le précédent (utile pour en changer).
  $choisir = ($_GET['choisir'] ?? '') === '1' ? '&prompt=consent' : '';
  header('Location: https://discord.com/oauth2/authorize?response_type=code'
    . '&client_id=' . rawurlencode($app['clientId'])
    . '&redirect_uri=' . rawurlencode($redirect)
    . '&scope=identify%20guilds'
    . $choisir
    . '&state=' . $etat);
  exit;
}

// ----- Retour de Discord -----
if ($p === 'callback') {
  $code = (string) ($_GET['code'] ?? '');
  $etat = (string) ($_GET['state'] ?? '');
  // Le jeton renvoyé par Discord doit correspondre à celui posé au départ —
  // en session, OU dans le cookie de dépannage si la session s'est perdue.
  $attenduSession = (string) ($_SESSION['oauth_state'] ?? '');
  $attenduCookie = (string) ($_COOKIE['oauth_state_c'] ?? '');
  $valide = $etat !== '' && (
    ($attenduSession !== '' && hash_equals($attenduSession, $etat))
    || ($attenduCookie !== '' && hash_equals($attenduCookie, $etat))
  );
  if ($code === '' || !$valide) {
    // On note POURQUOI, pour l'afficher sous le bandeau d'erreur.
    $_SESSION['oauth_detail'] = ($attenduSession === '' && $attenduCookie === '')
      ? "Le navigateur est revenu de Discord sans aucun cookie du site : ouvrez le site par la même adresse que celle déclarée dans OAuth2 → Redirects (avec ou sans www, en https), et vérifiez que les cookies ne sont pas bloqués."
      : "Le jeton renvoyé ne correspond pas à celui attendu — souvent deux onglets de connexion ouverts en même temps. Réessayez depuis un seul onglet.";
    header('Location: ' . $retour . '?erreur=oauth_etat');
    exit;
  }
  unset($_SESSION['oauth_state']);
  setcookie('oauth_state_c', '', ['expires' => time() - 3600, 'path' => '/']);
  $redirect = (string) ($_SESSION['oauth_redirect'] ?? oauth_redirect_uri());
  unset($_SESSION['oauth_redirect']);

  $app = discord_app();
  [$st, $token, $brut] = discord_http('https://discord.com/api/oauth2/token', 'POST', [
    'client_id' => $app['clientId'],
    'client_secret' => $app['clientSecret'],
    'grant_type' => 'authorization_code',
    'code' => $code,
    'redirect_uri' => $redirect,
  ]);
  if ($st !== 200 || empty($token['access_token'])) {
    // Le motif exact est rarement lisible côté navigateur : on le garde ici.
    $_SESSION['oauth_detail'] = "HTTP $st — " . substr((string) $brut, 0, 300)
      . " | redirect_uri envoyé : $redirect";
    header('Location: ' . $retour . '?erreur=oauth_echange');
    exit;
  }

  $entete = ['Authorization: Bearer ' . $token['access_token']];
  [, $moi] = discord_http('https://discord.com/api/users/@me', 'GET', null, $entete);
  [, $guildes] = discord_http('https://discord.com/api/users/@me/guilds', 'GET', null, $entete);
  if (empty($moi['id'])) {
    header('Location: ' . $retour . '?erreur=discord_profil');
    exit;
  }

  session_regenerate_id(true);
  $_SESSION['discord'] = [
    'id' => (string) $moi['id'],
    'nom' => (string) ($moi['global_name'] ?? $moi['username'] ?? 'Membre'),
    'pseudo' => (string) ($moi['username'] ?? ''),
    'avatar' => !empty($moi['avatar'])
      ? "https://cdn.discordapp.com/avatars/{$moi['id']}/{$moi['avatar']}.png?size=64"
      : 'https://cdn.discordapp.com/embed/avatars/0.png',
  ];
  $_SESSION['discord_guilds'] = array_map(
    static fn($g) => [
      'id' => (string) ($g['id'] ?? ''),
      'nom' => (string) ($g['name'] ?? ''),
      'icone' => $g['icon'] ?? null,
      'proprietaire' => (bool) ($g['owner'] ?? false),
      'permissions' => (string) ($g['permissions'] ?? '0'),
    ],
    is_array($guildes) ? $guildes : []
  );

  // 👑 Premier arrivé = propriétaire du site. Tant qu'aucun compte n'est
  // autorisé, le tout premier à se connecter le devient — et il est seul à
  // pouvoir en autoriser d'autres ensuite.
  $admins = discord_admins();
  if (!$admins) {
    discord_admins_save([$_SESSION['discord']['id']]);
    $_SESSION['discord_premier'] = true;
  }

  header('Location: ' . $retour);
  exit;
}

if ($p === 'logout') {
  unset($_SESSION['discord'], $_SESSION['discord_guilds'], $_SESSION['site_admin']);
  // La session est repartie de zéro : un identifiant volé ne resservira pas.
  session_regenerate_id(true);
  // « Changer de compte » : on enchaîne directement sur une nouvelle
  // connexion, avec l'écran de choix de compte de Discord.
  if (($_GET['puis'] ?? '') === 'login') {
    header('Location: ' . site_url() . '/oauth.php?p=login&choisir=1');
    exit;
  }
  header('Location: ' . $retour);
  exit;
}

header('Location: ' . $retour);
