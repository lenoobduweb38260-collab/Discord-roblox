// 🏳️‍🌈 /interact : type de GIF (option facultative : hétéro, lesbienne, gay,
// catgirl, catboy, femboy), Gifukai sans clé, GIPHY à clé, réserve, et
// « Rendre » qui ne ressort jamais le GIF d'origine.
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
// Une réserve d'avant la clé stable, pour éprouver la migration au chargement.
const urlGiphyAvant = (jeton, id, cid) => `https://media2.giphy.com/media/v1.${jeton}/${id}/giphy.gif?cid=${cid}&ep=v1_gifs_search&rid=giphy.gif&ct=g`;
{
  const poser = db.prepare('INSERT OR IGNORE INTO gif_cache (categorie, url, anime, at) VALUES (?, ?, ?, ?)');
  poser.run('lick@femboy@giphy', urlGiphyAvant('X1', 'old1', '1'), 'Anime X', '2026-01-01');
  poser.run('lick@femboy@giphy', urlGiphyAvant('X2', 'old1', '2'), null, '2026-01-02');
  poser.run('lick@femboy@giphy', urlGiphyAvant('X3', 'old2', '3'), null, '2026-01-03');
  poser.run('lick@femboy@giphy', 'https://media2.giphy.com/media/old2/giphy.gif', null, '2026-01-04');
  poser.run('lick@femboy@giphy', 'https://i.giphy.com/ccc.gif?cid=9', null, '2026-01-05');
  poser.run('bang', 'https://nekos.best/x.gif?v=1', null, '2026-01-06');
}
const I = require('../src/commands/interact');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };
const silence = () => {}; // les avertissements de repli sont attendus ici
const warnOrig = console.warn;

