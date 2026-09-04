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

console.log('\n1) Les six langues demandées');
{
  V('six langues', LG.CLES.length === 6, LG.CLES.join(', '));
  for (const c of ['fr', 'en', 'de', 'ru', 'es', 'pl']) V(`${c} présente`, LG.CLES.includes(c));
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

console.log('\n10) Le relevé lit vraiment le JavaScript');
{
  // Les trois pièges qui faisaient relever de faux textes — et en rater de vrais.
  const BT = String.fromCharCode(96);
  const gabarit = 'const a = ' + BT + '<@${id}> — c\'est le **demandeur** : fermez le ticket plutôt que de l\'en sortir' + BT + ';';
  const vus = extracteur.chainesDe(gabarit).map((c) => c.texte);
  V('une apostrophe dans un gabarit n\'ouvre pas une fausse chaîne',
    !vus.some((t) => t.startsWith('est le **demandeur**')), vus.join(' | '));
  V('… le morceau fixe du gabarit, lui, est relevé',
    vus.some((t) => t.includes('c\'est le **demandeur**')), vus.join(' | '));

  const saut = extracteur.chainesDe('const b = "Première ligne.\\nSeconde ligne.";').map((c) => c.texte);
  V('\\n est décodé en vrai saut de ligne', saut.some((t) => t.includes('\n')), JSON.stringify(saut));
  V('… et pas laissé en deux caractères', !saut.some((t) => t.includes('\\n')));

  const gab2 = 'const c = ' + BT + '✅ ${qui} a été ajouté au salon réservé.' + BT + ';';
  const morceaux = extracteur.chainesDe(gab2).map((c) => c.texte);
  V('les morceaux fixes d\'un gabarit sont relevés',
    morceaux.some((t) => t.includes('a été ajouté au salon')), morceaux.join(' | '));

  const ternaire = 'const d = ajout ? \'ajouté(s) au\' : \'retiré(s) du\';';
  V('une branche de ternaire n\'est pas prise pour une clé d\'objet',
    !extracteur.estRisque('ajouté(s) au', ternaire));
  V('… mais une vraie clé d\'objet reste protégée',
    extracteur.estRisque('Rôle staff', 'const e = { \'Rôle staff\': 1 };'));
}

console.log('\n11) Les phrases construites par morceaux');
{
  // `✅ ${membre} a été ajouté au ticket.` ne figure jamais entier dans le
  // dictionnaire : sans le rattrapage par morceaux, il resterait en français.
  const phrase = '✅ <@42> a été ajouté au ticket.';
  const en = TR.traduireTexte(phrase, 'en');
  V('une phrase à trous est traduite morceau par morceau', /was added to the ticket/.test(en), en);
  V('… la valeur au milieu reste intacte', en.includes('<@42>'), en);
  V('… et le français n\'y survit pas', !/a été ajouté/.test(en), en);

  V('un texte inconnu revient tel quel',
    TR.traduireTexte('phrase absolument inconnue du dictionnaire', 'en') === 'phrase absolument inconnue du dictionnaire');
  V('la langue source ne passe jamais par le dictionnaire',
    TR.traduireTexte('🎫 Contenu du panneau', 'fr') === '🎫 Contenu du panneau');
}

console.log('\n12) Les descriptions de commandes');
{
  // Discord affiche une description dans la langue du MEMBRE, à partir des
  // `*_localizations` données à l'enregistrement. C'est la seule surface que
  // la couche réseau ne peut pas traduire.
  const { localiser } = require('../src/utils/localiserCommandes');
  const cmd = localiser({
    name: 'ticket',
    description: '[Staff] Système de tickets : types, catégories et panneau',
    options: [{
      type: 1,
      name: 'panneau',
      description: 'Publier le panneau de tickets dans un salon',
      options: [{
        type: 3, name: 'format', description: 'Format du message du panneau',
        choices: [{ name: '🔘 Boutons', value: 'boutons' }],
      }],
    }],
  });
  V('la description part traduite', cmd.description_localizations?.['en-US'] === '[Staff] Ticket system: types, categories and panel',
    JSON.stringify(cmd.description_localizations));
  V('… les deux anglais sont servis', Boolean(cmd.description_localizations?.['en-GB']));
  V('… une sous-commande aussi', cmd.options[0].description_localizations?.['en-US'] === 'Publish the ticket panel in a channel');
  V('… une option aussi', cmd.options[0].options[0].description_localizations?.['en-US'] === 'Format of the panel message');
  V('… l\'intitulé d\'un choix aussi', cmd.options[0].options[0].choices[0].name_localizations?.['en-US'] === '🔘 Buttons');
  V('le NOM d\'une commande ne bouge jamais', cmd.name === 'ticket' && !cmd.name_localizations);
  V('… ni celui d\'une option', cmd.options[0].options[0].name === 'format');
  V('… ni la VALEUR d\'un choix', cmd.options[0].options[0].choices[0].value === 'boutons');

  const sync = fs.readFileSync(`${__dirname}/../src/commandSync.js`, 'utf8');
  V('la synchronisation passe par la localisation', /localiser\(command\.data\.toJSON\(\)\)/.test(sync));
}

console.log('\n13) Les documents RP dessinés');
{
  const V2 = require('../src/utils/carteVisuelle');
  const carte = V2.planCarte({ rp_nom: 'Doe', rp_prenom: 'John' }, { langue: 'en' });
  const textes = carte.textes.map((t) => t.texte);
  V('le titre du document suit la langue', textes.includes('RP IDENTITY CARD'), textes.join(' | '));
  V('… la mention légale aussi', textes.includes('RP DOCUMENT - NO LEGAL VALUE'));
  // Les intitulés sont dessinés en capitales.
  V('… et les étiquettes des champs', textes.includes('SURNAME') && textes.includes('FIRST NAME'), textes.join(' | '));

  const fr = V2.planCarte({ rp_nom: 'Doe' }, {}).textes.map((t) => t.texte);
  V('sans langue, tout reste en français', fr.includes("CARTE D'IDENTITE RP") && fr.includes('NOM'), fr.join(' | '));

  const permis = V2.planPermis({ valid: 1, points: 12 }, { langue: 'en' }).textes.map((t) => t.texte);
  V('le permis suit la langue', permis.includes('RP DRIVING LICENCE') && permis.includes('VALID'), permis.join(' | '));

  // Les polices de jimp ne dessinent pas le cyrillique : un document anglais
  // se lit, un document en carrés vides non.
  V('le russe reprend l\'anglais, faute de police cyrillique',
    V2.ETIQUETTES.ru === V2.ETIQUETTES.en);
}

console.log('\n14) L\'IA répond dans la langue du serveur');
{
  const ai = fs.readFileSync(`${__dirname}/../src/utils/aiResponder.js`, 'utf8');
  V('la consigne n\'écrit plus « en français » en dur', !/en français, et fidèle au ton/.test(ai));
  V('… elle porte la langue reçue', /nomFr\}, et fidèle au ton/.test(ai));
  V('… et la langue vient du serveur', /langueDe\(message\.guildId\)/.test(ai) && /langueDe\(interaction\.guildId\)/.test(ai));
  for (const c of LG.CLES) V(`${c} a son nom en français`, Boolean(LG.LANGUES[c].nomFr), LG.LANGUES[c].nomFr);
}

console.log('\n15) Couverture : tout le bot est traduit dans CHAQUE langue');
{
  const catalogue = extracteur.relever().filter((e) => !e.risque);
  const table = TR.table();
  // Le moindre petit détail, dans toutes les langues : une chaîne ajoutée
  // sans ses six versions fait échouer la suite — c'est voulu.
  for (const langue of LG.CLES.filter((c) => c !== 'fr')) {
    const manquants = catalogue.filter((e) => !table[e.fr]?.[langue]);
    V(`aucun texte sans ${LG.LANGUES[langue].nomFr} (${catalogue.length} relevés)`, manquants.length === 0,
      `${manquants.length} manquant(s) — ` + manquants.slice(0, 3).map((e) => JSON.stringify(e.fr)).join(' | '));
  }
}

fs.rmSync(RACINE, { recursive: true, force: true });
console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
process.exit(ko === 0 ? 0 : 1);
