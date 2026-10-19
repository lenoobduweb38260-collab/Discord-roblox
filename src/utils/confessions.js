// 💌 Confessions anonymes : détection, publication, relecture au QG.
//
// Une confession propre part tout de suite dans le salon du serveur, SANS
// auteur. Une confession qui parle de suicide, de menace ou d'insulte ne part
// pas : elle est envoyée au salon QG du staff du bot (le même que les tickets,
// réglé par /botstaff salon-qg), qui la publie, la refuse ou blackliste son
// auteur.
//
// Quatre règles :
//  • l'anonymat : on publie par `channel.send` — jamais par la réponse à la
//    commande, que Discord signerait « X a utilisé /confession » ;
//  • une confession signalée n'est JAMAIS publiée par défaut, même si le QG
//    est injoignable ;
//  • une seule décision par confession : le passage « en revue → publiée /
//    refusée / blacklist » est verrouillé en base AVANT d'agir, deux clics
//    simultanés n'en font qu'un ;
//  • une confession ne part que dans le salon de SON serveur, celui que le
//    réglage désigne au moment de la publication.

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { COLORS } = require('./embeds');
const M = require('./miseEnPage');
const { etiquetteMembre } = require('./journal');
const { mettreAJour, suivre } = require('./reponse');

const COULEUR = 0xc77dff; // le violet des confessions (une couleur choisie, conservée par l'identité)

// ── Détection ───────────────────────────────────────────────────────────
//
// Le texte est ramené à une forme simple avant comparaison. Chaque étape
// ferme un contournement déjà essayé :
//
//  • les caractères invisibles (espace de largeur nulle, trait d'union
//    conditionnel…) et les marqueurs Markdown (* _ ~ | `) sont SUPPRIMÉS,
//    jamais remplacés par une espace : Discord affiche « co**nn**ard » ou
//    « con||nard|| » en un seul mot, le filtre doit le lire pareil ;
//  • NFKD ramène la pleine chasse (ｃｏｎ), les lettres mathématiques (𝐜𝐨𝐧)
//    et les lettres cerclées (ⓒⓞⓝ) à l'ASCII, et détache les accents ;
//  • les homoglyphes cyrilliques et grecs (« сonnard » avec un с cyrillique)
//    sont translittérés ;
//  • les chiffres « leet » sont remis en lettres (s4l0p3 → salope) ;
//  • les lettres espacées sont recollées (c o n n a r d → connard) ;
//  • un astérisque SEUL entre deux lettres est un masque (p*te) : on essaie
//    chaque voyelle à sa place.
//
// Les lettres étirées donnent DEUX formes : séries ramenées à une lettre
// (connaaaard → connard) et à deux (connnnard → connard). Une seule ne
// suffit pas : réduit à une lettre, « connnnard » devient « conard ». Une
// confession est signalée dès qu'UNE forme correspond.
//
// Les motifs sont des EXPRESSIONS ENTIÈRES, pour ne pas signaler « tuer le
// temps », « mort de rire », « je vais mourir de honte » ni « je suis en
// retard ». L'apostrophe devenant une espace, les élisions (t' m' d' l' j')
// sont écrites dans les motifs : « je vais t'égorger » → « je vais t egorger ».
//
// Garde-fou : aucun motif n'imbrique deux répétitions (pas de retour arrière
// explosif) ; un test mesure 1000 caractères pathologiques.

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '€': 'e' };

// Lettres qui ressemblent aux latines sans en être : NFKD ne les ramène pas.
const HOMOGLYPHES = {
  // cyrillique
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i',
  'к': 'k', 'м': 'm', 'т': 't', 'в': 'b', 'н': 'h', 'ѕ': 's', 'ј': 'j',
  // grec
  'ο': 'o', 'α': 'a', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
  // latin sans décomposition
  'ł': 'l', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ß': 'ss',
};
const RE_HOMOGLYPHES = new RegExp(`[${Object.keys(HOMOGLYPHES).join('')}]`, 'g');

