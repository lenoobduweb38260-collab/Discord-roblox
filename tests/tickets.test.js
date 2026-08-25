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
const { db, setGuildConfig } = require('../src/database');
const { creerFilStaff, editerMessagePanneau, sendTranscript, resetPanelMenu, insertPanel, insertType, prendreEnCharge, rangeesTicket } = require('../src/utils/tickets');
const C = require('../src/utils/cartes');

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

  console.log('\n3) Modifier un panneau publié en CARTE ne casse plus');
  {
    const guild = { id: 'G1', name: 'Labo', iconURL: () => null };
    const client = { user: { username: 'Bot' } };
    const payload = { embeds: [{ title: 'Panneau', description: 'Choisissez une raison.' }], components: [] };

    // Un panneau à l'ancienne (embed) : la modification passe telle quelle.
    const ancien = { flags: 0, edits: [], async edit(m) { this.edits.push(m); return this; } };
    await editerMessagePanneau(guild, client, ancien, payload);
    V('un panneau-embed se réédite avec ses embeds', Boolean(ancien.edits[0].embeds));

    // Un panneau en carte : SURTOUT pas d'embeds — des composants reconstruits.
    const carte = { flags: C.DRAPEAU_V2, edits: [], async edit(m) { this.edits.push(m); return this; } };
    await editerMessagePanneau(guild, client, carte, payload);
    V('un panneau-carte se réédite en composants', Array.isArray(carte.edits[0].components) && carte.edits[0].components.length > 0,
      JSON.stringify(carte.edits[0] || {}).slice(0, 120));
    V('… sans le champ embeds refusé par Discord', carte.edits[0].embeds === undefined);
  }

  console.log('\n4) Le transcript : une carte qui dit tout, fichier compris');
  {
    setGuildConfig('G1', 'ticket_transcript_channel_id', 'ARCH');
    const envois = [];
    const archive = { isTextBased: () => true, async send(m) { envois.push(m); return {}; } };
    const proprio = { id: 'U1', displayName: 'Bayouss', user: { username: 'bay' } };
    const guild = {
      id: 'G1',
      channels: { fetch: async (id) => (String(id) === 'ARCH' ? archive : null) },
      members: { fetch: async (id) => (String(id) === 'U1' ? proprio : null) },
    };
    const messages = new Map([
      ['M1', { createdTimestamp: 1000, author: { tag: 'bay#0' }, content: 'bonjour' }],
      ['M2', { createdTimestamp: 2000, author: { tag: 'staff#0' }, content: 'on regarde' }],
    ]);
    const interaction = {
      guild, guildId: 'G1',
      user: { id: 'S1', username: 'Staffeur' },
      channel: { name: 'ticket-0016-bay', messages: { fetch: async () => messages } },
    };
    const ticket = { id: 17, type_id: null, user_id: 'U1', created_at: '2026-08-24T15:00:00Z' };
    const parti = await sendTranscript(interaction, ticket, 'S1');
    const d = envois[0]?.embeds?.[0]?.data?.description || '';
    V('le transcript part avec son fichier', parti === true && envois[0].files?.length === 1);
    V('… sans sonner personne malgré les étiquettes',
      Array.isArray(envois[0].allowedMentions?.parse) && envois[0].allowedMentions.parse.length === 0);
    V('… la carte nomme le SALON en clair (il sera supprimé)', /#ticket-0016-bay/.test(d), d.slice(0, 160));
    V('… dit qui a ouvert, nommé et identifié', /Ouvert par \*\*Bayouss\*\* \(<@U1> · `U1`\)/.test(d));
    V('… et qui a fermé', /Fermé par \*\*Staffeur\*\* \(<@S1> · `S1`\)/.test(d));
    V('… avec le compte de messages', /\*\*2\*\* message\(s\)/.test(d), d);

    // Le moteur : un fichier libre devient un composant « fichier » DANS la carte.
    const corps = { content: '', embeds: [{ title: 'Archive', description: 'x' }] };
    const converti = C.convertirCorps(corps, { fichiers: ['transcript-ticket-17.txt'] });
    const plat = JSON.stringify(converti);
    V('le moteur pose le composant fichier', converti && plat.includes('"type":13')
      && plat.includes('attachment://transcript-ticket-17.txt'), plat.slice(0, 200));
    V('… à l\'INTÉRIEUR du conteneur', converti.components.some((c) => c.type === C.T.CONTENEUR
      && (c.components || []).some((x) => x.type === C.T.FICHIER)));
    V('… et sans fichier, rien ne change', !JSON.stringify(C.convertirCorps({ content: '', embeds: [{ title: 'A' }] }, {})).includes('"type":13'));
  }

  console.log('\n4 bis) Le menu du panneau se décoche — même sur un panneau en carte');
  {
    const guild = { id: 'G1', name: 'Labo', iconURL: () => null };
    const client = { user: { username: 'Bot' } };
    insertPanel.run('G1', 'CPAN', 'MPAN1', JSON.stringify({ titre: 'Support', description: 'Choisissez votre motif.' }));

    // Le panneau est une CARTE : l'ancien reset (embeds) était refusé par
    // Discord, l'échec avalé, et le menu restait coché pour toujours.
    const carte = {
      id: 'MPAN1', flags: C.DRAPEAU_V2, components: [],
      edits: [], async edit(m) { this.edits.push(m); return this; },
    };
    await resetPanelMenu({ guildId: 'G1', guild, client, message: carte });
    V('le panneau-carte est réédité — le menu se décoche', carte.edits.length === 1
      && Array.isArray(carte.edits[0].components) && carte.edits[0].components.length > 0);
    V('… en composants, sans embeds', carte.edits[0].embeds === undefined, JSON.stringify(carte.edits[0] || {}).slice(0, 120));

    // Un panneau inconnu en base : on renvoie ses composants tels quels.
    const libre = { id: 'MPAN2', flags: 0, components: [{ toJSON: () => ({ type: 1, components: [] }) }], edits: [], async edit(m) { this.edits.push(m); return this; } };
    await resetPanelMenu({ guildId: 'G1', guild, client, message: libre });
    V('un panneau hors base se réaffiche tel quel', libre.edits.length === 1 && libre.edits[0].components.length === 1);
  }

  console.log('\n5) Le panneau publié s\'épingle, et la notification système s\'efface');
  {
    const { epinglerProprement } = require('../src/utils/embeds');

    const faits = { epingle: false, effaces: [] };
    const notif = { system: true, type: 6, async delete() { faits.effaces.push('notif'); return this; } };
    const autre = { system: false, type: 0, async delete() { faits.effaces.push('autre'); return this; } };
    const message = {
      async pin() { faits.epingle = true; return this; },
      channel: { messages: { fetch: async () => new Map([['N1', notif], ['M1', autre]]) } },
    };
    const okEpingle = await epinglerProprement(message);
    V('le message est épinglé', okEpingle === true && faits.epingle === true);
    V('… la notification système « a épinglé » est effacée', faits.effaces.includes('notif'));
    V('… et RIEN d\'autre', !faits.effaces.includes('autre'), faits.effaces.join(','));

    const refuse = {
      async pin() { throw new Error('Missing Permissions'); },
      channel: { messages: { fetch: async () => { throw new Error('ne doit pas être appelé'); } } },
    };
    V('sans « Gérer les messages », on renonce sans casser', (await epinglerProprement(refuse)) === false);
  }

  console.log('\n6) Le bouton 🙋 « Prendre en charge » sur la carte du ticket');
  {
    const typeId = insertType.run('G1', 'Support', null, null, null, null, JSON.stringify(['RSUP'])).lastInsertRowid;
    const ticketId = db.prepare(
      "INSERT INTO tickets (guild_id, type_id, channel_id, user_id, status, opened_at) VALUES ('G1', ?, 'CT1', 'U1', 'ouvert', ?)"
    ).run(typeId, new Date().toISOString()).lastInsertRowid;
    const enBase = () => db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);

    V('la carte d\'un ticket neuf porte le bouton de prise en charge',
      JSON.stringify(rangeesTicket('G1', ticketId)).includes('tktclaim') && JSON.stringify(rangeesTicket('G1', ticketId)).includes('Prendre en charge'));

    const membre = (id, { roles = [], staff = false } = {}) => ({
      id, user: { id }, displayName: id,
      roles: { cache: new Map(roles.map((r) => [r, {}])) },
      permissions: { has: () => staff },
      guild: { id: 'G1' },
    });
    const clic = (m) => ({
      guildId: 'G1', customId: `tktclaim:${ticketId}`,
      user: { id: m.id }, member: m,
      message: { flags: 0, edits: [] },
      reponses: [], suites: [], replied: false, deferred: false,
      async reply(x) { this.reponses.push(x); this.replied = true; return {}; },
      async followUp(x) { this.suites.push(x); return {}; },
      async update(x) { this.message.edits.push(x); this.replied = true; return {}; },
      async deferUpdate() { this.deferred = true; return {}; },
    });

    const quidam = clic(membre('U9'));
    await prendreEnCharge(quidam, ticketId);
    V('un membre ordinaire est refusé', /⛔/.test(quidam.reponses[0]?.content) && !enBase().claimed_by, quidam.reponses[0]?.content);

    const s1 = clic(membre('S1', { roles: ['RSUP'] }));
    await prendreEnCharge(s1, ticketId);
    V('le rôle support prend en charge — c\'est en base', enBase().claimed_by === 'S1' && Boolean(enBase().claimed_at));
    V('… le bouton change de tête', /Pris en charge — reprendre/.test(JSON.stringify(s1.message.edits[0] || {})));
    V('… et l\'annonce part dans le salon', /Ticket pris en charge/.test(JSON.stringify(s1.suites[0] || {})));

    const encore = clic(membre('S1', { roles: ['RSUP'] }));
    await prendreEnCharge(encore, ticketId);
    V('re-cliquer soi-même informe sans écraser', /déjà pris/.test(encore.suites[0]?.content), encore.suites[0]?.content);

    const s2 = clic(membre('S2', { staff: true }));
    await prendreEnCharge(s2, ticketId);
    V('un autre staff peut REPRENDRE le ticket', enBase().claimed_by === 'S2');
    V('… et la reprise nomme l\'ancien assigné', /Auparavant assigné à <@S1>/.test(JSON.stringify(s2.suites[0] || {})), JSON.stringify(s2.suites[0] || {}).slice(0, 200));
  }

  console.log('\n7) Un update() qui LÈVE (validation discord.js) ne casse plus l\'action');
  {
    const { mettreAJour, reafficher } = require('../src/utils/reponse');

    const faits = { defers: 0 };
    const casse = (flags) => ({
      message: { flags, components: [] },
      replied: false, deferred: false,
      update() { throw new Error('validation synchrone'); },
      async deferUpdate() { faits.defers += 1; this.deferred = true; return {}; },
    });

    let survit = true;
    try { await mettreAJour(casse(0), { content: 'x' }); } catch { survit = false; }
    V('mettreAJour survit à un update qui lève (message classique)', survit && faits.defers === 1);

    survit = true;
    try { await mettreAJour(casse(C.DRAPEAU_V2), { components: [{ type: 1, components: [] }] }); } catch { survit = false; }
    V('… et sur une carte aussi', survit && faits.defers === 2);

    survit = true;
    try { await reafficher(casse(0)); } catch { survit = false; }
    V('reafficher survit pareil', survit && faits.defers === 3);
  }

  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})();
