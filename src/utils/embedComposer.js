const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const balises = require('./balises');
const C = require('./cartes');
const { styliserUn } = require('./identite');
const { reglages } = require('./styleEmbeds');
const { mettreAJour } = require('./reponse');
const roles = require('./rolesAuClic');
const { db } = require('../database');

// ✍️ Éditeur de message avec APERÇU EN DIRECT.
//
// La promesse tient en une phrase : ce qui est affiché ici est ce qui partira.
// Elle a été fausse longtemps, et pour une raison qu'on ne voit pas en lisant
// le code de l'éditeur.
//
// Un message en carte (« Components V2 ») ne peut porter que 4000 signes de
// texte et 40 composants, TOUT COMPRIS. Or l'éditeur ajoute à l'aperçu ce qui
// n'ira jamais dans le message : une ligne d'explication, un sélecteur de
// salon, des boutons. Environ 190 signes et une douzaine de composants de
// décor. Un règlement de 3 850 signes tenait donc en carte une fois envoyé…
// mais dépassait dans l'éditeur. La conversion était refusée, l'aperçu
// retombait sur l'ancien embed — barre colorée comprise — et l'aperçu mentait
// précisément sur le point qu'il devait montrer.
//
// D'où la règle appliquée ici : **le décor de l'éditeur cède la place au
// contenu**. On mesure d'abord le message réel ; ce qui reste de budget
// décide de la richesse du décor. À l'étroit, l'explication se raccourcit
// puis disparaît, et le sélecteur de rôles ne s'affiche que s'il sert.
//
// Et quand le contenu lui-même dépasse ce qu'une carte peut porter, on ne le
// cache pas : l'éditeur le dit, chiffres à l'appui, et propose de couper le
// texte en plusieurs cartes plutôt que de retomber en silence sur l'ancien
// style.

const drafts = new Map(); // id -> state
let counter = 0;

// L'aperçu vit dans une réponse éphémère : son jeton meurt au bout de 15
// minutes. Garder les brouillons au-delà ne servirait qu'à faire grossir la
// mémoire du bot.
const DUREE_BROUILLON = 20 * 60 * 1000;

