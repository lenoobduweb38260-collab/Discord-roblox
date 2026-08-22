const moteur = require('./musiqueMoteur');
const vocal = require('./musiqueVocal');

// 🎶 La SESSION de lecture — une par serveur, et tout son état au même endroit.
//
// L'ancienne version éparpillait la vie d'une lecture entre une classe File,
// six fonctions libres et deux gestionnaires d'événements qui se modifiaient
// l'état les uns des autres. Chaque correctif (les radios mortes, le skip,
// la solitude) rajoutait une pièce au puzzle. Ici, la Session POSSÈDE son
// état : la file, le lecteur, les minuteries, les compteurs — et chaque
// événement passe par une méthode qui dit ce qu'elle fait.
//
// Les règles de comportement, toutes verrouillées par des tests :
//  • on ne joue qu'une fois la connexion PRÊTE (musiqueVocal s'en charge) ;
//  • un morceau illisible est passé, trois de suite arrêtent la session ;
//  • une radio n'a pas de fin : tomber avant 15 s de lecture est un échec
//    (compté), tomber après est un accroc (relancé avec un mot) — et un
//    skip volontaire n'est ni l'un ni l'autre ;
//  • seul dans le salon → départ après une minute ; file vide → après 30 s ;
//  • la déconnexion Discord d'un changement de région n'est pas une panne.

const sessions = new Map(); // guildId → Session

// Deux /musique lancés à 100 ms d'écart, aucune session : sans verrou, le
// second DÉTRUISAIT la connexion que le premier était en train d'ouvrir
// (le registre de @discordjs/voice n'a qu'une connexion par serveur), et on
// finissait avec deux Sessions branchées sur la même connexion. La création
// passe donc sous un verrou par serveur — la RÉSOLUTION des liens, elle,
// reste parallèle : seule la section critique attend son tour.
const verrous = new Map(); // guildId → promesse du tour en cours

async function sousVerrou(guildId, faire) {
  const cle = String(guildId);
  const precedent = verrous.get(cle) || Promise.resolve();
  const tour = precedent.catch(() => {}).then(faire);
  verrous.set(cle, tour);
  try {
    return await tour;
  } finally {
    if (verrous.get(cle) === tour) verrous.delete(cle);
  }
}

const DELAI_SEUL = 60000;      // seul dans le salon : on part au bout d'une minute
const DELAI_VIDE = 30000;      // file terminée : on laisse le temps d'en ajouter
const DELAI_RELANCE = 2000;    // entre deux essais d'une radio tombée
const RADIO_PROUVEE = 15;      // secondes de lecture qui prouvent qu'un direct marche
const MAX_ECHECS = 3;          // trois lectures ratées de suite → on s'arrête
const VOLUME_DEFAUT = 100;

const pour = (guildId) => sessions.get(String(guildId)) || null;

class Session {
  constructor({ guildId, salonTexteId, salonVocalId, connexion, lecteur, client }) {
    this.guildId = String(guildId);
    this.salonTexteId = salonTexteId;
    this.salonVocalId = salonVocalId;
    this.connexion = connexion;
    this.lecteur = lecteur;
    this.client = client;
    this.pistes = [];
    this.encours = null;
    this.ressource = null;
    this.volume = VOLUME_DEFAUT;
    this.boucle = 'aucune'; // 'aucune' | 'piste' | 'file'
    this.echecs = 0;
    this.minuteurs = new Map(); // nom → minuterie ('solitude', 'file-vide', 'relance-radio')
    this.debutLecture = 0;
    this.pause = false;
    this.radioPassee = false; // un skip volontaire n'est pas une panne
    this.brancher();
  }

  // ── Minuteries NOMMÉES ──────────────────────────────────────────
  //
  // L'ancienne version les mettait toutes dans le même sac : annuler la
  // minuterie de solitude parce que quelqu'un entrait dans le salon coupait
  // AUSSI la relance d'une radio tombée — et la session restait suspendue,
  // sans piste et sans minuterie. Nommées, on n'annule que ce qu'on vise.
  attendre(nom, ms, fn) {
    this.annuler(nom);
    const t = setTimeout(() => { this.minuteurs.delete(nom); fn(); }, ms);
    this.minuteurs.set(nom, t);
    return t;
  }

  annuler(nom) {
    const t = this.minuteurs.get(nom);
    if (t) { clearTimeout(t); this.minuteurs.delete(nom); }
  }

  // Un minuteur oublié rallume le bot dans un salon qu'il a quitté depuis
  // longtemps : au départ, on les coupe tous ensemble.
  nettoyer() {
    for (const t of this.minuteurs.values()) clearTimeout(t);
    this.minuteurs.clear();
  }

