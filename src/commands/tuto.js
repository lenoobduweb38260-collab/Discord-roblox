const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { mettreAJour } = require('../utils/reponse');
const T = require('../utils/tutoriel');

// 📖 /tuto — le guide des commandes ouvertes aux MEMBRES.
//
// Généré depuis les vraies définitions (voir utils/tutoriel.js) : aucune
// commande staff n'y figure, et il ne peut pas être en retard sur le bot.
// Réponse éphémère : consulter le guide ne doit pas remplir un salon.

module.exports = {
  grade: GRADES.EVERYONE,
  public: true,
  guildModule: null,

  data: new SlashCommandBuilder()
    .setName('tuto')
    .setDescription('Le guide des commandes ouvertes à tous les membres'),

  async execute(interaction) {
    return interaction.reply({ ...T.vue(interaction, { staff: false, page: 1 }), flags: MessageFlags.Ephemeral });
  },

  // ⏮️ / ⏭️ — la pagination du guide (customId « tutom:<page> »).
  async handleComposant(interaction) {
    const page = Number(interaction.customId.split(':')[1]) || 1;
    return mettreAJour(interaction, T.vue(interaction, { staff: false, page }));
  },
};
