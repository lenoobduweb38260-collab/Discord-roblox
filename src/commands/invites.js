const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { COLORS } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');
const invitations = require('../utils/invitations');
const M = require('../utils/miseEnPage');

// 📨 Le traqueur d'invitations, côté commandes : qui a amené combien de
// monde, et par qui chacun est arrivé. Les données viennent des arrivées
// observées par le bot (utils/invitations.js) — il ne compte donc qu'à
// partir du moment où il est présent ET a la permission « Gérer le serveur ».

module.exports = {
  grade: GRADES.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Le traqueur d\'invitations : qui a fait venir qui')
    .addSubcommand((s) => s
      .setName('voir')
      .setDescription('Les invitations d\'un membre — et qui l\'a invité')
      .addUserOption((o) => o.setName('membre').setDescription('Sans réponse : vous-même').setRequired(false)))
    .addSubcommand((s) => s
      .setName('classement')
      .setDescription('Les meilleurs inviteurs du serveur')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'voir') {
      const cible = interaction.options.getUser('membre') || interaction.user;
      const total = invitations.totalDe(interaction.guildId, cible.id);
      const venue = invitations.inviteurDe(interaction.guildId, cible.id);
      const lignes = [M.statistique('Invitations', String(total), `membre(s) amené(s) sur ce serveur`)];
      if (venue?.inviter_id) {
        lignes.push(M.entree(`Arrivé(e) grâce à <@${venue.inviter_id}>${venue.code ? ` (code \`${venue.code}\`)` : ''}`));
      } else if (venue) {
        lignes.push(M.entree('Arrivée enregistrée, mais l\'invitation utilisée n\'a pas pu être identifiée (lien de vanité, ou permission « Gérer le serveur » manquante à ce moment-là).'));
      } else {
        lignes.push(M.entree('Aucune arrivée enregistrée : le bot n\'était pas encore là (ou pas équipé du traqueur) quand ce membre a rejoint.'));
      }
      const embed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setTitle(`📨 Invitations — ${cible.username}`)
        .setDescription(lignes.join('\n'))
        .setThumbnail(cible.displayAvatarURL({ size: 128 }));
      return interaction.reply({ embeds: [embed] });
    }

    // classement
    const rangs = invitations.classement(interaction.guildId, 10);
    if (!rangs.length) {
      return interaction.reply({
        content: '📨 Aucune invitation enregistrée pour l\'instant : le traqueur compte les arrivées à partir de maintenant.',
        flags: MessageFlags.Ephemeral,
      });
    }
    const medailles = ['🥇', '🥈', '🥉'];
    const entrees = rangs.map((r, i) =>
      `${medailles[i] || `**${i + 1}.**`} <@${r.inviter_id}> — **${r.n}** invitation(s)`);
    const embed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle('🏆 Meilleurs inviteurs')
      .setDescription(M.description([M.bloc('Classement du serveur', entrees, { compte: null })]))
      .setFooter({ text: M.piedDePage({ total: rangs.reduce((s, r) => s + r.n, 0), motTotal: 'invitation' }) });
    return interaction.reply({ embeds: [embed] });
  },
};
