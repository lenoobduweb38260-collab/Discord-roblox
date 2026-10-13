const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  InteractionContextType,
  ApplicationIntegrationType,
} = require('discord.js');
const { db } = require('../database');
const { GRADES } = require('../utils/permissions');
const { repondreVite, mettreAJour, suivre } = require('../utils/reponse');

// Interactions façon Nekotina : GIF anime, compteur par duo, boutons
// « Rendre » / « Rejeter », badges par paliers envoyés en MP, et textes
// TRADUITS AUTOMATIQUEMENT selon la langue Discord de chaque utilisateur.

// ----- Traductions (fr / en / es / de / ru, repli anglais) -----
//
// ⚠️ Ce fichier porte ses PROPRES traductions, et il suit la langue Discord
// de chaque membre — pas la langue du serveur. Deux personnes lisent donc le
// même message dans deux langues. Le dictionnaire commun
// (`src/utils/traductions.json`) ne le concerne pas : le relevé l'écarte,
// sans quoi on ferait retraduire des phrases déjà traduites ici.
const LOCALES = {
  fr: {
    actions: {
      kiss: { name: 'Bisous', phrase: (a, b) => `💋 **${a}** fait un bisou à **${b}** !`, count: (n) => `💞 Ils se sont embrassés **${n}** fois.`, back: '💋 Rendre le bisou' },
      peck: { name: 'Bisous', phrase: (a, b) => `😚 **${a}** fait un bisou sur la joue à **${b}** !`, count: (n) => `💞 Ils se sont embrassés **${n}** fois.`, back: '😚 Rendre le bisou' },
      hug: { name: 'Câlins', phrase: (a, b) => `🤗 **${a}** fait un câlin à **${b}** !`, count: (n) => `🫂 Ils se sont fait **${n}** câlins.`, back: '🤗 Rendre le câlin' },
      pat: { name: 'Caresses', phrase: (a, b) => `🖐️ **${a}** caresse doucement la tête de **${b}**.`, count: (n) => `✨ **${n}** caresses échangées.`, back: '🖐️ Caresser aussi' },
      bite: { name: 'Morsures', phrase: (a, b) => `😬 **${a}** mordille **${b}** !`, count: (n) => `🦷 **${n}** morsures échangées.`, back: '😬 Mordre aussi' },
      lick: { name: 'Léchouilles', phrase: (a, b) => `👅 **${a}** lèche **${b}**… coquin !`, count: (n) => `👅 **${n}** léchouilles échangées.`, back: '👅 Rendre la léchouille' },
      bang: { name: 'Tirs', phrase: (a, b) => `🔫 **${a}** tire sur **${b}** ! Pan !`, count: (n) => `🔫 **${n}** coups de feu échangés.`, back: '🔫 Riposter' },
      punch: { name: 'Coups de poing', phrase: (a, b) => `👊 **${a}** met un coup de poing à **${b}** !`, count: (n) => `👊 **${n}** coups de poing échangés.`, back: '👊 Rendre le coup' },
      kill: { name: 'Éliminations', phrase: (a, b) => `💀 **${a}** élimine **${b}**… sans pitié !`, count: (n) => `💀 **${n}** éliminations entre eux.`, back: '💀 Se venger' },
    },
    reject: 'Rejeter',
    rejected: (a, b) => `💔 ${a} a rejeté l'interaction de ${b}… aïe.`,
    onlyTarget: '⛔ Seule la personne visée peut répondre à cette interaction.',
    self: '😅 Vous ne pouvez pas faire ça tout seul… choisissez quelqu\'un d\'autre !',
    otherBot: '🤖 Les autres bots n\'ont pas de sentiments… enfin je crois.',
    botAccept: '😳 *rougit* … accepté !',
    noGif: '⚠️ GIF momentanément indisponible',
    anime: 'Anime : ',
    badgeTitle: '🏅 Nouveau badge débloqué !',
    badgeDesc: (emoji, nom, action, n) => `${emoji} Badge **${nom}** — catégorie **${action}**\nVous avez utilisé cette interaction **${n}** fois. Continuez comme ça !`,
    badgesTitle: '🏅 Vos badges d\'interactions',
    badgesEmpty: 'Aucun badge pour le moment — utilisez `/interact` pour en débloquer (paliers : 10, 50, 100, 250, 500) !',
    uses: 'utilisations',
    types: { hetero: 'Hétéro', lesbienne: 'Lesbienne', gay: 'Gay', catgirl: 'Catgirl', catboy: 'Catboy', femboy: 'Femboy' },
    typeNote: 'Type : ',
    typeSansCle: '⚠️ Ce type demande une clé GIPHY, absente sur ce bot — GIF classique',
    typeIntrouvable: '⚠️ Aucun GIF trouvé pour ce type — GIF classique',
    memeGif: '🔁 Une seule animation existe ici — on ne la remet pas deux fois',
    typeMeme: '🔁 Le seul GIF de ce type était déjà dans le message : GIF classique',
  },
  en: {
    actions: {
      kiss: { name: 'Kisses', phrase: (a, b) => `💋 **${a}** gives **${b}** a sweet kiss!`, count: (n) => `💞 They have kissed **${n}** times.`, back: '💋 Kiss back' },
      peck: { name: 'Kisses', phrase: (a, b) => `😚 **${a}** kisses **${b}** on the cheek!`, count: (n) => `💞 They have kissed **${n}** times.`, back: '😚 Kiss back' },
      hug: { name: 'Hugs', phrase: (a, b) => `🤗 **${a}** hugs **${b}**!`, count: (n) => `🫂 They have shared **${n}** hugs.`, back: '🤗 Hug back' },
      pat: { name: 'Pats', phrase: (a, b) => `🖐️ **${a}** gently pats **${b}**'s head.`, count: (n) => `✨ **${n}** headpats shared.`, back: '🖐️ Pat back' },
      bite: { name: 'Bites', phrase: (a, b) => `😬 **${a}** playfully bites **${b}**!`, count: (n) => `🦷 **${n}** bites exchanged.`, back: '😬 Bite back' },
      lick: { name: 'Licks', phrase: (a, b) => `👅 **${a}** licks **${b}**… cheeky!`, count: (n) => `👅 **${n}** licks exchanged.`, back: '👅 Lick back' },
      bang: { name: 'Shots', phrase: (a, b) => `🔫 **${a}** shoots **${b}**! Bang!`, count: (n) => `🔫 **${n}** shots exchanged.`, back: '🔫 Shoot back' },
      punch: { name: 'Punches', phrase: (a, b) => `👊 **${a}** punches **${b}**!`, count: (n) => `👊 **${n}** punches exchanged.`, back: '👊 Punch back' },
      kill: { name: 'Kills', phrase: (a, b) => `💀 **${a}** kills **${b}**… no mercy!`, count: (n) => `💀 **${n}** kills between them.`, back: '💀 Get revenge' },
    },
    reject: 'Reject',
    rejected: (a, b) => `💔 ${a} rejected ${b}'s interaction… ouch.`,
    onlyTarget: '⛔ Only the targeted person can respond to this interaction.',
    self: '😅 You can\'t do that alone… pick someone else!',
    otherBot: '🤖 Other bots don\'t have feelings… I think.',
    botAccept: '😳 *blushes* … accepted!',
    noGif: '⚠️ GIF temporarily unavailable',
    anime: 'Anime: ',
    badgeTitle: '🏅 New badge unlocked!',
    badgeDesc: (emoji, nom, action, n) => `${emoji} **${nom}** badge — **${action}** category\nYou have used this interaction **${n}** times. Keep it up!`,
    badgesTitle: '🏅 Your interaction badges',
    badgesEmpty: 'No badges yet — use `/interact` to unlock them (milestones: 10, 50, 100, 250, 500)!',
    uses: 'uses',
    types: { hetero: 'Straight', lesbienne: 'Lesbian', gay: 'Gay', catgirl: 'Catgirl', catboy: 'Catboy', femboy: 'Femboy' },
    typeNote: 'Type: ',
    typeSansCle: '⚠️ This type needs a GIPHY key, missing on this bot — classic GIF',
    typeIntrouvable: '⚠️ No GIF found for this type — classic GIF',
    memeGif: '🔁 Only one GIF exists here — not showing it twice',
    typeMeme: '🔁 The only GIF of this type was already in the message: classic GIF',
  },
  es: {
    actions: {
      kiss: { name: 'Besos', phrase: (a, b) => `💋 ¡**${a}** le da un beso a **${b}**!`, count: (n) => `💞 Se han besado **${n}** veces.`, back: '💋 Devolver el beso' },
      peck: { name: 'Besos', phrase: (a, b) => `😚 ¡**${a}** besa a **${b}** en la mejilla!`, count: (n) => `💞 Se han besado **${n}** veces.`, back: '😚 Devolver el beso' },
      hug: { name: 'Abrazos', phrase: (a, b) => `🤗 ¡**${a}** abraza a **${b}**!`, count: (n) => `🫂 Han compartido **${n}** abrazos.`, back: '🤗 Devolver el abrazo' },
      pat: { name: 'Caricias', phrase: (a, b) => `🖐️ **${a}** acaricia suavemente la cabeza de **${b}**.`, count: (n) => `✨ **${n}** caricias compartidas.`, back: '🖐️ Acariciar también' },
      bite: { name: 'Mordiscos', phrase: (a, b) => `😬 ¡**${a}** muerde juguetonamente a **${b}**!`, count: (n) => `🦷 **${n}** mordiscos intercambiados.`, back: '😬 Morder también' },
      lick: { name: 'Lametones', phrase: (a, b) => `👅 **${a}** lame a **${b}**… ¡pícaro!`, count: (n) => `👅 **${n}** lametones intercambiados.`, back: '👅 Devolver el lametón' },
      bang: { name: 'Disparos', phrase: (a, b) => `🔫 **${a}** le dispara a **${b}**. ¡Bang!`, count: (n) => `🔫 **${n}** disparos intercambiados.`, back: '🔫 Devolver el disparo' },
      punch: { name: 'Puñetazos', phrase: (a, b) => `👊 ¡**${a}** le da un puñetazo a **${b}**!`, count: (n) => `👊 **${n}** puñetazos intercambiados.`, back: '👊 Devolver el golpe' },
      kill: { name: 'Eliminaciones', phrase: (a, b) => `💀 **${a}** elimina a **${b}**… ¡sin piedad!`, count: (n) => `💀 **${n}** eliminaciones entre ellos.`, back: '💀 Vengarse' },
    },
    reject: 'Rechazar',
    rejected: (a, b) => `💔 ${a} rechazó la interacción de ${b}… ay.`,
    onlyTarget: '⛔ Solo la persona señalada puede responder a esta interacción.',
    self: '😅 ¡No puedes hacer eso solo… elige a otra persona!',
    otherBot: '🤖 Los otros bots no tienen sentimientos… creo.',
    botAccept: '😳 *se sonroja* … ¡aceptado!',
    noGif: '⚠️ GIF temporalmente no disponible',
    anime: 'Anime: ',
    badgeTitle: '🏅 ¡Nueva insignia desbloqueada!',
    badgeDesc: (emoji, nom, action, n) => `${emoji} Insignia **${nom}** — categoría **${action}**\nHas usado esta interacción **${n}** veces. ¡Sigue así!`,
    badgesTitle: '🏅 Tus insignias de interacciones',
    badgesEmpty: '¡Aún no tienes insignias — usa `/interact` para desbloquearlas (niveles: 10, 50, 100, 250, 500)!',
    uses: 'usos',
    types: { hetero: 'Hetero', lesbienne: 'Lesbiana', gay: 'Gay', catgirl: 'Catgirl', catboy: 'Catboy', femboy: 'Femboy' },
    typeNote: 'Tipo: ',
    typeSansCle: '⚠️ Este tipo necesita una clave GIPHY, ausente en este bot — GIF clásico',
    typeIntrouvable: '⚠️ Ningún GIF encontrado para este tipo — GIF clásico',
    memeGif: '🔁 Solo existe un GIF aquí — no se repite',
    typeMeme: '🔁 El único GIF de este tipo ya estaba en el mensaje: GIF clásico',
  },
  de: {
    actions: {
      kiss: { name: 'Küsse', phrase: (a, b) => `💋 **${a}** gibt **${b}** einen Kuss!`, count: (n) => `💞 Sie haben sich **${n}** Mal geküsst.`, back: '💋 Zurückküssen' },
      peck: { name: 'Küsse', phrase: (a, b) => `😚 **${a}** küsst **${b}** auf die Wange!`, count: (n) => `💞 Sie haben sich **${n}** Mal geküsst.`, back: '😚 Zurückküssen' },
      hug: { name: 'Umarmungen', phrase: (a, b) => `🤗 **${a}** umarmt **${b}**!`, count: (n) => `🫂 Sie haben **${n}** Umarmungen geteilt.`, back: '🤗 Zurückumarmen' },
      pat: { name: 'Streicheln', phrase: (a, b) => `🖐️ **${a}** tätschelt sanft **${b}**s Kopf.`, count: (n) => `✨ **${n}** Streicheleinheiten geteilt.`, back: '🖐️ Auch streicheln' },
      bite: { name: 'Bisse', phrase: (a, b) => `😬 **${a}** beißt **${b}** verspielt!`, count: (n) => `🦷 **${n}** Bisse ausgetauscht.`, back: '😬 Zurückbeißen' },
      lick: { name: 'Lecken', phrase: (a, b) => `👅 **${a}** leckt **${b}**… frech!`, count: (n) => `👅 **${n}** Mal geleckt.`, back: '👅 Zurücklecken' },
      bang: { name: 'Schüsse', phrase: (a, b) => `🔫 **${a}** schießt auf **${b}**! Peng!`, count: (n) => `🔫 **${n}** Schüsse gewechselt.`, back: '🔫 Zurückschießen' },
      punch: { name: 'Fausthiebe', phrase: (a, b) => `👊 **${a}** verpasst **${b}** einen Fausthieb!`, count: (n) => `👊 **${n}** Fausthiebe gewechselt.`, back: '👊 Zurückschlagen' },
      kill: { name: 'Eliminierungen', phrase: (a, b) => `💀 **${a}** eliminiert **${b}**… gnadenlos!`, count: (n) => `💀 **${n}** Eliminierungen untereinander.`, back: '💀 Rache nehmen' },
    },
    reject: 'Ablehnen',
    rejected: (a, b) => `💔 ${a} hat die Interaktion von ${b} abgelehnt… autsch.`,
    onlyTarget: '⛔ Nur die angesprochene Person kann auf diese Interaktion antworten.',
    self: '😅 Das kannst du nicht alleine… wähle jemand anderen!',
    otherBot: '🤖 Andere Bots haben keine Gefühle… glaube ich.',
    botAccept: '😳 *errötet* … angenommen!',
    noGif: '⚠️ GIF vorübergehend nicht verfügbar',
    anime: 'Anime: ',
    badgeTitle: '🏅 Neues Abzeichen freigeschaltet!',
    badgeDesc: (emoji, nom, action, n) => `${emoji} Abzeichen **${nom}** — Kategorie **${action}**\nDu hast diese Interaktion **${n}** Mal benutzt. Weiter so!`,
    badgesTitle: '🏅 Deine Interaktions-Abzeichen',
    badgesEmpty: 'Noch keine Abzeichen — nutze `/interact`, um welche freizuschalten (Stufen: 10, 50, 100, 250, 500)!',
    uses: 'Nutzungen',
    types: { hetero: 'Hetero', lesbienne: 'Lesbisch', gay: 'Schwul', catgirl: 'Catgirl', catboy: 'Catboy', femboy: 'Femboy' },
    typeNote: 'Typ: ',
    typeSansCle: '⚠️ Dieser Typ braucht einen GIPHY-Schlüssel, der auf diesem Bot fehlt — klassisches GIF',
    typeIntrouvable: '⚠️ Kein GIF für diesen Typ gefunden — klassisches GIF',
    memeGif: '🔁 Hier gibt es nur ein GIF — es wird nicht zweimal gezeigt',
    typeMeme: '🔁 Das einzige GIF dieses Typs war schon in der Nachricht: klassisches GIF',
  },
  ru: {
    actions: {
      kiss: { name: 'Поцелуи', phrase: (a, b) => `💋 **${a}** целует **${b}**!`, count: (n) => `💞 Они целовались **${n}** раз.`, back: '💋 Поцеловать в ответ' },
      peck: { name: 'Поцелуи', phrase: (a, b) => `😚 **${a}** целует **${b}** в щёку!`, count: (n) => `💞 Они целовались **${n}** раз.`, back: '😚 Поцеловать в ответ' },
      hug: { name: 'Объятия', phrase: (a, b) => `🤗 **${a}** обнимает **${b}**!`, count: (n) => `🫂 Они обнялись **${n}** раз.`, back: '🤗 Обнять в ответ' },
      pat: { name: 'Поглаживания', phrase: (a, b) => `🖐️ **${a}** нежно гладит **${b}** по голове.`, count: (n) => `✨ **${n}** поглаживаний.`, back: '🖐️ Погладить в ответ' },
      bite: { name: 'Укусы', phrase: (a, b) => `😬 **${a}** игриво кусает **${b}**!`, count: (n) => `🦷 **${n}** укусов.`, back: '😬 Укусить в ответ' },
      lick: { name: 'Облизывания', phrase: (a, b) => `👅 **${a}** облизывает **${b}**… шалун!`, count: (n) => `👅 **${n}** облизываний.`, back: '👅 Облизать в ответ' },
      bang: { name: 'Выстрелы', phrase: (a, b) => `🔫 **${a}** стреляет в **${b}**! Бах!`, count: (n) => `🔫 Обменялись **${n}** выстрелами.`, back: '🔫 Выстрелить в ответ' },
      punch: { name: 'Удары', phrase: (a, b) => `👊 **${a}** бьёт **${b}** кулаком!`, count: (n) => `👊 Обменялись **${n}** ударами.`, back: '👊 Ударить в ответ' },
      kill: { name: 'Устранения', phrase: (a, b) => `💀 **${a}** устраняет **${b}**… без пощады!`, count: (n) => `💀 **${n}** устранений между ними.`, back: '💀 Отомстить' },
    },
    reject: 'Отказать',
    rejected: (a, b) => `💔 ${a} отклонил(а) действие от ${b}… ай.`,
    onlyTarget: '⛔ Ответить на это действие может только тот, к кому оно обращено.',
    self: '😅 В одиночку так не получится… выберите кого-нибудь другого!',
    otherBot: '🤖 У других ботов нет чувств… кажется.',
    botAccept: '😳 *краснеет* … принято!',
    noGif: '⚠️ GIF временно недоступен',
    anime: 'Аниме: ',
    badgeTitle: '🏅 Новый значок получен!',
    badgeDesc: (emoji, nom, action, n) => `${emoji} Значок **${nom}** — категория **${action}**\nВы использовали это действие **${n}** раз. Так держать!`,
    badgesTitle: '🏅 Ваши значки взаимодействий',
    badgesEmpty: 'Пока значков нет — используйте `/interact`, чтобы их открыть (рубежи: 10, 50, 100, 250, 500)!',
    uses: 'использований',
    types: { hetero: 'Гетеро', lesbienne: 'Лесби', gay: 'Гей', catgirl: 'Кошкодевочка', catboy: 'Кошкомальчик', femboy: 'Фембой' },
    typeNote: 'Тип: ',
    typeSansCle: '⚠️ Для этого типа нужен ключ GIPHY, которого нет у этого бота — обычный GIF',
    typeIntrouvable: '⚠️ GIF для этого типа не найден — обычный GIF',
    memeGif: '🔁 Здесь только один GIF — дважды не показываем',
    typeMeme: '🔁 Единственный GIF этого типа уже был в сообщении: обычный GIF',
  },
};

