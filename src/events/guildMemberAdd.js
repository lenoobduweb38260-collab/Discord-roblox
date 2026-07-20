const { Events, EmbedBuilder } = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

const getGlobalBan = db.prepare('SELECT * FROM global_bans WHERE user_id = ?');

const ts = (date, style = 'F') => `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    // 1) Ban global : appliqué automatiquement dès l'arrivée sur n'importe quel serveur.
    const gban = getGlobalBan.get(member.id);
    if (gban) {
      await member.ban({ reason: `Ban global : ${gban.reason || 'Aucune raison'}` }).catch(() => null);
      await sendLog(
        member.guild,
        logEmbed(
          '🔨 Ban global appliqué',
          `<@${member.id}> (\`${member.id}\`) a été banni automatiquement à son arrivée.\n**Raison :** ${gban.reason || 'Aucune'}`,
          COLORS.DANGER
        )
      );
      return;
    }

    // 2) Embed d'arrivée dans le salon membres configuré.
    const cfg = getGuildConfig(member.guild.id);
    if (!cfg.member_channel_id) return;
    const channel = await member.guild.channels.fetch(cfg.member_channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle('📥 Arrivée d\'un membre')
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setDescription(`Bienvenue à <@${member.id}> sur **${member.guild.name}** ! 🎉`)
      .addFields(
        { name: '💬 Nom Discord', value: member.user.tag, inline: true },
        { name: '🔢 ID Discord', value: `\`${member.id}\``, inline: true },
        { name: '👥 Membre n°', value: `${member.guild.memberCount}`, inline: true },
        {
          name: '📅 Compte créé le',
          value: `${ts(member.user.createdAt)} (${ts(member.user.createdAt, 'R')})`,
          inline: false,
        }
      )
      .setTimestamp();
    await channel.send({ embeds: [embed] }).catch(() => null);
  },
};
