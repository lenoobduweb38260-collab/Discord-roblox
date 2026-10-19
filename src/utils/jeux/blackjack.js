// 🃏 Blackjack — contre le croupier. Tirer, rester ou doubler.
//
// Mise en Col facultative, seulement si l'Aventure SAO est active : elle est
// retirée du solde AU LANCEMENT (impossible de miser deux fois les mêmes
// Col), puis rendue selon l'issue — 2× sur une victoire, 2,5× sur un
// blackjack servi, la mise sur un nul. Sans action, la main « reste » toute
// seule : laisser filer le temps ne rembourse pas une main perdue.
const { ActionRowBuilder, ButtonStyle } = require('discord.js');
const { COLORS } = require('../embeds');
const { mettreAJour } = require('../reponse');
const R = require('./regles');
const P = require('./parties');

const DOS = '🂠';
const montrer = (main) => main.map((c) => `\`${c}\``).join(' ');

function valeurTexte(main) {
  const { total, souple } = R.bjValeur(main);
  if (R.bjBlackjack(main)) return '**21 — Blackjack !**';
  if (total > 21) return `**${total}** — sauté`;
  return `**${total}**${souple ? ' *(as compté 11)*' : ''}`;
}

const ISSUES = {
  blackjack: { texte: '🎉 **Blackjack !** Tu gagnes d\'entrée.', couleur: COLORS.SUCCESS },
  victoire: { texte: '🏆 **Gagné !** Tu bats le croupier.', couleur: COLORS.SUCCESS },
  nul: { texte: '🤝 **Égalité** avec le croupier.', couleur: COLORS.WARNING },
  defaite: { texte: '💀 **Perdu…** Le croupier l\'emporte.', couleur: COLORS.DANGER },
};

function vueBlackjack(partie, client, fin = null) {
  const e = partie.etat;
  const cacher = !fin && e.croupier.length === 2;
  const croupier = cacher
    ? `${montrer([e.croupier[0]])} \`${DOS}\` → **${R.bjValeur([e.croupier[0]]).total} + ?**`
    : `${montrer(e.croupier)} → ${valeurTexte(e.croupier)}`;
  const lignes = [`${P.quiJeu(partie.joueurs[0], client)} contre le croupier${e.mise ? ` · mise : **${e.mise} Col**${e.double ? ' *(doublée)*' : ''}` : ''}`];
  if (fin) {
    lignes.push('', fin.texte);
    if (fin.detail) lignes.push(fin.detail);
    const r = P.ligneRecompenseJeu(fin.recompense);
    if (r) lignes.push(r);
  } else {
    lignes.push('', '➜ **Tirer** une carte, **rester**, ou **doubler** (une seule carte de plus, mise doublée).');
    lignes.push(P.echeanceJeu(partie, 'Sans action, tu restes automatiquement'));
  }
  const rangees = fin ? [] : [new ActionRowBuilder().addComponents(
    P.boutonJeu(partie.id, 'tirer', { label: 'Tirer', emoji: '🃏', style: ButtonStyle.Primary }),
    P.boutonJeu(partie.id, 'rester', { label: 'Rester', emoji: '✋', style: ButtonStyle.Secondary }),
    P.boutonJeu(partie.id, 'doubler', { label: 'Doubler', emoji: '💰', style: ButtonStyle.Success, desactive: e.joueur.length !== 2 })
  )];
  return {
    content: '',
    embeds: [P.embedJeu('blackjack', {
      description: lignes.join('\n'),
      couleur: fin?.couleur ?? COLORS.PRIMARY,
      champs: [
        { name: '🎩 Croupier', value: croupier },
        { name: '🫵 Ta main', value: `${montrer(e.joueur)} → ${valeurTexte(e.joueur)}` },
      ],
    })],
    components: rangees,
  };
}

// 🏁 Solde la main : le croupier joue (sauf si le joueur a sauté), l'issue
// tombe, la mise est rendue selon l'issue. Synchrone — la partie doit déjà
// avoir été « finie » (verrou) par l'appelant.
function solderBlackjack(partie, { avance = '' } = {}) {
  const e = partie.etat;
  const moi = partie.joueurs[0];
  if (R.bjValeur(e.joueur).total <= 21) {
    const joue = R.bjCroupier(e.croupier, e.sabot);
    e.croupier = joue.main;
    e.sabot = joue.sabot;
  }
  const issue = R.bjIssue(e.joueur, e.croupier);
  const gain = R.bjGain(issue, e.mise);
  if (e.mise && gain > 0) P.crediterColJeu(partie.guild_id, moi, gain);
  const gagne = issue === 'victoire' || issue === 'blackjack';
  P.noterResultatJeu(partie.guild_id, 'blackjack', {
    gagnants: gagne ? [moi] : [], perdants: issue === 'defaite' ? [moi] : [], nuls: issue === 'nul' ? [moi] : [],
  });
  let detail = '';
  if (e.mise) {
    detail = gain > e.mise ? `-# 💰 +${gain - e.mise} Col (mise rendue : ${gain})`
      : gain === e.mise ? `-# 💰 Mise rendue : ${gain} Col`
        : `-# 💸 −${e.mise} Col`;
  }
  return {
    issue,
    gagne,
    fin: {
      texte: `${avance}${ISSUES[issue].texte}`,
      couleur: ISSUES[issue].couleur,
      detail,
      recompense: gagne ? P.preparerRecompenseJeu(partie.guild_id, moi, { contreBot: true }) : null,
    },
  };
}

