const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  InteractionContextType,
  ApplicationIntegrationType,
} = require('discord.js');
const { db } = require('../database');
const { GRADES } = require('../utils/permissions');

// /info [membre] : fiche visible UNIQUEMENT par l'auteur de la commande
// (réponse éphémère) — Nom, ID, blacklist (bientôt), badges d'interactions.
// Si l'auteur (sur lui-même) est le créateur du bot ou un membre de l'équipe
// du bot (BOT_TEAM du .env), un bouton « Me désigner » apparaît : en cliquant,
// le bot publie une embed publique attestant son rôle.

const listUserBadges = db.prepare('SELECT * FROM user_badges WHERE user_id = ? ORDER BY action, level');

const BADGE_NAMES = { 10: '🥉 Bronze', 50: '🥈 Argent', 100: '🥇 Or', 250: '💎 Platine', 500: '👑 Légende' };
const ACTION_NAMES = { kiss: '💋 Bisous', hug: '🤗 Câlins', pat: '🖐️ Caresses', bite: '🦷 Morsures', lick: '👅 Léchouilles' };

// Rôle de l'utilisateur vis-à-vis du bot : 'createur' (OWNER_ID ou
// propriétaire/équipe de l'application Discord), 'staff' (IDs listés dans
// BOT_TEAM, séparés par des virgules), ou null.
async function getBotRole(client, userId) {
  const creators = new Set();
  if (process.env.OWNER_ID?.trim()) creators.add(process.env.OWNER_ID.trim());
  try {
    const app = await client.application.fetch();
    if (app.owner) {
      if (app.owner.members) for (const id of app.owner.members.keys()) creators.add(id); // équipe Discord
      else creators.add(app.owner.id);
    }
  } catch {}
  if (creators.has(userId)) return 'createur';
  const team = (process.env.BOT_TEAM || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (team.includes(userId)) return 'staff';
  return null;
}

function badgesSummary(userId) {
  const rows = listUserBadges.all(userId);
  if (!rows.length) return '*Aucun badge pour le moment — utilisez `/interact` !*';
  const byAction = new Map();
  for (const row of rows) {
    if (!byAction.has(row.action)) byAction.set(row.action, []);
    const name = BADGE_NAMES[row.level];
    if (name) byAction.get(row.action).push(name);
  }
  return [...byAction.entries()]
    .map(([action, badges]) => `${ACTION_NAMES[action] || action} : ${badges.join(' · ')}`)
    .join('\n');
}

module.exports = {
  grade: GRADES.EVERYONE,
  allowDm: true, // utilisable en message privé avec le bot
  userInstall: true, // installable en app utilisateur → enregistrement GLOBAL (fonctionne partout)
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Voir les informations d\'un membre (visible uniquement par vous)')
    .addUserOption((opt) =>
      opt.setName('membre').setDescription('Membre à consulter (vous-même par défaut)').setRequired(false)
    )
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),
  async execute(interaction) {
    const target = interaction.options.getUser('membre') || interaction.user;
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('ℹ️ Informations')
      .setThumbnail(target.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: '💬 Nom', value: target.tag, inline: true },
        { name: '🔢 ID', value: target.id, inline: true },
        { name: '🚫 Blacklist', value: '🔜 *Bientôt disponible*', inline: false },
        { name: '🏅 Badges', value: badgesSummary(target.id), inline: false }
      )
      .setFooter({ text: 'Visible uniquement par vous' });

    const components = [];
    // Le bouton « Me désigner » n'apparaît que si l'auteur consulte SA propre
    // fiche et qu'il est créateur du bot ou membre de son équipe.
    if (target.id === interaction.user.id) {
      const role = await getBotRole(interaction.client, interaction.user.id);
      if (role) {
        embed.addFields({
          name: role === 'createur' ? '👑 Créateur du bot' : '🛡️ Staff du bot',
          value:
            role === 'createur'
              ? 'Vous êtes reconnu comme le **créateur** de ce bot. Cliquez ci-dessous pour le prouver publiquement.'
              : 'Vous êtes reconnu comme **membre du staff** de ce bot. Cliquez ci-dessous pour le prouver publiquement.',
          inline: false,
        });
        components.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`infoclaim:${interaction.user.id}:${role}`)
              .setLabel(role === 'createur' ? '👑 Me désigner comme créateur' : '🛡️ Me désigner comme staff')
              .setStyle(role === 'createur' ? ButtonStyle.Success : ButtonStyle.Primary)
          )
        );
      }
    }

    await interaction.reply({ embeds: [embed], components });
  },

  // Bouton « Me désigner » : publie l'embed de preuve, visible par tout le monde.
  async handleButton(interaction) {
    const [, userId, claimedRole] = interaction.customId.split(':');
    if (interaction.user.id !== userId) {
      return interaction.reply({
        content: '⛔ Ce bouton ne vous appartient pas.',
        flags: MessageFlags.Ephemeral,
      });
    }
    // Revérification : le rôle doit toujours être valide au moment du clic
    // (protection si BOT_TEAM a changé entre-temps).
    const role = await getBotRole(interaction.client, interaction.user.id);
    if (!role || role !== claimedRole) {
      return interaction.reply({
        content: '⛔ Sécurité : votre rôle vis-à-vis du bot n\'est plus valide.',
        flags: MessageFlags.Ephemeral,
      });
    }
    const botName = interaction.client.user.username;
    const embed =
      role === 'createur'
        ? new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle('👑 Créateur officiel du bot')
            .setDescription(
              `<@${interaction.user.id}> est le **créateur** de **${botName}**.\n\n` +
                'Cette attestation est émise par le bot lui-même : elle prouve de manière fiable ' +
                'que ce membre est bien à l\'origine du bot.'
            )
        : new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('🛡️ Membre officiel du staff du bot')
            .setDescription(
              `<@${interaction.user.id}> est bel et bien **membre du staff** de **${botName}**.\n\n` +
                'Cette attestation est émise par le bot lui-même : elle prouve de manière fiable ' +
                'que ce membre fait partie de l\'équipe du bot.'
            );
    embed
      .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
      .setTimestamp()
      .setFooter({ text: `Attestation officielle • ${botName}` });
    // Réponse PUBLIQUE : c'est tout l'intérêt de la preuve.
    await interaction.reply({ embeds: [embed] });
  },
};
