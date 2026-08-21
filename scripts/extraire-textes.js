#!/usr/bin/env node
// 🔤 Relève tous les textes que le bot affiche.
//
// Traduire un bot commence par savoir CE QU'IL Y A à traduire. Compter à la
// main est impossible et se trompe ; ce relevé, lui, se rejoue à chaque fois
// qu'on ajoute une phrase.
//
// On ne garde que ce qu'un être humain lit : une chaîne contenant des lettres
// accentuées, ou plusieurs mots français, ou un émoji suivi de texte. Les
// identifiants techniques (`cfgtktdel:`, `SELECT * FROM`, `#RRGGBB`) sont
// écartés — les traduire casserait le bot.
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..', 'src');

// Ce qui n'est JAMAIS du texte affiché.
const TECHNIQUE = [
  /^[a-z0-9_:.\-]+$/i,                    // identifiants, clés, routes
  /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|PRAGMA)\b/i,
  /^https?:\/\//,
  /^#[0-9a-f]{3,8}$/i,
  /^[\s\-─=_*#`|]+$/,                     // décors, séparateurs
  /^\d+$/,
  /^<@?[!&#]?\d*>?$/,
  /^attachment:\/\//,
  /^application\/|^image\/|^video\//,
];

// Ce qui ressemble à une phrase destinée à un lecteur.
const ACCENTS = /[àâäçéèêëîïôöùûüÿœæ]/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

function estAffiche(texte) {
  const t = texte.trim();
  if (t.length < 3) return false;
  if (TECHNIQUE.some((re) => re.test(t))) return false;
  // Une phrase : des accents, un émoji suivi de mots, ou au moins deux mots
  // dont un de plus de trois lettres.
  if (ACCENTS.test(t)) return true;
  if (EMOJI.test(t) && /[a-zA-Zà-ÿ]{3,}/.test(t)) return true;
  const mots = t.split(/\s+/).filter((m) => /[a-zA-Zà-ÿ]{2,}/.test(m));
  return mots.length >= 3 && mots.some((m) => m.length > 3);
}

// Découpe un fichier en chaînes littérales, en gardant la ligne d'origine.
function chainesDe(source) {
  const trouvees = [];
  const lignes = source.split('\n');
  lignes.forEach((ligne, i) => {
    // On saute les commentaires : ils ne s'affichent pas.
    if (/^\s*(\/\/|\*|\/\*)/.test(ligne)) return;
    const motifs = [
      /'((?:[^'\\]|\\.)*)'/g,
      /"((?:[^"\\]|\\.)*)"/g,
      /`((?:[^`\\$]|\\.)*)`/g,
    ];
    for (const re of motifs) {
      for (const m of ligne.matchAll(re)) {
        const brut = m[1].replace(/\\'/g, "'").replace(/\\"/g, '"');
        if (estAffiche(brut)) trouvees.push({ texte: brut, ligne: i + 1 });
      }
    }
  });
  return trouvees;
}

// ⚠️ Certaines chaînes NE DOIVENT PAS être traduites : ce sont des valeurs,
// pas du texte. « aucune », « piste » et « file » sont les trois modes de
// boucle de la musique, comparés avec `includes()` ; les traduire casserait
// la commande sans le moindre message d'erreur.
//
// On repère ce cas à l'usage : une chaîne comparée (`=== '…'`), cherchée
// (`includes('…')`, `has('…')`), ou utilisée comme clé d'objet. Un traducteur
// qui reçoit le fichier doit savoir lesquelles laisser tranquilles.
const USAGES_RISQUES = [
  (t) => new RegExp(`===\\s*['"\`]${echapper(t)}['"\`]`),
  (t) => new RegExp(`['"\`]${echapper(t)}['"\`]\\s*===`),
  (t) => new RegExp(`\\.(?:includes|has|get|set|startsWith|endsWith)\\(\\s*['"\`]${echapper(t)}['"\`]`),
  (t) => new RegExp(`['"\`]${echapper(t)}['"\`]\\s*:`),
  (t) => new RegExp(`case\\s+['"\`]${echapper(t)}['"\`]`),
];
const echapper = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function estRisque(texte, source) {
  if (texte.length > 40) return false; // une phrase n'est jamais une valeur
  return USAGES_RISQUES.some((faire) => faire(texte).test(source));
}