const BLACKJACK = {
  cle: 'blackjack',
  duel: false,
  ouvert: false,

  // La mise se vérifie AVANT le lancement : refuser proprement, sans rien
  // retirer, une mise sans SAO ou plus grosse que le solde.
  verifier(interaction, cfg) {
    const mise = Number(interaction.options?.getInteger?.('mise') || 0);
    if (!mise) return null;
    if (mise < 0) return '❓ Une mise se compte en Col positifs.';
    if (!cfg.sao_enabled) {
      return '⚔️ Les mises en **Col** passent par l\'Aventure SAO, désactivée sur ce serveur.\n➜ Joue sans mise : `/jeu blackjack`.';
    }
    const solde = P.soldeColJeu(interaction.guildId, interaction.user.id);
    if (mise > solde) return `💸 Mise trop haute : tu as **${solde} Col**. Mise moins, ou joue sans mise.`;
    return null;
  },

  async lancer(interaction, { alea = Math.random } = {}) {
    const client = interaction.client;
    const moi = interaction.user.id;
    const mise = Math.max(0, Number(interaction.options?.getInteger?.('mise') || 0));
    if (mise && !P.debiterColJeu(interaction.guildId, moi, mise)) {
      return P.priveJeu(interaction, '💸 Ton solde de Col ne couvre plus cette mise : réessaie avec une mise plus petite.');
    }
    const sabot = R.bjSabot(alea);
    const joueur = [sabot.shift(), sabot.shift()];
    const croupier = [sabot.shift(), sabot.shift()];
    const partie = P.creerPartieJeu({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      jeu: 'blackjack',
      joueurs: [moi],
      etat: { sabot, joueur, croupier, mise, double: false },
      tour: moi,
      duree: P.DUREES_JEUX.blackjack,
    });
    // Un 21 servi (chez le joueur ou le croupier) se règle tout de suite.
    if (R.bjBlackjack(joueur) || R.bjBlackjack(croupier)) {
      P.finirPartieJeu(partie.id);
      const s = solderBlackjack(partie);
      await interaction.reply({ ...vueBlackjack(partie, client, s.fin), allowedMentions: { parse: [] } });
      if (s.fin.recompense?.xp) await P.verserXpJeu(interaction.guild, moi, s.fin.recompense.xp, interaction.channel);
      return null;
    }
    return P.envoyerPartieJeu(interaction, partie, vueBlackjack(partie, client));
  },

  vue: vueBlackjack,

  async agir(interaction, partie, action) {
    const client = interaction.client;
    const moi = interaction.user.id;
    const e = partie.etat;

    if (action === 'doubler') {
      if (e.joueur.length !== 2) return P.priveJeu(interaction, '❌ On ne double que sur les deux premières cartes.');
      if (e.mise && !P.debiterColJeu(partie.guild_id, moi, e.mise)) {
        return P.priveJeu(interaction, `💸 Il te faut encore **${e.mise} Col** pour doubler : tire ou reste.`);
      }
      e.mise *= 2;
      e.double = true;
      e.joueur.push(e.sabot.shift());
    } else if (action === 'tirer') {
      e.joueur.push(e.sabot.shift());
    } else if (action !== 'rester') {
      return P.priveJeu(interaction, '❓ Ce bouton ne correspond à rien : relance une partie avec `/jeu blackjack`.');
    }

    const total = R.bjValeur(e.joueur).total;
    const continuer = action === 'tirer' && total < 21;
    if (continuer) {
      partie.expire_le = Date.now() + P.DUREES_JEUX.blackjack;
      P.sauverPartieJeu(partie);
      return mettreAJour(interaction, vueBlackjack(partie, client));
    }

    // Rester, doubler, 21 tout rond ou main sautée : on solde.
    if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Cette main vient de se terminer.');
    const s = solderBlackjack(partie);
    await mettreAJour(interaction, vueBlackjack(partie, client, s.fin));
    if (s.fin.recompense?.xp) await P.verserXpJeu(interaction.guild, moi, s.fin.recompense.xp, interaction.channel);
    return null;
  },

  // Sans action à temps : la main reste telle quelle et se solde.
  conclureExpiree(partie, client) {
    const s = solderBlackjack(partie, { avance: '⌛ Temps écoulé : tu restes sur ta main.\n' });
    return {
      payload: vueBlackjack(partie, client, s.fin),
      xp: s.fin.recompense?.xp ? { userId: partie.joueurs[0], montant: s.fin.recompense.xp } : null,
    };
  },

  // Le jeu est coupé en pleine main : la mise est rendue, rien n'est compté.
  annuler(partie) {
    if (partie.etat.mise) P.crediterColJeu(partie.guild_id, partie.joueurs[0], partie.etat.mise);
  },
};

module.exports = { BLACKJACK, solderBlackjack };
