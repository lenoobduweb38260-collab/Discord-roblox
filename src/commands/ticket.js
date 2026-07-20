const { SlashCommandBuilder, ChannelType, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  listTypes,
  getTypeByLabel,
  insertType,
  deleteType,
  insertPanel,
  lastPanel,
  updatePanelOptions,
  buildPanelPayload,
  parseColor,
} = require('../utils/tickets');
const { COLORS, sendLog, logEmbed } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');

// Récupère les options de personnalisation du panneau depuis l'interaction.
function readPanelOptions(interaction) {
  const opts = {};
  for (const key of ['mode', 'texte', 'titre', 'description', 'couleur', 'image', 'miniature', 'footer']) {
    const value = interaction.options.getString(key);
    if (value !== null) opts[key] = value;
  }
  return opts;
}

// Important : Discord exige que les options OBLIGATOIRES précèdent les
// facultatives — le mode (requis pour /ticket panneau) vient donc en premier.
function addPanelOptions(sub, modeRequired, withSalon) {
  sub.addStringOption((o) =>
    o
      .setName('mode')
      .setDescription('Format du message du panneau')
      .setRequired(modeRequired)
      .addChoices({ name: 'Message basique', value: 'basique' }, { name: 'Embed personnalisable', value: 'embed' })
  );
  if (withSalon) {
    sub.addChannelOption((o) =>
      o.setName('salon').setDescription('Salon du panneau (défaut : ici)').addChannelTypes(ChannelType.GuildText).setRequired(false)
    );
  }
  return sub
    .addStringOption((o) => o.setName('texte').setDescription('Texte du message (\\n = saut de ligne)').setRequired(false))
    .addStringOption((o) => o.setName('titre').setDescription('Titre de l\'embed').setRequired(false))
    .addStringOption((o) => o.setName('description').setDescription('Description de l\'embed (\\n = saut de ligne)').setRequired(false))
    .addStringOption((o) => o.setName('couleur').setDescription('Couleur de l\'embed (hex, ex : #5865F2)').setRequired(false))
    .addStringOption((o) => o.setName('image').setDescription('URL de l\'image de l\'embed (photo/GIF)').setRequired(false))
    .addStringOption((o) => o.setName('miniature').setDescription('URL de la miniature de l\'embed').setRequired(false))
    .addStringOption((o) => o.setName('footer').setDescription('Pied de page de l\'embed').setRequired(false));
}

