const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

// Un webhook créé, modifié ou supprimé : c'est une porte d'écriture sur le
// serveur, chaque mouvement mérite sa ligne.
module.exports = {
  name: Events.WebhooksUpdate,
  async execute(channel) {
    if (!channel.guild) return;
    await sendLog(
      channel.guild,
      logEmbed('🪝 Webhooks modifiés', `Un webhook a été créé, modifié ou supprimé sur <#${channel.id}>.`, COLORS.WARNING)
    );
  },
};
