// 🎶 Le système de musique — la façade.
//
// L'ancien fichier faisait 842 lignes et mélangeait trois métiers. Ils vivent
// désormais chacun chez eux, et ce fichier n'est plus que leur adresse :
//
//  • musiqueSession.js — LA LECTURE : une Session par serveur (file d'attente,
//    lecteur, boucles, volume, radios, solitude), tout l'état au même endroit ;
//  • musiqueVocal.js   — LA CONNEXION : deux essais, rotation de région,
//    l'espion des sous-étapes réseau, et les diagnostics qui CONSTATENT ;
//  • musiqueMoteur.js  — LES SOURCES : play-dl préparé, résolution des liens,
//    ouverture des flux, briques audio (Opus, chiffrement, FFmpeg) ;
//  • musiqueSources.js — la reconnaissance des plateformes et leurs fiches ;
//  • radios.js         — l'annuaire des radios françaises.
//
// Les commandes (/musique, /radio) et l'événement vocal passent par ici :
// le contrat public n'a pas bougé, seuls les murs porteurs ont été refaits.
const session = require('./musiqueSession');
const vocal = require('./musiqueVocal');

module.exports = {
  // La lecture, par serveur.
  ajouter: session.ajouter,
  ajouterPiste: session.ajouterPiste,
  quitter: session.quitter,
  passer: session.passer,
  pause: session.pause,
  reprendre: session.reprendre,
  volume: session.volume,
  boucler: session.boucler,
  melanger: session.melanger,
  retirer: session.retirer,
  etat: session.etat,
  verifierSolitude: session.verifierSolitude,
  fileDe: session.pour,
  files: session.sessions,

  // La connexion et ses diagnostics.
  expliquerEchecVocal: vocal.expliquerEchecVocal,
  diagnostiquerVocal: vocal.diagnostiquerVocal,
  lireDiagnostic: vocal.lireDiagnostic,
  releverPreuves: vocal.releverPreuves,
  ETAPES_RESEAU: vocal.ETAPES_RESEAU,

  // Les constantes que les tests et l'affichage lisent.
  DELAI_SEUL: session.DELAI_SEUL,
  DELAI_VIDE: session.DELAI_VIDE,
  MAX_ECHECS: session.MAX_ECHECS,
  VOLUME_DEFAUT: session.VOLUME_DEFAUT,
};
