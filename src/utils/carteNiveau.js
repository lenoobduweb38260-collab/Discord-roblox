// 📊 Carte de rang de /niveau voir, dessinée en PNG.
//
// Même moteur que les images de /lc et /mariage (src/utils/imageAmour.js) :
// JavaScript pur, aucune dépendance, rendu vérifiable dans les tests. Ici
// aussi, `planCarteNiveau` dit QUOI dessiner (pur), `dessinerCarteNiveau`
// fait le rendu et rend un Buffer PNG.
//
// La police pixel du moteur ne connaît ni « / », ni « # », ni « : » : on les
// ajoute ICI, sans toucher à la police partagée.

const IMG = require('./imageAmour');

const LARGEUR_CARTE = 900;
const HAUTEUR_CARTE = 300;

const GLYPHES = {
  ...IMG.POLICE,
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
};
const AVANCE = 6; // 5 colonnes + 1 d'espace
const HAUT_GLYPHE = 7;

// ASCII majuscule, le reste retiré : « Émilie✨ » devient « EMILIE ».
function texteCarteNiveau(brut) {
  return String(brut ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split('')
    .filter((c) => GLYPHES[c])
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
const largeurCarteTexte = (t, echelle) => Math.max(0, t.length * AVANCE * echelle - echelle);
function couperCarteTexte(t, echelle, largeurMax) {
  const max = Math.max(1, Math.floor((largeurMax + echelle) / (AVANCE * echelle)));
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 2))}..`;
}

const rgb = (h) => {
  const n = typeof h === 'number' ? h : parseInt(String(h || '').replace('#', ''), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const versHexa = (c) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const fondu = (a, b, t) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * Math.min(1, Math.max(0, t)));

function planCarteNiveau({ pseudo, niveau = 0, rang = null, courant = 0, requis = 1, total = 0, plafond = false, accent = 0x5865f2 } = {}) {
  const c = rgb(accent);
  const progression = plafond ? 1 : Math.max(0, Math.min(1, requis > 0 ? courant / requis : 0));
  const nom = couperCarteTexte(texteCarteNiveau(pseudo) || 'MEMBRE', 5, 540);
  const nombre = (n) => String(Math.max(0, Math.round(Number(n) || 0)));
  return {
    largeur: LARGEUR_CARTE,
    hauteur: HAUTEUR_CARTE,
    accent: versHexa(c),
    fond: [versHexa(fondu([18, 20, 32], c, 0.12)), versHexa(fondu([10, 10, 18], c, 0.45))],
    avatar: { x: 150, y: 150, rayon: 95, initiale: nom[0] || '?' },
    nom,
    entete: `${rang ? `RANG #${rang}   ` : ''}NIVEAU ${niveau}`,
    rangTexte: rang ? `RANG #${rang}` : '',
    niveauTexte: `NIVEAU ${niveau}`,
    progression,
    jauge: { x: 280, y: 196, largeur: 580, hauteur: 34 },
    compteur: plafond ? 'NIVEAU MAXIMUM' : `${nombre(courant)} / ${nombre(requis)} XP`,
    total: `TOTAL ${nombre(total)} XP`,
  };
}

// Écrit avec la police étendue, alignée à gauche, au centre ou à droite.
function ecrireCarte(toile, contenu, x, y, echelle, couleur, { align = 'gauche', ombre = true } = {}) {
  const t = texteCarteNiveau(contenu);
  const c = typeof couleur === 'string' ? rgb(couleur) : couleur;
  const l = largeurCarteTexte(t, echelle);
  const depart = align === 'droite' ? x - l : align === 'centre' ? Math.round(x - l / 2) : x;
  const tracer = (dx, dy, teinte, opacite) => {
    for (let n = 0; n < t.length; n++) {
      const g = GLYPHES[t[n]];
      for (let gy = 0; gy < HAUT_GLYPHE; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          if (g[gy][gx] !== '#') continue;
          const bx = depart + dx + (n * AVANCE + gx) * echelle;
          const by = y + dy + gy * echelle;
          for (let py = 0; py < echelle; py++) {
            for (let px = 0; px < echelle; px++) toile.poser(bx + px, by + py, teinte, opacite);
          }
        }
      }
    }
  };
  if (ombre) {
    const d = Math.max(1, Math.round(echelle / 3));
    tracer(d, d, [0, 0, 0], 0.45);
  }
  tracer(0, 0, c, 1);
  return t;
}

