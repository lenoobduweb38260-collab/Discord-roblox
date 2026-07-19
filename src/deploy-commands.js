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

  const body = [];
  const commandsPath = path.join(__dirname, 'commands');
  for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
    const mod = require(path.join(commandsPath, file));
    for (const command of Array.isArray(mod) ? mod : [mod]) {
      if (command?.data) body.push(command.data.toJSON());
    }
  }

  const rest = new REST().setToken(DISCORD_TOKEN);
  console.log(`🚀 Enregistrement de ${body.length} commande(s)…`);
  if (GUILD_ID?.trim()) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID.trim()), { body });
    console.log(`✅ Commandes enregistrées sur le serveur ${GUILD_ID.trim()} (instantané).`);
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body });
    console.log('✅ Commandes enregistrées globalement (propagation jusqu\'à 1 h).');
  }
}

module.exports = { deployCommands };

if (require.main === module) {
  deployCommands().catch((err) => {
    console.error(`❌ Échec de l'enregistrement : ${err.message}`);
    process.exit(1);
  });
}
