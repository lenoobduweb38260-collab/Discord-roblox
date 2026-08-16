const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { COLORS } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');
const music = require('../utils/music');
const { repondre } = require('../utils/reponse');

const UNAVAILABLE =
  '❌ Le module musique n\'est pas disponible sur cet hébergement (dépendances audio absentes). ' +
  'Lancez le bot via Node (`npm install`) ou utilisez un serveur Lavalink.';

module.exports = {
  grade: GRADES.EVERYONE,
  public: true,
  data: new SlashCommandBuilder()
    .setName('musique')
    .setDescription('Musique en vocal (YouTube / Spotify / Deezer / SoundCloud)')
    .addSubcommand((sub) =>
      sub
        .setName('play')
        .setDescription('Jouer/ajouter un lien ou une recherche')
        .addStringOption((o) => o.setName('lien').setDescription('Lien ou recherche').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('skip').setDescription('Passer au morceau suivant'))
    .addSubcommand((sub) => sub.setName('stop').setDescription('Arrêter et quitter le vocal'))
    .addSubcommand((sub) => sub.setName('pause').setDescription('Mettre en pause'))
    .addSubcommand((sub) => sub.setName('reprendre').setDescription('Reprendre la lecture'))
    .addSubcommand((sub) => sub.setName('file').setDescription('Voir la file d\'attente')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'play') {
        await interaction.deferReply();
        const { song, position } = await music.add(interaction, interaction.options.getString('lien'));
        const embed = new EmbedBuilder()
          .setColor(COLORS.SUCCESS)
          .setTitle(position === 1 ? '▶️ Lecture' : '➕ Ajouté à la file')
          .setDescription(`**${song.title}**${position > 1 ? `\nPosition dans la file : ${position}` : ''}`);
        // repondre : sans elle, la réponse partirait en embed classique —
        // editReply est une MODIFICATION, jamais convertie en carte.
        return repondre(interaction, { embeds: [embed] });
      }
      if (sub === 'skip') return interaction.reply({ content: music.skip(interaction.guildId) ? '⏭️ Morceau passé.' : '❌ Rien en lecture.' });
      if (sub === 'stop') return interaction.reply({ content: music.stop(interaction.guildId) ? '⏹️ Arrêté, à bientôt !' : '❌ Rien en lecture.' });
      if (sub === 'pause') return interaction.reply({ content: music.pause(interaction.guildId) ? '⏸️ En pause.' : '❌ Rien en lecture.' });
      if (sub === 'reprendre') return interaction.reply({ content: music.resume(interaction.guildId) ? '▶️ Reprise.' : '❌ Rien en pause.' });
      // file
      const songs = music.list(interaction.guildId);
      if (!songs.length) return interaction.reply({ content: '📭 File vide.' });
      const embed = new EmbedBuilder()
        .setColor(COLORS.PRIMARY)
        .setTitle('🎶 File d\'attente')
        .setDescription(songs.map((s, i) => `${i === 0 ? '▶️' : `**${i}.**`} ${s.title}`).join('\n').slice(0, 4000));
      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      const msg = /Cannot find module|@discordjs\/voice|play-dl|opus|sodium/i.test(err.message) ? UNAVAILABLE : `❌ ${err.message}`;
      if (interaction.deferred || interaction.replied) return interaction.editReply({ content: msg }).catch(() => null);
      return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  },
};
