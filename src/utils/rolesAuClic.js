const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { db } = require('../database');

// 🎭 Donner un rôle depuis un message — au clic, ou à la réaction.
//
// Deux mécaniques pour un même besoin, et elles ne se valent pas :
//
//  • BOUTON — Discord répond « rôle ajouté » à la personne seule, le message
//    reste propre, et le bouton vit à l'intérieur de la carte. C'est le
//    défaut.
//  • RÉACTION — la façon historique. Elle marche sur n'importe quel message,
//    mais elle empile les émojis sous le message et ne peut rien répondre à
//    qui clique : un échec (rôle trop haut, rôle supprimé) reste invisible.
//    On la garde parce que beaucoup de serveurs la connaissent, et parce
//    qu'un règlement déjà en place fonctionne comme ça.
//
// Le rôle est TOUJOURS une bascule : on l'a, un clic le retire ; on ne l'a
// pas, un clic le donne. Deux boutons « prendre » et « rendre » diraient la
// même chose en occupant deux fois la place.

const inserer = db.prepare(
  `INSERT INTO role_actions (guild_id, channel_id, message_id, role_id, mode, emoji, label, position)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const effacerDuMessage = db.prepare('DELETE FROM role_actions WHERE message_id = ?');
const duMessage = db.prepare('SELECT * FROM role_actions WHERE message_id = ? ORDER BY position');
const parEmoji = db.prepare('SELECT * FROM role_actions WHERE message_id = ? AND mode = \'reaction\' AND emoji = ?');

const MAX_ROLES = 5; // une rangée de boutons

// Un émoji d'unicode ou un émoji de serveur (<:nom:123>) : on retient la forme
// que l'API des réactions attend, et celle que Discord renvoie dans l'événement.
function cleEmoji(emoji) {
  if (!emoji) return null;
  if (typeof emoji === 'string') {
    const perso = /^<a?:([\w~]+):(\d+)>$/.exec(emoji.trim());
    return perso ? perso[2] : emoji.trim();
  }
  return emoji.id || emoji.name || null;
}

// 📝 Mémorise les rôles d'un message. Remplace ceux d'avant : un message
// réédité ne doit pas cumuler les réglages de ses versions précédentes.
function enregistrer({ guildId, channelId, messageId, roles, mode }) {
  effacerDuMessage.run(String(messageId));
  const liste = (roles || []).slice(0, MAX_ROLES);
  liste.forEach((r, i) => {
    if (!r?.roleId) return;
    inserer.run(
      String(guildId), String(channelId), String(messageId), String(r.roleId),
      mode === 'reaction' ? 'reaction' : 'bouton',
      r.emoji ? cleEmoji(r.emoji) : null, r.label || null, i
    );
  });
  return liste.length;
}

const rolesDe = (messageId) => duMessage.all(String(messageId));
const oublier = (messageId) => effacerDuMessage.run(String(messageId));

// ── Boutons ──────────────────────────────────────────────────────
// L'identifiant porte le rôle : rien à relire en base au clic, donc rien à
// perdre si la base est réinitialisée ou le message republié.
function rangeeBoutons(roles) {
  const liste = (roles || []).filter((r) => r?.roleId).slice(0, MAX_ROLES);
  if (!liste.length) return null;
  const rangee = new ActionRowBuilder();
  for (const r of liste) {
    const bouton = new ButtonBuilder()
      .setCustomId(`rr:${r.roleId}`)
      .setLabel(String(r.label || 'Rôle').slice(0, 80))
      .setStyle(ButtonStyle.Secondary);
    if (r.emoji) {
      // Un émoji refusé ferait échouer TOUT l'envoi : le bouton sans émoji
      // vaut mieux qu'un message qui ne part pas.
      try { bouton.setEmoji(r.emoji); } catch {}
    }
    rangee.addComponents(bouton);
  }
  return rangee;
}

// ── Réactions ────────────────────────────────────────────────────
async function poserReactions(message, roles) {
  for (const r of (roles || []).slice(0, MAX_ROLES)) {
    if (!r?.emoji) continue;
    // En série : Discord limite les réactions, et les poser en parallèle
    // les fait arriver dans le désordre.
    await message.react(r.emoji).catch(() => null);
  }
}

// ── Le geste commun aux deux mécaniques ──────────────────────────
//
// Renvoie une phrase à afficher, ou un refus expliqué. On ne dit jamais
// « une erreur est survenue » : les deux causes réelles (rôle disparu, rôle
// au-dessus du bot) se corrigent, encore faut-il les nommer.
async function basculer(guild, membre, roleId) {
  const role = await guild.roles.fetch(String(roleId)).catch(() => null);
  if (!role) return { ok: false, message: '❌ Ce rôle n\'existe plus. Prévenez un responsable du serveur.' };

  const moi = guild.members.me;
  if (!moi?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, message: '❌ Je n\'ai pas la permission « Gérer les rôles » sur ce serveur.' };
  }
  if (role.position >= moi.roles.highest.position) {
    return {
      ok: false,
      message: `❌ Le rôle **${role.name}** est au-dessus du mien : je ne peux pas l'attribuer. `
        + 'Remontez mon rôle au-dessus dans les paramètres du serveur.',
    };
  }
  if (role.managed) {
    return { ok: false, message: `❌ **${role.name}** est géré par une intégration : il ne s'attribue pas à la main.` };
  }

  const avait = membre.roles.cache.has(role.id);
  const fait = avait
    ? await membre.roles.remove(role).then(() => true).catch(() => false)
    : await membre.roles.add(role).then(() => true).catch(() => false);
  if (!fait) return { ok: false, message: `❌ Discord a refusé la modification du rôle **${role.name}**.` };
  return {
    ok: true,
    ajoute: !avait,
    message: avait ? `➖ Le rôle **${role.name}** vous a été retiré.` : `➕ Le rôle **${role.name}** vous a été donné.`,
  };
}

