// 🤖 Gestionnaire de bots — application locale pour le développeur.
// Gère plusieurs bots (chacun relié à son propre dépôt GitHub) : création,
// .env, téléchargement des exécutables, démarrage/arrêt, console en direct,
// console d'erreurs et diagnostic copiable. Interface : http://localhost:43550
// Aucune dépendance externe : uniquement les modules intégrés de Node.js.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

let VERSION = 'dev';
try {
  VERSION = require('./version.gen.js');
} catch {}

const mode = (process.argv[2] || '').toLowerCase();
if (mode === 'check') {
  console.log('✅ Auto-test Gestionnaire OK');
  process.exit(0);
}

const PORT = 43550;
const baseDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..', '..');
const dataDir = path.join(baseDir, 'gestionnaire');
const botsDir = path.join(dataDir, 'bots');
const configPath = path.join(dataDir, 'bots-manager.json');
fs.mkdirSync(botsDir, { recursive: true });

const ASSET_SUFFIX = process.platform === 'win32' ? 'win-x64.exe' : 'linux-x64';
const DEFAULT_REPO = 'lenoobduweb38260-collab/Discord-roblox';

// ----- Configuration persistante -----
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return { bots: [] };
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}
let config = loadConfig();

function getBot(name) {
  return config.bots.find((b) => b.name === name) || null;
}
function botFolder(name) {
  return path.join(botsDir, name);
}

// ----- État d'exécution -----
// name -> { proc, pid, status, logs[], errors[], logSeq, restartAfterUpdate }
const runtime = new Map();
function rt(name) {
  if (!runtime.has(name)) {
    runtime.set(name, { proc: null, pid: null, status: 'arrete', logs: [], errors: [], logSeq: 0 });
  }
  return runtime.get(name);
}

function addLine(r, line, isErr = false) {
  if (!line) return;
  const stamped = `[${new Date().toLocaleTimeString('fr-FR')}] ${line}`;
  r.logs.push(stamped);
  if (r.logs.length > 1000) r.logs.splice(0, r.logs.length - 1000);
  r.logSeq++;
  if (isErr || /❌|⚠️|🛑|erreur|error|unhandled|exception|rejected/i.test(line)) {
    r.errors.push(stamped);
    if (r.errors.length > 300) r.errors.splice(0, r.errors.length - 300);
  }
}

function wireOutput(r, stream, isErr) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      addLine(r, buffer.slice(0, i).replace(/\r$/, ''), isErr);
      buffer = buffer.slice(i + 1);
    }
  });
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {}
}

// Adoption des orphelins : un bot lancé par une session précédente du
// gestionnaire écrit son PID dans bot.lock — on le retrouve au démarrage.
function adoptOrphans() {
  for (const bot of config.bots) {
    try {
      const pid = parseInt(fs.readFileSync(path.join(botFolder(bot.name), 'bot.lock'), 'utf8'), 10);
      if (pid && pidAlive(pid)) {
        const r = rt(bot.name);
        r.status = 'externe';
        r.pid = pid;
        addLine(r, `ℹ️ Bot déjà en cours d'exécution (PID ${pid}), repris par le gestionnaire.`);
      }
    } catch {}
  }
}

// ----- Téléchargement depuis GitHub -----
async function updateBot(name) {
  const bot = getBot(name);
  if (!bot) return false;
  const r = rt(name);
  r.status = 'maj';
  try {
    addLine(r, `⬇️ Recherche de la dernière version de ${bot.repo}…`);
    const res = await fetch(`https://api.github.com/repos/${bot.repo}/releases/latest`, {
      headers: { 'User-Agent': 'gestionnaire-bots', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      addLine(r, `❌ Impossible de lire les releases de ${bot.repo} (HTTP ${res.status}).`, true);
      r.status = 'arrete';
      return false;
    }
    const release = await res.json();
    const asset =
      (release.assets || []).find((a) => a.name.endsWith(ASSET_SUFFIX)) ||
      (release.assets || []).find((a) =>
        process.platform === 'win32' ? a.name.endsWith('.exe') : !a.name.endsWith('.exe')
      );
    if (!asset) {
      addLine(r, `❌ Aucun exécutable (${ASSET_SUFFIX}) dans la release ${release.tag_name} de ${bot.repo}.`, true);
      r.status = 'arrete';
      return false;
    }
    if (bot.version === release.tag_name && fs.existsSync(path.join(botFolder(name), asset.name))) {
      addLine(r, `✅ Déjà à jour (${release.tag_name}).`);
      r.status = 'arrete';
      return true;
    }
    addLine(r, `⬇️ Téléchargement de ${asset.name} (${Math.round(asset.size / 1048576)} Mo)…`);
    const dl = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'gestionnaire-bots' } });
    if (!dl.ok) {
      addLine(r, `❌ Téléchargement impossible (HTTP ${dl.status}).`, true);
      r.status = 'arrete';
      return false;
    }
    const dest = path.join(botFolder(name), asset.name);
    fs.writeFileSync(dest, Buffer.from(await dl.arrayBuffer()));
    if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
    bot.exe = asset.name;
    bot.version = release.tag_name;
    saveConfig(config);
    addLine(r, `✅ Version ${release.tag_name} installée.`);
    r.status = 'arrete';
    return true;
  } catch (err) {
    addLine(r, `❌ Mise à jour échouée : ${err.message}`, true);
    r.status = 'arrete';
    return false;
  }
}

