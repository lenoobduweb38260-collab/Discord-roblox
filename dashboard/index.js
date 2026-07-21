#!/usr/bin/env node
// 🎛️ Dashboard web façon DraftBot — relié aux bots via l'agent hébergeur.
//
// - Connexion avec Discord (OAuth2) : chaque staff ne voit que les serveurs
//   qu'il administre ET où l'un de vos bots est présent
// - Pages par serveur : vue d'ensemble, Module RP, rôles, salons, niveaux,
//   arrivées/départs, whitelist métiers, tickets
// - Aucune dépendance : Node.js ≥ 18 (node index.js) sur un hébergeur web
//
// Configuration : config.env à côté de ce fichier (voir config.env fourni).
// La clé de l'agent (AGENT_KEY) reste CÔTÉ SERVEUR — jamais dans le navigateur.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const baseDir = __dirname;

// ----- Configuration (config.env ou .env ; l'environnement de l'hébergeur prime) -----
for (const file of ['config.env', '.env'].map((f) => path.join(baseDir, f))) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const PORT = parseInt(process.env.DASH_PORT, 10) || parseInt(process.env.PORT, 10) || 43700;
const HOST = process.env.DASH_HOST || '0.0.0.0';
const DASH_URL = (process.env.DASH_URL || '').trim().replace(/\/+$/, '');
const CLIENT_ID = (process.env.DASH_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.DASH_CLIENT_SECRET || '').trim();
const AGENT_URL = (process.env.AGENT_URL || '').trim().replace(/\/+$/, '');
const AGENT_KEY = (process.env.AGENT_KEY || '').trim();

const missing = [];
if (!CLIENT_ID) missing.push('DASH_CLIENT_ID');
if (!CLIENT_SECRET) missing.push('DASH_CLIENT_SECRET');
if (!DASH_URL) missing.push('DASH_URL');
if (!AGENT_URL) missing.push('AGENT_URL');
if (!AGENT_KEY) missing.push('AGENT_KEY');
if (missing.length) {
  console.error(`❌ Configuration incomplète : ${missing.join(', ')} manquant(s) dans config.env.`);
  console.error('   Voir le LISEZMOI du pack dashboard.');
  process.exit(1);
}
const SECURE_COOKIE = DASH_URL.startsWith('https://');

// ----- Sessions en mémoire (cookie signé, 7 jours) -----
const sessions = new Map(); // token -> { user, guilds, at }
const pendingStates = new Map(); // state -> at (anti-CSRF de l'OAuth)
const SESSION_MS = 7 * 24 * 3600 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (now - s.at > SESSION_MS) sessions.delete(t);
  for (const [st, at] of pendingStates) if (now - at > 10 * 60 * 1000) pendingStates.delete(st);
}, 60 * 1000).unref?.();

function getSession(req) {
  const token = (req.headers.cookie || '').match(/dash_session=([a-f0-9]{48})/)?.[1];
  const session = token && sessions.get(token);
  if (session) session.at = Date.now();
  return session || null;
}

// ----- Lien avec l'agent (clé côté serveur uniquement) -----
function agentFetch(agentPath, options = {}) {
  return fetch(AGENT_URL + agentPath, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'x-cle': AGENT_KEY },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeout || 8000),
  });
}

// Carte serveur Discord → bot de l'agent qui y est présent (cache 30 s).
let guildCache = { at: 0, map: new Map(), infos: new Map() };
async function guildMap() {
  if (Date.now() - guildCache.at < 30 * 1000) return guildCache;
  const map = new Map();
  const infos = new Map();
  try {
    const etat = await agentFetch('/agent/etat').then((r) => r.json());
    for (const bot of etat.bots || []) {
      if (bot.status !== 'demarre') continue;
      try {
        const data = await agentFetch(`/agent/bots/${encodeURIComponent(bot.name)}/proxy/infos`).then((r) => r.json());
        for (const guild of data.guilds || []) {
          if (!map.has(guild.id)) {
            map.set(guild.id, bot.name);
            infos.set(guild.id, { name: guild.name, icon: guild.icon, memberCount: guild.memberCount });
          }
        }
      } catch {}
    }
  } catch {}
  guildCache = { at: Date.now(), map, infos };
  return guildCache;
}

