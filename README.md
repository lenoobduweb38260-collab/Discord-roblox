# 🎭 Bot Discord RP — Roblox

Bot Discord complet pour serveur Roleplay Roblox : cartes d'identité, permis de conduire, entreprises et assurances, niveaux (écrit + vocal), prise de service, whitelist et modération staff — le tout stocké en base de données SQLite et entièrement configurable par le staff.

## ✨ Fonctionnalités

### 🪪 Carte d'identité (`/carte`)
- **ID de carte généré automatiquement** (format `CNI-XXXXXXXX`)
- Champs : nom & prénom RP, sexe, lieu de naissance, date de naissance, pseudo Roblox, pseudo Discord, ID Discord, nationalité, background, photo
- Stockée en **base de données**, créée par le **staff** (`/carte creer`)
- `/carte voir` — afficher une carte (embed avec photo)
- `/carte chercher` — **[Staff]** retrouver une carte par **ID Discord**, **ID de carte** ou **nom Discord**
- `/carte modifier`, `/carte supprimer` — **[Staff]**

### 🚗 Permis de conduire (`/permis`)
- `/permis delivrer` — **[Staff]** délivre un permis : **valide**, **numéro généré** (12 chiffres), **12/12 points**, **délivrance à la date et l'heure du jour**
- `/permis voir`, `/permis retirer-points` (0 point → permis automatiquement invalidé), `/permis ajouter-points`, `/permis invalider`, `/permis revalider`, `/permis supprimer`

### 🏢 Entreprises (`/entreprise`)
- Création/modification/suppression par le **staff**
- **2 questions obligatoires à la création** :
  1. **Assurance : Oui ou Non** (option obligatoire)
  2. Si **Oui** → menu de sélection **multi-choix** : 🏥 Maladie / 🚗 Véhicule / 🏠 Habitation / 🏢 Entreprise
- Le staff peut mettre **un ou plusieurs membres à la tête** de l'entreprise (`/entreprise patron`)
- Gestion des employés (`/entreprise employe`, accessible aussi aux patrons)
- Les embeds acceptent **photos, vidéos et GIF** (fichier ou URL — les vidéos sont jointes au message pour être lisibles)

### 🛡️ Assurance véhicule (`/assurance`)
- `/assurance assigner` — un assureur ne peut assigner un véhicule **que si l'entreprise dont il fait partie (patron ou employé) a coché "Assurance Véhicule"**
- `/assurance retirer`, `/assurance liste` (par entreprise ou par assuré)

### 📈 Niveaux écrit + vocal (`/niveau`)
- XP **texte** par message (anti-spam avec cooldown) et XP **vocal** par minute en vocal
- Niveaux séparés écrit/vocal, annonces de montée de niveau, `/niveau voir`, `/niveau classement`

### 🧑‍💼 Service RP (`/service` et `/temps`)
- `/service prise` / `/service fin` — annonce en embed, rôle « En service » automatique, durée calculée
- `/service liste` — **[Staff]** liste des membres en service
- `/temps faction:…` — **[Gérant]** temps de service des membres de **sa** faction (7 derniers jours + total, membres en service signalés 🟢). Une faction = une **entreprise** (gérants = patrons) ou un **rôle métier** de la whitelist (gérants = rôles gérants configurés). Le menu s'adapte automatiquement à chaque entreprise créée ou métier configuré ; plusieurs gérants possibles ; le staff voit toutes les factions

### 🎫 Système de tickets (`/ticket`)
- **Types de tickets multiples**, chacun relié à une **catégorie Discord** (`/ticket type-ajouter nom:Support categorie:… role_support:@Support emoji:🛠️`) — les salons de tickets se créent dans la catégorie du type
- **Panneau à boutons** publié en **message basique ou embed entièrement personnalisable** (`/ticket panneau mode:… texte / titre / description / couleur hex / image / miniature / footer`, `\n` pour les sauts de ligne) et **modifiable à souhait** après coup (`/ticket panneau-modifier` — fusionne vos changements et resynchronise les boutons avec les types)
- Clic sur un bouton → salon privé (membre + rôle support + staff), 1 ticket ouvert max par membre et par type, bouton 🔒 **Fermer** (auteur/support/staff) puis 🗑️ **Supprimer** (support/staff) avec **transcript** envoyé dans le salon de logs

