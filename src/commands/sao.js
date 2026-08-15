const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { getGuildConfig } = require('../database');
const { COLORS } = require('../utils/embeds');
const G = require('../utils/saoGame');

// ----- ⚔️ Aventure SAO -----
// Jeu d'aventure interactif (façon « Aventure » de Koya) sur le thème Sword Art
// Online : gravis les 100 étages d'Aincrad, chasse des monstres, bats les boss
// d'étage (combat au tour par tour via boutons), forge des armes et gagne des
// récompenses : badges perso (titres), XP serveur automatique et gains AFK.

const HUNT_CD_MS = 15 * 1000;
const AFK_MIN_MIN = 5; // il faut au moins 5 min hors-ligne pour un claim AFK

// Combats de boss en cours (état vivant, en mémoire) : "guild:user" -> fight.
const fights = new Map();
const fightKey = (i) => `${i.guildId}:${i.user.id}`;

// ----- Aides d'affichage -----
function floorLabel(p) {
  return p.floor > G.MAX_FLOOR ? '👑 Aincrad conquis' : `🏯 Étage ${p.floor} / ${G.MAX_FLOOR}`;
}
function titleLabel(p) {
  if (!p.title || !G.BADGES[p.title]) return '*aucun*';
  const b = G.BADGES[p.title];
  return `${b.emoji} ${b.name}`;
}

function profileEmbed(user, p) {
  const maxHp = G.maxHp(p.level);
  const need = G.xpForLevel(p.level);
  const weapon = G.WEAPONS[p.weapon];
  return new EmbedBuilder()
    .setColor(p.floor > G.MAX_FLOOR ? 0xffd700 : 0x5865f2)
    .setAuthor({ name: `Aventurier ${user.username}`, iconURL: user.displayAvatarURL({ size: 64 }) })
    .setTitle(floorLabel(p))
    .addFields(
      { name: '❤️ PV', value: `${p.hp} / ${maxHp}\n${G.bar(p.hp, maxHp)}`, inline: true },
      { name: '⭐ Niveau', value: `**${p.level}**\n${p.xp} / ${need} XP`, inline: true },
      { name: '💰 Col', value: `${p.col}`, inline: true },
      { name: '🗡️ Arme', value: `${weapon.name}`, inline: true },
      { name: '⚔️ Attaque', value: `${G.playerAtk(p)}`, inline: true },
      { name: '🏅 Titre', value: titleLabel(p), inline: true }
    )
    .setFooter({ text: 'Aventure SAO · /sao chasser · /sao boss · /sao afk' });
}

function bossEmbed(fight, user) {
  const embed = new EmbedBuilder()
    .setColor(0xa61c1c)
    .setTitle(`🐉 ${fight.bossName}`)
    .setDescription(`**Boss de l'étage ${fight.floor}**\nQue le duel commence, <@${user.id}> !`)
    .addFields(
      { name: `👹 ${fight.bossName}`, value: `${Math.max(0, fight.bHp)} / ${fight.bMax} PV\n${G.bar(fight.bHp, fight.bMax)}`, inline: false },
      { name: `🛡️ ${user.username}`, value: `${Math.max(0, fight.pHp)} / ${fight.pMax} PV\n${G.bar(fight.pHp, fight.pMax)}`, inline: false }
    );
  if (fight.log) embed.addFields({ name: '📜 Dernier tour', value: fight.log });
  return embed;
}

