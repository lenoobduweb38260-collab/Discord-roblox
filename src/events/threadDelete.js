const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

module.exports = {
  name: Events.ThreadDelete,
  async execute(thread) {
    if (!thread.guild) return;
    await sendLog(
      thread.guild,
      logEmbed(
        '🗑️ Fil supprimé',
        `➜ Fil : **${thread.name}** (\`${thread.id}\`)\n➜ Était dans : <#${thread.parentId}>`,
        COLORS.DANGER
      )
    );
  },
};
