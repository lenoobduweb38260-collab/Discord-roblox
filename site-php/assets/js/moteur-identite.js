// 🎨 Identité visuelle d'un embed — la partie PURE, sans base de données.
//
// Ce fichier est utilisé aux DEUX bouts :
//   • par le bot, pour habiller ce qu'il envoie ;
//   • par le tableau de bord, dans le navigateur, pour prévisualiser.
//
// C'est volontaire, et c'est même tout l'intérêt : deux implémentations du
// rendu finiraient par diverger, et l'aperçu mentirait. Un seul fichier, donc
// un seul comportement. Il ne doit par conséquent JAMAIS rien exiger de Node
// — ni require, ni fs, ni base de données. Les réglages arrivent en argument.

const DEFAUT_ACCENT = '#5865F2';
// Filet posé sous le titre.
// ⚠️ Leçon apprise : à 28 signes, la ligne DÉBORDE et repasse à la ligne sur
// téléphone — deux traits l'un sous l'autre, l'effet inverse de celui voulu.
// Discord n'offre pas de vrai trait horizontal : la largeur dépend de la
// taille de police du lecteur, donc on reste volontairement court. Mieux vaut
// un filet un peu plus étroit que l'embed qu'un filet cassé en deux.
const FILET_DEFAUT = 16;
const filetDe = (n) => '─'.repeat(Math.max(6, Math.min(30, Number(n) || FILET_DEFAUT)));
const FILET = filetDe(FILET_DEFAUT);

function versEntier(couleur) {
  const v = String(couleur || '').trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(v) ? parseInt(v, 16) : null;
}

// 🎨 Couleurs qui ne veulent rien dire.
//
// C'est LE point qui faisait que « tout le monde utilise encore les vieilles
// embeds ». La direction artistique dit de ne jamais écraser une couleur
// porteuse de sens — rouge = sanction, vert = réussite. Mais la moitié des
// embeds du bot ne portaient pas une couleur *choisie* : ils portaient une
// couleur *par défaut*, le bleu de Discord, posé faute de mieux. L'identité
// voyait une couleur et n'y touchait pas, si bien que l'accent du serveur
// n'apparaissait jamais — la patch note en était l'exemple le plus visible.
//
// Ces valeurs-là ne sont donc pas des décisions : ce sont des absences de
// décision. On les traite comme du vide, et l'accent du serveur prend la place.
//
// Rien d'autre n'entre dans cette liste : une couleur absente d'ici est
// considérée comme voulue, et reste intacte.
const COULEURS_NEUTRES = new Set([
  0x5865f2, // « blurple » de Discord — la couleur de la marque, pas la nôtre
  0x3498db, // bleu générique « info »
  0x2b2d31, // gris des cartes Discord (thème sombre)
  0x2f3136, // idem, ancienne nuance
  0x23272a, // idem, plus foncé
  0x36393f, // idem, fond de salon
  0x000000, // noir : quasi toujours un « je n'ai pas choisi »
  0xffffff, // blanc : idem
]);

function couleurNeutre(valeur) {
  if (valeur === undefined || valeur === null) return true;
  const n = typeof valeur === 'number' ? valeur : versEntier(valeur);
  if (n === null || Number.isNaN(n)) return true;
  return COULEURS_NEUTRES.has(n);
}

