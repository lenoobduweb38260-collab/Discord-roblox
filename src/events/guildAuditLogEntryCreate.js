const { Events, AuditLogEvent } = require('discord.js');
const { getGuildConfig } = require('../database');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { isImmune } = require('../utils/botTeam');

// Anti-nuke : détecte les actions destructives massives (suppressions de
// salons/rôles, bans/kicks en rafale, créations de webhooks) par un même
// auteur. Au-delà du seuil, l'auteur est mis en quarantaine (rôles retirés +
// mute 24 h). Activé par serveur via antinuke_enabled. Le propriétaire du
// serveur et les IDs immunisés sont exemptés.

const DESTRUCTIVE = new Set([
  AuditLogEvent.ChannelDelete,
  AuditLogEvent.RoleDelete,
  AuditLogEvent.MemberBanAdd,
  AuditLogEvent.MemberKick,
  AuditLogEvent.WebhookCreate,
  AuditLogEvent.ChannelCreate,
]);

const counters = new Map(); // "guild:user" -> [timestamps]
const WINDOW = 10000;
const MAX = 4; // > 4 actions destructives en 10 s = nuke

module.exports = {
  name: Events.GuildAuditLogEntryCreate,
  async execute(entry, guild) {
    try {
      const cfg = getGuildConfig(guild.id);
      if (!cfg.antinuke_enabled) return;
      if (!DESTRUCTIVE.has(entry.action)) return;

      const uid = entry.executorId;
      if (!uid || uid === guild.client.user.id || uid === guild.ownerId) return;
      if (await isImmune(guild.client, uid)) return;

      const key = `${guild.id}:${uid}`;
      const now = Date.now();
      const arr = (counters.get(key) || []).filter((t) => now - t < WINDOW);
      arr.push(now);
      counters.set(key, arr);
      if (arr.length < MAX) return;
      counters.set(key, []);

      const member = await guild.members.fetch(uid).catch(() => null);
      if (member) {
        await member.roles.set([], 'Anti-nuke : actions destructives massives').catch(() => null);
        await member.timeout(24 * 60 * 60 * 1000, 'Anti-nuke').catch(() => null);
      }
      await sendLog(
        guild,
        logEmbed(
          '🚨 Anti-nuke déclenché',
          `<@${uid}> (\`${uid}\`) a effectué **${MAX}+ actions destructives** en quelques secondes → ` +
            'rôles retirés et mute 24 h. Vérifiez et sanctionnez si besoin.',
          COLORS.DANGER
        )
      );
    } catch (err) {
      console.warn(`⚠️ Anti-nuke : ${err.message}`);
    }
  },
};
