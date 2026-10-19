// ⚔️ Aventure SAO — le catalogue.
//
// Données pures : aucun require, aucune base, aucun réseau. Ce fichier se lit
// comme le guide d'Argo : étages, villes, monstres, boss, objets, recettes,
// Sword Skills, quêtes, rumeurs et raids.
//
// ⚠️ Canon. Les boss nommés suivent Sword Art Online (roman, anime et
// Progressive). Un étage dont le canon ne nomme pas le boss reçoit un titre
// descriptif généré (« Colosse des Cavernes de l'étage 17 ») plutôt qu'un nom
// inventé qui passerait pour officiel.

// ── Raretés ─────────────────────────────────────────────────────────────
// Le canon n'a pas de paliers officiels : ceux-ci sont ceux des jeux SAO.
const RARETES = {
  commun: { nom: 'Commun', emoji: '⚪', ordre: 0 },
  rare: { nom: 'Rare', emoji: '🔵', ordre: 1 },
  epique: { nom: 'Épique', emoji: '🟣', ordre: 2 },
  legendaire: { nom: 'Légendaire', emoji: '🟠', ordre: 3 },
  lab: { nom: 'LAB', emoji: '🏆', ordre: 4 },
};

// ── Paliers d'équipement ────────────────────────────────────────────────
// Un palier par « tranche » de progression. L'étage requis est le premier
// étage où Lisbeth accepte de forger ce palier.
const ETAGE_PALIER = [1, 1, 8, 16, 25, 35, 45, 55, 65, 76, 88];
const ATK_PALIER = [4, 14, 34, 58, 85, 115, 146, 176, 206, 240, 276];
const DEF_PALIER = [0, 5, 13, 24, 37, 51, 66, 80, 95, 112, 130];
const PV_PALIER = [0, 15, 45, 85, 130, 180, 235, 285, 340, 400, 465];
const PALIER_MAX = ETAGE_PALIER.length - 1;

// ── Tranches d'étages (1-10, 11-20…) : matériaux, butin, monstres ───────
function trancheDe(etage) {
  return Math.min(10, Math.max(1, Math.ceil(Number(etage) / 10)));
}

const TRANCHES = {
  1: { theme: 'des Plaines', materiau: 'croc_loup', butin: 'defense_sanglier', monstres: [
    { nom: 'Frenzy Boar', emoji: '🐗', pv: 0.85, atk: 0.8 },
    { nom: 'Dire Wolf', emoji: '🐺', pv: 1, atk: 1.05 },
    { nom: 'Little Nepenthes', emoji: '🌱', pv: 1.1, atk: 0.9 },
    { nom: 'Ruin Kobold Trooper', emoji: '👺', pv: 1.15, atk: 1.1 },
    { nom: 'Trembling Ox', emoji: '🐂', pv: 1.25, atk: 1 },
  ] },
  2: { theme: 'des Cavernes', materiau: 'corne_taurus', butin: 'hache_kobold', monstres: [
    { nom: 'Kobold sentinelle', emoji: '👺', pv: 1, atk: 1 },
    { nom: 'Araignée des grottes', emoji: '🕷️', pv: 0.9, atk: 1.15 },
    { nom: 'Golem de pierre', emoji: '🗿', pv: 1.3, atk: 0.85 },
    { nom: 'Chauve-souris géante', emoji: '🦇', pv: 0.8, atk: 1.1 },
  ] },
  3: { theme: 'des Pins', materiau: 'ecorce_treant', butin: 'mousse_lumineuse', monstres: [
    { nom: 'Loup des pins', emoji: '🐺', pv: 0.95, atk: 1.1 },
    { nom: 'Tréant moussu', emoji: '🌳', pv: 1.3, atk: 0.85 },
    { nom: 'Spectre du lac', emoji: '👻', pv: 0.9, atk: 1.1 },
  ] },
  4: { theme: 'des Errances', materiau: 'soie_araignee', butin: 'banane_ape', monstres: [
    { nom: 'Drunk Ape', emoji: '🦍', pv: 1.1, atk: 1.05 },
    { nom: 'Loup des Errances', emoji: '🐺', pv: 0.95, atk: 1.1 },
    { nom: 'Araignée tisseuse', emoji: '🕸️', pv: 1, atk: 1 },
  ] },
  5: { theme: 'des Jardins', materiau: 'minerai_mithril', butin: 'aiguillon_guepe', monstres: [
    { nom: 'Guêpe des jardins', emoji: '🐝', pv: 0.85, atk: 1.15 },
    { nom: 'Golem de cristal', emoji: '💎', pv: 1.3, atk: 0.9 },
    { nom: 'Plante carnivore', emoji: '🌺', pv: 1, atk: 1 },
  ] },
  6: { theme: 'du Dragon blanc', materiau: 'ecaille_wyverne', butin: 'dent_wyverne', monstres: [
    { nom: 'Wyverne', emoji: '🐉', pv: 1.1, atk: 1.1 },
    { nom: 'Chevalier squelette', emoji: '💀', pv: 1, atk: 1 },
    { nom: 'Yéti des cimes', emoji: '❄️', pv: 1.25, atk: 0.9 },
  ] },
  7: { theme: 'des Marais', materiau: 'plume_griffon', butin: 'venin_scorpion', monstres: [
    { nom: 'Scorpion des sables', emoji: '🦂', pv: 0.95, atk: 1.15 },
    { nom: 'Hydre des marais', emoji: '🐍', pv: 1.25, atk: 1 },
    { nom: 'Griffon', emoji: '🦅', pv: 1, atk: 1.05 },
  ] },
  8: { theme: 'du Labyrinthe', materiau: 'os_faucheur', butin: 'ecaille_lizardman', monstres: [
    { nom: 'Lizardman Lord', emoji: '🦎', pv: 1.1, atk: 1.1 },
    { nom: 'Demonic Servant', emoji: '💀', pv: 1, atk: 1.05 },
    { nom: 'Gargouille', emoji: '🗿', pv: 1.25, atk: 0.9 },
  ] },
  9: { theme: 'd\'Obsidienne', materiau: 'eclat_obsidienne', butin: 'coeur_chimere', monstres: [
    { nom: 'Golem d\'obsidienne', emoji: '🪨', pv: 1.3, atk: 0.9 },
    { nom: 'Chimère', emoji: '🦁', pv: 1.05, atk: 1.15 },
    { nom: 'Spectre ancien', emoji: '👻', pv: 0.9, atk: 1.15 },
  ] },
  10: { theme: 'du Palais de rubis', materiau: 'fragment_rubis', butin: 'insigne_palais', monstres: [
    { nom: 'Gardien de rubis', emoji: '🛡️', pv: 1.3, atk: 0.95 },
    { nom: 'Chevalier du palais', emoji: '⚔️', pv: 1.1, atk: 1.1 },
    { nom: 'Ombre écarlate', emoji: '🩸', pv: 0.95, atk: 1.2 },
  ] },
};

