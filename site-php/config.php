<?php
// ⚙️ Configuration du site
//
// 🎉 PLUS RIEN À CONFIGURER ICI POUR RELIER VOS BOTS.
// L'adresse et la clé de votre agent se saisissent MAINTENANT dans le site :
//     ⚙️ Espace créateur → 🤖 Mes bots → « 🔗 Connexion à votre agent »
// Vous collez les deux valeurs, vous cliquez sur « Tester et enregistrer »,
// et le site vous dit immédiatement si ça marche (et sinon, pourquoi).
// Les réglages sont conservés dans data/agent.php, hors d'atteinte du web.

// ================== 🔒 ACCÈS À L'ADMINISTRATION ==================
// 🎉 La connexion se fait normalement avec un COMPTE DISCORD :
//     ⚙️ Espace créateur → 🔑 Connexion Discord
// Le PREMIER compte Discord à se connecter devient propriétaire du site et
// choisit ensuite qui d'autre peut l'administrer.
// ⚠️ Connectez-vous DÈS L'INSTALLATION, avant de communiquer l'adresse de
//    votre site : tant que personne ne l'a fait, tout le monde peut modifier
//    la page d'accueil, les bots, les permissions et les tickets.
//
// Ce mot de passe est un ACCÈS DE SECOURS, facultatif : il vous dépanne si
// vous perdez l'accès à votre compte Discord. Laissé vide, seule la connexion
// Discord fonctionne.
const SITE_ADMIN_PASSWORD = '';

// ================== 🔗 LIAISON (ancienne méthode, facultative) ==================
// Ces deux lignes ne servent plus qu'aux installations déjà en place.
// Laissez-les vides : ce qui est saisi dans le site est prioritaire, et à
// défaut le site reprend tout seul les réglages du dashboard installé à côté.
const SITE_AGENT_URL = '';
const SITE_AGENT_KEY = '';
