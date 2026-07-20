const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  InteractionContextType,
} = require('discord.js');
const { db } = require('../database');
const { GRADES } = require('../utils/permissions');

// Interactions façon Nekotina : GIF anime récupéré sur internet (nekos.best
// avec le nom de l'anime, waifu.pics en secours), compteur par duo, boutons
// « Rendre » / « Rejeter » réservés à la personne visée. Fonctionne sur les
// serveurs ET en message privé avec le bot.

const ACTIONS = {
  kiss: {
    gif: 'kiss',
    counterKey: 'kiss',
    phrase: (a, b) => `💋 **${a}** fait un bisou à **${b}** !`,
    count: (n) => `💞 Ils se sont embrassés **${n}** fois.`,
    back: '💋 Rendre le bisou',
  },
  peck: {
    gif: 'peck',
    counterKey: 'kiss',
    phrase: (a, b) => `😚 **${a}** fait un bisou sur la joue à **${b}** !`,
    count: (n) => `💞 Ils se sont embrassés **${n}** fois.`,
    back: '😚 Rendre le bisou',
  },
  hug: {
    gif: 'hug',
    counterKey: 'hug',
    phrase: (a, b) => `🤗 **${a}** fait un câlin à **${b}** !`,
    count: (n) => `🫂 Ils se sont fait **${n}** câlins.`,
    back: '🤗 Rendre le câlin',
  },
  pat: {
    gif: 'pat',
    counterKey: 'pat',
    phrase: (a, b) => `🖐️ **${a}** caresse doucement la tête de **${b}**.`,
    count: (n) => `✨ **${n}** caresses échangées.`,
    back: '🖐️ Caresser aussi',
  },
  bite: {
    gif: 'bite',
    counterKey: 'bite',
    phrase: (a, b) => `😬 **${a}** mordille **${b}** !`,
    count: (n) => `🦷 **${n}** morsures échangées.`,
    back: '😬 Mordre aussi',
  },
  lick: {
    gif: 'lick',
    counterKey: 'lick',
    phrase: (a, b) => `👅 **${a}** lèche **${b}**… coquin !`,
    count: (n) => `👅 **${n}** léchouilles échangées.`,
    back: '👅 Rendre la léchouille',
  },
};

const bumpPair = db.prepare(`
  INSERT INTO interactions (user_a, user_b, action, count) VALUES (?, ?, ?, 1)
  ON CONFLICT (user_a, user_b, action) DO UPDATE SET count = count + 1
`);
const getPair = db.prepare('SELECT count FROM interactions WHERE user_a = ? AND user_b = ? AND action = ?');

function incrementCounter(idA, idB, action) {
  const [a, b] = [idA, idB].sort();
  bumpPair.run(a, b, action);
  return getPair.get(a, b, action).count;
}

// GIF depuis internet : nekos.best (avec nom de l'anime), waifu.pics en secours.
async function fetchGif(category) {
  try {
    const res = await fetch(`https://nekos.best/api/v2/${category}`);
    if (res.ok) {
      const data = await res.json();
      const result = data.results?.[0];
      if (result?.url) return { url: result.url, anime: result.anime_name || null };
    }
  } catch {}
  try {
    const fallback = category === 'peck' ? 'kiss' : category;
    const res = await fetch(`https://api.waifu.pics/sfw/${fallback}`);
    if (res.ok) {
      const data = await res.json();
      if (data.url) return { url: data.url, anime: null };
    }
  } catch {}
  return null;
}

function displayName(interaction, user) {
  if (interaction.guild) {
    const member = interaction.guild.members.cache.get(user.id);
    if (member) return member.displayName;
  }
  return user.displayName || user.username;
}

async function buildInteractionMessage(interaction, actionKey, author, target, withButtons) {
  const action = ACTIONS[actionKey];
  const gif = await fetchGif(action.gif);
  const count = incrementCounter(author.id, target.id, action.counterKey);
  const embed = new EmbedBuilder()
    .setColor(0xff6b81)
    .setDescription(
      `${action.phrase(displayName(interaction, author), displayName(interaction, target))}\n${action.count(count)}`
    );
  if (gif?.url) embed.setImage(gif.url);
  if (gif?.anime) embed.setFooter({ text: `Anime : ${gif.anime}` });
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
          .setLabel('Rejeter')
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
  data: new SlashCommandBuilder()
    .setName('interact')
    .setDescription('Interactions : bisous, câlins, caresses, morsures (GIF anime)')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .addSubcommand((sub) =>
      sub
        .setName('kiss')
        .setDescription('Faire un bisou à quelqu\'un 💋')
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
        .addUserOption((o) => o.setName('membre').setDescription('À qui faire un câlin ?').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('pat')
        .setDescription('Caresser la tête de quelqu\'un 🖐️')
        .addUserOption((o) => o.setName('membre').setDescription('Qui caresser ?').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('bite')
        .setDescription('Mordiller quelqu\'un 😬')
        .addUserOption((o) => o.setName('membre').setDescription('Qui mordre ?').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('lick')
        .setDescription('Lécher quelqu\'un 👅')
        .addUserOption((o) => o.setName('membre').setDescription('Qui lécher ?').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('membre');
    const actionKey = sub === 'kiss' && interaction.options.getString('endroit') === 'joue' ? 'peck' : sub;

    if (target.id === interaction.user.id) {
      return interaction.reply({
        content: '😅 Vous ne pouvez pas faire ça tout seul… choisissez quelqu\'un d\'autre !',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (target.bot && target.id !== interaction.client.user.id) {
      return interaction.reply({ content: '🤖 Les autres bots n\'ont pas de sentiments… enfin je crois.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();
    // Pas de boutons si la cible est le bot lui-même (il accepte toujours 😊).
    const withButtons = target.id !== interaction.client.user.id;
    const payload = await buildInteractionMessage(interaction, actionKey, interaction.user, target, withButtons);
    if (!withButtons) payload.content = '😳 *rougit* … accepté !';
    await interaction.editReply(payload);
  },

  // Boutons « Rendre » / « Rejeter » — réservés à la personne visée.
  async handleButton(interaction) {
    try {
      const [prefix, actionKey, fromId, toId] = interaction.customId.split(':');
      if (!ACTIONS[actionKey]) return;
      if (interaction.user.id !== toId) {
        return interaction.reply({
          content: '⛔ Seule la personne visée peut répondre à cette interaction.',
          flags: MessageFlags.Ephemeral,
        });
      }
      if (prefix === 'itxr') {
        await interaction.update({ components: [] });
        await interaction.followUp({
          content: `💔 <@${toId}> a rejeté l'interaction de <@${fromId}>… aïe.`,
        });
        return;
      }
      // « Rendre » : nouvelle interaction dans l'autre sens, boutons retirés de l'original.
      const author = interaction.user;
      const target = await interaction.client.users.fetch(fromId);
      await interaction.update({ components: [] });
      const payload = await buildInteractionMessage(interaction, actionKey, author, target, false);
      await interaction.followUp(payload);
    } catch (err) {
      console.error('Erreur interaction :', err);
      const payload = { content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => null);
      else await interaction.reply(payload).catch(() => null);
    }
  },
};