// Une clé stable, lisible, et qui ne bouge pas quand le fichier grossit :
// dossier.fichier.numéro-d'ordre-dans-le-fichier.
function cleDe(rel, index) {
  const base = rel.replace(/\.js$/, '').replace(/[/\\]/g, '.');
  return `${base}.${String(index + 1).padStart(3, '0')}`;
}

function parcourir(dossier, sortie = []) {
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) parcourir(p, sortie);
    else if (e.name.endsWith('.js')) sortie.push(p);
  }
  return sortie;
}

function relever() {
  const catalogue = [];
  // manager/index.js embarque une page web entière : ses chaînes sont du HTML,
  // pas des messages du bot.
  const ecartes = new Set(['manager/index.js', 'utils/patchNotes.js']);
  for (const fichier of parcourir(RACINE).sort()) {
    const rel = path.relative(RACINE, fichier).replace(/\\/g, '/');
    if (ecartes.has(rel)) continue;
    const source = fs.readFileSync(fichier, 'utf8');
    const vues = new Set();
    chainesDe(source).forEach((c) => {
      if (vues.has(c.texte)) return; // un même texte deux fois = une entrée
      vues.add(c.texte);
      catalogue.push({
        cle: cleDe(rel, vues.size - 1),
        fichier: rel,
        ligne: c.ligne,
        fr: c.texte,
        risque: estRisque(c.texte, source),
      });
    });
  }
  return catalogue;
}

// 📄 Le fichier qu'on donne aux traducteurs.
//
// Du CSV, parce qu'il s'ouvre dans Excel, LibreOffice et Google Sheets sans
// rien installer — et que plusieurs personnes peuvent s'y partager les lignes.
// Une colonne par langue, vide, à remplir.
const LANGUES_CIBLES = [['en', 'English'], ['de', 'Deutsch'], ['ru', 'Russe'], ['es', 'Espagnol']];

function versCSV(catalogue, dejaTraduits = {}) {
  // Le point-virgule plutôt que la virgule : Excel en français attend cela,
  // et nos textes sont pleins de virgules.
  const guillemets = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lignes = [
    ['Cle', 'Fichier', 'Ligne', 'A NE PAS TRADUIRE', 'Francais (source)', ...LANGUES_CIBLES.map(([, n]) => n)]
      .map(guillemets).join(';'),
  ];
  for (const e of catalogue) {
    lignes.push([
      e.cle, e.fichier, e.ligne,
      e.risque ? 'OUI — valeur technique, laisser tel quel' : '',
      e.fr,
      ...LANGUES_CIBLES.map(([c]) => (e.risque ? e.fr : (dejaTraduits[e.fr]?.[c] || ''))),
    ].map(guillemets).join(';'));
  }
  // Le BOM : sans lui, Excel affiche « Ã© » à la place de « é ».
  return `\uFEFF${lignes.join('\r\n')}\r\n`;
}

if (require.main === module) {
  const catalogue = relever();
  const parFichier = new Map();
  for (const e of catalogue) parFichier.set(e.fichier, (parFichier.get(e.fichier) || 0) + 1);
  const tries = [...parFichier.entries()].sort((a, b) => b[1] - a[1]);

  console.log(`${catalogue.length} textes affichés, dans ${parFichier.size} fichiers.\n`);
  console.log('Les vingt fichiers les plus fournis :');
  for (const [f, n] of tries.slice(0, 20)) console.log(`  ${String(n).padStart(4)}  ${f}`);
  const signes = catalogue.reduce((n, e) => n + e.fr.length, 0);
  const risques = catalogue.filter((e) => e.risque).length;
  console.log(`\nVolume total : ${signes.toLocaleString('fr-FR')} signes.`);
  console.log(`Dont ${risques} chaîne(s) à NE PAS traduire (valeurs techniques).`);

  const sortie = process.argv[2];
  if (sortie) {
    let deja = {};
    try { deja = require('../src/utils/traductions.json'); } catch { deja = {}; }
    fs.writeFileSync(sortie, versCSV(catalogue, deja), 'utf8');
    console.log(`\n📄 Fichier des traducteurs écrit : ${sortie}`);
  } else {
    console.log('\n➜ Pour produire le fichier des traducteurs :');
    console.log('   node scripts/extraire-textes.js traductions.csv');
  }
}

module.exports = { relever, estAffiche, chainesDe, estRisque, versCSV, LANGUES_CIBLES };
