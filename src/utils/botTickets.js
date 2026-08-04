const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const { db } = require('../database');
const { hasPerm, applyBlacklist, state, setState } = require('./botTeam');

// QG des tickets de l'équipe du bot : les bannissements des serveurs et les
// /report arrivent en embeds dans le salon QG configuré (/botstaff salon-qg).
// Boutons : 🙋 Claim → 🔗 Invitation du serveur d'origine (visible uniquement
// par le staff qui a claim) → ⏭️ Passer (rend le ticket) → ⚖️ Traiter
// (aucune sanction, ou blacklist de l'utilisateur).

const insertTicket = db.prepare(
  'INSERT INTO bot_tickets (kind, guild_id, guild_name, target_id, target_tag, reporter_id, reason, status, created_at) ' +
    "VALUES (?, ?, ?, ?, ?, ?, ?, 'ouvert', ?)"
);
const getTicket = db.prepare('SELECT * FROM bot_tickets WHERE id = ?');
const setTicketMessage = db.prepare('UPDATE bot_tickets SET channel_id = ?, message_id = ? WHERE id = ?');
const setTicketClaim = db.prepare("UPDATE bot_tickets SET status = ?, claimed_by = ? WHERE id = ?");
const setTicketDone = db.prepare("UPDATE bot_tickets SET status = 'traite', resolution = ? WHERE id = ?");

const KINDS = {
  ban: { emoji: '🔨', label: 'Bannissement' },
  report: { emoji: '🚨', label: 'Report' },
};

function hq() {
  try {
    return JSON.parse(state('tickets_hq') || 'null');
  } catch {
    return null;
  }
}
const setHq = (guildId, channelId) => setState('tickets_hq', JSON.stringify({ guildId, channelId }));

function buildTicketEmbed(ticket) {
  const kind = KINDS[ticket.kind] || KINDS.report;
  const statusLine =
    ticket.status === 'traite'
      ? ticket.resolution === 'blacklist'
        ? '🚫 **Traité — utilisateur blacklisté**'
        : '✅ **Traité — aucune sanction**'
      : ticket.claimed_by
        ? `🙋 **Claim par <@${ticket.claimed_by}>**`
        : '📥 **Ouvert — en attente d\'un staff**';
  const color =
    ticket.status === 'traite' ? (ticket.resolution === 'blacklist' ? 0xe74c3c : 0x2ecc71) : ticket.claimed_by ? 0x3498db : 0xf39c12;
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${kind.emoji} Ticket n°${ticket.id} — ${kind.label}`)
    .addFields(
      { name: '🌐 Serveur d\'origine', value: `${ticket.guild_name || '?'}\n\`${ticket.guild_id}\``, inline: true },
      { name: '👤 Utilisateur concerné', value: `${ticket.target_tag || '?'}\n<@${ticket.target_id}> · \`${ticket.target_id}\``, inline: true },
      {
        name: ticket.kind === 'report' ? '🗣️ Signalé par' : '🔎 Détecté',
        value: ticket.reporter_id ? `<@${ticket.reporter_id}>` : 'Bannissement du serveur',
        inline: true,
      },
      { name: '📄 Raison', value: ticket.reason || '*Aucune raison précisée*', inline: false },
      { name: '📌 Statut', value: statusLine, inline: false }
    )
    .setTimestamp(new Date(ticket.created_at));
}

function buildTicketButtons(ticket) {
  if (ticket.status === 'traite') return [];
  const claimed = Boolean(ticket.claimed_by);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`btk:claim:${ticket.id}`).setLabel('🙋 Claim').setStyle(ButtonStyle.Primary).setDisabled(claimed),
      new ButtonBuilder().setCustomId(`btk:invite:${ticket.id}`).setLabel('🔗 Invitation du serveur').setStyle(ButtonStyle.Secondary).setDisabled(!claimed),
      new ButtonBuilder().setCustomId(`btk:pass:${ticket.id}`).setLabel('⏭️ Passer').setStyle(ButtonStyle.Secondary).setDisabled(!claimed),
      new ButtonBuilder().setCustomId(`btk:treat:${ticket.id}`).setLabel('⚖️ Traiter').setStyle(ButtonStyle.Danger).setDisabled(!claimed)
    ),
  ];
}

