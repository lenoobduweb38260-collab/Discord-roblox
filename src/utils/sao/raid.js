// 🐲 Aventure SAO — les raids : un boss commun à tout le serveur.
//
// Il apparaît de lui-même dans le salon réglé (`sao_salon_id`), toutes les
// `sao_raid_heures` heures. Ses PV sont partagés : chacun frappe par le
// bouton `sao:rd:<id>`, avec un délai personnel de 90 s. Quand il tombe,
// chaque participant est payé au prorata de ses dégâts, et le dernier coup
// emporte le Last Attack Bonus. Tout vit en base (sao_raids, sao_raid_coups) :
// un redémarrage n'efface ni le boss ni les coups portés.
//
// Tâche périodique : `demarrerRaids(client)`, appelée depuis events/ready.js,
// passe toutes les 5 minutes — fait apparaître les raids dus et clôt ceux
// qui ont expiré (en réécrivant leur carte).

const { db } = require('../../database');
const G = require('../saoGame');
const D = require('./donnees');
const F = require('./formules');

const DELAI_COUP_MS = 90 * 1000;
const PERIODE_MS = 5 * 60 * 1000;
const ACTIFS_JOURS = 7;

const raidActifStmt = db.prepare("SELECT * FROM sao_raids WHERE guild_id = ? AND statut = 'actif' ORDER BY id DESC LIMIT 1");
const raidParIdStmt = db.prepare('SELECT * FROM sao_raids WHERE id = ?');
const dernierRaidStmt = db.prepare('SELECT * FROM sao_raids WHERE guild_id = ? ORDER BY id DESC LIMIT 1');
const raidAddStmt = db.prepare("INSERT INTO sao_raids (guild_id, salon_id, boss, etage, pv_max, pv, statut, cree_le, expire_le) VALUES (?, ?, ?, ?, ?, ?, 'actif', ?, ?)");
const raidPvStmt = db.prepare('UPDATE sao_raids SET pv = ? WHERE id = ?');
// Ne clôt qu'un raid ENCORE actif : `.changes` dit qui l'a clos, et lui seul
// paie (partage ou consolation). Deux clôtures ne paient jamais deux fois.
const raidFinStmt = db.prepare("UPDATE sao_raids SET statut = ?, fini_le = ?, dernier_coup = ? WHERE id = ? AND statut = 'actif'");
const raidMessageStmt = db.prepare('UPDATE sao_raids SET message_id = ?, salon_id = ? WHERE id = ?');
const raidsExpiresStmt = db.prepare("SELECT * FROM sao_raids WHERE statut = 'actif' AND expire_le < ?");
const coupsStmt = db.prepare('SELECT * FROM sao_raid_coups WHERE raid_id = ? ORDER BY degats DESC, user_id');
const coupStmt = db.prepare('SELECT * FROM sao_raid_coups WHERE raid_id = ? AND user_id = ?');
const coupAddStmt = db.prepare(`
  INSERT INTO sao_raid_coups (raid_id, user_id, degats, coups, dernier_le) VALUES (?, ?, ?, 1, ?)
  ON CONFLICT (raid_id, user_id) DO UPDATE SET degats = degats + excluded.degats, coups = coups + 1, dernier_le = excluded.dernier_le
`);
const actifsStmt = db.prepare('SELECT floor, last_hunt FROM sao_players WHERE guild_id = ?');

function raidActif(guildId) {
  return raidActifStmt.get(String(guildId)) || null;
}
function raidParId(id) {
  return raidParIdStmt.get(Number(id)) || null;
}
function coupsRaid(raidId) {
  return coupsStmt.all(Number(raidId));
}

// Les aventuriers actifs (une chasse dans les 7 derniers jours).
function aventuriersActifs(guildId, now) {
  const seuil = now - ACTIFS_JOURS * 86400000;
  return actifsStmt.all(String(guildId)).filter((r) => (Date.parse(r.last_hunt) || 0) >= seuil);
}

// Faut-il faire apparaître un raid maintenant ?
function raidDu(guildId, now = Date.now()) {
  const R = G.reglagesSao(guildId);
  if (!R.actif || !R.salonRaid || R.raidHeures <= 0) return false;
  if (raidActif(guildId)) return false;
  const d = dernierRaidStmt.get(String(guildId));
  if (!d) return true;
  return now - (d.fini_le || d.cree_le) >= R.raidHeures * 3600000;
}

// Nicholas the Renegade ne sort qu'en décembre, comme dans le canon.
function choisirBossRaid(now, rng = Math.random) {
  if (new Date(now).getUTCMonth() === 11) return 'nicholas';
  const pool = ['fatal_scythe', 'dragon_blanc'];
  return pool[Math.floor(rng() * pool.length)];
}

