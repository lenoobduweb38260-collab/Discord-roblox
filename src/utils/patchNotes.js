// ----- 📝 Notes de mise à jour (patch notes) automatiques -----
// Le bot publie lui-même ses notes de mise à jour dans le salon configuré par
// serveur (patch_channel_id). Elles sont TOUJOURS découpées en 4 catégories —
// 🆕 Ajout / 🔧 Fix / ✨ Amélioration / ➖ Retrait — et indiquent clairement que
// les changements prennent effet immédiatement.
//
// Fonctionnement :
//  • La 1re entrée (id « initial ») récapitule TOUT ce qui a été fait depuis le
//    début et n'est annoncée QU'UNE SEULE FOIS.
//  • Chaque entrée suivante = une version (ses changements uniquement).
//  • La mention éventuelle (@everyone, @here ou un rôle) est un réglage PAR
//    SERVEUR — `patch_mention`. Par défaut, aucune mention n'est faite.
//  • Un marqueur en base (app_state『patch_notes_pos』) mémorise la dernière
//    entrée déjà publiée : à chaque démarrage, seules les nouvelles sont
//    envoyées.
//
// ⚠️ Règle : les notes ne concernent QUE les utilisateurs. Rien de ce qui
// touche l'équipe/le staff du bot n'y figure.

const { EmbedBuilder } = require('discord.js');
const { db, getGuildConfig } = require('../database');
const M = require('./miseEnPage');

const IMMEDIATE = '⚡ **Ces changements prennent effet immédiatement.**';

