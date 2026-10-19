const { getGuildConfig, setGuildConfig } = require('../database');

// 🪪 L'identité du bot PAR SERVEUR : pseudo + photo de profil de membre.
//
// Depuis le 10 septembre 2025, Discord laisse un bot poser, serveur par
// serveur, un pseudo, un avatar (et une bannière, une bio) — « Modify
// Current Member », PATCH /guilds/{id}/members/@me. Réponses de commandes,
// cartes, messages de salon : tout ce que le bot envoie dans CE serveur porte
// alors ce profil, sans webhook et sans rien changer à l'envoi. Les MP et les
// autres serveurs gardent le profil global.
//
// Deux sources possibles pour un serveur :
//  • un PROFIL de la liste du créateur (BOT_PROFILS dans le .env, écrit par le
//    site à la création du bot) — choisi d'un clic ;
//  • un nom et une photo PERSONNALISÉS, saisis par le serveur lui-même.
//
// La photo arrive de trois façons :
//  • un LIEN — imgur, Discord, Dropbox, Google Drive, GitHub, Tenor, Giphy,
//    ibb.co, postimg, Gyazo… : `normaliserUrlImage` le change en lien direct
//    quand l'hébergeur le permet, et une page web est lue pour y trouver son
//    image (og:image) ;
//  • un FICHIER envoyé depuis l'appareil (modal, `/config photo:`, site) :
//    `appliquer(guild, { avatarDonnees })` ;
//  • une data URI toute faite (le site, quand le bot ne peut pas le joindre).
//
// Ce qui est enregistré ensuite (`bot_avatar_url`) est l'adresse STABLE de la
// photo posée sur Discord — jamais une adresse de pièce jointe, qui expire.

const MAX_AVATAR = 8 * 1024 * 1024;
// Discord n'accepte que PNG, JPG et GIF en « image data » — un webp passe le
// téléchargement puis se fait refuser sans explication utile : on tranche ici.
const MIME_ACCEPTES = new Set(['image/png', 'image/jpeg', 'image/gif']);
// Discord limite les changements de photo (≈ 10 min, code AVATAR_RATE_LIMIT,
// qui est un 400 — pas un 429, donc rien ne le rejoue tout seul).
const ECART_AVATAR = 10 * 60 * 1000;
const dernierAvatar = new Map(); // guildId → dernier changement de photo

// ⏱️ Un essai ne dépasse pas 15 s, et l'ensemble (relances comprises) pas
// 25 s : le site attend la réponse du bot 30 s.
const DELAI_PAR_ESSAI = 15000;
const BUDGET_TELECHARGEMENT = 25000;
// Les CDN qui négocient le format (Discord, imgur, Google…) servent du webp à
// qui l'accepte. On demande d'abord ce que Discord prendra.
const ACCEPT_IMAGE = 'image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.5';
const AGENT_HTTP = 'Mozilla/5.0 (compatible; discord-roblox-rp-bot/1.0)';

// Les formats refusés, dits par leur nom plutôt que par un type MIME.
const NOMS_FORMATS = {
  'image/webp': 'WEBP',
  'image/avif': 'AVIF',
  'image/heic': 'HEIC (photo d\'iPhone)',
  'image/bmp': 'BMP',
  'image/tiff': 'TIFF',
  'image/x-icon': 'ICO',
  'image/svg+xml': 'SVG',
  'video/mp4': 'vidéo MP4',
  'video/webm': 'vidéo WEBM',
};

