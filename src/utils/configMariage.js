const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../database');
const { COLORS, sendLog, logEmbed } = require('./embeds');
const { mettreAJour } = require('./reponse');
const C = require('./couple');

// ⚙️ /config → 💍 Mariage : les avantages des couples, réglés par serveur.
// Identifiants `cfgmar:…` (aiguillés par handleConfigInteraction, donc déjà
// réservés au staff). Trois rangées sur les cinq permises.

// Le champ de la fenêtre, sa colonne, ses bornes et son libellé (≤ 45 signes).
const CHAMPS_MARIAGE = [
  { id: 'bonus', col: 'mariage_bonus_xp', bornes: C.BORNES_COUPLE.bonus, cle: 'bonus', label: 'Bonus d\'XP de couple, en % (0 à 100)', nom: 'le bonus d\'XP' },
  { id: 'lune', col: 'mariage_lune_de_miel_jours', bornes: C.BORNES_COUPLE.lune, cle: 'lune', label: 'Lune de miel, en jours (0 à 60)', nom: 'la lune de miel' },
  { id: 'bisou', col: 'mariage_bisou_xp', bornes: C.BORNES_COUPLE.bisouXp, cle: 'bisouXp', label: 'XP du bisou du jour, chacun (0 à 1000)', nom: 'l\'XP du bisou' },
  { id: 'actif', col: 'mariage_actif_minutes', bornes: C.BORNES_COUPLE.actifMinutes, cle: 'actifMinutes', label: 'Écart d\'activité commune, en min (1 à 120)', nom: 'l\'écart d\'activité' },
];

function retourPanneauMariage() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgback').setLabel('⬅ Retour au panneau').setStyle(ButtonStyle.Secondary)
  );
}

function mariageView(guild) {
  const cfg = getGuildConfig(guild.id);
  const r = C.reglagesCouple(cfg);
  const paliers = C.ALLIANCES_COUPLE
    .map((p) => `${p.emoji} ${p.nom}${p.jours ? ` *(${p.jours} j, +${p.bonus} %)*` : ''}`)
    .join(' → ');
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('💍 Configuration — Mariage')
    .setDescription('Les avantages des couples mariés avec `/mariage`.\nLe mariage suit les membres partout ; ces réglages ne valent que sur ce serveur.')
    .addFields(
      { name: '💝 Avantages du mariage', value: r.avantages ? '🟢 **Activés**' : '🔴 **Coupés**' },
      {
        name: '💞 Bonus d\'XP de couple',
        value: r.bonus
          ? `**+${r.bonus} %** quand les deux conjoints gagnent de l'XP ici à moins de **${r.actifMinutes} min** d'écart.`
          : '*Coupé (0 %)*',
      },
      {
        name: '🌙 Lune de miel',
        value: r.lune ? `${r.lune === 1 ? 'Le **premier jour**' : `Les **${r.lune} premiers jours**`} : bonus d'XP doublé.` : '*Aucune*',
      },
      { name: '💍 Alliances', value: `${paliers}\nChaque palier s'ajoute au bonus d'XP.` },
      {
        name: '🔥 Flamme du couple',
        value: `\`/mariage bisou\` une fois par jour chacun.${r.bisouXp ? ` Quand les deux l'ont fait : **+${r.bisouXp} XP** chacun.` : ''}`,
      },
      {
        name: '🎂 Annonces d\'anniversaire',
        value: r.salon
          ? `<#${r.salon}> · chaque mois la première année, puis chaque année.`
          : '*Aucun salon : pas d\'annonce.*',
      }
    );
  if (!cfg.interact_enabled) {
    embed.addFields({ name: '⚠️ Module Interactions coupé', value: '`/mariage` est indisponible ici tant qu\'il est coupé. Il se rallume dans 🎉 Communauté.' });
  }
  if (cfg.levels_enabled === 0) {
    embed.addFields({ name: '⚠️ Niveaux coupés', value: 'Les bonus d\'XP n\'ont aucun effet tant que les niveaux sont coupés (📈 XP & niveaux).' });
  }

  const salon = new ChannelSelectMenuBuilder()
    .setCustomId('cfgmar:salon')
    .setPlaceholder('🎂 Le salon des annonces d\'anniversaire (vide : aucun)')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(1);
  if (r.salon) salon.setDefaultChannels(r.salon);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(r.avantages ? 'cfgmar:off' : 'cfgmar:on')
          .setLabel(r.avantages ? 'Couper les avantages' : 'Activer les avantages')
          .setEmoji('💝')
          .setStyle(r.avantages ? ButtonStyle.Secondary : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cfgmar:nombres').setLabel('Modifier les valeurs').setEmoji('✏️').setStyle(ButtonStyle.Primary)
      ),
      new ActionRowBuilder().addComponents(salon),
      retourPanneauMariage(),
    ],
  };
}

