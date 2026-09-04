const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { typeSalon } = require('../utils/journal');

module.exports = {
  name: Events.ChannelCreate,
  async execute(channel) {
    if (!channel.guild) return;
    const by = await auditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    const details = [
      `➜ Salon : <#${channel.id}> (**${channel.name}**)`,
      `➜ Type : ${typeSalon(channel.type)}`,
    ];
    if (channel.parentId) details.push(`➜ Catégorie : <#${channel.parentId}>`);
    await sendLog(
      channel.guild,
      logEmbed('🆕 Salon créé', `Un salon a été créé${by ? ` par ${by}` : ''} :\n${details.join('\n')}`, COLORS.SUCCESS)
    );
  },
};
