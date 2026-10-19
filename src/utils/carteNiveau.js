// 📊 Carte de rang de /niveau voir, dessinée en PNG.
//
// Même moteur que les images de /lc et /mariage (src/utils/imageAmour.js) :
// JavaScript pur, aucune dépendance, rendu vérifiable dans les tests. Ici
// aussi, `planCarteNiveau` dit QUOI dessiner (pur), `dessinerCarteNiveau`
// fait le rendu et rend un Buffer PNG.
//
// La police pixel du moteur ne connaît ni « / », ni « # », ni « : » : on les
// ajoute ICI, sans toucher à la police partagée.

const zlib = require('zlib');
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

// ══════════════════════════════════════════════════════════════════
// 🌐 IMAGES EN LIGNE : bornées AVANT d'être décodées
// ══════════════════════════════════════════════════════════════════
//
// Le fond d'une carte est une adresse choisie par le staff : n'importe quel
// fichier. Un PNG de 1 Mo peut annoncer 64 × 64 pixels et se décompresser en
// un gigaoctet de zéros (une « bombe ») : le décodage bloquait le bot plusieurs
// secondes, ou le tuait — pour TOUS les serveurs. D'où trois bornes, dans cet
// ordre :
//  • le poids du fichier (annoncé, puis compté pendant la lecture) ;
//  • les dimensions lues dans l'en-tête IHDR, sans rien décompresser ;
//  • la décompression elle-même, arrêtée net au-delà de ce que l'image doit
//    peser.
// Et un délai court : /niveau voir répond par `repondreVite`, qui diffère au
// bout de 2,2 s. Au-delà, la fiche partirait en embed à l'ancienne.

const DELAI_CARTE = 1500; // ms, réseau compris : sous la marge de repondreVite
const MAX_OCTETS_IMAGE = 8 * 1024 * 1024;
const MAX_COTE_IMAGE = 2048;
const SIGNATURE_PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CANAUX_PNG = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// Le PNG peut-il être décodé sans danger ? Lit l'en-tête et la taille des
// données, puis décompresse avec un plafond : la sortie d'une image honnête
// fait EXACTEMENT (largeur × canaux + 1) × hauteur octets.
function pngSansDanger(buf, { maxCote = MAX_COTE_IMAGE } = {}) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(SIGNATURE_PNG)) return false;
    if (buf.toString('ascii', 12, 16) !== 'IHDR') return false; // l'en-tête vient TOUJOURS en premier
    const largeur = buf.readUInt32BE(16);
    const hauteur = buf.readUInt32BE(20);
    const canaux = CANAUX_PNG[buf[25]];
    if (!largeur || !hauteur || largeur > maxCote || hauteur > maxCote || buf[24] !== 8 || !canaux || buf[28]) return false;
    const idat = [];
    let pos = 8;
    while (pos + 8 <= buf.length) {
      const longueur = buf.readUInt32BE(pos);
      const nom = buf.toString('ascii', pos + 4, pos + 8);
      if (pos + 12 + longueur > buf.length) return false;
      if (nom === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + longueur));
      else if (nom === 'IEND') break;
      pos += 12 + longueur;
    }
    if (!idat.length) return false;
    const attendu = (largeur * canaux + 1) * hauteur;
    // Lève ERR_BUFFER_TOO_LARGE dès que la sortie dépasse : rien n'est alloué
    // au-delà, la bombe est désamorcée en une milliseconde.
    zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: attendu });
    return true;
  } catch {
    return false;
  }
}

// Une réponse dont on ne lit pas (ou plus) le corps : on coupe.
function couper(res) {
  try {
    if (typeof res?.fermer === 'function') res.fermer();
    else res?.corps?.destroy?.();
  } catch { /* déjà fermée */ }
}

// Le corps d'une réponse, sans jamais lire plus de `max` octets : le poids
// annoncé d'abord, puis chaque morceau compté pendant la lecture.
async function lireBorne(res, max) {
  const brut = res.entetes?.['content-length'];
  const annonce = Number(Array.isArray(brut) ? brut[0] : brut);
  if (Number.isFinite(annonce) && annonce > max) {
    couper(res);
    return null;
  }
  const corps = res.corps;
  if (!corps) return null;
  if (corps instanceof Uint8Array) return corps.length > max ? null : Buffer.from(corps);
  const morceaux = [];
  let total = 0;
  for await (const morceau of corps) {
    total += morceau.length;
    if (total > max) {
      couper(res);
      return null;
    }
    morceaux.push(Buffer.from(morceau));
  }
  return Buffer.concat(morceaux, total);
}

// 🛡️ L'adresse du fond est choisie par un serveur : elle passe par le
// téléchargeur PUBLIC des photos du bot (src/utils/identiteBot.js) —
// adresses internes refusées (127.0.0.1, 169.254.169.254, réseau local…),
// y compris derrière un nom ou une redirection, ports 80/443 seulement.
// Chargé à la demande : identiteBot n'a rien à faire au chargement d'ici.
const telechargeur = () => require('./identiteBot').telechargerPublic;

