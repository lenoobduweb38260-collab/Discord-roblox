const { db } = require('../database');

// Sauvegarde des messages supprimés / modifiés en base (« snipe »). On conserve
// au plus les 50 derniers par salon pour garder la table légère.
const insert = db.prepare(
  'INSERT INTO deleted_messages (guild_id, channel_id, author_id, author_tag, kind, content, before_content, attachments, at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const trimChannel = db.prepare(
  'DELETE FROM deleted_messages WHERE channel_id = ? AND id NOT IN ' +
    '(SELECT id FROM deleted_messages WHERE channel_id = ? ORDER BY id DESC LIMIT 50)'
);
const recent = db.prepare(
  'SELECT * FROM deleted_messages WHERE guild_id = ? AND channel_id = ? AND kind = ? ORDER BY id DESC LIMIT ?'
);

function record({ guildId, channelId, authorId, authorTag, kind, content, beforeContent, attachments }) {
  try {
    insert.run(guildId, channelId, authorId || null, authorTag || null, kind, content || null, beforeContent || null, attachments || null, new Date().toISOString());
    trimChannel.run(channelId, channelId);
  } catch (err) {
    console.warn(`⚠️ Snipe non enregistré : ${err.message}`);
  }
}

const recentDeleted = (guildId, channelId, n) => recent.all(guildId, channelId, 'delete', n);
const recentEdited = (guildId, channelId, n) => recent.all(guildId, channelId, 'edit', n);

module.exports = { record, recentDeleted, recentEdited };
