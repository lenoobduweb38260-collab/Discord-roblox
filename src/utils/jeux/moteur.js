// 🎲 Le moteur des mini-jeux : lancer, aiguiller les clics, expirer.
//
// Chaque jeu est un objet (MORPION, QUIZ…) qui sait se lancer, s'afficher,
// réagir à un clic et conclure une partie expirée. Ici vit tout ce qui leur
// est commun, pour qu'aucun ne l'oublie :
//
//  • module ET jeu revérifiés à CHAQUE clic, pas seulement à la commande ;
//  • une partie active par joueur et par jeu, et un anti-spam de lancement ;
//  • les défis entre membres (Accepter / Refuser, avec expiration) ;
//  • seuls les joueurs concernés peuvent cliquer — les autres reçoivent une
//    réponse que personne d'autre ne voit ;
//  • l'expiration : boutons grisés et message « partie expirée », que ce
//    soit au clic suivant, au balayage périodique ou après un redémarrage.
const { ActionRowBuilder, ButtonStyle } = require('discord.js');
const { COLORS } = require('../embeds');
const { getGuildConfig } = require('../../database');
const { mettreAJour } = require('../reponse');
const P = require('./parties');
const { MORPION } = require('./morpion');
const { PUISSANCE4 } = require('./puissance4');
const { PFC } = require('./pfc');
const { PENDU } = require('./pendu');
const { NOMBRE } = require('./nombre');
const { QUIZ } = require('./quiz');
const { DEMINEUR } = require('./demineur');
const { REFLEXE } = require('./reflexe');
const { BLACKJACK } = require('./blackjack');
const T = require('./tableaux');

const DEFINITIONS_JEUX = {
  morpion: MORPION,
  puissance4: PUISSANCE4,
  pfc: PFC,
  pendu: PENDU,
  nombre: NOMBRE,
  quiz: QUIZ,
  demineur: DEMINEUR,
  reflexe: REFLEXE,
  blackjack: BLACKJACK,
};

const MODULE_COUPE = '⛔ Les **mini-jeux** sont désactivés sur ce serveur.\n➜ Un staff peut les activer via `/config` → 🎲 Mini-jeux.';
const jeuCoupe = (cle) =>
  `🚫 Le jeu **${P.infoJeu(cle).nom}** est désactivé sur ce serveur.\n➜ Un staff peut le réactiver via \`/config\` → 🎲 Mini-jeux.`;

// ── Défis entre membres ────────────────────────────────────────────────

function vueInvitationJeu(partie, client, fin = null) {
  const [lanceur, invite] = partie.joueurs;
  const info = P.infoJeu(partie.jeu);
  const lignes = fin
    ? [fin]
    : [
      `${P.quiJeu(lanceur, client)} défie ${P.quiJeu(invite, client)} au **${info.nom.toLowerCase()}** !`,
      `➜ ${P.quiJeu(invite, client)}, acceptes-tu ?`,
      P.echeanceJeu(partie, 'Le défi expire'),
    ];
  return {
    content: fin ? '' : `<@${invite}>`,
    embeds: [P.embedJeu(partie.jeu, { titre: `${info.emoji} ${info.nom} — défi`, description: lignes.join('\n') })],
    components: fin ? [] : [new ActionRowBuilder().addComponents(
      P.boutonJeu(partie.id, 'oui', { label: 'Accepter', emoji: '✅', style: ButtonStyle.Success }),
      P.boutonJeu(partie.id, 'non', { label: 'Refuser', emoji: '✖️', style: ButtonStyle.Secondary })
    )],
    // Seul l'invité est notifié — et une seule fois, à l'envoi.
    allowedMentions: { users: fin ? [] : [String(invite)], parse: [] },
  };
}

// L'adversaire choisi, ou null pour jouer contre le bot.
function adversaireJeu(interaction) {
  const adv = interaction.options?.getUser?.('adversaire') || null;
  return adv && adv.id !== interaction.client?.user?.id ? adv : null;
}

