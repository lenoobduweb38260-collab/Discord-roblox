const { getGuildConfig } = require('../database');

// 🎮 Le Module RP parle la langue du jeu du serveur.
//
// Le bot est né sur Roblox : « carte d'identité », « permis de conduire »,
// « entreprise ». Ces mots sont justes là-bas et faux ailleurs. Sur un serveur
// Arma, on ne délivre pas une carte d'identité à un soldat — on lui ouvre un
// livret matricule ; sur Red Dead, une « entreprise » est un ranch ou un gang,
// et le permis de conduire n'existe pas.
//
// Traduire ce vocabulaire n'est pas de la décoration : un joueur qui lit
// « permis de conduire » sur un serveur Arma comprend que le bot n'a pas été
// pensé pour lui. C'est le seul endroit où ces mots sont écrits.
//
// ⚠️ Le thème ne change QUE les mots et les emojis. Les données restent les
// mêmes — un serveur qui change de jeu ne perd aucune fiche, et peut revenir
// en arrière. C'est aussi pourquoi les noms de colonnes ne bougent pas.

const ROBLOX = {
  cle: 'roblox',
  label: 'Roblox RP',
  emoji: '🟥',
  univers: 'Roblox',
  // Le compte du jeu, tel qu'on le demande sur la fiche.
  compte: { label: 'Pseudo Roblox', emoji: '🎮' },
  carte: {
    titre: 'Carte d\'identité',
    emoji: '🪪',
    lieu: 'Lieu de naissance',
    nationalite: 'Nationalité',
    histoire: 'Background',
    pied: (date) => `Carte créée le ${date}`,
    numero: 'ID de la carte',
  },
  permis: {
    titre: 'Permis de conduire',
    emoji: '🚗',
    numero: 'Numéro',
    points: 'Points',
    titulaire: 'Titulaire',
    delivre: 'Délivré le',
    pied: 'Permis délivré par les services de l\'État RP',
    unite: 'points',
  },
  entreprise: { titre: 'Entreprise', emoji: '🏢', direction: 'Direction', membres: 'Employés', patron: 'patron', membre: 'employé' },
};