function resolveLang(locale) {
  const code = String(locale || '').toLowerCase();
  if (code.startsWith('fr')) return 'fr';
  if (code.startsWith('es')) return 'es';
  if (code.startsWith('de')) return 'de';
  if (code.startsWith('ru')) return 'ru';
  return 'en';
}

// ----- Badges par paliers d'utilisation (envoyés en MP) -----
const BADGE_LEVELS = [
  { seuil: 10, emoji: '🥉', noms: { fr: 'Bronze', en: 'Bronze', es: 'Bronce', de: 'Bronze', ru: 'Бронза' } },
  { seuil: 50, emoji: '🥈', noms: { fr: 'Argent', en: 'Silver', es: 'Plata', de: 'Silber', ru: 'Серебро' } },
  { seuil: 100, emoji: '🥇', noms: { fr: 'Or', en: 'Gold', es: 'Oro', de: 'Gold', ru: 'Золото' } },
  { seuil: 250, emoji: '💎', noms: { fr: 'Platine', en: 'Platinum', es: 'Platino', de: 'Platin', ru: 'Платина' } },
  { seuil: 500, emoji: '👑', noms: { fr: 'Légende', en: 'Legend', es: 'Leyenda', de: 'Legende', ru: 'Легенда' } },
];

const bumpPair = db.prepare(`
  INSERT INTO interactions (user_a, user_b, action, count) VALUES (?, ?, ?, 1)
  ON CONFLICT (user_a, user_b, action) DO UPDATE SET count = count + 1
`);
const getPair = db.prepare('SELECT count FROM interactions WHERE user_a = ? AND user_b = ? AND action = ?');
const bumpStat = db.prepare(`
  INSERT INTO interaction_stats (user_id, action, count) VALUES (?, ?, 1)
  ON CONFLICT (user_id, action) DO UPDATE SET count = count + 1
`);
const getStat = db.prepare('SELECT count FROM interaction_stats WHERE user_id = ? AND action = ?');
const listStats = db.prepare('SELECT * FROM interaction_stats WHERE user_id = ? ORDER BY count DESC');
const hasBadge = db.prepare('SELECT 1 FROM user_badges WHERE user_id = ? AND action = ? AND level = ?');
const insertBadge = db.prepare('INSERT INTO user_badges (user_id, action, level, earned_at) VALUES (?, ?, ?, ?)');
const listUserBadges = db.prepare('SELECT * FROM user_badges WHERE user_id = ? ORDER BY action, level');

