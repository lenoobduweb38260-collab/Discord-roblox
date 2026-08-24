const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  UserSelectMenuBuilder, ChannelType, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { staffRoleIds, getGrade, GRADES } = require('./permissions');
const { COLORS } = require('./embeds');
const M = require('./miseEnPage');

// 🎧 Les salons vocaux PERSONNELS — temporaires, et gérés par leur créateur.
//
// Un salon « créateur » est configuré par le staff. Quelqu'un s'y connecte :
// le bot crée un vocal à son pseudo, l'y déplace, et poste dans le chat du
// vocal une carte de gestion. Le salon disparaît tout seul quand il se vide.
//
// La carte pilote le salon par ses PERMISSIONS Discord — rien d'autre :
//  • 🎥 caméras & streams — chez Discord, une SEULE permission (« Vidéo »)
//    couvre les deux : un seul bouton, qui le dit ;
//  • 🪧 les statuts du salon (le petit texte au-dessus du vocal) ;
//  • 🔒 mode privé — tout le monde VOIT le salon, mais seuls le staff, la
//    whitelist et le propriétaire peuvent s'y connecter ;
//  • 🚫 blacklist — le salon est caché à la personne, connexion coupée,
//    et elle est déconnectée si elle s'y trouvait ;
//  • ✅ whitelist — connexion garantie, même en mode privé.
//
// La blacklist et la whitelist VIVENT dans les permissions du salon : rien à
// stocker, rien à désynchroniser — supprimer le salon efface tout.

const inserer = db.prepare('INSERT OR REPLACE INTO salons_perso (guild_id, channel_id, owner_id, at) VALUES (?, ?, ?, ?)');
const parSalon = db.prepare('SELECT * FROM salons_perso WHERE channel_id = ?');
const effacer = db.prepare('DELETE FROM salons_perso WHERE channel_id = ?');
const duServeur = db.prepare('SELECT * FROM salons_perso WHERE guild_id = ?');
const tous = db.prepare('SELECT * FROM salons_perso');

// ── La carte de gestion, postée dans le chat du vocal ─────────────

function carteGestion(ownerId) {
  return new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('🎧 Votre salon personnel')
    .setDescription(M.description([
      `<@${ownerId}>, ce salon est à vous : il disparaîtra tout seul quand il se videra.`,
      M.bloc('Les commandes du salon', [
        '🎥 **Caméras & streams** — les couper ou les réautoriser *(une seule permission chez Discord)*',
        '🪧 **Statuts** — empêcher (ou permettre) de poser un statut sur le salon',
        '🔒 **Mode privé** — tout le monde voit le salon, seuls le staff et votre whitelist s\'y connectent',
        '🚫 **Blacklist** — cacher le salon à quelqu\'un et lui couper la connexion',
        '✅ **Whitelist** — garantir la connexion à quelqu\'un, même en privé',
      ], { prefixe: '🎛️', compte: null }),
      '-# Seuls vous et le staff pouvez utiliser ces boutons.',
    ]));
}

const rangeesGestion = () => [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vp:cam').setLabel('Caméras & streams').setEmoji('🎥').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vp:statut').setLabel('Statuts').setEmoji('🪧').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vp:prive').setLabel('Mode privé').setEmoji('🔒').setStyle(ButtonStyle.Primary)
  ),
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vp:bl').setLabel('Blacklist').setEmoji('🚫').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('vp:wl').setLabel('Whitelist').setEmoji('✅').setStyle(ButtonStyle.Success)
  ),
];

// ── Naissance et mort d'un salon ──────────────────────────────────

