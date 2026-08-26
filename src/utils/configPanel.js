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
const { GRADES, getGrade, staffRoleIds, adminRoleIds, policeRoleIds } = require('./permissions');
const { supportRoleIds } = require('./tickets');
const { isCreator } = require('./botTeam');
const { mettreAJour, suivre } = require('./reponse');
const { diagnostiquerRecompenses, definirRecompense, effacerRecompense } = require('./levels');
const { themeParCle, listeThemes, CLES } = require('./rpThemes');
const LG = require('./langues');
const { lien: lienCommunaute, demanderLiaison, delier } = require('./communaute');
const M = require('./miseEnPage');

// Panneau central de configuration : /config ouvre une vue d'ensemble avec un
// menu de catégories ; chaque catégorie se règle via des sélecteurs de rôles,
// de salons, ou un formulaire (XP). Tout est éphémère et journalisé.

const ROLE_COLUMNS = {
  staff_role_id: '👮 Rôle Staff',
  admin_role_id: '🛡️ Rôle Administration',
  service_role_id: '🧑‍💼 Rôle « En service »',
  verified_role_id: '🤖 Rôle vérifié (captcha)',
  wlrp_role_id: '✅ Rôle Whitelist RP',
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
  ticket_transcript_channel_id: '📄 Salon des transcripts de tickets (défaut : logs)',
  bump_channel_id: '⏰ Salon du rappel de bump (DISBOARD)',
};

// 🎧 Les réglages vocaux « à un seul salon » — l'assistance (une liste) et
// les absences (une table) ont leurs menus dédiés dans leurs catégories.
const VOCAL_COLUMNS = {
  vocal_attente_channel_id: '🎧 Vocal d\'attente (file d\'attente)',
  vocal_alerte_channel_id: '📣 Salon des tickets d\'attente',
  vocal_perso_createur_id: '🎙️ Salon créateur des salons perso',
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

// Création d'un type de ticket en trois étapes (formulaire nom → bulle emoji →
// catégorie) : mémoire temporaire entre les interactions.
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
    .map(([roleId, managers]) => `➜ <@&${roleId}> ← gérants : ${managers.map((m) => `<@&${m}>`).join(', ')}`)
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
        name: '🎧 Vocal',
        value: (() => {
          const assistance = require('./vocalAlerte').salonsAssistance(cfg);
          return [
            `File d'attente : ${show(cfg.vocal_attente_channel_id, 'channel')} → tickets dans ${show(cfg.vocal_alerte_channel_id, 'channel')}`,
            `Assistance : ${assistance.length ? assistance.map((id) => `<#${id}>`).join(' ') : '*Non configuré*'}`,
            `Salons perso (créateur) : ${show(cfg.vocal_perso_createur_id, 'channel')}`,
          ].join('\n');
        })(),
        inline: false,
      },
      {
        name: '📅 Absences',
        value: (() => {
          const salons = require('./absences').listeSalons(guild.id);
          return salons.length
            ? `Annonces dans : ${salons.map((id) => `<#${id}>`).join(' ')}`
            : '*Aucun salon d\'annonce configuré*';
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
        { label: 'Vocal', value: 'vocal', emoji: '🎧', description: 'File d\'attente, salons d\'assistance, salons perso' },
        { label: 'Absences', value: 'absences', emoji: '📅', description: 'Les salons où partent les annonces d\'absence' },
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
  const policeIds = policeRoleIds(cfg);
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('👮 Configuration — Rôles')
    .setDescription(
      [
        `👮 Rôles Staff : ${staffIds.map((id) => `<@&${id}>`).join(' ') || '*Non configuré*'}`,
        `🛡️ Rôles Administration : ${adminIds.map((id) => `<@&${id}>`).join(' ') || '*Non configuré*'}`,
        `🚓 Rôles Police : ${policeIds.map((id) => `<@&${id}>`).join(' ') || '*Non configuré*'}`,
        `🧑‍💼 Rôle « En service » : ${show(cfg.service_role_id, 'role')}`,
      ].join('\n') +
        '\n\n➕ Sélectionner un rôle dans un menu **l\'ajoute** à la liste (les rôles s\'accumulent). 🧹 Utilisez les boutons **Vider** pour repartir de zéro.' +
        '\n🚓 La **police** peut consulter le casier judiciaire (`/casierjudiciaire`) et retirer des points de permis.'
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
  const policeMenu = new RoleSelectMenuBuilder()
    .setCustomId('cfgmrole:police')
    .setPlaceholder('🚓 Rôles Police (plusieurs possibles)')
    .setMinValues(0)
    .setMaxValues(10);
  if (policeIds.length) policeMenu.setDefaultRoles(policeIds.slice(0, 10));
  const serviceMenu = new RoleSelectMenuBuilder()
    .setCustomId('cfgrole:service_role_id')
    .setPlaceholder('🧑‍💼 Rôle « En service »')
    .setMinValues(1)
    .setMaxValues(1);
  if (cfg.service_role_id) serviceMenu.setDefaultRoles(cfg.service_role_id);
  const bottom = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgback').setLabel('⬅ Retour').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cfgrolereset:staff').setLabel('Vider Staff').setEmoji('🧹').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cfgrolereset:admin').setLabel('Vider Admin').setEmoji('🧹').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cfgrolereset:police').setLabel('Vider Police').setEmoji('🧹').setStyle(ButtonStyle.Secondary)
  );
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(staffMenu),
      new ActionRowBuilder().addComponents(adminMenu),
      new ActionRowBuilder().addComponents(policeMenu),
      new ActionRowBuilder().addComponents(serviceMenu),
      bottom,
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
        `\n\n🔔 Mention des patch notes : ${libelleMention(cfg.patch_mention)}` +
        '\n\n1️⃣ Choisissez le réglage, 2️⃣ puis le salon.' +
        '\n\n📦 *Sans salon de mises à jour configuré, le bot crée automatiquement **#shadow-logs**, visible uniquement du staff, et y publie les annonces.*' +
        '\n🔔 *Choisissez 📝 **Salon des patch notes** ci-dessous pour régler qui est mentionné. Par défaut : personne.*'
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

  // 🔔 Qui mentionner quand une note de version paraît ?
  // Les contrôles n'apparaissent que sur le réglage concerné, pour ne pas
  // encombrer la vue — et parce qu'une vue Discord ne tient que 5 rangées.
  if (selectedCol === 'patch_channel_id') {
    const actuelle = String(cfg.patch_mention || '');
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('cfgpatchmention')
          .setPlaceholder('3️⃣ Qui mentionner à chaque note ?')
          .addOptions([
            { label: 'Personne (défaut)', value: 'aucune', emoji: '🔕', description: 'Aucune notification', default: !actuelle || actuelle === 'aucune' },
            { label: '@everyone', value: 'everyone', emoji: '📢', description: 'Tout le serveur', default: actuelle === 'everyone' },
            { label: '@here', value: 'here', emoji: '👋', description: 'Les membres connectés', default: actuelle === 'here' },
          ])
      )
    );
    const roleMenu = new RoleSelectMenuBuilder()
      .setCustomId('cfgpatchrole')
      .setPlaceholder('… ou un rôle précis')
      .setMinValues(0)
      .setMaxValues(1);
    if (/^\d{5,}$/.test(actuelle) && guild.roles.cache.has(actuelle)) roleMenu.setDefaultRoles(actuelle);
    components.push(new ActionRowBuilder().addComponents(roleMenu));
  }

  components.push(backRow());
  return { embeds: [embed], components };
}

