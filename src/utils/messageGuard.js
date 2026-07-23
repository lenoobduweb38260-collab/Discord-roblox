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

// Renvoie true si le message a été traité (supprimé / auteur sanctionné).
async function guard(message, cfg) {
  if (staffExempt(message, cfg)) return false;
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

  // 2) Anti-spam (fréquence)
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