### 💞 Interactions façon Nekotina (`/interact`)
- `/interact kiss` (avec choix **sur les lèvres ou sur la joue**), `hug`, `pat`, `bite`, `lick` : choisissez un membre → **embed avec un GIF anime tiré d'internet** (API nekos.best avec le nom de l'anime en pied de page, waifu.pics en secours)
- **Compteur par duo** (« Ils se sont embrassés N fois ») et boutons **Rendre** / **❌ Rejeter**, utilisables uniquement par la personne visée
- **🏅 Badges par paliers** (10 🥉, 50 🥈, 100 🥇, 250 💎, 500 👑 utilisations par catégorie) **envoyés en MP** au moment du déblocage ; `/interact badges` pour consulter les siens
- **Traduction automatique** selon la langue Discord de chaque utilisateur (français, anglais, espagnol, allemand — repli anglais) : phrases, compteurs, boutons, badges
- Fonctionne **sur les serveurs et en message privé** avec le bot ; installable en **app utilisateur** ; réponses publiques (non éphémères)
- **Contrôle administrateur du bot** (`.env`) : `MODULE_INTERACT=off` désactive le module sur **ce bot** (commande retirée + boutons bloqués) ; `INTERACT_GUILDS=id1,id2` limite le module à **certains serveurs** (vide = partout)

