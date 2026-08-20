const moteur = require('./musiqueMoteur');
const S = require('./musiqueSources');

// 🎶 File d'attente et connexion vocale.
//
// Trois défauts se cumulaient dans la version précédente, et chacun suffisait
// à ce que « rien ne fonctionne » :
//
//  1. play-dl n'était jamais préparé — voir musiqueMoteur ;
//  2. la lecture démarrait AVANT que la connexion vocale soit prête. Le bot
//     rejoignait le salon et restait muet, sans la moindre erreur ;
//  3. un morceau illisible détruisait la connexion : une seule vidéo
//     supprimée coupait toute la session.
//
// Ici : on attend l'état « prêt », un morceau fautif est passé, et la
// déconnexion est distinguée d'un simple changement de région.

const files = new Map(); // guildId → File

const DELAI_PRET = 20000;      // Discord met parfois 10 s à ouvrir le vocal
const DELAI_SEUL = 60000;      // seul dans le salon : on part au bout d'une minute
const DELAI_VIDE = 30000;      // file terminée : on laisse le temps d'en ajouter
const MAX_ECHECS = 3;          // trois morceaux illisibles de suite → on s'arrête
const VOLUME_DEFAUT = 100;

class File {
  constructor({ guildId, salonTexteId, salonVocalId, connexion, lecteur }) {
    this.guildId = guildId;
    this.salonTexteId = salonTexteId;
    this.salonVocalId = salonVocalId;
    this.connexion = connexion;
    this.lecteur = lecteur;
    this.pistes = [];
    this.encours = null;
    this.ressource = null;
    this.volume = VOLUME_DEFAUT;
    this.boucle = 'aucune'; // 'aucune' | 'piste' | 'file'
    this.echecs = 0;
    this.minuteurs = new Set();
    this.debutLecture = 0;
    this.pause = false;
  }

  attendre(ms, fn) {
    const t = setTimeout(() => { this.minuteurs.delete(t); fn(); }, ms);
    this.minuteurs.add(t);
    return t;
  }

  // Un minuteur oublié rallume le bot dans un salon qu'il a quitté depuis
  // longtemps : on les coupe tous ensemble.
  nettoyer() {
    for (const t of this.minuteurs) clearTimeout(t);
    this.minuteurs.clear();
  }

  // Où en est le morceau, en secondes.
  ecoule() {
    if (!this.encours) return 0;
    return Math.floor((this.ressource?.playbackDuration ?? 0) / 1000);
  }
}

const fileDe = (guildId) => files.get(String(guildId)) || null;

// ── Connexion ────────────────────────────────────────────────────

