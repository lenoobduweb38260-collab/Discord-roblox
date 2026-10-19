// 🧹 /entreprise purger — la réserve partagée (anciennes) ou tout, avec
// confirmation, réservée au créateur ; et la fiche des logs de modération.
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');
process.env.OWNER_ID = 'CREA';

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  return vrai.apply(this, arguments);
};

const { db, RP_SCOPE, setGuildConfig } = require('../src/database');
const E = require('../src/commands/entreprise');
const T = require('../src/utils/tutoriel');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };
const texte = (o) => JSON.stringify(o);

// ----- Une base peuplée : 2 anciennes (réserve partagée), 1 locale -----
const ins = db.prepare('INSERT INTO enterprises (guild_id, name, description, insurance, insurance_types, created_by, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)');
const peupler = () => {
  db.exec('DELETE FROM insured_vehicles; DELETE FROM enterprise_employees; DELETE FROM enterprise_heads; DELETE FROM enterprises; DELETE FROM rp_migration_archive;');
  const a = ins.run(RP_SCOPE, 'Police LS', 'ancienne', '[]', 'U1', '2026-05-01').lastInsertRowid;
  const b = ins.run(RP_SCOPE, 'Taxi Co', 'ancienne', '["Véhicule"]', 'U1', '2026-06-01').lastInsertRowid;
  const c = ins.run('G1', 'Pizzeria', 'locale', '[]', 'U2', '2026-10-01').lastInsertRowid;
  db.prepare('INSERT INTO enterprise_heads (enterprise_id, user_id) VALUES (?, ?)').run(a, 'U1');
  db.prepare('INSERT INTO enterprise_heads (enterprise_id, user_id) VALUES (?, ?)').run(c, 'U2');
  db.prepare('INSERT INTO enterprise_employees (enterprise_id, user_id) VALUES (?, ?)').run(a, 'U3');
  db.prepare('INSERT INTO enterprise_employees (enterprise_id, user_id) VALUES (?, ?)').run(b, 'U4');
  db.prepare('INSERT INTO enterprise_employees (enterprise_id, user_id) VALUES (?, ?)').run(c, 'U5');
  db.prepare('INSERT INTO insured_vehicles (guild_id, enterprise_id, owner_id, vehicle, assigned_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(RP_SCOPE, b, 'U4', 'Sultan', 'U1', '2026-06-02');
  db.prepare('INSERT INTO insured_vehicles (guild_id, enterprise_id, owner_id, vehicle, assigned_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('G1', c, 'U5', 'Scooter', 'U2', '2026-10-02');
  db.prepare('INSERT INTO rp_migration_archive (table_name, origin_guild, row_json, archived_at) VALUES (?, ?, ?, ?)').run('enterprises', 'G9', '{"name":"Police LS"}', '2026-07-01');
  db.prepare('INSERT INTO rp_migration_archive (table_name, origin_guild, row_json, archived_at) VALUES (?, ?, ?, ?)').run('permits', 'G9', '{}', '2026-07-01');
};
const compte = (table, ou = '') => db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${ou}`).get().n;

// ----- Fausse interaction -----
const envois = [];
const logSalon = { isTextBased: () => true, async send(m) { envois.push(m); return {}; } };
const guild = { id: 'G1', channels: { fetch: async (id) => (String(id) === 'LOGS' ? logSalon : null) } };
function fausse({ user = 'CREA', quoi = 'partagees', customId } = {}) {
  const it = {
    guild, guildId: 'G1', customId, deferred: false, replied: false,
    user: { id: user, username: user === 'CREA' ? 'Zetku' : 'Quidam' },
    client: { application: { fetch: async () => ({ owner: { id: 'CREA' } }) } },
    member: { id: user, guild, roles: { cache: new Map() }, permissions: { has: () => false } },
    message: { components: [], embeds: [{}], flags: 0 },
    options: { getSubcommand: () => 'purger', getString: () => quoi, getUser: () => null },
    inGuild: () => true,
    reply: async function (p) { this.replied = true; this.reponses.push(p); return p; },
    update: async function (p) { this.replied = true; this.mises.push(p); return p; },
    followUp: async function (p) { this.mises.push(p); return p; },
    deferUpdate: async function () {},
    editReply: async function (p) { this.mises.push(p); return p; },
    reponses: [], mises: [],
  };
  return it;
}

(async () => {
  setGuildConfig('G1', 'log_channel_id', 'LOGS');

  console.log('\n1) Le bilan compte ce qui partirait, portée par portée');
  {
    peupler();
    const p = E._purge.bilanPurge('partagees');
    V('réserve partagée : 2 entreprises, 1 patron, 2 employés, 1 contrat, 1 archive',
      p.entreprises === 2 && p.patrons === 1 && p.employes === 2 && p.contrats === 1 && p.archives === 1, texte(p));
    const t = E._purge.bilanPurge('tout');
    V('tout : 3 entreprises, 2 patrons, 3 employés, 2 contrats', t.entreprises === 3 && t.patrons === 2 && t.employes === 3 && t.contrats === 2, texte(t));
  }

  console.log('\n2) Purger la réserve partagée laisse les entreprises locales intactes');
  {
    peupler();
    const bilan = E._purge.executerPurge('partagees');
    V('le bilan rendu est celui d\'avant la suppression', bilan.entreprises === 2, texte(bilan));
    V('il reste la seule entreprise locale', compte('enterprises') === 1 && compte('enterprises', "WHERE name = 'Pizzeria'") === 1);
    V('ses patron, employé et contrat sont toujours là', compte('enterprise_heads') === 1 && compte('enterprise_employees') === 1 && compte('insured_vehicles') === 1);
    V('les doublons archivés des entreprises sont partis, pas ceux des permis', compte('rp_migration_archive') === 1 && compte('rp_migration_archive', "WHERE table_name = 'permits'") === 1);
  }

  console.log('\n3) Purger tout ne laisse absolument rien');
  {
    peupler();
    E._purge.executerPurge('tout');
    V('plus aucune entreprise, patron, employé ni contrat',
      compte('enterprises') === 0 && compte('enterprise_heads') === 0 && compte('enterprise_employees') === 0 && compte('insured_vehicles') === 0);
    V('archive des entreprises vidée', compte('rp_migration_archive', "WHERE table_name = 'enterprises'") === 0);
  }

  console.log('\n4) La commande : créateur seulement, récapitulatif, puis confirmation');
  {
    peupler();
    let it = fausse({ user: 'U2' });
    await E.execute(it);
    V('un non-créateur est refusé, en éphémère', it.reponses[0]?.flags === 64 && /créateur du bot/.test(it.reponses[0].content), texte(it.reponses[0]));
    V('… et rien n\'a bougé', compte('enterprises') === 3);

    it = fausse({ user: 'CREA', quoi: 'partagees' });
    await E.execute(it);
    const r = texte(it.reponses[0]);
    V('le créateur reçoit un récapitulatif chiffré en éphémère', it.reponses[0]?.flags === 64 && /\*\*2\*\* entreprise/.test(r) && /\*\*1\*\* contrat/.test(r), r.slice(0, 400));
    V('avec un bouton de confirmation et un bouton d\'annulation', /entpurge:partagees:CREA/.test(r) && /entpurge:non:CREA/.test(r), r);
    V('toujours rien supprimé avant le clic', compte('enterprises') === 3);

    // Un autre que le demandeur clique : refusé.
    it = fausse({ user: 'U2', customId: 'entpurge:partagees:CREA' });
    await E.handleButton(it);
    V('un autre clic que celui du créateur est refusé', it.reponses[0]?.flags === 64 && compte('enterprises') === 3, texte(it.reponses[0]));

    // Annulation.
    it = fausse({ user: 'CREA', customId: 'entpurge:non:CREA' });
    await E.handleButton(it);
    V('annuler ne supprime rien et le dit', /annulée/.test(texte(it.mises[0] || it.reponses[0])) && compte('enterprises') === 3, texte(it.mises[0] || it.reponses[0]));

    // Confirmation.
    envois.length = 0;
    it = fausse({ user: 'CREA', customId: 'entpurge:partagees:CREA' });
    await E.handleButton(it);
    const fait = texte(it.mises[0] || it.reponses[0]);
    V('confirmer supprime la réserve partagée', compte('enterprises') === 1 && compte('enterprises', "WHERE guild_id = 'GLOBAL'") === 0, fait);
    V('la réponse est une fiche : bilan sous filet, « Purgé par » en bas', /◆ \*\*Supprimé\*\*/.test(fait) && /🧹 Purgé par : \*\*Zetku\*\* \(`CREA`\) <@CREA>/.test(fait), fait);
    V('… et le salon de logs reçoit la même fiche', envois.length === 1 && /Entreprises purgées/.test(texte(envois[0])), texte(envois[0]).slice(0, 200));

    it = fausse({ user: 'CREA', quoi: 'partagees' });
    await E.execute(it);
    V('réserve déjà vide → « rien à purger »', /Rien à purger/.test(it.reponses[0]?.content || ''), texte(it.reponses[0]));
  }

  console.log('\n5) Le guide tait la sous-commande du créateur');
  {
    const client = { commands: new Map([['entreprise', { grade: 0, data: E.data }]]) };
    E.data.toJSON = () => ({ name: 'entreprise', description: 'x', options: [
      { type: 1, name: 'liste', description: 'Liste des entreprises du serveur' },
      { type: 1, name: 'purger', description: '[Créateur] Supprimer les entreprises : la réserve partagée (anciennes) ou absolument tout' },
    ] });
    const guide = T.blocsPour(client, { staff: true, cfg: { rp_enabled: 1 } }).join('\n');
    V('/entreprise liste est dans /tutos', /\/entreprise liste/.test(guide), guide.slice(0, 300));
    V('/entreprise purger n\'y est pas', !/purger/.test(guide), guide);
  }

  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); console.log('\n0 réussis, 1 échoués'); process.exit(1); });
