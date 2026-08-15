const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const {
  isCreator,
  hasPerm,
  getBlacklistRow,
  listBlacklistRows,
  applyBlacklist,
  removeBlacklist,
  state,
  setState,
} = require('../utils/botTeam');

// /blacklist : blacklist GLOBALE du bot, gérée par son équipe. Un blacklisté
// reçoit un MP (raison + serveur de déban) et est banni de tous les serveurs
// du bot ; à chaque nouvelle arrivée il est re-banni automatiquement tant que
// la blacklist n'est pas levée.

module.exports = {
  grade: GRADES.EVERYONE, // contrôle interne : permission 🚫 Blacklist de l'équipe du bot
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('[Équipe du bot] Blacklist globale du bot')
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('Blacklister un utilisateur (MP + ban sur tous les serveurs du bot)')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Utilisateur à blacklister').setRequired(true))
        .addStringOption((o) => o.setName('raison').setDescription('Raison (envoyée en MP)').setRequired(true).setMaxLength(500))
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Lever la blacklist d\'un utilisateur (débanni partout)')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Utilisateur à retirer').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir la blacklist du bot'))
    .addSubcommand((sub) =>
      sub
        .setName('serveur-deban')
        .setDescription('[Créateur] Définir l\'invitation du serveur de déban (envoyée dans le MP)')
        .addStringOption((o) =>
          o.setName('invitation').setDescription('Lien d\'invitation permanent du serveur de déban').setRequired(true).setMaxLength(100)
        )
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // On accuse TOUJOURS réception immédiatement : blacklister envoie un MP puis
    // bannit sur chaque serveur (plusieurs secondes) — sans defer, Discord
    // affiche « l'application ne répond pas » au bout de 3 s.
    await interaction.deferReply().catch(() => {});
    const publicReply = (content) => interaction.editReply(content).catch(() => {});
    const privateReply = async (content) => {
      await interaction.deleteReply().catch(() => {});
      return interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    };

    if (sub === 'serveur-deban') {
      if (!(await isCreator(interaction.client, interaction.user.id))) {
        return privateReply('⛔ Sécurité : seul le **créateur du bot** peut définir le serveur de déban.');
      }
      const invitation = interaction.options.getString('invitation').trim();
      if (!/^https?:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\//i.test(invitation)) {
        return privateReply('❌ Lien invalide : attendu un lien discord.gg ou discord.com/invite.');
      }
      setState('deban_invite', invitation);
      return publicReply(`🔓 Serveur de déban enregistré : ${invitation}\nIl sera joint au MP de chaque utilisateur blacklisté.`);
    }

    if (sub === 'liste') {
      const rows = listBlacklistRows.all();
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle(`🚫 Blacklist du bot (${rows.length})`)
        .setDescription(
          rows.length
            ? rows
                .slice(0, 30)
                .map((r) => `➜ <@${r.user_id}> (\`${r.user_id}\`) — ${r.reason || '*aucune raison*'} — par <@${r.by_id}>`)
                .join('\n') + (rows.length > 30 ? `\n… et ${rows.length - 30} autre(s)` : '')
            : '*Personne n\'est blacklisté.*'
        )
        .setFooter({ text: state('deban_invite') ? 'Serveur de déban configuré ✅' : 'Serveur de déban non configuré — /blacklist serveur-deban' });
      return publicReply({ embeds: [embed] });
    }

    // ajouter / retirer : permission 🚫 Blacklist requise.
    if (!(await hasPerm(interaction.client, interaction.user.id, 'blacklist'))) {
      return privateReply('⛔ Sécurité : réservé au **staff du bot** disposant de la permission 🚫 Blacklist.');
    }

    const target = interaction.options.getUser('utilisateur');

    if (sub === 'ajouter') {
      if (target.id === interaction.user.id) {
        return privateReply('❌ Vous ne pouvez pas vous blacklister vous-même.');
      }
      if (await isCreator(interaction.client, target.id)) {
        return privateReply('⛔ Le créateur du bot ne peut pas être blacklisté.');
      }
      const reason = interaction.options.getString('raison');
      const result = await applyBlacklist(interaction.client, target.id, reason, interaction.user.id);
      if (result.immune) {
        return privateReply('⛔ Cet utilisateur est **immunisé** : il ne peut pas être blacklisté.');
      }
      return publicReply(
        `🚫 **${result.tag}** blacklisté.\n` +
          `➜ MP ${result.dmOk ? 'envoyé ✅' : 'impossible (MP fermés) ⚠️'}${state('deban_invite') ? ' (avec le serveur de déban)' : ' — ⚠️ aucun serveur de déban configuré'}\n` +
          `➜ Banni sur **${result.banned}** serveur(s) — il sera re-banni automatiquement à chaque arrivée.`
      );
    }

    if (sub === 'retirer') {
      if (!getBlacklistRow.get(target.id)) {
        return privateReply(`❌ <@${target.id}> n'est pas blacklisté.`);
      }
      const result = await removeBlacklist(interaction.client, target.id, interaction.user.id);
      return publicReply(`🔓 Blacklist de <@${target.id}> levée — débanni sur **${result.unbanned}** serveur(s).`);
    }
  },
};
