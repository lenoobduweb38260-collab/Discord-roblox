const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { typeSalon } = require('../utils/journal');

module.exports = {
  name: Events.ChannelDelete,
  async execute(channel) {
    if (!channel.guild) return;
    const by = await auditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    const details = [
      `➜ Salon : **${channel.name}** (\`${channel.id}\`)`,
      `➜ Type : ${typeSalon(channel.type)}`,
    ];
    if (channel.parentId) details.push(`➜ Catégorie : <#${channel.parentId}>`);
    await sendLog(
      channel.guild,
      logEmbed('🗑️ Salon supprimé', `Un salon a été supprimé${by ? ` par ${by}` : ''} :\n${details.join('\n')}`, COLORS.DANGER)
    );
  },
};
