const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  InteractionContextType,
  ApplicationIntegrationType,
} = require('discord.js');
const { db } = require('../database');
const { GRADES } = require('../utils/permissions');

// Interactions façon Nekotina : GIF anime, compteur par duo, boutons
// « Rendre » / « Rejeter », badges par paliers envoyés en MP, et textes
// TRADUITS AUTOMATIQUEMENT selon la langue Discord de chaque utilisateur.

// ----- Traductions (fr / en / es / de, repli anglais) -----
const LOCALES = {
  fr: {
    actions: {
      kiss: { name: 'Bisous', phrase: (a, b) => `💋 **${a}** fait un bisou à **${b}** !`, count: (n) => `💞 Ils se sont embrassés **${n}** fois.`, back: '💋 Rendre le bisou' },
      peck: { name: 'Bisous', phrase: (a, b) => `😚 **${a}** fait un bisou sur la joue à **${b}** !`, count: (n) => `💞 Ils se sont embrassés **${n}** fois.`, back: '😚 Rendre le bisou' },
      hug: { name: 'Câlins', phrase: (a, b) => `🤗 **${a}** fait un câlin à **${b}** !`, count: (n) => `🫂 Ils se sont fait **${n}** câlins.`, back: '🤗 Rendre le câlin' },
      pat: { name: 'Caresses', phrase: (a, b) => `🖐️ **${a}** caresse doucement la tête de **${b}**.`, count: (n) => `✨ **${n}** caresses échangées.`, back: '🖐️ Caresser aussi' },
      bite: { name: 'Morsures', phrase: (a, b) => `😬 **${a}** mordille **${b}** !`, count: (n) => `🦷 **${n}** morsures échangées.`, back: '😬 Mordre aussi' },
      lick: { name: 'Léchouilles', phrase: (a, b) => `👅 **${a}** lèche **${b}**… coquin !`, count: (n) => `👅 **${n}** léchouilles échangées.`, back: '👅 Rendre la léchouille' },
    },
    reject: 'Rejeter',
    rejected: (a, b) => `💔 ${a} a rejeté l'interaction de ${b}… aïe.`,
    onlyTarget: '⛔ Seule la personne visée peut répondre à cette interaction.',
    self: '😅 Vous ne pouvez pas faire ça tout seul… choisissez quelqu\'un d\'autre !',
    otherBot: '🤖 Les autres bots n\'ont pas de sentiments… enfin je crois.',
    botAccept: '😳 *rougit* … accepté !',
    noGif: '⚠️ GIF momentanément indisponible',
    anime: 'Anime : ',
    badgeTitle: '🏅 Nouveau badge débloqué !',
    badgeDesc: (emoji, nom, action, n) => `${emoji} Badge **${nom}** — catégorie **${action}**\nVous avez utilisé cette interaction **${n}** fois. Continuez comme ça !`,
    badgesTitle: '🏅 Vos badges d\'interactions',
    badgesEmpty: 'Aucun badge pour le moment — utilisez `/interact` pour en débloquer (paliers : 10, 50, 100, 250, 500) !',
    uses: 'utilisations',
  },
  en: {
    actions: {
      kiss: { name: 'Kisses', phrase: (a, b) => `💋 **${a}** gives **${b}** a sweet kiss!`, count: (n) => `💞 They have kissed **${n}** times.`, back: '💋 Kiss back' },
      peck: { name: 'Kisses', phrase: (a, b) => `😚 **${a}** kisses **${b}** on the cheek!`, count: (n) => `💞 They have kissed **${n}** times.`, back: '😚 Kiss back' },
      hug: { name: 'Hugs', phrase: (a, b) => `🤗 **${a}** hugs **${b}**!`, count: (n) => `🫂 They have shared **${n}** hugs.`, back: '🤗 Hug back' },
      pat: { name: 'Pats', phrase: (a, b) => `🖐️ **${a}** gently pats **${b}**'s head.`, count: (n) => `✨ **${n}** headpats shared.`, back: '🖐️ Pat back' },
      bite: { name: 'Bites', phrase: (a, b) => `😬 **${a}** playfully bites **${b}**!`, count: (n) => `🦷 **${n}** bites exchanged.`, back: '😬 Bite back' },
      lick: { name: 'Licks', phrase: (a, b) => `👅 **${a}** licks **${b}**… cheeky!`, count: (n) => `👅 **${n}** licks exchanged.`, back: '👅 Lick back' },
    },
    reject: 'Reject',
    rejected: (a, b) => `💔 ${a} rejected ${b}'s interaction… ouch.`,
    onlyTarget: '⛔ Only the targeted person can respond to this interaction.',
    self: '😅 You can\'t do that alone… pick someone else!',
    otherBot: '🤖 Other bots don\'t have feelings… I think.',
    botAccept: '😳 *blushes* … accepted!',
    noGif: '⚠️ GIF temporarily unavailable',
    anime: 'Anime: ',
    badgeTitle: '🏅 New badge unlocked!',
    badgeDesc: (emoji, nom, action, n) => `${emoji} **${nom}** badge — **${action}** category\nYou have used this interaction **${n}** times. Keep it up!`,
    badgesTitle: '🏅 Your interaction badges',
    badgesEmpty: 'No badges yet — use `/interact` to unlock them (milestones: 10, 50, 100, 250, 500)!',
    uses: 'uses',
  },
  es: {
    actions: {
      kiss: { name: 'Besos', phrase: (a, b) => `💋 ¡**${a}** le da un beso a **${b}**!`, count: (n) => `💞 Se han besado **${n}** veces.`, back: '💋 Devolver el beso' },
      peck: { name: 'Besos', phrase: (a, b) => `😚 ¡**${a}** besa a **${b}** en la mejilla!`, count: (n) => `💞 Se han besado **${n}** veces.`, back: '😚 Devolver el beso' },
      hug: { name: 'Abrazos', phrase: (a, b) => `🤗 ¡**${a}** abraza a **${b}**!`, count: (n) => `🫂 Han compartido **${n}** abrazos.`, back: '🤗 Devolver el abrazo' },
      pat: { name: 'Caricias', phrase: (a, b) => `🖐️ **${a}** acaricia suavemente la cabeza de **${b}**.`, count: (n) => `✨ **${n}** caricias compartidas.`, back: '🖐️ Acariciar también' },
      bite: { name: 'Mordiscos', phrase: (a, b) => `😬 ¡**${a}** muerde juguetonamente a **${b}**!`, count: (n) => `🦷 **${n}** mordiscos intercambiados.`, back: '😬 Morder también' },
      lick: { name: 'Lametones', phrase: (a, b) => `👅 **${a}** lame a **${b}**… ¡pícaro!`, count: (n) => `👅 **${n}** lametones intercambiados.`, back: '👅 Devolver el lametón' },
    },
    reject: 'Rechazar',
    rejected: (a, b) => `💔 ${a} rechazó la interacción de ${b}… ay.`,
    onlyTarget: '⛔ Solo la persona señalada puede responder a esta interacción.',
    self: '😅 ¡No puedes hacer eso solo… elige a otra persona!',
    otherBot: '🤖 Los otros bots no tienen sentimientos… creo.',
    botAccept: '😳 *se sonroja* … ¡aceptado!',
    noGif: '⚠️ GIF temporalmente no disponible',
    anime: 'Anime: ',
    badgeTitle: '🏅 ¡Nueva insignia desbloqueada!',
    badgeDesc: (emoji, nom, action, n) => `${emoji} Insignia **${nom}** — categoría **${action}**\nHas usado esta interacción **${n}** veces. ¡Sigue así!`,
    badgesTitle: '🏅 Tus insignias de interacciones',
    badgesEmpty: '¡Aún no tienes insignias — usa `/interact` para desbloquearlas (niveles: 10, 50, 100, 250, 500)!',
    uses: 'usos',
  },
  de: {
    actions: {
      kiss: { name: 'Küsse', phrase: (a, b) => `💋 **${a}** gibt **${b}** einen Kuss!`, count: (n) => `💞 Sie haben sich **${n}** Mal geküsst.`, back: '💋 Zurückküssen' },
      peck: { name: 'Küsse', phrase: (a, b) => `😚 **${a}** küsst **${b}** auf die Wange!`, count: (n) => `💞 Sie haben sich **${n}** Mal geküsst.`, back: '😚 Zurückküssen' },
      hug: { name: 'Umarmungen', phrase: (a, b) => `🤗 **${a}** umarmt **${b}**!`, count: (n) => `🫂 Sie haben **${n}** Umarmungen geteilt.`, back: '🤗 Zurückumarmen' },
      pat: { name: 'Streicheln', phrase: (a, b) => `🖐️ **${a}** tätschelt sanft **${b}**s Kopf.`, count: (n) => `✨ **${n}** Streicheleinheiten geteilt.`, back: '🖐️ Auch streicheln' },
      bite: { name: 'Bisse', phrase: (a, b) => `😬 **${a}** beißt **${b}** verspielt!`, count: (n) => `🦷 **${n}** Bisse ausgetauscht.`, back: '😬 Zurückbeißen' },
      lick: { name: 'Lecken', phrase: (a, b) => `👅 **${a}** leckt **${b}**… frech!`, count: (n) => `👅 **${n}** Mal geleckt.`, back: '👅 Zurücklecken' },
    },
    reject: 'Ablehnen',
    rejected: (a, b) => `💔 ${a} hat die Interaktion von ${b} abgelehnt… autsch.`,
    onlyTarget: '⛔ Nur die angesprochene Person kann auf diese Interaktion antworten.',
    self: '😅 Das kannst du nicht alleine… wähle jemand anderen!',
    otherBot: '🤖 Andere Bots haben keine Gefühle… glaube ich.',
    botAccept: '😳 *errötet* … angenommen!',
    noGif: '⚠️ GIF vorübergehend nicht verfügbar',
    anime: 'Anime: ',
    badgeTitle: '🏅 Neues Abzeichen freigeschaltet!',
    badgeDesc: (emoji, nom, action, n) => `${emoji} Abzeichen **${nom}** — Kategorie **${action}**\nDu hast diese Interaktion **${n}** Mal benutzt. Weiter so!`,
    badgesTitle: '🏅 Deine Interaktions-Abzeichen',
    badgesEmpty: 'Noch keine Abzeichen — nutze `/interact`, um welche freizuschalten (Stufen: 10, 50, 100, 250, 500)!',
    uses: 'Nutzungen',
  },
};

