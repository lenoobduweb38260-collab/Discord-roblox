const { Events } = require('discord.js');
const { db } = require('../database');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');

const getGlobalBan = db.prepare('SELECT * FROM global_bans WHERE user_id = ?');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    // Ban global : appliqué automatiquement dès l'arrivée sur n'importe quel serveur.
    const gban = getGlobalBan.get(member.id);
    if (!gban) return;
    await member.ban({ reason: `Ban global : ${gban.reason || 'Aucune raison'}` }).catch(() => null);
    await sendLog(
      member.guild,
      logEmbed(
        '🔨 Ban global appliqué',
        `<@${member.id}> (\`${member.id}\`) a été banni automatiquement à son arrivée.\n**Raison :** ${gban.reason || 'Aucune'}`,
        COLORS.DANGER
      )
    );
  },
};
