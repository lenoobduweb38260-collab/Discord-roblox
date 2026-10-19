const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const { getGuildConfig } = require('../database');
const { GRADES, getGrade } = require('../utils/permissions');
const { COLORS, sendLog, logEmbed } = require('../utils/embeds');
const { mettreAJour, suivre } = require('../utils/reponse');
const M = require('../utils/miseEnPage');
const C = require('../utils/comptage');

// 🔢 /comptage — où en est le salon de comptage, qui compte le mieux.
//
// Tout le monde : `info` et `classement`. Le staff : `definir` (corriger
// après un incident) et `reinitialiser` (avec confirmation).
//
// Les boutons portent tout ce qu'il faut savoir (`cpt:page:<n>`,
// `cpt:raz:<staff>:<0|1>`, `cpt:annuler:<staff>`) et l'état vit en base :
// ils fonctionnent encore après un redémarrage du bot.

const PAR_PAGE = 10;
const SANS_PING = { parse: [] };

const unixDe = (iso) => Math.floor(new Date(iso).getTime() / 1000);
const oui = (v) => (v ? '🟢' : '🔴');

// La fiche du salon : le compte, le record, et les chiffres de qui regarde.
function vueInfoComptage(guild, userId = null) {
  const R = C.reglagesComptage(getGuildConfig(guild.id));
  const e = C.etatComptage(guild.id);
  const courant = C.nombreActuelComptage(guild.id, R.salon);
  const memeSalon = R.salon && String(e.channel_id) === R.salon;

  const blocs = [
    M.bloc('Le compte', R.salon
      ? [
        `Salon : <#${R.salon}>`,
        M.statistique('Nombre actuel', courant),
        M.statistique('Prochain nombre', courant + 1),
        ...(memeSalon && e.dernier_user ? [`Dernier compteur : <@${e.dernier_user}>`] : []),
      ]
      : [], { prefixe: '🔢', compte: null, vide: 'Aucun salon de comptage : un staff peut en choisir un dans /config → 🔢 Comptage.' }),
    M.bloc('Le serveur', [
      M.statistique('Record', e.record || 0, e.record && e.record_le ? `le <t:${unixDe(e.record_le)}:D>` : null),
      M.statistique('Séries cassées', e.erreurs || 0),
    ], { prefixe: '🏆', compte: null }),
  ];
  if (userId) {
    const moi = C.statsMembreComptage(guild.id, userId);
    blocs.push(M.bloc('Toi', moi.rang
      ? [
        M.statistique('Bons nombres', moi.justes, `${moi.rang === 1 ? '1er' : `${moi.rang}e`} du classement`),
        M.statistique('Séries cassées', moi.erreurs),
      ]
      : [], { prefixe: '👤', compte: null, vide: 'Tu n\'as pas encore compté.' }));
  }
  if (R.salon) {
    blocs.push(M.bloc('Les règles', [
      'Chacun son tour : un nombre de plus que le précédent.',
      `${oui(!R.memePersonne)} Pas deux fois de suite`,
      `${oui(R.maths)} Calculs acceptés (\`2*3\`, \`(10+2)/4\`)`,
      ...(R.xp ? [`✨ **${R.xp}** XP par bon nombre`] : []),
      'Une erreur remet le compte à **0**.',
    ], { prefixe: '📜', compte: null }));
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🔢 Comptage')
    .setDescription(M.borner(M.description(blocs), M.MAX_DESCRIPTION));
  return { embeds: [embed], allowedMentions: SANS_PING };
}

// Les meilleurs compteurs, dix par page.
function vueClassementComptage(guild, page = 1) {
  const total = C.compterCompteursComptage(guild.id);
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));
  const p = Math.min(Math.max(1, Math.floor(Number(page) || 1)), pages);
  const medailles = ['🥇', '🥈', '🥉'];
  const lignes = C.classementComptage(guild.id, { limite: PAR_PAGE, decalage: (p - 1) * PAR_PAGE }).map((r, i) => {
    const rang = (p - 1) * PAR_PAGE + i + 1;
    const tete = medailles[rang - 1] || `**${rang}.**`;
    const erreurs = r.erreurs ? ` · ${M.pluriel(r.erreurs, 'série cassée', 'séries cassées')}` : '';
    return `${tete} <@${r.user_id}> — **${r.justes}** ${r.justes > 1 ? 'bons nombres' : 'bon nombre'}${erreurs}`;
  });
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🏅 Classement du comptage')
    .setDescription(M.bloc('Meilleurs compteurs', lignes, {
      prefixe: '🔢', compte: null, vide: 'Personne n\'a encore compté : lancez-vous avec 1 !',
    }));
  if (total) embed.setFooter({ text: M.piedDePage({ total, motTotal: 'compteur', page: p, pages, heure: false }) });
  const nav = M.boutonsPages('cpt:page', p, pages);
  return { embeds: [embed], components: nav ? [nav] : [], allowedMentions: SANS_PING };
}

// La demande de confirmation d'une remise à zéro.
function vueConfirmationComptage(staffId, avecClassement) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle('🔄 Remettre le comptage à zéro ?')
    .setDescription([
      '➜ Le compte repart de **0** : le prochain nombre sera **1**.',
      '➜ Le **record** du serveur et le total des séries cassées sont effacés.',
      avecClassement
        ? '➜ Le **classement** des compteurs est effacé lui aussi.'
        : '➜ Le classement des compteurs est **conservé**.',
      '-# Sans retour possible.',
    ].join('\n'));
  const rangee = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cpt:raz:${staffId}:${avecClassement ? 1 : 0}`)
      .setLabel('Oui, tout remettre à zéro').setEmoji('🔄').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`cpt:annuler:${staffId}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [rangee] };
}

