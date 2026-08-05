# Aincrad Control Panel — PHP

Panneau de gestion Discord complet en PHP, JavaScript natif et CSS, **entièrement
personnalisable depuis le site lui-même** (onglet ⚙️ **Site builder**).

## 🤖 Vos bots — autant que vous voulez

Dans **⚙️ Créateur → 🤖 Mes bots**, ajoutez **autant de bots que nécessaire**
(bouton « ➕ Ajouter un bot », aucune limite). Pour chacun :

| Champ | À quoi ça sert |
|-------|----------------|
| **Nom affiché** | Le nom montré sur le site (ex : `Colmar RP`) |
| **Étiquette** | Petit texte sous le nom (ex : `BOT RP`) |
| **Couleur** | Teinte de la carte du bot |
| **Description** | Une phrase de présentation |
| **Nom chez l'agent** | Le nom EXACT du bot dans votre panel (dossier `bots/<nom>`) — c'est ce qui **relie** le site au bot |
| **Client ID Discord** | Sert au lien « inviter ce bot » (rempli automatiquement à la synchronisation) |

Ensuite **🔄 Synchroniser avec l'agent** : le site interroge chaque bot et
récupère ses **vrais serveurs**, ses compteurs et son Client ID. Un rapport
ligne par ligne indique ✅ ou ❌ **avec la raison** (bot arrêté, nom inconnu,
bot qui ne répond pas…).

### 🔌 Relier le site à votre agent — sans toucher au moindre fichier

Dans **⚙️ Créateur → 🤖 Mes bots**, encadré **« 🔗 Connexion à votre agent »** :

| Champ | Ce que vous collez | Où le trouver |
|---|---|---|
| **Adresse de l'agent** | `http://IP-de-votre-serveur:PORT` | La même valeur que `AGENT_URL` dans le dashboard. Le `http://` est ajouté tout seul si vous l'oubliez. |
| **Clé de l'agent** | la clé de l'agent | `AGENT_KEY` dans le `config.env` de votre agent — identique à celle du dashboard. |

Puis **🔌 Tester et enregistrer**. Le site appelle vraiment votre agent :

- ✅ il répond → les réglages sont enregistrés **et** la liste de vos bots
  s'affiche immédiatement dans « Nom chez l'agent » ;
- ❌ il ne répond pas → **rien n'est enregistré** et le site dit précisément
  pourquoi : clé refusée, port fermé, adresse d'un autre service, ou
  identifiant Discord saisi à la place de l'adresse.

La clé est rangée dans `data/agent.php`, un fichier que le web ne peut pas
lire, et n'est **jamais** renvoyée au navigateur. Laissez le champ vide pour
conserver la clé déjà enregistrée.

> Si le dashboard est installé dans un sous-dossier `dashboard`, le site
> reprend **automatiquement** ses réglages : vous n'avez généralement rien à
> saisir. Tant qu'aucun agent n'est joignable, le site tourne avec des données
> de démonstration.

## 🎨 Site builder — construisez votre site sans toucher au code

Tout se règle dans l’onglet **Site builder**, avec **aperçu en direct** (chaque
modification s’affiche immédiatement) puis un bouton **💾 Enregistrer le site**
qui l’applique pour tous les visiteurs :

| Section | Ce que vous pouvez changer |
|---------|----------------------------|
| 🪪 **Identité** | Nom du site, sous-titre/accroche, **logo** (emoji ou URL d’image), pied de page |
| 🎨 **Thème** | **Couleur d’accent libre** (pastilles ou sélecteur), police (Exo 2 / Orbitron / Inter / Poppins), **style des boutons** (pilule, arrondi, carré, coins coupés SAO), arrondi des cartes (0 → 30 px) |
| 🌌 **Fond du site** | **Votre image ou GIF animé** (téléversement depuis le PC, 10 Mo max, ou URL), ou un **fond animé généré** : Aurora (dégradé animé), Étoiles (ciel dérivant), Grille, Uni — plus assombrissement et flou réglables |
| 🧭 **Navigation** | Renommer, **masquer** et **réordonner** les onglets du menu (▲▼) |
| ✨ **Effets** | Animations, particules flottantes, balayage lumineux, aura du curseur, écran de démarrage, mode compact, maintenance, statut public |
| 🧪 **CSS personnalisé** | Votre CSS injecté tel quel sur tout le site (20 000 caractères) — pouvoir total sur le style |

