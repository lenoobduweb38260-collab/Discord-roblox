const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { auditExecutor } = require('../utils/audit');
const { diffSalon, etiquetteSalon, fiche } = require('../utils/journal');

// Le moindre réglage d'un salon : nom, sujet, mode lent, catégorie, NSFW,
// qualité audio, limite, région — et chaque surcharge de permissions.
// (La position est volontairement ignorée : déplacer un salon décale tous
// ceux d'en dessous, un seul geste ferait vingt logs.)
module.exports = {
  name: Events.ChannelUpdate,
  async execute(oldChannel, newChannel) {
    if (!newChannel.guild) return;
    const changes = diffSalon(oldChannel, newChannel);
    if (!changes.length) return;
    const by = await auditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
    await sendLog(
      newChannel.guild,
      logEmbed(
        '✏️ Salon modifié',
        fiche({ sujet: etiquetteSalon(newChannel.id, newChannel), sections: [{ titre: 'Modifications', entrees: changes }], par: by }),
        COLORS.INFO
      )
    );
  },
};
