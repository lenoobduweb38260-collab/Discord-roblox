const { db, getGuildConfig } = require('../database');

// 💞 Vie de couple — les avantages du mariage.
//
// Le mariage (/mariage) suit les deux personnes partout où le bot est
// présent. Ses avantages, eux, se règlent PAR SERVEUR (/config → 💍 Mariage)
// et ne jouent que là où le module Interactions est actif :
//
//  • 💞 bonus d'XP quand les deux conjoints sont actifs ensemble, sur le
//    MÊME serveur, à moins de `mariage_actif_minutes` d'écart ;
//  • 🌙 lune de miel : ce bonus est doublé les premiers jours ;
//  • 💍 alliance qui change de métal avec l'ancienneté, chaque palier
//    ajoute un peu au bonus ;
//  • 🔥 flamme du couple : un bisou par jour chacun (heure de Paris) ;
//  • 🏷️ nom de couple, 💘 /lc entre conjoints, 🎂 mensiversaires, 💌 mot doux.
//
// ⚠️ Ce fichier est appelé à CHAQUE gain d'XP (contrat B, dans `addXp`) :
// jamais de réseau, jamais d'exception, et les unions sont gardées en
// mémoire plutôt que relues à chaque message. Les cartes et les envois
// vivent dans vieDeCouple.js.

const JOUR_MS = 86_400_000;
const MINUTE_MS = 60_000;

// Réglages par serveur : défauts et bornes (les mêmes que /config et le site).
const DEFAUTS_COUPLE = { bonus: 10, lune: 7, bisouXp: 30, actifMinutes: 10 };
const BORNES_COUPLE = { bonus: [0, 100], lune: [0, 60], bisouXp: [0, 1000], actifMinutes: [1, 120] };

// 💍 Les paliers de l'alliance. Le bonus s'AJOUTE au bonus de couple (en
// points de pourcentage) : une vieille union gagne un peu plus, sans écraser
// le réglage du serveur.
const ALLIANCES_COUPLE = [
  { cle: 'fer', nom: 'Fer', titre: 'Alliance de fer', emoji: '🔩', jours: 0, bonus: 0 },
  { cle: 'argent', nom: 'Argent', titre: 'Alliance d\'argent', emoji: '🥈', jours: 7, bonus: 1 },
  { cle: 'or', nom: 'Or', titre: 'Alliance d\'or', emoji: '🥇', jours: 30, bonus: 2 },
  { cle: 'diamant', nom: 'Diamant', titre: 'Alliance de diamant', emoji: '💎', jours: 100, bonus: 3 },
  { cle: 'eternelle', nom: 'Éternelle', titre: 'Alliance éternelle', emoji: '♾️', jours: 365, bonus: 5 },
];

// Le bonus ne récompense que l'activité : ni le bisou lui-même (sinon il se
// bonifierait), ni l'XP donnée à la main par le staff.
const SOURCES_SANS_BONUS = new Set(['couple', 'admin']);

// ── Réglages ────────────────────────────────────────────────────────────

