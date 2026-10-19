const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { mainView, photoDuBotParCommande } = require('../utils/configPanel');

module.exports = {
  grade: GRADES.STAFF,
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('[Staff] Panneau central de configuration : rôles, salons, XP, whitelist métiers')
    // 📁 La photo du bot depuis un fichier de l'appareil. Une pièce jointe de
    // commande marche avec TOUTES les versions de discord.js — le fichier
    // dans le modal « Identité du bot », lui, demande une version récente.
    .addAttachmentOption((o) => o
      .setName('photo')
      .setDescription('[Admin] Nouvelle photo du bot sur ce serveur : PNG, JPG ou GIF, 8 Mo maximum')
      .setRequired(false)),
  async execute(interaction) {
    const photo = interaction.options?.getAttachment?.('photo') || null;
    if (photo) return photoDuBotParCommande(interaction, photo);
    await interaction.reply({ ...mainView(interaction.guild), flags: MessageFlags.Ephemeral });
  },
};
