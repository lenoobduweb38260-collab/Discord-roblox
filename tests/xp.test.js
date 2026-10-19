// 📈 XP & niveaux : courbes, gains aléatoires, exclusions, multiplicateurs,
// couple, sauts de niveaux, récompenses typées (rôles, Col, objets, MP),
// migration, baisse de niveau, annonces, /xp, classement paginé, carte PNG,
// et limites Discord du tableau de bord /config.
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

// Une base « d'avant » : des niveaux écrit/vocal séparés (sans colonnes xp
// ni level) et des récompenses à un rôle par niveau. Les migrations doivent
// les reprendre.
{
  const { DatabaseSync } = require('node:sqlite');
  const ancienne = new DatabaseSync(process.env.DATA_FILE);
  ancienne.exec(`
    CREATE TABLE levels (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, text_xp INTEGER NOT NULL DEFAULT 0,
      voice_xp INTEGER NOT NULL DEFAULT 0, text_level INTEGER NOT NULL DEFAULT 0, voice_level INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id));
    INSERT INTO levels (guild_id, user_id, text_xp, voice_xp) VALUES ('G0', 'u1', 300, 200), ('G0', 'u2', 50, 0);
    CREATE TABLE level_rewards (guild_id TEXT NOT NULL, level INTEGER NOT NULL, role_id TEXT NOT NULL, created_at TEXT,
      PRIMARY KEY (guild_id, level));
    INSERT INTO level_rewards (guild_id, level, role_id, created_at) VALUES ('G0', 5, '500000000000000005', NULL), ('G0', 10, '500000000000000010', NULL);
  `);
  ancienne.close();
}

// 💞 Le contrat B (src/utils/couple.js) n'existe pas encore : un faux.
const FAUX_COUPLE = {
  actif: false,
  appels: [],
  noterActiviteCouple(g, u) { this.appels.push(['noter', g, u]); },
  bonusXpCouple(g, u, source) {
    this.appels.push(['bonus', g, u, source]);
    return this.actif ? { pourcent: 10, raison: 'En couple avec Bob' } : null;
  },
};

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  if (n === './couple' && /levels\.js$/.test(this.filename || '')) return FAUX_COUPLE;
  return vrai.apply(this, arguments);
};

// Le faux discord.js n'a pas `setDefaultRoles` (le vrai l'a).
const D = require('discord.js');
D.RoleSelectMenuBuilder.prototype.setDefaultRoles ??= function (...v) {
  this.d.default_values = v.flat().map((id) => ({ id, type: 'role' }));
  return this;
};

const { db, setGuildConfig, getGuildConfig } = require('../src/database');
// La courbe de G0 est réglée AVANT le chargement de levels.js : la consigne
// de la migration doit être exécutée avec la courbe du serveur.
setGuildConfig('G0', 'xp_courbe', 'lineaire');
const L = require('../src/utils/levels');
const CARTE = require('../src/utils/carteNiveau');
const IMG = require('../src/utils/imageAmour');
const SAO = require('../src/utils/saoGame');
const NIV = require('../src/commands/niveau');
const XP = require('../src/commands/xp');
const CN = require('../src/utils/configNiveaux');
const { handleConfigInteraction } = require('../src/utils/configPanel');
const IC = require('../src/events/interactionCreate');
const MC = require('../src/events/messageCreate');
const GMR = require('../src/events/guildMemberRemove');
const { enComposants } = require('../src/utils/reponse');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };
const texte = (o) => JSON.stringify(o, (k, v) => (Buffer.isBuffer(v) ? `<png ${v.length}>` : v));
const json = (x) => (x && typeof x.toJSON === 'function' ? x.toJSON() : x);
const embedDe = (p) => json(p?.embeds?.[0]) || {};
console.warn = () => {};
console.log = ((log) => (...a) => { if (!/^(📊|🏅|🌐)/.test(String(a[0]))) log(...a); })(console.log);
global.fetch = async () => { throw new Error('pas de réseau dans les tests'); };

// ── Faux Discord ────────────────────────────────────────────────────────
const personne = (id, nom, bot = false) => ({
  id, username: nom, displayName: nom, globalName: nom, bot, tag: `${nom}#0`,
  displayAvatarURL: () => `https://cdn.test/${id}.png`,
  dms: [], async send(m) { this.dms.push(m); return {}; },
});
const USERS = { bot: personne('bot', 'LaboBot', true), robot: personne('robot', 'Robot', true), staff: personne('staff', 'Modo'), admin: personne('admin', 'Chef') };
for (let i = 1; i <= 30; i++) USERS[`u${i}`] = personne(`u${i}`, `Membre${i}`);
USERS.u1.displayName = 'Alice'; USERS.u2.displayName = 'Bob';

const ROLES = new Map();
const role = (id, name, position, managed = false) => { ROLES.set(id, { id, name, position, managed }); return id; };
const R = {
  BOT: role('100000000000000001', 'LaboBot', 50),
  N2: role('200000000000000002', 'Niveau 2', 10),
  N3: role('200000000000000003', 'Niveau 3', 11),
  N5: role('200000000000000005', 'Niveau 5', 12),
  NEW: role('200000000000000099', 'Nouveau', 3),
  HAUT: role('300000000000000001', 'Trop haut', 60),
  GERE: role('300000000000000002', 'Géré', 4, true),
  VIP: role('400000000000000001', 'VIP', 20),
  BOOST: role('400000000000000002', 'Booster', 25),
  MUET: role('400000000000000003', 'Sans XP', 2),
};

let compteur = 0;
function fauxSalon(id, { parentId = null, parent = null, type = 0 } = {}) {
  const s = {
    id, parentId, parent, type, envois: [], isTextBased: () => true,
    async send(p) { s.envois.push(p); return { id: `M${++compteur}`, ...p }; },
    messages: { fetch: async () => null },
  };
  return s;
}
const SALONS = {};
const salonNomme = (id, o) => { SALONS[id] = fauxSalon(id, o); return id; };
const S = {
  GEN: salonNomme('600000000000000001', { parentId: '600000000000000900' }),
  NIV: salonNomme('600000000000000002'),
  LOGS: salonNomme('600000000000000003'),
  EXCLU: salonNomme('600000000000000004', { parentId: '600000000000000900' }),
  DANSCAT: salonNomme('600000000000000005', { parentId: '600000000000000901' }),
  VOC1: salonNomme('600000000000000006', { type: 2 }),
  VOC2: salonNomme('600000000000000007', { type: 2 }),
  AFK: salonNomme('600000000000000008', { type: 2 }),
  BOOSTE: salonNomme('600000000000000009'),
};
S.FIL = salonNomme('600000000000000010', { parentId: S.EXCLU, parent: SALONS[S.EXCLU], type: 11 });
const CAT_EXCLUE = '600000000000000901';

const client = {
  user: { id: 'bot', username: 'LaboBot' },
  commands: new Map([['niveau', NIV], ['xp', XP]]),
  users: { fetch: async (id) => USERS[id] || null },
  channels: { fetch: async (id) => SALONS[id] || null },
  guilds: { cache: new Map() },
};

function fabriquerServeur(id) {
  const g = {
    id, name: `Serveur ${id}`, afkChannelId: S.AFK, iconURL: () => null, client, journal: [],
    roles: { cache: ROLES, fetch: async (rid) => ROLES.get(rid) || null },
    channels: { cache: new Map(Object.entries(SALONS)), fetch: async (cid) => SALONS[cid] || null },
    voiceStates: { cache: new Map() },
    connus: new Map(),
    members: {
      cache: new Map(),
      me: { id: 'bot', displayName: 'LaboBot', roles: { highest: ROLES.get(R.BOT), cache: new Map() } },
      async fetch(arg) {
        if (arg === undefined) return g.members.cache;
        if (typeof arg === 'string') {
          const m = g.connus.get(arg);
          if (!m) throw new Error('Unknown Member');
          return m;
        }
        if (arg && Array.isArray(arg.user)) return new Map(arg.user.filter((u) => g.connus.has(u)).map((u) => [u, g.connus.get(u)]));
        return null;
      },
    },
  };
  client.guilds.cache.set(id, g);
  return g;
}
function ajouterMembre(g, uid, roleIds = [], { staff = false, admin = false, enCache = true } = {}) {
  const cache = new Map(roleIds.map((r) => [r, ROLES.get(r)]));
  const m = {
    id: uid, user: USERS[uid], displayName: USERS[uid].displayName, guild: g,
    roles: {
      cache,
      async add(r) { cache.set(r.id, r); g.journal.push(`+${uid}:${r.name}`); },
      async remove(r) { cache.delete(r.id); g.journal.push(`-${uid}:${r.name}`); },
    },
    permissions: {
      has: (bit) => (bit === D.PermissionFlagsBits.Administrator ? admin
        : bit === D.PermissionFlagsBits.ModerateMembers ? staff || admin : false),
    },
  };
  g.connus.set(uid, m);
  if (enCache) g.members.cache.set(uid, m);
  return m;
}

function fausse(g, { type = 'commande', user = 'u1', nom = null, sub = null, options = {}, customId = null, champs = {}, valeurs = [], deModal = true } = {}) {
  const composant = ['bouton', 'menu', 'role', 'salon'].includes(type);
  return {
    client, guild: g, guildId: g.id, channelId: S.GEN, channel: SALONS[S.GEN], locale: 'fr',
    user: USERS[user], member: g.members.cache.get(user) || g.connus.get(user), commandName: nom, customId, values: valeurs,
    deferred: false, replied: false,
    message: { id: 'MSG', flags: 0, components: [], embeds: [{}], createdTimestamp: Date.now() },
    inGuild: () => true, isAutocomplete: () => false,
    isChatInputCommand: () => type === 'commande', isButton: () => type === 'bouton',
    isModalSubmit: () => type === 'modal', isFromMessage: () => type === 'modal' && deModal,
    isMessageComponent: () => composant, isStringSelectMenu: () => type === 'menu', isRoleSelectMenu: () => type === 'role',
    isChannelSelectMenu: () => type === 'salon', isUserSelectMenu: () => false, isAnySelectMenu: () => ['menu', 'role', 'salon'].includes(type),
    options: {
      getSubcommand: () => sub, getString: (k) => options[k] ?? null, getInteger: (k) => options[k] ?? null,
      getBoolean: (k) => options[k] ?? null, getUser: (k) => (options[k] ? USERS[options[k]] : null),
    },
    fields: { getTextInputValue: (k) => champs[k] ?? '' },
    reponses: [], suivis: [], mises: [], modales: [],
    async reply(p) { this.replied = true; this.reponses.push(p); return p; },
    async deferReply() { this.deferred = true; },
    async editReply(p) { this.reponses.push(p); return p; },
    async followUp(p) { this.suivis.push(p); return p; },
    async update(p) { this.replied = true; this.mises.push(p); return p; },
    async deferUpdate() { this.deferred = true; },
    async showModal(m) { this.modales.push(json(m)); },
  };
}
function fauxMessage(g, { user = 'u1', contenu = 'Bonjour à tous !', salon = S.GEN } = {}) {
  return {
    id: `U${++compteur}`, content: contenu, client, guild: g, channel: SALONS[salon], channelId: salon,
    author: USERS[user], member: g.members.cache.get(user), inGuild: () => true,
    attachments: { size: 0 }, mentions: { has: () => false, everyone: false },
  };
}

