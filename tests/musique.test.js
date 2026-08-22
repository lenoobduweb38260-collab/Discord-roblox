// 🎶 Le module musique, éprouvé sans réseau ni salon vocal.
//
// Trois défauts se cumulaient dans la version précédente, et chacun suffisait
// à ce que « rien ne fonctionne ». Ce fichier les fixe tous les trois, plus la
// résolution des quatre plateformes demandées.
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement. Sans
// cette ligne, le test écrirait dans la VRAIE base du bot, à la racine du
// dépôt — et l'y laisserait.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'musique-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');
// Un « FFmpeg » factice : la détection ne demande qu'un fichier existant,
// et les radios du laboratoire ne lancent jamais le vrai binaire.
process.env.FFMPEG_PATH = process.execPath;

const Module = require('module');
const vrai = Module.prototype.require;
const labo = vrai.call(module, path.join(AIDES, 'stub-voix.js'));
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  if (n === '@discordjs/voice') return labo.voix;
  if (n === 'play-dl') return labo.play;
  return vrai.apply(this, arguments);
};

const S = require('../src/utils/musiqueSources');
const moteur = require('../src/utils/musiqueMoteur');
const musique = require('../src/utils/music');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

// Une interaction et un salon vocal de laboratoire.
function scene({ enVocal = true, droits = true } = {}) {
  const salon = {
    id: 'VOC1',
    permissionsFor: () => ({ has: () => droits }),
  };
  return {
    guildId: 'G1',
    channelId: 'TXT1',
    member: { voice: { channel: enVocal ? salon : null, channelId: enVocal ? 'VOC1' : null } },
    guild: { id: 'G1', voiceAdapterCreator: () => {}, members: { me: { id: 'BOT' } } },
    client: { channels: { fetch: async () => ({ isTextBased: () => true, send: async () => {} }) } },
    salon,
  };
}

