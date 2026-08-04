// ----- 📝 Notes de mise à jour (patch notes) automatiques -----
// Le bot publie lui-même ses notes de mise à jour dans le salon configuré par
// serveur (patch_channel_id). Elles sont TOUJOURS découpées en 4 catégories —
// 🆕 Ajout / 🔧 Fix / ✨ Amélioration / ➖ Retrait — et indiquent clairement que
// les changements prennent effet immédiatement.
//
// Fonctionnement :
//  • La 1re entrée (id « initial ») récapitule TOUT ce qui a été fait depuis le
//    début et est annoncée UNE SEULE FOIS avec @everyone.
//  • Chaque entrée suivante = une version, annoncée avec @here (ses changements
//    uniquement).
//  • Un marqueur en base (app_state『patch_notes_pos』) mémorise la dernière
//    entrée déjà publiée : à chaque démarrage, seules les nouvelles sont
//    envoyées.
//
// ⚠️ Règle : les notes ne concernent QUE les utilisateurs. Rien de ce qui
// touche l'équipe/le staff du bot n'y figure.

const { EmbedBuilder } = require('discord.js');
const { db, getGuildConfig } = require('../database');

const IMMEDIATE = '⚡ **Ces changements prennent effet immédiatement.**';

// ----- Journal des versions -----
const RELEASES = [
  {
    id: 'initial',
    title: 'Récapitulatif complet — tout ce que le bot propose',
    everyone: true,
    ajout: [
      '🪪 Cartes d\'identité RP partagées sur tous les serveurs (`/carte`)',
      '🚗 Permis de conduire à points (`/permis`)',
      '🏢 Entreprises avec patrons & employés (`/entreprise`)',
      '🛡️ Assurances véhicule (`/assurance`)',
      '🌐 Identité RP globale : cartes, permis et entreprises suivent le joueur partout',
      '🧑‍💼 Prises de service et pointage (`/service`, `/arrivee`, `/depart`)',
      '📋 Whitelist métiers avec attribution automatique du rôle (`/whitelist`)',
      '📈 Niveaux écrit & vocal avec carte personnalisable (`/niveau`)',
      '🎫 Tickets avec catégories et plusieurs rôles support (`/ticket`)',
      '🔨 Modération : `/ban`, `/kick`, `/mute`, `/unmute`, `/banglobal`',
      '⚠️ Avertissements RP à points (`/warnrp`)',
      '⛔ Blacklist RP & ✅ Whitelist RP (recherche intégrée, tri auto)',
      '🗂️ Casier RP pour suivre les blacklists (`/casier`)',
      '🕵️ Snipe : récupération des messages supprimés/modifiés (`/snipe`)',
      '🛡️ Sécurité : anti-nuke, anti-spam et anti-injection',
      '🤖 Captcha de vérification à l\'arrivée des membres',
      '👋 Messages de bienvenue et de départ (salon de départ séparé)',
      '🤝 Partenariats : proposition → validation staff → publication auto',
      '🎮 Interactions façon Nekotina : câlins, bisous, tapes… (`/interact`)',
      '🎴 Vgache : gacha de VTubeuses Twitch francophones (`/vgache`)',
      '⚔️ Aventure SAO : 100 étages d\'Aincrad, boss, badges, XP auto & AFK (`/sao`)',
      '🎵 Musique en vocal : YouTube, Spotify, Deezer, SoundCloud (`/musique`)',
      '🔊 Logs vocaux et logs de rôles (création / modification / suppression)',
      '📢 Réseaux sociaux : lives Twitch, vidéos YouTube/TikTok/X/Reddit (`/reseaux`)',
      '🛑 Protection anti-scam par image',
      '📝 Salon de patch notes configurable + ces notes automatiques',
      '⚙️ Panneau `/config` centralisé avec aperçus d\'embed en direct',
    ],
    fix: [
      '🏢 Les médias d\'entreprise acceptent désormais un fichier ET un lien',
      '🔒 Diverses corrections de stabilité et de sécurité',
    ],
    amelioration: [
      '🔎 Aperçu en direct de chaque message/embed avant son envoi dans un salon',
      '🎫 Plusieurs rôles support configurables par type de ticket',
      '🔤 Blacklist/Whitelist RP triées par ordre alphabétique avec recherche',
      '🌍 Interactions traduites automatiquement selon la langue de chaque membre',
      '🎭 Modules activables par serveur (RP, Interactions, Aventure SAO)',
      '⚙️ Toute la configuration regroupée dans `/config`, mise à jour en direct',
    ],
    retrait: ['Aucun retrait — c\'est la version de lancement 🎉'],
  },
  {
    id: 'entreprises-police-2026-07',
    title: 'Entreprises, assurances, police & whitelist',
    ajout: [
      '🎨 Assurance véhicule : la **couleur** du véhicule est désormais demandée et affichée',
      '⚖️ Nouveau **casier judiciaire** (`/casierjudiciaire`) réservé aux rôles Police',
      '🎭 La **Whitelist RP** attribue automatiquement un rôle configurable au membre',
    ],
    fix: [
      '🏢 Correction d\'un plantage de `/entreprise` quand le média n\'était pas un lien valide',
      '🛡️ Correction du message « entreprise introuvable » lors du choix des types d\'assurance',
    ],
    amelioration: [
      '📋 Un gérant peut être autorisé à whitelister **plusieurs rôles métier** d\'un coup',
      '🚗 Retrait de points de permis désormais possible pour la **police** (en plus du staff)',
      '🏢 `/entreprise modifier` : nouveau champ **« type d\'assurance »** pour changer les types',
      '⚙️ `/config` : rôles **Police** et **rôle Whitelist RP** configurables',
    ],
    retrait: [],
  },
  {
    id: 'assurance-carte-warn-2026-07b',
    title: 'Assurances, cartes & warns',
    ajout: [
      '🚗 Assurance véhicule : **photo** du véhicule et **dates de validité** (validation → expiration, avec valide/expirée)',
      '🚓 Statut police d\'un véhicule : 🚨 recherché et 🅿️ fourrière, via `/assurance statut`',
      '🔎 `/assurance voir <n°>` : consulter un contrat (photo, validité, statut police)',
      '🏢 `/carte voir` affiche désormais l\'**entreprise et le métier** de la personne (patron/employé)',
    ],
    amelioration: [
      '👁️ `/warnrp voir` est désormais **visible par tout le monde** (les actions warn/points restent privées)',
      '⚙️ `/config` : les rôles (Staff, Admin, Police, support tickets) **s\'accumulent** à l\'ajout au lieu de se remplacer',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'ticket-emoji-picker-2026-07c',
    title: 'Emoji des tickets en un clic',
    amelioration: [
      '🎫 Création d\'un type de ticket : l\'emoji se choisit désormais dans une **bulle cliquable** — plus besoin de le taper à la main',
      '😀 La bulle propose les **emojis du serveur** ainsi que des emojis classiques prêts à l\'emploi',
    ],
    ajout: [],
    fix: [
      '🎫 Correction d\'un **plantage du panneau de tickets** (`/ticket panneau`) lorsqu\'un type utilisait un emoji non valide : les emojis incorrects sont désormais ignorés au lieu de bloquer l\'affichage',
    ],
    retrait: [],
  },
  {
    id: 'ticket-panneau-2026-07d',
    title: 'Panneau de tickets : contenu, image & modification',
    ajout: [
      '🖼️ Image/GIF du panneau de tickets : vous pouvez maintenant **l\'uploader depuis votre PC** (en plus de l\'URL)',
    ],
    amelioration: [
      '✏️ Le **texte du panneau** (titre, description, message, pied de page) se saisit dans un **formulaire** : on peut enfin y faire de **vrais retours à la ligne**',
      '🗂️ `/ticket panneau-modifier` : quand plusieurs panneaux existent, un **menu permet de choisir lequel modifier**',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'ticket-bloquer-2026-07e',
    title: 'Bloquer / réactiver une raison de ticket',
    ajout: [
      '🔒 Nouvelle commande `/ticket bloquer` : **ferme temporairement** une raison de ticket — plus personne ne peut l\'ouvrir',
      '🔓 `/ticket debloquer` : **réactive** une raison mise en pause, sans avoir à la recréer',
    ],
    amelioration: [
      '🎫 `/ticket types` indique désormais les raisons **bloquées** 🔒',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'ticket-fermeture-auto-2026-07f',
    title: 'Tickets : fermeture, archive & suppression auto',
    ajout: [
      '📄 Nouveau **salon de transcripts** configurable dans `/config` → Salons (par défaut : le salon de logs)',
    ],
    amelioration: [
      '🔒 Fermer un ticket **envoie le transcript** (100 derniers messages) puis **supprime le salon automatiquement** — plus besoin du bouton « Supprimer »',
      '📄 Le transcript part dans le **salon dédié** s\'il est configuré, sinon dans le **salon de logs** par défaut',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'ticket-fiabilite-2026-07g',
    title: 'Tickets plus fiables à l\'ouverture',
    fix: [
      '🎫 Ouverture de ticket plus fiable : le bot **répond immédiatement** avant de créer le salon, ce qui réduit les erreurs « interaction expirée » sur les connexions un peu lentes',
    ],
    ajout: [],
    amelioration: [],
    retrait: [],
  },
  {
    id: 'ticket-membres-2026-07h',
    title: 'Tickets : ajouter un membre & ouvrir pour quelqu\'un',
    ajout: [
      '➕ `/ticket ajouter` : **ajouter un membre** à un ticket en cours (à utiliser dans le salon du ticket)',
      '🎫 `/ticket creer-pour` : **ouvrir un ticket au nom d\'un membre** (par le staff)',
    ],
    fix: [
      '🔁 Menu déroulant des raisons : on peut désormais **re-sélectionner la même raison** (le menu se réinitialise après chaque choix)',
    ],
    amelioration: [],
    retrait: [],
  },
  {
    id: 'heure-francaise-2026-07i',
    title: 'Heures toujours en heure française',
    amelioration: [
      '🕐 Toutes les dates/heures affichées par le bot (dont les **transcripts** de tickets) sont désormais **toujours en heure française** (Europe/Paris), quel que soit l\'hébergement',
    ],
    ajout: [],
    fix: [],
    retrait: [],
  },
  {
    id: 'ticket-fermeture-robuste-2026-07j',
    title: 'Fermeture de ticket plus fiable',
    fix: [
      '🔒 Fermer un ticket ne renvoie plus « Ticket introuvable » à tort : le ticket est retrouvé **par son salon**, et le salon est **fermé/supprimé quand même** même si la base est momentanément désynchronisée',
    ],
    ajout: [],
    amelioration: [],
    retrait: [],
  },
  {
    id: 'assurance-types-niveaux-2026-07k',
    title: '4 types d\'assurance, niveaux par serveur',
    ajout: [
      '🛡️ `/assurance assigner` propose désormais **4 types de contrat** : 🚗 Véhicule, 🏠 Maison (bâtiment + unité), 🏢 Entreprise et ⚕️ Santé — chacun avec ses propres champs',
      '📊 `/config` → 📈 XP & niveaux : le **système de niveaux s\'active/désactive par serveur**',
    ],
    amelioration: [
      '📢 Les montées de niveau ne s\'annoncent plus que dans le **salon dédié** configuré (plus d\'annonces dans n\'importe quel salon)',
      '🔴 Un véhicule **recherché** ou **en fourrière** est signalé par un **rond rouge** bien visible (fiche et liste des contrats)',
      '📅 L\'option `debut` des assurances s\'appelle désormais **`delivrance`**',
      '🏢 Chaque type de contrat vérifie que l\'assureur a coché le **type d\'assurance correspondant** (Véhicule/Habitation/Entreprise/Maladie)',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'dashboard-sao-2026-08a',
    title: 'Dashboard web : thème Aincrad & connexion simplifiée',
    ajout: [
      '⚔️ Le **dashboard web** fait peau neuve avec un **thème Sword Art Online / Aincrad** (ciel nocturne, panneaux d\'acier bleuté, lueurs cyan)',
    ],
    amelioration: [
      '🔗 **Connexion Discord fiabilisée** : l\'URL de redirection est **détectée automatiquement** (https/www/sous-dossier/proxy) — fini les erreurs « redirect_uri non valide »',
      '📋 L\'URL exacte à enregistrer côté Discord s\'affiche sur la page d\'accueil et le diagnostic du dashboard, avec un **bouton Copier**',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'dashboard-monde-2026-08b',
    title: 'Dashboard : entrez dans l\'Aincrad 🗡️',
    ajout: [
      '🗡️ **Page d\'accueil immersive** : séquence LINK START, château d\'Aincrad flottant, étoiles filantes et citations de la série',
      '📜 **Composez votre page d\'accueil** : messages défilants (annonces, événements…) éditables depuis l\'espace Créateur — ajoutez, réordonnez, supprimez',
      '🤖 **Choix du bot à inviter** : la page d\'accueil propose chaque bot (Shadow Community, Colmar RP…) — le visiteur ajoute exactement celui qu\'il veut',
      '👑 **Sections créateur par bot** : le créateur voit TOUS les serveurs de chaque bot (même sans y être membre) et peut les configurer à distance',
    ],
    amelioration: [
      '✨ **Interface connectée refaite** : fenêtres système translucides, cartes serveur façon carte de quête, barre de vie SAO sous le pseudo, lueurs cyan',
    ],
    fix: [
      '🚫 **/blacklist répond à nouveau** : l\'action est accusée immédiatement puis exécutée (MP + bans multi-serveurs) — fini « l\'application ne répond pas »',
    ],
    retrait: [],
  },
];

// Découpe une catégorie en champs d'embed (max 1024 caractères par champ).
function addChunked(embed, name, value) {
  const raw = Array.isArray(value) ? value.slice() : String(value || '').split('\n');
  const bullets = raw
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith('•') ? l : `• ${l}`));
  if (!bullets.length) return;
  let buf = [];
  let len = 0;
  let part = 0;
  const flush = () => {
    if (!buf.length) return;
    embed.addFields({ name: part === 0 ? name : `${name} (suite)`, value: buf.join('\n').slice(0, 1024) });
    buf = [];
    len = 0;
    part += 1;
  };
  for (const b of bullets) {
    if (len + b.length + 1 > 1000) flush();
    buf.push(b);
    len += b.length + 1;
  }
  flush();
}

// Construit l'embed d'une note à partir d'une entrée { title, ajout, fix,
// amelioration, retrait }. Chaque catégorie accepte un tableau OU un texte.
function buildEmbed(entry) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📝 ${entry.title || 'Note de mise à jour'}`)
    .setDescription(IMMEDIATE)
    .setTimestamp();
  addChunked(embed, '🆕 Ajout', entry.ajout);
  addChunked(embed, '🔧 Fix', entry.fix);
  addChunked(embed, '✨ Amélioration', entry.amelioration);
  addChunked(embed, '➖ Retrait', entry.retrait);
  embed.setFooter({ text: 'Note de mise à jour du bot' });
  return embed;
}

const getPos = db.prepare("SELECT value FROM app_state WHERE key = 'patch_notes_pos'");
const setPos = db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('patch_notes_pos', ?)");

// Publie une note dans le salon patch note de chaque serveur qui en a configuré un.
async function broadcast(client, entry) {
  const embed = buildEmbed(entry);
  const mention = entry.everyone ? '@everyone' : '@here';
  let count = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      const cfg = getGuildConfig(guild.id);
      if (!cfg.patch_channel_id) continue;
      const channel = await guild.channels.fetch(cfg.patch_channel_id).catch(() => null);
      if (!channel?.isTextBased()) continue;
      const ok = await channel
        .send({ content: mention, embeds: [embed], allowedMentions: { parse: ['everyone'] } })
        .then(() => true)
        .catch(() => false);
      if (ok) count += 1;
    } catch {
      // un serveur en échec ne doit pas bloquer les autres
    }
  }
  return count;
}

function currentPos() {
  try {
    const row = getPos.get();
    const n = row ? parseInt(row.value, 10) : -1;
    return Number.isNaN(n) ? -1 : n;
  } catch {
    return -1;
  }
}

// Au démarrage : publie toute entrée pas encore annoncée (dans l'ordre).
async function start(client) {
  for (let i = currentPos() + 1; i < RELEASES.length; i++) {
    const count = await broadcast(client, RELEASES[i]);
    setPos.run(String(i));
    console.log(`📝 Patch note « ${RELEASES[i].id} » publiée dans ${count} salon(s).`);
  }
}

// Publication forcée (commande créateur) :
//  • 'attente'  → publie les entrées pas encore annoncées (comme au démarrage,
//                 fait avancer le marqueur : pas de renvoi au prochain reboot)
//  • 'initial'  → renvoie le récapitulatif complet (@everyone) sans toucher au marqueur
//  • 'derniere' → renvoie la dernière entrée du journal sans toucher au marqueur
async function forcePublish(client, which = 'derniere') {
  if (which === 'attente') {
    let entries = 0;
    let count = 0;
    for (let i = currentPos() + 1; i < RELEASES.length; i++) {
      count += await broadcast(client, RELEASES[i]);
      setPos.run(String(i));
      entries += 1;
    }
    return { mode: 'attente', entries, count };
  }
  const entry = which === 'initial' ? RELEASES[0] : RELEASES[RELEASES.length - 1];
  const count = await broadcast(client, entry);
  return { mode: which, title: entry.title, mention: entry.everyone ? '@everyone' : '@here', count };
}

module.exports = { start, forcePublish, buildEmbed, RELEASES };
