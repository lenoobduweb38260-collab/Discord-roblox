const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { db } = require('../database');
const { COLORS, frDateTime } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');
const rp = require('../utils/rpList');

// Casier RP d'un membre : points de warn RP, historique blacklist RP et
// whitelist RP (entrées actives ET retirées, conservées comme trace).
const warnSum = db.prepare('SELECT COALESCE(SUM(delta), 0) AS s FROM warn_rp WHERE guild_id = ? AND user_id = ?');
const warnCount = db.prepare('SELECT COUNT(*) AS n FROM warn_rp WHERE guild_id = ? AND user_id = ? AND delta < 0');

function fmtList(rows) {
  if (!rows.length) return '*Aucune.*';
  return rows
    .map(
      (r) =>
        `${r.active ? '🔴' : '⚪'} **${r.roblox_name || '?'}**${r.reason ? ` — ${r.reason}` : ''} · ${frDateTime(r.at)}` +
        `${r.active ? '' : ` → retiré${r.removed_at ? ` ${frDateTime(r.removed_at)}` : ''}`}`
    )
    .join('\n')
    .slice(0, 1024);
}

module.exports = {
  module: 'rp',
  grade: GRADES.STAFF,
  data: new SlashCommandBuilder()
    .setName('casier')
    .setDescription('[Staff] Casier RP d\'un membre : warns, blacklist et whitelist RP')
    .addUserOption((o) => o.setName('utilisateur').setDescription('Membre à consulter').setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser('utilisateur');
    const points = Math.max(0, Math.min(7, 7 + warnSum.get(interaction.guildId, user.id).s));
    const warns = warnCount.get(interaction.guildId, user.id).n;
    const bl = rp.historyOf('blrp', interaction.guildId, user.id);
    const wl = rp.historyOf('wlrp', interaction.guildId, user.id);

    const embed = new EmbedBuilder()
      .setColor(points <= 2 ? COLORS.DANGER : COLORS.INFO)
      .setTitle(`🗂️ Casier RP — ${user.username}`)
      .setThumbnail(user.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: '🔻 Warn RP', value: `**${points}/7 points** · ${warns} warn(s) appliqué(s)` },
        { name: `🚫 Blacklist RP (${bl.length})`, value: fmtList(bl) },
        { name: `✅ Whitelist RP (${wl.length})`, value: fmtList(wl) }
      )
      .setFooter({ text: `ID : ${user.id}` })
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  },
};