// Chaque thème n'écrit que ce qui CHANGE : le reste vient de Roblox. Recopier
// les vingt libellés dans cinq thèmes garantirait qu'un ajout soit oublié
// quelque part.
const THEMES = {
  roblox: ROBLOX,

  fivem: {
    cle: 'fivem',
    label: 'FiveM (GTA V)',
    emoji: '🌴',
    univers: 'Los Santos',
    compte: { label: 'Pseudo en jeu', emoji: '🎮' },
    carte: {
      titre: 'Carte de résident',
      emoji: '🪪',
      lieu: 'Ville de naissance',
      nationalite: 'Nationalité',
      histoire: 'Parcours',
      pied: (date) => `Délivrée par la Mairie de Los Santos le ${date}`,
      numero: 'N° de résident',
    },
    permis: {
      titre: 'Permis de conduire',
      emoji: '🚗',
      numero: 'N° de permis',
      points: 'Points',
      titulaire: 'Titulaire',
      delivre: 'Délivré le',
      pied: 'Département des véhicules à moteur — San Andreas',
      unite: 'points',
    },
    entreprise: { titre: 'Société', emoji: '🏢', direction: 'Direction', membres: 'Employés', patron: 'patron', membre: 'employé' },
  },

  gmod: {
    cle: 'gmod',
    label: "Garry's Mod (DarkRP)",
    emoji: '🔧',
    univers: 'DarkRP',
    compte: { label: 'Pseudo Steam', emoji: '🎮' },
    carte: {
      titre: 'Fiche citoyenne',
      emoji: '🗂️',
      lieu: 'Secteur d\'origine',
      nationalite: 'Statut civil',
      histoire: 'Antécédents',
      pied: (date) => `Fiche ouverte le ${date} — Administration municipale`,
      numero: 'N° de citoyen',
    },
    permis: {
      titre: 'Licence de port d\'arme',
      emoji: '🔫',
      numero: 'N° de licence',
      // Sur DarkRP, la licence se retire d'un coup : les « points » du permis
      // de conduire deviennent des avertissements avant révocation.
      points: 'Avertissements restants',
      titulaire: 'Détenteur',
      delivre: 'Délivrée le',
      pied: 'Délivrée par le Maire — révocable à tout moment',
      unite: 'avertissements',
    },
    entreprise: { titre: 'Organisation', emoji: '🏭', direction: 'Direction', membres: 'Membres', patron: 'chef', membre: 'membre' },
  },

  rdr2: {
    cle: 'rdr2',
    label: 'Red Dead Redemption RP',
    emoji: '🤠',
    univers: 'Far West',
    compte: { label: 'Nom de hors-la-loi', emoji: '🐎' },
    carte: {
      titre: 'Registre de citoyen',
      emoji: '📜',
      lieu: 'Comté de naissance',
      nationalite: 'Origine',
      histoire: 'Réputation',
      pied: (date) => `Inscrit au registre du comté le ${date}`,
      numero: 'N° au registre',
    },
    permis: {
      // Pas d'automobile en 1899 : le permis devient l'autorisation de porter
      // une arme, délivrée par le shérif.
      titre: 'Autorisation de port d\'arme',
      emoji: '🔫',
      numero: 'N° d\'autorisation',
      points: 'Avertissements restants',
      titulaire: 'Détenteur',
      delivre: 'Délivrée le',
      pied: 'Bureau du shérif — valable dans le comté',
      unite: 'avertissements',
    },
    entreprise: { titre: 'Ranch / Gang', emoji: '🐎', direction: 'Chefs', membres: 'Hommes de main', patron: 'chef', membre: 'membre' },
  },

  arma: {
    cle: 'arma',
    label: 'Arma (militaire)',
    emoji: '🎖️',
    univers: 'Théâtre d\'opérations',
    compte: { label: 'Indicatif radio', emoji: '📡' },
    carte: {
      // ⚠️ Le point demandé explicitement : sur un serveur militaire, la
      // carte d'identité n'a pas de sens — c'est un livret matricule.
      titre: 'Livret matricule',
      emoji: '🎖️',
      lieu: 'Unité de rattachement',
      nationalite: 'Nation',
      histoire: 'États de service',
      pied: (date) => `Incorporé le ${date} — État-major`,
      numero: 'Matricule',
    },
    permis: {
      titre: 'Habilitation opérationnelle',
      emoji: '🎯',
      numero: 'N° d\'habilitation',
      points: 'Sanctions restantes',
      titulaire: 'Militaire',
      delivre: 'Délivrée le',
      pied: 'État-major — révocable par le commandement',
      unite: 'sanctions',
    },
    entreprise: { titre: 'Unité', emoji: '🎖️', direction: 'Commandement', membres: 'Effectifs', patron: 'commandant', membre: 'soldat' },
  },
};

const CLES = Object.keys(THEMES);

// Fusion peu profonde sur ROBLOX : un thème n'écrit que ses différences.
function fusionner(theme) {
  if (theme.cle === 'roblox') return ROBLOX;
  const out = { ...ROBLOX, ...theme };
  for (const bloc of ['compte', 'carte', 'permis', 'entreprise']) {
    out[bloc] = { ...ROBLOX[bloc], ...(theme[bloc] || {}) };
  }
  return out;
}

const CACHE = new Map(CLES.map((k) => [k, fusionner(THEMES[k])]));

// Le thème d'un serveur. Roblox par défaut : c'est le jeu d'origine du bot,
// et un serveur qui n'a rien choisi ne doit rien voir changer.
function themeDe(guildId) {
  let cle = 'roblox';
  try {
    cle = String(getGuildConfig(guildId)?.rp_jeu || 'roblox').toLowerCase();
  } catch {
    cle = 'roblox';
  }
  return CACHE.get(cle) || CACHE.get('roblox');
}

// Variante sans base, pour le tableau de bord et les tests.
const themeParCle = (cle) => CACHE.get(String(cle || '').toLowerCase()) || CACHE.get('roblox');

const listeThemes = () => CLES.map((k) => ({ cle: k, label: CACHE.get(k).label, emoji: CACHE.get(k).emoji }));

module.exports = { themeDe, themeParCle, listeThemes, CLES, THEMES: CACHE };
