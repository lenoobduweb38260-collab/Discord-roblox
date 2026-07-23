const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { db, getGuildConfig, setGuildConfig } = require('../database');
const { COLORS, sendLog, logEmbed } = require('./embeds');
const { GRADES, getGrade, staffRoleIds, adminRoleIds } = require('./permissions');
const { supportRoleIds } = require('./tickets');

// Panneau central de configuration : /config ouvre une vue d'ensemble avec un
// menu de catégories ; chaque catégorie se règle via des sélecteurs de rôles,
// de salons, ou un formulaire (XP). Tout est éphémère et journalisé.

const ROLE_COLUMNS = {
  staff_role_id: '👮 Rôle Staff',
  admin_role_id: '🛡️ Rôle Administration',
  service_role_id: '🧑‍💼 Rôle « En service »',
  verified_role_id: '🤖 Rôle vérifié (captcha)',
};

const CHANNEL_COLUMNS = {
  log_channel_id: '🔐 Salon des logs de sécurité',
  level_channel_id: '📈 Salon des annonces de niveau',
  service_channel_id: '🧑‍💼 Salon des prises/fins de service',
  staff_channel_id: '📣 Salon des arrivées/départs staff',
  member_channel_id: '👋 Salon des arrivées/départs des membres',
  goodbye_channel_id: '📤 Salon des départs (sinon = arrivées)',
  update_channel_id: '📦 Salon des annonces de mise à jour',
  proof_channel_id: '🖼️ Salon des preuves (staff du bot)',
  partner_channel_id: '🤝 Salon des partenariats',
  patch_channel_id: '📝 Salon des patch notes',
  captcha_channel_id: '🤖 Salon du captcha',
};

const show = (id, kind) => (id ? (kind === 'role' ? `<@&${id}>` : `<#${id}>`) : '*Non configuré*');

const listWhitelistMappings = db.prepare(
  'SELECT * FROM whitelist_managers WHERE guild_id = ? ORDER BY role_id'
);

const listTicketTypes = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? ORDER BY id');
const getTicketType = db.prepare('SELECT * FROM ticket_types WHERE id = ? AND guild_id = ?');
const getTicketTypeByLabel = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? AND label = ?');
const countTicketTypes = db.prepare('SELECT COUNT(*) AS n FROM ticket_types WHERE guild_id = ?');
const insertTicketType = db.prepare(
  'INSERT INTO ticket_types (guild_id, label, emoji, category_id, support_role_id) VALUES (?, ?, ?, ?, ?)'
);
const deleteTicketTypeStmt = db.prepare('DELETE FROM ticket_types WHERE id = ? AND guild_id = ?');
const setTicketSupport = db.prepare('UPDATE ticket_types SET support_role_id = ?, support_role_ids = ? WHERE id = ? AND guild_id = ?');

// Création d'un type de ticket en deux étapes (formulaire nom/emoji, puis
// catégorie) : mémoire temporaire entre les deux interactions.
const pendingTicketTypes = new Map(); // `${guildId}:${userId}` → { label, emoji }

function whitelistSummary(guildId) {
  const rows = listWhitelistMappings.all(guildId);
  if (!rows.length) return '*Aucun rôle métier configuré*';
  const byRole = new Map();
  for (const r of rows) {
    if (!byRole.has(r.role_id)) byRole.set(r.role_id, []);
    byRole.get(r.role_id).push(r.manager_role_id);
  }
  return [...byRole.entries()]
    .map(([roleId, managers]) => `• <@&${roleId}> ← gérants : ${managers.map((m) => `<@&${m}>`).join(', ')}`)
    .join('\n');
}

function backRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgback').setLabel('⬅ Retour au panneau').setStyle(ButtonStyle.Secondary)
  );
}

