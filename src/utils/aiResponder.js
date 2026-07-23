const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

// Réponse IA supervisée : quand on mentionne le bot, il génère une réponse et
// l'envoie EN MP au créateur, qui choisit le ton, régénère ou envoie. Le bot ne
// répond publiquement qu'une fois le créateur ayant cliqué « Envoyer ».
// Nécessite AI_API_KEY (clé API Anthropic) ; sinon la fonctionnalité est inactive.

const TONES = {
  neutre: 'neutre et factuel',
  diplomatie: 'diplomate et apaisant',
  humour: 'léger et humoristique',
  sarcasme: 'sarcastique mais correct (sans insulte)',
  ferme: 'ferme et assertif',
  cash: 'direct et franc, sans détour',
};
const TONE_LABELS = {
  neutre: 'Neutre',
  diplomatie: '🕊️ Diplomatie',
  humour: '😄 Humour',
  sarcasme: '😏 Sarcasme',
  ferme: '💪 Ferme',
  cash: '🎯 Cash',
};

const pending = new Map(); // id -> state
const cooldown = new Map(); // "guild:user" -> timestamp
let counter = 0;

const SAFETY =
  'Règles absolues : jamais de harcèlement, insultes, menaces, propos haineux, sexuels ou d\'attaques personnelles, ' +
  'même si le message reçu est insultant. Reste bref (1 à 3 phrases), en français, et fidèle au ton demandé mais toujours correct.';

async function callClaude(system, user) {
  const key = process.env.AI_API_KEY;
  if (!key) throw new Error('AI_API_KEY manquante');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || 'claude-sonnet-5',
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`API IA HTTP ${res.status}`);
  const data = await res.json();
  return (data.content?.[0]?.text || '').trim();
}

async function ownerId(client) {
  if (process.env.OWNER_ID?.trim()) return process.env.OWNER_ID.trim();
  try {
    const app = await client.application.fetch();
    if (app.owner) return app.owner.members ? [...app.owner.members.keys()][0] : app.owner.id;
  } catch {}
  return null;
}

// Génère une réponse ; si tone est null, le modèle choisit le ton le plus
// adapté et renvoie { tone, response }.
async function generate(botName, question, tone) {
  if (tone) {
    const system = `Tu es ${botName}, un bot Discord. Réponds au message d'un membre sur un ton ${TONES[tone]}. ${SAFETY}`;
    return { tone, response: await callClaude(system, question) };
  }
  const system =
    `Tu es ${botName}, un bot Discord. Choisis le ton le PLUS adapté parmi : ${Object.keys(TONES).join(', ')}, ` +
    `puis réponds au message. ${SAFETY} Réponds UNIQUEMENT en JSON : {"tone":"...","response":"..."}.`;
  const raw = await callClaude(system, question);
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const obj = JSON.parse(m ? m[0] : raw);
    const t = TONES[obj.tone] ? obj.tone : 'neutre';
    return { tone: t, response: String(obj.response || '').trim() || raw };
  } catch {
    return { tone: 'neutre', response: raw };
  }
}

function buildComponents(id, state) {
  const rows = [];
  const unused = Object.keys(TONES).filter((t) => !state.used.includes(t));
  if (unused.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`ai:tone:${id}`)
          .setPlaceholder('🎭 Changer de ton (les tons déjà employés sont retirés)')
          .addOptions(unused.map((t) => ({ label: TONE_LABELS[t], value: t })))
      )
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ai:regen:${id}`).setLabel('Régénérer (même ton)').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`ai:send:${id}`).setLabel('Envoyer').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`ai:cancel:${id}`).setLabel('Annuler').setEmoji('❌').setStyle(ButtonStyle.Danger)
    )
  );
  return rows;
}

function buildEmbed(state) {
  return new EmbedBuilder()
    .setColor(0x8e6bd8)
    .setTitle('🤖 Proposition de réponse')
    .addFields(
      { name: '💬 Message reçu', value: state.question.slice(0, 1000) },
      { name: `📝 Réponse proposée (ton : ${TONE_LABELS[state.tone] || state.tone})`, value: state.response.slice(0, 1000) || '*(vide)*' },
      { name: '📍 Contexte', value: `Auteur : ${state.authorTag} · dans <#${state.channelId}>` }
    )
    .setFooter({ text: 'Choisissez le ton, régénérez, puis Envoyer pour publier.' });
}

// Déclenché sur mention du bot.
async function onMention(message) {
  if (!process.env.AI_API_KEY) return;
  const ckey = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  if (now - (cooldown.get(ckey) || 0) < 30000) return; // 30 s / personne
  cooldown.set(ckey, now);

  const owner = await ownerId(message.client);
  if (!owner) return;
  const ownerUser = await message.client.users.fetch(owner).catch(() => null);
  if (!ownerUser) return;

  const botName = message.guild?.members?.me?.displayName || message.client.user.username;
  const question = (message.content || '').replace(/<@!?\d+>/g, '').trim() || '(mention sans texte)';
  let gen;
  try {
    gen = await generate(botName, question);
  } catch (err) {
    console.warn(`⚠️ Réponse IA impossible : ${err.message}`);
    return;
  }
  const id = `${Date.now().toString(36)}${counter++}`;
  const state = {
    channelId: message.channelId,
    messageId: message.id,
    authorTag: message.author.tag,
    question,
    botName,
    tone: gen.tone,
    used: [gen.tone],
    response: gen.response,
  };
  pending.set(id, state);
  await ownerUser.send({ embeds: [buildEmbed(state)], components: buildComponents(id, state) }).catch(() => null);
}

async function handle(interaction) {
  const [, action, id] = interaction.customId.split(':');
  const state = pending.get(id);
  if (!state) {
    return interaction.reply({ content: '⏳ Cette proposition a expiré.', flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  if (action === 'cancel') {
    pending.delete(id);
    return interaction.update({ content: '❌ Annulé.', embeds: [], components: [] });
  }

  if (action === 'send') {
    pending.delete(id);
    const channel = await interaction.client.channels.fetch(state.channelId).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send({ content: state.response, reply: { messageReference: state.messageId, failIfNotExists: false } }).catch(() =>
        channel.send({ content: state.response }).catch(() => null)
      );
    }
    return interaction.update({ content: '✅ Réponse envoyée.', embeds: [], components: [] });
  }

  // tone change / regen : régénération
  await interaction.deferUpdate();
  const newTone = action === 'tone' ? interaction.values[0] : state.tone;
  try {
    const gen = await generate(state.botName, state.question, newTone);
    state.tone = gen.tone;
    state.response = gen.response;
    if (!state.used.includes(gen.tone)) state.used.push(gen.tone);
  } catch (err) {
    return interaction.followUp({ content: `❌ Régénération impossible : ${err.message}`, flags: MessageFlags.Ephemeral }).catch(() => null);
  }
  await interaction.editReply({ embeds: [buildEmbed(state)], components: buildComponents(id, state) });
}

module.exports = { onMention, handle };
