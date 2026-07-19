require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
require('./database'); // initialise la base de données au démarrage

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN manquant. Copiez .env.example vers .env et remplissez-le.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.GuildMember],
});

// Chargement des commandes (un fichier peut exporter une commande ou un tableau).
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const mod = require(path.join(commandsPath, file));
  const commands = Array.isArray(mod) ? mod : [mod];
  for (const command of commands) {
    if (command?.data && command?.execute) {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`⚠️ Commande invalide ignorée dans ${file}`);
    }
  }
}
console.log(`📦 ${client.commands.size} commande(s) chargée(s) : ${[...client.commands.keys()].join(', ')}`);

// Chargement des événements.
const eventsPath = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsPath, file));
  if (event.once) client.once(event.name, (...args) => event.execute(...args));
  else client.on(event.name, (...args) => event.execute(...args));
}

process.on('unhandledRejection', (err) => console.error('Unhandled rejection :', err));

client.login(process.env.DISCORD_TOKEN);
