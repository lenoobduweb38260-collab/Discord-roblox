const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const L = require('../utils/levels');
const { getGuildConfig, setGuildConfig } = require('../database');
const { COLORS } = require('../utils/embeds');
const { GRADES, getGrade } = require('../utils/permissions');
const M = require('../utils/miseEnPage');
const { repondreVite, mettreAJour } = require('../utils/reponse');
const CARTE = require('../utils/carteNiveau');

// 📊 /niveau — sa fiche (avec une vraie carte de rang dessinée), le
// classement page par page, les récompenses du serveur.
//
// Les boutons de pages portent tout ce qu'il faut savoir
// (`niv:page:<tri>:<partis>:<page>`, `niv:rec:<page>`) : ils fonctionnent
// encore après un redémarrage du bot.

const TRIS_NIVEAU = {
  total: { emoji: '🏆', nom: 'Total' },
  texte: { emoji: '✍️', nom: 'Écrit' },
  vocal: { emoji: '🎙️', nom: 'Vocal' },
};
const PAR_PAGE_CLASSEMENT = 10;
const nombreFr = (n) => Number(n || 0).toLocaleString('fr-FR');
const facteurFr = (p) => `×${(Number(p) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;
const desactive = () => ({
  content: '📴 Le système de niveaux est **désactivé** sur ce serveur.\n'
    + '➜ Un staff peut le réactiver via `/config` → 📈 XP & niveaux.',
  flags: MessageFlags.Ephemeral,
});

function barreNiveau(p) {
  const pleins = p.plafond ? 12 : p.needed ? Math.round((p.current / p.needed) * 12) : 0;
  return '▰'.repeat(Math.min(12, pleins)) + '▱'.repeat(Math.max(0, 12 - pleins));
}

// 💍 L'union du membre, si le module mariage la connaît.
function unionDe(userId) {
  try {
    return require('./mariage').mariageDe?.(userId) || null;
  } catch {
    return null;
  }
}

// ── /niveau voir ───────────────────────────────────────────────────────
async function ficheNiveau(interaction, user) {
  const guild = interaction.guild;
  const gid = interaction.guildId;
  const cfg = getGuildConfig(gid);
  const row = L.getLevels(gid, user.id);
  const { courbe, max } = L.courbeXpDe(gid);
  const total = row.xp || 0;
  const p = L.levelFromXp(total, courbe, max);
  const rang = L.rangNiveau(gid, user.id);
  const membre = guild?.members?.cache?.get?.(user.id) || (user.id === interaction.user.id ? interaction.member : null);
  const pseudo = membre?.displayName || user.globalName || user.username;

  const lignes = [
    `### Niveau **${p.level}**${rang ? ` · Rang **#${rang}**` : ''}`,
    p.plafond ? `${barreNiveau(p)}  **Niveau maximum atteint**` : `${barreNiveau(p)}  ${nombreFr(p.current)} / ${nombreFr(p.needed)} XP`,
    p.plafond
      ? `**${nombreFr(total)} XP** au total.`
      : `**${nombreFr(total)} XP** au total — encore **${nombreFr(p.needed - p.current)}** pour le niveau ${p.level + 1}.`,
  ];
  const union = unionDe(user.id);
  if (union?.conjoint) lignes.push(`💍 Marié·e à <@${union.conjoint}>`);

  const ecrit = row.text_xp || 0;
  const vocal = row.voice_xp || 0;
  const autres = Math.max(0, total - ecrit - vocal);
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`📊 Niveau de ${pseudo}`)
    .setDescription(lignes.join('\n'))
    .addFields(
      { name: '✍️ Écrit', value: `${nombreFr(ecrit)} XP`, inline: true },
      { name: '🎙️ Vocal', value: `${nombreFr(vocal)} XP`, inline: true },
      { name: '🎲 Jeux, SAO et bonus', value: `${nombreFr(autres)} XP`, inline: true }
    );

  const prochaine = L.prochaineRecompenseNiveau(gid, p.level);
  const nbRecompenses = L.listerRecompensesNiveau(gid).length;
  embed.addFields({
    name: '🏅 Prochaine récompense',
    value: M.borner(prochaine
      ? `Niveau **${prochaine.niveau}** → ${prochaine.recompenses.map((r) => L.libelleRecompenseNiveau(r)).join(', ')}`
      : nbRecompenses ? '*Tous les paliers sont atteints.*' : '*Aucune récompense sur ce serveur.*', M.MAX_CHAMP),
  });

  const { details } = L.multiplicateursXp(gid, 'text', { membre, userId: user.id });
  if (details.length) {
    embed.addFields({
      name: '⚡ Multiplicateurs actifs',
      value: M.borner(details.map((d) => M.entree(`${d.libelle} : **${facteurFr(d.pourcent)}**`)).join('\n'), M.MAX_CHAMP),
    });
  }

  const plan = CARTE.planCarteNiveau({
    pseudo, niveau: p.level, rang, courant: p.current, requis: p.needed, total, plafond: p.plafond,
    accent: require('../utils/styleEmbeds').reglages(gid).accent,
  });
  const { png } = await CARTE.fabriquerCarteNiveau(plan, user, cfg.level_image_url);
  const payload = { embeds: [embed] };
  if (png) {
    const nom = `niveau-${user.id}.png`;
    embed.setImage(`attachment://${nom}`);
    payload.files = [new AttachmentBuilder(png, { name: nom })];
  } else {
    embed.setThumbnail(user.displayAvatarURL?.({ size: 128 }) || null);
    if (cfg.level_image_url) embed.setImage(cfg.level_image_url);
  }
  return payload;
}

