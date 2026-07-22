const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { COLORS, sendLog, logEmbed } = require('./embeds');
const { GRADES, getGrade } = require('./permissions');

const listTypes = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? ORDER BY id');
const getType = db.prepare('SELECT * FROM ticket_types WHERE id = ? AND guild_id = ?');
const getTypeByLabel = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? AND label = ?');
const insertType = db.prepare(
  'INSERT INTO ticket_types (guild_id, label, emoji, category_id, support_role_id, description) VALUES (?, ?, ?, ?, ?, ?)'
);
const deleteType = db.prepare('DELETE FROM ticket_types WHERE id = ?');

const insertTicket = db.prepare(
  "INSERT INTO tickets (guild_id, type_id, channel_id, user_id, status, opened_at) VALUES (?, ?, ?, ?, 'ouvert', ?)"
);
const getTicket = db.prepare('SELECT * FROM tickets WHERE id = ? AND guild_id = ?');
const getOpenTicket = db.prepare(
  "SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND type_id = ? AND status = 'ouvert'"
);
const closeTicketStmt = db.prepare(
  "UPDATE tickets SET status = 'ferme', closed_at = ?, closed_by = ? WHERE id = ?"
);
const countTickets = db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ?');

const insertPanel = db.prepare(
  'INSERT INTO ticket_panels (guild_id, channel_id, message_id, options) VALUES (?, ?, ?, ?)'
);
const lastPanel = db.prepare('SELECT * FROM ticket_panels WHERE guild_id = ? ORDER BY id DESC LIMIT 1');
const updatePanelOptions = db.prepare('UPDATE ticket_panels SET options = ? WHERE id = ?');

