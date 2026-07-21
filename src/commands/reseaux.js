const { SlashCommandBuilder, EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const {
  PLATFORMS,
  listGuildFeeds,
  getFeed,
  insertFeed,
  deleteFeed,
  resolveYouTubeChannel,
  fetchLatest,
} = require('../utils/socialWatch');

// /reseaux : promotion des réseaux sociaux — le bot annonce automatiquement
// les lives (Twitch) et les nouvelles vidéos/publications (YouTube, TikTok,
// X, Reddit) dans le salon choisi. Vérification toutes les 5 minutes.

const platformChoices = Object.entries(PLATFORMS).map(([value, p]) => ({ name: `${p.emoji} ${p.label}`, value }));

// Nettoie l'identifiant saisi selon la plateforme — le LIEN du compte/de la
// chaîne est valide (liens www., m., mobile. et pages profil acceptés).
function normalizeHandle(platform, raw) {
  let s = raw.trim();
  if (platform === 'twitch') {
    s = s.replace(/^https?:\/\/(www\.|m\.)?twitch\.tv\//i, '').split(/[/?#]/)[0];
    return s.replace(/^@/, '').toLowerCase();
  }
  if (platform === 'tiktok') {
    s = s.replace(/^https?:\/\/(www\.|m\.)?tiktok\.com\/@?/i, '').split(/[/?#]/)[0];
    return s.replace(/^@/, '');
  }
  if (platform === 'x') {
    s = s.replace(/^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\//i, '').split(/[/?#]/)[0];
    return s.replace(/^@/, '');
  }
  if (platform === 'reddit') {
    s = s.replace(/^https?:\/\/(www\.|old\.)?reddit\.com\//i, '').replace(/\/+$/, '');
    if (/^(r|u|user)\//i.test(s)) return s.split(/[?#]/)[0].split('/').slice(0, 2).join('/').replace(/^user\//i, 'u/').toLowerCase();
    return `r/${s.toLowerCase()}`;
  }
  return s; // youtube : résolu séparément
}

module.exports = {
  grade: GRADES.STAFF,
  data: new SlashCommandBuilder()
    .setName('reseaux')
    .setDescription('[Staff] Annonces automatiques des réseaux sociaux (lives, nouvelles vidéos…)')
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('Suivre une chaîne / un compte et annoncer ses nouveautés')
        .addStringOption((o) => o.setName('plateforme').setDescription('Plateforme').setRequired(true).addChoices(...platformChoices))
        .addStringOption((o) =>
          o.setName('identifiant').setDescription('Chaîne/compte : lien, @pseudo, ou r/subreddit').setRequired(true).setMaxLength(120)
        )
        .addChannelOption((o) =>
          o.setName('salon').setDescription('Salon des annonces').addChannelTypes(ChannelType.GuildText).setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName('message')
            .setDescription('Message personnalisé (variables : {nom} {titre} {lien}) — vide = message par défaut')
            .setRequired(false)
            .setMaxLength(500)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Ne plus suivre une chaîne / un compte')
        .addStringOption((o) => o.setName('flux').setDescription('Flux à retirer').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir les réseaux suivis sur ce serveur')),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const feeds = listGuildFeeds.all(interaction.guildId);
    await interaction.respond(
      feeds
        .map((f) => ({ name: `${PLATFORMS[f.platform]?.emoji || '📡'} ${PLATFORMS[f.platform]?.label || f.platform} — ${f.handle}`, value: String(f.id) }))
        .filter((c) => c.name.toLowerCase().includes(focused))
        .slice(0, 25)
    );
  },
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'liste') {
      const feeds = listGuildFeeds.all(interaction.guildId);
      const embed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setTitle('📡 Réseaux sociaux suivis')
        .setDescription(
          feeds.length
            ? feeds
                .map((f) => `• ${PLATFORMS[f.platform]?.emoji || '📡'} **${PLATFORMS[f.platform]?.label || f.platform}** — \`${f.handle}\` → <#${f.channel_id}>`)
                .join('\n')
            : '*Aucun réseau suivi — `/reseaux ajouter` pour commencer.*'
        )
        .setFooter({ text: 'Vérification toutes les 5 minutes • Lives Twitch et nouvelles vidéos/publications' });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'retirer') {
      const id = parseInt(interaction.options.getString('flux'), 10);
      const feed = Number.isNaN(id) ? null : getFeed.get(id);
      if (!feed || feed.guild_id !== interaction.guildId) {
        return interaction.reply({ content: '❌ Flux introuvable — choisissez-le dans la liste proposée.', flags: MessageFlags.Ephemeral });
      }
      deleteFeed.run(feed.id, interaction.guildId);
      await sendLog(
        interaction.guild,
        logEmbed('📡 Réseau retiré', `${PLATFORMS[feed.platform]?.label || feed.platform} — \`${feed.handle}\`\nPar <@${interaction.user.id}>`, COLORS.WARNING)
      );
      return interaction.reply(`🗑 **${PLATFORMS[feed.platform]?.label || feed.platform}** — \`${feed.handle}\` n'est plus suivi.`);
    }

    // ----- ajouter -----
    const platform = interaction.options.getString('plateforme');
    const rawId = interaction.options.getString('identifiant');
    const channel = interaction.options.getChannel('salon');
    const message = interaction.options.getString('message')?.trim() || null;

    await interaction.deferReply();

    let handle;
    let meta = null;
    if (platform === 'youtube') {
      // N'importe quel lien fonctionne : page de chaîne, @pseudo, vidéo,
      // youtu.be, short… — le bot retrouve la chaîne à partir du lien.
      const channelId = await resolveYouTubeChannel(rawId).catch(() => null);
      if (!channelId) {
        return interaction.editReply(
          '❌ Chaîne YouTube introuvable — collez le **lien de la chaîne** (ou d\'une de ses vidéos), son **@pseudo** ou son **ID** (commence par `UC`).'
        );
      }
      // Nom affiché : le vrai nom de la chaîne (titre de son flux RSS).
      const { fetchYouTubeTitle } = require('../utils/socialWatch');
      handle = (await fetchYouTubeTitle(channelId)) || rawId.match(/@[\w.-]+/)?.[0] || channelId;
      meta = JSON.stringify({ channelId });
    } else {
      handle = normalizeHandle(platform, rawId);
      if (!handle) return interaction.editReply('❌ Identifiant invalide.');
    }

    if (listGuildFeeds.all(interaction.guildId).some((f) => f.platform === platform && f.handle === handle)) {
      return interaction.editReply(`❌ ${PLATFORMS[platform].label} — \`${handle}\` est déjà suivi sur ce serveur.`);
    }
    if (listGuildFeeds.all(interaction.guildId).length >= 25) {
      return interaction.editReply('❌ Maximum 25 réseaux suivis par serveur.');
    }

    const info = insertFeed.run(interaction.guildId, platform, handle, channel.id, message, meta);

    // Test immédiat : vérifie que le flux répond (X et TikTok peuvent bloquer
    // ponctuellement les requêtes — le suivi reste actif malgré tout).
    const test = await fetchLatest(getFeed.get(Number(info.lastInsertRowid))).catch(() => null);
    const testNote = test
      ? platform === 'twitch'
        ? test.live
          ? '🔴 Actuellement **en live** — l\'annonce arrive dans quelques instants !'
          : '⚫ Actuellement hors ligne — l\'annonce partira au prochain live.'
        : '✅ Flux vérifié — seules les **nouvelles** publications seront annoncées.'
      : '⚠️ Flux injoignable pour le moment (la plateforme bloque peut-être les requêtes) — le bot réessaiera toutes les 5 minutes.';

    await sendLog(
      interaction.guild,
      logEmbed('📡 Réseau suivi', `${PLATFORMS[platform].label} — \`${handle}\` → <#${channel.id}>\nPar <@${interaction.user.id}>`, COLORS.SUCCESS)
    );
    return interaction.editReply(
      `${PLATFORMS[platform].emoji} **${PLATFORMS[platform].label}** — \`${handle}\` est maintenant suivi !\n` +
        `📣 Annonces dans ${channel}${message ? ' avec votre message personnalisé' : ''}.\n${testNote}`
    );
  },
};
