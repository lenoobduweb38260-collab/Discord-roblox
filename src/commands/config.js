const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { mainView } = require('../utils/configPanel');

module.exports = {
  grade: GRADES.STAFF,
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('[Staff] Panneau central de configuration : rôles, salons, XP, whitelist métiers'),
  async execute(interaction) {
    await interaction.reply({ ...mainView(interaction.guild), flags: MessageFlags.Ephemeral });
  },
};
