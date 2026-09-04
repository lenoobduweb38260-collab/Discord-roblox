const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { diffFil } = require('../utils/journal');

module.exports = {
  name: Events.ThreadUpdate,
  async execute(oldThread, newThread) {
    if (!newThread.guild) return;
    const changes = diffFil(oldThread, newThread);
    if (!changes.length) return;
    await sendLog(
      newThread.guild,
      logEmbed('✏️ Fil modifié', `Fil <#${newThread.id}> modifié :\n${changes.join('\n')}`.slice(0, 4000), COLORS.INFO)
    );
  },
};
