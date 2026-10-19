const { db, getGuildConfig } = require('../database');
const { COLORS } = require('./embeds');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const balises = require('./balises');

// 📈 XP & NIVEAUX
//
// Un seul compteur par membre (`levels.xp`) : l'écrit, le vocal, l'Aventure
// SAO, les mini-jeux… alimentent le même niveau. `text_xp` et `voice_xp` ne
// disent que d'où vient l'XP gagnée en écrivant et en vocal.
//
// Tout ce qui se règle (gains, exclusions, multiplicateurs, courbe, annonces,
// récompenses) se règle PAR SERVEUR. Une colonne neuve vaut NULL sur un
// serveur existant : on lit donc toujours `cfg.x ?? défaut`, et le défaut
// est le comportement d'avant.

// ══════════════════════════════════════════════════════════════════
// 📐 COURBES
// ══════════════════════════════════════════════════════════════════
//
// XP pour passer du niveau n au niveau n+1 : a·n² + b·n + c. La classique
// est celle de MEE6 — celle qu'on a toujours eue, donc le défaut.

const COURBES_XP = {
  mee6: { nom: 'Classique', emoji: '📈', a: 5, b: 50, c: 100, aide: 'La courbe de MEE6 : 5n² + 50n + 100' },
  douce: { nom: 'Douce', emoji: '🌱', a: 3, b: 30, c: 80, aide: 'On monte plus vite, surtout au début' },
  raide: { nom: 'Raide', emoji: '⛰️', a: 8, b: 80, c: 150, aide: 'Chaque niveau se mérite' },
  lineaire: { nom: 'Linéaire', emoji: '📏', a: 0, b: 100, c: 100, aide: '100 XP de plus à chaque niveau' },
};
const XP_MAXIMUM = 1_000_000_000;

function xpForLevel(level, courbe = 'mee6') {
  const k = COURBES_XP[courbe] || COURBES_XP.mee6;
  return k.a * level * level + k.b * level + k.c;
}

function totalXpForLevel(level, courbe = 'mee6') {
  let total = 0;
  for (let i = 0; i < level; i++) total += xpForLevel(i, courbe);
  return total;
}

// `max` (0 = aucun) plafonne le niveau ; l'XP, elle, continue de compter
// pour le classement.
function levelFromXp(xp, courbe = 'mee6', max = 0) {
  let level = 0;
  let remaining = Math.max(0, Number(xp) || 0);
  while (remaining >= xpForLevel(level, courbe) && !(max > 0 && level >= max)) {
    remaining -= xpForLevel(level, courbe);
    level++;
  }
  return { level, current: remaining, needed: xpForLevel(level, courbe), plafond: max > 0 && level >= max };
}

// La courbe et le niveau maximum d'un serveur.
function courbeXpDe(guildId) {
  const cfg = getGuildConfig(String(guildId));
  const courbe = COURBES_XP[cfg.xp_courbe] ? cfg.xp_courbe : 'mee6';
  const max = Math.max(0, Math.min(1000, Number(cfg.xp_niveau_max ?? 0) || 0));
  return { courbe, max };
}

// ── Recalcul des niveaux enregistrés ────────────────────────────────────
//
// `levels.level` est une copie de ce que donne la courbe. Changer de courbe
// (ou de niveau maximum) doit donc la recalculer pour tout le serveur — sans
// annonce : personne n'a rien gagné, c'est la règle qui a changé.
//
// La courbe appliquée est retenue par serveur. Un changement fait ailleurs
// (tableau de bord) est rattrapé au prochain gain, sans qu'il faille penser
// à appeler quoi que ce soit.

const lireEtat = db.prepare('SELECT value FROM app_state WHERE key = ?');
const ecrireEtat = db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)');
const effacerEtat = db.prepare('DELETE FROM app_state WHERE key = ?');
const lignesDuServeur = db.prepare('SELECT user_id, xp, level FROM levels WHERE guild_id = ?');
const ecrireNiveau = db.prepare('UPDATE levels SET level = ? WHERE guild_id = ? AND user_id = ?');
const signaturesCourbe = new Map();
const signatureCourbe = ({ courbe, max }) => `${courbe}:${max}`;

// 📉 Les baisses de niveau qu'une nouvelle règle a provoquées, en attente :
// { userId: niveau le plus haut d'avant }. Le recalcul n'a pas de serveur
// Discord sous la main (il tourne aussi depuis le tableau de bord, ou au
// premier gain qui suit) : il note, et `realignerBaisses` reprend ensuite les
// rôles des paliers perdus. Sans cette trace, plus rien ne savait qu'un
// membre AVAIT eu le niveau 10 : son rôle restait pour toujours.
const cleBaisses = (gid) => `xp_baisses:${gid}`;
function lireBaisses(gid) {
  try {
    const brut = JSON.parse(lireEtat.get(cleBaisses(gid))?.value || '{}');
    return brut && typeof brut === 'object' && !Array.isArray(brut) ? brut : {};
  } catch {
    return {};
  }
}

// Rend le nombre de niveaux changés (comme avant). Les baisses sont notées.
function recalculerNiveaux(guildId) {
  const gid = String(guildId);
  const reglage = courbeXpDe(gid);
  let changes = 0;
  db.transaction(() => {
    const baisses = lireBaisses(gid);
    let baisse = false;
    for (const l of lignesDuServeur.all(gid)) {
      const n = levelFromXp(l.xp || 0, reglage.courbe, reglage.max).level;
      if (n !== l.level) {
        ecrireNiveau.run(n, gid, l.user_id);
        changes++;
        if (n < l.level) {
          baisses[l.user_id] = Math.max(Number(baisses[l.user_id]) || 0, Number(l.level) || 0);
          baisse = true;
        }
      }
    }
    if (baisse) ecrireEtat.run(cleBaisses(gid), JSON.stringify(baisses));
  })();
  const sig = signatureCourbe(reglage);
  ecrireEtat.run(`xp_courbe:${gid}`, sig);
  signaturesCourbe.set(gid, sig);
  return changes;
}

// Lu à chaque gain : la simple présence de la clé suffit (elle n'est écrite
// que s'il y a eu une baisse, et effacée dès qu'on la traite).
const baissesEnAttente = (guildId) => Boolean(lireEtat.get(cleBaisses(String(guildId))));

function verifierCourbe(guildId) {
  const gid = String(guildId);
  const attendue = signatureCourbe(courbeXpDe(gid));
  // Pas de trace = la courbe historique, celle de tous les niveaux d'avant.
  const connue = signaturesCourbe.get(gid) ?? (lireEtat.get(`xp_courbe:${gid}`)?.value || 'mee6:0');
  if (connue !== attendue) recalculerNiveaux(gid);
  else signaturesCourbe.set(gid, connue);
}

// Consigne laissée par la migration de src/database.js (fusion des niveaux) :
// les niveaux se calculent ICI, avec la courbe de chaque serveur.
try {
  if (lireEtat.get('xp_niveaux_a_recalculer')) {
    for (const { guild_id: gid } of db.prepare('SELECT DISTINCT guild_id FROM levels').all()) recalculerNiveaux(gid);
    effacerEtat.run('xp_niveaux_a_recalculer');
  }
} catch (err) {
  console.warn(`⚠️ Recalcul des niveaux impossible (${err.message}).`);
}

// ══════════════════════════════════════════════════════════════════
// 💾 COMPTEURS
// ══════════════════════════════════════════════════════════════════

const upsertStmt = db.prepare(`
  INSERT INTO levels (guild_id, user_id, text_xp, voice_xp, text_level, voice_level, xp, level)
  VALUES (?, ?, 0, 0, 0, 0, 0, 0)
  ON CONFLICT (guild_id, user_id) DO NOTHING
`);
const getStmt = db.prepare('SELECT * FROM levels WHERE guild_id = ? AND user_id = ?');
const ecrireCompteurs = db.prepare(
  'UPDATE levels SET text_xp = ?, voice_xp = ?, xp = ?, level = ?, parti = 0 WHERE guild_id = ? AND user_id = ?'
);

// Système de niveaux activé sur ce serveur ? (NULL = oui, comportement
// historique ; désactivable par serveur via /config → 📈 XP & niveaux.)
function levelsEnabled(guildId) {
  return getGuildConfig(String(guildId)).levels_enabled !== 0;
}

// D'où vient l'XP — pour le mot de l'annonce. Une source inconnue se lit
// comme de l'écrit, comme avant.
const SOURCES_XP = {
  text: 'en écrivant ✍️',
  voice: 'en vocal 🎙️',
  sao: 'dans l\'Aventure SAO ⚔️',
  jeux: 'aux mini-jeux 🎲',
  comptage: 'au comptage 🔢',
  couple: 'en couple 💞',
  admin: 'grâce au staff 🛠️',
};

// ✍️ Gain d'un message : fixe (`xp_text`), ou tiré au hasard entre
// `xp_text_min` et `xp_text_max` quand l'un des deux est réglé.
function gainTexteXp(cfg, hasard = Math.random) {
  const fixe = Math.max(0, Number(cfg.xp_text ?? 20) || 0);
  if (cfg.xp_text_min == null && cfg.xp_text_max == null) return fixe;
  let bas = Math.max(0, Number(cfg.xp_text_min ?? fixe) || 0);
  let haut = Math.max(0, Number(cfg.xp_text_max ?? fixe) || 0);
  if (bas > haut) [bas, haut] = [haut, bas];
  return bas + Math.floor(hasard() * (haut - bas + 1));
}