// Applique l'identité à UN embed déjà sérialisé (objet JSON Discord).
function styliserUn(embed, contexte) {
  if (!embed || typeof embed !== 'object') return embed;
  const r = contexte.reglages;

  // Couleur : soit on impose l'accent partout, soit on comble le vide — et
  // une couleur neutre (le bleu de Discord, un gris de fond) EST du vide :
  // personne ne l'a choisie pour ce qu'elle dit.
  if (r.couleurUnique || couleurNeutre(embed.color)) embed.color = r.accent;

  // Pied de page : « NomDuBot • NomDuServeur », avec l'icône du serveur.
  // On ne touche pas à un pied de page déjà écrit : il dit souvent quelque
  // chose d'utile (« Relancé par X », « Page 2/4 »).
  if (r.piedDePage && !embed.footer?.text) {
    const morceaux = [contexte.bot, contexte.serveur].filter(Boolean);
    if (morceaux.length) {
      embed.footer = { text: morceaux.join(' • ') };
      if (contexte.icone) embed.footer.icon_url = contexte.icone;
    }
  }

  // Ligne d'auteur : l'identité du serveur, présente en haut de CHAQUE embed.
  // Comme pour le pied de page, on ne remplace jamais celle que le bot a
  // écrite lui-même — elle porte souvent le sens du message
  // (« Avis de @membre », « Bienvenue sur … »).
  if (r.ligneAuteur && !embed.author?.name && contexte.serveur) {
    embed.author = { name: contexte.serveur };
    if (contexte.icone) embed.author.icon_url = contexte.icone;
  }

  // ── Champs → sections ────────────────────────────────────────────
  // C'est CE point qui donne l'air « Discord de base » : la grille de petites
  // étiquettes grises produite par les champs d'embed. La direction
  // artistique demandée n'a pas cette grille — elle a des sections, avec un
  // en-tête ◆ et des lignes ➜.
  //
  // On refond donc les champs en sections de description, ici, pour TOUS les
  // embeds du bot d'un coup : y compris ceux qu'aucune commande ne
  // reconstruira jamais.
  //
  // Rien n'est jamais perdu : si le tout ne tient pas dans une description
  // (4096 signes), on laisse les champs tels quels.
  if (r.fusion && Array.isArray(embed.fields) && embed.fields.length) {
    const sections = embed.fields
      .filter((f) => f && (f.name || f.value))
      .map((f) => {
        const titre = String(f.name || '').trim().replace(/\s*:\s*$/, '');
        const valeur = String(f.value || '').trim();
        const lignes = [];
        if (titre) lignes.push(`◆ **${titre}**`);
        if (valeur) {
          // Une valeur déjà mise en forme (citation, liste, sections) garde
          // sa forme ; une valeur simple reçoit la flèche.
          const deja = /^\s*(>|➜|◆|\*|-|\d+\.)/.test(valeur) || valeur.includes('\n');
          lignes.push(deja ? valeur : `➜ ${valeur}`);
        }
        return lignes.join('\n');
      })
      .filter(Boolean);

    if (sections.length) {
      const base = typeof embed.description === 'string' && embed.description.trim() ? embed.description : '';
      const corps = [base, ...sections].filter(Boolean).join(`\n${r.filet}\n`);
      // Le filet éventuel s'ajoutera ensuite : on garde de la marge.
      if (corps.length + r.filet.length + 2 <= 4096) {
        embed.description = corps;
        delete embed.fields;
      }
    }
  }

  // ── Filet sous le titre ──────────────────────────────────────────
  // C'est LUI qui fait la différence entre un embed brut de Discord et une
  // carte soignée : une ligne fine qui sépare le titre du corps.
  // Discord n'a pas de « trait horizontal » : on le dessine avec des
  // caractères de filet. 28 signes correspondent à la largeur d'un embed sur
  // téléphone — au-delà, la ligne passerait à la ligne et ferait un pâté.
  if (r.ligne && embed.title && typeof embed.description === 'string' && embed.description) {
    // On reconnaît un filet déjà présent, quelle que soit sa longueur.
    if (!/^─{6,}\n/.test(embed.description)) {
      const candidat = `${r.filet}\n${embed.description}`;
      // On n'ajoute le filet que s'il reste de la place : mieux vaut pas de
      // ligne qu'une description tronquée par Discord.
      if (candidat.length <= 4096) embed.description = candidat;
    }
  }

  // ── Bannière de bas de carte ─────────────────────────────────────
  // L'image large qui termine les embeds (« SUPPORT — CARRÉ RP »). Posée
  // seulement si l'embed n'a pas déjà une image à lui.
  if (r.banniere && !embed.image?.url) {
    embed.image = { url: r.banniere };
  }

  if (r.horodatage && !embed.timestamp) embed.timestamp = new Date().toISOString();
  return embed;
}

// Utilisable des deux côtés : module Node, ou variable globale du navigateur.
// ⚠️ Bloc fermé, et non des déclarations racine : dans un navigateur, les
// trois moteurs partagent la même portée globale. Trois « const API » au
// premier niveau se seraient écrasés — et la page ne se chargeait plus.
{
  const API = {
    styliserUn, couleurNeutre, versEntier, filetDe,
    COULEURS_NEUTRES, DEFAUT_ACCENT, FILET, FILET_DEFAUT,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else if (typeof globalThis !== 'undefined') globalThis.Identite = API;
}