// ----- Démarrage / arrêt -----
function startBot(name) {
  const bot = getBot(name);
  if (!bot) return { error: 'Bot inconnu.' };
  const r = rt(name);
  if (r.status === 'demarre' && r.proc) return { error: 'Ce bot est déjà démarré.' };
  if (r.status === 'externe' && r.pid) return { error: 'Ce bot tourne déjà (repris). Arrêtez-le d\'abord.' };
  const folder = botFolder(name);
  const exePath = bot.exe ? path.join(folder, bot.exe) : null;
  if (!exePath || !fs.existsSync(exePath)) {
    return { error: 'Exécutable absent : cliquez d\'abord sur « Mettre à jour ».' };
  }
  const env = { ...process.env, AUTO_UPDATE: 'off', BOT_MANAGED: '1' };
  delete env.BOT_JUST_UPDATED;
  delete env.BOT_RESTARTED;
  const proc = spawn(exePath, [], { cwd: folder, env, stdio: ['ignore', 'pipe', 'pipe'] });
  r.proc = proc;
  r.pid = proc.pid;
  r.status = 'demarre';
  addLine(r, `▶️ Bot démarré (PID ${proc.pid}, version ${bot.version || '?'}).`);
  wireOutput(r, proc.stdout, false);
  wireOutput(r, proc.stderr, true);
  proc.on('exit', (code) => {
    r.proc = null;
    r.pid = null;
    if (code === 42) {
      // Code spécial émis par /update quand le bot est géré : on met à jour puis on relance.
      addLine(r, '🔄 /update reçu : mise à jour puis redémarrage…');
      updateBot(name).then(() => {
        const result = startBot(name);
        if (result?.error) addLine(r, `❌ Redémarrage impossible : ${result.error}`, true);
      });
      return;
    }
    r.status = 'arrete';
    addLine(r, `⏹️ Processus terminé (code ${code}).`, code !== 0 && code !== null);
  });
  proc.on('error', (err) => {
    r.proc = null;
    r.pid = null;
    r.status = 'arrete';
    addLine(r, `❌ Lancement impossible : ${err.message}`, true);
  });
  return { ok: true };
}

function stopBot(name) {
  const r = rt(name);
  if (r.proc?.pid) {
    addLine(r, '⏹️ Arrêt demandé…');
    killPid(r.proc.pid);
    return { ok: true };
  }
  if (r.status === 'externe' && r.pid) {
    addLine(r, `⏹️ Arrêt du processus externe (PID ${r.pid})…`);
    killPid(r.pid);
    r.status = 'arrete';
    r.pid = null;
    return { ok: true };
  }
  return { error: 'Ce bot n\'est pas démarré.' };
}

// À la fermeture du gestionnaire, on arrête proprement les bots qu'il a lancés.
function killAllChildren() {
  for (const [, r] of runtime) {
    if (r.proc?.pid) killPid(r.proc.pid);
  }
}
process.on('exit', killAllChildren);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => process.exit(0));
}

// ----- Fichier .env -----
function envTemplate(fields = {}) {
  return [
    '# Token du bot (Portail développeur Discord > Bot > Token)',
    `DISCORD_TOKEN=${fields.token || ''}`,
    '',
    '# ID de l\'application (General Information > Application ID)',
    `CLIENT_ID=${fields.clientId || ''}`,
    '',
    '# ID du serveur (facultatif : enregistrement instantané des commandes)',
    `GUILD_ID=${fields.guildId || ''}`,
    '',
    '# Votre ID Discord (autorisé à utiliser /stop)',
    `OWNER_ID=${fields.ownerId || ''}`,
    '',
    '# Géré par le Gestionnaire de bots (mise à jour interne désactivée)',
    'AUTO_UPDATE=off',
    '',
  ].join('\n');
}