// ══════════════════════════════════════════════════════════════════
// 🚫 EXCLUSIONS
// ══════════════════════════════════════════════════════════════════
//
// Un salon exclu l'est avec ses fils, une catégorie avec tous ses salons.
// La portée dit ce qui ne rapporte plus : 'tout' (toutes les sources sauf le
// staff), 'texte' (les messages) ou 'vocal' (les minutes de vocal).

const PORTEES_XP = ['tout', 'texte', 'vocal'];
const TYPES_EXCLUSION_XP = ['salon', 'role'];
const MAX_EXCLUSIONS_PAR_PORTEE = 25; // un menu Discord n'en montre pas plus

const listerExclusionsStmt = db.prepare(
  'SELECT type, cible_id, portee FROM xp_exclusions WHERE guild_id = ? ORDER BY type, portee, cible_id'
);
const poserExclusionStmt = db.prepare(
  `INSERT INTO xp_exclusions (guild_id, type, cible_id, portee) VALUES (?, ?, ?, ?)
   ON CONFLICT (guild_id, type, cible_id) DO UPDATE SET portee = excluded.portee`
);
const retirerExclusionStmt = db.prepare('DELETE FROM xp_exclusions WHERE guild_id = ? AND type = ? AND cible_id = ?');

const estIdentifiant = (v) => /^\d{5,25}$/.test(String(v || ''));

function listerExclusionsXp(guildId) {
  return listerExclusionsStmt.all(String(guildId));
}

// Une cible n'a qu'UNE portée (clé de la table). L'exclure dans une
// deuxième portée ne doit pas effacer la première en silence : écrit +
// vocal donnent « tout », et une cible déjà exclue de tout le reste.
const porteeFusionnee = (avant, voulue) => (!avant || avant === voulue ? voulue : 'tout');

// Rend { ok, portee, avant } : `portee` est celle RETENUE (elle peut être
// « tout » après une fusion), `avant` celle qu'avait déjà la cible.
function ajouterExclusionXp(guildId, type, cibleId, portee = 'tout') {
  const gid = String(guildId);
  if (!TYPES_EXCLUSION_XP.includes(type)) return { ok: false, erreur: 'Type inconnu : « salon » ou « role ».' };
  if (!estIdentifiant(cibleId)) return { ok: false, erreur: 'Identifiant de salon ou de rôle invalide.' };
  if (!PORTEES_XP.includes(portee)) return { ok: false, erreur: 'Portée inconnue : « tout », « texte » ou « vocal ».' };
  const toutes = listerExclusionsXp(gid);
  const avant = toutes.find((e) => e.type === type && e.cible_id === String(cibleId))?.portee || null;
  const retenue = porteeFusionnee(avant, portee);
  const memes = toutes.filter((e) => e.type === type && e.portee === retenue && e.cible_id !== String(cibleId));
  if (memes.length >= MAX_EXCLUSIONS_PAR_PORTEE) {
    return { ok: false, erreur: `Déjà ${MAX_EXCLUSIONS_PAR_PORTEE} exclusions de ce genre : retirez-en une d'abord.` };
  }
  poserExclusionStmt.run(gid, type, String(cibleId), retenue);
  return { ok: true, portee: retenue, avant };
}

function retirerExclusionXp(guildId, type, cibleId) {
  return retirerExclusionStmt.run(String(guildId), String(type), String(cibleId)).changes > 0;
}

// Remplace d'un coup la liste d'une portée (ce que donne un menu à choix
// multiples) : ce qui n'est plus coché est retiré, le reste est posé.
//
// Une cible cochée ici mais déjà exclue AILLEURS n'est jamais déplacée en
// silence : écrit + vocal deviennent « tout », une cible en « tout » y
// reste. Chaque cas est rendu dans `fusions` ({ id, avant, apres }), pour que
// le panneau et le journal le disent.
function remplacerExclusionsXp(guildId, type, portee, ids) {
  const gid = String(guildId);
  if (!TYPES_EXCLUSION_XP.includes(type) || !PORTEES_XP.includes(portee)) return { ajoutes: 0, retires: 0, fusions: [] };
  const voulus = [...new Set((ids || []).map(String).filter(estIdentifiant))].slice(0, MAX_EXCLUSIONS_PAR_PORTEE);
  const duType = listerExclusionsXp(gid).filter((e) => e.type === type);
  const actuels = duType.filter((e) => e.portee === portee).map((e) => e.cible_id);
  const ailleurs = new Map(duType.filter((e) => e.portee !== portee).map((e) => [e.cible_id, e.portee]));
  // « Tout » a, lui aussi, 25 places au plus (un menu n'en montre pas plus).
  let placesTout = MAX_EXCLUSIONS_PAR_PORTEE - duType.filter((e) => e.portee === 'tout').length;
  let ajoutes = 0;
  let retires = 0;
  const fusions = [];
  db.transaction(() => {
    for (const id of actuels) {
      if (!voulus.includes(id)) retires += retirerExclusionStmt.run(gid, type, id).changes;
    }
    for (const id of voulus) {
      if (actuels.includes(id)) continue;
      const avant = ailleurs.get(id) || null;
      if (!avant) {
        poserExclusionStmt.run(gid, type, id, portee);
        ajoutes++;
        continue;
      }
      let apres = porteeFusionnee(avant, portee);
      if (apres !== avant && portee !== 'tout') {
        if (placesTout <= 0) apres = avant; // pas de place : on ne touche à rien, et on le dit
        else placesTout--;
      }
      if (apres !== avant) poserExclusionStmt.run(gid, type, id, apres);
      fusions.push({ id, avant, apres });
    }
  })();
  return { ajoutes, retires, fusions };
}

// Le salon, son parent (le salon d'un fil, la catégorie d'un salon) et la
// catégorie du parent (celle d'un fil).
function salonsConcernes(salon) {
  if (!salon) return [];
  const ids = [salon.id, salon.parentId, salon.parent?.parentId].filter(Boolean).map(String);
  return [...new Set(ids)];
}

// Le membre d'un contexte, SEULEMENT s'il s'agit bien de celui qui gagne.
// Un bouton cliqué par B qui fait gagner A (le duel SAO) porte le membre B :
// ses rôles ne disent rien des droits de A.
function membreDuContexte(contexte) {
  const membre = contexte?.membre || null;
  if (!membre) return null;
  if (contexte.userId != null && String(membre.id) !== String(contexte.userId)) return null;
  return membre;
}

function estExcluXp(guildId, source, contexte = {}) {
  if (source === 'admin') return false;
  const regles = listerExclusionsXp(guildId);
  if (!regles.length) return false;
  const { salon = null } = contexte || {};
  const membre = membreDuContexte(contexte);
  const portee = source === 'text' ? 'texte' : source === 'voice' ? 'vocal' : null;
  const salons = salonsConcernes(salon);
  const roles = membre?.roles?.cache;
  return regles.some((r) => {
    if (r.portee !== 'tout' && r.portee !== portee) return false;
    if (r.type === 'salon') return salons.includes(r.cible_id);
    return Boolean(roles?.has?.(r.cible_id));
  });
}

// ══════════════════════════════════════════════════════════════════
// ⚡ MULTIPLICATEURS
// ══════════════════════════════════════════════════════════════════
//
// Un pourcentage : 100 = normal, 150 = ×1,5, 50 = moitié, 0 = rien.
// Les facteurs se multiplient entre eux (rôle × salon × serveur × boost…).
// Entre plusieurs rôles : le plus haut rôle seulement, ou les bonus cumulés
// (+50 % et +20 % donnent +70 %).

const MAX_MULTIPLICATEURS = 25;
const listerMultiplicateursStmt = db.prepare(
  'SELECT type, cible_id, pourcent FROM xp_multiplicateurs WHERE guild_id = ? ORDER BY type, cible_id'
);
const poserMultiplicateurStmt = db.prepare(
  `INSERT INTO xp_multiplicateurs (guild_id, type, cible_id, pourcent) VALUES (?, ?, ?, ?)
   ON CONFLICT (guild_id, type, cible_id) DO UPDATE SET pourcent = excluded.pourcent`
);
const retirerMultiplicateurStmt = db.prepare('DELETE FROM xp_multiplicateurs WHERE guild_id = ? AND type = ? AND cible_id = ?');

function listerMultiplicateursXp(guildId) {
  return listerMultiplicateursStmt.all(String(guildId));
}

function definirMultiplicateurXp(guildId, type, cibleId, pourcent) {
  const gid = String(guildId);
  if (!['role', 'salon'].includes(type)) return { ok: false, erreur: 'Type inconnu : « role » ou « salon ».' };
  if (!estIdentifiant(cibleId)) return { ok: false, erreur: 'Identifiant de rôle ou de salon invalide.' };
  const p = Number(pourcent);
  if (!Number.isInteger(p) || p < 0 || p > 1000) return { ok: false, erreur: 'Le pourcentage va de 0 à 1000 (100 = normal).' };
  const autres = listerMultiplicateursXp(gid).filter((m) => !(m.type === type && m.cible_id === String(cibleId)));
  if (autres.length >= MAX_MULTIPLICATEURS) {
    return { ok: false, erreur: `Déjà ${MAX_MULTIPLICATEURS} multiplicateurs : retirez-en un d'abord.` };
  }
  poserMultiplicateurStmt.run(gid, type, String(cibleId), p);
  return { ok: true };
}

