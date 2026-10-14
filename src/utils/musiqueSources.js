// 🎵 D'un lien à quelque chose de jouable.
//
// ⚠️ Le point qu'il faut connaître avant de lire la suite : **Spotify et
// Deezer ne laissent personne diffuser leur audio.** Ce n'est pas une limite
// du bot, c'est leur licence — leurs flux sont chiffrés et réservés à leurs
// propres applications. Aucun bot Discord ne lit un flux Spotify, quel que
// soit ce qu'il affiche.
//
// Ce que tout le monde fait, et ce que nous faisons : on lit la FICHE du lien
// (titre, artiste, durée), puis on joue la même chanson depuis YouTube. Le
// résultat est le bon morceau ; la source, elle, est YouTube. Le bot le dit
// dans sa réponse — un utilisateur qui croit écouter Spotify et entend autre
// chose penserait à un défaut.
//
// YouTube et SoundCloud, eux, se lisent directement.
//
//   Lien                 │ Fiche lue chez    │ Audio diffusé depuis
//   ─────────────────────┼───────────────────┼─────────────────────
//   YouTube              │ YouTube           │ YouTube
//   SoundCloud           │ SoundCloud        │ SoundCloud
//   Spotify              │ Spotify           │ YouTube (équivalent)
//   Deezer               │ Deezer            │ YouTube (équivalent)
//   Texte libre          │ —                 │ YouTube (recherche)

const MOTIFS = [
  { source: 'youtube', re: /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i },
  { source: 'spotify', re: /^(https?:\/\/)?(open\.)?spotify\.com\//i },
  { source: 'deezer', re: /^(https?:\/\/)?(www\.)?deezer\.com\//i },
  { source: 'soundcloud', re: /^(https?:\/\/)?(www\.|m\.)?soundcloud\.com\//i },
];

// Reconnaît la plateforme SANS appeler personne : une requête réseau pour
// savoir de quel site parle un lien serait absurde, et retarderait la réponse.
function reconnaitre(requete) {
  const q = String(requete || '').trim();
  if (!/^https?:\/\//i.test(q)) return { source: 'recherche', url: null, requete: q };
  for (const { source, re } of MOTIFS) {
    if (re.test(q)) return { source, url: q, requete: q };
  }
  return { source: 'inconnu', url: q, requete: q };
}

// Les plateformes dont on ne peut lire QUE la fiche.
const RELAYEES = new Set(['spotify', 'deezer']);
const NOMS = {
  youtube: 'YouTube', spotify: 'Spotify', deezer: 'Deezer',
  soundcloud: 'SoundCloud', recherche: 'Recherche', inconnu: 'Lien inconnu',
  radio: 'Radio en direct',
};

// Une piste, telle que la file d'attente la manipule.
// `url` est TOUJOURS lisible : c'est elle qu'on donnera au lecteur.
const piste = ({ titre, url, duree = 0, auteur = null, vignette = null, source, origine = null, lienOrigine = null }) => ({
  titre: String(titre || 'Titre inconnu').slice(0, 200),
  url,
  duree: Number(duree) || 0,
  auteur: auteur || null,
  vignette: vignette || null,
  source,                 // d'où vient l'AUDIO
  origine: origine || source, // ce que la personne a demandé
  lienOrigine,            // son lien, pour pouvoir le rappeler
});

// ── Spotify sans identifiants ────────────────────────────────────
//
// L'API Spotify demande un compte développeur, ce que peu d'hébergeurs
// configurent. Mais Spotify expose un point d'entrée PUBLIC et sans clé —
// celui qu'utilisent les intégrations de blog — qui donne le titre d'un lien.
// C'est peu, et c'est exactement ce qu'il nous faut : le titre suffit à
// retrouver la chanson.
async function ficheSpotifyPublique(url) {
  const reponse = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
    headers: { 'User-Agent': 'discord-roblox-rp-bot' },
    signal: AbortSignal.timeout(8000),
  });
  if (!reponse.ok) throw new Error(`Spotify a répondu ${reponse.status}`);
  const data = await reponse.json();
  if (!data?.title) throw new Error('Spotify n\'a pas donné de titre');
  return { titre: String(data.title), vignette: data.thumbnail_url || null };
}

// La page EMBED publique — celle des lecteurs intégrés aux blogs — porte un
// JSON complet (« __NEXT_DATA__ ») : pour une playlist ou un album, il liste
// les titres avec artiste et durée. C'est ce qui permet de lire une liste
// entière SANS identifiants d'application, là où l'oEmbed ne donne que le nom
// de la liste — introuvable sur YouTube.
const SPOTIFY = /open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[A-Za-z]{2})?\/)?(track|album|playlist)\/([A-Za-z0-9]+)/i;

