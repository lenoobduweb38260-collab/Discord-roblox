# 🌍 Pack hébergeur MULTI-BOTS — vos bots chez l'hébergeur, votre panel sur votre PC

Ce pack fait tourner **PLUSIEURS bots avec le même code** chez votre hébergeur :
- 🤖 **Un seul déploiement** : un exécutable du bot partagé, **un dossier par bot** (`bots/<nom>/` avec sa configuration et sa base de données)
- 🔄 **Mises à jour toujours via GitHub** : le code est téléchargé depuis la dernière release, et `/update` sur Discord met à jour puis relance le bot
- 🖥️ **Lien avec votre panel** (Gestionnaire de bots sur votre PC) : console en direct par bot, ▶/⏹, configuration à distance, dashboard complet — dont la page **🌐 Serveurs** qui liste **chaque serveur ayant ajouté le bot**
- 🔁 Relance automatique en cas de crash

## 1️⃣ Installation chez l'hébergeur (une seule fois)

1. **Envoyez le contenu du ZIP** dans un dossier de votre hébergeur
2. Ouvrez **`config.env`** (fichier visible, aucun renommage) et remplissez :
   - `AGENT_KEY` — inventez une **longue clé secrète** (le mot de passe du lien avec votre panel)
   - `AGENT_PORT` — le port réseau que votre hébergeur vous a alloué
   - *(les tokens Discord ne vont PAS ici — chaque bot a sa propre configuration, voir ci-dessous)*
3. Commande de démarrage : **`node index.js`** (Node.js **18+**, aucun `npm install`)
   - Egg Pterodactyl : variable **`MAIN_FILE`** = `index.js` (si erreur ts-node : mettez littéralement `*.js`)
4. La console doit afficher : `🌍 Agent hébergeur MULTI-BOTS prêt : port …`

## 2️⃣ Relier vos bots depuis votre panel (sur votre PC)

Pour **chaque** bot (existant ou nouveau) :
1. Sélectionnez le bot → bouton **🌍 Hébergé** (ou ➕ Nouveau bot → section 🌍)
2. **La même URL** (`http://IP:AGENT_PORT`) et **la même clé** pour tous les bots
3. **🧪 Tester** → le panel vous dit précisément si la liaison passe (et sinon, pourquoi)
4. Onglet **⚙️ .env** → remplissez `DISCORD_TOKEN` + `CLIENT_ID` de CE bot → 💾 → **▶ Démarrer**

Le nom du bot dans le panel = le nom de son dossier `bots/<nom>` chez l'hébergeur
(créé automatiquement au premier contact). Chaque bot a sa base `data.sqlite`
dans son dossier — **sauvegardez le dossier `bots/`**.

## 🔄 Les mises à jour

- **Le code des bots** (partagé) : `/update` sur Discord ou le bouton ⬇ du panel → l'agent télécharge la dernière release GitHub puis relance le bot concerné. Les annonces automatiques (`#shadow-logs`) préviennent le staff.
- **L'agent lui-même** : re-téléversez le `index.js` du dernier `pack-hebergeur.zip` et redémarrez (il change rarement).

## 🛡️ Sécurité

- **Toutes** les routes de l'agent exigent la clé `AGENT_KEY` — sans elle, réponse 401.
- Ne partagez jamais `config.env` ni le dossier `bots/` (tokens des bots).
- Si votre hébergeur propose un pare-feu, ouvrez uniquement le port `AGENT_PORT`.

## ❓ Dépannage

- **« hébergeur injoignable » dans le panel** → bouton **🧪 Tester** du dialogue 🌍 : il distingue
  connexion refusée (agent éteint / mauvais port), délai dépassé (IP/pare-feu), clé refusée (AGENT_KEY),
  et agent trop ancien (re-téléverser `index.js`).
- **Erreur `ts-node` au démarrage** (`Cannot read properties of undefined (reading 'fileExists')`) →
  l'hébergeur lance le fichier avec ts-node : variable **`MAIN_FILE`** = `index.js` (sinon littéralement `*.js`),
  ou commande de démarrage `node /home/container/index.js`.
- **Le bot ne démarre pas : « DISCORD_TOKEN manquant »** → la configuration est PAR BOT :
  onglet ⚙️ .env du panel (bot sélectionné) → remplissez le token → 💾 → ▶.
- **Le bot ne se connecte pas à Discord** → vérifiez le token et les **intents** (Server Members +
  Message Content) dans le portail développeur.