### ℹ️ Fiche membre (`/info`)
- `/info [membre]` — fiche **visible uniquement par vous** (éphémère) : 💬 nom, 🔢 ID, 🚫 statut de blacklist (avec la raison), 🏅 badges d'interactions par catégorie
- Fonctionne **partout** : sur les serveurs, en **message privé** avec le bot et en **app utilisateur** — l'embed d'attestation est publiée quel que soit l'endroit
- Si vous consultez **votre propre fiche** en étant **créateur du bot** (propriétaire de l'application Discord ou `OWNER_ID` du `.env`) ou **membre de l'équipe du bot** (`BOT_TEAM` du `.env`, IDs séparés par des virgules), un bouton **« Me désigner »** apparaît sous l'embed : en cliquant, le bot publie une **embed publique d'attestation** (👑 créateur officiel / 🛡️ membre officiel du staff) émise par le bot lui-même — preuve fiable, impossible à falsifier

### 🚨 Anti-scam par images échantillons (`/scamimage`)
- `/scamimage ajouter image:… [nom]` — **[Staff]** enregistre une image scam échantillon
- Toute image postée **identique ou quasi identique** (empreinte SHA-256 + empreinte perceptuelle dHash, tolérante aux recompressions/légères retouches) est **supprimée** et son auteur reçoit un **ban global automatique** (tous les serveurs du bot + auto-ban à toute arrivée future), avec suppression de ses messages des dernières 24 h — annulable via `/banglobal retirer`
- `/scamimage liste`, `/scamimage retirer` — gestion des échantillons

### 📋 Whitelist métiers (`/whitelist`)
- Exemple : le **gérant Police** recrute un policier → `/whitelist ajouter utilisateur:@recrue role:@Policier` → le bot **attribue automatiquement le rôle**
- Un gérant **ne peut attribuer que les rôles métier qui lui ont été autorisés** — toute tentative non autorisée est refusée et tracée dans les logs
- `/whitelist config ajouter role:@Policier gerant:@GérantPolice` — **[Admin]** autorise un rôle gérant à whitelister un rôle métier (plusieurs gérants possibles par métier)
- `/whitelist retirer` — retire la whitelist **et** le rôle ; `/whitelist liste` — membres whitelistés d'un métier ; `/whitelist roles` — rôles que vous pouvez attribuer
- Le **staff** peut whitelister tous les rôles métier configurés

### 📡 Annonces réseaux sociaux (`/reseaux`)
- Le bot **suit vos chaînes et comptes** — ▶️ YouTube, 🟣 Twitch, 🎵 TikTok, 🐦 X (Twitter), 👽 Reddit — et **annonce automatiquement** dans le salon choisi quand un **stream démarre** (Twitch) ou qu'une **nouvelle vidéo/publication** sort (vérification toutes les 5 minutes)
- `/reseaux ajouter plateforme identifiant salon [message]` — **[Staff]** le **lien de la chaîne/du compte est valide** : le bot retrouve la chaîne à partir de n'importe quel lien (page de chaîne, **lien d'une vidéo**, youtu.be, liens mobiles…), d'un @pseudo ou d'un r/subreddit, et affiche son **vrai nom** ; message personnalisé avec les variables `{nom}`, `{titre}`, `{lien}` (sinon message par défaut avec aperçu du lien)
- `/reseaux retirer` (avec autocomplétion), `/reseaux liste` — vue aussi dans `/config` → 📡 Réseaux sociaux
- À l'ajout d'un flux, le contenu déjà publié est mémorisé **sans être annoncé** (pas de spam d'anciennes vidéos) ; ⚠️ X et TikTok bloquent parfois les requêtes automatisées — YouTube, Twitch et Reddit sont les plus fiables

### 🛡️ Équipe du bot — hiérarchie, blacklist globale & QG des tickets
- **Hiérarchie du staff du bot** (indépendante des serveurs), gérée par le **créateur** :
  - `/botstaff ajouter utilisateur grade` — ajouter un membre avec son grade (ex : Responsable, Modérateur)
  - `/botstaff permission utilisateur permission état` — donner/retirer les permissions **🚫 Blacklist**, **🎫 Tickets du QG**, **🛡️ Gestion du staff**
  - `/botstaff retirer`, `/botstaff liste` — le créateur du bot a toutes les permissions d'office
- **🚫 Blacklist globale** (permission Blacklist requise) :
  - `/blacklist ajouter utilisateur raison` — l'utilisateur reçoit un **MP avec la raison et l'invitation du serveur de déban**, est **banni de tous les serveurs du bot** et **re-banni automatiquement à chaque arrivée** tant que la blacklist n'est pas levée
  - `/blacklist retirer` — lève la blacklist et débannit partout ; `/blacklist liste`
  - `/blacklist serveur-deban invitation` — **[Créateur]** définit le lien du serveur de contestation joint aux MP
- **🏛️ QG des tickets** (`/botstaff salon-qg` — créateur) : chaque **bannissement** sur un serveur du bot et chaque **`/report utilisateur raison`** (ouvert à tous) arrive en embed dans le salon QG, avec les boutons :
  - **🙋 Claim** — prendre le ticket (permission Tickets requise ; un seul staff à la fois)
  - **🔗 Invitation du serveur** — le bot crée une invitation du serveur d'origine (1 h, 1 utilisation) donnée **en lecture seule** au staff qui a claim
  - **⏭️ Passer** — rendre le ticket pour qu'un autre staff le prenne
  - **⚖️ Traiter** — le bot demande la décision : **✅ Aucune sanction** ou **🚫 Blacklist** (l'utilisateur ne pourra plus rejoindre aucun serveur du bot tant qu'il n'est pas unblacklist)
- **🔗 `/invite`** — tout le monde peut inviter le bot sur son serveur (ou l'installer sur son compte), depuis n'importe où

### 🔨 Modération staff
- `/arrivee`, `/depart` — annonces d'arrivée/départ staff (enregistrées en base)
- `/ban`, `/kick`, `/mute` (timeout), `/unmute`
- `/banglobal` — **[Admin]** bannit sur **tous les serveurs** du bot + **auto-ban à toute arrivée future**
- `/update` — **[Admin]** redémarre le bot pour charger la dernière mise à jour publiée
- `/stop` — **[Propriétaire du bot uniquement]** éteint complètement le bot, depuis n'importe quel serveur (propriétaire = owner de l'application Discord, ou `OWNER_ID` dans le `.env`)

### 👋 Arrivées et départs des membres
Dans le salon membres configuré (`/config` → Salons → 👋) : **embed d'arrivée** (nom Discord, ID, photo de profil, date de création du compte, n° de membre) et **embed de départ** (nom, ID, photo de profil, **depuis quand il avait rejoint le serveur**, membres restants)

### 📜 Logs de sécurité étendus
Dans le salon de logs configuré : toutes les actions staff et accès refusés, plus les **connexions/déconnexions/changements de salon vocal**, les **messages supprimés** (auteur, salon, contenu, pièces jointes) et les **messages modifiés** (avant/après)

### ⚙️ Configuration (`/config`) — panneau central
- `/config` ouvre un **panneau interactif unique** (éphémère) avec la vue d'ensemble et toutes les catégories :
  - 🎭 **Module RP** — activation/désactivation des commandes RP (respecte le 🔒 verrouillage administrateur)
  - 👮 **Rôles** — staff et administration en **multi-sélection** (plusieurs rôles staff/admin possibles, tous donnent le grade), rôle en service
  - 📢 **Salons** — logs, niveaux, service, staff, membres, mises à jour (sélecteurs de salons)
  - 📈 **XP & niveaux** — formulaire XP texte/vocal et cooldown
  - 📋 **Whitelist métiers** — vue des autorisations gérants
  - 🎫 **Tickets** — création d'un type en formulaire (nom, emoji) puis choix de la catégorie Discord, définition du rôle support par sélecteur, suppression — le tout sans quitter le panneau
  - 📡 **Réseaux sociaux** — vue des chaînes/comptes suivis et de leurs salons d'annonce
- Accessible au **staff** ; le rôle **Administration** ne peut être modifié que par un admin (sécurité grade élevé) ; chaque changement est tracé dans les logs

## 🎭 Module RP activable

Les systèmes RP — 🪪 `/carte`, 🚗 `/permis`, 🏢 `/entreprise`, 🛡️ `/assurance`, 🧑‍💼 `/service`, ⏱️ `/temps` — forment le **Module RP**, désactivé par défaut. Tant qu'il n'est pas activé, ces commandes **n'apparaissent pas** dans la liste du serveur (elles sont réellement retirées par la synchronisation, pas seulement bloquées) : seules les commandes de base du bot restent visibles. Activation : `/config` → **🎭 Module RP** → bouton Activer, ou dashboard du gestionnaire → page 🎭 Module RP — la liste des commandes du serveur est resynchronisée immédiatement. Le bot synchronise aussi automatiquement les commandes de chaque serveur à son démarrage et quand il rejoint un nouveau serveur.

**🔒 Verrouillage administrateur** : depuis le gestionnaire (page 🎭 Module RP), l'administrateur du bot peut **verrouiller** le réglage d'un serveur — le staff du serveur ne peut alors plus activer ni désactiver le Module RP via `/config` (boutons grisés + refus explicite) ; seul le gestionnaire peut encore le changer.

## 🤫 Anti-flood

Toutes les réponses de commandes sont **éphémères** (« lecture seule » : visibles uniquement par la personne qui tape la commande) — les salons textuels ne sont jamais inondés. Les messages publics passent exclusivement par les **salons dédiés** configurés dans `/config` : annonces de service, arrivées/départs staff, montées de niveau et journal de sécurité (qui garde la trace publique des actions de modération pour le staff).

## 🔐 Sécurité

- **3 grades** : Membre (0) → **Staff** (2) → **Administration** (3)
- **Plusieurs rôles Discord** peuvent donner chaque grade (multi-sélection dans `/config` → Rôles et dans le dashboard du gestionnaire)
- Le grade est vérifié **côté bot, de façon centralisée** pour chaque commande — impossible à contourner même si les permissions Discord de la commande sont mal réglées
- Repli sans configuration : permission Discord **Modérer les membres** = staff, **Administrateur** = admin
- Les actions sensibles (`/config`, `/banglobal`, configuration des autorisations de whitelist) exigent le grade **Administration**
- **Journal de sécurité** : toutes les actions staff (et les tentatives d'accès refusées) sont tracées dans le salon de logs configuré

## 📦 Exécutable téléchargeable (sans installer Node.js)

Des exécutables autonomes (Windows `.exe` et Linux) sont compilés automatiquement par GitHub Actions et publiés dans les **[Releases](../../releases)** du dépôt.

1. Téléchargez le fichier pour votre système depuis la [dernière release](../../releases/latest) et placez-le dans un dossier dédié
2. Lancez-le une première fois : un fichier **`.env` est créé automatiquement** à côté de l'exécutable
3. Ouvrez ce `.env` et remplissez `DISCORD_TOKEN` et `CLIENT_ID` (+ `GUILD_ID` recommandé pour des commandes instantanées) — voir « Créer l'application Discord » ci-dessous
4. Relancez : le bot se connecte et **enregistre automatiquement les commandes slash**

La base `data.sqlite` est créée à côté de l'exécutable.

### 🔄 Mise à jour automatique
L'exécutable est **relié aux releases GitHub** : à chaque lancement, il compare sa version à la dernière release, télécharge la nouvelle version si besoin, se remplace et redémarre tout seul. Chaque push sur le dépôt publie automatiquement une nouvelle release `v1.0.<n>` — les modifications du code arrivent donc chez vous **sans rien faire**. Pour désactiver : ajoutez `AUTO_UPDATE=off` dans le `.env`.

### 📦 Annonces de mise à jour au staff
Quand une **nouvelle version est prête** (release publiée pendant que le bot tourne), le bot l'annonce sur chaque serveur **en mentionnant le rôle staff** : embed « 📦 Mise à jour prête » (installation via `/update` ou au prochain redémarrage), puis « ✅ Mise à jour installée » une fois la nouvelle version en ligne. Le salon d'annonce se choisit dans `/config` → 📢 Salons → **📦 Salon des annonces de mise à jour**. **Sans salon configuré**, le bot crée automatiquement un salon **`#shadow-logs`** visible **uniquement du staff** (rôles staff/administration configurés + membres avec la permission Administrateur) et y publie les annonces.

## 🤖 Gestionnaire de bots (pour le développeur)

`gestionnaire-bots-win-x64.exe` (dans les mêmes releases) est une **application locale** de gestion multi-bots :

- **Plusieurs bots avec le même code**, chacun dans son dossier isolé (`gestionnaire/bots/<nom>/` avec son `.env`, sa base `data.sqlite`) et **chacun relié à son propre dépôt GitHub** pour ses mises à jour
- ➕ Création d'un bot en formulaire (nom, dépôt, token, CLIENT_ID…) → le `.env` est **généré automatiquement** et l'exécutable **téléchargé automatiquement** depuis le dépôt configuré
- ▶ Démarrer / ⏹ Arrêter chaque bot, 🖥️ **console en direct**, 🚨 **console d'erreurs** dédiée (mémoire + `erreur.log`), ⚙️ éditeur `.env` intégré, ⬇ mise à jour en un clic
- 📋 **« Copier le diagnostic »** : un bloc prêt à coller pour faire déboguer le bot
- L'application est **relançable à volonté** : si elle tourne déjà, un nouveau lancement rouvre simplement l'interface (http://localhost:43550). La fenêtre console du gestionnaire doit rester ouverte ; sa fermeture arrête proprement les bots lancés (ils sont repris automatiquement au prochain lancement s'ils tournent encore)
- La commande Discord `/update` d'un bot géré délègue la mise à jour au gestionnaire (téléchargement + redémarrage automatiques)
- 🎛️ **Dashboard par serveur** (bot démarré) : membres, statistiques (cartes, permis, entreprises, tickets ouverts, whitelist, véhicules assurés), configuration résolue et top niveaux
- 🌐 **Page Serveurs** : tous les serveurs où le bot est présent (icône, nom, membres, ID) avec **🚪 Retirer le bot** d'un serveur en un clic et accès direct au réglage 🎭 Module RP du serveur, y compris son **🔒 verrouillage administrateur**
- 🛡️ **Page Staff du bot** : gestion de l'équipe du bot par **IDs Discord** — création des **grades** (libres : Responsable, Modérateur, Support…), attribution du grade et **permissions par personne** (🚫 Blacklist, 🎫 Tickets du QG, 🛡️ Gestion du staff) en cases à cocher
- 🖼️ **Créateur d'embed avec prévisualisation en direct** façon DraftBot : auteur + icône, titre, description, couleur (pipette), grande image, miniature, pied de page — aperçu identique à Discord pendant la frappe, puis envoi dans le salon choisi
- 🔗 **Bouton « Inviter sur un serveur »** : génère le lien d'invitation du bot à partir du CLIENT_ID de son `.env`

## 🌍 Pack hébergeur — bot chez un hébergeur, panel relié à distance

Le fichier **`pack-hebergeur.zip`** (dans chaque release) fait tourner le bot **chez votre hébergeur** tout en gardant votre panel :

1. Envoyez le contenu du zip chez l'hébergeur et remplissez directement **`config.env`** (pas de fichier caché, aucun renommage : clé `AGENT_KEY` inventée + `AGENT_PORT` alloué + `DISCORD_TOKEN`/`CLIENT_ID`) — les variables du panneau de l'hébergeur priment si vous préférez ; commande de démarrage **`node index.js`** (Node 18+, aucun npm install)
2. L'**agent** télécharge la dernière version du bot depuis les **releases GitHub**, le lance, capture sa console, le relance en cas de crash, et gère `/update` (mise à jour GitHub + relance)
3. Sur votre PC : Gestionnaire → **➕ Nouveau bot → 🌍 Bot hébergé** (URL `http://ip:port` + clé) — le bot distant s'utilise ensuite **comme un bot local** : console en direct, ▶/⏹, ⬇ mise à jour, ⚙️ .env distant, 📊 dashboard complet et page **🌐 Serveurs** (chaque serveur qui ajoute le bot)
4. Sécurité : toutes les routes de l'agent exigent la clé (`401` sinon) ; le panel local peut aussi être exposé (`PANEL_HOST`/`PANEL_PORT`/`PANEL_PASSWORD`, page de connexion intégrée)

## 🎛️ Dashboard web façon DraftBot (`pack-dashboard.zip`)

Un **site web de configuration** pour un hébergeur web Node.js (18+), relié aux bots via l'agent :

- **Connexion avec Discord** (OAuth2) : chaque staff ne voit que les serveurs qu'il **administre** (permission *Gérer le serveur*) et où un bot est présent — partagez simplement l'URL, les droits se vérifient tout seuls
- Pages par serveur, style DraftBot : 📊 vue d'ensemble et statistiques, 🎭 Module RP (🔒 verrouillage administrateur respecté), 👮 rôles staff/admin **multiples**, 📢 salons & logs, 📈 niveaux, 👋 messages de bienvenue/au revoir, 📋 whitelist métiers, 🎫 tickets
- Chaque changement est appliqué **immédiatement** par le bot concerné (via l'agent, clé secrète jamais exposée au navigateur)
- Installation : `index.js` + `config.env` chez l'hébergeur web, `node index.js` — voir le LISEZMOI.md du pack (2 clés OAuth2 à copier depuis le portail développeur Discord + l'URL `/callback` à déclarer)

## 🚀 Installation

### 1. Créer l'application Discord
1. [Portail développeur Discord](https://discord.com/developers/applications) → **New Application**
2. Onglet **Bot** : copier le **token**, puis activer les **Privileged Gateway Intents** :
   - ✅ **Server Members Intent** (whitelist métiers, ban global)
   - ✅ **Message Content Intent** (XP texte)
3. Onglet **OAuth2 → URL Generator** : cocher `bot` + `applications.commands`, permissions : **Administrator** (ou au minimum : Gérer les rôles, Bannir, Expulser, Modérer les membres, Envoyer des messages, Liens intégrés)
4. Inviter le bot avec l'URL générée

### 2. Installer et lancer
```bash
git clone <ce dépôt>
cd Discord-roblox
npm install
cp .env.example .env   # puis remplir DISCORD_TOKEN, CLIENT_ID (et GUILD_ID pour un déploiement instantané)
npm run deploy         # enregistre les commandes slash
npm start              # démarre le bot
```

### 3. Première configuration (sur le serveur)
```
/config                    → panneau central : rôles, salons, XP, whitelist
/whitelist config ajouter role:@Policier gerant:@GérantPolice
```

> ⚠️ Pour la whitelist métiers, le rôle du bot doit être **au-dessus** des rôles métier dans la hiérarchie des rôles du serveur, avec la permission **Gérer les rôles**.

## 🗃️ Données

Toutes les données sont stockées dans `data.sqlite` (SQLite, mode WAL) : cartes d'identité, permis, entreprises (+ direction, employés, véhicules assurés), niveaux, services, présences staff, whitelist métiers (autorisations + inscriptions), bans globaux et configuration par serveur. Pensez à sauvegarder ce fichier.

## 📁 Structure

```
src/
├── index.js              # démarrage, chargement commandes/événements
├── deploy-commands.js    # enregistrement des commandes slash
├── database.js           # schéma SQLite + accès configuration
├── commands/             # carte, permis, entreprise, assurance, niveau,
│                         # service, whitelist, config, staff, moderation
├── events/               # interactions (sécurité centralisée), XP texte,
│                         # XP vocal, whitelist/ban global à l'arrivée
└── utils/                # grades de sécurité, embeds (photo/vidéo/GIF),
                          # générateurs d'ID, calculs de niveaux
```
