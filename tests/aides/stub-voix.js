// 🔇 Un @discordjs/voice et un play-dl de laboratoire.
//
// Les vraies bibliothèques ouvrent une connexion UDP vers Discord et vont
// chercher de l'audio sur internet : impossible à faire tourner dans un test.
// Ce faux, lui, NOTE ce qu'on lui demande — c'est exactement ce qu'on veut
// vérifier : a-t-on attendu que la connexion soit prête ? a-t-on joué ?
const { EventEmitter } = require('events');

const journal = [];

const VoiceConnectionStatus = {
  Signalling: 'signalling', Connecting: 'connecting', Ready: 'ready',
  Disconnected: 'disconnected', Destroyed: 'destroyed',
};
const AudioPlayerStatus = { Idle: 'idle', Buffering: 'buffering', Playing: 'playing', Paused: 'paused' };
const NoSubscriberBehavior = { Pause: 'pause', Play: 'play', Stop: 'stop' };

// Réglages du laboratoire, modifiables par chaque test.
const reglages = {
  connexionPrete: true,   // la connexion atteint-elle l'état « prêt » ?
  fluxCasse: false,       // play.stream lève-t-il ?
  fluxCassePour: null,    // … ou seulement pour cette URL
};

class FausseConnexion extends EventEmitter {
  constructor(opts) { super(); this.opts = opts; this.detruite = false; this.abonne = null; }
  subscribe(lecteur) { this.abonne = lecteur; journal.push(['subscribe']); return { unsubscribe() {} }; }
  destroy() { this.detruite = true; journal.push(['destroy']); }
}

class FauxLecteur extends EventEmitter {
  constructor(opts) { super(); this.opts = opts; this.enPause = false; this.ressource = null; }
  play(r) { this.ressource = r; this.enPause = false; journal.push(['play', r?.morceau || null]); }
  pause() { this.enPause = true; journal.push(['pause']); return true; }
  unpause() { this.enPause = false; journal.push(['unpause']); return true; }
  stop() { journal.push(['stop']); this.ressource = null; return true; }
  // Simule la fin d'un morceau, comme Discord le ferait.
  terminer() { this.emit(AudioPlayerStatus.Idle); }
}

const voix = {
  VoiceConnectionStatus, AudioPlayerStatus, NoSubscriberBehavior,
  joinVoiceChannel(opts) { journal.push(['join', opts.channelId]); return new FausseConnexion(opts); },
  createAudioPlayer(opts) { journal.push(['createPlayer']); return new FauxLecteur(opts); },
  createAudioResource(flux, opts) {
    journal.push(['resource', opts?.inputType]);
    return {
      morceau: flux?.morceau || null,
      playbackDuration: 0,
      volume: opts?.inlineVolume ? { valeur: 1, setVolume(v) { this.valeur = v; journal.push(['volume', v]); } } : null,
    };
  },
  async entersState(connexion, etat, delai) {
    journal.push(['entersState', etat]);
    if (etat === VoiceConnectionStatus.Ready && !reglages.connexionPrete) {
      throw new Error('délai dépassé');
    }
    return connexion;
  },
};

// play-dl de laboratoire : répond sans réseau, et note les requêtes.
const play = {
  appels: [],
  async getFreeClientID() { play.appels.push('getFreeClientID'); return 'CLIENT_ID_TEST'; },
  async setToken(t) { play.appels.push(`setToken:${Object.keys(t).join(',')}`); },
  yt_validate(url) {
    if (/list=/.test(url)) return 'playlist';
    return /youtu\.?be/.test(url) ? 'video' : false;
  },
  async video_basic_info(url) {
    return { video_details: { title: 'Titre YouTube', url, durationInSec: 210, channel: { name: 'Chaîne' }, thumbnails: [{ url: 'https://img/y.jpg' }] } };
  },
  async playlist_info(url) {
    return {
      async all_videos() {
        return Array.from({ length: 3 }, (_, i) => ({
          title: `Playlist ${i + 1}`, url: `https://youtu.be/pl${i}`, durationInSec: 100 + i,
          channel: { name: 'Chaîne' }, thumbnails: [{ url: 'https://img/p.jpg' }],
        }));
      },
    };
  },
  async soundcloud(url) {
    if (/\/sets\//.test(url)) {
      return {
        type: 'playlist',
        async all_tracks() {
          return [
            { name: 'SC un', url: 'https://soundcloud.com/a/1', durationInMs: 120000, user: { name: 'Artiste' }, thumbnail: 'https://img/s.jpg' },
            { name: 'SC deux', url: 'https://soundcloud.com/a/2', durationInMs: 130000, user: { name: 'Artiste' }, thumbnail: 'https://img/s.jpg' },
          ];
        },
      };
    }
    return { type: 'track', name: 'Piste SoundCloud', url, durationInMs: 185000, user: { name: 'Artiste SC' }, thumbnail: 'https://img/sc.jpg' };
  },
  async search(requete, opts) {
    play.appels.push(`search:${requete}`);
    if (/introuvable/i.test(requete)) return [];
    return [{
      title: `YT pour ${requete}`, url: `https://youtu.be/${encodeURIComponent(requete).slice(0, 11)}`,
      durationInSec: 200, channel: { name: 'Chaîne YT' }, thumbnails: [{ url: 'https://img/r.jpg' }],
    }];
  },
  async stream(url) {
    play.appels.push(`stream:${url}`);
    if (reglages.fluxCasse || (reglages.fluxCassePour && url === reglages.fluxCassePour)) {
      throw new Error('flux indisponible');
    }
    return { stream: { morceau: url }, type: 'opus' };
  },
};

function reinitialiser() {
  journal.length = 0;
  play.appels.length = 0;
  reglages.connexionPrete = true;
  reglages.fluxCasse = false;
  reglages.fluxCassePour = null;
}

module.exports = { voix, play, journal, reglages, reinitialiser, FauxLecteur, FausseConnexion };
