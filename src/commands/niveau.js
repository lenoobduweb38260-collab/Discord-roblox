const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getLevels, getLeaderboard, levelFromXp } = require('../utils/levels');
const { getGuildConfig, setGuildConfig } = require('../database');
const { COLORS } = require('../utils/embeds');
const { GRADES, getGrade } = require('../utils/permissions');

module.exports = {
  grade: GRADES.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('niveau')
    .setDescription('Système de niveaux (écrit et vocal)')
    .addSubcommand((sub) =>
      sub
        .setName('voir')
        .setDescription('Voir le niveau d\'un membre')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre (défaut : vous)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('classement')
        .setDescription('Top 10 du serveur')
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Type de classement')
            .setRequired(true)
            .addChoices({ name: '✍️ Écrit', value: 'text' }, { name: '🎙️ Vocal', value: 'voice' })
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('image')
        .setDescription('[Staff] Image de fond des cartes de niveau (vide = retirer)')
        .addStringOption((o) => o.setName('url').setDescription('URL de l\'image (laisser vide pour retirer)').setRequired(false))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cfg = getGuildConfig(interaction.guildId);

    if (sub === 'image') {
      if (getGrade(interaction.member, cfg) < GRADES.STAFF) {
        return interaction.reply({ content: '⛔ Réservé au staff.', flags: MessageFlags.Ephemeral });
      }
      const url = interaction.options.getString('url')?.trim() || null;
      if (url && !/^https?:\/\//.test(url)) {
        return interaction.reply({ content: '❌ URL invalide (doit commencer par http).', flags: MessageFlags.Ephemeral });
      }
      setGuildConfig(interaction.guildId, 'level_image_url', url);
      return interaction.reply({ content: url ? '✅ Image des cartes de niveau mise à jour.' : '🧹 Image des cartes de niveau retirée.', flags: MessageFlags.Ephemeral });
    }

    if (sub === 'voir') {
      const user = interaction.options.getUser('utilisateur') || interaction.user;
      const row = getLevels(interaction.guildId, user.id);
      const text = levelFromXp(row.text_xp);
      const voice = levelFromXp(row.voice_xp);
      const embed = new EmbedBuilder()
        .setColor(COLORS.PRIMARY)
        .setTitle(`📊 Niveaux de ${user.username}`)
        .setThumbnail(user.displayAvatarURL({ size: 128 }))
        .addFields(
          {
            name: '✍️ Écrit',
            value: `Niveau **${text.level}**\nXP : ${row.text_xp} (${text.current}/${text.needed} vers le niv. ${text.level + 1})`,
            inline: true,
          },
          {
            name: '🎙️ Vocal',
            value: `Niveau **${voice.level}**\nXP : ${row.voice_xp} (${voice.current}/${voice.needed} vers le niv. ${voice.level + 1})`,
            inline: true,
          }
        );
      if (cfg.level_image_url) embed.setImage(cfg.level_image_url);
      return interaction.reply({ embeds: [embed] });
    }

    const type = interaction.options.getString('type');
    const rows = getLeaderboard(interaction.guildId, type, 10);
    if (!rows.length) {
      return interaction.reply({ content: '❌ Aucune donnée de niveau pour le moment.', flags: MessageFlags.Ephemeral });
    }
    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((row, i) => {
      const xp = type === 'voice' ? row.voice_xp : row.text_xp;
      const level = type === 'voice' ? row.voice_level : row.text_level;
      return `${medals[i] || `**${i + 1}.**`} <@${row.user_id}> — niveau **${level}** (${xp} XP)`;
    });
    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle(type === 'voice' ? '🎙️ Classement vocal' : '✍️ Classement écrit')
      .setDescription(lines.join('\n'));
    return interaction.reply({ embeds: [embed] });
  },
};
