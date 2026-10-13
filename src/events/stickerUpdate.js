const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { fiche } = require('../utils/journal');

module.exports = {
  name: Events.GuildStickerUpdate,
  async execute(oldSticker, newSticker) {
    if (!newSticker.guild) return;
    const changes = [];
    if (oldSticker.name !== newSticker.name) changes.push(`Nom : **${oldSticker.name}** → **${newSticker.name}**`);
    if ((oldSticker.description ?? null) !== (newSticker.description ?? null)) changes.push('Description modifiée');
    if (!changes.length) return;
    const by = await auditExecutor(newSticker.guild, AuditLogEvent.StickerUpdate, newSticker.id);
    await sendLog(
      newSticker.guild,
      logEmbed(
        '✏️ Sticker modifié',
        fiche({ sujet: `**${newSticker.name}** (\`${newSticker.id}\`)`, sections: [{ titre: 'Modifications', entrees: changes }], par: by }),
        COLORS.INFO
      )
    );
  },
};
