const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { staffRoleIds, getGrade, GRADES } = require('./permissions');
const { COLORS } = require('./embeds');
const M = require('./miseEnPage');

// 🎧 La FILE D'ATTENTE vocale — l'assistance au vocal, tenue par le bot.
//
// Un salon vocal d'ATTENTE est surveillé. Quelqu'un s'y connecte :
//
//  1. une carte part dans le salon écrit choisi — qui attend, et DEPUIS
//     QUAND (un horodatage Discord : « il y a 4 minutes » vit tout seul,
//     sans que le bot réédite quoi que ce soit) — et les rôles staff sont
//     mentionnés dans le message même : le seul champ qui sonne encore ;
//  2. un membre du staff clique 🙋 PRENDRE EN CHARGE : la carte le dit ;
//  3. il déplace la personne dans un des salons d'ASSISTANCE configurés :
//     le ticket se referme tout seul — la carte affiche qui a aidé, et
//     combien de temps la personne a attendu.
//
// Quitter l'attente sans être aidé referme aussi le ticket, en le disant.
// Une fois clos, le ticket reste affiché une minute — le temps de lire le
// bilan — puis il est SUPPRIMÉ : le salon des annonces ne garde que le vif.
// Tout survit à un redémarrage : les attentes vivent en base, et le
// démarrage remet chaque carte en face de la réalité du salon.

// La carte finale reste visible ce temps-là avant que le ticket disparaisse.
const DELAI_SUPPRESSION = 60_000;

const ouvrir = db.prepare(
  'INSERT INTO attentes_vocales (guild_id, user_id, channel_id, message_id, arrivee) VALUES (?, ?, ?, ?, ?)'
);
const poserMessage = db.prepare('UPDATE attentes_vocales SET channel_id = ?, message_id = ? WHERE rowid = ?');
const poserClaim = db.prepare('UPDATE attentes_vocales SET claim_par = ?, claim_a = ? WHERE rowid = ?');
const enAttente = db.prepare('SELECT rowid AS id, * FROM attentes_vocales WHERE guild_id = ? AND user_id = ? AND clos_a IS NULL');
const parMessage = db.prepare('SELECT rowid AS id, * FROM attentes_vocales WHERE message_id = ?');
const clore = db.prepare('UPDATE attentes_vocales SET clos_a = ? WHERE rowid = ?');
const fermer = db.prepare('DELETE FROM attentes_vocales WHERE rowid = ?');
const toutes = db.prepare('SELECT rowid AS id, * FROM attentes_vocales WHERE clos_a IS NULL');
const aPurger = db.prepare('SELECT rowid AS id, * FROM attentes_vocales WHERE clos_a IS NOT NULL AND clos_a <= ?');

// Les salons d'assistance du serveur — un tableau JSON dans la config.
function salonsAssistance(cfg) {
  try {
    return (JSON.parse(cfg.vocal_assistance_ids || '[]') || []).map(String);
  } catch { return []; }
}

// « 1 h 04 min 12 s », sans zéro inutile en tête.
function duree(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min ${String(sec).padStart(2, '0')} s`;
  return `${sec} s`;
}

// ── La carte, dans ses trois états ────────────────────────────────

function carteAttente(attente, etatFinal = null) {
  const secondes = Math.floor(attente.arrivee / 1000);
  const lignes = [`<@${attente.user_id}> attend de l'aide en vocal.`];
  const details = [`En attente depuis <t:${secondes}:R>`];
  if (attente.claim_par) details.push(`Pris en charge par <@${attente.claim_par}> <t:${Math.floor(attente.claim_a / 1000)}:R>`);
  lignes.push(M.bloc('Le ticket', details, { prefixe: '🎧', compte: null }));

  let couleur = COLORS.WARNING;
  let titre = '🎧 Quelqu\'un attend en vocal';
  if (etatFinal === 'aide') {
    couleur = COLORS.SUCCESS;
    titre = '✅ Assistance terminée';
    lignes.push(M.bloc('Terminé', [
      `Temps d'attente : **${duree(Date.now() - attente.arrivee)}**`,
      attente.claim_par ? `Aidé par <@${attente.claim_par}>` : 'Pris en charge sans claim',
    ], { prefixe: '🏁', compte: null }));
  } else if (etatFinal === 'parti') {
    couleur = COLORS.DANGER;
    titre = '👋 Parti sans être aidé';
    lignes.push(M.bloc('Terminé', [
      `A attendu **${duree(Date.now() - attente.arrivee)}**, puis a quitté l'attente sans prise en charge`,
    ], { prefixe: '🏁', compte: null }));
  }
  return new EmbedBuilder().setColor(couleur).setTitle(titre).setDescription(M.description(lignes));
}

