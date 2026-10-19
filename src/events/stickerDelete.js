const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { fiche } = require('../utils/journal');

module.exports = {
  name: Events.GuildStickerDelete,
  async execute(sticker) {
    if (!sticker.guild) return;
    const by = await auditExecutor(sticker.guild, AuditLogEvent.StickerDelete, sticker.id);
    await sendLog(
      sticker.guild,
      logEmbed('🗑️ Sticker supprimé', fiche({ sujet: `**${sticker.name}** (\`${sticker.id}\`)`, par: by, verbe: 'Supprimé par' }), COLORS.DANGER)
    );
  },
};
