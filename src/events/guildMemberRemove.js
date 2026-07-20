const { Events, EmbedBuilder } = require('discord.js');
const { getGuildConfig } = require('../database');
const { COLORS } = require('../utils/embeds');

const ts = (date, style = 'F') => `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;

// Embed de départ : nom Discord, ID, photo de profil et surtout depuis quand
// le membre avait rejoint le serveur.
module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    const cfg = getGuildConfig(member.guild.id);
    if (!cfg.member_channel_id) return;
    const channel = await member.guild.channels.fetch(cfg.member_channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;

    const joinedAt = member.joinedAt; // peut être inconnu si le membre n'était pas en cache
    const embed = new EmbedBuilder()
      .setColor(COLORS.DANGER)
      .setTitle('📤 Départ d\'un membre')
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setDescription(`<@${member.id}> a quitté **${member.guild.name}**.`)
      .addFields(
        { name: '💬 Nom Discord', value: member.user.tag, inline: true },
        { name: '🔢 ID Discord', value: `\`${member.id}\``, inline: true },
        { name: '👥 Membres restants', value: `${member.guild.memberCount}`, inline: true },
        {
          name: '📅 Avait rejoint le serveur',
          value: joinedAt ? `${ts(joinedAt)} (${ts(joinedAt, 'R')})` : '*Date inconnue*',
          inline: false,
        }
      )
      .setTimestamp();
    await channel.send({ embeds: [embed] }).catch(() => null);
  },
};
