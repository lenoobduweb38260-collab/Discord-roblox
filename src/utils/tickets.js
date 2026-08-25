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
  UserSelectMenuBuilder,
} = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { COLORS, sendLog, logEmbed, epinglerProprement } = require('./embeds');
const { GRADES, getGrade, staffRoleIds } = require('./permissions');
const balises = require('./balises');
const M = require('./miseEnPage');
const { reglages } = require('./styleEmbeds');
const { mettreAJour, reafficher, suivre } = require('./reponse');

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
const getTicketByChannel = db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ?');
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
// Quand un panneau doit être republié pour devenir une carte, sa référence
// change : sans cette mise à jour, la commande « modifier » viserait un
// message supprimé.
const updatePanelMessage = db.prepare('UPDATE ticket_panels SET channel_id = ?, message_id = ? WHERE id = ?');

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

// Le panneau de tickets est écrit par le staff : il passe par les balises,
// comme tout texte libre du bot.
const nl = (s) => (s ? balises.appliquer(s) : s);

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
const getPanelByMessage = db.prepare('SELECT * FROM ticket_panels WHERE guild_id = ? AND message_id = ?');
const deplacerPanneau = db.prepare('UPDATE ticket_panels SET channel_id = ?, message_id = ? WHERE guild_id = ? AND message_id = ?');

// 🔗 Un panneau republié ailleurs garde son rôle de panneau.
//
// /esthetique mode:recréer supprime le message et en renvoie un neuf. Sans
// cette réécriture, la table pointerait vers un message effacé : « modifier »
// répondrait « panneau introuvable », et le panneau deviendrait un simple
// message décoratif. Le défaut serait silencieux — le pire genre.
function reenregistrerPanneau(guildId, ancienMessageId, salonId, nouveauMessageId) {
  try {
    if (!getPanelByMessage.get(guildId, ancienMessageId)) return false;
    deplacerPanneau.run(salonId, nouveauMessageId, guildId, ancienMessageId);
    return true;
  } catch {
    return false;
  }
}

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
    // 📌 Le panneau est fait pour être retrouvé : on l'épingle, et la
    // notification système « a épinglé un message » est effacée dans la foulée.
    const epingle = await epinglerProprement(message);
    await interaction.reply({
      content: `✅ Panneau publié dans ${channel}${epingle ? ' et **épinglé** 📌' : ''}. Modifiez-le avec \`/ticket panneau-modifier\`.`
        + (epingle ? '' : '\n-# 📌 Épinglage impossible : donnez-moi **Gérer les messages** dans ce salon, puis republiez.'),
      flags: MessageFlags.Ephemeral,
    });
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
  // ⚠️ Discord fige la famille de composants d'un message à sa création : un
  // panneau publié à l'époque des embeds ne deviendra JAMAIS une carte par
  // modification. On le republie donc UNE fois — c'est le seul chemin — puis
  // les modifications suivantes reprennent normalement.
  const r = reglages(interaction.guildId);
  let republie = false;
  if (r.actif && r.cartes && message.embeds?.length) {
    const neuf = await channel.send(payload).catch(() => null);
    if (neuf) {
      await message.delete().catch(() => null);
      updatePanelMessage.run(channel.id, neuf.id, panel.id);
      // Le nouveau message reprend la place de l'ancien, épingle comprise.
      await epinglerProprement(neuf);
      republie = true;
    }
  }
  if (!republie) {
    try {
      await editerMessagePanneau(interaction.guild, interaction.client, message, payload);
    } catch (err) {
      return interaction.reply({ content: `❌ Modification impossible : ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  }
  updatePanelOptions.run(JSON.stringify(merged), panel.id);
  await interaction.reply({
    content: `✅ Panneau mis à jour dans <#${panel.channel_id}>.` +
      (republie ? '\n-# 🃏 Republié pour passer en carte sans bordure : un embed déjà envoyé ne peut pas le devenir.' : ''),
    flags: MessageFlags.Ephemeral,
  });
  await sendLog(interaction.guild, logEmbed('🎫 Panneau modifié', `Panneau dans <#${panel.channel_id}> mis à jour par <@${interaction.user.id}>.`, COLORS.INFO));
}

// Routeur des interactions du constructeur (menu de sélection + modal).
async function handlePanelBuilder(interaction) {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === 'tktpansel') {
      const panel = getPanelById.get(Number(interaction.values[0]), interaction.guildId);
      if (!panel) return await mettreAJour(interaction, { content: '❌ Panneau introuvable.', components: [] });
      return await openModifyModal(interaction, panel);
    }
    if (interaction.isModalSubmit() && interaction.customId === 'tktpanmodal') {
      return await finishPanel(interaction);
    }
  } catch (err) {
    console.error('Erreur constructeur de panneau :', err);
    await suivre(interaction, { content: '❌ Une erreur est survenue sur le panneau.', flags: MessageFlags.Ephemeral });
  }
}

function canManageTicket(member, ticketType) {
  if (getGrade(member) >= GRADES.STAFF) return true;
  return supportRoleIds(ticketType).some((roleId) => member.roles.cache.has(roleId));
}

