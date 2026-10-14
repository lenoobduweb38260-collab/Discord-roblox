const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { COLORS, sendLog, logEmbed } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');

const insertPresence = db.prepare(
  'INSERT INTO staff_presence (guild_id, user_id, type, note, at) VALUES (?, ?, ?, ?, ?)'
);

async function announce(interaction, type, note) {
  const isArrival = type === 'arrivee';
  insertPresence.run(interaction.guildId, interaction.user.id, type, note, new Date().toISOString());

  const embed = new EmbedBuilder()
    .setColor(isArrival ? COLORS.SUCCESS : COLORS.WARNING)
    .setTitle(isArrival ? '🟢 Arrivée staff' : '🔴 Départ staff')
    .setDescription(
      `${isArrival ? '📥' : '📤'} <@${interaction.user.id}> est ${isArrival ? 'arrivé(e) en poste' : 'parti(e)'}.` +
        (note ? `\n**Note :** ${note}` : '')
    )
    .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
    .setTimestamp();

  // Annonce dans le salon staff configuré, sinon dans le salon courant.
  const cfg = getGuildConfig(interaction.guildId);
  let announced = false;
  if (cfg.staff_channel_id) {
    const channel = await interaction.guild.channels.fetch(cfg.staff_channel_id).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send({ embeds: [embed] });
      announced = true;
    }
  }
  if (announced) {
    await interaction.reply({
      content: `✅ ${isArrival ? 'Arrivée' : 'Départ'} enregistré(e) et annoncé(e).`,
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.reply({ embeds: [embed] });
  }
  await sendLog(
    interaction.guild,
    logEmbed(
      isArrival ? '🟢 Staff : arrivée' : '🔴 Staff : départ',
      `<@${interaction.user.id}>${note ? ` — ${note}` : ''}`,
      isArrival ? COLORS.SUCCESS : COLORS.WARNING
    )
  );
}

module.exports = [
  {
    grade: GRADES.STAFF,
    data: new SlashCommandBuilder()
      .setName('arrivee')
      .setDescription('[Staff] Annoncer votre arrivée en poste')
      .addStringOption((o) => o.setName('note').setDescription('Note optionnelle').setRequired(false)),
    async execute(interaction) {
      await announce(interaction, 'arrivee', interaction.options.getString('note'));
    },
  },
  {
    grade: GRADES.STAFF,
    data: new SlashCommandBuilder()
      .setName('depart')
      .setDescription('[Staff] Annoncer votre départ de poste')
      .addStringOption((o) => o.setName('note').setDescription('Note optionnelle').setRequired(false)),
    async execute(interaction) {
      await announce(interaction, 'depart', interaction.options.getString('note'));
    },
  },
];
