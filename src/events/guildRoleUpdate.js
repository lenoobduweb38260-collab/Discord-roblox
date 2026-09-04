const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');

module.exports = {
  name: Events.GuildRoleUpdate,
  async execute(oldRole, newRole) {
    const changes = [];
    if (oldRole.name !== newRole.name) changes.push(`➜ Nom : **${oldRole.name}** → **${newRole.name}**`);
    if (oldRole.hexColor !== newRole.hexColor) changes.push(`➜ Couleur : \`${oldRole.hexColor}\` → \`${newRole.hexColor}\``);
    if (oldRole.hoist !== newRole.hoist) changes.push(`➜ Affiché séparément : ${newRole.hoist ? 'oui' : 'non'}`);
    if (oldRole.mentionable !== newRole.mentionable) changes.push(`➜ Mentionnable : ${newRole.mentionable ? 'oui' : 'non'}`);
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
      const added = newRole.permissions.toArray().filter((p) => !oldRole.permissions.has(p));
      const removed = oldRole.permissions.toArray().filter((p) => !newRole.permissions.has(p));
      if (added.length) changes.push(`➜ Permissions ajoutées : ${added.join(', ')}`);
      if (removed.length) changes.push(`➜ Permissions retirées : ${removed.join(', ')}`);
    }
    if (!changes.length) return;

    const by = await auditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    await sendLog(
      newRole.guild,
      logEmbed(
        '✏️ Rôle modifié',
        `Rôle <@&${newRole.id}> modifié${by ? ` par ${by}` : ''} :\n${changes.join('\n')}`.slice(0, 4000),
        COLORS.INFO
      )
    );
  },
};
