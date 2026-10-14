# 🎛️ Dashboard web façon DraftBot — version PHP (public_html)

La même chose que le pack dashboard Node, mais pour un **hébergement web classique**
(mutualisé, dossier `public_html`, PHP 8+) : **2 fichiers à déposer, rien à installer.**

Chaque staff de serveur se connecte **avec son compte Discord** et configure le bot
sur les serveurs qu'il **administre** (et uniquement ceux-là) : vue d'ensemble,
🎭 Module RP (🔒 verrouillage respecté), 👮 rôles multiples, 📢 salons, 📈 niveaux,
👋 bienvenue/au revoir, 📋 whitelist métiers, 🎫 tickets.

### 🎚️ Qui peut faire quoi (contrôle d'accès)

| Accès | Qui | Ce qu'il peut faire à distance |
|-------|-----|-------------------------------|
| **Tout le monde** | N'importe quel membre qui **administre** un serveur où le bot est présent | Se connecter avec Discord et **configurer les messages** (bienvenue/au revoir), salons, rôles, niveaux, tickets… de **ses** serveurs |
| 🛡️ **Staff du bot** | Les IDs Discord ajoutés à l'équipe du bot | En plus : blacklist, tickets de bannissement, base de données des preuves |
| ⚙️ **Créateur** (vous) | Le propriétaire du bot (`OWNER_ID` / propriétaire de l'application) | **Tout** : espace staff **+** configuration complète du dashboard (marque, modules, statut par bot) |

Les boutons **Staff** et **Créateur** n'apparaissent qu'aux personnes concernées ; tout le reste est ouvert à chaque administrateur de serveur.

### 🏠 Page d'accueil « Aincrad » personnalisable

- **Messages défilants** : dans l'espace **⚙️ Créateur → « Page d'accueil — messages
  défilants »**, composez jusqu'à 8 annonces (titre + texte) qui défilent dans le
  panneau « ANNONCES » de la page d'accueil publique (réordonnables avec ▲▼).
- **Choix du bot à inviter** : la page d'accueil affiche un bouton « Inviter » par
  bot de votre agent (chaque bot a sa propre application Discord) — le visiteur
  ajoute exactement le bot qu'il veut sur son serveur.
- **Sections créateur par bot** : sur « Mes serveurs », le créateur voit en plus une
  section par bot listant **tous** ses serveurs — même ceux où il n'est pas membre
  (pastille « 👑 accès créateur ») — et peut les configurer à distance.

## 🧪 Tester en local d'abord (sans Discord ni agent)

Pour voir l'interface fonctionner immédiatement sur votre PC :
1. Dans `config.php`, mettez **`const DASH_DEMO = true;`**
2. Ouvrez un terminal dans ce dossier et lancez : **`php -S 127.0.0.1:8000`**
   *(Windows : installez PHP puis `php.exe -S 127.0.0.1:8000` ; ou utilisez WampServer/XAMPP)*
3. Ouvrez **http://127.0.0.1:8000** — vous êtes connecté automatiquement avec 3 serveurs
   fictifs et pouvez cliquer partout (les modifications sont simulées, non enregistrées)
4. Une fois satisfait, remettez **`const DASH_DEMO = false;`** et suivez l'installation ci-dessous.

## 1️⃣ Installer dans public_html (ou `www`)

1. Envoyez **`index.php`** et **`config.php`** dans `public_html`/`www` (ou un sous-dossier, ex : `www/dashboard`)
2. Remplissez `config.php` :
   - `DASH_CLIENT_ID` et `DASH_CLIENT_SECRET` — [Portail développeur Discord](https://discord.com/developers/applications) → votre application → **OAuth2** (Client ID + « Reset Secret »)
   - `AGENT_URL` (ex : `http://IP:43600`) et `AGENT_KEY` — les mêmes que dans votre panel
   - `DASH_URL` : **laissez vide** — l'URL est détectée automatiquement 🎉

## 2️⃣ Enregistrer l'URL de redirection (1 minute, une seule fois)

1. Ouvrez votre site dans le navigateur : la page d'accueil affiche un encart
   **« Première connexion ? »** avec **l'URL de redirection exacte** et un bouton **📋 Copier**
   (elle est aussi sur `index.php?p=diag`)
2. Portail développeur Discord → **OAuth2** → **Redirects** → **Add Redirect** → collez-la → **Save Changes**
3. C'est tout — cliquez « Se connecter avec Discord »

> 💡 L'URL de redirection est **construite depuis la page que vous visitez**
> (https/http, avec ou sans www, sous-dossier…) : elle correspond donc toujours,
> y compris derrière un proxy type Cloudflare. Plus d'erreur « redirect_uri non valide »
> à cause d'une URL recopiée à la main.

## 3️⃣ Vérifier que tout est branché (page de diagnostic)

Ouvrez **`DASH_URL/index.php?p=diag`** (lien « 🔧 Vérifier ma configuration » aussi présent
sur la page d'accueil). Cette page — accessible **même si la configuration est incomplète** —
teste ligne par ligne : version PHP, requêtes sortantes, clés OAuth2, liaison à l'agent
(nombre de bots démarrés et de serveurs détectés) et vous **affiche l'URL de redirection
exacte** à coller dans le portail Discord. Corrigez les lignes ❌ jusqu'à ce que tout soit ✅.

Prérequis côté hébergeur (standard partout) : **PHP 8.0+**, extension cURL **ou**
`allow_url_fopen` activé, et le droit de sortir en HTTP vers votre agent
(certains mutualisés gratuits bloquent les ports non standards — testez, sinon
mettez l'agent derrière un port 80/443 ou un sous-domaine Cloudflare).

## 🔄 Mises à jour automatiques (100 % auto)

Le dashboard se met à jour **tout seul depuis GitHub**, comme le bot — **activé par
défaut, rien à faire**. À chaque chargement de page (au plus une vérification toutes
les **6 h**), s'il existe une release plus récente, `index.php` est remplacé
silencieusement (sauvegarde `index.php.bak`) ; la nouvelle version est servie au
chargement suivant.

Dans l'espace **⚙️ Créateur → « Mises à jour du dashboard »** vous trouvez aussi :
- la **version installée** vs la dernière publiée,
- un interrupteur **🔁 Mise à jour automatique** (pour la désactiver si besoin),
- un bouton **« Mettre à jour maintenant »** pour l'appliquer sans attendre.

- `config.php` n'est **jamais** touché : vos clés et réglages sont conservés.
- La version n'est **jamais** rétrogradée (comparaison `vX.Y.Z`).
- Réservé au **créateur** du bot pour les réglages manuels.
- Nécessite que l'hébergeur autorise PHP à écrire `index.php` (droits `644`/`664`).
  La page `?p=diag` indique si c'est possible ; sinon, ré-uploadez `index.php` à la main.

## 🛡️ Sécurité

- `AGENT_KEY` reste dans `config.php`, **côté serveur** — jamais envoyée au navigateur
- Chaque requête vérifie que le compte connecté **administre** le serveur visé (permission *Gérer le serveur*, admin ou propriétaire)
- Le fichier de cache (`cache-serveurs.php`) est auto-protégé (il ne renvoie rien si on l'ouvre)
- HTTPS fourni par votre hébergement mutualisé = parfait pour l'OAuth2

## ❓ Dépannage

> 💡 En cas de doute, ouvrez d'abord **`DASH_URL/index.php?p=diag`** : la page de diagnostic pointe directement la ligne qui coince.

- **Retour à l'accueil après la connexion Discord** → l'URL dans Redirects ne correspond pas exactement à `DASH_URL/index.php?p=callback`, ou le Client Secret est faux (détail dans le journal d'erreurs PHP de l'hébergeur)
- **« Aucun serveur »** → vous n'avez pas *Gérer le serveur* sur ce serveur, ou le bot n'y est pas / n'est pas démarré chez l'agent
- **« Bot injoignable » / « Aucun bot en ligne »** → vérifiez `AGENT_URL`/`AGENT_KEY`, que l'agent tourne, et que votre hébergement web autorise les connexions sortantes vers ce port
- **Page blanche** → activez l'affichage des erreurs PHP de votre hébergeur ou consultez son journal d'erreurs
