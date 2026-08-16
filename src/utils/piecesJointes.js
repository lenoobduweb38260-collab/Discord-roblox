const { AttachmentBuilder } = require('discord.js');

// 📎 Conserver la pièce jointe d'un message supprimé.
//
// Le problème, et il est réel : un lien de pièce jointe Discord meurt avec son
// message. Il est signé (`?ex=…&is=…&hm=…`) et cesse d'être servi peu après la
// suppression. Un journal qui se contente de noter l'URL affiche donc, quelques
// minutes plus tard, un lien mort — c'est-à-dire rien.
//
// La seule façon de garder l'image est de la RÉCUPÉRER puis de la RENVOYER avec
// le message de journal. Le fichier appartient alors au message du bot : il
// vivra aussi longtemps que lui.
//
// Trois précautions, parce qu'un journal ne doit jamais devenir un problème :
//
//  • Un plafond de taille. Un bot ne peut téléverser que 8 Mo sans boost, et
//    charger 100 Mo en mémoire pour un journal serait absurde. Au-delà, on note
//    le nom et la taille — c'est déjà mieux qu'un lien mort.
//  • Un délai. Une pièce jointe qui ne répond pas ne doit pas retarder le
//    journal : au bout de quelques secondes, on abandonne et on écrit le
//    journal sans elle.
//  • Jamais d'exception. Un échec de téléchargement se traduit par une mention
//    dans le journal, jamais par un journal manquant.

// 8 Mo : la limite de téléversement d'un bot sur un serveur sans boost.
const TAILLE_MAX = 8 * 1024 * 1024;
// Au-delà, le message de journal partirait trop tard pour être utile.
const DELAI = 6000;
// Discord n'accepte pas plus de 10 fichiers par message.
const MAX_FICHIERS = 10;

// Un nom lisible pour l'affichage — sans le paramètre de signature de l'URL.
const nomDe = (p) => String(p?.name || 'fichier').split('?')[0];

function tailleLisible(octets) {
  const n = Number(octets) || 0;
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

// Une pièce jointe s'affiche-t-elle directement dans un message ?
const estImage = (p) =>
  /^image\//i.test(String(p?.contentType || '')) || /\.(png|jpe?g|gif|webp|avif)$/i.test(nomDe(p));

// Récupère UNE pièce jointe. Renvoie null si elle est trop lourde, trop lente,
// ou déjà hors de portée.
async function recuperer(piece) {
  if (!piece?.url) return null;
  if (Number(piece.size) > TAILLE_MAX) return null;

  const arret = new AbortController();
  const minuteur = setTimeout(() => arret.abort(), DELAI);
  try {
    const reponse = await fetch(piece.url, { signal: arret.signal });
    if (!reponse.ok) return null;
    const donnees = Buffer.from(await reponse.arrayBuffer());
    // La taille annoncée peut mentir : on revérifie sur ce qu'on a vraiment.
    if (donnees.length > TAILLE_MAX || donnees.length === 0) return null;
    return new AttachmentBuilder(donnees, { name: nomDe(piece) });
  } catch {
    // Lien déjà mort, réseau, délai dépassé : le journal partira sans.
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

// 📦 Sauvegarde les pièces jointes d'un message.
//
// Renvoie :
//   • fichiers  → à joindre au message de journal
//   • resume    → la ligne à afficher dans le journal
//   • apercu    → `attachment://…` de la première image, pour l'afficher en
//                 grand comme le ferait le message d'origine
async function sauvegarder(pieces) {
  const liste = [...(pieces?.values?.() || pieces || [])].slice(0, MAX_FICHIERS);
  if (!liste.length) return { fichiers: [], resume: '', apercu: null };

  // En parallèle : un journal ne doit pas attendre six fois le même délai.
  const resultats = await Promise.all(liste.map((p) => recuperer(p).then((f) => ({ piece: p, fichier: f }))));

  const fichiers = [];
  const lignes = [];
  let apercu = null;

  for (const { piece, fichier } of resultats) {
    const nom = nomDe(piece);
    const taille = tailleLisible(piece.size);
    if (fichier) {
      fichiers.push(fichier);
      lignes.push(`✅ **${nom}** · ${taille}`);
      if (!apercu && estImage(piece)) apercu = `attachment://${nom}`;
    } else if (Number(piece.size) > TAILLE_MAX) {
      lignes.push(`⚠️ **${nom}** · ${taille} — trop lourde pour être conservée (${tailleLisible(TAILLE_MAX)} maximum)`);
    } else {
      lignes.push(`❌ **${nom}** · ${taille} — le fichier n'était déjà plus accessible`);
    }
  }

  const restantes = (pieces?.size ?? liste.length) - liste.length;
  if (restantes > 0) lignes.push(`*… et ${restantes} pièce(s) jointe(s) de plus, non conservée(s)*`);

  return { fichiers, resume: lignes.join('\n'), apercu };
}

module.exports = { sauvegarder, recuperer, estImage, nomDe, tailleLisible, TAILLE_MAX, DELAI, MAX_FICHIERS };