// Les profils proposés par le créateur : [{ id, nom, avatar }].
function profils() {
  let brut = process.env.BOT_PROFILS;
  if (!brut) {
    try { brut = require('./botTeam').state('bot_profils'); } catch { brut = null; }
  }
  try {
    const liste = JSON.parse(brut || '[]');
    if (!Array.isArray(liste)) return [];
    return liste
      .map((p, i) => ({
        id: String(p?.id || i + 1),
        nom: String(p?.nom || p?.name || '').trim().slice(0, 32),
        avatar: String(p?.avatar || p?.avatarUrl || '').trim() || null,
      }))
      .filter((p) => p.nom)
      .slice(0, 25);
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════
// 🔗 LIENS : du lien qu'on colle au lien de l'image elle-même
// ══════════════════════════════════════════════════════════════════

// imgur : l'identifiant suffit, l'extension dit le format voulu. Les « gifv »
// et les vidéos sont des GIF animés côté imgur ; un webp devient un png.
function imgurDirect(id, ext) {
  const e = String(ext || '').toLowerCase();
  const voulu = ['gifv', 'gif', 'mp4', 'webm'].includes(e) ? 'gif'
    : ['jpg', 'jpeg', 'png'].includes(e) ? e : 'png';
  return `https://i.imgur.com/${id}.${voulu}`;
}

// 🔗 Change un lien « de partage » en lien DIRECT vers l'image, quand
// l'hébergeur le permet sans rien télécharger. Un lien inconnu est rendu tel
// quel ; une page (album imgur, tenor, ibb.co, postimg…) sera lue plus tard
// pour y trouver son image (og:image).
function normaliserUrlImage(entree, profondeur = 0) {
  // Discord : un lien entre chevrons <…> ne fait pas d'aperçu — on les ôte.
  let brut = String(entree ?? '').trim().replace(/^<([\s\S]+)>$/, '$1').trim();
  if (!brut || /^data:/i.test(brut)) return brut;
  if (/^\/\//.test(brut)) brut = `https:${brut}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(brut) && /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]|$)/i.test(brut)) {
    brut = `https://${brut}`;
  }
  let u;
  try { u = new URL(brut); } catch { return brut; }
  if (!/^https?:$/.test(u.protocol)) return brut;
  const hote = u.hostname.toLowerCase().replace(/^www\./, '');
  const segments = u.pathname.split('/').filter(Boolean);
  const premier = segments[0] || '';

  // Google Images, Bing : le lien de la page de résultats CONTIENT l'image.
  if (profondeur < 2) {
    if (/^google\.[a-z.]+$/.test(hote) && u.pathname === '/imgres' && u.searchParams.get('imgurl')) {
      return normaliserUrlImage(u.searchParams.get('imgurl'), profondeur + 1);
    }
    if (hote === 'bing.com' && u.searchParams.get('mediaurl')) {
      return normaliserUrlImage(u.searchParams.get('mediaurl'), profondeur + 1);
    }
  }

  // imgur.com/ID, m.imgur.com/ID → i.imgur.com/ID.png (un album « a/… » ou
  // une galerie reste une page : son og:image fera foi).
  if (hote === 'imgur.com' || hote === 'm.imgur.com') {
    const m = /^([A-Za-z0-9]{5,10})(?:\.([a-z0-9]+))?$/i.exec(premier);
    if (segments.length === 1 && m) return imgurDirect(m[1], m[2]);
    return brut;
  }
  // i.imgur.com/ID.gifv|.webp|_d.webp?maxwidth=… → le format que Discord prend.
  if (hote === 'i.imgur.com') {
    const m = /^([A-Za-z0-9]+?)(?:_d)?\.([a-z0-9]+)$/i.exec(premier);
    if (segments.length === 1 && m) return imgurDirect(m[1], m[2]);
    return brut;
  }

  // Dropbox : dl=0 ouvre une page d'aperçu, raw=1 donne le fichier.
  if (hote === 'dropbox.com' && (/^(s|scl|sh)$/.test(premier) || u.searchParams.has('dl'))) {
    u.searchParams.delete('dl');
    u.searchParams.set('raw', '1');
    return u.toString();
  }

  // Google Drive : …/file/d/ID/view → téléchargement direct.
  if (hote === 'drive.google.com' || hote === 'docs.google.com') {
    const m = /\/file\/d\/([\w-]{10,})/.exec(u.pathname);
    const id = m?.[1] || (['/open', '/uc'].includes(u.pathname) ? u.searchParams.get('id') : null);
    if (id && /^[\w-]{10,}$/.test(id)) return `https://drive.google.com/uc?export=download&id=${id}`;
    return brut;
  }

  // GitHub : github.com/u/r/blob/branche/chemin → raw.githubusercontent.com.
  if (hote === 'github.com' && segments.length >= 5 && ['blob', 'raw'].includes(segments[2])) {
    const [proprio, depot, , ...reste] = segments;
    return `https://raw.githubusercontent.com/${proprio}/${depot}/${reste.join('/')}`;
  }

  // Discord : le proxy sert du webp quand on le lui demande — on demande du png.
  if (hote === 'cdn.discordapp.com' || hote === 'media.discordapp.net' || /^images-ext-\d+\.discordapp\.net$/.test(hote)) {
    let change = false;
    if ((u.searchParams.get('format') || '').toLowerCase() === 'webp') {
      u.searchParams.set('format', 'png');
      change = true;
    }
    // Avatars, icônes, émojis : l'extension EST le format.
    if (hote === 'cdn.discordapp.com' && /\.webp$/i.test(u.pathname) && !/^(attachments|ephemeral-attachments)$/.test(premier)) {
      const anime = /\/a_[^/]+\.webp$/i.test(u.pathname) || u.searchParams.get('animated') === 'true';
      u.pathname = u.pathname.replace(/\.webp$/i, anime ? '.gif' : '.png');
      change = true;
    }
    return change ? u.toString() : brut;
  }

  // Giphy : la page d'un GIF → le GIF lui-même.
  if (hote === 'giphy.com' && ['gifs', 'stickers', 'embed'].includes(premier) && segments[1]) {
    const id = segments[1].split('-').pop();
    if (/^[A-Za-z0-9]{6,}$/.test(id)) return `https://media.giphy.com/media/${id}/giphy.gif`;
    return brut;
  }
  if (/^(?:media\d*|i)\.giphy\.com$/.test(hote) && /\.webp$/i.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\.webp$/i, '.gif');
    return u.toString();
  }

  // Gyazo : gyazo.com/<empreinte> → i.gyazo.com/<empreinte>.png (la page
  // reste le repli si l'image est un JPG).
  if (hote === 'gyazo.com' && /^[0-9a-f]{32}$/i.test(premier)) {
    return `https://i.gyazo.com/${premier.toLowerCase()}.png`;
  }

  // Reddit : preview.redd.it (redimensionné, souvent en webp) → i.redd.it.
  if (hote === 'preview.redd.it' && segments.length === 1) {
    return `https://i.redd.it/${premier.replace(/^.*-v0-/, '')}`;
  }

  // Twitter/X : pbs.twimg.com/media/ID?format=webp → jpg.
  if (hote === 'pbs.twimg.com' && (u.searchParams.get('format') || '').toLowerCase() === 'webp') {
    u.searchParams.set('format', 'jpg');
    return u.toString();
  }

  // Google (Photos, Blogger…) : l'option « -rw » force le webp.
  if (/(^|\.)(googleusercontent|ggpht)\.com$/.test(hote) && /=[^/]*\brw\b/.test(u.pathname)) {
    u.pathname = u.pathname.replace(/=([^/]*)$/, (_, o) => `=${o.split('-').filter((x) => x !== 'rw').join('-')}`.replace(/=$/, ''));
    return u.toString();
  }

  return brut;
}

// 🔁 Une image arrivée en webp : l'hébergeur sait-il en servir une autre ?
// Seulement pour ceux dont on connaît la règle — deviner ailleurs ne ferait
// que changer un refus clair en « HTTP 404 ».
function varianteSansWebp(adresse) {
  let u;
  try { u = new URL(String(adresse || '')); } catch { return null; }
  const hote = u.hostname.toLowerCase().replace(/^www\./, '');
  const avant = u.toString();
  if (hote === 'media.discordapp.net' || /^images-ext-\d+\.discordapp\.net$/.test(hote)) {
    u.searchParams.set('format', 'png');
  } else if (hote === 'cdn.discordapp.com') {
    if (/\.webp$/i.test(u.pathname)) u.pathname = u.pathname.replace(/\.webp$/i, /\/a_[^/]+$/i.test(u.pathname) ? '.gif' : '.png');
    else return null;
  } else if (hote === 'i.imgur.com') {
    const m = /^\/([A-Za-z0-9]+?)(?:_d)?\.([a-z0-9]+)$/i.exec(u.pathname);
    if (!m) return null;
    return `https://i.imgur.com/${m[1]}.${m[2].toLowerCase() === 'png' ? 'jpg' : 'png'}`;
  } else if (/(^|\.)giphy\.com$/.test(hote) || /(^|\.)tenor\.com$/.test(hote)) {
    if (!/\.webp$/i.test(u.pathname)) return null;
    u.pathname = u.pathname.replace(/\.webp$/i, '.gif');
  } else if (hote === 'pbs.twimg.com') {
    u.searchParams.set('format', 'jpg');
  } else if (/(^|\.)(unsplash\.com|imgix\.net)$/.test(hote)) {
    u.searchParams.set('fm', 'jpg');
    const auto = (u.searchParams.get('auto') || '').split(',').filter((x) => x && x !== 'format');
    if (auto.length) u.searchParams.set('auto', auto.join(','));
    else u.searchParams.delete('auto');
  } else if (hote === 'res.cloudinary.com') {
    u.pathname = u.pathname.replace(/(^|[/,])f_(?:auto|webp|avif)(?=[,/])/, '$1f_png');
  } else if ((u.searchParams.get('format') || '').toLowerCase() === 'webp') {
    // Un paramètre « format=webp » explicite : la plupart des CDN d'images
    // acceptent alors « format=png ».
    u.searchParams.set('format', 'png');
  } else {
    return null;
  }
  const apres = u.toString();
  return apres === avant ? null : apres;
}

// ══════════════════════════════════════════════════════════════════
// 🔎 RECONNAÎTRE UNE IMAGE À SES PREMIERS OCTETS
// ══════════════════════════════════════════════════════════════════
//
// L'en-tête content-type ment trop souvent : S3 et Dropbox disent
// « application/octet-stream », certains CDN annoncent un png et servent du
// webp. Seuls les premiers octets font foi.
function typeImageDesOctets(donnees) {
  const b = Buffer.isBuffer(donnees) ? donnees : Buffer.from(donnees || []);
  if (b.length < 3) return null;
  const hex = b.subarray(0, 4).toString('hex');
  if (hex === '89504e47') return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex === '47494638') return 'image/gif';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp') {
    const marque = b.toString('latin1', 8, 12);
    if (/^avi[fs]$/.test(marque)) return 'image/avif';
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(marque)) return 'image/heic';
    return 'video/mp4';
  }
  if (hex === '1a45dfa3') return 'video/webm';
  if (hex === '49492a00' || hex === '4d4d002a') return 'image/tiff';
  if (hex === '00000100') return 'image/x-icon';
  if (hex.startsWith('424d') && b.length >= 14) return 'image/bmp';
  const debut = b.toString('utf8', 0, Math.min(b.length, 1024)).replace(/^﻿/, '').trimStart().toLowerCase();
  if (/^<svg\b/.test(debut) || (debut.startsWith('<?xml') && debut.includes('<svg'))) return 'image/svg+xml';
  if (/^<(?:!doctype html|html|head|body|meta|title|link|script|!--)/.test(debut)) return 'text/html';
  return null;
}