// Apparitions rares, toutes tranches confondues.
const RENCONTRES_RARES = {
  // Le lapin du canon : Kirito en attrape un et Asuna en fait un ragoût.
  ragout_rabbit: { nom: 'Ragout Rabbit', emoji: '🐇', chance: 0.005, objet: 'ragout_rabbit', etageMin: 1 },
  // Le dragon blanc de l'étage 55, gardien du Crystallite Ingot.
  dragon_blanc: { nom: 'Dragon blanc', emoji: '🐉', chance: 0.04, objet: 'lingot_cristallite', etageMin: 55 },
};

// ── Villes et zones (canon quand il existe) ─────────────────────────────
const VILLES = {
  1: { ville: 'Town of Beginnings', zone: 'Plaines de Tolbana' },
  2: { ville: 'Urbus', zone: 'Plateaux des Taurus' },
  3: { ville: 'Zumfut', zone: 'Forêt des Elfes' },
  4: { ville: 'Rovia', zone: 'Canaux de Rovia' },
  5: { ville: 'Karluin', zone: 'Ruines de Karluin' },
  6: { ville: 'Stachion', zone: 'Labyrinthe des cubes' },
  11: { ville: 'Taft', zone: 'Collines de Taft' },
  22: { ville: 'Coral', zone: 'Lac et forêts de pins' },
  35: { ville: 'Mishe', zone: 'Forêt des Errances' },
  47: { ville: 'Floria', zone: 'Jardins de fleurs' },
  48: { ville: 'Lindarth', zone: 'Moulins de Lindarth' },
  50: { ville: 'Algade', zone: 'Ruelles d\'Algade' },
  55: { ville: 'Granzam', zone: 'Montagnes du Dragon blanc' },
  61: { ville: 'Selmburg', zone: 'Rives de Selmburg' },
  74: { ville: 'Kamdet', zone: 'Labyrinthe de l\'étage 74' },
  75: { ville: 'Collinia', zone: 'Colisée de Collinia' },
  100: { ville: 'Ruby Palace', zone: 'Palais de rubis' },
};

