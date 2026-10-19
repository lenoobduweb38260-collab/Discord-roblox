// ⚔️ Aventure SAO — formules et équilibrage (simulation), combat de boss
// persistant (redémarrage, anciens messages), mort et pénalités, objets,
// boutique, forge, Argo, quotidienne et quêtes, monde (voyage, pêche,
// cuisine), raid partagé, duel, coffre de couple, contrat A, /config, et les
// limites de Discord sur TOUT ce que la suite a fait afficher.
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'sao-'));
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
const C = require('../src/utils/sao/combat');
const D = require('../src/utils/sao/donnees');
const S = require('../src/utils/sao/simulation');
// Le hasard des commandes devient reproductible.
Math.random = F.aleaGraine(20261019);

const { db, setGuildConfig, getGuildConfig } = require('../src/database');
const cartes = require('../src/utils/cartes');
const { getLevels } = require('../src/utils/levels');
const IC = require('../src/events/interactionCreate');
const { handleConfigInteraction } = require('../src/utils/configPanel');
let G = require('../src/utils/saoGame');
let SAO = require('../src/commands/sao');
let RAID = require('../src/utils/sao/raid');

let ok = 0;
let ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

// ── Faux Discord ────────────────────────────────────────────────────────
const personne = (id, nom, bot = false) => ({
  id, username: nom.toLowerCase(), displayName: nom, globalName: nom, bot, tag: `${nom}#0`,
  displayAvatarURL: () => `https://cdn.test/${id}.png`,
});
const USERS = {
  u1: personne('u1', 'Alice'), u2: personne('u2', 'Bob'), u3: personne('u3', 'Chloé'), u4: personne('u4', 'Dan'),
  adm: personne('adm', 'Admin'), mod: personne('mod', 'Modo'), robot: personne('robot', 'Robot', true),
};
let n = 0;
function salon(id) {
  const s = {
    id, envois: [], guild: null, isTextBased: () => true,
    async send(m) {
      const msg = { id: `M${++n}`, channelId: id, flags: 0, ...m, editions: [], async edit(e) { msg.editions.push(e); return msg; } };
      s.envois.push(msg);
      return msg;
    },
    messages: { fetch: async (mid) => s.envois.find((m) => m.id === mid) || null },
  };
  return s;
}
const SALONS = { GEN: salon('GEN'), RAID: salon('RAID'), LOGS: salon('LOGS') };
const guild = {
  id: 'G1', name: 'Aincrad', iconURL: () => null,
  members: {
    cache: new Map(Object.values(USERS).map((u) => [u.id, { id: u.id, user: u, displayName: u.id === 'u1' ? 'Alice la Brave' : u.displayName }])),
    fetch: async () => null,
  },
  channels: { fetch: async (id) => SALONS[id] || null, cache: new Map() },
  roles: { cache: new Map() },
};
Object.values(SALONS).forEach((s) => { s.guild = guild; });
const client = {
  user: { id: 'bot', username: 'Bot' },
  commands: new Map([['sao', SAO]]),
  users: { fetch: async (id) => USERS[id] || null },
  channels: { fetch: async (id) => SALONS[id] || null },
  guilds: { cache: new Map([['G1', guild]]) },
};
const BIT_MOD = 1n << 40n;
const BIT_ADMIN = 1n << 3n;
const membre = (id, grade = 0) => ({
  id, user: USERS[id], guild, displayName: guild.members.cache.get(id)?.displayName, roles: { cache: new Map() },
  permissions: { has: (b) => (grade >= 3 && b === BIT_ADMIN) || (grade >= 2 && b === BIT_MOD) },
});

const TOUS = [];
function fausse({ type = 'commande', user = 'u1', grade = 0, sub = null, groupe = null, options = {}, customId = null, valeurs = [], champs = {}, focus = null } = {}) {
  const composant = ['bouton', 'menu', 'menuUser', 'menuSalon'].includes(type);
  return {
    client, guild, guildId: 'G1', channelId: 'GEN', channel: SALONS.GEN, locale: 'fr', user: USERS[user], member: membre(user, grade),
    commandName: 'sao', customId, values: valeurs, deferred: false, replied: false,
    message: { id: 'MSG', flags: 0, components: [], embeds: [{}], createdTimestamp: Date.now() },
    inGuild: () => true, isAutocomplete: () => type === 'auto', isChatInputCommand: () => type === 'commande',
    isButton: () => type === 'bouton', isStringSelectMenu: () => type === 'menu', isUserSelectMenu: () => type === 'menuUser',
    isChannelSelectMenu: () => type === 'menuSalon', isRoleSelectMenu: () => false, isAnySelectMenu: () => ['menu', 'menuUser', 'menuSalon'].includes(type),
    isModalSubmit: () => type === 'modal', isFromMessage: () => type === 'modal', isMessageComponent: () => composant,
    options: {
      getSubcommand: () => sub, getSubcommandGroup: () => groupe,
      getString: (k) => options[k] ?? null, getInteger: (k) => options[k] ?? null, getBoolean: (k) => options[k] ?? null,
      getUser: (k) => USERS[options[k]] || null, getChannel: (k) => SALONS[options[k]] || null,
      getFocused: (complet) => (complet ? { name: focus, value: options[focus] ?? '' } : options[focus] ?? ''),
    },
    fields: { getTextInputValue: (k) => champs[k] ?? '' },
    reponses: [], suivis: [], mises: [], modales: [], choix: null,
    async reply(p) { this.replied = true; this.reponses.push(p); TOUS.push(p); return p; },
    async deferReply() { this.deferred = true; },
    async editReply(p) { this.reponses.push(p); TOUS.push(p); return p; },
    async followUp(p) { this.suivis.push(p); return p; },
    async update(p) { this.replied = true; this.mises.push(p); TOUS.push(p); return p; },
    async deferUpdate() { this.deferred = true; },
    async showModal(m) { this.modales.push(m.toJSON ? m.toJSON() : m); },
    async respond(c) { this.choix = c; },
  };
}
const json = (x) => (x && typeof x.toJSON === 'function' ? x.toJSON() : x);
const sortie = (it) => it.mises[it.mises.length - 1] || it.reponses[it.reponses.length - 1] || {};
const embedDe = (p) => json(p?.embeds?.[0]) || {};
const txt = (p) => JSON.stringify({ c: p?.content ?? null, e: (p?.embeds || []).map(json) });
const ids = (p) => (p?.components || []).map(json).flatMap((r) => (r.components || []).map((c) => c.custom_id)).filter(Boolean);
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
const joueur = (u = 'u1') => G.getPlayer('G1', u);
const majJoueur = (u, champs) => {
  const cles = Object.keys(champs);
  db.prepare(`UPDATE sao_players SET ${cles.map((k) => `${k} = ?`).join(', ')} WHERE guild_id = 'G1' AND user_id = ?`).run(...cles.map((k) => champs[k]), u);
};
const majCombat = (id, f) => {
  const row = db.prepare('SELECT etat FROM sao_combats WHERE id = ?').get(id);
  const e = JSON.parse(row.etat);
  f(e);
  db.prepare('UPDATE sao_combats SET etat = ?, maj_le = ? WHERE id = ?').run(JSON.stringify(e), Date.now(), id);
  return e;
};
const ilYa = (ms) => new Date(Date.now() - ms).toISOString();

// Un « redémarrage » : tout le code du jeu est rechargé, la base reste.
function redemarrer() {
  for (const k of Object.keys(require.cache)) {
    if (/src[\\/](commands[\\/]sao\.js|utils[\\/]saoGame\.js|utils[\\/]sao[\\/])/.test(k)) delete require.cache[k];
  }
  G = require('../src/utils/saoGame');
  SAO = require('../src/commands/sao');
  RAID = require('../src/utils/sao/raid');
  client.commands.set('sao', SAO);
}

