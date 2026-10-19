// 💍 Avantages du mariage — contrat B (bonus d'XP de couple), lune de miel,
// alliances, flamme du bisou à l'heure de Paris, nom de couple, /lc entre
// conjoints, mensiversaires annoncés une seule fois, mot doux, divorce qui
// efface tout, et la catégorie /config → 💍 Mariage.
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'mariage-avantages-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');
delete process.env.GIPHY_KEY;

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  return vrai.apply(this, arguments);
};

const { db, setGuildConfig, getGuildConfig } = require('../src/database');
const C = require('../src/utils/couple');
const VIE = require('../src/utils/vieDeCouple');
const CFGM = require('../src/utils/configMariage');
const P = require('../src/utils/configPanel');
const { getLevels } = require('../src/utils/levels');
const LC = require('../src/commands/lc');
const MAR = require('../src/commands/mariage');
const IC = require('../src/events/interactionCreate');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };
const texte = (o) => JSON.stringify(o, (k, v) => (Buffer.isBuffer(v) ? `<png ${v.length}>` : v));
const warnOrig = console.warn;
console.warn = () => {};
const vraiFetch = global.fetch;
global.fetch = async () => ({ ok: false, status: 404 });

const MIN = 60_000;
const JOUR = 86_400_000;

// ── Faux Discord ────────────────────────────────────────────────────────
const personne = (id, nom) => ({ id, username: nom, displayName: nom, globalName: nom, bot: false, tag: `${nom}#0`, displayAvatarURL: () => `https://cdn.test/${id}.png` });
const USERS = {
  u1: personne('u1', 'Alice'), u2: personne('u2', 'Bob'), u3: personne('u3', 'Chloé'),
  u4: personne('u4', 'Kirito'), u5: personne('u5', 'Asuna'), u6: personne('u6', 'Roméo'), u7: personne('u7', 'Juliette'),
  staff: personne('staff', 'Modo'),
};
function salon(id) {
  return { id, envois: [], isTextBased: () => true, async send(m) { this.envois.push(m); return { id: `m${this.envois.length}`, ...m }; } };
}
const SALONS = { FETE: salon('FETE'), LOGS: salon('LOGS'), AUTRE: salon('AUTRE') };
function serveur(id, ids) {
  const cache = new Map(ids.map((u) => [u, { id: u, user: USERS[u], displayName: USERS[u].displayName }]));
  return { id, name: `Serveur ${id}`, iconURL: () => null, members: { cache, fetch: async (u) => cache.get(u) || null }, channels: { fetch: async (c) => SALONS[c] || null } };
}
const G1 = serveur('G1', ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'staff']);
const G2 = serveur('G2', ['u1', 'u2']);
const G3 = serveur('G3', ['u6']); // Juliette n'y est pas
const client = {
  user: { id: 'bot', username: 'Bot' },
  users: { fetch: async (id) => USERS[id] || null, cache: new Map() },
  channels: { fetch: async (id) => SALONS[id] || null },
  guilds: { cache: new Map([['G1', G1], ['G2', G2], ['G3', G3]]) },
  commands: new Map([['mariage', MAR], ['lc', LC]]),
};

