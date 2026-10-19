// 🔴 Puissance 4 — contre un membre (défi à accepter) ou contre le bot.
//
// La grille s'écrit en émojis ; les sept colonnes sont des boutons, sur deux
// rangées (4 + 3, avec « Abandonner » au bout de la seconde).
const { ActionRowBuilder, ButtonStyle } = require('discord.js');
const { COLORS } = require('../embeds');
const { mettreAJour } = require('../reponse');
const R = require('./regles');
const P = require('./parties');

// Profondeur de recherche et part de coups au hasard, par difficulté.
const NIVEAUX_P4 = {
  facile: { profondeur: 2, erreur: 0.35 },
  normal: { profondeur: 4, erreur: 0.12 },
  difficile: { profondeur: 5, erreur: 0.03 },
};
const PIONS = { R: '🔴', J: '🟡' };
const PIONS_GAGNANTS = { R: '🟥', J: '🟨' };
const VIDE = '⚫';
const ENTETE = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'].join('');

const pionDe = (partie, id) => PIONS[partie.etat.pions?.[id]] || '❔';

function grilleEnTexte(grille, gagnantes = new Set()) {
  const lignes = [ENTETE];
  for (let l = 0; l < R.P4_LIGNES; l++) {
    let ligne = '';
    for (let c = 0; c < R.P4_COLONNES; c++) {
      const i = l * R.P4_COLONNES + c;
      const v = grille[i];
      ligne += v ? (gagnantes.has(i) ? PIONS_GAGNANTS[v] : PIONS[v]) : VIDE;
    }
    lignes.push(ligne);
  }
  return lignes.join('\n');
}

function vuePuissance4(partie, client, fin = null) {
  const grille = partie.etat.grille || R.p4Vide();
  const [a, b] = partie.joueurs;
  const lignes = [`${pionDe(partie, a)} ${P.quiJeu(a, client)} contre ${pionDe(partie, b)} ${P.quiJeu(b, client)}`];
  if (b === 'bot') lignes.push(`-# 🤖 Difficulté : ${partie.etat.options?.difficulte || 'normal'}`);
  lignes.push('', grilleEnTexte(grille, new Set(fin?.cases || [])), '');
  if (fin) {
    lignes.push(fin.texte);
    const r = P.ligneRecompenseJeu(fin.recompense);
    if (r) lignes.push(r);
  } else {
    lignes.push(`➜ À ${P.quiJeu(partie.tour, client)} de jouer (${pionDe(partie, partie.tour)}) : choisis une colonne.`);
    lignes.push(P.echeanceJeu(partie, 'Sans coup, la partie expire'));
  }
  const colonne = (c) => P.boutonJeu(partie.id, 'col', {
    arg: c,
    label: String(c + 1),
    style: ButtonStyle.Primary,
    desactive: Boolean(fin) || R.p4LigneLibre(grille, c) < 0,
  });
  const rangees = [];
  if (!fin) {
    rangees.push(new ActionRowBuilder().addComponents(colonne(0), colonne(1), colonne(2), colonne(3)));
    rangees.push(new ActionRowBuilder().addComponents(
      colonne(4), colonne(5), colonne(6),
      P.boutonJeu(partie.id, 'abandon', { label: 'Abandonner', emoji: '🏳️' })
    ));
  }
  return {
    content: '',
    embeds: [P.embedJeu('puissance4', { description: lignes.join('\n'), couleur: fin?.couleur ?? COLORS.PRIMARY })],
    components: rangees,
  };
}

const joueurDuPion = (partie, pion) => partie.joueurs.find((j) => partie.etat.pions?.[j] === pion) || null;

