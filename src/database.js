const Database = require('better-sqlite3');
const path = require('path');

// En exécutable packagé (pkg), la base vit à côté de l'exécutable ;
// en mode Node classique, à la racine du projet. DATA_FILE permet de forcer un
// chemin, et BOT_DIR (agent hébergeur multi-bots) donne à chaque bot son
// propre dossier même quand plusieurs bots partagent le même exécutable.
const baseDir =
  process.env.BOT_DIR?.trim() || (process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..'));
const db = new Database(process.env.DATA_FILE || path.join(baseDir, 'data.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS guild_config (
  guild_id           TEXT PRIMARY KEY,
  staff_role_id      TEXT,
  admin_role_id      TEXT,
  service_role_id    TEXT,
  log_channel_id     TEXT,
  level_channel_id   TEXT,
  service_channel_id TEXT,
  staff_channel_id   TEXT,
  member_channel_id  TEXT,
  update_channel_id  TEXT,
  rp_enabled         INTEGER NOT NULL DEFAULT 0,
  rp_locked          INTEGER NOT NULL DEFAULT 0,
  -- 📊 Un seul systeme de niveaux, donc un seul gain : une minute passee en
  -- vocal vaut un message ecrit. Deux valeurs differentes revenaient a dire
  -- que le vocal compte moins, ce qui n'a plus de sens depuis la fusion.
  xp_text            INTEGER NOT NULL DEFAULT 20,
  xp_voice           INTEGER NOT NULL DEFAULT 20,
  xp_cooldown        INTEGER NOT NULL DEFAULT 60
);

CREATE TABLE IF NOT EXISTS identity_cards (
  card_id        TEXT PRIMARY KEY,
  guild_id       TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  rp_nom         TEXT NOT NULL,
  rp_prenom      TEXT NOT NULL,
  sexe           TEXT NOT NULL,
  lieu_naissance TEXT NOT NULL,
  date_naissance TEXT NOT NULL,
  pseudo_roblox  TEXT NOT NULL,
  pseudo_discord TEXT NOT NULL,
  nationalite    TEXT NOT NULL,
  background     TEXT,
  photo_url      TEXT,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  UNIQUE (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS permits (
  permit_number TEXT PRIMARY KEY,
  guild_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  valid         INTEGER NOT NULL DEFAULT 1,
  points        INTEGER NOT NULL DEFAULT 12,
  issued_at     TEXT NOT NULL,
  issued_by     TEXT NOT NULL,
  UNIQUE (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS enterprises (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  name            TEXT NOT NULL COLLATE NOCASE,
  description     TEXT,
  media_url       TEXT,
  insurance       INTEGER NOT NULL DEFAULT 0,
  insurance_types TEXT NOT NULL DEFAULT '[]',
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE (guild_id, name)
);

CREATE TABLE IF NOT EXISTS enterprise_heads (
  enterprise_id INTEGER NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  PRIMARY KEY (enterprise_id, user_id)
);

CREATE TABLE IF NOT EXISTS enterprise_employees (
  enterprise_id INTEGER NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  PRIMARY KEY (enterprise_id, user_id)
);

CREATE TABLE IF NOT EXISTS insured_vehicles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  enterprise_id INTEGER NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  owner_id      TEXT NOT NULL,
  vehicle       TEXT NOT NULL,
  plate         TEXT,
  assigned_by   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS levels (
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  text_xp     INTEGER NOT NULL DEFAULT 0,
  voice_xp    INTEGER NOT NULL DEFAULT 0,
  text_level  INTEGER NOT NULL DEFAULT 0,
  voice_level INTEGER NOT NULL DEFAULT 0,
  xp          INTEGER NOT NULL DEFAULT 0,
  level       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS services (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at   TEXT
);

CREATE TABLE IF NOT EXISTS staff_presence (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  type     TEXT NOT NULL,
  note     TEXT,
  at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS whitelist_managers (
  guild_id        TEXT NOT NULL,
  role_id         TEXT NOT NULL,
  manager_role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, role_id, manager_role_id)
);

CREATE TABLE IF NOT EXISTS whitelist_entries (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  role_id  TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id, role_id)
);

CREATE TABLE IF NOT EXISTS global_bans (
  user_id   TEXT PRIMARY KEY,
  reason    TEXT,
  banned_by TEXT NOT NULL,
  banned_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interactions (
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  action TEXT NOT NULL,
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_a, user_b, action)
);

CREATE TABLE IF NOT EXISTS interaction_stats (
  user_id TEXT NOT NULL,
  action  TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, action)
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id   TEXT NOT NULL,
  action    TEXT NOT NULL,
  level     INTEGER NOT NULL,
  earned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, action, level)
);

CREATE TABLE IF NOT EXISTS ticket_types (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  label           TEXT NOT NULL,
  emoji           TEXT,
  category_id     TEXT,
  support_role_id TEXT,
  UNIQUE (guild_id, label)
);

CREATE TABLE IF NOT EXISTS tickets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  type_id    INTEGER,
  channel_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ouvert',
  opened_at  TEXT NOT NULL,
  closed_at  TEXT,
  closed_by  TEXT
);

-- 📋 Presets de tickets : réponses toutes prêtes, écrites par le staff, que
-- le bot envoie dans un ticket depuis une liste déroulante.
CREATE TABLE IF NOT EXISTS ticket_presets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  label       TEXT NOT NULL,
  emoji       TEXT,
  description TEXT,
  content     TEXT,
  embed_title TEXT,
  embed_text  TEXT,
  embed_color TEXT,
  created_by  TEXT,
  created_at  TEXT
);

CREATE TABLE IF NOT EXISTS ticket_panels (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  options    TEXT NOT NULL DEFAULT '{}',
  webhook_id TEXT,
  webhook_token TEXT
);

CREATE TABLE IF NOT EXISTS webhook_profiles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  avatar_url TEXT
);

CREATE TABLE IF NOT EXISTS app_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS blacklist (
  user_id TEXT PRIMARY KEY,
  reason  TEXT,
  by_id   TEXT NOT NULL,
  at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_staff (
  user_id  TEXT PRIMARY KEY,
  rank     TEXT NOT NULL,
  perms    TEXT NOT NULL DEFAULT '[]',
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blacklist_history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT NOT NULL,
  tag       TEXT,
  action    TEXT NOT NULL,
  reason    TEXT,
  proof     TEXT,
  by_id     TEXT NOT NULL,
  guild_id  TEXT,
  at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proof_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  message_id  TEXT NOT NULL UNIQUE,
  author_id   TEXT NOT NULL,
  author_tag  TEXT,
  content     TEXT,
  attachments TEXT,
  at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,
  guild_id    TEXT NOT NULL,
  guild_name  TEXT,
  target_id   TEXT NOT NULL,
  target_tag  TEXT,
  reporter_id TEXT,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'ouvert',
  claimed_by  TEXT,
  channel_id  TEXT,
  message_id  TEXT,
  resolution  TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS social_feeds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  platform   TEXT NOT NULL,
  handle     TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message    TEXT,
  meta       TEXT,
  last_item  TEXT,
  UNIQUE (guild_id, platform, handle)
);

CREATE TABLE IF NOT EXISTS scam_images (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name     TEXT,
  sha256   TEXT NOT NULL,
  dhash    TEXT,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS warn_rp (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  delta    INTEGER NOT NULL,
  reason   TEXT,
  by_id    TEXT NOT NULL,
  at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blacklist_rp (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  roblox_name TEXT,
  discord_tag TEXT,
  reason      TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  by_id       TEXT NOT NULL,
  at          TEXT NOT NULL,
  removed_by  TEXT,
  removed_at  TEXT
);

CREATE TABLE IF NOT EXISTS whitelist_rp (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  roblox_name TEXT,
  discord_tag TEXT,
  reason      TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  by_id       TEXT NOT NULL,
  at          TEXT NOT NULL,
  removed_by  TEXT,
  removed_at  TEXT
);

CREATE TABLE IF NOT EXISTS rp_boards (
  guild_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, kind)
);

CREATE TABLE IF NOT EXISTS deleted_messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL,
  channel_id     TEXT NOT NULL,
  author_id      TEXT,
  author_tag     TEXT,
  kind           TEXT NOT NULL,
  content        TEXT,
  before_content TEXT,
  attachments    TEXT,
  at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gacha_characters (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  image_url TEXT,
  added_by  TEXT,
  added_at  TEXT
);

CREATE TABLE IF NOT EXISTS gacha_owned (
  guild_id     TEXT NOT NULL,
  character_id INTEGER NOT NULL,
  user_id      TEXT NOT NULL,
  at           TEXT NOT NULL,
  PRIMARY KEY (guild_id, character_id)
);

CREATE TABLE IF NOT EXISTS sao_players (
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  floor      INTEGER NOT NULL DEFAULT 1,
  level      INTEGER NOT NULL DEFAULT 1,
  xp         INTEGER NOT NULL DEFAULT 0,
  hp         INTEGER NOT NULL DEFAULT 150,
  col        INTEGER NOT NULL DEFAULT 0,
  weapon     INTEGER NOT NULL DEFAULT 0,
  title      TEXT,
  last_hunt  TEXT,
  last_afk   TEXT,
  created_at TEXT,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS sao_badges (
  guild_id  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  badge     TEXT NOT NULL,
  earned_at TEXT,
  PRIMARY KEY (guild_id, user_id, badge)
);

CREATE TABLE IF NOT EXISTS criminal_records (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  offense  TEXT NOT NULL,
  sanction TEXT,
  note     TEXT,
  by_id    TEXT NOT NULL,
  at       TEXT NOT NULL
);

-- 📝 Messages composés avec /embed : on garde le TEXTE SOURCE, celui qui a été
-- tapé, pas le rendu. Un rendu ne se remonte pas : « ➜ » peut avoir été écrit
-- à la main ou produit par « &> », et le filet tracé par la carte n'existe
-- plus comme texte. Sans la source, /embed modifier repartirait d'une
-- approximation et abîmerait le message à chaque passage.
CREATE TABLE IF NOT EXISTS composed_messages (
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  author_id  TEXT,
  state      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  PRIMARY KEY (channel_id, message_id)
);

-- 🎞️ Reserve de GIF deja vus, par categorie.
-- Les API publiques d'anime tombent souvent : quand les trois refusent, on
-- ressert une image deja obtenue plutot que d'afficher « GIF indisponible ».
CREATE TABLE IF NOT EXISTS gif_cache (
  categorie TEXT NOT NULL,
  url       TEXT NOT NULL,
  anime     TEXT,
  at        TEXT,
  PRIMARY KEY (categorie, url)
);

-- 🔢 Salon de comptage : l'etat du compte, UN par serveur (le salon regle
-- dans comptage_channel_id). Il vit en base pour survivre au redemarrage.
-- channel_id dit pour quel salon l'etat vaut : un salon change (depuis
-- /config ou le site) remet le compte a zero, record conserve.
-- dernier_message_id : le dernier nombre VALIDE, surveille par l'anti-triche
-- (supprime ou modifie -> le bot republie le bon nombre).
-- dernier_fautif : celui qui porte le role d'erreur (retire au suivant).
-- record_depart : le record tel qu'il etait au DEBUT de la serie en cours —
-- le depasser vaut la reaction du record, une seule fois par serie.
CREATE TABLE IF NOT EXISTS comptage (
  guild_id           TEXT PRIMARY KEY,
  channel_id         TEXT,
  courant            INTEGER NOT NULL DEFAULT 0,
  dernier_user       TEXT,
  dernier_message_id TEXT,
  record             INTEGER NOT NULL DEFAULT 0,
  record_le          TEXT,
  record_depart      INTEGER NOT NULL DEFAULT 0,
  erreurs            INTEGER NOT NULL DEFAULT 0,
  dernier_fautif     TEXT,
  maj_le             TEXT
);

-- 🔢 Classement du comptage : bons nombres et series cassees, par membre.
CREATE TABLE IF NOT EXISTS comptage_stats (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  justes   INTEGER NOT NULL DEFAULT 0,
  erreurs  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_comptage_stats_rang ON comptage_stats (guild_id, justes);

-- 💌 Confessions anonymes (/confession). L'auteur n'est JAMAIS affiche sur
-- le serveur : il n'apparait qu'au staff du bot, sur la carte d'une
-- confession signalee (suicide, menace, insulte). statut : publiee |
-- en_revue | refusee. numero : rang de publication sur le serveur.
CREATE TABLE IF NOT EXISTS confessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  guild_name    TEXT,
  channel_id    TEXT NOT NULL,
  author_id     TEXT NOT NULL,
  author_tag    TEXT,
  texte         TEXT NOT NULL,
  categories    TEXT,
  statut        TEXT NOT NULL,
  numero        INTEGER,
  message_id    TEXT,
  qg_channel_id TEXT,
  qg_message_id TEXT,
  decide_par    TEXT,
  decide_le     TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_confessions_guild ON confessions (guild_id, numero);

-- 💍 Mariages (/mariage) : un seul couple par personne, partout ou le bot
-- est present (comme les compteurs de /interact). a < b toujours.
CREATE TABLE IF NOT EXISTS mariages (
  a        TEXT NOT NULL,
  b        TEXT NOT NULL,
  depuis   TEXT NOT NULL,
  guild_id TEXT,
  PRIMARY KEY (a, b)
);

-- 💞 Vie de couple (avantages du mariage, utils/couple.js). Meme cle que
-- mariages (a < b) : tout s'efface au divorce. Les jours sont ceux de Paris
-- (AAAA-MM-JJ). flamme = serie de jours ou LES DEUX ont fait leur bisou,
-- flamme_jour = dernier de ces jours ; un jour manque eteint la flamme,
-- record la garde en memoire.
CREATE TABLE IF NOT EXISTS mariage_flammes (
  a           TEXT NOT NULL,
  b           TEXT NOT NULL,
  bisou_a     TEXT,
  bisou_b     TEXT,
  flamme      INTEGER NOT NULL DEFAULT 0,
  flamme_jour TEXT,
  record      INTEGER NOT NULL DEFAULT 0,
  jours       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (a, b)
);

-- 💌 Mot doux : un seul par destinataire, le nouveau remplace l'ancien.
CREATE TABLE IF NOT EXISTS mariage_mots_doux (
  a     TEXT NOT NULL,
  b     TEXT NOT NULL,
  pour  TEXT NOT NULL,
  texte TEXT NOT NULL,
  at    TEXT NOT NULL,
  lu    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (a, b, pour)
);

-- 🎂 Mensiversaires deja annonces : une seule annonce par serveur et par date.
CREATE TABLE IF NOT EXISTS mariage_annonces (
  guild_id TEXT NOT NULL,
  a        TEXT NOT NULL,
  b        TEXT NOT NULL,
  jour     TEXT NOT NULL,
  PRIMARY KEY (guild_id, a, b, jour)
);

-- 🔢 Matricules RP : le numero qui suit une personne dans le RP.
-- Relie les trois facons de la designer — matricule, pseudo du jeu, compte
-- Discord — pour qu'aucune ne soit un cul-de-sac. Le retrait garde la ligne
-- (active = 0) : l'historique dit qui portait tel numero avant.
CREATE TABLE IF NOT EXISTS matricules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  matricule    TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  roblox_name  TEXT,
  discord_tag  TEXT,
  note         TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  by_id        TEXT,
  at           TEXT,
  removed_by   TEXT,
  removed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_matricules_guild ON matricules (guild_id, active);

-- 🏅 Recompenses de niveau : un role donne en atteignant un palier.
-- Aucune ligne par defaut — un serveur qui n'en veut pas n'en a aucune, et
-- le bot ne distribue donc rien de lui-meme.
CREATE TABLE IF NOT EXISTS level_rewards (
  guild_id   TEXT NOT NULL,
  level      INTEGER NOT NULL,
  role_id    TEXT NOT NULL,
  created_at TEXT,
  PRIMARY KEY (guild_id, level)
);

-- 🎭 Rôles au clic / à la réaction posés sur un message composé.
-- La colonne mode vaut 'bouton' ou 'reaction' ; emoji ne sert qu'au second.
CREATE TABLE IF NOT EXISTS role_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  role_id    TEXT NOT NULL,
  mode       TEXT NOT NULL,
  emoji      TEXT,
  label      TEXT,
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_role_actions_msg ON role_actions (message_id);

CREATE TABLE IF NOT EXISTS absences (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  debut    INTEGER NOT NULL,
  fin      INTEGER,
  raison   TEXT,
  at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_absences_fin ON absences (fin);

CREATE TABLE IF NOT EXISTS absence_messages (
  absence_id INTEGER NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_absence_messages_msg ON absence_messages (message_id);

CREATE TABLE IF NOT EXISTS attentes_vocales (
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  arrivee    INTEGER NOT NULL,
  claim_par  TEXT,
  claim_a    INTEGER,
  clos_a     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_attentes_user ON attentes_vocales (guild_id, user_id);

CREATE TABLE IF NOT EXISTS salons_perso (
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS absence_channels (
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, channel_id)
);
`);

// Migration : ajoute les colonnes manquantes aux bases créées avant leur
// introduction (CREATE TABLE IF NOT EXISTS ne modifie pas une table existante).
for (const column of [
  'member_channel_id TEXT',
  'welcome_message TEXT',
  'goodbye_message TEXT',
  'welcome_mention INTEGER',
  'rp_enabled INTEGER',
  'rp_locked INTEGER',
  'update_channel_id TEXT',
  'staff_role_ids TEXT',
  'admin_role_ids TEXT',
  'proof_channel_id TEXT',
  'antispam_enabled INTEGER',
  'antispam_exempt_channels TEXT',
  'antispam_exempt_categories TEXT',
  'antispam_exempt_filtre INTEGER',
  'antinuke_enabled INTEGER',
  'captcha_enabled INTEGER',
  'verified_role_id TEXT',
  'captcha_channel_id TEXT',
  'captcha_role_remove TEXT',
  'captcha_max_essais INTEGER',
  'captcha_kick INTEGER',
  'partner_channel_id TEXT',
  // 🔢 Salon de comptage (vide = désactivé) et ses règles. NULL = défaut :
  // lire avec `?? défaut` (voir reglagesComptage dans utils/comptage.js).
  'comptage_channel_id TEXT',
  'comptage_meme_personne INTEGER',     // 1 = on peut compter deux fois de suite
  'comptage_maths INTEGER',             // 1 = « 2*3 » compte pour 6
  'comptage_reactions INTEGER',         // 1 = ✅ / 💯 / 🏆 / ❌ (défaut)
  'comptage_supprimer INTEGER',         // 1 = les messages hors-jeu sont effacés
  'comptage_role_erreur TEXT',          // rôle donné à celui qui casse la série
  'comptage_xp INTEGER',                // XP par bon nombre (0 = aucune, défaut)
  'level_image_url TEXT',
  'goodbye_channel_id TEXT',
  'patch_channel_id TEXT',
  'patch_mention TEXT',                 // qui mentionner : vide = personne (défaut), 'everyone', 'here', ou un id de rôle
  'interact_enabled INTEGER',
  'sao_enabled INTEGER',
  'police_role_ids TEXT',
  'wlrp_role_id TEXT',
  'ticket_transcript_channel_id TEXT',
  'levels_enabled INTEGER', // NULL = activé (comportement historique)
  // 🏅 Récompenses de niveau : les rôles s'ajoutent (1, défaut) ou le palier
  // atteint REMPLACE le précédent (0, une seule couleur à la fois).
  'level_rewards_stack INTEGER',
  // 🎮 Jeu du serveur : change le vocabulaire du Module RP (carte d'identité,
  // permis, entreprise). NULL = roblox, le jeu d'origine du bot.
  'rp_jeu TEXT',
  // 🌍 Langue du bot sur ce serveur : fr (source), en, de, ru, es.
  'bot_langue TEXT',
  'vocal_alerte_channel_id TEXT',
  'vocal_attente_channel_id TEXT',
  'vocal_assistance_ids TEXT',
  'bump_channel_id TEXT',               // rappel de bump : le salon du rappel
  'bump_role_id TEXT',                  // rôle mentionné par le rappel (sonne)
  'bump_dernier INTEGER',               // dernier bump DISBOARD vu (ms)
  'vocal_perso_createur_id TEXT',
  // 🎭 Rôles automatiques à l'arrivée (liste JSON d'identifiants de rôles)
  'autorole_role_ids TEXT',
  // 🤖 Rôles automatiques des BOTS à leur arrivée (liste JSON)
  'autorole_bot_role_ids TEXT',
  // 🎵 Salons où les commandes musique sont AUTORISÉES (liste JSON, vide = partout)
  'musique_channel_ids TEXT',
  // 🎛️ Salon de la carte « en cours de lecture » (vide = salon de la commande)
  'musique_annonce_channel_id TEXT',
  // 👋 Apparence des messages d'arrivée / de départ, réglée depuis le site
  'welcome_color TEXT',        // couleur de la barre de l'embed (#RRGGBB)
  'welcome_image TEXT',        // grande image de fond de l'embed
  'welcome_avatar TEXT',       // 'rond' | 'grand' | 'aucun' — cadre de la photo
  'welcome_title TEXT',        // titre de l'embed
  // 🎨 Identité visuelle appliquée à TOUS les embeds du bot
  'embed_style INTEGER',                // 1 = identité active (défaut)
  'embed_accent TEXT',                  // couleur d'accent (#RRGGBB)
  'embed_footer INTEGER',               // 1 = pied de page « bot • serveur »
  'embed_author INTEGER',               // 1 = ligne d'auteur avec l'icône du serveur
  'embed_ligne INTEGER',                // 1 = filet sous le titre
  'embed_filet_taille INTEGER',         // longueur du filet (6 à 30, défaut 16)
  'embed_fusion INTEGER',               // 1 = champs refondus en sections, par défaut
  'embed_cartes INTEGER',               // 1 = cartes sans bordure au lieu d'embeds (défaut)
  'embed_bordure TEXT',                 // 'aucune' (défaut) | 'accent' : la barre colorée de gauche
  'embed_titre TEXT',                   // 'grand' (défaut, # ) | 'moyen' (##) : taille du titre de carte
  'embed_banniere TEXT',                // bannière large en bas de chaque embed
  'embed_timestamp INTEGER',            // 1 = horodatage automatique
  'embed_force_color INTEGER',          // 1 = couleur unique, 0 = couleurs par type
  'welcome_style TEXT',                 // 'classique' | 'detaille'
  'welcome_rules_channel_id TEXT',      // salon règlement cité dans l'accueil
  'welcome_help_channel_id TEXT',       // salon d'aide / tickets cité dans l'accueil
  'welcome_banner INTEGER',             // 1 = bannière image générée par le bot
  'welcome_banner_color TEXT',          // fond de la bannière (#RRGGBB)
  'welcome_fields INTEGER',    // 1 = afficher les champs (nom, ID, n°, création)
  'goodbye_color TEXT',
  'goodbye_image TEXT',
  'goodbye_avatar TEXT',
  'goodbye_title TEXT',
  'goodbye_fields INTEGER',
  // 🪪 Identité du bot PAR SERVEUR : pseudo, photo de membre, profil choisi
  'bot_nick TEXT',
  'bot_avatar_url TEXT',
  'bot_profil TEXT',
  // 💌 Confessions anonymes : interrupteur et salon de publication
  'confession_enabled INTEGER',
  'confession_channel_id TEXT',
  // 💍 Avantages du mariage (utils/couple.js) — NULL = valeur par défaut
  'mariage_avantages INTEGER',
  'mariage_bonus_xp INTEGER',
  'mariage_lune_de_miel_jours INTEGER',
  'mariage_bisou_xp INTEGER',
  'mariage_actif_minutes INTEGER',
  'mariage_salon_id TEXT',
  // 📈 XP & niveaux : gains, anti-AFK, multiplicateurs, courbe, annonces.
  // NULL partout = le comportement d'avant (lire avec `cfg.x ?? défaut`).
  'xp_text_min INTEGER',                // XP texte aléatoire : borne basse (NULL = xp_text)
  'xp_text_max INTEGER',                // … borne haute (NULL = xp_text)
  'xp_longueur_min INTEGER',            // signes minimum d'un message pour gagner (0)
  'xp_vocal_seul INTEGER',              // 1 = XP même seul humain dans le salon (0)
  'xp_vocal_muet INTEGER',              // 1 = XP même muet ou sourd (0)
  'xp_mult_cumul INTEGER',              // 1 = multiplicateurs de rôles cumulés, 0 = le plus haut rôle
  'xp_mult_global INTEGER',             // multiplicateur global en % (100)
  'xp_boost_pourcent INTEGER',          // bonus temporaire en % (0)
  'xp_boost_fin TEXT',                  // fin du bonus temporaire (ISO, vide = sans fin)
  'xp_weekend_pourcent INTEGER',        // bonus du samedi et du dimanche, heure de Paris (0)
  'xp_sao_pourcent INTEGER',            // part de l'XP SAO versée au niveau du serveur (100)
  'xp_courbe TEXT',                     // 'mee6' (défaut) | 'douce' | 'raide' | 'lineaire'
  'xp_niveau_max INTEGER',              // niveau maximum (0 = aucun)
  'level_annonce TEXT',                 // 'salon' | 'ici' | 'mp' | 'off' (NULL = salon s'il existe)
  'level_message TEXT',                 // modèle de l'annonce, avec balises et variables
  'level_annonce_pas INTEGER',          // n'annoncer que tous les N niveaux (1)
  'level_mention INTEGER',              // 1 = l'annonce mentionne le membre (1)
  'level_reset_depart INTEGER',         // 1 = effacer l'XP d'un membre qui quitte (0)
  // 🎲 Mini-jeux (/jeu) : interrupteur, jeux coupés un par un (liste de clés
  // séparées par des virgules), récompenses d'une victoire et plafond du jour.
  'jeux_enabled INTEGER',
  'jeux_desactives TEXT',
  'jeux_xp_victoire INTEGER',
  'jeux_xp_bot INTEGER',
  'jeux_xp_plafond INTEGER',
  'jeux_col_victoire INTEGER',
  // ⚔️ Aventure SAO : raids, PvP, rythme, AFK, mort et difficulté
  'sao_salon_id TEXT',
  'sao_raid_heures INTEGER',
  'sao_pvp INTEGER',
  'sao_chasse_delai INTEGER',
  'sao_afk INTEGER',
  'sao_afk_heures INTEGER',
  'sao_mort_penalite INTEGER',
  'sao_difficulte TEXT',
]) {
  try {
    db.exec(`ALTER TABLE guild_config ADD COLUMN ${column}`);
  } catch {}
}

// Assurance véhicule : couleur, photo, statut police (recherché / fourrière)
// et dates de validité (validation → expiration).
// Types de contrat : ins_type (Véhicule/Maison/Entreprise/Santé — NULL = ancien
// contrat véhicule), building/unit_label (Maison), target_ent (Entreprise).
for (const column of [
  'color TEXT',
  'media_url TEXT',
  'wanted INTEGER NOT NULL DEFAULT 0',
  'impounded INTEGER NOT NULL DEFAULT 0',
  'valid_from TEXT',
  'valid_until TEXT',
  'ins_type TEXT',
  'building TEXT',
  'unit_label TEXT',
  'target_ent TEXT',
]) {
  try {
    db.exec(`ALTER TABLE insured_vehicles ADD COLUMN ${column}`);
  } catch {}
}

// Tickets du QG : preuve fournie à la blacklist.
try {
  db.exec('ALTER TABLE bot_tickets ADD COLUMN proof TEXT');
} catch {}

// 🎫 Prise en charge d'un ticket : quel membre du staff s'en occupe, et depuis
// quand. Vide = personne ne l'a encore pris.
for (const colonne of ['claimed_by TEXT', 'claimed_at TEXT']) {
  try {
    db.exec(`ALTER TABLE tickets ADD COLUMN ${colonne}`);
  } catch {}
}

// 🗑️ /interact preference n'existe plus (v2.0.219) : la table qui gardait le
// type de GIF choisi par chaque membre est supprimée des bases existantes —
// c'était une donnée déclarée par membre, elle ne doit pas traîner sans
// qu'aucune commande ne permette de l'effacer.
try {
  db.exec('DROP TABLE IF EXISTS interact_prefs');
} catch (err) {
  console.warn(`⚠️ Table interact_prefs non supprimée : ${err.message}`);
}

// 🎧 Clôture d'une attente vocale : la carte finale reste affichée un court
// instant, puis le ticket est supprimé — clos_a date la clôture.
try {
  db.exec('ALTER TABLE attentes_vocales ADD COLUMN clos_a INTEGER');
} catch {}

// 📊 Le vocal rapporte autant que l'écrit.
//
// La fusion des niveaux a laissé un reste : le gain vocal était resté à la
// moitié du gain écrit (10 contre 20). Un seul système de niveaux et deux
// barèmes, cela revenait à dire qu'une heure de vocal vaut moins qu'une
// heure de discussion — ce que la fusion avait précisément arrêté de dire.
//
// La reprise n'a lieu qu'UNE fois, et seulement pour les serveurs restés sur
// l'ancien défaut : un serveur qui a délibérément choisi ses valeurs les
// garde.
{
  try {
    const fait = db.prepare("SELECT value FROM app_state WHERE key = 'xp_vocal_aligne'").get();
    if (!fait) {
      const r = db.prepare('UPDATE guild_config SET xp_voice = xp_text WHERE xp_voice = 10 AND xp_text = 20').run();
      db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('xp_vocal_aligne', '1')").run();
      if (r.changes) console.log(`📊 XP vocal aligné sur l'écrit pour ${r.changes} serveur(s).`);
    }
  } catch (err) {
    console.warn(`⚠️ Alignement de l'XP vocal impossible (${err.message}).`);
  }
}

// 📊 Niveaux fusionnés : un seul compteur d'XP au lieu d'un écrit et d'un
// vocal séparés. Les colonnes text_xp / voice_xp sont conservées (elles
// disent d'où vient l'XP), mais le niveau se calcule sur le total.
// La reprise n'a lieu qu'UNE fois : dès que la colonne existe, on n'y touche
// plus — sinon chaque redémarrage écraserait l'XP gagnée depuis.
{
  let nouvelleColonne = false;
  for (const column of ['xp INTEGER NOT NULL DEFAULT 0', 'level INTEGER NOT NULL DEFAULT 0']) {
    try {
      db.exec(`ALTER TABLE levels ADD COLUMN ${column}`);
      nouvelleColonne = true;
    } catch {}
  }
  if (nouvelleColonne) {
    try {
      // Le total des deux compteurs devient l'XP unique.
      //
      // Le niveau qui en découle n'est PAS calculé ici : la courbe vit dans
      // src/utils/levels.js, et elle est réglable par serveur. Une deuxième
      // copie de la formule finirait par diverger de la vraie. On laisse donc
      // une consigne, que levels.js exécute à son chargement — avec la courbe
      // de chaque serveur.
      db.exec('UPDATE levels SET xp = COALESCE(text_xp, 0) + COALESCE(voice_xp, 0)');
      db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('xp_niveaux_a_recalculer', '1')").run();
      const n = db.prepare('SELECT COUNT(*) AS n FROM levels').get().n;
      if (n) console.log(`📊 Niveaux fusionnés : ${n} membre(s) repris (écrit + vocal → un seul niveau).`);
    } catch (err) {
      console.warn(`⚠️ Fusion des niveaux : reprise impossible (${err.message}).`);
    }
  }
}

// 📈 XP & niveaux, deuxième génération.
//
//  • xp_exclusions : salons (catégories et fils compris) et rôles qui ne
//    rapportent rien — partout, ou seulement à l'écrit, ou seulement en vocal.
//  • xp_multiplicateurs : un rôle ou un salon qui rapporte plus (ou moins).
//    100 = normal, 150 = ×1,5, 0 = rien du tout.
//  • niveau_recompenses : PLUSIEURS récompenses par niveau, de plusieurs
//    sortes (rôle donné ou retiré, Col et objets SAO, message privé).
//  • niveau_recompenses_recues : le registre de ce qui a déjà été versé.
//    Sans lui, l'argent et les objets seraient redonnés à chaque montée de
//    niveau — le rattrapage rejoue TOUS les paliers atteints.
db.exec(`
CREATE TABLE IF NOT EXISTS xp_exclusions (
  guild_id TEXT NOT NULL,
  type     TEXT NOT NULL,
  cible_id TEXT NOT NULL,
  portee   TEXT NOT NULL DEFAULT 'tout',
  PRIMARY KEY (guild_id, type, cible_id)
);
CREATE TABLE IF NOT EXISTS xp_multiplicateurs (
  guild_id TEXT NOT NULL,
  type     TEXT NOT NULL,
  cible_id TEXT NOT NULL,
  pourcent INTEGER NOT NULL,
  PRIMARY KEY (guild_id, type, cible_id)
);
CREATE TABLE IF NOT EXISTS niveau_recompenses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  niveau     INTEGER NOT NULL,
  type       TEXT NOT NULL,
  valeur     TEXT,
  quantite   INTEGER NOT NULL DEFAULT 1,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_niveau_recompenses ON niveau_recompenses (guild_id, niveau);
CREATE TABLE IF NOT EXISTS niveau_recompenses_recues (
  guild_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  recompense_id INTEGER NOT NULL,
  at            TEXT,
  PRIMARY KEY (guild_id, user_id, recompense_id)
);
CREATE INDEX IF NOT EXISTS idx_levels_classement ON levels (guild_id, xp DESC);
`);

// 🚪 Membre parti : il reste dans la table (son XP n'est pas perdue s'il
// revient), mais le classement ne le montre plus.
try {
  db.exec('ALTER TABLE levels ADD COLUMN parti INTEGER NOT NULL DEFAULT 0');
} catch {}

// 🏅 Reprise UNIQUE des anciennes récompenses (un rôle par niveau) dans la
// nouvelle table. L'ancienne table reste en place : une migration ne
// supprime jamais.
{
  try {
    const fait = db.prepare("SELECT value FROM app_state WHERE key = 'niveau_recompenses_v2'").get();
    if (!fait) {
      let reprises = 0;
      db.transaction(() => {
        reprises = db.prepare(
          `INSERT INTO niveau_recompenses (guild_id, niveau, type, valeur, quantite, created_at)
           SELECT guild_id, level, 'role', role_id, 1, COALESCE(created_at, ?) FROM level_rewards ORDER BY guild_id, level`
        ).run(new Date().toISOString()).changes;
        db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('niveau_recompenses_v2', '1')").run();
      })();
      if (reprises) console.log(`🏅 ${reprises} récompense(s) de niveau reprise(s) dans le nouveau format.`);
    }
  } catch (err) {
    console.warn(`⚠️ Reprise des récompenses de niveau impossible (${err.message}).`);
  }
}

// Types de tickets : description (option du sélecteur de raison),
// ping_role_id (rôle mentionné à l'ouverture, sinon le support),
// support_role_ids (plusieurs rôles support par type, JSON) et enabled
// (raison bloquée = 0 : plus ouvrable tant qu'elle n'est pas réactivée).
for (const column of ['description TEXT', 'ping_role_id TEXT', 'support_role_ids TEXT', 'enabled INTEGER NOT NULL DEFAULT 1']) {
  try {
    db.exec(`ALTER TABLE ticket_types ADD COLUMN ${column}`);
  } catch {}
}

// Panneaux de tickets : webhook utilisé pour l'envoi sous un profil personnalisé.
for (const column of ['webhook_id TEXT', 'webhook_token TEXT']) {
  try {
    db.exec(`ALTER TABLE ticket_panels ADD COLUMN ${column}`);
  } catch {}
}

// ----- 🌐 Identité RP globale -----
// Les cartes d'identité, permis, entreprises (patrons/employés) et assurances
// sont PARTAGÉS sur tous les serveurs : ils utilisent tous la même portée
// « GLOBAL » comme guild_id, si bien qu'une fiche est identique partout et
// suit la personne sur chaque serveur où le bot est présent. Le reste (niveaux,
// service, whitelist métier, salons, rôles) reste propre à chaque serveur.
const RP_SCOPE = 'GLOBAL';

// Migration unique : rapatrie les données existantes (créées par serveur) vers
// la portée globale, en évitant les doublons (on garde la plus ancienne par
// personne / par nom d'entreprise).
// ⚠️ Une migration ne SUPPRIME jamais : la première version effaçait les
// doublons (même personne sur deux serveurs, même nom d'entreprise), et ces
// fiches étaient perdues pour de bon — c'est ce qui a été vécu comme des
// « anomalies de pertes de données ». Les perdants de la déduplication sont
// désormais mis de côté dans rp_migration_archive, avec leur serveur
// d'origine : rien ne disparaît, tout reste consultable dans la base.
db.exec(`CREATE TABLE IF NOT EXISTS rp_migration_archive (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name  TEXT NOT NULL,
  origin_guild TEXT,
  row_json    TEXT NOT NULL,
  archived_at TEXT NOT NULL
)`);

// 📨 Traqueur d'invitations : qui a fait venir chaque membre.
// Une ligne par arrivée détectée — l'inviteur peut être NULL (lien de vanité,
// permission « Gérer le serveur » manquante, ou détection impossible).
db.exec(`CREATE TABLE IF NOT EXISTS invitations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  inviter_id TEXT,
  code       TEXT,
  at         INTEGER NOT NULL
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_invitations_guild ON invitations (guild_id, inviter_id)');

// 🎲 Mini-jeux (/jeu).
//  • jeux_parties : chaque partie en cours. Les boutons portent son id
//    (« jeu:<id>:<action> ») et tout l'état vit ici : une partie survit à un
//    redémarrage du bot. joueurs et etat sont du JSON ; « bot » désigne le
//    bot comme adversaire. Une partie finie est effacée.
//  • jeux_stats : victoires, défaites et nuls par membre et par jeu.
//  • jeux_gains : l'XP de jeux déjà versée aujourd'hui, pour le plafond
//    quotidien (jour = date de Paris, AAAA-MM-JJ).
db.exec(`
CREATE TABLE IF NOT EXISTS jeux_parties (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  jeu        TEXT NOT NULL,
  joueurs    TEXT NOT NULL,
  etat       TEXT NOT NULL,
  tour       TEXT,
  expire_le  INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jeux_parties_expire ON jeux_parties (expire_le);
CREATE INDEX IF NOT EXISTS idx_jeux_parties_jeu ON jeux_parties (guild_id, jeu);
CREATE TABLE IF NOT EXISTS jeux_stats (
  guild_id  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  jeu       TEXT NOT NULL,
  victoires INTEGER NOT NULL DEFAULT 0,
  defaites  INTEGER NOT NULL DEFAULT 0,
  nuls      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, jeu)
);
CREATE TABLE IF NOT EXISTS jeux_gains (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  jour     TEXT NOT NULL,
  xp       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, jour)
);
`);
// 🔢 Comptage : le rôle d'erreur RÉELLEMENT donné au dernier fautif. Retirer
// celui du réglage du moment ratait l'ancien quand le staff changeait de
// rôle : le fautif le gardait pour toujours.
try {
  db.exec('ALTER TABLE comptage ADD COLUMN role_fautif TEXT');
} catch {}
// 💋 XP du bisou déjà versée, par PERSONNE et par jour de Paris. Elle
// survit au divorce (la flamme, elle, s'efface) : divorcer puis se remarier
// le même jour ne rouvre pas un second gain.
db.exec(`
CREATE TABLE IF NOT EXISTS mariage_bisous_xp (
  user_id TEXT NOT NULL,
  jour    TEXT NOT NULL,
  PRIMARY KEY (user_id, jour)
);
`);
// ⚔️ Aventure SAO : inventaire, combats de boss PERSISTÉS (un bouton porte
// l'id du combat et survit à un redémarrage), améliorations de forge,
// quêtes du jour, raids du serveur, duels, coffres de couple et compétences
// uniques (un seul détenteur par serveur).
db.exec(`
CREATE TABLE IF NOT EXISTS sao_inventaire (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  objet    TEXT NOT NULL,
  qte      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, objet)
);
CREATE TABLE IF NOT EXISTS sao_combats (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  etage    INTEGER NOT NULL,
  etat     TEXT NOT NULL,
  statut   TEXT NOT NULL DEFAULT 'en_cours',
  cree_le  INTEGER NOT NULL,
  maj_le   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sao_combats_joueur ON sao_combats (guild_id, user_id, statut);
CREATE TABLE IF NOT EXISTS sao_ameliorations (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  arme     TEXT NOT NULL,
  plus     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, arme)
);
CREATE TABLE IF NOT EXISTS sao_quetes (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  jour     TEXT NOT NULL,
  cle      TEXT NOT NULL,
  objectif INTEGER NOT NULL,
  progres  INTEGER NOT NULL DEFAULT 0,
  faite    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, jour, cle)
);
CREATE TABLE IF NOT EXISTS sao_raids (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  salon_id     TEXT,
  message_id   TEXT,
  boss         TEXT NOT NULL,
  etage        INTEGER NOT NULL,
  pv_max       INTEGER NOT NULL,
  pv           INTEGER NOT NULL,
  statut       TEXT NOT NULL DEFAULT 'actif',
  cree_le      INTEGER NOT NULL,
  expire_le    INTEGER NOT NULL,
  fini_le      INTEGER,
  dernier_coup TEXT
);
CREATE INDEX IF NOT EXISTS idx_sao_raids_guild ON sao_raids (guild_id, statut);
CREATE TABLE IF NOT EXISTS sao_raid_coups (
  raid_id    INTEGER NOT NULL,
  user_id    TEXT NOT NULL,
  degats     INTEGER NOT NULL DEFAULT 0,
  coups      INTEGER NOT NULL DEFAULT 0,
  dernier_le INTEGER,
  PRIMARY KEY (raid_id, user_id)
);
CREATE TABLE IF NOT EXISTS sao_duels (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id  TEXT NOT NULL,
  a         TEXT NOT NULL,
  b         TEXT NOT NULL,
  statut    TEXT NOT NULL DEFAULT 'attente',
  cree_le   INTEGER NOT NULL,
  vainqueur TEXT,
  journal   TEXT
);
CREATE TABLE IF NOT EXISTS sao_coffres (
  guild_id TEXT NOT NULL,
  couple   TEXT NOT NULL,
  col      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, couple)
);
CREATE TABLE IF NOT EXISTS sao_coffre_objets (
  guild_id TEXT NOT NULL,
  couple   TEXT NOT NULL,
  objet    TEXT NOT NULL,
  qte      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, couple, objet)
);
CREATE TABLE IF NOT EXISTS sao_uniques (
  guild_id   TEXT NOT NULL,
  competence TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  obtenu_le  TEXT,
  PRIMARY KEY (guild_id, competence)
);
`);
for (const column of [
  'position INTEGER',        // étage où l'on chasse (≤ floor) : /sao voyager
  'arme TEXT',               // clé de l'arme équipée (NULL = reprise de weapon)
  'armure TEXT',
  'morts INTEGER',           // Monument of Life
  'boss_vaincus INTEGER',
  'monstres INTEGER',
  'quotidien_jour TEXT',     // AAAA-MM-JJ de la dernière quotidienne
  'serie INTEGER',
  'repas TEXT',              // repas actif et chasses restantes
  'repas_reste INTEGER',
  'argo_etage INTEGER',      // renseignement d'Argo acheté pour ce boss
  'pv_le INTEGER',           // dernière régénération (ms)
  'reapparition INTEGER',    // retour du Monument of Life (ms)
  'peche_morsure INTEGER',   // ligne à l'eau : instant de la morsure (ms)
  'peche_jeton INTEGER',
  'peche_le INTEGER',
  'pvp_victoires INTEGER',
  'pvp_defaites INTEGER',
  'poissons INTEGER',
]) {
  try {
    db.exec(`ALTER TABLE sao_players ADD COLUMN ${column}`);
  } catch {}
}

try {
  const done = db.prepare("SELECT value FROM app_state WHERE key = 'rp_global_migrated'").get();
  if (!done) {
    const archiver = db.prepare(
      'INSERT INTO rp_migration_archive (table_name, origin_guild, row_json, archived_at) VALUES (?, ?, ?, ?)'
    );
    const mettreDeCote = (table, rows) => {
      const quand = new Date().toISOString();
      for (const r of rows) archiver.run(table, r.guild_id == null ? null : String(r.guild_id), JSON.stringify(r), quand);
      return rows.length;
    };
    let archives = 0;
    db.transaction(() => {
      archives += mettreDeCote(
        'identity_cards',
        db.prepare('SELECT * FROM identity_cards WHERE rowid NOT IN (SELECT MIN(rowid) FROM identity_cards GROUP BY user_id)').all()
      );
      db.exec("DELETE FROM identity_cards WHERE rowid NOT IN (SELECT MIN(rowid) FROM identity_cards GROUP BY user_id)");
      db.prepare('UPDATE identity_cards SET guild_id = ?').run(RP_SCOPE);
      archives += mettreDeCote(
        'permits',
        db.prepare('SELECT * FROM permits WHERE rowid NOT IN (SELECT MIN(rowid) FROM permits GROUP BY user_id)').all()
      );
      db.exec("DELETE FROM permits WHERE rowid NOT IN (SELECT MIN(rowid) FROM permits GROUP BY user_id)");
      db.prepare('UPDATE permits SET guild_id = ?').run(RP_SCOPE);
      archives += mettreDeCote(
        'enterprises',
        db.prepare('SELECT * FROM enterprises WHERE id NOT IN (SELECT MIN(id) FROM enterprises GROUP BY name COLLATE NOCASE)').all()
      );
      db.exec("DELETE FROM enterprises WHERE id NOT IN (SELECT MIN(id) FROM enterprises GROUP BY name COLLATE NOCASE)");
      db.prepare('UPDATE enterprises SET guild_id = ?').run(RP_SCOPE);
      db.prepare('UPDATE insured_vehicles SET guild_id = ?').run(RP_SCOPE);
    })();
    db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('rp_global_migrated', '1')").run();
    console.log('🌐 Identité RP migrée en portée globale (cartes, permis, entreprises, assurances partagés partout).');
    if (archives) {
      console.log(`🗃️ ${archives} fiche(s) en doublon mise(s) de côté dans rp_migration_archive — rien n'est supprimé.`);
    }
  }
} catch (err) {
  console.warn(`⚠️ Migration RP globale ignorée : ${err.message}`);
}

