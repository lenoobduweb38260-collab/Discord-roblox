// 🔍 Revue contradictoire /lc, /mariage, dashboard — les défauts confirmés,
// un par un : tirage prévisible d'un jour à l'autre, « jusqu'à minuit » faux
// hors UTC, tirage limité au cache, pseudos illisibles dans l'image, date
// des alliances en UTC, salon ou rôle d'un AUTRE serveur accepté par l'API
// du dashboard, et brouillon du dashboard qui suivait d'un serveur à l'autre.
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'revue-lmc-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');
delete process.env.GIPHY_KEY;
delete process.env.TZ;

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  return vrai.apply(this, arguments);
};

const { getGuildConfig, db } = require('../src/database');
const IMG = require('../src/utils/imageAmour');
// Espions posés AVANT de charger /lc et /mariage : ils lisent ces fonctions
// au chargement. On voit ainsi ce que chaque commande demande à l'image.
const plans = [];
const vraiPlanAmour = IMG.planAmour;
const vraiPlanMariage = IMG.planMariage;
IMG.planAmour = (o) => { const p = vraiPlanAmour(o); plans.push(p); return p; };
IMG.planMariage = (o) => { const p = vraiPlanMariage(o); plans.push(p); return p; };
const LC = require('../src/commands/lc');
const MAR = require('../src/commands/mariage');
const API = require('../src/managedApi');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };
const warnOrig = console.warn;
console.warn = () => {};
const logOrig = console.log;

// Le réseau : aucun avatar ni GIF joignable (rendu avec les initiales). Les
// appels à l'API locale du bot, eux, passent.
const vraiFetch = global.fetch;
global.fetch = async (url, ...r) => (String(url).startsWith('http://127.0.0.1') ? vraiFetch(url, ...r) : { ok: false, status: 404 });

const personne = (id, nom, extra = {}) => ({
  id, username: nom.toLowerCase(), displayName: nom, globalName: nom, bot: false,
  displayAvatarURL: () => `https://cdn.test/${id}.png`, ...extra,
});
const membresDe = (users) => new Map(users.map((u) => [u.id, { id: u.id, user: u, displayName: u.displayName }]));

