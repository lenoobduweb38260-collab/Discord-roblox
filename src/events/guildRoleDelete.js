const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');

module.exports = {
  name: Events.GuildRoleDelete,
  async execute(role) {
    const by = await auditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
    await sendLog(
      role.guild,
      logEmbed('🗑️ Rôle supprimé', `Rôle **${role.name}** (\`${role.id}\`) supprimé${by ? ` par ${by}` : ''}.`, COLORS.DANGER)
    );
  },
};