function villeDe(etage) {
  const v = VILLES[etage];
  if (v) return v;
  const t = TRANCHES[trancheDe(etage)];
  return { ville: `Bourg de l'étage ${etage}`, zone: `Terres ${t.theme}` };
}

// Salles anti-cristal : ni cristal de soin ni cristal de téléportation.
// Le canon en place aux étages 74 et 75 — là où tombèrent les nettoyeurs.
function salleAntiCristal(etage) {
  return etage === 74 || etage === 75;
}

// ── Boss d'étage ────────────────────────────────────────────────────────
// `lab` : l'objet du Last Attack Bonus, remis au dernier coup.
const BOSS_NOMMES = {
  1: { nom: 'Illfang the Kobold Lord', emoji: '👺', lab: 'coat_of_midnight' },
  2: { nom: 'Baran the General Taurus', emoji: '🐂' },
  3: { nom: 'Nerius the Evil Treant', emoji: '🌳' },
  4: { nom: 'Wythege the Hippocampus', emoji: '🐴' },
  5: { nom: 'Fuscus the Vacant Colossus', emoji: '🗿' },
  6: { nom: 'The Irrational Cube', emoji: '🧊' },
  // Le canon ne nomme pas ces deux-là : le géant bicéphale qui décima
  // l'Armée, et la statue de métal aux bras multiples de l'étage 50.
  25: { nom: 'Le Géant à deux têtes', emoji: '👹' },
  50: { nom: 'Le Colosse de métal aux mille bras', emoji: '🗿', lab: 'elucidator' },
  74: { nom: 'The Gleam Eyes', emoji: '😈' },
  75: { nom: 'The Skull Reaper', emoji: '💀' },
  100: { nom: 'Heathcliff', emoji: '🛡️' },
};

const TITRES_BOSS = ['Seigneur', 'Gardien', 'Colosse', 'Sentinelle', 'Tyran'];

function bossDe(etage) {
  const nomme = BOSS_NOMMES[etage];
  if (nomme) return { ...nomme, nomme: true };
  const t = TRANCHES[trancheDe(etage)];
  return { nom: `${TITRES_BOSS[etage % TITRES_BOSS.length]} ${t.theme} de l'étage ${etage}`, emoji: '👹', nomme: false };
}

// ── Sword Skills ────────────────────────────────────────────────────────
// mult × coups = dégâts totaux (en multiples de l'ATK). `recharge` : le
// délai post-motion du canon, compté en tours.
//   effet 'esquive'  : la riposte du tour est évitée (recharge 4, pas 3 :
//                      sinon elle tomberait pile sur chaque coup normal
//                      du cycle de 3 tours du boss)
//   effet 'etourdit' : le boss perd sa prochaine action
//   effet 'critique' : chaque coup est critique
const SKILLS = {
  slant: { nom: 'Slant', emoji: '🗡️', famille: 'epee', niveau: 1, mult: 1.5, coups: 1, recharge: 2 },
  sonic_leap: { nom: 'Sonic Leap', emoji: '🌪️', famille: 'epee', niveau: 8, mult: 1.9, coups: 1, recharge: 4, effet: 'esquive' },
  horizontal_square: { nom: 'Horizontal Square', emoji: '🔲', famille: 'epee', niveau: 20, mult: 0.65, coups: 4, recharge: 4 },
  vorpal_strike: { nom: 'Vorpal Strike', emoji: '💥', famille: 'epee', niveau: 35, mult: 3.2, coups: 1, recharge: 5, effet: 'etourdit' },
  howling_octave: { nom: 'Howling Octave', emoji: '🎶', famille: 'epee', niveau: 60, mult: 0.55, coups: 8, recharge: 6 },
  nova_ascension: { nom: 'Nova Ascension', emoji: '🌟', famille: 'epee', niveau: 85, mult: 0.55, coups: 10, recharge: 7, effet: 'etourdit' },
  // La rapière frappe vite et juste : mêmes dégâts totaux que l'épée au même
  // niveau, mais ses gros skills sont des critiques assurés.
  linear: { nom: 'Linear', emoji: '➖', famille: 'rapiere', niveau: 1, mult: 1.5, coups: 1, recharge: 2 },
  oblique: { nom: 'Oblique', emoji: '↗️', famille: 'rapiere', niveau: 8, mult: 1.9, coups: 1, recharge: 4, effet: 'esquive' },
  parallel_sting: { nom: 'Parallel Sting', emoji: '⏸️', famille: 'rapiere', niveau: 20, mult: 1.3, coups: 2, recharge: 4 },
  star_splash: { nom: 'Star Splash', emoji: '✨', famille: 'rapiere', niveau: 35, mult: 0.4, coups: 8, recharge: 5, effet: 'etourdit' },
  flashing_penetrator: { nom: 'Flashing Penetrator', emoji: '☄️', famille: 'rapiere', niveau: 60, mult: 2.75, coups: 1, recharge: 6, effet: 'critique' },
  crucifixion: { nom: 'Crucifixion', emoji: '✝️', famille: 'rapiere', niveau: 85, mult: 1.375, coups: 4, recharge: 7, effet: 'etourdit' },
  // Compétence unique : Dual Blades (Kirito, révélée contre The Gleam Eyes).
  double_circular: { nom: 'Double Circular', emoji: '🌀', famille: 'double', niveau: 1, mult: 1.2, coups: 2, recharge: 3 },
  starburst_stream: { nom: 'Starburst Stream', emoji: '🌠', famille: 'double', niveau: 1, mult: 0.35, coups: 16, recharge: 6 },
  the_eclipse: { nom: 'The Eclipse', emoji: '🌑', famille: 'double', niveau: 90, mult: 0.3, coups: 27, recharge: 8 },
};