function bossButtons(userId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sao:atk:${userId}`).setLabel('Attaquer').setEmoji('⚔️').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`sao:flee:${userId}`).setLabel('Fuir').setEmoji('🏃').setStyle(ButtonStyle.Secondary).setDisabled(disabled)
  );
}

function badgeLine(key, owned) {
  const b = G.BADGES[key];
  return `${owned.includes(key) ? '✅' : '🔒'} ${b.emoji} **${b.name}** — ${b.desc}`;
}

// ----- Combat de chasse (auto-résolu) -----
function huntFight(p) {
  const floor = p.floor > G.MAX_FLOOR ? G.MAX_FLOOR : p.floor;
  const mob = G.MOBS[Math.floor(Math.random() * G.MOBS.length)];
  let mHp = G.mobHp(floor);
  const mAtk = G.mobAtk(floor);
  const pAtk = G.playerAtk(p);
  let dealt = 0;
  let taken = 0;
  for (let round = 0; round < 40 && mHp > 0 && p.hp > 0; round++) {
    const hit = G.strike(pAtk);
    mHp -= hit.dmg;
    dealt += hit.dmg;
    if (mHp <= 0) break;
    const back = G.strike(mAtk);
    p.hp = Math.max(0, p.hp - back.dmg);
    taken += back.dmg;
  }
  if (p.hp <= 0) {
    const lost = Math.floor(p.col * 0.1);
    p.col = Math.max(0, p.col - lost);
    p.hp = G.maxHp(p.level);
    return { win: false, mob, lostCol: lost, taken };
  }
  const xpGain = 15 + floor * 3 + Math.floor(Math.random() * 8);
  const colGain = 10 + floor * 4 + Math.floor(Math.random() * 10);
  p.col += colGain;
  const levels = G.gainXp(p, xpGain);
  return { win: true, mob, xpGain, colGain, levels, dealt, taken };
}

// ----- Récompenses partagées : badges nouvellement gagnés → texte -----
function badgesText(keys) {
  if (!keys.length) return '';
  return '\n🏅 **Nouveau(x) badge(s) :** ' + keys.map((k) => `${G.BADGES[k].emoji} ${G.BADGES[k].name}`).join(', ');
}

module.exports = {
  grade: GRADES.EVERYONE,
  public: true, // module de jeu : réponses visibles par tout le monde dans le salon
  guildModule: 'sao', // module désactivé par défaut, activable par serveur via /config
  data: new SlashCommandBuilder()
    .setName('sao')
    .setDescription('Aventure SAO : gravis les 100 étages d\'Aincrad')
    .addSubcommand((s) => s.setName('start').setDescription('Rejoindre Aincrad et créer ton personnage'))
    .addSubcommand((s) =>
      s
        .setName('profil')
        .setDescription('Voir ta fiche d\'aventurier (ou celle d\'un membre)')
        .addUserOption((o) => o.setName('membre').setDescription('Membre (défaut : vous)').setRequired(false))
    )
    .addSubcommand((s) => s.setName('chasser').setDescription('Chasser un monstre sur ton étage actuel'))
    .addSubcommand((s) => s.setName('boss').setDescription('Affronter le boss de ton étage actuel'))
    .addSubcommand((s) => s.setName('afk').setDescription('Récupérer les gains accumulés hors-ligne (AFK)'))
    .addSubcommand((s) => s.setName('forge').setDescription('Forger / améliorer ton arme avec des Col'))
    .addSubcommand((s) => s.setName('soin').setDescription('Te soigner à l\'auberge (coûte des Col)'))
    .addSubcommand((s) =>
      s
        .setName('badges')
        .setDescription('Voir les badges d\'aventurier')
        .addUserOption((o) => o.setName('membre').setDescription('Membre (défaut : vous)').setRequired(false))
    )
    .addSubcommand((s) =>
      s
        .setName('titre')
        .setDescription('Équiper un badge comme titre (vide = retirer)')
        .addStringOption((o) => o.setName('badge').setDescription('Badge à équiper').setRequired(false).setAutocomplete(true))
    )
    .addSubcommand((s) => s.setName('classement').setDescription('Classement des aventuriers du serveur')),

  async autocomplete(interaction) {
    const owned = G.ownedBadges(interaction.guildId, interaction.user.id);
    const focused = (interaction.options.getFocused() || '').toLowerCase();
    const choices = owned
      .filter((k) => G.BADGES[k])
      .map((k) => ({ name: `${G.BADGES[k].emoji} ${G.BADGES[k].name}`, value: k }))
      .filter((c) => c.name.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const g = interaction.guildId;
    const u = interaction.user.id;

    // ----- start -----
    if (sub === 'start') {
      const { player, created } = G.ensurePlayer(g, u);
      if (!created) {
        return interaction.reply({
          content: '🎮 Tu es déjà un aventurier ! Voici ta fiche :',
          embeds: [profileEmbed(interaction.user, player)],
        });
      }
      G.award(g, u, 'debutant');
      await G.grantServerXp(interaction.guild, u, 20, interaction.channel);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('⚔️ Bienvenue dans Aincrad')
        .setDescription(
          `<@${u}>, te voilà piégé dans **Sword Art Online**. Pour recouvrer ta liberté, il te faudra vaincre les **100 boss d'étage** de ce château flottant.\n\n` +
            '• `/sao chasser` — combattre des monstres et gagner de l\'XP + des Col\n' +
            '• `/sao boss` — affronter le boss de ton étage pour monter d\'un cran\n' +
            '• `/sao forge` — forger de meilleures armes\n' +
            '• `/sao afk` — récolter des gains même hors-ligne\n' +
            '• `/sao badges` / `/sao titre` — débloquer et équiper des badges perso\n\n' +
            '🏅 Badge débloqué : 🗡️ **Débutant** — et un petit bonus d\'XP serveur pour bien démarrer !'
        );
      return interaction.reply({ embeds: [embed] });
    }

    // Toutes les autres actions nécessitent un personnage (sauf consultation d'autrui).
    if (sub === 'profil') {
      const target = interaction.options.getUser('membre') || interaction.user;
      const p = G.getPlayer(g, target.id);
      if (!p) {
        return interaction.reply({
          content: target.id === u ? '🕹️ Tu n\'as pas encore de personnage. Fais `/sao start` !' : `📭 **${target.username}** n'a pas encore rejoint l'aventure.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.reply({ embeds: [profileEmbed(target, p)] });
    }

    if (sub === 'badges') {
      const target = interaction.options.getUser('membre') || interaction.user;
      const p = G.getPlayer(g, target.id);
      const owned = G.ownedBadges(g, target.id);
      const embed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle(`🏅 Badges de ${target.username} (${owned.length}/${Object.keys(G.BADGES).length})`)
        .setDescription(Object.keys(G.BADGES).map((k) => badgeLine(k, owned)).join('\n'));
      if (p?.title && G.BADGES[p.title]) embed.setFooter({ text: `Titre équipé : ${G.BADGES[p.title].name}` });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'classement') {
      const rows = G.leaderboard(g, 10);
      if (!rows.length) {
        return interaction.reply({ content: '📭 Aucun aventurier sur ce serveur. Sois le premier avec `/sao start` !', flags: MessageFlags.Ephemeral });
      }
      const medals = ['🥇', '🥈', '🥉'];
      const lines = rows.map((r, i) => {
        const where = r.floor > G.MAX_FLOOR ? '👑 Clear' : `étage ${r.floor}`;
        return `${medals[i] || `**${i + 1}.**`} <@${r.user_id}> — ${where}, niv. **${r.level}**`;
      });
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🏆 Classement — Aventure SAO').setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed] });
    }

    // À partir d'ici : actions nécessitant SON personnage.
    const p = G.getPlayer(g, u);
    if (!p) {
      return interaction.reply({ content: '🕹️ Tu n\'as pas encore de personnage. Fais `/sao start` pour commencer !', flags: MessageFlags.Ephemeral });
    }

    // ----- titre -----
    if (sub === 'titre') {
      const badge = interaction.options.getString('badge');
      if (!badge) {
        p.title = null;
        G.savePlayer(p);
        return interaction.reply({ content: '🧹 Titre retiré.', flags: MessageFlags.Ephemeral });
      }
      if (!G.BADGES[badge]) {
        return interaction.reply({ content: '❌ Badge inconnu.', flags: MessageFlags.Ephemeral });
      }
      if (!G.ownedBadges(g, u).includes(badge)) {
        return interaction.reply({ content: '🔒 Tu n\'as pas encore débloqué ce badge.', flags: MessageFlags.Ephemeral });
      }
      p.title = badge;
      G.savePlayer(p);
      return interaction.reply({ content: `🏅 Titre équipé : ${G.BADGES[badge].emoji} **${G.BADGES[badge].name}**.`, flags: MessageFlags.Ephemeral });
    }

    // ----- chasser -----
    if (sub === 'chasser') {
      const now = Date.now();
      const since = now - (Date.parse(p.last_hunt) || 0);
      if (since < HUNT_CD_MS) {
        const left = Math.ceil((HUNT_CD_MS - since) / 1000);
        return interaction.reply({ content: `⏳ Tu reprends ton souffle… réessaie dans **${left} s**.`, flags: MessageFlags.Ephemeral });
      }
      p.last_hunt = new Date().toISOString();
      const res = huntFight(p);
      const newBadges = res.win ? [G.award(g, u, 'premier_sang') ? 'premier_sang' : null, ...G.syncMilestoneBadges(p)].filter(Boolean) : [];
      G.savePlayer(p);
      const embed = new EmbedBuilder().setColor(res.win ? COLORS.SUCCESS : COLORS.DANGER);
      if (res.win) {
        embed
          .setTitle(`🗡️ Victoire contre ${res.mob} !`)
          .setDescription(
            `Tu infliges **${res.dealt}** dégâts et subis **${res.taken}**.\n` +
              `Gains : **+${res.xpGain} XP**, **+${res.colGain} Col**.` +
              (res.levels ? `\n⭐ **Niveau ${p.level} atteint !**` : '') +
              badgesText(newBadges) +
              `\n\n❤️ PV : ${p.hp}/${G.maxHp(p.level)} · 💰 ${p.col} Col`
          );
      } else {
        embed
          .setTitle(`💀 Vaincu par ${res.mob}…`)
          .setDescription(`Tu tombes au combat (perte de **${res.lostCol} Col**) mais tu réapparais en ville, PV restaurés.\n❤️ PV : ${p.hp}/${G.maxHp(p.level)} · 💰 ${p.col} Col\n\n🛌 Repose-toi puis retente ta chance.`);
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sao:hunt:${u}`).setLabel('Rechasser').setEmoji('🔁').setStyle(ButtonStyle.Primary)
      );
      return interaction.reply({ embeds: [embed], components: [row] });
    }

    // ----- afk -----
    if (sub === 'afk') {
      const now = Date.now();
      const elapsedMin = Math.min(G.AFK_CAP_MIN, (now - (Date.parse(p.last_afk) || now)) / 60000);
      if (elapsedMin < AFK_MIN_MIN) {
        return interaction.reply({ content: `😴 Reviens dans un moment : le farm AFK doit accumuler au moins **${AFK_MIN_MIN} min** (là : ${Math.floor(elapsedMin)} min).`, flags: MessageFlags.Ephemeral });
      }
      const floor = p.floor > G.MAX_FLOOR ? G.MAX_FLOOR : p.floor;
      const xpGain = Math.floor(elapsedMin * (2 + floor * 0.4));
      const colGain = Math.floor(elapsedMin * (1.5 + floor * 0.3));
      p.col += colGain;
      const levels = G.gainXp(p, xpGain);
      p.last_afk = new Date().toISOString();
      const newBadges = G.syncMilestoneBadges(p);
      G.savePlayer(p);
      const serverXp = Math.floor(xpGain / 4);
      await G.grantServerXp(interaction.guild, u, serverXp, interaction.channel);
      const embed = new EmbedBuilder()
        .setColor(0x9146ff)
        .setTitle('😴 Gains AFK récoltés')
        .setDescription(
          `Pendant **${Math.floor(elapsedMin)} min** hors-ligne, ton personnage a farmé :\n` +
            `➜ **+${xpGain} XP** d'aventure${levels ? ` (⭐ niveau ${p.level} !)` : ''}\n` +
            `➜ **+${colGain} Col**\n` +
            `➜ **+${serverXp} XP serveur** (auto)` +
            badgesText(newBadges) +
            `\n\n💰 Total : ${p.col} Col · ⭐ Niveau ${p.level}`
        );
      return interaction.reply({ embeds: [embed] });
    }

    // ----- soin -----
    if (sub === 'soin') {
      const maxHp = G.maxHp(p.level);
      if (p.hp >= maxHp) {
        return interaction.reply({ content: '💚 Tu es déjà en pleine forme.', flags: MessageFlags.Ephemeral });
      }
      const missing = maxHp - p.hp;
      const cost = missing * 3;
      if (p.col < cost) {
        return interaction.reply({ content: `💸 Il te faut **${cost} Col** pour te soigner (tu en as ${p.col}). Va chasser un peu !`, flags: MessageFlags.Ephemeral });
      }
      p.col -= cost;
      p.hp = maxHp;
      G.savePlayer(p);
      return interaction.reply({ content: `🏥 Soigné à l'auberge pour **${cost} Col**. ❤️ PV : ${p.hp}/${maxHp} · 💰 ${p.col} Col.`, flags: MessageFlags.Ephemeral });
    }

    // ----- forge -----
    if (sub === 'forge') {
      return interaction.reply(forgePayload(p, interaction.user));
    }

    // ----- boss -----
    if (sub === 'boss') {
      if (p.floor > G.MAX_FLOOR) {
        return interaction.reply({ content: '👑 Tu as déjà vaincu les 100 étages d\'Aincrad. Bravo, tu es libre !', flags: MessageFlags.Ephemeral });
      }
      const fight = {
        bossName: G.bossName(p.floor),
        floor: p.floor,
        bMax: G.bossHp(p.floor),
        bHp: G.bossHp(p.floor),
        bAtk: G.bossAtk(p.floor),
        pAtk: G.playerAtk(p),
        pMax: G.maxHp(p.level),
        pHp: p.hp > 0 ? p.hp : G.maxHp(p.level),
        log: null,
        over: false,
      };
      fights.set(fightKey(interaction), fight);
      return interaction.reply({ embeds: [bossEmbed(fight, interaction.user)], components: [bossButtons(u)] });
    }
  },

  // ----- Boutons (routés depuis interactionCreate, préfixe « sao: ») -----
  async handleButton(interaction) {
    const cfg = getGuildConfig(interaction.guildId);
    if (!cfg.sao_enabled) {
      return interaction.reply({ content: '⛔ Le module Aventure SAO est désactivé sur ce serveur.', flags: MessageFlags.Ephemeral });
    }
    const [, action, ownerId] = interaction.customId.split(':');
    if (ownerId && ownerId !== interaction.user.id) {
      return interaction.reply({ content: '⛔ Ce n\'est pas ton aventure — lance la tienne avec `/sao`.', flags: MessageFlags.Ephemeral });
    }
    const g = interaction.guildId;
    const u = interaction.user.id;

    if (action === 'hunt') {
      const now = Date.now();
      const p = G.getPlayer(g, u);
      if (!p) return interaction.reply({ content: '🕹️ Fais `/sao start` d\'abord.', flags: MessageFlags.Ephemeral });
      const since = now - (Date.parse(p.last_hunt) || 0);
      if (since < HUNT_CD_MS) {
        const left = Math.ceil((HUNT_CD_MS - since) / 1000);
        return interaction.reply({ content: `⏳ Encore **${left} s** avant de rechasser.`, flags: MessageFlags.Ephemeral });
      }
      p.last_hunt = new Date().toISOString();
      const res = huntFight(p);
      const newBadges = res.win ? [G.award(g, u, 'premier_sang') ? 'premier_sang' : null, ...G.syncMilestoneBadges(p)].filter(Boolean) : [];
      G.savePlayer(p);
      const embed = new EmbedBuilder().setColor(res.win ? COLORS.SUCCESS : COLORS.DANGER);
      if (res.win) {
        embed.setTitle(`🗡️ Victoire contre ${res.mob} !`).setDescription(
          `+**${res.xpGain} XP**, +**${res.colGain} Col**.` +
            (res.levels ? `\n⭐ **Niveau ${p.level} !**` : '') +
            badgesText(newBadges) +
            `\n❤️ ${p.hp}/${G.maxHp(p.level)} · 💰 ${p.col}`
        );
      } else {
        embed.setTitle(`💀 Vaincu par ${res.mob}…`).setDescription(`Perte de **${res.lostCol} Col**, PV restaurés.\n❤️ ${p.hp}/${G.maxHp(p.level)} · 💰 ${p.col}`);
      }
      return interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sao:hunt:${u}`).setLabel('Rechasser').setEmoji('🔁').setStyle(ButtonStyle.Primary)
      )] });
    }

    if (action === 'forgebuy') {
      const p = G.getPlayer(g, u);
      if (!p) return interaction.reply({ content: '🕹️ Fais `/sao start` d\'abord.', flags: MessageFlags.Ephemeral });
      if (p.weapon >= G.TOP_WEAPON) {
        return interaction.update(forgePayload(p, interaction.user));
      }
      const next = G.WEAPONS[p.weapon + 1];
      if (p.col < next.cost) {
        return interaction.reply({ content: `💸 Il te manque des Col (besoin de **${next.cost}**, tu as ${p.col}).`, flags: MessageFlags.Ephemeral });
      }
      p.col -= next.cost;
      p.weapon += 1;
      const forged = [];
      if (p.weapon >= G.TOP_WEAPON && G.award(g, u, 'forgeron')) forged.push('forgeron');
      G.savePlayer(p);
      const payload = forgePayload(p, interaction.user);
      payload.content = `🔨 Tu as forgé **${G.WEAPONS[p.weapon].name}** !${badgesText(forged)}`;
      return interaction.update(payload);
    }

    // ----- Combat de boss -----
    const key = fightKey(interaction);
    const fight = fights.get(key);
    if (!fight || fight.over) {
      return interaction.reply({ content: '⌛ Ce combat n\'est plus actif. Relance `/sao boss`.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'flee') {
      fight.over = true;
      fights.delete(key);
      const p = G.getPlayer(g, u);
      if (p) {
        p.hp = Math.max(1, fight.pHp);
        G.savePlayer(p);
      }
      const embed = new EmbedBuilder().setColor(COLORS.WARNING).setTitle('🏃 Fuite').setDescription(`Tu fuis **${fight.bossName}**… l'étage ${fight.floor} attendra. Reviens plus fort !`);
      return interaction.update({ embeds: [embed], components: [] });
    }

    if (action === 'atk') {
      // Le joueur frappe.
      const hit = G.strike(fight.pAtk);
      fight.bHp -= hit.dmg;
      let log = `Tu infliges **${hit.dmg}**${hit.crit ? ' 💥 CRITIQUE' : ''} à ${fight.bossName}.`;

      // Victoire ?
      if (fight.bHp <= 0) {
        fight.over = true;
        fights.delete(key);
        return interaction.update(await resolveVictory(interaction, fight));
      }

      // Le boss riposte.
      const back = G.strike(fight.bAtk);
      fight.pHp = Math.max(0, fight.pHp - back.dmg);
      log += `\n${fight.bossName} riposte : **${back.dmg}**${back.crit ? ' 💥' : ''} dégâts.`;
      fight.log = log;

      // Défaite ?
      if (fight.pHp <= 0) {
        fight.over = true;
        fights.delete(key);
        const p = G.getPlayer(g, u);
        let lost = 0;
        if (p) {
          lost = Math.floor(p.col * 0.15);
          p.col = Math.max(0, p.col - lost);
          p.hp = G.maxHp(p.level);
          G.savePlayer(p);
        }
        const embed = new EmbedBuilder()
          .setColor(COLORS.DANGER)
          .setTitle('💀 Défaite')
          .setDescription(`**${fight.bossName}** t'a terrassé (perte de **${lost} Col**). Tu réapparais en ville, PV restaurés.\n\n🔨 Forge une meilleure arme (\`/sao forge\`) puis retente !`);
        return interaction.update({ embeds: [embed], components: [] });
      }

      return interaction.update({ embeds: [bossEmbed(fight, interaction.user)], components: [bossButtons(u)] });
    }
  },
};

