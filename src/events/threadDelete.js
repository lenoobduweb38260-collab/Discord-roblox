const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { fiche } = require('../utils/journal');

module.exports = {
  name: Events.ThreadDelete,
  async execute(thread) {
    if (!thread.guild) return;
    await sendLog(
      thread.guild,
      logEmbed(
        '🗑️ Fil supprimé',
        fiche({ sujet: `**#${thread.name}** (\`${thread.id}\`)`, sections: [{ entrees: [`Était dans : <#${thread.parentId}>`] }] }),
        COLORS.DANGER
      )
    );
  },
};
