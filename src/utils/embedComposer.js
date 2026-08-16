const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const balises = require('./balises');
const { mettreAJour } = require('./reponse');

// Éditeur d'embed/message avec APERÇU EN DIRECT : le message affiché dans
// l'éditeur (éphémère) est exactement celui qui sera envoyé. À chaque
// modification, l'aperçu se met à jour. Puis on choisit le salon et on envoie.
// Réutilisable par n'importe quelle commande qui envoie un message dans un salon.

const drafts = new Map(); // id -> state
let counter = 0;

function parseColor(v) {
  const m = String(v || '').trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? parseInt(m[1], 16) : null;
}
// Tout texte écrit par un membre passe par les balises : « && » devient une
// barre, « &> » une entrée de liste. Un texte sans balise ressort identique.
const nl = (s) => (s ? balises.appliquer(s) : s);

// Construit le payload réel (contenu + embed) à partir de l'état.
function render(state) {
  const hasEmbed = state.title || state.description || state.image || state.thumbnail || state.footer || state.author;
  const payload = { content: nl(state.text) || '', embeds: [] };
  if (hasEmbed) {
    const embed = new EmbedBuilder().setColor(state.color ?? 0x5865f2);
    if (state.author) embed.setAuthor({ name: String(state.author).slice(0, 256) });
    if (state.title) embed.setTitle(nl(state.title).slice(0, 256));
    if (state.description) embed.setDescription(nl(state.description).slice(0, 4096));
    if (state.image) embed.setImage(state.image);
    if (state.thumbnail) embed.setThumbnail(state.thumbnail);
    if (state.footer) embed.setFooter({ text: nl(state.footer).slice(0, 2048) });
    payload.embeds.push(embed);
  }
  return payload;
}

function isEmpty(state) {
  return !(state.text || state.title || state.description || state.image || state.thumbnail || state.footer || state.author);
}

function controls(id, state) {
  const target = state.targetChannelId ? `<#${state.targetChannelId}>` : '*aucun salon choisi*';
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`emb:txt:${id}`).setLabel('Texte & titre').setEmoji('✏️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`emb:sty:${id}`).setLabel('Couleur & images').setEmoji('🎨').setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`emb:ch:${id}`)
        .setPlaceholder(`📍 Salon d'envoi (${state.targetChannelId ? 'choisi' : 'à choisir'})`)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`emb:snd:${id}`).setLabel('Envoyer').setEmoji('📤').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`emb:cxl:${id}`).setLabel('Annuler').setEmoji('❌').setStyle(ButtonStyle.Danger)
    ),
  ];
  return { rows, target };
}

function editorPayload(id, state) {
  const preview = render(state);
  const { rows } = controls(id, state);
  // Le rappel des balises est là où l'on écrit : une mise en forme qu'on ne
  // connaît pas ne sert à personne.
  const header =
    `🔎 **Aperçu en direct** — voici exactement ce qui sera envoyé${state.targetChannelId ? ` dans <#${state.targetChannelId}>` : ''} :\n` +
    '-# 🏷️ En début de ligne : `&&` une barre · `&& Titre` une section · `&>` une entrée · `\\n` un saut de ligne';
  return {
    content: `${header}\n${preview.content || ''}`.slice(0, 2000),
    embeds: preview.embeds,
    components: rows,
    flags: MessageFlags.Ephemeral,
  };
}

// Démarre l'éditeur (réponse éphémère). initial = champs pré-remplis éventuels.
async function start(interaction, initial = {}) {
  const id = `${Date.now().toString(36)}${counter++}`;
  drafts.set(id, {
    text: initial.text || '',
    title: initial.title || '',
    description: initial.description || '',
    color: initial.color ?? null,
    image: initial.image || '',
    thumbnail: initial.thumbnail || '',
    footer: initial.footer || '',
    author: initial.author || '',
    targetChannelId: initial.channelId || null,
  });
  return interaction.reply(editorPayload(id, drafts.get(id)));
}

async function handle(interaction) {
  const parts = interaction.customId.split(':');
  const kind = parts[0]; // emb | embm
  const action = parts[1];
  const id = parts[2];
  const state = drafts.get(id);
  if (!state) {
    return interaction.reply({ content: '⏳ Cet éditeur a expiré. Relancez la commande.', flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  // Ouverture des modaux
  if (kind === 'emb' && action === 'txt') {
    const modal = new ModalBuilder().setCustomId(`embm:txt:${id}`).setTitle('Texte & titre');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('Message au-dessus (facultatif)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1800).setValue(state.text || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Titre de l\'embed (facultatif)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setValue(state.title || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description (\\n = saut de ligne)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000).setValue(state.description || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('footer').setLabel('Pied de page (facultatif)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2048).setValue(state.footer || ''))
    );
    return interaction.showModal(modal);
  }
  if (kind === 'emb' && action === 'sty') {
    const modal = new ModalBuilder().setCustomId(`embm:sty:${id}`).setTitle('Couleur & images');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel('Couleur hex (ex : #5865F2)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7).setValue(state.color != null ? `#${state.color.toString(16).padStart(6, '0')}` : '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('URL grande image (facultatif)').setStyle(TextInputStyle.Short).setRequired(false).setValue(state.image || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('thumbnail').setLabel('URL miniature (facultatif)').setStyle(TextInputStyle.Short).setRequired(false).setValue(state.thumbnail || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('author').setLabel('Auteur en haut (facultatif)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setValue(state.author || ''))
    );
    return interaction.showModal(modal);
  }

  // Soumission des modaux → maj + aperçu
  if (kind === 'embm' && action === 'txt') {
    state.text = interaction.fields.getTextInputValue('text');
    state.title = interaction.fields.getTextInputValue('title');
    state.description = interaction.fields.getTextInputValue('description');
    state.footer = interaction.fields.getTextInputValue('footer');
    return mettreAJour(interaction, editorPayload(id, state));
  }
  if (kind === 'embm' && action === 'sty') {
    state.color = parseColor(interaction.fields.getTextInputValue('color'));
    state.image = interaction.fields.getTextInputValue('image').trim();
    state.thumbnail = interaction.fields.getTextInputValue('thumbnail').trim();
    state.author = interaction.fields.getTextInputValue('author');
    return mettreAJour(interaction, editorPayload(id, state));
  }

  // Choix du salon
  if (kind === 'emb' && action === 'ch') {
    state.targetChannelId = interaction.values[0];
    return mettreAJour(interaction, editorPayload(id, state));
  }

  if (kind === 'emb' && action === 'cxl') {
    drafts.delete(id);
    return mettreAJour(interaction, { content: '❌ Annulé.', embeds: [], components: [] });
  }

  if (kind === 'emb' && action === 'snd') {
    if (isEmpty(state)) return interaction.reply({ content: '❌ Le message est vide.', flags: MessageFlags.Ephemeral });
    if (!state.targetChannelId) return interaction.reply({ content: '❌ Choisissez un salon d\'envoi.', flags: MessageFlags.Ephemeral });
    const channel = await interaction.client.channels.fetch(state.targetChannelId).catch(() => null);
    if (!channel?.isTextBased()) return interaction.reply({ content: '❌ Salon introuvable.', flags: MessageFlags.Ephemeral });
    const payload = render(state);
    await channel.send({ content: payload.content || undefined, embeds: payload.embeds });
    drafts.delete(id);
    return mettreAJour(interaction, { content: `✅ Message envoyé dans <#${channel.id}>.`, embeds: [], components: [] });
  }
}

module.exports = { start, handle, render };
