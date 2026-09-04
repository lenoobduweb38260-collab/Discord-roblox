const { Events } = require('discord.js');
const { db, getGuildConfig } = require('../database');

// Récupération automatique du salon preuves : chaque message posté dans le
// salon preuves configuré (/config → Salons → 🖼️ Salon des preuves) est
// enregistré pour que le staff du bot le retrouve depuis la base de données
// du dashboard (avec l'auteur, le contenu et les pièces jointes).

const insertProof = db.prepare(
  'INSERT OR IGNORE INTO proof_messages (guild_id, channel_id, message_id, author_id, author_tag, content, attachments, at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      if (!message.guild || message.author?.bot) return;
      const cfg = getGuildConfig(message.guild.id);
      if (!cfg.proof_channel_id || message.channelId !== cfg.proof_channel_id) return;
      const attachments = [...message.attachments.values()].map((a) => a.url);
      insertProof.run(
        message.guild.id,
        message.channelId,
        message.id,
        message.author.id,
        message.author.tag,
        message.content || null,
        attachments.length ? JSON.stringify(attachments) : null,
        new Date(message.createdTimestamp).toISOString()
      );
    } catch (err) {
      console.warn(`⚠️ Récupération du message de preuve impossible : ${err.message}`);
    }
  },
};
