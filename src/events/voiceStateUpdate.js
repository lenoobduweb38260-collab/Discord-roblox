const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

// Logs des connexions vocales : arrivée, départ et changement de salon.
module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;
    const guild = newState.guild;

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
