const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const { db } = require('../database');
const { COLORS } = require('./embeds');

// 📋 Presets de tickets — des réponses toutes prêtes.
// Le staff les écrit une fois (/preset ajouter), puis les envoie dans un
// ticket en les choisissant dans une liste déroulante : plus besoin de
// retaper le même message d'accueil, de demande de preuves ou de refus.

const listPresets = db.prepare('SELECT * FROM ticket_presets WHERE guild_id = ? ORDER BY id');
const getPreset = db.prepare('SELECT * FROM ticket_presets WHERE id = ? AND guild_id = ?');
const getPresetByLabel = db.prepare('SELECT * FROM ticket_presets WHERE guild_id = ? AND label = ?');
const insertPreset = db.prepare(
  `INSERT INTO ticket_presets (guild_id, label, emoji, description, content, embed_title, embed_text, embed_color, created_by, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const deletePreset = db.prepare('DELETE FROM ticket_presets WHERE id = ? AND guild_id = ?');
const updatePreset = db.prepare(
  `UPDATE ticket_presets SET label = ?, emoji = ?, description = ?, content = ?, embed_title = ?, embed_text = ?, embed_color = ?
   WHERE id = ? AND guild_id = ?`
);

const MAX = 25; // limite d'options d'un menu déroulant Discord

// Construit ce que le bot enverra pour un preset donné.
// Un preset peut être du texte simple, un embed, ou les deux.
function payloadDe(preset, contexte = {}) {
  const remplacer = (t) =>
    String(t || '')
      .replaceAll('{membre}', contexte.membre ? `<@${contexte.membre}>` : '')
      .replaceAll('{staff}', contexte.staff ? `<@${contexte.staff}>` : '')
      .replaceAll('{serveur}', contexte.serveur || '');

  const payload = {};
  const texte = remplacer(preset.content).trim();
  if (texte) payload.content = texte.slice(0, 2000);

  const titre = remplacer(preset.embed_title).trim();
  const corps = remplacer(preset.embed_text).trim();
  if (titre || corps) {
    const embed = new EmbedBuilder().setColor(couleurDe(preset.embed_color));
    if (titre) embed.setTitle(titre.slice(0, 256));
    if (corps) embed.setDescription(corps.slice(0, 4096));
    payload.embeds = [embed];
  }
  // Un preset sans rien dedans ne doit pas produire un message vide : Discord
  // refuserait l'envoi avec une erreur peu parlante.
  if (!payload.content && !payload.embeds) return null;
  return payload;
}

function couleurDe(valeur) {
  const v = String(valeur || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(v)) return parseInt(v, 16);
  return COLORS.PRIMARY;
}

// Le menu déroulant des presets, à joindre au message d'un ticket.
// Renvoie null s'il n'y a aucun preset : pas de menu vide.
function menuPresets(guildId, ticketId) {
  const presets = listPresets.all(guildId).slice(0, MAX);
  if (!presets.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`tktpreset:${ticketId}`)
    .setPlaceholder('📋 Envoyer une réponse type…')
    .addOptions(
      presets.map((p) => {
        const option = { label: p.label.slice(0, 100), value: String(p.id) };
        if (p.description) option.description = String(p.description).slice(0, 100);
        if (p.emoji) option.emoji = p.emoji;
        return option;
      })
    );
  return new ActionRowBuilder().addComponents(menu);
}

// Envoi d'un preset choisi dans le menu, réservé au staff du ticket.
async function envoyerPreset(interaction, peutGerer) {
  const id = Number(interaction.values[0]);
  const preset = getPreset.get(id, interaction.guildId);
  if (!preset) {
    return interaction.reply({
      content: '❌ Cette réponse type n\'existe plus (elle a été supprimée depuis).',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!peutGerer) {
    return interaction.reply({
      content: '⛔ Seul le staff peut envoyer une réponse type.',
      flags: MessageFlags.Ephemeral,
    });
  }
  // Le contenu est relu à l'instant : modifier un preset change ce qui part,
  // sans avoir à republier le menu du ticket.
  const payload = payloadDe(preset, {
    membre: interaction.channel?.topic?.match(/\((\d{15,25})\)/)?.[1] || null,
    staff: interaction.user.id,
    serveur: interaction.guild?.name,
  });
  if (!payload) {
    return interaction.reply({
      content: `❌ La réponse type « ${preset.label} » est vide : rien à envoyer.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.channel.send(payload).catch(() => null);
  return interaction.reply({ content: `📋 Réponse type « ${preset.label} » envoyée.`, flags: MessageFlags.Ephemeral });
}

module.exports = {
  listPresets,
  getPreset,
  getPresetByLabel,
  insertPreset,
  deletePreset,
  updatePreset,
  payloadDe,
  couleurDe,
  menuPresets,
  envoyerPreset,
  MAX,
};
