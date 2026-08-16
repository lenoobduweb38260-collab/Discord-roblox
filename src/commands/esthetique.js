const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, PermissionFlagsBits } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { isCreator } = require('../utils/botTeam');
const { reglages, versEntier, DEFAUT_ACCENT, styliserUn } = require('../utils/styleEmbeds');
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
// Ce qui est REFAIT : couleur, signature, ligne d'auteur, filet, bannière,
// horodatage, et la refonte des champs en sections.
// Ce qui est CONSERVÉ : chaque mot écrit dans l'embed — titre, texte, valeurs
// des champs, liens, images, boutons. L'ancien embed sert de réserve
// d'informations, le nouveau style vient se poser dessus.
//
// ⚠️ Pourquoi on MODIFIE au lieu de supprimer-puis-republier :
// un bot peut réécrire intégralement ses propres embeds. La modification
// donne donc exactement le même résultat visuel que la republication, mais
// elle garde ce qu'une suppression détruirait définitivement :
//   • les réactions déjà posées par les membres,
//   • les épingles,
//   • les liens vers le message (partagés ailleurs, dans des tickets…),
//   • les réponses accrochées au message,
//   • la date d'origine, et donc l'ordre de la conversation.
// Republier, c'est aussi re-notifier tout le monde et remonter de vieux
// messages en bas du salon. Le résultat serait identique, le coût non.

// Un pied de page fait-il partie de l'identité (donc remplaçable), ou dit-il
// quelque chose d'utile (« Page 2/4 », « Relancé par X ») qu'il faut garder ?
// Règle volontairement stricte : il doit contenir « • » ET se terminer par le
// nom du serveur, ce qui est exactement la forme « NomDuBot • NomDuServeur ».
function piedDIdentite(texte, nomServeur) {
  const t = String(texte || '').trim();
  if (!t || !nomServeur) return false;
  return t.includes(' • ') && t.endsWith(nomServeur);
}

// Remet tous les filets d'un texte à la longueur courante.
//
// Sans cela, un message publié à l'époque du filet de 28 signes garderait son
// trait trop long — celui qui repasse à la ligne sur téléphone. C'est
// précisément le « c'est encore les vieilles embed » constaté : le style
// avait changé, le vieux trait était resté.
//
// Une ligne faite UNIQUEMENT de « ─ » est un filet, jamais du contenu : on
// peut la remplacer sans risque.
function normaliserFilets(texte, filet) {
  if (typeof texte !== 'string' || !texte) return texte;
  return texte
    .split('\n')
    .map((l) => (/^\s*─{3,}\s*$/.test(l) ? filet : l))
    .join('\n');
}

// Comparaison « est-ce vraiment différent ? », insensible à l'ordre des clés.
//
// Effacer un pied de page périmé puis le réécrire le renvoie à la fin de
// l'objet : le texte JSON change alors que l'embed, lui, est identique. Sans
// cette précaution, chaque passage de la commande ré-éditerait tous les
// messages du serveur pour rien, et le compte « déjà au bon format » resterait
// désespérément à zéro.
function stable(valeur) {
  if (Array.isArray(valeur)) return `[${valeur.map(stable).join(',')}]`;
  if (valeur && typeof valeur === 'object') {
    return `{${Object.keys(valeur).sort().map((k) => `${JSON.stringify(k)}:${stable(valeur[k])}`).join(',')}}`;
  }
  return JSON.stringify(valeur);
}