// Crée réellement le salon du ticket pour `owner` (User) et y poste le message
// d'accueil avec le bouton de fermeture. Renvoie { channel, num }. Utilisé à la
// fois par l'ouverture normale et par la création par le staff (`creer-pour`).
async function provisionTicket(guild, type, owner) {
  const cfg = getGuildConfig(guild.id);
  const num = String(countTickets.get(guild.id).n + 1).padStart(4, '0');
  const allowPerms = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
  ];
  const roleIds = supportRoleIds(type);
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: owner.id, allow: allowPerms },
    {
      id: guild.client.user.id,
      allow: [
        ...allowPerms,
        PermissionFlagsBits.ManageChannels,
        // Le fil privé du staff : le créer, y écrire, y ajouter le staff.
        PermissionFlagsBits.CreatePrivateThreads,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.ManageThreads,
      ],
    },
  ];
  for (const roleId of roleIds) overwrites.push({ id: roleId, allow: allowPerms });
  if (cfg.staff_role_id && !roleIds.includes(String(cfg.staff_role_id))) {
    overwrites.push({ id: cfg.staff_role_id, allow: allowPerms });
  }
  const channel = await guild.channels.create({
    name: `ticket-${num}-${owner.username}`.slice(0, 90),
    type: ChannelType.GuildText,
    parent: type.category_id || null,
    permissionOverwrites: overwrites,
    topic: `Ticket ${type.label} de ${owner.tag} (${owner.id})`,
  });
  const result = insertTicket.run(guild.id, type.id, channel.id, owner.id, new Date().toISOString());
  const roleMentions = roleIds.map((id) => `<@&${id}>`).join(' ');
  // Grammaire du projet : une phrase d'accueil, puis une section ◆ qui dit
  // qui répond. Pas de pied de page : « Utilisez le bouton ci-dessous »
  // répétait le libellé du bouton juste en dessous, et prenait la place de la
  // signature du bot.
  const intro = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`🎫 Ticket ${type.emoji ? `${type.emoji} ` : ''}${type.label} — n°${num}`)
    .setDescription(
      M.description([
        `Bonjour <@${owner.id}> ! Décrivez votre demande le plus précisément possible.`,
        M.bloc(
          roleMentions ? 'Qui vous répond' : 'Prise en charge',
          roleMentions ? [roleMentions] : ['Le staff vous répondra dès que possible'],
          { prefixe: '👥', compte: null, vide: 'Le staff vous répondra dès que possible' }
        ),
      ])
    )
    .setTimestamp();
  const ticketId = result.lastInsertRowid;
  await channel.send({
    content: `<@${owner.id}>${roleMentions ? ` ${roleMentions}` : ''}`,
    embeds: [intro],
    components: rangeesTicket(guild.id, ticketId),
  });
  await creerFilStaff(guild, channel, { cfg, roleIds, num, owner }).catch((err) => {
    console.warn(`⚠️ Fil staff du ticket n°${num} non créé : ${err.message}`);
  });
  return { channel, num };
}

// 🔒 Le fil PRIVÉ du staff, accroché à chaque ticket.
//
// Un fil privé ne montre son contenu qu'aux membres qu'on y a AJOUTÉS :
// l'auteur du ticket voit son salon, mais pas ce fil — le staff peut donc
// se concerter à côté de la conversation, sans salon supplémentaire.
//
// L'ajout du staff est SILENCIEUX, membre par membre : mentionner les rôles
// dans le fil les ajouterait d'un coup, mais re-sonnerait tout le monde —
// et le ping du ticket vient déjà de partir dans le salon.
async function creerFilStaff(guild, channel, { cfg, roleIds, num, owner }) {
  const fil = await channel.threads.create({
    name: `🔒 staff-${num}`.slice(0, 90),
    type: ChannelType.PrivateThread,
    invitable: false,
    reason: `Discussion staff du ticket n°${num}`,
  });
  await fil.send({
    content: `🔒 Fil réservé au **staff** pour le ticket n°**${num}**.\n`
      + `➜ **${owner.username}** (\`${owner.id}\`) n'y voit rien : concertez-vous librement, répondez-lui dans <#${channel.id}>.`,
  }).catch(() => null);

  const cibles = new Set(roleIds.map(String));
  if (cfg.staff_role_id) cibles.add(String(cfg.staff_role_id));
  for (const id of staffRoleIds(cfg)) cibles.add(String(id));
  if (!cibles.size) return fil;
  // Le cache des membres peut être incomplet au réveil : on le remplit une
  // fois — un ticket est un événement rare, le coût est acceptable.
  const membres = await guild.members.fetch().catch(() => guild.members.cache);
  let ajoutes = 0;
  for (const membre of membres.values()) {
    if (membre.user?.bot) continue;
    if (![...cibles].some((id) => membre.roles.cache.has(id))) continue;
    await fil.members.add(membre.id).catch(() => null);
    ajoutes += 1;
    if (ajoutes >= 100) break; // au-delà, le staff restant se joint via ManageThreads
  }
  return fil;
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
  // On accuse réception IMMÉDIATEMENT — avant tout appel réseau — pour tenir
  // dans la fenêtre de 3 s de Discord (sinon « Unknown interaction » sur une
  // connexion un peu lente). Tout le reste passe ensuite par editReply.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Un seul ticket ouvert par membre et par type.
  const existing = getOpenTicket.get(interaction.guildId, interaction.user.id, type.id);
  if (existing) {
    const channel = await interaction.guild.channels.fetch(existing.channel_id).catch(() => null);
    if (channel) {
      return interaction.editReply({
        content: `❌ Vous avez déjà un ticket **${type.label}** ouvert : <#${existing.channel_id}>`,
      });
    }
    closeTicketStmt.run(new Date().toISOString(), 'auto (salon supprimé)', existing.id);
  }

  let res;
  try {
    res = await provisionTicket(interaction.guild, type, interaction.user);
  } catch (err) {
    return interaction.editReply(
      `❌ Impossible de créer le salon : ${err.message}\nVérifiez que le bot a **Gérer les salons** et que la catégorie n'est pas pleine (50 salons max).`
    );
  }
  await interaction.editReply(`✅ Votre ticket est ouvert : ${res.channel}`);
  // Le nom du salon en clair : une fois le ticket fermé et le salon supprimé,
  // la mention <#id> de ce log afficherait « #inconnu » pour toujours.
  await sendLog(
    interaction.guild,
    logEmbed('🎫 Ticket ouvert', `Ticket **${type.label}** n°${res.num} ouvert par <@${interaction.user.id}> → <#${res.channel.id}> (**#${res.channel.name}**)`, COLORS.INFO)
  );
}