const memoriser = db.prepare(
  `INSERT INTO composed_messages (guild_id, channel_id, message_id, author_id, state, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT (channel_id, message_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
);
const sourceDe = db.prepare('SELECT * FROM composed_messages WHERE channel_id = ? AND message_id = ?');

function parseColor(v) {
  const m = String(v || '').trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? parseInt(m[1], 16) : null;
}
// Tout texte écrit par un membre passe par les balises : « && » devient une
// barre, « &> » une entrée de liste. Un texte sans balise ressort identique.
const nl = (s) => (s ? balises.appliquer(s) : s);

function etatNeuf(initial = {}) {
  return {
    text: initial.text || '',
    title: initial.title || '',
    description: initial.description || '',
    color: initial.color ?? null,
    image: initial.image || '',
    thumbnail: initial.thumbnail || '',
    footer: initial.footer || '',
    author: initial.author || '',
    targetChannelId: initial.channelId || null,
    roles: Array.isArray(initial.roles) ? initial.roles : [],
    roleMode: initial.roleMode === 'reaction' ? 'reaction' : 'bouton',
    // Renseigné par /embed modifier : on réécrit un message au lieu d'en
    // publier un nouveau.
    cible: initial.cible || null,
    ne: Date.now(),
  };
}

// Construit le payload réel (contenu + embed) à partir de l'état.
function render(state) {
  const hasEmbed = state.title || state.description || state.image || state.thumbnail || state.footer || state.author;
  const payload = { content: nl(state.text) || '', embeds: [] };
  if (hasEmbed) {
    const embed = new EmbedBuilder().setColor(state.color ?? 0x5865f2);
    if (state.author) embed.setAuthor({ name: String(state.author).slice(0, 256) });
    if (state.title) embed.setTitle(nl(state.title).slice(0, 256));
    if (state.description) embed.setDescription(nl(state.description).slice(0, 4096));
    if (state.image) embed.setImage(state.image);
    if (state.thumbnail) embed.setThumbnail(state.thumbnail);
    if (state.footer) embed.setFooter({ text: nl(state.footer).slice(0, 2048) });
    payload.embeds.push(embed);
  }
  return payload;
}

function isEmpty(state) {
  return !(state.text || state.title || state.description || state.image || state.thumbnail || state.footer || state.author);
}

// ── Mesure : ce que pèsera le message une fois parti ─────────────
//
// On mesure sur l'embed HABILLÉ, pas sur celui que l'éditeur construit :
// l'identité ajoute une ligne d'auteur, un filet, une signature et un
// horodatage. Mesurer avant cet habillage sous-estimerait de 100 à 150
// signes — assez pour promettre une carte et livrer un embed.
function contexteDe(interaction) {
  const guild = interaction.guild || null;
  const r = reglages(guild?.id);
  return {
    r,
    contexte: {
      reglages: r,
      bot: interaction.client?.user?.username || null,
      serveur: guild?.name || null,
      icone: guild?.iconURL?.({ size: 64 }) || null,
    },
  };
}

const enJSON = (x) => (x && typeof x.toJSON === 'function' ? x.toJSON() : x);

function mesurer(interaction, payload) {
  const { r, contexte } = contexteDe(interaction);
  if (!r.actif || !r.cartes) return { cartes: false, texte: 0, composants: 0, max: C.MAX_TEXTE_TOTAL, tient: true };

  const habilles = (payload.embeds || []).map((e) => {
    const brut = JSON.parse(JSON.stringify(enJSON(e)));
    return r.actif ? styliserUn(brut, contexte) : brut;
  });
  const morceaux = [];
  if (String(payload.content || '').trim()) morceaux.push({ type: C.T.TEXTE, content: String(payload.content) });
  for (const e of habilles) {
    const carte = C.enCarte(e, { bordure: r.bordure, titre: r.titre, serveur: contexte.serveur });
    if (!carte) return { cartes: true, texte: Infinity, composants: Infinity, max: C.MAX_TEXTE_TOTAL, tient: false };
    morceaux.push(carte);
  }
  const rangees = (payload.components || []).map(enJSON);
  const tous = [...morceaux, ...rangees];
  const texte = C.longueurTexte(tous);
  const composants = C.compter(tous);
  return {
    cartes: true,
    texte,
    composants,
    max: C.MAX_TEXTE_TOTAL,
    tient: texte <= C.MAX_TEXTE_TOTAL && composants <= C.MAX_COMPOSANTS,
  };
}

// ── Découpe d'un texte trop long ─────────────────────────────────
//
// Une carte ne porte pas plus de 4000 signes. Au-delà, le seul moyen de
// GARDER le style est d'envoyer plusieurs cartes. On coupe donc entre deux
// blocs — jamais au milieu d'une phrase, jamais au milieu d'une entrée de
// liste : la règle 3.4 coupée en deux ne serait plus une règle.
function decouper(texte, budget) {
  const lignes = String(texte || '').split('\n');
  const parts = [];
  let courant = [];
  let taille = 0;
  const vider = () => {
    if (courant.length) parts.push(courant.join('\n').trim());
    courant = [];
    taille = 0;
  };
  for (const ligne of lignes) {
    const cout = ligne.length + 1;
    if (taille + cout > budget && courant.length) vider();
    courant.push(ligne);
    taille += cout;
  }
  vider();
  return parts.filter(Boolean);
}

// Le budget d'un morceau : le maximum d'une carte, moins ce que l'identité
// et la tête de carte ajouteront par-dessus.
function budgetParCarte(state) {
  const decor = 320 + String(state.title || '').length + String(state.footer || '').length;
  return Math.max(600, C.MAX_TEXTE_TOTAL - decor);
}

// Les messages qui partiront réellement. Un seul dans l'immense majorité des
// cas ; plusieurs quand le texte dépasse ce qu'une carte peut porter.
function messagesAEnvoyer(interaction, state) {
  const un = render(state);
  const rangee = roles.rangeeBoutons(state.roleMode === 'bouton' ? state.roles : []);
  if (rangee) un.components = [rangee];

  const mesure = mesurer(interaction, un);
  if (mesure.tient || !mesure.cartes || !state.description) return { messages: [un], mesure, coupe: false };

  const morceaux = decouper(nl(state.description), budgetParCarte(state));
  if (morceaux.length < 2) return { messages: [un], mesure, coupe: false };

  // Le titre, l'image et les boutons n'appartiennent qu'à une seule carte :
  // les répéter donnerait trois fois le même en-tête.
  const messages = morceaux.map((part, i) => {
    const bout = etatNeuf({
      ...state,
      // `description` est déjà passée par les balises : ne pas la repasser,
      // sinon une barre déjà tracée serait relue comme du texte.
      description: '',
      title: i === 0 ? state.title : '',
      text: i === 0 ? state.text : '',
      image: i === morceaux.length - 1 ? state.image : '',
      thumbnail: i === 0 ? state.thumbnail : '',
      footer: i === morceaux.length - 1 ? state.footer : '',
      author: i === 0 ? state.author : '',
    });
    const p = render(bout);
    const embed = p.embeds[0] || new EmbedBuilder().setColor(state.color ?? 0x5865f2);
    embed.setDescription(part.slice(0, 4096));
    p.embeds = [embed];
    if (i === morceaux.length - 1 && rangee) p.components = [rangee];
    return p;
  });
  return { messages, mesure, coupe: true };
}

// ── Décor de l'éditeur ───────────────────────────────────────────

const LEGENDE = '`&&` une barre · `&& Titre` une section · `&>` une entrée · `\\n` un saut de ligne';

function controls(id, state, { rolesVisibles = true } = {}) {
  const modeLabel = state.roleMode === 'reaction' ? '🎭 Rôles : réaction' : '🖱️ Rôles : bouton';
  const envoi = state.cible ? '💾 Enregistrer' : '📤 Envoyer';
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`emb:txt:${id}`).setLabel('Texte & titre').setEmoji('✏️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`emb:sty:${id}`).setLabel('Couleur & images').setEmoji('🎨').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`emb:mod:${id}`).setLabel(modeLabel).setStyle(ButtonStyle.Secondary),
      ...(state.roles.length
        ? [new ButtonBuilder().setCustomId(`emb:lib:${id}`).setLabel('Libellés').setEmoji('🏷️').setStyle(ButtonStyle.Secondary)]
        : [])
    ),
  ];
  // Un message qu'on réécrit garde son salon : le proposer laisserait croire
  // qu'on peut le déplacer, ce que Discord ne permet pas.
  if (!state.cible) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`emb:ch:${id}`)
          .setPlaceholder(`📍 Salon d'envoi (${state.targetChannelId ? 'choisi' : 'à choisir'})`)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setMinValues(1)
          .setMaxValues(1)
      )
    );
  }
  if (rolesVisibles) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`emb:rol:${id}`)
          .setPlaceholder(`🎭 Rôles à donner (${state.roles.length || 'aucun'})`)
          .setMinValues(0)
          .setMaxValues(roles.MAX_ROLES)
      )
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`emb:snd:${id}`).setLabel(envoi).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`emb:cxl:${id}`).setLabel('Annuler').setEmoji('❌').setStyle(ButtonStyle.Danger)
    )
  );
  return rows;
}

