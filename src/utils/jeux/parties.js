// 🎲 Mini-jeux — ce qui est commun à toutes les parties.
//
//  • le catalogue des jeux et leurs réglages par serveur ;
//  • la persistance : une partie vit en BASE (table jeux_parties), jamais
//    seulement en mémoire. Les boutons portent son id (« jeu:<id>:<action> »),
//    si bien qu'un redémarrage du bot n'abîme aucune partie en cours ;
//  • les statistiques (jeux_stats) et les récompenses : XP serveur par le
//    contrat C (gagnerXpServeur), Col SAO par le contrat A (crediterCol),
//    sous un plafond quotidien par membre (jeux_gains) ;
//  • la réédition d'un message de partie hors interaction (expiration,
//    signal du réflexe) — carte ou embed, sans se tromper de famille.

const { EmbedBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { db, getGuildConfig } = require('../../database');
const { COLORS } = require('../embeds');
const { suivre } = require('../reponse');
const M = require('../miseEnPage');

// ── Catalogue ──────────────────────────────────────────────────────────

const CATALOGUE_JEUX = [
  { cle: 'morpion', nom: 'Morpion', emoji: '⭕', resume: 'contre un membre ou contre le bot' },
  { cle: 'puissance4', nom: 'Puissance 4', emoji: '🔴', resume: 'aligner quatre pions, contre un membre ou le bot' },
  { cle: 'pfc', nom: 'Pierre-feuille-ciseaux', emoji: '✂️', resume: 'choix secrets, premier à 3 points' },
  { cle: 'pendu', nom: 'Pendu', emoji: '🪢', resume: 'tout le salon devine un mot' },
  { cle: 'nombre', nom: 'Plus ou moins', emoji: '🔢', resume: 'trouver le nombre en peu d\'essais' },
  { cle: 'quiz', nom: 'Quiz', emoji: '🧠', resume: 'culture générale, le plus rapide gagne' },
  { cle: 'demineur', nom: 'Démineur', emoji: '💣', resume: 'une grille en balises spoiler' },
  { cle: 'reflexe', nom: 'Réflexe', emoji: '⚡', resume: 'le premier à cliquer sur le bouton vert' },
  { cle: 'blackjack', nom: 'Blackjack', emoji: '🃏', resume: 'contre le croupier, mise en Col possible' },
];
const CLES_JEUX = CATALOGUE_JEUX.map((j) => j.cle);
const infoJeu = (cle) => CATALOGUE_JEUX.find((j) => j.cle === cle) || { cle, nom: cle, emoji: '🎲', resume: '' };

// ── Réglages ───────────────────────────────────────────────────────────

// Les jeux coupés un par un : « pendu,quiz » → Set { 'pendu', 'quiz' }.
function jeuxCoupes(cfg) {
  return new Set(
    String(cfg?.jeux_desactives || '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => CLES_JEUX.includes(c))
  );
}

// Le jeu est-il ouvert sur ce serveur ? (module ET jeu)
const jeuOuvert = (cfg, cle) => Boolean(cfg?.jeux_enabled) && !jeuxCoupes(cfg).has(cle);

const entier = (v, defaut, min, max) => {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return defaut;
  return Math.min(max, Math.max(min, Math.round(n)));
};

// ⚠️ Une ligne de serveur existante lit NULL pour une colonne neuve : chaque
// valeur a donc son repli ici, et nulle part ailleurs.
const BORNES_RECOMPENSES = {
  jeux_xp_victoire: { min: 0, max: 1000, defaut: 20 },
  jeux_xp_bot: { min: 0, max: 1000, defaut: 5 },
  jeux_xp_plafond: { min: 0, max: 10000, defaut: 200 },
  jeux_col_victoire: { min: 0, max: 10000, defaut: 0 },
};

function recompensesJeux(cfg) {
  const lire = (cle) => {
    const b = BORNES_RECOMPENSES[cle];
    return entier(cfg?.[cle], b.defaut, b.min, b.max);
  };
  return {
    xpVictoire: lire('jeux_xp_victoire'),
    xpBot: lire('jeux_xp_bot'),
    plafond: lire('jeux_xp_plafond'),
    col: lire('jeux_col_victoire'),
  };
}

// ── Durées ─────────────────────────────────────────────────────────────

const DUREES_JEUX = {
  invitation: 2 * 60_000,
  coup: 5 * 60_000, // morpion, puissance 4 : délai pour jouer son coup
  manche: 3 * 60_000, // pierre-feuille-ciseaux
  pendu: 10 * 60_000,
  nombre: 5 * 60_000,
  quiz: 20_000,
  reflexeFenetre: 10_000, // une fois le bouton vert
  blackjack: 3 * 60_000,
};

// ── Persistance ────────────────────────────────────────────────────────

const insererPartie = db.prepare(
  `INSERT INTO jeux_parties (guild_id, channel_id, message_id, jeu, joueurs, etat, tour, expire_le, created_at)
   VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`
);
const lirePartie = db.prepare('SELECT * FROM jeux_parties WHERE id = ?');
const majPartie = db.prepare(
  'UPDATE jeux_parties SET message_id = ?, joueurs = ?, etat = ?, tour = ?, expire_le = ? WHERE id = ?'
);
const effacerPartie = db.prepare('DELETE FROM jeux_parties WHERE id = ?');
const enCoursDuJoueur = db.prepare(
  'SELECT * FROM jeux_parties WHERE guild_id = ? AND jeu = ? AND expire_le > ? AND joueurs LIKE ? ORDER BY id LIMIT 5'
);
const enCoursDuSalon = db.prepare(
  'SELECT * FROM jeux_parties WHERE guild_id = ? AND channel_id = ? AND expire_le > ? ORDER BY id'
);
const lesExpirees = db.prepare('SELECT * FROM jeux_parties WHERE expire_le <= ? ORDER BY expire_le LIMIT 50');
const lesActives = db.prepare('SELECT * FROM jeux_parties WHERE expire_le > ? ORDER BY id');

function decoderPartie(ligne) {
  if (!ligne) return null;
  let joueurs = [];
  let etatJeu = {};
  try { joueurs = JSON.parse(ligne.joueurs) || []; } catch { joueurs = []; }
  try { etatJeu = JSON.parse(ligne.etat) || {}; } catch { etatJeu = {}; }
  return { ...ligne, joueurs, etat: etatJeu };
}

function creerPartieJeu({ guildId, channelId, jeu, joueurs, etat: etatJeu, tour = null, duree }) {
  const r = insererPartie.run(
    String(guildId), String(channelId), jeu, JSON.stringify(joueurs.map(String)), JSON.stringify(etatJeu || {}),
    tour === null ? null : String(tour), Date.now() + duree, new Date().toISOString()
  );
  return lirePartieJeu(Number(r.lastInsertRowid));
}

const lirePartieJeu = (id) => decoderPartie(lirePartie.get(Number(id)));

function sauverPartieJeu(partie) {
  majPartie.run(
    partie.message_id ? String(partie.message_id) : null,
    JSON.stringify(partie.joueurs), JSON.stringify(partie.etat),
    partie.tour === null || partie.tour === undefined ? null : String(partie.tour),
    Number(partie.expire_le), Number(partie.id)
  );
}

// 🏁 Termine une partie en l'effaçant. Renvoie true pour CELUI qui l'a
// effacée, false pour tous les autres : c'est le verrou qui empêche un clic
// et l'expiration (ou deux clics) de conclure deux fois la même partie.
const finirPartieJeu = (id) => effacerPartie.run(Number(id)).changes === 1;

// La partie en cours de ce membre à ce jeu, s'il en a une (`sauf` : une
// partie à ne pas compter, celle d'où l'on vérifie).
function partieDuJoueurJeu(guildId, jeu, userId, sauf = null) {
  const lignes = enCoursDuJoueur.all(String(guildId), jeu, Date.now(), `%"${String(userId)}"%`);
  return lignes.map(decoderPartie)
    .find((p) => p.joueurs.includes(String(userId)) && Number(p.id) !== Number(sauf)) || null;
}

const partiesDuSalonJeu = (guildId, channelId) =>
  enCoursDuSalon.all(String(guildId), String(channelId), Date.now()).map(decoderPartie);

const partiesExpireesJeu = (maintenant = Date.now()) => lesExpirees.all(maintenant).map(decoderPartie);
const partiesActivesJeu = (maintenant = Date.now()) => lesActives.all(maintenant).map(decoderPartie);

// ── Anti-spam de lancement ─────────────────────────────────────────────

const DELAI_LANCEMENT = 5000;
const MAX_PARTIES_SALON = 6;
const derniersLancements = new Map();

// Secondes à attendre avant de relancer (0 = c'est bon). Note le lancement.
function attenteLancementJeu(guildId, userId, maintenant = Date.now()) {
  const cle = `${guildId}:${userId}`;
  const avant = derniersLancements.get(cle) || 0;
  if (maintenant - avant < DELAI_LANCEMENT) return Math.ceil((DELAI_LANCEMENT - (maintenant - avant)) / 1000);
  derniersLancements.set(cle, maintenant);
  if (derniersLancements.size > 5000) {
    for (const [k, t] of derniersLancements) if (maintenant - t > DELAI_LANCEMENT) derniersLancements.delete(k);
  }
  return 0;
}

const oublierLancementsJeu = () => derniersLancements.clear();

// ── Statistiques ───────────────────────────────────────────────────────

const noterStat = db.prepare(
  `INSERT INTO jeux_stats (guild_id, user_id, jeu, victoires, defaites, nuls) VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT (guild_id, user_id, jeu) DO UPDATE SET
     victoires = victoires + excluded.victoires,
     defaites = defaites + excluded.defaites,
     nuls = nuls + excluded.nuls`
);
const statsDuMembre = db.prepare('SELECT * FROM jeux_stats WHERE guild_id = ? AND user_id = ? ORDER BY victoires DESC, jeu');
const classementTous = db.prepare(
  `SELECT user_id, SUM(victoires) AS victoires, SUM(defaites) AS defaites, SUM(nuls) AS nuls
   FROM jeux_stats WHERE guild_id = ? GROUP BY user_id
   HAVING SUM(victoires) + SUM(defaites) + SUM(nuls) > 0
   ORDER BY SUM(victoires) DESC, SUM(defaites) ASC, SUM(nuls) DESC, user_id LIMIT 500`
);
const classementUn = db.prepare(
  `SELECT user_id, victoires, defaites, nuls FROM jeux_stats WHERE guild_id = ? AND jeu = ?
   AND victoires + defaites + nuls > 0
   ORDER BY victoires DESC, defaites ASC, nuls DESC, user_id LIMIT 500`
);

// Le bot n'a pas de statistiques : seuls les membres en ont.
function noterResultatJeu(guildId, jeu, { gagnants = [], perdants = [], nuls = [] } = {}) {
  const humain = (id) => id && id !== 'bot';
  for (const id of gagnants.filter(humain)) noterStat.run(String(guildId), String(id), jeu, 1, 0, 0);
  for (const id of perdants.filter(humain)) noterStat.run(String(guildId), String(id), jeu, 0, 1, 0);
  for (const id of nuls.filter(humain)) noterStat.run(String(guildId), String(id), jeu, 0, 0, 1);
}

const statsMembreJeux = (guildId, userId) => statsDuMembre.all(String(guildId), String(userId));
const classementJeux = (guildId, jeu = null) =>
  (jeu ? classementUn.all(String(guildId), jeu) : classementTous.all(String(guildId)));

// ── Col SAO (contrat A) ────────────────────────────────────────────────

function saoPourJeux() {
  try {
    return require('../saoGame');
  } catch {
    return null;
  }
}

const soldeColJeu = (guildId, userId) => Number(saoPourJeux()?.getPlayer?.(String(guildId), String(userId))?.col || 0);

// Verse des Col. Passe par crediterCol (contrat A) ; tant que le module SAO
// ne l'expose pas, le même geste à la main.
function crediterColJeu(guildId, userId, montant) {
  const n = Math.floor(Number(montant) || 0);
  if (n <= 0 || !userId || userId === 'bot') return null;
  const S = saoPourJeux();
  if (!S) return null;
  try {
    if (typeof S.crediterCol === 'function') return S.crediterCol(String(guildId), String(userId), n);
    const { player } = S.ensurePlayer(String(guildId), String(userId));
    player.col = Number(player.col || 0) + n;
    S.savePlayer(player);
    return player.col;
  } catch (err) {
    console.warn(`⚠️ Mini-jeux : Col non versés (${err.message}).`);
    return null;
  }
}

// Retire une mise. Synchrone de bout en bout : aucun autre clic ne peut se
// glisser entre la lecture du solde et l'écriture. false si le solde manque.
function debiterColJeu(guildId, userId, montant) {
  const n = Math.floor(Number(montant) || 0);
  if (n <= 0) return true;
  const S = saoPourJeux();
  const p = S?.getPlayer?.(String(guildId), String(userId));
  if (!p || Number(p.col || 0) < n) return false;
  try {
    p.col = Number(p.col) - n;
    S.savePlayer(p);
    return true;
  } catch {
    return false;
  }
}

// ── Récompenses ────────────────────────────────────────────────────────

const lireGain = db.prepare('SELECT xp FROM jeux_gains WHERE guild_id = ? AND user_id = ? AND jour = ?');
const ajouterGain = db.prepare(
  `INSERT INTO jeux_gains (guild_id, user_id, jour, xp) VALUES (?, ?, ?, ?)
   ON CONFLICT (guild_id, user_id, jour) DO UPDATE SET xp = xp + excluded.xp`
);
const purgerGains = db.prepare('DELETE FROM jeux_gains WHERE jour < ?');

// Le jour « de Paris » (AAAA-MM-JJ) : le plafond repart à minuit, heure du
// serveur francophone, pas à 1 h ou 2 h du matin.
// ⚠️ Assemblé morceau par morceau : le format d'une locale (« fr-CA » donne
// AAAA-MM-JJ) dépend des données ICU embarquées, et un exécutable packagé en
// a peu. Les morceaux, eux, ne changent pas.
function jourJeux(date = new Date()) {
  try {
    const morceaux = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const val = (type) => morceaux.find((m) => m.type === type)?.value;
    const [a, m, j] = [val('year'), val('month'), val('day')];
    if (/^\d{4}$/.test(a) && /^\d{2}$/.test(m) && /^\d{2}$/.test(j)) return `${a}-${m}-${j}`;
  } catch {
    // fuseau inconnu : on retombe sur la date UTC
  }
  return date.toISOString().slice(0, 10);
}

// 🎁 Calcule ET réserve la récompense d'une victoire — de façon SYNCHRONE,
// pour pouvoir l'afficher dans la mise à jour qui suit sans attendre le
// réseau. L'XP elle-même est versée ensuite par verserXpJeu.
//
//  • contre un membre : jeux_xp_victoire ; contre le bot (ou en solo) :
//    jeux_xp_bot ;
//  • plafond quotidien jeux_xp_plafond par membre : au-delà, plus rien ;
//  • Col SAO jeux_col_victoire, seulement si l'Aventure SAO est active, et
//    tant que le plafond du jour n'est pas atteint.
//
// ⚠️ Le plafond se mesure à CHAQUE victoire récompensée, que l'XP soit
// versée ou non. Il ne comptait que l'XP réellement réservée : niveaux
// coupés, ou XP de victoire réglée à 0, rien ne s'inscrivait dans
// jeux_gains, le plafond n'était jamais atteint… et les Col coulaient sans
// fin (/jeu nombre se gagne à coup sûr, toutes les 5 s). Désormais une
// victoire consomme sa part du plafond — l'XP prévue, et 1 au moins — même
// quand cette XP n'est pas versée. Niveaux coupés, on paie donc en Col
// exactement autant de victoires qu'avec les niveaux actifs ; XP à 0, le
// plafond devient un nombre de victoires par jour. La colonne `xp` de
// jeux_gains ne sert qu'à ce plafond : la part d'une victoire sans XP peut
// donc s'y inscrire.
function preparerRecompenseJeu(guildId, userId, { contreBot = false } = {}) {
  if (!userId || userId === 'bot') return null;
  const cfg = getGuildConfig(String(guildId));
  if (!cfg.jeux_enabled) return null;
  const r = recompensesJeux(cfg);
  const voulu = contreBot ? r.xpBot : r.xpVictoire;
  const niveaux = cfg.levels_enabled !== 0;
  const xpPossible = niveaux && voulu > 0;
  const colPossible = r.col > 0 && Boolean(cfg.sao_enabled);
  // Rien à verser : rien à mesurer non plus.
  if (!xpPossible && !colPossible) return { xp: 0, col: 0, plafonne: false, sansXp: !xpPossible };
  const g = String(guildId);
  const u = String(userId);
  const jour = jourJeux();
  const deja = Number(lireGain.get(g, u, jour)?.xp || 0);
  const unite = Math.max(voulu, 1);
  const part = Math.max(0, Math.min(unite, r.plafond - deja));
  if (part > 0) ajouterGain.run(g, u, jour, part);
  const xp = xpPossible ? Math.min(voulu, part) : 0;
  let col = 0;
  if (colPossible && part > 0) {
    if (crediterColJeu(guildId, userId, r.col) !== null) col = r.col;
  }
  return { xp, col, plafonne: part < unite, sansXp: !xpPossible };
}

// Verse l'XP réservée (contrat C). Ne lève jamais : une annonce de niveau
// ratée ne doit pas emporter la fin d'une partie.
async function verserXpJeu(guild, userId, xp, salon = null) {
  if (!guild || !userId || userId === 'bot' || !(xp > 0)) return null;
  try {
    const L = require('../levels');
    if (typeof L.gagnerXpServeur === 'function') {
      return await L.gagnerXpServeur(guild, String(userId), 'jeux', xp, { salon });
    }
    const res = L.addXp(guild.id, String(userId), 'jeux', xp);
    if (res?.leveledUp) await L.announceLevelUp(guild, String(userId), 'jeux', res.newLevel, salon, res.oldLevel);
    return res;
  } catch (err) {
    console.warn(`⚠️ Mini-jeux : XP non versée (${err.message}).`);
    return null;
  }
}

// « 🎁 +20 XP · +50 Col » — ou rien.
function ligneRecompenseJeu(r) {
  if (!r) return '';
  const morceaux = [];
  if (r.xp > 0) morceaux.push(`+${r.xp} XP`);
  if (r.col > 0) morceaux.push(`+${r.col} Col`);
  if (r.plafonne) morceaux.push(r.sansXp ? 'plafond du jour atteint' : 'plafond d\'XP du jour atteint');
  return morceaux.length ? `-# 🎁 ${morceaux.join(' · ')}` : '';
}

const purgerGainsJeux = () => purgerGains.run(jourJeux(new Date(Date.now() - 2 * 86_400_000)));

// 🏁 Conclut un duel : statistiques des deux joueurs, et récompense
// réservée pour le gagnant (null sur un nul, ou si le bot gagne).
// `recompenser: false` : la victoire compte au classement sans rien
// rapporter (abandon de l'adversaire — sinon deux complices se feraient
// gagner de l'XP à tour de rôle en abandonnant).
function conclureDuelJeu(partie, { gagnant = null, nul = false, recompenser = true } = {}) {
  const [a, b] = partie.joueurs;
  if (nul || !gagnant) {
    noterResultatJeu(partie.guild_id, partie.jeu, { nuls: [a, b] });
    return null;
  }
  const perdant = gagnant === a ? b : a;
  noterResultatJeu(partie.guild_id, partie.jeu, { gagnants: [gagnant], perdants: [perdant] });
  if (!recompenser || gagnant === 'bot') return null;
  return preparerRecompenseJeu(partie.guild_id, gagnant, { contreBot: partie.joueurs.includes('bot') });
}

// ── Minuteurs ──────────────────────────────────────────────────────────
//
// Pour ce qui se joue à la seconde (fin d'un quiz, signal du réflexe). Ils
// ne sont qu'un raccourci : la base reste la référence, et le balayage
// périodique rattrape ce qu'un redémarrage leur a fait perdre.

const minuteursJeux = new Map();

function annulerMinuteurJeu(id) {
  const t = minuteursJeux.get(String(id));
  if (t) clearTimeout(t);
  minuteursJeux.delete(String(id));
}

function programmerJeu(id, delai, geste) {
  annulerMinuteurJeu(id);
  const t = setTimeout(() => {
    minuteursJeux.delete(String(id));
    Promise.resolve()
      .then(geste)
      .catch((err) => console.warn(`⚠️ Mini-jeux : minuteur de la partie ${id} (${err.message}).`));
  }, Math.max(0, Number(delai) || 0));
  t.unref?.();
  minuteursJeux.set(String(id), t);
}

// ── Rendu commun ───────────────────────────────────────────────────────

// Une réponse que seul l'auteur du clic voit.
const priveJeu = (interaction, content) => suivre(interaction, { content, flags: MessageFlags.Ephemeral });

// Le lien vers le message d'une partie (pour « tu as déjà une partie… »).
const lienPartieJeu = (partie) =>
  (partie?.message_id ? `https://discord.com/channels/${partie.guild_id}/${partie.channel_id}/${partie.message_id}` : null);

// 📤 Publie la partie : `reply()`, donc une carte, en UN seul message. Puis
// on retient l'identifiant du message — c'est lui qu'il faudra rééditer à
// l'expiration. S'il manque, le premier clic le fournira.
async function envoyerPartieJeu(interaction, partie, payload) {
  try {
    // Mentions explicites : personne ne sonne, sauf ce que la vue autorise
    // elle-même (l'invité d'un défi).
    await interaction.reply({ allowedMentions: { parse: [] }, ...payload });
  } catch (err) {
    finirPartieJeu(partie.id);
    throw err;
  }
  const message = typeof interaction.fetchReply === 'function'
    ? await interaction.fetchReply().catch(() => null)
    : null;
  retenirJetonJeu(partie.id, interaction, message);
  // Relue : un premier clic a pu passer pendant l'attente du réseau.
  const fraiche = lirePartieJeu(partie.id);
  if (fraiche && message?.id && !fraiche.message_id) {
    fraiche.message_id = String(message.id);
    sauverPartieJeu(fraiche);
  }
  return fraiche || partie;
}

// 🔑 Le jeton de l'interaction qui tient le message de la partie.
//
// Rééditer un message hors interaction passait par le salon :
// GET /channels/…/messages/…, qui exige « Voir le salon » et, hors cache,
// « Voir les anciens messages ». Or /jeu se lance aussi là où le bot ne voit
// rien — une interaction ne dépend pas de ses permissions. Le réflexe n'y
// passait jamais au vert, et aucune partie expirée n'y grisait ses boutons.
//
// Le webhook de l'interaction, lui, n'exige AUCUNE permission : pendant
// 15 minutes, `editReply` réédite le message qu'elle a publié (la commande)
// ou celui de son bouton (un clic répondu par une mise à jour). Chaque clic
// de ce genre rafraîchit le jeton ; comme toute partie prolonge son
// échéance à ce moment-là (10 minutes au plus), l'expiration tombe presque
// toujours dans les 15 minutes. Le salon reste le repli.
//
// En mémoire seulement : un jeton d'interaction n'a rien à faire en base.
const VALIDITE_JETON = 14 * 60_000; // 15 min chez Discord, une de marge
const jetonsJeux = new Map();

function retenirJetonJeu(partieId, interaction, message) {
  if (!message || typeof interaction?.editReply !== 'function') return;
  const maintenant = Date.now();
  const depuis = Number(interaction.createdTimestamp) || maintenant;
  if (depuis + VALIDITE_JETON <= maintenant) return;
  jetonsJeux.set(String(partieId), {
    interaction,
    carte: require('../reponse').estCarte(message),
    expire: depuis + VALIDITE_JETON,
  });
  if (jetonsJeux.size > 500) {
    for (const [cle, j] of jetonsJeux) if (j.expire <= maintenant) jetonsJeux.delete(cle);
  }
}

const oublierJetonJeu = (partieId) => jetonsJeux.delete(String(partieId));

// Le corps d'une réédition : une carte se reconstruit en composants, un
// message classique reçoit le payload tel quel. Null si rien ne tient.
function corpsEditionJeu(guild, client, payload, carte) {
  if (!carte) return { content: '', ...payload, allowedMentions: { parse: [] } };
  const composants = require('../reponse').enComposants(guild || null, client, payload);
  return composants?.length ? { components: composants, allowedMentions: { parse: [] } } : null;
}

// ✏️ Par le webhook de l'interaction, tant que son jeton vit.
async function editerParJetonJeu(client, partie, payload) {
  const j = jetonsJeux.get(String(partie.id));
  if (!j) return false;
  if (j.expire <= Date.now()) {
    jetonsJeux.delete(String(partie.id));
    return false;
  }
  const guild = j.interaction.guild || client?.guilds?.cache?.get?.(partie.guild_id) || null;
  const corps = corpsEditionJeu(guild, client, payload, j.carte);
  if (!corps) return false;
  try {
    await j.interaction.editReply(corps);
    return true;
  } catch (err) {
    // Jeton périmé ou refusé : on n'y reviendra pas, le salon prend le relais.
    jetonsJeux.delete(String(partie.id));
    console.warn(`⚠️ Mini-jeux : partie ${partie.id} non rééditée par son interaction (${err.message}).`);
    return false;
  }
}

// ✏️ Par le salon : exige d'y voir le message (cache, ou « Voir les anciens
// messages »).
async function editerParSalonJeu(client, partie, payload) {
  if (!client || !partie?.message_id || !partie.channel_id) return false;
  try {
    const salon = await client.channels.fetch(partie.channel_id).catch(() => null);
    const message = await salon?.messages?.fetch?.(partie.message_id).catch(() => null);
    if (!message) return false;
    const { estCarte } = require('../reponse');
    const corps = corpsEditionJeu(salon.guild || null, client, payload, estCarte(message));
    if (!corps) return false;
    await message.edit(corps);
    return true;
  } catch (err) {
    console.warn(`⚠️ Mini-jeux : message de la partie ${partie.id} non réédité (${err.message}).`);
    return false;
  }
}

// Les rééditions d'une même partie partent L'UNE APRÈS L'AUTRE. Sans cela,
// une réédition lente (le réflexe qui passe au vert) pouvait arriver chez
// Discord APRÈS la conclusion de la partie, et l'écraser.
const editionsEnVol = new Map();

// Attend la réédition en cours d'une partie — sans jamais dépasser `max` ms :
// une interaction n'a que trois secondes pour répondre.
async function attendreEditionJeu(id, max = 1500) {
  const envol = editionsEnVol.get(String(id));
  if (!envol) return;
  let minuteur;
  await Promise.race([
    envol.catch(() => null),
    new Promise((r) => { minuteur = setTimeout(r, max); minuteur.unref?.(); }),
  ]);
  clearTimeout(minuteur);
}

// « jeu:<id>:<action>[:<arg>] » — 100 caractères au plus, jamais davantage.
function idJeu(id, action, arg = null) {
  const brut = `jeu:${id}:${action}${arg === null || arg === undefined ? '' : `:${arg}`}`;
  if (brut.length > 100) throw new Error(`Identifiant de composant trop long : ${brut.length} caractères`);
  return brut;
}

function boutonJeu(id, action, { arg = null, label = null, emoji = null, style = ButtonStyle.Secondary, desactive = false } = {}) {
  const b = new ButtonBuilder().setCustomId(idJeu(id, action, arg)).setStyle(style).setDisabled(Boolean(desactive));
  if (label) b.setLabel(M.borner(label, 80));
  if (emoji) b.setEmoji(emoji);
  return b;
}

// Un participant tel qu'il s'affiche : le bot ou le membre, en mention.
// Une mention d'embed ne fait sonner personne (cartes.js s'en assure).
const quiJeu = (id, client) => (id === 'bot' ? `<@${client?.user?.id || 'bot'}>` : `<@${id}>`);

function embedJeu(cle, { titre = null, description = null, couleur = COLORS.PRIMARY, champs = null } = {}) {
  const info = infoJeu(cle);
  const e = new EmbedBuilder().setColor(couleur).setTitle(titre || `${info.emoji} ${info.nom}`);
  if (description) e.setDescription(M.borner(description, M.MAX_DESCRIPTION));
  if (champs?.length) e.addFields(...champs.map((c) => ({ name: c.name, value: M.borner(c.value, M.MAX_CHAMP), inline: false })));
  return e;
}

// « -# ⌛ … <t:…:R> » — l'heure exacte, à l'heure de chaque lecteur.
const echeanceJeu = (partie, texte = 'Sans action, la partie expire') =>
  `-# ⌛ ${texte} <t:${Math.ceil(Number(partie.expire_le) / 1000)}:R>.`;

// ✏️ Réédite le message d'une partie hors interaction (expiration, signal
// du réflexe…). Une carte se reconstruit en composants : lui renvoyer des
// `embeds` serait refusé par Discord, et l'échec serait muet.
//
// D'abord par le jeton de l'interaction (aucune permission requise), puis
// par le salon. Les rééditions d'une partie se suivent dans l'ordre.
function editerMessageJeu(client, partie, payload) {
  if (!partie?.id) return Promise.resolve(false);
  const cle = String(partie.id);
  const precedente = editionsEnVol.get(cle) || Promise.resolve();
  const envoi = precedente.catch(() => null).then(async () => {
    if (await editerParJetonJeu(client, partie, payload)) return true;
    return editerParSalonJeu(client, partie, payload);
  });
  editionsEnVol.set(cle, envoi);
  envoi.catch(() => null).then(() => { if (editionsEnVol.get(cle) === envoi) editionsEnVol.delete(cle); });
  return envoi;
}

module.exports = {
  CATALOGUE_JEUX, CLES_JEUX, infoJeu, jeuxCoupes, jeuOuvert, BORNES_RECOMPENSES, recompensesJeux, DUREES_JEUX,
  creerPartieJeu, lirePartieJeu, sauverPartieJeu, finirPartieJeu, partieDuJoueurJeu, partiesDuSalonJeu,
  partiesExpireesJeu, partiesActivesJeu, attenteLancementJeu, oublierLancementsJeu, MAX_PARTIES_SALON,
  noterResultatJeu, statsMembreJeux, classementJeux,
  soldeColJeu, crediterColJeu, debiterColJeu,
  jourJeux, preparerRecompenseJeu, verserXpJeu, ligneRecompenseJeu, purgerGainsJeux, conclureDuelJeu,
  programmerJeu, annulerMinuteurJeu,
  idJeu, boutonJeu, quiJeu, embedJeu, echeanceJeu, editerMessageJeu, priveJeu, lienPartieJeu, envoyerPartieJeu,
  retenirJetonJeu, oublierJetonJeu, attendreEditionJeu, VALIDITE_JETON,
};
