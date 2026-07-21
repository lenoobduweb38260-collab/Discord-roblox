#!/usr/bin/env node
// 🌍 Agent hébergeur MULTI-BOTS — un seul déploiement fait tourner PLUSIEURS
// bots avec le même code, et votre Gestionnaire (panel sur votre PC) pilote
// chacun à distance : console en direct, ▶/⏹, mises à jour GitHub, config,
// dashboard complet (dont la page 🌐 Serveurs).
//
// Aucune dépendance : Node.js ≥ 18 suffit (node index.js).
//
// - UN exécutable du bot, téléchargé depuis les releases GitHub, partagé
// - UN dossier par bot : bots/<nom>/ (config.env, data.sqlite, logs)
// - UN port + UNE clé (AGENT_KEY) pour tous les bots
// - /update sur Discord (code 42) → mise à jour GitHub puis relance du bot
// - Relance automatique en cas de crash, console par bot en mémoire
//
// Dans le panel : chaque bot relié avec la même URL + la même clé — le nom du
// bot dans le panel = le nom de son dossier chez l'hébergeur.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const baseDir = __dirname;

// Configuration PARTAGÉE de l'agent : config.env (recommandé — beaucoup
// d'hébergeurs refusent les fichiers cachés) ou .env. Les variables du
// panneau de l'hébergeur priment.
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

const AGENT_KEY = (process.env.AGENT_KEY || '').trim();
const AGENT_PORT = parseInt(process.env.AGENT_PORT, 10) || parseInt(process.env.PORT, 10) || 43600;
const AGENT_HOST = process.env.AGENT_HOST || '0.0.0.0';
const REPO = process.env.UPDATE_REPO || 'lenoobduweb38260-collab/Discord-roblox';
const ASSET = process.platform === 'win32' ? 'discord-roblox-bot-win-x64.exe' : 'discord-roblox-bot-linux-x64';
const exePath = path.join(baseDir, ASSET);
const versionPath = path.join(baseDir, 'bot.version');
const botsDir = path.join(baseDir, 'bots');
const HEADERS = { 'User-Agent': 'discord-roblox-agent-hebergeur', Accept: 'application/vnd.github+json' };
const NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;

if (!AGENT_KEY) {
  console.error(`❌ AGENT_KEY manquant : définissez une clé d'accès dans config.env${configLoaded ? ` (fichier lu : ${configLoaded})` : ' (aucun fichier de configuration trouvé à côté de index.js)'}.`);
  console.error('   Cette clé sera demandée par votre panel pour se relier aux bots.');
  process.exit(1);
}
fs.mkdirSync(botsDir, { recursive: true });

// Modèle de configuration PAR BOT (bots/<nom>/config.env), éditable depuis
// l'onglet ⚙️ .env du panel.
const BOT_ENV_TEMPLATE = [
  '# ⚙️ Configuration de CE bot (les réglages AGENT_* sont dans le config.env racine)',
  '',
  '# Token du bot (Portail développeur Discord > Bot > Token)',
  'DISCORD_TOKEN=',
  '',
  "# ID de l'application (General Information > Application ID)",
  'CLIENT_ID=',
  '',
  '# ID du serveur (facultatif : enregistrement instantané des commandes)',
  'GUILD_ID=',
  '',
  '# Votre ID Discord (autorisé à utiliser /stop et reconnu créateur par /info)',
  'OWNER_ID=',
  '',
  "# IDs Discord de l'équipe du bot, séparés par des virgules (staff /info)",
  'BOT_TEAM=',
  '',
  '# Module interactions (/interact) : "on" (défaut) ou "off" sur CE bot',
  'MODULE_INTERACT=on',
  '',
  '# Limite /interact à certains serveurs (IDs séparés par des virgules ; vide = partout)',
  'INTERACT_GUILDS=',
  '',
].join('\n');

