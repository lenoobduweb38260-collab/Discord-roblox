const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');

module.exports = {
  name: Events.GuildEmojiUpdate,
  async execute(oldEmoji, newEmoji) {
    if (oldEmoji.name === newEmoji.name) return;
    const by = await auditExecutor(newEmoji.guild, AuditLogEvent.EmojiUpdate, newEmoji.id);
    await sendLog(
      newEmoji.guild,
      logEmbed('✏️ Émoji renommé', `➜ ${newEmoji} \`:${oldEmoji.name}:\` → \`:${newEmoji.name}:\`${by ? `\n➜ Par : ${by}` : ''}`, COLORS.INFO)
    );
  },
};
