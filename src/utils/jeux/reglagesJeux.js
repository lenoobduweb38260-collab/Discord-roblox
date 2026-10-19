// ⚙️ /config → 🎲 Mini-jeux : l'interrupteur du module, un interrupteur par
// jeu, et les récompenses d'une victoire (formulaire).
//
// Identifiants « cfgjeux:… » — ils commencent par « cfg », donc arrivent par
// handleConfigInteraction (garde : staff au minimum). Les récompenses
// touchent à l'économie du serveur (XP, Col) : administration seulement.
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../../database');
const { COLORS, sendLog, logEmbed } = require('../embeds');
const { GRADES } = require('../permissions');
const { mettreAJour } = require('../reponse');
const M = require('../miseEnPage');
const P = require('./parties');

const etatModule = (on) => (on ? '🟢 **Activé**' : '🔴 **Désactivé**');

function vueConfigJeux(guild) {
  const cfg = getGuildConfig(guild.id);
  const actif = Boolean(cfg.jeux_enabled);
  const coupes = P.jeuxCoupes(cfg);
  const r = P.recompensesJeux(cfg);
  const listeJeux = P.CATALOGUE_JEUX
    .map((j) => M.entree(`${coupes.has(j.cle) ? '🔴' : '🟢'} ${j.emoji} **${j.nom}** — ${j.resume}`))
    .join('\n');
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('🎲 Configuration — Mini-jeux')
    .addFields(
      {
        name: '🎲 Module',
        value: `${etatModule(actif)}\n\`/jeu\` : neuf jeux pour s'amuser, des statistiques et un classement.`,
      },
      { name: '🎮 Jeux', value: M.borner(listeJeux, M.MAX_CHAMP) },
      {
        name: '🎁 Récompenses d\'une victoire',
        value: [
          M.entree(`Contre un membre : **${r.xpVictoire} XP**`),
          M.entree(`Contre le bot ou en solo : **${r.xpBot} XP**`),
          M.entree(`Plafond par membre et par jour : **${r.plafond} XP**`),
          M.entree(`Col SAO : **${r.col}**${r.col && !cfg.sao_enabled ? ' *(Aventure SAO coupée : rien n\'est versé)*' : ''}`),
          '-# Le plafond atteint coupe aussi les Col. Une victoire par abandon ne rapporte rien.',
        ].join('\n'),
      }
    );
  const bascule = (j) => new ButtonBuilder()
    .setCustomId(`cfgjeux:jeu:${j.cle}`)
    .setLabel(j.nom)
    .setEmoji(j.emoji)
    .setStyle(coupes.has(j.cle) ? ButtonStyle.Secondary : ButtonStyle.Success);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('cfgjeux:module')
          .setLabel(actif ? 'Couper les mini-jeux' : 'Activer les mini-jeux')
          .setEmoji('🎲')
          .setStyle(actif ? ButtonStyle.Secondary : ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('cfgjeux:recompenses')
          .setLabel('Récompenses')
          .setEmoji('🎁')
          .setStyle(ButtonStyle.Primary)
      ),
      new ActionRowBuilder().addComponents(...P.CATALOGUE_JEUX.slice(0, 5).map(bascule)),
      new ActionRowBuilder().addComponents(...P.CATALOGUE_JEUX.slice(5).map(bascule)),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfgback').setLabel('⬅ Retour au panneau').setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function modalRecompensesJeux(cfg) {
  const r = P.recompensesJeux(cfg);
  const champ = (id, label, valeur) => new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short)
      .setRequired(true).setMaxLength(5).setValue(String(valeur))
  );
  const b = P.BORNES_RECOMPENSES;
  return new ModalBuilder()
    .setCustomId('cfgjeux:modal')
    .setTitle('🎁 Récompenses des mini-jeux')
    .addComponents(
      // ⚠️ Un libellé de champ tient en 45 caractères, pas un de plus.
      champ('jeux_xp_victoire', `XP par victoire contre un membre (${b.jeux_xp_victoire.min}-${b.jeux_xp_victoire.max})`, r.xpVictoire),
      champ('jeux_xp_bot', `XP par victoire contre le bot (${b.jeux_xp_bot.min}-${b.jeux_xp_bot.max})`, r.xpBot),
      champ('jeux_xp_plafond', `XP max. par membre et par jour (${b.jeux_xp_plafond.min}-${b.jeux_xp_plafond.max})`, r.plafond),
      champ('jeux_col_victoire', `Col SAO par victoire (${b.jeux_col_victoire.min}-${b.jeux_col_victoire.max})`, r.col)
    );
}