// Extrait les fiches du HTML d'une page embed. Séparée du réseau pour être
// testable : le format du JSON a déjà changé, un test fixe le contrat.
function extraireEmbedSpotify(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ''));
  if (!m) throw new Error('page Spotify sans données');
  const entite = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
  if (!entite) throw new Error('données Spotify sans entité');
  const sources = entite.coverArt?.sources || [];
  const vignette = sources[sources.length - 1]?.url || sources[0]?.url || null;
  if (Array.isArray(entite.trackList) && entite.trackList.length) {
    return entite.trackList.slice(0, MAX_LOT).map((t) => ({
      titre: `${t.title || ''} ${t.subtitle || ''}`.trim(),
      duree: Math.round((Number(t.duration) || 0) / 1000),
      vignette,
    })).filter((t) => t.titre);
  }
  const artistes = (entite.artists || []).map((a) => a?.name).filter(Boolean).join(' ');
  const titre = `${entite.title || entite.name || ''} ${artistes || entite.subtitle || ''}`.trim();
  if (!titre) throw new Error('fiche Spotify sans titre');
  return [{ titre, duree: Math.round((Number(entite.duration) || 0) / 1000), vignette }];
}

async function fichesSpotifyPubliques(url) {
  const m = SPOTIFY.exec(url);
  if (!m) throw new Error('Lien Spotify non reconnu (piste, album ou playlist attendus)');
  const [, genre, id] = m;
  const reponse = await fetch(`https://open.spotify.com/embed/${genre}/${id}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'fr,en;q=0.8',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!reponse.ok) throw new Error(`Spotify a répondu ${reponse.status}`);
  const fiches = extraireEmbedSpotify(await reponse.text());
  if (!fiches.length) throw new Error('Cette sélection Spotify est vide');
  return fiches;
}

// ── Deezer sans identifiants ─────────────────────────────────────
//
// L'API publique de Deezer ne demande aucune clé. On y va directement plutôt
// que de dépendre d'une bibliothèque : un lien de piste, d'album ou de liste
// se lit de la même façon, et la réponse est stable depuis des années.
const DEEZER = /deezer\.com\/(?:[a-z]{2}\/)?(track|album|playlist)\/(\d+)/i;

async function ficheDeezer(url) {
  const m = DEEZER.exec(url);
  if (!m) throw new Error('Lien Deezer non reconnu');
  const [, genre, id] = m;
  const reponse = await fetch(`https://api.deezer.com/${genre}/${id}`, {
    headers: { 'User-Agent': 'discord-roblox-rp-bot' },
    signal: AbortSignal.timeout(8000),
  });
  if (!reponse.ok) throw new Error(`Deezer a répondu ${reponse.status}`);
  const data = await reponse.json();
  if (data?.error) throw new Error(data.error.message || 'Deezer a refusé');

  if (genre === 'track') {
    return [{ titre: `${data.title} ${data.artist?.name || ''}`.trim(), duree: data.duration, vignette: data.album?.cover_medium || null }];
  }
  // Album ou liste : `tracks.data` porte les pistes. On borne, sinon une
  // playlist de 400 titres bloquerait la commande le temps de tout chercher.
  const pistes = (data.tracks?.data || []).slice(0, MAX_LOT);
  if (!pistes.length) throw new Error('Cette sélection Deezer est vide');
  return pistes.map((t) => ({
    titre: `${t.title} ${t.artist?.name || ''}`.trim(),
    duree: t.duration,
    vignette: data.cover_medium || null,
  }));
}

// Une liste entière prend une recherche YouTube PAR TITRE : au-delà, la
// commande mettrait plusieurs minutes à répondre.
const MAX_LOT = 50;

module.exports = {
  reconnaitre, RELAYEES, NOMS, piste, ficheSpotifyPublique, ficheDeezer, MAX_LOT, DEEZER,
  SPOTIFY, extraireEmbedSpotify, fichesSpotifyPubliques,
};
