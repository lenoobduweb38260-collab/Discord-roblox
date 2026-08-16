const { getGuildConfig } = require('../database');
const { convertirCorps, DRAPEAU_V2 } = require('./cartes');

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

const DEFAUT_ACCENT = '#5865F2';
// Filet posé sous le titre.
// ⚠️ Leçon apprise : à 28 signes, la ligne DÉBORDE et repasse à la ligne sur
// téléphone — deux traits l'un sous l'autre, l'effet inverse de celui voulu.
// Discord n'offre pas de vrai trait horizontal : la largeur dépend de la
// taille de police du lecteur, donc on reste volontairement court. Mieux vaut
// un filet un peu plus étroit que l'embed qu'un filet cassé en deux.
const FILET_DEFAUT = 16;
const filetDe = (n) => '─'.repeat(Math.max(6, Math.min(30, Number(n) || FILET_DEFAUT)));
const FILET = filetDe(FILET_DEFAUT);

function versEntier(couleur) {
  const v = String(couleur || '').trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(v) ? parseInt(v, 16) : null;
}

// 🎨 Couleurs qui ne veulent rien dire.
//
// C'est LE point qui faisait que « tout le monde utilise encore les vieilles
// embeds ». La direction artistique dit de ne jamais écraser une couleur
// porteuse de sens — rouge = sanction, vert = réussite. Mais la moitié des
// embeds du bot ne portaient pas une couleur *choisie* : ils portaient une
// couleur *par défaut*, le bleu de Discord, posé faute de mieux. L'identité
// voyait une couleur et n'y touchait pas, si bien que l'accent du serveur
// n'apparaissait jamais — la patch note en était l'exemple le plus visible.
//
// Ces valeurs-là ne sont donc pas des décisions : ce sont des absences de
// décision. On les traite comme du vide, et l'accent du serveur prend la place.
//
// Rien d'autre n'entre dans cette liste : une couleur absente d'ici est
// considérée comme voulue, et reste intacte.
const COULEURS_NEUTRES = new Set([
  0x5865f2, // « blurple » de Discord — la couleur de la marque, pas la nôtre
  0x3498db, // bleu générique « info »
  0x2b2d31, // gris des cartes Discord (thème sombre)
  0x2f3136, // idem, ancienne nuance
  0x23272a, // idem, plus foncé
  0x36393f, // idem, fond de salon
  0x000000, // noir : quasi toujours un « je n'ai pas choisi »
  0xffffff, // blanc : idem
]);

function couleurNeutre(valeur) {
  if (valeur === undefined || valeur === null) return true;
  const n = typeof valeur === 'number' ? valeur : versEntier(valeur);
  if (n === null || Number.isNaN(n)) return true;
  return COULEURS_NEUTRES.has(n);
}

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
  };
}