// Crée le ticket en base et publie l'embed dans le salon QG. Renvoie false si
// aucun QG n'est configuré ou joignable.
async function createTicket(client, { kind, guild, targetId, targetTag, reporterId, reason }) {
  const conf = hq();
  if (!conf) return false;
  const channel = await client.channels.fetch(conf.channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;
  const info = insertTicket.run(
    kind,
    guild.id,
    guild.name,
    targetId,
    targetTag || null,
    reporterId || null,
    reason || null,
    new Date().toISOString()
  );
  const ticket = getTicket.get(Number(info.lastInsertRowid));
  const message = await channel
    .send({ embeds: [buildTicketEmbed(ticket)], components: buildTicketButtons(ticket) })
    .catch(() => null);
  if (!message) return false;
  setTicketMessage.run(channel.id, message.id, ticket.id);
  return true;
}

// Réédite l'embed du QG après un changement d'état.
async function refreshTicketMessage(client, ticket) {
  if (!ticket.channel_id || !ticket.message_id) return;
  const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
  const message = await channel?.messages.fetch(ticket.message_id).catch(() => null);
  if (message) {
    await message.edit({ embeds: [buildTicketEmbed(ticket)], components: buildTicketButtons(ticket) }).catch(() => null);
  }
}

// ----- Boutons du QG (customId « btk:<action>:<id>[:<choix>] ») -----
async function handleButton(interaction) {
  const [, action, rawId, choice] = interaction.customId.split(':');
  const ticket = getTicket.get(Number(rawId));
  const eph = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  if (!ticket) return eph('❌ Ticket introuvable.');

  if (!(await hasPerm(interaction.client, interaction.user.id, 'tickets'))) {
    return eph('⛔ Sécurité : réservé au **staff du bot** disposant de la permission 🎫 Tickets.');
  }
  if (ticket.status === 'traite') return eph('✅ Ce ticket est déjà traité.');

  // 🙋 Claim : premier arrivé, premier servi.
  if (action === 'claim') {
    if (ticket.claimed_by) return eph(`⚠️ Déjà claim par <@${ticket.claimed_by}>.`);
    setTicketClaim.run('claim', interaction.user.id, ticket.id);
    const updated = getTicket.get(ticket.id);
    await interaction.update({ embeds: [buildTicketEmbed(updated)], components: buildTicketButtons(updated) });
    return;
  }

  // Les actions suivantes sont réservées au staff qui a claim le ticket.
  if (ticket.claimed_by !== interaction.user.id) {
    return eph(ticket.claimed_by ? `⛔ Ce ticket est claim par <@${ticket.claimed_by}> — lui seul peut agir.` : '⚠️ Claim d\'abord le ticket.');
  }

  // 🔗 Invitation du serveur d'origine : créée par le bot, donnée en LECTURE
  // SEULE (réponse éphémère) au staff qui a claim.
  if (action === 'invite') {
    const guild = interaction.client.guilds.cache.get(ticket.guild_id);
    if (!guild) return eph('❌ Le bot n\'est plus sur ce serveur.');
    const channel = guild.channels.cache.find(
      (c) => c.isTextBased() && !c.isThread() && c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.CreateInstantInvite)
    );
    if (!channel) return eph('❌ Le bot n\'a pas la permission de créer une invitation sur ce serveur.');
    const invite = await channel
      .createInvite({ maxAge: 3600, maxUses: 1, unique: true, reason: `Ticket QG n°${ticket.id} — visite du staff du bot` })
      .catch(() => null);
    if (!invite) return eph('❌ Création de l\'invitation impossible.');
    return eph(`🔗 Invitation du serveur **${guild.name}** (1 h, 1 utilisation) :\n${invite.url}`);
  }

  // ⏭️ Passer : rend le ticket, un autre staff peut le claim.
  if (action === 'pass') {
    setTicketClaim.run('ouvert', null, ticket.id);
    const updated = getTicket.get(ticket.id);
    await interaction.update({ embeds: [buildTicketEmbed(updated)], components: buildTicketButtons(updated) });
    return;
  }

  // ⚖️ Traiter : le bot demande la décision.
  if (action === 'treat') {
    return interaction.reply({
      content: `⚖️ **Ticket n°${ticket.id}** — quelle décision pour <@${ticket.target_id}> ?`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`btk:sanction:${ticket.id}:aucune`).setLabel('✅ Aucune sanction').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`btk:sanction:${ticket.id}:blacklist`).setLabel('🚫 Blacklist').setStyle(ButtonStyle.Danger)
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Décision finale (boutons de l'étape « Traiter »).
  if (action === 'sanction') {
    if (choice === 'blacklist') {
      if (!(await hasPerm(interaction.client, interaction.user.id, 'blacklist'))) {
        return interaction.update({ content: '⛔ Il vous manque la permission 🚫 Blacklist pour cette décision.', components: [] });
      }
      // Accusé de réception AVANT le MP + bans multi-serveurs (plusieurs
      // secondes), sinon « l'application ne répond pas ».
      await interaction.deferUpdate().catch(() => {});
      const result = await applyBlacklist(
        interaction.client,
        ticket.target_id,
        `Ticket QG n°${ticket.id}${ticket.reason ? ` — ${ticket.reason}` : ''}`,
        interaction.user.id
      );
      setTicketDone.run('blacklist', ticket.id);
      await refreshTicketMessage(interaction.client, getTicket.get(ticket.id));
      return interaction.editReply({
        content:
          `🚫 **${result.tag}** blacklisté (ticket n°${ticket.id}) : banni sur **${result.banned}** serveur(s), ` +
          `MP ${result.dmOk ? 'envoyé ✅' : 'impossible (MP fermés) ⚠️'}.`,
        components: [],
      });
    }
    setTicketDone.run('aucune', ticket.id);
    await refreshTicketMessage(interaction.client, getTicket.get(ticket.id));
    return interaction.update({ content: `✅ Ticket n°${ticket.id} traité : **aucune sanction**.`, components: [] });
  }
}

module.exports = { createTicket, handleButton, hq, setHq };
