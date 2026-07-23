const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { db } = require('../database');
const { COLORS, sendLog, logEmbed } = require('../utils/embeds');
const { GRADES, getGrade } = require('../utils/permissions');

// Whitelist métier : l'administration associe un rôle métier (ex : @Policier)
// à un ou plusieurs rôles gérants (ex : @Gérant Police). Un gérant peut alors
// whitelister une recrue : le bot lui attribue automatiquement le rôle métier.
// Un gérant ne peut JAMAIS attribuer un rôle qui ne lui a pas été autorisé.

const getManagers = db.prepare(
  'SELECT manager_role_id FROM whitelist_managers WHERE guild_id = ? AND role_id = ?'
);
const allManagers = db.prepare('SELECT * FROM whitelist_managers WHERE guild_id = ? ORDER BY role_id');
const addManager = db.prepare(
  'INSERT OR IGNORE INTO whitelist_managers (guild_id, role_id, manager_role_id) VALUES (?, ?, ?)'
);
const removeManager = db.prepare(
  'DELETE FROM whitelist_managers WHERE guild_id = ? AND role_id = ? AND manager_role_id = ?'
);
const removeAllManagers = db.prepare('DELETE FROM whitelist_managers WHERE guild_id = ? AND role_id = ?');

const addEntry = db.prepare(
  'INSERT OR IGNORE INTO whitelist_entries (guild_id, user_id, role_id, added_by, added_at) VALUES (?, ?, ?, ?, ?)'
);
const removeEntry = db.prepare(
  'DELETE FROM whitelist_entries WHERE guild_id = ? AND user_id = ? AND role_id = ?'
);
const entriesByRole = db.prepare(
  'SELECT * FROM whitelist_entries WHERE guild_id = ? AND role_id = ? ORDER BY added_at DESC'
);
const deleteEntriesByRole = db.prepare('DELETE FROM whitelist_entries WHERE guild_id = ? AND role_id = ?');

function isConfigured(guildId, roleId) {
  return getManagers.all(guildId, roleId).length > 0;
}

// Autorisé si staff/admin, ou si le membre possède un des rôles gérants du rôle métier.
function canManage(member, roleId) {
  if (getGrade(member) >= GRADES.STAFF) return true;
  return getManagers
    .all(member.guild.id, roleId)
    .some((r) => member.roles.cache.has(r.manager_role_id));
}

