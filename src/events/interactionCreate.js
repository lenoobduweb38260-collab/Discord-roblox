const { Events, MessageFlags } = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { getGrade, GRADES, GRADE_NAMES } = require('../utils/permissions');
const { buildEnterpriseEmbed, sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { handleConfigInteraction } = require('../utils/configPanel');
const { handleTicketButton } = require('../utils/tickets');
const { mettreAJour } = require('../utils/reponse');

const getEnterprise = db.prepare('SELECT * FROM enterprises WHERE id = ?');
const setInsuranceTypes = db.prepare('UPDATE enterprises SET insurance_types = ? WHERE id = ?');
const getHeads = db.prepare('SELECT user_id FROM enterprise_heads WHERE enterprise_id = ?');
const getEmployees = db.prepare('SELECT user_id FROM enterprise_employees WHERE enterprise_id = ?');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // 🎨 On retient le serveur de cette interaction : les routes de réponse
    // (/interactions/…/callback, /webhooks/…) ne le disent pas, et sans lui
    // l'identité visuelle par serveur ne s'appliquerait pas aux réponses de
    // commandes — c'est-à-dire à la plupart des embeds du bot.
    try { require('../utils/styleEmbeds').noterInteraction(interaction); } catch {}

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

    // ----- Réponse IA supervisée (interactions en MP du créateur) -----
    if (
      (interaction.isButton() || interaction.isStringSelectMenu()) &&
      interaction.customId?.startsWith('ai:')
    ) {
      return require('../utils/aiResponder').handle(interaction);
    }

    // ----- Éditeur d'embed avec aperçu en direct (/embed, patch notes…) -----
    if (
      (interaction.isButton() || interaction.isChannelSelectMenu() || interaction.isModalSubmit()) &&
      (interaction.customId?.startsWith('emb:') || interaction.customId?.startsWith('embm:'))
    ) {
      if (!interaction.inGuild()) return;
      return require('../utils/embedComposer').handle(interaction);
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

    // ----- Constructeur de panneau : sélection du panneau + modal de contenu -----
    if (
      (interaction.isStringSelectMenu() && interaction.customId === 'tktpansel') ||
      (interaction.isModalSubmit() && interaction.customId === 'tktpanmodal')
    ) {
      if (!interaction.inGuild()) return;
      return require('../utils/tickets').handlePanelBuilder(interaction);
    }

    // ----- Recherche et pagination des panneaux Blacklist/Whitelist RP -----
    if (
      (interaction.isButton() && interaction.customId.startsWith('rprpsearch:')) ||
      (interaction.isButton() && interaction.customId.startsWith('rprppage:')) ||
      (interaction.isModalSubmit() && interaction.customId.startsWith('rprpmodal:'))
    ) {
      if (!interaction.inGuild()) return;
      return require('../utils/rpList').handleSearchInteraction(interaction);
    }

    // ----- Captcha de vérification -----
    // Le bouton porte désormais l'identifiant de son destinataire
    // (« captcha:verify:123456 ») : on compare le préfixe, sans quoi les
    // nouveaux boutons ne seraient plus routés du tout.
    if (
      (interaction.isButton() && interaction.customId.startsWith('captcha:verify')) ||
      (interaction.isModalSubmit() && interaction.customId === 'captcha:check')
    ) {
      if (!interaction.inGuild()) return;
      return require('../utils/captcha').handle(interaction);
    }

    // ----- Partenariats : bouton de validation staff -----
    if (interaction.isButton() && interaction.customId.startsWith('partner:')) {
      if (!interaction.inGuild()) return;
      return require('../commands/partenariat').handleButton(interaction);
    }

    // ----- Vgache : bouton « Réclamer » -----
    if (interaction.isButton() && interaction.customId.startsWith('vg:claim:')) {
      if (!interaction.inGuild()) return;
      return require('../commands/vgache').handleButton(interaction);
    }

    // ----- Aventure SAO : boutons de combat / chasse / forge -----
    if (interaction.isButton() && interaction.customId.startsWith('sao:')) {
      if (!interaction.inGuild()) return;
      return require('../commands/sao').handleButton(interaction);
    }

    // ----- Patch notes : modal + boutons (créateur) -----
    if (
      (interaction.isModalSubmit() && interaction.customId === 'pn:modal') ||
      (interaction.isButton() && interaction.customId.startsWith('pn:'))
    ) {
      return require('../commands/patchnote').handle(interaction);
    }

    // ----- Sélecteur de raison du panneau de tickets (menu déroulant) -----
    // …et sélecteur des réponses types à l'intérieur d'un ticket.
    // …le menu des actions staff, et les sélecteurs de membre qui en découlent.
    if (
      (interaction.isStringSelectMenu() &&
        (interaction.customId === 'tktmenu' ||
          interaction.customId.startsWith('tktpreset:') ||
          interaction.customId.startsWith('tktstaff:'))) ||
      (interaction.isUserSelectMenu?.() &&
        (interaction.customId.startsWith('tktadd:') || interaction.customId.startsWith('tktrem:')))
    ) {
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
      // Les entreprises sont en portée GLOBALE (partagées sur tous les serveurs) :
      // on ne compare donc pas guild_id à celui du serveur courant, sinon la
      // sélection des types d'assurance échouerait toujours (« introuvable »).
      if (!ent) {
        return mettreAJour(interaction, { content: '❌ Entreprise introuvable.', embeds: [], components: [] });
      }
      setInsuranceTypes.run(JSON.stringify(interaction.values), entId);
      const updated = getEnterprise.get(entId);
      const heads = getHeads.all(entId).map((r) => r.user_id);
      const employees = getEmployees.all(entId).map((r) => r.user_id);
      const { embed, extraContent } = buildEnterpriseEmbed(updated, heads, employees);
      await mettreAJour(interaction, {
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
        content: '⛔ Le **Module RP** n\'est pas activé sur ce serveur. Un staff peut l\'activer via `/config` → 🎭 Modules.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Modules par serveur (désactivés par défaut, activables via /config) :
    // chaque commande déclare `guildModule` et la config porte `<module>_enabled`.
    if (command.guildModule && interaction.inGuild() && !cfg[`${command.guildModule}_enabled`]) {
      const labels = { interact: 'Interactions', sao: 'Aventure SAO' };
      return interaction.reply({
        content: `⛔ Le **module ${labels[command.guildModule] || command.guildModule}** n'est pas activé sur ce serveur. Un staff peut l'activer via \`/config\` → 🎭 Modules.`,
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
