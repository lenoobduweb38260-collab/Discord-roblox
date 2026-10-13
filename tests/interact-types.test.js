// 🏳️‍🌈 /interact : type de GIF (hétéro, lesbienne, gay, catgirl, catboy,
// femboy), préférence par membre, Gifukai sans clé, GIPHY à clé, réserve.
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'interact-types-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');
delete process.env.GIPHY_KEY;

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  return vrai.apply(this, arguments);
};

const { db } = require('../src/database');
const I = require('../src/commands/interact');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };
const silence = () => {}; // les avertissements de repli sont attendus ici
const warnOrig = console.warn;

// ----- Faux réseau : Gifukai, GIPHY, nekos.best -----
const etat = { gifukai: 'ok', giphy: 'ok', giphyNombre: 2, nekos: ['https://nekos.best/kiss.gif'], nekosIndex: 0, waifu: null };
const appels = [];
const vraiFetch = global.fetch;
global.fetch = async (url) => {
  const u = String(url);
  appels.push(u);
  if (u.includes('api.gifukai.com')) {
    if (etat.gifukai === 'panne') return { ok: false, status: 503 };
    if (etat.gifukai === 'vide') return { ok: false, status: 404 };
    return { ok: true, json: async () => ({ url: 'https://cdn.gifukai.com/ff-kiss.gif', anime: 'Bloom Into You' }) };
  }
  if (u.includes('api.giphy.com')) {
    if (etat.giphy === 'panne') return { ok: false, status: 500 };
    if (etat.giphy === 'quota') return { ok: false, status: 429 };
    if (etat.giphy === 'vide' || (etat.giphy === 'vide-pg' && u.includes('rating=pg&'))) return { ok: true, json: async () => ({ data: [] }) };
    const data = [];
    for (let k = 0; k < etat.giphyNombre; k++) {
      data.push(k % 2 ? { images: { downsized: { url: `https://media.giphy.com/d${k}.gif` } } } : { images: { original: { url: `https://media.giphy.com/o${k}.gif` } } });
    }
    return { ok: true, json: async () => ({ data }) };
  }
  if (u.includes('nekos.best')) {
    const url = etat.nekos[etat.nekosIndex++ % etat.nekos.length];
    return { ok: true, json: async () => ({ results: [{ url, anime_name: 'Toradora' }] }) };
  }
  if (u.includes('api.waifu.pics') && etat.waifu) {
    return { ok: true, json: async () => ({ url: etat.waifu }) };
  }
  return { ok: false, status: 404 };
};
const derniersAppels = (filtre) => appels.filter((u) => u.includes(filtre));
const vider = () => { appels.length = 0; };
const enReserve = (prefixe) => db.prepare('SELECT COUNT(*) AS n FROM gif_cache WHERE categorie LIKE ?').get(prefixe + '%').n;

// ----- Fausse interaction -----
function fausse({ sub = 'kiss', strings = {}, user = 'u1', target = 'u2', locale = 'fr', customId } = {}) {
  const personne = (id, nom) => ({ id, username: nom, displayName: nom, bot: false, send: async () => null });
  const it = {
    locale, deferred: false, replied: false, customId,
    user: personne(user, 'Alice'),
    client: { user: { id: 'bot' }, users: { fetch: async (id) => personne(id, 'Bob') } },
    guild: null,
    guildId: null,
    inGuild: () => false,
    message: { components: [], embeds: [{}], flags: 0 },
    options: {
      getSubcommand: () => sub,
      getUser: () => personne(target, 'Bob'),
      getString: (n) => (strings[n] === undefined ? null : strings[n]),
    },
    reply: async function (p) { this.replied = true; this.reponses.push(p); return p; },
    deferReply: async function () { this.deferred = true; },
    editReply: async function (p) { this.reponses.push(p); return p; },
    followUp: async function (p) { this.suivis.push(p); return p; },
    update: async function (p) { this.replied = true; this.mises.push(p); return p; },
    deferUpdate: async function () {},
    reponses: [], suivis: [], mises: [],
  };
  return it;
}
const texte = (o) => JSON.stringify(o);

