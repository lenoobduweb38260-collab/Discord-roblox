const { EmbedBuilder } = require('discord.js');
const { getGuildConfig, db } = require('../database');
const { themeDe } = require('./rpThemes');

// Entreprises (portée globale) où la personne est patron ou employé — sert à
// afficher son/ses métier(s) sur la carte d'identité.
const headEnterprisesOf = db.prepare(
  'SELECT e.name FROM enterprises e JOIN enterprise_heads h ON h.enterprise_id = e.id WHERE h.user_id = ? ORDER BY e.name COLLATE NOCASE'
);
const employeeEnterprisesOf = db.prepare(
  'SELECT e.name FROM enterprises e JOIN enterprise_employees emp ON emp.enterprise_id = e.id WHERE emp.user_id = ? ORDER BY e.name COLLATE NOCASE'
);

function enterprisesSummary(userId, theme = null) {
  try {
    const T = theme || themeDe(null);
    const heads = headEnterprisesOf.all(userId).map((r) => r.name);
    const emps = employeeEnterprisesOf.all(userId).map((r) => r.name);
    const parts = [];
    for (const name of heads) parts.push(`👑 **${name}** (${T.entreprise.patron})`);
    for (const name of emps) if (!heads.includes(name)) parts.push(`👥 **${name}** (${T.entreprise.membre})`);
    return parts.length ? parts.join('\n') : null;
  } catch {
    return null;
  }
}

// 🎨 PRIMARY et INFO ne sont PAS des choix esthétiques : ce sont des « je n'ai
// rien à dire de particulier ». styleEmbeds les reconnaît comme neutres et
// pose l'accent du serveur à la place — c'est ce qui fait qu'un embed sans
// intention prend les couleurs du serveur au lieu du bleu de Discord.
// SUCCESS / DANGER / WARNING, eux, portent un sens et ne sont jamais écrasés.
const COLORS = {
  PRIMARY: 0x5865f2,
  SUCCESS: 0x57f287,
  DANGER: 0xed4245,
  WARNING: 0xfee75e,
  INFO: 0x3498db,
};

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|avi)(\?.*)?$/i;
const GIF_HOSTS = /(tenor\.com|giphy\.com|gfycat\.com)/i;

// Les embeds Discord affichent images et GIF via setImage ; les vidéos ne
// peuvent pas être lues dans un embed, donc on renvoie l'URL à envoyer dans
// le contenu du message pour que Discord génère un lecteur vidéo.
function classifyMedia(url) {
  if (!url) return { type: 'none' };
  // Sécurité : setImage exige une vraie URL. Une valeur non-URL (ex : « non »
  // saisie à la place d'un lien) doit être ignorée, jamais transmise à
  // setImage (sinon Discord lève une erreur et casse l'affichage).
  if (!/^https?:\/\/\S+$/i.test(String(url).trim())) return { type: 'none' };
  if (VIDEO_EXT.test(url)) return { type: 'video', url };
  if (IMAGE_EXT.test(url) || GIF_HOSTS.test(url)) return { type: 'image', url };
  return { type: 'image', url }; // par défaut on tente l'image
}

// Applique le média à l'embed ; renvoie le contenu additionnel (URL vidéo) ou null.
function applyMedia(embed, url) {
  const media = classifyMedia(url);
  if (media.type === 'image') {
    embed.setImage(media.url);
    return null;
  }
  if (media.type === 'video') {
    return media.url;
  }
  return null;
}

function frDateTime(iso) {
  const date = new Date(iso);
  return date.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'long',
    timeStyle: 'short',
  });
}

function discordTs(iso, style = 'F') {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${style}>`;
}

// 🎮 Le vocabulaire suit le jeu du serveur : sur Arma la carte d'identité
// devient un livret matricule, sur Red Dead un registre de citoyen. Seuls les
// mots changent — les données, elles, sont les mêmes partout.
function buildCardEmbed(card, user, guildId = null) {
  const T = themeDe(guildId ?? card.guild_id);
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`${T.carte.emoji} ${T.carte.titre}`)
    .addFields(
      { name: `🆔 ${T.carte.numero}`, value: `\`${card.card_id}\``, inline: false },
      { name: '👤 Nom RP', value: card.rp_nom, inline: true },
      { name: 'Prénom RP', value: card.rp_prenom, inline: true },
      { name: '⚧ Sexe', value: card.sexe, inline: true },
      { name: `📍 ${T.carte.lieu}`, value: card.lieu_naissance, inline: true },
      { name: '🎂 Date de naissance', value: card.date_naissance, inline: true },
      { name: `🌍 ${T.carte.nationalite}`, value: card.nationalite, inline: true },
      { name: `${T.compte.emoji} ${T.compte.label}`, value: card.pseudo_roblox, inline: true },
      { name: '💬 Pseudo Discord', value: card.pseudo_discord, inline: true },
      { name: '🔢 ID Discord', value: `\`${card.user_id}\``, inline: true },
      { name: `📖 ${T.carte.histoire}`, value: card.background || '*Aucun*', inline: false },
    )
    .setFooter({ text: T.carte.pied(frDateTime(card.created_at)) });
  const jobs = enterprisesSummary(card.user_id, T);
  if (jobs) embed.addFields({ name: `${T.entreprise.emoji} ${T.entreprise.titre}(s)`, value: jobs.slice(0, 1024), inline: false });
  if (user) embed.setThumbnail(user.displayAvatarURL({ size: 256 }));
  if (card.photo_url) embed.setImage(card.photo_url);
  return embed;
}

