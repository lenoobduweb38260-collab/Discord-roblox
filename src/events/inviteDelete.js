const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

module.exports = {
  name: Events.InviteDelete,
  async execute(invite) {
    if (!invite.guild) return;
    // 📨 Le traqueur d'invitations oublie ce code — sa disparition à venir ne
    // doit pas passer pour une invitation « consommée ».
    require('../utils/invitations').invitationSupprimee(invite);
    await sendLog(
      invite.guild,
      logEmbed('✉️ Invitation supprimée', `➜ Code : \`${invite.code}\`\n➜ Salon : <#${invite.channelId}>`, COLORS.WARNING)
    );
  },
};
