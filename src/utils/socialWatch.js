const { db } = require('../database');

// Annonces réseaux sociaux : le bot suit des chaînes/comptes (YouTube, Twitch,
// TikTok, X, Reddit) et annonce dans le salon configuré quand un stream démarre
// ou qu'une nouvelle vidéo/publication sort. Vérification toutes les 5 minutes.
// À la première vérification d'un flux, le contenu existant est mémorisé sans
// être annoncé (pas de spam d'anciennes vidéos).

const PLATFORMS = {
  youtube: { emoji: '▶️', label: 'YouTube' },
  twitch: { emoji: '🟣', label: 'Twitch' },
  tiktok: { emoji: '🎵', label: 'TikTok' },
  x: { emoji: '🐦', label: 'X (Twitter)' },
  reddit: { emoji: '👽', label: 'Reddit' },
};

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const UA_BOT = 'discord-roblox-rp-bot';
const UA_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const listFeeds = db.prepare('SELECT * FROM social_feeds ORDER BY id');
const listGuildFeeds = db.prepare('SELECT * FROM social_feeds WHERE guild_id = ? ORDER BY id');
const getFeed = db.prepare('SELECT * FROM social_feeds WHERE id = ?');
const insertFeed = db.prepare(
  'INSERT INTO social_feeds (guild_id, platform, handle, channel_id, message, meta) VALUES (?, ?, ?, ?, ?, ?)'
);
const deleteFeed = db.prepare('DELETE FROM social_feeds WHERE id = ? AND guild_id = ?');
const setLast = db.prepare('UPDATE social_feeds SET last_item = ? WHERE id = ?');

