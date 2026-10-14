#!/usr/bin/env node
// 🧪 Lance toutes les suites et rend un verdict unique.
//
// Une suite qui meurt sans conclure est signalée « MUETTE » : sans cela, un
// fichier qui plante au chargement passerait pour vert — c'est déjà arrivé.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const suites = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

let verts = 0;
let rouges = 0;
const muettes = [];

for (const suite of suites) {
  let sortie = '';
  let code = 0;
  try {
    sortie = execFileSync(process.execPath, [path.join(__dirname, suite)], { encoding: 'utf8', timeout: 180000 });
  } catch (err) {
    sortie = `${err.stdout || ''}${err.stderr || ''}`;
    code = err.status ?? 1;
  }
  const verdict = (sortie.match(/(\d+) réussis, (\d+) échoués/g) || []).pop();
  if (!verdict) {
    muettes.push(suite);
    rouges += 1;
    console.log(`❓ ${suite} — aucune conclusion`);
    console.log(sortie.trim().split('\n').slice(-5).map((l) => `   ${l}`).join('\n'));
    continue;
  }
  if (code === 0) {
    verts += 1;
    console.log(`✅ ${suite} — ${verdict}`);
  } else {
    rouges += 1;
    console.log(`❌ ${suite} — ${verdict}`);
    for (const l of sortie.split('\n').filter((l) => l.includes('❌')).slice(0, 8)) console.log(`   ${l.trim()}`);
  }
}

console.log('───────────────────────────────');
console.log(`${verts} suite(s) verte(s), ${rouges} en échec${muettes.length ? ` · muettes : ${muettes.join(', ')}` : ''}`);
process.exit(rouges === 0 ? 0 : 1);