// Victoire sur un boss : montée d'étage, récompenses, badges, XP serveur auto.
async function resolveVictory(interaction, fight) {
  const g = interaction.guildId;
  const u = interaction.user.id;
  const p = G.getPlayer(g, u);
  const floor = fight.floor;
  const colGain = 100 + floor * 20;
  const advXp = 80 + floor * 10;
  const serverXp = 30 + floor * 5;
  let levels = 0;
  const newBadges = [];
  if (p) {
    p.col += colGain;
    levels = G.gainXp(p, advXp);
    p.floor = floor + 1;
    p.hp = G.maxHp(p.level); // repos complet après un boss
    if (G.award(g, u, 'boss_slayer')) newBadges.push('boss_slayer');
    if (p.floor > G.MAX_FLOOR && G.award(g, u, 'clear')) newBadges.push('clear');
    newBadges.push(...G.syncMilestoneBadges(p));
    G.savePlayer(p);
  }
  await G.grantServerXp(interaction.guild, u, serverXp, interaction.channel);
  const cleared = p && p.floor > G.MAX_FLOOR;
  const embed = new EmbedBuilder()
    .setColor(cleared ? 0xffd700 : COLORS.SUCCESS)
    .setTitle(cleared ? '👑 AINCRAD VAINCU !' : `🎉 Étage ${floor} nettoyé !`)
    .setDescription(
      `Tu terrasses **${fight.bossName}** !\n\n` +
        `Récompenses :\n• **+${colGain} Col**\n• **+${advXp} XP** d'aventure${levels ? ` (⭐ niveau ${p.level} !)` : ''}\n• **+${serverXp} XP serveur** (auto)` +
        badgesText(newBadges) +
        (cleared
          ? '\n\n🕊️ Tu as vaincu les 100 boss : te voilà **libéré de Sword Art Online**. Légende vivante !'
          : `\n\n➡️ Tu montes à l'**étage ${p ? p.floor : floor + 1}**. En avant !`)
    );
  return { embeds: [embed], components: [] };
}