// Avant le claim : le seul bouton est « Prendre en charge ». Après : il se
// grise, et « Déplacer en assistance » apparaît — un clic cherche un salon
// d'assistance vide et y déplace la personne.
const rangeeAttente = (claim = false) => {
  const rangee = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('va:claim')
      .setLabel(claim ? 'Déjà pris en charge' : 'Prendre en charge')
      .setEmoji('🙋').setStyle(claim ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(Boolean(claim))
  );
  if (claim) {
    rangee.addComponents(
      new ButtonBuilder().setCustomId('va:mv')
        .setLabel('Déplacer en assistance').setEmoji('📥').setStyle(ButtonStyle.Success)
    );
  }
  return rangee;
};

// Réédite la carte d'un ticket — reconstruction en composants si c'est une
// carte, embeds sinon. Une carte disparue est simplement oubliée.
async function editerCarte(client, attente, etatFinal = null) {
  const { enComposants, estCarte } = require('./reponse');
  const salon = await client.channels.fetch(attente.channel_id).catch(() => null);
  const message = await salon?.messages?.fetch?.(attente.message_id).catch(() => null);
  if (!message) return null;
  const contenu = {
    embeds: [carteAttente(attente, etatFinal)],
    components: etatFinal ? [] : [rangeeAttente(Boolean(attente.claim_par))],
  };
  if (estCarte(message)) {
    const composants = enComposants(salon.guild, client, contenu);
    if (composants) return message.edit({ components: composants }).catch(() => null);
    return null;
  }
  return message.edit(contenu).catch(() => null);
}

// Solde un ticket : la carte passe à son état final et la clôture est datée.
// La purge périodique supprimera le message une fois le délai de lecture passé.
async function cloturer(client, ligne, issue) {
  await editerCarte(client, ligne, issue);
  clore.run(Date.now(), ligne.id);
}

// 🧹 Les tickets clos depuis plus d'une minute disparaissent — message
// supprimé, ligne effacée. Périodique plutôt que minuté : rien à retenir,
// donc rien à perdre quand le bot redémarre entre la clôture et l'effacement.
async function purgerCloses(client) {
  let purges = 0;
  for (const ligne of aPurger.all(Date.now() - DELAI_SUPPRESSION)) {
    const salon = await client.channels.fetch(ligne.channel_id).catch(() => null);
    const message = await salon?.messages?.fetch?.(ligne.message_id).catch(() => null);
    if (message) await message.delete().catch(() => null);
    fermer.run(ligne.id);
    purges += 1;
  }
  return purges;
}

// ── Le fil des événements vocaux ──────────────────────────────────