module.exports = {
  grade: GRADES.STAFF,
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('[Staff] Système de tickets : types, catégories et panneau')
      .addSubcommand((sub) =>
        sub
          .setName('type-ajouter')
          .setDescription('Ajouter un type de ticket (relié à une catégorie Discord)')
          .addStringOption((o) => o.setName('nom').setDescription('Nom du type (ex : Support, Plainte, Recrutement)').setRequired(true))
          .addChannelOption((o) =>
            o.setName('categorie').setDescription('Catégorie où créer les salons de ce type').addChannelTypes(ChannelType.GuildCategory).setRequired(true)
          )
          .addRoleOption((o) => o.setName('role_support').setDescription('Rôle qui voit et gère ces tickets').setRequired(false))
          .addStringOption((o) => o.setName('emoji').setDescription('Emoji du bouton (ex : 🛠️)').setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName('type-retirer')
          .setDescription('Retirer un type de ticket')
          .addStringOption((o) => o.setName('nom').setDescription('Type à retirer').setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((sub) => sub.setName('types').setDescription('Voir les types de tickets configurés'));
    builder.addSubcommand((sub) =>
      addPanelOptions(sub.setName('panneau').setDescription('Publier le panneau de tickets dans un salon'), true, true)
    );
    builder.addSubcommand((sub) =>
      addPanelOptions(
        sub.setName('panneau-modifier').setDescription('Modifier le dernier panneau publié (texte, embed, boutons)'),
        false,
        false
      )
    );
    return builder;
  })(),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const types = listTypes
      .all(interaction.guildId)
      .filter((t) => t.label.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(types.map((t) => ({ name: t.label, value: t.label })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'type-ajouter') {
      const nom = interaction.options.getString('nom').trim().slice(0, 60);
      if (getTypeByLabel.get(interaction.guildId, nom)) {
        return interaction.reply({ content: `❌ Le type **${nom}** existe déjà.`, flags: MessageFlags.Ephemeral });
      }
      if (listTypes.all(interaction.guildId).length >= 25) {
        return interaction.reply({ content: '❌ Maximum 25 types de tickets (limite des boutons Discord).', flags: MessageFlags.Ephemeral });
      }
      const categorie = interaction.options.getChannel('categorie');
      const role = interaction.options.getRole('role_support');
      const emoji = interaction.options.getString('emoji');
      insertType.run(interaction.guildId, nom, emoji, categorie.id, role?.id || null);
      await interaction.reply({
        content:
          `✅ Type **${emoji ? `${emoji} ` : ''}${nom}** créé → salons dans **${categorie.name}**` +
          `${role ? `, géré par ${role}` : ''}.\n💡 Pensez à republier ou modifier le panneau (\`/ticket panneau\`) pour afficher le nouveau bouton.`,
      });
      await sendLog(
        interaction.guild,
        logEmbed('🎫 Type de ticket créé', `**${nom}** (catégorie ${categorie.name}) par <@${interaction.user.id}>.`, COLORS.SUCCESS)
      );
      return;
    }

    if (sub === 'type-retirer') {
      const nom = interaction.options.getString('nom').trim();
      const type = getTypeByLabel.get(interaction.guildId, nom);
      if (!type) {
        return interaction.reply({ content: `❌ Type **${nom}** introuvable.`, flags: MessageFlags.Ephemeral });
      }
      deleteType.run(type.id);
      await interaction.reply({
        content: `🗑️ Type **${nom}** retiré (les tickets déjà ouverts restent). Republiez le panneau pour retirer le bouton.`,
      });
      return;
    }

    if (sub === 'types') {
      const types = listTypes.all(interaction.guildId);
      if (!types.length) {
        return interaction.reply({ content: '📋 Aucun type de ticket (`/ticket type-ajouter`).', flags: MessageFlags.Ephemeral });
      }
      const lines = types.map(
        (t) =>
          `• ${t.emoji ? `${t.emoji} ` : ''}**${t.label}** — catégorie <#${t.category_id}>${t.support_role_id ? ` — support <@&${t.support_role_id}>` : ''}`
      );
      const embed = new EmbedBuilder().setColor(COLORS.INFO).setTitle(`🎫 Types de tickets (${types.length})`).setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'panneau') {
      if (!listTypes.all(interaction.guildId).length) {
        return interaction.reply({ content: '❌ Créez d\'abord au moins un type (`/ticket type-ajouter`).', flags: MessageFlags.Ephemeral });
      }
      const opts = readPanelOptions(interaction);
      if (opts.couleur && parseColor(opts.couleur) === null) {
        return interaction.reply({ content: '❌ Couleur invalide : utilisez un code hex, ex `#5865F2`.', flags: MessageFlags.Ephemeral });
      }
      const salon = interaction.options.getChannel('salon') || interaction.channel;
      const payload = buildPanelPayload(interaction.guildId, opts);
      const message = await salon.send(payload);
      insertPanel.run(interaction.guildId, salon.id, message.id, JSON.stringify(opts));
      await interaction.reply({
        content: `✅ Panneau publié dans ${salon}. Modifiez-le à tout moment avec \`/ticket panneau-modifier\`.`,
      });
      await sendLog(
        interaction.guild,
        logEmbed('🎫 Panneau publié', `Panneau de tickets publié dans <#${salon.id}> par <@${interaction.user.id}>.`, COLORS.INFO)
      );
      return;
    }

    if (sub === 'panneau-modifier') {
      const panel = lastPanel.get(interaction.guildId);
      if (!panel) {
        return interaction.reply({ content: '❌ Aucun panneau à modifier : publiez-en un avec `/ticket panneau`.', flags: MessageFlags.Ephemeral });
      }
      const channel = await interaction.guild.channels.fetch(panel.channel_id).catch(() => null);
      const message = channel ? await channel.messages.fetch(panel.message_id).catch(() => null) : null;
      if (!message) {
        return interaction.reply({
          content: '❌ Le message du panneau a été supprimé : republiez-en un avec `/ticket panneau`.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const newOpts = readPanelOptions(interaction);
      if (newOpts.couleur && parseColor(newOpts.couleur) === null) {
        return interaction.reply({ content: '❌ Couleur invalide : utilisez un code hex, ex `#5865F2`.', flags: MessageFlags.Ephemeral });
      }
      // Fusion : les options fournies remplacent les anciennes, le reste est conservé.
      const merged = { ...JSON.parse(panel.options || '{}'), ...newOpts };
      updatePanelOptions.run(JSON.stringify(merged), panel.id);
      await message.edit(buildPanelPayload(interaction.guildId, merged));
      await interaction.reply({
        content: `✅ Panneau mis à jour dans <#${panel.channel_id}> (boutons resynchronisés avec les types).`,
      });
      return;
    }
  },
};
