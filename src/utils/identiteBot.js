const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const stream = require('stream');
const zlib = require('zlib');
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
//    image (og:image). Vers une adresse PUBLIQUE seulement (🛡️ plus bas :
//    ni réseau privé, ni bouclage, ni port exotique, redirections comprises) ;
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

// 🔑 L'identifiant d'un profil est STABLE : retirer ou réordonner les autres
// profils ne le change pas. C'est l'`id` explicite de BOT_PROFILS quand il y
// en a un, sinon une empreinte de son nom. (Il valait autrefois sa POSITION :
// retirer le profil n°1 faisait du n°2 un autre profil.)
const ID_PROFIL = /^[A-Za-z0-9_-]{1,32}$/;
const VALEUR_GLOBALE = '__global__'; // la valeur « profil global » du menu
const empreinteProfil = (nom) => crypto.createHash('sha1').update(String(nom)).digest('hex').slice(0, 8);

// Les profils proposés par le créateur : [{ id, nom, avatar }].
function profils() {
  let brut = process.env.BOT_PROFILS;
  if (!brut) {
    try { brut = require('./botTeam').state('bot_profils'); } catch { brut = null; }
  }
  let liste;
  try { liste = JSON.parse(brut || '[]'); } catch { return []; }
  if (!Array.isArray(liste)) return [];
  const pris = new Set();
  return liste
    .map((p) => {
      const nom = String(p?.nom || p?.name || '').trim().slice(0, 32);
      const explicite = p?.id === undefined || p?.id === null ? '' : String(p.id).trim();
      return {
        id: ID_PROFIL.test(explicite) && explicite !== VALEUR_GLOBALE ? explicite : empreinteProfil(nom),
        nom,
        avatar: String(p?.avatar || p?.avatarUrl || '').trim() || null,
      };
    })
    .filter((p) => p.nom)
    .slice(0, 25)
    .map((p) => {
      // Deux profils du même nom : le second prend un suffixe.
      let id = p.id;
      for (let n = 2; pris.has(id); n++) id = `${p.id}-${n}`;
      pris.add(id);
      return { ...p, id };
    });
}

