// ✂️ Pierre-feuille-ciseaux — premier à 3 points, choix secrets.
//
// Les trois boutons sont sur le message public, mais Discord ne montre à
// personne qui a cliqué quoi : le choix reste secret. Le joueur reçoit une
// confirmation que lui seul voit, et le message public dit seulement
// « ✅ a joué » jusqu'à la révélation de la manche.
const { ActionRowBuilder, ButtonStyle } = require('discord.js');
const { COLORS } = require('../embeds');
const { mettreAJour } = require('../reponse');
const M = require('../miseEnPage');
const R = require('./regles');
const P = require('./parties');

const POINTS_VICTOIRE = 3;
const HISTORIQUE_MAX = 6;
const ORDRE_PFC = ['pierre', 'feuille', 'ciseaux'];
const signePfc = (choix) => R.PFC_CHOIX[choix]?.emoji || '❔';

function vuePfc(partie, client, fin = null) {
  const [a, b] = partie.joueurs;
  const { scores = {}, choix = {}, historique = [], manche = 1 } = partie.etat;
  const lignes = [
    `-# Premier à ${POINTS_VICTOIRE} points.`,
    M.entete('Score', { prefixe: '🏅' }),
    M.entree(`${P.quiJeu(a, client)} **${scores[a] || 0}** – **${scores[b] || 0}** ${P.quiJeu(b, client)}`),
  ];
  if (historique.length) {
    lignes.push(M.entete('Manches', { prefixe: '📜' }));
    const debut = Math.max(0, historique.length - HISTORIQUE_MAX);
    if (debut) lignes.push(M.entree(`*… ${M.pluriel(debut, 'manche')} plus tôt*`));
    historique.slice(debut).forEach((h, k) => {
      const issue = h.gagnant ? `point pour ${P.quiJeu(h.gagnant, client)}` : 'égalité';
      lignes.push(M.entree(`Manche ${debut + k + 1} : ${signePfc(h[a])} contre ${signePfc(h[b])} → ${issue}`));
    });
  }
  if (fin) {
    lignes.push('', fin.texte);
    const r = P.ligneRecompenseJeu(fin.recompense);
    if (r) lignes.push(r);
  } else {
    const etatDe = (id) => (choix[id] ? `✅ ${P.quiJeu(id, client)} a joué` : `⏳ ${P.quiJeu(id, client)} réfléchit`);
    lignes.push('', `➜ Manche ${manche} : ${b === 'bot' ? etatDe(a) : `${etatDe(a)} · ${etatDe(b)}`}`);
    lignes.push(P.echeanceJeu(partie, 'Sans choix, la partie expire'));
  }
  const rangees = fin ? [] : [new ActionRowBuilder().addComponents(
    ...ORDRE_PFC.map((c) => P.boutonJeu(partie.id, 'pfc', {
      arg: c, label: R.PFC_CHOIX[c].nom, emoji: R.PFC_CHOIX[c].emoji, style: ButtonStyle.Primary,
    })),
    P.boutonJeu(partie.id, 'abandon', { label: 'Abandonner', emoji: '🏳️' })
  )];
  return {
    content: '',
    embeds: [P.embedJeu('pfc', { description: lignes.join('\n'), couleur: fin?.couleur ?? COLORS.PRIMARY })],
    components: rangees,
  };
}