function retirerMultiplicateurXp(guildId, type, cibleId) {
  return retirerMultiplicateurStmt.run(String(guildId), String(type), String(cibleId)).changes > 0;
}

// Samedi ou dimanche, à l'heure de Paris (le bot sert des serveurs français :
// le week-end commence à minuit à Paris, pas à minuit UTC).
function estWeekEndParis(date = new Date()) {
  try {
    const jour = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short' }).format(date);
    return jour === 'Sat' || jour === 'Sun';
  } catch {
    return date.getUTCDay() === 0 || date.getUTCDay() === 6;
  }
}

// Le boost temporaire est-il en cours ? Une fin vide = sans fin.
function boostXpActif(cfg, maintenant = new Date()) {
  const p = Number(cfg.xp_boost_pourcent ?? 0) || 0;
  if (p <= 0) return false;
  if (!cfg.xp_boost_fin) return true;
  const fin = Date.parse(cfg.xp_boost_fin);
  return Number.isNaN(fin) ? false : fin > maintenant.getTime();
}

// 💞 Contrat B (src/utils/couple.js) — absent tant que le module mariage
// n'est pas livré : on le cherche une fois, et on s'en passe sinon.
let moduleCouple;
function coupleXp() {
  if (moduleCouple === undefined) {
    try {
      moduleCouple = require('./couple');
    } catch {
      moduleCouple = null;
    }
  }
  return moduleCouple;
}

// Tous les facteurs qui s'appliquent à ce gain. Rend le facteur final et le
// détail lisible (pour /niveau voir et le tableau de bord).
function multiplicateursXp(guildId, source, contexte = {}, maintenant = new Date()) {
  const gid = String(guildId);
  if (source === 'admin') return { facteur: 1, details: [] };
  const { salon = null } = contexte || {};
  const membre = membreDuContexte(contexte);
  const cfg = getGuildConfig(gid);
  const details = [];
  let facteur = 1;
  const appliquer = (libelle, pourcent) => {
    facteur *= Math.max(0, pourcent) / 100;
    details.push({ libelle, pourcent: Math.round(pourcent) });
  };

  const regles = listerMultiplicateursXp(gid);
  const roles = membre?.roles?.cache;
  const rolesMult = regles.filter((r) => r.type === 'role' && roles?.has?.(r.cible_id));
  if (rolesMult.length) {
    if (Number(cfg.xp_mult_cumul ?? 0) === 1) {
      const total = 100 + rolesMult.reduce((s, r) => s + (r.pourcent - 100), 0);
      appliquer(`Rôles ${rolesMult.map((r) => `<@&${r.cible_id}>`).join(' ')}`, Math.max(0, total));
    } else {
      // Le plus haut rôle du membre ; à position égale (ou inconnue), le
      // plus fort multiplicateur.
      const position = (r) => roles.get?.(r.cible_id)?.position ?? -1;
      const haut = [...rolesMult].sort((a, b) => position(b) - position(a) || b.pourcent - a.pourcent)[0];
      appliquer(`Rôle <@&${haut.cible_id}>`, haut.pourcent);
    }
  }
  // Le salon le plus précis l'emporte : le salon, puis son parent, puis la
  // catégorie.
  const salonMult = salonsConcernes(salon)
    .map((id) => regles.find((r) => r.type === 'salon' && r.cible_id === id))
    .find(Boolean);
  if (salonMult) appliquer(`Salon <#${salonMult.cible_id}>`, salonMult.pourcent);

  const global = Number(cfg.xp_mult_global ?? 100);
  if (Number.isFinite(global) && global !== 100) appliquer('Multiplicateur du serveur', global);
  if (boostXpActif(cfg, maintenant)) {
    const fin = cfg.xp_boost_fin ? Date.parse(cfg.xp_boost_fin) : NaN;
    appliquer(Number.isNaN(fin) ? 'Boost' : `Boost jusqu'au <t:${Math.floor(fin / 1000)}:f>`, 100 + Number(cfg.xp_boost_pourcent));
  }
  const weekend = Number(cfg.xp_weekend_pourcent ?? 0) || 0;
  if (weekend > 0 && estWeekEndParis(maintenant)) appliquer('Bonus du week-end', 100 + weekend);
  if (source === 'sao') {
    const part = Number(cfg.xp_sao_pourcent ?? 100);
    if (Number.isFinite(part) && part !== 100) appliquer('Part de l\'XP SAO', part);
  }
  // Le bonus de couple est celui de QUI GAGNE, jamais celui du membre
  // qui a cliqué.
  const pour = contexte?.userId ?? membre?.id;
  if (pour != null) {
    try {
      const b = coupleXp()?.bonusXpCouple?.(gid, String(pour), source);
      if (b && Number(b.pourcent) > 0) appliquer(b.raison || 'Bonus de couple', 100 + Number(b.pourcent));
    } catch {}
  }
  return { facteur, details };
}

// ══════════════════════════════════════════════════════════════════
// ➕ GAGNER (OU PERDRE) DE L'XP — contrat C
// ══════════════════════════════════════════════════════════════════
//
// `source` : 'text' | 'voice' | 'sao' | 'jeux' | 'comptage' | 'couple' | 'admin'.
// `contexte` : { membre, salon } — sert aux exclusions et aux multiplicateurs
// de rôles et de salons. Sans lui, seuls les réglages du serveur s'appliquent.
// Seul le staff ('admin') peut retirer (montant négatif) ; il n'est soumis à
// aucun multiplicateur ni aucune exclusion.
//
// Rend { leveledUp, leveledDown, newLevel, oldLevel, gagne } — `gagne` est
// l'XP RÉELLEMENT ajoutée (négative pour un retrait).
function addXp(guildId, userId, source, amount, contexte = {}) {
  const gid = String(guildId);
  const uid = String(userId);
  const neutre = (niveau = 0) => ({ leveledUp: false, leveledDown: false, newLevel: niveau, oldLevel: niveau, gagne: 0 });
  if (!levelsEnabled(gid)) return neutre();
  const ctx = { ...(contexte || {}), userId: uid };
  const admin = source === 'admin';
  let brut = Math.round(Number(amount) || 0);
  if (!admin) brut = Math.max(0, brut);

  verifierCourbe(gid);
  const { courbe, max } = courbeXpDe(gid);
  const row = getStmt.get(gid, uid);
  const avant = row?.xp || 0;
  const oldLevel = levelFromXp(avant, courbe, max).level;

  let gagne = brut;
  if (!admin && brut > 0) {
    if (estExcluXp(gid, source, ctx)) gagne = 0;
    else {
      // 💞 D'abord noter l'activité, puis demander le bonus : le bonus d'un
      // couple dépend de ce que les deux ont fait récemment.
      try { coupleXp()?.noterActiviteCouple?.(gid, uid); } catch {}
      gagne = Math.round(brut * multiplicateursXp(gid, source, ctx).facteur);
    }
  }
  const apres = Math.min(XP_MAXIMUM, Math.max(0, avant + gagne));
  gagne = apres - avant;
  if (gagne === 0) return neutre(oldLevel);

  const newLevel = levelFromXp(apres, courbe, max).level;
  upsertStmt.run(gid, uid);
  const actuel = row || getStmt.get(gid, uid);
  const texte = (actuel.text_xp || 0) + (source === 'text' ? gagne : 0);
  const vocal = (actuel.voice_xp || 0) + (source === 'voice' ? gagne : 0);
  ecrireCompteurs.run(Math.max(0, texte), Math.max(0, vocal), apres, newLevel, gid, uid);
  return { leveledUp: newLevel > oldLevel, leveledDown: newLevel < oldLevel, newLevel, oldLevel, gagne };
}

function getLevels(guildId, userId) {
  return getStmt.get(String(guildId), String(userId)) || {
    guild_id: guildId,
    user_id: userId,
    text_xp: 0,
    voice_xp: 0,
    text_level: 0,
    voice_level: 0,
    xp: 0,
    level: 0,
    parti: 0,
  };
}

// ══════════════════════════════════════════════════════════════════
// 🏆 CLASSEMENT ET RANG
// ══════════════════════════════════════════════════════════════════

const COLONNES_CLASSEMENT = { total: 'xp', texte: 'text_xp', vocal: 'voice_xp' };
const requetesClassement = new Map();
function requeteClassement(tri, partis) {
  const col = COLONNES_CLASSEMENT[tri] || 'xp';
  const cle = `${col}:${partis ? 1 : 0}`;
  if (!requetesClassement.has(cle)) {
    requetesClassement.set(cle, db.prepare(
      `SELECT user_id, xp, level, text_xp, voice_xp, parti FROM levels
       WHERE guild_id = ? AND ${col} > 0 ${partis ? '' : 'AND parti = 0'}
       ORDER BY ${col} DESC, user_id`
    ));
  }
  return requetesClassement.get(cle);
}

// Tout le classement d'un serveur, rang compris. `partis` : garder les
// membres qui ont quitté le serveur (signalés), sinon ils sont filtrés.
function classementNiveaux(guildId, { tri = 'total', partis = false } = {}) {
  verifierCourbe(guildId);
  return requeteClassement(tri, partis).all(String(guildId)).map((r, i) => ({ ...r, rang: i + 1 }));
}