// ── /niveau classement ─────────────────────────────────────────────────

// Les membres d'une page que le serveur ne connaît plus. Rien n'est conclu
// si Discord ne répond pas à temps : mieux vaut un absent affiché qu'un
// présent effacé du classement.
async function absentsDuClassement(guild, ids) {
  const absents = new Set();
  const inconnus = ids.filter((id) => !guild.members?.cache?.has?.(id));
  if (!inconnus.length || typeof guild.members?.fetch !== 'function') return absents;
  let minuteur = null;
  const trouves = await Promise.race([
    guild.members.fetch({ user: inconnus }).catch(() => null),
    new Promise((r) => { minuteur = setTimeout(() => r(null), 1500); }),
  ]);
  clearTimeout(minuteur);
  if (!trouves || typeof trouves.has !== 'function') return absents;
  for (const id of inconnus) if (!trouves.has(id)) absents.add(id);
  return absents;
}

function ligneClassement(l, tri, absents) {
  const medaille = ['🥇', '🥈', '🥉'][l.rang - 1] || `**#${l.rang}**`;
  const valeur = tri === 'texte' ? `${nombreFr(l.text_xp)} XP écrits`
    : tri === 'vocal' ? `${nombreFr(l.voice_xp)} XP en vocal`
      : `${nombreFr(l.xp)} XP`;
  const parti = l.parti || absents.has(l.user_id) ? ' · *a quitté le serveur*' : '';
  return `${medaille} <@${l.user_id}> · niveau **${l.level}** · ${valeur}${parti}`;
}

