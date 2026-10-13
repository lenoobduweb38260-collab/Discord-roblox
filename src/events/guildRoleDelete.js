const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { fiche } = require('../utils/journal');

module.exports = {
  name: Events.GuildRoleDelete,
  async execute(role) {
    const by = await auditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
    await sendLog(
      role.guild,
      logEmbed('🗑️ Rôle supprimé', fiche({ sujet: `**${role.name}** (\`${role.id}\`)`, par: by, verbe: 'Supprimé par' }), COLORS.DANGER)
    );
  },
};
