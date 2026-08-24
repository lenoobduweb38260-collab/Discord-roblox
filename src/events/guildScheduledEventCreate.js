const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

module.exports = {
  name: Events.GuildScheduledEventCreate,
  async execute(event) {
    if (!event.guild) return;
    const details = [`➜ **${event.name}**`];
    if (event.scheduledStartTimestamp) details.push(`➜ Début : <t:${Math.floor(event.scheduledStartTimestamp / 1000)}:f>`);
    if (event.channelId) details.push(`➜ Salon : <#${event.channelId}>`);
    else if (event.entityMetadata?.location) details.push(`➜ Lieu : ${event.entityMetadata.location}`);
    if (event.creatorId) details.push(`➜ Créé par : <@${event.creatorId}>`);
    await sendLog(event.guild, logEmbed('📆 Événement planifié créé', details.join('\n'), COLORS.SUCCESS));
  },
};