// Une image de fond couvrant toute la carte (recadrage « cover »).
function couvrirCarte(toile, image) {
  const echelle = Math.max(toile.largeur / image.largeur, toile.hauteur / image.hauteur);
  const ox = (image.largeur * echelle - toile.largeur) / 2;
  const oy = (image.hauteur * echelle - toile.hauteur) / 2;
  for (let y = 0; y < toile.hauteur; y++) {
    const sy = Math.min(image.hauteur - 1, Math.floor((y + oy) / echelle));
    for (let x = 0; x < toile.largeur; x++) {
      const sx = Math.min(image.largeur - 1, Math.floor((x + ox) / echelle));
      const i = (sy * image.largeur + sx) * 4;
      toile.poser(x, y, [image.rgba[i], image.rgba[i + 1], image.rgba[i + 2]], image.rgba[i + 3] / 255);
    }
  }
}

function dessinerCarteNiveau(plan, avatar = null, fondImage = null) {
  const toile = new IMG.Toile(plan.largeur, plan.hauteur);
  toile.degrade(plan.fond[0], plan.fond[1]);
  if (fondImage?.rgba) {
    couvrirCarte(toile, fondImage);
    // Un voile sombre : le texte reste lisible sur n'importe quelle image.
    for (let y = 0; y < toile.hauteur; y++) for (let x = 0; x < toile.largeur; x++) toile.poser(x, y, [8, 10, 18], 0.55);
  }
  const accent = rgb(plan.accent);
  const clair = fondu(accent, [255, 255, 255], 0.35);

  // Avatar : ombre, liseré à la couleur du serveur, photo ou initiale.
  const a = plan.avatar;
  toile.disque(a.x + 4, a.y + 6, a.rayon + 9, [0, 0, 0], 0.35);
  toile.disque(a.x, a.y, a.rayon + 7, accent);
  if (avatar?.rgba) toile.avatarRond(avatar, a.x, a.y, a.rayon);
  else {
    toile.disque(a.x, a.y, a.rayon, fondu(accent, [20, 20, 30], 0.55));
    ecrireCarte(toile, a.initiale, a.x, a.y - Math.round((HAUT_GLYPHE * 10) / 2), 10, '#ffffff', { align: 'centre' });
  }

  // En tête à droite : le niveau à la couleur du serveur, le rang à sa gauche.
  const droite = plan.largeur - 40;
  const niveauEcrit = ecrireCarte(toile, plan.niveauTexte, droite, 36, 4, clair, { align: 'droite' });
  if (plan.rangTexte) {
    ecrireCarte(toile, plan.rangTexte, droite - largeurCarteTexte(niveauEcrit, 4) - 36, 36, 4, '#e8e8f0', { align: 'droite' });
  }
  ecrireCarte(toile, plan.nom, plan.jauge.x, 120, 5, '#ffffff');

  // Jauge : piste claire, remplissage à la couleur du serveur.
  const j = plan.jauge;
  toile.barre(j.x, j.y, j.largeur, j.hauteur, () => [255, 255, 255], 0.18);
  if (plan.progression > 0) {
    toile.barre(j.x, j.y, Math.max(j.hauteur, j.largeur * plan.progression), j.hauteur, (t) => fondu(accent, clair, t), 1);
  }
  ecrireCarte(toile, plan.compteur, j.x + j.largeur, j.y + j.hauteur + 16, 3, '#e8e8f0', { align: 'droite' });
  ecrireCarte(toile, plan.total, j.x, j.y + j.hauteur + 16, 3, '#b8bccc');
  return toile.png();
}

// Une image PNG en ligne : null si quoi que ce soit échoue (réseau, format).
async function telechargerPngNiveau(url, delai = 2500) {
  if (!/^https:\/\//i.test(String(url || ''))) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(delai) });
    if (!res.ok) return null;
    return IMG.decoderPng(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

// Rendu complet. Rend { png, fondLu } — png vaut null en cas d'échec :
// l'appelant envoie alors sa carte sans image, jamais rien du tout.
async function fabriquerCarteNiveau(plan, user = null, fondUrl = null) {
  try {
    let urlAvatar = null;
    try {
      urlAvatar = user?.displayAvatarURL?.({ extension: 'png', size: 256, forceStatic: true }) || null;
    } catch {}
    const [avatar, fond] = await Promise.all([telechargerPngNiveau(urlAvatar), fondUrl ? telechargerPngNiveau(fondUrl) : null]);
    return { png: dessinerCarteNiveau(plan, avatar, fond), fondLu: Boolean(fond) };
  } catch (err) {
    console.warn(`⚠️ Carte de niveau non générée : ${err.message}`);
    return { png: null, fondLu: false };
  }
}

module.exports = {
  planCarteNiveau, dessinerCarteNiveau, fabriquerCarteNiveau, telechargerPngNiveau, texteCarteNiveau,
  LARGEUR_CARTE, HAUTEUR_CARTE,
};
