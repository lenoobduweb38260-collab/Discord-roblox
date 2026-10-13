const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { diffEvenement, fiche } = require('../utils/journal');

module.exports = {
  name: Events.GuildScheduledEventUpdate,
  async execute(oldEvent, newEvent) {
    if (!newEvent.guild) return;
    const changes = diffEvenement(oldEvent, newEvent);
    if (!changes.length) return;
    await sendLog(
      newEvent.guild,
      logEmbed(
        '📆 Événement planifié modifié',
        fiche({ sujet: `**${newEvent.name}** (\`${newEvent.id}\`)`, sections: [{ titre: 'Modifications', entrees: changes }] }),
        COLORS.INFO
      )
    );
  },
};
