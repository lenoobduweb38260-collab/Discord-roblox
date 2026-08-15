const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, PermissionFlagsBits } = require('discord.js');
const { getGuildConfig } = require('../database');
const { GRADES, getGrade } = require('../utils/permissions');
const { reglages, versEntier, DEFAUT_ACCENT } = require('../utils/styleEmbeds');
const M = require('../utils/miseEnPage');

// 🎨 Ré-applique l'identité visuelle aux messages DÉJÀ envoyés.
//
// L'identité posée sur la couche réseau ne vaut que pour les nouveaux
// messages : ceux publiés avant gardent leur ancienne couleur. Cette commande
// repasse dessus.
//
// Elle ne touche QUE l'habillage — couleur, signature, ligne d'auteur,
// horodatage. Le titre, le texte, les champs, les images et les boutons ne
// sont jamais modifiés.

// Un pied de page fait-il partie de l'identité (donc remplaçable), ou dit-il
// quelque chose d'utile (« Page 2/4 », « Relancé par X ») qu'il faut garder ?
// Règle volontairement stricte : il doit contenir « • » ET se terminer par le
// nom du serveur, ce qui est exactement la forme « NomDuBot • NomDuServeur ».
function piedDIdentite(texte, nomServeur) {
  const t = String(texte || '').trim();
  if (!t || !nomServeur) return false;
  return t.includes(' • ') && t.endsWith(nomServeur);
}

// Réhabille un embed déjà publié. Renvoie null si rien ne change.
function rehabiller(json, contexte) {
  const r = contexte.reglages;
  const avant = JSON.stringify(json);
  const e = { ...json };

  if (contexte.couleurs === 'uniformiser') e.color = r.accent;
  else if (e.color === undefined || e.color === null) e.color = r.accent;

  if (r.piedDePage && contexte.serveur) {
    if (!e.footer?.text || piedDIdentite(e.footer.text, contexte.serveur)) {
      e.footer = { text: [contexte.bot, contexte.serveur].filter(Boolean).join(' • ') };
      if (contexte.icone) e.footer.icon_url = contexte.icone;
    }
  }
  // Ligne d'auteur : on ne remplace que celle qui EST l'identité (le nom du
  // serveur). « Avis de @membre » ou « Bienvenue sur … » sont conservés.
  if (r.ligneAuteur && contexte.serveur) {
    if (!e.author?.name || e.author.name === contexte.serveur) {
      e.author = { name: contexte.serveur };
      if (contexte.icone) e.author.icon_url = contexte.icone;
    }
  }
  if (r.horodatage && !e.timestamp) e.timestamp = new Date().toISOString();

  return JSON.stringify(e) === avant ? null : e;
}

