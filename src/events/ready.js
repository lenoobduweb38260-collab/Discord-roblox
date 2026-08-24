const { Events, ActivityType } = require('discord.js');
const { getGuildConfig } = require('../database');
const { addXp, announceLevelUp } = require('../utils/levels');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`✅ Connecté en tant que ${client.user.tag}`);
    client.user.setActivity('le serveur RP 🎭', { type: ActivityType.Watching });

    // 🎵 État des briques audio, DÈS le démarrage.
    //
    // Sans encodeur Opus ni bibliothèque de chiffrement, le bot rejoint un
    // salon vocal et reste muet : la connexion est acceptée puis n'aboutit
    // jamais. Cela ressemble à un défaut de permissions, et on cherche des
    // heures du mauvais côté. Autant l'écrire une fois, au démarrage.
    try {
      const manque = require('../utils/musiqueMoteur').briquesManquantes();
      if (manque) {
        console.warn(`⚠️ Musique : ${manque.join(' et ').replace(/\*\*/g, '')} — la connexion vocale n'aboutira pas.`);
      }
    } catch (err) {
      console.warn(`⚠️ Musique : diagnostic audio impossible (${err.message}).`);
    }

    // 📅 Les annonces d'absence expirées s'effacent toutes seules — y
    // compris celles arrivées à échéance pendant que le bot était éteint.
    try {
      require('../utils/absences').demarrer(client);
    } catch (err) {
      console.warn(`⚠️ Balayage des absences non démarré : ${err.message}`);
    }

    // 🎧 Les salons perso vidés pendant que le bot dormait disparaissent.
    try {
      require('../utils/salonsPerso').demarrer(client);
    } catch (err) {
      console.warn(`⚠️ Balayage des salons perso non démarré : ${err.message}`);
    }

    // 🎧 Les attentes vocales laissées ouvertes sont remises en face de la
    // réalité : toujours dans le vocal d'attente → gardées, sinon clôturées.
    try {
      require('../utils/vocalAlerte').demarrer(client);
    } catch (err) {
      console.warn(`⚠️ Balayage des attentes vocales non démarré : ${err.message}`);
    }

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
