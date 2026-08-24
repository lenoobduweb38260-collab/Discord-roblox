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

    // 🎧 Salons personnels : entrer dans le créateur fabrique son salon,
    // quitter un salon perso vide le fait disparaître.
    try {
      const perso = require('../utils/salonsPerso');
      if (newState.channelId && newState.channelId !== oldState.channelId) {
        await perso.accueillir(newState);
      }
      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        await perso.verifierDepart(oldState);
      }
    } catch (err) {
      console.warn(`⚠️ Salons perso : ${err.message}`);
    }

    // 🎧 La file d'attente vocale — sur TOUS les mouvements : entrer dans
    // le vocal d'attente ouvre un ticket, en sortir le clôt (aidé si la
    // destination est un salon d'assistance, parti sinon).
    try {
      await require('../utils/vocalAlerte').surveiller(oldState, newState);
    } catch (err) {
      console.warn(`⚠️ File d'attente vocale : ${err.message}`);
    }

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
    } else if (oldState.channelId && newState.channelId) {
      // 🎚️ Même salon : c'est un ÉTAT qui a changé — micro, casque, partage
      // d'écran, caméra, sourdine serveur. Le moindre geste laisse sa ligne.
      const etats = [];
      if (Boolean(oldState.serverMute) !== Boolean(newState.serverMute)) {
        etats.push(newState.serverMute ? '🔇 mis en sourdine par le serveur' : '🔊 sourdine serveur levée');
      }
      if (Boolean(oldState.serverDeaf) !== Boolean(newState.serverDeaf)) {
        etats.push(newState.serverDeaf ? '🙉 rendu sourd par le serveur' : '👂 audition serveur rétablie');
      }
      if (Boolean(oldState.selfMute) !== Boolean(newState.selfMute)) {
        etats.push(newState.selfMute ? '🎙️ micro coupé' : '🎙️ micro réactivé');
      }
      if (Boolean(oldState.selfDeaf) !== Boolean(newState.selfDeaf)) {
        etats.push(newState.selfDeaf ? '🎧 casque coupé' : '🎧 casque réactivé');
      }
      if (Boolean(oldState.streaming) !== Boolean(newState.streaming)) {
        etats.push(newState.streaming ? '🖥️ partage d\'écran lancé' : '🖥️ partage d\'écran arrêté');
      }
      if (Boolean(oldState.selfVideo) !== Boolean(newState.selfVideo)) {
        etats.push(newState.selfVideo ? '📷 caméra allumée' : '📷 caméra éteinte');
      }
      if (etats.length) {
        await sendLog(
          guild,
          logEmbed('🎚️ État vocal modifié', `<@${member.id}> dans <#${newState.channelId}> : ${etats.join(' · ')}.`, COLORS.INFO)
        );
      }
    }
  },
};
