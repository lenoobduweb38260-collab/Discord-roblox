<?php
declare(strict_types=1);

// 🔄 Mise à jour automatique du site ET des bots qu'il pilote.
//
// Le site va chercher la dernière version publiée sur GitHub (le même dépôt
// que vos bots) et se remplace lui-même, puis demande à l'agent de mettre à
// jour chaque bot déclaré. Rien n'est écrasé dans data/, uploads/ ni
// config.php : vos réglages, vos images et vos données restent intacts.

if (!defined('MAJ_DEPOT')) {
  define('MAJ_DEPOT', 'lenoobduweb38260-collab/Discord-roblox');
  define('MAJ_ASSET', 'pack-site-builder.zip');
  define('MAJ_VERSION_FICHIER', __DIR__ . '/data/version.txt');
  define('MAJ_ETAT_FICHIER', __DIR__ . '/data/maj.php');
  define('MAJ_VERROU', __DIR__ . '/data/maj.lock');
  // Ce que la mise à jour ne doit JAMAIS toucher.
  define('MAJ_PROTEGE', ['data', 'uploads', 'config.php']);
}

function maj_version_installee(): string {
  $v = trim((string) @file_get_contents(MAJ_VERSION_FICHIER));
  return $v !== '' ? $v : 'inconnue';
}

// Petit journal du dernier passage (date, résultat), pour l'afficher.
function maj_etat(): array {
  $brut = @file_get_contents(MAJ_ETAT_FICHIER);
  if ($brut !== false && strpos($brut, "<?php exit; ?>\n") === 0) {
    $d = json_decode(substr($brut, 15), true);
    if (is_array($d)) return $d;
  }
  return ['dernierTest' => 0, 'derniereMaj' => 0, 'auto' => false, 'message' => '', 'disponible' => ''];
}
function maj_etat_save(array $etat): void {
  @file_put_contents(MAJ_ETAT_FICHIER, "<?php exit; ?>\n" . json_encode($etat));
  @chmod(MAJ_ETAT_FICHIER, 0640);
}

// ----- Téléchargement -----
function maj_http(string $url, bool $binaire = false): array {
  $entetes = ['User-Agent: aincrad-site-maj', 'Accept: ' . ($binaire ? 'application/octet-stream' : 'application/vnd.github+json')];
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_HTTPHEADER => $entetes,
      CURLOPT_FOLLOWLOCATION => true,
      CURLOPT_TIMEOUT => $binaire ? 120 : 20,
    ]);
    $corps = curl_exec($ch);
    $code = (int) (curl_getinfo($ch, CURLINFO_RESPONSE_CODE) ?: 0);
    $err = curl_error($ch);
    curl_close($ch);
    return [$code, $corps === false ? '' : (string) $corps, $err];
  }
  $ctx = stream_context_create(['http' => [
    'method' => 'GET', 'header' => implode("\r\n", $entetes),
    'timeout' => $binaire ? 120 : 20, 'follow_location' => 1, 'ignore_errors' => true,
  ]]);
  $corps = @file_get_contents($url, false, $ctx);
  $code = 0;
  foreach ($http_response_header ?? [] as $h) {
    if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $code = (int) $m[1];
  }
  return [$code, $corps === false ? '' : (string) $corps, $corps === false ? 'Téléchargement impossible' : ''];
}

// Dernière version publiée : [version, urlDuPack, erreur]
function maj_derniere_version(): array {
  [$code, $corps, $err] = maj_http('https://api.github.com/repos/' . MAJ_DEPOT . '/releases/latest');
  if ($code !== 200) {
    return ['', '', $code === 0
      ? "Impossible de joindre GitHub depuis votre hébergeur" . ($err ? " ($err)" : '') . ". Les connexions sortantes sont peut-être bloquées."
      : "GitHub a répondu HTTP $code."];
  }
  $d = json_decode($corps, true);
  if (!is_array($d) || empty($d['tag_name'])) return ['', '', "Réponse GitHub inattendue."];
  $lien = '';
  foreach ($d['assets'] ?? [] as $a) {
    if (($a['name'] ?? '') === MAJ_ASSET) { $lien = (string) ($a['browser_download_url'] ?? ''); break; }
  }
  if ($lien === '') return [(string) $d['tag_name'], '', "La version " . $d['tag_name'] . " ne contient pas « " . MAJ_ASSET . " »."];
  return [(string) $d['tag_name'], $lien, ''];
}

// Compare « v1.0.97 » et « v1.0.101 » numériquement (et pas alphabétiquement).
function maj_plus_recente(string $candidate, string $installee): bool {
  if ($installee === '' || $installee === 'inconnue') return true;
  if ($candidate === $installee) return false;
  $n = static fn(string $v): array => array_map('intval', explode('.', ltrim(trim($v), 'vV')));
  $a = $n($candidate); $b = $n($installee);
  for ($i = 0; $i < max(count($a), count($b)); $i++) {
    $x = $a[$i] ?? 0; $y = $b[$i] ?? 0;
    if ($x !== $y) return $x > $y;
  }
  return false;
}