module.exports = {
  grade: GRADES.ADMIN,
  data: new SlashCommandBuilder()
    .setName('esthetique')
    .setDescription('[Admin] Applique l\'identité visuelle aux messages déjà envoyés')
    .addSubcommand((sub) =>
      sub
        .setName('appliquer')
        .setDescription('Réhabille les anciens messages du bot (sans toucher à leur contenu)')
        .addChannelOption((o) =>
          o.setName('salon').setDescription('Un seul salon (défaut : tout le serveur)').setRequired(false)
        )
        .addIntegerOption((o) =>
          o.setName('messages').setDescription('Messages à examiner par salon (défaut 100, max 500)').setMinValue(10).setMaxValue(500).setRequired(false)
        )
        .addStringOption((o) =>
          o
            .setName('couleurs')
            .setDescription('Que faire des couleurs existantes ?')
            .setRequired(false)
            .addChoices(
              { name: 'Garder celles qui ont un sens (rouge = sanction…)', value: 'garder' },
              { name: 'Tout uniformiser sur la couleur d\'accent', value: 'uniformiser' }
            )
        )
    ),

  async execute(interaction) {
    const cfg = getGuildConfig(interaction.guildId);
    if (getGrade(interaction.member, cfg) < GRADES.ADMIN) {
      return interaction.reply({ content: '⛔ Réservé à l\'administration.', flags: MessageFlags.Ephemeral });
    }

    const r = reglages(interaction.guildId);
    if (!r.actif) {
      return interaction.reply({
        content: '❌ L\'identité visuelle est désactivée sur ce serveur. Activez-la d\'abord (site → 🎨 Identité des embeds).',
        flags: MessageFlags.Ephemeral,
      });
    }

    const salonChoisi = interaction.options.getChannel('salon');
    const limite = interaction.options.getInteger('messages') || 100;
    const couleurs = interaction.options.getString('couleurs') || 'garder';

    // Le travail dépasse largement les 3 s de Discord : on accuse réception.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const salons = salonChoisi
      ? [salonChoisi]
      : [...interaction.guild.channels.cache.values()].filter(
          (c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement
        );

    const contexte = {
      reglages: { ...r, accent: r.accent ?? versEntier(DEFAUT_ACCENT) },
      bot: interaction.client.user.username,
      serveur: interaction.guild.name,
      icone: interaction.guild.iconURL({ size: 64 }) || null,
      couleurs,
    };

    let examines = 0;
    let retouches = 0;
    let conformes = 0;
    let echecs = 0;
    const salonsIgnores = [];
    const debut = Date.now();

    for (const salon of salons) {
      const moi = salon.guild.members.me;
      const droits = salon.permissionsFor(moi);
      if (!droits?.has(PermissionFlagsBits.ViewChannel) || !droits?.has(PermissionFlagsBits.ReadMessageHistory)) {
        salonsIgnores.push(salon.name);
        continue;
      }

      let restants = limite;
      let avant = null;
      while (restants > 0) {
        const lot = await salon.messages
          .fetch({ limit: Math.min(100, restants), ...(avant ? { before: avant } : {}) })
          .catch(() => null);
        if (!lot || lot.size === 0) break;
        restants -= lot.size;
        avant = lot.last()?.id;

        for (const message of lot.values()) {
          // Un bot ne peut modifier QUE ses propres messages.
          if (message.author.id !== interaction.client.user.id) continue;
          if (!message.embeds?.length) continue;
          examines++;

          const nouveaux = [];
          let change = false;
          for (const embed of message.embeds) {
            const json = embed.toJSON ? embed.toJSON() : { ...embed.data };
            const refait = rehabiller(json, contexte);
            if (refait) { change = true; nouveaux.push(refait); } else nouveaux.push(json);
          }
          if (!change) { conformes++; continue; }

          const ok = await message.edit({ embeds: nouveaux }).then(() => true).catch(() => false);
          if (ok) retouches++;
          else echecs++;
          // Discord limite le rythme des modifications : on souffle.
          await new Promise((res) => setTimeout(res, 250));
        }
        if (lot.size < 100) break;
      }
    }

    const secondes = Math.round((Date.now() - debut) / 1000);
    const embed = new EmbedBuilder()
      .setTitle('🎨 Esthétique ré-appliquée')
      .setDescription(
        M.description([
          M.bloc('Résultat', [
            `**${retouches}** message(s) réhabillé(s)`,
            `**${conformes}** déjà au bon format`,
            echecs ? `**${echecs}** échec(s) de modification` : null,
          ].filter(Boolean), { prefixe: '📊', compte: examines, vide: 'Aucun message concerné' }),
          M.bloc('Portée', [
            salonChoisi ? `Salon <#${salonChoisi.id}>` : `${salons.length} salon(s) du serveur`,
            `${limite} message(s) examiné(s) au maximum par salon`,
            couleurs === 'uniformiser' ? 'Couleurs **uniformisées**' : 'Couleurs porteuses de sens **conservées**',
          ], { prefixe: '🎯', compte: null }),
          salonsIgnores.length
            ? M.bloc('Salons ignorés', salonsIgnores.slice(0, 10).map((n) => `#${n} — lecture impossible`), { prefixe: '⚠️', compte: salonsIgnores.length })
            : null,
        ])
      )
      .setFooter({ text: M.piedDePage({ total: examines, motTotal: 'embed examiné', extra: `en ${secondes} s` }) });

    return interaction.editReply({
      embeds: [embed],
      content: retouches
        ? null
        : 'ℹ️ Rien à changer : les messages examinés portent déjà l\'identité actuelle. Les messages **écrits par des membres** ou par **un autre bot** ne peuvent pas être modifiés — Discord ne l\'autorise pas.',
    });
  },
  // Exporté pour les tests.
  rehabiller,
  piedDIdentite,
};
