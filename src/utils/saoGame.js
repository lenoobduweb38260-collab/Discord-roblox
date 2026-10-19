// ----- ⚔️ Moteur du jeu d'aventure « Aventure SAO » -----
// Jeu façon « Aventure » de Koya, EPIC RPG ou Pokétwo, dans l'univers de
// Sword Art Online : piégés dans Aincrad, les joueurs gravissent cent
// étages en chassant, en forgeant chez Lisbeth, en commerçant avec Agil, en
// achetant les renseignements d'Argo et en battant le boss de chaque étage.
//
// Ce module ne contient que la LOGIQUE et la base : ni discord.js, ni
// réseau, ni système de niveaux du serveur (levels.js l'appelle pour les
// récompenses de niveau : l'inverse créerait un require circulaire).
// Les cartes vivent dans utils/sao/vues.js, les boutons dans commands/sao.js.
//
//   donnees.js   le catalogue (étages, boss, objets, skills, quêtes…)
//   formules.js  la courbe de progression, documentée et simulée
//   combat.js    le combat de boss tour par tour (état JSON persistant)
//
// ── Contrat A (utilisé par les niveaux et les mini-jeux) ──
//   crediterCol(guildId, userId, montant) -> nouveau solde
//   donnerObjet(guildId, userId, cle, qte = 1) -> boolean
//   OBJETS, objetsRecompensables() -> [{ cle, nom, emoji }] (≤ 25)
// Les deux fonctions créent le personnage s'il n'existe pas. L'appelant
// vérifie `getGuildConfig(guildId).sao_enabled` avant de les appeler.

const { db, getGuildConfig } = require('../database');
const D = require('./sao/donnees');
const F = require('./sao/formules');
const C = require('./sao/combat');

const { OBJETS, BADGES } = D;
const MAX_FLOOR = 100;
const ABANDON_MS = 30 * 60 * 1000; // un combat sans clic depuis 30 min est abandonné
const REAPPARITION_MS = 60 * 1000; // le retour du Monument of Life
const PECHE_DELAI_MS = 20 * 1000;
const PECHE_TROP_TARD_MS = 3000;
const DUEL_EXPIRATION_MS = 5 * 60 * 1000;
const AFK_MIN_MIN = 10;
const KIT_DEPART = { potion_soin: 3, cristal_soin: 1 };

const maintenant = (now) => (Number.isFinite(now) ? now : Date.now());
const iso = (ms) => new Date(ms).toISOString();
const tempsDe = (v) => (v == null ? 0 : typeof v === 'number' ? v : Date.parse(v) || 0);

