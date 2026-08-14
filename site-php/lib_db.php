<?php
declare(strict_types=1);

// 🗄️ Base de données (MySQL / MariaDB, ou SQLite).
//
// Sans base configurée, le site continue de fonctionner exactement comme
// avant, sur data/app.json. Dès qu'une base est renseignée dans
// ⚙️ Créateur → 🗄️ Base de données, elle devient la source de vérité :
// blacklist, preuves, tickets, messages, archives et journal y sont rangés
// dans de vraies tables, et le reste (thème, page d'accueil, bots…) dans
// une table clé/valeur.
//
// Les identifiants sont stockés dans data/db.php, préfixé d'une balise PHP
// « exit » : même demandé directement par le web, le fichier ne renvoie rien.

if (!defined('DB_STORE')) {
  define('DB_STORE', __DIR__ . '/data/db.php');
  define('DB_PREFIX', "<?php exit; ?>\n");
}

// ----- 💾 Identifiants -----
function db_config(): array {
  if (isset($GLOBALS['__db_config'])) return $GLOBALS['__db_config'];
  $c = ['type' => 'mysql', 'hote' => '', 'port' => 3306, 'base' => '', 'utilisateur' => '', 'motdepasse' => '', 'fichier' => ''];
  $brut = @file_get_contents(DB_STORE);
  if ($brut !== false && strpos($brut, DB_PREFIX) === 0) {
    $d = json_decode(substr($brut, strlen(DB_PREFIX)), true);
    if (is_array($d)) $c = array_merge($c, $d);
  }
  $GLOBALS['__db_config'] = $c;
  return $c;
}
function db_config_save(array $valeurs): bool {
  $c = array_merge(db_config(), $valeurs);
  $ok = @file_put_contents(DB_STORE, DB_PREFIX . json_encode($c)) !== false;
  if ($ok) { @chmod(DB_STORE, 0640); $GLOBALS['__db_config'] = $c; db_oublier(); }
  return $ok;
}
function db_effacer(): void { @unlink(DB_STORE); unset($GLOBALS['__db_config'], $GLOBALS['__db_pdo']); }
function db_oublier(): void { unset($GLOBALS['__db_pdo']); }

// Une base est-elle configurée ? (indépendant du fait qu'elle réponde)
function db_configuree(): bool {
  $c = db_config();
  return ($c['type'] === 'sqlite' && $c['fichier'] !== '')
      || ($c['type'] !== 'sqlite' && $c['hote'] !== '' && $c['base'] !== '');
}

// Chaîne PDO correspondant à la configuration.
function db_dsn(array $c): string {
  if ($c['type'] === 'sqlite') return 'sqlite:' . $c['fichier'];
  return sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
    $c['hote'], (int) ($c['port'] ?: 3306), $c['base']);
}

// Connexion partagée. Renvoie null si aucune base n'est configurée, lève une
// exception si la connexion échoue (l'appelant décide quoi en faire).
function db(bool $forcer = false): ?PDO {
  if (!$forcer && isset($GLOBALS['__db_pdo'])) return $GLOBALS['__db_pdo'];
  if (!db_configuree()) return null;
  $c = db_config();
  $pdo = new PDO(db_dsn($c), $c['utilisateur'] ?: null, $c['motdepasse'] ?: null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
    PDO::ATTR_TIMEOUT => 8,
  ]);
  if ($c['type'] === 'sqlite') $pdo->exec('PRAGMA foreign_keys = ON');
  $GLOBALS['__db_pdo'] = $pdo;
  return $pdo;
}

// La base est-elle réellement utilisable ? (aucune exception ne sort d'ici)
function db_active(): bool {
  if (!db_configuree()) return false;
  try { return db() !== null; } catch (Throwable $e) { return false; }
}