function bornerReglage(valeur, [min, max], defaut) {
  if (valeur === null || valeur === undefined || valeur === '') return defaut;
  const n = Number(valeur);
  if (!Number.isFinite(n)) return defaut;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Sur un serveur déjà configuré, une colonne neuve vaut NULL : chaque
// lecture retombe donc sur le défaut.
function reglagesCouple(cfg) {
  const c = cfg || {};
  return {
    avantages: c.mariage_avantages !== 0 && c.mariage_avantages !== '0',
    module: Boolean(c.interact_enabled),
    bonus: bornerReglage(c.mariage_bonus_xp, BORNES_COUPLE.bonus, DEFAUTS_COUPLE.bonus),
    lune: bornerReglage(c.mariage_lune_de_miel_jours, BORNES_COUPLE.lune, DEFAUTS_COUPLE.lune),
    bisouXp: bornerReglage(c.mariage_bisou_xp, BORNES_COUPLE.bisouXp, DEFAUTS_COUPLE.bisouXp),
    actifMinutes: bornerReglage(c.mariage_actif_minutes, BORNES_COUPLE.actifMinutes, DEFAUTS_COUPLE.actifMinutes),
    salon: c.mariage_salon_id || null,
  };
}

// Avantages actifs sur ce serveur : interrupteur du mariage ET module
// Interactions (sans lui, /mariage n'existe pas ici : un bonus caché
// surprendrait tout le monde).
function avantagesCoupleActifs(cfgOuServeur) {
  const cfg = cfgOuServeur && typeof cfgOuServeur === 'object' ? cfgOuServeur : getGuildConfig(String(cfgOuServeur));
  const r = reglagesCouple(cfg);
  return r.avantages && r.module;
}

// ── Unions, en mémoire ──────────────────────────────────────────────────
//
// Une seule lecture de toute la table, puis plus rien jusqu'au prochain
// mariage ou divorce (mariage.js invalide le cache). Le délai de dix minutes
// n'est qu'un filet, au cas où la table changerait par un autre chemin.

const UNIONS_TTL = 10 * MINUTE_MS;
const lireUnions = db.prepare('SELECT a, b, depuis, guild_id FROM mariages');
const lireUnion = db.prepare('SELECT a, b, depuis, guild_id FROM mariages WHERE a = ? OR b = ?');
let unions = null; // userId → ligne de mariages
let unionsLues = 0;

function chargerUnions() {
  const maintenant = Date.now();
  if (unions && maintenant - unionsLues < UNIONS_TTL && maintenant >= unionsLues) return unions;
  const carte = new Map();
  for (const u of lireUnions.all()) {
    carte.set(String(u.a), u);
    carte.set(String(u.b), u);
  }
  unions = carte;
  unionsLues = maintenant;
  return unions;
}

function avecConjoint(u, userId) {
  if (!u) return null;
  const a = String(u.a);
  const b = String(u.b);
  return { a, b, depuis: u.depuis, guild_id: u.guild_id, conjoint: a === userId ? b : a };
}

// L'union d'un membre : { a, b, depuis, guild_id, conjoint } ou null.
// `frais` relit la base (commandes) ; sans, le cache sert (flux d'XP).
function unionCouple(userId, { frais = false } = {}) {
  const id = String(userId ?? '');
  if (!id) return null;
  if (frais) return avecConjoint(lireUnion.get(id, id), id);
  return avecConjoint(chargerUnions().get(id), id);
}

function toutesLesUnionsCouple() {
  return [...new Set(chargerUnions().values())].map((u) => avecConjoint(u, String(u.a)));
}

function invaliderUnionsCouple() {
  unions = null;
}

// ── Activité (qui vient de gagner de l'XP, et où) ───────────────────────

const activite = new Map(); // `${guildId}:${userId}` → horodatage (ms)
const ACTIVITE_GARDEE_MS = 3 * 60 * MINUTE_MS; // au-delà de la plus longue fenêtre possible
let prochainMenage = 0;

function menageActivite(maintenant) {
  for (const [cle, vu] of activite) {
    if (maintenant - vu > ACTIVITE_GARDEE_MS) activite.delete(cle);
  }
  prochainMenage = maintenant + 5 * MINUTE_MS;
}

// CONTRAT B — le membre vient de gagner de l'XP : il est « actif » ici.
// Seuls les membres mariés sont retenus, ce qui garde la mémoire minuscule.
function noterActiviteCouple(guildId, userId, quand = Date.now()) {
  try {
    if (!guildId || !userId) return;
    if (!chargerUnions().has(String(userId))) return;
    const t = Number(quand) || Date.now();
    activite.set(`${guildId}:${userId}`, t);
    if (activite.size > 2000 && Date.now() >= prochainMenage) menageActivite(Date.now());
  } catch {
    // jamais d'exception dans le flux d'XP
  }
}

function actifRecemmentCouple(guildId, userId, minutes, quand = Date.now()) {
  const vu = activite.get(`${guildId}:${userId}`);
  if (!vu) return false;
  return Math.abs((Number(quand) || Date.now()) - vu) <= minutes * MINUTE_MS;
}

// ── Ancienneté : alliance et lune de miel ───────────────────────────────

function joursDeMariage(depuis, quand = Date.now()) {
  const t = new Date(depuis).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Number(quand) - t) / JOUR_MS));
}

function allianceCouple(depuis, quand = Date.now()) {
  const jours = joursDeMariage(depuis, quand);
  let rang = 0;
  while (rang + 1 < ALLIANCES_COUPLE.length && jours >= ALLIANCES_COUPLE[rang + 1].jours) rang++;
  const suivant = ALLIANCES_COUPLE[rang + 1] || null;
  return { ...ALLIANCES_COUPLE[rang], rang, joursMaries: jours, suivant, joursAvantSuivant: suivant ? suivant.jours - jours : 0 };
}

