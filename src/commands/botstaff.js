const { SlashCommandBuilder, EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const {
  PERMS,
  isCreator,
  hasPerm,
  listStaffRows,
  getStaffRow,
  insertStaff,
  updatePerms,
  deleteStaff,
} = require('../utils/botTeam');
const { setHq, hq } = require('../utils/botTickets');

// /botstaff : hiérarchie de l'équipe du bot, gérée par le créateur (et les
// membres ayant la permission 🛡️ Gestion du staff). Indépendante des serveurs.

const permChoices = Object.entries(PERMS).map(([value, name]) => ({ name, value }));

module.exports = {
  grade: GRADES.EVERYONE, // contrôle interne : créateur / permission staff
  data: new SlashCommandBuilder()
    .setName('botstaff')
    .setDescription('[Équipe du bot] Gérer la hiérarchie du staff du bot')
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('Ajouter un membre au staff du bot (ou changer son grade)')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre à ajouter').setRequired(true))
        .addStringOption((o) =>
          o.setName('grade').setDescription('Grade dans la hiérarchie (ex : Responsable, Modérateur)').setRequired(true).setMaxLength(50)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Retirer un membre du staff du bot')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre à retirer').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('permission')
        .setDescription('Donner ou retirer une permission à un membre du staff')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre du staff').setRequired(true))
        .addStringOption((o) =>
          o.setName('permission').setDescription('Permission à modifier').setRequired(true).addChoices(...permChoices)
        )
        .addStringOption((o) =>
          o
            .setName('etat')
            .setDescription('Donner ou retirer')
            .setRequired(true)
            .addChoices({ name: '✅ Donner', value: 'on' }, { name: '❌ Retirer', value: 'off' })
        )
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir la hiérarchie du staff du bot'))
    .addSubcommand((sub) =>
      sub
        .setName('salon-qg')
        .setDescription('[Créateur] Définir le salon QG des tickets (bans + reports de tous les serveurs)')
        .addChannelOption((o) =>
          o.setName('salon').setDescription('Salon QG').addChannelTypes(ChannelType.GuildText).setRequired(true)
        )
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const creator = await isCreator(interaction.client, interaction.user.id);

    if (sub === 'salon-qg') {
      if (!creator) {
        return interaction.reply({ content: '⛔ Sécurité : seul le **créateur du bot** peut définir le salon QG.', flags: MessageFlags.Ephemeral });
      }
      const channel = interaction.options.getChannel('salon');
      setHq(interaction.guildId, channel.id);
      return interaction.reply(
        `🏛️ Salon QG des tickets défini : ${channel}. Les **bannissements** et les **/report** de tous les serveurs du bot y arriveront en embeds.`
      );
    }

    if (sub === 'liste') {
      const M = require('../utils/miseEnPage');
      const rows = listStaffRows.all();
      // 🧱 Un bloc par grade : en-tête ◆ avec le nombre, puis les membres
      // en ➜, et « Aucun membre » en italique quand un grade est vide.
      const parGrade = new Map();
      for (const r of rows) {
        if (!parGrade.has(r.rank)) parGrade.set(r.rank, []);
        let perms = [];
        try { perms = JSON.parse(r.perms); } catch {}
        parGrade.get(r.rank).push(
          `<@${r.user_id}>${perms.length ? ` — ${perms.map((p) => PERMS[p] || p).join(' · ')}` : ''}`
        );
      }
      const blocs = [...parGrade.entries()].map(([grade, membres]) =>
        M.bloc(grade, membres, { prefixe: '🛡️', vide: 'Aucun membre' })
      );
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('🛡️ Hiérarchie du staff du bot')
        .setDescription(
          blocs.length
            ? M.description(blocs)
            : '*Aucun membre — le créateur du bot a toutes les permissions.*'
        )
        .setFooter({
          text: M.piedDePage({
            total: rows.length,
            motTotal: 'membre',
            extra: hq() ? 'QG configuré ✅' : 'QG non configuré — /botstaff salon-qg',
          }),
        });
      return interaction.reply({ embeds: [embed] });
    }

    // ajouter / retirer / permission : créateur ou permission 🛡️ Gestion du staff.
    if (!creator && !(await hasPerm(interaction.client, interaction.user.id, 'staff'))) {
      return interaction.reply({
        content: '⛔ Sécurité : réservé au **créateur du bot** et aux membres ayant la permission 🛡️ Gestion du staff.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const target = interaction.options.getUser('utilisateur');

    if (sub === 'ajouter') {
      const rank = interaction.options.getString('grade').trim();
      insertStaff.run(target.id, rank, '[]', interaction.user.id, new Date().toISOString());
      return interaction.reply(
        `✅ <@${target.id}> est maintenant **${rank}** dans le staff du bot.\n` +
          'Donnez-lui ses permissions : `/botstaff permission utilisateur permission état`.'
      );
    }

    if (sub === 'retirer') {
      if (!getStaffRow.get(target.id)) {
        return interaction.reply({ content: `❌ <@${target.id}> n'est pas dans le staff du bot.`, flags: MessageFlags.Ephemeral });
      }
      deleteStaff.run(target.id);
      return interaction.reply(`🗑 <@${target.id}> a été retiré du staff du bot.`);
    }

    if (sub === 'permission') {
      const row = getStaffRow.get(target.id);
      if (!row) {
        return interaction.reply({
          content: `❌ <@${target.id}> n'est pas dans le staff du bot — ajoutez-le d'abord avec \`/botstaff ajouter\`.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      const perm = interaction.options.getString('permission');
      const enable = interaction.options.getString('etat') === 'on';
      let perms = [];
      try {
        perms = JSON.parse(row.perms);
      } catch {}
      perms = perms.filter((p) => p !== perm);
      if (enable) perms.push(perm);
      updatePerms.run(JSON.stringify(perms), target.id);
      return interaction.reply(
        `${enable ? '✅' : '❌'} ${PERMS[perm]} ${enable ? 'donnée à' : 'retirée à'} <@${target.id}> (**${row.rank}**).\n` +
          `Permissions actuelles : ${perms.length ? perms.map((p) => PERMS[p]).join(' · ') : '*aucune*'}`
      );
    }
  },
};
