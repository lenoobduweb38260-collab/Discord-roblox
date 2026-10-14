const {
  SlashCommandBuilder, EmbedBuilder, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ChannelType,
} = require('discord.js');
const { GRADES, getGrade } = require('../utils/permissions');
const { getGuildConfig } = require('../database');
const { COLORS, sendLog, logEmbed } = require('../utils/embeds');
const { themeDe } = require('../utils/rpThemes');
const MAT = require('../utils/matricules');
const M = require('../utils/miseEnPage');

// 🔢 /matricule — le numéro qui relie le jeu et Discord.
//
// En jeu on connaît quelqu'un par son pseudo ou son matricule ; pour agir sur
// Discord il faut son identifiant. Faire le lien à la main coûte une recherche
// à chaque fois, et se trompe dès que deux pseudos se ressemblent.
//
// La commande appartient au **Module RP** (`module: 'rp'`) : module coupé,
// elle disparaît de la liste du serveur. Un serveur qui ne fait pas de RP n'a
// aucune raison de voir passer des numéros de service.

module.exports = {
  module: 'rp',
  grade: GRADES.EVERYONE, // contrôle fin par sous-commande

  data: new SlashCommandBuilder()
    .setName('matricule')
    .setDescription('Matricules RP : relie matricule, pseudo du jeu et compte Discord')
    .addSubcommand((s) =>
      s.setName('chercher')
        .setDescription('Retrouver quelqu\'un par matricule, pseudo du jeu ou pseudo Discord')
        .addStringOption((o) => o.setName('recherche')
          .setDescription('Matricule, pseudo Roblox, pseudo Discord, mention ou identifiant')
          .setRequired(true).setMaxLength(100)))
    .addSubcommand((s) =>
      s.setName('voir')
        .setDescription('Voir la fiche d\'un membre')
        .addUserOption((o) => o.setName('membre').setDescription('Membre (défaut : vous)').setRequired(false)))
    .addSubcommand((s) =>
      s.setName('liste').setDescription('Tous les matricules du serveur'))
    .addSubcommand((s) =>
      s.setName('attribuer')
        .setDescription('[Staff] Attribuer ou modifier un matricule')
        .addUserOption((o) => o.setName('membre').setDescription('À qui').setRequired(true))
        .addStringOption((o) => o.setName('pseudo_roblox').setDescription('Son pseudo dans le jeu').setRequired(true).setMaxLength(50))
        .addStringOption((o) => o.setName('matricule').setDescription('Laisser vide pour le prochain numéro libre').setRequired(false).setMaxLength(20))
        .addStringOption((o) => o.setName('note').setDescription('Grade, unité, remarque…').setRequired(false).setMaxLength(120)))
    .addSubcommand((s) =>
      s.setName('retirer')
        .setDescription('[Staff] Retirer le matricule d\'un membre')
        .addUserOption((o) => o.setName('membre').setDescription('À qui').setRequired(true)))
    .addSubcommand((s) =>
      s.setName('panneau')
        .setDescription('[Staff] Publier le panneau des matricules dans un salon')
        .addChannelOption((o) => o.setName('salon').setDescription('Salon du panneau').addChannelTypes(ChannelType.GuildText).setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cfg = getGuildConfig(interaction.guildId);
    const staff = getGrade(interaction.member, cfg) >= GRADES.STAFF;
    const T = themeDe(interaction.guildId);
    const refus = { content: '⛔ Réservé au **staff** du serveur.', flags: MessageFlags.Ephemeral };

    // ----- Retrouver quelqu'un -----
    if (sub === 'chercher') {
      const q = interaction.options.getString('recherche');
      const { trouve, proches, par } = MAT.retrouver(interaction.guildId, q);

      if (trouve) {
        return interaction.reply({ embeds: [ficheEmbed(trouve, T, par)], flags: MessageFlags.Ephemeral });
      }
      if (proches.length) {
        // Un « introuvable » sec ne laisse rien à faire. Proposer ce qui
        // ressemble transforme l'échec en piste.
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(COLORS.WARNING)
            .setTitle('🔎 Aucune correspondance exacte')
            .setDescription(M.description([
              M.bloc(`Proche de « ${q} »`, proches.map((f) => MAT.ligne(f)), { prefixe: '🔢', compte: proches.length, motCompte: 'fiche' }),
            ]))],
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.reply({
        content: `❌ Rien ne correspond à « **${q}** ».\n`
          + '➜ Essayez le **matricule**, le **pseudo du jeu**, une **mention** ou un **identifiant Discord**.\n'
          + '-# Si la personne n\'a pas encore de matricule, un staff peut lui en attribuer un : `/matricule attribuer`.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // ----- Fiche d'un membre -----
    if (sub === 'voir') {
      const cible = interaction.options.getUser('membre') || interaction.user;
      const f = MAT.ficheDe(interaction.guildId, cible.id);
      if (!f) {
        return interaction.reply({
          content: cible.id === interaction.user.id
            ? '❌ Vous n\'avez pas encore de matricule sur ce serveur.'
            : `❌ <@${cible.id}> n'a pas encore de matricule sur ce serveur.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.reply({ embeds: [ficheEmbed(f, T)], flags: MessageFlags.Ephemeral });
    }

    // ----- La liste -----
    if (sub === 'liste') {
      return interaction.reply({ ...MAT.contenuPanneau(interaction.guildId), flags: MessageFlags.Ephemeral });
    }

    // ----- Attribution -----
    if (sub === 'attribuer') {
      if (!staff) return interaction.reply(refus);
      const cible = interaction.options.getUser('membre');
      const r = MAT.attribuer(interaction.guildId, {
        userId: cible.id,
        matricule: interaction.options.getString('matricule'),
        robloxName: interaction.options.getString('pseudo_roblox'),
        discordTag: cible.tag || cible.username,
        note: interaction.options.getString('note'),
        byId: interaction.user.id,
      });
      if (r.erreur) return interaction.reply({ content: r.erreur, flags: MessageFlags.Ephemeral });

      await MAT.rafraichirPanneau(interaction.client, interaction.guildId);
      await sendLog(interaction.guild, logEmbed(
        '🔢 Matricule attribué',
        `<@${cible.id}> → \`${r.num}\`${r.misAJour && r.avant !== r.num ? ` *(était \`${r.avant}\`)*` : ''}\nPar <@${interaction.user.id}>`,
        COLORS.SUCCESS
      ));
      return interaction.reply({
        embeds: [ficheEmbed(MAT.ficheDe(interaction.guildId, cible.id), T)],
        content: r.misAJour ? `✅ Fiche mise à jour — matricule \`${r.num}\`.` : `✅ Matricule \`${r.num}\` attribué.`,
      });
    }

    // ----- Retrait -----
    if (sub === 'retirer') {
      if (!staff) return interaction.reply(refus);
      const cible = interaction.options.getUser('membre');
      const avant = MAT.ficheDe(interaction.guildId, cible.id);
      if (!MAT.retirer(interaction.guildId, cible.id, interaction.user.id)) {
        return interaction.reply({ content: `❌ <@${cible.id}> n'a pas de matricule à retirer.`, flags: MessageFlags.Ephemeral });
      }
      await MAT.rafraichirPanneau(interaction.client, interaction.guildId);
      await sendLog(interaction.guild, logEmbed(
        '🔢 Matricule retiré',
        `<@${cible.id}> — \`${avant?.matricule}\` retiré par <@${interaction.user.id}>.\n`
        + '-# La fiche est conservée : l\'historique dit qui portait ce numéro.',
        COLORS.WARNING
      ));
      return interaction.reply({ content: `🗑️ Matricule \`${avant?.matricule}\` retiré à <@${cible.id}>.` });
    }

    // ----- Panneau -----
    if (sub === 'panneau') {
      if (!staff) return interaction.reply(refus);
      const salon = interaction.options.getChannel('salon');
      const msg = await MAT.publierPanneau(salon, interaction.guildId).catch(() => null);
      if (!msg) {
        return interaction.reply({
          content: `❌ Publication impossible dans <#${salon.id}>. Vérifiez que je peux y écrire.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.reply({
        content: `✅ Panneau des matricules publié : ${msg.url}\n-# Il se met à jour tout seul à chaque attribution.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    return null;
  },

  // Boutons du panneau : pages et recherche.
  async handleComposant(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith('matrpage:')) {
      return MAT.handlePage(interaction);
    }
    if (interaction.isButton() && interaction.customId === 'matrsearch') {
      return interaction.showModal(
        new ModalBuilder().setCustomId('matrmodal').setTitle('🔎 Chercher un matricule').addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('q')
              .setLabel('Matricule, pseudo du jeu, @ ou identifiant')
              .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)
          )
        )
      );
    }
    // Soumission du modal : les résultats sont éphémères, ils ne concernent
    // que celui qui cherche.
    const q = interaction.fields.getTextInputValue('q');
    return interaction.reply({
      ...MAT.contenuPanneau(interaction.guildId, q, 0),
      flags: MessageFlags.Ephemeral,
    });
  },
};

// La fiche d'une personne : les trois entrées côte à côte, et l'identifiant
// en clair — c'est lui qu'on est venu chercher.
function ficheEmbed(f, T, par = null) {
  return new EmbedBuilder()
    .setColor(0x5b8def)
    .setTitle(`🔢 Matricule ${f.matricule}`)
    .setDescription(M.description([
      M.bloc('Identité', [
        `${T.compte.emoji} ${T.compte.label} : **${f.roblox_name || '*inconnu*'}**`,
        `💬 Discord : <@${f.user_id}>${f.discord_tag ? ` — ${f.discord_tag}` : ''}`,
        `🆔 Identifiant : \`${f.user_id}\``,
      ], { prefixe: T.carte.emoji, compte: null }),
      f.note ? M.bloc('Note', [f.note], { prefixe: '📄', compte: null }) : null,
    ].filter(Boolean)))
    .setFooter(par ? { text: `Trouvé par ${par}` } : null);
}