// Réhabille un embed déjà publié. Renvoie null si rien ne change.
//
// 🔑 Le travail lui-même est fait par styliserUn — EXACTEMENT la fonction qui
// habille les nouveaux messages. C'est ce qui garantit qu'un vieil embed
// devient identique à un embed fraîchement envoyé : même filet, mêmes sections
// à la place des champs, même signature. Deux codes séparés auraient fini par
// diverger.
//
// Le rôle de cette fonction est de PRÉPARER le terrain : styliserUn ne comble
// que le vide, or un ancien message porte souvent l'ANCIENNE identité. On
// efface donc ce qui est de l'identité (et rien d'autre) avant de le laisser
// reconstruire.
//
// `dateOrigine` est la date de publication du message. Sans elle, styliserUn
// daterait d'AUJOURD'HUI un message écrit il y a six mois : l'embed afficherait
// une heure qui n'a jamais existé. On repose donc la vraie date.
function rehabiller(json, contexte, dateOrigine = null) {
  const avant = stable(json);
  const e = JSON.parse(JSON.stringify(json));
  const filet = contexte.reglages?.filet || '';

  // Couleur : « uniformiser » impose l'accent, sinon styliserUn ne comblera
  // que l'absence de couleur.
  if (contexte.couleurs === 'uniformiser') delete e.color;

  // Signature d'identité périmée → on l'efface pour qu'elle soit réécrite.
  // Un pied de page qui dit autre chose (« Page 2/4 ») est conservé.
  if (e.footer?.text && piedDIdentite(e.footer.text, contexte.serveur)) delete e.footer;
  // Idem pour la ligne d'auteur qui n'est QUE le nom du serveur.
  if (e.author?.name === contexte.serveur) delete e.author;

  // Filets d'une ancienne longueur → remis à la longueur du jour, aussi bien
  // celui du haut que ceux qui séparent les sections.
  if (filet) {
    if (typeof e.description === 'string') e.description = normaliserFilets(e.description, filet);
    if (Array.isArray(e.fields)) {
      for (const champ of e.fields) {
        if (champ && typeof champ.value === 'string') champ.value = normaliserFilets(champ.value, filet);
      }
    }
  }

  // La date du message, pas celle du réhabillage. Un serveur qui a coupé
  // l'horodatage n'en reçoit toujours pas.
  if (contexte.reglages?.horodatage && !e.timestamp && dateOrigine) {
    const d = new Date(dateOrigine);
    if (!Number.isNaN(d.getTime())) e.timestamp = d.toISOString();
  }

  styliserUn(e, contexte);

  return stable(e) === avant ? null : e;
}

module.exports = {
  grade: GRADES.EVERYONE, // le contrôle réel est fait dans execute() : créateur uniquement
  data: new SlashCommandBuilder()
    .setName('esthetique')
    .setDescription('[Créateur] Refait tous les anciens embeds du bot au style actuel')
    .addSubcommand((sub) =>
      sub
        .setName('appliquer')
        .setDescription('Reconstruit les anciens embeds au style actuel, sur TOUS les serveurs')
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
              const refait = rehabiller(json, contexte, message.createdAt);
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
      M.bloc('Ce qui a été refait', [
        'Champs d\'embed → **sections** ◆ / ➜',
        'Filet, bannière, signature et ligne d\'auteur **remis à la version du jour**',
        couleurs === 'uniformiser' ? 'Couleurs **uniformisées**' : 'Couleurs porteuses de sens **conservées**',
        `${limite} message(s) examiné(s) au maximum par salon`,
      ], { prefixe: '🎯', compte: null }),
    ];
    // La liste des serveurs peut être longue : on la borne.
    // ⚠️ Lignes brutes : c'est M.bloc qui pose la flèche ➜. Les préfixer ici
    // donnerait « ➜ ➜ Nom ».
    const pages = M.paginer(lignesServeurs, { maxParPage: 20, budget: 1500 });
    blocs.push(
      M.bloc('Serveurs', pages[0] || [], { prefixe: '🌍', compte: parServeur.length, motCompte: 'serveur', vide: 'Aucun serveur' })
    );
    if (pages.length > 1) blocs.push(`*… et ${lignesServeurs.length - (pages[0]?.length || 0)} serveur(s) de plus.*`);

    const embed = new EmbedBuilder()
      .setTitle('🎨 Anciens embeds refaits au style actuel')
      .setDescription(M.borner(M.description(blocs), M.MAX_DESCRIPTION))
      .setFooter({ text: M.piedDePage({ total: totaux.examines, motTotal: 'embed examiné', extra: `en ${secondes} s` }) });

    return interaction.editReply({
      embeds: [embed],
      content: totaux.retouches
        ? '♻️ Les embeds ont été **reconstruits sur place** : réactions, épingles, réponses et liens vers les messages sont conservés — une suppression suivie d\'un renvoi les aurait tous perdus.'
        : 'ℹ️ Rien à changer : les messages examinés portent déjà le style actuel. Les messages **écrits par des membres** ou par **un autre bot** ne peuvent pas être refaits — Discord ne laisse un bot modifier que ses propres messages.',
    });
  },
  // Exporté pour les tests.
  rehabiller,
  piedDIdentite,
  normaliserFilets,
};
