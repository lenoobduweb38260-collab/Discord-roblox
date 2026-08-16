const { assainirTexte, tronquerPour } = require('./welcomeBanner');

// 🪪 Documents RP dessinés par le bot — carte d'identité et permis.
//
// Un embed Discord ne peut pas ressembler à un document officiel : sa mise en
// forme est imposée. La seule façon d'obtenir une vraie carte, avec bandeaux,
// colonnes et photo intégrée, est de DESSINER une image.
//
// ⚠️ Choix assumé : ce sont des documents de ROLEPLAY. Ils reprennent la
// structure d'une pièce officielle (bandeau, photo, champs, bande de bas de
// carte) mais portent la mention « DOCUMENT RP — SANS VALEUR LEGALE » et le
// nom du serveur. Il ne s'agit pas de reproduire une pièce d'identité réelle :
// une copie fidèle d'une carte nationale d'identité ou d'un permis officiel
// serait un faux document, ce que ce bot n'a pas à fabriquer.

const LARGEUR = 1000;
const HAUTEUR = 630;          // proportions d'une carte au format ID-1
const MARGE = 34;

const THEMES = {
  identite: {
    fond: '#eef1f7',
    bandeau: '#1b3a8f',
    texteBandeau: '#ffffff',
    accent: '#1b3a8f',
    encre: '#111827',
    discret: '#5b6478',
    titre: "CARTE D'IDENTITE RP",
  },
  permis: {
    fond: '#fdeef2',
    bandeau: '#a8264f',
    texteBandeau: '#ffffff',
    accent: '#a8264f',
    encre: '#111827',
    discret: '#6b5560',
    titre: 'PERMIS DE CONDUIRE RP',
  },
};

// Les polices de jimp n'existent qu'en tailles fixes.
const TAILLES = [8, 16, 32, 64, 128];
function tailleValide(souhaitee) {
  return TAILLES.reduce((a, b) => (Math.abs(b - souhaitee) < Math.abs(a - souhaitee) ? b : a));
}

// Un champ = un intitulé discret au-dessus d'une valeur lisible.
function champ(label, valeur, x, y, largeur) {
  const v = assainirTexte(valeur) || '-';
  return [
    { texte: assainirTexte(label).toUpperCase(), taille: 16, x, y, ton: 'discret' },
    { texte: tronquerPour(v, 32, largeur), taille: 32, x, y: y + 20, ton: 'encre' },
  ];
}

// 📐 Plan du document : QUOI dessiner et OÙ. Aucune dépendance graphique,
// donc vérifiable sans jimp.
function planDocument(type, donnees = {}) {
  const theme = THEMES[type] || THEMES.identite;
  const hauteurBandeau = 92;
  const photo = { x: MARGE, y: hauteurBandeau + 30, largeur: 240, hauteur: 300 };
  const colonneX = photo.x + photo.largeur + 34;
  const largeurColonne = LARGEUR - colonneX - MARGE;
  const demiColonne = Math.floor(largeurColonne / 2) - 12;

  const textes = [
    { texte: assainirTexte(donnees.serveur) || 'SERVEUR RP', taille: 16, x: MARGE, y: 22, ton: 'bandeau' },
    { texte: donnees.titre || theme.titre, taille: 32, x: MARGE, y: 44, ton: 'bandeau' },
  ];

  // Deux colonnes de champs, empilées.
  let y = photo.y;
  const lignes = donnees.champs || [];
  for (let i = 0; i < lignes.length; i += 2) {
    const gauche = lignes[i];
    const droite = lignes[i + 1];
    if (gauche) textes.push(...champ(gauche[0], gauche[1], colonneX, y, droite ? demiColonne : largeurColonne));
    if (droite) textes.push(...champ(droite[0], droite[1], colonneX + demiColonne + 24, y, demiColonne));
    y += 72;
  }

  // Bas de carte : numéro du document + mention RP.
  const basY = HAUTEUR - MARGE - 44;
  textes.push({ texte: assainirTexte(donnees.numero) || '', taille: 32, x: MARGE, y: basY, ton: 'accent' });
  textes.push({
    texte: 'DOCUMENT RP - SANS VALEUR LEGALE',
    taille: 16,
    x: LARGEUR - MARGE,
    y: basY + 14,
    ton: 'discret',
    alignerDroite: true,
  });

  return {
    largeur: LARGEUR,
    hauteur: HAUTEUR,
    theme,
    bandeau: { x: 0, y: 0, largeur: LARGEUR, hauteur: hauteurBandeau },
    photo,
    // Filet de séparation au-dessus du bas de carte.
    filet: { x: MARGE, y: basY - 18, largeur: LARGEUR - MARGE * 2, hauteur: 2 },
    textes: textes
      .filter((t) => t.texte)
      .map((t) => ({ ...t, taille: tailleValide(t.taille) })),
  };
}

