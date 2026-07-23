const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { COLORS, frDateTime } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');
const { recentDeleted, recentEdited } = require('../utils/snipe');

// /snipe : retrouve les derniers messages supprimés ou modifiés d'un salon
// (sauvegardés en base). Réservé au staff (contenu potentiellement sensible).
function fieldFor(row) {
  let atts = [];
  try {
    atts = JSON.parse(row.attachments || '[]');
  } catch {}
  const parts = [];
  if (row.kind === 'edit') {
    parts.push(`**Avant :** ${(row.before_content || '*vide*').slice(0, 400)}`);
    parts.push(`**Après :** ${(row.content || '*vide*').slice(0, 400)}`);
  } else {
    parts.push((row.content || '*sans texte*').slice(0, 700));
    if (atts.length) parts.push(`📎 ${atts.length} pièce(s) jointe(s)`);
  }
  return {
    name: `${row.author_tag || row.author_id || 'inconnu'} · ${frDateTime(row.at)}`,
    value: parts.join('\n').slice(0, 1024),
  };
}

module.exports = {
  grade: GRADES.STAFF,
  data: new SlashCommandBuilder()
    .setName('snipe')
    .setDescription('[Staff] Retrouve les derniers messages supprimés ou modifiés d\'un salon')
    .addSubcommand((sub) =>
      sub
        .setName('supprimes')
        .setDescription('Derniers messages supprimés')
        .addChannelOption((o) => o.setName('salon').setDescription('Salon (défaut : ici)').addChannelTypes(ChannelType.GuildText).setRequired(false))
        .addIntegerOption((o) => o.setName('nombre').setDescription('Combien (1-10)').setMinValue(1).setMaxValue(10).setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('modifies')
        .setDescription('Derniers messages modifiés')
        .addChannelOption((o) => o.setName('salon').setDescription('Salon (défaut : ici)').addChannelTypes(ChannelType.GuildText).setRequired(false))
        .addIntegerOption((o) => o.setName('nombre').setDescription('Combien (1-10)').setMinValue(1).setMaxValue(10).setRequired(false))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel('salon') || interaction.channel;
    const n = interaction.options.getInteger('nombre') || 3;
    const rows = sub === 'modifies'
      ? recentEdited(interaction.guildId, channel.id, n)
      : recentDeleted(interaction.guildId, channel.id, n);

    if (!rows.length) {
      return interaction.reply({ content: `📭 Aucun message ${sub === 'modifies' ? 'modifié' : 'supprimé'} enregistré pour <#${channel.id}>.` });
    }
    const embed = new EmbedBuilder()
      .setColor(sub === 'modifies' ? COLORS.WARNING : COLORS.DANGER)
      .setTitle(`${sub === 'modifies' ? '✏️ Messages modifiés' : '🗑️ Messages supprimés'} — #${channel.name}`)
      .addFields(rows.map(fieldFor))
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  },
};
