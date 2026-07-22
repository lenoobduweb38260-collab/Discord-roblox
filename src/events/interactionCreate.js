const { Events, MessageFlags } = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { getGrade, GRADES, GRADE_NAMES } = require('../utils/permissions');
const { buildEnterpriseEmbed, sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { handleConfigInteraction } = require('../utils/configPanel');
const { handleTicketButton } = require('../utils/tickets');

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

    // ----- Boutons des interactions Nekotina (/interact) — serveurs ET MP -----
    if (interaction.isButton() && interaction.customId.startsWith('itx')) {
      const interact = require('../commands/interact');
      const blocked = interact.moduleBlocked(interaction);
      if (blocked) return interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral });
      return interact.handleButton(interaction);
    }

    // ----- Bouton « Me désigner » de /info (preuve créateur/staff du bot) -----
    if (interaction.isButton() && interaction.customId.startsWith('infoclaim:')) {
      return require('../commands/info').handleButton(interaction);
    }

    // ----- Boutons du QG des tickets de l'équipe du bot (bans + reports) -----
    if (interaction.isButton() && interaction.customId.startsWith('btk:')) {
      if (!interaction.inGuild()) return;
      try {
        return await require('../utils/botTickets').handleButton(interaction);
      } catch (err) {
        console.error('Erreur ticket QG :', err);
        return interaction
          .reply({ content: '❌ Une erreur est survenue sur ce ticket.', flags: MessageFlags.Ephemeral })
          .catch(() => null);
      }
    }

    // ----- Boutons du système de tickets -----
    if (interaction.isButton() && interaction.customId.startsWith('tkt')) {
      if (!interaction.inGuild()) return;
      return handleTicketButton(interaction);
    }

    // ----- Sélecteur de raison du panneau de tickets (menu déroulant) -----
    if (interaction.isStringSelectMenu() && interaction.customId === 'tktmenu') {
      if (!interaction.inGuild()) return;
      return handleTicketButton(interaction);
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

    if (!interaction.inGuild() && !command.allowDm) {
      return interaction.reply({ content: '⛔ Cette commande s\'utilise sur un serveur.', flags: MessageFlags.Ephemeral });
    }

    // Module interactions : l'administrateur du bot peut le désactiver sur ce
    // bot (MODULE_INTERACT=off) ou le limiter à certains serveurs
    // (INTERACT_GUILDS) — contrôle appliqué même si la commande était déjà
    // enregistrée avant le changement de réglage.
    if (command.botModule === 'interact') {
      const blocked = command.moduleBlocked?.(interaction);
      if (blocked) {
        return interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral });
      }
    }

    // Réponses en « lecture seule » : toutes les réponses de commandes sont
    // éphémères par défaut (visibles uniquement par leur auteur) pour ne pas
    // inonder les salons textuels. Les annonces publiques passent par les
    // salons dédiés configurés — et les commandes marquées `public`
    // (ex : /interact) répondent visiblement pour tout le monde.
    if (!command.public) {
      const makeEphemeral = (options) => {
        if (typeof options === 'string') options = { content: options };
        if (options && typeof options === 'object' && options.flags === undefined) {
          options = { ...options, flags: MessageFlags.Ephemeral };
        }
        return options;
      };
      for (const method of ['reply', 'deferReply', 'followUp']) {
        const original = interaction[method].bind(interaction);
        interaction[method] = (options = {}) => original(makeEphemeral(options));
      }
    }

    // Sécurité centralisée : chaque commande déclare son grade minimum, le
    // contrôle est fait ici (impossible de contourner via l'interface Discord).
    // Le grade n'est calculé que s'il est exigé : en contexte « app
    // utilisateur » (serveur où le bot n'est pas membre), le membre est un
    // objet brut sans permissions exploitables.
    const requiredGrade = command.grade ?? GRADES.EVERYONE;
    const cfg = getGuildConfig(interaction.guildId);

    // Module RP : ses commandes sont refusées tant qu'il n'est pas activé
    // (elles sont aussi retirées de la liste du serveur par la synchronisation).
    if (command.module === 'rp' && interaction.inGuild() && !cfg.rp_enabled) {
      return interaction.reply({
        content: '⛔ Le **Module RP** n\'est pas activé sur ce serveur. Un staff peut l\'activer via `/config` → 🎭 Module RP.',
        flags: MessageFlags.Ephemeral,
      });
    }
    const memberGrade = requiredGrade > GRADES.EVERYONE ? getGrade(interaction.member, cfg) : GRADES.EVERYONE;
    if (memberGrade < requiredGrade) {
      if (interaction.guild) {
        await sendLog(
          interaction.guild,
          logEmbed(
            '🛑 Accès refusé',
            `<@${interaction.user.id}> a tenté \`/${interaction.commandName}\` (grade requis : **${GRADE_NAMES[requiredGrade]}**).`,
            COLORS.WARNING
          )
        );
      }
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