// ----- Journal des versions -----
const RELEASES = [
  {
    id: 'initial',
    title: 'Récapitulatif complet — tout ce que le bot propose',
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
  {
    id: 'dashboard-nexus-2026-08c',
    title: 'Dashboard : interface « NEXUS » 💠',
    ajout: [],
    amelioration: [
      '💠 **Nouveau design complet du dashboard** façon interface système SAO : fond quadrillé, panneaux à coins coupés, typographies Orbitron/Exo 2, lueurs cyan, balayage lumineux et particules',
      '🤖 Le choix du bot sur la page d\'accueil devient de **grandes cartes de sélection** (une couleur par bot) avec « Inviter sur mon serveur → »',
      '🔧 Page de diagnostic assortie au nouveau style',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'site-builder-2026-08d',
    title: 'Site personnalisable : construisez votre site 🎨',
    ajout: [
      '🎨 **Nouveau site web complet** (`pack-site-builder.zip`) que vous construisez vous-même depuis l\'onglet **Site builder**, sans toucher au code',
      '🌌 **Fond au choix** : votre image ou **GIF animé** téléversé depuis le PC, ou un fond animé généré (Aurora, Étoiles, Grille), avec assombrissement et flou réglables',
      '🖌️ **Thème libre** : couleur d\'accent, police, style des boutons (pilule, arrondi, carré, coins coupés) et arrondi des cartes — le tout en **aperçu direct**',
      '🧭 **Navigation composable** : renommez, masquez et réordonnez les onglets du menu',
      '🧪 **CSS personnalisé** injecté sur tout le site pour un contrôle total du style',
    ],
    amelioration: [],
    fix: [],
    retrait: [],
  },
  {
    id: 'page-builder-2026-08e',
    title: 'Constructeur de page & diagnostic des bots 🧱',
    ajout: [
      '🧱 **Constructeur de page** dans l\'espace Créateur : composez votre page d\'accueil **bloc par bloc** (bannière, cartes, chiffres, galerie, FAQ, annonces défilantes, appel à l\'action, texte, pied de page) — ajout, duplication, réordonnancement et édition de chaque bloc',
      '🏠 **Vraie page d\'accueil** : le logo/nom en haut à gauche y ramène **en restant connecté**',
      '🤖 **État des bots** (⚙️ Créateur et page de diagnostic) : dit précisément **quel bot** est injoignable et **pourquoi**',
    ],
    amelioration: [
      '🔁 **Bascule automatique entre bots** : si plusieurs bots sont sur un serveur et que l\'un ne répond pas, le dashboard utilise l\'autre au lieu d\'échouer',
    ],
    fix: [
      '🩹 Fini le message « Bot injoignable » sans explication : la cause exacte est affichée (bot arrêté, API interne muette, version trop ancienne, délai dépassé)',
      '⏱️ Délai des appels aux bots porté à 25 s — les bots présents sur beaucoup de serveurs ne sont plus considérés à tort comme injoignables',
    ],
    retrait: [],
  },
  {
    id: 'site-grades-2026-08f',
    title: 'Site : fonctions par grade, archives & écran de chargement 🔐',
    ajout: [
      '🔐 **Toutes les fonctions du bot** listées dans l\'espace Créateur (RP, modération, configuration, communauté, équipe du bot, pages et modules) : autorisez chacune **grade par grade**',
      '🎭 **Grades pris en compte** : ceux du serveur (Membre, Police/Métier, Staff, Administration) **et** ceux de l\'équipe du bot (Support, Modérateur, Responsable, Créateur)',
      '👁 **Aperçu par grade** : le site s\'affiche exactement comme le voit le grade choisi — menu, pages et modules non autorisés sont masqués',
      '🗄️ **Archives des tickets** : un ticket fermé quitte les tickets en cours et rejoint les archives avec toute sa conversation (recherche, réouverture, suppression définitive)',
      '⏳ **Écran de chargement personnalisable** : titre, sous-titre, logo, durée et anneau animé',
    ],
    amelioration: [
      '🖼️ **Photos de profil Discord** des bots et **icônes des serveurs** affichées partout, sur le site comme sur le dashboard',
    ],
    fix: [
      '🩹 Renommer un bot ne détache plus ses serveurs : les liens sont reportés sur le nouveau nom (auparavant les serveurs disparaissaient après enregistrement)',
    ],
    retrait: [],
  },
  {
    id: 'site-connexion-agent-2026-08g',
    title: 'Site : la connexion à vos bots se fait dans le site 🔌',
    ajout: [
      '🔌 **« Connexion à votre agent »** dans ⚙️ Créateur → 🤖 Mes bots : collez l\'adresse et la clé, cliquez sur **Tester et enregistrer** — plus aucun fichier à modifier',
      '🧪 **Test avant enregistrement** : rien n\'est sauvegardé tant que l\'agent n\'a pas répondu, et la liste de vos bots s\'affiche aussitôt en cas de succès',
      '🧹 **Bouton Effacer** : le site retombe alors sur les réglages du dashboard installé à côté',
    ],
    amelioration: [
      '🗣️ **Messages d\'erreur qui disent quoi faire** : clé refusée, port fermé, adresse d\'un autre service, identifiant Discord saisi à la place de l\'adresse — chaque cas a son explication',
      '🔐 La clé est rangée hors d\'atteinte du web et **n\'est jamais renvoyée au navigateur** ; laissée vide, elle est conservée telle quelle',
    ],
    fix: [
      '🩹 Une adresse d\'agent invalide n\'envoie plus chercher la panne dans `config.php` : le message pointe désormais l\'encadré à corriger, dans le site',
    ],
    retrait: [
      '🗑️ `SITE_AGENT_URL` et `SITE_AGENT_KEY` ne sont plus à remplir dans `config.php` (les valeurs déjà en place continuent de fonctionner)',
    ],
  },
  {
    id: 'site-discord-video-2026-08h',
    title: 'Site : connexion avec son compte Discord & fond vidéo 🎮',
    ajout: [
      '🎮 **Connexion au site avec son compte Discord** : plus de mot de passe à créer, c\'est le même compte que sur vos serveurs — photo de profil et pseudo affichés dans le bandeau',
      '👑 **Le premier compte connecté devient propriétaire** du site, et choisit ensuite qui peut l\'administrer (⚙️ Créateur → 🔑 Connexion Discord)',
      '📋 **L\'adresse de retour à déclarer chez Discord est affichée toute prête** à copier : plus d\'erreur « redirect_uri non valide »',
      '🎬 **Fond vidéo MP4** dans l\'apparence du site : votre vidéo en boucle et en plein écran, avec l\'assombrissement et le flou déjà réglables',
      '🖼️ L\'image de fond sert d\'**image d\'attente** le temps que la vidéo se charge',
    ],
    amelioration: [
      '📏 **Les limites de votre hébergeur sont expliquées** au lieu d\'un échec sec : taille maximale affichée sous le champ, et message clair si la vidéo est trop lourde',
      '🔐 Identifiants Discord **vérifiés auprès de Discord avant d\'être enregistrés**, et rangés hors d\'atteinte du web',
    ],
    fix: [
      '🩹 **Faille corrigée** : avec des administrateurs Discord déclarés mais aucun mot de passe de secours, un mot de passe vide ouvrait l\'administration',
    ],
    retrait: [],
  },
  {
    id: 'site-equipe-maj-2026-08i',
    title: 'Site : équipe par identifiant, propriétaire épinglé & mises à jour auto 🔄',
    ajout: [
      '👑 **`SITE_OWNER_ID` dans `config.php`** : collez votre identifiant Discord et vous êtes le **seul et unique propriétaire**, définitivement — personne ne peut vous retirer ce grade depuis le site',
      '🔒 **Site verrouillé dès l\'installation** dès que cette ligne est remplie : aucun inconnu ne peut s\'en emparer en se connectant avant vous',
      '🎭 **L\'équipe se compose identifiant par identifiant**, chacun avec son grade : seuls les comptes listés entrent dans l\'espace de gestion',
      '🔄 **Mise à jour automatique** : le site va chercher la dernière version publiée, se remplace lui-même, puis **met à jour tous les bots qu\'il pilote** dans la foulée',
      '▶️ Bouton **« Tout mettre à jour »** pour déclencher la même chose à la demande, avec un rapport ligne par ligne',
    ],
    amelioration: [
      '🛡️ **Les tickets, la blacklist et les serveurs ne sont plus envoyés aux visiteurs** qui ne font pas partie de l\'équipe — le serveur ne les transmet même pas à la page',
      '💾 Une mise à jour n\'écrase jamais `data/`, `uploads/` ni `config.php` : réglages, images et données restent intacts',
      '🧯 Verrou anti-collision pendant la mise à jour, et annulation si l\'archive téléchargée n\'est pas celle du site',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'site-compte-cache-2026-08j',
    title: 'Site : fiche du compte Discord & fin du cache périmé 👤',
    ajout: [
      '👤 **Cliquez sur votre profil en haut à droite** : photo Discord, pseudo, identifiant, grade et nombre de serveurs — tout ce que le site sait de vous',
      '📋 **Bouton « Copier mon identifiant »** : plus besoin d\'activer le mode développeur de Discord pour remplir `SITE_OWNER_ID`',
      '🔑 Raccourci direct de la fiche vers **Connexion & équipe**, et déconnexion en un clic',
    ],
    amelioration: [
      '🎭 Le bandeau affiche le **grade réel** avec sa couleur (ou 👑 Propriétaire), à la place du compte de démonstration',
      '🖼️ Si la photo Discord ne charge pas, les initiales prennent le relais au lieu d\'une image cassée',
      '⏻ **Bouton de déconnexion directement dans le bandeau**, à côté de votre profil — un clic, une confirmation, c\'est fait',
      '🔁 **« Changer de compte »** : le site vous déconnecte puis vous renvoie chez Discord, qui vous laisse choisir un autre compte',
      '🔑 Connecté avec le **mot de passe de secours**, le bandeau le dit clairement et propose de basculer sur votre compte Discord',
    ],
    fix: [
      '🩹 **Le navigateur ne sert plus une version périmée du site** : l\'adresse des fichiers CSS et JavaScript change à chaque mise à jour. Sans ce correctif, une mise à jour pouvait rester invisible tant que le cache n\'était pas vidé à la main',
    ],
    retrait: [],
  },
  {
    id: 'site-mobile-menu-2026-08k',
    title: 'Site : affichage téléphone repensé & menu du profil 📱',
    ajout: [
      '📂 **Menu déroulant sur le profil** : aperçu de la page d\'accueil, synchronisation, notifications, mon compte, changer de compte et déconnexion — tout au même endroit',
      '🚨 **Alerte permanente quand le site n\'est protégé par personne** : elle rappelle que n\'importe qui peut tout modifier, et donne votre identifiant à coller dans `SITE_OWNER_ID`',
    ],
    amelioration: [
      '📱 **Téléphone** : le bandeau ne garde que le nom du site et votre avatar — les boutons ne débordent plus sur le titre',
      '📐 Formulaires, onglets, cartes et fenêtres s\'empilent sur une colonne ; plus aucun débordement horizontal, quel que soit l\'écran',
      '💬 Les encarts d\'aide ne découpent plus leurs phrases en colonnes',
    ],
    fix: [
      '🩹 Le voile de fermeture du menu ne couvrait que le bandeau (et non la page) : un clic à côté ne refermait pas le menu',
    ],
    retrait: [
      '🗑️ Les boutons isolés du bandeau (horloge, œil, éclair, losange) : ils sont désormais dans le menu du profil',
    ],
  },
  {
    id: 'site-perfs-2026-08l',
    title: 'Site : interface nettement plus fluide ⚡',
    amelioration: [
      '⚡ **Frappe 15 fois plus légère** dans le Site builder : l\'aperçu était recalculé à chaque caractère, il ne l\'est plus qu\'une fois par image affichée',
      '🖼️ **Fin des à-coups au défilement sur téléphone** : sans flou demandé, le fond n\'est plus placé sur une couche graphique séparée qui se repeignait en permanence',
      '📱 Sur téléphone : moitié moins de particules, plus d\'aura de curseur (inutile sans souris), plus de ligne de scan, et le flou d\'arrière-plan des barres remplacé par un fond opaque',
      '🖱️ Le suivi de la souris n\'écrit plus dans le style à chaque mouvement, mais une fois par image',
      '♿ Le réglage système « réduire les animations » est respecté : plus aucune animation ni particule',
      '🎨 Les réglages d\'apparence ne sont réécrits que s\'ils ont réellement changé (la feuille de style personnalisée n\'est plus réanalysée pour rien)',
    ],
    ajout: [],
    fix: [],
    retrait: [],
  },
  {
    id: 'site-base-donnees-2026-08m',
    title: 'Site : vraie base de données & fiche de sanction 🗄️',
    ajout: [
      '🗄️ **Base de données MySQL / MariaDB** (ou SQLite si vous n\'avez pas de serveur) : sanctions, preuves, tickets, messages, archives, journal et réglages y sont enregistrés',
      '📥 **Import automatique** de vos données existantes à la première connexion, et **création des tables** toute seule — rien à faire en SQL',
      '📂 **Fiche d\'une sanction** : cliquez sur une ligne de la blacklist pour voir motif, gravité, serveur, auteur, date et **toutes les preuves** — images en vignettes (clic pour agrandir), PDF et journaux ouvrables',
    ],
    amelioration: [
      '🔌 La connexion est **testée avant d\'être enregistrée**, avec un message adapté : identifiants refusés, base inexistante, port fermé, extension PHP manquante',
      '🛟 **Si la base tombe**, le site reste consultable et refuse les modifications avec un message clair, au lieu de les perdre en silence',
      '🖼️ Une preuve dont le fichier a disparu du serveur est signalée au lieu d\'afficher une image cassée',
      '🔒 **Un visiteur non identifié ne voit plus que la vue d\'ensemble** : serveurs, blacklist, tickets et espace créateur disparaissent du menu, et forcer l\'adresse d\'une de ces pages ramène à l\'accueil',
      '👋 La vue d\'ensemble s\'adapte alors : présentation du bot et invitation à se connecter, au lieu de panneaux vides et de boutons qui refusent',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'site-mes-serveurs-grade-2026-08n',
    title: 'Site : vos serveurs et votre grade, récupérés depuis Discord 🌐',
    ajout: [
      '🌐 **Le site reconnaît vos serveurs** : à la connexion, ceux où vous êtes réellement présent sont marqués « vous y êtes », avec votre rôle Discord (Propriétaire, Administrateur, Gestionnaire)',
      '🔀 Bascule **« Mes serveurs / Tous »** quand le bot est sur plus de serveurs que les vôtres',
      '➕ Section **« Vos serveurs sans le bot »** : ceux que vous administrez et où le bot manque encore, avec le lien d\'invitation',
      '🎭 **Votre grade réel s\'affiche sur chaque serveur** — Membre, Staff ou Administration selon les rôles configurés **dans le bot**, plus les mentions 🚓 Police et propriétaire, et la liste de vos rôles',
    ],
    amelioration: [
      '🔄 Bouton **Synchroniser** directement sur la page des serveurs',
      '⚡ Le grade est mémorisé 5 minutes : afficher une page ne relance pas d\'interrogation du bot',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'site-gestion-ses-serveurs-2026-08o',
    title: 'Site : chacun gère ses propres serveurs 🏠',
    ajout: [
      '🏠 **Vous administrez un serveur Discord où le bot est présent ? Vous pouvez le configurer**, sans avoir à être ajouté à l\'équipe du site : connectez-vous avec Discord et vos serveurs apparaissent',
      '🎛️ Les **huit modules** de configuration sont accessibles pour chacun de vos serveurs, ainsi que leurs tickets',
    ],
    amelioration: [
      '🔐 Chacun ne voit et ne modifie que **ses** serveurs : impossible de configurer celui d\'un autre',
      '💬 Un message explique quoi faire selon la situation : inviter le bot sur son serveur, ou demander à rejoindre l\'équipe',
    ],
    fix: [
      '🩹 **Un propriétaire de serveur ne voyait rien** : l\'accès exigeait d\'être inscrit dans l\'équipe du site, alors qu\'administrer son propre serveur devrait suffire',
    ],
    retrait: [],
  },
  {
    id: 'site-diagnostic-acces-2026-08p',
    title: 'Site : « pourquoi je ne peux rien gérer ? » répond enfin 🩺',
    ajout: [
      '🩺 **Panneau de diagnostic** quand l\'accès est refusé : le site affiche ce qu\'il constate — nombre de vos serveurs Discord, ceux que vous administrez, ceux que le bot connaît, votre appartenance à l\'équipe',
      '🎯 La **cause précise** est nommée et accompagnée du remède : synchronisation jamais faite, bot absent de vos serveurs, ou compte hors de l\'équipe',
      '📋 Votre identifiant est affiché et copiable, pour être collé dans `SITE_OWNER_ID`',
    ],
    amelioration: [
      '🔎 Le site détecte qu\'il affiche encore des **serveurs de démonstration** — signe qu\'aucune synchronisation n\'a abouti — et le dit clairement au lieu de laisser croire à un problème de droits',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'version-2-listes-paginees-2026-08q',
    title: '🎉 Version 2.0 — listes RP paginées',
    ajout: [
      '◀️▶️ **Boutons « Page précédente » et « Page suivante »** de part et d\'autre de la recherche, sur les panneaux **Whitelist RP** et **Blacklist RP**',
      '📄 **39 entrées par page**, et l\'embed change selon la page — la liste complète est enfin consultable, quel que soit le nombre d\'inscrits',
      '🔢 Le pied de page indique où vous en êtes : « Page 2/4 — entrées 40 à 78 sur 145 »',
    ],
    amelioration: [
      '🔎 Les **résultats de recherche se paginent aussi** : plus de résultats perdus au-delà de la limite d\'affichage',
      '📐 Si les motifs sont longs, la page se réduit d\'elle-même pour rester lisible — jamais au prix d\'une entrée coupée',
    ],
    fix: [
      '🩹 **La 40ᵉ entrée n\'est plus tronquée en plein milieu** : la liste était collée d\'un bloc puis coupée à un nombre de caractères fixe, ce qui sectionnait la dernière ligne affichée et masquait tout le reste',
    ],
    retrait: [],
  },
  {
    id: 'site-modules-dashboard-2026-08r',
    title: 'Site : tous les modules configurables, et envoi de messages 🎛️',
    ajout: [
      '📋 **Listes déroulantes partout** : salons, catégories et rôles viennent directement de votre serveur Discord — plus rien à taper à la main',
      '📨 **Constructeur de messages** : texte, embeds (titre, description, auteur, images, champs), boutons et menu déroulant, avec un **aperçu fidèle façon Discord** à côté',
      '🚀 **Bouton « Envoyer sur Discord »** : le bot publie dans le salon choisi ce que vous venez de composer. Un bouton « Vérifier » valide le rendu sans rien publier',
      '🤖 **Rôles automatiques à l\'arrivée**, choisis dans la liste des rôles du serveur (plusieurs possibles)',
      '👋 **Arrivées & départs entièrement personnalisables** : salon, couleur, titre, image de fond, cadre de la photo de profil (vignette, grande image ou aucune) et affichage des informations — avec aperçu',
    ],
    amelioration: [
      '💾 **Les réglages partent enfin dans le bot** : ils ne restaient auparavant que dans le site, sans effet sur Discord',
      '🎚️ Modules RP, Niveaux, Interactions et Aventure SAO activables d\'un interrupteur',
      '📁 Onze salons (logs, arrivées, départs, staff, service, niveaux, preuves, partenariats, notes de mise à jour, transcriptions) se choisissent dans une liste',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'autorole-visiteur-2026-08s',
    title: 'Le rôle d\'accueil est enfin donné 🎭',
    ajout: [
      '⏱️ **Rattrapage en un clic** : dans ⚙️ Mes serveurs → 🎭 Rôles, le bouton « Donner le rôle à tous les membres » attribue les rôles automatiques à **tout le monde**, y compris ceux arrivés avant que vous ne les configuriez. Ceux qui les ont déjà sont ignorés',
      '📊 Le site affiche le résultat : combien de membres ont été mis à jour, combien étaient déjà en règle',
    ],
    amelioration: [
      '🧾 Quand un rôle ne peut pas être donné, la raison est écrite dans les logs du bot au lieu d\'échouer en silence : rôle supprimé, rôle placé **au-dessus** de celui du bot, rôle géré par une intégration, ou permission « Gérer les rôles » manquante',
      '🛡️ Un rôle impossible n\'annule plus les autres — le bot donne tout ce qu\'il peut donner',
    ],
    fix: [
      '🩹 **Les nouveaux membres ne restent plus bloqués en « Visiteur » quand le captcha est actif.** Le rôle automatique n\'était alors jamais attribué : le donner à l\'arrivée aurait contourné la vérification, mais ne jamais le donner laissait le membre sans aucun accès. Il est maintenant attribué **juste après la validation du captcha**',
    ],
    retrait: [],
  },
  {
    id: 'blacklist-discord-captcha-2026-08t',
    title: 'La blacklist du site agit enfin sur Discord 🚫',
    ajout: [
      '🌍 **Deux portées au choix** : une blacklist **globale** (tous vos bots) ou ciblée sur **un seul bot**',
      '📊 **Rapport par bot** après chaque sanction : combien de serveurs, message privé remis ou non — et la raison exacte quand un bot n\'a pas pu',
      '🔁 **Bouton « Réappliquer sur Discord »** dans la fiche de sanction : rattrape les fiches créées avant cette version, et celles posées pendant qu\'un bot était éteint',
      '🔢 **Captcha : nombre d\'erreurs tolérées** (3 par défaut) puis **expulsion** — le membre peut revenir et réessayer. L\'expulsion se désactive si vous préférez',
      '🧹 **Captcha : rôle retiré en cas de réussite**, à choisir dans une liste — typiquement « Visiteur », celui qui bloquait l\'accès',
      '🔤 **Un code neuf à chaque tentative**, mêlant toujours lettres ET chiffres',
      '📥 **Les sanctions prononcées sur Discord remontent dans le panel**, avec la preuve saisie par le staff. Automatique en arrivant sur la page, et un bouton « Importer depuis Discord » pour forcer',
      '🏷️ Chaque fiche indique son **origine** : 💬 Discord ou 🖥️ Panel',
    ],
    amelioration: [
      '🗑️ Retirer une sanction **débannit** l\'utilisateur des serveurs concernés, au lieu de seulement effacer la fiche',
      '🔄 **La synchronisation va dans les deux sens** : panel → Discord et Discord → panel. Une sanction levée sur Discord est *signalée* sur sa fiche, jamais supprimée — les preuves téléversées restent. Un bot éteint n\'est pas confondu avec une sanction levée',
      '🧩 Réimporter ne crée jamais de doublon : l\'identifiant de fiche est déduit de l\'identifiant Discord',
      '⚡ **Les pop-ups du site ne rament plus** : le décor animé du fond est mis en pause tant qu\'une fenêtre est ouverte. Mesuré sur un appareil lent : 850 ms de travail par 3 s → 69 ms',
      '📱 La page derrière une pop-up ne défile plus sous le doigt sur téléphone',
    ],
    fix: [
      '🩹 **La blacklist du site n\'était qu\'une fiche** : rien n\'était transmis aux bots, l\'utilisateur sanctionné pouvait rester sur vos serveurs. Elle est maintenant appliquée sur Discord au moment de l\'enregistrement, et refusée si aucun bot ne peut l\'appliquer — plus de fiche « fantôme »',
      '🩹 **N\'importe qui pouvait valider le captcha d\'un autre** : le bouton porte désormais l\'identifiant du membre à qui il s\'adresse',
      '🩹 Le code de vérification pouvait ne contenir **que des lettres** (une fois sur trois) : les caractères sont maintenant tirés pour garantir le mélange, et les signes ambigus (I, L, O, 0, 1) restent exclus',
      '🩹 Le flou d\'arrière-plan des pop-ups n\'était jamais désactivé sur téléphone : la règle prévue pour ça visait le mauvais élément',
    ],
    retrait: [],
  },
  {
    id: 'antispam-exemptions-2026-08u',
    title: 'Anti-spam : des salons laissés tranquilles 🔕',
    ajout: [
      '🔕 **Salons épargnés par l\'anti-spam**, à choisir dans une liste (plusieurs possibles) : pour vos salons de flood, de commandes ou de comptage, où enchaîner les messages est normal',
      '🗂️ **Catégories entières épargnées** : tout ce qu\'elles contiennent l\'est aussi, y compris les fils',
      '🧵 Un **fil** hérite de son salon : inutile de l\'ajouter à la main',
      '🤝 Option séparée pour **désactiver aussi le filtre arnaques et invitations** dans ces salons — utile pour un salon de partenariats, où poster une invitation Discord est le but',
    ],
    amelioration: [
      '🛡️ Par défaut, un salon épargné reste protégé des **liens d\'arnaque et des invitations** : seule la limite de fréquence y est levée. Il faut le demander explicitement pour aller plus loin',
      '📋 L\'interrupteur Anti-spam explique désormais ce qu\'il fait : plus de 5 messages en 7 secondes, et le staff n\'est jamais concerné',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'niveaux-tickets-logs-2026-08v',
    title: 'Un seul niveau, tickets relancés et logs plus propres 📊',
    ajout: [
      '🔔 **Bouton « Relancer » sur les tickets** : le bot repingue l\'auteur avec un message taquin tiré au hasard (« Je crois que vous êtes passé sous un tunnel 🚇 »). Réservé au staff',
      '📋 **Réponses types** (`/preset ajouter|modifier|supprimer|liste|apercu|menu`) : écrivez vos messages récurrents une fois, puis envoyez-les dans un ticket depuis une **liste déroulante**. Texte, embed, ou les deux — avec `{membre}`, `{staff}` et `{serveur}` remplacés à l\'envoi',
      '🚨 **Les échantillons anti-scam sont communs à tous vos bots** : ajouté sur l\'un, il protège tous les autres. Seules les empreintes circulent, jamais les images',
    ],
    amelioration: [
      '📊 **L\'écrit et le vocal ne font plus qu\'un seul niveau.** Vos XP existantes sont additionnées et le niveau recalculé — rien n\'est perdu. `/niveau voir` montre une barre de progression et le détail des deux sources ; `/niveau classement` n\'a plus d\'option à choisir',
      '📥 **Plus rien à synchroniser à la main** : les sanctions Discord et les échantillons anti-scam remontent au chargement du site, puis toutes les 5 minutes. Rien ne part si l\'onglet est en arrière-plan',
    ],
    fix: [
      '🩹 **Dans les logs, l\'« Après » était collé au texte d\'avant, dans la même citation.** `>>>` ouvre sur Discord une citation qui s\'étend jusqu\'à la fin du message : le titre et le nouveau texte y étaient aspirés. Avant/Après sont maintenant deux champs distincts — de même pour la ligne des pièces jointes d\'un message supprimé',
      '🔇 **Fin des logs qui ne disent rien** : plus de « Auteur inconnu / Contenu indisponible » pour un message hors cache, et plus aucun log pour une suppression **dans le salon de logs** — effacer un vieux log y créait un nouveau log',
    ],
    retrait: [],
  },
  {
    id: 'accueil-style-banniere-2026-08w',
    title: 'Un accueil qui a de l\'allure 🎨',
    ajout: [
      '🎨 **Style d\'accueil « Détaillé »** : un vrai panneau de bienvenue composé tout seul — présentation du serveur, renvoi vers le règlement et vers le staff, nom du membre et **numéro d\'inscription**, ligne d\'auteur et pied de page',
      '📌 **Salon du règlement** et **💡 salon d\'aide** à choisir dans une liste : ils sont cités automatiquement, et utilisables partout via `{regles}` et `{support}`',
      '🖼️ **Bannière fabriquée par le bot** : photo de profil ronde, pseudo, numéro de membre et nom du serveur dessinés sur un fond de votre choix',
    ],
    amelioration: [
      '👁️ **L\'aperçu suit vos réglages en direct**, avant d\'enregistrer : changez le style, un salon ou la couleur, l\'aperçu se met à jour aussitôt',
      '🔤 L\'aperçu affiche enfin le **gras et l\'italique** au lieu des `**astérisques**`',
    ],
    fix: [
      '🩹 **Les pseudos accentués ou décorés ne sortiront pas en « □□□□ » sur la bannière.** Les polices d\'image ne connaissent que l\'alphabet latin sans accent : « Émilie » devient « Emilie », et un pseudo entièrement intraçable laisse place au nom d\'utilisateur plutôt qu\'à des carrés',
    ],
    retrait: [],
  },
  {
    id: 'identite-embeds-2026-08x',
    title: 'Votre identité sur TOUS les embeds 🎨',
    ajout: [
      '🎨 **Module « Identité des embeds »** : une couleur d\'accent et une signature appliquées à **tout ce que le bot envoie** — arrivées, logs, sanctions, tickets, niveaux, réponses de commandes. Un seul réglage, partout à la fois',
      '✍️ **Signature en pied de page** « NomDuBot • NomDuServeur » avec l\'icône du serveur, et horodatage automatique',
      '👁️ Aperçu montrant **trois messages de natures différentes** côte à côte, pour voir l\'effet avant d\'enregistrer',
    ],
    amelioration: [
      '🎯 **Les couleurs qui portent un sens sont respectées par défaut** : rouge pour une sanction, vert pour une réussite, orange pour un avertissement. Une option « même couleur pour tous » permet de tout uniformiser si vous préférez',
      '🤝 Un pied de page déjà écrit par le bot (« Page 2/4 », « Relancé par… ») n\'est jamais remplacé',
      '🔌 Tout est désactivable par serveur, d\'un seul interrupteur',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'esthetique-listes-2026-08y',
    title: 'Une esthétique commune, et rattrapable 🧱',
    ajout: [
      '🧱 **Grammaire visuelle partagée** pour les listes du bot : en-tête `◆ 🌟 · **Grade** • 2 membres`, entrées en `➜`, séparateurs entre sections, et *Aucun membre* en italique quand c\'est vide',
      '🕒 **Pied de page unifié** : « 1972 membres • Mis à jour à 16:07 • Page 1/2 », le même partout',
      '🎨 **Ligne d\'identité en haut de chaque embed** : nom et icône du serveur, pour que l\'identité soit visible en permanence',
      '🪄 **`/esthetique appliquer`** : réhabille les messages **déjà envoyés** par le bot avec l\'identité actuelle — au choix sur un salon ou tout le serveur',
    ],
    amelioration: [
      '🛡️ `/esthetique` ne touche QUE l\'habillage : titre, texte, champs, images et boutons restent identiques au caractère près',
      '🧠 Ce qui porte du sens est préservé : un pied de page « Page 2/4 » ou une ligne « Avis de @membre » ne sont jamais remplacés — seule la signature d\'identité l\'est',
      '📋 Liste du staff du bot et whitelist reprises dans le nouveau format',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'embeds-carte-2026-08z',
    title: 'Des embeds qui ne ressemblent plus a ceux de Discord 🖼️',
    ajout: [
      '📏 **Filet sous le titre** sur chaque embed : la fine ligne qui separe le titre du texte, celle qui donne l\'allure « carte » au lieu d\'un bloc brut',
      '🖼️ **Banniere de bas de carte** : une image large qui termine chaque embed, comme une signature visuelle. Un embed qui a deja son image la garde',
    ],
    amelioration: [
      '🎛️ Les deux se reglent depuis le site, avec un apercu de trois messages cote a cote — plus besoin de s\'occuper des couleurs message par message',
      '🛟 Le filet n\'est pose que s\'il reste de la place : jamais au prix d\'un texte tronque',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'embeds-sections-2026-08aa',
    title: 'Fini la grille de champs de Discord 🧱',
    ajout: [
      '🧱 **Les champs d\'embed deviennent des sections** : au lieu de la grille de petites etiquettes grises de Discord, chaque information s\'affiche en `◆ **Intitule**` puis `➜ valeur`, separee par un filet. C\'est ce qui restait de « Discord de base » — ca s\'applique a TOUS les embeds, meme ceux que personne ne reconstruit',
      '📏 **Longueur du filet reglable** (6 a 30 signes)',
    ],
    amelioration: [
      '🛟 Rien n\'est jamais perdu : si le tout ne tient pas dans une description, les champs sont conserves tels quels',
      '💬 Une valeur deja mise en forme (citation, liste) garde sa forme au lieu de recevoir une fleche en double',
    ],
    fix: [
      '🩹 **Le filet sous le titre debordait sur telephone** : a 28 signes il repassait a la ligne et affichait deux traits l\'un sous l\'autre. Ramene a 16, et le meme exces corrige sur le separateur des listes',
      '🩹 Sur le site, les interrupteurs des reglages **actifs par defaut** s\'affichaient eteints : ils mentaient sur l\'etat reel du bot, et le premier clic les eteignait pour de bon',
    ],
    retrait: [],
  },
  {
    id: 'esthetique-anciens-2026-08ab',
    title: 'Les anciens messages passent au nouveau style 🎨',
    ajout: [
      '🎨 `/esthetique appliquer` **reconstruit** desormais les anciens embeds au lieu de simplement les repeindre : les champs deviennent des sections `◆` / `➜`, le filet et la banniere sont poses, la signature refaite. Un vieux message devient rigoureusement identique a un message envoye aujourd\'hui',
      '🗂️ **Rien n\'est perdu** : le contenu de l\'ancien embed sert de reserve d\'informations — titre, texte, intitule et valeur de chaque champ, liens, images. Seule la forme change',
    ],
    amelioration: [
      '♻️ Les embeds sont refaits **sur place**. Un bot peut reecrire integralement ses propres embeds : supprimer puis republier aurait donne le meme resultat visuel, mais aurait detruit les reactions, les epingles, les reponses accrochees et les liens partages vers ces messages — et remonte de vieux messages en bas des salons',
      '🕰️ La date affichee reste **celle du message**, pas celle du rehabillage : un message de mars ne se retrouve plus date d\'aujourd\'hui',
      '📊 Le compte rendu detaille ce qui a ete refait, serveur par serveur',
    ],
    fix: [
      '🩹 **Les vieux filets de 28 signes restaient en place** : le style avait change, le trait trop long non — c\'est ce qui donnait l\'impression de « toujours les vieilles embeds ». Tous les filets, celui du haut comme ceux qui separent les sections, sont remis a la longueur du jour',
      '🩹 Un message deja au bon format etait **re-modifie a chaque passage** de la commande : la comparaison dependait de l\'ordre des cles JSON, que la reecriture changeait. Le compte « deja au bon format » restait donc a zero',
      '🩹 La liste des serveurs du compte rendu affichait une **double fleche** `➜ ➜`',
    ],
    retrait: [],
  },
  {
    id: 'da-couleurs-neutres-2026-08ac',
    title: 'Cette note est la premiere a porter le nouveau style 🎨',
    ajout: [
      '🎨 **La note de mise a jour passe a la direction artistique** : sections `◆` / `➜` au lieu de la grille de champs grise, filet entre les rubriques, accent du serveur, signature du bot. C\'est le message que vous voyez le plus souvent : c\'etait a lui de montrer l\'exemple',
    ],
    amelioration: [
      '🎯 **Une couleur neutre n\'est plus prise pour un choix.** Le bleu de Discord, le bleu « info », les gris de carte, le noir et le blanc etaient poses faute de mieux — mais l\'identite les voyait comme des decisions et n\'y touchait pas. Resultat : l\'accent du serveur n\'apparaissait presque jamais. Ces couleurs sont desormais traitees comme du vide, et **34 embeds** prennent enfin les couleurs du serveur',
      '🔴 **Ce qui a un sens reste intact** : rouge pour une sanction, vert pour une reussite, jaune pour une alerte, or pour une recompense. **80 embeds** gardent leur couleur',
      '♻️ `/esthetique appliquer` rattrape aussi les anciens messages restes au bleu de Discord',
    ],
    fix: [
      '🩹 **Les pieds de page decoratifs prenaient la place de la signature** : « Note de mise a jour du bot » sous un titre « Note de mise a jour », « Annonce automatique de mise a jour » sous « Mise a jour prete ». Ils ne disaient rien de neuf et empechaient « NomDuBot • NomDuServeur » de se poser',
    ],
    retrait: [],
  },
  {
    id: 'cartes-sans-bordure-2026-08ad',
    title: 'Fini la barre de couleur a gauche des messages 🃏',
    ajout: [
      '🃏 **Les messages ne sont plus des embeds mais des cartes.** La barre verticale coloree collee au bord gauche de chaque embed n\'est pas un reglage : elle fait partie du composant. La seule facon de s\'en debarrasser etait de ne plus envoyer d\'embed du tout — c\'est desormais le cas',
      '📏 **De vrais separateurs.** Nos « ───── » etaient dessines a la main : leur largeur dependait de la taille de police du lecteur, d\'ou les traits casses en deux sur telephone. Discord trace maintenant lui-meme le filet, a la largeur exacte de la carte',
      '🕰️ **L\'heure s\'affiche dans le fuseau de chaque lecteur**, plus dans celui du serveur',
      '🎛️ Deux reglages sur le site : **Cartes sans bordure** (actif par defaut) et **Barre coloree a gauche** pour ceux qui la preferent, avec apercu en direct',
      '♻️ `/esthetique appliquer` recoit une option **mode** : « recreer » republie les anciens messages en cartes',
    ],
    amelioration: [
      '🛟 **Si Discord refuse une carte, le message part quand meme** dans l\'ancien style : jamais de message perdu. Apres trois refus, le bot cesse d\'insister',
      '🗂️ **Aucune troncature silencieuse** : une carte trop longue (plus de 4000 signes ou 40 composants) n\'est pas convertie, l\'embed complet est envoye tel quel',
      '🔘 Les boutons et menus deja presents sont conserves, au meme endroit',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'balises-barres-2026-08ae',
    title: 'Tapez « && », le bot trace une barre 🏷️',
    ajout: [
      '🏷️ **Une mise en forme qui tient en quatre signes.** En debut de ligne : `&&` trace une barre, `&& Titre` trace une barre puis un titre de section ◆, `&>` fait une entree de liste ➜, `&&&` aere davantage. Plus besoin de connaitre la grammaire du bot pour ecrire un beau message',
      '📐 **La barre est un vrai separateur** quand les cartes sont actives : Discord la trace lui-meme, sur toute la largeur, au lieu d\'une suite de tirets qui cassait sur telephone',
      '📖 **Le rappel est la ou vous ecrivez** : encart avec exemple avant/apres sur le site, ligne de rappel dans l\'editeur d\'embed, et mention dans les options de `/preset`',
    ],
    amelioration: [
      '🧩 Actif partout ou l\'on ecrit du texte : message d\'arrivee, message de depart, panneau de tickets, reponses types, editeur d\'embed',
      '🛡️ **Votre code reste intact** : une balise n\'est lue qu\'en debut de ligne et jamais dans un bloc de code, donc un `if (a && b)` dans une reponse type n\'est pas coupe en deux',
      '🧹 Une barre qui ne separe rien — en tete, en queue, ou deux d\'affilee — est retiree automatiquement',
      '👤 Les balises sont appliquees avant les variables : un pseudo contenant « && » ne devient pas une barre au milieu du message',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'entete-panneau-2026-08af',
    title: 'Un vrai en-tete de panneau 🔠',
    ajout: [
      '🔠 **Le titre ouvre la carte, en grand.** Il passe en titre de niveau 1 : un en-tete large et lisible, comme sur un vrai panneau, au lieu d\'un titre noye dans le texte',
      '🎛️ Reglage **Taille du titre** sur le site : « grand » (defaut) ou « moyen » pour rester discret',
    ],
    amelioration: [
      '🧹 **Le nom du serveur ne s\'affiche plus deux fois.** Il etait ecrit en haut de carte ET dans la signature en bas : la meme information repetee, qui ecrasait le titre. Seule la signature reste. Une ligne porteuse de sens (« Avis de @membre ») est evidemment conservee',
      '👀 L\'apercu du site montre les deux reglages en direct',
    ],
    fix: [],
    retrait: [],
  },
  {
    id: 'mentions-notes-2026-08ag',
    title: 'Les notes de version ne sonnent plus chez personne 🔕',
    ajout: [
      '🔔 **Reglage « Mentionner a chaque note »** : personne, `@everyone`, `@here`, ou **un role precis** de votre serveur',
      '⚙️ Disponible **dans `/config` → Salons → 📝 Salon des patch notes** ET sur le site : le reglage etait sur le site uniquement, donc invisible pour qui configure depuis Discord',
    ],
    amelioration: [
      '🔕 **Par defaut, aucune mention.** Une note de version ne justifie pas de faire sonner le telephone de tout le serveur — c\'est le genre de notification qui fait couper le salon. Le silence est desormais le comportement par defaut, et c\'est a vous de demander autre chose',
      '🛡️ **Sans mention, rien ne peut sonner** : meme un pseudo ou un role cite dans le texte de la note ne notifie personne',
      '🎯 La mention est decidee **par serveur**, plus par l\'entree du journal : deux serveurs peuvent avoir des reglages differents pour la meme note',
    ],
    fix: [
      '🩹 **Le `@here` etait envoye d\'office** a chaque nouvelle version, et `@everyone` sur le recapitulatif complet — sans qu\'aucun reglage ne permette de l\'eviter',
    ],
    retrait: [
      '➖ Plus aucune mention codee en dur dans le bot',
    ],
  },
  {
    id: 'apercu-editable-2026-08ah',
    title: 'Ecrivez directement dans l\'apercu ✍️',
    ajout: [
      '✍️ **L\'apercu du tableau de bord est devenu la zone de saisie.** Cliquez sur le titre ou le texte de la carte et ecrivez : plus de formulaire d\'un cote et d\'apercu de l\'autre. Pendant la frappe vous voyez le texte brut (les `&&` restent lisibles), et des que vous sortez de la zone tout est rendu — comme la zone de message de Discord',
      '🃏 **L\'apercu montre enfin une vraie carte** : pas de barre coloree, grand titre, separateurs traces, sections `◆` / `➜`, signature du bot. L\'ancien apercu dessinait un embed classique, il ne ressemblait plus au resultat',
      '📊 **Une jauge de longueur** previent avant la limite des cartes : au-dela, Discord refuse la carte et le message part en embed classique',
      '🎨 L\'apercu des reglages d\'identite passe au meme moteur : changer l\'accent, le filet ou la barre se voit immediatement sur trois messages de natures differentes',
    ],
    amelioration: [
      '🔗 **Le site et le bot partagent le MEME code de rendu.** Les trois modules qui decident de l\'apparence tournent des deux cotes, et un test echoue si les copies different d\'un seul octet. C\'est ce qui permet de promettre que l\'apercu ne ment pas',
      '🏷️ Le texte ecrit depuis le tableau de bord passe par les balises, comme partout ailleurs : `&&` trace une barre a l\'envoi comme dans l\'apercu',
      '🔒 La signature et l\'image de bas de carte ne sont pas modifiables dans l\'apercu : elles sont posees par l\'identite, pas ecrites par vous',
    ],
    fix: [
      '🩹 L\'apercu du constructeur de messages affichait encore l\'ancien style — barre coloree a gauche et grille de champs grise — alors que le bot envoyait des cartes depuis plusieurs versions',
    ],
    retrait: [],
  },
  {
    id: 'esthetique-bloquee-2026-08ai',
    title: '/esthetique restait bloquee sur « chargement » ⏳',
    ajout: [],
    amelioration: [
      '⏱️ **L\'avancement s\'affiche vraiment** : serveur et salon en cours, compteurs, et le temps restant avant l\'arret automatique. Avant, le point d\'avancement n\'etait envoye qu\'apres une modification — sur un serveur ou le bot a peu ecrit, l\'ecran restait muet pendant tout le balayage',
      '🛡️ **Un serveur en echec n\'emporte plus le balayage** : il est signale dans la liste et les autres continuent',
      '📨 Si la reponse a malgre tout expire, le compte rendu arrive **en message prive** plutot que de disparaitre',
    ],
    fix: [
      '🩹 **La commande pouvait rester sur « chargement » pour toujours.** Un jeton d\'interaction Discord vit 15 minutes ; au-dela, la reponse ne peut plus etre modifiee et l\'echec etait avale silencieusement. Sur un serveur fourni — beaucoup de salons, 250 ms par message modifie — le balayage depassait ce delai. Il s\'arrete desormais a 13 minutes et rend compte de ce qui a ete fait',
      '🩹 **Le compte rendu explique enfin pourquoi la barre coloree est toujours la.** En mode « modifier », un ancien embed reste un embed : Discord fige la famille de composants d\'un message a sa creation. La commande travaillait bien, mais rien ne changeait a l\'oeil. Elle indique maintenant combien de messages sont concernes et comment les convertir',
      '🩹 Si le membre « bot » n\'etait pas en cache, TOUS les salons etaient declares illisibles et la commande se terminait sur « rien a changer » sans avoir rien regarde',
    ],
    retrait: [],
  },
  {
    id: 'esthetique-sans-decompte-2026-08aj',
    title: 'Plus de decompte sur /esthetique ⏱️',
    ajout: [],
    amelioration: [
      '🏁 **Le balayage va jusqu\'au bout**, quel que soit le nombre de salons. Il s\'arretait a 13 minutes pour pouvoir encore afficher son compte rendu — la reponse d\'une commande Discord expirant au bout de 15 minutes. Mais cette limite ne contraint que l\'AFFICHAGE, pas le travail',
      '📬 **Le compte rendu arrive en message prive** si le balayage a dure plus longtemps que la reponse. La destination est annoncee des le lancement, pour ne pas laisser croire a une commande plantee',
      '⏱️ **Plus de decompte a l\'ecran** : il affichait le temps restant avant un arret qui n\'a plus lieu d\'etre. C\'est le temps ecoule qui s\'affiche desormais, avec le serveur et le salon en cours',
      '🏁 **Aucune echeance, plus du tout.** La fin de mission du bot, c\'est d\'avoir fait ce qu\'on lui a demande. Le travail est fini par nature — serveurs × salons × messages — donc toute borne de temps ne pouvait que le tronquer',
      '📨 Si le balayage depasse la duree de la reponse, un message prive previent que **ca continue**, puis le compte rendu arrive a la fin. Vingt minutes d\'ecran fige passeraient pour une commande plantee',
      '🕰️ Une longue duree s\'affiche en minutes : « en 71 min 12 s » plutot que « en 4272 s »',
    ],
    fix: [],
    retrait: [
      '➖ L\'arret automatique a 13 minutes, qui tronquait les gros balayages',
      '➖ Le garde-fou d\'une heure, qui abandonnait le travail en cours',
    ],
  },
  {
    id: 'reponses-differees-2026-08ak',
    title: 'Les commandes lentes rendaient encore de vieux embeds 🩹',
    ajout: [],
    amelioration: [
      '🃏 **Le compte rendu de `/esthetique` est enfin une carte**, comme tout le reste — c\'etait le comble pour la commande qui refait l\'esthetique',
    ],
    fix: [
      '🩹 **Toute commande qui travaille plus de 3 secondes rendait un embed a l\'ancienne**, barre coloree comprise. La raison etait invisible sans regarder la couche reseau : `deferReply` cree deja le message (« reflechit… »), et Discord fige la famille de composants d\'un message a sa creation. Tout ce qui arrivait ensuite par modification ne pouvait donc plus etre une carte',
      '🩹 Corrige sur `/esthetique`, `/musique`, `/temps` et les interactions RP : le message d\'attente est referme, et le contenu part en envoi — donc en carte',
    ],
    retrait: [],
  },
  {
    id: 'listes-rp-tickets-2026-08al',
    title: 'Les listes RP et les tickets rejoignent la refonte 📋',
    ajout: [],
    amelioration: [
      '📋 **Les listes Whitelist et Blacklist RP passent a la grammaire du bot** : entrees marquees `➜` au lieu d\'une numerotation, en-tete de section `◆` avec le compte, pied de page unifie. Le pseudo Roblox est mis en avant, la raison passe en sous-texte',
      '🧹 **L\'identifiant brut disparait des lignes** : la mention le portait deja, et il occupait a lui seul un cinquieme de la largeur sur telephone',
      '🎫 **L\'embed d\'ouverture d\'un ticket** suit la meme grammaire : une phrase d\'accueil, puis une section `◆` qui dit qui repond',
      '♻️ **Les panneaux se reparent tout seuls.** Un panneau publie a l\'epoque des embeds ne peut pas devenir une carte par modification — Discord fige la famille de composants a la creation. A la premiere modification, il est donc republie UNE fois, puis tout reprend normalement. Vaut pour les listes RP comme pour les panneaux de tickets',
      '🕰️ L\'heure de mise a jour n\'est plus ecrite deux fois : la carte porte deja un horodatage, affiche a l\'heure de chaque lecteur',
    ],
    fix: [
      '🩹 **Le nom du serveur s\'affichait au-dessus du titre** des listes alors qu\'il n\'ajoutait rien : c\'est de l\'identite, pas du sens, et il ecrasait le titre',
      '🩹 **`compte: null` etait ignore** : les sections qui demandaient a ne pas etre comptees affichaient quand meme « • 2 membres ». Le compte rendu de `/esthetique` en souffrait aussi',
      '🩹 Le pied de page « Utilisez le bouton ci-dessous pour fermer le ticket » repetait le libelle du bouton juste en dessous, et prenait la place de la signature',
    ],
    retrait: [],
  },
  {
    id: 'actions-staff-tickets-2026-08am',
    title: 'Un menu « Actions staff » dans chaque ticket 🛠️',
    ajout: [
      '🛠️ **Menu deroulant dans le message du ticket**, avec sept actions : `🚀 Ticket pris en charge`, `🔓 Ticket libere`, `➕ Ajouter un membre`, `➖ Retirer un membre`, `🔔 Avez-vous toujours besoin de ce ticket ?`, `ℹ️ Ticket` (les details), `🗑️ Supprimer le ticket`',
      '🚀 **Prise en charge** : un membre du staff s\'assigne le ticket, et tout le monde voit qui s\'en occupe. Une reprise indique qui l\'avait avant',
      'ℹ️ **Fiche du ticket** : demandeur, responsable, date d\'ouverture, etat — a l\'heure de chaque lecteur',
      '👥 **Ajouter / retirer un membre** via un selecteur de membres natif : plus besoin de retenir une commande',
    ],
    amelioration: [
      '🔒 **Reserve au staff DU SERVEUR** : le grade staff, ou l\'un des roles support du type de ticket. Rien a voir avec l\'equipe du bot, celle qu\'on previent des mises a jour. Le menu est visible de tous — Discord ne sait pas masquer un composant par role — mais chaque action verifie les droits et refuse en prive',
      '🛡️ **Le demandeur ne peut pas etre retire de son propre ticket** : il faut le fermer, ce qui archive la conversation',
      '⚠️ **La suppression demande confirmation** et rappelle que « Fermer le ticket » archive avant de supprimer, la ou « Supprimer » efface tout',
      '🔁 Le menu se remet a zero apres chaque action : on peut rechoisir la meme deux fois de suite',
    ],
    fix: [],
    retrait: [],
  },
];

// Construit l'embed d'une note à partir d'une entrée { title, ajout, fix,
// amelioration, retrait }. Chaque catégorie accepte un tableau OU un texte.
// La note de mise à jour est le message que les membres voient le plus
// souvent : c'est donc elle qui doit porter la direction artistique en
// premier, pas en dernier.
//
// Trois choses volontairement ABSENTES ici :
//  • aucune couleur — l'accent du serveur s'applique tout seul ;
//  • aucun pied de page décoratif — « Note de mise à jour du bot » ne disait
//    rien que le titre ne dise déjà, et il empêchait la signature
//    « NomDuBot • NomDuServeur » de se poser ;
//  • aucun champ d'embed — la grille grise de Discord est remplacée par les
//    sections ◆ / ➜.
const RUBRIQUES = [
  { cle: 'ajout', titre: 'Ajout', prefixe: '🆕' },
  { cle: 'fix', titre: 'Correction', prefixe: '🔧', mot: 'correction' },
  { cle: 'amelioration', titre: 'Amélioration', prefixe: '✨', mot: 'amélioration' },
  { cle: 'retrait', titre: 'Retrait', prefixe: '➖', mot: 'retrait' },
];

function lignesDe(valeur) {
  const brut = Array.isArray(valeur) ? valeur.slice() : String(valeur || '').split('\n');
  return brut.map((l) => String(l).trim().replace(/^➜\s*/, '')).filter(Boolean);
}

function buildEmbed(entry) {
  const blocs = [IMMEDIATE];
  for (const r of RUBRIQUES) {
    const lignes = lignesDe(entry[r.cle]);
    // Une rubrique vide n'a pas à occuper de place : on ne l'affiche pas.
    if (!lignes.length) continue;
    blocs.push(M.bloc(r.titre, lignes, { prefixe: r.prefixe, motCompte: r.mot || 'ajout' }));
  }

  // Une note de version peut être longue. `paginer` coupe ENTRE deux
  // rubriques, jamais au milieu de l'une d'elles.
  const pages = M.paginer(blocs, { maxParPage: 99 });

  const embed = new EmbedBuilder()
    .setTitle(`📝 ${entry.title || 'Note de mise à jour'}`)
    .setDescription(M.borner(M.description(pages[0] || [IMMEDIATE]), M.MAX_DESCRIPTION));

  // Rien ne doit disparaître d'une note de version : ce qui n'a pas tenu dans
  // la description repasse en champs. Moins beau, mais complet — et ce cas ne
  // se produit que pour une version exceptionnellement fournie.
  for (const page of pages.slice(1)) {
    for (const champ of enChamps(page)) {
      if (embed.data.fields?.length >= 25) return embed;
      embed.addFields(champ);
    }
  }

  return embed;
}

// Transforme des blocs en champs d'embed, en respectant la limite de 1024
// signes par valeur et sans jamais couper une ligne en deux.
function enChamps(blocs) {
  const champs = [];
  for (const b of blocs) {
    const [entete, ...lignes] = b.split('\n');
    const nom = M.borner(entete.replace(/[*◆·]/g, '').trim(), 256) || 'Suite';
    let tampon = [];
    let taille = 0;
    let part = 0;
    const vider = () => {
      if (!tampon.length) return;
      champs.push({ name: part === 0 ? nom : `${nom} (suite)`, value: tampon.join('\n') });
      tampon = [];
      taille = 0;
      part += 1;
    };
    for (const l of lignes) {
      if (taille + l.length + 1 > M.MAX_CHAMP) vider();
      tampon.push(l);
      taille += l.length + 1;
    }
    vider();
  }
  return champs;
}

const getPos = db.prepare("SELECT value FROM app_state WHERE key = 'patch_notes_pos'");
const setPos = db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('patch_notes_pos', ?)");

// 🔔 Qui prévenir quand une note paraît ?
//
// Par défaut : PERSONNE. Une note de version ne justifie pas de faire sonner
// le téléphone de tout le serveur — c'est le genre de notification qui fait
// couper le salon, voire quitter. Chaque serveur décide, et le silence est
// le choix par défaut.
//
// `patch_mention` vaut : rien (aucune mention), 'everyone', 'here', ou
// l'identifiant d'un rôle.
function mentionDe(cfg) {
  const v = String(cfg?.patch_mention || '').trim();
  if (!v || v === 'aucune') return null;
  // @everyone et @here relèvent tous deux du type « everyone » côté API.
  if (v === 'everyone') return { content: '@everyone', allowedMentions: { parse: ['everyone'] } };
  if (v === 'here') return { content: '@here', allowedMentions: { parse: ['everyone'] } };
  if (/^\d{5,}$/.test(v)) return { content: `<@&${v}>`, allowedMentions: { roles: [v] } };
  return null;
}

// Le message à envoyer, mention comprise — ou muet.
// ⚠️ Sans mention, on pose quand même `allowedMentions: { parse: [] }` :
// sinon un pseudo ou un rôle cité DANS la note sonnerait chez l'intéressé.
function envoiDe(embed, cfg) {
  const m = mentionDe(cfg);
  return {
    ...(m ? { content: m.content } : {}),
    embeds: [embed],
    allowedMentions: m ? m.allowedMentions : { parse: [] },
  };
}

// Publie une note dans le salon patch note de chaque serveur qui en a configuré un.
async function broadcast(client, entry) {
  const embed = buildEmbed(entry);
  let count = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      const cfg = getGuildConfig(guild.id);
      if (!cfg.patch_channel_id) continue;
      const channel = await guild.channels.fetch(cfg.patch_channel_id).catch(() => null);
      if (!channel?.isTextBased()) continue;
      const ok = await channel
        .send(envoiDe(embed, cfg))
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
//  • 'initial'  → renvoie le récapitulatif complet sans toucher au marqueur
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
  // La mention n'est plus décidée par l'entrée mais par chaque serveur : on
  // n'en annonce donc aucune ici.
  return { mode: which, title: entry.title, count };
}

module.exports = { start, forcePublish, buildEmbed, mentionDe, envoiDe, RELEASES };
