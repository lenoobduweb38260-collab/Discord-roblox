const crypto = require('crypto');
const { db, RP_SCOPE } = require('../database');
const { sendLog, logEmbed, COLORS } = require('./embeds');

// Portée globale des échantillons : ceux ajoutés par le créateur valent sur
// TOUS les serveurs du bot (même sentinelle 'GLOBAL' que l'identité RP).
const GLOBAL_SCOPE = RP_SCOPE;

// Détection d'images scam par échantillons : chaque échantillon est stocké
// avec son empreinte exacte (SHA-256) et son empreinte perceptuelle (dHash
// 64 bits). Une image postée est bannie si elle est identique (SHA) ou
// visuellement quasi identique (distance de Hamming ≤ THRESHOLD) — cela
// attrape les recompressions et légères retouches des images scam.

const THRESHOLD = 5; // sur 64 bits : très conservateur pour éviter les faux positifs
const MAX_SIZE = 10 * 1024 * 1024;

const listSamples = db.prepare('SELECT * FROM scam_images WHERE guild_id = ? ORDER BY id');
const insertSample = db.prepare(
  'INSERT INTO scam_images (guild_id, name, sha256, dhash, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)'
);
const deleteSample = db.prepare('DELETE FROM scam_images WHERE id = ? AND guild_id = ?');
const getSample = db.prepare('SELECT * FROM scam_images WHERE id = ? AND guild_id = ?');
const getSampleById = db.prepare('SELECT * FROM scam_images WHERE id = ?');
const listGlobalSamples = db.prepare('SELECT * FROM scam_images WHERE guild_id = ? ORDER BY id');

// jimp est optionnel : sans lui, la détection retombe sur l'empreinte exacte.
let Jimp = null;
try {
  Jimp = require('jimp');
} catch {
  console.warn('⚠️ jimp indisponible : détection scam limitée aux images strictement identiques.');
}

async function dhashOf(buffer) {
  if (!Jimp) return null;
  try {
    const img = await Jimp.read(buffer);
    img.resize(9, 8).greyscale();
    let bits = '';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const left = Jimp.intToRGBA(img.getPixelColor(x, y)).r;
        const right = Jimp.intToRGBA(img.getPixelColor(x + 1, y)).r;
        bits += left > right ? '1' : '0';
      }
    }
    return bits;
  } catch {
    return null; // format non décodable (ex. webp) : SHA-256 uniquement
  }
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length && i < b.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

async function hashesFor(buffer) {
  return {
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    dhash: await dhashOf(buffer),
  };
}

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

