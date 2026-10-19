// 💘 Images du calculateur d'amour (/lc) et du mariage (/mariage).
//
// Dessinées ICI, en JavaScript pur, sans jimp :
//  • les polices de jimp ne sont pas embarquées dans l'exécutable (elles sont
//    lues sur disque par un chemin calculé) — le pourcentage, qui EST l'image,
//    disparaîtrait sans bruit sur l'hébergement ;
//  • le rendu tourne aussi dans les tests (zlib est natif) : on vérifie de
//    vrais pixels au lieu de croire sur parole.
//
// Le texte utilise une petite police pixel 5×7 (chiffres, lettres A-Z, signes
// courants), agrandie par blocs. Les pseudos sont ramenés à l'ASCII majuscule :
// « Émilie✨ » devient « EMILIE » — jamais de carrés vides.
//
// Séparation habituelle du projet : `planAmour` / `planMariage` disent QUOI
// dessiner (pur, testable), `dessiner` fait le rendu et rend un Buffer PNG.

const zlib = require('zlib');

// ── PNG : encodage et décodage minimal ──────────────────────────────────

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TABLE_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function bloc(type, donnees) {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length);
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corps));
  return Buffer.concat([longueur, corps, crc]);
}

function encoderPng(largeur, hauteur, rgba) {
  const ligne = largeur * 4;
  const brut = Buffer.alloc((ligne + 1) * hauteur);
  for (let y = 0; y < hauteur; y++) {
    brut[y * (ligne + 1)] = 0; // filtre « aucun »
    Buffer.from(rgba.buffer, rgba.byteOffset + y * ligne, ligne).copy(brut, y * (ligne + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    SIGNATURE,
    bloc('IHDR', ihdr),
    bloc('IDAT', zlib.deflateSync(brut, { level: 9 })),
    bloc('IEND', Buffer.alloc(0)),
  ]);
}

// Décode un PNG 8 bits non entrelacé (ce que sert le CDN de Discord pour un
// avatar demandé en `.png`). Rend { largeur, hauteur, rgba } ou null.
function decoderPng(buf) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(SIGNATURE)) return null;
    let pos = 8;
    let largeur = 0, hauteur = 0, profondeur = 0, type = 0, entrelace = 0;
    let palette = null, transparence = null;
    const idat = [];
    while (pos + 8 <= buf.length) {
      const longueur = buf.readUInt32BE(pos);
      const nom = buf.toString('ascii', pos + 4, pos + 8);
      const donnees = buf.subarray(pos + 8, pos + 8 + longueur);
      if (nom === 'IHDR') {
        largeur = donnees.readUInt32BE(0);
        hauteur = donnees.readUInt32BE(4);
        profondeur = donnees[8];
        type = donnees[9];
        entrelace = donnees[12];
      } else if (nom === 'PLTE') palette = donnees;
      else if (nom === 'tRNS') transparence = donnees;
      else if (nom === 'IDAT') idat.push(donnees);
      else if (nom === 'IEND') break;
      pos += 12 + longueur;
    }
    if (!largeur || !hauteur || profondeur !== 8 || entrelace || largeur * hauteur > 4096 * 4096) return null;
    const canaux = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
    if (!canaux) return null;
    const donnees = zlib.inflateSync(Buffer.concat(idat));
    const ligne = largeur * canaux;
    const pixels = Buffer.alloc(ligne * hauteur);
    let precedente = Buffer.alloc(ligne);
    for (let y = 0; y < hauteur; y++) {
      const debut = y * (ligne + 1);
      const filtre = donnees[debut];
      const courante = Buffer.from(donnees.subarray(debut + 1, debut + 1 + ligne));
      for (let i = 0; i < ligne; i++) {
        const a = i >= canaux ? courante[i - canaux] : 0;
        const b = precedente[i];
        const c = i >= canaux ? precedente[i - canaux] : 0;
        let ajout = 0;
        if (filtre === 1) ajout = a;
        else if (filtre === 2) ajout = b;
        else if (filtre === 3) ajout = (a + b) >> 1;
        else if (filtre === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          ajout = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        courante[i] = (courante[i] + ajout) & 0xff;
      }
      courante.copy(pixels, y * ligne);
      precedente = courante;
    }
    const rgba = Buffer.alloc(largeur * hauteur * 4);
    for (let i = 0, j = 0; i < largeur * hauteur; i++, j += canaux) {
      let r, g, b, a = 255;
      if (type === 6) { r = pixels[j]; g = pixels[j + 1]; b = pixels[j + 2]; a = pixels[j + 3]; }
      else if (type === 2) { r = pixels[j]; g = pixels[j + 1]; b = pixels[j + 2]; }
      else if (type === 0) { r = g = b = pixels[j]; }
      else if (type === 4) { r = g = b = pixels[j]; a = pixels[j + 1]; }
      else {
        const k = pixels[j];
        if (!palette || k * 3 + 2 >= palette.length) return null;
        r = palette[k * 3]; g = palette[k * 3 + 1]; b = palette[k * 3 + 2];
        if (transparence && k < transparence.length) a = transparence[k];
      }
      rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
    }
    return { largeur, hauteur, rgba };
  } catch {
    return null;
  }
}

