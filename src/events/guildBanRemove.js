const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { etiquetteMembre, fiche } = require('../utils/journal');

module.exports = {
  name: Events.GuildBanRemove,
  async execute(ban) {
    const by = await auditExecutor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    await sendLog(
      ban.guild,
      logEmbed('🔓 Bannissement levé', fiche({ sujet: etiquetteMembre(ban.user), par: by, verbe: 'Débanni par', emoji: '🔓' }), COLORS.SUCCESS)
    );
  },
};
