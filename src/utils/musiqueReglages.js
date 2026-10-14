const { getGuildConfig } = require('../database');

// 🎵 Les réglages musique d'un serveur — lus par la session, les commandes
// (/musique, /radio) et le panneau /config. Un seul endroit qui les
// interprète : trois lectures maison auraient fini par diverger.

function idsJson(valeur) {
  try {
    const liste = JSON.parse(valeur || '[]');
    return Array.isArray(liste) ? liste.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// Les salons où les commandes musique sont AUTORISÉES. Vide = partout.
function salonsCommandes(guildId) {
  return idsJson(getGuildConfig(guildId).musique_channel_ids);
}

// Le salon de la carte « en cours de lecture » — null = celui de la commande.
function salonAnnonces(guildId) {
  return getGuildConfig(guildId).musique_annonce_channel_id || null;
}

// null si la commande est au bon endroit — sinon le refus, prêt à afficher.
// Le message renvoie vers les bons salons : « pas ici » tout court laisserait
// chercher.
function refusSalon(interaction) {
  if (!interaction.guildId) return null;
  const salons = salonsCommandes(interaction.guildId);
  if (!salons.length || salons.includes(String(interaction.channelId))) return null;
  return `⛔ Les commandes musique se font dans ${salons.map((id) => `<#${id}>`).join(' ')}.`;
}

module.exports = { salonsCommandes, salonAnnonces, refusSalon };