async function connecter(interaction, salonVocal) {
  const v = moteur.voice();
  const connexion = v.joinVoiceChannel({
    channelId: salonVocal.id,
    guildId: interaction.guildId,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  // ⚠️ L'étape qui manquait. `joinVoiceChannel` rend la main tout de suite,
  // bien avant que la voix soit établie : jouer à cet instant envoie l'audio
  // dans le vide. Le bot apparaissait dans le salon, et personne n'entendait
  // rien — sans aucune erreur pour l'expliquer.
  try {
    await v.entersState(connexion, v.VoiceConnectionStatus.Ready, DELAI_PRET);
  } catch {
    const etatAtteint = connexion.state?.status || 'inconnu';
    connexion.destroy();
    throw new Error(expliquerEchecVocal(etatAtteint, salonVocal));
  }
  return connexion;
}

// 🩺 Pourquoi la voix ne s'est pas ouverte.
//
// L'ancien message accusait les permissions. C'était FAUX dans le cas le plus
// courant, et trompeur dans tous : les permissions sont vérifiées avant même
// d'essayer de se connecter — si on arrive ici, elles sont bonnes.
//
// L'état atteint, lui, dit vraiment où ça bloque :
//
//   signalling → la passerelle n'a jamais répondu. Intent vocal manquant, ou
//                le bot est déjà connecté ailleurs sur ce serveur.
//   connecting → la passerelle a répondu, mais la voix elle-même n'aboutit
//                pas. C'est l'UDP : soit une brique audio manque, soit
//                l'hébergeur bloque les ports.
//
// Et on cite d'abord ce qui manque, quand quelque chose manque : c'est la
// seule cause qu'on puisse constater sans quitter le processus.
function expliquerEchecVocal(etatAtteint, salonVocal) {
  const manque = moteur.briquesManquantes();
  const lignes = [`❌ Je n'ai pas réussi à ouvrir <#${salonVocal.id}>.`];

  if (manque) {
    lignes.push(
      '',
      '**Cause trouvée : il manque une brique audio sur l\'hébergeur.**',
      ...manque.map((m) => `➜ ${m}`),
      '-# Sans elle, la connexion est acceptée puis n\'aboutit jamais — cela ressemble à un problème de permissions, mais n\'en est pas un.'
    );
    return lignes.join('\n');
  }

  if (etatAtteint === 'signalling') {
    lignes.push(
      '',
      '**Discord n\'a jamais répondu à ma demande de connexion.**',
      '➜ Vérifiez que l\'intent **Server Voice States** est actif sur le portail développeur.',
      '➜ Vérifiez aussi que je ne suis pas déjà connecté à un autre salon vocal de ce serveur : déconnectez-moi à la main, puis réessayez.'
    );
    return lignes.join('\n');
  }

  if (etatAtteint === 'connecting') {
    lignes.push(
      '',
      '**Discord a accepté, mais le flux vocal n\'aboutit pas.**',
      '➜ C\'est presque toujours l\'hébergeur qui bloque les ports **UDP** sortants — beaucoup d\'hébergements mutualisés le font.',
      '➜ Essayez de changer la **région du salon vocal** (Modifier le salon → Région) : cela change de serveur vocal.',
      '-# Mes permissions sont bonnes : je les vérifie avant même d\'essayer.'
    );
    return lignes.join('\n');
  }

  lignes.push(
    '',
    `La connexion s'est arrêtée à l'état « ${etatAtteint} ».`,
    '➜ Lancez `/musique sources` : le diagnostic y détaille l\'état des briques audio.'
  );
  return lignes.join('\n');
}

// Discord coupe et rétablit la connexion quand le salon change de région.
// Détruire au premier signe couperait la musique pour rien ; ne jamais
// détruire laisserait un bot fantôme dans le salon.
function surveillerConnexion(file, client) {
  const v = moteur.voice();
  file.connexion.on(v.VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        v.entersState(file.connexion, v.VoiceConnectionStatus.Signalling, 5000),
        v.entersState(file.connexion, v.VoiceConnectionStatus.Connecting, 5000),
      ]);
      // Simple changement de région : la connexion se rétablit seule.
    } catch {
      quitter(file.guildId, 'déconnecté du salon vocal');
    }
  });
}

// ── Lecture ──────────────────────────────────────────────────────

async function jouerSuivante(guildId, client) {
  const file = fileDe(guildId);
  if (!file) return;

  const suivante = file.pistes[0];
  if (!suivante) {
    file.encours = null;
    // On ne raccroche pas aussitôt : ajouter un morceau juste après la fin
    // du précédent est le cas le plus courant.
    file.attendre(DELAI_VIDE, () => {
      const f = fileDe(guildId);
      if (f && !f.pistes.length && !f.encours) quitter(guildId, 'file terminée');
    });
    return;
  }

  file.pistes.shift();
  file.encours = suivante;

  try {
    const ressource = await moteur.ouvrirFlux(suivante);
    ressource.volume?.setVolume(file.volume / 100);
    file.ressource = ressource;
    file.debutLecture = Date.now();
    file.lecteur.play(ressource);
    file.echecs = 0;
    return suivante;
  } catch (err) {
    // ⚠️ Un morceau illisible (vidéo supprimée, restreinte, région bloquée)
    // ne doit PAS emporter la session : on le signale et on passe au suivant.
    file.echecs += 1;
    annoncer(client, file, `⚠️ Impossible de lire **${suivante.titre}** — ${err.message}`);
    if (file.echecs >= MAX_ECHECS) {
      annoncer(client, file, '⏹️ Trois morceaux de suite illisibles : j\'arrête là.');
      return quitter(guildId, 'trop d\'échecs de lecture');
    }
    return jouerSuivante(guildId, client);
  }
}

