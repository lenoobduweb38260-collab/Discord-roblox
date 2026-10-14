// 🤖 Le statut du bot — UNE seule vérité.
//
// Le statut vit à trois moments : au démarrage, quand le créateur le change,
// et quand la musique s'arrête (elle affiche « Écoute … » pendant la
// lecture). Deux copies de la même logique (index.js et managedApi.js)
// avaient déjà commencé à diverger : celle-ci est la référence — elle
// applique le statut CONFIGURÉ par le créateur s'il existe, sinon le statut
// par défaut du bot.
function appliquer(client) {
  try {
    if (typeof client?.user?.setPresence !== 'function') return;
    const { ActivityType, PresenceUpdateStatus } = require('discord.js');
    if (!ActivityType) return;
    let cfg = null;
    try { cfg = JSON.parse(require('./botTeam').state('bot_status') || 'null'); } catch { cfg = null; }
    if (!cfg?.text) {
      client.user.setPresence({
        activities: [{ name: 'le serveur RP 🎭', type: ActivityType.Watching }],
        status: PresenceUpdateStatus.Online,
      });
      return;
    }
    const typeMap = { playing: ActivityType.Playing, watching: ActivityType.Watching, listening: ActivityType.Listening, competing: ActivityType.Competing, custom: ActivityType.Custom };
    const presenceMap = { online: PresenceUpdateStatus.Online, idle: PresenceUpdateStatus.Idle, dnd: PresenceUpdateStatus.DoNotDisturb, invisible: PresenceUpdateStatus.Invisible };
    const activity = { name: String(cfg.text).slice(0, 128), type: typeMap[cfg.type] ?? ActivityType.Custom };
    if (activity.type === ActivityType.Custom) activity.state = activity.name;
    if (cfg.type === 'streaming' && /^https?:\/\/(www\.)?twitch\.tv\//i.test(cfg.url || '')) {
      activity.type = ActivityType.Streaming;
      activity.url = cfg.url;
    }
    client.user.setPresence({ activities: [activity], status: presenceMap[cfg.presence] || PresenceUpdateStatus.Online });
  } catch (err) {
    console.warn(`⚠️ Statut du bot non appliqué : ${err.message}`);
  }
}

module.exports = { appliquer };
