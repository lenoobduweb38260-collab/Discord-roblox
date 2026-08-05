<?php
// ⚙️ Configuration du site — le SEUL fichier à éditer à la main.
// Tout le reste (bots, page d'accueil, thème…) se règle depuis le site,
// dans l'espace ⚙️ Créateur.

// ================== 🔗 LIAISON AVEC VOS BOTS ==================
// ✅ RIEN À FAIRE si votre dashboard est installé dans un sous-dossier
//    « dashboard » : le site reprend automatiquement son AGENT_URL et son
//    AGENT_KEY. Laissez ces deux lignes vides.
//
// Sinon, recopiez ici les mêmes valeurs que dans le config.php du dashboard :
//   SITE_AGENT_URL = l'ADRESSE de votre agent  -> http://IP-du-serveur:PORT
//                    (ce n'est PAS le Client ID du bot)
//   SITE_AGENT_KEY = la clé de l'agent
const SITE_AGENT_URL = '';
const SITE_AGENT_KEY = '';

// ================== 🔒 ACCÈS À L'ADMINISTRATION ==================
// ⚠️ IMPORTANT en ligne : sans mot de passe ici, N'IMPORTE QUI trouvant
// l'adresse de votre site peut modifier la page d'accueil, les bots, les
// permissions et les tickets.
// Renseignez un mot de passe : la lecture du site reste publique, mais
// TOUTE modification demandera ce mot de passe (cadenas 🔒 en haut à droite).
const SITE_ADMIN_PASSWORD = '';
