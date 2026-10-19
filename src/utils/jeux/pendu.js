// 🪢 Pendu — tout le salon devine le même mot.
//
// Une lettre se propose par l'un des deux menus (A–M, N–Z) ; le mot entier
// par le bouton « Proposer le mot », qui ouvre un formulaire. Les mots
// viennent de mots.json — un fichier de données, pas du code : il ne
// s'impose pas aux traductions du bot.
const {
  ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonStyle,
} = require('discord.js');
const { COLORS } = require('../embeds');
const { mettreAJour } = require('../reponse');
const M = require('../miseEnPage');
const R = require('./regles');
const P = require('./parties');
const MOTS = require('./mots.json');

const LISTE_MOTS = Object.entries(MOTS).flatMap(([theme, mots]) => mots.map((mot) => ({ theme, mot })));
const MOITIES = {
  am: [...'ABCDEFGHIJKLM'],
  nz: [...'NOPQRSTUVWXYZ'],
};

const tirerMotPendu = (alea = Math.random) => LISTE_MOTS[Math.floor(alea() * LISTE_MOTS.length)];

const occurrences = (mot, lettre) => [...R.penduNormaliser(mot)].filter((c) => c === lettre).length;

function vuePendu(partie, client, fin = null) {
  const e = partie.etat;
  const lettres = fin?.devoile ? [...new Set([...R.penduNormaliser(e.mot)])] : e.lettres;
  const lignes = [
    `-# 🏷️ Thème : ${e.theme} · tout le salon peut jouer`,
    '```',
    R.penduDessin(e.erreurs),
    '```',
    `## \`${R.penduMasque(e.mot, lettres)}\``,
  ];
  if (e.dernier) {
    const d = e.dernier;
    if (d.lettre) {
      const n = occurrences(e.mot, d.lettre);
      lignes.push(M.entree(`${P.quiJeu(d.par, client)} propose **${d.lettre}** : ${n ? `✅ ${n} fois dans le mot` : '❌ absente'}`));
    } else if (d.mot) {
      lignes.push(M.entree(`${P.quiJeu(d.par, client)} tente **${d.mot}** : ${d.bon ? '✅ c\'est le mot !' : '❌ raté'}`));
    }
  }
  lignes.push(M.entree(`Lettres essayées : ${e.lettres.length ? e.lettres.join(' · ') : '*aucune*'}`));
  lignes.push(M.entree(`Erreurs : **${e.erreurs}/${R.PENDU_ERREURS_MAX}**`));
  if (e.faux?.length) lignes.push(M.entree(`Mots tentés : ${e.faux.map((m) => `~~${m}~~`).join(' · ')}`));
  if (fin) {
    lignes.push('', fin.texte);
    const r = P.ligneRecompenseJeu(fin.recompense);
    if (r) lignes.push(r);
  } else {
    lignes.push(P.echeanceJeu(partie, 'Sans proposition, la partie s\'arrête'));
  }

  const rangees = [];
  if (!fin) {
    for (const [cle, alphabet] of Object.entries(MOITIES)) {
      const libres = alphabet.filter((l) => !e.lettres.includes(l));
      if (!libres.length) continue;
      rangees.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(P.idJeu(partie.id, 'l', cle))
          .setPlaceholder(`🔤 Une lettre de ${alphabet[0]} à ${alphabet[alphabet.length - 1]}`)
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(libres.map((l) => ({ label: l, value: l })))
      ));
    }
    rangees.push(new ActionRowBuilder().addComponents(
      P.boutonJeu(partie.id, 'mot', { label: 'Proposer le mot', emoji: '✍️', style: ButtonStyle.Primary }),
      P.boutonJeu(partie.id, 'abandon', { label: 'Arrêter', emoji: '🏳️' })
    ));
  }
  return {
    content: '',
    embeds: [P.embedJeu('pendu', { description: lignes.join('\n'), couleur: fin?.couleur ?? COLORS.PRIMARY })],
    components: rangees,
  };
}

function modalMotPendu(partie) {
  return new ModalBuilder()
    .setCustomId(P.idJeu(partie.id, 'motm'))
    .setTitle('🪢 Proposer le mot')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('mot')
        .setLabel('Ton mot (une erreur coûte un essai)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(30)
        .setPlaceholder(`${[...R.penduNormaliser(partie.etat.mot)].length} lettres`)
    ));
}

