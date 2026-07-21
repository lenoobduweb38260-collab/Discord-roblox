<?php
// ⚙️ Configuration du Dashboard web (version PHP pour hébergement public_html)
// Remplissez les valeurs puis envoyez ce fichier avec index.php dans public_html.

// ================== CONNEXION DISCORD (OAuth2) ==================
// Portail développeur Discord > votre application > OAuth2 :
//  - Client ID (= Application ID)
const DASH_CLIENT_ID = '';
//  - Client Secret (bouton « Reset Secret » si besoin)
const DASH_CLIENT_SECRET = '';

// URL PUBLIQUE du dossier où se trouve index.php, SANS / final
// (ex : https://monsite.fr  ou  https://monsite.fr/dashboard)
// ➜ Ajoutez dans Portail développeur > OAuth2 > Redirects EXACTEMENT :
//    CETTE URL + « /index.php?p=callback »
//    (ex : https://monsite.fr/index.php?p=callback)
const DASH_URL = '';

// ================== LIEN AVEC VOS BOTS ==================
// L'agent hébergeur multi-bots (pack-hebergeur.zip) déjà en place :
const AGENT_URL = 'http://191.44.119.37:9999';
const AGENT_KEY = '';