// Supprime un dossier et tout son contenu.
function maj_rmdir(string $chemin): void {
  if (!is_dir($chemin)) { @unlink($chemin); return; }
  foreach (scandir($chemin) ?: [] as $e) {
    if ($e === '.' || $e === '..') continue;
    maj_rmdir($chemin . '/' . $e);
  }
  @rmdir($chemin);
}

// Copie récursive, en épargnant les chemins protégés à la racine.
function maj_copier(string $source, string $cible, string $racine, array &$journal): void {
  foreach (scandir($source) ?: [] as $e) {
    if ($e === '.' || $e === '..') continue;
    $de = $source . '/' . $e;
    $vers = $cible . '/' . $e;
    // Chemin protégé (uniquement au premier niveau du site).
    if ($cible === $racine && in_array($e, MAJ_PROTEGE, true)) { $journal[] = "conservé : $e"; continue; }
    if (is_dir($de)) {
      if (!is_dir($vers) && !@mkdir($vers, 0775, true) && !is_dir($vers)) { $journal[] = "échec dossier : $e"; continue; }
      maj_copier($de, $vers, $racine, $journal);
    } else {
      if (@copy($de, $vers)) $journal[] = "mis à jour : " . ltrim(str_replace($racine, '', $vers), '/');
      else $journal[] = "ÉCHEC : " . ltrim(str_replace($racine, '', $vers), '/');
    }
  }
}

// ----- Mise à jour du SITE lui-même -----
// Renvoie ['ok'=>bool, 'message'=>string, 'version'=>string, 'details'=>array]
function maj_site(?string $version = null, ?string $lien = null): array {
  $racine = __DIR__;
  if (!class_exists('ZipArchive')) {
    return ['ok' => false, 'message' => "L'extension PHP « zip » manque chez votre hébergeur : la mise à jour automatique du site est impossible. Les bots, eux, peuvent quand même être mis à jour."];
  }
  if (!is_writable($racine)) {
    return ['ok' => false, 'message' => "Le dossier du site n'est pas modifiable par PHP : impossible de le mettre à jour tout seul. Donnez les droits d'écriture, ou remplacez les fichiers à la main."];
  }
  if ($version === null || $lien === null) {
    [$version, $lien, $err] = maj_derniere_version();
    if ($err !== '') return ['ok' => false, 'message' => $err];
  }
  // Un seul processus à la fois : deux mises à jour simultanées casseraient
  // le site en plein milieu de la copie.
  $verrou = @fopen(MAJ_VERROU, 'c');
  if (!$verrou || !flock($verrou, LOCK_EX | LOCK_NB)) {
    if ($verrou) fclose($verrou);
    return ['ok' => false, 'message' => "Une mise à jour est déjà en cours. Réessayez dans un instant."];
  }
  try {
    [$code, $zip, $err] = maj_http($lien, true);
    if ($code !== 200 || strlen($zip) < 1000) {
      return ['ok' => false, 'message' => "Téléchargement de la version $version impossible (HTTP $code)" . ($err ? " : $err" : '') . '.'];
    }
    $tmp = $racine . '/data/maj-tmp';
    maj_rmdir($tmp);
    if (!@mkdir($tmp, 0775, true) && !is_dir($tmp)) {
      return ['ok' => false, 'message' => "Impossible de créer data/maj-tmp — donnez les droits d'écriture au dossier data (chmod 775)."];
    }
    $fichierZip = $tmp . '/pack.zip';
    if (@file_put_contents($fichierZip, $zip) === false) {
      return ['ok' => false, 'message' => "Impossible d'écrire l'archive téléchargée dans data/."];
    }
    $archive = new ZipArchive();
    if ($archive->open($fichierZip) !== true) {
      return ['ok' => false, 'message' => "L'archive téléchargée est illisible."];
    }
    $archive->extractTo($tmp . '/contenu');
    $archive->close();
    $contenu = $tmp . '/contenu';
    // Le zip peut contenir un dossier unique à sa racine : on descend dedans.
    $entrees = array_values(array_diff(scandir($contenu) ?: [], ['.', '..']));
    if (count($entrees) === 1 && is_dir($contenu . '/' . $entrees[0])) $contenu .= '/' . $entrees[0];
    if (!is_file($contenu . '/index.php') || !is_file($contenu . '/api.php')) {
      return ['ok' => false, 'message' => "L'archive ne ressemble pas au site (index.php introuvable) — mise à jour annulée, rien n'a été modifié."];
    }
    $journal = [];
    maj_copier($contenu, $racine, $racine, $journal);
    maj_rmdir($tmp);
    @file_put_contents(MAJ_VERSION_FICHIER, $version);
    $echecs = array_values(array_filter($journal, static fn($l) => strpos($l, 'ÉCHEC') === 0));
    if ($echecs) {
      return ['ok' => false, 'version' => $version, 'details' => $journal,
        'message' => count($echecs) . " fichier(s) n'ont pas pu être remplacés (droits d'écriture) : " . implode(', ', array_slice($echecs, 0, 3)) . '…'];
    }
    return ['ok' => true, 'version' => $version, 'details' => $journal,
      'message' => "Site mis à jour en $version (" . count($journal) . " fichier(s))."];
  } finally {
    flock($verrou, LOCK_UN);
    fclose($verrou);
    @unlink(MAJ_VERROU);
  }
}
