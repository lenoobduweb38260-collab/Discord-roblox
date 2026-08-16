const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { getGuildConfig } = require('../database');
const { record } = require('../utils/snipe');
const { sauvegarder } = require('../utils/piecesJointes');
const M = require('../utils/miseEnPage');

// Log des messages supprimés (contenu disponible si le message était en cache).
//
// 📎 La pièce jointe est TÉLÉCHARGÉE puis ARCHIVÉE SUR L'HÉBERGEUR, quelle que
// soit sa taille. Noter son lien ne servirait à rien : une URL de pièce jointe
// Discord est signée et meurt avec son message. Quelques minutes après la
// suppression, le journal n'afficherait plus qu'un lien mort — c'est-à-dire la
// preuve disparue au moment précis où on en aurait besoin.
//
// Ce qui tient dans la limite de Discord est en plus RENVOYÉ dans le journal,
// donc visible tout de suite. Le reste est archivé et référencé.
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

    // ⏱️ D'abord la pièce jointe, tant que son lien vit encore.
    const { fichiers, resume, apercu } = await sauvegarder(message.attachments, {
      guildId: message.guild.id,
      channelId: message.channelId,
      messageId: message.id,
      authorId: message.author?.id,
    });

    const auteur = message.author ? `<@${message.author.id}> (\`${message.author.id}\`)` : '*Auteur inconnu*';
    const contenu = message.content
      ? M.borner(message.content, 1000)
      : '*Contenu indisponible (message non mis en cache)*';

    // Le contenu est un CHAMP : avec « >>> » dans la description, la ligne
    // des pièces jointes se retrouvait aspirée dans la citation.
    const champs = [{ name: '📄 Contenu', value: M.borner(contenu, M.MAX_CHAMP), inline: false }];
    if (resume) champs.push({ name: '📎 Pièce(s) jointe(s)', value: M.borner(resume, M.MAX_CHAMP), inline: false });

    const embed = logEmbed(
      '🗑️ Message supprimé',
      M.description([
        M.bloc('Auteur', [auteur], { prefixe: '👤', compte: null }),
        M.bloc('Salon', [`<#${message.channelId}>`], { prefixe: '📍', compte: null }),
      ]),
      COLORS.DANGER,
      champs
    );

    // La première image reprend sa place : affichée en grand, comme dans le
    // message d'origine. `attachment://` désigne le fichier renvoyé juste
    // au-dessus — pas une URL qui pourrait expirer.
    if (apercu) embed.setImage(apercu);

    await sendLog(message.guild, embed, fichiers);
  },
};
