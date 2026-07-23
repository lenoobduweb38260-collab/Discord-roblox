const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { getGuildConfig } = require('../database');
const { isCreator } = require('../utils/botTeam');
const patch = require('../utils/patchNotes');

// Patch notes : le créateur rédige une note (mise à jour / retrait /
// amélioration / fix) UNIQUEMENT côté utilisateurs (jamais ce qui touche le
// staff du bot), la prévisualise, puis la publie dans le salon patch note de
// chaque serveur (patch_channel_id).
const drafts = new Map();
let counter = 0;

// Réutilise le constructeur partagé (4 catégories + mention « effet immédiat »).
function buildEmbed(fields) {
  return patch.buildEmbed({
    title: fields.titre || 'Note de mise à jour',
    ajout: fields.maj,
    fix: fields.fix,
    amelioration: fields.amelio,
    retrait: fields.retrait,
  });
}

function modal() {
  const f = (id, label, ph) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(ph).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)
    );
  return new ModalBuilder()
    .setCustomId('pn:modal')
    .setTitle('Patch note (côté utilisateurs)')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('titre').setLabel('Titre / version').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder('ex : v1.0.60')
      ),
      f('maj', '🆕 Ajout', 'Nouveautés visibles par les membres'),
      f('amelio', '✨ Amélioration', 'Ce qui a été amélioré'),
      f('fix', '🔧 Fix', 'Bugs corrigés'),
      f('retrait', '➖ Retrait', 'Ce qui a été retiré')
    );
}

module.exports = {
  grade: GRADES.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('patchnote')
    .setDescription('[Créateur] Rédiger et publier une note de mise à jour (côté utilisateurs)'),

  async execute(interaction) {
    if (!(await isCreator(interaction.client, interaction.user.id))) {
      return interaction.reply({ content: '⛔ Réservé au créateur du bot.', flags: MessageFlags.Ephemeral });
    }
    return interaction.showModal(modal());
  },

  async handle(interaction) {
    // Soumission du modal → aperçu
    if (interaction.isModalSubmit() && interaction.customId === 'pn:modal') {
      const fields = {
        titre: interaction.fields.getTextInputValue('titre'),
        maj: interaction.fields.getTextInputValue('maj'),
        amelio: interaction.fields.getTextInputValue('amelio'),
        fix: interaction.fields.getTextInputValue('fix'),
        retrait: interaction.fields.getTextInputValue('retrait'),
      };
      const id = `${Date.now().toString(36)}${counter++}`;
      drafts.set(id, fields);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pn:pub:${id}`).setLabel('Publier partout').setEmoji('📤').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`pn:cxl:${id}`).setLabel('Annuler').setEmoji('❌').setStyle(ButtonStyle.Danger)
      );
      return interaction.reply({
        content: '🔎 **Aperçu** — voici la note qui sera publiée dans le salon patch note de chaque serveur :',
        embeds: [buildEmbed(fields)],
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Boutons
    const [, action, id] = interaction.customId.split(':');
    const fields = drafts.get(id);
    if (!fields) return interaction.update({ content: '⏳ Brouillon expiré.', embeds: [], components: [] }).catch(() => null);
    if (action === 'cxl') {
      drafts.delete(id);
      return interaction.update({ content: '❌ Annulé.', embeds: [], components: [] });
    }
    // pub
    if (!(await isCreator(interaction.client, interaction.user.id))) {
      return interaction.reply({ content: '⛔ Réservé au créateur.', flags: MessageFlags.Ephemeral });
    }
    const embed = buildEmbed(fields);
    let count = 0;
    for (const guild of interaction.client.guilds.cache.values()) {
      const cfg = getGuildConfig(guild.id);
      if (!cfg.patch_channel_id) continue;
      const channel = await guild.channels.fetch(cfg.patch_channel_id).catch(() => null);
      if (channel?.isTextBased()) {
        const ok = await channel
          .send({ content: '@here', embeds: [embed], allowedMentions: { parse: ['everyone'] } })
          .then(() => true)
          .catch(() => false);
        if (ok) count++;
      }
    }
    drafts.delete(id);
    return interaction.update({ content: `✅ Patch note publiée dans **${count}** serveur(s).`, embeds: [buildEmbed(fields)], components: [] });
  },
};
