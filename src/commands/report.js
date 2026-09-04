const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { createTicket, hq } = require('../utils/botTickets');

// /report : n'importe quel membre peut signaler un utilisateur — le
// signalement arrive en ticket dans le salon QG de l'équipe du bot, avec les
// boutons Claim / Invitation / Passer / Traiter.

module.exports = {
  grade: GRADES.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('Signaler un utilisateur à l\'équipe du bot')
    .addUserOption((o) => o.setName('utilisateur').setDescription('Utilisateur à signaler').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Que s\'est-il passé ?').setRequired(true).setMaxLength(800)),
  async execute(interaction) {
    if (!hq()) {
      return interaction.reply({
        content: '⚠️ Le système de report n\'est pas encore configuré par l\'équipe du bot.',
        flags: MessageFlags.Ephemeral,
      });
    }
    const target = interaction.options.getUser('utilisateur');
    if (target.id === interaction.user.id) {
      return interaction.reply({ content: '❌ Vous ne pouvez pas vous signaler vous-même.', flags: MessageFlags.Ephemeral });
    }
    if (target.bot) {
      return interaction.reply({ content: '❌ Les bots ne peuvent pas être signalés.', flags: MessageFlags.Ephemeral });
    }
    const ok = await createTicket(interaction.client, {
      kind: 'report',
      guild: interaction.guild,
      targetId: target.id,
      targetTag: target.tag,
      reporterId: interaction.user.id,
      reason: interaction.options.getString('raison'),
    });
    return interaction.reply({
      content: ok
        ? `🚨 Signalement de **${target.tag}** transmis à l'équipe du bot. Merci !`
        : '❌ Signalement impossible pour le moment (QG injoignable) — réessayez plus tard.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