// 📄 L'image d'une page web : og:image, twitter:image, ou <link rel=image_src>.
// C'est ce que lisent les aperçus de Discord — tenor, giphy, ibb.co,
// postimg, les albums imgur la donnent tous.
function imageDeLaPage(html, base) {
  const texte = String(html || '');
  const attribut = (balise, nom) => {
    const m = new RegExp(`\\b${nom}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(balise);
    return m ? (m[1] ?? m[2] ?? m[3]) : null;
  };
  const metas = texte.match(/<meta\b[^>]*>/gi) || [];
  let trouve = null;
  for (const cle of ['og:image', 'og:image:secure_url', 'og:image:url', 'twitter:image', 'twitter:image:src']) {
    const balise = metas.find((m) => String(attribut(m, 'property') || attribut(m, 'name') || '').trim().toLowerCase() === cle);
    trouve = balise ? attribut(balise, 'content') : null;
    if (trouve) break;
  }
  if (!trouve) {
    const lien = (texte.match(/<link\b[^>]*>/gi) || []).find((l) => /\brel\s*=\s*["']?image_src\b/i.test(l));
    if (lien) trouve = attribut(lien, 'href');
  }
  if (!trouve) return null;
  const propre = trouve
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, '\'')
    .replace(/&#x2f;|&#0*47;/gi, '/').trim();
  try {
    const u = new URL(propre, base);
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
// 📥 TÉLÉCHARGER LA PHOTO
// ══════════════════════════════════════════════════════════════════

const enMo = (n) => (n / 1048576).toFixed(1).replace('.', ',');
const erreurTropLourde = (n) => Object.assign(
  new Error(`photo trop lourde (${n ? `${enMo(n)} Mo, ` : ''}8 Mo maximum) — réduisez-la ou compressez-la, puis réessayez`),
  { definitive: true }
);
const erreurWebp = () => new Error(
  'cette image est au format WEBP, que Discord refuse pour une photo de profil — utilisez une image PNG, JPG ou GIF '
  + '(enregistrez-la en PNG puis envoyez le fichier, ou prenez un lien direct qui finit par .png, .jpg ou .gif)'
);
const erreurFormat = (type, annonce = '') => new Error(type && type !== 'text/html'
  ? `format ${NOMS_FORMATS[type] || type} refusé par Discord pour une photo de profil — utilisez une image PNG, JPG ou GIF`
  : `ce lien ne renvoie pas une image reconnue${annonce ? ` (type annoncé : ${annonce})` : ''} — utilisez une image PNG, JPG ou GIF`);

// Lit le corps sans jamais dépasser la limite : une vidéo de 200 Mo collée
// par erreur ne doit pas remplir la mémoire du bot.
async function lireCorpsBorne(res, max) {
  const annonce = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(annonce) && annonce > max) throw erreurTropLourde(annonce);
  if (res.body && typeof res.body.getReader === 'function') {
    const lecteur = res.body.getReader();
    const morceaux = [];
    let total = 0;
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        lecteur.cancel().catch(() => {});
        throw erreurTropLourde(total);
      }
      morceaux.push(Buffer.from(value));
    }
    return Buffer.concat(morceaux);
  }
  const tout = Buffer.from(await res.arrayBuffer());
  if (tout.length > max) throw erreurTropLourde(tout.length);
  return tout;
}

// Une adresse de pièce jointe Discord est SIGNÉE et expire en quelques
// heures : on s'en sert pour télécharger, jamais pour l'enregistrer.
function estAdresseEphemere(adresse) {
  try {
    const u = new URL(String(adresse || ''));
    const hote = u.hostname.toLowerCase();
    if ((hote === 'cdn.discordapp.com' || hote === 'media.discordapp.net')
        && /^\/(attachments|ephemeral-attachments)\//.test(u.pathname)) return true;
    return u.searchParams.has('ex') && u.searchParams.has('hm');
  } catch {
    return false;
  }
}

// 🧾 Des octets (fichier reçu) ou une data URI → la data URI que Discord
// attend, après contrôle du VRAI format et de la taille.
function donneesEnDataUri(source) {
  let octets;
  if (Buffer.isBuffer(source)) octets = source;
  else if (source instanceof Uint8Array || source instanceof ArrayBuffer) octets = Buffer.from(source);
  else {
    const m = /^data:([^,]*?),([\s\S]*)$/i.exec(String(source || '').trim());
    if (!m) throw new Error('données de photo illisibles — envoyez une image PNG, JPG ou GIF');
    try {
      octets = /;base64$/i.test(m[1])
        ? Buffer.from(m[2].replace(/\s+/g, ''), 'base64')
        : Buffer.from(decodeURIComponent(m[2]), 'latin1');
    } catch {
      throw new Error('données de photo illisibles — envoyez une image PNG, JPG ou GIF');
    }
  }
  if (!octets.length) throw new Error('fichier vide — envoyez une image PNG, JPG ou GIF');
  if (octets.length > MAX_AVATAR) throw erreurTropLourde(octets.length);
  const type = typeImageDesOctets(octets);
  if (type === 'image/webp') throw erreurWebp();
  if (!MIME_ACCEPTES.has(type)) throw erreurFormat(type);
  return `data:${type};base64,${octets.toString('base64')}`;
}

function erreurReseau(err) {
  const delai = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  return new Error(`la photo n'a pas pu être téléchargée (${delai ? 'délai dépassé' : 'site injoignable'}) — `
    + 'essayez un lien direct (i.imgur.com…) ou envoyez le fichier depuis votre appareil');
}

// Télécharge la photo et la met au format que Discord attend (data URI).
//
// Dans l'ordre : le lien normalisé, puis le lien d'origine s'il différait
// (Gyazo, imgur…). Une image webp essaie la variante non-webp connue de son
// hébergeur ; une page web est lue UNE fois pour y trouver son image.
async function dataUriDepuis(source) {
  const brut = String(source ?? '').trim().replace(/^<([\s\S]+)>$/, '$1').trim();
  if (/^data:/i.test(brut)) return donneesEnDataUri(brut);
  const depart = normaliserUrlImage(brut);
  if (!/^https?:\/\//i.test(depart)) {
    throw new Error('l\'adresse de la photo doit commencer par http(s):// — ou envoyez le fichier depuis votre appareil');
  }
  const file = [depart];
  if (depart !== brut && /^https?:\/\//i.test(brut)) file.push(brut);
  const vus = new Set();
  const limite = Date.now() + BUDGET_TELECHARGEMENT;
  let pageLue = false;
  let erreur = null;
  while (file.length) {
    const adresse = file.shift();
    if (vus.has(adresse)) continue;
    vus.add(adresse);
    const restant = limite - Date.now();
    if (restant <= 0) {
      erreur = erreur || erreurReseau({ name: 'TimeoutError' });
      break;
    }
    let res;
    try {
      res = await fetch(adresse, {
        redirect: 'follow',
        signal: AbortSignal.timeout(Math.min(DELAI_PAR_ESSAI, restant)),
        headers: { 'User-Agent': AGENT_HTTP, Accept: ACCEPT_IMAGE },
      });
    } catch (err) {
      erreur = erreur || erreurReseau(err);
      continue;
    }
    if (!res.ok) {
      erreur = erreur || new Error(`la photo n'a pas pu être téléchargée (HTTP ${res.status}) — `
        + 'vérifiez que le lien est public : il doit s\'ouvrir dans une fenêtre de navigation privée');
      continue;
    }
    const annonce = String(res.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    let octets;
    try {
      octets = await lireCorpsBorne(res, MAX_AVATAR);
    } catch (err) {
      if (err.definitive) throw err;
      erreur = erreur || erreurReseau(err);
      continue;
    }
    const type = typeImageDesOctets(octets);
    if (MIME_ACCEPTES.has(type)) return `data:${type};base64,${octets.toString('base64')}`;
    const finale = res.url || adresse;
    if (type === 'image/webp') {
      erreur = erreurWebp();
      const variante = varianteSansWebp(finale) || (finale !== adresse ? varianteSansWebp(adresse) : null);
      if (variante && !vus.has(variante)) file.unshift(variante);
      continue;
    }
    if (type === 'text/html' || (!type && /html/.test(annonce))) {
      // Google Drive répond par une page (connexion, aperçu) quand le fichier
      // n'est pas partagé : son image serait un logo, pas la photo.
      if ([adresse, finale].some((a) => /^https?:\/\/(?:drive|docs|accounts|drive\.usercontent)\.google\.com\//i.test(a))) {
        erreur = new Error('ce fichier Google Drive n\'est pas partagé publiquement — Partager → « Tous les utilisateurs '
          + 'disposant du lien », puis recollez le lien (ou envoyez le fichier depuis votre appareil)');
        continue;
      }
      if (!pageLue) {
        pageLue = true;
        const image = imageDeLaPage(octets.toString('utf8'), finale);
        const direct = image ? normaliserUrlImage(image) : null;
        if (direct && !vus.has(direct)) {
          file.unshift(direct);
          continue;
        }
      }
      erreur = new Error('ce lien ouvre une page web, pas une image — ouvrez l\'image, faites clic droit → '
        + '« Copier l\'adresse de l\'image », ou envoyez le fichier depuis votre appareil');
      continue;
    }
    erreur = erreurFormat(type, annonce);
  }
  throw erreur || new Error('la photo n\'a pas pu être téléchargée');
}

// 📁 Une pièce jointe Discord (modal, `/config photo:`) : contrôle du type et
// de la taille AVANT de télécharger, puis data URI. L'adresse de la pièce
// jointe, signée, n'est jamais gardée.
async function photoDepuisFichier(piece) {
  if (!piece || !(piece.url || piece.proxyURL)) throw new Error('aucun fichier reçu — choisissez une image PNG, JPG ou GIF');
  const type = String(piece.contentType || '').split(';')[0].trim().toLowerCase();
  const ext = (/\.([a-z0-9]+)$/i.exec(String(piece.name || ''))?.[1] || '').toLowerCase();
  const typeOk = MIME_ACCEPTES.has(type) || (!type && ['png', 'jpg', 'jpeg', 'gif'].includes(ext));
  if (!typeOk) {
    if (type === 'image/webp' || ext === 'webp') throw erreurWebp();
    throw new Error(`fichier « ${String(piece.name || type || 'inconnu').slice(0, 60)} » refusé : `
      + 'Discord n\'accepte qu\'une image PNG, JPG ou GIF pour une photo de profil');
  }
  if (Number(piece.size) > MAX_AVATAR) throw erreurTropLourde(Number(piece.size));
  return dataUriDepuis(piece.url || piece.proxyURL);
}

// La route « membre courant ». `Routes.guildMember(id, '@me')` existe sur
// toute 14.x ; l'équivalent en clair sert aux laboratoires sans discord.js.
function routeMembre(guildId) {
  try {
    const { Routes } = require('discord.js');
    if (typeof Routes?.guildMember === 'function') return Routes.guildMember(guildId, '@me');
  } catch { /* stub sans Routes */ }
  return `/guilds/${guildId}/members/@me`;
}

// 🔗 L'adresse STABLE de la photo de membre posée par Discord : elle ne
// change qu'avec la photo, et sert d'aperçu au site comme au panneau.
function adresseAvatarMembre(guildId, userId, empreinte) {
  if (!guildId || !userId || !empreinte) return null;
  const ext = String(empreinte).startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${empreinte}.${ext}?size=512`;
}

// Ce que Discord a VRAIMENT dit — plutôt qu'un « Discord a refusé » muet.
function lireErreurDiscord(err) {
  const code = err?.rawError?.errors?.avatar?._errors?.[0]?.code;
  if (code === 'AVATAR_RATE_LIMIT') {
    return 'Discord limite les changements de photo de profil : patientez une dizaine de minutes avant de réessayer';
  }
  if (err?.code === 50013 || err?.status === 403) return 'il me manque la permission « Changer le pseudo » sur ce serveur';
  return err?.rawError?.message || err?.message || 'Discord a refusé';
}

// Applique nom et/ou photo au membre-bot de ce serveur, puis l'enregistre.
// `undefined` = ne pas toucher ; null/'' = retour au profil global.
// `avatarDonnees` (Buffer ou data URI) : une photo reçue en FICHIER — elle
// passe avant `avatarUrl`.
async function appliquer(guild, { nom, avatarUrl, avatarDonnees, profil, raison = 'Identité du bot sur ce serveur' } = {}) {
  const body = {};
  if (nom !== undefined) body.nick = String(nom || '').trim().slice(0, 32) || null;
  const fichier = avatarDonnees !== undefined && avatarDonnees !== null && avatarDonnees !== '';
  // Ce qu'on enregistre si Discord ne renvoie pas la photo posée : le lien
  // saisi — sauf s'il expire ou s'il contient l'image elle-même.
  let repli = null;
  if (fichier || avatarUrl !== undefined) {
    const url = fichier ? '' : String(avatarUrl || '').trim();
    if (fichier || url) {
      const reste = ECART_AVATAR - (Date.now() - (dernierAvatar.get(guild.id) || 0));
      if (reste > 0) throw new Error(`Discord limite les changements de photo : réessayez dans ${Math.ceil(reste / 60000)} min`);
      body.avatar = fichier ? donneesEnDataUri(avatarDonnees) : await dataUriDepuis(url);
      repli = fichier || /^data:/i.test(url) || estAdresseEphemere(url) ? null : url;
    } else {
      body.avatar = null;
    }
  }
  let membre = null;
  if (Object.keys(body).length) {
    try {
      membre = await guild.client.rest.patch(routeMembre(guild.id), { body, reason: raison });
    } catch (err) {
      throw new Error(lireErreurDiscord(err));
    }
    if (body.avatar) dernierAvatar.set(guild.id, Date.now());
  }
  if (nom !== undefined) setGuildConfig(guild.id, 'bot_nick', body.nick);
  if (body.avatar === null) setGuildConfig(guild.id, 'bot_avatar_url', null);
  else if (body.avatar) {
    const botId = membre?.user?.id || guild.client?.user?.id || guild.members?.me?.id;
    setGuildConfig(guild.id, 'bot_avatar_url', adresseAvatarMembre(guild.id, botId, membre?.avatar) || repli);
  }
  if (profil !== undefined) setGuildConfig(guild.id, 'bot_profil', profil || null);
  return body;
}

// Un profil de la liste du créateur — '' = retour au profil global.
async function appliquerProfil(guild, id) {
  if (!id) return appliquer(guild, { nom: null, avatarUrl: null, profil: null });
  const p = profils().find((x) => x.id === String(id));
  if (!p) throw new Error('profil introuvable dans la liste du bot');
  return appliquer(guild, { nom: p.nom, avatarUrl: p.avatar, profil: p.id });
}

// Le nom sous lequel le bot parle dans CE serveur : son pseudo, sinon son nom.
function nomDuBot(client, guild) {
  return guild?.members?.me?.displayName || client?.user?.username || null;
}

// L'état lisible : ce qui est posé sur ce serveur.
function etat(guild) {
  const cfg = getGuildConfig(guild.id);
  const moi = guild.members?.me;
  return {
    nom: moi?.displayName || guild.client?.user?.username || null,
    nomGlobal: guild.client?.user?.username || null,
    pseudo: moi?.nickname || null,
    avatar: moi?.avatarURL?.({ size: 128 }) || null, // l'avatar PROPRE à ce serveur, sinon null
    profil: cfg.bot_profil || null,
    nomEnregistre: cfg.bot_nick || null,
    avatarEnregistre: cfg.bot_avatar_url || null,
  };
}

module.exports = {
  profils, appliquer, appliquerProfil, nomDuBot, etat, dataUriDepuis, routeMembre,
  normaliserUrlImage, varianteSansWebp, typeImageDesOctets, imageDeLaPage, donneesEnDataUri,
  photoDepuisFichier, adresseAvatarMembre, estAdresseEphemere,
  MIME_ACCEPTES, MAX_AVATAR, ECART_AVATAR, _dernierAvatar: dernierAvatar,
};
