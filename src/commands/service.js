const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { COLORS, sendLog, logEmbed } = require('../utils/embeds');
const { GRADES, getGrade } = require('../utils/permissions');

const getOpenService = db.prepare(
  'SELECT * FROM services WHERE guild_id = ? AND user_id = ? AND end_at IS NULL'
);
const startService = db.prepare('INSERT INTO services (guild_id, user_id, start_at) VALUES (?, ?, ?)');
const endService = db.prepare('UPDATE services SET end_at = ? WHERE id = ?');
const listOpenServices = db.prepare('SELECT * FROM services WHERE guild_id = ? AND end_at IS NULL');

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

async function announceService(interaction, embed) {
  const cfg = getGuildConfig(interaction.guildId);
  if (!cfg.service_channel_id) return false;
  const channel = await interaction.guild.channels.fetch(cfg.service_channel_id).catch(() => null);
  if (!channel?.isTextBased()) return false;
  await channel.send({ embeds: [embed] });
  return true;
}

module.exports = {
  module: 'rp', // fait partie du Module RP activable dans /config
  grade: GRADES.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('service')
    .setDescription('Système de prise/fin de service RP')
    .addSubcommand((sub) => sub.setName('prise').setDescription('Prendre votre service RP'))
    .addSubcommand((sub) => sub.setName('fin').setDescription('Terminer votre service RP'))
    .addSubcommand((sub) => sub.setName('liste').setDescription('[Staff] Voir qui est actuellement en service')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cfg = getGuildConfig(interaction.guildId);

    if (sub === 'liste') {
      if (getGrade(interaction.member, cfg) < GRADES.STAFF) {
        return interaction.reply({
          content: '⛔ Sécurité : cette sous-commande est réservée au **staff**.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const open = listOpenServices.all(interaction.guildId);
      if (!open.length) {
        return interaction.reply({ content: '📋 Personne n\'est en service actuellement.', flags: MessageFlags.Ephemeral });
      }
      const lines = open.map(
        (s) => `• <@${s.user_id}> — depuis <t:${Math.floor(new Date(s.start_at).getTime() / 1000)}:R>`
      );
      const embed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setTitle(`🧑‍💼 En service (${open.length})`)
        .setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const open = getOpenService.get(interaction.guildId, interaction.user.id);

    if (sub === 'prise') {
      if (open) {
        return interaction.reply({ content: '❌ Vous êtes déjà en service (`/service fin` pour terminer).', flags: MessageFlags.Ephemeral });
      }
      startService.run(interaction.guildId, interaction.user.id, new Date().toISOString());
      if (cfg.service_role_id) {
        await interaction.member.roles.add(cfg.service_role_id).catch(() => null);
      }
      const embed = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle('🟢 Prise de service')
        .setDescription(`<@${interaction.user.id}> est maintenant **en service**.`)
        .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
        .setTimestamp();
      const announced = await announceService(interaction, embed);
      await interaction.reply(
        announced
          ? { content: '✅ Prise de service enregistrée et annoncée.', flags: MessageFlags.Ephemeral }
          : { embeds: [embed] }
      );
      return;
    }

    if (sub === 'fin') {
      if (!open) {
        return interaction.reply({ content: '❌ Vous n\'êtes pas en service (`/service prise` pour commencer).', flags: MessageFlags.Ephemeral });
      }
      endService.run(new Date().toISOString(), open.id);
      if (cfg.service_role_id) {
        await interaction.member.roles.remove(cfg.service_role_id).catch(() => null);
      }
      const duration = formatDuration(Date.now() - new Date(open.start_at).getTime());
      const embed = new EmbedBuilder()
        .setColor(COLORS.WARNING)
        .setTitle('🔴 Fin de service')
        .setDescription(`<@${interaction.user.id}> a terminé son service.\n⏱️ **Durée :** ${duration}`)
        .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
        .setTimestamp();
      const announced = await announceService(interaction, embed);
      await interaction.reply(
        announced
          ? { content: `✅ Fin de service enregistrée (durée : ${duration}).`, flags: MessageFlags.Ephemeral }
          : { embeds: [embed] }
      );
      await sendLog(
        interaction.guild,
        logEmbed('🧑‍💼 Service terminé', `<@${interaction.user.id}> — durée : ${duration}`, COLORS.INFO)
      );
    }
  },
};
