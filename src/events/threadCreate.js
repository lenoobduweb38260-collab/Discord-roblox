const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { mentionAvecId, etiquetteSalon, fiche } = require('../utils/journal');

module.exports = {
  name: Events.ThreadCreate,
  async execute(thread, newlyCreated) {
    if (!thread.guild || newlyCreated === false) return;
    await sendLog(
      thread.guild,
      logEmbed(
        '🧵 Fil créé',
        fiche({
          sujet: etiquetteSalon(thread.id, thread),
          sections: [{ entrees: [`Dans : <#${thread.parentId}>`] }],
          par: thread.ownerId ? mentionAvecId(thread.ownerId) : null,
          verbe: 'Ouvert par',
        }),
        COLORS.SUCCESS
      )
    );
  },
};
