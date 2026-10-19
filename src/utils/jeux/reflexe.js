// ⚡ Réflexe — le bouton passe au vert après un délai au hasard ; le premier
// qui clique gagne. Cliquer AVANT élimine.
//
// Le passage au vert se fait hors interaction (minuteur), en rééditant le
// message. L'état vit en base : après un redémarrage, le minuteur se
// reprogramme (rearmer) et le balayage rattrape ce qui aurait été manqué.
const { ActionRowBuilder, ButtonStyle } = require('discord.js');
const { COLORS } = require('../embeds');
const { mettreAJour } = require('../reponse');
const M = require('../miseEnPage');
const P = require('./parties');

const DELAI_MIN = 2000;
const DELAI_MAX = 7000;

function vueReflexe(partie, client, fin = null) {
  const e = partie.etat;
  const lignes = [];
  if (fin) {
    lignes.push(fin.texte);
    const r = P.ligneRecompenseJeu(fin.recompense);
    if (r) lignes.push(r);
  } else if (e.phase === 'go') {
    lignes.push('## 🟢 MAINTENANT !', '➜ Le premier qui clique gagne.');
  } else {
    lignes.push(
      '## 🔴 Attendez…',
      M.entree('Le bouton passera au **vert** dans quelques secondes.'),
      M.entree('Le premier qui clique dessus gagne.'),
      M.entree('Cliquer trop tôt = **éliminé·e**.')
    );
  }
  if (e.elimines?.length) lignes.push(`-# 🚫 Trop pressé·es : ${e.elimines.map((id) => P.quiJeu(id, client)).join(', ')}`);
  const vert = e.phase === 'go' && !fin;
  const rangee = new ActionRowBuilder().addComponents(
    P.boutonJeu(partie.id, 'clic', {
      label: vert ? 'CLIQUE !' : fin ? 'Terminé' : 'Attends…',
      emoji: vert ? '⚡' : '⏳',
      style: vert ? ButtonStyle.Success : ButtonStyle.Secondary,
      desactive: Boolean(fin),
    })
  );
  return {
    content: '',
    embeds: [P.embedJeu('reflexe', { description: lignes.join('\n'), couleur: fin?.couleur ?? (vert ? COLORS.SUCCESS : COLORS.PRIMARY) })],
    components: [rangee],
  };
}

// 🟢 Le signal : le bouton passe au vert.
//
// La partie ne passe en phase « go » qu'une fois la réédition CONFIRMÉE.
// Pendant l'envoi (phase « envoi »), l'écran montre encore le bouton gris :
// un clic reçoit « pas encore vert », sans victoire ni élimination. Avant,
// la phase « go » était posée d'abord — un clic sur le bouton encore gris
// gagnait, puis le vert, arrivé en retard, réaffichait « CLIQUE ! » sur une
// partie déjà finie.
async function signalReflexe(client, id) {
  const partie = P.lirePartieJeu(id);
  if (!partie || partie.etat.phase !== 'attente') return false;
  partie.etat.phase = 'envoi';
  P.sauverPartieJeu(partie);
  const vert = { ...partie, etat: { ...partie.etat, phase: 'go' } };
  const affiche = await P.editerMessageJeu(client, partie, vueReflexe(vert, client));
  // Relue : la partie a pu finir pendant l'envoi (jeu coupé, expiration).
  // Sa conclusion a été rééditée APRÈS le vert (les rééditions d'une partie
  // se suivent) : on ne touche plus à rien.
  const fraiche = P.lirePartieJeu(id);
  if (!fraiche || fraiche.etat.phase !== 'envoi') return false;
  if (!affiche) {
    // Message introuvable ou non modifiable : personne ne verrait le vert.
    // On arrête plutôt que de laisser gagner un clic « à l'aveugle ».
    P.annulerMinuteurJeu(id);
    P.finirPartieJeu(id);
    return false;
  }
  fraiche.etat.phase = 'go';
  fraiche.etat.go_le = Date.now();
  fraiche.expire_le = Date.now() + P.DUREES_JEUX.reflexeFenetre;
  P.sauverPartieJeu(fraiche);
  P.programmerJeu(id, P.DUREES_JEUX.reflexeFenetre, () => require('./moteur').expirerJeuParId(client, id));
  return true;
}

