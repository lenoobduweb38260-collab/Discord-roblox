const {
  SlashCommandBuilder, EmbedBuilder, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { COLORS } = require('../utils/embeds');
const { GRADES } = require('../utils/permissions');
const { repondreVite, mettreAJour, suivre } = require('../utils/reponse');
const M = require('../utils/miseEnPage');
const musique = require('../utils/music');
const S = require('../utils/musiqueSources');

// 🎶 /musique — YouTube, SoundCloud, Spotify et Deezer.
//
// ⚠️ Ce que le bot dit, et qu'il faut dire : **Spotify et Deezer ne laissent
// personne diffuser leur audio.** Le bot lit la fiche du lien puis joue la
// même chanson depuis YouTube. C'est ce que font tous les bots, et le seul
// moyen légal. L'afficher évite qu'on prenne pour un défaut ce qui est une
// règle de leur côté.

// Les dépendances audio peuvent manquer sur un hébergement minimal.
const ABSENTE = /Cannot find module|@discordjs\/voice|play-dl|opus|sodium|ffmpeg/i;
const MESSAGE_ABSENTE =
  '❌ Les bibliothèques audio ne sont pas installées sur cet hébergement.\n'
  + '➜ Lancez `npm install` à côté du bot, puis redémarrez-le.';

const mmss = (s) => {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
};

// D'où vient l'audio, et d'où venait la demande. La ligne n'apparaît que
// lorsque les deux diffèrent — sinon elle n'apprendrait rien.
function ligneSource(p) {
  if (p.origine === p.source) return `${S.NOMS[p.source]}`;
  return `${S.NOMS[p.origine]} → diffusé depuis ${S.NOMS[p.source]}`;
}

function barre(ecoule, duree, largeur = 18) {
  if (!duree) return '';
  const part = Math.min(1, Math.max(0, ecoule / duree));
  const curseur = Math.round(part * (largeur - 1));
  return `\`${'─'.repeat(curseur)}🔘${'─'.repeat(largeur - 1 - curseur)}\` ${mmss(ecoule)} / ${mmss(duree)}`;
}

function carteLecture(etat) {
  const p = etat.encours;
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle(etat.pause ? '⏸️ En pause' : '▶️ Lecture en cours')
    .setDescription(M.description([
      `**${p.titre}**${p.auteur ? `\n-# par ${p.auteur}` : ''}`,
      barre(etat.ecoule, p.duree),
      M.bloc('Source', [ligneSource(p)], { prefixe: '🎧', compte: null }),
      etat.pistes.length
        ? M.bloc('À suivre', etat.pistes.slice(0, 5).map((s) => s.titre), { prefixe: '📃', compte: etat.pistes.length, motCompte: 'morceau' })
        : null,
    ].filter(Boolean)))
    .setFooter({
      text: [
        `🔊 ${etat.volume} %`,
        etat.boucle !== 'aucune' ? `🔁 ${etat.boucle === 'piste' ? 'ce morceau' : 'la file'}` : null,
      ].filter(Boolean).join(' • '),
    });
  if (p.vignette) embed.setThumbnail(p.vignette);
  if (p.url) embed.setURL(p.url);
  return embed;
}

const boutons = (etat) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('mus:pp').setEmoji(etat.pause ? '▶️' : '⏸️').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('mus:skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(!etat.pistes.length && etat.boucle === 'aucune'),
  new ButtonBuilder().setCustomId('mus:loop').setEmoji('🔁').setStyle(etat.boucle === 'aucune' ? ButtonStyle.Secondary : ButtonStyle.Primary),
  new ButtonBuilder().setCustomId('mus:file').setEmoji('📃').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('mus:stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
);

module.exports = {
  grade: GRADES.EVERYONE,
  public: true,
  guildModule: null,

  data: new SlashCommandBuilder()
    .setName('musique')
    .setDescription('Musique en vocal — YouTube, SoundCloud, Spotify, Deezer')
    .addSubcommand((s) => s.setName('play')
      .setDescription('Jouer un lien (YouTube, SoundCloud, Spotify, Deezer) ou chercher un titre')
      .addStringOption((o) => o.setName('lien').setDescription('Lien ou recherche').setRequired(true).setMaxLength(400)))
    .addSubcommand((s) => s.setName('maintenant').setDescription('Ce qui joue en ce moment'))
    .addSubcommand((s) => s.setName('file').setDescription('La file d\'attente'))
    .addSubcommand((s) => s.setName('skip').setDescription('Passer au morceau suivant'))
    .addSubcommand((s) => s.setName('pause').setDescription('Mettre en pause'))
    .addSubcommand((s) => s.setName('reprendre').setDescription('Reprendre la lecture'))
    .addSubcommand((s) => s.setName('stop').setDescription('Arrêter et quitter le vocal'))
    .addSubcommand((s) => s.setName('melanger').setDescription('Mélanger la file d\'attente'))
    .addSubcommand((s) => s.setName('retirer')
      .setDescription('Retirer un morceau de la file')
      .addIntegerOption((o) => o.setName('position').setDescription('Sa position dans la file').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('boucle')
      .setDescription('Répéter le morceau ou toute la file')
      .addStringOption((o) => o.setName('mode').setDescription('Quoi répéter').setRequired(true)
        .addChoices(
          { name: 'Aucune', value: 'aucune' },
          { name: 'Ce morceau', value: 'piste' },
          { name: 'Toute la file', value: 'file' },
        )))
    .addSubcommand((s) => s.setName('volume')
      .setDescription('Régler le volume (0 à 200 %)')
      .addIntegerOption((o) => o.setName('niveau').setDescription('En pourcentage').setRequired(true).setMinValue(0).setMaxValue(200)))
    .addSubcommand((s) => s.setName('sources').setDescription('Ce que le bot sait lire, et comment')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'play') return await jouer(interaction);
      if (sub === 'sources') return await interaction.reply({ embeds: [carteSources()], flags: MessageFlags.Ephemeral });

      const etat = musique.etat(interaction.guildId);
      if (!etat && sub !== 'file') {
        return interaction.reply({ content: '📭 Je ne joue rien pour le moment.', flags: MessageFlags.Ephemeral });
      }

      if (sub === 'maintenant') {
        if (!etat?.encours) return interaction.reply({ content: '📭 Rien en lecture.', flags: MessageFlags.Ephemeral });
        return interaction.reply({ embeds: [carteLecture(etat)], components: [boutons(etat)] });
      }

      if (sub === 'file') {
        if (!etat?.encours && !etat?.pistes?.length) {
          return interaction.reply({ content: '📭 La file est vide.', flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({ embeds: [carteFile(etat)], flags: MessageFlags.Ephemeral });
      }

      if (sub === 'skip') {
        const passee = musique.passer(interaction.guildId);
        return interaction.reply({ content: passee ? `⏭️ **${passee.titre}** passé.` : '❌ Rien à passer.' });
      }

      if (sub === 'pause') {
        return interaction.reply({ content: musique.pause(interaction.guildId) ? '⏸️ En pause.' : '❌ Déjà en pause, ou rien en lecture.' });
      }

      if (sub === 'reprendre') {
        return interaction.reply({ content: musique.reprendre(interaction.guildId) ? '▶️ On reprend.' : '❌ Rien n\'est en pause.' });
      }

      if (sub === 'stop') {
        return interaction.reply({ content: musique.quitter(interaction.guildId, 'demandé') ? '⏹️ Terminé, je quitte le vocal.' : '❌ Rien en lecture.' });
      }

      if (sub === 'melanger') {
        return interaction.reply({
          content: musique.melanger(interaction.guildId)
            ? '🔀 File mélangée.'
            : '❌ Il faut au moins deux morceaux en attente pour mélanger.',
        });
      }

      if (sub === 'retirer') {
        const retiree = musique.retirer(interaction.guildId, interaction.options.getInteger('position'));
        return interaction.reply({
          content: retiree ? `🗑️ **${retiree.titre}** retiré de la file.` : '❌ Aucun morceau à cette position.',
        });
      }

      if (sub === 'boucle') {
        const mode = musique.boucler(interaction.guildId, interaction.options.getString('mode'));
        const mots = { aucune: '➡️ Plus de répétition.', piste: '🔂 Ce morceau tournera en boucle.', file: '🔁 Toute la file tournera en boucle.' };
        return interaction.reply({ content: mots[mode] });
      }

      if (sub === 'volume') {
        const v = musique.volume(interaction.guildId, interaction.options.getInteger('niveau'));
        return interaction.reply({
          content: `🔊 Volume à **${v} %**.${v > 100 ? '\n-# Au-delà de 100 %, le son peut saturer.' : ''}`,
        });
      }
      return null;
    } catch (err) {
      // ⚠️ Pas de « ❌ » ajouté ici : les messages du moteur portent déjà le
      // leur, et on lisait « ❌❌ ».
      const m = err.message || '';
      const texte = ABSENTE.test(m) ? MESSAGE_ABSENTE : (/^[❌⛔⚠️]/.test(m.trim()) ? m : `❌ ${m}`);
      return dire(interaction, texte);
    }
  },

  // Boutons de la carte de lecture.
  async handleComposant(interaction) {
    const action = interaction.customId.split(':')[1];
    const etatAvant = musique.etat(interaction.guildId);
    if (!etatAvant?.encours) {
      return mettreAJour(interaction, { content: '📭 La lecture est terminée.', embeds: [], components: [] });
    }
    // 🔊 On n'agit que pour quelqu'un du salon vocal : sinon n'importe qui,
    // depuis n'importe où, coupe la musique des autres.
    if (interaction.member?.voice?.channelId !== etatAvant.salonVocalId) {
      return suivre(interaction, {
        content: `⛔ Rejoignez <#${etatAvant.salonVocalId}> pour piloter la lecture.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'stop') {
      musique.quitter(interaction.guildId, 'bouton stop');
      return mettreAJour(interaction, { content: '⏹️ Terminé, je quitte le vocal.', embeds: [], components: [] });
    }
    if (action === 'file') {
      return suivre(interaction, { embeds: [carteFile(etatAvant)], flags: MessageFlags.Ephemeral });
    }
    if (action === 'pp') {
      if (etatAvant.pause) musique.reprendre(interaction.guildId);
      else musique.pause(interaction.guildId);
    }
    if (action === 'skip') musique.passer(interaction.guildId);
    if (action === 'loop') {
      const suite = { aucune: 'piste', piste: 'file', file: 'aucune' };
      musique.boucler(interaction.guildId, suite[etatAvant.boucle]);
    }

    // ⏭️ Passer change de morceau de façon asynchrone : on laisse le lecteur
    // enchaîner avant de redessiner, sinon la carte montrerait l'ancien titre.
    if (action === 'skip') await new Promise((r) => setTimeout(r, 700));
    const apres = musique.etat(interaction.guildId);
    if (!apres?.encours) {
      return mettreAJour(interaction, { content: '⏹️ File terminée.', embeds: [], components: [] });
    }
    return mettreAJour(interaction, { embeds: [carteLecture(apres)], components: [boutons(apres)] });
  },

  carteLecture, carteFile, carteSources, mmss, ligneSource,
};

async function jouer(interaction) {
  // ⏱️ Résoudre un lien Spotify de 30 titres demande autant de recherches
  // YouTube : bien plus que les 3 secondes de Discord. `repondreVite` ne
  // diffère qu'à la dernière seconde — un lien direct répond donc en carte.
  return repondreVite(interaction, async () => {
    const { pistes, introuvables, premiere } = await musique.ajouter(
      interaction,
      interaction.options.getString('lien')
    );
    const etat = musique.etat(interaction.guildId);
    const p = pistes[0];

    const lignes = [];
    if (pistes.length > 1) {
      lignes.push(M.bloc('Ajoutés à la file', pistes.slice(0, 8).map((x) => x.titre),
        { prefixe: '➕', compte: pistes.length, motCompte: 'morceau' }));
    } else {
      lignes.push(`**${p.titre}**${p.auteur ? `\n-# par ${p.auteur}` : ''}`);
      if (p.duree) lignes.push(`-# ⏱️ ${mmss(p.duree)}`);
    }
    lignes.push(M.bloc('Source', [ligneSource(p)], { prefixe: '🎧', compte: null }));
    // Une plateforme relayée le dit une fois, clairement : sans cela on croit
    // à un défaut quand le son ne vient pas de « chez Spotify ».
    if (S.RELAYEES.has(p.origine)) {
      lignes.push(`-# ℹ️ ${S.NOMS[p.origine]} ne permet à personne de diffuser son audio : je joue le même titre depuis YouTube.`);
    }
    if (introuvables.length) {
      lignes.push(M.bloc('Sans équivalent trouvé', introuvables.slice(0, 5),
        { prefixe: '⚠️', compte: introuvables.length, motCompte: 'titre' }));
    }
    if (!premiere) lignes.push(`-# 📃 Position dans la file : **${etat.pistes.length}**`);

    const embed = new EmbedBuilder()
      .setColor(premiere ? COLORS.SUCCESS : COLORS.INFO)
      .setTitle(premiere ? '▶️ Lecture' : '➕ Ajouté à la file')
      .setDescription(M.description(lignes));
    if (p.vignette) embed.setThumbnail(p.vignette);

    return { embeds: [embed], components: premiere && etat ? [boutons(etat)] : [] };
  });
}

function carteFile(etat) {
  const lignes = [];
  if (etat?.encours) lignes.push(M.bloc('En lecture', [`**${etat.encours.titre}**`], { prefixe: '▶️', compte: null }));
  if (etat?.pistes?.length) {
    lignes.push(M.bloc('À suivre',
      etat.pistes.slice(0, 20).map((p, i) => `**${i + 1}.** ${p.titre} · ${mmss(p.duree)}`),
      { prefixe: '📃', compte: etat.pistes.length, motCompte: 'morceau' }));
    const total = etat.pistes.reduce((n, p) => n + (p.duree || 0), 0);
    if (total) lignes.push(`-# ⏱️ Environ ${mmss(total)} d'attente`);
  } else {
    lignes.push('*Rien d\'autre en attente.*');
  }
  return new EmbedBuilder().setColor(COLORS.PRIMARY).setTitle('🎶 File d\'attente')
    .setDescription(M.borner(M.description(lignes), M.MAX_DESCRIPTION));
}

function carteSources() {
  const moteur = require('../utils/musiqueMoteur');
  const e = moteur.etatSources();
  const d = moteur.rapportDependances();
  const manque = moteur.briquesManquantes();
  return new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🎧 Ce que je sais lire')
    .setDescription(M.description([
      M.bloc('Diffusé directement', [
        '▶️ **YouTube** — vidéos et playlists',
        `🔊 **SoundCloud** — pistes et playlists${e.soundcloud ? '' : ' *(clé d\'accès non obtenue)*'}`,
      ], { prefixe: '✅', compte: null }),
      M.bloc('Lu, puis rejoué depuis YouTube', [
        `🟢 **Spotify**${e.spotify ? ' — albums et playlists complets' : ' — piste seule *(sans identifiants d\'application)*'}`,
        '🟣 **Deezer** — pistes, albums et playlists',
      ], { prefixe: '🔁', compte: null }),
      '-# ⚠️ Spotify et Deezer ne laissent **personne** diffuser leur audio : leurs flux sont réservés à leurs propres applications. '
      + 'Je lis donc la fiche du lien, puis je joue la même chanson depuis YouTube. Aucun bot Discord ne fait autrement.',
      // 🩺 Les briques audio. Sans elles, le bot rejoint le salon et reste
      // muet — et tout ressemble à un défaut de permissions.
      M.bloc('Briques audio', [
        `${d.opus ? '✅' : '❌'} Encodeur Opus${d.opus ? ` — \`${d.opus}\`` : ' — **manquant**'}`,
        `${d.chiffrement ? '✅' : '❌'} Chiffrement de la voix${d.chiffrement ? ` — \`${d.chiffrement}\`` : ' — **manquant**'}`,
      ], { prefixe: '🔧', compte: null }),
      manque
        ? `⚠️ **Il manque ${manque.length === 1 ? 'une brique' : 'des briques'} :**\n${manque.map((m) => `➜ ${m}`).join('\n')}\n`
          + '-# Sans elle, la connexion vocale est acceptée puis n\'aboutit jamais.'
        : null,
      e.erreurs.length ? M.bloc('Soucis au démarrage', e.erreurs, { prefixe: '⚠️', compte: null }) : null,
    ].filter(Boolean)));
}

const dire = (interaction, contenu) => suivre(interaction, { content: contenu, flags: MessageFlags.Ephemeral });
