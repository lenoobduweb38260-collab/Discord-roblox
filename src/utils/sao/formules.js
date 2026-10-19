// 📐 Aventure SAO — la courbe de progression, en un seul endroit.
//
// Fonctions pures : aucune base, aucun réseau. `tests/sao.test.js` les
// éprouve par une simulation de joueur régulier.
//
// ════════════════════════════════════════════════════════════════════════
// LA COURBE
// ════════════════════════════════════════════════════════════════════════
//
// Tout part d'un AVENTURIER DE RÉFÉRENCE, à chaque étage f :
//
//   niveau   = f + 3
//   arme     = le palier que Lisbeth forge à cet étage, améliorée à +3
//   armure   = le même palier
//
// Monstres et boss sont taillés sur lui. Ses dégâts à chaque étage :
//
//   ATK  = 6 + 3·niveau + ATK_arme·(1 + 7 % par +1)
//   PV   = 80 + 18·niveau + PV_armure
//   DEF  → dégâts reçus × 100 / (100 + DEF)
//
// À l'étage 50, l'arme apporte ~170 ATK et le niveau ~165 : **l'équipement
// pèse autant que le niveau**. Un aventurier au bon niveau mais à l'arme de
// départ ne passe pas le boss — et l'inverse non plus (vérifié par le test).
//
//   Monstre : 3 coups de l'ATK de référence ; chaque riposte ≈ 6 % des PV.
//   Boss    : (11 + 0,04·f) tours de dégâts de la référence, Sword Skills
//             compris (multiplicateurRotation) ; chaque coup ≈ 18 % des PV,
//             une charge télégraphiée tous les 3 tours (× 2,2), la rage
//             sous 30 % de PV (× 1,3). Il faut parer, soigner, et user
//             des Sword Skills : à la référence, ~85 % de victoires avec
//             trois cristaux, bien moins sans objets, sans le niveau ou
//             sans l'arme.
//
// Gains d'une chasse à l'étage f : XP = 10 + 4·f, Col = 8 + 3·f.
// Niveau L → L+1 : 150 + 190·L XP (≈ 50 chasses), adouci au début
// (50 + 25·L² jusqu'au niveau 8). Les chasses ne font qu'un tiers de la
// progression : la quotidienne et sa série, les trois quêtes, l'AFK de la
// nuit et surtout les boss (15 chasses d'XP chacun) font le reste. C'est
// voulu : revenir chaque jour compte plus que rester toute la nuit.
//
// Simulation (`simulation.js`, vérifiée par le test) :
//   ➜ 60 chasses par jour  : étage 50 vers le 16ᵉ jour, étage 100 vers le 30ᵉ ;
//   ➜ 20 chasses par jour  : étage 100 en sept semaines environ ;
//   ➜ 100 chasses par jour : un peu plus de trois semaines.
// Le niveau final tourne autour de 102, celui de la référence.

const D = require('./donnees');

const CRIT_CHANCE = 0.18;
const CRIT_MULT = 1.6;
const REGEN_PAR_MINUTE = 0.02; // 2 % des PV max par minute hors combat
const PLUS_MAX = 10;
const PLUS_REFERENCE = 3; // atteint dès l'étage 12 (voir plusReference)
const PV_MORT = 0.25; // on revient du Monument of Life à 25 % des PV
const XP_PERDUE_MORT = 0.2; // 20 % de l'XP du niveau en cours
const XP_NIVEAU_BASE = 150;
const XP_NIVEAU_PAR_NIVEAU = 190;
const COL_DEPART = 100; // et un petit kit : 3 potions, 1 cristal de soin
// Butin d'une chasse gagnée (probabilités indépendantes).
const CHANCES = {
  materiau: 0.55, // matériau de la tranche d'étages
  butin: 0.35, // trophée à revendre chez Agil
  viande: 0.1,
  baies: 0.06,
  potion: 0.04,
  cristal: 0.02,
  coffre: 0.01,
  teleport: 0.01,
};
const BOSS_COUPS = 11; // PV du boss, en tours de dégâts de la référence…
const BOSS_COUPS_PAR_ETAGE = 0.04; // …un peu plus haut à chaque étage
const BOSS_PART_PV = 0.18; // un coup normal du boss ≈ 18 % des PV de référence