async function vueClassementNiveau(guild, { tri = 'total', partis = false, page = 1 } = {}) {
  const t = TRIS_NIVEAU[tri] ? tri : 'total';
  const lignes = L.classementNiveaux(guild.id, { tri: t, partis });
  if (!lignes.length) return null;
  const tranches = [];
  for (let i = 0; i < lignes.length; i += PAR_PAGE_CLASSEMENT) tranches.push(lignes.slice(i, i + PAR_PAGE_CLASSEMENT));
  const blocDe = (tranche, absents = new Set()) => M.bloc(
    tranche[0].rang === tranche[tranche.length - 1].rang ? `Rang ${tranche[0].rang}` : `Rangs ${tranche[0].rang} à ${tranche[tranche.length - 1].rang}`,
    tranche.map((l) => ligneClassement(l, t, absents)),
    { prefixe: TRIS_NIVEAU[t].emoji, compte: null }
  );
  // Une page = une tranche de dix : `paginer` garantit qu'aucune ne déborde.
  const pages = M.paginer(tranches.map((tr) => blocDe(tr)), { maxParPage: 1 });
  const n = Math.min(Math.max(1, Number(page) || 1), pages.length);
  const tranche = tranches[n - 1];

  // Les partis découverts maintenant sont signalés ici, et filtrés ensuite.
  const absents = await absentsDuClassement(guild, tranche.filter((l) => !l.parti).map((l) => l.user_id));
  for (const id of absents) L.noterAbsenceNiveau(guild.id, id);

  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`🏆 Classement du serveur — ${TRIS_NIVEAU[t].nom}`)
    .setDescription(M.description([blocDe(tranche, absents)]))
    .setFooter({
      text: M.piedDePage({
        total: lignes.length, motTotal: 'membre', page: n, pages: pages.length,
        extra: partis ? 'membres partis inclus' : null,
      }),
    });
  const boutons = M.boutonsPages(`niv:page:${t}:${partis ? 1 : 0}`, n, pages.length);
  return { embeds: [embed], components: boutons ? [boutons] : [] };
}

// ── /niveau recompenses ────────────────────────────────────────────────
function vueRecompensesNiveau(guild, userId, page = 1) {
  const recompenses = L.listerRecompensesNiveau(guild.id);
  const mien = L.getLevels(guild.id, userId).level || 0;
  const embed = new EmbedBuilder().setColor(COLORS.INFO).setTitle('🏅 Récompenses de niveau');
  if (!recompenses.length) {
    embed.setDescription('*Aucune récompense n\'est configurée sur ce serveur.*\n'
      + '-# Un staff peut en ajouter via `/config` → 📈 XP & niveaux → 🏅 Récompenses.');
    return { embeds: [embed], components: [] };
  }
  const saoOk = L.saoPretNiveau(guild.id).ok;
  const niveaux = [...new Set(recompenses.map((r) => r.niveau))];
  const blocs = niveaux.map((n) => M.bloc(
    `Niveau ${n}${mien >= n ? ' ✅' : ''}`,
    recompenses.filter((r) => r.niveau === n).map((r) => {
      const inactif = L.TYPES_RECOMPENSE_NIVEAU[r.type]?.sao && !saoOk ? ' *(Aventure SAO inactive)*' : '';
      return `${L.libelleRecompenseNiveau(r)}${inactif}`;
    }),
    { prefixe: mien >= n ? '🏅' : '🔒', compte: null }
  ));
  const pages = M.paginer(blocs, { maxParPage: 8 });
  const p = Math.min(Math.max(1, Number(page) || 1), pages.length);
  const atteints = niveaux.filter((n) => mien >= n).length;
  embed.setDescription(M.description(pages[p - 1])).setFooter({
    text: M.piedDePage({ extra: `Vous êtes niveau ${mien} • ${atteints}/${niveaux.length} palier(s) atteint(s)`, page: p, pages: pages.length, heure: false }),
  });
  const boutons = M.boutonsPages('niv:rec', p, pages.length);
  return { embeds: [embed], components: boutons ? [boutons] : [] };
}

