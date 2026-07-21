const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const { getGuildConfig } = require('./database');

// Synchronisation des commandes par serveur selon la configuration :
// - commandes « app utilisateur » (userInstall) → GLOBALES
// - commandes de base → chaque serveur
// - commandes du Module RP (module: 'rp') → uniquement sur les serveurs où
//   le Module RP est activé (/config → 🎭 Module RP)

let defs = null;
function loadDefs() {
  if (defs) return defs;
  const globalCmds = [];
  const baseCmds = [];
  const rpCmds = [];
  const commandsPath = path.join(__dirname, 'commands');
  for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
    const mod = require(path.join(commandsPath, file));
    for (const command of Array.isArray(mod) ? mod : [mod]) {
      if (!command?.data) continue;
      const json = command.data.toJSON();
      if (command.userInstall) globalCmds.push(json);
      else if (command.module === 'rp') rpCmds.push(json);
      else baseCmds.push(json);
    }
  }
  defs = { globalCmds, baseCmds, rpCmds };
  return defs;
}

function makeRest() {
  return new REST().setToken(process.env.DISCORD_TOKEN);
}

// Enregistre le jeu de commandes d'UN serveur selon son Module RP.
async function syncGuild(guildId) {
  const clientId = process.env.CLIENT_ID?.trim();
  if (!clientId) throw new Error('CLIENT_ID manquant dans le .env');
  const { baseCmds, rpCmds } = loadDefs();
  const cfg = getGuildConfig(guildId);
  const body = cfg.rp_enabled ? [...baseCmds, ...rpCmds] : baseCmds;
  await makeRest().put(Routes.applicationGuildCommands(clientId, guildId), { body });
  return { total: body.length, rp: Boolean(cfg.rp_enabled) };
}

// Commandes globales (app utilisateur) puis jeu par serveur.
async function syncAll(client) {
  const clientId = process.env.CLIENT_ID?.trim();
  if (!clientId) {
    console.warn('⚠️ CLIENT_ID manquant dans le .env : commandes non synchronisées.');
    return;
  }
  const { globalCmds } = loadDefs();
  await makeRest().put(Routes.applicationCommands(clientId), { body: globalCmds });
  console.log(`🌍 ${globalCmds.length} commande(s) globale(s) (app utilisateur) synchronisée(s).`);
  for (const guild of client.guilds.cache.values()) {
    try {
      const result = await syncGuild(guild.id);
      console.log(`🔄 ${guild.name} : ${result.total} commande(s), Module RP ${result.rp ? '🟢 activé' : '🔴 désactivé'}.`);
    } catch (err) {
      console.warn(`⚠️ Sync commandes de ${guild.name} : ${err.message}`);
    }
  }
}

module.exports = { loadDefs, syncGuild, syncAll };
