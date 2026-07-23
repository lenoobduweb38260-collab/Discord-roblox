const { SlashCommandBuilder } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const composer = require('../utils/embedComposer');

// /embed : composer un message/embed avec APERÇU EN DIRECT, puis l'envoyer
// dans le salon choisi. Le message affiché pendant l'édition est exactement
// celui qui sera publié.
module.exports = {
  grade: GRADES.STAFF,
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('[Staff] Composer un embed/message avec aperçu en direct, puis l\'envoyer'),
  async execute(interaction) {
    return composer.start(interaction, { channelId: interaction.channelId });
  },
};
