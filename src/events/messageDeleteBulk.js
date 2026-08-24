const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');

// Suppression en masse (purge, ban avec nettoyage) : le nombre, le salon,
// et les auteurs touchés quand les messages étaient en cache.
module.exports = {
  name: Events.MessageBulkDelete,
  async execute(messages, channel) {
    if (!channel.guild) return;
    const auteurs = new Map();
    for (const m of messages.values()) {
      if (!m.author || m.author.bot) continue;
      const entree = auteurs.get(m.author.id) || { n: 0, nom: m.author.username ?? null };
      entree.n += 1;
      auteurs.set(m.author.id, entree);
    }
    const by = await auditExecutor(channel.guild, AuditLogEvent.MessageBulkDelete, channel.id);
    const details = [
      `➜ **${messages.size}** messages supprimés d'un coup dans <#${channel.id}>`,
    ];
    if (by) details.push(`➜ Par : ${by}`);
    if (auteurs.size) {
      details.push(`➜ Auteurs touchés : ${[...auteurs.entries()].slice(0, 15)
        .map(([id, e]) => `${e.nom ? `**${e.nom}**` : `<@${id}>`} (\`${id}\` · ${e.n})`).join(' · ')}`);
    }
    await sendLog(channel.guild, logEmbed('🧹 Suppression en masse', details.join('\n').slice(0, 4000), COLORS.DANGER));
  },
};