// ----- État par bot -----
const bots = new Map(); // nom -> { proc, status, startedAt, logs, errors, logSeq, stopping, quickExits }
function botState(name) {
  if (!bots.has(name)) {
    bots.set(name, { proc: null, status: 'arrete', startedAt: 0, logs: [], errors: [], logSeq: 0, stopping: false, quickExits: 0 });
  }
  return bots.get(name);
}
const botDir = (name) => path.join(botsDir, name);
function ensureBot(name) {
  const dir = botDir(name);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.env'), BOT_ENV_TEMPLATE);
    log(name, `🆕 Dossier du bot créé (${path.relative(baseDir, dir)}) — remplissez sa configuration depuis l'onglet ⚙️ du panel.`);
  }
  return dir;
}
function listBots() {
  try {
    return fs.readdirSync(botsDir).filter((n) => NAME_RE.test(n) && fs.statSync(botDir(n)).isDirectory());
  } catch {
    return [];
  }
}
function readBotEnv(name) {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(botDir(name), 'config.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {}
  return out;
}

function log(name, line, isErr = false) {
  if (!line) return;
  const s = botState(name);
  const stamped = `[${new Date().toLocaleTimeString('fr-FR')}] ${line}`;
  s.logs.push(stamped);
  if (s.logs.length > 1000) s.logs.splice(0, s.logs.length - 1000);
  s.logSeq++;
  if (isErr || /❌|⚠️|🛑|erreur|error|unhandled|exception|rejected/i.test(line)) {
    s.errors.push(stamped);
    if (s.errors.length > 300) s.errors.splice(0, s.errors.length - 300);
  }
  console.log(`[${name}] ${stamped}`);
}

function wireOutput(name, stream, isErr) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      log(name, buffer.slice(0, i).replace(/\r$/, ''), isErr);
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

// ----- Mise à jour de l'exécutable PARTAGÉ (releases GitHub) -----
let updating = null;
function updateShared() {
  if (updating) return updating; // une seule mise à jour à la fois
  updating = (async () => {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: HEADERS });
      if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
      const release = await res.json();
      if (fs.existsSync(exePath) && currentVersion() === release.tag_name) {
        console.log(`✅ Code du bot à jour (${release.tag_name}).`);
        return true;
      }
      const asset = (release.assets || []).find((a) => a.name === ASSET);
      if (!asset) throw new Error(`fichier ${ASSET} absent de la release ${release.tag_name}`);
      console.log(`⬇️ Téléchargement de ${ASSET} ${release.tag_name} (${Math.round(asset.size / 1048576)} Mo)…`);
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
      console.log(`✅ Version ${release.tag_name} installée (partagée par tous les bots).`);
      return true;
    } catch (err) {
      console.warn(`❌ Mise à jour échouée : ${err.message}`);
      return false;
    } finally {
      updating = null;
    }
  })();
  return updating;
}

// ----- Démarrage / arrêt d'un bot -----
function startBot(name) {
  const s = botState(name);
  if (s.proc) return { error: 'Ce bot est déjà démarré.' };
  if (!fs.existsSync(exePath)) return { error: 'Exécutable absent — lancez d\'abord une mise à jour (⬇).' };
  const dir = ensureBot(name);
  const botEnv = readBotEnv(name);
  if (!botEnv.DISCORD_TOKEN?.trim()) {
    return { error: 'DISCORD_TOKEN manquant : remplissez la configuration de ce bot (onglet ⚙️ du panel) puis réessayez.' };
  }
  s.logs = [];
  s.logSeq++;
  s.stopping = false;
  const env = { ...process.env, ...botEnv, BOT_MANAGED: '1', AUTO_UPDATE: 'off', BOT_DIR: dir };
  delete env.BOT_JUST_UPDATED;
  delete env.BOT_RESTARTED;
  delete env.AGENT_KEY; // le bot n'a pas besoin de la clé de l'agent
  const proc = spawn(exePath, [], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  s.proc = proc;
  s.status = 'demarre';
  s.startedAt = Date.now();
  // Mémoire d'état : un bot démarré redémarre automatiquement quand l'agent
  // (ou le serveur de l'hébergeur) redémarre.
  try {
    fs.writeFileSync(path.join(dir, 'autostart'), '1');
  } catch {}
  log(name, `▶️ Bot démarré (PID ${proc.pid}, version ${currentVersion() || '?'}).`);
  wireOutput(name, proc.stdout, false);
  wireOutput(name, proc.stderr, true);
  proc.on('exit', (code) => {
    s.proc = null;
    const uptime = Date.now() - s.startedAt;
    if (uptime > 60_000) s.quickExits = 0;
    if (code === 42) {
      log(name, '🔄 /update reçu : mise à jour GitHub puis redémarrage…');
      updateShared().then(() => {
        const result = startBot(name);
        if (result?.error) log(name, `❌ Redémarrage impossible : ${result.error}`, true);
      });
      return;
    }
    s.status = 'arrete';
    log(name, `⏹️ Processus terminé (code ${code}).`, code !== 0 && code !== null);
    // Chez un hébergeur, les bots doivent rester en ligne : relance auto
    // après un crash, avec garde anti-rafale.
    if (!s.stopping && code !== 0 && code !== null) {
      if (uptime < 10_000) {
        s.quickExits++;
        if (s.quickExits >= 3) {
          log(name, '🛑 3 crashs immédiats d\'affilée — relance automatique suspendue (voir la console d\'erreurs).', true);
          return;
        }
      }
      log(name, '🔁 Relance automatique dans 5 s…');
      setTimeout(() => {
        if (!s.proc && !s.stopping) {
          const result = startBot(name);
          if (result?.error) log(name, `❌ Relance impossible : ${result.error}`, true);
        }
      }, 5000);
    }
  });
  proc.on('error', (err) => {
    s.proc = null;
    s.status = 'arrete';
    log(name, `❌ Lancement impossible : ${err.message}`, true);
  });
  return { ok: true };
}

function stopBot(name) {
  const s = botState(name);
  if (!s.proc) return { error: 'Ce bot n\'est pas démarré.' };
  log(name, '⏹️ Arrêt demandé…');
  s.stopping = true;
  // Arrêt volontaire : pas de reprise au prochain démarrage de l'agent.
  try {
    fs.writeFileSync(path.join(botDir(name), 'autostart'), '0');
  } catch {}
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(s.proc.pid), '/T', '/F'], { stdio: 'ignore' });
    else s.proc.kill('SIGTERM');
  } catch {}
  return { ok: true };
}

