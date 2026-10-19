// 🎲 Les RÈGLES des mini-jeux — rien d'autre.
//
// Aucun Discord ici, aucune base : des grilles, des cartes, des nombres. Tout
// ce qui décide d'une victoire vit dans ce fichier, et peut donc s'éprouver
// sans bot (tests/jeux.test.js le fait jeu par jeu).
//
// Le hasard arrive toujours en argument (`alea`, par défaut Math.random) :
// un test qui veut savoir si l'IA bloque n'a pas à espérer qu'elle tire le
// bon numéro.

// ── Hasard ─────────────────────────────────────────────────────────────

// Mélange de Fisher-Yates, sur une copie : l'original n'est jamais touché.
function melangerJeu(tableau, alea = Math.random) {
  const t = [...tableau];
  for (let i = t.length - 1; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1));
    [t[i], t[j]] = [t[j], t[i]];
  }
  return t;
}

const auHasard = (liste, alea = Math.random) => liste[Math.floor(alea() * liste.length)];

// ══════════════════════════════════════════════════════════════════
// ⭕ MORPION — grille de 9 cases, index 0 à 8 de gauche à droite
// ══════════════════════════════════════════════════════════════════

const MORPION_LIGNES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // lignes
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // colonnes
  [0, 4, 8], [2, 4, 6], // diagonales
];

// { gagnant: 'X'|'O', ligne } · { nul: true } · null (la partie continue)
function morpionVainqueur(grille) {
  for (const ligne of MORPION_LIGNES) {
    const [a, b, c] = ligne;
    if (grille[a] && grille[a] === grille[b] && grille[a] === grille[c]) return { gagnant: grille[a], ligne };
  }
  if (grille.every(Boolean)) return { nul: true };
  return null;
}

const casesLibres = (grille) => grille.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
const adversaireDe = (symbole) => (symbole === 'X' ? 'O' : 'X');

// Le coup qui gagne tout de suite pour `symbole`, ou -1.
function morpionCoupGagnant(grille, symbole) {
  for (const i of casesLibres(grille)) {
    const essai = [...grille];
    essai[i] = symbole;
    if (morpionVainqueur(essai)?.gagnant === symbole) return i;
  }
  return -1;
}

// Minimax avec élagage alpha-bêta. Une victoire rapide vaut plus qu'une
// victoire lente : l'IA ne fait pas traîner une partie gagnée.
function minimaxMorpion(grille, joueur, moi, profondeur, alpha, beta) {
  const issue = morpionVainqueur(grille);
  if (issue?.gagnant) return issue.gagnant === moi ? 10 - profondeur : profondeur - 10;
  if (issue?.nul) return 0;
  const maximise = joueur === moi;
  let meilleur = maximise ? -Infinity : Infinity;
  for (const i of casesLibres(grille)) {
    grille[i] = joueur;
    const score = minimaxMorpion(grille, adversaireDe(joueur), moi, profondeur + 1, alpha, beta);
    grille[i] = null;
    if (maximise) {
      meilleur = Math.max(meilleur, score);
      alpha = Math.max(alpha, score);
    } else {
      meilleur = Math.min(meilleur, score);
      beta = Math.min(beta, score);
    }
    if (beta <= alpha) break;
  }
  return meilleur;
}

// 🤖 Le coup de l'IA. Bonne, mais battable :
//  • elle gagne TOUJOURS quand elle peut (rater un coup gagnant ferait idiot) ;
//  • avec la probabilité `erreur`, elle joue au hasard au lieu de réfléchir —
//    blocage compris. C'est cette part de hasard qui la rend battable ;
//  • sinon, minimax complet : imbattable sur ce coup-là.
function morpionCoupIA(grille, moi, { erreur = 0, alea = Math.random } = {}) {
  const libres = casesLibres(grille);
  if (!libres.length) return -1;
  const gagne = morpionCoupGagnant(grille, moi);
  if (gagne >= 0) return gagne;
  if (alea() < erreur) return auHasard(libres, alea);
  const bloque = morpionCoupGagnant(grille, adversaireDe(moi));
  if (bloque >= 0) return bloque;
  const travail = [...grille];
  let meilleurScore = -Infinity;
  let meilleurs = [];
  for (const i of libres) {
    travail[i] = moi;
    const score = minimaxMorpion(travail, adversaireDe(moi), moi, 1, -Infinity, Infinity);
    travail[i] = null;
    if (score > meilleurScore) {
      meilleurScore = score;
      meilleurs = [i];
    } else if (score === meilleurScore) {
      meilleurs.push(i);
    }
  }
  return auHasard(meilleurs, alea);
}

