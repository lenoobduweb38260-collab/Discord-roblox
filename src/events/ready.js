const { Events, ActivityType } = require('discord.js');
const { getGuildConfig } = require('../database');
const { addXp, announceLevelUp } = require('../utils/levels');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`✅ Connecté en tant que ${client.user.tag}`);
    client.user.setActivity('le serveur RP 🎭', { type: ActivityType.Watching });

    // XP vocal : chaque minute, chaque membre connecté en vocal (non muet
    // serveur, hors salon AFK, hors bots) gagne l'XP vocal configuré.
    setInterval(() => {
      for (const guild of client.guilds.cache.values()) {
        const cfg = getGuildConfig(guild.id);
        for (const vs of guild.voiceStates.cache.values()) {
          if (!vs.channelId || vs.channelId === guild.afkChannelId) continue;
          if (!vs.member || vs.member.user.bot || vs.deaf) continue;
          const { leveledUp, newLevel } = addXp(guild.id, vs.member.id, 'voice', cfg.xp_voice);
          if (leveledUp) announceLevelUp(guild, vs.member.id, 'voice', newLevel);
        }
      }
    }, 60_000);
  },
};
