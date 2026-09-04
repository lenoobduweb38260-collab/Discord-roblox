const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { db } = require('../database');
const { COLORS, sendLog, logEmbed, frDateTime, applyMedia } = require('../utils/embeds');
const { GRADES, getGrade, isPolice } = require('../utils/permissions');
const { porteeEntreprises } = require('../utils/communaute');
const M = require('../utils/miseEnPage');

// 🔑 Même portée que /entreprise — et surtout pas la portée globale en dur.
// Les deux commandes regardaient deux réserves différentes : /entreprise
// voyait les entreprises du serveur, /assurance celles de la réserve partagée.
// Un serveur non relié « perdait » donc ses assureurs sans rien comprendre.
const PORTEE = (interaction) => porteeEntreprises(interaction.guildId);

const getByName = db.prepare('SELECT * FROM enterprises WHERE guild_id = ? AND name = ?');
const getEntById = db.prepare('SELECT * FROM enterprises WHERE id = ?');
const searchInsurerNames = db.prepare(
  "SELECT name FROM enterprises WHERE guild_id = ? AND insurance = 1 AND name LIKE ? ORDER BY name LIMIT 25"
);
const isHead = db.prepare('SELECT 1 FROM enterprise_heads WHERE enterprise_id = ? AND user_id = ?');
const isEmployee = db.prepare('SELECT 1 FROM enterprise_employees WHERE enterprise_id = ? AND user_id = ?');

const insertContract = db.prepare(`
  INSERT INTO insured_vehicles
    (guild_id, enterprise_id, owner_id, vehicle, plate, color, media_url, valid_from, valid_until,
     ins_type, building, unit_label, target_ent, assigned_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const getContract = db.prepare('SELECT * FROM insured_vehicles WHERE id = ? AND guild_id = ?');
const deleteContract = db.prepare('DELETE FROM insured_vehicles WHERE id = ?');
const setStatus = db.prepare('UPDATE insured_vehicles SET wanted = ?, impounded = ? WHERE id = ?');
const contractsByEnterprise = db.prepare('SELECT * FROM insured_vehicles WHERE enterprise_id = ? ORDER BY id');
const contractsByOwner = db.prepare('SELECT * FROM insured_vehicles WHERE guild_id = ? AND owner_id = ? ORDER BY id');

// ----- Types de contrat -----
// Chaque type d'assurance correspond à une case « type d'assurance » de
// l'entreprise (les entreprises cochent Maladie/Véhicule/Habitation/Entreprise).
const CONTRACT_TYPES = {
  vehicule: { label: 'Véhicule', icon: '🚗', entType: 'Véhicule' },
  maison: { label: 'Maison', icon: '🏠', entType: 'Habitation' },
  entreprise: { label: 'Entreprise', icon: '🏢', entType: 'Entreprise' },
  sante: { label: 'Santé', icon: '⚕️', entType: 'Maladie' },
};
// Ancien contrat (ins_type NULL) = contrat véhicule.
const typeOf = (v) => CONTRACT_TYPES[Object.keys(CONTRACT_TYPES).find((k) => CONTRACT_TYPES[k].label === v.ins_type)] || CONTRACT_TYPES.vehicule;
const isVehicle = (v) => typeOf(v) === CONTRACT_TYPES.vehicule;

// ----- Dates (délivrance → expiration) -----
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

// Embed complet d'un contrat, adapté à son type (véhicule / maison / entreprise
// / santé). Le statut police n'existe que pour les véhicules — avec un 🔴 bien
// visible dès qu'un véhicule est recherché ou en fourrière.
function contractEmbed(v, entName) {
  const t = typeOf(v);
  const val = validityInfo(v);
  const embed = new EmbedBuilder()
    .setColor(v.wanted ? COLORS.DANGER : v.impounded ? COLORS.WARNING : val.valid ? COLORS.SUCCESS : COLORS.DANGER)
    .setTitle(`${t.icon}🛡️ Contrat d'assurance ${t.label.toLowerCase()}`)
    .addFields(
      { name: '📄 Contrat n°', value: `\`${v.id}\``, inline: true },
      { name: '🏢 Assureur', value: entName || '—', inline: true },
      { name: '👤 Assuré', value: `<@${v.owner_id}>`, inline: true }
    );
  if (t === CONTRACT_TYPES.vehicule) {
    embed.addFields(
      { name: '🚗 Véhicule', value: v.vehicle, inline: true },
      { name: '🎨 Couleur', value: v.color || '—', inline: true },
      { name: '🔢 Plaque', value: v.plate || '*Non renseignée*', inline: true }
    );
  } else if (t === CONTRACT_TYPES.maison) {
    embed.addFields(
      { name: '🏠 Bâtiment / Maison', value: v.building || v.vehicle, inline: true },
      { name: '🚪 Unité', value: v.unit_label || '—', inline: true }
    );
  } else if (t === CONTRACT_TYPES.entreprise) {
    embed.addFields({ name: '🏢 Entreprise assurée', value: v.target_ent || v.vehicle, inline: true });
  }
  embed.addFields({ name: `${val.badge} Assurance`, value: val.text, inline: false });
  if (t === CONTRACT_TYPES.vehicule) {
    embed.addFields({
      name: '🚓 Statut police',
      value:
        `${v.wanted ? '🔴 🚨 **Recherché par les services de police**' : '🟢 Non recherché'}\n` +
        `${v.impounded ? '🔴 🅿️ **En fourrière**' : '🟢 Pas en fourrière'}`,
      inline: false,
    });
  }
  embed.setFooter({ text: `Assigné par un assureur • le ${frDateTime(v.created_at)}` });
  const extra = v.media_url ? applyMedia(embed, v.media_url) : null;
  return { embed, extra };
}

