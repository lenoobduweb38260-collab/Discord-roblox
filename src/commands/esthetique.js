const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, PermissionFlagsBits } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { isCreator } = require('../utils/botTeam');
const { reglages, versEntier, DEFAUT_ACCENT, styliserUn } = require('../utils/styleEmbeds');
const { convertirCorps } = require('../utils/cartes');
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

// ♻️ Republie un message sous forme de carte sans bordure, puis efface
// l'ancien.
//
// C'est le SEUL moyen de convertir un message déjà envoyé : Discord fige à la
// création la famille de composants d'un message. Un embed ne devient pas une
// carte par simple modification, quelles que soient les permissions.
//
// Renvoie :
//   • true  → recréé
//   • false → tentative échouée (l'ancien message est laissé intact)
//   • null  → non convertible ; à l'appelant de retomber sur la modification
async function recreerEnCarte(message, embeds, r) {
  const corps = convertirCorps(
    { content: message.content || '', embeds, components: message.components?.map((c) => (c.toJSON ? c.toJSON() : c)) || [] },
    { bordure: r.bordure, titre: r.titre }
  );
  if (!corps) return null;

  // Republier ne doit RE-NOTIFIER personne : le message d'origine a déjà
  // sonné chez tout le monde à l'époque.
  corps.allowed_mentions = { parse: [] };

  const envoye = await message.channel.send(corps).catch(() => null);
  if (!envoye) return null;

  // L'épingle est la seule chose récupérable : on la repose.
  if (message.pinned) await envoye.pin().catch(() => null);

  const efface = await message.delete().then(() => true).catch(() => false);
  if (!efface) {
    // On ne laisse pas deux exemplaires du même message dans le salon.
    await envoye.delete().catch(() => null);
    return false;
  }
  return true;
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
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('Comment traiter les anciens messages ?')
            .setRequired(false)
            .addChoices(
              { name: 'Modifier sur place — garde réactions, épingles et liens', value: 'modifier' },
              { name: 'Recréer en cartes sans bordure — perd réactions et liens', value: 'recreer' }
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
    // « modifier » garde tout mais laisse l'embed en embed ; « recréer » est
    // le seul moyen d'obtenir une carte sans bordure sur un ancien message,
    // parce que Discord fige la famille de composants à la création.
    const mode = interaction.options.getString('mode') === 'recreer' ? 'recreer' : 'modifier';

    // Le travail dépasse largement les 3 s de Discord : on accuse réception,
    // en disant tout de suite où le compte rendu arrivera. Un balayage de
    // plusieurs dizaines de salons peut dépasser la durée de vie de la
    // réponse, et un écran muet passerait pour une commande plantée.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction
      .editReply({
        content:
          '⏳ Balayage lancé sur **tous les serveurs** du bot.\n' +
          '-# Le compte rendu s\'affichera ici, ou en message privé si le balayage dure plus que la réponse de la commande.',
      })
      .catch(() => null);

    const totaux = {
      examines: 0, retouches: 0, conformes: 0, echecs: 0, salonsIgnores: 0, recrees: 0,
      // Messages qui resteront des embeds — donc garderont leur barre colorée
      // — parce que seule la recréation peut en faire des cartes.
      aRecreer: 0,
    };
    const parServeur = [];
    const debut = Date.now();
    let dernierPoint = 0;

    // ⏳ Un jeton d'interaction Discord vit 15 minutes : passé ce délai, le bot
    // ne peut plus modifier sa réponse.
    //
    // Cette limite ne contraint QUE l'affichage. Le balayage, lui, va jusqu'au
    // bout : sa fin, c'est d'avoir fait ce qu'on lui a demandé, pas une
    // échéance au chronomètre. Le travail est fini par nature — serveurs ×
    // salons × messages — donc aucune borne de temps ne peut que le tronquer.
    const JETON = 14 * 60 * 1000;
    const jetonVivant = () => Date.now() - debut < JETON;
    // Quand l'affichage expire, on prévient UNE fois en privé que ça continue :
    // vingt minutes d'écran figé passeraient pour une commande plantée.
    let relaisEnvoye = false;
    const prevenirQueCaContinue = async () => {
      if (relaisEnvoye || jetonVivant()) return;
      relaisEnvoye = true;
      await interaction.user
        .send(
          '⏳ Le balayage de `/esthetique` **continue** : il a dépassé la durée de vie de la réponse de la commande.\n' +
          '-# Je t\'envoie le compte rendu ici dès qu\'il est terminé — rien n\'est interrompu.'
        )
        .catch(() => null);
    };

    // Compte rendu d'avancement, tant que la réponse peut être modifiée.
    // Appelé à chaque salon et non plus seulement après une modification :
    // sur un serveur où le bot a peu écrit, l'écran restait muet.
    const avancement = async (serveurEnCours, salonEnCours = null) => {
      if (!jetonVivant()) return;
      if (Date.now() - dernierPoint < 5000) return;
      dernierPoint = Date.now();
      const ecoule = Math.round((Date.now() - debut) / 1000);
      await interaction
        .editReply({
          content:
            `⏳ **${serveurEnCours}**${salonEnCours ? ` · #${salonEnCours}` : ''} en cours…\n` +
            `${totaux.retouches} refait(s) · ${totaux.examines} embed(s) examiné(s) · ` +
            `${parServeur.length}/${interaction.client.guilds.cache.size} serveur(s)\n` +
            `-# ${Math.floor(ecoule / 60)} min ${ecoule % 60} s écoulées · le compte rendu arrivera en message privé si l'affichage expire`,
        })
        .catch(() => null);
    };

    for (const guild of interaction.client.guilds.cache.values()) {
      await prevenirQueCaContinue();
      // Un serveur en échec ne doit pas emporter tout le balayage avec lui.
      try {
        const r = reglages(guild.id);
        if (!r.actif) {
          parServeur.push({ nom: guild.name, ignore: 'identité désactivée' });
          continue;
        }

        // ⚠️ Sans le membre « bot », permissionsFor renvoie null et TOUS les
        // salons seraient déclarés illisibles : la commande se terminerait sur
        // « rien à changer » en n'ayant rien regardé.
        const moi = guild.members.me || (await guild.members.fetchMe().catch(() => null));
        if (!moi) {
          parServeur.push({ nom: guild.name, ignore: 'bot introuvable sur ce serveur' });
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
          await prevenirQueCaContinue();
          const droits = salon.permissionsFor(moi);
          if (!droits?.has(PermissionFlagsBits.ViewChannel) || !droits?.has(PermissionFlagsBits.ReadMessageHistory)) {
            ignoresServeur++;
            continue;
          }
          await avancement(guild.name, salon.name);

          let restants = limite;
          let avant = null;
          while (restants > 0) {
            const lot = await salon.messages
              .fetch({ limit: Math.min(100, restants), ...(avant ? { before: avant } : {}) })
              .catch(() => null);
            if (!lot || lot.size === 0) break;
            restants -= lot.size;
            avant = lot.last()?.id;
            await avancement(guild.name, salon.name);

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

              // ── Recréation en carte sans bordure ──
              // Seul chemin possible vers une carte pour un message déjà
              // envoyé : Discord fige la famille de composants à la création.
              if (mode === 'recreer' && r.cartes) {
                const recree = await recreerEnCarte(message, nouveaux, r);
                if (recree === true) {
                  totaux.recrees++; totaux.retouches++; retouchesServeur++;
                  await new Promise((res) => setTimeout(res, 400));
                  await avancement(guild.name, salon.name);
                  continue;
                }
                if (recree === false) { totaux.echecs++; continue; }
                // null → non convertible : on retombe sur la modification.
              } else if (r.cartes) {
                // On modifie, donc ce message RESTE un embed : il gardera sa
                // barre colorée. C'est la cause du « rien n'a changé » quand
                // on attendait des cartes — il faut le dire, pas le taire.
                totaux.aRecreer++;
              }

              if (!change) { totaux.conformes++; continue; }

              const ok = await message.edit({ embeds: nouveaux }).then(() => true).catch(() => false);
              if (ok) { totaux.retouches++; retouchesServeur++; } else totaux.echecs++;
              // Discord limite le rythme des modifications : on souffle.
              await new Promise((res) => setTimeout(res, 250));
              await avancement(guild.name, salon.name);
            }
            if (lot.size < 100) break;
          }
        }

        totaux.salonsIgnores += ignoresServeur;
        parServeur.push({ nom: guild.name, retouches: retouchesServeur, examines: examinesServeur, ignores: ignoresServeur });
        await avancement(guild.name);
      } catch (err) {
        parServeur.push({ nom: guild.name, ignore: `échec : ${String(err.message || err).slice(0, 80)}` });
      }
    }

    const secondes = Math.round((Date.now() - debut) / 1000);
    // Un balayage complet peut durer longtemps : « en 4271 s » ne se lit pas.
    const duree = secondes < 60
      ? `en ${secondes} s`
      : `en ${Math.floor(secondes / 60)} min ${String(secondes % 60).padStart(2, '0')} s`;
    const lignesServeurs = parServeur.map((s) =>
      s.ignore
        ? `**${s.nom}** — *${s.ignore}*`
        : `**${s.nom}** — ${s.retouches} réhabillé(s) sur ${s.examines} examiné(s)` +
          (s.ignores ? ` *(${s.ignores} salon(s) illisible(s))*` : '')
    );

    const blocs = [
      M.bloc('Résultat global', [
        `**${totaux.retouches}** message(s) refait(s)`,
        `**${totaux.conformes}** déjà au bon format`,
        totaux.echecs ? `**${totaux.echecs}** échec(s)` : null,
      ].filter(Boolean), { prefixe: '📊', compte: totaux.examines, motCompte: 'embed examiné' }),
      M.bloc('Ce qui a été refait', [
        'Champs d\'embed → **sections** ◆ / ➜',
        'Filet, bannière, signature et ligne d\'auteur **remis à la version du jour**',
        couleurs === 'uniformiser' ? 'Couleurs **uniformisées**' : 'Couleurs porteuses de sens **conservées**',
        mode === 'recreer'
          ? `**${totaux.recrees}** message(s) recréé(s) en carte — réactions, réponses et liens vers ces messages sont perdus`
          : 'Modifiés **sur place** : réactions, épingles et liens conservés',
        `${limite} message(s) examiné(s) au maximum par salon`,
      ], { prefixe: '🎯', compte: null }),
    ];

    // ⚠️ Le point qui manquait : en mode « modifier », un ancien embed RESTE un
    // embed. Il garde donc sa barre colorée à gauche, et de l'extérieur « rien
    // n'a changé » — alors que la commande a bien travaillé. Discord fige la
    // famille de composants d'un message à sa création : seule la recréation
    // peut transformer un embed en carte.
    if (mode !== 'recreer' && totaux.aRecreer) {
      blocs.push(M.bloc('⚠️ Pourquoi la barre colorée est toujours là', [
        `**${totaux.aRecreer}** message(s) restent des embeds : ils gardent leur barre verticale colorée`,
        'Discord **fige** la famille de composants d\'un message à sa création — aucune modification ne transforme un embed en carte',
        'Pour les convertir : `/esthetique appliquer mode:Recréer`',
        '➜ à savoir : la recréation **perd** réactions, réponses accrochées, liens partagés et date d\'origine',
      ], { prefixe: '🃏', compte: null }));
    }

    // La liste des serveurs peut être longue : on la borne.
    // ⚠️ Lignes brutes : c'est M.bloc qui pose la flèche ➜. Les préfixer ici
    // donnerait « ➜ ➜ Nom ».
    const pages = M.paginer(lignesServeurs, { maxParPage: 20, budget: 1200 });
    blocs.push(
      M.bloc('Serveurs', pages[0] || [], { prefixe: '🌍', compte: parServeur.length, motCompte: 'serveur', vide: 'Aucun serveur' })
    );
    if (pages.length > 1) blocs.push(`*… et ${lignesServeurs.length - (pages[0]?.length || 0)} serveur(s) de plus.*`);

    const embed = new EmbedBuilder()
      .setTitle('🎨 Anciens embeds refaits au style actuel')
      .setDescription(M.borner(M.description(blocs), M.MAX_DESCRIPTION))
      .setFooter({ text: M.piedDePage({ total: totaux.examines, motTotal: 'embed examiné', extra: duree }) });

    let entete;
    if (mode !== 'recreer' && totaux.aRecreer) {
      entete = `🃏 **${totaux.aRecreer} message(s) gardent leur barre colorée.** Un embed déjà envoyé ne peut pas devenir une carte : relancez avec **mode : Recréer** si vous acceptez d'en perdre les réactions et les liens.`;
    } else if (totaux.retouches) {
      entete = mode === 'recreer'
        ? '♻️ Messages **recréés en cartes**. Réactions, réponses et liens vers les anciens messages sont perdus — c\'était le prix de la conversion.'
        : '♻️ Embeds **reconstruits sur place** : réactions, épingles, réponses et liens conservés.';
    } else {
      entete = 'ℹ️ Rien à changer : les messages examinés portent déjà le style actuel. Ceux écrits par **un membre** ou **un autre bot** ne sont pas modifiables — Discord ne l\'autorise pas.';
    }

    // 📬 Livraison du compte rendu.
    //
    // Si la réponse est encore modifiable, on l'affiche là où l'utilisateur
    // l'attend. Sinon — balayage long — on l'envoie en privé : c'est ce qui
    // permet au balayage d'aller jusqu'au bout au lieu de s'arrêter avant
    // l'expiration du jeton.
    const rendu = { embeds: [embed], content: entete };
    if (jetonVivant()) {
      const affiche = await interaction.editReply(rendu).then(() => true).catch(() => false);
      if (affiche) return null;
    }
    const prive = await interaction.user
      .send({ ...rendu, content: `${entete}\n-# Envoyé en privé : le balayage a duré plus longtemps que la réponse de la commande.` })
      .then(() => true)
      .catch(() => false);
    if (!prive) {
      console.warn('⚠️ /esthetique : compte rendu non remis (réponse expirée et messages privés fermés).');
    }
    return null;
  },
  // Exporté pour les tests.
  rehabiller,
  piedDIdentite,
  normaliserFilets,
};