const REFLEXE = {
  cle: 'reflexe',
  duel: false,
  ouvert: true,

  verifier(interaction) {
    const deja = P.partiesDuSalonJeu(interaction.guildId, interaction.channelId).find((p) => p.jeu === 'reflexe');
    return deja ? '⚡ Un réflexe est déjà en cours dans ce salon : tente ta chance dessus !' : null;
  },

  async lancer(interaction, { alea = Math.random } = {}) {
    const delai = DELAI_MIN + Math.floor(alea() * (DELAI_MAX - DELAI_MIN));
    const goPrevu = Date.now() + delai;
    const partie = P.creerPartieJeu({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      jeu: 'reflexe',
      joueurs: [interaction.user.id],
      etat: { phase: 'attente', go_prevu: goPrevu, go_le: null, elimines: [], participants: [] },
      duree: delai + P.DUREES_JEUX.reflexeFenetre,
    });
    const envoyee = await P.envoyerPartieJeu(interaction, partie, vueReflexe(partie, interaction.client));
    P.programmerJeu(partie.id, goPrevu - Date.now(), () => signalReflexe(interaction.client, partie.id));
    return envoyee;
  },

  vue: vueReflexe,

  async agir(interaction, partie, action) {
    const client = interaction.client;
    const moi = interaction.user.id;
    const e = partie.etat;
    if (action !== 'clic') return P.priveJeu(interaction, '❓ Ce bouton ne correspond à rien.');
    if (e.elimines.includes(moi)) return P.priveJeu(interaction, '🚫 Tu es éliminé·e de cette manche : patience pour la prochaine !');
    // Le vert est en route mais pas encore affiché : ni victoire (le
    // bouton était gris sous ses yeux) ni élimination (il passe au vert).
    if (e.phase === 'envoi') return P.priveJeu(interaction, '⏳ Pas encore vert : le bouton est en train de changer. Reclique dès qu\'il passe au vert !');
    if (!e.participants.includes(moi)) e.participants.push(moi);

    if (e.phase !== 'go') {
      // ⚠️ Pas de mise à jour du message ici : elle pourrait arriver APRÈS
      // le passage au vert et le ramener au rouge. La liste des éliminés
      // s'affichera au signal ou à la fin.
      e.elimines.push(moi);
      P.sauverPartieJeu(partie);
      return P.priveJeu(interaction, '🚫 **Trop tôt !** Le bouton n\'était pas encore vert : tu es éliminé·e de cette manche.');
    }

    if (!P.finirPartieJeu(partie.id)) return P.priveJeu(interaction, '⌛ Trop tard : quelqu\'un a été plus rapide !');
    P.annulerMinuteurJeu(partie.id);
    P.noterResultatJeu(partie.guild_id, 'reflexe', { gagnants: [moi], perdants: e.elimines });
    const recompense = P.preparerRecompenseJeu(partie.guild_id, moi, { contreBot: e.participants.length < 2 });
    const quand = Number(interaction.createdTimestamp) || Date.now();
    const temps = Math.max(0, (quand - Number(e.go_le || quand)) / 1000).toFixed(3).replace('.', ',');
    await mettreAJour(interaction, vueReflexe(partie, client, {
      texte: `🏆 **${P.quiJeu(moi, client)} gagne en ${temps} s !**`,
      couleur: COLORS.SUCCESS,
      recompense,
    }));
    if (recompense?.xp) await P.verserXpJeu(interaction.guild, moi, recompense.xp, interaction.channel);
    return null;
  },

  conclureExpiree(partie, client) {
    const e = partie.etat;
    if (e.elimines?.length) P.noterResultatJeu(partie.guild_id, 'reflexe', { perdants: e.elimines });
    const texte = e.phase === 'go'
      ? '⌛ **Personne n\'a cliqué à temps.** Relance avec `/jeu reflexe` !'
      : '⌛ **Partie interrompue** avant le signal. Relance avec `/jeu reflexe` !';
    return { payload: vueReflexe(partie, client, { texte }) };
  },

  rearmer(client, partie) {
    // Coupé en plein envoi du vert : la partie n'a jamais été « go », on
    // retente le signal.
    if (partie.etat.phase === 'envoi') {
      partie.etat.phase = 'attente';
      P.sauverPartieJeu(partie);
    }
    if (partie.etat.phase === 'attente') {
      P.programmerJeu(partie.id, Number(partie.etat.go_prevu) - Date.now(), () => signalReflexe(client, partie.id));
    } else {
      P.programmerJeu(partie.id, partie.expire_le - Date.now(), () => require('./moteur').expirerJeuParId(client, partie.id));
    }
  },
};

module.exports = { REFLEXE, signalReflexe, DELAI_MIN, DELAI_MAX };
