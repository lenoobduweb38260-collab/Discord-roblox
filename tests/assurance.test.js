// 🛡️ La liste des assurances : paginée par entrées entières, avec le
// marqueur 🚪 pour les assurés partis du serveur — et la même portée que
// /entreprise (un serveur non relié regarde SES entreprises, pas la réserve
// partagée). Plus : le document RP (carte/permis) renonce quand aucune police
// d'écriture ne se charge, au lieu d'envoyer une carte muette.
const fs = require('fs');
const os = require('os');
const path = require('path');
const AIDES = path.join(__dirname, 'aides');

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'assurance-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  return vrai.apply(this, arguments);
};

const { db } = require('../src/database');
const { renduListe } = require('../src/commands/assurance');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

// Un faux serveur : non relié à une communauté → sa portée est son propre id.
// members.fetch({ user }) rend les membres encore présents parmi les demandés.
function fauxGuild(id, presents = []) {
  return {
    id,
    client: { users: { fetch: async () => ({ username: 'Client' }) } },
    members: {
      fetch: async ({ user }) => new Map(user.filter((u) => presents.includes(String(u))).map((u) => [String(u), {}])),
    },
  };
}

const insEnt = db.prepare(
  "INSERT INTO enterprises (guild_id, name, insurance, insurance_types, created_by, created_at) VALUES (?, ?, 1, '[\"Véhicule\"]', 'S', ?)"
);
const insContrat = db.prepare(
  "INSERT INTO insured_vehicles (guild_id, enterprise_id, owner_id, vehicle, assigned_by, created_at) VALUES (?, ?, ?, ?, 'S', ?)"
);

(async () => {
  console.log('\n1) 45 contrats : 3 pages entières, plus de liste coupée à 25');
  {
    const entId = insEnt.run('G1', 'AXA RP', new Date().toISOString()).lastInsertRowid;
    for (let i = 1; i <= 45; i++) {
      insContrat.run('G1', entId, `U${i}`, `Voiture ${i}`, new Date().toISOString());
    }
    const guild = fauxGuild('G1', Array.from({ length: 45 }, (_, i) => `U${i + 1}`));

    const p1 = await renduListe(guild, 'e', entId, 0);
    const d1 = p1.embed.data.description;
    V('page 1 : 20 entrées', (d1.match(/n°/g) || []).length === 20, String((d1.match(/n°/g) || []).length));
    V('… le pied de page dit 45 contrats et Page 1/3', /45 contrats/.test(p1.embed.data.footer.text) && /Page 1\/3/.test(p1.embed.data.footer.text), p1.embed.data.footer.text);
    V('… flèche précédente grisée, suivante active',
      p1.components[0].toJSON().components[0].disabled === true && p1.components[0].toJSON().components[1].disabled === false);

    const p3 = await renduListe(guild, 'e', entId, 2);
    const d3 = p3.embed.data.description;
    V('page 3 : les 5 derniers contrats', (d3.match(/n°/g) || []).length === 5 && /Voiture 45/.test(d3), d3.slice(0, 120));
    V('… flèche suivante grisée au bout', p3.components[0].toJSON().components[1].disabled === true);
    V('une page trop loin retombe sur la dernière', /Page 3\/3/.test((await renduListe(guild, 'e', entId, 99)).embed.data.footer.text));
  }

  console.log('\n2) 🚪 Les assurés partis du serveur sont marqués');
  {
    const entId = insEnt.run('G2', 'MAIF RP', new Date().toISOString()).lastInsertRowid;
    insContrat.run('G2', entId, 'RESTE', 'Berline', new Date().toISOString());
    insContrat.run('G2', entId, 'PARTI', 'Coupé', new Date().toISOString());
    const guild = fauxGuild('G2', ['RESTE']);
    const p = await renduListe(guild, 'e', entId, 0);
    const lignes = p.embed.data.description.split('\n');
    V('celui qui est resté n\'a pas de marqueur', !/🚪/.test(lignes.find((l) => l.includes('RESTE'))), lignes.join(' | '));
    V('celui qui est parti porte 🚪', /🚪/.test(lignes.find((l) => l.includes('PARTI'))), lignes.join(' | '));
    V('la légende explique le marqueur', /🚪 a quitté le serveur/.test(p.embed.data.footer.text), p.embed.data.footer.text);
    V('pas de flèches pour une seule page', p.components.length === 0);
  }

  console.log('\n3) La portée est respectée : pas de fuite entre serveurs');
  {
    const entId = insEnt.run('AUTRE', 'Rivale', new Date().toISOString()).lastInsertRowid;
    const p = await renduListe(fauxGuild('G3', []), 'e', entId, 0);
    V('une entreprise d\'un autre serveur est introuvable ici', p.erreur === '❌ Entreprise introuvable.', JSON.stringify(p));
    const vide = await renduListe(fauxGuild('G3', []), 'c', 'U1', 0);
    V('un client sans contrat sur CE serveur : liste vide', /Aucun contrat/.test(vide.erreur || ''), JSON.stringify(vide));
  }

  console.log('\n4) Le document RP renonce quand aucune police ne se charge');
  {
    // Un faux jimp : l'image se fabrique, mais AUCUNE police ne se charge —
    // exactement la panne qui produisait des cartes muettes (photo seule).
    function JimpMuet() { return { composite() {}, print() {}, async getBufferAsync() { return Buffer.from('png'); } }; }
    JimpMuet.read = async () => null;
    JimpMuet.loadFont = async () => { throw new Error('police absente'); };
    JimpMuet.measureText = () => 0;
    JimpMuet.MIME_PNG = 'image/png';

    const avant = Module.prototype.require;
    Module.prototype.require = function (n) {
      if (n === 'jimp') return JimpMuet;
      return avant.apply(this, arguments);
    };
    delete require.cache[require.resolve('../src/utils/carteVisuelle')];
    const V2 = require('../src/utils/carteVisuelle');
    const plan = V2.planCarte({ card_id: 'CNI-1', rp_nom: 'Doe', rp_prenom: 'John' }, { serveur: 'Labo' });
    V('le plan porte bien des textes à écrire', plan.textes.length > 0, String(plan.textes.length));
    const png = await V2.fabriquer(plan, {});
    V('polices introuvables → null (retour à l\'embed), pas une carte muette', png === null);

    // Et quand les polices se chargent, le PNG sort normalement.
    let imprimes = 0;
    function JimpOk() { return { composite() {}, print() { imprimes += 1; }, async getBufferAsync() { return Buffer.from('png'); } }; }
    JimpOk.read = async () => null;
    JimpOk.loadFont = async () => ({});
    JimpOk.measureText = () => 0;
    JimpOk.MIME_PNG = 'image/png';
    Module.prototype.require = function (n) {
      if (n === 'jimp') return JimpOk;
      return avant.apply(this, arguments);
    };
    delete require.cache[require.resolve('../src/utils/carteVisuelle')];
    const V3 = require('../src/utils/carteVisuelle');
    const png2 = await V3.fabriquer(V3.planCarte({ card_id: 'CNI-2', rp_nom: 'Doe' }, { serveur: 'Labo' }), {});
    V('polices présentes → le PNG sort, textes imprimés', Buffer.isBuffer(png2) && imprimes > 0, `imprimés=${imprimes}`);
    Module.prototype.require = avant;
  }

  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})();