// ----- Vue principale : toutes les catégories en un coup d'œil -----
function mainView(guild) {
  const cfg = getGuildConfig(guild.id);
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('⚙️ Panneau de configuration')
    .setDescription('Vue d\'ensemble de la configuration. Choisissez une **catégorie** dans le menu ci-dessous pour la modifier.')
    .addFields(
      {
        name: '👮 Rôles',
        value: [
          `Staff : ${staffRoleIds(cfg).map((id) => `<@&${id}>`).join(' ') || '*Non configuré*'}`,
          `Administration : ${adminRoleIds(cfg).map((id) => `<@&${id}>`).join(' ') || '*Non configuré*'}`,
          `En service : ${show(cfg.service_role_id, 'role')}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '📢 Salons',
        value: [
          `Logs sécurité : ${show(cfg.log_channel_id, 'channel')}`,
          `Niveaux : ${show(cfg.level_channel_id, 'channel')}`,
          `Service : ${show(cfg.service_channel_id, 'channel')}`,
          `Staff (arrivées/départs) : ${show(cfg.staff_channel_id, 'channel')}`,
          `Mises à jour : ${cfg.update_channel_id ? `<#${cfg.update_channel_id}>` : '*Non configuré — #shadow-logs sera créé automatiquement*'}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '📈 XP & niveaux',
        value: [
          `Texte : **${cfg.xp_text}** XP/message (cooldown **${cfg.xp_cooldown}** s)`,
          `Vocal : **${cfg.xp_voice}** XP/minute`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '🎭 Module RP',
        value: cfg.rp_enabled
          ? '🟢 **Activé** — /carte, /permis, /entreprise, /assurance, /service, /temps disponibles'
          : '🔴 **Désactivé** — les commandes RP sont masquées sur ce serveur',
        inline: false,
      },
      { name: '📋 Whitelist métiers', value: whitelistSummary(guild.id), inline: false },
      {
        name: '🎫 Tickets',
        value: (() => {
          const types = listTicketTypes.all(guild.id);
          return types.length
            ? types.map((t) => `${t.emoji ? t.emoji + ' ' : ''}**${t.label}**`).join(' · ')
            : '*Aucun type de ticket configuré*';
        })(),
        inline: false,
      },
      {
        name: '📡 Réseaux sociaux',
        value: (() => {
          const { PLATFORMS, listGuildFeeds } = require('./socialWatch');
          const feeds = listGuildFeeds.all(guild.id);
          return feeds.length
            ? feeds.map((f) => `${PLATFORMS[f.platform]?.emoji || '📡'} \`${f.handle}\``).join(' · ')
            : '*Aucun réseau suivi*';
        })(),
        inline: false,
      }
    )
    .setFooter({ text: 'Seul le staff peut utiliser ce panneau • Le rôle Administration ne peut être changé que par un admin' });

  const categoryRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cfgcat')
      .setPlaceholder('⚙️ Choisissez une catégorie à configurer…')
      .addOptions(
        { label: 'Modules (RP, Interactions, SAO)', value: 'rp', emoji: '🎭', description: 'Activer/désactiver RP, Interactions et Aventure SAO' },
        { label: 'Rôles', value: 'roles', emoji: '👮', description: 'Staff, administration, en service' },
        { label: 'Salons', value: 'salons', emoji: '📢', description: 'Logs, niveaux, service, staff' },
        { label: 'XP & niveaux', value: 'xp', emoji: '📈', description: 'XP texte, XP vocal, cooldown' },
        { label: 'Sécurité', value: 'securite', emoji: '🛡️', description: 'Anti-spam, anti-nuke, captcha' },
        { label: 'Whitelist métiers', value: 'whitelist', emoji: '📋', description: 'Autorisations des gérants' },
        { label: 'Tickets', value: 'tickets', emoji: '🎫', description: 'Types de tickets, catégories, rôles support' },
        { label: 'Réseaux sociaux', value: 'reseaux', emoji: '📡', description: 'Annonces des lives et nouvelles vidéos' }
      )
  );
  return { embeds: [embed], components: [categoryRow] };
}

// ----- Catégorie : rôles (PLUSIEURS rôles staff/administration possibles) -----
function rolesView(guild) {
  const cfg = getGuildConfig(guild.id);
  const staffIds = staffRoleIds(cfg);
  const adminIds = adminRoleIds(cfg);
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('👮 Configuration — Rôles')
    .setDescription(
      [
        `👮 Rôles Staff : ${staffIds.map((id) => `<@&${id}>`).join(' ') || '*Non configuré*'}`,
        `🛡️ Rôles Administration : ${adminIds.map((id) => `<@&${id}>`).join(' ') || '*Non configuré*'}`,
        `🧑‍💼 Rôle « En service » : ${show(cfg.service_role_id, 'role')}`,
      ].join('\n') +
        '\n\nSélectionnez **un ou plusieurs rôles** dans les menus Staff/Administration — ' +
        'tous les membres ayant l\'un de ces rôles auront le grade correspondant.'
    );
  const staffMenu = new RoleSelectMenuBuilder()
    .setCustomId('cfgmrole:staff')
    .setPlaceholder('👮 Rôles Staff (plusieurs possibles)')
    .setMinValues(1)
    .setMaxValues(10);
  if (staffIds.length) staffMenu.setDefaultRoles(staffIds.slice(0, 10));
  const adminMenu = new RoleSelectMenuBuilder()
    .setCustomId('cfgmrole:admin')
    .setPlaceholder('🛡️ Rôles Administration (plusieurs possibles)')
    .setMinValues(1)
    .setMaxValues(10);
  if (adminIds.length) adminMenu.setDefaultRoles(adminIds.slice(0, 10));
  const serviceMenu = new RoleSelectMenuBuilder()
    .setCustomId('cfgrole:service_role_id')
    .setPlaceholder('🧑‍💼 Rôle « En service »')
    .setMinValues(1)
    .setMaxValues(1);
  if (cfg.service_role_id) serviceMenu.setDefaultRoles(cfg.service_role_id);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(staffMenu),
      new ActionRowBuilder().addComponents(adminMenu),
      new ActionRowBuilder().addComponents(serviceMenu),
      backRow(),
    ],
  };
}

