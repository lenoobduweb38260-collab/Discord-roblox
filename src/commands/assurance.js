const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { db, RP_SCOPE } = require('../database');
const { COLORS, sendLog, logEmbed, frDateTime, applyMedia } = require('../utils/embeds');
const { GRADES, getGrade, isPolice } = require('../utils/permissions');

const getByName = db.prepare('SELECT * FROM enterprises WHERE guild_id = ? AND name = ?');
const getEntById = db.prepare('SELECT * FROM enterprises WHERE id = ?');
const searchInsurerNames = db.prepare(
  "SELECT name FROM enterprises WHERE guild_id = ? AND insurance = 1 AND name LIKE ? ORDER BY name LIMIT 25"
);
const isHead = db.prepare('SELECT 1 FROM enterprise_heads WHERE enterprise_id = ? AND user_id = ?');
const isEmployee = db.prepare('SELECT 1 FROM enterprise_employees WHERE enterprise_id = ? AND user_id = ?');

const insertVehicle = db.prepare(`
  INSERT INTO insured_vehicles
    (guild_id, enterprise_id, owner_id, vehicle, plate, color, media_url, valid_from, valid_until, assigned_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const getVehicle = db.prepare('SELECT * FROM insured_vehicles WHERE id = ? AND guild_id = ?');
const deleteVehicle = db.prepare('DELETE FROM insured_vehicles WHERE id = ?');
const setStatus = db.prepare('UPDATE insured_vehicles SET wanted = ?, impounded = ? WHERE id = ?');
const vehiclesByEnterprise = db.prepare('SELECT * FROM insured_vehicles WHERE enterprise_id = ? ORDER BY id');
const vehiclesByOwner = db.prepare('SELECT * FROM insured_vehicles WHERE guild_id = ? AND owner_id = ? ORDER BY id');

// ----- Dates (validation → expiration) -----
// Accepte JJ/MM/AAAA ou AAAA-MM-JJ ; renvoie une Date (ou null si invalide).
function parseFrDate(str, endOfDay = false) {
  if (!str) return null;
  const s = String(str).trim();
  let y;
  let mo;
  let d;
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) {
    d = +m[1];
    mo = +m[2];
    y = +m[3];
  } else {
    m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
    if (!m) return null;
    y = +m[1];
    mo = +m[2];
    d = +m[3];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function frDateOnly(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long' });
}

// État de validité d'un contrat à partir de ses dates.
function validityInfo(v) {
  if (!v.valid_until) return { badge: '♾️', text: 'Durée indéterminée', valid: true };
  const until = new Date(v.valid_until);
  const from = v.valid_from ? new Date(v.valid_from) : null;
  const now = new Date();
  if (from && now < from) {
    return { badge: '⏳', text: `Pas encore active (du ${frDateOnly(v.valid_from)} au ${frDateOnly(v.valid_until)})`, valid: false };
  }
  if (now > until) {
    return { badge: '❌', text: `**Expirée** le ${frDateOnly(v.valid_until)}`, valid: false };
  }
  return {
    badge: '✅',
    text: `**Valide**${from ? ` du ${frDateOnly(v.valid_from)}` : ''} jusqu'au ${frDateOnly(v.valid_until)}`,
    valid: true,
  };
}

// Embed complet d'un contrat véhicule (assurance + statut police + photo).
function vehicleEmbed(v, entName) {
  const val = validityInfo(v);
  const embed = new EmbedBuilder()
    .setColor(v.wanted ? COLORS.DANGER : v.impounded ? COLORS.WARNING : val.valid ? COLORS.SUCCESS : COLORS.DANGER)
    .setTitle('🚗🛡️ Contrat d\'assurance véhicule')
    .addFields(
      { name: '📄 Contrat n°', value: `\`${v.id}\``, inline: true },
      { name: '🏢 Assureur', value: entName || '—', inline: true },
      { name: '👤 Assuré', value: `<@${v.owner_id}>`, inline: true },
      { name: '🚗 Véhicule', value: v.vehicle, inline: true },
      { name: '🎨 Couleur', value: v.color || '—', inline: true },
      { name: '🔢 Plaque', value: v.plate || '*Non renseignée*', inline: true },
      { name: `${val.badge} Assurance`, value: val.text, inline: false },
      {
        name: '🚓 Statut police',
        value:
          `${v.wanted ? '🚨 **Recherché par les services de police**' : '🟢 Non recherché'}\n` +
          `${v.impounded ? '🅿️ **En fourrière**' : '🟢 Pas en fourrière'}`,
        inline: false,
      }
    )
    .setFooter({ text: `Assigné par un assureur • le ${frDateTime(v.created_at)}` });
  const extra = v.media_url ? applyMedia(embed, v.media_url) : null;
  return { embed, extra };
}