// Après une proposition : gagné, pendu, ou on continue.
async function suitePendu(interaction, partie) {
  const client = interaction.client;
  const e = partie.etat;
  const auteur = interaction.user.id;
  const gagne = R.penduTrouve(e.mot, e.lettres);
  const perdu = !gagne && e.erreurs >= R.PENDU_ERREURS_MAX;
  if (!gagne && !perdu) {
    partie.expire_le = Date.now() + P.DUREES_JEUX.pendu;
    P.sauverPartieJeu(partie);
    return mettreAJour(interaction, vuePendu(partie, client));
  }
  if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Cette partie vient de se terminer.');
  const mot = String(e.mot).toUpperCase();
  let fin;
  if (gagne) {
    P.noterResultatJeu(partie.guild_id, 'pendu', { gagnants: [auteur] });
    // Seul dans la partie : c'est une victoire « contre le bot ».
    const recompense = P.preparerRecompenseJeu(partie.guild_id, auteur, { contreBot: e.participants.length < 2 });
    fin = { texte: `🏆 **${P.quiJeu(auteur, client)} trouve le mot ${mot} !**`, couleur: COLORS.SUCCESS, devoile: true, recompense };
  } else {
    P.noterResultatJeu(partie.guild_id, 'pendu', { perdants: e.participants });
    fin = { texte: `💀 **Pendu !** Le mot était **${mot}**. Une revanche ? \`/jeu pendu\``, couleur: COLORS.DANGER, devoile: true };
  }
  await mettreAJour(interaction, vuePendu(partie, client, fin));
  if (fin.recompense?.xp) await P.verserXpJeu(interaction.guild, auteur, fin.recompense.xp, interaction.channel);
  return null;
}

const noterParticipant = (partie, id) => {
  if (!partie.etat.participants.includes(id)) partie.etat.participants.push(id);
};

const PENDU = {
  cle: 'pendu',
  duel: false,
  ouvert: true, // tout le salon joue

  // Un seul pendu à la fois par salon : deux potences côte à côte, on ne
  // saurait plus à laquelle répondre.
  verifier(interaction) {
    const deja = P.partiesDuSalonJeu(interaction.guildId, interaction.channelId).find((p) => p.jeu === 'pendu');
    if (!deja) return null;
    const lien = P.lienPartieJeu(deja);
    return `🪢 Un pendu est déjà en cours dans ce salon : joue avec les autres !${lien ? `\n➜ ${lien}` : ''}`;
  },

  async lancer(interaction) {
    const { theme, mot } = tirerMotPendu();
    const partie = P.creerPartieJeu({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      jeu: 'pendu',
      joueurs: [interaction.user.id],
      etat: { theme, mot, lettres: [], erreurs: 0, participants: [], faux: [], dernier: null },
      duree: P.DUREES_JEUX.pendu,
    });
    return P.envoyerPartieJeu(interaction, partie, vuePendu(partie, interaction.client));
  },

  vue: vuePendu,

  async agir(interaction, partie, action, arg) {
    const moi = interaction.user.id;
    const e = partie.etat;

    if (action === 'mot') return interaction.showModal(modalMotPendu(partie));

    if (action === 'abandon') {
      if (moi !== partie.joueurs[0]) {
        return P.priveJeu(interaction, `⛔ Seul ${P.quiJeu(partie.joueurs[0], interaction.client)}, qui a lancé la partie, peut l'arrêter.`);
      }
      if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Cette partie vient de se terminer.');
      return mettreAJour(interaction, vuePendu(partie, interaction.client, {
        texte: `🏳️ Partie arrêtée. Le mot était **${String(e.mot).toUpperCase()}**.`,
        devoile: true,
      }));
    }

    if (action === 'l') {
      const lettre = R.penduNormaliser(interaction.values?.[0] || '').charAt(0);
      if (!/^[A-Z]$/.test(lettre) || !MOITIES[arg]?.includes(lettre)) {
        return P.priveJeu(interaction, '❓ Choisis une lettre dans l\'un des deux menus.');
      }
      if (e.lettres.includes(lettre)) return P.priveJeu(interaction, `🔁 La lettre **${lettre}** a déjà été proposée.`);
      e.lettres.push(lettre);
      noterParticipant(partie, moi);
      if (!R.penduContient(e.mot, lettre)) e.erreurs += 1;
      e.dernier = { par: moi, lettre };
      return suitePendu(interaction, partie);
    }

    if (action === 'motm') {
      const brut = String(interaction.fields?.getTextInputValue?.('mot') || '').trim();
      const essai = R.penduNormaliser(brut).replace(/[^A-Z]/g, '');
      if (!essai) return P.priveJeu(interaction, '❓ Écris un mot avec des lettres.');
      noterParticipant(partie, moi);
      const affiche = M.borner(brut.toUpperCase(), 30);
      if (essai === R.penduNormaliser(e.mot).replace(/[^A-Z]/g, '')) {
        for (const l of new Set(essai)) if (!e.lettres.includes(l)) e.lettres.push(l);
        e.dernier = { par: moi, mot: affiche, bon: true };
      } else {
        e.erreurs += 1;
        e.faux = [...(e.faux || []), affiche].slice(-8);
        e.dernier = { par: moi, mot: affiche, bon: false };
      }
      return suitePendu(interaction, partie);
    }

    return P.priveJeu(interaction, '❓ Ce bouton ne correspond à rien : relance une partie avec `/jeu pendu`.');
  },

  conclureExpiree(partie, client) {
    return {
      payload: vuePendu(partie, client, {
        texte: `⌛ **Partie expirée** faute de propositions. Le mot était **${String(partie.etat.mot).toUpperCase()}**.`,
        devoile: true,
      }),
    };
  },
};

module.exports = { PENDU, LISTE_MOTS, tirerMotPendu, modalMotPendu };
