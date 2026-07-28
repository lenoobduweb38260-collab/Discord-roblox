const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { COLORS, sendLog, logEmbed } = require('./embeds');
const { GRADES, getGrade } = require('./permissions');

const listTypes = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? ORDER BY id');
const getType = db.prepare('SELECT * FROM ticket_types WHERE id = ? AND guild_id = ?');
const getTypeByLabel = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? AND label = ?');
const insertType = db.prepare(
  'INSERT INTO ticket_types (guild_id, label, emoji, category_id, support_role_id, description, support_role_ids) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const deleteType = db.prepare('DELETE FROM ticket_types WHERE id = ?');
const setTypeEnabledStmt = db.prepare('UPDATE ticket_types SET enabled = ? WHERE id = ? AND guild_id = ?');

// Bloque (enabled = 0) ou réactive (1) une raison de ticket.
function setTypeEnabled(guildId, id, enabled) {
  return setTypeEnabledStmt.run(enabled ? 1 : 0, id, guildId);
}

// Rôles support d'un type : plusieurs rôles possibles (support_role_ids, JSON).
// Compatibilité : si absent, on retombe sur l'ancien champ support_role_id.
function supportRoleIds(type) {
  if (!type) return [];
  try {
    const arr = JSON.parse(type.support_role_ids || '[]');
    if (Array.isArray(arr) && arr.length) return [...new Set(arr.filter(Boolean).map(String))];
  } catch {}
  return type.support_role_id ? [String(type.support_role_id)] : [];
}

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

// Sécurité emoji : n'accepte QUE des emojis réellement valides, sinon renvoie
// null. C'est essentiel car un emoji invalide (ex : un shortcode « :nom: » ou
// du texte saisi à la main) est accepté localement par discord.js mais REFUSÉ
// par l'API Discord à l'envoi → le panneau entier planterait. On ne transmet
// donc à Discord qu'un emoji personnalisé au bon format `<:nom:id>` /
// `<a:nom:id>`, ou un vrai emoji Unicode.
const CUSTOM_EMOJI_RE = /^<(a)?:([a-zA-Z0-9_]{2,32}):(\d{17,20})>$/;
function safeEmoji(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(CUSTOM_EMOJI_RE);
  if (m) return { id: m[3], name: m[2], animated: Boolean(m[1]) };
  // Unicode : doit contenir un pictogramme emoji et rester court (les séquences
  // ZWJ comme les emojis composés sont tolérées).
  try {
    if (/\p{Extended_Pictographic}/u.test(s) && [...s].length <= 12) return s;
  } catch {
    // moteur regex sans \p{...} : on retombe sur « pas d'emoji » par prudence
  }
  return null;
}

const nl = (s) => (s ? String(s).replace(/\\n/g, '\n') : s);

// Construit le message du panneau (message basique OU embed personnalisable)
// avec un bouton par type de ticket configuré.
function buildPanelPayload(guildId, options = {}) {
  // Une raison bloquée (enabled = 0) n'apparaît plus dans le panneau.
  const types = listTypes.all(guildId).filter((t) => t.enabled !== 0);
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
          const emoji = safeEmoji(t.emoji);
          if (emoji) opt.emoji = emoji;
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
            const emoji = safeEmoji(t.emoji);
            if (emoji) {
              try {
                button.setEmoji(emoji);
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
    embed.setDescription(nl(options.description) || '🎫 Cliquez ci-dessous pour ouvrir un ticket.');
    if (options.auteur) embed.setAuthor({ name: String(options.auteur).slice(0, 256), iconURL: options.auteur_icone || undefined });
    if (options.image) embed.setImage(options.image);
    if (options.miniature) embed.setThumbnail(options.miniature);
    if (options.footer) embed.setFooter({ text: nl(options.footer) });
    payload.embeds = [embed];
    payload.content = nl(options.texte) || '';
  } else {
    payload.content = nl(options.texte) || '🎫 Cliquez ci-dessous pour ouvrir un ticket.';
    payload.embeds = [];
  }
  return payload;
}

// ----- 🏗️ Constructeur de panneau (création & modification) -----
// Le contenu texte (titre, description, message, pied de page) se saisit dans
// un MODAL à champs « paragraphe » : on peut y faire de VRAIS retours à la
// ligne (touche Entrée). L'image/GIF s'envoie via une pièce jointe uploadée
// depuis le PC (option de la commande, car un modal n'accepte pas de fichier).
// À la modification, si plusieurs panneaux existent, on choisit lequel via un
// menu déroulant.
const listPanels = db.prepare('SELECT * FROM ticket_panels WHERE guild_id = ? ORDER BY id DESC');
const getPanelById = db.prepare('SELECT * FROM ticket_panels WHERE id = ? AND guild_id = ?');

// Mémoire temporaire entre la commande, la sélection et le modal.
const pendingPanels = new Map(); // `${guildId}:${userId}` → { action, channelId, panelId, opts, existing }
const panelKey = (interaction) => `${interaction.guildId}:${interaction.user.id}`;
const safeJson = (s) => {
  try {
    return JSON.parse(s || '{}') || {};
  } catch {
    return {};
  }
};

// Modal de contenu : 4 champs, pré-remplis à la modification.
function panelTextModal(existing = {}) {
  const field = (id, label, value, style, max) => {
    const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(false).setMaxLength(max);
    if (value) input.setValue(String(value).slice(0, max));
    return new ActionRowBuilder().addComponents(input);
  };
  return new ModalBuilder()
    .setCustomId('tktpanmodal')
    .setTitle('🎫 Contenu du panneau')
    .addComponents(
      field('pan_titre', 'Titre de l\'embed (facultatif)', existing.titre, TextInputStyle.Short, 256),
      field('pan_desc', 'Description — Entrée = saut de ligne', existing.description, TextInputStyle.Paragraph, 4000),
      field('pan_texte', 'Message au-dessus (facultatif)', existing.texte, TextInputStyle.Paragraph, 2000),
      field('pan_footer', 'Pied de page (facultatif)', existing.footer, TextInputStyle.Short, 2048)
    );
}

// Étape 1 (création) : mémorise les options de commande puis ouvre le modal.
async function startPanelCreate(interaction, opts) {
  pendingPanels.set(panelKey(interaction), { action: 'create', channelId: opts.channelId, opts: opts.options, existing: {} });
  await interaction.showModal(panelTextModal({}));
}

// Étape 1 (modification) : choisit le panneau (menu si plusieurs) puis le modal.
async function startPanelModify(interaction, opts) {
  const panels = listPanels.all(interaction.guildId);
  if (!panels.length) {
    return interaction.reply({
      content: '❌ Aucun panneau à modifier : publiez-en un avec `/ticket panneau`.',
      flags: MessageFlags.Ephemeral,
    });
  }
  pendingPanels.set(panelKey(interaction), { action: 'modify', opts: opts.options, existing: {} });
  if (panels.length === 1) return openModifyModal(interaction, panels[0]);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('tktpansel')
    .setPlaceholder('🎫 Quel panneau modifier ?')
    .addOptions(
      panels.slice(0, 25).map((p) => {
        const o = safeJson(p.options);
        const chan = interaction.guild.channels.cache.get(p.channel_id);
        const preview = String(o.titre || o.texte || o.description || 'Panneau').replace(/\s+/g, ' ').trim().slice(0, 50) || 'Panneau';
        return {
          label: `#${chan?.name || 'salon'} — ${preview}`.slice(0, 100),
          value: String(p.id),
          description: `Publié dans #${chan?.name || p.channel_id}`.slice(0, 100),
        };
      })
    );
  return interaction.reply({
    content: '🎫 Plusieurs panneaux existent — choisissez celui à modifier :',
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

// Ouvre le modal pré-rempli avec le contenu existant du panneau choisi.
async function openModifyModal(interaction, panel) {
  const key = panelKey(interaction);
  const pending = pendingPanels.get(key) || { action: 'modify', opts: {}, existing: {} };
  pending.panelId = panel.id;
  pending.existing = safeJson(panel.options);
  pendingPanels.set(key, pending);
  await interaction.showModal(panelTextModal(pending.existing));
}

// Étape 2 : le modal est validé → construit et publie / met à jour le panneau.
async function finishPanel(interaction) {
  const key = panelKey(interaction);
  const pending = pendingPanels.get(key);
  if (!pending) {
    return interaction.reply({ content: '❌ Session expirée — relancez `/ticket panneau`.', flags: MessageFlags.Ephemeral });
  }
  pendingPanels.delete(key);
  const val = (id) => interaction.fields.getTextInputValue(id).trim();
  // Options finales : existant (modif) < options de commande < textes du modal.
  const merged = { ...(pending.existing || {}) };
  for (const [k, v] of Object.entries(pending.opts || {})) {
    if (v !== undefined && v !== null && v !== '') merged[k] = v;
  }
  // Les 4 champs texte sont pré-remplis : leur valeur (même vidée) fait foi.
  for (const [k, id] of [['titre', 'pan_titre'], ['description', 'pan_desc'], ['texte', 'pan_texte'], ['footer', 'pan_footer']]) {
    const v = val(id);
    if (v) merged[k] = v;
    else delete merged[k];
  }
  if (merged.couleur && parseColor(merged.couleur) === null) {
    return interaction.reply({ content: '❌ Couleur invalide : utilisez un code hex, ex `#5865F2`.', flags: MessageFlags.Ephemeral });
  }
  const payload = buildPanelPayload(interaction.guildId, merged);

  if (pending.action === 'create') {
    const channel = await interaction.guild.channels.fetch(pending.channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      return interaction.reply({ content: '❌ Salon du panneau introuvable.', flags: MessageFlags.Ephemeral });
    }
    let message;
    try {
      message = await channel.send(payload);
    } catch (err) {
      return interaction.reply({
        content: `❌ Publication impossible dans ${channel} : ${err.message}\nVérifiez les permissions **Voir le salon** / **Envoyer des messages** / **Intégrer des liens** du bot.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    insertPanel.run(interaction.guildId, channel.id, message.id, JSON.stringify(merged));
    await interaction.reply({ content: `✅ Panneau publié dans ${channel}. Modifiez-le avec \`/ticket panneau-modifier\`.`, flags: MessageFlags.Ephemeral });
    await sendLog(interaction.guild, logEmbed('🎫 Panneau publié', `Panneau publié dans <#${channel.id}> par <@${interaction.user.id}>.`, COLORS.INFO));
    return;
  }

  // Modification
  const panel = getPanelById.get(pending.panelId, interaction.guildId);
  if (!panel) return interaction.reply({ content: '❌ Panneau introuvable (peut-être supprimé).', flags: MessageFlags.Ephemeral });
  const channel = await interaction.guild.channels.fetch(panel.channel_id).catch(() => null);
  const message = channel ? await channel.messages.fetch(panel.message_id).catch(() => null) : null;
  if (!message) {
    return interaction.reply({
      content: '❌ Le message du panneau a été supprimé — republiez-en un avec `/ticket panneau`.',
      flags: MessageFlags.Ephemeral,
    });
  }
  try {
    await message.edit(payload);
  } catch (err) {
    return interaction.reply({ content: `❌ Modification impossible : ${err.message}`, flags: MessageFlags.Ephemeral });
  }
  updatePanelOptions.run(JSON.stringify(merged), panel.id);
  await interaction.reply({ content: `✅ Panneau mis à jour dans <#${panel.channel_id}>.`, flags: MessageFlags.Ephemeral });
  await sendLog(interaction.guild, logEmbed('🎫 Panneau modifié', `Panneau dans <#${panel.channel_id}> mis à jour par <@${interaction.user.id}>.`, COLORS.INFO));
}

// Routeur des interactions du constructeur (menu de sélection + modal).
async function handlePanelBuilder(interaction) {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === 'tktpansel') {
      const panel = getPanelById.get(Number(interaction.values[0]), interaction.guildId);
      if (!panel) return await interaction.update({ content: '❌ Panneau introuvable.', components: [] });
      return await openModifyModal(interaction, panel);
    }
    if (interaction.isModalSubmit() && interaction.customId === 'tktpanmodal') {
      return await finishPanel(interaction);
    }
  } catch (err) {
    console.error('Erreur constructeur de panneau :', err);
    const payload = { content: '❌ Une erreur est survenue sur le panneau.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
}

function canManageTicket(member, ticketType) {
  if (getGrade(member) >= GRADES.STAFF) return true;
  return supportRoleIds(ticketType).some((roleId) => member.roles.cache.has(roleId));
}

async function openTicket(interaction, typeId) {
  const type = getType.get(typeId, interaction.guildId);
  if (!type) {
    return interaction.reply({ content: '❌ Ce type de ticket n\'existe plus.', flags: MessageFlags.Ephemeral });
  }
  // Raison bloquée : on refuse l'ouverture (le bouton peut encore exister sur un
  // ancien panneau tant qu'il n'a pas été republié).
  if (type.enabled === 0) {
    return interaction.reply({
      content: `🔒 La raison **${type.label}** est temporairement indisponible. Réessayez plus tard.`,
      flags: MessageFlags.Ephemeral,
    });
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
  const roleIds = supportRoleIds(type);
  const overwrites = [
    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: allowPerms },
    { id: interaction.client.user.id, allow: [...allowPerms, PermissionFlagsBits.ManageChannels] },
  ];
  for (const roleId of roleIds) overwrites.push({ id: roleId, allow: allowPerms });
  if (cfg.staff_role_id && !roleIds.includes(String(cfg.staff_role_id))) {
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

  const roleMentions = roleIds.map((id) => `<@&${id}>`).join(' ');
  const intro = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`🎫 Ticket ${type.emoji ? `${type.emoji} ` : ''}${type.label} — n°${num}`)
    .setDescription(
      `Bonjour <@${interaction.user.id}> ! Décrivez votre demande, ` +
        `${roleMentions ? `l'équipe ${roleMentions}` : 'le staff'} vous répondra dès que possible.`
    )
    .setFooter({ text: 'Utilisez le bouton ci-dessous pour fermer le ticket.' })
    .setTimestamp();
  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tktclose:${ticketId}`).setLabel('Fermer le ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );
  await channel.send({
    content: `<@${interaction.user.id}>${roleMentions ? ` ${roleMentions}` : ''}`,
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
  supportRoleIds,
  insertPanel,
  lastPanel,
  updatePanelOptions,
  buildPanelPayload,
  parseColor,
  safeEmoji,
  setTypeEnabled,
  startPanelCreate,
  startPanelModify,
  handlePanelBuilder,
  handleTicketButton,
};