// Ouverture d'un ticket PAR LE STAFF pour un membre donné (commande /ticket creer-pour).
async function openTicketFor(interaction, typeId, targetUser) {
  const type = getType.get(typeId, interaction.guildId);
  if (!type) {
    return interaction.reply({ content: '❌ Type de ticket introuvable.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const existing = getOpenTicket.get(interaction.guildId, targetUser.id, type.id);
  if (existing) {
    const channel = await interaction.guild.channels.fetch(existing.channel_id).catch(() => null);
    if (channel) {
      return interaction.editReply({
        content: `❌ <@${targetUser.id}> a déjà un ticket **${type.label}** ouvert : <#${existing.channel_id}>`,
      });
    }
    closeTicketStmt.run(new Date().toISOString(), 'auto (salon supprimé)', existing.id);
  }
  let res;
  try {
    res = await provisionTicket(interaction.guild, type, targetUser);
  } catch (err) {
    return interaction.editReply(`❌ Impossible de créer le salon : ${err.message}\nVérifiez que le bot a **Gérer les salons**.`);
  }
  await interaction.editReply(`✅ Ticket **${type.label}** ouvert pour <@${targetUser.id}> : ${res.channel}`);
  await sendLog(
    interaction.guild,
    logEmbed('🎫 Ticket ouvert par le staff', `Ticket **${type.label}** n°${res.num} ouvert pour <@${targetUser.id}> par <@${interaction.user.id}> → <#${res.channel.id}>`, COLORS.INFO)
  );
}

// Ajoute un membre au ticket courant (commande /ticket ajouter, dans le salon).
async function addMemberToTicket(interaction, targetUser) {
  const ticket = getTicketByChannel.get(interaction.guildId, interaction.channelId);
  if (!ticket || ticket.status !== 'ouvert') {
    return interaction.reply({
      content: '❌ Cette commande doit être utilisée **dans un salon de ticket ouvert**.',
      flags: MessageFlags.Ephemeral,
    });
  }
  const type = ticket.type_id ? getType.get(ticket.type_id, interaction.guildId) : null;
  const isOwner = interaction.user.id === ticket.user_id;
  if (!isOwner && !canManageTicket(interaction.member, type)) {
    return interaction.reply({
      content: '⛔ Seuls l\'auteur du ticket, l\'équipe support ou le staff peuvent ajouter un membre.',
      flags: MessageFlags.Ephemeral,
    });
  }
  // Vérifs synchrones faites → on accuse réception avant l'appel réseau.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ok = await interaction.channel.permissionOverwrites
    .edit(targetUser.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
    })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    return interaction.editReply('❌ Impossible d\'ajouter ce membre (le bot a-t-il **Gérer les permissions** ?).');
  }
  await interaction.channel
    .send({ content: `➕ <@${targetUser.id}> a été ajouté au ticket par <@${interaction.user.id}>.` })
    .catch(() => null);
  await interaction.editReply(`✅ <@${targetUser.id}> a été ajouté au ticket.`);
  await sendLog(
    interaction.guild,
    logEmbed('🎫 Membre ajouté à un ticket', `<@${targetUser.id}> ajouté au ticket <#${interaction.channelId}> par <@${interaction.user.id}>.`, COLORS.INFO)
  );
}

// Réédite le message d'un panneau, quelle que soit sa famille de composants.
// Un panneau publié en CARTE n'a ni `content` ni `embeds` : le rééditer avec
// `embeds` est refusé par Discord (« MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_
// COMPONENTS_V2 »). On reconstruit donc le contenu en composants — même
// moteur que l'envoi, même rendu.
async function editerMessagePanneau(guild, client, message, payload) {
  const { enComposants, estCarte } = require('./reponse');
  if (!estCarte(message)) return message.edit(payload);
  const composants = enComposants(guild, client, payload);
  if (!composants || !composants.length) {
    throw new Error('le contenu ne tient pas dans une carte — raccourcissez le panneau');
  }
  return message.edit({ components: composants });
}

// Salon de destination du transcript : salon dédié configuré, sinon — par
// défaut — le salon de logs de sécurité.
async function transcriptChannelOf(guild) {
  const cfg = getGuildConfig(guild.id);
  const id = cfg.ticket_transcript_channel_id || cfg.log_channel_id;
  if (!id) return null;
  const channel = await guild.channels.fetch(id).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}

// Génère et envoie le transcript (100 derniers messages) du salon du ticket.
// Renvoie true si un transcript a été posté, false sinon (aucun salon dispo).
async function sendTranscript(interaction, ticket, byId) {
  try {
    const target = await transcriptChannelOf(interaction.guild);
    if (!target) return false;
    const type = ticket.type_id ? getType.get(ticket.type_id, interaction.guildId) : null;
    const messages = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => null);
    const lines = messages
      ? [...messages.values()]
          .reverse()
          .map(
            (m) =>
              `[${new Date(m.createdTimestamp).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}] ${m.author.tag} : ${m.content || '(embed/fichier)'}`
          )
      : ['(historique indisponible)'];
    const texte = lines.join('\n') || '(vide)';
    const file = new AttachmentBuilder(Buffer.from(texte, 'utf8'), {
      name: `transcript-ticket-${ticket.id}.txt`,
    });
    // 🪪 Le salon du ticket est SUPPRIMÉ cinq secondes plus tard : une mention
    // <#id> afficherait « #inconnu » pour toujours. On écrit donc son NOM, et
    // chaque personne est nommée en clair avec son ID, comme partout ailleurs.
    const J = require('./journal');
    const proprio = await interaction.guild.members.fetch(ticket.user_id).catch(() => null);
    const fermeur = String(byId) === String(interaction.user?.id)
      ? interaction.user
      : await interaction.guild.members.fetch(byId).catch(() => null);
    const ouverture = Date.parse(ticket.created_at || '') || null;
    const entete = logEmbed(
      '🎫 Ticket fermé & archivé',
      M.description([
        M.bloc('Le ticket', [
          `${type?.emoji ? `${type.emoji} ` : ''}**${type?.label || 'Ticket'}** — salon **#${interaction.channel?.name || '?'}**`,
          `Ouvert par ${proprio ? J.etiquetteMembre(proprio) : J.mentionAvecId(ticket.user_id)}${ouverture ? ` <t:${Math.floor(ouverture / 1000)}:f>` : ''}`,
          `Fermé par ${fermeur ? J.etiquetteMembre(fermeur) : J.mentionAvecId(byId)}`,
        ], { prefixe: '🎫', compte: null }),
        M.bloc('L\'archive', [
          `**${lines.length}** message(s) conservé(s) — le transcript complet est joint à cette carte`,
        ], { prefixe: '🗂️', compte: null }),
      ]),
      COLORS.WARNING
    );

    // 🔕 L'archive ne sonne personne : les étiquettes de la carte s'affichent,
    // sans notifier — même une fois convertie en carte.
    const envoye = await target.send({ embeds: [entete], files: [file], allowedMentions: { parse: [] } }).then(() => true).catch(async (err) => {
      // ⚠️ Un fichier refusé ne doit pas emporter l'archive : c'est la
      // conversation entière qui disparaîtrait avec le salon, cinq secondes
      // plus tard. On renvoie donc le texte, tronqué s'il le faut, plutôt que
      // rien du tout.
      console.warn(`⚠️ Transcript : fichier refusé (${err.message}) — envoi en texte.`);
      const extrait = texte.length > 3800 ? `${texte.slice(-3800)}\n… (début tronqué)` : texte;
      return target
        .send({
          embeds: [
            logEmbed(
              '🎫 Ticket fermé & archivé',
              `Ticket ${type ? `**${type.label}** ` : ''}de <@${ticket.user_id}>, fermé par <@${byId}>.\n`
              + '-# Le fichier a été refusé par Discord : voici la conversation en clair.\n'
              + `\`\`\`\n${extrait}\n\`\`\``,
              COLORS.WARNING
            ),
          ],
          allowedMentions: { parse: [] },
        })
        .then(() => true)
        .catch(() => false);
    });
    return envoye;
  } catch (err) {
    // Le transcript ne doit jamais bloquer la fermeture — mais un échec muet
    // laissait croire qu'il était parti.
    console.warn(`⚠️ Transcript du ticket impossible : ${err.message}`);
    return false;
  }
}

