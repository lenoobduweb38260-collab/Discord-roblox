// 📝 Les notes de mise à jour publiées vers le site : la copie JSON doit être
// EXACTEMENT ce que src/utils/patchNotes.js publie sur Discord — même règle
// que le moteur de rendu partagé. ./scripts-publier-moteur.sh la régénère.
const fs = require('fs');
const path = require('path');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

const { extraire, CIBLE } = require('../scripts/publier-notes');

console.log('1) La copie du site est à jour');
{
  V('site-php/assets/notes-bot.json existe', fs.existsSync(CIBLE));
  const copie = fs.readFileSync(CIBLE, 'utf8');
  V('identique à l\'octet près à ce que publie patchNotes.js', copie === extraire(),
    'lancer ./scripts-publier-moteur.sh après toute nouvelle note');
}

console.log('\n2) Le journal est exploitable par la page d\'accueil');
{
  const notes = JSON.parse(fs.readFileSync(CIBLE, 'utf8'));
  V('au moins une version', Array.isArray(notes) && notes.length > 0);
  V('chaque version a un id et un titre', notes.every(n => n.id && n.title));
  V('les rubriques sont des tableaux (ajout/fix/amelioration/retrait)',
    notes.every(n => ['ajout', 'fix', 'amelioration', 'retrait']
      .every(cle => n[cle] === undefined || Array.isArray(n[cle]) || typeof n[cle] === 'string')));
  V('le récapitulatif « initial » ouvre le journal', notes[0]?.id === 'initial');
}

console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
process.exit(ko === 0 ? 0 : 1);
