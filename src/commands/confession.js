const { SlashCommandBuilder } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const C = require('../utils/confessions');
const { repondreVite } = require('../utils/reponse');

// 💌 /confession — une confession anonyme.
//
// La réponse à la commande est ÉPHÉMÈRE (commande non publique) : seul
// l'auteur la voit. La confession elle-même part par un envoi dans le salon,
// sans aucune trace de son auteur. Celles qui parlent de suicide, de menace
// ou d'insulte attendent la relecture du staff du bot (voir utils/confessions).

const ATTENTE = 60 * 1000; // une confession par minute et par personne
const derniere = new Map();

const AIDE_COURTE = '\n\n🫶 **Si ça ne va pas, tu n\'es pas seul·e.** Appelle le **3114** (France, gratuit, 24 h/24) ou le **15**/**112** en cas d\'urgence. Ailleurs : https://findahelpline.com';

module.exports = {
  grade: GRADES.EVERYONE,
  guildModule: 'confession', // désactivé par défaut, activable dans /config → 🎉 Communauté
  data: new SlashCommandBuilder()
    .setName('confession')
    .setDescription('Envoyer une confession anonyme dans le salon des confessions 💌')
    .addStringOption((o) =>
      o.setName('texte').setDescription('Ta confession (elle sera publiée sans ton nom)').setRequired(true).setMaxLength(1000)
    ),

  async execute(interaction) {
    const salonId = C.salonConfessions(interaction.guildId);
    if (!salonId) {
      return interaction.reply({ content: '📭 Les confessions ne sont pas ouvertes sur ce serveur : un administrateur choisit leur salon dans `/config` → 🎉 Communauté.' });
    }

    const cle = `${interaction.guildId}:${interaction.user.id}`;
    const reste = ATTENTE - (Date.now() - (derniere.get(cle) || 0));
    if (reste > 0) {
      return interaction.reply({ content: `⏳ Une confession par minute : réessaie dans ${Math.ceil(reste / 1000)} s.` });
    }

    const texte = interaction.options.getString('texte').trim();
    if (!texte) return interaction.reply({ content: '✍️ Ta confession est vide : écris quelque chose.' });
    derniere.set(cle, Date.now());

    // L'envoi au salon (ou au QG) peut traîner : file d'attente de Discord,
    // API lente. Répondre seulement APRÈS laissait passer les 3 secondes —
    // la confession partait, mais l'auteur lisait « L'application ne répond
    // pas » et la renvoyait. `repondreVite` ne diffère qu'au dernier moment,
    // et en éphémère : la réponse ne dit qu'à l'auteur ce qu'il a écrit.
    return repondreVite(interaction, () => traiter(interaction, { salonId, texte, cle }), { ephemere: true });
  },
};

async function traiter(interaction, { salonId, texte, cle }) {
  const { categories } = C.detecter(texte);
  const aide = categories.includes('suicide') ? AIDE_COURTE : '';

  // Propre : publiée tout de suite, sans auteur.
  if (!categories.length) {
    const confession = C.enregistrer({ guild: interaction.guild, salonId, auteur: interaction.user, texte, categories, statut: 'en_revue' });
    const r = await C.publier(interaction.client, confession);
    if (!r.ok) {
      derniere.delete(cle);
      C.oublier(confession.id);
      return {
        content: r.raison === 'salon'
          ? '📭 Le salon des confessions n\'existe plus ou m\'est fermé : prévenez un administrateur (`/config` → 🎉 Communauté).'
          : '❌ Je n\'arrive pas à écrire dans le salon des confessions : un administrateur doit me donner la permission d\'y envoyer des messages.',
      };
    }
    return { content: `💌 Ta confession n°${r.numero} est publiée anonymement : ${r.url}` };
  }

  // Signalée : relue par le staff du bot avant toute publication.
  const confession = C.enregistrer({ guild: interaction.guild, salonId, auteur: interaction.user, texte, categories, statut: 'en_revue' });
  const parti = await C.signaler(interaction.client, confession, interaction.user);
  if (!parti) {
    return {
      content: `🕊️ Ta confession contient des mots qui demandent une relecture, mais l'équipe de relecture est injoignable pour le moment : elle n'est **pas** publiée. Tu peux la reformuler et la renvoyer.${aide}`,
    };
  }
  return {
    content: `🕊️ Ta confession sera relue par l'équipe du bot avant d'être publiée. Tu n'as rien d'autre à faire.${aide}`,
  };
}
