const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const L = require('../utils/levels');
const { COLORS, sendLog, logEmbed } = require('../utils/embeds');
const { GRADES, getGrade } = require('../utils/permissions');
const M = require('../utils/miseEnPage');
const { repondreVite, mettreAJour } = require('../utils/reponse');

// 🛠️ /xp — l'administration des niveaux (staff ; remises à zéro : admin).
//
// Tout passe par `gagnerXpServeur` avec la source 'admin' : le staff n'est
// soumis à aucun multiplicateur ni aucune exclusion, et un niveau gagné
// s'annonce et donne ses récompenses comme n'importe quel autre. Un niveau
// PERDU reprend les rôles des paliers qui ne sont plus atteints.
//
// La remise à zéro du serveur se confirme par un bouton qui porte tout ce
// qu'il faut savoir (`niv:raz:<oui|non>:<demandeur>:<horodatage>`) : il
// survit à un redémarrage, et expire au bout de 10 minutes.

const EXPIRATION_RAZ = 10 * 60 * 1000;
const nombreFr = (n) => Number(n || 0).toLocaleString('fr-FR');
const prive = (content) => ({ content, flags: MessageFlags.Ephemeral });

async function membreDe(guild, userId) {
  return guild.members?.cache?.get?.(userId) || (await guild.members?.fetch?.(userId).catch(() => null)) || null;
}

// Les rôles de récompense repris après une remise à zéro, membre par membre.
// Lancé en arrière-plan : le bouton a déjà répondu.
async function reprendreRolesApresRaz(guild, anciens) {
  let retires = 0;
  for (const a of anciens) {
    const r = await L.appliquerRecompenses(guild, a.user_id, 0, { ancien: a.level }).catch(() => null);
    retires += r?.retires?.length || 0;
  }
  return retires;
}

async function modifierXp(interaction, sub, user) {
  const guild = interaction.guild;
  const gid = interaction.guildId;
  const avant = L.getLevels(gid, user.id);
  const xpAvant = avant.xp || 0;
  let cible = xpAvant;
  if (sub === 'donner') cible = xpAvant + interaction.options.getInteger('quantite');
  else if (sub === 'retirer') cible = Math.max(0, xpAvant - interaction.options.getInteger('quantite'));
  else {
    const niveau = interaction.options.getInteger('niveau');
    const xp = interaction.options.getInteger('xp');
    if ((niveau === null) === (xp === null)) {
      return prive('❌ Indiquez **soit** un `niveau`, **soit** une quantité d\'`xp` totale — l\'un des deux.');
    }
    const { courbe, max } = L.courbeXpDe(gid);
    if (niveau !== null && max && niveau > max) return prive(`❌ Le niveau maximum de ce serveur est **${max}**.`);
    cible = niveau !== null ? L.totalXpForLevel(niveau, courbe) : xp;
  }
  const delta = cible - xpAvant;
  if (!delta) return prive(`ℹ️ <@${user.id}> a déjà **${nombreFr(xpAvant)} XP** : rien à changer.`);

  const membre = await membreDe(guild, user.id);
  const res = await L.gagnerXpServeur(guild, user.id, 'admin', delta, { membre, salon: interaction.channel });
  const apres = L.getLevels(gid, user.id);
  const signe = res.gagne > 0 ? '+' : '';
  const verbe = { donner: 'XP donnée', retirer: 'XP retirée', definir: 'XP fixée' }[sub];
  const embed = new EmbedBuilder()
    .setColor(res.gagne >= 0 ? COLORS.SUCCESS : COLORS.WARNING)
    .setTitle(`🛠️ ${verbe}`)
    .setDescription([
      `<@${user.id}> : **${signe}${nombreFr(res.gagne)} XP** → **${nombreFr(apres.xp || 0)} XP** au total.`,
      res.newLevel !== res.oldLevel
        ? `📈 Niveau **${res.oldLevel}** → **${res.newLevel}**`
        : `📈 Niveau **${res.newLevel}** (inchangé)`,
      res.leveledDown ? '-# Les rôles des paliers qui ne sont plus atteints ont été repris.' : null,
    ].filter(Boolean).join('\n'));
  await sendLog(guild, logEmbed('🛠️ XP modifiée par le staff',
    `<@${user.id}> : ${signe}${nombreFr(res.gagne)} XP (niveau ${res.oldLevel} → ${res.newLevel})\nPar <@${interaction.user.id}> via \`/xp ${sub}\``,
    COLORS.INFO));
  return { embeds: [embed], flags: MessageFlags.Ephemeral };
}

