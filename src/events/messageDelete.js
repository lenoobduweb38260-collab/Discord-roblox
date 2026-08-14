const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { getGuildConfig } = require('../database');
const { record } = require('../utils/snipe');

// Log des messages supprimés (contenu disponible si le message était en cache).
module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    if (!message.guild) return;
    if (message.author?.bot) return;

    const cfg = getGuildConfig(message.guild.id);

    // 🔇 Jamais de log pour une suppression DANS le salon de logs : effacer
    // un vieux log y créait un nouveau log, qui polluait le salon même.
    if (cfg.log_channel_id && String(message.channelId) === String(cfg.log_channel_id)) return;

    // 🔇 Rien à raconter ? On se tait.
    // Un message hors cache (redémarrage, message ancien) arrive sans auteur
    // ni contenu : l'embed n'apprenait alors rien à personne — « Auteur
    // inconnu / Contenu indisponible » — et noyait les vrais logs.
    const riendADire = !message.author && !message.content && !message.attachments?.size;
    if (riendADire) return;

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
      ? [...message.attachments.values()].map((a) => a.name).join(', ')
      : '';

    // Le contenu est un CHAMP : avec « >>> » dans la description, la ligne
    // des pièces jointes se retrouvait aspirée dans la citation.
    const fields = [{ name: '📄 Contenu', value: content.slice(0, 1024), inline: false }];
    if (attachments) fields.push({ name: '📎 Pièces jointes', value: attachments.slice(0, 1024), inline: false });

    await sendLog(
      message.guild,
      logEmbed(
        '🗑️ Message supprimé',
        `**Auteur :** ${author}\n**Salon :** <#${message.channelId}>`,
        COLORS.DANGER,
        fields
      )
    );
  },
};
