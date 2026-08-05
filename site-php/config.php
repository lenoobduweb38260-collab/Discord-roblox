<?php
// ⚙️ Configuration du site
//
// 🎉 PLUS RIEN À CONFIGURER ICI POUR RELIER VOS BOTS.
// L'adresse et la clé de votre agent se saisissent MAINTENANT dans le site :
//     ⚙️ Espace créateur → 🤖 Mes bots → « 🔗 Connexion à votre agent »
// Vous collez les deux valeurs, vous cliquez sur « Tester et enregistrer »,
// et le site vous dit immédiatement si ça marche (et sinon, pourquoi).
// Les réglages sont conservés dans data/agent.php, hors d'atteinte du web.

// ================== 👑 LE PROPRIÉTAIRE DU SITE (c'est VOUS) ==================
// Collez ICI votre identifiant Discord (17 à 20 chiffres) : vous serez le
// SEUL et UNIQUE propriétaire du site, définitivement.
//
// Comment l'obtenir : Discord → Paramètres → Avancés → activez le « Mode
// développeur ». Puis clic droit sur votre propre nom → « Copier l'identifiant ».
//
// Pourquoi c'est le réglage le plus important :
//   • personne ne peut vous retirer ce grade, même depuis le site ;
//   • dès que cette ligne est remplie, le site est VERROUILLÉ : plus aucun
//     inconnu ne peut s'en emparer, même s'il trouve l'adresse avant vous ;
//   • laissée vide, le site se rabat sur « le premier compte connecté devient
//     propriétaire » — pratique, mais moins sûr.
const SITE_OWNER_ID = '';

// ================== 🔒 ACCÈS DE SECOURS ==================
// Tout se passe normalement avec les COMPTES DISCORD :
//     ⚙️ Espace créateur → 🔑 Connexion & équipe
// Vous y listez, un par un, les identifiants Discord qui ont le droit
// d'entrer dans l'espace de gestion, chacun avec son grade. Les autres
// visiteurs ne voient que la page d'accueil publique.
//
// Ce mot de passe est un FILET DE SÉCURITÉ, facultatif : il vous dépanne si
// vous perdez l'accès à votre compte Discord. Laissé vide, seule la connexion
// Discord fonctionne — c'est très bien ainsi.
const SITE_ADMIN_PASSWORD = '';

// ================== 🔗 LIAISON (ancienne méthode, facultative) ==================
// Ces deux lignes ne servent plus qu'aux installations déjà en place.
// Laissez-les vides : ce qui est saisi dans le site est prioritaire, et à
// défaut le site reprend tout seul les réglages du dashboard installé à côté.
const SITE_AGENT_URL = '';
const SITE_AGENT_KEY = '';
