const { db } = require('../database');
const { themeDe } = require('./rpThemes');

// 🔢 Le matricule : le numéro qui suit une personne dans le RP.
//
// Le besoin qu'il couvre est très concret. En jeu, on connaît quelqu'un par
// son pseudo Roblox ou par son matricule ; sur Discord, on a besoin de son
// IDENTIFIANT pour le sanctionner, le whitelister ou lui écrire. Faire le
// lien à la main coûte une recherche à chaque fois, et se trompe dès que deux
// pseudos se ressemblent.
//
// Une fiche relie donc les trois : matricule, pseudo du jeu, compte Discord.
// N'importe lequel des trois retrouve les deux autres.
//
// ⚠️ Il appartient au MODULE RP. Module coupé, plus de matricules : ni la
// commande, ni le panneau, ni la recherche. Un serveur qui ne fait pas de RP
// n'a aucune raison de voir passer des numéros de service.

const TABLE = 'matricules';

// Le matricule est unique PAR SERVEUR : deux communautés peuvent avoir chacune
// leur n°42. Le compte Discord aussi — une personne n'a qu'un matricule à la
// fois sur un serveur donné.
const inserer = db.prepare(
  `INSERT INTO ${TABLE} (guild_id, matricule, user_id, roblox_name, discord_tag, note, by_id, at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const majFiche = db.prepare(
  `UPDATE ${TABLE} SET matricule = ?, roblox_name = ?, discord_tag = ?, note = ?, by_id = ?, at = ?
   WHERE guild_id = ? AND user_id = ? AND active = 1`
);
const parUtilisateur = db.prepare(`SELECT * FROM ${TABLE} WHERE guild_id = ? AND user_id = ? AND active = 1`);
const parMatricule = db.prepare(`SELECT * FROM ${TABLE} WHERE guild_id = ? AND matricule = ? AND active = 1`);
const tousActifs = db.prepare(
  `SELECT * FROM ${TABLE} WHERE guild_id = ? AND active = 1
   ORDER BY LENGTH(matricule), matricule COLLATE NOCASE`
);
const desactiver = db.prepare(
  `UPDATE ${TABLE} SET active = 0, removed_by = ?, removed_at = ? WHERE guild_id = ? AND user_id = ? AND active = 1`
);
const historique = db.prepare(`SELECT * FROM ${TABLE} WHERE guild_id = ? AND user_id = ? ORDER BY id DESC`);
const dernierNumero = db.prepare(
  `SELECT matricule FROM ${TABLE} WHERE guild_id = ? AND matricule GLOB '[0-9]*'
   ORDER BY CAST(matricule AS INTEGER) DESC LIMIT 1`
);

const MAX_MATRICULE = 20;

// Normalise ce qu'on tape : « n° 007 », « #007 » et « 007 » désignent le même.
function normaliser(brut) {
  return String(brut || '')
    .replace(/^\s*(?:n[°o]\s*|#)/i, '')
    .trim()
    .slice(0, MAX_MATRICULE);
}

// Prochain numéro libre, pour ne pas avoir à en chercher un soi-même.
function prochainMatricule(guildId) {
  const dernier = Number(dernierNumero.get(String(guildId))?.matricule || 0);
  return String(dernier + 1).padStart(3, '0');
}

const ficheDe = (guildId, userId) => parUtilisateur.get(String(guildId), String(userId));
const ficheDuMatricule = (guildId, matricule) => parMatricule.get(String(guildId), normaliser(matricule));
const toutes = (guildId) => tousActifs.all(String(guildId));
const historiqueDe = (guildId, userId) => historique.all(String(guildId), String(userId));

// 🔎 LA fonction du système : n'importe laquelle des trois entrées retrouve
// les deux autres.
//
// L'ordre des essais compte. Le matricule est exact et sans ambiguïté : on
// commence par lui. Vient l'identifiant Discord, exact lui aussi. Le pseudo
// Roblox ensuite, en exact puis en approché. Un pseudo Discord enfin — c'est
// le plus fragile, il change quand on veut.
function retrouver(guildId, requete) {
  const q = String(requete || '').trim();
  if (!q) return { trouve: null, proches: [] };

  const mention = /^<@!?(\d{15,25})>$/.exec(q)?.[1];
  const id = mention || (/^\d{15,25}$/.test(q) ? q : null);
  if (id) {
    const f = ficheDe(guildId, id);
    if (f) return { trouve: f, proches: [], par: 'identifiant Discord' };
  }

  const parNum = ficheDuMatricule(guildId, q);
  if (parNum) return { trouve: parNum, proches: [], par: 'matricule' };

  const bas = q.toLowerCase();
  const liste = toutes(guildId);
  const exact = liste.find((f) => String(f.roblox_name || '').toLowerCase() === bas)
    || liste.find((f) => String(f.discord_tag || '').toLowerCase() === bas);
  if (exact) return { trouve: exact, proches: [], par: 'pseudo' };

  // Rien d'exact : on propose ce qui ressemble, plutôt qu'un « introuvable »
  // sec devant lequel il n'y a rien à faire.
  const proches = liste.filter((f) =>
    [f.roblox_name, f.discord_tag, f.matricule].filter(Boolean).some((v) => String(v).toLowerCase().includes(bas))
  );
  return { trouve: null, proches: proches.slice(0, 10) };
}

// Attribue ou met à jour la fiche d'une personne.
// Renvoie { ok } ou { erreur } — jamais une exception : l'appelant a une
// réponse à écrire dans tous les cas.
function attribuer(guildId, { userId, matricule, robloxName, discordTag, note, byId }) {
  const num = normaliser(matricule) || prochainMatricule(guildId);
  if (!/^[\w.\-]{1,20}$/.test(num)) {
    return { erreur: '❌ Un matricule ne contient que des lettres, des chiffres, un point ou un tiret (20 signes au plus).' };
  }

  // Un même numéro ne peut pas désigner deux personnes : c'est toute l'utilité
  // du matricule.
  const occupe = ficheDuMatricule(guildId, num);
  if (occupe && String(occupe.user_id) !== String(userId)) {
    return { erreur: `❌ Le matricule **${num}** est déjà celui de <@${occupe.user_id}>.` };
  }

  const existante = ficheDe(guildId, userId);
  const maintenant = new Date().toISOString();
  if (existante) {
    majFiche.run(num, robloxName || existante.roblox_name, discordTag || existante.discord_tag,
      note ?? existante.note, byId, maintenant, String(guildId), String(userId));
    return { ok: true, num, misAJour: true, avant: existante.matricule };
  }
  inserer.run(String(guildId), num, String(userId), robloxName || null, discordTag || null, note || null, byId, maintenant);
  return { ok: true, num, misAJour: false };
}

function retirer(guildId, userId, byId) {
  return desactiver.run(byId, new Date().toISOString(), String(guildId), String(userId)).changes > 0;
}

// Une ligne de la liste, dans la grammaire du projet.
//
// 🆔 L'identifiant est écrit en clair, comme sur les listes Blacklist et
// Whitelist RP : c'est lui qu'on vient chercher ici, et une mention ne le
// montre pas — un membre parti du serveur n'affiche même plus de nom.
function ligne(f) {
  const tete = `\`${f.matricule}\` · **${f.roblox_name || '?'}** · <@${f.user_id}>`;
  const details = [`🆔 \`${f.user_id}\``];
  if (f.discord_tag) details.push(`💬 ${f.discord_tag}`);
  if (f.note) details.push(`📄 ${f.note}`);
  return `${require('./miseEnPage').entree(tete)}\n-# ${details.join(' · ')}`;
}

