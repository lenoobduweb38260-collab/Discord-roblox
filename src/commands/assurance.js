const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { db } = require('../database');
const { COLORS, sendLog, logEmbed, frDateTime } = require('../utils/embeds');
const { GRADES, getGrade } = require('../utils/permissions');

const getByName = db.prepare('SELECT * FROM enterprises WHERE guild_id = ? AND name = ?');
const searchInsurerNames = db.prepare(
  "SELECT name FROM enterprises WHERE guild_id = ? AND insurance = 1 AND name LIKE ? ORDER BY name LIMIT 25"
);
const isHead = db.prepare('SELECT 1 FROM enterprise_heads WHERE enterprise_id = ? AND user_id = ?');
const isEmployee = db.prepare('SELECT 1 FROM enterprise_employees WHERE enterprise_id = ? AND user_id = ?');

const insertVehicle = db.prepare(`
  INSERT INTO insured_vehicles (guild_id, enterprise_id, owner_id, vehicle, plate, assigned_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const getVehicle = db.prepare('SELECT * FROM insured_vehicles WHERE id = ? AND guild_id = ?');
const deleteVehicle = db.prepare('DELETE FROM insured_vehicles WHERE id = ?');
const vehiclesByEnterprise = db.prepare('SELECT * FROM insured_vehicles WHERE enterprise_id = ? ORDER BY id');
const vehiclesByOwner = db.prepare('SELECT * FROM insured_vehicles WHERE guild_id = ? AND owner_id = ? ORDER BY id');

// Règle métier : un assureur ne peut assigner un véhicule QUE si l'entreprise
// dans laquelle il est (patron ou employé) a coché "Assurance Véhicule".
function checkInsurer(interaction, ent) {
  const types = JSON.parse(ent.insurance_types || '[]');
  if (!ent.insurance || !types.includes('Véhicule')) {
    return `❌ L'entreprise **${ent.name}** n'a pas la case **Assurance Véhicule** cochée : impossible d'assigner un véhicule.`;
  }
  const isStaff = getGrade(interaction.member) >= GRADES.STAFF;
  const isMember = !!isHead.get(ent.id, interaction.user.id) || !!isEmployee.get(ent.id, interaction.user.id);
  if (!isStaff && !isMember) {
    return `⛔ Sécurité : vous devez faire partie de **${ent.name}** (patron ou employé) pour gérer ses assurances véhicule.`;
  }
  return null;
}