// Le membre connecté administre-t-il ce serveur ? (Gérer le serveur / Admin / propriétaire)
function managesGuild(session, guildId) {
  const g = (session.guilds || []).find((x) => x.id === guildId);
  if (!g) return false;
  if (g.owner) return true;
  try {
    return (BigInt(g.permissions) & 0x28n) !== 0n; // ADMINISTRATOR (0x8) | MANAGE_GUILD (0x20)
  } catch {
    return false;
  }
}

// Proxy authentifié vers l'API du bot qui sert ce serveur.
async function botApi(guildId, apiPath, options = {}) {
  const { map } = await guildMap();
  const botName = map.get(guildId);
  if (!botName) return { status: 404, data: { error: 'Aucun bot en ligne sur ce serveur.' } };
  try {
    const res = await agentFetch(`/agent/bots/${encodeURIComponent(botName)}/proxy${apiPath}`, options);
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } catch {
    return { status: 502, data: { error: 'Bot injoignable pour le moment.' } };
  }
}

const sendJson = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
const sendHtml = (res, html) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
};
const jsonBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 200_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });

// Réglages autorisés depuis le web (validés ensuite par le bot lui-même).
const WEB_KEYS = new Set([
  'staff_role_ids', 'admin_role_ids', 'service_role_id',
  'log_channel_id', 'level_channel_id', 'service_channel_id', 'staff_channel_id', 'member_channel_id', 'update_channel_id',
  'welcome_message', 'goodbye_message', 'welcome_mention',
  'rp_enabled', 'xp_text', 'xp_voice', 'xp_cooldown',
]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const session = getSession(req);

    // ----- Pages -----
    if (req.method === 'GET' && url.pathname === '/') {
      return sendHtml(res, session ? APP_HTML : LANDING_HTML);
    }

    // ----- Connexion Discord (OAuth2) -----
    if (req.method === 'GET' && url.pathname === '/login') {
      const state = crypto.randomBytes(16).toString('hex');
      pendingStates.set(state, Date.now());
      const authorize =
        'https://discord.com/oauth2/authorize?response_type=code' +
        `&client_id=${CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(`${DASH_URL}/callback`)}` +
        '&scope=identify%20guilds' +
        `&state=${state}`;
      res.writeHead(302, { Location: authorize });
      return res.end();
    }

    if (req.method === 'GET' && url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state || !pendingStates.has(state)) {
        res.writeHead(302, { Location: '/' });
        return res.end();
      }
      pendingStates.delete(state);
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: `${DASH_URL}/callback`,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!tokenRes.ok) {
        console.warn(`⚠️ Échange OAuth2 refusé (HTTP ${tokenRes.status}) — vérifiez DASH_CLIENT_SECRET et l'URL de redirection.`);
        res.writeHead(302, { Location: '/?erreur=oauth' });
        return res.end();
      }
      const token = await tokenRes.json();
      const headers = { Authorization: `Bearer ${token.access_token}` };
      const user = await fetch('https://discord.com/api/users/@me', { headers, signal: AbortSignal.timeout(10000) }).then((r) => r.json());
      const guilds = await fetch('https://discord.com/api/users/@me/guilds', { headers, signal: AbortSignal.timeout(10000) }).then((r) => r.json());
      if (!user?.id || !Array.isArray(guilds)) {
        res.writeHead(302, { Location: '/?erreur=discord' });
        return res.end();
      }
      const sessionToken = crypto.randomBytes(24).toString('hex');
      sessions.set(sessionToken, {
        at: Date.now(),
        user: {
          id: user.id,
          username: user.global_name || user.username,
          avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null,
        },
        guilds: guilds.map((g) => ({ id: g.id, name: g.name, icon: g.icon, owner: g.owner, permissions: g.permissions })),
      });
      res.writeHead(302, {
        Location: '/',
        'Set-Cookie': `dash_session=${sessionToken}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax${SECURE_COOKIE ? '; Secure' : ''}`,
      });
      return res.end();
    }

    if (req.method === 'GET' && url.pathname === '/logout') {
      const token = (req.headers.cookie || '').match(/dash_session=([a-f0-9]{48})/)?.[1];
      if (token) sessions.delete(token);
      res.writeHead(302, { Location: '/', 'Set-Cookie': 'dash_session=; Path=/; Max-Age=0' });
      return res.end();
    }

    // ----- API (session requise) -----
    if (parts[0] !== 'api') return sendJson(res, 404, { error: 'Introuvable.' });
    if (!session) return sendJson(res, 401, { error: 'Non connecté — rechargez la page.' });

    // Mes serveurs : ceux que J'administre ET où un bot est présent.
    if (req.method === 'GET' && url.pathname === '/api/moi') {
      const { map, infos } = await guildMap();
      const servers = (session.guilds || [])
        .filter((g) => managesGuild(session, g.id) && map.has(g.id))
        .map((g) => ({
          id: g.id,
          name: g.name,
          icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
          membres: infos.get(g.id)?.memberCount || null,
          bot: map.get(g.id),
        }));
      return sendJson(res, 200, { user: session.user, servers });
    }

    // Routes serveur : /api/serveur/<gid>/…
    if (parts[1] === 'serveur' && parts.length >= 4) {
      const guildId = parts[2];
      if (!/^\d{5,25}$/.test(guildId)) return sendJson(res, 400, { error: 'Serveur invalide.' });
      if (!managesGuild(session, guildId)) {
        return sendJson(res, 403, { error: 'Vous n\'administrez pas ce serveur.' });
      }
      const action = parts[3];

      if (req.method === 'GET' && action === 'apercu') {
        const { status, data } = await botApi(guildId, `/dashboard?guild=${guildId}`);
        return sendJson(res, status, data);
      }
      if (req.method === 'GET' && action === 'parametres') {
        const { status, data } = await botApi(guildId, `/parametres?guild=${guildId}`);
        return sendJson(res, status, data);
      }
      if (req.method === 'POST' && action === 'config') {
        const body = await jsonBody(req);
        const key = String(body.key || '');
        if (!WEB_KEYS.has(key)) return sendJson(res, 400, { error: `Réglage non modifiable depuis le web : ${key}` });
        // 🔒 Verrouillage administrateur du Module RP : respecté aussi sur le web.
        if (key === 'rp_enabled') {
          const check = await botApi(guildId, `/parametres?guild=${guildId}`);
          if (check.data?.config?.rp_locked) {
            return sendJson(res, 403, { error: '🔒 Réglage verrouillé par l\'administrateur du bot.' });
          }
        }
        const { status, data } = await botApi(guildId, '/config', { method: 'POST', body: { guildId, key, value: body.value } });
        return sendJson(res, status, data);
      }
      if (req.method === 'POST' && ['tickets-type', 'tickets-type-suppr', 'whitelist-ajouter', 'whitelist-retirer'].includes(action)) {
        const body = await jsonBody(req);
        const { status, data } = await botApi(guildId, `/${action}`, { method: 'POST', body: { ...body, guildId } });
        return sendJson(res, status, data);
      }
      return sendJson(res, 404, { error: 'Action inconnue.' });
    }

    return sendJson(res, 404, { error: 'Introuvable.' });
  } catch (err) {
    console.error('Erreur dashboard :', err.message);
    try {
      sendJson(res, 500, { error: 'Erreur interne.' });
    } catch {}
  }
});

