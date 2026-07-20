// Masque les avertissements de dépréciation de Node (ex : punycode DEP0040)
// qui polluent la console sans être des erreurs.
process.noDeprecation = true;

const fs = require('fs');
const path = require('path');

// En exécutable packagé (pkg), les fichiers de l'utilisateur (.env, data.sqlite)
// vivent à côté de l'exécutable ; en mode Node classique, à la racine du projet.
const baseDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const envPath = path.join(baseDir, '.env');

const ENV_TEMPLATE = `# Token du bot (Portail développeur Discord > Bot > Token)
DISCORD_TOKEN=

# ID de l'application (Portail développeur Discord > General Information > Application ID)
CLIENT_ID=

# Optionnel : ID de votre serveur pour un enregistrement instantané des commandes.
# Laissez vide pour un enregistrement global (propagation jusqu'à 1 h).
GUILD_ID=
`;

// Premier lancement de l'exécutable : on crée un .env à remplir à côté de l'exe.
if (process.pkg && !fs.existsSync(envPath)) {
  try {
    fs.writeFileSync(envPath, ENV_TEMPLATE, { flag: 'wx' });
  } catch {
    // impossible d'écrire : on continuera avec les variables d'environnement
  }
}
require('dotenv').config({ path: envPath });

// Toute erreur fatale est aussi consignée dans erreur.log à côté de
// l'exécutable, pour pouvoir diagnostiquer même si la fenêtre s'est fermée.
function logErrorFile(message) {
  try {
    fs.appendFileSync(path.join(baseDir, 'erreur.log'), `[${new Date().toISOString()}] ${message}\n`);
  } catch {}
}

// En exécutable lancé par double-clic, la fenêtre se ferme dès la fin du
// processus : on attend Entrée pour que l'utilisateur puisse lire l'erreur.
function fatal(message) {
  console.error(message);
  logErrorFile(message);
  if (process.pkg && process.stdin.isTTY) {
    console.log('\nAppuyez sur Entrée pour fermer cette fenêtre…');
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => process.exit(1));
    return;
  }
  process.exit(1);
}

// Garde-fous : la fenêtre ne doit jamais se fermer sans explication.
process.on('uncaughtException', (err) => {
  logErrorFile(`uncaughtException : ${err?.stack || err}`);
  fatal(`❌ Erreur inattendue : ${err?.message || err}`);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection :', err);
  logErrorFile(`unhandledRejection : ${err?.stack || err}`);
});

function loadCommandFiles() {
  const commandsPath = path.join(__dirname, 'commands');
  const commands = [];
  for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
    const mod = require(path.join(commandsPath, file));
    for (const command of Array.isArray(mod) ? mod : [mod]) {
      if (command?.data && command?.execute) commands.push(command);
      else console.warn(`⚠️ Commande invalide ignorée dans ${file}`);
    }
  }
  return commands;
}

const mode = (process.argv[2] || 'start').toLowerCase();

if (mode === 'check') {
  // Auto-test (utilisé par la CI) : initialise la base SQLite (module natif)
  // et charge toutes les commandes, sans se connecter à Discord.
  require('./database');
  const commands = loadCommandFiles();
  console.log(`✅ Auto-test OK : base de données initialisée, ${commands.length} commande(s) chargée(s).`);
  process.exit(0);
} else if (mode === 'deploy') {
  require('./deploy-commands')
    .deployCommands()
    .then(() => process.exit(0))
    .catch((err) => fatal(`❌ Échec de l'enregistrement des commandes : ${err.message}`));
} else {
  start().catch((err) => {
    logErrorFile(`start() : ${err?.stack || err}`);
    fatal(`❌ Démarrage impossible : ${err?.message || err}`);
  });
}

