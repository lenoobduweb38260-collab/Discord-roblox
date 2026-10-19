const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { mettreAJour } = require('../utils/reponse');
const T = require('../utils/tutoriel');

// 📖 /tutos — le guide COMPLET, pour le staff.
//
// Toutes les commandes du bot (membres comprises), chacune avec son badge :
// 👮 staff, 🛡️ admin, rien = ouverte à tous. Les commandes du créateur du
// bot n'y figurent pas — elles ne concernent aucun serveur en particulier.
// Généré depuis les vraies définitions (voir utils/tutoriel.js).

module.exports = {
  grade: GRADES.STAFF,
  public: true,
  guildModule: null,

  data: new SlashCommandBuilder()
    .setName('tutos')
    .setDescription('Le guide complet des commandes pour le staff (commandes staff incluses)'),

  async execute(interaction) {
    return interaction.reply({ ...T.vue(interaction, { staff: true, page: 1 }), flags: MessageFlags.Ephemeral });
  },

  // ⏮️ / ⏭️ — la pagination du guide (customId « tutost:<page> »).
  async handleComposant(interaction) {
    const page = Number(interaction.customId.split(':')[1]) || 1;
    return mettreAJour(interaction, T.vue(interaction, { staff: true, page }));
  },
};
