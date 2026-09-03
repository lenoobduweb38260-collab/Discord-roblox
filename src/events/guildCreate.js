const { Events, ChannelType, PermissionFlagsBits } = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../database');

// À l'arrivée sur un serveur, le bot crée automatiquement son salon de logs de
// sécurité « <nom-du-bot>-logs » (visible du staff/admin uniquement) et le
// configure comme salon des logs. Rien n'est fait si un salon de logs est déjà
// configuré ou si un salon du même nom existe déjà.

function channelSlug(name) {
  const slug = String(name || 'bot')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'bot';
}

module.exports = {
  name: Events.GuildCreate,
  async execute(guild) {
    // 📨 Photo de départ des invitations de ce nouveau serveur, pour que le
    // traqueur sache dire « qui a invité qui » dès la première arrivée.
    require('../utils/invitations').primer(guild).catch(() => null);
    // 🌍 D'abord la carte de choix de langue — chaque ligne parle SA langue,
    // pour que l'administrateur comprenne quel que soit son français.
    try {
      await require('../utils/choixLangue').envoyer(guild);
    } catch (err) {
      console.warn(`⚠️ Carte de choix de langue non envoyée : ${err.message}`);
    }
    try {
      const cfg = getGuildConfig(guild.id);
      if (cfg.log_channel_id && guild.channels.cache.get(cfg.log_channel_id)) return;

      const chanName = `${channelSlug(guild.client.user.username)}-logs`;
      const existing = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildText && c.name === chanName
      );
      if (existing) {
        setGuildConfig(guild.id, 'log_channel_id', existing.id);
        return;
      }

      const me = guild.members.me;
      if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) return;

      const channel = await guild.channels.create({
        name: chanName,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: me.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AttachFiles,
            ],
          },
        ],
        reason: 'Salon des logs de sécurité du bot (créé automatiquement à l\'arrivée)',
      });
      setGuildConfig(guild.id, 'log_channel_id', channel.id);
      await channel
        .send(
          `✅ Salon de logs **#${chanName}** créé automatiquement.\n` +
            'Les actions du staff, les messages supprimés/modifiés, le vocal et les transcripts de tickets ' +
            'y seront journalisés. Vous pouvez le changer à tout moment via `/config` ou le dashboard.'
        )
        .catch(() => null);
    } catch (err) {
      console.warn(`⚠️ Création du salon de logs à l'arrivée impossible : ${err.message}`);
    }
  },
};
