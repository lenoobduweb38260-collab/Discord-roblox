const { SlashCommandBuilder, EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');
const { COLORS } = require('../utils/embeds');
const { GRADES, getGrade } = require('../utils/permissions');
const M = require('../utils/miseEnPage');
const absences = require('../utils/absences');

// 📅 /absence — publier le panneau, voir qui manque.
//
// Le panneau s'adresse à TOUT LE MONDE : n'importe qui déclare son absence en
// un clic. Seule sa PUBLICATION est réservée au staff — comme le panneau de
// tickets. À la publication, le staff choisit jusqu'à trois salons d'annonce :
// chaque absence y sera copiée, pour que personne ne puisse la manquer.

module.exports = {
  grade: GRADES.EVERYONE,
  guildModule: null,

  data: new SlashCommandBuilder()
    .setName('absence')
    .setDescription('Absences : le panneau de déclaration, et qui manque en ce moment')
    .addSubcommand((s) => s.setName('panneau')
      .setDescription('[Staff] Publier le panneau de déclaration d\'absence')
      .addChannelOption((o) => o.setName('salon')
        .setDescription('Salon du panneau (défaut : ici)')
        .addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) => o.setName('annonces')
        .setDescription('1er salon où publier les annonces d\'absence (défaut : le salon du panneau)')
        .addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) => o.setName('annonces2')
        .setDescription('2e salon d\'annonces (facultatif)')
        .addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) => o.setName('annonces3')
        .setDescription('3e salon d\'annonces (facultatif)')
        .addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('liste')
      .setDescription('Les absences en cours sur le serveur')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'liste') {
      const lignes = absences.enCours(interaction.guildId).map((a) => {
        const fin = a.fin ? `retour <t:${Math.floor(a.fin / 1000)}:R>` : 'durée indéterminée';
        return `<@${a.user_id}> — ${fin}`;
      });
      const embed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setTitle('📅 Absences en cours')
        .setDescription(M.description([
          lignes.length
            ? M.bloc('Qui manque', lignes, { prefixe: '👥', compte: lignes.length, motCompte: 'absence' })
            : '*Personne n\'est absent en ce moment.*',
        ]));
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // panneau — réservé au staff : c'est lui qui choisit où tout s'affiche.
    if (getGrade(interaction.member) < GRADES.STAFF) {
      return interaction.reply({
        content: '⛔ La **publication du panneau** est réservée au staff — la déclaration, elle, est ouverte à tout le monde.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const salonPanneau = interaction.options.getChannel('salon') || interaction.channel;
    const annonces = ['annonces', 'annonces2', 'annonces3']
      .map((n) => interaction.options.getChannel(n))
      .filter(Boolean);
    // Sans salon d'annonces choisi, les annonces iront là où le panneau vit.
    const salonsAnnonce = annonces.length ? annonces : [salonPanneau];

    const moi = interaction.guild.members.me;
    const illisibles = [salonPanneau, ...salonsAnnonce].filter((s) => {
      const droits = s.permissionsFor(moi);
      return !droits?.has('ViewChannel') || !droits?.has('SendMessages');
    });
    if (illisibles.length) {
      return interaction.reply({
        content: `❌ Je ne peux pas écrire dans ${illisibles.map((s) => `<#${s.id}>`).join(', ')}.`
          + '\n➜ Donnez-moi **Voir le salon** et **Envoyer des messages**, puis relancez.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await absences.publierPanneau(salonPanneau, salonsAnnonce);
    return interaction.reply({
      content: `✅ Panneau d'absences publié dans <#${salonPanneau.id}>.`
        + `\n➜ Les annonces partiront dans : ${salonsAnnonce.map((s) => `<#${s.id}>`).join(', ')}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