// Comment dire, en clair, ce que vaut le réglage de mention.
function libelleMention(valeur) {
  const v = String(valeur || '').trim();
  if (!v || v === 'aucune') return '🔕 **Personne** *(défaut)*';
  if (v === 'everyone') return '📢 **@everyone**';
  if (v === 'here') return '👋 **@here**';
  if (/^\d{5,}$/.test(v)) return `<@&${v}>`;
  return '🔕 **Personne** *(défaut)*';
}

// ----- Catégorie : XP -----
function xpView(guild) {
  const cfg = getGuildConfig(guild.id);
  const enabled = cfg.levels_enabled !== 0; // NULL = activé (historique)
  // 📊 Un seul système de niveaux, donc un seul gain : une minute de vocal
  // vaut un message écrit. Les deux réglages restent en base, mais on les
  // pilote ensemble — deux barèmes reviendraient à dire que le vocal compte
  // moins, ce que la fusion des niveaux avait justement arrêté de dire.
  const memeGain = Number(cfg.xp_text) === Number(cfg.xp_voice);
  const cumul = Number(cfg.level_rewards_stack ?? 1) !== 0;
  const paliers = diagnostiquerRecompenses(guild);
  const listeRecompenses = paliers.length
    ? paliers.map((p) => `${M.FLECHE} Niveau **${p.level}** → ${p.nom ? `<@&${p.roleId}>` : `\`${p.roleId}\``}`
        + (p.souci ? ` — ⚠️ *${p.souci}*` : '')).join('\n')
    : '*Aucune récompense — le bot ne donne aucun rôle de lui-même.*';

  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('📈 Configuration — XP & niveaux')
    .addFields(
      { name: '📊 Système de niveaux', value: enabled ? '🟢 **Activé**' : '🔴 **Désactivé**', inline: true },
      {
        name: '⚡ Gain d\'XP',
        value: memeGain
          ? `**${cfg.xp_text}** par message · **${cfg.xp_voice}** par minute de vocal`
          : `✍️ **${cfg.xp_text}**/message · 🎙️ **${cfg.xp_voice}**/minute`,
        inline: true,
      },
      { name: '⏱️ Cooldown texte', value: `**${cfg.xp_cooldown}** secondes`, inline: true },
      { name: '📢 Salon des annonces', value: cfg.level_channel_id ? `<#${cfg.level_channel_id}>` : '*Non configuré — aucune annonce*', inline: true },
      { name: '🏅 Récompenses de niveau', value: M.borner(listeRecompenses, M.MAX_CHAMP), inline: false },
      {
        name: cumul ? '🧱 Les rôles s\'ajoutent' : '🔄 Un seul rôle à la fois',
        value: cumul
          ? 'Chaque palier atteint s\'ajoute aux précédents.'
          : 'Le palier atteint remplace le précédent.',
        inline: false,
      }
    )
    .setDescription(
      'Une minute passée en vocal rapporte autant qu\'un message écrit : il n\'y a qu\'**un seul niveau**.\n' +
        '📢 Les montées de niveau ne s\'annoncent QUE dans le salon configuré (⚙️ Salons → 📈).'
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgxp').setLabel('✏️ Modifier les valeurs').setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(enabled ? 'cfglvloff' : 'cfglvlon')
      .setLabel(enabled ? 'Désactiver les niveaux' : 'Activer les niveaux')
      .setEmoji(enabled ? '🔴' : '🟢')
      .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgrec').setLabel('🏅 Ajouter une récompense').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cfgrecdel').setLabel('🗑 Retirer une récompense').setStyle(ButtonStyle.Danger)
      .setDisabled(paliers.length === 0),
    new ButtonBuilder().setCustomId('cfgreccumul')
      .setLabel(cumul ? '🔄 Un seul rôle à la fois' : '🧱 Cumuler les rôles')
      .setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row, row2, backRow()] };
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
  const cfg = getGuildConfig(guild.id);
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('📋 Configuration — Whitelist')
    .setDescription(whitelistSummary(guild.id))
    .addFields(
      {
        name: '🧑‍🏭 Whitelist métiers — gérer les autorisations',
        value:
          '• `/whitelist config ajouter gerant:@Gérant role:@Métier [role2 …]` — autoriser un gérant sur **un ou plusieurs** rôles *(admin)*\n' +
          '• `/whitelist config retirer role:@Métier [gerant:@Gérant]` — retirer *(admin)*\n' +
          '• `/whitelist ajouter utilisateur:@membre role:@Métier` — whitelister une recrue',
      },
      {
        name: '✅ Whitelist RP — rôle attribué',
        value:
          `Rôle donné automatiquement quand le staff whiteliste RP quelqu'un (\`/whitelistrp ajouter\`) : ${show(cfg.wlrp_role_id, 'role')}\n` +
          '_Sélectionnez-le ci-dessous (menu vide = aucun rôle attribué)._',
      }
    );
  const wlrpMenu = new RoleSelectMenuBuilder()
    .setCustomId('cfgrole:wlrp_role_id')
    .setPlaceholder('✅ Rôle attribué à la Whitelist RP')
    .setMinValues(0)
    .setMaxValues(1);
  if (cfg.wlrp_role_id) wlrpMenu.setDefaultRoles(cfg.wlrp_role_id);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(wlrpMenu), backRow()] };
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
  // 🎮 Le jeu décide du vocabulaire : sur Arma, « carte d'identité » devient
  // « livret matricule ». Un joueur qui lit le mauvais mot comprend que le
  // bot n'a pas été pensé pour son serveur.
  const T = themeParCle(cfg.rp_jeu);
  embed.addFields({
    name: '🎮 Jeu du serveur',
    value: `${T.emoji} **${T.label}**\n`
      + `${M.FLECHE} ${T.carte.emoji} ${T.carte.titre} · ${T.permis.emoji} ${T.permis.titre} · ${T.entreprise.emoji} ${T.entreprise.titre}\n`
      + '-# Change les mots du Module RP. Aucune fiche n\'est perdue : on peut revenir en arrière.',
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgrpon').setLabel('Activer le Module RP').setEmoji('🟢').setStyle(ButtonStyle.Success).setDisabled(enabled || locked),
    new ButtonBuilder().setCustomId('cfgrpoff').setLabel('Désactiver le RP').setEmoji('🔴').setStyle(ButtonStyle.Danger).setDisabled(!enabled || locked)
  );
  // 🏢 Liaison des entreprises avec la communauté.
  const L = lienCommunaute(guild.id);
  const etatLien = !L
    ? '🔒 **Non liée** — les entreprises de ce serveur restent chez lui.'
    : L.statut === 'valide'
      ? `🔗 **Liée** à la communauté \`${L.main_guild_id}\` — entreprises partagées.`
      : L.statut === 'en_attente'
        ? `⏳ **En attente** de la couronne 👑 du serveur — demandée par <@${L.demande_par}>.`
        : `🚫 **Refusée** par le propriétaire.`;
  embed.addFields({
    name: '🏢 Entreprises partagées',
    value: `${etatLien}\n`
      + '-# Relier fait des entreprises RP un bien commun aux serveurs d\'une même communauté. '
      + 'Seul le **propriétaire** du serveur peut l\'accepter — un administrateur peut être nommé le matin et parti le soir.',
  });
  // 🌍 Langue du bot. Le français est la langue SOURCE : tout est écrit dedans,
  // et une traduction manquante y retombe. Le compte affiché ne triche pas —
  // un bot à moitié traduit ment davantage qu'un bot resté en français.
  const langue = LG.langueDe(guild.id);
  const T2 = LG.LANGUES[langue];
  let couv = null;
  try { couv = require('./traduire').couverture(); } catch { couv = null; }
  embed.addFields({
    name: '🌍 Langue du bot',
    value: `${T2.drapeau} **${T2.nom}**\n`
      + (langue === LG.DEFAUT
        ? '-# Langue d\'origine : tous les messages sont écrits dedans.'
        : `-# ${couv ? `${couv.parLangue[langue] || 0} texte(s) traduit(s)` : 'Traductions chargées'} — le reste s'affiche en français.`),
  });
  const rowLangue = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cfglangue')
      .setPlaceholder(`🌍 Langue du bot — actuellement ${T2.nom}`)
      .addOptions(LG.liste().map((l) => ({
        label: l.nom, value: l.cle, emoji: l.drapeau, default: l.cle === langue,
      })))
  );
  const rowLien = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgcomm').setLabel(L?.statut === 'valide' ? '🔗 Changer de communauté' : '🏢 Relier à une communauté').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cfgcommoff').setLabel('🔒 Garder les entreprises ici').setStyle(ButtonStyle.Secondary).setDisabled(!L)
  );
  const rowJeu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cfgrpjeu')
      .setPlaceholder(`🎮 Jeu du serveur — actuellement ${T.label}`)
      .addOptions(listeThemes().map((j) => ({
        label: j.label, value: j.cle, emoji: j.emoji, default: j.cle === T.cle,
      })))
  );
  const rowInteract = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfginton').setLabel('Activer les Interactions').setEmoji('🎮').setStyle(ButtonStyle.Success).setDisabled(interactOn),
    new ButtonBuilder().setCustomId('cfgintoff').setLabel('Désactiver').setEmoji('🔴').setStyle(ButtonStyle.Danger).setDisabled(!interactOn)
  );
  const rowSao = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgsaoon').setLabel('Activer l\'Aventure SAO').setEmoji('⚔️').setStyle(ButtonStyle.Success).setDisabled(saoOn),
    new ButtonBuilder().setCustomId('cfgsaooff').setLabel('Désactiver').setEmoji('🔴').setStyle(ButtonStyle.Danger).setDisabled(!saoOn)
  );
  return { embeds: [embed], components: [row, rowLangue, rowJeu, rowLien, backRow()] };
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
            .map((f) => `➜ ${PLATFORMS[f.platform]?.emoji || '📡'} **${PLATFORMS[f.platform]?.label || f.platform}** — \`${f.handle}\` → <#${f.channel_id}>`)
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
          const blocked = t.enabled === 0 ? ' — 🔒 bloquée' : '';
          return `➜ ${t.emoji ? t.emoji + ' ' : ''}**${t.label}** — catégorie « ${cat} »${support}${blocked}`;
        })
        .join('\n')
    : '*Aucun type de ticket configuré*';
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🎫 Configuration — Tickets')
    .setDescription(
      summary +
        '\n\n➕ Ajoutez un type, ou sélectionnez-en un pour définir son **rôle support** ou le **supprimer**.' +
        '\n🛎️ Un type **avec** rôles support leur est réservé : le staff généraliste ne voit pas ces tickets. Sans rôle support, tout le staff y accède.' +
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
      new ButtonBuilder().setCustomId(`cfgtktrolereset:${selected.id}`).setLabel('Vider support').setEmoji('🧹').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`cfgtktdel:${selected.id}`).setLabel('🗑 Supprimer ce type').setStyle(ButtonStyle.Danger)
    );
  }
  buttons.push(new ButtonBuilder().setCustomId('cfgback').setLabel('⬅ Retour').setStyle(ButtonStyle.Secondary));
  components.push(new ActionRowBuilder().addComponents(...buttons));
  return { embeds: [embed], components };
}