function buildPermitEmbed(permit, user, guildId = null) {
  const T = themeDe(guildId ?? permit.guild_id);
  const valid = permit.valid === 1;
  const embed = new EmbedBuilder()
    .setColor(valid ? COLORS.SUCCESS : COLORS.DANGER)
    .setTitle(`${T.permis.emoji} ${T.permis.titre}`)
    .addFields(
      { name: '📛 Statut', value: valid ? '✅ Valide' : '❌ Invalide', inline: true },
      { name: `🔢 ${T.permis.numero}`, value: `\`${permit.permit_number}\``, inline: true },
      { name: `⭐ ${T.permis.points}`, value: `**${permit.points}**/12`, inline: true },
      { name: `👤 ${T.permis.titulaire}`, value: `<@${permit.user_id}>`, inline: true },
      {
        name: `📅 ${T.permis.delivre}`,
        value: `${frDateTime(permit.issued_at)} (${discordTs(permit.issued_at, 'R')})`,
        inline: true,
      },
    )
    .setFooter({ text: T.permis.pied });
  if (user) embed.setThumbnail(user.displayAvatarURL({ size: 256 }));
  return embed;
}

function buildEnterpriseEmbed(ent, headIds = [], employeeIds = [], guildId = null) {
  const T = themeDe(guildId ?? ent.guild_id);
  const types = JSON.parse(ent.insurance_types || '[]');
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle(`${T.entreprise.emoji} ${ent.name}`)
    .addFields(
      { name: '📝 Description', value: ent.description || '*Aucune*', inline: false },
      {
        name: `👑 ${T.entreprise.direction}`,
        value: headIds.length ? headIds.map((id) => `<@${id}>`).join(', ') : '*Aucune*',
        inline: true,
      },
      {
        name: `👥 ${T.entreprise.membres}`,
        value: employeeIds.length ? employeeIds.map((id) => `<@${id}>`).join(', ') : '*Aucun*',
        inline: true,
      },
      { name: '🛡️ Assurance', value: ent.insurance ? '✅ Oui' : '❌ Non', inline: true },
    )
    .setFooter({ text: `${T.entreprise.titre} n°${ent.id} • Créée le ${frDateTime(ent.created_at)}` });
  if (ent.insurance) {
    embed.addFields({
      name: '📋 Types d\'assurance',
      value: types.length ? types.map((t) => `➜ ${t}`).join('\n') : '*À définir*',
      inline: false,
    });
  }
  const extraContent = ent.media_url ? applyMedia(embed, ent.media_url) : null;
  return { embed, extraContent };
}

// Journal de sécurité : toute action staff est tracée dans le salon de logs configuré.
// `fichiers` : pièces jointes à renvoyer avec le journal — l'image d'un
// message supprimé, par exemple. Sans elles, le journal ne garderait qu'un
// lien qui meurt avec le message.
async function sendLog(guild, embed, fichiers = null) {
  try {
    const cfg = getGuildConfig(guild.id);
    if (!cfg.log_channel_id) return;
    const channel = await guild.channels.fetch(cfg.log_channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const corps = { embeds: [embed] };
    if (Array.isArray(fichiers) && fichiers.length) corps.files = fichiers;
    await channel.send(corps).catch(async (err) => {
      // Un fichier refusé (trop lourd pour ce serveur, format bloqué) ne doit
      // pas emporter le journal : on renvoie le texte seul.
      if (!corps.files) throw err;
      console.warn(`⚠️ Journal : pièces jointes non renvoyées — ${err.message}`);
      await channel.send({ embeds: [embed] }).catch(() => null);
    });
  } catch {
    // le log ne doit jamais faire échouer la commande
  }
}

function logEmbed(title, description, color = COLORS.INFO, fields = null) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
  // Champs facultatifs : pour un avant/après, ils séparent proprement les
  // deux textes là où une citation « >>> » avalerait tout le reste.
  if (Array.isArray(fields) && fields.length) embed.addFields(fields.slice(0, 25));
  return embed;
}

module.exports = {
  COLORS,
  classifyMedia,
  applyMedia,
  frDateTime,
  discordTs,
  buildCardEmbed,
  buildPermitEmbed,
  buildEnterpriseEmbed,
  sendLog,
  logEmbed,
};