// Quelqu'un vient d'entrer dans un vocal : si c'est le salon créateur, on
// lui fabrique le sien et on l'y emmène.
async function accueillir(newState) {
  const guild = newState.guild;
  const membre = newState.member;
  if (!membre || membre.user.bot) return null;
  const cfg = getGuildConfig(guild.id);
  if (!cfg.vocal_perso_createur_id || String(newState.channelId) !== String(cfg.vocal_perso_createur_id)) return null;

  const moi = guild.members.me;
  if (!moi?.permissions?.has(PermissionFlagsBits.ManageChannels) || !moi?.permissions?.has(PermissionFlagsBits.MoveMembers)) {
    console.warn(`⚠️ Salon perso impossible sur ${guild.name} : il me faut « Gérer les salons » et « Déplacer les membres ».`);
    return null;
  }

  const createur = newState.channel;
  const nom = `🔊 ${membre.displayName || membre.user.username}`.slice(0, 90);
  const salon = await guild.channels.create({
    name: nom,
    type: ChannelType.GuildVoice,
    parent: createur?.parentId ?? null,
    reason: `Salon personnel de ${membre.user.tag || membre.user.username}`,
    // Le propriétaire garde TOUJOURS l'accès : le mode privé et la
    // blacklist ne doivent jamais l'enfermer dehors.
    permissionOverwrites: [
      { id: membre.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
    ],
  }).catch((err) => {
    console.warn(`⚠️ Création du salon perso impossible : ${err.message}`);
    return null;
  });
  if (!salon) return null;

  inserer.run(String(guild.id), String(salon.id), String(membre.id), new Date().toISOString());

  const deplace = await membre.voice.setChannel(salon).then(() => true).catch(() => false);
  if (!deplace) {
    // Personne dedans, personne à venir : on ne laisse pas un salon fantôme.
    await salon.delete('Déplacement impossible').catch(() => null);
    effacer.run(String(salon.id));
    return null;
  }

  await salon.send({ embeds: [carteGestion(membre.id)], components: rangeesGestion() }).catch(() => null);
  return salon;
}

// Quelqu'un vient de quitter un vocal : si c'était un salon perso et qu'il
// est vide, il disparaît.
async function verifierDepart(oldState) {
  const ligne = parSalon.get(String(oldState.channelId));
  if (!ligne) return null;
  const salon = oldState.channel
    || await oldState.guild.channels.fetch(String(oldState.channelId)).catch(() => null);
  if (!salon) { effacer.run(String(oldState.channelId)); return null; }
  if ((salon.members?.size ?? 0) > 0) return null;
  await salon.delete('Salon personnel vidé').catch(() => null);
  effacer.run(String(salon.id));
  return true;
}

// Au démarrage : les salons vidés (ou supprimés) pendant que le bot dormait.
async function balayer(client) {
  let fermes = 0;
  for (const ligne of tous.all()) {
    const guild = client.guilds.cache.get(ligne.guild_id);
    const salon = guild ? await guild.channels.fetch(ligne.channel_id).catch(() => null) : null;
    if (!salon) { effacer.run(ligne.channel_id); continue; }
    if ((salon.members?.size ?? 0) === 0) {
      await salon.delete('Salon personnel vidé (rattrapage)').catch(() => null);
      effacer.run(ligne.channel_id);
      fermes += 1;
    }
  }
  return fermes;
}

function demarrer(client) {
  balayer(client).catch((err) => console.warn(`⚠️ Balayage des salons perso : ${err.message}`));
}

// ── Les boutons de la carte ───────────────────────────────────────

// Le salon d'un clic, et le droit d'y toucher : le propriétaire, ou le staff.
function salonAutorise(interaction) {
  const ligne = parSalon.get(String(interaction.channelId));
  if (!ligne) return { refus: '❌ Ce salon n\'est pas (ou plus) un salon personnel.' };
  const estProprio = String(interaction.user.id) === ligne.owner_id;
  if (!estProprio && getGrade(interaction.member) < GRADES.STAFF) {
    return { refus: `⛔ Seul <@${ligne.owner_id}> — ou le staff — peut gérer ce salon.` };
  }
  return { ligne, salon: interaction.channel };
}

// L'état actuel d'une permission de @everyone sur le salon.
function everyoneBloque(salon, permission) {
  const surcharge = salon.permissionOverwrites?.cache?.get?.(salon.guild.roles.everyone.id);
  return Boolean(surcharge?.deny?.has?.(permission));
}

async function handleBouton(interaction) {
  const { refus, ligne, salon } = salonAutorise(interaction);
  if (refus) return interaction.reply({ content: refus, flags: MessageFlags.Ephemeral }).catch(() => null);
  const geste = interaction.customId.split(':')[1];
  const everyone = salon.guild.roles.everyone;

  if (geste === 'cam') {
    const bloque = everyoneBloque(salon, PermissionFlagsBits.Stream);
    await salon.permissionOverwrites.edit(everyone, { Stream: bloque ? null : false });
    return interaction.reply({
      content: bloque
        ? '🎥 Caméras et streams **réautorisés** dans ce salon.'
        : '🎥 Caméras et streams **coupés** dans ce salon.\n-# Chez Discord, une seule permission (« Vidéo ») couvre les deux.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (geste === 'statut') {
    const bloque = everyoneBloque(salon, PermissionFlagsBits.SetVoiceChannelStatus);
    await salon.permissionOverwrites.edit(everyone, { SetVoiceChannelStatus: bloque ? null : false });
    return interaction.reply({
      content: bloque
        ? '🪧 Les statuts du salon sont **de nouveau permis**.'
        : '🪧 Plus personne ne peut poser de **statut** sur ce salon.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (geste === 'prive') {
    const prive = everyoneBloque(salon, PermissionFlagsBits.Connect);
    if (prive) {
      await salon.permissionOverwrites.edit(everyone, { Connect: null });
      return interaction.reply({ content: '🔓 Mode privé **coupé** : tout le monde peut se reconnecter.', flags: MessageFlags.Ephemeral });
    }
    // Visible par tous, connexion coupée — puis le STAFF regagne la porte.
    await salon.permissionOverwrites.edit(everyone, { Connect: false });
    for (const roleId of staffRoleIds(getGuildConfig(salon.guild.id))) {
      await salon.permissionOverwrites.edit(roleId, { ViewChannel: true, Connect: true }).catch(() => null);
    }
    return interaction.reply({
      content: '🔒 Mode privé **activé** : le salon reste visible, mais seuls vous, le staff et votre whitelist peuvent s\'y connecter.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (geste === 'bl' || geste === 'wl') {
    const menu = new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(geste === 'bl' ? 'vp:blsel' : 'vp:wlsel')
        .setPlaceholder(geste === 'bl' ? 'Qui blacklister de ce salon ?' : 'Qui whitelister sur ce salon ?')
        .setMinValues(1)
        .setMaxValues(10)
    );
    return interaction.reply({
      content: geste === 'bl'
        ? '🚫 Choisissez qui **blacklister** : le salon lui sera caché, connexion coupée — et la personne est déconnectée si elle s\'y trouve.'
        : '✅ Choisissez qui **whitelister** : la connexion lui sera garantie, même en mode privé.',
      components: [menu],
      flags: MessageFlags.Ephemeral,
    });
  }
  return null;
}

async function handleMenu(interaction) {
  const { refus, ligne, salon } = salonAutorise(interaction);
  if (refus) return interaction.reply({ content: refus, flags: MessageFlags.Ephemeral }).catch(() => null);
  const geste = interaction.customId.split(':')[1];
  const vises = (interaction.values || []).map(String);
  const faits = [];
  const refuses = [];

  for (const userId of vises) {
    if (geste === 'blsel') {
      // Ni le propriétaire, ni un membre du staff : la blacklist ne doit pas
      // servir à enfermer ceux qui gèrent.
      if (userId === ligne.owner_id) { refuses.push(`<@${userId}> — c'est le propriétaire du salon`); continue; }
      const membre = await salon.guild.members.fetch(userId).catch(() => null);
      if (membre && getGrade(membre) >= GRADES.STAFF) { refuses.push(`<@${userId}> — membre du staff`); continue; }
      await salon.permissionOverwrites.edit(userId, { ViewChannel: false, Connect: false }).catch(() => null);
      if (membre?.voice?.channelId === salon.id) await membre.voice.setChannel(null).catch(() => null);
      faits.push(`<@${userId}>`);
    } else {
      await salon.permissionOverwrites.edit(userId, { ViewChannel: true, Connect: true }).catch(() => null);
      faits.push(`<@${userId}>`);
    }
  }

  const lignes = [];
  if (faits.length) {
    lignes.push(geste === 'blsel'
      ? `🚫 Blacklisté(s) du salon : ${faits.join(', ')}.`
      : `✅ Whitelisté(s) sur le salon : ${faits.join(', ')}.`);
  }
  if (refuses.length) lignes.push(`⚠️ Non traité(s) : ${refuses.join(' · ')}.`);
  const { mettreAJour } = require('./reponse');
  return mettreAJour(interaction, { content: lignes.join('\n') || 'ℹ️ Rien à faire.', components: [] });
}

module.exports = {
  accueillir, verifierDepart, balayer, demarrer, handleBouton, handleMenu,
  carteGestion, rangeesGestion, salonAutorise, everyoneBloque, parSalon, duServeur,
};
