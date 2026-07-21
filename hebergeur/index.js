#!/usr/bin/env node
// 🌍 Agent hébergeur — fait tourner le BOT chez votre hébergeur et permet à
// votre Gestionnaire de bots (panel sur votre PC) de s'y relier à distance :
// console en direct, démarrage/arrêt, mises à jour GitHub, dashboard complet
// (dont la page 🌐 Serveurs qui liste chaque serveur ayant ajouté le bot).
//
// Aucune dépendance : Node.js ≥ 18 suffit (node index.js).
//
// - Télécharge la DERNIÈRE version du bot depuis les releases GitHub
// - Le lance, capture sa console, le relance en cas de crash
// - /update sur Discord (code 42) → met à jour depuis GitHub puis relance
// - Expose une API HTTP protégée par clé (AGENT_KEY) pour le panel
//
// Configuration : fichier .env à côté de ce script (voir .env.exemple) ou
// variables d'environnement de l'hébergeur.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const baseDir = __dirname;

// Configuration : fichier « config.env » (recommandé — beaucoup d'hébergeurs
// refusent les fichiers cachés commençant par un point) ou « .env ».
// config.env est prioritaire ; les variables déjà présentes dans
// l'environnement de l'hébergeur priment sur les deux.
const configCandidates = ['config.env', '.env'].map((f) => path.join(baseDir, f));
let configLoaded = null;
for (const file of configCandidates) {
  if (!fs.existsSync(file)) continue;
  if (!configLoaded) configLoaded = path.basename(file);
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
// Fichier de configuration actuel (édité à distance par le panel).
function configPath() {
  return configCandidates.find((f) => fs.existsSync(f)) || configCandidates[0];
}

const AGENT_KEY = (process.env.AGENT_KEY || '').trim();
const AGENT_PORT = parseInt(process.env.AGENT_PORT, 10) || parseInt(process.env.PORT, 10) || 43600;
const AGENT_HOST = process.env.AGENT_HOST || '0.0.0.0';
const REPO = process.env.UPDATE_REPO || 'lenoobduweb38260-collab/Discord-roblox';
const ASSET = process.platform === 'win32' ? 'discord-roblox-bot-win-x64.exe' : 'discord-roblox-bot-linux-x64';
const exePath = path.join(baseDir, ASSET);
const versionPath = path.join(baseDir, 'bot.version');
const HEADERS = { 'User-Agent': 'discord-roblox-agent-hebergeur', Accept: 'application/vnd.github+json' };

if (!AGENT_KEY) {
  console.error(`❌ AGENT_KEY manquant : définissez une clé d'accès dans le fichier config.env${configLoaded ? ` (fichier lu : ${configLoaded})` : ' (aucun fichier de configuration trouvé à côté de index.js)'}.`);
  console.error('   Cette clé sera demandée par votre panel pour se relier à ce bot.');
  process.exit(1);
}

// ----- Console du bot (mémoire circulaire, lue par le panel) -----
const state = { status: 'arrete', proc: null, startedAt: 0, logs: [], errors: [], logSeq: 0, stopping: false, quickExits: 0 };

function addLine(line, isErr = false) {
  if (!line) return;
  const stamped = `[${new Date().toLocaleTimeString('fr-FR')}] ${line}`;
  state.logs.push(stamped);
  if (state.logs.length > 1000) state.logs.splice(0, state.logs.length - 1000);
  state.logSeq++;
  if (isErr || /❌|⚠️|🛑|erreur|error|unhandled|exception|rejected/i.test(line)) {
    state.errors.push(stamped);
    if (state.errors.length > 300) state.errors.splice(0, state.errors.length - 300);
  }
  console.log(stamped);
}

function wireOutput(stream, isErr) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      addLine(buffer.slice(0, i).replace(/\r$/, ''), isErr);
      buffer = buffer.slice(i + 1);
    }
  });
}

function currentVersion() {
  try {
    return fs.readFileSync(versionPath, 'utf8').trim();
  } catch {
    return null;
  }
}

// ----- Mise à jour du bot depuis les releases GitHub -----
async function updateBot() {
  state.status = 'maj';
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: HEADERS });
    if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
    const release = await res.json();
    if (fs.existsSync(exePath) && currentVersion() === release.tag_name) {
      addLine(`✅ Bot déjà à jour (${release.tag_name}).`);
      state.status = 'arrete';
      return true;
    }
    const asset = (release.assets || []).find((a) => a.name === ASSET);
    if (!asset) throw new Error(`fichier ${ASSET} absent de la release ${release.tag_name}`);
    addLine(`⬇️ Téléchargement de ${ASSET} ${release.tag_name} (${Math.round(asset.size / 1048576)} Mo)…`);
    const dl = await fetch(asset.browser_download_url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
    if (!dl.ok) throw new Error(`téléchargement HTTP ${dl.status}`);
    fs.writeFileSync(`${exePath}.new`, Buffer.from(await dl.arrayBuffer()));
    if (process.platform !== 'win32') fs.chmodSync(`${exePath}.new`, 0o755);
    try {
      fs.renameSync(exePath, `${exePath}.old`);
    } catch {}
    fs.renameSync(`${exePath}.new`, exePath);
    try {
      fs.unlinkSync(`${exePath}.old`);
    } catch {}
    fs.writeFileSync(versionPath, release.tag_name);
    addLine(`✅ Version ${release.tag_name} installée.`);
    state.status = 'arrete';
    return true;
  } catch (err) {
    addLine(`❌ Mise à jour échouée : ${err.message}`, true);
    state.status = 'arrete';
    return false;
  }
}