// ----- Catégorie : salons (choix du réglage, puis choix du salon) -----
function salonsView(guild, selectedCol = null) {
  const cfg = getGuildConfig(guild.id);
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('📢 Configuration — Salons')
    .setDescription(
      Object.entries(CHANNEL_COLUMNS)
        .map(([col, label]) => `${label} : ${show(cfg[col], 'channel')}`)
        .join('\n') +
        '\n\n1️⃣ Choisissez le réglage, 2️⃣ puis le salon.' +
        '\n\n📦 *Sans salon de mises à jour configuré, le bot crée automatiquement **#shadow-logs**, visible uniquement du staff, et y publie les annonces.*'
    );
  const picker = new StringSelectMenuBuilder()
    .setCustomId('cfgchansel')
    .setPlaceholder('1️⃣ Quel salon voulez-vous configurer ?')
    .addOptions(
      Object.entries(CHANNEL_COLUMNS).map(([col, label]) => ({
        label: label.replace(/^\S+\s/, ''),
        value: col,
        emoji: label.split(' ')[0],
        default: col === selectedCol,
      }))
    );
  const components = [new ActionRowBuilder().addComponents(picker)];
  if (selectedCol && CHANNEL_COLUMNS[selectedCol]) {
    const menu = new ChannelSelectMenuBuilder()
      .setCustomId(`cfgchan:${selectedCol}`)
      .setPlaceholder(`2️⃣ ${CHANNEL_COLUMNS[selectedCol]}`)
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1);
    if (cfg[selectedCol]) menu.setDefaultChannels(cfg[selectedCol]);
    components.push(new ActionRowBuilder().addComponents(menu));
  }
  components.push(backRow());
  return { embeds: [embed], components };
}

// ----- Catégorie : XP -----
function xpView(guild) {
  const cfg = getGuildConfig(guild.id);
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('📈 Configuration — XP & niveaux')
    .addFields(
      { name: '✍️ XP texte', value: `**${cfg.xp_text}** XP/message`, inline: true },
      { name: '🎙️ XP vocal', value: `**${cfg.xp_voice}** XP/minute`, inline: true },
      { name: '⏱️ Cooldown texte', value: `**${cfg.xp_cooldown}** secondes`, inline: true }
    )
    .setDescription('Cliquez sur **Modifier** pour changer les valeurs.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgxp').setLabel('✏️ Modifier les valeurs').setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row, backRow()] };
}

// ----- Catégorie : Sécurité (anti-spam, anti-nuke, captcha) -----
function securiteView(guild) {
  const cfg = getGuildConfig(guild.id);
  const on = (v) => (v ? '✅ activé' : '❌ désactivé');
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🛡️ Configuration — Sécurité')
    .setDescription(
      [
        `🚨 **Anti-spam + filtre anti-injection** : ${on(cfg.antispam_enabled)}`,
        '   ↳ bloque flood, invitations, mentions massives, arnaques, zalgo',
        `💣 **Anti-nuke** : ${on(cfg.antinuke_enabled)}`,
        '   ↳ quarantaine en cas d\'actions destructives massives',
        `🤖 **Captcha à l'arrivée** : ${on(cfg.captcha_enabled)}`,
        `   ↳ Rôle vérifié : ${show(cfg.verified_role_id, 'role')} · Salon : ${show(cfg.captcha_channel_id, 'channel')}`,
      ].join('\n')
    )
    .setFooter({ text: 'Boutons = activer/désactiver • Menus = rôle vérifié et salon du captcha' });
  const toggles = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgsec:antispam_enabled').setLabel('Anti-spam').setEmoji(cfg.antispam_enabled ? '🟢' : '🔴').setStyle(cfg.antispam_enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cfgsec:antinuke_enabled').setLabel('Anti-nuke').setEmoji(cfg.antinuke_enabled ? '🟢' : '🔴').setStyle(cfg.antinuke_enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cfgsec:captcha_enabled').setLabel('Captcha').setEmoji(cfg.captcha_enabled ? '🟢' : '🔴').setStyle(cfg.captcha_enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
  );
  const roleMenu = new RoleSelectMenuBuilder()
    .setCustomId('cfgrole:verified_role_id')
    .setPlaceholder('🤖 Rôle donné après le captcha')
    .setMinValues(1)
    .setMaxValues(1);
  if (cfg.verified_role_id) roleMenu.setDefaultRoles(cfg.verified_role_id);
  const chanMenu = new ChannelSelectMenuBuilder()
    .setCustomId('cfgchan:captcha_channel_id')
    .setPlaceholder('🤖 Salon du captcha')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);
  if (cfg.captcha_channel_id) chanMenu.setDefaultChannels(cfg.captcha_channel_id);
  return {
    embeds: [embed],
    components: [toggles, new ActionRowBuilder().addComponents(roleMenu), new ActionRowBuilder().addComponents(chanMenu), backRow()],
  };
}

