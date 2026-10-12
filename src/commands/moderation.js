const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { db } = require('../database');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');
const { isImmune } = require('../utils/botTeam');

const IMMUNE_MSG = '🛡️ Cet utilisateur est **immunisé** (créateur du bot ou liste d\'immunité) : action refusée.';

const insertGlobalBan = db.prepare(
  'INSERT OR REPLACE INTO global_bans (user_id, reason, banned_by, banned_at) VALUES (?, ?, ?, ?)'
);
const removeGlobalBan = db.prepare('DELETE FROM global_bans WHERE user_id = ?');
const getGlobalBan = db.prepare('SELECT * FROM global_bans WHERE user_id = ?');

module.exports = [
  {
    grade: GRADES.STAFF,
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('[Staff] Bannir un membre du serveur')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption((o) => o.setName('utilisateur').setDescription('Membre à bannir').setRequired(true))
      .addStringOption((o) => o.setName('raison').setDescription('Raison du ban').setRequired(false))
      .addIntegerOption((o) =>
        o.setName('jours_messages').setDescription('Supprimer ses messages des X derniers jours (0-7)')
          .setMinValue(0).setMaxValue(7).setRequired(false)
      ),
    async execute(interaction) {
      const user = interaction.options.getUser('utilisateur');
      if (await isImmune(interaction.client, user.id)) {
        return interaction.reply({ content: IMMUNE_MSG, flags: MessageFlags.Ephemeral });
      }
      const raison = interaction.options.getString('raison') || 'Aucune raison précisée';
      const jours = interaction.options.getInteger('jours_messages') || 0;
      await interaction.guild.members.ban(user.id, {
        reason: `${raison} — par ${interaction.user.tag}`,
        deleteMessageSeconds: jours * 86400,
      });
      await interaction.reply({ content: `🔨 <@${user.id}> a été **banni**.\n**Raison :** ${raison}` });
      await sendLog(
        interaction.guild,
        logEmbed('🔨 Ban', `<@${user.id}> (\`${user.id}\`) banni par <@${interaction.user.id}>.\n**Raison :** ${raison}`, COLORS.DANGER)
      );
    },
  },
  {
    grade: GRADES.STAFF,
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('[Staff] Expulser un membre du serveur')
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption((o) => o.setName('utilisateur').setDescription('Membre à expulser').setRequired(true))
      .addStringOption((o) => o.setName('raison').setDescription("Raison de l'expulsion").setRequired(false)),
    async execute(interaction) {
      const user = interaction.options.getUser('utilisateur');
      if (await isImmune(interaction.client, user.id)) {
        return interaction.reply({ content: IMMUNE_MSG, flags: MessageFlags.Ephemeral });
      }
      const raison = interaction.options.getString('raison') || 'Aucune raison précisée';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        return interaction.reply({ content: '❌ Membre introuvable sur le serveur.', flags: MessageFlags.Ephemeral });
      }
      await member.kick(`${raison} — par ${interaction.user.tag}`);
      await interaction.reply({ content: `👢 <@${user.id}> a été **expulsé**.\n**Raison :** ${raison}` });
      await sendLog(
        interaction.guild,
        logEmbed('👢 Kick', `<@${user.id}> (\`${user.id}\`) expulsé par <@${interaction.user.id}>.\n**Raison :** ${raison}`, COLORS.WARNING)
      );
    },
  },
  {
    grade: GRADES.STAFF,
    data: new SlashCommandBuilder()
      .setName('mute')
      .setDescription('[Staff] Rendre muet un membre (timeout Discord)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('utilisateur').setDescription('Membre à mute').setRequired(true))
      .addIntegerOption((o) =>
        o.setName('duree').setDescription('Durée en minutes (max 40320 = 28 jours)')
          .setRequired(true).setMinValue(1).setMaxValue(40320)
      )
      .addStringOption((o) => o.setName('raison').setDescription('Raison du mute').setRequired(false)),
    async execute(interaction) {
      const user = interaction.options.getUser('utilisateur');
      if (await isImmune(interaction.client, user.id)) {
        return interaction.reply({ content: IMMUNE_MSG, flags: MessageFlags.Ephemeral });
      }
      const duree = interaction.options.getInteger('duree');
      const raison = interaction.options.getString('raison') || 'Aucune raison précisée';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        return interaction.reply({ content: '❌ Membre introuvable sur le serveur.', flags: MessageFlags.Ephemeral });
      }
      await member.timeout(duree * 60_000, `${raison} — par ${interaction.user.tag}`);
      await interaction.reply({
        content: `🔇 <@${user.id}> est **muet** pendant **${duree}** minute(s).\n**Raison :** ${raison}`,
      });
      await sendLog(
        interaction.guild,
        logEmbed('🔇 Mute', `<@${user.id}> mute ${duree} min par <@${interaction.user.id}>.\n**Raison :** ${raison}`, COLORS.WARNING)
      );
    },
  },
  {
    grade: GRADES.STAFF,
    data: new SlashCommandBuilder()
      .setName('unmute')
      .setDescription('[Staff] Retirer le mute d\'un membre')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName('utilisateur').setDescription('Membre à démute').setRequired(true)),
    async execute(interaction) {
      const user = interaction.options.getUser('utilisateur');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        return interaction.reply({ content: '❌ Membre introuvable sur le serveur.', flags: MessageFlags.Ephemeral });
      }
      await member.timeout(null, `Unmute par ${interaction.user.tag}`);
      await interaction.reply({ content: `🔊 <@${user.id}> n'est plus muet.` });
      await sendLog(
        interaction.guild,
        logEmbed('🔊 Unmute', `<@${user.id}> démute par <@${interaction.user.id}>.`, COLORS.SUCCESS)
      );
    },
  },
  {
    // Sécurité grade élevé : le ban global est réservé à l'administration.
    grade: GRADES.ADMIN,
    data: new SlashCommandBuilder()
      .setName('banglobal')
      .setDescription('[Admin] Ban global : bannit sur tous les serveurs du bot + auto-ban à l\'arrivée')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand((sub) =>
        sub
          .setName('ajouter')
          .setDescription('Ajouter un ban global')
          .addUserOption((o) => o.setName('utilisateur').setDescription('Utilisateur à bannir globalement').setRequired(true))
          .addStringOption((o) => o.setName('raison').setDescription('Raison').setRequired(false))
      )
      .addSubcommand((sub) =>
        sub
          .setName('retirer')
          .setDescription('Retirer un ban global (débannit sur tous les serveurs)')
          .addUserOption((o) => o.setName('utilisateur').setDescription('Utilisateur à débannir').setRequired(true))
      ),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const user = interaction.options.getUser('utilisateur');
      await interaction.deferReply();

      if (sub === 'ajouter') {
        if (await isImmune(interaction.client, user.id)) {
          return interaction.editReply(IMMUNE_MSG);
        }
        const raison = interaction.options.getString('raison') || 'Aucune raison précisée';
        insertGlobalBan.run(user.id, raison, interaction.user.id, new Date().toISOString());
        let count = 0;
        for (const guild of interaction.client.guilds.cache.values()) {
          const ok = await guild.members
            .ban(user.id, { reason: `Ban global : ${raison} — par ${interaction.user.tag}` })
            .then(() => true)
            .catch(() => false);
          if (ok) count++;
        }
        await interaction.editReply(
          `🌍🔨 <@${user.id}> est **banni globalement** (appliqué sur **${count}** serveur(s), et automatiquement à chaque arrivée future).\n**Raison :** ${raison}`
        );
        await sendLog(
          interaction.guild,
          logEmbed('🌍 Ban global', `<@${user.id}> (\`${user.id}\`) banni globalement par <@${interaction.user.id}>.\n**Raison :** ${raison}`, COLORS.DANGER)
        );
        return;
      }

      if (!getGlobalBan.get(user.id)) {
        return interaction.editReply(`❌ <@${user.id}> n'est pas dans la liste des bans globaux.`);
      }
      removeGlobalBan.run(user.id);
      let count = 0;
      for (const guild of interaction.client.guilds.cache.values()) {
        const ok = await guild.members.unban(user.id, `Retrait du ban global par ${interaction.user.tag}`)
          .then(() => true)
          .catch(() => false);
        if (ok) count++;
      }
      await interaction.editReply(
        `🌍✅ Ban global de <@${user.id}> retiré (débanni sur **${count}** serveur(s)).`
      );
      await sendLog(
        interaction.guild,
        logEmbed('🌍 Ban global retiré', `Ban global de <@${user.id}> retiré par <@${interaction.user.id}>.`, COLORS.SUCCESS)
      );
    },
  },
  {
    // Sécurité grade élevé : lever TOUS les bans d'un coup est réservé à
    // l'administration — il n'y a pas de retour en arrière groupé.
    grade: GRADES.ADMIN,
    data: new SlashCommandBuilder()
      .setName('unban-all')
      .setDescription('[Admin] Débannir TOUS les bannis de ce serveur d\'un coup')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
      const { repondreVite } = require('../utils/reponse');
      const { getBlacklistRow } = require('../utils/botTeam');
      return repondreVite(interaction, async () => {
        // Discord pagine la liste des bans par 1000 : on ramasse tout.
        const bannis = new Map();
        let apres;
        for (;;) {
          const page = await interaction.guild.bans.fetch({ limit: 1000, after: apres }).catch(() => null);
          if (!page?.size) break;
          for (const [id, ban] of page) bannis.set(id, ban);
          if (page.size < 1000) break;
          apres = [...page.keys()].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)).pop();
        }
        if (!bannis.size) return { content: '📭 Aucun banni sur ce serveur : rien à lever.' };

        let leves = 0;
        const automatiques = []; // blacklist / ban global : re-bannis à leur retour
        for (const id of bannis.keys()) {
          const ok = await interaction.guild.members
            .unban(id, `Unban général par ${interaction.user.tag}`)
            .then(() => true)
            .catch(() => false);
          if (ok) leves++;
          if (ok && (getBlacklistRow.get(id) || getGlobalBan.get(id))) automatiques.push(id);
        }

        await sendLog(
          interaction.guild,
          logEmbed('🔓 Unban général', `<@${interaction.user.id}> a levé **${leves}** ban(s) sur **${bannis.size}**.`, COLORS.SUCCESS)
        );
        const lignes = [`🔓 **${leves}** ban(s) levé(s) sur **${bannis.size}** sur ce serveur.`];
        // ⚠️ L'unban local ne lève PAS les automatismes globaux : sans ce mot,
        // on croirait la commande cassée quand ces membres seront re-bannis.
        if (automatiques.length) {
          lignes.push(
            `-# ⚠️ ${automatiques.length} d'entre eux restent **blacklistés ou bannis globalement** : ils seront ` +
              're-bannis à leur retour. Pour lever l\'automatisme : `/unban-bl` (staff du bot) ou `/banglobal retirer`.'
          );
        }
        return { content: lignes.join('\n') };
      });
    },
  },
];
