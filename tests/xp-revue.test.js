// 🔎 XP & niveaux — les défauts confirmés par la revue contradictoire.
//
// Chaque section rejoue le scénario de la revue, puis vérifie le correctif :
//  1. un gain ne croit le membre du contexte que s'il s'agit de celui qui
//     gagne (le duel SAO donnait les rôles de A à B) ;
//  2. l'exclusion de rôle « tout » vaut pour toutes les sources (jeux,
//     couple, raids), même sans membre dans le contexte ;
//  3. aucun rôle sensible (Administrateur, Bannir…) ne devient récompense,
//     et les récompenses de rôle sont réservées à l'administration ;
//  4. un fond de carte PNG « bombe » est refusé AVANT d'être décodé ;
//  5. exclure une cible dans une deuxième portée fusionne, sans effacer ;
//  6. une courbe plus raide, un niveau maximum abaissé reprennent les rôles ;
//  7. sans « Gérer les rôles » : diagnostic clair, plus d'appel refusé ;
//  8. quitter puis revenir ne reverse ni Col ni objets ;
//  9. mode remplacement : l'ancien palier reste si le nouveau ne peut être posé ;
// 10. une quantité illisible est refusée, jamais changée en 1 ;
// 11. /niveau voir n'attend jamais assez pour partir à l'ancienne ;
// 12. la rubrique 🏅 Récompenses tient dans une carte (1, 13, 50, 100).
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-revue-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

// 💞 Le bonus de couple : un faux, qui note pour QUI on le demande.
const FAUX_COUPLE = {
  appels: [],
  noterActiviteCouple() {},
  bonusXpCouple(g, u, source) { this.appels.push([g, u, source]); return null; },
};

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  if (n === './couple' && /levels\.js$/.test(this.filename || '')) return FAUX_COUPLE;
  return vrai.apply(this, arguments);
};

// Le faux discord.js ne connaît que quelques permissions : on complète avec
// les vraies valeurs de l'API.
const D = require('discord.js');
Object.assign(D.PermissionFlagsBits, {
  KickMembers: 1n << 1n, BanMembers: 1n << 2n, ManageGuild: 1n << 5n, ManageMessages: 1n << 13n,
  MentionEveryone: 1n << 17n, MuteMembers: 1n << 22n, DeafenMembers: 1n << 23n, ManageNicknames: 1n << 27n,
  ManageWebhooks: 1n << 29n, ManageGuildExpressions: 1n << 30n, ManageThreads: 1n << 34n,
});
D.RoleSelectMenuBuilder.prototype.setDefaultRoles ??= function (...v) {
  this.d.default_values = v.flat().map((id) => ({ id, type: 'role' }));
  return this;
};
D.ChannelSelectMenuBuilder.prototype.setDefaultChannels ??= function (...v) {
  this.d.default_values = v.flat().map((id) => ({ id, type: 'channel' }));
  return this;
};
const P = D.PermissionFlagsBits;

const { db, setGuildConfig, getGuildConfig } = require('../src/database');
const L = require('../src/utils/levels');
const CARTE = require('../src/utils/carteNiveau');
const IMG = require('../src/utils/imageAmour');
const SAO = require('../src/utils/saoGame');
const CN = require('../src/utils/configNiveaux');
const C = require('../src/utils/cartes');
const REP = require('../src/utils/reponse');
const { handleConfigInteraction } = require('../src/utils/configPanel');
const IC = require('../src/events/interactionCreate');
const GMR = require('../src/events/guildMemberRemove');
const API = require('../src/managedApi');
const ID = require('../src/utils/identiteBot');

// 🛡️ AUCUN accès réseau réel : le DNS et la requête HTTP du téléchargeur
// public (src/utils/identiteBot.js, I._reseau) sont remplacés, comme dans
// tests/identite-bot.test.js. Une IP écrite en clair ne passe pas par
// `lookup` ; un nom passe par le `lookup` qu'on reçoit — et la « connexion »
// part vers l'adresse qu'il a rendue : c'est elle qu'on note.
const net = require('net');
const DNS = new Map(); // nom → [adresses], ou 'muet' (ne répond jamais)
const WEB = new Map(); // adresse → réponse, ou fonction(u, { signal }) → réponse
const connexions = [];
ID._reseau.lookup = (hote, opts, rappel) => {
  if (typeof opts === 'function') { rappel = opts; opts = {}; }
  const r = DNS.get(hote);
  if (r === 'muet') return; // un DNS qui ne répond jamais
  const liste = (r || ['93.184.216.34']).map((a) => ({ address: a, family: net.isIP(a) }));
  setImmediate(() => (opts?.all ? rappel(null, liste) : rappel(null, liste[0].address, liste[0].family)));
};
ID._reseau.requete = async (u, { lookup, signal } = {}) => {
  const hote = u.hostname.replace(/^\[|\]$/g, '');
  const adresse = net.isIP(hote) ? hote
    : await new Promise((ok, ko) => lookup(hote, { all: true }, (err, liste) => (err ? ko(err) : ok(liste[0].address))));
  connexions.push({ url: u.toString(), adresse });
  const r = WEB.get(u.toString());
  if (!r) throw new Error('hors ligne');
  return typeof r === 'function' ? r(u, { signal }) : r;
};

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };
const texte = (o) => JSON.stringify(o, (k, v) => (Buffer.isBuffer(v) ? `<png ${v.length}>` : typeof v === 'bigint' ? String(v) : v));
const json = (x) => (x && typeof x.toJSON === 'function' ? x.toJSON() : x);
const embedDe = (p) => json(p?.embeds?.[0]) || {};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const logOrig = console.log;
console.warn = () => {};
console.log = ((log) => (...a) => { if (!/^(📊|🏅|🌐)/.test(String(a[0]))) log(...a); })(console.log);
const PAS_DE_RESEAU = async () => { throw new Error('pas de réseau dans les tests'); };
const vraiFetch = globalThis.fetch; // pour parler à l'API locale du bot
global.fetch = PAS_DE_RESEAU;

// ── Faux Discord ────────────────────────────────────────────────────────
const personne = (id, nom) => ({
  id, username: nom, displayName: nom, globalName: nom, bot: false, tag: `${nom}#0`,
  displayAvatarURL: () => `https://cdn.test/${id}.png`, dms: [], async send(m) { this.dms.push(m); return {}; },
});
const USERS = { staff: personne('staff', 'Modo'), admin: personne('admin', 'Chef'), proprio: personne('proprio', 'Proprio') };
for (let i = 1; i <= 12; i++) USERS[`u${i}`] = personne(`u${i}`, `Membre${i}`);

const ROLES = new Map();
// `perms` : les permissions du rôle, comme Role.permissions de discord.js
// (`has(bit, checkAdmin)` : Administrateur vaut tout, sauf checkAdmin=false).
const permissionsDe = (bits) => ({
  has: (bit, checkAdmin = true) => bits.includes(bit) || (checkAdmin && bits.includes(P.Administrator)),
});
const role = (id, name, position, { managed = false, perms = [] } = {}) => {
  ROLES.set(id, { id, name, position, managed, permissions: permissionsDe(perms) });
  return id;
};
const R = {
  BOT: role('100000000000000001', 'LaboBot', 50),
  N2: role('200000000000000002', 'Niveau 2', 10),
  N3: role('200000000000000003', 'Niveau 3', 11),
  N5: role('200000000000000005', 'Niveau 5', 12),
  N10: role('200000000000000010', 'Niveau 10', 13),
  HAUT: role('300000000000000001', 'Trop haut', 60),
  VIP: role('400000000000000001', 'VIP', 20),
  MUET: role('400000000000000003', 'Sanctionné', 2),
  ADMINS: role('500000000000000001', 'Administrateurs', 40, { perms: [P.Administrator] }),
  MODOS: role('500000000000000002', 'Modération', 39, { perms: [P.ModerateMembers, P.ViewChannel] }),
  BANNIR: role('500000000000000003', 'Videurs', 38, { perms: [P.BanMembers] }),
  STAFFBOT: role('500000000000000004', 'Staff du bot', 37),
  SIMPLE: role('500000000000000005', 'Habitué', 21, { perms: [P.ViewChannel] }),
};
const DISPARU = '999999999999999999';

