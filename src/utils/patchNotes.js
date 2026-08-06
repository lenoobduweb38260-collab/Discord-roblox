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
    everyone: true,
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