// ── Compétences uniques : un seul détenteur par serveur ─────────────────
const UNIQUES = {
  dual_blades: {
    nom: 'Dual Blades', emoji: '⚔️', etage: 74,
    desc: 'Le premier du serveur à vaincre The Gleam Eyes manie deux épées : +10 % ATK et les skills Double Circular, Starburst Stream et The Eclipse.',
  },
};

// ── Objets ──────────────────────────────────────────────────────────────
// Contrat A : chaque entrée a au moins { nom, emoji, rarete, type, desc }.
// `prix` : prix de base chez Agil (multiplié par l'étage) ; `vente` : rachat.
const OBJETS = {
  // Consommables
  potion_soin: { nom: 'Potion de soin', emoji: '🧪', rarete: 'commun', type: 'consommable', desc: 'Rend 25 % des PV.', soin: 0.25, prix: 12, vente: 4 },
  cristal_soin: { nom: 'Cristal de soin', emoji: '💎', rarete: 'rare', type: 'consommable', desc: 'Rend 50 % des PV, instantanément. Inutile en salle anti-cristal.', soin: 0.5, cristal: true, prix: 30, vente: 10 },
  grand_cristal: { nom: 'Grand cristal de soin', emoji: '💠', rarete: 'epique', type: 'consommable', desc: 'Rend tous les PV. Inutile en salle anti-cristal.', soin: 1, cristal: true, prix: 90, vente: 30 },
  antidote: { nom: 'Antidote', emoji: '🧴', rarete: 'commun', type: 'consommable', desc: 'Guérit le poison d\'un boss.', antidote: true, prix: 8, vente: 3 },
  cristal_tp: { nom: 'Cristal de téléportation', emoji: '🌀', rarete: 'rare', type: 'consommable', desc: '« Téléportation ! » Fuir un boss sans aucune pénalité. Inutile en salle anti-cristal.', fuite: true, cristal: true, prix: 60, vente: 20 },
  pierre_ame: { nom: 'Divine Stone of Returning Soul', emoji: '✨', rarete: 'legendaire', type: 'consommable', desc: 'Se brise d\'elle-même à ta prochaine mort et l\'annule : aucune perte, PV rendus.', resurrection: true, vente: 500 },
  coffre_tresor: { nom: 'Coffre au trésor', emoji: '🎁', rarete: 'rare', type: 'consommable', desc: 'À ouvrir avec /sao utiliser : Col, matériaux et parfois mieux.', coffre: true, vente: 15 },

  // Matériaux (une tranche d'étages chacun)
  croc_loup: { nom: 'Croc de loup', emoji: '🦷', rarete: 'commun', type: 'materiau', desc: 'Matériau des étages 1 à 10.', tranche: 1, vente: 6 },
  corne_taurus: { nom: 'Corne de Taurus', emoji: '🐂', rarete: 'commun', type: 'materiau', desc: 'Matériau des étages 11 à 20.', tranche: 2, vente: 12 },
  ecorce_treant: { nom: 'Écorce de tréant', emoji: '🪵', rarete: 'commun', type: 'materiau', desc: 'Matériau des étages 21 à 30.', tranche: 3, vente: 18 },
  soie_araignee: { nom: 'Soie d\'araignée', emoji: '🕸️', rarete: 'commun', type: 'materiau', desc: 'Matériau des étages 31 à 40.', tranche: 4, vente: 25 },
  minerai_mithril: { nom: 'Minerai de mithril', emoji: '⛏️', rarete: 'rare', type: 'materiau', desc: 'Matériau des étages 41 à 50.', tranche: 5, vente: 32 },
  ecaille_wyverne: { nom: 'Écaille de wyverne', emoji: '🐲', rarete: 'rare', type: 'materiau', desc: 'Matériau des étages 51 à 60.', tranche: 6, vente: 40 },
  plume_griffon: { nom: 'Plume de griffon', emoji: '🪶', rarete: 'rare', type: 'materiau', desc: 'Matériau des étages 61 à 70.', tranche: 7, vente: 48 },
  os_faucheur: { nom: 'Os de faucheur', emoji: '🦴', rarete: 'epique', type: 'materiau', desc: 'Matériau des étages 71 à 80.', tranche: 8, vente: 56 },
  eclat_obsidienne: { nom: 'Éclat d\'obsidienne', emoji: '🌑', rarete: 'epique', type: 'materiau', desc: 'Matériau des étages 81 à 90.', tranche: 9, vente: 64 },
  fragment_rubis: { nom: 'Fragment de rubis', emoji: '💍', rarete: 'epique', type: 'materiau', desc: 'Matériau des étages 91 à 100.', tranche: 10, vente: 72 },
  lingot_cristallite: { nom: 'Crystallite Ingot', emoji: '🔷', rarete: 'epique', type: 'materiau', desc: 'Lingot du dragon blanc de l\'étage 55. Lisbeth en tire la Dark Repulser.', vente: 150 },

  // Butin : trophées de chasse, à revendre chez Agil
  defense_sanglier: { nom: 'Défense de sanglier', emoji: '🐗', rarete: 'commun', type: 'butin', desc: 'Trophée des étages 1 à 10.', tranche: 1, vente: 18 },
  hache_kobold: { nom: 'Hache de Kobold', emoji: '🪓', rarete: 'commun', type: 'butin', desc: 'Trophée des étages 11 à 20.', tranche: 2, vente: 45 },
  mousse_lumineuse: { nom: 'Mousse lumineuse', emoji: '🍄', rarete: 'commun', type: 'butin', desc: 'Trophée des étages 21 à 30.', tranche: 3, vente: 75 },
  banane_ape: { nom: 'Banane de Drunk Ape', emoji: '🍌', rarete: 'commun', type: 'butin', desc: 'Trophée des étages 31 à 40.', tranche: 4, vente: 105 },
  aiguillon_guepe: { nom: 'Aiguillon de guêpe', emoji: '🐝', rarete: 'commun', type: 'butin', desc: 'Trophée des étages 41 à 50.', tranche: 5, vente: 135 },
  dent_wyverne: { nom: 'Dent de wyverne', emoji: '🦷', rarete: 'rare', type: 'butin', desc: 'Trophée des étages 51 à 60.', tranche: 6, vente: 165 },
  venin_scorpion: { nom: 'Venin de scorpion', emoji: '🦂', rarete: 'rare', type: 'butin', desc: 'Trophée des étages 61 à 70.', tranche: 7, vente: 195 },
  ecaille_lizardman: { nom: 'Écaille de Lizardman', emoji: '🦎', rarete: 'rare', type: 'butin', desc: 'Trophée des étages 71 à 80.', tranche: 8, vente: 225 },
  coeur_chimere: { nom: 'Cœur de chimère', emoji: '❤️‍🔥', rarete: 'epique', type: 'butin', desc: 'Trophée des étages 81 à 90.', tranche: 9, vente: 255 },
  insigne_palais: { nom: 'Insigne du Ruby Palace', emoji: '🎖️', rarete: 'epique', type: 'butin', desc: 'Trophée des étages 91 à 100.', tranche: 10, vente: 285 },

  // Ingrédients (cuisine) et prises de pêche
  viande_sanglier: { nom: 'Viande de sanglier', emoji: '🥩', rarete: 'commun', type: 'ingredient', desc: 'Pour les brochettes.', vente: 5 },
  baies_floria: { nom: 'Baies de Floria', emoji: '🫐', rarete: 'commun', type: 'ingredient', desc: 'Pour les tartes.', vente: 5 },
  poisson_lac: { nom: 'Poisson du lac', emoji: '🐟', rarete: 'commun', type: 'ingredient', desc: 'Pêché à l\'étage 22.', vente: 12 },
  poisson_dore: { nom: 'Poisson doré', emoji: '🐠', rarete: 'rare', type: 'ingredient', desc: 'Prise rare du lac de l\'étage 22.', vente: 60 },
  ragout_rabbit: { nom: 'Viande de Ragout Rabbit', emoji: '🐇', rarete: 'legendaire', type: 'ingredient', desc: 'Ingrédient de classe S. De quoi faire le ragoût d\'Asuna.', vente: 400 },
  seigneur_lac: { nom: 'Seigneur du lac', emoji: '🐋', rarete: 'legendaire', type: 'ingredient', desc: 'Le poisson géant de Nishida. Un festin à lui seul.', vente: 600 },

  // Repas : un bonus pour un nombre de chasses (ATK et DEF valent aussi contre les boss)
  brochette: { nom: 'Brochette de sanglier', emoji: '🍢', rarete: 'commun', type: 'repas', desc: '+10 % ATK pendant 6 chasses.', bonus: { atk: 0.1 }, duree: 6, vente: 20 },
  soupe_poisson: { nom: 'Soupe de poisson', emoji: '🍲', rarete: 'rare', type: 'repas', desc: '+15 % DEF et +10 % XP pendant 8 chasses.', bonus: { def: 0.15, xp: 0.1 }, duree: 8, vente: 40 },
  tarte_baies: { nom: 'Tarte aux baies', emoji: '🥧', rarete: 'rare', type: 'repas', desc: '+20 % de Col pendant 10 chasses.', bonus: { col: 0.2 }, duree: 10, vente: 40 },
  ragout_asuna: { nom: 'Ragoût d\'Asuna', emoji: '🍛', rarete: 'legendaire', type: 'repas', desc: '+20 % ATK et +30 % XP pendant 15 chasses.', bonus: { atk: 0.2, xp: 0.3 }, duree: 15, vente: 500 },
  festin_lac: { nom: 'Festin du lac', emoji: '🍱', rarete: 'legendaire', type: 'repas', desc: '+25 % ATK, DEF et XP pendant 20 chasses.', bonus: { atk: 0.25, def: 0.25, xp: 0.25 }, duree: 20, vente: 700 },
};

