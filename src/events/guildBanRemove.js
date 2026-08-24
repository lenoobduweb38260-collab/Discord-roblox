const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { etiquetteMembre } = require('../utils/journal');

module.exports = {
  name: Events.GuildBanRemove,
  async execute(ban) {
    const by = await auditExecutor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    await sendLog(
      ban.guild,
      logEmbed(
        '🔓 Bannissement levé',
        `➜ Membre : ${etiquetteMembre(ban.user)}${by ? `\n➜ Débanni par : ${by}` : ''}`,
        COLORS.SUCCESS
      )
    );
  },
};
