const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { db } = require('../database');
const { COLORS, sendLog, logEmbed, frDateTime } = require('../utils/embeds');
const { GRADES, getGrade, isPolice } = require('../utils/permissions');

// Casier judiciaire RP : registre des infractions d'un membre, accessible
// UNIQUEMENT aux rôles police configurés (/config → 👮 Rôles). L'administration
// conserve l'accès pour la mise en place et la supervision. Propre à chaque
// serveur (chaque ville/police a son propre registre).
const insertRec = db.prepare(
  'INSERT INTO criminal_records (guild_id, user_id, offense, sanction, note, by_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const listRecs = db.prepare('SELECT * FROM criminal_records WHERE guild_id = ? AND user_id = ? ORDER BY id DESC');
const getRec = db.prepare('SELECT * FROM criminal_records WHERE id = ? AND guild_id = ?');
const deleteRec = db.prepare('DELETE FROM criminal_records WHERE id = ? AND guild_id = ?');

function canAccess(member) {
  return isPolice(member) || getGrade(member) >= GRADES.ADMIN;
}

module.exports = {
  module: 'rp', // fait partie du Module RP activable dans /config
  grade: GRADES.EVERYONE, // contrôle fin (police) dans execute
  data: new SlashCommandBuilder()
    .setName('casierjudiciaire')
    .setDescription('[Police] Casier judiciaire RP (accès réservé à la police)')
    .addSubcommand((s) =>
      s
        .setName('ajouter')
        .setDescription('[Police] Ajouter une infraction au casier')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Personne concernée').setRequired(true))
        .addStringOption((o) => o.setName('infraction').setDescription('Infraction commise').setRequired(true))
        .addStringOption((o) => o.setName('sanction').setDescription('Sanction / peine (facultatif)').setRequired(false))
        .addStringOption((o) => o.setName('note').setDescription('Note complémentaire (facultatif)').setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName('voir')
        .setDescription('[Police] Consulter le casier judiciaire d\'une personne')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Personne à consulter').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('retirer')
        .setDescription('[Police] Retirer une entrée du casier (par n°)')
        .addIntegerOption((o) => o.setName('numero').setDescription('Numéro de l\'entrée (voir /casierjudiciaire voir)').setRequired(true))
    ),

  async execute(interaction) {
    if (!canAccess(interaction.member)) {
      return interaction.reply({
        content: '⛔ Sécurité : le **casier judiciaire** est réservé aux **rôles police** (à configurer dans `/config` → 👮 Rôles).',
        flags: MessageFlags.Ephemeral,
      });
    }
    const sub = interaction.options.getSubcommand();
    const g = interaction.guildId;

    if (sub === 'ajouter') {
      const user = interaction.options.getUser('utilisateur');
      const infraction = interaction.options.getString('infraction').slice(0, 400);
      const sanction = interaction.options.getString('sanction')?.slice(0, 300) || null;
      const note = interaction.options.getString('note')?.slice(0, 400) || null;
      const res = insertRec.run(g, user.id, infraction, sanction, note, interaction.user.id, new Date().toISOString());
      const embed = new EmbedBuilder()
        .setColor(COLORS.WARNING)
        .setTitle('⚖️ Casier judiciaire — infraction enregistrée')
        .addFields(
          { name: '👤 Personne', value: `<@${user.id}>`, inline: true },
          { name: '📄 N°', value: `\`${res.lastInsertRowid}\``, inline: true },
          { name: '✍️ Agent', value: `<@${interaction.user.id}>`, inline: true },
          { name: '🚨 Infraction', value: infraction, inline: false },
          { name: '⚖️ Sanction', value: sanction || '*Aucune*', inline: true }
        )
        .setTimestamp();
      if (note) embed.addFields({ name: '🗒️ Note', value: note });
      await interaction.reply({ embeds: [embed] });
      await sendLog(
        interaction.guild,
        logEmbed('⚖️ Casier judiciaire', `Infraction enregistrée au casier de <@${user.id}> par <@${interaction.user.id}> : ${infraction}`, COLORS.WARNING)
      );
      return;
    }

    if (sub === 'voir') {
      const user = interaction.options.getUser('utilisateur');
      const rows = listRecs.all(g, user.id);
      const embed = new EmbedBuilder()
        .setColor(rows.length ? COLORS.INFO : COLORS.SUCCESS)
        .setTitle(`⚖️ Casier judiciaire — ${user.username} (${rows.length})`)
        .setThumbnail(user.displayAvatarURL({ size: 128 }))
        .setFooter({ text: `ID : ${user.id}` });
      if (!rows.length) {
        embed.setDescription('✅ Casier vierge.');
      } else {
        for (const r of rows.slice(0, 20)) {
          embed.addFields({
            name: `#${r.id} — ${frDateTime(r.at)}`,
            value: `🚨 ${r.offense}${r.sanction ? `\n⚖️ ${r.sanction}` : ''}${r.note ? `\n🗒️ ${r.note}` : ''}\n✍️ <@${r.by_id}>`.slice(0, 1024),
          });
        }
        if (rows.length > 20) embed.setFooter({ text: `… et ${rows.length - 20} autre(s) · ID : ${user.id}` });
      }
      return interaction.reply({ embeds: [embed] });
    }

    // retirer
    const numero = interaction.options.getInteger('numero');
    const rec = getRec.get(numero, g);
    if (!rec) {
      return interaction.reply({ content: `❌ Entrée n°${numero} introuvable dans ce serveur.`, flags: MessageFlags.Ephemeral });
    }
    deleteRec.run(numero, g);
    await interaction.reply({ content: `🗑️ Entrée n°${numero} retirée du casier judiciaire de <@${rec.user_id}>.` });
    await sendLog(
      interaction.guild,
      logEmbed('⚖️ Casier judiciaire', `Entrée n°${numero} retirée du casier de <@${rec.user_id}> par <@${interaction.user.id}>.`, COLORS.INFO)
    );
  },
};