function incrementCounter(idA, idB, action) {
  const [a, b] = [idA, idB].sort();
  bumpPair.run(a, b, action);
  return getPair.get(a, b, action).count;
}

// Attribue les badges nouvellement franchis et les envoie EN MP à l'utilisateur.
async function awardBadges(user, counterKey, totalUses, lang) {
  const L = LOCALES[lang];
  for (const level of BADGE_LEVELS) {
    if (totalUses < level.seuil) break;
    if (hasBadge.get(user.id, counterKey, level.seuil)) continue;
    insertBadge.run(user.id, counterKey, level.seuil, new Date().toISOString());
    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(L.badgeTitle)
      .setDescription(L.badgeDesc(level.emoji, level.noms[lang], L.actions[counterKey].name, level.seuil))
      .setTimestamp();
    await user.send({ embeds: [embed] }).catch(() => null); // MP fermés : tant pis
  }
}

// 🎞️ Réserve de GIF déjà obtenus.
//
// Les API publiques d'anime tombent, souvent et sans prévenir : 403, 502,
// délai dépassé. Quand les trois refusent en même temps, l'animation partait
// sans image et affichait « GIF momentanément indisponible » — c'est-à-dire
// tout sauf l'animation qu'on venait de demander.
//
// Chaque GIF obtenu est donc mémorisé. En cas de panne, on en ressert un déjà
// vu : moins de nouveauté, mais une image. La réserve est bornée pour ne pas
// gonfler indéfiniment.
const RESERVE_MAX = 60;
const garderGif = db.prepare(
  'INSERT INTO gif_cache (categorie, url, anime, at) VALUES (?, ?, ?, ?) ON CONFLICT (categorie, url) DO NOTHING'
);
const gifAuHasard = db.prepare(
  'SELECT url, anime FROM gif_cache WHERE categorie = ? ORDER BY RANDOM() LIMIT 1'
);
// Plusieurs candidats au hasard : on en écarte ceux déjà vus (voir `exclure`).
const gifsAuHasard = db.prepare(
  'SELECT url, anime, categorie FROM gif_cache WHERE categorie = ? ORDER BY RANDOM() LIMIT 8'
);
const gifsAuHasardTypee = db.prepare(
  'SELECT url, anime, categorie FROM gif_cache WHERE categorie LIKE ? ORDER BY RANDOM() LIMIT 8'
);

