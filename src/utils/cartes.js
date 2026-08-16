// 🃏 Cartes sans bordure — la direction artistique, sans le châssis de Discord.
//
// Un embed Discord traîne toujours la même chose avec lui : une barre verticale
// colorée collée à son bord gauche. Elle ne se règle pas, elle ne se retire
// pas — c'est le composant lui-même. Tant qu'on envoie un embed, elle est là.
//
// La solution n'est donc pas de mieux régler l'embed : c'est de ne plus en
// envoyer. Discord propose depuis 2025 une autre famille de composants
// (« Components V2 ») qui compose un message à partir de briques :
//
//   Conteneur (17) ──┬── Texte (10)          du markdown, titres compris
//                    ├── Séparateur (14)     un VRAI trait horizontal
//                    ├── Section (9)         du texte + une vignette à droite
//                    ├── Galerie (12)        une ou plusieurs images
//                    └── Rangée (1)          les boutons habituels
//
// Deux gains directs :
//  • le conteneur n'a de barre colorée que si on lui en demande une — par
//    défaut, aucune ;
//  • le séparateur est un vrai filet tracé par Discord, à la largeur exacte
//    de la carte. Il remplace nos « ───── », qui dépendaient de la taille de
//    police du lecteur et repassaient à la ligne sur téléphone.
//
// ⚠️ On écrit ici du JSON brut plutôt que d'utiliser les constructeurs de
// discord.js : la conversion se fait sur la couche réseau, où le corps de la
// requête est déjà sérialisé. Cela évite aussi de dépendre de la version de
// la bibliothèque installée chez l'hébergeur — seule l'API compte.

// Types de composants (valeurs de l'API Discord).
const T = {
  RANGEE: 1,
  SECTION: 9,
  TEXTE: 10,
  VIGNETTE: 11,
  GALERIE: 12,
  SEPARATEUR: 14,
  CONTENEUR: 17,
};

// Drapeau de message « ce message utilise les composants V2 ».
// Il interdit `content` et `embeds` : tout passe par `components`.
const DRAPEAU_V2 = 1 << 15; // 32768

// Limites propres aux composants V2.
const MAX_TEXTE_TOTAL = 4000; // tous les blocs de texte cumulés
const MAX_COMPOSANTS = 40; // conteneurs et enfants compris

const texte = (contenu) => ({ type: T.TEXTE, content: String(contenu) });
const separateur = (grand = false) => ({ type: T.SEPARATEUR, divider: true, spacing: grand ? 2 : 1 });

// Une ligne faite uniquement de « ─ » était notre filet de fortune. Elle a
// désormais un vrai équivalent : on la reconnaît pour la remplacer.
const estFilet = (ligne) => /^\s*─{3,}\s*$/.test(ligne);

// Découpe un texte en blocs, en transformant chaque filet de fortune en vrai
// séparateur. C'est ce qui fait qu'un embed déjà mis en forme par miseEnPage
// se convertit sans rien perdre ni rien doubler.
function enBlocs(contenu) {
  const sortie = [];
  let tampon = [];
  const vider = () => {
    const t = tampon.join('\n').trim();
    tampon = [];
    if (t) sortie.push(texte(t));
  };
  for (const ligne of String(contenu || '').split('\n')) {
    if (estFilet(ligne)) {
      vider();
      // Deux filets de suite ne donnent qu'un séparateur.
      if (sortie.length && sortie[sortie.length - 1].type !== T.SEPARATEUR) sortie.push(separateur());
    } else {
      tampon.push(ligne);
    }
  }
  vider();
  // Un séparateur en tête ou en queue n'a rien à séparer.
  while (sortie.length && sortie[0].type === T.SEPARATEUR) sortie.shift();
  while (sortie.length && sortie[sortie.length - 1].type === T.SEPARATEUR) sortie.pop();
  return sortie;
}

