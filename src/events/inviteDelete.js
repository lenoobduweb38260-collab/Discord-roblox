const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

module.exports = {
  name: Events.InviteDelete,
  async execute(invite) {
    if (!invite.guild) return;
    await sendLog(
      invite.guild,
      logEmbed('✉️ Invitation supprimée', `➜ Code : \`${invite.code}\`\n➜ Salon : <#${invite.channelId}>`, COLORS.WARNING)
    );
  },
};
