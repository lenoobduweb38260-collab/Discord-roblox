// 📖 Le journal exhaustif : les diffs, et leur chemin jusqu'au salon de logs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const AIDES = path.join(__dirname, 'aides');

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  return vrai.apply(this, arguments);
};

const { setGuildConfig } = require('../src/database');
const J = require('../src/utils/journal');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

// Un bitfield de permissions minimal, comme discord.js le présente.
const bits = (...noms) => ({ toArray: () => noms });

(async () => {
  console.log('\n1) diffSalon : chaque réglage laisse sa ligne');
  {
    const avant = {
      name: 'général', topic: null, nsfw: false, rateLimitPerUser: 0, parentId: null,
      position: 3,
      permissionOverwrites: { cache: new Map([['R1', { type: 0, allow: bits('ViewChannel'), deny: bits() }]]) },
      guild: { id: 'G1' },
    };
    const apres = {
      name: 'general-v2', topic: 'Le salon principal', nsfw: true, rateLimitPerUser: 30, parentId: 'CAT1',
      position: 7,
      permissionOverwrites: { cache: new Map([
        ['R1', { type: 0, allow: bits(), deny: bits('SendMessages') }],
        ['U9', { type: 1, allow: bits('Connect'), deny: bits() }],
      ]) },
      guild: { id: 'G1' },
    };
    const d = J.diffSalon(avant, apres).join('\n');
    V('le nom', /général.*general-v2/.test(d), d);
    V('le sujet', /Sujet/.test(d) && /Le salon principal/.test(d));
    V('le NSFW', /NSFW/.test(d));
    V('le mode lent', /Mode lent/.test(d) && /30 s/.test(d));
    V('la catégorie', /Catégorie/.test(d) && /<#CAT1>/.test(d));
    V('une surcharge modifiée, permission par permission',
      /Permissions de <@&R1>/.test(d) && /⛔ SendMessages/.test(d) && /↩️ ViewChannel/.test(d), d);
    V('une surcharge ajoutée', /Permissions ajoutées pour <@U9>/.test(d));
    V('la POSITION est ignorée (un glissement décale tout)', !/position/i.test(d));

    const rien = J.diffSalon(avant, { ...avant, position: 12 });
    V('déplacer sans rien changer d\'autre = aucun log', rien.length === 0);

    const everyone = J.diffSalon(
      { name: 'x', permissionOverwrites: { cache: new Map() }, guild: { id: 'G1' } },
      { name: 'x', permissionOverwrites: { cache: new Map([['G1', { type: 0, allow: bits(), deny: bits('Connect') }]]) }, guild: { id: 'G1' } }
    ).join('\n');
    V('l\'identifiant du serveur se lit @everyone', /Permissions ajoutées pour @everyone/.test(everyone), everyone);
  }

  console.log('\n2) diffMembre : surnom, rôles, exclusion, boost');
  {
    const avant = {
      nickname: null,
      roles: { cache: new Map([['R1', {}]]) },
      communicationDisabledUntilTimestamp: null,
      premiumSinceTimestamp: null,
    };
    const apres = {
      nickname: 'Bayouss',
      roles: { cache: new Map([['R2', {}]]) },
      communicationDisabledUntilTimestamp: Date.now() + 3_600_000,
      premiumSinceTimestamp: Date.now(),
    };
    const d = J.diffMembre(avant, apres).join('\n');
    V('le surnom', /Surnom/.test(d) && /Bayouss/.test(d));
    V('les rôles ajoutés ET retirés', /ajoutés : <@&R2>/.test(d) && /retirés : <@&R1>/.test(d), d);
    V('l\'exclusion temporaire, avec sa fin', /Exclusion temporaire jusqu'au <t:\d+:f>/.test(d));
    V('le boost', /booster/.test(d));

    const leve = J.diffMembre(apres, { ...apres, communicationDisabledUntilTimestamp: null }).join('\n');
    V('la levée d\'exclusion se dit aussi', /Exclusion temporaire levée/.test(leve));
  }

  console.log('\n3) diffGuilde, diffFil, diffEvenement');
  {
    const g = J.diffGuilde(
      { name: 'Labo', icon: 'a', afkTimeout: 300, verificationLevel: 1 },
      { name: 'Labo RP', icon: 'b', afkTimeout: 900, verificationLevel: 3 }
    ).join('\n');
    V('guilde : nom, icône, AFK, vérification', /Labo RP/.test(g) && /Icône du serveur modifiée/.test(g) && /5 min → 15 min/.test(g) && /faible.*haute/.test(g), g);

    const f = J.diffFil(
      { name: 'aide', archived: false, locked: false },
      { name: 'aide', archived: true, locked: true }
    ).join('\n');
    V('fil : archivé et verrouillé', /Archivé/.test(f) && /Verrouillé/.test(f));

    const e = J.diffEvenement(
      { name: 'Soirée', status: 1, scheduledStartTimestamp: 1000 },
      { name: 'Soirée', status: 2, scheduledStartTimestamp: 2_000_000 }
    ).join('\n');
    V('événement : statut et date', /en cours/.test(e) && /<t:2000:f>/.test(e), e);
  }

  console.log('\n4) De l\'événement au salon de logs — le chemin complet');
  {
    setGuildConfig('G1', 'log_channel_id', 'LOGS');
    const envois = [];
    const logSalon = { isTextBased: () => true, async send(m) { envois.push(m); return {}; } };
    const guild = { id: 'G1', channels: { fetch: async (id) => (String(id) === 'LOGS' ? logSalon : null) } };

    const channelUpdate = require('../src/events/channelUpdate');
    await channelUpdate.execute(
      { guild, id: 'C1', name: 'ancien', permissionOverwrites: { cache: new Map() } },
      { guild, id: 'C1', name: 'nouveau', permissionOverwrites: { cache: new Map() } }
    );
    V('un salon renommé finit dans les logs', envois.length === 1
      && /ancien.*nouveau/.test(envois[0].embeds[0].data.description), JSON.stringify(envois[0] || {}).slice(0, 160));

    await channelUpdate.execute(
      { guild, id: 'C1', name: 'pareil', permissionOverwrites: { cache: new Map() } },
      { guild, id: 'C1', name: 'pareil', permissionOverwrites: { cache: new Map() } }
    );
    V('rien de changé = pas de log', envois.length === 1);

    const banRemove = require('../src/events/guildBanRemove');
    await banRemove.execute({ guild, user: { id: 'U7', tag: 'Gars#0' } });
    V('un déban se journalise, même sans accès au journal d\'audit', envois.length === 2
      && /Bannissement levé/.test(envois[1].embeds[0].data.title));

    const bulk = require('../src/events/messageDeleteBulk');
    const messages = new Map([
      ['M1', { author: { id: 'U1', bot: false } }],
      ['M2', { author: { id: 'U1', bot: false } }],
      ['M3', { author: { id: 'B1', bot: true } }],
    ]);
    messages.size = 3;
    await bulk.execute({ size: 3, values: () => messages.values() }, { guild, id: 'C1' });
    V('une purge dit le compte et les auteurs humains', envois.length === 3
      && /\*\*3\*\* messages/.test(envois[2].embeds[0].data.description)
      && /<@U1> \(2\)/.test(envois[2].embeds[0].data.description)
      && !/<@B1>/.test(envois[2].embeds[0].data.description), envois[2]?.embeds[0].data.description);
  }

  console.log('\n5) Les états vocaux fins : micro, caméra, stream — même salon');
  {
    const envois = [];
    const logSalon = { isTextBased: () => true, async send(m) { envois.push(m); return {}; } };
    const guild = {
      id: 'G1',
      channels: { fetch: async (id) => (String(id) === 'LOGS' ? logSalon : null), cache: new Map() },
    };
    const member = { id: 'U1', user: { bot: false } };
    const voix = require('../src/events/voiceStateUpdate');
    const etat = (extra) => ({ guild, member, channelId: 'V1', selfMute: false, selfDeaf: false, serverMute: false, serverDeaf: false, streaming: false, selfVideo: false, ...extra });

    await voix.execute(etat({}), etat({ selfMute: true, selfVideo: true }));
    V('micro coupé + caméra allumée = UNE ligne qui dit les deux', envois.length === 1
      && /micro coupé/.test(envois[0].embeds[0].data.description)
      && /caméra allumée/.test(envois[0].embeds[0].data.description), envois[0]?.embeds[0].data.description);

    await voix.execute(etat({}), etat({}));
    V('aucun changement d\'état = pas de log', envois.length === 1);

    await voix.execute(etat({ serverMute: false }), etat({ serverMute: true }));
    V('la sourdine SERVEUR se distingue', envois.length === 2 && /sourdine par le serveur/.test(envois[1].embeds[0].data.description));
  }

  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})();
