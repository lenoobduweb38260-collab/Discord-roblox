const { db, getGuildConfig } = require('../database');
const { COLORS } = require('./embeds');
const { EmbedBuilder } = require('discord.js');

// XP nécessaire pour passer du niveau n au niveau n+1 (courbe type MEE6).
function xpForLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

function totalXpForLevel(level) {
  let total = 0;
  for (let i = 0; i < level; i++) total += xpForLevel(i);
  return total;
}

function levelFromXp(xp) {
  let level = 0;
  let remaining = xp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  return { level, current: remaining, needed: xpForLevel(level) };
}

const upsertStmt = db.prepare(`
  INSERT INTO levels (guild_id, user_id, text_xp, voice_xp, text_level, voice_level)
  VALUES (?, ?, 0, 0, 0, 0)
  ON CONFLICT (guild_id, user_id) DO NOTHING
`);
const getStmt = db.prepare('SELECT * FROM levels WHERE guild_id = ? AND user_id = ?');
const updateTextStmt = db.prepare(
  'UPDATE levels SET text_xp = ?, text_level = ? WHERE guild_id = ? AND user_id = ?'
);
const updateVoiceStmt = db.prepare(
  'UPDATE levels SET voice_xp = ?, voice_level = ? WHERE guild_id = ? AND user_id = ?'
);

// Ajoute de l'XP (type: 'text' | 'voice') et renvoie {leveledUp, newLevel}.
function addXp(guildId, userId, type, amount) {
  upsertStmt.run(guildId, userId);
  const row = getStmt.get(guildId, userId);
  const xpKey = type === 'voice' ? 'voice_xp' : 'text_xp';
  const levelKey = type === 'voice' ? 'voice_level' : 'text_level';
  const newXp = row[xpKey] + amount;
  const { level: newLevel } = levelFromXp(newXp);
  if (type === 'voice') updateVoiceStmt.run(newXp, newLevel, guildId, userId);
  else updateTextStmt.run(newXp, newLevel, guildId, userId);
  return { leveledUp: newLevel > row[levelKey], newLevel };
}

function getLevels(guildId, userId) {
  return getStmt.get(guildId, userId) || {
    guild_id: guildId,
    user_id: userId,
    text_xp: 0,
    voice_xp: 0,
    text_level: 0,
    voice_level: 0,
  };
}

const topTextStmt = db.prepare(
  'SELECT * FROM levels WHERE guild_id = ? ORDER BY text_xp DESC LIMIT ?'
);
const topVoiceStmt = db.prepare(
  'SELECT * FROM levels WHERE guild_id = ? ORDER BY voice_xp DESC LIMIT ?'
);

function getLeaderboard(guildId, type, limit = 10) {
  return type === 'voice' ? topVoiceStmt.all(guildId, limit) : topTextStmt.all(guildId, limit);
}

// Annonce la montée de niveau dans le salon configuré (ou le salon de repli fourni).
async function announceLevelUp(guild, userId, type, newLevel, fallbackChannel = null) {
  try {
    const cfg = getGuildConfig(guild.id);
    let channel = null;
    if (cfg.level_channel_id) {
      channel = await guild.channels.fetch(cfg.level_channel_id).catch(() => null);
    }
    if (!channel) channel = fallbackChannel;
    if (!channel?.isTextBased()) return;
    const label = type === 'voice' ? 'vocal 🎙️' : 'écrit ✍️';
    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setDescription(`🎉 <@${userId}> passe au **niveau ${newLevel}** en ${label} !`);
    await channel.send({ embeds: [embed] });
  } catch {
    // l'annonce ne doit jamais faire planter le flux d'XP
  }
}

module.exports = { xpForLevel, totalXpForLevel, levelFromXp, addXp, getLevels, getLeaderboard, announceLevelUp };
