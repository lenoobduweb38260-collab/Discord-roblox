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
//
// ⚠️ On lit CARACTÈRE PAR CARACTÈRE, pas avec des expressions régulières.
// Trois raisons, toutes déjà payées :
//
//  • Un gabarit `… ${x} …` échappe à une expression régulière qui refuse le
//    `$`. La règle des apostrophes prend alors le relais et relève le morceau
//    ENTRE deux apostrophes : dans « c'est le demandeur : … plutôt que de
//    l'en sortir » elle sortait « est le demandeur : … plutôt que de l ».
//    Un texte qui n'existe pas, à faire traduire pour rien.
//  • Les morceaux FIXES d'un gabarit sont du vrai texte affiché. « a été
//    ajouté au ticket. » doit être relevé : c'est ainsi qu'il arrive à
//    l'écran, et donc ainsi qu'il faut le chercher dans le dictionnaire.
//  • `\n` dans le code est un VRAI saut de ligne à l'exécution. Le garder
//    sous forme de deux caractères donnait une clé qui ne correspondait à
//    aucun message réel : la traduction ne sortait jamais.

const ECHAPPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
// Ce qui peut précéder une expression régulière. Ni `)` ni `]` ni une lettre :
// après eux, `/` est une division.
const AVANT_REGEX = /[(,=:[!&|?{};+\-*%~^<>]/;
// … ou un mot-clé : `return /…/` est une expression régulière, pas une division.
const MOTS_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'void', 'delete', 'instanceof', 'yield', 'await']);

// Le mot qui précède la position donnée, espaces sautés.
function motAvant(source, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(source[j])) j -= 1;
  let fin = j + 1;
  while (j >= 0 && /[A-Za-z]/.test(source[j])) j -= 1;
  return source.slice(j + 1, fin);
}

function chainesDe(source) {
  const trouvees = [];
  const n = source.length;
  let i = 0;
  let ligne = 1;
  let precedent = '';
  // Le bas de pile est le code du fichier ; chaque gabarit ouvert empile un
  // cadre, et chaque `${` empile à son tour un cadre de code.
  const pile = [{ mode: 'code', profondeur: 0 }];

  const emettre = (texte, l) => { if (estAffiche(texte)) trouvees.push({ texte, ligne: l }); };

  while (i < n) {
    const cadre = pile[pile.length - 1];
    const c = source[i];

    // ── Dans un gabarit : on accumule jusqu'au ` ou au ${
    if (cadre.mode === 'gabarit') {
      if (c === '\\') {
        if (source[i + 1] === '\n') ligne += 1;
        cadre.texte += ECHAPPES[source[i + 1]] ?? source[i + 1];
        i += 2; continue;
      }
      if (c === '`') { emettre(cadre.texte, cadre.ligne); pile.pop(); precedent = '`'; i += 1; continue; }
      if (c === '$' && source[i + 1] === '{') {
        emettre(cadre.texte, cadre.ligne);
        cadre.texte = '';
        pile.push({ mode: 'code', profondeur: 0 });
        precedent = '{'; i += 2; continue;
      }
      if (c === '\n') ligne += 1;
      cadre.texte += c; i += 1; continue;
    }

    // ── Dans du code
    if (c === '\n') { ligne += 1; i += 1; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i += 1; continue; }

    if (c === '/' && source[i + 1] === '/') { while (i < n && source[i] !== '\n') i += 1; continue; }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) { if (source[i] === '\n') ligne += 1; i += 1; }
      i += 2; continue;
    }

    // Une expression régulière : son contenu n'est pas du texte, et ses
    // apostrophes ne doivent surtout pas ouvrir une fausse chaîne.
    if (c === '/' && (precedent === '' || AVANT_REGEX.test(precedent) || MOTS_REGEX.has(motAvant(source, i)))) {
      i += 1;
      let classe = false;
      while (i < n && source[i] !== '\n') {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '[') classe = true;
        else if (source[i] === ']') classe = false;
        else if (source[i] === '/' && !classe) { i += 1; break; }
        i += 1;
      }
      while (i < n && /[a-z]/.test(source[i])) i += 1;
      precedent = '/'; continue;
    }

    if (c === "'" || c === '"') {
      const debut = ligne;
      let texte = '';
      i += 1;
      while (i < n) {
        const d = source[i];
        if (d === '\\') {
          if (source[i + 1] === '\n') ligne += 1;
          texte += ECHAPPES[source[i + 1]] ?? source[i + 1];
          i += 2; continue;
        }
        if (d === c) { i += 1; break; }
        if (d === '\n') { ligne += 1; i += 1; break; } // chaîne non close : on abandonne
        texte += d; i += 1;
      }
      emettre(texte, debut);
      precedent = c; continue;
    }

    if (c === '`') { pile.push({ mode: 'gabarit', ligne, texte: '' }); i += 1; continue; }

    if (c === '{') { cadre.profondeur += 1; precedent = '{'; i += 1; continue; }
    if (c === '}') {
      if (cadre.profondeur === 0 && pile.length > 1) {
        pile.pop();
        const gabarit = pile[pile.length - 1];
        gabarit.ligne = ligne;      // le morceau suivant commence ici
        precedent = '}'; i += 1; continue;
      }
      cadre.profondeur = Math.max(0, cadre.profondeur - 1);
      precedent = '}'; i += 1; continue;
    }

    precedent = c; i += 1;
  }
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
  // ⚠️ Une clé d'objet, PAS un ternaire. `ajout ? 'ajouté(s) au' : 'retiré(s) du'`
  // finit lui aussi par un deux-points : sans l'accroche `{` ou `,`, ces deux
  // morceaux de phrase étaient déclarés « valeur technique, ne pas traduire ».
  (t) => new RegExp(`(?:^|[{,])\\s*['"\`]${echapper(t)}['"\`]\\s*:`, 'm'),
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
  // utils/langues.js et traductions.json SONT le dictionnaire : les relever
  // reviendrait à demander de traduire les traductions.
  // commands/interact.js porte ses propres traductions et suit la langue
  // Discord de chaque membre, pas celle du serveur : le relever ferait
  // retraduire des phrases déjà écrites en anglais, en espagnol et en
  // allemand dans le fichier lui-même.
  const ecartes = new Set([
    'manager/index.js', 'utils/patchNotes.js', 'utils/langues.js',
    'utils/traduire.js', 'commands/interact.js',
  ]);
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