// ══════════════════════════════════════════════════════════════════
// 🔴 PUISSANCE 4 — 6 lignes × 7 colonnes, index = ligne × 7 + colonne,
// la ligne 0 étant EN HAUT (comme on lit la grille).
// ══════════════════════════════════════════════════════════════════

const P4_LIGNES = 6;
const P4_COLONNES = 7;
const P4_DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]]; // →, ↓, ↘, ↙

const p4Vide = () => Array(P4_LIGNES * P4_COLONNES).fill(null);

// La ligne où tomberait un pion dans cette colonne, ou -1 si elle est pleine.
function p4LigneLibre(grille, colonne) {
  if (colonne < 0 || colonne >= P4_COLONNES) return -1;
  for (let l = P4_LIGNES - 1; l >= 0; l--) {
    if (!grille[l * P4_COLONNES + colonne]) return l;
  }
  return -1;
}

const p4ColonnesJouables = (grille) =>
  Array.from({ length: P4_COLONNES }, (_, c) => c).filter((c) => p4LigneLibre(grille, c) >= 0);

// Joue un pion. Renvoie { grille, index } (une NOUVELLE grille), ou null si
// la colonne est pleine ou hors de la grille.
function p4Jouer(grille, colonne, pion) {
  const l = p4LigneLibre(grille, colonne);
  if (l < 0) return null;
  const neuve = [...grille];
  const index = l * P4_COLONNES + colonne;
  neuve[index] = pion;
  return { grille: neuve, index };
}

// { gagnant, cases } · { nul: true } · null
function p4Vainqueur(grille) {
  for (let l = 0; l < P4_LIGNES; l++) {
    for (let c = 0; c < P4_COLONNES; c++) {
      const pion = grille[l * P4_COLONNES + c];
      if (!pion) continue;
      for (const [dl, dc] of P4_DIRECTIONS) {
        const cases = [l * P4_COLONNES + c];
        for (let k = 1; k < 4; k++) {
          const ll = l + dl * k;
          const cc = c + dc * k;
          if (ll < 0 || ll >= P4_LIGNES || cc < 0 || cc >= P4_COLONNES) break;
          if (grille[ll * P4_COLONNES + cc] !== pion) break;
          cases.push(ll * P4_COLONNES + cc);
        }
        if (cases.length === 4) return { gagnant: pion, cases };
      }
    }
  }
  if (grille.every(Boolean)) return { nul: true };
  return null;
}

// La colonne qui gagne tout de suite pour `pion`, ou -1.
function p4CoupGagnant(grille, pion) {
  for (const c of p4ColonnesJouables(grille)) {
    if (p4Vainqueur(p4Jouer(grille, c, pion).grille)?.gagnant === pion) return c;
  }
  return -1;
}

// Note d'une fenêtre de 4 cases : trois pions et un trou valent beaucoup,
// la même chose chez l'adversaire coûte presque autant (il faut bloquer).
function noterFenetre(fenetre, pion, autre) {
  const miens = fenetre.filter((x) => x === pion).length;
  const siens = fenetre.filter((x) => x === autre).length;
  const vides = 4 - miens - siens;
  if (miens === 4) return 1000;
  if (miens === 3 && vides === 1) return 6;
  if (miens === 2 && vides === 2) return 2;
  if (siens === 3 && vides === 1) return -5;
  if (siens === 2 && vides === 2) return -1;
  return 0;
}

// Heuristique : le centre d'abord (il entre dans plus d'alignements), puis
// toutes les fenêtres de 4 dans les quatre directions.
function p4Heuristique(grille, pion, autre) {
  let score = 0;
  const centre = Math.floor(P4_COLONNES / 2);
  for (let l = 0; l < P4_LIGNES; l++) if (grille[l * P4_COLONNES + centre] === pion) score += 3;
  for (let l = 0; l < P4_LIGNES; l++) {
    for (let c = 0; c < P4_COLONNES; c++) {
      for (const [dl, dc] of P4_DIRECTIONS) {
        const finL = l + dl * 3;
        const finC = c + dc * 3;
        if (finL < 0 || finL >= P4_LIGNES || finC < 0 || finC >= P4_COLONNES) continue;
        const fenetre = [0, 1, 2, 3].map((k) => grille[(l + dl * k) * P4_COLONNES + (c + dc * k)]);
        score += noterFenetre(fenetre, pion, autre);
      }
    }
  }
  return score;
}

