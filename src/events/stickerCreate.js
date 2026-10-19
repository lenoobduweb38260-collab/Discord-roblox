const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { fiche } = require('../utils/journal');

module.exports = {
  name: Events.GuildStickerCreate,
  async execute(sticker) {
    if (!sticker.guild) return;
    const by = await auditExecutor(sticker.guild, AuditLogEvent.StickerCreate, sticker.id);
    await sendLog(
      sticker.guild,
      logEmbed(
        '🏷️ Sticker ajouté',
        fiche({
          sujet: `**${sticker.name}** (\`${sticker.id}\`)`,
          sections: [{ entrees: sticker.description ? [`Description : ${sticker.description}`] : [] }],
          par: by,
          verbe: 'Ajouté par',
        }),
        COLORS.SUCCESS
      )
    );
  },
};
