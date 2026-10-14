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
const { mettreAJour } = require('../utils/reponse');

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
    .setDescription('[Créateur] Notes de mise à jour : rédiger ou forcer la publication')
    .addSubcommand((s) =>
      s.setName('ecrire').setDescription('[Créateur] Rédiger et publier une note (côté utilisateurs)')
    )
    .addSubcommand((s) =>
      s
        .setName('forcer')
        .setDescription('[Créateur] Forcer la publication des notes automatiques')
        .addStringOption((o) =>
          o
            .setName('cible')
            .setDescription('Que publier ? (défaut : dernière version)')
            .setRequired(false)
            .addChoices(
              { name: 'Dernière version', value: 'derniere' },
              { name: 'En attente (non encore annoncées)', value: 'attente' },
              { name: 'Récapitulatif complet', value: 'initial' }
            )
        )
    ),

  async execute(interaction) {
    if (!(await isCreator(interaction.client, interaction.user.id))) {
      return interaction.reply({ content: '⛔ Réservé au créateur du bot.', flags: MessageFlags.Ephemeral });
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'ecrire') {
      return interaction.showModal(modal());
    }

    // forcer : publie depuis le journal automatique.
    const cible = interaction.options.getString('cible') || 'derniere';
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const res = await patch.forcePublish(interaction.client, cible);
    if (res.mode === 'attente') {
      return interaction.editReply(
        res.entries
          ? `✅ ${res.entries} note(s) en attente publiée(s) dans **${res.count}** salon(s).`
          : 'ℹ️ Aucune note en attente : toutes les versions du journal ont déjà été annoncées.'
      );
    }
    return interaction.editReply(
      `✅ Note « ${res.title} » publiée dans **${res.count}** salon(s).\n` +
        '-# La mention éventuelle dépend du réglage de chaque serveur — aucune par défaut.'
    );
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
    if (!fields) return mettreAJour(interaction, { content: '⏳ Brouillon expiré.', embeds: [], components: [] }).catch(() => null);
    if (action === 'cxl') {
      drafts.delete(id);
      return mettreAJour(interaction, { content: '❌ Annulé.', embeds: [], components: [] });
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
        // La mention suit le réglage du serveur : aucune par défaut.
        const ok = await channel
          .send(patch.envoiDe(embed, cfg))
          .then(() => true)
          .catch(() => false);
        if (ok) count++;
      }
    }
    drafts.delete(id);
    return mettreAJour(interaction, { content: `✅ Patch note publiée dans **${count}** serveur(s).`, embeds: [buildEmbed(fields)], components: [] });
  },
};
