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
  // 🏅 Les récompenses d'abord, et SANS condition de salon : un serveur qui
  // n'annonce pas les montées de niveau doit quand même donner ses rôles.
  const { donnes } = await appliquerRecompenses(guild, userId, newLevel);
  try {
    const cfg = getGuildConfig(guild.id);
    if (!cfg.level_channel_id) return;
    const channel = await guild.channels.fetch(cfg.level_channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    // Un seul niveau : la provenance n'est plus qu'une indication.
    const origine = source === 'voice' ? 'en vocal 🎙️' : 'en écrivant ✍️';
    const lignes = [`🎉 <@${userId}> passe au **niveau ${newLevel}** ! *(${origine})*`];
    // On ne cite que ce qui vient d'être débloqué : rappeler les paliers
    // précédents à chaque niveau noierait la nouvelle.
    const neufs = donnes.filter((d) => d.level === newLevel);
    if (neufs.length) lignes.push(`🏅 Récompense débloquée : ${neufs.map((d) => `**${d.role.name}**`).join(', ')}`);
    const embed = new EmbedBuilder().setColor(COLORS.SUCCESS).setDescription(lignes.join('\n'));
    await channel.send({ embeds: [embed] });
  } catch {
    // l'annonce ne doit jamais faire planter le flux d'XP
  }
}

// ══════════════════════════════════════════════════════════════════
// 🏅 RÉCOMPENSES DE NIVEAU
// ══════════════════════════════════════════════════════════════════
//
// Un rôle donné en atteignant un palier. **Aucune par défaut** : un serveur
// qui n'en configure pas n'en reçoit aucune, et le bot ne distribue donc rien
// de lui-même.
//
// Deux points qui ne vont pas de soi :
//
//  • On donne TOUS les paliers atteints, pas seulement celui qu'on vient de
//    passer. Sinon un membre absent pendant que le staff configure les
//    récompenses, ou qui prend trois niveaux d'un coup, resterait sans rien —
//    et personne ne comprendrait pourquoi.
//  • Par défaut les rôles s'ajoutent les uns aux autres. Le serveur peut
//    préférer qu'un palier REMPLACE le précédent (une seule couleur à la
//    fois) : c'est `level_rewards_stack = 0`.

const listerRecompenses = db.prepare(
  'SELECT level, role_id FROM level_rewards WHERE guild_id = ? ORDER BY level'
);
const poserRecompense = db.prepare(
  `INSERT INTO level_rewards (guild_id, level, role_id, created_at) VALUES (?, ?, ?, ?)
   ON CONFLICT (guild_id, level) DO UPDATE SET role_id = excluded.role_id, created_at = excluded.created_at`
);
const retirerRecompense = db.prepare('DELETE FROM level_rewards WHERE guild_id = ? AND level = ?');

const recompensesDe = (guildId) => listerRecompenses.all(String(guildId));

function definirRecompense(guildId, level, roleId) {
  poserRecompense.run(String(guildId), Number(level), String(roleId), new Date().toISOString());
}
function effacerRecompense(guildId, level) {
  return retirerRecompense.run(String(guildId), Number(level)).changes > 0;
}

// Applique les récompenses au membre. Renvoie ce qui a bougé, pour l'annonce.
// Ne lève jamais : une récompense ratée ne doit pas emporter le gain d'XP.
async function appliquerRecompenses(guild, userId, niveau) {
  try {
    const paliers = recompensesDe(guild.id);
    if (!paliers.length) return { donnes: [], retires: [] };

    const membre = await guild.members.fetch(userId).catch(() => null);
    if (!membre) return { donnes: [], retires: [] };

    const moi = guild.members.me;
    const cumul = Number(getGuildConfig(guild.id).level_rewards_stack ?? 1) !== 0;

    const atteints = paliers.filter((p) => niveau >= p.level);
    const aDonner = cumul ? atteints : atteints.slice(-1);
    const aRetirer = cumul ? [] : atteints.slice(0, -1);

    const donnes = [];
    const retires = [];
    for (const p of aDonner) {
      const role = guild.roles.cache.get(p.role_id) || (await guild.roles.fetch(p.role_id).catch(() => null));
      // Un rôle disparu, ou plus haut que le mien, ne s'attribue pas. On
      // passe au suivant sans bruit : le journal du serveur le dira si le
      // staff s'en étonne.
      if (!role || role.managed || !moi || role.position >= moi.roles.highest.position) continue;
      if (membre.roles.cache.has(role.id)) continue;
      if (await membre.roles.add(role, `Récompense du niveau ${p.level}`).then(() => true).catch(() => false)) {
        donnes.push({ level: p.level, role });
      }
    }
    for (const p of aRetirer) {
      const role = guild.roles.cache.get(p.role_id);
      if (!role || !membre.roles.cache.has(role.id)) continue;
      if (await membre.roles.remove(role, 'Palier de niveau dépassé').then(() => true).catch(() => false)) {
        retires.push({ level: p.level, role });
      }
    }
    return { donnes, retires };
  } catch {
    return { donnes: [], retires: [] };
  }
}

// 🩺 Pourquoi une récompense n'a pas été donnée. Le staff configure un rôle,
// rien n'arrive, et rien n'explique pourquoi : ce diagnostic est le seul
// endroit d'où la cause se voit.
function diagnostiquerRecompenses(guild) {
  const moi = guild.members.me;
  return recompensesDe(guild.id).map((p) => {
    const role = guild.roles.cache.get(p.role_id);
    let souci = null;
    if (!role) souci = 'ce rôle n\'existe plus';
    else if (role.managed) souci = 'rôle géré par une intégration — inattribuable';
    else if (!moi) souci = 'je ne me vois pas sur ce serveur';
    else if (role.position >= moi.roles.highest.position) souci = 'ce rôle est au-dessus du mien';
    return { level: p.level, roleId: p.role_id, nom: role?.name || null, souci };
  });
}

module.exports = {
  xpForLevel, totalXpForLevel, levelFromXp, addXp, getLevels, getLeaderboard,
  announceLevelUp, levelsEnabled,
  recompensesDe, definirRecompense, effacerRecompense, appliquerRecompenses, diagnostiquerRecompenses,
};