// Étape 3 de la création : choix de la catégorie Discord des salons de tickets.
function ticketCategoryView(pendingLabel, emoji) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🎫 Nouveau type de ticket')
    .setDescription(
      `Type « ${emoji ? `${emoji} ` : ''}**${pendingLabel}** » : choisissez la **catégorie Discord** où les salons de ce type de ticket seront créés.`
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
  // Seul le nom est saisi ici : l'emoji se choisit ensuite dans une « bulle »
  // (menu déroulant) car un modal Discord n'accepte que des champs texte.
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
      )
    );
}

// ----- 😀 Bulle de choix d'emoji (étape entre le nom et la catégorie) -----
// Un modal ne peut contenir que du texte : impossible d'y mettre un sélecteur
// d'emoji. On propose donc une étape dédiée avec un menu déroulant (« bulle »)
// listant les emojis du serveur + des emojis classiques, et — pour le créateur
// du bot — TOUS les emojis de tous les serveurs du bot. 25 options max par menu
// Discord, d'où la pagination.
const CURATED_EMOJIS = [
  ['🎫', 'Ticket'], ['🛎️', 'Assistance'], ['❓', 'Question'], ['❗', 'Important'],
  ['💬', 'Discussion'], ['📩', 'Message'], ['🆘', 'Aide'], ['🐛', 'Bug / signalement'],
  ['🔧', 'Technique'], ['⚙️', 'Paramètres'], ['💡', 'Idée / suggestion'], ['📝', 'Note'],
  ['💰', 'Boutique'], ['🛒', 'Achat'], ['🤝', 'Partenariat'], ['📢', 'Annonce'],
  ['⚖️', 'Réclamation'], ['🚨', 'Urgence'], ['🔒', 'Confidentiel'], ['👮', 'Staff'],
  ['🎮', 'Jeu'], ['🎁', 'Cadeau'], ['⭐', 'Premium'], ['❤️', 'Coup de cœur'],
  ['📦', 'Commande'], ['🏷️', 'Autre'], ['✅', 'Validation'], ['🚀', 'Candidature'],
  ['🎨', 'Création'], ['🔔', 'Rappel'],
];
const EMOJIS_PER_PAGE = 25;

