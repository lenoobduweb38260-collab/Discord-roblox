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
// Rapports d'erreurs automatiques : quand un bot plante, le diagnostic est
// posté en commentaire de la PR GitHub — Claude le reçoit automatiquement,
// corrige, et publie une mise à jour que les bots récupèrent tout seuls.
if (!config.rapport) {
  config.rapport = { actif: false, token: '', repo: DEFAULT_REPO, issue: 1 };
}

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

// ----- Rapports d'erreurs vers GitHub (reçus par Claude) -----
const reportState = new Map(); // name -> { sig, at } (anti-doublon)

async function sendReport(name, motif, force = false) {
  const cfg = config.rapport || {};
  const r = rt(name);
  if (!cfg.actif || !cfg.token) {
    if (force) addLine(r, '⚠️ Rapports non configurés : ouvrez ⚙️ Paramètres et renseignez un token GitHub.', true);
    return false;
  }
  const sig = (r.errors[r.errors.length - 1] || motif).replace(/^\[[^\]]+\]\s*/, '');
  const prev = reportState.get(name);
  if (!force && prev && prev.sig === sig && Date.now() - prev.at < 6 * 3600 * 1000) {
    addLine(r, 'ℹ️ Rapport non renvoyé (même erreur déjà signalée il y a moins de 6 h).');
    return false;
  }
  try {
    // Le diagnostic n'inclut JAMAIS le .env (donc jamais le token du bot).
    const body = `## 🚨 Rapport automatique — bot « ${name} » (${motif})\n\n\`\`\`\n${diagnosticText(name).slice(0, 6000)}\n\`\`\``;
    const res = await fetch(
      `https://api.github.com/repos/${cfg.repo || DEFAULT_REPO}/issues/${cfg.issue || 1}/comments`,
      {
        method: 'POST',
        headers: {
          'User-Agent': 'gestionnaire-bots',
          Authorization: `Bearer ${cfg.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      }
    );
    if (res.ok) {
      reportState.set(name, { sig, at: Date.now() });
      addLine(r, '📨 Rapport envoyé à Claude (commentaire GitHub) — correction automatique en route.');
      return true;
    }
    addLine(r, `⚠️ Envoi du rapport impossible (HTTP ${res.status}) — vérifiez le token dans ⚙️ Paramètres.`, true);
  } catch (err) {
    addLine(r, `⚠️ Envoi du rapport impossible : ${err.message}`, true);
  }
  return false;
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
  // Nouvelle session = console propre (l'onglet Erreurs conserve l'historique).
  r.logs = [];
  r.logSeq++;
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
    const wasStopping = r.stopping;
    r.stopping = false;
    r.status = 'arrete';
    addLine(r, `⏹️ Processus terminé (code ${code}).`, code !== 0 && code !== null);
    // Plantage (arrêt non demandé, code d'erreur) → rapport automatique.
    if (!wasStopping && code !== 0 && code !== null) {
      sendReport(name, `plantage — code de sortie ${code}`);
    }
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
    r.stopping = true; // arrêt volontaire : pas de rapport d'erreur
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

    // Paramètres des rapports automatiques (le token n'est jamais renvoyé).
    if (req.method === 'GET' && parts[1] === 'rapport') {
      const cfg = config.rapport || {};
      return sendJson(res, 200, {
        actif: Boolean(cfg.actif),
        repo: cfg.repo || DEFAULT_REPO,
        issue: cfg.issue || 1,
        tokenDefini: Boolean(cfg.token),
      });
    }
    if (req.method === 'PUT' && parts[1] === 'rapport') {
      const body = await jsonBody(req);
      const cfg = config.rapport || (config.rapport = {});
      cfg.actif = Boolean(body.actif);
      if (typeof body.token === 'string' && body.token.trim()) cfg.token = body.token.trim();
      if (typeof body.repo === 'string' && REPO_RE.test(body.repo.trim())) cfg.repo = body.repo.trim();
      const issue = parseInt(body.issue, 10);
      if (issue > 0) cfg.issue = issue;
      saveConfig(config);
      return sendJson(res, 200, { ok: true });
    }

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
      // Proxy vers l'API locale du bot (dashboard, créateur d'embed).
      if (action === 'proxy') {
        let port = null;
        try {
          port = parseInt(fs.readFileSync(path.join(botFolder(name), 'api.port'), 'utf8'), 10);
        } catch {}
        if (!port) return sendJson(res, 400, { error: 'Démarrez le bot pour accéder à cette fonction.' });
        const subPath = '/' + parts.slice(4).join('/') + (url.search || '');
        try {
          const upstream = await fetch(`http://127.0.0.1:${port}${subPath}`, {
            method: req.method,
            headers: { 'Content-Type': 'application/json' },
            body: ['POST', 'PUT'].includes(req.method) ? JSON.stringify(await jsonBody(req)) : undefined,
          });
          const data = await upstream.json().catch(() => ({}));
          return sendJson(res, upstream.status, data);
        } catch {
          return sendJson(res, 502, { error: 'Bot injoignable — est-il bien démarré (et à jour) ?' });
        }
      }

      // Lien d'invitation du bot, construit depuis le CLIENT_ID de son .env.
      if (req.method === 'GET' && action === 'invitation') {
        let envContent = '';
        try {
          envContent = fs.readFileSync(path.join(botFolder(name), '.env'), 'utf8');
        } catch {}
        const m = envContent.match(/^\s*CLIENT_ID\s*=\s*(\d+)/m);
        if (!m) return sendJson(res, 400, { error: 'CLIENT_ID manquant dans le .env de ce bot (onglet ⚙️ .env).' });
        return sendJson(res, 200, {
          url: `https://discord.com/oauth2/authorize?client_id=${m[1]}&scope=bot+applications.commands&permissions=8`,
        });
      }

      if (req.method === 'POST' && action === 'signaler') {
        const cfgRapport = config.rapport || {};
        if (!cfgRapport.actif || !cfgRapport.token) {
          return sendJson(res, 200, { nonConfigure: true });
        }
        sendReport(name, 'signalement manuel', true);
        return sendJson(res, 200, { ok: true });
      }
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
    let child;
    if (process.platform === 'win32') {
      // Fenêtre d'application dédiée (sans onglets ni barre d'adresse) via le
      // mode --app d'Edge, présent sur tous les Windows 10/11 : l'interface
      // s'ouvre comme une vraie application PC.
      child = spawn('cmd.exe', ['/c', 'start', '', 'msedge', `--app=${url}`], {
        detached: true,
        stdio: 'ignore',
      });
    } else {
      child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
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

// ----- Mise à jour automatique du gestionnaire lui-même -----
const MANAGER_ASSET = process.platform === 'win32' ? 'gestionnaire-bots-win-x64.exe' : 'gestionnaire-bots-linux-x64';

async function selfUpdate() {
  if (!process.pkg || process.env.AUTO_UPDATE === 'off' || process.env.MGR_JUST_UPDATED) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${DEFAULT_REPO}/releases/latest`, {
      headers: { 'User-Agent': 'gestionnaire-bots', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return false;
    const release = await res.json();
    const latest = (release.tag_name || '').replace(/^v/, '');
    if (!latest || latest === VERSION) return false;
    const asset = (release.assets || []).find((a) => a.name === MANAGER_ASSET);
    if (!asset) return false;
    console.log(`🔄 Mise à jour du gestionnaire : v${VERSION} → v${latest} — téléchargement…`);
    const dl = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'gestionnaire-bots' } });
    if (!dl.ok) return false;
    const newPath = `${process.execPath}.update`;
    fs.writeFileSync(newPath, Buffer.from(await dl.arrayBuffer()));
    if (process.platform !== 'win32') fs.chmodSync(newPath, 0o755);
    fs.renameSync(process.execPath, `${process.execPath}.old`);
    fs.renameSync(newPath, process.execPath);
    console.log('✅ Gestionnaire mis à jour — redémarrage…');
    const env = { ...process.env, MGR_JUST_UPDATED: '1' };
    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/c', 'start', '', process.execPath], { detached: true, stdio: 'ignore', env })
        : spawn(process.execPath, [], { detached: true, stdio: 'ignore', env });
    child.on('error', () => {});
    child.unref();
    setTimeout(() => process.exit(0), 800);
    return true;
  } catch {
    return false;
  }
}

(async () => {
  try {
    fs.unlinkSync(`${process.execPath}.old`);
  } catch {}
  if (await selfUpdate()) return; // redémarrage en cours avec la nouvelle version
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`🤖 Gestionnaire de bots v${VERSION}`);
    console.log(`📁 Données : ${dataDir}`);
    console.log(`🌐 Interface : http://localhost:${PORT}  (cette fenêtre doit rester ouverte)`);
    adoptOrphans();
    openBrowser();
  });
})();

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
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .tile { background: #1b1c21; border: 1px solid #35363f; border-radius: 10px; padding: 12px; }
  .tile .tv { font-size: 22px; font-weight: 700; }
  .tile .tl { color: #8a8b94; font-size: 12px; margin-top: 2px; }
  .cfgt { border-collapse: collapse; font-size: 13px; }
  .cfgt td { padding: 4px 14px 4px 0; border-bottom: 1px solid #26272e; }
  .frm label { display: block; font-size: 12px; color: #a9aab3; margin: 8px 0 3px; }
  .frm input, .frm textarea, .frm select { width: 100%; background: #1b1c21; border: 1px solid #35363f; color: #e6e6e9; border-radius: 6px; padding: 7px; font-size: 13px; font-family: inherit; }
  .dcard { position: relative; background: #2b2d31; border-left: 4px solid #5865f2; border-radius: 4px; padding: 12px 16px; max-width: 480px; font-size: 13.5px; }
  .dauth { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; margin-bottom: 6px; }
  .dauth img { width: 22px; height: 22px; border-radius: 50%; }
  .dtitle { font-weight: 700; font-size: 15px; margin-bottom: 6px; }
  .ddesc { white-space: pre-wrap; color: #dbdee1; }
  .dthumb { position: absolute; top: 12px; right: 12px; width: 72px; height: 72px; border-radius: 6px; object-fit: cover; }
  .dimg { max-width: 100%; border-radius: 6px; margin-top: 10px; display: block; }
  .dfoot { color: #8a8b94; font-size: 11.5px; margin-top: 10px; }
  .dbside { width: 215px; flex-shrink: 0; border-right: 1px solid #26272e; padding-right: 12px; margin-right: 16px; overflow-y: auto; }
  .dbside select { width: 100%; margin-bottom: 10px; background: #1b1c21; color: #e6e6e9; border: 1px solid #35363f; border-radius: 6px; padding: 6px; }
  .dbitem { padding: 8px 10px; border-radius: 6px; cursor: pointer; color: #a9aab3; font-size: 13px; margin-bottom: 2px; }
  .dbitem:hover { background: #1b1c21; }
  .dbitem.on { background: #2f3040; color: #fff; }
  .dbmain { flex: 1; min-width: 0; overflow-y: auto; }
  .dbtitle { font-size: 17px; margin-bottom: 14px; }
  .dbp { color: #8a8b94; font-size: 13px; margin-bottom: 10px; }
  .dbrow { padding: 8px 10px; background: #1b1c21; border: 1px solid #26272e; border-radius: 8px; margin-bottom: 6px; font-size: 13px; }
  .dsec { margin-bottom: 18px; padding-bottom: 16px; border-bottom: 1px solid #26272e; }
  .dsec h3 { font-size: 14px; margin-bottom: 3px; }
  .dsec p { color: #8a8b94; font-size: 12.5px; margin-bottom: 8px; }
  .dsec select, .dsec input { background: #1b1c21; border: 1px solid #35363f; color: #e6e6e9; border-radius: 6px; padding: 7px; font-size: 13px; max-width: 340px; width: 100%; }
  #toast { position: fixed; bottom: 18px; right: 18px; background: #2f3040; border: 1px solid #5865f2; padding: 10px 16px; border-radius: 8px; font-size: 13px; display: none; max-width: 420px; }
  .empty { color: #8a8b94; padding: 30px; text-align: center; font-family: 'Segoe UI', sans-serif; }
</style>
</head>
<body>
<header>
  <h1>🤖 Gestionnaire de bots</h1><span class="ver" id="ver"></span>
  <button onclick="openSettings()">⚙️ Paramètres</button>
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
<dialog id="dlgSet">
  <h2>⚙️ Rapports d'erreurs automatiques</h2>
  <p style="font-size:12.5px;color:#a9aab3;line-height:1.5">Quand un bot plante, le gestionnaire poste son diagnostic en commentaire de la PR GitHub. <b>Claude le reçoit automatiquement</b>, corrige le code et publie une mise à jour que vos bots récupèrent tout seuls. Le rapport n'inclut jamais votre .env ni vos tokens.</p>
  <label style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" id="s_actif" style="width:auto"> Activer les rapports automatiques</label>
  <p style="font-size:12.5px;margin-top:10px"><a href="https://github.com/settings/tokens/new?scopes=repo&description=Gestionnaire-de-bots" target="_blank" style="color:#7a86ff">🔑 Créer le token en un clic</a> — la page s'ouvre pré-remplie : descendez, cliquez le bouton vert <b>Generate token</b>, copiez le code <code>ghp_…</code> et collez-le ci-dessous.</p>
  <label>Token GitHub</label>
  <input id="s_token" type="password" placeholder="ghp_…">
  <label>Dépôt (proprietaire/depot)</label><input id="s_repo">
  <label>Numéro de la PR (où poster les rapports)</label><input id="s_issue">
  <div class="row"><button class="gray" onclick="dlgSet.close()">Annuler</button><button onclick="saveSettings()">Enregistrer</button></div>
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
  btn('📨 Signaler à Claude', 'gray', function(){
    api('POST', '/api/bots/' + sel + '/signaler').then(function(j){
      if (j && j.nonConfigure) { toast('⚙️ Configurez d\\'abord le token GitHub (une seule fois).'); openSettings(); return; }
      if (j && j.ok) toast('📨 Rapport en cours d\\'envoi — regardez la console du bot.');
    });
  });
  btn('🔗 Inviter sur un serveur', 'gray', function(){
    fetch('/api/bots/' + sel + '/invitation').then(function(r){ return r.json(); }).then(function(j){
      if (j.error) { toast('⚠️ ' + j.error); return; }
      window.open(j.url, '_blank');
      toast('🔗 Lien ouvert — choisissez le serveur puis Autoriser.');
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
  [['console', '🖥️ Console'], ['erreurs', '🚨 Erreurs'], ['dash', '🎛️ Dashboard'], ['embed', '🖼️ Embed'], ['env', '⚙️ .env']].forEach(function(p){
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
  c.style.fontFamily = ''; // police console par défaut (les onglets dash/embed la changent)
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
  } else if (tab === 'dash') {
    c.style.display = 'block';
    c.style.fontFamily = "'Segoe UI', system-ui, sans-serif";
    c.innerHTML = '<div class="empty">Chargement du dashboard…</div>';
    fetch('/api/bots/' + sel + '/proxy/infos').then(function(r){ return r.json(); }).then(function(info){
      if (info.error) { c.innerHTML = '<div class="empty">⚠️ ' + info.error + '</div>'; return; }
      if (!info.guilds || !info.guilds.length) { c.innerHTML = '<div class="empty">Le bot n\\'est sur aucun serveur — utilisez le bouton 🔗 Inviter.</div>'; return; }
      var gid = window.dashGuild || info.guilds[0].id;
      window.dashGuild = gid;
      var page = window.dashPage || 'apercu';
      var pages = [
        ['apercu', '📊 Vue d\\'ensemble'],
        ['membres', '👋 Arrivées et départs'],
        ['niveaux', '📈 Niveaux'],
        ['roles', '👮 Rôles & sécurité'],
        ['salons', '📢 Salons & logs'],
        ['whitelist', '📋 Whitelist métiers'],
        ['tickets', '🎫 Tickets']
      ];
      var h = '<div style="display:flex;height:100%;min-height:340px">';
      h += '<div class="dbside">';
      h += '<select id="dash_g">' + info.guilds.map(function(g){ return '<option value="' + g.id + '"' + (g.id === gid ? ' selected' : '') + '>' + g.name + '</option>'; }).join('') + '</select>';
      pages.forEach(function(p){ h += '<div class="dbitem' + (p[0] === page ? ' on' : '') + '" data-p="' + p[0] + '">' + p[1] + '</div>'; });
      h += '</div><div class="dbmain" id="dbmain"></div></div>';
      c.innerHTML = h;
      $('dash_g').onchange = function(){ window.dashGuild = this.value; loadTab(); };
      Array.prototype.forEach.call(document.querySelectorAll('.dbitem'), function(el){
        el.onclick = function(){ window.dashPage = el.getAttribute('data-p'); loadTab(); };
      });
      renderDashPage(page, gid);
    });
    return;
  } else if (tab === 'embed') {
    c.style.display = 'block';
    c.style.fontFamily = "'Segoe UI', system-ui, sans-serif";
    c.innerHTML = '<div class="empty">Chargement…</div>';
    fetch('/api/bots/' + sel + '/proxy/infos').then(function(r){ return r.json(); }).then(function(info){
      if (info.error) { c.innerHTML = '<div class="empty">⚠️ ' + info.error + '</div>'; return; }
      if (!info.guilds || !info.guilds.length) { c.innerHTML = '<div class="empty">Le bot n\\'est sur aucun serveur — utilisez le bouton 🔗 Inviter.</div>'; return; }
      var fld = function(id, label, ph){ return '<label>' + label + '</label><input id="' + id + '" placeholder="' + (ph || '') + '">'; };
      var h = '<div style="display:flex;gap:18px;align-items:flex-start">';
      h += '<div class="frm" style="flex:0 0 330px">';
      h += '<label>Serveur</label><select id="eb_g"></select>';
      h += '<label>Salon de destination</label><select id="eb_c"></select>';
      h += fld('eb_msg', 'Message (au-dessus de l\\'embed)');
      h += fld('eb_auth', 'Auteur (en-tête de l\\'embed)');
      h += fld('eb_authicon', 'Icône de l\\'auteur (URL)');
      h += fld('eb_t', 'Titre');
      h += '<label>Description</label><textarea id="eb_d" rows="5"></textarea>';
      h += '<label>Couleur</label><input id="eb_col" type="color" value="#5865f2" style="height:34px;padding:2px">';
      h += fld('eb_img', 'Grande image (URL — photo/GIF)', 'https://…');
      h += fld('eb_th', 'Miniature (URL)', 'https://…');
      h += fld('eb_f', 'Pied de page');
      h += '<button id="eb_send" style="margin-top:12px;width:100%">📤 Envoyer dans le salon</button>';
      h += '</div>';
      h += '<div style="flex:1"><div style="color:#8a8b94;font-size:12px;margin-bottom:8px">Prévisualisation en direct</div><div id="eb_pv"></div></div>';
      h += '</div>';
      c.innerHTML = h;
      var esc = function(s){ var d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
      $('eb_g').innerHTML = info.guilds.map(function(g){ return '<option value="' + g.id + '">' + g.name + '</option>'; }).join('');
      var fillChannels = function(){
        var g = info.guilds.filter(function(x){ return x.id === $('eb_g').value; })[0];
        $('eb_c').innerHTML = g.channels.map(function(ch){ return '<option value="' + ch.id + '">#' + ch.name + '</option>'; }).join('');
      };
      var updPv = function(){
        var h2 = '';
        if ($('eb_msg').value) h2 += '<div style="margin-bottom:6px;white-space:pre-wrap">' + esc($('eb_msg').value) + '</div>';
        h2 += '<div class="dcard" style="border-left-color:' + $('eb_col').value + '">';
        if ($('eb_auth').value) h2 += '<div class="dauth">' + ($('eb_authicon').value ? '<img src="' + esc($('eb_authicon').value) + '">' : '') + esc($('eb_auth').value) + '</div>';
        if ($('eb_t').value) h2 += '<div class="dtitle">' + esc($('eb_t').value) + '</div>';
        if ($('eb_d').value) h2 += '<div class="ddesc">' + esc($('eb_d').value) + '</div>';
        if ($('eb_th').value) h2 += '<img class="dthumb" src="' + esc($('eb_th').value) + '">';
        if ($('eb_img').value) h2 += '<img class="dimg" src="' + esc($('eb_img').value) + '">';
        if ($('eb_f').value) h2 += '<div class="dfoot">' + esc($('eb_f').value) + '</div>';
        h2 += '</div>';
        $('eb_pv').innerHTML = h2;
      };
      ['eb_msg','eb_auth','eb_authicon','eb_t','eb_d','eb_col','eb_img','eb_th','eb_f'].forEach(function(id){ $(id).addEventListener('input', updPv); });
      $('eb_g').onchange = fillChannels;
      fillChannels(); updPv();
      $('eb_send').onclick = function(){
        api('POST', '/api/bots/' + sel + '/proxy/embed', {
          guildId: $('eb_g').value, channelId: $('eb_c').value, content: $('eb_msg').value,
          embed: { auteur: $('eb_auth').value, auteur_icone: $('eb_authicon').value, titre: $('eb_t').value,
                   description: $('eb_d').value, couleur: $('eb_col').value, image: $('eb_img').value,
                   miniature: $('eb_th').value, footer: $('eb_f').value }
        }).then(function(j){ if (j && j.ok) toast('✅ Embed envoyé !'); });
      };
    });
    return;
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
// ----- Pages du dashboard (style DraftBot) -----
function dashSave(gid, key, value) {
  api('POST', '/api/bots/' + sel + '/proxy/config', { guildId: gid, key: key, value: value })
    .then(function(j){ if (j && j.ok) toast('✅ Enregistré'); });
}
function dashSelect(key, label, desc, list, current, prefix) {
  var h = '<div class="dsec"><h3>' + label + '</h3><p>' + desc + '</p>';
  h += '<select class="dsave" data-k="' + key + '"><option value="">— Désactivé —</option>';
  list.forEach(function(x){
    h += '<option value="' + x.id + '"' + (x.id === current ? ' selected' : '') + '>' + (prefix || '') + x.name + '</option>';
  });
  h += '</select></div>';
  return h;
}
function dashNumber(key, label, desc, value, min, max) {
  return '<div class="dsec"><h3>' + label + '</h3><p>' + desc + '</p>' +
    '<div style="display:flex;gap:8px"><input type="number" class="dnum" data-k="' + key + '" value="' + value + '" min="' + min + '" max="' + max + '" style="width:120px">' +
    '<button class="dnumsave" data-k="' + key + '">💾</button></div></div>';
}
function renderDashPage(page, gid) {
  var m = $('dbmain');
  m.innerHTML = '<div class="empty">Chargement…</div>';
  if (page === 'apercu') {
    fetch('/api/bots/' + sel + '/proxy/dashboard?guild=' + gid).then(function(r){ return r.json(); }).then(function(d){
      if (d.error) { m.innerHTML = '<div class="empty">⚠️ ' + d.error + '</div>'; return; }
      var h = '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">' +
        (d.serveur.icon ? '<img src="' + d.serveur.icon + '" style="width:48px;height:48px;border-radius:12px">' : '') +
        '<div><div style="font-size:17px;font-weight:600">' + d.serveur.name + '</div>' +
        '<div style="color:#8a8b94;font-size:13px">' + d.serveur.membres + ' membres</div></div></div>';
      var labels = { cartes: "🪪 Cartes d'identité", permis: '🚗 Permis', entreprises: '🏢 Entreprises', ticketsOuverts: '🎫 Tickets ouverts', whitelist: '📋 Whitelist métiers', vehicules: '🛡️ Véhicules assurés' };
      h += '<div class="tiles">';
      Object.keys(labels).forEach(function(k){ h += '<div class="tile"><div class="tv">' + (d.stats[k] || 0) + '</div><div class="tl">' + labels[k] + '</div></div>'; });
      h += '</div>';
      if (d.top && d.top.length) {
        h += '<h3 style="margin:16px 0 8px;font-size:14px">🏆 Top niveaux (écrit)</h3>';
        d.top.forEach(function(t, i){ h += '<div style="padding:3px 0">' + (i + 1) + '. <b>' + t.user + '</b> — niveau ' + t.level + ' (' + t.xp + ' XP)</div>'; });
      }
      m.innerHTML = h;
    });
    return;
  }
  fetch('/api/bots/' + sel + '/proxy/parametres?guild=' + gid).then(function(r){ return r.json(); }).then(function(p){
    if (p.error) { m.innerHTML = '<div class="empty">⚠️ ' + p.error + '</div>'; return; }
    var cfg = p.config, h = '';
    if (page === 'membres') {
      h += '<h2 class="dbtitle">👋 Arrivées et Départs</h2>';
      h += dashSelect('member_channel_id', 'Messages d\\'arrivée et de départ',
        'Embed à chaque arrivée (nom, ID, photo de profil, date de création du compte) et départ (depuis quand le membre avait rejoint le serveur).',
        p.channels, cfg.member_channel_id, '#');
    } else if (page === 'niveaux') {
      h += '<h2 class="dbtitle">📈 Niveaux</h2>';
      h += dashSelect('level_channel_id', 'Salon des annonces de niveau', 'Salon où sont annoncées les montées de niveau (écrit et vocal).', p.channels, cfg.level_channel_id, '#');
      h += dashNumber('xp_text', 'XP par message', 'XP gagné à chaque message (anti-spam via le cooldown).', cfg.xp_text, 1, 1000);
      h += dashNumber('xp_voice', 'XP par minute en vocal', 'XP gagné par minute passée en salon vocal.', cfg.xp_voice, 1, 1000);
      h += dashNumber('xp_cooldown', 'Cooldown XP texte (secondes)', 'Délai minimum entre deux gains d\\'XP texte.', cfg.xp_cooldown, 5, 3600);
    } else if (page === 'roles') {
      h += '<h2 class="dbtitle">👮 Rôles & sécurité</h2>';
      h += dashSelect('staff_role_id', 'Rôle Staff (grade 2)', 'Accès aux commandes staff : cartes, permis, entreprises, modération, tickets…', p.roles, cfg.staff_role_id, '@');
      h += dashSelect('admin_role_id', 'Rôle Administration (grade 3)', 'Accès à /banglobal et aux réglages sensibles.', p.roles, cfg.admin_role_id, '@');
      h += dashSelect('service_role_id', 'Rôle « En service »', 'Ajouté/retiré automatiquement par /service.', p.roles, cfg.service_role_id, '@');
    } else if (page === 'salons') {
      h += '<h2 class="dbtitle">📢 Salons & logs</h2>';
      h += dashSelect('log_channel_id', 'Salon des logs de sécurité', 'Actions staff, accès refusés, vocal, messages supprimés/modifiés, transcripts de tickets.', p.channels, cfg.log_channel_id, '#');
      h += dashSelect('staff_channel_id', 'Salon staff (arrivées/départs de poste)', 'Annonces /arrivee et /depart du staff.', p.channels, cfg.staff_channel_id, '#');
      h += dashSelect('service_channel_id', 'Salon des services RP', 'Annonces de prise et fin de service.', p.channels, cfg.service_channel_id, '#');
    } else if (page === 'whitelist') {
      h += '<h2 class="dbtitle">📋 Whitelist métiers</h2>';
      if (!p.whitelist.length) h += '<p class="dbp">Aucun métier configuré. Sur Discord : <code>/whitelist config ajouter role:@Métier gerant:@Gérant</code></p>';
      else {
        h += '<p class="dbp">Rôles métier et gérants autorisés (gestion via <code>/whitelist config</code> sur Discord) :</p>';
        p.whitelist.forEach(function(w){ h += '<div class="dbrow">👮 <b>@' + w.role + '</b> — géré par @' + w.manager + '</div>'; });
      }
    } else if (page === 'tickets') {
      h += '<h2 class="dbtitle">🎫 Tickets</h2>';
      if (!p.tickets.length) h += '<p class="dbp">Aucun type de ticket. Sur Discord : <code>/ticket type-ajouter</code> puis <code>/ticket panneau</code></p>';
      else {
        h += '<p class="dbp">Types configurés (gestion via <code>/ticket</code> sur Discord, panneau personnalisable via <code>/ticket panneau-modifier</code>) :</p>';
        p.tickets.forEach(function(t){
          h += '<div class="dbrow">' + (t.emoji ? t.emoji + ' ' : '') + '<b>' + t.label + '</b> — catégorie « ' + t.categorie + ' »' + (t.support ? ' — support @' + t.support : '') + '</div>';
        });
      }
    }
    m.innerHTML = h;
    Array.prototype.forEach.call(m.querySelectorAll('.dsave'), function(el){
      el.onchange = function(){ dashSave(gid, el.getAttribute('data-k'), el.value || null); };
    });
    Array.prototype.forEach.call(m.querySelectorAll('.dnumsave'), function(el){
      el.onclick = function(){
        var input = m.querySelector('.dnum[data-k="' + el.getAttribute('data-k') + '"]');
        dashSave(gid, el.getAttribute('data-k'), input.value);
      };
    });
  });
}

function openSettings() {
  fetch('/api/rapport').then(function(r){ return r.json(); }).then(function(j){
    $('s_actif').checked = !!j.actif;
    $('s_token').value = '';
    $('s_token').placeholder = j.tokenDefini ? 'token enregistré — laisser vide pour le conserver' : 'ghp_… ou github_pat_…';
    $('s_repo').value = j.repo || '';
    $('s_issue').value = j.issue || 1;
    dlgSet.showModal();
  });
}
function saveSettings() {
  api('PUT', '/api/rapport', {
    actif: $('s_actif').checked, token: $('s_token').value,
    repo: $('s_repo').value, issue: $('s_issue').value
  }).then(function(j){ if (j && j.ok) { dlgSet.close(); toast('✅ Paramètres enregistrés.'); } });
}
refresh(); setInterval(refresh, 2500);
</script>
</body>
</html>`;
