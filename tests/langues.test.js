// 🌍 La traduction du bot, par serveur.
const fs = require('fs');
const os = require('os');
const path = require('path');
const AIDES = path.join(__dirname, 'aides');

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'langues-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  return vrai.apply(this, arguments);
};

const LG = require('../src/utils/langues');
const TR = require('../src/utils/traduire');
const { setGuildConfig } = require('../src/database');
const extracteur = require('../scripts/extraire-textes');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

console.log('\n1) Les cinq langues demandées');
{
  V('cinq langues', LG.CLES.length === 5, LG.CLES.join(', '));
  for (const c of ['fr', 'en', 'de', 'ru', 'es']) V(`${c} présente`, LG.CLES.includes(c));
  V('le français est la langue source', LG.DEFAUT === 'fr');
  V('chacune a un nom et un drapeau', LG.liste().every((l) => l.nom && l.drapeau));
}

console.log('\n2) Aucune traduction manquante dans le dictionnaire de base');
{
  // Une clé ajoutée en oubliant une colonne retomberait en français sans
  // prévenir : autant le voir ici.
  for (const c of LG.CLES) {
    const k = LG.couverture(c);
    V(`${LG.LANGUES[c].nom} : ${k.traduites}/${k.total}`, k.complet, LG.manquantes(c).join(', '));
  }
}

console.log('\n3) Les replis');
{
  V('une langue inconnue retombe sur le français', LG.t('klingon', 'commun.reserveStaff') === LG.t('fr', 'commun.reserveStaff'));
  V('une clé inconnue s\'affiche telle quelle', LG.t('en', 'clef.qui.nexiste.pas') === 'clef.qui.nexiste.pas');
  V('un texte à variables se compose', /Membre/.test(LG.t('ru', 'role.donne', { role: 'Membre' })));
  V('… dans la bonne langue', /Вам выдана роль/.test(LG.t('ru', 'role.donne', { role: 'x' })));
  setGuildConfig('g1', 'bot_langue', 'de');
  V('la langue vient du serveur', LG.langueDe('g1') === 'de');
  setGuildConfig('g1', 'bot_langue', 'nawak');
  V('une valeur invalide retombe sur le français', LG.langueDe('g1') === 'fr');
}

console.log('\n4) La traduction sur la couche réseau');
{
  // On prend des textes VRAIMENT dans le dictionnaire : « Salon » ou « Aucun »
  // en ont été écartés d'office, parce qu'ils servent aussi de valeurs
  // comparées. C'est précisément ce que le garde-fou doit faire.
  const corps = {
    content: 'Prénom RP',
    embeds: [{
      title: 'Gestion des entreprises RP',
      description: 'Membre (défaut : vous)',
      footer: { text: 'Système de carte d\'identité RP' },
      author: { name: 'Prénom RP' },
      fields: [{ name: 'Prénom RP', value: 'Gestion des entreprises RP' }],
    }],
    components: [{
      type: 1,
      components: [{ type: 2, custom_id: 'aucune', label: 'Prénom RP', url: 'https://x/Prénom RP' }],
    }],
  };
  TR.traduireCorps(corps, 'en');
  V('le contenu est traduit', corps.content === 'RP first name', corps.content);
  V('le titre aussi', corps.embeds[0].title === 'RP company management');
  V('la description aussi', corps.embeds[0].description === 'Member (defaults to you)');
  V('le pied de page aussi', corps.embeds[0].footer.text === 'RP ID card system');
  V('la ligne d\'auteur aussi', corps.embeds[0].author.name === 'RP first name');
  V('les champs aussi', corps.embeds[0].fields[0].name === 'RP first name'
    && corps.embeds[0].fields[0].value === 'RP company management');
  V('le libellé d\'un bouton aussi', corps.components[0].components[0].label === 'RP first name');

  // 🔑 Le point qui justifie de traduire ICI plutôt que dans le code.
  V('l\'IDENTIFIANT du bouton n\'est PAS touché',
    corps.components[0].components[0].custom_id === 'aucune', corps.components[0].components[0].custom_id);
  V('l\'URL non plus', corps.components[0].components[0].url === 'https://x/Prénom RP');
}

console.log('\n5) Le français ne passe par rien');
{
  const corps = { content: 'Prénom RP', embeds: [{ title: 'Gestion des entreprises RP' }] };
  TR.traduireCorps(corps, 'fr');
  V('rien n\'est modifié', corps.content === 'Prénom RP' && corps.embeds[0].title === 'Gestion des entreprises RP');
}

