const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data.sqlite'));
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
  whitelist_enabled  INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS whitelist (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS global_bans (
  user_id   TEXT PRIMARY KEY,
  reason    TEXT,
  banned_by TEXT NOT NULL,
  banned_at TEXT NOT NULL
);
`);

const DEFAULT_CONFIG = {
  staff_role_id: null,
  admin_role_id: null,
  service_role_id: null,
  log_channel_id: null,
  level_channel_id: null,
  service_channel_id: null,
  staff_channel_id: null,
  whitelist_enabled: 0,
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

module.exports = { db, getGuildConfig, setGuildConfig };
