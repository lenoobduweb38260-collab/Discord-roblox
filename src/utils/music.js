// Système de musique vocale (façon Rythm). Toutes les dépendances audio
// (@discordjs/voice, play-dl, opus, chiffrement) sont chargées PARESSEUSEMENT :
// le bot démarre normalement même si elles manquent, et l'auto-test de la CI
// ne les touche pas. Si elles sont absentes, /musique le signale proprement.

const queues = new Map(); // guildId -> { connection, player, songs:[], textChannelId, voiceChannelId }

function libs() {
  // Peut lever si les libs ne sont pas disponibles (ex : exécutable pkg).
  const voice = require('@discordjs/voice');
  const play = require('play-dl');
  return { voice, play };
}

// Résout une requête (lien YouTube/SoundCloud/Spotify/Deezer ou recherche
// texte) en { title, url } jouable (Spotify/Deezer → recherche YouTube).
async function resolve(play, query) {
  const q = query.trim();
  if (/^https?:\/\//i.test(q)) {
    if (play.yt_validate(q) === 'video') {
      const info = await play.video_basic_info(q);
      return { title: info.video_details.title, url: info.video_details.url };
    }
    if (play.so_validate && (await play.so_validate(q)) === 'track') {
      const info = await play.soundcloud(q);
      return { title: info.name, url: info.url };
    }
    if (play.sp_validate && play.sp_validate(q) !== false) {
      const sp = await play.spotify(q);
      const name = `${sp.name || ''} ${sp.artists?.[0]?.name || ''}`.trim();
      const found = await play.search(name || q, { limit: 1 });
      if (found[0]) return { title: found[0].title, url: found[0].url };
    }
    // Deezer / autre : on tente une recherche par l'URL elle-même
    const r = await play.search(q, { limit: 1 });
    if (r[0]) return { title: r[0].title, url: r[0].url };
    throw new Error('Lien non pris en charge.');
  }
  const r = await play.search(q, { limit: 1 });
  if (!r[0]) throw new Error('Aucun résultat.');
  return { title: r[0].title, url: r[0].url };
}

async function startNext(guildId, client) {
  const { voice, play } = libs();
  const q = queues.get(guildId);
  if (!q) return;
  const song = q.songs[0];
  if (!song) {
    q.connection.destroy();
    queues.delete(guildId);
    return;
  }
  const streamed = await play.stream(song.url);
  const resource = voice.createAudioResource(streamed.stream, { inputType: streamed.type });
  q.player.play(resource);
}

async function add(interaction, query) {
  const { voice, play } = libs();
  const member = interaction.member;
  const vc = member?.voice?.channel;
  if (!vc) throw new Error('Rejoignez d\'abord un salon vocal.');

  const song = await resolve(play, query);
  let q = queues.get(interaction.guildId);
  if (!q) {
    const connection = voice.joinVoiceChannel({
      channelId: vc.id,
      guildId: interaction.guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    const player = voice.createAudioPlayer();
    connection.subscribe(player);
    q = { connection, player, songs: [], textChannelId: interaction.channelId, voiceChannelId: vc.id };
    queues.set(interaction.guildId, q);

    player.on(voice.AudioPlayerStatus.Idle, () => {
      q.songs.shift();
      startNext(interaction.guildId, interaction.client).catch(() => {
        q.connection.destroy();
        queues.delete(interaction.guildId);
      });
    });
    player.on('error', (err) => console.warn(`⚠️ Lecteur audio : ${err.message}`));
  }

  q.songs.push(song);
  if (q.songs.length === 1) await startNext(interaction.guildId, interaction.client);
  return { song, position: q.songs.length };
}

function skip(guildId) {
  const q = queues.get(guildId);
  if (!q) return false;
  q.player.stop(); // déclenche Idle → morceau suivant
  return true;
}
function stop(guildId) {
  const q = queues.get(guildId);
  if (!q) return false;
  q.songs = [];
  q.player.stop();
  q.connection.destroy();
  queues.delete(guildId);
  return true;
}
function pause(guildId) {
  const q = queues.get(guildId);
  return q ? q.player.pause() : false;
}
function resume(guildId) {
  const q = queues.get(guildId);
  return q ? q.player.unpause() : false;
}
function list(guildId) {
  return queues.get(guildId)?.songs || [];
}

module.exports = { add, skip, stop, pause, resume, list };