// Un horodatage lisible par chacun dans son fuseau : Discord le rend
// lui-même à partir de l'heure Unix.
function dateDiscord(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `<t:${Math.floor(d.getTime() / 1000)}:f>`;
}

// Échappe ce qui casserait la mise en forme d'une ligne de sous-texte.
const uneLigne = (s) => String(s).replace(/\s*\n\s*/g, ' · ').trim();

// 🎴 Convertit un embed (JSON Discord) en carte.
//
// `bordure` :
//   • 'aucune' → pas de barre colorée. C'est le défaut : c'est précisément
//     ce qu'on cherchait à supprimer.
//   • 'accent' → la barre est conservée, à la couleur de l'embed.
//
// Renvoie null si l'embed ne se prête pas à la conversion : l'appelant garde
// alors l'embed d'origine plutôt que d'envoyer quelque chose d'incomplet.
function enCarte(embed, { bordure = 'aucune', titre: niveauTitre = 'grand', serveur = null } = {}) {
  if (!embed || typeof embed !== 'object') return null;
  const dedans = [];

  // ── Tête de carte ──
  //
  // Le titre ouvre la carte, en grand. `#` plutôt que `##` : c'est ce qui
  // donne l'en-tête large et lisible d'un vrai panneau, au lieu d'un titre
  // d'embed noyé dans le texte.
  const diese = niveauTitre === 'moyen' ? '##' : '#';
  const tete = [];

  // La ligne d'auteur ne se justifie QUE si elle dit autre chose que la
  // signature. Par défaut, l'identité écrit « CARRE RP (18+) » en haut et
  // « Carre RP • CARRE RP (18+) » en bas : la même information deux fois,
  // qui écrase le titre et alourdit la carte. Une ligne porteuse de sens
  // (« Avis de @membre ») est en revanche conservée.
  const auteur = uneLigne(embed.author?.name || '');
  const signature = uneLigne(embed.footer?.text || '');
  // Écartée dans deux cas : quand la signature la répète déjà, et quand elle
  // n'est QUE le nom du serveur — c'est alors de l'identité, pas du sens, et
  // elle écrase le titre pour ne rien dire de neuf.
  const identiteSeule = serveur && auteur === uneLigne(serveur);
  const repetee = signature && signature.includes(auteur);
  if (auteur && !repetee && !identiteSeule) tete.push(`-# ${auteur}`);

  if (embed.title) {
    const titre = uneLigne(embed.title);
    tete.push(embed.url ? `${diese} [${titre}](${embed.url})` : `${diese} ${titre}`);
  }

  // Une vignette devient l'accessoire de la section de tête : l'image se pose
  // à droite du titre, exactement comme le faisait `thumbnail`.
  if (tete.length) {
    if (embed.thumbnail?.url) {
      dedans.push({
        type: T.SECTION,
        components: [texte(tete.join('\n'))],
        accessory: { type: T.VIGNETTE, media: { url: embed.thumbnail.url } },
      });
    } else {
      dedans.push(texte(tete.join('\n')));
    }
  }

  // ── Corps ──
  const corps = enBlocs(embed.description);
  if (tete.length && corps.length) dedans.push(separateur());
  dedans.push(...corps);

  // ── Champs restés sous forme de grille ──
  // La fusion les a normalement déjà repliés dans la description ; ceux qui
  // subsistent (embed trop long) deviennent des sections à leur tour, pour
  // qu'aucune information ne se perde en route.
  if (Array.isArray(embed.fields) && embed.fields.length) {
    for (const champ of embed.fields) {
      if (!champ || (!champ.name && !champ.value)) continue;
      if (dedans.length) dedans.push(separateur());
      const morceaux = [];
      if (champ.name) morceaux.push(`◆ **${uneLigne(champ.name).replace(/\s*:\s*$/, '')}**`);
      if (champ.value) morceaux.push(String(champ.value).trim());
      dedans.push(texte(morceaux.join('\n')));
    }
  }

  // ── Image large de bas de carte ──
  if (embed.image?.url) {
    dedans.push({ type: T.GALERIE, items: [{ media: { url: embed.image.url } }] });
  }

  // ── Signature ──
  const pied = [];
  if (embed.footer?.text) pied.push(uneLigne(embed.footer.text));
  const quand = embed.timestamp ? dateDiscord(embed.timestamp) : null;
  if (quand) pied.push(quand);
  if (pied.length) {
    if (dedans.length) dedans.push(separateur());
    dedans.push(texte(`-# ${pied.join(' • ')}`));
  }

  if (!dedans.length) return null;

  const carte = { type: T.CONTENEUR, components: dedans };
  // La barre colorée n'existe que si on la demande explicitement.
  if (bordure === 'accent' && typeof embed.color === 'number') carte.accent_color = embed.color;
  return carte;
}