// Armes : deux familles (épée à une main, rapière), un nom par palier.
const NOMS_EPEES = [
  ['epee_courte', 'Épée courte'], ['anneal_blade', 'Anneal Blade'], ['sword_of_eventide', 'Sword of Eventide'],
  ['queens_knightsword', 'Queen\'s Knightsword'], ['epee_mithril', 'Épée de mithril'], ['lame_damas', 'Lame d\'acier damassé'],
  ['lame_lindarth', 'Lame de Lindarth'], ['dark_repulser', 'Dark Repulser'], ['epee_runique', 'Épée runique'],
  ['lame_colisee', 'Lame du Colisée'], ['lame_rubis', 'Lame de rubis'],
];
const NOMS_RAPIERES = [
  ['rapiere_entrainement', 'Rapière d\'entraînement'], ['wind_fleuret', 'Wind Fleuret'], ['chivalric_rapier', 'Chivalric Rapier'],
  ['rapiere_rovia', 'Rapière de Rovia'], ['rapiere_mithril', 'Rapière de mithril'], ['fleuret_argent', 'Fleuret d\'argent'],
  ['lambent_light', 'Lambent Light'], ['rapiere_cristallite', 'Rapière de cristallite'], ['fleuret_runique', 'Fleuret runique'],
  ['rapiere_colisee', 'Rapière du Colisée'], ['rapiere_rubis', 'Rapière de rubis'],
];
const NOMS_ARMURES = [
  ['tunique_toile', 'Tunique de toile'], ['veste_cuir', 'Veste de cuir'], ['cotte_mailles', 'Cotte de mailles'],
  ['armure_kobold', 'Armure d\'écailles'], ['plastron_mithril', 'Plastron de mithril'], ['manteau_errances', 'Manteau des Errances'],
  ['armure_lindarth', 'Armure de Lindarth'], ['uniforme_kob', 'Uniforme des Chevaliers du Serment de Sang'], ['cuirasse_griffon', 'Cuirasse de griffon'],
  ['armure_colisee', 'Armure du Colisée'], ['armure_rubis', 'Armure de rubis'],
];