// Clic sur un bouton « rr:<roleId> ».
async function handleButton(interaction) {
  const roleId = interaction.customId.split(':')[1];
  if (!interaction.guild || !roleId) return null;
  const membre = interaction.member ?? (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));
  if (!membre) return null;
  const r = await basculer(interaction.guild, membre, roleId);
  return interaction.reply({ content: r.message, flags: MessageFlags.Ephemeral }).catch(() => null);
}

// Menu déroulant de rôles (« rrm ») : chaque option porte l'identifiant du
// rôle qu'elle donne. Les rôles choisis sont ajoutés, ceux qu'on déselectionne
// sont retirés — le menu montre donc l'état, comme une case à cocher.
async function handleMenu(interaction) {
  if (!interaction.guild) return null;
  const membre = interaction.member ?? (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));
  if (!membre) return null;

  const proposes = (interaction.component?.options || []).map((o) => String(o.value));
  const choisis = new Set(interaction.values.map(String));
  const lignes = [];

  for (const roleId of proposes.length ? proposes : [...choisis]) {
    const veut = choisis.has(roleId);
    const a = membre.roles.cache.has(roleId);
    if (veut === a) continue; // rien à faire pour celui-là
    const r = await basculer(interaction.guild, membre, roleId);
    lignes.push(r.message);
  }

  const contenu = lignes.length ? lignes.join('\n') : '➖ Aucun changement : vous aviez déjà exactement ces rôles.';
  return interaction.reply({ content: contenu, flags: MessageFlags.Ephemeral }).catch(() => null);
}

// Réaction ajoutée ou retirée. `ajout` dit laquelle : ajouter la réaction
// donne le rôle, la retirer l'enlève — c'est ce que les membres attendent
// d'un panneau à réactions, et c'est l'inverse d'une bascule.
async function handleReaction(reaction, utilisateur, ajout) {
  try {
    if (utilisateur?.bot) return null;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    const messageId = reaction.message?.id;
    if (!messageId) return null;

    const ligne = parEmoji.get(String(messageId), cleEmoji(reaction.emoji));
    if (!ligne) return null;

    const guild = reaction.message.guild;
    if (!guild) return null;
    const membre = await guild.members.fetch(utilisateur.id).catch(() => null);
    if (!membre) return null;

    const role = await guild.roles.fetch(String(ligne.role_id)).catch(() => null);
    if (!role) return null;
    const moi = guild.members.me;
    if (!moi?.permissions?.has(PermissionFlagsBits.ManageRoles) || role.position >= moi.roles.highest.position) {
      // Personne à qui répondre : une réaction n'ouvre pas de fil. On le
      // trace au moins dans la console pour que ce ne soit pas un mystère.
      console.warn(`⚠️ Rôle à la réaction impossible sur ${guild.name} : « ${role.name} » est hors de ma portée.`);
      return null;
    }
    if (ajout) return membre.roles.add(role).catch(() => null);
    return membre.roles.remove(role).catch(() => null);
  } catch {
    return null;
  }
}

module.exports = {
  MAX_ROLES, enregistrer, rolesDe, oublier, rangeeBoutons, poserReactions,
  basculer, handleButton, handleMenu, handleReaction, cleEmoji,
};
