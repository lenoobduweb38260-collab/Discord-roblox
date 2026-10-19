// 🔢 Rôle d'erreur du comptage réglé depuis le SITE (API locale du bot).
//
// /config refuse un rôle porteur de pouvoirs : le site doit refuser les
// mêmes. Sans cela, le verrou de /config se contournait par le tableau de
// bord — et le bot donnait « Administrateur » à qui cassait la série.
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'comptage-site-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  return vrai.apply(this, arguments);
};

const { getGuildConfig } = require('../src/database');
const API = require('../src/managedApi');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };
const texte = (o) => JSON.stringify(o);
const logOrig = console.log;
const warnOrig = console.warn;
console.warn = () => {};

class Coll extends Map {
  filter(f) { const m = new Coll(); for (const [k, v] of this) if (f(v, k)) m.set(k, v); return m; }
  find(f) { for (const v of this.values()) if (f(v)) return v; return undefined; }
}
const role = (id, nom, position, permissions = 0n, extra = {}) => ({ id, name: nom, position, managed: false, permissions: { bitfield: permissions }, ...extra });
const R_SIMPLE = '200000000000000021';
const R_ADMIN = '200000000000000022';
const R_BAN = '200000000000000023';
const R_WEBHOOKS = '200000000000000024';
const GB = {
  id: 'GB', name: 'Serveur B', iconURL: () => null,
  roles: { cache: new Coll([
    [R_SIMPLE, role(R_SIMPLE, 'Maladroit', 2)],
    [R_ADMIN, role(R_ADMIN, 'Administrateurs', 5, 1n << 3n)],
    [R_BAN, role(R_BAN, 'Videurs', 4, 1n << 2n)],
    [R_WEBHOOKS, role(R_WEBHOOKS, 'Intégrateurs', 3, 1n << 29n)],
  ]) },
  channels: { cache: new Coll(), fetch: async () => null },
  members: { cache: new Coll(), me: { id: 'bot', roles: { highest: { position: 10 } } }, fetch: async () => null },
};

(async () => {
  console.log('\n1) POST /config : comptage_role_erreur');
  const client = { isReady: () => true, guilds: { cache: new Coll([['GB', GB]]) }, user: { id: 'bot', tag: 'Bot#0', username: 'Bot' }, users: { cache: new Coll() } };
  GB.client = client;
  console.log = () => {};
  API.startManagedApi(client, RACINE);
  const fichierPort = path.join(RACINE, 'api.port');
  for (let k = 0; k < 100 && !fs.existsSync(fichierPort); k++) await new Promise((r) => setTimeout(r, 20));
  console.log = logOrig;
  const port = fs.readFileSync(fichierPort, 'utf8');
  const config = async (key, value) => {
    const r = await fetch(`http://127.0.0.1:${port}/config`, { method: 'POST', body: JSON.stringify({ guildId: 'GB', key, value }) });
    return { code: r.status, ...(await r.json()) };
  };

  let r = await config('comptage_role_erreur', R_ADMIN);
  V('un rôle « Administrateur » (sous le bot) → 400, rien d\'enregistré', r.code === 400 && /permissions sensibles \(Administrateur\)/.test(r.error)
    && !getGuildConfig('GB').comptage_role_erreur, texte(r));
  r = await config('comptage_role_erreur', R_BAN);
  V('un rôle qui peut bannir → 400', r.code === 400 && /Bannir des membres/.test(r.error), texte(r));
  r = await config('comptage_role_erreur', R_WEBHOOKS);
  V('un rôle qui gère les webhooks → 400', r.code === 400 && /Gérer les webhooks/.test(r.error), texte(r));
  V('… le refus dit pourquoi (donné automatiquement)', /donné automatiquement/.test(r.error || ''));
  r = await config('comptage_role_erreur', R_SIMPLE);
  V('un rôle sans pouvoir → enregistré', r.code === 200 && getGuildConfig('GB').comptage_role_erreur === R_SIMPLE, texte(r));
  r = await config('comptage_role_erreur', null);
  V('… et retirable', r.code === 200 && getGuildConfig('GB').comptage_role_erreur === null, texte(r));

  console.warn = warnOrig;
  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})().catch((e) => { console.log = logOrig; console.warn = warnOrig; console.error(e); console.log('\n0 réussis, 1 échoués'); process.exit(1); });
