const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const { db } = require('../database');
const { COLORS } = require('./embeds');
const M = require('./miseEnPage');
const { getGrade, GRADES } = require('./permissions');

// 📅 Les absences — un panneau, une modale, et des annonces qui s'effacent.
//
// Le besoin : n'importe qui déclare son absence en un clic, l'annonce part
// dans PLUSIEURS salons à la fois (pour que personne ne puisse la manquer),
// et chaque copie disparaît toute seule quand l'absence est finie. Une
// absence sans date de fin reste affichée jusqu'à ce que la personne clique
// « Je suis de retour » — elle seule, ou le staff.
//
// Trois tables :
//  • absences            — la déclaration (début, fin ou NULL, raison) ;
//  • absence_messages    — les copies publiées, une ligne par salon : c'est
//    elles que le balayage supprime à l'échéance ;
//  • absence_channels    — les salons d'annonce du serveur. Il peut y en
//    avoir TRENTE : la liste se remplit par /absence salons (un menu de 25
//    à la fois, rejouable, ou une catégorie entière d'un coup). Vide = le
//    salon où le bouton est cliqué fait l'affaire.

const inserer = db.prepare(
  'INSERT INTO absences (guild_id, user_id, debut, fin, raison, at) VALUES (?, ?, ?, ?, ?, ?)'
);
const active = db.prepare(
  'SELECT * FROM absences WHERE guild_id = ? AND user_id = ? AND (fin IS NULL OR fin > ?) LIMIT 1'
);
const parId = db.prepare('SELECT * FROM absences WHERE id = ?');
const effacer = db.prepare('DELETE FROM absences WHERE id = ?');
const corriger = db.prepare('UPDATE absences SET debut = ?, fin = ?, raison = ? WHERE id = ?');
const echues = db.prepare('SELECT * FROM absences WHERE fin IS NOT NULL AND fin <= ?');
const duServeur = db.prepare('SELECT * FROM absences WHERE guild_id = ? AND (fin IS NULL OR fin > ?) ORDER BY debut');

const insererMessage = db.prepare(
  'INSERT INTO absence_messages (absence_id, channel_id, message_id) VALUES (?, ?, ?)'
);
const messagesDe = db.prepare('SELECT * FROM absence_messages WHERE absence_id = ?');
const parMessage = db.prepare('SELECT * FROM absence_messages WHERE message_id = ? LIMIT 1');
const effacerMessages = db.prepare('DELETE FROM absence_messages WHERE absence_id = ?');

const viderSalons = db.prepare('DELETE FROM absence_channels WHERE guild_id = ?');
const insererSalon = db.prepare('INSERT OR IGNORE INTO absence_channels (guild_id, channel_id) VALUES (?, ?)');
const salonsDe = db.prepare('SELECT channel_id FROM absence_channels WHERE guild_id = ?');
const retirerSalon = db.prepare('DELETE FROM absence_channels WHERE guild_id = ? AND channel_id = ?');

// ── Lire ce que la modale rapporte ───────────────────────────────
//
// Discord n'a pas de sélecteur de date dans une modale : on lit du texte, et
// chaque refus dit exactement quoi corriger — jamais « format invalide ».

// L'inverse de lireDate : un instant → « JJ/MM/AAAA », pour préremplir.
function versJJMMAAAA(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const deux = (n) => String(n).padStart(2, '0');
  return `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// « JJ/MM/AAAA » → l'instant minuit, heure du serveur. Null si vide.
function lireDate(texte) {
  const t = String(texte || '').trim();
  if (!t) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m) throw new Error(`❌ « ${t} » n'est pas une date **JJ/MM/AAAA** (exemple : 25/08/2026).`);
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[1])) {
    throw new Error(`❌ « ${t} » n'existe pas dans le calendrier.`);
  }
  return d.getTime();
}

