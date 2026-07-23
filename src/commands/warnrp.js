const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { db } = require('../database');
const { COLORS, sendLog, logEmbed, frDateTime } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');

// Warn RP : chaque membre part d'une base de 7 points. Un warn retire des
// points (valeur choisie par le staff), un ajout en remet. Le solde est
// recalculé automatiquement à partir de l'historique (borné entre 0 et 7).
const BASE = 7;

const insertEntry = db.prepare(
  'INSERT INTO warn_rp (guild_id, user_id, delta, reason, by_id, at) VALUES (?, ?, ?, ?, ?, ?)'
);
const historyOf = db.prepare('SELECT * FROM warn_rp WHERE guild_id = ? AND user_id = ? ORDER BY id DESC');
const sumOf = db.prepare('SELECT COALESCE(SUM(delta), 0) AS s FROM warn_rp WHERE guild_id = ? AND user_id = ?');

function pointsOf(guildId, userId) {
  const raw = BASE + sumOf.get(guildId, userId).s;
  return Math.max(0, Math.min(BASE, raw));
}

function statusEmoji(points) {
  if (points <= 0) return '⛔';
  if (points <= 2) return '🔴';
  if (points <= 4) return '🟠';
  return '🟢';
}

async function replyProfile(interaction, user) {
  const points = pointsOf(interaction.guildId, user.id);
  const entries = historyOf.all(interaction.guildId, user.id).slice(0, 15);
  const lines = entries.length
    ? entries.map(
        (e) =>
          `${e.delta < 0 ? `🔻 **-${Math.abs(e.delta)}**` : `🔺 **+${e.delta}**`} · ${e.reason || '*sans raison*'} · par <@${e.by_id}> le ${frDateTime(e.at)}`
      )
    : ['*Aucun warn RP.*'];
  const embed = new EmbedBuilder()
    .setColor(points <= 2 ? COLORS.DANGER : points <= 4 ? COLORS.WARNING : COLORS.SUCCESS)
    .setTitle(`${statusEmoji(points)} Warn RP — ${user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setDescription(`**Solde : ${points} / ${BASE} points**`)
    .addFields({ name: `📋 Historique (${entries.length})`, value: lines.join('\n').slice(0, 1024) })
    .setFooter({ text: `ID : ${user.id}` })
    .setTimestamp();
  return interaction.reply({ embeds: [embed] });
}

module.exports = {
  module: 'rp', // fait partie du Module RP activable dans /config
  grade: GRADES.STAFF,
  data: new SlashCommandBuilder()
    .setName('warnrp')
    .setDescription('[Staff] Warn RP : gère les points RP d\'un membre (base 7)')
    .addSubcommand((sub) =>
      sub
        .setName('warn')
        .setDescription('Applique un warn RP (retire des points)')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre averti').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('points').setDescription('Points à retirer (1-7)').setRequired(true).setMinValue(1).setMaxValue(7)
        )
        .addStringOption((o) => o.setName('raison').setDescription('Raison du warn').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('ajouter-points')
        .setDescription('Redonne des points RP à un membre')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre concerné').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('points').setDescription('Points à redonner (1-7)').setRequired(true).setMinValue(1).setMaxValue(7)
        )
        .addStringOption((o) => o.setName('raison').setDescription('Raison').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('voir')
        .setDescription('Voir les points RP et l\'historique d\'un membre')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre à consulter').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('utilisateur');

    if (sub === 'voir') return replyProfile(interaction, user);

    const points = interaction.options.getInteger('points');
    const raison = interaction.options.getString('raison') || null;
    const delta = sub === 'warn' ? -points : points;
    insertEntry.run(interaction.guildId, user.id, delta, raison, interaction.user.id, new Date().toISOString());
    const total = pointsOf(interaction.guildId, user.id);

    await interaction.reply({
      content:
        sub === 'warn'
          ? `🔻 Warn RP appliqué à <@${user.id}> : **-${points}** point(s).\n**Solde : ${total} / ${BASE}**${raison ? `\n**Raison :** ${raison}` : ''}`
          : `🔺 <@${user.id}> a récupéré **+${points}** point(s).\n**Solde : ${total} / ${BASE}**${raison ? `\n**Raison :** ${raison}` : ''}`,
    });
    await sendLog(
      interaction.guild,
      logEmbed(
        sub === 'warn' ? '🔻 Warn RP' : '🔺 Points RP rendus',
        `<@${user.id}> — ${sub === 'warn' ? `-${points}` : `+${points}`} point(s) par <@${interaction.user.id}> · solde **${total}/${BASE}**${raison ? `\n**Raison :** ${raison}` : ''}`,
        sub === 'warn' ? COLORS.WARNING : COLORS.SUCCESS
      )
    );
  },
};