// 🔁 « Rendre » ne doit JAMAIS ressortir le GIF du message d'origine : la
// même image deux fois de suite, c'est une réponse qui a l'air copiée. Chaque
// source reçoit donc un ensemble d'URL à écarter, et retire au hasard (ou
// passe à la source suivante) tant qu'elle tombe dessus.
const ESSAIS_SAUF = 3;

// 🔑 La clé sous laquelle deux URL désignent LE MÊME GIF.
//
// GIPHY signe chaque réponse : `…/media/v1.<jeton>/<id>/giphy.gif?cid=<réponse>…`.
// Deux recherches qui rapportent le même GIF donnent deux chaînes
// différentes — comparer les URL telles quelles ne reconnaîtrait jamais
// l'image d'origine, et la réserve se remplirait de doublons. La clé est donc
// l'identifiant du chemin pour giphy.com, l'URL sans paramètres ailleurs.
const ID_GIPHY = /^https?:\/\/(?:[a-z0-9-]+\.)*giphy\.com\/media\/(?:v\d+\.[^/]+\/)?([A-Za-z0-9]+)\//i;
function cleGif(url) {
  const u = String(url || '');
  const giphy = u.match(ID_GIPHY);
  if (giphy) return `giphy:${giphy[1]}`;
  return u.split(/[?#]/)[0];
}
// L'URL sous laquelle on AFFICHE et on RANGE un GIF GIPHY : stable, sans
// jeton de réponse — Discord la lit aussi bien, et la réserve ne la stocke
// qu'une fois.
function urlStable(url) {
  const u = String(url || '');
  const m = u.match(/^(https?:\/\/(?:[a-z0-9-]+\.)*giphy\.com)\/media\/(?:v\d+\.[^/]+\/)?([A-Za-z0-9]+)\/([^/?#]+)/i);
  return m ? `${m[1]}/media/${m[2]}/${m[3]}` : u;
}
const clesExclues = (urls) => new Set([...(urls || [])].map(cleGif));

// Les lignes de réserve GIPHY rangées avant cette clé portaient le jeton de
// réponse : on les réécrit une fois sous leur adresse stable (les doublons
// se fondent, `INSERT OR IGNORE` puis suppression de l'ancienne ligne).
try {
  const signees = db.prepare("SELECT categorie, url, anime, at FROM gif_cache WHERE categorie LIKE '%@giphy' AND url LIKE '%?%'").all();
  if (signees.length) {
    const poser = db.prepare('INSERT OR IGNORE INTO gif_cache (categorie, url, anime, at) VALUES (?, ?, ?, ?)');
    const oter = db.prepare('DELETE FROM gif_cache WHERE categorie = ? AND url = ?');
    db.transaction(() => {
      for (const l of signees) {
        poser.run(l.categorie, urlStable(l.url), l.anime, l.at);
        oter.run(l.categorie, l.url);
      }
    })();
    console.log(`🎞️ Réserve GIPHY : ${signees.length} adresse(s) signée(s) réécrite(s) en adresse stable.`);
  }
} catch (err) {
  console.warn(`⚠️ Réserve GIPHY non normalisée : ${err.message}`);
}
const estExclu = (url, exclure) => Boolean(exclure && exclure.size && url && exclure.has(cleGif(url)));
const premierLibre = (liste, exclure) => liste.find((g) => g?.url && !estExclu(g.url, exclure)) || null;

// Toutes les URL d'un message du bot — embed (image, vignette) ou carte
// (galerie) — pour les écarter de la réponse.
function urlsDuMessage(message) {
  const urls = new Set();
  const brut = (x) => (x && typeof x.toJSON === 'function' ? x.toJSON() : x);
  const visiter = (x, profondeur = 0) => {
    if (!x || typeof x !== 'object' || profondeur > 12) return;
    for (const [cle, valeur] of Object.entries(x)) {
      if ((cle === 'url' || cle === 'proxy_url' || cle === 'proxyURL') && typeof valeur === 'string' && /^https?:\/\//i.test(valeur)) urls.add(valeur);
      else if (valeur && typeof valeur === 'object') visiter(brut(valeur), profondeur + 1);
    }
  };
  try {
    visiter((message?.embeds || []).map(brut));
    visiter((message?.components || []).map(brut));
  } catch {
    // Un message illisible ne doit pas empêcher la réponse : on n'exclut rien.
  }
  return urls;
}
const compterGifs = db.prepare('SELECT COUNT(*) AS n FROM gif_cache WHERE categorie = ?');
const purgerGifs = db.prepare(
  'DELETE FROM gif_cache WHERE categorie = ? AND rowid NOT IN'
  + ' (SELECT rowid FROM gif_cache WHERE categorie = ? ORDER BY at DESC LIMIT ?)'
);

// Une URL que Discord ne saura pas afficher casse l'embed entier : on ne
// garde que ce qui ressemble vraiment à une image.
const urlAffichable = (u) => /^https:\/\/\S+$/i.test(String(u || ''));

function memoriserGif(categorie, gif) {
  try {
    garderGif.run(categorie, gif.url, gif.anime || null, new Date().toISOString());
    if (Number(compterGifs.get(categorie)?.n || 0) > RESERVE_MAX) {
      purgerGifs.run(categorie, categorie, RESERVE_MAX);
    }
  } catch {
    // La réserve est un confort : elle ne doit jamais empêcher l'animation.
  }
}

// GIF depuis internet : trois sources essayées dans l'ordre, timeout 5 s
// chacune, et cause d'échec journalisée dans la console pour diagnostic.
// 🎞️ Où chercher le GIF de chaque action, DANS L'ORDRE.
//
// Les trois sources n'ont pas le même catalogue — et c'est ce qui cassait le
// bisou sur la joue : « peck » était remplacé par « kiss » PARTOUT, donc
// l'image (l'élément dominant de la carte) montrait toujours un vrai baiser.
// Chaque action liste ses sources utiles, de la plus juste à la plus proche ;
// une action sans équivalent chez une source ne l'interroge pas. Une seule
// source = une seule panne possible : « kill » n'existe que chez waifu.pics,
// dont l'endpoint a un historique de pannes — d'où le repli sur « shoot ».
const SOURCES_GIF = {
  nekos: { nom: 'nekos.best', url: (c) => `https://nekos.best/api/v2/${c}`, parse: (d) => ({ url: d.results?.[0]?.url, anime: d.results?.[0]?.anime_name || null }) },
  waifu: { nom: 'waifu.pics', url: (c) => `https://api.waifu.pics/sfw/${c}`, parse: (d) => ({ url: d.url, anime: null }) },
  otaku: { nom: 'otakugifs', url: (c) => `https://api.otakugifs.xyz/gif?reaction=${c}`, parse: (d) => ({ url: d.url, anime: null }) },
};
const CATEGORIES_GIF = {
  kiss: [['nekos', 'kiss'], ['waifu', 'kiss'], ['otaku', 'kiss']],
  peck: [['otaku', 'airkiss']],                 // le bisou soufflé, le plus proche de la joue
  hug: [['nekos', 'hug'], ['waifu', 'hug'], ['otaku', 'hug']],
  pat: [['nekos', 'pat'], ['waifu', 'pat'], ['otaku', 'pat']],
  bite: [['nekos', 'bite'], ['waifu', 'bite'], ['otaku', 'bite']],
  lick: [['nekos', 'lick'], ['waifu', 'lick'], ['otaku', 'lick']],
  bang: [['nekos', 'shoot']],
  punch: [['nekos', 'punch'], ['otaku', 'punch']],
  kill: [['waifu', 'kill'], ['nekos', 'shoot'], ['nekos', 'yeet']],
};

// 🏳️‍🌈 Types de GIF : pour que chacun se reconnaisse dans l'image.
//
// Les trois sources classiques (nekos.best, waifu.pics, otakugifs) ne
// classent pas leurs GIF par couple : un « kiss » y est presque toujours un
// garçon et une fille. Deux renforts, dans l'ordre :
//
//  1. Gifukai (api.gifukai.com) — sans clé, tout public par défaut, et qui
//     SAIT filtrer par couple (`pairing=ff` fille → fille, `mm` garçon →
//     garçon). Il couvre lesbienne et gay pour les actions qu'il connaît.
//  2. GIPHY — recherche libre, donc catgirl, catboy, femboy… mais À CLÉ
//     (`GIPHY_KEY` dans le .env ; gratuite, 100 recherches par heure). Une
//     recherche rapporte jusqu'à 50 GIF, tous mis en réserve : la plupart des
//     envois ne coûtent aucun appel. Ses conditions exigent la mention
//     « Powered by GIPHY » : elle va dans le pied de carte.
//
// ⚠️ L'API Tenor de Google a fermé le 30 juin 2026 : ne pas la rebrancher.
//
// Sans clé GIPHY, un type qu'aucune source gratuite ne couvre retombe sur le
// GIF classique, et le pied de carte le DIT — sans quoi on croirait l'option
// cassée. `hetero` est le défaut : il reste sur les sources classiques.
const TYPES_GIF = {
  hetero: null,
  lesbienne: { pairing: 'ff', requete: 'anime yuri' },
  gay: { pairing: 'mm', requete: 'anime yaoi' },
  catgirl: { pairing: null, requete: 'anime catgirl' },
  catboy: { pairing: null, requete: 'anime catboy' },
  femboy: { pairing: null, requete: 'anime femboy' },
};
// Le mot anglais de chaque action, pour la recherche libre GIPHY.
const MOTS_ACTION = {
  kiss: 'kiss', peck: 'cheek kiss', hug: 'hug', pat: 'head pat', bite: 'bite',
  lick: 'lick', bang: 'shoot gun', punch: 'punch', kill: 'kill',
};
// Les actions que Gifukai connaît, et leur chemin (le bisou sur la joue est
// un filtre `type` du bisou). Les autres passent directement par GIPHY.
const ACTIONS_GIFUKAI = {
  kiss: 'kiss', peck: 'kiss?type=cheek', hug: 'hug', pat: 'pat', bite: 'bite',
};
const TYPE_DEFAUT = 'hetero';
const typeValide = (t) => (TYPES_GIF[t] !== undefined ? t : TYPE_DEFAUT);
const requeteGif = (action, type) => `${TYPES_GIF[type]?.requete || 'anime'} ${MOTS_ACTION[action] || action}`.trim();
// Un type « à clé » n'a aucune source gratuite : sans GIPHY_KEY, impossible.
const typeExigeCle = (type) => Boolean(TYPES_GIF[type]) && !TYPES_GIF[type].pairing;
const cleGiphy = () => (process.env.GIPHY_KEY || '').trim();

// La réserve des GIF typés est rangée par `action@type@source` : on sait
// ainsi d'où vient une image ressortie (GIPHY impose sa mention).
const gifAuHasardTypee = db.prepare(
  'SELECT url, anime, categorie FROM gif_cache WHERE categorie LIKE ? ORDER BY RANDOM() LIMIT 1'
);
const ENTETES_GIF = { 'User-Agent': 'discord-roblox-rp-bot' };

async function chercherGifukai(action, pairing, exclure = null) {
  const chemin = ACTIONS_GIFUKAI[action];
  if (!chemin || !pairing) return null;
  const url = `https://api.gifukai.com/v1/${chemin}${chemin.includes('?') ? '&' : '?'}pairing=${pairing}`;
  const essais = exclure?.size ? ESSAIS_SAUF : 1;
  for (let essai = 0; essai < essais; essai++) {
    try {
      const res = await fetch(url, { headers: ENTETES_GIF, signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        console.warn(`⚠️ GIF Gifukai (${action}, ${pairing}) : HTTP ${res.status}`);
        return null;
      }
      const d = await res.json();
      if (!urlAffichable(d?.url)) {
        console.warn(`⚠️ GIF Gifukai (${action}, ${pairing}) : réponse sans URL exploitable`);
        return null;
      }
      if (estExclu(d.url, exclure)) continue; // le même GIF que l'original : on retire
      return { url: d.url, anime: d.anime || null, source: 'gifukai' };
    } catch (err) {
      console.warn(`⚠️ GIF Gifukai (${action}, ${pairing}) : ${err.message}`);
      return null;
    }
  }
  // La source a répondu, mais toujours avec l'image à écarter.
  return { exclu: true };
}

// GIPHY : 100 recherches par heure sur une clé gratuite. Une recherche
// rapporte 50 GIF, tous mis en réserve ; tant que la réserve d'un couple
// (action, type) est garnie et que la dernière recherche est récente, on
// sert la réserve sans appel réseau.
const GIPHY_LIMITE = 50;
const GIPHY_REPIT = 20 * 60 * 1000;
const GIPHY_RESERVE_MIN = 10;
const derniereRechercheGiphy = new Map();

async function chercherGiphy(action, type, cle, exclure = null) {
  const q = requeteGif(action, type);
  const categorie = `${action}@${type}@giphy`;
  const maintenant = Date.now();
  const dernier = derniereRechercheGiphy.get(categorie) || 0;
  if (Number(compterGifs.get(categorie)?.n || 0) >= GIPHY_RESERVE_MIN && maintenant - dernier < GIPHY_REPIT) {
    const choix = premierLibre(gifsAuHasard.all(categorie), exclure);
    if (choix?.url) return { url: choix.url, anime: choix.anime || null, source: 'giphy' };
  }
  derniereRechercheGiphy.set(categorie, maintenant);
  let toutExclu = false; // GIPHY a répondu, mais rien d'autre que l'image à écarter
  // « pg » laisse passer les bisous sur la bouche ; « pg-13 » n'est tenté
  // que si « pg » ne rapporte rien (requêtes de niche).
  for (const rating of ['pg', 'pg-13']) {
    try {
      const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(cle)}&q=${encodeURIComponent(q)}`
        + `&limit=${GIPHY_LIMITE}&rating=${rating}&lang=en`;
      const res = await fetch(url, { headers: ENTETES_GIF, signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        console.warn(`⚠️ GIF GIPHY (${q}, ${rating}) : HTTP ${res.status}`);
        // Clé refusée ou quota épuisé : un second essai ne ferait qu'aggraver.
        if ([401, 403, 429].includes(res.status)) break;
        continue;
      }
      const d = await res.json();
      const liste = (Array.isArray(d.data) ? d.data : [])
        .map((g) => ({ url: urlStable(g.images?.original?.url || g.images?.downsized?.url), anime: null }))
        .filter((g) => urlAffichable(g.url));
      if (!liste.length) {
        console.warn(`⚠️ GIF GIPHY (${q}, ${rating}) : aucun résultat`);
        continue;
      }
      for (const g of liste) memoriserGif(categorie, g);
      const libres = liste.filter((g) => !estExclu(g.url, exclure));
      if (!libres.length) { toutExclu = true; continue; }
      return { ...libres[Math.floor(Math.random() * libres.length)], source: 'giphy' };
    } catch (err) {
      console.warn(`⚠️ GIF GIPHY (${q}, ${rating}) : ${err.message}`);
    }
  }
  return toutExclu ? { exclu: true } : null;
}

// GIF « typé ». Rend { url, anime, source } ; null pour le type par défaut
// (→ sources classiques) ; { sansCle: true } quand seule une clé GIPHY
// absente aurait pu servir ce type ; { introuvable: true } si tout a échoué et
// que la réserve est vide.
// Rend aussi { introuvable: true, memeSeulement: true } quand le SEUL GIF
// connu de ce type est celui qu'on devait écarter : ce n'est ni une panne ni
// une clé manquante, et le pied de carte doit le dire tel quel.
async function fetchGifTypee(action, type, exclure = null) {
  const def = TYPES_GIF[type];
  if (!def) return null;
  exclure = exclure?.size ? clesExclues(exclure) : null; // clés normalisées (idempotent)
  const cle = cleGiphy();
  // Une source gratuite existe pour ce couple (action, type) ?
  const gratuite = Boolean(def.pairing && ACTIONS_GIFUKAI[action]);
  let memeSeulement = false;
  if (gratuite) {
    const gif = await chercherGifukai(action, def.pairing, exclure);
    if (gif?.url) {
      memoriserGif(`${action}@${type}@gifukai`, gif);
      return gif;
    }
    if (gif?.exclu) memeSeulement = true;
  }
  if (cle) {
    const gif = await chercherGiphy(action, type, cle, exclure);
    if (gif?.url) return gif;
    if (gif?.exclu) memeSeulement = true;
  }
  const secours = premierLibre(gifsAuHasardTypee.all(`${action}@${type}@%`), exclure);
  if (secours?.url) {
    console.warn(`⚠️ Sources typées HS pour « ${action} / ${type} » — GIF repris de la réserve.`);
    return { url: secours.url, anime: secours.anime || null, source: String(secours.categorie).split('@')[2] || null, reserve: true };
  }
  // « Seulement le même » ne se conclut que si une source a RÉPONDU avec
  // l'image à écarter : une réserve réduite à l'original ne dit rien d'une
  // source en panne, et ce serait annoncer un faux diagnostic.
  if (memeSeulement) return { introuvable: true, memeSeulement: true };
  if (!cle && !gratuite) return { sansCle: true };
  return { introuvable: true };
}

async function fetchGif(category, exclure = null) {
  exclure = exclure?.size ? clesExclues(exclure) : null; // clés normalisées (idempotent)
  const pistes = CATEGORIES_GIF[category] || [['nekos', category], ['waifu', category], ['otaku', category]];
  const sources = pistes.map(([cle, cat]) => ({ name: SOURCES_GIF[cle].nom, url: SOURCES_GIF[cle].url(cat), parse: SOURCES_GIF[cle].parse }));
  const essais = exclure?.size ? ESSAIS_SAUF : 1;
  let memeSeulement = false; // une source a répondu, mais rien d'autre que l'image à écarter
  for (const source of sources) {
    for (let essai = 0; essai < essais; essai++) {
      try {
        const res = await fetch(source.url, {
          headers: { 'User-Agent': 'discord-roblox-rp-bot' },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
          console.warn(`⚠️ GIF ${source.name} (${category}) : HTTP ${res.status}`);
          break;
        }
        const gif = source.parse(await res.json());
        if (!urlAffichable(gif.url)) {
          console.warn(`⚠️ GIF ${source.name} (${category}) : réponse sans URL exploitable`);
          break;
        }
        memoriserGif(category, gif);
        if (estExclu(gif.url, exclure)) { memeSeulement = true; continue; } // le même GIF : on retire
        return gif;
      } catch (err) {
        console.warn(`⚠️ GIF ${source.name} (${category}) : ${err.message}`);
        break;
      }
    }
  }

  // Les trois sources sont tombées (ou ne donnent que l'image à écarter) : on
  // ressert une image déjà vue plutôt que de rendre une animation sans
  // animation.
  const secours = premierLibre(gifsAuHasard.all(category), exclure);
  if (secours?.url) {
    console.warn(`⚠️ Sources HS pour « ${category} » — GIF repris de la réserve.`);
    return { url: secours.url, anime: secours.anime || null, reserve: true };
  }
  if (memeSeulement) {
    // Les sources ont répondu, mais rien d'autre que l'image à écarter :
    // plutôt pas d'image que la même — et le pied de carte dira que ce n'est
    // pas une panne. (Une réserve réduite à l'original ne suffit pas à le
    // conclure : sources en panne = « indisponible », tout simplement.)
    console.warn(`ℹ️ « ${category} » : seul le GIF à écarter est disponible — réponse sans image.`);
    return { memeSeulement: true };
  }
  console.warn(`⚠️ Aucun GIF trouvé pour « ${category} » — les 3 sources ont échoué et la réserve est vide.`);
  return null;
}

function displayName(interaction, user) {
  if (interaction.guild) {
    const member = interaction.guild.members.cache.get(user.id);
    if (member) return member.displayName;
  }
  return user.displayName || user.username;
}

async function buildInteractionMessage(interaction, actionKey, author, target, withButtons, lang, type = TYPE_DEFAUT, { exclure = null } = {}) {
  const L = LOCALES[lang];
  const action = L.actions[actionKey];
  const counterKey = actionKey === 'peck' ? 'kiss' : actionKey;
  type = typeValide(type);

  // GIF typé d'abord ; en cas d'échec on retombe sur le GIF classique, et on
  // explique pourquoi dans le pied de carte (clé absente ou rien trouvé).
  // `exclure` : les URL du message d'origine, qu'une réponse ne ressort jamais.
  exclure = exclure?.size ? clesExclues(exclure) : null;
  let gif = null;
  let noteType = null;
  if (type !== TYPE_DEFAUT) {
    const typee = await fetchGifTypee(actionKey, type, exclure);
    if (typee?.url) gif = typee;
    else if (typee?.memeSeulement) noteType = L.typeMeme;
    else noteType = typee?.sansCle ? L.typeSansCle : L.typeIntrouvable;
  }
  if (!gif?.url) gif = await fetchGif(actionKey, exclure);
  const count = incrementCounter(author.id, target.id, counterKey);

  // Statistiques personnelles de l'auteur → badges par paliers, envoyés en MP.
  bumpStat.run(author.id, counterKey);
  const totalUses = getStat.get(author.id, counterKey).count;
  awardBadges(author, counterKey, totalUses, lang);

  const embed = new EmbedBuilder()
    .setColor(0xff6b81)
    .setDescription(`${action.phrase(displayName(interaction, author), displayName(interaction, target))}\n${action.count(count)}`);
  if (urlAffichable(gif?.url)) {
    // setImage lève sur une URL invalide, et l'exception ressortirait en
    // « ❌ Une erreur est survenue » : l'animation entière perdue pour une
    // image.
    try { embed.setImage(gif.url); } catch { /* on continue sans image */ }
  }
  const pied = [];
  if (type !== TYPE_DEFAUT && !noteType) pied.push(`${L.typeNote}${L.types[type]}`);
  if (gif?.anime) pied.push(`${L.anime}${gif.anime}`);
  if (!gif?.url) {
    // Sans image du tout, une note qui promet « GIF classique » mentirait :
    // une seule ligne, qui dit pourquoi il n'y en a pas.
    pied.push(gif?.memeSeulement || noteType === L.typeMeme ? L.memeGif : L.noGif);
  } else if (noteType) {
    pied.push(noteType);
  }
  if (gif?.source === 'giphy') pied.push('Powered by GIPHY');
  if (pied.length) embed.setFooter({ text: pied.join(' • ') });

  // Mention de la personne visée uniquement sur un serveur — en MP (et en
  // salon privé d'app utilisateur), pas de mention : elle est inutile et
  // génère des notifications parasites.
  const payload = { embeds: [embed] };
  if (interaction.inGuild()) payload.content = `<@${target.id}>`;
  if (withButtons) {
    payload.components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`itx:${actionKey}:${author.id}:${target.id}:${type}`)
          .setLabel(action.back)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`itxr:${actionKey}:${author.id}:${target.id}:${type}`)
          .setLabel(L.reject)
          .setEmoji('❌')
          .setStyle(ButtonStyle.Secondary)
      ),
    ];
  }
  return payload;
}

// Contrôle administrateur du bot (via .env) :
//   MODULE_INTERACT=off      → module interactions désactivé sur CE bot
//   INTERACT_GUILDS=id1,id2  → module limité à ces serveurs (vide = partout)
function moduleBlocked(interaction) {
  if (process.env.MODULE_INTERACT?.trim().toLowerCase() === 'off') {
    return '⛔ Le module interactions est désactivé sur ce bot par son administrateur.';
  }
  const allowed = (process.env.INTERACT_GUILDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length && interaction.guildId && !allowed.includes(interaction.guildId)) {
    return '⛔ Le module interactions n\'est pas autorisé sur ce serveur.';
  }
  return null;
}

// Les choix de l'option `type`, la même sur chaque action.
const CHOIX_TYPE = [
  { name: 'Hétéro (défaut)', value: 'hetero', name_localizations: { 'en-US': 'Straight (default)', 'en-GB': 'Straight (default)' } },
  { name: 'Lesbienne', value: 'lesbienne', name_localizations: { 'en-US': 'Lesbian', 'en-GB': 'Lesbian' } },
  { name: 'Gay', value: 'gay' },
  { name: 'Catgirl', value: 'catgirl' },
  { name: 'Catboy', value: 'catboy' },
  { name: 'Femboy', value: 'femboy' },
];
const optionType = (o) =>
  o
    .setName('type')
    .setDescription('Quel type de GIF ? (facultatif, hétéro par défaut)')
    .setDescriptionLocalizations({ 'en-US': 'Which kind of GIF? (optional, straight by default)', 'en-GB': 'Which kind of GIF? (optional, straight by default)' })
    .setRequired(false)
    .addChoices(...CHOIX_TYPE);

module.exports = {
  CATEGORIES_GIF, SOURCES_GIF, LOCALES, TYPES_GIF, ACTIONS_GIFUKAI, CHOIX_TYPE, requeteGif, typeExigeCle, fetchGifTypee, fetchGif, urlsDuMessage, cleGif, urlStable,
  grade: GRADES.EVERYONE,
  public: true, // réponses visibles par tout le monde (pas d'éphémère)
  allowDm: true, // utilisable en message privé avec le bot
  userInstall: true, // installable sur un compte utilisateur → enregistrement GLOBAL
  botModule: 'interact', // désactivable par bot via MODULE_INTERACT=off
  guildModule: 'interact', // désactivable PAR SERVEUR via /config (désactivé par défaut)
  moduleBlocked,
  data: new SlashCommandBuilder()
    .setName('interact')
    .setDescription('Interactions : bisous, câlins, caresses, morsures, coups, tirs (GIF anime)')
    .setDescriptionLocalizations({ 'en-US': 'Interactions: kisses, hugs, pats, bites, punches, shots (anime GIFs)', 'en-GB': 'Interactions: kisses, hugs, pats, bites, punches, shots (anime GIFs)' })
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
    .addSubcommand((sub) =>
      sub
        .setName('kiss')
        .setDescription('Faire un bisou à quelqu\'un 💋')
        .setDescriptionLocalizations({ 'en-US': 'Give someone a sweet kiss 💋', 'en-GB': 'Give someone a sweet kiss 💋' })
        .addUserOption((o) => o.setName('membre').setDescription('À qui faire un bisou ?').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('endroit')
            .setDescription('Où ? (défaut : sur les lèvres)')
            .setRequired(false)
            .addChoices({ name: 'Sur les lèvres 💋', value: 'levres' }, { name: 'Sur la joue 😚', value: 'joue' })
        )
        .addStringOption(optionType)
    )
    .addSubcommand((sub) =>
      sub
        .setName('hug')
        .setDescription('Faire un câlin à quelqu\'un 🤗')
        .setDescriptionLocalizations({ 'en-US': 'A little hug, perhaps? 🤗', 'en-GB': 'A little hug, perhaps? 🤗' })
        .addUserOption((o) => o.setName('membre').setDescription('À qui faire un câlin ?').setRequired(true))
        .addStringOption(optionType)
    )
    .addSubcommand((sub) =>
      sub
        .setName('pat')
        .setDescription('Caresser la tête de quelqu\'un 🖐️')
        .setDescriptionLocalizations({ 'en-US': 'Gently pat someone on the head 🖐️', 'en-GB': 'Gently pat someone on the head 🖐️' })
        .addUserOption((o) => o.setName('membre').setDescription('Qui caresser ?').setRequired(true))
        .addStringOption(optionType)
    )
    .addSubcommand((sub) =>
      sub
        .setName('bite')
        .setDescription('Mordiller quelqu\'un 😬')
        .setDescriptionLocalizations({ 'en-US': 'Playfully bite someone 😬', 'en-GB': 'Playfully bite someone 😬' })
        .addUserOption((o) => o.setName('membre').setDescription('Qui mordre ?').setRequired(true))
        .addStringOption(optionType)
    )
    .addSubcommand((sub) =>
      sub
        .setName('lick')
        .setDescription('Lécher quelqu\'un 👅')
        .setDescriptionLocalizations({ 'en-US': 'Lick someone in a cheeky way 👅', 'en-GB': 'Lick someone in a cheeky way 👅' })
        .addUserOption((o) => o.setName('membre').setDescription('Qui lécher ?').setRequired(true))
        .addStringOption(optionType)
    )
    .addSubcommand((sub) =>
      sub
        .setName('bang')
        .setDescription('Tirer sur quelqu\'un 🔫')
        .setDescriptionLocalizations({ 'en-US': 'Shoot someone 🔫', 'en-GB': 'Shoot someone 🔫' })
        .addUserOption((o) => o.setName('membre').setDescription('Sur qui tirer ?').setRequired(true))
        .addStringOption(optionType)
    )
    .addSubcommand((sub) =>
      sub
        .setName('punch')
        .setDescription('Mettre un coup de poing à quelqu\'un 👊')
        .setDescriptionLocalizations({ 'en-US': 'Punch someone 👊', 'en-GB': 'Punch someone 👊' })
        .addUserOption((o) => o.setName('membre').setDescription('Qui frapper ?').setRequired(true))
        .addStringOption(optionType)
    )
    .addSubcommand((sub) =>
      sub
        .setName('kill')
        .setDescription('Éliminer quelqu\'un 💀')
        .setDescriptionLocalizations({ 'en-US': 'Take someone out 💀', 'en-GB': 'Take someone out 💀' })
        .addUserOption((o) => o.setName('membre').setDescription('Qui éliminer ?').setRequired(true))
        .addStringOption(optionType)
    )
    .addSubcommand((sub) =>
      sub
        .setName('badges')
        .setDescription('Voir vos badges d\'interactions 🏅')
        .setDescriptionLocalizations({ 'en-US': 'View your interaction badges 🏅', 'en-GB': 'View your interaction badges 🏅' })
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const lang = resolveLang(interaction.locale);
    const L = LOCALES[lang];

    if (sub === 'badges') {
      const badges = listUserBadges.all(interaction.user.id);
      const stats = listStats.all(interaction.user.id);
      const embed = new EmbedBuilder().setColor(0xffd700).setTitle(L.badgesTitle);
      if (!badges.length && !stats.length) {
        embed.setDescription(L.badgesEmpty);
      } else {
        const byAction = new Map();
        for (const badge of badges) {
          if (!byAction.has(badge.action)) byAction.set(badge.action, []);
          const level = BADGE_LEVELS.find((lv) => lv.seuil === badge.level);
          if (level) byAction.get(badge.action).push(`${level.emoji} ${level.noms[lang]}`);
        }
        for (const stat of stats) {
          const actionName = L.actions[stat.action]?.name || stat.action;
          const earned = byAction.get(stat.action);
          embed.addFields({
            name: `${actionName} — ${stat.count} ${L.uses}`,
            value: earned?.length ? earned.join(' · ') : '—',
            inline: false,
          });
        }
      }
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getUser('membre');
    const actionKey = sub === 'kiss' && interaction.options.getString('endroit') === 'joue' ? 'peck' : sub;
    // Le type est une option FACULTATIVE de chaque action : hétéro sans elle.
    const type = typeValide(interaction.options.getString('type'));

    if (target.id === interaction.user.id) {
      return interaction.reply({ content: L.self, flags: MessageFlags.Ephemeral });
    }
    if (target.bot && target.id !== interaction.client.user.id) {
      return interaction.reply({ content: L.otherBot, flags: MessageFlags.Ephemeral });
    }

    // Pas de boutons si la cible est le bot lui-même (il accepte toujours 😊).
    const withButtons = target.id !== interaction.client.user.id;

    // ⏱️ On ne diffère PAS d'emblée : un message différé est créé avant qu'on
    // sache quoi y mettre, et un message créé ne change plus de famille — la
    // réponse serait forcément un embed à l'ancienne. Le GIF arrive en
    // général en quelques centaines de millisecondes, largement dans les 3
    // secondes que Discord accorde. `repondreVite` ne diffère qu'à la
    // dernière seconde, et seulement si la recherche traîne.
    await repondreVite(interaction, async () => {
      const payload = await buildInteractionMessage(interaction, actionKey, interaction.user, target, withButtons, lang, type);
      if (!withButtons) payload.content = L.botAccept;
      return payload;
    });
  },

  // Boutons « Rendre » / « Rejeter » — réservés à la personne visée, dans SA langue.
  async handleButton(interaction) {
    try {
      const lang = resolveLang(interaction.locale);
      const L = LOCALES[lang];
      const [prefix, actionKey, fromId, toId, typeBouton] = interaction.customId.split(':');
      const type = typeValide(typeBouton);
      if (!L.actions[actionKey]) return;
      if (interaction.user.id !== toId) {
        return interaction.reply({ content: L.onlyTarget, flags: MessageFlags.Ephemeral });
      }
      if (prefix === 'itxr') {
        await mettreAJour(interaction, { components: [] });
        await suivre(interaction, { content: L.rejected(`<@${toId}>`, `<@${fromId}>`) });
        return;
      }
      // « Rendre » : nouvelle interaction dans l'autre sens, boutons retirés de
      // l'original — et JAMAIS le même GIF que lui.
      const author = interaction.user;
      const target = await interaction.client.users.fetch(fromId);
      const exclure = urlsDuMessage(interaction.message);
      await mettreAJour(interaction, { components: [] });
      const payload = await buildInteractionMessage(interaction, actionKey, author, target, false, lang, type, { exclure });
      await suivre(interaction, payload);
    } catch (err) {
      console.error('Erreur interaction :', err);
      await suivre(interaction, { content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral });
    }
  },
};
