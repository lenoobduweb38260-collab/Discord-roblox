const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  ApplicationIntegrationType,
} = require('discord.js');
const { GRADES } = require('../utils/permissions');

// /invite : tout le monde peut inviter le bot sur son propre serveur (ou
// l'installer sur son compte). Fonctionne partout : serveurs, MP, app perso.

module.exports = {
  grade: GRADES.EVERYONE,
  allowDm: true,
  userInstall: true, // enregistrement global : disponible partout
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Inviter le bot sur votre serveur Discord')
    .setDescriptionLocalizations({
      'en-US': 'Invite the bot to your Discord server',
      'en-GB': 'Invite the bot to your Discord server',
    })
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),
  async execute(interaction) {
    const clientId = interaction.client.user.id;
    const serverUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot+applications.commands&permissions=8`;
    const userUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&integration_type=1&scope=applications.commands`;
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🔗 Inviter ${interaction.client.user.username}`)
      .setThumbnail(interaction.client.user.displayAvatarURL({ size: 128 }))
      .setDescription(
        '• **Sur un serveur** : ajoutez le bot avec toutes ses fonctionnalités (RP, tickets, modération…)\n' +
          '• **Sur votre compte** : utilisez `/interact`, `/info` et `/invite` partout, même sans le bot sur le serveur'
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('➕ Ajouter à un serveur').setStyle(ButtonStyle.Link).setURL(serverUrl),
      new ButtonBuilder().setLabel('👤 Installer sur mon compte').setStyle(ButtonStyle.Link).setURL(userUrl)
    );
    await interaction.reply({ embeds: [embed], components: [row] });
  },
};
