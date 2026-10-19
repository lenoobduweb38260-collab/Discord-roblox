const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../database');
const { COLORS, sendLog, logEmbed } = require('./embeds');
const { mettreAJour, suivre } = require('./reponse');
const M = require('./miseEnPage');
const C = require('./comptage');
const { GRADES, getGrade } = require('./permissions');

// ⚙️ /config → 🔢 Comptage.
//
// Branché dans configPanel.js : la catégorie `comptage` du menu `cfgcat` et
// tout identifiant `cfgcpt:…` arrivent ici (garde STAFF déjà faite par
// handleConfigInteraction). Quatre rangées sur cinq :
//   1. le salon (vide = comptage coupé)
//   2. les bascules + le formulaire d'XP
//   3. le rôle d'erreur (vide = aucun)
//   4. retour / remise à zéro (ou sa confirmation)

// Bouton → colonne. Les libellés restent courts : cinq boutons par rangée.
const BASCULES_COMPTAGE = {
  meme: { cle: 'comptage_meme_personne', libelle: '2× de suite', emoji: '🔁', dire: 'Compter deux fois de suite' },
  maths: { cle: 'comptage_maths', libelle: 'Calculs', emoji: '🧮', dire: 'Calculs acceptés' },
  reac: { cle: 'comptage_reactions', libelle: 'Réactions', emoji: '✅', dire: 'Réactions ✅ 💯 🏆 ❌' },
  suppr: { cle: 'comptage_supprimer', libelle: 'Effacer hors-jeu', emoji: '🧹', dire: 'Suppression des messages hors-jeu' },
};
const ETAT_BASCULE = {
  meme: (R) => R.memePersonne, maths: (R) => R.maths, reac: (R) => R.reactions, suppr: (R) => R.supprimer,
};

const marque = (on) => (on ? '🟢' : '🔴');

// 🩺 Ce qui me manque dans le salon pour appliquer les règles choisies.
// Sans ce diagnostic, une réaction ou un effacement refusé échoue sans un
// mot, et le staff croit le réglage cassé.
function permissionsManquantesComptage(guild, R) {
  const moi = guild.members?.me;
  if (!R.salon || typeof moi?.permissionsIn !== 'function') return [];
  let droits;
  try {
    droits = moi.permissionsIn(R.salon);
  } catch {
    return [];
  }
  const { PermissionFlagsBits: P } = require('discord.js');
  const manque = [];
  const verifier = (bit, quoi) => { if (bit !== undefined && !droits?.has?.(bit)) manque.push(quoi); };
  verifier(P.SendMessages, 'Envoyer des messages');
  if (R.reactions) {
    verifier(P.AddReactions, 'Ajouter des réactions');
    verifier(P.ReadMessageHistory, 'Voir les anciens messages');
  }
  if (R.supprimer) verifier(P.ManageMessages, 'Gérer les messages');
  if (R.roleErreur) verifier(P.ManageRoles, 'Gérer les rôles');
  return manque;
}

function vueConfigComptage(guild, { confirmer = false } = {}) {
  const cfg = getGuildConfig(guild.id);
  const R = C.reglagesComptage(cfg);
  const e = C.etatComptage(guild.id);
  const courant = C.nombreActuelComptage(guild.id, R.salon);

  const blocs = [
    M.bloc('Salon', R.salon ? [`<#${R.salon}> — une erreur remet le compte à **0**.`] : [], {
      prefixe: '📍', compte: null, vide: 'Aucun : le comptage est coupé. Choisissez un salon ci-dessous.',
    }),
    M.bloc('État actuel', [
      M.statistique('Nombre actuel', courant),
      M.statistique('Prochain', courant + 1),
      M.statistique('Record', e.record || 0, e.record && e.record_le ? `le <t:${Math.floor(new Date(e.record_le).getTime() / 1000)}:D>` : null),
      M.statistique('Séries cassées', e.erreurs || 0),
    ], { prefixe: '📊', compte: null }),
    M.bloc('Règles', [
      ...Object.entries(BASCULES_COMPTAGE).map(([k, b]) => `${marque(ETAT_BASCULE[k](R))} ${b.dire}`),
      `🎭 Rôle d'erreur : ${R.roleErreur ? `<@&${R.roleErreur}>` : '*aucun*'}`,
      `✨ XP par bon nombre : ${R.xp ? `**${R.xp}**` : '*aucune*'}`,
    ], { prefixe: '⚙️', compte: null }),
  ];
  const manque = permissionsManquantesComptage(guild, R);
  if (manque.length) {
    blocs.push(M.bloc('Il me manque des permissions', [
      `Dans <#${R.salon}> : ${manque.map((p) => `**${p}**`).join(', ')}.`,
      'Ajoutez-les à mon rôle, ou dans les permissions du salon.',
    ], { prefixe: '⚠️', compte: null }));
  }
  if (confirmer) {
    blocs.push(M.bloc('Remise à zéro', [
      'Le compte repart de **0** et le **record** est effacé.',
      'Le classement des compteurs est conservé.',
    ], { prefixe: '⚠️', compte: null }));
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🔢 Configuration — Comptage')
    .setDescription(M.borner(M.description(blocs), M.MAX_DESCRIPTION));

  const menuSalon = new ChannelSelectMenuBuilder()
    .setCustomId('cfgcpt:salon')
    .setPlaceholder('🔢 Le salon de comptage (vide = coupé)')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(1);
  if (R.salon) menuSalon.setDefaultChannels(R.salon);

  const bascules = new ActionRowBuilder().addComponents(
    ...Object.entries(BASCULES_COMPTAGE).map(([k, b]) => {
      const on = ETAT_BASCULE[k](R);
      return new ButtonBuilder().setCustomId(`cfgcpt:b:${k}`).setLabel(b.libelle).setEmoji(b.emoji)
        .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);
    }),
    new ButtonBuilder().setCustomId('cfgcpt:xp').setLabel(`XP : ${R.xp}`).setEmoji('✨').setStyle(ButtonStyle.Primary)
  );

  const menuRole = new RoleSelectMenuBuilder()
    .setCustomId('cfgcpt:role')
    .setPlaceholder('🎭 Rôle donné à qui casse la série (vide = aucun)')
    .setMinValues(0)
    .setMaxValues(1);
  if (R.roleErreur) menuRole.setDefaultRoles(R.roleErreur);

  const bas = confirmer
    ? new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cfgcpt:razok').setLabel('Oui, remettre à zéro').setEmoji('🔄').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cfgcpt:vue').setLabel('Annuler').setStyle(ButtonStyle.Secondary)
    )
    : new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cfgback').setLabel('⬅ Retour au panneau').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cfgcpt:raz').setLabel('Remettre à zéro').setEmoji('🔄').setStyle(ButtonStyle.Danger)
        .setDisabled(!courant && !e.record && !e.erreurs)
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menuSalon),
      bascules,
      new ActionRowBuilder().addComponents(menuRole),
      bas,
    ],
  };
}

