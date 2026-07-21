const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { db } = require('../database');
const { generateCardId } = require('../utils/ids');
const { buildCardEmbed, sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { GRADES, getGrade } = require('../utils/permissions');

const insertCard = db.prepare(`
  INSERT INTO identity_cards
    (card_id, guild_id, user_id, rp_nom, rp_prenom, sexe, lieu_naissance, date_naissance,
     pseudo_roblox, pseudo_discord, nationalite, background, photo_url, created_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const getCardByUser = db.prepare('SELECT * FROM identity_cards WHERE guild_id = ? AND user_id = ?');
const getCardById = db.prepare('SELECT * FROM identity_cards WHERE guild_id = ? AND card_id = ?');
const searchByDiscordName = db.prepare(
  "SELECT * FROM identity_cards WHERE guild_id = ? AND pseudo_discord LIKE ? LIMIT 5"
);
const deleteCard = db.prepare('DELETE FROM identity_cards WHERE guild_id = ? AND user_id = ?');

const EDITABLE_FIELDS = {
  nom: 'rp_nom',
  prenom: 'rp_prenom',
  sexe: 'sexe',
  lieu_naissance: 'lieu_naissance',
  date_naissance: 'date_naissance',
  pseudo_roblox: 'pseudo_roblox',
  nationalite: 'nationalite',
  background: 'background',
  photo: 'photo_url',
};

module.exports = {
  module: 'rp', // fait partie du Module RP activable dans /config
  grade: GRADES.EVERYONE, // contrôle fin par sous-commande dans execute()
  data: new SlashCommandBuilder()
    .setName('carte')
    .setDescription("Système de carte d'identité RP")
    .addSubcommand((sub) =>
      sub
        .setName('creer')
        .setDescription("[Staff] Créer la carte d'identité d'un membre")
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre concerné').setRequired(true))
        .addStringOption((o) => o.setName('nom').setDescription('Nom RP').setRequired(true))
        .addStringOption((o) => o.setName('prenom').setDescription('Prénom RP').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('sexe')
            .setDescription('Sexe')
            .setRequired(true)
            .addChoices(
              { name: 'Homme', value: 'Homme' },
              { name: 'Femme', value: 'Femme' },
              { name: 'Autre', value: 'Autre' }
            )
        )
        .addStringOption((o) => o.setName('lieu_naissance').setDescription('Lieu de naissance').setRequired(true))
        .addStringOption((o) => o.setName('date_naissance').setDescription('Date de naissance (JJ/MM/AAAA)').setRequired(true))
        .addStringOption((o) => o.setName('pseudo_roblox').setDescription('Pseudo Roblox').setRequired(true))
        .addStringOption((o) => o.setName('nationalite').setDescription('Nationalité').setRequired(true))
        .addStringOption((o) => o.setName('background').setDescription('Background / histoire RP').setRequired(false))
        .addAttachmentOption((o) => o.setName('photo').setDescription('Photo d\'identité (image/GIF)').setRequired(false))
        .addStringOption((o) => o.setName('photo_url').setDescription('URL de la photo (image/GIF)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('voir')
        .setDescription("Afficher une carte d'identité")
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre (défaut : vous)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('chercher')
        .setDescription("[Staff] Retrouver une carte par ID Discord, ID de carte ou nom Discord")
        .addStringOption((o) => o.setName('id_discord').setDescription('ID Discord du membre').setRequired(false))
        .addStringOption((o) => o.setName('id_carte').setDescription('ID de la carte (ex : CNI-XXXXXXXX)').setRequired(false))
        .addStringOption((o) => o.setName('nom_discord').setDescription('Pseudo Discord (recherche partielle)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('modifier')
        .setDescription("[Staff] Modifier un champ d'une carte")
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre concerné').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('champ')
            .setDescription('Champ à modifier')
            .setRequired(true)
            .addChoices(...Object.keys(EDITABLE_FIELDS).map((f) => ({ name: f, value: f })))
        )
        .addStringOption((o) => o.setName('valeur').setDescription('Nouvelle valeur').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('supprimer')
        .setDescription("[Staff] Supprimer la carte d'identité d'un membre")
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre concerné').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const isStaff = getGrade(interaction.member) >= GRADES.STAFF;

    if (sub !== 'voir' && !isStaff) {
      return interaction.reply({
        content: '⛔ Sécurité : cette sous-commande est réservée au **staff**.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'creer') {
      const user = interaction.options.getUser('utilisateur');
      if (getCardByUser.get(interaction.guildId, user.id)) {
        return interaction.reply({
          content: `❌ <@${user.id}> possède déjà une carte d'identité. Utilisez \`/carte modifier\` ou \`/carte supprimer\`.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      const attachment = interaction.options.getAttachment('photo');
      const photoUrl = attachment?.url || interaction.options.getString('photo_url') || null;
      const cardId = generateCardId();
      const card = {
        card_id: cardId,
        guild_id: interaction.guildId,
        user_id: user.id,
        rp_nom: interaction.options.getString('nom'),
        rp_prenom: interaction.options.getString('prenom'),
        sexe: interaction.options.getString('sexe'),
        lieu_naissance: interaction.options.getString('lieu_naissance'),
        date_naissance: interaction.options.getString('date_naissance'),
        pseudo_roblox: interaction.options.getString('pseudo_roblox'),
        pseudo_discord: user.username,
        nationalite: interaction.options.getString('nationalite'),
        background: interaction.options.getString('background'),
        photo_url: photoUrl,
        created_by: interaction.user.id,
        created_at: new Date().toISOString(),
      };
      insertCard.run(
        card.card_id, card.guild_id, card.user_id, card.rp_nom, card.rp_prenom, card.sexe,
        card.lieu_naissance, card.date_naissance, card.pseudo_roblox, card.pseudo_discord,
        card.nationalite, card.background, card.photo_url, card.created_by, card.created_at
      );
      await interaction.reply({
        content: `✅ Carte créée pour <@${user.id}> — ID : \`${cardId}\``,
        embeds: [buildCardEmbed(card, user)],
      });
      await sendLog(
        interaction.guild,
        logEmbed('🪪 Carte créée', `Carte \`${cardId}\` créée pour <@${user.id}> par <@${interaction.user.id}>.`, COLORS.SUCCESS)
      );
      return;
    }

    if (sub === 'voir') {
      const user = interaction.options.getUser('utilisateur') || interaction.user;
      const card = getCardByUser.get(interaction.guildId, user.id);
      if (!card) {
        return interaction.reply({
          content: `❌ Aucune carte d'identité trouvée pour <@${user.id}>.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.reply({ embeds: [buildCardEmbed(card, user)] });
    }

    if (sub === 'chercher') {
      const idDiscord = interaction.options.getString('id_discord');
      const idCarte = interaction.options.getString('id_carte');
      const nomDiscord = interaction.options.getString('nom_discord');
      if (!idDiscord && !idCarte && !nomDiscord) {
        return interaction.reply({
          content: '❌ Indiquez au moins un critère : `id_discord`, `id_carte` ou `nom_discord`.',
          flags: MessageFlags.Ephemeral,
        });
      }
      let cards = [];
      if (idDiscord) {
        const card = getCardByUser.get(interaction.guildId, idDiscord.trim());
        if (card) cards.push(card);
      } else if (idCarte) {
        const card = getCardById.get(interaction.guildId, idCarte.trim().toUpperCase());
        if (card) cards.push(card);
      } else {
        cards = searchByDiscordName.all(interaction.guildId, `%${nomDiscord.trim()}%`);
      }
      if (!cards.length) {
        return interaction.reply({ content: '❌ Aucune carte trouvée avec ces critères.', flags: MessageFlags.Ephemeral });
      }
      const embeds = [];
      for (const card of cards.slice(0, 3)) {
        const user = await interaction.client.users.fetch(card.user_id).catch(() => null);
        embeds.push(buildCardEmbed(card, user));
      }
      return interaction.reply({
        content: cards.length > 3 ? `🔎 ${cards.length} résultats, affichage des 3 premiers.` : `🔎 ${cards.length} résultat(s).`,
        embeds,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'modifier') {
      const user = interaction.options.getUser('utilisateur');
      const champ = interaction.options.getString('champ');
      const valeur = interaction.options.getString('valeur');
      const card = getCardByUser.get(interaction.guildId, user.id);
      if (!card) {
        return interaction.reply({ content: `❌ <@${user.id}> n'a pas de carte d'identité.`, flags: MessageFlags.Ephemeral });
      }
      const column = EDITABLE_FIELDS[champ];
      db.prepare(`UPDATE identity_cards SET ${column} = ? WHERE guild_id = ? AND user_id = ?`).run(
        valeur, interaction.guildId, user.id
      );
      const updated = getCardByUser.get(interaction.guildId, user.id);
      await interaction.reply({
        content: `✅ Champ **${champ}** mis à jour pour <@${user.id}>.`,
        embeds: [buildCardEmbed(updated, user)],
      });
      await sendLog(
        interaction.guild,
        logEmbed('🪪 Carte modifiée', `Carte \`${card.card_id}\` : champ **${champ}** modifié par <@${interaction.user.id}>.`, COLORS.INFO)
      );
      return;
    }

    if (sub === 'supprimer') {
      const user = interaction.options.getUser('utilisateur');
      const card = getCardByUser.get(interaction.guildId, user.id);
      if (!card) {
        return interaction.reply({ content: `❌ <@${user.id}> n'a pas de carte d'identité.`, flags: MessageFlags.Ephemeral });
      }
      deleteCard.run(interaction.guildId, user.id);
      await interaction.reply({ content: `🗑️ Carte \`${card.card_id}\` de <@${user.id}> supprimée.` });
      await sendLog(
        interaction.guild,
        logEmbed('🪪 Carte supprimée', `Carte \`${card.card_id}\` de <@${user.id}> supprimée par <@${interaction.user.id}>.`, COLORS.DANGER)
      );
    }
  },
};