const rangStmts = new Map();
// Rang du membre parmi les membres présents (1 = premier), null sans XP.
function rangNiveau(guildId, userId, tri = 'total') {
  const col = COLONNES_CLASSEMENT[tri] || 'xp';
  if (!rangStmts.has(col)) {
    rangStmts.set(col, db.prepare(
      `SELECT COUNT(*) AS n FROM levels WHERE guild_id = ? AND parti = 0 AND ${col} >
         (SELECT ${col} FROM levels WHERE guild_id = ? AND user_id = ?)`
    ));
  }
  const moi = getStmt.get(String(guildId), String(userId));
  if (!moi || !(moi[col] > 0)) return null;
  return rangStmts.get(col).get(String(guildId), String(guildId), String(userId)).n + 1;
}

// Compatibilité : le top N, membres partis exclus.
function getLeaderboard(guildId, limit = 10) {
  return classementNiveaux(guildId).slice(0, limit);
}

// 🚪 Un membre quitte le serveur : il disparaît du classement (son XP reste
// s'il revient), ou il est effacé si le serveur l'a demandé.
const marquerParti = db.prepare('UPDATE levels SET parti = ? WHERE guild_id = ? AND user_id = ?');
function marquerDepartNiveau(guildId, userId) {
  const cfg = getGuildConfig(String(guildId));
  if (Number(cfg.level_reset_depart ?? 0) === 1) return effacerXpMembre(guildId, userId, { garderRegistre: true }) ? 'efface' : null;
  return marquerParti.run(1, String(guildId), String(userId)).changes ? 'parti' : null;
}
// Un absent constaté après coup (le classement ne le trouve plus sur le
// serveur) : on le retire du classement, sans jamais effacer son XP.
function noterAbsenceNiveau(guildId, userId) {
  return marquerParti.run(1, String(guildId), String(userId)).changes > 0;
}

// ══════════════════════════════════════════════════════════════════
// 🏅 RÉCOMPENSES DE NIVEAU
// ══════════════════════════════════════════════════════════════════
//
// Plusieurs récompenses par niveau, de plusieurs sortes. **Aucune par
// défaut** : un serveur qui n'en configure pas n'en reçoit aucune.
//
//  • On donne TOUS les paliers atteints, pas seulement celui qu'on vient de
//    passer. Un membre absent pendant que le staff configurait, ou qui prend
//    trois niveaux d'un coup, ne reste pas sans rien.
//  • Les rôles s'ajoutent (défaut), ou le dernier palier REMPLACE les
//    précédents : `level_rewards_stack = 0`.
//  • Le Col et les objets SAO ne sont versés qu'une fois : le registre
//    `niveau_recompenses_recues` le garantit. Ils exigent l'Aventure SAO
//    active sur le serveur.
//  • Un message privé félicite le membre AU MOMENT où il franchit le palier,
//    jamais en rattrapage : une félicitation de trois mois n'a plus de sens.
//  • Un niveau perdu (XP retirée) reprend les rôles des paliers non atteints.

const TYPES_RECOMPENSE_NIVEAU = {
  role: { emoji: '🎭', nom: 'Rôle donné' },
  role_retrait: { emoji: '🚫', nom: 'Rôle retiré' },
  col: { emoji: '💰', nom: 'Col (Aventure SAO)', sao: true },
  objet: { emoji: '🎁', nom: 'Objet (Aventure SAO)', sao: true },
  mp: { emoji: '✉️', nom: 'Message privé' },
};
const NIVEAU_RECOMPENSE_MAX = 1000;
const MAX_RECOMPENSES = 100;

const listerRecStmt = db.prepare('SELECT * FROM niveau_recompenses WHERE guild_id = ? ORDER BY niveau, id');
const insererRecStmt = db.prepare(
  'INSERT INTO niveau_recompenses (guild_id, niveau, type, valeur, quantite, created_at) VALUES (?, ?, ?, ?, ?, ?)'
);
const supprimerRecStmt = db.prepare('DELETE FROM niveau_recompenses WHERE guild_id = ? AND id = ?');
const oublierRecueStmt = db.prepare('DELETE FROM niveau_recompenses_recues WHERE guild_id = ? AND recompense_id = ?');
const noterRecueStmt = db.prepare(
  'INSERT OR IGNORE INTO niveau_recompenses_recues (guild_id, user_id, recompense_id, at) VALUES (?, ?, ?, ?)'
);
const annulerRecueStmt = db.prepare(
  'DELETE FROM niveau_recompenses_recues WHERE guild_id = ? AND user_id = ? AND recompense_id = ?'
);
const recuesMembreStmt = db.prepare('SELECT recompense_id FROM niveau_recompenses_recues WHERE guild_id = ? AND user_id = ?');

function listerRecompensesNiveau(guildId) {
  return listerRecStmt.all(String(guildId));
}

// 🗡️ Contrat A (src/utils/saoGame.js) — chargé à la demande : saoGame
// importe déjà ce fichier.
function moduleSaoNiveau() {
  try {
    return require('./saoGame');
  } catch {
    return null;
  }
}

// Les récompenses SAO peuvent-elles partir sur ce serveur ?
function saoPretNiveau(guildId) {
  if (!getGuildConfig(String(guildId)).sao_enabled) {
    return { ok: false, raison: 'Aventure SAO désactivée sur ce serveur : récompense ignorée' };
  }
  const S = moduleSaoNiveau();
  if (!S || typeof S.crediterCol !== 'function' || typeof S.donnerObjet !== 'function') {
    return { ok: false, raison: 'l\'Aventure SAO ne sait pas encore verser de récompenses' };
  }
  return { ok: true, S };
}

// Le catalogue d'objets proposables en récompense (≤ 25, pour un menu).
function objetsSaoNiveau() {
  const S = moduleSaoNiveau();
  if (!S || typeof S.objetsRecompensables !== 'function') return [];
  try {
    return (S.objetsRecompensables() || []).filter((o) => o?.cle).slice(0, 25);
  } catch {
    return [];
  }
}

function objetDuCatalogue(cle) {
  const S = moduleSaoNiveau();
  return S?.OBJETS && typeof S.OBJETS === 'object' ? S.OBJETS[cle] || null : undefined;
}

const nombreFr = (n) => Number(n || 0).toLocaleString('fr-FR');

// Ce que dit une récompense, en une ligne.
function libelleRecompenseNiveau(r) {
  const q = Math.max(1, Number(r.quantite) || 1);
  switch (r.type) {
    case 'role':
      return `🎭 <@&${r.valeur}>`;
    case 'role_retrait':
      return `🚫 retrait de <@&${r.valeur}>`;
    case 'col':
      return `💰 **${nombreFr(q)} Col**`;
    case 'objet': {
      const o = objetDuCatalogue(r.valeur);
      return o ? `🎁 **${q} × ${o.emoji ? `${o.emoji} ` : ''}${o.nom}**` : `🎁 **${q} ×** \`${r.valeur}\``;
    }
    case 'mp': {
      const t = String(r.valeur || '').replace(/\s+/g, ' ').trim();
      return `✉️ message privé « ${t.length > 40 ? `${t.slice(0, 39)}…` : t} »`;
    }
    default:
      return `❔ ${r.type}`;
  }
}

function ajouterRecompenseNiveau(guildId, { niveau, type, valeur = null, quantite = 1 } = {}) {
  const gid = String(guildId);
  const n = Number(niveau);
  if (!Number.isInteger(n) || n < 1 || n > NIVEAU_RECOMPENSE_MAX) {
    return { ok: false, erreur: `Le niveau va de 1 à ${NIVEAU_RECOMPENSE_MAX}.` };
  }
  if (!TYPES_RECOMPENSE_NIVEAU[type]) return { ok: false, erreur: 'Type inconnu : role, role_retrait, col, objet ou mp.' };
  const existantes = listerRecompensesNiveau(gid);
  if (existantes.length >= MAX_RECOMPENSES) {
    return { ok: false, erreur: `Déjà ${MAX_RECOMPENSES} récompenses : retirez-en une d'abord.` };
  }
  let v = valeur == null ? null : String(valeur).trim();
  // Une quantité ABSENTE vaut 1 ; une quantité fournie mais illisible
  // (null, « 10k ») est refusée par les bornes — jamais changée en 1.
  let q = Number(quantite);
  if (type === 'role' || type === 'role_retrait') {
    if (!estIdentifiant(v)) return { ok: false, erreur: 'Identifiant de rôle invalide.' };
    q = 1;
  } else if (type === 'col') {
    if (!Number.isInteger(q) || q < 1 || q > 1_000_000) return { ok: false, erreur: 'Le montant de Col va de 1 à 1 000 000.' };
    v = null;
  } else if (type === 'objet') {
    if (!/^[\w-]{1,64}$/.test(v || '')) return { ok: false, erreur: 'Clé d\'objet invalide.' };
    if (!Number.isInteger(q) || q < 1 || q > 999) return { ok: false, erreur: 'La quantité va de 1 à 999.' };
    // Catalogue disponible : une clé inconnue est refusée tout de suite.
    if (objetDuCatalogue(v) === null) return { ok: false, erreur: `L'objet « ${v} » n'existe pas dans le catalogue SAO.` };
  } else if (type === 'mp') {
    if (!v) return { ok: false, erreur: 'Le message privé est vide.' };
    if (v.length > 1500) return { ok: false, erreur: 'Le message privé fait plus de 1500 signes.' };
    q = 1;
  }
  if (existantes.some((r) => r.niveau === n && r.type === type && (r.valeur ?? null) === v && type !== 'col')) {
    return { ok: false, erreur: 'Cette récompense existe déjà pour ce niveau.' };
  }
  const id = Number(insererRecStmt.run(gid, n, type, v, q, new Date().toISOString()).lastInsertRowid);
  return { ok: true, id };
}