function parseColor(value) {
  if (!value) return null;
  const m = String(value).trim().match(/^#?([0-9a-f]{6})$/i);
  return m ? parseInt(m[1], 16) : null;
}

const nl = (s) => (s ? String(s).replace(/\\n/g, '\n') : s);

// Construit le message du panneau (message basique OU embed personnalisable)
// avec un bouton par type de ticket configuré.
function buildPanelPayload(guildId, options = {}) {
  const types = listTypes.all(guildId);
  const rows = [];
  // Mécanisme d'ouverture : « menu » = sélecteur de raison (menu déroulant,
  // façon Ticket Tool) ; sinon un bouton par raison.
  if (options.ouverture === 'menu' && types.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('tktmenu')
      .setPlaceholder(nl(options.selecteur_texte) || '🎫 Choisissez une raison pour ouvrir un ticket…')
      .addOptions(
        types.slice(0, 25).map((t) => {
          const opt = { label: String(t.label).slice(0, 100), value: String(t.id) };
          if (t.description) opt.description = String(t.description).slice(0, 100);
          if (t.emoji) {
            try {
              opt.emoji = t.emoji;
            } catch {}
          }
          return opt;
        })
      );
    rows.push(new ActionRowBuilder().addComponents(menu));
  } else {
    for (let i = 0; i < types.length && rows.length < 5; i += 5) {
      rows.push(
        new ActionRowBuilder().addComponents(
          types.slice(i, i + 5).map((t) => {
            const button = new ButtonBuilder()
              .setCustomId(`tktopen:${t.id}`)
              .setLabel(t.label)
              .setStyle(ButtonStyle.Primary);
            if (t.emoji) {
              try {
                button.setEmoji(t.emoji);
              } catch {}
            }
            return button;
          })
        )
      );
    }
  }
  const payload = { components: rows };
  if (options.mode === 'embed') {
    const embed = new EmbedBuilder().setColor(parseColor(options.couleur) ?? COLORS.PRIMARY);
    if (options.titre) embed.setTitle(nl(options.titre));
    embed.setDescription(nl(options.description) || '🎫 Cliquez sur un bouton ci-dessous pour ouvrir un ticket.');
    if (options.image) embed.setImage(options.image);
    if (options.miniature) embed.setThumbnail(options.miniature);
    if (options.footer) embed.setFooter({ text: nl(options.footer) });
    payload.embeds = [embed];
    payload.content = nl(options.texte) || '';
  } else {
    payload.content = nl(options.texte) || '🎫 Cliquez sur un bouton ci-dessous pour ouvrir un ticket.';
    payload.embeds = [];
  }
  return payload;
}

function canManageTicket(member, ticketType) {
  if (getGrade(member) >= GRADES.STAFF) return true;
  return Boolean(ticketType?.support_role_id && member.roles.cache.has(ticketType.support_role_id));
}

async function openTicket(interaction, typeId) {
  const type = getType.get(typeId, interaction.guildId);
  if (!type) {
    return interaction.reply({ content: '❌ Ce type de ticket n\'existe plus.', flags: MessageFlags.Ephemeral });
  }
  // Un seul ticket ouvert par membre et par type.
  const existing = getOpenTicket.get(interaction.guildId, interaction.user.id, type.id);
  if (existing) {
    const channel = await interaction.guild.channels.fetch(existing.channel_id).catch(() => null);
    if (channel) {
      return interaction.reply({
        content: `❌ Vous avez déjà un ticket **${type.label}** ouvert : <#${existing.channel_id}>`,
        flags: MessageFlags.Ephemeral,
      });
    }
    closeTicketStmt.run(new Date().toISOString(), 'auto (salon supprimé)', existing.id);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const cfg = getGuildConfig(interaction.guildId);
  const num = String(countTickets.get(interaction.guildId).n + 1).padStart(4, '0');
  const allowPerms = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
  ];
  const overwrites = [
    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: allowPerms },
    { id: interaction.client.user.id, allow: [...allowPerms, PermissionFlagsBits.ManageChannels] },
  ];
  if (type.support_role_id) overwrites.push({ id: type.support_role_id, allow: allowPerms });
  if (cfg.staff_role_id && cfg.staff_role_id !== type.support_role_id) {
    overwrites.push({ id: cfg.staff_role_id, allow: allowPerms });
  }

  let channel;
  try {
    channel = await interaction.guild.channels.create({
      name: `ticket-${num}-${interaction.user.username}`.slice(0, 90),
      type: ChannelType.GuildText,
      parent: type.category_id || null,
      permissionOverwrites: overwrites,
      topic: `Ticket ${type.label} de ${interaction.user.tag} (${interaction.user.id})`,
    });
  } catch (err) {
    return interaction.editReply(
      `❌ Impossible de créer le salon : ${err.message}\nVérifiez que le bot a **Gérer les salons** et que la catégorie n'est pas pleine (50 salons max).`
    );
  }

  const result = insertTicket.run(
    interaction.guildId, type.id, channel.id, interaction.user.id, new Date().toISOString()
  );
  const ticketId = result.lastInsertRowid;

  const intro = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`🎫 Ticket ${type.emoji ? `${type.emoji} ` : ''}${type.label} — n°${num}`)
    .setDescription(
      `Bonjour <@${interaction.user.id}> ! Décrivez votre demande, ` +
        `${type.support_role_id ? `l'équipe <@&${type.support_role_id}>` : 'le staff'} vous répondra dès que possible.`
    )
    .setFooter({ text: 'Utilisez le bouton ci-dessous pour fermer le ticket.' })
    .setTimestamp();
  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tktclose:${ticketId}`).setLabel('Fermer le ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );
  await channel.send({
    content: `<@${interaction.user.id}>${type.support_role_id ? ` <@&${type.support_role_id}>` : ''}`,
    embeds: [intro],
    components: [closeRow],
  });

  await interaction.editReply(`✅ Votre ticket est ouvert : ${channel}`);
  await sendLog(
    interaction.guild,
    logEmbed('🎫 Ticket ouvert', `Ticket **${type.label}** n°${num} ouvert par <@${interaction.user.id}> → <#${channel.id}>`, COLORS.INFO)
  );
}