function luneDeMielCouple(depuis, jours, quand = Date.now()) {
  const t = new Date(depuis).getTime();
  if (!jours || !Number.isFinite(t)) return { active: false, joursRestants: 0 };
  const reste = t + jours * JOUR_MS - Number(quand);
  return { active: reste > 0, joursRestants: reste > 0 ? Math.ceil(reste / JOUR_MS) : 0 };
}

// Le bonus complet d'une union, sans regarder l'activité : sert au flux
// d'XP comme à la fiche du couple. 0 % au réglage coupe tout (l'alliance
// n'ajoute rien à un bonus inexistant).
function calculBonusCouple(union, reglages, quand = Date.now()) {
  const alliance = allianceCouple(union.depuis, quand);
  const lune = luneDeMielCouple(union.depuis, reglages.lune, quand);
  const base = reglages.bonus;
  const pourcent = base > 0 ? base * (lune.active ? 2 : 1) + alliance.bonus : 0;
  return { pourcent, base, lune, alliance };
}

function raisonBonusCouple(calcul) {
  const morceaux = ['💞 Couple actif ensemble'];
  if (calcul.lune.active) morceaux.push('🌙 lune de miel');
  if (calcul.alliance.bonus > 0) morceaux.push(`${calcul.alliance.emoji} ${calcul.alliance.titre.toLowerCase()}`);
  return morceaux.join(' · ');
}

// CONTRAT B — bonus d'XP du couple pour ce gain, ou null.
// Synchrone, sans réseau, sans exception. Le bonus ne joue que si le
// conjoint a lui aussi gagné de l'XP sur CE serveur il y a peu.
function bonusXpCouple(guildId, userId, source, quand = Date.now()) {
  try {
    if (!guildId || !userId || SOURCES_SANS_BONUS.has(source)) return null;
    const union = unionCouple(userId);
    if (!union) return null;
    const reglages = reglagesCouple(getGuildConfig(String(guildId)));
    if (!reglages.avantages || !reglages.module || reglages.bonus <= 0) return null;
    if (!actifRecemmentCouple(guildId, union.conjoint, reglages.actifMinutes, quand)) return null;
    const calcul = calculBonusCouple(union, reglages, quand);
    if (!(calcul.pourcent > 0)) return null;
    return { pourcent: calcul.pourcent, raison: raisonBonusCouple(calcul) };
  } catch {
    return null;
  }
}

// ── 🏷️ Nom de couple ────────────────────────────────────────────────────
//
// La première moitié du premier pseudo, la seconde moitié du second :
// Kirito + Asuna → Kiruna. Lettres et chiffres seulement (pas d'emoji), et
// une lettre doublée à la jointure est fondue (Éloïse + Noé → Éloé).

function lettresDuPseudo(nom) {
  return [...String(nom ?? '').normalize('NFC').matchAll(/[\p{L}\p{N}]/gu)].map((m) => m[0].toLowerCase());
}

function nomDeCouple(nomA, nomB) {
  const a = lettresDuPseudo(nomA);
  const b = lettresDuPseudo(nomB);
  let lettres;
  if (!a.length && !b.length) lettres = [...'duo'];
  else if (!a.length || !b.length) lettres = (a.length ? a : b).slice(0, 20);
  else {
    const debut = a.length <= 2 ? a : a.slice(0, Math.min(10, Math.max(2, Math.ceil(a.length / 2))));
    let fin = b.length <= 2 ? b : b.slice(Math.floor(b.length / 2));
    fin = fin.slice(-10);
    if (fin.length > 1 && debut[debut.length - 1] === fin[0]) fin = fin.slice(1);
    lettres = [...debut, ...fin];
  }
  return lettres.length ? lettres[0].toUpperCase() + lettres.slice(1).join('') : 'Duo';
}

// ── 🕰️ Le jour de Paris ─────────────────────────────────────────────────
//
// Un bisou « du jour » se compte à l'heure de Paris, pas en UTC : à 0 h 30
// en France, c'est déjà le lendemain — alors que l'UTC dit encore la veille.

const FORMAT_PARIS = (() => {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Paris', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23',
    });
  } catch {
    return null;
  }
})();