// ── Boutons `niv:` ─────────────────────────────────────────────────────
async function gererBoutonNiveau(interaction) {
  const id = interaction.customId || '';
  if (id.startsWith('niv:raz:')) return require('./xp').gererConfirmationRaz(interaction);
  // Un vieux bouton resté affiché ne doit pas contourner l'interrupteur.
  if (!L.levelsEnabled(interaction.guildId)) return interaction.reply(desactive());
  if (id.startsWith('niv:page:')) {
    const [, , tri, partis, page] = id.split(':');
    const vue = await vueClassementNiveau(interaction.guild, { tri, partis: partis === '1', page: Number(page) });
    return mettreAJour(interaction, vue || { content: '❌ Plus aucun membre classé sur ce serveur.', embeds: [], components: [] });
  }
  if (id.startsWith('niv:rec:')) {
    return mettreAJour(interaction, vueRecompensesNiveau(interaction.guild, interaction.user.id, Number(id.split(':')[2])));
  }
  return interaction.reply({
    content: '⏳ Ce bouton vient d\'une version précédente du bot.\n➜ Relancez `/niveau`.',
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  grade: GRADES.EVERYONE,
  ficheNiveau, vueClassementNiveau, vueRecompensesNiveau, gererBoutonNiveau,
  data: new SlashCommandBuilder()
    .setName('niveau')
    .setDescription('Niveaux du serveur : fiche, classement, récompenses')
    .addSubcommand((sub) =>
      sub
        .setName('voir')
        .setDescription('Voir le niveau d\'un membre, avec sa carte de rang')
        .addUserOption((o) => o.setName('utilisateur').setDescription('Membre (défaut : vous)').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('classement')
        .setDescription('Le classement du serveur, page par page')
        .addStringOption((o) =>
          o.setName('tri').setDescription('Total, écrit ou vocal (défaut : total)').setRequired(false)
            .addChoices({ name: 'Total', value: 'total' }, { name: 'Écrit', value: 'texte' }, { name: 'Vocal', value: 'vocal' }))
        .addBooleanOption((o) => o.setName('partis').setDescription('Montrer aussi les membres qui ont quitté le serveur').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub.setName('recompenses').setDescription('Les récompenses à débloquer par niveau sur ce serveur'))
    .addSubcommand((sub) =>
      sub
        .setName('image')
        .setDescription('[Staff] Image de fond des cartes de niveau (vide = retirer)')
        .addStringOption((o) => o.setName('url').setDescription('URL d\'une image PNG (laisser vide pour retirer)').setRequired(false))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cfg = getGuildConfig(interaction.guildId);

    // 📊 Système coupé : on le dit, plutôt que d'afficher des niveaux figés
    // que plus rien ne fait monter.
    if (!L.levelsEnabled(interaction.guildId) && sub !== 'image') return interaction.reply(desactive());

    if (sub === 'recompenses') {
      return interaction.reply({ ...vueRecompensesNiveau(interaction.guild, interaction.user.id), flags: MessageFlags.Ephemeral });
    }

    if (sub === 'image') {
      if (getGrade(interaction.member, cfg) < GRADES.STAFF) {
        return interaction.reply({ content: '⛔ Réservé au staff.', flags: MessageFlags.Ephemeral });
      }
      const url = interaction.options.getString('url')?.trim() || null;
      if (url && !/^https:\/\//.test(url)) {
        return interaction.reply({ content: '❌ URL invalide : elle doit commencer par `https://`.', flags: MessageFlags.Ephemeral });
      }
      setGuildConfig(interaction.guildId, 'level_image_url', url);
      if (!url) return interaction.reply({ content: '🧹 Image des cartes de niveau retirée.', flags: MessageFlags.Ephemeral });
      // On vérifie tout de suite que la carte saura la dessiner : seul le
      // PNG est lu par le moteur d'images du bot.
      return repondreVite(interaction, async () => {
        const image = await CARTE.telechargerPngNiveau(url, 2000);
        return {
          content: image
            ? '✅ Image enregistrée : elle sert de fond aux cartes de niveau.'
            : '✅ Image enregistrée, mais je n\'ai pas pu la lire comme **PNG**.\n'
              + '➜ Les cartes gardent leur fond par défaut tant que l\'adresse ne mène pas à une image PNG.',
          flags: MessageFlags.Ephemeral,
        };
      }, { ephemere: true });
    }

    if (sub === 'voir') {
      const user = interaction.options.getUser('utilisateur') || interaction.user;
      // L'avatar se télécharge : pas de report d'office, la carte part en un
      // seul message, et on ne diffère qu'à la dernière seconde.
      return repondreVite(interaction, () => ficheNiveau(interaction, user));
    }

    // classement
    const tri = interaction.options.getString('tri') || 'total';
    const partis = Boolean(interaction.options.getBoolean('partis'));
    return repondreVite(interaction, async () => (await vueClassementNiveau(interaction.guild, { tri, partis }))
      || { content: '❌ Aucune donnée de niveau pour le moment.', flags: MessageFlags.Ephemeral });
  },
};
