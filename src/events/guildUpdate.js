const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { diffGuilde, fiche } = require('../utils/journal');

// Nom, description, icône, bannière, propriétaire, niveau de vérification,
// salons système, palier de boost : le serveur lui-même.
module.exports = {
  name: Events.GuildUpdate,
  async execute(oldGuild, newGuild) {
    const changes = diffGuilde(oldGuild, newGuild);
    if (!changes.length) return;
    const by = await auditExecutor(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);
    await sendLog(
      newGuild,
      logEmbed(
        '🏰 Serveur modifié',
        fiche({ sujet: `**${newGuild.name}** (\`${newGuild.id}\`)`, sections: [{ titre: 'Modifications', entrees: changes }], par: by }),
        COLORS.INFO
      )
    );
  },
};