// Fermeture d'un ticket : envoie le transcript puis SUPPRIME le salon
// automatiquement (après un court délai pour laisser lire le message).
async function closeTicket(interaction, ticketId) {
  const channel = interaction.channel;
  // Recherche ROBUSTE : d'abord par salon (le bouton est DANS le salon du
  // ticket → le plus fiable), puis par id. La base peut être désynchronisée
  // (plusieurs instances du bot, redémarrage, base réinitialisée) : dans ce cas
  // on ferme QUAND MÊME le salon s'il ressemble à un ticket, pour ne jamais
  // bloquer la fermeture (« ticket introuvable »).
  const ticket =
    getTicketByChannel.get(interaction.guildId, interaction.channelId) ||
    getTicket.get(ticketId, interaction.guildId) ||
    null;
  const topic = String(channel?.topic || '');
  const topicOwnerId = (topic.match(/\((\d{5,})\)\s*$/) || [])[1] || null;
  const looksLikeTicket = !!channel && (String(channel.name || '').startsWith('ticket-') || !!topicOwnerId);
  if (!ticket && !looksLikeTicket) {
    return interaction.reply({ content: '❌ Ce salon n\'est pas un ticket.', flags: MessageFlags.Ephemeral });
  }
  const type = ticket?.type_id ? getType.get(ticket.type_id, interaction.guildId) : null;
  const isOwner = interaction.user.id === (ticket?.user_id || topicOwnerId);
  if (!isOwner && !canManageTicket(interaction.member, type)) {
    return interaction.reply({
      content: '⛔ Seuls l\'auteur du ticket, l\'équipe support ou le staff peuvent le fermer.',
      flags: MessageFlags.Ephemeral,
    });
  }
  // Marque fermé si une ligne encore ouverte existe (sinon on supprime quand même).
  if (ticket && ticket.status === 'ouvert') {
    closeTicketStmt.run(new Date().toISOString(), interaction.user.id, ticket.id);
  }
  // On accuse réception TOUT DE SUITE (fenêtre Discord de 3 s), AVANT l'archivage
  // et la suppression, qui peuvent prendre un peu de temps (récupération des
  // messages + envoi du fichier). Sinon, sur une connexion lente, la réponse
  // arriverait trop tard (« Unknown interaction »).
  const salonArchive = await transcriptChannelOf(interaction.guild);
  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle('🔒 Ticket fermé')
    .setDescription(
      `Fermé par <@${interaction.user.id}>.\n` +
        (salonArchive
          ? `📄 Transcript envoyé dans <#${salonArchive.id}>.\n`
          : '⚠️ **Aucun salon d\'archives configuré** : la conversation va être perdue.\n'
            + '-# Réglez-le dans `/config` → ⚙️ Salons → 📄 Transcripts des tickets.\n') +
        '🗑️ Ce salon va être **supprimé automatiquement**…'
    )
    .setTimestamp();
  await interaction.reply({ embeds: [embed] }).catch(() => null);
  // Travail plus lent APRÈS l'accusé de réception.
  await sendTranscript(
    interaction,
    ticket || { id: ticketId || 0, type_id: null, user_id: topicOwnerId || interaction.user.id },
    interaction.user.id
  );
  await sendLog(
    interaction.guild,
    logEmbed('🎫 Ticket fermé', `Ticket ${ticket ? `n°${ticket.id} ` : ''}(**#${channel?.name || '?'}**) fermé par <@${interaction.user.id}>.`, COLORS.WARNING)
  );
  setTimeout(() => {
    channel.delete('Ticket fermé — suppression automatique').catch(() => null);
  }, 5000);
}

