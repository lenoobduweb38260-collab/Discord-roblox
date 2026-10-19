// 🧱 Boîte à outils de mise en page des embeds.
//
// Une même grammaire visuelle pour toutes les listes du bot :
//
//   ◆ @🌟 · **Gérant Staff** • 2 membres
//   ➜ @GS | Bayouss
//   ➜ @GS | Leen
//   ───────────────────────────────
//   ◆ @📘 · **Gérant RP Légal** • 0 membre
//   *Aucun membre*
//
// et un pied de page qui dit toujours la même chose au même endroit :
//   « 1972 membres • Mis à jour à 16:07 • Page 1/2 »

const PUCE = '◆';
const FLECHE = '➜';
// ⚠️ 16 signes, pas davantage : au-delà, la ligne repasse à la ligne sur
// téléphone et donne deux traits superposés au lieu d'un filet net.
const SEPARATEUR = '─'.repeat(16);

// Limites Discord, à ne jamais dépasser.
const MAX_DESCRIPTION = 4096;
const MAX_CHAMP = 1024;

// Accord singulier / pluriel, sans y penser à chaque appel.
function pluriel(n, singulier, plurielMot = null) {
  const mot = n > 1 ? (plurielMot || `${singulier}s`) : singulier;
  return `${n} ${mot}`;
}

// Une en-tête de section : ◆ préfixe · **Titre** • compte
function entete(titre, { prefixe = '', compte = null, motCompte = 'membre' } = {}) {
  const gauche = [PUCE, prefixe, prefixe ? '·' : null, `**${titre}**`].filter(Boolean).join(' ');
  return compte === null ? gauche : `${gauche} • ${pluriel(compte, motCompte)}`;
}

// Une entrée de liste : ➜ texte
//
// Idempotente : un texte qui porte DÉJÀ sa flèche ressort tel quel. Sans
// cela, passer une ligne déjà préfixée à `bloc()` donnait « ➜ ➜ texte » —
// c'est arrivé trois fois, dans la liste des serveurs puis dans deux
// sections de /esthetique. Autant rendre l'erreur impossible.
function entree(texte) {
  const t = String(texte ?? '');
  return t.trimStart().startsWith(FLECHE) ? t : `${FLECHE} ${t}`;
}

// Un bloc complet : en-tête + entrées, ou mention en italique si vide.
// ⚠️ `compte: null` doit VRAIMENT retirer le compte. Avec `??`, un null était
// remplacé par le nombre d'entrées : toutes les sections qui demandaient à ne
// pas être comptées affichaient quand même « • 2 membres » — y compris le
// compte rendu de /esthetique, où ça ne voulait rien dire.
function bloc(titre, entrees, options = {}) {
  const compte = Object.prototype.hasOwnProperty.call(options, 'compte') ? options.compte : entrees.length;
  const lignes = [entete(titre, { ...options, compte })];
  if (!entrees.length) lignes.push(`*${options.vide || 'Aucun membre'}*`);
  else lignes.push(...entrees.map((e) => entree(e)));
  return lignes.join('\n');
}

// Assemble des blocs en une description, séparés par un trait.
function description(blocs) {
  return blocs.filter(Boolean).join(`\n${SEPARATEUR}\n`);
}

// ✂️ Découpe une liste de blocs en pages qui tiennent dans un embed.
// On coupe ENTRE deux blocs, jamais au milieu : une section à moitié
// affichée est pire que pas de section du tout.
function paginer(blocs, { maxParPage = 10, budget = MAX_DESCRIPTION - 200 } = {}) {
  const pages = [];
  let courante = [];
  let taille = 0;
  for (const b of blocs) {
    const cout = b.length + SEPARATEUR.length + 2;
    if (courante.length && (courante.length >= maxParPage || taille + cout > budget)) {
      pages.push(courante);
      courante = [];
      taille = 0;
    }
    courante.push(b);
    taille += cout;
  }
  if (courante.length || !pages.length) pages.push(courante);
  return pages;
}

// Heure locale « 16:07 », pour le « Mis à jour à … ».
function heure(date = new Date()) {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Pied de page unifié : « 1972 membres • Mis à jour à 16:07 • Page 1/2 »
// `heure: false` quand la carte porte déjà un horodatage natif : celui-ci
// s'affiche à l'heure de chaque lecteur, et le répéter en texte serait dire
// deux fois la même chose — moins bien la seconde.
function piedDePage({ total = null, motTotal = 'membre', page = null, pages = null, extra = null, heure: avecHeure = true } = {}) {
  const morceaux = [];
  if (total !== null) morceaux.push(pluriel(total, motTotal));
  if (extra) morceaux.push(extra);
  if (avecHeure) morceaux.push(`Mis à jour à ${heure()}`);
  if (page !== null && pages !== null && pages > 1) morceaux.push(`Page ${page}/${pages}`);
  return morceaux.join(' • ');
}

// Boutons de pagination. `id` sert à reconnaître le message d'origine.
// Renvoie null s'il n'y a qu'une page : pas de boutons inutiles.
function boutonsPages(id, page, pages) {
  if (pages <= 1) return null;
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${id}:${page - 1}`)
      .setLabel('Précédent')
      .setEmoji('⏮️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`${id}:${page + 1}`)
      .setLabel('Suivant')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pages)
  );
}

// Coupe proprement un texte trop long pour un champ ou une description.
function borner(texte, max = MAX_CHAMP) {
  const t = String(texte ?? '');
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

// ⭐ Note en étoiles : ★★★★☆ (arrondi au demi près, affiché en pleines).
function etoiles(note, sur = 5) {
  const n = Math.max(0, Math.min(sur, Number(note) || 0));
  const pleines = Math.round(n);
  return '★'.repeat(pleines) + '☆'.repeat(Math.max(0, sur - pleines));
}

// 💬 Citation : le texte d'un membre, dans un bloc citation Discord.
// Chaque ligne est préfixée par « > », et JAMAIS « >>> » : ce dernier
// s'étend jusqu'à la fin du message et avalerait tout ce qui suit.
function citation(texte, max = MAX_CHAMP) {
  const propre = borner(String(texte ?? '').trim(), max - 8);
  if (!propre) return '*Rien à afficher*';
  return propre.split('\n').map((l) => `> ${l}`).join('\n');
}

// 📊 Ligne de statistique : « Moyenne du serveur : ★ 4.1/5 (sur 81 avis) »
function statistique(label, valeur, detail = null) {
  return `${label} : **${valeur}**${detail ? ` *(${detail})*` : ''}`;
}

module.exports = {
  PUCE, FLECHE, SEPARATEUR, MAX_DESCRIPTION, MAX_CHAMP,
  pluriel, entete, entree, bloc, description, paginer, heure, piedDePage, boutonsPages, borner,
  etoiles, citation, statistique,
};
