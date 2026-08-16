const { getGuildConfig } = require('../database');

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
// Filet posé sous le titre. 28 signes = la largeur d'un embed sur téléphone.
const FILET = '─'.repeat(28);

function versEntier(couleur) {
  const v = String(couleur || '').trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(v) ? parseInt(v, 16) : null;
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
    banniere: /^https?:\/\/\S+$/i.test(String(cfg.embed_banniere || '').trim())
      ? String(cfg.embed_banniere).trim()
      : null,
  };
}

// Applique l'identité à UN embed déjà sérialisé (objet JSON Discord).
function styliserUn(embed, contexte) {
  if (!embed || typeof embed !== 'object') return embed;
  const r = contexte.reglages;

  // Couleur : soit on impose l'accent partout, soit on ne comble que le vide.
  if (r.couleurUnique) embed.color = r.accent;
  else if (embed.color === undefined || embed.color === null) embed.color = r.accent;

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

  // ── Filet sous le titre ──────────────────────────────────────────
  // C'est LUI qui fait la différence entre un embed brut de Discord et une
  // carte soignée : une ligne fine qui sépare le titre du corps.
  // Discord n'a pas de « trait horizontal » : on le dessine avec des
  // caractères de filet. 28 signes correspondent à la largeur d'un embed sur
  // téléphone — au-delà, la ligne passerait à la ligne et ferait un pâté.
  if (r.ligne && embed.title && typeof embed.description === 'string' && embed.description) {
    if (!embed.description.startsWith(FILET)) {
      const candidat = `${FILET}\n${embed.description}`;
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

// Branche l'identité sur la couche REST du client. Idempotent.
function installer(client) {
  const rest = client?.rest;
  if (!rest || rest.__styleInstalle) return false;
  const originale = rest.request.bind(rest);
  rest.request = async (options) => {
    // Jamais d'exception ici : elle empêcherait l'envoi du message.
    try {
      appliquer(client, options);
    } catch (err) {
      console.warn(`⚠️ Identité des embeds non appliquée : ${err.message}`);
    }
    return originale(options);
  };
  rest.__styleInstalle = true;
  return true;
}

module.exports = { installer, appliquer, styliserUn, reglages, versEntier, guildeDe, listesDEmbeds, noterInteraction, DEFAUT_ACCENT, FILET };
