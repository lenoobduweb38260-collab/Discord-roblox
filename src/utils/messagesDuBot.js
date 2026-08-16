const { AuditLogEvent } = require('discord.js');
const { db } = require('../database');

// 🛡️ Quand quelqu'un efface un message du bot.
//
// Discord ne donne aucun moyen d'empêcher cela : la permission « Gérer les
// messages » autorise à supprimer n'importe quel message d'un salon, y compris
// ceux d'un bot, et aucun réglage côté bot ne prime dessus. Promettre le
// contraire serait mentir.
//
// Ce que le bot peut faire, en revanche, rend la suppression sans intérêt :
//
//  1. **La nommer.** La suppression était jusqu'ici totalement muette — le
//     journal ignorait les messages de bot. Un panneau disparaissait, et rien
//     n'indiquait ni quand, ni par qui.
//  2. **La défaire.** Un panneau (tickets, listes RP, message composé) est
//     REPUBLIÉ automatiquement, avec sa référence remise à jour. Effacer un
//     panneau ne le fait donc plus disparaître : il revient.
//
// En message privé, personne d'autre que le bot ne peut supprimer ses
// messages — mais le créateur du bot est prévenu si cela arrive quand même,
// parce qu'un cas impossible qui se produit mérite d'être vu.

const panneauTicket = db.prepare('SELECT * FROM ticket_panels WHERE channel_id = ? AND message_id = ?');
const panneauRp = db.prepare('SELECT * FROM rp_boards WHERE channel_id = ? AND message_id = ?');
const messageCompose = db.prepare('SELECT * FROM composed_messages WHERE channel_id = ? AND message_id = ?');

// Le journal d'audit agrège les suppressions de messages : on cherche donc une
// entrée récente visant le même salon, plutôt qu'un identifiant de message
// (que Discord n'y met pas).
async function quiAEfface(guild, channelId) {
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 6 });
    const recent = [...logs.entries.values()].find((e) => {
      if (String(e.extra?.channel?.id || e.extra?.channelId || '') !== String(channelId)) return false;
      // Une entrée d'audit vieille de plus d'une minute parle d'autre chose.
      return Date.now() - e.createdTimestamp < 60000;
    });
    if (!recent?.executor) return null;
    return { id: recent.executor.id, tag: recent.executor.tag || null };
  } catch {
    // Sans la permission « Voir le journal d'audit », on ne saura pas qui.
    return null;
  }
}

// De quelle sorte de message s'agit-il, et sait-on le remettre ?
function reconnaitre(message) {
  const salon = String(message.channelId);
  const id = String(message.id);
  if (panneauTicket.get(salon, id)) return { genre: 'panneau de tickets', republiable: true };
  if (panneauRp.get(salon, id)) return { genre: 'liste RP', republiable: true };
  if (messageCompose.get(salon, id)) return { genre: 'message composé', republiable: true };
  return { genre: null, republiable: false };
}

// 🔁 Remet le message en place. Renvoie l'explication à écrire dans le
// journal, ou null si rien n'a été republié.
//
// Chaque module sait republier le sien et remettre sa référence à jour : on
// ne réimplémente rien ici, on appelle. Une republication ratée n'empêche
// jamais le journal de partir.
async function republier(message) {
  const salon = String(message.channelId);
  const id = String(message.id);
  try {
    const ticket = panneauTicket.get(salon, id);
    if (ticket) {
      const T = require('./tickets');
      const neuf = await message.channel.send(T.buildPanelPayload(message.guild.id, JSON.parse(ticket.options || '{}')))
        .catch(() => null);
      if (!neuf) return null;
      // La référence doit suivre, sinon « modifier le panneau » répondrait
      // « panneau introuvable » et le panneau deviendrait décoratif.
      T.reenregistrerPanneau(message.guild.id, id, message.channel.id, neuf.id);
      return '🔁 Le panneau de tickets a été **republié automatiquement**.';
    }
    const board = panneauRp.get(salon, id);
    if (board) {
      const L = require('./rpList');
      const neuf = await L.postBoard(board.kind, message.channel, message.guild.id).catch(() => null);
      return neuf ? '🔁 La liste RP a été **republiée automatiquement**.' : null;
    }
  } catch (err) {
    console.warn(`⚠️ Republication impossible après suppression : ${err.message}`);
  }
  return null;
}

module.exports = { quiAEfface, reconnaitre, republier };