let compteur = 0;
const SALONS = {};
const salonNomme = (id) => {
  const s = { id, parentId: null, type: 0, envois: [], isTextBased: () => true, messages: { fetch: async () => null } };
  s.send = async (p) => { s.envois.push(p); return { id: `M${++compteur}`, ...p }; };
  SALONS[id] = s;
  return id;
};
const S = { GEN: salonNomme('600000000000000001'), LOGS: salonNomme('600000000000000003'), VOC: salonNomme('600000000000000006') };

const client = {
  user: { id: 'bot', username: 'LaboBot', displayAvatarURL: () => null },
  commands: new Map([['niveau', require('../src/commands/niveau')], ['xp', require('../src/commands/xp')]]),
  users: { fetch: async (id) => USERS[id] || null, cache: new Map() },
  channels: { fetch: async (id) => SALONS[id] || null },
  guilds: { cache: new Map() },
  isReady: () => true,
};

function fabriquerServeur(id) {
  const g = {
    id, name: `Serveur ${id}`, ownerId: 'proprio', afkChannelId: null, iconURL: () => null, client, journal: [], refuses: new Set(),
    roles: { cache: ROLES, fetch: async (rid) => ROLES.get(rid) || null },
    channels: { cache: new Map(Object.entries(SALONS)), fetch: async (cid) => SALONS[cid] || null },
    voiceStates: { cache: new Map() },
    connus: new Map(),
    members: {
      cache: new Map(),
      me: { id: 'bot', displayName: 'LaboBot', roles: { highest: ROLES.get(R.BOT), cache: new Map() }, permissions: permissionsDe([P.Administrator]) },
      async fetch(arg) {
        if (arg === undefined) return g.members.cache;
        if (typeof arg === 'string') {
          const m = g.connus.get(arg);
          if (!m) throw new Error('Unknown Member');
          return m;
        }
        return null;
      },
    },
  };
  client.guilds.cache.set(id, g);
  return g;
}
// `g.refuses` : les rôles que Discord refuse (403) — un appel est noté quand même.
function ajouterMembre(g, uid, roleIds = [], { staff = false, admin = false, enCache = true } = {}) {
  const cache = new Map(roleIds.map((r) => [r, ROLES.get(r)]));
  const m = {
    id: uid, user: USERS[uid], displayName: USERS[uid].displayName, guild: g,
    roles: {
      cache,
      async add(r) {
        g.journal.push(`+${uid}:${r.name}`);
        if (g.refuses.has(r.id)) throw new Error('Missing Permissions');
        cache.set(r.id, r);
      },
      async remove(r) {
        g.journal.push(`-${uid}:${r.name}`);
        if (g.refuses.has(r.id)) throw new Error('Missing Permissions');
        cache.delete(r.id);
      },
    },
    permissions: {
      has: (bit) => (bit === P.Administrator ? admin : bit === P.ModerateMembers ? staff || admin : false),
    },
  };
  g.connus.set(uid, m);
  if (enCache) g.members.cache.set(uid, m);
  return m;
}

function fausse(g, { type = 'commande', user = 'u1', nom = null, sub = null, options = {}, customId = null, champs = {}, valeurs = [], carte = false } = {}) {
  const composant = ['bouton', 'menu', 'role', 'salon'].includes(type);
  return {
    client, guild: g, guildId: g.id, channelId: S.GEN, channel: SALONS[S.GEN], locale: 'fr',
    user: USERS[user], member: g.members.cache.get(user) || g.connus.get(user), commandName: nom, customId, values: valeurs,
    deferred: false, replied: false, appels: [],
    message: { id: 'MSG', flags: carte ? C.DRAPEAU_V2 : 0, components: [], embeds: [{}], createdTimestamp: Date.now() },
    inGuild: () => true, isAutocomplete: () => false,
    isChatInputCommand: () => type === 'commande', isButton: () => type === 'bouton',
    isModalSubmit: () => type === 'modal', isFromMessage: () => type === 'modal',
    isMessageComponent: () => composant, isStringSelectMenu: () => type === 'menu', isRoleSelectMenu: () => type === 'role',
    isChannelSelectMenu: () => type === 'salon', isUserSelectMenu: () => false, isAnySelectMenu: () => ['menu', 'role', 'salon'].includes(type),
    options: {
      getSubcommand: () => sub, getString: (k) => options[k] ?? null, getInteger: (k) => options[k] ?? null,
      getBoolean: (k) => options[k] ?? null, getUser: (k) => (options[k] ? USERS[options[k]] : null),
    },
    fields: { getTextInputValue: (k) => champs[k] ?? '' },
    reponses: [], suivis: [], mises: [], modales: [],
    async reply(p) { this.appels.push('reply'); this.replied = true; this.reponses.push(p); return p; },
    async deferReply() { this.appels.push('deferReply'); this.deferred = true; },
    async editReply(p) { this.appels.push('editReply'); this.reponses.push(p); return p; },
    async followUp(p) { this.appels.push('followUp'); this.suivis.push(p); return p; },
    // Comme Discord : une carte de plus de 40 composants est refusée.
    async update(p) {
      this.appels.push('update');
      if (p.flags === C.DRAPEAU_V2 && C.compter(p.components) > C.MAX_COMPOSANTS) throw new Error('BASE_TYPE_MAX_LENGTH (40)');
      this.replied = true;
      this.mises.push(p);
      return p;
    },
    async deferUpdate() { this.appels.push('deferUpdate'); this.deferred = true; },
    async showModal(m) { this.modales.push(json(m)); },
  };
}
const cfgPanneau = (it) => handleConfigInteraction(it);
const contenu = (it) => String(it.reponses[0]?.content || it.suivis[0]?.content || '');

// ── Faux saoGame (contrat A) : une bourse et un sac ─────────────────────
const BOURSE = new Map();
SAO.OBJETS = { potion: { nom: 'Potion de soin', emoji: '🧪' } };
SAO.crediterCol = (g, u, montant) => { const k = `${g}:${u}`; BOURSE.set(k, (BOURSE.get(k) || 0) + montant); return BOURSE.get(k); };
SAO.donnerObjet = (g, u, cle) => Boolean(SAO.OBJETS[cle]);
SAO.objetsRecompensables = () => Object.entries(SAO.OBJETS).map(([cle, o]) => ({ cle, nom: o.nom, emoji: o.emoji }));

// ── PNG fabriqués à la main ─────────────────────────────────────────────
function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function blocPng(nom, data) {
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
  const t = Buffer.from(nom, 'ascii');
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([l, t, data, c]);
}
function pngBrut(largeur, hauteur, idat) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0); ihdr.writeUInt32BE(hauteur, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), blocPng('IHDR', ihdr), blocPng('IDAT', idat), blocPng('IEND', Buffer.alloc(0))]);
}
// Une réponse HTTP au format du téléchargeur public : corps lu en flux.
function reponseHttp(corps, { taille = null, morceau = 64 * 1024, status = 200, entetes = {} } = {}) {
  const lecture = { morceaux: 0, annule: false };
  return {
    lecture,
    status,
    entetes: { 'content-type': 'image/png', ...(taille !== null ? { 'content-length': String(taille) } : {}), ...entetes },
    corps: (async function* flux() {
      for (let pos = 0; pos < corps.length; pos += morceau) {
        if (lecture.annule) return;
        lecture.morceaux++;
        yield corps.subarray(pos, pos + morceau);
      }
    })(),
    fermer() { lecture.annule = true; },
  };
}