function diagnosticText(name) {
  const s = botState(name);
  let fileLog = '';
  try {
    fileLog = fs.readFileSync(path.join(botDir(name), 'erreur.log'), 'utf8').split('\n').slice(-30).join('\n');
  } catch {}
  return [
    `=== Diagnostic du bot « ${name} » (agent hébergeur) — ${new Date().toLocaleString('fr-FR')} ===`,
    `Bot ${currentVersion() || '?'} · ${process.platform} · Statut ${s.status} · Repo ${REPO}`,
    '',
    "--- Console d'erreurs (mémoire) ---",
    s.errors.slice(-50).join('\n') || '(vide)',
    '',
    '--- Fichier erreur.log (30 dernières lignes) ---',
    fileLog || '(absent ou vide)',
    '',
    '--- Derniers logs (100 lignes) ---',
    s.logs.slice(-100).join('\n') || '(vide)',
  ].join('\n');
}

// ----- API HTTP pour le panel (clé obligatoire sur toutes les routes) -----
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
    const key = req.headers['x-cle'] || url.searchParams.get('cle') || '';
    if (key !== AGENT_KEY) return sendJson(res, 401, { error: 'Clé d\'accès invalide.' });
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'agent') return sendJson(res, 404, { error: 'Route inconnue.' });

    // Vue globale (sert aussi de test de connexion au panel).
    if (req.method === 'GET' && parts[1] === 'etat' && parts.length === 2) {
      return sendJson(res, 200, {
        ok: true,
        multi: true,
        version: currentVersion(),
        plateforme: process.platform,
        bots: listBots().map((n) => {
          const s = botState(n);
          return { name: n, status: s.status, pid: s.proc?.pid || null };
        }),
      });
    }

    // Routes par bot : /agent/bots/<nom>/<action>
    if (parts[1] !== 'bots' || parts.length < 4) return sendJson(res, 404, { error: 'Route inconnue.' });
    const name = decodeURIComponent(parts[2]);
    if (!NAME_RE.test(name)) return sendJson(res, 400, { error: 'Nom de bot invalide.' });
    const action = parts[3];
    const s = botState(name);

    if (req.method === 'GET' && action === 'etat') {
      return sendJson(res, 200, {
        ok: true,
        status: s.status,
        version: currentVersion(),
        pid: s.proc?.pid || null,
        uptime: s.proc ? Date.now() - s.startedAt : 0,
      });
    }
    if (req.method === 'POST' && action === 'demarrer') {
      ensureBot(name);
      return sendJson(res, 200, startBot(name));
    }
    if (req.method === 'POST' && action === 'arreter') return sendJson(res, 200, stopBot(name));
    if (req.method === 'POST' && action === 'maj') {
      const wasRunning = Boolean(s.proc);
      const doUpdate = () =>
        updateShared().then((ok) => {
          if (ok && wasRunning) startBot(name);
        });
      if (s.proc) {
        s.proc.once('exit', () => setTimeout(doUpdate, 500));
        stopBot(name);
      } else doUpdate();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && action === 'logs') {
      return sendJson(res, 200, { total: s.logSeq, lines: s.logs.slice(-400) });
    }
    if (req.method === 'GET' && action === 'erreurs') {
      let fileLog = '';
      try {
        fileLog = fs.readFileSync(path.join(botDir(name), 'erreur.log'), 'utf8').split('\n').slice(-30).join('\n');
      } catch {}
      return sendJson(res, 200, { lines: s.errors.slice(-200), fichier: fileLog });
    }
    if (req.method === 'GET' && action === 'diagnostic') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(diagnosticText(name));
    }
    if (req.method === 'GET' && action === 'env') {
      ensureBot(name);
      let content = '';
      try {
        content = fs.readFileSync(path.join(botDir(name), 'config.env'), 'utf8');
      } catch {}
      return sendJson(res, 200, { content });
    }
    if (req.method === 'PUT' && action === 'env') {
      ensureBot(name);
      const body = await jsonBody(req);
      fs.writeFileSync(path.join(botDir(name), 'config.env'), String(body.content || ''));
      log(name, '📝 Configuration enregistrée (redémarrez le bot pour appliquer).');
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && action === 'invitation') {
      const clientId = readBotEnv(name).CLIENT_ID?.match(/\d+/)?.[0];
      if (!clientId) return sendJson(res, 400, { error: 'CLIENT_ID manquant dans la configuration de ce bot (onglet ⚙️).' });
      return sendJson(res, 200, {
        url: `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot+applications.commands&permissions=8`,
        urlPerso: `https://discord.com/oauth2/authorize?client_id=${clientId}&integration_type=1&scope=applications.commands`,
      });
    }
    // Proxy vers l'API locale du bot (dashboard, page 🌐 Serveurs, embeds…).
    if (action === 'proxy') {
      let port = null;
      try {
        port = parseInt(fs.readFileSync(path.join(botDir(name), 'api.port'), 'utf8'), 10);
      } catch {}
      if (!port || !s.proc) return sendJson(res, 400, { error: 'Démarrez le bot pour accéder à cette fonction.' });
      const subPath = '/' + parts.slice(4).join('/') + (url.search || '');
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
    for (const [name, s] of bots) {
      s.stopping = true;
      if (s.proc) {
        try {
          s.proc.kill('SIGTERM');
        } catch {}
      }
    }
    setTimeout(() => process.exit(0), 1000);
  });
}

