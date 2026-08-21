#!/usr/bin/env node
// 📋 Ce qui reste à traduire, groupé par fichier.
const { relever } = require('./extraire-textes');
const table = (() => { try { return require('../src/utils/traductions.json'); } catch { return {}; } })();

const langue = process.argv[2] || 'en';
const fichier = process.argv[3] || null;

const reste = relever().filter((e) => !e.risque && !table[e.fr]?.[langue]);
const vus = new Set();
const uniques = reste.filter((e) => (vus.has(e.fr) ? false : vus.add(e.fr)));

if (fichier) {
  const dedans = uniques.filter((e) => e.fichier === fichier);
  console.log(JSON.stringify(dedans.map((e) => e.fr), null, 0));
} else {
  const parFichier = new Map();
  for (const e of uniques) parFichier.set(e.fichier, (parFichier.get(e.fichier) || 0) + 1);
  const tries = [...parFichier.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`${uniques.length} texte(s) à traduire en « ${langue} », dans ${parFichier.size} fichiers :\n`);
  for (const [f, n] of tries) console.log(`  ${String(n).padStart(4)}  ${f}`);
}