// ── Bouton de confirmation de /xp reset-serveur ────────────────────────
async function gererConfirmationRaz(interaction) {
  const [, , choix, demandeur, horodatage] = String(interaction.customId).split(':');
  if (interaction.user.id !== demandeur) {
    return interaction.reply(prive(`⛔ Seul·e <@${demandeur}>, qui a demandé la remise à zéro, peut la confirmer.`));
  }
  if (getGrade(interaction.member) < GRADES.ADMIN) {
    return interaction.reply(prive('⛔ La remise à zéro du serveur est réservée à l\'**administration**.'));
  }
  const fermer = (embed) => mettreAJour(interaction, { embeds: [embed], components: [] });
  if (choix !== 'oui') {
    return fermer(new EmbedBuilder().setColor(COLORS.INFO).setTitle('↩️ Remise à zéro annulée').setDescription('Rien n\'a été effacé.'));
  }
  if (!(Date.now() - Number(horodatage) <= EXPIRATION_RAZ)) {
    return fermer(new EmbedBuilder().setColor(COLORS.WARNING).setTitle('⌛ Confirmation expirée')
      .setDescription('Rien n\'a été effacé.\n➜ Relancez `/xp reset-serveur` pour recommencer.'));
  }
  const anciens = L.effacerXpServeur(interaction.guildId);
  await fermer(new EmbedBuilder().setColor(COLORS.DANGER).setTitle('🧹 XP du serveur remise à zéro')
    .setDescription([
      `**${nombreFr(anciens.length)}** membre(s) repartent du niveau 0.`,
      anciens.length ? '➜ Les rôles de récompense sont repris en arrière-plan.' : null,
    ].filter(Boolean).join('\n')));
  await sendLog(interaction.guild, logEmbed('🧹 XP du serveur remise à zéro',
    `${nombreFr(anciens.length)} membre(s) remis à zéro par <@${interaction.user.id}>.`, COLORS.DANGER));
  if (anciens.length) reprendreRolesApresRaz(interaction.guild, anciens).catch(() => null);
  return null;
}

