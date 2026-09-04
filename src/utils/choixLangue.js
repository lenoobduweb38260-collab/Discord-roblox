const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  ChannelType, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const { setGuildConfig } = require('../database');
const { COLORS, sendLog, logEmbed } = require('./embeds');
const { getGrade, GRADES } = require('./permissions');
const LG = require('./langues');

// 🌍 Le choix de langue, posé À L'ARRIVÉE du bot sur un serveur.
//
// Chaque ligne de la carte parle SA langue : l'administrateur polonais lit
// du polonais, le russe du russe — personne n'a besoin de comprendre le
// français pour choisir. Le menu écrit `bot_langue`, le même réglage que
// `/config` → 🌍 Langue : deux portes, un seul réglage.

function carteLangue() {
  const lignes = LG.liste().map((l) => `${l.drapeau} **${l.nom}** — ${LG.t(l.cle, 'langue.invitation')}`);
  return new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle(LG.t('fr', 'langue.titre'))
    .setDescription(lignes.join('\n'));
}

function rangee() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('langue:sel')
      .setPlaceholder('🌍 Français · English · Deutsch · Español · Polski · Русский')
      .addOptions(LG.liste().map((l) => ({
        label: l.nom,
        value: l.cle,
        emoji: l.drapeau,
        description: LG.t(l.cle, 'langue.optionDescription'),
      })))
  );
}

// Où poser la carte : le salon système s'il est écrivable, sinon le premier
// salon texte accessible. Aucun salon ouvert = on renonce sans bruit.
async function envoyer(guild) {
  const me = guild.members.me;
  const peutEcrire = (c) =>
    c?.type === ChannelType.GuildText
    && c.permissionsFor?.(me)?.has?.(PermissionFlagsBits.ViewChannel)
    && c.permissionsFor(me).has(PermissionFlagsBits.SendMessages);
  let salon = peutEcrire(guild.systemChannel) ? guild.systemChannel : null;
  if (!salon) {
    salon = [...guild.channels.cache.values()]
      .filter(peutEcrire)
      .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))[0] || null;
  }
  if (!salon) return null;
  return salon.send({ embeds: [carteLangue()], components: [rangee()] }).catch(() => null);
}

// Le menu : staff uniquement — la langue du bot appartient au serveur, pas au
// premier passant. La confirmation arrive DANS la langue choisie.
async function handleMenu(interaction) {
  if (getGrade(interaction.member) < GRADES.STAFF) {
    return interaction.reply({
      content: LG.t(interaction.guildId, 'commun.reserveStaff'),
      flags: MessageFlags.Ephemeral,
    });
  }
  const choix = LG.CLES.includes(interaction.values?.[0]) ? interaction.values[0] : LG.DEFAUT;
  setGuildConfig(interaction.guildId, 'bot_langue', choix);
  const { mettreAJour, suivre } = require('./reponse');
  await mettreAJour(interaction, { embeds: [carteLangue()], components: [rangee()] });
  await sendLog(
    interaction.guild,
    logEmbed('🌍 Langue du bot', `Réglée sur ${LG.LANGUES[choix].drapeau} **${LG.LANGUES[choix].nom}** par <@${interaction.user.id}>.`, COLORS.INFO)
  );
  return suivre(interaction, {
    content: LG.t(choix, 'langue.choisie', { nom: LG.LANGUES[choix].nom }),
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { carteLangue, rangee, envoyer, handleMenu };