(async () => {
  console.warn = silence;

  console.log('\n1) Les types, leurs requêtes et ce qui exige une clé');
  {
    V('six types, hétéro par défaut sans source typée', Object.keys(I.TYPES_GIF).length === 6 && I.TYPES_GIF.hetero === null);
    V('lesbienne = couple fille → fille chez Gifukai', I.TYPES_GIF.lesbienne.pairing === 'ff');
    V('gay = couple garçon → garçon chez Gifukai', I.TYPES_GIF.gay.pairing === 'mm');
    V('requête GIPHY : anime yuri kiss', I.requeteGif('kiss', 'lesbienne') === 'anime yuri kiss', I.requeteGif('kiss', 'lesbienne'));
    V('requête GIPHY : bisou sur la joue → cheek kiss', I.requeteGif('peck', 'catgirl') === 'anime catgirl cheek kiss');
    V('catgirl / catboy / femboy exigent une clé', I.typeExigeCle('catgirl') && I.typeExigeCle('catboy') && I.typeExigeCle('femboy'));
    V('lesbienne, gay et hétéro n\'en exigent pas', !I.typeExigeCle('lesbienne') && !I.typeExigeCle('gay') && !I.typeExigeCle('hetero'));
    V('les choix de l\'option couvrent les six types', I.CHOIX_TYPE.map((c) => c.value).join() === 'hetero,lesbienne,gay,catgirl,catboy,femboy');
  }

  console.log('\n2) Sans clé : Gifukai sert lesbienne et gay');
  {
    vider();
    const g = await I.fetchGifTypee('kiss', 'lesbienne');
    V('GIF reçu avec son anime', g?.url === 'https://cdn.gifukai.com/ff-kiss.gif' && g.anime === 'Bloom Into You' && g.source === 'gifukai', texte(g));
    V('appel /v1/kiss?pairing=ff', derniersAppels('gifukai')[0]?.endsWith('/v1/kiss?pairing=ff'), appels.join(' '));
    V('aucun appel GIPHY sans clé', derniersAppels('giphy').length === 0);
    V('mis en réserve sous kiss@lesbienne@gifukai', enReserve('kiss@lesbienne@gifukai') === 1);
    vider();
    await I.fetchGifTypee('peck', 'gay');
    V('bisou sur la joue → /v1/kiss?type=cheek&pairing=mm', derniersAppels('gifukai')[0]?.endsWith('/v1/kiss?type=cheek&pairing=mm'), appels.join(' '));
    V('hétéro → null (sources classiques)', (await I.fetchGifTypee('kiss', 'hetero')) === null);
  }

  console.log('\n3) Sans clé : un type à clé le dit, sans appel réseau');
  {
    vider();
    const g = await I.fetchGifTypee('hug', 'catgirl');
    V('{ sansCle } pour catgirl', g?.sansCle === true, texte(g));
    V('aucun appel réseau', appels.length === 0, appels.join(' '));
    const h = await I.fetchGifTypee('lick', 'gay');
    V('{ sansCle } pour une action que Gifukai ne connaît pas', h?.sansCle === true, texte(h));
    etat.gifukai = 'panne';
    vider();
    const r = await I.fetchGifTypee('kiss', 'lesbienne');
    V('Gifukai en panne → GIF repris de la réserve', r?.reserve === true && r.source === 'gifukai' && r.url.includes('gifukai'), texte(r));
    etat.gifukai = 'ok';
  }

  console.log('\n4) Avec une clé : GIPHY, filtre pg puis pg-13, réserve');
  {
    process.env.GIPHY_KEY = 'cle-test';
    vider();
    const g = await I.fetchGifTypee('hug', 'catgirl');
    V('GIF GIPHY reçu', g?.url?.startsWith('https://media.giphy.com/') && g.source === 'giphy', texte(g));
    const u = derniersAppels('giphy')[0] || '';
    V('recherche anime catgirl hug, 50 résultats, filtre pg', u.includes('q=anime%20catgirl%20hug') && u.includes('limit=50') && u.includes('rating=pg&') && u.includes('api_key=cle-test'), u);
    V('tous les résultats mis en réserve', enReserve('hug@catgirl@giphy') === 2, String(enReserve('hug@catgirl@giphy')));

    etat.giphy = 'vide-pg';
    vider();
    const g2 = await I.fetchGifTypee('kiss', 'femboy');
    V('pg vide → second essai en pg-13', derniersAppels('giphy').length === 2 && derniersAppels('giphy')[1].includes('rating=pg-13') && g2?.source === 'giphy', appels.join(' '));

    etat.giphy = 'ok';
    etat.giphyNombre = 12;
    vider();
    await I.fetchGifTypee('pat', 'catboy');
    await I.fetchGifTypee('pat', 'catboy');
    V('réserve garnie → un seul appel pour deux envois', derniersAppels('giphy').length === 1, String(derniersAppels('giphy').length));
    V('réserve plafonnée à 12 entrées', enReserve('pat@catboy@giphy') === 12);

    etat.giphy = 'quota';
    vider();
    const g3 = await I.fetchGifTypee('kiss', 'femboy');
    V('quota épuisé (429) → un seul appel, puis la réserve', derniersAppels('giphy').length === 1 && g3?.reserve === true && g3.source === 'giphy', texte(g3) + ' ' + appels.join(' '));
    const g4 = await I.fetchGifTypee('kill', 'femboy');
    V('{ introuvable } quand tout échoue et que la réserve est vide', g4?.introuvable === true, texte(g4));

    etat.giphy = 'ok';
    etat.gifukai = 'vide';
    vider();
    const g5 = await I.fetchGifTypee('kiss', 'gay');
    V('Gifukai sans résultat → GIPHY en secours (anime yaoi kiss)', g5?.source === 'giphy' && derniersAppels('giphy')[0]?.includes('q=anime%20yaoi%20kiss'), texte(g5));
    etat.gifukai = 'ok';
    delete process.env.GIPHY_KEY;
  }

  console.log('\n5) Préférence par membre');
  {
    V('inconnu → hétéro', I.prefs.de('inconnu') === 'hetero');
    I.prefs.poser('u1', 'catboy');
    V('posée puis relue', I.prefs.de('u1') === 'catboy');
    I.prefs.poser('u1', 'lesbienne');
    V('remplacée (upsert)', I.prefs.de('u1') === 'lesbienne');
    I.prefs.poser('u9', 'n-importe-quoi');
    V('type inconnu → hétéro', I.prefs.de('u9') === 'hetero');
    I.prefs.effacer('u1');
    V('effacée → hétéro', I.prefs.de('u1') === 'hetero');
  }

  console.log('\n6) La commande : option type partout, sous-commande preference, boutons');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'interact.js'), 'utf8');
    V('option type sur les 8 actions', (src.match(/\.addStringOption\(optionType\)/g) || []).length === 8);
    V('sous-commande preference', src.includes(".setName('preference')"));
    V('plus aucune trace de l\'API Tenor (fermée)', !src.includes('tenor.googleapis.com'));
    for (const f of ['src/index.js', 'src/manager/index.js', 'hebergeur/index.js']) {
      const t = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      V(`${f} : GIPHY_KEY documenté, TENOR_KEY retiré`, t.includes('GIPHY_KEY=') && !t.includes('TENOR_KEY'));
    }
    for (const lang of Object.keys(I.LOCALES)) {
      const L = I.LOCALES[lang];
      V(`${lang} : six noms de type + textes du type`,
        Object.keys(L.types || {}).length === 6 && typeof L.typeNote === 'string' && typeof L.typeSansCle === 'string'
        && typeof L.typeIntrouvable === 'string' && typeof L.prefOk === 'function' && typeof L.prefReset === 'string' && typeof L.prefSansCle === 'string');
    }

    // Bisou lesbienne : le type voyage dans les boutons et le pied de carte.
    vider();
    let it = fausse({ sub: 'kiss', strings: { type: 'lesbienne' } });
    await I.execute(it);
    let t = texte(it.reponses[0]);
    V('bouton « Rendre » porte le type', t.includes('itx:kiss:u1:u2:lesbienne'), t.slice(0, 300));
    V('bouton « Rejeter » porte le type', t.includes('itxr:kiss:u1:u2:lesbienne'));
    V('pied de carte : Type : Lesbienne • Anime', t.includes('Type : Lesbienne • Anime : Bloom Into You'), t);
    V('image = le GIF Gifukai', t.includes('https://cdn.gifukai.com/ff-kiss.gif'));

    // Type à clé sans clé (et réserve vide pour ce couple) : GIF classique + explication.
    vider();
    it = fausse({ sub: 'bite', strings: { type: 'catgirl' } });
    await I.execute(it);
    t = texte(it.reponses[0]);
    V('sans clé : GIF classique (nekos.best) et le pied le dit', t.includes('https://nekos.best/kiss.gif') && t.includes('clé GIPHY'), t);
    V('sans clé : pas de « Type : Catgirl » mensonger', !t.includes('Type : Catgirl'));
    it = fausse({ sub: 'hug', strings: { type: 'catgirl' } });
    await I.execute(it);
    t = texte(it.reponses[0]);
    V('sans clé mais réserve garnie : on ressert la réserve, mention GIPHY comprise', t.includes('media.giphy.com') && t.includes('Powered by GIPHY'), t);

    // Avec clé : mention GIPHY.
    process.env.GIPHY_KEY = 'cle-test';
    it = fausse({ sub: 'hug', strings: { type: 'catgirl' } });
    await I.execute(it);
    t = texte(it.reponses[0]);
    V('avec clé : Type : Catgirl • Powered by GIPHY', t.includes('Type : Catgirl') && t.includes('Powered by GIPHY'), t);
    delete process.env.GIPHY_KEY;

    // Préférence : enregistrée en éphémère, puis appliquée sans option.
    it = fausse({ sub: 'preference', strings: { type: 'gay' } });
    await I.execute(it);
    V('preference gay → confirmation éphémère', it.reponses[0]?.flags === 64 && it.reponses[0].content.includes('**Gay**'), texte(it.reponses[0]));
    V('…et aucun avertissement de clé pour un type gratuit', !it.reponses[0].content.includes('GIPHY'));
    it = fausse({ sub: 'hug' });
    await I.execute(it);
    V('hug sans option → la préférence (gay) s\'applique', texte(it.reponses[0]).includes('itx:hug:u1:u2:gay'), texte(it.reponses[0]).slice(0, 300));
    it = fausse({ sub: 'preference', strings: { type: 'femboy' } });
    await I.execute(it);
    V('preference femboy sans clé → avertissement', it.reponses[0].content.includes('GIPHY'), it.reponses[0].content);
    it = fausse({ sub: 'preference', strings: { type: 'hetero' } });
    await I.execute(it);
    V('preference hetero → remise à zéro', it.reponses[0].content.includes('↩️') && I.prefs.de('u1') === 'hetero');
    it = fausse({ sub: 'kiss', strings: { type: 'catgirl' } });
    await I.execute(it);
    V('l\'option explicite prime sur la préférence', texte(it.reponses[0]).includes('itx:kiss:u1:u2:catgirl'));

    // Bouton « Rendre » : la réponse garde le type du message d'origine.
    vider();
    it = fausse({ user: 'u2', customId: 'itx:hug:u1:u2:gay' });
    await I.handleButton(it);
    V('« Rendre » relit le type et interroge Gifukai en mm', derniersAppels('gifukai')[0]?.includes('pairing=mm'), appels.join(' '));
    V('réponse dans le même type', texte(it.suivis[0] || {}).includes('Type : Gay'), texte(it.suivis[0]));
    it = fausse({ user: 'u2', customId: 'itx:hug:u1:u2' });
    await I.handleButton(it);
    V('ancien bouton sans type → hétéro, sans erreur', it.suivis.length === 1 && !texte(it.suivis[0]).includes('Type :'), texte(it.suivis[0]));
  }

  console.log('\n7) « Rendre » ne ressort jamais le GIF du message d\'origine');
  {
    const A = 'https://nekos.best/a.gif', B = 'https://nekos.best/b.gif';
    const original = (url, carte = false) => (carte
      ? { embeds: [], components: [{ type: 17, components: [{ type: 12, items: [{ media: { url, proxy_url: 'https://media.discordapp.net/x' } }] }] }], flags: 32768 }
      : { embeds: [{ toJSON: () => ({ image: { url }, footer: { text: 'x' } }) }], components: [], flags: 0 });
    V('urlsDuMessage lit l\'image d\'un embed', I.urlsDuMessage(original(A)).has(A));
    V('… et la galerie d\'une carte, URL d\'origine et proxy', I.urlsDuMessage(original(A, true)).has(A) && I.urlsDuMessage(original(A, true)).has('https://media.discordapp.net/x'));
    V('… sans planter sur un message vide', I.urlsDuMessage(null).size === 0 && I.urlsDuMessage({}).size === 0);

    // La source alterne A, B : si elle tombe d'abord sur A, on retire.
    etat.nekos = [A, A, B]; etat.nekosIndex = 0; vider();
    const g1 = await I.fetchGif('hug', new Set([A]));
    V('la source est retirée jusqu\'à un GIF différent', g1?.url === B && derniersAppels('nekos').length === 3, texte(g1) + ' ' + appels.length);

    // La source ne sait donner que A : on passe à la suivante (waifu.pics).
    etat.nekos = [A]; etat.nekosIndex = 0; etat.waifu = 'https://i.waifu.pics/c.gif'; vider();
    const g2 = await I.fetchGif('hug', new Set([A]));
    V('après trois A, la source suivante prend le relais', g2?.url === 'https://i.waifu.pics/c.gif' && derniersAppels('nekos').length === 3, texte(g2));

    // Toutes les sources ne donnent que A : la réserve (qui a vu B et C) sert.
    etat.waifu = A; vider();
    const g3 = await I.fetchGif('hug', new Set([A]));
    V('sources bloquées sur A → un autre GIF de la réserve', g3?.reserve === true && g3.url !== A, texte(g3));

    // Rien d'autre que A nulle part : plutôt pas de GIF que le même.
    db.prepare("DELETE FROM gif_cache WHERE categorie = 'bite' ").run();
    etat.nekos = [A]; etat.nekosIndex = 0; etat.waifu = A; vider();
    const g4 = await I.fetchGif('bite', new Set([A]));
    V('aucune alternative → aucun GIF, jamais le même', g4 === null, texte(g4));
    etat.waifu = null;

    // Le chemin complet : bouton « Rendre » sur un message dont l'image est A.
    etat.nekos = [A, B]; etat.nekosIndex = 0; vider();
    let it = fausse({ user: 'u2', customId: 'itx:hug:u1:u2' });
    it.message = original(A);
    await I.handleButton(it);
    let t = texte(it.suivis[0] || {});
    V('réponse « Rendre » (embed d\'origine) : GIF B, pas A', t.includes(B) && !t.includes(A), t);
    etat.nekos = [A, B]; etat.nekosIndex = 0; vider();
    it = fausse({ user: 'u2', customId: 'itx:hug:u1:u2' });
    it.message = original(A, true);
    await I.handleButton(it);
    t = texte(it.suivis[0] || {});
    V('réponse « Rendre » (carte d\'origine) : GIF B, pas A', t.includes(B) && !t.includes(A), t);

    // Typé : Gifukai ne sait rendre que ff-kiss.gif, déjà dans l'original →
    // on retire trois fois, puis GIF classique avec la note « introuvable ».
    etat.nekos = [B]; etat.nekosIndex = 0; vider();
    it = fausse({ user: 'u2', customId: 'itx:kiss:u1:u2:lesbienne' });
    it.message = original('https://cdn.gifukai.com/ff-kiss.gif');
    db.prepare("DELETE FROM gif_cache WHERE categorie LIKE 'kiss@lesbienne@%'").run();
    await I.handleButton(it);
    t = texte(it.suivis[0] || {});
    V('typé : Gifukai retiré 3 fois, puis repli classique différent', derniersAppels('gifukai').length === 3 && t.includes(B) && !t.includes('ff-kiss.gif'), t + ' ' + appels.join(' '));

    // Sans exclusion (première interaction), une seule requête, comme avant.
    etat.nekos = [A]; etat.nekosIndex = 0; vider();
    await I.fetchGif('hug');
    V('sans message d\'origine, un seul appel réseau', derniersAppels('nekos').length === 1);
  }

  console.warn = warnOrig;
  global.fetch = vraiFetch;
  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.warn = warnOrig; console.error(e); console.log('\n0 réussis, 1 échoués'); process.exit(1); });
