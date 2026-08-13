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
  xp_text            INTEGER NOT NULL DEFAULT 20,
  xp_voice           INTEGER NOT NULL DEFAULT 10,
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
  'antinuke_enabled INTEGER',
  'captcha_enabled INTEGER',
  'verified_role_id TEXT',
  'captcha_channel_id TEXT',
  'captcha_role_remove TEXT',
  'captcha_max_essais INTEGER',
  'captcha_kick INTEGER',
  'partner_channel_id TEXT',
  'level_image_url TEXT',
  'goodbye_channel_id TEXT',
  'patch_channel_id TEXT',
  'interact_enabled INTEGER',
  'sao_enabled INTEGER',
  'police_role_ids TEXT',
  'wlrp_role_id TEXT',
  'ticket_transcript_channel_id TEXT',
  'levels_enabled INTEGER', // NULL = activé (comportement historique)
  // 🎭 Rôles automatiques à l'arrivée (liste JSON d'identifiants de rôles)
  'autorole_role_ids TEXT',
  // 👋 Apparence des messages d'arrivée / de départ, réglée depuis le site
  'welcome_color TEXT',        // couleur de la barre de l'embed (#RRGGBB)
  'welcome_image TEXT',        // grande image de fond de l'embed
  'welcome_avatar TEXT',       // 'rond' | 'grand' | 'aucun' — cadre de la photo
  'welcome_title TEXT',        // titre de l'embed
  'welcome_fields INTEGER',    // 1 = afficher les champs (nom, ID, n°, création)
  'goodbye_color TEXT',
  'goodbye_image TEXT',
  'goodbye_avatar TEXT',
  'goodbye_title TEXT',
  'goodbye_fields INTEGER',
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
try {
  const done = db.prepare("SELECT value FROM app_state WHERE key = 'rp_global_migrated'").get();
  if (!done) {
    db.transaction(() => {
      db.exec("DELETE FROM identity_cards WHERE rowid NOT IN (SELECT MIN(rowid) FROM identity_cards GROUP BY user_id)");
      db.prepare('UPDATE identity_cards SET guild_id = ?').run(RP_SCOPE);
      db.exec("DELETE FROM permits WHERE rowid NOT IN (SELECT MIN(rowid) FROM permits GROUP BY user_id)");
      db.prepare('UPDATE permits SET guild_id = ?').run(RP_SCOPE);
      db.exec("DELETE FROM enterprises WHERE id NOT IN (SELECT MIN(id) FROM enterprises GROUP BY name COLLATE NOCASE)");
      db.prepare('UPDATE enterprises SET guild_id = ?').run(RP_SCOPE);
      db.prepare('UPDATE insured_vehicles SET guild_id = ?').run(RP_SCOPE);
    })();
    db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('rp_global_migrated', '1')").run();
    console.log('🌐 Identité RP migrée en portée globale (cartes, permis, entreprises, assurances partagés partout).');
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
  welcome_color: null,
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
  antinuke_enabled: 0,
  captcha_enabled: 0,
  verified_role_id: null,
  captcha_channel_id: null,
  captcha_role_remove: null,
  captcha_max_essais: 3,
  captcha_kick: 1,
  partner_channel_id: null,
  patch_channel_id: null,
  interact_enabled: 0,
  sao_enabled: 0,
  levels_enabled: 1,
  level_image_url: null,
  xp_text: 20,
  xp_voice: 10,
  xp_cooldown: 60,
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