// L'en-tête de l'aperçu, en trois tailles. Le contenu passe avant le décor :
// si l'explication ne tient pas, c'est elle qui part, pas la carte.
function entetes(state, { messages, mesure, coupe }) {
  const ou = state.cible
    ? `réécrit <${state.cible.lien}>`
    : state.targetChannelId ? `part dans <#${state.targetChannelId}>` : 'salon non choisi';
  const compteur = mesure.cartes && Number.isFinite(mesure.texte) ? ` · ${mesure.texte}/${mesure.max} signes` : '';
  const suite = coupe ? ` · ✂️ ${messages.length} cartes` : '';
  return [
    `🔎 **Aperçu en direct** — ${ou}${compteur}${suite}\n-# 🏷️ En début de ligne : ${LEGENDE}`,
    `-# 🔎 Aperçu — ${ou}${compteur}${suite}`,
    '',
  ];
}

// 🔬 Le cœur de la fidélité : on ESSAIE le décor, du plus riche au plus
// dépouillé, et on garde le premier qui laisse encore la carte passer.
function editorPayload(interaction, id, state) {
  const plan = messagesAEnvoyer(interaction, state);
  const apercu = plan.messages[0];
  const notes = [];
  if (plan.coupe) {
    notes.push(
      `-# ✂️ Trop long pour une seule carte : le texte partira en **${plan.messages.length} cartes** à la suite. `
      + 'Ci-dessous, la première.'
    );
  } else if (!plan.mesure.tient && plan.mesure.cartes) {
    notes.push(
      '-# ⚠️ Ce message dépasse ce qu\'une carte peut porter : il partira dans l\'ancien style, '
      + 'avec la barre colorée à gauche. Raccourcissez le texte pour retrouver la carte.'
    );
  }

  const base = {
    embeds: apercu.embeds,
    flags: MessageFlags.Ephemeral,
  };
  // Du plus riche au plus dépouillé : en-tête complet + sélecteur de rôles,
  // en-tête court, puis rien du tout.
  const essais = entetes(state, plan).flatMap((tete, i) => {
    const contenu = [tete, ...notes].filter(Boolean).join('\n');
    const variantes = i === 0 ? [true, false] : [state.roles.length > 0];
    return variantes.map((rolesVisibles) => ({
      ...base,
      content: contenu.slice(0, 2000),
      components: controls(id, state, { rolesVisibles }),
    }));
  });

  for (const essai of essais) {
    if (!plan.mesure.cartes) return essai; // cartes désactivées : rien à ménager
    if (mesurer(interaction, essai).tient) return essai;
  }
  // Même nu, ça ne tient pas : le message lui-même est hors limites. On
  // affiche quand même — l'ancien style vaut mieux que pas d'aperçu.
  return essais[essais.length - 1];
}