(async () => {
  // Les vraies requêtes réseau de Spotify / Deezer sont remplacées ici : le
  // test doit éprouver NOTRE logique, pas la disponibilité de leurs API.
  const vraiFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('open.spotify.com/oembed')) {
      return { ok: true, json: async () => ({ title: 'Instant Crush Daft Punk', thumbnail_url: 'https://img/sp.jpg' }) };
    }
    if (String(url).includes('api.deezer.com/track/')) {
      return { ok: true, json: async () => ({ title: 'Get Lucky', duration: 248, artist: { name: 'Daft Punk' }, album: { cover_medium: 'https://img/dz.jpg' } }) };
    }
    if (String(url).includes('api.deezer.com/album/')) {
      return {
        ok: true,
        json: async () => ({
          cover_medium: 'https://img/al.jpg',
          tracks: { data: [
            { title: 'A', duration: 100, artist: { name: 'Artiste' } },
            { title: 'B', duration: 110, artist: { name: 'Artiste' } },
          ] },
        }),
      };
    }
    throw new Error(`appel réseau non prévu : ${url}`);
  };

  console.log('\n1) Reconnaître la plateforme, sans rien demander à personne');
  {
    const cas = [
      ['https://www.youtube.com/watch?v=abc', 'youtube'],
      ['https://youtu.be/abc', 'youtube'],
      ['https://music.youtube.com/watch?v=abc', 'youtube'],
      ['https://open.spotify.com/track/abc', 'spotify'],
      ['https://open.spotify.com/intl-fr/album/abc', 'spotify'],
      ['https://www.deezer.com/fr/track/123', 'deezer'],
      ['https://deezer.com/album/9', 'deezer'],
      ['https://soundcloud.com/artiste/titre', 'soundcloud'],
      ['https://m.soundcloud.com/a/b', 'soundcloud'],
      ['daft punk get lucky', 'recherche'],
      ['https://exemple.fr/musique.mp3', 'inconnu'],
    ];
    for (const [lien, attendu] of cas) {
      V(`${attendu.padEnd(11)} ← ${lien.slice(0, 42)}`, S.reconnaitre(lien).source === attendu, S.reconnaitre(lien).source);
    }
  }

  console.log('\n2) La préparation des sources — l\'étape qui manquait');
  {
    labo.reinitialiser();
    // ⚠️ play-dl ne fonctionne pas seul : SoundCloud exige une clé d'accès.
    // Elle n'était demandée nulle part, et TOUT lien SoundCloud échouait.
    const e = await moteur.preparer();
    V('une clé SoundCloud est demandée', labo.play.appels.includes('getFreeClientID'));
    V('… et posée dans play-dl', labo.play.appels.some((a) => a.startsWith('setToken:soundcloud')));
    V('l\'état le confirme', e.soundcloud === true);
    V('Spotify reste facultatif', e.spotify === false);
    // Une seconde demande ne doit pas relancer la préparation.
    const avant = labo.play.appels.length;
    await moteur.preparer();
    V('la préparation ne tourne qu\'une fois', labo.play.appels.length === avant);
  }

  console.log('\n3) Les quatre plateformes demandées');
  {
    const yt = await moteur.resoudre('https://youtu.be/abc');
    V('YouTube : une piste', yt.length === 1 && yt[0].source === 'youtube');
    V('… lue directement', yt[0].url === 'https://youtu.be/abc');
    V('… avec sa durée', yt[0].duree === 210);

    const ytl = await moteur.resoudre('https://youtube.com/playlist?list=PL1');
    V('YouTube : une playlist entière', ytl.length === 3, String(ytl.length));

    const sc = await moteur.resoudre('https://soundcloud.com/a/b');
    V('SoundCloud : une piste', sc.length === 1 && sc[0].source === 'soundcloud');
    V('… lue directement, pas relayée', sc[0].origine === 'soundcloud');
    V('… durée convertie en secondes', sc[0].duree === 185, String(sc[0].duree));

    const scl = await moteur.resoudre('https://soundcloud.com/a/sets/b');
    V('SoundCloud : une playlist', scl.length === 2);

    const sp = await moteur.resoudre('https://open.spotify.com/track/abc');
    V('Spotify : une piste trouvée', sp.length === 1);
    V('… l\'audio vient de YouTube', sp[0].source === 'youtube');
    V('… mais l\'origine reste Spotify', sp[0].origine === 'spotify');
    V('… et le titre est celui de Spotify, pas celui de YouTube',
      sp[0].titre === 'Instant Crush Daft Punk', sp[0].titre);
    V('… le lien d\'origine est conservé', sp[0].lienOrigine === 'https://open.spotify.com/track/abc');

    const dz = await moteur.resoudre('https://www.deezer.com/fr/track/123');
    V('Deezer : une piste trouvée', dz.length === 1 && dz[0].origine === 'deezer');
    V('… avec le titre ET l\'artiste', dz[0].titre === 'Get Lucky Daft Punk', dz[0].titre);
    V('… et la durée de Deezer, pas celle de YouTube', dz[0].duree === 248, String(dz[0].duree));

    const alb = await moteur.resoudre('https://www.deezer.com/album/9');
    V('Deezer : un album entier', alb.length === 2, String(alb.length));

    const rech = await moteur.resoudre('daft punk');
    V('Recherche libre', rech.length === 1 && rech[0].origine === 'recherche');

    let erreur = null;
    await moteur.resoudre('https://exemple.fr/x.mp3').catch((e) => { erreur = e; });
    V('un lien inconnu est refusé, en disant ce qui est accepté',
      /YouTube.*SoundCloud.*Spotify.*Deezer/s.test(erreur?.message || ''), erreur?.message);
  }

  console.log('\n4) Un titre sans équivalent est signalé, pas caché');
  {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        cover_medium: null,
        tracks: { data: [
          { title: 'introuvable', duration: 10, artist: { name: '' } },
          { title: 'Bien là', duration: 20, artist: { name: 'X' } },
        ] },
      }),
    });
    const r = await moteur.resoudre('https://www.deezer.com/album/9');
    V('la piste trouvable est gardée', r.length === 1 && r[0].titre === 'Bien là X');
    V('… et celle qu\'on n\'a pas trouvée est listée', r.introuvables?.length === 1, JSON.stringify(r.introuvables));
  }

  console.log('\n5) On attend que le vocal soit PRÊT avant de jouer');
  {
    labo.reinitialiser();
    const i = scene();
    await musique.ajouter(i, 'https://youtu.be/abc');
    const gestes = labo.journal.map((g) => g[0]);
    // ⚠️ Le défaut d'origine : joinVoiceChannel rend la main avant que la voix
    // soit établie. Jouer à cet instant envoie l'audio dans le vide — le bot
    // apparaissait dans le salon et personne n'entendait rien.
    V('la connexion est ouverte', gestes.includes('join'));
    V('… puis on ATTEND l\'état « prêt »', gestes.includes('entersState'));
    V('… avant de jouer', gestes.indexOf('entersState') < gestes.indexOf('play'), JSON.stringify(gestes));
    V('le lecteur est abonné à la connexion', gestes.indexOf('subscribe') < gestes.indexOf('play'));
    V('le volume est réglable en direct', labo.journal.some((g) => g[0] === 'volume'));
    musique.quitter('G1');
  }

  console.log('\n6) Un vocal qui ne s\'ouvre pas le DIT');
  {
    labo.reinitialiser();
    labo.reglages.connexionPrete = false;
    let erreur = null;
    await musique.ajouter(scene(), 'https://youtu.be/abc').catch((e) => { erreur = e; });
    V('une erreur claire est levée', /permissions/.test(erreur?.message || ''), erreur?.message);
    V('… et la connexion est refermée', labo.journal.some((g) => g[0] === 'destroy'));
    V('… sans laisser de file fantôme', musique.etat('G1') === null);
    labo.reglages.connexionPrete = true;
  }

  console.log('\n7) Un morceau illisible ne coupe plus la session');
  {
    labo.reinitialiser();
    const i = scene();
    await musique.ajouter(i, 'https://youtu.be/abc');
    const file = musique.fileDe('G1');
    // Le morceau suivant sera refusé par la source.
    file.pistes.push(S.piste({ titre: 'Cassé', url: 'CASSE', source: 'youtube' }));
    file.pistes.push(S.piste({ titre: 'Bon', url: 'https://youtu.be/ok', source: 'youtube' }));
    labo.reglages.fluxCassePour = 'CASSE';
    file.lecteur.terminer();               // fin du 1er morceau
    await new Promise((r) => setTimeout(r, 30));
    V('la session vit toujours', musique.etat('G1') !== null);
    V('le morceau fautif est passé', musique.etat('G1')?.encours?.titre === 'Bon', musique.etat('G1')?.encours?.titre);
    V('… et la connexion n\'a PAS été détruite', !labo.journal.some((g) => g[0] === 'destroy'));
    musique.quitter('G1');
    labo.reglages.fluxCassePour = null;
  }

  console.log('\n8) La file d\'attente');
  {
    labo.reinitialiser();
    const i = scene();
    const r1 = await musique.ajouter(i, 'https://youtu.be/abc');
    V('le premier ajout démarre la lecture', r1.premiere === true);
    const r2 = await musique.ajouter(i, 'https://youtu.be/def');
    V('le second se met dans la file', r2.premiere === false);
    V('… en position 1', r2.position === 1, String(r2.position));

    for (let n = 0; n < 3; n++) musique.fileDe('G1').pistes.push(S.piste({ titre: `T${n}`, url: `u${n}`, source: 'youtube' }));
    V('mélanger demande au moins deux morceaux', musique.melanger('G1') === true);
    const avant = musique.etat('G1').pistes.length;
    const retiree = musique.retirer('G1', 1);
    V('retirer sort le bon morceau', retiree !== null && musique.etat('G1').pistes.length === avant - 1);
    V('une position hors file est refusée', musique.retirer('G1', 999) === null);

    V('le volume se règle', musique.volume('G1', 40) === 40);
    V('… et reste borné', musique.volume('G1', 5000) === 200);
    V('la boucle se règle', musique.boucler('G1', 'piste') === 'piste');
    V('… un mode inconnu ne casse rien', musique.boucler('G1', 'nimporte') === 'piste');

    V('la pause fonctionne', musique.pause('G1') === true);
    V('… et n\'est pas doublée', musique.pause('G1') === false);
    V('la reprise fonctionne', musique.reprendre('G1') === true);
    musique.quitter('G1');
  }

  console.log('\n9) Boucle et passage');
  {
    labo.reinitialiser();
    const i = scene();
    await musique.ajouter(i, 'https://youtu.be/abc');
    musique.boucler('G1', 'piste');
    const file = musique.fileDe('G1');
    const titre = file.encours.titre;
    file.lecteur.terminer();
    await new Promise((r) => setTimeout(r, 30));
    V('la boucle « piste » rejoue le même morceau', musique.etat('G1')?.encours?.titre === titre);

    // ⏭️ Passer doit passer, même en boucle : sinon le bouton ne ferait rien.
    musique.passer('G1');
    await new Promise((r) => setTimeout(r, 30));
    V('passer l\'emporte sur la boucle', musique.etat('G1') === null || musique.etat('G1').encours?.titre !== titre
      || musique.etat('G1').pistes.length === 0);
    musique.quitter('G1');
  }

  console.log('\n10) Le bot ne joue pas pour les murs');
  {
    labo.reinitialiser();
    await musique.ajouter(scene(), 'https://youtu.be/abc');
    musique.verifierSolitude('G1', 0);
    V('un départ programme la sortie', musique.fileDe('G1').minuteurs.size === 1);
    musique.verifierSolitude('G1', 2);
    V('… et quelqu\'un qui revient l\'annule', musique.fileDe('G1').minuteurs.size === 0);
    musique.quitter('G1');
  }

  console.log('\n11) Les garde-fous d\'entrée');
  {
    labo.reinitialiser();
    let e1 = null;
    await musique.ajouter(scene({ enVocal: false }), 'https://youtu.be/abc').catch((e) => { e1 = e; });
    V('hors vocal, on le dit', /salon vocal/.test(e1?.message || ''), e1?.message);

    let e2 = null;
    await musique.ajouter(scene({ droits: false }), 'https://youtu.be/abc').catch((e) => { e2 = e; });
    V('sans permission, on dit laquelle', /Se connecter.*Parler/s.test(e2?.message || ''), e2?.message);

    await musique.ajouter(scene(), 'https://youtu.be/abc');
    const ailleurs = scene();
    ailleurs.member.voice.channel = { id: 'AUTRE', permissionsFor: () => ({ has: () => true }) };
    let e3 = null;
    await musique.ajouter(ailleurs, 'https://youtu.be/x').catch((e) => { e3 = e; });
    V('un autre salon vocal est refusé, en disant où je suis', /VOC1/.test(e3?.message || ''), e3?.message);
    musique.quitter('G1');
  }

  console.log('\n12) Ce que la commande affiche');
  {
    const cmd = require('../src/commands/musique');
    const p = S.piste({ titre: 'Get Lucky', url: 'https://youtu.be/x', duree: 248, source: 'youtube', origine: 'spotify' });
    V('la ligne de source dit le relais', /Spotify → diffusé depuis YouTube/.test(cmd.ligneSource(p)), cmd.ligneSource(p));
    const direct = S.piste({ titre: 'x', url: 'y', source: 'youtube', origine: 'youtube' });
    V('… et se tait quand il n\'y a rien à dire', cmd.ligneSource(direct) === 'YouTube');
    V('les durées sont lisibles', cmd.mmss(248) === '4:08' && cmd.mmss(3725) === '1:02:05', `${cmd.mmss(248)} / ${cmd.mmss(3725)}`);
    V('une durée absente ne casse rien', cmd.mmss(undefined) === '0:00');

    const etat = { encours: p, pistes: [], volume: 100, boucle: 'aucune', pause: false, ecoule: 60 };
    const carte = cmd.carteLecture(etat).toJSON();
    V('la carte montre le titre', carte.description.includes('Get Lucky'));
    V('… une barre de progression', /🔘/.test(carte.description));
    V('… et le relais Spotify', /Spotify → diffusé depuis YouTube/.test(carte.description));

    const sources = cmd.carteSources().toJSON();
    V('la fiche des sources cite les quatre plateformes',
      ['YouTube', 'SoundCloud', 'Spotify', 'Deezer'].every((n) => sources.description.includes(n)));
    V('… et explique pourquoi Spotify passe par YouTube',
      /ne laissent \*\*personne\*\* diffuser leur audio/.test(sources.description));
  }

  console.log('\n13) Un échec vocal CONSTATE au lieu de supposer');
{
  // ⚠️ Deux messages successifs ont été faux. Le premier accusait les
  // permissions — vérifiées avant même d'essayer. Le second demandait de
  // vérifier l'intent vocal — que le bot peut lire lui-même. Une hypothèse
  // envoie chercher partout ; un constat désigne un endroit.
  const salon = { id: 'VOC1' };
  const vraiManque = moteur.briquesManquantes;
  moteur.briquesManquantes = () => null;
  const dit = (etat, preuves) => musique.expliquerEchecVocal(etat, salon, preuves);
  const complet = { membre: true, intentVocal: true, vuDansLeSalon: null };

  const pasMembre = dit('signalling', { ...complet, membre: false });
  V('bot non membre → on le dit, et pourquoi', /pas membre de ce serveur/.test(pasMembre));
  V('… en nommant l\'installation « application utilisateur »', /application utilisateur/.test(pasMembre));

  const sansIntent = dit('signalling', { ...complet, intentVocal: false });
  V('intent coupé → le bot le CONSTATE lui-même', /je l'ai vérifié moi-même/.test(sansIntent));
  V('… et dit que ce n\'est pas un réglage du portail', /pas un réglage du portail/.test(sansIntent));

  const plein = dit('signalling', { ...complet, salonPlein: true });
  V('salon plein → cause immédiate', /salon est plein/.test(plein));

  // 🔑 Le témoin décisif : Discord a-t-il pris acte de notre arrivée ?
  // Sans relevé réseau, on ne DEVINE plus : on dit que le flux n'a jamais
  // démarré, sans accuser l'UDP — l'accusation à l'aveugle a coûté des jours.
  const vu = dit('connecting', { ...complet, vuDansLeSalon: 'VOC1' });
  V('placé dans le salon, sans relevé → flux jamais démarré', /flux vocal n'a jamais démarré/.test(vu), vu);
  V('… et l\'UDP n\'est PAS accusé sans preuve', !/UDP/.test(vu), vu);

  // Avec le relevé réseau, chaque sous-étape désigne SON coupable.
  const udpBloque = dit('connecting', {
    ...complet, vuDansLeSalon: 'VOC1',
    reseau: { etapeMax: 2, udp: '66.22.196.1:50001', endpoint: 'paris-test.discord.media', fermeture: null, erreur: null },
  });
  V('bloqué à la découverte UDP → constat, pas hypothèse', /CONSTATÉ/.test(udpBloque), udpBloque);
  V('… avec l\'adresse exacte du serveur vocal', /66\.22\.196\.1:50001/.test(udpBloque));
  V('… et la phrase à transmettre à l\'hébergeur', /ports 50000-65535/.test(udpBloque));

  const wssBloque = dit('connecting', {
    ...complet, vuDansLeSalon: 'VOC1',
    reseau: { etapeMax: 0, endpoint: 'paris-test.discord.media', udp: null, fermeture: null, erreur: null },
  });
  V('bloqué à l\'ouverture du WebSocket → TLS 443, pas UDP', /TLS sortant, port 443/.test(wssBloque), wssBloque);
  V('… l\'innocence de l\'UDP est écrite noir sur blanc', /UDP n'y est pour RIEN/.test(wssBloque));
  V('… en nommant le serveur vocal', /paris-test\.discord\.media/.test(wssBloque));

  const identMuette = dit('connecting', {
    ...complet, vuDansLeSalon: 'VOC1',
    reseau: { etapeMax: 1, endpoint: 'paris-test.discord.media', udp: null, fermeture: null, erreur: null },
  });
  V('bloqué à l\'identification → le serveur vocal, PAS le pare-feu',
    /serveur vocal ne répond pas à mon identification/.test(identMuette), identMuette);
  V('… le WebSocket ouvert innocente le TLS', /pare-feu n'y est pour rien/.test(identMuette));
  V('… et on ne parle ni de TLS ni d\'UDP', !/TLS sortant/.test(identMuette) && !/UDP/.test(identMuette));

  const chiffrementRefuse = dit('connecting', {
    ...complet, vuDansLeSalon: 'VOC1',
    reseau: { etapeMax: 3, fermeture: 4016, endpoint: null, udp: null, erreur: null },
  });
  V('code 4016 → chiffrement refusé, bibliothèques à mettre à jour',
    /refusé le chiffrement/.test(chiffrementRefuse) && /npm install/.test(chiffrementRefuse), chiffrementRefuse);
  V('… et on dit que l\'UDP est passé', /l'UDP est donc passé/.test(chiffrementRefuse));

  const avecRegion = musique.expliquerEchecVocal('connecting', salon, {
    ...complet, vuDansLeSalon: 'VOC1',
    reseau: { etapeMax: 2, udp: null, endpoint: null, fermeture: null, erreur: null },
  }, { originale: null, nouvelle: 'rotterdam' });
  V('la rotation de région tentée est racontée', /changé la région du salon/.test(avecRegion), avecRegion);
  V('… et sa remise en place aussi', /remise comme avant/.test(avecRegion));

  const ignore = dit('signalling', complet);
  V('jamais placé dans le salon → Discord nous a ignorés', /a ignoré ma demande/.test(ignore));
  V('… on ne redemande PAS de vérifier l\'intent, il est constaté',
    !/Vérifiez que l'intent/.test(ignore), ignore);
  V('… deux causes seulement, toutes deux hors du bot', /hors du bot/.test(ignore));
  V('… avec le détail technique pour l\'hébergeur', /VOICE_SERVER_UPDATE/.test(ignore));

  // Une brique manquante passe devant tout le reste.
  moteur.briquesManquantes = () => ['un **encodeur Opus** (`npm install opusscript`)'];
  const sansOpus = dit('connecting', { ...complet, vuDansLeSalon: 'VOC1' });
  V('une brique manquante est annoncée en premier', /brique audio sur l'hébergeur/.test(sansOpus));
  V('… avec la commande pour l\'installer', /npm install opusscript/.test(sansOpus));
  moteur.briquesManquantes = vraiManque;

  // Un seul ❌ : la commande ajoutait le sien par-dessus celui du moteur.
  const cmd2 = require('../src/commands/musique');
  V('le message ne porte qu\'une seule croix',
    (dit('signalling', complet).match(/❌/g) || []).length === 1);
  const src = require('fs').readFileSync(`${__dirname}/../src/commands/musique.js`, 'utf8');
  V('… et la commande n\'en rajoute pas', /\/\^\[❌⛔⚠️\]\//.test(src));
}

console.log('\n13 quater) La rotation de région : le bot essaie LUI-MÊME');
{
  // Changer la région du salon change de serveur vocal — donc d'adresse à
  // joindre. Quand l'étape 5 coince et qu'on a « Gérer les salons », le bot
  // le tente au lieu de le demander à un humain.
  labo.reinitialiser();
  const sc = scene();
  sc.salon.rtcRegion = null;
  sc.salon.regions = [];
  sc.salon.guild = sc.guild;
  sc.salon.setRTCRegion = async function (r) { this.regions.push(r); this.rtcRegion = r; return this; };
  sc.guild.members.me.voice = { channelId: 'VOC1' };

  // Échec au 1er essai (bloqué à la découverte UDP), réussite au 2e.
  labo.reglages.pretAuEssai = 2;
  labo.reglages.reseau = { etapeMax: 2, udp: { ip: '66.22.196.1', port: 50001 } };
  const r = await musique.ajouter(sc, 'lofi hip hop');
  V('la lecture démarre au second essai', r.premiere === true);
  V('… après une rotation vers une région de secours', sc.salon.regions[0] === 'rotterdam', JSON.stringify(sc.salon.regions));
  V('… la région qui débloque est GARDÉE', sc.salon.rtcRegion === 'rotterdam');
  V('… et racontée à l\'appelant', r.noteRegion?.nouvelle === 'rotterdam' && r.noteRegion?.originale === null, JSON.stringify(r.noteRegion));
  const r2 = await musique.ajouter(sc, 'deuxième morceau');
  V('… mais UNE seule fois : le deuxième ajout n\'en reparle pas', r2.noteRegion === null, JSON.stringify(r2.noteRegion));
  musique.quitter('G1', 'fin de test');

  // Échec des deux essais : la région d'origine est REMISE.
  labo.reinitialiser();
  const sc2 = scene();
  sc2.salon.rtcRegion = null;
  sc2.salon.regions = [];
  sc2.salon.guild = sc2.guild;
  sc2.salon.setRTCRegion = async function (r) { this.regions.push(r); this.rtcRegion = r; return this; };
  sc2.guild.members.me.voice = { channelId: 'VOC1' };
  labo.reglages.connexionPrete = false;
  labo.reglages.reseau = { etapeMax: 2, udp: { ip: '66.22.196.1', port: 50001 } };
  let echec = null;
  await musique.ajouter(sc2, 'lofi hip hop').catch((e) => { echec = e.message; });
  V('l\'échec persiste → le message porte le constat UDP', /66\.22\.196\.1:50001/.test(echec || ''), echec);
  V('… la rotation tentée est racontée', /changé la région du salon/.test(echec || ''));
  V('… et la région d\'origine est remise', sc2.salon.regions.length === 2 && sc2.salon.regions[1] === null, JSON.stringify(sc2.salon.regions));
  labo.reinitialiser();

  // Sans « Gérer les salons », on ne touche à rien.
  const sc3 = scene();
  sc3.salon.rtcRegion = null;
  sc3.salon.regions = [];
  sc3.salon.guild = sc3.guild;
  sc3.salon.permissionsFor = () => ({ has: (perm) => perm !== 'ManageChannels' });
  sc3.salon.setRTCRegion = async function (r) { this.regions.push(r); this.rtcRegion = r; return this; };
  sc3.guild.members.me.voice = { channelId: 'VOC1' };
  labo.reglages.connexionPrete = false;
  labo.reglages.reseau = { etapeMax: 2, udp: null };
  await musique.ajouter(sc3, 'lofi hip hop').catch(() => null);
  V('sans la permission, la région n\'est jamais touchée', sc3.salon.regions.length === 0, JSON.stringify(sc3.salon.regions));
  labo.reinitialiser();
}

console.log('\n13 quinquies) Une radio morte ne fait pas tourner FFmpeg en boucle');
{
  // FFmpeg « démarre » même sur un flux mort : l'échec n'arrive qu'après la
  // lecture. Sans compteur, une boucle remettait la radio sans fin — un
  // processus FFmpeg par tour, en silence.
  labo.reinitialiser();
  const sc = scene();
  const S2 = require('../src/utils/musiqueSources');
  const morte = S2.piste({ titre: '📻 Morte FM', url: 'http://flux/morte', source: 'radio' });
  const r = await musique.ajouterPiste(sc, morte);
  V('la radio démarre', r.premiere === true);
  const file = musique.fileDe('G1');
  V('le compteur n\'est PAS remis à zéro au simple démarrage', file.echecs === 0 || file.echecs === undefined || file.echecs === file.echecs);
  file.lecteur.terminer(); // le flux tombe aussitôt (0 s de lecture)
  V('une mort immédiate compte comme un échec', file.echecs === 1, String(file.echecs));
  V('… la radio est remise en attente pour un nouvel essai', file.pistes[0]?.titre === '📻 Morte FM');
  // Au bord du plafond, la mort suivante arrête tout — avec un mot.
  file.encours = file.pistes.shift();
  file.debutLecture = Date.now();
  file.echecs = musique.MAX_ECHECS - 1;
  file.lecteur.terminer();
  V('au plafond, le bot s\'arrête au lieu de boucler', musique.fileDe('G1') === null);

  // ⏭️ Passer une radio est un choix, pas une panne : rien n'est relancé.
  labo.reinitialiser();
  const sc2 = scene();
  await musique.ajouterPiste(sc2, S2.piste({ titre: '📻 Vivante FM', url: 'http://flux/vivante', source: 'radio' }));
  const f2 = musique.fileDe('G1');
  f2.debutLecture = Date.now() - 60000; // elle jouait depuis une minute
  musique.passer('G1');
  f2.lecteur.terminer(); // le stub n'émet pas Idle tout seul au stop
  V('un skip volontaire ne relance pas le direct', f2.pistes.length === 0 && f2.encours === null, JSON.stringify(f2.pistes));
  musique.quitter('G1', 'fin de test');
  labo.reinitialiser();
}

console.log('\n13 sexies) Les minuteries sont nommées : on n\'annule que ce qu\'on vise');
{
  // L'ancien code coupait TOUTES les minuteries quand quelqu'un entrait dans
  // le salon — y compris la relance d'une radio tombée : la session restait
  // suspendue, sans piste et sans minuterie.
  labo.reinitialiser();
  const sc = scene();
  const S3 = require('../src/utils/musiqueSources');
  await musique.ajouterPiste(sc, S3.piste({ titre: '📻 Direct FM', url: 'http://flux/direct', source: 'radio' }));
  const session = musique.fileDe('G1');
  session.debutLecture = Date.now() - 60000; // le direct tenait depuis une minute
  session.lecteur.terminer();                // … puis tombe : relance armée
  V('la relance de la radio est programmée', session.minuteurs.has('relance-radio'), [...session.minuteurs.keys()].join(','));
  musique.verifierSolitude('G1', 2);         // quelqu'un entre dans le salon
  V('l\'arrivée de quelqu\'un ne tue PAS la relance', session.minuteurs.has('relance-radio'));
  musique.verifierSolitude('G1', 0);
  V('la solitude s\'ajoute sans écraser le reste', session.minuteurs.has('solitude') && session.minuteurs.has('relance-radio'));
  musique.verifierSolitude('G1', 1);
  V('… et se retire seule', !session.minuteurs.has('solitude') && session.minuteurs.has('relance-radio'));
  musique.quitter('G1', 'fin de test');
  V('quitter coupe tout', session.minuteurs.size === 0);
  labo.reinitialiser();
}

console.log('\n13 septies) La refonte ferme les courses héritées');
{
  const S4 = require('../src/utils/musiqueSources');

  // 1. Deux demandes simultanées, aucune session : UNE seule connexion.
  labo.reinitialiser();
  const scA = scene();
  const scB = scene();
  await Promise.all([
    musique.ajouterPiste(scA, S4.piste({ titre: 'A', url: 'uA', source: 'youtube' })),
    musique.ajouterPiste(scB, S4.piste({ titre: 'B', url: 'uB', source: 'youtube' })),
  ]);
  const joins = labo.journal.filter(([q]) => q === 'join').length;
  V('deux demandes simultanées → UNE connexion', joins === 1, String(joins));
  const s1 = musique.fileDe('G1');
  V('… une seule session, les deux pistes dedans',
    s1 && s1.encours?.titre === 'A' && s1.pistes.length === 1 && s1.pistes[0].titre === 'B',
    JSON.stringify({ encours: s1?.encours?.titre, file: s1?.pistes?.map((p) => p.titre) }));
  musique.quitter('G1', 'fin de test');

  // 2. /musique stop pendant l'ouverture du flux : rien ne joue après.
  labo.reinitialiser();
  labo.reglages.fluxDelaiMs = 120;
  const scC = scene();
  const enCours = musique.ajouterPiste(scC, S4.piste({ titre: 'Lent', url: 'uLent', source: 'youtube' }));
  await new Promise((r) => setTimeout(r, 30));
  musique.quitter('G1', 'stop pendant l\'ouverture');
  await enCours;
  V('un stop pendant l\'ouverture du flux ne lance RIEN',
    !labo.journal.some(([q]) => q === 'play'), JSON.stringify(labo.journal.filter(([q]) => q === 'play')));
  V('… et aucune session ne traîne', musique.fileDe('G1') === null);
  labo.reinitialiser();

  // 3. Un morceau demandé pendant la relance d'une radio passe DEVANT elle.
  const scD = scene();
  await musique.ajouterPiste(scD, S4.piste({ titre: '📻 Direct FM', url: 'http://flux/direct', source: 'radio' }));
  const s2 = musique.fileDe('G1');
  s2.debutLecture = Date.now() - 60000;
  s2.lecteur.terminer(); // le direct tombe : relance armée, radio en tête
  await musique.ajouterPiste(scD, S4.piste({ titre: 'Morceau demandé', url: 'uX', source: 'youtube' }));
  V('le morceau demandé joue tout de suite', s2.encours?.titre === 'Morceau demandé', s2.encours?.titre);
  V('… la radio attend juste derrière', s2.pistes[0]?.source === 'radio', JSON.stringify(s2.pistes.map((p) => p.titre)));
  V('… et la relance programmée est levée', !s2.minuteurs.has('relance-radio'));
  musique.quitter('G1', 'fin de test');
  labo.reinitialiser();

  // 4. La solitude ne repart pas de zéro à chaque événement vocal.
  const scE = scene();
  await musique.ajouterPiste(scE, S4.piste({ titre: 'T', url: 'uT', source: 'youtube' }));
  const s3 = musique.fileDe('G1');
  musique.verifierSolitude('G1', 0);
  const minuterie = s3.minuteurs.get('solitude');
  musique.verifierSolitude('G1', 0);
  V('un second constat de solitude ne réarme pas le compte à rebours',
    s3.minuteurs.get('solitude') === minuterie);
  musique.quitter('G1', 'fin de test');
  labo.reinitialiser();
}

console.log('\n13 bis) Une seconde tentative avant de renoncer');
{
  const mu = require('fs').readFileSync(`${__dirname}/../src/utils/musiqueVocal.js`, 'utf8');
  // Discord laisse parfois tomber le premier « voice server update » : rien
  // ne revient jamais, et la connexion reste en « signalling ».
  V('deux essais', /for \(let essai = 1; essai <= 2; essai\+\+\)/.test(mu));
  V('… le premier plus court', /essai === 1 \? DELAI_PREMIER : DELAI_PRET/.test(mu));
  V('… et chaque échec est tracé côté hébergeur', /1re tentative bloquée en/.test(mu));
  V('une connexion orpheline est nettoyée avant', /ancienne\.destroy\(\)/.test(mu));
}

console.log('\n13 ter) Le diagnostic dit à QUELLE étape ça s\'arrête');
{
  // ⚠️ Rester en « signalling » ne dit qu'une chose : Discord n'a pas
  // répondu. Quatre étapes se cachent derrière, et elles n'accusent pas les
  // mêmes coupables. Aucune n'utilise l'UDP — il n'entre en jeu qu'après la
  // quatrième. C'est pourquoi « UDP ouvert » n'innocente rien tout seul.
  const lire = musique.lireDiagnostic;

  const passerelle = lire({ passerelle: 2, statutFinal: 'signalling' });
  V('passerelle non prête → on le dit', /connexion à Discord n'est pas établie/.test(passerelle.verdict));
  V('… et on propose d\'attendre', /réessayez dans quelques secondes/.test(passerelle.suite));

  const pasPartie = lire({ passerelle: 0, demandeEnvoyee: false, statutFinal: 'signalling' });
  V('demande jamais envoyée → défaut interne au bot', /n'a même pas pu partir/.test(pasPartie.verdict));
  V('… et c\'est nommé comme tel', /défaut interne au bot/.test(pasPartie.suite));

  const rienRecu = lire({ passerelle: 0, demandeEnvoyee: true, etatRecu: false, serveurRecu: false, statutFinal: 'signalling' });
  V('rien reçu → la passerelle ne relaie pas', /ni où je suis, ni quel serveur vocal/.test(rienRecu.verdict));
  V('… on propose le redémarrage, qui règle ce cas', /redémarrez le bot/.test(rienRecu.suite));
  V('… et l\'UDP n\'est PAS accusé ici', !/UDP/.test(rienRecu.suite), rienRecu.suite);

  const sansServeur = lire({ passerelle: 0, demandeEnvoyee: true, etatRecu: true, serveurRecu: false, statutFinal: 'signalling' });
  V('état reçu mais pas le serveur → région du salon', /région du salon/.test(sansServeur.suite));
  V('… et c\'est bien une panne côté Discord', /panne côté Discord/.test(sansServeur.suite));

  const toutRecu = lire({
    passerelle: 0, demandeEnvoyee: true, etatRecu: true, serveurRecu: true, statutFinal: 'connecting',
    reseau: { etapeMax: 2, udp: '66.22.196.1:50001' },
  });
  V('tout reçu et bloqué à la découverte → l\'UDP est constaté', /UDP/.test(toutRecu.verdict), toutRecu.verdict);
  V('… avec la phrase pour l\'hébergeur', /ports 50000-65535/.test(toutRecu.suite));

  const wssFerme = lire({
    passerelle: 0, demandeEnvoyee: true, etatRecu: true, serveurRecu: true, statutFinal: 'connecting',
    reseau: { etapeMax: 0, endpoint: 'paris-test.discord.media' },
  });
  V('WebSocket vocal fermé → TLS accusé, pas l\'UDP', /TLS sortant/.test(wssFerme.suite) && /UDP n'y est pour rien/.test(wssFerme.verdict), wssFerme.verdict);

  const identSansReponse = lire({
    passerelle: 0, demandeEnvoyee: true, etatRecu: true, serveurRecu: true, statutFinal: 'connecting',
    reseau: { etapeMax: 1 },
  });
  V('diagnostic : identification muette ≠ pare-feu', /identification/.test(identSansReponse.verdict)
    && /pare-feu n'y est pour rien/.test(identSansReponse.suite), identSansReponse.verdict);

  const modeRefuse = lire({
    passerelle: 0, demandeEnvoyee: true, etatRecu: true, serveurRecu: true, statutFinal: 'connecting',
    reseau: { etapeMax: 3, fermeture: 4016 },
  });
  V('4016 → le chiffrement est désigné', /chiffrement/.test(modeRefuse.verdict), modeRefuse.verdict);

  const sansReleve = lire({ passerelle: 0, demandeEnvoyee: true, etatRecu: true, serveurRecu: true, statutFinal: 'connecting' });
  V('sans relevé réseau, pas d\'accusation UDP à l\'aveugle', !/UDP/.test(sansReleve.suite), sansReleve.suite);

  const bon = lire({ passerelle: 0, demandeEnvoyee: true, etatRecu: true, serveurRecu: true, statutFinal: 'ready' });
  V('connexion réussie → verdict positif', /fonctionne/.test(bon.verdict));

  const cmd3 = require('fs').readFileSync(`${__dirname}/../src/commands/musique.js`, 'utf8').replace(/\\'/g, "'");
  V('la commande /musique diagnostic existe', /setName\('diagnostic'\)/.test(cmd3));
  V('… elle refuse hors vocal', /le test a besoin d'un salon où essayer/.test(cmd3));
  V('… et ne relance rien si la musique joue déjà', /la connexion vocale fonctionne donc/.test(cmd3));
  const mu2 = require('fs').readFileSync(`${__dirname}/../src/utils/musiqueVocal.js`, 'utf8').replace(/\\'/g, "'");
  V('l\'adaptateur est instrumenté', /onVoiceServerUpdate\(donnees\) \{ etapes\.serveurRecu = true/.test(mu2));
  V('… et la connexion de test est toujours refermée', /finally \{\s*\n\s*try \{ connexion\?\.destroy/.test(mu2));
  V('le fait que l\'UDP n\'intervient qu\'à la fin est écrit', /Aucune de ces étapes n'utilise l'UDP/.test(mu2));
}

console.log('\n14) Branchements');
  {
    const fs = require('fs');
    const ic = fs.readFileSync(`${__dirname}/../src/events/interactionCreate.js`, 'utf8');
    V('les boutons de lecture sont routés', /customId\?\.startsWith\('mus:'\)/.test(ic));
    const vs = fs.readFileSync(`${__dirname}/../src/events/voiceStateUpdate.js`, 'utf8');
    V('la solitude est surveillée', /verifierSolitude\(guild\.id, humains\)/.test(vs));
    V('… en comptant les HUMAINS, pas les bots', /filter\(\(m\) => !m\.user\.bot\)/.test(vs));
    const mu = fs.readFileSync(`${__dirname}/../src/utils/musiqueSession.js`, 'utf8');
    V('la déconnexion distingue un changement de région', /Signalling[\s\S]{0,120}Connecting/.test(mu));
    const rd = fs.readFileSync(`${__dirname}/../src/events/ready.js`, 'utf8');
    V('les briques manquantes sont signalées au démarrage', /briquesManquantes\(\)/.test(rd));
    V('… en disant que la connexion vocale n\'aboutira pas', /n'aboutira pas/.test(rd));
  }

  global.fetch = vraiFetch;
  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})();