// Coût de forge d'un palier : Col (base, multipliée par le gain d'une chasse
// à cet étage dans formules.js) et matériaux de la tranche.
function recettePalier(palier, armure = false) {
  const etage = ETAGE_PALIER[palier];
  const mat = TRANCHES[trancheDe(etage)].materiau;
  const mats = palier === 0 ? {} : { [mat]: 3 + palier };
  if (palier === 7 && !armure) mats.lingot_cristallite = 1;
  return { etage, mats };
}

NOMS_EPEES.forEach(([cle, nom], palier) => {
  OBJETS[cle] = {
    nom, emoji: '🗡️', rarete: palier >= 9 ? 'epique' : palier >= 5 ? 'rare' : 'commun', type: 'arme', famille: 'epee',
    palier, atk: ATK_PALIER[palier], ...recettePalier(palier), desc: `Épée à une main, palier ${palier}. +${ATK_PALIER[palier]} ATK.`,
    vente: 10 + palier * 60,
  };
});
NOMS_RAPIERES.forEach(([cle, nom], palier) => {
  OBJETS[cle] = {
    nom, emoji: '🤺', rarete: palier >= 9 ? 'epique' : palier >= 5 ? 'rare' : 'commun', type: 'arme', famille: 'rapiere',
    palier, atk: ATK_PALIER[palier], ...recettePalier(palier), desc: `Rapière, palier ${palier}. +${ATK_PALIER[palier]} ATK.`,
    vente: 10 + palier * 60,
  };
});
NOMS_ARMURES.forEach(([cle, nom], palier) => {
  OBJETS[cle] = {
    nom, emoji: '🛡️', rarete: palier >= 9 ? 'epique' : palier >= 5 ? 'rare' : 'commun', type: 'armure',
    palier, def: DEF_PALIER[palier], pv: PV_PALIER[palier], ...recettePalier(palier, true),
    desc: `Armure, palier ${palier}. +${DEF_PALIER[palier]} DEF, +${PV_PALIER[palier]} PV.`,
    vente: 8 + palier * 50,
  };
});

