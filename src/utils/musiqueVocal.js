const moteur = require('./musiqueMoteur');

// 🔌 La CONNEXION vocale — et rien d'autre.
//
// Ce module répond à une seule question : « pourquoi le son ne part-il
// pas ? ». Il ouvre la connexion (deux essais, rotation de région), écoute la
// machine réseau de @discordjs/voice sous-étape par sous-étape, et transforme
// chaque échec en CONSTAT — jamais en hypothèse. La file d'attente, les
// boucles et les boutons vivent ailleurs (musiqueSession.js) : mélanger les
// deux est exactement ce qui avait rendu l'ancien module illisible.

const DELAI_PREMIER = 12000;   // 1re tentative : on n'insiste pas trop longtemps
const DELAI_PRET = 20000;      // Discord met parfois 10 s à ouvrir le vocal

// ── L'intérieur de l'étape 5 ─────────────────────────────────────
//
// « Le flux vocal n'aboutit pas » cachait QUATRE sous-étapes, et elles
// n'accusent pas les mêmes coupables :
//
//   5a. ouvrir le WebSocket vocal (wss vers *.discord.media, port 443) ;
//   5b. s'identifier auprès du serveur vocal ;
//   5c. la découverte d'adresse UDP — LA seule qui utilise l'UDP ;
//   5d. le choix du chiffrement de la voix.
//
// @discordjs/voice joue ces étapes dans une machine interne (`networking`).
// L'écouter transforme « c'est sûrement l'UDP » en un constat : on SAIT à
// quelle sous-étape ça s'arrête, et on peut enfin désigner le bon coupable —
// un blocage TLS n'a rien à voir avec un blocage UDP, et accuser l'un quand
// c'est l'autre a déjà fait perdre des jours.
const ETAPES_RESEAU = [
  'ouverture du WebSocket vocal (wss, port 443)',
  'identification auprès du serveur vocal',
  'découverte d\'adresse UDP',
  'choix du chiffrement de la voix',
  'flux prêt',
];

// Les codes de fermeture du serveur vocal qui portent une cause.
const FERMETURES_VOCALES = {
  4006: 'session invalidée par Discord',
  4009: 'session expirée',
  4011: 'serveur vocal introuvable',
  4014: 'déconnexion demandée par Discord (expulsion, salon supprimé, ou région changée)',
  4015: 'le serveur vocal de Discord a planté',
  4016: 'mode de chiffrement refusé par Discord',
  4017: 'chiffrement de bout en bout (DAVE) exigé — cette version du bot ne le parle pas',
};

const nouveauReleveReseau = () => ({ etapeMax: -1, fermeture: null, erreur: null, endpoint: null, udp: null });

function espionnerReseau(connexion, releve) {
  const noter = (etatReseau) => {
    if (!etatReseau || typeof etatReseau.code !== 'number') return;
    if (etatReseau.code >= 0 && etatReseau.code <= 4 && etatReseau.code > releve.etapeMax) {
      releve.etapeMax = etatReseau.code;
    }
    if (!releve.endpoint) releve.endpoint = etatReseau.connectionOptions?.endpoint || null;
    // L'adresse UDP du serveur vocal, quand la bibliothèque la montre : c'est
    // EXACTEMENT ce que l'hébergeur demande pour vérifier son pare-feu.
    const distante = etatReseau.udp?.remote;
    if (distante?.ip && !releve.udp) releve.udp = `${distante.ip}:${distante.port}`;
  };
  const brancher = (reseau) => {
    if (!reseau || typeof reseau.on !== 'function' || reseau.__espionne) return;
    reseau.__espionne = true;
    noter(reseau.state);
    reseau.on('stateChange', (_ancien, neuf) => noter(neuf));
    reseau.on('error', (err) => { releve.erreur = err?.message || String(err); });
    reseau.on('close', (code) => { releve.fermeture = code; });
  };
  connexion.on('stateChange', (_ancien, neuf) => brancher(neuf?.networking));
  // Un 'error' sans écouteur TUE le process (règle EventEmitter). On le
  // relève : c'est une preuve de plus, pas une raison de mourir.
  connexion.on('error', (err) => { if (!releve.erreur) releve.erreur = err?.message || String(err); });
  brancher(connexion.state?.networking);
}

// 🔁 Changer la région du salon change de serveur vocal — donc d'adresse à
// joindre. Quand la poignée de main s'arrête dans l'étape 5 et qu'on a la
// permission, on l'essaie NOUS-MÊMES au lieu de le demander à un humain.
const REGIONS_DE_SECOURS = ['rotterdam', 'us-east'];

