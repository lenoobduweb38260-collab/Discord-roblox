const { SlashCommandBuilder, MessageFlags, ChannelType } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { isCreator } = require('../utils/botTeam');
const composer = require('../utils/embedComposer');
const { suivre } = require('../utils/reponse');

// 📣 /annonce — le créateur du bot écrit un message, où il veut.
//
// Réservé au créateur : c'est un mégaphone. Le staff d'un serveur a déjà
// `/embed` pour son propre serveur ; cette commande-ci sert à parler AU NOM
// du bot, y compris sur un serveur où l'on n'est pas staff.
//
// Elle réutilise l'éditeur d'embed plutôt que d'en refaire un : même aperçu
// en direct, mêmes balises `&&`, mêmes images, même promesse — ce qui est
// affiché est exactement ce qui part. Deux éditeurs auraient fini par diverger.

module.exports = {
  grade: GRADES.EVERYONE, // contrôle réel ci-dessous : créateur uniquement
  data: new SlashCommandBuilder()
    .setName('annonce')
    .setDescription('[Créateur] Écrire une annonce et la publier avec le bot')
    .addSubcommand((s) => s
      .setName('ecrire')
      .setDescription('Composer une annonce, avec aperçu en direct')
      .addChannelOption((o) => o.setName('salon')
        .setDescription('Salon de publication (défaut : celui-ci)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false))
      .addStringOption((o) => o.setName('titre').setDescription('Titre de l\'annonce').setRequired(false).setMaxLength(256))
      .addStringOption((o) => o.setName('texte')
        .setDescription('Le corps de l\'annonce — « && » trace une barre, « &> » une entrée, « \\n » un saut de ligne')
        .setRequired(false).setMaxLength(3800))
      .addAttachmentOption((o) => o.setName('image').setDescription('Grande image, en bas de l\'annonce').setRequired(false))
      .addAttachmentOption((o) => o.setName('vignette').setDescription('Petite image, en haut à droite').setRequired(false))
      .addStringOption((o) => o.setName('couleur').setDescription('Couleur hex, ex : #556B2F').setRequired(false).setMaxLength(7))
      .addBooleanOption((o) => o.setName('sans_embed')
        .setDescription('Envoyer un message simple, sans cadre')
        .setRequired(false)))
    .addSubcommand((s) => s
      .setName('modifier')
      .setDescription('Rouvrir une annonce déjà publiée pour la corriger')
      .addStringOption((o) => o.setName('message')
        .setDescription('Lien du message (clic droit → Copier le lien)')
        .setRequired(true))),

  async execute(interaction) {
    // ⚠️ Le contrôle est ici, pas dans `grade` : le créateur du bot n'est pas
    // un grade du serveur. Il peut très bien n'être ni staff ni admin là où
    // il publie — c'est même l'intérêt de la commande.
    if (!(await isCreator(interaction.user.id))) {
      return interaction.reply({
        content: '⛔ Cette commande est réservée au **créateur du bot**.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.options.getSubcommand() === 'modifier') {
      const brut = interaction.options.getString('message');
      const ref = lireReference(brut, interaction.channelId);
      if (!ref) {
        return interaction.reply({
          content: '❌ Je ne reconnais pas cette référence.\n'
            + '➜ Clic droit sur le message → **Copier le lien**, puis collez-le ici.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const salon = await interaction.client.channels.fetch(ref.channelId).catch(() => null);
      const message = salon?.isTextBased() ? await salon.messages.fetch(ref.messageId).catch(() => null) : null;
      const r = await composer.startEdit(interaction, message);
      if (r?.erreur) return interaction.reply({ content: r.erreur, flags: MessageFlags.Ephemeral });
      return null;
    }

    const salon = interaction.options.getChannel('salon') || interaction.channel;
    const image = interaction.options.getAttachment('image');
    const vignette = interaction.options.getAttachment('vignette');
    const texte = interaction.options.getString('texte') || '';
    const titre = interaction.options.getString('titre') || '';
    const sansEmbed = interaction.options.getBoolean('sans_embed') === true;

    // ⚠️ Une image envoyée en pièce jointe a une URL SIGNÉE, qui expire. Elle
    // tient le temps de composer et d'envoyer, ce qui suffit ici : Discord
    // réhéberge l'image au moment de la publication. Une image dont on veut
    // qu'elle vive des mois se colle en URL dans l'éditeur.
    const estImage = (a) => !a || /^image\//i.test(a.contentType || '') || /\.(png|jpe?g|gif|webp)$/i.test(a.name || '');
    if (!estImage(image) || !estImage(vignette)) {
      return interaction.reply({
        content: '❌ Les fichiers joints doivent être des **images** (png, jpg, gif, webp).',
        flags: MessageFlags.Ephemeral,
      });
    }

    const couleur = /^#?([0-9a-f]{6})$/i.exec(interaction.options.getString('couleur') || '');

    await composer.start(interaction, {
      channelId: salon.id,
      // Sans cadre : tout le contenu passe dans le texte du message. Avec
      // cadre : titre et corps vont dans l'embed.
      text: sansEmbed ? [titre ? `**${titre}**` : '', texte].filter(Boolean).join('\n') : '',
      title: sansEmbed ? '' : titre,
      description: sansEmbed ? '' : texte,
      image: !sansEmbed && image ? image.url : '',
      thumbnail: !sansEmbed && vignette ? vignette.url : '',
      color: couleur ? parseInt(couleur[1], 16) : null,
    });
    // L'éditeur a répondu : on complète sans le remplacer.
    return suivre(interaction, {
      content: '-# 📣 Annonce en préparation. Relisez l\'aperçu, puis **Envoyer**.'
        + (sansEmbed ? '\n-# Mode sans cadre : ajoutez une image en collant son lien dans le texte.' : ''),
      flags: MessageFlags.Ephemeral,
    });
  },
};

// Accepte le lien complet, la paire « salon-message », ou l'identifiant seul.
function lireReference(brut, salonParDefaut) {
  const t = String(brut || '').trim();
  const lien = /(?:https?:\/\/)?(?:\w+\.)?discord(?:app)?\.com\/channels\/(\d+|@me)\/(\d+)\/(\d+)/.exec(t);
  if (lien) return { channelId: lien[2], messageId: lien[3] };
  const paire = /^(\d{17,20})[-\s](\d{17,20})$/.exec(t);
  if (paire) return { channelId: paire[1], messageId: paire[2] };
  if (/^\d{17,20}$/.test(t)) return { channelId: salonParDefaut, messageId: t };
  return null;
}

module.exports.lireReference = lireReference;
