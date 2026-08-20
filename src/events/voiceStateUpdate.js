const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

// Logs des connexions vocales : arrivée, départ et changement de salon.
module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    const member = newState.member || oldState.member;
    const guild = newState.guild;

    // 🎵 Le bot ne joue pas pour les murs.
    //
    // On regarde AVANT d'écarter les bots : c'est justement le départ du
    // dernier humain qui doit être vu. Compter les humains plutôt que les
    // membres, sinon le bot se compterait lui-même et resterait pour
    // l'éternité dans un salon vide.
    try {
      const musique = require('../utils/music');
      const file = musique.fileDe(guild.id);
      if (file) {
        for (const salonId of new Set([oldState.channelId, newState.channelId].filter(Boolean))) {
          if (salonId !== file.salonVocalId) continue;
          const salon = guild.channels.cache.get(salonId);
          const humains = salon?.members?.filter((m) => !m.user.bot).size ?? 1;
          musique.verifierSolitude(guild.id, humains);
        }
      }
    } catch (err) {
      console.warn(`⚠️ Surveillance du vocal (musique) : ${err.message}`);
    }

    if (!member || member.user.bot) return;

    if (!oldState.channelId && newState.channelId) {
      await sendLog(
        guild,
        logEmbed('🎙️ Connexion vocale', `<@${member.id}> a rejoint <#${newState.channelId}>.`, COLORS.SUCCESS)
      );
    } else if (oldState.channelId && !newState.channelId) {
      await sendLog(
        guild,
        logEmbed('🎙️ Déconnexion vocale', `<@${member.id}> a quitté <#${oldState.channelId}>.`, COLORS.WARNING)
      );
    } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      await sendLog(
        guild,
        logEmbed(
          '🎙️ Changement de salon vocal',
          `<@${member.id}> est passé de <#${oldState.channelId}> à <#${newState.channelId}>.`,
          COLORS.INFO
        )
      );
    }
  },
};