// ----- Serveur HTTP -----
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function jsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

const NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function stateSnapshot() {
  return {
    version: VERSION,
    platform: process.platform,
    dossier: dataDir,
    bots: config.bots.map((b) => {
      const r = rt(b.name);
      return {
        name: b.name,
        repo: b.repo,
        version: b.version || null,
        exe: b.exe || null,
        status: r.status,
        pid: r.proc?.pid || r.pid || null,
      };
    }),
  };
}

function diagnosticText(name) {
  const bot = getBot(name);
  const r = rt(name);
  let fileLog = '';
  try {
    const raw = fs.readFileSync(path.join(botFolder(name), 'erreur.log'), 'utf8');
    fileLog = raw.split('\n').slice(-30).join('\n');
  } catch {}
  return [
    `=== Diagnostic du bot « ${name} » — ${new Date().toLocaleString('fr-FR')} ===`,
    `Gestionnaire v${VERSION} · ${process.platform} · Bot ${bot?.version || '?'} · Repo ${bot?.repo || '?'} · Statut ${r.status}`,
    '',
    '--- Console d\'erreurs (mémoire) ---',
    r.errors.slice(-50).join('\n') || '(vide)',
    '',
    '--- Fichier erreur.log (30 dernières lignes) ---',
    fileLog || '(absent ou vide)',
    '',
    '--- Derniers logs (100 lignes) ---',
    r.logs.slice(-100).join('\n') || '(vide)',
  ].join('\n');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(HTML);
    }
    if (parts[0] !== 'api') return sendJson(res, 404, { error: 'Introuvable' });

    // GET /api/etat
    if (req.method === 'GET' && parts[1] === 'etat') return sendJson(res, 200, stateSnapshot());

    // POST /api/bots — création
    if (req.method === 'POST' && parts[1] === 'bots' && parts.length === 2) {
      const body = await jsonBody(req);
      const name = String(body.name || '').trim();
      const repo = String(body.repo || DEFAULT_REPO).trim();
      if (!NAME_RE.test(name)) return sendJson(res, 400, { error: 'Nom invalide (lettres, chiffres, - et _ uniquement).' });
      if (!REPO_RE.test(repo)) return sendJson(res, 400, { error: 'Dépôt invalide (format attendu : proprietaire/depot).' });
      if (getBot(name)) return sendJson(res, 400, { error: 'Un bot porte déjà ce nom.' });
      fs.mkdirSync(botFolder(name), { recursive: true });
      fs.writeFileSync(path.join(botFolder(name), '.env'), envTemplate(body));
      config.bots.push({ name, repo, exe: null, version: null });
      saveConfig(config);
      addLine(rt(name), `🆕 Bot créé (dépôt ${repo}).`);
      updateBot(name); // téléchargement automatique en arrière-plan
      return sendJson(res, 200, { ok: true });
    }

    // Routes /api/bots/<name>/...
    if (parts[1] === 'bots' && parts.length >= 3) {
      const name = decodeURIComponent(parts[2]);
      const bot = getBot(name);
      if (!bot) return sendJson(res, 404, { error: 'Bot inconnu.' });
      const action = parts[3] || '';
      const r = rt(name);

      if (req.method === 'POST' && action === 'demarrer') return sendJson(res, 200, startBot(name));
      if (req.method === 'POST' && action === 'arreter') return sendJson(res, 200, stopBot(name));
      if (req.method === 'POST' && action === 'maj') {
        if (r.status === 'maj') return sendJson(res, 200, { error: 'Mise à jour déjà en cours.' });
        const wasRunning = r.status === 'demarre';
        const doUpdate = () =>
          updateBot(name).then((ok) => {
            if (ok && wasRunning) startBot(name);
          });
        if (wasRunning && r.proc) {
          r.proc.once('exit', () => setTimeout(doUpdate, 500));
          stopBot(name);
        } else {
          doUpdate();
        }
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'GET' && action === 'logs') {
        return sendJson(res, 200, { total: r.logSeq, lines: r.logs.slice(-400) });
      }
      if (req.method === 'GET' && action === 'erreurs') {
        let fileLog = '';
        try {
          fileLog = fs.readFileSync(path.join(botFolder(name), 'erreur.log'), 'utf8').split('\n').slice(-30).join('\n');
        } catch {}
        return sendJson(res, 200, { lines: r.errors.slice(-200), fichier: fileLog });
      }
      if (req.method === 'GET' && action === 'diagnostic') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(diagnosticText(name));
      }
      if (req.method === 'GET' && action === 'env') {
        let content = '';
        try {
          content = fs.readFileSync(path.join(botFolder(name), '.env'), 'utf8');
        } catch {}
        return sendJson(res, 200, { content });
      }
      if (req.method === 'PUT' && action === 'env') {
        const body = await jsonBody(req);
        fs.writeFileSync(path.join(botFolder(name), '.env'), String(body.content || ''));
        addLine(r, '📝 Fichier .env enregistré.' + (r.status === 'demarre' ? ' (redémarrez le bot pour appliquer)' : ''));
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'DELETE' && !action) {
        if (r.status === 'demarre' || r.status === 'externe') {
          return sendJson(res, 400, { error: 'Arrêtez le bot avant de le supprimer.' });
        }
        config.bots = config.bots.filter((b) => b.name !== name);
        saveConfig(config);
        runtime.delete(name);
        return sendJson(res, 200, { ok: true, note: `Le dossier ${botFolder(name)} est conservé sur le disque (données incluses).` });
      }
    }

    return sendJson(res, 404, { error: 'Route inconnue.' });
  } catch (err) {
    console.error('Erreur serveur :', err);
    try {
      sendJson(res, 500, { error: String(err.message || err) });
    } catch {}
  }
});

