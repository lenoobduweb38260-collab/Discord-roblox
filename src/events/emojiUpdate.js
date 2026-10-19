const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { fiche } = require('../utils/journal');

module.exports = {
  name: Events.GuildEmojiUpdate,
  async execute(oldEmoji, newEmoji) {
    if (oldEmoji.name === newEmoji.name) return;
    const by = await auditExecutor(newEmoji.guild, AuditLogEvent.EmojiUpdate, newEmoji.id);
    await sendLog(
      newEmoji.guild,
      logEmbed(
        '✏️ Émoji renommé',
        fiche({
          sujet: `${newEmoji} (\`${newEmoji.id}\`)`,
          sections: [{ titre: 'Nom', entrees: [`\`:${oldEmoji.name}:\` → \`:${newEmoji.name}:\``] }],
          par: by,
          verbe: 'Renommé par',
        }),
        COLORS.INFO
      )
    );
  },
};
