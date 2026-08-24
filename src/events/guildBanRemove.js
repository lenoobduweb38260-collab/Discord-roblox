const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');

module.exports = {
  name: Events.GuildBanRemove,
  async execute(ban) {
    const by = await auditExecutor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    await sendLog(
      ban.guild,
      logEmbed(
        '🔓 Bannissement levé',
        `➜ Membre : **${ban.user.tag}** (<@${ban.user.id}>)${by ? `\n➜ Débanni par : ${by}` : ''}`,
        COLORS.SUCCESS
      )
    );
  },
};