(async () => {
  console.log('\n1) Le membre du contexte n\'est cru que s\'il est celui qui gagne');
  {
    const g = fabriquerServeur('R1');
    setGuildConfig(g.id, 'levels_enabled', 1);
    L.ajouterRecompenseNiveau(g.id, { niveau: 5, type: 'role', valeur: R.N5 });
    L.ajouterRecompenseNiveau(g.id, { niveau: 10, type: 'role', valeur: R.N10 });
    const A = ajouterMembre(g, 'u1');
    const B = ajouterMembre(g, 'u2', [R.VIP]);
    L.addXp(g.id, 'u1', 'admin', L.totalXpForLevel(12)); // A : niveau 12, sans ses rôles
    // Le duel SAO : B clique « accepter », A gagne — le contexte porte B.
    await L.gagnerXpServeur(g, 'u1', 'sao', 10, { membre: B, salon: SALONS[S.GEN] });
    V('les rôles de palier de A ne partent PAS chez B', !B.roles.cache.has(R.N5) && !B.roles.cache.has(R.N10), g.journal.join(' '));
    V('… ils vont à A, le vrai gagnant', A.roles.cache.has(R.N5) && A.roles.cache.has(R.N10), g.journal.join(' '));
    V('… et B reste au niveau 0', L.getLevels(g.id, 'u2').xp === 0);

    // Exclusions, multiplicateurs et couple : ceux de A, jamais ceux de B.
    L.remplacerExclusionsXp(g.id, 'role', 'tout', [R.MUET]);
    L.definirMultiplicateurXp(g.id, 'role', R.VIP, 300);
    B.roles.cache.set(R.MUET, ROLES.get(R.MUET));
    let avant = L.getLevels(g.id, 'u1').xp;
    let r = await L.gagnerXpServeur(g, 'u1', 'sao', 10, { membre: B });
    V('l\'exclusion de B ne prive pas A', r.gagne === 10 && L.getLevels(g.id, 'u1').xp === avant + 10, texte(r));
    V('le multiplicateur de B (×3) ne gonfle pas le gain de A', r.gagne === 10);
    FAUX_COUPLE.appels.length = 0;
    await L.gagnerXpServeur(g, 'u1', 'jeux', 5, { membre: B });
    V('le bonus de couple est demandé pour A, pas pour B', FAUX_COUPLE.appels.length > 0 && FAUX_COUPLE.appels.every((a) => a[1] === 'u1'), texte(FAUX_COUPLE.appels));
    B.roles.cache.delete(R.MUET);
    A.roles.cache.set(R.MUET, ROLES.get(R.MUET));
    avant = L.getLevels(g.id, 'u1').xp;
    r = await L.gagnerXpServeur(g, 'u1', 'sao', 10, { membre: B });
    V('… et l\'exclusion de A s\'applique, même si le contexte porte B', r.gagne === 0 && L.getLevels(g.id, 'u1').xp === avant, texte(r));
    A.roles.cache.delete(R.MUET);
    const direct = L.addXp(g.id, 'u1', 'jeux', 10, { membre: B });
    V('addXp seul ignore aussi un membre qui n\'est pas le bon', direct.gagne === 10, texte(direct));

    // appliquerRecompenses lui-même ne croit pas un membre étranger.
    const C3 = ajouterMembre(g, 'u3');
    L.addXp(g.id, 'u3', 'admin', L.totalXpForLevel(6));
    await L.appliquerRecompenses(g, 'u3', 6, { membre: B, synchro: true });
    V('appliquerRecompenses : les rôles vont au bon membre', C3.roles.cache.has(R.N5) && !B.roles.cache.has(R.N5), g.journal.join(' '));
  }

  console.log('\n2) Exclusion de rôle « tout » : toutes les sources, même sans membre dans le contexte');
  {
    const g = fabriquerServeur('R2');
    setGuildConfig(g.id, 'levels_enabled', 1);
    ajouterMembre(g, 'u1', [R.MUET]);
    L.remplacerExclusionsXp(g.id, 'role', 'tout', [R.MUET]);
    const gains = {};
    gains.jeux = (await L.gagnerXpServeur(g, 'u1', 'jeux', 20, { salon: SALONS[S.GEN] })).gagne; // verserXpJeu
    gains.couple = (await L.gagnerXpServeur(g, 'u1', 'couple', 30)).gagne; // xpDeCouple, sans contexte
    gains.raid = (await L.gagnerXpServeur(g, 'u1', 'sao', 25, { salon: SALONS[S.GEN] })).gagne; // participants d'un raid
    gains.texte = (await L.gagnerXpServeur(g, 'u1', 'text', 15, { membre: g.members.cache.get('u1') })).gagne;
    V('mini-jeux, couple, raids, écrit : 0 XP pour le rôle exclu', Object.values(gains).every((x) => x === 0) && L.getLevels(g.id, 'u1').xp === 0, texte(gains));
    V('le staff, lui, peut toujours en donner', (await L.gagnerXpServeur(g, 'u1', 'admin', 40)).gagne === 40);
    // Un multiplicateur de rôle à 0 % est respecté de la même façon.
    L.remplacerExclusionsXp(g.id, 'role', 'tout', []);
    L.definirMultiplicateurXp(g.id, 'role', R.MUET, 0);
    V('multiplicateur de rôle à 0 % : respecté par les mini-jeux', (await L.gagnerXpServeur(g, 'u1', 'jeux', 20, { salon: SALONS[S.GEN] })).gagne === 0);
  }

  console.log('\n3) Rôles sensibles : jamais en récompense, et réservés à l\'administration');
  {
    const g = fabriquerServeur('R3');
    setGuildConfig(g.id, 'levels_enabled', 1);
    setGuildConfig(g.id, 'log_channel_id', S.LOGS);
    setGuildConfig(g.id, 'staff_role_ids', JSON.stringify([R.STAFFBOT]));
    ajouterMembre(g, 'staff', [], { staff: true });
    ajouterMembre(g, 'admin', [], { admin: true });
    ajouterMembre(g, 'proprio', [], { admin: true });
    const risque = (id) => L.risqueRoleNiveau(g, ROLES.get(id));
    V('Administrateur, Modérer, Bannir : sensibles', /Administrateur/.test(risque(R.ADMINS) || '') && /Exclure temporairement/.test(risque(R.MODOS) || '')
      && /Bannir/.test(risque(R.BANNIR) || ''), texte([risque(R.ADMINS), risque(R.MODOS), risque(R.BANNIR)]));
    V('un rôle staff du bot (configuré) : sensible', /staff du bot/.test(risque(R.STAFFBOT) || ''));
    V('un rôle sans pouvoir : accepté', risque(R.SIMPLE) === null && risque(R.N5) === null);

    // Le scénario de la revue : un staff (Modérer les membres) seulement.
    let it = fausse(g, { type: 'menu', user: 'staff', customId: 'cfgniv:recajout', valeurs: ['role'] });
    await cfgPanneau(it);
    V('staff : « ajouter un rôle » refusé, réservé à l\'administration', !it.mises.length && /administration/.test(contenu(it)), contenu(it));
    it = fausse(g, { type: 'menu', user: 'staff', customId: 'cfgniv:recajout', valeurs: ['role_retrait'] });
    await cfgPanneau(it);
    V('staff : « retirer un rôle » refusé aussi', !it.mises.length && /administration/.test(contenu(it)));
    it = fausse(g, { type: 'role', user: 'staff', customId: 'cfgniv:recrole:role', valeurs: [R.ADMINS] });
    await cfgPanneau(it);
    V('staff : le choix du rôle Administrateurs n\'ouvre aucun formulaire', !it.modales.length && /administration/.test(contenu(it)));
    it = fausse(g, { type: 'modal', user: 'staff', customId: `cfgniv:m:rec:role:${R.SIMPLE}`, champs: { niveau: '1' } });
    await cfgPanneau(it);
    V('staff : un formulaire forgé est refusé à l\'envoi', !L.listerRecompensesNiveau(g.id).length && /administration/.test(contenu(it)), contenu(it));
    it = fausse(g, { type: 'menu', user: 'staff', customId: 'cfgniv:recajout', valeurs: ['col'] });
    await cfgPanneau(it);
    V('staff : le Col reste ouvert', it.modales[0]?.custom_id === 'cfgniv:m:rec:col');

    // Un admin : les rôles sensibles restent refusés.
    for (const [id, motif] of [[R.ADMINS, /Administrateur/], [R.MODOS, /Exclure temporairement/], [R.STAFFBOT, /staff du bot/]]) {
      it = fausse(g, { type: 'role', user: 'admin', customId: 'cfgniv:recrole:role', valeurs: [id] });
      await cfgPanneau(it);
      V(`admin : « ${ROLES.get(id).name} » refusé, avec la raison`, !it.modales.length && motif.test(contenu(it)) && /permission sensible/.test(contenu(it)), contenu(it));
    }
    it = fausse(g, { type: 'role', user: 'admin', customId: 'cfgniv:recrole:role_retrait', valeurs: [R.ADMINS] });
    await cfgPanneau(it);
    V('admin : retirer le rôle Administrateurs à un palier, refusé aussi', !it.modales.length && /Administrateur/.test(contenu(it)));
    it = fausse(g, { type: 'modal', user: 'admin', customId: `cfgniv:m:rec:role:${R.BANNIR}`, champs: { niveau: '1' } });
    await cfgPanneau(it);
    V('admin : formulaire forgé avec un rôle sensible, refusé à l\'envoi', !L.listerRecompensesNiveau(g.id).length && /Bannir/.test(contenu(it)), contenu(it));
    // Comme Discord : pas au-dessus de son propre plus haut rôle.
    g.members.cache.get('admin').roles.highest = { position: 15 };
    it = fausse(g, { type: 'role', user: 'admin', customId: 'cfgniv:recrole:role', valeurs: [R.SIMPLE] });
    await cfgPanneau(it);
    V('admin : un rôle au-dessus du sien est refusé', !it.modales.length && /plus haut rôle/.test(contenu(it)), contenu(it));
    it = fausse(g, { type: 'role', user: 'proprio', customId: 'cfgniv:recrole:role', valeurs: [R.SIMPLE] });
    await cfgPanneau(it);
    V('… le propriétaire du serveur, lui, peut', it.modales[0]?.custom_id === `cfgniv:m:rec:role:${R.SIMPLE}`, contenu(it));
    delete g.members.cache.get('admin').roles.highest;
    it = fausse(g, { type: 'modal', user: 'admin', customId: `cfgniv:m:rec:role:${R.SIMPLE}`, champs: { niveau: '2' } });
    await cfgPanneau(it);
    V('admin : un rôle sans pouvoir est ajouté', L.listerRecompensesNiveau(g.id).some((r) => r.valeur === R.SIMPLE && r.niveau === 2), contenu(it));

    // Des récompenses sensibles DÉJÀ enregistrées (avant le correctif).
    db.prepare("INSERT INTO niveau_recompenses (guild_id, niveau, type, valeur, quantite) VALUES (?, 1, 'role', ?, 1), (?, 1, 'role_retrait', ?, 1)")
      .run(g.id, R.ADMINS, g.id, R.MODOS);
    const diag = L.diagnostiquerRecompenses(g);
    V('diagnostic : les récompenses sensibles déjà posées sont signalées',
      /sensible.*Administrateur/.test(diag.find((x) => x.valeur === R.ADMINS)?.souci || '') && /sensible/.test(diag.find((x) => x.valeur === R.MODOS)?.souci || ''), texte(diag));
    const membre = ajouterMembre(g, 'u1', [R.MODOS]);
    await L.gagnerXpServeur(g, 'u1', 'admin', L.totalXpForLevel(3), { membre });
    V('… et elles ne sont plus appliquées : pas de rôle Administrateurs donné', !membre.roles.cache.has(R.ADMINS) && membre.roles.cache.has(R.SIMPLE), g.journal.join(' '));
    V('… ni de rôle de modération retiré', membre.roles.cache.has(R.MODOS));
    V('… et rien n\'est relancé à chaque gain', !L.recompensesEnAttente(g, membre, 3));
    V('journal Discord : aucun appel sur un rôle sensible', !g.journal.some((j) => /Administrateurs|Modération/.test(j)), g.journal.join(' '));

    // Le tableau de bord : même refus.
    const vu = new Map([['R3', g]]);
    client.guilds.cache = vu;
    console.log = () => {};
    API.startManagedApi(client, RACINE);
    const fichierPort = path.join(RACINE, 'api.port');
    for (let k = 0; k < 100 && !fs.existsSync(fichierPort); k++) await attendre(20);
    console.log = ((log) => (...a) => { if (!/^(📊|🏅|🌐)/.test(String(a[0]))) log(...a); })(logOrig);
    const port = fs.readFileSync(fichierPort, 'utf8');
    const post = async (route, body) => {
      const r = await fetch(`http://127.0.0.1:${port}/${route}`, { method: 'POST', body: JSON.stringify(body) });
      return { code: r.status, ...(await r.json()) };
    };
    global.fetch = vraiFetch;
    let rep = await post('niveau-recompenses', { guildId: 'R3', niveau: 4, type: 'role', valeur: R.ADMINS });
    V('tableau de bord : rôle Administrateurs refusé (400), avec la raison', rep.code === 400 && /Administrateur/.test(rep.error || ''), texte(rep));
    rep = await post('niveau-recompenses', { guildId: 'R3', niveau: 4, type: 'role_retrait', valeur: R.BANNIR });
    V('tableau de bord : retrait d\'un rôle Bannir refusé aussi', rep.code === 400 && /Bannir/.test(rep.error || ''), texte(rep));
    rep = await post('niveau-recompenses', { guildId: 'R3', niveau: 4, type: 'role', valeur: R.N5 });
    V('tableau de bord : un rôle sans pouvoir passe', rep.code === 200, texte(rep));
    // Exclusions par le tableau de bord : écrit puis vocal → tout.
    rep = await post('xp-exclusions', { guildId: 'R3', type: 'role', cibleId: R.VIP, portee: 'texte' });
    rep = await post('xp-exclusions', { guildId: 'R3', type: 'role', cibleId: R.VIP, portee: 'vocal' });
    V('tableau de bord : écrit puis vocal → « tout », et la réponse le dit', rep.code === 200
      && rep.exclusionsXp.some((e) => e.cible_id === R.VIP && e.portee === 'tout') && /tout/.test(rep.note || ''), texte(rep));
    global.fetch = PAS_DE_RESEAU;
    client.guilds.cache = new Map();
  }

  console.log('\n4) Fond de carte : un PNG piégé est refusé AVANT d\'être décodé');
  {
    // Une bombe : en-tête 64 × 64 (sous toutes les bornes), données qui se
    // décompressent en 48 Mo de zéros au lieu de 16 640 octets.
    const bombe = pngBrut(64, 64, zlib.deflateSync(Buffer.alloc(48 * 1024 * 1024), { level: 9 }));
    const vraiInflate = zlib.inflateSync;
    let sortieMax = 0;
    zlib.inflateSync = (...a) => { try { const o = vraiInflate(...a); sortieMax = Math.max(sortieMax, o.length); return o; } catch (e) { throw e; } };
    let t0 = Date.now();
    V('bombe : refusée', CARTE.pngSansDanger(bombe) === false, `${bombe.length} octets`);
    V('… en un éclair, sans rien allouer au-delà de l\'image annoncée', Date.now() - t0 < 300 && sortieMax <= (64 * 4 + 1) * 64, `${Date.now() - t0} ms, ${sortieMax} octets`);
    let appelsInflate = 0;
    zlib.inflateSync = (...a) => { appelsInflate++; return vraiInflate(...a); };
    const geant = pngBrut(4096, 4096, zlib.deflateSync(Buffer.alloc(16)));
    V('4096 × 4096 annoncé : refusé sur l\'en-tête, sans rien décompresser', CARTE.pngSansDanger(geant) === false && appelsInflate === 0, `inflate ×${appelsInflate}`);
    zlib.inflateSync = vraiInflate;
    const toile = new IMG.Toile(120, 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 120; x++) toile.poser(x, y, [0, 200, 0]);
    const honnete = toile.png();
    V('une image honnête passe', CARTE.pngSansDanger(honnete) === true);

    // Par le réseau : poids annoncé, poids compté, contenu piégé.
    const servir = (url, rep) => { WEB.set(url, () => rep); return rep; };
    let rep = servir('https://x.test/lourd.png', reponseHttp(Buffer.alloc(9 * 1024 * 1024), { taille: 9 * 1024 * 1024 }));
    V('9 Mo annoncés : refusé sans rien lire', (await CARTE.telechargerPngNiveau('https://x.test/lourd.png')) === null && rep.lecture.morceaux === 0, texte(rep.lecture));
    rep = servir('https://x.test/sans-taille.png', reponseHttp(Buffer.alloc(12 * 1024 * 1024), { morceau: 1024 * 1024 }));
    V('poids non annoncé : la lecture s\'arrête au-delà de 8 Mo', (await CARTE.telechargerPngNiveau('https://x.test/sans-taille.png')) === null
      && rep.lecture.annule && rep.lecture.morceaux <= 9, texte(rep.lecture));
    servir('https://x.test/bombe.png', reponseHttp(bombe));
    t0 = Date.now();
    V('bombe servie en ligne : refusée', (await CARTE.telechargerPngNiveau('https://x.test/bombe.png')) === null && Date.now() - t0 < 500);
    WEB.set('https://x.test/ok.png', () => reponseHttp(honnete));
    const lue = await CARTE.telechargerPngNiveau('https://x.test/ok.png');
    V('une image honnête est lue', lue?.largeur === 120 && lue?.hauteur === 40);
    WEB.set('https://x.test/absent.png', () => reponseHttp(Buffer.from('introuvable'), { status: 404, entetes: { 'content-type': 'text/html' } }));
    V('une page 404 : rien', (await CARTE.telechargerPngNiveau('https://x.test/absent.png')) === null);

    // Le fond est gardé prêt : ni retéléchargé, ni redécodé.
    let telechargements = 0;
    WEB.set('https://x.test/fond-ok.png', () => { telechargements++; return reponseHttp(honnete); });
    WEB.set('https://x.test/fond-mort.png', () => { telechargements++; throw new Error('hors ligne'); });
    const plan = CARTE.planCarteNiveau({ pseudo: 'X', niveau: 3, courant: 1, requis: 2, total: 9 });
    const a = await CARTE.fabriquerCarteNiveau(plan, USERS.u1, 'https://x.test/fond-ok.png');
    const b = await CARTE.fabriquerCarteNiveau(plan, USERS.u1, 'https://x.test/fond-ok.png');
    V('fond lu une fois, servi depuis la mémoire ensuite', a.fondLu && b.fondLu && telechargements === 1, `${telechargements} téléchargement(s)`);
    const px = IMG.decoderPng(b.png);
    const i = (280 * 900 + 870) * 4;
    V('… et toujours dessiné (vert sous le voile)', px.rgba[i + 1] > px.rgba[i], texte([px.rgba[i], px.rgba[i + 1]]));
    telechargements = 0;
    await CARTE.fabriquerCarteNiveau(plan, USERS.u1, 'https://x.test/fond-mort.png');
    await CARTE.fabriquerCarteNiveau(plan, USERS.u1, 'https://x.test/fond-mort.png');
    V('un fond en échec n\'est pas retenté à chaque fiche', telechargements === 1, `${telechargements} téléchargement(s)`);
    await CARTE.fondNiveau('https://x.test/fond-mort.png', { rafraichir: true });
    V('… sauf par /niveau image, qui vérifie l\'adresse qu\'on vient de poser', telechargements === 2);
  }

  console.log('\n4 bis) Fond de carte : jamais une adresse interne (SSRF), même derrière un nom ou une redirection');
  {
    const toile = new IMG.Toile(8, 8);
    const png = toile.png();
    DNS.set('interne.test', ['10.20.30.40']);
    DNS.set('metadonnees.test', ['169.254.169.254']);
    DNS.set('melange.test', ['93.184.216.34', '127.0.0.1']);
    DNS.set('v6interne.test', ['::ffff:192.168.1.10']);
    WEB.set('https://redirige.test/fond.png', () => reponseHttp(Buffer.alloc(0), { status: 302, entetes: { location: 'https://127.0.0.1/fond.png' } }));
    WEB.set('https://redirige-nom.test/fond.png', () => reponseHttp(Buffer.alloc(0), { status: 302, entetes: { location: 'https://interne.test/fond.png' } }));
    // Si une connexion partait quand même, elle trouverait une vraie image —
    // par le téléchargeur public comme par un `fetch` direct (l'ancien
    // chemin) : un refus ne peut donc venir QUE du filtre.
    global.fetch = async () => new Response(png, { headers: { 'content-type': 'image/png' } });
    for (const url of ['https://127.0.0.1/fond.png', 'https://[::1]/fond.png', 'https://169.254.169.254/fond.png', 'https://10.0.0.1/fond.png',
      'https://interne.test/fond.png', 'https://metadonnees.test/fond.png', 'https://melange.test/fond.png', 'https://v6interne.test/fond.png',
      'https://public.test:8443/fond.png']) WEB.set(url, () => reponseHttp(png));
    const cas = [
      ['https://127.0.0.1/fond.png', 'IP de bouclage écrite en clair'],
      ['https://[::1]/fond.png', 'IPv6 de bouclage'],
      ['https://169.254.169.254/fond.png', 'métadonnées du cloud'],
      ['https://10.0.0.1/fond.png', 'réseau privé'],
      ['https://interne.test/fond.png', 'un nom qui résout en 10.x'],
      ['https://metadonnees.test/fond.png', 'un nom vers 169.254.169.254'],
      ['https://melange.test/fond.png', 'un nom dont UNE adresse est 127.0.0.1'],
      ['https://v6interne.test/fond.png', 'un nom vers ::ffff:192.168.x'],
      ['https://public.test:8443/fond.png', 'un port particulier'],
      ['https://redirige.test/fond.png', 'une redirection vers 127.0.0.1'],
      ['https://redirige-nom.test/fond.png', 'une redirection vers un nom interne'],
    ];
    for (const [url, quoi] of cas) {
      const avant = connexions.length;
      const image = await CARTE.telechargerPngNiveau(url);
      const internes = connexions.slice(avant).filter((c) => ID.adresseInterdite(c.adresse));
      V(`${quoi} : refusé, aucune connexion interne`, image === null && internes.length === 0, texte(connexions.slice(avant)));
    }
    WEB.set('https://public.test/fond.png', () => reponseHttp(png));
    V('une adresse publique, elle, passe', (await CARTE.telechargerPngNiveau('https://public.test/fond.png'))?.largeur === 8);
    WEB.set('https://redirige-public.test/fond.png', () => reponseHttp(Buffer.alloc(0), { status: 301, entetes: { location: 'https://public.test/fond.png' } }));
    V('… et une redirection vers une adresse publique aussi', (await CARTE.telechargerPngNiveau('https://redirige-public.test/fond.png'))?.largeur === 8);

    // Par la commande : /niveau image avec une adresse interne.
    const g = fabriquerServeur('R4s');
    ajouterMembre(g, 'staff', [], { staff: true });
    const avant = connexions.length;
    const it = fausse(g, { user: 'staff', nom: 'niveau', sub: 'image', options: { url: 'https://interne.test/fond.png' } });
    await IC.execute(it);
    V('/niveau image vers une adresse interne : « pas pu la lire », aucune connexion', /pas pu la lire/.test(contenu(it))
      && !connexions.slice(avant).some((c) => ID.adresseInterdite(c.adresse)), contenu(it));
    const carte = await CARTE.fabriquerCarteNiveau(CARTE.planCarteNiveau({ pseudo: 'X' }), USERS.u1, 'https://metadonnees.test/fond.png');
    V('/niveau voir avec ce fond : la carte part, sans le fond', Buffer.isBuffer(carte.png) && carte.fondLu === false);

    // Le budget de temps couvre aussi la résolution du nom.
    DNS.set('dns-muet.test', 'muet');
    const t0 = Date.now();
    V('un DNS qui ne répond jamais : abandon au bout du délai', (await CARTE.telechargerPngNiveau('https://dns-muet.test/fond.png', 300)) === null && Date.now() - t0 < 800,
      `${Date.now() - t0} ms`);
    global.fetch = PAS_DE_RESEAU;
  }

  console.log('\n5) Exclusions : une deuxième portée fusionne, elle n\'efface pas');
  {
    const g = fabriquerServeur('R5');
    setGuildConfig(g.id, 'levels_enabled', 1);
    setGuildConfig(g.id, 'log_channel_id', S.LOGS);
    ajouterMembre(g, 'staff', [], { staff: true });
    let r = L.remplacerExclusionsXp(g.id, 'role', 'texte', [R.MUET]);
    r = L.remplacerExclusionsXp(g.id, 'role', 'vocal', [R.MUET]);
    const membre = { id: 'u1', roles: { cache: new Map([[R.MUET, {}]]) } };
    V('écrit puis vocal : la cible passe en « tout »', L.listerExclusionsXp(g.id).find((e) => e.cible_id === R.MUET)?.portee === 'tout', texte(L.listerExclusionsXp(g.id)));
    V('… exclue à l\'écrit ET en vocal', L.estExcluXp(g.id, 'text', { membre }) && L.estExcluXp(g.id, 'voice', { membre }));
    V('… et la fusion est rendue, pas cachée', r.ajoutes === 0 && r.fusions.length === 1 && r.fusions[0].avant === 'texte' && r.fusions[0].apres === 'tout', texte(r));
    r = L.remplacerExclusionsXp(g.id, 'role', 'vocal', []);
    V('vider la liste vocale ne retire pas une cible passée en « tout »', L.estExcluXp(g.id, 'text', { membre }) && r.retires === 0);
    r = L.remplacerExclusionsXp(g.id, 'role', 'texte', [R.MUET]);
    V('une cible déjà en « tout » y reste (cochée à l\'écrit)', L.listerExclusionsXp(g.id).find((e) => e.cible_id === R.MUET)?.portee === 'tout'
      && r.fusions[0]?.avant === 'tout' && r.fusions[0]?.apres === 'tout', texte(r));
    // « Tout » plein : on ne touche à rien, et on le dit.
    L.remplacerExclusionsXp(g.id, 'role', 'tout', Array.from({ length: 25 }, (_, i) => `7100000000000000${String(i).padStart(2, '0')}`));
    L.remplacerExclusionsXp(g.id, 'role', 'texte', [R.VIP]);
    r = L.remplacerExclusionsXp(g.id, 'role', 'vocal', [R.VIP]);
    V('« tout » plein (25) : la cible reste à l\'écrit, signalée', L.listerExclusionsXp(g.id).find((e) => e.cible_id === R.VIP)?.portee === 'texte'
      && r.fusions[0]?.apres === 'texte' && L.listerExclusionsXp(g.id).filter((e) => e.portee === 'tout').length === 25, texte(r));
    L.remplacerExclusionsXp(g.id, 'role', 'tout', []);
    L.remplacerExclusionsXp(g.id, 'role', 'texte', []);

    // Par /config : le panneau et le journal le disent.
    let it = fausse(g, { type: 'role', user: 'staff', customId: 'cfgniv:exrole:texte', valeurs: [R.VIP] });
    await cfgPanneau(it);
    it = fausse(g, { type: 'role', user: 'staff', customId: 'cfgniv:exrole:vocal', valeurs: [R.VIP] });
    await cfgPanneau(it);
    const d = embedDe(it.mises[0]).description || '';
    V('/config : le panneau dit que la cible passe en Tout', new RegExp(`<@&${R.VIP}> était déjà exclu en \\*\\*✍️ Écrit\\*\\* : il passe en \\*\\*🌐 Tout\\*\\*`).test(d), d.slice(0, 300));
    const journal = SALONS[S.LOGS].envois.map((e) => embedDe(e).description || '').join('\n');
    V('/config : le journal aussi', /passe en \*\*🌐 Tout\*\*/.test(journal), journal.slice(-300));
    V('/config : la vue reste une carte valide', Boolean(REP.enComposants(g, client, it.mises[0])));
  }

  console.log('\n6) Courbe plus raide, niveau maximum abaissé : les rôles des paliers perdus sont repris');
  {
    const g = fabriquerServeur('R6');
    setGuildConfig(g.id, 'levels_enabled', 1);
    setGuildConfig(g.id, 'log_channel_id', S.LOGS);
    ajouterMembre(g, 'admin', [], { admin: true });
    L.ajouterRecompenseNiveau(g.id, { niveau: 5, type: 'role', valeur: R.N5 });
    L.ajouterRecompenseNiveau(g.id, { niveau: 10, type: 'role', valeur: R.N10 });
    const alice = ajouterMembre(g, 'u1');
    const bob = ajouterMembre(g, 'u2');
    await L.gagnerXpServeur(g, 'u1', 'admin', L.totalXpForLevel(10), { membre: alice });
    V('départ : niveau 10, rôles N5 et N10', L.getLevels(g.id, 'u1').level === 10 && alice.roles.cache.has(R.N5) && alice.roles.cache.has(R.N10));
    // Courbe « raide » depuis /config (administration).
    const it = fausse(g, { type: 'menu', user: 'admin', customId: 'cfgniv:courbe', valeurs: ['raide'] });
    await cfgPanneau(it);
    await attendre(30);
    const niv = L.getLevels(g.id, 'u1').level;
    V('courbe raide : le niveau baisse', niv < 10 && niv >= 5, `niveau ${niv}`);
    V('… le rôle du palier 10, perdu, est repris tout de suite', !alice.roles.cache.has(R.N10) && alice.roles.cache.has(R.N5), g.journal.join(' '));
    const journal = SALONS[S.LOGS].envois.map((e) => embedDe(e).description || '').join('\n');
    V('… et le journal dit vrai (repris en arrière-plan)', /paliers perdus sont repris/.test(journal), journal.slice(-200));
    V('… plus rien en attente', !L.baissesEnAttente(g.id));

    // Le tableau de bord change le niveau maximum : rattrapé au premier gain
    // de QUICONQUE sur le serveur.
    setGuildConfig(g.id, 'xp_niveau_max', 4);
    await L.gagnerXpServeur(g, 'u2', 'text', 5, { membre: bob });
    await attendre(30);
    V('niveau max abaissé ailleurs : au premier gain, le rôle N5 d\'Alice est repris', L.getLevels(g.id, 'u1').level === 4 && !alice.roles.cache.has(R.N5), g.journal.join(' '));

    // Mode remplacement (le scénario de la revue) : N2 au 2, N5 au 5.
    const g2 = fabriquerServeur('R6b');
    setGuildConfig(g2.id, 'levels_enabled', 1);
    setGuildConfig(g2.id, 'level_rewards_stack', 0);
    L.ajouterRecompenseNiveau(g2.id, { niveau: 2, type: 'role', valeur: R.N2 });
    L.ajouterRecompenseNiveau(g2.id, { niveau: 5, type: 'role', valeur: R.N5 });
    const u = ajouterMembre(g2, 'u3');
    await L.gagnerXpServeur(g2, 'u3', 'admin', L.totalXpForLevel(5), { membre: u });
    V('remplacement : au niveau 5, seul N5', u.roles.cache.has(R.N5) && !u.roles.cache.has(R.N2));
    setGuildConfig(g2.id, 'xp_courbe', 'raide');
    L.recalculerNiveaux(g2.id);
    await L.realignerBaisses(g2);
    V('courbe raide → niveau 3 : N5 repris, N2 donné (un seul rôle à la fois)', L.getLevels(g2.id, 'u3').level === 3
      && !u.roles.cache.has(R.N5) && u.roles.cache.has(R.N2), `${L.getLevels(g2.id, 'u3').level} · ${g2.journal.join(' ')}`);

    // /xp synchroniser réaligne, niveau 0 compris.
    const g3 = fabriquerServeur('R6c');
    setGuildConfig(g3.id, 'levels_enabled', 1);
    L.ajouterRecompenseNiveau(g3.id, { niveau: 1, type: 'role', valeur: R.N2 });
    L.ajouterRecompenseNiveau(g3.id, { niveau: 5, type: 'role', valeur: R.N5 });
    const zero = ajouterMembre(g3, 'u4', [R.N2, R.N5]);
    L.addXp(g3.id, 'u4', 'admin', 50); // niveau 0, mais de l'XP
    const bilan = await L.synchroniserNiveaux(g3);
    V('synchroniser : un membre retombé au niveau 0 est visité, ses rôles repris', bilan.membres === 1 && bilan.retires === 2
      && !zero.roles.cache.has(R.N2) && !zero.roles.cache.has(R.N5), texte(bilan));
  }

  console.log('\n7) Sans « Gérer les rôles » : un diagnostic qui le dit, plus d\'appel refusé à chaque gain');
  {
    const g = fabriquerServeur('R7');
    setGuildConfig(g.id, 'levels_enabled', 1);
    ajouterMembre(g, 'admin', [], { admin: true });
    L.ajouterRecompenseNiveau(g.id, { niveau: 2, type: 'role', valeur: R.N2 });
    g.members.me.permissions = permissionsDe([P.ViewChannel]);
    const alice = ajouterMembre(g, 'u1');
    L.addXp(g.id, 'u1', 'admin', L.totalXpForLevel(3));
    for (let k = 0; k < 5; k++) await L.gagnerXpServeur(g, 'u1', 'voice', 5, { membre: alice, salon: SALONS[S.VOC] });
    V('5 gains : aucun appel à Discord voué au refus', g.journal.length === 0, g.journal.join(' '));
    V('diagnostic : « Gérer les rôles » est nommé', /Gérer les rôles/.test(L.diagnostiquerRecompenses(g)[0]?.souci || ''), texte(L.diagnostiquerRecompenses(g)));
    let it = fausse(g, { type: 'role', user: 'admin', customId: 'cfgniv:recrole:role', valeurs: [R.N3] });
    await cfgPanneau(it);
    V('/config : ajouter un rôle explique la permission manquante', !it.modales.length && /Gérer les rôles/.test(contenu(it)), contenu(it));
    const b = await L.synchroniserNiveaux(g);
    V('/xp synchroniser : la récompense compte parmi les impossibles', b.ignores === 1 && b.donnes === 0, texte(b));

    // La permission revient, mais Discord refuse quand même (hiérarchie…) :
    // un essai, puis du répit.
    g.members.me.permissions = permissionsDe([P.Administrator]);
    g.refuses.add(R.N2);
    for (let k = 0; k < 5; k++) await L.gagnerXpServeur(g, 'u1', 'voice', 5, { membre: alice, salon: SALONS[S.VOC] });
    V('refus de Discord : un seul essai sur 5 gains', g.journal.length === 1, g.journal.join(' '));
    g.refuses.delete(R.N2);
    await L.synchroniserNiveaux(g);
    V('la synchronisation, elle, réessaie', alice.roles.cache.has(R.N2), g.journal.join(' '));
  }

  console.log('\n8) Départ puis retour, « XP effacée au départ » : ni Col ni objet reversé');
  {
    const g = fabriquerServeur('R8');
    setGuildConfig(g.id, 'levels_enabled', 1);
    setGuildConfig(g.id, 'sao_enabled', 1);
    setGuildConfig(g.id, 'level_reset_depart', 1);
    L.ajouterRecompenseNiveau(g.id, { niveau: 1, type: 'col', quantite: 1000 });
    for (let tour = 1; tour <= 3; tour++) {
      const m = ajouterMembre(g, 'u5');
      await L.gagnerXpServeur(g, 'u5', 'text', L.totalXpForLevel(1), { membre: m });
      await GMR.execute({ id: 'u5', guild: g, user: USERS.u5 });
      g.members.cache.delete('u5');
    }
    V('trois allers-retours : 1000 Col, pas 3000', BOURSE.get('R8:u5') === 1000, String(BOURSE.get('R8:u5')));
    V('l\'XP, elle, est bien effacée au départ', L.getLevels(g.id, 'u5').xp === 0);
    L.effacerXpMembre(g.id, 'u5');
    const m = ajouterMembre(g, 'u5');
    await L.gagnerXpServeur(g, 'u5', 'text', L.totalXpForLevel(1), { membre: m });
    V('/xp reset (décision d\'un admin) vide toujours le registre', BOURSE.get('R8:u5') === 2000, String(BOURSE.get('R8:u5')));
  }

  console.log('\n9) Mode remplacement : l\'ancien palier reste si le nouveau ne peut pas être posé');
  {
    const cas = async (nom, valeur5, avant = () => {}) => {
      const g = fabriquerServeur(`R9${nom}`);
      setGuildConfig(g.id, 'levels_enabled', 1);
      setGuildConfig(g.id, 'level_rewards_stack', 0);
      L.ajouterRecompenseNiveau(g.id, { niveau: 3, type: 'role', valeur: R.N3 });
      db.prepare("INSERT INTO niveau_recompenses (guild_id, niveau, type, valeur, quantite) VALUES (?, 5, 'role', ?, 1)").run(g.id, valeur5);
      const m = ajouterMembre(g, 'u1');
      await L.gagnerXpServeur(g, 'u1', 'admin', L.totalXpForLevel(3), { membre: m });
      avant(g);
      await L.gagnerXpServeur(g, 'u1', 'admin', L.totalXpForLevel(5) - L.totalXpForLevel(3), { membre: m });
      await L.gagnerXpServeur(g, 'u1', 'text', 5, { membre: m }); // et le rattrapage suivant
      return { g, m };
    };
    let { g, m } = await cas('a', DISPARU);
    V('rôle du palier 5 supprimé : N3 reste', m.roles.cache.has(R.N3), g.journal.join(' '));
    ({ g, m } = await cas('b', R.HAUT));
    V('rôle du palier 5 au-dessus du bot : N3 reste', m.roles.cache.has(R.N3), g.journal.join(' '));
    ({ g, m } = await cas('c', R.ADMINS));
    V('rôle du palier 5 sensible : N3 reste', m.roles.cache.has(R.N3) && !m.roles.cache.has(R.ADMINS), g.journal.join(' '));
    ({ g, m } = await cas('d', R.N5, (srv) => srv.refuses.add(R.N5)));
    V('Discord refuse le rôle du palier 5 : N3 reste', m.roles.cache.has(R.N3) && !m.roles.cache.has(R.N5), g.journal.join(' '));
    ({ g, m } = await cas('e', R.N5));
    V('cas normal : N5 remplace N3', m.roles.cache.has(R.N5) && !m.roles.cache.has(R.N3), g.journal.join(' '));
  }

  console.log('\n10) Formulaire de récompense : une quantité illisible est refusée');
  {
    const g = fabriquerServeur('R10');
    setGuildConfig(g.id, 'levels_enabled', 1);
    ajouterMembre(g, 'staff', [], { staff: true });
    for (const saisie of ['500 Col', '1,000', '10k', 'abc']) {
      const it = fausse(g, { type: 'modal', user: 'staff', customId: 'cfgniv:m:rec:col', champs: { niveau: '10', quantite: saisie } });
      await cfgPanneau(it);
      V(`« ${saisie} » : refusé, avec ce qu'il faut écrire`, /Montant illisible/.test(contenu(it)) && /1 à 1 000 000/.test(contenu(it)), contenu(it));
    }
    V('… aucune récompense « 1 Col » n\'a été créée', L.listerRecompensesNiveau(g.id).length === 0, texte(L.listerRecompensesNiveau(g.id)));
    let it = fausse(g, { type: 'modal', user: 'staff', customId: 'cfgniv:m:rec:objet:potion', champs: { niveau: '10', quantite: 'deux' } });
    await cfgPanneau(it);
    V('objet : « deux » refusé', /Quantité illisible/.test(contenu(it)) && L.listerRecompensesNiveau(g.id).length === 0, contenu(it));
    it = fausse(g, { type: 'modal', user: 'staff', customId: 'cfgniv:m:rec:col', champs: { niveau: '10', quantite: '1 000' } });
    await cfgPanneau(it);
    V('« 1 000 » : accepté (1000 Col)', L.listerRecompensesNiveau(g.id).some((r) => r.type === 'col' && r.quantite === 1000), contenu(it));
    V('ajouterRecompenseNiveau : une quantité null est refusée', !L.ajouterRecompenseNiveau(g.id, { niveau: 3, type: 'col', quantite: null }).ok);
    V('… une quantité absente vaut 1, comme avant', L.ajouterRecompenseNiveau(g.id, { niveau: 3, type: 'col' }).ok);
  }

  console.log('\n11) /niveau voir : un hébergeur muet ne fait plus partir la fiche à l\'ancienne');
  {
    const g = fabriquerServeur('R11');
    setGuildConfig(g.id, 'levels_enabled', 1);
    setGuildConfig(g.id, 'level_image_url', 'https://hebergeur-lent.test/fond.png');
    ajouterMembre(g, 'u1');
    L.addXp(g.id, 'u1', 'admin', 500);
    V('le délai des images reste sous la marge de repondreVite', CARTE.DELAI_CARTE <= REP.MARGE - 600, `${CARTE.DELAI_CARTE} / ${REP.MARGE}`);
    // Un hôte qui ne répond jamais (seul le délai l'arrête), pour l'avatar comme pour le fond.
    const muet = (u, { signal } = {}) => new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Error('délai'))));
    WEB.set('https://hebergeur-lent.test/fond.png', muet);
    WEB.set('https://cdn.test/u1.png', muet);
    const it = fausse(g, { user: 'u1', nom: 'niveau', sub: 'voir' });
    const t0 = Date.now();
    await IC.execute(it);
    const duree = Date.now() - t0;
    V('la fiche part par reply(), en un seul message (donc en carte)', it.appels.join(',') === 'reply', it.appels.join(','));
    V(`… en moins de ${REP.MARGE} ms`, duree < REP.MARGE, `${duree} ms`);
    V('… avec sa carte PNG, fond par défaut', Array.isArray(it.reponses[0]?.files) && it.reponses[0].files.length === 1, texte(it.reponses[0]));
  }

  console.log('\n12) /config → 🏅 Récompenses : la rubrique tient dans une carte (40 composants, 4000 signes)');
  {
    ajouterMembre(fabriquerServeur('R12x'), 'admin', [], { admin: true });
    const verifier = async (nom, remplir) => {
      const g = fabriquerServeur(`R12${nom}`);
      setGuildConfig(g.id, 'levels_enabled', 1);
      ajouterMembre(g, 'admin', [], { admin: true });
      remplir(g);
      const toutes = L.listerRecompensesNiveau(g.id);
      const pages = CN.pagesRecompenses(L.diagnostiquerRecompenses(g));
      const soucis = [];
      const vus = [];
      for (let p = 1; p <= pages.length; p++) {
        const vue = CN.vueConfigNiveaux(g, 'recompenses', { page: p });
        const comps = REP.enComposants(g, client, vue);
        if (!comps) { soucis.push(`page ${p} non convertible`); continue; }
        const n = C.compter(comps);
        const t = C.longueurTexte(comps);
        if (n > C.MAX_COMPOSANTS) soucis.push(`page ${p} : ${n} composants`);
        if (t > C.MAX_TEXTE_TOTAL) soucis.push(`page ${p} : ${t} signes`);
        const menu = json(vue.components.find((r) => json(r).components?.[0]?.custom_id?.startsWith('cfgniv:recsuppr')))?.components?.[0];
        if (!menu || menu.options.length > 25) soucis.push(`page ${p} : menu de retrait ${menu?.options?.length}`);
        vus.push(...(menu?.options || []).map((o) => Number(o.value)));
      }
      V(`${nom} : ${pages.length} page(s), toutes ≤ 40 composants et ≤ 4000 signes`, soucis.length === 0, soucis.join(' ; '));
      V(`${nom} : chaque récompense est retirable, une seule fois`, vus.length === toutes.length && new Set(vus).size === toutes.length,
        `${vus.length}/${toutes.length}`);
      // Un palier qui tient sur une page n'est jamais coupé en deux.
      const pagesDe = new Map();
      pages.forEach((pg, i) => pg.forEach((r) => pagesDe.set(r.niveau, new Set([...(pagesDe.get(r.niveau) || []), i]))));
      const coupes = [...pagesDe].filter(([n, ps]) => ps.size > 1 && toutes.filter((r) => r.niveau === n).length <= 25).map(([n]) => n);
      V(`${nom} : aucun palier coupé entre deux pages sans nécessité`, coupes.length === 0, coupes.join(', '));
      return g;
    };
    const roleDe = (i) => `8800000000000${String(i).padStart(5, '0')}`;
    await verifier('1 récompense', (g) => L.ajouterRecompenseNiveau(g.id, { niveau: 5, type: 'col', quantite: 10 }));
    const g13 = await verifier('13 paliers de rôle (5 à 65)', (g) => {
      for (let i = 1; i <= 13; i++) {
        role(roleDe(i), `Palier ${i * 5}`, 5);
        L.ajouterRecompenseNiveau(g.id, { niveau: i * 5, type: 'role', valeur: roleDe(i) });
      }
    });
    await verifier('50 récompenses sur 25 paliers', (g) => {
      for (let i = 1; i <= 25; i++) {
        L.ajouterRecompenseNiveau(g.id, { niveau: i * 2, type: 'col', quantite: i });
        L.ajouterRecompenseNiveau(g.id, { niveau: i * 2, type: 'mp', valeur: `Bravo {pseudo} ! ${'x'.repeat(60)} ${i}` });
      }
    });
    await verifier('100 récompenses sur 100 paliers, soucis compris', (g) => {
      for (let i = 1; i <= 100; i++) {
        if (i % 3 === 0) db.prepare("INSERT INTO niveau_recompenses (guild_id, niveau, type, valeur, quantite) VALUES (?, ?, 'role', ?, 1)").run(g.id, i, R.ADMINS);
        else if (i % 3 === 1) L.ajouterRecompenseNiveau(g.id, { niveau: i, type: 'mp', valeur: `${'Message très long '.repeat(20)}${i}` });
        else L.ajouterRecompenseNiveau(g.id, { niveau: i, type: 'col', quantite: 1000 + i });
      }
    });
    await verifier('9 paliers de 2, puis un palier de 10', (g) => {
      for (let i = 1; i <= 9; i++) for (let k = 0; k < 2; k++) L.ajouterRecompenseNiveau(g.id, { niveau: i, type: 'col', quantite: 10 + k });
      for (let k = 0; k < 10; k++) L.ajouterRecompenseNiveau(g.id, { niveau: 50, type: 'col', quantite: 100 + k });
    });
    await verifier('100 récompenses sur un seul palier', (g) => {
      for (let i = 1; i <= 100; i++) L.ajouterRecompenseNiveau(g.id, { niveau: 10, type: 'col', quantite: i });
    });

    // De bout en bout, sur un panneau publié en carte : la rubrique s'ouvre,
    // et la 14e récompense ajoutée s'affiche sur sa page.
    let it = fausse(g13, { type: 'bouton', user: 'admin', customId: 'cfgniv:aller:recompenses', carte: true });
    await cfgPanneau(it);
    V('13 paliers : la rubrique s\'ouvre sur une carte (update accepté)', it.mises.length === 1 && C.compter(it.mises[0].components) <= 40,
      `${it.appels.join(',')} · ${it.mises[0] ? C.compter(it.mises[0].components) : '—'}`);
    it = fausse(g13, { type: 'modal', user: 'admin', customId: 'cfgniv:m:rec:col', champs: { niveau: '70', quantite: '500' }, carte: true });
    await cfgPanneau(it);
    const montre = JSON.stringify(it.mises[0]?.components || []);
    V('ajout de la 14e : le panneau se met à jour, sur la page qui la montre', it.mises.length === 1 && /Niveau 70/.test(montre) && /500 Col/.test(montre),
      `${it.appels.join(',')}`);
  }

  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})().catch((e) => { console.error(e); console.log('\n0 réussis, 1 échoués'); process.exit(1); });