// Un mot dans le salon d'où vient la commande. Ne doit jamais lever : la
// musique continue même si le salon a été supprimé entre-temps.
function annoncer(client, file, contenu) {
  client?.channels?.fetch(file.salonTexteId)
    .then((salon) => (salon?.isTextBased() ? salon.send({ content: contenu }) : null))
    .catch(() => null);
}

function brancherLecteur(file, client) {
  const v = moteur.voice();
  file.lecteur.on(v.AudioPlayerStatus.Idle, () => {
    const f = fileDe(file.guildId);
    if (!f) return;
    // 🔁 Boucles : sur la piste, on la remet devant ; sur la file, en queue.
    if (f.encours) {
      if (f.boucle === 'piste') f.pistes.unshift(f.encours);
      else if (f.boucle === 'file') f.pistes.push(f.encours);
    }
    jouerSuivante(file.guildId, client).catch((err) => {
      console.warn(`⚠️ Lecture suivante impossible : ${err.message}`);
      quitter(file.guildId, 'erreur de lecture');
    });
  });
  file.lecteur.on('error', (err) => {
    console.warn(`⚠️ Lecteur audio (${file.guildId}) : ${err.message}`);
    // L'événement 'error' laisse le lecteur en Idle : la suite s'enchaîne
    // toute seule par le gestionnaire ci-dessus.
  });
}

// ── API publique ─────────────────────────────────────────────────

// Ajoute un lien ou une recherche. Renvoie ce qu'il faut pour l'afficher.
async function ajouter(interaction, requete) {
  const salonVocal = interaction.member?.voice?.channel;
  if (!salonVocal) throw new Error('Rejoignez d\'abord un salon vocal.');

  const moi = interaction.guild.members.me;
  const droits = salonVocal.permissionsFor(moi);
  if (!droits?.has('Connect') || !droits?.has('Speak')) {
    throw new Error(`Il me manque **Se connecter** ou **Parler** dans <#${salonVocal.id}>.`);
  }

  const pistes = await moteur.resoudre(requete);
  const introuvables = pistes.introuvables || [];

  let file = fileDe(interaction.guildId);
  if (file && file.salonVocalId !== salonVocal.id) {
    throw new Error(`Je joue déjà dans <#${file.salonVocalId}>. Rejoignez-le, ou arrêtez la lecture avec \`/musique stop\`.`);
  }

  if (!file) {
    const v = moteur.voice();
    const connexion = await connecter(interaction, salonVocal);
    const lecteur = v.createAudioPlayer({
      behaviors: { noSubscriber: v.NoSubscriberBehavior.Pause },
    });
    connexion.subscribe(lecteur);
    file = new File({
      guildId: String(interaction.guildId),
      salonTexteId: interaction.channelId,
      salonVocalId: salonVocal.id,
      connexion,
      lecteur,
    });
    files.set(String(interaction.guildId), file);
    brancherLecteur(file, interaction.client);
    surveillerConnexion(file, interaction.client);
  }

  const premiere = !file.encours;
  file.pistes.push(...pistes);
  file.nettoyer(); // un départ programmé n'a plus lieu d'être
  if (premiere) await jouerSuivante(interaction.guildId, interaction.client);

  return {
    pistes,
    introuvables,
    premiere,
    position: premiere ? 1 : file.pistes.length,
    file,
  };
}

