const { Events } = require('discord.js');
const { getGuildConfig } = require('../database');
const { addXp, announceLevelUp } = require('../utils/levels');
const { scanMessage } = require('../utils/scamImages');

// Anti-spam XP : un gain par utilisateur et par période de cooldown.
const cooldowns = new Map();

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.inGuild()) return;

    // ⏰ Le rappel de bump écoute DISBOARD — qui EST un bot : sa réponse doit
    // passer AVANT l'écarte-bots, sans quoi aucun bump ne serait jamais vu.
    if (message.author.bot) {
      try {
        await require('../utils/bumpReminder').surveiller(message);
      } catch (err) {
        console.warn(`⚠️ Rappel de bump : ${err.message}`);
      }
      return;
    }

    // Anti-scam : vérifie les images jointes contre les échantillons enregistrés.
    if (message.attachments.size) {
      const handled = await scanMessage(message).catch((err) => {
        console.error('Erreur scan anti-scam :', err);
        return false;
      });
      if (handled) return; // message supprimé + auteur banni : pas d'XP
    }

    const cfg = getGuildConfig(message.guild.id);

    // Anti-spam + filtre de contenu malveillant (si activé sur ce serveur).
    if (cfg.antispam_enabled) {
      const handled = await require('../utils/messageGuard')
        .guard(message, cfg)
        .catch((err) => {
          console.error('Erreur messageGuard :', err);
          return false;
        });
      if (handled) return;
    }

    // Réponse IA supervisée : sur mention du bot, il propose une réponse au
    // créateur en MP (ne bloque pas l'XP ; inactif sans AI_API_KEY).
    if (process.env.AI_API_KEY && message.mentions.has(message.client.user) && !message.mentions.everyone) {
      require('../utils/aiResponder').onMention(message).catch(() => null);
    }

    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const last = cooldowns.get(key) || 0;
    if (now - last < cfg.xp_cooldown * 1000) return;
    cooldowns.set(key, now);

    const { leveledUp, newLevel } = addXp(message.guild.id, message.author.id, 'text', cfg.xp_text);
    if (leveledUp) {
      await announceLevelUp(message.guild, message.author.id, 'text', newLevel, message.channel);
    }
  },
};
