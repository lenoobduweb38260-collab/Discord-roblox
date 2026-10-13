const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { diffFil, etiquetteSalon, fiche } = require('../utils/journal');

module.exports = {
  name: Events.ThreadUpdate,
  async execute(oldThread, newThread) {
    if (!newThread.guild) return;
    const changes = diffFil(oldThread, newThread);
    if (!changes.length) return;
    await sendLog(
      newThread.guild,
      logEmbed(
        '✏️ Fil modifié',
        fiche({ sujet: etiquetteSalon(newThread.id, newThread), sections: [{ titre: 'Modifications', entrees: changes }] }),
        COLORS.INFO
      )
    );
  },
};
