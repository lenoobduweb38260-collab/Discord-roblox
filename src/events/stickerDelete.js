const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');

module.exports = {
  name: Events.GuildStickerDelete,
  async execute(sticker) {
    if (!sticker.guild) return;
    const by = await auditExecutor(sticker.guild, AuditLogEvent.StickerDelete, sticker.id);
    await sendLog(
      sticker.guild,
      logEmbed('🗑️ Sticker supprimé', `➜ **${sticker.name}** (\`${sticker.id}\`)${by ? `\n➜ Par : ${by}` : ''}`, COLORS.DANGER)
    );
  },
};
