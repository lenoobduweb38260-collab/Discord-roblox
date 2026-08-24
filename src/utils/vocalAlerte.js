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
// Tout survit à un redémarrage : les attentes vivent en base, et le
// démarrage remet chaque carte en face de la réalité du salon.

const ouvrir = db.prepare(
  'INSERT INTO attentes_vocales (guild_id, user_id, channel_id, message_id, arrivee) VALUES (?, ?, ?, ?, ?)'
);
const poserMessage = db.prepare('UPDATE attentes_vocales SET channel_id = ?, message_id = ? WHERE rowid = ?');
const poserClaim = db.prepare('UPDATE attentes_vocales SET claim_par = ?, claim_a = ? WHERE rowid = ?');
const enAttente = db.prepare('SELECT rowid AS id, * FROM attentes_vocales WHERE guild_id = ? AND user_id = ?');
const parMessage = db.prepare('SELECT rowid AS id, * FROM attentes_vocales WHERE message_id = ?');
const fermer = db.prepare('DELETE FROM attentes_vocales WHERE rowid = ?');
const toutes = db.prepare('SELECT rowid AS id, * FROM attentes_vocales');

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

const rangeeAttente = (claim = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('va:claim')
    .setLabel(claim ? 'Déjà pris en charge' : 'Prendre en charge')
    .setEmoji('🙋').setStyle(claim ? ButtonStyle.Secondary : ButtonStyle.Primary)
    .setDisabled(Boolean(claim))
);

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
      await editerCarte(oldState.client ?? newState.client ?? membre.client, ligne, aide ? 'aide' : 'parti');
      fermer.run(ligne.id);
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
      await editerCarte(newState.client ?? oldState.client ?? membre.client, restant, 'parti');
      fermer.run(restant.id);
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

// 🙋 Le bouton « Prendre en charge » — staff uniquement.
async function handleBouton(interaction) {
  const ligne = parMessage.get(String(interaction.message?.id));
  if (!ligne) {
    return interaction.reply({ content: 'ℹ️ Ce ticket d\'attente est déjà terminé.', flags: MessageFlags.Ephemeral }).catch(() => null);
  }
  if (getGrade(interaction.member) < GRADES.STAFF) {
    return interaction.reply({ content: '⛔ Seul le **staff** peut prendre une attente en charge.', flags: MessageFlags.Ephemeral });
  }
  if (ligne.claim_par) {
    return interaction.reply({ content: `ℹ️ Déjà pris en charge par <@${ligne.claim_par}>.`, flags: MessageFlags.Ephemeral });
  }
  poserClaim.run(String(interaction.user.id), Date.now(), ligne.id);
  const corrige = parMessage.get(String(interaction.message.id));
  const { mettreAJour, suivre } = require('./reponse');
  const contenu = { embeds: [carteAttente(corrige)], components: [rangeeAttente(true)] };
  await mettreAJour(interaction, contenu);
  return suivre(interaction, {
    content: `🙋 C'est noté : déplacez <@${ligne.user_id}> dans un salon d'assistance pour clore le ticket.`,
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
    fermer.run(ligne.id);
    fermees += 1;
  }
  return fermees;
}

function demarrer(client) {
  balayer(client).catch((err) => console.warn(`⚠️ Balayage des attentes vocales : ${err.message}`));
}

module.exports = {
  surveiller, handleBouton, balayer, demarrer,
  carteAttente, rangeeAttente, duree, salonsAssistance, enAttente, parMessage,
};