// ── Les limites Discord d'une vue et d'un formulaire ────────────────────
function soucisVue(vue) {
  const soucis = [];
  const rangs = (vue.components || []).map(json);
  if (rangs.length > 5) soucis.push(`${rangs.length} rangées`);
  const ids = [];
  for (const r of rangs) {
    if ((r.components || []).length > 5) soucis.push('rangée de plus de 5 composants');
    for (const c of r.components || []) {
      if (c.custom_id) ids.push(c.custom_id);
      if (c.custom_id && c.custom_id.length > 100) soucis.push(`id trop long : ${c.custom_id}`);
      if (c.label && c.label.length > 80) soucis.push(`libellé trop long : ${c.label}`);
      if (c.placeholder && c.placeholder.length > 150) soucis.push(`placeholder trop long : ${c.placeholder}`);
      if (c.type === 3) {
        if (!c.options?.length || c.options.length > 25) soucis.push(`${c.options?.length || 0} options dans ${c.custom_id}`);
        for (const o of c.options || []) {
          if (!o.label || o.label.length > 100 || String(o.description || '').length > 100 || String(o.value).length > 100) soucis.push(`option invalide ${texte(o)}`);
        }
      }
      if (c.default_values && c.max_values != null && c.default_values.length > c.max_values) soucis.push('plus de valeurs par défaut que le maximum');
      if (c.max_values != null && c.max_values > 25) soucis.push('max_values > 25');
    }
  }
  if (new Set(ids).size !== ids.length) soucis.push(`ids en double : ${ids.join(', ')}`);
  for (const e of (vue.embeds || []).map(json)) {
    if (String(e.description || '').length > 4096) soucis.push('description > 4096');
    if ((e.fields || []).length > 25) soucis.push('plus de 25 champs');
    let total = String(e.title || '').length + String(e.description || '').length + String(e.footer?.text || '').length;
    for (const f of e.fields || []) {
      total += String(f.name).length + String(f.value).length;
      if (!String(f.value).length || String(f.value).length > 1024 || String(f.name).length > 256) soucis.push(`champ invalide : ${f.name}`);
    }
    if (total > 6000) soucis.push(`embed de ${total} signes`);
  }
  return soucis;
}
function soucisModal(m) {
  const soucis = [];
  if (!m) return ['aucun formulaire'];
  if (m.components.length > 5 || !m.components.length) soucis.push(`${m.components.length} champs`);
  if (!m.title || m.title.length > 45) soucis.push(`titre : ${m.title}`);
  if (!m.custom_id || m.custom_id.length > 100) soucis.push(`id : ${m.custom_id}`);
  for (const r of m.components) {
    for (const c of r.components) {
      if (!c.label || c.label.length > 45) soucis.push(`libellé de ${c.label?.length} signes : ${c.label}`);
      if (c.value && c.max_length && String(c.value).length > c.max_length) soucis.push(`valeur trop longue : ${c.custom_id}`);
      if (c.placeholder && c.placeholder.length > 100) soucis.push('placeholder');
    }
  }
  return soucis;
}

