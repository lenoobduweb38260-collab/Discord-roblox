const { MessageFlags } = require('discord.js');
const { reglages, guildeDe } = require('./styleEmbeds');

// 📮 Répondre à une interaction SANS retomber sur l'ancien style d'embed.
//
// Le problème, invisible tant qu'on ne regarde pas la couche réseau :
//
//   interaction.reply()      → POST   /interactions/…/callback     ✅ converti
//   interaction.followUp()   → POST   /webhooks/…                  ✅ converti
//   interaction.editReply()  → PATCH  /webhooks/…/messages/@original ❌ jamais
//
// Discord fige la famille de composants d'un message à sa CRÉATION. Or
// `deferReply` crée déjà le message — celui qui affiche « réfléchit… ». Tout
// ce qui arrive ensuite par `editReply` ne peut donc être qu'un embed
// classique, barre colorée comprise.
//
// Résultat : chaque commande qui diffère sa réponse — c'est-à-dire toutes
// celles qui travaillent plus de trois secondes — rendait un embed à
// l'ancienne, alors même que le reste du bot envoyait des cartes.
//
// La parade est simple : refermer le message d'attente avec une ligne de
// texte, et envoyer le vrai contenu en `followUp`, qui est un envoi et donc
// converti.

// Le message d'attente doit être refermé : laissé tel quel, il resterait
// affiché « réfléchit… » à côté de la réponse.
const CLOTURE = '-# ✅ Terminé.';

// Cette réponse peut-elle devenir une carte ?
function cartesActives(interaction) {
  try {
    const guild = interaction.guild || guildeDe(interaction.client, `/channels/${interaction.channelId}`);
    const r = reglages(guild?.id);
    return r.actif && r.cartes;
  } catch {
    return false;
  }
}

// 🎴 Répond en garantissant le style du jour.
//
// Renvoie le message envoyé, ou null si même le repli a échoué. Ne lève
// jamais : une réponse dans l'ancien style vaut infiniment mieux qu'aucune
// réponse — c'est la règle du projet, ici comme sur la couche réseau.
async function repondre(interaction, payload) {
  const aDesEmbeds = Array.isArray(payload?.embeds) && payload.embeds.length > 0;

  // Pas encore répondu : `reply` est un envoi, donc déjà converti.
  if (!interaction.deferred && !interaction.replied) {
    return interaction.reply(payload).catch(() => null);
  }

  // Rien à convertir, ou conversion inutile : la modification suffit.
  if (!aDesEmbeds || !cartesActives(interaction)) {
    return interaction.editReply(payload).catch(() => null);
  }

  // ⚠️ On referme d'abord le message d'attente, SANS embed : sinon il
  // afficherait la version ancienne à côté de la carte.
  const cloture = typeof payload.content === 'string' && payload.content.trim()
    ? payload.content
    : CLOTURE;
  await interaction.editReply({ content: cloture, embeds: [], components: [] }).catch(() => null);

  // Puis le vrai contenu, en envoi — donc en carte.
  const suite = { ...payload };
  delete suite.content; // déjà affiché par la clôture, inutile de le répéter
  if (interaction.ephemeral) suite.flags = (suite.flags || 0) | MessageFlags.Ephemeral;

  const envoye = await interaction.followUp(suite).catch(() => null);
  if (envoye) return envoye;

  // Repli : le followUp a échoué (jeton expiré, droits…). On remet tout dans
  // la réponse, à l'ancienne. Moins beau, mais l'utilisateur voit son
  // résultat.
  return interaction.editReply(payload).catch(() => null);
}

module.exports = { repondre, cartesActives, CLOTURE };