// Le vocabulaire suit le jeu du serveur : « matricule » sur Arma, mais
// « numéro de dossier » ailleurs ne dirait rien de plus. On garde donc le mot,
// et on emprunte au thème son titre et son emoji de carte.
function libelle(guildId) {
  const T = themeDe(guildId);
  return { titre: 'Matricules', emoji: T.carte.emoji, mot: 'matricule', document: T.carte.titre };
}

module.exports = {
  MAX_MATRICULE, normaliser, prochainMatricule,
  ficheDe, ficheDuMatricule, toutes, historiqueDe,
  retrouver, attribuer, retirer, ligne, libelle,
};

// ══════════════════════════════════════════════════════════════════
// 📋 LE PANNEAU
// ══════════════════════════════════════════════════════════════════
//
// Même mécanique que les listes Blacklist / Whitelist RP : un message posté
// dans un salon, tenu à jour à chaque attribution, avec recherche et pages.
// Il partage leur table `rp_boards` sous le genre « matr » — un serveur n'a
// qu'un panneau de matricules, comme il n'a qu'une whitelist.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const M = require('./miseEnPage');
const { mettreAJour, estCarte, enComposants } = require('./reponse');
const { DRAPEAU_V2 } = require('./cartes');
const { reglages } = require('./styleEmbeds');

const KIND = 'matr';
const getBoard = db.prepare('SELECT * FROM rp_boards WHERE guild_id = ? AND kind = ?');
const setBoard = db.prepare(
  'INSERT INTO rp_boards (guild_id, kind, channel_id, message_id) VALUES (?, ?, ?, ?) '
  + 'ON CONFLICT(guild_id, kind) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id'
);

const PAR_PAGE = 30;
const BUDGET = 3900; // marge sous la limite de 4096 signes d'une description

function filtrees(guildId, filtre) {
  const q = String(filtre || '').trim().toLowerCase();
  const liste = toutes(guildId);
  if (!q) return liste;
  return liste.filter((f) =>
    [f.matricule, f.roblox_name, f.discord_tag, f.user_id, f.note]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
  );
}

// Découpe par fiches ENTIÈRES : une fiche coupée en deux ne veut plus rien
// dire, et c'est précisément l'identifiant qu'on perdrait.
function pagesDe(fiches) {
  const pages = [];
  let courante = [];
  let taille = 0;
  for (const f of fiches) {
    const l = ligne(f);
    const cout = l.length + 2;
    if (courante.length >= PAR_PAGE || (courante.length && taille + cout > BUDGET)) {
      pages.push(courante);
      courante = [];
      taille = 0;
    }
    courante.push(l);
    taille += cout;
  }
  if (courante.length || !pages.length) pages.push(courante);
  return pages;
}

