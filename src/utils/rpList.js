const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { db } = require('../database');
const M = require('./miseEnPage');
const { reglages } = require('./styleEmbeds');
const { mettreAJour, estCarte, enComposants } = require('./reponse');
const { DRAPEAU_V2 } = require('./cartes');

// Listes RP partagées : Blacklist RP (kind « blrp ») et Whitelist RP (« wlrp »).
// Même structure : un embed « panneau » posté dans un salon, trié par ordre
// alphabétique du pseudo Roblox, mis à jour à chaque modification, avec un
// bouton de recherche. Le retrait garde l'entrée (active = 0) → casier.

const TABLES = { blrp: 'blacklist_rp', wlrp: 'whitelist_rp' };
const META = {
  blrp: {
    title: '🚫 Blacklist RP', color: 0xe74c3c, emoji: '🚫',
    libelle: 'Joueurs blacklistés', mot: 'joueur',
    empty: 'Aucune blacklist RP pour le moment.',
  },
  wlrp: {
    title: '✅ Whitelist RP', color: 0x2ecc71, emoji: '✅',
    libelle: 'Joueurs whitelistés', mot: 'joueur',
    empty: 'Aucune whitelist RP pour le moment.',
  },
};

function prep(kind) {
  const t = TABLES[kind];
  return {
    add: db.prepare(
      `INSERT INTO ${t} (guild_id, user_id, roblox_name, discord_tag, reason, active, by_id, at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ),
    activeOf: db.prepare(`SELECT * FROM ${t} WHERE guild_id = ? AND user_id = ? AND active = 1`),
    listActive: db.prepare(
      `SELECT * FROM ${t} WHERE guild_id = ? AND active = 1 ORDER BY (roblox_name IS NULL), roblox_name COLLATE NOCASE, discord_tag COLLATE NOCASE`
    ),
    historyOf: db.prepare(`SELECT * FROM ${t} WHERE guild_id = ? AND user_id = ? ORDER BY id DESC`),
    remove: db.prepare(
      `UPDATE ${t} SET active = 0, removed_by = ?, removed_at = ? WHERE guild_id = ? AND user_id = ? AND active = 1`
    ),
  };
}
const STMTS = { blrp: prep('blrp'), wlrp: prep('wlrp') };

const getBoard = db.prepare('SELECT * FROM rp_boards WHERE guild_id = ? AND kind = ?');
const boardParMessage = db.prepare('SELECT * FROM rp_boards WHERE guild_id = ? AND message_id = ?');
const deplacerBoard = db.prepare('UPDATE rp_boards SET channel_id = ?, message_id = ? WHERE guild_id = ? AND message_id = ?');

// 🔗 Un panneau republié ailleurs reste LE panneau.
//
// Sans cela, /esthetique mode:recréer laisserait la table pointer vers un
// message supprimé : la liste cesserait de se mettre à jour à chaque ajout ou
// retrait, sans le moindre message d'erreur.
function reenregistrerPanneau(guildId, ancienMessageId, salonId, nouveauMessageId) {
  try {
    if (!boardParMessage.get(guildId, ancienMessageId)) return false;
    deplacerBoard.run(salonId, nouveauMessageId, guildId, ancienMessageId);
    return true;
  } catch {
    return false;
  }
}
const setBoard = db.prepare(
  'INSERT INTO rp_boards (guild_id, kind, channel_id, message_id) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(guild_id, kind) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id'
);

// Une entrée de liste, dans la grammaire du projet : ➜ et jamais un numéro.
//
// 🆔 L'identifiant est INDISPENSABLE : c'est lui qu'on copie pour bannir,
// retrouver un compte parti du serveur, ou vérifier une correspondance. Une
// mention ne le montre pas, et un membre qui a quitté le serveur n'affiche
// même plus de nom. Il avait été retiré pour gagner de la largeur sur
// téléphone — c'était échanger l'utile contre le joli.
//
// Il vit donc en sous-texte, avec la raison : lisible et copiable, sans
// manger la ligne principale.
function entryLine(r) {
  const tete = `**${r.roblox_name || '?'}** · <@${r.user_id}>`;
  const tag = r.discord_tag ? ` — ${r.discord_tag}` : '';
  const details = [`🆔 \`${r.user_id}\``];
  if (r.reason) details.push(`📄 ${r.reason}`);
  return `${M.entree(tete + tag)}\n-# ${details.join(' · ')}`;
}

// ----- 📄 Pagination -----
// 39 entrées par page au maximum. Auparavant toutes les entrées étaient
// collées puis coupées à 4000 caractères : la dernière ligne affichée se
// terminait au milieu d'un mot. Ici on découpe par ENTRÉES ENTIÈRES, et on
// s'arrête avant si le budget de caractères de l'embed est atteint — une
// entrée n'est donc jamais tronquée.
const PAR_PAGE = 39;
const BUDGET = 3900; // marge sous la limite Discord de 4096 caractères

function lignesFiltrees(kind, guildId, filter) {
  let rows = STMTS[kind].listActive.all(guildId);
  const q = String(filter || '').trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      [r.roblox_name, r.user_id, r.discord_tag, r.reason].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }
  return rows;
}

