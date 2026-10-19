// 🖥️ Tableau de bord — vague « XP, mini-jeux, comptage, mariage, SAO ».
//
// Tout ce que /config règle doit aussi se régler depuis le site :
//  1. chaque réglage des nouveaux modules est accepté par l'API du bot, avec
//     le bon type et des bornes ;
//  2. les valeurs invalides sont REFUSÉES (choix, date, liste de jeux, texte
//     trop long, salon ou rôle d'un autre serveur, rôle impossible à donner) ;
//  3. les effets de /config suivent (salon de comptage, courbe d'XP) ;
//  4. les listes des niveaux (récompenses, exclusions, multiplicateurs) se
//     gèrent de bout en bout, par HTTP, comme le fait le site ;
//  5. le site PHP relaie ces opérations par un chemin que l'agent laisse
//     passer, et les pages du site les affichent (fonctions rejouées hors
//     navigateur).
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-vague-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  return vrai.apply(this, arguments);
};

const { db, getGuildConfig, setGuildConfig } = require('../src/database');
// Les défauts du bot : la config d'un serveur qui n'a jamais rien réglé.
const DEFAULT_CONFIG = (() => { const c = { ...getGuildConfig('ZZ-defauts') }; delete c.guild_id; return c; })();
const API = require('../src/managedApi');
const L = require('../src/utils/levels');
const C = require('../src/utils/comptage');
const P = require('../src/utils/jeux/parties');
const G = require('../src/utils/saoGame');
const F = require('../src/utils/sao/formules');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };
const texte = (o) => JSON.stringify(o);
const logOrig = console.log;
const warnOrig = console.warn;
console.warn = () => {};

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ── Un faux serveur Discord, juste ce que l'API lit ────────────────────
class Coll extends Map {
  filter(f) { const m = new Coll(); for (const [k, v] of this) if (f(v, k)) m.set(k, v); return m; }
  find(f) { for (const v of this.values()) if (f(v)) return v; return undefined; }
}
const salon = (id, type = 0, nom = null) => ({
  id, type, name: nom || `salon-${id.slice(-2)}`,
  isTextBased: () => type !== 4, isThread: () => false,
  permissionsFor: () => ({ has: () => true }),
  envois: [],
  async send(m) { this.envois.push(m); return { id: `m${this.envois.length}` }; },
});
const role = (id, position, extra = {}) => ({ id, name: `role-${id.slice(-2)}`, position, managed: false, hexColor: '#123456', ...extra });
const membre = (id, admin = false) => ({
  id, user: { id, username: `u${id.slice(-2)}`, bot: false },
  permissions: { has: () => admin }, roles: { cache: new Coll() },
});

function serveur(id, salons, roles, membres = []) {
  const channels = new Coll(salons.map((s) => [s.id, s]));
  const g = {
    id, name: `Serveur ${id}`, memberCount: 42, ownerId: '900000000000000001',
    iconURL: () => null,
    channels: { cache: channels, async fetch(cid) { const s = channels.get(cid); if (!s) throw new Error('Unknown Channel'); return s; } },
    roles: { cache: new Coll(roles.map((r) => [r.id, r])) },
    members: {
      me: { id: 'bot', displayName: 'Bot', roles: { highest: { position: 10 } } },
      cache: new Coll(membres.map((m) => [m.id, m])),
      async fetch(mid) { const m = membres.find((x) => x.id === mid); if (!m) throw new Error('Unknown Member'); return m; },
    },
  };
  return g;
}

// Serveur A (étranger) et serveur B (celui qu'on configure).
const CA = '100000000000000001', RA = '100000000000000002';
const CB = '200000000000000001', CB2 = '200000000000000002', LOGB = '200000000000000003', KB = '200000000000000009';
const RB = '200000000000000011', RB_HAUT = '200000000000000012', RB_GERE = '200000000000000013', RB2 = '200000000000000014';
const ADMIN_B = '200000000000000021', SIMPLE_B = '200000000000000022';
const GA = serveur('GA', [salon(CA)], [role(RA, 1)]);
const GB = serveur('GB',
  [salon(CB, 0, 'general'), salon(CB2, 0, 'comptage'), salon(LOGB, 0, 'logs'), salon(KB, 4, 'Jeux')],
  [role(RB, 3), role(RB_HAUT, 12), role(RB_GERE, 2, { managed: true }), role(RB2, 4)],
  [membre(ADMIN_B, true), membre(SIMPLE_B, false)]);
const salonB = (id) => GB.channels.cache.get(id);

