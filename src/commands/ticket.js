const { SlashCommandBuilder, ChannelType, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  listTypes,
  getTypeByLabel,
  insertType,
  deleteType,
  parseColor,
  supportRoleIds,
  safeEmoji,
  setTypeEnabled,
  openTicketFor,
  addMemberToTicket,
  startPanelCreate,
  startPanelModify,
} = require('../utils/tickets');
const { COLORS, sendLog, logEmbed } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');

// Récupère les options de commande du panneau (le TEXTE — titre, description,
// message, pied de page — se saisit ensuite dans un modal pour permettre les
// vrais retours à la ligne). L'image peut être une pièce jointe uploadée
// depuis le PC (photo/GIF) OU une URL.
function readPanelOptions(interaction) {
  const opts = {};
  for (const key of ['mode', 'ouverture', 'selecteur_texte', 'couleur']) {
    const value = interaction.options.getString(key);
    if (value !== null) opts[key] = value;
  }
  const imageFile = interaction.options.getAttachment('image');
  const imageUrl = interaction.options.getString('image_url');
  if (imageFile?.url || imageUrl) opts.image = imageFile?.url || imageUrl;
  const thumbFile = interaction.options.getAttachment('miniature');
  const thumbUrl = interaction.options.getString('miniature_url');
  if (thumbFile?.url || thumbUrl) opts.miniature = thumbFile?.url || thumbUrl;
  return opts;
}

// Important : Discord exige que les options OBLIGATOIRES précèdent les
// facultatives — le mode (requis pour /ticket panneau) vient donc en premier.
function addPanelOptions(sub, modeRequired, withSalon) {
  sub.addStringOption((o) =>
    o
      .setName('mode')
      .setDescription('Format du message du panneau')
      .setRequired(modeRequired)
      .addChoices({ name: 'Message basique', value: 'basique' }, { name: 'Embed personnalisable', value: 'embed' })
  );
  if (withSalon) {
    sub.addChannelOption((o) =>
      o.setName('salon').setDescription('Salon du panneau (défaut : ici)').addChannelTypes(ChannelType.GuildText).setRequired(false)
    );
  }
  return sub
    .addStringOption((o) =>
      o
        .setName('ouverture')
        .setDescription('Comment ouvrir un ticket : menu déroulant de raisons ou boutons')
        .setRequired(false)
        .addChoices({ name: '📋 Menu déroulant (sélecteur de raison)', value: 'menu' }, { name: '🔘 Boutons', value: 'boutons' })
    )
    .addStringOption((o) => o.setName('selecteur_texte').setDescription('Texte affiché dans le menu déroulant').setRequired(false))
    .addAttachmentOption((o) => o.setName('image').setDescription('Image/GIF de l\'embed — uploadée depuis votre PC').setRequired(false))
    .addStringOption((o) => o.setName('image_url').setDescription('…ou l\'URL de l\'image de l\'embed').setRequired(false))
    .addAttachmentOption((o) => o.setName('miniature').setDescription('Miniature de l\'embed — uploadée depuis votre PC').setRequired(false))
    .addStringOption((o) => o.setName('miniature_url').setDescription('…ou l\'URL de la miniature').setRequired(false))
    .addStringOption((o) => o.setName('couleur').setDescription('Couleur de l\'embed (hex, ex : #5865F2)').setRequired(false));
}

