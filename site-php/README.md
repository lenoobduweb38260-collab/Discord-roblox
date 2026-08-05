# Aincrad Control Panel — PHP

Panneau de gestion Discord complet en PHP, JavaScript natif et CSS, **entièrement
personnalisable depuis le site lui-même** (onglet ⚙️ **Site builder**).

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

Le bouton 👁 de la barre du haut affiche la **page d’accueil** telle que la
verront vos visiteurs.

Les images téléversées vont dans `uploads/backgrounds/` (dossier protégé :
aucun script ne peut y être exécuté). Tous les réglages sont enregistrés dans
`data/app.json`.

## Fonctionnalités incluses

- Sélection entre deux bots : **Kirito** et **Asuna**.
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
- Droits d’écriture sur les dossiers `data/` et `uploads/proofs/`.
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
chmod -R 775 data uploads/proofs
```

## Structure

```text
Aincrad_Discord_Bot_PHP/
├── index.php                 Interface principale
├── api.php                   API PHP et actions d’écriture
├── assets/
│   ├── css/style.css         Direction artistique complète
│   ├── js/app.js             Navigation et interactions
│   └── images/aincrad-bg.jpg Fond Aincrad
├── data/
│   ├── app.json              Données utilisées par le site
│   └── app.default.json      Sauvegarde des données initiales
└── uploads/proofs/           Preuves envoyées par le staff
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

Pour une grande communauté, remplacez la persistance JSON par MySQL ou PostgreSQL en conservant les mêmes réponses JSON côté API.

## Connexion réelle à Discord

Le panneau livré est entièrement fonctionnel pour l’interface, la configuration, les tickets, la blacklist et la persistance locale. Les serveurs et utilisateurs fournis sont des données de démonstration.

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
