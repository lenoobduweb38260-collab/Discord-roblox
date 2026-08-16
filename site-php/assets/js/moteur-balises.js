// 🏷️ Balises de mise en forme — composer une belle carte sans rien connaître.
//
// Écrire une carte soignée demandait jusqu'ici de connaître la grammaire du
// projet : le filet, le ◆ des sections, le ➜ des entrées. Personne n'a envie
// de retenir ça pour écrire un message d'accueil.
//
// On tape donc des balises courtes, et le bot fabrique la mise en forme :
//
//   Bienvenue sur le serveur !          Bienvenue sur le serveur !
//   &&                          ───►    ────────────────
//   && Pour commencer                   ◆ **Pour commencer**
//   &> Lis le règlement                 ➜ Lis le règlement
//   &> Choisis tes rôles                ➜ Choisis tes rôles
//
// En mode carte, chaque barre devient un VRAI séparateur tracé par Discord,
// à la largeur exacte de la carte — parce qu'on écrit ici le même filet que
// `cartes.js` sait reconnaître. Une seule mécanique, les deux rendus.
//
// ⚠️ Deux précautions qui évitent les dégâts :
//  • une balise n'est reconnue qu'en DÉBUT DE LIGNE. Sans cela, un preset
//    contenant `if (a && b)` verrait son code coupé en deux ;
//  • rien n'est touché à l'intérieur d'un bloc de code ``` ```.

// ⚠️ Volontairement AUTONOME : ce fichier tourne aussi dans le navigateur, où
// « require » n'existe pas. Les trois constantes ci-dessous doivent rester
// identiques à celles de miseEnPage — un test le vérifie à chaque exécution,
// pour que la règle ne dépende pas de la vigilance de qui relit.
const BARRE = '─'.repeat(16);
const PUCE = '◆';
const FLECHE = '➜';
const M = {
  entete: (titre) => `${PUCE} **${titre}**`,
  entree: (texte) => `${FLECHE} ${texte}`,
};

// Table des balises, telle qu'elle est montrée à l'utilisateur.
const AIDE = [
  ['&&', 'une barre de séparation'],
  ['&& Titre', 'une barre puis un titre de section ◆'],
  ['&&&', 'une barre avec plus d\'air autour'],
  ['&> Texte', 'une entrée de liste ➜'],
  ['\\n', 'un retour à la ligne'],
];

// Une ligne ouvre-t-elle ou ferme-t-elle un bloc de code ?
const bascule = (ligne) => /^\s*```/.test(ligne);

// 🖋️ Applique les balises à un texte.
//
// `appliquer` est volontairement tolérant : un texte sans aucune balise
// ressort identique, aux « \n » près. Aucune raison de se demander s'il faut
// l'appeler ou non — on l'appelle partout où quelqu'un écrit.
function appliquer(texte) {
  if (texte === null || texte === undefined) return texte;
  // « \n » tapé au clavier (deux caractères) → un vrai retour à la ligne.
  const source = String(texte).replace(/\\n/g, '\n');
  if (!source.includes('&')) return source;

  const sortie = [];
  let dansCode = false;

  for (const ligne of source.split('\n')) {
    if (bascule(ligne)) {
      dansCode = !dansCode;
      sortie.push(ligne);
      continue;
    }
    if (dansCode) {
      sortie.push(ligne);
      continue;
    }

    // && & suivants : la plus longue balise d'abord, sinon « &&& » serait lu
    // comme « && » suivi d'un « & » orphelin.
    const grande = /^\s*&&&\s*(.*)$/.exec(ligne);
    if (grande) {
      sortie.push('', BARRE, '');
      if (grande[1].trim()) sortie.push(M.entete(grande[1].trim()));
      continue;
    }
    const barre = /^\s*&&\s*(.*)$/.exec(ligne);
    if (barre) {
      sortie.push(BARRE);
      if (barre[1].trim()) sortie.push(M.entete(barre[1].trim()));
      continue;
    }
    const entree = /^\s*&>\s*(.*)$/.exec(ligne);
    if (entree) {
      // Une entrée vide n'a rien à afficher : on n'écrit pas une flèche seule.
      if (entree[1].trim()) sortie.push(M.entree(entree[1].trim()));
      continue;
    }
    sortie.push(ligne);
  }

  // Une barre en tête ou en queue n'a rien à séparer, et deux barres
  // consécutives font un pâté.
  return nettoyer(sortie).join('\n');
}

// Retire les barres qui ne séparent rien : en tête, en queue, ou en double.
function nettoyer(lignes) {
  const estBarre = (l) => /^\s*─{3,}\s*$/.test(String(l ?? ''));
  const vide = (l) => !String(l ?? '').trim();
  const out = [];
  for (const l of lignes) {
    if (estBarre(l)) {
      // On remonte les lignes vides pour voir ce qui précède vraiment.
      let i = out.length - 1;
      while (i >= 0 && vide(out[i])) i--;
      if (i < 0) continue; // rien avant : la barre ne sépare rien
      if (estBarre(out[i])) continue; // barre déjà posée juste avant
    }
    out.push(l);
  }
  while (out.length && (estBarre(out[out.length - 1]) || vide(out[out.length - 1]))) out.pop();
  return out;
}

// Un exemple prêt à coller, pour les aides et les aperçus.
const EXEMPLE = [
  'Bienvenue sur le serveur !',
  '&& Pour commencer',
  '&> Lis le règlement',
  '&> Choisis tes rôles',
  '&&',
  'Bon jeu à toi.',
].join('\n');

// Utilisable des deux côtés : module Node, ou variable globale du navigateur.
// ⚠️ Bloc fermé, et non des déclarations racine : dans un navigateur, les
// trois moteurs partagent la même portée globale. Trois « const API » au
// premier niveau se seraient écrasés — et la page ne se chargeait plus.
{
  const API = { appliquer, AIDE, EXEMPLE, BARRE, PUCE, FLECHE };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else if (typeof globalThis !== 'undefined') globalThis.Balises = API;
}