(async () => {
  // ══════════════════════════════════════════════════════════════════
  console.log('\n1) CONFIG_KEYS couvre TOUS les réglages des nouveaux modules');
  {
    const prefixes = /^(xp_|levels?_|jeux_|comptage_|mariage_|sao_)/;
    const cles = Object.keys(DEFAULT_CONFIG).filter((k) => prefixes.test(k));
    const absentes = cles.filter((k) => !(k in API.CONFIG_KEYS));
    V(`les ${cles.length} réglages (xp_, level_, jeux_, comptage_, mariage_, sao_) sont dans CONFIG_KEYS`, cles.length >= 50 && absentes.length === 0, absentes.join());
    const incoherents = cles.filter((k) => {
      const t = API.CONFIG_KEYS[k];
      const d = DEFAULT_CONFIG[k];
      if (t === 'b') return ![0, 1].includes(d);
      if (t === 'n') return !(d === null || Number.isInteger(d));
      if (t === 's' || t === 't') return !(d === null || typeof d === 'string');
      return true; // 'j' : aucune liste d'identifiants parmi ces réglages
    });
    V('… chaque type est cohérent avec son défaut (b = 0/1, n = entier, s/t = texte)', incoherents.length === 0, incoherents.join());
    const sansBornes = cles.filter((k) => API.CONFIG_KEYS[k] === 'n' && !API.NUM_LIMITS[k]);
    V('… chaque nombre a ses bornes (NUM_LIMITS)', sansBornes.length === 0, sansBornes.join());
    const horsBornes = cles.filter((k) => API.CONFIG_KEYS[k] === 'n' && DEFAULT_CONFIG[k] !== null
      && (DEFAULT_CONFIG[k] < API.NUM_LIMITS[k][0] || DEFAULT_CONFIG[k] > API.NUM_LIMITS[k][1]));
    V('… et chaque défaut est dans ses bornes', horsBornes.length === 0, horsBornes.join());
    // Les bornes rendues par les agents de chaque module (rapports d'étude).
    const attendues = {
      xp_text: [1, 1000], xp_text_min: [0, 1000], xp_text_max: [1, 1000], xp_cooldown: [5, 3600], xp_longueur_min: [0, 2000],
      xp_voice: [1, 1000], xp_mult_global: [0, 1000], xp_boost_pourcent: [0, 1000], xp_weekend_pourcent: [0, 1000],
      xp_sao_pourcent: [0, 1000], xp_niveau_max: [0, 1000], level_annonce_pas: [1, 100],
      jeux_xp_victoire: [0, 1000], jeux_xp_bot: [0, 1000], jeux_xp_plafond: [0, 10000], jeux_col_victoire: [0, 10000],
      comptage_xp: [0, 1000],
      mariage_bonus_xp: [0, 100], mariage_lune_de_miel_jours: [0, 60], mariage_bisou_xp: [0, 1000], mariage_actif_minutes: [1, 120],
      sao_raid_heures: [0, 168], sao_chasse_delai: [5, 300], sao_afk_heures: [1, 24], sao_mort_penalite: [0, 50],
    };
    const fausses = Object.entries(attendues).filter(([k, b]) => texte(API.NUM_LIMITS[k]) !== texte(b));
    V('… bornes identiques à celles de /config (25 nombres)', fausses.length === 0, fausses.map(([k]) => `${k}=${texte(API.NUM_LIMITS[k])}`).join());
    // Les bornes du bot lui-même, là où elles sont exportées.
    const BJ = P.BORNES_RECOMPENSES;
    V('… mini-jeux : mêmes bornes que reglagesJeux', Object.entries(BJ).every(([k, b]) => texte(API.NUM_LIMITS[k]) === texte([b.min, b.max])));
    const BC = require('../src/utils/couple').BORNES_COUPLE;
    V('… mariage : mêmes bornes que couple.js', texte(API.NUM_LIMITS.mariage_bonus_xp) === texte(BC.bonus) && texte(API.NUM_LIMITS.mariage_lune_de_miel_jours) === texte(BC.lune)
      && texte(API.NUM_LIMITS.mariage_bisou_xp) === texte(BC.bisouXp) && texte(API.NUM_LIMITS.mariage_actif_minutes) === texte(BC.actifMinutes));
    V('… comptage : XP bornée comme comptage.js', API.NUM_LIMITS.comptage_xp[1] === C.XP_MAX_COMPTAGE);

    V('types attendus : level_message texte long, level_rewards_stack bascule, xp_boost_fin chaîne',
      API.CONFIG_KEYS.level_message === 't' && API.CONFIG_KEYS.level_rewards_stack === 'b' && API.CONFIG_KEYS.xp_boost_fin === 's');
    V('choix : courbes = celles de levels.js', texte(API.CHOIX_REGLAGES.xp_courbe) === texte(Object.keys(L.COURBES_XP)));
    V('choix : difficultés = celles de l\'Aventure SAO', texte(API.CHOIX_REGLAGES.sao_difficulte) === texte(Object.keys(F.DIFFICULTES)));
    V('choix : modes d\'annonce = ceux que lit levels.js', API.CHOIX_REGLAGES.level_annonce.every((m) => L.modeAnnonceNiveau({ level_annonce: m }) === m)
      && API.CHOIX_REGLAGES.level_annonce.length === 4);

    // Les salons et rôles des nouveaux modules sont protégés.
    V('salon/rôle aux noms français couverts : mariage_salon_id, sao_salon_id, comptage_role_erreur',
      API.genreReference('mariage_salon_id') === 'salon' && API.genreReference('sao_salon_id') === 'salon' && API.genreReference('comptage_role_erreur') === 'role');
    V('… et tout « *_salon_id » futur', API.genreReference('demain_salon_id') === 'salon' && API.genreReference('demain_categorie_id') === 'categorie');
    V('… sans toucher à ce qui n\'est pas un salon ou un rôle', ['comptage_reactions', 'level_rewards_stack', 'jeux_desactives', 'xp_courbe', 'mariage_avantages', 'sao_difficulte'].every((k) => !API.genreReference(k)));
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n2) Formes contrôlées : choix, date, liste de jeux, image');
  {
    const N = API.normaliserReglageDashboard;
    V('courbe inconnue → refusée', Boolean(N('xp_courbe', 'exponentielle').erreur) && N('xp_courbe', 'raide').valeur === 'raide');
    V('mode d\'annonce inconnu → refusé, vide → automatique (null)', Boolean(N('level_annonce', 'partout').erreur) && N('level_annonce', null).valeur === null && N('level_annonce', 'mp').valeur === 'mp');
    V('difficulté SAO inconnue → refusée', Boolean(N('sao_difficulte', 'enfer').erreur) && N('sao_difficulte', 'heroique').valeur === 'heroique');
    V('date : « demain » refusée', /ISO 8601/.test(N('xp_boost_fin', 'demain').erreur || ''));
    V('date : 31 février refusée, 1999 refusée', Boolean(N('xp_boost_fin', '2026-02-31T10:00:00Z').erreur) && Boolean(N('xp_boost_fin', '1999-12-31T23:00:00Z').erreur));
    V('date : avec fuseau → ramenée en UTC ISO', N('xp_boost_fin', '2026-10-25T20:00:00+02:00').valeur === '2026-10-25T18:00:00.000Z', N('xp_boost_fin', '2026-10-25T20:00:00+02:00').valeur);
    V('date : vide → sans fin (null)', N('xp_boost_fin', '').valeur === null);
    V('jeux : clé inconnue → refusée, en citant les jeux possibles', /Jeu inconnu : « echecs »/.test(N('jeux_desactives', 'pendu,echecs').erreur || '') && /morpion/.test(N('jeux_desactives', 'echecs').erreur || ''));
    V('jeux : liste ou texte, doublons et espaces retirés, ordre du catalogue', N('jeux_desactives', ['quiz', 'pendu', 'quiz']).valeur === 'pendu,quiz' && N('jeux_desactives', ' quiz , morpion ').valeur === 'morpion,quiz');
    V('jeux : vide → tous ouverts (null)', N('jeux_desactives', ',').valeur === null && N('jeux_desactives', []).valeur === null);
    V('image : adresse http(s) seulement', Boolean(N('level_image_url', 'javascript:alert(1)').erreur) && N('level_image_url', 'https://x.test/a.png').valeur === 'https://x.test/a.png');
    V('les autres réglages passent tels quels', N('comptage_channel_id', CB).valeur === CB);
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n3) API locale de bout en bout (POST /config, GET /parametres, listes)');
  const users = new Coll([[SIMPLE_B, { id: SIMPLE_B, username: 'simple' }], ['300000000000000001', { id: '300000000000000001', username: 'resteici' }]]);
  const client = { isReady: () => true, guilds: { cache: new Coll([['GA', GA], ['GB', GB]]) }, user: { id: 'bot', tag: 'Bot#0', username: 'Bot' }, users: { cache: users } };
  for (const g of [GA, GB]) g.client = client;
  console.log = () => {};
  API.startManagedApi(client, RACINE);
  const fichierPort = path.join(RACINE, 'api.port');
  for (let k = 0; k < 100 && !fs.existsSync(fichierPort); k++) await new Promise((r) => setTimeout(r, 20));
  console.log = logOrig;
  const port = fs.readFileSync(fichierPort, 'utf8');
  const appel = async (methode, route, body) => {
    const r = await fetch(`http://127.0.0.1:${port}/${route}`, { method: methode, body: body ? JSON.stringify(body) : undefined });
    return { code: r.status, ...(await r.json()) };
  };
  const post = (route, body) => appel('POST', route, body);
  const config = (key, value, extra = {}) => post('config', { guildId: 'GB', key, value, ...extra });
  setGuildConfig('GB', 'log_channel_id', LOGB);
  const journaux = () => salonB(LOGB).envois.map((m) => m.embeds?.[0]?.data?.description || m.embeds?.[0]?.description || '').join('\n---\n');

  {
    // Énumérations, date, liste de jeux.
    let r = await config('xp_courbe', 'exponentielle');
    V('xp_courbe inconnue → 400, rien enregistré', r.code === 400 && getGuildConfig('GB').xp_courbe == null, texte(r));
    r = await config('level_annonce', 'partout');
    V('level_annonce inconnu → 400', r.code === 400, texte(r));
    r = await config('level_annonce', 'mp');
    V('level_annonce « mp » → enregistré', r.code === 200 && getGuildConfig('GB').level_annonce === 'mp', texte(r));
    r = await config('level_annonce', '');
    V('level_annonce vide → automatique (NULL)', r.code === 200 && getGuildConfig('GB').level_annonce === null, texte(r));
    r = await config('xp_boost_fin', 'samedi soir');
    V('xp_boost_fin illisible → 400', r.code === 400 && getGuildConfig('GB').xp_boost_fin === null, texte(r));
    r = await config('xp_boost_fin', '2026-10-25T20:00:00+02:00');
    V('xp_boost_fin ISO → enregistrée en UTC, renvoyée au site', r.code === 200 && getGuildConfig('GB').xp_boost_fin === '2026-10-25T18:00:00.000Z' && r.value === '2026-10-25T18:00:00.000Z', texte(r));
    r = await config('xp_boost_fin', null);
    V('xp_boost_fin vide → boost sans fin', r.code === 200 && getGuildConfig('GB').xp_boost_fin === null);
    r = await config('jeux_desactives', 'pendu,echecs');
    V('jeux_desactives avec un jeu inconnu → 400', r.code === 400 && getGuildConfig('GB').jeux_desactives === null, texte(r));
    r = await config('jeux_desactives', ['quiz', 'pendu']);
    V('jeux_desactives en liste → « pendu,quiz », lu par jeuOuvert', r.code === 200 && getGuildConfig('GB').jeux_desactives === 'pendu,quiz'
      && !P.jeuOuvert({ ...getGuildConfig('GB'), jeux_enabled: 1 }, 'quiz') && P.jeuOuvert({ ...getGuildConfig('GB'), jeux_enabled: 1 }, 'morpion'), texte(r));
    r = await config('sao_difficulte', 'enfer');
    V('sao_difficulte inconnue → 400', r.code === 400, texte(r));
    r = await config('sao_difficulte', 'heroique');
    V('sao_difficulte « heroique » → lue par l\'Aventure', r.code === 200 && G.reglagesSao('GB').difficulte === 'heroique', texte(r));

    // Textes : refusés au-delà de 1500 signes, jamais coupés.
    r = await config('level_message', 'x'.repeat(1501));
    V('level_message de 1501 signes → 400, rien de coupé ni d\'enregistré', r.code === 400 && /1501 signes, 1500 au plus/.test(r.error) && getGuildConfig('GB').level_message === null, texte(r).slice(0, 120));
    r = await config('level_message', '🎉 {membre} → niveau {niveau}');
    V('level_message normal → enregistré', r.code === 200 && getGuildConfig('GB').level_message === '🎉 {membre} → niveau {niveau}');

    // Nombres.
    r = await config('mariage_bonus_xp', 500);
    V('nombre au-delà de la borne → ramené à la borne (100 %)', r.code === 200 && getGuildConfig('GB').mariage_bonus_xp === 100 && r.value === 100, texte(r));
    r = await config('comptage_xp', -5);
    V('… et en dessous → 0', r.code === 200 && getGuildConfig('GB').comptage_xp === 0);
    r = await config('sao_raid_heures', 'souvent');
    V('nombre illisible → 400', r.code === 400, texte(r));
    r = await config('xp_text_min', 5);
    const r2 = await config('xp_text_min', '');
    V('xp_text_min : vidable (retour à l\'XP fixe)', r.code === 200 && r2.code === 200 && getGuildConfig('GB').xp_text_min === null, texte(r2));
    r = await config('jeux_xp_bot', '');
    V('… les autres nombres ne se vident pas', r.code === 400, texte(r));

    // Bascules.
    await config('level_rewards_stack', 1);
    r = await config('level_rewards_stack', '0');
    V('bascule « 0 » en texte → bien 0', r.code === 200 && getGuildConfig('GB').level_rewards_stack === 0, texte(r));
    r = await config('comptage_reactions', false);
    V('bascule false → 0', r.code === 200 && getGuildConfig('GB').comptage_reactions === 0);

    // Salons et rôles d'un autre serveur.
    r = await config('mariage_salon_id', CA);
    V('mariage_salon_id d\'un autre serveur → 400', r.code === 400 && /salon/.test(r.error) && getGuildConfig('GB').mariage_salon_id === null, texte(r));
    r = await config('sao_salon_id', CA);
    V('sao_salon_id d\'un autre serveur → 400', r.code === 400 && getGuildConfig('GB').sao_salon_id === null, texte(r));
    r = await config('sao_salon_id', CB);
    V('sao_salon_id de ce serveur → enregistré', r.code === 200 && getGuildConfig('GB').sao_salon_id === CB);
    r = await config('comptage_role_erreur', RA);
    V('comptage_role_erreur d\'un autre serveur → 400', r.code === 400 && /rôle/.test(r.error), texte(r));
    r = await config('comptage_role_erreur', RB_GERE);
    V('… géré par une intégration → 400', r.code === 400 && /intégration/.test(r.error), texte(r));
    r = await config('comptage_role_erreur', RB_HAUT);
    V('… au-dessus du rôle du bot → 400, et dit quoi faire', r.code === 400 && /au-dessus de mon rôle/.test(r.error) && /Remontez|remontez/.test(r.error), texte(r));
    r = await config('comptage_role_erreur', RB);
    V('… donnable → enregistré', r.code === 200 && getGuildConfig('GB').comptage_role_erreur === RB, texte(r));
    r = await config('comptage_role_erreur', null);
    V('… et retirable', r.code === 200 && getGuildConfig('GB').comptage_role_erreur === null);
  }

  console.log('\n4) Effets de bord : comme /config');
  {
    // Comptage : un compte en cours dans l'ancien salon.
    setGuildConfig('GB', 'comptage_channel_id', CB);
    C.changerSalonComptage('GB', CB);
    C.definirNombreComptage('GB', 42, CB);
    db.prepare("UPDATE comptage SET record = 57 WHERE guild_id = 'GB'").run();
    const avantLogs = salonB(LOGB).envois.length;
    let r = await config('comptage_channel_id', CB2, { acteur: ADMIN_B });
    const e = C.etatComptage('GB');
    V('nouveau salon de comptage → compte remis à 0 (changerSalonComptage)', r.code === 200 && e.channel_id === CB2 && Number(e.courant) === 0, texte(e));
    V('… record conservé', Number(e.record) === 57);
    V('… le nouveau salon est prévenu', salonB(CB2).envois.some((m) => (m.content || '').includes('Ce salon devient le salon de comptage')), texte(salonB(CB2).envois));
    V('… le site reçoit une note', /remis à 0/.test(r.note || ''), texte(r));
    V('… et le journal le dit, avec l\'auteur', salonB(LOGB).envois.length > avantLogs && /Salon de comptage → <#200000000000000002>/.test(journaux()) && new RegExp(`<@${ADMIN_B}>`).test(journaux()));
    C.definirNombreComptage('GB', 7, CB2);
    const envois = salonB(CB2).envois.length;
    r = await config('comptage_channel_id', CB2);
    V('même salon renvoyé → rien ne bouge (compte gardé, pas de nouvelle annonce)', r.code === 200 && Number(C.etatComptage('GB').courant) === 7 && salonB(CB2).envois.length === envois && !r.note);
    r = await config('comptage_channel_id', CA);
    V('salon de comptage étranger → 400, compte intact', r.code === 400 && C.etatComptage('GB').channel_id === CB2);

    // Courbe et niveau maximum : recalcul.
    db.prepare('INSERT OR REPLACE INTO levels (guild_id, user_id, text_xp, voice_xp, text_level, voice_level, xp, level, parti) VALUES (?, ?, 0, 0, 0, 0, ?, ?, 0)')
      .run('GB', '300000000000000001', 5000, L.levelFromXp(5000, 'mee6').level);
    const avant = L.getLevels('GB', '300000000000000001').level;
    r = await config('xp_courbe', 'lineaire', { acteur: ADMIN_B });
    const apres = L.getLevels('GB', '300000000000000001').level;
    V('courbe changée → niveaux recalculés (recalculerNiveaux)', r.code === 200 && apres === L.levelFromXp(5000, 'lineaire').level && apres !== avant, `${avant} → ${apres}`);
    V('… note pour le site et trace en base de la courbe appliquée', /recalculé/.test(r.note || '') && db.prepare("SELECT value FROM app_state WHERE key = 'xp_courbe:GB'").get()?.value === 'lineaire:0', texte(r));
    r = await config('xp_niveau_max', 3);
    V('niveau maximum → appliqué tout de suite', r.code === 200 && L.getLevels('GB', '300000000000000001').level === 3);
    r = await config('xp_niveau_max', 0);
    V('… et retiré tout de suite', r.code === 200 && L.getLevels('GB', '300000000000000001').level === apres);
  }

  console.log('\n5) GET /parametres et /dashboard');
  {
    const r = await appel('GET', 'parametres?guild=GB');
    V('/parametres répond', r.code === 200 && r.config?.guild_id === 'GB', texte(r).slice(0, 200));
    V('… les trois listes des niveaux', Array.isArray(r.recompensesNiveau) && Array.isArray(r.exclusionsXp) && Array.isArray(r.multiplicateursXp));
    V('… le catalogue d\'objets SAO et les types de récompense', Array.isArray(r.objetsSao) && r.objetsSao.length > 0 && r.objetsSao.length <= 25 && r.typesRecompense?.role && r.typesRecompense?.col?.sao === true);
    V('… les courbes et les limites', r.courbesXp?.mee6?.nom && r.limitesNiveaux?.niveau === 1000 && r.limitesNiveaux?.recompenses === 100);
    V('… l\'état du comptage (nombre, record, salon)', r.comptage?.courant === 7 && r.comptage?.record === 57 && r.comptage?.salon === CB2, texte(r.comptage));
    V('… le catalogue des neuf jeux', Array.isArray(r.jeux) && r.jeux.length === 9 && r.jeux.every((j) => j.cle && j.nom));
    V('… l\'Aventure SAO (joueurs, difficultés)', typeof r.sao?.joueurs === 'number' && r.sao?.difficultes?.heroique?.nom === 'Héroïque');
    V('… les rôles disent s\'ils sont donnables par le bot', r.roles.find((x) => x.id === RB)?.attribuable === true && r.roles.find((x) => x.id === RB_HAUT)?.attribuable === false
      && !r.roles.some((x) => x.id === RB_GERE));

    // Le top 5 ignore les membres partis.
    db.prepare('INSERT OR REPLACE INTO levels (guild_id, user_id, text_xp, voice_xp, text_level, voice_level, xp, level, parti) VALUES (?, ?, 0, 0, 0, 0, ?, 0, ?)')
      .run('GB', '300000000000000099', 999999, 1);
    const d = await appel('GET', 'dashboard?guild=GB');
    V('/dashboard : le top 5 ignore les membres partis', d.code === 200 && d.top.length >= 1 && d.top[0].user === 'resteici' && !d.top.some((t) => t.user === '300000000000000099'), texte(d.top));
  }

  console.log('\n6) Récompenses de niveau (POST / DELETE)');
  const REC = 'niveau-recompenses';
  {
    let r = await post(REC, { guildId: 'GB', niveau: 5, type: 'role', valeur: RA });
    V('rôle d\'un autre serveur → 400', r.code === 400 && /n'est pas un rôle de ce serveur/.test(r.error), texte(r));
    r = await post(REC, { guildId: 'GB', niveau: 5, type: 'role', valeur: RB_GERE });
    V('rôle géré par une intégration → 400', r.code === 400 && /intégration/.test(r.error), texte(r));
    r = await post(REC, { guildId: 'GB', niveau: 5, type: 'role_retrait', valeur: RB_HAUT });
    V('rôle au-dessus du bot → 400 (même pour un retrait)', r.code === 400 && /au-dessus de mon rôle/.test(r.error), texte(r));
    V('… rien n\'a été enregistré', L.listerRecompensesNiveau('GB').length === 0);
    const logs = salonB(LOGB).envois.length;
    r = await post(REC, { guildId: 'GB', niveau: '5', type: 'role', valeur: RB, acteur: ADMIN_B });
    const idRole = r.id;
    V('rôle donnable → ajouté, liste à jour dans la réponse', r.code === 200 && Number.isInteger(idRole) && r.recompensesNiveau.some((x) => x.id === idRole && x.roleId === RB && !x.souci), texte(r));
    V('… journalisé comme /config, avec l\'auteur', salonB(LOGB).envois.length === logs + 1 && /Niveau \*\*5\*\*/.test(journaux()) && new RegExp(`<@${ADMIN_B}> \\(tableau de bord\\)`).test(journaux()));
    r = await post(REC, { guildId: 'GB', niveau: 10, type: 'col', quantite: 500 });
    V('Col → ajouté', r.code === 200 && L.listerRecompensesNiveau('GB').some((x) => x.type === 'col' && x.quantite === 500), texte(r));
    r = await post(REC, { guildId: 'GB', niveau: 10, type: 'col', quantite: 0 });
    V('Col à 0 → 400 (message de levels.js)', r.code === 400 && /1 à 1 000 000/.test(r.error), texte(r));
    const objet = L.objetsSaoNiveau()[0];
    r = await post(REC, { guildId: 'GB', niveau: 10, type: 'objet', valeur: objet.cle, quantite: 2 });
    V('objet du catalogue → ajouté', r.code === 200 && L.listerRecompensesNiveau('GB').some((x) => x.type === 'objet' && x.valeur === objet.cle && x.quantite === 2), texte(r));
    r = await post(REC, { guildId: 'GB', niveau: 10, type: 'objet', valeur: 'epee_inexistante' });
    V('objet inconnu → 400', r.code === 400 && /ne fait pas partie/.test(r.error), texte(r));
    r = await post(REC, { guildId: 'GB', niveau: 15, type: 'mp', valeur: 'Bravo {membre} !' });
    V('message privé → ajouté', r.code === 200 && L.listerRecompensesNiveau('GB').some((x) => x.type === 'mp'), texte(r));
    r = await post(REC, { guildId: 'GB', niveau: 15, type: 'mp', valeur: 'y'.repeat(1501) });
    V('message privé trop long → 400', r.code === 400 && /1500/.test(r.error), texte(r));
    r = await post(REC, { guildId: 'GB', niveau: 0, type: 'col', quantite: 10 });
    V('niveau 0 → 400', r.code === 400 && /niveau va de 1 à 1000/.test(r.error), texte(r));
    r = await post(REC, { guildId: 'GB', niveau: 3, type: 'badge', valeur: 'x' });
    V('type inconnu → 400', r.code === 400 && /Type inconnu/.test(r.error), texte(r));
    r = await post(REC, { guildId: 'GZ', niveau: 3, type: 'col', quantite: 1 });
    V('serveur inconnu → 404', r.code === 404, texte(r));

    // Le rôle remonte au-dessus du bot APRÈS coup : le diagnostic le dit.
    GB.roles.cache.get(RB).position = 11;
    r = await appel('GET', 'parametres?guild=GB');
    V('diagnostic : un rôle devenu trop haut est signalé', /au-dessus du mien/.test(r.recompensesNiveau.find((x) => x.id === idRole)?.souci || ''), texte(r.recompensesNiveau));
    GB.roles.cache.get(RB).position = 3;

    r = await appel('DELETE', `${REC}?guild=GB&id=${idRole}`);
    V('DELETE ?guild=&id= → retirée, liste à jour', r.code === 200 && !r.recompensesNiveau.some((x) => x.id === idRole), texte(r));
    V('… journalisé (« ce qui a été donné reste acquis »)', /reste acquis/.test(journaux()));
    r = await appel('DELETE', `${REC}?guild=GB&id=${idRole}`);
    V('… une seconde fois → 404 qui dit pourquoi', r.code === 404 && /n'existe déjà plus/.test(r.error), texte(r));
    const idCol = L.listerRecompensesNiveau('GB').find((x) => x.type === 'col').id;
    r = await post(REC, { guildId: 'GB', op: 'retirer', id: idCol });
    V('POST { op: « retirer » } → retirée (chemin du site, l\'agent relaie le corps des POST)', r.code === 200 && !L.listerRecompensesNiveau('GB').some((x) => x.id === idCol), texte(r));
  }

  console.log('\n7) Exclusions et multiplicateurs d\'XP');
  {
    let r = await post('xp-exclusions', { guildId: 'GB', type: 'salon', cibleId: CA });
    V('exclusion d\'un salon étranger → 400', r.code === 400 && /salon/.test(r.error), texte(r));
    r = await post('xp-exclusions', { guildId: 'GB', type: 'role', cibleId: RA });
    V('exclusion d\'un rôle étranger → 400', r.code === 400 && /rôle/.test(r.error), texte(r));
    r = await post('xp-exclusions', { guildId: 'GB', type: 'categorie', cibleId: KB, portee: 'vocal' });
    V('catégorie → exclusion « salon » (elle couvre ses salons), portée gardée', r.code === 200 && r.exclusionsXp.some((x) => x.type === 'salon' && x.cible_id === KB && x.portee === 'vocal'), texte(r));
    V('… lue par estExcluXp pour un salon de la catégorie', L.estExcluXp('GB', 'voice', { salon: { id: '200000000000000555', parentId: KB } }) && !L.estExcluXp('GB', 'text', { salon: { id: '200000000000000555', parentId: KB } }));
    r = await post('xp-exclusions', { guildId: 'GB', type: 'role', cibleId: RB_GERE });
    V('rôle géré : exclusion permise (rien à donner)', r.code === 200, texte(r));
    r = await post('xp-exclusions', { guildId: 'GB', type: 'salon', cibleId: CB, portee: 'partout' });
    V('portée inconnue → 400', r.code === 400 && /Portée inconnue/.test(r.error), texte(r));
    r = await appel('DELETE', `xp-exclusions?guild=GB&type=salon&cible=${KB}`);
    V('DELETE ?type=&cible= → retirée', r.code === 200 && !r.exclusionsXp.some((x) => x.cible_id === KB), texte(r));
    r = await post('xp-exclusions', { guildId: 'GB', op: 'retirer', type: 'role', cibleId: RB_GERE });
    V('POST op « retirer » → retirée', r.code === 200 && r.exclusionsXp.length === 0, texte(r));
    r = await post('xp-exclusions', { guildId: 'GB', op: 'retirer', type: 'role', cibleId: RB_GERE });
    V('… déjà retirée → 404', r.code === 404, texte(r));
    // Un salon supprimé depuis reste retirable.
    L.ajouterExclusionXp('GB', 'salon', '200000000000000777', 'tout');
    r = await post('xp-exclusions', { guildId: 'GB', op: 'retirer', type: 'salon', cibleId: '200000000000000777' });
    V('un salon disparu du serveur reste retirable de la liste', r.code === 200 && !L.listerExclusionsXp('GB').length, texte(r));

    r = await post('xp-multiplicateurs', { guildId: 'GB', type: 'role', cibleId: RB2, pourcent: 150, acteur: ADMIN_B });
    V('multiplicateur de rôle → enregistré', r.code === 200 && r.multiplicateursXp.some((m) => m.type === 'role' && m.cible_id === RB2 && m.pourcent === 150), texte(r));
    V('… journalisé', /Multiplicateur <@&200000000000000014> : 150 %/.test(journaux()));
    r = await post('xp-multiplicateurs', { guildId: 'GB', type: 'role', cibleId: RB2, pourcent: 50 });
    V('… le même rôle : valeur remplacée', r.code === 200 && r.multiplicateursXp.filter((m) => m.cible_id === RB2).length === 1 && r.multiplicateursXp.find((m) => m.cible_id === RB2).pourcent === 50);
    r = await post('xp-multiplicateurs', { guildId: 'GB', type: 'salon', cibleId: CB, pourcent: 2000 });
    V('pourcentage hors bornes → 400', r.code === 400 && /0 à 1000/.test(r.error), texte(r));
    r = await post('xp-multiplicateurs', { guildId: 'GB', type: 'salon', cibleId: CB, pourcent: '' });
    V('pourcentage vide → 400 (pas « 0 % » par accident)', r.code === 400 && L.listerMultiplicateursXp('GB').length === 1, texte(r));
    r = await post('xp-multiplicateurs', { guildId: 'GB', type: 'salon', cibleId: CA, pourcent: 200 });
    V('salon étranger → 400', r.code === 400, texte(r));
    r = await post('xp-multiplicateurs', { guildId: 'GB', type: 'categorie', cibleId: KB, pourcent: 200 });
    V('catégorie → multiplicateur « salon »', r.code === 200 && r.multiplicateursXp.some((m) => m.type === 'salon' && m.cible_id === KB), texte(r));
    r = await appel('DELETE', `xp-multiplicateurs?guild=GB&type=salon&cible=${KB}`);
    V('DELETE → retiré', r.code === 200 && !r.multiplicateursXp.some((m) => m.cible_id === KB), texte(r));
    r = await appel('PUT', 'xp-multiplicateurs');
    V('méthode non prévue → route inconnue (404)', r.code === 404, texte(r));
  }

  console.log('\n8) Aventure SAO : réinitialisation protégée');
  {
    G.ensurePlayer('GB', SIMPLE_B);
    G.ensurePlayer('GB', ADMIN_B);
    let r = await post('sao-reinitialiser', { guildId: 'GB', cible: 'serveur', acteur: ADMIN_B });
    V('sans mot de confirmation → 400, rien d\'effacé', r.code === 400 && G.getPlayer('GB', SIMPLE_B), texte(r));
    r = await post('sao-reinitialiser', { guildId: 'GB', cible: 'serveur', acteur: SIMPLE_B, confirmation: 'REINITIALISER' });
    V('membre sans grade d\'administration → 403, rien d\'effacé', r.code === 403 && G.getPlayer('GB', SIMPLE_B), texte(r));
    r = await post('sao-reinitialiser', { guildId: 'GB', cible: 'serveur', acteur: '123', equipeSite: 'true', confirmation: 'REINITIALISER' });
    V('« equipeSite » non booléen ne suffit pas → 403', r.code === 403, texte(r));
    r = await post('sao-reinitialiser', { guildId: 'GB', cible: 'joueur', userId: SIMPLE_B, acteur: ADMIN_B, confirmation: 'REINITIALISER' });
    V('administrateur : un joueur → effacé, l\'autre gardé', r.code === 200 && r.existait === true && !G.getPlayer('GB', SIMPLE_B) && G.getPlayer('GB', ADMIN_B), texte(r));
    V('… journalisé', /Personnage SAO de <@200000000000000022> réinitialisé/.test(journaux()));
    r = await post('sao-reinitialiser', { guildId: 'GB', cible: 'joueur', userId: 'abc', acteur: ADMIN_B, confirmation: 'REINITIALISER' });
    V('identifiant de joueur invalide → 400', r.code === 400, texte(r));
    r = await post('sao-reinitialiser', { guildId: 'GB', cible: 'serveur', acteur: '', equipeSite: true, confirmation: 'REINITIALISER' });
    V('équipe du site : tout le serveur → effacé, compte rendu', r.code === 200 && r.joueurs === 1 && !G.getPlayer('GB', ADMIN_B), texte(r));
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n9) Site PHP et agent : le chemin des nouvelles opérations');
  {
    const api = lire('site-php/api.php');
    const barriere = api.indexOf("if ($action === 'server.module.save' && !admin_connecte())");
    const iListes = api.indexOf('$LISTES_NIVEAUX = [');
    const iSao = api.indexOf("if ($action === 'serveur.sao.reinitialiser')");
    V('actions serveur.niveaux.* et serveur.sao.reinitialiser AVANT la barrière d\'administration', iListes > 0 && iSao > 0 && barriere > iListes && barriere > iSao);
    const blocListes = api.slice(iListes, api.indexOf('\n}\n', iListes));
    V('… les trois listes relaient vers leurs routes', /'serveur\.niveaux\.recompense' => 'niveau-recompenses'/.test(blocListes)
      && /'serveur\.niveaux\.exclusion' => 'xp-exclusions'/.test(blocListes) && /'serveur\.niveaux\.multiplicateur' => 'xp-multiplicateurs'/.test(blocListes));
    V('… protégées par exiger_serveur, en POST JSON (op ajouter/retirer), auteur transmis',
      /exiger_serveur\(/.test(blocListes) && /agent_post_json\(/.test(blocListes) && /'op' => \$op/.test(blocListes) && /'acteur' => moi_id\(\)/.test(blocListes));
    const blocSao = api.slice(iSao, api.indexOf('\n}\n', iSao));
    V('réinitialisation SAO : équipe du site ou administration réelle du serveur, confirmation exigée',
      /exiger_serveur\(/.test(blocSao) && /est_staff\(\)/.test(blocSao) && /grade_discord_du_membre\(/.test(blocSao)
      && /'admin'/.test(blocSao) && /proprietaire/.test(blocSao) && /'REINITIALISER'/.test(blocSao) && /403\)/.test(blocSao));
    const blocConfig = api.slice(api.indexOf("if ($action === 'serveur.config')"), api.indexOf("if ($action === 'serveur.config')") + 1400);
    V('serveur.config : transmet l\'auteur et rend la note du bot', /'acteur' => moi_id\(\)/.test(blocConfig) && /'note' => \$data\['note'\] \?\? null/.test(blocConfig));
    try {
      const sortie = require('child_process').execFileSync('php', ['-l', path.join(__dirname, '..', 'site-php', 'api.php')], { encoding: 'utf8' });
      V('php -l api.php', /No syntax errors/.test(sortie), sortie);
    } catch (err) {
      if (err.code === 'ENOENT') console.log('  ⏭️ php absent : syntaxe PHP non vérifiée ici');
      else V('php -l api.php', false, String(err.stdout || err.message));
    }

    // L'agent ne se met pas à jour seul : ce qu'il relaie AUJOURD'HUI.
    const agent = lire('hebergeur/index.js');
    const proxy = agent.slice(agent.indexOf("if (action === 'proxy')"), agent.indexOf("return sendJson(res, 404", agent.indexOf("if (action === 'proxy')")));
    V('agent : tout chemin /proxy/<chemin> est relayé, requête comprise', /parts\.slice\(4\)\.join\('\/'\)/.test(proxy) && /url\.search/.test(proxy));
    V('agent : la méthode est relayée telle quelle', /method: req\.method/.test(proxy));
    V('agent : SEULS les POST et PUT gardent leur corps — d\'où POST + op côté site', /\['POST', 'PUT'\]\.includes\(req\.method\)/.test(proxy));
    V('le site n\'emploie que des POST pour ces opérations', !/agent_delete|CURLOPT_CUSTOMREQUEST => 'DELETE'/.test(api));
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n10) Tableau de bord : les pages, rejouées hors navigateur');
  {
    const app = lire('site-php/assets/js/app.js');
    V('aide fausse retirée (« Vide = annonce dans le salon où le membre écrit »)', !/Vide = annonce dans le salon où le membre écrit/.test(app));
    V('levels_enabled : défaut 1 PARTOUT', (app.match(/champBascule\("levels_enabled"[^\n]*\)/g) || []).length >= 2
      && (app.match(/champBascule\("levels_enabled"[^\n]*\)/g) || []).every((l) => /, 1\)$/.test(l)));
    V('nouveaux onglets déclarés, aiguillés et autorisés', ['jeux', 'comptage', 'mariage', 'sao'].every((m) => app.includes(`{ id: "${m}", label:`)
      && app.includes(`case "${m}": return `) && app.includes(`{ id: "mod.${m}", cat:`)));

    // Extraction des vraies fonctions du site.
    const fonction = (nom) => {
      const debut = app.indexOf(`\n  function ${nom}(`);
      const debutAsync = app.indexOf(`\n  async function ${nom}(`);
      const d = debut >= 0 ? debut : debutAsync;
      if (d < 0) throw new Error(`fonction ${nom} introuvable`);
      return app.slice(d, app.indexOf('\n  }\n', d) + 4);
    };
    const constante = (nom) => {
      const d = app.indexOf(`\n  const ${nom} = `);
      if (d < 0) throw new Error(`constante ${nom} introuvable`);
      const ligne = app.slice(d, app.indexOf('\n', d + 1));
      if (/[[{]$/.test(ligne.trim())) return app.slice(d, app.indexOf(/\[$/.test(ligne.trim()) ? '\n  ];' : '\n  };', d) + 5);
      return ligne;
    };
    const FONCTIONS = [
      'esc', 'formatNumber', 'cfgCourant', 'brouillonModule', 'oublierBrouillon', 'choixCourants', 'couleurRole',
      'champPicker', 'champSalon', 'champCategorie', 'champRole', 'champBascule', 'champTexte', 'aideBalises', 'champMention',
      'champChoix', 'champNombre', 'modulePanel', 'mdApercu', 'rubrique', 'isoVersLocal', 'localVersIso', 'champDate',
      'champAjout', 'choixAjout', 'aideVariablesNiveau', 'rendreModeleNiveau', 'texteAnnonceNiveauSite', 'apercuAnnonceNiveau',
      'levelsModule', 'nomCibleXp', 'libelleRecompenseSite', 'donneesRecompenseSite', 'panneauListe', 'listesNiveauxSite',
      'editeurRecompenses', 'editeurExclusions', 'editeurMultiplicateurs', 'listeNiveauxSite', 'basculerJeuCoupe',
      'champJeuxOuverts', 'jeuxModule', 'etatComptageSite', 'comptageModule', 'mariageModule', 'saoModule',
      'reinitialisationSaoSite', 'enregistrerModule', 'donneesModulesBot', 'overviewModule',
    ];
    const CONSTANTES = ['BALISES', 'MODES_ANNONCE_NIVEAU', 'COURBES_NIVEAU_REPLI', 'VARIABLES_NIVEAU', 'PORTEES_XP_SITE', 'GENRES_CIBLE_XP', 'facteurXp', 'DIFFICULTES_SAO_REPLI'];
    const code = [...CONSTANTES.map(constante), ...FONCTIONS.map(fonction)].join('\n');
    const ui = { selectedServerId: 'GB', brouillons: {}, pickerOuvert: null, pickerRecherche: '', monGrade: {}, srvParams: {} };
    const appels = [];
    const toasts = [];
    let reponseApi = () => ({ ok: true });
    const fenetre = { Balises: require('../src/utils/balises') };
    const S = new Function('ui', 'window', 'api', 'toast', 'render', 'selectedServer', 'estEquipeSite', 'button',
      `function srvParams() { return ui.srvParams[ui.selectedServerId] || null; }\n${code}\nreturn { ${[...FONCTIONS, ...CONSTANTES].join(', ')} };`)(
      ui, fenetre, async (action, payload) => { appels.push({ action, payload }); return reponseApi(action, payload); },
      (t, m, type) => toasts.push({ t, m, type }), () => {}, () => ({ id: 'GB', name: 'Serveur GB' }), () => false,
      (label, action, cls = '', extra = '') => `<button type="button" class="btn ${cls}" data-action="${action}" ${extra}>${label}</button>`,
    );

    // Les données, comme le site les reçoit du bot.
    const parametres = await appel('GET', 'parametres?guild=GB');
    L.ajouterRecompenseNiveau('GB', { niveau: 20, type: 'role', valeur: RB });
    L.ajouterRecompenseNiveau('GB', { niveau: 25, type: 'objet', valeur: L.objetsSaoNiveau()[0].cle, quantite: 3 });
    L.ajouterExclusionXp('GB', 'salon', KB, 'texte');
    const frais = await appel('GET', 'parametres?guild=GB');
    ui.srvParams.GB = {
      config: { ...frais.config }, roles: frais.roles, channels: frais.channels, categories: frais.categories,
      profilsBot: [], identiteBot: null, ...S.donneesModulesBot(frais),
    };
    V('donneesModulesBot : tout ce que rend /parametres est gardé', ui.srvParams.GB.recompensesNiveau.length === L.listerRecompensesNiveau('GB').length && [20, 25].every((n) => ui.srvParams.GB.recompensesNiveau.some((r) => r.niveau === n)) && ui.srvParams.GB.jeux.length === 9 && ui.srvParams.GB.comptage.record === 57 && parametres.code === 200);
    V('… et un bot ancien laisse des replis (listes « inconnues »)', S.donneesModulesBot({}).recompensesNiveau === null && Array.isArray(S.donneesModulesBot({}).objetsSao));

    const pages = { levels: S.levelsModule(), jeux: S.jeuxModule(), comptage: S.comptageModule(), mariage: S.mariageModule(), sao: S.saoModule(), overview: S.overviewModule({ members: 42 }) };
    const tout = Object.values(pages).join('\n');
    const formulaire = (html) => html.slice(html.indexOf('<form'), html.indexOf('</form>'));
    const clesDe = (html, attr) => [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))].map((m) => m[1]);

    // Chaque réglage des nouveaux modules a son champ sur le site.
    const prefixes = /^(xp_|levels?_|jeux_|comptage_|mariage_|sao_)/;
    const attendus = Object.keys(DEFAULT_CONFIG).filter((k) => prefixes.test(k));
    const formes = Object.values(pages).map(formulaire).join('\n');
    const presents = new Set([...clesDe(formes, 'data-cfg'), ...clesDe(formes, 'data-cfg-toggle'), ...clesDe(formes, 'data-picker')]);
    const manquants = attendus.filter((k) => !presents.has(k));
    V(`les ${attendus.length} réglages ont un champ dans le tableau de bord`, manquants.length === 0, manquants.join());
    const inconnus = [...presents].filter((k) => !(k in API.CONFIG_KEYS));
    V('… et aucun champ n\'envoie une clé que l\'API refuserait', inconnus.length === 0, inconnus.join());
    const pseudoDansForm = [...presents].filter((k) => k.startsWith('_'));
    V('… les champs de saisie des listes (« _niv_… », « _sao_… ») restent HORS des formulaires', pseudoDansForm.length === 0 && /data-picker="_niv_exc_cible"/.test(pages.levels) && /data-ajout="_niv_rec_niveau"/.test(pages.levels), pseudoDansForm.join());

    // Bornes et défauts affichés = ceux de l'API et du bot.
    const nombres = [...formes.matchAll(/min="(-?\d+)" max="(\d+)" data-cfg="([^"]+)" data-defaut="([^"]*)"/g)];
    const bornesFausses = nombres.filter(([, min, max, cle]) => API.NUM_LIMITS[cle] && texte([Number(min), Number(max)]) !== texte(API.NUM_LIMITS[cle])).map((m) => m[3]);
    V(`les ${nombres.length} champs nombre ont les bornes de l'API`, nombres.length >= 25 && bornesFausses.length === 0, bornesFausses.join());
    const defautsFaux = nombres.filter(([, , , cle, def]) => def !== '' && Number(def) !== DEFAULT_CONFIG[cle]).map((m) => m[3]);
    V('… et le défaut du bot', defautsFaux.length === 0, defautsFaux.join());
    const bascules = [...formes.matchAll(/data-cfg-toggle="([^"]+)" data-defaut="(\d)"/g)];
    const basculesFausses = bascules.filter(([, cle, def]) => cle in DEFAULT_CONFIG && prefixes.test(cle) && Number(def) !== DEFAULT_CONFIG[cle]).map((m) => m[1]);
    V('bascules : le défaut du bot (levels_enabled, level_mention, level_rewards_stack, comptage_reactions, mariage_avantages, sao_pvp, sao_afk = 1)',
      basculesFausses.length === 0 && ['levels_enabled', 'level_mention', 'level_rewards_stack', 'comptage_reactions', 'mariage_avantages', 'sao_pvp', 'sao_afk']
        .every((k) => bascules.some(([, c, d]) => c === k && d === '1')), basculesFausses.join());
    const choix = (cle) => [...formes.matchAll(new RegExp(`data-cfg="${cle}" data-defaut="[^"]*">([\\s\\S]*?)</select>`, 'g'))].map((m) => [...m[1].matchAll(/value="([^"]*)"/g)].map((v) => v[1]))[0] || [];
    V('menus : courbes, modes d\'annonce, difficultés = choix acceptés par l\'API',
      texte(choix('xp_courbe')) === texte(API.CHOIX_REGLAGES.xp_courbe) && texte(choix('level_annonce').filter(Boolean)) === texte(API.CHOIX_REGLAGES.level_annonce)
      && texte(choix('sao_difficulte')) === texte(API.CHOIX_REGLAGES.sao_difficulte), `${choix('xp_courbe')} | ${choix('level_annonce')} | ${choix('sao_difficulte')}`);

    // Niveaux : les listes.
    V('récompenses : chaque palier, son libellé, et le problème du diagnostic', /Niveau 20/.test(pages.levels) && /🎭 Donne @role-11/.test(pages.levels) && /🎁 3 × /.test(pages.levels));
    V('exclusions : la catégorie et sa portée', /🗂️ Jeux/.test(pages.levels) && /Les messages seulement/.test(pages.levels));
    V('multiplicateurs : rôle, pourcentage et facteur', /@role-14/.test(pages.levels) && /50 % <span>\(×0,5\)/.test(pages.levels));
    V('chaque ligne a son bouton de retrait', /data-action="niv-rec-suppr" data-id="\d+"/.test(pages.levels) && /data-action="niv-exc-suppr" data-type="salon" data-cible="200000000000000009"/.test(pages.levels)
      && /data-action="niv-mul-suppr" data-type="role" data-cible="200000000000000014"/.test(pages.levels));
    GB.roles.cache.get(RB).position = 11;
    ui.srvParams.GB.recompensesNiveau = (await appel('GET', 'parametres?guild=GB')).recompensesNiveau;
    V('un problème du diagnostic s\'affiche sur sa ligne', /chip alerte">⚠️ ce rôle est au-dessus du mien/.test(S.levelsModule()));
    GB.roles.cache.get(RB).position = 3;

    // Le champ de valeur suit le type de récompense.
    const b = ui.brouillons.GB = {};
    b._niv_rec_type = 'col';
    V('type « Col » → montant', /data-ajout="_niv_rec_quantite"/.test(S.levelsModule()) && !/data-picker="_niv_rec_role"/.test(S.levelsModule()));
    b._niv_rec_type = 'objet';
    V('type « objet » → menu du catalogue SAO + quantité', /data-ajout="_niv_rec_objet"/.test(S.levelsModule()) && new RegExp(L.objetsSaoNiveau()[1].cle).test(S.levelsModule()));
    V('… avec l\'avertissement si l\'Aventure SAO est coupée', /L'Aventure SAO est coupée/.test(S.levelsModule()));
    b._niv_rec_type = 'mp';
    V('type « message privé » → zone de texte de 1500 signes', /<textarea class="textarea" rows="3" maxlength="1500" data-ajout="_niv_rec_texte"/.test(S.levelsModule()));
    b._niv_rec_type = 'role';
    V('type « rôle » → sélecteur de rôle', /data-picker="_niv_rec_role"/.test(S.levelsModule()));
    b._niv_exc_genre = 'categorie';
    V('exclusion d\'une catégorie → sélecteur de catégories', /data-picker="_niv_exc_cible"/.test(S.levelsModule()) && /🗂️ Jeux/.test(S.editeurExclusions(ui.srvParams.GB)));

    // Ce que l'ajout envoie.
    V('donneesRecompenseSite : rôle', texte(S.donneesRecompenseSite({ _niv_rec_type: 'role', _niv_rec_niveau: ' 7 ', _niv_rec_role: RB }, ui.srvParams.GB)) === texte({ op: 'ajouter', niveau: '7', type: 'role', valeur: RB }));
    V('… objet sans choix explicite = le premier du menu affiché', S.donneesRecompenseSite({ _niv_rec_type: 'objet', _niv_rec_niveau: '7' }, ui.srvParams.GB).valeur === L.objetsSaoNiveau()[0].cle);

    // De bout en bout : le site appelle le PHP, la réponse du bot remplace la liste.
    reponseApi = (action, payload) => ({ ok: true, recompensesNiveau: [{ id: 99, niveau: Number(payload.niveau), type: 'col', quantite: 5 }] });
    b._niv_rec_quantite = '5';
    await S.listeNiveauxSite('recompense', { op: 'ajouter', niveau: '30', type: 'col', quantite: '5' }, ['_niv_rec_quantite']);
    V('listeNiveauxSite : action serveur.niveaux.recompense pour CE serveur', appels.at(-1).action === 'serveur.niveaux.recompense' && appels.at(-1).payload.serveur === 'GB');
    V('… la liste affichée est celle rendue par le bot, la saisie est vidée', ui.srvParams.GB.recompensesNiveau.length === 1 && ui.srvParams.GB.recompensesNiveau[0].id === 99 && !('_niv_rec_quantite' in b));

    // Mini-jeux : cases à cocher.
    V('mini-jeux : une case par jeu, cochée = ouvert', (pages.jeux.match(/data-jeu-ouvert="/g) || []).length === 9
      && /class="toggle " data-jeu-ouvert="pendu"/.test(pages.jeux) && /class="toggle on" data-jeu-ouvert="morpion"/.test(pages.jeux));
    const cat = ui.srvParams.GB.jeux;
    V('basculerJeuCoupe : décocher puis recocher, ordre du catalogue', S.basculerJeuCoupe('quiz', 'pendu', cat) === 'pendu,quiz' && S.basculerJeuCoupe('pendu,quiz', 'pendu', cat) === 'quiz' && S.basculerJeuCoupe('', 'morpion', cat) === 'morpion');
    V('… le résultat est accepté tel quel par l\'API', API.normaliserReglageDashboard('jeux_desactives', S.basculerJeuCoupe('quiz', 'morpion', cat)).valeur === 'morpion,quiz');

    // Comptage : l'état actuel.
    V('comptage : nombre actuel, prochain, record', /<strong>7<\/strong><em>le prochain est 8/.test(pages.comptage) && /<strong>57<\/strong>/.test(pages.comptage));

    // Annonce de niveau : aperçu fidèle au bot.
    const cfgAnnonce = { level_message: '&& Bravo\n{membre} passe {niveau} sur {serveur} {inconnue}', level_mention: 0 };
    const rendu = S.texteAnnonceNiveauSite(cfgAnnonce, 'Mon serveur');
    V('aperçu : balises puis variables, comme rendreMessageNiveau', /◆ \*\*Bravo\*\*/.test(rendu) && /\*\*Membre\*\* passe 5 sur Mon serveur \{inconnue\}/.test(rendu), rendu);
    V('… et les récompenses ajoutées quand le modèle ne les cite pas', /Récompenses débloquées/.test(rendu));
    const vars = { membre: '<@1>', pseudo: 'A&&B', niveau: '5', ancien_niveau: '4', xp: '1', rang: '1', recompenses: 'r', serveur: 's' };
    V('… même texte que le bot (rendreMessageNiveau)', S.rendreModeleNiveau('&> {pseudo} {user} {level}', vars, fenetre.Balises) === L.rendreMessageNiveau('&> {pseudo} {user} {level}', vars));
    V('… un aperçu dit quand aucune annonce ne partira', /aucune annonce ne part/.test(S.apercuAnnonceNiveau({ level_annonce: 'off' })) && !/aucune annonce ne part/.test(S.apercuAnnonceNiveau({ level_annonce: 'mp' })));

    // Date : saisie locale ↔ ISO.
    const iso = S.localVersIso('2026-10-25T20:00');
    V('date : saisie locale → ISO lisible par l\'API, et retour à l\'identique', /Z$/.test(iso) && S.isoVersLocal(iso) === '2026-10-25T20:00' && !API.normaliserReglageDashboard('xp_boost_fin', iso).erreur);

    // SAO : la réinitialisation se montre, grisée sans le grade.
    V('SAO : réinitialisation hors du formulaire, deux boutons', /data-action="sao-reinit-joueur"/.test(pages.sao) && /data-action="sao-reinit-serveur"/.test(pages.sao) && !/sao-reinit/.test(formulaire(pages.sao)));
    ui.monGrade.GB = { grade: 'staff' };
    V('… grisée pour un staff (le PHP et le bot refusent de toute façon)', /data-action="sao-reinit-serveur" disabled/.test(S.saoModule()));
    ui.monGrade.GB = { grade: 'admin' };
    V('… active pour l\'administration', !/data-action="sao-reinit-serveur" disabled/.test(S.saoModule()));

    // Enregistrement : un défaut jamais touché ne part pas ; la valeur du bot revient.
    const champ = (cle, value, defaut) => ({ dataset: { cfg: cle, ...(defaut !== undefined ? { defaut } : {}) }, value, multiple: false });
    const p = ui.srvParams.GB;
    p.config = { guild_id: 'GB', xp_courbe: null, xp_cooldown: null, jeux_desactives: null, levels_enabled: null };
    const form = {
      querySelectorAll: (sel) => ({
        '[data-cfg]': [champ('xp_courbe', 'mee6', 'mee6'), champ('xp_cooldown', '60', '60'), champ('jeux_desactives', 'quiz,pendu')],
        '[data-cfg-toggle]': [{ dataset: { cfgToggle: 'levels_enabled', defaut: '1' }, classList: { contains: () => true } }],
        '[data-picker]': [],
      }[sel] || []),
    };
    appels.length = 0;
    reponseApi = (action, payload) => ({ ok: true, valeur: payload.cle === 'jeux_desactives' ? 'pendu,quiz' : payload.valeur });
    await S.enregistrerModule(form);
    V('enregistrerModule : les défauts affichés et jamais touchés ne partent pas', appels.length === 1 && appels[0].payload.cle === 'jeux_desactives', texte(appels));
    V('… la valeur RÉELLEMENT enregistrée par le bot est retenue', p.config.jeux_desactives === 'pendu,quiz');
    reponseApi = () => ({ ok: true, valeur: 'lineaire', note: '12 niveau(x) recalculé(s).' });
    form.querySelectorAll = (sel) => ({ '[data-cfg]': [champ('xp_courbe', 'lineaire', 'mee6')] }[sel] || []);
    await S.enregistrerModule(form);
    V('… la note du bot (niveaux recalculés) est montrée', /12 niveau\(x\) recalculé/.test(toasts.at(-1)?.m || ''), texte(toasts.at(-1)));
  }

  console.warn = warnOrig;
  console.log = logOrig;
  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.warn = warnOrig; console.log = logOrig; console.error(e); console.log('\n0 réussis, 1 échoués'); process.exit(1); });