function listLine(v) {
  const val = validityInfo(v);
  return (
    `**n°${v.id}** ${val.badge}${v.wanted ? ' 🚨' : ''}${v.impounded ? ' 🅿️' : ''} — 🚗 ${v.vehicle}` +
    `${v.color ? ` 🎨 ${v.color}` : ''}${v.plate ? ` (\`${v.plate}\`)` : ''} — <@${v.owner_id}>`
  );
}

module.exports = {
  module: 'rp', // fait partie du Module RP activable dans /config
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
        .addStringOption((o) => o.setName('couleur').setDescription('Couleur du véhicule').setRequired(true))
        .addStringOption((o) => o.setName('expiration').setDescription('Date d\'expiration (JJ/MM/AAAA)').setRequired(true))
        .addStringOption((o) => o.setName('debut').setDescription('Date de validation (JJ/MM/AAAA, défaut : aujourd\'hui)').setRequired(false))
        .addStringOption((o) => o.setName('plaque').setDescription('Plaque d\'immatriculation RP').setRequired(false))
        .addAttachmentOption((o) => o.setName('media').setDescription('Photo du véhicule (fichier)').setRequired(false))
        .addStringOption((o) => o.setName('photo').setDescription('Photo du véhicule (URL)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('statut')
        .setDescription('[Police/Staff] Véhicule recherché et/ou en fourrière')
        .addIntegerOption((o) => o.setName('numero').setDescription('Numéro du contrat (voir /assurance liste)').setRequired(true))
        .addStringOption((o) =>
          o.setName('recherche').setDescription('Recherché par la police ?').setRequired(false).addChoices({ name: 'Oui', value: 'oui' }, { name: 'Non', value: 'non' })
        )
        .addStringOption((o) =>
          o.setName('fourriere').setDescription('En fourrière ?').setRequired(false).addChoices({ name: 'Oui', value: 'oui' }, { name: 'Non', value: 'non' })
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('voir')
        .setDescription('Voir un contrat d\'assurance (photo, validité, statut police)')
        .addIntegerOption((o) => o.setName('numero').setDescription('Numéro du contrat').setRequired(true))
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
    const rows = searchInsurerNames.all(RP_SCOPE, `%${focused}%`);
    await interaction.respond(rows.map((r) => ({ name: r.name, value: r.name })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // Règle métier : un assureur ne peut assigner un véhicule QUE si l'entreprise
    // dans laquelle il est (patron ou employé) a coché "Assurance Véhicule".
    if (sub === 'assigner') {
      const nom = interaction.options.getString('entreprise').trim();
      const ent = getByName.get(RP_SCOPE, nom);
      if (!ent) {
        return interaction.reply({ content: `❌ Entreprise **${nom}** introuvable.`, flags: MessageFlags.Ephemeral });
      }
      const types = JSON.parse(ent.insurance_types || '[]');
      if (!ent.insurance || !types.includes('Véhicule')) {
        return interaction.reply({ content: `❌ L'entreprise **${ent.name}** n'a pas la case **Assurance Véhicule** cochée.`, flags: MessageFlags.Ephemeral });
      }
      const isStaff = getGrade(interaction.member) >= GRADES.STAFF;
      const isMember = !!isHead.get(ent.id, interaction.user.id) || !!isEmployee.get(ent.id, interaction.user.id);
      if (!isStaff && !isMember) {
        return interaction.reply({ content: `⛔ Vous devez faire partie de **${ent.name}** (patron ou employé) pour gérer ses assurances.`, flags: MessageFlags.Ephemeral });
      }

      // Dates de validité.
      const until = parseFrDate(interaction.options.getString('expiration'), true);
      if (!until) {
        return interaction.reply({ content: '❌ Date d\'expiration invalide (format **JJ/MM/AAAA**).', flags: MessageFlags.Ephemeral });
      }
      const debutStr = interaction.options.getString('debut');
      let validFrom = new Date().toISOString();
      if (debutStr) {
        const from = parseFrDate(debutStr, false);
        if (!from) return interaction.reply({ content: '❌ Date de validation invalide (format **JJ/MM/AAAA**).', flags: MessageFlags.Ephemeral });
        validFrom = from.toISOString();
      }

      const client = interaction.options.getUser('client');
      const vehicule = interaction.options.getString('vehicule');
      const couleur = interaction.options.getString('couleur');
      const plaque = interaction.options.getString('plaque');
      const attachment = interaction.options.getAttachment('media');
      const rawPhoto = attachment?.url || interaction.options.getString('photo');
      const mediaUrl = /^https?:\/\//i.test((rawPhoto || '').trim()) ? rawPhoto.trim() : null;

      const result = insertVehicle.run(
        RP_SCOPE, ent.id, client.id, vehicule, plaque, couleur, mediaUrl, validFrom, until.toISOString(), interaction.user.id, new Date().toISOString()
      );
      const v = getVehicle.get(result.lastInsertRowid, RP_SCOPE);
      const { embed, extra } = vehicleEmbed(v, ent.name);
      await interaction.reply({ content: extra || undefined, embeds: [embed] });
      await sendLog(
        interaction.guild,
        logEmbed(
          '🛡️ Assurance véhicule',
          `Contrat n°${v.id} : **${vehicule}** de <@${client.id}> assuré chez **${ent.name}** par <@${interaction.user.id}> (valide jusqu'au ${frDateOnly(v.valid_until)}).`,
          COLORS.SUCCESS
        )
      );
      return;
    }

    if (sub === 'statut') {
      const isStaff = getGrade(interaction.member) >= GRADES.STAFF;
      if (!isStaff && !isPolice(interaction.member)) {
        return interaction.reply({ content: '⛔ Sécurité : réservé à la **police** ou au **staff**.', flags: MessageFlags.Ephemeral });
      }
      const numero = interaction.options.getInteger('numero');
      const v = getVehicle.get(numero, RP_SCOPE);
      if (!v) return interaction.reply({ content: `❌ Contrat n°${numero} introuvable.`, flags: MessageFlags.Ephemeral });
      const recherche = interaction.options.getString('recherche');
      const fourriere = interaction.options.getString('fourriere');
      if (!recherche && !fourriere) {
        return interaction.reply({ content: '❌ Indiquez `recherche` et/ou `fourriere`.', flags: MessageFlags.Ephemeral });
      }
      const wanted = recherche ? (recherche === 'oui' ? 1 : 0) : v.wanted;
      const impounded = fourriere ? (fourriere === 'oui' ? 1 : 0) : v.impounded;
      setStatus.run(wanted, impounded, numero);
      const updated = getVehicle.get(numero, RP_SCOPE);
      const ent = getEntById.get(updated.enterprise_id);
      const { embed, extra } = vehicleEmbed(updated, ent?.name);
      await interaction.reply({ content: extra || undefined, embeds: [embed] });
      await sendLog(
        interaction.guild,
        logEmbed(
          '🚓 Statut véhicule modifié',
          `Contrat n°${numero} : ${wanted ? '🚨 recherché' : 'non recherché'}, ${impounded ? '🅿️ en fourrière' : 'hors fourrière'} — par <@${interaction.user.id}>.`,
          wanted || impounded ? COLORS.WARNING : COLORS.INFO
        )
      );
      return;
    }

    if (sub === 'voir') {
      const numero = interaction.options.getInteger('numero');
      const v = getVehicle.get(numero, RP_SCOPE);
      if (!v) return interaction.reply({ content: `❌ Contrat n°${numero} introuvable.`, flags: MessageFlags.Ephemeral });
      const ent = getEntById.get(v.enterprise_id);
      const { embed, extra } = vehicleEmbed(v, ent?.name);
      return interaction.reply({ content: extra || undefined, embeds: [embed] });
    }

    if (sub === 'retirer') {
      const numero = interaction.options.getInteger('numero');
      const vehicle = getVehicle.get(numero, RP_SCOPE);
      if (!vehicle) {
        return interaction.reply({ content: `❌ Contrat n°${numero} introuvable.`, flags: MessageFlags.Ephemeral });
      }
      const ent = getEntById.get(vehicle.enterprise_id);
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
      await interaction.reply({ content: `🗑️ Contrat n°${numero} résilié (**${vehicle.vehicle}** de <@${vehicle.owner_id}>).` });
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
        const ent = getByName.get(RP_SCOPE, nom.trim());
        if (!ent) {
          return interaction.reply({ content: `❌ Entreprise **${nom}** introuvable.`, flags: MessageFlags.Ephemeral });
        }
        vehicles = vehiclesByEnterprise.all(ent.id);
        title = `🛡️ Véhicules assurés chez ${ent.name}`;
      } else if (client) {
        vehicles = vehiclesByOwner.all(RP_SCOPE, client.id);
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
      const embed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setTitle(title)
        .setDescription(vehicles.slice(0, 25).map(listLine).join('\n'))
        .setFooter({ text: '✅ valide · ❌ expirée · 🚨 recherché · 🅿️ fourrière — détail : /assurance voir <n°>' });
      return interaction.reply({ embeds: [embed] });
    }
  },
};