// ----- 🏗️ Création des tables -----
function db_init(PDO $pdo): void {
  $sqlite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
  // Différences de dialecte, réduites au strict nécessaire.
  $inc  = $sqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY';
  $txt  = $sqlite ? 'TEXT' : 'LONGTEXT';
  $fin  = $sqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
  $vc   = static fn(int $n) => $sqlite ? 'TEXT' : "VARCHAR($n)";

  $pdo->exec("CREATE TABLE IF NOT EXISTS kv (
    cle {$vc(64)} NOT NULL PRIMARY KEY,
    valeur $txt NULL
  )$fin");

  $pdo->exec("CREATE TABLE IF NOT EXISTS blacklist (
    id {$vc(40)} NOT NULL PRIMARY KEY,
    discord_id {$vc(25)} NULL,
    username {$vc(120)} NULL,
    reason $txt NULL,
    severity {$vc(20)} NULL,
    server {$vc(120)} NULL,
    author {$vc(120)} NULL,
    date_ajout {$vc(20)} NULL,
    portee {$vc(10)} NULL,
    bots $txt NULL,
    diffusion $txt NULL,
    origine {$vc(15)} NULL,
    preuve_discord $txt NULL,
    levee_discord INT NULL,
    ordre INT NULL
  )$fin");

  // Ajout des colonnes de portée sur une base déjà installée : CREATE TABLE
  // IF NOT EXISTS ne touche pas une table existante, il faut le faire à la main.
  foreach ([['portee', $vc(10)], ['bots', $txt], ['diffusion', $txt],
            ['origine', $vc(15)], ['preuve_discord', $txt], ['levee_discord', 'INT']] as [$col, $type]) {
    try { $pdo->exec("ALTER TABLE blacklist ADD COLUMN $col $type NULL"); }
    catch (Throwable $e) { /* colonne déjà là : rien à faire */ }
  }

  $pdo->exec("CREATE TABLE IF NOT EXISTS preuves (
    id $inc,
    blacklist_id {$vc(40)} NOT NULL,
    fichier {$vc(255)} NOT NULL,
    ordre INT NULL
  )$fin");

  $pdo->exec("CREATE TABLE IF NOT EXISTS tickets (
    id {$vc(40)} NOT NULL PRIMARY KEY,
    utilisateur {$vc(120)} NULL,
    sujet {$vc(255)} NULL,
    statut {$vc(30)} NULL,
    priorite {$vc(30)} NULL,
    server {$vc(120)} NULL,
    date_ouv {$vc(20)} NULL,
    archive INT NOT NULL DEFAULT 0,
    ferme_le {$vc(40)} NULL,
    ordre INT NULL
  )$fin");

  $pdo->exec("CREATE TABLE IF NOT EXISTS ticket_messages (
    id $inc,
    ticket_id {$vc(40)} NOT NULL,
    auteur {$vc(120)} NULL,
    staff INT NOT NULL DEFAULT 0,
    heure {$vc(30)} NULL,
    contenu $txt NULL,
    ordre INT NULL
  )$fin");

  $pdo->exec("CREATE TABLE IF NOT EXISTS activite (
    id $inc,
    type {$vc(40)} NULL,
    label {$vc(255)} NULL,
    detail $txt NULL,
    temps {$vc(40)} NULL,
    ordre INT NULL
  )$fin");

  // Index : sans eux, la recherche dans la blacklist ralentit vite.
  foreach ([
    ['idx_bl_discord', 'blacklist', 'discord_id'],
    ['idx_bl_user', 'blacklist', 'username'],
    ['idx_pr_bl', 'preuves', 'blacklist_id'],
    ['idx_tm_ticket', 'ticket_messages', 'ticket_id'],
  ] as [$nom, $table, $col]) {
    try {
      $pdo->exec($sqlite
        ? "CREATE INDEX IF NOT EXISTS $nom ON $table ($col)"
        : "CREATE INDEX $nom ON $table ($col)");
    } catch (Throwable $e) { /* déjà présent sous MySQL : sans importance */ }
  }
}

