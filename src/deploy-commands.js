const path = require('path');

const baseDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
require('dotenv').config({ path: path.join(baseDir, '.env') });

// Enregistrement manuel des commandes. Note : au démarrage, le bot synchronise
// de toute façon tout seul les commandes globales et le jeu de chaque serveur
// selon son Module RP (src/commandSync.js) — ce script sert au dépannage.
async function deployCommands() {
  const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
  if (!DISCORD_TOKEN?.trim() || !CLIENT_ID?.trim()) {
    throw new Error('DISCORD_TOKEN et CLIENT_ID sont requis dans le fichier .env');
  }
  const { REST, Routes } = require('discord.js');
  const { loadDefs, syncGuild } = require('./commandSync');
  const { globalCmds } = loadDefs();
  const rest = new REST().setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: globalCmds });
  console.log(`✅ ${globalCmds.length} commande(s) globale(s) (app utilisateur) enregistrées.`);
  if (GUILD_ID?.trim()) {
    const result = await syncGuild(GUILD_ID.trim());
    console.log(
      `✅ ${result.total} commande(s) enregistrées sur le serveur ${GUILD_ID.trim()} (Module RP ${result.rp ? 'activé' : 'désactivé'}).`
    );
  } else {
    console.log('ℹ️ Les jeux de commandes par serveur se synchronisent automatiquement au démarrage du bot.');
  }
}

module.exports = { deployCommands };

if (require.main === module) {
  deployCommands().catch((err) => {
    console.error(`❌ Échec de l'enregistrement : ${err.message}`);
    process.exit(1);
  });
}
