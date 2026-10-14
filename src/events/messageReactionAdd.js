const { Events } = require('discord.js');
const { handleReaction } = require('../utils/rolesAuClic');

// 🎭 Réagir à un panneau donne le rôle correspondant.
//
// L'événement arrive souvent PARTIEL : Discord n'envoie que les identifiants
// quand le message n'est pas en cache — c'est le cas de tout panneau publié
// avant le dernier redémarrage, donc de presque tous. `handleReaction`
// complète la réaction avant de décider.
module.exports = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    return handleReaction(reaction, user, true);
  },
};