// Un défi impossible se refuse AVANT l'anti-spam : il ne coûte pas le délai.
function refusDuelJeu(interaction, def) {
  const adv = adversaireJeu(interaction);
  if (!adv) return null;
  const nomJeu = P.infoJeu(def.cle).nom.toLowerCase();
  if (adv.id === interaction.user.id) return `🪞 Tu ne peux pas te défier toi-même. Laisse « adversaire » vide pour m'affronter au ${nomJeu}.`;
  if (adv.bot) return '🤖 Les autres bots ne savent pas jouer… Choisis un membre, ou laisse « adversaire » vide pour m\'affronter.';
  if (P.partieDuJoueurJeu(interaction.guildId, def.cle, adv.id)) {
    return `⏳ <@${adv.id}> a déjà une partie de ${nomJeu} en cours. Réessaie quand elle sera finie.`;
  }
  return null;
}

async function lancerDuelJeu(interaction, def) {
  const client = interaction.client;
  const moi = interaction.user.id;
  const adv = adversaireJeu(interaction);
  const contreBot = !adv;
  const options = def.options?.(interaction) || {};
  if (contreBot) {
    const partie = P.creerPartieJeu({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      jeu: def.cle,
      joueurs: [moi, 'bot'],
      etat: { phase: 'jeu', options },
      tour: moi,
      duree: P.DUREES_JEUX.coup,
    });
    def.demarrer(partie);
    P.sauverPartieJeu(partie);
    return P.envoyerPartieJeu(interaction, partie, def.vue(partie, client));
  }
  const partie = P.creerPartieJeu({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    jeu: def.cle,
    joueurs: [moi, adv.id],
    etat: { phase: 'invitation', options },
    tour: adv.id,
    duree: P.DUREES_JEUX.invitation,
  });
  return P.envoyerPartieJeu(interaction, partie, vueInvitationJeu(partie, client));
}

async function repondreDefiJeu(interaction, partie, def, action) {
  const client = interaction.client;
  const moi = interaction.user.id;
  const [lanceur, invite] = partie.joueurs;

  if (action === 'non') {
    if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Ce défi vient de se terminer.');
    const texte = moi === invite
      ? `✖️ ${P.quiJeu(invite, client)} a décliné le défi de ${P.quiJeu(lanceur, client)}.`
      : `🚫 ${P.quiJeu(lanceur, client)} a retiré son défi.`;
    return mettreAJour(interaction, vueInvitationJeu(partie, client, texte));
  }
  if (action !== 'oui') return P.priveJeu(interaction, '⏳ Ce défi attend une réponse : **Accepter** ou **Refuser**.');
  if (moi !== invite) return P.priveJeu(interaction, `⏳ C'est à ${P.quiJeu(invite, client)} d'accepter ce défi.`);
  const autre = P.partieDuJoueurJeu(partie.guild_id, partie.jeu, invite, partie.id);
  if (autre) {
    return P.priveJeu(interaction, `⏳ Tu as déjà une partie de ${P.infoJeu(partie.jeu).nom.toLowerCase()} en cours : termine-la avant d'en accepter une autre.`);
  }
  def.demarrer(partie);
  P.sauverPartieJeu(partie);
  return mettreAJour(interaction, def.vue(partie, client));
}

// ── Lancement (commande /jeu <jeu>) ─────────────────────────────────────

