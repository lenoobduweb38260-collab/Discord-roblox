const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');

module.exports = {
  name: Events.GuildEmojiCreate,
  async execute(emoji) {
    const by = await auditExecutor(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
    await sendLog(
      emoji.guild,
      logEmbed('😀 Émoji ajouté', `➜ ${emoji} \`:${emoji.name}:\`${by ? `\n➜ Par : ${by}` : ''}`, COLORS.SUCCESS)
    );
  },
};