// Objets du Last Attack Bonus : ni à vendre en boutique, ni à forger.
Object.assign(OBJETS, {
  coat_of_midnight: { nom: 'Coat of Midnight', emoji: '🧥', rarete: 'lab', type: 'armure', palier: 2, def: 16, pv: 55, lab: true, desc: 'LAB d\'Illfang (étage 1). Mieux qu\'une cotte de mailles.', vente: 300 },
  elucidator: { nom: 'Elucidator', emoji: '🗡️', rarete: 'lab', type: 'arme', famille: 'epee', palier: 7, atk: 190, lab: true, desc: 'LAB de l\'étage 50. L\'épée noire de Kirito : +190 ATK.', vente: 2000 },
  blackwyrm_coat: { nom: 'Blackwyrm Coat', emoji: '🧥', rarete: 'lab', type: 'armure', palier: 9, def: 120, pv: 430, lab: true, desc: 'LAB du raid The Fatal Scythe. +120 DEF, +430 PV.', vente: 2500 },
});

const ARMES_PAR_FAMILLE = {
  epee: NOMS_EPEES.map(([cle]) => cle),
  rapiere: NOMS_RAPIERES.map(([cle]) => cle),
};
const ARMURES = NOMS_ARMURES.map(([cle]) => cle);

// Ce qu'Agil vend : les consommables courants.
const BOUTIQUE = ['potion_soin', 'cristal_soin', 'grand_cristal', 'antidote', 'cristal_tp'];

// ── Cuisine ─────────────────────────────────────────────────────────────
const RECETTES = {
  brochette: { ingredients: { viande_sanglier: 3 }, plat: 'brochette' },
  soupe_poisson: { ingredients: { poisson_lac: 2 }, plat: 'soupe_poisson' },
  tarte_baies: { ingredients: { baies_floria: 2, viande_sanglier: 1 }, plat: 'tarte_baies' },
  ragout_asuna: { ingredients: { ragout_rabbit: 1 }, plat: 'ragout_asuna' },
  festin_lac: { ingredients: { seigneur_lac: 1, poisson_dore: 1 }, plat: 'festin_lac' },
};

// ── Pêche (étage 22, chez Nishida) ──────────────────────────────────────
// `fenetre` : temps de réaction maximal pour la prise (ms après la morsure).
const PRISES = [
  { objet: 'poisson_lac', poids: 70, fenetre: 3000 },
  { objet: 'poisson_dore', poids: 22, fenetre: 1500 },
  { objet: 'seigneur_lac', poids: 3, fenetre: 900 },
  { objet: 'coffre_tresor', poids: 5, fenetre: 2000 },
];
const ETAGE_PECHE = 22;

