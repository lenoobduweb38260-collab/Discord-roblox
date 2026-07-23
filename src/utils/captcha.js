const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { getGuildConfig } = require('../database');
const { COLORS } = require('./embeds');

// Captcha de vérification à l'arrivée : un bouton, puis un code aléatoire à
// recopier. Réussi → le rôle « vérifié » configuré est attribué.
const pending = new Map(); // "guild:user" -> code attendu

function genCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function onJoin(member) {
  const cfg = getGuildConfig(member.guild.id);
  if (!cfg.captcha_enabled || !cfg.verified_role_id) return;
  const channel = cfg.captcha_channel_id
    ? await member.guild.channels.fetch(cfg.captcha_channel_id).catch(() => null)
    : member.guild.systemChannel;
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🤖 Vérification')
    .setDescription(`Bienvenue <@${member.id}> ! Cliquez sur le bouton pour prouver que vous n'êtes pas un robot et accéder au serveur.`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('captcha:verify').setLabel('Je ne suis pas un robot').setEmoji('✅').setStyle(ButtonStyle.Success)
  );
  await channel.send({ content: `<@${member.id}>`, embeds: [embed], components: [row] }).catch(() => null);
}

async function handle(interaction) {
  if (interaction.isButton()) {
    const code = genCode();
    pending.set(`${interaction.guildId}:${interaction.user.id}`, code);
    const modal = new ModalBuilder().setCustomId('captcha:check').setTitle('Vérification');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('code')
          .setLabel(`Recopiez ce code : ${code}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(5)
          .setMaxLength(5)
      )
    );
    return interaction.showModal(modal);
  }

  // Soumission du modal
  const key = `${interaction.guildId}:${interaction.user.id}`;
  const expected = pending.get(key);
  const given = interaction.fields.getTextInputValue('code').trim().toUpperCase();
  if (!expected || given !== expected) {
    return interaction.reply({ content: '❌ Code incorrect. Recliquez sur le bouton pour réessayer.', flags: MessageFlags.Ephemeral });
  }
  pending.delete(key);
  const cfg = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (cfg.verified_role_id && member) {
    await member.roles.add(cfg.verified_role_id, 'Captcha validé').catch(() => null);
  }
  return interaction.reply({ content: '✅ Vérifié ! Bienvenue 🎉', flags: MessageFlags.Ephemeral });
}

module.exports = { onJoin, handle };
