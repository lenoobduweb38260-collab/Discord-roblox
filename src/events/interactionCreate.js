const { Events, MessageFlags } = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { getGrade, GRADES, GRADE_NAMES } = require('../utils/permissions');
const { buildEnterpriseEmbed, sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { handleConfigInteraction } = require('../utils/configPanel');

const getEnterprise = db.prepare('SELECT * FROM enterprises WHERE id = ?');
const setInsuranceTypes = db.prepare('UPDATE enterprises SET insurance_types = ? WHERE id = ?');
const getHeads = db.prepare('SELECT user_id FROM enterprise_heads WHERE enterprise_id = ?');
const getEmployees = db.prepare('SELECT user_id FROM enterprise_employees WHERE enterprise_id = ?');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // ----- Autocomplétion -----
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (err) {
          console.error('Erreur autocomplete :', err);
        }
      }
      return;
    }

    // ----- Panneau central de configuration (/config) -----
    if (
      (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) &&
      interaction.customId?.startsWith('cfg')
    ) {
      if (!interaction.inGuild()) return;
      return handleConfigInteraction(interaction);
    }

    // ----- Menu de sélection des types d'assurance (création/modif d'entreprise) -----
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('entassur:')) {
      if (!interaction.inGuild()) return;
      const grade = getGrade(interaction.member);
      if (grade < GRADES.STAFF) {
        return interaction.reply({
          content: '⛔ Sécurité : seul le **staff** peut définir les assurances.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const entId = Number(interaction.customId.split(':')[1]);
      const ent = getEnterprise.get(entId);
      if (!ent || ent.guild_id !== interaction.guildId) {
        return interaction.update({ content: '❌ Entreprise introuvable.', embeds: [], components: [] });
      }
      setInsuranceTypes.run(JSON.stringify(interaction.values), entId);
      const updated = getEnterprise.get(entId);
      const heads = getHeads.all(entId).map((r) => r.user_id);
      const employees = getEmployees.all(entId).map((r) => r.user_id);
      const { embed, extraContent } = buildEnterpriseEmbed(updated, heads, employees);
      await interaction.update({
        content: extraContent || '',
        embeds: [embed],
        components: [],
      });
      await sendLog(
        interaction.guild,
        logEmbed(
          '🏢 Assurances définies',
          `**${updated.name}** : ${interaction.values.join(', ')}\nPar <@${interaction.user.id}>`,
          COLORS.INFO
        )
      );
      return;
    }

    // ----- Commandes slash -----
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    if (!interaction.inGuild()) {
      return interaction.reply({ content: '⛔ Cette commande s\'utilise sur un serveur.', flags: MessageFlags.Ephemeral });
    }

    // Sécurité centralisée : chaque commande déclare son grade minimum, le
    // contrôle est fait ici (impossible de contourner via l'interface Discord).
    const requiredGrade = command.grade ?? GRADES.EVERYONE;
    const cfg = getGuildConfig(interaction.guildId);
    const memberGrade = getGrade(interaction.member, cfg);
    if (memberGrade < requiredGrade) {
      await sendLog(
        interaction.guild,
        logEmbed(
          '🛑 Accès refusé',
          `<@${interaction.user.id}> a tenté \`/${interaction.commandName}\` (grade requis : **${GRADE_NAMES[requiredGrade]}**).`,
          COLORS.WARNING
        )
      );
      return interaction.reply({
        content: `⛔ Sécurité : cette commande est réservée au grade **${GRADE_NAMES[requiredGrade]}**.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Erreur commande /${interaction.commandName} :`, err);
      const payload = { content: '❌ Une erreur est survenue pendant l\'exécution de la commande.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => null);
      } else {
        await interaction.reply(payload).catch(() => null);
      }
    }
  },
};