// ── Police pixel 5×7 ────────────────────────────────────────────────────

const POLICE = {
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '%': ['##...', '##..#', '...#.', '..#..', '.#...', '#..##', '...##'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  _: ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
};
const LARGEUR_GLYPHE = 6; // 5 colonnes + 1 d'espace
const HAUTEUR_GLYPHE = 7;

// Le texte que la police sait écrire : ASCII majuscule, le reste retiré.
function texteDessinable(brut) {
  return String(brut || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split('')
    .filter((c) => POLICE[c])
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
const largeurTexte = (texte, echelle) => Math.max(0, texte.length * LARGEUR_GLYPHE * echelle - echelle);
function tronquer(texte, echelle, largeurMax) {
  const max = Math.max(1, Math.floor((largeurMax + echelle) / (LARGEUR_GLYPHE * echelle)));
  return texte.length <= max ? texte : `${texte.slice(0, Math.max(1, max - 2))}..`;
}

// ── Toile ───────────────────────────────────────────────────────────────

const hexa = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const melange = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * Math.min(1, Math.max(0, t))));

class Toile {
  constructor(largeur, hauteur) {
    this.largeur = largeur;
    this.hauteur = hauteur;
    this.rgba = Buffer.alloc(largeur * hauteur * 4);
  }

  // Pose une couleur avec une opacité (0..1), par-dessus ce qui est déjà là.
  poser(x, y, [r, g, b], opacite = 1) {
    if (x < 0 || y < 0 || x >= this.largeur || y >= this.hauteur || opacite <= 0) return;
    const i = (y * this.largeur + x) * 4;
    const a = Math.min(1, opacite);
    const d = this.rgba;
    const fondA = d[i + 3] / 255;
    const sortieA = a + fondA * (1 - a);
    if (sortieA <= 0) return;
    d[i] = Math.round((r * a + d[i] * fondA * (1 - a)) / sortieA);
    d[i + 1] = Math.round((g * a + d[i + 1] * fondA * (1 - a)) / sortieA);
    d[i + 2] = Math.round((b * a + d[i + 2] * fondA * (1 - a)) / sortieA);
    d[i + 3] = Math.round(sortieA * 255);
  }

  lire(x, y) {
    const i = (y * this.largeur + x) * 4;
    return [this.rgba[i], this.rgba[i + 1], this.rgba[i + 2], this.rgba[i + 3]];
  }

  // Dégradé en diagonale sur toute la toile.
  degrade(debut, fin) {
    const a = hexa(debut), b = hexa(fin);
    const total = this.largeur + this.hauteur;
    for (let y = 0; y < this.hauteur; y++) {
      for (let x = 0; x < this.largeur; x++) this.poser(x, y, melange(a, b, (x + y) / total));
    }
  }

  // Disque plein, bord adouci sur un pixel.
  disque(cx, cy, rayon, couleur, opacite = 1) {
    const c = typeof couleur === 'string' ? hexa(couleur) : couleur;
    for (let y = Math.floor(cy - rayon - 1); y <= Math.ceil(cy + rayon + 1); y++) {
      for (let x = Math.floor(cx - rayon - 1); x <= Math.ceil(cx + rayon + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const couverture = Math.min(1, Math.max(0, rayon - d + 0.5));
        if (couverture > 0) this.poser(x, y, c, opacite * couverture);
      }
    }
  }

  // Anneau (cercle épais) : alliance, liseré d'avatar.
  anneau(cx, cy, rayon, epaisseur, couleur, opacite = 1) {
    const c = typeof couleur === 'string' ? hexa(couleur) : couleur;
    for (let y = Math.floor(cy - rayon - 1); y <= Math.ceil(cy + rayon + 1); y++) {
      for (let x = Math.floor(cx - rayon - 1); x <= Math.ceil(cx + rayon + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const dehors = Math.min(1, Math.max(0, rayon - d + 0.5));
        const dedans = Math.min(1, Math.max(0, d - (rayon - epaisseur) + 0.5));
        const couverture = Math.min(dehors, dedans);
        if (couverture > 0) this.poser(x, y, c, opacite * couverture);
      }
    }
  }

  // Cœur plein. `teinteDe(y01)` donne la couleur selon la hauteur relative
  // (0 = pointe du bas, 1 = haut des lobes) — c'est ce qui fait la jauge.
  coeur(cx, cy, taille, teinteDe, opacite = 1) {
    const demi = taille / 2;
    const pas = [0.25, 0.75];
    for (let y = Math.floor(cy - demi * 1.1); y <= Math.ceil(cy + demi * 1.1); y++) {
      for (let x = Math.floor(cx - demi * 1.2); x <= Math.ceil(cx + demi * 1.2); x++) {
        let dedans = 0;
        for (const sy of pas) {
          for (const sx of pas) {
            const u = ((x + sx - cx) / demi) * 1.25;
            const v = (-(y + sy - cy) / demi) * 1.25 + 0.15;
            const t = u * u + v * v - 1;
            if (t * t * t - u * u * v * v * v <= 0) dedans++;
          }
        }
        if (!dedans) continue;
        const relatif = 1 - (y - (cy - demi)) / taille;
        const couleur = teinteDe(Math.min(1, Math.max(0, relatif)));
        if (couleur) this.poser(x, y, couleur, opacite * (dedans / 4));
      }
    }
  }

  // Rectangle aux bouts arrondis, rempli par `teinteDe(x01)`.
  barre(x, y, largeur, hauteur, teinteDe, opacite = 1) {
    const r = hauteur / 2;
    for (let py = Math.floor(y); py < Math.ceil(y + hauteur); py++) {
      for (let px = Math.floor(x); px < Math.ceil(x + largeur); px++) {
        const qx = Math.min(Math.max(px + 0.5, x + r), x + largeur - r);
        const d = Math.hypot(px + 0.5 - qx, py + 0.5 - (y + r));
        const couverture = Math.min(1, Math.max(0, r - d + 0.5));
        if (couverture <= 0) continue;
        const couleur = teinteDe((px - x) / largeur);
        if (couleur) this.poser(px, py, couleur, opacite * couverture);
      }
    }
  }

  // Colle une image décodée dans un disque (recadrage « cover », bilinéaire).
  avatarRond(image, cx, cy, rayon) {
    const cote = Math.min(image.largeur, image.hauteur);
    const ox = (image.largeur - cote) / 2;
    const oy = (image.hauteur - cote) / 2;
    const echelle = cote / (rayon * 2);
    const lirePixel = (sx, sy) => {
      const x0 = Math.max(0, Math.min(image.largeur - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(image.hauteur - 1, Math.floor(sy)));
      const x1 = Math.min(image.largeur - 1, x0 + 1);
      const y1 = Math.min(image.hauteur - 1, y0 + 1);
      const fx = sx - Math.floor(sx), fy = sy - Math.floor(sy);
      const p = (x, y) => (y * image.largeur + x) * 4;
      return [0, 1, 2, 3].map((k) => {
        const h = image.rgba[p(x0, y0) + k] * (1 - fx) + image.rgba[p(x1, y0) + k] * fx;
        const b = image.rgba[p(x0, y1) + k] * (1 - fx) + image.rgba[p(x1, y1) + k] * fx;
        return h * (1 - fy) + b * fy;
      });
    };
    for (let y = Math.floor(cy - rayon); y <= Math.ceil(cy + rayon); y++) {
      for (let x = Math.floor(cx - rayon); x <= Math.ceil(cx + rayon); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const couverture = Math.min(1, Math.max(0, rayon - d + 0.5));
        if (couverture <= 0) continue;
        const [r, g, b, a] = lirePixel(ox + (x - (cx - rayon)) * echelle, oy + (y - (cy - rayon)) * echelle);
        this.poser(x, y, [r, g, b], couverture * (a / 255));
      }
    }
  }

  // Texte en police pixel, agrandi `echelle` fois ; ombre portée facultative.
  texte(contenu, x, y, echelle, couleur, { centre = false, ombre = true, contour = 0 } = {}) {
    const t = texteDessinable(contenu);
    const c = typeof couleur === 'string' ? hexa(couleur) : couleur;
    const depart = centre ? Math.round(x - largeurTexte(t, echelle) / 2) : x;
    const dessiner = (dx, dy, teinte, opacite) => {
      for (let n = 0; n < t.length; n++) {
        const glyphe = POLICE[t[n]];
        if (!glyphe) continue;
        for (let gy = 0; gy < HAUTEUR_GLYPHE; gy++) {
          for (let gx = 0; gx < 5; gx++) {
            if (glyphe[gy][gx] !== '#') continue;
            const bx = depart + dx + (n * LARGEUR_GLYPHE + gx) * echelle;
            const by = y + dy + gy * echelle;
            for (let py = 0; py < echelle; py++) {
              for (let px = 0; px < echelle; px++) this.poser(bx + px, by + py, teinte, opacite);
            }
          }
        }
      }
    };
    if (contour) {
      // Liseré sombre tout autour : lisible sur n'importe quel fond.
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
        dessiner(dx * contour, dy * contour, [40, 8, 40], 0.5);
      }
    } else if (ombre) {
      dessiner(Math.max(1, Math.round(echelle / 3)), Math.max(1, Math.round(echelle / 3)), [20, 6, 30], 0.45);
    }
    dessiner(0, 0, c, 1);
    return t;
  }

  png() {
    return encoderPng(this.largeur, this.hauteur, this.rgba);
  }
}

// ── Plans ───────────────────────────────────────────────────────────────

const LARGEUR = 900;
const HAUTEUR = 360;

// Une teinte qui suit le score : froid quand c'est tiède, rouge passion à 100.
function teintes(pourcentage) {
  const p = Math.max(0, Math.min(100, Number(pourcentage) || 0));
  if (p < 25) return { haut: '#8e9aaf', bas: '#5c6784' };
  if (p < 50) return { haut: '#f4a261', bas: '#e76f51' };
  if (p < 75) return { haut: '#ff8fab', bas: '#fb6f92' };
  return { haut: '#ff4d6d', bas: '#c9184a' };
}

// Petits cœurs de fond, placés de façon stable (même score → même image).
function coeursDeFond(graine, nombre = 14) {
  let s = (Math.abs(graine) * 2654435761) >>> 0 || 1;
  const hasard = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
  return Array.from({ length: nombre }, () => ({
    x: Math.round(40 + hasard() * (LARGEUR - 80)),
    y: Math.round(25 + hasard() * (HAUTEUR - 50)),
    taille: Math.round(14 + hasard() * 26),
    opacite: 0.08 + hasard() * 0.12,
  }));
}

function planAmour({ pourcentage, nomA, nomB }) {
  const p = Math.max(0, Math.min(100, Math.round(Number(pourcentage) || 0)));
  const echelleNom = 3;
  const largeurNom = 230;
  return {
    type: 'amour',
    largeur: LARGEUR,
    hauteur: HAUTEUR,
    pourcentage: p,
    fond: ['#24123d', '#7a1f4f'],
    teintes: teintes(p),
    coeurs: coeursDeFond(p * 7 + 3),
    avatars: [
      { x: 150, y: 150, rayon: 92, nom: tronquer(texteDessinable(nomA) || 'MEMBRE', echelleNom, largeurNom) },
      { x: LARGEUR - 150, y: 150, rayon: 92, nom: tronquer(texteDessinable(nomB) || 'MEMBRE', echelleNom, largeurNom) },
    ],
    coeur: { x: LARGEUR / 2, y: 148, taille: 230 },
    texte: { contenu: `${p}%`, echelle: p === 100 ? 7 : 9 },
    echelleNom,
    jauge: { x: 120, y: 300, largeur: LARGEUR - 240, hauteur: 26 },
  };
}

function planMariage({ nomA, nomB, date }) {
  const echelleNom = 3;
  return {
    type: 'mariage',
    largeur: LARGEUR,
    hauteur: HAUTEUR,
    fond: ['#2b2140', '#9c6b3f'],
    coeurs: coeursDeFond(42, 18),
    avatars: [
      { x: 150, y: 150, rayon: 92, nom: tronquer(texteDessinable(nomA) || 'MEMBRE', echelleNom, 230) },
      { x: LARGEUR - 150, y: 150, rayon: 92, nom: tronquer(texteDessinable(nomB) || 'MEMBRE', echelleNom, 230) },
    ],
    alliances: { x: LARGEUR / 2, y: 150, rayon: 62, epaisseur: 15, ecart: 46 },
    texte: { contenu: texteDessinable(date || ''), echelle: 4 },
    echelleNom,
  };
}

// ── Rendu ───────────────────────────────────────────────────────────────

// Un avatar absent ou illisible : disque coloré avec l'initiale.
function avatarDeSecours(toile, a, couleur) {
  toile.disque(a.x, a.y, a.rayon, couleur);
  const initiale = (a.nom || '?')[0];
  toile.texte(initiale, a.x, a.y - Math.round((HAUTEUR_GLYPHE * 10) / 2), 10, '#ffffff', { centre: true });
}

function dessinerAvatars(toile, plan, images, liseré) {
  plan.avatars.forEach((a, i) => {
    toile.disque(a.x + 4, a.y + 6, a.rayon + 8, [10, 0, 20], 0.35); // ombre
    toile.disque(a.x, a.y, a.rayon + 7, liseré);
    const image = images?.[i];
    if (image?.rgba) toile.avatarRond(image, a.x, a.y, a.rayon);
    else avatarDeSecours(toile, a, i ? '#5a4fcf' : '#d64584');
    toile.texte(a.nom, a.x, a.y + a.rayon + 22, plan.echelleNom, '#ffffff', { centre: true });
  });
}

function dessiner(plan, images = []) {
  const toile = new Toile(plan.largeur, plan.hauteur);
  toile.degrade(plan.fond[0], plan.fond[1]);
  for (const c of plan.coeurs) toile.coeur(c.x, c.y, c.taille, () => [255, 255, 255], c.opacite);

  if (plan.type === 'amour') {
    const haut = hexa(plan.teintes.haut), bas = hexa(plan.teintes.bas);
    dessinerAvatars(toile, plan, images, '#ffffff');
    const { x, y, taille } = plan.coeur;
    const niveau = plan.pourcentage / 100;
    // Contour clair, fond sombre, puis remplissage jusqu'au niveau du score.
    toile.coeur(x, y, taille + 18, () => [255, 255, 255], 0.9);
    toile.coeur(x, y, taille, () => [40, 16, 52], 1);
    toile.coeur(x, y, taille, (h) => (h <= niveau ? melange(bas, haut, h) : null), 1);
    toile.texte(plan.texte.contenu, x, y - Math.round((HAUTEUR_GLYPHE * plan.texte.echelle) / 2) - 4, plan.texte.echelle, '#ffffff', { centre: true, contour: 3 });
    const j = plan.jauge;
    toile.barre(j.x, j.y, j.largeur, j.hauteur, () => [255, 255, 255], 0.22);
    if (niveau > 0) {
      toile.barre(j.x, j.y, Math.max(j.hauteur, j.largeur * niveau), j.hauteur, (t) => melange(bas, haut, t), 1);
    }
  } else {
    dessinerAvatars(toile, plan, images, '#f6d365');
    const { x, y, rayon, epaisseur, ecart } = plan.alliances;
    const or = hexa('#f6d365'), orFonce = hexa('#c9963a');
    toile.coeur(x, y + 4, 250, () => [255, 220, 235], 0.16);
    toile.anneau(x - ecart / 2 + 3, y + 5, rayon, epaisseur, [20, 6, 30], 0.35);
    toile.anneau(x + ecart / 2 + 3, y + 5, rayon, epaisseur, [20, 6, 30], 0.35);
    toile.anneau(x - ecart / 2, y, rayon, epaisseur, orFonce);
    toile.anneau(x + ecart / 2, y, rayon, epaisseur, or);
    toile.anneau(x - ecart / 2, y, rayon - 3, 4, [255, 248, 220], 0.6);
    toile.disque(x + ecart / 2, y - rayon + 2, 10, '#e8f6ff'); // le diamant
    toile.disque(x + ecart / 2 - 3, y - rayon - 1, 4, '#ffffff');
    if (plan.texte.contenu) toile.texte(plan.texte.contenu, x, 290, plan.texte.echelle, '#fff3d6', { centre: true });
  }
  return toile.png();
}

// Télécharge un avatar PNG (taille 128, statique) ; null si quoi que ce soit
// échoue — l'image part alors avec l'initiale à la place.
async function telechargerAvatar(url) {
  if (!/^https:\/\//i.test(String(url || ''))) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return decoderPng(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

const urlAvatar = (user) => {
  try {
    return user?.displayAvatarURL?.({ extension: 'png', size: 128, forceStatic: true }) || null;
  } catch {
    return null;
  }
};

// Rendu complet à partir de deux utilisateurs. Rend un Buffer PNG, ou null :
// l'appelant envoie alors sa carte sans image, jamais rien du tout.
async function fabriquer(plan, users = []) {
  try {
    const images = await Promise.all(users.map((u) => telechargerAvatar(urlAvatar(u))));
    return dessiner(plan, images);
  } catch (err) {
    console.warn(`⚠️ Image ${plan?.type || ''} non générée : ${err.message}`);
    return null;
  }
}

module.exports = {
  planAmour, planMariage, dessiner, fabriquer, encoderPng, decoderPng,
  texteDessinable, tronquer, Toile, POLICE, LARGEUR, HAUTEUR,
};
