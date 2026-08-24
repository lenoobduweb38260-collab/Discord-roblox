const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

module.exports = {
  name: Events.ThreadCreate,
  async execute(thread, newlyCreated) {
    if (!thread.guild || newlyCreated === false) return;
    const details = [
      `➜ Fil : <#${thread.id}> (**${thread.name}**)`,
      `➜ Dans : <#${thread.parentId}>`,
    ];
    if (thread.ownerId) details.push(`➜ Ouvert par : <@${thread.ownerId}>`);
    await sendLog(
      thread.guild,
      logEmbed('🧵 Fil créé', details.join('\n'), COLORS.SUCCESS)
    );
  },
};
