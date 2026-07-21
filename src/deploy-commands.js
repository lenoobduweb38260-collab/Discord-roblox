const fs = require('fs');
const path = require('path');

const baseDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
require('dotenv').config({ path: path.join(baseDir, '.env') });

async function deployCommands() {
  const { REST, Routes } = require('discord.js');
  const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
  if (!DISCORD_TOKEN?.trim() || !CLIENT_ID?.trim()) {
    throw new Error('DISCORD_TOKEN et CLIENT_ID sont requis dans le fichier .env');
  }

  // Les commandes installables sur un compte utilisateur (userInstall) DOIVENT
  // être enregistrées globalement ; les autres vont sur le serveur GUILD_ID
  // (instantané) s'il est défini, sinon tout part en global.
  const globalBody = [];
  const guildBody = [];
  const useGuild = Boolean(GUILD_ID?.trim());
  const commandsPath = path.join(__dirname, 'commands');
  for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
    const mod = require(path.join(commandsPath, file));
    for (const command of Array.isArray(mod) ? mod : [mod]) {
      if (!command?.data) continue;
      const json = command.data.toJSON();
      if (command.userInstall || !useGuild) globalBody.push(json);
      else guildBody.push(json);
    }
  }

  const rest = new REST().setToken(DISCORD_TOKEN);
  console.log(`🚀 Enregistrement de ${globalBody.length + guildBody.length} commande(s)…`);
  if (useGuild) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID.trim()), { body: guildBody });
    console.log(`✅ ${guildBody.length} commande(s) enregistrées sur le serveur ${GUILD_ID.trim()} (instantané).`);
  }
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: globalBody });
  console.log(`✅ ${globalBody.length} commande(s) enregistrées globalement (propagation jusqu'à 1 h la première fois).`);
}

module.exports = { deployCommands };

if (require.main === module) {
  deployCommands().catch((err) => {
    console.error(`❌ Échec de l'enregistrement : ${err.message}`);
    process.exit(1);
  });
}