function quitter(guildId, raison = null) {
  const file = fileDe(guildId);
  if (!file) return false;
  file.nettoyer();
  file.pistes = [];
  file.encours = null;
  try { file.lecteur.stop(true); } catch {}
  try { file.connexion.destroy(); } catch {}
  files.delete(String(guildId));
  if (raison) console.log(`🎵 Musique arrêtée sur ${guildId} : ${raison}.`);
  return true;
}

function passer(guildId) {
  const file = fileDe(guildId);
  if (!file?.encours) return null;
  const passee = file.encours;
  // ⚠️ La boucle « piste » remettrait le même morceau : passer doit passer.
  const boucle = file.boucle;
  file.boucle = boucle === 'piste' ? 'aucune' : boucle;
  file.lecteur.stop(true);
  file.boucle = boucle;
  return passee;
}

function pause(guildId) {
  const file = fileDe(guildId);
  if (!file?.encours || file.pause) return false;
  file.pause = file.lecteur.pause(true);
  return file.pause;
}

function reprendre(guildId) {
  const file = fileDe(guildId);
  if (!file?.encours || !file.pause) return false;
  const ok = file.lecteur.unpause();
  if (ok) file.pause = false;
  return ok;
}

function volume(guildId, valeur) {
  const file = fileDe(guildId);
  if (!file) return null;
  if (valeur === undefined) return file.volume;
  const v = Math.min(200, Math.max(0, Math.round(Number(valeur) || 0)));
  file.volume = v;
  file.ressource?.volume?.setVolume(v / 100);
  return v;
}

function boucler(guildId, mode) {
  const file = fileDe(guildId);
  if (!file) return null;
  if (!['aucune', 'piste', 'file'].includes(mode)) return file.boucle;
  file.boucle = mode;
  return mode;
}

function melanger(guildId) {
  const file = fileDe(guildId);
  if (!file || file.pistes.length < 2) return false;
  // Fisher-Yates : chaque ordre est également probable. Un `sort(() => …)`
  // au hasard ne mélange PAS uniformément, et laisse souvent la tête en place.
  for (let i = file.pistes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [file.pistes[i], file.pistes[j]] = [file.pistes[j], file.pistes[i]];
  }
  return true;
}

function retirer(guildId, position) {
  const file = fileDe(guildId);
  const i = Number(position) - 1;
  if (!file || !Number.isInteger(i) || i < 0 || i >= file.pistes.length) return null;
  return file.pistes.splice(i, 1)[0];
}

const etat = (guildId) => {
  const file = fileDe(guildId);
  if (!file) return null;
  return {
    encours: file.encours,
    pistes: [...file.pistes],
    volume: file.volume,
    boucle: file.boucle,
    pause: file.pause,
    ecoule: file.ecoule(),
    salonVocalId: file.salonVocalId,
  };
};

// 👥 Seul dans le salon : on ne joue pas pour les murs.
//
// Appelé par l'événement vocal. Un délai avant de partir, parce qu'une
// reconnexion ou un changement de salon prend quelques secondes.
function verifierSolitude(guildId, nombreHumains) {
  const file = fileDe(guildId);
  if (!file) return;
  if (nombreHumains > 0) {
    file.nettoyer();
    return;
  }
  file.attendre(DELAI_SEUL, () => {
    const f = fileDe(guildId);
    if (f) quitter(guildId, 'plus personne dans le salon');
  });
}

module.exports = {
  ajouter, quitter, passer, pause, reprendre, volume, boucler, melanger, retirer,
  expliquerEchecVocal,
  etat, fileDe, verifierSolitude, files,
  DELAI_SEUL, DELAI_VIDE, MAX_ECHECS, VOLUME_DEFAUT,
  // Conservés pour compatibilité avec l'ancienne interface.
  add: ajouter, stop: quitter, skip: passer, resume: reprendre,
  list: (guildId) => (fileDe(guildId)?.pistes || []),
};
