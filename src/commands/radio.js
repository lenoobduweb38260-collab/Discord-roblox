const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { COLORS } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');
const { repondreVite, suivre } = require('../utils/reponse');
const M = require('../utils/miseEnPage');
const S = require('../utils/musiqueSources');
const musique = require('../utils/music');
const radios = require('../utils/radios');
const musiqueCmd = require('./musique');

// 📻 /radio — les radios françaises, en direct dans le vocal.
//
// L'annuaire est Radio Browser (voir utils/radios.js) : des milliers de
// stations françaises classées par popularité, chacune avec l'URL directe de
// son flux. On tape un nom, l'autocomplétion propose, le bot diffuse.
//
// La lecture passe par la MÊME file que /musique : mêmes boutons, même
// volume, même « stop ». Une radio est simplement une piste sans fin.

const moteur = require('../utils/musiqueMoteur');

// Les dépendances audio peuvent manquer sur un hébergement minimal.
const ABSENTE = /Cannot find module|@discordjs\/voice|play-dl|opus|sodium/i;
const MESSAGE_ABSENTE =
  '❌ Les bibliothèques audio ne sont pas installées sur cet hébergement.\n'
  + '➜ Lancez `npm install` à côté du bot, puis redémarrez-le.';

const ligneStation = (s) => [
  `**${s.nom}**`,
  s.debit ? `${s.debit} kbit/s` : null,
  s.genres.length ? s.genres.join(' · ') : null,
].filter(Boolean).join(' — ');

module.exports = {
  grade: GRADES.EVERYONE,
  public: true,
  guildModule: null,

  data: new SlashCommandBuilder()
    .setName('radio')
    .setDescription('Radios françaises en direct dans le vocal')
    .addSubcommand((s) => s.setName('ecouter')
      .setDescription('Diffuser une radio française dans votre salon vocal')
      .addStringOption((o) => o.setName('station')
        .setDescription('Le nom de la radio — la liste se remplit en tapant')
        .setRequired(true).setAutocomplete(true).setMaxLength(120)))
    .addSubcommand((s) => s.setName('liste')
      .setDescription('Les radios françaises les plus écoutées'))
    .addSubcommand((s) => s.setName('stop')
      .setDescription('Arrêter la radio et quitter le vocal')),

  // La liste se remplit pendant la frappe. Discord n'attend que 3 secondes :
  // au-delà on répond vide plutôt que de laisser une erreur s'afficher.
  async autocomplete(interaction) {
    const texte = interaction.options.getFocused();
    const stations = await Promise.race([
      radios.chercher(texte, 25),
      new Promise((r) => setTimeout(() => r([]), 2500)),
    ]).catch(() => []);
    return interaction.respond(stations.slice(0, 25).map((s) => ({
      name: `📻 ${s.nom}${s.debit ? ` · ${s.debit} kbit/s` : ''}`.slice(0, 100),
      value: s.uuid,
    }))).catch(() => null);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'stop') {
        return await interaction.reply({
          content: musique.quitter(interaction.guildId, 'radio stop') ? '⏹️ Radio coupée, je quitte le vocal.' : '❌ Rien en lecture.',
        });
      }
      if (sub === 'liste') return await liste(interaction);
      return await ecouter(interaction);
    } catch (err) {
      const m = err.message || '';
      const texte = ABSENTE.test(m) ? MESSAGE_ABSENTE : (/^[❌⛔⚠️📻]/.test(m.trim()) ? m : `❌ ${m}`);
      return suivre(interaction, { content: texte, flags: MessageFlags.Ephemeral });
    }
  },
};

async function ecouter(interaction) {
  // FFmpeg d'abord, et AVANT repondreVite : la vérification est instantanée,
  // donc la réponse est réellement éphémère — différée, le drapeau aurait
  // été ignoré et le refus serait devenu public.
  const souci = moteur.ffmpegManquant();
  if (souci) return interaction.reply({ content: `❌ ${souci}`, flags: MessageFlags.Ephemeral });

  return repondreVite(interaction, async () => {
    const station = await radios.trouver(interaction.options.getString('station'));
    if (!station) {
      return {
        content: '❌ Je ne trouve pas cette radio.\n➜ Tapez quelques lettres et **choisissez dans la liste** qui apparaît.',
        flags: MessageFlags.Ephemeral,
      };
    }

    const url = await radios.urlDeLecture(station);
    const piste = S.piste({
      titre: `📻 ${station.nom}`,
      url,
      duree: 0,
      auteur: station.genres.join(' · ') || null,
      vignette: station.logo,
      source: 'radio',
      lienOrigine: station.site,
    });
    const { premiere, noteRegion } = await musique.ajouterPiste(interaction, piste);
    const etat = musique.etat(interaction.guildId);

    const lignes = [
      ligneStation(station),
      '-# 🔴 En direct — la radio joue jusqu\'à `/radio stop` ou `/musique skip`.',
    ];
    if (!premiere) lignes.push(`-# 📃 La radio prend la file à la fin des morceaux en cours (position **${etat.pistes.length}**).`);
    if (noteRegion) {
      lignes.push(`-# 🔁 Le flux vocal n'aboutissait pas : j'ai changé la région du salon (${noteRegion.originale || 'automatique'} → ${noteRegion.nouvelle}), et c'est elle qui a débloqué la connexion.`);
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(premiere ? '📻 Radio en direct' : '➕ Radio ajoutée à la file')
      .setDescription(M.description(lignes));
    if (station.logo) embed.setThumbnail(station.logo);
    if (station.site) embed.setURL(station.site);
    return { embeds: [embed], components: premiere && etat ? [musiqueCmd.boutons(etat)] : [] };
  });
}

async function liste(interaction) {
  // Toutes les issues de la liste sont éphémères : le report peut l'être aussi.
  return repondreVite(interaction, async () => {
    const stations = (await radios.francaises()).slice(0, 15);
    if (!stations.length) {
      return { content: '❌ L\'annuaire des radios ne répond pas pour le moment. Réessayez dans un instant.', flags: MessageFlags.Ephemeral };
    }
    const embed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle('📻 Les radios françaises les plus écoutées')
      .setDescription(M.description([
        M.bloc('Classement de l\'annuaire', stations.map((s, i) => `**${i + 1}.** ${ligneStation(s)}`), { prefixe: '🏆', compte: null }),
        '-# ▶️ `/radio ecouter` puis tapez un nom : la liste se remplit toute seule — et des milliers d\'autres stations y répondent aussi.',
      ]));
    return { embeds: [embed], flags: MessageFlags.Ephemeral };
  }, { ephemere: true });
}