function partiesParis(date) {
  const d = date instanceof Date ? date : new Date(date ?? Date.now());
  if (FORMAT_PARIS) {
    const p = {};
    for (const x of FORMAT_PARIS.formatToParts(d)) p[x.type] = x.value;
    return { annee: Number(p.year), mois: Number(p.month), jour: Number(p.day), heure: Number(p.hour) % 24 };
  }
  // Repli sans ICU : heure d'Europe centrale, été du dernier dimanche de
  // mars au dernier dimanche d'octobre, à 1 h UTC.
  const y = d.getUTCFullYear();
  const dernierDimanche = (m) => {
    const fin = new Date(Date.UTC(y, m + 1, 0, 1));
    return fin.getTime() - fin.getUTCDay() * JOUR_MS;
  };
  const ete = d.getTime() >= dernierDimanche(2) && d.getTime() < dernierDimanche(9);
  const local = new Date(d.getTime() + (ete ? 2 : 1) * 3_600_000);
  return { annee: local.getUTCFullYear(), mois: local.getUTCMonth() + 1, jour: local.getUTCDate(), heure: local.getUTCHours() };
}

const deuxChiffres = (n) => String(n).padStart(2, '0');

// « AAAA-MM-JJ » à Paris.
function jourDeParis(date = new Date()) {
  const p = partiesParis(date);
  return `${p.annee}-${deuxChiffres(p.mois)}-${deuxChiffres(p.jour)}`;
}

function heureDeParis(date = new Date()) {
  return partiesParis(date).heure;
}

