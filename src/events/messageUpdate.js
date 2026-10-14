const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { etiquetteMembre } = require('../utils/journal');
const { getGuildConfig } = require('../database');
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

    const cfg = getGuildConfig(newMessage.guild.id);
    // 🔇 Pas de log pour une modification DANS le salon de logs.
    if (cfg.log_channel_id && String(newMessage.channelId) === String(cfg.log_channel_id)) return;
    // 🔇 Sans l'ancien texte NI le nouveau, l'embed n'apprend rien : on se tait.
    if (!oldMessage.content && !newMessage.content) return;

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

    // Avant / Après en CHAMPS séparés.
    // La description utilisait « >>> », qui ouvre sur Discord une citation
    // s'étendant jusqu'à la fin du message : le titre « Après » et son texte
    // se retrouvaient aspirés dans la citation du « Avant », collés l'un à
    // l'autre. Deux champs se séparent d'eux-mêmes.
    await sendLog(
      newMessage.guild,
      logEmbed(
        '✏️ Message modifié',
        `**Auteur :** ${etiquetteMembre(newMessage.author)}\n**Salon :** <#${newMessage.channelId}> — [aller au message](${newMessage.url})`,
        COLORS.WARNING,
        [
          { name: '📝 Avant', value: before.slice(0, 1024), inline: false },
          { name: '✅ Après', value: after.slice(0, 1024), inline: false },
        ]
      )
    );
  },
};
