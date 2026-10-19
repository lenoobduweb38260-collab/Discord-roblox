// 🔢 Salon de comptage — lecture des nombres et des calculs, suite, erreurs,
// même personne, hors-jeu, record, file par salon, anti-triche (nombre effacé
// ou modifié), redémarrage, rôle d'erreur, XP, /comptage et /config.
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');
const SRC = path.join(__dirname, '..', 'src');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'comptage-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');
delete process.env.AI_API_KEY;

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  return vrai.apply(this, arguments);
};

const { db, setGuildConfig, getGuildConfig } = require('../src/database');
let C = require('../src/utils/comptage');
let MC = require('../src/events/messageCreate');
const MD = require('../src/events/messageDelete');
const MU = require('../src/events/messageUpdate');
const IC = require('../src/events/interactionCreate');
const CMD = require('../src/commands/comptage');
const CC = require('../src/utils/comptageConfig');
const { getLevels } = require('../src/utils/levels');
const TUTO = require('../src/utils/tutoriel');
const { GRADES, getGrade } = require('../src/utils/permissions');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };
const texte = (o) => JSON.stringify(o);
const warnOrig = console.warn;
console.warn = () => {};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Faux Discord ────────────────────────────────────────────────────────
const personne = (id, nom, bot = false) => ({
  id, username: nom, displayName: nom, globalName: nom, bot, tag: `${nom}#0`, displayAvatarURL: () => '',
});
const USERS = {
  u1: personne('u1', 'Alice'), u2: personne('u2', 'Bob'), u3: personne('u3', 'Chloé'),
  staff: personne('staff', 'Modo'), b1: personne('b1', 'RoboBot', true), bot: personne('bot', 'Bot', true),
  modo: personne('modo', 'Modérateur'),
};
const ROLES = new Map([
  ['RERR', { id: 'RERR', name: 'Boulet', position: 1, managed: false }],
  ['HAUT', { id: 'HAUT', name: 'Tout en haut', position: 99, managed: false }],
  ['GERE', { id: 'GERE', name: 'Intégration', position: 1, managed: true }],
  // Sous le rôle du bot (50) et sous celui du modo (20) : seule la
  // permission les rend dangereux.
  ['ADMINROLE', { id: 'ADMINROLE', name: 'Administrateurs', position: 10, managed: false, permissions: { bitfield: 1n << 3n } }],
  ['BANROLE', { id: 'BANROLE', name: 'Videurs', position: 9, managed: false, permissions: '4' }],
  ['R2', { id: 'R2', name: 'Maladroit', position: 2, managed: false, permissions: { bitfield: 0n } }],
  ['ENTRE', { id: 'ENTRE', name: 'Entre deux', position: 35, managed: false }],
  // Rôles staff / admin DU BOT : aucune permission Discord, mais un grade.
  ['EQUIPE', { id: 'EQUIPE', name: 'Équipe', position: 3, managed: false, permissions: { bitfield: 0n } }],
  ['DIRECTION', { id: 'DIRECTION', name: 'Direction', position: 4, managed: false, permissions: { bitfield: 0n } }],
]);

let seq = 0;
function salon(id) {
  const s = {
    id, envois: [], isTextBased: () => true, guild: null,
    async send(m) { const msg = { id: `B${++seq}`, channelId: id, ...m }; s.envois.push(msg); return msg; },
  };
  return s;
}
const SALONS = { CPT: salon('CPT'), AUTRE: salon('AUTRE'), GEN: salon('GEN'), LOGS: salon('LOGS') };
const CMDS = new Map([['comptage', CMD]]);
const client = {
  user: { id: 'bot' }, commands: CMDS,
  users: { fetch: async (id) => USERS[id] || null },
  channels: { fetch: async (id) => SALONS[id] || null },
  guilds: { cache: new Map() },
};
const MEMBRES = new Map();
const guild = {
  id: 'G1', name: 'Labo', iconURL: () => null,
  members: {
    cache: new Map(),
    fetch: async (id) => (USERS[id] ? membre(id) : null),
    me: { id: 'bot', roles: { highest: { position: 50 } } },
  },
  channels: { fetch: async (id) => SALONS[id] || null, cache: new Map() },
  roles: { cache: ROLES },
  fetchAuditLogs: async () => ({ entries: new Map() }),
};
Object.values(SALONS).forEach((s) => { s.guild = guild; });
// La place du rôle le plus haut de chacun (l'admin est haut placé).
const RANGS = { staff: 30, modo: 20, admin2: 30 };
function membre(id) {
  if (!MEMBRES.has(id)) {
    const roles = new Map();
    MEMBRES.set(id, {
      id, user: USERS[id], guild, displayName: USERS[id]?.displayName,
      roles: {
        cache: roles, highest: { position: RANGS[id] ?? 0 },
        async add(r) { roles.set(String(r), true); return this; },
        async remove(r) { roles.delete(String(r)); return this; },
      },
      // staff : tous les droits (administration) ; modo : « Modérer les
      // membres » seulement, donc le grade staff.
      permissions: { has: (bit) => id === 'staff' || (id === 'modo' && bit === (1n << 40n)) },
    });
  }
  return MEMBRES.get(id);
}

// Réactions : délai réglable, ordre d'achèvement et nombre de jugements
// simultanés — c'est ce que la file par salon doit garder à 1.
let delaiReaction = 0;
let enCours = 0;
let maxEnCours = 0;
const ORDRE = [];
function fauxMessage({ user = 'u1', contenu = '', salonId = 'CPT', system = false } = {}) {
  const s = SALONS[salonId];
  const m = {
    id: `U${++seq}`, content: contenu, client, guild, guildId: 'G1', channel: s, channelId: salonId,
    author: USERS[user], member: USERS[user] ? membre(user) : null, system, partial: false,
    url: `https://discord.com/channels/G1/${salonId}/x`,
    inGuild: () => true, attachments: { size: 0, values: () => [][Symbol.iterator]() },
    mentions: { has: () => false, everyone: false, users: { size: 0 }, roles: { size: 0 } },
    reactions: [], supprime: false,
    async react(e) {
      enCours++;
      maxEnCours = Math.max(maxEnCours, enCours);
      if (delaiReaction) await attendre(delaiReaction * (1 + (Number(m.id.slice(1)) % 3)));
      m.reactions.push(e);
      ORDRE.push(m.id);
      enCours--;
      return {};
    },
    async delete() { m.supprime = true; return m; },
  };
  return m;
}
const poster = async (user, contenu, salonId = 'CPT') => {
  const m = fauxMessage({ user, contenu, salonId });
  await MC.execute(m);
  return m;
};
const dernierEnvoi = (s = 'CPT') => SALONS[s].envois[SALONS[s].envois.length - 1] || {};
const etat = () => C.etatComptage('G1');

// type : 'commande' | 'bouton' | 'modal' | 'salon' | 'role' | 'texte'
function fausse({ type = 'commande', user = 'u1', nom = null, sub = null, options = {}, customId = null, champs = {}, valeurs = [] } = {}) {
  const menu = ['salon', 'role', 'texte'].includes(type);
  return {
    client, guild, guildId: 'G1', channelId: 'GEN', channel: SALONS.GEN, locale: 'fr', user: USERS[user], member: membre(user),
    commandName: nom, customId, values: valeurs, deferred: false, replied: false,
    message: { id: 'MSG', flags: 0, components: [], embeds: [{}], createdTimestamp: Date.now() },
    inGuild: () => true, isAutocomplete: () => false, isChatInputCommand: () => type === 'commande',
    isButton: () => type === 'bouton', isModalSubmit: () => type === 'modal', isFromMessage: () => type === 'modal',
    isMessageComponent: () => type === 'bouton' || menu, isStringSelectMenu: () => type === 'texte',
    isChannelSelectMenu: () => type === 'salon', isRoleSelectMenu: () => type === 'role', isUserSelectMenu: () => false,
    isAnySelectMenu: () => menu,
    options: {
      getSubcommand: () => sub, getString: (k) => options[k] ?? null, getInteger: (k) => options[k] ?? null,
      getBoolean: (k) => options[k] ?? null,
    },
    fields: { getTextInputValue: (k) => champs[k] ?? '' },
    reponses: [], suivis: [], mises: [], modales: [],
    async reply(p) { this.replied = true; this.reponses.push(p); return p; },
    async deferReply() { this.deferred = true; },
    async editReply(p) { this.reponses.push(p); return p; },
    async followUp(p) { this.suivis.push(p); return p; },
    async update(p) { this.replied = true; this.mises.push(p); return p; },
    async deferUpdate() { this.deferred = true; },
    async showModal(m) { this.modales.push(m.toJSON ? m.toJSON() : m); },
  };
}
const embedDe = (p) => p?.embeds?.[0]?.data || p?.embeds?.[0] || {};
const rangees = (p) => (p?.components || []).map((r) => (r.toJSON ? r.toJSON() : r));
const ids = (p) => rangees(p).flatMap((r) => r.components.map((c) => c.custom_id).filter(Boolean));
const titreLog = () => embedDe(SALONS.LOGS.envois[SALONS.LOGS.envois.length - 1]).title;

