const { getGuildConfig } = require('../database');
const { convertirCorps, DRAPEAU_V2 } = require('./cartes');
const {
  styliserUn, couleurNeutre, versEntier, filetDe,
  COULEURS_NEUTRES, DEFAUT_ACCENT, FILET, FILET_DEFAUT,
} = require('./identite');

// 🎨 Identité visuelle des embeds — appliquée PARTOUT.
//
// Le bot construit ses embeds à 80 endroits différents. Les reprendre un par
// un raterait forcément des cas, et tout nouvel embed repartirait sans style.
// On se place donc au seul passage obligé : la couche REST de discord.js.
// Tout ce que le bot envoie — message de salon, réponse à une commande,
// message privé, webhook — passe par `rest.request`.
//
// Règle d'or : ce code ne doit JAMAIS lever d'erreur. Une exception ici
// empêcherait le bot d'envoyer quoi que ce soit.

// Réglages d'identité pour un serveur (valeurs par défaut si non configuré).
function reglages(guildId) {
  let cfg = {};
  try {
    cfg = guildId ? getGuildConfig(guildId) || {} : {};
  } catch {
    cfg = {};
  }
  return {
    actif: Number(cfg.embed_style ?? 1) === 1,
    accent: versEntier(cfg.embed_accent) ?? versEntier(DEFAUT_ACCENT),
    piedDePage: Number(cfg.embed_footer ?? 1) === 1,
    ligneAuteur: Number(cfg.embed_author ?? 1) === 1,
    horodatage: Number(cfg.embed_timestamp ?? 1) === 1,
    // Couleur unique partout, ou couleurs par type (rouge = sanction,
    // vert = réussite…) ? Par défaut on garde le sens des couleurs.
    couleurUnique: Number(cfg.embed_force_color ?? 0) === 1,
    ligne: Number(cfg.embed_ligne ?? 1) === 1,
    filet: filetDe(cfg.embed_filet_taille ?? FILET_DEFAUT),
    fusion: Number(cfg.embed_fusion ?? 1) === 1,
    banniere: /^https?:\/\/\S+$/i.test(String(cfg.embed_banniere || '').trim())
      ? String(cfg.embed_banniere).trim()
      : null,
    // 🃏 Cartes sans bordure : le message n'est plus un embed mais un
    // conteneur de composants. C'est la seule façon de se débarrasser de la
    // barre verticale colorée que Discord colle au bord gauche des embeds.
    cartes: Number(cfg.embed_cartes ?? 1) === 1,
    // 'aucune' → pas de barre du tout ; 'accent' → on la garde, à la couleur
    // du serveur, pour qui la préfère.
    bordure: String(cfg.embed_bordure || 'aucune') === 'accent' ? 'accent' : 'aucune',
    // Taille du titre en tête de carte : « grand » (#) donne l'en-tête large
    // d'un vrai panneau, « moyen » (##) reste discret.
    titre: String(cfg.embed_titre || 'grand') === 'moyen' ? 'moyen' : 'grand',
  };
}


// 🎟️ Mémoire des interactions en cours.
// Une réponse de commande part sur /interactions/<id>/<jeton>/callback ou
// /webhooks/<app>/<jeton>/… : ni l'une ni l'autre ne dit sur QUEL serveur on
// se trouve. Sans cela, les réglages par serveur ne s'appliqueraient pas aux
// réponses de commandes — c'est-à-dire à la majorité des embeds du bot.
// On retient donc le serveur au moment où l'interaction arrive.
// Un jeton d'interaction vit 15 minutes : on nettoie au-delà.
const _interactions = new Map();
const DUREE_JETON = 15 * 60 * 1000;

function noterInteraction(interaction) {
  try {
    const jeton = interaction?.token;
    if (!jeton || !interaction.guildId) return;
    _interactions.set(jeton, { guildId: interaction.guildId, expire: Date.now() + DUREE_JETON });
    if (_interactions.size > 500) {
      const maintenant = Date.now();
      for (const [k, v] of _interactions) if (v.expire < maintenant) _interactions.delete(k);
    }
  } catch {}
}

