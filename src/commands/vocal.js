const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { setGuildConfig, getGuildConfig } = require('../database');

// 🎙️ /vocal — les deux mécaniques vocales du serveur, réglées au même endroit.
//
//  • L'ALERTE : à chaque connexion en vocal, une carte part dans le salon
//    choisi, avec la liste des présents et une mention du staff (qui sonne).
//  • Les SALONS PERSO : un salon « créateur » — s'y connecter fabrique un
//    vocal à son pseudo, avec sa carte de gestion, supprimé une fois vide.

module.exports = {
  grade: GRADES.STAFF,
  guildModule: null,

  data: new SlashCommandBuilder()
    .setName('vocal')
    .setDescription('[Staff] Alerte vocale au staff, et salons vocaux personnels')
    .addSubcommand((s) => s.setName('alerte')
      .setDescription('[Staff] Prévenir le staff à chaque connexion vocale, dans ce salon')
      .addChannelOption((o) => o.setName('salon')
        .setDescription('Salon texte où poster les alertes')
        .addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((s) => s.setName('alerte-off')
      .setDescription('[Staff] Couper les alertes de connexion vocale'))
    .addSubcommand((s) => s.setName('perso')
      .setDescription('[Staff] Définir le salon créateur des salons vocaux personnels')
      .addChannelOption((o) => o.setName('salon')
        .setDescription('Le vocal « créateur » : s\'y connecter fabrique son propre salon')
        .addChannelTypes(ChannelType.GuildVoice).setRequired(true)))
    .addSubcommand((s) => s.setName('perso-off')
      .setDescription('[Staff] Couper les salons vocaux personnels')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'alerte') {
      const salon = interaction.options.getChannel('salon');
      setGuildConfig(interaction.guildId, 'vocal_alerte_channel_id', String(salon.id));
      return interaction.reply({
        content: `🎙️ Alertes vocales **activées** : chaque connexion sera annoncée dans <#${salon.id}>, staff mentionné.`
          + '\n-# Réglez vos rôles staff dans `/config` → 👮 Rôles pour que la mention parte au bon endroit.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (sub === 'alerte-off') {
      setGuildConfig(interaction.guildId, 'vocal_alerte_channel_id', null);
      return interaction.reply({ content: '🔕 Alertes vocales **coupées**.', flags: MessageFlags.Ephemeral });
    }
    if (sub === 'perso') {
      const salon = interaction.options.getChannel('salon');
      setGuildConfig(interaction.guildId, 'vocal_perso_createur_id', String(salon.id));
      return interaction.reply({
        content: `🎧 Salons personnels **activés** : se connecter à <#${salon.id}> crée son propre vocal, avec sa carte de gestion.`
          + '\n-# Il me faut **Gérer les salons** et **Déplacer les membres** pour fabriquer et remplir ces salons.',
        flags: MessageFlags.Ephemeral,
      });
    }
    // perso-off
    setGuildConfig(interaction.guildId, 'vocal_perso_createur_id', null);
    const restants = require('../utils/salonsPerso').duServeur.all(String(interaction.guildId)).length;
    return interaction.reply({
      content: `🔇 Salons personnels **coupés**.${restants ? ` Les **${restants}** salon(s) déjà créés disparaîtront en se vidant.` : ''}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