// Analyse les pièces jointes d'un message ; en cas de correspondance :
// preuves téléchargées, message supprimé, auteur BLACKLISTÉ (ban partout +
// re-ban automatique à l'arrivée + MP avec le serveur de déban), images
// republiées en preuve. Renvoie true si le message a été traité comme scam.
async function scanMessage(message) {
  // Échantillons de CE serveur + échantillons globaux (ajoutés par le créateur,
  // valables partout).
  const samples = [...listSamples.all(message.guildId), ...listGlobalSamples.all(GLOBAL_SCOPE)];
  if (!samples.length) return false;

  for (const att of message.attachments.values()) {
    if (!att.contentType?.startsWith('image/') || att.size > MAX_SIZE) continue;
    const buffer = await downloadImage(att.url).catch(() => null);
    if (!buffer) continue;
    const { sha256, dhash } = await hashesFor(buffer);
    const match = samples.find(
      (s) => s.sha256 === sha256 || (dhash && s.dhash && hamming(dhash, s.dhash) <= THRESHOLD)
    );
    if (!match) continue;

    const { isImmune, applyBlacklist } = require('./botTeam');

    // 🛡️ Immunité : le créateur qui reposte un échantillon pour tester (ou un
    // ID protégé) ne doit pas se blacklister lui-même. L'affiche est effacée,
    // personne n'est sanctionné — et le journal dit pourquoi.
    if (await isImmune(message.client, message.author.id)) {
      await message.delete().catch(() => null);
      await sendLog(
        message.guild,
        logEmbed(
          '🚨 Affiche de scam effacée — membre immunisé',
          `<@${message.author.id}> (\`${message.author.id}\`) a posté une image correspondant à l'échantillon ` +
            `n°${match.id}${match.name ? ` « ${match.name} »` : ''} dans <#${message.channelId}>.\n` +
            '🛡️ Membre **immunisé** (créateur du bot ou liste d\'immunité) : l\'affiche est supprimée, aucune sanction.',
          COLORS.WARNING
        )
      );
      return true;
    }

    // 📸 LA PREUVE D'ABORD. Les URL des pièces jointes meurent avec le
    // message, et la purge du ban efface ses autres messages partout : tout
    // ce qui n'est pas téléchargé MAINTENANT est perdu. On garde TOUTES ses
    // images (l'image fautive est déjà en mémoire), dans la limite des 10
    // fichiers d'un message Discord.
    const preuves = [{ nom: att.name || 'preuve-1.png', donnees: buffer }];
    for (const piece of message.attachments.values()) {
      if (piece.id === att.id) continue;
      if (!piece.contentType?.startsWith('image/') || piece.size > MAX_SIZE) continue;
      if (preuves.length >= 10) break;
      const donnees = await downloadImage(piece.url).catch(() => null);
      if (donnees) preuves.push({ nom: piece.name || `preuve-${preuves.length + 1}.png`, donnees });
    }

    await message.delete().catch(() => null);

    // 🚫 Blacklist AUTOMATIQUE : enregistrement + MP (raison + serveur de
    // déban) + ban sur tous les serveurs avec purge 24 h (ses affiches
    // partent avec lui) + re-ban à toute arrivée future. Un seul circuit,
    // historisé avec la preuve — et annulable d'un seul geste : /unban-bl.
    const reason = `Affiche de scam détectée (échantillon n°${match.id}${match.name ? ` « ${match.name} »` : ''})`;
    const proof = `${preuves.length} image(s) archivée(s) depuis #${message.channel?.name || message.channelId} — serveur ${message.guild?.name || message.guildId}`;
    const resultat = await applyBlacklist(
      message.client, message.author.id, reason, message.client.user.id, proof, { purgeSeconds: 86400 }
    );

    // Les images repartent en pièces jointes du journal — un AttachmentBuilder
    // NEUF par envoi : un builder consommé ne se renvoie pas.
    const { AttachmentBuilder } = require('discord.js');
    const fichiersPour = () => preuves.map((p) => new AttachmentBuilder(p.donnees, { name: p.nom }));

    const embed = logEmbed(
      '🚨 Affiche de scam — blacklist automatique',
      `<@${message.author.id}> (\`${message.author.id}\`) a posté une image correspondant à l'échantillon ` +
        `n°${match.id}${match.name ? ` « ${match.name} »` : ''} dans <#${message.channelId}>.\n` +
        `🚫🔨 **Blacklisté automatiquement** : banni sur **${resultat.banned}** serveur(s), re-banni à toute ` +
        `arrivée future, messages des dernières 24 h supprimés${resultat.dmOk ? ', prévenu en MP' : ''}.\n` +
        `📸 Ses **${preuves.length}** image(s) sont jointes en preuve.\n` +
        'Annulable par le staff du bot : `/unban-bl`.',
      COLORS.DANGER
    );
    await sendLog(message.guild, embed, fichiersPour());

    // 🖼️ Le salon des preuves (⚙️ /config → Salons), s'il est configuré,
    // reçoit aussi les images : c'est lui que le staff du bot relit.
    try {
      const cfg = require('../database').getGuildConfig(message.guildId);
      if (cfg?.proof_channel_id) {
        const salon = await message.guild.channels.fetch(cfg.proof_channel_id).catch(() => null);
        if (salon?.isTextBased?.()) {
          await salon.send({ embeds: [embed], files: fichiersPour(), allowedMentions: { parse: [] } }).catch(() => null);
        }
      }
    } catch { /* la preuve au journal suffit */ }
    return true;
  }
  return false;
}

module.exports = {
  listSamples,
  listGlobalSamples,
  insertSample,
  deleteSample,
  getSample,
  getSampleById,
  hashesFor,
  downloadImage,
  scanMessage,
  MAX_SIZE,
  GLOBAL_SCOPE,
};
