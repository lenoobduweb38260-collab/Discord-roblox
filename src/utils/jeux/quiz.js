// 🧠 Quiz — une question, quatre réponses, vingt secondes.
//
// Tout le salon peut répondre ; chacun n'a qu'UN essai, et le premier qui
// trouve gagne. Les questions viennent de quiz.json — des données, pas du
// code : elles ne s'imposent pas aux traductions du bot.
const { ActionRowBuilder, ButtonStyle } = require('discord.js');
const { COLORS } = require('../embeds');
const { mettreAJour } = require('../reponse');
const M = require('../miseEnPage');
const R = require('./regles');
const P = require('./parties');
const BANQUE_QUIZ = require('./quiz.json');

const THEMES_QUIZ = [...new Set(BANQUE_QUIZ.map((q) => q.theme))];
const LETTRES = ['A', 'B', 'C', 'D'];
// Les dernières questions posées par serveur : on évite de reposer la même
// question deux fois de suite.
const recentes = new Map();
const MEMOIRE = 40;

function tirerQuestionQuiz(guildId, theme = null, alea = Math.random) {
  const vues = recentes.get(String(guildId)) || [];
  const candidates = BANQUE_QUIZ.map((q, i) => ({ q, i })).filter(({ q }) => !theme || q.theme === theme);
  const neuves = candidates.filter(({ i }) => !vues.includes(i));
  const choix = (neuves.length ? neuves : candidates)[Math.floor(alea() * (neuves.length || candidates.length))];
  recentes.set(String(guildId), [...vues, choix.i].slice(-MEMOIRE));
  return choix.i;
}

// Les quatre réponses dans l'ordre affiché (mélangé à chaque partie).
const reponsesAffichees = (e) => e.ordre.map((k) => BANQUE_QUIZ[e.q].reponses[k]);

function vueQuiz(partie, client, fin = null) {
  const e = partie.etat;
  const q = BANQUE_QUIZ[e.q];
  const reponses = reponsesAffichees(e);
  const ratees = Object.entries(e.essais || {}).filter(([, k]) => k !== e.bonne).length;
  const lignes = [`-# 🏷️ ${q.theme}`, `**${q.question}**`, ''];
  reponses.forEach((r, k) => lignes.push(M.entree(`**${LETTRES[k]}** · ${r}${fin && k === e.bonne ? ' ✅' : ''}`)));
  lignes.push('');
  if (fin) {
    lignes.push(fin.texte);
    const r = P.ligneRecompenseJeu(fin.recompense);
    if (r) lignes.push(r);
    if (ratees) lignes.push(`-# ❌ ${M.pluriel(ratees, 'mauvaise réponse', 'mauvaises réponses')}`);
  } else {
    lignes.push('➜ Le premier qui répond juste gagne. **Un seul essai** chacun !');
    lignes.push(`-# ⏱️ Fin <t:${Math.ceil(Number(partie.expire_le) / 1000)}:R>.`);
  }
  const rangee = new ActionRowBuilder().addComponents(
    ...reponses.map((r, k) => {
      let style = ButtonStyle.Primary;
      if (fin) style = k === e.bonne ? ButtonStyle.Success : ButtonStyle.Secondary;
      return P.boutonJeu(partie.id, 'r', { arg: k, label: `${LETTRES[k]} · ${r}`, style, desactive: Boolean(fin) });
    })
  );
  return {
    content: '',
    embeds: [P.embedJeu('quiz', { description: lignes.join('\n'), couleur: fin?.couleur ?? COLORS.PRIMARY })],
    components: [rangee],
  };
}

// Ceux qui ont répondu faux comptent une défaite, quelle que soit l'issue.
function noterRatesQuiz(partie, gagnant = null) {
  const e = partie.etat;
  const perdants = Object.entries(e.essais || {}).filter(([id, k]) => k !== e.bonne && id !== gagnant).map(([id]) => id);
  P.noterResultatJeu(partie.guild_id, 'quiz', { gagnants: gagnant ? [gagnant] : [], perdants });
}

