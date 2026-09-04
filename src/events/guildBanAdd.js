const { Events } = require('discord.js');
const { createTicket } = require('../utils/botTickets');
const { getBlacklistRow } = require('../utils/botTeam');

// Chaque bannissement sur un serveur du bot remonte en ticket dans le salon
// QG de l'équipe (boutons Claim / Invitation / Passer / Traiter). Les bans
// posés par le bot lui-même pour appliquer la blacklist ne créent pas de
// ticket (l'utilisateur est déjà traité).

module.exports = {
  name: Events.GuildBanAdd,
  async execute(ban) {
    try {
      if (getBlacklistRow.get(ban.user.id)) return;
      const full = ban.partial ? await ban.fetch().catch(() => ban) : ban;
      await createTicket(ban.client, {
        kind: 'ban',
        guild: ban.guild,
        targetId: ban.user.id,
        targetTag: ban.user.tag,
        reporterId: null,
        reason: full.reason || null,
      });
    } catch (err) {
      console.warn(`⚠️ Ticket QG du ban impossible : ${err.message}`);
    }
  },
};