// Bouton hérité « Supprimer le salon » (anciens tickets fermés) : archive puis supprime.
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
  await sendTranscript(interaction, ticket, interaction.user.id);
  await interaction.channel.delete('Ticket supprimé').catch(() => null);
}

// Après une sélection dans le menu de raisons, on ré-édite le panneau pour que
// Discord « oublie » la sélection : sinon recliquer la MÊME raison ne déclenche
// rien (le menu la considère déjà sélectionnée).
async function resetPanelMenu(interaction) {
  const msg = interaction.message;
  if (!msg) return;
  try {
    const panel = getPanelByMessage.get(interaction.guildId, msg.id);
    if (panel) {
      // ⚠️ Par editerMessagePanneau, jamais msg.edit(payload) directement :
      // sur un panneau publié en CARTE, rééditer avec des embeds est refusé
      // par Discord — l'échec était avalé ici, et le menu restait coché pour
      // toujours : impossible de re-choisir la même raison au ticket suivant.
      await editerMessagePanneau(interaction.guild, interaction.client, msg, buildPanelPayload(interaction.guildId, safeJson(panel.options)));
    } else {
      await msg.edit({ components: msg.components.map((c) => (c.toJSON ? c.toJSON() : c)) });
    }
  } catch {
    // sans importance : le ticket est déjà traité
  }
}

// 🔔 Relances taquines : le bot repingue l'auteur d'un ticket resté sans
// réponse. Plusieurs versions, tirées au hasard, pour ne pas radoter.
const RELANCES = [
  'Je crois que vous êtes passé sous un tunnel 🚇',
  'Allô ? La Terre appelle 🛰️',
  'Votre ticket prend la poussière 🧹',
  'On vous a perdu en route ? 🗺️',
  'Toujours là, ou parti chercher du pain ? 🥖',
  'Le staff attend, le café refroidit ☕',
  'Ce ticket fait la sieste depuis un moment 😴',
  'Un petit signe de vie ? 👋',
  'Votre connexion a dû tomber dans un ravin 📉',
  'On ne vous oublie pas… mais vous, si ? 🤔',
  'Message envoyé depuis un pigeon voyageur 🐦',
  'Le silence est d\'or, mais là ça devient cher 💰',
];

// ⚠️ Appelée depuis DEUX chemins : le bouton « Relancer » (interaction
// vierge) et le menu « Actions staff » (interaction déjà consommée par la
// remise à zéro du menu). `suivre` regarde l'état réel avant de choisir —
// sans quoi la relance depuis le menu échouerait silencieusement.
async function reviveTicket(interaction, ticketId) {
  const dire = (payload) => suivre(interaction, payload);
  const ticket = getTicket.get(ticketId, interaction.guildId);
  if (!ticket) {
    return dire({ content: '❌ Ce ticket n\'existe plus.', flags: MessageFlags.Ephemeral });
  }
  if (ticket.status !== 'ouvert') {
    return dire({ content: '🔒 Ce ticket est fermé : inutile de relancer.', flags: MessageFlags.Ephemeral });
  }
  const type = ticket.type_id ? getType.get(ticket.type_id, interaction.guildId) : null;
  if (!canManageTicket(interaction.member, type)) {
    return dire({ content: '⛔ Seul le staff peut relancer un ticket.', flags: MessageFlags.Ephemeral });
  }
  // Relancer l'auteur en le pinguant soi-même n'aurait aucun intérêt.
  if (ticket.user_id === interaction.user.id) {
    return dire({
      content: '🙂 C\'est votre propre ticket : la relance sert à réveiller quelqu\'un d\'autre.',
      flags: MessageFlags.Ephemeral,
    });
  }
  const texte = RELANCES[Math.floor(Math.random() * RELANCES.length)];
  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle('🔔 Petite relance')
    .setDescription(`${texte}\n\n<@${ticket.user_id}>, le staff attend votre réponse pour avancer sur ce ticket.`)
    .setFooter({ text: `Relancé par ${interaction.user.username}` })
    .setTimestamp();
  await interaction.channel.send({ content: `<@${ticket.user_id}>`, embeds: [embed] }).catch(() => null);
  return dire({ content: '🔔 Relance envoyée.', flags: MessageFlags.Ephemeral });
}


