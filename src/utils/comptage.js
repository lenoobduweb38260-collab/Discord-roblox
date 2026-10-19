const { db, getGuildConfig } = require('../database');

// 🔢 Salon de comptage.
//
// Les membres comptent 1, 2, 3… à tour de rôle. Un mauvais nombre — ou la
// même personne deux fois de suite — casse la série : le compte retombe à 0.
//
// Trois choses qui ne vont pas de soi :
//
//  • Les messages d'un salon sont jugés UN PAR UN, dans l'ordre (file de
//    promesses par salon). Sans elle, deux « 6 » postés à la même seconde
//    étaient tous deux lus contre l'état « 5 » : deux ✅ pour un seul nombre.
//  • L'état vit en BASE (table comptage) : un redémarrage du bot ne remet
//    pas le compte à zéro, et ne fait pas oublier qui a compté en dernier.
//  • Les calculs (`comptage_maths`) passent par un petit évaluateur maison,
//    jamais par `eval` : un message de membre n'exécute JAMAIS de code. Il ne
//    connaît que des entiers, + - × / ^ et des parenthèses, et refuse tout
//    ce qui est trop long, trop profond ou trop grand.

// ── Bornes de l'évaluateur ────────────────────────────────────────────────
const LONGUEUR_MAX_EXPRESSION = 100; // signes lus au plus en tête de message
const JETONS_MAX = 60;
const PROFONDEUR_MAX = 12;           // parenthèses et signes imbriqués
const CHIFFRES_MAX = 15;             // un nombre de plus de 15 chiffres n'est pas un compte
const EXPOSANT_MAX = 64;
const XP_MAX_COMPTAGE = 1000;
const BORNE = BigInt(Number.MAX_SAFE_INTEGER);

const REACTIONS_COMPTAGE = { juste: '✅', centaine: '💯', record: '🏆', faux: '❌' };

// Posté dans le salon qui devient le salon de comptage (/config ou site).
const ANNONCE_SALON_COMPTAGE = '🔢 **Ce salon devient le salon de comptage !**\nChacun son tour, un nombre de plus que le précédent. Une erreur et on repart de **0**.\nLe premier nombre est **1**.';

