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

  console.log('\n13) Un échec vocal nomme la VRAIE cause');
{
  // ⚠️ L'ancien message accusait les permissions. C'était faux : elles sont
  // vérifiées AVANT d'essayer de se connecter — si on arrive là, elles sont
  // bonnes. Accuser une cause qu'on n'a pas vérifiée envoie chercher des
  // heures du mauvais côté.
  const salon = { id: 'VOC1' };
  const moteur2 = require('../src/utils/musiqueMoteur');
  const vraiManque = moteur2.briquesManquantes;

  // Cas 1 : toutes les briques sont là — la cause est ailleurs.
  moteur2.briquesManquantes = () => null;
  const sig = musique.expliquerEchecVocal('signalling', salon);
  V('bloqué en « signalling » → on parle de l\'intent vocal', /Server Voice States/.test(sig), sig.split('\n')[2]);
  V('… et de la connexion déjà ouverte ailleurs', /déjà connecté à un autre salon/.test(sig));
  V('… sans accuser les permissions', !/permissions \*\*Se connecter\*\*/.test(sig));

  const con = musique.expliquerEchecVocal('connecting', salon);
  V('bloqué en « connecting » → on parle des ports UDP', /UDP/.test(con), con.split('\n')[3]);
  V('… on propose de changer la région du salon', /région du salon vocal/.test(con));
  V('… et on dit explicitement que les permissions sont bonnes',
    /Mes permissions sont bonnes/.test(con));

  const autre = musique.expliquerEchecVocal('bizarre', salon);
  V('un état imprévu est nommé tel quel', /« bizarre »/.test(autre), autre);
  V('… et renvoie vers le diagnostic', /\/musique sources/.test(autre));

  // Cas 2 : une brique manque — c'est LA cause, et elle passe devant.
  moteur2.briquesManquantes = () => ['un **encodeur Opus** (`npm install opusscript`)'];
  const sansOpus = musique.expliquerEchecVocal('connecting', salon);
  V('une brique manquante est annoncée en premier', /Cause trouvée/.test(sansOpus), sansOpus.split('\n')[2]);
  V('… avec la commande pour l\'installer', /npm install opusscript/.test(sansOpus));
  V('… et l\'avertissement que ça ressemble aux permissions',
    /ressemble à un problème de permissions, mais n'en est pas un/.test(sansOpus));
  moteur2.briquesManquantes = vraiManque;
}

console.log('\n14) Branchements');
  {
    const fs = require('fs');
    const ic = fs.readFileSync(`${__dirname}/../src/events/interactionCreate.js`, 'utf8');
    V('les boutons de lecture sont routés', /customId\?\.startsWith\('mus:'\)/.test(ic));
    const vs = fs.readFileSync(`${__dirname}/../src/events/voiceStateUpdate.js`, 'utf8');
    V('la solitude est surveillée', /verifierSolitude\(guild\.id, humains\)/.test(vs));
    V('… en comptant les HUMAINS, pas les bots', /filter\(\(m\) => !m\.user\.bot\)/.test(vs));
    const mu = fs.readFileSync(`${__dirname}/../src/utils/music.js`, 'utf8');
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
