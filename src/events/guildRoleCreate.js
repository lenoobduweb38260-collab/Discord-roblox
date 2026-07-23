const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');

module.exports = {
  name: Events.GuildRoleCreate,
  async execute(role) {
    const by = await auditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
    await sendLog(
      role.guild,
      logEmbed('➕ Rôle créé', `Rôle **${role.name}** (<@&${role.id}>) créé${by ? ` par ${by}` : ''}.`, COLORS.SUCCESS)
    );
  },
};
