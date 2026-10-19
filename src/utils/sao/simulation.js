// 🧮 Aventure SAO — simulation d'un joueur régulier, de l'étage 1 à 100.
//
// Elle rejoue les VRAIES formules (formules.js) et le VRAI moteur de combat
// (combat.js) : si l'équilibrage dérive, `tests/sao.test.js` le voit.
//
// Le joueur simulé, chaque jour :
//   ➜ réclame sa quotidienne, ses gains AFK de la nuit (8 h) et trois quêtes ;
//   ➜ chasse `chassesParJour` fois sur son étage le plus haut ;
//   ➜ se soigne à l'auberge sous 40 % de PV ;
//   ➜ forge le palier suivant dès qu'il le peut, puis améliore son arme ;
//   ➜ tente le boss quand il atteint le niveau conseillé moins un, avec
//     trois cristaux et six potions en poche.
//
// Pur : aucune base, aucun réseau, un hasard à graine.

const D = require('./donnees');
const F = require('./formules');
const C = require('./combat');

function simulerProgression({ chassesParJour = 60, graine = 7, joursMax = 400, famille = 'epee' } = {}) {
  const rng = F.aleaGraine(graine);
  const j = {
    level: 1, xp: 0, etage: 1, col: F.COL_DEPART, arme: 0, plus: 0, armure: 0,
    mats: {}, lingots: 0, inv: { potion_soin: 3, cristal_soin: 1, antidote: 0 }, pv: 0,
  };
  const stats = () => {
    const a = D.ATK_PALIER[j.arme];
    return {
      atk: F.atkDe(j.level, a, j.plus),
      pvMax: F.pvMaxDe(j.level, D.PV_PALIER[j.armure]),
      def: F.defDe(D.DEF_PALIER[j.armure]),
    };
  };
  j.pv = stats().pvMax;
  const jalons = {};
  let morts = 0;
  let combatsBoss = 0;
  let serie = 0;

  const gagnerXp = (n) => F.ajouterXp(j, n);
  const mourir = () => {
    morts += 1;
    j.col -= Math.floor(j.col * 0.1);
    j.xp -= Math.floor(j.xp * F.XP_PERDUE_MORT);
    j.pv = Math.round(stats().pvMax * F.PV_MORT);
  };
  const acheter = (cle, n) => {
    const prix = F.prixBoutique(D.OBJETS[cle], j.etage);
    while ((j.inv[cle] || 0) < n && j.col >= prix) {
      j.col -= prix;
      j.inv[cle] = (j.inv[cle] || 0) + 1;
    }
  };
  const recette = (palier, armure) => D.OBJETS[armure ? D.ARMURES[palier] : D.ARMES_PAR_FAMILLE[famille][palier]];
  const peutPayer = (obj, col) => {
    if (j.col < col) return false;
    for (const [m, n] of Object.entries(obj.mats || {})) {
      if (m === 'lingot_cristallite') { if (j.lingots < n) return false; } else if ((j.mats[m] || 0) < n) return false;
    }
    return true;
  };
  const payer = (mats, col) => {
    j.col -= col;
    for (const [m, n] of Object.entries(mats || {})) {
      if (m === 'lingot_cristallite') j.lingots -= n; else j.mats[m] -= n;
    }
  };
  const magasiner = () => {
    // Le palier suivant d'abord : arme, puis armure. Ensuite l'amélioration.
    for (const armure of [false, true]) {
      const actuel = armure ? j.armure : j.arme;
      if (actuel >= D.PALIER_MAX) continue;
      const obj = recette(actuel + 1, armure);
      if (obj.etage > j.etage) continue;
      const col = F.coutForge(obj);
      if (!peutPayer(obj, col)) continue;
      payer(obj.mats, col);
      if (armure) j.armure += 1; else { j.arme += 1; j.plus = 0; }
    }
    // On n'améliore pas l'arme tant que l'armure du même palier attend.
    const armureEnAttente = j.armure < j.arme && recette(j.armure + 1, true).etage <= j.etage;
    if (j.arme > 0 && j.plus < F.PLUS_MAX && !armureEnAttente) {
      const c = F.coutAmelioration(recette(j.arme, false), j.plus);
      // On garde de quoi payer ses cristaux avant le boss.
      const reserve = 3 * F.prixBoutique(D.OBJETS.cristal_soin, j.etage);
      if (peutPayer({ mats: c.mats }, c.col + reserve)) {
        payer(c.mats, c.col);
        if (rng() * 100 < F.tauxAmelioration(j.plus)) j.plus += 1;
      }
    }
  };
  const chasser = () => {
    const s = stats();
    if (j.pv < s.pvMax * 0.4) {
      j.col -= Math.min(j.col, F.coutAuberge(j.etage, s.pvMax - j.pv, s.pvMax));
      j.pv = s.pvMax;
    }
    const tranche = D.TRANCHES[D.trancheDe(j.etage)];
    const type = tranche.monstres[Math.floor(rng() * tranche.monstres.length)];
    const r = F.combatChasse({ atk: s.atk, pv: j.pv, def: s.def }, F.statsMonstre(j.etage, type), rng);
    if (!r.victoire) return mourir();
    j.pv = r.pv;
    const avant = j.level;
    gagnerXp(F.xpChasse(j.etage) * (0.9 + rng() * 0.2));
    if (j.level > avant) j.pv = Math.min(stats().pvMax, j.pv + Math.round(stats().pvMax * 0.2 * (j.level - avant)));
    j.col += Math.round(F.colChasse(j.etage) * (0.9 + rng() * 0.2));
    if (rng() < F.CHANCES.materiau) j.mats[tranche.materiau] = (j.mats[tranche.materiau] || 0) + 1;
    if (rng() < F.CHANCES.butin) j.col += D.OBJETS[tranche.butin].vente;
    if (j.etage >= D.RENCONTRES_RARES.dragon_blanc.etageMin && rng() < D.RENCONTRES_RARES.dragon_blanc.chance) j.lingots += 1;
    // Un peu de regen entre deux chasses (15 s).
    j.pv = Math.min(stats().pvMax, j.pv + Math.round(stats().pvMax * F.REGEN_PAR_MINUTE * 0.25));
  };
  const tenterBoss = () => {
    if (j.level < F.niveauConseille(j.etage) - 1) return;
    acheter('cristal_soin', 3);
    acheter('potion_soin', 6);
    acheter('antidote', 2);
    const s = stats();
    j.col -= Math.min(j.col, F.coutAuberge(j.etage, s.pvMax - j.pv, s.pvMax));
    j.pv = s.pvMax;
    combatsBoss += 1;
    const etat = C.nouveauCombat({
      etage: j.etage, boss: D.bossDe(j.etage), statsBoss: F.statsBoss(j.etage),
      joueur: { pv: j.pv, pvMax: s.pvMax, atk: s.atk, def: s.def, skills: C.skillsDisponibles(j.level, famille) },
      antiCristal: D.salleAntiCristal(j.etage),
    });
    const fin = C.simulerCombatBoss(etat, j.inv, rng);
    if (fin !== 'victoire') return mourir();
    j.pv = Math.max(1, etat.jPv);
    const g = F.gainsBoss(j.etage);
    j.col += g.col;
    gagnerXp(g.xp);
    j.etage += 1;
  };

  let jour = 0;
  for (jour = 1; jour <= joursMax && j.etage <= 100; jour++) {
    serie += 1;
    const q = F.gainsQuotidien(j.etage, serie);
    j.col += q.col;
    gagnerXp(q.xp);
    j.inv.potion_soin = (j.inv.potion_soin || 0) + 2;
    j.inv.cristal_soin = (j.inv.cristal_soin || 0) + 1;
    const afk = F.gainsAfkParMinute(j.etage);
    gagnerXp(afk.xp * 8 * 60);
    j.col += Math.round(afk.col * 8 * 60);
    const quete = F.gainsQuete(j.etage);
    j.col += 3 * quete.col;
    gagnerXp(3 * quete.xp);
    for (let c = 0; c < chassesParJour && j.etage <= 100; c++) {
      chasser();
      magasiner();
      if (c % 10 === 9) tenterBoss();
    }
    tenterBoss();
    for (const palier of [10, 25, 50, 75, 100]) if (j.etage > palier && !jalons[palier]) jalons[palier] = jour;
  }
  return { jours: j.etage > 100 ? jalons[100] : null, jalons, morts, combatsBoss, niveau: j.level, arme: j.arme, plus: j.plus, armure: j.armure };
}

module.exports = { simulerProgression };