server.listen(PORT, HOST, () => {
  console.log(`🎛️ Dashboard web prêt : port ${PORT}`);
  console.log(`🌐 URL publique configurée : ${DASH_URL}`);
  console.log(`🔗 Redirection OAuth2 à déclarer sur Discord : ${DASH_URL}/callback`);
  console.log(`🤝 Agent des bots : ${AGENT_URL}`);
});

// ============================ INTERFACE ============================

const THEME_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --bg:#17181c; --panel:#1f2126; --panel2:#26282e; --border:#2c2e35; --text:#e8e9ed;
          --muted:#8a8b94; --accent:#e8593a; --green:#43b581; --red:#f04747; --blue:#4d9de0; --yellow:#faa61a; }
  body { font-family:'Segoe UI',system-ui,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; }
  a { color:inherit; text-decoration:none; }
  button { background:var(--panel2); color:var(--text); border:1px solid var(--border); border-radius:8px;
           padding:8px 14px; font-size:13.5px; cursor:pointer; }
  button:hover { filter:brightness(1.15); }
  button.accent { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; }
  input, select, textarea { background:#101114; border:1px solid var(--border); color:var(--text);
           border-radius:8px; padding:9px 11px; font-size:13.5px; width:100%; }
  input:focus, select:focus, textarea:focus { outline:none; border-color:var(--accent); }
  header { display:flex; align-items:center; gap:12px; padding:14px 22px; border-bottom:1px solid var(--border);
           background:var(--panel); position:sticky; top:0; z-index:5; }
  header .logo { font-size:22px; }
  header .title { font-weight:700; font-size:16px; }
  header .spacer { margin-left:auto; }
  .avatar { width:34px; height:34px; border-radius:50%; }
  .wrap { max-width:1100px; margin:0 auto; padding:26px 18px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:14px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:18px;
          display:flex; align-items:center; gap:13px; cursor:pointer; transition:border-color .15s; }
  .card:hover { border-color:var(--accent); }
  .card img, .card .noicon { width:52px; height:52px; border-radius:14px; }
  .card .noicon { background:var(--panel2); display:flex; align-items:center; justify-content:center; font-size:22px; }
  .layout { display:flex; gap:0; min-height:calc(100vh - 63px); }
  .side { width:230px; background:var(--panel); border-right:1px solid var(--border); padding:14px 10px; flex-shrink:0; }
  .side .item { padding:9px 12px; border-radius:8px; font-size:13.5px; color:var(--muted); cursor:pointer; margin-bottom:2px; }
  .side .item:hover { background:var(--panel2); color:var(--text); }
  .side .item.on { background:rgba(232,89,58,.14); color:var(--accent); font-weight:600; }
  .main { flex:1; padding:24px 28px; min-width:0; }
  h2.title { font-size:19px; margin-bottom:6px; }
  p.sub { color:var(--muted); font-size:13px; margin-bottom:18px; }
  .dsec { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:16px; margin-bottom:14px; max-width:640px; }
  .dsec h3 { font-size:14px; margin-bottom:4px; }
  .dsec p { color:var(--muted); font-size:12.5px; margin-bottom:10px; }
  .tiles { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:12px; margin:14px 0; }
  .tile { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:14px; }
  .tile .tv { font-size:22px; font-weight:700; }
  .tile .tl { color:var(--muted); font-size:12px; margin-top:3px; }
  .row { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:10px 14px;
         margin-bottom:8px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:13.5px; }
  .toast { position:fixed; bottom:22px; right:22px; background:var(--panel2); border:1px solid var(--border);
           border-radius:10px; padding:12px 16px; font-size:13.5px; opacity:0; transition:opacity .2s; z-index:50; }
  .toast.on { opacity:1; }
  .empty { color:var(--muted); padding:40px; text-align:center; }
  .backlink { color:var(--muted); font-size:13px; cursor:pointer; margin-bottom:14px; display:inline-block; }
  .backlink:hover { color:var(--text); }
