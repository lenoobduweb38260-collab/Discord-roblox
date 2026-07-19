const crypto = require('crypto');
const { db } = require('../database');
const { sendLog, logEmbed, COLORS } = require('./embeds');

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

// Analyse les pièces jointes d'un message ; supprime + bannit en cas de
// correspondance. Renvoie true si le message a été traité comme scam.
async function scanMessage(message) {
  const samples = listSamples.all(message.guildId);
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

    await message.delete().catch(() => null);
    const banned = await message.guild.members
      .ban(message.author.id, {
        reason: `Image scam détectée (échantillon n°${match.id}${match.name ? ` « ${match.name} »` : ''})`,
        deleteMessageSeconds: 86400,
      })
      .then(() => true)
      .catch(() => false);
    await sendLog(
      message.guild,
      logEmbed(
        '🚨 Image scam détectée',
        `<@${message.author.id}> (\`${message.author.id}\`) a posté une image correspondant à l'échantillon ` +
          `n°${match.id}${match.name ? ` « ${match.name} »` : ''} dans <#${message.channelId}>.\n` +
          `Message supprimé — ${banned ? '**membre banni** (messages des dernières 24 h purgés)' : '⚠️ ban impossible (permissions/hiérarchie)'}.`,
        COLORS.DANGER
      )
    );
    return true;
  }
  return false;
}

module.exports = { listSamples, insertSample, deleteSample, getSample, hashesFor, downloadImage, scanMessage, MAX_SIZE };