// La fin : une date « JJ/MM/AAAA » (incluse : l'absence court jusqu'à la fin
// de ce jour-là), une durée « 5j » / « 12h » / « 2sem », ou rien du tout —
// et rien du tout veut dire indéterminée.
function lireFin(texte, debut) {
  const t = String(texte || '').trim().toLowerCase();
  if (!t || t === 'indeterminee' || t === 'indéterminée' || t === 'indetermine' || t === 'indéterminé') return null;

  const duree = /^(\d+)\s*(h|j|jour|jours|sem|semaine|semaines)$/.exec(t);
  if (duree) {
    const n = Number(duree[1]);
    if (!n) throw new Error('❌ Une durée de zéro ne dit rien : laissez le champ **vide** pour une absence sans date de fin.');
    const heures = { h: 1, j: 24, jour: 24, jours: 24, sem: 24 * 7, semaine: 24 * 7, semaines: 24 * 7 }[duree[2]];
    return debut + n * heures * 3600 * 1000;
  }

  const jour = lireDate(t); // lève déjà avec le bon message si ce n'est ni une durée ni une date
  return jour + 24 * 3600 * 1000 - 1000; // jusqu'à la fin de ce jour-là, inclus
}

// ── Le panneau ───────────────────────────────────────────────────

function cartePanneau() {
  return new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('📅 Absences')
    .setDescription(M.description([
      'Vous partez quelques jours ? Dites-le ici : tout le monde le saura, personne ne vous cherchera.',
      M.bloc('Comment faire', [
        'Cliquez sur **Déclarer une absence**',
        'Donnez la date de fin — ou laissez vide si vous ne savez pas encore',
        'Votre annonce se supprime toute seule à votre retour',
      ], { prefixe: '🖱️', compte: null }),
    ]));
}

const rangeePanneau = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('abs:ouvrir').setLabel('Déclarer une absence').setEmoji('📅').setStyle(ButtonStyle.Primary)
);

// Publie le panneau. Les salons donnés s'AJOUTENT à la liste — republier
// le panneau ne détruit pas une liste de trente salons montée à la main.
// 📌 Le panneau est épinglé (et la notification système effacée) : il est
// fait pour être retrouvé — sans « Gérer les messages », il reste simplement
// non épinglé.
async function publierPanneau(salonPanneau, salonsAnnonce) {
  const envoi = await salonPanneau.send({ embeds: [cartePanneau()], components: [rangeePanneau()] });
  await require('./embeds').epinglerProprement(envoi);
  ajouterSalons(salonPanneau.guildId || salonPanneau.guild?.id, (salonsAnnonce || []).map((s2) => s2.id));
  return envoi;
}

// ── La liste des salons d'annonce, sans plafond ──────────────────
function ajouterSalons(guildId, ids) {
  let n = 0;
  for (const id of ids || []) {
    if (insererSalon.run(String(guildId), String(id)).changes) n += 1;
  }
  return n;
}
function retirerSalons(guildId, ids) {
  let n = 0;
  for (const id of ids || []) {
    if (retirerSalon.run(String(guildId), String(id)).changes) n += 1;
  }
  return n;
}
const listeSalons = (guildId) => salonsDe.all(String(guildId)).map((l) => l.channel_id);
const viderTousSalons = (guildId) => viderSalons.run(String(guildId)).changes;

// ── La modale ────────────────────────────────────────────────────

function modale(customId = 'abs:decl', valeurs = null) {
  const champ = (id, label, placeholder, valeur = '') => {
    const entree = new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder)
      .setStyle(id === 'abs:raison' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(false).setMaxLength(id === 'abs:raison' ? 400 : 20);
    if (valeur) entree.setValue(String(valeur).slice(0, id === 'abs:raison' ? 400 : 20));
    return new ActionRowBuilder().addComponents(entree);
  };
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(customId === 'abs:modif' ? 'Modifier mon absence' : 'Déclarer une absence')
    .addComponents(
      champ('abs:debut', 'Début (JJ/MM/AAAA) — vide = maintenant', '25/08/2026', valeurs ? versJJMMAAAA(valeurs.debut) : ''),
      champ('abs:fin', 'Fin : date, durée (5j, 12h)… ou vide', 'vide = durée indéterminée', valeurs?.fin ? versJJMMAAAA(valeurs.fin) : ''),
      champ('abs:raison', 'Raison (facultatif)', 'Vacances, examens, déménagement…', valeurs?.raison || '')
    );
}

// ── L'annonce ────────────────────────────────────────────────────