(async () => {
  console.log('\n1) /lc : le score du lendemain ne se devine plus');
  {
    // Graine fixe : le test ne dépend pas du hasard.
    let graine = 12345;
    const alea = () => { graine = (Math.imul(graine, 1103515245) + 12345) >>> 0; return graine; };
    const ecarts = new Map();
    let n = 0, somme = 0, tirages = 0, proches = 0;
    for (let d = 0; d < 2000; d++) {
      const a = `${100000000 + (alea() % 899999999)}${100000000 + (alea() % 899999999)}`;
      const b = `${100000000 + (alea() % 899999999)}${100000000 + (alea() % 899999999)}`;
      let avant = null;
      for (let j = 0; j < 60; j++) {
        const p = LC.pourcentageDuJour(a, b, new Date(Date.UTC(2026, 8, 1 + j, 12)));
        somme += p; tirages++;
        if (avant !== null) {
          const e = p - avant;
          ecarts.set(e, (ecarts.get(e) || 0) + 1);
          n++;
          if (Math.abs(e) <= 28) proches++;
        }
        avant = p;
      }
    }
    const [pire, nPire] = [...ecarts.entries()].sort((x, y) => y[1] - x[1])[0];
    V('aucun écart d\'un jour à l\'autre ne domine (≤ 5 % des cas)', nPire / n <= 0.05, `écart ${pire} : ${(100 * nPire / n).toFixed(1)} %`);
    V('les écarts sont variés (plus de 150 valeurs distinctes)', ecarts.size > 150, String(ecarts.size));
    V('… et pas cantonnés à ±28 (90 % avant le correctif)', proches / n < 0.65, `${(100 * proches / n).toFixed(1)} %`);
    V('la moyenne reste vers 50', Math.abs(somme / tirages - 50) < 1.5, (somme / tirages).toFixed(2));
    const jour = new Date('2026-10-19T10:00:00Z');
    const p = LC.pourcentageDuJour('398712345678901234', '712398765432109876', jour);
    V('toujours figé pour la journée (UTC), dans les deux sens', p >= 0 && p <= 100
      && LC.pourcentageDuJour('712398765432109876', '398712345678901234', new Date('2026-10-19T23:59:00Z')) === p
      && LC.pourcentageDuJour('398712345678901234', '712398765432109876', new Date('2026-10-19T00:00:00Z')) === p);
  }

  console.log('\n2) /lc : l\'heure réelle de la remise à zéro');
  {
    const fin = Date.UTC(2026, 9, 20) / 1000;
    V('fin du tirage = minuit UTC suivant', LC.finDuJour(new Date('2026-10-19T10:00:00Z')) === fin && LC.finDuJour(new Date('2026-10-19T23:59:59Z')) === fin);
    V('… y compris au changement d\'année', LC.finDuJour(new Date('2026-12-31T23:00:00Z')) === Date.UTC(2027, 0, 1) / 1000);
    const alice = personne('u1', 'Alice'), bob = personne('u2', 'Bob');
    const it = { guild: { id: 'GL', members: { cache: membresDe([alice, bob]) } } };
    const carte = await LC.carteLc(it, alice, bob, false, new Date('2026-10-19T22:30:00Z'));
    const desc = carte.embeds[0].data.description;
    V('la carte affiche l\'heure exacte, à l\'heure de chaque lecteur', desc.includes(`jusqu'à <t:${fin}:t>`), desc);
    V('… et ne promet plus « jusqu\'à minuit »', !/jusqu'à minuit/.test(desc));
  }

  console.log('\n3) /lc : le tirage couvre tout le serveur, pas seulement le cache');
  {
    const auteur = personne('a0', 'Auteur');
    const vus = [personne('x1', 'Xavier'), personne('y1', 'Yasmine')];
    const autres = Array.from({ length: 20 }, (_, k) => personne(`m${k}`, `Membre${k}`));
    const robot = { ...personne('b0', 'Robot'), bot: true };
    let appels = 0;
    const cache = membresDe([auteur, ...vus, robot]);
    const guild = {
      id: 'GH', memberCount: 24, members: {
        cache,
        async fetch() { appels++; for (const [id, m] of membresDe(autres)) cache.set(id, m); return cache; },
      },
    };
    const it = { guild, user: auteur };
    const sortis = new Set();
    for (let k = 0; k < 200; k++) sortis.add((await LC.membreAuHasard(it))?.id);
    V('cache incomplet (4 sur 24) → les membres sont chargés', appels === 1 && cache.size === 24, `appels ${appels}, cache ${cache.size}`);
    V('… une seule fois par serveur, pas à chaque /lc', appels === 1);
    V('… et le tirage sort des membres jamais vus depuis le démarrage', [...sortis].some((id) => /^m\d+$/.test(id)) && sortis.size > 10, [...sortis].join());
    V('… jamais l\'auteur ni un bot', !sortis.has('a0') && !sortis.has('b0'));

    let appelsComplet = 0;
    const complet = { id: 'GC', memberCount: 3, members: { cache: membresDe([auteur, ...vus]), async fetch() { appelsComplet++; } } };
    for (let k = 0; k < 5; k++) await LC.membreAuHasard({ guild: complet, user: auteur });
    V('cache complet → aucun chargement', appelsComplet === 0, String(appelsComplet));

    // Chargement trop lent : on n'attend pas plus de 1,2 s.
    const lent = { id: 'GS', memberCount: 900, members: { cache: membresDe([auteur, ...vus]), fetch: () => new Promise(() => {}) } };
    const t0 = Date.now();
    const tire = await LC.membreAuHasard({ guild: lent, user: auteur });
    const duree = Date.now() - t0;
    V('chargement trop lent → réponse en moins de 1,6 s avec le cache', duree < 1600 && ['x1', 'y1'].includes(tire?.id), `${duree} ms`);

    // Chargement refusé (intention absente…) : on pourra réessayer.
    let essais = 0;
    const refuse = { id: 'GR', memberCount: 900, members: { cache: membresDe([auteur, ...vus]), async fetch() { essais++; throw new Error('Missing intent'); } } };
    await LC.membreAuHasard({ guild: refuse, user: auteur });
    await LC.membreAuHasard({ guild: refuse, user: auteur });
    V('chargement en échec → nouvel essai au tirage suivant, sans planter', essais === 2, String(essais));
  }

  console.log('\n4) Image : les pseudos décorés, accentués ou cyrilliques restent lisibles');
  {
    const cas = [
      ['𝓐𝓵𝓲𝓬𝓮', 'ALICE'], ['Ａｌｉｃｅ', 'ALICE'], ['ⓐⓛⓘⓒⓔ', 'ALICE'], ['𝔸𝕝𝕚𝕔𝕖', 'ALICE'],
      ['Łukasz Żółć', 'LUKASZ ZOLC'], ['Øystein', 'OYSTEIN'], ['Æsir', 'AESIR'], ['Œuvre', 'OEUVRE'],
      ['Đorđe', 'DORDE'], ['Þór', 'THOR'], ['Straße', 'STRASSE'], ['Дмитрий', 'DMITRIY'],
      ['Юлия', 'YULIYA'], ['Émilie✨', 'EMILIE'],
    ];
    for (const [brut, attendu] of cas) V(`« ${brut} » → ${attendu}`, IMG.texteDessinable(brut) === attendu, IMG.texteDessinable(brut));
    V('un pseudo sans lettre latine possible reste vide (repli ensuite)', IMG.texteDessinable('日本語') === '');
    V('repli : nom affiché illisible → identifiant du compte', IMG.nomDessinable('日本語', { username: 'kenji_99' }) === 'kenji_99' && IMG.nomDessinable('Alice', { username: 'x' }) === 'Alice');

    plans.length = 0;
    const kenji = personne('k1', '日本語', { username: 'kenji' });
    const dima = personne('d1', 'Дмитрий');
    const it = { guild: { id: 'GL', members: { cache: membresDe([kenji, dima]) } } };
    await LC.carteLc(it, kenji, dima, false);
    const plan = plans.find((x) => x.type === 'amour');
    V('/lc : l\'image écrit l\'identifiant du compte, puis le cyrillique translittéré', plan?.avatars[0].nom === 'KENJI' && plan?.avatars[1].nom === 'DMITRIY', JSON.stringify(plan?.avatars?.map((a) => a.nom)));
    V('… la carte, elle, garde les vrais noms', (await LC.carteLc(it, kenji, dima, false)).embeds[0].data.description.includes('**日本語** 💞 **Дмитрий**'));
  }

  console.log('\n5) /mariage : la date de l\'image suit l\'heure de Paris');
  {
    V('22 h 30 UTC le 19 → 20.10.2026 (0 h 30 à Paris)', MAR.dateDuMariage('2026-10-19T22:30:00Z') === '20.10.2026', MAR.dateDuMariage('2026-10-19T22:30:00Z'));
    V('en hiver aussi : 23 h 30 UTC le 19/11 → 20.11.2026', MAR.dateDuMariage('2026-11-19T23:30:00Z') === '20.11.2026');
    V('… et 21 h UTC reste le 19', MAR.dateDuMariage('2026-10-19T21:00:00Z') === '19.10.2026');
    process.env.TZ = 'America/New_York';
    V('TZ défini → son fuseau', MAR.dateDuMariage('2026-10-19T22:30:00Z') === '19.10.2026');
    process.env.TZ = 'UTC0';
    V('TZ illisible pour Intl (format POSIX) → Paris, sans planter', MAR.dateDuMariage('2026-10-19T22:30:00Z') === '20.10.2026');
    delete process.env.TZ;

    plans.length = 0;
    const kenji = personne('k1', '日本語', { username: 'kenji' });
    const alice = personne('u1', 'Alice');
    const it = { guild: { id: 'GL', members: { cache: membresDe([kenji, alice]) } } };
    const carte = await MAR.carteMariage(it, kenji, alice, '2026-10-19T22:30:00Z');
    const plan = plans.find((x) => x.type === 'mariage');
    V('la carte part avec l\'image des alliances (sans clé GIPHY)', carte.files?.[0]?.name === 'mariage.png');
    V('… la date dessinée est celle de Paris, comme le <t:…:D> de la carte', plan?.texte?.contenu === '20.10.2026', plan?.texte?.contenu);
    V('… et un nom illisible laisse la place à l\'identifiant du compte', plan?.avatars[0].nom === 'KENJI' && plan?.avatars[1].nom === 'ALICE', JSON.stringify(plan?.avatars?.map((a) => a.nom)));
  }

  console.log('\n6) API du dashboard : un salon ou un rôle d\'un AUTRE serveur est refusé');
  {
    const CA = '100000000000000001', CB = '200000000000000001', KB = '200000000000000009';
    const RA = '100000000000000002', RB = '200000000000000002', RB2 = '200000000000000003';
    const salon = (id, type = 0) => ({
      id, type, name: `salon-${id.slice(-2)}`, isTextBased: () => type !== 4, isThread: () => false,
      permissionsFor: () => ({ has: () => true }), envois: [], async send(m) { this.envois.push(m); return { id: 'msg' }; },
    });
    const serveur = (id, salons, roles) => ({
      id, name: id, memberCount: 10,
      channels: { cache: new Map(salons.map((s) => [s.id, s])) },
      roles: { cache: new Map(roles.map((r) => [r, { id: r }])) },
      members: { me: { id: 'bot' } },
    });
    const GA = serveur('GA', [salon(CA)], [RA]);
    const GB = serveur('GB', [salon(CB), salon(KB, 4)], [RB, RB2]);
    const V2 = API.verifierReference;

    // La règle elle-même.
    V('salon d\'un autre serveur → refusé, message clair', /n'est pas un salon de ce serveur/.test(V2(GB, 'confession_channel_id', CA).erreur || ''), JSON.stringify(V2(GB, 'confession_channel_id', CA)));
    V('salon du serveur → accepté', V2(GB, 'confession_channel_id', CB).valeur === CB && !V2(GB, 'confession_channel_id', CB).erreur);
    V('null (retrait du réglage) → accepté', V2(GB, 'log_channel_id', null).valeur === null && !V2(GB, 'log_channel_id', null).erreur);
    V('rôle d\'un autre serveur → refusé', /n'est pas un rôle de ce serveur/.test(V2(GB, 'staff_role_id', RA).erreur || ''));
    V('rôle du serveur → accepté', V2(GB, 'verified_role_id', RB).valeur === RB);
    V('mention des notes : everyone/here acceptés, rôle étranger refusé', V2(GB, 'patch_mention', 'here').valeur === 'here' && Boolean(V2(GB, 'patch_mention', RA).erreur) && V2(GB, 'patch_mention', RB).valeur === RB);
    V('liste de rôles : un rôle étranger AJOUTÉ est refusé', Boolean(V2(GB, 'police_role_ids', JSON.stringify([RB, RA]), null).erreur));
    V('… un rôle supprimé déjà enregistré est retiré sans bloquer', V2(GB, 'police_role_ids', JSON.stringify([RB, '200000000000000077']), JSON.stringify(['200000000000000077'])).valeur === JSON.stringify([RB]));
    V('liste de catégories : catégorie étrangère refusée', /n'est pas une catégorie de ce serveur/.test(V2(GB, 'antispam_exempt_categories', JSON.stringify([CA])).erreur || ''));
    V('un objet à la place d\'un identifiant → refusé, message lisible', /^Le salon demandé n'est pas/.test(V2(GB, 'confession_channel_id', { a: 1 }).erreur || ''), V2(GB, 'confession_channel_id', { a: 1 }).erreur);

    // Aucune clé de salon, de catégorie ou de rôle n'échappe à la règle.
    const cles = Object.keys(API.CONFIG_KEYS);
    // Noms anglais ET français : comptage_role_erreur, mariage_salon_id, sao_salon_id…
    const visees = cles.filter((k) => /channel|categor|role|salon/.test(k) || k === 'patch_mention');
    const oubliees = visees.filter((k) => !API.genreReference(k));
    V(`toutes les clés de salon / rôle sont vérifiées (${visees.length})`, visees.length >= 25 && oubliees.length === 0, oubliees.join());
    V('… y compris les noms français (salon, rôle d\'erreur)', ['mariage_salon_id', 'sao_salon_id', 'comptage_role_erreur'].every((k) => visees.includes(k) && API.genreReference(k)));
    V('… et aucune autre (texte, couleur, image…)', cles.filter((k) => API.genreReference(k)).every((k) => visees.includes(k)) && !API.genreReference('embed_accent') && !API.genreReference('welcome_image'));
    V('… toutes de type identifiant ou liste d\'identifiants', visees.every((k) => ['s', 'j'].includes(API.CONFIG_KEYS[k])));

    // La vraie API locale, de bout en bout.
    const client = { isReady: () => true, guilds: { cache: new Map([['GA', GA], ['GB', GB]]) }, user: { id: 'bot', tag: 'Bot#0' } };
    console.log = () => {};
    API.startManagedApi(client, RACINE);
    const fichierPort = path.join(RACINE, 'api.port');
    for (let k = 0; k < 100 && !fs.existsSync(fichierPort); k++) await new Promise((r) => setTimeout(r, 20));
    console.log = logOrig;
    const port = fs.readFileSync(fichierPort, 'utf8');
    const post = async (route, body) => {
      const r = await fetch(`http://127.0.0.1:${port}/${route}`, { method: 'POST', body: JSON.stringify(body) });
      return { code: r.status, ...(await r.json()) };
    };
    let r = await post('config', { guildId: 'GB', key: 'confession_channel_id', value: CA });
    V('POST /config : salon du serveur A pour B → 400, rien enregistré', r.code === 400 && /salon/.test(r.error) && getGuildConfig('GB').confession_channel_id == null, JSON.stringify(r));
    r = await post('config', { guildId: 'GB', key: 'confession_channel_id', value: CB });
    V('POST /config : salon de B → enregistré', r.code === 200 && getGuildConfig('GB').confession_channel_id === CB, JSON.stringify(r));
    r = await post('config', { guildId: 'GB', key: 'confession_channel_id', value: null });
    V('POST /config : null → réglage retiré', r.code === 200 && getGuildConfig('GB').confession_channel_id == null, JSON.stringify(r));
    r = await post('config', { guildId: 'GB', key: 'log_channel_id', value: '' });
    V('POST /config : valeur vide → réglage retiré', r.code === 200 && getGuildConfig('GB').log_channel_id == null, JSON.stringify(r));
    r = await post('config', { guildId: 'GB', key: 'staff_role_id', value: RA });
    V('POST /config : rôle du serveur A pour B → 400', r.code === 400 && /rôle/.test(r.error), JSON.stringify(r));
    r = await post('config', { guildId: 'GB', key: 'police_role_ids', value: [RB, RA] });
    V('POST /config : liste de rôles avec un rôle étranger → 400', r.code === 400 && getGuildConfig('GB').police_role_ids == null, JSON.stringify(r));
    r = await post('config', { guildId: 'GB', key: 'police_role_ids', value: [RB, RB2] });
    V('POST /config : liste de rôles de B → enregistrée', r.code === 200 && getGuildConfig('GB').police_role_ids === JSON.stringify([RB, RB2]), JSON.stringify(r));
    r = await post('config', { guildId: 'GB', key: 'embed_accent', value: '#ff0000' });
    V('POST /config : les autres réglages ne changent pas', r.code === 200 && getGuildConfig('GB').embed_accent === '#ff0000', JSON.stringify(r));

    r = await post('tickets-type', { guildId: 'GB', label: 'Aide', categoryId: KB, supportRoleIds: [RB, RA] });
    V('POST /tickets-type : rôle support d\'un autre serveur → 400', r.code === 400 && /rôle/.test(r.error), JSON.stringify(r));
    r = await post('tickets-type', { guildId: 'GB', label: 'Aide', categoryId: KB, supportRoleIds: [RB] });
    const type = db.prepare("SELECT * FROM ticket_types WHERE guild_id = 'GB' AND label = 'Aide'").get();
    V('POST /tickets-type : rôle de B → type créé', r.code === 200 && type?.support_role_id === RB, JSON.stringify(r));
    r = await post('tickets-type', { guildId: 'GB', label: 'Sans rôle', categoryId: KB, supportRoleId: null });
    V('POST /tickets-type : sans rôle support → accepté', r.code === 200, JSON.stringify(r));

    const message = (bouton, option) => ({
      guildId: 'GB', channelId: CB, test: true, content: 'Choisis ton rôle',
      boutons: bouton ? [{ label: 'Rôle', role: bouton }] : [],
      selecteur: option ? [{ label: 'Option', role: option }] : [],
    });
    r = await post('message-envoyer', message(RA));
    V('POST /message-envoyer : bouton qui donne un rôle étranger → 400', r.code === 400 && /rôle qui n'existe pas sur ce serveur/.test(r.error), JSON.stringify(r));
    r = await post('message-envoyer', message(null, RA));
    V('POST /message-envoyer : option de menu au rôle étranger → 400', r.code === 400 && /rôle qui n'existe pas sur ce serveur/.test(r.error), JSON.stringify(r));
    r = await post('message-envoyer', message(RB, RB2));
    V('POST /message-envoyer : rôles de B → accepté', r.code === 200 && r.apercu === true, JSON.stringify(r));
  }

  console.log('\n7) Dashboard : le brouillon ne passe plus d\'un serveur à l\'autre');
  {
    const app = fs.readFileSync(path.join(__dirname, '..', 'site-php', 'assets', 'js', 'app.js'), 'utf8');
    V('plus aucun brouillon global (ui.brouillonModule)', !/ui\.brouillonModule/.test(app));
    V('le serveur sélectionné ne change que par choisirServeur()', (app.match(/ui\.selectedServerId = /g) || []).length === 1 && /function choisirServeur\(id\) \{[\s\S]{0,200}ui\.selectedServerId = id;/.test(app));
    const cas = (nom) => (app.match(new RegExp(`case "${nom}":[\\s\\S]*?break;`)) || [''])[0];
    V('« 📊 Stats » d\'un serveur : changement de serveur et brouillon oublié', /choisirServeur\(/.test(cas('open-server-stats')) && /oublierBrouillon\(\)/.test(cas('open-server-stats')));
    V('barre latérale : brouillon oublié au changement de module', /oublierBrouillon\(\)/.test(cas('nav-serveur')));
    V('enregistrement : le serveur est figé au départ', /const serveur = ui\.selectedServerId;/.test(app) && /api\("serveur\.config", \{ serveur, cle, valeur \}\)/.test(app) && /ui\.brouillons\[serveur\]/.test(app));

    // Les vraies fonctions du site, rejouées hors navigateur.
    const extraire = (nom) => {
      const debut = app.indexOf(`  function ${nom}(`);
      return debut < 0 ? '' : app.slice(debut, app.indexOf('\n  }\n', debut) + 4);
    };
    const code = ['cfgCourant', 'brouillonModule', 'oublierBrouillon', 'choisirServeur'].map(extraire).join('\n');
    const ui = { selectedServerId: 'A', brouillons: {}, pickerOuvert: null, pickerRecherche: '' };
    const configs = { A: { police_role_ids: '["RA0"]' }, B: { police_role_ids: '["RB0"]' }, C: {} };
    const memo = {};
    const f = new Function('ui', 'storage', 'srvParams', `${code}\nreturn { cfgCourant, brouillonModule, oublierBrouillon, choisirServeur };`)(
      ui, { setItem: (k, v) => { memo[k] = v; } }, () => ({ config: configs[ui.selectedServerId] })
    );
    f.brouillonModule().police_role_ids = '["RA0","RA1"]';
    ui.pickerOuvert = 'police_role_ids';
    V('sur A, le choix en cours s\'affiche', f.cfgCourant().police_role_ids === '["RA0","RA1"]');
    f.choisirServeur('B');
    V('passage à B : B affiche SES rôles, pas ceux choisis sur A', f.cfgCourant().police_role_ids === '["RB0"]', f.cfgCourant().police_role_ids);
    V('… le brouillon de A est oublié et le sélecteur refermé', !ui.brouillons.A && ui.pickerOuvert === null && memo['aincrad.server'] === 'B');
    f.brouillonModule().police_role_ids = '["RB0","RB1"]';
    ui.selectedServerId = 'C';   // un chemin qui oublierait choisirServeur()
    V('même sans choisirServeur(), un brouillon reste attaché à SON serveur', f.cfgCourant().police_role_ids === undefined && ui.brouillons.B.police_role_ids === '["RB0","RB1"]');
  }

  console.warn = warnOrig;
  console.log = logOrig;
  global.fetch = vraiFetch;
  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.warn = warnOrig; console.log = logOrig; console.error(e); console.log('\n0 réussis, 1 échoués'); process.exit(1); });