module.exports = {
  grade: GRADES.STAFF,
  gererConfirmationRaz, reprendreRolesApresRaz, EXPIRATION_RAZ,
  data: new SlashCommandBuilder()
    .setName('xp')
    .setDescription('[Staff] Gérer l\'XP et les niveaux des membres')
    .addSubcommand((sub) =>
      sub.setName('donner').setDescription('Donner de l\'XP à un membre')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addIntegerOption((o) => o.setName('quantite').setDescription('XP à donner').setRequired(true).setMinValue(1).setMaxValue(1000000)))
    .addSubcommand((sub) =>
      sub.setName('retirer').setDescription('Retirer de l\'XP à un membre (les rôles des paliers perdus sont repris)')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addIntegerOption((o) => o.setName('quantite').setDescription('XP à retirer').setRequired(true).setMinValue(1).setMaxValue(1000000)))
    .addSubcommand((sub) =>
      sub.setName('definir').setDescription('Fixer le niveau ou l\'XP totale d\'un membre')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addIntegerOption((o) => o.setName('niveau').setDescription('Niveau à fixer').setRequired(false).setMinValue(0).setMaxValue(1000))
        .addIntegerOption((o) => o.setName('xp').setDescription('XP totale à fixer').setRequired(false).setMinValue(0).setMaxValue(1000000000)))
    .addSubcommand((sub) =>
      sub.setName('reset').setDescription('[Admin] Remettre un membre à zéro')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true)))
    .addSubcommand((sub) =>
      sub.setName('reset-serveur').setDescription('[Admin] Remettre tout le serveur à zéro (confirmation demandée)'))
    .addSubcommand((sub) =>
      sub.setName('synchroniser').setDescription('Réappliquer les récompenses de niveau à tous les membres')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const remiseAZero = sub === 'reset' || sub === 'reset-serveur';
    if (remiseAZero && getGrade(interaction.member) < GRADES.ADMIN) {
      return interaction.reply(prive('⛔ Les remises à zéro sont réservées à l\'**administration**.'));
    }
    if (!remiseAZero && !L.levelsEnabled(interaction.guildId)) {
      return interaction.reply(prive('📴 Le système de niveaux est **désactivé** sur ce serveur.\n'
        + '➜ Réactivez-le via `/config` → 📈 XP & niveaux.'));
    }

    if (sub === 'reset-serveur') {
      const nb = L.classementNiveaux(interaction.guildId, { partis: true }).length;
      const quand = Date.now();
      const embed = new EmbedBuilder()
        .setColor(COLORS.WARNING)
        .setTitle('⚠️ Remettre tout le serveur à zéro ?')
        .setDescription([
          `**${nombreFr(nb)}** membre(s) ont de l'XP sur ce serveur.`,
          M.entree('XP et niveaux de **tout le monde** repartent de 0.'),
          M.entree('Les rôles de récompense sont repris ; le Col et les objets déjà versés restent acquis, '
            + 'et seront versés de nouveau aux paliers regagnés.'),
          M.entree('**Irréversible.**'),
          '-# Ce bouton expire dans 10 minutes.',
        ].join('\n'));
      const boutons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`niv:raz:oui:${interaction.user.id}:${quand}`).setLabel('Tout effacer').setEmoji('🧹').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`niv:raz:non:${interaction.user.id}:${quand}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({ embeds: [embed], components: [boutons], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'synchroniser') {
      return repondreVite(interaction, async () => {
        const b = await L.synchroniserNiveaux(guild);
        if (b.enCours) return prive('⏳ Une synchronisation est déjà en cours sur ce serveur : patientez qu\'elle se termine.');
        await sendLog(guild, logEmbed('🔁 Récompenses de niveau synchronisées',
          `${b.membres} membre(s), ${b.donnes} récompense(s) donnée(s), ${b.retires} rôle(s) repris.\nPar <@${interaction.user.id}>`,
          COLORS.INFO));
        const embed = new EmbedBuilder()
          .setColor(COLORS.SUCCESS)
          .setTitle('🔁 Récompenses synchronisées')
          .setDescription([
            M.statistique('👥 Membres traités', nombreFr(b.membres)),
            M.statistique('🏅 Récompenses données', nombreFr(b.donnes)),
            M.statistique('🔄 Rôles de paliers dépassés repris', nombreFr(b.retires)),
            b.ignores ? M.statistique('⚠️ Récompenses impossibles', nombreFr(b.ignores), 'voir /config → 📈 XP & niveaux → 🏅') : null,
            b.partis ? M.statistique('🚪 Membres partis (retirés du classement)', nombreFr(b.partis)) : null,
          ].filter(Boolean).join('\n'));
        return { embeds: [embed], flags: MessageFlags.Ephemeral };
      }, { ephemere: true });
    }

    const user = interaction.options.getUser('membre');
    if (!user) return interaction.reply(prive('❌ Membre introuvable.'));
    if (user.bot) return interaction.reply(prive('🤖 Les bots n\'ont pas de niveau.'));

    if (sub === 'reset') {
      const avant = L.effacerXpMembre(interaction.guildId, user.id);
      if (!avant) return interaction.reply(prive(`ℹ️ <@${user.id}> n'avait aucune XP sur ce serveur.`));
      return repondreVite(interaction, async () => {
        const membre = await membreDe(guild, user.id);
        const r = membre ? await L.appliquerRecompenses(guild, user.id, 0, { ancien: avant.level, membre }) : { retires: [] };
        await sendLog(guild, logEmbed('🧹 XP d\'un membre remise à zéro',
          `<@${user.id}> : ${nombreFr(avant.xp)} XP (niveau ${avant.level}) effacée.\nPar <@${interaction.user.id}>`, COLORS.WARNING));
        const embed = new EmbedBuilder().setColor(COLORS.WARNING).setTitle('🧹 XP remise à zéro')
          .setDescription([
            `<@${user.id}> repart du niveau 0 (il avait **${nombreFr(avant.xp)} XP**, niveau **${avant.level}**).`,
            r.retires.length ? `🔄 ${r.retires.length} rôle(s) de récompense repris.` : null,
          ].filter(Boolean).join('\n'));
        return { embeds: [embed], flags: MessageFlags.Ephemeral };
      }, { ephemere: true });
    }

    // donner / retirer / definir — l'annonce et les rôles peuvent prendre un
    // instant : on ne diffère qu'à la dernière seconde.
    return repondreVite(interaction, () => modifierXp(interaction, sub, user), { ephemere: true });
  },
};