// Crée le raid en base. Ses PV suivent le nombre d'aventuriers actifs et
// leur étage médian : ~14 coups chacun à la puissance de référence.
function creerRaid(guildId, { now = Date.now(), rng = Math.random, boss = null } = {}) {
  const R = G.reglagesSao(guildId);
  const cle = boss && D.RAIDS[boss] ? boss : choisirBossRaid(now, rng);
  const def = D.RAIDS[cle];
  const actifs = aventuriersActifs(guildId, now);
  const etages = actifs.map((r) => Math.min(100, r.floor)).sort((a, b) => a - b);
  const median = etages.length ? etages[Math.floor(etages.length / 2)] : 1;
  const attendus = Math.min(30, Math.max(3, actifs.length));
  const k = F.difficulteSao(R.difficulte).ennemi;
  const pv = Math.round(F.aventurierReference(median).atk * def.pv * attendus * 0.75 * k);
  const duree = Math.min(24, Math.max(2, R.raidHeures)) * 3600000;
  const id = Number(raidAddStmt.run(String(guildId), R.salonRaid, cle, median, pv, pv, now, now + duree).lastInsertRowid);
  return raidParId(id);
}

// Le partage du butin : une base pour tout participant, le reste au prorata.
function partagerRaid(raid, now) {
  const coups = coupsRaid(raid.id);
  const total = coups.reduce((s, c) => s + c.degats, 0) || 1;
  const def = D.RAIDS[raid.boss];
  const recompenses = [];
  for (const c of coups) {
    const part = c.degats / total;
    const p = G.chargerJoueur(raid.guild_id, c.user_id, now);
    if (!p) continue;
    const etage = Math.min(p.floor, 100);
    const col = Math.round(F.colChasse(etage) * (8 + 60 * part));
    const xp = Math.round(F.xpChasse(etage) * (6 + 40 * part));
    p.col += col;
    F.ajouterXp(p, xp);
    const mat = D.TRANCHES[D.trancheDe(etage)].materiau;
    const qte = 1 + Math.round(part * 8);
    G.ajouterObjet(p.guild_id, p.user_id, mat, qte);
    const badges = G.award(p.guild_id, p.user_id, 'raider') ? ['raider'] : [];
    G.savePlayer(p);
    recompenses.push({ user_id: c.user_id, part, col, xp, materiaux: { cle: mat, qte }, badges, xpServeur: 20 + Math.round(30 * part) });
  }
  if (def?.lab && raid.dernier_coup) {
    G.ajouterObjet(raid.guild_id, raid.dernier_coup, def.lab, def.labQte || 1);
    G.award(raid.guild_id, raid.dernier_coup, 'lab');
  }
  return recompenses;
}

// Un coup sur le boss de raid. Crée le personnage au besoin.
function frapperRaid(raidId, userId, { now = Date.now(), rng = Math.random, lien = false } = {}) {
  const raid = raidParId(raidId);
  if (!raid) return { refus: 'introuvable' };
  if (raid.statut !== 'actif') return { refus: 'termine', raid };
  if (now > raid.expire_le) {
    expirerRaid(raid, now);
    return { refus: 'expire', raid: raidParId(raid.id) };
  }
  const { created } = G.ensurePlayer(raid.guild_id, userId, now);
  const p = G.chargerJoueur(raid.guild_id, userId, now);
  const attente = Math.max(0, Number(p.reapparition || 0) - now);
  if (attente > 0) return { refus: 'reapparition', ms: attente, raid };
  const deja = coupStmt.get(raid.id, String(userId));
  if (deja?.dernier_le && now - deja.dernier_le < DELAI_COUP_MS) return { refus: 'delai', ms: DELAI_COUP_MS - (now - deja.dernier_le), raid };

  const s = G.statsJoueur(p, { lien });
  const coup = F.coupSao(s.atk, rng, { mult: 1.5 + rng() });
  const degats = Math.min(coup.degats, raid.pv);
  const pv = raid.pv - degats;
  raidPvStmt.run(pv, raid.id);
  coupAddStmt.run(raid.id, String(userId), degats, now);
  p.last_afk = new Date(now).toISOString();
  const quetes = G.avancerQuete(p, 'raid', 1, now);
  G.savePlayer(p);

  const sortie = { degats, crit: coup.crit, cree: created, quetes, fin: null, recompenses: [] };
  if (pv <= 0 && raidFinStmt.run('vaincu', now, String(userId), raid.id).changes === 1) {
    sortie.fin = 'vaincu';
    sortie.recompenses = partagerRaid(raidParId(raid.id), now);
  }
  sortie.raid = raidParId(raid.id);
  sortie.coups = coupsRaid(raid.id);
  return sortie;
}

