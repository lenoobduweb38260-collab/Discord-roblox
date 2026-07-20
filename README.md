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
  - 👮 **Rôles** — staff, administration, en service (sélecteurs de rôles)
  - 📢 **Salons** — logs, niveaux, service, staff (sélecteurs de salons)
  - 📈 **XP & niveaux** — formulaire XP texte/vocal et cooldown
  - 📋 **Whitelist métiers** — vue des autorisations gérants
- Accessible au **staff** ; le rôle **Administration** ne peut être modifié que par un admin (sécurité grade élevé) ; chaque changement est tracé dans les logs

## 🤫 Anti-flood

Toutes les réponses de commandes sont **éphémères** (« lecture seule » : visibles uniquement par la personne qui tape la commande) — les salons textuels ne sont jamais inondés. Les messages publics passent exclusivement par les **salons dédiés** configurés dans `/config` : annonces de service, arrivées/départs staff, montées de niveau et journal de sécurité (qui garde la trace publique des actions de modération pour le staff).

## 🔐 Sécurité

- **3 grades** : Membre (0) → **Staff** (2) → **Administration** (3)
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

## 🤖 Gestionnaire de bots (pour le développeur)

`gestionnaire-bots-win-x64.exe` (dans les mêmes releases) est une **application locale** de gestion multi-bots :

- **Plusieurs bots avec le même code**, chacun dans son dossier isolé (`gestionnaire/bots/<nom>/` avec son `.env`, sa base `data.sqlite`) et **chacun relié à son propre dépôt GitHub** pour ses mises à jour
- ➕ Création d'un bot en formulaire (nom, dépôt, token, CLIENT_ID…) → le `.env` est **généré automatiquement** et l'exécutable **téléchargé automatiquement** depuis le dépôt configuré
- ▶ Démarrer / ⏹ Arrêter chaque bot, 🖥️ **console en direct**, 🚨 **console d'erreurs** dédiée (mémoire + `erreur.log`), ⚙️ éditeur `.env` intégré, ⬇ mise à jour en un clic
- 📋 **« Copier le diagnostic »** : un bloc prêt à coller pour faire déboguer le bot
- L'application est **relançable à volonté** : si elle tourne déjà, un nouveau lancement rouvre simplement l'interface (http://localhost:43550). La fenêtre console du gestionnaire doit rester ouverte ; sa fermeture arrête proprement les bots lancés (ils sont repris automatiquement au prochain lancement s'ils tournent encore)
- La commande Discord `/update` d'un bot géré délègue la mise à jour au gestionnaire (téléchargement + redémarrage automatiques)
- 🎛️ **Dashboard par serveur** (bot démarré) : membres, statistiques (cartes, permis, entreprises, tickets ouverts, whitelist, véhicules assurés), configuration résolue et top niveaux
- 🖼️ **Créateur d'embed avec prévisualisation en direct** façon DraftBot : auteur + icône, titre, description, couleur (pipette), grande image, miniature, pied de page — aperçu identique à Discord pendant la frappe, puis envoi dans le salon choisi
- 🔗 **Bouton « Inviter sur un serveur »** : génère le lien d'invitation du bot à partir du CLIENT_ID de son `.env`

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
