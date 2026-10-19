const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../database');
const { COLORS, sendLog, logEmbed } = require('../utils/embeds');
const { getGrade, GRADES } = require('../utils/permissions');
const { mettreAJour } = require('../utils/reponse');

// Partenariats : un membre propose un partenariat, le staff valide, puis le
// BOT publie le message de partenariat dans le salon configuré.
function proposalEmbed(interaction) {
  const nom = interaction.options.getString('nom');
  const desc = interaction.options.getString('description');
  const invite = interaction.options.getString('invitation');
  const logo = interaction.options.getString('logo');
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`🤝 Partenariat — ${nom}`.slice(0, 256))
    .setDescription(desc.slice(0, 2000))
    .setTimestamp();
  if (invite) embed.addFields({ name: '🔗 Lien', value: invite.slice(0, 1024) });
  if (logo && /^https?:\/\//.test(logo)) embed.setThumbnail(logo);
  embed.setFooter({ text: `Proposé par ${interaction.user.tag}` });
  return embed;
}

module.exports = {
  grade: GRADES.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('partenariat')
    .setDescription('Proposer un partenariat (le bot le publie après validation du staff)')
    .addSubcommand((sub) =>
      sub
        .setName('proposer')
        .setDescription('Proposer un partenariat')
        .addStringOption((o) => o.setName('nom').setDescription('Nom du serveur/partenaire').setRequired(true))
        .addStringOption((o) => o.setName('description').setDescription('Présentation du partenariat').setRequired(true))
        .addStringOption((o) => o.setName('invitation').setDescription('Lien d\'invitation').setRequired(false))
        .addStringOption((o) => o.setName('logo').setDescription('URL du logo').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('salon')
        .setDescription('[Admin] Définir le salon où le bot publie les partenariats')
        .addChannelOption((o) => o.setName('salon').setDescription('Salon des partenariats').addChannelTypes(ChannelType.GuildText).setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cfg = getGuildConfig(interaction.guildId);

    if (sub === 'salon') {
      if (getGrade(interaction.member, cfg) < GRADES.ADMIN) {
        return interaction.reply({ content: '⛔ Réservé à l\'administration.', flags: MessageFlags.Ephemeral });
      }
      const salon = interaction.options.getChannel('salon');
      setGuildConfig(interaction.guildId, 'partner_channel_id', salon.id);
      return interaction.reply({ content: `✅ Les partenariats validés seront publiés dans ${salon}.`, flags: MessageFlags.Ephemeral });
    }

    // proposer
    if (!cfg.partner_channel_id) {
      return interaction.reply({ content: '❌ Aucun salon de partenariats défini. Un admin doit faire `/partenariat salon`.', flags: MessageFlags.Ephemeral });
    }
    const embed = proposalEmbed(interaction);
    const reviewChannelId = cfg.staff_channel_id || cfg.log_channel_id || interaction.channelId;
    const reviewChannel = await interaction.guild.channels.fetch(reviewChannelId).catch(() => null);
    if (!reviewChannel?.isTextBased()) {
      return interaction.reply({ content: '❌ Salon de validation introuvable (configurez un salon staff).', flags: MessageFlags.Ephemeral });
    }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('partner:approve').setLabel('Valider & publier').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('partner:reject').setLabel('Refuser').setEmoji('❌').setStyle(ButtonStyle.Danger)
    );
    await reviewChannel.send({ content: `🤝 Proposition de partenariat de <@${interaction.user.id}> :`, embeds: [embed], components: [row] });
    return interaction.reply({ content: '✅ Proposition envoyée au staff pour validation.', flags: MessageFlags.Ephemeral });
  },

  // Boutons de validation staff (routés depuis interactionCreate).
  async handleButton(interaction) {
    const cfg = getGuildConfig(interaction.guildId);
    if (getGrade(interaction.member, cfg) < GRADES.STAFF) {
      return interaction.reply({ content: '⛔ Seul le staff peut valider un partenariat.', flags: MessageFlags.Ephemeral });
    }
    const action = interaction.customId.split(':')[1];
    const embed = interaction.message.embeds[0];
    if (action === 'reject') {
      await mettreAJour(interaction, { content: `❌ Partenariat refusé par <@${interaction.user.id}>.`, components: [] });
      return;
    }
    // approve
    if (!cfg.partner_channel_id) {
      return interaction.reply({ content: '❌ Aucun salon de partenariats défini (`/partenariat salon`).', flags: MessageFlags.Ephemeral });
    }
    const channel = await interaction.guild.channels.fetch(cfg.partner_channel_id).catch(() => null);
    if (!channel?.isTextBased()) {
      return interaction.reply({ content: '❌ Salon de partenariats introuvable.', flags: MessageFlags.Ephemeral });
    }
    await channel.send({ embeds: [EmbedBuilder.from(embed)] });
    await mettreAJour(interaction, { content: `✅ Partenariat validé par <@${interaction.user.id}> et publié dans <#${channel.id}>.`, components: [] });
    await sendLog(interaction.guild, logEmbed('🤝 Partenariat publié', `Validé par <@${interaction.user.id}>.`, COLORS.SUCCESS));
  },
};
