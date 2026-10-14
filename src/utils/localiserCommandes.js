const { traduireTexte } = require('./traduire');
const { CLES, DEFAUT } = require('./langues');

// 🌍 Les descriptions des commandes, dans la langue de chaque membre.
//
// C'est la seule partie du bot que la couche réseau ne peut PAS traduire.
// Les commandes sont enregistrées une fois pour toutes auprès de Discord, et
// c'est Discord qui les affiche — chacun dans SA langue, à partir des
// `*_localizations` fournies à l'enregistrement. Un serveur réglé en anglais
// n'y change rien : la description suit la langue du client.
//
// On remplit donc ces champs depuis le même dictionnaire que le reste. Une
// description sans traduction reste en français, comme partout ailleurs.
//
// ⚠️ Ce qu'on ne touche jamais :
//  • le NOM d'une commande, d'une sous-commande ou d'une option — c'est ce
//    qu'on tape, et ce que les messages d'aide citent (`/ticket panneau`).
//    Le traduire ferait mentir toutes les phrases qui le nomment ;
//  • la VALEUR d'un choix — elle est comparée dans le code.
// Seuls s'affichent, et se traduisent : les descriptions, et l'intitulé
// (`name`) des choix d'une option, que Discord montre sans jamais le lire.

// Discord attend ses propres codes, et l'anglais en a deux.
const CODES = {
  en: ['en-US', 'en-GB'],
  de: ['de'],
  ru: ['ru'],
  es: ['es-ES'],
};

function localisations(texte) {
  const out = {};
  for (const langue of CLES) {
    if (langue === DEFAUT) continue;
    const traduit = traduireTexte(texte, langue);
    if (!traduit || traduit === texte) continue;      // rien de connu : on laisse Discord retomber sur le français
    for (const code of CODES[langue] || []) out[code] = traduit.slice(0, 100);
  }
  return Object.keys(out).length ? out : null;
}

// Parcourt une commande déjà sérialisée (`data.toJSON()`), en place.
function localiser(noeud) {
  if (!noeud || typeof noeud !== 'object') return noeud;

  if (typeof noeud.description === 'string') {
    const l = localisations(noeud.description);
    if (l) noeud.description_localizations = { ...(noeud.description_localizations || {}), ...l };
  }
  for (const option of noeud.options || []) localiser(option);
  for (const choix of noeud.choices || []) {
    if (typeof choix.name !== 'string') continue;
    const l = localisations(choix.name);
    if (l) choix.name_localizations = { ...(choix.name_localizations || {}), ...l };
  }
  return noeud;
}

module.exports = { localiser, localisations, CODES };