async function lancerJeu(interaction, cle) {
  const def = DEFINITIONS_JEUX[cle];
  if (!def) return P.priveJeu(interaction, '❓ Ce jeu n\'existe pas (ou plus).');
  const cfg = getGuildConfig(interaction.guildId);
  if (!cfg.jeux_enabled) return P.priveJeu(interaction, MODULE_COUPE);
  if (!P.jeuOuvert(cfg, cle)) return P.priveJeu(interaction, jeuCoupe(cle));

  if (!def.sansPartie) {
    const mienne = P.partieDuJoueurJeu(interaction.guildId, cle, interaction.user.id);
    if (mienne) {
      const lien = P.lienPartieJeu(mienne);
      return P.priveJeu(interaction, `🎲 Tu as déjà une partie de **${P.infoJeu(cle).nom}** en cours.`
        + `${lien ? `\n➜ ${lien}` : ''}\n-# Elle expire <t:${Math.ceil(mienne.expire_le / 1000)}:R> sans action.`);
    }
    if (P.partiesDuSalonJeu(interaction.guildId, interaction.channelId).length >= P.MAX_PARTIES_SALON) {
      return P.priveJeu(interaction, `🚦 Déjà **${P.MAX_PARTIES_SALON} parties** en cours dans ce salon. Terminez-en une, ou jouez dans un autre salon.`);
    }
  }
  const refus = (def.duel ? refusDuelJeu(interaction, def) : null) || def.verifier?.(interaction, cfg);
  if (refus) return P.priveJeu(interaction, refus);

  // Anti-spam en DERNIER : un lancement refusé ne coûte pas le délai.
  const attente = P.attenteLancementJeu(interaction.guildId, interaction.user.id);
  if (attente) return P.priveJeu(interaction, `⏳ Doucement ! Encore **${attente} s** avant de lancer une nouvelle partie.`);

  if (def.duel) return lancerDuelJeu(interaction, def);
  return def.lancer(interaction, { cfg });
}

// ── Fin d'une partie hors de son déroulé normal ────────────────────────

// La conclusion d'une partie expirée : { payload, xp? }.
function conclusionExpireeJeu(partie, client) {
  const def = DEFINITIONS_JEUX[partie.jeu];
  if (partie.etat?.phase === 'invitation') {
    return { payload: vueInvitationJeu(partie, client, `⌛ ${P.quiJeu(partie.joueurs[1], client)} n'a pas répondu à temps : défi annulé.`) };
  }
  if (!def?.conclureExpiree) return { payload: { content: '', embeds: [P.embedJeu(partie.jeu, { description: '⌛ **Partie expirée.**' })], components: [] } };
  return def.conclureExpiree(partie, client);
}

// ⌛ Expire une partie par son id (balayage, minuteur). Sans effet si elle
// a déjà été conclue ailleurs : finirPartieJeu ne laisse passer qu'un seul.
async function expirerJeuParId(client, id) {
  P.annulerMinuteurJeu(id);
  const partie = P.lirePartieJeu(id);
  if (!partie || !P.finirPartieJeu(id)) return false;
  let conclusion;
  try {
    conclusion = conclusionExpireeJeu(partie, client);
  } catch (err) {
    console.warn(`⚠️ Mini-jeux : conclusion de la partie ${id} impossible (${err.message}).`);
    return false;
  }
  await P.editerMessageJeu(client, partie, conclusion.payload);
  if (conclusion.xp?.montant) {
    const guild = client?.guilds?.cache?.get?.(partie.guild_id) || null;
    await P.verserXpJeu(guild, conclusion.xp.userId, conclusion.xp.montant);
  }
  return true;
}

// Un clic sur une partie dont l'heure est passée : on la conclut ici même.
async function expirerDepuisClicJeu(interaction, partie) {
  P.annulerMinuteurJeu(partie.id);
  if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Cette partie vient de se terminer.');
  const conclusion = conclusionExpireeJeu(partie, interaction.client);
  await mettreAJour(interaction, conclusion.payload);
  if (conclusion.xp?.montant) await P.verserXpJeu(interaction.guild, conclusion.xp.userId, conclusion.xp.montant, interaction.channel);
  return P.priveJeu(interaction, '⌛ Cette partie a expiré. Relance-en une avec `/jeu` !');
}

// 🚫 Le jeu a été coupé pendant la partie : on l'arrête proprement (mise
// rendue au blackjack), sans rien compter.
async function arreterPartieJeu(interaction, partie, def) {
  P.annulerMinuteurJeu(partie.id);
  if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Cette partie vient de se terminer.');
  def.annuler?.(partie);
  const texte = `🚫 **Partie arrêtée** : le jeu ${P.infoJeu(partie.jeu).nom} a été désactivé sur ce serveur.`;
  const payload = partie.etat?.phase === 'invitation' || !def.vue
    ? vueInvitationJeu(partie, interaction.client, texte)
    : def.vue(partie, interaction.client, { texte, couleur: COLORS.WARNING });
  return mettreAJour(interaction, payload);
}