// ── Quêtes du jour ──────────────────────────────────────────────────────
// `cond` : condition d'accès (étage débloqué, réglage du serveur).
const QUETES = {
  tuer: { texte: 'Vaincre {n} monstres', emoji: '⚔️', objectifs: [10, 15, 20] },
  boss: { texte: 'Vaincre un boss d\'étage', emoji: '🐉', objectifs: [1] },
  forger: { texte: 'Forger ou améliorer chez Lisbeth', emoji: '🔨', objectifs: [1] },
  vendre: { texte: 'Vendre {n} objets à Agil', emoji: '💰', objectifs: [5, 8] },
  pecher: { texte: 'Pêcher {n} poissons à l\'étage 22', emoji: '🎣', objectifs: [2, 3], cond: 'peche' },
  cuisiner: { texte: 'Cuisiner un repas', emoji: '🍳', objectifs: [1] },
  skills: { texte: 'Lancer {n} Sword Skills', emoji: '🌀', objectifs: [4, 6] },
  raid: { texte: 'Frapper {n} fois le boss de raid', emoji: '🐲', objectifs: [2, 3], cond: 'raid' },
  duel: { texte: 'Gagner un duel', emoji: '🤺', objectifs: [1], cond: 'pvp' },
};

// ── Rumeurs d'Argo (une par jour et par serveur) ────────────────────────
const RUMEURS = {
  materiaux: { texte: 'les monstres de l\'étage {f} lâchent **deux fois plus de matériaux**' },
  col: { texte: 'on gagne **+25 % de Col** en chassant à l\'étage {f}' },
  xp: { texte: 'les monstres de l\'étage {f} rapportent **+25 % d\'XP**' },
  lapin: { texte: 'un **Ragout Rabbit** a été aperçu à l\'étage {f} (cinq fois plus fréquent)' },
  forge: { texte: 'Lisbeth est de bonne humeur : **+10 % de réussite** aux améliorations' },
  agil: { texte: 'Agil rachète le butin **20 % plus cher**' },
  peche: { texte: 'le lac de l\'étage 22 grouille de poissons : **prises rares doublées**' },
};

// ── Boss de raid (communs au serveur) ───────────────────────────────────
// `pv` : multiple de l'ATK de référence, par participant attendu.
const RAIDS = {
  fatal_scythe: {
    nom: 'The Fatal Scythe', emoji: '💀', etage: 1, pv: 40,
    desc: 'Le faucheur du donjon caché sous Town of Beginnings.',
    lab: 'blackwyrm_coat', labQte: 1,
  },
  nicholas: {
    nom: 'Nicholas the Renegade', emoji: '🎅', etage: 35, pv: 36,
    desc: 'Le boss d\'événement de la Forêt des Errances. Il garde la pierre qui ramène les morts.',
    lab: 'pierre_ame', labQte: 1,
  },
  dragon_blanc: {
    nom: 'Le Dragon blanc', emoji: '🐉', etage: 55, pv: 34,
    desc: 'Le gardien des montagnes de l\'étage 55, nourri de cristal.',
    lab: 'lingot_cristallite', labQte: 3,
  },
};

// ── Badges (titres équipables) ──────────────────────────────────────────
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
  forgeron: { emoji: '🔨', name: 'Maître Forgeron', desc: 'Porter une arme améliorée à +10' },
  riche: { emoji: '💰', name: 'Fortune', desc: 'Amasser 10 000 Col' },
  lab: { emoji: '🏆', name: 'Last Attack', desc: 'Remporter un Last Attack Bonus' },
  pecheur: { emoji: '🎣', name: 'Ami de Nishida', desc: 'Pêcher le Seigneur du lac' },
  cuisinier: { emoji: '🍛', name: 'Cordon-bleu', desc: 'Cuisiner le ragoût d\'Asuna' },
  raider: { emoji: '🐲', name: 'Raider', desc: 'Participer à la chute d\'un boss de raid' },
  duelliste: { emoji: '🤺', name: 'Duelliste', desc: 'Gagner 10 duels' },
  fidele: { emoji: '📅', name: 'Fidèle', desc: '7 jours de suite de récompense quotidienne' },
  epeiste_noir: { emoji: '⚔️', name: 'Black Swordsman', desc: 'Détenir la compétence unique Dual Blades' },
  revenant: { emoji: '🪦', name: 'Revenant', desc: 'Revenir 10 fois du Monument of Life' },
};

module.exports = {
  RARETES, ETAGE_PALIER, ATK_PALIER, DEF_PALIER, PV_PALIER, PALIER_MAX, TRANCHES, RENCONTRES_RARES, VILLES,
  BOSS_NOMMES, SKILLS, UNIQUES, OBJETS, ARMES_PAR_FAMILLE, ARMURES, BOUTIQUE, RECETTES, PRISES, ETAGE_PECHE,
  QUETES, RUMEURS, RAIDS, BADGES,
  trancheDe, villeDe, bossDe, salleAntiCristal,
};