function resolveLang(locale) {
  const code = String(locale || '').toLowerCase();
  if (code.startsWith('fr')) return 'fr';
  if (code.startsWith('es')) return 'es';
  if (code.startsWith('de')) return 'de';
  return 'en';
}

// ----- Badges par paliers d'utilisation (envoyés en MP) -----
const BADGE_LEVELS = [
  { seuil: 10, emoji: '🥉', noms: { fr: 'Bronze', en: 'Bronze', es: 'Bronce', de: 'Bronze' } },
  { seuil: 50, emoji: '🥈', noms: { fr: 'Argent', en: 'Silver', es: 'Plata', de: 'Silber' } },
  { seuil: 100, emoji: '🥇', noms: { fr: 'Or', en: 'Gold', es: 'Oro', de: 'Gold' } },
  { seuil: 250, emoji: '💎', noms: { fr: 'Platine', en: 'Platinum', es: 'Platino', de: 'Platin' } },
  { seuil: 500, emoji: '👑', noms: { fr: 'Légende', en: 'Legend', es: 'Leyenda', de: 'Legende' } },
];

const bumpPair = db.prepare(`
  INSERT INTO interactions (user_a, user_b, action, count) VALUES (?, ?, ?, 1)
  ON CONFLICT (user_a, user_b, action) DO UPDATE SET count = count + 1
`);
const getPair = db.prepare('SELECT count FROM interactions WHERE user_a = ? AND user_b = ? AND action = ?');
const bumpStat = db.prepare(`
  INSERT INTO interaction_stats (user_id, action, count) VALUES (?, ?, 1)
  ON CONFLICT (user_id, action) DO UPDATE SET count = count + 1
`);
const getStat = db.prepare('SELECT count FROM interaction_stats WHERE user_id = ? AND action = ?');
const listStats = db.prepare('SELECT * FROM interaction_stats WHERE user_id = ? ORDER BY count DESC');
const hasBadge = db.prepare('SELECT 1 FROM user_badges WHERE user_id = ? AND action = ? AND level = ?');
const insertBadge = db.prepare('INSERT INTO user_badges (user_id, action, level, earned_at) VALUES (?, ?, ?, ?)');
const listUserBadges = db.prepare('SELECT * FROM user_badges WHERE user_id = ? ORDER BY action, level');