// Ordre d'exploration : le centre en premier, l'élagage coupe plus tôt.
const ORDRE_P4 = [3, 2, 4, 1, 5, 0, 6];

function negamaxP4(grille, profondeur, alpha, beta, pion, autre) {
  const issue = p4Vainqueur(grille);
  if (issue?.gagnant) return issue.gagnant === pion ? 100000 + profondeur : -100000 - profondeur;
  if (issue?.nul) return 0;
  if (profondeur === 0) return p4Heuristique(grille, pion, autre);
  let meilleur = -Infinity;
  for (const c of ORDRE_P4) {
    const coup = p4Jouer(grille, c, pion);
    if (!coup) continue;
    const score = -negamaxP4(coup.grille, profondeur - 1, -beta, -alpha, autre, pion);
    if (score > meilleur) meilleur = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return meilleur;
}

// 🤖 Le coup de l'IA, par ordre de priorité :
//  1. gagner tout de suite ;
//  2. (sauf erreur) bloquer le coup gagnant de l'adversaire ;
//  3. (erreur) une colonne au hasard, mais pas un cadeau évident ;
//  4. sinon, recherche à profondeur limitée avec l'heuristique ci-dessus.
function p4CoupIA(grille, pion, { profondeur = 4, erreur = 0, alea = Math.random } = {}) {
  const jouables = p4ColonnesJouables(grille);
  if (!jouables.length) return -1;
  const autre = pion === 'R' ? 'J' : 'R';
  const gagne = p4CoupGagnant(grille, pion);
  if (gagne >= 0) return gagne;
  const seTromper = alea() < erreur;
  const bloque = p4CoupGagnant(grille, autre);
  if (bloque >= 0 && !seTromper) return bloque;
  // Une colonne qui offre la victoire juste au-dessus est un cadeau.
  const sures = jouables.filter((c) => p4CoupGagnant(p4Jouer(grille, c, pion).grille, autre) < 0);
  if (seTromper) return auHasard(sures.length ? sures : jouables, alea);
  let meilleurScore = -Infinity;
  let meilleurs = [];
  for (const c of ORDRE_P4) {
    if (!jouables.includes(c)) continue;
    const score = -negamaxP4(p4Jouer(grille, c, pion).grille, profondeur - 1, -Infinity, Infinity, autre, pion);
    if (score > meilleurScore) {
      meilleurScore = score;
      meilleurs = [c];
    } else if (score === meilleurScore) {
      meilleurs.push(c);
    }
  }
  return auHasard(meilleurs, alea);
}

// ══════════════════════════════════════════════════════════════════
// ✂️ PIERRE-FEUILLE-CISEAUX
// ══════════════════════════════════════════════════════════════════

const PFC_CHOIX = {
  pierre: { emoji: '🪨', nom: 'Pierre', bat: 'ciseaux' },
  feuille: { emoji: '📄', nom: 'Feuille', bat: 'pierre' },
  ciseaux: { emoji: '✂️', nom: 'Ciseaux', bat: 'feuille' },
};

// 1 : a gagne · -1 : b gagne · 0 : égalité
function pfcDuel(a, b) {
  if (!PFC_CHOIX[a] || !PFC_CHOIX[b]) throw new Error(`Choix inconnu : ${a} / ${b}`);
  if (a === b) return 0;
  return PFC_CHOIX[a].bat === b ? 1 : -1;
}

// ══════════════════════════════════════════════════════════════════
// 🪢 PENDU
// ══════════════════════════════════════════════════════════════════

const PENDU_ERREURS_MAX = 7;

// « Éléphant » → « ELEPHANT ». Les lettres se proposent sans accent : taper
// E révèle aussi les É, È, Ê et Ë du mot.
function penduNormaliser(texte) {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/gi, 'OE')
    .replace(/æ/gi, 'AE')
    .toUpperCase();
}

const estLettre = (car) => /^[A-Z]$/.test(penduNormaliser(car));

// Le mot tel qu'on le montre : les lettres trouvées (avec leurs accents),
// des tirets bas pour les autres, le reste (trait d'union…) tel quel.
function penduMasque(mot, lettres) {
  const vues = new Set(lettres);
  return [...String(mot).toUpperCase()]
    .map((car) => (estLettre(car) ? (vues.has(penduNormaliser(car)) ? car : '_') : car))
    .join(' ');
}

