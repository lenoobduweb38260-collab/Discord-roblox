# 🌍 Pack hébergeur — bot Discord + lien avec votre panel

Ce pack fait tourner **le bot chez votre hébergeur**, avec :
- 🔄 **Mises à jour toujours via GitHub** : l'agent télécharge la dernière release au démarrage, et `/update` sur Discord met à jour puis relance le bot
- 🖥️ **Lien avec votre panel** (Gestionnaire de bots sur votre PC) : console en direct, démarrage/arrêt, éditeur `.env`, dashboard complet — dont la page **🌐 Serveurs** qui liste **chaque serveur ayant ajouté le bot**
- 🔁 Relance automatique en cas de crash

## 1️⃣ Installation chez l'hébergeur

1. **Envoyez le contenu du ZIP** dans un dossier de votre hébergeur
2. Ouvrez **`config.env`** (aucun renommage nécessaire — pas de fichier caché) et remplissez :
   - `AGENT_KEY` — inventez une **longue clé secrète** (c'est le mot de passe du lien avec votre panel)
   - `AGENT_PORT` — le port réseau que votre hébergeur vous a alloué
   - `DISCORD_TOKEN` + `CLIENT_ID` — comme d'habitude (et `OWNER_ID` recommandé)
   - *(Vous pouvez aussi définir ces variables dans le panneau de votre hébergeur : elles priment sur le fichier. Un fichier `.env` classique fonctionne aussi si votre hébergeur l'accepte.)*
3. Commande de démarrage à configurer chez l'hébergeur : **`node index.js`**
   (Node.js **18 ou plus récent** requis — aucun `npm install` nécessaire)
4. Au premier lancement, l'agent télécharge la dernière version du bot depuis GitHub puis le démarre. La base `data.sqlite` est créée dans le même dossier — **sauvegardez-la**.

## 2️⃣ Lien avec votre panel (sur votre PC)

1. Ouvrez votre **Gestionnaire de bots** habituel
2. **➕ Nouveau bot** → section **🌍 Bot hébergé** :
   - **URL de l'agent** : `http://IP-DE-VOTRE-HEBERGEUR:AGENT_PORT`
   - **Clé d'accès** : la valeur de `AGENT_KEY`
3. C'est tout : le bot apparaît dans la barre latérale comme un bot local — console en direct, ▶ / ⏹, ⬇ mise à jour, ⚙️ .env distant, 📊 dashboard, 🌐 Serveurs, 🔗 Inviter…

## 🔄 Les mises à jour

- **Le bot** : `/update` sur Discord (ou le bouton ⬇ du panel) → l'agent télécharge la dernière release GitHub et relance le bot. Le staff est prévenu par les annonces automatiques (`#shadow-logs`).
- **L'agent lui-même** : ce petit script change rarement ; pour le mettre à jour, re-téléchargez `pack-hebergeur.zip` depuis la dernière release GitHub et remplacez `index.js`.

## 🛡️ Sécurité

- **Toutes** les routes de l'agent exigent la clé `AGENT_KEY` — sans elle, réponse 401.
- Ne partagez jamais votre `config.env` (il contient le token du bot ET la clé de l'agent).
- Si votre hébergeur propose un pare-feu, ouvrez uniquement le port `AGENT_PORT`.

## ❓ Dépannage

- **Erreur `ts-node` au démarrage (`Cannot read properties of undefined (reading 'fileExists')`)** →
  votre hébergeur (egg Node.js type Pterodactyl) lance le fichier avec **ts-node** au lieu de **node**.
  Dans l'onglet **Startup** du panneau : mettez la variable **`MAIN_FILE`** à `index.js` — et si
  l'erreur persiste, mettez-la littéralement à `*.js` (c'est la valeur exacte que la commande de
  démarrage compare). Alternative : remplacez la commande de démarrage par `node /home/container/index.js`.
  Le bon lancement affiche « 🌍 Agent hébergeur prêt ».

- **« Clé d'accès invalide » dans le panel** → l'URL pointe bien vers l'agent, mais la clé saisie diffère de `AGENT_KEY`.
- **« Agent hébergeur injoignable »** → vérifiez que l'agent tourne, que le port est ouvert/alloué, et que l'URL est `http://ip:port` (sans « / » final).
- **Le bot ne se connecte pas à Discord** → vérifiez `DISCORD_TOKEN` dans le `.env` (onglet ⚙️ .env du panel, puis redémarrez le bot), et les **intents** (Server Members + Message Content) dans le portail développeur.