(async () => {
  console.log('\n1) La courbe : formules et équilibrage');
  {
    V('premiers niveaux rapides (75, 150, 275 XP)', F.xpPourNiveau(1) === 75 && F.xpPourNiveau(2) === 150 && F.xpPourNiveau(3) === 275);
    V('puis linéaire : 150 + 190·L', F.xpPourNiveau(50) === 150 + 190 * 50 && F.xpPourNiveau(100) === 150 + 190 * 100);
    const parts = [10, 25, 50, 75, 100].map((f) => {
      const r = F.aventurierReference(f);
      return Math.round(D.ATK_PALIER[r.palier] * (1 + 0.07 * r.plus)) / r.atk;
    });
    V('l\'arme pèse autant que le niveau dans l\'ATK de référence (40 à 60 %)', parts.every((x) => x >= 0.4 && x <= 0.6), parts.map((x) => x.toFixed(2)).join(' '));
    const ecarts = [1, 8, 20, 35, 60, 85, 100].map((L) => Math.abs(F.multiplicateurRotation(L, 'epee') - F.multiplicateurRotation(L, 'rapiere')) / F.multiplicateurRotation(L, 'epee'));
    V('épée et rapière se valent (rotation de Sword Skills à 10 % près)', ecarts.every((e) => e <= 0.1), ecarts.map((e) => e.toFixed(2)).join(' '));
    const rng = F.aleaGraine(1);
    let gagnees = 0;
    for (let i = 0; i < 300; i++) {
      const type = D.TRANCHES[1].monstres[i % D.TRANCHES[1].monstres.length];
      if (F.combatChasse({ atk: F.atkDe(1, D.ATK_PALIER[0], 0), pv: F.pvMaxDe(1), def: 0 }, F.statsMonstre(1, type), rng).victoire) gagnees++;
    }
    V('un débutant de niveau 1 gagne ses chasses à l\'étage 1 (> 95 %)', gagnees / 300 > 0.95, `${gagnees}/300`);

    const prepare = { cristal_soin: 3, potion_soin: 6, antidote: 2 };
    const taux = (f, opts = {}, inv = prepare, N = 200) => {
      const rng2 = F.aleaGraine(f * 31 + (opts.ecartNiveau || 0) * 7 + (opts.ecartPalier || 0) * 13 + (opts.plus || 0));
      let w = 0;
      for (let i = 0; i < N; i++) {
        const r = F.aventurierReference(f, opts);
        const e = C.nouveauCombat({ etage: f, boss: D.bossDe(f), statsBoss: F.statsBoss(f), antiCristal: D.salleAntiCristal(f),
          joueur: { pv: r.pv, pvMax: r.pv, atk: r.atk, def: r.def, skills: C.skillsDisponibles(r.niveau, opts.famille || 'epee') } });
        if (C.simulerCombatBoss(e, { ...inv }, rng2) === 'victoire') w++;
      }
      return Math.round((100 * w) / N);
    };
    const ref = [10, 50, 90].map((f) => taux(f));
    V('à la référence, bien préparé : le boss tombe (≥ 80 %)', ref.every((x) => x >= 80), ref.join(' / '));
    V('… à la rapière aussi', taux(50, { famille: 'rapiere' }) >= 80);
    const depart = taux(50, { ecartPalier: -99 });
    V('au bon niveau mais avec l\'arme de départ : défaite quasi certaine (≤ 10 %)', depart <= 10, `${depart} %`);
    const base = taux(50);
    const sansNiveau = base - taux(50, { ecartNiveau: -10 });
    const sansArme = base - taux(50, { ecartPalier: -1 });
    V('20 % de niveaux en moins coûtent autant qu\'un palier d\'équipement', sansNiveau >= 8 && sansArme >= 8 && Math.abs(sansNiveau - sansArme) <= 25, `−${sansNiveau} / −${sansArme} points`);
    V('sans objets, bien plus dur (étage 20)', taux(20) - taux(20, {}, {}) >= 30);
    V('une arme à +10 aide franchement', taux(74, { plus: 10 }) > taux(74));
    V('salle anti-cristal (74) : dangereuse mais jouable', taux(74) >= 40 && taux(74) < 100, `${taux(74)} %`);
    V('le boss se cale sur l\'aventurier de référence, en PV comme en ATK', F.statsBoss(50).pv > F.statsBoss(10).pv && F.statsBoss(100).atk > F.statsBoss(50).atk);
    V('difficulté héroïque : ennemis plus forts', F.statsBoss(30, 'heroique').pv > F.statsBoss(30).pv && F.statsMonstre(30, { pv: 1, atk: 1 }, 'facile').atk < F.statsMonstre(30).atk);
  }

  console.log('\n2) Simulation d\'un joueur régulier, de l\'étage 1 à 100');
  {
    const r60 = S.simulerProgression({ chassesParJour: 60, graine: 7 });
    V('60 chasses par jour : Aincrad conquis en 2 à 6 semaines', r60.jours >= 14 && r60.jours <= 42, JSON.stringify(r60));
    V('l\'étage 50 tombe vers la mi-parcours', r60.jalons[50] >= r60.jours * 0.3 && r60.jalons[50] <= r60.jours * 0.7);
    const r20 = S.simulerProgression({ chassesParJour: 20, graine: 7 });
    V('20 chasses par jour : plus lent, mais atteignable (< 10 semaines)', r20.jours > r60.jours && r20.jours <= 70, `${r20.jours} jours`);
    const r100 = S.simulerProgression({ chassesParJour: 100, graine: 7 });
    V('100 chasses par jour : plus rapide', r100.jours < r60.jours, `${r100.jours} jours`);
    V('niveau final proche de la référence (103 ± 15)', Math.abs(r60.niveau - 103) <= 15, `niveau ${r60.niveau}`);
    V('l\'équipement suit : arme et armure au dernier palier', r60.arme === D.PALIER_MAX && r60.armure === D.PALIER_MAX);
    V('à la rapière, même rythme (± 5 jours)', Math.abs(S.simulerProgression({ chassesParJour: 60, graine: 7, famille: 'rapiere' }).jours - r60.jours) <= 5);
  }

  console.log('\n3) Module coupé, démarrage, XP serveur (contrat C), displayName');
  {
    const it = await commande('start');
    V('module coupé : refus éphémère qui renvoie à /config → ⚔️ Aventure SAO', eph(it.reponses[0]) && /⚔️ Aventure SAO/.test(it.reponses[0].content), txt(it.reponses[0]));
    const b = await clic('sao:ch:u1');
    V('module coupé : un vieux bouton ne fait plus rien', /désactivé/.test(txt(b.reponses[0])));
    const a = fausse({ type: 'auto', sub: 'utiliser', focus: 'objet' });
    await SAO.autocomplete(a);
    V('module coupé : l\'autocomplétion ne propose rien', Array.isArray(a.choix) && a.choix.length === 0);
  }
  setGuildConfig('G1', 'sao_enabled', 1);
  setGuildConfig('G1', 'log_channel_id', 'LOGS');
  {
    const it = await commande('start');
    const p = sortie(it);
    V('start : carte de bienvenue publique', /Bienvenue dans Aincrad/.test(txt(p)) && !eph(p));
    V('start : +20 XP serveur par le contrat C (repli tant qu\'il manque)', getLevels('G1', 'u1').xp === 20, String(getLevels('G1', 'u1').xp));
    V('start : la ligne d\'XP serveur est affichée', /\+20 XP serveur/.test(txt(p)));
    V('start : 100 Col, 3 potions et 1 cristal', joueur().col === 100 && G.quantiteSao('G1', 'u1', 'potion_soin') === 3 && G.quantiteSao('G1', 'u1', 'cristal_soin') === 1);
    V('start : badge Débutant', G.ownedBadges('G1', 'u1').includes('debutant'));
    const encore = await commande('start');
    V('start une seconde fois : la fiche, sans rien recréer', /déjà dans Aincrad/.test(txt(sortie(encore))) && joueur().col === 100);
    const prof = await commande('profil');
    const e = embedDe(sortie(prof));
    V('profil : le pseudo du serveur (displayName), pas le nom d\'utilisateur', /Alice la Brave/.test(e.title) && !/alice\b/.test(e.title), e.title);
    V('profil : sections ◆/➜, aucune grille de champs, pas de pied décoratif', !(e.fields || []).length && /◆/.test(e.description) && /➜/.test(e.description) && !e.footer);
    V('profil : ville canon de l\'étage 1', /Town of Beginnings/.test(e.description));
    V('profil : boss canon de l\'étage 1', /Illfang the Kobold Lord/.test(e.description));
  }
  setGuildConfig('G1', 'levels_enabled', 0);
  {
    const it = await commande('start', { user: 'u2' });
    V('niveaux coupés : aucune XP serveur affichée', !/XP serveur/.test(txt(sortie(it))));
    V('… ni créditée', (getLevels('G1', 'u2').xp || 0) === 0);
  }
  setGuildConfig('G1', 'levels_enabled', 1);

  console.log('\n4) Chasse, délais, AFK');
  {
    const it = await commande('chasser');
    const p = sortie(it);
    V('chasser : boutons Rechasser, Auberge et Boss', ['sao:ch:u1', 'sao:au:u1', 'sao:bo:u1'].every((id) => ids(p).includes(id)), ids(p).join(','));
    V('chasser : un récit (victoire ou défaite)', /vaincu|Vaincu/.test(txt(p)));
    const encore = await commande('chasser');
    V('délai de chasse respecté (sao_chasse_delai)', eph(encore.reponses[0]) && /souffle/.test(encore.reponses[0].content));
    const autre = await clic('sao:ch:u1', { user: 'u2' });
    V('le bouton d\'un autre joueur est refusé', eph(autre.reponses[0]) && /pas ton aventure/.test(autre.reponses[0].content));
    majJoueur('u1', { last_hunt: ilYa(60000), reapparition: 0 });
    const b = await clic('sao:ch:u1');
    V('Rechasser met le MÊME message à jour', b.mises.length === 1 && b.reponses.length === 0);
    const p1 = joueur();
    V('les compteurs avancent (monstres ou morts)', (p1.monstres || 0) + (p1.morts || 0) === 2);
    setGuildConfig('G1', 'sao_chasse_delai', 120);
    majJoueur('u1', { last_hunt: ilYa(60000) });
    const lent = await commande('chasser');
    V('le délai suit le réglage du serveur (120 s)', eph(lent.reponses[0]) && /1 min/.test(lent.reponses[0].content), lent.reponses[0]?.content);
    setGuildConfig('G1', 'sao_chasse_delai', 15);

    majJoueur('u1', { last_afk: ilYa(2 * 3600 * 1000), last_hunt: ilYa(60000), reapparition: 0 });
    const xpAvant = getLevels('G1', 'u1').xp;
    const afk = await commande('afk');
    V('AFK après 2 h sans jouer : récolte', /Gains AFK/.test(txt(sortie(afk))) && /2 h/.test(txt(sortie(afk))));
    V('AFK : aucune XP serveur (elle gonflait les niveaux)', getLevels('G1', 'u1').xp === xpAvant);
    majJoueur('u1', { last_afk: ilYa(2 * 3600 * 1000), last_hunt: ilYa(60000) });
    await commande('chasser');
    const apres = await commande('afk');
    V('jouer remet le compteur AFK à zéro', eph(apres.reponses[0]) && /au moins \*\*10 min\*\*/.test(apres.reponses[0].content), apres.reponses[0]?.content);
    majJoueur('u1', { last_afk: ilYa(30 * 3600 * 1000) });
    const plafond = G.recolterAfk('G1', 'u1');
    V('AFK plafonné (8 h par défaut)', plafond.minutes === 480);
    setGuildConfig('G1', 'sao_afk', 0);
    const coupe = await commande('afk');
    V('AFK coupé par le serveur', /coupé/.test(coupe.reponses[0].content));
    setGuildConfig('G1', 'sao_afk', 1);
  }

  console.log('\n5) Combat de boss persistant');
  let idCombat;
  {
    majJoueur('u1', { reapparition: 0, hp: 500 });
    const it = await commande('boss');
    const p = sortie(it);
    const c = G.combatActif('G1', 'u1');
    idCombat = c?.id;
    V('boss : le combat vit EN BASE', c && c.statut === 'en_cours' && c.etat.boss.nom === 'Illfang the Kobold Lord');
    V('boutons : id du combat ET numéro du tour', ids(p).includes(`sao:cb:atk:${c.id}:0`) && ids(p).includes(`sao:cb:gar:${c.id}:0`) && ids(p).includes(`sao:cb:fuir:${c.id}:0`));
    V('Sword Skill du niveau proposé (Slant)', ids(p).includes(`sao:cb:sk:${c.id}:0:slant`));
    V('menu d\'objets de combat', ids(p).includes(`sao:cb:obj:${c.id}:0`));

    redemarrer();
    const t1 = await clic(`sao:cb:atk:${c.id}:0`);
    V('après un REDÉMARRAGE, le bouton joue toujours le combat', G.combatParId(c.id).etat.tour === 1 && t1.mises.length === 1, txt(t1.reponses[0]));
    V('les PV du joueur sont enregistrés à chaque tour', joueur().hp === Math.max(1, G.combatParId(c.id).etat.jPv));
    const vieux = await clic(`sao:cb:atk:${c.id}:0`);
    V('un ancien message ne joue rien : il se resynchronise', G.combatParId(c.id).etat.tour === 1 && /plus à jour/.test(txt(vieux.mises[0])) && ids(vieux.mises[0]).includes(`sao:cb:atk:${c.id}:1`));
    const re = await commande('boss');
    V('relancer /sao boss REPREND le même combat (aucun écrasement)', G.combatActif('G1', 'u1').id === c.id && /repris/.test(txt(sortie(re))));
    const intrus = await clic(`sao:cb:atk:${c.id}:1`, { user: 'u2' });
    V('le combat d\'un autre est refusé', eph(intrus.reponses[0]) && /celui de/.test(intrus.reponses[0].content));

    majCombat(c.id, (e) => { e.tour = 1; e.charge = false; e.etourdi = 0; e.jPv = e.jMax; });
    await clic(`sao:cb:sk:${c.id}:1:slant`);
    const e2 = G.combatParId(c.id).etat;
    V('Slant lancé : délai post-motion posé', e2.tour === 2 && e2.recharges.slant >= 1, JSON.stringify(e2.recharges));
    const sk2 = await clic(`sao:cb:sk:${c.id}:2:slant`);
    V('Slant refusé au tour suivant (recharge)', eph(sk2.reponses[0]) && /recharge/.test(sk2.reponses[0].content) && G.combatParId(c.id).etat.tour === 2);
    majCombat(c.id, (e) => { e.jPv = 10; e.charge = false; });
    const potions = G.quantiteSao('G1', 'u1', 'potion_soin');
    const ob = fausse({ type: 'menu', customId: `sao:cb:obj:${c.id}:2`, valeurs: ['potion_soin'] });
    await IC.execute(ob);
    V('potion en combat : PV rendus, potion consommée', G.quantiteSao('G1', 'u1', 'potion_soin') === potions - 1 && /Potion de soin/.test(txt(ob.mises[0])));
  }
  {
    // Défaite : la pénalité ne se contourne plus.
    majJoueur('u1', { col: 1000, xp: 100 });
    const e = majCombat(idCombat, (x) => { x.jPv = 1; x.charge = false; x.etourdi = 0; x.tour = 3; x.poison = 0; });
    const morts = joueur().morts;
    const fin = await clic(`sao:cb:atk:${idCombat}:${e.tour}`);
    const p = joueur();
    V('défaite : combat clos en base (perdu)', G.combatParId(idCombat).statut === 'perdu', G.combatParId(idCombat).statut);
    V('défaite : 10 % des Col et 20 % de l\'XP du niveau', p.col === 900 && p.xp === 80, `${p.col} Col, ${p.xp} XP`);
    V('défaite : retour à 25 % des PV, jamais un soin complet', p.hp === Math.max(1, Math.round(G.statsJoueur(p).pvMax * 0.25)));
    V('défaite : Monument of Life (+1 mort, réapparition)', p.morts === morts + 1 && p.reapparition > Date.now());
    V('carte de défaite : conseils pour la revanche', /Monument of Life/.test(txt(fin.mises[0])) && /Lisbeth/.test(txt(fin.mises[0])));
    const chasse = await commande('chasser');
    V('pendant la réapparition, pas de chasse', /Monument of Life/.test(chasse.reponses[0].content));
    const mort = await clic(`sao:cb:atk:${idCombat}:${e.tour + 1}`);
    V('un bouton d\'un combat terminé : boutons retirés, explication en privé', mort.mises[0]?.components?.length === 0 && /perdu/.test(mort.suivis[0]?.content || ''), JSON.stringify(mort.suivis));

    // Mort à 0 Col : toujours plus cher que l'auberge.
    majJoueur('u1', { col: 0, reapparition: 0, hp: 1 });
    const pauvre = G.appliquerMort(G.chargerJoueur('G1', 'u1'), G.reglagesSao('G1'), Date.now());
    V('avec 0 Col, mourir n\'est pas un soin gratuit (PV < max, XP perdue, attente)', pauvre.reapparition > Date.now() && !pauvre.pierre);

    // Abandon : 30 min sans clic = fuite sans cristal.
    majJoueur('u1', { col: 1000, reapparition: 0, hp: 300 });
    const c2 = G.commencerBoss('G1', 'u1').combat;
    db.prepare('UPDATE sao_combats SET maj_le = ? WHERE id = ?').run(Date.now() - 31 * 60 * 1000, c2.id);
    const ab = await commande('boss');
    V('combat abandonné 30 min : compté comme une fuite (−5 % des Col)', G.combatParId(c2.id).statut === 'abandon' && joueur().col === 950 && /abandonné/.test(txt(sortie(ab))), `${joueur().col}`);
    const c3 = G.combatActif('G1', 'u1');
    V('… et un nouveau combat s\'ouvre', c3 && c3.id !== c2.id);

    // Fuite avec et sans cristal.
    G.donnerObjet('G1', 'u1', 'cristal_tp', 1);
    const fuite = await clic(`sao:cb:fuir:${c3.id}:0`);
    V('fuite au cristal : sans pénalité, cristal consommé', joueur().col === 950 && G.quantiteSao('G1', 'u1', 'cristal_tp') === 0 && /Téléportation/.test(txt(fuite.mises[0])));
    const c4 = G.commencerBoss('G1', 'u1').combat;
    await clic(`sao:cb:fuir:${c4.id}:0`);
    V('fuite à pied : la moitié de la pénalité de mort (5 %)', joueur().col === 903, String(joueur().col));

    // Victoire : étage suivant et Last Attack Bonus.
    const c5 = G.commencerBoss('G1', 'u1').combat;
    majCombat(c5.id, (x) => { x.bPv = 1; });
    const xpServeur = getLevels('G1', 'u1').xp;
    const v = await clic(`sao:cb:atk:${c5.id}:0`);
    const p2 = joueur();
    V('victoire : étage 2, boss compté', p2.floor === 2 && p2.boss_vaincus === 1 && G.combatParId(c5.id).statut === 'gagne');
    V('Last Attack Bonus : Coat of Midnight (canon, étage 1)', G.quantiteSao('G1', 'u1', 'coat_of_midnight') === 1 && /Last Attack Bonus/.test(txt(v.mises[0])));
    const gagne = getLevels('G1', 'u1').xp - xpServeur;
    // 25 + 2 × étage, plus 5 par quête du jour accomplie au passage.
    V('victoire : XP serveur (25 + 2 × étage, quêtes comprises) affichée et créditée', gagne >= 27 && (gagne - 27) % 5 === 0 && txt(v.mises[0]).includes(`+${gagne} XP serveur`), String(gagne));
    V('victoire : badges Tombeur de Boss et Last Attack', G.ownedBadges('G1', 'u1').includes('boss_slayer') && G.ownedBadges('G1', 'u1').includes('lab'));
    V('le boss de l\'étage 2 suit le canon (Baran the General Taurus)', D.bossDe(2).nom === 'Baran the General Taurus' && D.bossDe(3).nom === 'Nerius the Evil Treant' && D.bossDe(5).nom === 'Fuscus the Vacant Colossus' && D.bossDe(75).nom === 'The Skull Reaper' && D.bossDe(25).nom !== 'The Skull Reaper');

    // Divine Stone of Returning Soul : la mort est annulée, le combat continue.
    G.donnerObjet('G1', 'u1', 'pierre_ame', 1);
    const c6 = G.commencerBoss('G1', 'u1').combat;
    majCombat(c6.id, (x) => { x.jPv = 1; x.tour = 0; });
    const mortsAvant = joueur().morts;
    await clic(`sao:cb:atk:${c6.id}:0`);
    const e6 = G.combatParId(c6.id);
    V('Divine Stone : la mort est annulée et le combat continue, PV pleins', e6.statut === 'en_cours' && e6.etat.jPv === e6.etat.jMax && joueur().morts === mortsAvant && G.quantiteSao('G1', 'u1', 'pierre_ame') === 0);
    db.prepare("UPDATE sao_combats SET statut = 'fui' WHERE id = ?").run(c6.id);
  }
  {
    // Compétence unique : le PREMIER à vaincre l'étage 74.
    majJoueur('u1', { floor: 74, position: 74, level: 80, reapparition: 0, hp: 5000 });
    const c = G.commencerBoss('G1', 'u1').combat;
    V('étage 74 : salle anti-cristal', c.etat.antiCristal === true);
    G.donnerObjet('G1', 'u1', 'cristal_soin', 1);
    const cristal = fausse({ type: 'menu', customId: `sao:cb:obj:${c.id}:0`, valeurs: ['cristal_soin'] });
    majCombat(c.id, (x) => { x.jPv = 10; });
    await IC.execute(cristal);
    V('salle anti-cristal : le cristal de soin ne marche pas', eph(cristal.reponses[0]) && /anti-cristal/.test(cristal.reponses[0].content));
    majCombat(c.id, (x) => { x.bPv = 1; });
    const v = await clic(`sao:cb:atk:${c.id}:0`);
    V('Dual Blades au premier vainqueur de The Gleam Eyes', G.detenteurUnique('G1', 'dual_blades')?.user_id === 'u1' && /Dual Blades/.test(txt(v.mises[0])));
    V('… avec Starburst Stream dans ses Sword Skills', G.statsJoueur(G.chargerJoueur('G1', 'u1')).skills.includes('starburst_stream'));
    V('… et le titre Black Swordsman', G.ownedBadges('G1', 'u1').includes('epeiste_noir'));
    await commande('start', { user: 'u3' });
    majJoueur('u3', { floor: 74, position: 74, level: 80, hp: 5000 });
    const c3 = G.commencerBoss('G1', 'u3').combat;
    majCombat(c3.id, (x) => { x.bPv = 1; });
    await clic(`sao:cb:atk:${c3.id}:0`, { user: 'u3' });
    V('un seul détenteur par serveur', G.detenteurUnique('G1', 'dual_blades').user_id === 'u1' && !G.uniquesDe('G1', 'u3').length);
    const prof = await commande('profil');
    V('profil : la compétence unique est affichée', /Dual Blades/.test(txt(sortie(prof))));
    majJoueur('u1', { floor: 2, position: 2, level: 6, hp: 200 });
  }

  console.log('\n6) Contrat A : crediterCol, donnerObjet, OBJETS, objetsRecompensables');
  {
    V('crediterCol crée le personnage et rend le solde', G.crediterCol('G1', 'nouveau', 50) === 150 && Boolean(joueur('nouveau')));
    V('crediterCol ne descend jamais sous zéro', G.crediterCol('G1', 'nouveau', -1000) === 0);
    V('donnerObjet : clé connue → true, objet au sac', G.donnerObjet('G1', 'nouveau2', 'cristal_soin', 2) === true && G.quantiteSao('G1', 'nouveau2', 'cristal_soin') === 3);
    V('donnerObjet : clé inconnue → false', G.donnerObjet('G1', 'nouveau2', 'epee_de_lune') === false);
    V('donnerObjet : quantité invalide → false', G.donnerObjet('G1', 'nouveau2', 'cristal_soin', 0) === false);
    const tous = Object.entries(G.OBJETS);
    V('OBJETS : nom, emoji, rareté, type et description partout', tous.every(([, o]) => o.nom && o.emoji && D.RARETES[o.rarete] && o.type && o.desc));
    V('raretés : Commun, Rare, Épique, Légendaire, LAB', ['commun', 'rare', 'epique', 'legendaire', 'lab'].every((r) => tous.some(([, o]) => o.rarete === r)));
    const rec = G.objetsRecompensables();
    V('objetsRecompensables : 25 au plus, clés valides, { cle, nom, emoji }', rec.length <= 25 && rec.length > 5 && rec.every((r) => G.OBJETS[r.cle] && r.nom && r.emoji));
    V('saoGame ne charge ni discord.js ni levels (pas de require circulaire)', !/require\('discord\.js'\)|require\('\.\/levels'\)/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'saoGame.js'), 'utf8')));
  }

  console.log('\n7) Inventaire, Agil, Lisbeth, objets');
  {
    majJoueur('u1', { col: 5000, reapparition: 0 });
    const inv = await commande('inventaire');
    V('inventaire : rangé par type, rareté affichée', /Consommables/.test(txt(sortie(inv))) && /Rare|Commun/.test(txt(sortie(inv))));
    const prix = G.prixAchat('cristal_soin', joueur().floor);
    const achat = await commande('boutique', { options: { acheter: 'cristal_soin', quantite: 2 } });
    V('boutique : achat de 2 cristaux au prix de l\'étage', joueur().col === 5000 - 2 * prix && /Acheté/.test(txt(sortie(achat))), String(joueur().col));
    const avantCristaux = G.quantiteSao('G1', 'u1', 'cristal_soin');
    const menu = fausse({ type: 'menu', customId: 'sao:ag:a:u1', valeurs: ['cristal_soin'] });
    await IC.execute(menu);
    V('menu d\'achat d\'Agil : +1, même message mis à jour', G.quantiteSao('G1', 'u1', 'cristal_soin') === avantCristaux + 1 && menu.mises.length === 1);
    G.donnerObjet('G1', 'u1', 'defense_sanglier', 4);
    G.donnerObjet('G1', 'u1', 'hache_kobold', 1);
    const colAvant = joueur().col;
    const tout = await clic('sao:ag:tout:u1');
    V('vendre tout le butin', G.quantiteSao('G1', 'u1', 'defense_sanglier') === 0 && joueur().col > colAvant && /Tout le butin/.test(txt(tout.mises[0])));
    G.donnerObjet('G1', 'u1', 'croc_loup', 3);
    const vente = fausse({ type: 'menu', customId: 'sao:ag:v:u1', valeurs: ['croc_loup'] });
    const crocs = G.quantiteSao('G1', 'u1', 'croc_loup');
    await IC.execute(vente);
    V('vendre un lot entier depuis le menu', G.quantiteSao('G1', 'u1', 'croc_loup') === 0 && crocs > 0);
    const intrus = fausse({ type: 'menu', customId: 'sao:ag:a:u1', valeurs: ['cristal_soin'], user: 'u2' });
    await IC.execute(intrus);
    V('la boutique d\'un autre est refusée', eph(intrus.reponses[0]));

    // Forge
    G.donnerObjet('G1', 'u1', 'croc_loup', 20);
    const forge = await commande('forge');
    V('forge : épée, rapière et armure du palier suivant', ids(sortie(forge)).includes('sao:fo:anneal_blade:u1') && ids(sortie(forge)).includes('sao:fo:wind_fleuret:u1') && ids(sortie(forge)).includes('sao:fo:veste_cuir:u1'));
    const f1 = await clic('sao:fo:anneal_blade:u1');
    V('Lisbeth forge l\'Anneal Blade et l\'équipe', joueur().arme === 'anneal_blade' && /Anneal Blade/.test(txt(f1.mises[0])));
    V('l\'épée de départ ne traîne pas dans le sac', G.quantiteSao('G1', 'u1', 'epee_courte') === 0);
    const verrou = G.forgerSao('G1', 'u1', 'sword_of_eventide');
    V('un palier au-dessus de l\'étage est verrouillé', verrou.refus === 'verrou' && verrou.etage === 8);
    const ok1 = G.ameliorerSao('G1', 'u1', { rng: () => 0 });
    V('amélioration réussie : +1', ok1.reussi && G.plusArme('G1', 'u1', 'anneal_blade') === 1);
    const mats = G.quantiteSao('G1', 'u1', 'croc_loup');
    const rate = G.ameliorerSao('G1', 'u1', { rng: () => 0.999 });
    V('amélioration ratée : métal perdu, +1 conservé', !rate.reussi && G.plusArme('G1', 'u1', 'anneal_blade') === 1 && G.quantiteSao('G1', 'u1', 'croc_loup') < mats);
    const atkAvant = G.statsJoueur(joueur()).atk;
    G.ameliorerSao('G1', 'u1', { rng: () => 0 });
    V('l\'amélioration augmente l\'ATK', G.statsJoueur(joueur()).atk > atkAvant);
    V('taux de réussite décroissant (+0 : 95 %, +9 : 32 %)', F.tauxAmelioration(0) === 95 && F.tauxAmelioration(9) === 32);

    // Utiliser
    const eq = await commande('utiliser', { options: { objet: 'coat_of_midnight' } });
    V('équiper le LAB Coat of Midnight', joueur().armure === 'coat_of_midnight' && /équipée/.test(txt(sortie(eq))));
    G.donnerObjet('G1', 'u1', 'coffre_tresor', 1);
    const colCoffre = joueur().col;
    const co = await commande('utiliser', { options: { objet: 'coffre_tresor' } });
    V('ouvrir un coffre au trésor', joueur().col > colCoffre && /Coffre au trésor ouvert/.test(txt(sortie(co))));
    G.donnerObjet('G1', 'u1', 'brochette', 1);
    await commande('utiliser', { options: { objet: 'brochette' } });
    V('manger un repas : bonus actif pour 6 chasses', joueur().repas === 'brochette' && joueur().repas_reste === 6);
    const atkRepas = G.statsJoueur(G.chargerJoueur('G1', 'u1')).atk;
    majJoueur('u1', { repas: null, repas_reste: 0 });
    V('… le repas donne +10 % d\'ATK', atkRepas > G.statsJoueur(G.chargerJoueur('G1', 'u1')).atk);
    const tp = await commande('utiliser', { options: { objet: 'cristal_soin' } });
    V('un cristal de soin hors combat soigne (ou dit que les PV sont pleins)', /Cristal de soin|maximum/.test(txt(sortie(tp))));
    G.donnerObjet('G1', 'u1', 'croc_loup', 1);
    const mat = await commande('utiliser', { options: { objet: 'croc_loup' } });
    V('un matériau ne s\'utilise pas : la commande dit à quoi il sert', eph(mat.reponses[0]) && /Lisbeth/.test(mat.reponses[0].content));
    const auto = fausse({ type: 'auto', sub: 'utiliser', focus: 'objet', options: { objet: '' } });
    await SAO.autocomplete(auto);
    V('autocomplétion de /sao utiliser : seulement l\'utilisable (≤ 25)', auto.choix.length > 0 && auto.choix.length <= 25 && !auto.choix.some((c) => D.OBJETS[c.value].type === 'materiau'));
  }

  console.log('\n8) Argo : rumeur du jour et renseignement');
  {
    const r1 = G.rumeurDuJour('G1', Date.parse('2026-10-19T10:00:00Z'));
    const r2 = G.rumeurDuJour('G1', Date.parse('2026-10-19T20:00:00Z'));
    V('une rumeur par jour et par serveur (stable dans la journée)', r1.cle === r2.cle && r1.etage === r2.etage && D.RUMEURS[r1.cle]);
    majJoueur('u1', { col: 5000, argo_etage: null });
    const it = await commande('argo');
    V('Argo propose le dossier du boss contre des Col', ids(sortie(it)).includes('sao:ar:u1') && /Rumeur du jour/.test(txt(sortie(it))));
    const achat = await clic('sao:ar:u1');
    V('dossier acheté : stats révélées, −15 % ATK', joueur().argo_etage === 2 && /−15 %/.test(txt(achat.mises[0])));
    const c = G.commencerBoss('G1', 'u1').combat;
    V('le combat suivant profite du renseignement', c.etat.argo === true);
    db.prepare("UPDATE sao_combats SET statut = 'fui' WHERE id = ?").run(c.id);
  }

  console.log('\n9) Quotidienne (série) et quêtes du jour');
  {
    const j1 = Date.parse('2026-10-20T08:00:00Z');
    await commande('start', { user: 'u4' });
    const a = G.reclamerQuotidien('G1', 'u4', { now: j1 });
    V('quotidienne : Col, XP et objets, série 1', a.serie === 1 && a.col > 0 && a.objets.length >= 2 && a.xpServeur === 10);
    V('une seule fois par jour', G.reclamerQuotidien('G1', 'u4', { now: j1 + 3600000 }).refus === 'deja');
    const b = G.reclamerQuotidien('G1', 'u4', { now: j1 + 86400000 });
    V('le lendemain : série 2, gain plus gros', b.serie === 2 && b.col > a.col);
    const c = G.reclamerQuotidien('G1', 'u4', { now: j1 + 3 * 86400000 });
    V('un jour sauté : la série repart à 1', c.serie === 1);
    let r;
    for (let d = 4; d <= 9; d++) r = G.reclamerQuotidien('G1', 'u4', { now: j1 + d * 86400000 });
    V('7 jours de suite : coffre au trésor et badge Fidèle', r.serie === 7 && r.objets.some((o) => o.cle === 'coffre_tresor') && G.ownedBadges('G1', 'u4').includes('fidele'));

    const q = G.quetesDuJour('G1', 'u4', j1);
    V('trois quêtes distinctes', q.length === 3 && new Set(q.map((x) => x.cle)).size === 3);
    V('les mêmes toute la journée', JSON.stringify(G.quetesDuJour('G1', 'u4', j1 + 3600000).map((x) => x.cle)) === JSON.stringify(q.map((x) => x.cle)));
    V('pas de quête de pêche avant l\'étage 22, ni de raid sans salon', !q.some((x) => x.cle === 'pecher' || x.cle === 'raid'));
    const p = G.chargerJoueur('G1', 'u4');
    const colAvant = p.col;
    const finies = [];
    for (const x of q) finies.push(...G.avancerQuete(p, x.cle, x.objectif, j1));
    V('quêtes accomplies : récompenses, et un coffre pour les trois', finies.length === 3 && finies[2].coffre && p.col > colAvant && finies.every((f) => f.xpServeur >= 5));
    const quetes = await commande('quetes', { user: 'u2' });
    V('/sao quetes : progression en barres', /0\//.test(txt(sortie(quetes))) && /◆/.test(txt(sortie(quetes))));
    const cd = await commande('cd');
    V('/sao cd : tous les délais, en privé', eph(sortie(cd)) && /Chasse/.test(txt(sortie(cd))) && /Quotidienne/.test(txt(sortie(cd))) && /AFK/.test(txt(sortie(cd))) && /Pêche/.test(txt(sortie(cd))));
    const quot = await commande('quotidien', { user: 'u2' });
    V('/sao quotidien : carte et XP serveur', /Récompense du jour/.test(txt(sortie(quot))) && /\+10 XP serveur/.test(txt(sortie(quot))));
    const deux = await commande('quotidien', { user: 'u2' });
    V('/sao quotidien une 2ᵉ fois : refus avec l\'heure de la prochaine', eph(deux.reponses[0]) && /Déjà réclamée/.test(deux.reponses[0].content));
  }

  console.log('\n10) Monde : voyage, pêche, cuisine');
  {
    const loin = await commande('voyager', { options: { etage: 50 } });
    V('voyager vers un étage verrouillé : refusé', eph(loin.reponses[0]) && /verrouillé/.test(loin.reponses[0].content));
    const bas = await commande('voyager', { options: { etage: 1 } });
    V('voyager vers l\'étage 1 : ville canon', joueur().position === 1 && /Town of Beginnings/.test(txt(sortie(bas))));
    const pecheRefus = await commande('pecher');
    V('pas de pêche avant l\'étage 22', /22/.test(pecheRefus.reponses[0].content));
    majJoueur('u1', { floor: 30, position: 22, peche_le: 0, reapparition: 0 });
    const lance = await commande('pecher');
    const pj = joueur();
    V('pêche lancée : morsure à venir (horodatage relatif) et bouton Ferrer', /<t:\d+:R>/.test(txt(sortie(lance))) && ids(sortie(lance)).includes(`sao:pe:u1:${pj.peche_jeton}`));
    const tot = G.ferrerSao('G1', 'u1', pj.peche_jeton, { now: pj.peche_morsure - 800 });
    V('ferrer trop tôt : le poisson file', tot.resultat === 'trop_tot');
    majJoueur('u1', { peche_le: 0 });
    const r = G.lancerPeche('G1', 'u1', { now: Date.now() });
    const prise = G.ferrerSao('G1', 'u1', r.jeton, { now: r.morsure + 400, rng: () => 0 });
    V('ferrer à temps : une prise au sac', prise.resultat === 'prise' && G.quantiteSao('G1', 'u1', prise.objet) >= 1);
    V('un vieux jeton ne ferre plus rien', G.ferrerSao('G1', 'u1', r.jeton, { now: r.morsure + 500 }).refus === 'perime');
    majJoueur('u1', { peche_le: 0 });
    const r2 = G.lancerPeche('G1', 'u1', { now: Date.now() });
    V('ferrer trop tard (3 s) : rien', G.ferrerSao('G1', 'u1', r2.jeton, { now: r2.morsure + 3500 }).resultat === 'trop_tard');
    majJoueur('u1', { peche_le: 0 });
    const r3 = G.lancerPeche('G1', 'u1', { now: Date.now() });
    const vif = G.ferrerSao('G1', 'u1', r3.jeton, { now: r3.morsure + 300, rng: () => 0.999 });
    V('très vif : les prises rares deviennent possibles', ['coffre_tresor', 'seigneur_lac', 'poisson_dore'].includes(vif.objet), vif.objet);

    const recettes = await commande('cuisiner');
    V('/sao cuisiner sans recette : le livre de cuisine', /cuisine d'Asuna/.test(txt(sortie(recettes))));
    const rate = G.cuisinerSao('G1', 'u1', 'ragout_asuna');
    V('cuisiner sans ingrédient : refus détaillé', rate.refus === 'manque' && rate.manques[0].cle === 'ragout_rabbit');
    G.donnerObjet('G1', 'u1', 'ragout_rabbit', 1);
    const cuit = await commande('cuisiner', { options: { recette: 'ragout_asuna' } });
    V('le ragoût d\'Asuna : plat au sac, badge Cordon-bleu', G.quantiteSao('G1', 'u1', 'ragout_asuna') === 1 && G.ownedBadges('G1', 'u1').includes('cuisinier') && /préparé/.test(txt(sortie(cuit))));
    majJoueur('u1', { floor: 2, position: 2 });
  }

  console.log('\n11) Raid partagé du serveur');
  let raidId;
  {
    V('pas de salon : pas de raid', !RAID.raidDu('G1'));
    setGuildConfig('G1', 'sao_salon_id', 'RAID');
    setGuildConfig('G1', 'sao_raid_heures', 6);
    const bilan = await RAID.tourDeRaids(client, Date.now());
    const raid = RAID.raidActif('G1');
    raidId = raid?.id;
    V('le raid apparaît dans le salon réglé', bilan.crees.length === 1 && raid && SALONS.RAID.envois.length === 1);
    const msg = SALONS.RAID.envois[0];
    V('annonce sans aucune mention', JSON.stringify(msg.allowedMentions) === JSON.stringify({ parse: [] }));
    V('bouton Frapper porteur de l\'id du raid', ids(msg).includes(`sao:rd:${raid.id}`) && raid.message_id === msg.id);
    V('PV partagés, proportionnés aux aventuriers', raid.pv_max > 0 && raid.pv === raid.pv_max);
    const encore = await RAID.tourDeRaids(client, Date.now());
    V('un seul raid à la fois', encore.crees.length === 0);

    const coup = await clic(`sao:rd:${raid.id}`);
    const apres = RAID.raidParId(raid.id);
    V('frapper : PV du boss réduits, carte mise à jour', apres.pv < raid.pv && coup.mises.length === 1 && /vient d'infliger/.test(txt(coup.mises[0])));
    const vite = await clic(`sao:rd:${raid.id}`);
    V('délai personnel entre deux coups', eph(vite.reponses[0]) && /prochain coup/.test(vite.reponses[0].content));
    const neuf = await clic(`sao:rd:${raid.id}`, { user: 'u4' });
    V('un autre aventurier frappe aussi', RAID.coupsRaid(raid.id).length === 2 && neuf.mises.length === 1);
    redemarrer();
    V('le raid survit au redémarrage (en base)', RAID.raidActif('G1')?.id === raid.id && RAID.coupsRaid(raid.id).length === 2);

    db.prepare('UPDATE sao_raids SET pv = 1 WHERE id = ?').run(raid.id);
    db.prepare('UPDATE sao_raid_coups SET dernier_le = 0 WHERE raid_id = ?').run(raid.id);
    const colU4 = joueur('u4').col;
    const fin = await clic(`sao:rd:${raid.id}`, { user: 'u4' });
    const vaincu = RAID.raidParId(raid.id);
    V('le dernier coup abat le boss', vaincu.statut === 'vaincu' && vaincu.dernier_coup === 'u4');
    V('Last Attack Bonus au dernier coup', G.quantiteSao('G1', 'u4', D.RAIDS[vaincu.boss].lab) >= 1);
    V('récompenses au prorata des dégâts, pour tous les participants', joueur('u4').col > colU4 && G.ownedBadges('G1', 'u1').includes('raider') && G.ownedBadges('G1', 'u4').includes('raider'));
    V('carte finale : récompenses, plus de bouton', /est tombé/.test(txt(fin.mises[0])) && !(fin.mises[0].components || []).length);
    const tard = await clic(`sao:rd:${raid.id}`);
    V('un raid terminé ne se frappe plus', /terminé/.test(tard.suivis[0]?.content || tard.reponses[0]?.content || ''));
    V('pas de nouveau raid avant la fréquence réglée', !RAID.raidDu('G1', Date.now()));
    V('… mais un nouveau après 6 h', RAID.raidDu('G1', Date.now() + 6 * 3600000 + 1000));
    V('Nicholas the Renegade sort en décembre', RAID.choisirBossRaid(Date.parse('2026-12-24T12:00:00Z')) === 'nicholas' && RAID.choisirBossRaid(Date.parse('2026-06-01T12:00:00Z'), () => 0) !== 'nicholas');

    const r2 = RAID.creerRaid('G1', { now: Date.now() - 10 * 3600000 });
    db.prepare('UPDATE sao_raids SET message_id = ?, salon_id = ? WHERE id = ?').run(SALONS.RAID.envois[0].id, 'RAID', r2.id);
    RAID.frapperRaid(r2.id, 'u2', { now: Date.now() - 9 * 3600000 });
    const bilan2 = await RAID.tourDeRaids(client, Date.now());
    V('un raid expiré est clos et sa carte réécrite', bilan2.expires.includes(r2.id) && RAID.raidParId(r2.id).statut === 'expire' && SALONS.RAID.envois[0].editions.length >= 1);
    const q = G.quetesDuJour('G1', 'u3', Date.parse('2026-11-02T10:00:00Z'));
    V('salon réglé : la quête « raid » devient possible', Object.keys(D.QUETES).includes('raid') && q.length === 3);
  }

  console.log('\n12) Duel First Strike');
  {
    const soi = await commande('duel', { options: { membre: 'u1' } });
    V('pas de duel contre soi-même', eph(soi.reponses[0]));
    const bot = await commande('duel', { options: { membre: 'robot' } });
    V('pas de duel contre un bot', eph(bot.reponses[0]));
    const colA = joueur('u1').col;
    const colB = joueur('u2').col;
    const it = await commande('duel', { options: { membre: 'u2' } });
    const p = sortie(it);
    const d = db.prepare("SELECT * FROM sao_duels WHERE statut = 'attente' ORDER BY id DESC").get();
    V('le défi mentionne l\'adversaire, et lui seul', p.content === '<@u2>' && JSON.stringify(p.allowedMentions) === JSON.stringify({ users: ['u2'] }));
    V('boutons Accepter / Refuser porteurs de l\'id du duel', ids(p).includes(`sao:du:ok:${d.id}`) && ids(p).includes(`sao:du:no:${d.id}`));
    const deja = await commande('duel', { options: { membre: 'u2' } });
    V('un seul défi en attente entre deux joueurs', eph(deja.reponses[0]));
    const lui = await clic(`sao:du:ok:${d.id}`, { user: 'u1' });
    V('le défieur ne peut pas accepter à la place de l\'autre', eph(lui.reponses[0]));
    const acc = await clic(`sao:du:ok:${d.id}`, { user: 'u2' });
    const fini = G.duelParId(d.id);
    V('duel joué : un vainqueur, un journal', fini.statut === 'fini' && ['u1', 'u2'].includes(fini.vainqueur) && /victoire de/.test(txt(acc.mises[0])));
    V('aucun Col perdu', joueur('u1').col === colA && joueur('u2').col === colB);
    V('victoires et défaites comptées', joueur(fini.vainqueur).pvp_victoires === 1);
    const d2 = G.proposerDuel('G1', 'u1', 'u3');
    db.prepare('UPDATE sao_duels SET cree_le = ? WHERE id = ?').run(Date.now() - 10 * 60000, d2.id);
    const exp = await clic(`sao:du:ok:${d2.id}`, { user: 'u3' });
    V('un défi expiré se clôt tout seul', G.duelParId(d2.id).statut === 'expire' && /expiré/.test(txt(exp.mises[0])));
    const d3 = G.proposerDuel('G1', 'u1', 'u3');
    await clic(`sao:du:no:${d3.id}`, { user: 'u3' });
    V('refuser un défi', G.duelParId(d3.id).statut === 'refuse');
    setGuildConfig('G1', 'sao_pvp', 0);
    const coupe = await commande('duel', { options: { membre: 'u3' } });
    V('duels coupés par le serveur', eph(coupe.reponses[0]) && /coupés/.test(coupe.reponses[0].content));
    setGuildConfig('G1', 'sao_pvp', 1);
  }

  console.log('\n13) Couple : Lien du cœur et coffre commun');
  {
    const seul = await commande('coffre', { groupe: 'coffre', sub: 'voir', user: 'u2' });
    V('pas marié : pas de coffre', eph(seul.reponses[0]) && /mariés/.test(seul.reponses[0].content));
    const [a, b] = ['u2', 'nouveau3'].sort();
    db.prepare('INSERT INTO mariages (a, b, depuis, guild_id) VALUES (?, ?, ?, ?)').run(a, b, new Date().toISOString(), 'G1');
    const attente = await commande('coffre', { groupe: 'coffre', sub: 'voir', user: 'u2' });
    V('conjoint sans personnage ici : coffre fermé, et dit pourquoi', /pas encore de personnage/.test(attente.reponses[0].content));
    db.prepare('DELETE FROM mariages').run();
    const [x, y] = ['u2', 'u3'].sort();
    db.prepare('INSERT INTO mariages (a, b, depuis, guild_id) VALUES (?, ?, ?, ?)').run(x, y, new Date().toISOString(), 'G1');
    const sans = G.statsJoueur(G.chargerJoueur('G1', 'u2')).atk;
    const avec = G.statsJoueur(G.chargerJoueur('G1', 'u2'), { lien: true }).atk;
    V('Lien du cœur : +10 % ATK', avec > sans && require('../src/utils/sao/liens').lienDuCoeur('G1', 'u2'));
    const prof = await commande('profil', { user: 'u2' });
    V('profil : conjoint et Lien du cœur actif', /Lien du cœur/.test(txt(sortie(prof))) && /actif/.test(txt(sortie(prof))) && /<@u3>/.test(txt(sortie(prof))));
    majJoueur('u2', { col: 500 });
    majJoueur('u3', { col: 100 });
    G.donnerObjet('G1', 'u2', 'cristal_soin', 2);
    const dep = await commande('coffre', { groupe: 'coffre', sub: 'deposer', user: 'u2', options: { col: 200, objet: 'cristal_soin', quantite: 2 } });
    const cle = G.cleCouple('u2', 'u3');
    V('déposer Col et objets', joueur('u2').col === 300 && G.coffreSao('G1', cle).col === 200 && G.coffreSao('G1', cle).objets.find((o) => o.objet === 'cristal_soin')?.qte === 2 && /déposes/.test(txt(sortie(dep))));
    const ret = await commande('coffre', { groupe: 'coffre', sub: 'retirer', user: 'u3', options: { col: 50, objet: 'cristal_soin', quantite: 1 } });
    V('le conjoint retire du même coffre', joueur('u3').col === 150 && G.coffreSao('G1', cle).col === 150 && /retires/.test(txt(sortie(ret))));
    const trop = await commande('coffre', { groupe: 'coffre', sub: 'retirer', user: 'u3', options: { col: 999 } });
    V('on ne retire pas ce qui n\'y est pas', eph(trop.reponses[0]));
    const auto = fausse({ type: 'auto', groupe: 'coffre', sub: 'retirer', focus: 'objet', user: 'u3', options: { objet: '' } });
    await SAO.autocomplete(auto);
    V('autocomplétion du retrait : le contenu du coffre', auto.choix.some((c) => c.value === 'cristal_soin'));
    db.prepare('DELETE FROM mariages').run();
    const colU2 = joueur('u2').col;
    const div = await commande('coffre', { groupe: 'coffre', sub: 'voir', user: 'u2' });
    V('après un divorce : le coffre est partagé à parts égales', joueur('u2').col === colU2 + 75 && joueur('u3').col === 225 && /parts égales/.test(div.reponses[0].content) && G.coffreSao('G1', cle).col === 0);
    V('… et le Lien du cœur s\'éteint', !require('../src/utils/sao/liens').lienDuCoeur('G1', 'u2'));
  }

  console.log('\n14) Classements paginés et Monument of Life');
  {
    for (let i = 0; i < 22; i++) G.crediterCol('G1', `foule${i}`, i * 10);
    const it = await commande('classement');
    const p = sortie(it);
    V('classement par étage, page 1, rangs 1 à 10', /Rangs 1 à 10/.test(txt(p)) && /Page 1\//.test(embedDe(p).footer?.text || ''));
    V('pagination par boutons (⏮️ / ⏭️)', ids(p).includes('sao:cl:etage:2') && ids(p).includes('sao:cl:etage:0'));
    V('menu de catégories', ids(p).includes('sao:clc'));
    const p2 = await clic('sao:cl:etage:2', { user: 'u4' });
    V('page 2 : rangs 11 à 20', /Rangs 11 à 20/.test(txt(p2.mises[0])));
    const morts = fausse({ type: 'menu', customId: 'sao:clc', valeurs: ['morts'] });
    await IC.execute(morts);
    V('Monument of Life : les tombés, barrés', /Monument of Life/.test(txt(morts.mises[0])) && /~~<@u1>~~/.test(txt(morts.mises[0])));
    const col = await commande('classement', { options: { categorie: 'col' } });
    V('classement de fortune trié', /Fortune/.test(txt(sortie(col))));
    V('toutes les catégories demandées existent', ['etage', 'niveau', 'col', 'boss', 'morts'].every((k) => G.CLASSEMENTS[k]));
  }

  console.log('\n15) /config → ⚔️ Aventure SAO');
  {
    const menu = fausse({ type: 'menu', customId: 'cfgcat', valeurs: ['sao'], grade: 2, user: 'mod' });
    await handleConfigInteraction(menu);
    const vue = menu.mises[0];
    V('la catégorie s\'ouvre depuis le menu cfgcat', /Aventure SAO/.test(txt(vue)));
    V('5 rangées au plus', (vue.components || []).length <= 5 && (vue.components || []).length === 5);
    V('tous les identifiants commencent par cfg', ids(vue).every((id) => id.startsWith('cfg')));
    const membreSimple = fausse({ type: 'bouton', customId: 'cfgsao:pvp', grade: 0, user: 'u4' });
    await handleConfigInteraction(membreSimple);
    V('réservé au staff', eph(membreSimple.reponses[0]) && G.reglagesSao('G1').pvp === true);
    await handleConfigInteraction(fausse({ type: 'bouton', customId: 'cfgsao:pvp', grade: 2, user: 'mod' }));
    V('bascule des duels', G.reglagesSao('G1').pvp === false);
    await handleConfigInteraction(fausse({ type: 'bouton', customId: 'cfgsao:pvp', grade: 2, user: 'mod' }));
    await handleConfigInteraction(fausse({ type: 'bouton', customId: 'cfgsao:afk', grade: 2, user: 'mod' }));
    V('bascule de l\'AFK', G.reglagesSao('G1').afk === false);
    await handleConfigInteraction(fausse({ type: 'bouton', customId: 'cfgsao:afk', grade: 2, user: 'mod' }));
    const ouvrir = fausse({ type: 'bouton', customId: 'cfgsao:valeurs', grade: 2, user: 'mod' });
    await handleConfigInteraction(ouvrir);
    const modal = ouvrir.modales[0];
    V('fenêtre des valeurs : 4 champs, libellés ≤ 45 signes', modal?.components?.length === 4 && modal.components.every((r) => r.components[0].label.length <= 45));
    const envoi = fausse({ type: 'modal', customId: 'cfgsao:modal', grade: 2, user: 'mod', champs: { raid: '999', chasse: '30', afk: '12', mort: '20' } });
    await handleConfigInteraction(envoi);
    const R = G.reglagesSao('G1');
    V('valeurs bornées et enregistrées', R.raidHeures === 168 && R.chasseDelai === 30 && R.afkHeures === 12 && R.mortPenalite === 20, JSON.stringify(R));
    const faux = fausse({ type: 'modal', customId: 'cfgsao:modal', grade: 2, user: 'mod', champs: { raid: 'abc', chasse: '30', afk: '12', mort: '20' } });
    await handleConfigInteraction(faux);
    V('une valeur non numérique est refusée, avec l\'explication', eph(faux.reponses[0]) && /nombre/.test(faux.reponses[0].content));
    const salonMenu = fausse({ type: 'menuSalon', customId: 'cfgsao:salon', grade: 2, user: 'mod', valeurs: ['GEN'] });
    await handleConfigInteraction(salonMenu);
    V('salon des raids réglé', getGuildConfig('G1').sao_salon_id === 'GEN');
    await handleConfigInteraction(fausse({ type: 'menu', customId: 'cfgsao:diff', grade: 2, user: 'mod', valeurs: ['heroique'] }));
    V('difficulté réglée', G.reglagesSao('G1').difficulte === 'heroique');
    V('chaque changement est journalisé', SALONS.LOGS.envois.length >= 5);
    const rz = fausse({ type: 'menuUser', customId: 'cfgsao:rzj', grade: 2, user: 'mod', valeurs: ['u4'] });
    await handleConfigInteraction(rz);
    V('réinitialiser un joueur : réservé à l\'administration', eph(rz.reponses[0]) && Boolean(joueur('u4')));
    const rzA = fausse({ type: 'menuUser', customId: 'cfgsao:rzj', grade: 3, user: 'adm', valeurs: ['u4'] });
    await handleConfigInteraction(rzA);
    V('… avec une confirmation', ids(rzA.mises[0]).includes('cfgsao:okj:u4') && Boolean(joueur('u4')));
    await handleConfigInteraction(fausse({ type: 'bouton', customId: 'cfgsao:okj:u4', grade: 3, user: 'adm' }));
    V('joueur effacé (personnage, sac, quêtes)', !joueur('u4') && !G.inventaireSao('G1', 'u4').length);
    const tout = fausse({ type: 'bouton', customId: 'cfgsao:rzt', grade: 3, user: 'adm' });
    await handleConfigInteraction(tout);
    V('réinitialiser le serveur : confirmation d\'abord', ids(tout.mises[0]).includes('cfgsao:okt') && Boolean(joueur('u1')));
    await handleConfigInteraction(fausse({ type: 'bouton', customId: 'cfgsao:module', grade: 2, user: 'mod' }));
    V('l\'interrupteur du module coupe SAO', !getGuildConfig('G1').sao_enabled);
    await handleConfigInteraction(fausse({ type: 'bouton', customId: 'cfgsaoon', grade: 2, user: 'mod' }));
    V('les bascules historiques de la vue Communauté marchent toujours', Boolean(getGuildConfig('G1').sao_enabled));
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'configPanel.js'), 'utf8');
    V('menu cfgcat : valeur « sao » et CATEGORY_VIEWS', /value: 'sao'/.test(src) && /sao: saoView/.test(src));
    setGuildConfig('G1', 'sao_difficulte', 'normal');
  }

  console.log('\n16) Persistance après un redémarrage complet, puis remise à zéro');
  {
    redemarrer();
    V('les personnages, sacs et badges sont toujours là', Boolean(joueur('u1')) && G.inventaireSao('G1', 'u1').length > 0 && G.ownedBadges('G1', 'u1').length > 3);
    await handleConfigInteraction(fausse({ type: 'bouton', customId: 'cfgsao:okt', grade: 3, user: 'adm' }));
    V('remise à zéro du serveur : tout est effacé', !joueur('u1') && !RAID.raidActif('G1') && !db.prepare("SELECT COUNT(*) AS n FROM sao_inventaire WHERE guild_id = 'G1'").get().n);
  }

  console.log('\n17) Déclaration de la commande et limites de Discord');
  {
    const data = SAO.data;
    const premierNiveau = (data.subs || []).length + (data.groupes || []).length;
    V('25 options au plus au premier niveau', premierNiveau <= 25, String(premierNiveau));
    V('25 sous-commandes au plus par groupe', (data.groupes || []).every((g) => (g.subs || []).length <= 25));
    const tous = [...(data.subs || []), ...(data.groupes || []).flatMap((g) => [g, ...(g.subs || [])])];
    V('noms en minuscules sans accent (≤ 32), descriptions ≤ 100', tous.every((s) => /^[a-z0-9_-]{1,32}$/.test(s.name) && s.description && s.description.length <= 100));
    V('guildModule « sao » et réponses publiques', SAO.guildModule === 'sao' && SAO.public === true);
    V('le tutoriel range /sao dans Communauté', /titre: 'Communauté', noms: \[[^\]]*'sao'/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'tutoriel.js'), 'utf8')));

    const fautes = [];
    let nonConvertibles = 0;
    for (const p of TOUS) {
      if (!p || typeof p !== 'object') continue;
      const rangees = (p.components || []).map(json);
      if (rangees.length > 5) fautes.push(`${rangees.length} rangées`);
      const vus = new Set();
      for (const r of rangees) {
        if ((r.components || []).length > 5) fautes.push('plus de 5 composants dans une rangée');
        if (r.components.some((c) => c.type !== 2) && r.components.length > 1) fautes.push('un menu partage sa rangée');
        for (const c of r.components || []) {
          if (c.custom_id) {
            if (c.custom_id.length > 100) fautes.push(`customId > 100 : ${c.custom_id}`);
            if (vus.has(c.custom_id)) fautes.push(`customId en double : ${c.custom_id}`);
            vus.add(c.custom_id);
          }
          if (c.label && c.label.length > 80) fautes.push(`libellé > 80 : ${c.label}`);
          if (c.options && (c.options.length > 25 || !c.options.length)) fautes.push(`${c.options.length} options`);
          for (const o of c.options || []) if (String(o.label).length > 100 || String(o.description || '').length > 100) fautes.push(`option > 100 : ${o.label}`);
        }
      }
      for (const e of (p.embeds || []).map(json)) {
        if ((e.description || '').length > 4096) fautes.push('description > 4096');
        if ((e.title || '').length > 256) fautes.push('titre > 256');
        // La vue Communauté de /config (hors SAO) garde ses champs historiques.
        if ((e.fields || []).length && !/Configuration — Communauté/.test(e.title || '')) fautes.push(`grille de champs : ${e.title}`);
      }
      if ((p.embeds || []).length && !cartes.convertirCorps({ content: p.content, embeds: p.embeds.map(json), components: rangees })) nonConvertibles++;
    }
    V(`aucune limite franchie (${TOUS.length} réponses examinées)`, fautes.length === 0, [...new Set(fautes)].slice(0, 6).join(' | '));
    V('toutes les cartes se convertissent (≤ 4000 signes, ≤ 40 composants)', nonConvertibles === 0, `${nonConvertibles} non convertibles`);
  }

  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  console.log('\n0 réussis, 1 échoués');
  process.exit(1);
});
