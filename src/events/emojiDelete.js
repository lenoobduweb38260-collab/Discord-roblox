const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { fiche } = require('../utils/journal');

module.exports = {
  name: Events.GuildEmojiDelete,
  async execute(emoji) {
    const by = await auditExecutor(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
    await sendLog(
      emoji.guild,
      logEmbed('🗑️ Émoji supprimé', fiche({ sujet: `\`:${emoji.name}:\` (\`${emoji.id}\`)`, par: by, verbe: 'Supprimé par' }), COLORS.DANGER)
    );
  },
};
