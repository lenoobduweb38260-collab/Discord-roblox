const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { diffGuilde } = require('../utils/journal');

module.exports = {
  name: Events.GuildUpdate,
  async execute(oldGuild, newGuild) {
    const changes = diffGuilde(oldGuild, newGuild);
    if (!changes.length) return;
    const by = await auditExecutor(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);
    await sendLog(
      newGuild,
      logEmbed('🏰 Serveur modifié', `Le serveur a été modifié${by ? ` par ${by}` : ''} :\n${changes.join('\n')}`.slice(0, 4000), COLORS.INFO)
    );
  },
};
