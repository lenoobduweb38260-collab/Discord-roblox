const { langueDe, DEFAUT, CLES } = require('./langues');

// 🌍 Traduire ce que le bot envoie — sur la couche réseau.
//
// Le bot écrit ses textes à 88 endroits. Les reprendre un par un pour les
// passer dans une fonction de traduction raterait forcément des cas, et tout
// nouveau message repartirait en français. On se place donc au seul passage
// obligé, comme le fait déjà l'identité visuelle : `rest.request`.
//
// ⚠️ Le gain décisif de cet endroit : on ne visite que les champs
// D'AFFICHAGE. Un `custom_id`, une `value` d'option, une URL ne sont jamais
// touchés — alors qu'un traducteur travaillant sur le code aurait pu traduire
// « aucune », « piste » ou « Véhicule », qui sont des VALEURS comparées, et
// casser le bot sans le moindre message d'erreur.
//
// Le dictionnaire est indexé par le texte français lui-même. Un traducteur
// lit donc du français et écrit sa langue, sans jamais voir de clé technique.

let _table = null;

function table() {
  if (_table) return _table;
  try {
    // eslint-disable-next-line global-require
    _table = require('./traductions.json');
  } catch {
    _table = {};
  }
  return _table;
}

// Recharge le dictionnaire — utile après un envoi de fichier depuis le
// tableau de bord, sans redémarrer le bot.
function recharger() {
  _table = null;
  try { delete require.cache[require.resolve('./traductions.json')]; } catch {}
  return Object.keys(table()).length;
}

// Traduit UNE chaîne. Renvoie l'original si rien n'est connu : un texte
// français vaut infiniment mieux qu'un texte vide, et infiniment mieux qu'une
// traduction approximative inventée à la volée.
function traduireTexte(texte, langue) {
  if (langue === DEFAUT || !texte) return texte;
  const t = table()[texte];
  const trouve = t?.[langue];
  return typeof trouve === 'string' && trouve.trim() ? trouve : texte;
}

// Les champs qu'on visite. Tout le reste — identifiants, valeurs, URL,
// couleurs — est laissé strictement intact.
function traduireEmbed(embed, langue) {
  if (!embed || typeof embed !== 'object') return;
  if (embed.title) embed.title = traduireTexte(embed.title, langue);
  if (embed.description) embed.description = traduireTexte(embed.description, langue);
  if (embed.footer?.text) embed.footer.text = traduireTexte(embed.footer.text, langue);
  if (embed.author?.name) embed.author.name = traduireTexte(embed.author.name, langue);
  for (const champ of embed.fields || []) {
    if (champ.name) champ.name = traduireTexte(champ.name, langue);
    if (champ.value) champ.value = traduireTexte(champ.value, langue);
  }
}

function traduireComposants(composants, langue) {
  for (const c of composants || []) {
    if (!c || typeof c !== 'object') continue;
    // ⚠️ `label`, `placeholder` et `content` s'affichent. `custom_id`,
    // `value` et `url` font fonctionner le bot : on n'y touche pas.
    if (typeof c.label === 'string') c.label = traduireTexte(c.label, langue);
    if (typeof c.placeholder === 'string') c.placeholder = traduireTexte(c.placeholder, langue);
    if (typeof c.content === 'string') c.content = traduireTexte(c.content, langue);
    for (const o of c.options || []) {
      if (typeof o.label === 'string') o.label = traduireTexte(o.label, langue);
      if (typeof o.description === 'string') o.description = traduireTexte(o.description, langue);
    }
    if (Array.isArray(c.components)) traduireComposants(c.components, langue);
    if (c.accessory) traduireComposants([c.accessory], langue);
  }
}

// Traduit un corps de requête entier, en place.
function traduireCorps(corps, langue) {
  if (!corps || typeof corps !== 'object' || langue === DEFAUT) return corps;
  const cibles = [corps];
  if (corps.data && typeof corps.data === 'object') cibles.push(corps.data);
  for (const cible of cibles) {
    if (typeof cible.content === 'string') cible.content = traduireTexte(cible.content, langue);
    for (const e of cible.embeds || []) traduireEmbed(e, langue);
    traduireComposants(cible.components, langue);
    // Un modal : son titre et les intitulés de ses champs se lisent.
    if (typeof cible.title === 'string') cible.title = traduireTexte(cible.title, langue);
  }
  return corps;
}

// 📊 Ce que couvre le dictionnaire, langue par langue.
function couverture() {
  const t = table();
  const textes = Object.keys(t);
  const parLangue = {};
  for (const l of CLES) {
    if (l === DEFAUT) { parLangue[l] = textes.length; continue; }
    parLangue[l] = textes.filter((x) => typeof t[x]?.[l] === 'string' && t[x][l].trim()).length;
  }
  return { total: textes.length, parLangue };
}

module.exports = { traduireCorps, traduireTexte, traduireEmbed, traduireComposants, couverture, recharger, table, langueDe };
