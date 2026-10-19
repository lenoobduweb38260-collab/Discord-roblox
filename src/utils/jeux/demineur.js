// 💣 Démineur — la grille entière, chaque case sous un spoiler.
//
// Rien à garder en base : tout est dans le message, et chacun joue en
// dévoilant les cases. La case de départ est montrée d'office, et elle est
// toujours sûre (sans mine autour) : le premier coup n'est jamais un pari.
const { COLORS } = require('../embeds');
const R = require('./regles');
const P = require('./parties');

const NOMS_TAILLES = { petit: 'Petite', moyen: 'Moyenne', grand: 'Grande' };

function vueDemineur(grille, taille) {
  const lignes = [
    `-# ${NOMS_TAILLES[taille] || 'Moyenne'} grille · ${grille.lignes}×${grille.colonnes} · **${grille.nbMines} mines**`,
    '',
    R.demineurTexte(grille),
    '',
    '➜ La case 🟦 dévoilée est sûre : commence autour d\'elle.',
    '➜ Clique une case pour la dévoiler. Un chiffre compte les mines voisines.',
  ];
  return {
    embeds: [P.embedJeu('demineur', { description: lignes.join('\n'), couleur: COLORS.PRIMARY })],
    allowedMentions: { parse: [] },
  };
}

const DEMINEUR = {
  cle: 'demineur',
  duel: false,
  ouvert: true,
  sansPartie: true, // rien en base : pas de « partie en cours » à vérifier

  async lancer(interaction, { alea = Math.random } = {}) {
    const choisie = interaction.options?.getString?.('taille');
    const taille = R.DEMINEUR_TAILLES[choisie] ? choisie : 'moyen';
    const t = R.DEMINEUR_TAILLES[taille];
    const grille = R.demineurGrille(t.lignes, t.colonnes, t.mines, alea);
    return interaction.reply(vueDemineur(grille, taille));
  },
};

module.exports = { DEMINEUR, vueDemineur };