  // Où en est le morceau, en secondes.
  ecoule() {
    if (!this.encours) return 0;
    return Math.floor((this.ressource?.playbackDuration ?? 0) / 1000);
  }

  // Un mot dans le salon d'où vient la commande. Ne lève jamais : la musique
  // continue même si le salon a été supprimé entre-temps.
  annoncer(contenu) {
    this.client?.channels?.fetch(this.salonTexteId)
      .then((salon) => (salon?.isTextBased() ? salon.send({ content: contenu }) : null))
      .catch(() => null);
  }

  // ── Le fil de la lecture ────────────────────────────────────────
  async jouerSuivante() {
    const suivante = this.pistes[0];
    if (!suivante) {
      this.encours = null;
      // On ne raccroche pas aussitôt : ajouter un morceau juste après la fin
      // du précédent est le cas le plus courant.
      this.attendre('file-vide', DELAI_VIDE, () => {
        if (pour(this.guildId) === this && !this.pistes.length && !this.encours) {
          quitter(this.guildId, 'file terminée');
        }
      });
      return null;
    }

    this.pistes.shift();
    this.encours = suivante;

    try {
      const ressource = await moteur.ouvrirFlux(suivante);
      // ⚠️ /musique stop a pu passer PENDANT l'ouverture du flux : jouer
      // maintenant lancerait un FFmpeg que plus personne ne peut arrêter,
      // sur un lecteur que plus rien n'écoute.
      if (pour(this.guildId) !== this) return null;
      ressource.volume?.setVolume(this.volume / 100);
      this.ressource = ressource;
      this.debutLecture = Date.now();
      this.lecteur.play(ressource);
      // 📻 Pour une radio, FFmpeg « démarre » même sur un flux mort : l'échec
      // n'arrive qu'après. Le compteur ne se remet à zéro qu'une fois le
      // direct PROUVÉ (15 s de lecture), dans finDePiste().
      if (suivante.source !== 'radio') this.echecs = 0;
      return suivante;
    } catch (err) {
      // La session a pu être arrêtée pendant l'ouverture : annoncer un échec
      // APRÈS le « Terminé » de l'utilisateur n'aurait aucun sens.
      if (pour(this.guildId) !== this) return null;
      // ⚠️ Un morceau illisible (vidéo supprimée, restreinte, région bloquée)
      // ne doit PAS emporter la session : on le signale et on passe au suivant.
      this.echecs += 1;
      this.annoncer(`⚠️ Impossible de lire **${suivante.titre}** — ${err.message}`);
      if (this.echecs >= MAX_ECHECS) {
        this.annoncer('⏹️ Trois morceaux de suite illisibles : j\'arrête là.');
        quitter(this.guildId, 'trop d\'échecs de lecture');
        return null;
      }
      return this.jouerSuivante();
    }
  }

  // La fin d'une piste — le SEUL endroit qui décide de la suite.
  finDePiste() {
    const finie = this.encours;

    // 📻 Une radio n'a PAS de fin : arriver ici, c'est que son flux est
    // tombé — sauf si quelqu'un vient de la passer volontairement.
    if (finie?.source === 'radio' && !this.radioPassee) {
      const jouee = this.debutLecture ? (Date.now() - this.debutLecture) / 1000 : 0;
      if (jouee < RADIO_PROUVEE) {
        // Morte dès l'ouverture. Sans ce compteur, une boucle la remettrait
        // sans fin — un processus FFmpeg par tour, en silence.
        this.echecs += 1;
        if (this.echecs >= MAX_ECHECS) {
          this.annoncer(`⚠️ Le flux de **${finie.titre}** coupe dès l'ouverture : la station semble hors service. J'arrête là.`);
          return quitter(this.guildId, 'flux radio mort');
        }
      } else {
        // Un direct qui a tenu puis tombe est un accroc réseau : on relance.
        this.echecs = 0;
        this.annoncer(`📻 Le direct de **${finie.titre}** s'est interrompu — je le relance.`);
      }
      this.pistes.unshift(finie);
      this.encours = null;
      // Un souffle entre deux tentatives : relancer dans la même seconde
      // ferait tourner FFmpeg en boucle serrée tant que la panne dure.
      this.attendre('relance-radio', DELAI_RELANCE, () => {
        this.jouerSuivante().catch((err) => {
          console.warn(`⚠️ Lecture suivante impossible : ${err.message}`);
          quitter(this.guildId, 'erreur de lecture');
        });
      });
      return null;
    }
    this.radioPassee = false;

    // 🔁 Boucles : sur la piste, on la remet devant ; sur la file, en queue.
    if (this.encours) {
      if (this.boucle === 'piste') this.pistes.unshift(this.encours);
      else if (this.boucle === 'file') this.pistes.push(this.encours);
    }
    return this.jouerSuivante().catch((err) => {
      console.warn(`⚠️ Lecture suivante impossible : ${err.message}`);
      quitter(this.guildId, 'erreur de lecture');
    });
  }

