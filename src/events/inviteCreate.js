const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

module.exports = {
  name: Events.InviteCreate,
  async execute(invite) {
    if (!invite.guild) return;
    const details = [
      `➜ Code : \`${invite.code}\``,
      `➜ Salon : <#${invite.channelId}>`,
    ];
    if (invite.inviterId) details.push(`➜ Créée par : <@${invite.inviterId}>`);
    details.push(`➜ Utilisations max : ${invite.maxUses ? `**${invite.maxUses}**` : 'illimitées'}`);
    details.push(invite.expiresTimestamp ? `➜ Expire <t:${Math.floor(invite.expiresTimestamp / 1000)}:R>` : '➜ N\'expire jamais');
    await sendLog(
      invite.guild,
      logEmbed('✉️ Invitation créée', details.join('\n'), COLORS.SUCCESS)
    );
  },
};
