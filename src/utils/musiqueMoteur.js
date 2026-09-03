const S = require('./musiqueSources');

// 🔊 Le moteur : préparer les sources, résoudre un lien, ouvrir un flux.
//
// Tout ce qui touche à l'audio est chargé PARESSEUSEMENT. Le bot doit démarrer
// même sans les bibliothèques audio (exécutable packagé, hébergeur minimal), et
// les tests ne doivent pas les réclamer.

let _play = null;
let _voice = null;

function play() {
  if (!_play) _play = require('play-dl');
  return _play;
}
function voice() {
  if (!_voice) _voice = require('@discordjs/voice');
  return _voice;
}

// ══════════════════════════════════════════════════════════════════
// 🔑 PRÉPARATION — l'étape qui manquait, et qui expliquait tout
// ══════════════════════════════════════════════════════════════════
//
// play-dl ne fonctionne pas « tout seul » :
//
//  • SoundCloud exige un identifiant client. Sans lui, TOUT lien SoundCloud
//    échoue — et rien ne le disait.
//  • Spotify exige des identifiants d'application pour lire une fiche. Sans
//    eux, on se rabat sur le point d'entrée public (voir musiqueSources).
//  • YouTube accepte un cookie, utile pour les vidéos restreintes.
//
// Cette préparation n'était appelée nulle part. C'est la première raison pour
// laquelle « rien ne fonctionnait ».
//
// Elle ne tourne QU'UNE fois, et chaque source échoue séparément : une clé
// SoundCloud indisponible ne doit pas emporter YouTube.
let _preparation = null;
const etat = { soundcloud: false, spotify: false, youtube: false, erreurs: [] };

function preparer() {
  if (_preparation) return _preparation;
  _preparation = (async () => {
    const p = play();

    // SoundCloud : l'identifiant est gratuit et s'obtient sans compte.
    try {
      if (typeof p.getFreeClientID === 'function') {
        const client_id = await p.getFreeClientID();
        if (client_id) {
          await p.setToken({ soundcloud: { client_id } });
          etat.soundcloud = true;
        }
      }
    } catch (err) {
      etat.erreurs.push(`SoundCloud : ${err.message}`);
    }

    // Spotify : facultatif. Sans identifiants, les liens Spotify passent par
    // le point d'entrée public — une piste seule, mais sans rien à configurer.
    try {
      const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN, SPOTIFY_MARKET } = process.env;
      if (SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET && SPOTIFY_REFRESH_TOKEN) {
        await p.setToken({
          spotify: {
            client_id: SPOTIFY_CLIENT_ID,
            client_secret: SPOTIFY_CLIENT_SECRET,
            refresh_token: SPOTIFY_REFRESH_TOKEN,
            market: SPOTIFY_MARKET || 'FR',
          },
        });
        etat.spotify = true;
      }
    } catch (err) {
      etat.erreurs.push(`Spotify : ${err.message}`);
    }

    // YouTube : un cookie débloque les vidéos avec vérification d'âge.
    try {
      if (process.env.YOUTUBE_COOKIE) {
        await p.setToken({ youtube: { cookie: process.env.YOUTUBE_COOKIE } });
        etat.youtube = true;
      }
    } catch (err) {
      etat.erreurs.push(`YouTube : ${err.message}`);
    }

    return etat;
  })();
  return _preparation;
}

const etatSources = () => ({ ...etat, erreurs: [...etat.erreurs] });

// ══════════════════════════════════════════════════════════════════
// 🔎 RÉSOLUTION
// ══════════════════════════════════════════════════════════════════

// Cherche sur YouTube la chanson décrite par un titre. C'est le pont entre
// « ce que Spotify/Deezer disent » et « ce qu'on peut réellement diffuser ».
async function chercherSurYouTube(requete) {
  const p = play();
  const trouves = await p.search(requete, { limit: 1, source: { youtube: 'video' } });
  const v = trouves?.[0];
  if (!v?.url) return null;
  return {
    titre: v.title,
    url: v.url,
    duree: v.durationInSec || 0,
    auteur: v.channel?.name || null,
    vignette: v.thumbnails?.[0]?.url || null,
  };
}

