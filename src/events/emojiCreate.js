const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { fiche } = require('../utils/journal');

module.exports = {
  name: Events.GuildEmojiCreate,
  async execute(emoji) {
    const by = await auditExecutor(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
    await sendLog(
      emoji.guild,
      logEmbed('😀 Émoji ajouté', fiche({ sujet: `${emoji} \`:${emoji.name}:\` (\`${emoji.id}\`)`, par: by, verbe: 'Ajouté par' }), COLORS.SUCCESS)
    );
  },
};