Et dans **🧱 Constructeur de page**, la page d'accueil se compose **bloc par
bloc** : bannière, sélection des bots, chiffres clés, cartes de
fonctionnalités, texte libre, galerie d'images, FAQ, annonces défilantes,
appel à l'action et pied de page. Chaque bloc s'ajoute, se duplique, se
déplace (▲▼), s'édite et se supprime. Le **logo en haut à gauche** ramène à
cette page d'accueil **sans se déconnecter**.

Le bouton 👁 de la barre du haut affiche la **page d’accueil** telle que la
verront vos visiteurs.

Les images téléversées vont dans `uploads/backgrounds/` (dossier protégé :
aucun script ne peut y être exécuté). Tous les réglages sont enregistrés dans
`data/app.json`.

## Fonctionnalités incluses

- Sélection entre **autant de bots que vous déclarez** (⚙️ Créateur → 🤖 Mes bots).
- Tableau de bord global avec statistiques, activité et état des connexions.
- Liste des serveurs associés à chaque bot.
- Configuration complète d’un serveur à travers huit modules :
  1. Vue d’ensemble
  2. Module RP
  3. Arrivées et départs
  4. Rôles et sécurité
  5. Salons et logs
  6. Niveaux
  7. Whitelist métiers
  8. Tickets
- Blacklist globale avec recherche, sévérité, motif et serveur concerné.
- Téléversement de preuves en PNG, JPG, WEBP, PDF ou TXT.
- Gestion des tickets avec conversation intégrée et changement de statut.
- Espace créateur présentant tous les bots et serveurs.
- Configuration visuelle et fonctionnelle du site.
- Interface responsive pour ordinateur, tablette et mobile.
- Animations, particules, scan holographique, parallaxe et retours visuels.
- API PHP avec persistance JSON et verrouillage des écritures.

## Prérequis

- PHP 8.0 ou supérieur.
- Extension PHP `fileinfo` recommandée pour contrôler les preuves envoyées.
- Droits d’écriture sur `data/`, `uploads/proofs/` et `uploads/backgrounds/`.
- Un serveur Apache, Nginx ou le serveur de développement intégré à PHP.

## Lancement rapide

Depuis le dossier du projet :

```bash
php -S localhost:8000
```

Ouvrez ensuite :

```text
http://localhost:8000
```

## Installation sur un hébergement

1. Envoyez tous les fichiers sur votre hébergement.
2. Faites pointer le domaine ou sous-domaine vers le dossier du projet.
3. Vérifiez que PHP peut modifier `data/app.json`.
4. Vérifiez que PHP peut écrire dans `uploads/proofs/`.
5. Protégez l’accès au panneau avec Discord OAuth2 ou votre système de connexion.

Exemple de permissions Linux :

```bash
chmod -R 775 data uploads/proofs uploads/backgrounds
```

## Structure

```text
Aincrad_Discord_Bot_PHP/
├── index.php                 Interface principale
├── config.php                Mot de passe de secours (facultatif)
├── oauth.php                 Connexion avec un compte Discord
├── lib_discord.php           Fonctions communes à la connexion Discord
├── api.php                   API PHP et actions d’écriture
├── assets/
│   ├── css/style.css         Direction artistique complète
│   ├── js/app.js             Navigation et interactions
│   └── images/aincrad-bg.jpg Fond Aincrad
├── data/
│   ├── app.json              Données utilisées par le site
│   ├── app.default.json      Sauvegarde des données initiales
│   ├── agent.php             Adresse + clé de l'agent (créé par le site, illisible depuis le web)
│   └── discord.php           Application Discord + comptes administrateurs (idem)
├── uploads/proofs/           Preuves envoyées par le staff
└── uploads/backgrounds/      Fonds téléversés depuis le Site builder
```

## Données et API

Le site utilise `data/app.json` pour rester autonome et facile à tester. Les écritures sont protégées par un verrou de fichier afin d’éviter deux modifications simultanées.

Actions disponibles dans `api.php` :