// Résout une requête en une LISTE de pistes jouables (une, ou toute une liste).
//
// Ne lève qu'avec un message destiné à être lu par un humain : chaque échec
// possible a une cause précise, et « une erreur est survenue » n'aide personne.
async function resoudre(requete) {
  await preparer();
  const p = play();
  const { source, url } = S.reconnaitre(requete);

  // ── Texte libre ──
  if (source === 'recherche') {
    const v = await chercherSurYouTube(requete);
    if (!v) throw new Error(`Aucun résultat pour « ${requete} ».`);
    return [S.piste({ ...v, source: 'youtube', origine: 'recherche' })];
  }

  // ── YouTube ──
  if (source === 'youtube') {
    const genre = p.yt_validate(url);
    if (genre === 'playlist') {
      const liste = await p.playlist_info(url, { incomplete: true });
      const videos = (await liste.all_videos()).slice(0, S.MAX_LOT);
      if (!videos.length) throw new Error('Cette playlist YouTube est vide ou privée.');
      return videos.map((v) => S.piste({
        titre: v.title, url: v.url, duree: v.durationInSec, auteur: v.channel?.name,
        vignette: v.thumbnails?.[0]?.url, source: 'youtube', lienOrigine: url,
      }));
    }
    if (genre !== 'video') throw new Error('Ce lien YouTube n\'est ni une vidéo ni une playlist.');
    try {
      const info = await p.video_basic_info(url);
      const d = info.video_details;
      return [S.piste({
        titre: d.title, url: d.url, duree: d.durationInSec, auteur: d.channel?.name,
        vignette: d.thumbnails?.[0]?.url, source: 'youtube', lienOrigine: url,
      })];
    } catch (err) {
      // play-dl cassé sur ce lien : youtubei.js lit la fiche à sa place.
      const yt = await innertube();
      const id = idYouTube(url);
      if (!yt || !id) throw err;
      const b = (await yt.getBasicInfo(id)).basic_info;
      return [S.piste({
        titre: b.title, url: `https://www.youtube.com/watch?v=${b.id || id}`,
        duree: Number(b.duration) || 0, auteur: b.author || null,
        vignette: b.thumbnail?.[0]?.url || null, source: 'youtube', lienOrigine: url,
      })];
    }
  }

  // ── SoundCloud (diffusé directement) ──
  if (source === 'soundcloud') {
    if (!etat.soundcloud) {
      throw new Error('SoundCloud est indisponible : je n\'ai pas pu obtenir de clé d\'accès. Réessayez dans un instant.');
    }
    const info = await p.soundcloud(url);
    if (info.type === 'playlist') {
      const pistes = (await info.all_tracks()).slice(0, S.MAX_LOT);
      if (!pistes.length) throw new Error('Cette playlist SoundCloud est vide.');
      return pistes.map((t) => S.piste({
        titre: t.name, url: t.url, duree: Math.round((t.durationInMs || 0) / 1000),
        auteur: t.user?.name, vignette: t.thumbnail, source: 'soundcloud', lienOrigine: url,
      }));
    }
    return [S.piste({
      titre: info.name, url: info.url, duree: Math.round((info.durationInMs || 0) / 1000),
      auteur: info.user?.name, vignette: info.thumbnail, source: 'soundcloud', lienOrigine: url,
    })];
  }

  // ── Spotify et Deezer : fiche lue là-bas, audio pris sur YouTube ──
  if (S.RELAYEES.has(source)) {
    const fiches = source === 'spotify' ? await fichesSpotify(url) : await S.ficheDeezer(url);
    if (!fiches.length) throw new Error(`Rien à lire dans ce lien ${S.NOMS[source]}.`);

    // Une par une, en série : ces recherches partent chez YouTube, et le
    // bombarder de cinquante requêtes d'un coup fait tomber les suivantes.
    const pistes = [];
    const introuvables = [];
    for (const fiche of fiches) {
      const v = await chercherSurYouTube(fiche.titre).catch(() => null);
      if (!v) { introuvables.push(fiche.titre); continue; }
      pistes.push(S.piste({
        ...v,
        // On garde le titre de la plateforme d'origine : celui de YouTube est
        // souvent enjolivé (« [Official Video] », « HD », « Lyrics »).
        titre: fiche.titre,
        duree: fiche.duree || v.duree,
        vignette: fiche.vignette || v.vignette,
        source: 'youtube',
        origine: source,
        lienOrigine: url,
      }));
    }
    if (!pistes.length) {
      throw new Error(`Je n'ai trouvé aucun équivalent jouable pour ce lien ${S.NOMS[source]}.`);
    }
    return Object.assign(pistes, { introuvables });
  }

  throw new Error(
    'Ce lien n\'est pas pris en charge.\n'
    + '➜ Sont acceptés : **YouTube**, **SoundCloud**, **Spotify**, **Deezer**, ou une simple recherche.'
  );
}

