<?php
// ⚙️ Configuration du Dashboard web (version PHP pour hébergement public_html)
// Remplissez les valeurs puis envoyez ce fichier avec index.php dans public_html.

// ================== 🧪 MODE DÉMO (test en local) ==================
// Mettez « true » pour tester l'interface EN LOCAL sans Discord ni agent :
// connexion automatique + serveurs et données fictifs. Lancez alors dans ce
// dossier :  php -S 127.0.0.1:8000   puis ouvrez http://127.0.0.1:8000
// ⚠️ Remettez « false » en production (sinon tout le monde entre sans Discord).
const DASH_DEMO = false;

// ================== CONNEXION DISCORD (OAuth2) ==================
// Portail développeur Discord > votre application > OAuth2 :
//  - Client ID (= Application ID)
const DASH_CLIENT_ID = '';
//  - Client Secret (bouton « Reset Secret » si besoin)
const DASH_CLIENT_SECRET = '';

// FACULTATIF — URL publique du dossier, SANS / final (ex : https://monsite.fr).
// ✅ Laissez VIDE dans la plupart des cas : l'URL est détectée automatiquement
// depuis la page visitée, et l'URL de redirection OAuth2 exacte à enregistrer
// (Portail développeur > OAuth2 > Redirects) est affichée sur la page d'accueil
// et sur index.php?p=diag, avec un bouton Copier.
const DASH_URL = '';

// ================== LIEN AVEC VOS BOTS ==================
// L'agent hébergeur multi-bots (pack-hebergeur.zip) déjà en place :
const AGENT_URL = 'http://191.44.119.37:9999';
const AGENT_KEY = '';

// ================== PERSONNALISATION (facultatif) ==================
// Nom affiché en haut du site et sur la page d'accueil.
const DASH_NOM = 'Mon Bot';
// Lien du bouton SUPPORT (vide = bouton masqué), ex : votre serveur Discord.
const DASH_SUPPORT_URL = '';
// Lien du menu DOCUMENTATION (vide = README GitHub par défaut).
const DASH_DOCS_URL = '';