async function closeTicket(interaction, ticketId) {
  const ticket = getTicket.get(ticketId, interaction.guildId);
  if (!ticket || ticket.status !== 'ouvert') {
    return interaction.reply({ content: '❌ Ticket introuvable ou déjà fermé.', flags: MessageFlags.Ephemeral });
  }
  const type = ticket.type_id ? getType.get(ticket.type_id, interaction.guildId) : null;
  const isOwner = interaction.user.id === ticket.user_id;
  if (!isOwner && !canManageTicket(interaction.member, type)) {
    return interaction.reply({
      content: '⛔ Seuls l\'auteur du ticket, l\'équipe support ou le staff peuvent le fermer.',
      flags: MessageFlags.Ephemeral,
    });
  }
  closeTicketStmt.run(new Date().toISOString(), interaction.user.id, ticket.id);
  // L'auteur perd l'accès au salon ; le support garde la main.
  await interaction.channel.permissionOverwrites
    .edit(ticket.user_id, { ViewChannel: false })
    .catch(() => null);
  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle('🔒 Ticket fermé')
    .setDescription(`Fermé par <@${interaction.user.id}>. L'équipe peut consulter le salon puis le supprimer.`)
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tktdel:${ticket.id}`).setLabel('Supprimer le salon').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
  );
  await interaction.reply({ embeds: [embed], components: [row] });
  await sendLog(
    interaction.guild,
    logEmbed('🎫 Ticket fermé', `Ticket n°${ticket.id} (<#${ticket.channel_id}>) fermé par <@${interaction.user.id}>.`, COLORS.WARNING)
  );
}

async function deleteTicket(interaction, ticketId) {
  const ticket = getTicket.get(ticketId, interaction.guildId);
  if (!ticket) {
    return interaction.reply({ content: '❌ Ticket introuvable.', flags: MessageFlags.Ephemeral });
  }
  const type = ticket.type_id ? getType.get(ticket.type_id, interaction.guildId) : null;
  if (!canManageTicket(interaction.member, type)) {
    return interaction.reply({
      content: '⛔ Seuls l\'équipe support ou le staff peuvent supprimer le salon.',
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.reply({ content: '🗑️ Transcript en cours puis suppression du salon…' });

  // Transcript (100 derniers messages) envoyé dans le salon de logs.
  try {
    const cfg = getGuildConfig(interaction.guildId);
    if (cfg.log_channel_id) {
      const logChannel = await interaction.guild.channels.fetch(cfg.log_channel_id).catch(() => null);
      if (logChannel?.isTextBased()) {
        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const lines = [...messages.values()]
          .reverse()
          .map((m) => `[${new Date(m.createdTimestamp).toLocaleString('fr-FR')}] ${m.author.tag} : ${m.content || '(embed/fichier)'}`);
        const file = new AttachmentBuilder(Buffer.from(lines.join('\n') || '(vide)', 'utf8'), {
          name: `transcript-ticket-${ticket.id}.txt`,
        });
        await logChannel.send({
          embeds: [
            logEmbed(
              '🎫 Ticket supprimé',
              `Ticket n°${ticket.id} de <@${ticket.user_id}> supprimé par <@${interaction.user.id}> — transcript ci-joint.`,
              COLORS.DANGER
            ),
          ],
          files: [file],
        });
      }
    }
  } catch {
    // le transcript ne doit pas empêcher la suppression
  }
  await interaction.channel.delete().catch(() => null);
}

async function handleTicketButton(interaction) {
  try {
    // Sélecteur de raison (menu déroulant) : la valeur choisie = l'ID du type.
    if (interaction.isStringSelectMenu() && interaction.customId === 'tktmenu') {
      return await openTicket(interaction, Number(interaction.values[0]));
    }
    const [prefix, rawId] = interaction.customId.split(':');
    const id = Number(rawId);
    if (prefix === 'tktopen') return await openTicket(interaction, id);
    if (prefix === 'tktclose') return await closeTicket(interaction, id);
    if (prefix === 'tktdel') return await deleteTicket(interaction, id);
  } catch (err) {
    console.error('Erreur ticket :', err);
    const payload = { content: '❌ Une erreur est survenue sur ce ticket.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
}

module.exports = {
  listTypes,
  getTypeByLabel,
  insertType,
  deleteType,
  insertPanel,
  lastPanel,
  updatePanelOptions,
  buildPanelPayload,
  parseColor,
  handleTicketButton,
};
