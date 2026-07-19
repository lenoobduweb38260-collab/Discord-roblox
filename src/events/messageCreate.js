const { Events } = require('discord.js');
const { getGuildConfig } = require('../database');
const { addXp, announceLevelUp } = require('../utils/levels');

// Anti-spam XP : un gain par utilisateur et par période de cooldown.
const cooldowns = new Map();

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.inGuild() || message.author.bot) return;

    const cfg = getGuildConfig(message.guild.id);
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