// Chaque mouvement vocal passe par ici : ouverture à l'entrée du salon
// d'attente, clôture à sa sortie — aidé si la destination est un salon
// d'assistance, parti sinon.
async function surveiller(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  const membre = newState.member || oldState.member;
  if (!membre || membre.user.bot) return null;
  const cfg = getGuildConfig(guild.id);
  const attenteId = cfg.vocal_attente_channel_id;
  if (!attenteId) return null;

  // Sortie du salon d'attente → clôture.
  if (String(oldState.channelId) === String(attenteId) && String(newState.channelId) !== String(attenteId)) {
    const ligne = enAttente.get(String(guild.id), String(membre.id));
    if (ligne) {
      const aide = salonsAssistance(cfg).includes(String(newState.channelId));
      await cloturer(oldState.client ?? newState.client ?? membre.client, ligne, aide ? 'aide' : 'parti');
    }
    return null;
  }

  // Entrée dans le salon d'attente → ouverture.
  if (String(newState.channelId) === String(attenteId) && String(oldState.channelId) !== String(attenteId)) {
    if (!cfg.vocal_alerte_channel_id) return null;
    const salonAlerte = await guild.channels.fetch(cfg.vocal_alerte_channel_id).catch(() => null);
    if (!salonAlerte?.isTextBased?.()) return null;

    // Une attente encore ouverte pour cette personne (retour rapide, carte
    // orpheline) : on la referme d'abord — un ticket par attente.
    const restant = enAttente.get(String(guild.id), String(membre.id));
    if (restant) {
      await cloturer(newState.client ?? oldState.client ?? membre.client, restant, 'parti');
    }

    const attente = {
      guild_id: String(guild.id), user_id: String(membre.id),
      arrivee: Date.now(), claim_par: null, claim_a: null,
    };
    const ligne = ouvrir.run(attente.guild_id, attente.user_id, String(salonAlerte.id), null, attente.arrivee);
    const roles = staffRoleIds(cfg).map((id) => `<@&${id}>`).join(' ');
    const envoi = await salonAlerte.send({
      ...(roles ? { content: roles } : {}),
      embeds: [carteAttente(attente)],
      components: [rangeeAttente(false)],
    }).catch(() => null);
    if (!envoi) { fermer.run(ligne.lastInsertRowid); return null; }
    poserMessage.run(String(salonAlerte.id), String(envoi.id), ligne.lastInsertRowid);
    return envoi;
  }
  return null;
}

// 🙋 Les boutons du ticket — staff uniquement.
async function handleBouton(interaction) {
  const ligne = parMessage.get(String(interaction.message?.id));
  if (!ligne || ligne.clos_a) {
    return interaction.reply({ content: 'ℹ️ Ce ticket d\'attente est déjà terminé.', flags: MessageFlags.Ephemeral }).catch(() => null);
  }
  if (getGrade(interaction.member) < GRADES.STAFF) {
    return interaction.reply({ content: '⛔ Seul le **staff** peut prendre une attente en charge.', flags: MessageFlags.Ephemeral });
  }
  if (interaction.customId === 'va:mv') return deplacerEnAssistance(interaction, ligne);
  if (ligne.claim_par) {
    return interaction.reply({ content: `ℹ️ Déjà pris en charge par <@${ligne.claim_par}>.`, flags: MessageFlags.Ephemeral });
  }
  poserClaim.run(String(interaction.user.id), Date.now(), ligne.id);
  const corrige = parMessage.get(String(interaction.message.id));
  const { mettreAJour, suivre } = require('./reponse');
  const contenu = { embeds: [carteAttente(corrige)], components: [rangeeAttente(true)] };
  await mettreAJour(interaction, contenu);
  return suivre(interaction, {
    content: `🙋 C'est noté : déplacez <@${ligne.user_id}> dans un salon d'assistance pour clore le ticket — le bouton 📥 le fait pour vous.`,
    flags: MessageFlags.Ephemeral,
  });
}