server.listen(AGENT_PORT, AGENT_HOST, () => {
  console.log(`🌍 Agent hébergeur MULTI-BOTS prêt : port ${AGENT_PORT} (clé d'accès requise).`);
  console.log(`📁 Dossier : ${baseDir} — un sous-dossier par bot dans bots/`);
  console.log(`⚙️ Configuration lue : ${configLoaded || 'variables d\'environnement de l\'hébergeur uniquement'}`);
  console.log(`🔗 Panel : ➕ Nouveau bot → 🌍 Bot hébergé → http://<ip>:${AGENT_PORT} + clé (même URL/clé pour TOUS vos bots).`);
  // Mise à jour du code partagé puis reprise automatique : les bots qui
  // étaient démarrés (fichier autostart = 1) redémarrent ; ceux arrêtés
  // volontairement restent arrêtés ; les bots jamais lancés démarrent dès
  // qu'ils ont un token.
  const boot = async () => {
    await updateShared();
    if (!fs.existsSync(exePath)) {
      console.warn('⏳ Exécutable du bot pas encore téléchargé — nouvel essai dans 60 s.');
      setTimeout(boot, 60_000);
      return;
    }
    for (const name of listBots()) {
      if (botState(name).proc) continue; // déjà démarré entre-temps via le panel
      let flag = null;
      try {
        flag = fs.readFileSync(path.join(botDir(name), 'autostart'), 'utf8').trim();
      } catch {}
      const hasToken = Boolean(readBotEnv(name).DISCORD_TOKEN?.trim());
      if (flag === '0') {
        log(name, 'ℹ️ Bot laissé arrêté (arrêt volontaire avant le redémarrage de l\'agent) — ▶ depuis le panel pour le relancer.');
        continue;
      }
      if (flag === '1' || hasToken) {
        const result = startBot(name);
        if (result?.error) log(name, `⚠️ ${result.error}`, true);
      } else {
        log(name, 'ℹ️ Pas de DISCORD_TOKEN — bot non démarré (remplissez sa configuration via le panel).');
      }
    }
  };
  boot();
});
