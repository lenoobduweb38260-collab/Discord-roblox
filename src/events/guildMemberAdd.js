const { Events, EmbedBuilder } = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const balises = require('../utils/balises');

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

    // 2 bis) 🎭 Rôles automatiques.
    // Avec un captcha actif, on ne donne RIEN ici : c'est sa validation qui
    // les attribuera (voir utils/captcha.js). Sans captcha, tout de suite —
    // pour que le membre ne reste pas « Visiteur » sans pouvoir agir.
    const autoRoles = require('../utils/autoRoles');
    if (!autoRoles.captchaActif(member.guild.id)) {
      await autoRoles.appliquer(member, 'Rôle automatique à l\'arrivée');
    }

    // 3) Embed d'arrivée dans le salon membres configuré.
    if (!cfg.member_channel_id) return;
    const channel = await member.guild.channels.fetch(cfg.member_channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    // Message personnalisé avec variables : {user} (mention), {user.username},
    // {server}, {membercount} — sinon message par défaut.
    // {regles} et {support} deviennent des liens vers les salons choisis dans
    // le site : écrire « lisez {regles} » suffit.
    const salonOu = (id, repli) => (id ? `<#${id}>` : repli);
    // Les balises d'abord : « && » devient une barre, « &> » une entrée de
    // liste. Un pseudo contenant « && » ne doit pas être pris pour une balise,
    // d'où l'ordre — balises, PUIS variables.
    const applyVars = (template) =>
      balises.appliquer(template)
        .replace(/\{user\.username\}/g, member.user.username)
        .replace(/\{user\.mention\}|\{user\}/g, `<@${member.id}>`)
        .replace(/\{server\}/g, member.guild.name)
        .replace(/\{membercount\}|\{numero\}/g, String(member.guild.memberCount))
        .replace(/\{regles\}/g, salonOu(cfg.welcome_rules_channel_id, 'le règlement'))
        .replace(/\{support\}/g, salonOu(cfg.welcome_help_channel_id, 'le salon d\'aide'));

    // 🎨 Deux mises en forme :
    //   • « classique » : le message tel qu'il est écrit ;
    //   • « detaille »  : présentation en sections (accueil, présentation du
    //     serveur, règlement, staff, fiche du membre), façon panneau d'accueil.
    const detaille = cfg.welcome_style === 'detaille';
    let description;
    if (cfg.welcome_message?.trim()) {
      description = applyVars(cfg.welcome_message);
    } else if (detaille) {
      const morceaux = [
        `Bienvenue sur le serveur **${member.guild.name}**`,
        '',
        `Salut <@${member.id}> ! Content de vous compter parmi nous.`,
        '',
        `Ce serveur rassemble sa communauté autour de **${member.guild.name}**, ` +
          'avec des échanges, des annonces et une bonne ambiance entre les membres.',
      ];
      if (cfg.welcome_rules_channel_id) {
        morceaux.push('', `📌 Avant de commencer, merci de prendre connaissance du <#${cfg.welcome_rules_channel_id}> ` +
          'et d\'adopter un comportement respectueux.');
      }
      if (cfg.welcome_help_channel_id) {
        morceaux.push('', `💡 Le staff reste disponible ici : <#${cfg.welcome_help_channel_id}> pour toute question.`);
      }
      morceaux.push('', `👤 **Membre** : ${member.user.username}`,
        `» **Membre n°${member.guild.memberCount}**`);
      description = morceaux.join('\n');
    } else {
      description = `Bienvenue à <@${member.id}> sur **${member.guild.name}** ! 🎉`;
    }
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
    // En style détaillé, ces informations sont déjà dans le texte : les
    // répéter en champs alourdirait l'embed pour rien.
    if (cfg.welcome_fields !== 0 && !detaille) {
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
    if (detaille) {
      embed.setAuthor({ name: `Bienvenue sur ${member.guild.name} !`, iconURL: member.guild.iconURL({ size: 128 }) || undefined });
      embed.setFooter({ text: `${member.client.user.username} • ${member.guild.name}` });
    }

    // 🖼️ Bannière fabriquée par le bot (image, seul moyen d'avoir une vraie
    // police). Si jimp manque ou échoue, l'embed part quand même.
    const fichiers = [];
    if (cfg.welcome_banner === 1) {
      const png = await require('../utils/welcomeBanner').fabriquer(member, {
        avatarUrl: avatar,
        fond: cfg.welcome_banner_color || cfg.welcome_color || '#1b1b2f',
        fondImage: cfg.welcome_image?.trim() || null,
        avatarRond: cfg.welcome_avatar !== 'grand',
      }).catch(() => null);
      if (png) {
        const { AttachmentBuilder } = require('discord.js');
        fichiers.push(new AttachmentBuilder(png, { name: 'bienvenue.png' }));
        embed.setImage('attachment://bienvenue.png');
      }
    }

    await channel
      .send({
        content: cfg.welcome_mention ? `<@${member.id}>` : undefined,
        embeds: [embed],
        files: fichiers.length ? fichiers : undefined,
      })
      .catch(() => null);
  },
};
