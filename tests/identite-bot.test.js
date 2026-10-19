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
// plus, ce sont les octets qui font foi). ──
const WEB = new Map();
const appelsWeb = [];
const vraiFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  appelsWeb.push({ url: u, accept: opts.headers?.Accept || '', agent: opts.headers?.['User-Agent'] || '' });
  let r = WEB.get(u);
  if (typeof r === 'function') r = await r(u, opts);
  if (!r) {
    if (u.endsWith('.webp')) r = { type: 'image/webp', body: WEBP };
    else if (u.endsWith('/404.png')) r = { status: 404, type: 'text/html', body: Buffer.from('introuvable') };
    else r = { type: 'image/png; charset=binary', body: PNG };
  }
  const status = r.status || 200;
  const entetes = { 'content-type': r.type || '', ...(r.entetes || {}) };
  const corps = r.body || Buffer.alloc(0);
  return {
    ok: status >= 200 && status < 300, status, url: r.url || u,
    headers: { get: (k) => entetes[String(k).toLowerCase()] ?? null },
    arrayBuffer: async () => corps.buffer.slice(corps.byteOffset, corps.byteOffset + corps.length),
  };
};
const urlsDepuis = (i) => appelsWeb.slice(i).map((a) => a.url);
async function erreurDe(promesse) {
  try { await promesse; return null; } catch (e) { return e; }
}

(async () => {
  console.log('\n1) Les profils du créateur viennent du .env (BOT_PROFILS)');
  {
    const liste = I.profils();
    V('deux profils lus', liste.length === 2, JSON.stringify(liste));
    V('… numérotés, avec nom et photo', liste[0].id === '1' && liste[0].nom === 'Arès' && liste[0].avatar === 'https://cdn.test/ares.png');
    V('… un profil sans photo reste valable', liste[1].id === '2' && liste[1].avatar === null);
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
    await I.appliquerProfil(guild, '1');
    V('choisir un profil pose son nom et sa photo', appels[0]?.body?.nick === 'Arès' && /^data:image\/png/.test(appels[0]?.body?.avatar || ''));
    V('… et retient le profil choisi', getGuildConfig('G1').bot_profil === '1');
    erreur = null;
    await I.appliquerProfil(guild, '9').catch((e) => { erreur = e; });
    V('un profil inconnu est refusé', /introuvable/.test(erreur?.message || ''));
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
    WEB.set('https://drive.google.com/uc?export=download&id=1PrivePriveePrive', {
      type: 'text/html', url: 'https://accounts.google.com/ServiceLogin?continue=x',
      body: page('<meta property="og:image" content="https://www.google.com/logo.png">') });
    WEB.set('https://drive.google.com/file/d/1PrivePriveePrive/view', {
      type: 'text/html', url: 'https://accounts.google.com/ServiceLogin?continue=y',
      body: page('<meta property="og:image" content="https://www.google.com/logo.png">') });
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
  let reponsePatch = () => ({ avatar: 'hashfichier', user: { id: 'BOT1' } });
  const BOT = { id: 'BOT1', username: 'BotGlobal' };
  const guildeP = {
    id: 'GP', name: 'Labo', iconURL: () => null,
    client: { user: BOT, rest: { patch: async (route, opts) => { appelsPatch.push(opts.body); return reponsePatch(); } } },
    members: { me: { id: 'BOT1', displayName: 'BotGlobal', nickname: null, avatarURL: () => null }, cache: new Map(), fetch: async () => null },
    channels: { fetch: async () => null },
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
      const r = await vraiFetch(`http://127.0.0.1:${port}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
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
        { nom: 'Zeus', avatar: 'https://site.test/uploads/avatars/bot_1.png' }, { nom: '', avatar: 'https://x/y.png' },
        { nom: 'Héra', avatar: 'javascript:alert(1)' },
      ] });
      V('POST /profils-bot : les profils sont pris à chaud (sans redémarrer)', r2.status === 200 && r2.data.profils === 2, texte(r2));
      const liste = I.profils();
      V('… nettoyés : sans nom écarté, adresse non http(s) vidée',
        liste.length === 2 && liste[0].nom === 'Zeus' && liste[0].avatar === 'https://site.test/uploads/avatars/bot_1.png' && liste[1].nom === 'Héra' && liste[1].avatar === null, texte(liste));
      V('… et retenus en base (repli du .env)', /Zeus/.test(require('../src/utils/botTeam').state('bot_profils') || ''));
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
    V('… data URI seulement sous 700 Ko, si l\'adresse du site est privée', /hote_prive\(req_host\(\)\)/.test(bloc) && /700 \* 1024/.test(bloc));
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
  }

  global.fetch = vraiFetch;
  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})().catch((e) => { console.error(e); console.log('\n0 réussis, 1 échoués'); process.exit(1); });
