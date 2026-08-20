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

const DELAI_PREMIER = 12000;   // 1re tentative : on n'insiste pas trop longtemps
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

  // 🧹 Une connexion précédente restée dans un état bancal empêche la
  // suivante d'aboutir : `joinVoiceChannel` renvoie l'ancienne au lieu d'en
  // ouvrir une neuve, et l'ancienne n'attend plus rien.
  const ancienne = v.getVoiceConnection?.(interaction.guildId);
  if (ancienne && !fileDe(interaction.guildId)) {
    try { ancienne.destroy(); } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  // Une seconde tentative vaut la peine : Discord laisse parfois tomber le
  // premier « voice server update », et rien ne revient jamais. C'est
  // exactement la panne qui laisse la connexion en « signalling ».
  let derniereEtat = 'inconnu';
  for (let essai = 1; essai <= 2; essai++) {
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
      await v.entersState(connexion, v.VoiceConnectionStatus.Ready, essai === 1 ? DELAI_PREMIER : DELAI_PRET);
      return connexion;
    } catch {
      derniereEtat = connexion.state?.status || 'inconnu';
      try { connexion.destroy(); } catch {}
      if (essai === 1) {
        console.warn(`⚠️ Vocal : 1re tentative bloquée en « ${derniereEtat} » sur ${interaction.guildId} — on réessaie.`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  const preuves = releverPreuves(interaction, salonVocal);
  console.warn(`⚠️ Vocal impossible (${derniereEtat}) : ${JSON.stringify(preuves)}`);
  throw new Error(expliquerEchecVocal(derniereEtat, salonVocal, preuves));
}

// 🔬 Ce qu'on peut CONSTATER, ici, maintenant.
//
// La version précédente listait des hypothèses — dont « vérifiez l'intent »,
// alors que le bot peut lire ses propres intents, et « vérifiez les
// permissions », alors qu'il vient de les vérifier. Une liste d'hypothèses
// envoie chercher partout ; un constat désigne un endroit.
function releverPreuves(interaction, salonVocal) {
  const v = moteur.voice();
  const guild = interaction.guild;
  const moi = guild?.members?.me || null;
  let intentVocal = null;
  try {
    const { GatewayIntentBits } = require('discord.js');
    intentVocal = Boolean(interaction.client?.options?.intents?.has?.(GatewayIntentBits.GuildVoiceStates));
  } catch { intentVocal = null; }

  return {
    // Le bot fait-il vraiment partie du serveur ? En « app utilisateur », une
    // commande s'exécute sur un serveur où le bot n'est PAS membre : Discord
    // ignore alors sa demande de connexion, sans rien répondre.
    membre: Boolean(moi),
    intentVocal,
    // 🔑 Le témoin décisif : Discord a-t-il seulement pris acte de notre
    // arrivée ? S'il l'a fait, la passerelle répond et le blocage est plus
    // loin. Sinon, elle nous a purement ignorés.
    vuDansLeSalon: moi?.voice?.channelId || null,
    dejaConnecteA: v.getVoiceConnection?.(interaction.guildId) ? 'oui' : 'non',
    salonPlein: Boolean(salonVocal.userLimit && salonVocal.members?.size >= salonVocal.userLimit),
    typeSalon: salonVocal.type,
  };
}

// 🩺 Pourquoi la voix ne s'est pas ouverte — d'après ce qu'on CONSTATE.
//
// L'ancien message accusait les permissions. C'était faux : elles sont
// vérifiées avant même d'essayer de se connecter. Le suivant listait des
// hypothèses, dont « vérifiez l'intent vocal » — alors que le bot peut lire
// ses propres intents et répondre lui-même à la question.
//
// Une hypothèse envoie chercher partout. Un constat désigne un endroit.
function expliquerEchecVocal(etatAtteint, salonVocal, preuves = {}) {
  const lignes = [`❌ Je n'ai pas réussi à ouvrir <#${salonVocal.id}>.`];
  const conclure = (titre, ...suite) => {
    lignes.push('', `**${titre}**`, ...suite);
    return lignes.join('\n');
  };

  // ── Ce qu'on peut constater sans quitter le processus ──
  const manque = moteur.briquesManquantes();
  if (manque) {
    return conclure(
      'Il manque une brique audio sur l\'hébergeur.',
      ...manque.map((m) => `➜ ${m}`),
      '-# Sans elle, la connexion est acceptée puis n\'aboutit jamais. Cela ressemble à un problème de permissions, mais n\'en est pas un.'
    );
  }

  if (preuves.membre === false) {
    return conclure(
      'Je ne suis pas membre de ce serveur.',
      '➜ La commande vient de mon installation « application utilisateur » : je peux répondre, mais pas rejoindre un salon vocal.',
      '➜ Invitez-moi sur le serveur pour que la musique fonctionne.'
    );
  }

  if (preuves.intentVocal === false) {
    return conclure(
      'Mon intent vocal est désactivé — je l\'ai vérifié moi-même.',
      '➜ L\'hébergeur doit relancer le bot avec l\'intent **GuildVoiceStates**.',
      '-# Ce n\'est pas un réglage du portail développeur : il est écrit dans le code de démarrage.'
    );
  }

  if (preuves.salonPlein) {
    return conclure(
      'Le salon est plein.',
      '➜ Sa limite d\'utilisateurs est atteinte. Libérez une place, ou augmentez la limite.'
    );
  }

  // ── Le témoin décisif ──
  //
  // Si Discord m'a placé dans le salon, la passerelle a répondu : le blocage
  // est APRÈS, dans le flux vocal lui-même. Sinon, elle m'a ignoré.
  if (preuves.vuDansLeSalon) {
    return conclure(
      'Discord m\'a bien placé dans le salon, mais le flux vocal n\'aboutit pas.',
      '➜ C\'est presque toujours l\'hébergeur qui bloque les ports **UDP** sortants — beaucoup d\'hébergements mutualisés le font. C\'est à lui qu\'il faut le demander.',
      '➜ En attendant : changez la **région du salon** (Modifier le salon → Région), cela change de serveur vocal.',
      '-# Mes permissions, mes intents et mes bibliothèques audio sont bons : je viens de les vérifier.'
    );
  }

  if (etatAtteint === 'signalling') {
    return conclure(
      'Discord a ignoré ma demande, deux fois de suite.',
      '➜ Je suis bien membre du serveur, mon intent vocal est actif et mes permissions sont bonnes : je les ai vérifiés.',
      '➜ Il reste deux causes possibles, toutes deux hors du bot :',
      '  • la passerelle Discord ne relaie pas mes paquets vocaux — un **redémarrage du bot** la remet souvent d\'aplomb ;',
      '  • l\'hébergeur bloque la sortie vers les serveurs vocaux de Discord.',
      '-# Détail technique pour l\'hébergeur : la connexion reste bloquée en « signalling », aucun `VOICE_SERVER_UPDATE` n\'est reçu.'
    );
  }

  return conclure(
    `La connexion s'est arrêtée à l'état « ${etatAtteint} ».`,
    '➜ Lancez `/musique sources` : le diagnostic y détaille l\'état des briques audio.',
    `-# Constats : membre=${preuves.membre} · intent=${preuves.intentVocal} · vu dans le salon=${preuves.vuDansLeSalon || 'non'}`
  );
}

// ══════════════════════════════════════════════════════════════════
// 🔬 DIAGNOSTIC : où exactement la poignée de main s'arrête
// ══════════════════════════════════════════════════════════════════
//
// Rester en « signalling » ne dit qu'une chose : la passerelle Discord ne
// nous a pas répondu. Mais quatre étapes se cachent derrière, et elles
// n'accusent pas les mêmes coupables :
//
//   1. la connexion à la passerelle est-elle vivante ?
//   2. ai-je ENVOYÉ la demande de connexion vocale (opcode 4) ?
//   3. Discord m'a-t-il répondu où je suis (VOICE_STATE_UPDATE) ?
//   4. Discord m'a-t-il donné le serveur vocal (VOICE_SERVER_UPDATE) ?
//
// ⚠️ Aucune de ces étapes n'utilise l'UDP : tout passe par le WebSocket de la
// passerelle. Un pare-feu UDP ouvert ou fermé n'y change RIEN — l'UDP n'entre
// en jeu qu'après la 4ᵉ. C'est pourquoi il fallait instrumenter plutôt que de
// continuer à supposer.
//
// On enveloppe donc l'adaptateur pour noter chaque étape, et on dit laquelle
// n'est jamais arrivée.
async function diagnostiquerVocal(interaction, salonVocal, delai = 12000) {
  const v = moteur.voice();
  const guild = interaction.guild;
  const etapes = {
    passerelle: null,      // état du shard
    demandeEnvoyee: null,  // opcode 4 accepté par discord.js ?
    etatRecu: false,       // VOICE_STATE_UPDATE
    serveurRecu: false,    // VOICE_SERVER_UPDATE
    statutFinal: null,
    erreur: null,
  };

  try {
    etapes.passerelle = guild.shard?.status ?? null;
  } catch { etapes.passerelle = null; }

  // L'adaptateur est le seul point par lequel passent les paquets vocaux :
  // l'envelopper montre EXACTEMENT ce qui entre et ce qui sort.
  const creerAdaptateurEspion = (methodes) => {
    const vrai = guild.voiceAdapterCreator(methodes);
    return {
      sendPayload(charge) {
        const ok = vrai.sendPayload(charge);
        etapes.demandeEnvoyee = ok !== false;
        return ok;
      },
      destroy() { return vrai.destroy?.(); },
    };
  };

  const espion = (methodes) => creerAdaptateurEspion({
    onVoiceStateUpdate(donnees) { etapes.etatRecu = true; return methodes.onVoiceStateUpdate(donnees); },
    onVoiceServerUpdate(donnees) { etapes.serveurRecu = true; return methodes.onVoiceServerUpdate(donnees); },
    destroy: methodes.destroy,
  });

  let connexion = null;
  try {
    connexion = v.joinVoiceChannel({
      channelId: salonVocal.id,
      guildId: interaction.guildId,
      adapterCreator: espion,
      selfDeaf: true,
      selfMute: false,
    });
    await v.entersState(connexion, v.VoiceConnectionStatus.Ready, delai);
    etapes.statutFinal = 'ready';
  } catch (err) {
    etapes.statutFinal = connexion?.state?.status || 'inconnu';
    etapes.erreur = err.message;
  } finally {
    try { connexion?.destroy(); } catch {}
  }
  return etapes;
}

// Traduit le relevé en une conclusion. Chaque étape manquante a une cause
// distincte : c'est tout l'intérêt de les avoir séparées.
function lireDiagnostic(e) {
  if (e.statutFinal === 'ready') {
    return {
      verdict: '✅ La connexion vocale fonctionne.',
      suite: 'Si la musique reste muette malgré cela, le problème est dans l\'audio lui-même, pas dans la connexion.',
    };
  }
  if (e.passerelle !== null && e.passerelle !== 0) {
    return {
      verdict: '❌ Ma connexion à Discord n\'est pas établie.',
      suite: `Le shard est à l'état ${e.passerelle} au lieu de « prêt ». Le bot vient sans doute de démarrer, ou il se reconnecte : réessayez dans quelques secondes.`,
    };
  }
  if (e.demandeEnvoyee === false) {
    return {
      verdict: '❌ Ma demande de connexion vocale n\'a même pas pu partir.',
      suite: 'discord.js a refusé de l\'envoyer à la passerelle. C\'est un défaut interne au bot : signalez-le à son créateur avec cette fiche.',
    };
  }
  if (!e.etatRecu && !e.serveurRecu) {
    return {
      verdict: '❌ Discord n\'a répondu ni où je suis, ni quel serveur vocal utiliser.',
      suite: 'Ma demande est partie, et rien n\'est revenu. C\'est le signe d\'une passerelle qui ne relaie pas les paquets vocaux : '
        + '**redémarrez le bot**, cela repart presque toujours. Si cela recommence, c\'est l\'intent vocal qui n\'est pas actif côté hébergeur.',
    };
  }
  if (e.etatRecu && !e.serveurRecu) {
    return {
      verdict: '❌ Discord m\'a placé dans le salon, mais ne m\'a jamais donné de serveur vocal.',
      suite: 'C\'est une panne côté Discord, souvent liée à la **région du salon**. Changez-la (Modifier le salon → Région), puis réessayez.',
    };
  }
  if (e.serveurRecu) {
    return {
      verdict: '❌ Discord m\'a tout donné, mais le flux audio ne s\'ouvre pas.',
      suite: 'C\'est la seule étape qui utilise l\'**UDP**. Si les ports sortants sont ouverts, il manque alors une brique audio : voyez `/musique sources`.',
    };
  }
  return {
    verdict: `❌ La connexion s'est arrêtée à l'état « ${e.statutFinal} ».`,
    suite: e.erreur || 'Aucune cause identifiable.',
  };
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
  expliquerEchecVocal, diagnostiquerVocal, lireDiagnostic, releverPreuves,
  etat, fileDe, verifierSolitude, files,
  DELAI_SEUL, DELAI_VIDE, MAX_ECHECS, VOLUME_DEFAUT,
  // Conservés pour compatibilité avec l'ancienne interface.
  add: ajouter, stop: quitter, skip: passer, resume: reprendre,
  list: (guildId) => (fileDe(guildId)?.pistes || []),
};