// Ce que Discord n'affiche pas, ou affiche sans couper le mot.
const effacerInvisibles = (t) => t.replace(/\p{Cf}/gu, '').replace(/[*_~|`\\]/g, '');

// Minuscules, sans accents ni homoglyphes — la ponctuation et les chiffres
// restent (le test de « kms » en a besoin).
function aplatir(texte) {
  return effacerInvisibles(texte)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(RE_HOMOGLYPHES, (c) => HOMOGLYPHES[c]);
}

function nettoyer(texte) {
  const t = aplatir(texte)
    .replace(/[013457@$€]/g, (c) => LEET[c])
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Lettres isolées à la suite (au moins trois) : un mot écrit espacé.
  return t.replace(/\b(?:[a-z] ){2,}[a-z]\b/g, (m) => m.replace(/ /g, ''));
}

const etirer = (t, garde) => t.replace(/([a-z])\1{2,}/g, garde);

// Toutes les formes à comparer, entourées d'espaces.
function formes(texte) {
  const brut = String(texte || '');
  const bases = [brut];
  if (/\p{L}\*\p{L}/u.test(brut)) {
    for (const v of 'aeiouy') bases.push(brut.replace(/(?<=\p{L})\*(?=\p{L})/gu, v));
  }
  const vues = new Set();
  for (const b of bases) {
    const n = nettoyer(b);
    vues.add(` ${etirer(n, '$1')} `);
    vues.add(` ${etirer(n, '$1$1')} `);
  }
  return [...vues];
}

// La forme principale (séries réduites à une lettre, sans masque).
const normaliser = (texte) => formes(texte)[0];

// ── Les motifs ──
//
// Chaque morceau est une expression régulière LITTÉRALE, assemblée par
// `motif()` : écrits en chaînes, ces morceaux (« tout le monde », « faire la
// peau »…) passeraient pour des phrases à traduire aux yeux du relevé des
// textes (scripts/extraire-textes.js).
const motif = (...morceaux) => new RegExp(morceaux.map((m) => (m instanceof RegExp ? m.source : m)).join(''));

// « mourir de honte », « crever de chaud », « mourir vieux » : des hyperboles.
const APRES_MOURIR = /(?! (?:de|d) (?:rire|honte|chaud|froid|faim|soif|fatigue|peur|ennui|stress|jalousie|envie|impatience|curiosite|bonheur|joie|plaisir|sommeil|trouille|gene|amour)\b| (?:vieux|vieille|heureux|heureuse|riche|centenaire)\b| dans (?:tes|ses|mes|vos) bras\b)/;
// « t'es mort de rire », « t'es mort ou quoi ? », « t'es mort ? réponds ».
const APRES_MORT = /(?! (?:de|d) (?:rire|honte|chaud|froid|faim|soif|fatigue|peur|ennui|stress|sommeil|trouille)\b| ou\b| reponds?\b| repondez\b| depuis\b)/;
// « en finir » seul ou « avec la vie / moi / tout » ; pas « avec mes exams »
// ni « avec tout ce stress ».
const EN_FINIR = /en finir\b(?! avec (?!(?:la vie|ma vie|cette vie|moi|mon existence|tout)\b(?! (?:ce|cet|cette|ces|les|mes|le|la|mon|ma)\b)))/;
const DISPARAITRE = /disparaitre\b(?! (?:sous terre|du serveur|de ce serveur|de discord|d internet|des reseaux|quelques|un moment|un peu|pendant|une semaine|un mois|de honte)\b)/;
// « je vais me tuer à la salle », « au travail » : rien d'inquiétant.
const APRES_ME_TUER = /(?! (?:a la (?:tache|salle|muscu|gym)|au (?:travail|boulot|taf|taff|sport)|a (?:travailler|bosser|reviser|courir)|de rire|a rire|pour (?:rien|toi|vous|ca|ce|cette|des|un|une))\b)/;
// « il va me tuer », « mes parents vont me tuer », « tu me fais du mal » :
// ce n'est pas l'auteur qui parle de se faire du mal.
const PAS_LUI = /(?<!\b(?:tu|va|vont|vas|allez|veut|veulent|voulez|voulait|voulaient|voudrait|peut|peuvent|vient|viennent|a voulu|ont voulu|essaye de|essaie de|essaient de|a essaye de|ont essaye de) )/;
const VOULOIR = /\b(?:j ?)?(?:veux|veu|veut|vx|vais|vai|voudrais|voudrai|aimerais|aimerai|merite de|merite d|meriterais de|pense a|pense souvent a|envie de|envie d|prefere|prefererais|besoin de|besoin d|devrais|ai hate de)/;

// Menaces : qui parle, à qui, avec quel verbe.
const SUJET = /(?:(?:je |j ?)(?:vais|vai|veux|veu|v|vas|viens|reviens)|on (?:va|vas|veut|vient)|nous (?:allons|voulons))(?: (?:aller|venir|bien|finir par))?/;
const VISE = /(?:(?:tous|toutes) )?(?:te|t|vous|le|la|l|lui|les|leur)(?: (?:tous|toutes))?/;
const VISE_TOI = /(?:(?:tous|toutes) )?(?:te|t|vous)(?: (?:tous|toutes))?/;
// Sans ambiguïté, quelle que soit la cible.
const TUER = /(?:tuer|buter|egorger|etrangler|poignarder|massacrer|assassiner|empoisonner|immoler|decapiter|violer|tabasser|lyncher|flinguer|fusiller|saigner|faire la peau|bruler vif|bruler vive)/;
// Ambigus (« je vais le planter dans le jardin ») : seulement contre « te / vous ».
const FRAPPER = /(?:defoncer|eclater|exploser|frapper|planter(?! la\b)|achever|abattre|ecraser|enterrer|crever|demonter|fumer|bousiller|cogner)/;
// « je vais te tuer à Fortnite » : un jeu, pas une menace.
const PAS_UN_JEU = /(?![a-z ]{0,40}\b(?:a|au|aux|en|sur|dans) (?:la |le |l |une |un |ce |cette )?(?:fortnite|mario|minecraft|valorant|lol|league|fifa|fc|echecs|echec|cartes|roblox|cod|call of|smash|apex|overwatch|rocket|among|uno|tetris|clash|brawl|warzone|cs|monopoly|belote|tarot|poker|tennis|foot|basket|ping|jeu|jeux|console|play|xbox|switch|ivi|duel|un contre un|street|tekken|gta|pokemon|zelda|bataille|scrabble|kart|karting|paintball|laser|bowling|billard|babyfoot|baby|petanque|course|debat|quiz|game|partie|match|tournoi|skribbl)\b)/;
// « je vais tuer le temps », « tuer ce boss », « violer le règlement ».
const CHOSE = /(?:le|la|les|l|ce|cet|cette|ces|un|une|des|mon|ma|mes|du) ?(?:temps|boss|jeu|niveau|game|partie|match|mob|mobs|monstre|monstres|zombie|zombies|dragon|moustique|moustiques|araignee|araignees|mouche|mouches|cafard|cafards|exam|examen|exams|controle|bac|son|morceau|chanson|scene|soiree|perso|personnage|ennui|silence|suspense|ambiance|piste|record|loi|lois|regle|regles|reglement|code|droit|droits|conditions|cgu|tos|secret|promesse|charte|accord|traite|frontiere|interdit|principe|consigne|couvre feu|vie privee|intimite)\b/;
const PAS_UNE_CHOSE = motif('(?!', CHOSE, ')');
// Après le verbe : ni une chose (« je vais le tuer ce boss »), ni pour rire
// (« je vais te tuer de rire »), ni un jeu.
const APRES_VERBE = motif('(?! ', CHOSE, ')', /(?! (?:de|d) (?:rire|bisous|calins|amour|chatouilles)\b)/, PAS_UN_JEU);

const MOTIFS = {
  suicide: [
    // vouloir mourir, en finir, disparaître
    motif(VOULOIR, ' (?:', /mourr?ir\b/, APRES_MOURIR, '|', /crever\b/, APRES_MOURIR, '|', EN_FINIR, '|', DISPARAITRE, ')'),
    // se tuer, se pendre, s'ouvrir les veines…
    motif(PAS_LUI, /\b(?:me|m) /, '(?:', /tuer/, APRES_ME_TUER,
      /|suicider|pendre|foutre en l air|scarifier|mutiler|automutiler|(?:tailler|ouvrir|couper|trancher) (?:les veines|les poignets)|immoler|empoisonner|defenestrer|laisser mourir|laisser crever|faire du mal|fais du mal|jeter (?:sous|du haut|par la fenetre|d un pont|du pont|dans le vide)/.source,
      ')\\b'),
    /\bsuicid(?:e|es|er|aire|aires|ee|ees|ais|ait|ant)\b(?! squad)/,
    /\b(?:plus envie de vivre|plus la force de vivre|marre de vivre|marre de la vie|(?:en )?peu[xt]? plus (?:de vivre|de la vie|de ma vie|de cette vie|d exister)|ve(?:ux|u|ut) plus (?:vivre|exister|etre en vie|etre la)|mettre fin a (?:ma vie|mes jours|mon existence)|en finir avec (?:la vie|ma vie|cette vie)|en finir avec tout\b(?! (?:ce|cet|cette|ces|les|mes|le|la)\b)|idees? noires?|pensees? suicidaires?|tentative de suicide|(?:fait|fais|faire|refait|refais|refaire) une ts|plus (?:de |aucune )?raison de vivre|la vie n a plus (?:de |aucun )?sens|ne (?:jamais|plus) me reveiller)\b/,
    // automutilation, sous toutes ses formes
    /\b(?:scarifi\w*|auto ?mutil\w*|(?:me|m) (?:suis |etais |suis deja )?(?:auto ?)?mutil\w*|(?:me|m) (?:suis )?(?:coupe|coupee|coupes|ouvert|ouverte|taillade|tailladee) (?:les|mes) (?:bras|poignets|veines|cuisses|avant bras|jambes))/,
    // passer à l'acte
    /\b(?:j ?)?(?:vais|veux|veu|voudrais|envie de|envie d|pense a)(?: me)? (?:sauter (?:du|d un|de la|par la|dans le) (?:pont|fenetre|toit|immeuble|balcon|falaise|vide)|jeter (?:sous|du haut|d un|par la|de la|du|dans le vide)|avaler (?:toutes |tous )?(?:mes|les|des|ces|une boite de|la boite de) (?:pilules|medocs|medicaments|cachets|comprimes|somniferes))\b/,
    /\b(?:kill myself|killing myself|kill my self|want to die|wanna die|wanna kill myself|end my life|ending my life|suicidal|self harm|selfharm|cut myself|cutting myself)\b/,
  ],
  menace: [
    motif(/\b/, SUJET, ' ', VISE, ' ', TUER, /\b/, APRES_VERBE),
    motif(/\b/, SUJET, ' ', VISE_TOI, ' ', FRAPPER, /\b/, APRES_VERBE),
    // « je te tue », « jte bute », « je t'égorge »
    motif(/\b(?:je |j ?)(?:te|t|vous) (?:tue|bute|egorge|etrangle|poignarde|massacre|tabasse|viole|creve|defonce|eclate|demonte|fume|bousille|explose|ecrase|enterre|saigne|flingue|decapite|assassine|empoisonne|immole|lynche)\b/, APRES_VERBE),
    // une cible nommée : « je vais tuer mon prof », « je vais buter Kevin »
    motif(/\b/, SUJET, / (?:tuer|buter|egorger|etrangler|poignarder|massacrer|assassiner|empoisonner|decapiter|violer|tabasser|lyncher|flinguer|fusiller|saigner) /, PAS_UNE_CHOSE, PAS_UN_JEU, /[a-z]/),
    // « je vais te casser la gueule » (mais pas « tu vas te casser la gueule »)
    motif(/\b/, '(?:', SUJET, ' |', /je |j ?/, ')', /(?:te|t|lui|vous|leur) (?:casser|casse|peter|pete|eclater|eclate|defoncer|defonce|exploser|explose|refaire|refais|niquer|nique|arracher|arrache|demonter|demonte) (?:la gueule|la tete|les dents|le crane|la figure|le portrait|la face|les genoux|les jambes|la machoire|le nez|les cotes)\b/),
    // « t'es mort », « tes mort », « t'es un homme mort »
    motif(/\b(?:(?:t es|tu es|vous etes|t etes)(?: (?:un|une) (?:homme|femme|gars|mec|meuf|fille))? (?:mort|morte|morts|mortes)|tes (?:(?:un|une) (?:homme|femme) )?(?:mort|morte))\b/, APRES_MORT),
    motif(/\b(?:tu vas|tu va|vous allez) (?:mourir|crever)\b/, APRES_MOURIR),
    /\bje sais (?:ou|ou est ce que) (?:tu|t|vous|il|elle|ils|elles) (?:habite|habites|habitez|habitent|vis|vit|vivez|vivent|dors|dort|dormez|creches|bosses|travailles|etudies)\b/,
    // attentats, menaces collectives ou scolaires
    /\b(?:poser une bombe|poser des bombes|faire tout sauter|faire tout peter|(?:faire|commettre|preparer|organiser) (?:un attentat|une fusillade|une tuerie|un massacre|un carnage))\b/,
    /\bfaire (?:sauter|exploser|peter) (?:le|la|l|mon|ma|ce|cette|tout le|toute la|notre) ?(?:lycee|college|ecole|fac|bahut|universite|bus|metro|gare|mosquee|eglise|synagogue|batiment|immeuble|bureau|classe|mairie|prefecture|commissariat|cantine|centre commercial)\b/,
    /\b(?:tuerie|fusillade|massacre|carnage|attentat) (?:au|a l|a la|dans (?:le|la|l|mon|ma|notre)) ?(?:lycee|college|ecole|fac|bahut|universite|cantine|classe)\b/,
    motif(/\btirer (?:sur|dans) (?:tout le monde|tous|toute la classe|la foule|les gens|des gens|les eleves|des eleves|les profs|mes profs|ma classe|la classe|le lycee|l ecole|le college|la cour|vous|eux)\b/, PAS_UN_JEU),
    motif(/\b(?:ramener|amener|apporter|ramene|amene|apporte) (?:une|un|le|la|l|mon|ma|son|sa) ?(?:arme|armes|fusil|flingue|pistolet|kalash|kalachnikov|kalashnikov|glock|revolver|calibre)\b/, PAS_UN_JEU),
    /\b(?:ramener|amener|apporter) (?:un|le|mon) couteau (?:au|a l|a la|en) ?(?:lycee|college|ecole|fac|cours|classe)\b/,
    /\b(?:bruler|cramer|incendier) (?:ta|ton|votre|sa|leur) (?:maison|baraque|voiture|caisse|appart|appartement|famille)\b|\bmettre le feu (?:a ta|a ton|a votre|a sa|chez toi|chez vous|au lycee|au college|a l ecole)\b/,
    // pousser au suicide
    /\b(?:va|vas|allez) (?:te|vous) (?:suicider|pendre|tuer|jeter sous)\b|\b(?:suicide|pends) toi\b/,
    /\b(?:i will|i ll|ill|gonna|going to|imma|i m gonna|im gonna) (?:kill|hurt|find|shoot|stab|murder|rape) (?:you|u|ya|y all|all of you|everyone)\b/,
    /\b(?:kill|kil) (?:yourself|urself|ur self|your self|yourselves)\b|\bkys\b/,
  ],
  insulte: [
    /\b(?:conn?ards?|connasses?|salopes?|salauds?|putes?|enfoire(?:e|s|es)?|encul(?:e|ee|es|ees|er|eur|eurs|euse)|(?<!pain )(?<!epee )batard(?:e|s|es)?)\b/,
    /\b(?:fils de putes?|filsdeputes?|fdp(?! (?:sont |est )?(?:offerts?|gratuits?|inclus|compris)\b)|tgfdp|ntm(?! en concert)|ta mere la (?:pute|chienne|salope)|je te nique|va te faire (?:foutre|enculer|niquer)|ferme ta gueule|ftg|trou du cul|trouduc|sac a merde|niquetamere|niktamere|niquetarace|niktarace)\b/,
    /\bni(?:que|ques|quer|k|ke|ks|q|kk) (?:ta|tes|ton|sa|votre|vos) (?:mere|race|reum|soeur|morts|pere|daronne|darone|grand mere|famille|ancetres)\b/,
    /\b(?:abrutie?s?|debiles?|gogols?|sous merde|grosse merde|pauvre merde|tocarde?s?|(?:espece d|espece de|sale|gros|grosse|t es un|t es une|tes un|tes une|tu es un|tu es une|pauvre|bande d|quel|quelle|vieil|vieille|petit|petite) attardee?s?)\b/,
    /\b(?:pd(?! g\b)|pedes?|tapettes?(?! a (?:mouches?|souris|rats?)\b)|tarlouzes?|gouines?|fiottes?|tafioles?|lopettes?|negros?|negres?|negresses?|bougnoules?|bougnouls?|bamboulas?|youpins?|youpines?|bicots?|chinetoques?)\b/,
    /\bsale (?:noire?s?|arabes?|juif|juive|juifs|juives|blanc|blanche|blancs|chinois|chinoise|pd|pede|gros|grosse|pute|race|gitan|gitane|gitans|rebeu|rebeue|rebeus|renoi|renoie|renois|feuj|feujs|musulman|musulmane|musulmans|gay|gays|homo|homos|lesbienne|lesbiennes|travelo|travelos|trans|singe|singes|chienne|chiennes|chien|negre|negresse|bougnoule|bicot|youpin|beur|beurette|catin|trainee|merde|con|conne|cons|connes|tarlouze|tapette|gouine|fiotte|tafiole|mongol|mongole|autiste|handicape|handicapee)\b/,
    // « con » seul n'est PAS une insulte à relire (« mon pote est trop con
    // parfois ») ; qualifié, si.
    /\b(?:pauvre|sale|grosse|gros|espece de|vieille|vieux|bande de) con(?:ne)?s?\b/,
    /\b(?:cunts?|bitch|bitches|fuck you|fuck u|fuck off|motherfuckers?|faggots?|niggers?|niggas?|whores?|sluts?|retarded|you re a retard|youre a retard|ur a retard|u r a retard)\b/,
  ],
};

// Testés sur le texte avant la conversion « leet » : « j'ai couru 5 kms »
// deviendrait « couru s kms » et passerait pour « kill myself ».
const MOTIFS_BRUTS = {
  suicide: [/(?<!\d\s?)\bkms\b/],
};

const LIBELLES = { suicide: '🫶 Détresse (suicide)', menace: '⚠️ Menace', insulte: '🤬 Insulte' };

// { categories: ['suicide'|'menace'|'insulte'], extraits: ['…'] }
function detecter(texte) {
  const vues = formes(texte);
  const brut = ` ${aplatir(String(texte || ''))} `;
  const categories = [];
  const extraits = [];
  const relever = (categorie, m) => {
    if (!categories.includes(categorie)) categories.push(categorie);
    const e = m[0].trim();
    if (extraits.length < 6 && !extraits.includes(e)) extraits.push(e);
  };
  for (const [categorie, motifs] of Object.entries(MOTIFS)) {
    for (const re of motifs) {
      for (const t of vues) {
        const m = t.match(re);
        if (m) { relever(categorie, m); break; }
      }
    }
    for (const re of MOTIFS_BRUTS[categorie] || []) {
      const m = brut.match(re);
      if (m) relever(categorie, m);
    }
  }
  return { categories, extraits };
}

// ── Base ────────────────────────────────────────────────────────────────

const inserer = db.prepare(`INSERT INTO confessions
  (guild_id, guild_name, channel_id, author_id, author_tag, texte, categories, statut, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const lire = db.prepare('SELECT * FROM confessions WHERE id = ?');
// Le numéro est RÉSERVÉ avant l'envoi, en une seule instruction : deux
// publications simultanées ne lisent plus le même MAX. Un numéro déjà réservé
// est gardé. Si l'envoi échoue, il est libéré.
const reserverNumero = db.prepare(`UPDATE confessions
  SET numero = COALESCE(numero, (SELECT COALESCE(MAX(numero), 0) + 1 FROM confessions WHERE guild_id = ?))
  WHERE id = ?`);
const lireNumero = db.prepare('SELECT numero FROM confessions WHERE id = ?');
const libererNumero = db.prepare('UPDATE confessions SET numero = NULL WHERE id = ?');
const marquerPubliee = db.prepare('UPDATE confessions SET statut = ?, channel_id = ?, message_id = ? WHERE id = ?');
const verrouiller = db.prepare(
  "UPDATE confessions SET statut = ?, decide_par = ?, decide_le = ? WHERE id = ? AND statut = 'en_revue'"
);
const relacher = db.prepare(
  "UPDATE confessions SET statut = 'en_revue', decide_par = NULL, decide_le = NULL WHERE id = ? AND statut = 'publiee'"
);
// La blacklist prend son verrou AVANT d'agir (elle est lente : MP, puis un
// ban par serveur) : un « Publier » cliqué entre-temps voit « déjà traitée ».
const verrouillerBan = db.prepare(
  "UPDATE confessions SET statut = 'blacklist', decide_par = ?, decide_le = ? WHERE id = ? AND statut IN ('en_revue', 'refusee')"
);
const rendreBan = db.prepare(
  "UPDATE confessions SET statut = ?, decide_par = ?, decide_le = ? WHERE id = ? AND statut = 'blacklist'"
);
const noterQg = db.prepare('UPDATE confessions SET qg_channel_id = ?, qg_message_id = ? WHERE id = ?');
const effacer = db.prepare('DELETE FROM confessions WHERE id = ?');
// Une confession propre dont la publication a échoué ne reste pas en base.
const oublier = (id) => effacer.run(id);

function enregistrer({ guild, salonId, auteur, texte, categories, statut }) {
  const r = inserer.run(
    guild.id, guild.name || null, salonId, auteur.id, auteur.tag || auteur.username || null,
    texte, categories.join(',') || null, statut, new Date().toISOString()
  );
  return lire.get(r.lastInsertRowid);
}

// ── Réglages ────────────────────────────────────────────────────────────

// Le salon des confessions de ce serveur, ou null si elles sont fermées.
function salonConfessions(guildId) {
  const cfg = getGuildConfig(guildId);
  if (!cfg.confession_enabled) return null;
  return cfg.confession_channel_id || null;
}

// ── Publication ─────────────────────────────────────────────────────────

function carteConfession(numero, texte) {
  return new EmbedBuilder()
    .setColor(COULEUR)
    .setTitle(`💌 Confession n°${numero}`)
    .setDescription(M.citation(texte, 4000));
}

// Le salon, s'il appartient BIEN à ce serveur. Un réglage peut pointer
// n'importe où (le tableau de bord enregistre un identifiant) : sans ce
// contrôle, un admin du serveur A ferait écrire le bot, anonymement, dans le
// salon d'un serveur B.
async function salonDuServeur(client, guildId, salonId) {
  if (!guildId || !salonId) return null;
  const guilde = client.guilds?.cache?.get?.(guildId);
  const salon = await Promise.resolve()
    .then(() => (guilde?.channels?.fetch ? guilde.channels.fetch(salonId) : client.channels.fetch(salonId)))
    .catch(() => null);
  if (!salon?.isTextBased?.()) return null;
  return (salon.guildId ?? salon.guild?.id) === guildId ? salon : null;
}

// Publie dans le salon des confessions du serveur (par défaut celui de
// l'envoi). Rend { ok: true, numero, url } ou { ok: false, raison } — jamais
// d'exception.
async function publier(client, confession, salonId = confession.channel_id) {
  const salon = await salonDuServeur(client, confession.guild_id, salonId);
  if (!salon) return { ok: false, raison: 'salon' };
  reserverNumero.run(confession.guild_id, confession.id);
  const numero = lireNumero.get(confession.id)?.numero;
  const message = await Promise.resolve()
    .then(() => salon.send({ embeds: [carteConfession(numero, confession.texte)], allowedMentions: { parse: [] } }))
    .catch(() => null);
  if (!message) {
    libererNumero.run(confession.id);
    return { ok: false, raison: 'envoi' };
  }
  marquerPubliee.run('publiee', salon.id, message.id, confession.id);
  return { ok: true, numero, url: message.url };
}

// ── Relecture au QG ─────────────────────────────────────────────────────

const STATUTS = {
  en_revue: '⏳ En attente de relecture',
  publiee: '✅ Publiée',
  refusee: '🗑️ Refusée',
  blacklist: '🚫 Refusée — auteur blacklisté',
};

function carteQg(confession, auteur = null) {
  const categories = String(confession.categories || '').split(',').filter(Boolean);
  const { extraits } = detecter(confession.texte);
  const qui = auteur ? etiquetteMembre(auteur) : `(\`${confession.author_id}\`) <@${confession.author_id}>`;
  const statut = STATUTS[confession.statut] || confession.statut;
  const par = confession.decide_par ? ` par <@${confession.decide_par}>` : '';
  const embed = new EmbedBuilder()
    .setColor(confession.statut === 'publiee' ? COLORS.SUCCESS : categories.includes('suicide') ? COLORS.WARNING : COLORS.DANGER)
    .setTitle('💌 Confession à relire')
    .setDescription(M.description([
      `**${confession.guild_name || 'Serveur'}** (\`${confession.guild_id}\`) · salon \`${confession.channel_id}\``,
      M.bloc('Détecté', [categories.map((c) => LIBELLES[c] || c).join(' · ') || '—', ...extraits.map((e) => `« ${e} »`)], { compte: null }),
      M.bloc('Auteur — confidentiel, jamais montré sur le serveur', [qui], { compte: null }),
      `📌 **${statut}**${par}`,
    ]))
    .addFields({ name: '💬 Confession', value: M.citation(confession.texte) });
  if (categories.includes('suicide')) {
    embed.addFields({
      name: '🫶 Une personne peut-être en détresse',
      value: 'Le bouton « Lui envoyer de l\'aide » lui écrit en privé avec le 3114 (France, gratuit, 24 h/24). Une réponse humaine compte aussi.',
    });
  }
  return embed;
}

function boutonsQg(confession) {
  if (confession.statut !== 'en_revue') return [];
  const categories = String(confession.categories || '').split(',');
  const rangee = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfs:pub:${confession.id}`).setLabel('Publier').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`cfs:del:${confession.id}`).setLabel('Refuser').setEmoji('🗑️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cfs:ban:${confession.id}`).setLabel('Blacklister l\'auteur').setEmoji('🚫').setStyle(ButtonStyle.Danger)
  );
  if (categories.includes('suicide')) {
    rangee.addComponents(
      new ButtonBuilder().setCustomId(`cfs:aide:${confession.id}`).setLabel('Lui envoyer de l\'aide').setEmoji('🫶').setStyle(ButtonStyle.Primary)
    );
  }
  return [rangee];
}

// Envoie la carte au salon QG. Rend true si elle est partie.
async function signaler(client, confession, auteur) {
  const { hq } = require('./botTickets');
  const qg = hq();
  if (!qg?.channelId) return false;
  const salon = await client.channels.fetch(qg.channelId).catch(() => null);
  if (!salon?.isTextBased?.()) return false;
  const message = await salon
    .send({ embeds: [carteQg(confession, auteur)], components: boutonsQg(confession), allowedMentions: { parse: [] } })
    .catch(() => null);
  if (!message) return false;
  noterQg.run(salon.id, message.id, confession.id);
  return true;
}

// Réédite la carte du QG hors interaction (après une confirmation éphémère).
async function rafraichirQg(client, confession) {
  if (!confession.qg_channel_id || !confession.qg_message_id) return;
  const { enComposants, estCarte } = require('./reponse');
  const salon = await client.channels.fetch(confession.qg_channel_id).catch(() => null);
  const message = await salon?.messages?.fetch?.(confession.qg_message_id).catch(() => null);
  if (!message) return;
  const auteur = await client.users.fetch(confession.author_id).catch(() => null);
  const contenu = { embeds: [carteQg(confession, auteur)], components: boutonsQg(confession) };
  if (estCarte(message)) {
    const composants = enComposants(salon.guild, client, contenu);
    if (composants) await message.edit({ components: composants }).catch(() => null);
  } else {
    await message.edit(contenu).catch(() => null);
  }
}

// Raison du ban de blacklist, lue par les modérateurs de TOUS les serveurs :
// neutre, pour ne rien révéler de la confession ni de son auteur.
const RAISON_BAN = 'Décision du staff du bot';

// Le message d'aide envoyé à une personne en détresse.
const AIDE = [
  '🫶 **Tu n\'es pas seul·e.**',
  'Ta confession a été lue par une vraie personne de l\'équipe du bot, et elle compte.',
  '',
  'Si ça va mal, parler aide vraiment :',
  '➜ 📞 **3114** — numéro national de prévention du suicide (France), gratuit, 24 h/24 et 7 j/7',
  '➜ 🚑 **15** ou **112** en cas de danger immédiat',
  '➜ 🌍 Ailleurs : https://findahelpline.com',
  '',
  'Tu peux aussi en parler à quelqu\'un en qui tu as confiance. Prends soin de toi.',
].join('\n');

// ── Boutons du QG (cfs:<action>:<id>) ───────────────────────────────────

async function handleButton(interaction) {
  const { hasPerm, applyBlacklist } = require('./botTeam');
  const [, action, idBrut] = interaction.customId.split(':');
  const confession = lire.get(Number(idBrut));
  const prive = (content) => suivre(interaction, { content, flags: MessageFlags.Ephemeral });
  if (!confession) return prive('📭 Cette confession n\'existe plus en base : rien à faire.');

  const perm = action === 'ban' || action === 'banok' ? 'blacklist' : 'tickets';
  if (!(await hasPerm(interaction.client, interaction.user.id, perm))) {
    return prive(`⛔ Réservé au staff du bot qui a la permission **${perm === 'blacklist' ? 'Blacklist' : 'Tickets du QG'}**.`);
  }

  const auteur = await interaction.client.users.fetch(confession.author_id).catch(() => null);

  if (action === 'aide') {
    const parti = auteur ? await auteur.send({ content: AIDE }).then(() => true).catch(() => false) : false;
    return prive(parti
      ? '🫶 Message d\'aide envoyé en privé à l\'auteur.'
      : '📪 Impossible de lui écrire : ses messages privés sont fermés. Le message d\'aide lui a déjà été montré à l\'envoi de sa confession.');
  }

  if (confession.statut !== 'en_revue' && action !== 'banok') {
    return prive(`ℹ️ Déjà traitée : ${STATUTS[confession.statut] || confession.statut}.`);
  }

  if (action === 'ban') {
    return interaction.reply({
      content: `🚫 Blacklister l'auteur de la confession n°${confession.id} ? Il sera banni de **tous** les serveurs du bot, et la confession sera refusée.`,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cfs:banok:${confession.id}`).setLabel('Confirmer la blacklist').setEmoji('🚫').setStyle(ButtonStyle.Danger)
      )],
      flags: MessageFlags.Ephemeral,
    });
  }

  const maintenant = new Date().toISOString();

  if (action === 'banok') {
    // Verrou d'abord, blacklist ensuite : applyBlacklist prend plusieurs
    // secondes (MP, puis un ban par serveur), et un « Publier » cliqué pendant
    // ce temps publiait une confession que la carte disait refusée.
    const avant = lire.get(confession.id);
    if (verrouillerBan.run(interaction.user.id, maintenant, confession.id).changes !== 1) {
      const actuel = avant?.statut || confession.statut;
      return mettreAJour(interaction, { content: `ℹ️ Déjà traitée : ${STATUTS[actuel] || actuel}.`, components: [] });
    }
    const rendre = () => rendreBan.run(avant.statut, avant.decide_par ?? null, avant.decide_le ?? null, confession.id);
    // La raison part sur CHAQUE serveur (liste des bannis, journal d'audit,
    // re-ban à l'arrivée) : elle ne dit rien de la confession, qui reste
    // anonyme. La référence vit dans l'historique interne du staff (preuve).
    const preuve = `Confession #${confession.id} — ${confession.guild_name || 'serveur'} (${confession.guild_id}) : `
      + `« ${String(confession.texte || '').slice(0, 800)} »`;
    const r = await Promise.resolve()
      .then(() => applyBlacklist(interaction.client, confession.author_id, RAISON_BAN, interaction.user.id, preuve))
      .catch((err) => ({ erreur: err?.message || String(err) }));
    if (r?.immune) {
      rendre();
      return mettreAJour(interaction, { content: '🛡️ Cet auteur est immunisé (créateur ou liste d\'immunité) : blacklist impossible. Refusez la confession à la place.', components: [] });
    }
    if (r?.erreur) {
      rendre();
      return mettreAJour(interaction, { content: `❌ La blacklist a échoué : ${r.erreur}. Réessayez, ou refusez la confession.`, components: [] });
    }
    await rafraichirQg(interaction.client, lire.get(confession.id));
    return mettreAJour(interaction, { content: `🚫 Auteur blacklisté (banni sur ${r?.banned ?? 0} serveur(s)), confession refusée.`, components: [] });
  }

  if (action === 'del') {
    if (verrouiller.run('refusee', interaction.user.id, maintenant, confession.id).changes !== 1) {
      return prive('ℹ️ Un autre membre du staff vient de la traiter.');
    }
    const maj = lire.get(confession.id);
    await mettreAJour(interaction, { embeds: [carteQg(maj, auteur)], components: [] });
    await auteur?.send({
      content: `💌 Ta confession sur **${maj.guild_name || 'le serveur'}** n'a pas été publiée : elle ne respecte pas les règles. Tu peux en écrire une autre.`,
    }).catch(() => null);
    return;
  }

  if (action === 'pub') {
    // Le serveur a pu fermer ses confessions (souvent : à cause d'abus, donc
    // pendant que des confessions attendent) ou changer de salon depuis
    // l'envoi. Son réglage du moment fait foi.
    const salonId = salonConfessions(confession.guild_id);
    if (!salonId) {
      return prive('🔒 Ce serveur a fermé ses confessions depuis l\'envoi : publication impossible. Refusez-la pour clore la carte.');
    }
    if (verrouiller.run('publiee', interaction.user.id, maintenant, confession.id).changes !== 1) {
      return prive('ℹ️ Un autre membre du staff vient de la traiter.');
    }
    const r = await publier(interaction.client, lire.get(confession.id), salonId);
    if (!r.ok) {
      relacher.run(confession.id);
      return prive(r.raison === 'salon'
        ? '📭 Le salon des confessions de ce serveur n\'existe plus, ou le bot n\'y a plus accès : publication impossible.'
        : '❌ Le bot n\'arrive pas à écrire dans le salon des confessions (permissions ?). La confession reste en attente.');
    }
    const maj = lire.get(confession.id);
    await mettreAJour(interaction, { embeds: [carteQg(maj, auteur)], components: [] });
    await auteur?.send({ content: `💌 Ta confession sur **${maj.guild_name || 'le serveur'}** a été relue et publiée (n°${r.numero}).` }).catch(() => null);
    return;
  }

  return prive('❓ Action inconnue sur cette confession : la carte vient sans doute d\'une ancienne version.');
}

module.exports = {
  normaliser, detecter, MOTIFS, LIBELLES, AIDE, RAISON_BAN,
  salonConfessions, enregistrer, publier, signaler, carteConfession, carteQg, boutonsQg, handleButton, lire, oublier,
};
