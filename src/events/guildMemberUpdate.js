const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { diffMembre } = require('../utils/journal');

// Surnom, rôles, exclusion temporaire, boost, avatar de serveur : chaque
// changement d'un membre laisse une trace.
module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    if (newMember.user?.bot) return;
    const changes = diffMembre(oldMember, newMember);
    if (!changes.length) return;
    const rolesOntChange = changes.some((c) => c.includes('Rôles'));
    const by = await auditExecutor(
      newMember.guild,
      rolesOntChange ? AuditLogEvent.MemberRoleUpdate : AuditLogEvent.MemberUpdate,
      newMember.id
    );
    await sendLog(
      newMember.guild,
      logEmbed(
        '👤 Membre modifié',
        `<@${newMember.id}> a été modifié${by ? ` par ${by}` : ''} :\n${changes.join('\n')}`.slice(0, 4000),
        COLORS.INFO
      )
    );
  },
};