const nombreDePages = (guildId, filtre) => pagesDe(filtrees(guildId, filtre)).length;

function embedPanneau(guildId, filtre = '', page = 0) {
  const L = libelle(guildId);
  const fiches = filtrees(guildId, filtre);
  const q = String(filtre || '').trim();
  const pages = pagesDe(fiches);
  const num = Math.min(Math.max(0, Number(page) || 0), pages.length - 1);
  const debut = pages.slice(0, num).reduce((n, p) => n + p.length, 0) + 1;

  const entete = q
    ? M.entete(`Résultats pour « ${q} »`, { prefixe: '🔎', compte: fiches.length, motCompte: 'fiche' })
    : M.entete(L.titre, { prefixe: '🔢', compte: fiches.length, motCompte: L.mot });
  const corps = pages[num].length
    ? pages[num].join('\n')
    : `*${q ? 'Aucun résultat.' : 'Aucun matricule attribué pour le moment.'}*`;

  return new EmbedBuilder()
    .setColor(0x5b8def)
    .setTitle(`🔢 ${L.titre}${q ? ' — recherche' : ''}`)
    .setDescription(M.borner([entete, corps].join('\n'), M.MAX_DESCRIPTION))
    .setFooter({
      text: M.piedDePage({
        total: fiches.length, motTotal: L.mot, page: num + 1, pages: pages.length,
        extra: pages.length > 1 ? `fiches ${debut} à ${debut + pages[num].length - 1}` : null,
        heure: false,
      }),
    })
    .setTimestamp();
}

// Le filtre voyage dans l'identifiant du bouton — Discord le limite à 100
// signes, d'où la troncature.
function rangeePanneau(guildId, filtre = '', page = 0) {
  const total = nombreDePages(guildId, filtre);
  const q = String(filtre || '').slice(0, 50);
  const row = new ActionRowBuilder();
  if (total > 1) {
    row.addComponents(new ButtonBuilder().setCustomId(`matrpage:${page - 1}:${q}`)
      .setLabel('Page précédente').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0));
  }
  row.addComponents(new ButtonBuilder().setCustomId('matrsearch')
    .setLabel('Rechercher').setEmoji('🔎').setStyle(ButtonStyle.Secondary));
  if (total > 1) {
    row.addComponents(new ButtonBuilder().setCustomId(`matrpage:${page + 1}:${q}`)
      .setLabel('Page suivante').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= total - 1));
  }
  return row;
}

const contenuPanneau = (guildId, filtre = '', page = 0) => ({
  embeds: [embedPanneau(guildId, filtre, page)],
  components: [rangeePanneau(guildId, filtre, page)],
});

async function publierPanneau(channel, guildId) {
  const msg = await channel.send(contenuPanneau(guildId));
  setBoard.run(String(guildId), KIND, channel.id, msg.id);
  return msg;
}

// Met le panneau à jour après chaque attribution ou retrait.
//
// ⚠️ Un panneau déjà en carte refuse `edit({ embeds })` — et le refus est
// SILENCIEUX. C'est ce qui avait figé les listes RP : elles cessaient de se
// mettre à jour sans la moindre erreur visible.
async function rafraichirPanneau(client, guildId) {
  const board = getBoard.get(String(guildId), KIND);
  if (!board) return;
  try {
    const channel = await client.channels.fetch(board.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const msg = await channel.messages.fetch(board.message_id).catch(() => null);
    if (!msg) return;

    const contenu = contenuPanneau(guildId);
    const r = reglages(guildId);
    // Panneau resté en embed alors que le serveur veut des cartes : une
    // republication, et une seule — c'est le seul chemin possible.
    if (r.actif && r.cartes && msg.embeds?.length) {
      const neuf = await publierPanneau(channel, guildId).catch(() => null);
      if (neuf) {
        await msg.delete().catch(() => null);
        return;
      }
    }
    if (estCarte(msg)) {
      const composants = enComposants(msg.guild || channel.guild || null, client, contenu);
      if (composants?.length) {
        await msg.edit({ components: composants, flags: DRAPEAU_V2 });
        return;
      }
    }
    await msg.edit(contenu);
  } catch (err) {
    console.warn(`⚠️ Panneau des matricules non rafraîchi : ${err.message}`);
  }
}

// Boutons ◀️ / ▶️ du panneau.
async function handlePage(interaction) {
  const [, pageBrute, ...reste] = interaction.customId.split(':');
  const filtre = reste.join(':');
  return mettreAJour(interaction, contenuPanneau(interaction.guildId, filtre, Number(pageBrute) || 0));
}

module.exports.KIND = KIND;
module.exports.PAR_PAGE = PAR_PAGE;
module.exports.filtrees = filtrees;
module.exports.nombreDePages = nombreDePages;
module.exports.embedPanneau = embedPanneau;
module.exports.rangeePanneau = rangeePanneau;
module.exports.contenuPanneau = contenuPanneau;
module.exports.publierPanneau = publierPanneau;
module.exports.rafraichirPanneau = rafraichirPanneau;
module.exports.handlePage = handlePage;