const penduTrouve = (mot, lettres) => {
  const vues = new Set(lettres);
  return [...String(mot)].every((car) => !estLettre(car) || vues.has(penduNormaliser(car)));
};

// La lettre est-elle dans le mot ?
const penduContient = (mot, lettre) => penduNormaliser(mot).includes(penduNormaliser(lettre));

// La potence : la charpente est là dès le départ, chaque erreur ajoute un
// morceau — corde, tête, corps, bras gauche, bras droit, jambe gauche,
// jambe droite. La septième erreur complète le pendu.
function penduDessin(erreurs) {
  const n = Math.max(0, Math.min(PENDU_ERREURS_MAX, Number(erreurs) || 0));
  const bras = `${n >= 4 ? '/' : ' '}${n >= 3 ? '|' : ' '}${n >= 5 ? '\\' : ''}`;
  const jambes = `${n >= 6 ? '/' : ' '} ${n >= 7 ? '\\' : ''}`;
  return [
    '  ╔═══╗',
    `  ║   ${n >= 1 ? '|' : ''}`,
    `  ║   ${n >= 2 ? 'O' : ''}`,
    `  ║  ${bras}`,
    `  ║  ${jambes}`,
    '══╩══',
  ].map((l) => l.trimEnd()).join('\n');
}

// ══════════════════════════════════════════════════════════════════
// 🔢 PLUS OU MOINS
// ══════════════════════════════════════════════════════════════════

// Assez d'essais pour gagner à coup sûr par dichotomie, plus un de marge.
function nombreEssaisMax(borne) {
  return Math.ceil(Math.log2(Math.max(2, Number(borne) || 100))) + 1;
}

// ══════════════════════════════════════════════════════════════════
// 🃏 BLACKJACK — un paquet de 52 cartes, l'as vaut 1 ou 11
// ══════════════════════════════════════════════════════════════════

const BJ_RANGS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const BJ_COULEURS = ['♠', '♥', '♦', '♣'];

const bjSabot = (alea = Math.random) =>
  melangerJeu(BJ_COULEURS.flatMap((c) => BJ_RANGS.map((r) => `${r}${c}`)), alea);

const rangDe = (carte) => String(carte).slice(0, -1);

// { total, souple } — « souple » : un as compte 11 sans faire sauter la main.
function bjValeur(main) {
  let total = 0;
  let as = 0;
  for (const carte of main) {
    const r = rangDe(carte);
    if (r === 'A') {
      as += 1;
      total += 1;
    } else if (['J', 'Q', 'K'].includes(r)) {
      total += 10;
    } else {
      total += Number(r);
    }
  }
  const souple = as > 0 && total + 10 <= 21;
  return { total: souple ? total + 10 : total, souple };
}

const bjBlackjack = (main) => main.length === 2 && bjValeur(main).total === 21;

// Le croupier tire jusqu'à 17 et reste sur un 17 souple.
function bjCroupier(main, sabot) {
  const m = [...main];
  const s = [...sabot];
  while (bjValeur(m).total < 17 && s.length) m.push(s.shift());
  return { main: m, sabot: s };
}

// 'blackjack' (21 servi, payé 3 pour 2) · 'victoire' · 'nul' · 'defaite'
function bjIssue(joueur, croupier) {
  const j = bjValeur(joueur).total;
  const c = bjValeur(croupier).total;
  if (j > 21) return 'defaite';
  const bjJ = bjBlackjack(joueur);
  const bjC = bjBlackjack(croupier);
  if (bjJ && bjC) return 'nul';
  if (bjJ) return 'blackjack';
  if (bjC) return 'defaite';
  if (c > 21) return 'victoire';
  if (j > c) return 'victoire';
  if (j < c) return 'defaite';
  return 'nul';
}

// Ce que rend une mise selon l'issue (mise comprise) : 0, la mise, 2× ou 2,5×.
function bjGain(issue, mise) {
  const m = Math.max(0, Math.floor(Number(mise) || 0));
  if (issue === 'blackjack') return m * 2 + Math.floor(m / 2);
  if (issue === 'victoire') return m * 2;
  if (issue === 'nul') return m;
  return 0;
}

// ══════════════════════════════════════════════════════════════════
// 💣 DÉMINEUR — en balises spoiler, comme sur papier
// ══════════════════════════════════════════════════════════════════

const DEMINEUR_TAILLES = {
  petit: { lignes: 5, colonnes: 5, mines: 4 },
  moyen: { lignes: 7, colonnes: 7, mines: 8 },
  grand: { lignes: 9, colonnes: 9, mines: 14 },
};