(async () => {
  console.log('\n1) Lecture des nombres et des calculs (sans eval)');
  {
    const L = (t, maths = false) => C.lireNombreComptage(t, { maths });
    V('« 5 » → 5', L('5').ok && L('5').valeur === 5);
    V('« 12 lol » → 12 : seul le DÉBUT compte', L('  12 lol').valeur === 12);
    V('« 5 xD » → 5 : un sourire n\'est pas une multiplication', L('5 xD').valeur === 5 && !L('5 xD', true).expression);
    V('« 5 - c\'est moi » → 5', L('5 - c\'est moi', true).valeur === 5);
    V('« bonjour », « @Bob 5 » → hors-jeu', !L('bonjour').ok && !L('<@u2> 5').ok);
    V('décimal « 1,5 » / « 2.5 » → hors-jeu', L('1,5').raison === 'decimal' && L('2.5', true).raison === 'decimal');
    V('plus de 15 chiffres → hors-jeu', L('1234567890123456').raison === 'trop_grand');
    V('calculs coupés : « 2+2 » ignoré (jamais lu comme 2)', !L('2+2').ok && L('2+2').raison === 'calcul_refuse');
    const calc = (t) => L(t, true).valeur;
    V('calculs : 2+2, (10+2)/4, 2**3, 5x3, 3 × 4, 9 ÷ 3, 10 − 4',
      calc('2+2') === 4 && calc('(10+2)/4') === 3 && calc('2**3') === 8 && calc('5x3') === 15 && calc('3 × 4') === 12
      && calc('9 ÷ 3') === 3 && calc('10 − 4') === 6);
    V('priorités : 2+3*4 = 14, 2^3^2 = 512, -2^2 = -4, -1+3 = 2',
      calc('2+3*4') === 14 && calc('2^3^2') === 512 && calc('-2^2') === -4 && calc('-1+3') === 2);
    V('division non entière ou par zéro → refusée', !L('7/2', true).ok && !L('1/0', true).ok);
    V('puissance démesurée → refusée (9^9^9, 2^1000, 2^53)', !L('9^9^9', true).ok && !L('2^1000', true).ok && !L('2^53', true).ok && calc('2^52') === 2 ** 52);
    V('parenthèse non fermée → refusée', !L('(2+3', true).ok);
    V('12 parenthèses imbriquées passent, 13 non',
      calc('('.repeat(12) + '7' + ')'.repeat(12)) === 7 && !L('('.repeat(13) + '7' + ')'.repeat(13), true).ok);
    V('calcul trop long → refusé en bloc', L('1' + '+1'.repeat(70), true).raison === 'trop_long');
    V('« 5 » suivi de 150 espaces puis du texte → 5 (seul le calcul est borné)', L('5' + ' '.repeat(150) + 'salut').valeur === 5);
    const E = C.evaluerExpressionComptage;
    V('évaluateur : tout le texte doit être un calcul', E('2+3*4') === 14 && E('2+3 lol') === null);
    V('code JavaScript : jamais exécuté, toujours refusé',
      [`process.exit()`, 'constructor', 'this', '__proto__', 'require("fs")', '1;process.exit()', '[]+{}', '0x10', '1e308', 'Infinity', 'NaN']
        .every((t) => E(t) === null || Number.isSafeInteger(E(t))) && E('1;process.exit()') === null && E('constructor') === null);
    V('texte énorme → refusé sans lenteur', (() => { const t0 = Date.now(); const r = E('('.repeat(5000)); return r === null && Date.now() - t0 < 200; })());
    const source = fs.readFileSync(path.join(SRC, 'utils/comptage.js'), 'utf8').replace(/\/\/.*$/gm, '');
    V('ni eval ni Function dans le module', !/\beval\s*\(|new\s+Function|\bFunction\s*\(/.test(source));
  }

  console.log('\n2) Jugement (logique pure)');
  {
    const J = C.jugerComptage;
    const e = { courant: 4, dernier_user: 'u1' };
    V('5 par un autre → juste', J(e, 5, 'u2').verdict === 'juste');
    V('5 par le même → faux (deux fois de suite)', J(e, 5, 'u1').raison === 'deux_fois');
    V('… sauf si le serveur l\'autorise', J(e, 5, 'u1', { memePersonne: true }).verdict === 'juste');
    V('6 au lieu de 5 → faux (nombre)', J(e, 6, 'u2').raison === 'nombre' && J(e, 6, 'u2').attendu === 5);
    const R = C.reglagesComptage({ comptage_channel_id: null });
    V('réglages par défaut : coupé, réactions oui, calculs non, XP 0', !R.salon && R.reactions && !R.maths && !R.memePersonne && !R.supprimer && R.xp === 0 && !R.roleErreur);
    V('XP bornée à 0…1000', C.reglagesComptage({ comptage_xp: 99999 }).xp === 1000 && C.reglagesComptage({ comptage_xp: -5 }).xp === 0);
    V('réglages en base (colonnes + défauts)', ['comptage_channel_id', 'comptage_meme_personne', 'comptage_maths', 'comptage_reactions', 'comptage_supprimer', 'comptage_role_erreur', 'comptage_xp'].every((k) => k in getGuildConfig('ZZ')));
  }

  setGuildConfig('G1', 'log_channel_id', 'LOGS');
  setGuildConfig('G1', 'comptage_channel_id', 'CPT');

  console.log('\n3) Une suite correcte');
  {
    const m1 = await poster('u1', '1');
    const m2 = await poster('u2', '2');
    const m3 = await poster('u1', '3 !');
    V('trois ✅', [m1, m2, m3].every((m) => texte(m.reactions) === '["✅"]'), texte([m1.reactions, m2.reactions, m3.reactions]));
    const e = etat();
    V('état : 3, dernier compteur Alice, dernier message retenu', e.courant === 3 && e.dernier_user === 'u1' && e.dernier_message_id === m3.id && e.channel_id === 'CPT');
    V('classement : Alice 2, Bob 1', C.statsMembreComptage('G1', 'u1').justes === 2 && C.statsMembreComptage('G1', 'u2').justes === 1 && C.statsMembreComptage('G1', 'u1').rang === 1);
    const ailleurs = await poster('u2', '4', 'GEN');
    V('un nombre dans un autre salon ne compte pas', etat().courant === 3 && !ailleurs.reactions.length);
    const robot = fauxMessage({ user: 'b1', contenu: '4' });
    await MC.execute(robot);
    V('un autre bot est ignoré', etat().courant === 3 && !robot.reactions.length);
    V('… le bot lui-même aussi, et les messages système', (await C.traiterMessageComptage(fauxMessage({ user: 'bot', contenu: '4' }))).traite === false
      && (await C.traiterMessageComptage(fauxMessage({ user: 'u2', contenu: '4', system: true }))).traite === false);
  }

  console.log('\n4) Messages hors-jeu');
  {
    const a = await poster('u2', 'salut tout le monde');
    const b = await poster('u2', '2+2');
    V('ignorés : ni réaction ni effacement, compte inchangé', !a.reactions.length && !a.supprime && !b.reactions.length && etat().courant === 3);
    setGuildConfig('G1', 'comptage_supprimer', 1);
    const logsAvant = SALONS.LOGS.envois.length;
    const c = await poster('u2', 'blabla');
    V('suppression activée → le hors-jeu est effacé', c.supprime === true && etat().courant === 3);
    const t0 = Date.now();
    await MD.execute(c);
    V('… et son effacement ne remplit pas le journal', SALONS.LOGS.envois.length === logsAvant && Date.now() - t0 < 1000);
    const d = await poster('u2', '4');
    V('un nombre n\'est jamais effacé', !d.supprime && texte(d.reactions) === '["✅"]' && etat().courant === 4);
    setGuildConfig('G1', 'comptage_supprimer', 0);
  }

  console.log('\n5) Une erreur → retour à 0');
  {
    const avant = SALONS.CPT.envois.length;
    const m = await poster('u1', '7');
    const msg = dernierEnvoi();
    V('réaction ❌', texte(m.reactions) === '["❌"]');
    V('le message exact', SALONS.CPT.envois.length === avant + 1
      && msg.content.startsWith('💥 <@u1> a cassé la série à **4** ! Le prochain nombre était **5**. On repart de **0** : le prochain est **1**.'), msg.content);
    V('… avec le record du serveur', /🏆 Record du serveur : \*\*4\*\*/.test(msg.content));
    V('… sans pinguer personne', texte(msg.allowedMentions) === '{"parse":[]}');
    const e = etat();
    V('compte à 0, plus de dernier compteur, une série cassée', e.courant === 0 && e.dernier_user === null && e.dernier_message_id === null && e.erreurs === 1 && e.record === 4);
    V('le fautif a une erreur au classement', C.statsMembreComptage('G1', 'u1').erreurs === 1);
    const zero = await poster('u3', '5');
    V('à 0 : ❌ sans message ni sanction', texte(zero.reactions) === '["❌"]' && SALONS.CPT.envois.length === avant + 1 && etat().erreurs === 1);
    setGuildConfig('G1', 'comptage_reactions', 0);
    const sans = await poster('u3', '9');
    V('à 0, réactions coupées : un mot à la place', !sans.reactions.length && dernierEnvoi().content === '❌ <@u3>, le compte commence à **1**.');
    setGuildConfig('G1', 'comptage_reactions', 1);
  }

  console.log('\n6) La même personne deux fois de suite');
  {
    await poster('u1', '1');
    const m = await poster('u1', '2');
    V('casse la série', texte(m.reactions) === '["❌"]' && etat().courant === 0 && /Pas deux fois de suite/.test(dernierEnvoi().content));
    setGuildConfig('G1', 'comptage_meme_personne', 1);
    const a = await poster('u1', '1');
    const b = await poster('u1', '2');
    V('autorisé par le serveur → deux ✅', texte(a.reactions) === '["✅"]' && texte(b.reactions) === '["✅"]' && etat().courant === 2);
    setGuildConfig('G1', 'comptage_meme_personne', 0);
  }

  console.log('\n7) Les calculs dans le salon');
  {
    setGuildConfig('G1', 'comptage_maths', 1);
    const a = await poster('u2', '(1+2)');
    const b = await poster('u1', '2*2 voilà');
    const c = await poster('u2', '10/2');
    V('(1+2), 2*2, 10/2 → 3, 4, 5 (et 5 bat le record de 4 : 🏆)', [a, b].every((m) => m.reactions[0] === '✅') && c.reactions[0] === '🏆' && etat().courant === 5,
      texte([a, b, c].map((m) => m.reactions)));
    const d = await poster('u1', '7/2');
    V('un calcul invalide est hors-jeu, pas une erreur', !d.reactions.length && etat().courant === 5);
    const f = await poster('u1', '2+2');
    V('un calcul faux casse la série, avec l\'explication', f.reactions[0] === '❌' && /`2\+2` = \*\*4\*\*, il fallait \*\*6\*\*/.test(dernierEnvoi().content), dernierEnvoi().content);
    setGuildConfig('G1', 'comptage_maths', 0);
  }

  console.log('\n8) Record, 💯 et 🏆');
  {
    V('record actuel : 5', etat().record === 5);
    const qui = ['u1', 'u2'];
    const msgs = [];
    for (let n = 1; n <= 7; n++) msgs.push(await poster(qui[n % 2], String(n)));
    V('égaler le record → ✅ ; le battre → 🏆 ; ensuite → ✅', msgs[4].reactions[0] === '✅' && msgs[5].reactions[0] === '🏆' && msgs[6].reactions[0] === '✅', texte(msgs.map((m) => m.reactions)));
    const e = etat();
    V('record à 7, daté', e.record === 7 && !!e.record_le);
    C.definirNombreComptage('G1', 99, 'CPT');
    const saut = await poster('u3', '100');
    V('compte corrigé au-delà du record : le premier nombre au-dessus → 🏆', saut.reactions[0] === '🏆' && etat().record === 100);
    C.definirNombreComptage('G1', 99, 'CPT');
    const cent = await poster('u1', '100');
    V('100 sans battre le record → 💯', cent.reactions[0] === '💯' && etat().record === 100);
  }

  console.log('\n9) File par salon : messages simultanés');
  {
    C.definirNombreComptage('G1', 0, 'CPT');
    delaiReaction = 5;
    maxEnCours = 0;
    ORDRE.length = 0;
    const lot = ['u1', 'u2', 'u1', 'u2', 'u1'].map((u, i) => fauxMessage({ user: u, contenu: String(i + 1) }));
    await Promise.all(lot.map((m) => MC.execute(m)));
    V('cinq nombres postés d\'un coup → cinq ✅', lot.every((m) => m.reactions[0] === '✅') && etat().courant === 5, texte(lot.map((m) => m.reactions)));
    V('jamais deux jugements à la fois dans le salon', maxEnCours === 1, String(maxEnCours));
    V('jugés dans l\'ordre d\'arrivée', texte(ORDRE) === texte(lot.map((m) => m.id)), texte(ORDRE));
    const x = fauxMessage({ user: 'u2', contenu: '6' });
    const y = fauxMessage({ user: 'u3', contenu: '6' });
    await Promise.all([MC.execute(x), MC.execute(y)]);
    V('deux « 6 » simultanés : le premier ✅, le second casse la série', x.reactions[0] === '✅' && y.reactions[0] === '❌' && /<@u3> a cassé la série à \*\*6\*\*/.test(dernierEnvoi().content));
    delaiReaction = 0;
    const panne = C.enFileComptage('X', async () => { throw new Error('boom'); }).catch(() => 'rattrapé');
    const apres = C.enFileComptage('X', async () => 42);
    V('un travail qui échoue ne bloque pas la file', (await panne) === 'rattrapé' && (await apres) === 42);
  }

  console.log('\n10) Anti-triche : le dernier nombre effacé ou modifié');
  {
    await poster('u1', '1');
    const m2 = await poster('u2', '2');
    const partiel = { id: m2.id, channelId: 'CPT', guild, guildId: 'G1', client, partial: true, author: null, content: null, channel: SALONS.CPT };
    await MD.execute(partiel);
    V('effacé (même hors cache) → le bot republie le bon nombre',
      dernierEnvoi().content === '⚠️ <@u2> a supprimé son nombre **2**. Le prochain est **3**.', dernierEnvoi().content);
    V('… le compte, lui, ne bouge pas', etat().courant === 2 && etat().dernier_user === 'u2' && etat().dernier_message_id === null);
    const n = SALONS.CPT.envois.length;
    await MD.execute(partiel);
    V('une seule alerte par nombre', SALONS.CPT.envois.length === n);
    const m3 = await poster('u1', '3');
    await MD.execute({ ...partiel, id: m2.id });
    V('effacer un nombre plus ancien ne dit rien', SALONS.CPT.envois.length === n);
    await MU.execute({ content: '3' }, { ...m3, content: '3 (pardon, faute de frappe)' });
    V('modifier sans changer le nombre ne dit rien', SALONS.CPT.envois.length === n);
    await MU.execute({ content: null, partial: true }, { ...m3, content: '33' });
    V('modifier le nombre → le bot rappelle le vrai', dernierEnvoi().content === '⚠️ <@u1> a modifié son nombre **3**. Le prochain est **4**.', dernierEnvoi().content);
    V('… et le journal des modifications suit son cours', titreLog() === '✏️ Message modifié');
    const m4 = await poster('u2', '4');
    V('le compte continue normalement', m4.reactions[0] === '✅' && etat().courant === 4);
  }

  console.log('\n11) Redémarrage simulé');
  {
    const avant = etat();
    for (const k of Object.keys(require.cache)) if (k.startsWith(SRC)) delete require.cache[k];
    const C2 = require('../src/utils/comptage');
    const MC2 = require('../src/events/messageCreate');
    V('modules rechargés (nouvelle connexion à la base)', C2 !== C && MC2 !== MC);
    const e = C2.etatComptage('G1');
    V('le compte, le dernier compteur et le record ont survécu', e.courant === avant.courant && e.dernier_user === 'u2' && e.record === avant.record && e.erreurs === avant.erreurs);
    const juste = fauxMessage({ user: 'u3', contenu: '5' });
    V('Bob ne peut toujours pas compter deux fois', C2.jugerComptage(e, 5, 'u2').raison === 'deux_fois');
    await MC2.execute(juste);
    V('Chloé continue : 5 ✅', juste.reactions[0] === '✅' && C2.etatComptage('G1').courant === 5);
    C = C2;
    MC = MC2;
  }

  console.log('\n12) Changement de salon');
  {
    const record = etat().record;
    setGuildConfig('G1', 'comptage_channel_id', 'AUTRE'); // comme depuis le site, sans passer par /config
    const a = await poster('u1', '6', 'AUTRE');
    V('nouveau salon : le compte repart de 0 (le 6 n\'y vaut rien)', a.reactions[0] === '❌' && etat().courant === 0 && etat().channel_id === 'AUTRE');
    const b = await poster('u1', '1', 'AUTRE');
    V('… on y compte depuis 1, record conservé', b.reactions[0] === '✅' && etat().record === record);
    const ancien = await poster('u2', '2', 'CPT');
    V('l\'ancien salon ne compte plus', !ancien.reactions.length && etat().courant === 1);
    setGuildConfig('G1', 'comptage_channel_id', 'CPT');
  }

  console.log('\n13) Rôle d\'erreur');
  {
    setGuildConfig('G1', 'comptage_role_erreur', 'RERR');
    await poster('u1', '1');
    await poster('u2', '2');
    await poster('u1', '9');
    V('celui qui casse reçoit le rôle', membre('u1').roles.cache.has('RERR'));
    await poster('u2', '1');
    await poster('u3', '5');
    V('le suivant le reçoit, le précédent le perd', membre('u3').roles.cache.has('RERR') && !membre('u1').roles.cache.has('RERR') && etat().dernier_fautif === 'u3');
    setGuildConfig('G1', 'comptage_role_erreur', null);
  }

  console.log('\n14) XP par bon nombre');
  {
    setGuildConfig('G1', 'comptage_xp', 15);
    const avant = getLevels('G1', 'u3').xp || 0;
    const r = await C.traiterMessageComptage(fauxMessage({ user: 'u3', contenu: '1' }));
    V('un bon nombre rapporte l\'XP réglée', r.verdict === 'juste' && (getLevels('G1', 'u3').xp || 0) === avant + 15, `${avant} → ${getLevels('G1', 'u3').xp}`);
    const avantFaux = getLevels('G1', 'u1').xp || 0;
    const faux = await C.traiterMessageComptage(fauxMessage({ user: 'u1', contenu: '7' }));
    V('une erreur ne rapporte rien', faux.verdict === 'faux' && faux.sanction === true && (getLevels('G1', 'u1').xp || 0) === avantFaux);
    setGuildConfig('G1', 'comptage_xp', 0);
    const avant2 = getLevels('G1', 'u2').xp || 0;
    await C.traiterMessageComptage(fauxMessage({ user: 'u2', contenu: '1' }));
    V('XP à 0 → aucune', (getLevels('G1', 'u2').xp || 0) === avant2);
    const src = fs.readFileSync(path.join(SRC, 'utils/comptage.js'), 'utf8');
    V('XP via gagnerXpServeur (contrat C), repli addXp, source « comptage »', /gagnerXpServeur\(message\.guild, message\.author\.id, 'comptage'/.test(src) && /L\.addXp\(message\.guild\.id, message\.author\.id, 'comptage'/.test(src));
  }

  console.log('\n15) /comptage');
  {
    let it = fausse({ nom: 'comptage', sub: 'info', user: 'u3' });
    await IC.execute(it);
    const info = embedDe(it.reponses[0]);
    V('info : privée, nombre actuel, prochain, record, mes chiffres',
      it.reponses[0]?.flags === 64 && /Nombre actuel : \*\*1\*\*/.test(info.description) && /Prochain nombre : \*\*2\*\*/.test(info.description)
      && /Record : \*\*100\*\*/.test(info.description) && /◆ 👤 · \*\*Toi\*\*/.test(info.description), info.description);
    V('… sans pinguer', texte(it.reponses[0].allowedMentions) === '{"parse":[]}');

    const ajout = db.prepare('INSERT INTO comptage_stats (guild_id, user_id, justes, erreurs) VALUES (?, ?, ?, ?)');
    for (let i = 0; i < 25; i++) ajout.run('G1', `x${String(i).padStart(2, '0')}`, 1000 - i, i % 2);
    const total = C.compterCompteursComptage('G1');
    it = fausse({ nom: 'comptage', sub: 'classement' });
    await CMD.execute(it);
    const p1 = it.reponses[0];
    const lignes = embedDe(p1).description.split('\n').filter((l) => l.startsWith('➜'));
    V('classement : 10 par page, grammaire ◆/➜, médailles', lignes.length === 10 && /^◆ 🔢 · \*\*Meilleurs compteurs\*\*/.test(embedDe(p1).description) && lignes[0].includes('🥇 <@x00> — **1000** bons nombres'), lignes[0]);
    V('pied de page : total et page', embedDe(p1).footer.text === `${total} compteurs • Page 1/${Math.ceil(total / 10)}`, embedDe(p1).footer.text);
    V('boutons ⏮️/⏭️ : cpt:page:0 (grisé) et cpt:page:2', texte(ids(p1)) === '["cpt:page:0","cpt:page:2"]' && rangees(p1)[0].components[0].disabled === true);
    it = fausse({ type: 'bouton', customId: 'cpt:page:3' });
    await IC.execute(it);
    V('page 3 par le routeur (bouton persistant)', /\*\*21\.\*\*/.test(embedDe(it.mises[0]).description) && !/version précédente/.test(texte(it.reponses)), texte(it.mises[0]).slice(0, 200));

    it = fausse({ nom: 'comptage', sub: 'definir', options: { nombre: 41 }, user: 'u1' });
    await IC.execute(it);
    V('definir : refusé à un membre', /réservé au \*\*staff\*\*/.test(it.reponses[0]?.content) && etat().courant !== 41);
    it = fausse({ nom: 'comptage', sub: 'definir', options: { nombre: 41 }, user: 'staff' });
    await IC.execute(it);
    V('definir (staff) : compte à 41, dernier compteur oublié', etat().courant === 41 && etat().dernier_user === null && /fixé à \*\*41\*\*/.test(it.reponses[0].content));
    V('… les joueurs sont prévenus dans le salon', dernierEnvoi().content === '🛠️ Le staff a corrigé le compte : on en est à **41**. Le prochain est **42**.');
    V('… et c\'est journalisé', titreLog() === '🔢 Comptage corrigé');
    const suite = await poster('u1', '42');
    V('le compte reprend à 42', suite.reactions[0] === '✅');

    it = fausse({ nom: 'comptage', sub: 'reinitialiser', user: 'staff' });
    await IC.execute(it);
    V('reinitialiser : une confirmation d\'abord (boutons cpt:)', texte(ids(it.reponses[0])) === '["cpt:raz:staff:0","cpt:annuler:staff"]' && it.reponses[0].flags === 64 && etat().courant === 42);
    it = fausse({ type: 'bouton', customId: 'cpt:raz:staff:0', user: 'u1' });
    await IC.execute(it);
    V('un autre membre ne peut pas confirmer', /Seule la personne/.test(texte(it.reponses)) && etat().courant === 42);
    it = fausse({ type: 'bouton', customId: 'cpt:annuler:staff', user: 'staff' });
    await IC.execute(it);
    V('annuler : rien ne change', /annulée/.test(texte(it.mises[0])) && etat().courant === 42);
    it = fausse({ type: 'bouton', customId: 'cpt:raz:staff:0', user: 'staff' });
    await IC.execute(it);
    const e = etat();
    V('confirmer : compte, record et séries cassées à 0', e.courant === 0 && e.record === 0 && e.erreurs === 0 && /remis à zéro/.test(texte(it.mises[0])));
    V('… classement conservé, joueurs prévenus, journal', C.compterCompteursComptage('G1') === total && /remis le comptage à zéro/.test(dernierEnvoi().content) && titreLog() === '🔢 Comptage remis à zéro');
    it = fausse({ type: 'bouton', customId: 'cpt:raz:staff:1', user: 'staff' });
    await IC.execute(it);
    V('avec classement : le classement est vidé', C.compterCompteursComptage('G1') === 0);

    setGuildConfig('G1', 'comptage_channel_id', null);
    it = fausse({ type: 'bouton', customId: 'cpt:raz:staff:0', user: 'staff' });
    await IC.execute(it);
    V('salon retiré : le bouton revérifie et refuse', /coupé/.test(texte(it.reponses)));
    it = fausse({ nom: 'comptage', sub: 'definir', options: { nombre: 3 }, user: 'staff' });
    await IC.execute(it);
    V('… /comptage definir dit quoi faire', /Aucun salon de comptage/.test(it.reponses[0].content) && /\/config/.test(it.reponses[0].content));
    it = fausse({ nom: 'comptage', sub: 'info' });
    await IC.execute(it);
    V('… /comptage info le dit aussi', /Aucun salon de comptage/.test(embedDe(it.reponses[0]).description));
    setGuildConfig('G1', 'comptage_channel_id', 'CPT');

    V('guide : /comptage rangée dans Communauté', TUTO.CATEGORIES.find((c) => c.titre === 'Communauté').noms.includes('comptage'));
    V('commande ouverte à tous (staff vérifié à l\'exécution)', CMD.grade === 0 && !CMD.public && !CMD.guildModule);
    const json = CMD.data;
    V('4 sous-commandes', (json.subs || []).length === 4);
  }

  console.log('\n16) /config → 🔢 Comptage');
  {
    const src = fs.readFileSync(path.join(SRC, 'utils/configPanel.js'), 'utf8');
    V('catégorie dans cfgcat, CATEGORY_VIEWS et routeur cfgcpt:', /value: 'comptage'/.test(src) && /comptage: \(g\) => require\('\.\/comptageConfig'\)/.test(src) && /startsWith\('cfgcpt:'\)/.test(src));
    const P = require('../src/utils/configPanel');
    const options = P.mainView(guild).components[0].toJSON().components[0].options;
    V('menu cfgcat : ≤ 25 options, comptage inclus', options.length <= 25 && options.some((o) => o.value === 'comptage' && o.emoji === '🔢'));

    let it = fausse({ type: 'texte', customId: 'cfgcat', valeurs: ['comptage'], user: 'staff' });
    await IC.execute(it);
    const vue = it.mises[0];
    V('la catégorie s\'ouvre', embedDe(vue).title === '🔢 Configuration — Comptage', texte(it.reponses).slice(0, 200));
    const R = rangees(vue);
    V('≤ 5 rangées, ≤ 5 composants par rangée', R.length <= 5 && R.every((r) => r.components.length <= 5), String(R.length));
    V('identifiants cfg…, ≤ 100 signes, préfixe cfgcpt: (sauf le retour)', ids(vue).every((i) => i.length <= 100 && (i.startsWith('cfgcpt:') || i === 'cfgback')), texte(ids(vue)));
    V('salon (vide permis), rôle (vide permis), bascules, XP, remise à zéro', R[0].components[0].type === 8 && R[0].components[0].min_values === 0
      && R[2].components[0].type === 6 && R[2].components[0].min_values === 0
      && ['cfgcpt:b:meme', 'cfgcpt:b:maths', 'cfgcpt:b:reac', 'cfgcpt:b:suppr', 'cfgcpt:xp', 'cfgcpt:raz'].every((i) => ids(vue).includes(i)));
    V('état actuel affiché (nombre, record)', /Nombre actuel : \*\*/.test(embedDe(vue).description) && /Record : \*\*/.test(embedDe(vue).description));
    V('texte de carte < 4000 signes', embedDe(vue).description.length < 4000);

    it = fausse({ type: 'bouton', customId: 'cfgcpt:b:maths', user: 'u1' });
    await IC.execute(it);
    V('un membre est refusé par la garde du panneau', /réservé au \*\*staff\*\*/.test(texte(it.reponses)) && !getGuildConfig('G1').comptage_maths);
    it = fausse({ type: 'bouton', customId: 'cfgcpt:b:maths', user: 'staff' });
    await IC.execute(it);
    V('bascule calculs → activée, vue rafraîchie, journal', getGuildConfig('G1').comptage_maths === 1 && embedDe(it.mises[0]).title === '🔢 Configuration — Comptage' && titreLog() === '⚙️ Configuration modifiée');
    it = fausse({ type: 'bouton', customId: 'cfgcpt:b:maths', user: 'staff' });
    await IC.execute(it);
    V('… puis désactivée', getGuildConfig('G1').comptage_maths === 0);
    setGuildConfig('G1', 'comptage_reactions', null);
    it = fausse({ type: 'bouton', customId: 'cfgcpt:b:reac', user: 'staff' });
    await IC.execute(it);
    V('réactions : NULL vaut « actif », le clic les coupe', getGuildConfig('G1').comptage_reactions === 0);
    await IC.execute(fausse({ type: 'bouton', customId: 'cfgcpt:b:reac', user: 'staff' }));
    await IC.execute(fausse({ type: 'bouton', customId: 'cfgcpt:b:meme', user: 'staff' }));
    await IC.execute(fausse({ type: 'bouton', customId: 'cfgcpt:b:suppr', user: 'staff' }));
    const cfg = getGuildConfig('G1');
    V('les quatre bascules écrivent leur colonne', cfg.comptage_reactions === 1 && cfg.comptage_meme_personne === 1 && cfg.comptage_supprimer === 1);
    setGuildConfig('G1', 'comptage_meme_personne', 0);
    setGuildConfig('G1', 'comptage_supprimer', 0);

    await poster('u1', '1');
    await poster('u2', '2');
    it = fausse({ type: 'salon', customId: 'cfgcpt:salon', valeurs: ['GEN'], user: 'staff' });
    await IC.execute(it);
    V('choisir un salon : réglé, compte remis à 0', getGuildConfig('G1').comptage_channel_id === 'GEN' && etat().channel_id === 'GEN' && etat().courant === 0);
    V('… le nouveau salon est prévenu', /Ce salon devient le salon de comptage/.test(dernierEnvoi('GEN').content) && /\*\*1\*\*/.test(dernierEnvoi('GEN').content));
    V('… et c\'est journalisé', /Salon de comptage → <#GEN>/.test(embedDe(SALONS.LOGS.envois[SALONS.LOGS.envois.length - 1]).description));
    it = fausse({ type: 'salon', customId: 'cfgcpt:salon', valeurs: [], user: 'staff' });
    await IC.execute(it);
    V('vider le menu coupe le comptage', getGuildConfig('G1').comptage_channel_id === null && /le comptage est coupé/.test(embedDe(it.mises[0]).description));
    const coupe = await poster('u1', '1', 'GEN');
    V('… et plus rien n\'est compté', !coupe.reactions.length);
    await IC.execute(fausse({ type: 'salon', customId: 'cfgcpt:salon', valeurs: ['CPT'], user: 'staff' }));

    it = fausse({ type: 'role', customId: 'cfgcpt:role', valeurs: ['HAUT'], user: 'staff' });
    await IC.execute(it);
    V('rôle au-dessus du mien → refusé, expliqué', !getGuildConfig('G1').comptage_role_erreur && /au-dessus de mon rôle/.test(texte(it.suivis)), texte(it.suivis));
    it = fausse({ type: 'role', customId: 'cfgcpt:role', valeurs: ['GERE'], user: 'staff' });
    await IC.execute(it);
    V('rôle d\'intégration → refusé', !getGuildConfig('G1').comptage_role_erreur && /intégration/.test(texte(it.suivis)));
    it = fausse({ type: 'role', customId: 'cfgcpt:role', valeurs: ['RERR'], user: 'staff' });
    await IC.execute(it);
    V('rôle valable → réglé, présélectionné dans le menu', getGuildConfig('G1').comptage_role_erreur === 'RERR' && texte(rangees(it.mises[0])[2].components[0].default_values) === '[{"id":"RERR","type":"role"}]');
    await IC.execute(fausse({ type: 'role', customId: 'cfgcpt:role', valeurs: [], user: 'staff' }));
    V('menu vidé → aucun rôle', getGuildConfig('G1').comptage_role_erreur === null);

    it = fausse({ type: 'bouton', customId: 'cfgcpt:xp', user: 'staff' });
    await IC.execute(it);
    V('XP : le formulaire s\'ouvre (cfgcpt:xpmodal)', it.modales[0]?.custom_id === 'cfgcpt:xpmodal' && it.modales[0].components[0].components[0].custom_id === 'xp');
    it = fausse({ type: 'modal', customId: 'cfgcpt:xpmodal', champs: { xp: '25' }, user: 'staff' });
    await IC.execute(it);
    V('XP 25 enregistrée, vue rafraîchie', getGuildConfig('G1').comptage_xp === 25 && /XP par bon nombre : \*\*25\*\*/.test(embedDe(it.mises[0]).description));
    for (const mauvais of ['5000', 'abc', '-3', '']) {
      it = fausse({ type: 'modal', customId: 'cfgcpt:xpmodal', champs: { xp: mauvais }, user: 'staff' });
      await IC.execute(it);
    }
    V('valeurs invalides refusées (5000, abc, -3, vide)', getGuildConfig('G1').comptage_xp === 25 && /entre \*\*0\*\* et \*\*1000\*\*/.test(texte(it.reponses)));
    setGuildConfig('G1', 'comptage_xp', 0);

    await poster('u1', '1');
    it = fausse({ type: 'bouton', customId: 'cfgcpt:raz', user: 'staff' });
    await IC.execute(it);
    V('remise à zéro : confirmation demandée d\'abord', ids(it.mises[0]).includes('cfgcpt:razok') && ids(it.mises[0]).includes('cfgcpt:vue') && etat().courant === 1);
    it = fausse({ type: 'bouton', customId: 'cfgcpt:vue', user: 'staff' });
    await IC.execute(it);
    V('annuler revient à la vue', ids(it.mises[0]).includes('cfgcpt:raz') && etat().courant === 1);
    it = fausse({ type: 'bouton', customId: 'cfgcpt:razok', user: 'staff' });
    await IC.execute(it);
    V('confirmer : compte et record à 0, joueurs prévenus, journal', etat().courant === 0 && etat().record === 0 && /remis le comptage à zéro/.test(dernierEnvoi().content) && titreLog() === '🔢 Comptage remis à zéro');
    it = fausse({ type: 'bouton', customId: 'cfgcpt:inconnu', user: 'staff' });
    await IC.execute(it);
    V('identifiant inconnu → la vue du jour, sans erreur', embedDe(it.mises[0]).title === '🔢 Configuration — Comptage');
    const confirmation = CC.vueConfigComptage(guild, { confirmer: true });
    V('vue de confirmation : toujours ≤ 5 rangées', rangees(confirmation).length <= 5);

    // 🩺 Une permission qui manque se voit dans la vue (Gérer les rôles ici).
    const { PermissionFlagsBits } = require('discord.js');
    setGuildConfig('G1', 'comptage_role_erreur', 'RERR');
    guild.members.me.permissionsIn = () => ({ has: (b) => b !== PermissionFlagsBits.ManageRoles });
    const diag = embedDe(CC.vueConfigComptage(guild)).description;
    V('permission manquante signalée, avec quoi faire', /Il me manque des permissions/.test(diag) && /\*\*Gérer les rôles\*\*/.test(diag) && /Ajoutez-les/.test(diag), diag.slice(-200));
    guild.members.me.permissionsIn = () => ({ has: () => true });
    V('… et rien quand tout y est', !/Il me manque/.test(embedDe(CC.vueConfigComptage(guild)).description));
    delete guild.members.me.permissionsIn;
    setGuildConfig('G1', 'comptage_role_erreur', null);
  }

  console.log('\n17) Rôle d\'erreur : jamais une porte vers un rôle à pouvoirs');
  {
    const role = (valeurs, user) => fausse({ type: 'role', customId: 'cfgcpt:role', valeurs, user });
    let it = role(['ADMINROLE'], 'modo');
    await IC.execute(it);
    V('un modo (grade staff) ouvre bien le panneau, mais le rôle d\'erreur lui est refusé', !getGuildConfig('G1').comptage_role_erreur
      && /réservé à l'\*\*administration\*\*/.test(texte(it.suivis)) && it.mises.length === 1, texte(it.suivis).slice(0, 200));
    it = role(['RERR'], 'modo');
    await IC.execute(it);
    V('… même un rôle anodin : l\'administration seulement', !getGuildConfig('G1').comptage_role_erreur);
    it = role(['ADMINROLE'], 'staff');
    await IC.execute(it);
    V('administration : un rôle « Administrateur » est refusé, et l\'explication nomme la permission', !getGuildConfig('G1').comptage_role_erreur
      && /permissions sensibles : Administrateur/.test(texte(it.suivis)) && /sans aucun pouvoir/.test(texte(it.suivis)), texte(it.suivis).slice(0, 300));
    it = role(['BANROLE'], 'staff');
    await IC.execute(it);
    V('… un rôle qui peut bannir aussi', !getGuildConfig('G1').comptage_role_erreur && /Bannir des membres/.test(texte(it.suivis)));
    it = role(['ENTRE'], 'staff');
    await IC.execute(it);
    V('… un rôle au-dessus de celui qui règle aussi', !getGuildConfig('G1').comptage_role_erreur && /votre rôle le plus haut/.test(texte(it.suivis)));
    it = role(['R2'], 'staff');
    await IC.execute(it);
    V('… un rôle sans pouvoir, sous les deux : accepté', getGuildConfig('G1').comptage_role_erreur === 'R2');
    V('le contrôle du site refuse les mêmes rôles', /permissions sensibles \(Administrateur\)/.test(C.refusRoleErreurComptage(guild, 'ADMINROLE') || '')
      && /Bannir des membres/.test(C.refusRoleErreurComptage(guild, 'BANROLE') || '') && C.refusRoleErreurComptage(guild, 'R2') === null);
    V('… branché sur la validation de comptage_role_erreur (managedApi)', /key === 'comptage_role_erreur' \? require\('\.\/utils\/comptage'\)\.refusRoleErreurComptage/.test(fs.readFileSync(path.join(SRC, 'managedApi.js'), 'utf8')));

    // Le rôle réglé AVANT ce verrou (ou dont les permissions ont changé
    // depuis) : il n'est plus donné. Le scénario de la revue : un modo
    // compte « 1 » puis « 2 » et repartait Administrateur.
    setGuildConfig('G1', 'comptage_role_erreur', 'ADMINROLE');
    C.definirNombreComptage('G1', 0, 'CPT');
    await poster('modo', '1');
    const deux = await poster('modo', '2');
    V('le modo casse la série exprès : il ne reçoit PAS le rôle « Administrateur »', deux.reactions[0] === '❌' && !membre('modo').roles.cache.has('ADMINROLE'));
    setGuildConfig('G1', 'comptage_role_erreur', null);

    // Un rôle staff ou admin DU BOT ne porte souvent aucune permission
    // Discord, mais donne le grade (/ban, /kick, /mute) : jamais un rôle
    // d'erreur, ni par /config, ni par le site, ni au moment de le donner.
    setGuildConfig('G1', 'staff_role_ids', JSON.stringify(['EQUIPE']));
    setGuildConfig('G1', 'admin_role_id', 'DIRECTION');
    it = role(['EQUIPE'], 'staff');
    await IC.execute(it);
    V('/config : un rôle staff du bot, sans permission Discord → refusé, expliqué', !getGuildConfig('G1').comptage_role_erreur
      && /\*\*Équipe\*\* : c'est un rôle staff du bot/.test(texte(it.suivis)) && /avec son grade/.test(texte(it.suivis)), texte(it.suivis).slice(0, 300));
    it = role(['DIRECTION'], 'staff');
    await IC.execute(it);
    V('… un rôle d\'administration du bot aussi', !getGuildConfig('G1').comptage_role_erreur && /rôle d'administration du bot/.test(texte(it.suivis)));
    V('le contrôle du site refuse les deux', /rôle staff du bot/.test(C.refusRoleErreurComptage(guild, 'EQUIPE') || '')
      && /rôle d'administration du bot/.test(C.refusRoleErreurComptage(guild, 'DIRECTION') || '') && C.refusRoleErreurComptage(guild, 'R2') === null);
    // Réglé avant ce verrou, ou ajouté au staff du bot APRÈS le réglage.
    setGuildConfig('G1', 'comptage_role_erreur', 'EQUIPE');
    C.definirNombreComptage('G1', 3, 'CPT');
    const fautif = await poster('u2', '9');
    V('… et déjà réglé : qui casse la série ne le reçoit PAS (grade du membre inchangé)', fautif.reactions[0] === '❌'
      && !membre('u2').roles.cache.has('EQUIPE') && etat().role_fautif === '' && getGrade(membre('u2')) === GRADES.EVERYONE,
      texte([fautif.reactions, etat().role_fautif]));
    setGuildConfig('G1', 'comptage_role_erreur', null);
    setGuildConfig('G1', 'staff_role_ids', null);
    setGuildConfig('G1', 'admin_role_id', null);
  }

  console.log('\n18) Rôle d\'erreur retiré quand le staff le change, le vide ou coupe le comptage');
  {
    const casser = async (u) => { C.definirNombreComptage('G1', 3, 'CPT'); return poster(u, '9'); };
    const roleA = (u, r) => membre(u).roles.cache.has(r);
    await IC.execute(fausse({ type: 'role', customId: 'cfgcpt:role', valeurs: ['RERR'], user: 'staff' }));
    await casser('u1');
    V('u1 casse : il porte RERR, noté en base', roleA('u1', 'RERR') && etat().role_fautif === 'RERR' && etat().dernier_fautif === 'u1');
    await IC.execute(fausse({ type: 'role', customId: 'cfgcpt:role', valeurs: ['R2'], user: 'staff' }));
    V('le staff passe à R2 : u1 perd RERR tout de suite', !roleA('u1', 'RERR') && getGuildConfig('G1').comptage_role_erreur === 'R2' && !etat().dernier_fautif);
    await casser('u2');
    V('u2 casse : il reçoit R2', roleA('u2', 'R2') && etat().role_fautif === 'R2');
    await IC.execute(fausse({ type: 'role', customId: 'cfgcpt:role', valeurs: ['R2'], user: 'staff' }));
    V('re-choisir le même rôle ne retire rien', roleA('u2', 'R2'));
    await IC.execute(fausse({ type: 'role', customId: 'cfgcpt:role', valeurs: [], user: 'staff' }));
    V('le staff vide le rôle : u2 perd R2', !roleA('u2', 'R2') && getGuildConfig('G1').comptage_role_erreur === null);
    await casser('u3');
    V('sans rôle d\'erreur : rien n\'est donné, rien n\'est noté', !roleA('u3', 'R2') && etat().role_fautif === '' && etat().dernier_fautif === 'u3');

    // Changé hors /config (le site) : au prochain fautif, l'ancien perd le
    // rôle qu'il a VRAIMENT reçu, pas celui du réglage du jour.
    setGuildConfig('G1', 'comptage_role_erreur', 'RERR');
    await casser('u1');
    setGuildConfig('G1', 'comptage_role_erreur', 'R2');
    await casser('u2');
    V('rôle changé depuis le site : au fautif suivant, u1 perd RERR et u2 reçoit R2', !roleA('u1', 'RERR') && roleA('u2', 'R2') && !roleA('u1', 'R2'));
    setGuildConfig('G1', 'comptage_role_erreur', null);
    await casser('u3');
    V('… et vidé depuis le site : au fautif suivant, u2 perd R2', !roleA('u2', 'R2') && !roleA('u3', 'R2'));

    // Comptage coupé dans /config : le dernier fautif est libéré.
    setGuildConfig('G1', 'comptage_role_erreur', 'RERR');
    await casser('u1');
    V('u1 porte RERR', roleA('u1', 'RERR'));
    await IC.execute(fausse({ type: 'salon', customId: 'cfgcpt:salon', valeurs: [], user: 'staff' }));
    V('le staff coupe le comptage : u1 perd RERR', !roleA('u1', 'RERR') && getGuildConfig('G1').comptage_channel_id === null);
    await IC.execute(fausse({ type: 'salon', customId: 'cfgcpt:salon', valeurs: ['CPT'], user: 'staff' }));
    setGuildConfig('G1', 'comptage_role_erreur', null);
  }

  console.log('\n19) « 1 000 » : les milliers à la française');
  {
    const L = (t) => C.lireNombreComptage(t);
    V('« 1 000 », insécable, fine insécable → 1000', L('1 000').valeur === 1000 && L('1 000').valeur === 1000 && L('1 000').valeur === 1000);
    V('« 12 345 » → 12345, « 12 345 678 » → 12345678', L('12 345').valeur === 12345 && L('12 345 678').valeur === 12345678);
    V('« 5 6 », « 1 0000 » → hors-jeu (ambigu), jamais un 5 ou un 1', L('5 6').raison === 'ambigu' && L('1 0000').raison === 'ambigu');
    V('« 1 000,5 » → décimal ; « 5 xD » et « 5⏎6 » → 5', L('1 000,5').raison === 'decimal' && L('5 xD').valeur === 5 && L('5\n6').valeur === 5);
    V('calcul : « 2 × 1 000 » → 2000', C.lireNombreComptage('2 × 1 000', { maths: true }).valeur === 2000);
    C.definirNombreComptage('G1', 999, 'CPT');
    const mille = await poster('u1', '1 000');
    V('à 999, « 1 000 » est juste (✅, compte à 1000), sans casser la série', ['✅', '💯', '🏆'].includes(mille.reactions[0]) && etat().courant === 1000 && etat().erreurs !== undefined, texte(mille.reactions));
    const fine = await poster('u2', '1 001');
    V('… « 1 001 » avec une fine insécable aussi', ['✅', '🏆'].includes(fine.reactions[0]) && etat().courant === 1001);
    const ambigu = await poster('u1', '1 0 0 2');
    V('« 1 0 0 2 » : hors-jeu, le compte ne bouge pas', !ambigu.reactions.length && etat().courant === 1001);
  }

  console.log('\n20) Un nombre avec une image garde sa place dans la file');
  {
    // L'anti-scam télécharge l'image : 80 ms, pendant lesquelles un autre
    // message arrive.
    const SI = require('../src/utils/scamImages');
    const scanOrig = SI.scanMessage;
    let arnaque = null;
    SI.scanMessage = async (m) => { await attendre(80); return m.id === arnaque; };
    delete require.cache[require.resolve('../src/events/messageCreate')];
    const MC3 = require('../src/events/messageCreate');
    const avecImage = (user, contenu) => {
      const m = fauxMessage({ user, contenu });
      m.attachments = { size: 1, values: () => [{ url: 'https://cdn.test/x.png', contentType: 'image/png' }][Symbol.iterator]() };
      return m;
    };
    C.definirNombreComptage('G1', 5, 'CPT');
    const six = avecImage('u1', '6');
    const sept = fauxMessage({ user: 'u2', contenu: '7' });
    await Promise.all([MC3.execute(six), (async () => { await attendre(10); return MC3.execute(sept); })()]);
    V('« 6 » + image puis « 7 » : jugés dans l\'ordre d\'arrivée, deux ✅', six.reactions[0] === '✅' && sept.reactions[0] === '✅' && etat().courant === 7,
      texte([six.reactions, sept.reactions, etat().courant]));
    V('… et personne n\'a « cassé la série »', !/a cassé la série à \*\*5\*\*/.test(dernierEnvoi().content || ''));

    // L'anti-scam efface le nombre : sa place est rendue, rien n'est jugé.
    const huitArnaque = avecImage('u3', '8');
    arnaque = huitArnaque.id;
    const huit = fauxMessage({ user: 'u1', contenu: '8' });
    await Promise.all([MC3.execute(huitArnaque), (async () => { await attendre(10); return MC3.execute(huit); })()]);
    V('un nombre effacé par l\'anti-scam ne compte pas ; le suivant est jugé normalement', !huitArnaque.reactions.length && huit.reactions[0] === '✅' && etat().courant === 8,
      texte([huitArnaque.reactions, huit.reactions, etat().courant]));

    // ⏱️ La sanction de l'anti-scam (preuves, effacement, ban sur CHAQUE
    // serveur, envois des preuves) peut durer plus que l'attente de la file.
    // Le nombre était alors jugé quand même : une arnaque « 18+ free nitro »
    // cassait la série. Ici le VRAI scanMessage, une blacklist qui traîne, et
    // l'attente de la file réduite de 10 s à 150 ms.
    SI.scanMessage = scanOrig;
    const BT = require('../src/utils/botTeam');
    const btOrig = { isImmune: BT.isImmune, applyBlacklist: BT.applyBlacklist };
    const fetchOrig = global.fetch;
    const minuteurOrig = global.setTimeout;
    const AFFICHE = Buffer.from('affiche-de-scam-du-comptage');
    const empreinte = require('crypto').createHash('sha256').update(AFFICHE).digest('hex');
    SI.insertSample.run('G1', 'faux nitro', empreinte, null, 'staff', '2026-01-01');
    const echantillon = SI.listSamples.all('G1').find((s) => s.sha256 === empreinte);
    const traces = [];
    try {
      global.fetch = async () => ({ ok: true, arrayBuffer: async () => AFFICHE });
      global.setTimeout = (f, ms, ...a) => minuteurOrig(f, ms === 10_000 ? 150 : ms, ...a);
      BT.isImmune = async () => false;
      BT.applyBlacklist = async () => { traces.push('blacklist'); await attendre(400); return { banned: 1, dmOk: false }; };
      const affiche = (user, contenu) => {
        const m = fauxMessage({ user, contenu });
        m.attachments = { size: 1, values: () => [{ id: 'A1', name: 'nitro.png', url: 'https://cdn.test/nitro.png', contentType: 'image/png', size: AFFICHE.length }][Symbol.iterator]() };
        const effacer = m.delete;
        m.delete = async () => { traces.push('effacement'); return effacer(); };
        return m;
      };
      const rechargerMC = () => {
        delete require.cache[require.resolve('../src/events/messageCreate')];
        return require('../src/events/messageCreate');
      };

      let MC4 = rechargerMC();
      C.definirNombreComptage('G1', 57, 'CPT');
      let envoisAvant = SALONS.CPT.envois.length;
      const arnaque = affiche('u3', '18+ free nitro');
      const cinquanteHuit = fauxMessage({ user: 'u1', contenu: '58' });
      await Promise.all([MC4.execute(arnaque), (async () => { await attendre(100); return MC4.execute(cinquanteHuit); })()]);
      V('arnaque « 18+ … », sanction plus longue que l\'attente : effacée, blacklistée, jamais jugée',
        arnaque.supprime && traces.includes('blacklist') && !arnaque.reactions.length, texte([arnaque.reactions, traces]));
      V('… le « 58 » qui suit est juste, et personne n\'a « cassé la série »', cinquanteHuit.reactions[0] === '✅' && etat().courant === 58
        && !SALONS.CPT.envois.slice(envoisAvant).some((e) => /a cassé la série/.test(e.content || '')),
        texte([cinquanteHuit.reactions, etat().courant, SALONS.CPT.envois.slice(envoisAvant).map((e) => e.content)]));

      // Le verdict part AVANT l'effacement et la blacklist — et aussi pour
      // un membre immunisé, dont l'affiche est effacée tout de même.
      traces.length = 0;
      const verdict = (e) => traces.push(`verdict:${e?.id}`);
      await SI.scanMessage(affiche('u3', '59'), { surCorrespondance: verdict });
      V('anti-scam : le verdict précède l\'effacement et la blacklist', texte(traces) === texte([`verdict:${echantillon?.id}`, 'effacement', 'blacklist']), texte(traces));
      traces.length = 0;
      BT.isImmune = async () => true;
      const immunise = await SI.scanMessage(affiche('u3', '59'), { surCorrespondance: verdict });
      V('… chemin « immunisé » compris (effacé sans sanction)', immunise === true && texte(traces) === texte([`verdict:${echantillon?.id}`, 'effacement']), texte(traces));

      // Filet : l'image n'est pas encore reconnue (téléchargement plus long
      // que l'attente), mais le message a déjà disparu — Discord l'a annoncé.
      // À l'expiration de l'attente, il n'est pas jugé.
      SI.scanMessage = async () => { await attendre(400); return false; };
      MC4 = rechargerMC();
      C.definirNombreComptage('G1', 57, 'CPT');
      envoisAvant = SALONS.CPT.envois.length;
      const lente = affiche('u3', '18+ free nitro');
      const encore58 = fauxMessage({ user: 'u1', contenu: '58' });
      await Promise.all([
        MC4.execute(lente),
        (async () => { await attendre(40); await lente.delete(); return C.surSuppressionComptage(lente); })(),
        (async () => { await attendre(100); return MC4.execute(encore58); })(),
      ]);
      V('filet : un nombre effacé avant la fin de l\'attente n\'est pas jugé, le « 58 » suivant est juste',
        !lente.reactions.length && encore58.reactions[0] === '✅' && etat().courant === 58
        && !SALONS.CPT.envois.slice(envoisAvant).some((e) => /a cassé la série/.test(e.content || '')),
        texte([lente.reactions, encore58.reactions, etat().courant]));
    } finally {
      global.fetch = fetchOrig;
      global.setTimeout = minuteurOrig;
      Object.assign(BT, btOrig);
      if (echantillon) SI.deleteSample.run(echantillon.id, 'G1');
      SI.scanMessage = scanOrig;
      delete require.cache[require.resolve('../src/events/messageCreate')];
      MC = require('../src/events/messageCreate');
    }
  }

  console.log('\n21) Purge (suppression en masse) du dernier nombre');
  {
    const MDB = require('../src/events/messageDeleteBulk');
    C.definirNombreComptage('G1', 0, 'CPT');
    await poster('u1', '1');
    const m2 = await poster('u2', '2');
    const avant = SALONS.CPT.envois.length;
    const lot = new Map([[m2.id, { id: m2.id, partial: true, author: null }], ['AUTRE1', { id: 'AUTRE1', partial: true, author: null }]]);
    await MDB.execute(lot, SALONS.CPT);
    V('le dernier nombre emporté par une purge → alerte, comme une suppression simple', SALONS.CPT.envois.length === avant + 1
      && dernierEnvoi().content === '⚠️ Le dernier nombre, **2**, a été effacé avec d\'autres messages (il était de <@u2>). Le prochain est **3**.', dernierEnvoi().content);
    V('… le compte ne bouge pas, le message est oublié', etat().courant === 2 && etat().dernier_message_id === null);
    await MDB.execute(lot, SALONS.CPT);
    V('… une seule alerte', SALONS.CPT.envois.length === avant + 1);
    const m3 = await poster('u1', '3');
    await MDB.execute(new Map([['VIEUX', { id: 'VIEUX' }]]), SALONS.CPT);
    V('une purge qui n\'emporte pas le dernier nombre ne dit rien', SALONS.CPT.envois.length === avant + 1 && etat().dernier_message_id === m3.id);
    await MDB.execute(new Map([[m3.id, { id: m3.id }]]), SALONS.GEN);
    V('… ni une purge dans un autre salon', etat().dernier_message_id === m3.id);
    V('le journal de la purge suit son cours', titreLog() === '🧹 Suppression en masse');
  }

  console.warn = warnOrig;
  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})().catch((e) => { console.warn = warnOrig; console.error(e); console.log('\n0 réussis, 1 échoués'); process.exit(1); });
