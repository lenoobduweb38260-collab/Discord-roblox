const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  listPresets,
  getPreset,
  getPresetByLabel,
  insertPreset,
  deletePreset,
  updatePreset,
  payloadDe,
  menuPresets,
  MAX,
} = require('../utils/ticketPresets');
const { getGuildConfig } = require('../database');
const { COLORS } = require('../utils/embeds');
const { GRADES, getGrade } = require('../utils/permissions');

// 📋 Réponses types envoyées par le bot dans les tickets.
// Le staff les écrit une fois ici, puis les choisit dans la liste déroulante
// du ticket au lieu de retaper le même message à chaque fois.

module.exports = {
  grade: GRADES.STAFF,
  data: new SlashCommandBuilder()
    .setName('preset')
    .setDescription('[Staff] Réponses types que le bot peut envoyer dans un ticket')
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('Créer une réponse type')
        .addStringOption((o) => o.setName('nom').setDescription('Nom affiché dans la liste déroulante').setRequired(true))
        .addStringOption((o) => o.setName('message').setDescription('Texte envoyé — && = barre, &> = liste, \\n = saut de ligne').setRequired(false))
        .addStringOption((o) => o.setName('titre').setDescription('Titre de l\'embed (facultatif)').setRequired(false))
        .addStringOption((o) => o.setName('description').setDescription('Texte de l\'embed — && = barre, &> = liste').setRequired(false))
        .addStringOption((o) => o.setName('couleur').setDescription('Couleur de l\'embed, ex : #5865F2').setRequired(false))
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji affiché dans la liste').setRequired(false))
        .addStringOption((o) => o.setName('aide').setDescription('Petite description sous le nom, dans la liste').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('modifier')
        .setDescription('Modifier une réponse type (les champs laissés vides ne changent pas)')
        .addIntegerOption((o) => o.setName('numero').setDescription('Numéro de la réponse (voir /preset liste)').setRequired(true))
        .addStringOption((o) => o.setName('nom').setDescription('Nouveau nom').setRequired(false))
        .addStringOption((o) => o.setName('message').setDescription('Nouveau texte — && = barre, &> = liste (« - » pour vider)').setRequired(false))
        .addStringOption((o) => o.setName('titre').setDescription('Nouveau titre d\'embed (« - » pour vider)').setRequired(false))
        .addStringOption((o) => o.setName('description').setDescription('Nouveau texte d\'embed — && = barre, &> = liste').setRequired(false))
        .addStringOption((o) => o.setName('couleur').setDescription('Nouvelle couleur').setRequired(false))
        .addStringOption((o) => o.setName('emoji').setDescription('Nouvel emoji (« - » pour retirer)').setRequired(false))
        .addStringOption((o) => o.setName('aide').setDescription('Nouvelle description (« - » pour retirer)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('supprimer')
        .setDescription('Supprimer une réponse type')
        .addIntegerOption((o) => o.setName('numero').setDescription('Numéro de la réponse').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir toutes les réponses types'))
    .addSubcommand((sub) =>
      sub
        .setName('apercu')
        .setDescription('Voir le rendu d\'une réponse type sans l\'envoyer')
        .addIntegerOption((o) => o.setName('numero').setDescription('Numéro de la réponse').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('menu').setDescription('Republier la liste déroulante des réponses types dans ce salon')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cfg = getGuildConfig(interaction.guildId);
    if (getGrade(interaction.member, cfg) < GRADES.STAFF) {
      return interaction.reply({ content: '⛔ Réservé au staff.', flags: MessageFlags.Ephemeral });
    }

    // Les sauts de ligne ne se tapent pas dans une option de commande.
    const lignes = (v) => (v === null || v === undefined ? null : String(v).replaceAll('\\n', '\n'));

    if (sub === 'ajouter') {
      const nom = interaction.options.getString('nom').trim().slice(0, 100);
      if (getPresetByLabel.get(interaction.guildId, nom)) {
        return interaction.reply({ content: `❌ Une réponse type s'appelle déjà « ${nom} ».`, flags: MessageFlags.Ephemeral });
      }
      if (listPresets.all(interaction.guildId).length >= MAX) {
        return interaction.reply({
          content: `❌ Maximum atteint (${MAX} réponses) : Discord n'accepte pas plus d'options dans une liste déroulante. Supprimez-en une d'abord.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      const message = lignes(interaction.options.getString('message'));
      const titre = interaction.options.getString('titre');
      const description = lignes(interaction.options.getString('description'));
      // Un preset vide n'enverrait rien : autant le refuser tout de suite.
      if (!message?.trim() && !titre?.trim() && !description?.trim()) {
        return interaction.reply({
          content: '❌ Une réponse type doit contenir au moins un **message**, un **titre** ou une **description**.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const r = insertPreset.run(
        interaction.guildId, nom,
        interaction.options.getString('emoji')?.trim() || null,
        interaction.options.getString('aide')?.trim().slice(0, 100) || null,
        message, titre?.slice(0, 256) || null, description,
        interaction.options.getString('couleur')?.trim() || null,
        interaction.user.id, new Date().toISOString()
      );
      return interaction.reply({
        content: `✅ Réponse type **n°${r.lastInsertRowid} — ${nom}** créée. Elle apparaîtra dans la liste déroulante des **nouveaux** tickets ; pour les tickets déjà ouverts, utilisez \`/preset menu\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'modifier') {
      const id = interaction.options.getInteger('numero');
      const p = getPreset.get(id, interaction.guildId);
      if (!p) return interaction.reply({ content: `❌ Aucune réponse type n°${id}.`, flags: MessageFlags.Ephemeral });
      // « - » vide un champ ; une option absente le laisse tel quel.
      const maj = (nom, actuel, transforme = (v) => v) => {
        const v = interaction.options.getString(nom);
        if (v === null) return actuel;
        return v.trim() === '-' ? null : transforme(v);
      };
      const nouveau = {
        label: (interaction.options.getString('nom') || p.label).trim().slice(0, 100),
        emoji: maj('emoji', p.emoji, (v) => v.trim()),
        description: maj('aide', p.description, (v) => v.trim().slice(0, 100)),
        content: maj('message', p.content, (v) => lignes(v)),
        embed_title: maj('titre', p.embed_title, (v) => v.slice(0, 256)),
        embed_text: maj('description', p.embed_text, (v) => lignes(v)),
        embed_color: maj('couleur', p.embed_color, (v) => v.trim()),
      };
      if (!nouveau.content?.trim() && !nouveau.embed_title?.trim() && !nouveau.embed_text?.trim()) {
        return interaction.reply({
          content: '❌ Impossible : la réponse type se retrouverait vide et n\'enverrait rien.',
          flags: MessageFlags.Ephemeral,
        });
      }
      updatePreset.run(
        nouveau.label, nouveau.emoji, nouveau.description, nouveau.content,
        nouveau.embed_title, nouveau.embed_text, nouveau.embed_color, id, interaction.guildId
      );
      return interaction.reply({ content: `✏️ Réponse type **n°${id} — ${nouveau.label}** modifiée.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'supprimer') {
      const id = interaction.options.getInteger('numero');
      const p = getPreset.get(id, interaction.guildId);
      if (!p) return interaction.reply({ content: `❌ Aucune réponse type n°${id}.`, flags: MessageFlags.Ephemeral });
      deletePreset.run(id, interaction.guildId);
      return interaction.reply({ content: `🗑️ Réponse type **${p.label}** supprimée.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'liste') {
      const presets = listPresets.all(interaction.guildId);
      if (!presets.length) {
        return interaction.reply({
          content: '📋 Aucune réponse type. Créez-en une avec `/preset ajouter`.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const embed = new EmbedBuilder()
        .setColor(COLORS.PRIMARY)
        .setTitle(`📋 Réponses types (${presets.length}/${MAX})`)
        .setDescription(
          presets
            .map((p) => {
              const apercu = (p.content || p.embed_text || p.embed_title || '').replace(/\s+/g, ' ').slice(0, 70);
              return `**n°${p.id}** ${p.emoji || ''} **${p.label}**\n> ${apercu || '*(vide)*'}${apercu.length >= 70 ? '…' : ''}`;
            })
            .join('\n')
            .slice(0, 4096)
        )
        .setFooter({ text: 'Elles apparaissent dans la liste déroulante des tickets.' });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'apercu') {
      const id = interaction.options.getInteger('numero');
      const p = getPreset.get(id, interaction.guildId);
      if (!p) return interaction.reply({ content: `❌ Aucune réponse type n°${id}.`, flags: MessageFlags.Ephemeral });
      const payload = payloadDe(p, { membre: interaction.user.id, staff: interaction.user.id, serveur: interaction.guild.name });
      if (!payload) return interaction.reply({ content: '❌ Cette réponse type est vide.', flags: MessageFlags.Ephemeral });
      // Aperçu privé : rien n'est publié dans le salon.
      return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }

    // menu
    const row = menuPresets(interaction.guildId, 0);
    if (!row) {
      return interaction.reply({
        content: '📋 Aucune réponse type à proposer. Créez-en une avec `/preset ajouter`.',
        flags: MessageFlags.Ephemeral,
      });
    }
    await interaction.channel.send({
      content: '📋 **Réponses types** — choisissez celle à envoyer dans ce salon.',
      components: [row],
    });
    return interaction.reply({ content: '✅ Liste déroulante publiée.', flags: MessageFlags.Ephemeral });
  },
};
