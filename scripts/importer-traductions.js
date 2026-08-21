#!/usr/bin/env node
// 📥 Reprend le CSV rempli par les traducteurs et en fait le dictionnaire du bot.
//
// Le CSV est le format des traducteurs ; le JSON celui du bot. Personne ne
// devrait avoir à écrire du JSON à la main — une virgule oubliée et le bot ne
// démarre plus.
const fs = require('fs');
const path = require('path');

const LANGUES = ['en', 'de', 'ru', 'es'];
const SORTIE = path.join(__dirname, '..', 'src', 'utils', 'traductions.json');

// Un CSV bien formé : point-virgule en séparateur, guillemets doublés à
// l'intérieur des champs. On analyse caractère par caractère plutôt que de
// découper sur « ; » — un texte contenant un point-virgule casserait tout.
function lireCSV(contenu) {
  const texte = contenu.replace(/^﻿/, '');
  const lignes = [];
  let champ = '';
  let ligne = [];
  let dansGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (dansGuillemets) {
      if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') dansGuillemets = false;
      else champ += c;
    } else if (c === '"') dansGuillemets = true;
    else if (c === ';') { ligne.push(champ); champ = ''; }
    else if (c === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; }
    else if (c !== '\r') champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}

function importer(fichier) {
  const lignes = lireCSV(fs.readFileSync(fichier, 'utf8'));
  const entete = lignes.shift() || [];
  const col = (nom) => entete.findIndex((e) => e.trim().toLowerCase() === nom.toLowerCase());
  const iRisque = col('A NE PAS TRADUIRE');
  const iFr = col('Francais (source)');
  const iLangues = { en: col('English'), de: col('Deutsch'), ru: col('Russe'), es: col('Espagnol') };

  if (iFr === -1) throw new Error('Colonne « Francais (source) » introuvable — le fichier n\'a pas la bonne en-tête.');

  const table = {};
  const comptes = Object.fromEntries(LANGUES.map((l) => [l, 0]));
  let ignorees = 0;

  for (const ligne of lignes) {
    const fr = (ligne[iFr] || '').trim();
    if (!fr) continue;
    // ⚠️ Une valeur technique traduite casserait le bot en silence : on
    // refuse la traduction, même si quelqu'un a rempli la case.
    if (iRisque !== -1 && (ligne[iRisque] || '').trim()) { ignorees++; continue; }

    const entree = {};
    for (const l of LANGUES) {
      const i = iLangues[l];
      const v = i === -1 ? '' : (ligne[i] || '').trim();
      if (v && v !== fr) { entree[l] = v; comptes[l] += 1; }
    }
    if (Object.keys(entree).length) table[fr] = entree;
  }

  fs.writeFileSync(SORTIE, `${JSON.stringify(table, null, 2)}\n`, 'utf8');
  return { textes: Object.keys(table).length, comptes, ignorees };
}

if (require.main === module) {
  const fichier = process.argv[2];
  if (!fichier) {
    console.error('Usage : node scripts/importer-traductions.js traductions.csv');
    process.exit(1);
  }
  const r = importer(fichier);
  console.log(`✅ ${r.textes} texte(s) enregistré(s) dans src/utils/traductions.json`);
  for (const [l, n] of Object.entries(r.comptes)) console.log(`   ${l} : ${n}`);
  if (r.ignorees) console.log(`   ${r.ignorees} valeur(s) technique(s) volontairement ignorée(s).`);
}

module.exports = { importer, lireCSV };