// Découpe la liste en pages. Chaque page contient au plus 39 entrées, et
// tient dans le budget de caractères sans jamais couper une entrée.
function construirePages(rows) {
  const pages = [];
  let courante = [];
  let taille = 0;
  rows.forEach((r) => {
    const ligne = entryLine(r);
    const cout = ligne.length + 2; // + le saut de ligne double
    // Nouvelle page si on atteint 39 entrées, ou si celle-ci ne tient plus.
    if (courante.length >= PAR_PAGE || (courante.length && taille + cout > BUDGET)) {
      pages.push(courante);
      courante = [];
      taille = 0;
    }
    courante.push(ligne);
    taille += cout;
  });
  if (courante.length || !pages.length) pages.push(courante);
  return pages;
}

// Embed du panneau (ou des résultats de recherche si `filter` est fourni).
function renderEmbed(kind, guildId, filter, page = 0) {
  const meta = META[kind];
  const rows = lignesFiltrees(kind, guildId, filter);
  const q = String(filter || '').trim().toLowerCase();
  const pages = construirePages(rows);
  const total = pages.length;
  const num = Math.min(Math.max(0, Number(page) || 0), total - 1);
  const debut = pages.slice(0, num).reduce((n, p) => n + p.length, 0) + 1;

  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(`${meta.title}${q ? ' — recherche' : ''}`)
    .setTimestamp();

  // Les entrées portent déjà leur ➜ : on les assemble sous un en-tête ◆ qui
  // dit ce qu'on regarde et combien il y en a.
  const entete = q
    ? M.entete(`Résultats pour « ${filter.trim()} »`, { prefixe: '🔎', compte: rows.length, motCompte: 'entrée' })
    : M.entete(meta.libelle, { prefixe: meta.emoji, compte: rows.length, motCompte: meta.mot });
  const corps = pages[num].length ? pages[num].join('\n') : `*${q ? 'Aucun résultat.' : meta.empty}*`;
  embed.setDescription(M.borner([entete, corps].join('\n'), M.MAX_DESCRIPTION));

  // Pied de page unifié : compte, heure, page — toujours dans cet ordre.
  embed.setFooter({
    text: M.piedDePage({
      total: rows.length,
      motTotal: meta.mot,
      page: num + 1,
      pages: total,
      extra: total > 1 ? `entrées ${debut} à ${debut + pages[num].length - 1}` : null,
      // L'horodatage de la carte dit déjà quand la liste a été rafraîchie.
      heure: false,
    }),
  });
  return embed;
}

// Combien de pages pour cette liste ? (sert à activer/désactiver les flèches)
function nombreDePages(kind, guildId, filter) {
  return construirePages(lignesFiltrees(kind, guildId, filter)).length;
}

// Rangée de boutons : recherche + navigation entre les pages.
// Le filtre voyage dans l'identifiant du bouton (limité à 100 caractères par
// Discord) : on le raccourcit pour ne jamais dépasser.
function searchRow(kind, guildId, filter = '', page = 0) {
  const total = nombreDePages(kind, guildId, filter);
  const q = String(filter || '').slice(0, 50);
  const row = new ActionRowBuilder();
  if (total > 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`rprppage:${kind}:${page - 1}:${q}`)
        .setLabel('Page précédente')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0)
    );
  }
  row.addComponents(
    new ButtonBuilder().setCustomId(`rprpsearch:${kind}`).setLabel('Rechercher').setEmoji('🔎').setStyle(ButtonStyle.Secondary)
  );
  if (total > 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`rprppage:${kind}:${page + 1}:${q}`)
        .setLabel('Page suivante')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= total - 1)
    );
  }
  return row;
}

// Publie (ou remplace) le panneau dans un salon et mémorise sa référence.
// Un ENVOI est converti en carte par la couche réseau : le panneau naît donc
// sans barre colorée.
async function postBoard(kind, channel, guildId) {
  const msg = await channel.send({ embeds: [renderEmbed(kind, guildId)], components: [searchRow(kind, guildId)] });
  setBoard.run(guildId, kind, channel.id, msg.id);
  return msg;
}