function supprimerRecompenseNiveau(guildId, id) {
  const gid = String(guildId);
  const fait = supprimerRecStmt.run(gid, Number(id)).changes > 0;
  if (fait) oublierRecueStmt.run(gid, Number(id));
  return fait;
}

// ── Compatibilité avec l'ancienne API (un rôle par niveau) ──────────────
const recompensesDe = (guildId) =>
  listerRecompensesNiveau(guildId).map((r) => ({ ...r, level: r.niveau, role_id: r.type === 'role' ? r.valeur : null }));
function definirRecompense(guildId, level, roleId) {
  return ajouterRecompenseNiveau(guildId, { niveau: Number(level), type: 'role', valeur: roleId });
}
// Retire TOUTES les récompenses d'un niveau.
function effacerRecompense(guildId, level) {
  const aRetirer = listerRecompensesNiveau(guildId).filter((r) => r.niveau === Number(level));
  for (const r of aRetirer) supprimerRecompenseNiveau(guildId, r.id);
  return aRetirer.length > 0;
}

// Les récompenses du prochain palier au-dessus de `niveau`.
function prochaineRecompenseNiveau(guildId, niveau) {
  const suivantes = listerRecompensesNiveau(guildId).filter((r) => r.niveau > niveau);
  if (!suivantes.length) return null;
  const palier = suivantes[0].niveau;
  return { niveau: palier, recompenses: suivantes.filter((r) => r.niveau === palier) };
}

// ── L'état voulu des rôles ──────────────────────────────────────────────
//
// On rejoue les paliers dans l'ordre : un « rôle donné » le veut, un « rôle
// retiré » ne le veut plus, le dernier mot l'emporte. En mode remplacement,
// seuls les rôles du plus haut palier atteint sont voulus. À la baisse, les
// rôles des paliers non atteints ne sont plus voulus.
//
// `ancien` : le niveau d'avant la baisse, quand on le connaît. Seuls les
// paliers PERDUS (au-dessus du niveau, mais atteints autrefois) sont alors
// repris : un rôle de palier jamais atteint — donné à la main, pour un
// événement — n'a pas à disparaître parce que la courbe a changé. Sans
// ancien niveau (/xp synchroniser), tout ce qui est au-dessus est repris.
//
// `attribuable(roleId)` : en mode remplacement, le « plus haut palier » est
// le plus haut dont le rôle peut VRAIMENT être donné. Un rôle supprimé, ou
// passé au-dessus du mien, ne doit pas faire retirer celui d'en dessous :
// le membre se retrouverait sans aucun rôle de palier.
function planRolesNiveau(recompenses, niveau, { cumul = true, baisse = false, attribuable = null, ancien = null } = {}) {
  const atteintes = recompenses.filter((r) => r.niveau <= niveau);
  // (Le plus haut palier ne compte qu'en mode remplacement : en cumul, on
  // ne demande rien à `attribuable`.)
  const donnes = atteintes.filter((r) => r.type === 'role' && (cumul || !attribuable || attribuable(r.valeur)));
  const plusHaut = donnes.length ? Math.max(...donnes.map((r) => r.niveau)) : null;
  const voulu = new Map();
  for (const r of atteintes) {
    if (r.type === 'role') voulu.set(r.valeur, { veut: cumul || r.niveau === plusHaut, r });
    else if (r.type === 'role_retrait') voulu.set(r.valeur, { veut: false, r });
  }
  if (baisse) {
    const borne = Number.isInteger(ancien) ? ancien : Infinity;
    for (const r of recompenses) {
      if (r.type === 'role' && r.niveau > niveau && r.niveau <= borne && !voulu.has(r.valeur)) voulu.set(r.valeur, { veut: false, r, perdu: true });
    }
  }
  return voulu;
}

// 🛡️ Les permissions qu'un palier de niveau ne distribue JAMAIS. Le bot a
// presque toujours « Administrateur » : pour Discord, il peut donc donner
// tout rôle placé sous le sien. Sans ce garde-fou, un rôle de modération (ou
// l'administration elle-même) posé en récompense partait chez quiconque
// atteignait le niveau — et « retrait » l'enlevait aux admins.
const PERMISSIONS_SENSIBLES = [
  ['Administrator', 'Administrateur'],
  ['ManageGuild', 'Gérer le serveur'],
  ['ManageRoles', 'Gérer les rôles'],
  ['ManageChannels', 'Gérer les salons'],
  ['ManageWebhooks', 'Gérer les webhooks'],
  ['BanMembers', 'Bannir des membres'],
  ['KickMembers', 'Expulser des membres'],
  ['ModerateMembers', 'Exclure temporairement des membres'],
  ['MentionEveryone', 'Mentionner @everyone, @here et tous les rôles'],
  ['ManageMessages', 'Gérer les messages'],
  ['ManageThreads', 'Gérer les fils'],
  ['ManageNicknames', 'Gérer les pseudos'],
  ['ManageGuildExpressions', 'Gérer les expressions'],
  ['MuteMembers', 'Rendre les membres muets'],
  ['DeafenMembers', 'Mettre en sourdine des membres'],
  ['MoveMembers', 'Déplacer des membres'],
];

// Pourquoi ce rôle ne peut PAS être une récompense de niveau : une
// permission sensible, ou un rôle staff / admin du bot (il ouvrirait /config
// et /xp à quiconque atteint le palier). Rend la raison, ou null.
function risqueRoleNiveau(guild, role) {
  if (!role) return null;
  const perms = role.permissions;
  if (perms && typeof perms.has === 'function') {
    for (const [cle, nom] of PERMISSIONS_SENSIBLES) {
      const bit = PermissionFlagsBits[cle];
      if (bit !== undefined && perms.has(bit, false)) return `il porte la permission « ${nom} »`;
    }
  }
  try {
    const P = require('./permissions');
    const cfg = getGuildConfig(String(guild?.id));
    if (P.adminRoleIds(cfg).includes(String(role.id))) return 'c\'est un rôle d\'administration du bot';
    if (P.staffRoleIds(cfg).includes(String(role.id))) return 'c\'est un rôle staff du bot';
  } catch {}
  return null;
}

// Le bot peut-il gérer les rôles ? Un `me` sans permissions connues (cache
// incomplet) ne bloque rien : Discord tranchera.
function peutGererRoles(moi) {
  return !moi?.permissions || typeof moi.permissions.has !== 'function' || moi.permissions.has(PermissionFlagsBits.ManageRoles);
}

// Pourquoi ce rôle ne bouge pas, ou null s'il peut être donné et retiré.
function raisonInattribuable(guild, role) {
  const moi = guild?.members?.me;
  if (!role) return 'rôle disparu';
  if (role.managed) return 'rôle géré par une intégration';
  if (!moi) return 'je ne me vois pas sur ce serveur';
  if (!peutGererRoles(moi)) return 'je n\'ai pas la permission « Gérer les rôles »';
  if (!(role.position < (moi.roles?.highest?.position ?? -Infinity))) return 'rôle au-dessus du mien';
  const risque = risqueRoleNiveau(guild, role);
  if (risque) return `rôle sensible, jamais distribué : ${risque}`;
  return null;
}

function roleAttribuable(guild, role) {
  return !raisonInattribuable(guild, role);
}

// ⛔ Un rôle que Discord vient de refuser n'est pas redemandé à chaque gain
// (chaque minute de vocal, chaque message) : 10 minutes de répit. La
// synchronisation et un vrai passage de niveau, eux, réessaient.
//
// Pendant le répit, un rattrapage tient le rôle pour NON attribuable, dans
// le plan lui-même : en mode remplacement, le « plus haut palier » retombe
// sur celui d'en dessous, que le membre porte déjà — plus rien à faire.
// Sans cela, l'ancien palier passait pour « à retirer », relançait le
// rattrapage, et le rôle refusé était redemandé à chaque gain.
const REPIT_REFUS = 10 * 60 * 1000;
const refusRecents = new Map();
const cleRefus = (gid, roleId) => `${gid}:${roleId}`;
function refusRecent(gid, roleId) {
  const quand = refusRecents.get(cleRefus(gid, roleId));
  if (!quand) return false;
  if (Date.now() - quand < REPIT_REFUS) return true;
  refusRecents.delete(cleRefus(gid, roleId));
  return false;
}

// Le contrôle commun à /config et au tableau de bord, en plus de la position
// et des intégrations : le bot doit pouvoir gérer les rôles, et le rôle ne
// doit porter aucun pouvoir. Rend un message prêt à afficher, ou null.
function refusRoleRecompense(guild, role) {
  if (!peutGererRoles(guild?.members?.me)) {
    return 'Je n\'ai pas la permission « Gérer les rôles » : je ne pourrais ni donner ni retirer ce rôle.\n'
      + '➜ Donnez-la à mon rôle dans Paramètres du serveur → Rôles, puis réessayez.';
  }
  const risque = risqueRoleNiveau(guild, role);
  if (risque) {
    return `Le rôle ${role?.name || role?.id || ''} ne peut pas être une récompense de niveau : ${risque}.\n`
      + '➜ Un palier ne distribue ni ne retire de pouvoirs : choisissez un rôle sans permission sensible.';
  }
  return null;
}

