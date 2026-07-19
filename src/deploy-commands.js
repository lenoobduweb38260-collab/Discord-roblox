require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('❌ DISCORD_TOKEN et CLIENT_ID sont requis dans le fichier .env.');
  process.exit(1);
}

const body = [];
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const mod = require(path.join(commandsPath, file));
  const commands = Array.isArray(mod) ? mod : [mod];
  for (const command of commands) {
    if (command?.data) body.push(command.data.toJSON());
  }
}

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log(`🚀 Déploiement de ${body.length} commande(s)…`);
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body });
      console.log(`✅ Commandes déployées sur le serveur ${GUILD_ID} (instantané).`);
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body });
      console.log('✅ Commandes déployées globalement (propagation jusqu\'à 1 h).');
    }
  } catch (err) {
    console.error('❌ Échec du déploiement :', err);
    process.exit(1);
  }
})();