// ── Aiguillage des composants « jeu:… » ────────────────────────────────

async function gererComposantJeu(interaction) {
  const [, idTexte, action, arg] = String(interaction.customId || '').split(':');
  const cfg = getGuildConfig(interaction.guildId);
  if (!cfg.jeux_enabled) return P.priveJeu(interaction, MODULE_COUPE);

  // Pagination du classement : « jeu:cl:<jeu>:<page> ».
  if (idTexte === 'cl') return T.pageClassementJeux(interaction, action, arg);

  // ⚠️ Rien d'asynchrone d'ici jusqu'au coup joué : la partie est lue,
  // vérifiée et modifiée d'un seul tenant — deux clics simultanés ne
  // peuvent pas jouer sur le même état.
  const partie = P.lirePartieJeu(Number(idTexte));
  if (!partie || partie.guild_id !== String(interaction.guildId)) {
    return P.priveJeu(interaction, '⌛ Cette partie est terminée ou a expiré.\n➜ Relance-en une avec `/jeu`.');
  }
  const def = DEFINITIONS_JEUX[partie.jeu];
  if (!def) return P.priveJeu(interaction, '❓ Ce jeu n\'existe plus.');
  if (!partie.message_id && interaction.message?.id) {
    partie.message_id = String(interaction.message.id);
    P.sauverPartieJeu(partie);
  }
  if (!P.jeuOuvert(cfg, partie.jeu)) return arreterPartieJeu(interaction, partie, def);
  if (Number(partie.expire_le) <= Date.now()) return expirerDepuisClicJeu(interaction, partie);

  const moi = interaction.user.id;
  if (!def.ouvert && !partie.joueurs.includes(moi)) {
    const humains = partie.joueurs.filter((j) => j !== 'bot');
    const qui = humains.length > 1
      ? `Cette partie oppose ${humains.map((j) => `<@${j}>`).join(' et ')}.`
      : `C'est la partie de <@${humains[0]}>.`;
    return P.priveJeu(interaction, `⛔ ${qui}\n➜ Lance la tienne avec \`/jeu ${partie.jeu}\`.`);
  }
  if (partie.etat?.phase === 'invitation') return repondreDefiJeu(interaction, partie, def, action);
  return def.agir(interaction, partie, action, arg);
}

// ── Balayage périodique ────────────────────────────────────────────────

let balayageEnCours = false;

async function balayerJeux(client) {
  if (balayageEnCours) return 0;
  balayageEnCours = true;
  let n = 0;
  try {
    for (const partie of P.partiesExpireesJeu()) {
      if (await expirerJeuParId(client, partie.id).catch(() => false)) n += 1;
    }
    P.purgerGainsJeux();
  } finally {
    balayageEnCours = false;
  }
  return n;
}

// Au démarrage : les minuteurs perdus se reprogramment, ce qui a expiré
// pendant le sommeil du bot se conclut, puis un balayage toutes les 15 s.
function demarrerJeux(client) {
  for (const partie of P.partiesActivesJeu()) {
    try {
      DEFINITIONS_JEUX[partie.jeu]?.rearmer?.(client, partie);
    } catch (err) {
      console.warn(`⚠️ Mini-jeux : partie ${partie.id} non réarmée (${err.message}).`);
    }
  }
  balayerJeux(client).catch((err) => console.warn(`⚠️ Mini-jeux : balayage (${err.message}).`));
  const minuteur = setInterval(() => {
    balayerJeux(client).catch((err) => console.warn(`⚠️ Mini-jeux : balayage (${err.message}).`));
  }, 15_000);
  minuteur.unref?.();
  return minuteur;
}

module.exports = {
  DEFINITIONS_JEUX, lancerJeu, gererComposantJeu, expirerJeuParId, balayerJeux, demarrerJeux, vueInvitationJeu,
};
