const { Events, EmbedBuilder } = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

const getGlobalBan = db.prepare('SELECT * FROM global_bans WHERE user_id = ?');

const ts = (date, style = 'F') => `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    // 0) Blacklist de l'équipe du bot : un blacklisté ne peut PAS rejoindre un
    // serveur où le système est actif — MP (raison + serveur de déban) puis ban.
    const { getBlacklistRow, state } = require('../utils/botTeam');
    const bl = getBlacklistRow.get(member.id);
    if (bl) {
      const debanInvite = state('deban_invite');
      await member
        .send(
          `🚫 Vous êtes **blacklisté** par l'équipe du bot : vous ne pouvez pas rejoindre **${member.guild.name}**.\n` +
            `**Raison :** ${bl.reason || 'Aucune raison précisée'}` +
            (debanInvite ? `\n🔓 **Serveur de déban (contestation) :** ${debanInvite}` : '')
        )
        .catch(() => null);
      await member.ban({ reason: `Blacklist du bot : ${bl.reason || 'Aucune raison'}` }).catch(() => null);
      await sendLog(
        member.guild,
        logEmbed(
          '🚫 Blacklist appliquée',
          `<@${member.id}> (\`${member.id}\`) est blacklisté par l'équipe du bot — banni à son arrivée.\n**Raison :** ${bl.reason || 'Aucune'}`,
          COLORS.DANGER
        )
      );
      return;
    }

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
    // Message personnalisé avec variables : {user} (mention), {user.username},
    // {server}, {membercount} — sinon message par défaut.
    const applyVars = (template) =>
      template
        .replace(/\{user\.username\}/g, member.user.username)
        .replace(/\{user\.mention\}|\{user\}/g, `<@${member.id}>`)
        .replace(/\{server\}/g, member.guild.name)
        .replace(/\{membercount\}/g, String(member.guild.memberCount));
    const description = cfg.welcome_message?.trim()
      ? applyVars(cfg.welcome_message)
      : `Bienvenue à <@${member.id}> sur **${member.guild.name}** ! 🎉`;
    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle('📥 Arrivée d\'un membre')
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setDescription(description)
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
    await channel
      .send({ content: cfg.welcome_mention ? `<@${member.id}>` : undefined, embeds: [embed] })
      .catch(() => null);
  },
};