function voisinsDe(lignes, colonnes, index) {
  const l = Math.floor(index / colonnes);
  const c = index % colonnes;
  const v = [];
  for (let dl = -1; dl <= 1; dl++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dl && !dc) continue;
      const ll = l + dl;
      const cc = c + dc;
      if (ll >= 0 && ll < lignes && cc >= 0 && cc < colonnes) v.push(ll * colonnes + cc);
    }
  }
  return v;
}

// Le nombre de mines autour d'une case.
const demineurVoisins = (grille, index) =>
  voisinsDe(grille.lignes, grille.colonnes, index).filter((i) => grille.mines[i]).length;

// Une grille dont la case de départ est sûre ET vide (aucune mine autour,
// quand la place le permet) : le premier coup n'est jamais un pile ou face.
function demineurGrille(lignes, colonnes, mines, alea = Math.random) {
  const total = lignes * colonnes;
  const nbMines = Math.max(1, Math.min(mines, total - 1));
  const depart = Math.floor(alea() * total);
  const protegees = new Set([depart]);
  if (total - 9 >= nbMines) for (const v of voisinsDe(lignes, colonnes, depart)) protegees.add(v);
  const candidates = melangerJeu(
    Array.from({ length: total }, (_, i) => i).filter((i) => !protegees.has(i)),
    alea
  );
  const champ = Array(total).fill(false);
  for (const i of candidates.slice(0, nbMines)) champ[i] = true;
  const grille = { lignes, colonnes, mines: champ, depart, nbMines };
  grille.comptes = champ.map((m, i) => (m ? -1 : demineurVoisins(grille, i)));
  return grille;
}

const CHIFFRES = ['🟦', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];

// Le texte à publier : chaque case cachée sous un spoiler, sauf le départ.
function demineurTexte(grille) {
  const lignes = [];
  for (let l = 0; l < grille.lignes; l++) {
    let ligne = '';
    for (let c = 0; c < grille.colonnes; c++) {
      const i = l * grille.colonnes + c;
      const symbole = grille.mines[i] ? '💣' : CHIFFRES[grille.comptes[i]];
      ligne += i === grille.depart ? symbole : `||${symbole}||`;
    }
    lignes.push(ligne);
  }
  return lignes.join('\n');
}

// ══════════════════════════════════════════════════════════════════
// 🧠 QUIZ — validation de la banque de questions
// ══════════════════════════════════════════════════════════════════

const QUIZ_MAX_REPONSE = 70; // « A · » + réponse doit tenir dans un bouton (80)

// Liste des défauts d'une question (vide = valide).
function quizDefauts(q) {
  const defauts = [];
  if (!q || typeof q !== 'object') return ['pas un objet'];
  if (typeof q.theme !== 'string' || !q.theme.trim()) defauts.push('thème manquant');
  if (typeof q.question !== 'string' || q.question.trim().length < 8) defauts.push('question manquante');
  if (!Array.isArray(q.reponses) || q.reponses.length !== 4) defauts.push('il faut exactement 4 réponses');
  else {
    const propres = q.reponses.map((r) => String(r ?? '').trim());
    if (propres.some((r) => !r)) defauts.push('réponse vide');
    if (new Set(propres.map((r) => r.toLowerCase())).size !== 4) defauts.push('réponses en double');
    if (propres.some((r) => r.length > QUIZ_MAX_REPONSE)) defauts.push('réponse trop longue pour un bouton');
  }
  if (!Number.isInteger(q.bonne) || q.bonne < 0 || q.bonne > 3) defauts.push('index de bonne réponse invalide');
  return defauts;
}

module.exports = {
  melangerJeu,
  MORPION_LIGNES, morpionVainqueur, morpionCoupGagnant, morpionCoupIA,
  P4_LIGNES, P4_COLONNES, p4Vide, p4LigneLibre, p4ColonnesJouables, p4Jouer, p4Vainqueur, p4CoupGagnant, p4CoupIA,
  PFC_CHOIX, pfcDuel,
  PENDU_ERREURS_MAX, penduNormaliser, penduMasque, penduTrouve, penduContient, penduDessin,
  nombreEssaisMax,
  BJ_RANGS, BJ_COULEURS, bjSabot, bjValeur, bjBlackjack, bjCroupier, bjIssue, bjGain,
  DEMINEUR_TAILLES, demineurGrille, demineurVoisins, demineurTexte,
  QUIZ_MAX_REPONSE, quizDefauts,
};