// Les réglages du serveur, défauts compris. Sur un serveur existant une
// colonne neuve vaut NULL : on ne lit JAMAIS cfg.comptage_x sans repli.
function reglagesComptage(cfg) {
  const c = cfg || {};
  const xp = Math.floor(Number(c.comptage_xp ?? 0));
  return {
    salon: c.comptage_channel_id ? String(c.comptage_channel_id) : null,
    memePersonne: Number(c.comptage_meme_personne ?? 0) === 1,
    maths: Number(c.comptage_maths ?? 0) === 1,
    reactions: Number(c.comptage_reactions ?? 1) !== 0,
    supprimer: Number(c.comptage_supprimer ?? 0) === 1,
    roleErreur: c.comptage_role_erreur ? String(c.comptage_role_erreur) : null,
    xp: Number.isFinite(xp) ? Math.min(XP_MAX_COMPTAGE, Math.max(0, xp)) : 0,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 🧮 LECTURE DU NOMBRE (logique pure)
// ══════════════════════════════════════════════════════════════════════════

const SIGNES = { '+': '+', '-': '-', '−': '-', '–': '-' };
const OPERATEURS = {
  '+': '+', '-': '-', '−': '-', '–': '-',
  '*': '*', '×': '*', x: '*', X: '*', '·': '*',
  '/': '/', '÷': '/',
  '^': '^',
};
const estChiffre = (c) => c >= '0' && c <= '9';
// Les espaces qu'on tape entre les milliers : espace, insécable (U+00A0) et
// fine insécable (U+202F, celle des claviers et correcteurs français).
const SEPARATEURS_MILLIERS = new Set([' ', '\u00a0', '\u202f']);
const estBlanc = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\u00a0' || c === '\u202f';
// Un blanc sur la MÊME ligne : « 5 6 » est ambigu, « 5⏎6 » est un 5.
const estBlancDeLigne = (c) => c === ' ' || c === '\t' || c === '\u00a0' || c === '\u202f';

// Après un signe ou une parenthèse ouvrante, vient-il un opérande ?
// C'est ce qui sépare « 5 x 3 » (un calcul) de « 5 xD » (un 5 et un sourire),
// ou « 5 - c'est moi » (un 5) de « 5 - 2 » (un 3).
function suiviDOperande(s, j, profondeur = 0) {
  while (j < s.length && estBlanc(s[j])) j++;
  const c = s[j];
  if (c === undefined) return false;
  if (estChiffre(c) || c === '(') return true;
  if (SIGNES[c] && profondeur < 3) return suiviDOperande(s, j + 1, profondeur + 1);
  return false;
}

// Découpe le DÉBUT du message en jetons : nombres, signes, parenthèses.
// S'arrête au premier signe qui ne fait pas partie d'un calcul — « 12 lol »
// donne 12. Un calcul de plus de LONGUEUR_MAX_EXPRESSION signes (ou de
// JETONS_MAX morceaux) est refusé en bloc, jamais lu à moitié.
function decouperDebutComptage(texte) {
  const s = String(texte ?? '');
  let i = 0;
  while (i < s.length && estBlanc(s[i])) i++;
  const debut = i;
  const jetons = [];
  let profondeur = 0;
  let attendOperande = true;
  let fin = i;
  const prendre = (jeton, apres) => {
    if (apres - debut > LONGUEUR_MAX_EXPRESSION || jetons.length >= JETONS_MAX) return false;
    jetons.push(jeton);
    i = apres;
    fin = apres;
    return true;
  };
  const tropLong = () => ({ erreur: 'trop_long', jetons, debut, fin: i });
  while (i < s.length) {
    const c = s[i];
    if (estBlanc(c)) { i++; continue; }
    if (attendOperande) {
      if (estChiffre(c)) {
        let j = i;
        while (j < s.length && estChiffre(s[j])) j++;
        let chiffres = s.slice(i, j);
        // « 1 000 », « 12 345 678 » : les milliers séparés à la française
        // (espace, insécable ou fine). Un groupe de 1 à 3 chiffres, puis des
        // groupes d'EXACTEMENT trois chiffres, un seul séparateur entre eux.
        if (chiffres.length <= 3) {
          while (SEPARATEURS_MILLIERS.has(s[j]) && estChiffre(s[j + 1] || '') && estChiffre(s[j + 2] || '')
            && estChiffre(s[j + 3] || '') && !estChiffre(s[j + 4] || '')) {
            chiffres += s.slice(j + 1, j + 4);
            j += 4;
          }
        }
        if (chiffres.length > CHIFFRES_MAX) return { erreur: 'trop_grand', jetons, debut, fin: j };
        // « 1,5 » ou « 2.5 » : un décimal n'est pas un compte.
        if ((s[j] === ',' || s[j] === '.') && estChiffre(s[j + 1] || '')) {
          return { erreur: 'decimal', jetons, debut, fin: j };
        }
        // « 5 6 », « 1 0000 » : deux nombres côte à côte sur la ligne. Lire
        // le premier jugerait de travers : c'est un hors-jeu, pas un 5.
        let k = j;
        while (k < s.length && estBlancDeLigne(s[k])) k++;
        if (k > j && estChiffre(s[k] || '')) return { erreur: 'ambigu', jetons, debut, fin: j };
        if (!prendre({ t: 'n', v: BigInt(chiffres) }, j)) return tropLong();
        attendOperande = false;
        continue;
      }
      if (c === '(' && suiviDOperande(s, i + 1)) {
        if (!prendre({ t: '(' }, i + 1)) return tropLong();
        profondeur++;
        continue;
      }
      if (SIGNES[c] && suiviDOperande(s, i + 1)) {
        if (!prendre({ t: 'u', v: SIGNES[c] }, i + 1)) return tropLong();
        continue;
      }
      break;
    }
    // On attend un opérateur ou une parenthèse fermante.
    if (c === ')' && profondeur > 0) {
      if (!prendre({ t: ')' }, i + 1)) return tropLong();
      profondeur--;
      continue;
    }
    // « ** » est la puissance de bien des calculatrices.
    if (c === '*' && s[i + 1] === '*' && suiviDOperande(s, i + 2)) {
      if (!prendre({ t: 'o', v: '^' }, i + 2)) return tropLong();
      attendOperande = true;
      continue;
    }
    if (OPERATEURS[c] && suiviDOperande(s, i + 1)) {
      if (!prendre({ t: 'o', v: OPERATEURS[c] }, i + 1)) return tropLong();
      attendOperande = true;
      continue;
    }
    break;
  }
  return { jetons, debut, fin, texte: s.slice(debut, fin) };
}

class ErreurCalcul extends Error {}

const borne = (v) => {
  if (v > BORNE || v < -BORNE) throw new ErreurCalcul('trop grand');
  return v;
};

// Descente récursive, en entiers exacts (BigInt) :
//   expression := terme (('+'|'-') terme)*
//   terme      := unaire (('*'|'/') unaire)*
//   unaire     := ('+'|'-') unaire | puissance
//   puissance  := primaire ('^' unaire)?        (à droite : 2^3^2 = 2^9)
//   primaire   := nombre | '(' expression ')'
function calculerJetons(jetons) {
  let pos = 0;
  let profondeur = 0;
  const voir = () => jetons[pos];
  // Une parenthèse coûte deux niveaux (primaire puis unaire) : 12 imbriquées
  // passent, 13 non. Les signes en cascade (« - - - 5 ») comptent aussi.
  const entrer = () => { if (++profondeur > PROFONDEUR_MAX * 2 + 1) throw new ErreurCalcul('trop profond'); };
  const sortir = () => { profondeur--; };

  function expression() {
    let v = terme();
    while (voir()?.t === 'o' && (voir().v === '+' || voir().v === '-')) {
      const op = jetons[pos++].v;
      const d = terme();
      v = borne(op === '+' ? v + d : v - d);
    }
    return v;
  }
  function terme() {
    let v = unaire();
    while (voir()?.t === 'o' && (voir().v === '*' || voir().v === '/')) {
      const op = jetons[pos++].v;
      const d = unaire();
      if (op === '*') v = borne(v * d);
      else {
        if (d === 0n) throw new ErreurCalcul('division par zéro');
        if (v % d !== 0n) throw new ErreurCalcul('division non entière');
        v = v / d;
      }
    }
    return v;
  }
  function unaire() {
    entrer();
    try {
      if (voir()?.t === 'u') {
        const signe = jetons[pos++].v;
        const v = unaire();
        return signe === '-' ? -v : v;
      }
      return puissance();
    } finally {
      sortir();
    }
  }
  function puissance() {
    const base = primaire();
    if (voir()?.t === 'o' && voir().v === '^') {
      pos++;
      const exp = unaire();
      if (exp < 0n) throw new ErreurCalcul('exposant négatif');
      const absBase = base < 0n ? -base : base;
      if (exp > BigInt(EXPOSANT_MAX) && absBase > 1n) throw new ErreurCalcul('exposant trop grand');
      // 0, 1 et -1 à une puissance énorme : inutile de calculer.
      if (absBase <= 1n) return base === -1n ? (exp % 2n === 0n ? 1n : -1n) : (exp === 0n ? 1n : base);
      return borne(base ** exp);
    }
    return base;
  }
  function primaire() {
    const j = voir();
    if (!j) throw new ErreurCalcul('incomplet');
    if (j.t === 'n') { pos++; return j.v; }
    if (j.t === '(') {
      pos++;
      entrer();
      try {
        const v = expression();
        if (voir()?.t !== ')') throw new ErreurCalcul('parenthèse non fermée');
        pos++;
        return v;
      } finally {
        sortir();
      }
    }
    throw new ErreurCalcul('jeton inattendu');
  }

  const v = expression();
  if (pos !== jetons.length) throw new ErreurCalcul('reste');
  return v;
}

// Évalue un calcul ENTIER (tout le texte doit en être un). null si refusé.
function evaluerExpressionComptage(texte) {
  const s = String(texte ?? '');
  if (s.length > LONGUEUR_MAX_EXPRESSION) return null;
  const d = decouperDebutComptage(s);
  if (d.erreur || !d.jetons.length) return null;
  if (s.slice(d.fin).trim()) return null;
  try {
    return Number(calculerJetons(d.jetons));
  } catch (err) {
    if (err instanceof ErreurCalcul) return null;
    throw err;
  }
}

// Le nombre en tête d'un message.
//   { ok: true, valeur, expression, texte }  — un nombre (ou un calcul juste)
//   { ok: false, raison }                     — hors-jeu : ignoré, jamais une erreur
function lireNombreComptage(texte, { maths = false } = {}) {
  const d = decouperDebutComptage(texte);
  if (d.erreur) return { ok: false, raison: d.erreur };
  if (!d.jetons.length) return { ok: false, raison: 'pas_un_nombre' };
  const expression = d.jetons.length > 1;
  // Calculs coupés : « 2+2 » n'est PAS un 2 — on l'ignore plutôt que de le
  // compter de travers et de casser la série de quelqu'un.
  if (expression && !maths) return { ok: false, raison: 'calcul_refuse' };
  try {
    const v = calculerJetons(d.jetons);
    return { ok: true, valeur: Number(v), expression, texte: d.texte };
  } catch (err) {
    if (err instanceof ErreurCalcul) return { ok: false, raison: 'calcul_invalide' };
    throw err;
  }
}

// Le verdict, sans rien toucher.
function jugerComptage(etat, valeur, auteurId, { memePersonne = false } = {}) {
  const courant = Number(etat?.courant || 0);
  const attendu = courant + 1;
  if (valeur !== attendu) return { verdict: 'faux', raison: 'nombre', attendu };
  if (!memePersonne && etat?.dernier_user && String(etat.dernier_user) === String(auteurId)) {
    return { verdict: 'faux', raison: 'deux_fois', attendu };
  }
  return { verdict: 'juste', attendu };
}

// ══════════════════════════════════════════════════════════════════════════
// 💾 ÉTAT EN BASE
// ══════════════════════════════════════════════════════════════════════════

const lireEtatStmt = db.prepare('SELECT * FROM comptage WHERE guild_id = ?');
const poserSalonStmt = db.prepare(`
  INSERT INTO comptage (guild_id, channel_id, courant, maj_le) VALUES (?, ?, 0, ?)
  ON CONFLICT (guild_id) DO UPDATE SET channel_id = excluded.channel_id, courant = 0,
    dernier_user = NULL, dernier_message_id = NULL, record_depart = comptage.record, maj_le = excluded.maj_le
`);
const avancerStmt = db.prepare(`
  UPDATE comptage SET courant = ?, dernier_user = ?, dernier_message_id = ?,
    record = MAX(record, ?), record_le = CASE WHEN ? > record THEN ? ELSE record_le END, maj_le = ?
  WHERE guild_id = ?
`);
const casserStmt = db.prepare(`
  UPDATE comptage SET courant = 0, dernier_user = NULL, dernier_message_id = NULL,
    erreurs = erreurs + 1, dernier_fautif = ?, role_fautif = ?, record_depart = record, maj_le = ?
  WHERE guild_id = ?
`);
// Plus personne ne porte le rôle d'erreur (retiré au dernier fautif).
const libererFautifStmt = db.prepare(
  'UPDATE comptage SET dernier_fautif = NULL, role_fautif = NULL WHERE guild_id = ? AND dernier_fautif = ?'
);
const oublierDernierStmt = db.prepare(
  'UPDATE comptage SET dernier_message_id = NULL, maj_le = ? WHERE guild_id = ? AND dernier_message_id = ?'
);
const definirStmt = db.prepare(`
  INSERT INTO comptage (guild_id, channel_id, courant, maj_le) VALUES (?, ?, ?, ?)
  ON CONFLICT (guild_id) DO UPDATE SET channel_id = COALESCE(excluded.channel_id, comptage.channel_id),
    courant = excluded.courant, dernier_user = NULL, dernier_message_id = NULL,
    record_depart = comptage.record, maj_le = excluded.maj_le
`);
const razStmt = db.prepare(`
  UPDATE comptage SET courant = 0, dernier_user = NULL, dernier_message_id = NULL,
    record = 0, record_le = NULL, record_depart = 0, erreurs = 0, maj_le = ?
  WHERE guild_id = ?
`);
const statJusteStmt = db.prepare(`
  INSERT INTO comptage_stats (guild_id, user_id, justes, erreurs) VALUES (?, ?, 1, 0)
  ON CONFLICT (guild_id, user_id) DO UPDATE SET justes = justes + 1
`);
const statErreurStmt = db.prepare(`
  INSERT INTO comptage_stats (guild_id, user_id, justes, erreurs) VALUES (?, ?, 0, 1)
  ON CONFLICT (guild_id, user_id) DO UPDATE SET erreurs = erreurs + 1
`);
const effacerStatsStmt = db.prepare('DELETE FROM comptage_stats WHERE guild_id = ?');
const classementStmt = db.prepare(`
  SELECT user_id, justes, erreurs FROM comptage_stats
  WHERE guild_id = ? AND (justes > 0 OR erreurs > 0)
  ORDER BY justes DESC, erreurs ASC, user_id ASC LIMIT ? OFFSET ?
`);
const compterStmt = db.prepare(
  'SELECT COUNT(*) AS n FROM comptage_stats WHERE guild_id = ? AND (justes > 0 OR erreurs > 0)'
);
const statsMembreStmt = db.prepare('SELECT justes, erreurs FROM comptage_stats WHERE guild_id = ? AND user_id = ?');
const devantStmt = db.prepare(`
  SELECT COUNT(*) AS n FROM comptage_stats
  WHERE guild_id = ? AND (justes > ? OR (justes = ? AND (erreurs < ? OR (erreurs = ? AND user_id < ?))))
`);

const maintenant = () => new Date().toISOString();

// L'état du serveur, défauts compris (jamais null).
function etatComptage(guildId) {
  return lireEtatStmt.get(String(guildId)) || {
    guild_id: String(guildId), channel_id: null, courant: 0, dernier_user: null, dernier_message_id: null,
    record: 0, record_le: null, record_depart: 0, erreurs: 0, dernier_fautif: null, role_fautif: null, maj_le: null,
  };
}

// Le nombre en cours tel que le joueur le verra : un état resté sur un
// ANCIEN salon ne vaut plus rien, il repartira de 0 au premier message.
function nombreActuelComptage(guildId, salonId) {
  const e = etatComptage(guildId);
  return salonId && String(e.channel_id) === String(salonId) ? Number(e.courant || 0) : 0;
}

// Nouveau salon : compte remis à 0, record, séries cassées et classement
// conservés (ils appartiennent au serveur, pas au salon).
function changerSalonComptage(guildId, channelId) {
  poserSalonStmt.run(String(guildId), channelId ? String(channelId) : null, maintenant());
  return etatComptage(guildId);
}

// L'état du salon où l'on joue — remis à zéro s'il vient d'un autre salon
// (salon changé depuis le site, par exemple, sans passer par /config).
function etatDuSalon(guildId, channelId) {
  const e = lireEtatStmt.get(String(guildId));
  if (e && String(e.channel_id) === String(channelId)) return e;
  return changerSalonComptage(guildId, channelId);
}

// /comptage definir : « le dernier nombre valide est N ».
function definirNombreComptage(guildId, nombre, channelId = null) {
  const n = Math.max(0, Math.floor(Number(nombre) || 0));
  definirStmt.run(String(guildId), channelId ? String(channelId) : null, n, maintenant());
  return etatComptage(guildId);
}

// Remise à zéro complète : compte, record, séries cassées — et, si demandé,
// le classement des membres.
function remettreComptageAZero(guildId, { classement = false } = {}) {
  const g = String(guildId);
  if (!lireEtatStmt.get(g)) poserSalonStmt.run(g, null, maintenant());
  razStmt.run(maintenant(), g);
  if (classement) effacerStatsStmt.run(g);
  return etatComptage(guildId);
}

function classementComptage(guildId, { limite = 10, decalage = 0 } = {}) {
  return classementStmt.all(String(guildId), Math.max(1, limite), Math.max(0, decalage));
}
function compterCompteursComptage(guildId) {
  return Number(compterStmt.get(String(guildId))?.n || 0);
}
// Les bons nombres d'un membre et son rang (null s'il n'a jamais compté).
function statsMembreComptage(guildId, userId) {
  const s = statsMembreStmt.get(String(guildId), String(userId));
  if (!s || (!s.justes && !s.erreurs)) return { justes: 0, erreurs: 0, rang: null };
  const devant = devantStmt.get(String(guildId), s.justes, s.justes, s.erreurs, s.erreurs, String(userId));
  return { justes: s.justes, erreurs: s.erreurs, rang: Number(devant?.n || 0) + 1 };
}

// ══════════════════════════════════════════════════════════════════════════
// ⏳ FILE PAR SALON
// ══════════════════════════════════════════════════════════════════════════
//
// Chaque salon a sa file : un message n'est jugé qu'une fois le précédent
// entièrement traité (base ET réactions ET annonce). Un travail qui échoue
// ne bloque pas la file.
const files = new Map();

function enFileComptage(cle, travail) {
  const precedent = files.get(cle) || Promise.resolve();
  const tour = precedent.then(() => travail());
  const fin = tour.catch(() => null);
  files.set(cle, fin);
  fin.then(() => { if (files.get(cle) === fin) files.delete(cle); });
  return tour;
}

// Les hors-jeu que le bot efface lui-même : leur suppression n'a pas à
// remplir le journal (un salon de comptage animé en produirait des
// centaines). Mémoire courte et bornée.
const effacesParLeBot = new Map();
function noterEffacement(id) {
  const t = Date.now();
  effacesParLeBot.set(String(id), t);
  if (effacesParLeBot.size > 500) {
    for (const [k, quand] of effacesParLeBot) {
      if (t - quand > 60_000 || effacesParLeBot.size > 500) effacesParLeBot.delete(k);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 🎯 LE JEU
// ══════════════════════════════════════════════════════════════════════════

// L'XP par bon nombre passe par le système de niveaux (contrat C), jamais
// par un calcul à part. Ne lève jamais.
async function donnerXpComptage(message, montant) {
  if (!montant) return null;
  try {
    const L = require('./levels');
    if (typeof L.gagnerXpServeur === 'function') {
      return await L.gagnerXpServeur(message.guild, message.author.id, 'comptage', montant, {
        salon: message.channel, membre: message.member,
      });
    }
    const r = L.addXp(message.guild.id, message.author.id, 'comptage', montant);
    if (r?.leveledUp) await L.announceLevelUp(message.guild, message.author.id, 'comptage', r.newLevel, message.channel);
    return r;
  } catch (err) {
    console.warn(`⚠️ Comptage : XP non donnée (${err.message})`);
    return null;
  }
}

// Un appel réseau qui ne lève jamais : null en cas d'échec.
async function sansEchec(appel) {
  try {
    return (await appel()) ?? null;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 🎭 LE RÔLE D'ERREUR
// ══════════════════════════════════════════════════════════════════════════
//
// Le bot le donne TOUT SEUL à quiconque casse la série — il suffit de poster
// deux nombres. Un rôle qui porte un pouvoir ferait donc du comptage une
// porte dérobée : un modo (grade staff) choisissait un rôle « Administrateur »
// placé sous celui du bot, comptait « 1 » puis « 2 »… et le recevait.
//
// D'où trois verrous : le rôle se règle par l'ADMINISTRATION, il ne porte
// aucune permission sensible, et ces permissions sont revérifiées à chaque
// fois qu'on le donne (elles ont pu changer depuis le réglage).

// Les permissions qu'un rôle d'erreur ne doit JAMAIS porter. Les valeurs
// sont celles de l'API de Discord, écrites ici plutôt que lues dans
// discord.js : une constante absente ne doit pas ouvrir le verrou.
const PERMISSIONS_SENSIBLES_COMPTAGE = [
  [1n << 3n, 'Administrateur'],
  [1n << 5n, 'Gérer le serveur'],
  [1n << 28n, 'Gérer les rôles'],
  [1n << 4n, 'Gérer les salons'],
  [1n << 29n, 'Gérer les webhooks'],
  [1n << 2n, 'Bannir des membres'],
  [1n << 1n, 'Expulser des membres'],
  [1n << 40n, 'Exclure temporairement des membres'],
  [1n << 13n, 'Gérer les messages'],
  [1n << 17n, 'Mentionner @everyone'],
  [1n << 27n, 'Gérer les pseudos'],
  [1n << 30n, 'Gérer les expressions'],
  [1n << 33n, 'Gérer les évènements'],
  [1n << 34n, 'Gérer les fils'],
  [1n << 22n, 'Rendre les membres muets'],
  [1n << 23n, 'Mettre en sourdine des membres'],
  [1n << 24n, 'Déplacer des membres'],
];

// Les permissions d'un rôle en bits, quelle que soit sa forme : objet de
// discord.js (bitfield), ou valeur brute de l'API (texte, nombre).
function bitsDuRole(role) {
  const p = role?.permissions;
  try {
    if (p === null || p === undefined) return 0n;
    if (typeof p === 'bigint') return p;
    if (typeof p === 'object' && p.bitfield !== undefined) return BigInt(p.bitfield);
    return BigInt(p);
  } catch {
    return 0n;
  }
}

// Les noms des permissions sensibles que porte ce rôle ([] : aucune).
function permissionsSensiblesRole(role) {
  const bits = bitsDuRole(role);
  return PERMISSIONS_SENSIBLES_COMPTAGE.filter(([bit]) => (bits & bit) === bit).map(([, nom]) => nom);
}

// Le refus du site (API) pour un rôle d'erreur porteur de pouvoirs, ou null.
// Les autres contrôles (rôle du serveur, géré, sous le bot) sont faits avant.
function refusRoleErreurComptage(guild, roleId) {
  const role = guild?.roles?.cache?.get?.(String(roleId));
  if (!role) return null;
  const sensibles = permissionsSensiblesRole(role);
  if (!sensibles.length) return null;
  return `Le rôle ${role.name || role.id} porte des permissions sensibles (${sensibles.join(', ')}) : `
    + 'le rôle d\'erreur du comptage est donné automatiquement, il ne doit en porter aucune.';
}

// Retire un rôle à un membre, sans jamais lever.
async function retirerRole(guild, userId, roleId, raison) {
  if (!guild || !userId || !roleId) return;
  const membre = guild.members?.cache?.get(String(userId)) || await sansEchec(() => guild.members.fetch(String(userId)));
  await sansEchec(() => membre?.roles?.remove(String(roleId), raison));
}

// Le rôle d'erreur passe au nouveau fautif ; l'ancien perd celui qu'il a
// RÉELLEMENT reçu — pas celui du réglage du moment, qui a pu changer
// entretemps. Un rôle au-dessus du mien ou disparu échoue sans bruit : le
// jeu continue. Un rôle devenu sensible n'est plus donné.
async function passerRoleErreur(message, roleId, { ancienFautif = null, ancienRole = null } = {}) {
  const guild = message.guild;
  const fautif = String(message.author.id);
  if (ancienFautif && ancienRole && (String(ancienFautif) !== fautif || String(ancienRole) !== String(roleId))) {
    await retirerRole(guild, ancienFautif, ancienRole, 'Comptage : un autre membre a cassé la série');
  }
  if (!roleId) return;
  const membre = message.member || await sansEchec(() => guild.members.fetch(fautif));
  await sansEchec(() => membre?.roles?.add(roleId, 'Comptage : a cassé la série'));
}

// Le rôle qu'on peut donner maintenant : celui du réglage, s'il existe
// encore et ne porte aucune permission sensible. Sinon null.
function roleErreurDonnable(guild, roleId) {
  if (!roleId) return null;
  const role = guild?.roles?.cache?.get?.(String(roleId));
  if (!role) return null;
  if (permissionsSensiblesRole(role).length) {
    console.warn(`⚠️ Comptage : le rôle d'erreur ${role.name || role.id} porte des permissions sensibles — il n'est plus donné.`);
    return null;
  }
  return String(roleId);
}

// Le rôle que porte le dernier fautif, ou null. role_fautif vaut « » quand
// rien ne lui a été donné ; NULL sur une ligne d'avant cette colonne — il
// porte alors le rôle du réglage.
function roleDuFautif(e, R) {
  if (!e?.dernier_fautif) return null;
  if (e.role_fautif === null || e.role_fautif === undefined) return R.roleErreur || null;
  return e.role_fautif || null;
}

// Le staff change le rôle d'erreur, le vide ou coupe le comptage : le
// dernier fautif perd le rôle qu'il porte (sauf s'il reste le même). Ne
// lève jamais. Renvoie true si un rôle a été retiré.
// ⚠️ La lecture et la base se font AVANT le premier `await` : appelée avant
// d'écrire le nouveau réglage, elle lit bien l'ancien, même sans l'attendre.
async function retirerRoleFautifComptage(guild, { garder = null } = {}) {
  if (!guild?.id) return false;
  const e = lireEtatStmt.get(String(guild.id));
  if (!e?.dernier_fautif) return false;
  const porte = roleDuFautif(e, reglagesComptage(getGuildConfig(guild.id)));
  if (!porte || (garder && String(garder) === String(porte))) return false;
  libererFautifStmt.run(String(guild.id), String(e.dernier_fautif));
  await retirerRole(guild, e.dernier_fautif, porte, 'Comptage : le rôle d\'erreur a été changé ou retiré');
  return true;
}

const reagir = (message, emoji) => Promise.resolve()
  .then(() => message.react(emoji))
  .catch(() => null);

const envoyer = (salon, content) => Promise.resolve()
  .then(() => salon?.send({ content, allowedMentions: { parse: [] } }))
  .catch(() => null);

async function jugerMessageComptage(message, lu, R) {
  const guildId = message.guild.id;
  const etat = etatDuSalon(guildId, message.channelId);
  const j = jugerComptage(etat, lu.valeur, message.author.id, R);

  if (j.verdict === 'juste') {
    const ancienRecord = Number(etat.record || 0);
    const n = lu.valeur;
    // 🏆 Une fois par série : le premier nombre qui dépasse le record tel
    // qu'il était au départ. Sans cette mémoire, chaque nombre d'une
    // première montée « battait » le record posé par le précédent.
    const recordBattu = ancienRecord > 0 && Number(etat.record_depart || 0) === ancienRecord && n > ancienRecord;
    const quand = maintenant();
    avancerStmt.run(n, String(message.author.id), String(message.id), n, n, quand, quand, guildId);
    statJusteStmt.run(guildId, String(message.author.id));
    const effets = [];
    if (R.reactions) {
      let emoji = REACTIONS_COMPTAGE.juste;
      if (recordBattu) emoji = REACTIONS_COMPTAGE.record;
      else if (n % 100 === 0) emoji = REACTIONS_COMPTAGE.centaine;
      effets.push(reagir(message, emoji));
    }
    if (R.xp > 0) effets.push(donnerXpComptage(message, R.xp));
    await Promise.all(effets);
    return { traite: true, verdict: 'juste', valeur: n, record: n > ancienRecord, recordBattu };
  }

  // ❌ Faux. À 0 il n'y a pas de série à casser : on le signale, sans
  // sanction — sinon chaque « 0 » d'un nouveau venu coûterait un rôle.
  const casse = Number(etat.courant || 0);
  if (casse === 0) {
    const effets = [];
    if (R.reactions) effets.push(reagir(message, REACTIONS_COMPTAGE.faux));
    else effets.push(envoyer(message.channel, `❌ <@${message.author.id}>, le compte commence à **1**.`));
    await Promise.all(effets);
    return { traite: true, verdict: 'faux', raison: j.raison, casse: 0, sanction: false };
  }

  // Le rôle réellement donné est noté (« » : aucun) : c'est lui qu'on
  // retirera plus tard, quel que soit le réglage d'alors.
  const roleDonne = roleErreurDonnable(message.guild, R.roleErreur);
  const ancienRole = roleDuFautif(etat, R);
  casserStmt.run(String(message.author.id), roleDonne || '', maintenant(), guildId);
  statErreurStmt.run(guildId, String(message.author.id));
  const apres = etatComptage(guildId);

  const lignes = [
    `💥 <@${message.author.id}> a cassé la série à **${casse}** ! Le prochain nombre était **${casse + 1}**. On repart de **0** : le prochain est **1**.`,
  ];
  if (j.raison === 'deux_fois') lignes.push('-# 🔁 Pas deux fois de suite : il faut laisser quelqu\'un d\'autre compter.');
  else if (lu.expression) lignes.push(`-# 🧮 \`${lu.texte.replace(/`/g, '')}\` = **${lu.valeur}**, il fallait **${casse + 1}**.`);
  if (apres.record > 0) {
    const date = apres.record_le ? ` — le <t:${Math.floor(new Date(apres.record_le).getTime() / 1000)}:D>` : '';
    lignes.push(`🏆 Record du serveur : **${apres.record}**${date}`);
  }

  const effets = [envoyer(message.channel, lignes.join('\n'))];
  if (R.reactions) effets.push(reagir(message, REACTIONS_COMPTAGE.faux));
  if (roleDonne || ancienRole) {
    effets.push(passerRoleErreur(message, roleDonne, { ancienFautif: etat.dernier_fautif, ancienRole }));
  }
  await Promise.all(effets);
  return { traite: true, verdict: 'faux', raison: j.raison, casse, sanction: true };
}

// Le message concerne-t-il le comptage ? null si non ; sinon ses réglages
// et ce qu'on y lit. Synchrone : rien ne peut se glisser avant.
function examinerComptage(message, cfg) {
  if (!message?.guild || !message.author) return null;
  // Le bot ignore ses propres messages et ceux des autres bots (webhooks
  // compris), comme les messages système (« … a épinglé un message »).
  if (message.author.bot || message.system || message.author.id === message.client?.user?.id) return null;
  const R = reglagesComptage(cfg || getGuildConfig(message.guild.id));
  if (!R.salon || String(message.channelId) !== R.salon) return null;
  return { R, lu: lireNombreComptage(message.content, { maths: R.maths }) };
}

// L'anti-scam qui télécharge une image ne doit pas figer le salon : passé
// ce délai, le nombre est jugé quand même.
const ATTENTE_FILTRES_MS = 10_000;

function placerEnFile(message, { R, lu }) {
  let feu;
  const filtres = new Promise((r) => { feu = r; });
  const tour = enFileComptage(R.salon, async () => {
    let minuteur;
    const garder = await Promise.race([
      filtres,
      new Promise((r) => { minuteur = setTimeout(() => r(true), ATTENTE_FILTRES_MS); minuteur.unref?.(); }),
    ]);
    clearTimeout(minuteur);
    // Effacé par l'anti-scam ou l'anti-spam : ce message ne compte pas.
    if (!garder) return { traite: true, filtre: true };
    return jugerMessageComptage(message, lu, R);
  });
  return { tour, liberer: (garder = true) => feu(Boolean(garder)) };
}

// 🎫 Réserve la place d'un NOMBRE dans la file de son salon, DÈS SA
// RÉCEPTION — avant l'anti-scam et l'anti-spam, qui prennent du temps.
// Sans cela, un « 6 » accompagné d'une image (téléchargée et comparée aux
// arnaques connues) entrait dans la file après le « 7 » posté 200 ms plus
// tard : le 7 était jugé contre 5, et la série cassait à tort.
//
// Renvoie null (pas un nombre du salon de comptage), ou { tour, liberer } :
// `liberer(true)` une fois les filtres passés, `liberer(false)` s'ils ont
// effacé le message — sa place est alors rendue sans rien juger.
function reserverPlaceComptage(message, cfg = null) {
  const ex = examinerComptage(message, cfg);
  return ex?.lu.ok ? placerEnFile(message, ex) : null;
}

// Point d'entrée depuis messageCreate. Ne lève jamais d'elle-même ; renvoie
//   { traite: false }                 — pas le salon de comptage, ou un bot
//   { traite: true, horsJeu: true }   — pas un nombre (supprime: effacé)
//   { traite: true, verdict, … }      — un nombre jugé
//   { traite: true, filtre: true }    — un nombre effacé par un filtre
// `place` : celle réservée à la réception (reserverPlaceComptage).
async function traiterMessageComptage(message, cfg = null, place = null) {
  if (place) {
    place.liberer(true);
    return place.tour;
  }
  const ex = examinerComptage(message, cfg);
  if (!ex) return { traite: false };
  const { R, lu } = ex;
  if (lu.ok) {
    const p = placerEnFile(message, ex);
    p.liberer(true);
    return p.tour;
  }
  // Un hors-jeu n'a pas de place dans la file : rien à juger.
  if (!R.supprimer) return { traite: true, horsJeu: true, raison: lu.raison };
  noterEffacement(message.id);
  const efface = await Promise.resolve().then(() => message.delete()).then(() => true).catch(() => false);
  if (!efface) effacesParLeBot.delete(String(message.id));
  return { traite: true, horsJeu: true, raison: lu.raison, supprime: efface };
}

// Prévient les joueurs, dans le salon même, de ce que le staff a changé
// (compte corrigé, remise à zéro, nouveau salon). Ne lève jamais.
async function annoncerComptage(guild, salonId, content) {
  if (!salonId) return null;
  const salon = await sansEchec(() => guild.channels.fetch(salonId));
  if (!salon?.isTextBased?.()) return null;
  return envoyer(salon, content);
}

// ══════════════════════════════════════════════════════════════════════════
// 🕵️ ANTI-TRICHE : le dernier nombre effacé ou modifié
// ══════════════════════════════════════════════════════════════════════════

async function salonDe(message, channelId) {
  if (message.channel?.send) return message.channel;
  const guild = message.guild;
  return (await sansEchec(() => guild.channels.fetch(channelId)))
    || (await sansEchec(() => message.client.channels.fetch(channelId)));
}

// messageDelete. Un message hors cache arrive PARTIEL (ni auteur ni
// contenu) : seul son identifiant compte, comparé au dernier nombre en base.
// Renvoie { silencieux: true } pour un hors-jeu effacé par le bot lui-même.
async function surSuppressionComptage(message, { enMasse = false } = {}) {
  const id = String(message?.id || '');
  if (!id) return {};
  if (effacesParLeBot.delete(id)) return { silencieux: true };
  const guildId = message.guildId || message.guild?.id;
  if (!guildId) return {};
  const R = reglagesComptage(getGuildConfig(guildId));
  if (!R.salon || String(message.channelId) !== R.salon) return {};
  return enFileComptage(R.salon, async () => {
    const e = etatComptage(guildId);
    if (String(e.channel_id) !== R.salon || String(e.dernier_message_id || '') !== id) return {};
    // Une seule alerte par nombre : le message n'existe plus.
    oublierDernierStmt.run(maintenant(), String(guildId), id);
    const salon = await salonDe(message, R.salon);
    // Une purge (bannissement avec nettoyage, bot de modération) n'est pas
    // le fait de l'auteur : on le dit sans l'accuser.
    await envoyer(salon, enMasse
      ? `⚠️ Le dernier nombre, **${e.courant}**, a été effacé avec d'autres messages (il était de <@${e.dernier_user}>). Le prochain est **${e.courant + 1}**.`
      : `⚠️ <@${e.dernier_user}> a supprimé son nombre **${e.courant}**. Le prochain est **${e.courant + 1}**.`);
    return { republie: true, courant: e.courant };
  });
}

// messageDeleteBulk. Discord n'émet alors AUCUN messageDelete : sans ce
// relais, une purge qui emportait le dernier nombre laissait le salon
// afficher l'avant-dernier, et le joueur suivant « cassait » la série en
// écrivant le bon nombre. Une seule alerte, et seulement si le dernier
// nombre fait partie du lot.
async function surSuppressionEnMasseComptage(messages, salon) {
  const guildId = salon?.guild?.id || salon?.guildId;
  if (!guildId || !messages || typeof messages.get !== 'function') return {};
  const R = reglagesComptage(getGuildConfig(guildId));
  if (!R.salon || String(salon.id) !== R.salon) return {};
  const id = String(etatComptage(guildId).dernier_message_id || '');
  const m = id ? messages.get(id) : null;
  if (!m) return {};
  return surSuppressionComptage({
    id, guildId: String(guildId), guild: salon.guild || m.guild, channelId: String(salon.id), channel: salon,
    client: salon.client || m.client,
  }, { enMasse: true });
}

// messageUpdate. Le dernier nombre réécrit en autre chose : on rappelle le
// vrai. Une modification qui garde le même nombre (faute corrigée autour,
// aperçu de lien) ne dit rien.
async function surModificationComptage(ancien, nouveau) {
  const msg = nouveau || ancien;
  const id = String(msg?.id || '');
  const guildId = msg?.guildId || msg?.guild?.id;
  if (!id || !guildId || msg.author?.bot) return {};
  const R = reglagesComptage(getGuildConfig(guildId));
  if (!R.salon || String(msg.channelId) !== R.salon) return {};
  return enFileComptage(R.salon, async () => {
    const e = etatComptage(guildId);
    if (String(e.channel_id) !== R.salon || String(e.dernier_message_id || '') !== id) return {};
    const lu = lireNombreComptage(nouveau?.content, { maths: R.maths });
    if (lu.ok && lu.valeur === Number(e.courant)) return {};
    oublierDernierStmt.run(maintenant(), String(guildId), id);
    const salon = await salonDe(msg, R.salon);
    await envoyer(salon, `⚠️ <@${e.dernier_user}> a modifié son nombre **${e.courant}**. Le prochain est **${e.courant + 1}**.`);
    return { republie: true, courant: e.courant };
  });
}

module.exports = {
  LONGUEUR_MAX_EXPRESSION, XP_MAX_COMPTAGE, REACTIONS_COMPTAGE, ANNONCE_SALON_COMPTAGE,
  reglagesComptage, lireNombreComptage, evaluerExpressionComptage, decouperDebutComptage, jugerComptage,
  etatComptage, nombreActuelComptage, changerSalonComptage, definirNombreComptage, remettreComptageAZero,
  classementComptage, compterCompteursComptage, statsMembreComptage,
  enFileComptage, traiterMessageComptage, surSuppressionComptage, surModificationComptage, annoncerComptage,
  reserverPlaceComptage, surSuppressionEnMasseComptage,
  PERMISSIONS_SENSIBLES_COMPTAGE, permissionsSensiblesRole, refusRoleErreurComptage, retirerRoleFautifComptage,
};