function decalerJourCouple(jour, n) {
  const [y, m, d] = String(jour).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ── 🔥 La flamme du couple ──────────────────────────────────────────────

const creerCouple = db.prepare('INSERT OR IGNORE INTO mariage_flammes (a, b) VALUES (?, ?)');
const lireCouple = db.prepare('SELECT * FROM mariage_flammes WHERE a = ? AND b = ?');
const ecrireCouple = db.prepare(
  'UPDATE mariage_flammes SET bisou_a = ?, bisou_b = ?, flamme = ?, flamme_jour = ?, record = ?, jours = ? WHERE a = ? AND b = ?'
);

// La flamme ne vit que si elle a grandi aujourd'hui ou hier : un jour sans
// les deux bisous l'éteint.
function flammeVivante(ligne, jour) {
  if (!ligne?.flamme) return 0;
  return ligne.flamme_jour === jour || ligne.flamme_jour === decalerJourCouple(jour, -1) ? ligne.flamme : 0;
}

function etatFlammeCouple(a, b, quand = new Date()) {
  const [x, y] = [String(a), String(b)].sort();
  const jour = jourDeParis(quand);
  const r = lireCouple.get(x, y);
  return {
    jour,
    flamme: flammeVivante(r, jour),
    record: r?.record || 0,
    jours: r?.jours || 0,
    bisouA: r?.bisou_a === jour,
    bisouB: r?.bisou_b === jour,
  };
}

// Le bisou du jour de `userId`. Renvoie :
//  { deja }      — déjà fait aujourd'hui (rien ne change) ;
//  { complet }   — les deux l'ont fait : la flamme grandit (série, record) ;
//  sinon         — en attente du conjoint, flamme éteinte si un jour a manqué.
const enregistrerBisouTx = db.transaction((x, y, uid, jour) => {
  creerCouple.run(x, y);
  const r = lireCouple.get(x, y);
  const moiA = uid === x;
  const monDernier = moiA ? r.bisou_a : r.bisou_b;
  const sonDernier = moiA ? r.bisou_b : r.bisou_a;
  const vivante = flammeVivante(r, jour);
  if (monDernier === jour) {
    return { deja: true, complet: sonDernier === jour, flamme: vivante, record: r.record, jours: r.jours, jour };
  }
  const complet = sonDernier === jour;
  let flamme = vivante;
  let flammeJour = r.flamme_jour;
  let { record, jours } = r;
  let nouveauRecord = false;
  if (complet) {
    flamme = r.flamme_jour === decalerJourCouple(jour, -1) ? r.flamme + 1 : 1;
    flammeJour = jour;
    jours += 1;
    if (flamme > record) {
      record = flamme;
      nouveauRecord = true;
    }
  }
  ecrireCouple.run(moiA ? jour : r.bisou_a, moiA ? r.bisou_b : jour, flamme, flammeJour, record, jours, x, y);
  return { deja: false, complet, flamme, record, jours, jour, nouveauRecord, eteinte: !complet && r.flamme > 0 && vivante === 0 };
});

function enregistrerBisou(a, b, userId, quand = new Date()) {
  const [x, y] = [String(a), String(b)].sort();
  const uid = String(userId);
  if (uid !== x && uid !== y) return { erreur: 'hors-couple' };
  return enregistrerBisouTx(x, y, uid, jourDeParis(quand));
}

// ── 💋 L'XP du bisou : une fois par PERSONNE et par jour de Paris ────────
//
// La flamme appartient au COUPLE et s'efface au divorce. L'XP, elle, ne
// peut pas dépendre d'elle : divorcer puis se remarier (ou changer de
// conjoint) dans la journée recréait une flamme vierge, donc un « bisou du
// jour » neuf — et l'XP se gagnait sans limite, avec un second compte.
// Le versement se note donc par personne, dans une table que le divorce ne
// touche pas.
const noterXpBisou = db.prepare('INSERT OR IGNORE INTO mariage_bisous_xp (user_id, jour) VALUES (?, ?)');
const lireXpBisou = db.prepare('SELECT 1 AS ok FROM mariage_bisous_xp WHERE user_id = ? AND jour = ?');
const purgerXpBisou = db.prepare('DELETE FROM mariage_bisous_xp WHERE jour < ?');
let dernierePurgeXpBisou = '';

// Ce membre a-t-il déjà reçu l'XP du bisou ce jour-là (heure de Paris) ?
function xpBisouRecueCouple(userId, jour = jourDeParis()) {
  return Boolean(lireXpBisou.get(String(userId), String(jour)));
}

// Réserve l'XP du bisou du jour pour ce membre : true la première fois,
// false ensuite — quel que soit le couple. Synchrone : deux clics ne
// peuvent pas réserver deux fois.
function reserverXpBisouCouple(userId, jour = jourDeParis()) {
  const j = String(jour);
  if (dernierePurgeXpBisou !== j) {
    dernierePurgeXpBisou = j;
    try { purgerXpBisou.run(decalerJourCouple(j, -3)); } catch {}
  }
  return noterXpBisou.run(String(userId), j).changes === 1;
}

// ── 🎂 Mensiversaires et anniversaires ──────────────────────────────────
//
// Même quantième que le jour du mariage, à Paris ; un 31 tombe le dernier
// jour des mois courts. Douze mois font un anniversaire.

const joursDansLeMois = (annee, mois) => new Date(Date.UTC(annee, mois, 0)).getUTCDate();

function prochaineFeteCouple(depuis, quand = new Date()) {
  const t = new Date(depuis);
  if (!Number.isFinite(t.getTime())) return null;
  const o = partiesParis(t);
  const n = partiesParis(quand);
  const aujourdhui = `${n.annee}-${deuxChiffres(n.mois)}-${deuxChiffres(n.jour)}`;
  const ecart = (n.annee - o.annee) * 12 + (n.mois - o.mois);
  for (let mois = Math.max(1, ecart); mois <= Math.max(1, ecart) + 2; mois++) {
    const total = o.mois - 1 + mois;
    const annee = o.annee + Math.floor(total / 12);
    const m = (total % 12) + 1;
    const j = Math.min(o.jour, joursDansLeMois(annee, m));
    const date = `${annee}-${deuxChiffres(m)}-${deuxChiffres(j)}`;
    if (date < aujourdhui) continue;
    return {
      mois,
      date,
      // 10 h UTC : la même date partout de UTC-10 à UTC+13 dans <t:…:D>.
      ts: Math.floor(Date.UTC(annee, m - 1, j, 10) / 1000),
      aujourdhui: date === aujourdhui,
      anniversaire: mois % 12 === 0,
      annees: Math.floor(mois / 12),
    };
  }
  return null;
}

// Les dates qu'on annonce : chaque mois la première année, puis chaque année.
function feteAnnonceeCouple(fete) {
  return Boolean(fete?.aujourdhui && (fete.mois < 12 || fete.anniversaire));
}

const noterAnnonce = db.prepare('INSERT OR IGNORE INTO mariage_annonces (guild_id, a, b, jour) VALUES (?, ?, ?, ?)');

// Vrai la première fois pour (serveur, couple, date), faux ensuite.
function noterAnnonceCouple(guildId, a, b, jour) {
  const [x, y] = [String(a), String(b)].sort();
  return noterAnnonce.run(String(guildId), x, y, String(jour)).changes === 1;
}

// ── 💌 Mot doux ─────────────────────────────────────────────────────────

const MOT_DOUX_MAX = 300;
const ecrireMot = db.prepare('INSERT OR REPLACE INTO mariage_mots_doux (a, b, pour, texte, at, lu) VALUES (?, ?, ?, ?, ?, 0)');
const lireMot = db.prepare('SELECT * FROM mariage_mots_doux WHERE a = ? AND b = ? AND pour = ?');
const marquerMot = db.prepare('UPDATE mariage_mots_doux SET lu = 1 WHERE a = ? AND b = ? AND pour = ?');

// Dépose le mot de `deId` pour son conjoint (remplace le précédent).
function deposerMotDoux(a, b, deId, texte, quand = new Date()) {
  const [x, y] = [String(a), String(b)].sort();
  const de = String(deId);
  if (de !== x && de !== y) return false;
  const propre = String(texte ?? '').trim();
  if (!propre || propre.length > MOT_DOUX_MAX) return false;
  ecrireMot.run(x, y, de === x ? y : x, propre, new Date(quand).toISOString());
  return true;
}

function lireMotDoux(a, b, pourId) {
  const [x, y] = [String(a), String(b)].sort();
  return lireMot.get(x, y, String(pourId)) || null;
}

function marquerMotDouxLu(a, b, pourId) {
  const [x, y] = [String(a), String(b)].sort();
  marquerMot.run(x, y, String(pourId));
}

// ── 💔 Divorce : tout ce qui appartenait au couple disparaît ────────────
//
// ⚠️ Sauf l'XP du bisou déjà reçue aujourd'hui (mariage_bisous_xp) : elle
// appartient à chaque personne, pas au couple, et ne doit pas se regagner.

const effacerFlamme = db.prepare('DELETE FROM mariage_flammes WHERE a = ? AND b = ?');
const effacerMots = db.prepare('DELETE FROM mariage_mots_doux WHERE a = ? AND b = ?');
const effacerAnnonces = db.prepare('DELETE FROM mariage_annonces WHERE a = ? AND b = ?');

function effacerCouple(a, b) {
  const [x, y] = [String(a), String(b)].sort();
  effacerFlamme.run(x, y);
  effacerMots.run(x, y);
  effacerAnnonces.run(x, y);
  for (const cle of [...activite.keys()]) {
    if (cle.endsWith(`:${x}`) || cle.endsWith(`:${y}`)) activite.delete(cle);
  }
  invaliderUnionsCouple();
}

// ── 💘 /lc entre conjoints ──────────────────────────────────────────────
//
// Jamais moins de 90 % : le chiffre du jour est ramené entre 90 et 100 (il
// varie encore d'un jour à l'autre), avec un verdict à part. Pour tout autre
// duo, rien ne change.

function verdictLcCouple(p) {
  if (p >= 100) return '💍 Mariés et parfaitement accordés : 100 %, comme au premier jour.';
  if (p >= 95) return '💞 Mariés, et ça se voit : un amour qui ne faiblit pas.';
  return '💍 Les liens du mariage tiennent bon : jamais moins de 90 % entre vous.';
}

function pourcentageLcCouple(idA, idB, pourcentage, guildId = null) {
  try {
    const union = unionCouple(idA);
    if (!union || union.conjoint !== String(idB)) return { pourcentage, verdict: null };
    if (guildId && !avantagesCoupleActifs(guildId)) return { pourcentage, verdict: null };
    const p = Math.max(0, Math.min(100, Math.round(Number(pourcentage) || 0)));
    const marie = 90 + Math.round(p / 10);
    return { pourcentage: marie, verdict: verdictLcCouple(marie) };
  } catch {
    return { pourcentage, verdict: null };
  }
}

module.exports = {
  noterActiviteCouple, bonusXpCouple, pourcentageLcCouple,
  DEFAUTS_COUPLE, BORNES_COUPLE, ALLIANCES_COUPLE, MOT_DOUX_MAX,
  reglagesCouple, avantagesCoupleActifs, unionCouple, toutesLesUnionsCouple, invaliderUnionsCouple,
  actifRecemmentCouple, allianceCouple, luneDeMielCouple, calculBonusCouple, raisonBonusCouple,
  nomDeCouple, jourDeParis, heureDeParis, decalerJourCouple,
  enregistrerBisou, etatFlammeCouple, prochaineFeteCouple, feteAnnonceeCouple, noterAnnonceCouple,
  xpBisouRecueCouple, reserverXpBisouCouple,
  deposerMotDoux, lireMotDoux, marquerMotDouxLu, effacerCouple, verdictLcCouple,
};