module.exports = {
  grade: GRADES.EVERYONE, // contrôle fin par sous-commande dans execute()
  data: new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Whitelist métier : attribution des rôles par les gérants autorisés')
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('Whitelister une recrue : le bot lui attribue le rôle métier')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Recrue à whitelister').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Rôle métier à attribuer (ex : @Policier)').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Retirer quelqu\'un de la whitelist : le bot lui retire le rôle métier')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre à retirer').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Rôle métier à retirer').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('liste')
        .setDescription('Voir les membres whitelistés d\'un rôle métier')
        .addRoleOption((o) => o.setName('role').setDescription('Rôle métier').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('roles').setDescription('Voir les rôles métier que vous êtes autorisé à attribuer')
    )
    .addSubcommandGroup((group) =>
      group
        .setName('config')
        .setDescription('[Admin] Configurer les autorisations de whitelist')
        .addSubcommand((sub) =>
          sub
            .setName('ajouter')
            .setDescription('[Admin] Autoriser un gérant à whitelister un ou plusieurs rôles métier')
            .addRoleOption((o) => o.setName('gerant').setDescription('Rôle gérant autorisé (ex : @Gérant Police)').setRequired(true))
            .addRoleOption((o) => o.setName('role').setDescription('Rôle métier (ex : @Policier)').setRequired(true))
            .addRoleOption((o) => o.setName('role2').setDescription('2e rôle métier (facultatif)').setRequired(false))
            .addRoleOption((o) => o.setName('role3').setDescription('3e rôle métier (facultatif)').setRequired(false))
            .addRoleOption((o) => o.setName('role4').setDescription('4e rôle métier (facultatif)').setRequired(false))
        )
        .addSubcommand((sub) =>
          sub
            .setName('retirer')
            .setDescription('[Admin] Retirer une autorisation (ou tout le rôle métier si gérant omis)')
            .addRoleOption((o) => o.setName('role').setDescription('Rôle métier').setRequired(true))
            .addRoleOption((o) => o.setName('gerant').setDescription('Rôle gérant à retirer (omis = tout supprimer)').setRequired(false))
        )
    ),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    // ----- /whitelist config … : sécurité grade élevé (administration) -----
    if (group === 'config') {
      if (getGrade(interaction.member) < GRADES.ADMIN) {
        return interaction.reply({
          content: '⛔ Sécurité : la configuration de la whitelist est réservée à l\'**administration**.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const role = interaction.options.getRole('role');
      if (role.id === interaction.guild.id) {
        return interaction.reply({ content: '❌ @everyone ne peut pas être un rôle métier.', flags: MessageFlags.Ephemeral });
      }

      if (sub === 'ajouter') {
        const gerant = interaction.options.getRole('gerant');
        if (gerant.id === interaction.guild.id) {
          return interaction.reply({ content: '❌ @everyone ne peut pas être un rôle gérant.', flags: MessageFlags.Ephemeral });
        }
        // Un gérant peut être autorisé sur PLUSIEURS rôles métier d'un coup.
        const metierRoles = [];
        for (const key of ['role', 'role2', 'role3', 'role4']) {
          const r = interaction.options.getRole(key);
          if (r && r.id !== interaction.guild.id && !metierRoles.some((m) => m.id === r.id)) metierRoles.push(r);
        }
        if (!metierRoles.length) {
          return interaction.reply({ content: '❌ Indiquez au moins un rôle métier valide.', flags: MessageFlags.Ephemeral });
        }
        for (const r of metierRoles) addManager.run(interaction.guildId, r.id, gerant.id);
        const list = metierRoles.map((r) => `${r}`).join(', ');
        await interaction.reply({
          content: `✅ Les membres ayant le rôle ${gerant} peuvent désormais whitelister : ${list}.`,
        });
        await sendLog(
          interaction.guild,
          logEmbed(
            '📋 Whitelist configurée',
            `<@${interaction.user.id}> a autorisé <@&${gerant.id}> à whitelister ${metierRoles.map((r) => `<@&${r.id}>`).join(', ')}.`,
            COLORS.SUCCESS
          )
        );
        return;
      }

      // config retirer
      const gerant = interaction.options.getRole('gerant');
      if (gerant) {
        const result = removeManager.run(interaction.guildId, role.id, gerant.id);
        if (result.changes === 0) {
          return interaction.reply({
            content: `❌ ${gerant} n'était pas autorisé pour ${role}.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        await interaction.reply({ content: `🗑️ ${gerant} ne peut plus whitelister ${role}.` });
      } else {
        removeAllManagers.run(interaction.guildId, role.id);
        deleteEntriesByRole.run(interaction.guildId, role.id);
        await interaction.reply({
          content: `🗑️ Rôle métier ${role} retiré de la whitelist (autorisations et inscriptions supprimées — les rôles Discord déjà attribués ne sont pas retirés).`,
        });
      }
      await sendLog(
        interaction.guild,
        logEmbed(
          '📋 Whitelist configurée',
          `<@${interaction.user.id}> a retiré ${gerant ? `l'autorisation de <@&${gerant.id}> pour` : 'le rôle métier'} <@&${role.id}>.`,
          COLORS.WARNING
        )
      );
      return;
    }

    // ----- /whitelist roles : ce que le membre peut attribuer -----
    if (sub === 'roles') {
      const mappings = allManagers.all(interaction.guildId);
      if (!mappings.length) {
        return interaction.reply({
          content: '📋 Aucun rôle métier n\'est configuré (`/whitelist config ajouter`).',
          flags: MessageFlags.Ephemeral,
        });
      }
      const isStaff = getGrade(interaction.member) >= GRADES.STAFF;
      const byRole = new Map();
      for (const m of mappings) {
        if (!byRole.has(m.role_id)) byRole.set(m.role_id, []);
        byRole.get(m.role_id).push(m.manager_role_id);
      }
      const lines = [];
      for (const [roleId, managerIds] of byRole) {
        const authorized = isStaff || managerIds.some((id) => interaction.member.roles.cache.has(id));
        if (isStaff) {
          lines.push(`• <@&${roleId}> — gérants : ${managerIds.map((id) => `<@&${id}>`).join(', ')}`);
        } else if (authorized) {
          lines.push(`• <@&${roleId}>`);
        }
      }
      if (!lines.length) {
        return interaction.reply({
          content: '📋 Vous n\'êtes autorisé à whitelister **aucun** rôle métier.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const embed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setTitle(isStaff ? '📋 Whitelist : configuration complète' : '📋 Rôles que vous pouvez whitelister')
        .setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // ----- ajouter / retirer / liste : rôle métier requis + autorisation -----
    const role = interaction.options.getRole('role');
    if (role.id === interaction.guild.id) {
      return interaction.reply({ content: '❌ Rôle invalide.', flags: MessageFlags.Ephemeral });
    }
    if (!isConfigured(interaction.guildId, role.id)) {
      return interaction.reply({
        content: `❌ ${role} n'est pas un rôle métier configuré dans la whitelist (\`/whitelist config ajouter\`).`,
        flags: MessageFlags.Ephemeral,
      });
    }
    // Sécurité : impossible d'attribuer un rôle qui ne vous a pas été autorisé.
    if (!canManage(interaction.member, role.id)) {
      await sendLog(
        interaction.guild,
        logEmbed(
          '🛑 Whitelist : accès refusé',
          `<@${interaction.user.id}> a tenté \`/whitelist ${sub}\` sur <@&${role.id}> sans autorisation.`,
          COLORS.WARNING
        )
      );
      return interaction.reply({
        content: `⛔ Sécurité : vous n'êtes **pas autorisé** à gérer la whitelist du rôle ${role}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'liste') {
      const entries = entriesByRole.all(interaction.guildId, role.id);
      const lines = entries
        .slice(0, 30)
        .map((e) => `• <@${e.user_id}> (whitelisté par <@${e.added_by}>)`);
      const embed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setTitle(`📋 Whitelist — ${role.name} (${entries.length})`)
        .setDescription(lines.join('\n') || '*Personne pour le moment*');
      if (entries.length > 30) embed.setFooter({ text: `… et ${entries.length - 30} autre(s)` });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('utilisateur');
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.reply({ content: '❌ Ce membre n\'est pas sur le serveur.', flags: MessageFlags.Ephemeral });
    }

    if (sub === 'ajouter') {
      try {
        await member.roles.add(role, `Whitelist par ${interaction.user.tag}`);
      } catch {
        return interaction.reply({
          content: `❌ Impossible d'attribuer ${role} : vérifiez que le rôle du bot est **au-dessus** de ce rôle et qu'il a la permission **Gérer les rôles**.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      addEntry.run(interaction.guildId, user.id, role.id, interaction.user.id, new Date().toISOString());
      await interaction.reply({
        content: `✅ <@${user.id}> a été whitelisté : le rôle ${role} lui a été **attribué automatiquement**.`,
      });
      await sendLog(
        interaction.guild,
        logEmbed('📋 Whitelist', `<@${user.id}> whitelisté <@&${role.id}> par <@${interaction.user.id}>.`, COLORS.SUCCESS)
      );
      return;
    }

    // retirer
    try {
      await member.roles.remove(role, `Retrait de la whitelist par ${interaction.user.tag}`);
    } catch {
      return interaction.reply({
        content: `❌ Impossible de retirer ${role} : vérifiez la hiérarchie des rôles et la permission **Gérer les rôles** du bot.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    removeEntry.run(interaction.guildId, user.id, role.id);
    await interaction.reply({
      content: `🗑️ <@${user.id}> a été retiré de la whitelist : le rôle ${role} lui a été **retiré**.`,
    });
    await sendLog(
      interaction.guild,
      logEmbed('📋 Whitelist', `<@${user.id}> retiré de <@&${role.id}> par <@${interaction.user.id}>.`, COLORS.WARNING)
    );
  },
};