// Reste-t-il quelque chose à donner ? Sans réseau : la base et le cache des
// rôles du membre suffisent. Sert au rattrapage « au prochain gain ».
function recompensesEnAttente(guild, membre, niveau) {
  if (!guild?.id) return false;
  const recompenses = listerRecompensesNiveau(guild.id);
  if (!recompenses.some((r) => r.niveau <= niveau)) return false;
  const roles = membre?.roles?.cache;
  if (roles) {
    const cumul = Number(getGuildConfig(guild.id).level_rewards_stack ?? 1) !== 0;
    const attribuable = (id) => roleAttribuable(guild, guild.roles?.cache?.get(id)) && !refusRecent(String(guild.id), id);
    for (const [roleId, v] of planRolesNiveau(recompenses, niveau, { cumul, attribuable })) {
      if (v.veut === Boolean(roles.has(roleId))) continue;
      if (attribuable(roleId)) return true;
    }
  }
  const unique = recompenses.filter((r) => r.niveau <= niveau && (r.type === 'col' || r.type === 'objet'));
  if (!unique.length || !saoPretNiveau(guild.id).ok) return false;
  const uid = String(membre?.id || '');
  if (!uid) return false;
  const recues = new Set(recuesMembreStmt.all(String(guild.id), uid).map((x) => x.recompense_id));
  return unique.some((r) => !recues.has(r.id));
}

// Applique les récompenses au membre. Rend ce qui a bougé, pour l'annonce.
// Ne lève jamais : une récompense ratée ne doit pas emporter le gain d'XP.
//
// `ancien` : le niveau d'avant (une baisse reprend des rôles, un MP part pour
// les paliers franchis). `synchro` : rattrapage, sans message privé.
// `realigner` : reprendre AUSSI les rôles des paliers au-dessus du niveau
// (ce que fait /xp synchroniser) — un rattrapage ordinaire ne le fait pas :
// un rôle donné à la main ne doit pas disparaître au premier message.
async function appliquerRecompenses(guild, userId, niveau, { ancien = null, membre = null, synchro = false, realigner = false } = {}) {
  const bilan = { donnes: [], retires: [], ignores: [] };
  try {
    const gid = String(guild.id);
    const uid = String(userId);
    const recompenses = listerRecompensesNiveau(gid);
    if (!recompenses.length) return bilan;
    // Le membre fourni ne sert que s'il s'agit bien de `userId`.
    const fourni = membre?.roles && String(membre.id) === uid ? membre : null;
    const m = fourni || (await guild.members.fetch(uid).catch(() => null));
    if (!m) return bilan;
    const cfg = getGuildConfig(gid);
    const cumul = Number(cfg.level_rewards_stack ?? 1) !== 0;
    const baisse = realigner || (Number.isInteger(ancien) && ancien > niveau);
    const fiche = (r, extra = {}) => ({ id: r.id, niveau: r.niveau, level: r.niveau, type: r.type, libelle: libelleRecompenseNiveau(r), ...extra });

    // 🎭 Rôles — d'abord ce qu'on donne, ensuite ce qu'on retire : en mode
    // remplacement, l'ancien palier ne part que si le nouveau est bien posé.
    const roleDe = async (id) => guild.roles.cache.get(id) || (await guild.roles.fetch(id).catch(() => null));
    // Un simple rattrapage (ni passage de niveau, ni baisse, ni /xp
    // synchroniser) laisse en paix un rôle encore en répit.
    const rattrapage = synchro && !baisse;
    const enRepit = (id) => rattrapage && refusRecent(gid, id);
    const attribuable = (id) => roleAttribuable(guild, guild.roles.cache.get(id)) && !enRepit(id);
    // Les paliers perdus seulement — bornés par l'ancien niveau. /xp
    // synchroniser (realigner), sans ancien niveau, reprend tout le dessus.
    const plan = [...planRolesNiveau(recompenses, niveau, { cumul, baisse, attribuable, ancien: realigner ? null : ancien })];
    let nouveauManque = false;
    for (const [roleId, v] of [...plan.filter(([, x]) => x.veut), ...plan.filter(([, x]) => !x.veut)]) {
      const aDeja = m.roles.cache.has(roleId);
      if (v.veut === aDeja) continue;
      if (enRepit(roleId)) continue;
      const role = await roleDe(roleId);
      // Un rôle disparu, géré, sensible, ou plus haut que le mien ne bouge
      // pas : le diagnostic de /config le dit, on passe au suivant sans bruit.
      const raisonRole = raisonInattribuable(guild, role);
      if (raisonRole) {
        bilan.ignores.push(fiche(v.r, { raison: raisonRole }));
        continue;
      }
      if (v.veut) {
        if (await m.roles.add(role, `Récompense du niveau ${v.r.niveau}`).then(() => true).catch(() => false)) {
          bilan.donnes.push(fiche(v.r, { role }));
        } else {
          refusRecents.set(cleRefus(gid, roleId), Date.now());
          bilan.ignores.push(fiche(v.r, { raison: 'Discord a refusé (permission manquante ?)' }));
          if (v.r.type === 'role') nouveauManque = true;
        }
      } else {
        // Le rôle du palier supérieur n'a pas pu être posé : on garde celui
        // d'en dessous plutôt que de laisser le membre sans rien.
        if (nouveauManque && v.r.type === 'role' && !v.perdu) continue;
        const raison = v.r.type === 'role_retrait'
          ? `Récompense du niveau ${v.r.niveau} : rôle retiré`
          : v.perdu ? 'Palier de niveau perdu' : 'Palier de niveau dépassé';
        if (await m.roles.remove(role, raison).then(() => true).catch(() => false)) {
          // Un rôle retiré PAR une récompense se fête ; un palier remplacé ou
          // perdu, non.
          if (v.r.type === 'role_retrait') bilan.donnes.push(fiche(v.r, { role }));
          else bilan.retires.push(fiche(v.r, { role }));
        } else {
          refusRecents.set(cleRefus(gid, roleId), Date.now());
          bilan.ignores.push(fiche(v.r, { raison: 'Discord a refusé (permission manquante ?)' }));
        }
      }
    }

    // 💰 🎁 ✉️ Ce qui ne se donne qu'une fois
    const recues = new Set(recuesMembreStmt.all(gid, uid).map((x) => x.recompense_id));
    const depuis = Number.isInteger(ancien) ? ancien : niveau - 1;
    let sao = null;
    for (const r of recompenses) {
      if (r.niveau > niveau || recues.has(r.id) || !['col', 'objet', 'mp'].includes(r.type)) continue;
      if (r.type === 'mp' && (synchro || r.niveau <= depuis)) continue;
      if (r.type !== 'mp') {
        sao ||= saoPretNiveau(gid);
        if (!sao.ok) {
          bilan.ignores.push(fiche(r, { raison: sao.raison }));
          continue;
        }
      }
      // On réserve d'abord : deux gains simultanés ne verseront pas deux fois.
      if (!noterRecueStmt.run(gid, uid, r.id, new Date().toISOString()).changes) continue;
      let ok = false;
      try {
        if (r.type === 'col') {
          sao.S.crediterCol(gid, uid, Math.max(1, Number(r.quantite) || 1));
          ok = true;
        } else if (r.type === 'objet') {
          ok = sao.S.donnerObjet(gid, uid, r.valeur, Math.max(1, Number(r.quantite) || 1)) !== false;
        } else {
          // Un MP refusé (messages privés fermés) reste noté : le réessayer à
          // chaque gain reviendrait à relancer quelqu'un qui ne veut rien.
          await envoyerMpNiveau(guild, m, r);
          ok = true;
        }
      } catch {
        ok = false;
      }
      if (!ok) {
        annulerRecueStmt.run(gid, uid, r.id);
        bilan.ignores.push(fiche(r, { raison: r.type === 'objet' ? 'objet inconnu du catalogue SAO' : 'versement refusé' }));
        continue;
      }
      bilan.donnes.push(fiche(r));
    }
    return bilan;
  } catch {
    return bilan;
  }
}

// Le message privé d'un palier : {niveau} est celui du PALIER, même quand le
// membre en a sauté plusieurs d'un coup.
async function envoyerMpNiveau(guild, membre, r) {
  const user = membre.user || (await guild.client?.users?.fetch?.(membre.id).catch(() => null));
  if (!user?.send) return false;
  const texte = rendreMessageNiveau(r.valeur, variablesNiveau(guild, membre.id, { niveau: r.niveau, ancien: r.niveau - 1, membre, mention: true }));
  const embed = new EmbedBuilder().setColor(COLORS.SUCCESS).setTitle(`🏅 Niveau ${r.niveau} sur ${guild.name}`).setDescription(texte);
  return user.send({ embeds: [embed] }).then(() => true).catch(() => false);
}