const estStaff = (interaction) => getGrade(interaction.member) >= GRADES.STAFF;

module.exports = {
  grade: GRADES.EVERYONE,
  vueInfoComptage, vueClassementComptage,
  data: new SlashCommandBuilder()
    .setName('comptage')
    .setDescription('Le salon de comptage : le nombre actuel, le record, les meilleurs compteurs 🔢')
    .addSubcommand((s) => s.setName('info').setDescription('Le nombre actuel, le prochain, le record du serveur et tes chiffres'))
    .addSubcommand((s) =>
      s.setName('classement').setDescription('Les meilleurs compteurs du serveur')
        .addIntegerOption((o) => o.setName('page').setDescription('Quelle page ? (défaut : 1)').setMinValue(1).setRequired(false))
    )
    .addSubcommand((s) =>
      s.setName('definir').setDescription('Staff : corriger le compte après un incident')
        .addIntegerOption((o) => o.setName('nombre').setDescription('Le dernier nombre valide (le suivant sera ce nombre + 1)')
          .setMinValue(0).setMaxValue(1000000000).setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('reinitialiser').setDescription('Staff : remettre le compte et le record à zéro')
        .addBooleanOption((o) => o.setName('classement').setDescription('Effacer aussi le classement des compteurs ? (défaut : non)').setRequired(false))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'info') return interaction.reply(vueInfoComptage(interaction.guild, interaction.user.id));
    if (sub === 'classement') {
      return interaction.reply(vueClassementComptage(interaction.guild, interaction.options.getInteger('page') || 1));
    }

    const prive = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!estStaff(interaction)) {
      return prive('⛔ Corriger ou remettre le compte à zéro est réservé au **staff**.\n➜ `/comptage info` montre où en est le compte.');
    }
    const R = C.reglagesComptage(getGuildConfig(interaction.guildId));
    if (!R.salon) {
      return prive('🔢 Aucun salon de comptage n\'est réglé sur ce serveur.\n➜ Choisissez-en un dans `/config` → 🔢 Comptage.');
    }

    if (sub === 'definir') {
      const n = Math.max(0, interaction.options.getInteger('nombre') ?? 0);
      const avant = C.nombreActuelComptage(interaction.guildId, R.salon);
      C.definirNombreComptage(interaction.guildId, n, R.salon);
      await interaction.reply({
        content: `✅ Compte fixé à **${n}** (il était à **${avant}**). Le prochain nombre est **${n + 1}**.\n-# Les joueurs sont prévenus dans <#${R.salon}>.`,
        flags: MessageFlags.Ephemeral,
      });
      await C.annoncerComptage(interaction.guild, R.salon,
        `🛠️ Le staff a corrigé le compte : on en est à **${n}**. Le prochain est **${n + 1}**.`);
      await sendLog(interaction.guild, logEmbed('🔢 Comptage corrigé',
        `Compte fixé à **${n}** (il était à **${avant}**) dans <#${R.salon}>.\nPar <@${interaction.user.id}>`, COLORS.WARNING));
      return;
    }

    if (sub === 'reinitialiser') {
      const avecClassement = Boolean(interaction.options.getBoolean('classement'));
      return interaction.reply({ ...vueConfirmationComptage(interaction.user.id, avecClassement), flags: MessageFlags.Ephemeral });
    }
    return prive('❓ Sous-commande inconnue : relancez `/comptage`.');
  },

  // cpt:page:<n> · cpt:raz:<staff>:<0|1> · cpt:annuler:<staff>
  async handleButton(interaction) {
    const [, action, x, y] = interaction.customId.split(':');
    const prive = (content) => suivre(interaction, { content, flags: MessageFlags.Ephemeral });

    if (action === 'page') return mettreAJour(interaction, vueClassementComptage(interaction.guild, Number(x) || 1));

    if (action !== 'raz' && action !== 'annuler') {
      return prive('❓ Ce bouton vient d\'une ancienne version : relancez `/comptage`.');
    }
    if (interaction.user.id !== x) return prive('⛔ Seule la personne qui a demandé la remise à zéro peut y répondre.');

    if (action === 'annuler') {
      return mettreAJour(interaction, {
        embeds: [new EmbedBuilder().setColor(COLORS.INFO).setTitle('🔄 Remise à zéro annulée').setDescription('Rien n\'a changé : le compte continue.')],
        components: [],
      });
    }

    // Revérifier au moment du clic : le salon a pu être retiré, et le grade
    // a pu changer depuis la commande.
    const R = C.reglagesComptage(getGuildConfig(interaction.guildId));
    if (!R.salon) return prive('⛔ Le comptage est coupé sur ce serveur (aucun salon) : il n\'y a rien à remettre à zéro.');
    if (!estStaff(interaction)) return prive('⛔ La remise à zéro est réservée au **staff**.');

    const avecClassement = y === '1';
    const avant = C.etatComptage(interaction.guildId);
    C.remettreComptageAZero(interaction.guildId, { classement: avecClassement });
    await mettreAJour(interaction, {
      embeds: [new EmbedBuilder().setColor(COLORS.SUCCESS).setTitle('🔄 Comptage remis à zéro')
        .setDescription(`Le prochain nombre est **1**.${avecClassement ? '\nLe classement a été effacé.' : ''}`)],
      components: [],
    });
    await C.annoncerComptage(interaction.guild, R.salon,
      '🔄 Le staff a remis le comptage à zéro. On repart de **0** : le prochain est **1**.');
    await sendLog(interaction.guild, logEmbed('🔢 Comptage remis à zéro',
      `Compte (**${avant.courant || 0}**) et record (**${avant.record || 0}**) effacés${avecClassement ? ', classement compris' : ''}.\nPar <@${interaction.user.id}>`,
      COLORS.WARNING));
  },
};
