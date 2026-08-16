const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { db, RP_SCOPE } = require('../database');
const { buildEnterpriseEmbed, sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { GRADES, getGrade } = require('../utils/permissions');

const INSURANCE_TYPES = ['Maladie', 'Véhicule', 'Habitation', 'Entreprise'];

const insertEnterprise = db.prepare(`
  INSERT INTO enterprises (guild_id, name, description, media_url, insurance, insurance_types, created_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const getByName = db.prepare('SELECT * FROM enterprises WHERE guild_id = ? AND name = ?');
const getById = db.prepare('SELECT * FROM enterprises WHERE id = ?');
const listAll = db.prepare('SELECT * FROM enterprises WHERE guild_id = ? ORDER BY name');
const searchNames = db.prepare(
  'SELECT name FROM enterprises WHERE guild_id = ? AND name LIKE ? ORDER BY name LIMIT 25'
);
const deleteEnterprise = db.prepare('DELETE FROM enterprises WHERE id = ?');

const getHeads = db.prepare('SELECT user_id FROM enterprise_heads WHERE enterprise_id = ?');
const addHead = db.prepare('INSERT OR IGNORE INTO enterprise_heads (enterprise_id, user_id) VALUES (?, ?)');
const removeHead = db.prepare('DELETE FROM enterprise_heads WHERE enterprise_id = ? AND user_id = ?');
const isHead = db.prepare('SELECT 1 FROM enterprise_heads WHERE enterprise_id = ? AND user_id = ?');

const getEmployees = db.prepare('SELECT user_id FROM enterprise_employees WHERE enterprise_id = ?');
const addEmployee = db.prepare('INSERT OR IGNORE INTO enterprise_employees (enterprise_id, user_id) VALUES (?, ?)');
const removeEmployee = db.prepare('DELETE FROM enterprise_employees WHERE enterprise_id = ? AND user_id = ?');

// Retrait d'un membre (patron ET employé) de TOUTES les entreprises du serveur courant.
const removeHeadEverywhere = db.prepare(
  'DELETE FROM enterprise_heads WHERE user_id = ? AND enterprise_id IN (SELECT id FROM enterprises WHERE guild_id = ?)'
);
const removeEmployeeEverywhere = db.prepare(
  'DELETE FROM enterprise_employees WHERE user_id = ? AND enterprise_id IN (SELECT id FROM enterprises WHERE guild_id = ?)'
);

function insuranceMenu(enterpriseId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`entassur:${enterpriseId}`)
      .setPlaceholder("📋 Choisissez le(s) type(s) d'assurance (plusieurs choix possibles)")
      .setMinValues(1)
      .setMaxValues(INSURANCE_TYPES.length)
      .addOptions(
        INSURANCE_TYPES.map((t) => ({
          label: `Assurance ${t}`,
          value: t,
          emoji: { Maladie: '🏥', 'Véhicule': '🚗', Habitation: '🏠', Entreprise: '🏢' }[t],
        }))
      )
  );
}

function enterpriseReply(ent) {
  const heads = getHeads.all(ent.id).map((r) => r.user_id);
  const employees = getEmployees.all(ent.id).map((r) => r.user_id);
  const { embed, extraContent } = buildEnterpriseEmbed(ent, heads, employees);
  return { embed, extraContent };
}

module.exports = {
  module: 'rp', // fait partie du Module RP activable dans /config
  grade: GRADES.EVERYONE, // contrôle fin par sous-commande dans execute()
  data: new SlashCommandBuilder()
    .setName('entreprise')
    .setDescription('Gestion des entreprises RP')
    .addSubcommand((sub) =>
      sub
        .setName('creer')
        .setDescription('[Staff] Créer une entreprise (question assurance obligatoire)')
        .addStringOption((o) => o.setName('nom').setDescription("Nom de l'entreprise").setRequired(true))
        .addStringOption((o) =>
          o
            .setName('assurance')
            .setDescription("Question obligatoire : l'entreprise propose-t-elle des assurances ?")
            .setRequired(true)
            .addChoices({ name: 'Oui', value: 'oui' }, { name: 'Non', value: 'non' })
        )
        .addStringOption((o) => o.setName('description').setDescription('Description de l\'entreprise').setRequired(false))
        .addUserOption((o) => o.setName('patron').setDescription('Membre à mettre à la tête de l\'entreprise').setRequired(false))
        .addAttachmentOption((o) => o.setName('media').setDescription('Photo/GIF/vidéo (fichier)').setRequired(false))
        .addStringOption((o) => o.setName('media_url').setDescription('URL photo/GIF/vidéo').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('modifier')
        .setDescription('[Staff] Modifier une entreprise')
        .addStringOption((o) =>
          o.setName('nom').setDescription('Entreprise à modifier').setRequired(true).setAutocomplete(true)
        )
        .addStringOption((o) =>
          o
            .setName('champ')
            .setDescription('Champ à modifier')
            .setRequired(true)
            .addChoices(
              { name: 'nom', value: 'nom' },
              { name: 'description', value: 'description' },
              { name: 'media (photo/GIF/vidéo)', value: 'media' },
              { name: 'assurance (oui/non)', value: 'assurance' },
              { name: 'type d\'assurance', value: 'types' }
            )
        )
        .addStringOption((o) =>
          o.setName('valeur').setDescription('Nouvelle valeur (assurance : oui/non ; type d\'assurance : laisser vide)').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('media')
        .setDescription('[Staff] Changer le média : fichier OU lien (photo/GIF/vidéo/YouTube)')
        .addStringOption((o) => o.setName('nom').setDescription('Entreprise').setRequired(true).setAutocomplete(true))
        .addAttachmentOption((o) => o.setName('fichier').setDescription('Glissez un fichier (photo/GIF/vidéo)').setRequired(false))
        .addStringOption((o) => o.setName('lien').setDescription('Ou un lien (imgur, GIF, vidéo, YouTube…)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('supprimer')
        .setDescription('[Staff] Supprimer une entreprise')
        .addStringOption((o) =>
          o.setName('nom').setDescription('Entreprise à supprimer').setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('patron')
        .setDescription('[Staff] Ajouter/retirer un membre à la tête d\'une entreprise')
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('Action')
            .setRequired(true)
            .addChoices({ name: 'ajouter', value: 'ajouter' }, { name: 'retirer', value: 'retirer' })
        )
        .addStringOption((o) =>
          o.setName('nom').setDescription('Entreprise').setRequired(true).setAutocomplete(true)
        )
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre concerné').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('employe')
        .setDescription('[Staff/Patron] Ajouter/retirer un employé')
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('Action')
            .setRequired(true)
            .addChoices({ name: 'ajouter', value: 'ajouter' }, { name: 'retirer', value: 'retirer' })
        )
        .addStringOption((o) =>
          o.setName('nom').setDescription('Entreprise').setRequired(true).setAutocomplete(true)
        )
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre concerné').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('voir')
        .setDescription('Afficher une entreprise')
        .addStringOption((o) =>
          o.setName('nom').setDescription('Entreprise').setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer-membre')
        .setDescription('[Staff] Retirer un membre (patron + employé) de toutes les entreprises')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre à retirer de toutes les entreprises').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Liste des entreprises du serveur')),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const rows = searchNames.all(RP_SCOPE, `%${focused}%`);
    await interaction.respond(rows.map((r) => ({ name: r.name, value: r.name })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const isStaff = getGrade(interaction.member) >= GRADES.STAFF;

    if (!['voir', 'liste', 'employe'].includes(sub) && !isStaff) {
      return interaction.reply({
        content: '⛔ Sécurité : cette sous-commande est réservée au **staff**.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'retirer-membre') {
      const user = interaction.options.getUser('utilisateur');
      const heads = removeHeadEverywhere.run(user.id, RP_SCOPE).changes;
      const emps = removeEmployeeEverywhere.run(user.id, RP_SCOPE).changes;
      if (!heads && !emps) {
        return interaction.reply({
          content: `ℹ️ <@${user.id}> n'était ni patron ni employé d'une entreprise.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      await interaction.reply({
        content: `🧹 <@${user.id}> retiré de **${heads}** direction(s) et **${emps}** poste(s) d'employé.`,
      });
      await sendLog(
        interaction.guild,
        logEmbed(
          '🏢 Membre retiré des entreprises',
          `<@${user.id}> retiré de toutes les entreprises du serveur (${heads} patron, ${emps} employé) par <@${interaction.user.id}>.`,
          COLORS.WARNING
        )
      );
      return;
    }

    if (sub === 'media') {
      const ent = getByName.get(RP_SCOPE, interaction.options.getString('nom').trim());
      if (!ent) {
        return interaction.reply({ content: '❌ Entreprise introuvable.', flags: MessageFlags.Ephemeral });
      }
      const fichier = interaction.options.getAttachment('fichier');
      const lien = interaction.options.getString('lien');
      const url = fichier?.url || (lien ? lien.trim() : null);
      if (!url) {
        return interaction.reply({ content: '❌ Fournissez un **fichier** (glissez-le) OU un **lien**.', flags: MessageFlags.Ephemeral });
      }
      if (!/^https?:\/\//i.test(url)) {
        return interaction.reply({ content: '❌ Le **lien** doit être une URL (http…). Glissez plutôt un fichier si besoin.', flags: MessageFlags.Ephemeral });
      }
      db.prepare('UPDATE enterprises SET media_url = ? WHERE id = ?').run(url, ent.id);
      const updated = getById.get(ent.id);
      const { embed, extraContent } = enterpriseReply(updated);
      await interaction.reply({
        content: `${extraContent ? `${extraContent}\n` : ''}✅ Média de **${ent.name}** mis à jour.`,
        embeds: [embed],
      });
      await sendLog(
        interaction.guild,
        logEmbed('🏢 Média modifié', `**${ent.name}** — média mis à jour par <@${interaction.user.id}>.`, COLORS.INFO)
      );
      return;
    }

    if (sub === 'creer') {
      const nom = interaction.options.getString('nom').trim();
      if (getByName.get(RP_SCOPE, nom)) {
        return interaction.reply({ content: `❌ L'entreprise **${nom}** existe déjà.`, flags: MessageFlags.Ephemeral });
      }
      const assurance = interaction.options.getString('assurance') === 'oui';
      const attachment = interaction.options.getAttachment('media');
      // On n'accepte qu'une vraie URL comme média (un fichier fournit toujours
      // une URL ; un texte comme « non » est ignoré plutôt que stocké).
      const rawUrl = attachment?.url || interaction.options.getString('media_url');
      const mediaUrl = /^https?:\/\//i.test((rawUrl || '').trim()) ? rawUrl.trim() : null;
      const patron = interaction.options.getUser('patron');

      const result = insertEnterprise.run(
        RP_SCOPE,
        nom,
        interaction.options.getString('description'),
        mediaUrl,
        assurance ? 1 : 0,
        '[]',
        interaction.user.id,
        new Date().toISOString()
      );
      const entId = result.lastInsertRowid;
      if (patron) addHead.run(entId, patron.id);
      const ent = getById.get(entId);
      const { embed, extraContent } = enterpriseReply(ent);

      // Question obligatoire n°2 : si assurance = oui, choix (multiple) des types.
      if (assurance) {
        await interaction.reply({
          content:
            (extraContent ? `${extraContent}\n` : '') +
            `✅ Entreprise **${nom}** créée.\n📋 **Question obligatoire :** sélectionnez le(s) type(s) d'assurance proposé(s) :`,
          embeds: [embed],
          components: [insuranceMenu(entId)],
        });
      } else {
        await interaction.reply({ content: extraContent || undefined, embeds: [embed] });
      }
      await sendLog(
        interaction.guild,
        logEmbed(
          '🏢 Entreprise créée',
          `**${nom}** créée par <@${interaction.user.id}> (assurance : ${assurance ? 'oui' : 'non'}${patron ? `, patron : <@${patron.id}>` : ''}).`,
          COLORS.SUCCESS
        )
      );
      return;
    }

    if (sub === 'liste') {
      const rows = listAll.all(RP_SCOPE);
      if (!rows.length) {
        return interaction.reply({ content: '❌ Aucune entreprise sur ce serveur.', flags: MessageFlags.Ephemeral });
      }
      const M = require('../utils/miseEnPage');
      // Deux sections : celles qui assurent, et les autres. Plus lisible
      // qu'une longue liste où chaque ligne répète « assurance : ❌ ».
      const assureurs = [];
      const autres = [];
      for (const e of rows) {
        let types = [];
        try { types = JSON.parse(e.insurance_types || '[]'); } catch {}
        if (e.insurance) assureurs.push(`**${e.name}** — ${types.join(', ') || '*types à définir*'}`);
        else autres.push(`**${e.name}**`);
      }
      const embed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setTitle('🏙️ Entreprises')
        .setDescription(M.borner(M.description([
          M.bloc('Assurance proposée', assureurs, { prefixe: '🛡️', motCompte: 'entreprise', vide: 'Aucune pour le moment' }),
          M.bloc('Sans assurance', autres, { prefixe: '🏢', motCompte: 'entreprise', vide: 'Aucune' }),
        ]), M.MAX_DESCRIPTION))
        .setFooter({ text: M.piedDePage({ total: rows.length, motTotal: 'entreprise' }) });
      return interaction.reply({ embeds: [embed] });
    }

    // Toutes les sous-commandes restantes ciblent une entreprise par nom.
    const nom = interaction.options.getString('nom').trim();
    const ent = getByName.get(RP_SCOPE, nom);
    if (!ent) {
      return interaction.reply({ content: `❌ Entreprise **${nom}** introuvable.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'voir') {
      const { embed, extraContent } = enterpriseReply(ent);
      return interaction.reply({ content: extraContent || undefined, embeds: [embed] });
    }

    if (sub === 'modifier') {
      const champ = interaction.options.getString('champ');
      const valeur = (interaction.options.getString('valeur') || '').trim();

      // Modifier directement les types d'assurance (sans re-basculer oui/non).
      if (champ === 'types') {
        if (!ent.insurance) {
          return interaction.reply({
            content: `❌ **${ent.name}** ne propose pas d'assurances. Activez d'abord l'assurance (champ **assurance** → \`oui\`).`,
            flags: MessageFlags.Ephemeral,
          });
        }
        return interaction.reply({
          content: `📋 Modifier les types d'assurance de **${ent.name}** — sélectionnez le(s) nouveau(x) type(s) :`,
          components: [insuranceMenu(ent.id)],
        });
      }

      if (champ === 'assurance') {
        if (!valeur) {
          return interaction.reply({ content: '❌ Précisez `oui` ou `non` pour l\'assurance.', flags: MessageFlags.Ephemeral });
        }
        const oui = valeur.toLowerCase() === 'oui';
        db.prepare('UPDATE enterprises SET insurance = ?, insurance_types = ? WHERE id = ?').run(
          oui ? 1 : 0, '[]', ent.id
        );
        if (oui) {
          return interaction.reply({
            content: `📋 **${ent.name}** propose désormais des assurances. Sélectionnez le(s) type(s) :`,
            components: [insuranceMenu(ent.id)],
          });
        }
        const updated = getById.get(ent.id);
        const { embed, extraContent } = enterpriseReply(updated);
        return interaction.reply({ content: extraContent || undefined, embeds: [embed] });
      }

      // Média : autoriser l'effacement (« non »/« aucun »/vide) et refuser une
      // valeur qui n'est pas une URL (évite de stocker « non » comme lien).
      if (champ === 'media') {
        const cleared = !valeur || ['non', 'aucun', 'aucune', 'none', 'vide', '-'].includes(valeur.toLowerCase());
        if (!cleared && !/^https?:\/\//i.test(valeur)) {
          return interaction.reply({ content: '❌ Le média doit être un **lien** (http…), ou `non` pour le retirer.', flags: MessageFlags.Ephemeral });
        }
        db.prepare('UPDATE enterprises SET media_url = ? WHERE id = ?').run(cleared ? null : valeur, ent.id);
        const updated = getById.get(ent.id);
        const { embed, extraContent } = enterpriseReply(updated);
        await interaction.reply({
          content: `✅ Média ${cleared ? 'retiré' : 'mis à jour'}.${extraContent ? `\n${extraContent}` : ''}`,
          embeds: [embed],
        });
        await sendLog(
          interaction.guild,
          logEmbed('🏢 Entreprise modifiée', `**${ent.name}** : média ${cleared ? 'retiré' : 'modifié'} par <@${interaction.user.id}>.`, COLORS.INFO)
        );
        return;
      }

      // nom / description : valeur obligatoire.
      if (!valeur) {
        return interaction.reply({ content: '❌ Indiquez une **valeur** pour ce champ.', flags: MessageFlags.Ephemeral });
      }
      const column = { nom: 'name', description: 'description' }[champ];
      if (champ === 'nom' && getByName.get(RP_SCOPE, valeur)) {
        return interaction.reply({ content: `❌ Une entreprise nommée **${valeur}** existe déjà.`, flags: MessageFlags.Ephemeral });
      }
      db.prepare(`UPDATE enterprises SET ${column} = ? WHERE id = ?`).run(valeur, ent.id);
      const updated = getById.get(ent.id);
      const { embed, extraContent } = enterpriseReply(updated);
      await interaction.reply({
        content: `✅ Champ **${champ}** mis à jour.${extraContent ? `\n${extraContent}` : ''}`,
        embeds: [embed],
      });
      await sendLog(
        interaction.guild,
        logEmbed('🏢 Entreprise modifiée', `**${ent.name}** : champ **${champ}** modifié par <@${interaction.user.id}>.`, COLORS.INFO)
      );
      return;
    }

    if (sub === 'supprimer') {
      deleteEnterprise.run(ent.id);
      await interaction.reply({ content: `🗑️ Entreprise **${ent.name}** supprimée (patrons, employés et véhicules assurés inclus).` });
      await sendLog(
        interaction.guild,
        logEmbed('🏢 Entreprise supprimée', `**${ent.name}** supprimée par <@${interaction.user.id}>.`, COLORS.DANGER)
      );
      return;
    }

    if (sub === 'patron') {
      const action = interaction.options.getString('action');
      const user = interaction.options.getUser('utilisateur');
      if (action === 'ajouter') {
        addHead.run(ent.id, user.id);
        await interaction.reply({ content: `👑 <@${user.id}> est maintenant à la tête de **${ent.name}**.` });
      } else {
        removeHead.run(ent.id, user.id);
        await interaction.reply({ content: `👑 <@${user.id}> n'est plus à la tête de **${ent.name}**.` });
      }
      await sendLog(
        interaction.guild,
        logEmbed(
          '🏢 Direction modifiée',
          `**${ent.name}** : <@${user.id}> ${action === 'ajouter' ? 'ajouté à' : 'retiré de'} la direction par <@${interaction.user.id}>.`,
          COLORS.INFO
        )
      );
      return;
    }

    if (sub === 'employe') {
      // Staff OU patron de cette entreprise.
      const isPatron = !!isHead.get(ent.id, interaction.user.id);
      if (!isStaff && !isPatron) {
        return interaction.reply({
          content: '⛔ Sécurité : réservé au **staff** ou aux **patrons** de cette entreprise.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const action = interaction.options.getString('action');
      const user = interaction.options.getUser('utilisateur');
      if (action === 'ajouter') {
        addEmployee.run(ent.id, user.id);
        await interaction.reply({ content: `👥 <@${user.id}> est maintenant employé de **${ent.name}**.` });
      } else {
        removeEmployee.run(ent.id, user.id);
        await interaction.reply({ content: `👥 <@${user.id}> n'est plus employé de **${ent.name}**.` });
      }
    }
  },
};
