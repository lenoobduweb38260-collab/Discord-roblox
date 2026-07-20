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
const { GRADES, getGrade } = require('./permissions');

// Panneau central de configuration : /config ouvre une vue d'ensemble avec un
// menu de catégories ; chaque catégorie se règle via des sélecteurs de rôles,
// de salons, ou un formulaire (XP). Tout est éphémère et journalisé.

const ROLE_COLUMNS = {
  staff_role_id: '👮 Rôle Staff',
  admin_role_id: '🛡️ Rôle Administration',
  service_role_id: '🧑‍💼 Rôle « En service »',
};

const CHANNEL_COLUMNS = {
  log_channel_id: '🔐 Salon des logs de sécurité',
  level_channel_id: '📈 Salon des annonces de niveau',
  service_channel_id: '🧑‍💼 Salon des prises/fins de service',
  staff_channel_id: '📣 Salon des arrivées/départs staff',
  member_channel_id: '👋 Salon des arrivées/départs des membres',
};

const show = (id, kind) => (id ? (kind === 'role' ? `<@&${id}>` : `<#${id}>`) : '*Non configuré*');

const listWhitelistMappings = db.prepare(
  'SELECT * FROM whitelist_managers WHERE guild_id = ? ORDER BY role_id'
);

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
          `Staff : ${show(cfg.staff_role_id, 'role')}`,
          `Administration : ${show(cfg.admin_role_id, 'role')}`,
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
      { name: '📋 Whitelist métiers', value: whitelistSummary(guild.id), inline: false }
    )
    .setFooter({ text: 'Seul le staff peut utiliser ce panneau • Le rôle Administration ne peut être changé que par un admin' });

  const categoryRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cfgcat')
      .setPlaceholder('⚙️ Choisissez une catégorie à configurer…')
      .addOptions(
        { label: 'Rôles', value: 'roles', emoji: '👮', description: 'Staff, administration, en service' },
        { label: 'Salons', value: 'salons', emoji: '📢', description: 'Logs, niveaux, service, staff' },
        { label: 'XP & niveaux', value: 'xp', emoji: '📈', description: 'XP texte, XP vocal, cooldown' },
        { label: 'Whitelist métiers', value: 'whitelist', emoji: '📋', description: 'Autorisations des gérants' }
      )
  );
  return { embeds: [embed], components: [categoryRow] };
}

// ----- Catégorie : rôles -----
function rolesView(guild) {
  const cfg = getGuildConfig(guild.id);
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('👮 Configuration — Rôles')
    .setDescription(
      Object.entries(ROLE_COLUMNS)
        .map(([col, label]) => `${label} : ${show(cfg[col], 'role')}`)
        .join('\n') + '\n\nSélectionnez un rôle dans chaque menu pour le définir.'
    );
  const components = Object.entries(ROLE_COLUMNS).map(([col, label]) => {
    const menu = new RoleSelectMenuBuilder()
      .setCustomId(`cfgrole:${col}`)
      .setPlaceholder(label)
      .setMinValues(1)
      .setMaxValues(1);
    if (cfg[col]) menu.setDefaultRoles(cfg[col]);
    return new ActionRowBuilder().addComponents(menu);
  });
  components.push(backRow());
  return { embeds: [embed], components };
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
        .join('\n') + '\n\n1️⃣ Choisissez le réglage, 2️⃣ puis le salon.'
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

const CATEGORY_VIEWS = { roles: rolesView, salons: salonsView, xp: xpView, whitelist: whitelistView };

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
      await interaction.update(rolesView(interaction.guild));
      await sendLog(
        interaction.guild,
        logEmbed('⚙️ Configuration modifiée', `${ROLE_COLUMNS[col]} → <@&${roleId}>\nPar <@${interaction.user.id}>`, COLORS.INFO)
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
      await interaction.update(salonsView(interaction.guild, col));
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
