const { MessageFlags } = require('discord.js');
const { reglages, guildeDe } = require('./styleEmbeds');
const { styliserUn } = require('./identite');
const C = require('./cartes');

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


// ══════════════════════════════════════════════════════════════════
// 🔄 METTRE À JOUR UN MESSAGE DÉJÀ ENVOYÉ EN CARTE
// ══════════════════════════════════════════════════════════════════
//
// Une carte n'a ni `content` ni `embeds` : TOUT son contenu vit dans ses
// composants. D'où deux façons de la casser sans s'en rendre compte :
//
//   update({ components: [] })            → message vide → Discord refuse
//   update({ embeds: [nouvelEmbed] })     → embeds interdits → Discord refuse
//
// Les deux se soldent par « Échec de l'interaction », sans trace côté bot.
// C'est ce qui cassait les boutons « Rendre » des animations : le message
// partait bien en carte, et retirer ses boutons le vidait.
//
// `mettreAJour` traite les deux familles : sur un message classique elle
// appelle update() tel quel, sur une carte elle reconstruit le contenu en
// composants.

const RANGEE = C.T.RANGEE;

function estCarte(message) {
  const f = Number(message?.flags?.bitfield ?? message?.flags ?? 0);
  return Boolean(f & C.DRAPEAU_V2);
}

// Les réglages du serveur, tels que la couche réseau les appliquerait.
function contexteDe(interaction) {
  const guild = interaction.guild || null;
  const r = reglages(guild?.id);
  return {
    r,
    contexte: {
      reglages: r,
      bot: interaction.client?.user?.username || null,
      serveur: guild?.name || null,
      icone: guild?.iconURL?.({ size: 64 }) || null,
    },
  };
}

const enJSON = (x) => (x && typeof x.toJSON === 'function' ? x.toJSON() : x);

// Construit les composants d'une carte à partir d'un payload classique.
function composantsPour(interaction, payload, message) {
  const rangees = (payload.components || []).map(enJSON);
  const embeds = (payload.embeds || []).map(enJSON);

  if (embeds.length) {
    const { r, contexte } = contexteDe(interaction);
    const cartes = [];
    if (String(payload.content || '').trim()) cartes.push({ type: C.T.TEXTE, content: String(payload.content) });
    for (const e of embeds) {
      const habille = r.actif ? styliserUn(JSON.parse(JSON.stringify(e)), contexte) : e;
      const carte = C.enCarte(habille, { bordure: r.bordure, titre: r.titre, serveur: contexte.serveur });
      if (!carte) return null; // non convertible : l'appelant fera autrement
      cartes.push(carte);
    }
    return [...cartes, ...rangees];
  }

  // Pas d'embed fourni : soit on remplace le contenu par un simple texte,
  // soit on ne touche qu'aux rangées de boutons.
  if (Object.prototype.hasOwnProperty.call(payload, 'content')) {
    const t = String(payload.content ?? '').trim();
    return [...(t ? [{ type: C.T.TEXTE, content: t }] : []), ...rangees];
  }

  // ⚠️ On GARDE la carte et on ne remplace que les rangées : c'est le cas du
  // « retirer les boutons », qui vidait le message jusqu'ici.
  const existants = (message?.components || []).map(enJSON).filter((c) => c.type !== RANGEE);
  return [...existants, ...rangees];
}

async function mettreAJour(interaction, payload) {
  const message = interaction.message;
  if (!estCarte(message)) return interaction.update(payload).catch(() => null);

  const composants = composantsPour(interaction, payload, message);
  if (!composants || !composants.length) {
    // Rien de convertible : plutôt que d'envoyer un message vide, on laisse
    // la carte en place et on retire seulement les boutons.
    const restants = (message.components || []).map(enJSON).filter((c) => c.type !== RANGEE);
    if (restants.length) {
      return interaction.update({ components: restants, flags: C.DRAPEAU_V2 }).catch(() => null);
    }
    return interaction.deferUpdate().catch(() => null);
  }

  const ok = await interaction
    .update({ components: composants, flags: C.DRAPEAU_V2 })
    .then(() => true)
    .catch(() => false);
  if (ok) return null;

  // Repli : si la mise à jour est refusée, on accuse au moins réception —
  // sans quoi l'utilisateur verrait « Échec de l'interaction ».
  return interaction.deferUpdate().catch(() => null);
}

module.exports.mettreAJour = mettreAJour;
module.exports.estCarte = estCarte;
