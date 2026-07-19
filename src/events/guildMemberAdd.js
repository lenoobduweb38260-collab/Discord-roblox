const { Events } = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

const getGlobalBan = db.prepare('SELECT * FROM global_bans WHERE user_id = ?');
const isWhitelisted = db.prepare('SELECT 1 FROM whitelist WHERE guild_id = ? AND user_id = ?');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    // 1) Ban global : appliqué automatiquement dès l'arrivée sur n'importe quel serveur.
    const gban = getGlobalBan.get(member.id);
    if (gban) {
      await member.ban({ reason: `Ban global : ${gban.reason || 'Aucune raison'}` }).catch(() => null);
      await sendLog(
        member.guild,
        logEmbed(
          '🔨 Ban global appliqué',
          `<@${member.id}> (\`${member.id}\`) a été banni automatiquement à son arrivée.\n**Raison :** ${gban.reason || 'Aucune'}`,
          COLORS.DANGER
        )
      );
      return;
    }

    // 2) Whitelist : si activée, tout membre non whitelisté est expulsé.
    const cfg = getGuildConfig(member.guild.id);
    if (cfg.whitelist_enabled && !isWhitelisted.get(member.guild.id, member.id)) {
      await member
        .send(
          `⛔ Le serveur **${member.guild.name}** est en mode whitelist. ` +
            `Contactez le staff pour être ajouté à la liste blanche avant de rejoindre.`
        )
        .catch(() => null);
      await member.kick('Whitelist activée : membre non whitelisté').catch(() => null);
      await sendLog(
        member.guild,
        logEmbed(
          '🚪 Whitelist : membre expulsé',
          `<@${member.id}> (\`${member.id}\`) a été expulsé (non whitelisté).`,
          COLORS.WARNING
        )
      );
    }
  },
};
