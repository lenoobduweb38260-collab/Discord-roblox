// 🔗 Aventure SAO — ce qui relie le jeu au reste du bot.
//
//   ➜ l'XP du SERVEUR, uniquement par le contrat C de levels.js
//     (`gagnerXpServeur(guild, userId, 'sao', montant)`) : c'est lui qui
//     applique `xp_sao_pourcent`, annonce et distribue les rôles. Tant qu'il
//     n'existe pas, le repli prévu au cahier (addXp + annonce) prend le relais ;
//   ➜ le mariage (`commands/mariage`) : le Lien du cœur et le coffre commun.
//
// Les deux sont requis paresseusement : levels.js appelle saoGame pour ses
// récompenses de niveau, un require au chargement tournerait en rond.

const { getGuildConfig } = require('../../database');

// Ne lève jamais. Renvoie le résultat d'addXp, `gagne` = XP réellement ajoutée
// (0 si les niveaux sont coupés : on n'affiche alors aucune XP serveur).
async function xpServeurSao(guild, userId, montant, contexte = {}) {
  const n = Math.max(0, Math.round(Number(montant) || 0));
  if (!guild?.id || !n) return { gagne: 0 };
  try {
    const L = require('../levels');
    if (typeof L.gagnerXpServeur === 'function') {
      const r = await L.gagnerXpServeur(guild, userId, 'sao', n, contexte);
      return r && typeof r === 'object' ? r : { gagne: 0 };
    }
    // Repli du cahier, tant que le contrat C n'est pas livré.
    const r = L.addXp(guild.id, userId, 'sao', n) || {};
    const gagne = Number.isFinite(r.gagne) ? r.gagne : getGuildConfig(guild.id).levels_enabled !== 0 ? n : 0;
    if (r.leveledUp) await L.announceLevelUp(guild, userId, 'sao', r.newLevel, contexte.salon || null, r.oldLevel);
    return { ...r, gagne };
  } catch {
    return { gagne: 0 };
  }
}

// La réponse n'attend pas l'annonce de niveau (rôles à poser, salon à
// écrire) : on laisse 1,2 s au gain, puis on répond quoi qu'il arrive — le
// gain continue en arrière-plan. null = pas encore connu (rien d'affiché).
async function xpServeurRapide(guild, userId, montant, contexte = {}, delai = 1200) {
  const promesse = xpServeurSao(guild, userId, montant, contexte);
  let minuteur;
  const attente = new Promise((r) => { minuteur = setTimeout(() => r(null), delai); });
  const r = await Promise.race([promesse, attente]);
  clearTimeout(minuteur);
  return r;
}

// Le conjoint de ce membre, s'il en a un (le mariage est global).
// `aventurier` : le conjoint a un personnage SUR CE SERVEUR — condition du
// Lien du cœur et du coffre commun, puisque les personnages sont par serveur.
function conjointSao(guildId, userId) {
  let m = null;
  try {
    m = require('../../commands/mariage').mariageDe(userId);
  } catch {
    return null;
  }
  if (!m?.conjoint) return null;
  const G = require('../saoGame');
  return {
    conjoint: String(m.conjoint),
    depuis: m.depuis || null,
    aventurier: Boolean(G.getPlayer(guildId, m.conjoint)),
    couple: G.cleCouple(userId, m.conjoint),
  };
}

// Lien du cœur : +10 % ATK et +10 % d'XP d'aventure.
function lienDuCoeur(guildId, userId) {
  const c = conjointSao(guildId, userId);
  return Boolean(c?.aventurier);
}

module.exports = { xpServeurSao, xpServeurRapide, conjointSao, lienDuCoeur };
