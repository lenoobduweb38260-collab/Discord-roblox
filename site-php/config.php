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
// ⚠️ IMPORTANT en ligne : sans mot de passe ici, N'IMPORTE QUI trouvant
// l'adresse de votre site peut modifier la page d'accueil, les bots, les
// permissions, les tickets — et la connexion à votre agent.
// Renseignez un mot de passe : la lecture du site reste publique, mais
// TOUTE modification demandera ce mot de passe (cadenas 🔒 en haut à droite).
const SITE_ADMIN_PASSWORD = '';

// ================== 🔗 LIAISON (ancienne méthode, facultative) ==================
// Ces deux lignes ne servent plus qu'aux installations déjà en place.
// Laissez-les vides : ce qui est saisi dans le site est prioritaire, et à
// défaut le site reprend tout seul les réglages du dashboard installé à côté.
const SITE_AGENT_URL = '';
const SITE_AGENT_KEY = '';
