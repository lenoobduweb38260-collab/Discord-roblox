// 📊 Statistiques et classement des mini-jeux — grammaire ◆ / ➜ de
// miseEnPage, pagination entre deux blocs, jamais au milieu.
const { EmbedBuilder } = require('discord.js');
const { COLORS } = require('../embeds');
const { mettreAJour } = require('../reponse');
const M = require('../miseEnPage');
const P = require('./parties');

const MEDAILLES = ['🥇', '🥈', '🥉'];
const PAR_PAGE = 10;

// Les jeux qui tiennent des statistiques (le démineur n'a pas d'issue).
const JEUX_CLASSES = P.CATALOGUE_JEUX.filter((j) => j.cle !== 'demineur');

const taux = (v, d, n) => {
  const total = v + d + n;
  return total ? Math.round((v / total) * 100) : 0;
};

const ligneBilan = (v, d, n) =>
  `${M.pluriel(v, 'victoire')} · ${M.pluriel(d, 'défaite')} · ${M.pluriel(n, 'nul')}`;

// /jeu stats [membre]
function vueStatsJeux(guild, user) {
  const lignesStats = P.statsMembreJeux(guild.id, user.id);
  const nom = guild.members?.cache?.get(user.id)?.displayName || user.displayName || user.globalName || user.username || 'ce membre';
  const embed = new EmbedBuilder().setColor(COLORS.PRIMARY).setTitle(`📊 Mini-jeux — ${nom}`);
  if (!lignesStats.length) {
    embed.setDescription(`*<@${user.id}> n'a encore terminé aucune partie.*\n➜ Lance-toi avec \`/jeu morpion\`, \`/jeu quiz\` ou \`/jeu pendu\` !`);
    return { embeds: [embed], allowedMentions: { parse: [] } };
  }
  const tot = lignesStats.reduce((a, r) => ({ v: a.v + r.victoires, d: a.d + r.defaites, n: a.n + r.nuls }), { v: 0, d: 0, n: 0 });
  const blocs = [
    M.bloc('Bilan', [
      ligneBilan(tot.v, tot.d, tot.n),
      M.statistique('Réussite', `${taux(tot.v, tot.d, tot.n)} %`, M.pluriel(tot.v + tot.d + tot.n, 'partie')),
    ], { prefixe: '🏅', compte: null }),
  ];
  for (const r of lignesStats) {
    const info = P.infoJeu(r.jeu);
    const total = r.victoires + r.defaites + r.nuls;
    blocs.push(M.bloc(info.nom, [ligneBilan(r.victoires, r.defaites, r.nuls)], {
      prefixe: info.emoji, compte: total, motCompte: 'partie',
    }));
  }
  embed.setDescription(M.borner(`<@${user.id}>\n${M.description(blocs)}`, M.MAX_DESCRIPTION));
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

// /jeu classement [jeu] — `cle` : une clé de jeu, ou 'tous'.
function vueClassementJeux(guild, cle = 'tous', page = 1) {
  const jeu = JEUX_CLASSES.some((j) => j.cle === cle) ? cle : 'tous';
  const lignesCl = P.classementJeux(guild.id, jeu === 'tous' ? null : jeu);
  const info = jeu === 'tous' ? { nom: 'Tous les jeux', emoji: '🏆' } : P.infoJeu(jeu);
  const embed = new EmbedBuilder().setColor(COLORS.PRIMARY).setTitle(`${info.emoji} Classement — ${info.nom}`);
  if (!lignesCl.length) {
    embed.setDescription('*Personne n\'a encore de partie terminée ici.*\n➜ Lance la première avec `/jeu` !');
    return { embeds: [embed], components: [], allowedMentions: { parse: [] } };
  }
  const blocs = lignesCl.map((r, k) => M.bloc(`<@${r.user_id}>`, [
    `${M.pluriel(r.defaites, 'défaite')} · ${M.pluriel(r.nuls, 'nul')} · ${taux(r.victoires, r.defaites, r.nuls)} % de réussite`,
  ], { prefixe: MEDAILLES[k] || `#${k + 1}`, compte: r.victoires, motCompte: 'victoire' }));
  const pages = M.paginer(blocs, { maxParPage: PAR_PAGE });
  const p = Math.min(Math.max(1, Number(page) || 1), pages.length);
  embed
    .setDescription(M.borner(M.description(pages[p - 1]), M.MAX_DESCRIPTION))
    .setFooter({ text: M.piedDePage({ total: lignesCl.length, motTotal: 'joueur', page: p, pages: pages.length, heure: false }) });
  const nav = M.boutonsPages(`jeu:cl:${jeu}`, p, pages.length);
  return { embeds: [embed], components: nav ? [nav] : [], allowedMentions: { parse: [] } };
}

// Bouton « jeu:cl:<jeu>:<page> » — n'importe qui peut feuilleter.
function pageClassementJeux(interaction, cle, page) {
  return mettreAJour(interaction, vueClassementJeux(interaction.guild, cle, page));
}

module.exports = { JEUX_CLASSES, vueStatsJeux, vueClassementJeux, pageClassementJeux };