// Retrouve le serveur concerné à partir de la route appelée.
function guildeDe(client, route) {
  try {
    const r = String(route || '');
    const salonId = /^\/channels\/(\d+)/.exec(r);
    if (salonId) return client.channels.cache.get(salonId[1])?.guild || null;
    // Réponse à une interaction : on passe par le jeton mémorisé.
    const jeton = /^\/(?:interactions\/\d+|webhooks\/\d+)\/([\w-]{20,})/.exec(r);
    if (jeton) {
      const note = _interactions.get(jeton[1]);
      if (note && note.expire > Date.now()) return client.guilds?.cache?.get(note.guildId) || null;
    }
    return null;
  } catch {
    return null;
  }
}

// Les embeds peuvent être à deux endroits selon le type d'appel :
//   • message classique / webhook → body.embeds
//   • réponse à une interaction   → body.data.embeds
function listesDEmbeds(body) {
  const listes = [];
  if (!body || typeof body !== 'object') return listes;
  if (Array.isArray(body.embeds)) listes.push(body.embeds);
  if (body.data && Array.isArray(body.data.embeds)) listes.push(body.data.embeds);
  return listes;
}

// 🌍 Traduction, au même passage obligé que l'identité.
//
// Le bot écrit ses textes à 88 endroits ; les reprendre un par un raterait
// forcément des cas. Ici, tout ce qui part est traduit — et seuls les champs
// d'AFFICHAGE sont visités, jamais un identifiant ni une valeur.
function traduire(client, options) {
  try {
    const guild = guildeDe(client, options.fullRoute);
    if (!guild) return;
    const { traduireCorps, langueDe } = require('./traduire');
    const langue = langueDe(guild.id);
    if (langue === 'fr') return; // langue source : rien à faire
    traduireCorps(options.body, langue);
  } catch (err) {
    // Une traduction ratée ne doit jamais empêcher un message de partir.
    console.warn(`⚠️ Traduction non appliquée : ${err.message}`);
  }
}

function appliquer(client, options) {
  const listes = listesDEmbeds(options?.body);
  if (!listes.length) return;
  const guild = guildeDe(client, options.fullRoute);
  const r = reglages(guild?.id);
  if (!r.actif) return;
  const contexte = {
    reglages: r,
    bot: client.user?.username || null,
    serveur: guild?.name || null,
    icone: guild?.iconURL?.({ size: 64 }) || null,
  };
  for (const liste of listes) {
    for (const embed of liste) styliserUn(embed, contexte);
  }
}

// ── Conversion en cartes ─────────────────────────────────────────
// Seuls les ENVOIS sont convertis, jamais les modifications : Discord fige la
// famille de composants d'un message à sa création. Un message parti en embed
// ne peut pas devenir une carte par simple édition — c'est /esthetique, avec
// son mode « recréer », qui s'en charge.
const ROUTES_ENVOI = [
  /^\/channels\/\d+\/messages$/,
  /^\/interactions\/\d+\/[\w-]+\/callback$/,
  /^\/webhooks\/\d+\/[\w-]+(\?|$)/,
];

function routeDEnvoi(route, methode) {
  if (String(methode || 'POST').toUpperCase() !== 'POST') return false;
  const r = String(route || '').split('?')[0];
  return ROUTES_ENVOI.some((re) => re.test(r) || re.test(`${r}?`));
}

// Si l'API refuse les cartes (hébergeur sur une vieille version, composants
// désactivés pour l'application…), on cesse d'insister au bout de trois
// refus : mieux vaut l'ancien style que deux requêtes pour chaque message.
let _refusCartes = 0;
const REFUS_MAX = 3;