// ----- Catégorie : whitelist métiers (lecture + rappel des commandes) -----
function whitelistView(guild) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('📋 Configuration — Whitelist métiers')
    .setDescription(whitelistSummary(guild.id))
    .addFields({
      name: 'Gérer les autorisations',
      value:
        '• `/whitelist config ajouter role:@Métier gerant:@Gérant` — autoriser un gérant *(admin)*\n' +
        '• `/whitelist config retirer role:@Métier [gerant:@Gérant]` — retirer *(admin)*\n' +
        '• `/whitelist ajouter utilisateur:@membre role:@Métier` — whitelister une recrue',
    });
  return { embeds: [embed], components: [backRow()] };
}

// ----- Catégorie : Module RP (cartes, permis, entreprises, assurances, service) -----
function rpView(guild) {
  const cfg = getGuildConfig(guild.id);
  const enabled = Boolean(cfg.rp_enabled);
  const locked = Boolean(cfg.rp_locked);
  const embed = new EmbedBuilder()
    .setColor(enabled ? COLORS.SUCCESS : COLORS.DANGER)
    .setTitle('🎭 Module RP')
    .setDescription(
      `État : ${enabled ? '🟢 **Activé**' : '🔴 **Désactivé**'}${locked ? ' · 🔒 **Verrouillé**' : ''}\n\n` +
        'Le Module RP regroupe :\n🪪 `/carte` · 🚗 `/permis` · 🏢 `/entreprise` · 🛡️ `/assurance` · 🧑‍💼 `/service` · ⏱️ `/temps`\n\n' +
        'Désactivé, ces commandes sont **retirées de la liste du serveur** — seules les commandes de base du bot restent visibles. ' +
        'La synchronisation est appliquée immédiatement après le changement.' +
        (locked
          ? '\n\n🔒 Ce réglage est **verrouillé par l\'administrateur du bot** : il ne peut être modifié que depuis le gestionnaire des bots.'
          : '')
    );
  const interactOn = Boolean(cfg.interact_enabled);
  embed.addFields({
    name: '🎮 Module Interactions',
    value:
      `État : ${interactOn ? '🟢 **Activé**' : '🔴 **Désactivé**'}\n` +
      '`/interact` (câlin, tape, gifle… façon Nekotina). Désactivé par défaut.',
  });
  const saoOn = Boolean(cfg.sao_enabled);
  embed.addFields({
    name: '⚔️ Module Aventure SAO',
    value:
      `État : ${saoOn ? '🟢 **Activé**' : '🔴 **Désactivé**'}\n` +
      '`/sao` : jeu d\'aventure (100 étages d\'Aincrad) — badges, XP auto, gains AFK. Désactivé par défaut.',
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgrpon').setLabel('Activer le Module RP').setEmoji('🟢').setStyle(ButtonStyle.Success).setDisabled(enabled || locked),
    new ButtonBuilder().setCustomId('cfgrpoff').setLabel('Désactiver le RP').setEmoji('🔴').setStyle(ButtonStyle.Danger).setDisabled(!enabled || locked)
  );
  const rowInteract = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfginton').setLabel('Activer les Interactions').setEmoji('🎮').setStyle(ButtonStyle.Success).setDisabled(interactOn),
    new ButtonBuilder().setCustomId('cfgintoff').setLabel('Désactiver').setEmoji('🔴').setStyle(ButtonStyle.Danger).setDisabled(!interactOn)
  );
  const rowSao = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgsaoon').setLabel('Activer l\'Aventure SAO').setEmoji('⚔️').setStyle(ButtonStyle.Success).setDisabled(saoOn),
    new ButtonBuilder().setCustomId('cfgsaooff').setLabel('Désactiver').setEmoji('🔴').setStyle(ButtonStyle.Danger).setDisabled(!saoOn)
  );
  return { embeds: [embed], components: [row, rowInteract, rowSao, backRow()] };
}