// Fiches Spotify : par l'API si le serveur a des identifiants (albums et
// listes complètes), sinon par le point d'entrée public (une piste).
async function fichesSpotify(url) {
  const p = play();
  if (etat.spotify) {
    try {
      if (p.is_expired && (await p.is_expired())) await p.refreshToken();
      const sp = await p.spotify(url);
      if (sp.type === 'track') {
        return [{
          titre: `${sp.name} ${sp.artists?.[0]?.name || ''}`.trim(),
          duree: sp.durationInSec,
          vignette: sp.thumbnail?.url || null,
        }];
      }
      const pistes = (await sp.all_tracks()).slice(0, S.MAX_LOT);
      return pistes.map((t) => ({
        titre: `${t.name} ${t.artists?.[0]?.name || ''}`.trim(),
        duree: t.durationInSec,
        vignette: t.thumbnail?.url || null,
      }));
    } catch (err) {
      // On ne s'arrête pas là : le chemin public marche encore pour une piste.
      console.warn(`⚠️ Spotify (API) : ${err.message} — repli sur le lien public.`);
    }
  }
  const fiche = await S.ficheSpotifyPublique(url);
  return [{ titre: fiche.titre, duree: 0, vignette: fiche.vignette }];
}

// ══════════════════════════════════════════════════════════════════
// 🎧 FLUX
// ══════════════════════════════════════════════════════════════════
// 📺 YOUTUBEI.JS — le client YouTube qui ouvre les flux
// ══════════════════════════════════════════════════════════════════
//
// play-dl n'est plus maintenu et son flux YouTube meurt sur « Invalid URL »
// (les changements de signature de YouTube le dépassent). youtubei.js, lui,
// est le client InnerTube entretenu : c'est LUI qui ouvre l'audio, play-dl
// ne reste que la roue de secours — et il garde la recherche et SoundCloud.

let _innertube; // instance partagée : sa création interroge YouTube

async function chargerYoutubei() {
  // Le paquet peut être CJS ou ESM selon la version : on tente les deux.
  try {
    return require('youtubei.js');
  } catch (err) {
    if (err.code !== 'ERR_REQUIRE_ESM') throw err;
    return await import('youtubei.js');
  }
}

async function innertube() {
  if (_innertube !== undefined) return _innertube;
  try {
    const mod = await chargerYoutubei();
    const Innertube = mod.Innertube || mod.default?.Innertube;
    _innertube = await Innertube.create();
  } catch (err) {
    console.warn(`⚠️ Client YouTube (youtubei.js) indisponible : ${err.message} — play-dl servira de secours.`);
    _innertube = null;
  }
  return _innertube;
}

// L'auto-test de la CI s'en sert : un exécutable dont le client YouTube ne
// charge pas ne doit pas être publié.
async function verifierClientYouTube() {
  const mod = await chargerYoutubei();
  const Innertube = mod.Innertube || mod.default?.Innertube;
  if (typeof Innertube?.create !== 'function') throw new Error('module chargé mais API Innertube absente');
}