// 🩺 Pourquoi une récompense n'a pas été donnée. Le staff configure, rien
// n'arrive, et rien n'explique pourquoi : ce diagnostic est le seul endroit
// d'où la cause se voit.
function diagnostiquerRecompenses(guild) {
  const moi = guild.members?.me;
  const sao = saoPretNiveau(guild.id);
  return listerRecompensesNiveau(guild.id).map((r) => {
    let souci = null;
    let nom = null;
    if (r.type === 'role' || r.type === 'role_retrait') {
      const role = guild.roles?.cache?.get(r.valeur);
      nom = role?.name || null;
      if (!role) souci = 'ce rôle n\'existe plus';
      else if (role.managed) souci = 'rôle géré par une intégration — inattribuable';
      else if (!moi) souci = 'je ne me vois pas sur ce serveur';
      else if (!peutGererRoles(moi)) souci = 'je n\'ai pas la permission « Gérer les rôles » : aucun rôle ne peut être donné';
      else if (role.position >= moi.roles.highest.position) souci = 'ce rôle est au-dessus du mien';
      else {
        const risque = risqueRoleNiveau(guild, role);
        if (risque) souci = `rôle sensible, jamais distribué : ${risque}`;
      }
    } else if (r.type === 'col' || r.type === 'objet') {
      if (!sao.ok) souci = sao.raison;
      else if (r.type === 'objet' && objetDuCatalogue(r.valeur) === null) souci = 'objet inconnu du catalogue SAO';
    } else if (r.type === 'mp' && !String(r.valeur || '').trim()) souci = 'message vide';
    const estRole = r.type === 'role' || r.type === 'role_retrait';
    return {
      id: r.id, level: r.niveau, niveau: r.niveau, type: r.type, valeur: r.valeur, quantite: r.quantite,
      roleId: estRole ? r.valeur : null, nom, libelle: libelleRecompenseNiveau(r), souci,
    };
  });
}

// ══════════════════════════════════════════════════════════════════
// 📢 ANNONCES
// ══════════════════════════════════════════════════════════════════

// 'salon' | 'ici' | 'mp' | 'off'. NULL = l'ancien comportement : le salon
// des niveaux s'il est réglé, sinon rien.
function modeAnnonceNiveau(cfg) {
  const m = cfg.level_annonce;
  if (['salon', 'ici', 'mp', 'off'].includes(m)) return m;
  return cfg.level_channel_id ? 'salon' : 'off';
}

function variablesNiveau(guild, userId, { niveau, ancien = null, membre = null, recompenses = [], mention = true } = {}) {
  const m = membre || guild.members?.cache?.get?.(String(userId)) || null;
  const pseudo = m?.displayName || m?.user?.globalName || m?.user?.username || 'Membre';
  const row = getLevels(guild.id, userId);
  const rang = rangNiveau(guild.id, userId);
  return {
    membre: mention ? `<@${userId}>` : `**${pseudo}**`,
    pseudo,
    niveau: String(niveau),
    ancien_niveau: String(ancien ?? Math.max(0, niveau - 1)),
    xp: nombreFr(row.xp || 0),
    rang: rang ? String(rang) : '—',
    recompenses: recompenses.length ? recompenses.map((r) => r.libelle).join(', ') : 'aucune',
    serveur: guild.name || '',
  };
}

// Les balises D'ABORD, les variables ENSUITE : un pseudo contenant « && »
// ne doit pas devenir une barre. Les remplacements passent par une fonction :
// un pseudo contenant « $& » ne doit pas être interprété non plus.
function rendreMessageNiveau(modele, vars) {
  const alias = { user: 'membre', 'user.mention': 'membre', 'user.username': 'pseudo', level: 'niveau', server: 'serveur' };
  return String(balises.appliquer(String(modele || '')) || '').replace(/\{([\w.]+)\}/g, (tout, nom) => {
    const cle = alias[nom] || nom;
    return Object.prototype.hasOwnProperty.call(vars, cle) ? vars[cle] : tout;
  });
}

// Le texte d'une annonce de passage de niveau.
function texteAnnonceNiveau(guild, userId, { source, niveau, ancien, recompenses = [], membre = null, cfg }) {
  const mention = Number(cfg.level_mention ?? 1) !== 0;
  const vars = variablesNiveau(guild, userId, { niveau, ancien, membre, recompenses, mention });
  const modele = String(cfg.level_message || '').trim();
  if (modele) {
    const texte = rendreMessageNiveau(modele, vars);
    // Le modèle ne cite pas les récompenses : on les ajoute, sans quoi elles
    // passeraient inaperçues.
    if (recompenses.length && !/\{recompenses\}/.test(modele)) {
      return `${texte}\n🏅 Récompenses débloquées :\n${recompenses.map((r) => `➜ ${r.libelle}`).join('\n')}`;
    }
    return texte;
  }
  const origine = SOURCES_XP[source] || SOURCES_XP.text;
  const saut = niveau - ancien > 1 ? `+${niveau - ancien} niveaux, ` : '';
  const lignes = [`🎉 ${vars.membre} passe au **niveau ${niveau}** ! *(${saut}${origine})*`];
  if (recompenses.length === 1) lignes.push(`🏅 Récompense débloquée : ${recompenses[0].libelle}`);
  else if (recompenses.length > 1) {
    lignes.push('🏅 Récompenses débloquées :', ...recompenses.map((r) => `➜ ${r.libelle}`));
  }
  return lignes.join('\n');
}

async function salonAnnonceNiveau(guild, cfg, mode, fallbackChannel) {
  const ouvert = (s) => (s?.isTextBased?.() ? s : null);
  const dedie = cfg.level_channel_id ? await guild.channels.fetch(cfg.level_channel_id).catch(() => null) : null;
  if (mode === 'salon') return ouvert(dedie) || ouvert(fallbackChannel);
  return ouvert(fallbackChannel) || ouvert(dedie);
}

// Annonce un passage de niveau (et donne les récompenses AVANT, sans
// condition d'annonce : un serveur qui n'annonce rien doit quand même donner
// ses rôles). Rend { annonce, recompenses }.
async function announceLevelUp(guild, userId, source, newLevel, fallbackChannel = null, oldLevel = null) {
  if (!guild?.id || !levelsEnabled(guild.id)) return { annonce: false, recompenses: null };
  const ancien = Number.isInteger(oldLevel) ? oldLevel : Math.max(0, newLevel - 1);
  const recompenses = await appliquerRecompenses(guild, userId, newLevel, { ancien });
  try {
    const cfg = getGuildConfig(guild.id);
    const mode = modeAnnonceNiveau(cfg);
    if (mode === 'off') return { annonce: false, recompenses };
    // Tous les N niveaux — mais un palier récompensé s'annonce toujours.
    const pas = Math.max(1, Number(cfg.level_annonce_pas ?? 1) || 1);
    let franchi = false;
    for (let n = ancien + 1; n <= newLevel; n++) if (n % pas === 0) franchi = true;
    if (!franchi && !recompenses.donnes.length) return { annonce: false, recompenses };

    const texte = texteAnnonceNiveau(guild, userId, { source, niveau: newLevel, ancien, recompenses: recompenses.donnes, cfg });
    const embed = new EmbedBuilder().setColor(COLORS.SUCCESS).setDescription(texte);
    const mention = Number(cfg.level_mention ?? 1) !== 0;
    if (mode === 'mp') {
      const user = guild.members?.cache?.get?.(String(userId))?.user || (await guild.client?.users?.fetch?.(String(userId)).catch(() => null));
      if (!user?.send) return { annonce: false, recompenses };
      embed.setTitle(`🎉 ${guild.name}`);
      const ok = await user.send({ embeds: [embed] }).then(() => true).catch(() => false);
      return { annonce: ok, recompenses };
    }
    const salon = await salonAnnonceNiveau(guild, cfg, mode, fallbackChannel);
    if (!salon) return { annonce: false, recompenses };
    await salon.send({ embeds: [embed], allowedMentions: mention ? { users: [String(userId)] } : { parse: [] } });
    return { annonce: true, recompenses };
  } catch {
    // l'annonce ne doit jamais faire planter le flux d'XP
    return { annonce: false, recompenses };
  }
}

// 🎁 Pour les autres modules (mini-jeux, comptage, mariage, SAO) : ajoute
// l'XP, annonce, donne les récompenses. Ne lève JAMAIS.
//
// `contexte.membre` n'est cru que s'il s'agit bien de `userId` : un bouton
// cliqué par B peut faire gagner A (le duel SAO), et les rôles de palier de
// A partaient alors chez B. Sans membre fiable, on prend celui du cache du
// serveur — sans appel réseau — pour que les exclusions et multiplicateurs
// de rôle s'appliquent à TOUTES les sources (jeux, couple, raids…).
function membreDuGain(guild, userId, membre) {
  const uid = String(userId);
  if (membre && String(membre.id) === uid) return membre;
  return guild?.members?.cache?.get?.(uid) || null;
}

async function gagnerXpServeur(guild, userId, source, amount, contexte = {}) {
  const neutre = { leveledUp: false, leveledDown: false, newLevel: 0, oldLevel: 0, gagne: 0 };
  try {
    if (!guild?.id) return neutre;
    const membre = membreDuGain(guild, userId, contexte?.membre);
    const ctx = { ...(contexte || {}), membre };
    const res = addXp(guild.id, userId, source, amount, ctx);
    // Une nouvelle courbe (ou un niveau maximum abaissé) a fait perdre des
    // niveaux : les rôles des paliers perdus sont repris en arrière-plan.
    if (baissesEnAttente(guild.id)) realignerBaisses(guild).catch(() => null);
    if (res.leveledUp) {
      await announceLevelUp(guild, userId, source, res.newLevel, ctx.salon || null, res.oldLevel);
    } else if (res.leveledDown) {
      await appliquerRecompenses(guild, userId, res.newLevel, { ancien: res.oldLevel, membre });
    } else if (res.gagne > 0 && recompensesEnAttente(guild, membre || { id: String(userId) }, res.newLevel)) {
      // Rattrapage : une récompense ajoutée après coup arrive au prochain gain.
      await appliquerRecompenses(guild, userId, res.newLevel, { membre, synchro: true });
    }
    return res;
  } catch {
    return neutre;
  }
}