// ── Faux saoGame (contrat A) ────────────────────────────────────────────
const BOURSE = new Map();
const SAC = [];
SAO.OBJETS = {
  potion: { nom: 'Potion de soin', emoji: '🧪', rarete: 'commun', type: 'soin', desc: '' },
  cristal: { nom: 'Cristal de téléportation', emoji: '💎', rarete: 'rare', type: 'outil', desc: '' },
};
SAO.crediterCol = (g, u, montant) => { const k = `${g}:${u}`; BOURSE.set(k, (BOURSE.get(k) || 0) + montant); return BOURSE.get(k); };
SAO.donnerObjet = (g, u, cle, qte = 1) => { if (!SAO.OBJETS[cle]) return false; SAC.push([g, u, cle, qte]); return true; };
SAO.objetsRecompensables = () => Object.entries(SAO.OBJETS).map(([cle, o]) => ({ cle, nom: o.nom, emoji: o.emoji }));

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n1) Migrations : niveaux fusionnés à la courbe du serveur, récompenses reprises');
  {
    const u1 = L.getLevels('G0', 'u1');
    V('XP fusionnée : écrit + vocal', u1.xp === 500, texte(u1));
    V('niveau calculé avec la courbe du serveur (linéaire : 500 XP → niveau 2)', u1.level === 2, `niveau ${u1.level}`);
    V('la consigne de recalcul est consommée', !db.prepare("SELECT 1 FROM app_state WHERE key = 'xp_niveaux_a_recalculer'").get());
    const recs = L.listerRecompensesNiveau('G0');
    V('les 2 anciennes récompenses sont reprises en type « role »', recs.length === 2 && recs.every((r) => r.type === 'role')
      && recs[0].niveau === 5 && recs[0].valeur === '500000000000000005' && recs[1].niveau === 10, texte(recs));
    V('reprise marquée une fois pour toutes', db.prepare("SELECT value FROM app_state WHERE key = 'niveau_recompenses_v2'").get()?.value === '1');
    const ancienne = db.prepare('SELECT COUNT(*) AS n FROM level_rewards').get().n;
    V('l\'ancienne table n\'est pas supprimée', ancienne === 2);
    V('index du classement présent', !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_levels_classement'").get());
    V('compatibilité : recompensesDe expose level et role_id', L.recompensesDe('G0')[0].level === 5 && L.recompensesDe('G0')[0].role_id === '500000000000000005');
  }

  console.log('\n2) Formules et courbes');
  {
    V('MEE6 : 100 XP pour le niveau 1, 155 pour le 2', L.xpForLevel(0) === 100 && L.xpForLevel(1) === 155);
    V('MEE6 : 4 675 XP au total pour le niveau 10', L.totalXpForLevel(10) === 4675);
    V('levelFromXp suit le total exact', L.levelFromXp(4675).level === 10 && L.levelFromXp(4674).level === 9);
    V('reste et besoin justes', L.levelFromXp(4700).current === 25 && L.levelFromXp(4700).needed === L.xpForLevel(10));
    V('courbes : douce < classique < raide au niveau 20',
      L.totalXpForLevel(20, 'douce') < L.totalXpForLevel(20, 'mee6') && L.totalXpForLevel(20, 'mee6') < L.totalXpForLevel(20, 'raide'));
    V('linéaire : 100 XP de plus à chaque niveau', L.xpForLevel(0, 'lineaire') === 100 && L.xpForLevel(4, 'lineaire') === 500);
    V('courbe inconnue → la classique', L.xpForLevel(3, 'nimporte') === L.xpForLevel(3));
    const plafonne = L.levelFromXp(1_000_000, 'mee6', 10);
    V('niveau maximum : plafond respecté et signalé', plafonne.level === 10 && plafonne.plafond === true);

    const g = 'G2';
    setGuildConfig(g, 'levels_enabled', 1);
    L.addXp(g, 'u1', 'admin', 4675);
    V('4 675 XP → niveau 10 (classique)', L.getLevels(g, 'u1').level === 10);
    setGuildConfig(g, 'xp_courbe', 'raide');
    const n = L.recalculerNiveaux(g);
    V('changer de courbe recalcule les niveaux du serveur', n === 1 && L.getLevels(g, 'u1').level < 10, `niveau ${L.getLevels(g, 'u1').level}`);
    V('l\'XP, elle, ne bouge pas', L.getLevels(g, 'u1').xp === 4675);
    // Un changement fait ailleurs (tableau de bord) est rattrapé au prochain gain.
    setGuildConfig(g, 'xp_courbe', 'mee6');
    L.addXp(g, 'u2', 'admin', 10);
    V('courbe changée hors /config : niveaux réalignés au prochain gain', L.getLevels(g, 'u1').level === 10);
    setGuildConfig(g, 'xp_niveau_max', 5);
    L.addXp(g, 'u2', 'admin', 10);
    V('niveau maximum appliqué aux niveaux déjà enregistrés', L.getLevels(g, 'u1').level === 5);
  }

  console.log('\n3) Gain texte aléatoire et borné');
  {
    const fixe = { xp_text: 20, xp_text_min: null, xp_text_max: null };
    V('sans minimum ni maximum : le gain fixe d\'avant', L.gainTexteXp(fixe) === 20);
    const plage = { xp_text: 20, xp_text_min: 15, xp_text_max: 25 };
    const tirages = Array.from({ length: 2000 }, () => L.gainTexteXp(plage));
    V('2 000 tirages tous dans [15, 25]', tirages.every((x) => Number.isInteger(x) && x >= 15 && x <= 25));
    V('les deux bornes sont atteignables', L.gainTexteXp(plage, () => 0) === 15 && L.gainTexteXp(plage, () => 0.99999) === 25);
    V('minimum et maximum inversés : remis dans l\'ordre', L.gainTexteXp({ xp_text: 20, xp_text_min: 30, xp_text_max: 10 }, () => 0) === 10);
    V('une seule borne : l\'autre vaut xp_text', L.gainTexteXp({ xp_text: 20, xp_text_min: 5, xp_text_max: null }, () => 0.99999) === 20);
  }

  console.log('\n4) Exclusions');
  {
    const g = fabriquerServeur('G4');
    setGuildConfig(g.id, 'levels_enabled', 1);
    const alice = ajouterMembre(g, 'u1');
    const muet = ajouterMembre(g, 'u2', [R.MUET]);
    V('ajout d\'un salon exclu (tout)', L.ajouterExclusionXp(g.id, 'salon', S.EXCLU, 'tout').ok);
    V('ajout d\'une catégorie exclue (écrit seulement)', L.ajouterExclusionXp(g.id, 'salon', CAT_EXCLUE, 'texte').ok);
    V('ajout d\'un rôle exclu', L.ajouterExclusionXp(g.id, 'role', R.MUET, 'tout').ok);
    V('identifiant invalide refusé', !L.ajouterExclusionXp(g.id, 'salon', 'abc').ok && !L.ajouterExclusionXp(g.id, 'truc', S.GEN).ok);
    const ex = (source, salon, membre = alice) => L.estExcluXp(g.id, source, { membre, salon: SALONS[salon] });
    V('salon exclu : aucune XP', ex('text', S.EXCLU) && ex('voice', S.EXCLU) && ex('jeux', S.EXCLU));
    V('un fil d\'un salon exclu est exclu aussi', ex('text', S.FIL));
    V('un salon d\'une catégorie exclue est exclu', ex('text', S.DANSCAT));
    V('…mais seulement pour l\'écrit (portée « texte »)', !ex('voice', S.DANSCAT));
    V('rôle exclu : aucune XP, partout', ex('text', S.GEN, muet) && ex('sao', null, muet));
    V('le staff (« admin ») n\'est jamais exclu', !L.estExcluXp(g.id, 'admin', { membre: muet, salon: SALONS[S.EXCLU] }));
    V('salon libre : XP normale', !ex('text', S.GEN));
    const r = L.remplacerExclusionsXp(g.id, 'salon', 'tout', [S.BOOSTE]);
    V('remplacer la liste d\'une portée : décoché = retiré, coché = ajouté', r.ajoutes === 1 && r.retires === 1 && !ex('text', S.EXCLU) && ex('text', S.BOOSTE));
    L.remplacerExclusionsXp(g.id, 'salon', 'tout', [S.EXCLU]);
    const trop = Array.from({ length: 30 }, (_, i) => `7000000000000000${String(i).padStart(2, '0')}`);
    L.remplacerExclusionsXp(g.id, 'role', 'vocal', trop);
    V('au plus 25 exclusions par genre et par portée', L.listerExclusionsXp(g.id).filter((e) => e.type === 'role' && e.portee === 'vocal').length === 25);
    V('la 26ᵉ est refusée avec une raison', /retirez-en une/.test(L.ajouterExclusionXp(g.id, 'role', '799999999999999999', 'vocal').erreur || ''));
    L.remplacerExclusionsXp(g.id, 'role', 'vocal', []);

    // Par le vrai messageCreate.
    await MC.execute(fauxMessage(g, { salon: S.EXCLU }));
    V('message dans un salon exclu : rien gagné', L.getLevels(g.id, 'u1').xp === 0);
    await MC.execute(fauxMessage(g, { salon: S.FIL }));
    V('message dans un fil du salon exclu : rien gagné', L.getLevels(g.id, 'u1').xp === 0);
    setGuildConfig(g.id, 'xp_longueur_min', 10);
    await MC.execute(fauxMessage(g, { contenu: 'ok' }));
    V('message trop court : rien gagné (et le délai n\'est pas consommé)', L.getLevels(g.id, 'u1').xp === 0);
    await MC.execute(fauxMessage(g, { contenu: 'Un message assez long pour compter' }));
    V('message valide : XP gagnée', L.getLevels(g.id, 'u1').xp === 20 && L.getLevels(g.id, 'u1').text_xp === 20, texte(L.getLevels(g.id, 'u1')));
    await MC.execute(fauxMessage(g, { contenu: 'Un deuxième message assez long' }));
    V('délai respecté : pas de second gain tout de suite', L.getLevels(g.id, 'u1').xp === 20);
    await MC.execute(fauxMessage(g, { user: 'u2', contenu: 'Je suis muet mais je parle beaucoup' }));
    V('membre au rôle exclu : rien gagné', L.getLevels(g.id, 'u2').xp === 0);
  }

  console.log('\n5) Multiplicateurs, boost, week-end, part SAO');
  {
    const g = fabriquerServeur('G5');
    setGuildConfig(g.id, 'levels_enabled', 1);
    const vip = ajouterMembre(g, 'u1', [R.VIP]);
    const double = ajouterMembre(g, 'u2', [R.VIP, R.BOOST]);
    ajouterMembre(g, 'u3');
    V('multiplicateur de rôle posé', L.definirMultiplicateurXp(g.id, 'role', R.VIP, 150).ok);
    L.definirMultiplicateurXp(g.id, 'role', R.BOOST, 120);
    L.definirMultiplicateurXp(g.id, 'salon', S.BOOSTE, 200);
    V('pourcentage hors bornes refusé', !L.definirMultiplicateurXp(g.id, 'role', R.VIP, 5000).ok);
    const f = (membre, salon = S.GEN, source = 'text', quand = new Date('2026-10-19T12:00:00Z')) =>
      L.multiplicateursXp(g.id, source, { membre, salon: SALONS[salon] }, quand).facteur;
    V('rôle à 150 % → ×1,5', Math.abs(f(vip) - 1.5) < 1e-9);
    V('deux rôles, mode « plus haut rôle » : Booster (position 25) → ×1,2', Math.abs(f(double) - 1.2) < 1e-9, String(f(double)));
    setGuildConfig(g.id, 'xp_mult_cumul', 1);
    V('deux rôles cumulés : +50 % et +20 % → ×1,7', Math.abs(f(double) - 1.7) < 1e-9, String(f(double)));
    setGuildConfig(g.id, 'xp_mult_cumul', 0);
    V('salon à 200 % × rôle à 150 % → ×3', Math.abs(f(vip, S.BOOSTE) - 3) < 1e-9);
    setGuildConfig(g.id, 'xp_mult_global', 50);
    V('multiplicateur du serveur à 50 %', Math.abs(f(vip) - 0.75) < 1e-9);
    setGuildConfig(g.id, 'xp_mult_global', 100);
    setGuildConfig(g.id, 'xp_boost_pourcent', 100);
    setGuildConfig(g.id, 'xp_boost_fin', '2026-10-20T00:00:00Z');
    V('boost en cours : +100 %', Math.abs(f(vip) - 3) < 1e-9);
    V('boost terminé : plus rien', Math.abs(f(vip, S.GEN, 'text', new Date('2026-10-21T00:00:00Z')) - 1.5) < 1e-9);
    setGuildConfig(g.id, 'xp_boost_pourcent', 0);
    V('week-end à l\'heure de Paris : samedi oui, lundi non',
      L.estWeekEndParis(new Date('2026-10-17T12:00:00Z')) && !L.estWeekEndParis(new Date('2026-10-19T12:00:00Z')));
    V('vendredi 22 h 30 UTC = samedi 0 h 30 à Paris', L.estWeekEndParis(new Date('2026-10-16T22:30:00Z')));
    V('dimanche 22 h 30 UTC = lundi 0 h 30 à Paris', !L.estWeekEndParis(new Date('2026-10-18T22:30:00Z')));
    setGuildConfig(g.id, 'xp_weekend_pourcent', 50);
    V('bonus du week-end appliqué le samedi', Math.abs(f(vip, S.GEN, 'text', new Date('2026-10-17T12:00:00Z')) - 2.25) < 1e-9);
    setGuildConfig(g.id, 'xp_weekend_pourcent', 0);
    setGuildConfig(g.id, 'xp_sao_pourcent', 50);
    V('part SAO à 50 % : la moitié de l\'XP SAO', L.addXp(g.id, 'u3', 'sao', 100).gagne === 50);
    setGuildConfig(g.id, 'xp_sao_pourcent', 0);
    V('part SAO à 0 % : aucune XP SAO', L.addXp(g.id, 'u3', 'sao', 100).gagne === 0);
    V('la part SAO ne touche pas l\'écrit', L.addXp(g.id, 'u3', 'text', 100).gagne === 100);
    V('addXp applique le multiplicateur du contexte', L.addXp(g.id, 'u1', 'text', 20, { membre: vip, salon: SALONS[S.BOOSTE] }).gagne === 60);
    V('…et seulement quand le contexte est fourni', L.addXp(g.id, 'u1', 'text', 20).gagne === 20);
    V('le staff n\'est soumis à aucun multiplicateur', L.addXp(g.id, 'u1', 'admin', 20, { membre: vip, salon: SALONS[S.BOOSTE] }).gagne === 20);
    const details = L.multiplicateursXp(g.id, 'text', { membre: vip }).details;
    V('détail lisible pour /niveau voir', details.length === 1 && /<@&/.test(details[0].libelle) && details[0].pourcent === 150, texte(details));
    V('retirer un multiplicateur', L.retirerMultiplicateurXp(g.id, 'role', R.VIP) && Math.abs(f(vip) - 1) < 1e-9);
  }

  console.log('\n6) Bonus de couple (contrat B simulé)');
  {
    const g = fabriquerServeur('G6');
    setGuildConfig(g.id, 'levels_enabled', 1);
    const alice = ajouterMembre(g, 'u1');
    FAUX_COUPLE.actif = true;
    FAUX_COUPLE.appels = [];
    const r = L.addXp(g.id, 'u1', 'text', 100, { membre: alice });
    V('bonus de couple de 10 % appliqué', r.gagne === 110, texte(r));
    V('activité notée AVANT de demander le bonus', FAUX_COUPLE.appels[0]?.[0] === 'noter' && FAUX_COUPLE.appels.some((a) => a[0] === 'bonus' && a[3] === 'text'),
      texte(FAUX_COUPLE.appels));
    FAUX_COUPLE.appels = [];
    L.addXp(g.id, 'u1', 'admin', 100);
    V('le staff ne déclenche ni activité ni bonus', FAUX_COUPLE.appels.length === 0);
    FAUX_COUPLE.actif = false;
    V('sans couple : gain normal', L.addXp(g.id, 'u1', 'text', 100, { membre: alice }).gagne === 100);
    FAUX_COUPLE.bonusXpCouple = () => { throw new Error('panne'); };
    V('un module couple en panne ne casse pas l\'XP', L.addXp(g.id, 'u1', 'text', 100, { membre: alice }).gagne === 100);
    FAUX_COUPLE.bonusXpCouple = () => null;
  }

  console.log('\n7) Sauts de niveaux, récompenses de chaque type, annonce');
  {
    const g = fabriquerServeur('G7');
    setGuildConfig(g.id, 'levels_enabled', 1);
    setGuildConfig(g.id, 'level_channel_id', S.NIV);
    setGuildConfig(g.id, 'sao_enabled', 1);
    const alice = ajouterMembre(g, 'u1', [R.NEW]);
    const ajout = (o) => L.ajouterRecompenseNiveau(g.id, o);
    V('rôle au niveau 2', ajout({ niveau: 2, type: 'role', valeur: R.N2 }).ok);
    V('deuxième récompense au même niveau (Col)', ajout({ niveau: 2, type: 'col', quantite: 500 }).ok);
    V('rôle au niveau 3 + retrait du rôle « Nouveau »', ajout({ niveau: 3, type: 'role', valeur: R.N3 }).ok && ajout({ niveau: 3, type: 'role_retrait', valeur: R.NEW }).ok);
    V('objet SAO au niveau 4', ajout({ niveau: 4, type: 'objet', valeur: 'potion', quantite: 3 }).ok);
    V('message privé au niveau 5', ajout({ niveau: 5, type: 'mp', valeur: 'Bravo {pseudo} : niveau {niveau} sur {serveur} ! $&' }).ok);
    V('objet inconnu du catalogue refusé', /n'existe pas/.test(ajout({ niveau: 4, type: 'objet', valeur: 'epee_legendaire' }).erreur || ''));
    V('doublon refusé', !ajout({ niveau: 2, type: 'role', valeur: R.N2 }).ok);
    V('niveau hors bornes refusé', !ajout({ niveau: 0, type: 'col', quantite: 1 }).ok && !ajout({ niveau: 2000, type: 'col', quantite: 1 }).ok);
    V('Col hors bornes refusé', !ajout({ niveau: 2, type: 'col', quantite: 0 }).ok);
    V('message privé vide refusé', !ajout({ niveau: 2, type: 'mp', valeur: '   ' }).ok);

    // Un gros gain SAO : de 0 à 5 d'un coup.
    const res = await L.gagnerXpServeur(g, 'u1', 'sao', L.totalXpForLevel(5), { salon: SALONS[S.GEN] });
    V('saut de niveaux : 0 → 5', res.leveledUp && res.oldLevel === 0 && res.newLevel === 5 && res.gagne === L.totalXpForLevel(5), texte(res));
    V('rôles des paliers INTERMÉDIAIRES donnés aussi', alice.roles.cache.has(R.N2) && alice.roles.cache.has(R.N3), g.journal.join(' '));
    V('rôle retiré au palier 3', !alice.roles.cache.has(R.NEW));
    V('Col versé une fois', BOURSE.get('G7:u1') === 500);
    V('objet donné en 3 exemplaires', SAC.some((s) => s[0] === 'G7' && s[2] === 'potion' && s[3] === 3));
    const mp = USERS.u1.dms.map((d) => embedDe(d).description || '').find((d) => /Bravo/.test(d)) || '';
    V('message privé envoyé, variables remplacées (un « $& » reste tel quel)', mp.includes('Bravo Alice : niveau 5 sur Serveur G7 ! $&'), mp);
    const annonce = SALONS[S.NIV].envois.at(-1);
    const d = embedDe(annonce).description || '';
    V('annonce dans le salon des niveaux', !!annonce && /niveau 5/.test(d), d);
    V('annonce : « dans l\'Aventure SAO », plus jamais « en écrivant »', d.includes('Aventure SAO') && !d.includes('en écrivant'), d);
    V('annonce : le saut est dit (+5 niveaux)', d.includes('+5 niveaux'));
    V('annonce : TOUTES les récompenses reçues sont listées',
      d.includes(`<@&${R.N2}>`) && d.includes(`<@&${R.N3}>`) && d.includes('500 Col') && d.includes('Potion de soin') && d.includes('retrait de'), d);
    V('annonce : mention explicite, et seulement du membre', texte(annonce.allowedMentions) === texte({ users: ['u1'] }));

    // Pas de double versement.
    await L.gagnerXpServeur(g, 'u1', 'text', L.xpForLevel(5), { membre: alice, salon: SALONS[S.GEN] });
    V('niveau suivant : le Col n\'est pas reversé', BOURSE.get('G7:u1') === 500);
    V('niveau suivant : le message privé n\'est pas renvoyé', USERS.u1.dms.filter((x) => /Bravo/.test(embedDe(x).description || '')).length === 1);

    // Rattrapage : une récompense ajoutée après coup.
    ajout({ niveau: 2, type: 'col', quantite: 70 });
    await L.gagnerXpServeur(g, 'u1', 'text', 5, { membre: alice, salon: SALONS[S.GEN] });
    V('récompense ajoutée après coup : donnée au prochain gain', BOURSE.get('G7:u1') === 570, String(BOURSE.get('G7:u1')));

    // SAO coupé : ignoré, et le diagnostic le dit.
    setGuildConfig(g.id, 'sao_enabled', 0);
    const bob = ajouterMembre(g, 'u2');
    await L.gagnerXpServeur(g, 'u2', 'text', L.totalXpForLevel(4), { membre: bob });
    V('SAO coupé : pas de Col ni d\'objet', !BOURSE.get('G7:u2') && !SAC.some((s) => s[1] === 'u2'));
    V('SAO coupé : les rôles, eux, sont donnés', bob.roles.cache.has(R.N2) && bob.roles.cache.has(R.N3));
    const diag = L.diagnostiquerRecompenses(g);
    V('diagnostic : « Aventure SAO désactivée »', diag.filter((x) => x.type === 'col' || x.type === 'objet').every((x) => /SAO désactivée/.test(x.souci || '')));
    setGuildConfig(g.id, 'sao_enabled', 1);
    await L.gagnerXpServeur(g, 'u2', 'text', 3, { membre: bob });
    V('SAO réactivé : le Col en attente arrive au prochain gain', BOURSE.get('G7:u2') === 570, String(BOURSE.get('G7:u2')));

    // Diagnostic des rôles.
    db.prepare("INSERT INTO niveau_recompenses (guild_id, niveau, type, valeur, quantite) VALUES ('G7', 8, 'role', '999999999999999999', 1), ('G7', 8, 'role', ?, 1), ('G7', 8, 'role', ?, 1), ('G7', 8, 'objet', 'disparu', 1)")
      .run(R.HAUT, R.GERE);
    const soucis = L.diagnostiquerRecompenses(g).filter((x) => x.niveau === 8).map((x) => x.souci);
    V('diagnostic : rôle disparu, au-dessus du bot, géré, objet inconnu',
      soucis.some((s) => /n'existe plus/.test(s)) && soucis.some((s) => /au-dessus/.test(s)) && soucis.some((s) => /géré/.test(s)) && soucis.some((s) => /objet inconnu/.test(s)),
      texte(soucis));
    const prochaine = L.prochaineRecompenseNiveau(g.id, 6);
    V('prochaine récompense : le palier 8', prochaine?.niveau === 8 && prochaine.recompenses.length === 4);
    db.prepare("DELETE FROM niveau_recompenses WHERE guild_id = 'G7' AND niveau = 8").run();
    const idCol = L.listerRecompensesNiveau(g.id).find((x) => x.type === 'col').id;
    V('supprimer une récompense oublie aussi son registre', L.supprimerRecompenseNiveau(g.id, idCol)
      && !db.prepare('SELECT 1 FROM niveau_recompenses_recues WHERE recompense_id = ?').get(idCol));
  }

  console.log('\n8) Mode remplacement, baisse de niveau, synchronisation');
  {
    const g = fabriquerServeur('G8');
    setGuildConfig(g.id, 'levels_enabled', 1);
    L.ajouterRecompenseNiveau(g.id, { niveau: 2, type: 'role', valeur: R.N2 });
    L.ajouterRecompenseNiveau(g.id, { niveau: 3, type: 'role', valeur: R.N3 });
    L.ajouterRecompenseNiveau(g.id, { niveau: 5, type: 'role', valeur: R.N5 });
    setGuildConfig(g.id, 'level_rewards_stack', 0);
    const alice = ajouterMembre(g, 'u1');
    await L.gagnerXpServeur(g, 'u1', 'text', L.totalXpForLevel(3), { membre: alice });
    V('remplacement : seul le rôle du plus haut palier', alice.roles.cache.has(R.N3) && !alice.roles.cache.has(R.N2), g.journal.join(' '));
    setGuildConfig(g.id, 'level_rewards_stack', 1);
    await L.gagnerXpServeur(g, 'u1', 'text', L.xpForLevel(3) + L.xpForLevel(4), { membre: alice });
    V('cumul : tous les paliers, rattrapage compris', [R.N2, R.N3, R.N5].every((r) => alice.roles.cache.has(r)));
    const res = await L.gagnerXpServeur(g, 'u1', 'admin', -(L.xpForLevel(4) + L.xpForLevel(3)), { membre: alice });
    V('retrait d\'XP : niveau 5 → 3', res.leveledDown && res.newLevel === 3, texte(res));
    V('baisse : le rôle du palier 5 est repris, les autres restent',
      !alice.roles.cache.has(R.N5) && alice.roles.cache.has(R.N3) && alice.roles.cache.has(R.N2), g.journal.join(' '));
    V('retrait plus grand que l\'XP : on s\'arrête à 0', L.addXp(g.id, 'u1', 'admin', -1e9).newLevel === 0 && L.getLevels(g.id, 'u1').xp === 0);

    // Synchronisation : un membre avec un niveau mais sans ses rôles, un parti.
    const bob = ajouterMembre(g, 'u2');
    L.addXp(g.id, 'u2', 'admin', L.totalXpForLevel(3));
    L.addXp(g.id, 'u3', 'admin', L.totalXpForLevel(2)); // u3 n'est pas sur le serveur
    const bilan = await L.synchroniserNiveaux(g);
    V('synchronisation : rôles manquants donnés', bob.roles.cache.has(R.N2) && bob.roles.cache.has(R.N3) && bilan.donnes === 2, texte(bilan));
    V('synchronisation : membre parti retiré du classement', bilan.partis === 1 && L.getLevels(g.id, 'u3').parti === 1);
    V('rang : null sans XP, 1 pour le premier', L.rangNiveau(g.id, 'u1') === null && L.rangNiveau(g.id, 'u2') === 1);
  }

  console.log('\n9) Annonces : modes, fréquence, mention, modèle, système coupé');
  {
    const g = fabriquerServeur('G9');
    setGuildConfig(g.id, 'levels_enabled', 1);
    const alice = ajouterMembre(g, 'u1');
    const ici = SALONS[S.GEN];
    const niveauSuivant = () => L.xpForLevel(L.getLevels(g.id, 'u1').level);
    const monter = async () => {
      const avant = { niv: SALONS[S.NIV].envois.length, ici: ici.envois.length, mp: USERS.u1.dms.length };
      const r = await L.gagnerXpServeur(g, 'u1', 'text', niveauSuivant(), { membre: alice, salon: ici });
      return { r, niv: SALONS[S.NIV].envois.slice(avant.niv), ici: ici.envois.slice(avant.ici), mp: USERS.u1.dms.slice(avant.mp) };
    };
    let x = await monter();
    V('par défaut sans salon des niveaux : aucune annonce (comme avant)', x.r.leveledUp && !x.niv.length && !x.ici.length && !x.mp.length);
    setGuildConfig(g.id, 'level_channel_id', S.NIV);
    x = await monter();
    V('par défaut avec un salon : annonce dans ce salon', x.niv.length === 1 && !x.ici.length);
    setGuildConfig(g.id, 'level_annonce', 'ici');
    x = await monter();
    V('« ici » : dans le salon où le membre a gagné', x.ici.length === 1 && !x.niv.length);
    setGuildConfig(g.id, 'level_annonce', 'mp');
    x = await monter();
    V('« mp » : en message privé', x.mp.length === 1 && !x.ici.length && !x.niv.length);
    setGuildConfig(g.id, 'level_annonce', 'off');
    L.ajouterRecompenseNiveau(g.id, { niveau: L.getLevels(g.id, 'u1').level + 1, type: 'role', valeur: R.N2 });
    x = await monter();
    V('« off » : aucune annonce, mais la récompense est donnée', !x.niv.length && !x.ici.length && !x.mp.length && alice.roles.cache.has(R.N2));
    setGuildConfig(g.id, 'level_annonce', 'salon');
    setGuildConfig(g.id, 'level_annonce_pas', 10);
    x = await monter();
    V('tous les 10 niveaux : le niveau 6 n\'est pas annoncé', !x.niv.length, `niveau ${x.r.newLevel}`);
    L.ajouterRecompenseNiveau(g.id, { niveau: L.getLevels(g.id, 'u1').level + 1, type: 'role', valeur: R.N3 });
    x = await monter();
    V('…sauf un palier récompensé, toujours annoncé', x.niv.length === 1);
    setGuildConfig(g.id, 'level_annonce_pas', 1);
    setGuildConfig(g.id, 'level_mention', 0);
    x = await monter();
    const sansMention = embedDe(x.niv[0]).description || '';
    V('sans mention : le pseudo en gras, personne n\'est notifié',
      sansMention.includes('**Alice**') && !sansMention.includes('<@u1>') && texte(x.niv[0].allowedMentions) === texte({ parse: [] }), sansMention);
    setGuildConfig(g.id, 'level_mention', 1);
    setGuildConfig(g.id, 'level_message', '&& Bravo\n&> {membre} ({pseudo}) : {ancien_niveau} → **{niveau}**\n&> {xp} XP · rang #{rang} · {recompenses} · {serveur} · {inconnue}');
    USERS.u1.displayName = 'A && B $1';
    alice.displayName = 'A && B $1';
    x = await monter();
    const modele = embedDe(x.niv[0]).description || '';
    V('modèle : balises appliquées (section ◆, entrées ➜)', modele.includes('◆ **Bravo**') && modele.includes('➜ <@u1>'), modele);
    V('modèle : variables remplacées, pseudo pris tel quel (ni barre, ni « $1 »)',
      modele.includes('(A && B $1)') && /\d+ → \*\*\d+\*\*/.test(modele) && modele.includes('rang #1') && modele.includes('Serveur G9'), modele);
    V('modèle : une variable inconnue reste visible', modele.includes('{inconnue}'));
    alice.displayName = 'Alice';
    setGuildConfig(g.id, 'levels_enabled', 0);
    const coupe = await L.gagnerXpServeur(g, 'u1', 'text', 1e6, { membre: alice, salon: ici });
    V('système coupé : ni XP, ni annonce', coupe.gagne === 0 && !coupe.leveledUp);
    const direct = await L.announceLevelUp(g, 'u1', 'text', 50, ici, 49);
    V('système coupé : announceLevelUp ne dit rien', direct.annonce === false);
    setGuildConfig(g.id, 'levels_enabled', 1);
    const libelles = Object.keys(L.SOURCES_XP);
    V('les sources ont chacune leur libellé', ['text', 'voice', 'sao', 'jeux', 'comptage', 'couple', 'admin'].every((s) => libelles.includes(s)));
  }

  console.log('\n10) Vocal anti-AFK');
  {
    const g = fabriquerServeur('G10');
    setGuildConfig(g.id, 'levels_enabled', 1);
    setGuildConfig(g.id, 'xp_voice', 7);
    const vs = (uid, channelId, o = {}) => {
      const m = g.members.cache.get(uid) || ajouterMembre(g, uid);
      g.voiceStates.cache.set(uid, { channelId, member: m, channel: SALONS[channelId], ...o });
    };
    vs('u1', S.VOC1);
    await L.distribuerXpVocale(g);
    V('seul dans le salon : rien', L.getLevels(g.id, 'u1').xp === 0);
    ajouterMembre(g, 'robot');
    vs('robot', S.VOC1);
    await L.distribuerXpVocale(g);
    V('seul humain avec un bot : rien', L.getLevels(g.id, 'u1').xp === 0);
    vs('u2', S.VOC1, { selfMute: true, mute: true });
    await L.distribuerXpVocale(g);
    V('deux humains : le non-muet gagne', L.getLevels(g.id, 'u1').xp === 7 && L.getLevels(g.id, 'u1').voice_xp === 7);
    V('muet : rien (le bug « un muet gagne de l\'XP » est corrigé)', L.getLevels(g.id, 'u2').xp === 0);
    V('bot : jamais', L.getLevels(g.id, 'robot').xp === 0);
    vs('u3', S.AFK);
    vs('u4', S.AFK);
    await L.distribuerXpVocale(g);
    V('salon AFK : jamais', L.getLevels(g.id, 'u3').xp === 0);
    setGuildConfig(g.id, 'xp_vocal_muet', 1);
    setGuildConfig(g.id, 'xp_vocal_seul', 1);
    g.voiceStates.cache.delete('robot');
    vs('u5', S.VOC2, { selfDeaf: true, deaf: true });
    await L.distribuerXpVocale(g);
    V('réglages permissifs : muet et seul gagnent', L.getLevels(g.id, 'u2').xp === 7 && L.getLevels(g.id, 'u5').xp === 7);
    L.ajouterExclusionXp(g.id, 'salon', S.VOC2, 'vocal');
    await L.distribuerXpVocale(g);
    V('salon vocal exclu : rien', L.getLevels(g.id, 'u5').xp === 7);
  }

  console.log('\n11) /xp : donner, retirer, définir, remises à zéro, synchroniser');
  {
    const g = fabriquerServeur('G11');
    setGuildConfig(g.id, 'levels_enabled', 1);
    setGuildConfig(g.id, 'log_channel_id', S.LOGS);
    ajouterMembre(g, 'staff', [], { staff: true });
    ajouterMembre(g, 'admin', [], { admin: true });
    const alice = ajouterMembre(g, 'u1');
    ajouterMembre(g, 'u2');
    L.ajouterRecompenseNiveau(g.id, { niveau: 3, type: 'role', valeur: R.N3 });

    const refus = fausse(g, { user: 'u2', nom: 'xp', sub: 'donner', options: { membre: 'u1', quantite: 100 } });
    await IC.execute(refus);
    V('un membre ne peut pas utiliser /xp', /réservée au grade/.test(refus.reponses[0]?.content || '') && L.getLevels(g.id, 'u1').xp === 0);

    let it = fausse(g, { user: 'staff', nom: 'xp', sub: 'donner', options: { membre: 'u1', quantite: L.totalXpForLevel(3) } });
    await IC.execute(it);
    V('/xp donner : XP ajoutée, niveau 3', L.getLevels(g.id, 'u1').level === 3, texte(it.reponses));
    V('/xp donner : la récompense du palier est donnée', alice.roles.cache.has(R.N3));
    V('/xp donner : réponse éphémère qui dit l\'avant/après', it.reponses[0]?.flags === 64 && /Niveau \*\*0\*\* → \*\*3\*\*/.test(embedDe(it.reponses[0]).description || ''), texte(it.reponses[0]));
    V('/xp donner : journalisé', SALONS[S.LOGS].envois.some((e) => /XP modifiée/.test(embedDe(e).title || '')));

    it = fausse(g, { user: 'staff', nom: 'xp', sub: 'retirer', options: { membre: 'u1', quantite: 200 } });
    await IC.execute(it);
    V('/xp retirer : niveau perdu et rôle repris', L.getLevels(g.id, 'u1').level === 2 && !alice.roles.cache.has(R.N3), g.journal.join(' '));

    it = fausse(g, { user: 'staff', nom: 'xp', sub: 'definir', options: { membre: 'u1', niveau: 7 } });
    await IC.execute(it);
    V('/xp definir niveau : niveau exact', L.getLevels(g.id, 'u1').level === 7 && L.getLevels(g.id, 'u1').xp === L.totalXpForLevel(7));
    it = fausse(g, { user: 'staff', nom: 'xp', sub: 'definir', options: { membre: 'u1', xp: 1000 } });
    await IC.execute(it);
    V('/xp definir xp : XP exacte', L.getLevels(g.id, 'u1').xp === 1000);
    it = fausse(g, { user: 'staff', nom: 'xp', sub: 'definir', options: { membre: 'u1', niveau: 2, xp: 5 } });
    await IC.execute(it);
    V('/xp definir avec niveau ET xp : refusé avec explication', /soit/.test(it.reponses[0]?.content || ''));
    it = fausse(g, { user: 'staff', nom: 'xp', sub: 'donner', options: { membre: 'robot', quantite: 5 } });
    await IC.execute(it);
    V('/xp sur un bot : refusé', /bots/.test(it.reponses[0]?.content || ''));

    it = fausse(g, { user: 'staff', nom: 'xp', sub: 'reset', options: { membre: 'u1' } });
    await IC.execute(it);
    V('/xp reset : réservé à l\'administration', /administration/.test(it.reponses[0]?.content || '') && L.getLevels(g.id, 'u1').xp === 1000);
    it = fausse(g, { user: 'admin', nom: 'xp', sub: 'reset', options: { membre: 'u1' } });
    await IC.execute(it);
    V('/xp reset par un admin : membre remis à zéro', L.getLevels(g.id, 'u1').xp === 0 && /repart du niveau 0/.test(embedDe(it.reponses[0]).description || ''));

    L.addXp(g.id, 'u1', 'admin', 500);
    L.addXp(g.id, 'u2', 'admin', 800);
    it = fausse(g, { user: 'admin', nom: 'xp', sub: 'reset-serveur' });
    await IC.execute(it);
    const boutons = json(it.reponses[0]?.components?.[0])?.components || [];
    const oui = boutons.find((b) => b.custom_id.startsWith('niv:raz:oui:'));
    const non = boutons.find((b) => b.custom_id.startsWith('niv:raz:non:'));
    V('/xp reset-serveur : confirmation par bouton persistant', !!oui && !!non && oui.custom_id.length <= 100 && oui.custom_id.split(':')[3] === 'admin', texte(boutons));
    V('/xp reset-serveur : rien n\'est effacé avant confirmation', L.getLevels(g.id, 'u2').xp === 800);
    let b = fausse(g, { type: 'bouton', user: 'staff', customId: oui.custom_id });
    await IC.execute(b);
    V('un autre que le demandeur ne peut pas confirmer', /Seul·e/.test(b.reponses[0]?.content || '') && L.getLevels(g.id, 'u2').xp === 800);
    b = fausse(g, { type: 'bouton', user: 'admin', customId: `niv:raz:oui:admin:${Date.now() - 11 * 60 * 1000}` });
    await IC.execute(b);
    V('confirmation expirée : rien n\'est effacé', /expirée/.test(embedDe(b.mises[0]).title || '') && L.getLevels(g.id, 'u2').xp === 800);
    b = fausse(g, { type: 'bouton', user: 'admin', customId: non.custom_id });
    await IC.execute(b);
    V('« Annuler » : rien n\'est effacé', /annulée/.test(embedDe(b.mises[0]).title || '') && L.getLevels(g.id, 'u2').xp === 800);
    b = fausse(g, { type: 'bouton', user: 'admin', customId: oui.custom_id });
    await IC.execute(b);
    V('confirmation : tout le serveur repart de zéro', L.getLevels(g.id, 'u1').xp === 0 && L.getLevels(g.id, 'u2').xp === 0
      && /2/.test(embedDe(b.mises[0]).description || ''), texte(b.mises[0]));
    V('remise à zéro journalisée', SALONS[S.LOGS].envois.some((e) => /remise à zéro/.test(embedDe(e).title || '')));

    // Synchroniser.
    L.addXp(g.id, 'u2', 'admin', L.totalXpForLevel(4));
    it = fausse(g, { user: 'staff', nom: 'xp', sub: 'synchroniser' });
    await IC.execute(it);
    V('/xp synchroniser : récompense rattrapée et bilan affiché', g.members.cache.get('u2').roles.cache.has(R.N3)
      && /Membres traités : \*\*1\*\*/.test(embedDe(it.reponses[0]).description || ''), texte(it.reponses[0]));

    // Départ d'un membre.
    await GMR.execute({ id: 'u2', guild: g, user: USERS.u2 });
    V('départ : le membre quitte le classement, son XP reste', L.getLevels(g.id, 'u2').parti === 1 && L.getLevels(g.id, 'u2').xp > 0);
    setGuildConfig(g.id, 'level_reset_depart', 1);
    await GMR.execute({ id: 'u2', guild: g, user: USERS.u2 });
    V('départ avec « effacer au départ » : XP effacée', L.getLevels(g.id, 'u2').xp === 0);
  }

  console.log('\n12) /niveau classement paginé, recompenses, voir (carte PNG)');
  {
    const g = fabriquerServeur('G12');
    setGuildConfig(g.id, 'levels_enabled', 1);
    for (let i = 1; i <= 25; i++) {
      ajouterMembre(g, `u${i}`, [], { enCache: i !== 4 });
      L.addXp(g.id, `u${i}`, 'admin', 1000 * (26 - i));
      if (i % 2) L.addXp(g.id, `u${i}`, 'text', 10 * i);
    }
    // u3 a quitté le serveur sans que le bot le voie.
    g.connus.delete('u3');
    g.members.cache.delete('u3');
    let it = fausse(g, { nom: 'niveau', sub: 'classement' });
    await IC.execute(it);
    let p = it.reponses[0];
    let e = embedDe(p);
    const rangee = json(p.components?.[0]);
    V('classement : 10 par page, 3 pages', (e.description.match(/➜/g) || []).length === 10 && /Page 1\/3/.test(e.footer?.text || ''), e.footer?.text);
    V('classement : grammaire ◆ / ➜ et médailles', e.description.startsWith('◆') && e.description.includes('🥇 <@u1>'), e.description.slice(0, 120));
    V('classement : boutons ⏮️/⏭️, le premier grisé', rangee?.components?.[0]?.disabled === true && rangee.components[1].custom_id === 'niv:page:total:0:2', texte(rangee));
    V('membre parti découvert : signalé sur la page…', /<@u3>.*a quitté le serveur/.test(e.description));
    V('…et noté pour être filtré ensuite', L.getLevels(g.id, 'u3').parti === 1);
    let b = fausse(g, { type: 'bouton', customId: 'niv:page:total:0:2' });
    await IC.execute(b);
    e = embedDe(b.mises[0]);
    V('page 2 : les rangs 11 à 20, sans le parti', /Rangs 11 à 20/.test(e.description) && !e.description.includes('<@u3>') && /Page 2\/3/.test(e.footer?.text || ''), e.description.slice(0, 80));
    b = fausse(g, { type: 'bouton', customId: 'niv:page:total:1:1' });
    await IC.execute(b);
    V('« partis » : ils restent, signalés', /<@u3>.*a quitté le serveur/.test(embedDe(b.mises[0]).description));
    it = fausse(g, { nom: 'niveau', sub: 'classement', options: { tri: 'texte' } });
    await IC.execute(it);
    e = embedDe(it.reponses[0]);
    V('tri « écrit » : seulement ceux qui ont écrit, par XP écrite', /Écrit/.test(e.title) && e.description.includes('🥇 <@u25>') && !e.description.includes('<@u2>'), e.description.slice(0, 160));
    V('vue classement dans les limites Discord', soucisVue(it.reponses[0]).length === 0, soucisVue(it.reponses[0]).join(' ; '));

    setGuildConfig(g.id, 'levels_enabled', 0);
    b = fausse(g, { type: 'bouton', customId: 'niv:page:total:0:2' });
    await IC.execute(b);
    V('module coupé : le vieux bouton le dit', /désactivé/.test(b.reponses[0]?.content || '') && !b.mises.length);
    setGuildConfig(g.id, 'levels_enabled', 1);

    // /niveau recompenses
    L.ajouterRecompenseNiveau(g.id, { niveau: 2, type: 'role', valeur: R.N2 });
    L.ajouterRecompenseNiveau(g.id, { niveau: 2, type: 'col', quantite: 100 });
    L.ajouterRecompenseNiveau(g.id, { niveau: 400, type: 'mp', valeur: 'Légende !' });
    it = fausse(g, { user: 'u25', nom: 'niveau', sub: 'recompenses' });
    await IC.execute(it);
    e = embedDe(it.reponses[0]);
    V('/niveau recompenses : toutes les récompenses typées', e.description.includes(`<@&${R.N2}>`) && e.description.includes('100 Col') && e.description.includes('message privé'), e.description);
    V('/niveau recompenses : ✅ sur ce qui est acquis, 🔒 sinon', /Niveau 2 ✅/.test(e.description) && /🔒 · \*\*Niveau 400\*\*/.test(e.description), e.description);
    V('/niveau recompenses : SAO inactif signalé', /Aventure SAO inactive/.test(e.description));

    // /niveau voir
    db.prepare('INSERT OR IGNORE INTO mariages (a, b, depuis, guild_id) VALUES (?, ?, ?, ?)').run('u1', 'u2', new Date().toISOString(), g.id);
    L.definirMultiplicateurXp(g.id, 'role', R.VIP, 150);
    g.members.cache.get('u1').roles.cache.set(R.VIP, ROLES.get(R.VIP));
    it = fausse(g, { user: 'u1', nom: 'niveau', sub: 'voir' });
    await IC.execute(it);
    p = it.reponses[0];
    e = embedDe(p);
    V('/niveau voir : rang affiché', /Rang \*\*#1\*\*/.test(e.description), e.description);
    V('/niveau voir : « Marié·e à »', e.description.includes('💍 Marié·e à <@u2>'));
    V('/niveau voir : prochaine récompense', (e.fields || []).some((f) => /Prochaine/.test(f.name) && /400/.test(f.value)), texte(e.fields));
    V('/niveau voir : multiplicateurs actifs', (e.fields || []).some((f) => /Multiplicateurs/.test(f.name) && /×1,5/.test(f.value)), texte(e.fields));
    const fichier = p.files?.[0];
    V('/niveau voir : une vraie carte PNG jointe', fichier && Buffer.isBuffer(fichier.data) && e.image?.url === `attachment://${fichier.name}`, texte(p.files));
    const img = IMG.decoderPng(fichier?.data);
    V('carte PNG valide, 900 × 300', img?.largeur === 900 && img?.hauteur === 300);
    V('/niveau voir : éphémère (commande non publique)', p.flags === 64);
  }

  console.log('\n13) Carte de rang : pixels attendus');
  {
    const px = (img, x, y) => { const i = (y * img.largeur + x) * 4; return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]]; };
    const plan = CARTE.planCarteNiveau({ pseudo: 'Émilie✨', niveau: 12, rang: 3, courant: 50, requis: 100, total: 4725, accent: 0xff0000 });
    V('pseudo ramené à l\'ASCII', plan.nom === 'EMILIE' && plan.entete === 'RANG #3   NIVEAU 12' && plan.compteur === '50 / 100 XP', texte(plan));
    const img = IMG.decoderPng(CARTE.dessinerCarteNiveau(plan));
    const j = plan.jauge;
    const plein = px(img, j.x + Math.round(j.largeur * 0.25), j.y + j.hauteur / 2);
    const vide = px(img, j.x + Math.round(j.largeur * 0.9), j.y + j.hauteur / 2);
    V('jauge remplie à la couleur du serveur jusqu\'à 50 %', plein[0] > 200 && plein[1] < 120, texte(plein));
    V('au-delà, la piste reste plus sombre que le remplissage', vide[0] < 200 && vide[0] < plein[0] - 60, texte(vide));
    const avatar = px(img, plan.avatar.x - 60, plan.avatar.y);
    V('avatar absent : disque teinté avec l\'initiale', avatar[0] > avatar[2], texte(avatar));
    const max = CARTE.planCarteNiveau({ pseudo: 'X', niveau: 99, plafond: true });
    V('niveau maximum : jauge pleine, compteur explicite', max.progression === 1 && max.compteur === 'NIVEAU MAXIMUM');
    const fond = new IMG.Toile(4, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) fond.poser(x, y, [0, 255, 0]);
    const avecFond = IMG.decoderPng(CARTE.dessinerCarteNiveau(plan, null, IMG.decoderPng(fond.png())));
    V('image de fond PNG : utilisée (voilée)', px(avecFond, 870, 280)[1] > px(avecFond, 870, 280)[0], texte(px(avecFond, 870, 280)));
    const sansReseau = await CARTE.fabriquerCarteNiveau(plan, USERS.u1, 'https://exemple.test/fond.png');
    V('sans réseau : la carte part quand même', Buffer.isBuffer(sansReseau.png) && sansReseau.fondLu === false);
  }

  console.log('\n14) /config → 📈 XP & niveaux : rubriques, actions, limites Discord');
  {
    const g = fabriquerServeur('G14');
    setGuildConfig(g.id, 'levels_enabled', 1);
    setGuildConfig(g.id, 'log_channel_id', S.LOGS);
    ajouterMembre(g, 'staff', [], { staff: true });
    ajouterMembre(g, 'admin', [], { admin: true });
    ajouterMembre(g, 'u1');
    const cfg = (it) => handleConfigInteraction(it);

    // Toutes les rubriques, dans tous leurs états.
    for (let i = 0; i < 30; i++) L.ajouterRecompenseNiveau(g.id, { niveau: i + 1, type: 'col', quantite: 10 + i });
    for (let i = 0; i < 24; i++) L.definirMultiplicateurXp(g.id, 'role', `8000000000000000${String(i).padStart(2, '0')}`, 110 + i);
    L.definirMultiplicateurXp(g.id, 'salon', S.BOOSTE, 200);
    L.remplacerExclusionsXp(g.id, 'salon', 'texte', Array.from({ length: 25 }, (_, i) => `8100000000000000${String(i).padStart(2, '0')}`));
    L.remplacerExclusionsXp(g.id, 'role', 'texte', Array.from({ length: 25 }, (_, i) => `8200000000000000${String(i).padStart(2, '0')}`));
    setGuildConfig(g.id, 'level_message', 'x'.repeat(1500));
    const vues = {
      accueil: CN.vueConfigNiveaux(g),
      ...Object.fromEntries(Object.keys(CN.PAGES_CONFIG_NIVEAUX).map((p) => [p, CN.vueConfigNiveaux(g, p)])),
      'recompenses p2': CN.vueConfigNiveaux(g, 'recompenses', { page: 2 }),
      'exclusions texte': CN.vueConfigNiveaux(g, 'exclusions', { portee: 'texte' }),
      'exclusions vocal': CN.vueConfigNiveaux(g, 'exclusions', { portee: 'vocal' }),
    };
    for (const [nom, vue] of Object.entries(vues)) {
      const s = soucisVue(vue);
      V(`rubrique « ${nom} » dans les limites (5 rangées, 25 options, ids ≤ 100…)`, s.length === 0, s.join(' ; '));
    }
    V('chaque rubrique se convertit en carte (4000 signes, 40 composants)',
      Object.entries(vues).every(([, v]) => enComposants(g, client, v)), Object.entries(vues).filter(([, v]) => !enComposants(g, client, v)).map(([n]) => n).join(', '));
    const suppr = json(vues.recompenses.components[1]).components[0];
    V('30 récompenses : menu de retrait paginé (25 puis 5)', suppr.options.length === 25 && json(vues['recompenses p2'].components[1]).components[0].options.length === 5);
    const exTexte = json(vues['exclusions texte'].components[1]).components[0];
    V('exclusions : le menu reprend les salons déjà exclus', exTexte.default_values?.length === 25 && exTexte.custom_id === 'cfgniv:exsalon:texte');
    for (const nom of ['gains', 'annonce', 'global', 'boost', 'weekend', 'nivmax']) {
      const s = soucisModal(json(CN.formulaireNiveaux(nom, getGuildConfig(g.id))));
      V(`formulaire « ${nom} » : ≤ 5 champs, libellés ≤ 45 signes`, s.length === 0, s.join(' ; '));
    }
    for (const type of Object.keys(L.TYPES_RECOMPENSE_NIVEAU)) {
      const s = soucisModal(json(CN.formulaireNiveaux('rec', {}, { type, valeur: type.startsWith('role') ? R.N2 : type === 'objet' ? 'potion' : null })));
      V(`formulaire de récompense « ${type} » conforme`, s.length === 0, s.join(' ; '));
    }
    V('formulaire de multiplicateur conforme', soucisModal(json(CN.formulaireNiveaux('mult', {}, { guildId: g.id, type: 'role', valeur: R.VIP }))).length === 0);

    // Le menu de catégories mène au tableau de bord.
    let it = fausse(g, { type: 'menu', user: 'staff', customId: 'cfgcat', valeurs: ['xp'] });
    await cfg(it);
    V('/config → XP & niveaux : le tableau de bord', /XP & niveaux/.test(embedDe(it.mises[0]).title || ''));
    it = fausse(g, { type: 'menu', user: 'u1', customId: 'cfgniv:menu', valeurs: ['gains'] });
    await cfg(it);
    V('un membre ne touche pas au panneau', /réservé au \*\*staff\*\*/.test(it.reponses[0]?.content || ''));
    it = fausse(g, { type: 'menu', user: 'staff', customId: 'cfgniv:menu', valeurs: ['gains'] });
    await cfg(it);
    V('menu → rubrique Gains', /Gains/.test(embedDe(it.mises[0]).title || ''));
    it = fausse(g, { type: 'bouton', user: 'staff', customId: 'cfgniv:ouvrir:gains' });
    await cfg(it);
    V('bouton → formulaire des gains (5 champs)', it.modales[0]?.custom_id === 'cfgniv:m:gains' && it.modales[0].components.length === 5);
    it = fausse(g, { type: 'modal', user: 'staff', customId: 'cfgniv:m:gains', champs: { min: '10', max: '30', cooldown: '45', longueur: '5', vocal: '12' } });
    await cfg(it);
    let c = getGuildConfig(g.id);
    V('gains enregistrés : plage 10-30, délai, longueur, vocal SÉPARÉ', c.xp_text_min === 10 && c.xp_text_max === 30 && c.xp_cooldown === 45
      && c.xp_longueur_min === 5 && c.xp_voice === 12 && c.xp_text === 20, texte({ a: c.xp_text_min, b: c.xp_text_max, v: c.xp_voice }));
    V('gains : le panneau est mis à jour et l\'action journalisée', it.mises.length === 1 && SALONS[S.LOGS].envois.some((e) => /Gains/.test(embedDe(e).description || '')));
    it = fausse(g, { type: 'modal', user: 'staff', customId: 'cfgniv:m:gains', champs: { min: '15', max: '15', cooldown: '45', longueur: '0', vocal: '12' } });
    await cfg(it);
    c = getGuildConfig(g.id);
    V('min = max : retour à l\'XP fixe', c.xp_text === 15 && c.xp_text_min === null && c.xp_text_max === null);
    it = fausse(g, { type: 'modal', user: 'staff', customId: 'cfgniv:m:gains', champs: { min: 'abc', max: '15', cooldown: '1', longueur: '0', vocal: '12' } });
    await cfg(it);
    V('valeurs invalides : refus qui explique les bornes', /Valeurs invalides/.test(it.reponses[0]?.content || '') && getGuildConfig(g.id).xp_cooldown === 45);

    it = fausse(g, { type: 'bouton', user: 'staff', customId: 'cfgniv:bascule:xp_vocal_muet' });
    await cfg(it);
    V('bascule vocale : muet autorisé', getGuildConfig(g.id).xp_vocal_muet === 1 && /Vocal/.test(embedDe(it.mises[0]).title || ''));
    it = fausse(g, { type: 'bouton', user: 'staff', customId: 'cfgniv:bascule:level_reset_depart' });
    await cfg(it);
    V('« effacer au départ » réservé à l\'administration', !getGuildConfig(g.id).level_reset_depart && /administration/.test(it.reponses[0]?.content || ''));
    it = fausse(g, { type: 'bouton', user: 'admin', customId: 'cfgniv:bascule:level_reset_depart' });
    await cfg(it);
    V('…accepté pour un admin', getGuildConfig(g.id).level_reset_depart === 1);

    it = fausse(g, { type: 'menu', user: 'staff', customId: 'cfgniv:annmode', valeurs: ['mp'] });
    await cfg(it);
    V('mode d\'annonce : MP', getGuildConfig(g.id).level_annonce === 'mp');
    it = fausse(g, { type: 'menu', user: 'staff', customId: 'cfgniv:annmode', valeurs: ['defaut'] });
    await cfg(it);
    V('mode d\'annonce : automatique (NULL)', getGuildConfig(g.id).level_annonce === null);
    it = fausse(g, { type: 'salon', user: 'staff', customId: 'cfgniv:annsalon', valeurs: [S.NIV] });
    await cfg(it);
    V('salon des annonces réglé', getGuildConfig(g.id).level_channel_id === S.NIV);
    it = fausse(g, { type: 'modal', user: 'staff', customId: 'cfgniv:m:annonce', champs: { message: '🎉 {membre} → {niveau}', pas: '5' } });
    await cfg(it);
    V('message et fréquence enregistrés', getGuildConfig(g.id).level_message === '🎉 {membre} → {niveau}' && getGuildConfig(g.id).level_annonce_pas === 5);
    it = fausse(g, { type: 'bouton', user: 'staff', customId: 'cfgniv:apercu' });
    await cfg(it);
    V('aperçu : éphémère, rendu du modèle, sans notifier personne', it.reponses[0]?.flags === 64 && /<@staff> → 5/.test(embedDe(it.reponses[0]).description || '')
      && texte(it.reponses[0].allowedMentions) === texte({ parse: [] }), texte(it.reponses[0]));

    // Récompenses : ajout d'un rôle en deux étapes, d'un objet, d'un MP ; retrait.
    L.listerRecompensesNiveau(g.id).forEach((r) => L.supprimerRecompenseNiveau(g.id, r.id));
    it = fausse(g, { type: 'menu', user: 'staff', customId: 'cfgniv:recajout', valeurs: ['role'] });
    await cfg(it);
    V('ajout d\'un rôle : étape du choix du rôle', json(it.mises[0]?.components?.[0])?.components?.[0]?.custom_id === 'cfgniv:recrole:role');
    V('étape « rôle » dans les limites Discord', soucisVue(it.mises[0]).length === 0, soucisVue(it.mises[0]).join(' ; '));
    it = fausse(g, { type: 'role', user: 'staff', customId: 'cfgniv:recrole:role', valeurs: [R.HAUT] });
    await cfg(it);
    V('rôle au-dessus du bot : refusé, avec la marche à suivre', /au-dessus de mon rôle/.test(it.reponses[0]?.content || '') && !it.modales.length);
    it = fausse(g, { type: 'role', user: 'staff', customId: 'cfgniv:recrole:role', valeurs: [R.N5] });
    await cfg(it);
    V('rôle valide : formulaire du niveau', it.modales[0]?.custom_id === `cfgniv:m:rec:role:${R.N5}`);
    it = fausse(g, { type: 'modal', user: 'staff', customId: `cfgniv:m:rec:role:${R.N5}`, champs: { niveau: '5' } });
    await cfg(it);
    V('rôle ajouté au niveau 5', L.listerRecompensesNiveau(g.id).some((r) => r.type === 'role' && r.niveau === 5 && r.valeur === R.N5));
    it = fausse(g, { type: 'menu', user: 'staff', customId: 'cfgniv:recajout', valeurs: ['objet'] });
    await cfg(it);
    const menuObjets = json(it.mises[0]?.components?.[0])?.components?.[0];
    V('ajout d\'un objet : le catalogue SAO en menu', menuObjets?.custom_id === 'cfgniv:recobjet' && menuObjets.options.some((o) => o.value === 'potion'));
    V('étape « objet » dans les limites Discord', soucisVue(it.mises[0]).length === 0, soucisVue(it.mises[0]).join(' ; '));
    it = fausse(g, { type: 'menu', user: 'staff', customId: 'cfgniv:recobjet', valeurs: ['cristal'] });
    await cfg(it);
    it = fausse(g, { type: 'modal', user: 'staff', customId: 'cfgniv:m:rec:objet:cristal', champs: { niveau: '10', quantite: '2' } });
    await cfg(it);
    V('objet ajouté au niveau 10 (×2)', L.listerRecompensesNiveau(g.id).some((r) => r.type === 'objet' && r.valeur === 'cristal' && r.quantite === 2));
    it = fausse(g, { type: 'menu', user: 'staff', customId: 'cfgniv:recajout', valeurs: ['mp'] });
    await cfg(it);
    V('ajout d\'un MP : formulaire direct', it.modales[0]?.custom_id === 'cfgniv:m:rec:mp');
    it = fausse(g, { type: 'modal', user: 'staff', customId: 'cfgniv:m:rec:mp', champs: { niveau: '20', texte: 'Bienvenue au niveau {niveau} !' } });
    await cfg(it);
    V('message privé ajouté', L.listerRecompensesNiveau(g.id).some((r) => r.type === 'mp' && r.niveau === 20));
    it = fausse(g, { type: 'modal', user: 'staff', customId: 'cfgniv:m:rec:col', champs: { niveau: '0', quantite: '10' } });
    await cfg(it);
    V('niveau invalide : refus explicite', /niveau va de 1/.test(it.reponses[0]?.content || ''));
    const aRetirer = L.listerRecompensesNiveau(g.id).find((r) => r.type === 'objet');
    it = fausse(g, { type: 'menu', user: 'staff', customId: 'cfgniv:recsuppr:1', valeurs: [String(aRetirer.id)] });
    await cfg(it);
    V('retrait d\'une récompense par le menu', !L.listerRecompensesNiveau(g.id).some((r) => r.id === aRetirer.id)
      && SALONS[S.LOGS].envois.some((e) => /retirée/.test(embedDe(e).title || '')));

    // Exclusions et multiplicateurs par les menus.
    it = fausse(g, { type: 'salon', user: 'staff', customId: 'cfgniv:exsalon:vocal', valeurs: [S.VOC1, S.VOC2] });
    await cfg(it);
    V('exclusions vocales choisies au menu', L.listerExclusionsXp(g.id).filter((e) => e.portee === 'vocal' && e.type === 'salon').length === 2);
    it = fausse(g, { type: 'menu', user: 'staff', customId: 'cfgniv:exportee', valeurs: ['vocal'] });
    await cfg(it);
    V('changer de portée affiche ses salons', json(it.mises[0].components[1]).components[0].default_values?.length === 2);
    it = fausse(g, { type: 'role', user: 'staff', customId: 'cfgniv:multrole', valeurs: [R.VIP] });
    await cfg(it);
    V('multiplicateur de rôle : formulaire', it.modales[0]?.custom_id === `cfgniv:m:mult:role:${R.VIP}`);
    it = fausse(g, { type: 'modal', user: 'staff', customId: `cfgniv:m:mult:role:${R.VIP}`, champs: { pourcent: '175' } });
    await cfg(it);
    V('multiplicateur enregistré… sauf au-delà de 25', /Déjà 25/.test(it.reponses[0]?.content || ''));
    it = fausse(g, { type: 'menu', user: 'staff', customId: 'cfgniv:multsuppr', valeurs: [`salon:${S.BOOSTE}`] });
    await cfg(it);
    it = fausse(g, { type: 'modal', user: 'staff', customId: `cfgniv:m:mult:role:${R.VIP}`, champs: { pourcent: '175' } });
    await cfg(it);
    V('après un retrait, le multiplicateur passe', L.listerMultiplicateursXp(g.id).some((m) => m.cible_id === R.VIP && m.pourcent === 175));
    it = fausse(g, { type: 'modal', user: 'staff', customId: 'cfgniv:m:global', champs: { global: '120', sao: '30' } });
    await cfg(it);
    V('multiplicateur du serveur et part SAO', getGuildConfig(g.id).xp_mult_global === 120 && getGuildConfig(g.id).xp_sao_pourcent === 30);

    // Courbe et niveau max : administration seulement.
    L.addXp(g.id, 'u1', 'admin', 4675);
    it = fausse(g, { type: 'menu', user: 'staff', customId: 'cfgniv:courbe', valeurs: ['douce'] });
    await cfg(it);
    V('courbe : refusée au staff', getGuildConfig(g.id).xp_courbe !== 'douce' && /administration/.test(it.reponses[0]?.content || ''));
    it = fausse(g, { type: 'menu', user: 'admin', customId: 'cfgniv:courbe', valeurs: ['douce'] });
    await cfg(it);
    V('courbe : changée par un admin, niveaux recalculés', getGuildConfig(g.id).xp_courbe === 'douce' && L.getLevels(g.id, 'u1').level > 10);
    it = fausse(g, { type: 'modal', user: 'admin', customId: 'cfgniv:m:nivmax', champs: { max: '8' } });
    await cfg(it);
    V('niveau maximum appliqué tout de suite', getGuildConfig(g.id).xp_niveau_max === 8 && L.getLevels(g.id, 'u1').level === 8);

    // Boost et week-end.
    it = fausse(g, { type: 'modal', user: 'staff', customId: 'cfgniv:m:boost', champs: { pourcent: '100', heures: '24' } });
    await cfg(it);
    c = getGuildConfig(g.id);
    V('boost lancé pour 24 h', c.xp_boost_pourcent === 100 && Math.abs(Date.parse(c.xp_boost_fin) - Date.now() - 24 * 3600_000) < 60_000);
    it = fausse(g, { type: 'bouton', user: 'staff', customId: 'cfgniv:boostfin' });
    await cfg(it);
    V('boost arrêté', getGuildConfig(g.id).xp_boost_pourcent === 0 && getGuildConfig(g.id).xp_boost_fin === null);
    it = fausse(g, { type: 'modal', user: 'staff', customId: 'cfgniv:m:weekend', champs: { pourcent: '25' } });
    await cfg(it);
    V('bonus du week-end', getGuildConfig(g.id).xp_weekend_pourcent === 25);

    // Anciens identifiants.
    it = fausse(g, { type: 'bouton', user: 'staff', customId: 'cfgxp' });
    await cfg(it);
    V('ancien « cfgxp » : ouvre le nouveau formulaire', it.modales[0]?.custom_id === 'cfgniv:m:gains');
    it = fausse(g, { type: 'bouton', user: 'staff', customId: 'cfglvloff' });
    await cfg(it);
    V('ancien « cfglvloff » : coupe les niveaux', getGuildConfig(g.id).levels_enabled === 0);
    it = fausse(g, { type: 'bouton', user: 'staff', customId: 'cfgniv:bascule:levels_enabled' });
    await cfg(it);
    V('bascule : réactive les niveaux', getGuildConfig(g.id).levels_enabled === 1);
    it = fausse(g, { type: 'bouton', user: 'staff', customId: 'cfgrec' });
    await cfg(it);
    V('ancien « cfgrec » : mène aux récompenses', /Récompenses/.test(embedDe(it.mises[0]).title || ''));
    it = fausse(g, { type: 'modal', user: 'staff', customId: 'cfgrecmodal', champs: { level: '3', role: 'Niveau 2' } });
    await cfg(it);
    V('ancien formulaire en vol : expliqué, rien de cassé', /version précédente/.test(it.suivis[0]?.content || ''), texte(it.suivis));
  }

  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})().catch((e) => { console.error(e); console.log('\n0 réussis, 1 échoués'); process.exit(1); });
