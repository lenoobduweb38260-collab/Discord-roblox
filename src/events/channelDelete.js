const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { typeSalon, fiche } = require('../utils/journal');

// Un salon supprimé n'a plus de mention cliquable : son nom et son ID
// suffisent à le retrouver dans le journal d'audit.
module.exports = {
  name: Events.ChannelDelete,
  async execute(channel) {
    if (!channel.guild) return;
    const by = await auditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    const details = [`Type : ${typeSalon(channel.type)}`];
    if (channel.parentId) details.push(`Catégorie : <#${channel.parentId}>`);
    await sendLog(
      channel.guild,
      logEmbed(
        '🗑️ Salon supprimé',
        fiche({ sujet: `**#${channel.name}** (\`${channel.id}\`)`, sections: [{ entrees: details }], par: by, verbe: 'Supprimé par' }),
        COLORS.DANGER
      )
    );
  },
};