function fausse({ user = 'u1', guild = G1, type = 'commande', nom = 'mariage', sub = null, strings = {}, users = {}, customId = null, valeurs = [], champs = {}, staff = false, message = null } = {}) {
  return {
    client, guild, guildId: guild.id, channelId: 'GEN', locale: 'fr', user: USERS[user], customId, values: valeurs, commandName: nom,
    member: { id: user, user: USERS[user], guild, roles: { cache: new Map() }, permissions: { has: () => staff } },
    deferred: false, replied: false,
    message: message || { id: 'MSG', components: [], embeds: [{}], flags: 0, createdTimestamp: Date.now() },
    inGuild: () => true, isAutocomplete: () => false, isChatInputCommand: () => type === 'commande',
    isButton: () => type === 'bouton', isModalSubmit: () => type === 'modal', isFromMessage: () => type === 'modal',
    isMessageComponent: () => type === 'bouton' || type === 'menu', isStringSelectMenu: () => type === 'menu',
    isChannelSelectMenu: () => type === 'salon', isRoleSelectMenu: () => false, isUserSelectMenu: () => false,
    isAnySelectMenu: () => type === 'menu' || type === 'salon',
    options: {
      getSubcommand: () => sub,
      getString: (n) => (strings[n] === undefined ? null : strings[n]),
      getUser: (n) => (users[n] ? USERS[users[n]] : null),
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
const premiere = (it) => it.reponses[0] || {};
const embedDe = (p) => p?.embeds?.[0]?.data || p?.embeds?.[0] || {};
const descDe = (p) => embedDe(p).description || '';
const idsDe = (p) => (p?.components || []).flatMap((r) => (r.toJSON ? r.toJSON() : r).components || []).map((c) => c.custom_id).filter(Boolean);

const insererUnion = db.prepare('INSERT OR REPLACE INTO mariages (a, b, depuis, guild_id) VALUES (?, ?, ?, ?)');
function unir(x, y, depuis) {
  const [a, b] = [x, y].sort();
  insererUnion.run(a, b, new Date(depuis).toISOString(), 'G1');
  C.invaliderUnionsCouple();
}

(async () => {
  console.log('\n1) Contrat B : forme et cas sans couple');
  {
    V('noterActiviteCouple et bonusXpCouple exportés', typeof C.noterActiviteCouple === 'function' && typeof C.bonusXpCouple === 'function');
    const r = C.bonusXpCouple('G1', 'u3', 'text');
    V('membre non marié → null (synchrone, pas une promesse)', r === null);
    let leve = false;
    try {
      C.noterActiviteCouple(undefined, null);
      C.noterActiviteCouple('G1', { bizarre: true });
      V('arguments absurdes → null, jamais d\'exception', C.bonusXpCouple(null, undefined, 42) === null && C.bonusXpCouple('G1', {}, 'text') === null);
    } catch { leve = true; }
    V('… et aucune exception levée', !leve);
  }

  console.log('\n2) Mariage par les boutons : le cache des unions suit');
  setGuildConfig('G1', 'interact_enabled', 1);
  {
    C.noterActiviteCouple('G1', 'u2'); // avant le mariage : non retenu
    V('bonus impossible avant le mariage', C.bonusXpCouple('G1', 'u1', 'text') === null);
    await MAR.execute(fausse({ sub: 'demander', users: { membre: 'u2' } }));
    await MAR.handleButton(fausse({ user: 'u2', type: 'bouton', customId: 'mar:oui:u1:u2' }));
    V('u1 et u2 mariés', MAR.mariageDe('u1')?.conjoint === 'u2');
    V('le cache voit l\'union tout de suite (invalidé au mariage)', C.unionCouple('u1')?.conjoint === 'u2' && C.unionCouple('u2')?.conjoint === 'u1');
    V('colonnes neuves à NULL sur un serveur existant : défauts appliqués', getGuildConfig('G1').mariage_bonus_xp === null && C.reglagesCouple(getGuildConfig('G1')).bonus === 10);
  }

  console.log('\n3) Bonus d\'XP de couple : actif, inactif, autre serveur, réglages');
  {
    const T = Date.now();
    V('conjoint pas encore actif → null', C.bonusXpCouple('G1', 'u1', 'text', T) === null);
    C.noterActiviteCouple('G1', 'u2', T);
    const b = C.bonusXpCouple('G1', 'u1', 'text', T + MIN);
    V('conjoint actif il y a 1 min → +20 % (10 % doublé par la lune de miel)', b?.pourcent === 20, texte(b));
    V('… avec une raison lisible', /Couple actif/.test(b?.raison) && /lune de miel/.test(b?.raison), b?.raison);
    V('vocal aussi', C.bonusXpCouple('G1', 'u1', 'voice', T + MIN)?.pourcent === 20);
    V('conjoint actif il y a 11 min → null (fenêtre de 10 min)', C.bonusXpCouple('G1', 'u1', 'text', T + 11 * MIN) === null);
    V('source « couple » (le bisou) et « admin » → jamais de bonus', C.bonusXpCouple('G1', 'u1', 'couple', T + MIN) === null && C.bonusXpCouple('G1', 'u1', 'admin', T + MIN) === null);

    const T2 = T + 2 * 60 * MIN;
    C.noterActiviteCouple('G2', 'u2', T2);
    V('conjoint actif sur UN AUTRE serveur → pas de bonus ici', C.bonusXpCouple('G1', 'u1', 'text', T2 + MIN) === null);
    V('… ni là-bas tant que le module Interactions y est coupé', C.bonusXpCouple('G2', 'u1', 'text', T2 + MIN) === null);
    setGuildConfig('G2', 'interact_enabled', 1);
    V('… et là-bas une fois activé', C.bonusXpCouple('G2', 'u1', 'text', T2 + MIN)?.pourcent === 20);

    C.noterActiviteCouple('G1', 'u2', T2);
    setGuildConfig('G1', 'mariage_actif_minutes', 30);
    V('fenêtre réglée à 30 min → actif à 20 min', C.bonusXpCouple('G1', 'u1', 'text', T2 + 20 * MIN)?.pourcent === 20);
    setGuildConfig('G1', 'mariage_actif_minutes', null);
    V('… et retour à 10 min par défaut', C.bonusXpCouple('G1', 'u1', 'text', T2 + 20 * MIN) === null);
    setGuildConfig('G1', 'mariage_bonus_xp', 25);
    V('bonus réglé à 25 % → 50 % en lune de miel', C.bonusXpCouple('G1', 'u1', 'text', T2 + MIN)?.pourcent === 50);
    setGuildConfig('G1', 'mariage_bonus_xp', 0);
    V('bonus à 0 % → coupé', C.bonusXpCouple('G1', 'u1', 'text', T2 + MIN) === null);
    setGuildConfig('G1', 'mariage_bonus_xp', 10);
    setGuildConfig('G1', 'mariage_avantages', 0);
    V('avantages coupés → null', C.bonusXpCouple('G1', 'u1', 'text', T2 + MIN) === null);
    setGuildConfig('G1', 'mariage_avantages', 1);
    setGuildConfig('G1', 'interact_enabled', 0);
    V('module Interactions coupé → null', C.bonusXpCouple('G1', 'u1', 'text', T2 + MIN) === null);
    setGuildConfig('G1', 'interact_enabled', 1);
    setGuildConfig('G1', 'mariage_lune_de_miel_jours', 0);
    V('lune de miel à 0 jour → bonus simple (10 %)', C.bonusXpCouple('G1', 'u1', 'text', T2 + MIN)?.pourcent === 10);
    setGuildConfig('G1', 'mariage_lune_de_miel_jours', null);
  }

  console.log('\n4) Lune de miel et alliances');
  {
    const debut = Date.UTC(2026, 0, 1, 12);
    const noms = [0, 6, 7, 29, 30, 99, 100, 365, 2000].map((j) => C.allianceCouple(new Date(debut).toISOString(), debut + j * JOUR + 1000).nom);
    V('paliers : Fer → Argent (7 j) → Or (30 j) → Diamant (100 j) → Éternelle (365 j)',
      noms.join(',') === 'Fer,Fer,Argent,Argent,Or,Or,Diamant,Éternelle,Éternelle', noms.join(','));
    const fer = C.allianceCouple(new Date(debut).toISOString(), debut + 3 * JOUR);
    V('Fer : Argent dans 4 jours', fer.suivant?.nom === 'Argent' && fer.joursAvantSuivant === 4);
    V('Éternelle : plus de palier suivant', C.allianceCouple(new Date(debut).toISOString(), debut + 400 * JOUR).suivant === null);
    const lune = C.luneDeMielCouple(new Date(debut).toISOString(), 7, debut + 6.5 * JOUR);
    V('lune de miel : encore 1 jour à 6,5 j', lune.active && lune.joursRestants === 1);
    V('… finie au 7e jour', !C.luneDeMielCouple(new Date(debut).toISOString(), 7, debut + 7 * JOUR).active);

    unir('u4', 'u5', Date.now() - 8 * JOUR);
    const T = Date.now();
    C.noterActiviteCouple('G1', 'u5', T);
    const b = C.bonusXpCouple('G1', 'u4', 'text', T);
    V('8 jours de mariage : plus de lune de miel, alliance d\'argent → 10 + 1 = 11 %', b?.pourcent === 11, texte(b));
    V('… la raison cite l\'alliance, pas la lune de miel', /argent/.test(b?.raison) && !/lune/.test(b?.raison), b?.raison);
    const r = C.reglagesCouple(getGuildConfig('G1'));
    const vieux = C.calculBonusCouple({ depuis: new Date(T - 400 * JOUR).toISOString() }, r, T);
    V('400 jours : alliance éternelle → 10 + 5 = 15 %', vieux.pourcent === 15 && vieux.alliance.cle === 'eternelle');
    const jeunes = C.calculBonusCouple({ depuis: new Date(T - 2 * JOUR).toISOString() }, r, T);
    V('2 jours : lune de miel, alliance de fer → 20 %', jeunes.pourcent === 20 && jeunes.lune.joursRestants === 5);
  }

  console.log('\n5) Flamme du couple : jours de Paris, série, jour manqué, record');
  {
    V('jour de Paris : 22 h 30 UTC le 24/10 → déjà le 25 (heure d\'été)', C.jourDeParis(new Date('2026-10-24T22:30:00Z')) === '2026-10-25');
    V('jour de Paris : 23 h 30 UTC le 31/12 → 1er janvier (heure d\'hiver)', C.jourDeParis(new Date('2026-12-31T23:30:00Z')) === '2027-01-01');
    V('jour de Paris : 23 h 30 UTC le 20/01 → 21 janvier, mais 22 h 59 → 20', C.jourDeParis(new Date('2026-01-20T23:30:00Z')) === '2026-01-21' && C.jourDeParis(new Date('2026-01-20T22:59:00Z')) === '2026-01-20');
    V('un tiers ne peut pas faire le bisou d\'un couple', C.enregistrerBisou('u4', 'u5', 'u1').erreur === 'hors-couple');

    let r = C.enregistrerBisou('u4', 'u5', 'u4', new Date('2026-10-20T08:00:00Z'));
    V('jour 1 : Kirito fait son bisou → en attente d\'Asuna', !r.complet && !r.deja && r.flamme === 0);
    r = C.enregistrerBisou('u5', 'u4', 'u4', new Date('2026-10-20T15:00:00Z'));
    V('… une seule fois par jour (dans n\'importe quel ordre de paire)', r.deja && !r.complet);
    r = C.enregistrerBisou('u4', 'u5', 'u5', new Date('2026-10-20T21:30:00Z')); // 23 h 30 à Paris
    V('… Asuna à 23 h 30 (Paris) le même jour → la flamme s\'allume (1 jour)', r.complet && r.flamme === 1 && r.record === 1);

    r = C.enregistrerBisou('u4', 'u5', 'u5', new Date('2026-10-20T22:30:00Z')); // 00 h 30 le 21 à Paris
    V('jour 2 : Asuna à 00 h 30 (Paris) — encore le 20 en UTC — compte pour le 21', !r.deja && !r.complet && r.jour === '2026-10-21', texte(r));
    r = C.enregistrerBisou('u4', 'u5', 'u4', new Date('2026-10-21T12:00:00Z'));
    V('… Kirito le 21 → flamme de 2 jours', r.complet && r.flamme === 2);
    C.enregistrerBisou('u4', 'u5', 'u4', new Date('2026-10-22T09:00:00Z'));
    r = C.enregistrerBisou('u4', 'u5', 'u5', new Date('2026-10-22T10:00:00Z'));
    V('jour 3 : flamme de 3 jours, nouveau record', r.complet && r.flamme === 3 && r.record === 3 && r.nouveauRecord);

    const etat = C.etatFlammeCouple('u4', 'u5', new Date('2026-10-23T18:00:00Z'));
    V('le 23 (rien encore) : la flamme vit toujours (3), personne n\'a fait son bisou', etat.flamme === 3 && !etat.bisouA && !etat.bisouB);
    const eteinte = C.etatFlammeCouple('u4', 'u5', new Date('2026-10-24T09:00:00Z'));
    V('le 24, après un jour manqué : flamme éteinte, record gardé', eteinte.flamme === 0 && eteinte.record === 3);
    r = C.enregistrerBisou('u4', 'u5', 'u4', new Date('2026-10-24T09:00:00Z'));
    V('… le premier bisou du 24 le dit (« un jour a manqué »)', !r.complet && r.flamme === 0 && r.eteinte === true);
    r = C.enregistrerBisou('u4', 'u5', 'u5', new Date('2026-10-24T10:00:00Z'));
    V('… et la flamme repart à 1, record toujours 3', r.complet && r.flamme === 1 && r.record === 3 && !r.nouveauRecord);
    V('persistance : 4 jours de flamme comptés en base', db.prepare("SELECT jours FROM mariage_flammes WHERE a = 'u4' AND b = 'u5'").get().jours === 4);
  }

  console.log('\n6) /mariage bisou : carte, bouton du conjoint, XP via le contrat C');
  {
    let it = fausse({ user: 'u3', sub: 'bisou' });
    await MAR.execute(it);
    V('pas marié·e → refus éphémère qui dit quoi faire', premiere(it).flags === 64 && /mariage demander/.test(premiere(it).content));

    const xpAvant = [getLevels('G1', 'u1').xp, getLevels('G1', 'u2').xp];
    it = fausse({ user: 'u1', sub: 'bisou' });
    await MAR.execute(it);
    const carte = premiere(it);
    V('bisou d\'Alice : carte publique qui appelle Bob (et lui seul)', !carte.flags && carte.content === '<@u2>' && texte(carte.allowedMentions) === '{"users":["u2"]}', texte(carte).slice(0, 300));
    V('… avec le bouton « Rendre le bisou »', idsDe(carte).includes('mar:bisou:u1:u2') && /Bisou du jour/.test(embedDe(carte).title));
    V('… customId ≤ 100 signes', idsDe(carte).every((id) => id.length <= 100));
    it = fausse({ user: 'u1', sub: 'bisou' });
    await MAR.execute(it);
    V('second bisou le même jour → refus éphémère', premiere(it).flags === 64 && /déjà fait ton bisou/.test(premiere(it).content));

    it = fausse({ user: 'u3', type: 'bouton', customId: 'mar:bisou:u1:u2' });
    await MAR.handleButton(it);
    V('un tiers clique → refus éphémère, rien ne change', (it.reponses[0] || it.suivis[0])?.flags === 64 && !C.etatFlammeCouple('u1', 'u2').bisouB);

    it = fausse({ user: 'u2', type: 'bouton', customId: 'mar:bisou:u1:u2' });
    await IC.execute(it); // par le vrai routeur (module revérifié)
    const maj = it.mises[0] || {};
    V('Bob rend le bisou par le bouton → le message devient « La flamme grandit »', /flamme grandit/.test(embedDe(maj).title) && texte(maj.components) === '[]', texte(maj).slice(0, 300));
    V('… flamme d\'un jour, et l\'XP annoncée', /1 jour/.test(descDe(maj)) && /\+30 XP/.test(descDe(maj)), descDe(maj));
    V('… chacun gagne 30 XP (repli du contrat C : addXp)', getLevels('G1', 'u1').xp === xpAvant[0] + 30 && getLevels('G1', 'u2').xp === xpAvant[1] + 30,
      `${getLevels('G1', 'u1').xp} / ${getLevels('G1', 'u2').xp}`);
    V('… sans aucun bonus de couple sur cette XP-là', getLevels('G1', 'u1').xp - xpAvant[0] === 30);
    it = fausse({ user: 'u2', type: 'bouton', customId: 'mar:bisou:u1:u2' });
    await MAR.handleButton(it);
    V('re-clic → « déjà grandi aujourd\'hui », pas d\'XP en plus', /déjà grandi/.test(texte(it.reponses[0] || it.suivis[0])) && getLevels('G1', 'u2').xp === xpAvant[1] + 30);

    setGuildConfig('G1', 'interact_enabled', 0);
    it = fausse({ user: 'u2', type: 'bouton', customId: 'mar:bisou:u1:u2' });
    await IC.execute(it);
    V('module Interactions coupé → le bouton le dit', /désactivé/.test(texte(it.reponses[0])));
    it = fausse({ user: 'u1', sub: 'bisou' });
    await IC.execute(it);
    V('… et la commande aussi (refus du routeur, module Interactions)', premiere(it).flags === 64 && /Interactions/.test(premiere(it).content));
    setGuildConfig('G1', 'interact_enabled', 1);
    setGuildConfig('G1', 'mariage_avantages', 0);
    it = fausse({ user: 'u1', sub: 'bisou' });
    await MAR.execute(it);
    V('avantages coupés → refus qui renvoie vers /config → 💍 Mariage', premiere(it).flags === 64 && /Mariage/.test(premiere(it).content));
    setGuildConfig('G1', 'mariage_avantages', 1);
  }

  console.log('\n7) Nom de couple');
  {
    V('Kirito + Asuna → Kiruna', C.nomDeCouple('Kirito', 'Asuna') === 'Kiruna', C.nomDeCouple('Kirito', 'Asuna'));
    V('lettre doublée fondue : Éloïse + Noé → Éloé', C.nomDeCouple('Éloïse', 'Noé') === 'Éloé', C.nomDeCouple('Éloïse', 'Noé'));
    V('emojis et symboles ignorés : ✨Léa✨ + Tom 🎮 → Léom', C.nomDeCouple('✨Léa✨', 'Tom 🎮') === 'Léom', C.nomDeCouple('✨Léa✨', 'Tom 🎮'));
    V('pseudo sans lettre → l\'autre seul ; deux vides → « Duo »', C.nomDeCouple('🎮🎮', 'Bob') === 'Bob' && C.nomDeCouple('', '!!!') === 'Duo');
    const long = C.nomDeCouple('Xx_SuperLongPseudoDeLaMortQuiTue_xX', 'AnotherVeryLongUsernameHere');
    V('pseudos très longs → 20 lettres au plus, majuscule en tête', long.length <= 20 && long[0] === long[0].toUpperCase(), long);
  }

  console.log('\n8) /lc entre conjoints');
  {
    const jours = Array.from({ length: 60 }, (_, k) => LC.pourcentageDuJour('u1', 'u2', new Date(Date.UTC(2026, 9, 1) + k * JOUR)));
    const maries = jours.map((p) => C.pourcentageLcCouple('u1', 'u2', p, 'G1'));
    V('conjoints : jamais moins de 90 % sur 60 jours, jamais plus de 100', maries.every((m) => m.pourcentage >= 90 && m.pourcentage <= 100), maries.map((m) => m.pourcentage).join());
    V('… le chiffre varie encore d\'un jour à l\'autre', new Set(maries.map((m) => m.pourcentage)).size > 3);
    V('… avec un verdict à part', maries.every((m) => /Mariés|mariage/.test(m.verdict)));
    V('dans les deux sens', C.pourcentageLcCouple('u2', 'u1', 37, 'G1').pourcentage === 94);
    const autre = C.pourcentageLcCouple('u1', 'u3', 12, 'G1');
    V('autre duo : rien ne change', autre.pourcentage === 12 && autre.verdict === null);
    setGuildConfig('G1', 'mariage_avantages', 0);
    V('avantages coupés sur le serveur : rien ne change', C.pourcentageLcCouple('u1', 'u2', 12, 'G1').pourcentage === 12);
    setGuildConfig('G1', 'mariage_avantages', 1);

    const it = fausse({ nom: 'lc', users: { membre: 'u2' } });
    await LC.execute(it);
    const d = descDe(premiere(it));
    const m = /## (\d+) %/.exec(d);
    V('/lc Alice → Bob : ≥ 90 % écrit en grand et verdict des mariés', m && Number(m[1]) >= 90 && /Mariés|mariage/.test(d), d);
    const it2 = fausse({ nom: 'lc', user: 'u3', users: { membre: 'u1' } });
    await LC.execute(it2);
    V('/lc Chloé → Alice : verdict ordinaire', !/Mariés|liens du mariage/.test(descDe(premiere(it2))));
  }

  console.log('\n9) Mensiversaires et annonces');
  {
    let f = C.prochaineFeteCouple('2026-01-31T12:00:00Z', new Date('2026-02-10T12:00:00Z'));
    V('marié le 31/01 → 1 mois le 28/02 (mois court)', f.mois === 1 && f.date === '2026-02-28' && !f.aujourdhui, texte(f));
    f = C.prochaineFeteCouple('2026-01-31T12:00:00Z', new Date('2026-02-28T15:00:00Z'));
    V('… et le 28/02, c\'est aujourd\'hui', f.aujourdhui && f.mois === 1);
    f = C.prochaineFeteCouple('2025-10-19T10:00:00Z', new Date('2026-10-19T12:00:00Z'));
    V('un an jour pour jour → anniversaire (1 an)', f.aujourdhui && f.anniversaire && f.annees === 1 && f.mois === 12);
    f = C.prochaineFeteCouple('2026-01-14T23:30:00Z', new Date('2026-02-15T11:00:00Z'));
    V('marié à 00 h 30 le 15 (Paris), encore le 14 en UTC → fête le 15', f.aujourdhui && f.date === '2026-02-15', texte(f));
    f = C.prochaineFeteCouple(new Date().toISOString(), new Date());
    V('marié aujourd\'hui → prochain : 1 mois, pas aujourd\'hui', f.mois === 1 && !f.aujourdhui);
    V('annonces : chaque mois la 1re année, puis seulement les anniversaires',
      C.feteAnnonceeCouple({ aujourdhui: true, mois: 3 }) && !C.feteAnnonceeCouple({ aujourdhui: true, mois: 13 })
      && C.feteAnnonceeCouple({ aujourdhui: true, mois: 24, anniversaire: true }) && !C.feteAnnonceeCouple({ aujourdhui: false, mois: 3 }));

    unir('u6', 'u7', '2026-07-19T10:00:00Z');
    const midi = new Date('2026-10-19T10:00:00Z'); // 12 h à Paris : 3 mois pile
    let envois = await VIE.verifierAnniversairesCouple(client, midi);
    V('aucun salon réglé → aucune annonce', envois.length === 0 && SALONS.FETE.envois.length === 0);
    setGuildConfig('G1', 'mariage_salon_id', 'FETE');
    setGuildConfig('G3', 'mariage_salon_id', 'AUTRE');
    setGuildConfig('G3', 'interact_enabled', 1);
    envois = await VIE.verifierAnniversairesCouple(client, new Date('2026-10-19T05:00:00Z')); // 7 h à Paris
    V('avant 9 h (Paris) → on attend', envois.length === 0 && SALONS.FETE.envois.length === 0);
    envois = await VIE.verifierAnniversairesCouple(client, midi);
    const annonce = SALONS.FETE.envois[0] || {};
    V('12 h : une annonce dans le salon choisi', SALONS.FETE.envois.length === 1 && envois.length === 1, texte(envois));
    V('… « 3 mois », les deux mentionnés, et eux seuls', /3 mois/.test(descDe(annonce)) && /mensiversaire/.test(embedDe(annonce).title)
      && annonce.content === '<@u6> <@u7>' && texte(annonce.allowedMentions) === '{"users":["u6","u7"]}', texte(annonce).slice(0, 300));
    V('serveur où un des deux n\'est pas membre → rien', SALONS.AUTRE.envois.length === 0);
    await VIE.verifierAnniversairesCouple(client, new Date('2026-10-19T16:00:00Z'));
    V('deuxième passage le même jour → pas de doublon', SALONS.FETE.envois.length === 1);
    V('… l\'annonce est notée en base (survit au redémarrage)', db.prepare("SELECT COUNT(*) AS n FROM mariage_annonces WHERE guild_id = 'G1' AND a = 'u6' AND b = 'u7' AND jour = '2026-10-19'").get().n === 1);
    // (Le 19/11, d'autres couples du test fêtent aussi leur premier mois :
    // on ne compte que Roméo et Juliette.)
    const deRomeo = () => SALONS.FETE.envois.filter((e) => e.content === '<@u6> <@u7>');
    setGuildConfig('G1', 'mariage_avantages', 0);
    await VIE.verifierAnniversairesCouple(client, new Date('2026-11-19T10:00:00Z'));
    V('avantages coupés → pas d\'annonce le mois suivant', SALONS.FETE.envois.length === 1);
    setGuildConfig('G1', 'mariage_avantages', 1);
    await VIE.verifierAnniversairesCouple(client, new Date('2026-11-19T10:00:00Z'));
    V('rallumés → 4 mois annoncés', deRomeo().length === 2 && /4 mois/.test(descDe(deRomeo()[1])), texte(SALONS.FETE.envois.map((e) => e.content)));
    V('le minuteur démarre sans lever', (() => { try { VIE.demarrerAnniversaires(client); VIE.demarrerAnniversaires(client); return true; } catch { return false; } })());
  }

  console.log('\n9 bis) Bouton cliqué un autre jour : le tour passe à l\'autre');
  {
    const hier = C.decalerJourCouple(C.jourDeParis(new Date()), -1);
    db.prepare("INSERT OR REPLACE INTO mariage_flammes (a, b, bisou_a, flamme, flamme_jour, record, jours) VALUES ('u6', 'u7', ?, 0, NULL, 0, 0)").run(hier);
    let it = fausse({ user: 'u7', type: 'bouton', customId: 'mar:bisou:u6:u7' });
    await MAR.handleButton(it);
    let maj = it.mises[0] || {};
    V('Juliette clique le bouton d\'hier : son bisou compte pour aujourd\'hui, Roméo doit le rendre', /Bisou du jour/.test(embedDe(maj).title)
      && maj.content === '<@u6>' && idsDe(maj).includes('mar:bisou:u6:u7') && C.etatFlammeCouple('u6', 'u7').bisouB, texte(maj).slice(0, 300));
    V('… une modification ne sonne jamais', texte(maj.allowedMentions) === '{"parse":[]}');
    // Le message d'origine est une CARTE (Components V2) : la mise à jour doit
    // reconstruire des composants, jamais renvoyer un embed.
    const carte = { id: 'CARTE', flags: 1 << 15, createdTimestamp: Date.now(), embeds: [],
      components: [{ type: 17, components: [{ type: 10, content: '# 💋 Bisou du jour' }, { type: 1, components: [{ type: 2, style: 3, custom_id: 'mar:bisou:u6:u7', label: 'Rendre le bisou' }] }] }] };
    it = fausse({ user: 'u6', type: 'bouton', customId: 'mar:bisou:u6:u7', message: carte });
    await MAR.handleButton(it);
    maj = it.mises[0] || {};
    const majTexte = texte(maj);
    V('Roméo rend le bisou sur une carte → composants reconstruits (pas d\'embed), flamme d\'un jour',
      maj.flags === 1 << 15 && !maj.embeds && /La flamme grandit/.test(majTexte) && /<@u6> <@u7>/.test(majTexte)
      && !majTexte.includes('mar:bisou:') && C.etatFlammeCouple('u6', 'u7').flamme === 1, majTexte.slice(0, 400));
    it = fausse({ user: 'u1', type: 'bouton', customId: 'mar:bisou:u6:u7' });
    await MAR.handleButton(it);
    V('le bouton d\'un autre couple → refus', (it.reponses[0] || it.suivis[0])?.flags === 64 && /pas destiné/.test(texte(it.reponses[0] || it.suivis[0])));
  }

  console.log('\n10) Mot doux');
  {
    let it = fausse({ user: 'u3', sub: 'motdoux', strings: { texte: 'coucou' } });
    await MAR.execute(it);
    V('pas marié·e → refus éphémère', premiere(it).flags === 64 && /mariage demander/.test(premiere(it).content));
    it = fausse({ user: 'u1', sub: 'motdoux', strings: { texte: 'Je t\'aime @everyone ❤️\nà ce soir' } });
    await MAR.execute(it);
    V('Alice dépose un mot doux → confirmation éphémère', premiere(it).flags === 64 && /attend \*\*Bob\*\*/.test(premiere(it).content), premiere(it).content);
    it = fausse({ user: 'u1', sub: 'motdoux', strings: { texte: 'x'.repeat(301) } });
    await MAR.execute(it);
    V('plus de 300 signes → refusé, pas tronqué', premiere(it).flags === 64 && /300/.test(premiere(it).content) && C.lireMotDoux('u1', 'u2', 'u2').texte.startsWith('Je t\'aime'));

    it = fausse({ user: 'u3', sub: 'statut', users: { membre: 'u2' } });
    await MAR.execute(it);
    V('la fiche le signale, sans en dévoiler le texte', /Un mot doux attend \*\*Bob\*\*/.test(descDe(premiere(it))) && !/Je t'aime/.test(descDe(premiere(it))));

    it = fausse({ user: 'u1', sub: 'motdoux' });
    await MAR.execute(it);
    V('Alice n\'a rien reçu → 📭', premiere(it).flags === 64 && /Aucun mot doux/.test(premiere(it).content));
    it = fausse({ user: 'u2', sub: 'motdoux' });
    await MAR.execute(it);
    const lu = premiere(it);
    V('Bob lit son mot doux : éphémère, cité ligne par ligne, sans faire sonner personne',
      lu.flags === 64 && /^> Je t'aime/m.test(descDe(lu)) && /^> à ce soir/m.test(descDe(lu)) && !/>>>/.test(descDe(lu)) && texte(lu.allowedMentions) === '{"parse":[]}', texte(lu).slice(0, 300));
    V('… marqué lu : la fiche ne le signale plus', C.lireMotDoux('u1', 'u2', 'u2').lu === 1);
  }

  console.log('\n11) /mariage statut : la fiche du couple');
  {
    setGuildConfig('G1', 'sao_enabled', 1);
    let it = fausse({ user: 'u3', sub: 'statut', users: { membre: 'u1' } });
    await MAR.execute(it);
    let d = descDe(premiere(it));
    V('« Alice est marié·e à Bob » (texte historique conservé)', /\*\*Alice\*\* est marié·e à \*\*Bob\*\*/.test(d), d);
    V('sections ◆ / ➜ et filet entre elles', /^◆ /m.test(d) && /^➜ /m.test(d) && d.includes('─'.repeat(16)));
    V('nom de couple, alliance, flamme, lune de miel, bonus, mensiversaire', ['Nom de couple', 'Alliance de fer', 'Flamme du couple', 'Lune de miel', 'Bonus d\'XP de couple', 'Prochain mensiversaire'].every((s) => d.includes(s)), d);
    V('… bonus actuel affiché (+20 %) et flamme du jour (1 jour, les deux 💋)', /\+20 %/.test(d) && /1 jour\*\* de suite/.test(d) && /💋 Alice · 💋 Bob/.test(d), d);
    V('… nom de couple calculé', d.includes(`**${C.nomDeCouple('Alice', 'Bob')}**`));
    V('… avantages SAO mentionnés (SAO activé)', /Aventure SAO/.test(d) && /Lien du cœur/.test(d));
    V('… dans les limites (≤ 4000 signes), sans mention qui sonne', d.length <= 4000 && texte(premiere(it).allowedMentions) === '{"parse":[]}');
    const { enComposants } = require('../src/utils/reponse');
    const nbComposants = (liste) => (liste || []).reduce((n, c) => n + 1 + nbComposants(c.components), 0);
    const fiche = enComposants(G1, client, premiere(it));
    V('… et elle part bien en CARTE (≤ 40 composants), pas en vieil embed', Array.isArray(fiche) && fiche.length > 0 && nbComposants(fiche) <= 40, String(fiche && nbComposants(fiche)));
    const panneau = enComposants(G1, client, CFGM.mariageView(G1));
    V('la vue /config → 💍 Mariage aussi', Array.isArray(panneau) && nbComposants(panneau) <= 40, String(panneau && nbComposants(panneau)));
    setGuildConfig('G1', 'sao_enabled', 0);
    it = fausse({ user: 'u4', sub: 'statut' });
    await MAR.execute(it);
    d = descDe(premiere(it));
    V('Kirito : alliance d\'argent, plus de lune de miel, pas de SAO', /Alliance d'argent/.test(d) && !/Lune de miel/.test(d) && !/Aventure SAO/.test(d) && /Kiruna|Asrito/.test(d), d);
    setGuildConfig('G1', 'mariage_avantages', 0);
    it = fausse({ user: 'u1', sub: 'statut' });
    await MAR.execute(it);
    d = descDe(premiere(it));
    V('avantages coupés → la fiche le dit, sans sections', /coupés/.test(d) && !/◆/.test(d) && /marié·e à \*\*Bob\*\*/.test(d));
    setGuildConfig('G1', 'mariage_avantages', 1);
    it = fausse({ user: 'u3', sub: 'statut' });
    await MAR.execute(it);
    V('pas marié·e → « marié·e à personne »', /marié·e à personne/.test(descDe(premiere(it))));
  }

  console.log('\n12) Divorce : la flamme et les compteurs du couple disparaissent');
  {
    C.noterAnnonceCouple('G1', 'u1', 'u2', '2026-11-19');
    C.deposerMotDoux('u1', 'u2', 'u2', 'bisous');
    const compte = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE a = 'u1' AND b = 'u2'`).get().n;
    V('avant : flamme, mots doux et annonce en base', compte('mariage_flammes') === 1 && compte('mariage_mots_doux') >= 1 && compte('mariage_annonces') === 1);
    const T = Date.now();
    C.noterActiviteCouple('G1', 'u2', T);
    V('… et le bonus joue', C.bonusXpCouple('G1', 'u1', 'text', T)?.pourcent === 20);
    await MAR.handleButton(fausse({ user: 'u1', type: 'bouton', customId: 'mar:div:u1:u2' }));
    V('divorce prononcé', !MAR.mariageDe('u1'));
    V('après : plus de flamme, de mots doux ni d\'annonces', compte('mariage_flammes') === 0 && compte('mariage_mots_doux') === 0 && compte('mariage_annonces') === 0);
    V('… plus de bonus, tout de suite (cache invalidé)', C.bonusXpCouple('G1', 'u1', 'text', T) === null && C.unionCouple('u1') === null);
    V('… /lc redevient ordinaire', C.pourcentageLcCouple('u1', 'u2', 12, 'G1').pourcentage === 12);
    await MAR.execute(fausse({ sub: 'demander', users: { membre: 'u2' } }));
    await MAR.handleButton(fausse({ user: 'u2', type: 'bouton', customId: 'mar:oui:u1:u2' }));
    const etat = C.etatFlammeCouple('u1', 'u2');
    V('remariés : tout repart de zéro (flamme 0, record 0)', MAR.mariageDe('u1')?.conjoint === 'u2' && etat.flamme === 0 && etat.record === 0 && !etat.bisouA);
  }

  console.log('\n12 bis) Divorcer puis se remarier ne rouvre pas l\'XP du bisou du jour');
  {
    // Alice et Bob ont déjà eu leur XP du bisou aujourd'hui (section 6), puis
    // divorcé et se sont remariés (section 12) : la flamme est vierge.
    const xp = (u) => getLevels('G1', u).xp;
    const bisouComplet = async (a, b) => {
      await MAR.execute(fausse({ user: a, sub: 'bisou' }));
      const [x, y] = [a, b].sort();
      const it = fausse({ user: b, type: 'bouton', customId: `mar:bisou:${x}:${y}` });
      await MAR.handleButton(it);
      return it.mises[0] || {};
    };
    const divorcer = async (a, b) => {
      const [x, y] = [a, b].sort();
      await MAR.handleButton(fausse({ user: a, type: 'bouton', customId: `mar:div:${x}:${y}` }));
    };
    const marier = async (a, b) => {
      await MAR.execute(fausse({ user: a, sub: 'demander', users: { membre: b } }));
      const [x, y] = [a, b].sort();
      await MAR.handleButton(fausse({ user: b, type: 'bouton', customId: `mar:oui:${a}:${b}` }));
      return MAR.mariageDe(a)?.conjoint === b && x && y;
    };
    V('l\'XP du bisou d\'aujourd\'hui est notée pour chacun, hors de la flamme', C.xpBisouRecueCouple('u1') && C.xpBisouRecueCouple('u2'));
    const avant = [xp('u1'), xp('u2')];
    let maj = await bisouComplet('u1', 'u2');
    V('remariés le même jour : les deux bisous rallument la flamme…', /flamme grandit/.test(embedDe(maj).title) && C.etatFlammeCouple('u1', 'u2').flamme === 1);
    V('… mais AUCUNE XP de plus, et la carte le dit', xp('u1') === avant[0] && xp('u2') === avant[1] && !/\+30 XP/.test(descDe(maj))
      && /qu'une fois par jour et par personne : vous l'avez déjà reçue aujourd'hui/.test(descDe(maj)), `${xp('u1') - avant[0]} / ${xp('u2') - avant[1]} · ${descDe(maj)}`);
    // Trois cycles divorce → remariage → bisou, le même jour (la revue).
    for (let k = 0; k < 3; k++) {
      await divorcer('u1', 'u2');
      await marier('u1', 'u2');
      await bisouComplet('u1', 'u2');
    }
    V('trois cycles divorce → remariage → bisou : toujours rien', xp('u1') === avant[0] && xp('u2') === avant[1], `${xp('u1') - avant[0]} / ${xp('u2') - avant[1]}`);
    // Changer de conjoint : la nouvelle venue, elle, gagne son XP du jour.
    await divorcer('u1', 'u2');
    V('Chloé est libre', await marier('u1', 'u3'));
    const avantC = xp('u3');
    maj = await bisouComplet('u3', 'u1');
    V('nouveau conjoint : Chloé gagne son XP, Alice pas une seconde fois', xp('u3') === avantC + 30 && xp('u1') === avant[0], `${xp('u3') - avantC} / ${xp('u1') - avant[0]}`);
    V('… la carte nomme qui gagne, et qui l\'a déjà reçue', /\*\*Chloé\*\* : \*\*\+30 XP\*\*/.test(descDe(maj)) && /\*\*Alice\*\* l'a déjà reçue aujourd'hui/.test(descDe(maj)), descDe(maj));
    V('le lendemain (heure de Paris), l\'XP revient', !C.xpBisouRecueCouple('u1', C.decalerJourCouple(C.jourDeParis(), 1)));
    await divorcer('u1', 'u3');
    await marier('u1', 'u2');
  }

  console.log('\n13) /config → 💍 Mariage');
  {
    setGuildConfig('G1', 'log_channel_id', 'LOGS');
    const vue = CFGM.mariageView(G1);
    const rangées = vue.components.map((r) => r.toJSON());
    const ids = rangées.flatMap((r) => r.components.map((c) => c.custom_id));
    V('≤ 5 rangées, tous les ids en cfg… et ≤ 100 signes', rangées.length <= 5 && ids.every((id) => id.startsWith('cfg') && id.length <= 100), ids.join());
    V('bascule, fenêtre, salon des anniversaires (min 0) et retour', ids.includes('cfgmar:off') && ids.includes('cfgmar:nombres') && ids.includes('cfgback')
      && rangées.some((r) => r.components.some((c) => c.custom_id === 'cfgmar:salon' && c.type === 8 && c.min_values === 0 && c.max_values === 1)));
    V('le salon choisi est présélectionné', texte(rangées).includes('"default_values":[{"id":"FETE","type":"channel"}]'));
    V('les réglages s\'affichent', /\+10 %/.test(texte(vue.embeds[0].data)) && /30 XP/.test(texte(vue.embeds[0].data)) && /<#FETE>/.test(texte(vue.embeds[0].data)));

    let it = fausse({ user: 'u1', type: 'menu', customId: 'cfgcat', valeurs: ['mariage'] });
    await P.handleConfigInteraction(it);
    V('membre sans grade → panneau refusé', premiere(it).flags === 64 && /staff/.test(premiere(it).content));
    it = fausse({ user: 'staff', staff: true, type: 'menu', customId: 'cfgcat', valeurs: ['mariage'] });
    await P.handleConfigInteraction(it);
    V('menu cfgcat → « 💍 Configuration — Mariage »', embedDe(it.mises[0]).title === '💍 Configuration — Mariage', texte(it.mises[0]).slice(0, 200));
    const principal = texte(P.mainView(G1).components);
    V('l\'option « Mariage » est dans le menu des catégories (≤ 25 options)', principal.includes('"value":"mariage"') && P.mainView(G1).components[0].toJSON().components[0].options.length <= 25);

    const logs = SALONS.LOGS.envois.length;
    it = fausse({ user: 'staff', staff: true, type: 'bouton', customId: 'cfgmar:off' });
    await P.handleConfigInteraction(it);
    V('couper les avantages : enregistré, vue rafraîchie (bouton inversé), journalisé',
      getGuildConfig('G1').mariage_avantages === 0 && idsDe(it.mises[0]).includes('cfgmar:on') && SALONS.LOGS.envois.length === logs + 1, texte(it.mises[0]).slice(0, 200));
    it = fausse({ user: 'staff', staff: true, type: 'bouton', customId: 'cfgmar:on' });
    await P.handleConfigInteraction(it);
    V('… et les rallumer', getGuildConfig('G1').mariage_avantages === 1);

    it = fausse({ user: 'staff', staff: true, type: 'bouton', customId: 'cfgmar:nombres' });
    await P.handleConfigInteraction(it);
    const modal = it.modales[0] || {};
    const champs = (modal.components || []).map((r) => r.components[0]);
    V('fenêtre : 4 nombres pré-remplis, libellés ≤ 45 signes', modal.custom_id === 'cfgmar:modal' && champs.length === 4 && champs.every((c) => c.label.length <= 45)
      && champs.map((c) => c.value).join() === '10,7,30,10', texte(champs.map((c) => [c.label.length, c.value])));
    V('… titre ≤ 45 signes', (modal.title || '').length <= 45);

    it = fausse({ user: 'staff', staff: true, type: 'modal', customId: 'cfgmar:modal', champs: { bonus: '25', lune: '999', bisou: '50', actif: '15' } });
    await P.handleConfigInteraction(it);
    const cfg = getGuildConfig('G1');
    V('valeurs enregistrées et bornées (lune de miel 999 → 60)', cfg.mariage_bonus_xp === 25 && cfg.mariage_lune_de_miel_jours === 60 && cfg.mariage_bisou_xp === 50 && cfg.mariage_actif_minutes === 15, texte([cfg.mariage_bonus_xp, cfg.mariage_lune_de_miel_jours, cfg.mariage_bisou_xp, cfg.mariage_actif_minutes]));
    V('… vue rafraîchie et changement journalisé', /\+25 %/.test(texte(it.mises[0])) && /bonus \*\*25 %\*\*/.test(texte(SALONS.LOGS.envois.at(-1))));
    it = fausse({ user: 'staff', staff: true, type: 'modal', customId: 'cfgmar:modal', champs: { bonus: 'beaucoup', lune: '7', bisou: '-3', actif: '10' } });
    await P.handleConfigInteraction(it);
    V('saisie invalide → refus qui nomme les champs, rien n\'a changé', premiere(it).flags === 64 && /bonus/.test(premiere(it).content) && /bisou/.test(premiere(it).content) && getGuildConfig('G1').mariage_bonus_xp === 25);

    it = fausse({ user: 'staff', staff: true, type: 'salon', customId: 'cfgmar:salon', valeurs: ['AUTRE'] });
    await P.handleConfigInteraction(it);
    V('salon des anniversaires choisi', getGuildConfig('G1').mariage_salon_id === 'AUTRE');
    it = fausse({ user: 'staff', staff: true, type: 'salon', customId: 'cfgmar:salon', valeurs: [] });
    await P.handleConfigInteraction(it);
    V('… et retiré (menu vidé)', getGuildConfig('G1').mariage_salon_id === null);

    const defauts = getGuildConfig('ZZ');
    V('défauts d\'un serveur neuf', defauts.mariage_avantages === 1 && defauts.mariage_bonus_xp === 10 && defauts.mariage_lune_de_miel_jours === 7
      && defauts.mariage_bisou_xp === 30 && defauts.mariage_actif_minutes === 10 && defauts.mariage_salon_id === null);
    const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    V('branchements : cfgcat, CATEGORY_VIEWS, préfixe cfgmar:', /value: 'mariage'/.test(src('src/utils/configPanel.js')) && /mariage: mariageView/.test(src('src/utils/configPanel.js')) && /startsWith\('cfgmar:'\)/.test(src('src/utils/configPanel.js')));
    V('vérification des anniversaires branchée au démarrage', /demarrerAnniversaires\(client\)/.test(src('src/events/ready.js')));
    const subs = (MAR.data.subs || []).map((s) => s.name);
    V('/mariage : bisou et motdoux ajoutés (≤ 25 sous-commandes)', ['demander', 'statut', 'bisou', 'motdoux', 'divorcer'].every((s) => subs.includes(s)) && subs.length <= 25, subs.join());
    V('/mariage et /lc restent dans le module Interactions', MAR.guildModule === 'interact' && LC.guildModule === 'interact');
  }

  console.warn = warnOrig;
  global.fetch = vraiFetch;
  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.warn = warnOrig; console.error(e); console.log('\n0 réussis, 1 échoués'); process.exit(1); });
