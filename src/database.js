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
  'embed_fusion INTEGER',               // 1 = champs refondus en sections (défaut)
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
      // Le total des deux compteurs devient l'XP unique. Le niveau qui en
      // découle est recalculé juste après, à la même courbe.
      db.exec('UPDATE levels SET xp = COALESCE(text_xp, 0) + COALESCE(voice_xp, 0)');
      const xpForLevel = (n) => 5 * n * n + 50 * n + 100;
      const niveauDe = (xp) => {
        let level = 0;
        let reste = xp;
        while (reste >= xpForLevel(level)) {
          reste -= xpForLevel(level);
          level++;
        }
        return level;
      };
      const maj = db.prepare('UPDATE levels SET level = ? WHERE guild_id = ? AND user_id = ?');
      const tous = db.prepare('SELECT guild_id, user_id, xp FROM levels').all();
      const lot = db.transaction((lignes) => {
        for (const l of lignes) maj.run(niveauDe(l.xp || 0), l.guild_id, l.user_id);
      });
      lot(tous);
      if (tous.length) console.log(`📊 Niveaux fusionnés : ${tous.length} membre(s) repris (écrit + vocal → un seul niveau).`);
    } catch (err) {
      console.warn(`⚠️ Fusion des niveaux : reprise impossible (${err.message}).`);
    }
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
  xp_text: 20,
  xp_voice: 20,
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
