// ⏰ Le rappel de bump : DISBOARD surveillé, rappel armé, redémarrage couvert.
const fs = require('fs');
const os = require('os');
const path = require('path');
const AIDES = path.join(__dirname, 'aides');

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  return vrai.apply(this, arguments);
};

const { setGuildConfig, getGuildConfig } = require('../src/database');
const bump = require('../src/utils/bumpReminder');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

function fauxMonde() {
  const envois = [];
  const salon = { id: 'RAPPEL', isTextBased: () => true, async send(m) { envois.push(m); return {}; } };
  const guild = { id: 'G1' };
  const client = {
    guilds: { cache: new Map([['G1', guild]]) },
    channels: { fetch: async (id) => (String(id) === 'RAPPEL' ? salon : null) },
  };
  return { guild, client, salon, envois };
}
const messageDisboard = (monde, description, auteur = bump.DISBOARD_ID) => ({
  guild: monde.guild, client: monde.client,
  author: { id: auteur, bot: true },
  embeds: [{ description }],
});

(async () => {
  console.log('\n1) Reconnaître un bump réussi — et seulement lui');
  {
    const monde = fauxMonde();
    V('« Bump effectué ! » de DISBOARD', bump.estBumpReussi(messageDisboard(monde, 'Bump effectué ! :thumbsup:')));
    V('« Bump done! » aussi', bump.estBumpReussi(messageDisboard(monde, 'Bump done! :thumbsup:')));
    V('un autre bot qui dit pareil, non', !bump.estBumpReussi(messageDisboard(monde, 'Bump effectué ! :thumbsup:', 'AUTREBOT')));
    V('DISBOARD qui dit d\'attendre, non plus',
      !bump.estBumpReussi(messageDisboard(monde, 'Veuillez patienter encore 42 minutes avant de réutiliser cette commande.')));
  }

  console.log('\n2) Un bump vu = une heure notée, un rappel armé');
  {
    const monde = fauxMonde();
    V('rappel coupé = rien n\'est noté', (await bump.surveiller(messageDisboard(monde, 'Bump effectué ! :thumbsup:'))) === false);
    setGuildConfig('G1', 'bump_channel_id', 'RAPPEL');
    setGuildConfig('G1', 'bump_role_id', 'RBUMP');
    const vu = await bump.surveiller(messageDisboard(monde, 'Bump effectué ! :thumbsup:'));
    V('rappel actif = le bump est noté', vu === true && Number(getGuildConfig('G1').bump_dernier) > 0);
    V('… et la minuterie est armée', bump.minuteries.has('G1'));
    clearTimeout(bump.minuteries.get('G1'));
    bump.minuteries.delete('G1');
  }

  console.log('\n3) Le rappel : une carte, le rôle qui sonne, une seule fois');
  {
    const monde = fauxMonde();
    setGuildConfig('G1', 'bump_channel_id', 'RAPPEL');
    setGuildConfig('G1', 'bump_role_id', 'RBUMP');
    setGuildConfig('G1', 'bump_dernier', Date.now() - bump.DELAI_BUMP - 1000);
    await bump.rappeler(monde.client, 'G1');
    V('la carte du rappel part dans le salon', monde.envois.length === 1
      && /bump/i.test(JSON.stringify(monde.envois[0].embeds[0].data ?? monde.envois[0].embeds[0])));
    V('le rôle est mentionné dans le CONTENU — donc il sonne', monde.envois[0].content === '<@&RBUMP>', monde.envois[0].content);
    V('l\'heure est effacée : un seul rappel par bump', getGuildConfig('G1').bump_dernier === null);

    setGuildConfig('G1', 'bump_role_id', null);
    setGuildConfig('G1', 'bump_dernier', Date.now());
    await bump.rappeler(monde.client, 'G1');
    V('sans rôle configuré, la carte part sans contenu', monde.envois.length === 2 && monde.envois[1].content === undefined);

    setGuildConfig('G1', 'bump_channel_id', null);
    setGuildConfig('G1', 'bump_dernier', Date.now());
    V('rappel coupé entre-temps = rien ne part', (await bump.rappeler(monde.client, 'G1')) === null && monde.envois.length === 2);
    setGuildConfig('G1', 'bump_dernier', null);
  }

  console.log('\n4) Le redémarrage réarme — un rappel échu part immédiatement');
  {
    const monde = fauxMonde();
    setGuildConfig('G1', 'bump_channel_id', 'RAPPEL');
    setGuildConfig('G1', 'bump_dernier', Date.now() - bump.DELAI_BUMP - 60_000); // échu pendant le sommeil
    const armes = bump.demarrer(monde.client);
    await new Promise((r) => setTimeout(r, 30));
    V('le rappel échu est réarmé puis part tout de suite', armes === 1 && monde.envois.length === 1);
    V('… et la base est propre', getGuildConfig('G1').bump_dernier === null);
  }

  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})();