const PFC = {
  cle: 'pfc',
  duel: true,
  ouvert: false,

  options() {
    return {};
  },

  demarrer(partie) {
    const [a, b] = partie.joueurs;
    partie.etat = { ...partie.etat, phase: 'jeu', scores: { [a]: 0, [b]: 0 }, choix: {}, historique: [], manche: 1 };
    partie.tour = null; // les deux jouent en même temps
    partie.expire_le = Date.now() + P.DUREES_JEUX.manche;
  },

  vue: vuePfc,

  async agir(interaction, partie, action, arg, alea = Math.random) {
    const client = interaction.client;
    const moi = interaction.user.id;
    const etatPfc = partie.etat;
    const [a, b] = partie.joueurs;

    if (action === 'abandon') {
      if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Cette partie vient de se terminer.');
      const autre = partie.joueurs.find((j) => j !== moi);
      P.conclureDuelJeu(partie, { gagnant: autre, recompenser: false });
      return mettreAJour(interaction, vuePfc(partie, client, {
        texte: `🏳️ ${P.quiJeu(moi, client)} abandonne : la partie revient à ${P.quiJeu(autre, client)}.`,
        couleur: COLORS.WARNING,
      }));
    }
    if (action !== 'pfc' || !R.PFC_CHOIX[arg]) {
      return P.priveJeu(interaction, '❓ Ce bouton ne correspond à aucun choix : relance une partie avec `/jeu pfc`.');
    }
    if (etatPfc.choix[moi]) {
      return P.priveJeu(interaction, `🤫 Tu as déjà joué ${signePfc(etatPfc.choix[moi])} pour cette manche : on attend ton adversaire.`);
    }

    // Synchrone jusqu'à l'enregistrement.
    etatPfc.choix[moi] = arg;
    if (partie.joueurs.includes('bot')) etatPfc.choix.bot = ORDRE_PFC[Math.floor(alea() * 3)];

    if (!(etatPfc.choix[a] && etatPfc.choix[b])) {
      partie.expire_le = Date.now() + P.DUREES_JEUX.manche;
      P.sauverPartieJeu(partie);
      await mettreAJour(interaction, vuePfc(partie, client));
      return P.priveJeu(interaction, `🤫 Tu joues **${signePfc(arg)} ${R.PFC_CHOIX[arg].nom}**. Ton adversaire ne le verra qu'à la révélation.`);
    }

    // Les deux ont joué : révélation de la manche.
    const res = R.pfcDuel(etatPfc.choix[a], etatPfc.choix[b]);
    const gagnantManche = res === 1 ? a : res === -1 ? b : null;
    etatPfc.historique.push({ [a]: etatPfc.choix[a], [b]: etatPfc.choix[b], gagnant: gagnantManche });
    if (gagnantManche) etatPfc.scores[gagnantManche] = (etatPfc.scores[gagnantManche] || 0) + 1;
    etatPfc.choix = {};
    etatPfc.manche += 1;

    const vainqueur = partie.joueurs.find((j) => (etatPfc.scores[j] || 0) >= POINTS_VICTOIRE) || null;
    if (!vainqueur) {
      partie.expire_le = Date.now() + P.DUREES_JEUX.manche;
      P.sauverPartieJeu(partie);
      return mettreAJour(interaction, vuePfc(partie, client));
    }

    if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Cette partie vient de se terminer.');
    const fin = vainqueur === 'bot'
      ? { texte: `🤖 **Le bot remporte la partie ${etatPfc.scores.bot}–${etatPfc.scores[a]}.** Revanche avec \`/jeu pfc\` ?`, couleur: COLORS.DANGER }
      : { texte: `🏆 **${P.quiJeu(vainqueur, client)} remporte la partie ${etatPfc.scores[vainqueur]}–${etatPfc.scores[vainqueur === a ? b : a]} !**`, couleur: COLORS.SUCCESS };
    fin.recompense = P.conclureDuelJeu(partie, { gagnant: vainqueur });
    await mettreAJour(interaction, vuePfc(partie, client, fin));
    if (fin.recompense?.xp) await P.verserXpJeu(interaction.guild, vainqueur, fin.recompense.xp, interaction.channel);
    return null;
  },

  conclureExpiree(partie, client) {
    const absents = partie.joueurs.filter((j) => j !== 'bot' && !partie.etat.choix?.[j]);
    const qui = absents.length ? absents.map((j) => P.quiJeu(j, client)).join(' et ') : 'personne';
    return {
      payload: vuePfc(partie, client, { texte: `⌛ **Partie expirée** : ${qui} n'a pas joué à temps. Personne ne gagne.` }),
    };
  },
};

module.exports = { PFC, POINTS_VICTOIRE };
