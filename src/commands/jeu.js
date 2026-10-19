const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { getGuildConfig } = require('../database');
const MOTEUR = require('../utils/jeux/moteur');
const T = require('../utils/jeux/tableaux');
const { THEMES_QUIZ } = require('../utils/jeux/quiz');

// 🎲 /jeu — des mini-jeux pour s'amuser à plusieurs.
//
// Module coupable (`jeux_enabled`, /config → 🎲 Mini-jeux), et chaque jeu se
// coupe aussi à l'unité. Les réponses sont publiques : on joue devant le
// salon. Tout l'état d'une partie vit en base (src/utils/jeux/parties.js) :
// les boutons survivent à un redémarrage du bot.

const DIFFICULTES = [
  { name: 'Facile', value: 'facile' },
  { name: 'Normal', value: 'normal' },
  { name: 'Difficile', value: 'difficile' },
];

const optionAdversaire = (o) => o.setName('adversaire').setDescription('Le membre à défier (vide : tu joues contre le bot)').setRequired(false);
const optionDifficulte = (o) => o.setName('difficulte').setDescription('Le niveau du bot si tu joues contre lui (défaut : normal)').setRequired(false).addChoices(...DIFFICULTES);

module.exports = {
  grade: GRADES.EVERYONE,
  public: true,
  guildModule: 'jeux', // activable dans /config → 🎲 Mini-jeux
  data: new SlashCommandBuilder()
    .setName('jeu')
    .setDescription('Des mini-jeux pour s\'amuser : morpion, quiz, pendu, blackjack… 🎲')
    .addSubcommand((s) => s.setName('morpion').setDescription('Un morpion contre un membre ou contre le bot ⭕')
      .addUserOption(optionAdversaire)
      .addStringOption(optionDifficulte))
    .addSubcommand((s) => s.setName('puissance4').setDescription('Un Puissance 4 contre un membre ou contre le bot 🔴')
      .addUserOption(optionAdversaire)
      .addStringOption(optionDifficulte))
    .addSubcommand((s) => s.setName('pfc').setDescription('Pierre-feuille-ciseaux en 3 points, choix secrets ✂️')
      .addUserOption(optionAdversaire))
    .addSubcommand((s) => s.setName('pendu').setDescription('Un pendu pour tout le salon 🪢'))
    .addSubcommand((s) => s.setName('nombre').setDescription('Trouver le nombre du bot : c\'est plus, c\'est moins 🔢')
      .addIntegerOption((o) => o.setName('max').setDescription('Le plus grand nombre possible (10 à 1000, défaut : 100)')
        .setRequired(false).setMinValue(10).setMaxValue(1000)))
    .addSubcommand((s) => s.setName('quiz').setDescription('Une question de culture générale : le plus rapide gagne 🧠')
      .addStringOption((o) => o.setName('theme').setDescription('Le thème de la question (défaut : au hasard)')
        .setRequired(false).addChoices(...THEMES_QUIZ.slice(0, 25).map((t) => ({ name: t, value: t })))))
    .addSubcommand((s) => s.setName('demineur').setDescription('Une grille de démineur en spoilers 💣')
      .addStringOption((o) => o.setName('taille').setDescription('La taille de la grille (défaut : moyenne)').setRequired(false)
        .addChoices({ name: 'Petite (5×5)', value: 'petit' }, { name: 'Moyenne (7×7)', value: 'moyen' }, { name: 'Grande (9×9)', value: 'grand' })))
    .addSubcommand((s) => s.setName('reflexe').setDescription('Le premier à cliquer sur le bouton vert gagne ⚡'))
    .addSubcommand((s) => s.setName('blackjack').setDescription('Un blackjack contre le croupier 🃏')
      .addIntegerOption((o) => o.setName('mise').setDescription('Une mise en Col SAO (facultative, si l\'Aventure SAO est active)')
        .setRequired(false).setMinValue(1).setMaxValue(1000000)))
    .addSubcommand((s) => s.setName('stats').setDescription('Les victoires et défaites d\'un membre aux mini-jeux 📊')
      .addUserOption((o) => o.setName('membre').setDescription('Quel membre ? (vide : toi)').setRequired(false)))
    .addSubcommand((s) => s.setName('classement').setDescription('Le classement des mini-jeux du serveur 🏆')
      .addStringOption((o) => o.setName('jeu').setDescription('Un jeu en particulier (vide : tous les jeux)').setRequired(false)
        .addChoices(...T.JEUX_CLASSES.map((j) => ({ name: j.nom, value: j.cle }))))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    // Le routeur central vérifie déjà le module ; on le redit ici pour un
    // appel direct (tests, autre routeur) — un module coupé reste coupé.
    if (!getGuildConfig(interaction.guildId).jeux_enabled) {
      return interaction.reply({
        content: '⛔ Les **mini-jeux** sont désactivés sur ce serveur.\n➜ Un staff peut les activer via `/config` → 🎲 Mini-jeux.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (sub === 'stats') {
      const qui = interaction.options.getUser('membre') || interaction.user;
      return interaction.reply(T.vueStatsJeux(interaction.guild, qui));
    }
    if (sub === 'classement') {
      return interaction.reply(T.vueClassementJeux(interaction.guild, interaction.options.getString('jeu') || 'tous', 1));
    }
    return MOTEUR.lancerJeu(interaction, sub);
  },

  // Boutons, menus et formulaires « jeu:… » (routés par interactionCreate).
  handleComposant(interaction) {
    return MOTEUR.gererComposantJeu(interaction);
  },
};
