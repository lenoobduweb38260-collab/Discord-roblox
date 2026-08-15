const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, PermissionFlagsBits } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { isCreator } = require('../utils/botTeam');
const { reglages, versEntier, DEFAUT_ACCENT } = require('../utils/styleEmbeds');
const M = require('../utils/miseEnPage');

// 🎨 Ré-applique l'identité visuelle aux messages DÉJÀ envoyés par le bot.
//
// L'identité posée sur la couche réseau ne vaut que pour les nouveaux
// messages : ceux publiés avant gardent leur ancienne apparence. Cette
// commande repasse dessus, sur TOUS les serveurs du bot d'un coup —
// l'esthétique appartient au bot, pas à un salon.
//
// Réservée au créateur du bot : elle modifie des messages partout à la fois.
//
// Elle ne touche QUE l'habillage — couleur, signature, ligne d'auteur,
// horodatage. Titre, texte, champs, images et boutons ne sont jamais modifiés.

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
  grade: GRADES.EVERYONE, // le contrôle réel est fait dans execute() : créateur uniquement
  data: new SlashCommandBuilder()
    .setName('esthetique')
    .setDescription('[Créateur] Ré-applique l\'esthétique du bot à tous ses anciens messages')
    .addSubcommand((sub) =>
      sub
        .setName('appliquer')
        .setDescription('Réhabille les anciens messages du bot sur TOUS ses serveurs')
        .addIntegerOption((o) =>
          o
            .setName('messages')
            .setDescription('Messages à examiner par salon (défaut 100, max 500)')
            .setMinValue(10)
            .setMaxValue(500)
            .setRequired(false)
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
    // 🔒 Créateur du bot uniquement : la commande touche à des messages sur
    // l'ensemble des serveurs, ce n'est pas une décision de serveur.
    if (!(await isCreator(interaction.client, interaction.user.id))) {
      return interaction.reply({
        content: '⛔ Réservé au **créateur du bot** : l\'esthétique appartient au bot et s\'applique sur tous ses serveurs à la fois.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const limite = interaction.options.getInteger('messages') || 100;
    const couleurs = interaction.options.getString('couleurs') || 'garder';

    // Le travail dépasse largement les 3 s de Discord : on accuse réception.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const totaux = { examines: 0, retouches: 0, conformes: 0, echecs: 0, salonsIgnores: 0 };
    const parServeur = [];
    const debut = Date.now();
    let dernierPoint = 0;

    // Petit compte rendu d'avancement : une opération globale peut durer
    // plusieurs minutes, on ne laisse pas l'utilisateur devant un écran muet.
    const avancement = async (serveurEnCours) => {
      if (Date.now() - dernierPoint < 5000) return;
      dernierPoint = Date.now();
      await interaction
        .editReply({
          content:
            `⏳ **${serveurEnCours}** en cours…\n` +
            `${totaux.retouches} message(s) réhabillé(s) · ${totaux.examines} examiné(s) · ` +
            `${parServeur.length}/${interaction.client.guilds.cache.size} serveur(s)`,
        })
        .catch(() => null);
    };

    for (const guild of interaction.client.guilds.cache.values()) {
      const r = reglages(guild.id);
      if (!r.actif) {
        parServeur.push({ nom: guild.name, ignore: 'identité désactivée' });
        continue;
      }
      const contexte = {
        reglages: { ...r, accent: r.accent ?? versEntier(DEFAUT_ACCENT) },
        bot: interaction.client.user.username,
        serveur: guild.name,
        icone: guild.iconURL({ size: 64 }) || null,
        couleurs,
      };

      let retouchesServeur = 0;
      let examinesServeur = 0;
      let ignoresServeur = 0;

      const salons = [...guild.channels.cache.values()].filter(
        (c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement
      );

      for (const salon of salons) {
        const droits = salon.permissionsFor(guild.members.me);
        if (!droits?.has(PermissionFlagsBits.ViewChannel) || !droits?.has(PermissionFlagsBits.ReadMessageHistory)) {
          ignoresServeur++;
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
            totaux.examines++;
            examinesServeur++;

            const nouveaux = [];
            let change = false;
            for (const embed of message.embeds) {
              const json = embed.toJSON ? embed.toJSON() : { ...embed.data };
              const refait = rehabiller(json, contexte);
              if (refait) { change = true; nouveaux.push(refait); } else nouveaux.push(json);
            }
            if (!change) { totaux.conformes++; continue; }

            const ok = await message.edit({ embeds: nouveaux }).then(() => true).catch(() => false);
            if (ok) { totaux.retouches++; retouchesServeur++; } else totaux.echecs++;
            // Discord limite le rythme des modifications : on souffle.
            await new Promise((res) => setTimeout(res, 250));
            await avancement(guild.name);
          }
          if (lot.size < 100) break;
        }
      }

      totaux.salonsIgnores += ignoresServeur;
      parServeur.push({ nom: guild.name, retouches: retouchesServeur, examines: examinesServeur, ignores: ignoresServeur });
      await avancement(guild.name);
    }

    const secondes = Math.round((Date.now() - debut) / 1000);
    const lignesServeurs = parServeur.map((s) =>
      s.ignore
        ? `**${s.nom}** — *${s.ignore}*`
        : `**${s.nom}** — ${s.retouches} réhabillé(s) sur ${s.examines} examiné(s)` +
          (s.ignores ? ` *(${s.ignores} salon(s) illisible(s))*` : '')
    );

    const blocs = [
      M.bloc('Résultat global', [
        `**${totaux.retouches}** message(s) réhabillé(s)`,
        `**${totaux.conformes}** déjà au bon format`,
        totaux.echecs ? `**${totaux.echecs}** échec(s) de modification` : null,
      ].filter(Boolean), { prefixe: '📊', compte: totaux.examines, motCompte: 'embed examiné' }),
      M.bloc('Réglages appliqués', [
        couleurs === 'uniformiser' ? 'Couleurs **uniformisées**' : 'Couleurs porteuses de sens **conservées**',
        `${limite} message(s) examiné(s) au maximum par salon`,
      ], { prefixe: '🎯', compte: null }),
    ];
    // La liste des serveurs peut être longue : on la borne.
    const pages = M.paginer(lignesServeurs.map((l) => M.entree(l)), { maxParPage: 20, budget: 1500 });
    blocs.push(
      M.bloc('Serveurs', pages[0] || [], { prefixe: '🌍', compte: parServeur.length, motCompte: 'serveur', vide: 'Aucun serveur' })
    );
    if (pages.length > 1) blocs.push(`*… et ${lignesServeurs.length - (pages[0]?.length || 0)} serveur(s) de plus.*`);

    const embed = new EmbedBuilder()
      .setTitle('🎨 Esthétique du bot ré-appliquée')
      .setDescription(M.borner(M.description(blocs), M.MAX_DESCRIPTION))
      .setFooter({ text: M.piedDePage({ total: totaux.examines, motTotal: 'embed examiné', extra: `en ${secondes} s` }) });

    return interaction.editReply({
      embeds: [embed],
      content: totaux.retouches
        ? null
        : 'ℹ️ Rien à changer : les messages examinés portent déjà l\'identité actuelle. Les messages **écrits par des membres** ou par **un autre bot** ne peuvent pas être modifiés — Discord ne l\'autorise pas.',
    });
  },
  // Exporté pour les tests.
  rehabiller,
  piedDIdentite,
};
