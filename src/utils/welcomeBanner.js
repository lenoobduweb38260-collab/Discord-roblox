// 🖼️ Bannière d'arrivée générée par le bot.
//
// Discord ne permet pas de changer la police d'un embed : les bannières
// stylées qu'on voit ailleurs sont des IMAGES fabriquées par le bot. C'est ce
// que fait ce module, avec jimp.
//
// ⚠️ Limite assumée : jimp n'embarque que des polices bitmap ASCII, en tailles
// fixes (8, 16, 32, 64, 128). Un pseudo contenant des accents, du japonais ou
// des emojis sortirait en « □□□□ » — c'est exactement le défaut visible sur les
// bannières d'autres bots. On assainit donc le texte AVANT de le dessiner, et
// on retombe sur un texte lisible plutôt que sur des carrés.

const TAILLES = [8, 16, 32, 64, 128];

// Transforme un pseudo en quelque chose que la police sait réellement écrire.
// « Émilie✨ » → « Emilie », « 日本語 » → '' (puis repli sur autre chose).
function assainirTexte(brut) {
  const sansAccents = String(brut || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');   // é → e, à → a…
  return sansAccents
    .replace(/[^\x20-\x7E]/g, '')       // tout ce que la police ne sait pas tracer
    .replace(/\s+/g, ' ')
    .trim();
}

// Nom à afficher : le pseudo assaini, sinon le nom d'utilisateur, sinon un
// repli neutre. Jamais de carrés, jamais de vide.
function nomAffichable(membre) {
  const candidats = [membre?.displayName, membre?.user?.globalName, membre?.user?.username];
  for (const c of candidats) {
    const propre = assainirTexte(c);
    if (propre) return propre;
  }
  return 'Nouveau membre';
}

// Coupe un texte pour qu'il tienne dans la largeur disponible.
// La largeur d'un caractère vaut environ 0,5 × la taille de la police pour ces
// polices bitmap : approximation volontairement prudente.
function tronquerPour(texte, taillePolice, largeurDispo) {
  const parCar = taillePolice * 0.5;
  const max = Math.max(1, Math.floor(largeurDispo / parCar));
  if (texte.length <= max) return texte;
  return `${texte.slice(0, Math.max(1, max - 1))}…`.replace('…', '...');
}

// Choisit la plus grande police disponible qui laisse le texte tenir.
function tailleQuiTient(texte, largeurDispo, maxSouhaite = 64) {
  const possibles = TAILLES.filter((t) => t <= maxSouhaite);
  for (let i = possibles.length - 1; i >= 0; i--) {
    if (texte.length * possibles[i] * 0.5 <= largeurDispo) return possibles[i];
  }
  return possibles[0] || 8;
}

// 📐 Plan de la bannière : QUOI dessiner et OÙ, sans rien dessiner.
// Séparé du rendu pour être vérifiable sans jimp.
function planBanniere(options = {}) {
  const L = options.largeur || 1000;
  const H = options.hauteur || 300;
  const marge = 50;
  const tailleAvatar = Math.min(190, H - marge * 2);
  const avatarX = marge;
  const avatarY = Math.round((H - tailleAvatar) / 2);
  const texteX = avatarX + tailleAvatar + 40;
  const largeurTexte = L - texteX - marge;

  const nom = tronquerPour(options.nom || 'Nouveau membre', 64, largeurTexte);
  const tailleNom = tailleQuiTient(nom, largeurTexte, 64);
  const sousTitre = tronquerPour(options.sousTitre || '', 16, largeurTexte);
  const serveur = tronquerPour(options.serveur || '', 16, L - marge * 2);

  return {
    largeur: L,
    hauteur: H,
    fond: options.fond || '#1b1b2f',
    avatar: { x: avatarX, y: avatarY, taille: tailleAvatar, rond: options.avatarRond !== false },
    textes: [
      { cle: 'accroche', texte: options.accroche || 'Bienvenue !', taille: 32, x: texteX, y: avatarY + 6 },
      { cle: 'nom', texte: nom, taille: tailleNom, x: texteX, y: avatarY + 48 },
      { cle: 'sousTitre', texte: sousTitre, taille: 16, x: texteX, y: avatarY + 48 + tailleNom + 12 },
      { cle: 'serveur', texte: serveur, taille: 16, x: L - marge, y: H - marge + 10, alignerDroite: true },
    ].filter((t) => t.texte),
  };
}

// 🎨 Rendu réel. Renvoie un Buffer PNG, ou null si quoi que ce soit manque —
// l'embed d'arrivée doit partir même sans bannière.
async function fabriquer(membre, options = {}) {
  let Jimp;
  try {
    Jimp = require('jimp');
  } catch {
    console.warn('⚠️ Bannière d\'arrivée : jimp indisponible, bannière ignorée.');
    return null;
  }

  const plan = planBanniere({
    ...options,
    nom: nomAffichable(membre),
    serveur: assainirTexte(membre?.guild?.name),
    sousTitre: options.sousTitre != null
      ? assainirTexte(options.sousTitre)
      : `Membre n${'°'}${membre?.guild?.memberCount ?? ''}`,
    accroche: assainirTexte(options.accroche) || 'Bienvenue !',
  });

  try {
    const couleur = /^#[0-9a-f]{6}$/i.test(plan.fond) ? plan.fond : '#1b1b2f';
    const image = new Jimp(plan.largeur, plan.hauteur, `${couleur}ff`);

    // Fond personnalisé : recadré pour couvrir toute la bannière.
    if (options.fondImage) {
      const fond = await Jimp.read(options.fondImage).catch(() => null);
      if (fond) {
        fond.cover(plan.largeur, plan.hauteur);
        image.composite(fond, 0, 0);
      }
    }

    // Photo de profil, en rond.
    if (options.avatarUrl) {
      const avatar = await Jimp.read(options.avatarUrl).catch(() => null);
      if (avatar) {
        avatar.cover(plan.avatar.taille, plan.avatar.taille);
        if (plan.avatar.rond && typeof avatar.circle === 'function') avatar.circle();
        image.composite(avatar, plan.avatar.x, plan.avatar.y);
      }
    }

    // Textes. Les polices sont chargées à la demande et mises en cache.
    for (const t of plan.textes) {
      const font = await policeBlanche(Jimp, t.taille);
      if (!font) continue;
      const x = t.alignerDroite ? t.x - Jimp.measureText(font, t.texte) : t.x;
      image.print(font, x, t.y, t.texte);
    }

    return await image.getBufferAsync(Jimp.MIME_PNG);
  } catch (err) {
    console.warn(`⚠️ Bannière d'arrivée non générée : ${err.message}`);
    return null;
  }
}

const _polices = new Map();
async function policeBlanche(Jimp, taille) {
  const t = TAILLES.includes(taille) ? taille : 16;
  if (_polices.has(t)) return _polices.get(t);
  const font = await Jimp.loadFont(Jimp[`FONT_SANS_${t}_WHITE`]).catch(() => null);
  _polices.set(t, font);
  return font;
}

module.exports = { assainirTexte, nomAffichable, tronquerPour, tailleQuiTient, planBanniere, fabriquer, TAILLES };