// 🎭 Le profil enregistré pour ce serveur, retrouvé par son identifiant.
// `retire` : un profil avait été choisi, mais il n'est plus dans la liste —
// le serveur retombe alors sur « aucun profil » (le profil global dans les
// menus) et on le lui dit, plutôt que d'en désigner un autre.
function profilEnregistre(cfg, liste = profils()) {
  const brut = cfg?.bot_profil === undefined || cfg?.bot_profil === null ? '' : String(cfg.bot_profil);
  if (!brut) return { profil: null, retire: null };
  const exact = liste.find((p) => p.id === brut);
  if (exact) return { profil: exact, retire: null };
  // Un enregistrement d'avant les identifiants stables : un numéro de
  // POSITION. Il ne dit plus rien de sûr ; le profil se reconnaît au nom
  // qu'il a posé (bot_nick), que choisir un profil enregistre toujours.
  if (/^\d{1,2}$/.test(brut) && cfg?.bot_nick) {
    const memeNom = liste.filter((p) => p.nom === cfg.bot_nick);
    const choisi = memeNom.find((p) => p === liste[Number(brut) - 1]) || memeNom[0];
    if (choisi) return { profil: choisi, retire: null };
  }
  return { profil: null, retire: brut };
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
// 🛡️ DES ADRESSES PUBLIQUES SEULEMENT
// ══════════════════════════════════════════════════════════════════
//
// Le lien d'une photo vient d'un administrateur de serveur (modal, site). Le
// bot, lui, tourne à côté de services qui ne doivent pas sortir : son API
// locale sur 127.0.0.1, les métadonnées du nuage (169.254.169.254), le
// réseau privé de l'hébergeur. Sans contrôle, « télécharger une photo »
// devenait « lire une image interne et l'afficher en photo du bot ».
//
// Donc, à CHAQUE requête (redirections et page og:image comprises) :
//  • http ou https, sur le port 80 ou 443, rien d'autre ;
//  • le nom est résolu, et TOUTES ses adresses doivent être publiques ;
//  • la connexion part vers l'adresse ainsi vérifiée — le contrôle a lieu
//    dans le `lookup` de la connexion elle-même : un DNS qui changerait de
//    réponse entre le contrôle et l'appel (rebinding) n'a pas de prise ;
//  • les redirections sont suivies À LA MAIN, revérifiées, 5 au plus.

const MAX_REDIRECTIONS = 5;
const PORTS_PUBLICS = new Set(['', '80', '443']);

const PLAGES_INTERDITES = (() => {
  const b = new net.BlockList();
  for (const [debut, prefixe] of [
    ['0.0.0.0', 8], // « ce réseau »
    ['10.0.0.0', 8], // privé
    ['100.64.0.0', 10], // CGNAT
    ['127.0.0.0', 8], // bouclage
    ['169.254.0.0', 16], // lien-local, dont les métadonnées du nuage
    ['172.16.0.0', 12], // privé
    ['192.0.0.0', 24], // réservé IETF
    ['192.0.2.0', 24], // documentation
    ['192.88.99.0', 24], // relais 6to4
    ['192.168.0.0', 16], // privé
    ['198.18.0.0', 15], // bancs d'essai
    ['198.51.100.0', 24], // documentation
    ['203.0.113.0', 24], // documentation
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // réservé, et 255.255.255.255
  ]) b.addSubnet(debut, prefixe, 'ipv4');
  for (const [debut, prefixe] of [
    ['::', 128], // non spécifiée
    ['::1', 128], // bouclage
    ['64:ff9b:1::', 48], // NAT64 local
    ['100::', 64], // à jeter
    ['2001:db8::', 32], // documentation
    ['fc00::', 7], // privé (ULA)
    ['fe80::', 10], // lien-local
    ['fec0::', 10], // site-local (ancien)
    ['ff00::', 8], // multicast
  ]) b.addSubnet(debut, prefixe, 'ipv6');
  return b;
})();

// Les 16 octets d'une adresse IPv6 (déjà validée par net.isIP).
function octetsIPv6(ip) {
  let texte = ip;
  let queue = null;
  const pointee = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(texte);
  if (pointee) {
    if (net.isIP(pointee[2]) !== 4) return null;
    queue = pointee[2].split('.').map(Number);
    texte = `${pointee[1]}0:0`;
  }
  const moities = texte.split('::');
  if (moities.length > 2) return null;
  const groupes = (s) => (s ? s.split(':') : []);
  const gauche = groupes(moities[0]);
  const droite = moities.length === 2 ? groupes(moities[1]) : null;
  const tous = droite === null
    ? gauche
    : [...gauche, ...Array(Math.max(0, 8 - gauche.length - droite.length)).fill('0'), ...droite];
  if (tous.length !== 8 || !tous.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  const octets = tous.flatMap((g) => { const n = parseInt(g, 16); return [n >> 8, n & 255]; });
  if (queue) octets.splice(12, 4, ...queue);
  return octets;
}

// Une adresse IP que le bot ne contacte jamais pour une photo. Une IPv6 qui
// ENVELOPPE une IPv4 (::ffff:127.0.0.1, ::127.0.0.1, 64:ff9b::…, 6to4
// 2002:…) est jugée sur l'IPv4 qu'elle contient. Ce qui n'est pas une
// adresse du tout est refusé, par prudence.
function adresseInterdite(adresse) {
  const ip = String(adresse || '').trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const famille = net.isIP(ip);
  if (famille === 4) return PLAGES_INTERDITES.check(ip, 'ipv4');
  if (famille !== 6) return true;
  if (PLAGES_INTERDITES.check(ip, 'ipv6')) return true;
  const o = octetsIPv6(ip);
  if (!o) return true;
  const v4 = (i) => o.slice(i, i + 4).join('.');
  const nuls = (a, b) => o.slice(a, b).every((x) => x === 0);
  if (nuls(0, 10) && ((o[10] === 0xff && o[11] === 0xff) || (o[10] === 0 && o[11] === 0))) {
    return PLAGES_INTERDITES.check(v4(12), 'ipv4');
  }
  if (o[0] === 0 && o[1] === 0x64 && o[2] === 0xff && o[3] === 0x9b && nuls(4, 12)) return PLAGES_INTERDITES.check(v4(12), 'ipv4');
  if (o[0] === 0x20 && o[1] === 0x02) return PLAGES_INTERDITES.check(v4(2), 'ipv4');
  return false;
}

// Un seul message pour tout refus : il ne dit rien de ce qui se trouve
// derrière l'adresse (ouvert, fermé, quel service).
const erreurCibleRefusee = () => Object.assign(new Error(
  'ce lien ne mène pas à une adresse publique (réseau privé, adresse réservée ou port particulier) : '
  + 'le bot ne le télécharge pas — utilisez un lien public (i.imgur.com…) ou envoyez le fichier depuis votre appareil'
), { cibleRefusee: true });
const erreurRedirections = () => Object.assign(new Error(
  'ce lien redirige plus de 5 fois — utilisez le lien direct de l\'image, ou envoyez le fichier depuis votre appareil'
), { cibleRefusee: true });

// Le réseau, remplaçable par les tests (aucun accès réel) : `lookup` a la
// signature de dns.lookup, `requete(url, { lookup, entetes, signal })` fait
// UNE requête GET sans suivre les redirections.
const reseau = {
  lookup: (...args) => dns.lookup(...args),
  requete: requeteHttp,
};

// 🔎 Le `lookup` de la connexion : résout TOUTES les adresses du nom et
// refuse si une seule est interne. La connexion part ensuite vers l'une de
// ces adresses vérifiées — jamais vers une seconde résolution.
function lookupPublic(hote, options, rappel) {
  if (typeof options === 'function') { rappel = options; options = {}; }
  const opts = typeof options === 'number' ? { family: options } : (options || {});
  reseau.lookup(hote, { all: true, family: opts.family || 0, hints: opts.hints }, (err, adresses) => {
    if (err) return rappel(err);
    const liste = Array.isArray(adresses) ? adresses : (adresses ? [{ address: adresses, family: net.isIP(adresses) }] : []);
    if (!liste.length) return rappel(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND', hostname: hote }));
    if (liste.some((a) => adresseInterdite(a?.address))) return rappel(erreurCibleRefusee());
    if (opts.all) return rappel(null, liste);
    return rappel(null, liste[0].address, liste[0].family || net.isIP(liste[0].address));
  });
}

// L'adresse peut-elle être demandée ? (schéma, port, IP écrite en clair —
// Node ne passe pas par `lookup` pour une IP littérale : on la juge ici.)
function cibleAutorisee(adresse, reseauLocal) {
  let u;
  try { u = new URL(adresse); } catch { throw erreurCibleRefusee(); }
  if (!/^https?:$/.test(u.protocol)) throw erreurCibleRefusee();
  if (reseauLocal) return u;
  if (!PORTS_PUBLICS.has(u.port)) throw erreurCibleRefusee();
  const hote = u.hostname.replace(/^\[|\]$/g, '');
  if (!hote || (net.isIP(hote) && adresseInterdite(hote))) throw erreurCibleRefusee();
  return u;
}

// Une requête GET avec http/https, sans redirection automatique, le
// `lookup` imposé. La réponse garde son corps en flux, décompressé.
function requeteHttp(u, { lookup, entetes, signal } = {}) {
  const module = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = module.request(u, { method: 'GET', headers: entetes, lookup, signal, agent: false }, (res) => {
        res.on('error', () => {}); // l'erreur remonte à la lecture
        const codage = String(res.headers['content-encoding'] || '').trim().toLowerCase();
        const decodeur = codage === 'gzip' || codage === 'x-gzip' ? zlib.createGunzip()
          : codage === 'deflate' ? zlib.createInflate()
            : codage === 'br' ? zlib.createBrotliDecompress() : null;
        // `pipeline` et non `pipe` : une réponse coupée (délai dépassé) doit
        // faire échouer la lecture du décodeur, pas la laisser pendre.
        if (decodeur) stream.pipeline(res, decodeur, () => {});
        resolve({
          status: res.statusCode,
          entetes: res.headers,
          corps: decodeur || res,
          fermer: () => { res.destroy(); decodeur?.destroy(); },
        });
      });
    } catch (err) {
      reject(err);
      return;
    }
    req.on('error', reject);
    req.end();
  });
}

