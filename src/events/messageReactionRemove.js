const { Events } = require('discord.js');
const { handleReaction } = require('../utils/rolesAuClic');

// 🎭 Retirer sa réaction rend le rôle.
//
// C'est ce que les membres attendent d'un panneau à réactions : la réaction
// affichée sous le message EST l'état du rôle. Une bascule y serait fausse —
// on se retrouverait avec le rôle sans la réaction, ou l'inverse.
module.exports = {
  name: Events.MessageReactionRemove,
  async execute(reaction, user) {
    return handleReaction(reaction, user, false);
  },
};
