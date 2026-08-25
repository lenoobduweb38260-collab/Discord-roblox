const { EmbedBuilder } = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../database');
const { COLORS } = require('./embeds');

// ⏰ Le rappel de bump — pour ne plus jamais rater la fenêtre de DISBOARD.
//
// DISBOARD n'autorise un `/bump` que toutes les deux heures. Le bot surveille
// donc ses réponses : à chaque bump RÉUSSI, il note l'heure et arme un rappel.
// Deux heures plus tard, une carte part dans le salon configuré — avec le
// rôle choisi mentionné dans le message même, donc il sonne.
//
// Tout survit à un redémarrage : l'heure du dernier bump vit en base, et le
// démarrage réarme chaque rappel — un rappel arrivé à échéance pendant que le
// bot dormait part immédiatement. Un seul rappel par bump : l'heure est
// effacée dès que le rappel est parti.

const DISBOARD_ID = '302050872383242240';
const DELAI_BUMP = 2 * 60 * 60 * 1000; // la fenêtre de DISBOARD

const minuteries = new Map(); // guildId -> timeout du rappel

// Un bump réussi se reconnaît à la réponse de DISBOARD : le pouce levé, et
// « Bump effectué / done / erfolgreich… » selon la langue du serveur.
function estBumpReussi(message) {
  if (String(message.author?.id) !== DISBOARD_ID) return false;
  const textes = (message.embeds || [])
    .map((e) => String((e.data ?? e).description || ''))
    .join('\n');
  return /bump (effectué|effectue|done|erfolgreich|fatto|hecho|feito|klaar)/i.test(textes)
    || textes.includes(':thumbsup:') || textes.includes('👍');
}

// Chaque message passe par ici (avant l'écarte-bots : DISBOARD EST un bot).
async function surveiller(message) {
  const guild = message.guild;
  if (!guild) return false;
  const cfg = getGuildConfig(guild.id);
  if (!cfg.bump_channel_id) return false;
  if (!estBumpReussi(message)) return false;
  setGuildConfig(guild.id, 'bump_dernier', Date.now());
  programmer(message.client, guild.id, DELAI_BUMP);
  return true;
}

function programmer(client, guildId, dansMs) {
  clearTimeout(minuteries.get(guildId));
  const t = setTimeout(() => {
    rappeler(client, guildId).catch((err) => console.warn(`⚠️ Rappel de bump : ${err.message}`));
  }, Math.max(0, dansMs));
  minuteries.set(guildId, t);
}

// Le rappel lui-même. L'heure du dernier bump est effacée AVANT l'envoi :
// un seul rappel par bump, redémarrages compris.
async function rappeler(client, guildId) {
  minuteries.delete(guildId);
  const cfg = getGuildConfig(guildId);
  if (!cfg.bump_channel_id) return null;
  const salon = await client.channels.fetch(cfg.bump_channel_id).catch(() => null);
  if (!salon?.isTextBased?.()) return null;
  setGuildConfig(guildId, 'bump_dernier', null);
  const carte = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle('⏰ C\'est l\'heure du bump !')
    .setDescription('Les deux heures de DISBOARD sont passées : le serveur peut de nouveau être mis en avant.\n➜ Tapez `/bump` pour le faire remonter.');
  const ping = cfg.bump_role_id ? `<@&${cfg.bump_role_id}>` : '';
  return salon.send({ ...(ping ? { content: ping } : {}), embeds: [carte] }).catch(() => null);
}

// Au démarrage : chaque bump noté réarme son rappel — échéance passée = tout
// de suite, sinon le temps qu'il reste.
function demarrer(client) {
  let armes = 0;
  for (const guild of client.guilds.cache.values()) {
    const cfg = getGuildConfig(guild.id);
    if (!cfg.bump_channel_id || !cfg.bump_dernier) continue;
    programmer(client, guild.id, Number(cfg.bump_dernier) + DELAI_BUMP - Date.now());
    armes += 1;
  }
  return armes;
}

module.exports = {
  surveiller, rappeler, programmer, demarrer, estBumpReussi,
  DISBOARD_ID, DELAI_BUMP, minuteries,
};
