// 🎲 /jeu — règles de chaque jeu, IA, persistance, intrus, expiration,
// récompenses (plafond, Col), désactivation, /config et limites Discord.
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'jeux-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  return vrai.apply(this, arguments);
};

const SRC = path.join(__dirname, '..', 'src');
let { db, setGuildConfig, getGuildConfig } = require('../src/database');
let IC = require('../src/events/interactionCreate');
let JEU = require('../src/commands/jeu');
let P = require('../src/utils/jeux/parties');
let MOTEUR = require('../src/utils/jeux/moteur');
const R = require('../src/utils/jeux/regles');
const L = require('../src/utils/levels');
const S = require('../src/utils/saoGame');
const REP = require('../src/utils/reponse');
const CARTES = require('../src/utils/cartes');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };
const texte = (o) => JSON.stringify(o);
const warnOrig = console.warn;
console.warn = () => {};

// ── Faux Discord ────────────────────────────────────────────────────────
const personne = (id, nom, bot = false) => ({
  id, username: nom, displayName: nom, globalName: nom, bot, tag: `${nom}#0`,
  displayAvatarURL: () => `https://cdn.test/${id}.png`, async send() { return {}; },
});
const USERS = {
  u1: personne('u1', 'Alice'), u2: personne('u2', 'Bob'), u3: personne('u3', 'Chloé'), u4: personne('u4', 'Dan'),
  u5: personne('u5', 'Eve'), u6: personne('u6', 'Fay'), staff: personne('staff', 'Modo'), adm: personne('adm', 'Admin'),
  b1: personne('b1', 'RoboBot', true), BOT: personne('BOT', 'Ludo', true),
};
let compteur = 0;
function salon(id) {
  const stock = new Map();
  const s = {
    id, envois: [], guild: null, isTextBased: () => true,
    poser(p) {
      const msg = {
        id: `M${++compteur}`, channelId: id, flags: 0, createdTimestamp: Date.now(), editions: [], ...p,
        async edit(e) { msg.editions.push(e); Object.assign(msg, e); return msg; },
      };
      stock.set(msg.id, msg);
      s.envois.push(msg);
      return msg;
    },
    async send(p) { return s.poser(p); },
    messages: { fetch: async (mid) => stock.get(mid) || null },
  };
  return s;
}
const SALONS = { GEN: salon('GEN'), JEUX: salon('JEUX'), AUTRE: salon('AUTRE'), LOGS: salon('LOGS') };
const client = {
  user: { id: 'BOT', username: 'Ludo', tag: 'Ludo#0' },
  commands: new Map(),
  users: { fetch: async (id) => USERS[id] || null },
  channels: { fetch: async (id) => SALONS[id] || null },
  guilds: { cache: new Map() },
};
const guild = {
  id: 'G1', name: 'Labo', iconURL: () => null,
  members: { cache: new Map(), fetch: async () => null, me: null },
  roles: { cache: new Map(), fetch: async () => null },
  channels: { fetch: async (id) => SALONS[id] || null },
};
client.guilds.cache.set('G1', guild);
Object.values(SALONS).forEach((s) => { s.guild = guild; });
const ADMIN_BIT = 1n << 3n;
const MODO_BIT = 1n << 40n;
const membre = (id) => ({
  id, user: USERS[id], guild, roles: { cache: new Map() },
  permissions: { has: (bit) => (id === 'adm' ? bit === ADMIN_BIT || bit === MODO_BIT : id === 'staff' ? bit === MODO_BIT : false) },
});

function fausse({ type = 'commande', user = 'u1', sub = null, options = {}, customId = null, valeurs = [], champs = {}, message = null, salonId = 'GEN' } = {}) {
  const s = SALONS[salonId];
  return {
    client, guild, guildId: 'G1', channelId: salonId, channel: s, user: USERS[user], member: membre(user), locale: 'fr',
    commandName: 'jeu', customId, values: valeurs, deferred: false, replied: false, createdTimestamp: Date.now(), message,
    inGuild: () => true, isAutocomplete: () => false, isChatInputCommand: () => type === 'commande',
    isButton: () => type === 'bouton', isStringSelectMenu: () => type === 'menu', isModalSubmit: () => type === 'modal',
    isFromMessage: () => type === 'modal' && Boolean(message), isMessageComponent: () => type === 'bouton' || type === 'menu',
    isChannelSelectMenu: () => false, isRoleSelectMenu: () => false, isUserSelectMenu: () => false, isAnySelectMenu: () => type === 'menu',
    options: {
      getSubcommand: () => sub, getString: (k) => options[k] ?? null, getInteger: (k) => options[k] ?? null,
      getBoolean: (k) => options[k] ?? null, getUser: (k) => (options[k] ? USERS[options[k]] : null),
    },
    fields: { getTextInputValue: (k) => champs[k] ?? '' },
    reponses: [], suivis: [], mises: [], modales: [], dernier: null,
    async reply(p) { this.replied = true; this.reponses.push(p); if (!(Number(p?.flags) & 64)) this.dernier = s.poser(p); return p; },
    async fetchReply() { return this.dernier; },
    async followUp(p) { this.suivis.push(p); return p; },
    async update(p) { this.replied = true; this.mises.push(p); if (this.message) Object.assign(this.message, p); return p; },
    async deferUpdate() { this.deferred = true; },
    async deferReply() { this.deferred = true; },
    async editReply(p) { this.reponses.push(p); return p; },
    async showModal(m) { this.replied = true; this.modales.push(m.toJSON ? m.toJSON() : m); },
  };
}

// Toutes les charges utiles vues : on vérifiera les limites Discord dessus.
const VUES = [];
const noter = (...its) => {
  for (const it of its) {
    if (it.vu) continue;
    it.vu = true;
    for (const p of [...(it.reponses || []), ...(it.mises || [])]) if (p && typeof p === 'object') VUES.push(p);
  }
};

// Une commande /jeu <sub> passée par le VRAI routeur central.
async function commande(user, sub, options = {}, salonId = 'GEN') {
  const it = fausse({ user, sub, options, salonId });
  await IC.execute(it);
  noter(it);
  return it;
}
// Un clic (bouton, menu ou formulaire) passé par le vrai routeur.
async function clic(user, customId, message, { type = 'bouton', valeurs = [], champs = {}, salonId = 'GEN' } = {}) {
  const it = fausse({ type, user, customId, message, valeurs, champs, salonId });
  await IC.execute(it);
  noter(it);
  for (const ed of message?.editions || []) VUES.push(ed);
  return it;
}

const premiere = (it) => it.reponses[0] || {};
const prive = (it) => [...it.reponses, ...it.suivis].find((p) => Number(p?.flags) === 64) || null;
const embedDe = (p) => {
  const e = p?.embeds?.[0];
  return e?.toJSON ? e.toJSON() : e || {};
};
const rangeesDe = (p) => (p?.components || []).map((r) => (r.toJSON ? r.toJSON() : r));
const composantsDe = (p) => rangeesDe(p).flatMap((r) => r.components || []);
const idsDe = (p) => composantsDe(p).map((c) => c.custom_id).filter(Boolean);
const idPartieDe = (p) => Number((idsDe(p).find((i) => /^jeu:\d+:/.test(i)) || '').split(':')[1]) || null;
const derniereMise = (it) => it.mises[it.mises.length - 1] || null;
const tousDesactives = (p) => composantsDe(p).every((c) => c.disabled === true);
const recharger = () => P.oublierLancementsJeu();


