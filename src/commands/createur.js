const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { isCreator, addImmunity, removeImmunity, listImmunity } = require('../utils/botTeam');
const { relaunch } = require('../updater');

// Pouvoirs réservés au CRÉATEUR du bot (OWNER_ID ou propriétaire de
// l'application) : force update, immunité, retrait manuel d'un serveur.
// Contrôle strict : grade EVERYONE côté framework + vérification isCreator.

async function ensureCreator(interaction) {
  if (await isCreator(interaction.client, interaction.user.id)) return true;
  await interaction.reply({
    content: '⛔ Réservé au **créateur du bot**.',
    flags: MessageFlags.Ephemeral,
  }).catch(() => null);
  return false;
}

// Relance le processus : la nouvelle instance vérifie les mises à jour au
// démarrage et charge donc la dernière version publiée. Sous le Gestionnaire de
// bots, le code de sortie 42 signifie « mets à jour puis relance-moi ».
function restartProcess() {
  if (process.env.BOT_MANAGED === '1') {
    setTimeout(() => process.exit(42), 800);
    return;
  }
  const env = { ...process.env };
  delete env.BOT_JUST_UPDATED;
  env.BOT_RESTARTED = '1';
  relaunch(env);
  setTimeout(() => process.exit(0), 1000);
}

module.exports = [
  {
    grade: GRADES.EVERYONE,
    data: new SlashCommandBuilder()
      .setName('forceupdate')
      .setDescription('[Créateur] Force la mise à jour du bot vers la dernière version publiée'),
    async execute(interaction) {
      if (!(await ensureCreator(interaction))) return;
      await interaction
        .reply('🔄 **Mise à jour forcée…** Le bot télécharge la dernière version publiée et redémarre dans quelques instants.')
        .catch(() => null);
      await sendLog(
        interaction.guild,
        logEmbed('🔄 Force update', `Mise à jour forcée demandée par le créateur <@${interaction.user.id}>.`, COLORS.INFO)
      );
      await interaction.client.destroy().catch(() => null);
      restartProcess();
    },
  },
  {
    grade: GRADES.EVERYONE,
    data: new SlashCommandBuilder()
      .setName('immunite')
      .setDescription('[Créateur] Immunité aux sanctions du bot (ban/kick/mute/blacklist)')
      .addSubcommand((sub) =>
        sub
          .setName('ajouter')
          .setDescription('Immuniser un utilisateur')
          .addUserOption((o) => o.setName('utilisateur').setDescription('Utilisateur à immuniser').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName('retirer')
          .setDescription('Retirer l\'immunité d\'un utilisateur')
          .addUserOption((o) => o.setName('utilisateur').setDescription('Utilisateur concerné').setRequired(true))
      )
      .addSubcommand((sub) => sub.setName('liste').setDescription('Voir les utilisateurs immunisés')),
    async execute(interaction) {
      if (!(await ensureCreator(interaction))) return;
      const sub = interaction.options.getSubcommand();
      if (sub === 'liste') {
        const ids = listImmunity();
        const lines = ids.length ? ids.map((id) => `• <@${id}> (\`${id}\`)`).join('\n') : '*Aucun utilisateur immunisé (le créateur l\'est toujours automatiquement).*';
        return interaction.reply({ content: `🛡️ **Immunités (${ids.length})**\n${lines}`, flags: MessageFlags.Ephemeral });
      }
      const user = interaction.options.getUser('utilisateur');
      if (sub === 'ajouter') {
        addImmunity(user.id);
        await interaction.reply({ content: `🛡️ <@${user.id}> est désormais **immunisé** contre les sanctions du bot.`, flags: MessageFlags.Ephemeral });
      } else {
        removeImmunity(user.id);
        await interaction.reply({ content: `🛡️ Immunité retirée à <@${user.id}>.`, flags: MessageFlags.Ephemeral });
      }
      await sendLog(
        interaction.guild,
        logEmbed('🛡️ Immunité', `<@${user.id}> ${sub === 'ajouter' ? 'immunisé' : 'retiré des immunités'} par le créateur <@${interaction.user.id}>.`, COLORS.INFO)
      );
    },
  },
  {
    grade: GRADES.EVERYONE,
    data: new SlashCommandBuilder()
      .setName('quitter')
      .setDescription('[Créateur] Retire le bot d\'un serveur (par ID)')
      .addStringOption((o) => o.setName('serveur_id').setDescription('ID du serveur à quitter (vide = serveur actuel)').setRequired(false)),
    async execute(interaction) {
      if (!(await ensureCreator(interaction))) return;
      const targetId = (interaction.options.getString('serveur_id') || interaction.guildId || '').trim();
      const guild = interaction.client.guilds.cache.get(targetId);
      if (!guild) {
        return interaction.reply({ content: `❌ Serveur introuvable (le bot y est-il ?) : \`${targetId}\``, flags: MessageFlags.Ephemeral });
      }
      const name = guild.name;
      await interaction.reply({ content: `👋 Le bot quitte **${name}** (\`${guild.id}\`)…`, flags: MessageFlags.Ephemeral }).catch(() => null);
      await guild.leave().catch(async (err) => {
        await interaction.followUp({ content: `❌ Échec : ${err.message}`, flags: MessageFlags.Ephemeral }).catch(() => null);
      });
    },
  },
];
