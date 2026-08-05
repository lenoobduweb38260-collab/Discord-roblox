const { Events, EmbedBuilder } = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

const getGlobalBan = db.prepare('SELECT * FROM global_bans WHERE user_id = ?');

const ts = (date, style = 'F') => `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    // 0) Immunité : le créateur et les IDs protégés ne sont jamais bannis
    // automatiquement (blacklist / ban global), même s'ils y figurent.
    const { getBlacklistRow, state, isImmune } = require('../utils/botTeam');
    if (await isImmune(member.client, member.id)) return;

    // 0 bis) Blacklist de l'équipe du bot : un blacklisté ne peut PAS rejoindre un
    // serveur où le système est actif — MP (raison + serveur de déban) puis ban.
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

    // 2) Captcha de vérification (si activé).
    await require('../utils/captcha').onJoin(member).catch(() => null);

    const cfg = getGuildConfig(member.guild.id);

    // 2 bis) 🎭 Rôles automatiques : attribués dès l'arrivée.
    // Si un captcha est actif, on n'attribue rien ici — c'est la validation du
    // captcha qui doit débloquer l'accès, sinon il ne servirait à rien.
    if (!cfg.captcha_enabled) {
      let roles = [];
      try { roles = JSON.parse(cfg.autorole_role_ids || '[]'); } catch {}
      const aDonner = roles
        .map(String)
        .filter((id) => {
          const role = member.guild.roles.cache.get(id);
          // Un rôle plus haut que le bot, ou géré par une intégration, est
          // impossible à donner : on l'ignore au lieu de tout faire échouer.
          return role && !role.managed && role.position < (member.guild.members.me?.roles.highest.position ?? 0);
        });
      if (aDonner.length) {
        await member.roles.add(aDonner, 'Rôle automatique à l\'arrivée').catch(() => null);
      }
    }

    // 3) Embed d'arrivée dans le salon membres configuré.
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
    // Apparence réglée depuis le site : couleur, titre, image de fond,
    // affichage de la photo de profil et des champs d'information.
    const couleur = /^#[0-9a-f]{6}$/i.test(cfg.welcome_color || '') ? cfg.welcome_color : COLORS.SUCCESS;
    const embed = new EmbedBuilder()
      .setColor(couleur)
      .setTitle(cfg.welcome_title?.trim() ? applyVars(cfg.welcome_title) : '📥 Arrivée d\'un membre')
      .setDescription(description)
      .setTimestamp();
    // Cadre de la photo de profil : vignette (rond), grande image, ou rien.
    const avatar = member.user.displayAvatarURL({ size: 256, extension: 'png' });
    if (cfg.welcome_avatar === 'grand') embed.setImage(avatar);
    else if (cfg.welcome_avatar !== 'aucun') embed.setThumbnail(avatar);
    // Image de fond : elle prend la grande place, la photo redevient vignette.
    if (cfg.welcome_image?.trim()) {
      embed.setImage(cfg.welcome_image.trim());
      if (cfg.welcome_avatar === 'grand') embed.setThumbnail(avatar);
    }
    if (cfg.welcome_fields !== 0) {
      embed.addFields(
        { name: '💬 Nom Discord', value: member.user.tag, inline: true },
        { name: '🔢 ID Discord', value: `\`${member.id}\``, inline: true },
        { name: '👥 Membre n°', value: `${member.guild.memberCount}`, inline: true },
        {
          name: '📅 Compte créé le',
          value: `${ts(member.user.createdAt)} (${ts(member.user.createdAt, 'R')})`,
          inline: false,
        }
      );
    }
    await channel
      .send({ content: cfg.welcome_mention ? `<@${member.id}>` : undefined, embeds: [embed] })
      .catch(() => null);
  },
};
