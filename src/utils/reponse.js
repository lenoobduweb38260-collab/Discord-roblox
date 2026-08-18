const { MessageFlags } = require('discord.js');
const { reglages, guildeDe } = require('./styleEmbeds');
const { styliserUn } = require('./identite');
const C = require('./cartes');

// 📮 Répondre à une interaction sans laisser de trace parasite.
//
// Le point de départ, invisible tant qu'on ne regarde pas la couche réseau :
//
//   interaction.reply()      → POST   /interactions/…/callback       ✅ carte
//   interaction.followUp()   → POST   /webhooks/…                    ✅ carte
//   interaction.editReply()  → PATCH  /webhooks/…/messages/@original ❌ jamais
//
// Discord fige la famille de composants d'un message à sa CRÉATION. Or
// `deferReply` crée déjà le message — celui qui affiche « réfléchit… ». Tout
// ce qui arrive ensuite par `editReply` ne peut donc être qu'un embed
// classique, barre colorée comprise.
//
// ⚠️ Deux parades ont été essayées, et TOUTES DEUX étaient pires que le mal :
//
//   1. Refermer le message d'attente par une ligne de texte, puis envoyer le
//      contenu en `followUp`. On lisait « ✅ Terminé. » avant même de voir le
//      résultat — et quand le `followUp` échouait, il ne restait QUE cette
//      ligne, sans rien pour la justifier.
//   2. Envoyer le contenu, puis EFFACER le message d'attente. Le client
//      Discord rattache un `followUp` à la réponse d'origine : effacer
//      celle-ci fait disparaître les deux à l'écran. Le message s'affichait,
//      puis s'effaçait sous les yeux.
//
// La leçon des deux : **une interaction, un seul message**. Un second message
// est un second point de rupture, et il n'y a rien à nettoyer quand on n'a
// rien laissé traîner.
//
// D'où la règle d'aujourd'hui :
//
//   • pas encore répondu → `reply()`, qui est un envoi : c'est une carte ;
//   • déjà différé       → `editReply()`, embed classique, un seul message.
//
// Une commande qui veut sa carte ne doit donc PAS différer sa réponse. C'est
// à sa portée : `repondreVite` ci-dessous ne diffère qu'à la dernière seconde,
// et seulement si le travail dépasse le délai que Discord accorde.

// Conservé pour les cas où la suppression de l'attente est refusée : mieux
// vaut une ligne discrète qu'un « réfléchit… » figé pour toujours.
const CLOTURE = '-# ✅ Terminé.';

// Cette réponse pourrait-elle devenir une carte ?
function cartesActives(interaction) {
  try {
    const guild = interaction.guild || guildeDe(interaction.client, `/channels/${interaction.channelId}`);
    const r = reglages(guild?.id);
    return r.actif && r.cartes;
  } catch {
    return false;
  }
}

// 🎴 Répond, en une seule fois.
//
// Renvoie le message envoyé, ou null si même le repli a échoué. Ne lève
// jamais : une réponse dans l'ancien style vaut infiniment mieux qu'aucune
// réponse — c'est la règle du projet, ici comme sur la couche réseau.
async function repondre(interaction, payload) {
  // Pas encore répondu : `reply` est un envoi, donc déjà converti en carte.
  if (!interaction.deferred && !interaction.replied) {
    return interaction.reply(payload).catch(() => null);
  }
  // Déjà différé : le message existe, il ne changera plus de famille. On le
  // remplit, et c'est tout — un second message ferait plus de mal que la
  // barre colorée qu'il éviterait.
  return interaction.editReply(payload).catch(() => null);
}

// ⏱️ Répondre vite quand on peut, différer quand il le faut.
//
// Discord laisse 3 secondes pour accuser réception d'une commande. Différer
// systématiquement « au cas où » coûte la carte à TOUTES les réponses ; ne
// jamais différer casse la commande dès que le réseau traîne.
//
// On lance donc le travail, et on ne diffère qu'au dernier moment — si le
// travail n'a pas fini à temps. Dans le cas courant (quelques centaines de
// millisecondes) la réponse part en carte, en un seul message.
//
// `travail` est une promesse ou une fonction qui en renvoie une, et qui donne
// le payload à afficher. Elle n'est appelée qu'UNE fois : ses effets de bord
// (compteurs, badges) ne sont donc jamais joués deux fois.
const MARGE = 2200;

async function repondreVite(interaction, travail, { marge = MARGE } = {}) {
  let differe = null;
  const minuteur = setTimeout(() => {
    differe = interaction.deferReply().catch(() => null);
  }, marge);

  let payload = null;
  try {
    payload = await (typeof travail === 'function' ? travail() : travail);
  } finally {
    clearTimeout(minuteur);
  }
  if (differe) await differe;
  return repondre(interaction, payload);
}

module.exports = { repondre, repondreVite, cartesActives, CLOTURE, MARGE };


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
  return contexteDeGuilde(interaction.guild || null, interaction.client);
}

