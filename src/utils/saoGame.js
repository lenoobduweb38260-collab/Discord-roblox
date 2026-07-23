// ----- ⚔️ Moteur du jeu d'aventure « Aventure SAO » -----
// Jeu interactif façon « Aventure » de Koya (One Piece), mais sur le thème de
// Sword Art Online : les joueurs sont piégés dans Aincrad, un château flottant
// de 100 étages. Pour s'en libérer, ils gravissent les étages en chassant des
// monstres, en montant de niveau, en forgeant des armes et en battant le boss
// de chaque étage. Récompenses : badges perso (titres), XP serveur automatique
// (les clears d'étage donnent de l'XP serveur), et gains AFK (farm hors-ligne).
//
// Ce module ne contient que la LOGIQUE (données, maths de combat, accès base,
// attribution des badges). Les embeds et boutons vivent dans commands/sao.js.

const { db } = require('../database');
const { addXp, announceLevelUp } = require('./levels');

// ----- Données de jeu -----

// Armes forgées (l'index = palier). Chaque palier ajoute de l'attaque.
const WEAPONS = [
  { name: 'Épée courte', atk: 0, cost: 0 },
  { name: 'Épée en fer', atk: 10, cost: 200 },
  { name: 'Anneal Blade', atk: 22, cost: 600 },
  { name: 'Wind Fleuret', atk: 38, cost: 1500 },
  { name: 'Elucidator', atk: 60, cost: 3500 },
  { name: 'Dark Repulser', atk: 88, cost: 7000 },
  { name: 'Lambent Light', atk: 120, cost: 13000 },
  { name: 'Excalibur', atk: 165, cost: 24000 },
  { name: 'Night Sky Sword', atk: 220, cost: 40000 },
];
const TOP_WEAPON = WEAPONS.length - 1;

// Monstres rencontrés en chasse (leur puissance dépend de l'étage).
const MOBS = [
  'Sanglier frénétique',
  'Loup Kobold',
  'Gobelin des cavernes',
  'Kobold sentinelle',
  'Plante carnivore',
  'Ruin Kobold Trooper',
  'Golem de pierre',
  'Araignée géante',
  'Spectre errant',
  'Taureau de Dicey Cavern',
];

// Boss d'étage : quelques boss nommés aux étages clés, sinon un gardien générique.
const BOSSES = {
  1: 'Illfang le Seigneur Kobold',
  2: 'Baran le Général Kobold',
  5: 'Nerius le Suzerain Écarlate',
  25: 'The Skull Reaper',
  49: 'Le Chevalier Impur',
  50: 'Le Chevalier Impur',
  74: 'The Gleam Eyes',
  75: 'Fuscus l\'Ombre Vaine',
  100: 'Heathcliff, le Chevalier Paladin',
};
function bossName(floor) {
  return BOSSES[floor] || `Gardien de l'étage ${floor}`;
}

// Badges perso (titres) débloquables.
const BADGES = {
  debutant: { emoji: '🗡️', name: 'Débutant', desc: 'Rejoindre Aincrad' },
  premier_sang: { emoji: '🩸', name: 'Premier Sang', desc: 'Vaincre un premier monstre' },
  boss_slayer: { emoji: '🐉', name: 'Tombeur de Boss', desc: 'Vaincre un boss d\'étage' },
  etage_10: { emoji: '🏔️', name: 'Vétéran', desc: 'Atteindre l\'étage 10' },
  etage_25: { emoji: '⚔️', name: 'Chevalier', desc: 'Atteindre l\'étage 25' },
  etage_50: { emoji: '🛡️', name: 'Héros', desc: 'Atteindre l\'étage 50' },
  etage_75: { emoji: '🌟', name: 'Élite', desc: 'Atteindre l\'étage 75' },
  clear: { emoji: '👑', name: 'Clear !', desc: 'Terminer l\'étage 100 d\'Aincrad' },
  beater: { emoji: '🖤', name: 'Beater', desc: 'Atteindre le niveau 20' },
  forgeron: { emoji: '🔨', name: 'Maître Forgeron', desc: 'Forger l\'arme ultime' },
  riche: { emoji: '💰', name: 'Fortune', desc: 'Amasser 10 000 Col' },
};

const MAX_FLOOR = 100;
const AFK_CAP_MIN = 8 * 60; // farm AFK plafonné à 8 h d'accumulation
const CRIT_CHANCE = 0.18;
const CRIT_MULT = 1.6;

// ----- Maths de personnage -----
function maxHp(level) {
  return 120 + level * 30;
}
function playerAtk(player) {
  return 12 + player.level * 5 + WEAPONS[player.weapon].atk;
}
function xpForLevel(level) {
  return 60 + level * 40;
}
function mobHp(floor) {
  return 40 + floor * 18;
}
function mobAtk(floor) {
  return 6 + floor * 3;
}
function bossHp(floor) {
  return 400 + floor * 140;
}
function bossAtk(floor) {
  return 16 + floor * 7;
}

// Barre de progression (PV, XP…).
function bar(cur, max, size = 12) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
  const filled = Math.round(ratio * size);
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