function openBrowser() {
  const url = `http://localhost:${PORT}`;
  try {
    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
        : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('ℹ️ Le gestionnaire est déjà lancé : ouverture de l\'interface dans le navigateur…');
    openBrowser();
    setTimeout(() => process.exit(0), 800);
  } else {
    console.error('❌ Erreur serveur :', err);
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🤖 Gestionnaire de bots v${VERSION}`);
  console.log(`📁 Données : ${dataDir}`);
  console.log(`🌐 Interface : http://localhost:${PORT}  (cette fenêtre doit rester ouverte)`);
  adoptOrphans();
  openBrowser();
});

// ----- Interface web (page unique, sans dépendance) -----
const HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Gestionnaire de bots</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #1e1f24; color: #e6e6e9; height: 100vh; display: flex; flex-direction: column; }
  header { background: #26272e; padding: 12px 20px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #35363f; }
  header h1 { font-size: 17px; font-weight: 600; }
  header .ver { color: #8a8b94; font-size: 12px; }
  header button { margin-left: auto; }
  main { flex: 1; display: flex; min-height: 0; }
  #sidebar { width: 250px; background: #232429; border-right: 1px solid #35363f; overflow-y: auto; padding: 10px; }
  .botcard { padding: 10px 12px; border-radius: 8px; cursor: pointer; margin-bottom: 6px; border: 1px solid transparent; }
  .botcard:hover { background: #2b2c33; }
  .botcard.sel { background: #2f3040; border-color: #5865f2; }
  .botcard .nm { font-weight: 600; }
  .botcard .st { font-size: 12px; margin-top: 2px; }
  .st-demarre { color: #57f287; } .st-arrete { color: #8a8b94; } .st-maj { color: #fee75e; } .st-externe { color: #3498db; }
  #panel { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  #actions { padding: 12px 16px; display: flex; gap: 8px; flex-wrap: wrap; border-bottom: 1px solid #35363f; align-items: center; }
  #actions .meta { color: #8a8b94; font-size: 13px; margin-left: auto; }
  button { background: #5865f2; color: #fff; border: 0; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  button:hover { filter: brightness(1.12); }
  button.gray { background: #3a3b44; } button.red { background: #ed4245; } button.green { background: #2d7d46; } button.yellow { background: #b8860b; }
  #tabs { display: flex; gap: 4px; padding: 8px 16px 0; }
  #tabs div { padding: 7px 14px; cursor: pointer; border-radius: 8px 8px 0 0; background: #26272e; color: #a9aab3; font-size: 13px; }
  #tabs div.on { background: #111214; color: #fff; }
  #content { flex: 1; background: #111214; margin: 0 16px 16px; border-radius: 0 8px 8px 8px; overflow: auto; padding: 12px; font-family: Consolas, monospace; font-size: 12.5px; white-space: pre-wrap; word-break: break-word; }
  #content textarea { width: 100%; height: 100%; background: #111214; color: #e6e6e9; border: 1px solid #35363f; border-radius: 6px; padding: 10px; font-family: Consolas, monospace; font-size: 13px; resize: none; }
  .err { color: #ff7b7e; }
  dialog { background: #26272e; color: #e6e6e9; border: 1px solid #35363f; border-radius: 10px; padding: 22px; width: 430px; }
  dialog::backdrop { background: rgba(0,0,0,.55); }
  dialog h2 { font-size: 16px; margin-bottom: 14px; }
  dialog label { display: block; font-size: 12px; color: #a9aab3; margin: 10px 0 4px; }
  dialog input { width: 100%; background: #1b1c21; border: 1px solid #35363f; color: #e6e6e9; border-radius: 6px; padding: 8px; font-size: 13px; }
  dialog .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
  #toast { position: fixed; bottom: 18px; right: 18px; background: #2f3040; border: 1px solid #5865f2; padding: 10px 16px; border-radius: 8px; font-size: 13px; display: none; max-width: 420px; }
  .empty { color: #8a8b94; padding: 30px; text-align: center; font-family: 'Segoe UI', sans-serif; }
</style>
</head>
<body>
<header>
  <h1>🤖 Gestionnaire de bots</h1><span class="ver" id="ver"></span>
  <button onclick="dlgNew.showModal()">➕ Nouveau bot</button>
</header>
<main>
  <div id="sidebar"></div>
  <div id="panel">
    <div id="actions"></div>
    <div id="tabs"></div>
    <div id="content"><div class="empty">Créez ou sélectionnez un bot à gauche.</div></div>
  </div>
</main>
<dialog id="dlgNew">
  <h2>➕ Nouveau bot</h2>
  <label>Nom (lettres, chiffres, - et _)</label><input id="f_name" placeholder="mon-serveur-rp">
  <label>Dépôt GitHub (proprietaire/depot)</label><input id="f_repo" value="${DEFAULT_REPO}">
  <label>Token du bot Discord</label><input id="f_token" placeholder="collez le token ici">
  <label>CLIENT_ID (Application ID)</label><input id="f_client" placeholder="123456789…">
  <label>GUILD_ID (ID du serveur, facultatif)</label><input id="f_guild">
  <label>OWNER_ID (votre ID Discord, facultatif)</label><input id="f_owner">
  <div class="row"><button class="gray" onclick="dlgNew.close()">Annuler</button><button onclick="createBot()">Créer</button></div>
</dialog>
<div id="toast"></div>
<script>
var state = { bots: [] }, sel = null, tab = 'console', logTimer = null;
function $(id) { return document.getElementById(id); }
function toast(msg) { var t = $('toast'); t.textContent = msg; t.style.display = 'block'; setTimeout(function(){ t.style.display = 'none'; }, 4000); }
function api(method, url, body) {
  return fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .then(function(r){ return r.json(); })
    .then(function(j){ if (j && j.error) toast('⚠️ ' + j.error); return j; });
}
var STATUS_FR = { demarre: '🟢 démarré', arrete: '⚫ arrêté', maj: '🟡 mise à jour…', externe: '🔵 repris (externe)' };
function refresh() {
  fetch('/api/etat').then(function(r){ return r.json(); }).then(function(s){
    state = s;
    $('ver').textContent = 'v' + s.version;
    var sb = $('sidebar'); sb.innerHTML = '';
    s.bots.forEach(function(b){
      var d = document.createElement('div');
      d.className = 'botcard' + (b.name === sel ? ' sel' : '');
      d.innerHTML = '<div class="nm">' + b.name + '</div><div class="st st-' + b.status + '">' + (STATUS_FR[b.status] || b.status) + (b.version ? ' · ' + b.version : '') + '</div>';
      d.onclick = function(){ selectBot(b.name); };
      sb.appendChild(d);
    });
    if (sel) renderActions();
  });
}
function selectBot(name) { sel = name; tab = 'console'; renderActions(); renderTabs(); loadTab(); refresh(); }
function botSel() { for (var i = 0; i < state.bots.length; i++) if (state.bots[i].name === sel) return state.bots[i]; return null; }
function renderActions() {
  var b = botSel(); var a = $('actions'); if (!b) { a.innerHTML = ''; return; }
  a.innerHTML = '';
  function btn(label, cls, fn) { var x = document.createElement('button'); x.textContent = label; x.className = cls || ''; x.onclick = fn; a.appendChild(x); }
  if (b.status === 'demarre' || b.status === 'externe') btn('⏹ Arrêter', 'red', function(){ api('POST', '/api/bots/' + sel + '/arreter'); setTimeout(refresh, 600); });
  else btn('▶ Démarrer', 'green', function(){ api('POST', '/api/bots/' + sel + '/demarrer'); setTimeout(refresh, 600); });
  btn('⬇ Mettre à jour', 'yellow', function(){ api('POST', '/api/bots/' + sel + '/maj'); setTimeout(refresh, 600); });
  btn('📋 Copier le diagnostic', 'gray', function(){
    fetch('/api/bots/' + sel + '/diagnostic').then(function(r){ return r.text(); }).then(function(t){
      navigator.clipboard.writeText(t).then(function(){ toast('✅ Diagnostic copié — collez-le dans la conversation avec Claude.'); });
    });
  });
  btn('🗑 Supprimer', 'gray', function(){
    if (!confirm('Retirer « ' + sel + ' » du gestionnaire ? (le dossier et ses données restent sur le disque)')) return;
    api('DELETE', '/api/bots/' + sel).then(function(){ sel = null; $('tabs').innerHTML = ''; $('content').innerHTML = '<div class="empty">Bot retiré.</div>'; refresh(); });
  });
  var m = document.createElement('span'); m.className = 'meta';
  m.textContent = b.repo + (b.pid ? ' · PID ' + b.pid : '');
  a.appendChild(m);
}
function renderTabs() {
  var t = $('tabs'); t.innerHTML = '';
  [['console', '🖥️ Console'], ['erreurs', '🚨 Erreurs'], ['env', '⚙️ .env']].forEach(function(p){
    var d = document.createElement('div');
    d.textContent = p[1];
    d.className = tab === p[0] ? 'on' : '';
    d.onclick = function(){ tab = p[0]; renderTabs(); loadTab(); };
    t.appendChild(d);
  });
}
function loadTab() {
  clearInterval(logTimer);
  var c = $('content');
  if (!sel) return;
  if (tab === 'console') {
    var pull = function(){
      fetch('/api/bots/' + sel + '/logs').then(function(r){ return r.json(); }).then(function(j){
        var atBottom = c.scrollTop + c.clientHeight >= c.scrollHeight - 40;
        c.textContent = (j.lines || []).join('\\n') || '(console vide — démarrez le bot)';
        if (atBottom) c.scrollTop = c.scrollHeight;
      });
    };
    pull(); logTimer = setInterval(pull, 1500);
  } else if (tab === 'erreurs') {
    var pullE = function(){
      fetch('/api/bots/' + sel + '/erreurs').then(function(r){ return r.json(); }).then(function(j){
        var txt = (j.lines || []).join('\\n') || '(aucune erreur en mémoire)';
        if (j.fichier) txt += '\\n\\n--- erreur.log ---\\n' + j.fichier;
        c.innerHTML = '';
        var d = document.createElement('div'); d.className = 'err'; d.textContent = txt; c.appendChild(d);
      });
    };
    pullE(); logTimer = setInterval(pullE, 2500);
  } else if (tab === 'env') {
    fetch('/api/bots/' + sel + '/env').then(function(r){ return r.json(); }).then(function(j){
      c.innerHTML = '';
      var ta = document.createElement('textarea'); ta.value = j.content || '';
      var save = document.createElement('button'); save.textContent = '💾 Enregistrer le .env'; save.style.marginTop = '8px';
      save.onclick = function(){ api('PUT', '/api/bots/' + sel + '/env', { content: ta.value }).then(function(j2){ if (j2 && j2.ok) toast('✅ .env enregistré. Redémarrez le bot pour appliquer.'); }); };
      c.appendChild(ta); c.appendChild(save);
      c.style.display = 'flex'; c.style.flexDirection = 'column';
    });
    return;
  }
  c.style.display = 'block';
}
function createBot() {
  api('POST', '/api/bots', {
    name: $('f_name').value, repo: $('f_repo').value, token: $('f_token').value,
    clientId: $('f_client').value, guildId: $('f_guild').value, ownerId: $('f_owner').value
  }).then(function(j){
    if (j && j.ok) { dlgNew.close(); toast('✅ Bot créé — téléchargement de l\\'exécutable en cours…'); selectBot($('f_name').value.trim()); }
  });
}
refresh(); setInterval(refresh, 2500);
</script>
</body>
</html>`;
