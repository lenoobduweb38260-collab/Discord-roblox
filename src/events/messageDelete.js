const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

// Log des messages supprimés (contenu disponible si le message était en cache).
module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    if (!message.guild) return;
    if (message.author?.bot) return;

    const author = message.author ? `<@${message.author.id}> (\`${message.author.id}\`)` : '*Auteur inconnu*';
    let content = message.content || '*Contenu indisponible (message non mis en cache)*';
    if (content.length > 1000) content = `${content.slice(0, 1000)}…`;
    const attachments = message.attachments?.size
      ? `\n**Pièces jointes :** ${[...message.attachments.values()].map((a) => a.name).join(', ')}`
      : '';

    await sendLog(
      message.guild,
      logEmbed(
        '🗑️ Message supprimé',
        `**Auteur :** ${author}\n**Salon :** <#${message.channelId}>\n**Contenu :**\n>>> ${content}${attachments}`,
        COLORS.DANGER
      )
    );
  },
};
