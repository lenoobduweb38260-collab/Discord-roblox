const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../database');
const { COLORS, sendLog, logEmbed } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');

function show(id, kind) {
  if (!id) return '*Non configuré*';
  return kind === 'role' ? `<@&${id}>` : `<#${id}>`;
}

module.exports = {
  // Sécurité grade élevé : la configuration entière est réservée à l'administration.
  grade: GRADES.ADMIN,
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('[Admin] Configuration complète du bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('roles')
        .setDescription('Configurer les rôles (staff, admin, en service)')
        .addRoleOption((o) => o.setName('staff').setDescription('Rôle staff (grade 2)').setRequired(false))
        .addRoleOption((o) => o.setName('admin').setDescription('Rôle administration (grade 3)').setRequired(false))
        .addRoleOption((o) => o.setName('service').setDescription('Rôle "En service" (ajouté/retiré par /service)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('salons')
        .setDescription('Configurer les salons (logs, niveaux, service, staff)')
        .addChannelOption((o) =>
          o.setName('logs').setDescription('Salon des logs de sécurité').addChannelTypes(ChannelType.GuildText).setRequired(false)
        )
        .addChannelOption((o) =>
          o.setName('niveaux').setDescription('Salon des annonces de niveau').addChannelTypes(ChannelType.GuildText).setRequired(false)
        )
        .addChannelOption((o) =>
          o.setName('service').setDescription('Salon des prises/fins de service').addChannelTypes(ChannelType.GuildText).setRequired(false)
        )
        .addChannelOption((o) =>
          o.setName('staff').setDescription('Salon des arrivées/départs staff').addChannelTypes(ChannelType.GuildText).setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('xp')
        .setDescription('Configurer le système d\'XP')
        .addIntegerOption((o) =>
          o.setName('texte').setDescription('XP par message (défaut 20)').setMinValue(1).setMaxValue(1000).setRequired(false)
        )
        .addIntegerOption((o) =>
          o.setName('vocal').setDescription('XP par minute en vocal (défaut 10)').setMinValue(1).setMaxValue(1000).setRequired(false)
        )
        .addIntegerOption((o) =>
          o.setName('cooldown').setDescription('Cooldown XP texte en secondes (défaut 60)').setMinValue(5).setMaxValue(3600).setRequired(false)
        )
    )
    .addSubcommand((sub) => sub.setName('voir').setDescription('Voir la configuration actuelle')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const changes = [];

    if (sub === 'roles') {
      const staff = interaction.options.getRole('staff');
      const admin = interaction.options.getRole('admin');
      const service = interaction.options.getRole('service');
      if (staff) { setGuildConfig(interaction.guildId, 'staff_role_id', staff.id); changes.push(`Rôle staff → ${staff}`); }
      if (admin) { setGuildConfig(interaction.guildId, 'admin_role_id', admin.id); changes.push(`Rôle admin → ${admin}`); }
      if (service) { setGuildConfig(interaction.guildId, 'service_role_id', service.id); changes.push(`Rôle service → ${service}`); }
    } else if (sub === 'salons') {
      const logs = interaction.options.getChannel('logs');
      const niveaux = interaction.options.getChannel('niveaux');
      const service = interaction.options.getChannel('service');
      const staff = interaction.options.getChannel('staff');
      if (logs) { setGuildConfig(interaction.guildId, 'log_channel_id', logs.id); changes.push(`Salon logs → ${logs}`); }
      if (niveaux) { setGuildConfig(interaction.guildId, 'level_channel_id', niveaux.id); changes.push(`Salon niveaux → ${niveaux}`); }
      if (service) { setGuildConfig(interaction.guildId, 'service_channel_id', service.id); changes.push(`Salon service → ${service}`); }
      if (staff) { setGuildConfig(interaction.guildId, 'staff_channel_id', staff.id); changes.push(`Salon staff → ${staff}`); }
    } else if (sub === 'xp') {
      const texte = interaction.options.getInteger('texte');
      const vocal = interaction.options.getInteger('vocal');
      const cooldown = interaction.options.getInteger('cooldown');
      if (texte !== null) { setGuildConfig(interaction.guildId, 'xp_text', texte); changes.push(`XP texte → ${texte}/message`); }
      if (vocal !== null) { setGuildConfig(interaction.guildId, 'xp_voice', vocal); changes.push(`XP vocal → ${vocal}/minute`); }
      if (cooldown !== null) { setGuildConfig(interaction.guildId, 'xp_cooldown', cooldown); changes.push(`Cooldown XP → ${cooldown}s`); }
    }

    if (sub !== 'voir') {
      if (!changes.length) {
        return interaction.reply({ content: '❌ Aucune option fournie, rien n\'a été modifié.', flags: MessageFlags.Ephemeral });
      }
      await interaction.reply({ content: `✅ Configuration mise à jour :\n${changes.map((c) => `• ${c}`).join('\n')}` });
      await sendLog(
        interaction.guild,
        logEmbed('⚙️ Configuration modifiée', `Par <@${interaction.user.id}> :\n${changes.map((c) => `• ${c}`).join('\n')}`, COLORS.INFO)
      );
      return;
    }

    const cfg = getGuildConfig(interaction.guildId);
    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle('⚙️ Configuration du serveur')
      .addFields(
        {
          name: '👮 Rôles',
          value: [
            `Staff : ${show(cfg.staff_role_id, 'role')}`,
            `Admin : ${show(cfg.admin_role_id, 'role')}`,
            `En service : ${show(cfg.service_role_id, 'role')}`,
          ].join('\n'),
          inline: false,
        },
        {
          name: '📢 Salons',
          value: [
            `Logs sécurité : ${show(cfg.log_channel_id, 'channel')}`,
            `Niveaux : ${show(cfg.level_channel_id, 'channel')}`,
            `Service : ${show(cfg.service_channel_id, 'channel')}`,
            `Staff (arrivées/départs) : ${show(cfg.staff_channel_id, 'channel')}`,
          ].join('\n'),
          inline: false,
        },
        {
          name: '📈 XP',
          value: [
            `Texte : ${cfg.xp_text} XP/message (cooldown ${cfg.xp_cooldown}s)`,
            `Vocal : ${cfg.xp_voice} XP/minute`,
          ].join('\n'),
          inline: false,
        },
        {
          name: '📋 Whitelist métiers',
          value: 'Voir `/whitelist roles` — configuration via `/whitelist config ajouter`',
          inline: false,
        }
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
