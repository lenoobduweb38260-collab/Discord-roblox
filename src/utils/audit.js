const { etiquetteMembre } = require('./journal');

// Retrouve l'auteur d'une action via le journal d'audit (best-effort : nécessite
// la permission « Voir le journal d'audit » ; renvoie null sinon).
// Le nom est écrit en clair à côté de la mention : une mention seule s'affiche
// « @utilisateur-inconnu » dès que le client du lecteur ne connaît pas ce membre.
async function auditExecutor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 6 });
    const entry = logs.entries.find((e) => (e.target?.id || e.targetId) === targetId);
    return entry?.executor ? etiquetteMembre(entry.executor) : null;
  } catch {
    return null;
  }
}

module.exports = { auditExecutor };
