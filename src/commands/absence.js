const {
  SlashCommandBuilder, EmbedBuilder, ChannelType, MessageFlags,
  ActionRowBuilder, ChannelSelectMenuBuilder,
} = require('discord.js');
const { COLORS } = require('../utils/embeds');
const { GRADES, getGrade } = require('../utils/permissions');
const M = require('../utils/miseEnPage');
const absences = require('../utils/absences');

// 📅 /absence — publier le panneau, gérer les salons d'annonces, voir qui manque.
//
// Le panneau s'adresse à TOUT LE MONDE : n'importe qui déclare son absence en
// un clic. Sa publication et la liste des salons d'annonces, elles, sont au
// staff.
//
// ⚠️ Les salons d'annonces peuvent être TRENTE — bien plus que les 25 options
// qu'une commande accepte. La liste se gère donc en ADDITIF :
//   /absence salons ajouter    → un menu de 25 salons à la fois, rejouable
//   /absence salons categorie  → tous les salons textuels d'une catégorie
//   /absence salons retirer / liste / vider
// Chaque déclaration est copiée dans TOUS les salons de la liste, et chaque
// copie s'efface à la fin de l'absence.

const menuSalons = (geste) => new ActionRowBuilder().addComponents(
  new ChannelSelectMenuBuilder()
    .setCustomId(`abs:sel:${geste}`)
    .setPlaceholder(geste === 'ajouter' ? 'Salons à ajouter (25 max par passage)…' : 'Salons à retirer…')
    .setMinValues(1)
    .setMaxValues(25)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
);

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
        .addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('liste')
      .setDescription('Les absences en cours sur le serveur'))
    .addSubcommandGroup((g) => g.setName('salons')
      .setDescription('[Staff] Les salons où chaque absence est annoncée')
      .addSubcommand((s) => s.setName('ajouter')
        .setDescription('[Staff] Ajouter des salons d\'annonces — 25 à la fois, rejouable'))
      .addSubcommand((s) => s.setName('categorie')
        .setDescription('[Staff] Ajouter d\'un coup tous les salons textuels d\'une catégorie')
        .addChannelOption((o) => o.setName('categorie')
          .setDescription('La catégorie dont les salons deviennent des salons d\'annonces')
          .addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
      .addSubcommand((s) => s.setName('retirer')
        .setDescription('[Staff] Retirer des salons d\'annonces'))
      .addSubcommand((s) => s.setName('liste')
        .setDescription('[Staff] Voir les salons d\'annonces configurés'))
      .addSubcommand((s) => s.setName('vider')
        .setDescription('[Staff] Vider la liste des salons d\'annonces'))),

  async execute(interaction) {
    const groupe = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (!groupe && sub === 'liste') {
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

    // Tout le reste configure le système : staff uniquement.
    if (getGrade(interaction.member) < GRADES.STAFF) {
      return interaction.reply({
        content: '⛔ La **configuration des absences** est réservée au staff — la déclaration, elle, est ouverte à tout le monde.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (groupe === 'salons') return salons(interaction, sub);

    // ── panneau ──
    const salonPanneau = interaction.options.getChannel('salon') || interaction.channel;
    const moi = interaction.guild.members.me;
    const droits = salonPanneau.permissionsFor(moi);
    if (!droits?.has('ViewChannel') || !droits?.has('SendMessages')) {
      return interaction.reply({
        content: `❌ Je ne peux pas écrire dans <#${salonPanneau.id}>.`
          + '\n➜ Donnez-moi **Voir le salon** et **Envoyer des messages**, puis relancez.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await absences.publierPanneau(salonPanneau, []);
    const total = absences.listeSalons(interaction.guildId).length;
    return interaction.reply({
      content: `✅ Panneau d'absences publié dans <#${salonPanneau.id}>.`
        + (total
          ? `\n➜ Les annonces partiront dans les **${total}** salon(s) configurés (\`/absence salons liste\`).`
          : '\n➜ Aucun salon d\'annonces configuré : ajoutez-en avec `/absence salons ajouter` ou `/absence salons categorie`.'
            + '\n-# Sans liste, l\'annonce part dans le salon où le bouton est cliqué.'),
      flags: MessageFlags.Ephemeral,
    });
  },
};

// La gestion des salons d'annonces — en additif, sans plafond.
async function salons(interaction, sub) {
  if (sub === 'ajouter' || sub === 'retirer') {
    const total = absences.listeSalons(interaction.guildId).length;
    return interaction.reply({
      content: (sub === 'ajouter'
        ? `📣 Choisissez les salons à **ajouter** aux annonces d'absence (actuellement : **${total}**).`
        : `🗑️ Choisissez les salons à **retirer** des annonces d'absence (actuellement : **${total}**).`)
        + '\n-# 25 par passage — relancez la commande pour continuer.',
      components: [menuSalons(sub)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'categorie') {
    const categorie = interaction.options.getChannel('categorie');
    const enfants = [...(categorie.children?.cache?.values?.() || [])]
      .filter((c) => c.isTextBased?.());
    if (!enfants.length) {
      return interaction.reply({
        content: `❌ La catégorie **${categorie.name}** ne contient aucun salon textuel.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    const ajoutes = absences.ajouterSalons(interaction.guildId, enfants.map((c) => c.id));
    const total = absences.listeSalons(interaction.guildId).length;
    return interaction.reply({
      content: `✅ **${ajoutes}** salon(s) de la catégorie **${categorie.name}** ajouté(s) — **${total}** au total.`
        + (ajoutes < enfants.length ? `\n-# ${enfants.length - ajoutes} y étai(en)t déjà.` : ''),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'vider') {
    const n = absences.viderTousSalons(interaction.guildId);
    return interaction.reply({
      content: n
        ? `🗑️ Liste vidée : **${n}** salon(s) retiré(s).\n-# Sans liste, l'annonce part dans le salon où le bouton est cliqué.`
        : 'ℹ️ La liste était déjà vide.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // liste
  const ids = absences.listeSalons(interaction.guildId);
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('📣 Salons des annonces d\'absence')
    .setDescription(M.description([
      ids.length
        ? M.bloc('Chaque absence y est copiée', ids.map((id) => `<#${id}>`), { prefixe: '📣', compte: ids.length, motCompte: 'salon' })
        : '*Aucun salon configuré — l\'annonce part dans le salon où le bouton est cliqué.*\n➜ `/absence salons ajouter`, ou `/absence salons categorie` pour une catégorie entière.',
    ]));
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
