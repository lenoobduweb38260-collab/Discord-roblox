// 🐉 Aventure SAO — le moteur du combat de boss, tour par tour.
//
// Pur : l'état est un objet JSON (il vit en base, dans sao_combats.etat) et
// chaque tour le fait évoluer. Aucune base, aucun réseau, un hasard injecté :
// le même tour rejoué avec la même graine donne le même résultat.
//
// Un tour :
//   1. le joueur agit — Attaquer, Garde, un Sword Skill, ou un objet ;
//   2. le boss répond — coup normal, CHARGE télégraphiée (tous les 3 tours,
//      sans dégâts), puis DÉCHAÎNEMENT au tour suivant (× 2,2). Une Garde
//      au bon moment est une « parade parfaite » : dégâts × 0,3 et une
//      ouverture — « Switch ! » — qui donne +50 % au coup suivant. Sous 30 %
//      de PV, il entre en rage (× 1,3) ;
//   3. le poison ronge, les délais post-motion des skills s'écoulent.
//
// Le renseignement d'Argo retire 15 % à l'attaque du boss.

const D = require('./donnees');
const F = require('./formules');

const MULT_DECHAINEMENT = 2.2;
const PARADE_CHARGE = 0.3;
const SWITCH_MULT = 1.5;
const PARADE_NORMALE = 0.35;
const RAGE_SEUIL = 0.3;
const RAGE_MULT = 1.3;
const ARGO_MULT = 0.85;
const POISON_PART = 0.04;
const POISON_TOURS = 3;
const JOURNAL_TOURS = 2;

// Les Sword Skills d'un aventurier : sa famille d'arme, son niveau, et la
// compétence unique s'il la détient. Du plus fort au plus faible.
function skillsDisponibles(niveau, famille, dualBlades = false) {
  return Object.entries(D.SKILLS)
    .filter(([, s]) => s.niveau <= niveau && (s.famille === famille || (dualBlades && s.famille === 'double')))
    .sort((a, b) => b[1].mult * b[1].coups - a[1].mult * a[1].coups)
    .map(([cle]) => cle);
}

function nouveauCombat({ etage, boss, statsBoss, joueur, argo = false, antiCristal = false }) {
  return {
    etage,
    boss: { nom: boss.nom, emoji: boss.emoji || '👹', nomme: Boolean(boss.nomme), lab: boss.lab || null },
    bPv: statsBoss.pv,
    bMax: statsBoss.pv,
    bAtk: statsBoss.atk,
    jPv: Math.max(1, Math.min(joueur.pv, joueur.pvMax)),
    jMax: joueur.pvMax,
    jAtk: joueur.atk,
    jDef: joueur.def,
    skills: (joueur.skills || []).slice(0, 5),
    recharges: {},
    tour: 0,
    charge: false,
    etourdi: 0,
    rage: false,
    poison: 0,
    // Les boss pairs crachent du poison : de quoi donner un sens à l'antidote.
    venimeux: etage % 2 === 0,
    ouverture: false,
    argo: Boolean(argo),
    antiCristal: Boolean(antiCristal),
    skillsLances: 0,
    journal: [],
  };
}

function atkBoss(etat) {
  return etat.bAtk * (etat.argo ? ARGO_MULT : 1) * (etat.rage ? RAGE_MULT : 1);
}

// Peut-on lancer ce skill maintenant ? Renvoie null, ou la raison du refus.
function refusSkill(etat, cle) {
  if (!etat.skills.includes(cle) || !D.SKILLS[cle]) return 'Tu ne maîtrises pas ce Sword Skill.';
  const reste = etat.recharges[cle] || 0;
  if (reste > 0) return `**${D.SKILLS[cle].nom}** se recharge encore ${reste} tour${reste > 1 ? 's' : ''}.`;
  return null;
}

// Peut-on utiliser cet objet en combat ? Renvoie null, ou la raison du refus.
function refusObjet(etat, objet) {
  if (!objet || objet.type !== 'consommable') return 'Cet objet ne s\'utilise pas en combat.';
  if (objet.cristal && etat.antiCristal) return '🚫 Salle anti-cristal : les cristaux ne fonctionnent pas ici.';
  if (objet.soin && etat.jPv >= etat.jMax) return 'Tes PV sont déjà au maximum.';
  if (objet.antidote && !etat.poison) return 'Tu n\'es pas empoisonné.';
  if (!objet.soin && !objet.antidote) return 'Cet objet ne s\'utilise pas pendant un tour de combat.';
  return null;
}