// ══════════════════════════════════════════════════════════════════
// 🛠️ ACTIONS STAFF — le menu déroulant du ticket
// ══════════════════════════════════════════════════════════════════
//
// Réservé au staff DU SERVEUR : le grade staff, ou l'un des rôles support du
// type de ticket. Rien à voir avec l'équipe du bot — celle qu'on prévient des
// mises à jour n'a aucun pouvoir ici.
//
// Le menu est visible par tout le monde (Discord n'offre pas de composant
// masqué par rôle), mais chaque action vérifie les droits avant d'agir et
// répond en éphémère à qui n'y a pas droit.

const claimTicket = db.prepare('UPDATE tickets SET claimed_by = ?, claimed_at = ? WHERE id = ?');
const getTicketById = db.prepare('SELECT * FROM tickets WHERE id = ? AND guild_id = ?');

// Discord plafonne un sélecteur de membres à 25 choix.
const MAX_MEMBRES_A_LA_FOIS = 10;

const ACTIONS_STAFF = [
  { value: 'prendre', label: 'Ticket pris en charge', description: 'M\'assigner ce ticket', emoji: '🚀' },
  { value: 'liberer', label: 'Ticket libéré', description: 'Désassigner ce ticket', emoji: '🔓' },
  { value: 'ajouter', label: 'Ajouter un membre', description: 'Ajouter quelqu\'un au ticket', emoji: '➕' },
  { value: 'retirer', label: 'Retirer un membre', description: 'Retirer quelqu\'un du ticket', emoji: '➖' },
  { value: 'relancer', label: 'Avez-vous toujours besoin de ce ticket ?', description: 'Demander si le ticket est encore actif', emoji: '🔔' },
  { value: 'infos', label: 'Ticket', description: 'Voir les détails du ticket', emoji: 'ℹ️' },
  { value: 'supprimer', label: 'Supprimer le ticket', description: 'Supprimer définitivement ce salon', emoji: '🗑️' },
];

function menuActionsStaff(ticketId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`tktstaff:${ticketId}`)
      .setPlaceholder('Actions staff…')
      .addOptions(ACTIONS_STAFF)
  );
}

// Les rangées de la carte d'un ticket : fermer / relancer (repingue l'auteur
// quand il ne répond plus) / 🙋 prendre en charge, puis les réponses types
// (/preset) s'il y en a, et le menu staff — visible de tous, Discord ne sait
// pas masquer un composant par rôle, mais chaque action vérifie les droits.
// `claim` change la tête du bouton de prise en charge ; il reste cliquable :
// un autre membre du staff peut reprendre le ticket.
function rangeesTicket(guildId, ticketId, claim = false) {
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tktclose:${ticketId}`).setLabel('Fermer le ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`tktrevive:${ticketId}`).setLabel('Relancer').setEmoji('🔔').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tktclaim:${ticketId}`)
      .setLabel(claim ? 'Pris en charge — reprendre' : 'Prendre en charge')
      .setEmoji('🙋')
      .setStyle(claim ? ButtonStyle.Secondary : ButtonStyle.Success)
  );
  const presets = require('./ticketPresets').menuPresets(guildId, ticketId);
  return [boutons, ...(presets ? [presets] : []), menuActionsStaff(ticketId)];
}

// 🙋 La prise en charge — par le BOUTON de la carte ou le menu staff. Le
// même geste : la base est mise à jour, la carte change de tête (bouton
// « Pris en charge », menus remis à zéro), et l'annonce part dans le salon.
async function prendreEnCharge(interaction, ticketId) {
  const ticket = getTicketById.get(ticketId, interaction.guildId);
  if (!ticket) {
    return interaction.reply({ content: '❌ Ticket introuvable (déjà supprimé ?).', flags: MessageFlags.Ephemeral });
  }
  const type = ticket.type_id ? getType.get(ticket.type_id, interaction.guildId) : null;
  if (!canManageTicket(interaction.member, type)) {
    if (interaction.isStringSelectMenu?.()) await resetStaffMenu(interaction).catch(() => null);
    return refuser(interaction);
  }
  const moi = interaction.user;
  if (ticket.claimed_by === moi.id) {
    await mettreAJour(interaction, { components: rangeesTicket(interaction.guildId, ticket.id, true) });
    return suivre(interaction, { content: 'ℹ️ Vous avez déjà pris ce ticket en charge.', flags: MessageFlags.Ephemeral });
  }
  claimTicket.run(moi.id, new Date().toISOString(), ticket.id);
  await mettreAJour(interaction, { components: rangeesTicket(interaction.guildId, ticket.id, true) });
  return suivre(interaction, {
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle('🚀 Ticket pris en charge')
        .setDescription(
          M.description([
            `<@${moi.id}> s'occupe désormais de ce ticket.`,
            ticket.claimed_by ? M.bloc('Reprise', [`Auparavant assigné à <@${ticket.claimed_by}>`], { prefixe: '🔄', compte: null }) : null,
          ].filter(Boolean))
        ),
    ],
  });
}