// Construit la liste (stable) des emojis proposés : classiques, puis emojis du
// serveur, puis (créateur uniquement) tous les emojis accessibles au bot.
function emojiEntries(guild, client, creator) {
  const entries = [];
  const seen = new Set();
  const push = (value, name, emoji) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    entries.push({ value, name, emoji });
  };
  for (const [char, name] of CURATED_EMOJIS) push(char, name, char);
  if (guild?.emojis?.cache) {
    for (const e of guild.emojis.cache.values()) {
      push(e.toString(), e.name || 'emoji', { id: e.id, name: e.name || 'emoji', animated: Boolean(e.animated) });
    }
  }
  if (creator && client?.emojis?.cache) {
    for (const e of client.emojis.cache.values()) {
      push(e.toString(), e.name || 'emoji', { id: e.id, name: e.name || 'emoji', animated: Boolean(e.animated) });
    }
  }
  return entries;
}

function ticketEmojiView(pendingLabel, guild, client, creator, page = 0) {
  const entries = emojiEntries(guild, client, creator);
  const totalPages = Math.max(1, Math.ceil(entries.length / EMOJIS_PER_PAGE));
  const p = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const slice = entries.slice(p * EMOJIS_PER_PAGE, p * EMOJIS_PER_PAGE + EMOJIS_PER_PAGE);
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🎫 Nouveau type de ticket')
    .setDescription(
      `Type « **${pendingLabel}** » : choisissez un **emoji** dans la petite bulle ci-dessous 👇\n` +
        `Emojis du **serveur**${creator ? ' et de **tous les serveurs du bot**' : ''}, plus des emojis classiques.\n` +
        `Page **${p + 1}/${totalPages}** • ou « Sans emoji » pour n'en mettre aucun.`
    );
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`cfgtktemoji:${p}`)
    .setPlaceholder('😀 Choisissez un emoji…')
    .addOptions(
      slice.map((e) => {
        const opt = { label: String(e.name).slice(0, 100) || 'emoji', value: String(e.value).slice(0, 100) };
        try {
          opt.emoji = e.emoji;
        } catch {}
        return opt;
      })
    );
  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfgtktemojipg:${p - 1}`).setLabel('◀ Précédent').setStyle(ButtonStyle.Secondary).setDisabled(p <= 0),
    new ButtonBuilder().setCustomId(`cfgtktemojipg:${p + 1}`).setLabel('Suivant ▶').setStyle(ButtonStyle.Secondary).setDisabled(p >= totalPages - 1),
    new ButtonBuilder().setCustomId('cfgtktnoemoji').setLabel('Sans emoji').setEmoji('🚫').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cfgback').setLabel('⬅ Annuler').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), nav] };
}

// ----- Catégorie : vocal (file d'attente + salons personnels) -----
function vocalView(guild) {
  const cfg = getGuildConfig(guild.id);
  const assistance = require('./vocalAlerte').salonsAssistance(cfg);
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🎧 Configuration — Vocal')
    .setDescription(
      [
        `${VOCAL_COLUMNS.vocal_attente_channel_id} : ${show(cfg.vocal_attente_channel_id, 'channel')}`,
        `${VOCAL_COLUMNS.vocal_alerte_channel_id} : ${show(cfg.vocal_alerte_channel_id, 'channel')}`,
        `🏁 Salons d'assistance (y déplacer clôt le ticket) : ${assistance.length ? assistance.map((id) => `<#${id}>`).join(' ') : '*Non configuré*'}`,
        `${VOCAL_COLUMNS.vocal_perso_createur_id} : ${show(cfg.vocal_perso_createur_id, 'channel')}`,
      ].join('\n')
        + '\n\n🎧 Se connecter au vocal d\'attente ouvre un ticket dans le salon des tickets, staff mentionné.'
        + '\n🧹 Vider un menu **coupe** le réglage correspondant.'
    );
  const menuAttente = new ChannelSelectMenuBuilder()
    .setCustomId('cfgvoc:vocal_attente_channel_id')
    .setPlaceholder('🎧 Le vocal d\'attente à surveiller')
    .setChannelTypes(ChannelType.GuildVoice)
    .setMinValues(0).setMaxValues(1);
  if (cfg.vocal_attente_channel_id) menuAttente.setDefaultChannels(cfg.vocal_attente_channel_id);
  const menuTickets = new ChannelSelectMenuBuilder()
    .setCustomId('cfgvoc:vocal_alerte_channel_id')
    .setPlaceholder('📣 Le salon texte des tickets d\'attente')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0).setMaxValues(1);
  if (cfg.vocal_alerte_channel_id) menuTickets.setDefaultChannels(cfg.vocal_alerte_channel_id);
  const menuAssistance = new ChannelSelectMenuBuilder()
    .setCustomId('cfgvocassist')
    .setPlaceholder('🏁 Les salons d\'assistance (plusieurs possibles)')
    .setChannelTypes(ChannelType.GuildVoice)
    .setMinValues(0).setMaxValues(10);
  if (assistance.length) menuAssistance.setDefaultChannels(assistance.slice(0, 10));
  const menuPerso = new ChannelSelectMenuBuilder()
    .setCustomId('cfgvoc:vocal_perso_createur_id')
    .setPlaceholder('🎙️ Le vocal « créateur » des salons perso')
    .setChannelTypes(ChannelType.GuildVoice)
    .setMinValues(0).setMaxValues(1);
  if (cfg.vocal_perso_createur_id) menuPerso.setDefaultChannels(cfg.vocal_perso_createur_id);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menuAttente),
      new ActionRowBuilder().addComponents(menuTickets),
      new ActionRowBuilder().addComponents(menuAssistance),
      new ActionRowBuilder().addComponents(menuPerso),
      backRow(),
    ],
  };
}

// ----- Catégorie : absences (les salons d'annonce, sans plafond) -----
function absencesView(guild) {
  const salons = require('./absences').listeSalons(guild.id);
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('📅 Configuration — Absences')
    .setDescription(
      (salons.length
        ? `Les annonces d'absence partent dans : ${salons.map((id) => `<#${id}>`).join(' ')}`
        : '*Aucun salon d\'annonce configuré — les absences déclarées ne partent nulle part.*')
        + '\n\n➕ Le premier menu **ajoute** des salons — la liste s\'accumule, sans plafond. ➖ Le second en **retire**.'
        + '\n-# Le panneau « Déclarer une absence » se publie avec `/absence panneau`.'
    );
  const ajout = new ChannelSelectMenuBuilder()
    .setCustomId('cfgabsadd')
    .setPlaceholder('➕ Ajouter des salons d\'annonce')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1).setMaxValues(10);
  const retrait = new ChannelSelectMenuBuilder()
    .setCustomId('cfgabsdel')
    .setPlaceholder('➖ Retirer des salons d\'annonce')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1).setMaxValues(10);
  const bas = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgback').setLabel('⬅ Retour').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cfgabsvider').setLabel('Vider la liste').setEmoji('🧹').setStyle(ButtonStyle.Secondary)
  );
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(ajout),
      new ActionRowBuilder().addComponents(retrait),
      bas,
    ],
  };
}