// Joue un tour. `action` : { type: 'attaque' | 'garde' | 'skill' | 'objet', cle, objet }.
// Mute `etat` et renvoie { fin: null | 'victoire' | 'defaite', lignes, refus }.
function jouerTourBoss(etat, action, rng = Math.random) {
  const lignes = [];
  const nomBoss = `${etat.boss.emoji} **${etat.boss.nom}**`;
  let garde = false;
  let esquive = false;
  // Ouverture gagnée par une parade parfaite au tour précédent.
  const ouverture = etat.ouverture ? SWITCH_MULT : 1;
  if (action.type === 'skill' || action.type === 'attaque' || !action.type) etat.ouverture = false;

  // ── 1. Le joueur ──
  if (action.type === 'skill') {
    const refus = refusSkill(etat, action.cle);
    if (refus) return { fin: null, lignes: [], refus };
    const s = D.SKILLS[action.cle];
    let total = 0;
    let crits = 0;
    for (let i = 0; i < s.coups; i++) {
      const c = F.coupSao(etat.jAtk, rng, { mult: s.mult * ouverture, critique: s.effet === 'critique' });
      total += c.degats;
      if (c.crit) crits++;
    }
    etat.bPv -= total;
    etat.recharges[action.cle] = s.recharge;
    etat.skillsLances = (etat.skillsLances || 0) + 1;
    const detail = s.coups > 1 ? ` (${s.coups} coups${crits ? `, ${crits} critiques` : ''})` : crits ? ' 💥 critique' : '';
    lignes.push(`${s.emoji} **${s.nom}** ! **${total}** dégâts${detail}${ouverture > 1 ? ' — **Switch !**' : '.'}`);
    if (s.effet === 'esquive') {
      esquive = true;
      lignes.push('🌪️ Ton bond te met hors de portée.');
    }
    if (s.effet === 'etourdit' && etat.bPv > 0) {
      etat.etourdi = Math.max(etat.etourdi, 1);
      if (etat.charge) lignes.push(`💫 Sa charge est brisée !`);
      etat.charge = false;
    }
  } else if (action.type === 'garde') {
    garde = true;
    lignes.push('🛡️ Tu te mets en garde.');
  } else if (action.type === 'objet') {
    const refus = refusObjet(etat, action.objet);
    if (refus) return { fin: null, lignes: [], refus };
    const o = action.objet;
    if (o.soin) {
      const avant = etat.jPv;
      etat.jPv = Math.min(etat.jMax, etat.jPv + Math.round(etat.jMax * o.soin));
      lignes.push(`${o.emoji} ${o.nom} : **+${etat.jPv - avant} PV**.`);
    }
    if (o.antidote) {
      etat.poison = 0;
      lignes.push(`${o.emoji} Le poison se dissipe.`);
    }
  } else {
    const c = F.coupSao(etat.jAtk, rng, { mult: ouverture });
    etat.bPv -= c.degats;
    lignes.push(`⚔️ Tu frappes : **${c.degats}** dégâts${c.crit ? ' 💥 critique' : ''}${ouverture > 1 ? ' — **Switch !**' : '.'}`);
  }

  if (etat.bPv <= 0) {
    etat.bPv = 0;
    etat.tour += 1;
    lignes.push(`🏆 ${nomBoss} se brise en mille éclats de polygones !`);
    noterJournal(etat, lignes);
    return { fin: 'victoire', lignes };
  }

  if (!etat.rage && etat.bPv < etat.bMax * RAGE_SEUIL) {
    etat.rage = true;
    lignes.push(`💢 ${nomBoss} entre en rage !`);
  }

  // ── 2. Le boss ──
  const subir = (mult, parade) => {
    const brut = F.coupSao(atkBoss(etat), rng, { mult }).degats * F.reductionArmure(etat.jDef);
    return Math.max(1, Math.round(brut * (garde ? parade : 1)));
  };
  if (etat.etourdi > 0) {
    etat.etourdi -= 1;
    lignes.push(`💫 ${nomBoss} est étourdi et ne peut pas agir.`);
  } else if (etat.charge) {
    etat.charge = false;
    if (esquive) {
      lignes.push(`🌪️ Son attaque dévastatrice frappe le vide !`);
    } else {
      const d = subir(MULT_DECHAINEMENT, PARADE_CHARGE);
      etat.jPv -= d;
      if (garde) {
        etat.ouverture = true;
        lignes.push(`✨ **Parade parfaite !** Tu n'encaisses que **${d}** : ouverture, ton prochain coup fait +50 %.`);
      } else {
        lignes.push(`💥 ${nomBoss} se déchaîne : **${d}** dégâts !`);
      }
    }
  } else if (etat.tour % 3 === 2) {
    etat.charge = true;
    lignes.push(`⚠️ ${nomBoss} prépare une attaque dévastatrice… *(🛡️ Garde conseillée)*`);
  } else if (esquive) {
    lignes.push(`🌪️ ${nomBoss} frappe dans le vide.`);
  } else {
    const d = subir(1, PARADE_NORMALE);
    etat.jPv -= d;
    lignes.push(`👊 ${nomBoss} riposte : **${d}** dégâts${garde ? ' (paré)' : ''}.`);
    if (etat.venimeux && !garde && !etat.poison && rng() < 0.25) {
      etat.poison = POISON_TOURS;
      lignes.push('🤢 Tu es **empoisonné** ! *(🧴 Antidote)*');
    }
  }

  // ── 3. Fin du tour ──
  if (etat.poison > 0 && etat.jPv > 0) {
    const d = Math.max(1, Math.round(etat.jMax * POISON_PART));
    etat.jPv -= d;
    etat.poison -= 1;
    lignes.push(`🤢 Le poison te ronge : **${d}** dégâts.`);
  }
  for (const cle of Object.keys(etat.recharges)) {
    etat.recharges[cle] = Math.max(0, etat.recharges[cle] - 1);
    if (!etat.recharges[cle]) delete etat.recharges[cle];
  }
  etat.tour += 1;

  if (etat.jPv <= 0) {
    etat.jPv = 0;
    lignes.push(`💀 Tes PV tombent à zéro…`);
    noterJournal(etat, lignes);
    return { fin: 'defaite', lignes };
  }
  noterJournal(etat, lignes);
  return { fin: null, lignes };
}

