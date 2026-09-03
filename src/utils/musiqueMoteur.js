const S = require('./musiqueSources');

// 🔊 Le moteur : préparer les sources, résoudre un lien, ouvrir un flux.
//
// Tout ce qui touche à l'audio est chargé PARESSEUSEMENT. Le bot doit démarrer
// même sans les bibliothèques audio (exécutable packagé, hébergeur minimal), et
// les tests ne doivent pas les réclamer.

let _play = null;
let _voice = null;
let _ytdl = null;

function play() {
  if (!_play) _play = require('play-dl');
  return _play;
}
function voice() {
  if (!_voice) _voice = require('@discordjs/voice');
  return _voice;
}
function ytdl() {
  if (!_ytdl) _ytdl = require('@distube/ytdl-core');
  return _ytdl;
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
  try {
    const trouves = await p.search(requete, { limit: 1, source: { youtube: 'video' } });
    const v = trouves?.[0];
    if (v?.url) {
      return {
        titre: v.title,
        url: v.url,
        duree: v.durationInSec || 0,
        auteur: v.channel?.name || null,
        vignette: v.thumbnails?.[0]?.url || null,
      };
    }
  } catch (err) {
    console.warn(`⚠️ Recherche YouTube (play-dl) : ${err.message} — essai avec yt-dlp.`);
  }
  // play-dl muet ou cassé : yt-dlp cherche à sa place.
  return ficheYtDlp(`ytsearch1:${requete}`).catch(() => null);
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
      // play-dl cassé sur ce lien : ytdl-core puis yt-dlp lisent la fiche.
      const id = idYouTube(url);
      if (!id) throw err;
      const lien = `https://www.youtube.com/watch?v=${id}`;
      const info = await ytdl().getInfo(lien).catch(() => null);
      const d = info?.videoDetails;
      if (d) {
        return [S.piste({
          titre: d.title, url: d.video_url || lien,
          duree: Number(d.lengthSeconds) || 0, auteur: d.author?.name || null,
          vignette: d.thumbnails?.[d.thumbnails.length - 1]?.url || null,
          source: 'youtube', lienOrigine: url,
        })];
      }
      const fiche = await ficheYtDlp(lien).catch(() => null);
      if (!fiche) throw err;
      return [S.piste({ ...fiche, source: 'youtube', lienOrigine: url })];
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

// Fiches Spotify : par l'API si le serveur a des identifiants, sinon par la
// page embed publique (pistes, albums ET playlists — sans rien configurer),
// et en tout dernier recours l'oEmbed (le titre seul d'une piste).
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
      // On ne s'arrête pas là : le chemin public marche aussi pour une liste.
      console.warn(`⚠️ Spotify (API) : ${err.message} — repli sur le lien public.`);
    }
  }
  try {
    return await S.fichesSpotifyPubliques(url);
  } catch (err) {
    console.warn(`⚠️ Spotify (page publique) : ${err.message} — repli sur le titre seul.`);
  }
  const fiche = await S.ficheSpotifyPublique(url);
  return [{ titre: fiche.titre, duree: 0, vignette: fiche.vignette }];
}

// ══════════════════════════════════════════════════════════════════
// 🎧 FLUX
// ══════════════════════════════════════════════════════════════════
// 📺 YTDL-CORE — le client YouTube qui ouvre les flux
// ══════════════════════════════════════════════════════════════════
//
// play-dl n'est plus maintenu et son flux YouTube meurt sur « Invalid URL »
// (les changements de signature de YouTube le dépassent). @distube/ytdl-core,
// lui, est entretenu : c'est LUI qui ouvre l'audio, play-dl ne reste que la
// roue de secours — et il garde la recherche et SoundCloud.
//
// Pourquoi celui-là et pas youtubei.js ? youtubei.js est un paquet ESM avec
// « await » de haut niveau, que l'exécutable pkg ne peut PAS charger : son
// chargeur ESM ne lit pas l'instantané, et il ne fournit aucun rappel
// d'import dynamique. Trois builds y sont morts. ytdl-core est du CommonJS
// pur : il s'empaquette comme le reste du code.