// Compte les composants d'un arbre, enfants inclus : la limite de 40 porte
// sur le total, pas sur le premier niveau.
function compter(composants) {
  let n = 0;
  for (const c of composants || []) {
    n += 1;
    if (Array.isArray(c.components)) n += compter(c.components);
    if (c.accessory) n += 1;
  }
  return n;
}

// Longueur cumulée de tous les blocs de texte.
function longueurTexte(composants) {
  let n = 0;
  for (const c of composants || []) {
    if (c.type === T.TEXTE) n += String(c.content || '').length;
    if (Array.isArray(c.components)) n += longueurTexte(c.components);
  }
  return n;
}

// 📨 Convertit le corps d'un envoi de message.
//
// Renvoie le nouveau corps, ou null si la conversion ne s'applique pas ou ne
// tiendrait pas dans les limites — auquel cas l'appelant envoie le message
// d'origine, inchangé.
function convertirCorps(corps, options = {}) {
  if (!corps || typeof corps !== 'object') return null;
  if (!Array.isArray(corps.embeds) || !corps.embeds.length) return null;
  // Un message déjà en composants V2 n'a rien à convertir.
  if (Number(corps.flags || 0) & DRAPEAU_V2) return null;

  const cartes = [];
  // Le texte du message (« @everyone », une phrase d'accroche) n'a plus de
  // champ dédié en V2 : il devient un bloc de texte, en tête.
  const contenu = String(corps.content ?? '').trim();
  if (contenu) cartes.push(texte(contenu));

  for (const embed of corps.embeds) {
    const carte = enCarte(embed, options);
    if (!carte) return null; // un embed non convertible → on ne convertit rien
    cartes.push(carte);
  }

  // Les boutons et menus déjà présents restent au même endroit, après.
  const existants = Array.isArray(corps.components) ? corps.components : [];
  const tous = [...cartes, ...existants];

  if (compter(tous) > MAX_COMPOSANTS) return null;
  if (longueurTexte(tous) > MAX_TEXTE_TOTAL) return null;

  const sortie = { ...corps, components: tous, flags: Number(corps.flags || 0) | DRAPEAU_V2 };
  // `content` et `embeds` sont refusés par l'API quand le drapeau est posé.
  delete sortie.content;
  delete sortie.embeds;
  return sortie;
}

// Utilisable des deux côtés : module Node, ou variable globale du navigateur.
// Le tableau de bord charge CE fichier, pas une copie retapée : c'est ce qui
// garantit que son aperçu montre exactement la carte que Discord recevra.
// ⚠️ Bloc fermé, et non des déclarations racine : dans un navigateur, les
// trois moteurs partagent la même portée globale. Trois « const API » au
// premier niveau se seraient écrasés — et la page ne se chargeait plus.
{
  const API = {
    T, DRAPEAU_V2, MAX_TEXTE_TOTAL, MAX_COMPOSANTS,
    enBlocs, enCarte, convertirCorps, compter, longueurTexte, estFilet, dateDiscord,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else if (typeof globalThis !== 'undefined') globalThis.Cartes = API;
}
