// ⚔️ Aventure SAO — les défauts confirmés par la revue contradictoire,
// chacun rejoué par son scénario d'origine :
//
//   1. coffre de couple : un refus ne laisse rien à moitié fait
//   2. remise à zéro d'un marié : le conjoint récupère TOUT le coffre
//   3. pas de soin hors du menu pendant un combat de boss
//   4. un combat abandonné ne bloque plus l'auberge, le voyage, Argo, la pêche,
//      et /sao cd qui le clôt dit la pénalité
//   5. pas de quête « boss » ni « Sword Skills » pour qui a conquis Aincrad
//   6. un clic tardif ne remplace jamais une carte de fin par l'ancien état
//   7. la quête « Sword Skills » bouclée par le dernier coup compte
//   8. consulter la fiche d'un autre ne gèle plus sa régénération
//   9. duel : l'XP de quête du vainqueur avec SON membre
//  10. raid : l'XP de la chute avec le membre de chaque participant
//  11. raid expiré : la consolation n'est versée qu'une fois
//  12. des phrases entières, traduisibles
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'sao-revue-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  return vrai.apply(this, arguments);
};
console.warn = () => {};

const F = require('../src/utils/sao/formules');
Math.random = F.aleaGraine(20261019);

const { db, setGuildConfig } = require('../src/database');
const L = require('../src/utils/levels');
const IC = require('../src/events/interactionCreate');
const { handleConfigInteraction } = require('../src/utils/configPanel');
const { enComposants } = require('../src/utils/reponse');
const CARTES = require('../src/utils/cartes');
const G = require('../src/utils/saoGame');
const SAO = require('../src/commands/sao');
const RAID = require('../src/utils/sao/raid');
const VUES = require('../src/utils/sao/vues');

let ok = 0;
let ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Faux Discord (le même que tests/sao.test.js) ───────────────────────
const personne = (id, nom) => ({ id, username: nom.toLowerCase(), displayName: nom, globalName: nom, bot: false, tag: `${nom}#0`, displayAvatarURL: () => null });
const USERS = {
  u1: personne('u1', 'Alice'), u2: personne('u2', 'Bob'), u3: personne('u3', 'Chloé'), u4: personne('u4', 'Dan'),
  adm: personne('adm', 'Admin'), mod: personne('mod', 'Modo'),
};
const salon = (id) => ({ id, envois: [], isTextBased: () => true, async send(m) { this.envois.push(m); return { id: `M${this.envois.length}`, ...m }; } });
const SALONS = { GEN: salon('GEN'), LOGS: salon('LOGS') };
const guild = {
  id: 'G1', name: 'Aincrad', iconURL: () => null,
  members: { cache: new Map(Object.values(USERS).map((u) => [u.id, { id: u.id, user: u, displayName: u.displayName, roles: { cache: new Map() } }])), fetch: async () => null },
  channels: { fetch: async (id) => SALONS[id] || null, cache: new Map() },
  roles: { cache: new Map() },
};
const client = {
  user: { id: 'bot', username: 'Bot' },
  commands: new Map([['sao', SAO]]),
  users: { fetch: async (id) => USERS[id] || null },
  channels: { fetch: async (id) => SALONS[id] || null },
  guilds: { cache: new Map([['G1', guild]]) },
};
const BIT_ADMIN = 1n << 3n;
const BIT_MOD = 1n << 40n;
const membre = (id, grade = 0) => ({
  id, user: USERS[id], guild, displayName: USERS[id]?.displayName, roles: { cache: new Map() },
  permissions: { has: (b) => (grade >= 3 && b === BIT_ADMIN) || (grade >= 2 && b === BIT_MOD) },
});
function fausse({ type = 'commande', user = 'u1', grade = 0, sub = null, groupe = null, options = {}, customId = null, valeurs = [], focus = null } = {}) {
  const composant = ['bouton', 'menu', 'menuUser'].includes(type);
  return {
    client, guild, guildId: 'G1', channelId: 'GEN', channel: SALONS.GEN, locale: 'fr', user: USERS[user], member: membre(user, grade),
    commandName: 'sao', customId, values: valeurs, deferred: false, replied: false,
    message: { id: 'MSG', flags: 0, components: [], embeds: [{}], createdTimestamp: Date.now() },
    inGuild: () => true, isAutocomplete: () => type === 'auto', isChatInputCommand: () => type === 'commande',
    isButton: () => type === 'bouton', isStringSelectMenu: () => type === 'menu', isUserSelectMenu: () => type === 'menuUser',
    isChannelSelectMenu: () => false, isRoleSelectMenu: () => false, isAnySelectMenu: () => ['menu', 'menuUser'].includes(type),
    isModalSubmit: () => false, isFromMessage: () => false, isMessageComponent: () => composant,
    options: {
      getSubcommand: () => sub, getSubcommandGroup: () => groupe,
      getString: (k) => options[k] ?? null, getInteger: (k) => options[k] ?? null, getBoolean: (k) => options[k] ?? null,
      getUser: (k) => USERS[options[k]] || null,
      getFocused: (complet) => (complet ? { name: focus, value: options[focus] ?? '' } : options[focus] ?? ''),
    },
    reponses: [], suivis: [], mises: [], choix: null,
    async reply(p) { this.replied = true; this.reponses.push(p); return p; },
    async deferReply() { this.deferred = true; },
    async editReply(p) { this.reponses.push(p); return p; },
    async followUp(p) { this.suivis.push(p); return p; },
    async update(p) { this.replied = true; this.mises.push(p); return p; },
    async deferUpdate() { this.deferred = true; },
    async respond(c) { this.choix = c; },
  };
}
const json = (x) => (x && typeof x.toJSON === 'function' ? x.toJSON() : x);
const sortie = (it) => it.mises[it.mises.length - 1] || it.reponses[it.reponses.length - 1] || {};
const txt = (p) => JSON.stringify({ c: p?.content ?? null, e: (p?.embeds || []).map(json), k: (p?.components || []).map(json) });
const eph = (p) => p?.flags === 64;
async function commande(sub, opts = {}) {
  const it = fausse({ type: 'commande', sub, ...opts });
  await IC.commande(it);
  return it;
}
async function clic(customId, opts = {}) {
  const it = fausse({ type: 'bouton', customId, ...opts });
  await IC.execute(it);
  return it;
}
const joueur = (u, g = 'G1') => G.getPlayer(g, u);
const majJoueur = (u, champs, g = 'G1') => {
  const cles = Object.keys(champs);
  db.prepare(`UPDATE sao_players SET ${cles.map((k) => `${k} = ?`).join(', ')} WHERE guild_id = ? AND user_id = ?`).run(...cles.map((k) => champs[k]), g, u);
};
const majCombat = (id, f, majLe = Date.now()) => {
  const e = JSON.parse(db.prepare('SELECT etat FROM sao_combats WHERE id = ?').get(id).etat);
  f(e);
  db.prepare('UPDATE sao_combats SET etat = ?, maj_le = ? WHERE id = ?').run(JSON.stringify(e), majLe, id);
  return e;
};
const vieillir = (id, ms) => db.prepare('UPDATE sao_combats SET maj_le = ? WHERE id = ?').run(Date.now() - ms, id);
const marier = (x, y) => {
  const [a, b] = [x, y].sort();
  db.prepare('INSERT INTO mariages (a, b, depuis, guild_id) VALUES (?, ?, ?, ?)').run(a, b, new Date().toISOString(), 'G1');
};
// Un combat neuf contre le boss de l'étage, joueur en état de se battre.
function nouveauCombat(u, champs = {}) {
  const ancien = G.combatActif('G1', u);
  if (ancien) db.prepare("UPDATE sao_combats SET statut = 'fui' WHERE id = ?").run(ancien.id);
  majJoueur(u, { reapparition: 0, ...champs });
  return G.commencerBoss('G1', u).combat;
}
// La carte telle que Discord l'affiche, en mode carte (Components V2).
const carteDe = (payload, id) => ({ id, flags: CARTES.DRAPEAU_V2, components: enComposants(guild, client, payload), embeds: [] });
const ABANDON = 2 * 3600 * 1000;