// ----- Catégorie : réseaux sociaux (annonces lives / nouvelles vidéos) -----
function reseauxView(guild) {
  const { PLATFORMS, listGuildFeeds } = require('./socialWatch');
  const feeds = listGuildFeeds.all(guild.id);
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('📡 Configuration — Réseaux sociaux')
    .setDescription(
      (feeds.length
        ? feeds
            .map((f) => `• ${PLATFORMS[f.platform]?.emoji || '📡'} **${PLATFORMS[f.platform]?.label || f.platform}** — \`${f.handle}\` → <#${f.channel_id}>`)
            .join('\n')
        : '*Aucun réseau suivi.*') +
        '\n\nLe bot vérifie **toutes les 5 minutes** et annonce automatiquement les **lives Twitch** ' +
        'et les **nouvelles vidéos/publications** (YouTube, TikTok, X, Reddit) dans le salon choisi.'
    )
    .addFields({
      name: 'Gérer les réseaux suivis',
      value:
        '• `/reseaux ajouter plateforme identifiant salon [message]` — suivre une chaîne/un compte\n' +
        '• `/reseaux retirer flux` — ne plus suivre\n' +
        '• `/reseaux liste` — voir les suivis\n' +
        'Message personnalisé : variables `{nom}`, `{titre}`, `{lien}`',
    });
  return { embeds: [embed], components: [backRow()] };
}

// ----- Catégorie : tickets (types, catégories Discord, rôles support) -----
function ticketsView(guild, selectedId = null) {
  const types = listTicketTypes.all(guild.id);
  const summary = types.length
    ? types
        .map((t) => {
          const cat = guild.channels.cache.get(t.category_id)?.name || t.category_id || '?';
          const roles = supportRoleIds(t).map((r) => `<@&${r}>`).join(' ');
          const support = roles ? ` — support ${roles}` : '';
          return `• ${t.emoji ? t.emoji + ' ' : ''}**${t.label}** — catégorie « ${cat} »${support}`;
        })
        .join('\n')
    : '*Aucun type de ticket configuré*';
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🎫 Configuration — Tickets')
    .setDescription(
      summary +
        '\n\n➕ Ajoutez un type, ou sélectionnez-en un pour définir son **rôle support** ou le **supprimer**.' +
        '\n⚠️ Après un ajout ou une suppression, republiez le panneau : `/ticket panneau-modifier`.'
    );
  const components = [];
  if (types.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('cfgtktsel')
          .setPlaceholder('🎫 Sélectionnez un type à gérer…')
          .addOptions(
            types.slice(0, 25).map((t) => ({
              label: `${t.emoji ? t.emoji + ' ' : ''}${t.label}`.slice(0, 100),
              value: String(t.id),
              default: t.id === selectedId,
            }))
          )
      )
    );
  }
  const selected = selectedId ? types.find((t) => t.id === selectedId) : null;
  if (selected) {
    const current = supportRoleIds(selected);
    const menu = new RoleSelectMenuBuilder()
      .setCustomId(`cfgtktrole:${selected.id}`)
      .setPlaceholder(`🛎️ Rôles support de « ${selected.label} » (plusieurs possibles)`.slice(0, 150))
      .setMinValues(1)
      .setMaxValues(10);
    if (current.length) menu.setDefaultRoles(current.slice(0, 10));
    components.push(new ActionRowBuilder().addComponents(menu));
  }
  const buttons = [
    new ButtonBuilder().setCustomId('cfgtktadd').setLabel('➕ Ajouter un type').setStyle(ButtonStyle.Primary),
  ];
  if (selected) {
    buttons.push(
      new ButtonBuilder().setCustomId(`cfgtktdel:${selected.id}`).setLabel('🗑 Supprimer ce type').setStyle(ButtonStyle.Danger)
    );
  }
  buttons.push(new ButtonBuilder().setCustomId('cfgback').setLabel('⬅ Retour').setStyle(ButtonStyle.Secondary));
  components.push(new ActionRowBuilder().addComponents(...buttons));
  return { embeds: [embed], components };
}

// Étape 2 de la création : choix de la catégorie Discord des salons de tickets.
function ticketCategoryView(pendingLabel) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🎫 Nouveau type de ticket')
    .setDescription(
      `Type « **${pendingLabel}** » : choisissez la **catégorie Discord** où les salons de ce type de ticket seront créés.`
    );
  const row = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('cfgtktcat')
      .setPlaceholder('📁 Catégorie des salons de tickets')
      .setChannelTypes(ChannelType.GuildCategory)
      .setMinValues(1)
      .setMaxValues(1)
  );
  return { embeds: [embed], components: [row, backRow()] };
}