module.exports = {
  grade: GRADES.STAFF,
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('[Staff] Système de tickets : types, catégories et panneau')
      .addSubcommand((sub) =>
        sub
          .setName('type-ajouter')
          .setDescription('Ajouter un type de ticket (relié à une catégorie Discord)')
          .addStringOption((o) => o.setName('nom').setDescription('Nom du type (ex : Support, Plainte, Recrutement)').setRequired(true))
          .addChannelOption((o) =>
            o.setName('categorie').setDescription('Catégorie où créer les salons de ce type').addChannelTypes(ChannelType.GuildCategory).setRequired(true)
          )
          .addRoleOption((o) => o.setName('role_support').setDescription('Rôle qui voit et gère ces tickets').setRequired(false))
          .addRoleOption((o) => o.setName('role_support2').setDescription('2ᵉ rôle support (facultatif)').setRequired(false))
          .addRoleOption((o) => o.setName('role_support3').setDescription('3ᵉ rôle support (facultatif)').setRequired(false))
          .addStringOption((o) => o.setName('emoji').setDescription('Emoji du bouton/du sélecteur (ex : 🛠️)').setRequired(false))
          .addStringOption((o) => o.setName('description').setDescription('Description de la raison (affichée dans le menu déroulant)').setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName('type-retirer')
          .setDescription('Retirer un type de ticket')
          .addStringOption((o) => o.setName('nom').setDescription('Type à retirer').setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName('bloquer')
          .setDescription('Fermer temporairement une raison de ticket (plus ouvrable)')
          .addStringOption((o) => o.setName('nom').setDescription('Raison à bloquer').setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName('debloquer')
          .setDescription('Réactiver une raison de ticket bloquée')
          .addStringOption((o) => o.setName('nom').setDescription('Raison à réactiver').setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName('ajouter')
          .setDescription('Ajouter un membre au ticket courant (à utiliser dans le salon du ticket)')
          .addUserOption((o) => o.setName('membre').setDescription('Membre à ajouter au ticket').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName('creer-pour')
          .setDescription('Ouvrir un ticket au nom d\'un membre')
          .addUserOption((o) => o.setName('membre').setDescription('Membre pour qui ouvrir le ticket').setRequired(true))
          .addStringOption((o) => o.setName('raison').setDescription('Type / raison du ticket').setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((sub) => sub.setName('types').setDescription('Voir les types de tickets configurés'));
    builder.addSubcommand((sub) =>
      addPanelOptions(sub.setName('panneau').setDescription('Publier le panneau de tickets dans un salon'), true, true)
    );
    builder.addSubcommand((sub) =>
      addPanelOptions(
        sub.setName('panneau-modifier').setDescription('Modifier le dernier panneau publié (texte, embed, boutons)'),
        false,
        false
      )
    );
    return builder;
  })(),

  async autocomplete(interaction) {
    const sub = interaction.options.getSubcommand();
    const focused = interaction.options.getFocused().toLowerCase();
    let types = listTypes.all(interaction.guildId).filter((t) => t.label.toLowerCase().includes(focused));
    // « bloquer » ne propose que les raisons actives ; « debloquer » que les bloquées.
    if (sub === 'bloquer') types = types.filter((t) => t.enabled !== 0);
    else if (sub === 'debloquer') types = types.filter((t) => t.enabled === 0);
    await interaction.respond(
      types.slice(0, 25).map((t) => ({ name: `${t.enabled === 0 ? '🔒 ' : ''}${t.label}`.slice(0, 100), value: t.label }))
    );
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'type-ajouter') {
      const nom = interaction.options.getString('nom').trim().slice(0, 60);
      if (getTypeByLabel.get(interaction.guildId, nom)) {
        return interaction.reply({ content: `❌ Le type **${nom}** existe déjà.`, flags: MessageFlags.Ephemeral });
      }
      if (listTypes.all(interaction.guildId).length >= 25) {
        return interaction.reply({ content: '❌ Maximum 25 types de tickets (limite des boutons Discord).', flags: MessageFlags.Ephemeral });
      }
      const categorie = interaction.options.getChannel('categorie');
      const roles = ['role_support', 'role_support2', 'role_support3']
        .map((k) => interaction.options.getRole(k))
        .filter(Boolean);
      const roleIds = [...new Set(roles.map((r) => r.id))];
      // On ne stocke l'emoji QUE s'il est valide (emoji Unicode ou perso au bon
      // format) : un « :nom: » ou du texte casserait l'affichage du panneau.
      const emojiRaw = interaction.options.getString('emoji');
      const emoji = safeEmoji(emojiRaw) ? emojiRaw.trim() : null;
      const description = interaction.options.getString('description')?.slice(0, 100) || null;
      insertType.run(
        interaction.guildId, nom, emoji, categorie.id,
        roleIds[0] || null, description, roleIds.length ? JSON.stringify(roleIds) : null
      );
      await interaction.reply({
        content:
          `✅ Type **${emoji ? `${emoji} ` : ''}${nom}** créé → salons dans **${categorie.name}**` +
          `${roles.length ? `, géré par ${roles.map((r) => r.toString()).join(' ')}` : ''}.` +
          `${emojiRaw && !emoji ? '\n⚠️ L\'emoji fourni n\'était pas valide (utilisez un vrai emoji ou un emoji du serveur) : type créé **sans emoji**.' : ''}` +
          '\n💡 Pensez à republier ou modifier le panneau (`/ticket panneau`) pour afficher le nouveau bouton.',
      });
      await sendLog(
        interaction.guild,
        logEmbed('🎫 Type de ticket créé', `**${nom}** (catégorie ${categorie.name}) par <@${interaction.user.id}>.`, COLORS.SUCCESS)
      );
      return;
    }

    if (sub === 'type-retirer') {
      const nom = interaction.options.getString('nom').trim();
      const type = getTypeByLabel.get(interaction.guildId, nom);
      if (!type) {
        return interaction.reply({ content: `❌ Type **${nom}** introuvable.`, flags: MessageFlags.Ephemeral });
      }
      deleteType.run(type.id);
      await interaction.reply({
        content: `🗑️ Type **${nom}** retiré (les tickets déjà ouverts restent). Republiez le panneau pour retirer le bouton.`,
      });
      return;
    }

    if (sub === 'bloquer' || sub === 'debloquer') {
      const nom = interaction.options.getString('nom').trim();
      const type = getTypeByLabel.get(interaction.guildId, nom);
      if (!type) {
        return interaction.reply({ content: `❌ Raison **${nom}** introuvable.`, flags: MessageFlags.Ephemeral });
      }
      const block = sub === 'bloquer';
      if (block === (type.enabled === 0)) {
        return interaction.reply({
          content: `ℹ️ La raison **${nom}** est déjà ${block ? 'bloquée' : 'active'}.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      setTypeEnabled(interaction.guildId, type.id, block ? 0 : 1);
      await interaction.reply({
        content: block
          ? `🔒 Raison **${nom}** **bloquée** : plus personne ne peut ouvrir ce type de ticket. Republiez le panneau (\`/ticket panneau-modifier\`) pour retirer le bouton. Réactivez-la avec \`/ticket debloquer\`.`
          : `🔓 Raison **${nom}** **réactivée** : elle est de nouveau ouvrable. Republiez le panneau (\`/ticket panneau-modifier\`) pour réafficher le bouton.`,
      });
      await sendLog(
        interaction.guild,
        logEmbed(
          block ? '🔒 Raison de ticket bloquée' : '🔓 Raison de ticket réactivée',
          `**${nom}** ${block ? 'bloquée' : 'réactivée'} par <@${interaction.user.id}>.`,
          block ? COLORS.WARNING : COLORS.SUCCESS
        )
      );
      return;
    }

    if (sub === 'ajouter') {
      return addMemberToTicket(interaction, interaction.options.getUser('membre'));
    }

    if (sub === 'creer-pour') {
      const membre = interaction.options.getUser('membre');
      const raison = interaction.options.getString('raison').trim();
      const type = getTypeByLabel.get(interaction.guildId, raison);
      if (!type) {
        return interaction.reply({ content: `❌ Raison **${raison}** introuvable. Choisissez un type existant.`, flags: MessageFlags.Ephemeral });
      }
      return openTicketFor(interaction, type.id, membre);
    }

    if (sub === 'types') {
      const types = listTypes.all(interaction.guildId);
      if (!types.length) {
        return interaction.reply({ content: '📋 Aucun type de ticket (`/ticket type-ajouter`).', flags: MessageFlags.Ephemeral });
      }
      const lines = types.map((t) => {
        const roles = supportRoleIds(t).map((id) => `<@&${id}>`).join(' ');
        const blocked = t.enabled === 0 ? ' — 🔒 **bloquée**' : '';
        return `• ${t.emoji ? `${t.emoji} ` : ''}**${t.label}** — catégorie <#${t.category_id}>${roles ? ` — support ${roles}` : ''}${blocked}`;
      });
      const nbBlocked = types.filter((t) => t.enabled === 0).length;
      const embed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setTitle(`🎫 Types de tickets (${types.length}${nbBlocked ? `, dont ${nbBlocked} 🔒` : ''})`)
        .setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'panneau') {
      if (!listTypes.all(interaction.guildId).length) {
        return interaction.reply({ content: '❌ Créez d\'abord au moins un type (`/ticket type-ajouter`).', flags: MessageFlags.Ephemeral });
      }
      const opts = readPanelOptions(interaction);
      if (opts.couleur && parseColor(opts.couleur) === null) {
        return interaction.reply({ content: '❌ Couleur invalide : utilisez un code hex, ex `#5865F2`.', flags: MessageFlags.Ephemeral });
      }
      const salon = interaction.options.getChannel('salon') || interaction.channel;
      // Le texte (titre/description/message/pied) se saisit dans un modal → on
      // ouvre le modal ici ; la publication se fait à sa validation.
      return startPanelCreate(interaction, { channelId: salon.id, options: opts });
    }

    if (sub === 'panneau-modifier') {
      const opts = readPanelOptions(interaction);
      if (opts.couleur && parseColor(opts.couleur) === null) {
        return interaction.reply({ content: '❌ Couleur invalide : utilisez un code hex, ex `#5865F2`.', flags: MessageFlags.Ephemeral });
      }
      // Choisit le panneau (menu si plusieurs) puis ouvre le modal pré-rempli.
      return startPanelModify(interaction, { options: opts });
    }
  },
};