// Routeur des « cfgjeux:… ». `grade` : celui que handleConfigInteraction a
// déjà calculé (staff au minimum).
async function gererConfigJeux(interaction, grade) {
  const id = interaction.customId;
  const g = interaction.guildId;

  if (id === 'cfgjeux:module') {
    const on = getGuildConfig(g).jeux_enabled ? 0 : 1;
    setGuildConfig(g, 'jeux_enabled', on);
    await mettreAJour(interaction, vueConfigJeux(interaction.guild));
    await sendLog(interaction.guild, logEmbed('🎲 Module Mini-jeux',
      `Mini-jeux ${on ? 'activés' : 'désactivés'} par <@${interaction.user.id}>.`, on ? COLORS.SUCCESS : COLORS.DANGER));
    return;
  }

  if (id.startsWith('cfgjeux:jeu:')) {
    const cle = id.split(':')[2];
    if (!P.CLES_JEUX.includes(cle)) return;
    const coupes = P.jeuxCoupes(getGuildConfig(g));
    const coupe = !coupes.has(cle);
    if (coupe) coupes.add(cle);
    else coupes.delete(cle);
    const liste = P.CLES_JEUX.filter((c) => coupes.has(c));
    setGuildConfig(g, 'jeux_desactives', liste.length ? liste.join(',') : null);
    await mettreAJour(interaction, vueConfigJeux(interaction.guild));
    const info = P.infoJeu(cle);
    await sendLog(interaction.guild, logEmbed('🎲 Mini-jeux',
      `${info.emoji} ${info.nom} ${coupe ? 'désactivé' : 'réactivé'} par <@${interaction.user.id}>.`, coupe ? COLORS.WARNING : COLORS.SUCCESS));
    return;
  }

  if (id === 'cfgjeux:recompenses' || id === 'cfgjeux:modal') {
    if (grade < GRADES.ADMIN) {
      return interaction.reply({
        content: '⛔ Les récompenses des mini-jeux (XP et Col) touchent à l\'économie du serveur : seule l\'**administration** peut les changer.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  if (id === 'cfgjeux:recompenses') return interaction.showModal(modalRecompensesJeux(getGuildConfig(g)));

  if (id === 'cfgjeux:modal') {
    const valeurs = {};
    for (const [cle, b] of Object.entries(P.BORNES_RECOMPENSES)) {
      const brut = String(interaction.fields.getTextInputValue(cle) ?? '').trim();
      if (!/^\d+$/.test(brut)) {
        return interaction.reply({
          content: `❌ « ${M.borner(brut, 20) || 'vide'} » n'est pas un nombre entier positif. Rien n'a été changé.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      valeurs[cle] = Math.min(b.max, Math.max(b.min, Number(brut)));
    }
    for (const [cle, v] of Object.entries(valeurs)) setGuildConfig(g, cle, v);
    if (interaction.isFromMessage?.()) await mettreAJour(interaction, vueConfigJeux(interaction.guild));
    else await interaction.reply({ content: '✅ Récompenses des mini-jeux mises à jour.', flags: MessageFlags.Ephemeral });
    await sendLog(interaction.guild, logEmbed('🎁 Récompenses des mini-jeux',
      `Victoire contre un membre : **${valeurs.jeux_xp_victoire} XP** · contre le bot : **${valeurs.jeux_xp_bot} XP**\n`
      + `Plafond du jour : **${valeurs.jeux_xp_plafond} XP** · Col par victoire : **${valeurs.jeux_col_victoire}**\n`
      + `Par <@${interaction.user.id}>`, COLORS.INFO));
  }
}

module.exports = { vueConfigJeux, gererConfigJeux, modalRecompensesJeux };
