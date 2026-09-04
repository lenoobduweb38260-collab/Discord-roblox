const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { getGuildConfig } = require('../database');
const { record } = require('../utils/snipe');
const { sauvegarder } = require('../utils/piecesJointes');
const { quiAEfface, reconnaitre, republier } = require('../utils/messagesDuBot');
const M = require('../utils/miseEnPage');
const { etiquetteMembre } = require('../utils/journal');

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
    // 🛡️ Un message DU BOT vient d'être effacé.
    //
    // Discord ne permet pas de l'interdire : « Gérer les messages » autorise
    // à supprimer n'importe quel message d'un salon, bot compris, et aucun
    // réglage côté bot ne prime dessus. Ce qu'on peut faire, c'est le NOMMER
    // — jusqu'ici la suppression était totalement muette, puisque le journal
    // ignorait les messages de bot — et REPUBLIER ce qui doit rester en
    // place. Effacer un panneau ne le fait donc plus disparaître.
    if (message.author?.id && message.client?.user?.id === message.author.id) {
      return protegerMessageDuBot(message);
    }

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

    const auteur = message.author ? etiquetteMembre(message.author) : '*Auteur inconnu*';
    const contenu = message.content
      ? M.borner(message.content, 1000)
      : '*Contenu indisponible (message non mis en cache)*';

    // 🧹 QUI a effacé ? Le journal d'audit met une seconde à s'écrire — et il
    // ne note que les suppressions faites par un TIERS : pas d'entrée, c'est
    // que l'auteur a effacé son propre message. On vise l'entrée du même
    // salon ET du même auteur, pour ne jamais accuser le mauvais modérateur.
    await new Promise((r) => setTimeout(r, 1200));
    const effaceur = await quiAEfface(message.guild, message.channelId, message.author?.id || null);

    // Le contenu est un CHAMP : avec « >>> » dans la description, la ligne
    // des pièces jointes se retrouvait aspirée dans la citation.
    const champs = [{ name: '📄 Contenu', value: M.borner(contenu, M.MAX_CHAMP), inline: false }];
    if (resume) champs.push({ name: '📎 Pièce(s) jointe(s)', value: M.borner(resume, M.MAX_CHAMP), inline: false });

    const embed = logEmbed(
      '🗑️ Message supprimé',
      M.description([
        M.bloc('Auteur', [auteur], { prefixe: '👤', compte: null }),
        M.bloc('Supprimé par', [
          effaceur
            ? etiquetteMembre(effaceur)
            : '*Son auteur — Discord n\'audite que les suppressions faites par un tiers*',
        ], { prefixe: '🧹', compte: null }),
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

// 🛡️ Suppression d'un message du bot : on la trace, et on remet en place ce
// qui doit l'être.
//
// ⚠️ Ne jamais lever ici : cet événement arrive pour CHAQUE message effacé du
// serveur. Une exception y couperait aussi le journal des suppressions
// ordinaires.
async function protegerMessageDuBot(message) {
  try {
    // Message privé : personne d'autre que le bot ne peut y supprimer ses
    // messages. Si cela arrive quand même, c'est que le bot lui-même l'a
    // fait — on n'alerte donc pas le serveur, mais on garde une trace.
    if (!message.guild) {
      console.warn(`ℹ️ Message du bot supprimé en privé (salon ${message.channelId}).`);
      return;
    }

    const quoi = reconnaitre(message);
    // Un message ordinaire du bot (réponse de commande, animation, annonce)
    // n'a pas à remplir le journal quand il disparaît. Seuls les messages
    // qui STRUCTURENT le serveur méritent une alerte.
    if (!quoi.genre) return;

    // Le journal d'audit met une seconde à se remplir : sans cette attente,
    // on chercherait l'auteur avant que Discord ne l'ait écrit.
    await new Promise((r) => setTimeout(r, 1200));
    const auteur = await quiAEfface(message.guild, message.channelId);
    const remis = quoi.republiable ? await republier(message) : null;

    const lignes = [
      `Un **${quoi.genre}** a été supprimé dans <#${message.channelId}>.`,
      auteur ? `👤 Par ${etiquetteMembre(auteur)}` : '👤 Auteur inconnu — je n\'ai pas accès au journal d\'audit.',
      remis || '⚠️ Il n\'a **pas** pu être republié : republiez-le à la main.',
    ];
    if (!auteur) {
      lignes.push('-# Donnez-moi la permission « Voir le journal d\'audit » pour savoir qui efface mes messages.');
    }

    await sendLog(
      message.guild,
      logEmbed('🛡️ Message du bot supprimé', M.description([
        M.bloc('Ce qui s\'est passé', lignes, { prefixe: '🗑️', compte: null }),
      ]), remis ? COLORS.WARNING : COLORS.DANGER)
    );
  } catch (err) {
    console.warn(`⚠️ Protection des messages du bot : ${err.message}`);
  }
}