// Applique l'identité à UN embed déjà sérialisé (objet JSON Discord).
function styliserUn(embed, contexte) {
  if (!embed || typeof embed !== 'object') return embed;
  const r = contexte.reglages;

  // Couleur : soit on impose l'accent partout, soit on comble le vide — et
  // une couleur neutre (le bleu de Discord, un gris de fond) EST du vide :
  // personne ne l'a choisie pour ce qu'elle dit.
  if (r.couleurUnique || couleurNeutre(embed.color)) embed.color = r.accent;

  // Pied de page : « NomDuBot • NomDuServeur », avec l'icône du serveur.
  // On ne touche pas à un pied de page déjà écrit : il dit souvent quelque
  // chose d'utile (« Relancé par X », « Page 2/4 »).
  if (r.piedDePage && !embed.footer?.text) {
    const morceaux = [contexte.bot, contexte.serveur].filter(Boolean);
    if (morceaux.length) {
      embed.footer = { text: morceaux.join(' • ') };
      if (contexte.icone) embed.footer.icon_url = contexte.icone;
    }
  }

  // Ligne d'auteur : l'identité du serveur, présente en haut de CHAQUE embed.
  // Comme pour le pied de page, on ne remplace jamais celle que le bot a
  // écrite lui-même — elle porte souvent le sens du message
  // (« Avis de @membre », « Bienvenue sur … »).
  if (r.ligneAuteur && !embed.author?.name && contexte.serveur) {
    embed.author = { name: contexte.serveur };
    if (contexte.icone) embed.author.icon_url = contexte.icone;
  }

  // ── Champs → sections ────────────────────────────────────────────
  // C'est CE point qui donne l'air « Discord de base » : la grille de petites
  // étiquettes grises produite par les champs d'embed. La direction
  // artistique demandée n'a pas cette grille — elle a des sections, avec un
  // en-tête ◆ et des lignes ➜.
  //
  // On refond donc les champs en sections de description, ici, pour TOUS les
  // embeds du bot d'un coup : y compris ceux qu'aucune commande ne
  // reconstruira jamais.
  //
  // Rien n'est jamais perdu : si le tout ne tient pas dans une description
  // (4096 signes), on laisse les champs tels quels.
  if (r.fusion && Array.isArray(embed.fields) && embed.fields.length) {
    const sections = embed.fields
      .filter((f) => f && (f.name || f.value))
      .map((f) => {
        const titre = String(f.name || '').trim().replace(/\s*:\s*$/, '');
        const valeur = String(f.value || '').trim();
        const lignes = [];
        if (titre) lignes.push(`◆ **${titre}**`);
        if (valeur) {
          // Une valeur déjà mise en forme (citation, liste, sections) garde
          // sa forme ; une valeur simple reçoit la flèche.
          const deja = /^\s*(>|➜|◆|\*|-|\d+\.)/.test(valeur) || valeur.includes('\n');
          lignes.push(deja ? valeur : `➜ ${valeur}`);
        }
        return lignes.join('\n');
      })
      .filter(Boolean);

    if (sections.length) {
      const base = typeof embed.description === 'string' && embed.description.trim() ? embed.description : '';
      const corps = [base, ...sections].filter(Boolean).join(`\n${r.filet}\n`);
      // Le filet éventuel s'ajoutera ensuite : on garde de la marge.
      if (corps.length + r.filet.length + 2 <= 4096) {
        embed.description = corps;
        delete embed.fields;
      }
    }
  }

  // ── Filet sous le titre ──────────────────────────────────────────
  // C'est LUI qui fait la différence entre un embed brut de Discord et une
  // carte soignée : une ligne fine qui sépare le titre du corps.
  // Discord n'a pas de « trait horizontal » : on le dessine avec des
  // caractères de filet. 28 signes correspondent à la largeur d'un embed sur
  // téléphone — au-delà, la ligne passerait à la ligne et ferait un pâté.
  if (r.ligne && embed.title && typeof embed.description === 'string' && embed.description) {
    // On reconnaît un filet déjà présent, quelle que soit sa longueur.
    if (!/^─{6,}\n/.test(embed.description)) {
      const candidat = `${r.filet}\n${embed.description}`;
      // On n'ajoute le filet que s'il reste de la place : mieux vaut pas de
      // ligne qu'une description tronquée par Discord.
      if (candidat.length <= 4096) embed.description = candidat;
    }
  }

  // ── Bannière de bas de carte ─────────────────────────────────────
  // L'image large qui termine les embeds (« SUPPORT — CARRÉ RP »). Posée
  // seulement si l'embed n'a pas déjà une image à lui.
  if (r.banniere && !embed.image?.url) {
    embed.image = { url: r.banniere };
  }

  if (r.horodatage && !embed.timestamp) embed.timestamp = new Date().toISOString();
  return embed;
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
  const converti = convertirCorps(cible, { bordure: r.bordure });
  if (!converti) return null;

  const origine = JSON.parse(JSON.stringify(body));
  if (estInteraction) body.data = converti;
  else options.body = converti;
  return origine;
}

// Un refus dû aux cartes se voit à un code 400 : la requête n'est pas partie,
// on peut la rejouer telle qu'elle aurait été sans conversion. Tout le reste
// (réseau, 403, 429, 5xx) se propage normalement — rejouer y serait faux.
const refusDeCartes = (err) => Number(err?.status) === 400;

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
  preparerCartes, routeDEnvoi, refusDeCartes, DRAPEAU_V2,
};