// ----- Verrou d'instance unique -----
// Empêche de lancer deux fois le bot : deux instances connectées avec le même
// token se disputent les interactions (erreurs « Unknown interaction ») et une
// ancienne instance peut rester en ligne avec du vieux code après une mise à
// jour. Au redémarrage (update), la nouvelle instance patiente le temps que
// l'ancienne se ferme.
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock() {
  // Défini ICI (et pas au niveau du module) : start() s'exécute avant la fin
  // du chargement du module, une constante déclarée plus bas serait encore
  // dans sa « zone morte » (ReferenceError).
  const lockPath = path.join(baseDir, 'bot.lock');
  for (let attempt = 0; attempt < 16; attempt++) {
    let existing = null;
    try {
      existing = parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
    } catch {}
    if (existing && existing !== process.pid && pidAlive(existing)) {
      if (attempt === 0) console.log('⏳ Une autre instance se ferme peut-être, patientez…');
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    try {
      fs.writeFileSync(lockPath, String(process.pid));
      process.on('exit', () => {
        try {
          if (parseInt(fs.readFileSync(lockPath, 'utf8'), 10) === process.pid) fs.unlinkSync(lockPath);
        } catch {}
      });
    } catch (err) {
      // Non bloquant : on continue sans verrou, mais on affiche la cause réelle
      // (EPERM = droits/antivirus, EROFS = dossier en lecture seule, etc.)
      console.warn(`⚠️ Verrou bot.lock non écrit (${err.code || err.message}) — démarrage sans verrou d'instance.`);
      logErrorFile(`bot.lock non écrit : ${err.stack || err}`);
    }
    return true;
  }
  return false;
}

async function start() {
  console.log(`🤖 Bot Discord RP — version v${(() => { try { return require('../package.json').version; } catch { return '?'; } })()}`);

  // Lancement manuel = prise de main : sur Windows, on ferme d'office toutes
  // les autres instances du même exécutable (anciennes versions comprises),
  // pour éviter les doublons connectés avec le même token. Les instances
  // issues d'un redémarrage automatique (update/restart) ne balaient pas :
  // elles attendent le verrou, ce qui évite qu'elles s'entretuent.
  const isRespawn = Boolean(process.env.BOT_JUST_UPDATED || process.env.BOT_RESTARTED);
  const isManaged = process.env.BOT_MANAGED === '1'; // lancé par le Gestionnaire de bots
  if (!isRespawn && !isManaged && process.pkg && process.platform === 'win32') {
    try {
      const { spawnSync } = require('child_process');
      spawnSync(
        'taskkill',
        ['/F', '/FI', `PID ne ${process.pid}`, '/IM', path.basename(process.execPath)],
        { stdio: 'ignore' }
      );
    } catch {}
  }

  if (!(await acquireLock())) {
    fatal(
      '❌ Le bot est déjà lancé (une autre fenêtre/instance est en cours d\'exécution).\n' +
        'Fermez l\'autre fenêtre du bot puis relancez, ou utilisez la commande /update sur Discord pour le redémarrer.'
    );
    return;
  }

  // Mise à jour automatique depuis les releases GitHub (exécutable uniquement).
  if (process.pkg && process.env.AUTO_UPDATE !== 'off' && !process.env.BOT_JUST_UPDATED) {
    try {
      if (await require('./updater').autoUpdate()) return; // redémarrage en cours
    } catch (err) {
      console.warn(`⚠️ Mise à jour automatique ignorée : ${err.message}`);
    }
  }

  if (!process.env.DISCORD_TOKEN?.trim()) {
    fatal(
      `❌ DISCORD_TOKEN manquant.\n\n` +
        `1. Ouvrez le fichier .env ici : ${envPath}\n` +
        `2. Collez le token de votre bot (Portail développeur Discord > Bot > Reset Token)\n` +
        `   ainsi que le CLIENT_ID (General Information > Application ID).\n` +
        `3. Relancez le bot.`
    );
    return;
  }

  const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
  require('./database'); // initialise la base de données au démarrage

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildModeration,
    ],
    partials: [Partials.GuildMember, Partials.Message, Partials.Channel],
  });

  client.commands = new Collection();
  for (const command of loadCommandFiles()) {
    client.commands.set(command.data.name, command);
  }
  console.log(`📦 ${client.commands.size} commande(s) chargée(s) : ${[...client.commands.keys()].join(', ')}`);

  const eventsPath = path.join(__dirname, 'events');
  for (const file of fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'))) {
    const event = require(path.join(eventsPath, file));
    if (event.once) client.once(event.name, (...args) => event.execute(...args));
    else client.on(event.name, (...args) => event.execute(...args));
  }

  // En exécutable : enregistrement automatique des commandes slash au démarrage,
  // pour que tout fonctionne sans étape supplémentaire.
  const autoDeploy = async () => {
    if (!process.pkg) return;
    if (!process.env.CLIENT_ID?.trim()) {
      console.warn('⚠️ CLIENT_ID manquant dans le .env : les commandes slash ne seront pas enregistrées automatiquement.');
      return;
    }
    try {
      await require('./deploy-commands').deployCommands();
    } catch (err) {
      console.error(`⚠️ Enregistrement automatique des commandes impossible : ${err.message}`);
    }
  };

  autoDeploy().then(() =>
    client
      .login(process.env.DISCORD_TOKEN)
      .catch((err) =>
        fatal(
          `❌ Connexion à Discord impossible : ${err.message}\n\n` +
            `Vérifiez le DISCORD_TOKEN dans ${envPath}\n` +
            `et que les intents "Server Members" et "Message Content" sont activés\n` +
            `(Portail développeur Discord > Bot > Privileged Gateway Intents).`
        )
      )
  );
}
