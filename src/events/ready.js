const { Events } = require('discord.js');
const { distribuerXpVocale } = require('../utils/levels');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`✅ Connecté en tant que ${client.user.tag}`);
    // Statut du bot : celui configuré par le créateur, sinon celui par défaut.
    require('../utils/presence').appliquer(client);

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

    // ⏰ Les rappels de bump se réarment — un rappel échu pendant le sommeil
    // du bot part immédiatement.
    try {
      require('../utils/bumpReminder').demarrer(client);
    } catch (err) {
      console.warn(`⚠️ Rappels de bump non réarmés : ${err.message}`);
    }

    // 🎙️ XP vocale : chaque minute, chaque membre en vocal gagne l'XP
    // vocale du serveur — hors salon AFK et bots, et (sauf réglage contraire)
    // ni muet ni sourd, ni seul humain dans son salon. Le détail vit dans
    // levels.distribuerXpVocale.
    setInterval(() => {
      for (const guild of client.guilds.cache.values()) {
        distribuerXpVocale(guild).catch((err) => console.warn(`⚠️ XP vocale (${guild.id}) : ${err.message}`));
      }
    }, 60_000);
  },
};
