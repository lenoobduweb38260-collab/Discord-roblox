const { EmbedBuilder } = require('discord.js');
const { db } = require('../database');

// Équipe du bot : hiérarchie de staff PROPRE AU BOT (indépendante des serveurs),
// gérée par le créateur via /botstaff. Chaque membre a un grade (texte libre,
// ex : « Responsable », « Modérateur ») et des permissions :
//   blacklist → peut blacklister / unblacklister
//   tickets   → peut claim / traiter les tickets du QG
//   staff     → peut gérer l'équipe (ajouter / retirer / permissions)
// Le créateur du bot (OWNER_ID ou propriétaire de l'application) a TOUT.

const PERMS = {
  blacklist: '🚫 Blacklist',
  tickets: '🎫 Tickets du QG',
  staff: '🛡️ Gestion du staff',
};

const getStaffRow = db.prepare('SELECT * FROM bot_staff WHERE user_id = ?');
const listStaffRows = db.prepare('SELECT * FROM bot_staff ORDER BY added_at');
const insertStaff = db.prepare(
  'INSERT INTO bot_staff (user_id, rank, perms, added_by, added_at) VALUES (?, ?, ?, ?, ?) ' +
    'ON CONFLICT(user_id) DO UPDATE SET rank = excluded.rank'
);
const updatePerms = db.prepare('UPDATE bot_staff SET perms = ? WHERE user_id = ?');
const deleteStaff = db.prepare('DELETE FROM bot_staff WHERE user_id = ?');

const getBlacklistRow = db.prepare('SELECT * FROM blacklist WHERE user_id = ?');
const listBlacklistRows = db.prepare('SELECT * FROM blacklist ORDER BY at DESC');
const insertBlacklist = db.prepare(
  'INSERT OR REPLACE INTO blacklist (user_id, reason, by_id, at) VALUES (?, ?, ?, ?)'
);
const deleteBlacklist = db.prepare('DELETE FROM blacklist WHERE user_id = ?');

const getState = db.prepare('SELECT value FROM app_state WHERE key = ?');
const setStateStmt = db.prepare(
  'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
const state = (key) => getState.get(key)?.value || null;
const setState = (key, value) => setStateStmt.run(key, value);

// ----- Créateur du bot -----
async function isCreator(client, userId) {
  if (process.env.OWNER_ID?.trim() === userId) return true;
  try {
    const app = await client.application.fetch();
    if (app.owner) {
      if (app.owner.members) return app.owner.members.has(userId);
      return app.owner.id === userId;
    }
  } catch {}
  return false;
}

// Permissions effectives : créateur → toutes ; staff → celles de sa fiche.
async function hasPerm(client, userId, perm) {
  if (await isCreator(client, userId)) return true;
  const row = getStaffRow.get(userId);
  if (!row) return false;
  try {
    return JSON.parse(row.perms).includes(perm);
  } catch {
    return false;
  }
}

function staffPermsOf(userId) {
  const row = getStaffRow.get(userId);
  if (!row) return null;
  try {
    return { rank: row.rank, perms: JSON.parse(row.perms) };
  } catch {
    return { rank: row.rank, perms: [] };
  }
}

// ----- Blacklist : application et retrait -----
// Blacklister : enregistrement + MP (raison + serveur de déban) + bannissement
// sur tous les serveurs du bot. À l'arrivée sur un serveur, un blacklisté est
// re-banni automatiquement (voir guildMemberAdd) tant qu'il n'est pas retiré.
async function applyBlacklist(client, userId, reason, byId) {
  insertBlacklist.run(userId, reason || null, byId, new Date().toISOString());

  const debanInvite = state('deban_invite');
  const user = await client.users.fetch(userId).catch(() => null);
  let dmOk = false;
  if (user) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🚫 Vous avez été blacklisté')
      .setDescription(
        'Vous avez été **blacklisté** par le staff du bot : vous ne pouvez plus rejoindre ' +
          'les serveurs où le système est actif tant que la blacklist n\'est pas levée.'
      )
      .addFields({ name: '📄 Raison', value: reason || '*Aucune raison précisée*', inline: false })
      .setTimestamp();
    if (debanInvite) {
      embed.addFields({
        name: '🔓 Serveur de déban (contestation)',
        value: debanInvite,
        inline: false,
      });
    }
    dmOk = Boolean(await user.send({ embeds: [embed] }).then(() => true).catch(() => false));
  }

  let banned = 0;
  for (const guild of client.guilds.cache.values()) {
    const ok = await guild.members
      .ban(userId, { reason: `Blacklist du bot : ${reason || 'Aucune raison'}` })
      .then(() => true)
      .catch(() => false);
    if (ok) banned++;
  }
  return { dmOk, banned, tag: user?.tag || userId };
}

async function removeBlacklist(client, userId) {
  deleteBlacklist.run(userId);
  let unbanned = 0;
  for (const guild of client.guilds.cache.values()) {
    const ok = await guild.members
      .unban(userId, 'Retrait de la blacklist du bot')
      .then(() => true)
      .catch(() => false);
    if (ok) unbanned++;
  }
  return { unbanned };
}

module.exports = {
  PERMS,
  isCreator,
  hasPerm,
  staffPermsOf,
  listStaffRows,
  getStaffRow,
  insertStaff,
  updatePerms,
  deleteStaff,
  getBlacklistRow,
  listBlacklistRows,
  applyBlacklist,
  removeBlacklist,
  state,
  setState,
};
