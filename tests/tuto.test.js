// 📖 Les guides /tuto et /tutos — générés depuis les vraies définitions.
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'tuto-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  return vrai.apply(this, arguments);
};

const T = require('../src/utils/tutoriel');
const { setGuildConfig } = require('../src/database');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

// Une fausse commande, telle que index.js les charge : { grade, data, … }.
const cmd = (name, description, { grade = 0, options = [], guildModule = null } = {}) => ({
  grade,
  guildModule,
  data: { name, toJSON: () => ({ name, description, options }) },
});

const client = {
  commands: new Map([
    ['carte', cmd('carte', 'La carte d\'identité RP', {
      options: [
        { type: 1, name: 'voir', description: 'Voir une carte' },
        { type: 2, name: 'staff', description: 'Outils staff', options: [{ type: 1, name: 'creer', description: 'Créer une carte' }] },
      ],
    })],
    ['config', cmd('config', 'Le panneau de configuration', { grade: 2 })],
    ['securite', cmd('securite', 'Les réglages de sécurité', { grade: 3 })],
    ['esthetique', cmd('esthetique', 'Réservée au créateur', {})],
    ['interact', cmd('interact', 'Interactions entre membres', { guildModule: 'interact' })],
  ]),
};

console.log('\n1) /tuto — la vue des membres');
{
  const blocs = T.blocsPour(client, { staff: false, cfg: { interact_enabled: 0 } });
  const texte = blocs.join('\n');
  V('les commandes de tous y sont', /\/carte/.test(texte));
  V('… avec leurs sous-commandes, groupes compris', /\/carte voir/.test(texte) && /\/carte staff creer/.test(texte));
  V('aucune commande staff', !/\/config/.test(texte));
  V('aucune commande admin', !/\/securite/.test(texte));
  V('aucune commande du créateur', !/esthetique/.test(texte));
  V('un module désactivé sur le serveur est tu', !/\/interact/.test(texte));
  const avecModule = T.blocsPour(client, { staff: false, cfg: { interact_enabled: 1 } }).join('\n');
  V('… et réapparaît une fois le module activé', /\/interact/.test(avecModule));
}

console.log('\n2) /tutos — la vue du staff');
{
  const blocs = T.blocsPour(client, { staff: true, cfg: { interact_enabled: 1 } });
  const texte = blocs.join('\n');
  V('les commandes staff y sont, badgées', /\/config`.*👮 staff/.test(texte), texte.match(/.*config.*/)?.[0]);
  V('les commandes admin aussi', /\/securite`.*🛡️ admin/.test(texte));
  V('les commandes de tous, sans badge', /\/carte` — La carte/.test(texte));
  V('toujours AUCUNE commande du créateur', !/esthetique/.test(texte));
}

console.log('\n3) La vue paginée');
{
  const interaction = { client, guildId: 'G1' };
  setGuildConfig('G1', 'interact_enabled', 1);
  const vue = T.vue(interaction, { staff: true, page: 1 });
  const json = vue.embeds[0].toJSON();
  V('un embed, titre de guide', /Guide du staff/.test(json.title), json.title);
  V('la légende des badges ouvre la page', /👮 staff/.test(json.description));
  V('le pied compte les commandes', /4 commandes/.test(json.footer?.text || ''), json.footer?.text);
  V('une seule page → pas de boutons', vue.components.length === 0);
  const membre = T.vue(interaction, { staff: false, page: 99 });
  V('une page hors bornes retombe sur la dernière', /Guide des commandes/.test(membre.embeds[0].toJSON().title));
}

console.log('\n4) Branchements et définitions');
{
  const ic = fs.readFileSync(`${__dirname}/../src/events/interactionCreate.js`, 'utf8');
  V('les pages de /tutos sont routées', /startsWith\('tutost:'\)/.test(ic));
  V('les pages de /tuto sont routées', /startsWith\('tutom:'\)/.test(ic));
  const tuto = require('../src/commands/tuto');
  const tutos = require('../src/commands/tutos');
  V('/tuto est ouverte à tous', tuto.grade === 0);
  V('/tutos est réservée au staff', tutos.grade === 2);
  V('les deux existent sous leur bon nom', tuto.data.name === 'tuto' && tutos.data.name === 'tutos');
}

fs.rmSync(RACINE, { recursive: true, force: true });
console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
process.exit(ko === 0 ? 0 : 1);
