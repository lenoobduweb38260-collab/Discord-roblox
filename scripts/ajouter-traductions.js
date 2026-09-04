#!/usr/bin/env node
// ➕ Ajoute des traductions au dictionnaire, sans écraser ce qui existe.
//
// Prend un JSON { "texte français": { en: "…" } } sur l'entrée standard ou en
// argument, et le fusionne. Refuse ce que le relevé signale comme valeur
// technique : une traduction ajoutée à la main ne doit pas contourner le
// garde-fou qui protège l'import.
//
// ⚠️ `--force` lève ce refus, et seulement en connaissance de cause. Le
// signalement protège les VALEURS : « Véhicule » est à la fois une clé de
// tableau dans entreprise.js et l'intitulé d'un choix à l'écran. Or la
// traduction ne visite que les champs d'AFFICHAGE — jamais un `value`, un
// `custom_id` ni une URL. Traduire l'intitulé est donc sans danger : c'est
// ce que dit ce drapeau, « j'ai vérifié, c'est un intitulé ».
const fs = require('fs');
const path = require('path');
const { relever } = require('./extraire-textes');

const SORTIE = path.join(__dirname, '..', 'src', 'utils', 'traductions.json');

function fusionner(ajouts, force = false) {
  let table = {};
  try { table = JSON.parse(fs.readFileSync(SORTIE, 'utf8')); } catch { table = {}; }

  const risques = new Set(relever().filter((e) => e.risque).map((e) => e.fr));
  let ajoutes = 0;
  let refuses = 0;
  for (const [fr, langues] of Object.entries(ajouts)) {
    if (!force && risques.has(fr)) { refuses++; continue; }
    table[fr] = { ...(table[fr] || {}), ...langues };
    ajoutes++;
  }
  const tri = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b, 'fr')));
  fs.writeFileSync(SORTIE, `${JSON.stringify(tri, null, 2)}\n`, 'utf8');
  return { ajoutes, refuses, total: Object.keys(tri).length };
}

if (require.main === module) {
  const args = process.argv.slice(2).filter((a) => a !== '--force');
  const force = process.argv.includes('--force');
  const source = args[0] ? fs.readFileSync(args[0], 'utf8') : fs.readFileSync(0, 'utf8');
  const r = fusionner(JSON.parse(source), force);
  console.log(`✅ ${r.ajoutes} ajouté(s) · ${r.refuses} refusé(s) (valeur technique) · ${r.total} au total`);
}

module.exports = { fusionner };
