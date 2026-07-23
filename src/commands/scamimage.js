const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  listSamples,
  listGlobalSamples,
  insertSample,
  deleteSample,
  getSampleById,
  hashesFor,
  downloadImage,
  MAX_SIZE,
  GLOBAL_SCOPE,
} = require('../utils/scamImages');
const { COLORS, sendLog, logEmbed, frDateTime } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');
const { isCreator } = require('../utils/botTeam');

module.exports = {
  grade: GRADES.EVERYONE, // contrôle strict : créateur du bot uniquement (voir execute)
  data: new SlashCommandBuilder()
    .setName('scamimage')
    .setDescription('[Créateur] Anti-scam global : bannit quiconque poste une image échantillon (valable sur tous les serveurs)')
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('Ajouter une image échantillon globale (images identiques ou quasi identiques bannies partout)')
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
    // Anti-scam réservé au créateur du bot : lui seul ajoute/retire les
    // échantillons, qui valent sur TOUS les serveurs.
    if (!(await isCreator(interaction.client, interaction.user.id))) {
      return interaction.reply({
        content: '⛔ Réservé au **créateur du bot** : lui seul gère les images anti-scam (elles s\'appliquent à tous les serveurs).',
        flags: MessageFlags.Ephemeral,
      });
    }
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
        GLOBAL_SCOPE, nom, sha256, dhash, interaction.user.id, new Date().toISOString()
      );
      await interaction.editReply(
        `✅ Échantillon **n°${result.lastInsertRowid}**${nom ? ` « ${nom} »` : ''} enregistré 🌐 **(valable sur TOUS les serveurs du bot)**.\n` +
          `🔍 Toute image **identique ou quasi identique** postée sera supprimée, son auteur recevra un **ban global** ` +
          `(tous les serveurs + auto-ban à l'arrivée) et ses messages des dernières 24 h seront supprimés.` +
          (dhash ? '' : '\n⚠️ Empreinte perceptuelle indisponible pour ce format : seules les copies strictement identiques seront détectées.')
      );
      await sendLog(
        interaction.guild,
        logEmbed('🚨 Échantillon scam ajouté', `n°${result.lastInsertRowid}${nom ? ` « ${nom} »` : ''} par <@${interaction.user.id}>.`, COLORS.WARNING)
      );
      return;
    }

    if (sub === 'liste') {
      const samples = listGlobalSamples.all(GLOBAL_SCOPE);
      if (!samples.length) {
        return interaction.reply({ content: '📋 Aucun échantillon scam enregistré (`/scamimage ajouter`).', flags: MessageFlags.Ephemeral });
      }
      const lines = samples.map(
        (s) =>
          `**n°${s.id}** 🌐${s.name ? ` — ${s.name}` : ''} · ajouté par <@${s.added_by}> le ${frDateTime(s.added_at)}${s.dhash ? '' : ' · *(SHA uniquement)*'}`
      );
      const embed = new EmbedBuilder()
        .setColor(COLORS.WARNING)
        .setTitle(`🚨 Échantillons scam globaux (${samples.length})`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Valables sur tous les serveurs · image identique ou quasi identique postée → suppression + ban global + purge 24 h' });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // retirer
    const numero = interaction.options.getInteger('numero');
    const sample = getSampleById.get(numero);
    if (!sample || sample.guild_id !== GLOBAL_SCOPE) {
      return interaction.reply({ content: `❌ Échantillon n°${numero} introuvable.`, flags: MessageFlags.Ephemeral });
    }
    deleteSample.run(numero, GLOBAL_SCOPE);
    await interaction.reply({ content: `🗑️ Échantillon n°${numero} retiré (de tous les serveurs).`, flags: MessageFlags.Ephemeral });
    await sendLog(
      interaction.guild,
      logEmbed('🚨 Échantillon scam retiré', `n°${numero} retiré par <@${interaction.user.id}>.`, COLORS.INFO)
    );
  },
};