// Le boss se retire : un lot de consolation pour ceux qui ont frappé.
//
// Idempotent : tourDeRaids travaille sur une liste lue d'un coup, puis attend
// le réseau raid par raid. Un clic « Frapper » peut donc expirer un raid de
// la liste entre-temps — sans la garde, la boucle le ré-expirait et versait
// la consolation une seconde fois.
function expirerRaid(raid, now = Date.now()) {
  if (raidFinStmt.run('expire', now, null, raid.id).changes !== 1) return raidParId(raid.id);
  for (const c of coupsRaid(raid.id)) {
    const p = G.getPlayer(raid.guild_id, c.user_id);
    if (p) G.crediterCol(raid.guild_id, c.user_id, 3 * F.colChasse(Math.min(p.floor, 100)));
  }
  return raidParId(raid.id);
}

function delaiRaid(guildId, userId, now = Date.now()) {
  const raid = raidActif(guildId);
  if (!raid) return null;
  const c = coupStmt.get(raid.id, String(userId));
  return { raid, ms: c?.dernier_le ? Math.max(0, DELAI_COUP_MS - (now - c.dernier_le)) : 0 };
}

// ── Discord : publier, réécrire, tourner ────────────────────────────────

// Réécrit la carte d'un raid hors interaction (expiration).
async function rafraichirMessageRaid(client, raid, payload) {
  if (!raid.salon_id || !raid.message_id) return false;
  try {
    const { estCarte, enComposants } = require('../reponse');
    const salon = await client.channels.fetch(raid.salon_id).catch(() => null);
    const message = await salon?.messages?.fetch?.(raid.message_id).catch(() => null);
    if (!message) return false;
    if (estCarte(message)) {
      const composants = enComposants(salon.guild || null, client, payload);
      if (!composants?.length) return false;
      await message.edit({ components: composants, flags: require('../cartes').DRAPEAU_V2 });
    } else {
      await message.edit(payload);
    }
    return true;
  } catch {
    return false;
  }
}

async function publierRaid(client, guild, raid) {
  const V = require('./vues');
  const salon = await guild.channels.fetch(raid.salon_id).catch(() => null);
  if (!salon?.isTextBased?.()) return null;
  // Aucune mention : un raid s'annonce, il ne réveille personne.
  const message = await salon.send({ ...V.carteRaid(raid), allowedMentions: { parse: [] } }).catch(() => null);
  if (message?.id) raidMessageStmt.run(message.id, salon.id, raid.id);
  return message;
}

// Un passage de la tâche périodique. Exporté pour les tests.
async function tourDeRaids(client, now = Date.now()) {
  const V = require('./vues');
  const bilan = { crees: [], expires: [] };
  for (const raid of raidsExpiresStmt.all(now)) {
    const fini = expirerRaid(raid, now);
    // Clos entre-temps par un dernier coup : sa carte de victoire reste.
    if (fini?.statut !== 'expire') continue;
    bilan.expires.push(fini.id);
    await rafraichirMessageRaid(client, fini, V.carteRaid(fini, { coups: coupsRaid(fini.id), fin: 'expire' }));
  }
  for (const guild of client.guilds?.cache?.values?.() || []) {
    try {
      if (!raidDu(guild.id, now)) continue;
      const raid = creerRaid(guild.id, { now });
      const message = await publierRaid(client, guild, raid);
      if (!message) {
        // Salon introuvable ou fermé au bot : on n'insiste pas avant la
        // prochaine échéance, plutôt que de réessayer toutes les 5 minutes.
        raidFinStmt.run('annule', now, null, raid.id);
        continue;
      }
      bilan.crees.push(raid.id);
    } catch (err) {
      console.warn(`⚠️ Raid SAO non publié sur ${guild.id} : ${err.message}`);
    }
  }
  return bilan;
}

let minuteur = null;
function demarrerRaids(client) {
  if (minuteur) return;
  const passer = () => tourDeRaids(client).catch((err) => console.warn(`⚠️ Raids SAO : ${err.message}`));
  setTimeout(passer, 60 * 1000).unref?.();
  minuteur = setInterval(passer, PERIODE_MS);
  minuteur.unref?.();
}

module.exports = {
  DELAI_COUP_MS, PERIODE_MS, raidActif, raidParId, coupsRaid, raidDu, choisirBossRaid, creerRaid, frapperRaid,
  expirerRaid, delaiRaid, partagerRaid, publierRaid, tourDeRaids, demarrerRaids,
};
