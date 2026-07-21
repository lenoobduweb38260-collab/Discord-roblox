# 🎛️ Dashboard web façon DraftBot — version PHP (public_html)

La même chose que le pack dashboard Node, mais pour un **hébergement web classique**
(mutualisé, dossier `public_html`, PHP 8+) : **2 fichiers à déposer, rien à installer.**

Chaque staff de serveur se connecte **avec son compte Discord** et configure le bot
sur les serveurs qu'il **administre** (et uniquement ceux-là) : vue d'ensemble,
🎭 Module RP (🔒 verrouillage respecté), 👮 rôles multiples, 📢 salons, 📈 niveaux,
👋 bienvenue/au revoir, 📋 whitelist métiers, 🎫 tickets.

## 🧪 Tester en local d'abord (sans Discord ni agent)

Pour voir l'interface fonctionner immédiatement sur votre PC :
1. Dans `config.php`, mettez **`const DASH_DEMO = true;`**
2. Ouvrez un terminal dans ce dossier et lancez : **`php -S 127.0.0.1:8000`**
   *(Windows : installez PHP puis `php.exe -S 127.0.0.1:8000` ; ou utilisez WampServer/XAMPP)*
3. Ouvrez **http://127.0.0.1:8000** — vous êtes connecté automatiquement avec 3 serveurs
   fictifs et pouvez cliquer partout (les modifications sont simulées, non enregistrées)
4. Une fois satisfait, remettez **`const DASH_DEMO = false;`** et suivez l'installation ci-dessous.

## 1️⃣ Créer la connexion Discord (2 minutes)

1. [Portail développeur Discord](https://discord.com/developers/applications) → votre application (celle d'un de vos bots convient)
2. Onglet **OAuth2** :
   - copiez le **Client ID** → `DASH_CLIENT_ID` dans `config.php`
   - **Reset Secret** → copiez le **Client Secret** → `DASH_CLIENT_SECRET`
   - Dans **Redirects**, ajoutez EXACTEMENT : `VOTRE_URL/index.php?p=callback`
     (ex : `https://monsite.fr/index.php?p=callback` — même valeur que `DASH_URL` + `/index.php?p=callback`)

## 2️⃣ Installer dans public_html

1. Envoyez **`index.php`** et **`config.php`** dans `public_html` (ou un sous-dossier, ex : `public_html/dashboard`)
2. Remplissez `config.php` :
   - les 2 clés OAuth2
   - `DASH_URL` : l'URL publique du dossier, **sans / final** (ex : `https://monsite.fr` ou `https://monsite.fr/dashboard`)
   - `AGENT_URL` (ex : `http://191.44.119.37:9999`) et `AGENT_KEY` — les mêmes que dans votre panel
3. C'est tout — ouvrez `DASH_URL` dans votre navigateur : la page « Se connecter avec Discord » apparaît

Prérequis côté hébergeur (standard partout) : **PHP 8.0+**, extension cURL **ou**
`allow_url_fopen` activé, et le droit de sortir en HTTP vers votre agent
(certains mutualisés gratuits bloquent les ports non standards — testez, sinon
mettez l'agent derrière un port 80/443 ou un sous-domaine Cloudflare).

## 🛡️ Sécurité

- `AGENT_KEY` reste dans `config.php`, **côté serveur** — jamais envoyée au navigateur
- Chaque requête vérifie que le compte connecté **administre** le serveur visé (permission *Gérer le serveur*, admin ou propriétaire)
- Le fichier de cache (`cache-serveurs.php`) est auto-protégé (il ne renvoie rien si on l'ouvre)
- HTTPS fourni par votre hébergement mutualisé = parfait pour l'OAuth2

## ❓ Dépannage

- **Retour à l'accueil après la connexion Discord** → l'URL dans Redirects ne correspond pas exactement à `DASH_URL/index.php?p=callback`, ou le Client Secret est faux (détail dans le journal d'erreurs PHP de l'hébergeur)
- **« Aucun serveur »** → vous n'avez pas *Gérer le serveur* sur ce serveur, ou le bot n'y est pas / n'est pas démarré chez l'agent
- **« Bot injoignable » / « Aucun bot en ligne »** → vérifiez `AGENT_URL`/`AGENT_KEY`, que l'agent tourne, et que votre hébergement web autorise les connexions sortantes vers ce port
- **Page blanche** → activez l'affichage des erreurs PHP de votre hébergeur ou consultez son journal d'erreurs
