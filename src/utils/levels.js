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
  INSERT INTO levels (guild_id, user_id, text_xp, voice_xp, text_level, voice_level, xp, level)
  VALUES (?, ?, 0, 0, 0, 0, 0, 0)
  ON CONFLICT (guild_id, user_id) DO NOTHING
`);
const getStmt = db.prepare('SELECT * FROM levels WHERE guild_id = ? AND user_id = ?');
// 📊 Un seul compteur : l'XP écrite et l'XP vocale alimentent le même niveau.
// Les colonnes text_xp / voice_xp restent tenues à jour, mais uniquement pour
// dire d'où vient l'XP — elles ne donnent plus de niveau séparé.
const updateTextStmt = db.prepare(
  'UPDATE levels SET text_xp = ?, xp = ?, level = ? WHERE guild_id = ? AND user_id = ?'
);
const updateVoiceStmt = db.prepare(
  'UPDATE levels SET voice_xp = ?, xp = ?, level = ? WHERE guild_id = ? AND user_id = ?'
);

// Système de niveaux activé sur ce serveur ? (NULL = oui, comportement
// historique ; désactivable par serveur via /config → 📈 XP & niveaux.)
function levelsEnabled(guildId) {
  return getGuildConfig(guildId).levels_enabled !== 0;
}

// Ajoute de l'XP au compteur UNIQUE du membre.
// `source` ('text' | 'voice') ne sert plus qu'à deux choses : tenir le détail
// de provenance, et choisir le mot employé dans l'annonce de passage de niveau.
// Ne fait RIEN si le système de niveaux est désactivé sur le serveur.
function addXp(guildId, userId, source, amount) {
  if (!levelsEnabled(guildId)) return { leveledUp: false, newLevel: 0 };
  upsertStmt.run(guildId, userId);
  const row = getStmt.get(guildId, userId);
  const totalAvant = row.xp || 0;
  const totalApres = totalAvant + amount;
  const { level: newLevel } = levelFromXp(totalApres);
  const { level: ancienNiveau } = levelFromXp(totalAvant);
  if (source === 'voice') updateVoiceStmt.run((row.voice_xp || 0) + amount, totalApres, newLevel, guildId, userId);
  else updateTextStmt.run((row.text_xp || 0) + amount, totalApres, newLevel, guildId, userId);
  return { leveledUp: newLevel > ancienNiveau, newLevel };
}

function getLevels(guildId, userId) {
  return getStmt.get(guildId, userId) || {
    guild_id: guildId,
    user_id: userId,
    text_xp: 0,
    voice_xp: 0,
    text_level: 0,
    voice_level: 0,
    xp: 0,
    level: 0,
  };
}

const topStmt = db.prepare('SELECT * FROM levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ?');

// Classement unique : plus de distinction écrit / vocal.
function getLeaderboard(guildId, limit = 10) {
  return topStmt.all(guildId, limit);
}

// Annonce la montée de niveau UNIQUEMENT dans le salon configuré (/config →
// Salons → 📈). Sans salon configuré, aucune annonce n'est envoyée — les
// montées de niveau ne s'affichent plus dans n'importe quel salon.
// (Le paramètre fallbackChannel est conservé pour compatibilité mais ignoré.)
async function announceLevelUp(guild, userId, source, newLevel, fallbackChannel = null) {
  try {
    const cfg = getGuildConfig(guild.id);
    if (!cfg.level_channel_id) return;
    const channel = await guild.channels.fetch(cfg.level_channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    // Un seul niveau : la provenance n'est plus qu'une indication.
    const origine = source === 'voice' ? 'en vocal 🎙️' : 'en écrivant ✍️';
    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setDescription(`🎉 <@${userId}> passe au **niveau ${newLevel}** ! *(${origine})*`);
    await channel.send({ embeds: [embed] });
  } catch {
    // l'annonce ne doit jamais faire planter le flux d'XP
  }
}

module.exports = { xpForLevel, totalXpForLevel, levelFromXp, addXp, getLevels, getLeaderboard, announceLevelUp, levelsEnabled };
