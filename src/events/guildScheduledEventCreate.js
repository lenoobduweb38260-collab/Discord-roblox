const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { etiquetteMembre, mentionAvecId } = require('../utils/journal');

module.exports = {
  name: Events.GuildScheduledEventCreate,
  async execute(event) {
    if (!event.guild) return;
    const details = [`➜ **${event.name}**`];
    if (event.scheduledStartTimestamp) details.push(`➜ Début : <t:${Math.floor(event.scheduledStartTimestamp / 1000)}:f>`);
    if (event.channelId) details.push(`➜ Salon : <#${event.channelId}>`);
    else if (event.entityMetadata?.location) details.push(`➜ Lieu : ${event.entityMetadata.location}`);
    if (event.creator) details.push(`➜ Créé par : ${etiquetteMembre(event.creator)}`);
    else if (event.creatorId) details.push(`➜ Créé par : ${mentionAvecId(event.creatorId)}`);
    await sendLog(event.guild, logEmbed('📆 Événement planifié créé', details.join('\n'), COLORS.SUCCESS));
  },
};