// ----- 📥 Lecture de l'état complet -----
// Renvoie exactement la même structure que data/app.json, pour que tout le
// reste du site (et du front) continue de fonctionner sans rien changer.
function db_charger(PDO $pdo): array {
  $etat = [];
  foreach ($pdo->query("SELECT cle, valeur FROM kv") as $r) {
    $d = json_decode((string) $r['valeur'], true);
    $etat[$r['cle']] = $d === null ? [] : $d;
  }

  // Preuves regroupées par sanction, en une seule requête.
  $preuves = [];
  foreach ($pdo->query("SELECT blacklist_id, fichier FROM preuves ORDER BY blacklist_id, ordre, id") as $r) {
    $preuves[$r['blacklist_id']][] = (string) $r['fichier'];
  }
  $etat['blacklist'] = [];
  foreach ($pdo->query("SELECT * FROM blacklist ORDER BY ordre, id") as $r) {
    $etat['blacklist'][] = [
      'id' => (string) $r['id'],
      'discordId' => (string) ($r['discord_id'] ?? ''),
      'username' => (string) ($r['username'] ?? ''),
      'reason' => (string) ($r['reason'] ?? ''),
      'severity' => (string) ($r['severity'] ?? 'moyenne'),
      'server' => (string) ($r['server'] ?? ''),
      'author' => (string) ($r['author'] ?? ''),
      'date' => (string) ($r['date_ajout'] ?? ''),
      'portee' => (string) ($r['portee'] ?? '') ?: 'global',
      'bots' => json_decode((string) ($r['bots'] ?? '[]'), true) ?: [],
      'diffusion' => json_decode((string) ($r['diffusion'] ?? '[]'), true) ?: [],
      'origine' => (string) ($r['origine'] ?? '') ?: 'site',
      'preuveDiscord' => (string) ($r['preuve_discord'] ?? ''),
      'leveeSurDiscord' => !empty($r['levee_discord']),
      'proofs' => $preuves[$r['id']] ?? [],
    ];
  }

  $messages = [];
  foreach ($pdo->query("SELECT * FROM ticket_messages ORDER BY ticket_id, ordre, id") as $r) {
    $messages[$r['ticket_id']][] = [
      'author' => (string) ($r['auteur'] ?? ''),
      'staff' => (bool) $r['staff'],
      'time' => (string) ($r['heure'] ?? ''),
      'content' => (string) ($r['contenu'] ?? ''),
    ];
  }
  $etat['tickets'] = [];
  $etat['archives'] = [];
  foreach ($pdo->query("SELECT * FROM tickets ORDER BY ordre, id") as $r) {
    $t = [
      'id' => (string) $r['id'],
      'user' => (string) ($r['utilisateur'] ?? ''),
      'subject' => (string) ($r['sujet'] ?? ''),
      'status' => (string) ($r['statut'] ?? ''),
      'priority' => (string) ($r['priorite'] ?? ''),
      'server' => (string) ($r['server'] ?? ''),
      'date' => (string) ($r['date_ouv'] ?? ''),
      'messages' => $messages[$r['id']] ?? [],
    ];
    if ((int) $r['archive'] === 1) {
      $t['closedAt'] = (string) ($r['ferme_le'] ?? '');
      $etat['archives'][] = $t;
    } else {
      $etat['tickets'][] = $t;
    }
  }

  $etat['activity'] = [];
  foreach ($pdo->query("SELECT * FROM activite ORDER BY ordre, id") as $r) {
    $etat['activity'][] = [
      'type' => (string) ($r['type'] ?? ''),
      'label' => (string) ($r['label'] ?? ''),
      'detail' => (string) ($r['detail'] ?? ''),
      'time' => (string) ($r['temps'] ?? ''),
    ];
  }

  // Valeurs par défaut pour les clés absentes.
  foreach (['bots', 'servers', 'siteConfig', 'serverSettings'] as $cle) {
    if (!isset($etat[$cle])) $etat[$cle] = [];
  }
  return $etat;
}