// L'identifiant d'une vidéo, quel que soit l'habillage du lien.
function idYouTube(url) {
  const m = String(url || '').match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Ouvre l'audio d'une vidéo via youtubei.js. webm/opus de préférence : la
// démux WebmOpus du lecteur le lit sans FFmpeg ; sinon n'importe quel format
// audio, décodé par FFmpeg s'il est là.
async function fluxYouTubeInnertube(morceau) {
  const v = voice();
  const yt = await innertube();
  if (!yt) throw new Error('youtubei.js absent');
  const id = idYouTube(morceau.url);
  if (!id) throw new Error('identifiant vidéo introuvable dans ce lien');
  const { Readable } = require('stream');
  try {
    const flux = await yt.download(id, { type: 'audio', quality: 'best', format: 'webm' });
    return v.createAudioResource(Readable.fromWeb(flux), { inputType: v.StreamType.WebmOpus, inlineVolume: true });
  } catch {
    const flux = await yt.download(id, { type: 'audio', quality: 'best', format: 'any' });
    return v.createAudioResource(Readable.fromWeb(flux), { inputType: v.StreamType.Arbitrary, inlineVolume: true });
  }
}

// Ouvre le flux audio d'une piste et l'emballe pour le lecteur.
//
// `inlineVolume` coûte un peu de calcul mais permet de régler le volume sans
// relancer le morceau — sans lui, /musique volume ne pourrait rien faire.
async function ouvrirFlux(morceau) {
  const p = play();
  const v = voice();

  // 📻 Une radio est un flux MP3/AAC continu servi par la station elle-même.
  // play-dl n'y comprend rien : c'est FFmpeg qui lit l'URL, suit ses
  // redirections et décode son format — puis le lecteur ré-encode en Opus.
  if (morceau.source === 'radio') {
    const souci = ffmpegManquant();
    if (souci) throw new Error(souci);
    return v.createAudioResource(morceau.url, { inputType: v.StreamType.Arbitrary, inlineVolume: true });
  }
  // 📺 YouTube : youtubei.js d'abord, play-dl en secours.
  if (morceau.source === 'youtube') {
    try {
      return await fluxYouTubeInnertube(morceau);
    } catch (err) {
      if (err.message !== 'youtubei.js absent') {
        console.warn(`⚠️ Flux YouTube (youtubei.js) : ${err.message} — essai avec play-dl.`);
      }
    }
  }
  const flux = await p.stream(morceau.url, { discordPlayerCompatibility: false, quality: 2 });
  const ressource = v.createAudioResource(flux.stream, { inputType: flux.type, inlineVolume: true });
  return ressource;
}

// ══════════════════════════════════════════════════════════════════
// 🎛️ FFMPEG — la brique des radios
// ══════════════════════════════════════════════════════════════════
//
// YouTube et SoundCloud arrivent déjà en Opus : pas besoin de FFmpeg. Une
// RADIO, elle, envoie du MP3 ou de l'AAC en continu : il faut FFmpeg pour la
// décoder. On le cherche là où prism-media le cherchera aussi — même ordre,
// donc jamais de « trouvé ici, introuvable là-bas » :
//
//  1. FFMPEG_PATH — posé par l'exécutable quand ffmpeg est à côté de lui ;
//  2. le ffmpeg du système (apt install ffmpeg) ;
//  3. le paquet ffmpeg-static — INUTILISABLE depuis l'exécutable packagé :
//     son binaire vit dans l'instantané pkg, qu'on ne peut pas lancer.
let _ffmpeg;
function cheminFfmpeg() {
  if (_ffmpeg !== undefined) return _ffmpeg;
  const fs = require('fs');
  const { spawnSync } = require('child_process');
  _ffmpeg = null;
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    _ffmpeg = process.env.FFMPEG_PATH;
  } else if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', shell: false }).status === 0) {
    _ffmpeg = 'ffmpeg';
  } else if (!process.pkg) {
    try {
      const statique = require('ffmpeg-static');
      if (statique && fs.existsSync(statique)) _ffmpeg = statique;
    } catch { /* pas installé */ }
  }
  return _ffmpeg;
}

