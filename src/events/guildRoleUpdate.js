const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { etiquetteRole, fiche } = require('../utils/journal');

module.exports = {
  name: Events.GuildRoleUpdate,
  async execute(oldRole, newRole) {
    const changes = [];
    if (oldRole.name !== newRole.name) changes.push(`Nom : **${oldRole.name}** → **${newRole.name}**`);
    if (oldRole.hexColor !== newRole.hexColor) changes.push(`Couleur : \`${oldRole.hexColor}\` → \`${newRole.hexColor}\``);
    if (oldRole.hoist !== newRole.hoist) changes.push(`Affiché séparément : ${newRole.hoist ? 'oui' : 'non'}`);
    if (oldRole.mentionable !== newRole.mentionable) changes.push(`Mentionnable : ${newRole.mentionable ? 'oui' : 'non'}`);
    const permissions = [];
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
      const added = newRole.permissions.toArray().filter((p) => !oldRole.permissions.has(p));
      const removed = oldRole.permissions.toArray().filter((p) => !newRole.permissions.has(p));
      if (added.length) permissions.push(`✅ ${added.join(', ')}`);
      if (removed.length) permissions.push(`⛔ ${removed.join(', ')}`);
    }
    if (!changes.length && !permissions.length) return;

    const by = await auditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    await sendLog(
      newRole.guild,
      logEmbed(
        '✏️ Rôle modifié',
        fiche({
          sujet: etiquetteRole(newRole.id, newRole),
          sections: [{ titre: 'Modifications', entrees: changes }, { titre: 'Permissions', entrees: permissions }],
          par: by,
        }),
        COLORS.INFO
      )
    );
  },
};
