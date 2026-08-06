const { getGuildConfig } = require('../database');

// 🎭 Rôles automatiques : attribués au membre pour qu'il ne reste pas
// « Visiteur » sans rien pouvoir faire.
//
// Deux moments possibles :
//   • pas de captcha  → dès l'arrivée sur le serveur ;
//   • captcha actif   → APRÈS sa validation (les donner avant reviendrait à
//     contourner la vérification, mais ne jamais les donner laisserait le
//     membre bloqué : c'était le défaut de la première version).

function rolesConfigures(cfg) {
  try {
    const liste = JSON.parse(cfg.autorole_role_ids || '[]');
    return Array.isArray(liste) ? liste.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// Ne garde que les rôles que le bot peut RÉELLEMENT donner, et explique
// pourquoi il écarte les autres — sans quoi l'échec resterait invisible.
function trier(member, ids) {
  const moi = member.guild.members.me;
  const plafond = moi?.roles?.highest?.position ?? 0;
  const donnables = [];
  const refuses = [];
  for (const id of ids) {
    const role = member.guild.roles.cache.get(id);
    if (!role) { refuses.push({ id, motif: 'rôle introuvable (supprimé ?)' }); continue; }
    if (role.managed) { refuses.push({ id, motif: `« ${role.name} » est géré par une intégration` }); continue; }
    if (role.position >= plafond) {
      refuses.push({ id, motif: `« ${role.name} » est au-dessus du rôle du bot dans la hiérarchie` });
      continue;
    }
    if (member.roles.cache.has(id)) continue;   // déjà présent : rien à faire
    donnables.push(id);
  }
  return { donnables, refuses };
}

// Applique les rôles automatiques. Renvoie ce qui a été fait, pour les logs.
async function appliquer(member, raison = 'Rôle automatique') {
  if (!member?.guild || member.user?.bot) return { donnes: [], refuses: [] };
  const cfg = getGuildConfig(member.guild.id);
  const ids = rolesConfigures(cfg);
  if (!ids.length) return { donnes: [], refuses: [] };

  const moi = member.guild.members.me;
  if (!moi?.permissions?.has?.('ManageRoles')) {
    console.warn(`⚠️ Rôles automatiques : le bot n'a pas la permission « Gérer les rôles » sur ${member.guild.name}.`);
    return { donnes: [], refuses: ids.map((id) => ({ id, motif: 'permission « Gérer les rôles » manquante' })) };
  }

  const { donnables, refuses } = trier(member, ids);
  for (const r of refuses) {
    console.warn(`⚠️ Rôle automatique ignoré sur ${member.guild.name} : ${r.motif}.`);
  }
  if (!donnables.length) return { donnes: [], refuses };
  try {
    await member.roles.add(donnables, raison);
    return { donnes: donnables, refuses };
  } catch (err) {
    console.warn(`⚠️ Rôles automatiques non attribués sur ${member.guild.name} : ${err.message}`);
    return { donnes: [], refuses: donnables.map((id) => ({ id, motif: err.message })) };
  }
}

// Le captcha est-il en travers du chemin ? (sert à choisir le bon moment)
function captchaActif(guildId) {
  const cfg = getGuildConfig(guildId);
  return Boolean(cfg.captcha_enabled && cfg.verified_role_id);
}

module.exports = { appliquer, rolesConfigures, captchaActif };