// ----- Démarrage / arrêt du bot -----
function startBot() {
  if (state.proc) return { error: 'Le bot est déjà démarré.' };
  if (!fs.existsSync(exePath)) return { error: 'Exécutable absent — lancez d\'abord une mise à jour.' };
  state.logs = [];
  state.logSeq++;
  state.stopping = false;
  const env = { ...process.env, BOT_MANAGED: '1', AUTO_UPDATE: 'off' };
  delete env.BOT_JUST_UPDATED;
  delete env.BOT_RESTARTED;
  const proc = spawn(exePath, [], { cwd: baseDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  state.proc = proc;
  state.status = 'demarre';
  state.startedAt = Date.now();
  addLine(`▶️ Bot démarré (PID ${proc.pid}, version ${currentVersion() || '?'}).`);
  wireOutput(proc.stdout, false);
  wireOutput(proc.stderr, true);
  proc.on('exit', (code) => {
    state.proc = null;
    const uptime = Date.now() - state.startedAt;
    if (uptime > 60_000) state.quickExits = 0;
    if (code === 42) {
      // /update sur Discord : mise à jour GitHub puis relance.
      addLine('🔄 /update reçu : mise à jour puis redémarrage…');
      updateBot().then(() => {
        const result = startBot();
        if (result?.error) addLine(`❌ Redémarrage impossible : ${result.error}`, true);
      });
      return;
    }
    state.status = 'arrete';
    addLine(`⏹️ Processus terminé (code ${code}).`, code !== 0 && code !== null);
    // Chez un hébergeur, le bot doit rester en ligne : relance automatique
    // après un crash (avec garde anti-rafale).
    if (!state.stopping && code !== 0 && code !== null) {
      if (uptime < 10_000) {
        state.quickExits++;
        if (state.quickExits >= 3) {
          addLine('🛑 3 crashs immédiats d\'affilée — relance automatique suspendue (voir la console d\'erreurs).', true);
          return;
        }
      }
      addLine('🔁 Relance automatique dans 5 s…');
      setTimeout(() => {
        if (!state.proc && !state.stopping) {
          const result = startBot();
          if (result?.error) addLine(`❌ Relance impossible : ${result.error}`, true);
        }
      }, 5000);
    }
  });
  proc.on('error', (err) => {
    state.proc = null;
    state.status = 'arrete';
    addLine(`❌ Lancement impossible : ${err.message}`, true);
  });
  return { ok: true };
}

function stopBot() {
  if (!state.proc) return { error: 'Le bot n\'est pas démarré.' };
  addLine('⏹️ Arrêt demandé…');
  state.stopping = true;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(state.proc.pid), '/T', '/F'], { stdio: 'ignore' });
    else state.proc.kill('SIGTERM');
  } catch {}
  return { ok: true };
}

function diagnosticText() {
  let fileLog = '';
  try {
    fileLog = fs.readFileSync(path.join(baseDir, 'erreur.log'), 'utf8').split('\n').slice(-30).join('\n');
  } catch {}
  return [
    `=== Diagnostic (agent hébergeur) — ${new Date().toLocaleString('fr-FR')} ===`,
    `Bot ${currentVersion() || '?'} · ${process.platform} · Statut ${state.status} · Repo ${REPO}`,
    '',
    "--- Console d'erreurs (mémoire) ---",
    state.errors.slice(-50).join('\n') || '(vide)',
    '',
    '--- Fichier erreur.log (30 dernières lignes) ---',
    fileLog || '(absent ou vide)',
    '',
    '--- Derniers logs (100 lignes) ---',
    state.logs.slice(-100).join('\n') || '(vide)',
  ].join('\n');
}