function listLine(v) {
  const t = typeOf(v);
  const val = validityInfo(v);
  const alert = v.wanted || v.impounded ? ' 🔴' : '';
  const subject =
    t === CONTRACT_TYPES.maison
      ? `${v.building || v.vehicle}${v.unit_label ? ` (unité ${v.unit_label})` : ''}`
      : t === CONTRACT_TYPES.entreprise
        ? v.target_ent || v.vehicle
        : v.vehicle;
  return (
    `**n°${v.id}** ${val.badge}${alert}${v.wanted ? ' 🚨' : ''}${v.impounded ? ' 🅿️' : ''} — ${t.icon} ${subject}` +
    `${isVehicle(v) && v.color ? ` 🎨 ${v.color}` : ''}${isVehicle(v) && v.plate ? ` (\`${v.plate}\`)` : ''} — <@${v.owner_id}>`
  );
}

// ----- 📄 Liste paginée -----
// Au-delà d'une trentaine de contrats, l'ancienne liste coupait à 25 sans le
// dire : les suivants étaient invisibles. Ici on découpe par ENTRÉES ENTIÈRES
// — jamais au milieu d'une ligne — avec des flèches comme les panneaux RP.
const PAR_PAGE = 20;
const BUDGET_LISTE = 3800; // marge sous la limite Discord de 4096 caractères

// Rendu d'une page de la liste. `mode` : 'e' (contrats d'une entreprise,
// ref = son id) ou 'c' (contrats d'un client, ref = son id Discord).
async function renduListe(guild, mode, ref, page) {
  const portee = porteeEntreprises(guild.id);
  let contracts;
  let title;
  if (mode === 'e') {
    const ent = getEntById.get(Number(ref));
    // L'entreprise doit appartenir à la portée du serveur : un bouton copié
    // d'un autre serveur ne doit pas ouvrir la réserve d'autrui.
    if (!ent || String(ent.guild_id) !== String(portee)) {
      return { erreur: '❌ Entreprise introuvable.' };
    }
    contracts = contractsByEnterprise.all(ent.id);
    title = `🛡️ Contrats d'assurance chez ${ent.name}`;
  } else {
    contracts = contractsByOwner.all(portee, String(ref));
    const u = await guild.client.users.fetch(String(ref)).catch(() => null);
    title = `🛡️ Contrats d'assurance de ${u?.username || ref}`;
  }
  if (!contracts.length) return { erreur: '📋 Aucun contrat d\'assurance trouvé.' };

  // Pages par entrées entières, bornées en nombre ET en caractères.
  const pages = [];
  let courante = [];
  let taille = 0;
  for (const v of contracts) {
    const cout = listLine(v).length + 8; // + saut de ligne et marqueur éventuel
    if (courante.length >= PAR_PAGE || (courante.length && taille + cout > BUDGET_LISTE)) {
      pages.push(courante);
      courante = [];
      taille = 0;
    }
    courante.push(v);
    taille += cout;
  }
  if (courante.length) pages.push(courante);
  const total = pages.length;
  const num = Math.min(Math.max(0, Number(page) || 0), total - 1);
  const visibles = pages[num];

  // 🚪 Qui a quitté le serveur ? On ne récupère QUE les assurés de la page —
  // pas tout le serveur — et un échec de l'appel laisse simplement la liste
  // sans marqueur plutôt que de la faire échouer.
  const ids = [...new Set(visibles.map((v) => String(v.owner_id)))];
  let presents = null;
  if (guild.members?.fetch) {
    presents = await guild.members.fetch({ user: ids }).catch(() => null);
  }
  const parti = (v) => presents && !presents.has(String(v.owner_id));

  const lignes = visibles.map((v) => `${listLine(v)}${parti(v) ? ' 🚪' : ''}`);
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle(title)
    .setDescription(lignes.join('\n'))
    .setFooter({
      text:
        M.piedDePage({ total: contracts.length, motTotal: 'contrat', page: num + 1, pages: total, heure: false }) +
        '\n✅ valide · ❌ expirée · 🔴🚨 recherché · 🔴🅿️ fourrière · 🚪 a quitté le serveur — détail : /assurance voir <n°>',
    });

  const components = [];
  if (total > 1) {
    const q = String(ref).slice(0, 40);
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`asspage:${mode}:${q}:${num - 1}`)
          .setLabel('Page précédente')
          .setEmoji('◀️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(num <= 0),
        new ButtonBuilder()
          .setCustomId(`asspage:${mode}:${q}:${num + 1}`)
          .setLabel('Page suivante')
          .setEmoji('▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(num >= total - 1)
      )
    );
  }
  return { embed, components };
}

