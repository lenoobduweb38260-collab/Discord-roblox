const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { db } = require('../database');
const { COLORS } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');
const { isCreator } = require('../utils/botTeam');
const { mettreAJour } = require('../utils/reponse');

// Vgache : gacha façon Mudae. Le roster (personnages : nom + image) est GLOBAL
// et rempli par le créateur ; la collection (qui possède qui) est propre à
// chaque serveur. /vgache roll tire un personnage, un bouton permet de le
// réclamer (1 par personne et par cooldown).

const rollRandom = db.prepare('SELECT * FROM gacha_characters ORDER BY RANDOM() LIMIT 1');
const getChar = db.prepare('SELECT * FROM gacha_characters WHERE id = ?');
const countChars = db.prepare('SELECT COUNT(*) AS n FROM gacha_characters');
const insertChar = db.prepare('INSERT INTO gacha_characters (name, image_url, added_by, added_at) VALUES (?, ?, ?, ?)');
const deleteChar = db.prepare('DELETE FROM gacha_characters WHERE id = ?');
const getCharByName = db.prepare('SELECT * FROM gacha_characters WHERE name = ? COLLATE NOCASE');

const ownerOf = db.prepare('SELECT * FROM gacha_owned WHERE guild_id = ? AND character_id = ?');
const claim = db.prepare('INSERT OR IGNORE INTO gacha_owned (guild_id, character_id, user_id, at) VALUES (?, ?, ?, ?)');
const collectionOf = db.prepare(
  'SELECT c.name FROM gacha_owned o JOIN gacha_characters c ON c.id = o.character_id WHERE o.guild_id = ? AND o.user_id = ? ORDER BY c.name COLLATE NOCASE'
);

const rollCd = new Map(); // "guild:user" -> ts
const claimCd = new Map();

function charEmbed(ch, claimedBy) {
  const embed = new EmbedBuilder()
    .setColor(claimedBy ? COLORS.SUCCESS : 0x9146ff)
    .setTitle(`🎴 ${ch.name}`)
    .setFooter({ text: claimedBy ? `Réclamé par ${claimedBy}` : 'Cliquez pour réclamer !' });
  if (ch.image_url) embed.setImage(ch.image_url);
  return embed;
}

module.exports = {
  grade: GRADES.EVERYONE,
  public: true,
  data: new SlashCommandBuilder()
    .setName('vgache')
    .setDescription('Vgache : gacha de VTubeuses Twitch FR (façon Mudae)')
    .addSubcommand((sub) => sub.setName('roll').setDescription('Tirer un personnage au hasard'))
    .addSubcommand((sub) =>
      sub
        .setName('collection')
        .setDescription('Voir une collection')
        .addUserOption((o) => o.setName('membre').setDescription('Membre (défaut : vous)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('[Créateur] Ajouter un personnage au roster')
        .addStringOption((o) => o.setName('nom').setDescription('Nom du personnage').setRequired(true))
        .addStringOption((o) => o.setName('image').setDescription('URL de l\'image').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('[Créateur] Retirer un personnage du roster')
        .addStringOption((o) => o.setName('nom').setDescription('Nom du personnage').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'ajouter' || sub === 'retirer') {
      if (!(await isCreator(interaction.client, interaction.user.id))) {
        return interaction.reply({ content: '⛔ Seul le créateur du bot gère le roster Vgache.', flags: MessageFlags.Ephemeral });
      }
      if (sub === 'ajouter') {
        const nom = interaction.options.getString('nom').trim().slice(0, 80);
        const image = interaction.options.getString('image').trim();
        if (!/^https?:\/\//.test(image)) return interaction.reply({ content: '❌ URL d\'image invalide.', flags: MessageFlags.Ephemeral });
        if (getCharByName.get(nom)) return interaction.reply({ content: `❌ **${nom}** existe déjà.`, flags: MessageFlags.Ephemeral });
        insertChar.run(nom, image, interaction.user.id, new Date().toISOString());
        return interaction.reply({ content: `✅ **${nom}** ajouté au roster (total : ${countChars.get().n}).`, flags: MessageFlags.Ephemeral });
      }
      const ch = getCharByName.get(interaction.options.getString('nom').trim());
      if (!ch) return interaction.reply({ content: '❌ Personnage introuvable.', flags: MessageFlags.Ephemeral });
      deleteChar.run(ch.id);
      return interaction.reply({ content: `🗑️ **${ch.name}** retiré du roster.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'collection') {
      const user = interaction.options.getUser('membre') || interaction.user;
      const rows = collectionOf.all(interaction.guildId, user.id);
      const embed = new EmbedBuilder()
        .setColor(0x9146ff)
        .setTitle(`🎴 Collection de ${user.username} (${rows.length})`)
        .setDescription(rows.length ? rows.map((r) => `➜ ${r.name}`).join('\n').slice(0, 4000) : '*Aucun personnage réclamé.*');
      return interaction.reply({ embeds: [embed] });
    }

    // roll
    if (!countChars.get().n) {
      return interaction.reply({ content: '📭 Le roster Vgache est vide. Le créateur peut ajouter des personnages avec `/vgache ajouter`.', flags: MessageFlags.Ephemeral });
    }
    const key = `${interaction.guildId}:${interaction.user.id}`;
    const now = Date.now();
    if (now - (rollCd.get(key) || 0) < 8000) {
      return interaction.reply({ content: '⏳ Patientez quelques secondes avant de re-roll.', flags: MessageFlags.Ephemeral });
    }
    rollCd.set(key, now);
    const ch = rollRandom.get();
    const owner = ownerOf.get(interaction.guildId, ch.id);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`vg:claim:${ch.id}`)
        .setLabel(owner ? 'Déjà réclamé' : 'Réclamer')
        .setEmoji('❤️')
        .setStyle(owner ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setDisabled(Boolean(owner))
    );
    const claimedBy = owner ? (await interaction.client.users.fetch(owner.user_id).catch(() => null))?.username || 'quelqu\'un' : null;
    return interaction.reply({ embeds: [charEmbed(ch, claimedBy)], components: [row] });
  },

  // Bouton « Réclamer » (routé depuis interactionCreate).
  async handleButton(interaction) {
    const charId = Number(interaction.customId.split(':')[2]);
    const ch = getChar.get(charId);
    if (!ch) return interaction.reply({ content: '❌ Personnage introuvable.', flags: MessageFlags.Ephemeral });
    if (ownerOf.get(interaction.guildId, charId)) {
      return interaction.reply({ content: '❌ Déjà réclamé.', flags: MessageFlags.Ephemeral });
    }
    const key = `${interaction.guildId}:${interaction.user.id}`;
    const now = Date.now();
    if (now - (claimCd.get(key) || 0) < 60 * 60 * 1000) {
      const left = Math.ceil((60 * 60 * 1000 - (now - claimCd.get(key))) / 60000);
      return interaction.reply({ content: `⏳ Vous avez déjà réclamé récemment. Réessayez dans ${left} min.`, flags: MessageFlags.Ephemeral });
    }
    const res = claim.run(interaction.guildId, charId, interaction.user.id, new Date().toISOString());
    if (!res.changes) return interaction.reply({ content: '❌ Trop tard, déjà réclamé.', flags: MessageFlags.Ephemeral });
    claimCd.set(key, now);
    await mettreAJour(interaction, {
      embeds: [charEmbed(ch, interaction.user.username)],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('vg:claimed').setLabel('Réclamé').setEmoji('❤️').setStyle(ButtonStyle.Secondary).setDisabled(true)
        ),
      ],
    });
  },
};
