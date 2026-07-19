const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { listSamples, insertSample, deleteSample, getSample, hashesFor, downloadImage, MAX_SIZE } = require('../utils/scamImages');
const { COLORS, sendLog, logEmbed, frDateTime } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');

module.exports = {
  grade: GRADES.STAFF,
  data: new SlashCommandBuilder()
    .setName('scamimage')
    .setDescription('[Staff] Anti-scam : bannit automatiquement quiconque poste une image échantillon')
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('Ajouter une image échantillon (les images identiques ou quasi identiques seront bannies)')
        .addAttachmentOption((o) => o.setName('image').setDescription('Image scam échantillon').setRequired(true))
        .addStringOption((o) => o.setName('nom').setDescription('Nom de l\'échantillon (ex : faux nitro)').setRequired(false))
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir les échantillons enregistrés'))
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Retirer un échantillon par son numéro')
        .addIntegerOption((o) => o.setName('numero').setDescription('Numéro de l\'échantillon (voir liste)').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'ajouter') {
      const att = interaction.options.getAttachment('image');
      if (!att.contentType?.startsWith('image/')) {
        return interaction.reply({ content: '❌ Le fichier doit être une image.', flags: MessageFlags.Ephemeral });
      }
      if (att.size > MAX_SIZE) {
        return interaction.reply({ content: '❌ Image trop lourde (10 Mo maximum).', flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const buffer = await downloadImage(att.url).catch(() => null);
      if (!buffer) {
        return interaction.editReply('❌ Impossible de télécharger l\'image.');
      }
      const { sha256, dhash } = await hashesFor(buffer);
      const nom = interaction.options.getString('nom');
      const result = insertSample.run(
        interaction.guildId, nom, sha256, dhash, interaction.user.id, new Date().toISOString()
      );
      await interaction.editReply(
        `✅ Échantillon **n°${result.lastInsertRowid}**${nom ? ` « ${nom} »` : ''} enregistré.\n` +
          `🔍 Toute image **identique ou quasi identique** postée sur le serveur sera supprimée et son auteur **banni** automatiquement.` +
          (dhash ? '' : '\n⚠️ Empreinte perceptuelle indisponible pour ce format : seules les copies strictement identiques seront détectées.')
      );
      await sendLog(
        interaction.guild,
        logEmbed('🚨 Échantillon scam ajouté', `n°${result.lastInsertRowid}${nom ? ` « ${nom} »` : ''} par <@${interaction.user.id}>.`, COLORS.WARNING)
      );
      return;
    }

    if (sub === 'liste') {
      const samples = listSamples.all(interaction.guildId);
      if (!samples.length) {
        return interaction.reply({ content: '📋 Aucun échantillon scam enregistré (`/scamimage ajouter`).', flags: MessageFlags.Ephemeral });
      }
      const lines = samples.map(
        (s) =>
          `**n°${s.id}**${s.name ? ` — ${s.name}` : ''} · ajouté par <@${s.added_by}> le ${frDateTime(s.added_at)}${s.dhash ? '' : ' · *(SHA uniquement)*'}`
      );
      const embed = new EmbedBuilder()
        .setColor(COLORS.WARNING)
        .setTitle(`🚨 Échantillons scam (${samples.length})`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Image identique ou quasi identique postée → suppression + ban automatique' });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // retirer
    const numero = interaction.options.getInteger('numero');
    if (!getSample.get(numero, interaction.guildId)) {
      return interaction.reply({ content: `❌ Échantillon n°${numero} introuvable.`, flags: MessageFlags.Ephemeral });
    }
    deleteSample.run(numero, interaction.guildId);
    await interaction.reply({ content: `🗑️ Échantillon n°${numero} retiré.`, flags: MessageFlags.Ephemeral });
    await sendLog(
      interaction.guild,
      logEmbed('🚨 Échantillon scam retiré', `n°${numero} retiré par <@${interaction.user.id}>.`, COLORS.INFO)
    );
  },
};