const DEFAULT_CONFIG = {
  staff_role_id: null,
  admin_role_id: null,
  staff_role_ids: null,
  admin_role_ids: null,
  service_role_id: null,
  police_role_ids: null,
  wlrp_role_id: null,
  log_channel_id: null,
  level_channel_id: null,
  service_channel_id: null,
  staff_channel_id: null,
  member_channel_id: null,
  update_channel_id: null,
  proof_channel_id: null,
  ticket_transcript_channel_id: null,
  welcome_message: null,
  goodbye_message: null,
  goodbye_channel_id: null,
  welcome_mention: 0,
  autorole_role_ids: null,
  autorole_bot_role_ids: null,
  musique_channel_ids: null,
  musique_annonce_channel_id: null,
  welcome_color: null,
  embed_style: 1,
  embed_accent: null,
  embed_footer: 1,
  embed_author: 1,
  embed_ligne: 1,
  embed_filet_taille: 16,
  embed_fusion: 1,
  embed_cartes: 1,
  embed_bordure: null,
  embed_titre: null,
  embed_banniere: null,
  embed_timestamp: 1,
  embed_force_color: 0,
  welcome_style: null,
  welcome_rules_channel_id: null,
  welcome_help_channel_id: null,
  welcome_banner: 0,
  welcome_banner_color: null,
  welcome_image: null,
  welcome_avatar: 'rond',
  welcome_title: null,
  welcome_fields: 1,
  goodbye_color: null,
  goodbye_image: null,
  goodbye_avatar: 'rond',
  goodbye_title: null,
  goodbye_fields: 1,
  rp_enabled: 0,
  rp_locked: 0,
  antispam_enabled: 0,
  antispam_exempt_channels: null,
  antispam_exempt_categories: null,
  antispam_exempt_filtre: 0,
  antinuke_enabled: 0,
  captcha_enabled: 0,
  verified_role_id: null,
  captcha_channel_id: null,
  captcha_role_remove: null,
  captcha_max_essais: 3,
  captcha_kick: 1,
  partner_channel_id: null,
  comptage_channel_id: null,
  comptage_meme_personne: 0,
  comptage_maths: 0,
  comptage_reactions: 1,
  comptage_supprimer: 0,
  comptage_role_erreur: null,
  comptage_xp: 0,
  patch_channel_id: null,
  patch_mention: null,
  interact_enabled: 0,
  sao_enabled: 0,
  levels_enabled: 1,
  level_rewards_stack: 1,
  rp_jeu: 'roblox',
  bot_langue: 'fr',
  vocal_alerte_channel_id: null,
  vocal_attente_channel_id: null,
  vocal_assistance_ids: null,
  vocal_perso_createur_id: null,
  bump_channel_id: null,
  bump_role_id: null,
  bump_dernier: null,
  level_image_url: null,
  bot_nick: null,
  bot_avatar_url: null,
  bot_profil: null,
  confession_enabled: 0,
  confession_channel_id: null,
  // 🎲 Mini-jeux — une ligne existante lit NULL : toujours `cfg.x ?? défaut`.
  jeux_enabled: 0,
  jeux_desactives: null,
  jeux_xp_victoire: 20,
  jeux_xp_bot: 5,
  jeux_xp_plafond: 200,
  jeux_col_victoire: 0,
  sao_salon_id: null,
  sao_raid_heures: 6,
  sao_pvp: 1,
  sao_chasse_delai: 15,
  sao_afk: 1,
  sao_afk_heures: 8,
  sao_mort_penalite: 10,
  sao_difficulte: 'normal',
  xp_text: 20,
  xp_voice: 20,
  xp_cooldown: 60,
  mariage_avantages: 1,
  mariage_bonus_xp: 10,
  mariage_lune_de_miel_jours: 7,
  mariage_bisou_xp: 30,
  mariage_actif_minutes: 10,
  mariage_salon_id: null,
  xp_text_min: null,
  xp_text_max: null,
  xp_longueur_min: 0,
  xp_vocal_seul: 0,
  xp_vocal_muet: 0,
  xp_mult_cumul: 0,
  xp_mult_global: 100,
  xp_boost_pourcent: 0,
  xp_boost_fin: null,
  xp_weekend_pourcent: 0,
  xp_sao_pourcent: 100,
  xp_courbe: 'mee6',
  xp_niveau_max: 0,
  level_annonce: null,
  level_message: null,
  level_annonce_pas: 1,
  level_mention: 1,
  level_reset_depart: 0,
};

const getConfigStmt = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?');
const insertConfigStmt = db.prepare('INSERT OR IGNORE INTO guild_config (guild_id) VALUES (?)');

function getGuildConfig(guildId) {
  return getConfigStmt.get(guildId) || { guild_id: guildId, ...DEFAULT_CONFIG };
}

const CONFIG_COLUMNS = Object.keys(DEFAULT_CONFIG);

function setGuildConfig(guildId, key, value) {
  if (!CONFIG_COLUMNS.includes(key)) throw new Error(`Colonne de configuration inconnue : ${key}`);
  insertConfigStmt.run(guildId);
  db.prepare(`UPDATE guild_config SET ${key} = ? WHERE guild_id = ?`).run(value, guildId);
}

module.exports = { db, getGuildConfig, setGuildConfig, RP_SCOPE };
