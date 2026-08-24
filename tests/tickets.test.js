// 🎫 Le fil privé du staff, accroché à chaque ticket.
const fs = require('fs');
const os = require('os');
const path = require('path');
const AIDES = path.join(__dirname, 'aides');

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'tickets-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  return vrai.apply(this, arguments);
};

const { ChannelType } = require(path.join(AIDES, 'stub-discord.js'));
const { creerFilStaff } = require('../src/utils/tickets');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

function fauxMembre(id, { bot = false, roles = [] } = {}) {
  return { id: String(id), user: { bot }, roles: { cache: new Map(roles.map((r) => [String(r), {}])) } };
}

(async () => {
  console.log('\n1) Le fil privé du staff : créé, présenté, peuplé en silence');
  {
    const membres = new Map([
      ['S1', fauxMembre('S1', { roles: ['SUPPORT'] })],
      ['S2', fauxMembre('S2', { roles: ['STAFF'] })],
      ['B1', fauxMembre('B1', { bot: true, roles: ['SUPPORT'] })],
      ['U1', fauxMembre('U1', { roles: ['MEMBRE'] })],
    ]);
    const guild = { id: 'G1', members: { fetch: async () => membres, cache: membres } };
    let creation = null;
    const fil = {
      envois: [], ajoutes: [],
      async send(m) { this.envois.push(m); return {}; },
      members: { add: async (id) => { fil.ajoutes.push(String(id)); return {}; } },
    };
    const salon = { id: 'C1', threads: { create: async (opts) => { creation = opts; return fil; } } };

    await creerFilStaff(guild, salon, {
      cfg: { staff_role_id: null, staff_role_ids: JSON.stringify(['STAFF']) },
      roleIds: ['SUPPORT'],
      num: '0042',
      owner: { id: 'U1', username: 'Bayouss' },
    });

    V('le fil est PRIVÉ', creation && creation.type === ChannelType.PrivateThread, JSON.stringify(creation));
    V('… non rejoignable librement', creation.invitable === false);
    V('… et nommé d\'après le ticket', /0042/.test(creation.name), creation.name);
    V('le mot d\'ouverture dit à qui il est réservé et qui n\'y voit rien',
      /staff/.test(fil.envois[0]?.content) && /Bayouss/.test(fil.envois[0]?.content) && /<#C1>/.test(fil.envois[0]?.content),
      fil.envois[0]?.content);
    V('les rôles support ET staff sont ajoutés', fil.ajoutes.includes('S1') && fil.ajoutes.includes('S2'));
    V('… sans les bots ni l\'auteur du ticket', !fil.ajoutes.includes('B1') && !fil.ajoutes.includes('U1'), fil.ajoutes.join(','));
    V('… et sans la moindre mention qui sonne', !/<@&/.test(fil.envois[0]?.content || ''));
  }

  console.log('\n2) Sans rôle configuré, le fil existe quand même');
  {
    const guild = { id: 'G1', members: { fetch: async () => new Map(), cache: new Map() } };
    const fil = { envois: [], ajoutes: [], async send(m) { this.envois.push(m); return {}; }, members: { add: async () => ({}) } };
    const salon = { id: 'C2', threads: { create: async () => fil } };
    const rendu = await creerFilStaff(guild, salon, {
      cfg: { staff_role_id: null, staff_role_ids: null },
      roleIds: [], num: '0001', owner: { id: 'U1', username: 'Seul' },
    });
    V('le fil est rendu, prêt pour ManageThreads', rendu === fil && fil.envois.length === 1);
  }

  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})();
