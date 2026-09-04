# 🎛️ Dashboard web façon DraftBot — relié à vos bots

Un site web où **chaque staff de serveur** se connecte **avec son compte Discord** et
configure le bot sur **les serveurs qu'il administre** (et uniquement ceux-là) :
vue d'ensemble et statistiques, 🎭 Module RP (verrouillage respecté), 👮 rôles
staff/admin multiples, 📢 salons, 📈 niveaux, 👋 messages de bienvenue/au revoir,
📋 whitelist métiers et 🎫 tickets. Aucune dépendance : **Node.js ≥ 18** suffit.

## Comment ça marche

```
Navigateur (staff) ── connexion Discord ──► Dashboard (ce pack, hébergeur web)
                                                 │  clé AGENT_KEY (secrète, côté serveur)
                                                 ▼
                                   Agent multi-bots (pack-hebergeur.zip)
                                                 ▼
                                            Vos bots + leurs données
```

## 1️⃣ Créer la connexion Discord (2 minutes)

1. [Portail développeur Discord](https://discord.com/developers/applications) → votre application (celle d'un de vos bots convient)
2. Onglet **OAuth2** :
   - copiez le **Client ID** → `DASH_CLIENT_ID`
   - **Reset Secret** → copiez le **Client Secret** → `DASH_CLIENT_SECRET`
   - Dans **Redirects**, ajoutez : `VOTRE_URL/callback` (ex : `http://191.44.119.37:43700/callback`) — exactement la même valeur que `DASH_URL` + `/callback`

## 2️⃣ Installer chez votre hébergeur web

1. Envoyez `index.js` + `config.env` dans un dossier de votre hébergeur (offre **Node.js**, version 18+)
2. Remplissez `config.env` : les 2 clés OAuth2, `DASH_URL` (l'adresse publique du dashboard), `DASH_PORT` (le port alloué), et le lien vers vos bots (`AGENT_URL` + `AGENT_KEY` — les mêmes que dans votre panel)
3. Commande de démarrage : **`node index.js`** (egg Pterodactyl : `MAIN_FILE` = `index.js`, sinon littéralement `*.js`)
4. La console doit afficher `🎛️ Dashboard web prêt` avec l'URL de redirection à déclarer

## 3️⃣ Utiliser

- Ouvrez `DASH_URL` → **Se connecter avec Discord** → la grille « Mes serveurs » n'affiche que les serveurs que vous **administrez** (permission *Gérer le serveur*) et où un de vos bots est présent
- Cliquez un serveur → pages de configuration à la DraftBot ; chaque changement est appliqué **immédiatement** par le bot (via l'agent)
- Partagez simplement l'URL aux staffs de vos serveurs : la connexion Discord fait le tri des droits toute seule

## 🛡️ Sécurité

- La clé `AGENT_KEY` ne quitte **jamais** le serveur du dashboard (aucune trace dans le navigateur)
- Chaque requête vérifie côté serveur que le compte connecté **administre bien** le serveur visé
- Le 🔒 verrouillage administrateur du Module RP est respecté aussi depuis le web
- Pour un vrai domaine en HTTPS : mettez Cloudflare (gratuit) devant votre IP:port et utilisez l'URL https dans `DASH_URL` + les Redirects Discord

## ❓ Dépannage

- **Retour à l'accueil après la connexion Discord** → l'URL dans Redirects Discord ne correspond pas exactement à `DASH_URL/callback`, ou `DASH_CLIENT_SECRET` est faux (voir la console du dashboard)
- **« Aucun serveur »** → vous n'avez pas la permission *Gérer le serveur* sur le serveur, ou le bot n'y est pas / n'est pas démarré chez l'agent
- **« Bot injoignable »** → vérifiez `AGENT_URL`/`AGENT_KEY` et que l'agent tourne (🧪 Tester depuis votre panel)
- **Erreur ts-node au démarrage** → variable `MAIN_FILE` = `index.js` (sinon littéralement `*.js`)
