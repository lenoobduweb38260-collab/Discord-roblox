// ⭕ Morpion — contre un membre (défi à accepter) ou contre le bot.
const { ActionRowBuilder, ButtonStyle } = require('discord.js');
const { COLORS } = require('../embeds');
const { mettreAJour } = require('../reponse');
const R = require('./regles');
const P = require('./parties');

// Part de coups joués au hasard par le bot : c'est elle qui le rend
// battable. À 0, il est imbattable (minimax complet).
const ERREURS_MORPION = { facile: 0.45, normal: 0.2, difficile: 0.05 };
const SIGNES = { X: '❌', O: '⭕' };
const CASE_VIDE = '​'; // un bouton exige un libellé : un espace sans largeur

function signeDe(partie, id) {
  return SIGNES[partie.etat.symboles?.[id]] || '❔';
}

// fin : { texte, couleur, ligne, recompense } quand la partie est close.
function vueMorpion(partie, client, fin = null) {
  const { grille = Array(9).fill(null) } = partie.etat;
  const [a, b] = partie.joueurs;
  const lignes = [`${signeDe(partie, a)} ${P.quiJeu(a, client)} contre ${signeDe(partie, b)} ${P.quiJeu(b, client)}`];
  if (b === 'bot') lignes.push(`-# 🤖 Difficulté : ${partie.etat.options?.difficulte || 'normal'}`);
  if (fin) {
    lignes.push('', fin.texte);
    const r = P.ligneRecompenseJeu(fin.recompense);
    if (r) lignes.push(r);
  } else {
    lignes.push('', `➜ À ${P.quiJeu(partie.tour, client)} de jouer (${signeDe(partie, partie.tour)})`);
    lignes.push(P.echeanceJeu(partie, 'Sans coup, la partie expire'));
  }
  const gagnantes = new Set(fin?.ligne || []);
  const rangees = [0, 1, 2].map((l) => new ActionRowBuilder().addComponents(
    ...[0, 1, 2].map((c) => {
      const i = l * 3 + c;
      const v = grille[i];
      let style = ButtonStyle.Secondary;
      if (gagnantes.has(i)) style = ButtonStyle.Success;
      else if (v === 'X') style = ButtonStyle.Danger;
      else if (v === 'O') style = ButtonStyle.Primary;
      return P.boutonJeu(partie.id, 'c', {
        arg: i,
        emoji: v ? SIGNES[v] : null,
        label: v ? null : CASE_VIDE,
        style,
        desactive: Boolean(fin) || Boolean(v),
      });
    })
  ));
  if (!fin) {
    rangees.push(new ActionRowBuilder().addComponents(
      P.boutonJeu(partie.id, 'abandon', { label: 'Abandonner', emoji: '🏳️' })
    ));
  }
  return {
    content: '',
    embeds: [P.embedJeu('morpion', { description: lignes.join('\n'), couleur: fin?.couleur ?? COLORS.PRIMARY })],
    components: rangees,
  };
}

// Qui a joué le signe gagnant.
const joueurDuSigne = (partie, signe) => partie.joueurs.find((j) => partie.etat.symboles?.[j] === signe) || null;

function texteFin(partie, client, issue) {
  if (issue.nul) return { texte: '🤝 **Match nul !** Aucune case de libre, personne n\'aligne trois signes.', couleur: COLORS.WARNING };
  const gagnant = joueurDuSigne(partie, issue.gagnant);
  if (gagnant === 'bot') return { texte: '🤖 **Le bot gagne cette fois.** Retente ta chance avec `/jeu morpion` !', couleur: COLORS.DANGER, gagnant };
  return { texte: `🏆 **${P.quiJeu(gagnant, client)} gagne la partie !**`, couleur: COLORS.SUCCESS, gagnant };
}

