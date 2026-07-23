const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { record } = require('../utils/snipe');

// Log des messages supprimés (contenu disponible si le message était en cache).
module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    if (!message.guild) return;
    if (message.author?.bot) return;

    // Sauvegarde en base (snipe) pour pouvoir les retrouver via /snipe.
    record({
      guildId: message.guild.id,
      channelId: message.channelId,
      authorId: message.author?.id,
      authorTag: message.author?.tag,
      kind: 'delete',
      content: message.content || null,
      attachments: message.attachments?.size
        ? JSON.stringify([...message.attachments.values()].map((a) => a.url))
        : null,
    });

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