// Panneau de forge (arme actuelle + suivante + bouton d'achat).
function forgePayload(p, user) {
  const cur = G.WEAPONS[p.weapon];
  const embed = new EmbedBuilder()
    .setColor(0xb8860b)
    .setTitle('🔨 Forge')
    .setDescription(`Aventurier **${user.username}** · 💰 **${p.col} Col**`)
    .addFields({ name: '🗡️ Arme actuelle', value: `**${cur.name}** (+${cur.atk} ATK)`, inline: false });
  const components = [];
  if (p.weapon >= G.TOP_WEAPON) {
    embed.addFields({ name: '🏆 Arme ultime', value: 'Tu possèdes déjà **l\'arme la plus puissante** d\'Aincrad !', inline: false });
  } else {
    const next = G.WEAPONS[p.weapon + 1];
    const canAfford = p.col >= next.cost;
    embed.addFields({
      name: '⏭️ Prochaine arme',
      value: `**${next.name}** (+${next.atk} ATK)\nCoût : **${next.cost} Col**${canAfford ? '' : ' — 💸 fonds insuffisants'}`,
      inline: false,
    });
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`sao:forgebuy:${p.user_id}`)
          .setLabel(`Forger (${next.cost} Col)`)
          .setEmoji('🔨')
          .setStyle(ButtonStyle.Success)
          .setDisabled(!canAfford)
      )
    );
  }
  return { embeds: [embed], components };
}
