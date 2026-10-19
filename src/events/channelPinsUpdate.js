const { Events } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { getGuildConfig } = require('../database');

module.exports = {
  name: Events.ChannelPinsUpdate,
  async execute(channel) {
    if (!channel.guild) return;
    // 🔇 Épingler dans le salon de logs ferait boucler le journal sur lui-même.
    const cfg = getGuildConfig(channel.guild.id);
    if (cfg.log_channel_id && String(channel.id) === String(cfg.log_channel_id)) return;
    await sendLog(
      channel.guild,
      logEmbed('📌 Épingles modifiées', `Un message a été épinglé ou désépinglé dans <#${channel.id}>.`, COLORS.INFO)
    );
  },
};