const enTete = (res, nom) => {
  const v = res?.entetes?.[nom];
  return Array.isArray(v) ? v[0] : v;
};
// Une réponse dont on ne lira pas le corps : on coupe.
function abandonner(res) {
  try {
    if (typeof res?.fermer === 'function') res.fermer();
    else if (typeof res?.corps?.destroy === 'function') res.corps.destroy();
  } catch { /* déjà fermé */ }
}

// 🌐 Télécharge une adresse PUBLIQUE en suivant au plus 5 redirections,
// chacune revérifiée. Renvoie { status, entetes, corps, url } — `url` est
// l'adresse finale. `reseauLocal` lève le contrôle d'adresse et de port :
// réservé aux photos de la liste du CRÉATEUR du bot (son site peut tourner
// sur le réseau local), jamais à un lien saisi par un serveur.
async function telechargerPublic(adresse, { signal, reseauLocal = false, entetes = {} } = {}) {
  let courante = String(adresse || '');
  for (let saut = 0; ; saut++) {
    const u = cibleAutorisee(courante, reseauLocal);
    const res = await reseau.requete(u, {
      lookup: reseauLocal ? reseau.lookup : lookupPublic,
      entetes: { 'User-Agent': AGENT_HTTP, Accept: ACCEPT_IMAGE, 'Accept-Encoding': 'identity', ...entetes },
      signal,
    });
    const vers = enTete(res, 'location');
    if ([301, 302, 303, 307, 308].includes(res.status) && vers) {
      abandonner(res);
      if (saut >= MAX_REDIRECTIONS) throw erreurRedirections();
      try { courante = new URL(String(vers), u).toString(); } catch { throw erreurCibleRefusee(); }
      continue;
    }
    return { ...res, url: u.toString() };
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
  const annonce = Number(enTete(res, 'content-length'));
  if (Number.isFinite(annonce) && annonce > max) {
    abandonner(res);
    throw erreurTropLourde(annonce);
  }
  const corps = res.corps;
  if (!corps) return Buffer.alloc(0);
  if (corps instanceof Uint8Array) {
    if (corps.length > max) throw erreurTropLourde(corps.length);
    return Buffer.from(corps);
  }
  const morceaux = [];
  let total = 0;
  for await (const morceau of corps) {
    total += morceau.length;
    if (total > max) {
      abandonner(res);
      throw erreurTropLourde(total);
    }
    morceaux.push(Buffer.from(morceau));
  }
  return Buffer.concat(morceaux);
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
// Chaque requête passe par `telechargerPublic` : adresses publiques
// seulement, redirections revérifiées (voir plus haut).
async function dataUriDepuis(source, { reseauLocal = false } = {}) {
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
  // Un lien refusé (adresse interne) est LA réponse, même si un autre essai
  // a échoué autrement : c'est ce que l'utilisateur doit corriger.
  let refus = null;
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
      res = await telechargerPublic(adresse, { reseauLocal, signal: AbortSignal.timeout(Math.min(DELAI_PAR_ESSAI, restant)) });
    } catch (err) {
      if (err.cibleRefusee) refus = refus || err;
      else erreur = erreur || erreurReseau(err);
      continue;
    }
    if (!(res.status >= 200 && res.status < 300)) {
      abandonner(res);
      erreur = erreur || new Error(`la photo n'a pas pu être téléchargée (HTTP ${res.status}) — `
        + 'vérifiez que le lien est public : il doit s\'ouvrir dans une fenêtre de navigation privée');
      continue;
    }
    const annonce = String(enTete(res, 'content-type') || '').split(';')[0].trim().toLowerCase();
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
  throw refus || erreur || new Error('la photo n\'a pas pu être téléchargée');
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
// `photoDuCreateur` : la photo vient de la liste du créateur (appliquerProfil)
// — son site peut tourner sur le réseau local, voir telechargerPublic.
async function appliquer(guild, { nom, avatarUrl, avatarDonnees, profil, photoDuCreateur = false, raison = 'Identité du bot sur ce serveur' } = {}) {
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
      body.avatar = fichier ? donneesEnDataUri(avatarDonnees) : await dataUriDepuis(url, { reseauLocal: photoDuCreateur === true });
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
    versLeCache(guild, membre);
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

// 🔄 La réponse du PATCH est le membre-bot À JOUR : on la verse dans le cache
// sans attendre GUILD_MEMBER_UPDATE, qui peut arriver APRÈS. Sinon le panneau
// rafraîchi juste derrière montrait encore l'ancien nom et l'ancienne photo.
// (`editMe()` ne servirait à rien : il renvoie un clone, sans toucher au cache.)
function versLeCache(guild, membre) {
  if (!membre || typeof membre !== 'object') return;
  try {
    if (membre.user?.id && typeof guild.members?._add === 'function') guild.members._add(membre);
    else if (typeof guild.members?.me?._patch === 'function') guild.members.me._patch(membre);
  } catch { /* le cache suivra avec GUILD_MEMBER_UPDATE */ }
}

// Un profil de la liste du créateur — '' = retour au profil global.
// Renvoie le profil posé (null pour le profil global).
async function appliquerProfil(guild, id) {
  if (!id || id === VALEUR_GLOBALE) {
    await appliquer(guild, { nom: null, avatarUrl: null, profil: null });
    return null;
  }
  const p = profils().find((x) => x.id === String(id));
  // Un menu affiché AVANT que le créateur change sa liste : jamais un autre
  // profil à la place de celui qu'on a cliqué.
  if (!p) throw new Error('ce profil a été retiré de la liste par le créateur du bot — rouvrez `/config` pour voir la liste à jour');
  await appliquer(guild, { nom: p.nom, avatarUrl: p.avatar, profil: p.id, photoDuCreateur: true });
  return p;
}

// Le nom sous lequel le bot parle dans CE serveur : son pseudo, sinon son nom.
function nomDuBot(client, guild) {
  return guild?.members?.me?.displayName || client?.user?.username || null;
}

// L'état lisible : ce qui est posé sur ce serveur.
// `profil` est l'identifiant STABLE du profil posé, retrouvé dans la liste
// du jour ; `profilRetire`, la valeur enregistrée d'un profil qui n'y est
// plus (le serveur retombe alors sur « aucun profil »).
function etat(guild) {
  const cfg = getGuildConfig(guild.id);
  const moi = guild.members?.me;
  const choix = profilEnregistre(cfg);
  return {
    nom: moi?.displayName || guild.client?.user?.username || null,
    nomGlobal: guild.client?.user?.username || null,
    pseudo: moi?.nickname || null,
    avatar: moi?.avatarURL?.({ size: 128 }) || null, // l'avatar PROPRE à ce serveur, sinon null
    profil: choix.profil?.id || null,
    profilNom: choix.profil?.nom || null,
    profilRetire: choix.retire,
    nomEnregistre: cfg.bot_nick || null,
    avatarEnregistre: cfg.bot_avatar_url || null,
  };
}

module.exports = {
  profils, profilEnregistre, appliquer, appliquerProfil, nomDuBot, etat, dataUriDepuis, routeMembre,
  normaliserUrlImage, varianteSansWebp, typeImageDesOctets, imageDeLaPage, donneesEnDataUri,
  photoDepuisFichier, adresseAvatarMembre, estAdresseEphemere,
  telechargerPublic, adresseInterdite, empreinteProfil,
  MIME_ACCEPTES, MAX_AVATAR, ECART_AVATAR, MAX_REDIRECTIONS, VALEUR_GLOBALE,
  _dernierAvatar: dernierAvatar, _reseau: reseau, _lookupPublic: lookupPublic,
};
