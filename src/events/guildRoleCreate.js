const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { etiquetteRole, fiche } = require('../utils/journal');

module.exports = {
  name: Events.GuildRoleCreate,
  async execute(role) {
    const by = await auditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
    await sendLog(
      role.guild,
      logEmbed('➕ Rôle créé', fiche({ sujet: etiquetteRole(role.id, role), par: by, verbe: 'Créé par' }), COLORS.SUCCESS)
    );
  },
};