// Le document imprimé porte le nom du jeu du serveur : sur Arma ce n'est pas
// une carte d'identité mais un livret matricule. Le gabarit, lui, ne change
// pas — seuls les intitulés sont réécrits.
//
// ⚠️ Ces textes partent dans une image, pas dans un message : les polices de
// jimp n'ont pas d'accents. On retire donc les accents ici, comme le reste du
// fichier le fait déjà.
const sansAccent = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Champs d'une carte d'identité RP.
function planCarte(card, extra = {}) {
  const T = extra.theme || null;
  return planDocument('identite', {
    serveur: extra.serveur,
    titre: T ? `${sansAccent(T.carte.titre).toUpperCase()} RP` : undefined,
    numero: card.card_id ? `N° ${card.card_id}` : '',
    champs: [
      ['Nom', card.rp_nom],
      ['Prenom', card.rp_prenom],
      ['Ne(e) le', card.date_naissance],
      [T ? sansAccent(T.carte.lieu) : 'A', card.lieu_naissance],
      ['Sexe', card.sexe],
      [T ? sansAccent(T.carte.nationalite) : 'Nationalite', card.nationalite],
      [T ? sansAccent(T.compte.label) : 'Pseudo Roblox', card.pseudo_roblox],
      ['Identifiant Discord', card.user_id],
    ],
  });
}

// Champs d'un permis RP.
function planPermis(permit, extra = {}) {
  const valide = permit.valid === 1;
  const T = extra.theme || null;
  return planDocument('permis', {
    serveur: extra.serveur,
    titre: T ? `${sansAccent(T.permis.titre).toUpperCase()} RP` : undefined,
    numero: permit.permit_number ? `N° ${permit.permit_number}` : '',
    champs: [
      [T ? sansAccent(T.permis.titulaire) : 'Titulaire', extra.titulaire || ''],
      ['Statut', valide ? 'VALIDE' : 'INVALIDE'],
      [T ? sansAccent(T.permis.points) : 'Points', `${permit.points}/12`],
      ['Delivre le', extra.delivre || ''],
      ['Categories', extra.categories || 'B'],
      ['Autorite', extra.serveur || ''],
    ],
  });
}

// 🎨 Rendu réel. Renvoie un Buffer PNG, ou null si jimp manque ou échoue —
// dans ce cas la commande retombe sur l'embed classique.
async function fabriquer(plan, options = {}) {
  let Jimp;
  try {
    Jimp = require('jimp');
  } catch {
    console.warn('⚠️ Document RP : jimp indisponible, image ignorée.');
    return null;
  }

  try {
    const t = plan.theme;
    const image = new Jimp(plan.largeur, plan.hauteur, `${t.fond}ff`);

    // Bandeau de titre.
    const bandeau = new Jimp(plan.bandeau.largeur, plan.bandeau.hauteur, `${t.bandeau}ff`);
    image.composite(bandeau, plan.bandeau.x, plan.bandeau.y);

    // Filet au-dessus du bas de carte.
    const filet = new Jimp(plan.filet.largeur, plan.filet.hauteur, `${t.accent}55`);
    image.composite(filet, plan.filet.x, plan.filet.y);

    // Photo : cadre puis image recadrée dedans.
    const cadre = new Jimp(plan.photo.largeur + 6, plan.photo.hauteur + 6, `${t.accent}ff`);
    image.composite(cadre, plan.photo.x - 3, plan.photo.y - 3);
    if (options.photoUrl) {
      const photo = await Jimp.read(options.photoUrl).catch(() => null);
      if (photo) {
        photo.cover(plan.photo.largeur, plan.photo.hauteur);
        image.composite(photo, plan.photo.x, plan.photo.y);
      }
    }

    for (const texte of plan.textes) {
      const clair = texte.ton === 'bandeau';
      const font = await police(Jimp, texte.taille, clair);
      if (!font) continue;
      const x = texte.alignerDroite ? texte.x - Jimp.measureText(font, texte.texte) : texte.x;
      image.print(font, x, texte.y, texte.texte);
    }

    return await image.getBufferAsync(Jimp.MIME_PNG);
  } catch (err) {
    console.warn(`⚠️ Document RP non généré : ${err.message}`);
    return null;
  }
}

// jimp ne fournit que du noir et du blanc : le texte sur bandeau est blanc,
// le reste noir. Les tons « discret » et « accent » retombent sur le noir.
const _polices = new Map();
async function police(Jimp, taille, clair) {
  const cle = `${taille}:${clair ? 'b' : 'n'}`;
  if (_polices.has(cle)) return _polices.get(cle);
  const nom = `FONT_SANS_${taille}_${clair ? 'WHITE' : 'BLACK'}`;
  const font = await Jimp.loadFont(Jimp[nom]).catch(() => null);
  _polices.set(cle, font);
  return font;
}

module.exports = { planDocument, planCarte, planPermis, fabriquer, THEMES, LARGEUR, HAUTEUR, tailleValide };