// Refus poli et éphémère : le menu est visible de tous, l'action ne l'est pas.
async function refuser(interaction) {
  return interaction.reply({
    content: '⛔ Ces actions sont réservées au **staff du serveur** et aux rôles support de ce type de ticket.',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleStaffMenu(interaction, ticketId) {
  const ticket = getTicketById.get(ticketId, interaction.guildId);
  if (!ticket) {
    return interaction.reply({ content: '❌ Ticket introuvable (déjà supprimé ?).', flags: MessageFlags.Ephemeral });
  }
  const type = ticket.type_id ? getType.get(ticket.type_id, interaction.guildId) : null;
  if (!canManageTicket(interaction.member, type)) {
    // Le menu garde l'option cochée sinon : on le remet à zéro.
    await resetStaffMenu(interaction).catch(() => null);
    return refuser(interaction);
  }

  const choix = interaction.values[0];
  const moi = interaction.user;

  // Même chemin que le bouton 🙋 de la carte : base, carte et annonce.
  if (choix === 'prendre') return prendreEnCharge(interaction, ticket.id);

  if (choix === 'liberer') {
    if (!ticket.claimed_by) {
      await resetStaffMenu(interaction);
      return suivre(interaction, { content: 'ℹ️ Ce ticket n\'est pris en charge par personne.', flags: MessageFlags.Ephemeral });
    }
    claimTicket.run(null, null, ticket.id);
    // Le bouton 🙋 redevient « Prendre en charge », et les menus se décochent.
    await mettreAJour(interaction, { components: rangeesTicket(interaction.guildId, ticket.id, false) });
    await suivre(interaction, {
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.WARNING)
          .setTitle('🔓 Ticket libéré')
          .setDescription(`<@${moi.id}> a libéré ce ticket : il attend un nouveau membre du staff.`),
      ],
    });
    return;
  }

  if (choix === 'ajouter' || choix === 'retirer') {
    // Un menu déroulant ne peut pas en ouvrir un autre à sa place : on répond
    // par un sélecteur de membres, en éphémère.
    await resetStaffMenu(interaction);
    const ajout = choix === 'ajouter';
    return suivre(interaction, {
      content: ajout
        ? '➕ Qui ajouter à ce ticket ? *(plusieurs membres possibles)*'
        : '➖ Qui retirer de ce ticket ? *(plusieurs membres possibles)*',
      components: [
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(`${ajout ? 'tktadd' : 'tktrem'}:${ticket.id}`)
            .setPlaceholder(ajout ? 'Choisissez un ou plusieurs membres' : 'Choisissez un ou plusieurs membres')
            .setMinValues(1)
            // Ajouter trois renforts un par un demandait de rouvrir le menu à
            // chaque fois — et le menu restait coché, donc il fallait passer
            // par une autre action entre chaque.
            .setMaxValues(MAX_MEMBRES_A_LA_FOIS)
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (choix === 'relancer') {
    await resetStaffMenu(interaction);
    return reviveTicket(interaction, ticket.id, true);
  }

  if (choix === 'infos') {
    await resetStaffMenu(interaction);
    return suivre(interaction, { embeds: [ficheTicket(interaction, ticket, type)], flags: MessageFlags.Ephemeral });
  }

  if (choix === 'supprimer') {
    // ⚠️ Suppression définitive du salon, transcript compris : on demande
    // confirmation. Une fausse manœuvre dans un menu ne doit pas effacer une
    // conversation entière.
    await resetStaffMenu(interaction);
    return suivre(interaction, {
      content:
        '🗑️ **Supprimer définitivement ce ticket ?**\n' +
        '-# Le salon et toute la conversation disparaissent. Préférez **Fermer le ticket** : la conversation est archivée avant suppression.',
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`tktdel:${ticket.id}`).setLabel('Supprimer définitivement').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}

// Fiche d'un ticket : qui, quand, où en est-on.
function ficheTicket(interaction, ticket, type) {
  const ouvert = new Date(ticket.opened_at);
  const quand = (d) => (Number.isNaN(d.getTime()) ? 'inconnu' : `<t:${Math.floor(d.getTime() / 1000)}:R>`);
  return new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle(`ℹ️ Ticket n°${ticket.id}${type ? ` — ${type.label}` : ''}`)
    .setDescription(
      M.description([
        M.bloc('Demandeur', [`<@${ticket.user_id}>`], { prefixe: '👤', compte: null }),
        M.bloc('Prise en charge', [
          ticket.claimed_by
            ? `<@${ticket.claimed_by}> · depuis ${quand(new Date(ticket.claimed_at))}`
            : '*Personne pour le moment*',
        ], { prefixe: '🚀', compte: null }),
        M.bloc('Ouvert', [quand(ouvert)], { prefixe: '🕰️', compte: null }),
        M.bloc('État', [ticket.status === 'ouvert' ? '🟢 Ouvert' : `🔴 ${ticket.status}`], { prefixe: '📊', compte: null }),
      ])
    );
}

// Remet le menu à zéro pour pouvoir rechoisir la MÊME action ensuite.
//
// Sans cela, Discord garde l'option cochée : rechoisir « Ajouter un membre » juste après ne déclenchait rien du tout,
// et il fallait passer par une autre entrée pour « débloquer » le menu.
//
// ⚠️ On réaffiche le message tel quel. Lui repasser ses propres composants via
// mettreAJour prenait le conteneur de la carte pour une rangée à ajouter — et
// la carte s'affichait en double à chaque action.
async function resetStaffMenu(interaction) {
  try {
    await reafficher(interaction);
  } catch {
    // Interaction déjà consommée : sans importance.
  }
}

// Ajout / retrait d'un membre choisi dans le sélecteur.
async function appliquerMembre(interaction, ticketId, ajout) {
  const ticket = getTicketById.get(ticketId, interaction.guildId);
  if (!ticket) return mettreAJour(interaction, { content: '❌ Ticket introuvable.', components: [] });
  const type = ticket.type_id ? getType.get(ticket.type_id, interaction.guildId) : null;
  if (!canManageTicket(interaction.member, type)) return refuser(interaction);

  const channel = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
  if (!channel) return mettreAJour(interaction, { content: '❌ Salon du ticket introuvable.', components: [] });

  // 👥 Plusieurs membres d'un coup. Chacun est traité séparément : un refus
  // sur l'un ne doit pas emporter les autres, et le compte rendu dit
  // exactement ce qui est passé et ce qui a échoué.
  const faits = [];
  const refuses = [];
  for (const cibleId of interaction.values) {
    if (!ajout && cibleId === ticket.user_id) {
      refuses.push(`<@${cibleId}> — c'est le **demandeur** : fermez le ticket plutôt que de l'en sortir`);
      continue;
    }
    const ok = await channel.permissionOverwrites
      .edit(cibleId, ajout
        ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }
        : { ViewChannel: false })
      .then(() => true)
      .catch(() => false);
    if (ok) faits.push(cibleId);
    else refuses.push(`<@${cibleId}> — Discord a refusé la modification`);
  }

  if (!faits.length) {
    return mettreAJour(interaction, {
      content: `❌ Aucun membre ${ajout ? 'ajouté' : 'retiré'}.\n`
        + `${refuses.map((r) => `➜ ${r}`).join('\n')}\n`
        + '-# Vérifiez que j\'ai la permission **Gérer les permissions** sur ce salon.',
      components: [],
    });
  }

  const liste = faits.map((id) => `<@${id}>`).join(', ');
  await mettreAJour(interaction, {
    content: `✅ ${liste} ${faits.length > 1 ? 'ont été' : 'a été'} ${ajout ? 'ajouté(s) au' : 'retiré(s) du'} ticket.`
      + (refuses.length ? `\n⚠️ Non traité(s) :\n${refuses.map((r) => `➜ ${r}`).join('\n')}` : ''),
    components: [],
  });
  await channel
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(ajout ? COLORS.SUCCESS : COLORS.WARNING)
          .setTitle(ajout ? '➕ Membre(s) ajouté(s)' : '➖ Membre(s) retiré(s)')
          .setDescription(`${liste} ${faits.length > 1 ? 'ont été' : 'a été'} ${ajout ? 'ajouté(s) au' : 'retiré(s) du'} ticket par <@${interaction.user.id}>.`),
      ],
    })
    .catch(() => null);
}

async function handleTicketButton(interaction) {
  try {
    // Sélecteur de raison (menu déroulant) : la valeur choisie = l'ID du type.
    if (interaction.isStringSelectMenu() && interaction.customId === 'tktmenu') {
      await openTicket(interaction, Number(interaction.values[0]));
      // Réinitialise le menu pour permettre de re-choisir la même raison.
      await resetPanelMenu(interaction);
      return;
    }
    // 📋 Réponse type choisie dans un ticket.
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('tktpreset:')) {
      const ticket = getTicket.get(Number(interaction.customId.split(':')[1]), interaction.guildId);
      const type = ticket?.type_id ? getType.get(ticket.type_id, interaction.guildId) : null;
      return await require('./ticketPresets').envoyerPreset(interaction, canManageTicket(interaction.member, type));
    }
    // 🛠️ Menu des actions staff, et sélecteurs de membre qui en découlent.
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('tktstaff:')) {
      return await handleStaffMenu(interaction, Number(interaction.customId.split(':')[1]));
    }
    if (interaction.isUserSelectMenu?.() && interaction.customId.startsWith('tktadd:')) {
      return await appliquerMembre(interaction, Number(interaction.customId.split(':')[1]), true);
    }
    if (interaction.isUserSelectMenu?.() && interaction.customId.startsWith('tktrem:')) {
      return await appliquerMembre(interaction, Number(interaction.customId.split(':')[1]), false);
    }

    const [prefix, rawId] = interaction.customId.split(':');
    const id = Number(rawId);
    if (prefix === 'tktopen') return await openTicket(interaction, id);
    if (prefix === 'tktclose') return await closeTicket(interaction, id);
    if (prefix === 'tktdel') return await deleteTicket(interaction, id);
    if (prefix === 'tktrevive') return await reviveTicket(interaction, id);
    if (prefix === 'tktclaim') return await prendreEnCharge(interaction, id);
  } catch (err) {
    console.error('Erreur ticket :', err);
    // Interaction morte (réponse trop tardive ou en double) : inutile — et
    // impossible — de répondre à nouveau, on évite juste une 2ᵉ erreur bruyante.
    if (err?.code === 10062 || err?.code === 40060) return;
    await suivre(interaction, { content: '❌ Une erreur est survenue sur ce ticket.', flags: MessageFlags.Ephemeral });
  }
}

module.exports = {
  listTypes,
  getTypeByLabel,
  insertType,
  deleteType,
  supportRoleIds,
  creerFilStaff,
  editerMessagePanneau,
  sendTranscript,
  resetPanelMenu,
  prendreEnCharge,
  rangeesTicket,
  insertPanel,
  lastPanel,
  updatePanelOptions,
  buildPanelPayload,
  reenregistrerPanneau,
  parseColor,
  safeEmoji,
  setTypeEnabled,
  openTicketFor,
  addMemberToTicket,
  startPanelCreate,
  startPanelModify,
  handlePanelBuilder,
  handleTicketButton,
};