const CATEGORY_VIEWS = { rp: rpView, roles: rolesView, salons: salonsView, xp: xpView, securite: securiteView, whitelist: whitelistView, tickets: ticketsView, vocal: vocalView, absences: absencesView, reseaux: reseauxView };
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
      // Un seul champ : le gain vaut pour un message écrit ET pour une minute
      // de vocal. Deux champs invitaient à les régler différemment, ce qui
      // recréait deux systèmes de niveaux dans un seul compteur.
      field('xp_gain', 'XP par message et par minute de vocal (1 à 1000)', cfg.xp_text),
      field('xp_cooldown', 'Cooldown XP texte en secondes (5 à 3600)', cfg.xp_cooldown)
    );
}

// 🏅 Ajouter une récompense : le palier et le rôle, en une fois.
function rewardModal() {
  return new ModalBuilder()
    .setCustomId('cfgrecmodal')
    .setTitle('🏅 Récompense de niveau')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('level').setLabel('Niveau à atteindre (1 à 500)')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setPlaceholder('10')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('role').setLabel('Rôle à donner (nom ou identifiant)')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder('Membre actif')
      )
    );
}

function rewardDeleteModal() {
  return new ModalBuilder()
    .setCustomId('cfgrecdelmodal')
    .setTitle('🗑 Retirer une récompense')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('level').setLabel('Niveau de la récompense à retirer')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3)
      )
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
      return await mettreAJour(interaction, mainView(interaction.guild));
    }

    if (id === 'cfgcat') {
      const view = CATEGORY_VIEWS[interaction.values[0]];
      if (!view) return;
      return await mettreAJour(interaction, view(interaction.guild));
    }

    // Sécurité : bascule anti-spam / anti-nuke / captcha.
    if (id.startsWith('cfgsec:')) {
      const col = id.split(':')[1];
      if (!SECURITY_TOGGLES.has(col)) return;
      const next = getGuildConfig(interaction.guildId)[col] ? 0 : 1;
      setGuildConfig(interaction.guildId, col, next);
      await mettreAJour(interaction, securiteView(interaction.guild));
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
      const roleId = interaction.values[0] || null; // menu vide = retrait
      setGuildConfig(interaction.guildId, col, roleId);
      const viewFor = { verified_role_id: securiteView, wlrp_role_id: whitelistView };
      await mettreAJour(interaction, (viewFor[col] || rolesView)(interaction.guild));
      await sendLog(
        interaction.guild,
        logEmbed('⚙️ Configuration modifiée', `${ROLE_COLUMNS[col]} → ${roleId ? `<@&${roleId}>` : '*retiré*'}\nPar <@${interaction.user.id}>`, COLORS.INFO)
      );
      return;
    }

    // Rôles staff / administration / police MULTIPLES.
    if (id.startsWith('cfgmrole:')) {
      const kind = id.split(':')[1]; // 'staff' | 'admin' | 'police'
      if (!['staff', 'admin', 'police'].includes(kind)) return;
      // Sécurité grade élevé : les rôles Administration ET Police (pouvoirs
      // élevés : casier judiciaire, retrait de points) sont réservés aux admins.
      if ((kind === 'admin' || kind === 'police') && grade < GRADES.ADMIN) {
        return await interaction.reply({
          content: `⛔ Sécurité : seul un membre de l\'**administration** peut changer les rôles ${kind === 'admin' ? 'Administration' : 'Police'}.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      // Fusion avec l'existant : sélectionner un rôle l'AJOUTE (les menus
      // « remplacent » la sélection, donc sans fusion un 2e ajout écraserait
      // le 1er et un seul rôle resterait). Le retrait passe par « Vider ».
      const cfg = getGuildConfig(interaction.guildId);
      const existing = kind === 'staff' ? staffRoleIds(cfg) : kind === 'admin' ? adminRoleIds(cfg) : policeRoleIds(cfg);
      const ids = [...new Set([...existing, ...interaction.values])].slice(0, 10);
      if (kind === 'police') {
        setGuildConfig(interaction.guildId, 'police_role_ids', JSON.stringify(ids));
      } else {
        setGuildConfig(interaction.guildId, `${kind}_role_ids`, JSON.stringify(ids));
        setGuildConfig(interaction.guildId, `${kind}_role_id`, ids[0] || null); // compatibilité colonne historique
      }
      await mettreAJour(interaction, rolesView(interaction.guild));
      const label = { staff: 'Staff', admin: 'Administration', police: 'Police' }[kind];
      await sendLog(
        interaction.guild,
        logEmbed(
          '⚙️ Configuration modifiée',
          `Rôles ${label} → ${ids.length ? ids.map((r) => `<@&${r}>`).join(' ') : '*aucun*'}\nPar <@${interaction.user.id}>`,
          COLORS.INFO
        )
      );
      return;
    }

    // Bouton « Vider » : réinitialise une liste de rôles (staff/admin/police).
    if (id.startsWith('cfgrolereset:')) {
      const kind = id.split(':')[1];
      if (!['staff', 'admin', 'police'].includes(kind)) return;
      if ((kind === 'admin' || kind === 'police') && grade < GRADES.ADMIN) {
        return await interaction.reply({
          content: `⛔ Sécurité : seul un membre de l\'**administration** peut vider les rôles ${kind === 'admin' ? 'Administration' : 'Police'}.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (kind === 'police') {
        setGuildConfig(interaction.guildId, 'police_role_ids', '[]');
      } else {
        setGuildConfig(interaction.guildId, `${kind}_role_ids`, '[]');
        setGuildConfig(interaction.guildId, `${kind}_role_id`, null);
      }
      await mettreAJour(interaction, rolesView(interaction.guild));
      const label = { staff: 'Staff', admin: 'Administration', police: 'Police' }[kind];
      await sendLog(
        interaction.guild,
        logEmbed('⚙️ Configuration modifiée', `Rôles ${label} **vidés** par <@${interaction.user.id}>.`, COLORS.WARNING)
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
      await mettreAJour(interaction, rpView(interaction.guild));
      require('../commandSync')
        .syncGuild(interaction.guildId)
        .then(() =>
          suivre(interaction, {
            content: enable
              ? '🟢 Module RP **activé** — les commandes RP sont maintenant visibles sur le serveur.'
              : '🔴 Module RP **désactivé** — les commandes RP ont été retirées du serveur.',
            flags: MessageFlags.Ephemeral,
          })
        )
        .catch((err) =>
          suivre(interaction, { content: `⚠️ Synchronisation des commandes : ${err.message}`, flags: MessageFlags.Ephemeral })
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
      await mettreAJour(interaction, rpView(interaction.guild));
      await sendLog(
        interaction.guild,
        logEmbed('🎮 Module Interactions', `Interactions ${enable ? 'activées' : 'désactivées'} par <@${interaction.user.id}>.`, enable ? COLORS.SUCCESS : COLORS.DANGER)
      );
      return;
    }

    // 🌍 Langue du bot.
    if (id === 'cfglangue') {
      const choix = LG.CLES.includes(interaction.values?.[0]) ? interaction.values[0] : LG.DEFAUT;
      setGuildConfig(interaction.guildId, 'bot_langue', choix);
      await mettreAJour(interaction, rpView(interaction.guild));
      const L2 = LG.LANGUES[choix];
      await sendLog(interaction.guild, logEmbed('🌍 Langue du bot',
        `Réglée sur ${L2.drapeau} **${L2.nom}** par <@${interaction.user.id}>.`
        + (choix === LG.DEFAUT ? '' : '\n-# Les textes non traduits restent en français.'),
        COLORS.INFO));
      return;
    }

    // 🏢 Liaison des entreprises avec une communauté.
    if (id === 'cfgcomm') {
      return await interaction.showModal(
        new ModalBuilder().setCustomId('cfgcommmodal').setTitle('🏢 Relier les entreprises').addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('serveur')
              .setLabel('Identifiant du serveur principal')
              .setPlaceholder('Clic droit sur le serveur → Copier l\'identifiant')
              .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(25)
          )
        )
      );
    }
    if (id === 'cfgcommoff') {
      delier(interaction.guildId);
      await mettreAJour(interaction, rpView(interaction.guild));
      await sendLog(interaction.guild, logEmbed('🏢 Entreprises',
        `<@${interaction.user.id}> a détaché ce serveur de sa communauté : les entreprises redeviennent locales.`,
        COLORS.WARNING));
      return;
    }

    // 🎮 Jeu du serveur (vocabulaire du Module RP).
    if (id === 'cfgrpjeu') {
      const choix = CLES.includes(interaction.values?.[0]) ? interaction.values[0] : 'roblox';
      setGuildConfig(interaction.guildId, 'rp_jeu', choix);
      await mettreAJour(interaction, rpView(interaction.guild));
      const T = themeParCle(choix);
      await sendLog(interaction.guild, logEmbed('🎮 Jeu du serveur',
        `Module RP réglé sur ${T.emoji} **${T.label}** par <@${interaction.user.id}>.\n`
        + `-# La ${T.carte.titre.toLowerCase()} remplace les anciens intitulés. Aucune fiche n'est perdue.`,
        COLORS.INFO));
      return;
    }

    // 🏅 Récompenses de niveau : ajouter, retirer, cumuler ou remplacer.
    if (id === 'cfgrec') return await interaction.showModal(rewardModal());
    if (id === 'cfgrecdel') return await interaction.showModal(rewardDeleteModal());
    if (id === 'cfgreccumul') {
      const cumul = Number(getGuildConfig(interaction.guildId).level_rewards_stack ?? 1) !== 0;
      setGuildConfig(interaction.guildId, 'level_rewards_stack', cumul ? 0 : 1);
      await mettreAJour(interaction, xpView(interaction.guild));
      return;
    }

    // Système de niveaux : activer / désactiver (par serveur).
    if (id === 'cfglvlon' || id === 'cfglvloff') {
      const enable = id === 'cfglvlon' ? 1 : 0;
      setGuildConfig(interaction.guildId, 'levels_enabled', enable);
      await mettreAJour(interaction, xpView(interaction.guild));
      await sendLog(
        interaction.guild,
        logEmbed('📈 Système de niveaux', `Niveaux ${enable ? 'activés' : 'désactivés'} par <@${interaction.user.id}>.`, enable ? COLORS.SUCCESS : COLORS.DANGER)
      );
      return;
    }

    // Module Aventure SAO : activer / désactiver (par serveur).
    if (id === 'cfgsaoon' || id === 'cfgsaooff') {
      const enable = id === 'cfgsaoon' ? 1 : 0;
      setGuildConfig(interaction.guildId, 'sao_enabled', enable);
      await mettreAJour(interaction, rpView(interaction.guild));
      await sendLog(
        interaction.guild,
        logEmbed('⚔️ Module Aventure SAO', `Aventure SAO ${enable ? 'activée' : 'désactivée'} par <@${interaction.user.id}>.`, enable ? COLORS.SUCCESS : COLORS.DANGER)
      );
      return;
    }

    // ----- Tickets : sélection, création (formulaire → catégorie), support, suppression -----
    if (id === 'cfgtktsel') {
      return await mettreAJour(interaction, ticketsView(interaction.guild, Number(interaction.values[0])));
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
      if (!label) {
        return await interaction.reply({ content: '❌ Le nom du type est requis.', flags: MessageFlags.Ephemeral });
      }
      if (getTicketTypeByLabel.get(interaction.guildId, label)) {
        return await interaction.reply({ content: `❌ Le type « ${label} » existe déjà.`, flags: MessageFlags.Ephemeral });
      }
      pendingTicketTypes.set(`${interaction.guildId}:${interaction.user.id}`, { label, emoji: null });
      const creator = await isCreator(interaction.client, interaction.user.id);
      const view = ticketEmojiView(label, interaction.guild, interaction.client, creator, 0);
      if (interaction.isFromMessage()) return await mettreAJour(interaction, view);
      return await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
    }

    // Bulle emoji : changement de page.
    if (id.startsWith('cfgtktemojipg:')) {
      const pending = pendingTicketTypes.get(`${interaction.guildId}:${interaction.user.id}`);
      if (!pending) return await mettreAJour(interaction, ticketsView(interaction.guild));
      const creator = await isCreator(interaction.client, interaction.user.id);
      const page = Number(id.split(':')[1]) || 0;
      return await mettreAJour(interaction, ticketEmojiView(pending.label, interaction.guild, interaction.client, creator, page));
    }

    // Bulle emoji : un emoji a été choisi → étape catégorie.
    if (id.startsWith('cfgtktemoji:')) {
      const pendingKey = `${interaction.guildId}:${interaction.user.id}`;
      const pending = pendingTicketTypes.get(pendingKey);
      if (!pending) return await mettreAJour(interaction, ticketsView(interaction.guild));
      pending.emoji = interaction.values[0] || null;
      pendingTicketTypes.set(pendingKey, pending);
      return await mettreAJour(interaction, ticketCategoryView(pending.label, pending.emoji));
    }

    // Bulle emoji : « Sans emoji » → étape catégorie sans emoji.
    if (id === 'cfgtktnoemoji') {
      const pendingKey = `${interaction.guildId}:${interaction.user.id}`;
      const pending = pendingTicketTypes.get(pendingKey);
      if (!pending) return await mettreAJour(interaction, ticketsView(interaction.guild));
      pending.emoji = null;
      pendingTicketTypes.set(pendingKey, pending);
      return await mettreAJour(interaction, ticketCategoryView(pending.label, null));
    }

    if (id === 'cfgtktcat') {
      const pendingKey = `${interaction.guildId}:${interaction.user.id}`;
      const pending = pendingTicketTypes.get(pendingKey);
      if (!pending || getTicketTypeByLabel.get(interaction.guildId, pending.label)) {
        pendingTicketTypes.delete(pendingKey);
        return await mettreAJour(interaction, ticketsView(interaction.guild));
      }
      const result = insertTicketType.run(interaction.guildId, pending.label, pending.emoji, interaction.values[0], null);
      pendingTicketTypes.delete(pendingKey);
      await mettreAJour(interaction, ticketsView(interaction.guild, Number(result.lastInsertRowid)));
      await suivre(interaction, {
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
      if (!type) return await mettreAJour(interaction, ticketsView(interaction.guild));
      // Fusion : les rôles support s'accumulent (voir Rôles). Retrait = « Vider support ».
      const roleIds = [...new Set([...supportRoleIds(type), ...interaction.values.map(String)])].slice(0, 10);
      setTicketSupport.run(roleIds[0] || null, roleIds.length ? JSON.stringify(roleIds) : null, typeId, interaction.guildId);
      await mettreAJour(interaction, ticketsView(interaction.guild, typeId));
      await sendLog(
        interaction.guild,
        logEmbed('🎫 Rôles support définis', `**${type.label}** → ${roleIds.map((r) => `<@&${r}>`).join(' ')}\nPar <@${interaction.user.id}>`, COLORS.INFO)
      );
      return;
    }

    // Bouton « Vider support » : réinitialise les rôles support d'un type de ticket.
    if (id.startsWith('cfgtktrolereset:')) {
      const typeId = Number(id.split(':')[1]);
      const type = getTicketType.get(typeId, interaction.guildId);
      if (!type) return await mettreAJour(interaction, ticketsView(interaction.guild));
      setTicketSupport.run(null, null, typeId, interaction.guildId);
      await mettreAJour(interaction, ticketsView(interaction.guild, typeId));
      await sendLog(
        interaction.guild,
        logEmbed('🎫 Rôles support vidés', `**${type.label}** : rôles support réinitialisés par <@${interaction.user.id}>.`, COLORS.WARNING)
      );
      return;
    }

    if (id.startsWith('cfgtktdel:')) {
      const typeId = Number(id.split(':')[1]);
      const type = getTicketType.get(typeId, interaction.guildId);
      if (!type) return await mettreAJour(interaction, ticketsView(interaction.guild));
      deleteTicketTypeStmt.run(typeId, interaction.guildId);
      await mettreAJour(interaction, ticketsView(interaction.guild));
      await suivre(interaction, {
        content: `🗑 Type « **${type.label}** » supprimé. Republiez le panneau : \`/ticket panneau-modifier\`.`,
        flags: MessageFlags.Ephemeral,
      });
      await sendLog(
        interaction.guild,
        logEmbed('🎫 Type de ticket supprimé', `**${type.label}**\nPar <@${interaction.user.id}>`, COLORS.WARNING)
      );
      return;
    }

    // 🎧 Vocal : file d'attente et salons perso — un menu vidé coupe le réglage.
    if (id.startsWith('cfgvoc:')) {
      const col = id.split(':')[1];
      if (!(col in VOCAL_COLUMNS)) return;
      const channelId = interaction.values[0] || null;
      setGuildConfig(interaction.guildId, col, channelId);
      await mettreAJour(interaction, vocalView(interaction.guild));
      await sendLog(
        interaction.guild,
        logEmbed('⚙️ Configuration modifiée', `${VOCAL_COLUMNS[col]} → ${channelId ? `<#${channelId}>` : '*retiré*'}\nPar <@${interaction.user.id}>`, COLORS.INFO)
      );
      return;
    }

    // 🏁 Les salons d'assistance : la sélection REMPLACE la liste.
    if (id === 'cfgvocassist') {
      const salons = (interaction.values || []).map(String);
      setGuildConfig(interaction.guildId, 'vocal_assistance_ids', salons.length ? JSON.stringify(salons) : null);
      await mettreAJour(interaction, vocalView(interaction.guild));
      await sendLog(
        interaction.guild,
        logEmbed('⚙️ Configuration modifiée', `🏁 Salons d'assistance → ${salons.length ? salons.map((s) => `<#${s}>`).join(' ') : '*aucun*'}\nPar <@${interaction.user.id}>`, COLORS.INFO)
      );
      return;
    }

    // 📅 Absences : la liste des salons d'annonce s'ajuste depuis le panneau.
    if (id === 'cfgabsadd' || id === 'cfgabsdel' || id === 'cfgabsvider') {
      const abs = require('./absences');
      let mot;
      if (id === 'cfgabsadd') {
        const n = abs.ajouterSalons(interaction.guildId, interaction.values);
        mot = `➕ ${n} salon(s) d'annonce ajouté(s)`;
      } else if (id === 'cfgabsdel') {
        const n = abs.retirerSalons(interaction.guildId, interaction.values);
        mot = `➖ ${n} salon(s) d'annonce retiré(s)`;
      } else {
        const n = abs.viderTousSalons(interaction.guildId);
        mot = `🧹 Liste vidée (${n} salon(s))`;
      }
      await mettreAJour(interaction, absencesView(interaction.guild));
      await sendLog(
        interaction.guild,
        logEmbed('⚙️ Configuration modifiée', `📅 Absences : ${mot}\nPar <@${interaction.user.id}>`, COLORS.INFO)
      );
      return;
    }

    if (id === 'cfgchansel') {
      return await mettreAJour(interaction, salonsView(interaction.guild, interaction.values[0]));
    }

    // 🔔 Mention des patch notes : « personne » (défaut), @everyone, @here…
    if (id === 'cfgpatchmention') {
      const choix = interaction.values[0];
      const valeur = choix === 'aucune' ? null : choix;
      setGuildConfig(interaction.guildId, 'patch_mention', valeur);
      await mettreAJour(interaction, salonsView(interaction.guild, 'patch_channel_id'));
      await sendLog(
        interaction.guild,
        logEmbed('⚙️ Configuration modifiée', `🔔 Mention des patch notes → ${libelleMention(valeur)}\nPar <@${interaction.user.id}>`, COLORS.INFO)
      );
      return;
    }

    // … ou un rôle précis. Vider la sélection revient à ne mentionner personne.
    if (id === 'cfgpatchrole') {
      const roleId = interaction.values[0] || null;
      setGuildConfig(interaction.guildId, 'patch_mention', roleId);
      await mettreAJour(interaction, salonsView(interaction.guild, 'patch_channel_id'));
      await sendLog(
        interaction.guild,
        logEmbed('⚙️ Configuration modifiée', `🔔 Mention des patch notes → ${libelleMention(roleId)}\nPar <@${interaction.user.id}>`, COLORS.INFO)
      );
      return;
    }

    if (id.startsWith('cfgchan:')) {
      const col = id.split(':')[1];
      if (!(col in CHANNEL_COLUMNS)) return;
      const channelId = interaction.values[0];
      setGuildConfig(interaction.guildId, col, channelId);
      await mettreAJour(interaction, col === 'captcha_channel_id' ? securiteView(interaction.guild) : salonsView(interaction.guild, col));
      await sendLog(
        interaction.guild,
        logEmbed('⚙️ Configuration modifiée', `${CHANNEL_COLUMNS[col]} → <#${channelId}>\nPar <@${interaction.user.id}>`, COLORS.INFO)
      );
      return;
    }

    if (id === 'cfgxp') {
      return await interaction.showModal(xpModal(getGuildConfig(interaction.guildId)));
    }

    if (id === 'cfgcommmodal') {
      const r = await demanderLiaison(interaction, interaction.fields.getTextInputValue('serveur'));
      if (r.erreur) return await interaction.reply({ content: r.erreur, flags: MessageFlags.Ephemeral });
      if (interaction.isFromMessage()) await mettreAJour(interaction, rpView(interaction.guild));
      // ⚠️ `suivre` regarde l'état RÉEL de l'interaction. Se fier à
      // `isFromMessage()` supposait que `mettreAJour` a réussi — or elle avale
      // ses erreurs, et le followUp levait alors « InteractionNotReplied ».
      const dire = (p) => suivre(interaction, p);
      if (r.immediat) {
        await sendLog(interaction.guild, logEmbed('🏢 Entreprises partagées',
          `<@${interaction.user.id}> (👑 propriétaire) a relié ce serveur à sa communauté.`, COLORS.SUCCESS));
        return await dire({
          content: '✅ Liaison validée : vous portez la couronne, il n\'y a personne au-dessus à consulter.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return await dire({
        content: r.mpFerme
          ? `📨 Demande enregistrée, mais <@${r.proprietaire}> a ses **messages privés fermés** : je n'ai pas pu le prévenir.\n`
            + '➜ Demandez-lui de lancer lui-même `/config` → 🎭 Module RP → 🏢 Entreprises.'
          : `📨 Demande envoyée à <@${r.proprietaire}> (👑 propriétaire du serveur) en message privé.\n`
            + '-# Rien n\'est partagé tant qu\'il n\'a pas validé.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (id === 'cfgrecmodal' || id === 'cfgrecdelmodal') {
      const niveau = parseInt(interaction.fields.getTextInputValue('level'), 10);
      if (Number.isNaN(niveau) || niveau < 1 || niveau > 500) {
        return await interaction.reply({
          content: '❌ Le niveau doit être un nombre entre **1** et **500**.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (id === 'cfgrecdelmodal') {
        const retire = effacerRecompense(interaction.guildId, niveau);
        if (!retire) {
          return await interaction.reply({
            content: `❌ Aucune récompense n'est configurée pour le **niveau ${niveau}**.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        // ⚠️ Le rôle déjà donné n'est PAS repris : des membres l'ont, et le
        // leur retirer sans prévenir serait pire que de laisser la trace
        // d'un palier supprimé.
        if (interaction.isFromMessage()) await mettreAJour(interaction, xpView(interaction.guild));
        else await interaction.reply({ content: `🗑 Récompense du niveau **${niveau}** retirée.`, flags: MessageFlags.Ephemeral });
        await sendLog(interaction.guild, logEmbed('🏅 Récompense de niveau',
          `Palier **${niveau}** retiré par <@${interaction.user.id}>.\n-# Les membres qui avaient déjà le rôle le gardent.`,
          COLORS.WARNING));
        return;
      }

      // Le rôle est accepté par identifiant, par mention, ou par nom exact —
      // un modal n'a pas de liste déroulante, autant reconnaître les trois.
      const brut = interaction.fields.getTextInputValue('role').trim();
      const parId = /^<@&(\d{15,25})>$/.exec(brut)?.[1] || (/^\d{15,25}$/.test(brut) ? brut : null);
      const role = parId
        ? interaction.guild.roles.cache.get(parId)
        : interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === brut.toLowerCase());
      if (!role) {
        return await interaction.reply({
          content: `❌ Rôle introuvable : « ${brut} ».\n`
            + '➜ Collez son **identifiant**, sa **mention** (`@Rôle`), ou son **nom exact**.',
          flags: MessageFlags.Ephemeral,
        });
      }
      // Un rôle qu'on ne peut pas donner ne sert à rien : le dire ici évite
      // de chercher longtemps pourquoi personne ne reçoit sa récompense.
      const moi = interaction.guild.members.me;
      if (role.managed) {
        return await interaction.reply({
          content: `❌ **${role.name}** est géré par une intégration : il ne s'attribue pas à la main.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (moi && role.position >= moi.roles.highest.position) {
        return await interaction.reply({
          content: `❌ **${role.name}** est au-dessus de mon rôle : je ne pourrai pas le donner.\n`
            + '➜ Remontez mon rôle au-dessus dans **Paramètres du serveur → Rôles**, puis réessayez.',
          flags: MessageFlags.Ephemeral,
        });
      }

      definirRecompense(interaction.guildId, niveau, role.id);
      if (interaction.isFromMessage()) await mettreAJour(interaction, xpView(interaction.guild));
      else await interaction.reply({ content: `🏅 Niveau **${niveau}** → **${role.name}**.`, flags: MessageFlags.Ephemeral });
      await sendLog(interaction.guild, logEmbed('🏅 Récompense de niveau',
        `Niveau **${niveau}** → <@&${role.id}>\nPar <@${interaction.user.id}>`, COLORS.SUCCESS));
      return;
    }

    if (id === 'cfgxpmodal') {
      const read = (name, min, max) => {
        const value = parseInt(interaction.fields.getTextInputValue(name), 10);
        if (Number.isNaN(value)) return null;
        return Math.min(max, Math.max(min, value));
      };
      const gain = read('xp_gain', 1, 1000);
      const xpText = gain;
      const xpVoice = gain; // même gain : un seul système de niveaux
      const cooldown = read('xp_cooldown', 5, 3600);
      if (gain === null || cooldown === null) {
        return await interaction.reply({
          content: '❌ Valeurs invalides : entrez uniquement des nombres.',
          flags: MessageFlags.Ephemeral,
        });
      }
      setGuildConfig(interaction.guildId, 'xp_text', xpText);
      setGuildConfig(interaction.guildId, 'xp_voice', xpVoice);
      setGuildConfig(interaction.guildId, 'xp_cooldown', cooldown);
      if (interaction.isFromMessage()) await mettreAJour(interaction, xpView(interaction.guild));
      else await interaction.reply({ content: '✅ Réglages XP mis à jour.', flags: MessageFlags.Ephemeral });
      await sendLog(
        interaction.guild,
        logEmbed(
          '⚙️ Configuration modifiée',
          `XP : **${gain}** par message et par minute de vocal, cooldown **${cooldown}** s\nPar <@${interaction.user.id}>`,
          COLORS.INFO
        )
      );
      return;
    }
  } catch (err) {
    console.error('Erreur panneau de configuration :', err);
    await suivre(interaction, { content: '❌ Une erreur est survenue dans le panneau de configuration.', flags: MessageFlags.Ephemeral });
  }
}

module.exports = { mainView, handleConfigInteraction };