  // ── Les branchements, posés UNE fois à la création ─────────────
  brancher() {
    const v = moteur.voice();

    this.lecteur.on(v.AudioPlayerStatus.Idle, () => {
      if (pour(this.guildId) !== this) return;
      this.finDePiste();
    });
    this.lecteur.on('error', (err) => {
      console.warn(`⚠️ Lecteur audio (${this.guildId}) : ${err.message}`);
      // L'événement 'error' laisse le lecteur en Idle : la suite s'enchaîne
      // toute seule par le gestionnaire ci-dessus.
    });

    // Discord coupe et rétablit la connexion quand le salon change de région.
    // Détruire au premier signe couperait la musique pour rien ; ne jamais
    // détruire laisserait un bot fantôme dans le salon.
    this.connexion.on(v.VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          v.entersState(this.connexion, v.VoiceConnectionStatus.Signalling, 5000),
          v.entersState(this.connexion, v.VoiceConnectionStatus.Connecting, 5000),
        ]);
        // Simple changement de région : la connexion se rétablit seule.
      } catch {
        quitter(this.guildId, 'déconnecté du salon vocal');
      }
    });
  }
}

// ── L'API par serveur ──────────────────────────────────────────────

// Le tronc commun : vérifier le vocal, obtenir les pistes, ouvrir la
// connexion s'il le faut, enrôler dans la file. /musique et /radio passent
// tous deux par ici — une seule mécanique, deux commandes.
async function enroler(interaction, obtenirPistes) {
  const salonVocal = interaction.member?.voice?.channel;
  if (!salonVocal) throw new Error('Rejoignez d\'abord un salon vocal.');

  const moi = interaction.guild.members.me;
  const droits = salonVocal.permissionsFor(moi);
  if (!droits?.has('Connect') || !droits?.has('Speak')) {
    throw new Error(`Il me manque **Se connecter** ou **Parler** dans <#${salonVocal.id}>.`);
  }

  const pistes = await obtenirPistes();
  const introuvables = pistes.introuvables || [];

  return sousVerrou(interaction.guildId, async () => {
    let session = pour(interaction.guildId);
    if (session && session.salonVocalId !== salonVocal.id) {
      throw new Error(`Je joue déjà dans <#${session.salonVocalId}>. Rejoignez-le, ou arrêtez la lecture avec \`/musique stop\`.`);
    }

    // La rotation de région ne se raconte qu'à la connexion qui vient de la
    // vivre — pas à chaque morceau ajouté des heures plus tard.
    let nouvelleConnexion = false;
    if (!session) {
      nouvelleConnexion = true;
      const v = moteur.voice();
      const connexion = await vocal.connecter(interaction, salonVocal, () => Boolean(pour(interaction.guildId)));
      const lecteur = v.createAudioPlayer({
        behaviors: { noSubscriber: v.NoSubscriberBehavior.Pause },
      });
      connexion.subscribe(lecteur);
      session = new Session({
        guildId: interaction.guildId,
        salonTexteId: interaction.channelId,
        salonVocalId: salonVocal.id,
        connexion,
        lecteur,
        client: interaction.client,
      });
      sessions.set(String(interaction.guildId), session);
    }

    // 📻 Une radio tombée attend sa relance en tête de file : la nouvelle
    // demande passe DEVANT elle — c'est ce morceau que la carte annonce, et
    // le direct reprendra après lui. Sans cela, la carte disait « Lecture »
    // du morceau pendant que la radio repartait, et le morceau ne jouait
    // jamais, coincé derrière un flux sans fin.
    const relanceEnAttente = session.minuteurs.has('relance-radio');
    session.nettoyer(); // un départ (ou une relance) programmé n'a plus lieu d'être
    if (relanceEnAttente) session.pistes.unshift(...pistes);
    else session.pistes.push(...pistes);

    const premiere = !session.encours;
    if (premiere) await session.jouerSuivante();

    return {
      pistes,
      introuvables,
      premiere,
      position: premiere ? 1 : session.pistes.length,
      noteRegion: nouvelleConnexion ? (session.connexion?.noteRegion || null) : null,
      file: session,
    };
  });
}

