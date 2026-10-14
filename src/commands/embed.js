const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const composer = require('../utils/embedComposer');
const { suivre } = require('../utils/reponse');

// /embed : composer un message/embed avec APERÇU EN DIRECT, puis l'envoyer
// dans le salon choisi. Le message affiché pendant l'édition est exactement
// celui qui sera publié.
//
// /embed modifier : rouvrir un message DÉJÀ publié dans le même éditeur.
// Un panneau vit longtemps — un règlement se corrige, une règle s'ajoute.
// Sans cette porte, la seule façon de changer une virgule était de republier,
// ce qui perd les réactions, les réponses accrochées, les épingles, les liens
// partagés vers le message et sa date d'origine.

// Accepte les deux façons de désigner un message dans Discord :
//   • le lien complet (clic droit → « Copier le lien »)
//   • la paire « salon-message » du bouton « Copier l'ID » en mode développeur
function lireReference(brut, salonParDefaut) {
  const t = String(brut || '').trim();
  const lien = /(?:https?:\/\/)?(?:\w+\.)?discord(?:app)?\.com\/channels\/(\d+|@me)\/(\d+)\/(\d+)/.exec(t);
  if (lien) return { channelId: lien[2], messageId: lien[3] };
  const paire = /^(\d{17,20})[-\s](\d{17,20})$/.exec(t);
  if (paire) return { channelId: paire[1], messageId: paire[2] };
  if (/^\d{17,20}$/.test(t)) return { channelId: salonParDefaut, messageId: t };
  return null;
}

module.exports = {
  grade: GRADES.STAFF,
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('[Staff] Composer ou modifier un message/embed avec aperçu en direct')
    .addSubcommand((s) =>
      s.setName('creer').setDescription('Composer un nouveau message, avec aperçu en direct'))
    .addSubcommand((s) =>
      s
        .setName('modifier')
        .setDescription('Rouvrir un message déjà publié par le bot pour le corriger')
        .addStringOption((o) =>
          o
            .setName('message')
            .setDescription('Lien du message (clic droit → Copier le lien), ou son identifiant')
            .setRequired(true))),

  async execute(interaction) {
    const sous = interaction.options.getSubcommand(false) || 'creer';

    if (sous === 'modifier') {
      const ref = lireReference(interaction.options.getString('message'), interaction.channelId);
      if (!ref) {
        return interaction.reply({
          content: '❌ Je ne reconnais pas cette référence.\n'
            + '➜ Clic droit sur le message → **Copier le lien**, puis collez-le ici.\n'
            + '➜ L\'identifiant seul marche aussi si le message est dans ce salon.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const salon = await interaction.client.channels.fetch(ref.channelId).catch(() => null);
      if (!salon?.isTextBased() || salon.guildId !== interaction.guildId) {
        return interaction.reply({
          content: '❌ Ce salon est introuvable, hors de ce serveur, ou je n\'y ai pas accès.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const message = await salon.messages.fetch(ref.messageId).catch(() => null);

      const r = await composer.startEdit(interaction, message);
      if (r?.erreur) return interaction.reply({ content: r.erreur, flags: MessageFlags.Ephemeral });
      // Un message publié avant cette version n'a pas de texte source en
      // mémoire : on est reparti du rendu. Le dire évite la surprise de voir
      // des « ➜ » là où l'on avait tapé « &> ».
      if (r?.repris) {
        return suivre(interaction, {
          content: '-# ℹ️ Ce message a été publié avant la mémoire des sources : son texte a été relu depuis '
            + 'le rendu. Les balises `&&` et `&>` y apparaissent donc déjà transformées. Les prochaines '
            + 'modifications, elles, repartiront du texte exact.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
      }
      return null;
    }

    return composer.start(interaction, { channelId: interaction.channelId });
  },

  lireReference,
};