(async () => {
  // ═══════════════════════════════ RÈGLES ═══════════════════════════════
  console.log('\n1) Morpion : victoires, nul, IA');
  {
    const vides = () => Array(9).fill(null);
    let toutes = true;
    for (const ligne of R.MORPION_LIGNES) {
      const g = vides();
      for (const i of ligne) g[i] = 'X';
      const issue = R.morpionVainqueur(g);
      if (issue?.gagnant !== 'X' || texte(issue.ligne) !== texte(ligne)) toutes = false;
    }
    V('les 8 alignements (3 lignes, 3 colonnes, 2 diagonales) gagnent', toutes && R.MORPION_LIGNES.length === 8);
    const nul = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
    V('grille pleine sans alignement → nul', R.morpionVainqueur(nul)?.nul === true);
    V('partie en cours → null', R.morpionVainqueur(['X', null, null, null, 'O', null, null, null, null]) === null);
    // L'IA gagne plutôt que bloquer.
    const gagner = ['O', 'O', null, 'X', 'X', null, null, null, 'X'];
    V('IA : prend le coup gagnant (même si elle pourrait bloquer)', R.morpionCoupIA(gagner, 'O', { erreur: 0 }) === 2);
    V('IA : prend le coup gagnant même en mode « erreur »', R.morpionCoupIA(gagner, 'O', { erreur: 1 }) === 2);
    const bloquer = ['X', 'X', null, null, 'O', null, null, null, null];
    V('IA : bloque l\'alignement adverse', R.morpionCoupIA(bloquer, 'O', { erreur: 0 }) === 2);
    // Deux IA parfaites font toujours match nul : le minimax est juste.
    const g = vides();
    let signe = 'X';
    while (!R.morpionVainqueur(g)) { g[R.morpionCoupIA(g, signe, { erreur: 0 })] = signe; signe = signe === 'X' ? 'O' : 'X'; }
    V('IA parfaite contre IA parfaite → match nul', R.morpionVainqueur(g)?.nul === true, g.join(''));
    // Battable : avec la part d'erreur, elle peut jouer au hasard (ici la case 8, pas le blocage en 2).
    const suite = [0.01, 0.99];
    const alea = () => suite.shift() ?? 0.5;
    V('IA « facile » : peut rater un blocage (coup au hasard)', R.morpionCoupIA(bloquer, 'O', { erreur: 0.5, alea }) !== 2);
  }

  console.log('\n2) Puissance 4 : quatre directions, nul, IA');
  {
    const C = R.P4_COLONNES;
    const avec = (cases, pion = 'R') => { const g = R.p4Vide(); for (const [l, c] of cases) g[l * C + c] = pion; return g; };
    V('horizontale', R.p4Vainqueur(avec([[5, 0], [5, 1], [5, 2], [5, 3]]))?.gagnant === 'R');
    V('verticale', R.p4Vainqueur(avec([[5, 2], [4, 2], [3, 2], [2, 2]], 'J'))?.gagnant === 'J');
    V('diagonale ↘', R.p4Vainqueur(avec([[2, 1], [3, 2], [4, 3], [5, 4]]))?.cases.length === 4);
    V('diagonale ↙', R.p4Vainqueur(avec([[2, 6], [3, 5], [4, 4], [5, 3]], 'J'))?.gagnant === 'J');
    V('trois seulement → rien', R.p4Vainqueur(avec([[5, 0], [5, 1], [5, 2]])) === null);
    const plein = Array.from({ length: R.P4_LIGNES * C }, (_, i) => ['R', 'R', 'J', 'J'][((i % C) + 2 * Math.floor(i / C)) % 4]);
    V('grille pleine sans alignement → nul', R.p4Vainqueur(plein)?.nul === true);
    let g = R.p4Vide();
    for (let k = 0; k < 6; k++) g = R.p4Jouer(g, 0, k % 2 ? 'J' : 'R').grille;
    V('le pion tombe en bas ; colonne pleine → refus', R.p4LigneLibre(R.p4Vide(), 3) === 5 && R.p4Jouer(g, 0, 'R') === null);
    V('colonne hors grille → refus', R.p4Jouer(R.p4Vide(), 7, 'R') === null && R.p4Jouer(R.p4Vide(), -1, 'R') === null);
    V('IA : gagne en complétant la ligne', R.p4CoupIA(avec([[5, 0], [5, 1], [5, 2]]), 'R', { erreur: 0 }) === 3);
    const menace = avec([[5, 0], [5, 1], [5, 2]], 'J');
    V('IA : bloque la ligne adverse', R.p4CoupIA(menace, 'R', { erreur: 0 }) === 3);
    V('IA : bloque une colonne adverse', R.p4CoupIA(avec([[5, 6], [4, 6], [3, 6]], 'J'), 'R', { erreur: 0 }) === 6);
    const lesDeux = avec([[5, 0], [5, 1], [5, 2]], 'J');
    for (const [l, c] of [[5, 6], [4, 6], [3, 6]]) lesDeux[l * C + c] = 'R';
    V('IA : gagner passe avant bloquer', R.p4CoupIA(lesDeux, 'J', { erreur: 0 }) === 3);
    const t0 = Date.now();
    R.p4CoupIA(R.p4Vide(), 'R', { profondeur: 5, erreur: 0 });
    V('IA profonde : répond vite (< 1,5 s)', Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
  }

  console.log('\n3) Pierre-feuille-ciseaux, pendu, plus ou moins');
  {
    V('pierre bat ciseaux, ciseaux bat feuille, feuille bat pierre',
      R.pfcDuel('pierre', 'ciseaux') === 1 && R.pfcDuel('ciseaux', 'feuille') === 1 && R.pfcDuel('feuille', 'pierre') === 1);
    V('… et l\'inverse perd, l\'identique fait égalité',
      R.pfcDuel('ciseaux', 'pierre') === -1 && R.pfcDuel('pierre', 'feuille') === -1 && R.pfcDuel('feuille', 'feuille') === 0);
    V('normalisation : accents et casse', R.penduNormaliser('Éléphant') === 'ELEPHANT' && R.penduNormaliser('jamaïque') === 'JAMAIQUE');
    V('masque : E révèle É et È, accents gardés', R.penduMasque('éléphant', ['E']) === 'É _ É _ _ _ _ _', R.penduMasque('éléphant', ['E']));
    V('mot trouvé seulement quand toutes les lettres le sont',
      !R.penduTrouve('chat', ['C', 'H', 'A']) && R.penduTrouve('chat', ['C', 'H', 'A', 'T']));
    V('potence : 8 étapes, de 0 à 7 erreurs', R.PENDU_ERREURS_MAX === 7 && R.penduDessin(7) !== R.penduDessin(6) && R.penduDessin(99) === R.penduDessin(7));
    const { LISTE_MOTS } = require('../src/utils/jeux/pendu');
    V(`${LISTE_MOTS.length} mots, tous faits de lettres seules`, LISTE_MOTS.length >= 150
      && LISTE_MOTS.every(({ mot }) => /^[A-Z]{4,14}$/.test(R.penduNormaliser(mot))), LISTE_MOTS.filter(({ mot }) => !/^[A-Z]{4,14}$/.test(R.penduNormaliser(mot))).map((m) => m.mot).join());
    V('plus ou moins : assez d\'essais pour la dichotomie', R.nombreEssaisMax(100) === 8 && R.nombreEssaisMax(1000) === 11 && R.nombreEssaisMax(10) === 5);
  }

  console.log('\n4) Blackjack : l\'as vaut 1 ou 11');
  {
    V('A + K = 21, blackjack', R.bjValeur(['A♠', 'K♥']).total === 21 && R.bjBlackjack(['A♠', 'K♥']));
    V('A + A = 12 (un as à 11, l\'autre à 1)', R.bjValeur(['A♠', 'A♥']).total === 12 && R.bjValeur(['A♠', 'A♥']).souple);
    V('A + A + 9 = 21', R.bjValeur(['A♠', 'A♥', '9♦']).total === 21);
    V('A + 5 + K = 16 (l\'as redescend à 1)', R.bjValeur(['A♠', '5♥', 'K♦']).total === 16 && !R.bjValeur(['A♠', '5♥', 'K♦']).souple);
    V('K + Q + 2 = 22 : sauté', R.bjValeur(['K♠', 'Q♥', '2♦']).total === 22);
    V('21 en trois cartes n\'est pas un blackjack', !R.bjBlackjack(['7♠', '7♥', '7♦']));
    V('issues : blackjack, victoire, nul, défaite',
      R.bjIssue(['A♠', 'K♥'], ['10♠', 'Q♦']) === 'blackjack'
      && R.bjIssue(['10♠', '9♦'], ['10♥', '6♣', 'K♠']) === 'victoire'
      && R.bjIssue(['10♠', '8♦'], ['10♥', '8♣']) === 'nul'
      && R.bjIssue(['10♠', '8♦', 'K♣'], ['10♥', '6♣', 'K♠']) === 'defaite'
      && R.bjIssue(['A♠', 'K♥'], ['A♦', 'Q♦']) === 'nul'
      && R.bjIssue(['7♠', '7♥', '7♦'], ['A♦', 'Q♦']) === 'defaite');
    V('le croupier reste sur un 17 souple', R.bjCroupier(['A♠', '6♥'], ['5♦']).main.length === 2);
    V('… et tire sur 16', R.bjValeur(R.bjCroupier(['10♠', '6♥'], ['5♦']).main).total === 21);
    V('gains : 2,5× / 2× / mise / 0', R.bjGain('blackjack', 100) === 250 && R.bjGain('victoire', 100) === 200 && R.bjGain('nul', 100) === 100 && R.bjGain('defaite', 100) === 0);
    const sabot = R.bjSabot();
    V('un paquet de 52 cartes toutes différentes', sabot.length === 52 && new Set(sabot).size === 52);
  }

  console.log('\n5) Démineur : voisins comptés, départ sûr');
  {
    let justes = true;
    let departs = true;
    for (let k = 0; k < 40; k++) {
      const t = Object.values(R.DEMINEUR_TAILLES)[k % 3];
      const g = R.demineurGrille(t.lignes, t.colonnes, t.mines);
      if (g.mines.filter(Boolean).length !== t.mines) justes = false;
      for (let i = 0; i < g.mines.length; i++) {
        if (g.mines[i]) continue;
        const l = Math.floor(i / g.colonnes); const c = i % g.colonnes;
        let n = 0;
        for (let dl = -1; dl <= 1; dl++) for (let dc = -1; dc <= 1; dc++) {
          if ((dl || dc) && l + dl >= 0 && l + dl < g.lignes && c + dc >= 0 && c + dc < g.colonnes && g.mines[(l + dl) * g.colonnes + c + dc]) n++;
        }
        if (n !== g.comptes[i] || n !== R.demineurVoisins(g, i)) justes = false;
      }
      if (g.mines[g.depart] || g.comptes[g.depart] !== 0) departs = false;
    }
    V('nombre de mines et comptes des voisins exacts (40 grilles)', justes);
    V('la case de départ n\'est jamais une mine, et n\'a aucune mine autour', departs);
    const serre = R.demineurGrille(3, 3, 5);
    V('grille trop pleine pour un départ vide : le départ reste sûr', !serre.mines[serre.depart] && serre.mines.filter(Boolean).length === 5);
    const g = R.demineurGrille(9, 9, 14);
    const txt = R.demineurTexte(g);
    V('texte : 80 cases sous spoiler, la case de départ visible', (txt.match(/\|\|[^|]+\|\|/g) || []).length === 80 && txt.split('\n').length === 9);
  }

  console.log('\n6) Banque du quiz');
  {
    const { BANQUE_QUIZ, THEMES_QUIZ } = require('../src/utils/jeux/quiz');
    const fautives = BANQUE_QUIZ.map((q, i) => [i, R.quizDefauts(q)]).filter(([, d]) => d.length);
    V(`${BANQUE_QUIZ.length} questions (≥ 150)`, BANQUE_QUIZ.length >= 150);
    V('chacune : thème, question, 4 réponses distinctes, index juste', fautives.length === 0, texte(fautives.slice(0, 3)));
    V('pas deux fois la même question', new Set(BANQUE_QUIZ.map((q) => q.question)).size === BANQUE_QUIZ.length);
    V(`${THEMES_QUIZ.length} thèmes (≤ 25 choix de commande), au moins 10 questions chacun`, THEMES_QUIZ.length <= 25
      && THEMES_QUIZ.every((t) => BANQUE_QUIZ.filter((q) => q.theme === t).length >= 10));
    V('banque en JSON, hors du code (pas de traduction imposée)', fs.existsSync(path.join(SRC, 'utils/jeux/quiz.json')) && fs.existsSync(path.join(SRC, 'utils/jeux/mots.json')));
  }

  // ════════════════════════════ PARCOURS ════════════════════════════════
  client.commands.set('jeu', JEU);
  setGuildConfig('G1', 'log_channel_id', 'LOGS');

  console.log('\n7) Module coupé, puis morpion contre le bot');
  let partieBot;
  {
    let it = await commande('u1', 'morpion');
    V('module coupé → refus éphémère qui renvoie à /config → 🎲 Mini-jeux', premiere(it).flags === 64 && /🎲 Mini-jeux/.test(premiere(it).content), texte(premiere(it)));
    const bouton = await clic('u1', 'jeu:1:c:0', { id: 'X', flags: 0, components: [], embeds: [{}] });
    V('module coupé → un vieux bouton le dit', /désactivés/.test(texte(bouton.reponses[0])));

    setGuildConfig('G1', 'jeux_enabled', 1);
    it = await commande('u1', 'morpion');
    noter(it);
    const r = premiere(it);
    partieBot = idPartieDe(r);
    const partie = P.lirePartieJeu(partieBot);
    V('réponse PUBLIQUE (pas d\'éphémère), en carte possible', r.flags === undefined && embedDe(r).title === '⭕ Morpion');
    V('grille 3×3 + « Abandonner » : 4 rangées', rangeesDe(r).length === 4 && idsDe(r).includes(`jeu:${partieBot}:c:8`) && idsDe(r).includes(`jeu:${partieBot}:abandon`));
    V('partie en base : joueurs, tour, message retenu', partie?.jeu === 'morpion' && texte(partie.joueurs) === '["u1","bot"]' && partie.tour === 'u1' && partie.message_id === it.dernier.id);

    const intrus = await clic('u3', `jeu:${partieBot}:c:4`, it.dernier);
    V('un intrus qui clique → réponse éphémère, rien ne bouge', prive(intrus) && /partie de <@u1>/.test(prive(intrus).content) && !intrus.mises.length);

    const coup = await clic('u1', `jeu:${partieBot}:c:4`, it.dernier);
    noter(coup);
    const apres = P.lirePartieJeu(partieBot);
    V('le joueur joue, le bot répond aussitôt', apres.etat.grille[4] === 'X' && apres.etat.grille.filter((v) => v === 'O').length === 1 && coup.mises.length === 1, texte(apres.etat.grille));
    const prise = await clic('u1', `jeu:${partieBot}:c:4`, it.dernier);
    V('case déjà prise → refus éphémère', /déjà prise/.test(prive(prise)?.content || ''));

    // On force une position gagnante pour finir la partie.
    apres.etat.grille = ['X', 'X', null, 'O', 'O', null, null, null, null];
    P.sauverPartieJeu(apres);
    const xpAvant = L.getLevels('G1', 'u1').xp;
    const fin = await clic('u1', `jeu:${partieBot}:c:2`, it.dernier);
    noter(fin);
    const vue = derniereMise(fin);
    V('victoire : message final, toutes les cases grisées', /gagne la partie/.test(embedDe(vue).description) && tousDesactives(vue) && rangeesDe(vue).length === 3);
    V('… la ligne gagnante en vert', composantsDe(vue).filter((c) => c.style === 3).length === 3);
    V('… statistiques notées, partie effacée', P.statsMembreJeux('G1', 'u1')[0]?.victoires === 1 && !P.lirePartieJeu(partieBot));
    V('… XP « victoire contre le bot » versée (5)', L.getLevels('G1', 'u1').xp - xpAvant === 5 && /\+5 XP/.test(embedDe(vue).description), `${L.getLevels('G1', 'u1').xp - xpAvant}`);
    const perime = await clic('u1', `jeu:${partieBot}:c:5`, it.dernier);
    V('bouton d\'une partie finie → « terminée », éphémère', /terminée ou a expiré/.test(prive(perime)?.content || ''));
  }

  console.log('\n8) Défi entre membres : invitation, intrus, tours, victoire');
  {
    recharger();
    let it = await commande('u1', 'morpion', { adversaire: 'u2' });
    noter(it);
    const r = premiere(it);
    const id = idPartieDe(r);
    V('invitation : l\'invité est mentionné et SEUL notifié', r.content === '<@u2>' && texte(r.allowedMentions) === texte({ users: ['u2'], parse: [] }));
    V('… boutons Accepter / Refuser', idsDe(r).includes(`jeu:${id}:oui`) && idsDe(r).includes(`jeu:${id}:non`));

    const vite = await commande('u1', 'pendu');
    V('anti-spam : un second lancement trop rapproché est refusé', /Doucement/.test(premiere(vite).content || ''));
    recharger();
    const double = await commande('u1', 'morpion');
    V('une partie active par joueur et par jeu', /déjà une partie/.test(premiere(double).content || '') && premiere(double).flags === 64);
    recharger();
    const invite = await commande('u2', 'morpion');
    V('… l\'invité aussi est « occupé » tant que le défi court', /déjà une partie/.test(premiere(invite).content || ''));
    recharger();
    const bot = await commande('u3', 'morpion', { adversaire: 'b1' });
    V('défier un autre bot → refus', /bots/.test(premiere(bot).content || ''));
    const moi = await commande('u3', 'morpion', { adversaire: 'u3' });
    V('se défier soi-même → refus (un défi refusé ne coûte pas le délai anti-spam)', /toi-même/.test(premiere(moi).content || ''));
    const occupe = await commande('u3', 'morpion', { adversaire: 'u2' });
    V('défier un membre déjà en partie → refus', /a déjà une partie de morpion/.test(premiere(occupe).content || ''));

    const intrus = await clic('u3', `jeu:${id}:oui`, it.dernier);
    V('un intrus ne peut pas accepter', /oppose <@u1> et <@u2>/.test(prive(intrus)?.content || ''));
    const lanceur = await clic('u1', `jeu:${id}:oui`, it.dernier);
    V('le lanceur ne peut pas accepter à la place de l\'invité', /C'est à <@u2>/.test(prive(lanceur)?.content || ''));
    const accepte = await clic('u2', `jeu:${id}:oui`, it.dernier);
    noter(accepte);
    const p0 = P.lirePartieJeu(id);
    V('défi accepté : la grille remplace l\'invitation (mention retirée)', p0.etat.phase === 'jeu' && derniereMise(accepte).content === '' && rangeesDe(derniereMise(accepte)).length === 4);

    const premier = p0.tour;
    const second = premier === 'u1' ? 'u2' : 'u1';
    const pasToi = await clic(second, `jeu:${id}:c:0`, it.dernier);
    V('hors de son tour → refus éphémère', /pas ton tour/.test(prive(pasToi)?.content || ''));
    const xpAvant = L.getLevels('G1', premier).xp;
    for (const [qui, c] of [[premier, 0], [second, 3], [premier, 1], [second, 4]]) await clic(qui, `jeu:${id}:c:${c}`, it.dernier);
    const fin = await clic(premier, `jeu:${id}:c:2`, it.dernier);
    noter(fin);
    V('alignement → victoire du premier joueur', /gagne la partie/.test(embedDe(derniereMise(fin)).description) && !P.lirePartieJeu(id));
    const st = (u) => P.statsMembreJeux('G1', u).find((x) => x.jeu === 'morpion') || {};
    V('statistiques : une victoire, une défaite', st(premier).victoires >= 1 && st(second).defaites === 1);
    V('XP d\'une victoire contre un membre (20)', L.getLevels('G1', premier).xp - xpAvant === 20, `${L.getLevels('G1', premier).xp - xpAvant}`);

    recharger();
    it = await commande('u1', 'puissance4', { adversaire: 'u3' });
    const id2 = idPartieDe(premiere(it));
    const refus = await clic('u3', `jeu:${id2}:non`, it.dernier);
    V('défi refusé : message clair, boutons retirés, partie effacée', /décliné/.test(embedDe(derniereMise(refus)).description) && rangeesDe(derniereMise(refus)).length === 0 && !P.lirePartieJeu(id2));
  }

  console.log('\n9) Expiration : balayage, clic tardif, message réédité');
  {
    recharger();
    let it = await commande('u1', 'puissance4', { adversaire: 'u2' });
    const id = idPartieDe(premiere(it));
    const p = P.lirePartieJeu(id);
    p.expire_le = Date.now() - 1000;
    P.sauverPartieJeu(p);
    const n = await MOTEUR.balayerJeux(client);
    const ed = it.dernier.editions[it.dernier.editions.length - 1];
    V('balayage : la partie expirée est conclue', n >= 1 && !P.lirePartieJeu(id));
    V('… le message est réédité : « n\'a pas répondu », boutons retirés', ed && /pas répondu à temps/.test(embedDe(ed).description) && (ed.components || []).length === 0, texte(ed).slice(0, 200));
    V('… sans faire sonner personne', texte(ed.allowedMentions) === texte({ parse: [] }));

    recharger();
    it = await commande('u4', 'morpion');
    const id2 = idPartieDe(premiere(it));
    const p2 = P.lirePartieJeu(id2);
    p2.expire_le = Date.now() - 1;
    P.sauverPartieJeu(p2);
    const tard = await clic('u4', `jeu:${id2}:c:0`, it.dernier);
    V('clic après l\'heure : « Partie expirée », cases grisées', /Partie expirée/.test(embedDe(derniereMise(tard)).description) && tousDesactives(derniereMise(tard)));
    V('… et l\'auteur du clic le lit en privé', /a expiré/.test(prive(tard)?.content || ''));

    // Une partie publiée en CARTE se réédite en composants, pas en embeds.
    recharger();
    it = await commande('u4', 'nombre');
    const id3 = idPartieDe(premiere(it));
    it.dernier.flags = 1 << 15;
    const p3 = P.lirePartieJeu(id3);
    p3.expire_le = Date.now() - 1;
    P.sauverPartieJeu(p3);
    await MOTEUR.expirerJeuParId(client, id3);
    const edC = it.dernier.editions[it.dernier.editions.length - 1];
    V('carte : réédition en composants (aucun champ « embeds »)', edC && !('embeds' in edC) && Array.isArray(edC.components) && edC.components.length > 0, texte(edC).slice(0, 160));
  }

  console.log('\n10) Persistance : un redémarrage n\'abîme pas la partie');
  {
    recharger();
    const it = await commande('u5', 'morpion');
    const id = idPartieDe(premiere(it));
    // « Redémarrage » : on oublie tous les modules du bot, on recharge.
    for (const k of Object.keys(require.cache)) if (k.startsWith(SRC)) delete require.cache[k];
    ({ db, setGuildConfig, getGuildConfig } = require('../src/database'));
    IC = require('../src/events/interactionCreate');
    JEU = require('../src/commands/jeu');
    P = require('../src/utils/jeux/parties');
    MOTEUR = require('../src/utils/jeux/moteur');
    client.commands.set('jeu', JEU);
    const coup = await clic('u5', `jeu:${id}:c:4`, it.dernier);
    const p = P.lirePartieJeu(id);
    V('après rechargement, le bouton joue toujours', coup.mises.length === 1 && p?.etat.grille[4] === 'X');
    const intrus = await clic('u6', `jeu:${id}:c:0`, it.dernier);
    V('… et l\'intrus est toujours refusé', /partie de <@u5>/.test(prive(intrus)?.content || ''));
    MOTEUR.demarrerJeux(client); // réarmement : ne doit rien casser
    V('… démarrage des jeux : la partie en cours est conservée', Boolean(P.lirePartieJeu(id)));
  }

  console.log('\n11) Désactivation d\'un jeu');
  {
    recharger();
    let it = await commande('u6', 'morpion');
    const id = idPartieDe(premiere(it));
    setGuildConfig('G1', 'jeux_desactives', 'morpion,quiz');
    recharger();
    const refus = await commande('u3', 'morpion');
    V('lancer un jeu coupé → refus qui le dit', /Morpion\*\* est désactivé/.test(premiere(refus).content || ''));
    const arret = await clic('u6', `jeu:${id}:c:0`, it.dernier);
    V('cliquer dans une partie d\'un jeu coupé → partie arrêtée', /Partie arrêtée/.test(embedDe(derniereMise(arret)).description) && !P.lirePartieJeu(id));
    recharger();
    it = await commande('u6', 'pendu');
    V('les autres jeux restent ouverts', embedDe(premiere(it)).title === '🪢 Pendu');
    const idP = idPartieDe(premiere(it));
    P.finirPartieJeu(idP);
    setGuildConfig('G1', 'jeux_desactives', null);
  }

  console.log('\n12) Récompenses : plafond quotidien, Col SAO');
  {
    setGuildConfig('G1', 'jeux_xp_victoire', 20);
    setGuildConfig('G1', 'jeux_xp_plafond', 30);
    const r1 = P.preparerRecompenseJeu('G1', 'u4');
    const r2 = P.preparerRecompenseJeu('G1', 'u4');
    const r3 = P.preparerRecompenseJeu('G1', 'u4');
    V('plafond 30 : 20 puis 10 puis 0', r1.xp === 20 && r2.xp === 10 && r2.plafonne && r3.xp === 0 && r3.plafonne, texte([r1, r2, r3]));
    V('le plafond se dit au joueur', /plafond d'XP du jour atteint/.test(P.ligneRecompenseJeu(r3)));
    V('le bot n\'est jamais récompensé', P.preparerRecompenseJeu('G1', 'bot') === null);
    setGuildConfig('G1', 'sao_enabled', 1);
    setGuildConfig('G1', 'jeux_col_victoire', 50);
    const c1 = P.preparerRecompenseJeu('G1', 'u3', { contreBot: true });
    V('Col SAO versés quand SAO est actif', c1.col === 50 && S.getPlayer('G1', 'u3')?.col === 50 && /\+50 Col/.test(P.ligneRecompenseJeu(c1)));
    const c2 = P.preparerRecompenseJeu('G1', 'u4');
    V('plafond atteint : plus de Col non plus', c2.col === 0);
    setGuildConfig('G1', 'sao_enabled', 0);
    V('SAO coupé : aucun Col', P.preparerRecompenseJeu('G1', 'u3').col === 0);
    setGuildConfig('G1', 'levels_enabled', 0);
    V('niveaux coupés : aucune XP', P.preparerRecompenseJeu('G1', 'u2').xp === 0);
    setGuildConfig('G1', 'levels_enabled', 1);
    setGuildConfig('G1', 'jeux_col_victoire', 0);
    setGuildConfig('G1', 'jeux_xp_plafond', 200);
    V('jour de Paris au format AAAA-MM-JJ', /^\d{4}-\d{2}-\d{2}$/.test(P.jourJeux()));
    V('… qui change à minuit heure de Paris, pas à minuit UTC', P.jourJeux(new Date('2026-10-19T22:30:00Z')) === '2026-10-20'
      && P.jourJeux(new Date('2026-10-19T21:30:00Z')) === '2026-10-19');
  }

  console.log('\n13) Blackjack : mise, solde, doubler, expiration');
  {
    recharger();
    let it = await commande('u1', 'blackjack', { mise: 100 });
    V('mise sans Aventure SAO → refus propre', /Aventure SAO/.test(premiere(it).content || '') && premiere(it).flags === 64);
    setGuildConfig('G1', 'sao_enabled', 1);
    recharger();
    it = await commande('u1', 'blackjack', { mise: 100 });
    V('mise > solde → refus qui donne le solde', /Mise trop haute/.test(premiere(it).content || '') && /0 Col/.test(premiere(it).content));
    const { player } = S.ensurePlayer('G1', 'u1');
    player.col = 500;
    S.savePlayer(player);
    recharger();
    const aleaOrig = Math.random;
    Math.random = () => 0; // paquet connu : 2♠ 3♠ | 4♠ 5♠ | 6♠ 7♠ 8♠…
    it = await commande('u1', 'blackjack', { mise: 100 });
    Math.random = aleaOrig;
    noter(it);
    const id = idPartieDe(premiere(it));
    V('la mise est retirée au lancement', S.getPlayer('G1', 'u1').col === 400);
    V('main affichée en champs : croupier (carte cachée) et joueur', /🂠/.test(texte(premiere(it))) && embedDe(premiere(it)).fields?.length === 2);
    const intrus = await clic('u2', `jeu:${id}:rester`, it.dernier);
    V('l\'intrus ne joue pas la main d\'un autre', /partie de <@u1>/.test(prive(intrus)?.content || ''));
    const dbl = await clic('u1', `jeu:${id}:doubler`, it.dernier);
    noter(dbl);
    V('doubler : mise doublée et payée, une carte, puis le croupier saute', /Gagné/.test(embedDe(derniereMise(dbl)).description) && S.getPlayer('G1', 'u1').col === 700, `${S.getPlayer('G1', 'u1').col}`);
    V('… statistiques : une victoire', (P.statsMembreJeux('G1', 'u1').find((x) => x.jeu === 'blackjack') || {}).victoires === 1);

    // Expiration : la main « reste » et se solde.
    recharger();
    Math.random = () => 0;
    it = await commande('u1', 'blackjack', { mise: 50 });
    Math.random = aleaOrig;
    const id2 = idPartieDe(premiere(it));
    const p = P.lirePartieJeu(id2);
    p.etat.joueur = ['10♠', '9♥'];
    p.etat.croupier = ['10♦', '7♣'];
    p.expire_le = Date.now() - 1;
    P.sauverPartieJeu(p);
    await MOTEUR.balayerJeux(client);
    const ed = it.dernier.editions[it.dernier.editions.length - 1];
    V('expiration : la main reste et se solde (19 contre 17 → gagné)', /restes sur ta main/.test(embedDe(ed).description) && /Gagné/.test(embedDe(ed).description) && S.getPlayer('G1', 'u1').col === 750, `${S.getPlayer('G1', 'u1').col}`);

    // Jeu coupé en pleine main : la mise est rendue.
    recharger();
    Math.random = () => 0;
    it = await commande('u1', 'blackjack', { mise: 100 });
    Math.random = aleaOrig;
    const id3 = idPartieDe(premiere(it));
    V('nouvelle mise retirée', S.getPlayer('G1', 'u1').col === 650);
    setGuildConfig('G1', 'jeux_desactives', 'blackjack');
    await clic('u1', `jeu:${id3}:tirer`, it.dernier);
    V('jeu coupé en pleine main → mise rendue', S.getPlayer('G1', 'u1').col === 750 && !P.lirePartieJeu(id3));
    setGuildConfig('G1', 'jeux_desactives', null);

    S.getPlayer('G1', 'u1');
    const p1 = S.getPlayer('G1', 'u1');
    p1.col = 100;
    S.savePlayer(p1);
    recharger();
    Math.random = () => 0;
    it = await commande('u1', 'blackjack', { mise: 100 });
    Math.random = aleaOrig;
    const id4 = idPartieDe(premiere(it));
    const pauvre = await clic('u1', `jeu:${id4}:doubler`, it.dernier);
    V('doubler sans les Col nécessaires → refus, la main continue', /Il te faut encore/.test(prive(pauvre)?.content || '') && Boolean(P.lirePartieJeu(id4)));
    const reste = await clic('u1', `jeu:${id4}:rester`, it.dernier);
    noter(reste);
    V('rester : le croupier joue et la main se solde', !P.lirePartieJeu(id4) && /Croupier/.test(texte(derniereMise(reste))));
    setGuildConfig('G1', 'sao_enabled', 0);
  }

  console.log('\n14) Pendu : lettres, mot entier, tout le salon');
  {
    recharger();
    let it = await commande('u2', 'pendu', {}, 'JEUX');
    noter(it);
    const id = idPartieDe(premiere(it));
    const p = P.lirePartieJeu(id);
    p.etat.mot = 'éléphant';
    P.sauverPartieJeu(p);
    recharger();
    const deux = await commande('u3', 'pendu', {}, 'JEUX');
    V('un seul pendu par salon', /déjà en cours dans ce salon/.test(premiere(deux).content || ''));
    V('deux menus de lettres (13 options chacun) + « Proposer le mot »', composantsDe(premiere(it)).filter((c) => c.type === 3).every((m) => m.options.length === 13)
      && idsDe(premiere(it)).includes(`jeu:${id}:l:am`) && idsDe(premiere(it)).includes(`jeu:${id}:mot`));
    const e = await clic('u3', `jeu:${id}:l:am`, it.dernier, { type: 'menu', valeurs: ['E'], salonId: 'JEUX' });
    noter(e);
    V('n\'importe qui du salon joue : E révèle les É', /É _ É _ _ _ _ _/.test(embedDe(derniereMise(e)).description) && /2 fois dans le mot/.test(embedDe(derniereMise(e)).description));
    const menuAM = composantsDe(derniereMise(e)).find((c) => c.custom_id === `jeu:${id}:l:am`);
    V('… la lettre jouée disparaît du menu', menuAM && !menuAM.options.some((o) => o.value === 'E') && menuAM.options.length === 12);
    const triche = await clic('u3', `jeu:${id}:l:nz`, it.dernier, { type: 'menu', valeurs: ['B'], salonId: 'JEUX' });
    V('une lettre hors de son menu est refusée', /Choisis une lettre/.test(prive(triche)?.content || ''));
    const modal = await clic('u4', `jeu:${id}:mot`, it.dernier, { salonId: 'JEUX' });
    V('« Proposer le mot » ouvre un formulaire', modal.modales[0]?.custom_id === `jeu:${id}:motm` && modal.modales[0].components[0].components[0].label.length <= 45);
    const faux = await clic('u4', `jeu:${id}:motm`, it.dernier, { type: 'modal', champs: { mot: 'girafe' }, salonId: 'JEUX' });
    V('mauvais mot : une erreur, et le mot raté est montré', P.lirePartieJeu(id).etat.erreurs === 1 && /~~GIRAFE~~/.test(embedDe(derniereMise(faux)).description));
    const arret = await clic('u4', `jeu:${id}:abandon`, it.dernier, { salonId: 'JEUX' });
    V('seul le lanceur peut arrêter la partie', /Seul <@u2>/.test(prive(arret)?.content || ''));
    const xpAvant = L.getLevels('G1', 'u4').xp;
    const bon = await clic('u4', `jeu:${id}:motm`, it.dernier, { type: 'modal', champs: { mot: 'Elephant' }, salonId: 'JEUX' });
    noter(bon);
    V('le bon mot (sans accents) gagne, révélé avec ses accents', /trouve le mot ÉLÉPHANT/.test(embedDe(derniereMise(bon)).description) && !P.lirePartieJeu(id));
    V('… à plusieurs : XP de victoire contre des membres', L.getLevels('G1', 'u4').xp - xpAvant === 20, `${L.getLevels('G1', 'u4').xp - xpAvant}`);

    recharger();
    it = await commande('u2', 'pendu', {}, 'JEUX');
    const id2 = idPartieDe(premiere(it));
    const p2 = P.lirePartieJeu(id2);
    p2.etat.mot = 'chat';
    P.sauverPartieJeu(p2);
    let dernier;
    for (const l of ['B', 'D', 'E', 'F', 'G', 'I', 'J']) dernier = await clic('u2', `jeu:${id2}:l:am`, it.dernier, { type: 'menu', valeurs: [l], salonId: 'JEUX' });
    V('7 erreurs : pendu, le mot est donné', /Pendu !/.test(embedDe(derniereMise(dernier)).description) && /CHAT/.test(embedDe(derniereMise(dernier)).description));
    V('… défaite notée pour le participant', (P.statsMembreJeux('G1', 'u2').find((x) => x.jeu === 'pendu') || {}).defaites === 1);
  }

  console.log('\n15) Plus ou moins');
  {
    recharger();
    const it = await commande('u3', 'nombre', { max: 50 });
    noter(it);
    const id = idPartieDe(premiere(it));
    const p = P.lirePartieJeu(id);
    V('borne choisie, essais calculés', p.etat.borne === 50 && p.etat.max === R.nombreEssaisMax(50));
    p.etat.secret = 20;
    P.sauverPartieJeu(p);
    const form = await clic('u3', `jeu:${id}:prop`, it.dernier);
    V('« Proposer » ouvre un formulaire', form.modales[0]?.custom_id === `jeu:${id}:propm`);
    const intrus = await clic('u1', `jeu:${id}:prop`, it.dernier);
    V('un autre membre ne joue pas à sa place', /partie de <@u3>/.test(prive(intrus)?.content || '') && !intrus.modales.length);
    const bas = await clic('u3', `jeu:${id}:propm`, it.dernier, { type: 'modal', champs: { n: '10' } });
    V('indice ↑ quand c\'est plus', /\*\*10\*\* → ⬆️ c'est plus/.test(embedDe(derniereMise(bas)).description));
    const nul = await clic('u3', `jeu:${id}:propm`, it.dernier, { type: 'modal', champs: { n: 'abc' } });
    V('saisie invalide : refus, l\'essai ne compte pas', /n'est pas un nombre/.test(prive(nul)?.content || '') && P.lirePartieJeu(id).etat.essais.length === 1);
    const haut = await clic('u3', `jeu:${id}:propm`, it.dernier, { type: 'modal', champs: { n: '30' } });
    V('indice ↓ quand c\'est moins', /\*\*30\*\* → ⬇️ c'est moins/.test(embedDe(derniereMise(haut)).description));
    const gagne = await clic('u3', `jeu:${id}:propm`, it.dernier, { type: 'modal', champs: { n: '20' } });
    noter(gagne);
    V('trouvé : victoire en 3 essais', /Trouvé en 3 essais/.test(embedDe(derniereMise(gagne)).description) && !P.lirePartieJeu(id));
  }

  console.log('\n16) Quiz : un essai chacun, le premier juste gagne');
  {
    recharger();
    setGuildConfig('G1', 'jeux_desactives', null);
    let it = await commande('u1', 'quiz', { theme: 'Espace' }, 'AUTRE');
    noter(it);
    const id = idPartieDe(premiere(it));
    P.annulerMinuteurJeu(id);
    const p = P.lirePartieJeu(id);
    const { BANQUE_QUIZ } = require('../src/utils/jeux/quiz');
    V('thème respecté, 4 boutons de réponse', BANQUE_QUIZ[p.etat.q].theme === 'Espace' && idsDe(premiere(it)).length === 4);
    V('bonne réponse retrouvée après mélange', reponsesOk(p, BANQUE_QUIZ));
    recharger();
    const deux = await commande('u2', 'quiz', {}, 'AUTRE');
    V('une question à la fois par salon', /déjà posée/.test(premiere(deux).content || ''));
    const faux = (p.etat.bonne + 1) % 4;
    const rate = await clic('u2', `jeu:${id}:r:${faux}`, it.dernier, { salonId: 'AUTRE' });
    V('mauvaise réponse → « Raté », en privé, message public intact', /Raté/.test(prive(rate)?.content || '') && !rate.mises.length);
    const encore = await clic('u2', `jeu:${id}:r:${p.etat.bonne}`, it.dernier, { salonId: 'AUTRE' });
    V('un seul essai par question', /un seul essai/.test(prive(encore)?.content || '') && Boolean(P.lirePartieJeu(id)));
    const juste = await clic('u3', `jeu:${id}:r:${p.etat.bonne}`, it.dernier, { salonId: 'AUTRE' });
    noter(juste);
    const vue = derniereMise(juste);
    V('la bonne réponse gagne : boutons grisés, la bonne en vert', /a trouvé en/.test(embedDe(vue).description) && tousDesactives(vue)
      && composantsDe(vue)[p.etat.bonne].style === 3);
    V('statistiques : victoire du gagnant, défaite du raté', (P.statsMembreJeux('G1', 'u3').find((x) => x.jeu === 'quiz') || {}).victoires === 1
      && (P.statsMembreJeux('G1', 'u2').find((x) => x.jeu === 'quiz') || {}).defaites === 1);

    recharger();
    it = await commande('u4', 'quiz', {}, 'AUTRE');
    const id2 = idPartieDe(premiere(it));
    P.annulerMinuteurJeu(id2);
    await MOTEUR.expirerJeuParId(client, id2);
    const ed = it.dernier.editions[it.dernier.editions.length - 1];
    V('20 s sans bonne réponse : « Temps écoulé » et la réponse', /Temps écoulé/.test(embedDe(ed).description) && tousDesactives(ed));
  }

  console.log('\n17) Réflexe : trop tôt = éliminé, puis le plus rapide');
  {
    recharger();
    const it = await commande('u1', 'reflexe', {}, 'AUTRE');
    noter(it);
    const id = idPartieDe(premiere(it));
    P.annulerMinuteurJeu(id);
    const tot = await clic('u2', `jeu:${id}:clic`, it.dernier, { salonId: 'AUTRE' });
    V('cliquer avant le vert → éliminé·e, en privé', /Trop tôt/.test(prive(tot)?.content || '') && P.lirePartieJeu(id).etat.elimines.includes('u2') && !tot.mises.length);
    const { signalReflexe } = require('../src/utils/jeux/reflexe');
    await signalReflexe(client, id);
    P.annulerMinuteurJeu(id);
    const ed = it.dernier.editions[it.dernier.editions.length - 1];
    V('le signal réédite le message : bouton vert « CLIQUE ! »', composantsDe(ed)[0]?.style === 3 && /CLIQUE/.test(composantsDe(ed)[0].label));
    const encore = await clic('u2', `jeu:${id}:clic`, it.dernier, { salonId: 'AUTRE' });
    V('un·e éliminé·e ne rejoue pas', /éliminé/.test(prive(encore)?.content || ''));
    const gagne = await clic('u3', `jeu:${id}:clic`, it.dernier, { salonId: 'AUTRE' });
    noter(gagne);
    V('le premier clic après le vert gagne, avec son temps', /gagne en \d+,\d{3} s/.test(embedDe(derniereMise(gagne)).description) && !P.lirePartieJeu(id));

    recharger();
    const it2 = await commande('u4', 'reflexe', {}, 'AUTRE');
    const id2 = idPartieDe(premiere(it2));
    P.annulerMinuteurJeu(id2);
    const p2 = P.lirePartieJeu(id2);
    p2.message_id = 'DISPARU';
    P.sauverPartieJeu(p2);
    const vert = await signalReflexe(client, id2);
    V('message introuvable au signal : partie arrêtée, aucun clic « à l\'aveugle »', vert === false && !P.lirePartieJeu(id2));
  }

  console.log('\n18) Pierre-feuille-ciseaux : choix secrets, manches');
  {
    recharger();
    let it = await commande('u5', 'pfc', { adversaire: 'u6' }, 'AUTRE');
    const id = idPartieDe(premiere(it));
    await clic('u6', `jeu:${id}:oui`, it.dernier, { salonId: 'AUTRE' });
    const a = await clic('u5', `jeu:${id}:pfc:pierre`, it.dernier, { salonId: 'AUTRE' });
    noter(a);
    const pub = texte(derniereMise(a));
    V('choix secret : le public lit seulement « a joué »', /✅ <@u5> a joué/.test(pub) && !/🪨/.test(embedDe(derniereMise(a)).description.split('Manche 1')[1] || ''));
    V('… et le joueur reçoit sa confirmation en privé', /Tu joues \*\*🪨 Pierre/.test(prive(a)?.content || ''));
    const bis = await clic('u5', `jeu:${id}:pfc:feuille`, it.dernier, { salonId: 'AUTRE' });
    V('impossible de changer d\'avis dans la manche', /déjà joué/.test(prive(bis)?.content || ''));
    const b = await clic('u6', `jeu:${id}:pfc:ciseaux`, it.dernier, { salonId: 'AUTRE' });
    noter(b);
    const desc = embedDe(derniereMise(b)).description;
    V('révélation : 🪨 contre ✂️, point pour u5', /Manche 1 : 🪨 contre ✂️ → point pour <@u5>/.test(desc) && P.lirePartieJeu(id).etat.scores.u5 === 1, desc);
    for (let k = 0; k < 2; k++) {
      await clic('u5', `jeu:${id}:pfc:pierre`, it.dernier, { salonId: 'AUTRE' });
      b.mises.length = 0;
      await clic('u6', `jeu:${id}:pfc:ciseaux`, it.dernier, { salonId: 'AUTRE' });
    }
    V('premier à 3 points : la partie se termine', !P.lirePartieJeu(id) && (P.statsMembreJeux('G1', 'u5').find((x) => x.jeu === 'pfc') || {}).victoires === 1);

    recharger();
    it = await commande('u5', 'pfc', {}, 'AUTRE');
    const id2 = idPartieDe(premiere(it));
    let tours = 0;
    while (P.lirePartieJeu(id2) && tours < 60) { await clic('u5', `jeu:${id2}:pfc:feuille`, it.dernier, { salonId: 'AUTRE' }); tours++; }
    V('contre le bot : chaque clic joue une manche, la partie finit', !P.lirePartieJeu(id2) && tours >= 3);
  }

  console.log('\n19) Démineur, statistiques, classement paginé');
  {
    recharger();
    const it = await commande('u2', 'demineur', { taille: 'grand' });
    noter(it);
    const d = embedDe(premiere(it)).description;
    V('démineur : grille 9×9 en spoilers, sans aucun bouton', (d.match(/\|\|[^|]+\|\|/g) || []).length === 80 && !(premiere(it).components || []).length && /14 mines/.test(d));
    const st = await commande('u1', 'stats');
    noter(st);
    const sd = embedDe(premiere(st)).description;
    V('stats : grammaire ◆ / ➜, un bloc par jeu', /◆ 🏅 · \*\*Bilan\*\*/.test(sd) && /◆ ⭕ · \*\*Morpion\*\*/.test(sd) && /➜ /.test(sd), sd.slice(0, 200));
    const vide = await commande('u6', 'stats', { membre: 'staff' });
    V('stats d\'un membre sans partie : message clair', /aucune partie/.test(embedDe(premiere(vide)).description));
    for (let k = 0; k < 14; k++) P.noterResultatJeu('G1', 'quiz', { gagnants: [`x${k}`], perdants: k % 2 ? [`y${k}`] : [] });
    const cl = await commande('u1', 'classement');
    noter(cl);
    const nav = idsDe(premiere(cl));
    V('classement : 10 par page, boutons de pages', nav.includes('jeu:cl:tous:0') && nav.includes('jeu:cl:tous:2') && /Page 1\/\d/.test(embedDe(premiere(cl)).footer?.text || ''));
    V('… médailles et grammaire ◆ / ➜', /◆ 🥇 · \*\*<@/.test(embedDe(premiere(cl)).description) && /➜ /.test(embedDe(premiere(cl)).description));
    const page2 = await clic('u4', 'jeu:cl:tous:2', cl.dernier);
    noter(page2);
    V('page suivante par le bouton', /Page 2\//.test(embedDe(derniereMise(page2)).footer?.text || ''));
    const clq = await commande('u1', 'classement', { jeu: 'quiz' });
    V('classement d\'un seul jeu', /Classement — Quiz/.test(embedDe(premiere(clq)).title));
  }

  console.log('\n20) /config → 🎲 Mini-jeux');
  {
    const ouvrir = await clic('staff', 'cfgcat', { id: 'CFG', flags: 0, components: [], embeds: [{}] }, { type: 'menu', valeurs: ['jeux'] });
    noter(ouvrir);
    const vue = derniereMise(ouvrir);
    V('catégorie Mini-jeux : 4 rangées (≤ 5), retour au panneau', rangeesDe(vue).length === 4 && idsDe(vue).includes('cfgback') && /Mini-jeux/.test(embedDe(vue).title));
    V('un interrupteur par jeu (9) + module + récompenses', idsDe(vue).filter((x) => x.startsWith('cfgjeux:jeu:')).length === 9 && idsDe(vue).includes('cfgjeux:module') && idsDe(vue).includes('cfgjeux:recompenses'));
    const membreSimple = await clic('u1', 'cfgjeux:module', { id: 'CFG', flags: 0 });
    V('un membre sans grade ne touche à rien', /réservé au \*\*staff/.test(texte(membreSimple.reponses[0])) && getGuildConfig('G1').jeux_enabled === 1);
    const coupe = await clic('staff', 'cfgjeux:jeu:pendu', { id: 'CFG', flags: 0 });
    V('couper un jeu : jeux_desactives mis à jour, vue rafraîchie', getGuildConfig('G1').jeux_desactives === 'pendu' && coupe.mises.length === 1);
    await clic('staff', 'cfgjeux:jeu:quiz', { id: 'CFG', flags: 0 });
    await clic('staff', 'cfgjeux:jeu:pendu', { id: 'CFG', flags: 0 });
    V('… et le rallumer', getGuildConfig('G1').jeux_desactives === 'quiz');
    await clic('staff', 'cfgjeux:jeu:quiz', { id: 'CFG', flags: 0 });
    const staffRec = await clic('staff', 'cfgjeux:recompenses', { id: 'CFG', flags: 0 });
    V('récompenses : réservées à l\'administration', /administration/.test(texte(staffRec.reponses[0])) && !staffRec.modales.length);
    const admRec = await clic('adm', 'cfgjeux:recompenses', { id: 'CFG', flags: 0 });
    const m = admRec.modales[0];
    V('… l\'admin ouvre le formulaire : 4 champs, libellés ≤ 45', m?.custom_id === 'cfgjeux:modal' && m.components.length === 4
      && m.components.every((r) => r.components[0].label.length <= 45), texte(m?.components?.map((r) => r.components[0].label)));
    const envoi = await clic('adm', 'cfgjeux:modal', { id: 'CFG', flags: 0 }, { type: 'modal', champs: { jeux_xp_victoire: '30', jeux_xp_bot: '9999', jeux_xp_plafond: '500', jeux_col_victoire: '25' } });
    const c = getGuildConfig('G1');
    V('… valeurs enregistrées et bornées (9999 → 1000)', c.jeux_xp_victoire === 30 && c.jeux_xp_bot === 1000 && c.jeux_xp_plafond === 500 && c.jeux_col_victoire === 25 && envoi.mises.length === 1);
    const mauvais = await clic('adm', 'cfgjeux:modal', { id: 'CFG', flags: 0 }, { type: 'modal', champs: { jeux_xp_victoire: 'beaucoup', jeux_xp_bot: '1', jeux_xp_plafond: '1', jeux_col_victoire: '1' } });
    V('… saisie invalide : refus, rien ne change', /pas un nombre/.test(texte(mauvais.reponses[0])) && getGuildConfig('G1').jeux_xp_bot === 1000);
    V('… chaque changement est journalisé', SALONS.LOGS.envois.length >= 4);
    const off = await clic('staff', 'cfgjeux:module', { id: 'CFG', flags: 0 });
    V('couper le module depuis /config', getGuildConfig('G1').jeux_enabled === 0 && off.mises.length === 1);
    recharger();
    const refus = await commande('u1', 'quiz');
    V('… /jeu le dit alors', /🎲 Mini-jeux/.test(premiere(refus).content || ''));
    setGuildConfig('G1', 'jeux_enabled', 1);
  }

  console.log('\n21) Limites Discord sur toutes les vues produites');
  {
    let rangees = true, boutons = true, ids = true, options = true, libelles = true, descr = true, cartes = true;
    for (const p of VUES) {
      const rs = rangeesDe(p);
      if (rs.length > 5) rangees = false;
      for (const r of rs) {
        if ((r.components || []).length > 5) boutons = false;
        for (const c of r.components || []) {
          if (c.custom_id && c.custom_id.length > 100) ids = false;
          if (c.options && c.options.length > 25) options = false;
          if (c.label && c.label.length > 80) libelles = false;
          if (c.type === 2 && !c.label && !c.emoji) libelles = false;
        }
      }
      const e = embedDe(p);
      if ((e.description || '').length > 4096 || (e.fields || []).some((f) => f.value.length > 1024)) descr = false;
      if (p.embeds?.length && !(Number(p.flags) & 64)) {
        // À l'envoi (convertirCorps) comme à la mise à jour (enComposants).
        const corps = { content: p.content, embeds: p.embeds.map((x) => (x.toJSON ? x.toJSON() : x)), components: rangeesDe(p) };
        const envoi = CARTES.convertirCorps(JSON.parse(JSON.stringify(corps)));
        const maj = REP.enComposants(guild, client, p);
        if (!envoi || !maj || CARTES.compter(maj) > CARTES.MAX_COMPOSANTS || CARTES.longueurTexte(maj) > CARTES.MAX_TEXTE_TOTAL) cartes = false;
      }
    }
    V(`${VUES.length} vues vérifiées : 5 rangées au plus`, VUES.length > 100 && rangees);
    V('5 composants par rangée au plus', boutons);
    V('identifiants ≤ 100 caractères', ids);
    V('menus ≤ 25 options', options);
    V('libellés ≤ 80, et jamais de bouton sans libellé ni émoji', libelles);
    V('descriptions ≤ 4096, champs ≤ 1024', descr);
    V('chaque vue tient dans une carte (≤ 40 composants, ≤ 4000 signes)', cartes);
    let trop = false;
    try { P.idJeu(1, 'x'.repeat(120)); } catch { trop = true; }
    V('un identifiant trop long lève au lieu de partir tronqué', trop);
  }

  console.log('\n22) Branchements');
  {
    const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const routeur = src('src/events/interactionCreate.js');
    V('routage « jeu: » (boutons, menus, formulaires), module revérifié', /startsWith\('jeu:'\)[\s\S]{0,300}jeux_enabled/.test(routeur));
    V('libellé du module et catégorie /config du refus', /jeux: 'Mini-jeux'/.test(routeur) && /jeux: '🎲 Mini-jeux'/.test(routeur));
    const panneau = src('src/utils/configPanel.js');
    V('/config : catégorie jeux dans cfgcat et CATEGORY_VIEWS, préfixe cfgjeux:', /value: 'jeux'/.test(panneau) && /jeux: jeuxView/.test(panneau) && /startsWith\('cfgjeux:'\)/.test(panneau));
    V('guide : /jeu rangé dans Communauté', require('../src/utils/tutoriel').CATEGORIES.find((c) => c.titre === 'Communauté').noms.includes('jeu'));
    V('démarrage : les parties reprennent au lancement du bot', /jeux\/moteur'\)\.demarrerJeux\(client\)/.test(src('src/events/ready.js')));
    const cfg = getGuildConfig('NOUVEAU');
    V('réglages en base avec leurs défauts', cfg.jeux_enabled === 0 && cfg.jeux_xp_victoire === 20 && cfg.jeux_xp_bot === 5 && cfg.jeux_xp_plafond === 200 && cfg.jeux_col_victoire === 0 && 'jeux_desactives' in cfg);
    V('module coupable, réponses publiques', JEU.guildModule === 'jeux' && JEU.public === true && JEU.grade === 0);
    const subs = JEU.data.subs || [];
    V(`${subs.length} sous-commandes (≤ 25), noms courts en minuscules`, subs.length === 11 && subs.length <= 25 && subs.every((s) => /^[a-z0-9]{1,32}$/.test(s.name)));
    V('descriptions ≤ 100 caractères', [JEU.data, ...subs].every((s) => s.description.length <= 100));
    V('table jeux_parties : colonnes du cahier', ['id', 'guild_id', 'channel_id', 'message_id', 'jeu', 'joueurs', 'etat', 'tour', 'expire_le', 'created_at']
      .every((c) => db.prepare('PRAGMA table_info(jeux_parties)').all().some((x) => x.name === c)));
  }

  console.warn = warnOrig;
  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})().catch((e) => { console.warn = warnOrig; console.error(e); console.log('\n0 réussis, 1 échoués'); process.exit(1); });

// La bonne réponse affichée est bien celle de la banque.
function reponsesOk(p, banque) {
  const q = banque[p.etat.q];
  return q.reponses[p.etat.ordre[p.etat.bonne]] === q.reponses[q.bonne];
}