const DIFFICULTES = {
  facile: { nom: 'Facile', emoji: '🟢', ennemi: 0.8, gains: 0.9 },
  normal: { nom: 'Normale', emoji: '🟡', ennemi: 1, gains: 1 },
  difficile: { nom: 'Difficile', emoji: '🟠', ennemi: 1.25, gains: 1.15 },
  heroique: { nom: 'Héroïque', emoji: '🔴', ennemi: 1.5, gains: 1.3 },
};
const difficulteSao = (cle) => DIFFICULTES[cle] || DIFFICULTES.normal;

// ── Hasard reproductible (simulations et tests) ─────────────────────────
function aleaGraine(graine) {
  let a = (Number(graine) >>> 0) || 1;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Aventurier ──────────────────────────────────────────────────────────
// Linéaire, mais les premiers niveaux tombent vite (50 + 25·L², jusqu'au
// niveau 8) : le premier boss se mérite en une petite séance, pas en trois.
function xpPourNiveau(niveau) {
  const n = Math.max(1, niveau);
  return Math.min(XP_NIVEAU_BASE + XP_NIVEAU_PAR_NIVEAU * n, 50 + 25 * n * n);
}
function pvMaxDe(niveau, pvArmure = 0, bonusPv = 0) {
  return Math.round((80 + 18 * niveau + pvArmure) * (1 + bonusPv));
}
function atkDe(niveau, atkArme = 0, plus = 0, bonusAtk = 0) {
  return Math.round((6 + 3 * niveau + atkArme * (1 + 0.07 * plus)) * (1 + bonusAtk));
}
function defDe(defArmure = 0, bonusDef = 0) {
  return Math.round(defArmure * (1 + bonusDef));
}
// Part des dégâts qui passe l'armure.
function reductionArmure(def) {
  return 100 / (100 + Math.max(0, def));
}

function niveauConseille(etage) {
  return Math.max(1, etage + 3);
}
function palierConseille(etage) {
  let p = 0;
  for (let i = 0; i < D.ETAGE_PALIER.length; i++) if (D.ETAGE_PALIER[i] <= etage) p = i;
  return p;
}

// Les premiers étages pardonnent : on n'attend pas d'arme améliorée avant
// d'avoir eu le temps de la payer.
function plusReference(etage) {
  return Math.min(PLUS_REFERENCE, Math.floor(etage / 4));
}

// L'aventurier de référence d'un étage, prêt pour le boss (voir l'en-tête).
function aventurierReference(etage, { plus = null, ecartNiveau = 0, ecartPalier = 0 } = {}) {
  const niveau = Math.max(1, niveauConseille(etage) + ecartNiveau);
  const palier = Math.max(0, palierConseille(etage) + ecartPalier);
  const p = palier === 0 ? 0 : (plus ?? plusReference(etage));
  return {
    niveau,
    palier,
    plus: p,
    atk: atkDe(niveau, D.ATK_PALIER[palier], p),
    pv: pvMaxDe(niveau, D.PV_PALIER[palier]),
    def: defDe(D.DEF_PALIER[palier]),
  };
}

// L'aventurier qui ARRIVE sur un étage : niveau = étage, l'équipement de
// l'étage précédent, sans amélioration. Les monstres se calent sur lui —
// sinon un débutant de niveau 1 ne survivrait pas à son premier sanglier.
function aventurierArrivee(etage) {
  const niveau = Math.max(1, etage);
  const palier = palierConseille(etage - 1);
  return {
    niveau, palier, plus: 0,
    atk: atkDe(niveau, D.ATK_PALIER[palier], 0),
    pv: pvMaxDe(niveau, D.PV_PALIER[palier]),
    def: defDe(D.DEF_PALIER[palier]),
  };
}

// ── Ennemis ─────────────────────────────────────────────────────────────
function statsMonstre(etage, type = { pv: 1, atk: 1 }, diff = 'normal') {
  const r = aventurierArrivee(etage);
  const k = difficulteSao(diff).ennemi;
  return {
    pv: Math.max(10, Math.round(3 * r.atk * type.pv * k)),
    atk: Math.max(3, Math.round((0.06 * r.pv / reductionArmure(r.def)) * type.atk * k)),
  };
}

// Dégâts moyens d'un tour, en multiples de l'ATK, pour un aventurier qui
// enchaîne ses Sword Skills dès qu'ils sont prêts (critiques comprises).
// Sans ce facteur, les boss s'affaibliraient à mesure que les skills
// s'ajoutent : Vorpal Strike au niveau 35 vaut trois coups normaux.
const memoRotation = new Map();
function multiplicateurRotation(niveau, famille = 'epee') {
  const cle = `${niveau}:${famille}`;
  if (memoRotation.has(cle)) return memoRotation.get(cle);
  const crit = 1 + CRIT_CHANCE * (CRIT_MULT - 1);
  const skills = Object.values(D.SKILLS)
    .filter((s) => s.famille === famille && s.niveau <= niveau)
    .map((s) => ({ ...s, total: s.mult * s.coups * (s.effet === 'critique' ? CRIT_MULT : crit) }))
    .sort((a, b) => b.total - a.total);
  const recharges = new Map();
  let somme = 0;
  const TOURS = 30;
  for (let t = 0; t < TOURS; t++) {
    const pret = skills.find((s) => !(recharges.get(s.nom) > 0));
    if (pret) {
      somme += pret.total;
      recharges.set(pret.nom, pret.recharge);
    } else {
      somme += crit;
    }
    for (const [k, v] of recharges) recharges.set(k, v - 1);
  }
  const m = somme / TOURS;
  memoRotation.set(cle, m);
  return m;
}

function statsBoss(etage, diff = 'normal') {
  const r = aventurierReference(etage);
  const k = difficulteSao(diff).ennemi;
  const rotation = (multiplicateurRotation(r.niveau, 'epee') + multiplicateurRotation(r.niveau, 'rapiere')) / 2;
  return {
    pv: Math.round((BOSS_COUPS + BOSS_COUPS_PAR_ETAGE * etage) * r.atk * rotation * k),
    atk: Math.max(5, Math.round((BOSS_PART_PV * r.pv / reductionArmure(r.def)) * k)),
  };
}

// ── Gains ───────────────────────────────────────────────────────────────
function xpChasse(etage) {
  return 10 + 4 * etage;
}
function colChasse(etage) {
  return 8 + 3 * etage;
}
function gainsBoss(etage) {
  return { col: 25 * colChasse(etage), xp: 15 * xpChasse(etage), xpServeur: 25 + 2 * etage };
}
function gainsAfkParMinute(etage) {
  // ~25 minutes d'absence valent une chasse : l'AFK aide, sans remplacer le jeu.
  return { xp: 0.04 * xpChasse(etage), col: 0.04 * colChasse(etage) };
}
function gainsQuotidien(etage, serie) {
  const k = 1 + 0.1 * Math.min(Math.max(0, serie - 1), 9);
  return { col: Math.round(15 * colChasse(etage) * k), xp: Math.round(8 * xpChasse(etage) * k) };
}
function gainsQuete(etage) {
  return { col: 6 * colChasse(etage), xp: 6 * xpChasse(etage) };
}

// ── Économie ────────────────────────────────────────────────────────────
function coutForge(objet) {
  if (!objet || objet.etage == null) return 0;
  if (!objet.palier) return 0;
  // Une arme coûte 15 + 4·palier chasses de son étage, une armure 12 + 3·palier.
  const chasses = objet.type === 'armure' ? 12 + 3 * objet.palier : 15 + 4 * objet.palier;
  return Math.round(chasses * colChasse(objet.etage));
}
// Passer de +n à +n+1.
function coutAmelioration(objet, plusActuel) {
  const etage = objet.etage ?? D.ETAGE_PALIER[Math.min(D.PALIER_MAX, objet.palier || 0)];
  const n = plusActuel + 1;
  const mat = D.TRANCHES[D.trancheDe(etage)].materiau;
  return { col: Math.round(6 * n * colChasse(etage)), mats: { [mat]: n } };
}
// Taux de réussite d'une amélioration (en %).
function tauxAmelioration(plusActuel, bonus = 0) {
  return Math.max(25, Math.min(100, 95 - 7 * plusActuel + bonus));
}
function prixBoutique(objet, etage) {
  return Math.round((objet.prix || 0) * (1 + 0.3 * Math.max(1, etage)));
}
function prixVente(objet, bonus = 0) {
  return Math.max(1, Math.round((objet.vente || 1) * (1 + bonus)));
}
// L'auberge : un plein de PV coûte le gain d'une chasse.
function coutAuberge(etage, manquant, pvMax) {
  if (manquant <= 0 || pvMax <= 0) return 0;
  return Math.max(1, Math.ceil(colChasse(etage) * (manquant / pvMax)));
}
function prixRenseignement(etage) {
  return 4 * colChasse(etage);
}

// ── Combat ──────────────────────────────────────────────────────────────
// Un coup : ± 15 %, avec une chance de critique.
function coupSao(atk, rng = Math.random, { critique = false, mult = 1 } = {}) {
  const variance = 0.85 + rng() * 0.3;
  const crit = critique || rng() < CRIT_CHANCE;
  const degats = Math.max(1, Math.round(atk * mult * variance * (crit ? CRIT_MULT : 1)));
  return { degats, crit };
}

// Chasse : combat résolu d'un coup. Le joueur frappe le premier.
function combatChasse(joueur, monstre, rng = Math.random) {
  let pvM = monstre.pv;
  let pv = joueur.pv;
  let inflige = 0;
  let subi = 0;
  let crits = 0;
  for (let tour = 0; tour < 30 && pvM > 0 && pv > 0; tour++) {
    const coup = coupSao(joueur.atk, rng);
    if (coup.crit) crits++;
    pvM -= coup.degats;
    inflige += coup.degats;
    if (pvM <= 0) break;
    const riposte = Math.max(1, Math.round(coupSao(monstre.atk, rng).degats * reductionArmure(joueur.def)));
    pv = Math.max(0, pv - riposte);
    subi += riposte;
  }
  return { victoire: pvM <= 0 && pv > 0, pv, inflige, subi, crits };
}

// Ajoute de l'XP (mutation) ; renvoie le nombre de niveaux gagnés.
function ajouterXp(joueur, montant) {
  joueur.xp = (joueur.xp || 0) + Math.max(0, Math.round(montant));
  let niveaux = 0;
  while (joueur.xp >= xpPourNiveau(joueur.level)) {
    joueur.xp -= xpPourNiveau(joueur.level);
    joueur.level += 1;
    niveaux += 1;
  }
  return niveaux;
}

// Barre de progression (PV, XP…).
function barreSao(cur, max, taille = 12) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
  const plein = Math.round(ratio * taille);
  return '▰'.repeat(plein) + '▱'.repeat(taille - plein);
}

module.exports = {
  COL_DEPART, CHANCES, CRIT_CHANCE, CRIT_MULT, REGEN_PAR_MINUTE, PLUS_MAX, PLUS_REFERENCE, PV_MORT, XP_PERDUE_MORT, DIFFICULTES,
  difficulteSao, aleaGraine, xpPourNiveau, pvMaxDe, atkDe, defDe, reductionArmure, niveauConseille, palierConseille,
  plusReference, multiplicateurRotation, aventurierReference, aventurierArrivee, statsMonstre, statsBoss, xpChasse, colChasse, gainsBoss, gainsAfkParMinute, gainsQuotidien,
  gainsQuete, coutForge, coutAmelioration, tauxAmelioration, prixBoutique, prixVente, coutAuberge,
  prixRenseignement, coupSao, combatChasse, ajouterXp, barreSao,
};
