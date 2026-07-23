const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { GRADES } = require('./permissions');
const { COLORS, sendLog, logEmbed } = require('./embeds');
const { getGuildConfig } = require('../database');
const rp = require('./rpList');

// Whitelist RP : attribue (ou retire) le rôle configuré (wlrp_role_id) au
// membre. Renvoie un petit texte à ajouter à la réponse. Sans rôle configuré
// ou en cas d'échec (hiérarchie), on n'échoue pas la commande.
async function applyWhitelistRole(interaction, kind, userId, add) {
  if (kind !== 'wlrp') return '';
  const roleId = getGuildConfig(interaction.guildId).wlrp_role_id;
  if (!roleId) return '';
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!member) return '';
  try {
    if (add) await member.roles.add(roleId, `Whitelist RP par ${interaction.user.tag}`);
    else await member.roles.remove(roleId, `Retrait Whitelist RP par ${interaction.user.tag}`);
    return `\n🎭 Rôle <@&${roleId}> ${add ? 'attribué' : 'retiré'}.`;
  } catch {
    return `\n⚠️ Rôle <@&${roleId}> non ${add ? 'attribué' : 'retiré'} (vérifiez la hiérarchie et la permission **Gérer les rôles** du bot).`;
  }
}

// Fabrique la commande d'une liste RP (Blacklist RP ou Whitelist RP) : même
// structure, seul le « kind » et les libellés changent.
function makeRpListCommand({ kind, name, label, verb }) {
  return {
    module: 'rp',
    grade: GRADES.STAFF,
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(`[Staff] ${label} RP : panneau auto-trié + recherche + casier`)
      .addSubcommand((sub) =>
        sub
          .setName('ajouter')
          .setDescription(`${verb} un joueur`)
          .addUserOption((o) => o.setName('utilisateur').setDescription('Membre Discord').setRequired(true))
          .addStringOption((o) => o.setName('roblox').setDescription('Pseudo Roblox').setRequired(true))
          .addStringOption((o) => o.setName('raison').setDescription('Raison (facultatif)').setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName('retirer')
          .setDescription(`Retirer un joueur (conservé au casier)`)
          .addUserOption((o) => o.setName('utilisateur').setDescription('Membre à retirer').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName('panneau')
          .setDescription('Publier le panneau auto-mis-à-jour dans un salon')
          .addChannelOption((o) =>
            o.setName('salon').setDescription('Salon du panneau (défaut : ici)').addChannelTypes(ChannelType.GuildText).setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('rechercher')
          .setDescription('Rechercher dans la liste')
          .addStringOption((o) => o.setName('texte').setDescription('Pseudo, @, ID ou raison').setRequired(true))
      ),

    async execute(interaction) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'rechercher') {
        const q = interaction.options.getString('texte');
        return interaction.reply({ embeds: [rp.renderEmbed(kind, interaction.guildId, q)], flags: MessageFlags.Ephemeral });
      }

      if (sub === 'panneau') {
        const channel = interaction.options.getChannel('salon') || interaction.channel;
        await rp.postBoard(kind, channel, interaction.guildId);
        return interaction.reply({ content: `✅ Panneau **${label} RP** publié dans ${channel} (mis à jour automatiquement).`, flags: MessageFlags.Ephemeral });
      }

      const user = interaction.options.getUser('utilisateur');

      if (sub === 'ajouter') {
        if (rp.activeOf(kind, interaction.guildId, user.id)) {
          return interaction.reply({ content: `⚠️ <@${user.id}> est déjà dans la ${label} RP.`, flags: MessageFlags.Ephemeral });
        }
        const roblox = interaction.options.getString('roblox').trim().slice(0, 60);
        const raison = interaction.options.getString('raison')?.slice(0, 300) || null;
        rp.add(kind, interaction.guildId, { userId: user.id, robloxName: roblox, discordTag: user.tag, reason: raison, byId: interaction.user.id });
        await rp.refreshBoard(interaction.client, kind, interaction.guildId);
        const roleNote = await applyWhitelistRole(interaction, kind, user.id, true);
        await interaction.reply({ content: `✅ **${roblox}** (<@${user.id}>) ajouté à la **${label} RP**.${raison ? `\n**Raison :** ${raison}` : ''}${roleNote}` });
        await sendLog(
          interaction.guild,
          logEmbed(`${label} RP — ajout`, `🎮 **${roblox}** · <@${user.id}> ajouté par <@${interaction.user.id}>.${raison ? `\n**Raison :** ${raison}` : ''}`, COLORS.INFO)
        );
        return;
      }

      // retirer
      if (!rp.remove(kind, interaction.guildId, user.id, interaction.user.id)) {
        return interaction.reply({ content: `❌ <@${user.id}> n'est pas dans la ${label} RP active.`, flags: MessageFlags.Ephemeral });
      }
      await rp.refreshBoard(interaction.client, kind, interaction.guildId);
      const roleNote = await applyWhitelistRole(interaction, kind, user.id, false);
      await interaction.reply({ content: `🧹 <@${user.id}> retiré de la **${label} RP** (conservé au casier \`/casier\`).${roleNote}` });
      await sendLog(
        interaction.guild,
        logEmbed(`${label} RP — retrait`, `<@${user.id}> retiré par <@${interaction.user.id}> (gardé au casier).`, COLORS.INFO)
      );
    },
  };
}

module.exports = { makeRpListCommand };
