// 🔍 Deux contrôles que `node --check` ne sait pas faire.
//
//  1. Un helper appelé sans avoir été importé : le code est syntaxiquement
//     parfait, et l'erreur n'apparaît qu'à l'exécution — souvent avalée par un
//     try/catch qui la transforme en « une erreur est survenue ».
//  2. Un import mort ne casse qu'au CHARGEMENT du module : au démarrage du
//     bot, ou jamais si le module est requis paresseusement.
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = path.join(__dirname, '..', 'src');
const AIDES = path.join(__dirname, 'aides');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

// src/manager/index.js embarque une page web entière sous forme de chaînes :
// l'analyser textuellement produirait des faux positifs qui feraient ignorer
// les vrais.
const HORS_ANALYSE = new Set(['manager/index.js']);

const fichiers = [];
(function marcher(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) marcher(p);
    else if (e.name.endsWith('.js')) fichiers.push(p);
  }
})(R);

const exportes = new Set();
for (const f of fichiers) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/module\.exports(?:\.\w+)?\s*=\s*\{([^}]*)\}/g)) {
    for (const brut of m[1].split(',')) {
      const nom = brut.split(':')[0].trim();
      if (/^[a-z][\w$]*$/.test(nom)) exportes.add(nom);
    }
  }
}

function nomsConnus(src) {
  const noms = new Set();
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const brut of m[1].split(',')) {
      const nom = (brut.split(':')[1] || brut.split(':')[0] || '').trim().replace(/=.*$/, '').trim();
      if (nom) noms.add(nom);
    }
  }
  for (const m of src.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) noms.add(m[1]);
  for (const m of src.matchAll(/\(([^()]{0,300})\)\s*=>/g)) {
    for (const brut of m[1].split(',')) {
      const nom = brut.trim().replace(/[=:].*$/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nom)) noms.add(nom);
    }
  }
  for (const m of src.matchAll(/function\s*\w*\s*\(([^()]{0,300})\)/g)) {
    for (const brut of m[1].split(',')) {
      const nom = brut.trim().replace(/[=:].*$/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nom)) noms.add(nom);
    }
  }
  for (const m of src.matchAll(/^\s*(?:async\s+)?(\w+)\s*\([^()]*\)\s*\{/gm)) noms.add(m[1]);
  return noms;
}

console.log('\n1) Aucun helper appelé sans être importé');
{
  const manquants = [];
  for (const f of fichiers) {
    if (HORS_ANALYSE.has(path.relative(R, f))) continue;
    const src = fs.readFileSync(f, 'utf8');
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');
    const connus = nomsConnus(src);
    const vus = new Set();
    for (const m of code.matchAll(/(^|[^\w$.])([a-z][\w$]*)\s*\(/g)) {
      const nom = m[2];
      if (!exportes.has(nom) || connus.has(nom) || vus.has(nom)) continue;
      vus.add(nom);
      manquants.push(`${path.relative(R, f)} appelle « ${nom}() » sans l'importer`);
    }
  }
  V('tout appel de helper est importé', manquants.length === 0, '\n     ' + manquants.join('\n     '));
}

console.log('\n2) Aucun followUp brut après une mise à jour');
// 💥 « InteractionNotReplied » : mettreAJour avale ses erreurs — c'est voulu.
// Mais quand elle rate, l'interaction n'est PAS accusée, et le followUp qui
// suit lève. `suivre()` regarde l'état RÉEL et ne lève jamais.
{
  const fautifs = [];
  for (const f of fichiers) {
    if (HORS_ANALYSE.has(path.relative(R, f))) continue;
    const lignes = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lignes.length; i++) {
      if (!/\b(mettreAJour|resetStaffMenu|resetPanelMenu|reafficher)\(/.test(lignes[i])) continue;
      const fenetre = lignes.slice(i + 1, i + 8);
      const j = fenetre.findIndex((l) => /interaction\.followUp\(/.test(l));
      if (j === -1) continue;
      const garde = fenetre.slice(0, j).some((l) => /replied\s*\|\|\s*interaction\.deferred/.test(l));
      if (!garde) fautifs.push(`${path.relative(R, f)}:${i + 1 + j + 1}`);
    }
  }
  V('aucun followUp non gardé après une mise à jour', fautifs.length === 0,
    '\n     ' + fautifs.join('\n     ') + '\n     ➜ utilisez suivre(interaction, …)');
}

console.log('\n3) Chaque module se charge vraiment');
{
  const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'chargement-'));
  process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');
  const Module = require('module');
  const vrai = Module.prototype.require;
  const labo = vrai.call(module, path.join(AIDES, 'stub-voix.js'));
  Module.prototype.require = function (n) {
    if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
    if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
    if (n === '@discordjs/voice') return labo.voix;
    if (n === 'play-dl') return labo.play;
    return vrai.apply(this, arguments);
  };

  // Ce qui ouvre un port ou lit la console ne se charge pas hors d'un vrai bot.
  const HORS_CHARGEMENT = new Set(['index.js', 'manager/index.js', 'deploy-commands.js', 'managedApi.js']);
  const casses = [];
  let comptes = 0;
  for (const f of fichiers) {
    const rel = path.relative(R, f);
    if (HORS_CHARGEMENT.has(rel)) continue;
    comptes += 1;
    try { vrai.call(module, f); } catch (err) { casses.push(`${rel} : ${err.message}`); }
  }
  Module.prototype.require = vrai;
  fs.rmSync(RACINE, { recursive: true, force: true });
  V(`les ${comptes} modules se chargent`, casses.length === 0, '\n     ' + casses.join('\n     '));
}

console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
process.exit(ko === 0 ? 0 : 1);