function contexteDeGuilde(guild, client) {
  const r = reglages(guild?.id);
  return {
    r,
    contexte: {
      reglages: r,
      bot: client?.user?.username || null,
      serveur: guild?.name || null,
      icone: guild?.iconURL?.({ size: 64 }) || null,
    },
  };
}

// 🃏 Traduit un payload classique { content, embeds, components } en
// composants de carte. Renvoie null si le contenu ne tient pas dans une carte.
//
// Utile hors interaction : un panneau se met à jour tout seul après un ajout
// ou un retrait, sans que personne n'ait cliqué. `message.edit({ embeds })`
// sur une carte est refusé par Discord — et l'échec est muet, donc le panneau
// cessait simplement de se mettre à jour.
function enComposants(guild, client, payload) {
  const { r, contexte } = contexteDeGuilde(guild, client);
  const rangees = (payload.components || []).map(enJSON);
  const cartes = [];
  if (String(payload.content || '').trim()) cartes.push({ type: C.T.TEXTE, content: String(payload.content) });
  for (const e of (payload.embeds || []).map(enJSON)) {
    const habille = r.actif ? styliserUn(JSON.parse(JSON.stringify(e)), contexte) : e;
    const carte = C.enCarte(habille, { bordure: r.bordure, titre: r.titre, serveur: contexte.serveur });
    if (!carte) return null;
    cartes.push(carte);
  }
  // Les rangées vont DANS la carte, comme à l'envoi : sans cela un panneau
  // reconstruit aurait ses boutons détachés alors que le même panneau, publié,
  // les a collés. La même carte n'aurait pas la même tête selon son âge.
  const derniere = cartes[cartes.length - 1];
  if (derniere?.type === C.T.CONTENEUR && rangees.length
      && derniere.components.length + rangees.length <= C.MAX_DANS_CONTENEUR) {
    derniere.components.push(...rangees);
    return cartes;
  }
  return [...cartes, ...rangees];
}

const enJSON = (x) => (x && typeof x.toJSON === 'function' ? x.toJSON() : x);

// Construit les composants d'une carte à partir d'un payload classique.
function composantsPour(interaction, payload, message) {
  const rangees = (payload.components || []).map(enJSON);
  const embeds = (payload.embeds || []).map(enJSON);

  if (embeds.length) {
    // Même rendu que hors interaction : deux implémentations finiraient par
    // diverger, et un panneau n'aurait pas la même tête selon qu'on ait
    // cliqué ou non.
    return enComposants(interaction.guild || null, interaction.client, payload);
  }

  // Pas d'embed fourni : soit on remplace le contenu par un simple texte,
  // soit on ne touche qu'aux rangées de boutons.
  if (Object.prototype.hasOwnProperty.call(payload, 'content')) {
    const t = String(payload.content ?? '').trim();
    return [...(t ? [{ type: C.T.TEXTE, content: t }] : []), ...rangees];
  }

  // ⚠️ On GARDE la carte et on ne remplace que les rangées : c'est le cas du
  // « retirer les boutons », qui vidait le message jusqu'ici.
  //
  // Les rangées vivent DANS le conteneur — c'est ce qui les colle à la carte
  // au lieu de les laisser flotter dessous. Il faut donc les retirer de
  // l'intérieur, pas seulement du premier niveau : filtrer uniquement le
  // premier niveau laissait les anciens boutons en place et ajoutait les
  // nouveaux à côté, donc en double.
  const existants = (message?.components || []).map(enJSON).filter((c) => c.type !== RANGEE);
  const conteneur = existants.find((c) => c.type === C.T.CONTENEUR);
  if (conteneur) {
    conteneur.components = (conteneur.components || []).filter((c) => c.type !== RANGEE);
    if (rangees.length && conteneur.components.length + rangees.length <= C.MAX_DANS_CONTENEUR) {
      conteneur.components.push(...rangees);
      return existants;
    }
  }
  return [...existants, ...rangees];
}

// 🔁 Réaffiche un message SANS rien y changer.
//
// C'est le seul moyen de remettre une liste déroulante à zéro : Discord garde
// l'option cochée, et recliquer la MÊME entrée ne déclenche alors plus rien.
// Renvoyer les composants tels quels suffit à la décocher.
//
// ⚠️ Ne PAS passer par mettreAJour avec `components: message.components` : sur
// une carte, le conteneur serait pris pour une rangée à ajouter — et la carte
// s'afficherait deux fois.
async function reafficher(interaction) {
  const message = interaction.message;
  if (!message) return null;
  const composants = (message.components || []).map(enJSON);
  const corps = estCarte(message)
    ? { components: composants, flags: C.DRAPEAU_V2 }
    : { components: composants };
  return interaction.update(corps).catch(() => interaction.deferUpdate().catch(() => null));
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
module.exports.enComposants = enComposants;
module.exports.reafficher = reafficher;