// Met à jour le panneau après chaque ajout/retrait.
//
// ⚠️ Discord fige la famille de composants d'un message à sa création : un
// panneau publié à l'époque des embeds ne deviendra JAMAIS une carte par
// modification. C'est ce qui laissait la barre verte sur la liste Whitelist
// alors que tout le reste du bot était passé aux cartes.
//
// On modifie donc quand c'est possible — cela garde le panneau à sa place
// dans le salon — et on le republie une seule fois s'il est resté un embed
// alors que le serveur est passé aux cartes. Après cette bascule, les
// modifications suivantes reprennent normalement.
async function refreshBoard(client, kind, guildId) {
  const board = getBoard.get(guildId, kind);
  if (!board) return;
  try {
    const channel = await client.channels.fetch(board.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const msg = await channel.messages.fetch(board.message_id).catch(() => null);
    if (!msg) return;

    // Le panneau revient toujours à la première page après une modification :
    // le nombre de pages a pu changer.
    const contenu = { embeds: [renderEmbed(kind, guildId)], components: [searchRow(kind, guildId)] };

    // Panneau resté en embed alors que le serveur veut des cartes → une
    // republication, et une seule : c'est le seul chemin possible.
    const r = reglages(guildId);
    if (r.actif && r.cartes && msg.embeds?.length) {
      const neuf = await postBoard(kind, channel, guildId).catch(() => null);
      if (neuf) {
        await msg.delete().catch(() => null);
        return;
      }
    }

    // ⚠️ Panneau DÉJÀ en carte : `edit({ embeds })` y est refusé par Discord,
    // et le refus est silencieux (il est avalé par le catch du dessous). Le
    // panneau cessait donc simplement de se mettre à jour — un ajout ou un
    // retrait n'apparaissait plus, sans la moindre erreur visible.
    if (estCarte(msg)) {
      const composants = enComposants(msg.guild || channel.guild || null, client, contenu);
      if (composants?.length) {
        await msg.edit({ components: composants, flags: DRAPEAU_V2 });
        return;
      }
    }

    await msg.edit(contenu);
  } catch {
    /* le panneau a pu être supprimé : on ignore */
  }
}

function add(kind, guildId, { userId, robloxName, discordTag, reason, byId }) {
  STMTS[kind].add.run(guildId, userId, robloxName || null, discordTag || null, reason || null, byId, new Date().toISOString());
}
function remove(kind, guildId, userId, byId) {
  return STMTS[kind].remove.run(byId, new Date().toISOString(), guildId, userId).changes > 0;
}
const activeOf = (kind, guildId, userId) => STMTS[kind].activeOf.get(guildId, userId);
const historyOf = (kind, guildId, userId) => STMTS[kind].historyOf.all(guildId, userId);

// Bouton 🔎 → modal ; soumission du modal → résultats éphémères.
// Boutons ◀️ / ▶️ → on réédite le message affiché avec la page demandée.
async function handleSearchInteraction(interaction) {
  if (interaction.isButton() && interaction.customId.startsWith('rprppage:')) {
    const [, kind, pageBrute, ...reste] = interaction.customId.split(':');
    const filtre = reste.join(':');
    const page = Number(pageBrute) || 0;
    // ⚠️ Ni deferUpdate, ni editReply. Le panneau est une CARTE : ses embeds
    // n'existent plus, tout son contenu vit dans ses composants, et Discord
    // refuse un `embeds` sur un tel message. L'échec était muet — le bouton
    // tournait dans le vide et la page ne changeait jamais.
    //
    // `mettreAJour` reconstruit la carte quand c'en est une, et retombe sur
    // un update() classique sinon. La reconstruction ne fait aucun appel
    // réseau : rien à différer.
    return mettreAJour(interaction, {
      embeds: [renderEmbed(kind, interaction.guildId, filtre, page)],
      components: [searchRow(kind, interaction.guildId, filtre, page)],
    });
  }
  if (interaction.isButton()) {
    const kind = interaction.customId.split(':')[1];
    const modal = new ModalBuilder().setCustomId(`rprpmodal:${kind}`).setTitle(META[kind]?.title || 'Recherche');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('q')
          .setLabel('Pseudo Roblox, @ Discord, ID ou raison')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
      )
    );
    return interaction.showModal(modal);
  }
  // Modal submit
  const kind = interaction.customId.split(':')[1];
  const q = interaction.fields.getTextInputValue('q');
  return interaction.reply({
    embeds: [renderEmbed(kind, interaction.guildId, q, 0)],
    components: [searchRow(kind, interaction.guildId, q, 0)],
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  META,
  PAR_PAGE,
  nombreDePages,
  searchRow,
  add,
  remove,
  activeOf,
  historyOf,
  renderEmbed,
  postBoard,
  refreshBoard,
  reenregistrerPanneau,
  handleSearchInteraction,
};
