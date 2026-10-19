// ⚙️ /config → ⚔️ Aventure SAO (préfixe de composants `cfgsao:`).
//
// Cinq rangées au plus :
//   1. interrupteurs : module, duels, AFK, et la fenêtre des valeurs chiffrées
//   2. le salon des raids
//   3. la difficulté
//   4. réinitialiser un joueur (ADMIN, avec confirmation)
//   5. retour au panneau · réinitialiser tout le serveur (ADMIN, confirmation)
//
// Les interrupteurs historiques `cfgsaoon` / `cfgsaooff` de la vue
// Communauté restent en place : ils écrivent la même colonne.

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, StringSelectMenuBuilder,
  UserSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const { setGuildConfig, db } = require('../../database');
const { COLORS, sendLog, logEmbed } = require('../embeds');
const { GRADES } = require('../permissions');
const { mettreAJour } = require('../reponse');
const M = require('../miseEnPage');
const F = require('./formules');
const G = require('../saoGame');

const compterStmt = db.prepare('SELECT COUNT(*) AS n FROM sao_players WHERE guild_id = ?');

// Les réglages chiffrés de la fenêtre : clé, libellé, bornes.
const VALEURS = [
  { champ: 'raid', cle: 'sao_raid_heures', libelle: 'Raid : toutes les N heures (0 = aucun)', min: 0, max: 168, lire: (R) => R.raidHeures },
  { champ: 'chasse', cle: 'sao_chasse_delai', libelle: 'Délai entre deux chasses, en secondes', min: 5, max: 300, lire: (R) => R.chasseDelai },
  { champ: 'afk', cle: 'sao_afk_heures', libelle: 'Plafond de l\'AFK, en heures (1 à 24)', min: 1, max: 24, lire: (R) => R.afkHeures },
  { champ: 'mort', cle: 'sao_mort_penalite', libelle: 'Col perdus à la mort, en % (0 à 50)', min: 0, max: 50, lire: (R) => R.mortPenalite },
];

function retour() {
  return new ButtonBuilder().setCustomId('cfgback').setLabel('⬅ Retour au panneau').setStyle(ButtonStyle.Secondary);
}

