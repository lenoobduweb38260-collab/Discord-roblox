// 🔕 Les mentions d'embed ne sonnent pas — celles du contenu, si.
//
// Un embed n'a jamais notifié personne. Converti en carte, son texte devenait
// du contenu ordinaire et chaque @mention s'était mise à sonner : les annonces
// d'absence pinguaient leurs membres, les journaux pinguaient le staff. La
// conversion restaure la sémantique d'origine.
const cartes = require('../src/utils/cartes');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

console.log('\n1) Une mention d\'embed s\'affiche sans sonner');
{
  const s = cartes.convertirCorps({ embeds: [{ title: '📅 Absence', description: '<@111> sera absent(e).' }] });
  V('la carte est bien convertie', Boolean(s && (s.flags & cartes.DRAPEAU_V2)));
  V('aucune mention n\'est autorisée à notifier',
    s.allowed_mentions && s.allowed_mentions.parse.length === 0
    && s.allowed_mentions.users.length === 0 && s.allowed_mentions.roles.length === 0,
    JSON.stringify(s.allowed_mentions));

  const roles = cartes.convertirCorps({ embeds: [{ description: 'Prévenez <@&42> et <@7>.' }] });
  V('… rôles compris', roles.allowed_mentions.roles.length === 0 && roles.allowed_mentions.users.length === 0);
}

console.log('\n2) La mention du CONTENU — celle des tickets — sonne toujours');
{
  // C'est le schéma du ticket : le ping partait déjà dans `content` du temps
  // des embeds, et il notifiait. Il doit continuer.
  const s = cartes.convertirCorps({
    content: '<@222> <@&333>',
    embeds: [{ description: 'Bonjour <@222> ! Décrivez votre demande.' }],
  });
  V('l\'utilisateur du contenu peut être notifié', s.allowed_mentions.users.join(',') === '222', JSON.stringify(s.allowed_mentions));
  V('le rôle support aussi', s.allowed_mentions.roles.join(',') === '333');
  V('mais pas les mentions venues de l\'embed seul', !s.allowed_mentions.users.includes('999'));

  const partout = cartes.convertirCorps({ content: '@here on ouvre !', embeds: [{ description: 'texte assez long' }] });
  V('@everyone / @here du contenu survivent', partout.allowed_mentions.parse.includes('everyone'));

  const doublons = cartes.convertirCorps({ content: '<@5> <@5> <@!5>', embeds: [{ description: 'x' }] });
  V('les doublons ne sont comptés qu\'une fois', doublons.allowed_mentions.users.join(',') === '5', JSON.stringify(doublons.allowed_mentions.users));
}

console.log('\n3) Un choix explicite n\'est jamais écrasé');
{
  const s = cartes.convertirCorps({
    allowed_mentions: { parse: ['users'] },
    embeds: [{ description: '<@1>' }],
  });
  V('l\'envoyeur qui a réglé ses mentions garde son réglage',
    JSON.stringify(s.allowed_mentions) === JSON.stringify({ parse: ['users'] }));
}

console.log('\n4) Branchements');
{
  const fs = require('fs');
  const copie = fs.readFileSync(`${__dirname}/../site-php/assets/js/moteur-cartes.js`, 'utf8');
  const source = fs.readFileSync(`${__dirname}/../src/utils/cartes.js`, 'utf8');
  V('la copie navigateur est identique à l\'octet près', copie === source);
  V('la règle vit dans le moteur partagé', /mentionsDuContenu/.test(source));
  const tk = fs.readFileSync(`${__dirname}/../src/utils/tickets.js`, 'utf8');
  V('le ping du ticket part bien dans le contenu (donc il sonne)',
    /content: `<\$\{owner\.id\}>/.test(tk) || /content: `<@\$\{owner\.id\}>/.test(tk));
}

console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
process.exit(ko === 0 ? 0 : 1);
