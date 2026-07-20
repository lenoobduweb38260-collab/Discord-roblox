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

const HTTP_HINTS = {
  401: 'token invalide ou expiré — recréez-le',
  403: 'droits insuffisants — le token doit avoir le scope « repo » (token classique) ou Issues + Pull requests en écriture',
  404: 'dépôt ou numéro de PR introuvable — vérifiez les champs dans ⚙️ Paramètres',
};

async function sendReport(name, motif, force = false) {
  const cfg = config.rapport || {};
  const r = rt(name);
  if (!cfg.actif || !cfg.token) {
    if (force) addLine(r, '⚠️ Rapports non configurés : ouvrez ⚙️ Paramètres et renseignez un token GitHub.', true);
    return { nonConfigure: true };
  }
  const sig = (r.errors[r.errors.length - 1] || motif).replace(/^\[[^\]]+\]\s*/, '');
  const prev = reportState.get(name);
  if (!force && prev && prev.sig === sig && Date.now() - prev.at < 6 * 3600 * 1000) {
    addLine(r, 'ℹ️ Rapport non renvoyé (même erreur déjà signalée il y a moins de 6 h).');
    return { error: 'Même erreur déjà signalée il y a moins de 6 h.' };
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
      return { ok: true };
    }
    const message = `Envoi refusé (HTTP ${res.status}) : ${HTTP_HINTS[res.status] || 'erreur GitHub'}`;
    addLine(r, `⚠️ ${message}`, true);
    return { error: message };
  } catch (err) {
    addLine(r, `⚠️ Envoi du rapport impossible : ${err.message}`, true);
    return { error: `Envoi impossible : ${err.message}` };
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
  r.startedAt = Date.now();
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
    const uptime = Date.now() - (r.startedAt || 0);
    if (uptime > 60_000) r.bootRetries = 0; // le bot a tourné : compteur de crashs au démarrage remis à zéro
    addLine(r, `⏹️ Processus terminé (code ${code}).`, code !== 0 && code !== null);
    // Bug connu pkg/libuv sous Windows (« Assertion failed: process_title »,
    // code 3221226505) : plantage aléatoire au tout premier démarrage sans
    // console — on relance automatiquement.
    if (!wasStopping && code === 3221226505 && uptime < 20_000 && (r.bootRetries || 0) < 2) {
      r.bootRetries = (r.bootRetries || 0) + 1;
      addLine(r, `🔁 Plantage au démarrage (bug pkg/libuv connu) — nouvel essai automatique ${r.bootRetries}/2…`);
      setTimeout(() => {
        const result = startBot(name);
        if (result?.error) addLine(r, `❌ Relance impossible : ${result.error}`, true);
      }, 1500);
      return;
    }
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

    // Test du token : vérifie l'authentification GitHub puis l'accès au dépôt.
    if (req.method === 'POST' && parts[1] === 'rapport-test') {
      const cfg = config.rapport || {};
      if (!cfg.token) return sendJson(res, 200, { error: 'Aucun token enregistré — collez-le puis Enregistrer d\'abord.' });
      try {
        const headers = { 'User-Agent': 'gestionnaire-bots', Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json' };
        const userRes = await fetch('https://api.github.com/user', { headers });
        if (!userRes.ok) {
          return sendJson(res, 200, { error: `Token refusé par GitHub (HTTP ${userRes.status}) — recréez-le via le lien 🔑.` });
        }
        const user = await userRes.json();
        const repoRes = await fetch(`https://api.github.com/repos/${cfg.repo || DEFAULT_REPO}`, { headers });
        if (!repoRes.ok) {
          return sendJson(res, 200, {
            error: `Token valide (${user.login}) mais dépôt « ${cfg.repo || DEFAULT_REPO} » inaccessible (HTTP ${repoRes.status}) — vérifiez le champ Dépôt et les droits du token.`,
          });
        }
        return sendJson(res, 200, { ok: true, message: `Token valide — connecté en tant que ${user.login}, dépôt accessible. Les rapports fonctionneront.` });
      } catch (err) {
        return sendJson(res, 200, { error: `Test impossible : ${err.message}` });
      }
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
        const result = await sendReport(name, 'signalement manuel', true);
        return sendJson(res, 200, result);
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
      // Opera GX en priorité s'il est installé, sinon fenêtre d'application
      // dédiée via le mode --app d'Edge (présent sur tous les Windows 10/11).
      const operaPaths = [
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Opera GX', 'launcher.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Opera GX', 'opera.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Opera', 'launcher.exe'),
      ];
      const opera = operaPaths.find((p) => {
        try {
          return fs.existsSync(p);
        } catch {
          return false;
        }
      });
      child = opera
        ? spawn(opera, [url], { detached: true, stdio: 'ignore' })
        : spawn('cmd.exe', ['/c', 'start', '', 'msedge', `--app=${url}`], { detached: true, stdio: 'ignore' });
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
  :root {
    --bg: #141519; --panel: #1b1c21; --panel2: #23242b; --border: #2d2f37;
    --text: #eceded; --muted: #92939e; --accent: #e8593a;
    --green: #43b581; --red: #f04747; --yellow: #faa61a; --blue: #4d9de0;
  }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; }
  ::-webkit-scrollbar { width: 9px; height: 9px; }
  ::-webkit-scrollbar-thumb { background: #33353e; border-radius: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  header { background: var(--panel); padding: 10px 18px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--border); }
  .logo { width: 34px; height: 34px; border-radius: 9px; background: linear-gradient(135deg, var(--accent), #a33520); display: flex; align-items: center; justify-content: center; font-size: 18px; }
  header h1 { font-size: 14px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; }
  header .ver { color: var(--muted); font-size: 11px; background: var(--panel2); border: 1px solid var(--border); padding: 2px 9px; border-radius: 20px; }
  header .spacer { margin-left: auto; }
  main { flex: 1; display: flex; min-height: 0; }
  #sidebar { width: 255px; background: var(--panel); border-right: 1px solid var(--border); overflow-y: auto; padding: 12px 10px; }
  .sblabel { font-size: 10.5px; letter-spacing: 1.2px; color: var(--muted); text-transform: uppercase; padding: 2px 8px 8px; }
  .botcard { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; cursor: pointer; margin-bottom: 5px; border: 1px solid transparent; transition: background .12s; }
  .botcard:hover { background: var(--panel2); }
  .botcard.sel { background: var(--panel2); border-color: var(--accent); }
  .bc-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; background: #565863; }
  .bc-dot.st-demarre { background: var(--green); box-shadow: 0 0 8px rgba(67,181,129,.7); }
  .bc-dot.st-maj { background: var(--yellow); }
  .bc-dot.st-externe { background: var(--blue); }
  .botcard .nm { font-weight: 600; font-size: 13.5px; }
  .botcard .st { display: block; font-size: 11.5px; margin-top: 1px; color: var(--muted); }
  #panel { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  #actions { padding: 12px 16px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; border-bottom: 1px solid var(--border); background: var(--panel); }
  .pill { font-size: 12px; padding: 5px 12px; border-radius: 20px; background: var(--panel2); border: 1px solid var(--border); color: var(--muted); }
  .pill.st-demarre { color: var(--green); border-color: rgba(67,181,129,.45); }
  .pill.st-maj { color: var(--yellow); border-color: rgba(250,166,26,.45); }
  .pill.st-externe { color: var(--blue); border-color: rgba(77,157,224,.45); }
  #actions .meta { color: var(--muted); font-size: 12px; margin-left: auto; }
  button { background: var(--panel2); color: var(--text); border: 1px solid var(--border); padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; transition: filter .12s; }
  button:hover { filter: brightness(1.18); }
  button.accent { background: linear-gradient(135deg, var(--accent), #c04426); border: 0; font-weight: 600; }
  button.green { background: #2d7d46; border: 0; }
  button.red { background: #c73e3e; border: 0; }
  button.yellow { background: #96690d; border: 0; }
  #tabs { display: flex; gap: 18px; padding: 10px 18px 0; background: var(--panel); border-bottom: 1px solid var(--border); }
  #tabs div { padding: 6px 2px 10px; cursor: pointer; color: var(--muted); font-size: 13px; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color .12s; }
  #tabs div:hover { color: var(--text); }
  #tabs div.on { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }
  #content { flex: 1; background: #101114; margin: 14px 16px 16px; border: 1px solid var(--border); border-radius: 12px; overflow: auto; padding: 14px; font-family: Consolas, monospace; font-size: 12.5px; white-space: pre-wrap; word-break: break-word; }
  #content textarea { width: 100%; height: 100%; background: #101114; color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 10px; font-family: Consolas, monospace; font-size: 13px; resize: none; }
  .err { color: #ff8285; }
  dialog { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 14px; padding: 24px; width: 440px; }
  dialog::backdrop { background: rgba(0,0,0,.6); }
  dialog h2 { font-size: 16px; margin-bottom: 12px; }
  dialog label { display: block; font-size: 12px; color: var(--muted); margin: 10px 0 4px; }
  dialog input { width: 100%; background: #101114; border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 9px; font-size: 13px; }
  dialog input:focus { outline: none; border-color: var(--accent); }
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
  .dbitem.on { background: rgba(232,89,58,.14); color: #fff; border-left: 3px solid var(--accent); padding-left: 7px; }
  .dbmain { flex: 1; min-width: 0; overflow-y: auto; }
  .dbtitle { font-size: 17px; margin-bottom: 14px; }
  .dbp { color: #8a8b94; font-size: 13px; margin-bottom: 10px; }
  .dbrow { padding: 8px 10px; background: #1b1c21; border: 1px solid #26272e; border-radius: 8px; margin-bottom: 6px; font-size: 13px; }
  .dsec { margin-bottom: 18px; padding-bottom: 16px; border-bottom: 1px solid #26272e; }
  .dsec h3 { font-size: 14px; margin-bottom: 3px; }
  .dsec p { color: #8a8b94; font-size: 12.5px; margin-bottom: 8px; }
  .dsec select, .dsec input { background: #1b1c21; border: 1px solid #35363f; color: #e6e6e9; border-radius: 6px; padding: 7px; font-size: 13px; max-width: 340px; width: 100%; }
  #toast { position: fixed; bottom: 18px; right: 18px; background: var(--panel2); border: 1px solid var(--accent); padding: 11px 16px; border-radius: 10px; font-size: 13px; display: none; max-width: 420px; box-shadow: 0 6px 24px rgba(0,0,0,.45); }
  .empty { color: #8a8b94; padding: 30px; text-align: center; font-family: 'Segoe UI', sans-serif; }
</style>
</head>
<body>
<header>
  <div class="logo">🤖</div>
  <h1>Gestionnaire de bots</h1><span class="ver" id="ver"></span>
  <span class="spacer"></span>
  <button onclick="openSettings()">⚙️ Paramètres</button>
  <button class="accent" onclick="dlgNew.showModal()">➕ Nouveau bot</button>
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
  <div class="row"><button class="gray" onclick="dlgSet.close()">Annuler</button><button class="gray" onclick="testSettings()">🧪 Tester le token</button><button class="accent" onclick="saveSettings()">Enregistrer</button></div>
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
var STATUS_FR = { demarre: 'démarré', arrete: 'arrêté', maj: 'mise à jour…', externe: 'repris (externe)' };
function refresh() {
  fetch('/api/etat').then(function(r){ return r.json(); }).then(function(s){
    state = s;
    $('ver').textContent = 'v' + s.version;
    var sb = $('sidebar');
    sb.innerHTML = '<div class="sblabel">Mes bots</div>';
    if (!s.bots.length) {
      sb.innerHTML += '<div style="color:var(--muted);font-size:12.5px;padding:6px 8px">Aucun bot pour le moment.<br>Cliquez sur <b>➕ Nouveau bot</b>.</div>';
    }
    s.bots.forEach(function(b){
      var d = document.createElement('div');
      d.className = 'botcard' + (b.name === sel ? ' sel' : '');
      d.innerHTML = '<span class="bc-dot st-' + b.status + '"></span><span><span class="nm">' + b.name + '</span>' +
        '<span class="st">' + (STATUS_FR[b.status] || b.status) + (b.version ? ' · ' + b.version : '') + '</span></span>';
      d.onclick = function(){ selectBot(b.name); };
      sb.appendChild(d);
    });
    if (sel) renderActions();
  });
}
function selectBot(name) { sel = name; tab = 'dash'; renderActions(); renderTabs(); loadTab(); refresh(); }
function botSel() { for (var i = 0; i < state.bots.length; i++) if (state.bots[i].name === sel) return state.bots[i]; return null; }
function renderActions() {
  var b = botSel(); var a = $('actions'); if (!b) { a.innerHTML = ''; return; }
  a.innerHTML = '';
  var pill = document.createElement('span');
  pill.className = 'pill st-' + b.status;
  pill.textContent = '● ' + (STATUS_FR[b.status] || b.status);
  a.appendChild(pill);
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
      if (j && j.ok) toast('📨 Rapport envoyé — Claude le reçoit dans quelques secondes !');
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
  [['dash', '🎛️ Dashboard'], ['embed', '🖼️ Embed'], ['console', '🖥️ Console'], ['erreurs', '🚨 Erreurs'], ['env', '⚙️ .env']].forEach(function(p){
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
        ['tickets', '🎫 Tickets'],
        ['moderation', '🔨 Modération']
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
      h += '<p class="dbp">Un gérant peut whitelister des recrues sur son rôle métier (le bot attribue le rôle automatiquement).</p>';
      p.whitelist.forEach(function(w){
        h += '<div class="dbrow" style="display:flex;align-items:center;gap:8px">👮 <b>@' + w.role + '</b> — géré par @' + w.manager +
          '<button class="wl-del" data-r="' + w.roleId + '" data-m="' + w.managerId + '" style="margin-left:auto;padding:3px 10px;font-size:12px">🗑</button></div>';
      });
      if (!p.whitelist.length) h += '<p class="dbp"><i>Aucune autorisation configurée.</i></p>';
      h += '<div class="dsec" style="margin-top:14px"><h3>➕ Ajouter une autorisation</h3>';
      h += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
      h += '<select id="dw_role" style="max-width:220px"><option value="">— Rôle métier —</option>' + p.roles.map(function(r){ return '<option value="' + r.id + '">@' + r.name + '</option>'; }).join('') + '</select>';
      h += '<select id="dw_mgr" style="max-width:220px"><option value="">— Rôle gérant —</option>' + p.roles.map(function(r){ return '<option value="' + r.id + '">@' + r.name + '</option>'; }).join('') + '</select>';
      h += '<button id="dw_add" class="accent">Ajouter</button></div></div>';
    } else if (page === 'tickets') {
      h += '<h2 class="dbtitle">🎫 Tickets</h2>';
      h += '<p class="dbp">Chaque type crée ses salons dans sa catégorie Discord. Après un ajout ou une suppression, republiez le panneau : <code>/ticket panneau-modifier</code> sur Discord.</p>';
      p.tickets.forEach(function(t){
        h += '<div class="dbrow" style="display:flex;align-items:center;gap:8px">' + (t.emoji ? t.emoji + ' ' : '') + '<b>' + t.label + '</b> — catégorie « ' + t.categorie + ' »' + (t.support ? ' — support @' + t.support : '') +
          '<button class="tk-del" data-id="' + t.id + '" style="margin-left:auto;padding:3px 10px;font-size:12px">🗑</button></div>';
      });
      if (!p.tickets.length) h += '<p class="dbp"><i>Aucun type de ticket.</i></p>';
      h += '<div class="dsec" style="margin-top:14px"><h3>➕ Nouveau type de ticket</h3>';
      h += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
      h += '<input id="dt_nom" placeholder="Nom (ex : Support)" style="max-width:170px">';
      h += '<input id="dt_emoji" placeholder="Emoji" style="max-width:80px">';
      h += '<select id="dt_cat" style="max-width:200px"><option value="">— Catégorie —</option>' + p.categories.map(function(c){ return '<option value="' + c.id + '">' + c.name + '</option>'; }).join('') + '</select>';
      h += '<select id="dt_role" style="max-width:200px"><option value="">— Rôle support (optionnel) —</option>' + p.roles.map(function(r){ return '<option value="' + r.id + '">@' + r.name + '</option>'; }).join('') + '</select>';
      h += '<button id="dt_add" class="accent">Ajouter</button></div></div>';
    } else if (page === 'moderation') {
      h += '<h2 class="dbtitle">🔨 Modération — bans globaux</h2>';
      h += '<p class="dbp">Membres bannis sur tous les serveurs du bot (auto-ban à toute arrivée future). Le débannissement s\\'applique partout.</p>';
      p.bans.forEach(function(b){
        h += '<div class="dbrow" style="display:flex;align-items:center;gap:8px">🔨 <b>' + (b.name || b.userId) + '</b>' + (b.name ? ' <span style="color:var(--muted)">(' + b.userId + ')</span>' : '') +
          (b.reason ? ' — ' + b.reason : '') +
          '<button class="ban-del" data-u="' + b.userId + '" style="margin-left:auto;padding:3px 10px;font-size:12px">Débannir</button></div>';
      });
      if (!p.bans.length) h += '<p class="dbp"><i>Aucun ban global.</i></p>';
    }
    m.innerHTML = h;
    var proxy = function(route, body){ return api('POST', '/api/bots/' + sel + '/proxy/' + route, body); };
    var rerender = function(j){ if (j && j.ok) { toast('✅ ' + (j.note || 'Enregistré')); renderDashPage(page, gid); } };
    if ($('dw_add')) $('dw_add').onclick = function(){
      if (!$('dw_role').value || !$('dw_mgr').value) { toast('⚠️ Choisissez les deux rôles.'); return; }
      proxy('whitelist-ajouter', { guildId: gid, roleId: $('dw_role').value, managerRoleId: $('dw_mgr').value }).then(rerender);
    };
    Array.prototype.forEach.call(m.querySelectorAll('.wl-del'), function(el){
      el.onclick = function(){ proxy('whitelist-retirer', { guildId: gid, roleId: el.getAttribute('data-r'), managerRoleId: el.getAttribute('data-m') }).then(rerender); };
    });
    if ($('dt_add')) $('dt_add').onclick = function(){
      if (!$('dt_nom').value.trim() || !$('dt_cat').value) { toast('⚠️ Nom et catégorie requis.'); return; }
      proxy('tickets-type', { guildId: gid, label: $('dt_nom').value, emoji: $('dt_emoji').value, categoryId: $('dt_cat').value, supportRoleId: $('dt_role').value || null }).then(rerender);
    };
    Array.prototype.forEach.call(m.querySelectorAll('.tk-del'), function(el){
      el.onclick = function(){ if (confirm('Supprimer ce type de ticket ?')) proxy('tickets-type-suppr', { guildId: gid, id: el.getAttribute('data-id') }).then(rerender); };
    });
    Array.prototype.forEach.call(m.querySelectorAll('.ban-del'), function(el){
      el.onclick = function(){ if (confirm('Débannir ce membre sur tous les serveurs ?')) proxy('ban-retirer', { userId: el.getAttribute('data-u') }).then(rerender); };
    });
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
  }).then(function(j){ if (j && j.ok) { dlgSet.close(); toast('✅ Paramètres enregistrés. Utilisez 🧪 Tester pour vérifier le token.'); } });
}
function testSettings() {
  // Enregistre d'abord les champs saisis, puis teste le token contre GitHub.
  api('PUT', '/api/rapport', {
    actif: $('s_actif').checked, token: $('s_token').value,
    repo: $('s_repo').value, issue: $('s_issue').value
  }).then(function(){
    return api('POST', '/api/rapport-test');
  }).then(function(j){
    if (j && j.ok) toast('✅ ' + j.message);
  });
}
refresh(); setInterval(refresh, 2500);
</script>
</body>
</html>`;