// Options communes à tous les types (l'entreprise assureuse + le client).
function baseOptions(sub) {
  return sub
    .addStringOption((o) =>
      o.setName('entreprise').setDescription('Votre entreprise d\'assurance').setRequired(true).setAutocomplete(true)
    )
    .addUserOption((o) => o.setName('client').setDescription('Client assuré').setRequired(true));
}
// Dates communes : expiration obligatoire, délivrance optionnelle (défaut : aujourd'hui).
function dateOptions(sub) {
  return sub
    .addStringOption((o) => o.setName('expiration').setDescription('Date d\'expiration (JJ/MM/AAAA)').setRequired(true))
    .addStringOption((o) =>
      o.setName('delivrance').setDescription('Date de délivrance (JJ/MM/AAAA, défaut : aujourd\'hui)').setRequired(false)
    );
}
function mediaOptions(sub) {
  return sub
    .addAttachmentOption((o) => o.setName('media').setDescription('Photo (fichier)').setRequired(false))
    .addStringOption((o) => o.setName('photo').setDescription('Photo (URL)').setRequired(false));
}

module.exports = {
  module: 'rp', // fait partie du Module RP activable dans /config
  grade: GRADES.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('assurance')
    .setDescription('Assurances des entreprises : véhicule, maison, entreprise, santé')
    .addSubcommandGroup((group) =>
      group
        .setName('assigner')
        .setDescription('[Assureur] Assigner un contrat d\'assurance à un client')
        .addSubcommand((sub) => {
          sub.setName('vehicule').setDescription('Assurer un véhicule (Assurance Véhicule requise)');
          baseOptions(sub)
            .addStringOption((o) => o.setName('vehicule').setDescription('Véhicule (marque/modèle)').setRequired(true))
            .addStringOption((o) => o.setName('couleur').setDescription('Couleur du véhicule').setRequired(true));
          dateOptions(sub).addStringOption((o) =>
            o.setName('plaque').setDescription('Plaque d\'immatriculation RP').setRequired(false)
          );
          return mediaOptions(sub);
        })
        .addSubcommand((sub) => {
          sub.setName('maison').setDescription('Assurer une maison / un bâtiment (Assurance Habitation requise)');
          baseOptions(sub)
            .addStringOption((o) => o.setName('batiment').setDescription('Bâtiment / Maison').setRequired(true))
            .addStringOption((o) => o.setName('unite').setDescription('Unité (n° d\'appartement, étage…)').setRequired(true));
          return mediaOptions(dateOptions(sub));
        })
        .addSubcommand((sub) => {
          sub.setName('entreprise').setDescription('Assurer une entreprise (Assurance Entreprise requise)');
          baseOptions(sub).addStringOption((o) =>
            o.setName('entreprise_cible').setDescription('Entreprise à assurer').setRequired(true)
          );
          return dateOptions(sub);
        })
        .addSubcommand((sub) => {
          sub.setName('sante').setDescription('Assurance santé d\'un client (Assurance Maladie requise)');
          return dateOptions(baseOptions(sub));
        })
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
        .setDescription('Voir un contrat d\'assurance (validité, photo, statut police)')
        .addIntegerOption((o) => o.setName('numero').setDescription('Numéro du contrat').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('[Assureur] Résilier un contrat (par son numéro)')
        .addIntegerOption((o) => o.setName('numero').setDescription('Numéro du contrat (voir /assurance liste)').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('liste')
        .setDescription('Lister les contrats d\'assurance')
        .addStringOption((o) =>
          o.setName('entreprise').setDescription('Filtrer par entreprise').setRequired(false).setAutocomplete(true)
        )
        .addUserOption((o) => o.setName('client').setDescription('Filtrer par assuré').setRequired(false))
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const rows = searchInsurerNames.all(PORTEE(interaction), `%${focused}%`);
    await interaction.respond(rows.map((r) => ({ name: r.name, value: r.name })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // Règle métier : un assureur ne peut assigner un contrat QUE si l'entreprise
    // dans laquelle il est (patron ou employé) a coché le type d'assurance
    // correspondant (Véhicule / Habitation / Entreprise / Maladie).
    if (interaction.options.getSubcommandGroup(false) === 'assigner') {
      const t = CONTRACT_TYPES[sub];
      const nom = interaction.options.getString('entreprise').trim();
      const ent = getByName.get(PORTEE(interaction), nom);
      if (!ent) {
        return interaction.reply({ content: `❌ Entreprise **${nom}** introuvable.`, flags: MessageFlags.Ephemeral });
      }
      const types = JSON.parse(ent.insurance_types || '[]');
      if (!ent.insurance || !types.includes(t.entType)) {
        return interaction.reply({
          content: `❌ L'entreprise **${ent.name}** n'a pas la case **Assurance ${t.entType}** cochée.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      const isStaff = getGrade(interaction.member) >= GRADES.STAFF;
      const isMember = !!isHead.get(ent.id, interaction.user.id) || !!isEmployee.get(ent.id, interaction.user.id);
      if (!isStaff && !isMember) {
        return interaction.reply({ content: `⛔ Vous devez faire partie de **${ent.name}** (patron ou employé) pour gérer ses assurances.`, flags: MessageFlags.Ephemeral });
      }

      // Dates de validité (délivrance → expiration).
      const until = parseFrDate(interaction.options.getString('expiration'), true);
      if (!until) {
        return interaction.reply({ content: '❌ Date d\'expiration invalide (format **JJ/MM/AAAA**).', flags: MessageFlags.Ephemeral });
      }
      const delivranceStr = interaction.options.getString('delivrance');
      let validFrom = new Date().toISOString();
      if (delivranceStr) {
        const from = parseFrDate(delivranceStr, false);
        if (!from) return interaction.reply({ content: '❌ Date de délivrance invalide (format **JJ/MM/AAAA**).', flags: MessageFlags.Ephemeral });
        validFrom = from.toISOString();
      }

      const client = interaction.options.getUser('client');
      const attachment = interaction.options.getAttachment?.('media');
      const rawPhoto = attachment?.url || interaction.options.getString?.('photo');
      const mediaUrl = /^https?:\/\//i.test((rawPhoto || '').trim()) ? rawPhoto.trim() : null;

      // Champs propres au type ; `vehicle` (NOT NULL) porte le sujet du contrat.
      let subject = `Contrat ${t.label.toLowerCase()}`;
      let couleur = null;
      let plaque = null;
      let building = null;
      let unite = null;
      let cible = null;
      if (sub === 'vehicule') {
        subject = interaction.options.getString('vehicule');
        couleur = interaction.options.getString('couleur');
        plaque = interaction.options.getString('plaque');
      } else if (sub === 'maison') {
        building = interaction.options.getString('batiment');
        unite = interaction.options.getString('unite');
        subject = building;
      } else if (sub === 'entreprise') {
        cible = interaction.options.getString('entreprise_cible');
        subject = cible;
      }

      const result = insertContract.run(
        PORTEE(interaction), ent.id, client.id, subject, plaque, couleur, mediaUrl, validFrom, until.toISOString(),
        t.label, building, unite, cible, interaction.user.id, new Date().toISOString()
      );
      const v = getContract.get(result.lastInsertRowid, PORTEE(interaction));
      const { embed, extra } = contractEmbed(v, ent.name);
      await interaction.reply({ content: extra || undefined, embeds: [embed] });
      await sendLog(
        interaction.guild,
        logEmbed(
          `🛡️ Assurance ${t.label.toLowerCase()}`,
          `Contrat n°${v.id} : ${t.icon} **${subject}** de <@${client.id}> assuré chez **${ent.name}** par <@${interaction.user.id}> (valide jusqu'au ${frDateOnly(v.valid_until)}).`,
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
      const v = getContract.get(numero, PORTEE(interaction));
      if (!v) return interaction.reply({ content: `❌ Contrat n°${numero} introuvable.`, flags: MessageFlags.Ephemeral });
      if (!isVehicle(v)) {
        return interaction.reply({ content: `❌ Le contrat n°${numero} n'est pas un contrat **véhicule** (statut police sans objet).`, flags: MessageFlags.Ephemeral });
      }
      const recherche = interaction.options.getString('recherche');
      const fourriere = interaction.options.getString('fourriere');
      if (!recherche && !fourriere) {
        return interaction.reply({ content: '❌ Indiquez `recherche` et/ou `fourriere`.', flags: MessageFlags.Ephemeral });
      }
      const wanted = recherche ? (recherche === 'oui' ? 1 : 0) : v.wanted;
      const impounded = fourriere ? (fourriere === 'oui' ? 1 : 0) : v.impounded;
      setStatus.run(wanted, impounded, numero);
      const updated = getContract.get(numero, PORTEE(interaction));
      const ent = getEntById.get(updated.enterprise_id);
      const { embed, extra } = contractEmbed(updated, ent?.name);
      await interaction.reply({ content: extra || undefined, embeds: [embed] });
      await sendLog(
        interaction.guild,
        logEmbed(
          '🚓 Statut véhicule modifié',
          `Contrat n°${numero} : ${wanted ? '🔴 🚨 recherché' : 'non recherché'}, ${impounded ? '🔴 🅿️ en fourrière' : 'hors fourrière'} — par <@${interaction.user.id}>.`,
          wanted || impounded ? COLORS.WARNING : COLORS.INFO
        )
      );
      return;
    }

    if (sub === 'voir') {
      const numero = interaction.options.getInteger('numero');
      const v = getContract.get(numero, PORTEE(interaction));
      if (!v) return interaction.reply({ content: `❌ Contrat n°${numero} introuvable.`, flags: MessageFlags.Ephemeral });
      const ent = getEntById.get(v.enterprise_id);
      const { embed, extra } = contractEmbed(v, ent?.name);
      return interaction.reply({ content: extra || undefined, embeds: [embed] });
    }

    if (sub === 'retirer') {
      const numero = interaction.options.getInteger('numero');
      const contract = getContract.get(numero, PORTEE(interaction));
      if (!contract) {
        return interaction.reply({ content: `❌ Contrat n°${numero} introuvable.`, flags: MessageFlags.Ephemeral });
      }
      const ent = getEntById.get(contract.enterprise_id);
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
      deleteContract.run(numero);
      await interaction.reply({ content: `🗑️ Contrat n°${numero} résilié (${typeOf(contract).icon} **${contract.vehicle}** de <@${contract.owner_id}>).` });
      await sendLog(
        interaction.guild,
        logEmbed('🛡️ Assurance résiliée', `Contrat n°${numero} résilié par <@${interaction.user.id}>.`, COLORS.WARNING)
      );
      return;
    }

    if (sub === 'liste') {
      const nom = interaction.options.getString('entreprise');
      const client = interaction.options.getUser('client');
      let mode;
      let ref;
      if (nom) {
        const ent = getByName.get(PORTEE(interaction), nom.trim());
        if (!ent) {
          return interaction.reply({ content: `❌ Entreprise **${nom}** introuvable.`, flags: MessageFlags.Ephemeral });
        }
        mode = 'e';
        ref = ent.id;
      } else if (client) {
        mode = 'c';
        ref = client.id;
      } else {
        return interaction.reply({
          content: '❌ Indiquez une `entreprise` ou un `client` pour filtrer la liste.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const rendu = await renduListe(interaction.guild, mode, ref, 0);
      if (rendu.erreur) return interaction.reply({ content: rendu.erreur, flags: MessageFlags.Ephemeral });
      return interaction.reply({ embeds: [rendu.embed], components: rendu.components });
    }
  },

  // Boutons ◀️ ▶️ de la liste : le filtre (entreprise ou client) voyage dans
  // l'identifiant du bouton, la page est recalculée à chaque clic — la liste
  // affichée est donc toujours l'état réel de la base, pas une photo.
  async handleListButton(interaction) {
    const [, mode, ref, page] = interaction.customId.split(':');
    const rendu = await renduListe(interaction.guild, mode, ref, Number(page) || 0);
    if (rendu.erreur) {
      const { suivre } = require('../utils/reponse');
      return suivre(interaction, { content: rendu.erreur, flags: MessageFlags.Ephemeral });
    }
    const { mettreAJour } = require('../utils/reponse');
    return mettreAJour(interaction, { embeds: [rendu.embed], components: rendu.components });
  },

  // Exposé pour les tests : la pagination et le marqueur 🚪 se vérifient sans
  // passer par une interaction complète.
  renduListe,
};
