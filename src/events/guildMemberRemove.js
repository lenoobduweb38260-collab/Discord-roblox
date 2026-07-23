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
    // Salon de départ dédié si configuré, sinon le salon des arrivées.
    const channelId = cfg.goodbye_channel_id || cfg.member_channel_id;
    if (!channelId) return;
    const channel = await member.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const joinedAt = member.joinedAt; // peut être inconnu si le membre n'était pas en cache
    const applyVars = (template) =>
      template
        .replace(/\{user\.username\}/g, member.user.username)
        .replace(/\{user\.mention\}|\{user\}/g, `<@${member.id}>`)
        .replace(/\{server\}/g, member.guild.name)
        .replace(/\{membercount\}/g, String(member.guild.memberCount));
    const description = cfg.goodbye_message?.trim()
      ? applyVars(cfg.goodbye_message)
      : `<@${member.id}> a quitté **${member.guild.name}**.`;
    const embed = new EmbedBuilder()
      .setColor(COLORS.DANGER)
      .setTitle('📤 Départ d\'un membre')
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setDescription(description)
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