// Hachage FNV-1a : tirages du jour reproductibles (rumeur, quêtes).
function hacher(texte) {
  let h = 0x811c9dc5;
  for (const c of String(texte)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ── Réglages du serveur (une colonne neuve vaut NULL : toujours un repli) ──
function reglagesSao(guildId) {
  const cfg = getGuildConfig(guildId);
  const borne = (v, def, min, max) => {
    if (v === null || v === undefined || v === '') return def;
    const x = Number(v);
    return Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : def;
  };
  return {
    actif: Boolean(cfg.sao_enabled),
    salonRaid: cfg.sao_salon_id || null,
    raidHeures: borne(cfg.sao_raid_heures, 6, 0, 168),
    pvp: Number(cfg.sao_pvp ?? 1) !== 0,
    chasseDelai: borne(cfg.sao_chasse_delai, 15, 5, 300),
    afk: Number(cfg.sao_afk ?? 1) !== 0,
    afkHeures: borne(cfg.sao_afk_heures, 8, 1, 24),
    mortPenalite: borne(cfg.sao_mort_penalite, 10, 0, 50),
    difficulte: F.DIFFICULTES[cfg.sao_difficulte] ? cfg.sao_difficulte : 'normal',
    niveauxActifs: cfg.levels_enabled !== 0,
  };
}

// ── Jour de jeu (heure de Paris) ────────────────────────────────────────
function jourSao(now) {
  return new Date(maintenant(now)).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
}
function veilleDe(jour) {
  return new Date(Date.parse(`${jour}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
}
function msAvantMinuit(now) {
  const parties = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date(maintenant(now)));
  const v = (t) => Number(parties.find((p) => p.type === t)?.value || 0);
  return Math.max(1000, (86400 - (v('hour') * 3600 + v('minute') * 60 + v('second'))) * 1000);
}

// ══════════════════════════════════════════════════════════════════
// Personnage
// ══════════════════════════════════════════════════════════════════

const COLONNES_JEU = [
  'floor', 'level', 'xp', 'hp', 'col', 'weapon', 'title', 'last_hunt', 'last_afk', 'position', 'arme', 'armure',
  'morts', 'boss_vaincus', 'monstres', 'quotidien_jour', 'serie', 'repas', 'repas_reste', 'argo_etage', 'pv_le',
  'reapparition', 'peche_morsure', 'peche_jeton', 'peche_le', 'pvp_victoires', 'pvp_defaites', 'poissons',
];

const insertPlayerStmt = db.prepare(`
  INSERT OR IGNORE INTO sao_players
    (guild_id, user_id, floor, level, xp, hp, col, weapon, title, last_hunt, last_afk, created_at,
     position, arme, armure, morts, boss_vaincus, monstres, serie, pv_le, pvp_victoires, pvp_defaites, poissons)
  VALUES (?, ?, 1, 1, 0, ?, ?, 0, NULL, NULL, ?, ?, 1, 'epee_courte', 'tunique_toile', 0, 0, 0, 0, ?, 0, 0, 0)
`);
const getPlayerStmt = db.prepare('SELECT * FROM sao_players WHERE guild_id = ? AND user_id = ?');
const savePlayerStmt = db.prepare(
  `UPDATE sao_players SET ${COLONNES_JEU.map((c) => `${c} = ?`).join(', ')} WHERE guild_id = ? AND user_id = ?`
);
const setColStmt = db.prepare('UPDATE sao_players SET col = ? WHERE guild_id = ? AND user_id = ?');

function getPlayer(guildId, userId) {
  return getPlayerStmt.get(String(guildId), String(userId)) || null;
}

// Crée le personnage s'il n'existe pas ; renvoie { player, created }.
// Un nouveau venu reçoit 100 Col et un petit kit : 3 potions, 1 cristal.
function ensurePlayer(guildId, userId, now) {
  const g = String(guildId);
  const u = String(userId);
  const existant = getPlayer(g, u);
  if (existant) return { player: normaliser(existant), created: false };
  const t = maintenant(now);
  insertPlayerStmt.run(g, u, F.pvMaxDe(1), F.COL_DEPART, iso(t), iso(t), t);
  for (const [cle, qte] of Object.entries(KIT_DEPART)) ajouterObjet(g, u, cle, qte);
  return { player: normaliser(getPlayer(g, u)), created: true };
}

function savePlayer(p) {
  if (OBJETS[p.arme]) p.weapon = OBJETS[p.arme].palier ?? 0;
  savePlayerStmt.run(...COLONNES_JEU.map((c) => (p[c] === undefined ? null : p[c])), p.guild_id, p.user_id);
}

// Les anciennes armes (index 0 à 8) retrouvent un palier du nouveau catalogue.
const REPRISE_ARMES = ['epee_courte', 'anneal_blade', 'sword_of_eventide', 'rapiere_rovia', 'epee_mithril', 'lame_damas', 'lambent_light', 'dark_repulser', 'epee_runique'];

// Complète une ligne brute : les colonnes ajoutées après coup valent NULL.
function normaliser(p) {
  if (!p) return null;
  p.floor = Math.max(1, p.floor || 1);
  p.level = Math.max(1, p.level || 1);
  p.xp = Math.max(0, p.xp || 0);
  p.col = Math.max(0, p.col || 0);
  p.position = Math.min(Math.min(p.floor, MAX_FLOOR), Math.max(1, p.position ?? p.floor));
  if (!OBJETS[p.arme] || OBJETS[p.arme].type !== 'arme') p.arme = REPRISE_ARMES[Math.min(8, Math.max(0, p.weapon || 0))];
  if (!OBJETS[p.armure] || OBJETS[p.armure].type !== 'armure') p.armure = 'tunique_toile';
  for (const c of ['morts', 'boss_vaincus', 'monstres', 'serie', 'repas_reste', 'pvp_victoires', 'pvp_defaites', 'poissons']) p[c] = p[c] || 0;
  if (p.repas && (!OBJETS[p.repas] || p.repas_reste <= 0)) {
    p.repas = null;
    p.repas_reste = 0;
  }
  return p;
}

const getPlusStmt = db.prepare('SELECT plus FROM sao_ameliorations WHERE guild_id = ? AND user_id = ? AND arme = ?');
const setPlusStmt = db.prepare(`
  INSERT INTO sao_ameliorations (guild_id, user_id, arme, plus) VALUES (?, ?, ?, ?)
  ON CONFLICT (guild_id, user_id, arme) DO UPDATE SET plus = excluded.plus
`);
function plusArme(guildId, userId, arme) {
  return getPlusStmt.get(String(guildId), String(userId), arme)?.plus || 0;
}

// ── Compétences uniques (un détenteur par serveur) ──
const getUniqueStmt = db.prepare('SELECT * FROM sao_uniques WHERE guild_id = ? AND competence = ?');
const uniquesDeStmt = db.prepare('SELECT competence FROM sao_uniques WHERE guild_id = ? AND user_id = ?');
const setUniqueStmt = db.prepare('INSERT OR IGNORE INTO sao_uniques (guild_id, competence, user_id, obtenu_le) VALUES (?, ?, ?, ?)');
function detenteurUnique(guildId, cle) {
  return getUniqueStmt.get(String(guildId), cle) || null;
}
function uniquesDe(guildId, userId) {
  return uniquesDeStmt.all(String(guildId), String(userId)).map((r) => r.competence).filter((k) => D.UNIQUES[k]);
}

// Les statistiques de combat d'un personnage, bonus compris.
// `lien` : le Lien du cœur (conjoint aventurier sur ce serveur), +10 % ATK.
function statsJoueur(p, { lien = false } = {}) {
  const arme = OBJETS[p.arme] || OBJETS.epee_courte;
  const armure = OBJETS[p.armure] || OBJETS.tunique_toile;
  const plus = plusArme(p.guild_id, p.user_id, p.arme);
  const dual = uniquesDe(p.guild_id, p.user_id).includes('dual_blades');
  const repas = p.repas && p.repas_reste > 0 ? OBJETS[p.repas]?.bonus || {} : {};
  const bonusAtk = (repas.atk || 0) + (lien ? 0.1 : 0) + (dual ? 0.1 : 0);
  return {
    niveau: p.level,
    arme,
    armure,
    plus,
    famille: arme.famille || 'epee',
    dual,
    lien,
    repas,
    atk: F.atkDe(p.level, arme.atk || 0, plus, bonusAtk),
    def: F.defDe(armure.def || 0, repas.def || 0),
    pvMax: F.pvMaxDe(p.level, armure.pv || 0),
    skills: C.skillsDisponibles(p.level, arme.famille || 'epee', dual),
  };
}

// Charge un personnage, applique la régénération (2 %/min hors combat) et
// le recale sur ses PV max. null s'il n'existe pas.
function chargerJoueur(guildId, userId, now) {
  const p = normaliser(getPlayer(guildId, userId));
  if (!p) return null;
  const t = maintenant(now);
  const s = statsJoueur(p);
  const combat = combatActif(p.guild_id, p.user_id);
  // Un combat abandonné (30 min sans clic) ne fige plus la régénération.
  const enCombat = Boolean(combat) && t - combat.maj_le <= ABANDON_MS;
  const avant = p.hp;
  if (!enCombat && p.pv_le) {
    const minutes = Math.max(0, (t - Number(p.pv_le)) / 60000);
    p.hp = Math.min(s.pvMax, (p.hp || 0) + Math.floor(minutes * F.REGEN_PAR_MINUTE * s.pvMax));
  }
  p.hp = Math.max(0, Math.min(s.pvMax, p.hp ?? s.pvMax));
  if (!enCombat) p.pv_le = t;
  if (p.hp !== avant || !enCombat) savePlayer(p);
  return p;
}

// ══════════════════════════════════════════════════════════════════
// Inventaire
// ══════════════════════════════════════════════════════════════════

const invGetStmt = db.prepare('SELECT qte FROM sao_inventaire WHERE guild_id = ? AND user_id = ? AND objet = ?');
const invAddStmt = db.prepare(`
  INSERT INTO sao_inventaire (guild_id, user_id, objet, qte) VALUES (?, ?, ?, ?)
  ON CONFLICT (guild_id, user_id, objet) DO UPDATE SET qte = qte + excluded.qte
`);
const invSetStmt = db.prepare('UPDATE sao_inventaire SET qte = ? WHERE guild_id = ? AND user_id = ? AND objet = ?');
const invDelStmt = db.prepare('DELETE FROM sao_inventaire WHERE guild_id = ? AND user_id = ? AND objet = ? AND qte <= 0');
const invListStmt = db.prepare('SELECT objet, qte FROM sao_inventaire WHERE guild_id = ? AND user_id = ? AND qte > 0');

function quantiteSao(guildId, userId, cle) {
  return invGetStmt.get(String(guildId), String(userId), cle)?.qte || 0;
}
function ajouterObjet(guildId, userId, cle, qte = 1) {
  const n = Math.floor(Number(qte));
  if (!OBJETS[cle] || !(n >= 1)) return false;
  invAddStmt.run(String(guildId), String(userId), cle, n);
  return true;
}
function retirerObjet(guildId, userId, cle, qte = 1) {
  const n = Math.floor(Number(qte));
  const a = quantiteSao(guildId, userId, cle);
  if (!(n >= 1) || a < n) return false;
  invSetStmt.run(a - n, String(guildId), String(userId), cle);
  invDelStmt.run(String(guildId), String(userId), cle);
  return true;
}
// L'inventaire trié : par type, puis rareté décroissante, puis nom.
const ORDRE_TYPES = ['consommable', 'repas', 'arme', 'armure', 'materiau', 'ingredient', 'butin'];
function inventaireSao(guildId, userId) {
  return invListStmt.all(String(guildId), String(userId))
    .filter((r) => OBJETS[r.objet])
    .sort((a, b) => {
      const oa = OBJETS[a.objet];
      const ob = OBJETS[b.objet];
      return ORDRE_TYPES.indexOf(oa.type) - ORDRE_TYPES.indexOf(ob.type)
        || D.RARETES[ob.rarete].ordre - D.RARETES[oa.rarete].ordre
        || oa.nom.localeCompare(ob.nom, 'fr');
    });
}

// ══════════════════════════════════════════════════════════════════
// Contrat A
// ══════════════════════════════════════════════════════════════════

// Ajoute (ou retire, si négatif) des Col. Crée le personnage au besoin.
// Le solde ne descend jamais sous zéro. Renvoie le nouveau solde.
function crediterCol(guildId, userId, montant) {
  const { player } = ensurePlayer(guildId, userId);
  const col = Math.max(0, (player.col || 0) + Math.round(Number(montant) || 0));
  setColStmt.run(col, String(guildId), String(userId));
  return col;
}

// Donne `qte` exemplaires d'un objet du catalogue. false si la clé est
// inconnue (ou la quantité invalide). Crée le personnage au besoin.
function donnerObjet(guildId, userId, cle, qte = 1) {
  if (!OBJETS[cle]) return false;
  const n = Math.floor(Number(qte));
  if (!(n >= 1)) return false;
  ensurePlayer(guildId, userId);
  return ajouterObjet(guildId, userId, cle, n);
}

// Ce qu'un autre module peut proposer en récompense (menu de 25 au plus) :
// consommables, ingrédients rares et matériaux — pas d'équipement, qui
// court-circuiterait la forge.
const RECOMPENSABLES = [
  'potion_soin', 'cristal_soin', 'grand_cristal', 'antidote', 'cristal_tp', 'coffre_tresor', 'pierre_ame',
  'ragout_rabbit', 'poisson_dore', 'seigneur_lac', 'lingot_cristallite',
  'croc_loup', 'corne_taurus', 'ecorce_treant', 'soie_araignee', 'minerai_mithril', 'ecaille_wyverne',
  'plume_griffon', 'os_faucheur', 'eclat_obsidienne', 'fragment_rubis', 'brochette', 'ragout_asuna',
];
function objetsRecompensables() {
  return RECOMPENSABLES.filter((k) => OBJETS[k]).slice(0, 25).map((cle) => ({ cle, nom: OBJETS[cle].nom, emoji: OBJETS[cle].emoji }));
}

// ══════════════════════════════════════════════════════════════════
// Badges
// ══════════════════════════════════════════════════════════════════

const hasBadgeStmt = db.prepare('SELECT 1 FROM sao_badges WHERE guild_id = ? AND user_id = ? AND badge = ?');
const addBadgeStmt = db.prepare('INSERT OR IGNORE INTO sao_badges (guild_id, user_id, badge, earned_at) VALUES (?, ?, ?, ?)');
const listBadgesStmt = db.prepare('SELECT badge FROM sao_badges WHERE guild_id = ? AND user_id = ? ORDER BY earned_at');

function ownedBadges(guildId, userId) {
  return listBadgesStmt.all(String(guildId), String(userId)).map((r) => r.badge).filter((k) => BADGES[k]);
}
// Attribue un badge ; true s'il vient d'être débloqué.
function award(guildId, userId, key) {
  if (!BADGES[key]) return false;
  if (hasBadgeStmt.get(String(guildId), String(userId), key)) return false;
  return addBadgeStmt.run(String(guildId), String(userId), key, new Date().toISOString()).changes > 0;
}
// Débloque les badges « à seuil » ; renvoie les clés nouvellement gagnées.
function syncMilestoneBadges(p) {
  const gagnes = [];
  const verifier = (cond, cle) => {
    if (cond && award(p.guild_id, p.user_id, cle)) gagnes.push(cle);
  };
  verifier(p.floor >= 10, 'etage_10');
  verifier(p.floor >= 25, 'etage_25');
  verifier(p.floor >= 50, 'etage_50');
  verifier(p.floor >= 75, 'etage_75');
  verifier(p.floor > MAX_FLOOR, 'clear');
  verifier(p.level >= 20, 'beater');
  verifier(p.col >= 10000, 'riche');
  verifier(plusArme(p.guild_id, p.user_id, p.arme) >= F.PLUS_MAX, 'forgeron');
  verifier(p.morts >= 10, 'revenant');
  verifier(p.serie >= 7, 'fidele');
  verifier(p.pvp_victoires >= 10, 'duelliste');
  return gagnes;
}

// ══════════════════════════════════════════════════════════════════
// Rumeur du jour (Argo)
// ══════════════════════════════════════════════════════════════════

const etageMaxStmt = db.prepare('SELECT MAX(MIN(floor, 100)) AS m FROM sao_players WHERE guild_id = ?');
function rumeurDuJour(guildId, now) {
  const jour = jourSao(now);
  const h = hacher(`${guildId}:${jour}`);
  const cles = Object.keys(D.RUMEURS);
  const cle = cles[h % cles.length];
  const haut = Math.max(1, Math.min(MAX_FLOOR, etageMaxStmt.get(String(guildId))?.m || 1));
  const etage = cle === 'peche' ? D.ETAGE_PECHE : 1 + ((h >>> 8) % haut);
  return { cle, etage, jour, texte: D.RUMEURS[cle].texte.replace('{f}', String(etage)) };
}
const rumeurAide = (r, cle, etage = null) => r.cle === cle && (etage === null || r.etage === etage);

// ══════════════════════════════════════════════════════════════════
// Quêtes du jour
// ══════════════════════════════════════════════════════════════════

const quetesStmt = db.prepare('SELECT * FROM sao_quetes WHERE guild_id = ? AND user_id = ? AND jour = ? ORDER BY rowid');
const queteAddStmt = db.prepare('INSERT OR IGNORE INTO sao_quetes (guild_id, user_id, jour, cle, objectif, progres, faite) VALUES (?, ?, ?, ?, ?, 0, 0)');
const queteMajStmt = db.prepare('UPDATE sao_quetes SET progres = ?, faite = ? WHERE guild_id = ? AND user_id = ? AND jour = ? AND cle = ?');

function texteQuete(q) {
  const def = D.QUETES[q.cle];
  return `${def.emoji} ${def.texte.replace('{n}', String(q.objectif))}`;
}

// Les trois quêtes du jour : tirées une fois, reproductibles.
function quetesDuJour(guildId, userId, now) {
  const g = String(guildId);
  const u = String(userId);
  const jour = jourSao(now);
  const existantes = quetesStmt.all(g, u, jour);
  if (existantes.length) return existantes;
  const p = getPlayer(g, u);
  const R = reglagesSao(g);
  const eligibles = Object.entries(D.QUETES).filter(([, q]) => {
    if (q.cond === 'peche') return (p?.floor || 1) >= D.ETAGE_PECHE;
    if (q.cond === 'raid') return Boolean(R.salonRaid && R.raidHeures > 0);
    if (q.cond === 'pvp') return R.pvp;
    return true;
  }).map(([cle]) => cle);
  const rng = F.aleaGraine(hacher(`${g}:${u}:${jour}`));
  const choisies = [];
  while (choisies.length < 3 && eligibles.length) {
    choisies.push(eligibles.splice(Math.floor(rng() * eligibles.length), 1)[0]);
  }
  for (const cle of choisies) {
    const obj = D.QUETES[cle].objectifs;
    queteAddStmt.run(g, u, jour, cle, obj[Math.floor(rng() * obj.length)]);
  }
  return quetesStmt.all(g, u, jour);
}

// Fait avancer une quête. Mute `p` (récompenses) : l'appelant l'enregistre.
// Renvoie les quêtes accomplies À L'INSTANT, avec leurs récompenses.
function avancerQuete(p, type, n = 1, now) {
  const jour = jourSao(now);
  const quetes = quetesDuJour(p.guild_id, p.user_id, now);
  const q = quetes.find((x) => x.cle === type && !x.faite);
  if (!q) return [];
  const progres = Math.min(q.objectif, q.progres + n);
  const faite = progres >= q.objectif ? 1 : 0;
  queteMajStmt.run(progres, faite, p.guild_id, p.user_id, jour, type);
  if (!faite) return [];
  const g = F.gainsQuete(Math.min(p.floor, MAX_FLOOR));
  p.col += g.col;
  F.ajouterXp(p, g.xp);
  const fini = { cle: type, texte: texteQuete(q), col: g.col, xp: g.xp, xpServeur: 5, coffre: false };
  const toutes = quetesDuJour(p.guild_id, p.user_id, now);
  if (toutes.length && toutes.every((x) => x.faite)) {
    ajouterObjet(p.guild_id, p.user_id, 'coffre_tresor', 1);
    fini.coffre = true;
    fini.xpServeur += 10;
  }
  return [fini];
}

// ══════════════════════════════════════════════════════════════════
// Mort et Monument of Life
// ══════════════════════════════════════════════════════════════════

// La mort coûte TOUJOURS plus cher que l'auberge : des Col (réglage du
// serveur), 20 % de l'XP du niveau, une minute au Monument of Life — et on
// ne revient qu'à 25 % de ses PV. Avec zéro Col, ce n'est donc jamais un
// soin gratuit. La Divine Stone of Returning Soul l'annule entièrement.
function appliquerMort(p, R, now, { pvMax = null } = {}) {
  const t = maintenant(now);
  const max = pvMax || statsJoueur(p).pvMax;
  if (retirerObjet(p.guild_id, p.user_id, 'pierre_ame', 1)) {
    p.hp = max;
    p.pv_le = t;
    return { pierre: true, col: 0, xp: 0 };
  }
  const col = Math.floor(p.col * R.mortPenalite / 100);
  const xp = Math.floor(p.xp * F.XP_PERDUE_MORT);
  p.col -= col;
  p.xp -= xp;
  p.hp = Math.max(1, Math.round(max * F.PV_MORT));
  p.morts += 1;
  p.reapparition = t + REAPPARITION_MS;
  p.pv_le = t;
  return { pierre: false, col, xp, reapparition: p.reapparition };
}

function reapparitionRestante(p, now) {
  return Math.max(0, Number(p.reapparition || 0) - maintenant(now));
}

// ══════════════════════════════════════════════════════════════════
// Chasse
// ══════════════════════════════════════════════════════════════════

function tirerButin(p, etage, rumeur, rng, rare) {
  const butin = {};
  const ajouter = (cle, n = 1) => { butin[cle] = (butin[cle] || 0) + n; };
  const tranche = D.TRANCHES[D.trancheDe(etage)];
  if (rare) ajouter(rare.objet);
  if (rng() < F.CHANCES.materiau) ajouter(tranche.materiau, rumeurAide(rumeur, 'materiaux', etage) ? 2 : 1);
  if (rng() < F.CHANCES.butin) ajouter(tranche.butin);
  if (rng() < F.CHANCES.viande) ajouter('viande_sanglier');
  if (rng() < F.CHANCES.baies) ajouter('baies_floria');
  if (rng() < F.CHANCES.potion) ajouter('potion_soin');
  if (rng() < F.CHANCES.cristal) ajouter('cristal_soin');
  if (rng() < F.CHANCES.coffre) ajouter('coffre_tresor');
  if (rng() < F.CHANCES.teleport) ajouter('cristal_tp');
  for (const [cle, n] of Object.entries(butin)) ajouterObjet(p.guild_id, p.user_id, cle, n);
  return Object.entries(butin).map(([cle, qte]) => ({ cle, qte }));
}

// Une chasse sur l'étage où l'on se trouve. Renvoie { refus, … } ou le récit.
function chasserSao(guildId, userId, { lien = false, now, rng = Math.random } = {}) {
  const t = maintenant(now);
  const R = reglagesSao(guildId);
  const abandon = expirerCombatAbandonne(guildId, userId, t);
  const p = chargerJoueur(guildId, userId, t);
  if (!p) return { refus: 'sans_perso' };
  const combat = combatActif(p.guild_id, p.user_id);
  if (combat && t - combat.maj_le <= ABANDON_MS) return { refus: 'en_combat', combat };
  const attente = reapparitionRestante(p, t);
  if (attente > 0) return { refus: 'reapparition', ms: attente };
  const depuis = t - tempsDe(p.last_hunt);
  if (depuis < R.chasseDelai * 1000) return { refus: 'delai', ms: R.chasseDelai * 1000 - depuis };

  p.last_hunt = iso(t);
  p.last_afk = iso(t); // l'AFK ne compte que le temps passé SANS jouer
  const etage = Math.min(p.position, MAX_FLOOR);
  const s = statsJoueur(p, { lien });
  const rumeur = rumeurDuJour(p.guild_id, t);
  let rare = null;
  for (const r of Object.values(D.RENCONTRES_RARES)) {
    if (etage < r.etageMin) continue;
    const chance = r.chance * (r.objet === 'ragout_rabbit' && rumeurAide(rumeur, 'lapin', etage) ? 5 : 1);
    if (rng() < chance) { rare = r; break; }
  }
  const tranche = D.TRANCHES[D.trancheDe(etage)];
  const type = rare ? { nom: rare.nom, emoji: rare.emoji, pv: 1.4, atk: 1.15 } : tranche.monstres[Math.floor(rng() * tranche.monstres.length)];
  const monstre = F.statsMonstre(etage, type, R.difficulte);
  const r = F.combatChasse({ atk: s.atk, pv: Math.max(1, p.hp), def: s.def }, monstre, rng);
  const recit = { etage, monstre: type, rare: rare ? { ...rare } : null, inflige: r.inflige, subi: r.subi, victoire: r.victoire, abandon };

  if (!r.victoire) {
    recit.mort = appliquerMort(p, R, t, { pvMax: s.pvMax });
    if (recit.mort.pierre) recit.victoire = false;
    recit.badges = syncMilestoneBadges(p);
    savePlayer(p);
    recit.joueur = p;
    recit.pvMax = s.pvMax;
    return recit;
  }

  p.hp = r.pv;
  const k = F.difficulteSao(R.difficulte).gains;
  const bonusXp = (s.repas.xp || 0) + (lien ? 0.1 : 0) + (rumeurAide(rumeur, 'xp', etage) ? 0.25 : 0);
  const bonusCol = (s.repas.col || 0) + (rumeurAide(rumeur, 'col', etage) ? 0.25 : 0);
  recit.xp = Math.round(F.xpChasse(etage) * (0.9 + rng() * 0.2) * k * (1 + bonusXp));
  recit.col = Math.round(F.colChasse(etage) * (0.9 + rng() * 0.2) * k * (1 + bonusCol));
  p.col += recit.col;
  const niveauAvant = p.level;
  recit.niveaux = F.ajouterXp(p, recit.xp);
  const pvMax = statsJoueur(p, { lien }).pvMax;
  if (recit.niveaux) p.hp = Math.min(pvMax, p.hp + Math.round(pvMax * 0.2 * recit.niveaux));
  recit.niveauAvant = niveauAvant;
  p.monstres += 1;
  if (p.repas) {
    p.repas_reste -= 1;
    if (p.repas_reste <= 0) {
      recit.repasFini = p.repas;
      p.repas = null;
      p.repas_reste = 0;
    }
  }
  recit.butin = tirerButin(p, etage, rumeur, rng, rare);
  recit.quetes = avancerQuete(p, 'tuer', 1, t);
  recit.badges = [award(p.guild_id, p.user_id, 'premier_sang') ? 'premier_sang' : null, ...syncMilestoneBadges(p)].filter(Boolean);
  savePlayer(p);
  recit.joueur = p;
  recit.pvMax = pvMax;
  return recit;
}

// ══════════════════════════════════════════════════════════════════
// Combat de boss (persisté : sao_combats)
// ══════════════════════════════════════════════════════════════════

const combatActifStmt = db.prepare("SELECT * FROM sao_combats WHERE guild_id = ? AND user_id = ? AND statut = 'en_cours' ORDER BY id DESC LIMIT 1");
const combatParIdStmt = db.prepare('SELECT * FROM sao_combats WHERE id = ?');
const combatAddStmt = db.prepare("INSERT INTO sao_combats (guild_id, user_id, etage, etat, statut, cree_le, maj_le) VALUES (?, ?, ?, ?, 'en_cours', ?, ?)");
const combatMajStmt = db.prepare('UPDATE sao_combats SET etat = ?, statut = ?, maj_le = ? WHERE id = ?');

const lireCombat = (row) => (row ? { ...row, etat: JSON.parse(row.etat) } : null);
function combatActif(guildId, userId) {
  return lireCombat(combatActifStmt.get(String(guildId), String(userId)));
}
function combatParId(id) {
  return lireCombat(combatParIdStmt.get(Number(id)));
}

// Un combat laissé sans clic depuis 30 minutes compte comme une fuite SANS
// cristal : on ne contourne plus la pénalité en abandonnant le message.
// Les PV, eux, ont été enregistrés à chaque tour.
function expirerCombatAbandonne(guildId, userId, now) {
  const t = maintenant(now);
  const c = combatActif(guildId, userId);
  if (!c || t - c.maj_le <= ABANDON_MS) return null;
  const p = normaliser(getPlayer(guildId, userId));
  const R = reglagesSao(guildId);
  let perte = 0;
  if (p) {
    perte = Math.floor(p.col * R.mortPenalite / 200);
    p.col -= perte;
    p.hp = Math.max(1, c.etat.jPv);
    p.pv_le = t;
    savePlayer(p);
  }
  combatMajStmt.run(JSON.stringify(c.etat), 'abandon', t, c.id);
  return { combat: c, perte };
}

// Ouvre (ou reprend) le combat contre le boss de l'étage le plus haut.
function commencerBoss(guildId, userId, { lien = false, now } = {}) {
  const t = maintenant(now);
  const abandon = expirerCombatAbandonne(guildId, userId, t);
  const p = chargerJoueur(guildId, userId, t);
  if (!p) return { refus: 'sans_perso' };
  const actif = combatActif(p.guild_id, p.user_id);
  // ⚠️ Jamais d'écrasement : relancer /sao boss REPREND le combat en cours,
  // avec les mêmes PV des deux côtés. C'est ce qui rendait la défaite
  // contournable.
  if (actif) return { combat: actif, repris: true, abandon, joueur: p };
  if (p.floor > MAX_FLOOR) return { refus: 'conquis' };
  const attente = reapparitionRestante(p, t);
  if (attente > 0) return { refus: 'reapparition', ms: attente };
  const R = reglagesSao(p.guild_id);
  const etage = p.floor;
  const s = statsJoueur(p, { lien });
  const etat = C.nouveauCombat({
    etage,
    boss: D.bossDe(etage),
    statsBoss: F.statsBoss(etage, R.difficulte),
    joueur: { pv: Math.max(1, p.hp), pvMax: s.pvMax, atk: s.atk, def: s.def, skills: s.skills },
    argo: Number(p.argo_etage) === etage,
    antiCristal: D.salleAntiCristal(etage),
  });
  const id = Number(combatAddStmt.run(p.guild_id, p.user_id, etage, JSON.stringify(etat), t, t).lastInsertRowid);
  p.position = Math.min(etage, MAX_FLOOR);
  p.last_afk = iso(t);
  savePlayer(p);
  return { combat: combatParId(id), repris: false, abandon, joueur: p };
}

// Joue un tour. `tour` : le numéro de tour porté par le bouton cliqué ; un
// message périmé (autre tour) ne joue rien et se resynchronise.
// action.type : 'attaque' | 'garde' | 'skill' | 'objet' | 'fuir'
function jouerTourSao(idCombat, userId, action, { tour = null, now, rng = Math.random, lien = false } = {}) {
  const t = maintenant(now);
  const c = combatParId(idCombat);
  if (!c) return { refus: 'introuvable' };
  if (c.user_id !== String(userId)) return { refus: 'pas_a_toi', combat: c };
  if (c.statut !== 'en_cours') return { refus: 'termine', combat: c };
  if (t - c.maj_le > ABANDON_MS) {
    const ab = expirerCombatAbandonne(c.guild_id, c.user_id, t);
    return { refus: 'abandonne', combat: combatParId(c.id), perte: ab?.perte || 0 };
  }
  const etat = c.etat;
  if (tour !== null && Number(tour) !== etat.tour) return { refus: 'perime', combat: c };
  const R = reglagesSao(c.guild_id);
  const p = normaliser(getPlayer(c.guild_id, c.user_id));
  if (!p) return { refus: 'sans_perso' };

  if (action.type === 'fuir') {
    const cristal = !etat.antiCristal && retirerObjet(p.guild_id, p.user_id, 'cristal_tp', 1);
    const perte = cristal ? 0 : Math.floor(p.col * R.mortPenalite / 200);
    p.col -= perte;
    p.hp = Math.max(1, etat.jPv);
    p.pv_le = t;
    p.last_afk = iso(t);
    savePlayer(p);
    combatMajStmt.run(JSON.stringify(etat), 'fui', t, c.id);
    return { fin: 'fuite', cristal, perte, antiCristal: etat.antiCristal, combat: combatParId(c.id), joueur: p };
  }

  let objet = null;
  if (action.type === 'objet') {
    objet = OBJETS[action.cle];
    if (!objet || quantiteSao(p.guild_id, p.user_id, action.cle) < 1) return { refus: 'sans_objet', combat: c };
  }
  const r = C.jouerTourBoss(etat, { type: action.type, cle: action.cle, objet }, rng);
  if (r.refus) return { refus: 'action', message: r.refus, combat: c };
  if (objet) retirerObjet(p.guild_id, p.user_id, action.cle, 1);

  const sortie = { fin: r.fin, lignes: r.lignes, quetes: [], badges: [] };
  if (action.type === 'skill') sortie.quetes.push(...avancerQuete(p, 'skills', 1, t));
  p.last_afk = iso(t);

  if (r.fin === 'defaite') {
    const mort = appliquerMort(p, R, t, { pvMax: etat.jMax });
    if (mort.pierre) {
      // La pierre ramène à la vie dans les dix secondes : le combat continue.
      etat.jPv = etat.jMax;
      etat.journal[etat.journal.length - 1].lignes.push('✨ La **Divine Stone of Returning Soul** se brise : tu te relèves, PV pleins !');
      sortie.fin = null;
      sortie.pierre = true;
    } else {
      sortie.mort = mort;
      sortie.badges.push(...syncMilestoneBadges(p));
    }
  } else {
    p.hp = Math.max(1, etat.jPv);
  }

  if (r.fin === 'victoire') Object.assign(sortie, victoireBoss(p, etat, R, t, { lien }));

  const statut = sortie.fin === 'victoire' ? 'gagne' : sortie.fin === 'defaite' ? 'perdu' : 'en_cours';
  savePlayer(p);
  combatMajStmt.run(JSON.stringify(etat), statut, t, c.id);
  sortie.combat = combatParId(c.id);
  sortie.joueur = p;
  return sortie;
}

// Les récompenses d'un boss vaincu. Mute `p`.
function victoireBoss(p, etat, R, now, { lien = false } = {}) {
  const etage = etat.etage;
  const g = F.gainsBoss(etage);
  const k = F.difficulteSao(R.difficulte).gains;
  const r = {
    col: Math.round(g.col * k),
    xp: Math.round(g.xp * k * (lien ? 1.1 : 1)),
    xpServeur: g.xpServeur,
    lab: null,
    unique: null,
    badges: [],
    quetes: [],
  };
  p.col += r.col;
  r.niveaux = F.ajouterXp(p, r.xp);
  p.floor = Math.max(p.floor, etage + 1);
  p.position = Math.min(p.floor, MAX_FLOOR);
  p.boss_vaincus += 1;
  p.argo_etage = null;
  p.hp = statsJoueur(p, { lien }).pvMax; // repos complet en ville après un boss
  p.pv_le = now;
  // Last Attack Bonus : en solo, le dernier coup est toujours le tien.
  if (etat.boss.lab && OBJETS[etat.boss.lab]) {
    ajouterObjet(p.guild_id, p.user_id, etat.boss.lab, 1);
    r.lab = etat.boss.lab;
    if (award(p.guild_id, p.user_id, 'lab')) r.badges.push('lab');
  }
  // Compétence unique : le PREMIER du serveur à vaincre l'étage 74.
  for (const [cle, u] of Object.entries(D.UNIQUES)) {
    if (u.etage !== etage || detenteurUnique(p.guild_id, cle)) continue;
    if (setUniqueStmt.run(p.guild_id, cle, p.user_id, new Date(now).toISOString()).changes > 0) {
      r.unique = cle;
      if (award(p.guild_id, p.user_id, 'epeiste_noir')) r.badges.push('epeiste_noir');
    }
  }
  if (award(p.guild_id, p.user_id, 'boss_slayer')) r.badges.push('boss_slayer');
  r.badges.push(...syncMilestoneBadges(p));
  r.quetes.push(...avancerQuete(p, 'boss', 1, now));
  r.clear = p.floor > MAX_FLOOR;
  return r;
}

// ══════════════════════════════════════════════════════════════════
// Auberge, AFK, voyage
// ══════════════════════════════════════════════════════════════════

function soignerAuberge(guildId, userId, { now } = {}) {
  const t = maintenant(now);
  const p = chargerJoueur(guildId, userId, t);
  if (!p) return { refus: 'sans_perso' };
  if (combatActif(p.guild_id, p.user_id)) return { refus: 'en_combat' };
  const s = statsJoueur(p);
  const manquant = s.pvMax - p.hp;
  if (manquant <= 0) return { refus: 'plein', joueur: p, pvMax: s.pvMax };
  const cout = F.coutAuberge(Math.min(p.floor, MAX_FLOOR), manquant, s.pvMax);
  if (p.col < cout) return { refus: 'fonds', cout, joueur: p, pvMax: s.pvMax };
  p.col -= cout;
  p.hp = s.pvMax;
  savePlayer(p);
  return { cout, joueur: p, pvMax: s.pvMax };
}

// L'AFK ne compte que le temps passé SANS jouer : chaque action remet le
// compteur à zéro. Il ne rapporte aucune XP serveur (elle récompense la
// présence sur le serveur, pas l'absence).
function recolterAfk(guildId, userId, { now } = {}) {
  const t = maintenant(now);
  const R = reglagesSao(guildId);
  if (!R.afk) return { refus: 'coupe' };
  const p = chargerJoueur(guildId, userId, t);
  if (!p) return { refus: 'sans_perso' };
  const minutes = Math.min(R.afkHeures * 60, Math.max(0, (t - (tempsDe(p.last_afk) || t)) / 60000));
  if (minutes < AFK_MIN_MIN) return { refus: 'trop_tot', minutes: Math.floor(minutes), minimum: AFK_MIN_MIN };
  const etage = Math.min(p.position, MAX_FLOOR);
  const parMin = F.gainsAfkParMinute(etage);
  const k = F.difficulteSao(R.difficulte).gains;
  const xp = Math.floor(minutes * parMin.xp * k);
  const col = Math.floor(minutes * parMin.col * k);
  p.col += col;
  const niveaux = F.ajouterXp(p, xp);
  const mat = D.TRANCHES[D.trancheDe(etage)].materiau;
  const mats = Math.min(16, Math.floor(minutes / 30));
  if (mats) ajouterObjet(p.guild_id, p.user_id, mat, mats);
  p.last_afk = iso(t);
  const badges = syncMilestoneBadges(p);
  savePlayer(p);
  return { minutes: Math.floor(minutes), plafond: R.afkHeures * 60, xp, col, niveaux, materiau: mats ? { cle: mat, qte: mats } : null, badges, joueur: p };
}

function voyagerSao(guildId, userId, etage, { now } = {}) {
  const p = chargerJoueur(guildId, userId, now);
  if (!p) return { refus: 'sans_perso' };
  if (combatActif(p.guild_id, p.user_id)) return { refus: 'en_combat' };
  const haut = Math.min(p.floor, MAX_FLOOR);
  const cible = Math.floor(Number(etage));
  if (!(cible >= 1 && cible <= haut)) return { refus: 'verrouille', haut };
  if (cible === p.position) return { refus: 'deja', joueur: p };
  p.position = cible;
  savePlayer(p);
  return { joueur: p, etage: cible, ...D.villeDe(cible) };
}

// ══════════════════════════════════════════════════════════════════
// Agil : boutique
// ══════════════════════════════════════════════════════════════════

function prixAchat(cle, etage) {
  return D.BOUTIQUE.includes(cle) ? F.prixBoutique(OBJETS[cle], Math.min(etage, MAX_FLOOR)) : null;
}
function prixRevente(guildId, cle, now) {
  const o = OBJETS[cle];
  if (!o) return 0;
  const bonus = o.type === 'butin' && rumeurAide(rumeurDuJour(guildId, now), 'agil') ? 0.2 : 0;
  return F.prixVente(o, bonus);
}

function acheterSao(guildId, userId, cle, qte = 1) {
  const p = chargerJoueur(guildId, userId);
  if (!p) return { refus: 'sans_perso' };
  const n = Math.floor(Number(qte));
  if (!D.BOUTIQUE.includes(cle)) return { refus: 'inconnu' };
  if (!(n >= 1 && n <= 99)) return { refus: 'quantite' };
  const total = prixAchat(cle, p.floor) * n;
  if (p.col < total) return { refus: 'fonds', total, joueur: p };
  p.col -= total;
  ajouterObjet(p.guild_id, p.user_id, cle, n);
  savePlayer(p);
  return { cle, qte: n, total, joueur: p };
}

function vendreSao(guildId, userId, cle, qte = 1, { now } = {}) {
  const p = chargerJoueur(guildId, userId, now);
  if (!p) return { refus: 'sans_perso' };
  const o = OBJETS[cle];
  if (!o) return { refus: 'inconnu' };
  const possede = quantiteSao(p.guild_id, p.user_id, cle);
  const n = qte === 'tout' ? possede : Math.floor(Number(qte));
  if (!(n >= 1)) return { refus: 'quantite' };
  if (possede < n) return { refus: 'manque', possede };
  const total = prixRevente(p.guild_id, cle, now) * n;
  retirerObjet(p.guild_id, p.user_id, cle, n);
  p.col += total;
  const quetes = avancerQuete(p, 'vendre', n, now);
  const badges = syncMilestoneBadges(p);
  savePlayer(p);
  return { cle, qte: n, total, quetes, badges, joueur: p };
}

// Vend tout le butin (trophées), jamais les matériaux ni l'équipement.
function vendreButin(guildId, userId, { now } = {}) {
  const p = chargerJoueur(guildId, userId, now);
  if (!p) return { refus: 'sans_perso' };
  const lots = inventaireSao(p.guild_id, p.user_id).filter((r) => OBJETS[r.objet].type === 'butin');
  if (!lots.length) return { refus: 'vide' };
  let total = 0;
  let nombre = 0;
  for (const l of lots) {
    total += prixRevente(p.guild_id, l.objet, now) * l.qte;
    nombre += l.qte;
    retirerObjet(p.guild_id, p.user_id, l.objet, l.qte);
  }
  p.col += total;
  const quetes = avancerQuete(p, 'vendre', nombre, now);
  const badges = syncMilestoneBadges(p);
  savePlayer(p);
  return { total, nombre, lots, quetes, badges, joueur: p };
}

// ══════════════════════════════════════════════════════════════════
// Lisbeth : forge
// ══════════════════════════════════════════════════════════════════

function manques(p, mats, col) {
  const liste = [];
  if (p.col < col) liste.push({ cle: 'col', manque: col - p.col });
  for (const [cle, n] of Object.entries(mats || {})) {
    const a = quantiteSao(p.guild_id, p.user_id, cle);
    if (a < n) liste.push({ cle, manque: n - a });
  }
  return liste;
}

// Ce que Lisbeth propose : le palier suivant, en épée, en rapière et en
// armure, plus l'amélioration de l'arme portée.
function offresForge(p, { now } = {}) {
  const arme = OBJETS[p.arme];
  const armure = OBJETS[p.armure];
  const offres = {};
  const palierArme = Math.floor(arme.palier || 0);
  for (const famille of ['epee', 'rapiere']) {
    const cle = D.ARMES_PAR_FAMILLE[famille][palierArme + 1];
    if (!cle) continue;
    const o = OBJETS[cle];
    const col = F.coutForge(o);
    offres[famille] = { cle, objet: o, col, mats: o.mats, verrou: o.etage > p.floor ? o.etage : null, manques: manques(p, o.mats, col) };
  }
  const cleArmure = D.ARMURES[Math.floor(armure.palier || 0) + 1];
  if (cleArmure) {
    const o = OBJETS[cleArmure];
    const col = F.coutForge(o);
    offres.armure = { cle: cleArmure, objet: o, col, mats: o.mats, verrou: o.etage > p.floor ? o.etage : null, manques: manques(p, o.mats, col) };
  }
  const plus = plusArme(p.guild_id, p.user_id, p.arme);
  if (palierArme > 0 && plus < F.PLUS_MAX) {
    const c = F.coutAmelioration(arme, plus);
    const bonus = rumeurAide(rumeurDuJour(p.guild_id, now), 'forge') ? 10 : 0;
    offres.amelioration = { plus, col: c.col, mats: c.mats, taux: F.tauxAmelioration(plus, bonus), manques: manques(p, c.mats, c.col) };
  }
  return offres;
}

// Forge une arme ou une armure du palier suivant et l'équipe ; l'ancienne
// rejoint l'inventaire (revendable chez Agil, rééquipable).
function forgerSao(guildId, userId, cle, { now } = {}) {
  const t = maintenant(now);
  const p = chargerJoueur(guildId, userId, t);
  if (!p) return { refus: 'sans_perso' };
  const offres = offresForge(p, { now: t });
  const offre = Object.values(offres).find((o) => o.cle === cle);
  if (!offre) return { refus: 'inconnu' };
  if (offre.verrou) return { refus: 'verrou', etage: offre.verrou };
  if (offre.manques.length) return { refus: 'manque', manques: offre.manques, offre };
  p.col -= offre.col;
  for (const [m, n] of Object.entries(offre.mats || {})) retirerObjet(p.guild_id, p.user_id, m, n);
  const slot = offre.objet.type === 'armure' ? 'armure' : 'arme';
  const ancien = p[slot];
  if (ancien && OBJETS[ancien] && OBJETS[ancien].palier > 0) ajouterObjet(p.guild_id, p.user_id, ancien, 1);
  p[slot] = cle;
  const quetes = avancerQuete(p, 'forger', 1, t);
  const badges = syncMilestoneBadges(p);
  savePlayer(p);
  return { cle, objet: offre.objet, col: offre.col, ancien, quetes, badges, joueur: p };
}

// Amélioration +1, avec un taux de réussite. Un échec coûte les matériaux
// et le Col, mais jamais l'amélioration déjà acquise.
function ameliorerSao(guildId, userId, { now, rng = Math.random } = {}) {
  const t = maintenant(now);
  const p = chargerJoueur(guildId, userId, t);
  if (!p) return { refus: 'sans_perso' };
  const o = offresForge(p, { now: t }).amelioration;
  if (!o) return { refus: plusArme(p.guild_id, p.user_id, p.arme) >= F.PLUS_MAX ? 'max' : 'impossible' };
  if (o.manques.length) return { refus: 'manque', manques: o.manques, offre: o };
  p.col -= o.col;
  for (const [m, n] of Object.entries(o.mats)) retirerObjet(p.guild_id, p.user_id, m, n);
  const reussi = rng() * 100 < o.taux;
  const plus = reussi ? o.plus + 1 : o.plus;
  if (reussi) setPlusStmt.run(p.guild_id, p.user_id, p.arme, plus);
  const quetes = avancerQuete(p, 'forger', 1, t);
  const badges = syncMilestoneBadges(p);
  savePlayer(p);
  return { reussi, plus, taux: o.taux, col: o.col, quetes, badges, joueur: p };
}

// ══════════════════════════════════════════════════════════════════
// Argo : renseignement sur le boss
// ══════════════════════════════════════════════════════════════════

function infoBoss(p) {
  const R = reglagesSao(p.guild_id);
  const etage = Math.min(p.floor, MAX_FLOOR);
  const boss = D.bossDe(etage);
  const s = F.statsBoss(etage, R.difficulte);
  return {
    etage, boss, pv: s.pv, atk: s.atk, venimeux: etage % 2 === 0, antiCristal: D.salleAntiCristal(etage),
    niveauConseille: F.niveauConseille(etage), palierConseille: F.palierConseille(etage), prix: F.prixRenseignement(etage),
    achete: Number(p.argo_etage) === etage,
  };
}

function acheterRenseignement(guildId, userId) {
  const p = chargerJoueur(guildId, userId);
  if (!p) return { refus: 'sans_perso' };
  if (p.floor > MAX_FLOOR) return { refus: 'conquis' };
  const info = infoBoss(p);
  if (info.achete) return { refus: 'deja', info };
  if (combatActif(p.guild_id, p.user_id)) return { refus: 'en_combat' };
  if (p.col < info.prix) return { refus: 'fonds', info };
  p.col -= info.prix;
  p.argo_etage = info.etage;
  savePlayer(p);
  return { info: { ...info, achete: true }, joueur: p };
}

// ══════════════════════════════════════════════════════════════════
// Quotidienne
// ══════════════════════════════════════════════════════════════════

function reclamerQuotidien(guildId, userId, { now } = {}) {
  const t = maintenant(now);
  const p = chargerJoueur(guildId, userId, t);
  if (!p) return { refus: 'sans_perso' };
  const jour = jourSao(t);
  if (p.quotidien_jour === jour) return { refus: 'deja', ms: msAvantMinuit(t), serie: p.serie };
  p.serie = p.quotidien_jour === veilleDe(jour) ? p.serie + 1 : 1;
  p.quotidien_jour = jour;
  const R = reglagesSao(p.guild_id);
  const g = F.gainsQuotidien(Math.min(p.floor, MAX_FLOOR), p.serie);
  const k = F.difficulteSao(R.difficulte).gains;
  const col = Math.round(g.col * k);
  const xp = Math.round(g.xp * k);
  p.col += col;
  const niveaux = F.ajouterXp(p, xp);
  const objets = [{ cle: 'potion_soin', qte: 2 }, { cle: 'cristal_soin', qte: 1 }];
  if (p.serie % 7 === 0) objets.push({ cle: 'coffre_tresor', qte: 1 });
  if (p.serie % 30 === 0) objets.push({ cle: 'pierre_ame', qte: 1 });
  for (const o of objets) ajouterObjet(p.guild_id, p.user_id, o.cle, o.qte);
  const badges = syncMilestoneBadges(p);
  savePlayer(p);
  return { col, xp, niveaux, serie: p.serie, objets, badges, xpServeur: 10, joueur: p };
}

// ══════════════════════════════════════════════════════════════════
// Pêche (étage 22) et cuisine
// ══════════════════════════════════════════════════════════════════

// Lance la ligne : le poisson mordra dans 2 à 6 secondes. Le jeton, porté
// par le bouton « Ferrer », empêche de ferrer avec un vieux message.
function lancerPeche(guildId, userId, { now, rng = Math.random } = {}) {
  const t = maintenant(now);
  const p = chargerJoueur(guildId, userId, t);
  if (!p) return { refus: 'sans_perso' };
  if (p.floor < D.ETAGE_PECHE) return { refus: 'verrouille' };
  if (p.position !== D.ETAGE_PECHE) return { refus: 'ailleurs', position: p.position };
  if (combatActif(p.guild_id, p.user_id)) return { refus: 'en_combat' };
  const attente = Math.max(reapparitionRestante(p, t), PECHE_DELAI_MS - (t - Number(p.peche_le || 0)));
  if (attente > 0) return { refus: 'delai', ms: attente };
  p.peche_jeton = 1 + Math.floor(rng() * 999998);
  p.peche_morsure = t + 2000 + Math.floor(rng() * 4000);
  p.peche_le = t;
  p.last_afk = iso(t);
  savePlayer(p);
  return { jeton: p.peche_jeton, morsure: p.peche_morsure, joueur: p };
}

// Ferre : trop tôt, le poisson file ; trop tard (3 s), il a mangé l'appât.
// Plus on est vif, plus les prises rares sont possibles.
function ferrerSao(guildId, userId, jeton, { now, rng = Math.random } = {}) {
  const t = maintenant(now);
  const p = chargerJoueur(guildId, userId, t);
  if (!p) return { refus: 'sans_perso' };
  if (!p.peche_jeton || Number(jeton) !== Number(p.peche_jeton)) return { refus: 'perime' };
  const delta = t - Number(p.peche_morsure);
  p.peche_jeton = null;
  p.peche_morsure = null;
  if (delta < 0) {
    savePlayer(p);
    return { resultat: 'trop_tot', avance: -delta, joueur: p };
  }
  if (delta > PECHE_TROP_TARD_MS) {
    savePlayer(p);
    return { resultat: 'trop_tard', retard: delta, joueur: p };
  }
  const rumeur = rumeurDuJour(p.guild_id, t);
  const possibles = D.PRISES.filter((x) => delta <= x.fenetre)
    .map((x) => ({ ...x, poids: x.poids * (OBJETS[x.objet].rarete !== 'commun' && rumeurAide(rumeur, 'peche') ? 2 : 1) }));
  const total = possibles.reduce((s, x) => s + x.poids, 0);
  let tirage = rng() * total;
  let prise = possibles[possibles.length - 1];
  for (const x of possibles) {
    tirage -= x.poids;
    if (tirage <= 0) { prise = x; break; }
  }
  ajouterObjet(p.guild_id, p.user_id, prise.objet, 1);
  p.poissons += 1;
  const badges = [];
  if (prise.objet === 'seigneur_lac' && award(p.guild_id, p.user_id, 'pecheur')) badges.push('pecheur');
  const quetes = avancerQuete(p, 'pecher', 1, t);
  savePlayer(p);
  return { resultat: 'prise', objet: prise.objet, delta, quetes, badges, joueur: p };
}

function cuisinerSao(guildId, userId, recette, { now } = {}) {
  const p = chargerJoueur(guildId, userId, now);
  if (!p) return { refus: 'sans_perso' };
  const r = D.RECETTES[recette];
  if (!r) return { refus: 'inconnu' };
  const manquants = Object.entries(r.ingredients)
    .map(([cle, n]) => ({ cle, manque: n - quantiteSao(p.guild_id, p.user_id, cle) }))
    .filter((x) => x.manque > 0);
  if (manquants.length) return { refus: 'manque', manques: manquants };
  for (const [cle, n] of Object.entries(r.ingredients)) retirerObjet(p.guild_id, p.user_id, cle, n);
  ajouterObjet(p.guild_id, p.user_id, r.plat, 1);
  const badges = [];
  if (r.plat === 'ragout_asuna' && award(p.guild_id, p.user_id, 'cuisinier')) badges.push('cuisinier');
  const quetes = avancerQuete(p, 'cuisiner', 1, now);
  savePlayer(p);
  return { plat: r.plat, quetes, badges, joueur: p };
}

// ══════════════════════════════════════════════════════════════════
// Utiliser un objet hors combat
// ══════════════════════════════════════════════════════════════════

function utiliserObjet(guildId, userId, cle, { now, rng = Math.random } = {}) {
  const t = maintenant(now);
  const p = chargerJoueur(guildId, userId, t);
  if (!p) return { refus: 'sans_perso' };
  const o = OBJETS[cle];
  if (!o) return { refus: 'inconnu' };
  if (quantiteSao(p.guild_id, p.user_id, cle) < 1) return { refus: 'manque' };
  const s = statsJoueur(p);
  const sortie = { cle, objet: o, joueur: p };

  if (o.type === 'arme' || o.type === 'armure') {
    if (combatActif(p.guild_id, p.user_id)) return { refus: 'en_combat' };
    const slot = o.type === 'armure' ? 'armure' : 'arme';
    retirerObjet(p.guild_id, p.user_id, cle, 1);
    const ancien = p[slot];
    if (ancien && OBJETS[ancien] && (OBJETS[ancien].palier > 0 || OBJETS[ancien].lab)) ajouterObjet(p.guild_id, p.user_id, ancien, 1);
    p[slot] = cle;
    const nouveau = statsJoueur(p);
    p.hp = Math.min(p.hp, nouveau.pvMax);
    savePlayer(p);
    return { ...sortie, equipe: slot, ancien, stats: nouveau };
  }
  if (o.type === 'repas') {
    retirerObjet(p.guild_id, p.user_id, cle, 1);
    p.repas = cle;
    p.repas_reste = o.duree;
    savePlayer(p);
    return { ...sortie, repas: true };
  }
  if (o.coffre) {
    retirerObjet(p.guild_id, p.user_id, cle, 1);
    const etage = Math.min(p.position, MAX_FLOOR);
    const col = Math.round(10 * F.colChasse(etage) * (0.5 + rng()));
    p.col += col;
    const contenu = [{ cle: D.TRANCHES[D.trancheDe(etage)].materiau, qte: 2 + Math.floor(rng() * 3) }];
    if (rng() < 0.3) contenu.push({ cle: 'potion_soin', qte: 2 });
    if (rng() < 0.12) contenu.push({ cle: 'cristal_soin', qte: 1 });
    if (rng() < 0.05) contenu.push({ cle: 'cristal_tp', qte: 1 });
    if (rng() < 0.02) contenu.push({ cle: 'grand_cristal', qte: 1 });
    for (const c of contenu) ajouterObjet(p.guild_id, p.user_id, c.cle, c.qte);
    const badges = syncMilestoneBadges(p);
    savePlayer(p);
    return { ...sortie, coffre: { col, contenu }, badges };
  }
  if (o.soin) {
    if (o.cristal && combatActif(p.guild_id, p.user_id)) return { refus: 'en_combat' };
    if (p.hp >= s.pvMax) return { refus: 'plein' };
    retirerObjet(p.guild_id, p.user_id, cle, 1);
    const avant = p.hp;
    p.hp = Math.min(s.pvMax, p.hp + Math.round(s.pvMax * o.soin));
    savePlayer(p);
    return { ...sortie, soin: p.hp - avant, pvMax: s.pvMax };
  }
  if (o.antidote) return { refus: 'antidote' };
  if (o.fuite) return { refus: 'teleport' };
  if (o.resurrection) return { refus: 'passif' };
  return { refus: 'inutilisable' };
}

// ══════════════════════════════════════════════════════════════════
// Duels (First Strike, sur consentement)
// ══════════════════════════════════════════════════════════════════

const duelAddStmt = db.prepare("INSERT INTO sao_duels (guild_id, a, b, statut, cree_le) VALUES (?, ?, ?, 'attente', ?)");
const duelGetStmt = db.prepare('SELECT * FROM sao_duels WHERE id = ?');
const duelMajStmt = db.prepare('UPDATE sao_duels SET statut = ?, vainqueur = ?, journal = ? WHERE id = ?');
const duelEnAttenteStmt = db.prepare("SELECT * FROM sao_duels WHERE guild_id = ? AND statut = 'attente' AND ((a = ? AND b = ?) OR (a = ? AND b = ?)) AND cree_le > ?");

function duelParId(id) {
  return duelGetStmt.get(Number(id)) || null;
}

function proposerDuel(guildId, a, b, { now } = {}) {
  const t = maintenant(now);
  const R = reglagesSao(guildId);
  if (!R.pvp) return { refus: 'pvp_coupe' };
  if (String(a) === String(b)) return { refus: 'soi' };
  if (!getPlayer(guildId, a)) return { refus: 'sans_perso' };
  if (!getPlayer(guildId, b)) return { refus: 'adversaire_sans_perso' };
  if (duelEnAttenteStmt.get(String(guildId), String(a), String(b), String(b), String(a), t - DUEL_EXPIRATION_MS)) return { refus: 'deja' };
  const id = Number(duelAddStmt.run(String(guildId), String(a), String(b), t).lastInsertRowid);
  return { id, duel: duelParId(id) };
}

// First Strike : on se rend coup pour coup ; le premier à faire tomber
// l'autre sous 50 % de ses PV l'emporte. Personne ne perd de Col ni de PV.
function simulerDuelSao(sa, sb, rng = Math.random) {
  const pv = [sa.pvMax, sb.pvMax];
  const stats = [sa, sb];
  const journal = [];
  let tour = rng() < 0.5 ? 0 : 1;
  journal.push(`⚔️ ${tour === 0 ? '{a}' : '{b}'} engage le premier.`);
  for (let i = 0; i < 80; i++) {
    const att = stats[tour];
    const def = stats[1 - tour];
    const c = F.coupSao(att.atk, rng);
    const d = Math.max(1, Math.round(c.degats * F.reductionArmure(def.def)));
    pv[1 - tour] -= d;
    const nom = tour === 0 ? '{a}' : '{b}';
    if (c.crit) journal.push(`💥 Coup critique de ${nom} : **${d}**.`);
    if (pv[1 - tour] <= def.pvMax / 2) {
      journal.push(`🏁 ${nom} porte le coup décisif (**${d}**).`);
      return { vainqueur: tour === 0 ? 'a' : 'b', journal: journal.slice(0, 2).concat(journal.slice(-3)).filter((l, k, t) => t.indexOf(l) === k).slice(0, 5) };
    }
    tour = 1 - tour;
  }
  return { vainqueur: pv[0] / sa.pvMax >= pv[1] / sb.pvMax ? 'a' : 'b', journal: [...journal, '⌛ Aux points.'] };
}

// Réponse au duel. Seul l'adversaire accepte ; les deux peuvent refuser.
function repondreDuel(id, userId, accepte, { now, rng = Math.random, liens = {} } = {}) {
  const t = maintenant(now);
  const d = duelParId(id);
  if (!d) return { refus: 'introuvable' };
  if (d.statut !== 'attente') return { refus: 'termine', duel: d };
  const u = String(userId);
  if (u !== d.a && u !== d.b) return { refus: 'pas_a_toi', duel: d };
  if (t - d.cree_le > DUEL_EXPIRATION_MS) {
    duelMajStmt.run('expire', null, null, d.id);
    return { refus: 'expire', duel: duelParId(d.id) };
  }
  if (!accepte) {
    duelMajStmt.run(u === d.a ? 'annule' : 'refuse', null, null, d.id);
    return { statut: u === d.a ? 'annule' : 'refuse', duel: duelParId(d.id) };
  }
  if (u !== d.b) return { refus: 'pas_a_toi', duel: d };
  if (!reglagesSao(d.guild_id).pvp) return { refus: 'pvp_coupe' };
  const pa = chargerJoueur(d.guild_id, d.a, t);
  const pb = chargerJoueur(d.guild_id, d.b, t);
  if (!pa || !pb) return { refus: 'sans_perso' };
  const r = simulerDuelSao(statsJoueur(pa, { lien: liens.a }), statsJoueur(pb, { lien: liens.b }), rng);
  const gagnant = r.vainqueur === 'a' ? pa : pb;
  const perdant = r.vainqueur === 'a' ? pb : pa;
  gagnant.pvp_victoires += 1;
  perdant.pvp_defaites += 1;
  const quetes = avancerQuete(gagnant, 'duel', 1, t);
  const badges = syncMilestoneBadges(gagnant);
  savePlayer(gagnant);
  savePlayer(perdant);
  duelMajStmt.run('fini', gagnant.user_id, JSON.stringify(r.journal), d.id);
  return { statut: 'fini', vainqueur: gagnant.user_id, perdant: perdant.user_id, journal: r.journal, quetes, badges, duel: duelParId(d.id) };
}

// ══════════════════════════════════════════════════════════════════
// Coffre de couple (inventaire partagé du canon)
// ══════════════════════════════════════════════════════════════════

const coffreGetStmt = db.prepare('SELECT col FROM sao_coffres WHERE guild_id = ? AND couple = ?');
const coffreColStmt = db.prepare(`
  INSERT INTO sao_coffres (guild_id, couple, col) VALUES (?, ?, ?)
  ON CONFLICT (guild_id, couple) DO UPDATE SET col = excluded.col
`);
const coffreObjetsStmt = db.prepare('SELECT objet, qte FROM sao_coffre_objets WHERE guild_id = ? AND couple = ? AND qte > 0 ORDER BY objet');
const coffreObjetGetStmt = db.prepare('SELECT qte FROM sao_coffre_objets WHERE guild_id = ? AND couple = ? AND objet = ?');
const coffreObjetSetStmt = db.prepare(`
  INSERT INTO sao_coffre_objets (guild_id, couple, objet, qte) VALUES (?, ?, ?, ?)
  ON CONFLICT (guild_id, couple, objet) DO UPDATE SET qte = excluded.qte
`);
const coffresDeStmt = db.prepare("SELECT couple FROM sao_coffres WHERE guild_id = ? AND (couple LIKE ? OR couple LIKE ?)");
const coffreDelStmt = db.prepare('DELETE FROM sao_coffres WHERE guild_id = ? AND couple = ?');
const coffreObjetsDelStmt = db.prepare('DELETE FROM sao_coffre_objets WHERE guild_id = ? AND couple = ?');

function cleCouple(a, b) {
  return [String(a), String(b)].sort().join(':');
}
function coffreSao(guildId, couple) {
  return {
    col: coffreGetStmt.get(String(guildId), couple)?.col || 0,
    objets: coffreObjetsStmt.all(String(guildId), couple).filter((r) => OBJETS[r.objet]),
  };
}

// Dépose ou retire du Col ou un objet. `sens` : 'deposer' | 'retirer'.
function mouvementCoffre(guildId, userId, couple, sens, { col = 0, cle = null, qte = 1 } = {}) {
  const g = String(guildId);
  if (!couple.split(':').includes(String(userId))) return { refus: 'pas_a_toi' };
  const p = chargerJoueur(g, userId);
  if (!p) return { refus: 'sans_perso' };
  const coffre = coffreSao(g, couple);
  const n = Math.floor(Number(col) || 0);
  if (n > 0) {
    if (sens === 'deposer') {
      if (p.col < n) return { refus: 'fonds', possede: p.col };
      p.col -= n;
      coffreColStmt.run(g, couple, coffre.col + n);
    } else {
      if (coffre.col < n) return { refus: 'coffre_fonds', possede: coffre.col };
      p.col += n;
      coffreColStmt.run(g, couple, coffre.col - n);
    }
  }
  let objet = null;
  if (cle) {
    const q = Math.floor(Number(qte));
    if (!OBJETS[cle] || !(q >= 1)) return { refus: 'inconnu' };
    const dansCoffre = coffreObjetGetStmt.get(g, couple, cle)?.qte || 0;
    if (sens === 'deposer') {
      if (!retirerObjet(g, userId, cle, q)) return { refus: 'manque', possede: quantiteSao(g, userId, cle) };
      coffreObjetSetStmt.run(g, couple, cle, dansCoffre + q);
    } else {
      if (dansCoffre < q) return { refus: 'coffre_manque', possede: dansCoffre };
      coffreObjetSetStmt.run(g, couple, cle, dansCoffre - q);
      ajouterObjet(g, userId, cle, q);
    }
    if (!coffreGetStmt.get(g, couple)) coffreColStmt.run(g, couple, coffreSao(g, couple).col);
    objet = { cle, qte: q };
  }
  if (!(n > 0) && !objet) return { refus: 'rien' };
  savePlayer(p);
  return { col: n > 0 ? n : 0, objet, coffre: coffreSao(g, couple), joueur: p };
}

// Après un divorce, le coffre est partagé à parts égales (comme le canon
// partage l'inventaire commun) : la moitié (arrondie à l'avantage de celui
// qui l'ouvre) pour chacun.
function partagerCoffresOrphelins(guildId, userId, coupleActuel = null) {
  const g = String(guildId);
  const u = String(userId);
  const partages = [];
  for (const { couple } of coffresDeStmt.all(g, `${u}:%`, `%:${u}`)) {
    if (couple === coupleActuel) continue;
    const autre = couple.split(':').find((x) => x !== u) || u;
    const c = coffreSao(g, couple);
    const moitie = Math.floor(c.col / 2);
    if (c.col) {
      crediterCol(g, u, c.col - moitie);
      if (moitie) crediterCol(g, autre, moitie);
    }
    for (const o of c.objets) {
      const pourAutre = Math.floor(o.qte / 2);
      donnerObjet(g, u, o.objet, o.qte - pourAutre);
      if (pourAutre) donnerObjet(g, autre, o.objet, pourAutre);
    }
    coffreDelStmt.run(g, couple);
    coffreObjetsDelStmt.run(g, couple);
    partages.push({ couple, autre, col: c.col, objets: c.objets });
  }
  return partages;
}

// ══════════════════════════════════════════════════════════════════
// Classements, délais, remise à zéro
// ══════════════════════════════════════════════════════════════════

const CLASSEMENTS = {
  etage: { nom: 'Étage', emoji: '🏯', ordre: 'MIN(floor, 101) DESC, level DESC, xp DESC' },
  niveau: { nom: 'Niveau', emoji: '⭐', ordre: 'level DESC, xp DESC' },
  col: { nom: 'Fortune', emoji: '💰', ordre: 'col DESC' },
  boss: { nom: 'Boss vaincus', emoji: '🐉', ordre: 'COALESCE(boss_vaincus, 0) DESC, floor DESC' },
  monstres: { nom: 'Monstres', emoji: '⚔️', ordre: 'COALESCE(monstres, 0) DESC' },
  pvp: { nom: 'Duels', emoji: '🤺', ordre: 'COALESCE(pvp_victoires, 0) DESC, COALESCE(pvp_defaites, 0) ASC' },
  morts: { nom: 'Monument of Life', emoji: '🪦', ordre: 'COALESCE(morts, 0) DESC', filtre: 'COALESCE(morts, 0) > 0' },
};
const requetesClassement = Object.fromEntries(Object.entries(CLASSEMENTS).map(([cle, c]) => [cle, db.prepare(
  `SELECT * FROM sao_players WHERE guild_id = ?${c.filtre ? ` AND ${c.filtre}` : ''} ORDER BY ${c.ordre}, user_id LIMIT 500`
)]));
function classementSao(guildId, categorie = 'etage') {
  const req = requetesClassement[categorie] || requetesClassement.etage;
  return req.all(String(guildId)).map(normaliser);
}
function leaderboard(guildId, limit = 10) {
  return classementSao(guildId, 'etage').slice(0, limit);
}

function delaisSao(guildId, userId, { now } = {}) {
  const t = maintenant(now);
  expirerCombatAbandonne(guildId, userId, t);
  const p = chargerJoueur(guildId, userId, t);
  if (!p) return null;
  const R = reglagesSao(guildId);
  const afkMin = Math.min(R.afkHeures * 60, Math.max(0, (t - (tempsDe(p.last_afk) || t)) / 60000));
  return {
    joueur: p,
    chasse: Math.max(0, R.chasseDelai * 1000 - (t - tempsDe(p.last_hunt))),
    quotidien: p.quotidien_jour === jourSao(t) ? msAvantMinuit(t) : 0,
    afk: R.afk ? { minutes: Math.floor(afkMin), plafond: R.afkHeures * 60, pret: afkMin >= AFK_MIN_MIN } : null,
    peche: p.floor >= D.ETAGE_PECHE ? Math.max(0, PECHE_DELAI_MS - (t - Number(p.peche_le || 0))) : null,
    reapparition: reapparitionRestante(p, t),
    combat: combatActif(p.guild_id, p.user_id),
    repas: p.repas ? { cle: p.repas, reste: p.repas_reste } : null,
    quetes: quetesDuJour(p.guild_id, p.user_id, t),
  };
}

const TABLES_JOUEUR = [
  ['sao_players', 'user_id'], ['sao_badges', 'user_id'], ['sao_inventaire', 'user_id'], ['sao_combats', 'user_id'],
  ['sao_ameliorations', 'user_id'], ['sao_quetes', 'user_id'], ['sao_uniques', 'user_id'],
];
const effacerJoueurStmts = TABLES_JOUEUR.map(([table, col]) => db.prepare(`DELETE FROM ${table} WHERE guild_id = ? AND ${col} = ?`));
const effacerDuelsJoueurStmt = db.prepare('DELETE FROM sao_duels WHERE guild_id = ? AND (a = ? OR b = ?)');
const effacerCoupsJoueurStmt = db.prepare('DELETE FROM sao_raid_coups WHERE user_id = ? AND raid_id IN (SELECT id FROM sao_raids WHERE guild_id = ?)');

// Remet un aventurier à zéro sur ce serveur (son coffre de couple est
// partagé d'abord, pour que son conjoint ne perde rien).
function reinitialiserJoueurSao(guildId, userId) {
  const g = String(guildId);
  const u = String(userId);
  const existait = Boolean(getPlayer(g, u));
  const partages = partagerCoffresOrphelins(g, u, null);
  for (const s of effacerJoueurStmts) s.run(g, u);
  effacerDuelsJoueurStmt.run(g, u, u);
  effacerCoupsJoueurStmt.run(u, g);
  return { existait, partages };
}

const compterJoueursStmt = db.prepare('SELECT COUNT(*) AS n FROM sao_players WHERE guild_id = ?');
const effacerServeurStmts = [
  'sao_players', 'sao_badges', 'sao_inventaire', 'sao_combats', 'sao_ameliorations', 'sao_quetes', 'sao_uniques',
  'sao_duels', 'sao_coffres', 'sao_coffre_objets',
].map((table) => db.prepare(`DELETE FROM ${table} WHERE guild_id = ?`));
const effacerCoupsServeurStmt = db.prepare('DELETE FROM sao_raid_coups WHERE raid_id IN (SELECT id FROM sao_raids WHERE guild_id = ?)');
const effacerRaidsServeurStmt = db.prepare('DELETE FROM sao_raids WHERE guild_id = ?');

function reinitialiserServeurSao(guildId) {
  const g = String(guildId);
  const joueurs = compterJoueursStmt.get(g)?.n || 0;
  db.transaction(() => {
    effacerCoupsServeurStmt.run(g);
    effacerRaidsServeurStmt.run(g);
    for (const s of effacerServeurStmts) s.run(g);
  })();
  return { joueurs };
}

// Compatibilité : anciens noms.
const bossName = (etage) => D.bossDe(etage).nom;
const bar = F.barreSao;
const gainXp = F.ajouterXp;

module.exports = {
  OBJETS, BADGES, MAX_FLOOR, ABANDON_MS, REAPPARITION_MS, PECHE_DELAI_MS, PECHE_TROP_TARD_MS, DUEL_EXPIRATION_MS, AFK_MIN_MIN,
  CLASSEMENTS, KIT_DEPART,
  crediterCol, donnerObjet, objetsRecompensables,
  reglagesSao, jourSao, msAvantMinuit, getPlayer, ensurePlayer, savePlayer, chargerJoueur, statsJoueur, plusArme,
  detenteurUnique, uniquesDe, quantiteSao, ajouterObjet, retirerObjet, inventaireSao, ownedBadges, award, syncMilestoneBadges,
  rumeurDuJour, quetesDuJour, avancerQuete, texteQuete, appliquerMort, chasserSao, combatActif, combatParId,
  expirerCombatAbandonne, commencerBoss, jouerTourSao, soignerAuberge, recolterAfk, voyagerSao, prixAchat, prixRevente,
  acheterSao, vendreSao, vendreButin, offresForge, forgerSao, ameliorerSao, infoBoss, acheterRenseignement, reclamerQuotidien,
  lancerPeche, ferrerSao, cuisinerSao, utiliserObjet, duelParId, proposerDuel, simulerDuelSao, repondreDuel, cleCouple,
  coffreSao, mouvementCoffre, partagerCoffresOrphelins, classementSao, leaderboard, delaisSao,
  reinitialiserJoueurSao, reinitialiserServeurSao, bossName, bar, gainXp,
};
