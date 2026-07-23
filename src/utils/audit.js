// Retrouve l'auteur d'une action via le journal d'audit (best-effort : nécessite
// la permission « Voir le journal d'audit » ; renvoie null sinon).
async function auditExecutor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 6 });
    const entry = logs.entries.find((e) => (e.target?.id || e.targetId) === targetId);
    return entry?.executor ? `<@${entry.executor.id}>` : null;
  } catch {
    return null;
  }
}

module.exports = { auditExecutor };
