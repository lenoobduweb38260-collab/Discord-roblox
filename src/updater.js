const fs = require('fs');
const { spawn } = require('child_process');

// Mise à jour automatique de l'exécutable : à chaque lancement, on compare la
// version embarquée à la dernière release GitHub ; si elle diffère, on
// télécharge le nouveau binaire, on remplace l'exécutable et on redémarre.
// Désactivable avec AUTO_UPDATE=off dans le .env.

const REPO = process.env.UPDATE_REPO || 'lenoobduweb38260-collab/Discord-roblox';
const ASSET_NAME =
  process.platform === 'win32' ? 'discord-roblox-bot-win-x64.exe' : 'discord-roblox-bot-linux-x64';
const HEADERS = { 'User-Agent': 'discord-roblox-rp-bot', Accept: 'application/vnd.github+json' };

function currentVersion() {
  try {
    return `v${require('../package.json').version}`;
  } catch {
    return 'v0.0.0';
  }
}

// Renvoie true si une mise à jour a été installée (le processus va redémarrer).
async function autoUpdate() {
  if (!process.pkg) return false;
  const execPath = process.execPath;

  // Nettoyage du binaire écarté lors d'une mise à jour précédente.
  try {
    fs.unlinkSync(`${execPath}.old`);
  } catch {}

  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: HEADERS });
  if (!res.ok) {
    console.warn(`⚠️ Vérification de mise à jour impossible (HTTP ${res.status}) — démarrage en l'état.`);
    return false;
  }
  const release = await res.json();
  const latest = release.tag_name;
  const current = currentVersion();
  if (!latest || latest === current) {
    console.log(`✅ Bot à jour (${current}).`);
    return false;
  }

  const asset = (release.assets || []).find((a) => a.name === ASSET_NAME);
  if (!asset) {
    console.warn(`⚠️ Version ${latest} trouvée mais sans fichier ${ASSET_NAME} — démarrage en l'état.`);
    return false;
  }

  console.log(
    `🔄 Mise à jour : ${current} → ${latest} — téléchargement (${Math.round(asset.size / 1048576)} Mo)…`
  );
  const download = await fetch(asset.browser_download_url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (!download.ok) {
    console.warn(`⚠️ Téléchargement impossible (HTTP ${download.status}) — démarrage en l'état.`);
    return false;
  }
  const newPath = `${execPath}.update`;
  fs.writeFileSync(newPath, Buffer.from(await download.arrayBuffer()));
  if (process.platform !== 'win32') fs.chmodSync(newPath, 0o755);

  // Un exécutable en cours d'utilisation ne peut pas être écrasé, mais il peut
  // être renommé : on écarte l'ancien, on installe le nouveau, on relance.
  fs.renameSync(execPath, `${execPath}.old`);
  fs.renameSync(newPath, execPath);
  console.log(`✅ Mise à jour ${latest} installée — redémarrage du bot…`);
  spawn(execPath, process.argv.slice(2), {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, BOT_JUST_UPDATED: '1' },
  }).unref();
  setTimeout(() => process.exit(0), 500);
  return true;
}

module.exports = { autoUpdate };
