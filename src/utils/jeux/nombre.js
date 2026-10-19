// 🔢 Plus ou moins — trouver le nombre du bot en peu d'essais.
//
// Partie en solo : seul celui qui l'a lancée propose. Le bouton
// « Proposer » ouvre un formulaire ; chaque essai reçoit son indice ↑ / ↓.
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonStyle } = require('discord.js');
const { COLORS } = require('../embeds');
const { mettreAJour } = require('../reponse');
const M = require('../miseEnPage');
const R = require('./regles');
const P = require('./parties');

const BORNE_MIN = 10;
const BORNE_MAX = 1000;
const BORNE_DEFAUT = 100;

function vueNombre(partie, client, fin = null) {
  const e = partie.etat;
  const restants = e.max - e.essais.length;
  const lignes = [
    `${P.quiJeu(partie.joueurs[0], client)}, je pense à un nombre entre **1** et **${e.borne}**.`,
    `-# ${M.pluriel(e.max, 'essai')} pour le trouver — par dichotomie, c'est toujours possible.`,
  ];
  if (e.essais.length) {
    lignes.push(M.entete('Tes essais', { prefixe: '🎯', compte: e.essais.length, motCompte: 'essai' }));
    for (const n of e.essais.slice(-10)) {
      const indice = n < e.secret ? '⬆️ c\'est plus' : n > e.secret ? '⬇️ c\'est moins' : '✅ trouvé';
      lignes.push(M.entree(`**${n}** → ${indice}`));
    }
  }
  if (fin) {
    lignes.push('', fin.texte);
    const r = P.ligneRecompenseJeu(fin.recompense);
    if (r) lignes.push(r);
  } else {
    lignes.push('', `➜ Encore **${M.pluriel(restants, 'essai')}**.`);
    lignes.push(P.echeanceJeu(partie, 'Sans proposition, la partie expire'));
  }
  const rangees = fin ? [] : [new ActionRowBuilder().addComponents(
    P.boutonJeu(partie.id, 'prop', { label: 'Proposer', emoji: '🎯', style: ButtonStyle.Primary }),
    P.boutonJeu(partie.id, 'abandon', { label: 'Abandonner', emoji: '🏳️' })
  )];
  return {
    content: '',
    embeds: [P.embedJeu('nombre', { description: lignes.join('\n'), couleur: fin?.couleur ?? COLORS.PRIMARY })],
    components: rangees,
  };
}

function modalNombre(partie) {
  return new ModalBuilder()
    .setCustomId(P.idJeu(partie.id, 'propm'))
    .setTitle('🔢 Ta proposition')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('n')
        .setLabel(`Un nombre entre 1 et ${partie.etat.borne}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(4)
    ));
}

const NOMBRE = {
  cle: 'nombre',
  duel: false,
  ouvert: false,

  async lancer(interaction, { alea = Math.random } = {}) {
    const demande = Number(interaction.options?.getInteger?.('max'));
    const borne = Number.isInteger(demande) && demande > 0
      ? Math.min(BORNE_MAX, Math.max(BORNE_MIN, demande))
      : BORNE_DEFAUT;
    const partie = P.creerPartieJeu({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      jeu: 'nombre',
      joueurs: [interaction.user.id],
      etat: { borne, secret: 1 + Math.floor(alea() * borne), max: R.nombreEssaisMax(borne), essais: [] },
      duree: P.DUREES_JEUX.nombre,
    });
    return P.envoyerPartieJeu(interaction, partie, vueNombre(partie, interaction.client));
  },

  vue: vueNombre,

  async agir(interaction, partie, action) {
    const client = interaction.client;
    const moi = interaction.user.id;
    const e = partie.etat;

    if (action === 'prop') return interaction.showModal(modalNombre(partie));

    if (action === 'abandon') {
      if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Cette partie vient de se terminer.');
      P.noterResultatJeu(partie.guild_id, 'nombre', { perdants: [moi] });
      return mettreAJour(interaction, vueNombre(partie, client, {
        texte: `🏳️ Abandon. Le nombre était **${e.secret}**.`,
        couleur: COLORS.WARNING,
      }));
    }

    if (action !== 'propm') return P.priveJeu(interaction, '❓ Ce bouton ne correspond à rien : relance une partie avec `/jeu nombre`.');
    const brut = String(interaction.fields?.getTextInputValue?.('n') || '').trim();
    const n = Number(brut);
    if (!/^\d+$/.test(brut) || n < 1 || n > e.borne) {
      return P.priveJeu(interaction, `❓ « ${M.borner(brut, 20) || 'rien'} » n'est pas un nombre entre 1 et ${e.borne}. Cet essai ne compte pas.`);
    }
    e.essais.push(n);
    const trouve = n === e.secret;
    if (!trouve && e.essais.length < e.max) {
      partie.expire_le = Date.now() + P.DUREES_JEUX.nombre;
      P.sauverPartieJeu(partie);
      return mettreAJour(interaction, vueNombre(partie, client));
    }

    if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Cette partie vient de se terminer.');
    let fin;
    if (trouve) {
      P.noterResultatJeu(partie.guild_id, 'nombre', { gagnants: [moi] });
      const recompense = P.preparerRecompenseJeu(partie.guild_id, moi, { contreBot: true });
      fin = { texte: `🏆 **Trouvé en ${M.pluriel(e.essais.length, 'essai')} : c'était ${e.secret} !**`, couleur: COLORS.SUCCESS, recompense };
    } else {
      P.noterResultatJeu(partie.guild_id, 'nombre', { perdants: [moi] });
      fin = { texte: `💀 **Plus d'essai !** Le nombre était **${e.secret}**. Revanche : \`/jeu nombre\``, couleur: COLORS.DANGER };
    }
    await mettreAJour(interaction, vueNombre(partie, client, fin));
    if (fin.recompense?.xp) await P.verserXpJeu(interaction.guild, moi, fin.recompense.xp, interaction.channel);
    return null;
  },

  conclureExpiree(partie, client) {
    return {
      payload: vueNombre(partie, client, {
        texte: `⌛ **Partie expirée** faute de proposition. Le nombre était **${partie.etat.secret}**.`,
      }),
    };
  },
};

module.exports = { NOMBRE, modalNombre, BORNE_MIN, BORNE_MAX, BORNE_DEFAUT };
