const { AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { db } = require('../database');

// 📎 Archiver la pièce jointe d'un message supprimé — sans limite de taille.
//
// Le problème de départ : un lien de pièce jointe Discord est signé et meurt
// avec son message. Noter l'URL revient à ne rien garder — quelques minutes
// après la suppression, le journal n'affiche plus qu'un lien mort, c'est-à-dire
// la preuve disparue au moment précis où l'on en aurait besoin.
//
// Le fichier est donc TÉLÉCHARGÉ et ÉCRIT SUR L'HÉBERGEUR, quelle que soit sa
// taille. La base ne stocke que la fiche : qui, quand, où, et le chemin.
//
// Pourquoi pas le fichier lui-même en base ? Un SQLite gonflé de vidéos de
// 200 Mo devient lent pour TOUT le bot — chaque lecture de configuration
// traînerait le poids des archives. Le disque sait faire ça, pas une base.
//
// ⚠️ Deux plafonds subsistent, et ils n'ont rien à voir avec la taille d'un
// fichier :
//
//  • Discord refuse d'afficher un fichier au-delà de sa limite de
//    téléversement (10 Mo sans boost). Au-delà, le fichier est archivé quand
//    même : il est simplement référencé au lieu d'être ré-affiché.
//  • Le disque de l'hébergeur est fini. Sans budget total, le bot finirait
//    par le remplir et s'arrêter. Le budget est large et réglable ; quand il
//    est atteint, les archives les PLUS ANCIENNES sont effacées d'abord.

const baseDir =
  process.env.BOT_DIR?.trim() || (process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..', '..'));
const DOSSIER = process.env.ARCHIVES_DIR?.trim() || path.join(baseDir, 'archives-pieces-jointes');

// Limite de téléversement d'un bot sur un serveur sans boost. Ce n'est PAS une
// limite d'archivage : seulement le seuil au-delà duquel Discord ne peut plus
// réafficher le fichier dans le journal.
const AFFICHABLE_MAX = 10 * 1024 * 1024;

// Budget disque total, en octets. Généreux par défaut ; réglable par variable
// d'environnement pour un hébergeur plus petit ou plus grand.
const BUDGET = Math.max(0, Number(process.env.ARCHIVES_BUDGET_MO || 5000)) * 1024 * 1024;
// Une archive plus vieille que cela ne sert plus à personne. 0 = sans durée.
const RETENTION_JOURS = Math.max(0, Number(process.env.ARCHIVES_JOURS || 90));

// Un téléchargement volumineux prend du temps ; le journal, lui, ne doit pas
// attendre. Ce délai est donc large — il protège d'un serveur muet, pas d'un
// gros fichier.
const DELAI = 120000;
const MAX_FICHIERS = 10; // Discord n'accepte pas plus de 10 fichiers par message

db.exec(`CREATE TABLE IF NOT EXISTS attachment_archive (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  channel_id   TEXT,
  message_id   TEXT,
  author_id    TEXT,
  name         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  content_type TEXT,
  chemin       TEXT NOT NULL,
  created_at   TEXT NOT NULL
)`);
try { db.exec('CREATE INDEX IF NOT EXISTS idx_archive_guild ON attachment_archive (guild_id, created_at)'); } catch {}

const insererArchive = db.prepare(
  `INSERT INTO attachment_archive (guild_id, channel_id, message_id, author_id, name, size, content_type, chemin, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const totalOctets = db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM attachment_archive');
const plusAnciennes = db.prepare('SELECT id, chemin, size FROM attachment_archive ORDER BY created_at ASC LIMIT ?');
const perimees = db.prepare('SELECT id, chemin FROM attachment_archive WHERE created_at < ?');
const supprimerArchive = db.prepare('DELETE FROM attachment_archive WHERE id = ?');
const listerArchives = db.prepare(
  'SELECT * FROM attachment_archive WHERE guild_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
);
const archiveParId = db.prepare('SELECT * FROM attachment_archive WHERE id = ?');

const nomDe = (p) => String(p?.name || 'fichier').split('?')[0];

function tailleLisible(octets) {
  const n = Number(octets) || 0;
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

const estImage = (p) =>
  /^image\//i.test(String(p?.contentType || '')) || /\.(png|jpe?g|gif|webp|avif)$/i.test(nomDe(p));

// Un nom de fichier sûr : rien qui puisse sortir du dossier d'archives.
// « ../../etc/passwd » ne doit jamais devenir un chemin d'écriture.
function nomSurLeDisque(guildId, messageId, nom) {
  const propre = String(nom)
    .replace(/[/\\]/g, '_')
    .replace(/^\.+/, '_')
    .replace(/[^\w.\- ]/g, '_')
    .slice(-120) || 'fichier';
  return path.join(DOSSIER, String(guildId), `${messageId || Date.now()}-${propre}`);
}

// 🧹 Fait de la place : d'abord les archives périmées, puis les plus
// anciennes tant que le budget est dépassé.
function menageArchives() {
  try {
    if (RETENTION_JOURS > 0) {
      const limite = new Date(Date.now() - RETENTION_JOURS * 86400000).toISOString();
      for (const a of perimees.all(limite)) {
        fs.promises.unlink(a.chemin).catch(() => null);
        supprimerArchive.run(a.id);
      }
    }
    if (!BUDGET) return;
    let total = Number(totalOctets.get()?.n || 0);
    while (total > BUDGET) {
      const lot = plusAnciennes.all(20);
      if (!lot.length) break;
      for (const a of lot) {
        fs.promises.unlink(a.chemin).catch(() => null);
        supprimerArchive.run(a.id);
        total -= Number(a.size || 0);
        if (total <= BUDGET) break;
      }
    }
  } catch (err) {
    console.warn(`⚠️ Ménage des archives impossible : ${err.message}`);
  }
}

// Télécharge UNE pièce jointe et l'écrit sur le disque. Aucune limite de
// taille : c'est précisément ce qu'on veut conserver.
async function archiver(piece, contexte = {}) {
  if (!piece?.url) return null;
  const nom = nomDe(piece);
  const cible = nomSurLeDisque(contexte.guildId || 'inconnu', contexte.messageId, nom);

  const arret = new AbortController();
  const minuteur = setTimeout(() => arret.abort(), DELAI);
  try {
    const reponse = await fetch(piece.url, { signal: arret.signal });
    if (!reponse.ok) return null;
    const donnees = Buffer.from(await reponse.arrayBuffer());
    if (!donnees.length) return null;

    await fs.promises.mkdir(path.dirname(cible), { recursive: true });
    await fs.promises.writeFile(cible, donnees);

    insererArchive.run(
      String(contexte.guildId || ''),
      contexte.channelId ? String(contexte.channelId) : null,
      contexte.messageId ? String(contexte.messageId) : null,
      contexte.authorId ? String(contexte.authorId) : null,
      nom,
      donnees.length,
      piece.contentType || null,
      cible,
      new Date().toISOString()
    );

    return { nom, chemin: cible, taille: donnees.length, donnees, piece };
  } catch {
    // Lien déjà mort, réseau, disque plein : le journal partira sans.
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

// 📦 Archive les pièces jointes d'un message.
//
// Renvoie :
//   • fichiers → ceux que Discord peut réafficher dans le journal
//   • resume   → la ligne à écrire, archivés comme perdus
//   • apercu   → `attachment://…` de la première image réaffichable
async function sauvegarder(pieces, contexte = {}) {
  const liste = [...(pieces?.values?.() || pieces || [])].slice(0, MAX_FICHIERS);
  if (!liste.length) return { fichiers: [], resume: '', apercu: null, archives: [] };

  // En parallèle : un journal ne doit pas attendre six fois le même délai.
  const resultats = await Promise.all(
    liste.map((p) => archiver(p, contexte).then((a) => ({ piece: p, archive: a })))
  );

  const fichiers = [];
  const lignes = [];
  const archives = [];
  let apercu = null;

  for (const { piece, archive } of resultats) {
    const nom = nomDe(piece);
    if (!archive) {
      lignes.push(`❌ **${nom}** · ${tailleLisible(piece.size)} — le fichier n'était déjà plus accessible`);
      continue;
    }
    archives.push(archive);
    const taille = tailleLisible(archive.taille);

    if (archive.taille <= AFFICHABLE_MAX) {
      fichiers.push(new AttachmentBuilder(archive.donnees, { name: nom }));
      lignes.push(`✅ **${nom}** · ${taille}`);
      if (!apercu && estImage(piece)) apercu = `attachment://${nom}`;
    } else {
      // Archivé quand même — Discord ne peut simplement pas le réafficher.
      lignes.push(`💾 **${nom}** · ${taille} — archivé sur l'hébergeur (trop lourd pour être réaffiché ici)`);
    }
  }

  const restantes = (pieces?.size ?? liste.length) - liste.length;
  if (restantes > 0) lignes.push(`*… et ${restantes} pièce(s) jointe(s) de plus, non archivée(s)*`);

  // Le ménage APRÈS l'archivage : on ne veut pas effacer ce qu'on vient
  // d'écrire, et il ne doit jamais retarder le journal.
  setImmediate(menageArchives);

  return { fichiers, resume: lignes.join('\n'), apercu, archives };
}

// État des archives — pour le tableau de bord et le journal de démarrage.
function etatArchives() {
  const total = Number(totalOctets.get()?.n || 0);
  const nombre = Number(db.prepare('SELECT COUNT(*) AS n FROM attachment_archive').get()?.n || 0);
  return {
    nombre,
    octets: total,
    lisible: tailleLisible(total),
    budget: BUDGET,
    budgetLisible: BUDGET ? tailleLisible(BUDGET) : 'sans limite',
    retentionJours: RETENTION_JOURS,
    dossier: DOSSIER,
  };
}

module.exports = {
  sauvegarder, archiver, menageArchives, etatArchives,
  estImage, nomDe, tailleLisible, nomSurLeDisque,
  listerArchives, archiveParId,
  DOSSIER, AFFICHABLE_MAX, BUDGET, RETENTION_JOURS, DELAI, MAX_FICHIERS,
};