// Le journal ne garde que les deux derniers tours : assez pour comprendre
// ce qui vient de se passer, sans noyer la carte.
function noterJournal(etat, lignes) {
  etat.journal = [...(etat.journal || []), { tour: etat.tour, lignes }].slice(-JOURNAL_TOURS);
}

// Une stratégie raisonnable, pour la simulation : parer les charges, se
// soigner sous 35 %, lancer le meilleur skill prêt, sinon attaquer.
function strategieSimple(etat, inventaire = {}) {
  if (etat.charge) return { type: 'garde' };
  if (etat.jPv < etat.jMax * 0.35) {
    for (const cle of ['grand_cristal', 'cristal_soin', 'potion_soin']) {
      if ((inventaire[cle] || 0) > 0 && !refusObjet(etat, D.OBJETS[cle])) return { type: 'objet', cle, objet: D.OBJETS[cle] };
    }
  }
  if (etat.poison && (inventaire.antidote || 0) > 0) return { type: 'objet', cle: 'antidote', objet: D.OBJETS.antidote };
  const pret = etat.skills.find((cle) => !refusSkill(etat, cle));
  if (pret) return { type: 'skill', cle: pret };
  return { type: 'attaque' };
}

// Un combat entier, joué par la stratégie simple. Pour les tests et la
// simulation d'équilibrage. `inventaire` est consommé (mutation).
function simulerCombatBoss(etat, inventaire = {}, rng = Math.random, maxTours = 120) {
  for (let i = 0; i < maxTours; i++) {
    const action = strategieSimple(etat, inventaire);
    const r = jouerTourBoss(etat, action, rng);
    if (action.type === 'objet' && !r.refus) inventaire[action.cle] -= 1;
    if (r.fin) return r.fin;
  }
  return 'defaite';
}

module.exports = {
  MULT_DECHAINEMENT, PARADE_CHARGE, SWITCH_MULT, RAGE_SEUIL, ARGO_MULT, JOURNAL_TOURS,
  skillsDisponibles, nouveauCombat, jouerTourBoss, refusSkill, refusObjet, strategieSimple, simulerCombatBoss,
};
