const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { db, RP_SCOPE } = require('../database');
const { COLORS } = require('../utils/embeds');
const { GRADES, getGrade } = require('../utils/permissions');
const { repondre } = require('../utils/reponse');

// /temps : un gérant consulte les temps de service des membres de SA faction.
// Une faction est soit une entreprise (patrons = gérants), soit un rôle métier
// de la whitelist (rôles gérants = gérants). Le menu s'adapte automatiquement :
// chaque entreprise créée ou métier configuré y apparaît aussitôt.

const listEnterprises = db.prepare('SELECT id, name FROM enterprises WHERE guild_id = ? ORDER BY name');
const getEnterprise = db.prepare('SELECT * FROM enterprises WHERE id = ? AND guild_id = ?');
const getEnterpriseByName = db.prepare('SELECT * FROM enterprises WHERE guild_id = ? AND name = ?');
const isHead = db.prepare('SELECT 1 FROM enterprise_heads WHERE enterprise_id = ? AND user_id = ?');
const entMembers = db.prepare(`
  SELECT user_id FROM enterprise_heads WHERE enterprise_id = ?
  UNION SELECT user_id FROM enterprise_employees WHERE enterprise_id = ?
`);
const metierRoles = db.prepare('SELECT DISTINCT role_id FROM whitelist_managers WHERE guild_id = ?');
const roleManagers = db.prepare('SELECT manager_role_id FROM whitelist_managers WHERE guild_id = ? AND role_id = ?');
const allServices = db.prepare('SELECT user_id, start_at, end_at FROM services WHERE guild_id = ?');

const WEEK_MS = 7 * 24 * 3600 * 1000;

function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

// Cumule les temps de service par utilisateur : total, 7 derniers jours, en cours.
function computeTimes(guildId) {
  const now = Date.now();
  const weekStart = now - WEEK_MS;
  const byUser = new Map();
  for (const s of allServices.all(guildId)) {
    const start = new Date(s.start_at).getTime();
    const end = s.end_at ? new Date(s.end_at).getTime() : now;
    if (Number.isNaN(start) || end <= start) continue;
    const entry = byUser.get(s.user_id) || { total: 0, week: 0, active: false };
    entry.total += end - start;
    entry.week += Math.max(0, Math.min(end, now) - Math.max(start, weekStart));
    if (!s.end_at) entry.active = true;
    byUser.set(s.user_id, entry);
  }
  return byUser;
}

function managedFactions(interaction) {
  const isStaff = getGrade(interaction.member) >= GRADES.STAFF;
  const factions = [];
  for (const ent of listEnterprises.all(RP_SCOPE)) {
    if (isStaff || isHead.get(ent.id, interaction.user.id)) {
      factions.push({ name: `🏢 ${ent.name}`, value: `ent:${ent.id}` });
    }
  }
  for (const { role_id } of metierRoles.all(interaction.guildId)) {
    const role = interaction.guild.roles.cache.get(role_id);
    if (!role) continue;
    const managers = roleManagers.all(interaction.guildId, role_id).map((r) => r.manager_role_id);
    if (isStaff || managers.some((id) => interaction.member.roles.cache.has(id))) {
      factions.push({ name: `👮 ${role.name}`, value: `role:${role_id}` });
    }
  }
  return factions;
}

module.exports = {
  module: 'rp', // fait partie du Module RP activable dans /config
  grade: GRADES.EVERYONE, // accès contrôlé par gérance de faction (ou staff)
  data: new SlashCommandBuilder()
    .setName('temps')
    .setDescription('[Gérant] Temps de service des membres de votre faction')
    .addStringOption((o) =>
      o
        .setName('faction')
        .setDescription('Votre faction (entreprise ou rôle métier)')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const factions = managedFactions(interaction)
      .filter((f) => f.name.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(factions);
  },

  async execute(interaction) {
    const raw = interaction.options.getString('faction').trim();
    const isStaff = getGrade(interaction.member) >= GRADES.STAFF;

    // Résolution de la faction : valeur du menu (ent:/role:), sinon nom saisi.
    let faction = null;
    if (raw.startsWith('ent:')) {
      const ent = getEnterprise.get(Number(raw.slice(4)), RP_SCOPE);
      if (ent) faction = { type: 'ent', ent };
    } else if (raw.startsWith('role:')) {
      const role = interaction.guild.roles.cache.get(raw.slice(5));
      if (role) faction = { type: 'role', role };
    } else {
      const ent = getEnterpriseByName.get(RP_SCOPE, raw);
      if (ent) faction = { type: 'ent', ent };
      else {
        const role = interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === raw.toLowerCase());
        if (role) faction = { type: 'role', role };
      }
    }
    if (!faction) {
      return interaction.reply({ content: `❌ Faction introuvable : **${raw}**.`, flags: MessageFlags.Ephemeral });
    }

    // Sécurité : seul un gérant de cette faction (ou le staff) peut consulter.
    if (faction.type === 'ent') {
      if (!isStaff && !isHead.get(faction.ent.id, interaction.user.id)) {
        return interaction.reply({
          content: `⛔ Sécurité : vous n'êtes pas gérant de **${faction.ent.name}**.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } else {
      const managers = roleManagers.all(interaction.guildId, faction.role.id).map((r) => r.manager_role_id);
      if (!isStaff && !managers.some((id) => interaction.member.roles.cache.has(id))) {
        return interaction.reply({
          content: `⛔ Sécurité : vous n'êtes pas gérant du métier **${faction.role.name}**.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Membres de la faction.
    let memberIds;
    let title;
    if (faction.type === 'ent') {
      memberIds = entMembers.all(faction.ent.id, faction.ent.id).map((r) => r.user_id);
      title = `⏱️ Temps de service — 🏢 ${faction.ent.name}`;
    } else {
      const members = await interaction.guild.members.fetch();
      memberIds = [...members.filter((m) => m.roles.cache.has(faction.role.id) && !m.user.bot).keys()];
      title = `⏱️ Temps de service — 👮 ${faction.role.name}`;
    }
    if (!memberIds.length) {
      return interaction.editReply('📋 Cette faction n\'a aucun membre pour le moment.');
    }

    const times = computeTimes(interaction.guildId);
    const rows = memberIds
      .map((id) => ({ id, ...(times.get(id) || { total: 0, week: 0, active: false }) }))
      .sort((a, b) => b.week - a.week || b.total - a.total);

    const lines = rows
      .slice(0, 25)
      .map(
        (r, i) =>
          `**${i + 1}.** <@${r.id}> ${r.active ? '🟢' : ''} — 7 jours : **${formatDuration(r.week)}** · total : ${formatDuration(r.total)}`
      );
    const totalWeek = rows.reduce((sum, r) => sum + r.week, 0);

    const embed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle(title)
      .setDescription(lines.join('\n'))
      .setFooter({
        text: `${rows.length} membre(s) · cumul 7 jours : ${formatDuration(totalWeek)} · 🟢 = en service actuellement`,
      });
    if (rows.length > 25) embed.setDescription(lines.join('\n') + `\n… et ${rows.length - 25} autre(s)`);
    // Carte et non embed : editReply seul ne serait jamais converti.
    return repondre(interaction, { embeds: [embed] });
  },
};