// Un coup : dégâts = attaque ± 15 %, avec une chance de coup critique.
function strike(atk) {
  const variance = 0.85 + Math.random() * 0.3;
  const crit = Math.random() < CRIT_CHANCE;
  const dmg = Math.max(1, Math.round(atk * variance * (crit ? CRIT_MULT : 1)));
  return { dmg, crit };
}

// ----- Accès base de données -----
const insertPlayerStmt = db.prepare(`
  INSERT OR IGNORE INTO sao_players
    (guild_id, user_id, floor, level, xp, hp, col, weapon, title, last_hunt, last_afk, created_at)
  VALUES (?, ?, 1, 1, 0, ?, 0, 0, NULL, ?, ?, ?)
`);
const getPlayerStmt = db.prepare('SELECT * FROM sao_players WHERE guild_id = ? AND user_id = ?');
const savePlayerStmt = db.prepare(`
  UPDATE sao_players
  SET floor = ?, level = ?, xp = ?, hp = ?, col = ?, weapon = ?, title = ?, last_hunt = ?, last_afk = ?
  WHERE guild_id = ? AND user_id = ?
`);
const leaderboardStmt = db.prepare(
  'SELECT * FROM sao_players WHERE guild_id = ? ORDER BY floor DESC, level DESC, xp DESC LIMIT ?'
);
const hasBadgeStmt = db.prepare('SELECT 1 FROM sao_badges WHERE guild_id = ? AND user_id = ? AND badge = ?');
const addBadgeStmt = db.prepare(
  'INSERT OR IGNORE INTO sao_badges (guild_id, user_id, badge, earned_at) VALUES (?, ?, ?, ?)'
);
const listBadgesStmt = db.prepare('SELECT badge FROM sao_badges WHERE guild_id = ? AND user_id = ? ORDER BY earned_at');

function getPlayer(guildId, userId) {
  return getPlayerStmt.get(guildId, userId) || null;
}

// Crée le personnage s'il n'existe pas ; renvoie { player, created }.
function ensurePlayer(guildId, userId) {
  const existing = getPlayer(guildId, userId);
  if (existing) return { player: existing, created: false };
  const now = new Date().toISOString();
  insertPlayerStmt.run(guildId, userId, maxHp(1), now, now, now);
  return { player: getPlayer(guildId, userId), created: true };
}

function savePlayer(p) {
  savePlayerStmt.run(p.floor, p.level, p.xp, p.hp, p.col, p.weapon, p.title, p.last_hunt, p.last_afk, p.guild_id, p.user_id);
}

function leaderboard(guildId, limit = 10) {
  return leaderboardStmt.all(guildId, limit);
}

function ownedBadges(guildId, userId) {
  return listBadgesStmt.all(guildId, userId).map((r) => r.badge);
}

// Attribue un badge ; renvoie true s'il vient d'être débloqué.
function award(guildId, userId, key) {
  if (!BADGES[key]) return false;
  const res = addBadgeStmt.run(guildId, userId, key, new Date().toISOString());
  return res.changes > 0;
}

// Débloque tous les badges « à seuil » atteints ; renvoie les clés nouvellement gagnées.
function syncMilestoneBadges(p) {
  const earned = [];
  const check = (cond, key) => {
    if (cond && award(p.guild_id, p.user_id, key)) earned.push(key);
  };
  check(p.floor >= 10, 'etage_10');
  check(p.floor >= 25, 'etage_25');
  check(p.floor >= 50, 'etage_50');
  check(p.floor >= 75, 'etage_75');
  check(p.level >= 20, 'beater');
  check(p.col >= 10000, 'riche');
  check(p.weapon >= TOP_WEAPON, 'forgeron');
  return earned;
}

// Ajoute de l'XP d'aventure au personnage (mutation) ; renvoie le nb de niveaux gagnés.
function gainXp(p, amount) {
  p.xp += Math.max(0, Math.round(amount));
  let levels = 0;
  while (p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level);
    p.level += 1;
    levels += 1;
  }
  // Une montée de niveau soigne un peu et augmente les PV max.
  if (levels > 0) p.hp = Math.min(maxHp(p.level), p.hp + levels * 40);
  return levels;
}

// XP serveur automatique (récompense « auto XP ») : les hauts faits SAO
// donnent de l'XP dans le système de niveaux du serveur, avec annonce.
async function grantServerXp(guild, userId, amount, fallbackChannel = null) {
  try {
    const res = addXp(guild.id, userId, 'text', Math.max(0, Math.round(amount)));
    if (res.leveledUp) await announceLevelUp(guild, userId, 'text', res.newLevel, fallbackChannel);
    return res;
  } catch {
    return { leveledUp: false };
  }
}

module.exports = {
  WEAPONS,
  TOP_WEAPON,
  MOBS,
  BADGES,
  MAX_FLOOR,
  AFK_CAP_MIN,
  bossName,
  maxHp,
  playerAtk,
  xpForLevel,
  mobHp,
  mobAtk,
  bossHp,
  bossAtk,
  bar,
  strike,
  getPlayer,
  ensurePlayer,
  savePlayer,
  leaderboard,
  ownedBadges,
  award,
  syncMilestoneBadges,
  gainXp,
  grantServerXp,
};