// Une image PNG en ligne : null si quoi que ce soit échoue (adresse refusée,
// réseau, format, poids, dimensions). Jamais plus de `delai` ms, résolution
// du nom comprise : passé ce délai, on rend null et on coupe.
async function telechargerPngNiveau(url, delai = DELAI_CARTE, { maxOctets = MAX_OCTETS_IMAGE, maxCote = MAX_COTE_IMAGE } = {}) {
  if (!/^https:\/\//i.test(String(url || ''))) return null;
  const arret = new AbortController();
  let minuteur = null;
  const delaiDepasse = new Promise((resolve) => {
    minuteur = setTimeout(() => {
      arret.abort();
      resolve(null);
    }, delai);
  });
  const travail = (async () => {
    let res = null;
    try {
      res = await telechargeur()(url, { signal: arret.signal });
      if (arret.signal.aborted) {
        couper(res);
        return null;
      }
      if (!(res.status >= 200 && res.status < 300)) {
        couper(res);
        return null;
      }
      const corps = await lireBorne(res, maxOctets);
      if (!corps || arret.signal.aborted || !pngSansDanger(corps, { maxCote })) return null;
      return IMG.decoderPng(corps);
    } catch {
      couper(res);
      return null;
    }
  })();
  try {
    return await Promise.race([travail, delaiDepasse]);
  } finally {
    clearTimeout(minuteur);
  }
}

// ── Le fond, gardé prêt à poser ────────────────────────────────────────
//
// Décodé une fois, déjà recadré à la taille de la carte (900 × 300) : les
// /niveau voir suivants ne le retéléchargent ni ne le redécodent. Un fond qui
// a échoué n'est pas réessayé avant 10 minutes — sans quoi CHAQUE fiche du
// serveur attendrait un hébergeur qui ne répond pas.
const CACHE_FONDS = new Map();
const DUREE_FOND_LU = 30 * 60 * 1000;
const DUREE_FOND_RATE = 10 * 60 * 1000;
const MAX_FONDS = 16;

// Le recadrage « cover » de `couvrirCarte`, fait une fois pour toutes.
function recadrerFond(image) {
  if (!image?.rgba) return null;
  const rgba = Buffer.alloc(LARGEUR_CARTE * HAUTEUR_CARTE * 4);
  const echelle = Math.max(LARGEUR_CARTE / image.largeur, HAUTEUR_CARTE / image.hauteur);
  const ox = (image.largeur * echelle - LARGEUR_CARTE) / 2;
  const oy = (image.hauteur * echelle - HAUTEUR_CARTE) / 2;
  for (let y = 0; y < HAUTEUR_CARTE; y++) {
    const sy = Math.min(image.hauteur - 1, Math.floor((y + oy) / echelle));
    for (let x = 0; x < LARGEUR_CARTE; x++) {
      const sx = Math.min(image.largeur - 1, Math.floor((x + ox) / echelle));
      image.rgba.copy(rgba, (y * LARGEUR_CARTE + x) * 4, (sy * image.largeur + sx) * 4, (sy * image.largeur + sx) * 4 + 4);
    }
  }
  return { largeur: LARGEUR_CARTE, hauteur: HAUTEUR_CARTE, rgba };
}

// `rafraichir` : /niveau image vérifie une adresse qu'on vient de poser — on
// ne lui ressert pas un vieil échec.
function fondNiveau(url, { rafraichir = false, delai = DELAI_CARTE } = {}) {
  const cle = String(url || '');
  if (!cle) return Promise.resolve(null);
  const connu = CACHE_FONDS.get(cle);
  if (connu && !rafraichir && connu.expire > Date.now()) return connu.promesse;
  const promesse = telechargerPngNiveau(cle, delai)
    .then((image) => (image ? recadrerFond(image) : null))
    .catch(() => null)
    .then((pret) => {
      const entree = CACHE_FONDS.get(cle);
      if (entree?.promesse === promesse) entree.expire = Date.now() + (pret ? DUREE_FOND_LU : DUREE_FOND_RATE);
      return pret;
    });
  CACHE_FONDS.delete(cle);
  CACHE_FONDS.set(cle, { promesse, expire: Date.now() + DUREE_FOND_RATE });
  // Le plus ancien d'abord : une Map garde l'ordre d'insertion.
  while (CACHE_FONDS.size > MAX_FONDS) CACHE_FONDS.delete(CACHE_FONDS.keys().next().value);
  return promesse;
}

// Rendu complet. Rend { png, fondLu } — png vaut null en cas d'échec :
// l'appelant envoie alors sa carte sans image, jamais rien du tout.
async function fabriquerCarteNiveau(plan, user = null, fondUrl = null) {
  try {
    let urlAvatar = null;
    try {
      urlAvatar = user?.displayAvatarURL?.({ extension: 'png', size: 256, forceStatic: true }) || null;
    } catch {}
    const [avatar, fond] = await Promise.all([telechargerPngNiveau(urlAvatar, DELAI_CARTE), fondUrl ? fondNiveau(fondUrl) : null]);
    return { png: dessinerCarteNiveau(plan, avatar, fond), fondLu: Boolean(fond) };
  } catch (err) {
    console.warn(`⚠️ Carte de niveau non générée : ${err.message}`);
    return { png: null, fondLu: false };
  }
}

module.exports = {
  planCarteNiveau, dessinerCarteNiveau, fabriquerCarteNiveau, telechargerPngNiveau, texteCarteNiveau,
  fondNiveau, pngSansDanger, recadrerFond,
  LARGEUR_CARTE, HAUTEUR_CARTE, DELAI_CARTE, MAX_OCTETS_IMAGE, MAX_COTE_IMAGE,
};
