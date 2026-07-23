const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { record } = require('../utils/snipe');

const trim = (text) => (text && text.length > 700 ? `${text.slice(0, 700)}…` : text);

// Log des messages modifiés (avant/après si le message était en cache).
module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    if (newMessage.partial) {
      newMessage = await newMessage.fetch().catch(() => null);
      if (!newMessage) return;
    }
    if (!newMessage.guild || !newMessage.author || newMessage.author.bot) return;
    // Ignore les « modifications » sans changement de texte (ex : aperçu de lien ajouté).
    if (oldMessage.content === newMessage.content) return;

    record({
      guildId: newMessage.guild.id,
      channelId: newMessage.channelId,
      authorId: newMessage.author.id,
      authorTag: newMessage.author.tag,
      kind: 'edit',
      content: newMessage.content || null,
      beforeContent: oldMessage.content || null,
    });

    const before = trim(oldMessage.content) || '*Contenu indisponible (message non mis en cache)*';
    const after = trim(newMessage.content) || '*Vide*';

    await sendLog(
      newMessage.guild,
      logEmbed(
        '✏️ Message modifié',
        `**Auteur :** <@${newMessage.author.id}>\n**Salon :** <#${newMessage.channelId}> — [aller au message](${newMessage.url})\n` +
          `**Avant :**\n>>> ${before}\n**Après :**\n>>> ${after}`,
        COLORS.WARNING
      )
    );
  },
};
