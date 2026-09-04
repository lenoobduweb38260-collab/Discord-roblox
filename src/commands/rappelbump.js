const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { setGuildConfig, getGuildConfig } = require('../database');

// ⏰ /rappel-bump — le bot surveille DISBOARD et prévient quand le serveur
// peut être bump de nouveau (fenêtre de deux heures).

module.exports = {
  grade: GRADES.STAFF,
  guildModule: null,

  data: new SlashCommandBuilder()
    .setName('rappel-bump')
    .setDescription('[Staff] Être prévenu quand le serveur peut être bump sur DISBOARD')
    .addSubcommand((s) => s.setName('activer')
      .setDescription('[Staff] Activer le rappel : choisir le salon (et le rôle à sonner)')
      .addChannelOption((o) => o.setName('salon')
        .setDescription('Salon texte où poster le rappel')
        .addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addRoleOption((o) => o.setName('role')
        .setDescription('Rôle mentionné par le rappel (il sonnera)')))
    .addSubcommand((s) => s.setName('desactiver')
      .setDescription('[Staff] Couper le rappel de bump'))
    .addSubcommand((s) => s.setName('etat')
      .setDescription('[Staff] Où en est le rappel de bump ?')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'activer') {
      const salon = interaction.options.getChannel('salon');
      const role = interaction.options.getRole('role');
      setGuildConfig(interaction.guildId, 'bump_channel_id', String(salon.id));
      setGuildConfig(interaction.guildId, 'bump_role_id', role ? String(role.id) : null);
      return interaction.reply({
        content: `⏰ Rappel de bump **activé** : après chaque \`/bump\` réussi de DISBOARD, je préviens dans <#${salon.id}> deux heures plus tard`
          + (role ? `, en mentionnant <@&${role.id}> (qui sonne).` : '.')
          + '\n-# Je reconnais la réponse « Bump effectué ! » de DISBOARD — rien d\'autre à faire.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (sub === 'desactiver') {
      setGuildConfig(interaction.guildId, 'bump_channel_id', null);
      setGuildConfig(interaction.guildId, 'bump_role_id', null);
      setGuildConfig(interaction.guildId, 'bump_dernier', null);
      return interaction.reply({ content: '🔕 Rappel de bump **coupé**.', flags: MessageFlags.Ephemeral });
    }
    // etat
    const cfg = getGuildConfig(interaction.guildId);
    if (!cfg.bump_channel_id) {
      return interaction.reply({
        content: 'ℹ️ Le rappel de bump est **coupé**. Activez-le avec `/rappel-bump activer`.',
        flags: MessageFlags.Ephemeral,
      });
    }
    const dernier = Number(cfg.bump_dernier) || null;
    const prochain = dernier ? Math.floor((dernier + require('../utils/bumpReminder').DELAI_BUMP) / 1000) : null;
    return interaction.reply({
      content: `⏰ Rappel de bump **actif** — salon : <#${cfg.bump_channel_id}>`
        + (cfg.bump_role_id ? ` · rôle sonné : <@&${cfg.bump_role_id}>` : '')
        + (dernier
          ? `\n➜ Dernier bump vu <t:${Math.floor(dernier / 1000)}:R> — rappel <t:${prochain}:R>.`
          : '\n➜ En attente du prochain `/bump` réussi de DISBOARD.'),
      flags: MessageFlags.Ephemeral,
    });
  },
};
