const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');

module.exports = {
  name: Events.GuildStickerCreate,
  async execute(sticker) {
    if (!sticker.guild) return;
    const by = await auditExecutor(sticker.guild, AuditLogEvent.StickerCreate, sticker.id);
    await sendLog(
      sticker.guild,
      logEmbed('🏷️ Sticker ajouté', `➜ **${sticker.name}**${sticker.description ? ` — ${sticker.description}` : ''}${by ? `\n➜ Par : ${by}` : ''}`, COLORS.SUCCESS)
    );
  },
};
