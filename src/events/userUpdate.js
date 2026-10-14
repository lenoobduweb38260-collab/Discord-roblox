const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { etiquetteMembre } = require('../utils/journal');

// Pseudo global, nom d'utilisateur, avatar : l'événement est GLOBAL, on le
// journalise dans chaque serveur commun où le membre est en cache.
module.exports = {
  name: Events.UserUpdate,
  async execute(oldUser, newUser) {
    if (newUser.bot) return;
    const changes = [];
    if (oldUser.username !== newUser.username) changes.push(`➜ Nom d'utilisateur : **${oldUser.username}** → **${newUser.username}**`);
    if ((oldUser.globalName ?? null) !== (newUser.globalName ?? null)) {
      const mot = (n) => (n ? `**${n}**` : '*(aucun)*');
      changes.push(`➜ Pseudo global : ${mot(oldUser.globalName)} → ${mot(newUser.globalName)}`);
    }
    if ((oldUser.avatar ?? null) !== (newUser.avatar ?? null)) changes.push('➜ Avatar modifié');
    if (!changes.length) return;
    for (const guild of newUser.client.guilds.cache.values()) {
      if (!guild.members.cache.has(newUser.id)) continue;
      await sendLog(
        guild,
        logEmbed('👤 Profil modifié', `${etiquetteMembre(newUser)} a changé de profil :\n${changes.join('\n')}`, COLORS.INFO)
      );
    }
  },
};