// Prépare la conversion. Renvoie le corps d'ORIGINE si une conversion a eu
// lieu (pour pouvoir y revenir), sinon null.
function preparerCartes(client, options) {
  if (_refusCartes >= REFUS_MAX) return null;
  if (!routeDEnvoi(options?.fullRoute, options?.method)) return null;
  const body = options?.body;
  if (!body || typeof body !== 'object') return null;

  const guild = guildeDe(client, options.fullRoute);
  const r = reglages(guild?.id);
  if (!r.actif || !r.cartes) return null;

  // Réponse à une interaction : le message est dans `data`. Un modal ou une
  // autocomplétion n'a pas d'embeds — la garde suffit à les écarter.
  const estInteraction = Array.isArray(body?.data?.embeds);
  const cible = estInteraction ? body.data : body;

  // 📎 Fichiers joints : une carte ne peut porter QUE des fichiers qu'un de
  // ses composants désigne (`attachment://nom`). Un fichier libre — le
  // transcript d'un ticket, par exemple — fait refuser TOUT le message par
  // Discord avec un 400.
  //
  // Le repli rejouait bien la requête, mais deux envois pour chaque message à
  // pièce jointe, et trois refus suffisent à couper les cartes partout. On
  // renonce donc AVANT d'essayer : une image citée par l'embed reste
  // convertie, un fichier libre garde l'ancien style.
  if (!tousLesFichiersSontCites(options, cible)) return null;
  const converti = convertirCorps(cible, { bordure: r.bordure, titre: r.titre, serveur: guild?.name || null });
  if (!converti) return null;

  const origine = JSON.parse(JSON.stringify(body));
  if (estInteraction) body.data = converti;
  else options.body = converti;
  return origine;
}

// Chaque fichier joint est-il désigné par l'embed ? `setImage` et
// `setThumbnail` acceptent `attachment://nom` : ces fichiers-là survivent à la
// conversion, puisque la carte les cite à son tour. Les autres non.
function tousLesFichiersSontCites(options, cible) {
  const fichiers = Array.isArray(options?.files) ? options.files : [];
  if (!fichiers.length) return true;
  const cites = new Set();
  for (const e of cible.embeds || []) {
    for (const url of [e?.image?.url, e?.thumbnail?.url]) {
      const m = /^attachment:\/\/(.+)$/.exec(String(url || ''));
      if (m) cites.add(m[1]);
    }
  }
  return fichiers.every((f) => cites.has(String(f?.name || '')));
}

// Un refus dû aux cartes se voit à un code 400 : la requête n'est pas partie,
// on peut la rejouer telle qu'elle aurait été sans conversion. Tout le reste
// (réseau, 403, 429, 5xx) se propage normalement — rejouer y serait faux.
const refusDeCartes = (err) => Number(err?.status) === 400;

// 🩺 Où en est la conversion en cartes ?
//
// Ce compteur est le seul endroit où l'on saurait que Discord refuse les
// cartes : après trois refus le bot cesse d'insister et repasse en embeds
// classiques — silencieusement. Sans moyen de le lire, on chercherait
// longtemps pourquoi « la barre colorée est revenue partout ».
function etatCartes() {
  return { refus: _refusCartes, max: REFUS_MAX, abandonnees: _refusCartes >= REFUS_MAX };
}

// Branche l'identité sur la couche REST du client. Idempotent.
function installer(client) {
  const rest = client?.rest;
  if (!rest || rest.__styleInstalle) return false;
  const originale = rest.request.bind(rest);
  rest.request = async (options) => {
    let origine = null;
    // Jamais d'exception ici : elle empêcherait l'envoi du message.
    try {
      appliquer(client, options);
      // ⚠️ APRÈS l'identité, AVANT la conversion en cartes : l'identité pose
      // des textes (signature, ligne d'auteur) qui doivent être traduits eux
      // aussi, et la carte fige la mise en forme.
      traduire(client, options);
      origine = preparerCartes(client, options);
    } catch (err) {
      console.warn(`⚠️ Identité des embeds non appliquée : ${err.message}`);
    }
    if (!origine) return originale(options);

    try {
      const reponse = await originale(options);
      _refusCartes = 0;
      return reponse;
    } catch (err) {
      if (!refusDeCartes(err)) throw err;
      // On repart sur le message tel qu'il aurait été sans cartes : un
      // message dans l'ancien style vaut infiniment mieux qu'aucun message.
      _refusCartes += 1;
      if (_refusCartes === REFUS_MAX) {
        console.warn('⚠️ Cartes sans bordure refusées par Discord — retour aux embeds classiques.');
      }
      options.body = origine;
      return originale(options);
    }
  };
  rest.__styleInstalle = true;
  return true;
}

module.exports = {
  installer, appliquer, styliserUn, reglages, versEntier, guildeDe, listesDEmbeds, noterInteraction,
  couleurNeutre, COULEURS_NEUTRES, DEFAUT_ACCENT, FILET, filetDe, FILET_DEFAUT,
  preparerCartes, routeDEnvoi, refusDeCartes, etatCartes, DRAPEAU_V2, tousLesFichiersSontCites, traduire,
};