`;

const LANDING_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>🎛️ Dashboard du bot</title>
<style>${THEME_CSS}
  .hero { min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:20px; }
  .hero .big { font-size:52px; margin-bottom:14px; }
  .hero h1 { font-size:30px; margin-bottom:10px; }
  .hero p { color:var(--muted); max-width:520px; line-height:1.6; margin-bottom:26px; }
  .discordbtn { background:#5865f2; border:0; color:#fff; font-size:15px; font-weight:600; padding:13px 26px; border-radius:10px; }
</style>
</head>
<body>
<div class="hero">
  <div class="big">🎛️</div>
  <h1>Dashboard du bot</h1>
  <p>Configurez le bot sur vos serveurs depuis votre navigateur : Module RP, rôles, salons,
  niveaux, messages de bienvenue, whitelist métiers et tickets — comme sur DraftBot.
  Connectez-vous avec Discord : vous ne verrez que les serveurs que vous administrez.</p>
  <a href="/login"><button class="discordbtn">🔗 Se connecter avec Discord</button></a>
</div>
</body>
</html>`;

const APP_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>🎛️ Dashboard du bot</title>
<style>${THEME_CSS}</style>
</head>
<body>
<header>
  <span class="logo">🎛️</span><span class="title">Dashboard du bot</span>
  <span class="spacer"></span>
  <img id="h_avatar" class="avatar" style="display:none">
  <span id="h_name" style="font-size:13.5px;color:var(--muted)"></span>
  <a href="/logout"><button>Déconnexion</button></a>
</header>
<div id="content"><div class="empty">Chargement…</div></div>
<div id="toast" class="toast"></div>
<script>
var moi = null, gid = null, page = 'apercu';
function $(id){ return document.getElementById(id); }
function esc(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function toast(msg){ var t = $('toast'); t.textContent = msg; t.className = 'toast on'; setTimeout(function(){ t.className = 'toast'; }, 3200); }
function api(method, path, body){
  return fetch(path, { method: method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) })
    .then(function(r){ return r.json(); })
    .then(function(j){ if (j && j.error) toast('⚠️ ' + j.error); return j; });
}
function save(key, value){
  api('POST', '/api/serveur/' + gid + '/config', { key: key, value: value }).then(function(j){ if (j && j.ok !== undefined ? j.ok : !j.error) toast('✅ Enregistré'); });
}

