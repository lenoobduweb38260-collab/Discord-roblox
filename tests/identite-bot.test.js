// 🪪 L'identité du bot par serveur, et /interact (nouvelles actions, GIF de joue).
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

const { getGuildConfig } = require('../src/database');
const I = require('../src/utils/identiteBot');
const { nomDuBot } = require('../src/utils/styleEmbeds');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const vraiFetch = global.fetch;
global.fetch = async (url) => {
  const u = String(url);
  if (u.endsWith('.webp')) return { ok: true, headers: { get: () => 'image/webp' }, arrayBuffer: async () => PNG };
  if (u.endsWith('/404.png')) return { ok: false, status: 404, headers: { get: () => 'image/png' } };
  return { ok: true, headers: { get: () => 'image/png; charset=binary' }, arrayBuffer: async () => PNG };
};

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
      C.peck && !Object.values(C.peck).includes('kiss'), JSON.stringify(C.peck));
    V('… mais a bien une source', Object.values(C.peck).some(Boolean));
    V('chaque nouvelle action a au moins une source', ['bang', 'punch', 'kill'].every((k) => Object.values(C[k] || {}).some(Boolean)));
    const src = fs.readFileSync(`${__dirname}/../src/commands/interact.js`, 'utf8');
    V('la réserve est rangée sous la vraie catégorie', /memoriserGif\(category, gif\)/.test(src) && /gifAuHasard\.get\(category\)/.test(src));
  }

  global.fetch = vraiFetch;
  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})();
