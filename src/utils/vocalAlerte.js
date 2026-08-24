const { EmbedBuilder } = require('discord.js');
const { getGuildConfig } = require('../database');
const { staffRoleIds } = require('./permissions');
const { COLORS } = require('./embeds');
const M = require('./miseEnPage');

// 🎙️ Prévenir le staff quand quelqu'un se connecte en vocal.
//
// À chaque CONNEXION fraîche (pas un simple changement de salon), le bot
// poste dans le salon choisi une carte qui dit qui vient d'arriver et qui se
// trouve dans le vocal — et mentionne les rôles staff dans le CONTENU du
// message : c'est le seul champ dont les mentions sonnent encore, et ici on
// veut justement sonner.

async function signaler(newState) {
  const guild = newState.guild;
  const membre = newState.member;
  const cfg = getGuildConfig(guild.id);
  if (!cfg.vocal_alerte_channel_id || !membre || membre.user.bot) return null;

  const salonAlerte = await guild.channels.fetch(cfg.vocal_alerte_channel_id).catch(() => null);
  if (!salonAlerte?.isTextBased?.()) return null;

  const vocal = newState.channel;
  const presents = [...(vocal?.members?.values?.() || [])].filter((m) => !m.user.bot);

  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🎙️ Connexion vocale')
    .setDescription(M.description([
      `<@${membre.id}> vient de se connecter à <#${newState.channelId}>.`,
      M.bloc('Dans le salon', presents.map((m) => `<@${m.id}>`),
        { prefixe: '👥', compte: presents.length, motCompte: 'membre' }),
    ]));

  const roles = staffRoleIds(cfg).map((id) => `<@&${id}>`).join(' ');
  return salonAlerte.send({ ...(roles ? { content: roles } : {}), embeds: [embed] }).catch(() => null);
}

module.exports = { signaler };