function ticketModal() {
  return new ModalBuilder()
    .setCustomId('cfgtktmodal')
    .setTitle('🎫 Nouveau type de ticket')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tkt_nom')
          .setLabel('Nom du type (ex : Support)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(60)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tkt_emoji')
          .setLabel('Emoji (optionnel)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(30)
      )
    );
}

const CATEGORY_VIEWS = { rp: rpView, roles: rolesView, salons: salonsView, xp: xpView, securite: securiteView, whitelist: whitelistView, tickets: ticketsView, reseaux: reseauxView };
const SECURITY_TOGGLES = new Set(['antispam_enabled', 'antinuke_enabled', 'captcha_enabled']);

function xpModal(cfg) {
  const field = (id, label, value) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(value))
        .setMaxLength(5)
    );
  return new ModalBuilder()
    .setCustomId('cfgxpmodal')
    .setTitle('📈 Réglages XP')
    .addComponents(
      field('xp_text', 'XP par message (1 à 1000)', cfg.xp_text),
      field('xp_voice', 'XP par minute en vocal (1 à 1000)', cfg.xp_voice),
      field('xp_cooldown', 'Cooldown XP texte en secondes (5 à 3600)', cfg.xp_cooldown)
    );
}

// ----- Routeur des interactions du panneau (customId commençant par "cfg") -----
async function handleConfigInteraction(interaction) {
  try {
    const grade = getGrade(interaction.member);
    if (grade < GRADES.STAFF) {
      return await interaction.reply({
        content: '⛔ Sécurité : ce panneau est réservé au **staff**.',
        flags: MessageFlags.Ephemeral,
      });
    }
    const id = interaction.customId;

    if (id === 'cfgback') {
      return await interaction.update(mainView(interaction.guild));
    }

    if (id === 'cfgcat') {
      const view = CATEGORY_VIEWS[interaction.values[0]];
      if (!view) return;
      return await interaction.update(view(interaction.guild));
    }

    // Sécurité : bascule anti-spam / anti-nuke / captcha.
    if (id.startsWith('cfgsec:')) {
      const col = id.split(':')[1];
      if (!SECURITY_TOGGLES.has(col)) return;
      const next = getGuildConfig(interaction.guildId)[col] ? 0 : 1;
      setGuildConfig(interaction.guildId, col, next);
      await interaction.update(securiteView(interaction.guild));
      await sendLog(
        interaction.guild,
        logEmbed('🛡️ Sécurité modifiée', `\`${col}\` → ${next ? 'activé' : 'désactivé'} par <@${interaction.user.id}>.`, COLORS.INFO)
      );
      return;
    }

    if (id.startsWith('cfgrole:')) {
      const col = id.split(':')[1];
      if (!(col in ROLE_COLUMNS)) return;
      // Sécurité grade élevé : seul un admin peut changer le rôle Administration.
      if (col === 'admin_role_id' && grade < GRADES.ADMIN) {
        return await interaction.reply({
          content: '⛔ Sécurité : seul un membre de l\'**administration** peut changer le rôle Administration.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const roleId = interaction.values[0];
      setGuildConfig(interaction.guildId, col, roleId);
      await interaction.update(col === 'verified_role_id' ? securiteView(interaction.guild) : rolesView(interaction.guild));
      await sendLog(
        interaction.guild,
        logEmbed('⚙️ Configuration modifiée', `${ROLE_COLUMNS[col]} → <@&${roleId}>\nPar <@${interaction.user.id}>`, COLORS.INFO)
      );
      return;
    }

    // Rôles staff / administration MULTIPLES.
    if (id.startsWith('cfgmrole:')) {
      const kind = id.split(':')[1]; // 'staff' | 'admin'
      if (!['staff', 'admin'].includes(kind)) return;
      // Sécurité grade élevé : seuls les admins touchent aux rôles Administration.
      if (kind === 'admin' && grade < GRADES.ADMIN) {
        return await interaction.reply({
          content: '⛔ Sécurité : seul un membre de l\'**administration** peut changer les rôles Administration.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const ids = interaction.values.slice(0, 10);
      setGuildConfig(interaction.guildId, `${kind}_role_ids`, JSON.stringify(ids));
      setGuildConfig(interaction.guildId, `${kind}_role_id`, ids[0] || null); // compatibilité colonne historique
      await interaction.update(rolesView(interaction.guild));
      await sendLog(
        interaction.guild,
        logEmbed(
          '⚙️ Configuration modifiée',
          `Rôles ${kind === 'staff' ? 'Staff' : 'Administration'} → ${ids.map((r) => `<@&${r}>`).join(' ')}\nPar <@${interaction.user.id}>`,
          COLORS.INFO
        )
      );
      return;
    }

    if (id === 'cfgrpon' || id === 'cfgrpoff') {
      // Verrouillage administrateur : le réglage ne peut plus être changé
      // depuis le serveur, uniquement depuis le gestionnaire des bots.
      if (getGuildConfig(interaction.guildId).rp_locked) {
        return await interaction.reply({
          content: '🔒 Réglage **verrouillé par l\'administrateur du bot** — modifiable uniquement depuis le gestionnaire.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const enable = id === 'cfgrpon' ? 1 : 0;
      setGuildConfig(interaction.guildId, 'rp_enabled', enable);
      await interaction.update(rpView(interaction.guild));
      require('../commandSync')
        .syncGuild(interaction.guildId)
        .then(() =>
          interaction.followUp({
            content: enable
              ? '🟢 Module RP **activé** — les commandes RP sont maintenant visibles sur le serveur.'
              : '🔴 Module RP **désactivé** — les commandes RP ont été retirées du serveur.',
            flags: MessageFlags.Ephemeral,
          })
        )
        .catch((err) =>
          interaction.followUp({ content: `⚠️ Synchronisation des commandes : ${err.message}`, flags: MessageFlags.Ephemeral })
        );
      await sendLog(
        interaction.guild,
        logEmbed('🎭 Module RP', `Module RP ${enable ? 'activé' : 'désactivé'} par <@${interaction.user.id}>.`, enable ? COLORS.SUCCESS : COLORS.DANGER)
      );
      return;
    }

    // Module Interactions : activer / désactiver (par serveur).
    if (id === 'cfginton' || id === 'cfgintoff') {
      const enable = id === 'cfginton' ? 1 : 0;
      setGuildConfig(interaction.guildId, 'interact_enabled', enable);
      await interaction.update(rpView(interaction.guild));
      await sendLog(
        interaction.guild,
        logEmbed('🎮 Module Interactions', `Interactions ${enable ? 'activées' : 'désactivées'} par <@${interaction.user.id}>.`, enable ? COLORS.SUCCESS : COLORS.DANGER)
      );
      return;
    }

    // Module Aventure SAO : activer / désactiver (par serveur).
    if (id === 'cfgsaoon' || id === 'cfgsaooff') {
      const enable = id === 'cfgsaoon' ? 1 : 0;
      setGuildConfig(interaction.guildId, 'sao_enabled', enable);
      await interaction.update(rpView(interaction.guild));
      await sendLog(
        interaction.guild,
        logEmbed('⚔️ Module Aventure SAO', `Aventure SAO ${enable ? 'activée' : 'désactivée'} par <@${interaction.user.id}>.`, enable ? COLORS.SUCCESS : COLORS.DANGER)
      );
      return;
    }

    // ----- Tickets : sélection, création (formulaire → catégorie), support, suppression -----
    if (id === 'cfgtktsel') {
      return await interaction.update(ticketsView(interaction.guild, Number(interaction.values[0])));
    }

    if (id === 'cfgtktadd') {
      if (countTicketTypes.get(interaction.guildId).n >= 25) {
        return await interaction.reply({
          content: '❌ Maximum 25 types de tickets (limite des boutons Discord).',
          flags: MessageFlags.Ephemeral,
        });
      }
      return await interaction.showModal(ticketModal());
    }

    if (id === 'cfgtktmodal') {
      const label = interaction.fields.getTextInputValue('tkt_nom').trim().slice(0, 60);
      const emoji = interaction.fields.getTextInputValue('tkt_emoji').trim() || null;
      if (!label) {
        return await interaction.reply({ content: '❌ Le nom du type est requis.', flags: MessageFlags.Ephemeral });
      }
      if (getTicketTypeByLabel.get(interaction.guildId, label)) {
        return await interaction.reply({ content: `❌ Le type « ${label} » existe déjà.`, flags: MessageFlags.Ephemeral });
      }
      pendingTicketTypes.set(`${interaction.guildId}:${interaction.user.id}`, { label, emoji });
      if (interaction.isFromMessage()) return await interaction.update(ticketCategoryView(label));
      return await interaction.reply({ ...ticketCategoryView(label), flags: MessageFlags.Ephemeral });
    }

    if (id === 'cfgtktcat') {
      const pendingKey = `${interaction.guildId}:${interaction.user.id}`;
      const pending = pendingTicketTypes.get(pendingKey);
      if (!pending || getTicketTypeByLabel.get(interaction.guildId, pending.label)) {
        pendingTicketTypes.delete(pendingKey);
        return await interaction.update(ticketsView(interaction.guild));
      }
      const result = insertTicketType.run(interaction.guildId, pending.label, pending.emoji, interaction.values[0], null);
      pendingTicketTypes.delete(pendingKey);
      await interaction.update(ticketsView(interaction.guild, Number(result.lastInsertRowid)));
      await interaction.followUp({
        content:
          `✅ Type « **${pending.label}** » créé. Définissez son rôle support via le sélecteur si besoin, ` +
          'puis republiez le panneau : `/ticket panneau-modifier`.',
        flags: MessageFlags.Ephemeral,
      });
      await sendLog(
        interaction.guild,
        logEmbed('🎫 Type de ticket créé', `**${pending.label}** (catégorie <#${interaction.values[0]}>)\nPar <@${interaction.user.id}>`, COLORS.INFO)
      );
      return;
    }

    if (id.startsWith('cfgtktrole:')) {
      const typeId = Number(id.split(':')[1]);
      const type = getTicketType.get(typeId, interaction.guildId);
      if (!type) return await interaction.update(ticketsView(interaction.guild));
      const roleIds = [...new Set(interaction.values.map(String))].slice(0, 10);
      setTicketSupport.run(roleIds[0] || null, roleIds.length ? JSON.stringify(roleIds) : null, typeId, interaction.guildId);
      await interaction.update(ticketsView(interaction.guild, typeId));
      await sendLog(
        interaction.guild,
        logEmbed('🎫 Rôles support définis', `**${type.label}** → ${roleIds.map((r) => `<@&${r}>`).join(' ')}\nPar <@${interaction.user.id}>`, COLORS.INFO)
      );
      return;
    }

    if (id.startsWith('cfgtktdel:')) {
      const typeId = Number(id.split(':')[1]);
      const type = getTicketType.get(typeId, interaction.guildId);
      if (!type) return await interaction.update(ticketsView(interaction.guild));
      deleteTicketTypeStmt.run(typeId, interaction.guildId);
      await interaction.update(ticketsView(interaction.guild));
      await interaction.followUp({
        content: `🗑 Type « **${type.label}** » supprimé. Republiez le panneau : \`/ticket panneau-modifier\`.`,
        flags: MessageFlags.Ephemeral,
      });
      await sendLog(
        interaction.guild,
        logEmbed('🎫 Type de ticket supprimé', `**${type.label}**\nPar <@${interaction.user.id}>`, COLORS.WARNING)
      );
      return;
    }

    if (id === 'cfgchansel') {
      return await interaction.update(salonsView(interaction.guild, interaction.values[0]));
    }

    if (id.startsWith('cfgchan:')) {
      const col = id.split(':')[1];
      if (!(col in CHANNEL_COLUMNS)) return;
      const channelId = interaction.values[0];
      setGuildConfig(interaction.guildId, col, channelId);
      await interaction.update(col === 'captcha_channel_id' ? securiteView(interaction.guild) : salonsView(interaction.guild, col));
      await sendLog(
        interaction.guild,
        logEmbed('⚙️ Configuration modifiée', `${CHANNEL_COLUMNS[col]} → <#${channelId}>\nPar <@${interaction.user.id}>`, COLORS.INFO)
      );
      return;
    }

    if (id === 'cfgxp') {
      return await interaction.showModal(xpModal(getGuildConfig(interaction.guildId)));
    }

    if (id === 'cfgxpmodal') {
      const read = (name, min, max) => {
        const value = parseInt(interaction.fields.getTextInputValue(name), 10);
        if (Number.isNaN(value)) return null;
        return Math.min(max, Math.max(min, value));
      };
      const xpText = read('xp_text', 1, 1000);
      const xpVoice = read('xp_voice', 1, 1000);
      const cooldown = read('xp_cooldown', 5, 3600);
      if (xpText === null || xpVoice === null || cooldown === null) {
        return await interaction.reply({
          content: '❌ Valeurs invalides : entrez uniquement des nombres.',
          flags: MessageFlags.Ephemeral,
        });
      }
      setGuildConfig(interaction.guildId, 'xp_text', xpText);
      setGuildConfig(interaction.guildId, 'xp_voice', xpVoice);
      setGuildConfig(interaction.guildId, 'xp_cooldown', cooldown);
      if (interaction.isFromMessage()) await interaction.update(xpView(interaction.guild));
      else await interaction.reply({ content: '✅ Réglages XP mis à jour.', flags: MessageFlags.Ephemeral });
      await sendLog(
        interaction.guild,
        logEmbed(
          '⚙️ Configuration modifiée',
          `XP : texte **${xpText}**/message, vocal **${xpVoice}**/min, cooldown **${cooldown}** s\nPar <@${interaction.user.id}>`,
          COLORS.INFO
        )
      );
      return;
    }
  } catch (err) {
    console.error('Erreur panneau de configuration :', err);
    const payload = { content: '❌ Une erreur est survenue dans le panneau de configuration.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
}

module.exports = { mainView, handleConfigInteraction };
