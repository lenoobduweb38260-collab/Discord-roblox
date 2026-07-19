const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { spawn } = require('child_process');
const { GRADES } = require('../utils/permissions');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

// Renvoie les IDs autorisés comme « propriétaire du bot » : OWNER_ID du .env
// et le(s) propriétaire(s) de l'application Discord (utilisateur ou équipe).
async function ownerIds(client) {
  const ids = new Set();
  if (process.env.OWNER_ID?.trim()) ids.add(process.env.OWNER_ID.trim());
  try {
    const app = await client.application.fetch();
    if (app.owner) {
      if (app.owner.members) for (const id of app.owner.members.keys()) ids.add(id); // équipe
      else ids.add(app.owner.id); // utilisateur
    }
  } catch {}
  return ids;
}

// Relance le processus (exécutable ou node) : la nouvelle instance vérifie
// les mises à jour au démarrage et charge donc la dernière version publiée.
function restartProcess() {
  const env = { ...process.env };
  delete env.BOT_JUST_UPDATED; // force la vérification de mise à jour
  spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: 'ignore', env }).unref();
  setTimeout(() => process.exit(0), 1000);
}

module.exports = [
  {
    grade: GRADES.ADMIN,
    data: new SlashCommandBuilder()
      .setName('update')
      .setDescription('[Admin] Redémarre le bot pour charger la dernière mise à jour publiée'),
    async execute(interaction) {
      // Même si la réponse Discord échoue (interaction expirée, doublon
      // d'instance…), le redémarrage doit avoir lieu quand même.
      await interaction
        .reply(
          '🔄 **Redémarrage pour mise à jour…** Le bot vérifie la dernière version publiée sur GitHub, ' +
            'l\'installe si besoin et revient en ligne dans quelques instants.'
        )
        .catch(() => null);
      await sendLog(
        interaction.guild,
        logEmbed('🔄 Update', `Redémarrage pour mise à jour demandé par <@${interaction.user.id}>.`, COLORS.INFO)
      );
      await interaction.client.destroy().catch(() => null);
      restartProcess();
    },
  },
  {
    grade: GRADES.EVERYONE, // contrôle strict : propriétaire du bot uniquement
    data: new SlashCommandBuilder()
      .setName('stop')
      .setDescription('[Propriétaire du bot] Éteint complètement le bot, depuis n\'importe quel serveur'),
    async execute(interaction) {
      const owners = await ownerIds(interaction.client);
      if (!owners.has(interaction.user.id)) {
        await sendLog(
          interaction.guild,
          logEmbed('🛑 /stop refusé', `<@${interaction.user.id}> a tenté d'éteindre le bot sans être propriétaire.`, COLORS.WARNING)
        );
        return interaction.reply({
          content: '⛔ Sécurité : seul le **propriétaire du bot** peut utiliser cette commande.',
          flags: MessageFlags.Ephemeral,
        });
      }
      await interaction.reply('🛑 **Arrêt du bot.** À bientôt !').catch(() => null);
      await sendLog(
        interaction.guild,
        logEmbed('🛑 Bot éteint', `Arrêt demandé par le propriétaire <@${interaction.user.id}>.`, COLORS.DANGER)
      );
      await interaction.client.destroy().catch(() => null);
      setTimeout(() => process.exit(0), 500);
    },
  },
];