const MORPION = {
  cle: 'morpion',
  duel: true,
  ouvert: false,

  options(interaction) {
    const d = interaction.options?.getString?.('difficulte');
    return { difficulte: ERREURS_MORPION[d] !== undefined ? d : 'normal' };
  },

  // Le défi est accepté (ou la partie contre le bot commence) : la grille
  // se pose. Contre un membre, le premier joueur est tiré au sort ; contre
  // le bot, le membre commence toujours. ❌ ouvre la partie.
  demarrer(partie, alea = Math.random) {
    const [a, b] = partie.joueurs;
    const premier = b === 'bot' || alea() < 0.5 ? a : b;
    const second = premier === a ? b : a;
    partie.etat = { ...partie.etat, phase: 'jeu', grille: Array(9).fill(null), symboles: { [premier]: 'X', [second]: 'O' } };
    partie.tour = premier;
    partie.expire_le = Date.now() + P.DUREES_JEUX.coup;
  },

  vue: vueMorpion,

  async agir(interaction, partie, action, arg) {
    const client = interaction.client;
    const moi = interaction.user.id;

    if (action === 'abandon') {
      if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Cette partie vient de se terminer.');
      const autre = partie.joueurs.find((j) => j !== moi);
      P.conclureDuelJeu(partie, { gagnant: autre, recompenser: false });
      return mettreAJour(interaction, vueMorpion(partie, client, {
        texte: `🏳️ ${P.quiJeu(moi, client)} abandonne : la partie revient à ${P.quiJeu(autre, client)}.`,
        couleur: COLORS.WARNING,
      }));
    }
    if (action !== 'c') return P.priveJeu(interaction, '❓ Ce bouton ne correspond à aucun coup : relance une partie avec `/jeu morpion`.');
    if (partie.tour !== moi) {
      return P.priveJeu(interaction, `⏳ Ce n'est pas ton tour : on attend ${P.quiJeu(partie.tour, client)}.`);
    }
    const i = Number(arg);
    const grille = partie.etat.grille;
    if (!Number.isInteger(i) || i < 0 || i > 8 || grille[i]) {
      return P.priveJeu(interaction, '❌ Cette case est déjà prise : choisis-en une autre.');
    }

    // ⚠️ Tout ce qui suit, jusqu'à l'enregistrement, est synchrone : deux
    // clics simultanés ne peuvent pas jouer sur la même grille.
    grille[i] = partie.etat.symboles[moi];
    let issue = R.morpionVainqueur(grille);
    if (!issue && partie.joueurs.includes('bot')) {
      const erreur = ERREURS_MORPION[partie.etat.options?.difficulte] ?? ERREURS_MORPION.normal;
      const coup = R.morpionCoupIA(grille, partie.etat.symboles.bot, { erreur });
      if (coup >= 0) grille[coup] = partie.etat.symboles.bot;
      issue = R.morpionVainqueur(grille);
    }

    if (!issue) {
      partie.tour = partie.joueurs.includes('bot') ? moi : partie.joueurs.find((j) => j !== moi);
      partie.expire_le = Date.now() + P.DUREES_JEUX.coup;
      P.sauverPartieJeu(partie);
      return mettreAJour(interaction, vueMorpion(partie, client));
    }

    if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Cette partie vient de se terminer.');
    const fin = texteFin(partie, client, issue);
    fin.ligne = issue.ligne;
    fin.recompense = P.conclureDuelJeu(partie, { gagnant: fin.gagnant || null, nul: Boolean(issue.nul) });
    await mettreAJour(interaction, vueMorpion(partie, client, fin));
    if (fin.recompense?.xp) await P.verserXpJeu(interaction.guild, fin.gagnant, fin.recompense.xp, interaction.channel);
    return null;
  },

  conclureExpiree(partie, client) {
    return {
      payload: vueMorpion(partie, client, {
        texte: `⌛ **Partie expirée** : ${P.quiJeu(partie.tour, client)} n'a pas joué à temps. Personne ne gagne.`,
      }),
    };
  },
};

module.exports = { MORPION, ERREURS_MORPION };