async function fetchText(url, browser = false) {
  const res = await fetch(url, {
    headers: { 'User-Agent': browser ? UA_BROWSER : UA_BOT, 'Accept-Language': 'fr,en;q=0.8' },
    signal: AbortSignal.timeout(8000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ----- Résolution YouTube : N'IMPORTE QUEL lien retrouve la chaîne -----
// Acceptés : ID « UC… », @pseudo, lien de chaîne (/channel/, /@, /c/, /user/),
// lien de VIDÉO (youtube.com/watch, youtu.be, shorts) — la page contient
// toujours l'ID de la chaîne, on le retrouve dedans.
async function resolveYouTubeChannel(input) {
  const s = input.trim();
  const direct = s.match(/(UC[\w-]{22})/);
  if (direct) return direct[1];
  const url = /^https?:\/\//i.test(s) ? s : `https://www.youtube.com/${s.startsWith('@') ? s : `@${s}`}`;
  const html = await fetchText(url, true).catch(() => null);
  if (!html) return null;
  const m = html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/);
  return m ? m[1] : null;
}

// Nom réel de la chaîne YouTube (titre de son flux RSS) pour l'affichage.
async function fetchYouTubeTitle(channelId) {
  try {
    const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    return xml.match(/<title>([^<]+)<\/title>/)?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

// ----- Dernier contenu d'un flux, par plateforme -----
async function fetchLatest(feed) {
  const meta = (() => {
    try {
      return JSON.parse(feed.meta || '{}');
    } catch {
      return {};
    }
  })();

  if (feed.platform === 'youtube') {
    const channelId = meta.channelId || feed.handle;
    const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
    if (!entry) return null;
    const id = entry.match(/<yt:videoId>([\w-]+)<\/yt:videoId>/)?.[1];
    const title = entry.match(/<title>([^<]*)<\/title>/)?.[1];
    if (!id) return null;
    return { id, title: title || null, url: `https://www.youtube.com/watch?v=${id}` };
  }

  if (feed.platform === 'twitch') {
    const login = feed.handle;
    const uptime = (await fetchText(`https://decapi.me/twitch/uptime/${encodeURIComponent(login)}`)).trim();
    const live = Boolean(uptime) && !/offline|error|not found|cannot find|no user/i.test(uptime);
    let title = null;
    if (live) {
      title = (await fetchText(`https://decapi.me/twitch/title/${encodeURIComponent(login)}`).catch(() => '')).trim() || null;
    }
    return { live, title, url: `https://www.twitch.tv/${login}` };
  }

  if (feed.platform === 'reddit') {
    const h = feed.handle.replace(/^\//, '');
    const path = h.startsWith('u/') ? `user/${h.slice(2)}/submitted` : `r/${h.replace(/^r\//, '')}/new`;
    const json = JSON.parse(await fetchText(`https://www.reddit.com/${path}.json?limit=1`));
    const post = json?.data?.children?.[0]?.data;
    if (!post) return null;
    return { id: post.name, title: post.title || null, url: `https://www.reddit.com${post.permalink}` };
  }

  if (feed.platform === 'tiktok') {
    const user = feed.handle.replace(/^@/, '');
    const html = await fetchText(`https://www.tiktok.com/@${user}`, true);
    const id = html.match(/\/video\/(\d{10,})/)?.[1];
    if (!id) return null;
    return { id, title: null, url: `https://www.tiktok.com/@${user}/video/${id}` };
  }

  if (feed.platform === 'x') {
    const user = feed.handle.replace(/^@/, '');
    const html = await fetchText(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${user}`, true);
    const id = html.match(/status\/(\d{10,})/)?.[1];
    if (!id) return null;
    return { id, title: null, url: `https://x.com/${user}/status/${id}` };
  }

  return null;
}

// Message d'annonce : personnalisé (variables {nom}, {lien}, {titre}) ou défaut.
function buildAnnouncement(feed, latest) {
  const p = PLATFORMS[feed.platform];
  const defaults = {
    youtube: `▶️ **{nom}** vient de sortir une nouvelle vidéo !`,
    twitch: `🔴 **{nom}** est en live sur Twitch !`,
    tiktok: `🎵 Nouveau TikTok de **{nom}** !`,
    x: `🐦 Nouveau post de **{nom}** sur X !`,
    reddit: `👽 Nouveau post sur **{nom}** !`,
  };
  let text = (feed.message?.trim() || defaults[feed.platform] || `${p.emoji} Nouveau contenu de **{nom}** !`)
    .replace(/\{nom\}/g, feed.handle)
    .replace(/\{titre\}/g, latest.title || '')
    .replace(/\{lien\}/g, latest.url);
  if (latest.title && !feed.message?.includes('{titre}')) text += `\n📄 ${latest.title}`;
  if (!text.includes(latest.url)) text += `\n${latest.url}`;
  return text;
}

async function checkFeed(client, feed) {
  const latest = await fetchLatest(feed);
  if (!latest) return;

  if (feed.platform === 'twitch') {
    const state = latest.live ? 'live' : 'off';
    if (feed.last_item === state) return; // pas de changement
    setLast.run(state, feed.id);
    if (!latest.live) return; // fin de live : silencieux
  } else {
    if (!latest.id || feed.last_item === latest.id) return;
    const firstCheck = feed.last_item === null;
    setLast.run(latest.id, feed.id);
    if (firstCheck) return; // première vérification : mémorisation silencieuse
  }

  const guild = client.guilds.cache.get(feed.guild_id);
  const channel = guild?.channels.cache.get(feed.channel_id);
  if (!channel?.isTextBased()) return;
  await channel.send({ content: buildAnnouncement(feed, latest) }).catch(() => null);
}

async function checkAll(client) {
  for (const feed of listFeeds.all()) {
    try {
      await checkFeed(client, feed);
    } catch (err) {
      console.warn(`⚠️ Réseaux ${feed.platform}/${feed.handle} : ${err.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500)); // politesse entre requêtes
  }
}

// À appeler une fois le bot connecté.
function start(client) {
  setTimeout(() => checkAll(client).catch(() => null), 30 * 1000);
  const timer = setInterval(() => checkAll(client).catch(() => null), CHECK_INTERVAL_MS);
  timer.unref?.();
}

module.exports = {
  PLATFORMS,
  start,
  listGuildFeeds,
  getFeed,
  insertFeed,
  deleteFeed,
  resolveYouTubeChannel,
  fetchYouTubeTitle,
  fetchLatest,
};