function carteAbsence(a) {
  const secondes = (ms) => Math.floor(ms / 1000);
  const lignes = [
    `<@${a.user_id}> sera absent(e).`,
    M.bloc('Période', [
      `Depuis : <t:${secondes(a.debut)}:f>`,
      a.fin ? `Retour : <t:${secondes(a.fin)}:f> — <t:${secondes(a.fin)}:R>` : 'Durée : **indéterminée**',
    ], { prefixe: '⏳', compte: null }),
  ];
  if (a.raison) lignes.push(M.bloc('Raison', [M.citation(a.raison)], { prefixe: '📝', compte: null }));
  lignes.push('-# Ce message disparaîtra tout seul à la fin de l\'absence.');
  return new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle('📅 Absence déclarée')
    .setDescription(M.description(lignes));
}

const rangeeAbsence = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('abs:editer').setLabel('Modifier').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('abs:fin').setLabel('Je suis de retour').setEmoji('✅').setStyle(ButtonStyle.Success)
);

// Où annoncer : les salons retenus à la publication du panneau — et à
// défaut, le salon où le bouton vient d'être cliqué.
async function salonsAnnonce(interaction) {
  const retenus = salonsDe.all(String(interaction.guildId));
  const salons = [];
  for (const { channel_id } of retenus) {
    const salon = await interaction.client.channels.fetch(channel_id).catch(() => null);
    if (salon?.isTextBased?.()) salons.push(salon);
  }
  if (!salons.length && interaction.channel?.isTextBased?.()) salons.push(interaction.channel);
  return salons;
}

// ── Les gestes ───────────────────────────────────────────────────