// ── Entrées ──────────────────────────────────────────────────────

function nettoyerBrouillons() {
  const limite = Date.now() - DUREE_BROUILLON;
  for (const [k, v] of drafts) if ((v.ne || 0) < limite) drafts.delete(k);
}

function ouvrir(interaction, initial = {}) {
  nettoyerBrouillons();
  const id = `${Date.now().toString(36)}${counter++}`;
  drafts.set(id, etatNeuf(initial));
  return { id, state: drafts.get(id) };
}

// Démarre l'éditeur (réponse éphémère). initial = champs pré-remplis éventuels.
async function start(interaction, initial = {}) {
  const { id, state } = ouvrir(interaction, initial);
  return interaction.reply(editorPayload(interaction, id, state));
}

// ── Relire un message déjà publié ────────────────────────────────
//
// On repart du TEXTE SOURCE quand on l'a : celui qui a été tapé, avec ses
// « && » intacts. Le rendu, lui, ne se remonte pas — « ➜ » peut avoir été
// écrit à la main, et le filet d'une carte n'existe plus comme texte. Sans
// la source, chaque passage dans l'éditeur abîmerait un peu le message.
function depuisCarte(message) {
  const conteneur = (message.components || [])
    .map((c) => (typeof c.toJSON === 'function' ? c.toJSON() : c))
    .find((c) => c.type === C.T.CONTENEUR);
  if (!conteneur) return null;

  const textes = [];
  let image = '';
  let vignette = '';
  const parcourir = (liste) => {
    for (const c of liste || []) {
      if (c.type === C.T.TEXTE) textes.push(String(c.content || ''));
      if (c.type === C.T.SEPARATEUR) textes.push(balises.BARRE);
      if (c.type === C.T.GALERIE && c.items?.[0]?.media?.url) image = c.items[0].media.url;
      if (c.accessory?.type === C.T.VIGNETTE && c.accessory.media?.url) vignette = c.accessory.media.url;
      if (Array.isArray(c.components)) parcourir(c.components);
    }
  };
  parcourir(conteneur.components);

  // La tête (`# Titre`) et la signature (`-# …`) sont posées par l'identité :
  // les remettre dans la description les ferait apparaître deux fois.
  let title = '';
  const corps = [];
  for (const bloc of textes) {
    const lignes = String(bloc).split('\n').filter((l) => {
      if (!title && /^#{1,2}\s+/.test(l)) { title = l.replace(/^#{1,2}\s+/, '').trim(); return false; }
      return !/^-#\s/.test(l);
    });
    const reste = lignes.join('\n').trim();
    if (reste) corps.push(reste);
  }
  return {
    title,
    description: corps.join('\n').trim(),
    image,
    thumbnail: vignette,
    color: typeof conteneur.accent_color === 'number' ? conteneur.accent_color : null,
  };
}

function depuisEmbed(message) {
  const e = message.embeds?.[0];
  if (!e) return null;
  const champs = (e.fields || []).map((f) => `${balises.PUCE} **${f.name}**\n${f.value}`);
  return {
    title: e.title || '',
    description: [e.description || '', ...champs].filter(Boolean).join('\n'),
    color: typeof e.color === 'number' ? e.color : null,
    image: e.image?.url || '',
    thumbnail: e.thumbnail?.url || '',
    footer: e.footer?.text || '',
    author: e.author?.name || '',
  };
}

// Ouvre l'éditeur sur un message existant du bot.
// Renvoie une phrase d'explication si c'est impossible — jamais un échec muet.
async function startEdit(interaction, message) {
  if (!message) return { erreur: '❌ Message introuvable. Vérifiez le lien, et que je vois bien ce salon.' };
  if (message.author?.id !== interaction.client.user.id) {
    return { erreur: '❌ Je ne peux réécrire que **mes propres** messages. Celui-ci est d\'un autre auteur.' };
  }

  const memoire = sourceDe.get(String(message.channelId), String(message.id));
  let initial = null;
  if (memoire) {
    try { initial = JSON.parse(memoire.state); } catch { initial = null; }
  }
  if (!initial) {
    initial = depuisCarte(message) || depuisEmbed(message);
    if (!initial) {
      if (message.content) initial = { text: message.content };
      else return { erreur: '❌ Ce message n\'a ni embed ni carte : il n\'y a rien à rouvrir dans l\'éditeur.' };
    }
    initial.repris = true;
  }

  const anciens = roles.rolesDe(message.id);
  const { id, state } = ouvrir(interaction, {
    ...initial,
    channelId: message.channelId,
    roles: anciens.length
      ? anciens.map((r) => ({ roleId: r.role_id, emoji: r.emoji, label: r.label }))
      : initial.roles,
    roleMode: anciens[0]?.mode || initial.roleMode,
    cible: { channelId: message.channelId, messageId: message.id, lien: message.url },
  });
  await interaction.reply(editorPayload(interaction, id, state));
  return { ok: true, repris: Boolean(initial.repris) };
}

// ── Envoi / enregistrement ───────────────────────────────────────

function memoriserSource(guildId, channelId, messageId, authorId, state) {
  try {
    const maintenant = new Date().toISOString();
    const { ne, cible, ...source } = state;
    memoriser.run(String(guildId), String(channelId), String(messageId), String(authorId || ''),
      JSON.stringify(source), maintenant, maintenant);
  } catch {
    // La mémoire de la source est un confort : /embed modifier saura repartir
    // du rendu. Elle ne doit jamais empêcher un envoi.
  }
}

async function publier(interaction, state) {
  const salon = await interaction.client.channels.fetch(state.targetChannelId).catch(() => null);
  if (!salon?.isTextBased()) return { erreur: '❌ Salon introuvable, ou je n\'y ai pas accès.' };

  const plan = messagesAEnvoyer(interaction, state);
  let premier = null;
  let dernier = null;
  for (const p of plan.messages) {
    const envoye = await salon
      .send({ content: p.content || undefined, embeds: p.embeds, components: p.components || [] })
      .catch(() => null);
    if (!envoye) {
      return {
        erreur: premier
          ? `⚠️ Envoi interrompu après ${plan.messages.indexOf(p)} carte(s) : Discord a refusé la suite.`
          : '❌ Envoi refusé. Vérifiez que je peux écrire et joindre des liens dans ce salon.',
      };
    }
    premier = premier || envoye;
    dernier = envoye;
  }

  // Les rôles vivent sur la DERNIÈRE carte : c'est celle qui porte les
  // boutons, donc celle qu'on regarde en arrivant au bas du panneau.
  await appliquerRoles(interaction, dernier, state);
  memoriserSource(interaction.guildId, salon.id, premier.id, interaction.user.id, state);
  return { ok: true, message: premier, cartes: plan.messages.length, lien: premier.url };
}

async function appliquerRoles(interaction, message, state) {
  if (!message) return;
  roles.oublier(message.id);
  if (!state.roles.length) return;
  roles.enregistrer({
    guildId: interaction.guildId,
    channelId: message.channelId,
    messageId: message.id,
    roles: state.roles,
    mode: state.roleMode,
  });
  if (state.roleMode === 'reaction') await roles.poserReactions(message, state.roles);
}

// Réécrire un message déjà publié.
//
// ⚠️ Discord fige la famille de composants d'un message à sa création : une
// carte se modifie en carte, un embed reste un embed. On ne peut donc pas
// « passer » un vieux message en carte ici — c'est le rôle de /esthetique.
async function enregistrer(interaction, state) {
  const { channelId, messageId } = state.cible;
  const salon = await interaction.client.channels.fetch(channelId).catch(() => null);
  const message = salon?.isTextBased() ? await salon.messages.fetch(messageId).catch(() => null) : null;
  if (!message) return { erreur: '❌ Le message a disparu, ou je n\'ai plus accès à son salon.' };

  const p = render(state);
  const rangee = roles.rangeeBoutons(state.roleMode === 'bouton' ? state.roles : []);
  const composants = rangee ? [rangee] : [];

  let fait;
  if (Number(message.flags?.bitfield ?? 0) & C.DRAPEAU_V2) {
    // Message déjà en carte : on reconstruit ses composants, sinon Discord
    // refuse (une carte n'accepte ni `content` ni `embeds`).
    const { r, contexte } = contexteDe(interaction);
    const cartes = [];
    if (String(p.content || '').trim()) cartes.push({ type: C.T.TEXTE, content: String(p.content) });
    for (const e of p.embeds) {
      const habille = styliserUn(JSON.parse(JSON.stringify(enJSON(e))), contexte);
      const carte = C.enCarte(habille, { bordure: r.bordure, titre: r.titre, serveur: contexte.serveur });
      if (!carte) return { erreur: '❌ Le nouveau texte ne tient pas dans une carte. Raccourcissez-le.' };
      cartes.push(carte);
    }
    fait = await message
      .edit({ components: [...cartes, ...composants.map(enJSON)], flags: C.DRAPEAU_V2 })
      .then(() => true).catch(() => false);
  } else {
    fait = await message
      .edit({ content: p.content || null, embeds: p.embeds, components: composants })
      .then(() => true).catch(() => false);
  }
  if (!fait) return { erreur: '❌ Discord a refusé la modification. Le message est peut-être trop long.' };

  await appliquerRoles(interaction, message, state);
  memoriserSource(interaction.guildId, channelId, messageId, interaction.user.id, state);
  return { ok: true, message, lien: message.url };
}

// ── Interactions ─────────────────────────────────────────────────

async function handle(interaction) {
  const parts = interaction.customId.split(':');
  const kind = parts[0]; // emb | embm
  const action = parts[1];
  const id = parts[2];
  const state = drafts.get(id);
  if (!state) {
    return interaction
      .reply({ content: '⏳ Cet éditeur a expiré. Relancez la commande.', flags: MessageFlags.Ephemeral })
      .catch(() => null);
  }
  const rafraichir = () => mettreAJour(interaction, editorPayload(interaction, id, state));

  // Ouverture des modaux
  if (kind === 'emb' && action === 'txt') {
    const modal = new ModalBuilder().setCustomId(`embm:txt:${id}`).setTitle('Texte & titre');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('Message au-dessus (facultatif)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1800).setValue(state.text || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Titre de l\'embed (facultatif)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setValue(state.title || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description (\\n = saut de ligne)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000).setValue(state.description || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('footer').setLabel('Pied de page (facultatif)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2048).setValue(state.footer || ''))
    );
    return interaction.showModal(modal);
  }
  if (kind === 'emb' && action === 'sty') {
    const modal = new ModalBuilder().setCustomId(`embm:sty:${id}`).setTitle('Couleur & images');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel('Couleur hex (ex : #5865F2)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7).setValue(state.color != null ? `#${state.color.toString(16).padStart(6, '0')}` : '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('URL grande image (facultatif)').setStyle(TextInputStyle.Short).setRequired(false).setValue(state.image || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('thumbnail').setLabel('URL miniature (facultatif)').setStyle(TextInputStyle.Short).setRequired(false).setValue(state.thumbnail || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('author').setLabel('Auteur en haut (facultatif)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256).setValue(state.author || ''))
    );
    return interaction.showModal(modal);
  }
  // Libellé et émoji de chaque rôle — un champ par rôle, cinq au plus, ce
  // qui est exactement ce qu'un modal accepte.
  if (kind === 'emb' && action === 'lib') {
    if (!state.roles.length) {
      return interaction
        .reply({ content: '🎭 Choisissez d\'abord un ou plusieurs rôles dans la liste déroulante.', flags: MessageFlags.Ephemeral })
        .catch(() => null);
    }
    const modal = new ModalBuilder().setCustomId(`embm:lib:${id}`).setTitle('Libellés des rôles');
    state.roles.slice(0, 5).forEach((r, i) => {
      const nom = interaction.guild?.roles?.cache?.get(r.roleId)?.name || `Rôle ${i + 1}`;
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(`r${i}`)
            .setLabel(`@${nom}`.slice(0, 45))
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('émoji | libellé — ex : 🎮 | Joueur')
            .setMaxLength(90)
            .setValue([r.emoji, r.label].filter(Boolean).join(' | '))
        )
      );
    });
    return interaction.showModal(modal);
  }

  // Soumission des modaux → maj + aperçu
  if (kind === 'embm' && action === 'txt') {
    state.text = interaction.fields.getTextInputValue('text');
    state.title = interaction.fields.getTextInputValue('title');
    state.description = interaction.fields.getTextInputValue('description');
    state.footer = interaction.fields.getTextInputValue('footer');
    return rafraichir();
  }
  if (kind === 'embm' && action === 'sty') {
    state.color = parseColor(interaction.fields.getTextInputValue('color'));
    state.image = interaction.fields.getTextInputValue('image').trim();
    state.thumbnail = interaction.fields.getTextInputValue('thumbnail').trim();
    state.author = interaction.fields.getTextInputValue('author');
    return rafraichir();
  }
  if (kind === 'embm' && action === 'lib') {
    state.roles = state.roles.map((r, i) => {
      const brut = interaction.fields.getTextInputValue(`r${i}`) || '';
      const [a, b] = brut.split('|').map((s) => s.trim());
      // Un seul morceau : émoji tout seul si c'en est un, libellé sinon.
      if (b === undefined) {
        const seul = a || '';
        const estEmoji = seul && (/^<a?:[\w~]+:\d+>$/.test(seul) || [...seul].length <= 3) && !/[a-zA-Z]{2}/.test(seul);
        return { ...r, emoji: estEmoji ? seul : r.emoji, label: estEmoji ? r.label : seul };
      }
      return { ...r, emoji: a || null, label: b || r.label };
    });
    return rafraichir();
  }

  // Choix du salon
  if (kind === 'emb' && action === 'ch') {
    state.targetChannelId = interaction.values[0];
    return rafraichir();
  }

  // Choix des rôles : on garde les libellés déjà saisis pour ceux qui restent.
  if (kind === 'emb' && action === 'rol') {
    const avant = new Map(state.roles.map((r) => [r.roleId, r]));
    state.roles = interaction.values.map((roleId) => {
      const vieux = avant.get(roleId);
      const nom = interaction.guild?.roles?.cache?.get(roleId)?.name;
      return vieux || { roleId, emoji: null, label: nom ? nom.slice(0, 80) : 'Rôle' };
    });
    return rafraichir();
  }

  if (kind === 'emb' && action === 'mod') {
    state.roleMode = state.roleMode === 'bouton' ? 'reaction' : 'bouton';
    return rafraichir();
  }

  if (kind === 'emb' && action === 'cxl') {
    drafts.delete(id);
    return mettreAJour(interaction, { content: '❌ Annulé.', embeds: [], components: [] });
  }

  if (kind === 'emb' && action === 'snd') {
    if (isEmpty(state)) {
      return interaction.reply({ content: '❌ Le message est vide.', flags: MessageFlags.Ephemeral }).catch(() => null);
    }
    if (!state.cible && !state.targetChannelId) {
      return interaction.reply({ content: '❌ Choisissez un salon d\'envoi.', flags: MessageFlags.Ephemeral }).catch(() => null);
    }
    if (state.roleMode === 'reaction' && state.roles.some((r) => !r.emoji)) {
      return interaction
        .reply({
          content: '🎭 En mode **réaction**, chaque rôle a besoin d\'un émoji : c\'est lui qu\'on clique. '
            + 'Ouvrez « 🏷️ Libellés » pour les renseigner, ou repassez en mode bouton.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => null);
    }

    const r = state.cible ? await enregistrer(interaction, state) : await publier(interaction, state);
    if (r.erreur) return interaction.reply({ content: r.erreur, flags: MessageFlags.Ephemeral }).catch(() => null);

    drafts.delete(id);
    const quoi = state.cible ? 'Message mis à jour' : 'Message envoyé';
    const combien = r.cartes > 1 ? ` en **${r.cartes} cartes**` : '';
    const roleTexte = state.roles.length
      ? `\n🎭 ${state.roles.length} rôle(s) ${state.roleMode === 'reaction' ? 'à la réaction' : 'au clic'}.`
      : '';
    return mettreAJour(interaction, {
      content: `✅ ${quoi}${combien} — ${r.lien}${roleTexte}`,
      embeds: [],
      components: [],
    });
  }
  return null;
}

module.exports = {
  start, startEdit, handle, render, mesurer, decouper, depuisCarte, depuisEmbed,
  messagesAEnvoyer, editorPayload, sourceDe,
};