// null si FFmpeg est là — sinon la marche à suivre, différente selon qu'on
// tourne en exécutable (poser le binaire à côté) ou en Node (npm install).
function ffmpegManquant() {
  if (cheminFfmpeg()) return null;
  const lignes = ['La lecture d\'une radio exige **FFmpeg**, introuvable sur cet hébergement.'];
  if (process.pkg) {
    lignes.push('➜ Posez `ffmpeg.exe` (Windows) ou `ffmpeg` (Linux) **à côté du bot**, puis redémarrez-le.');
    lignes.push('➜ Téléchargement officiel : https://ffmpeg.org/download.html');
  } else {
    lignes.push('➜ Sur l\'hébergeur : `apt install ffmpeg` — ou `npm install ffmpeg-static` à côté du bot, puis redémarrez-le.');
  }
  return lignes.join('\n');
}

// ══════════════════════════════════════════════════════════════════
// 🩺 DIAGNOSTIC DES DÉPENDANCES AUDIO
// ══════════════════════════════════════════════════════════════════
//
// @discordjs/voice a besoin de deux briques que rien n'installe tout seul :
//
//  • un ENCODEUR OPUS — sans lui, aucun son ne peut être encodé ;
//  • une bibliothèque de CHIFFREMENT — Discord chiffre la voix, et a retiré
//    les anciens modes. Sans une bibliothèque à jour, la connexion est
//    acceptée par la passerelle puis n'aboutit jamais.
//
// Sans ces briques, `joinVoiceChannel` réussit, la connexion passe en
// « connecting »… et reste là. On voit alors un bot dans le salon, muet, et
// tout DONNE L'IMPRESSION d'un défaut de permissions — alors que les
// permissions n'y sont pour rien.
//
// C'est ce que ce diagnostic sert à dire.
function rapportDependances() {
  const rapport = { texte: null, opus: null, chiffrement: null, ffmpeg: null };
  try {
    const v = voice();
    rapport.texte = typeof v.generateDependencyReport === 'function' ? v.generateDependencyReport() : null;
  } catch (err) {
    rapport.texte = `indisponible : ${err.message}`;
  }

  const trouver = (noms) => {
    for (const nom of noms) {
      try {
        require.resolve(nom);
        return nom;
      } catch { /* suivant */ }
    }
    return null;
  };
  rapport.opus = trouver(['@discordjs/opus', 'opusscript']);
  // Depuis les modes de chiffrement de novembre 2024, Node chiffre la voix
  // TOUT SEUL quand son crypto natif connaît l'AES-256-GCM (Node 18+). Les
  // bibliothèques sodium ne sont plus qu'une roue de secours.
  let natif = false;
  try { natif = require('crypto').getCiphers().includes('aes-256-gcm'); } catch { natif = false; }
  rapport.chiffrement = (natif ? 'crypto natif de Node' : null)
    || trouver(['sodium-native', 'libsodium-wrappers', 'sodium', 'tweetnacl']);
  // 🔊 Depuis mars 2026, Discord EXIGE le chiffrement de bout en bout de la
  // voix (protocole DAVE) : sans la brique @snazzah/davey, le serveur vocal
  // raccroche pendant l'identification avec le code 4017.
  rapport.dave = trouver(['@snazzah/davey']);
  rapport.ffmpeg = cheminFfmpeg();
  return rapport;
}

// Ce qui manque, dit en une phrase actionnable — ou null si tout est là.
function briquesManquantes() {
  const r = rapportDependances();
  const manque = [];
  if (!r.opus) manque.push('un **encodeur Opus** (`npm install opusscript`)');
  if (!r.chiffrement) manque.push('une **bibliothèque de chiffrement** (`npm install libsodium-wrappers`)');
  if (!r.dave) manque.push('la **brique DAVE** — le chiffrement de bout en bout exigé par Discord depuis mars 2026 (`npm install @snazzah/davey`, ou reprenez le dernier exécutable). Sans elle, le serveur vocal raccroche avec le code 4017');
  return manque.length ? manque : null;
}

module.exports = {
  preparer, etatSources, resoudre, chercherSurYouTube, ouvrirFlux, play, voice,
  rapportDependances, briquesManquantes, cheminFfmpeg, ffmpegManquant,
  verifierClientYouTube,
};