// ----- API HTTP pour le panel (clé obligatoire) -----
const sendJson = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
const jsonBody = (req) =>
  new Promise((resolve) => {
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // Clé d'accès : en-tête x-cle (ou ?cle=) sur TOUTES les routes.
    const key = req.headers['x-cle'] || url.searchParams.get('cle') || '';
    if (key !== AGENT_KEY) return sendJson(res, 401, { error: 'Clé d\'accès invalide.' });
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'agent') return sendJson(res, 404, { error: 'Route inconnue.' });
    const action = parts[1] || '';

    if (req.method === 'GET' && action === 'etat') {
      return sendJson(res, 200, {
        ok: true,
        status: state.status,
        version: currentVersion(),
        pid: state.proc?.pid || null,
        uptime: state.proc ? Date.now() - state.startedAt : 0,
        plateforme: process.platform,
      });
    }
    if (req.method === 'POST' && action === 'demarrer') return sendJson(res, 200, startBot());
    if (req.method === 'POST' && action === 'arreter') return sendJson(res, 200, stopBot());
    if (req.method === 'POST' && action === 'maj') {
      const wasRunning = Boolean(state.proc);
      const doUpdate = () =>
        updateBot().then((ok) => {
          if (ok && wasRunning) startBot();
        });
      if (state.proc) {
        state.proc.once('exit', () => setTimeout(doUpdate, 500));
        stopBot();
      } else doUpdate();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && action === 'logs') {
      return sendJson(res, 200, { total: state.logSeq, lines: state.logs.slice(-400) });
    }
    if (req.method === 'GET' && action === 'erreurs') {
      let fileLog = '';
      try {
        fileLog = fs.readFileSync(path.join(baseDir, 'erreur.log'), 'utf8').split('\n').slice(-30).join('\n');
      } catch {}
      return sendJson(res, 200, { lines: state.errors.slice(-200), fichier: fileLog });
    }
    if (req.method === 'GET' && action === 'diagnostic') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(diagnosticText());
    }
    if (req.method === 'GET' && action === 'env') {
      let content = '';
      try {
        content = fs.readFileSync(configPath(), 'utf8');
      } catch {}
      return sendJson(res, 200, { content });
    }
    if (req.method === 'PUT' && action === 'env') {
      const body = await jsonBody(req);
      fs.writeFileSync(configPath(), String(body.content || ''));
      addLine(`📝 Fichier ${path.basename(configPath())} enregistré (redémarrez le bot pour appliquer).`);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && action === 'invitation') {
      let envContent = '';
      try {
        envContent = fs.readFileSync(configPath(), 'utf8');
      } catch {}
      const m = envContent.match(/^\s*CLIENT_ID\s*=\s*(\d+)/m);
      if (!m) return sendJson(res, 400, { error: 'CLIENT_ID manquant dans le fichier de configuration.' });
      return sendJson(res, 200, {
        url: `https://discord.com/oauth2/authorize?client_id=${m[1]}&scope=bot+applications.commands&permissions=8`,
        urlPerso: `https://discord.com/oauth2/authorize?client_id=${m[1]}&integration_type=1&scope=applications.commands`,
      });
    }
    // Proxy vers l'API locale du bot (dashboard, page Serveurs, embeds…).
    if (action === 'proxy') {
      let port = null;
      try {
        port = parseInt(fs.readFileSync(path.join(baseDir, 'api.port'), 'utf8'), 10);
      } catch {}
      if (!port || !state.proc) return sendJson(res, 400, { error: 'Démarrez le bot pour accéder à cette fonction.' });
      const subPath = '/' + parts.slice(2).join('/') + (url.search || '');
      try {
        const upstream = await fetch(`http://127.0.0.1:${port}${subPath}`, {
          method: req.method,
          headers: { 'Content-Type': 'application/json' },
          body: ['POST', 'PUT'].includes(req.method) ? JSON.stringify(await jsonBody(req)) : undefined,
        });
        return sendJson(res, upstream.status, await upstream.json().catch(() => ({})));
      } catch {
        return sendJson(res, 502, { error: 'Bot injoignable — est-il bien démarré ?' });
      }
    }
    return sendJson(res, 404, { error: 'Route inconnue.' });
  } catch (err) {
    try {
      sendJson(res, 500, { error: String(err.message || err) });
    } catch {}
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    state.stopping = true;
    if (state.proc) {
      try {
        state.proc.kill('SIGTERM');
      } catch {}
    }
    setTimeout(() => process.exit(0), 1000);
  });
}

server.listen(AGENT_PORT, AGENT_HOST, () => {
  console.log(`🌍 Agent hébergeur prêt : port ${AGENT_PORT} (clé d'accès requise).`);
  console.log(`📁 Dossier : ${baseDir}`);
  console.log(`⚙️ Configuration lue : ${configLoaded || 'variables d\'environnement de l\'hébergeur uniquement'}`);
  console.log('🔗 Reliez votre panel : ➕ Nouveau bot → « Bot hébergé » → URL http://<ip>:' + AGENT_PORT + ' + clé.');
  // Démarrage automatique : mise à jour depuis GitHub puis lancement du bot.
  updateBot().then(() => {
    const result = startBot();
    if (result?.error) addLine(`⚠️ ${result.error}`, true);
  });
});