const PUISSANCE4 = {
  cle: 'puissance4',
  duel: true,
  ouvert: false,

  options(interaction) {
    const d = interaction.options?.getString?.('difficulte');
    return { difficulte: NIVEAUX_P4[d] ? d : 'normal' };
  },

  demarrer(partie, alea = Math.random) {
    const [a, b] = partie.joueurs;
    const premier = b === 'bot' || alea() < 0.5 ? a : b;
    const second = premier === a ? b : a;
    partie.etat = { ...partie.etat, phase: 'jeu', grille: R.p4Vide(), pions: { [premier]: 'R', [second]: 'J' } };
    partie.tour = premier;
    partie.expire_le = Date.now() + P.DUREES_JEUX.coup;
  },

  vue: vuePuissance4,

  async agir(interaction, partie, action, arg) {
    const client = interaction.client;
    const moi = interaction.user.id;

    if (action === 'abandon') {
      if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Cette partie vient de se terminer.');
      const autre = partie.joueurs.find((j) => j !== moi);
      P.conclureDuelJeu(partie, { gagnant: autre, recompenser: false });
      return mettreAJour(interaction, vuePuissance4(partie, client, {
        texte: `🏳️ ${P.quiJeu(moi, client)} abandonne : la partie revient à ${P.quiJeu(autre, client)}.`,
        couleur: COLORS.WARNING,
      }));
    }
    if (action !== 'col') return P.priveJeu(interaction, '❓ Ce bouton ne correspond à aucune colonne : relance une partie avec `/jeu puissance4`.');
    if (partie.tour !== moi) {
      return P.priveJeu(interaction, `⏳ Ce n'est pas ton tour : on attend ${P.quiJeu(partie.tour, client)}.`);
    }
    const c = Number(arg);
    const coup = Number.isInteger(c) ? R.p4Jouer(partie.etat.grille, c, partie.etat.pions[moi]) : null;
    if (!coup) return P.priveJeu(interaction, '❌ Cette colonne est pleine : choisis-en une autre.');

    // Synchrone jusqu'à l'enregistrement : aucun clic ne se glisse entre deux.
    partie.etat.grille = coup.grille;
    let issue = R.p4Vainqueur(partie.etat.grille);
    if (!issue && partie.joueurs.includes('bot')) {
      const niveau = NIVEAUX_P4[partie.etat.options?.difficulte] || NIVEAUX_P4.normal;
      const colBot = R.p4CoupIA(partie.etat.grille, partie.etat.pions.bot, niveau);
      const joue = colBot >= 0 ? R.p4Jouer(partie.etat.grille, colBot, partie.etat.pions.bot) : null;
      if (joue) partie.etat.grille = joue.grille;
      issue = R.p4Vainqueur(partie.etat.grille);
    }

    if (!issue) {
      partie.tour = partie.joueurs.includes('bot') ? moi : partie.joueurs.find((j) => j !== moi);
      partie.expire_le = Date.now() + P.DUREES_JEUX.coup;
      P.sauverPartieJeu(partie);
      return mettreAJour(interaction, vuePuissance4(partie, client));
    }

    if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Cette partie vient de se terminer.');
    let fin;
    if (issue.nul) {
      fin = { texte: '🤝 **Match nul !** La grille est pleine et personne n\'a aligné quatre pions.', couleur: COLORS.WARNING };
      fin.recompense = P.conclureDuelJeu(partie, { nul: true });
    } else {
      const gagnant = joueurDuPion(partie, issue.gagnant);
      fin = gagnant === 'bot'
        ? { texte: '🤖 **Le bot aligne quatre pions.** Retente ta chance avec `/jeu puissance4` !', couleur: COLORS.DANGER }
        : { texte: `🏆 **${P.quiJeu(gagnant, client)} aligne quatre pions et gagne !**`, couleur: COLORS.SUCCESS };
      fin.cases = issue.cases;
      fin.gagnant = gagnant;
      fin.recompense = P.conclureDuelJeu(partie, { gagnant });
    }
    await mettreAJour(interaction, vuePuissance4(partie, client, fin));
    if (fin.recompense?.xp) await P.verserXpJeu(interaction.guild, fin.gagnant, fin.recompense.xp, interaction.channel);
    return null;
  },

  conclureExpiree(partie, client) {
    return {
      payload: vuePuissance4(partie, client, {
        texte: `⌛ **Partie expirée** : ${P.quiJeu(partie.tour, client)} n'a pas joué à temps. Personne ne gagne.`,
      }),
    };
  },
};

module.exports = { PUISSANCE4, NIVEAUX_P4 };