// 📥 « Déplacer en assistance » : cherche un salon d'assistance VIDE et y
// déplace la personne — la clôture suit d'elle-même, par le mouvement vocal.
// Aucun salon libre ? Un membre du staff présent dans un des salons
// d'assistance, tiré au hasard, est prévenu en message privé.
async function deplacerEnAssistance(interaction, ligne) {
  const guild = interaction.guild;
  const cfg = getGuildConfig(guild.id);
  const ids = salonsAssistance(cfg);
  if (!ids.length) {
    return interaction.reply({
      content: '⚠️ Aucun salon d\'assistance configuré : faites `/vocal assistance` (ou `/config` → 🎧 Vocal).',
      flags: MessageFlags.Ephemeral,
    });
  }

  const attendant = await guild.members.fetch(ligne.user_id).catch(() => null);
  if (!attendant || String(attendant.voice?.channelId) !== String(cfg.vocal_attente_channel_id)) {
    return interaction.reply({
      content: `ℹ️ <@${ligne.user_id}> n'est plus dans le salon d'attente : rien à déplacer.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Les salons d'assistance, avec leurs occupants humains.
  const salons = [];
  for (const id of ids) {
    const salon = await guild.channels.fetch(id).catch(() => null);
    if (salon) salons.push(salon);
  }
  const humains = (salon) => [...(salon.members?.values?.() || [])].filter((m) => !m.user?.bot);
  const libre = salons.find((salon) => humains(salon).length === 0);

  if (libre) {
    const fait = await attendant.voice.setChannel(libre).then(() => true).catch(() => false);
    if (!fait) {
      return interaction.reply({
        content: '❌ Je n\'ai pas pu déplacer la personne : il me faut la permission **Déplacer les membres**.',
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({
      content: `📥 <@${ligne.user_id}> a été déplacé dans <#${libre.id}> — le ticket se clôt tout seul.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Tous occupés : on tire au sort un membre du staff présent en assistance.
  const staffs = salons.flatMap(humains).filter((m) => getGrade(m, cfg) >= GRADES.STAFF);
  if (!staffs.length) {
    return interaction.reply({
      content: '⚠️ Tous les salons d\'assistance sont occupés, et aucun membre du staff ne s\'y trouve à prévenir.',
      flags: MessageFlags.Ephemeral,
    });
  }
  const elu = staffs[Math.floor(Math.random() * staffs.length)];
  const mp = await elu.send(
    `🚨 Tous les salons d'assistance de **${guild.name}** sont occupés : **${attendant.displayName}** attend en vocal depuis **${duree(Date.now() - ligne.arrivee)}**.\n`
    + '➜ Libérez un salon, ou déplacez la personne dès que possible.'
  ).then(() => true).catch(() => false);
  return interaction.reply({
    content: mp
      ? `⚠️ Aucun salon d'assistance libre : j'ai prévenu <@${elu.id}> en message privé.`
      : `⚠️ Aucun salon d'assistance libre — et <@${elu.id}>, tiré au sort, a ses messages privés fermés. Voyez directement avec le staff en assistance.`,
    flags: MessageFlags.Ephemeral,
  });
}

// Au démarrage : chaque attente ouverte est remise en face de la réalité.
async function balayer(client) {
  let fermees = 0;
  for (const ligne of toutes.all()) {
    const guild = client.guilds.cache.get(ligne.guild_id);
    const cfg = guild ? getGuildConfig(guild.id) : null;
    const membre = guild ? await guild.members.fetch(ligne.user_id).catch(() => null) : null;
    const salonActuel = membre?.voice?.channelId ? String(membre.voice.channelId) : null;
    if (guild && salonActuel === String(cfg.vocal_attente_channel_id)) continue; // il attend toujours
    const aide = cfg ? salonsAssistance(cfg).includes(salonActuel) : false;
    if (guild) await editerCarte(client, ligne, aide ? 'aide' : 'parti');
    clore.run(Date.now(), ligne.id);
    fermees += 1;
  }
  return fermees;
}

function demarrer(client) {
  balayer(client).catch((err) => console.warn(`⚠️ Balayage des attentes vocales : ${err.message}`));
  // La purge tourne en fond : elle efface les tickets clos une fois leur
  // minute de lecture passée — y compris ceux clos avant un redémarrage.
  setInterval(() => {
    purgerCloses(client).catch((err) => console.warn(`⚠️ Purge des tickets vocaux : ${err.message}`));
  }, 30_000);
}

module.exports = {
  surveiller, handleBouton, balayer, demarrer, purgerCloses, DELAI_SUPPRESSION,
  carteAttente, rangeeAttente, duree, salonsAssistance, enAttente, parMessage,
};