async function tenterAutreRegion(salonVocal, releve) {
  // La passerelle n'a jamais donné de serveur vocal : la région n'y est pour rien.
  if (releve.etapeMax < 0 || releve.etapeMax >= 4) return null;
  const moi = salonVocal.guild?.members?.me;
  if (!salonVocal.permissionsFor?.(moi)?.has?.('ManageChannels')) return null;
  if (typeof salonVocal.setRTCRegion !== 'function') return null;
  const originale = salonVocal.rtcRegion ?? null;
  const nouvelle = REGIONS_DE_SECOURS.find((r) => r !== originale);
  try {
    await salonVocal.setRTCRegion(nouvelle, 'Musique : le flux vocal n\'aboutit pas, essai d\'un autre serveur vocal');
    console.warn(`🔁 Vocal : région du salon changée (${originale ?? 'automatique'} → ${nouvelle}) pour retenter.`);
    return { originale, nouvelle };
  } catch {
    return null;
  }
}


// `enSession` : la session (musiqueSession) sait si une lecture est en cours ;
// ce module, lui, n'a pas à connaître la file — on lui prête juste la réponse.
async function connecter(interaction, salonVocal, enSession = () => false) {
  const v = moteur.voice();

  // 🧹 Une connexion précédente restée dans un état bancal empêche la
  // suivante d'aboutir : `joinVoiceChannel` renvoie l'ancienne au lieu d'en
  // ouvrir une neuve, et l'ancienne n'attend plus rien.
  const ancienne = v.getVoiceConnection?.(interaction.guildId);
  if (ancienne && !enSession()) {
    try { ancienne.destroy(); } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  // Une seconde tentative vaut la peine : Discord laisse parfois tomber le
  // premier « voice server update », et rien ne revient jamais. C'est
  // exactement la panne qui laisse la connexion en « signalling ».
  let derniereEtat = 'inconnu';
  let region = null; // la rotation de région, si on l'a tentée
  const reseau = nouveauReleveReseau();
  for (let essai = 1; essai <= 2; essai++) {
    const connexion = v.joinVoiceChannel({
      channelId: salonVocal.id,
      guildId: interaction.guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    espionnerReseau(connexion, reseau);

    // ⚠️ L'étape qui manquait. `joinVoiceChannel` rend la main tout de suite,
    // bien avant que la voix soit établie : jouer à cet instant envoie l'audio
    // dans le vide. Le bot apparaissait dans le salon, et personne n'entendait
    // rien — sans aucune erreur pour l'expliquer.
    try {
      await v.entersState(connexion, v.VoiceConnectionStatus.Ready, essai === 1 ? DELAI_PREMIER : DELAI_PRET);
      // Si c'est le changement de région qui a débloqué, on GARDE la
      // nouvelle : la remettre renverrait sur le serveur vocal bloqué.
      connexion.noteRegion = region;
      return connexion;
    } catch {
      derniereEtat = connexion.state?.status || 'inconnu';
      try { connexion.destroy(); } catch {}
      if (essai === 1) {
        console.warn(`⚠️ Vocal : 1re tentative bloquée en « ${derniereEtat} » sur ${interaction.guildId} — on réessaie.`);
        region = await tenterAutreRegion(salonVocal, reseau);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  // Les deux essais ont échoué : si on avait touché à la région, on la remet.
  if (region) {
    await salonVocal.setRTCRegion(region.originale, 'Musique : la région de secours n\'a rien changé').catch(() => {});
  }
  const preuves = releverPreuves(interaction, salonVocal);
  preuves.reseau = { ...reseau };
  console.warn(`⚠️ Vocal impossible (${derniereEtat}) : ${JSON.stringify(preuves)}`);
  throw new Error(expliquerEchecVocal(derniereEtat, salonVocal, preuves, region));
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
function expliquerEchecVocal(etatAtteint, salonVocal, preuves = {}, regionTentee = null) {
  const lignes = [`❌ Je n'ai pas réussi à ouvrir <#${salonVocal.id}>.`];
  const conclure = (titre, ...suite) => {
    lignes.push('', `**${titre}**`, ...suite.filter(Boolean));
    return lignes.join('\n');
  };

  // ── Ce qu'on peut constater sans quitter le processus ──
  const manque = moteur.briquesManquantes();
  // ⚠️ Sauf si la poignée de main a DÉPASSÉ l'identification : arriver à la
  // découverte UDP prouve que les bibliothèques ont chargé — accuser une
  // brique absente contredirait ce qu'on vient de constater.
  if (manque && !(preuves.reseau && preuves.reseau.etapeMax >= 2)) {
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

  // ⚠️ L'ordre compte : être VU dans le salon prouve que l'intent vocal
  // fonctionne — c'est lui qui apporte cette information. Conclure « intent
  // désactivé » alors qu'on se voit dans le salon serait une contradiction,
  // de la même famille que l'ancien message qui accusait des permissions
  // déjà vérifiées.
  // ── Le témoin décisif ──
  //
  // Si Discord m'a placé dans le salon, la passerelle a répondu : le blocage
  // est APRÈS, dans l'étape 5 — dont l'espion réseau dit la sous-étape exacte.
  if (preuves.vuDansLeSalon) {
    const r = preuves.reseau || {};
    const noteRegion = regionTentee
      ? `\n-# J'ai aussi changé la région du salon (${regionTentee.originale || 'automatique'} → ${regionTentee.nouvelle}) pour changer de serveur vocal : même blocage. Je l'ai remise comme avant.`
      : '';
    const fermeture = r.fermeture
      ? `\n-# Le serveur vocal a fermé la connexion : code ${r.fermeture}${FERMETURES_VOCALES[r.fermeture] ? ` — ${FERMETURES_VOCALES[r.fermeture]}` : ''}.`
      : '';

    // 🔒 4017 : depuis mars 2026, Discord n'accepte que les clients vocaux
    // parlant le chiffrement de bout en bout (protocole DAVE). Le serveur
    // raccroche PENDANT l'identification — ni le réseau ni les permissions
    // n'y sont pour rien.
    if (r.fermeture === 4017) {
      return conclure(
        'Discord exige le chiffrement de bout en bout de la voix (DAVE) — cette version du bot ne le parle pas.',
        '➜ Le serveur vocal a raccroché pendant l\'identification (code 4017) : c\'est une exigence de Discord depuis mars 2026, pas un problème réseau.',
        '➜ Mettez le bot à jour (`/update`, ou ⚙️ Créateur → 🔄 Mises à jour) : les versions récentes embarquent la brique DAVE.',
        noteRegion.trim() ? noteRegion.trimStart() : null
      );
    }
    if (r.fermeture === 4016 || r.etapeMax === 3) {
      return conclure(
        'Discord a refusé le chiffrement de la voix.',
        '➜ La machine est allée jusqu\'au **choix du chiffrement** (l\'UDP est donc passé), et Discord n\'a jamais confirmé.',
        '➜ Les bibliothèques du bot sont trop anciennes sur cet hébergement : relancez `npm install` à côté du bot, ou reprenez le dernier exécutable.',
        fermeture.trim() ? fermeture.trimStart() : null
      );
    }
    if (r.etapeMax === 2) {
      return conclure(
        'La découverte d\'adresse UDP n\'obtient jamais de réponse — c\'est CONSTATÉ, pas supposé.',
        `➜ Le WebSocket vocal s'est ouvert, l'identification est passée : seul l'**UDP** ne revient pas${r.udp ? ` (serveur vocal : \`${r.udp}\`)` : ''}.`,
        '➜ Phrase exacte à envoyer à l\'hébergeur : « merci d\'autoriser l\'UDP **sortant et ses réponses** vers les serveurs vocaux de Discord'
        + `${r.udp ? ` — constaté vers \`${r.udp}\`` : ''}, ports 50000-65535 ».`,
        noteRegion.trim() ? noteRegion.trimStart() : null
      );
    }
    if (r.etapeMax === 1) {
      // ⚠️ PAS le pare-feu : arriver à l'identification prouve que le
      // WebSocket s'est ouvert. C'est le serveur vocal qui reste muet.
      return conclure(
        'Le serveur vocal ne répond pas à mon identification.',
        '➜ Le WebSocket vocal s\'est ouvert (le pare-feu n\'y est pour rien) : c\'est le serveur vocal de Discord qui ne répond plus.',
        '➜ Réessayez, puis changez la **région du salon** (Modifier le salon → Région) : cela change de serveur vocal.',
        fermeture.trim() ? fermeture.trimStart() : null
      );
    }
    if (r.etapeMax === 0) {
      return conclure(
        'Le WebSocket vocal ne s\'ouvre pas — l\'UDP n\'y est pour RIEN.',
        `➜ La connexion chiffrée vers le serveur vocal${r.endpoint ? ` (\`${r.endpoint}\`)` : ''} n'aboutit pas : c'est du **TLS sortant, port 443**, vers \`*.discord.media\`.`,
        '➜ Phrase exacte à envoyer à l\'hébergeur : « merci d\'autoriser le TLS sortant (port 443) vers `*.discord.media` ».',
        fermeture.trim() ? fermeture.trimStart() : null
      );
    }
    return conclure(
      'Discord m\'a placé dans le salon, mais le flux vocal n\'a jamais démarré.',
      '➜ Le serveur vocal ne m\'a même pas été présenté : c\'est en général passager côté Discord.',
      '➜ Réessayez ; si cela persiste, changez la **région du salon** (Modifier le salon → Région).',
      noteRegion.trim() ? noteRegion.trimStart() : null
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
  etapes.reseau = nouveauReleveReseau();
  try {
    connexion = v.joinVoiceChannel({
      channelId: salonVocal.id,
      guildId: interaction.guildId,
      adapterCreator: espion,
      selfDeaf: true,
      selfMute: false,
    });
    espionnerReseau(connexion, etapes.reseau);
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
    const r = e.reseau || {};
    if (r.fermeture === 4017) {
      return {
        verdict: '❌ Discord exige le chiffrement de bout en bout de la voix (DAVE) — cette version du bot ne le parle pas.',
        suite: 'Le serveur vocal a raccroché pendant l\'identification (code 4017) : exigence de Discord depuis mars 2026, ni réseau ni permissions. '
          + 'Mettez le bot à jour (`/update`, ou ⚙️ Créateur → 🔄 Mises à jour) : les versions récentes embarquent la brique DAVE.',
      };
    }
    if (r.fermeture === 4016 || r.etapeMax === 3) {
      return {
        verdict: '❌ Discord a refusé le chiffrement de la voix.',
        suite: 'L\'UDP est passé — la machine s\'arrête au **choix du chiffrement**. Les bibliothèques du bot sont trop anciennes '
          + 'sur cet hébergement : relancez `npm install`, ou reprenez le dernier exécutable.',
      };
    }
    if (r.etapeMax === 2) {
      return {
        verdict: '❌ La découverte d\'adresse UDP n\'obtient jamais de réponse.',
        suite: `Le WebSocket vocal s'est ouvert et l'identification est passée : seul l'**UDP** ne revient pas${r.udp ? ` (serveur vocal : \`${r.udp}\`)` : ''}. `
          + 'C\'est la phrase à envoyer à l\'hébergeur : « merci d\'autoriser l\'UDP sortant et ses réponses vers les serveurs vocaux de Discord, ports 50000-65535 ».',
      };
    }
    if (r.etapeMax === 1) {
      return {
        verdict: '❌ Le serveur vocal ne répond pas à mon identification.',
        suite: 'Le WebSocket vocal s\'est ouvert — le pare-feu n\'y est pour rien. Réessayez, puis changez la '
          + '**région du salon** (Modifier le salon → Région) : cela change de serveur vocal.',
      };
    }
    if (r.etapeMax === 0) {
      return {
        verdict: '❌ Le WebSocket vocal ne s\'ouvre pas — l\'UDP n\'y est pour rien.',
        suite: `La connexion chiffrée vers le serveur vocal${r.endpoint ? ` (\`${r.endpoint}\`)` : ''} n'aboutit pas : `
          + 'l\'hébergeur doit autoriser le **TLS sortant (port 443)** vers `*.discord.media`.',
      };
    }
    return {
      verdict: '❌ Discord m\'a tout donné, mais le flux audio ne s\'ouvre pas.',
      suite: 'La machine réseau ne s\'est même pas lancée : réessayez, puis regardez `/musique sources` si cela persiste.',
    };
  }
  return {
    verdict: `❌ La connexion s'est arrêtée à l'état « ${e.statutFinal} ».`,
    suite: e.erreur || 'Aucune cause identifiable.',
  };
}

module.exports = {
  connecter, releverPreuves, expliquerEchecVocal, diagnostiquerVocal,
  lireDiagnostic, espionnerReseau, nouveauReleveReseau, tenterAutreRegion,
  ETAPES_RESEAU, FERMETURES_VOCALES, REGIONS_DE_SECOURS,
  DELAI_PREMIER, DELAI_PRET,
};