function incrementCounter(idA, idB, action) {
  const [a, b] = [idA, idB].sort();
  bumpPair.run(a, b, action);
  return getPair.get(a, b, action).count;
}

// Attribue les badges nouvellement franchis et les envoie EN MP à l'utilisateur.
async function awardBadges(user, counterKey, totalUses, lang) {
  const L = LOCALES[lang];
  for (const level of BADGE_LEVELS) {
    if (totalUses < level.seuil) break;
    if (hasBadge.get(user.id, counterKey, level.seuil)) continue;
    insertBadge.run(user.id, counterKey, level.seuil, new Date().toISOString());
    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(L.badgeTitle)
      .setDescription(L.badgeDesc(level.emoji, level.noms[lang], L.actions[counterKey].name, level.seuil))
      .setTimestamp();
    await user.send({ embeds: [embed] }).catch(() => null); // MP fermés : tant pis
  }
}

// GIF depuis internet : trois sources essayées dans l'ordre, timeout 5 s
// chacune, et cause d'échec journalisée dans la console pour diagnostic.
async function fetchGif(category) {
  const simple = category === 'peck' ? 'kiss' : category;
  const sources = [
    {
      name: 'nekos.best',
      url: `https://nekos.best/api/v2/${category}`,
      parse: (data) => ({ url: data.results?.[0]?.url, anime: data.results?.[0]?.anime_name || null }),
    },
    {
      name: 'waifu.pics',
      url: `https://api.waifu.pics/sfw/${simple}`,
      parse: (data) => ({ url: data.url, anime: null }),
    },
    {
      name: 'otakugifs',
      url: `https://api.otakugifs.xyz/gif?reaction=${simple}`,
      parse: (data) => ({ url: data.url, anime: null }),
    },
  ];
  for (const source of sources) {
    try {
      const res = await fetch(source.url, {
        headers: { 'User-Agent': 'discord-roblox-rp-bot' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        console.warn(`⚠️ GIF ${source.name} (${category}) : HTTP ${res.status}`);
        continue;
      }
      const gif = source.parse(await res.json());
      if (gif.url) return gif;
      console.warn(`⚠️ GIF ${source.name} (${category}) : réponse sans URL`);
    } catch (err) {
      console.warn(`⚠️ GIF ${source.name} (${category}) : ${err.message}`);
    }
  }
  console.warn(`⚠️ Aucun GIF trouvé pour « ${category} » — les 3 sources ont échoué.`);
  return null;
}

function displayName(interaction, user) {
  if (interaction.guild) {
    const member = interaction.guild.members.cache.get(user.id);
    if (member) return member.displayName;
  }
  return user.displayName || user.username;
}

async function buildInteractionMessage(interaction, actionKey, author, target, withButtons, lang) {
  const L = LOCALES[lang];
  const action = L.actions[actionKey];
  const counterKey = actionKey === 'peck' ? 'kiss' : actionKey;
  const gif = await fetchGif(actionKey === 'peck' ? 'peck' : actionKey);
  const count = incrementCounter(author.id, target.id, counterKey);

  // Statistiques personnelles de l'auteur → badges par paliers, envoyés en MP.
  bumpStat.run(author.id, counterKey);
  const totalUses = getStat.get(author.id, counterKey).count;
  awardBadges(author, counterKey, totalUses, lang);

  const embed = new EmbedBuilder()
    .setColor(0xff6b81)
    .setDescription(`${action.phrase(displayName(interaction, author), displayName(interaction, target))}\n${action.count(count)}`);
  if (gif?.url) embed.setImage(gif.url);
  if (gif?.anime) embed.setFooter({ text: `${L.anime}${gif.anime}` });
  if (!gif?.url) embed.setFooter({ text: L.noGif });

  const payload = { content: `<@${target.id}>`, embeds: [embed] };
  if (withButtons) {
    payload.components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`itx:${actionKey}:${author.id}:${target.id}`)
          .setLabel(action.back)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`itxr:${actionKey}:${author.id}:${target.id}`)
          .setLabel(L.reject)
          .setEmoji('❌')
          .setStyle(ButtonStyle.Secondary)
      ),
    ];
  }
  return payload;
}

