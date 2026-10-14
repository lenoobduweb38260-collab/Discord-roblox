const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { sectionsMembre, etiquetteMembre, fiche } = require('../utils/journal');

// Surnom, rôles, exclusion temporaire, boost, avatar de serveur : chaque
// changement d'un membre laisse une trace — en fiche : le membre, puis une
// section par sujet (un rôle par ligne), puis qui a fait le geste.
module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    if (newMember.user?.bot) return;
    const sections = sectionsMembre(oldMember, newMember);
    if (!sections.length) return;
    const rolesOntChange = sections.some((s) => s.titre.startsWith('Rôles'));
    const by = await auditExecutor(
      newMember.guild,
      rolesOntChange ? AuditLogEvent.MemberRoleUpdate : AuditLogEvent.MemberUpdate,
      newMember.id
    );
    await sendLog(
      newMember.guild,
      logEmbed('👤 Membre modifié', fiche({ sujet: etiquetteMembre(newMember), sections, par: by }), COLORS.INFO)
    );
  },
};
