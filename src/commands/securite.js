const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../database');
const { COLORS, sendLog, logEmbed } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');

const onoff = (v) => (v ? '✅ activé' : '❌ désactivé');

module.exports = {
  grade: GRADES.ADMIN,
  data: new SlashCommandBuilder()
    .setName('securite')
    .setDescription('[Admin] Sécurité : anti-spam, anti-nuke et captcha')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('antispam')
        .setDescription('Anti-spam + filtre de messages malveillants')
        .addBooleanOption((o) => o.setName('actif').setDescription('Activer ou désactiver').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('antinuke')
        .setDescription('Anti-nuke (actions destructives massives)')
        .addBooleanOption((o) => o.setName('actif').setDescription('Activer ou désactiver').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('captcha')
        .setDescription('Captcha de vérification à l\'arrivée')
        .addBooleanOption((o) => o.setName('actif').setDescription('Activer ou désactiver').setRequired(true))
        .addRoleOption((o) => o.setName('role_verifie').setDescription('Rôle donné après vérification').setRequired(false))
        .addChannelOption((o) =>
          o.setName('salon').setDescription('Salon du captcha').addChannelTypes(ChannelType.GuildText).setRequired(false)
        )
    )
    .addSubcommand((sub) => sub.setName('statut').setDescription('Voir l\'état de la sécurité')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cfg = getGuildConfig(interaction.guildId);

    if (sub === 'statut') {
      const embed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setTitle('🛡️ Sécurité du serveur')
        .addFields(
          { name: 'Anti-spam + filtre', value: onoff(cfg.antispam_enabled), inline: true },
          { name: 'Anti-nuke', value: onoff(cfg.antinuke_enabled), inline: true },
          {
            name: 'Captcha',
            value:
              onoff(cfg.captcha_enabled) +
              (cfg.verified_role_id ? `\nRôle : <@&${cfg.verified_role_id}>` : '\n⚠️ aucun rôle vérifié défini') +
              (cfg.captcha_channel_id ? `\nSalon : <#${cfg.captcha_channel_id}>` : ''),
            inline: false,
          }
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'captcha') {
      const actif = interaction.options.getBoolean('actif');
      const role = interaction.options.getRole('role_verifie');
      const salon = interaction.options.getChannel('salon');
      setGuildConfig(interaction.guildId, 'captcha_enabled', actif ? 1 : 0);
      if (role) setGuildConfig(interaction.guildId, 'verified_role_id', role.id);
      if (salon) setGuildConfig(interaction.guildId, 'captcha_channel_id', salon.id);
      const warn = actif && !(role || cfg.verified_role_id) ? '\n⚠️ Définissez un **rôle vérifié** pour que le captcha serve à quelque chose.' : '';
      await interaction.reply({ content: `🤖 Captcha ${onoff(actif)}.${role ? ` Rôle : ${role}.` : ''}${salon ? ` Salon : ${salon}.` : ''}${warn}` });
    } else {
      const actif = interaction.options.getBoolean('actif');
      const key = sub === 'antispam' ? 'antispam_enabled' : 'antinuke_enabled';
      setGuildConfig(interaction.guildId, key, actif ? 1 : 0);
      await interaction.reply({ content: `🛡️ ${sub === 'antispam' ? 'Anti-spam + filtre' : 'Anti-nuke'} : ${onoff(actif)}.` });
    }
    await sendLog(
      interaction.guild,
      logEmbed('🛡️ Sécurité modifiée', `\`${sub}\` mis à jour par <@${interaction.user.id}>.`, COLORS.INFO)
    );
  },
};
