const { getGrade, GRADES } = require('./permissions');
const { sendLog, logEmbed, COLORS } = require('./embeds');

// Anti-spam + filtre de contenu malveillant (volet « anti-injection »).
// Activé par serveur via antispam_enabled. Le staff est exempté.

const buckets = new Map(); // "guild:user" -> [timestamps]
const SPAM_WINDOW = 7000;
const SPAM_MAX = 5; // > 5 messages en 7 s = spam

const INVITE = /(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/\S+/i;
const SCAM = /(free\s*nitro|nitro\s*gratuit|steamcommunity\.com\/(gift|tradeoffer)|grabify|iplogger|@everyone\s+\S*https?:\/\/)/i;
const ZALGO = /[̀-ͯ]{6,}/;
const REPEAT = /(.)\1{18,}/;

function staffExempt(message, cfg) {
  try {
    return getGrade(message.member, cfg) >= GRADES.STAFF;
  } catch {
    return false;
  }
}

function liste(valeur) {
  try {
    const l = JSON.parse(valeur || '[]');
    return Array.isArray(l) ? l.map(String) : [];
  } catch {
    return [];
  }
}

// 🔕 Salons et catégories laissés tranquilles par l'anti-spam.
// Sert aux salons de flood, de commandes, de comptage… là où enchaîner les
// messages est normal.
// Un fil hérite de son salon parent, et un salon de sa catégorie : exempter
// une catégorie exempte tout ce qu'elle contient, fils compris.
function salonExempte(message, cfg) {
  const salons = liste(cfg.antispam_exempt_channels);
  const categories = liste(cfg.antispam_exempt_categories);
  if (!salons.length && !categories.length) return false;

  const ch = message.channel;
  const fil = Boolean(ch?.isThread?.());
  const salonPorteur = fil ? ch.parentId : ch?.id;          // le salon réel
  const categorie = fil ? ch.parent?.parentId : ch?.parentId;

  if (ch?.id && salons.includes(String(ch.id))) return true;
  if (salonPorteur && salons.includes(String(salonPorteur))) return true;
  if (categorie && categories.includes(String(categorie))) return true;
  return false;
}

// Renvoie true si le message a été traité (supprimé / auteur sanctionné).
async function guard(message, cfg) {
  if (staffExempt(message, cfg)) return false;
  const exempte = salonExempte(message, cfg);
  // Un salon exempté reste protégé des arnaques et des invitations, sauf si
  // le serveur a explicitement demandé l'inverse : c'est le cas d'un salon
  // de partenariats, où poster une invitation Discord est le but.
  if (exempte && Number(cfg.antispam_exempt_filtre || 0) === 1) return false;
  const content = message.content || '';

  // 1) Contenu malveillant
  const mentionScore =
    message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 6 : 0);
  let reason = null;
  if (INVITE.test(content)) reason = 'lien d\'invitation Discord non autorisé';
  else if (mentionScore >= 8) reason = 'mentions massives';
  else if (SCAM.test(content)) reason = 'lien / arnaque suspecte';
  else if (ZALGO.test(content) || REPEAT.test(content)) reason = 'spam de caractères / zalgo';

  if (reason) {
    await message.delete().catch(() => null);
    await message.member?.timeout?.(5 * 60 * 1000, `Filtre anti-injection : ${reason}`).catch(() => null);
    await sendLog(
      message.guild,
      logEmbed('🛡️ Message bloqué', `<@${message.author.id}> — ${reason} dans <#${message.channelId}> (mute 5 min).`, COLORS.WARNING)
    );
    return true;
  }

  // 2) Anti-spam (fréquence) — c'est ce dont les salons exemptés sont
  // dispensés : on n'y compte même pas les messages.
  if (exempte) return false;
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < SPAM_WINDOW);
  arr.push(now);
  buckets.set(key, arr);
  if (arr.length > SPAM_MAX) {
    buckets.set(key, []);
    await message.member?.timeout?.(5 * 60 * 1000, 'Anti-spam').catch(() => null);
    const recent = await message.channel.messages.fetch({ limit: 25 }).catch(() => null);
    if (recent) {
      for (const m of recent.values()) {
        if (m.author.id === message.author.id && now - m.createdTimestamp < SPAM_WINDOW) {
          await m.delete().catch(() => null);
        }
      }
    }
    await sendLog(
      message.guild,
      logEmbed('🛡️ Anti-spam', `<@${message.author.id}> rendu muet 5 min pour spam dans <#${message.channelId}>.`, COLORS.WARNING)
    );
    return true;
  }
  return false;
}

module.exports = { guard };