module.exports = {
  grade: GRADES.EVERYONE,
  public: true, // réponses visibles par tout le monde (pas d'éphémère)
  allowDm: true, // utilisable en message privé avec le bot
  userInstall: true, // installable sur un compte utilisateur → enregistrement GLOBAL
  data: new SlashCommandBuilder()
    .setName('interact')
    .setDescription('Interactions : bisous, câlins, caresses, morsures (GIF anime)')
    .setDescriptionLocalizations({ 'en-US': 'Interactions: kisses, hugs, pats, bites (anime GIFs)', 'en-GB': 'Interactions: kisses, hugs, pats, bites (anime GIFs)' })
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
    .addSubcommand((sub) =>
      sub
        .setName('kiss')
        .setDescription('Faire un bisou à quelqu\'un 💋')
        .setDescriptionLocalizations({ 'en-US': 'Give someone a sweet kiss 💋', 'en-GB': 'Give someone a sweet kiss 💋' })
        .addUserOption((o) => o.setName('membre').setDescription('À qui faire un bisou ?').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('endroit')
            .setDescription('Où ? (défaut : sur les lèvres)')
            .setRequired(false)
            .addChoices({ name: 'Sur les lèvres 💋', value: 'levres' }, { name: 'Sur la joue 😚', value: 'joue' })
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('hug')
        .setDescription('Faire un câlin à quelqu\'un 🤗')
        .setDescriptionLocalizations({ 'en-US': 'A little hug, perhaps? 🤗', 'en-GB': 'A little hug, perhaps? 🤗' })
        .addUserOption((o) => o.setName('membre').setDescription('À qui faire un câlin ?').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('pat')
        .setDescription('Caresser la tête de quelqu\'un 🖐️')
        .setDescriptionLocalizations({ 'en-US': 'Gently pat someone on the head 🖐️', 'en-GB': 'Gently pat someone on the head 🖐️' })
        .addUserOption((o) => o.setName('membre').setDescription('Qui caresser ?').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('bite')
        .setDescription('Mordiller quelqu\'un 😬')
        .setDescriptionLocalizations({ 'en-US': 'Playfully bite someone 😬', 'en-GB': 'Playfully bite someone 😬' })
        .addUserOption((o) => o.setName('membre').setDescription('Qui mordre ?').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('lick')
        .setDescription('Lécher quelqu\'un 👅')
        .setDescriptionLocalizations({ 'en-US': 'Lick someone in a cheeky way 👅', 'en-GB': 'Lick someone in a cheeky way 👅' })
        .addUserOption((o) => o.setName('membre').setDescription('Qui lécher ?').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('badges')
        .setDescription('Voir vos badges d\'interactions 🏅')
        .setDescriptionLocalizations({ 'en-US': 'View your interaction badges 🏅', 'en-GB': 'View your interaction badges 🏅' })
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const lang = resolveLang(interaction.locale);
    const L = LOCALES[lang];

    if (sub === 'badges') {
      const badges = listUserBadges.all(interaction.user.id);
      const stats = listStats.all(interaction.user.id);
      const embed = new EmbedBuilder().setColor(0xffd700).setTitle(L.badgesTitle);
      if (!badges.length && !stats.length) {
        embed.setDescription(L.badgesEmpty);
      } else {
        const byAction = new Map();
        for (const badge of badges) {
          if (!byAction.has(badge.action)) byAction.set(badge.action, []);
          const level = BADGE_LEVELS.find((lv) => lv.seuil === badge.level);
          if (level) byAction.get(badge.action).push(`${level.emoji} ${level.noms[lang]}`);
        }
        for (const stat of stats) {
          const actionName = L.actions[stat.action]?.name || stat.action;
          const earned = byAction.get(stat.action);
          embed.addFields({
            name: `${actionName} — ${stat.count} ${L.uses}`,
            value: earned?.length ? earned.join(' · ') : '—',
            inline: false,
          });
        }
      }
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getUser('membre');
    const actionKey = sub === 'kiss' && interaction.options.getString('endroit') === 'joue' ? 'peck' : sub;

    if (target.id === interaction.user.id) {
      return interaction.reply({ content: L.self, flags: MessageFlags.Ephemeral });
    }
    if (target.bot && target.id !== interaction.client.user.id) {
      return interaction.reply({ content: L.otherBot, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();
    // Pas de boutons si la cible est le bot lui-même (il accepte toujours 😊).
    const withButtons = target.id !== interaction.client.user.id;
    const payload = await buildInteractionMessage(interaction, actionKey, interaction.user, target, withButtons, lang);
    if (!withButtons) payload.content = L.botAccept;
    await interaction.editReply(payload);
  },

  // Boutons « Rendre » / « Rejeter » — réservés à la personne visée, dans SA langue.
  async handleButton(interaction) {
    try {
      const lang = resolveLang(interaction.locale);
      const L = LOCALES[lang];
      const [prefix, actionKey, fromId, toId] = interaction.customId.split(':');
      if (!L.actions[actionKey]) return;
      if (interaction.user.id !== toId) {
        return interaction.reply({ content: L.onlyTarget, flags: MessageFlags.Ephemeral });
      }
      if (prefix === 'itxr') {
        await interaction.update({ components: [] });
        await interaction.followUp({ content: L.rejected(`<@${toId}>`, `<@${fromId}>`) });
        return;
      }
      // « Rendre » : nouvelle interaction dans l'autre sens, boutons retirés de l'original.
      const author = interaction.user;
      const target = await interaction.client.users.fetch(fromId);
      await interaction.update({ components: [] });
      const payload = await buildInteractionMessage(interaction, actionKey, author, target, false, lang);
      await interaction.followUp(payload);
    } catch (err) {
      console.error('Erreur interaction :', err);
      const payload = { content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => null);
      else await interaction.reply(payload).catch(() => null);
    }
  },
};