// ----- 📤 Écriture de l'état complet -----
// Réécriture transactionnelle : sur ces volumes (quelques centaines de
// lignes), c'est plus sûr qu'un calcul de différences, et une erreur en
// cours de route ne laisse jamais la base à moitié modifiée.
function db_sauver(PDO $pdo, array $etat): void {
  $pdo->beginTransaction();
  try {
    // Tout ce qui n'est pas une table dédiée part dans kv.
    $dedie = ['blacklist', 'tickets', 'archives', 'activity'];
    $ins = $pdo->prepare("DELETE FROM kv WHERE cle = ?");
    foreach ($etat as $cle => $valeur) {
      if (in_array($cle, $dedie, true)) continue;
      $ins->execute([$cle]);
      $q = $pdo->prepare("INSERT INTO kv (cle, valeur) VALUES (?, ?)");
      $q->execute([$cle, json_encode($valeur, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
    }

    $pdo->exec("DELETE FROM preuves");
    $pdo->exec("DELETE FROM blacklist");
    $qb = $pdo->prepare("INSERT INTO blacklist (id, discord_id, username, reason, severity, server, author, date_ajout, portee, bots, diffusion, origine, preuve_discord, levee_discord, ordre)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $qp = $pdo->prepare("INSERT INTO preuves (blacklist_id, fichier, ordre) VALUES (?, ?, ?)");
    $enJson = static fn($v) => json_encode(array_values((array) $v), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    foreach (array_values($etat['blacklist'] ?? []) as $i => $e) {
      if (!is_array($e) || ($e['id'] ?? '') === '') continue;
      $qb->execute([
        (string) $e['id'], (string) ($e['discordId'] ?? ''), (string) ($e['username'] ?? ''),
        (string) ($e['reason'] ?? ''), (string) ($e['severity'] ?? 'moyenne'),
        (string) ($e['server'] ?? ''), (string) ($e['author'] ?? ''), (string) ($e['date'] ?? ''),
        (string) ($e['portee'] ?? 'global'), $enJson($e['bots'] ?? []), $enJson($e['diffusion'] ?? []),
        (string) ($e['origine'] ?? 'site'), (string) ($e['preuveDiscord'] ?? ''), !empty($e['leveeSurDiscord']) ? 1 : 0, $i,
      ]);
      foreach (array_values((array) ($e['proofs'] ?? [])) as $j => $f) {
        $qp->execute([(string) $e['id'], (string) $f, $j]);
      }
    }

    $pdo->exec("DELETE FROM ticket_messages");
    $pdo->exec("DELETE FROM tickets");
    $qt = $pdo->prepare("INSERT INTO tickets (id, utilisateur, sujet, statut, priorite, server, date_ouv, archive, ferme_le, ordre)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $qm = $pdo->prepare("INSERT INTO ticket_messages (ticket_id, auteur, staff, heure, contenu, ordre) VALUES (?, ?, ?, ?, ?, ?)");
    $ecrireTicket = static function (array $t, int $i, int $archive) use ($qt, $qm) {
      if (($t['id'] ?? '') === '') return;
      $qt->execute([
        (string) $t['id'], (string) ($t['user'] ?? ''), (string) ($t['subject'] ?? ''),
        (string) ($t['status'] ?? ''), (string) ($t['priority'] ?? ''), (string) ($t['server'] ?? ''),
        (string) ($t['date'] ?? ''), $archive, (string) ($t['closedAt'] ?? ''), $i,
      ]);
      foreach (array_values((array) ($t['messages'] ?? [])) as $j => $m) {
        $qm->execute([
          (string) $t['id'], (string) ($m['author'] ?? ''), !empty($m['staff']) ? 1 : 0,
          (string) ($m['time'] ?? ''), (string) ($m['content'] ?? ''), $j,
        ]);
      }
    };
    foreach (array_values($etat['tickets'] ?? []) as $i => $t) if (is_array($t)) $ecrireTicket($t, $i, 0);
    foreach (array_values($etat['archives'] ?? []) as $i => $t) if (is_array($t)) $ecrireTicket($t, $i, 1);

    $pdo->exec("DELETE FROM activite");
    $qa = $pdo->prepare("INSERT INTO activite (type, label, detail, temps, ordre) VALUES (?, ?, ?, ?, ?)");
    foreach (array_values($etat['activity'] ?? []) as $i => $a) {
      if (!is_array($a)) continue;
      $qa->execute([(string) ($a['type'] ?? ''), (string) ($a['label'] ?? ''), (string) ($a['detail'] ?? ''), (string) ($a['time'] ?? ''), $i]);
    }

    $pdo->commit();
  } catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
  }
}

// La base contient-elle déjà quelque chose ? (sert à ne pas réimporter)
function db_vide(PDO $pdo): bool {
  foreach (['kv', 'blacklist', 'tickets'] as $t) {
    $n = (int) $pdo->query("SELECT COUNT(*) FROM $t")->fetchColumn();
    if ($n > 0) return false;
  }
  return true;
}

// Compte les lignes de chaque table, pour l'afficher dans le site.
function db_statistiques(PDO $pdo): array {
  $s = [];
  foreach (['blacklist', 'preuves', 'tickets', 'ticket_messages', 'activite', 'kv'] as $t) {
    try { $s[$t] = (int) $pdo->query("SELECT COUNT(*) FROM $t")->fetchColumn(); }
    catch (Throwable $e) { $s[$t] = 0; }
  }
  return $s;
}