async function handleBouton(interaction) {
  if (interaction.customId === 'abs:ouvrir') {
    const deja = active.get(String(interaction.guildId), String(interaction.user.id), Date.now());
    if (deja) {
      return interaction.reply({
        content: '📅 Vous avez **déjà une absence en cours**.\n➜ Cliquez **✅ Je suis de retour** sur son annonce avant d\'en déclarer une nouvelle.',
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.showModal(modale());
  }
  if (interaction.customId === 'abs:fin') return terminer(interaction);
  if (interaction.customId === 'abs:editer') {
    const ligne = parMessage.get(String(interaction.message?.id));
    const absence = ligne ? parId.get(ligne.absence_id) : null;
    if (!absence) {
      return interaction.reply({ content: '📅 Cette absence était déjà terminée.', flags: MessageFlags.Ephemeral }).catch(() => null);
    }
    const estConcerne = String(interaction.user.id) === absence.user_id;
    const estStaff = getGrade(interaction.member) >= GRADES.STAFF;
    if (!estConcerne && !estStaff) {
      return interaction.reply({
        content: `⛔ Seul <@${absence.user_id}> — ou le staff — peut modifier cette absence.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.showModal(modale('abs:modif', absence));
  }
  return null;
}

async function handleModal(interaction) {
  if (interaction.customId === 'abs:modif') return modifierAbsence(interaction);

  let debut;
  let fin;
  try {
    debut = lireDate(interaction.fields.getTextInputValue('abs:debut')) ?? Date.now();
    fin = lireFin(interaction.fields.getTextInputValue('abs:fin'), debut);
  } catch (err) {
    return interaction.reply({ content: err.message, flags: MessageFlags.Ephemeral });
  }
  if (fin && fin <= Date.now()) {
    return interaction.reply({
      content: '❌ Cette absence serait **déjà finie** : sa fin est dans le passé. Vérifiez la date.',
      flags: MessageFlags.Ephemeral,
    });
  }
  const raison = String(interaction.fields.getTextInputValue('abs:raison') || '').trim() || null;

  const deja = active.get(String(interaction.guildId), String(interaction.user.id), Date.now());
  if (deja) {
    return interaction.reply({
      content: '📅 Vous avez **déjà une absence en cours** — cliquez **✅ Je suis de retour** sur son annonce d\'abord.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const ligne = inserer.run(
    String(interaction.guildId), String(interaction.user.id),
    debut, fin, raison, new Date().toISOString()
  );
  const absence = parId.get(ligne.lastInsertRowid);

  // ⏱️ Trente salons = trente envois : bien plus que les 3 secondes que
  // Discord accorde. On diffère la confirmation (éphémère) AVANT l'éventail.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);

  // Une copie par salon, toutes en parallèle : les salons sont des routes
  // indépendantes, et un échec n'empêche pas les autres.
  const salons = await salonsAnnonce(interaction);
  const envois = await Promise.all(salons.map((salon) =>
    salon.send({ embeds: [carteAbsence(absence)], components: [rangeeAbsence()] })
      .then((envoi) => ({ salon, envoi }))
      .catch(() => null)));
  let copies = 0;
  for (const fait of envois.filter(Boolean)) {
    insererMessage.run(absence.id, String(fait.salon.id), String(fait.envoi.id));
    copies += 1;
  }
  if (!copies) {
    effacer.run(absence.id);
    return interaction.editReply({
      content: '❌ Je n\'ai pu publier l\'annonce dans **aucun salon**.\n➜ Vérifiez que je peux écrire dans les salons d\'annonce, puis réessayez.',
    }).catch(() => null);
  }

  const secondes = Math.floor((fin || 0) / 1000);
  return interaction.editReply({
    content: `✅ Absence déclarée${fin ? ` jusqu'au <t:${secondes}:f>` : ' — durée indéterminée'}.`
      + `\n-# Annoncée dans ${copies} salon(s). L'annonce se supprimera toute seule ; sinon, cliquez **✅ Je suis de retour**.`,
  }).catch(() => null);
}

// ✏️ Modifier l'absence sans la clôturer : la déclaration est corrigée, et
// CHAQUE copie de l'annonce est rééditée sur place — réactions et liens
// intacts, comme le veut la règle du projet.
async function modifierAbsence(interaction) {
  const ligne = parMessage.get(String(interaction.message?.id));
  const absence = ligne ? parId.get(ligne.absence_id) : null;
  if (!absence) {
    return interaction.reply({ content: '📅 Cette absence était déjà terminée.', flags: MessageFlags.Ephemeral }).catch(() => null);
  }
  const estConcerne = String(interaction.user.id) === absence.user_id;
  if (!estConcerne && getGrade(interaction.member) < GRADES.STAFF) {
    return interaction.reply({
      content: `⛔ Seul <@${absence.user_id}> — ou le staff — peut modifier cette absence.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  let debut;
  let fin;
  try {
    // Un début laissé vide GARDE l'original : « vide = maintenant » vaut pour
    // une déclaration, pas pour une correction.
    debut = lireDate(interaction.fields.getTextInputValue('abs:debut')) ?? absence.debut;
    fin = lireFin(interaction.fields.getTextInputValue('abs:fin'), debut);
  } catch (err) {
    return interaction.reply({ content: err.message, flags: MessageFlags.Ephemeral });
  }
  if (fin && fin <= Date.now()) {
    return interaction.reply({
      content: '❌ Cette absence serait **déjà finie** : sa fin est dans le passé. Vérifiez la date — ou cliquez **✅ Je suis de retour** pour la clore.',
      flags: MessageFlags.Ephemeral,
    });
  }
  const raison = String(interaction.fields.getTextInputValue('abs:raison') || '').trim() || null;

  corriger.run(debut, fin, raison, absence.id);
  const corrige = parId.get(absence.id);
  await editerCopies(interaction.client, corrige);

  const secondes = Math.floor((fin || 0) / 1000);
  return interaction.reply({
    content: `✏️ Absence mise à jour${fin ? ` — retour <t:${secondes}:f>` : ' — durée indéterminée'}. Toutes les annonces sont corrigées.`,
    flags: MessageFlags.Ephemeral,
  }).catch(() => null);
}

// Réédite chaque copie de l'annonce. Une carte se reconstruit en composants
// (une carte n'accepte pas d'embeds en modification) ; un vieil embed se
// modifie tel quel. Une copie disparue est simplement oubliée.
async function editerCopies(client, absence) {
  const { enComposants, estCarte } = require('./reponse');
  for (const copie of messagesDe.all(absence.id)) {
    const salon = await client.channels.fetch(copie.channel_id).catch(() => null);
    const message = await salon?.messages?.fetch?.(copie.message_id).catch(() => null);
    if (!message) continue;
    const contenu = { embeds: [carteAbsence(absence)], components: [rangeeAbsence()] };
    if (estCarte(message)) {
      const composants = enComposants(salon.guild, client, contenu);
      if (composants) await message.edit({ components: composants }).catch(() => null);
    } else {
      await message.edit(contenu).catch(() => null);
    }
  }
}

// « Je suis de retour » — la personne concernée, ou le staff.
async function terminer(interaction) {
  const ligne = parMessage.get(String(interaction.message?.id));
  const absence = ligne ? parId.get(ligne.absence_id) : null;
  if (!absence) {
    // Plus en base (balayée entre-temps ?) : le message n'a plus de raison d'être.
    await interaction.message?.delete?.().catch(() => null);
    return interaction.reply({ content: '📅 Cette absence était déjà terminée.', flags: MessageFlags.Ephemeral }).catch(() => null);
  }
  const estConcerne = String(interaction.user.id) === absence.user_id;
  const estStaff = getGrade(interaction.member) >= GRADES.STAFF;
  if (!estConcerne && !estStaff) {
    return interaction.reply({
      content: `⛔ Seul <@${absence.user_id}> — ou le staff — peut clore cette absence.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  await supprimerCopies(interaction.client, absence);
  return interaction.reply({
    content: estConcerne ? '👋 Bon retour ! Votre annonce d\'absence est supprimée partout.' : '✅ Absence close : ses annonces sont supprimées.',
    flags: MessageFlags.Ephemeral,
  }).catch(() => null);
}

// Supprime TOUTES les copies d'une absence, puis la déclaration elle-même.
async function supprimerCopies(client, absence) {
  for (const copie of messagesDe.all(absence.id)) {
    const salon = await client.channels.fetch(copie.channel_id).catch(() => null);
    await salon?.messages?.delete?.(copie.message_id).catch(() => null);
  }
  effacerMessages.run(absence.id);
  effacer.run(absence.id);
}

// ── Le balayage : les absences finies s'effacent toutes seules ───
async function balayer(client) {
  let fermees = 0;
  for (const absence of echues.all(Date.now())) {
    await supprimerCopies(client, absence);
    fermees += 1;
  }
  return fermees;
}

function demarrer(client) {
  // Tout de suite (rattraper ce qui a expiré pendant que le bot dormait),
  // puis chaque minute — la précision d'une absence se compte en heures.
  balayer(client).catch((err) => console.warn(`⚠️ Balayage des absences : ${err.message}`));
  setInterval(() => {
    balayer(client).catch((err) => console.warn(`⚠️ Balayage des absences : ${err.message}`));
  }, 60_000);
}

const enCours = (guildId) => duServeur.all(String(guildId), Date.now());

// Le choix des salons passe par un MENU, pas par des options de commande :
// une commande plafonne à 25 options, un menu se rejoue autant de fois
// qu'il faut — trente salons se montent en deux passages.
function handleMenu(interaction) {
  const mettreAJour = require('./reponse').mettreAJour;
  const geste = interaction.customId.split(':')[2];
  const ids = (interaction.values || []).map(String);
  if (geste === 'ajouter') {
    const n = ajouterSalons(interaction.guildId, ids);
    const total = listeSalons(interaction.guildId).length;
    return mettreAJour(interaction, {
      content: `✅ ${n} salon(s) ajouté(s) — **${total}** au total.`
        + '\n-# Relancez `/absence salons ajouter` pour en ajouter d\'autres (25 par passage).',
      components: [],
    });
  }
  if (geste === 'retirer') {
    const n = retirerSalons(interaction.guildId, ids);
    const total = listeSalons(interaction.guildId).length;
    return mettreAJour(interaction, {
      content: `🗑️ ${n} salon(s) retiré(s) — il en reste **${total}**.`,
      components: [],
    });
  }
  return null;
}

module.exports = {
  lireDate, lireFin, cartePanneau, rangeePanneau, publierPanneau, modale,
  carteAbsence, rangeeAbsence, handleBouton, handleModal, handleMenu, terminer, modifierAbsence, editerCopies, versJJMMAAAA,
  balayer, demarrer, enCours, supprimerCopies,
  ajouterSalons, retirerSalons, listeSalons, viderTousSalons,
};