const fermerQuizAuTemps = (client, id) => () => require('./moteur').expirerJeuParId(client, id);

const QUIZ = {
  cle: 'quiz',
  duel: false,
  ouvert: true,

  // Une question à la fois par salon.
  verifier(interaction) {
    const deja = P.partiesDuSalonJeu(interaction.guildId, interaction.channelId).find((p) => p.jeu === 'quiz');
    return deja ? '🧠 Une question est déjà posée dans ce salon : réponds-y d\'abord !' : null;
  },

  async lancer(interaction, { alea = Math.random } = {}) {
    const theme = interaction.options?.getString?.('theme');
    const q = tirerQuestionQuiz(interaction.guildId, THEMES_QUIZ.includes(theme) ? theme : null, alea);
    const ordre = R.melangerJeu([0, 1, 2, 3], alea);
    const partie = P.creerPartieJeu({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      jeu: 'quiz',
      joueurs: [interaction.user.id],
      etat: { q, ordre, bonne: ordre.indexOf(BANQUE_QUIZ[q].bonne), essais: {}, debut: Date.now() },
      duree: P.DUREES_JEUX.quiz,
    });
    const envoyee = await P.envoyerPartieJeu(interaction, partie, vueQuiz(partie, interaction.client));
    P.programmerJeu(partie.id, partie.expire_le - Date.now(), fermerQuizAuTemps(interaction.client, partie.id));
    return envoyee;
  },

  vue: vueQuiz,

  async agir(interaction, partie, action, arg) {
    const client = interaction.client;
    const moi = interaction.user.id;
    const e = partie.etat;
    if (action !== 'r') return P.priveJeu(interaction, '❓ Ce bouton ne correspond à aucune réponse.');
    const k = Number(arg);
    if (!Number.isInteger(k) || k < 0 || k > 3) return P.priveJeu(interaction, '❓ Réponse inconnue.');
    if (e.essais[moi] !== undefined) {
      return P.priveJeu(interaction, `🙊 Tu as déjà répondu **${LETTRES[e.essais[moi]]}** : un seul essai par question.`);
    }

    e.essais[moi] = k;
    if (k !== e.bonne) {
      P.sauverPartieJeu(partie);
      return P.priveJeu(interaction, `❌ Raté ! **${LETTRES[k]}** n'est pas la bonne réponse — c'était ton seul essai.`);
    }

    if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Trop tard : la question vient de se fermer.');
    P.annulerMinuteurJeu(partie.id);
    noterRatesQuiz(partie, moi);
    const participants = Object.keys(e.essais).length;
    const recompense = P.preparerRecompenseJeu(partie.guild_id, moi, { contreBot: participants < 2 });
    const quand = Number(interaction.createdTimestamp) || Date.now();
    const secondes = Math.max(0, (quand - Number(e.debut || quand)) / 1000).toFixed(1).replace('.', ',');
    await mettreAJour(interaction, vueQuiz(partie, client, {
      texte: `🏆 **${P.quiJeu(moi, client)} a trouvé en ${secondes} s !**`,
      couleur: COLORS.SUCCESS,
      recompense,
    }));
    if (recompense?.xp) await P.verserXpJeu(interaction.guild, moi, recompense.xp, interaction.channel);
    return null;
  },

  conclureExpiree(partie, client) {
    noterRatesQuiz(partie);
    const bonne = reponsesAffichees(partie.etat)[partie.etat.bonne];
    return {
      payload: vueQuiz(partie, client, {
        texte: `⏱️ **Temps écoulé !** Personne n'a trouvé. La réponse était **${LETTRES[partie.etat.bonne]} · ${bonne}**.`,
      }),
    };
  },

  // Après un redémarrage : la fin de la question se reprogramme.
  rearmer(client, partie) {
    P.programmerJeu(partie.id, partie.expire_le - Date.now(), fermerQuizAuTemps(client, partie.id));
  },
};

module.exports = { QUIZ, BANQUE_QUIZ, THEMES_QUIZ, tirerQuestionQuiz };