(async () => {
  setGuildConfig('G1', 'sao_enabled', 1);
  setGuildConfig('G1', 'log_channel_id', 'LOGS');
  for (const u of ['u1', 'u2', 'u3', 'u4']) await commande('start', { user: u });

  console.log('\n1) Coffre de couple : tout vérifier, puis tout écrire d\'un bloc');
  {
    marier('u2', 'u3');
    const couple = G.cleCouple('u2', 'u3');
    majJoueur('u2', { col: 100 });
    const coffre = () => G.coffreSao('G1', couple).col;
    // Le scénario d'origine : cinq dépôts refusés « pas assez de potions ».
    let refus = null;
    for (let i = 0; i < 5; i++) {
      refus = await commande('coffre', { groupe: 'coffre', sub: 'deposer', user: 'u2', options: { col: 100, objet: 'potion_soin', quantite: 999 } });
    }
    V('dépôt refusé (« tu en as 3 ») : réponse privée qui le dit', eph(refus.reponses[0]) && /tu en as 3/.test(refus.reponses[0].content), refus.reponses[0]?.content);
    V('… et le coffre n\'a reçu AUCUN Col (500 créés avant)', coffre() === 0, String(coffre()));
    V('… le joueur garde ses 100 Col et ses 3 potions', joueur('u2').col === 100 && G.quantiteSao('G1', 'u2', 'potion_soin') === 3);
    await commande('coffre', { groupe: 'coffre', sub: 'deposer', user: 'u2', options: { col: 50, objet: 'zzz' } });
    V('objet inconnu (texte libre de l\'autocomplétion) : rien de crédité', coffre() === 0 && joueur('u2').col === 100);

    await commande('coffre', { groupe: 'coffre', sub: 'deposer', user: 'u2', options: { col: 60 } });
    V('un vrai dépôt passe toujours', coffre() === 60 && joueur('u2').col === 40);
    const colU3 = joueur('u3').col;
    const r1 = await commande('coffre', { groupe: 'coffre', sub: 'retirer', user: 'u3', options: { col: 50, objet: 'zzz' } });
    V('retrait avec objet inconnu : aucun Col détruit', eph(r1.reponses[0]) && coffre() === 60 && joueur('u3').col === colU3);
    const r2 = await commande('coffre', { groupe: 'coffre', sub: 'retirer', user: 'u3', options: { col: 50, objet: 'cristal_soin', quantite: 1 } });
    V('retrait d\'un objet absent du coffre : aucun Col détruit', /n'en contient que 0/.test(r2.reponses[0]?.content || '') && coffre() === 60 && joueur('u3').col === colU3, r2.reponses[0]?.content);
    await commande('coffre', { groupe: 'coffre', sub: 'retirer', user: 'u3', options: { col: 60 } });
    V('un vrai retrait passe toujours', coffre() === 0 && joueur('u3').col === colU3 + 60);

    // Propriété : quoi qu'on tente, rien ne se crée, rien ne se perd.
    G.donnerObjet('G1', 'u2', 'cristal_soin', 4);
    const total = () => {
      const c = G.coffreSao('G1', couple);
      const dans = (k) => c.objets.find((o) => o.objet === k)?.qte || 0;
      return {
        col: joueur('u2').col + joueur('u3').col + c.col,
        potions: G.quantiteSao('G1', 'u2', 'potion_soin') + G.quantiteSao('G1', 'u3', 'potion_soin') + dans('potion_soin'),
        cristaux: G.quantiteSao('G1', 'u2', 'cristal_soin') + G.quantiteSao('G1', 'u3', 'cristal_soin') + dans('cristal_soin'),
      };
    };
    const depart = JSON.stringify(total());
    const rng = F.aleaGraine(42);
    const pioche = (t) => t[Math.floor(rng() * t.length)];
    let derive = null;
    let reussis = 0;
    for (let i = 0; i < 300 && !derive; i++) {
      const r = G.mouvementCoffre('G1', pioche(['u2', 'u3']), couple, pioche(['deposer', 'retirer']), {
        col: pioche([0, 0, 1, 25, 80, 300, -5]),
        cle: pioche([null, 'potion_soin', 'cristal_soin', 'zzz', 'antidote']),
        qte: pioche([1, 2, 3, 5, 999, 0]),
      });
      if (!r.refus) reussis++;
      if (JSON.stringify(total()) !== depart) derive = `essai ${i} : ${JSON.stringify(total())} au lieu de ${depart}`;
    }
    V(`300 mouvements au hasard (${reussis} acceptés) : Col et objets conservés`, !derive && reussis > 10, derive || '');
    const ligne = db.prepare('SELECT col FROM sao_coffres WHERE guild_id = ? AND couple = ?').get('G1', couple);
    V('la ligne du coffre existe pour le partage d\'un divorce', Boolean(ligne));
  }

  console.log('\n2) Remise à zéro d\'un marié : son conjoint récupère tout');
  {
    G.ensurePlayer('G1', 'c2');
    G.ensurePlayer('G1', 'd2');
    marier('c2', 'd2');
    const couple = G.cleCouple('c2', 'd2');
    majJoueur('c2', { col: 10000 });
    G.mouvementCoffre('G1', 'c2', couple, 'deposer', { col: 10000, cle: 'potion_soin', qte: 3 });
    V('le coffre contient les 10 000 Col et 3 potions de c2', G.coffreSao('G1', couple).col === 10000 && joueur('c2').col === 0);
    const conf = fausse({ type: 'menuUser', customId: 'cfgsao:rzj', grade: 3, user: 'adm', valeurs: ['d2'] });
    await handleConfigInteraction(conf);
    V('la confirmation dit où va le coffre : en entier au conjoint', /revient d'abord en entier à son conjoint/.test(txt(conf.mises[0])), txt(conf.mises[0]).slice(0, 300));
    await handleConfigInteraction(fausse({ type: 'bouton', customId: 'cfgsao:okj:d2', grade: 3, user: 'adm' }));
    V('après la remise à zéro de d2, c2 a retrouvé ses 10 000 Col (5 000 avant)', joueur('c2').col === 10000, String(joueur('c2').col));
    V('… et ses 3 potions (il n\'en récupérait qu\'une)', G.quantiteSao('G1', 'c2', 'potion_soin') === 3, String(G.quantiteSao('G1', 'c2', 'potion_soin')));
    V('d2 est bien effacé, et sa ligne n\'a pas été recréée', !joueur('d2') && !G.inventaireSao('G1', 'd2').length);
    V('le coffre a disparu', !db.prepare('SELECT 1 FROM sao_coffres WHERE guild_id = ? AND couple = ?').get('G1', couple));
  }

  console.log('\n3) Pas de soin hors du menu pendant un combat de boss');
  {
    const c = nouveauCombat('u1', { hp: 500, col: 1000 });
    majCombat(c.id, (e) => { e.jPv = 10; e.charge = false; e.etourdi = 0; e.tour = 0; });
    majJoueur('u1', { hp: 10 });
    const potions = G.quantiteSao('G1', 'u1', 'potion_soin');
    const it = await commande('utiliser', { options: { objet: 'potion_soin' } });
    V('/sao utiliser potion en combat : refus qui renvoie au menu du combat', eph(it.reponses[0]) && /menu du combat/.test(it.reponses[0].content), it.reponses[0]?.content);
    V('… la potion n\'est PAS consommée, les PV ne bougent pas', G.quantiteSao('G1', 'u1', 'potion_soin') === potions && joueur('u1').hp === 10);
    const cristal = await commande('utiliser', { options: { objet: 'cristal_soin' } });
    V('… le cristal non plus', /menu du combat/.test(cristal.reponses[0]?.content || ''));
    const auto = fausse({ type: 'auto', sub: 'utiliser', focus: 'objet', options: { objet: '' } });
    await SAO.autocomplete(auto);
    V('l\'autocomplétion ne propose plus de soin pendant le combat', !auto.choix.some((x) => G.OBJETS[x.value]?.soin), JSON.stringify(auto.choix));

    // Combat abandonné : la potion compte, et /sao boss ne l'efface plus.
    vieillir(c.id, ABANDON);
    const col = joueur('u1').col;
    const bu = await commande('utiliser', { options: { objet: 'potion_soin' } });
    const hp = joueur('u1').hp;
    V('combat abandonné : la potion passe', G.quantiteSao('G1', 'u1', 'potion_soin') === potions - 1 && hp > 10, `${hp} PV`);
    V('… le combat est clos, la pénalité dite dans la réponse', G.combatParId(c.id).statut === 'abandon' && joueur('u1').col === col - 50 && /a été abandonné/.test(txt(sortie(bu))), txt(sortie(bu)).slice(0, 200));
    const neuf = G.commencerBoss('G1', 'u1').combat;
    V('… et le combat suivant part avec ces PV (plus écrasés par l\'ancien combat)', neuf.etat.jPv === hp && joueur('u1').hp === hp, `${neuf.etat.jPv} / ${hp}`);
  }

  console.log('\n4) Un combat abandonné ne bloque plus rien, et ne coûte qu\'une fois');
  {
    const c = nouveauCombat('u1', { hp: 500, col: 10000 });
    await clic(`sao:cb:atk:${c.id}:0`);
    majJoueur('u1', { hp: 20, col: 10000 });
    vieillir(c.id, ABANDON);
    const soin = await commande('soin');
    const p = joueur('u1');
    V('/sao soin, combat quitté il y a 2 h : l\'auberge accepte', /Une nuit à l'auberge/.test(soin.reponses[0]?.content || ''), soin.reponses[0]?.content);
    V('… le combat compte comme une fuite (−5 %), et la réponse le dit', G.combatParId(c.id).statut === 'abandon' && /−500 Col/.test(soin.reponses[0].content) && p.col < 9500);
    const colApres = p.col;
    const boss = await commande('boss');
    V('/sao boss ensuite : un combat neuf, SANS seconde pénalité', joueur('u1').col === colApres && !/abandonné/.test(txt(sortie(boss))) && G.combatActif('G1', 'u1')?.id !== c.id);
    const vivant = await commande('soin');
    V('un combat VIVANT bloque toujours l\'auberge', /plein combat contre/.test(vivant.reponses[0]?.content || ''), vivant.reponses[0]?.content);
    const repris = await commande('boss');
    V('… et « /sao boss le rouvre » dit vrai : repris, aucune pénalité', /repris/.test(txt(sortie(repris))) && joueur('u1').col === colApres);

    // Voyage, Argo, pêche, équipement : même règle partout.
    const cas = [
      ['voyager', () => G.voyagerSao('G1', 'u1', 1)],
      ['Argo', () => G.acheterRenseignement('G1', 'u1')],
      // Au bord du lac de l'étage 22 : seul le combat pouvait refuser.
      ['pêche', () => G.lancerPeche('G1', 'u1'), { floor: 23 }, { position: 22, peche_le: 0 }],
      ['équiper', () => { G.donnerObjet('G1', 'u1', 'veste_cuir', 1); return G.utiliserObjet('G1', 'u1', 'veste_cuir'); }],
    ];
    for (const [nom, agir, avant = {}, apres = {}] of cas) {
      const cb = nouveauCombat('u1', { hp: 300, col: 1000, ...avant });
      if (Object.keys(apres).length) majJoueur('u1', apres);
      vieillir(cb.id, ABANDON);
      const r = agir();
      V(`${nom} : plus de refus « en plein combat », pénalité unique et remontée`, r.refus !== 'en_combat' && G.combatParId(cb.id).statut === 'abandon' && r.abandon?.perte === 50 && joueur('u1').col === 950 - (r.info?.prix || 0), JSON.stringify({ refus: r.refus, perte: r.abandon?.perte, col: joueur('u1').col }));
    }
    const cv = nouveauCombat('u1', { hp: 300, floor: 2 });
    vieillir(cv.id, ABANDON);
    const voy = await commande('voyager', { options: { etage: 1 } });
    V('/sao voyager : la ligne d\'abandon est dans la réponse', /a été abandonné/.test(txt(sortie(voy))), txt(sortie(voy)).slice(0, 200));

    // /sao cd clôt lui aussi le combat : la pénalité y est dite, pas encaissée en silence.
    const cd = nouveauCombat('u1', { hp: 300, col: 10000 });
    vieillir(cd.id, ABANDON);
    const delais = await commande('cd');
    const tcd = txt(sortie(delais));
    V('/sao cd, combat quitté il y a 2 h : clos en fuite (−5 %)', G.combatParId(cd.id).statut === 'abandon' && joueur('u1').col === 9500, String(joueur('u1').col));
    V('… et la carte « Délais » le dit : abandon et Col perdus, en tête', /Délais/.test(tcd) && /a été abandonné/.test(tcd) && /−500 Col/.test(tcd) && tcd.indexOf('abandonné') < tcd.indexOf('Chasse') && eph(sortie(delais)), tcd.slice(0, 300));
    const encore = await commande('cd');
    V('… une seule fois : le /sao cd suivant n\'en reparle pas', !/abandonné/.test(txt(sortie(encore))) && joueur('u1').col === 9500);
  }

  console.log('\n5) Aincrad conquis : jamais de quête « Vaincre un boss » ni « Sword Skills »');
  {
    let conquis = 0;
    let front = 0;
    let skillsConquis = 0;
    let skillsFront = 0;
    for (let i = 0; i < 60; i++) {
      G.ensurePlayer('G1', `conq${i}`);
      majJoueur(`conq${i}`, { floor: 101, position: 100 });
      const qc = G.quetesDuJour('G1', `conq${i}`);
      if (qc.some((q) => q.cle === 'boss')) conquis++;
      if (qc.some((q) => q.cle === 'skills')) skillsConquis++;
      G.ensurePlayer('G1', `front${i}`);
      majJoueur(`front${i}`, { floor: 100, position: 100 });
      const qf = G.quetesDuJour('G1', `front${i}`);
      if (qf.some((q) => q.cle === 'boss')) front++;
      if (qf.some((q) => q.cle === 'skills')) skillsFront++;
    }
    V('60 joueurs à l\'étage 101 : aucune quête boss (24 avant)', conquis === 0, String(conquis));
    V('… elle reste tirée à l\'étage 100, où un boss attend', front > 0, String(front));
    // Les Sword Skills ne se lancent qu'en combat de boss : sans boss, la
    // quête est tout aussi impossible et coûtait le coffre des trois quêtes.
    V('60 joueurs à l\'étage 101 : aucune quête « Sword Skills » non plus', skillsConquis === 0, String(skillsConquis));
    V('… elle reste tirée à l\'étage 100', skillsFront > 0, String(skillsFront));
  }

  console.log('\n6) Clics tardifs (mode carte) : la carte de fin n\'est jamais écrasée');
  {
    // Combat : double clic « Attaquer » sur le même message, boss à 1 PV.
    const c = nouveauCombat('u1', { hp: 500, floor: 1, position: 1 });
    majCombat(c.id, (e) => { e.bPv = 1; e.tour = 0; });
    const carte = carteDe(VUES.carteBoss(G.combatParId(c.id), { nom: 'Alice', inventaire: [] }), 'MSG_BOSS');
    const it1 = fausse({ type: 'bouton', customId: `sao:cb:atk:${c.id}:0` });
    const it2 = fausse({ type: 'bouton', customId: `sao:cb:atk:${c.id}:0` });
    it1.message = carte;
    it2.message = JSON.parse(JSON.stringify(carte));
    await IC.execute(it1);
    await IC.execute(it2);
    V('clic 1 : victoire, carte de fin posée', G.combatParId(c.id).statut === 'gagne' && /nettoyé/.test(txt(it1.mises[0])));
    V('clic 2 (même message) : la carte n\'est PAS réécrite avec l\'état périmé', it2.mises.length === 0, txt(it2.mises[0]).slice(0, 160));
    V('… il reçoit seulement une explication privée', eph(it2.reponses[0]) && /déjà gagné/.test(it2.reponses[0].content), it2.reponses[0]?.content);

    // Fuite : même double clic.
    const f = nouveauCombat('u1', { hp: 500 });
    const carteF = carteDe(VUES.carteBoss(f, { nom: 'Alice', inventaire: [] }), 'MSG_FUITE');
    const f1 = fausse({ type: 'bouton', customId: `sao:cb:fuir:${f.id}:0` });
    const f2 = fausse({ type: 'bouton', customId: `sao:cb:fuir:${f.id}:0` });
    f1.message = carteF;
    f2.message = JSON.parse(JSON.stringify(carteF));
    await IC.execute(f1);
    await IC.execute(f2);
    V('fuite puis second clic : carte de fuite intacte, phrase entière en privé', /Fuite face/.test(txt(f1.mises[0])) && f2.mises.length === 0 && /Tu as déjà fui ce combat/.test(f2.reponses[0]?.content || ''));

    // Raid : X porte le coup fatal, Y a cliqué sur la même version de la carte.
    const raid = RAID.creerRaid('G1');
    db.prepare('UPDATE sao_raids SET pv = 1 WHERE id = ?').run(raid.id);
    const instantane = carteDe(VUES.carteRaid(RAID.raidParId(raid.id)), 'MSG_RAID');
    const x = fausse({ type: 'bouton', customId: `sao:rd:${raid.id}`, user: 'u2' });
    const y = fausse({ type: 'bouton', customId: `sao:rd:${raid.id}`, user: 'u3' });
    x.message = instantane;
    y.message = JSON.parse(JSON.stringify(instantane));
    await IC.execute(x);
    await IC.execute(y);
    V('raid : X abat le boss, carte de victoire posée', RAID.raidParId(raid.id).statut === 'vaincu' && /est tombé/.test(txt(x.mises[0])));
    V('… le clic de Y ne réécrit pas le message (la victoire restait effacée)', y.mises.length === 0, txt(y.mises[0]).slice(0, 160));
    V('… Y est prévenu en privé', eph(y.reponses[0]) && /terminé/.test(y.reponses[0].content));

    // Raid expiré dont la carte a gardé son bouton : redessiné depuis la base.
    const r2 = RAID.creerRaid('G1', { now: Date.now() - 30 * 3600000 });
    RAID.expirerRaid(r2);
    const z = fausse({ type: 'bouton', customId: `sao:rd:${r2.id}`, user: 'u4' });
    z.message = carteDe(VUES.carteRaid(r2), 'MSG_RAID2');
    await IC.execute(z);
    V('raid expiré : carte redessinée depuis la base, plus de bouton', /s'est retiré/.test(txt(z.mises[0])) && !/Il se retire/.test(txt(z.mises[0])) && !/sao:rd:/.test(txt(z.mises[0])));
  }

  console.log('\n7) Quête « Lancer N Sword Skills » bouclée par le dernier coup');
  {
    const forcerQuetes = () => {
      const jour = G.jourSao();
      db.prepare("DELETE FROM sao_quetes WHERE guild_id = 'G1' AND user_id = 'u1'").run();
      const ajout = db.prepare('INSERT INTO sao_quetes (guild_id, user_id, jour, cle, objectif, progres, faite) VALUES (?, ?, ?, ?, ?, ?, 0)');
      ajout.run('G1', 'u1', jour, 'skills', 4, 3);
      ajout.run('G1', 'u1', jour, 'tuer', 10, 0);
      ajout.run('G1', 'u1', jour, 'vendre', 5, 0);
    };
    forcerQuetes();
    const c = nouveauCombat('u1', { hp: 500, floor: 1, position: 1 });
    majCombat(c.id, (e) => { e.bPv = 1; e.tour = 0; e.recharges = {}; });
    const xp0 = L.getLevels('G1', 'u1').xp;
    const v = await clic(`sao:cb:sk:${c.id}:0:slant`);
    const gagne = L.getLevels('G1', 'u1').xp - xp0;
    V('Slant fatal : victoire', G.combatParId(c.id).statut === 'gagne');
    V('… la quête est annoncée sur la carte de victoire', /Quête accomplie : 🌀 Lancer 4 Sword Skills/.test(txt(v.mises[0])), txt(v.mises[0]).slice(0, 300));
    V('… et ses 5 XP serveur sont versées (27 + 5 = 32)', gagne === F.gainsBoss(1).xpServeur + 5, String(gagne));

    // Défaite au même tour : la quête compte aussi.
    forcerQuetes();
    while (G.retirerObjet('G1', 'u1', 'pierre_ame', 1));
    const d = nouveauCombat('u1', { hp: 500 });
    majCombat(d.id, (e) => { e.jPv = 1; e.tour = 0; e.charge = false; e.etourdi = 0; e.poison = 0; e.recharges = {}; });
    const xp1 = L.getLevels('G1', 'u1').xp;
    const def = await clic(`sao:cb:sk:${d.id}:0:slant`);
    V('Slant puis mort au même tour : défaite', G.combatParId(d.id).statut === 'perdu');
    V('… la carte de défaite annonce la quête et son XP serveur', /Quête accomplie/.test(txt(def.mises[0])) && /\+5 XP serveur/.test(txt(def.mises[0])), txt(def.mises[0]).slice(0, 300));
    V('… et les 5 XP serveur sont versées', L.getLevels('G1', 'u1').xp - xp1 === 5, String(L.getLevels('G1', 'u1').xp - xp1));
    majJoueur('u1', { reapparition: 0 });
  }

  console.log('\n8) Consulter la fiche d\'un autre ne gèle plus sa régénération');
  {
    const pvMax = G.statsJoueur(G.chargerJoueur('G1', 'u4')).pvMax;
    const attendu = Math.min(pvMax, 10 + Math.floor(10 * F.REGEN_PAR_MINUTE * pvMax));
    // 10 minutes de repos ; toutes les 25 s, Bob ouvre la fiche de Dan.
    const rejouer = async (consulter) => {
      majJoueur('u4', { hp: 10, reapparition: 0, pv_le: Date.now() });
      for (let i = 0; i < 24; i++) {
        majJoueur('u4', { pv_le: Number(joueur('u4').pv_le) - 25000 });
        await consulter();
      }
      return G.chargerJoueur('G1', 'u4').hp;
    };
    const profil = await rejouer(() => commande('profil', { user: 'u2', options: { membre: 'u4' } }));
    V(`fiche consultée toutes les 25 s : ${profil}/${pvMax} PV, comme sans consultation (${attendu})`, Math.abs(profil - attendu) <= 1, `${profil} au lieu de ${attendu}`);
    const inv = await rejouer(() => clic('sao:inv:u4:1', { user: 'mod' }));
    V(`bouton de pages cliqué par un tiers sans personnage : ${inv}/${pvMax} PV`, Math.abs(inv - attendu) <= 1, `${inv} au lieu de ${attendu}`);
    majJoueur('u4', { hp: 10, pv_le: Date.now() - 10000 });
    const avant = joueur('u4').pv_le;
    await commande('profil', { user: 'u2', options: { membre: 'u4' } });
    V('une consultation sans PV gagné ne réécrit pas l\'horloge de régénération', joueur('u4').pv_le === avant);
  }

  console.log('\n9) Duel : l\'XP de quête du vainqueur, avec le membre du VAINQUEUR');
  {
    const ROLE_VIP = '900000000000000001';
    const SANS_XP = '800000000000000001';
    setGuildConfig('G2', 'sao_enabled', 1);
    L.ajouterRecompenseNiveau('G2', { niveau: 3, type: 'role', valeur: ROLE_VIP });
    L.ajouterExclusionXp('G2', 'role', SANS_XP, 'tout');
    const ajouts = [];
    const mk = (id, roles) => ({
      id, user: { id, username: id }, displayName: id,
      roles: { cache: new Map(roles.map((r) => [r, { id: r }])), add: async (role) => { ajouts.push({ membre: id, role: role.id }); }, remove: async () => {}, highest: { position: 99 } },
    });
    // a : niveau 3, déjà récompensé (rôle VIP) ; b : niveau 0.
    // a2 : sans rôle ; b2 : exclu de l'XP par un rôle.
    const MEMBRES = { a: mk('a', [ROLE_VIP]), b: mk('b', []), a2: mk('a2', []), b2: mk('b2', [SANS_XP]) };
    const g2 = {
      id: 'G2', name: 'Duel', iconURL: () => null,
      members: { cache: new Map(Object.entries(MEMBRES)), fetch: async (id) => MEMBRES[id] || null, me: { roles: { highest: { position: 99 } } } },
      roles: { cache: new Map([[ROLE_VIP, { id: ROLE_VIP, position: 1, managed: false }]]), fetch: async () => null },
      channels: { fetch: async () => null, cache: new Map() },
    };
    L.addXp('G2', 'a', 'admin', L.totalXpForLevel(3) + 10);
    const jour = G.jourSao();
    // Le défi de `x` (sûr de gagner, quête « duel » du jour), accepté par `y`.
    const duel = async (x, y) => {
      G.ensurePlayer('G2', x);
      G.ensurePlayer('G2', y);
      majJoueur(x, { level: 90 }, 'G2');
      for (const cle of ['duel', 'tuer', 'forger']) {
        db.prepare('INSERT INTO sao_quetes (guild_id, user_id, jour, cle, objectif, progres, faite) VALUES (?, ?, ?, ?, ?, 0, 0)').run('G2', x, jour, cle, cle === 'duel' ? 1 : 10);
      }
      const d = G.proposerDuel('G2', x, y);
      const xp = L.getLevels('G2', x).xp;
      const it = {
        client, guild: g2, guildId: 'G2', channel: null, user: { id: y }, member: MEMBRES[y], customId: `sao:du:ok:${d.id}`,
        message: { id: `MSG_DUEL_${x}`, flags: 0, components: [] }, replied: false, deferred: false,
        async reply() { this.replied = true; }, async update(p) { this.replied = true; this.maj = p; }, async deferUpdate() {}, async followUp() {},
      };
      await SAO.handleButton(it);
      await pause(150);
      return { vainqueur: G.duelParId(d.id).vainqueur, gain: L.getLevels('G2', x).xp - xp };
    };
    const d1 = await duel('a', 'b');
    V('a gagne le duel, boucle sa quête et reçoit ses 5 XP', d1.vainqueur === 'a' && d1.gain === 5, JSON.stringify(d1));
    V('b, qui a cliqué « Accepter », ne reçoit pas le rôle de niveau de a', !ajouts.some((x) => x.membre === 'b'), JSON.stringify(ajouts));
    V('b ne gagne aucune XP au passage', (L.getLevels('G2', 'b').xp || 0) === 0);
    const d2 = await duel('a2', 'b2');
    V('l\'exclusion par rôle de l\'adversaire ne prive plus le vainqueur de son XP', d2.vainqueur === 'a2' && d2.gain === 5, JSON.stringify(d2));
  }

  console.log('\n10) Raid : l\'XP de la chute avec le membre de chaque participant');
  {
    const SANS_XP = '700000000000000001';
    setGuildConfig('G3', 'sao_enabled', 1);
    L.ajouterExclusionXp('G3', 'role', SANS_XP, 'tout');
    const mk = (id, roles = []) => ({ id, user: { id }, roles: { cache: new Map(roles.map((r) => [r, { id: r }])) } });
    const cache = new Map([['k', mk('k', [SANS_XP])], ['p2', mk('p2', [SANS_XP])], ['p3', mk('p3')]]);
    const horsCache = { p5: mk('p5') }; // présent, mais pas en cache
    const g3 = {
      id: 'G3', name: 'Raid', iconURL: () => null, roles: { cache: new Map() },
      members: {
        cache,
        fetch: async (id) => {
          if (horsCache[id]) return horsCache[id];
          throw Object.assign(new Error('Unknown Member'), { code: 10007 }); // p4 a quitté le serveur
        },
      },
    };
    const raid = RAID.creerRaid('G3');
    db.prepare('UPDATE sao_raids SET pv = 1 WHERE id = ?').run(raid.id);
    for (const id of ['p2', 'p3', 'p4', 'p5']) {
      G.ensurePlayer('G3', id);
      db.prepare('INSERT INTO sao_raid_coups (raid_id, user_id, degats, coups, dernier_le) VALUES (?, ?, 100, 1, ?)').run(raid.id, id, Date.now() - 3600000);
    }
    const it = {
      client, guild: g3, guildId: 'G3', channel: null, user: { id: 'k' }, member: cache.get('k'), customId: `sao:rd:${raid.id}`,
      message: { id: 'MSG_R3', flags: 0, components: [] }, replied: false, deferred: false,
      async reply() {}, async update() { this.replied = true; }, async deferUpdate() {}, async followUp() {},
    };
    await SAO.handleButton(it);
    await pause(150);
    const xp = (id) => L.getLevels('G3', id).xp || 0;
    V('le raid tombe', RAID.raidParId(raid.id).statut === 'vaincu');
    V('le frappeur exclu de l\'XP par un rôle n\'en reçoit pas (50 avant)', xp('k') === 0, String(xp('k')));
    V('… un autre participant exclu non plus', xp('p2') === 0, String(xp('p2')));
    V('un participant sans exclusion est payé', xp('p3') > 0);
    V('un participant hors cache est retrouvé et payé', xp('p5') > 0);
    V('un participant parti du serveur ne reçoit rien', xp('p4') === 0);
  }

  console.log('\n11) Raid expiré : la consolation une seule fois');
  {
    for (const g of ['G4', 'G5']) setGuildConfig(g, 'sao_enabled', 1);
    const now = Date.now();
    const r1 = RAID.creerRaid('G4', { now: now - 30 * 3600000 });
    const r2 = RAID.creerRaid('G5', { now: now - 30 * 3600000 });
    db.prepare("UPDATE sao_raids SET message_id = 'M', salon_id = 'S' || guild_id WHERE id IN (?, ?)").run(r1.id, r2.id);
    G.ensurePlayer('G5', 'w');
    db.prepare('INSERT INTO sao_raid_coups (raid_id, user_id, degats, coups, dernier_le) VALUES (?, ?, 100, 1, ?)').run(r2.id, 'w', now - 29 * 3600000);
    const col0 = joueur('w', 'G5').col;
    const conso = 3 * F.colChasse(1);
    // Un membre de G5 clique « Frapper » pendant que la passe attend le réseau pour G4.
    let clicPendant = null;
    const lent = {
      guilds: { cache: new Map() },
      channels: {
        fetch: async (id) => {
          if (id === 'SG4' && !clicPendant) clicPendant = RAID.frapperRaid(r2.id, 'v');
          await pause(10);
          return null;
        },
      },
    };
    const bilan = await RAID.tourDeRaids(lent, now);
    V('le clic pendant la passe expire le raid de G5', clicPendant?.refus === 'expire');
    V(`la consolation est versée une seule fois (${conso} Col, et non ${2 * conso})`, joueur('w', 'G5').col - col0 === conso, String(joueur('w', 'G5').col - col0));
    V('les deux raids sont clos', RAID.raidParId(r1.id).statut === 'expire' && RAID.raidParId(r2.id).statut === 'expire' && bilan.expires.includes(r1.id));
    const col1 = joueur('w', 'G5').col;
    RAID.expirerRaid(RAID.raidParId(r2.id));
    V('expirer un raid déjà clos ne paie plus rien', joueur('w', 'G5').col === col1);
  }

  console.log('\n12) Des phrases entières, traduisibles');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'sao.js'), 'utf8');
    V('plus de table de mots glissés dans « Ce combat est ${issue} »', !/gagne: 'gagné'/.test(src));
    // Un combat abandonné, cliqué 2 h plus tard : une phrase entière, montant compris.
    majJoueur('u1', { col: 1000 });
    const c = nouveauCombat('u1', { hp: 300 });
    vieillir(c.id, ABANDON);
    const ab = await clic(`sao:cb:atk:${c.id}:0`);
    V('combat abandonné : « Ce combat a été abandonné : il compte comme une fuite (−50 Col). »',
      /^⌛ Ce combat a été abandonné : il compte comme une fuite \(−50 Col\)\. `\/sao boss` pour retenter ta chance\.$/.test(ab.suivis[0]?.content || ''), ab.suivis[0]?.content);
    V('… et ce clic, qui vient de le clore, retire les boutons de son message', ab.mises[0]?.components?.length === 0);
    const cfg = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'sao', 'configSao.js'), 'utf8');
    V('plus de « effacé${…s} » accordé au vol', !/effacé\$\{/.test(cfg));
    const remise = async () => {
      const it = fausse({ type: 'bouton', customId: 'cfgsao:okt', grade: 3, user: 'adm' });
      await handleConfigInteraction(it);
      return txt(it.mises[0]);
    };
    V('remise à zéro de plusieurs personnages : phrase au pluriel', /Aventure remise à zéro\. Personnages effacés : \d+\./.test(await remise()));
    G.ensurePlayer('G1', 'seul');
    V('… d\'un seul : phrase au singulier', /Aventure remise à zéro : 1 personnage effacé\./.test(await remise()));
    V('… d\'aucun : une phrase qui le dit', /il n'y avait aucun personnage à effacer/.test(await remise()));
  }

  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  console.log('\n0 réussis, 1 échoués');
  process.exit(1);
});
