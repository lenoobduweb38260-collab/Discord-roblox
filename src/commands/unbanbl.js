const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { db } = require('../database');
const { GRADES } = require('../utils/permissions');
const { hasPerm, removeBlacklist, getBlacklistRow } = require('../utils/botTeam');
const { sendLog, logEmbed, COLORS } = require('../utils/embeds');
const { repondreVite } = require('../utils/reponse');

const getGlobalBan = db.prepare('SELECT * FROM global_bans WHERE user_id = ?');
const removeGlobalBan = db.prepare('DELETE FROM global_bans WHERE user_id = ?');

// 🔓 /unban-bl — réservé au STAFF DU BOT (permission 🚫 blacklist), pas au
// staff d'un serveur : l'automatisme de ban est global, sa levée aussi.
//
// « Annuler l'automatisme » veut dire DEUX choses, et il faut les deux :
// effacer la ligne de blacklist ET la ligne de ban global — chacune re-bannit
// à l'arrivée (voir guildMemberAdd) — puis débannir sur tous les serveurs du
// bot. N'en lever qu'une laisserait l'autre re-bannir au prochain retour.
module.exports = {
  grade: GRADES.EVERYONE, // contrôle réel ci-dessous : permission 'blacklist' du staff du bot
  public: true,
  guildModule: null,

  data: new SlashCommandBuilder()
    .setName('unban-bl')
    .setDescription('[Staff du bot] Lever la blacklist et le ban automatique d\'un utilisateur, partout')
    .addUserOption((o) =>
      o.setName('utilisateur').setDescription('L\'utilisateur dont on lève l\'automatisme de ban').setRequired(true)
    ),

  async execute(interaction) {
    if (!(await hasPerm(interaction.client, interaction.user.id, 'blacklist'))) {
      return interaction.reply({
        content: '⛔ Réservé au **staff du bot** (permission 🚫 blacklist — voir `/botstaff`).',
        flags: MessageFlags.Ephemeral,
      });
    }
    const user = interaction.options.getUser('utilisateur');

    return repondreVite(interaction, async () => {
      const enBlacklist = Boolean(getBlacklistRow.get(user.id));
      const enBanGlobal = Boolean(getGlobalBan.get(user.id));
      if (!enBlacklist && !enBanGlobal) {
        return {
          content:
            `📭 <@${user.id}> n'est **ni blacklisté ni banni globalement** : aucun automatisme à lever.\n` +
            '-# Pour un ban posé à la main sur CE serveur : la liste des bannis du serveur, ou `/unban-all`.',
        };
      }

      if (enBanGlobal) removeGlobalBan.run(user.id);
      // removeBlacklist journalise la levée et débannit sur TOUS les serveurs.
      // Sans ligne de blacklist, on fait nous-même le tour des serveurs plutôt
      // que d'écrire un faux « deblacklist » dans l'historique.
      let unbanned = 0;
      if (enBlacklist) {
        unbanned = (await removeBlacklist(interaction.client, user.id, interaction.user.id)).unbanned;
      } else {
        for (const guild of interaction.client.guilds.cache.values()) {
          const ok = await guild.members
            .unban(user.id, `Levée du ban automatique par ${interaction.user.tag}`)
            .then(() => true)
            .catch(() => false);
          if (ok) unbanned++;
        }
      }

      const leves = [enBlacklist ? '🚫 blacklist du bot' : null, enBanGlobal ? '🌍 ban global' : null].filter(Boolean);
      await sendLog(
        interaction.guild,
        logEmbed(
          '🔓 Automatisme de ban levé',
          `${leves.join(' + ')} de <@${user.id}> (\`${user.id}\`) levé(s) par <@${interaction.user.id}> — ` +
            `débanni sur **${unbanned}** serveur(s).`,
          COLORS.SUCCESS
        )
      );
      return {
        content:
          `🔓 Automatisme de ban **levé** pour <@${user.id}> : ${leves.join(' **et** ')} retiré(s).\n` +
          `➜ Débanni sur **${unbanned}** serveur(s) — il peut revenir sans être re-banni.`,
      };
    });
  },
};
