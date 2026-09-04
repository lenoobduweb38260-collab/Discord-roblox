// ----- 📝 Publication des notes de mise à jour vers le site -----
// La page d'accueil du dashboard montre le journal du bot (section
// « Mises à jour »). Comme pour le moteur de rendu, la promesse est que le
// site montre EXACTEMENT ce que Discord publie : le JSON est donc EXTRAIT de
// src/utils/patchNotes.js, jamais réécrit à la main. Un test échoue si la
// copie diverge d'un seul octet.
//
// patchNotes.js require discord.js et la base de données — deux choses qui
// n'existent ni ici ni dans le navigateur. On évalue donc sa SOURCE avec des
// faux requires : la définition de RELEASES est un littéral, rien d'autre
// n'est exécuté au chargement.
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const CIBLE = path.join(RACINE, 'site-php', 'assets', 'notes-bot.json');

function extraire() {
  const source = fs.readFileSync(path.join(RACINE, 'src', 'utils', 'patchNotes.js'), 'utf8');
  // Faux « infini » : toute propriété, tout appel, toute construction rend le
  // même proxy — de quoi absorber les db.prepare(…) du chargement du module.
  const faux = new Proxy(function () {}, {
    get: (cible, prop) => (prop === Symbol.toPrimitive ? () => '' : faux),
    apply: () => faux,
    construct: () => faux,
  });
  const module_ = { exports: {} };
  new Function('require', 'module', 'exports', source)(() => faux, module_, module_.exports);
  return JSON.stringify(
    module_.exports.RELEASES.map(({ id, title, ajout, fix, amelioration, retrait }) =>
      ({ id, title, ajout, fix, amelioration, retrait })),
    null, 1,
  ) + '\n';
}

if (require.main === module) {
  const json = extraire();
  fs.writeFileSync(CIBLE, json);
  console.log(`✅ notes publiées : ${JSON.parse(json).length} versions → site-php/assets/notes-bot.json`);
}

module.exports = { extraire, CIBLE };