// Ajoute un lien ou une recherche. Renvoie ce qu'il faut pour l'afficher.
const ajouter = (interaction, requete) => enroler(interaction, () => moteur.resoudre(requete));

// 📻 Enrôle une station de radio déjà résolue (titre + URL de flux).
const ajouterPiste = (interaction, piste) => enroler(interaction, async () => [piste]);

function quitter(guildId, raison = null) {
  const session = pour(guildId);
  if (!session) return false;
  session.nettoyer();
  session.pistes = [];
  session.encours = null;
  try { session.lecteur.stop(true); } catch {}
  try { session.connexion.destroy(); } catch {}
  sessions.delete(String(guildId));
  if (raison) console.log(`🎵 Musique arrêtée sur ${guildId} : ${raison}.`);
  return true;
}

function passer(guildId) {
  const session = pour(guildId);
  if (!session?.encours) return null;
  const passee = session.encours;
  // ⏭️ Passer une radio est un choix : le gestionnaire de fin ne doit pas la
  // prendre pour une panne et la relancer.
  if (passee.source === 'radio') session.radioPassee = true;
  // ⚠️ La boucle « piste » remettrait le même morceau : passer doit passer.
  const boucle = session.boucle;
  session.boucle = boucle === 'piste' ? 'aucune' : boucle;
  session.lecteur.stop(true);
  session.boucle = boucle;
  return passee;
}

function pause(guildId) {
  const session = pour(guildId);
  if (!session?.encours || session.pause) return false;
  session.pause = session.lecteur.pause(true);
  return session.pause;
}

function reprendre(guildId) {
  const session = pour(guildId);
  if (!session?.encours || !session.pause) return false;
  const ok = session.lecteur.unpause();
  if (ok) session.pause = false;
  return ok;
}

function volume(guildId, valeur) {
  const session = pour(guildId);
  if (!session) return null;
  if (valeur === undefined) return session.volume;
  const v = Math.min(200, Math.max(0, Math.round(Number(valeur) || 0)));
  session.volume = v;
  session.ressource?.volume?.setVolume(v / 100);
  return v;
}

function boucler(guildId, mode) {
  const session = pour(guildId);
  if (!session) return null;
  if (!['aucune', 'piste', 'file'].includes(mode)) return session.boucle;
  session.boucle = mode;
  return mode;
}

function melanger(guildId) {
  const session = pour(guildId);
  if (!session || session.pistes.length < 2) return false;
  // Fisher-Yates : chaque ordre est également probable. Un `sort(() => …)`
  // au hasard ne mélange PAS uniformément, et laisse souvent la tête en place.
  for (let i = session.pistes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [session.pistes[i], session.pistes[j]] = [session.pistes[j], session.pistes[i]];
  }
  return true;
}

function retirer(guildId, position) {
  const session = pour(guildId);
  const i = Number(position) - 1;
  if (!session || !Number.isInteger(i) || i < 0 || i >= session.pistes.length) return null;
  return session.pistes.splice(i, 1)[0];
}

const etat = (guildId) => {
  const session = pour(guildId);
  if (!session) return null;
  return {
    encours: session.encours,
    pistes: [...session.pistes],
    volume: session.volume,
    boucle: session.boucle,
    pause: session.pause,
    ecoule: session.ecoule(),
    salonVocalId: session.salonVocalId,
  };
};

// 👥 Seul dans le salon : on ne joue pas pour les murs.
//
// Appelé par l'événement vocal. Un délai avant de partir, parce qu'une
// reconnexion ou un changement de salon prend quelques secondes.
function verifierSolitude(guildId, nombreHumains) {
  const session = pour(guildId);
  if (!session) return;
  if (nombreHumains > 0) {
    // ⚠️ SEULE la minuterie de solitude : tout couper ici tuait aussi la
    // relance d'une radio tombée, et la session restait suspendue.
    session.annuler('solitude');
    return;
  }
  // Déjà armée ? On la laisse courir : la réarmer à chaque événement vocal
  // (un autre bot qui se mute, entre, sort…) repousserait le départ sans fin.
  if (session.minuteurs.has('solitude')) return;
  session.attendre('solitude', DELAI_SEUL, () => {
    if (pour(guildId)) quitter(guildId, 'plus personne dans le salon');
  });
}

module.exports = {
  Session, sessions, pour, enroler, ajouter, ajouterPiste,
  quitter, passer, pause, reprendre, volume, boucler, melanger, retirer,
  etat, verifierSolitude,
  DELAI_SEUL, DELAI_VIDE, DELAI_RELANCE, RADIO_PROUVEE, MAX_ECHECS, VOLUME_DEFAUT,
};
