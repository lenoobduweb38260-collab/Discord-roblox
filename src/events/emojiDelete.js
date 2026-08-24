const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');

module.exports = {
  name: Events.GuildEmojiDelete,
  async execute(emoji) {
    const by = await auditExecutor(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
    await sendLog(
      emoji.guild,
      logEmbed('🗑️ Émoji supprimé', `➜ \`:${emoji.name}:\` (\`${emoji.id}\`)${by ? `\n➜ Par : ${by}` : ''}`, COLORS.DANGER)
    );
  },
};