function fenetreMariage(cfg) {
  const r = C.reglagesCouple(cfg);
  return new ModalBuilder()
    .setCustomId('cfgmar:modal')
    .setTitle('💍 Avantages du mariage')
    .addComponents(CHAMPS_MARIAGE.map((c) => new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(c.id)
        .setLabel(c.label)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(4)
        .setValue(String(r[c.cle]))
    )));
}

async function gererConfigMariage(interaction) {
  const id = interaction.customId;
  const guildId = interaction.guildId;
  const par = `Par <@${interaction.user.id}>`;

  if (id === 'cfgmar:on' || id === 'cfgmar:off') {
    const on = id === 'cfgmar:on' ? 1 : 0;
    setGuildConfig(guildId, 'mariage_avantages', on);
    await mettreAJour(interaction, mariageView(interaction.guild));
    await sendLog(interaction.guild, logEmbed('💍 Mariage', `Avantages du mariage ${on ? 'activés' : 'coupés'}.\n${par}`, on ? COLORS.SUCCESS : COLORS.DANGER));
    return;
  }

  if (id === 'cfgmar:nombres') {
    return interaction.showModal(fenetreMariage(getGuildConfig(guildId)));
  }

  if (id === 'cfgmar:salon') {
    const salonId = interaction.values?.[0] || null;
    setGuildConfig(guildId, 'mariage_salon_id', salonId);
    await mettreAJour(interaction, mariageView(interaction.guild));
    await sendLog(interaction.guild, logEmbed('⚙️ Configuration modifiée', `🎂 Salon des anniversaires de mariage → ${salonId ? `<#${salonId}>` : '*aucun*'}\n${par}`, COLORS.INFO));
    return;
  }

  if (id === 'cfgmar:modal') {
    const valeurs = {};
    const fautifs = [];
    for (const c of CHAMPS_MARIAGE) {
      const brut = String(interaction.fields.getTextInputValue(c.id) ?? '').trim();
      if (!/^\d{1,4}$/.test(brut)) fautifs.push(c.nom);
      else valeurs[c.col] = Math.min(c.bornes[1], Math.max(c.bornes[0], parseInt(brut, 10)));
    }
    if (fautifs.length) {
      return interaction.reply({
        content: `❌ Il faut un nombre entier pour ${fautifs.join(', ')}. Rien n'a été changé : rouvre la fenêtre et corrige.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    for (const [col, v] of Object.entries(valeurs)) setGuildConfig(guildId, col, v);
    if (interaction.isFromMessage?.()) await mettreAJour(interaction, mariageView(interaction.guild));
    else await interaction.reply({ content: '✅ Réglages du mariage enregistrés.', flags: MessageFlags.Ephemeral });
    await sendLog(interaction.guild, logEmbed('⚙️ Configuration modifiée',
      `💍 Mariage : bonus **${valeurs.mariage_bonus_xp} %**, lune de miel **${valeurs.mariage_lune_de_miel_jours} j**, `
        + `bisou **${valeurs.mariage_bisou_xp} XP**, écart **${valeurs.mariage_actif_minutes} min**\n${par}`, COLORS.INFO));
    return;
  }

  // Identifiant inconnu (ancienne version du panneau) : on rafraîchit la vue.
  return mettreAJour(interaction, mariageView(interaction.guild));
}

module.exports = { mariageView, gererConfigMariage, CHAMPS_MARIAGE };