// L'auto-test de la CI s'en sert : un exécutable dont le client YouTube ne
// charge pas ne doit pas être publié.
async function verifierClientYouTube() {
  const y = ytdl();
  if (typeof y.getInfo !== 'function' || typeof y.chooseFormat !== 'function') {
    throw new Error('module chargé mais API getInfo absente');
  }
}

// L'identifiant d'une vidéo, quel que soit l'habillage du lien.
function idYouTube(url) {
  const m = String(url || '').match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Ouvre l'audio d'une vidéo via ytdl-core. webm/opus de préférence : la
// démux WebmOpus du lecteur le lit sans FFmpeg ; sinon n'importe quel format
// audio, décodé par FFmpeg s'il est là.
async function fluxYouTubeYtdl(morceau) {
  const v = voice();
  const y = ytdl();
  const id = idYouTube(morceau.url);
  if (!id) throw new Error('identifiant vidéo introuvable dans ce lien');
  const info = await y.getInfo(`https://www.youtube.com/watch?v=${id}`);
  // Un gros tampon : le réseau peut hoqueter, pas la lecture.
  const options = { highWaterMark: 1 << 25 };
  try {
    const format = y.chooseFormat(info.formats, {
      quality: 'highestaudio',
      filter: (f) => f.hasAudio && !f.hasVideo && f.container === 'webm' && f.audioCodec === 'opus',
    });
    const flux = y.downloadFromInfo(info, { ...options, format });
    return v.createAudioResource(flux, { inputType: v.StreamType.WebmOpus, inlineVolume: true });
  } catch {
    const format = y.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
    const flux = y.downloadFromInfo(info, { ...options, format });
    return v.createAudioResource(flux, { inputType: v.StreamType.Arbitrary, inlineVolume: true });
  }
}

// ══════════════════════════════════════════════════════════════════
// 📥 YT-DLP — le moteur YouTube qui marche encore en 2026
// ══════════════════════════════════════════════════════════════════
//
// Depuis 2025-2026, YouTube exige des jetons d'origine et bloque les adresses
// IP d'hébergeurs (« Sign in to confirm you're not a bot »). Les bibliothèques
// Node (ytdl-core est archivé, play-dl abandonné) ne suivent plus. Le seul
// outil qui tient le rythme est yt-dlp : un binaire autonome, mis à jour en
// continu par sa communauté.
//
// On applique la recette de FFmpeg : le binaire vit À CÔTÉ du bot. S'il n'y
// est pas, on le télécharge depuis ses releases GitHub (même mécanique que la
// mise à jour du bot lui-même) ; s'il a plus de sept jours, il se met à jour
// tout seul (`yt-dlp -U`) — c'est cette fraîcheur qui fait que « les autres
// bots marchent » : ils remettent leur extracteur à jour sans arrêt.
//
//  • YTDLP_PATH (.env) impose un binaire précis — jamais touché par nous ;
//  • YTDLP_COOKIES (.env) pointe un fichier de cookies exporté d'un
//    navigateur, la parade officielle au contrôle anti-robot.

function dossierBot() {
  const path = require('path');
  if (process.env.BOT_DIR) return process.env.BOT_DIR;
  return process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..', '..');
}

let _cheminYtDlp;
function cheminYtDlp() {
  if (_cheminYtDlp !== undefined) return _cheminYtDlp;
  const fs = require('fs');
  const path = require('path');
  const { spawnSync } = require('child_process');
  _cheminYtDlp = null;
  const local = path.join(dossierBot(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    _cheminYtDlp = process.env.YTDLP_PATH;
  } else if (fs.existsSync(local)) {
    _cheminYtDlp = local;
  } else if (spawnSync('yt-dlp', ['--version'], { stdio: 'ignore', shell: false }).status === 0) {
    _cheminYtDlp = 'yt-dlp';
  }
  return _cheminYtDlp;
}

// Télécharge le binaire AUTONOME (aucun Python à installer) à côté du bot.
// Une seule descente à la fois : dix lectures simultanées ne doivent pas
// écrire dix fois le même fichier.
let _descenteYtDlp = null;
function assurerYtDlp() {
  const present = cheminYtDlp();
  if (present) return Promise.resolve(present);
  if (!_descenteYtDlp) {
    _descenteYtDlp = (async () => {
      const fs = require('fs');
      const path = require('path');
      const asset = process.platform === 'win32' ? 'yt-dlp.exe'
        : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux';
      const cible = path.join(dossierBot(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
      console.log('⬇️ Première lecture YouTube : téléchargement de yt-dlp (le lecteur maintenu)…');
      const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, {
        headers: { 'User-Agent': 'discord-roblox-rp-bot' },
      });
      if (!res.ok) throw new Error(`téléchargement de yt-dlp impossible (HTTP ${res.status})`);
      const provisoire = `${cible}.download`;
      fs.writeFileSync(provisoire, Buffer.from(await res.arrayBuffer()));
      if (process.platform !== 'win32') fs.chmodSync(provisoire, 0o755);
      fs.renameSync(provisoire, cible);
      _cheminYtDlp = cible;
      console.log('✅ yt-dlp installé à côté du bot.');
      return cible;
    })().catch((err) => {
      _descenteYtDlp = null; // un échec réseau ne condamne pas les essais suivants
      throw err;
    });
  }
  return _descenteYtDlp;
}

// YouTube casse ses clients toutes les quelques semaines : un yt-dlp d'il y a
// deux mois est un yt-dlp mort. Une fois par démarrage, s'il a plus de sept
// jours, on le laisse se remettre à jour lui-même.
let _fraicheurVerifiee = false;
async function rafraichirYtDlp(bin) {
  if (_fraicheurVerifiee) return;
  _fraicheurVerifiee = true;
  try {
    if (bin === 'yt-dlp' || process.env.YTDLP_PATH) return; // pas le nôtre : on n'y touche pas
    const fs = require('fs');
    if (Date.now() - fs.statSync(bin).mtimeMs < 7 * 24 * 3600 * 1000) return;
    console.log('🔄 yt-dlp a plus de sept jours : mise à jour…');
    const { spawn } = require('child_process');
    await new Promise((fini) => {
      const p = spawn(bin, ['-U'], { stdio: 'ignore' });
      const garde = setTimeout(() => { p.kill(); fini(); }, 30000);
      p.on('close', () => { clearTimeout(garde); fini(); });
      p.on('error', () => { clearTimeout(garde); fini(); });
    });
  } catch { /* au mieux : un échec ici ne doit rien empêcher */ }
}

// Transforme la sortie d'erreur brute de yt-dlp en phrase actionnable.
function erreurYtDlp(brut, code) {
  const texte = String(brut || '');
  if (/sign in to confirm/i.test(texte)) {
    return 'YouTube bloque l\'adresse IP de cet hébergement (contrôle anti-robot). '
      + 'Réessayez plus tard — si ça persiste, exportez les cookies YouTube d\'un navigateur '
      + 'et posez le chemin du fichier dans `YTDLP_COOKIES` (fichier .env du bot).';
  }
  const ligne = texte.split('\n').reverse().find((l) => l.trim().startsWith('ERROR:'));
  if (ligne) return ligne.replace(/^\s*ERROR:\s*/, '').trim();
  return `yt-dlp s'est arrêté (code ${code}) sans explication`;
}

// Lit la FICHE d'un lien (ou d'une recherche `ytsearch1:`) via `yt-dlp -J`.
async function ficheYtDlp(cible) {
  const bin = cheminYtDlp() || await assurerYtDlp();
  const args = ['-J', '--no-warnings'];
  if (!/^ytsearch/.test(cible)) args.push('--no-playlist');
  if (process.env.YTDLP_COOKIES) args.push('--cookies', process.env.YTDLP_COOKIES);
  args.push(cible);
  const { execFile } = require('child_process');
  const brut = await new Promise((livrer, rejeter) => {
    execFile(bin, args, { maxBuffer: 16 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) rejeter(new Error(erreurYtDlp(stderr || err.message, err.code)));
      else livrer(stdout);
    });
  });
  let d = JSON.parse(brut);
  if (Array.isArray(d.entries)) d = d.entries[0];
  if (!d) throw new Error('aucun résultat');
  return {
    titre: d.title,
    url: d.webpage_url || (d.id ? `https://www.youtube.com/watch?v=${d.id}` : cible),
    duree: Math.round(d.duration || 0),
    auteur: d.uploader || d.channel || null,
    vignette: d.thumbnail || d.thumbnails?.[d.thumbnails.length - 1]?.url || null,
  };
}

// Ouvre l'audio d'une vidéo via yt-dlp. Avec FFmpeg (déjà exigé par les
// radios), n'importe quel format audio passe ; sans lui, on impose l'opus/webm
// que le lecteur sait démuxer tout seul.
async function fluxYouTubeYtDlp(morceau) {
  const v = voice();
  const bin = cheminYtDlp() || await assurerYtDlp();
  await rafraichirYtDlp(bin);
  const avecFfmpeg = !!cheminFfmpeg();
  const args = [
    '--no-playlist', '--no-warnings', '--quiet',
    '-f', avecFfmpeg ? 'bestaudio/best' : 'bestaudio[acodec=opus]',
    '-o', '-',
  ];
  if (process.env.YTDLP_COOKIES) args.push('--cookies', process.env.YTDLP_COOKIES);
  args.push(morceau.url);
  const { spawn } = require('child_process');
  const enfant = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let sortieErreur = '';
  enfant.stderr.on('data', (d) => { sortieErreur = (sortieErreur + d).slice(-4000); });
  // On attend le PREMIER octet d'audio avant de rendre la main : c'est lui qui
  // sépare « ça joue » d'un refus de YouTube — qu'on veut pouvoir raconter.
  await new Promise((pret, rejeter) => {
    let demarre = false;
    const garde = setTimeout(() => {
      if (!demarre) { enfant.kill(); rejeter(new Error('yt-dlp n\'a renvoyé aucun son en 30 secondes')); }
    }, 30000);
    enfant.stdout.once('data', (premier) => {
      demarre = true;
      clearTimeout(garde);
      enfant.stdout.pause();
      enfant.stdout.unshift(premier);
      pret();
    });
    enfant.once('error', (err) => { clearTimeout(garde); rejeter(err); });
    enfant.once('close', (code) => {
      clearTimeout(garde);
      if (!demarre) rejeter(new Error(erreurYtDlp(sortieErreur, code)));
    });
  });
  return v.createAudioResource(enfant.stdout, {
    inputType: avecFfmpeg ? v.StreamType.Arbitrary : v.StreamType.WebmOpus,
    inlineVolume: true,
  });
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
  // 📺 YouTube : yt-dlp d'abord (le seul qui tienne face aux protections de
  // 2026), puis ytdl-core, puis play-dl. Si TOUT échoue, on raconte la
  // première cause — c'est elle que l'utilisateur peut comprendre et agir.
  if (morceau.source === 'youtube') {
    let cause = null;
    try {
      return await fluxYouTubeYtDlp(morceau);
    } catch (err) {
      cause = err.message;
      console.warn(`⚠️ Flux YouTube (yt-dlp) : ${err.message} — essai avec ytdl-core.`);
    }
    try {
      return await fluxYouTubeYtdl(morceau);
    } catch (err) {
      console.warn(`⚠️ Flux YouTube (ytdl-core) : ${err.message} — essai avec play-dl.`);
    }
    try {
      const flux = await p.stream(morceau.url, { discordPlayerCompatibility: false, quality: 2 });
      return v.createAudioResource(flux.stream, { inputType: flux.type, inlineVolume: true });
    } catch (err) {
      console.warn(`⚠️ Flux YouTube (play-dl) : ${err.message} — plus aucun secours.`);
      throw new Error(cause || err.message);
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
  // 📥 Le lecteur YouTube. Absent n'est pas grave : il se télécharge tout
  // seul à la première lecture — le diagnostic le dit.
  rapport.ytdlp = cheminYtDlp();
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
  verifierClientYouTube, cheminYtDlp, assurerYtDlp, ficheYtDlp,
};