console.log('\n6) Un texte sans traduction reste en français');
{
  const corps = { content: 'Une phrase que personne n\'a traduite' };
  TR.traduireCorps(corps, 'de');
  V('l\'original est conservé', corps.content === 'Une phrase que personne n\'a traduite');
  V('… jamais du vide', corps.content.length > 0);
}

console.log('\n7) Les valeurs comparées sont écartées du dictionnaire');
{
  // ⚠️ « Salon », « Aucun », « Source » s'affichent MAIS servent aussi de
  // valeurs comparées ailleurs. L'import les refuse, même si un traducteur a
  // rempli la case : les traduire casserait le bot en silence.
  const table = TR.table();
  for (const mot of ['Salon', 'Aucun', 'Aucune', 'Source']) {
    V(`« ${mot} » n'est pas dans le dictionnaire`, table[mot] === undefined);
  }
  const corps = {
    components: [{
      type: 3, custom_id: 'm', placeholder: 'Prénom RP',
      options: [{ label: 'Prénom RP', value: 'aucune', description: 'Gestion des entreprises RP' }],
    }],
  };
  TR.traduireCorps(corps, 'en');
  V('le libellé d\'option est traduit', corps.components[0].options[0].label === 'RP first name');
  V('le placeholder aussi', corps.components[0].placeholder === 'RP first name');
  V('mais la VALEUR reste intacte', corps.components[0].options[0].value === 'aucune');
}

console.log('\n8) Le relevé des textes à traduire');
{
  const catalogue = extracteur.relever();
  V('le relevé trouve des milliers de textes', catalogue.length > 1000, String(catalogue.length));
  V('chaque entrée porte son fichier et sa ligne', catalogue.every((e) => e.fichier && e.ligne > 0));
  V('… et une clé unique', new Set(catalogue.map((e) => e.cle)).size === catalogue.length);

  // ⚠️ Les valeurs comparées ne doivent PAS partir chez un traducteur.
  V('« aucune » est signalée comme intraduisible',
    catalogue.filter((e) => e.fr === 'aucune').every((e) => e.risque),
    JSON.stringify(catalogue.filter((e) => e.fr === 'aucune').map((e) => e.risque)));
  V('des chaînes techniques sont écartées d\'office', !catalogue.some((e) => /^SELECT |^https?:\/\//.test(e.fr)));
  V('une phrase longue n\'est jamais prise pour une valeur',
    !catalogue.some((e) => e.risque && e.fr.length > 40));

  const csv = extracteur.versCSV(catalogue.slice(0, 3));
  V('le CSV commence par un BOM, pour Excel', csv.charCodeAt(0) === 0xFEFF);
  V('… une colonne par langue', /English";"Deutsch";"Russe";"Espagnol"/.test(csv));
  V('… et une colonne d\'avertissement', /A NE PAS TRADUIRE/.test(csv));
}

console.log('\n9) Branchements');
{
  const se = fs.readFileSync(`${__dirname}/../src/utils/styleEmbeds.js`, 'utf8');
  V('la traduction est posée sur la couche réseau', /traduire\(client, options\);/.test(se));
  V('… après l\'identité, dont les textes doivent être traduits aussi',
    se.indexOf('appliquer(client, options);') < se.indexOf('traduire(client, options);'));
  V('… et avant la conversion en carte', se.indexOf('traduire(client, options);') < se.indexOf('origine = preparerCartes'));
  const cp = fs.readFileSync(`${__dirname}/../src/utils/configPanel.js`, 'utf8');
  V('la langue se choisit dans /config', /setCustomId\('cfglangue'\)/.test(cp));
  V('… et le choix est enregistré', /setGuildConfig\(interaction\.guildId, 'bot_langue', choix\)/.test(cp));
  const an = fs.readFileSync(`${__dirname}/../src/commands/annonce.js`, 'utf8');
  V('/annonce est réservée au créateur', /isCreator\(interaction\.user\.id\)/.test(an));
  V('… elle réutilise l\'éditeur, pas un second', /composer\.start\(interaction/.test(an));
  V('… avec un mode sans cadre', /sans_embed/.test(an));
  V('… et des images en pièce jointe', /addAttachmentOption/.test(an));
}

fs.rmSync(RACINE, { recursive: true, force: true });
console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
process.exit(ko === 0 ? 0 : 1);
