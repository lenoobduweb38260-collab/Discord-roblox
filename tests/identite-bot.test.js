// 🪪 L'identité du bot par serveur, et /interact (nouvelles actions, GIF de joue).
// + 🖼️ Les photos des profils : liens élargis (imgur, Discord, Dropbox, Drive,
//   GitHub, pages og:image…), fichier envoyé depuis l'appareil (modal,
//   `/config photo:`, site), adresse stable enregistrée.
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'identite-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');
process.env.BOT_PROFILS = JSON.stringify([{ nom: 'Arès', avatar: 'https://cdn.test/ares.png' }, { nom: 'Oy Bot?' }]);

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  return vrai.apply(this, arguments);
};

const D = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../src/database');
const I = require('../src/utils/identiteBot');
const { nomDuBot } = require('../src/utils/styleEmbeds');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
console.warn = () => {};

// ── Les octets de chaque format (en-têtes réels) ──
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPG = Buffer.from('ffd8ffe000104a46494600010100', 'hex');
const GIF = Buffer.from('474946383961010001000000', 'hex');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]);
const AVIF = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypavif'), Buffer.alloc(8)]);
const page = (meta) => Buffer.from(`<!DOCTYPE html><html><head><title>x</title>${meta}</head><body>…</body></html>`);

// ── Un faux Internet : adresse → réponse. Les URL inconnues donnent du PNG,
// celles en .webp du VRAI webp (octets RIFF…WEBP — l'en-tête seul ne suffit
// plus, ce sont les octets qui font foi).
//
// 🛡️ AUCUN accès réseau réel : le DNS et la requête HTTP du module sont
// remplacés (I._reseau). Le faux transport se comporte comme net.connect :
// une IP écrite en clair ne passe pas par `lookup`, un nom passe par le
// `lookup` QU'ON LUI DONNE — et la « connexion » part vers l'adresse que ce
// lookup a rendue. C'est elle qu'on note dans `connexions`. ──
const net = require('net');
const WEB = new Map();
const appelsWeb = [];
const connexions = [];
const DNS = new Map(); // nom → [adresses] ou fonction() → [adresses]
const appelsDNS = [];
const PUBLIQUE = '93.184.216.34';
const requeteReelle = I._reseau.requete;
const lookupReel = I._reseau.lookup;
const fauxLookup = (hote, opts, rappel) => {
  if (typeof opts === 'function') { rappel = opts; opts = {}; }
  appelsDNS.push(hote);
  let r = DNS.get(hote);
  if (typeof r === 'function') r = r();
  const liste = (r || [PUBLIQUE]).map((a) => ({ address: a, family: net.isIP(a) }));
  setImmediate(() => {
    if (r && !r.length) return rappel(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hote}`), { code: 'ENOTFOUND' }));
    if (opts?.all) return rappel(null, liste);
    return rappel(null, liste[0].address, liste[0].family);
  });
};
const fauxTransport = async (u, { lookup, entetes = {}, signal } = {}) => {
  const hote = u.hostname.replace(/^\[|\]$/g, '');
  const adresse = net.isIP(hote) ? hote
    : await new Promise((ok, ko) => lookup(hote, { all: true, hints: 32 }, (err, liste) => (err ? ko(err) : ok(liste[0].address))));
  const url = u.toString();
  connexions.push({ url, adresse });
  appelsWeb.push({ url, accept: entetes.Accept || '', agent: entetes['User-Agent'] || '' });
  let r = WEB.get(url);
  if (typeof r === 'function') r = await r(url, { signal });
  if (!r) {
    if (url.endsWith('.webp')) r = { type: 'image/webp', body: WEBP };
    else if (url.endsWith('/404.png')) r = { status: 404, type: 'text/html', body: Buffer.from('introuvable') };
    else r = { type: 'image/png; charset=binary', body: PNG };
  }
  const extra = Object.fromEntries(Object.entries(r.entetes || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return { status: r.status || 200, entetes: { 'content-type': r.type || '', ...extra }, corps: r.body || Buffer.alloc(0) };
};
I._reseau.lookup = fauxLookup;
I._reseau.requete = fauxTransport;
const redirige = (vers, status = 302) => ({ status, entetes: { location: vers }, body: Buffer.alloc(0) });
const urlsDepuis = (i) => appelsWeb.slice(i).map((a) => a.url);
async function erreurDe(promesse) {
  try { await promesse; return null; } catch (e) { return e; }
}

(async () => {
  console.log('\n1) Les profils du créateur viennent du .env (BOT_PROFILS)');
  {
    const liste = I.profils();
    V('deux profils lus', liste.length === 2, JSON.stringify(liste));
    V('… identifiés par l\'empreinte de leur nom (pas leur position), avec nom et photo',
      liste[0].id === I.empreinteProfil('Arès') && /^[0-9a-f]{8}$/.test(liste[0].id) && liste[0].nom === 'Arès' && liste[0].avatar === 'https://cdn.test/ares.png', JSON.stringify(liste[0]));
    V('… un profil sans photo reste valable', liste[1].id === I.empreinteProfil('Oy Bot?') && liste[1].avatar === null);
  }

  console.log('\n2) Poser nom + photo sur UN serveur : PATCH /guilds/{id}/members/@me');
  {
    const appels = [];
    const guild = {
      id: 'G1',
      client: { user: { username: 'BotGlobal' }, rest: { patch: async (route, opts) => { appels.push({ route, body: opts.body }); } } },
      members: { me: { displayName: 'BotGlobal', nickname: null } },
    };
    const corps = await I.appliquer(guild, { nom: 'Arès', avatarUrl: 'https://cdn.test/ares.png' });
    V('la route est celle du membre courant', appels[0]?.route === '/guilds/G1/members/@me', appels[0]?.route);
    V('le pseudo part dans « nick »', appels[0]?.body?.nick === 'Arès');
    V('la photo part en data URI avec le vrai type', /^data:image\/png;base64,/.test(appels[0]?.body?.avatar || ''), String(corps.avatar).slice(0, 30));
    const cfg = getGuildConfig('G1');
    V('… et le réglage est enregistré pour le dashboard', cfg.bot_nick === 'Arès' && cfg.bot_avatar_url === 'https://cdn.test/ares.png');

    let erreur = null;
    await I.appliquer(guild, { avatarUrl: 'https://cdn.test/autre.png' }).catch((e) => { erreur = e; });
    V('une deuxième photo en moins de dix minutes est refusée AVANT Discord', /réessayez dans/.test(erreur?.message || ''), erreur?.message);
    V('… sans appel réseau supplémentaire', appels.length === 1);

    I._dernierAvatar.delete('G1');
    erreur = null;
    await I.appliquer(guild, { avatarUrl: 'https://cdn.test/photo.webp' }).catch((e) => { erreur = e; });
    V('un webp est refusé en disant quoi utiliser', /PNG, JPG ou GIF/.test(erreur?.message || ''), erreur?.message);
    V('… et le dit par son nom (WEBP)', /WEBP/.test(erreur?.message || ''));
    V('… sans rien envoyer à Discord', appels.length === 1);
    erreur = null;
    await I.appliquer(guild, { avatarUrl: 'https://cdn.test/404.png' }).catch((e) => { erreur = e; });
    V('une photo introuvable est dite telle quelle', /HTTP 404/.test(erreur?.message || ''), erreur?.message);

    appels.length = 0;
    await I.appliquer(guild, { nom: null, avatarUrl: null, profil: null });
    V('retour au profil global = nick et avatar à null', appels[0]?.body?.nick === null && appels[0]?.body?.avatar === null, JSON.stringify(appels[0]?.body));
    V('… et les colonnes sont vidées', getGuildConfig('G1').bot_nick === null && getGuildConfig('G1').bot_avatar_url === null);

    I._dernierAvatar.delete('G1');
    appels.length = 0;
    const ares = I.empreinteProfil('Arès');
    const pose = await I.appliquerProfil(guild, ares);
    V('choisir un profil pose son nom et sa photo', appels[0]?.body?.nick === 'Arès' && /^data:image\/png/.test(appels[0]?.body?.avatar || ''));
    V('… retient le profil choisi par son identifiant stable', getGuildConfig('G1').bot_profil === ares, getGuildConfig('G1').bot_profil);
    V('… et le renvoie (son nom sert au message)', pose?.nom === 'Arès');
    erreur = null;
    appels.length = 0;
    await I.appliquerProfil(guild, '9').catch((e) => { erreur = e; });
    V('un profil inconnu est refusé en disant pourquoi, sans rien poser', /retiré de la liste/.test(erreur?.message || '') && /\/config/.test(erreur?.message || '') && !appels.length, erreur?.message);
  }

  console.log('\n3) Le nom du bot dans les cartes suit le pseudo du serveur');
  {
    const client = { user: { username: 'BotGlobal' } };
    V('avec un pseudo, c\'est le pseudo', nomDuBot(client, { members: { me: { displayName: 'Arès' } } }) === 'Arès');
    V('sans serveur, le nom global', nomDuBot(client, null) === 'BotGlobal');
    for (const f of ['src/utils/reponse.js', 'src/commands/esthetique.js', 'src/events/guildMemberAdd.js']) {
      const src = fs.readFileSync(`${__dirname}/../${f}`, 'utf8');
      V(`${f} passe par nomDuBot`, /nomDuBot\(/.test(src) && !/client\.user\.username\} •/.test(src));
    }
  }

  console.log('\n4) /interact : bang, punch, kill — et le bisou sur la joue n\'est plus un baiser');
  {
    const itx = require('../src/commands/interact');
    for (const lang of ['fr', 'en', 'es', 'de', 'ru']) {
      const a = itx.LOCALES[lang].actions;
      V(`${lang} : bang, punch, kill traduits`, ['bang', 'punch', 'kill'].every((k) => a[k]?.name && a[k].phrase('A', 'B') && a[k].count(3) && a[k].back));
    }
    const srcCmd = fs.readFileSync(`${__dirname}/../src/commands/interact.js`, 'utf8');
    V('les trois sous-commandes existent', ['bang', 'punch', 'kill'].every((k) => new RegExp(`\\.setName\\('${k}'\\)`).test(srcCmd)));
    const C = itx.CATEGORIES_GIF;
    V('le bisou sur la joue ne demande JAMAIS « kiss » à une source',
      Array.isArray(C.peck) && C.peck.every(([, cat]) => cat !== 'kiss'), JSON.stringify(C.peck));
    V('… mais a bien une source', C.peck.length > 0);
    V('chaque nouvelle action a au moins une source', ['bang', 'punch', 'kill'].every((k) => (C[k] || []).length > 0));
    // waifu.pics est la seule à connaître « kill », et son endpoint tombe :
    // une seule source serait une seule panne.
    V('kill a une source de secours', C.kill.length >= 2 && C.kill[0][0] === 'waifu', JSON.stringify(C.kill));
    V('toutes les sources citées existent', Object.values(C).flat().every(([cle]) => itx.SOURCES_GIF[cle]));
    const src = fs.readFileSync(`${__dirname}/../src/commands/interact.js`, 'utf8');
    V('la réserve est rangée sous la vraie catégorie', /memoriserGif\(category, gif\)/.test(src) && /gifsAuHasard\.all\(category\)/.test(src));
  }

  console.log('\n5) Liens acceptés : le lien de partage devient le lien de l\'image');
  {
    const N = I.normaliserUrlImage;
    const cas = [
      ['imgur, page d\'une image', 'https://imgur.com/AbCdEf1', 'https://i.imgur.com/AbCdEf1.png'],
      ['imgur mobile', 'https://m.imgur.com/AbCdEf1', 'https://i.imgur.com/AbCdEf1.png'],
      ['imgur avec extension', 'https://imgur.com/AbCdEf1.jpg', 'https://i.imgur.com/AbCdEf1.jpg'],
      ['imgur .gifv → GIF', 'https://i.imgur.com/AbCdEf1.gifv', 'https://i.imgur.com/AbCdEf1.gif'],
      ['imgur .mp4 → GIF', 'https://i.imgur.com/AbCdEf1.mp4', 'https://i.imgur.com/AbCdEf1.gif'],
      ['imgur _d.webp?maxwidth → png', 'https://i.imgur.com/AbCdEf1_d.webp?maxwidth=760&fidelity=grand', 'https://i.imgur.com/AbCdEf1.png'],
      ['imgur, un album reste une page (og:image)', 'https://imgur.com/a/XyZ12ab', 'https://imgur.com/a/XyZ12ab'],
      ['Dropbox dl=0 → raw=1', 'https://www.dropbox.com/s/abc123/photo.png?dl=0', 'https://www.dropbox.com/s/abc123/photo.png?raw=1'],
      ['Dropbox scl garde rlkey', 'https://www.dropbox.com/scl/fi/abc/photo.png?rlkey=xyz&dl=0', 'https://www.dropbox.com/scl/fi/abc/photo.png?rlkey=xyz&raw=1'],
      ['Google Drive file/d/ID', 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing', 'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp'],
      ['Google Drive open?id=', 'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp', 'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp'],
      ['GitHub blob → raw', 'https://github.com/moi/depot/blob/main/img/bot.png', 'https://raw.githubusercontent.com/moi/depot/main/img/bot.png'],
      ['GitHub raw → raw', 'https://github.com/moi/depot/raw/main/bot.gif', 'https://raw.githubusercontent.com/moi/depot/main/bot.gif'],
      ['Discord media format=webp → png', 'https://media.discordapp.net/attachments/1/2/a.png?ex=1&is=2&hm=3&format=webp&quality=lossless',
        'https://media.discordapp.net/attachments/1/2/a.png?ex=1&is=2&hm=3&format=png&quality=lossless'],
      ['Discord cdn format=webp → png', 'https://cdn.discordapp.com/attachments/1/2/a.png?format=webp', 'https://cdn.discordapp.com/attachments/1/2/a.png?format=png'],
      ['Discord avatar .webp → .png', 'https://cdn.discordapp.com/avatars/1/abc.webp?size=512', 'https://cdn.discordapp.com/avatars/1/abc.png?size=512'],
      ['Discord avatar animé a_… → .gif', 'https://cdn.discordapp.com/avatars/1/a_abc.webp', 'https://cdn.discordapp.com/avatars/1/a_abc.gif'],
      ['Discord émoji animé → .gif', 'https://cdn.discordapp.com/emojis/123.webp?animated=true', 'https://cdn.discordapp.com/emojis/123.gif?animated=true'],
      ['Giphy, page d\'un GIF', 'https://giphy.com/gifs/chat-drole-Ab12Cd34', 'https://media.giphy.com/media/Ab12Cd34/giphy.gif'],
      ['Giphy .webp → .gif', 'https://media.giphy.com/media/Ab12Cd34/giphy.webp', 'https://media.giphy.com/media/Ab12Cd34/giphy.gif'],
      ['Gyazo, page → image', 'https://gyazo.com/0123456789abcdef0123456789abcdef', 'https://i.gyazo.com/0123456789abcdef0123456789abcdef.png'],
      ['Reddit preview → i.redd.it', 'https://preview.redd.it/mon-titre-v0-abc123.png?width=640&auto=webp&s=x', 'https://i.redd.it/abc123.png'],
      ['Twitter format=webp → jpg', 'https://pbs.twimg.com/media/XYZ?format=webp&name=small', 'https://pbs.twimg.com/media/XYZ?format=jpg&name=small'],
      ['Google Images : l\'image dans le lien', 'https://www.google.com/imgres?imgurl=https%3A%2F%2Fi.imgur.com%2FAbCdEf1.webp&imgrefurl=x',
        'https://i.imgur.com/AbCdEf1.png'],
      ['lien entre chevrons <…>', '<https://i.imgur.com/AbCdEf1.png>', 'https://i.imgur.com/AbCdEf1.png'],
      ['lien sans https://', 'i.imgur.com/AbCdEf1.png', 'https://i.imgur.com/AbCdEf1.png'],
      ['ibb.co : page, lue plus tard', 'https://ibb.co/AbC1234', 'https://ibb.co/AbC1234'],
      ['postimg : page, lue plus tard', 'https://postimg.cc/AbC1234', 'https://postimg.cc/AbC1234'],
      ['tenor : page, lue plus tard', 'https://tenor.com/view/chat-gif-123456', 'https://tenor.com/view/chat-gif-123456'],
      ['lien direct inconnu : intact', 'https://exemple.fr/dossier/photo.png?v=2', 'https://exemple.fr/dossier/photo.png?v=2'],
      ['data URI : intacte', 'data:image/png;base64,AAAA', 'data:image/png;base64,AAAA'],
    ];
    for (const [nom, entree, attendu] of cas) {
      const obtenu = N(entree);
      V(nom, obtenu === attendu, `${obtenu} ≠ ${attendu}`);
    }
    V('variante non-webp : Discord media → format=png', I.varianteSansWebp('https://media.discordapp.net/a/b.png?width=10') === 'https://media.discordapp.net/a/b.png?width=10&format=png');
    V('variante non-webp : imgur png → jpg', I.varianteSansWebp('https://i.imgur.com/AbCdEf1.png') === 'https://i.imgur.com/AbCdEf1.jpg');
    V('variante non-webp : hébergeur inconnu → aucune (pas de devinette)', I.varianteSansWebp('https://cdn.test/photo.webp') === null);
  }

  console.log('\n6) Le format se reconnaît aux PREMIERS OCTETS, pas à l\'en-tête');
  {
    const T = I.typeImageDesOctets;
    V('89504E47 → PNG', T(PNG) === 'image/png');
    V('FFD8FF → JPG', T(JPG) === 'image/jpeg');
    V('47494638 → GIF', T(GIF) === 'image/gif');
    V('RIFF…WEBP → WEBP', T(WEBP) === 'image/webp');
    V('ftypavif → AVIF', T(AVIF) === 'image/avif');
    V('une page HTML est reconnue', T(page('')) === 'text/html');
    V('du texte quelconque → inconnu', T(Buffer.from('bonjour tout le monde')) === null);

    const n = appelsWeb.length;
    WEB.set('https://s3.test/photo', { type: 'application/octet-stream', body: JPG });
    const jpeg = await I.dataUriDepuis('https://s3.test/photo');
    V('« application/octet-stream » avec des octets JPG → accepté en JPG', /^data:image\/jpeg;base64,/.test(jpeg), jpeg.slice(0, 30));
    V('… avec un en-tête Accept qui préfère PNG, JPG et GIF', /^image\/png,image\/jpeg,image\/gif/.test(appelsWeb[n]?.accept || ''), appelsWeb[n]?.accept);

    WEB.set('https://cdn.test/menteur.png', { type: 'image/png', body: WEBP });
    const e1 = await erreurDe(I.dataUriDepuis('https://cdn.test/menteur.png'));
    V('un « image/png » qui est en fait du webp est refusé', /WEBP/.test(e1?.message || '') && /PNG, JPG ou GIF/.test(e1?.message || ''), e1?.message);
    V('… et le message dit quoi faire (enregistrer en PNG, lien direct, fichier)', /enregistrez-la en PNG/.test(e1?.message || '') && /fichier/.test(e1?.message || ''));

    WEB.set('https://cdn.test/photo.avif', { type: 'image/avif', body: AVIF });
    const e2 = await erreurDe(I.dataUriDepuis('https://cdn.test/photo.avif'));
    V('un AVIF est refusé en le nommant', /format AVIF refusé/.test(e2?.message || ''), e2?.message);

    WEB.set('https://cdn.test/texte', { type: 'application/json', body: Buffer.from('{"a":1}') });
    const e3 = await erreurDe(I.dataUriDepuis('https://cdn.test/texte'));
    V('un contenu qui n\'est pas une image est refusé clairement', /pas une image reconnue/.test(e3?.message || '') && /application\/json/.test(e3?.message || ''), e3?.message);

    WEB.set('https://cdn.test/enorme.png', { type: 'image/png', body: PNG, entetes: { 'content-length': String(9 * 1024 * 1024) } });
    const e4 = await erreurDe(I.dataUriDepuis('https://cdn.test/enorme.png'));
    V('une image annoncée à 9 Mo est refusée sans la lire', /trop lourde/.test(e4?.message || '') && /8 Mo maximum/.test(e4?.message || ''), e4?.message);

    const e5 = await erreurDe(I.dataUriDepuis('ftp://exemple.fr/photo.png'));
    V('une adresse qui n\'est pas http(s) est refusée en proposant le fichier', /http\(s\)/.test(e5?.message || '') && /fichier/.test(e5?.message || ''));

    // Discord sert du webp malgré tout : on redemande format=png, UNE fois.
    const m = appelsWeb.length;
    WEB.set('https://media.discordapp.net/attachments/9/8/photo.png?width=300', { type: 'image/webp', body: WEBP });
    WEB.set('https://media.discordapp.net/attachments/9/8/photo.png?width=300&format=png', { type: 'image/png', body: PNG });
    const viaVariante = await I.dataUriDepuis('https://media.discordapp.net/attachments/9/8/photo.png?width=300');
    V('webp servi par Discord → la variante format=png est essayée et acceptée', /^data:image\/png/.test(viaVariante)
      && urlsDepuis(m).length === 2 && /format=png$/.test(urlsDepuis(m)[1]), JSON.stringify(urlsDepuis(m)));

    const k = appelsWeb.length;
    WEB.set('https://i.imgur.com/ZzZzZz1.png', { type: 'image/webp', body: WEBP });
    WEB.set('https://i.imgur.com/ZzZzZz1.jpg', { type: 'image/jpeg', body: JPG });
    const imgur = await I.dataUriDepuis('https://imgur.com/ZzZzZz1');
    V('imgur.com/ID → i.imgur.com/ID.png, webp → .jpg : JPG accepté', /^data:image\/jpeg/.test(imgur), JSON.stringify(urlsDepuis(k)));
  }

  console.log('\n7) Une PAGE web : son image (og:image) est lue, une seule fois');
  {
    let n = appelsWeb.length;
    WEB.set('https://ibb.co/AbC1234', { type: 'text/html; charset=utf-8', body: page('<meta property="og:image" content="https://i.ibb.co/xyz/photo.png">') });
    WEB.set('https://i.ibb.co/xyz/photo.png', { type: 'image/png', body: PNG });
    const ibb = await I.dataUriDepuis('https://ibb.co/AbC1234');
    V('ibb.co : la page donne son image, qui est téléchargée', /^data:image\/png/.test(ibb) && urlsDepuis(n)[1] === 'https://i.ibb.co/xyz/photo.png', JSON.stringify(urlsDepuis(n)));

    n = appelsWeb.length;
    WEB.set('https://postimg.cc/AbC1234', { type: 'text/html', body: page('<meta content="/img/p.gif?a=1&amp;b=2" property="og:image" />') });
    WEB.set('https://postimg.cc/img/p.gif?a=1&b=2', { type: 'image/gif', body: GIF });
    const post = await I.dataUriDepuis('https://postimg.cc/AbC1234');
    V('postimg : attributs dans l\'autre ordre, adresse relative et &amp; décodé', /^data:image\/gif/.test(post), JSON.stringify(urlsDepuis(n)));

    n = appelsWeb.length;
    WEB.set('https://tenor.com/view/chat-gif-123456', { type: 'text/html', body: page('<meta name="twitter:image" content="https://media.tenor.com/abc/chat.gif">') });
    WEB.set('https://media.tenor.com/abc/chat.gif', { type: 'image/gif', body: GIF });
    const tenor = await I.dataUriDepuis('https://tenor.com/view/chat-gif-123456');
    V('tenor : twitter:image sert de repli', /^data:image\/gif/.test(tenor), JSON.stringify(urlsDepuis(n)));

    WEB.set('https://exemple.fr/galerie', { type: 'text/html', body: page('<meta name="description" content="rien">') });
    const e1 = await erreurDe(I.dataUriDepuis('https://exemple.fr/galerie'));
    V('une page sans image : « page web, pas une image » + quoi faire', /page web, pas une image/.test(e1?.message || '') && /Copier l'adresse de l'image/.test(e1?.message || ''), e1?.message);

    n = appelsWeb.length;
    WEB.set('https://boucle.test/a', { type: 'text/html', body: page('<meta property="og:image" content="https://boucle.test/b">') });
    WEB.set('https://boucle.test/b', { type: 'text/html', body: page('<meta property="og:image" content="https://boucle.test/c">') });
    const e2 = await erreurDe(I.dataUriDepuis('https://boucle.test/a'));
    V('une page qui renvoie vers une autre page : UNE seule relance', /page web/.test(e2?.message || '') && urlsDepuis(n).length === 2, JSON.stringify(urlsDepuis(n)));

    // Gyazo : l'image directe est un JPG, le .png deviné n'existe pas — la
    // page d'origine sert de repli.
    n = appelsWeb.length;
    const H = 'fedcba9876543210fedcba9876543210';
    WEB.set(`https://i.gyazo.com/${H}.png`, { status: 404, type: 'text/plain', body: Buffer.from('non') });
    WEB.set(`https://gyazo.com/${H}`, { type: 'text/html', body: page(`<meta property="og:image" content="https://i.gyazo.com/${H}.jpg">`) });
    WEB.set(`https://i.gyazo.com/${H}.jpg`, { type: 'image/jpeg', body: JPG });
    const gy = await I.dataUriDepuis(`https://gyazo.com/${H}`);
    V('Gyazo : lien deviné introuvable → la page d\'origine, puis son og:image', /^data:image\/jpeg/.test(gy) && urlsDepuis(n).length === 3, JSON.stringify(urlsDepuis(n)));
    // Drive non partagé : page de connexion — son og:image serait un logo.
    n = appelsWeb.length;
    WEB.set('https://drive.google.com/uc?export=download&id=1PrivePriveePrive', redirige('https://accounts.google.com/ServiceLogin?continue=x'));
    WEB.set('https://drive.google.com/file/d/1PrivePriveePrive/view', redirige('https://accounts.google.com/ServiceLogin?continue=y'));
    for (const suite of ['x', 'y']) {
      WEB.set(`https://accounts.google.com/ServiceLogin?continue=${suite}`, {
        type: 'text/html', body: page('<meta property="og:image" content="https://www.google.com/logo.png">') });
    }
    const e3 = await erreurDe(I.dataUriDepuis('https://drive.google.com/file/d/1PrivePriveePrive/view'));
    V('Google Drive non partagé : le dit et dit quoi faire, sans suivre le logo de la page',
      /pas partagé publiquement/.test(e3?.message || '') && /Tous les utilisateurs disposant du lien/.test(e3?.message || '')
      && !urlsDepuis(n).includes('https://www.google.com/logo.png'), `${e3?.message} ${JSON.stringify(urlsDepuis(n))}`);
    V('extraction og:image seule (relative → absolue)', I.imageDeLaPage('<meta property="og:image" content="/x.png">', 'https://site.test/page') === 'https://site.test/x.png');
  }

  console.log('\n8) Data URI et fichier reçu (avatarDonnees) — l\'adresse STABLE est enregistrée');
  {
    const n = appelsWeb.length;
    const duri = `data:image/png;base64,${PNG.toString('base64')}`;
    V('une data URI directe est acceptée sans réseau', (await I.dataUriDepuis(duri)) === duri && appelsWeb.length === n);
    const e1 = await erreurDe(I.dataUriDepuis(`data:image/png;base64,${WEBP.toString('base64')}`));
    V('… mais ses octets font foi : un « png » qui est du webp est refusé', /WEBP/.test(e1?.message || ''), e1?.message);
    V('un Buffer GIF devient une data URI GIF', /^data:image\/gif;base64,/.test(I.donneesEnDataUri(GIF)));
    let e2 = null;
    try { I.donneesEnDataUri(Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)])); } catch (e) { e2 = e; }
    V('plus de 8 Mo : refusé avec la taille', /trop lourde \(8,0 Mo/.test(e2?.message || ''), e2?.message);

    const appels = [];
    let reponse = () => ({ avatar: 'a_hashgif', user: { id: 'BOT2' } });
    const guild = {
      id: 'G2',
      client: { user: { id: 'BOT2', username: 'BotGlobal' }, rest: { patch: async (route, opts) => { appels.push(opts.body); return reponse(); } } },
      members: { me: { id: 'BOT2', displayName: 'BotGlobal', nickname: null } },
    };
    await I.appliquer(guild, { avatarDonnees: GIF, profil: null });
    V('avatarDonnees (Buffer) : la photo part en data URI GIF', /^data:image\/gif;base64,/.test(appels[0]?.avatar || ''));
    V('… et c\'est l\'adresse STABLE de l\'avatar de membre qui est enregistrée',
      getGuildConfig('G2').bot_avatar_url === 'https://cdn.discordapp.com/guilds/G2/users/BOT2/avatars/a_hashgif.gif?size=512', getGuildConfig('G2').bot_avatar_url);

    I._dernierAvatar.delete('G2');
    reponse = () => undefined;
    await I.appliquer(guild, { avatarDonnees: `data:image/jpeg;base64,${JPG.toString('base64')}` });
    V('avatarDonnees en data URI JPG : posée', /^data:image\/jpeg/.test(appels[1]?.avatar || ''));
    V('… réponse sans avatar : RIEN n\'est enregistré plutôt qu\'une data URI', getGuildConfig('G2').bot_avatar_url === null);

    I._dernierAvatar.delete('G2');
    const signee = 'https://cdn.discordapp.com/attachments/1/2/moi.png?ex=6512&is=6511&hm=abcdef';
    await I.appliquer(guild, { avatarUrl: signee });
    V('une adresse de pièce jointe signée (qui expire) n\'est jamais enregistrée', getGuildConfig('G2').bot_avatar_url === null);

    I._dernierAvatar.delete('G2');
    reponse = () => ({ avatar: 'hashpng' });
    await I.appliquer(guild, { avatarUrl: 'https://imgur.com/AbCdEf1' });
    V('un lien imgur posé → l\'adresse stable PNG (sans id dans la réponse : celui du bot)',
      getGuildConfig('G2').bot_avatar_url === 'https://cdn.discordapp.com/guilds/G2/users/BOT2/avatars/hashpng.png?size=512', getGuildConfig('G2').bot_avatar_url);

    const ap = appelsWeb.length;
    const pj = (o) => ({ url: 'https://cdn.discordapp.com/ephemeral-attachments/1/2/f.png?ex=1&is=2&hm=3', name: 'f.png', contentType: 'image/png', size: 1000, ...o });
    const e3 = await erreurDe(I.photoDepuisFichier(pj({ contentType: 'image/webp', name: 'f.webp' })));
    V('fichier WEBP : refusé AVANT de le télécharger', /WEBP/.test(e3?.message || '') && appelsWeb.length === ap, e3?.message);
    const e4 = await erreurDe(I.photoDepuisFichier(pj({ size: 9 * 1024 * 1024 })));
    V('fichier de 9 Mo : refusé avant téléchargement', /9,0 Mo, 8 Mo maximum/.test(e4?.message || '') && appelsWeb.length === ap, e4?.message);
    const e5 = await erreurDe(I.photoDepuisFichier(pj({ contentType: 'application/pdf', name: 'cv.pdf' })));
    V('fichier PDF : refusé en le nommant', /« cv\.pdf » refusé/.test(e5?.message || ''), e5?.message);
    const bon = await I.photoDepuisFichier(pj({ contentType: null, name: 'sans-type.PNG' }));
    V('fichier sans type mais .png : téléchargé puis vérifié aux octets', /^data:image\/png/.test(bon));
  }

  console.log('\n9) /config → 🪪 Identité du bot : modal avec et sans envoi de fichier');
  const CP = require('../src/utils/configPanel');
  const R = require('../src/utils/reponse');
  const appelsPatch = [];
  const ajoutsCache = [];
  // Discord renvoie le membre À JOUR : pseudo et photo tels que posés.
  let reponsePatch = (b) => ({
    ...('nick' in b ? { nick: b.nick } : {}),
    ...('avatar' in b ? { avatar: b.avatar ? 'hashfichier' : null } : {}),
    user: { id: 'BOT1' },
  });
  const BOT = { id: 'BOT1', username: 'BotGlobal' };
  class Coll extends Map {
    filter(f) { const m = new Coll(); for (const [k, v] of this) if (f(v, k)) m.set(k, v); return m; }
    find(f) { for (const v of this.values()) if (f(v)) return v; return undefined; }
  }
  // Le cache comme discord.js : `me` ne change QUE par `_add` (réponse REST
  // versée au cache) — ici, aucun GUILD_MEMBER_UPDATE n'arrive jamais.
  const guildeP = {
    id: 'GP', name: 'Labo', iconURL: () => null,
    client: { user: BOT, rest: { patch: async (route, opts) => { appelsPatch.push(opts.body); return reponsePatch(opts.body); } } },
    members: {
      me: { id: 'BOT1', displayName: 'BotGlobal', nickname: null, avatar: null, avatarURL() { return this.avatar ? `https://cdn.test/membres/${this.avatar}.png` : null; } },
      _add(d) {
        ajoutsCache.push(d);
        if ('nick' in d) { this.me.nickname = d.nick; this.me.displayName = d.nick || BOT.username; }
        if ('avatar' in d) this.me.avatar = d.avatar;
        return this.me;
      },
      cache: new Coll(), fetch: async () => null,
    },
    roles: { cache: new Coll() },
    channels: { cache: new Coll(), fetch: async () => null },
  };
  const membre = (id, admin) => ({ id, guild: guildeP, roles: { cache: new Map() },
    permissions: { has: (bit) => (admin ? true : bit === D.PermissionFlagsBits.ModerateMembers) } });
  const ADMIN = membre('u1', true);
  const STAFF = membre('u2', false);
  function itx({ type = 'bouton', customId, qui = ADMIN, valeurs = [], champs = {}, fichier = null, message = null } = {}) {
    const it = {
      guild: guildeP, guildId: 'GP', client: guildeP.client, user: { id: qui.id }, member: qui, customId, values: valeurs,
      channelId: 'C', deferred: false, replied: false, locale: 'fr',
      message: message || { id: 'PANNEAU', flags: 0, components: [], embeds: [{}] },
      inGuild: () => true,
      isMessageComponent: () => type !== 'modal',
      isButton: () => type === 'bouton', isStringSelectMenu: () => type === 'menu', isAnySelectMenu: () => type === 'menu',
      isModalSubmit: () => type === 'modal',
      fields: { getTextInputValue: (k) => champs[k] ?? '' },
      reponses: [], suivis: [], mises: [], modales: [], editions: [], journal: [],
      async reply(p) { this.journal.push('reply'); this.replied = true; this.reponses.push(p); return p; },
      async update(p) { this.journal.push('update'); this.replied = true; this.mises.push(p); return p; },
      async deferUpdate() { this.journal.push('deferUpdate'); this.deferred = true; },
      async deferReply() { this.journal.push('deferReply'); this.deferred = true; },
      async editReply(p) { this.journal.push('editReply'); this.editions.push(p); return p; },
      async followUp(p) { this.journal.push('followUp'); this.suivis.push(p); return p; },
      async showModal(m) { this.modales.push(m.toJSON ? m.toJSON() : m); },
    };
    // ⚠️ Comme discord.js : `isFromMessage` n'existe QUE sur un modal.
    if (type === 'modal') {
      it.isFromMessage = () => true;
      if (fichier !== null) it.fields.getUploadedFiles = (k) => (k === 'bot_avatar_fichier' && fichier ? { first: () => fichier } : null);
    }
    return it;
  }
  const texte = (o) => JSON.stringify(o);
  {
    const it = itx({ customId: 'cfgbotident' });
    await CP.handleConfigInteraction(it);
    const m = it.modales[0] || {};
    V('discord.js récente : le modal est fait de Labels (type 18)', m.custom_id === 'cfgbotidentmodal' && m.components?.length === 3 && m.components.every((c) => c.type === 18), texte(m));
    const fichierC = m.components?.[2]?.component || {};
    V('… dont un envoi de fichier (type 19) facultatif, une seule photo', fichierC.type === 19 && fichierC.custom_id === 'bot_avatar_fichier' && fichierC.required === false && fichierC.max_values === 1, texte(fichierC));
    V('… les champs texte gardent leurs ids, sans libellé propre (le Label l\'affiche)',
      m.components?.[0]?.component?.custom_id === 'bot_nick' && m.components?.[1]?.component?.custom_id === 'bot_avatar_url'
      && m.components.slice(0, 2).every((c) => c.component.type === 4 && c.component.label === undefined));
    V('… libellés ≤ 45, descriptions ≤ 100, titre ≤ 45 (limites Discord)',
      m.components?.every((c) => c.label.length <= 45 && (c.description || '').length <= 100) && m.title.length <= 45);
    V('… l\'aide cite les liens acceptés', /imgur, Discord, Dropbox, Google Drive, GitHub/.test(texte(m)));

    const sauve = { L: D.LabelBuilder, F: D.FileUploadBuilder };
    delete D.FileUploadBuilder;
    const ancien = itx({ customId: 'cfgbotident' });
    await CP.handleConfigInteraction(ancien);
    Object.assign(D, { LabelBuilder: sauve.L, FileUploadBuilder: sauve.F });
    const a = ancien.modales[0] || {};
    V('discord.js ancienne : modal texte classique (rangées type 1), sans Label', a.custom_id === 'cfgbotidentmodal'
      && a.components?.length === 2 && a.components.every((c) => c.type === 1 && c.components[0].type === 4), texte(a));
    V('… libellés ≤ 45, indications ≤ 100, et le repli `/config photo:` est annoncé',
      a.components?.every((r) => r.components[0].label.length <= 45 && (r.components[0].placeholder || '').length <= 100)
      && /\/config photo:/.test(texte(a)));

    const refuse = itx({ customId: 'cfgbotident', qui: STAFF });
    await CP.handleConfigInteraction(refuse);
    V('le staff sans administration ne peut pas l\'ouvrir', /administration/.test(refuse.reponses[0]?.content || '') && !refuse.modales.length);

    const vue = itx({ type: 'menu', customId: 'cfgcat', valeurs: ['identitebot'] });
    await CP.handleConfigInteraction(vue);
    const vueTexte = texte(vue.mises[0]);
    V('la vue Identité annonce les liens acceptés, le fichier et `/config photo:`',
      /imgur, Discord, Dropbox, Google Drive, GitHub/.test(vueTexte) && /fichier de votre appareil/.test(vueTexte) && /\/config photo:/.test(vueTexte));
    V('… et tient dans 5 rangées', (vue.mises[0]?.components || []).length <= 5);
  }
  {
    I._dernierAvatar.delete('GP');
    const piece = { url: 'https://cdn.discordapp.com/ephemeral-attachments/1/2/moi.png?ex=65&is=64&hm=ab', contentType: 'image/png', size: 2048, name: 'moi.png' };
    const n = appelsWeb.length;
    const it = itx({ type: 'modal', customId: 'cfgbotidentmodal', champs: { bot_nick: 'Arès', bot_avatar_url: '' }, fichier: piece });
    await CP.handleConfigInteraction(it);
    V('modal avec fichier : la pièce jointe est téléchargée', urlsDepuis(n).includes(piece.url), JSON.stringify(urlsDepuis(n)));
    V('… puis posée (data URI PNG) avec le nom', /^data:image\/png/.test(appelsPatch[0]?.avatar || '') && appelsPatch[0]?.nick === 'Arès', texte(appelsPatch[0]).slice(0, 80));
    const cfg = getGuildConfig('GP');
    V('… l\'adresse signée de la pièce jointe n\'est PAS enregistrée, l\'adresse stable si',
      cfg.bot_avatar_url === 'https://cdn.discordapp.com/guilds/GP/users/BOT1/avatars/hashfichier.png?size=512', cfg.bot_avatar_url);
    V('… le panneau se met à jour en une fois (update, sans différer)', it.mises.length === 1 && !it.journal.includes('deferUpdate') && !it.suivis.length, it.journal.join(','));
    // 🔄 Le panneau montre ce que Discord a CONFIRMÉ, sans attendre
    // GUILD_MEMBER_UPDATE (qui n'arrive jamais dans ce test).
    const vue = texte(it.mises[0]);
    V('… la réponse du PATCH est versée au cache (guild.members._add)', ajoutsCache.length === 1 && ajoutsCache[0].nick === 'Arès' && ajoutsCache[0].avatar === 'hashfichier', texte(ajoutsCache));
    V('… le panneau rafraîchi montre le NOUVEAU nom et la photo personnalisée',
      /Nom affiché sur ce serveur : \*\*Arès\*\*/.test(vue) && !/nom global du bot/.test(vue) && /Photo sur ce serveur : \*\*personnalisée\*\*/.test(vue), vue.slice(0, 300));
    const reset = (it.mises[0]?.components || []).flatMap((r) => (r.toJSON ? r.toJSON() : r).components || []).find((c) => c.custom_id === 'cfgbotreset');
    V('… et « Profil global » y est actif', reset && !reset.disabled, texte(reset));

    // Changer SEULEMENT le nom : le lien inchangé ne retouche pas la photo —
    // sinon la limite des dix minutes de Discord bloquerait le renommage.
    appelsPatch.length = 0;
    const nom = itx({ type: 'modal', customId: 'cfgbotidentmodal', champs: { bot_nick: 'Arès II', bot_avatar_url: cfg.bot_avatar_url }, fichier: false });
    await CP.handleConfigInteraction(nom);
    V('renommer seul (lien inchangé) : pas de photo renvoyée, donc pas de refus des 10 min',
      appelsPatch.length === 1 && appelsPatch[0].nick === 'Arès II' && !('avatar' in appelsPatch[0]) && !nom.reponses.length && nom.mises.length === 1, texte(appelsPatch[0]));

    appelsPatch.length = 0;
    I._dernierAvatar.delete('GP');
    const webp = itx({ type: 'modal', customId: 'cfgbotidentmodal', champs: { bot_nick: 'Arès' }, fichier: { ...piece, contentType: 'image/webp', name: 'x.webp' } });
    await CP.handleConfigInteraction(webp);
    V('fichier WEBP dans le modal : refus clair, rien posé', /❌ Identité du bot : cette image est au format WEBP/.test(webp.reponses[0]?.content || '') && !appelsPatch.length, texte(webp.reponses[0]));
  }
  {
    // ⏱️ Un téléchargement LENT : l'accusé n'arrive qu'à la dernière seconde
    // (deferUpdate), puis le panneau se modifie et la confirmation suit.
    const margeAvant = R.MARGE;
    R.MARGE = 40; // la marge réelle est de 2,2 s
    I._dernierAvatar.delete('GP');
    WEB.set('https://lent.test/photo.gif', async () => { await attendre(150); return { type: 'image/gif', body: GIF }; });
    const it = itx({ type: 'modal', customId: 'cfgbotidentmodal', champs: { bot_nick: 'Lent', bot_avatar_url: 'https://lent.test/photo.gif' }, fichier: null });
    await CP.handleConfigInteraction(it);
    V('travail lent : deferUpdate AVANT la fin, jamais deferReply', it.journal[0] === 'deferUpdate' && !it.journal.includes('deferReply'), it.journal.join(','));
    V('… puis le panneau est modifié (editReply) et la confirmation suit en éphémère',
      it.editions.length === 1 && /Identité du bot/.test(texte(it.editions[0])) && /^✅/.test(it.suivis[0]?.content || '') && it.suivis[0]?.flags === 64, it.journal.join(','));
    V('… sans update() impossible après un accusé', !it.mises.length);

    I._dernierAvatar.delete('GP');
    WEB.set('https://lent.test/photo2.gif', async () => { await attendre(150); return { type: 'image/gif', body: GIF }; });
    const carte = itx({ type: 'modal', customId: 'cfgbotidentmodal', champs: { bot_nick: 'Lent', bot_avatar_url: 'https://lent.test/photo2.gif' },
      fichier: null, message: { id: 'P2', flags: 1 << 15, components: [] } });
    await CP.handleConfigInteraction(carte);
    const ed = carte.editions[0] || {};
    V('panneau en CARTE : la modification est reconstruite en composants (drapeau V2, sans embeds)',
      (ed.flags & (1 << 15)) && Array.isArray(ed.components) && ed.components.length > 0 && !ed.embeds, texte(ed).slice(0, 120));

    I._dernierAvatar.delete('GP');
    WEB.set('https://lent.test/404.png', async () => { await attendre(150); return { status: 404, type: 'text/plain', body: Buffer.from('x') }; });
    const rate = itx({ type: 'modal', customId: 'cfgbotidentmodal', champs: { bot_nick: 'Lent', bot_avatar_url: 'https://lent.test/404.png' }, fichier: null });
    await CP.handleConfigInteraction(rate);
    V('échec lent : accusé, puis l\'erreur suit en éphémère (followUp), panneau intact',
      rate.journal[0] === 'deferUpdate' && /❌ Identité du bot : .*HTTP 404/.test(rate.suivis[0]?.content || '') && !rate.editions.length, rate.journal.join(','));
    R.MARGE = margeAvant;

    // Un menu n'a pas `isFromMessage` : le panneau plantait APRÈS avoir posé le profil.
    I._dernierAvatar.delete('GP');
    const menu = itx({ type: 'menu', customId: 'cfgbotprofil', valeurs: ['__global__'] });
    await CP.handleConfigInteraction(menu);
    V('menu des profils : la vue se met à jour, sans « erreur du panneau »', menu.mises.length === 1 && !menu.reponses.length && !menu.suivis.length, menu.journal.join(','));
  }

  console.log('\n10) /config photo: — le repli qui marche avec toutes les discord.js');
  {
    const CMD = require('../src/commands/config');
    const src = fs.readFileSync(`${__dirname}/../src/commands/config.js`, 'utf8');
    V('/config a une option pièce jointe « photo », facultative', /addAttachmentOption\(/.test(src) && /setName\('photo'\)/.test(src) && /setRequired\(false\)/.test(src));
    const desc = /setName\('photo'\)\s*\.setDescription\('([^']*)'\)/.exec(src)?.[1] || '';
    V('… description ≤ 100 caractères', desc.length > 0 && desc.length <= 100, String(desc.length));
    const commande = (qui, piece) => ({
      guild: guildeP, guildId: 'GP', client: guildeP.client, user: { id: qui.id }, member: qui, channelId: 'C', deferred: false, replied: false,
      options: { getAttachment: (k) => (k === 'photo' ? piece : null) },
      reponses: [], journal: [],
      async reply(p) { this.journal.push('reply'); this.replied = true; this.reponses.push(p); return p; },
      async deferReply() { this.journal.push('deferReply'); this.deferred = true; },
      async editReply(p) { this.journal.push('editReply'); this.reponses.push(p); return p; },
    });
    const gif = { url: 'https://cdn.discordapp.com/attachments/5/6/logo.gif?ex=1&is=2&hm=3', contentType: 'image/gif', size: 5000, name: 'logo.gif' };
    WEB.set(gif.url, { type: 'image/gif', body: GIF });
    I._dernierAvatar.delete('GP');
    appelsPatch.length = 0;
    reponsePatch = () => ({ avatar: 'a_logo', user: { id: 'BOT1' } });
    const it = commande(ADMIN, gif);
    await CMD.execute(it);
    const r = it.reponses[0] || {};
    V('admin + photo : posée (data URI GIF)', /^data:image\/gif/.test(appelsPatch[0]?.avatar || ''), texte(appelsPatch[0]).slice(0, 60));
    V('… réponse en un seul message (reply), éphémère, avec la vue Identité à jour',
      it.journal.join(',') === 'reply' && r.flags === 64 && /^✅/.test(r.content || '') && /Identité du bot/.test(texte(r.embeds)), it.journal.join(','));
    V('… adresse stable GIF enregistrée', getGuildConfig('GP').bot_avatar_url === 'https://cdn.discordapp.com/guilds/GP/users/BOT1/avatars/a_logo.gif?size=512');

    appelsPatch.length = 0;
    const staff = commande(STAFF, gif);
    await CMD.execute(staff);
    V('staff + photo : refusé (administration), rien posé', /administration/.test(staff.reponses[0]?.content || '') && !appelsPatch.length);

    I._dernierAvatar.delete('GP');
    const mauvais = commande(ADMIN, { ...gif, contentType: 'image/webp', name: 'x.webp' });
    await CMD.execute(mauvais);
    V('admin + WEBP : refus « Photo du bot » qui dit quoi faire, et la vue quand même',
      /^❌ Photo du bot : cette image est au format WEBP/.test(mauvais.reponses[0]?.content || '') && mauvais.reponses[0]?.embeds?.length === 1);

    const sans = commande(STAFF, null);
    await CMD.execute(sans);
    V('sans photo : le panneau habituel', sans.reponses[0]?.flags === 64 && (sans.reponses[0]?.components || []).length > 0 && !sans.reponses[0]?.content);
  }

  console.log('\n11) API du tableau de bord (managedApi) : photo et profils à chaud');
  {
    const { startManagedApi } = require('../src/managedApi');
    const dossier = fs.mkdtempSync(path.join(RACINE, 'api-'));
    const clientApi = {
      isReady: () => true, user: BOT, guilds: { cache: new Map([['GP', guildeP]]) }, users: { cache: new Map() }, channels: { cache: new Map() },
    };
    const journal = console.log;
    console.log = () => {};
    startManagedApi(clientApi, dossier);
    let port = null;
    for (let i = 0; i < 50 && !port; i++) {
      await attendre(20);
      try { port = Number(fs.readFileSync(path.join(dossier, 'api.port'), 'utf8')); } catch { /* pas encore */ }
    }
    console.log = journal;
    const poster = async (route, corps) => {
      const r = await fetch(`http://127.0.0.1:${port}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
      return { status: r.status, data: await r.json() };
    };
    V('l\'API locale démarre', Boolean(port));
    if (port) {
      I._dernierAvatar.delete('GP');
      reponsePatch = () => ({ avatar: 'hashsite', user: { id: 'BOT1' } });
      const duri = `data:image/png;base64,${PNG.toString('base64')}`;
      const r1 = await poster('/config', { guildId: 'GP', key: 'bot_avatar_url', value: duri });
      V('POST /config bot_avatar_url en data URI (site local) : accepté', r1.status === 200 && r1.data.ok, texte(r1));
      V('… et renvoie l\'adresse stable, jamais la data URI', r1.data.value === 'https://cdn.discordapp.com/guilds/GP/users/BOT1/avatars/hashsite.png?size=512', texte(r1.data).slice(0, 120));

      const r2 = await poster('/profils-bot', { profils: [
        { id: 'zeus01', nom: 'Zeus', avatar: 'https://site.test/uploads/avatars/bot_1.png' }, { nom: '', avatar: 'https://x/y.png' },
        { id: 'pas valide !', nom: 'Héra', avatar: 'javascript:alert(1)' },
      ] });
      V('POST /profils-bot : les profils sont pris à chaud (sans redémarrer)', r2.status === 200 && r2.data.profils === 2, texte(r2));
      const liste = I.profils();
      V('… nettoyés : sans nom écarté, adresse non http(s) vidée',
        liste.length === 2 && liste[0].nom === 'Zeus' && liste[0].avatar === 'https://site.test/uploads/avatars/bot_1.png' && liste[1].nom === 'Héra' && liste[1].avatar === null, texte(liste));
      V('… l\'identifiant explicite est GARDÉ, un identifiant invalide cède la place à l\'empreinte du nom',
        liste[0].id === 'zeus01' && liste[1].id === I.empreinteProfil('Héra'), texte(liste));
      V('… et retenus en base (repli du .env)', /Zeus/.test(require('../src/utils/botTeam').state('bot_profils') || '') && /zeus01/.test(require('../src/utils/botTeam').state('bot_profils') || ''));

      // GET /parametres : le site reçoit l'identifiant STABLE du profil posé
      // (un ancien numéro de position est traduit), jamais un autre profil.
      const lireParametres = async () => {
        const r = await fetch(`http://127.0.0.1:${port}/parametres?guild=GP`);
        return { status: r.status, data: await r.json() };
      };
      setGuildConfig('GP', 'bot_profil', '1');
      setGuildConfig('GP', 'bot_nick', 'Héra');
      let p = await lireParametres();
      V('/parametres : ancien « 1 » (position) + pseudo « Héra » → l\'identifiant de Héra', p.status === 200 && p.data.config?.bot_profil === I.empreinteProfil('Héra')
        && p.data.identiteBot?.profilNom === 'Héra' && p.data.identiteBot?.profilRetire === null, texte(p.data.identiteBot || p.data).slice(0, 200));
      setGuildConfig('GP', 'bot_profil', 'disparu1');
      p = await lireParametres();
      V('/parametres : profil retiré → bot_profil null (le menu retombe sur le profil global) et profilRetire signalé',
        p.data.config?.bot_profil === null && p.data.identiteBot?.profilRetire === 'disparu1', texte(p.data.identiteBot || p.data).slice(0, 200));
      setGuildConfig('GP', 'bot_profil', null);
    }
  }

  console.log('\n12) Site : envoi de fichier, stockage, liens acceptés');
  {
    const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const api = lire('site-php/api.php');
    const app = lire('site-php/assets/js/app.js');
    const iPhoto = api.indexOf("if ($action === 'serveur.bot.photo')");
    const iBarriere = api.indexOf("if ($action === 'server.module.save' && !admin_connecte())");
    V('api.php : serveur.bot.photo placé AVANT la barrière d\'administration', iPhoto > 0 && iBarriere > iPhoto);
    const bloc = api.slice(iPhoto, api.indexOf('\n}\n', iPhoto));
    V('… exige le droit sur CE serveur, envoie au bot dans la même requête (30 s)',
      /exiger_serveur\(/.test(bloc) && /\/proxy\/config'/.test(bloc) && /'key' => 'bot_avatar_url'/.test(bloc) && /\], 30\)/.test(bloc));
    V('… data URI sous 700 Ko QUEL QUE SOIT l\'hôte (plus de hote_prive ici)', !/hote_prive\(/.test(bloc) && /700 \* 1024/.test(bloc));
    {
      // Exécuté pour de vrai : le bloc seul, avec des doublures pour ce qu'il
      // appelle. Un site sur Tailscale (100.64/10), derrière un DNS local ou
      // sur le port 8080 paraît « public » à PHP, mais le bot refuse d'y
      // télécharger : sous 700 Ko, la photo doit voyager dans la demande.
      const { spawnSync } = require('child_process');
      const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-bot-'));
      const photoDe = (ko) => {
        const f = path.join(dossier, `p${ko}.png`);
        fs.writeFileSync(f, Buffer.concat([PNG, Buffer.alloc(ko * 1024 - PNG.length, 7)]));
        return f;
      };
      const jouer = (hote, fichier, botAccepte) => {
        const code = `
          function exiger_serveur($g) { return [[], 'bot1']; }
          function req_host() { return ${JSON.stringify(hote)}; }
          function photo_bot_recue($champ) { $f = ${JSON.stringify(fichier)};
            return ['fichier' => $f, 'chemin' => 'uploads/avatars/x.png', 'url' => 'https://' . req_host() . '/uploads/avatars/x.png', 'mime' => 'image/png', 'taille' => filesize($f)]; }
          $GLOBALS['envoye'] = null;
          function agent_post_json($route, $corps, $delai) { $GLOBALS['envoye'] = $corps['value'];
            return ${botAccepte ? "[200, ['value' => 'https://cdn.discordapp.com/x.png']]" : "[400, ['error' => 'Identité du bot : ce lien ne mène pas à une adresse publique']]"}; }
          function respond($d, $c = 200) { echo json_encode(['code' => $c, 'reponse' => $d, 'envoye' => $GLOBALS['envoye']], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); exit; }
          $_POST = ['serveur' => '123']; $_GET = [];
          $action = 'serveur.bot.photo';
          ${bloc}
          }`;
        const r = spawnSync('php', ['-r', code], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        if (r.status !== 0 && !r.stdout) return { absent: r.error?.code === 'ENOENT', erreur: r.stderr };
        try { return JSON.parse(r.stdout); } catch { return { erreur: r.stdout.slice(0, 300) + r.stderr }; }
      };
      const petite = photoDe(300);
      const essai = jouer('100.101.102.103', petite, true);
      if (essai.absent) {
        console.log('  ⚠️ php absent : serveur.bot.photo vérifié par son texte seulement');
      } else {
        for (const hote of ['100.101.102.103', 'monpc.tail1234.ts.net', 'bot.maison.fr', 'monsite.fr:8080', 'monsite.fr', 'localhost']) {
          const r = hote === '100.101.102.103' ? essai : jouer(hote, petite, true);
          V(`photo de 300 Ko, site sur ${hote} : envoyée en data URI`, /^data:image\/png;base64,/.test(r.envoye || '') && r.reponse?.ok === true && r.reponse?.note === null,
            texte(r).slice(0, 200));
        }
        // Et le bot l'accepte telle quelle, sans rien télécharger.
        const avant = connexions.length;
        const uri = await I.dataUriDepuis(essai.envoye).catch((e) => `refus : ${e.message}`);
        V('… que le bot accepte directement, sans aucun téléchargement', /^data:image\/png;base64,/.test(uri) && connexions.length === avant, String(uri).slice(0, 120));
        const lourde = photoDe(900);
        const refus = jouer('monsite.fr:8080', lourde, false);
        V('photo de 900 Ko : l\'URL du site est envoyée (trop lourde pour la demande)', refus.envoye === 'https://monsite.fr:8080/uploads/avatars/x.png', texte(refus).slice(0, 200));
        V('… et si le bot refuse, l\'erreur dit pourquoi et quoi faire (adresse publique sur 80/443, ou réduire sous 700 Ko)',
          refus.code === 502 && /adresse publique/.test(refus.reponse?.error || '') && /port 80 ou 443/.test(refus.reponse?.error || '')
          && /réduisez la photo sous 700 Ko/i.test(refus.reponse?.error || '') && /monsite\.fr:8080/.test(refus.reponse?.error || ''), refus.reponse?.error);
        const posee = jouer('monsite.fr', lourde, true);
        V('… si le bot l\'a téléchargée, aucune note inutile', posee.reponse?.ok === true && posee.reponse?.note === null, texte(posee).slice(0, 200));
      }
      fs.rmSync(dossier, { recursive: true, force: true });
    }
    V('api.php : contrôles des fonds repris (post_max_size, erreurs, extension ET contenu, 8 Mo)',
      /function photo_bot_recue/.test(api) && /UPLOAD_ERR_PARTIAL/.test(api) && /\$imagesOk\[\$extension\] !== \$mime/.test(api) && /8 \* 1024 \* 1024/.test(api));
    V('… WEBP converti seulement si GD sait le lire', /function_exists\('imagecreatefromwebp'\)/.test(api));
    V('… dossier uploads/avatars créé à la volée, avec .htaccess et index.html',
      /AVATAR_DIR = __DIR__ \. '\/uploads\/avatars'/.test(api) && /\/\.htaccess', htaccess_televersements\(\)/.test(api) && /\/index\.html', ''/.test(api));
    V('… URL absolue (site_url) et diagnostic dossierAvatars', /site_url\(\) \. '\/uploads\/avatars\/'/.test(api) && /'dossierAvatars' =>/.test(api));
    V('api.php : bot.profil.photo dans le switch (administration du site)', /case 'bot\.profil\.photo':/.test(api) && api.indexOf("case 'bot.profil.photo'") > iBarriere);
    V('app.js : champ fichier SANS data-cfg, envoi immédiat en FormData',
      /<input class="input" type="file" accept="image\/png,image\/jpeg,image\/gif" data-avatar-fichier>/.test(app)
      && /api\("serveur\.bot\.photo", \{\}, \{ formData: fd \}\)/.test(app));
    V('app.js : Mes bots — envoi par carte, ligne « Nom | URL » ajoutée', /data-profil-fichier/.test(app) && /api\("bot\.profil\.photo", \{\}, \{ formData: fd \}\)/.test(app) && /\$\{nom\} \| \$\{r\.url\}/.test(app));
    V('app.js : aides à jour (imgur, Discord, Dropbox, Drive, GitHub)', (app.match(/imgur, Discord, Dropbox, Google Drive, GitHub/g) || []).length >= 2);
    V('app.js : profils rechargés à chaud après l\'écriture du .env', /api\("bot\.profils\.recharger"/.test(app));

    // 🔑 Identifiants stables, côté site.
    const fonctionPhp = (nom) => {
      const i = api.indexOf(`function ${nom}(`);
      return i < 0 ? '' : api.slice(i, api.indexOf('\n}\n', i) + 2);
    };
    const pp = fonctionPhp('profils_propres');
    V('api.php : profils_propres GARDE un id valide (jamais « __global__ »)', /\$profil\['id'\] = \$id/.test(pp) && /__global__/.test(pp) && /\[A-Za-z0-9_-\]\{1,32\}/.test(pp));
    // Exécuté pour de vrai quand PHP est là (le site en dépend) : la fonction
    // seule, sans le reste d'api.php.
    const { spawnSync } = require('child_process');
    const php = spawnSync('php', ['-r', `${fonctionPhp('cleanString')}\n${pp}\necho json_encode(profils_propres([
      ['id' => 'ares01', 'nom' => 'Arès', 'avatar' => 'https://x.test/a.png'],
      ['id' => '__global__', 'nom' => 'Zeus', 'avatar' => 'ftp://x'],
      ['id' => 'pas valide', 'nom' => 'Héra'],
      ['nom' => ''],
    ]), JSON_UNESCAPED_UNICODE);`], { encoding: 'utf8' });
    if (php.status === 0) {
      let sortie = null;
      try { sortie = JSON.parse(php.stdout); } catch { /* sortie illisible */ }
      V('… exécutée : id gardé, « __global__ » et id invalide écartés, profil sans nom retiré',
        texte(sortie) === texte([{ nom: 'Arès', avatar: 'https://x.test/a.png', id: 'ares01' }, { nom: 'Zeus', avatar: '' }, { nom: 'Héra', avatar: '' }]), php.stdout + php.stderr);
    } else {
      console.log('  ⚠️ php absent : profils_propres vérifiée par son texte seulement');
    }
    // app.js : la conversion texte → profils, exécutée telle qu'écrite.
    const iPdt = app.indexOf('function profilsDepuisTexte(');
    const srcPdt = app.slice(iPdt, app.indexOf('\n  }\n', iPdt) + 4);
    const profilsDepuisTexte = new Function(`${srcPdt}; return profilsDepuisTexte;`)();
    const relus = profilsDepuisTexte('Hermès | https://h.test/h.png\nArès | https://a.test/a.png\nNouveau', [
      { nom: 'Arès', avatar: 'https://a.test/a.png', id: 'ares01' }, { nom: 'Zeus', id: 'zeus01' }, { nom: 'Hermès' }]);
    V('app.js : l\'id d\'un profil déjà connu (même nom) est repris, même après réordonnancement ou retrait d\'un autre',
      texte(relus) === texte([{ nom: 'Hermès', avatar: 'https://h.test/h.png' }, { nom: 'Arès', avatar: 'https://a.test/a.png', id: 'ares01' }, { nom: 'Nouveau', avatar: '' }]), texte(relus));
    V('app.js : collectBots passe les profils existants', /profilsDepuisTexte\(get\("profils"\), existing\.profils\)/.test(app));
    const bloc2 = app.slice(app.indexOf('function identiteBotBloc('), app.indexOf('function identiteBotBloc(') + 3000);
    V('app.js : la page Identité signale un profil retiré et nomme le profil posé', /e\.profilRetire/.test(bloc2) && /retiré de la liste/.test(bloc2) && /e\.profilNom/.test(bloc2));
  }

  console.log('\n13) 🛡️ Aucune adresse interne : adresses écrites en clair, ports, schémas');
  {
    const interdites = ['127.0.0.1', '127.8.9.10', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.169.254',
      '100.64.0.1', '100.127.255.254', '0.0.0.0', '0.1.2.3', '224.0.0.1', '239.255.255.250', '255.255.255.255', '198.18.0.1',
      '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:10.0.0.1', '::127.0.0.1', '64:ff9b::7f00:1',
      '2002:7f00:1::1', '2002:c0a8:0101::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1', '[::1]', 'pas-une-ip'];
    const faux = interdites.filter((a) => !I.adresseInterdite(a));
    V(`${interdites.length} adresses internes ou réservées refusées (IPv4, IPv6, IPv4 enveloppées)`, faux.length === 0, faux.join(', '));
    const publiques = ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '2002:0808:0808::1'];
    const fermees = publiques.filter((a) => I.adresseInterdite(a));
    V('… et les adresses publiques passent', fermees.length === 0, fermees.join(', '));

    const avant = connexions.length;
    const liens = ['http://127.0.0.1/a.png', 'http://127.0.0.1:8080/archive-fichier?id=1', 'http://[::1]/a.png', 'http://[::ffff:127.0.0.1]/a.png',
      'http://2130706433/a.png', 'http://0x7f.1/a.png', 'http://017700000001/a.png', 'http://169.254.169.254/latest/meta-data/iam',
      'http://[::ffff:a9fe:a9fe]/', 'http://10.0.0.1/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://100.64.0.1/', 'http://0.0.0.0/',
      'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/'];
    for (const lien of liens) {
      const e = await erreurDe(I.dataUriDepuis(lien));
      V(`refusé sans connexion : ${lien}`, e?.cibleRefusee === true && /adresse publique/.test(e.message), e?.message);
    }
    V('… aucune connexion n\'est partie', connexions.length === avant, texte(connexions.slice(avant)));

    const ports = await erreurDe(I.dataUriDepuis('https://cdn.test:8443/a.png'));
    V('un port exotique (8443) est refusé, sans connexion', ports?.cibleRefusee === true && connexions.length === avant, ports?.message);
    const p443 = await I.dataUriDepuis('https://cdn.test:443/a.png');
    V('… le port 443 écrit en clair passe', /^data:image\/png/.test(p443));
    const p80 = await I.dataUriDepuis('http://cdn.test:80/b.png');
    V('… le port 80 aussi', /^data:image\/png/.test(p80));
    for (const lien of ['file:///etc/passwd', 'ftp://cdn.test/a.png', 'gopher://127.0.0.1:6379/_x']) {
      const e = await erreurDe(I.dataUriDepuis(lien));
      V(`schéma refusé : ${lien.split(':')[0]}`, Boolean(e) && /http\(s\)/.test(e.message));
    }
    const enveloppe = 'https://www.google.com/imgres?imgurl=http%3A%2F%2F127.0.0.1%2Fphoto.png';
    WEB.set(enveloppe, { type: 'text/html', body: page('') });
    const k = connexions.length;
    const g = await erreurDe(I.dataUriDepuis(enveloppe));
    V('Google Images qui ENVELOPPE une adresse interne : refusé aussi, 127.0.0.1 jamais contacté',
      g?.cibleRefusee === true && connexions.slice(k).every((c) => c.adresse !== '127.0.0.1'), `${g?.message} ${texte(connexions.slice(k))}`);
  }

  console.log('\n14) 🛡️ Noms résolus, redirections, og:image, DNS qui change de réponse');
  {
    DNS.set('interne.test', ['10.20.30.40']);
    DNS.set('melange.test', [PUBLIQUE, '127.0.0.1']);
    DNS.set('metadonnees.test', ['169.254.169.254']);
    DNS.set('v6interne.test', ['::ffff:192.168.0.1']);
    DNS.set('localhost', ['127.0.0.1', '::1']);
    DNS.set('inconnu.test', []);
    let avant = connexions.length;
    for (const [lien, quoi] of [['https://interne.test/a.png', 'un nom qui résout en 10.x'], ['https://melange.test/a.png', 'un nom dont UNE des adresses est 127.0.0.1'],
      ['http://metadonnees.test/latest/meta-data/', 'un nom vers 169.254.169.254'], ['https://v6interne.test/a.png', 'un nom vers ::ffff:192.168.0.1'],
      ['http://localhost/a.png', 'localhost']]) {
      const e = await erreurDe(I.dataUriDepuis(lien));
      V(`${quoi} : refusé`, e?.cibleRefusee === true, e?.message);
    }
    V('… et la connexion ne part JAMAIS (le refus a lieu dans le lookup de la connexion)', connexions.length === avant, texte(connexions.slice(avant)));
    const injoignable = await erreurDe(I.dataUriDepuis('https://inconnu.test/a.png'));
    V('un nom qui ne résout pas : « site injoignable », comme avant', /site injoignable/.test(injoignable?.message || ''), injoignable?.message);

    // Un seul message, quoi qu'il y ait derrière : rien sur le service.
    const msgs = new Set();
    for (const lien of ['http://127.0.0.1:1/x', 'http://127.0.0.1:43550/', 'http://10.0.0.1/a.png', 'https://interne.test/x.json']) {
      msgs.add((await erreurDe(I.dataUriDepuis(lien)))?.message);
    }
    V('port fermé, port ouvert, privé, nom interne : UN SEUL message, sans statut HTTP ni type', msgs.size === 1 && ![...msgs][0].match(/HTTP|type annoncé|injoignable/), [...msgs].join(' | '));

    // Redirections suivies À LA MAIN, chacune revérifiée.
    avant = connexions.length;
    WEB.set('https://redirige.test/vers-local', redirige('http://127.0.0.1:8080/archive-fichier?id=1'));
    const r1 = await erreurDe(I.dataUriDepuis('https://redirige.test/vers-local'));
    V('302 vers 127.0.0.1 : refusé au saut, la cible n\'est pas contactée', r1?.cibleRefusee === true
      && connexions.slice(avant).every((c) => c.adresse === PUBLIQUE) && connexions.length === avant + 1, `${r1?.message} ${texte(connexions.slice(avant))}`);
    avant = connexions.length;
    WEB.set('https://redirige.test/vers-nom-interne', redirige('http://metadonnees.test/latest/meta-data/', 301));
    const r2 = await erreurDe(I.dataUriDepuis('https://redirige.test/vers-nom-interne'));
    V('301 vers un NOM qui résout en 169.254.169.254 : refusé', r2?.cibleRefusee === true && connexions.length === avant + 1, r2?.message);
    WEB.set('https://redirige.test/vers-port', redirige('https://cdn.test:6379/a.png', 307));
    const r3 = await erreurDe(I.dataUriDepuis('https://redirige.test/vers-port'));
    V('307 vers un port exotique : refusé', r3?.cibleRefusee === true, r3?.message);
    WEB.set('https://redirige.test/relative', redirige('/images/photo.gif', 308));
    WEB.set('https://redirige.test/images/photo.gif', { type: 'image/gif', body: GIF });
    const r4 = await I.dataUriDepuis('https://redirige.test/relative');
    V('308 relative vers une image publique : suivie et acceptée', /^data:image\/gif/.test(r4));
    for (let i = 0; i < 6; i++) WEB.set(`https://chaine.test/${i}`, redirige(`https://chaine.test/${i + 1}`));
    WEB.set('https://chaine.test/6', { type: 'image/png', body: PNG });
    WEB.set('https://chaine.test/5', redirige('https://chaine.test/6'));
    const cinq = await I.dataUriDepuis('https://chaine.test/1');
    V('5 redirections : acceptées', /^data:image\/png/.test(cinq));
    avant = connexions.length;
    const six = await erreurDe(I.dataUriDepuis('https://chaine.test/0'));
    V('6 redirections : refusé (5 au plus), la 7e requête ne part pas', /redirige plus de 5 fois/.test(six?.message || '') && connexions.length === avant + 6, `${six?.message} ${connexions.length - avant}`);

    // La relance og:image passe par le même contrôle.
    avant = connexions.length;
    WEB.set('https://page.test/og-local', { type: 'text/html', body: page('<meta property="og:image" content="http://localhost/admin.png">') });
    const og = await erreurDe(I.dataUriDepuis('https://page.test/og-local'));
    V('og:image vers localhost : refusé, seule la page a été contactée', og?.cibleRefusee === true && connexions.length === avant + 1, og?.message);
    WEB.set('https://page.test/og-ip', { type: 'text/html', body: page('<meta property="og:image" content="http://169.254.169.254/x.png">') });
    const og2 = await erreurDe(I.dataUriDepuis('https://page.test/og-ip'));
    V('og:image vers 169.254.169.254 : refusé', og2?.cibleRefusee === true, og2?.message);

    // 🔁 DNS rebinding : le nom répond « public » puis « 127.0.0.1 ». Chaque
    // connexion passe par le lookup filtré et part vers l'adresse qu'IL a
    // vérifiée — la seconde réponse, interne, est donc refusée.
    let tour = 0;
    DNS.set('rebind.test', () => (tour++ === 0 ? [PUBLIQUE] : ['127.0.0.1']));
    WEB.set('https://rebind.test/page', { type: 'text/html', body: page('<meta property="og:image" content="https://rebind.test/photo.png">') });
    avant = connexions.length;
    const rb = await erreurDe(I.dataUriDepuis('https://rebind.test/page'));
    const faites = connexions.slice(avant);
    V('rebinding : 2e résolution en 127.0.0.1 → refusé', rb?.cibleRefusee === true, rb?.message);
    V('… la seule connexion faite est partie vers l\'adresse VÉRIFIÉE', faites.length === 1 && faites[0].adresse === PUBLIQUE, texte(faites));
    let n = 0;
    DNS.set('rebind2.test', () => (n++ === 0 ? [PUBLIQUE] : ['10.0.0.9']));
    const direct = await erreurDe(I.telechargerPublic('https://rebind2.test/a.png'));
    V('telechargerPublic : le nom est résolu UNE fois par connexion, dans le lookup filtré', !direct && n === 1, `${direct?.message} n=${n}`);
  }

  console.log('\n15) 🛡️ Les photos de la liste du CRÉATEUR peuvent venir de son site local — pas celles d\'un serveur');
  {
    const local = 'http://192.168.1.10:8080/uploads/avatars/bot_1.png';
    WEB.set(local, { type: 'image/png', body: PNG });
    process.env.BOT_PROFILS = JSON.stringify([{ nom: 'Local', avatar: local }]);
    const appels = [];
    const guild = { id: 'GL', client: { user: { id: 'BOTL', username: 'BotGlobal' }, rest: { patch: async (r, o) => { appels.push(o.body); return { avatar: 'h', user: { id: 'BOTL' } }; } } }, members: { me: null } };
    const p = await I.appliquerProfil(guild, I.empreinteProfil('Local'));
    V('profil du créateur avec photo sur le réseau local : posé', p?.nom === 'Local' && /^data:image\/png/.test(appels[0]?.avatar || ''), texte(appels[0]).slice(0, 60));
    I._dernierAvatar.delete('GL');
    const e = await erreurDe(I.appliquer(guild, { avatarUrl: local }));
    V('… le MÊME lien saisi par un serveur : refusé', e?.cibleRefusee === true && appels.length === 1, e?.message);
    const e2 = await erreurDe(I.dataUriDepuis(local));
    V('… dataUriDepuis seul (sans le drapeau du créateur) : refusé', e2?.cibleRefusee === true);
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'managedApi.js'), 'utf8');
    V('managedApi : aucune route ne passe le drapeau du créateur', !/photoDuCreateur|reseauLocal/.test(src));
    V('managedApi : plus d\'`avatar` téléchargé par discord.js pour un webhook', !/createWebhook\(\{[^}]*avatar:/.test(src) && (src.match(/createWebhook\(/g) || []).length >= 2);
  }

  console.log('\n16) 🛡️ La vraie pile HTTP de Node suit le lookup imposé (serveur local, aucun accès extérieur)');
  {
    const http = require('http');
    const zlib = require('zlib');
    const recus = [];
    const serveurLocal = http.createServer((req, res) => {
      recus.push(req.url);
      if (req.url === '/redir') { res.writeHead(302, { Location: '/photo.png' }); return res.end(); }
      if (req.url === '/photo.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
      if (req.url === '/page') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
        return res.end(zlib.gzipSync(page('<meta property="og:image" content="/photo.png">')));
      }
      // Un serveur qui envoie l'en-tête puis se tait.
      if (req.url === '/muet') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.write(PNG.subarray(0, 4)); }
      if (req.url === '/muet-gz') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
        return res.write(zlib.gzipSync(page('')).subarray(0, 6));
      }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => serveurLocal.listen(0, '127.0.0.1', r));
    const port = serveurLocal.address().port;
    I._reseau.requete = requeteReelle;
    // Le nom n'existe dans aucun DNS : seule la réponse du lookup imposé
    // peut mener la connexion jusqu'ici.
    DNS.set('site-createur.test', ['127.0.0.1']);
    try {
      const r = await I.telechargerPublic(`http://site-createur.test:${port}/redir`, { reseauLocal: true, signal: AbortSignal.timeout(3000) });
      const corps = Buffer.concat(await (async () => { const m = []; for await (const x of r.corps) m.push(x); return m; })());
      V('requête réelle : connexion vers l\'adresse du lookup, 302 suivie à la main', r.status === 200 && r.url.endsWith('/photo.png') && corps.equals(PNG) && texte(recus) === texte(['/redir', '/photo.png']), `${r.status} ${r.url} ${texte(recus)}`);
      const page1 = await I.dataUriDepuis(`http://site-createur.test:${port}/page`, { reseauLocal: true });
      V('… page compressée (gzip) lue, puis son og:image', /^data:image\/png/.test(page1));
      recus.length = 0;
      const refus = await erreurDe(I._reseau.requete(new URL(`http://site-createur.test:${port}/photo.png`), { lookup: I._lookupPublic, signal: AbortSignal.timeout(3000) }));
      V('… avec le lookup PUBLIC, la vraie pile échoue avant de se connecter', refus?.cibleRefusee === true && recus.length === 0, `${refus?.message} ${texte(recus)}`);
      for (const chemin of ['/muet', '/muet-gz']) {
        const debut = Date.now();
        const e = await erreurDe((async () => {
          const r = await I.telechargerPublic(`http://site-createur.test:${port}${chemin}`, { reseauLocal: true, signal: AbortSignal.timeout(250) });
          for await (const morceau of r.corps) void morceau;
        })());
        V(`… un serveur qui se tait (${chemin}) : la lecture échoue au délai, sans pendre`, Boolean(e) && Date.now() - debut < 2000, `${e?.message} ${Date.now() - debut} ms`);
      }
    } catch (err) {
      V('requête réelle sur le serveur local', false, err.message);
    } finally {
      I._reseau.requete = fauxTransport;
      serveurLocal.close();
    }
    V('le DNS des tests est faux de bout en bout (aucun accès extérieur)', I._reseau.lookup === fauxLookup && lookupReel !== fauxLookup);
  }

  console.log('\n17) 🔑 Profils identifiés par un identifiant STABLE');
  {
    const liste = (noms) => JSON.stringify(noms.map((n) => (typeof n === 'string' ? { nom: n, avatar: `https://cdn.test/${encodeURIComponent(n)}.png` } : n)));
    const id = I.empreinteProfil;
    process.env.BOT_PROFILS = liste(['Zeus', 'Arès', 'Hermès']);
    const guildeQ = {
      ...guildeP, id: 'GQ',
      members: { ...guildeP.members, me: { id: 'BOT1', displayName: 'BotGlobal', nickname: null, avatar: null, avatarURL() { return null; } } },
    };
    guildeQ.members._add = guildeP.members._add;
    const itxQ = (o) => ({ ...itx(o), guild: guildeQ, guildId: 'GQ' });
    I._dernierAvatar.delete('GQ');
    const choix = itxQ({ type: 'menu', customId: 'cfgbotprofil', valeurs: [id('Arès')] });
    await CP.handleConfigInteraction(choix);
    V('menu : choisir « Arès » enregistre son identifiant stable', getGuildConfig('GQ').bot_profil === id('Arès'), getGuildConfig('GQ').bot_profil);
    const panneau = async () => {
      const it = itxQ({ type: 'menu', customId: 'cfgcat', valeurs: ['identitebot'] });
      await CP.handleConfigInteraction(it);
      const brut = it.mises[0] || {};
      const lignes = (brut.components || []).map((r) => (r.toJSON ? r.toJSON() : r));
      const menu = lignes.flatMap((r) => r.components || []).find((c) => c.custom_id === 'cfgbotprofil');
      return { texte: texte(brut), coches: (menu?.options || []).filter((o) => o.default).map((o) => o.value) };
    };

    process.env.BOT_PROFILS = liste(['Arès', 'Hermès']); // Zeus retiré : Arès passe en 1re position
    let e = I.etat(guildeQ);
    let v = await panneau();
    V('Zeus retiré : c\'est TOUJOURS Arès qui est choisi (et pas Hermès, nouveau n°2)', e.profil === id('Arès') && e.profilNom === 'Arès' && !e.profilRetire, texte(e));
    V('… le panneau coche Arès et le nomme', texte(v.coches) === texte([id('Arès')]) && /Profil choisi : \*\*Arès\*\*/.test(v.texte), `${texte(v.coches)} ${v.texte.slice(0, 200)}`);

    process.env.BOT_PROFILS = liste(['Hermès', 'Zeus', 'Arès']); // réordonnés
    V('profils réordonnés : toujours Arès', I.etat(guildeQ).profil === id('Arès'));

    process.env.BOT_PROFILS = liste(['Zeus', 'Hermès']); // Arès retiré
    e = I.etat(guildeQ);
    v = await panneau();
    V('Arès retiré : aucun profil désigné à sa place, la valeur retirée est signalée', e.profil === null && e.profilNom === null && e.profilRetire === id('Arès'), texte(e));
    V('… le panneau retombe sur le profil global (seule option cochée) et le dit',
      texte(v.coches) === texte([I.VALEUR_GLOBALE]) && /retiré de la liste par le créateur du bot/.test(v.texte) && /« Profil global »/.test(v.texte), `${texte(v.coches)} ${v.texte.slice(0, 300)}`);
    const appelsAvant = appelsPatch.length;
    const vieux = itxQ({ type: 'menu', customId: 'cfgbotprofil', valeurs: [id('Arès')] });
    await CP.handleConfigInteraction(vieux);
    V('un VIEUX menu qui propose encore Arès : refus clair, rien posé', /retiré de la liste/.test(texte(vieux.reponses) + texte(vieux.suivis)) && appelsPatch.length === appelsAvant,
      texte(vieux.reponses) + texte(vieux.suivis));

    // Les enregistrements d'avant : un numéro de position.
    process.env.BOT_PROFILS = liste(['Zeus', 'Arès', 'Hermès']);
    setGuildConfig('GQ', 'bot_profil', '2');
    setGuildConfig('GQ', 'bot_nick', 'Arès');
    V('ancien « 2 » + pseudo Arès, liste inchangée → Arès', I.etat(guildeQ).profil === id('Arès'));
    process.env.BOT_PROFILS = liste(['Arès', 'Hermès']);
    V('ancien « 2 » + pseudo Arès, Zeus retiré → Arès (pas Hermès, le nouveau n°2)', I.etat(guildeQ).profil === id('Arès'), texte(I.etat(guildeQ)));
    setGuildConfig('GQ', 'bot_nick', 'Autre');
    V('ancien « 2 » sans pseudo reconnu → profil retiré, aucun autre désigné', I.etat(guildeQ).profil === null && I.etat(guildeQ).profilRetire === '2');

    // Ids explicites (y compris numériques, déjà écrits à la main dans un .env).
    process.env.BOT_PROFILS = JSON.stringify([{ id: 1, nom: 'Zeus' }, { id: '2', nom: 'Arès' }, { id: '__global__', nom: 'Piège' }, { nom: 'Double' }, { nom: 'Double' }]);
    const ids = I.profils().map((p) => p.id);
    V('ids explicites gardés (1, 2), « __global__ » refusé, doublons départagés',
      texte(ids) === texte(['1', '2', id('Piège'), id('Double'), `${id('Double')}-2`]), texte(ids));
    setGuildConfig('GQ', 'bot_profil', '2');
    V('… un id explicite « 2 » désigne CE profil, quelle que soit sa place', I.etat(guildeQ).profil === '2' && I.etat(guildeQ).profilNom === 'Arès');
    setGuildConfig('GQ', 'bot_profil', null);
    const apercu = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'configPanel.js'), 'utf8');
    V('le résumé de /config nomme le profil (plus de « profil n°… »)', !/profil n°/.test(apercu) && /profil appliqué : « \$\{e\.profilNom\} »/.test(apercu));
  }

  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})().catch((e) => { console.error(e); console.log('\n0 réussis, 1 échoués'); process.exit(1); });
