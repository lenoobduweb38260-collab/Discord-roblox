const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { setGuildConfig, getGuildConfig } = require('../database');

// 🎙️ /vocal — les deux mécaniques vocales du serveur, réglées au même endroit.
//
//  • La FILE D'ATTENTE : un vocal d'attente est surveillé — s'y connecter
//    ouvre un ticket dans le salon écrit choisi (qui attend, depuis quand,
//    staff mentionné), un bouton pour prendre en charge, et le ticket se
//    clôt quand la personne est déplacée dans un salon d'assistance.
//  • Les SALONS PERSO : un salon « créateur » — s'y connecter fabrique un
//    vocal à son pseudo, avec sa carte de gestion, supprimé une fois vide.

module.exports = {
  grade: GRADES.STAFF,
  guildModule: null,

  data: new SlashCommandBuilder()
    .setName('vocal')
    .setDescription('[Staff] File d\'attente vocale du staff, et salons vocaux personnels')
    .addSubcommand((s) => s.setName('alerte')
      .setDescription('[Staff] Surveiller un vocal d\'attente et annoncer chaque arrivée au staff')
      .addChannelOption((o) => o.setName('salon-attente')
        .setDescription('Le vocal d\'ATTENTE : s\'y connecter ouvre un ticket')
        .addChannelTypes(ChannelType.GuildVoice).setRequired(true))
      .addChannelOption((o) => o.setName('annonces')
        .setDescription('Salon texte où poster les tickets d\'attente')
        .addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((s) => s.setName('assistance')
      .setDescription('[Staff] Définir les salons d\'ASSISTANCE : y déplacer la personne clôt son ticket')
      .addChannelOption((o) => o.setName('salon')
        .setDescription('Un salon vocal d\'assistance')
        .addChannelTypes(ChannelType.GuildVoice).setRequired(true))
      .addChannelOption((o) => o.setName('salon2')
        .setDescription('Un deuxième salon d\'assistance')
        .addChannelTypes(ChannelType.GuildVoice))
      .addChannelOption((o) => o.setName('salon3')
        .setDescription('Un troisième salon d\'assistance')
        .addChannelTypes(ChannelType.GuildVoice))
      .addChannelOption((o) => o.setName('salon4')
        .setDescription('Un quatrième salon d\'assistance')
        .addChannelTypes(ChannelType.GuildVoice)))
    .addSubcommand((s) => s.setName('alerte-off')
      .setDescription('[Staff] Couper la file d\'attente vocale'))
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
      const attente = interaction.options.getChannel('salon-attente');
      const annonces = interaction.options.getChannel('annonces');
      setGuildConfig(interaction.guildId, 'vocal_attente_channel_id', String(attente.id));
      setGuildConfig(interaction.guildId, 'vocal_alerte_channel_id', String(annonces.id));
      const cfg = getGuildConfig(interaction.guildId);
      const assistance = require('../utils/vocalAlerte').salonsAssistance(cfg);
      return interaction.reply({
        content: `🎧 File d'attente **activée** : se connecter à <#${attente.id}> ouvre un ticket dans <#${annonces.id}>, staff mentionné.`
          + (assistance.length
            ? `\n➜ Déplacer la personne vers ${assistance.map((id) => `<#${id}>`).join(', ')} clôturera son ticket.`
            : '\n⚠️ Aucun salon d\'assistance défini : faites `/vocal assistance` pour que les tickets se clôturent au déplacement.')
          + '\n-# Réglez vos rôles staff dans `/config` → 👮 Rôles pour que la mention parte au bon endroit.',
        flags: MessageFlags.Ephemeral,
      });
    }
    if (sub === 'assistance') {
      const ids = [...new Set(['salon', 'salon2', 'salon3', 'salon4']
        .map((nom) => interaction.options.getChannel(nom))
        .filter(Boolean)
        .map((salon) => String(salon.id)))];
      setGuildConfig(interaction.guildId, 'vocal_assistance_ids', JSON.stringify(ids));
      const cfg = getGuildConfig(interaction.guildId);
      return interaction.reply({
        content: `🏁 Salons d'assistance définis : ${ids.map((id) => `<#${id}>`).join(', ')}.`
          + '\n➜ Déplacer une personne du vocal d\'attente vers l\'un d\'eux clôturera son ticket.'
          + (cfg.vocal_attente_channel_id ? '' : '\n⚠️ Aucun vocal d\'attente surveillé : faites `/vocal alerte` pour activer la file.'),
        flags: MessageFlags.Ephemeral,
      });
    }
    if (sub === 'alerte-off') {
      setGuildConfig(interaction.guildId, 'vocal_attente_channel_id', null);
      setGuildConfig(interaction.guildId, 'vocal_alerte_channel_id', null);
      return interaction.reply({ content: '🔕 File d\'attente vocale **coupée**.', flags: MessageFlags.Ephemeral });
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