// ----- Liste des serveurs -----
function renderHome(){
  gid = null;
  var h = '<div class="wrap"><h2 class="title">Mes serveurs</h2><p class="sub">Serveurs que vous administrez et où le bot est présent.</p>';
  if (!moi.servers.length) h += '<div class="empty">Aucun serveur — invitez le bot sur votre serveur, puis rechargez cette page.</div>';
  h += '<div class="grid">';
  moi.servers.forEach(function(s){
    h += '<div class="card" data-g="' + s.id + '">' +
      (s.icon ? '<img src="' + s.icon + '">' : '<div class="noicon">🌐</div>') +
      '<div><div style="font-weight:600">' + esc(s.name) + '</div>' +
      '<div style="color:var(--muted);font-size:12px">' + (s.membres ? s.membres + ' membres · ' : '') + '🤖 ' + esc(s.bot) + '</div></div></div>';
  });
  h += '</div></div>';
  $('content').innerHTML = h;
  Array.prototype.forEach.call(document.querySelectorAll('.card'), function(el){
    el.onclick = function(){ gid = el.getAttribute('data-g'); page = 'apercu'; renderServer(); };
  });
}

// ----- Vue serveur (sidebar + pages) -----
var PAGES = [
  ['apercu', '📊 Vue d\\'ensemble'],
  ['module', '🎭 Module RP'],
  ['roles', '👮 Rôles & sécurité'],
  ['salons', '📢 Salons & logs'],
  ['niveaux', '📈 Niveaux'],
  ['membres', '👋 Arrivées & départs'],
  ['whitelist', '📋 Whitelist métiers'],
  ['tickets', '🎫 Tickets']
];
function renderServer(){
  var srv = null;
  moi.servers.forEach(function(s){ if (s.id === gid) srv = s; });
  var h = '<div class="layout"><div class="side">';
  h += '<div class="item" id="back">⬅ Mes serveurs</div><hr style="border-color:var(--border);margin:8px 0">';
  PAGES.forEach(function(p){ h += '<div class="item' + (p[0] === page ? ' on' : '') + '" data-p="' + p[0] + '">' + p[1] + '</div>'; });
  h += '</div><div class="main" id="main"><div class="empty">Chargement…</div></div></div>';
  $('content').innerHTML = h;
  $('back').onclick = renderHome;
  Array.prototype.forEach.call(document.querySelectorAll('.side .item[data-p]'), function(el){
    el.onclick = function(){ page = el.getAttribute('data-p'); renderServer(); };
  });
  loadPage(srv);
}

function sel(key, label, desc, list, current, prefix){
  var h = '<div class="dsec"><h3>' + label + '</h3><p>' + desc + '</p>';
  h += '<select class="wsave" data-k="' + key + '"><option value="">— Désactivé —</option>';
  list.forEach(function(x){ h += '<option value="' + x.id + '"' + (x.id === current ? ' selected' : '') + '>' + (prefix || '') + esc(x.name) + '</option>'; });
  h += '</select></div>';
  return h;
}
function multi(key, label, desc, list, currentJson){
  var current = [];
  try { current = JSON.parse(currentJson || '[]'); } catch (e) {}
  var h = '<div class="dsec"><h3>' + label + '</h3><p>' + desc + '</p>';
  h += '<select multiple size="6" class="wmulti" data-k="' + key + '" style="height:auto">';
  list.forEach(function(x){ h += '<option value="' + x.id + '"' + (current.indexOf(x.id) >= 0 ? ' selected' : '') + '>@' + esc(x.name) + '</option>'; });
  h += '</select><br><button class="wmultisave" data-k="' + key + '" style="margin-top:8px">💾 Enregistrer la sélection</button></div>';
  return h;
}
function num(key, label, desc, value, min, max){
  return '<div class="dsec"><h3>' + label + '</h3><p>' + desc + '</p>' +
    '<div style="display:flex;gap:8px"><input type="number" class="wnum" data-k="' + key + '" value="' + value + '" min="' + min + '" max="' + max + '" style="width:130px">' +
    '<button class="wnumsave" data-k="' + key + '">💾</button></div></div>';
}

function loadPage(srv){
  var m = $('main');
  if (page === 'apercu'){
    api('GET', '/api/serveur/' + gid + '/apercu').then(function(d){
      if (d.error) { m.innerHTML = '<div class="empty">⚠️ ' + esc(d.error) + '</div>'; return; }
      var h = '<div style="display:flex;align-items:center;gap:13px;margin-bottom:6px">' +
        (d.serveur.icon ? '<img src="' + d.serveur.icon + '" style="width:52px;height:52px;border-radius:14px">' : '') +
        '<div><h2 class="title" style="margin:0">' + esc(d.serveur.name) + '</h2>' +
        '<p class="sub" style="margin:0">' + d.serveur.membres + ' membres · géré par 🤖 ' + esc(srv ? srv.bot : '') + '</p></div></div>';
      var labels = { cartes: "🪪 Cartes d'identité", permis: '🚗 Permis', entreprises: '🏢 Entreprises', ticketsOuverts: '🎫 Tickets ouverts', whitelist: '📋 Whitelist métiers', vehicules: '🛡️ Véhicules assurés' };
      h += '<div class="tiles">';
      Object.keys(labels).forEach(function(k){ h += '<div class="tile"><div class="tv">' + (d.stats[k] || 0) + '</div><div class="tl">' + labels[k] + '</div></div>'; });
      h += '</div>';
      if (d.top && d.top.length){
        h += '<h3 style="margin:14px 0 8px;font-size:14px">🏆 Top niveaux (écrit)</h3>';
        d.top.forEach(function(t, i){ h += '<div class="row">' + (i + 1) + '. <b>' + esc(t.user) + '</b> — niveau ' + t.level + ' (' + t.xp + ' XP)</div>'; });
      }
      m.innerHTML = h;
    });
    return;
  }
  api('GET', '/api/serveur/' + gid + '/parametres').then(function(p){
    if (p.error) { m.innerHTML = '<div class="empty">⚠️ ' + esc(p.error) + '</div>'; return; }
    var cfg = p.config, h = '';
    if (page === 'module'){
      h += '<h2 class="title">🎭 Module RP</h2><p class="sub">Cartes, permis, entreprises, assurances, service, temps — activable par serveur.</p>';
      if (cfg.rp_locked){
        h += '<div class="dsec"><h3>🔒 Verrouillé</h3><p>Ce réglage est verrouillé par l\\'administrateur du bot : il ne peut être changé que depuis son gestionnaire.</p>' +
          '<p style="color:var(--text)">État actuel : ' + (cfg.rp_enabled ? '🟢 <b>Activé</b>' : '🔴 <b>Désactivé</b>') + '</p></div>';
      } else {
        h += '<div class="dsec"><h3>Activer le Module RP</h3><p>Désactivé, les commandes RP sont retirées de la liste du serveur.</p>' +
          '<label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" id="w_rp"' + (cfg.rp_enabled ? ' checked' : '') + ' style="width:auto"> Module RP activé sur ce serveur</label></div>';
      }
    } else if (page === 'roles'){
      h += '<h2 class="title">👮 Rôles & sécurité</h2><p class="sub">Plusieurs rôles possibles pour chaque grade (Ctrl+clic).</p>';
      h += multi('staff_role_ids', 'Rôles Staff (grade 2)', 'Accès aux commandes staff : cartes, permis, modération, tickets…', p.roles, cfg.staff_role_ids || (cfg.staff_role_id ? JSON.stringify([cfg.staff_role_id]) : null));
      h += multi('admin_role_ids', 'Rôles Administration (grade 3)', 'Accès aux réglages sensibles et /banglobal.', p.roles, cfg.admin_role_ids || (cfg.admin_role_id ? JSON.stringify([cfg.admin_role_id]) : null));
      h += sel('service_role_id', 'Rôle « En service »', 'Ajouté/retiré automatiquement par /service.', p.roles, cfg.service_role_id, '@');
    } else if (page === 'salons'){
      h += '<h2 class="title">📢 Salons & logs</h2><p class="sub">Où le bot publie ses annonces et journaux.</p>';
      h += sel('log_channel_id', 'Salon des logs de sécurité', 'Actions staff, messages supprimés/modifiés, vocal, transcripts.', p.channels, cfg.log_channel_id, '#');
      h += sel('staff_channel_id', 'Salon staff (arrivées/départs de poste)', 'Annonces /arrivee et /depart.', p.channels, cfg.staff_channel_id, '#');
      h += sel('service_channel_id', 'Salon des services RP', 'Prises et fins de service.', p.channels, cfg.service_channel_id, '#');
      h += sel('update_channel_id', 'Salon des annonces de mise à jour', 'Sans salon : #shadow-logs est créé automatiquement (staff uniquement).', p.channels, cfg.update_channel_id, '#');
    } else if (page === 'niveaux'){
      h += '<h2 class="title">📈 Niveaux</h2><p class="sub">XP écrit et vocal.</p>';
      h += sel('level_channel_id', 'Salon des annonces de niveau', 'Montées de niveau (écrit et vocal).', p.channels, cfg.level_channel_id, '#');
      h += num('xp_text', 'XP par message', 'Anti-spam via le cooldown.', cfg.xp_text, 1, 1000);
      h += num('xp_voice', 'XP par minute en vocal', '', cfg.xp_voice, 1, 1000);
      h += num('xp_cooldown', 'Cooldown XP texte (secondes)', '', cfg.xp_cooldown, 5, 3600);
    } else if (page === 'membres'){
      h += '<h2 class="title">👋 Arrivées & départs</h2><p class="sub">Embeds d\\'arrivée et de départ des membres.</p>';
      h += sel('member_channel_id', 'Salon des messages', 'Embeds d\\'arrivée et de départ. « — Désactivé — » pour couper.', p.channels, cfg.member_channel_id, '#');
      h += '<div class="dsec"><h3>Mentionner le membre</h3><p>Mention @membre au-dessus de l\\'embed de bienvenue.</p>' +
        '<label style="display:flex;gap:8px;align-items:center;font-size:13.5px"><input type="checkbox" id="w_mention"' + (cfg.welcome_mention ? ' checked' : '') + ' style="width:auto"> Activer la mention</label></div>';
      h += '<div class="dsec"><h3>Message de bienvenue</h3><p>Variables : {user} {user.username} {server} {membercount} — vide = message par défaut.</p>' +
        '<textarea id="w_wel" rows="3">' + esc(cfg.welcome_message || '') + '</textarea><br><button id="w_savew" style="margin-top:8px">💾 Enregistrer</button></div>';
      h += '<div class="dsec"><h3>Message d\\'au revoir</h3><p>Mêmes variables.</p>' +
        '<textarea id="w_bye" rows="3">' + esc(cfg.goodbye_message || '') + '</textarea><br><button id="w_saveb" style="margin-top:8px">💾 Enregistrer</button></div>';
    } else if (page === 'whitelist'){
      h += '<h2 class="title">📋 Whitelist métiers</h2><p class="sub">Un gérant whiteliste des recrues sur son rôle métier (rôle attribué automatiquement).</p>';
      p.whitelist.forEach(function(w){
        h += '<div class="row">👮 <b>@' + esc(w.role) + '</b> — géré par @' + esc(w.manager) +
          '<button class="wl-del" data-r="' + w.roleId + '" data-m="' + w.managerId + '" style="margin-left:auto;padding:4px 10px;font-size:12px">🗑</button></div>';
      });
      if (!p.whitelist.length) h += '<p class="sub"><i>Aucune autorisation configurée.</i></p>';
      h += '<div class="dsec"><h3>➕ Ajouter une autorisation</h3><div style="display:flex;gap:8px;flex-wrap:wrap">';
      h += '<select id="ww_role" style="max-width:220px"><option value="">— Rôle métier —</option>' + p.roles.map(function(r){ return '<option value="' + r.id + '">@' + esc(r.name) + '</option>'; }).join('') + '</select>';
      h += '<select id="ww_mgr" style="max-width:220px"><option value="">— Rôle gérant —</option>' + p.roles.map(function(r){ return '<option value="' + r.id + '">@' + esc(r.name) + '</option>'; }).join('') + '</select>';
      h += '<button id="ww_add" class="accent">Ajouter</button></div></div>';
    } else if (page === 'tickets'){
      h += '<h2 class="title">🎫 Tickets</h2><p class="sub">Après un changement, republiez le panneau : /ticket panneau-modifier sur Discord.</p>';
      p.tickets.forEach(function(t){
        h += '<div class="row">' + (t.emoji ? esc(t.emoji) + ' ' : '') + '<b>' + esc(t.label) + '</b> — catégorie « ' + esc(t.categorie) + ' »' + (t.support ? ' — support @' + esc(t.support) : '') +
          '<button class="tk-del" data-id="' + t.id + '" style="margin-left:auto;padding:4px 10px;font-size:12px">🗑</button></div>';
      });
      if (!p.tickets.length) h += '<p class="sub"><i>Aucun type de ticket.</i></p>';
      h += '<div class="dsec"><h3>➕ Nouveau type</h3><div style="display:flex;gap:8px;flex-wrap:wrap">';
      h += '<input id="wt_nom" placeholder="Nom (ex : Support)" style="max-width:170px">';
      h += '<input id="wt_emoji" placeholder="Emoji" style="max-width:90px">';
      h += '<select id="wt_cat" style="max-width:200px"><option value="">— Catégorie —</option>' + p.categories.map(function(c){ return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select>';
      h += '<select id="wt_role" style="max-width:200px"><option value="">— Rôle support (optionnel) —</option>' + p.roles.map(function(r){ return '<option value="' + r.id + '">@' + esc(r.name) + '</option>'; }).join('') + '</select>';
      h += '<button id="wt_add" class="accent">Ajouter</button></div></div>';
    }
    m.innerHTML = h;
    var reload = function(j){ if (j && !j.error) { toast('✅ ' + (j.note || 'Enregistré')); loadPage(srv); } };
    if ($('w_rp')) $('w_rp').onchange = function(){ save('rp_enabled', $('w_rp').checked ? 1 : 0); };
    if ($('w_mention')) $('w_mention').onchange = function(){ save('welcome_mention', $('w_mention').checked ? 1 : 0); };
    if ($('w_savew')) $('w_savew').onclick = function(){ save('welcome_message', $('w_wel').value.trim() || null); };
    if ($('w_saveb')) $('w_saveb').onclick = function(){ save('goodbye_message', $('w_bye').value.trim() || null); };
    if ($('ww_add')) $('ww_add').onclick = function(){
      if (!$('ww_role').value || !$('ww_mgr').value) { toast('⚠️ Choisissez les deux rôles.'); return; }
      api('POST', '/api/serveur/' + gid + '/whitelist-ajouter', { roleId: $('ww_role').value, managerRoleId: $('ww_mgr').value }).then(reload);
    };
    Array.prototype.forEach.call(m.querySelectorAll('.wl-del'), function(el){
      el.onclick = function(){ api('POST', '/api/serveur/' + gid + '/whitelist-retirer', { roleId: el.getAttribute('data-r'), managerRoleId: el.getAttribute('data-m') }).then(reload); };
    });
    if ($('wt_add')) $('wt_add').onclick = function(){
      if (!$('wt_nom').value.trim() || !$('wt_cat').value) { toast('⚠️ Nom et catégorie requis.'); return; }
      api('POST', '/api/serveur/' + gid + '/tickets-type', { label: $('wt_nom').value, emoji: $('wt_emoji').value, categoryId: $('wt_cat').value, supportRoleId: $('wt_role').value || null }).then(reload);
    };
    Array.prototype.forEach.call(m.querySelectorAll('.tk-del'), function(el){
      el.onclick = function(){ if (confirm('Supprimer ce type de ticket ?')) api('POST', '/api/serveur/' + gid + '/tickets-type-suppr', { id: el.getAttribute('data-id') }).then(reload); };
    });
    Array.prototype.forEach.call(m.querySelectorAll('.wsave'), function(el){
      el.onchange = function(){ save(el.getAttribute('data-k'), el.value || null); };
    });
    Array.prototype.forEach.call(m.querySelectorAll('.wnumsave'), function(el){
      el.onclick = function(){ save(el.getAttribute('data-k'), m.querySelector('.wnum[data-k="' + el.getAttribute('data-k') + '"]').value); };
    });
    Array.prototype.forEach.call(m.querySelectorAll('.wmultisave'), function(el){
      el.onclick = function(){
        var s = m.querySelector('.wmulti[data-k="' + el.getAttribute('data-k') + '"]');
        var vals = Array.prototype.filter.call(s.options, function(o){ return o.selected; }).map(function(o){ return o.value; });
        save(el.getAttribute('data-k'), vals.length ? vals : null);
      };
    });
  });
}

api('GET', '/api/moi').then(function(j){
  if (!j || j.error) { location.href = '/'; return; }
  moi = j;
  if (moi.user.avatar) { $('h_avatar').src = moi.user.avatar; $('h_avatar').style.display = ''; }
  $('h_name').textContent = moi.user.username;
  renderHome();
});
</script>
</body>
</html>`;