// 📉 Reprend les rôles des paliers que les membres ont perdus quand la règle
// a changé (courbe plus raide, niveau maximum abaissé). Un seul passage à la
// fois par serveur ; la liste est vidée AVANT, pour qu'un nouveau
// changement pendant le passage soit traité au suivant.
const baissesEnCours = new Set();
async function realignerBaisses(guild) {
  const gid = String(guild?.id || '');
  const bilan = { membres: 0, retires: 0 };
  if (!gid || baissesEnCours.has(gid)) return bilan;
  const baisses = lireBaisses(gid);
  if (!Object.keys(baisses).length) return bilan;
  baissesEnCours.add(gid);
  try {
    effacerEtat.run(cleBaisses(gid));
    if (!listerRecompensesNiveau(gid).some((r) => r.type === 'role')) return bilan;
    for (const [uid, ancien] of Object.entries(baisses)) {
      const niveau = getStmt.get(gid, uid)?.level || 0;
      if (!(Number(ancien) > niveau)) continue;
      const membre = guild.members?.cache?.get?.(uid) || (await guild.members?.fetch?.(uid).catch(() => null)) || null;
      if (!membre) continue;
      const r = await appliquerRecompenses(guild, uid, niveau, { ancien: Number(ancien), membre, synchro: true });
      bilan.membres++;
      bilan.retires += r.retires.length;
    }
    return bilan;
  } finally {
    baissesEnCours.delete(gid);
  }
}

// ══════════════════════════════════════════════════════════════════
// 🎙️ LA MINUTE DE VOCAL
// ══════════════════════════════════════════════════════════════════
//
// Appelée chaque minute par src/events/ready.js. Anti-AFK :
//  • salon AFK, bots : jamais ;
//  • muet ou sourd (casque coupé, par soi-même ou par le serveur) : rien,
//    sauf si `xp_vocal_muet = 1` ;
//  • seul, ou seul humain avec des bots : rien, sauf si `xp_vocal_seul = 1`.
async function distribuerXpVocale(guild) {
  const cfg = getGuildConfig(guild.id);
  if (cfg.levels_enabled === 0) return 0;
  const muetOk = Number(cfg.xp_vocal_muet ?? 0) === 1;
  const seulOk = Number(cfg.xp_vocal_seul ?? 0) === 1;
  const etats = [...(guild.voiceStates?.cache?.values?.() || [])];
  const humain = (vs) => vs.channelId && vs.member && !vs.member.user?.bot;
  const envois = [];
  for (const vs of etats) {
    if (!humain(vs) || vs.channelId === guild.afkChannelId) continue;
    const muet = Boolean(vs.mute || vs.deaf || vs.selfMute || vs.selfDeaf || vs.serverMute || vs.serverDeaf);
    if (muet && !muetOk) continue;
    if (!seulOk && etats.filter((o) => humain(o) && o.channelId === vs.channelId).length < 2) continue;
    const salon = vs.channel || guild.channels?.cache?.get?.(vs.channelId) || null;
    envois.push(gagnerXpServeur(guild, vs.member.id, 'voice', Number(cfg.xp_voice ?? 20), { membre: vs.member, salon }));
  }
  await Promise.allSettled(envois);
  return envois.length;
}

// ══════════════════════════════════════════════════════════════════
// 🛠️ ADMINISTRATION
// ══════════════════════════════════════════════════════════════════

const effacerMembreStmt = db.prepare('DELETE FROM levels WHERE guild_id = ? AND user_id = ?');
const effacerRecuesMembreStmt = db.prepare('DELETE FROM niveau_recompenses_recues WHERE guild_id = ? AND user_id = ?');
const lignesAvecNiveau = db.prepare('SELECT user_id, level, xp, parti FROM levels WHERE guild_id = ? AND level > 0 ORDER BY xp DESC');
// La synchronisation visite aussi le niveau 0 qui a de l'XP : une courbe
// plus raide peut y avoir ramené un membre qui porte encore ses rôles.
const lignesASynchroniser = db.prepare(
  'SELECT user_id, level, xp, parti FROM levels WHERE guild_id = ? AND (level > 0 OR xp > 0) ORDER BY xp DESC'
);
const effacerServeurStmt = db.prepare('DELETE FROM levels WHERE guild_id = ?');
const effacerRecuesServeurStmt = db.prepare('DELETE FROM niveau_recompenses_recues WHERE guild_id = ?');

// Remise à zéro d'un membre. Rend l'ancienne ligne.
//
// Décidée par un admin (/xp reset), elle vide aussi le registre des
// récompenses : celui qui recommence regagnera ses paliers. Au DÉPART d'un
// membre (`garderRegistre`), jamais : quitter puis revenir reversait le Col
// et les objets à chaque aller-retour.
function effacerXpMembre(guildId, userId, { garderRegistre = false } = {}) {
  const avant = getStmt.get(String(guildId), String(userId)) || null;
  effacerMembreStmt.run(String(guildId), String(userId));
  if (!garderRegistre) effacerRecuesMembreStmt.run(String(guildId), String(userId));
  return avant;
}

// Remise à zéro de tout le serveur. Rend les membres qui avaient un niveau
// (pour leur reprendre les rôles de récompense).
function effacerXpServeur(guildId) {
  const avaient = lignesAvecNiveau.all(String(guildId));
  db.transaction(() => {
    effacerServeurStmt.run(String(guildId));
    effacerRecuesServeurStmt.run(String(guildId));
  })();
  return avaient;
}

// 🔁 Réapplique les récompenses à tous les membres qui ont de l'XP, et
// RÉALIGNE : les rôles des paliers au-dessus de leur niveau sont repris (une
// courbe plus raide, un niveau maximum abaissé). Peut être long (un appel à
// Discord par rôle à poser) : l'appelant répond par `repondreVite`. Un seul
// passage à la fois par serveur.
const synchroEnCours = new Set();
async function synchroniserNiveaux(guild) {
  const gid = String(guild.id);
  const bilan = { membres: 0, donnes: 0, retires: 0, ignores: 0, partis: 0, enCours: false };
  if (synchroEnCours.has(gid)) return { ...bilan, enCours: true };
  synchroEnCours.add(gid);
  try {
    verifierCourbe(gid);
    // Tous les membres d'un coup quand Discord le permet : sinon, un par un.
    let minuteur = null;
    await Promise.race([
      guild.members.fetch().catch(() => null),
      new Promise((r) => { minuteur = setTimeout(r, 8000); }),
    ]);
    clearTimeout(minuteur);
    // Le réalignement de tous couvre les baisses en attente.
    effacerEtat.run(cleBaisses(gid));
    for (const l of lignesASynchroniser.all(gid)) {
      const membre = guild.members.cache.get(l.user_id) || (await guild.members.fetch(l.user_id).catch(() => null));
      if (!membre) {
        if (!l.parti) marquerParti.run(1, gid, l.user_id);
        bilan.partis++;
        continue;
      }
      if (l.parti) marquerParti.run(0, gid, l.user_id);
      bilan.membres++;
      const r = await appliquerRecompenses(guild, l.user_id, l.level, { membre, synchro: true, realigner: true });
      bilan.donnes += r.donnes.length;
      bilan.retires += r.retires.length;
      bilan.ignores += r.ignores.length;
    }
    return bilan;
  } finally {
    synchroEnCours.delete(gid);
  }
}

module.exports = {
  xpForLevel, totalXpForLevel, levelFromXp, addXp, getLevels, getLeaderboard,
  announceLevelUp, levelsEnabled, gagnerXpServeur,
  recompensesDe, definirRecompense, effacerRecompense, appliquerRecompenses, diagnostiquerRecompenses,
  COURBES_XP, SOURCES_XP, PORTEES_XP, TYPES_RECOMPENSE_NIVEAU, NIVEAU_RECOMPENSE_MAX,
  MAX_EXCLUSIONS_PAR_PORTEE, MAX_MULTIPLICATEURS, MAX_RECOMPENSES,
  courbeXpDe, recalculerNiveaux, realignerBaisses, baissesEnAttente, gainTexteXp, estWeekEndParis, boostXpActif,
  listerExclusionsXp, ajouterExclusionXp, retirerExclusionXp, remplacerExclusionsXp, estExcluXp,
  listerMultiplicateursXp, definirMultiplicateurXp, retirerMultiplicateurXp, multiplicateursXp,
  listerRecompensesNiveau, ajouterRecompenseNiveau, supprimerRecompenseNiveau, libelleRecompenseNiveau,
  prochaineRecompenseNiveau, recompensesEnAttente, saoPretNiveau, objetsSaoNiveau, planRolesNiveau,
  roleAttribuable, raisonInattribuable, risqueRoleNiveau, refusRoleRecompense, PERMISSIONS_SENSIBLES,
  modeAnnonceNiveau, variablesNiveau, rendreMessageNiveau, texteAnnonceNiveau,
  classementNiveaux, rangNiveau, marquerDepartNiveau, noterAbsenceNiveau,
  distribuerXpVocale, effacerXpMembre, effacerXpServeur, synchroniserNiveaux,
};
