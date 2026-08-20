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
    const info = await p.video_basic_info(url);
    const d = info.video_details;
    return [S.piste({
      titre: d.title, url: d.url, duree: d.durationInSec, auteur: d.channel?.name,
      vignette: d.thumbnails?.[0]?.url, source: 'youtube', lienOrigine: url,
    })];
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

// Ouvre le flux audio d'une piste et l'emballe pour le lecteur.
//
// `inlineVolume` coûte un peu de calcul mais permet de régler le volume sans
// relancer le morceau — sans lui, /musique volume ne pourrait rien faire.
async function ouvrirFlux(morceau) {
  const p = play();
  const v = voice();
  const flux = await p.stream(morceau.url, { discordPlayerCompatibility: false, quality: 2 });
  const ressource = v.createAudioResource(flux.stream, { inputType: flux.type, inlineVolume: true });
  return ressource;
}

module.exports = {
  preparer, etatSources, resoudre, chercherSurYouTube, ouvrirFlux, play, voice,
};
