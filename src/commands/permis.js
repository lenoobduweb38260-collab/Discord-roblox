const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { db, RP_SCOPE } = require('../database');
const { generatePermitNumber } = require('../utils/ids');
const { buildPermitEmbed, sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { themeDe } = require('../utils/rpThemes');
const { GRADES, getGrade, isPolice } = require('../utils/permissions');

const getPermit = db.prepare('SELECT * FROM permits WHERE guild_id = ? AND user_id = ?');
const getCard = db.prepare('SELECT * FROM identity_cards WHERE guild_id = ? AND user_id = ?');
const insertPermit = db.prepare(`
  INSERT INTO permits (permit_number, guild_id, user_id, valid, points, issued_at, issued_by)
  VALUES (?, ?, ?, 1, 12, ?, ?)
`);
const updatePoints = db.prepare('UPDATE permits SET points = ?, valid = ? WHERE guild_id = ? AND user_id = ?');
const setValid = db.prepare('UPDATE permits SET valid = ? WHERE guild_id = ? AND user_id = ?');
const deletePermit = db.prepare('DELETE FROM permits WHERE guild_id = ? AND user_id = ?');

module.exports = {
  module: 'rp', // fait partie du Module RP activable dans /config
  grade: GRADES.EVERYONE, // contrôle fin par sous-commande dans execute()
  data: new SlashCommandBuilder()
    .setName('permis')
    .setDescription('Système de permis de conduire RP')
    .addSubcommand((sub) =>
      sub
        .setName('delivrer')
        .setDescription('[Staff] Délivrer un permis (numéro généré, 12 points, daté du jour)')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre concerné').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('voir')
        .setDescription('Afficher un permis')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre (défaut : vous)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer-points')
        .setDescription('[Staff/Police] Retirer des points (0 point = permis invalide)')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre concerné').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('points').setDescription('Points à retirer').setRequired(true).setMinValue(1).setMaxValue(12)
        )
        .addStringOption((o) => o.setName('raison').setDescription('Raison (infraction RP)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('ajouter-points')
        .setDescription('[Staff] Rendre des points (maximum 12)')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre concerné').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('points').setDescription('Points à rendre').setRequired(true).setMinValue(1).setMaxValue(12)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('invalider')
        .setDescription('[Staff] Invalider un permis (suspension/annulation RP)')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre concerné').setRequired(true))
        .addStringOption((o) => o.setName('raison').setDescription('Raison').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('revalider')
        .setDescription('[Staff] Revalider un permis invalidé')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre concerné').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('supprimer')
        .setDescription('[Staff] Supprimer un permis')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre concerné').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const isStaff = getGrade(interaction.member) >= GRADES.STAFF;
    // Le retrait de points est ouvert au staff ET à la police (rôles configurés).
    const canRemovePoints = isStaff || isPolice(interaction.member);

    if (sub !== 'voir' && !isStaff && !(sub === 'retirer-points' && canRemovePoints)) {
      return interaction.reply({
        content: '⛔ Sécurité : cette sous-commande est réservée au **staff**.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const user = interaction.options.getUser('utilisateur') || interaction.user;

    if (sub === 'delivrer') {
      if (!getCard.get(RP_SCOPE, user.id)) {
        return interaction.reply({
          content: `❌ <@${user.id}> doit d'abord avoir une **carte d'identité** (\`/carte creer\`).`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (getPermit.get(RP_SCOPE, user.id)) {
        return interaction.reply({
          content: `❌ <@${user.id}> possède déjà un permis.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      const number = generatePermitNumber();
      const issuedAt = new Date().toISOString(); // délivrance : date + heure du jour
      insertPermit.run(number, RP_SCOPE, user.id, issuedAt, interaction.user.id);
      const permit = getPermit.get(RP_SCOPE, user.id);
      await interaction.reply({
        content: `✅ Permis délivré à <@${user.id}> — numéro : \`${number}\``,
        embeds: [buildPermitEmbed(permit, user)],
      });
      await sendLog(
        interaction.guild,
        logEmbed('🚗 Permis délivré', `Permis \`${number}\` délivré à <@${user.id}> par <@${interaction.user.id}>.`, COLORS.SUCCESS)
      );
      return;
    }

    const permit = getPermit.get(RP_SCOPE, user.id);
    if (!permit) {
      return interaction.reply({ content: `❌ <@${user.id}> n'a pas de permis.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'voir') {
      const V = require('../utils/carteVisuelle');
      const png = await V.fabriquer(
        V.planPermis(permit, {
          theme: themeDe(interaction.guildId),
          serveur: interaction.guild?.name,
          titulaire: user.username,
          delivre: new Date(permit.issued_at).toLocaleDateString('fr-FR'),
        }),
        { photoUrl: user.displayAvatarURL({ size: 512, extension: 'png' }) }
      ).catch(() => null);
      if (png) {
        const { AttachmentBuilder } = require('discord.js');
        return interaction.reply({ files: [new AttachmentBuilder(png, { name: 'permis.png' })] });
      }
      return interaction.reply({ embeds: [buildPermitEmbed(permit, user)] });
    }

    if (sub === 'retirer-points') {
      const amount = interaction.options.getInteger('points');
      const raison = interaction.options.getString('raison') || 'Aucune raison précisée';
      const newPoints = Math.max(0, permit.points - amount);
      const stillValid = newPoints > 0 ? permit.valid : 0;
      updatePoints.run(newPoints, stillValid, RP_SCOPE, user.id);
      const updated = getPermit.get(RP_SCOPE, user.id);
      await interaction.reply({
        content:
          `⚠️ **${amount}** point(s) retiré(s) à <@${user.id}> — reste **${newPoints}/12**.` +
          (newPoints === 0 ? '\n❌ **Permis invalidé** (plus aucun point).' : ''),
        embeds: [buildPermitEmbed(updated, user)],
      });
      await sendLog(
        interaction.guild,
        logEmbed(
          '🚗 Points retirés',
          `<@${interaction.user.id}> a retiré **${amount}** point(s) à <@${user.id}> (reste ${newPoints}/12).\n**Raison :** ${raison}`,
          COLORS.WARNING
        )
      );
      return;
    }

    if (sub === 'ajouter-points') {
      const amount = interaction.options.getInteger('points');
      const newPoints = Math.min(12, permit.points + amount);
      updatePoints.run(newPoints, permit.valid, RP_SCOPE, user.id);
      const updated = getPermit.get(RP_SCOPE, user.id);
      await interaction.reply({
        content: `✅ **${amount}** point(s) rendu(s) à <@${user.id}> — total **${newPoints}/12**.`,
        embeds: [buildPermitEmbed(updated, user)],
      });
      return;
    }

    if (sub === 'invalider') {
      const raison = interaction.options.getString('raison') || 'Aucune raison précisée';
      setValid.run(0, RP_SCOPE, user.id);
      const updated = getPermit.get(RP_SCOPE, user.id);
      await interaction.reply({
        content: `❌ Permis de <@${user.id}> **invalidé**.`,
        embeds: [buildPermitEmbed(updated, user)],
      });
      await sendLog(
        interaction.guild,
        logEmbed('🚗 Permis invalidé', `Permis de <@${user.id}> invalidé par <@${interaction.user.id}>.\n**Raison :** ${raison}`, COLORS.DANGER)
      );
      return;
    }

    if (sub === 'revalider') {
      setValid.run(1, RP_SCOPE, user.id);
      const updated = getPermit.get(RP_SCOPE, user.id);
      await interaction.reply({
        content: `✅ Permis de <@${user.id}> **revalidé**.`,
        embeds: [buildPermitEmbed(updated, user)],
      });
      return;
    }

    if (sub === 'supprimer') {
      deletePermit.run(RP_SCOPE, user.id);
      await interaction.reply({ content: `🗑️ Permis \`${permit.permit_number}\` de <@${user.id}> supprimé.` });
      await sendLog(
        interaction.guild,
        logEmbed('🚗 Permis supprimé', `Permis de <@${user.id}> supprimé par <@${interaction.user.id}>.`, COLORS.DANGER)
      );
    }
  },
};
