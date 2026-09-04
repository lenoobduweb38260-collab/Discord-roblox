const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { diffEvenement } = require('../utils/journal');

module.exports = {
  name: Events.GuildScheduledEventUpdate,
  async execute(oldEvent, newEvent) {
    if (!newEvent.guild) return;
    const changes = diffEvenement(oldEvent, newEvent);
    if (!changes.length) return;
    await sendLog(
      newEvent.guild,
      logEmbed('📆 Événement planifié modifié', `**${newEvent.name}** :\n${changes.join('\n')}`.slice(0, 4000), COLORS.INFO)
    );
  },
};