module.exports = {
  grade: GRADES.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('assurance')
    .setDescription('Assurances véhicule des entreprises')
    .addSubcommand((sub) =>
      sub
        .setName('assigner')
        .setDescription('[Assureur] Assigner un véhicule à votre assurance (Assurance Véhicule requise)')
        .addStringOption((o) =>
          o.setName('entreprise').setDescription('Votre entreprise d\'assurance').setRequired(true).setAutocomplete(true)
        )
        .addUserOption((o) => o.setName('client').setDescription('Propriétaire du véhicule (assuré)').setRequired(true))
        .addStringOption((o) => o.setName('vehicule').setDescription('Véhicule (marque/modèle)').setRequired(true))
        .addStringOption((o) => o.setName('plaque').setDescription('Plaque d\'immatriculation RP').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('[Assureur] Retirer un véhicule assuré (par son numéro)')
        .addIntegerOption((o) => o.setName('numero').setDescription('Numéro du contrat (voir /assurance liste)').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('liste')
        .setDescription('Lister les véhicules assurés')
        .addStringOption((o) =>
          o.setName('entreprise').setDescription('Filtrer par entreprise').setRequired(false).setAutocomplete(true)
        )
        .addUserOption((o) => o.setName('client').setDescription('Filtrer par assuré').setRequired(false))
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const rows = searchInsurerNames.all(interaction.guildId, `%${focused}%`);
    await interaction.respond(rows.map((r) => ({ name: r.name, value: r.name })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'assigner') {
      const nom = interaction.options.getString('entreprise').trim();
      const ent = getByName.get(interaction.guildId, nom);
      if (!ent) {
        return interaction.reply({ content: `❌ Entreprise **${nom}** introuvable.`, flags: MessageFlags.Ephemeral });
      }
      const error = checkInsurer(interaction, ent);
      if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

      const client = interaction.options.getUser('client');
      const vehicule = interaction.options.getString('vehicule');
      const plaque = interaction.options.getString('plaque');
      const result = insertVehicle.run(
        interaction.guildId, ent.id, client.id, vehicule, plaque, interaction.user.id, new Date().toISOString()
      );
      const embed = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle('🚗🛡️ Véhicule assuré')
        .addFields(
          { name: '📄 Contrat n°', value: `\`${result.lastInsertRowid}\``, inline: true },
          { name: '🏢 Assureur', value: ent.name, inline: true },
          { name: '👤 Assuré', value: `<@${client.id}>`, inline: true },
          { name: '🚗 Véhicule', value: vehicule, inline: true },
          { name: '🔢 Plaque', value: plaque || '*Non renseignée*', inline: true },
          { name: '✍️ Assigné par', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
      await sendLog(
        interaction.guild,
        logEmbed(
          '🛡️ Assurance véhicule',
          `Contrat n°${result.lastInsertRowid} : **${vehicule}** de <@${client.id}> assuré chez **${ent.name}** par <@${interaction.user.id}>.`,
          COLORS.SUCCESS
        )
      );
      return;
    }

    if (sub === 'retirer') {
      const numero = interaction.options.getInteger('numero');
      const vehicle = getVehicle.get(numero, interaction.guildId);
      if (!vehicle) {
        return interaction.reply({ content: `❌ Contrat n°${numero} introuvable.`, flags: MessageFlags.Ephemeral });
      }
      const ent = db.prepare('SELECT * FROM enterprises WHERE id = ?').get(vehicle.enterprise_id);
      if (ent) {
        const isStaff = getGrade(interaction.member) >= GRADES.STAFF;
        const isMember = !!isHead.get(ent.id, interaction.user.id) || !!isEmployee.get(ent.id, interaction.user.id);
        if (!isStaff && !isMember) {
          return interaction.reply({
            content: `⛔ Sécurité : seuls le **staff** ou les membres de **${ent.name}** peuvent retirer ce contrat.`,
            flags: MessageFlags.Ephemeral,
          });
        }
      }
      deleteVehicle.run(numero);
      await interaction.reply({
        content: `🗑️ Contrat n°${numero} résilié (**${vehicle.vehicle}** de <@${vehicle.owner_id}>).`,
      });
      await sendLog(
        interaction.guild,
        logEmbed('🛡️ Assurance résiliée', `Contrat n°${numero} résilié par <@${interaction.user.id}>.`, COLORS.WARNING)
      );
      return;
    }

    if (sub === 'liste') {
      const nom = interaction.options.getString('entreprise');
      const client = interaction.options.getUser('client');
      let vehicles;
      let title;
      if (nom) {
        const ent = getByName.get(interaction.guildId, nom.trim());
        if (!ent) {
          return interaction.reply({ content: `❌ Entreprise **${nom}** introuvable.`, flags: MessageFlags.Ephemeral });
        }
        vehicles = vehiclesByEnterprise.all(ent.id);
        title = `🛡️ Véhicules assurés chez ${ent.name}`;
      } else if (client) {
        vehicles = vehiclesByOwner.all(interaction.guildId, client.id);
        title = `🛡️ Véhicules assurés de ${client.username}`;
      } else {
        return interaction.reply({
          content: '❌ Indiquez une `entreprise` ou un `client` pour filtrer la liste.',
          flags: MessageFlags.Ephemeral,
        });
      }
      if (!vehicles.length) {
        return interaction.reply({ content: '📋 Aucun véhicule assuré trouvé.', flags: MessageFlags.Ephemeral });
      }
      const lines = vehicles.slice(0, 25).map(
        (v) =>
          `**n°${v.id}** — 🚗 ${v.vehicle}${v.plate ? ` (\`${v.plate}\`)` : ''} — assuré : <@${v.owner_id}> — le ${frDateTime(v.created_at)}`
      );
      const embed = new EmbedBuilder().setColor(COLORS.INFO).setTitle(title).setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed] });
    }
  },
};
