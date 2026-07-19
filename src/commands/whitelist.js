const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { db, getGuildConfig, setGuildConfig } = require('../database');
const { COLORS, sendLog, logEmbed } = require('../utils/embeds');
const { GRADES, getGrade } = require('../utils/permissions');

const addEntry = db.prepare(
  'INSERT OR IGNORE INTO whitelist (guild_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)'
);
const removeEntry = db.prepare('DELETE FROM whitelist WHERE guild_id = ? AND user_id = ?');
const listEntries = db.prepare('SELECT * FROM whitelist WHERE guild_id = ? ORDER BY added_at DESC');
const hasEntry = db.prepare('SELECT 1 FROM whitelist WHERE guild_id = ? AND user_id = ?');

module.exports = {
  grade: GRADES.STAFF,
  data: new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Gestion de la whitelist du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('[Staff] Ajouter un membre à la whitelist')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre à whitelister').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('[Staff] Retirer un membre de la whitelist')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre à retirer').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('[Staff] Voir la whitelist'))
    .addSubcommand((sub) => sub.setName('activer').setDescription('[Admin] Activer la whitelist (kick des non-whitelistés à l\'arrivée)'))
    .addSubcommand((sub) => sub.setName('desactiver').setDescription('[Admin] Désactiver la whitelist')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // Sécurité grade élevé : activer/désactiver est réservé à l'administration.
    if ((sub === 'activer' || sub === 'desactiver') && getGrade(interaction.member) < GRADES.ADMIN) {
      return interaction.reply({
        content: '⛔ Sécurité : cette sous-commande est réservée à l\'**administration**.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'ajouter') {
      const user = interaction.options.getUser('utilisateur');
      if (hasEntry.get(interaction.guildId, user.id)) {
        return interaction.reply({ content: `❌ <@${user.id}> est déjà whitelisté.`, flags: MessageFlags.Ephemeral });
      }
      addEntry.run(interaction.guildId, user.id, interaction.user.id, new Date().toISOString());
      await interaction.reply({ content: `✅ <@${user.id}> ajouté à la whitelist.` });
      await sendLog(
        interaction.guild,
        logEmbed('📋 Whitelist', `<@${user.id}> ajouté par <@${interaction.user.id}>.`, COLORS.SUCCESS)
      );
      return;
    }

    if (sub === 'retirer') {
      const user = interaction.options.getUser('utilisateur');
      const result = removeEntry.run(interaction.guildId, user.id);
      if (result.changes === 0) {
        return interaction.reply({ content: `❌ <@${user.id}> n'est pas whitelisté.`, flags: MessageFlags.Ephemeral });
      }
      await interaction.reply({ content: `🗑️ <@${user.id}> retiré de la whitelist.` });
      await sendLog(
        interaction.guild,
        logEmbed('📋 Whitelist', `<@${user.id}> retiré par <@${interaction.user.id}>.`, COLORS.WARNING)
      );
      return;
    }

    if (sub === 'liste') {
      const entries = listEntries.all(interaction.guildId);
      const cfg = getGuildConfig(interaction.guildId);
      const status = cfg.whitelist_enabled ? '🟢 **Activée**' : '🔴 **Désactivée**';
      const lines = entries.slice(0, 30).map((e) => `• <@${e.user_id}> (ajouté par <@${e.added_by}>)`);
      const embed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setTitle(`📋 Whitelist (${entries.length} membre(s))`)
        .setDescription(`État : ${status}\n\n${lines.join('\n') || '*Aucun membre whitelisté*'}`);
      if (entries.length > 30) embed.setFooter({ text: `… et ${entries.length - 30} autre(s)` });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const enable = sub === 'activer';
    setGuildConfig(interaction.guildId, 'whitelist_enabled', enable ? 1 : 0);
    await interaction.reply({
      content: enable
        ? '🟢 Whitelist **activée** : tout nouveau membre non whitelisté sera expulsé automatiquement.'
        : '🔴 Whitelist **désactivée**.',
    });
    await sendLog(
      interaction.guild,
      logEmbed('📋 Whitelist', `Whitelist ${enable ? 'activée' : 'désactivée'} par <@${interaction.user.id}>.`, enable ? COLORS.SUCCESS : COLORS.DANGER)
    );
  },
};