function saoConfigView(guild, { confirmer = null, message = null } = {}) {
  const R = G.reglagesSao(guild.id);
  const D = F.DIFFICULTES[R.difficulte];
  const oui = (b) => (b ? '🟢 activé' : '🔴 coupé');
  const embed = new EmbedBuilder()
    .setColor(R.actif ? COLORS.PRIMARY : COLORS.DANGER)
    .setTitle('⚔️ Configuration — Aventure SAO')
    .setDescription(M.description([
      message,
      M.bloc('Réglages', [
        `⚔️ Module : ${R.actif ? '🟢 **activé**' : '🔴 **désactivé**'} · ${M.pluriel(compterStmt.get(guild.id)?.n || 0, 'aventurier')}`,
        `🐲 Raids : ${R.salonRaid ? `<#${R.salonRaid}>` : '*aucun salon*'} · ${R.raidHeures ? `toutes les **${R.raidHeures} h**` : '**coupés** (0 h)'}`,
        `🤺 Duels : ${oui(R.pvp)} — toujours sur acceptation, sans perte de Col`,
        `🗡️ Délai de chasse : **${R.chasseDelai} s**`,
        `😴 AFK : ${oui(R.afk)} · plafond **${R.afkHeures} h** — ne compte que le temps sans jouer`,
        `🪦 Mort : **${R.mortPenalite} %** des Col (la moitié pour une fuite sans cristal)`,
        `🎚️ Difficulté : ${D.emoji} **${D.nom}** — ennemis ×${D.ennemi}, gains ×${D.gains}`,
      ], { prefixe: '⚙️', compte: null }),
      '-# 🧹 Réinitialiser efface le personnage, le sac, les quêtes et les combats. Réservé à l\'administration.',
    ]));

  if (confirmer) {
    const cible = confirmer.type === 'joueur' ? `le personnage de <@${confirmer.userId}>` : '**TOUS les personnages de ce serveur**, ses raids et ses coffres';
    embed.setColor(COLORS.WARNING).setDescription(M.description([
      `⚠️ **Confirmer la réinitialisation ?**\nCela efface ${cible}. C'est définitif.`,
      confirmer.type === 'joueur' ? '💞 Son coffre de couple éventuel est d\'abord partagé à parts égales avec son conjoint.' : null,
    ]));
    return {
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(confirmer.type === 'joueur' ? `cfgsao:okj:${confirmer.userId}` : 'cfgsao:okt')
          .setLabel(confirmer.type === 'joueur' ? 'Oui, effacer ce joueur' : 'Oui, tout effacer')
          .setEmoji('🧨').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cfgsao:annule').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
      )],
    };
  }

  const salon = new ChannelSelectMenuBuilder()
    .setCustomId('cfgsao:salon')
    .setPlaceholder('🐲 Salon où surgissent les boss de raid')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(1);
  if (R.salonRaid) salon.setDefaultChannels(R.salonRaid);
  const diff = new StringSelectMenuBuilder()
    .setCustomId('cfgsao:diff')
    .setPlaceholder('🎚️ Difficulté')
    .addOptions(Object.entries(F.DIFFICULTES).map(([cle, d]) => ({
      label: d.nom, value: cle, emoji: d.emoji, default: cle === R.difficulte,
      description: `Ennemis ×${d.ennemi}, gains ×${d.gains}`,
    })));
  const joueur = new UserSelectMenuBuilder()
    .setCustomId('cfgsao:rzj')
    .setPlaceholder('🧹 Réinitialiser un joueur… (administration)')
    .setMinValues(1)
    .setMaxValues(1);
  const bascule = (id, on, labelOn, labelOff, emoji) => new ButtonBuilder()
    .setCustomId(id).setLabel(on ? labelOn : labelOff).setEmoji(emoji).setStyle(on ? ButtonStyle.Secondary : ButtonStyle.Success);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        bascule('cfgsao:module', R.actif, 'Couper SAO', 'Activer SAO', '⚔️'),
        bascule('cfgsao:pvp', R.pvp, 'Couper les duels', 'Autoriser les duels', '🤺'),
        bascule('cfgsao:afk', R.afk, 'Couper l\'AFK', 'Activer l\'AFK', '😴'),
        new ButtonBuilder().setCustomId('cfgsao:valeurs').setLabel('Valeurs…').setEmoji('🔢').setStyle(ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(salon),
      new ActionRowBuilder().addComponents(diff),
      new ActionRowBuilder().addComponents(joueur),
      new ActionRowBuilder().addComponents(
        retour(),
        new ButtonBuilder().setCustomId('cfgsao:rzt').setLabel('Réinitialiser le serveur').setEmoji('🧨').setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

function modalValeurs(guildId) {
  const R = G.reglagesSao(guildId);
  return new ModalBuilder()
    .setCustomId('cfgsao:modal')
    .setTitle('⚔️ Aventure SAO — valeurs')
    .addComponents(...VALEURS.map((v) => new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(v.champ).setLabel(v.libelle).setStyle(TextInputStyle.Short)
        .setRequired(true).setMaxLength(3).setValue(String(v.lire(R))),
    )));
}

const journal = (interaction, texte, couleur = COLORS.INFO) =>
  sendLog(interaction.guild, logEmbed('⚔️ Aventure SAO — configuration', `${texte}\nPar <@${interaction.user.id}>`, couleur));

async function refuserNonAdmin(interaction) {
  return interaction.reply({ content: '⛔ Sécurité : réinitialiser des personnages est réservé à l\'**administration**.', flags: MessageFlags.Ephemeral });
}

async function gererConfigSao(interaction, grade) {
  const [, action, arg] = interaction.customId.split(':');
  const g = interaction.guildId;
  const R = G.reglagesSao(g);
  const vue = (opts) => mettreAJour(interaction, saoConfigView(interaction.guild, opts));

  if (action === 'module' || action === 'pvp' || action === 'afk') {
    const cle = { module: 'sao_enabled', pvp: 'sao_pvp', afk: 'sao_afk' }[action];
    const actuel = { module: R.actif, pvp: R.pvp, afk: R.afk }[action];
    setGuildConfig(g, cle, actuel ? 0 : 1);
    await vue();
    const quoi = { module: 'Module', pvp: 'Duels', afk: 'AFK' }[action];
    return journal(interaction, `${quoi} ${actuel ? 'coupé' : 'activé'}.`, actuel ? COLORS.DANGER : COLORS.SUCCESS);
  }
  if (action === 'valeurs') return interaction.showModal(modalValeurs(g));
  if (action === 'modal') {
    const lus = {};
    for (const v of VALEURS) {
      const n = parseInt(interaction.fields.getTextInputValue(v.champ), 10);
      if (Number.isNaN(n)) {
        return interaction.reply({ content: `❌ « ${v.libelle} » : un nombre entre ${v.min} et ${v.max}, s'il te plaît.`, flags: MessageFlags.Ephemeral });
      }
      lus[v.cle] = Math.min(v.max, Math.max(v.min, n));
    }
    for (const [cle, n] of Object.entries(lus)) setGuildConfig(g, cle, n);
    if (interaction.isFromMessage?.()) await vue();
    else await interaction.reply({ content: '✅ Valeurs de l\'Aventure SAO enregistrées.', flags: MessageFlags.Ephemeral });
    return journal(interaction, `Raids toutes les **${lus.sao_raid_heures} h**, chasse **${lus.sao_chasse_delai} s**, AFK **${lus.sao_afk_heures} h**, mort **${lus.sao_mort_penalite} %**.`);
  }
  if (action === 'salon') {
    const salon = interaction.values?.[0] || null;
    setGuildConfig(g, 'sao_salon_id', salon);
    await vue();
    return journal(interaction, `🐲 Salon des raids → ${salon ? `<#${salon}>` : '*aucun*'}`);
  }
  if (action === 'diff') {
    const cle = interaction.values?.[0];
    if (!F.DIFFICULTES[cle]) return vue();
    setGuildConfig(g, 'sao_difficulte', cle);
    await vue();
    return journal(interaction, `🎚️ Difficulté → **${F.DIFFICULTES[cle].nom}**`);
  }
  if (action === 'annule') return vue();
  if (action === 'rzj') {
    if (grade < GRADES.ADMIN) return refuserNonAdmin(interaction);
    return vue({ confirmer: { type: 'joueur', userId: interaction.values?.[0] } });
  }
  if (action === 'rzt') {
    if (grade < GRADES.ADMIN) return refuserNonAdmin(interaction);
    return vue({ confirmer: { type: 'serveur' } });
  }
  if (action === 'okj') {
    if (grade < GRADES.ADMIN) return refuserNonAdmin(interaction);
    const r = G.reinitialiserJoueurSao(g, arg);
    await vue({ message: r.existait ? `🧹 Le personnage de <@${arg}> a été effacé.` : `ℹ️ <@${arg}> n'avait pas de personnage ici : rien à effacer.` });
    return journal(interaction, `🧹 Personnage de <@${arg}> réinitialisé.`, COLORS.WARNING);
  }
  if (action === 'okt') {
    if (grade < GRADES.ADMIN) return refuserNonAdmin(interaction);
    const r = G.reinitialiserServeurSao(g);
    await vue({ message: `🧨 Aventure remise à zéro : ${M.pluriel(r.joueurs, 'personnage')} effacé${r.joueurs > 1 ? 's' : ''}.` });
    return journal(interaction, `🧨 Aventure SAO réinitialisée (${M.pluriel(r.joueurs, 'personnage')}).`, COLORS.DANGER);
  }
  return null;
}

module.exports = { saoConfigView, gererConfigSao, modalValeurs, VALEURS_SAO: VALEURS };