// ----- Faux réseau : Gifukai, GIPHY, nekos.best -----
const etat = {
  gifukai: 'ok', gifukaiUrls: ['https://cdn.gifukai.com/ff-kiss.gif'], gifukaiIndex: 0,
  giphy: 'ok', giphyNombre: 2, giphyIds: null, giphyReponse: 0,
  nekos: ['https://nekos.best/kiss.gif'], nekosIndex: 0, waifu: null, otaku: null,
};
// Une URL GIPHY telle que l'API la rend : jeton de chemin + cid PAR RÉPONSE.
const urlGiphy = (id, reponse) => `https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjEx${reponse}/${id}/giphy.gif?cid=790b7611${reponse}&ep=v1_gifs_search&rid=giphy.gif&ct=g`;
const appels = [];
const vraiFetch = global.fetch;
global.fetch = async (url) => {
  const u = String(url);
  appels.push(u);
  if (u.includes('api.gifukai.com')) {
    if (etat.gifukai === 'panne') return { ok: false, status: 503 };
    if (etat.gifukai === 'vide') return { ok: false, status: 404 };
    if (etat.gifukai === 'jette') throw new Error('timeout');
    if (etat.gifukai === 'sans-url') return { ok: true, json: async () => ({}) };
    const url = etat.gifukaiUrls[etat.gifukaiIndex++ % etat.gifukaiUrls.length];
    return { ok: true, json: async () => ({ url, anime: 'Bloom Into You' }) };
  }
  if (u.includes('api.giphy.com')) {
    if (etat.giphy === 'panne') return { ok: false, status: 500 };
    if (etat.giphy === 'quota') return { ok: false, status: 429 };
    if (etat.giphy === 'jette') throw new Error('timeout');
    if (etat.giphy === 'vide' || (etat.giphy === 'vide-pg' && u.includes('rating=pg&'))) return { ok: true, json: async () => ({ data: [] }) };
    const reponse = ++etat.giphyReponse;
    const ids = etat.giphyIds || Array.from({ length: etat.giphyNombre }, (_, k) => `gif${k}`);
    const data = ids.map((id, k) => (k % 2
      ? { images: { downsized: { url: urlGiphy(id, reponse) } } }
      : { images: { original: { url: urlGiphy(id, reponse) } } }));
    return { ok: true, json: async () => ({ data }) };
  }
  if (u.includes('nekos.best')) {
    if (etat.nekosPanne) return { ok: false, status: 503 };
    if (etat.nekosJette) throw new Error('timeout');
    if (etat.nekosSansUrl) return { ok: true, json: async () => ({ results: [] }) };
    const url = etat.nekos[etat.nekosIndex++ % etat.nekos.length];
    return { ok: true, json: async () => ({ results: [{ url, anime_name: 'Toradora' }] }) };
  }
  if (u.includes('api.waifu.pics') && etat.waifu) {
    return { ok: true, json: async () => ({ url: etat.waifu }) };
  }
  if (u.includes('api.otakugifs.xyz') && etat.otaku) {
    return { ok: true, json: async () => ({ url: etat.otaku }) };
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
    V('GIF GIPHY reçu, URL stabilisée (sans jeton de réponse)', /^https:\/\/media2\.giphy\.com\/media\/gif\d+\/giphy\.gif$/.test(g?.url || '') && g.source === 'giphy', texte(g));
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

  console.log('\n5) La commande : option type partout, boutons');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'interact.js'), 'utf8');
    V('option type sur les 8 actions', (src.match(/\.addStringOption\(optionType\)/g) || []).length === 8);
    V('plus de sous-commande preference : le type est une option facultative', !src.includes(".setName('preference')") && !src.includes('interact_prefs'));
    V('plus aucune trace de l\'API Tenor (fermée)', !src.includes('tenor.googleapis.com'));
    for (const f of ['src/index.js', 'src/manager/index.js', 'hebergeur/index.js']) {
      const t = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      V(`${f} : GIPHY_KEY documenté, TENOR_KEY retiré`, t.includes('GIPHY_KEY=') && !t.includes('TENOR_KEY'));
    }
    for (const lang of Object.keys(I.LOCALES)) {
      const L = I.LOCALES[lang];
      V(`${lang} : six noms de type + textes du type`,
        Object.keys(L.types || {}).length === 6 && typeof L.typeNote === 'string' && typeof L.typeSansCle === 'string'
        && typeof L.typeIntrouvable === 'string' && typeof L.memeGif === 'string' && typeof L.typeMeme === 'string'
        && L.prefOk === undefined && L.prefReset === undefined && L.prefSansCle === undefined);
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
    V('sans clé mais réserve garnie : on ressert la réserve, mention GIPHY comprise', t.includes('giphy.com/media/') && t.includes('Powered by GIPHY'), t);

    // Avec clé : mention GIPHY.
    process.env.GIPHY_KEY = 'cle-test';
    it = fausse({ sub: 'hug', strings: { type: 'catgirl' } });
    await I.execute(it);
    t = texte(it.reponses[0]);
    V('avec clé : Type : Catgirl • Powered by GIPHY', t.includes('Type : Catgirl') && t.includes('Powered by GIPHY'), t);
    delete process.env.GIPHY_KEY;

    // Sans option : hétéro, toujours — aucune préférence mémorisée.
    it = fausse({ sub: 'hug' });
    await I.execute(it);
    V('hug sans option → hétéro', texte(it.reponses[0]).includes('itx:hug:u1:u2:hetero') && !texte(it.reponses[0]).includes('Type :'), texte(it.reponses[0]).slice(0, 300));
    it = fausse({ sub: 'kiss', strings: { type: 'catgirl' } });
    await I.execute(it);
    V('l\'option type s\'applique à cette interaction seulement', texte(it.reponses[0]).includes('itx:kiss:u1:u2:catgirl'));
    it = fausse({ sub: 'kiss' });
    await I.execute(it);
    V('… et la suivante, sans option, est à nouveau hétéro', texte(it.reponses[0]).includes('itx:kiss:u1:u2:hetero'));

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

  console.log('\n6) « Rendre » ne ressort jamais le GIF du message d\'origine');
  {
    const A = 'https://nekos.best/a.gif', B = 'https://nekos.best/b.gif';
    const original = (url, carte = false) => (carte
      ? { embeds: [], components: [{ type: 17, components: [{ type: 12, items: [{ media: { url, proxy_url: 'https://media.discordapp.net/x' } }] }] }], flags: 32768 }
      : { embeds: [{ toJSON: () => ({ image: { url }, footer: { text: 'x' } }) }], components: [], flags: 0 });
    const viderReserve = (motif) => db.prepare('DELETE FROM gif_cache WHERE categorie LIKE ?').run(motif);
    const garnir = (categorie, url) => db.prepare('INSERT OR IGNORE INTO gif_cache (categorie, url, anime, at) VALUES (?, ?, NULL, ?)').run(categorie, url, '2026-10-13');

    V('urlsDuMessage lit l\'image d\'un embed', I.urlsDuMessage(original(A)).has(A));
    V('… et la galerie d\'une carte, URL d\'origine et proxy', I.urlsDuMessage(original(A, true)).has(A) && I.urlsDuMessage(original(A, true)).has('https://media.discordapp.net/x'));
    const vignette = { embeds: [{ toJSON: () => ({ thumbnail: { url: 'https://x/t.gif' } }) }], components: [{ type: 17, components: [{ type: 9, accessory: { type: 11, media: { url: 'https://x/acc.gif' } }, components: [] }] }] };
    V('… la vignette d\'un embed et l\'accessoire d\'une section', I.urlsDuMessage(vignette).has('https://x/t.gif') && I.urlsDuMessage(vignette).has('https://x/acc.gif'));
    V('… sans planter sur un message vide', I.urlsDuMessage(null).size === 0 && I.urlsDuMessage({}).size === 0);
    V('deux URL GIPHY du même GIF ont la même clé, pas deux GIF différents',
      I.cleGif(urlGiphy('abc', 1)) === I.cleGif(urlGiphy('abc', 2)) && I.cleGif(urlGiphy('abc', 1)) !== I.cleGif(urlGiphy('abd', 1)) && I.cleGif('https://nekos.best/a.gif?x=1') === 'https://nekos.best/a.gif');
    V('urlStable retire le jeton de réponse GIPHY et laisse les autres URL', I.urlStable(urlGiphy('abc', 7)) === 'https://media2.giphy.com/media/abc/giphy.gif' && I.urlStable(A) === A);

    // Migration au chargement : les lignes signées sont réécrites, sans perte.
    const lignes = db.prepare("SELECT url, anime, at FROM gif_cache WHERE categorie = 'lick@femboy@giphy' ORDER BY url").all();
    const urls = lignes.map((l) => l.url);
    V('deux lignes signées du même GIF → une seule adresse stable', urls.filter((u) => u === 'https://media2.giphy.com/media/old1/giphy.gif').length === 1 && !urls.some((u) => u.includes('old1/giphy.gif?')), urls.join(' '));
    V('… qui garde anime et date de la première', lignes.find((l) => l.url.endsWith('/old1/giphy.gif'))?.anime === 'Anime X' && lignes.find((l) => l.url.endsWith('/old1/giphy.gif'))?.at === '2026-01-01');
    V('une adresse stable déjà présente absorbe sa jumelle signée', urls.filter((u) => u.endsWith('/old2/giphy.gif')).length === 1 && !urls.some((u) => u.includes('old2/giphy.gif?')));
    V('une adresse GIPHY inconnue (non réécrivable) est laissée telle quelle', urls.includes('https://i.giphy.com/ccc.gif?cid=9'));
    V('une ligne non GIPHY avec « ? » n\'est pas touchée', db.prepare("SELECT url FROM gif_cache WHERE categorie = 'bang'").get()?.url === 'https://nekos.best/x.gif?v=1');
    V('la table interact_prefs n\'existe plus en base', !db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'interact_prefs'").get());

    // La source alterne A, A, B : on retire jusqu'à un GIF différent.
    etat.nekos = [A, A, B]; etat.nekosIndex = 0; vider();
    const g1 = await I.fetchGif('hug', new Set([A]));
    V('la source est retirée jusqu\'à un GIF différent (3 appels)', g1?.url === B && derniersAppels('nekos').length === 3, texte(g1) + ' ' + appels.length);

    // Premier tirage déjà libre : un seul appel, comme sans exclusion.
    etat.nekos = [B]; etat.nekosIndex = 0; vider();
    const g1b = await I.fetchGif('hug', new Set([A]));
    V('premier tirage libre → un seul appel', g1b?.url === B && derniersAppels('nekos').length === 1);
    vider();
    await I.fetchGif('hug', new Set());
    V('ensemble d\'exclusion vide → un seul appel', derniersAppels('nekos').length === 1);

    // La source ne sait donner que A : on passe à la suivante (waifu.pics).
    etat.nekos = [A]; etat.nekosIndex = 0; etat.waifu = 'https://i.waifu.pics/c.gif'; vider();
    const g2 = await I.fetchGif('hug', new Set([A]));
    V('après trois A, la source suivante prend le relais', g2?.url === 'https://i.waifu.pics/c.gif' && derniersAppels('nekos').length === 3 && derniersAppels('waifu').length === 1, texte(g2));

    // Toutes les sources ne donnent que A ; la réserve contient A et B : B, toujours.
    viderReserve('hug'); garnir('hug', A); garnir('hug', B);
    etat.nekos = [A]; etat.nekosIndex = 0; etat.waifu = A; vider();
    let jamaisA = true;
    for (let k = 0; k < 20; k++) {
      const g3 = await I.fetchGif('hug', new Set([A]));
      if (!(g3?.reserve === true && g3.url === B)) jamaisA = false;
    }
    V('sources bloquées sur A → B depuis la réserve, 20 fois sur 20', jamaisA);
    V('… avec 3 appels nekos, 3 waifu, 1 otakugifs par tentative', derniersAppels('nekos').length === 60 && derniersAppels('waifu').length === 60 && derniersAppels('otakugifs').length === 20, [derniersAppels('nekos').length, derniersAppels('waifu').length, derniersAppels('otakugifs').length].join('/'));

    // Rien d'autre que A nulle part : pas de GIF, et ce n'est PAS une panne.
    viderReserve('bite'); garnir('bite', A);
    etat.nekos = [A]; etat.nekosIndex = 0; etat.waifu = A; vider();
    const g4 = await I.fetchGif('bite', new Set([A]));
    V('aucune alternative → { memeSeulement }, jamais le même', g4?.memeSeulement === true && !g4.url, texte(g4));
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

    // Bisou sur la joue : une seule source (otakugifs) qui n'a que A, réserve = A.
    viderReserve('peck'); garnir('peck', A);
    etat.otaku = A; vider();
    it = fausse({ user: 'u2', customId: 'itx:peck:u1:u2' });
    it.message = original(A);
    await I.handleButton(it);
    t = texte(it.suivis[0] || {});
    V('seule image = l\'original → réponse sans image, note « une seule animation », pas « indisponible »',
      !t.includes(A) && t.includes(I.LOCALES.fr.memeGif) && !t.includes(I.LOCALES.fr.noGif), t);
    etat.otaku = null;

    // Typé Gifukai : 1er tirage = l'original, 2e différent → renvoyé, rangé, « Type : Lesbienne ».
    const FF1 = 'https://cdn.gifukai.com/ff-kiss.gif', FF2 = 'https://cdn.gifukai.com/ff-kiss-2.gif';
    viderReserve('kiss@lesbienne@%');
    etat.gifukaiUrls = [FF1, FF2]; etat.gifukaiIndex = 0; vider();
    it = fausse({ user: 'u2', customId: 'itx:kiss:u1:u2:lesbienne' });
    it.message = original(FF1);
    await I.handleButton(it);
    t = texte(it.suivis[0] || {});
    V('typé : retiré une fois, le 2e GIF Gifukai est renvoyé avec « Type : Lesbienne »', derniersAppels('gifukai').length === 2 && t.includes(FF2) && !t.includes(FF1) && t.includes('Type : Lesbienne • Anime : Bloom Into You'), t);
    V('… et rangé en réserve typée', enReserve('kiss@lesbienne@gifukai') === 1 && db.prepare('SELECT url FROM gif_cache WHERE categorie = ?').get('kiss@lesbienne@gifukai').url === FF2);

    // Typé Gifukai qui ne connaît que l'original, réserve = l'original : repli classique différent,
    // note « le seul GIF de ce type était déjà dans le message » — pas « clé GIPHY ».
    viderReserve('kiss@lesbienne@%'); garnir('kiss@lesbienne@gifukai', FF1);
    etat.gifukaiUrls = [FF1]; etat.gifukaiIndex = 0; etat.nekos = [B]; etat.nekosIndex = 0; vider();
    it = fausse({ user: 'u2', customId: 'itx:kiss:u1:u2:lesbienne' });
    it.message = original(FF1);
    await I.handleButton(it);
    t = texte(it.suivis[0] || {});
    V('typé : Gifukai retiré 3 fois, réserve = l\'original → GIF classique différent', derniersAppels('gifukai').length === 3 && t.includes(B) && !t.includes(FF1), t + ' ' + appels.join(' '));
    V('… avec la note « déjà dans le message », jamais « clé GIPHY » ni « introuvable »', t.includes(I.LOCALES.fr.typeMeme) && !t.includes('clé GIPHY') && !t.includes(I.LOCALES.fr.typeIntrouvable), t);
    etat.gifukaiUrls = [FF1]; etat.gifukaiIndex = 0;

    // GIPHY, avec clé : le même GIF revient sous un autre cid → reconnu et écarté.
    process.env.GIPHY_KEY = 'cle-test';
    viderReserve('hug@catgirl@%');
    etat.giphyIds = ['same', 'autre']; vider();
    it = fausse({ sub: 'hug', strings: { type: 'catgirl' } });
    await I.execute(it);
    const premier = texte(it.reponses[0]).match(/https:\/\/media2\.giphy\.com\/media\/[A-Za-z0-9]+\/giphy\.gif/)?.[0];
    V('première interaction GIPHY : URL stable envoyée', Boolean(premier), texte(it.reponses[0]).slice(0, 300));
    let jamaisLeMeme = true;
    for (let k = 0; k < 20; k++) {
      const g = await I.fetchGifTypee('hug', 'catgirl', new Set([urlGiphy('same', 999)]));
      if (!g?.url || I.cleGif(g.url) === 'giphy:same') jamaisLeMeme = false;
    }
    V('recherche fraîche : le GIF « same » (nouveau cid) est écarté 20 fois sur 20', jamaisLeMeme);
    V('la réserve ne stocke qu\'une entrée par GIF malgré les cid différents', enReserve('hug@catgirl@giphy') === 2, String(enReserve('hug@catgirl@giphy')));

    // Réserve garnie (≥ 10) et recherche récente : servie SANS appel, jamais l'original.
    viderReserve('pat@catboy@%');
    etat.giphyIds = Array.from({ length: 12 }, (_, k) => `c${k}`); vider();
    await I.fetchGifTypee('pat', 'catboy');
    const exclureC0 = new Set([urlGiphy('c0', 123)]);
    jamaisLeMeme = true; vider();
    for (let k = 0; k < 30; k++) {
      const g = await I.fetchGifTypee('pat', 'catboy', exclureC0);
      if (!g?.url || I.cleGif(g.url) === 'giphy:c0' || g.source !== 'giphy') jamaisLeMeme = false;
    }
    V('réserve GIPHY garnie : 30 « Rendre » sans appel réseau, jamais c0', jamaisLeMeme && derniersAppels('giphy').length === 0, String(derniersAppels('giphy').length));

    // Recherche à résultat unique = l'original : pg puis pg-13, puis { introuvable, memeSeulement }.
    viderReserve('kill@femboy@%');
    etat.giphyIds = ['unique']; vider();
    const g5 = await I.fetchGifTypee('kill', 'femboy', new Set([urlGiphy('unique', 5)]));
    V('résultat unique = l\'original → essai pg-13 puis « seulement le même »', g5?.memeSeulement === true && derniersAppels('giphy').length === 2, texte(g5) + ' ' + derniersAppels('giphy').length);
    etat.giphyIds = null;
    delete process.env.GIPHY_KEY;

    // Panne des sources + réserve réduite à l'original : c'est une PANNE, pas « une seule animation ».
    viderReserve('hug'); garnir('hug', A);
    etat.nekosPanne = true; etat.waifu = null; etat.otaku = null; vider();
    const g6 = await I.fetchGif('hug', new Set([A]));
    V('sources en panne, réserve = l\'original → null (indisponible), pas « seulement le même »', g6 === null, texte(g6));
    it = fausse({ user: 'u2', customId: 'itx:hug:u1:u2' });
    it.message = original(A);
    await I.handleButton(it);
    t = texte(it.suivis[0] || {});
    V('… et le pied dit « indisponible »', t.includes(I.LOCALES.fr.noGif) && !t.includes(I.LOCALES.fr.memeGif), t);
    etat.nekosPanne = false;

    // Gifukai en panne + réserve typée = l'original + pas de clé : « introuvable », pas « déjà dans le message ».
    viderReserve('kiss@lesbienne@%'); garnir('kiss@lesbienne@gifukai', FF1);
    etat.gifukai = 'panne'; etat.nekos = [B]; etat.nekosIndex = 0; vider();
    const g7 = await I.fetchGifTypee('kiss', 'lesbienne', new Set([FF1]));
    V('Gifukai en panne → { introuvable } sans memeSeulement ni sansCle', g7?.introuvable === true && !g7.memeSeulement && !g7.sansCle, texte(g7));
    it = fausse({ user: 'u2', customId: 'itx:kiss:u1:u2:lesbienne' });
    it.message = original(FF1);
    await I.handleButton(it);
    t = texte(it.suivis[0] || {});
    V('… pied « Aucun GIF trouvé pour ce type », GIF classique différent', t.includes(I.LOCALES.fr.typeIntrouvable) && t.includes(B) && !t.includes(I.LOCALES.fr.typeMeme), t);
    etat.gifukai = 'ok';

    // Typé ET classique réduits à l'original : une seule ligne de pied, pas de promesse de « GIF classique ».
    viderReserve('kiss@lesbienne@%'); garnir('kiss@lesbienne@gifukai', FF1);
    viderReserve('kiss'); garnir('kiss', FF1);
    etat.gifukaiUrls = [FF1]; etat.gifukaiIndex = 0; etat.nekos = [FF1]; etat.nekosIndex = 0; etat.waifu = FF1; etat.otaku = FF1; vider();
    it = fausse({ user: 'u2', customId: 'itx:kiss:u1:u2:lesbienne' });
    it.message = original(FF1);
    await I.handleButton(it);
    t = texte(it.suivis[0] || {});
    const piedT = (it.suivis[0]?.embeds?.[0]?.data?.footer?.text) || '';
    V('rien d\'autre nulle part → sans image, une seule ligne « une seule animation »', !t.includes('"image"') && piedT === I.LOCALES.fr.memeGif, piedT);
    etat.waifu = null; etat.otaku = null;

    // Toute panne classique (503, exception, réponse sans URL) + réserve = l'original → null.
    for (const mode of ['nekosPanne', 'nekosJette', 'nekosSansUrl']) {
      viderReserve('hug'); garnir('hug', A);
      etat[mode] = true; etat.waifu = null; etat.otaku = null;
      const g = await I.fetchGif('hug', new Set([A]));
      V(`panne « ${mode} » → null, pas « seulement le même »`, g === null, texte(g));
      etat[mode] = false;
    }

    // Gifukai : exception ou réponse sans URL ne valent pas « seulement le même ».
    for (const mode of ['jette', 'sans-url', 'panne']) {
      viderReserve('kiss@lesbienne@%'); garnir('kiss@lesbienne@gifukai', FF1);
      etat.gifukai = mode;
      const g = await I.fetchGifTypee('kiss', 'lesbienne', new Set([FF1]));
      V(`Gifukai « ${mode} » → { introuvable } sans memeSeulement ni sansCle`, g?.introuvable === true && !g.memeSeulement && !g.sansCle, texte(g));
    }
    etat.gifukai = 'ok';

    // GIPHY : panne, quota, vide, exception ne valent pas « seulement le même ».
    process.env.GIPHY_KEY = 'cle-test';
    for (const [mode, appelsAttendus] of [['panne', 2], ['quota', 1], ['vide', 2], ['jette', 2]]) {
      viderReserve('kill@femboy@%'); garnir('kill@femboy@giphy', 'https://media2.giphy.com/media/unique/giphy.gif');
      etat.giphy = mode; vider();
      const g = await I.fetchGifTypee('kill', 'femboy', new Set([urlGiphy('unique', 5)]));
      V(`GIPHY « ${mode} » → { introuvable } sans memeSeulement (${appelsAttendus} appel(s))`, g?.introuvable === true && !g.memeSeulement && derniersAppels('giphy').length === appelsAttendus, texte(g) + ' ' + derniersAppels('giphy').length);
    }
    etat.giphy = 'ok';
    delete process.env.GIPHY_KEY;

    // Sans image : jamais une note qui promet « GIF classique ».
    const pied = (r) => r?.embeds?.[0]?.data?.footer?.text || '';
    etat.nekosPanne = true; etat.waifu = null; etat.otaku = null;
    viderReserve('bite'); viderReserve('bite@catgirl@%');
    it = fausse({ sub: 'bite', strings: { type: 'catgirl' } });
    await I.execute(it);
    V('sans clé + sources en panne : pied = « indisponible » seul (pas « clé GIPHY — GIF classique »)', !texte(it.reponses[0]).includes('"image"') && pied(it.reponses[0]) === I.LOCALES.fr.noGif, pied(it.reponses[0]));
    viderReserve('kiss'); viderReserve('kiss@lesbienne@%'); etat.gifukai = 'panne';
    it = fausse({ sub: 'kiss', strings: { type: 'lesbienne' } });
    await I.execute(it);
    V('Gifukai + sources en panne : pied = « indisponible » seul (pas « introuvable — GIF classique »)', pied(it.reponses[0]) === I.LOCALES.fr.noGif, pied(it.reponses[0]));
    etat.gifukai = 'ok';
    // Typé « seulement le même » mais classique en PANNE : c'est une panne.
    viderReserve('kiss@lesbienne@%'); garnir('kiss@lesbienne@gifukai', FF1); viderReserve('kiss'); garnir('kiss', FF1);
    etat.gifukaiUrls = [FF1]; etat.gifukaiIndex = 0;
    it = fausse({ user: 'u2', customId: 'itx:kiss:u1:u2:lesbienne' });
    it.message = original(FF1);
    await I.handleButton(it);
    V('typé = l\'original, classique en panne → « indisponible », pas « une seule animation »', pied(it.suivis[0]) === I.LOCALES.fr.noGif, pied(it.suivis[0]));
    etat.nekosPanne = false;

    // Un ancien bouton sans type marche toujours.
    etat.nekos = [A, B]; etat.nekosIndex = 0; vider();
    it = fausse({ user: 'u2', customId: 'itx:hug:u1:u2' });
    it.message = original(A);
    await I.handleButton(it);
    V('ancien bouton sans type → réponse hétéro différente, sans erreur', it.suivis.length === 1 && texte(it.suivis[0]).includes(B) && !texte(it.suivis[0]).includes('Type :'), texte(it.suivis[0]));
  }

  console.warn = warnOrig;
  global.fetch = vraiFetch;
  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.warn = warnOrig; console.error(e); console.log('\n0 réussis, 1 échoués'); process.exit(1); });
