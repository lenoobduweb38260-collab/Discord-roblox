const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getLevels, getLeaderboard, levelFromXp } = require('../utils/levels');
const { COLORS } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');

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
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

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