- `blacklist.add`
- `blacklist.delete`
- `blacklist.proof`
- `ticket.message`
- `ticket.status`
- `server.module.save`
- `site.config.save`
- `site.background.upload`  (image / GIF de fond)
- `bots.save`               (liste des bots, sans limite)
- `agent.sync`              (récupère les vrais serveurs depuis l'agent)
- `agent.config`            (teste puis enregistre l'adresse et la clé de l'agent)
- `agent.bots`              (liste les bots déclarés chez l'agent)
- `discord.config`          (vérifie puis enregistre l'application Discord)
- `discord.admins`          (comptes Discord autorisés à administrer)

Pour une grande communauté, remplacez la persistance JSON par MySQL ou PostgreSQL en conservant les mêmes réponses JSON côté API.

## Connexion réelle à Discord

Le panneau est entièrement fonctionnel. Les serveurs et bots livrés sont des
données de démonstration **jusqu'à ce que votre agent soit joignable** :
renseignez la connexion et vos bots dans ⚙️ Créateur → 🤖 Mes bots, puis
cliquez sur **Synchroniser** pour récupérer vos vrais serveurs.

Pour une utilisation réelle, reliez :

- Discord OAuth2 pour identifier les membres du staff.
- L’API ou la base de données de vos bots pour récupérer les serveurs réels.
- Les permissions Discord pour limiter chaque module selon le rôle du membre connecté.
- Un websocket ou votre API de bot pour rendre le chat des tickets instantané entre Discord et le site.

Ne placez jamais le token du bot ou le secret OAuth2 directement dans `app.js` ou dans un fichier accessible publiquement.

## Sécurité conseillée avant production

- Ajouter une authentification Discord OAuth2.
- Vérifier côté PHP les permissions de l’utilisateur connecté.
- Déplacer les secrets dans des variables d’environnement.
- Passer la persistance vers une base SQL.
- Ajouter un jeton CSRF aux formulaires d’écriture.
- Désactiver l’affichage des erreurs PHP en production.
- Configurer une limite de taille d’envoi dans `php.ini`.

## Réinitialisation des données

Pour restaurer les données de démonstration :

```bash
cp data/app.default.json data/app.json
```

## 🔑 Connexion avec un compte Discord

Vos membres se connectent au site avec **leur compte Discord** — pas de mot de
passe à créer. Tout se configure dans **⚙️ Créateur → 🔑 Connexion Discord**.

**1. Déclarez l'adresse de retour.** Le site l'affiche, prête à copier (elle
ressemble à `https://votre-site.fr/oauth.php?p=callback`). Collez-la dans le
[Portail développeur Discord](https://discord.com/developers/applications) →
votre application → **OAuth2** → **Redirects** → **Add Redirect** → **Save**.
Sans cette étape, Discord refuse la connexion.

**2. Renseignez les identifiants** de l'application (OAuth2 → **Client ID** et
**Client Secret**), puis **🔌 Vérifier et enregistrer** : le site interroge
réellement Discord et n'enregistre qu'en cas de succès. Si votre dashboard est
installé à côté, ses identifiants sont repris automatiquement — rien à saisir.

**3. Qui peut administrer.** Le **premier compte Discord** à se connecter
devient propriétaire du site ; lui seul peut ensuite autoriser d'autres comptes.
Connectez-vous donc **avant** de communiquer l'adresse de votre site.

> Le mot de passe `SITE_ADMIN_PASSWORD` de `config.php` reste utilisable comme
> **accès de secours**, si vous perdez l'accès à votre compte Discord. Il est
> facultatif : la connexion Discord suffit.

La clé secrète est rangée dans `data/discord.php`, illisible depuis le web, et
n'est jamais renvoyée au navigateur.

## 🎬 Fond vidéo (MP4)

Dans **🎨 Apparence du site → 🌌 Fond du site**, choisissez la vignette
**Vidéo MP4**, puis téléversez votre fichier (MP4 ou WEBM) ou collez son
adresse. La vidéo tourne **en boucle et sans son** — les navigateurs
n'autorisent la lecture automatique qu'à cette condition.

- L'**assombrissement** et le **flou** s'appliquent à la vidéo comme à l'image :
  gardez un assombrissement suffisant pour que le texte reste lisible.
- L'**image de fond** sert d'image d'attente le temps que la vidéo se charge.
- Si le visiteur a coupé les animations (✨ Effets), la vidéo reste figée.
- La vidéo est téléchargée par **chaque visiteur** : visez quelques Mo. Le site
  affiche la limite d'envoi de votre hébergeur sous le champ de téléversement ;
  au-delà, hébergez la vidéo ailleurs et collez son adresse.