function modalXpComptage(cfg) {
  const R = C.reglagesComptage(cfg);
  return new ModalBuilder()
    .setCustomId('cfgcpt:xpmodal')
    .setTitle('✨ XP du comptage')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('xp').setLabel(`XP par bon nombre (0 à ${C.XP_MAX_COMPTAGE}, 0 = aucune)`)
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setValue(String(R.xp))
    ));
}

const journal = (interaction, ligne) => sendLog(interaction.guild,
  logEmbed('⚙️ Configuration modifiée', `${ligne}\nPar <@${interaction.user.id}>`, COLORS.INFO));

// Tous les identifiants `cfgcpt:…`. Renvoie toujours après avoir répondu.
async function gererConfigComptage(interaction) {
  const action = interaction.customId.slice('cfgcpt:'.length);
  const guild = interaction.guild;
  const guildId = interaction.guildId;
  const vue = (options) => vueConfigComptage(guild, options);

  if (action === 'vue') return mettreAJour(interaction, vue());

  if (action === 'salon') {
    const avant = C.reglagesComptage(getGuildConfig(guildId)).salon;
    const salonId = interaction.values?.[0] ? String(interaction.values[0]) : null;
    // Comptage coupé : le dernier fautif n'a plus à porter le rôle d'erreur.
    // La base change tout de suite ; le retrait (réseau) s'attend APRÈS la
    // réponse, qui n'a que trois secondes.
    const retrait = !salonId && avant ? C.retirerRoleFautifComptage(guild) : null;
    setGuildConfig(guildId, 'comptage_channel_id', salonId);
    // Changer de salon remet le compte à 0 (record et classement gardés).
    if (salonId !== avant) C.changerSalonComptage(guildId, salonId);
    await mettreAJour(interaction, vue());
    await retrait;
    if (salonId && salonId !== avant) {
      await C.annoncerComptage(guild, salonId, C.ANNONCE_SALON_COMPTAGE);
    }
    await journal(interaction, `🔢 Salon de comptage → ${salonId ? `<#${salonId}>` : '*aucun (comptage coupé)*'}`);
    return;
  }

  if (action.startsWith('b:')) {
    const b = BASCULES_COMPTAGE[action.slice(2)];
    if (!b) return mettreAJour(interaction, vue());
    const R = C.reglagesComptage(getGuildConfig(guildId));
    const suivant = ETAT_BASCULE[action.slice(2)](R) ? 0 : 1;
    setGuildConfig(guildId, b.cle, suivant);
    await mettreAJour(interaction, vue());
    await journal(interaction, `🔢 Comptage — ${b.dire} → ${suivant ? 'activé' : 'désactivé'}`);
    return;
  }

  if (action === 'role') {
    const roleId = interaction.values?.[0] ? String(interaction.values[0]) : null;
    const refuser = async (content) => {
      await mettreAJour(interaction, vue());
      return suivre(interaction, { content, flags: MessageFlags.Ephemeral });
    };
    // 🔒 Le bot donne ce rôle TOUT SEUL à qui casse la série : le choisir,
    // c'est pouvoir se le faire donner en postant deux nombres. Réservé à
    // l'administration — un staff s'offrait ainsi un rôle « Administrateur ».
    if (getGrade(interaction.member) < GRADES.ADMIN) {
      return refuser('⛔ Le rôle d\'erreur du comptage est réservé à l\'**administration** : le bot le donne de lui-même à qui casse la série.\n➜ Demandez à un administrateur de le choisir.');
    }
    const role = roleId ? guild.roles?.cache?.get(roleId) : null;
    const moi = guild.members?.me;
    // Un rôle que je ne peux pas donner ne servirait à rien : le dire ici
    // évite de chercher pourquoi personne ne le reçoit.
    if (role && (role.managed || (moi && role.position >= moi.roles.highest.position))) {
      return refuser(role.managed
        ? `❌ **${role.name}** est géré par une intégration : il ne s'attribue pas à la main.`
        : `❌ **${role.name}** est au-dessus de mon rôle : je ne pourrai pas le donner.\n➜ Remontez mon rôle dans **Paramètres du serveur → Rôles**, puis réessayez.`);
    }
    // Aucun pouvoir : un rôle d'erreur sanctionne, il n'élève personne.
    const sensibles = role ? C.permissionsSensiblesRole(role) : [];
    if (sensibles.length) {
      return refuser(`❌ **${role.name}** porte des permissions sensibles : ${sensibles.join(', ')}.\n`
        + '➜ Le bot le donnerait à n\'importe qui casse la série : choisissez un rôle sans aucun pouvoir de modération.');
    }
    // Ni un rôle staff ou admin du bot : sans la moindre permission Discord,
    // il donne déjà accès à /ban, /kick, /mute.
    const duBot = role ? C.roleDuBotComptage(guildId, role.id) : null;
    if (duBot) {
      return refuser(`❌ **${role.name}** : ${duBot}.\n`
        + '➜ Le bot le donnerait, avec son grade, à n\'importe qui casse la série : choisissez un rôle sans aucun pouvoir.');
    }
    // Ni au-dessus de celui qui règle : le bot ne distribue pas, à sa
    // place, un rôle qu'il ne pourrait pas donner lui-même.
    const haut = interaction.member?.roles?.highest?.position;
    if (role && interaction.user.id !== guild.ownerId && Number.isFinite(haut) && role.position >= haut) {
      return refuser(`❌ **${role.name}** est au niveau de votre rôle le plus haut, ou au-dessus : vous ne pouvez pas le faire distribuer par le bot.`);
    }
    const avantRole = C.reglagesComptage(getGuildConfig(guildId)).roleErreur;
    // Le dernier fautif perd l'ancien rôle (sauf s'il reste le même) : lu
    // AVANT d'écrire le nouveau réglage, retiré après la réponse.
    const retrait = avantRole !== roleId ? C.retirerRoleFautifComptage(guild, { garder: roleId }) : null;
    setGuildConfig(guildId, 'comptage_role_erreur', roleId);
    await mettreAJour(interaction, vue());
    await retrait;
    await journal(interaction, `🎭 Rôle d'erreur du comptage → ${roleId ? `<@&${roleId}>` : '*aucun*'}`);
    return;
  }

  if (action === 'xp') return interaction.showModal(modalXpComptage(getGuildConfig(guildId)));

  if (action === 'xpmodal') {
    const brut = String(interaction.fields.getTextInputValue('xp') || '').trim();
    const xp = /^\d{1,4}$/.test(brut) ? Number(brut) : NaN;
    if (!Number.isInteger(xp) || xp > C.XP_MAX_COMPTAGE) {
      return interaction.reply({
        content: `❌ « ${M.borner(brut, 20)} » n'est pas valable : entrez un nombre entier entre **0** et **${C.XP_MAX_COMPTAGE}**.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    setGuildConfig(guildId, 'comptage_xp', xp);
    if (interaction.isFromMessage?.()) await mettreAJour(interaction, vue());
    else await interaction.reply({ content: `✨ XP du comptage : **${xp}** par bon nombre.`, flags: MessageFlags.Ephemeral });
    await journal(interaction, `✨ XP par bon nombre (comptage) → **${xp}**`);
    return;
  }

  if (action === 'raz') return mettreAJour(interaction, vue({ confirmer: true }));

  if (action === 'razok') {
    const R = C.reglagesComptage(getGuildConfig(guildId));
    const avant = C.etatComptage(guildId);
    C.remettreComptageAZero(guildId);
    await mettreAJour(interaction, vue());
    if (R.salon) {
      await C.annoncerComptage(guild, R.salon,
        '🔄 Le staff a remis le comptage à zéro. On repart de **0** : le prochain est **1**.');
    }
    await sendLog(guild, logEmbed('🔢 Comptage remis à zéro',
      `Compte (**${avant.courant || 0}**) et record (**${avant.record || 0}**) effacés depuis /config.\nPar <@${interaction.user.id}>`,
      COLORS.WARNING));
    return;
  }

  // Un identifiant d'une version précédente : on réaffiche la vue du jour.
  return mettreAJour(interaction, vue());
}

module.exports = { vueConfigComptage, modalXpComptage, gererConfigComptage, permissionsManquantesComptage, BASCULES_COMPTAGE };
