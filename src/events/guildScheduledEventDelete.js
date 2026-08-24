const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

module.exports = {
  name: Events.GuildScheduledEventDelete,
  async execute(event) {
    if (!event.guild) return;
    await sendLog(
      event.guild,
      logEmbed('🗑️ Événement planifié supprimé', `➜ **${event.name}**`, COLORS.WARNING)
    );
  },
};
