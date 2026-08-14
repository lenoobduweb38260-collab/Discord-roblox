const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getLevels, getLeaderboard, levelFromXp } = require('../utils/levels');
const { getGuildConfig, setGuildConfig } = require('../database');
const { COLORS } = require('../utils/embeds');
const { GRADES, getGrade } = require('../utils/permissions');

module.exports = {
  grade: GRADES.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('niveau')
    .setDescription('Système de niveaux (écrit et vocal réunis)')
    .addSubcommand((sub) =>
      sub
        .setName('voir')
        .setDescription('Voir le niveau d\'un membre')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre (défaut : vous)').setRequired(false))
    )
    .addSubcommand((sub) => sub.setName('classement').setDescription('Top 10 du serveur'))
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
      // 📊 Un seul niveau : l'écrit et le vocal alimentent le même compteur.
      const total = row.xp || 0;
      const p = levelFromXp(total);
      const barre = (() => {
        const pleins = p.needed ? Math.round((p.current / p.needed) * 12) : 0;
        return '▰'.repeat(pleins) + '▱'.repeat(Math.max(0, 12 - pleins));
      })();
      const embed = new EmbedBuilder()
        .setColor(COLORS.PRIMARY)
        .setTitle(`📊 Niveau de ${user.username}`)
        .setThumbnail(user.displayAvatarURL({ size: 128 }))
        .setDescription(
          `### Niveau **${p.level}**\n${barre}  ${p.current} / ${p.needed} XP\n` +
          `**${total} XP** au total — encore **${Math.max(0, p.needed - p.current)}** pour le niveau ${p.level + 1}.`
        )
        .addFields(
          { name: '✍️ Dont écrit', value: `${row.text_xp || 0} XP`, inline: true },
          { name: '🎙️ Dont vocal', value: `${row.voice_xp || 0} XP`, inline: true }
        );
      if (cfg.level_image_url) embed.setImage(cfg.level_image_url);
      return interaction.reply({ embeds: [embed] });
    }

    const rows = getLeaderboard(interaction.guildId, 10);
    if (!rows.length) {
      return interaction.reply({ content: '❌ Aucune donnée de niveau pour le moment.', flags: MessageFlags.Ephemeral });
    }
    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((row, i) =>
      `${medals[i] || `**${i + 1}.**`} <@${row.user_id}> — niveau **${row.level || 0}** (${row.xp || 0} XP)`
    );
    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle('🏆 Classement du serveur')
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Écrit et vocal réunis en un seul niveau.' });
    return interaction.reply({ embeds: [embed] });
  },
};
