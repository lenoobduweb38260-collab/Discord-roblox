// 📻 /radio — l'annuaire, la résolution, la lecture, et FFmpeg.
const fs = require('fs');
const os = require('os');
const path = require('path');
const AIDES = path.join(__dirname, 'aides');

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');
// FFmpeg « présent » : n'importe quel fichier existant fait l'affaire pour la
// détection — on ne lance jamais le binaire dans un test.
process.env.FFMPEG_PATH = process.execPath;

const Module = require('module');
const vrai = Module.prototype.require;
const labo = vrai.call(module, path.join(AIDES, 'stub-voix.js'));
Module.prototype.require = function (n) {
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === '@discordjs/voice') return labo.voix;
  if (n === 'play-dl') return labo.play;
  return vrai.apply(this, arguments);
};

const radios = require('../src/utils/radios');
const moteur = require('../src/utils/musiqueMoteur');
const musique = require('../src/utils/music');
const commande = require('../src/commands/radio');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

// L'annuaire de laboratoire : trois stations, et un compteur d'appels.
const STATIONS = [
  { stationuuid: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'France Inter', url_resolved: 'http://flux/inter', tags: 'actualité,talk', codec: 'MP3', bitrate: 128, votes: 900, favicon: 'https://img/fi.png', homepage: 'https://franceinter.fr' },
  { stationuuid: 'bbbbbbbb-1111-2222-3333-444444444444', name: 'Chérie FM', url_resolved: 'http://flux/cherie', tags: 'pop', codec: 'AAC', bitrate: 96, votes: 500 },
  { stationuuid: 'cccccccc-1111-2222-3333-444444444444', name: 'Skyrock', url_resolved: 'http://flux/sky', tags: 'rap', codec: 'MP3', bitrate: 128, votes: 400 },
];
const appels = [];
let miroirEnPanne = false;
global.fetch = async (url) => {
  appels.push(String(url));
  if (miroirEnPanne && String(url).startsWith(radios.MIROIRS[0])) throw new Error('miroir endormi');
  if (/\/json\/url\//.test(String(url))) {
    if (/cccccccc/.test(String(url))) return { ok: true, json: async () => ({ ok: false }) };
    return { ok: true, json: async () => ({ ok: true, url: 'http://flux/inter?vraie' }) };
  }
  if (/byuuid/.test(String(url))) {
    return { ok: true, json: async () => STATIONS.filter((s) => String(url).includes(s.stationuuid)) };
  }
  return { ok: true, json: async () => STATIONS };
};

function scene() {
  const salon = { id: 'VOC1', permissionsFor: () => ({ has: () => true }) };
  const guild = { id: 'G1', voiceAdapterCreator: () => {}, members: { me: { id: 'BOT' } } };
  salon.guild = guild;
  const reponses = [];
  return {
    guildId: 'G1', channelId: 'TXT1',
    member: { voice: { channel: salon, channelId: 'VOC1' } },
    guild,
    client: { channels: { fetch: async () => ({ isTextBased: () => true, send: async () => {} }) } },
    options: { valeurs: {}, getSubcommand() { return this.sub; }, getString(n) { return this.valeurs[n]; }, getFocused() { return this.focus || ''; } },
    replied: false, deferred: false,
    async reply(m) { reponses.push(m); this.replied = true; return {}; },
    async editReply(m) { reponses.push(m); return {}; },
    async deferReply() { this.deferred = true; return {}; },
    async respond(choix) { reponses.push({ autocomplete: choix }); return {}; },
    isRepliable: () => true,
    reponses, salon,
  };
}

(async () => {
  console.log('\n1) L\'annuaire des radios françaises');
  {
    radios.reinitialiser();
    const stations = await radios.francaises();
    V('le classement arrive, allégé', stations.length === 3 && stations[0].nom === 'France Inter');
    V('… avec l\'URL du flux', stations[0].url === 'http://flux/inter');
    V('… et les genres découpés', stations[0].genres.join('+') === 'actualité+talk');
    const avant = appels.length;
    await radios.francaises();
    V('le cache évite de rappeler l\'annuaire', appels.length === avant);
  }

  console.log('\n2) La recherche, sans accents ni majuscules');
  {
    const cherie = await radios.chercher('cherie');
    V('« cherie » trouve Chérie FM', cherie.length === 1 && cherie[0].nom === 'Chérie FM', JSON.stringify(cherie.map((s) => s.nom)));
    const genre = await radios.chercher('rap');
    V('un genre répond aussi', genre.some((s) => s.nom === 'Skyrock'));
    const tout = await radios.chercher('');
    V('vide = le classement entier', tout.length === 3);
  }

  console.log('\n3) Du choix à la station, de la station au flux');
  {
    const parUuid = await radios.trouver('aaaaaaaa-1111-2222-3333-444444444444');
    V('un uuid d\'autocomplétion retrouve sa station', parUuid?.nom === 'France Inter');
    const parTexte = await radios.trouver('skyrock');
    V('un texte tapé sans choisir retombe sur ses pattes', parTexte?.nom === 'Skyrock');
    const url = await radios.urlDeLecture(parUuid);
    V('l\'annuaire est prévenu de la lecture, et donne l\'URL', url === 'http://flux/inter?vraie');
    const repli = await radios.urlDeLecture(parTexte);
    V('s\'il refuse, l\'URL de la fiche fait l\'affaire', repli === 'http://flux/sky');
  }

  console.log('\n4) Un miroir endormi ne casse rien');
  {
    radios.reinitialiser();
    miroirEnPanne = true;
    const stations = await radios.francaises();
    V('le miroir suivant prend le relais', stations.length === 3);
    miroirEnPanne = false;
  }

  console.log('\n5) FFmpeg : détecté, et exigé par les radios seulement');
  {
    V('FFMPEG_PATH est vu comme un FFmpeg valable', moteur.cheminFfmpeg() === process.execPath);
    V('donc rien ne manque pour les radios', moteur.ffmpegManquant() === null);
    const rapport = moteur.rapportDependances();
    V('le rapport des briques le montre', rapport.ffmpeg === process.execPath);
    V('le chiffrement natif de Node suffit', /crypto natif/.test(rapport.chiffrement || ''), rapport.chiffrement);
  }

  console.log('\n6) /radio ecouter — la radio entre dans la file de /musique');
  {
    labo.reinitialiser();
    const sc = scene();
    sc.options.sub = 'ecouter';
    sc.options.valeurs = { station: 'aaaaaaaa-1111-2222-3333-444444444444' };
    await commande.execute(sc);
    const rep = sc.reponses[sc.reponses.length - 1];
    V('la commande répond par une carte', Boolean(rep?.embeds?.length), JSON.stringify(rep)?.slice(0, 120));
    const etat = musique.etat('G1');
    V('la station joue', etat?.encours?.titre === '📻 France Inter', etat?.encours?.titre);
    V('… en tant que source « radio »', etat?.encours?.source === 'radio');
    V('… avec l\'URL donnée par l\'annuaire', etat?.encours?.url === 'http://flux/inter?vraie');
    const ressource = labo.journal.find(([q]) => q === 'resource');
    V('le flux part en type « arbitraire » (décodé par FFmpeg)', ressource?.[1] === labo.voix.StreamType.Arbitrary, JSON.stringify(ressource));
    const lecture = labo.journal.find(([q]) => q === 'play');
    V('… et c\'est bien l\'URL du flux qu\'on joue', lecture?.[1] === 'http://flux/inter?vraie', JSON.stringify(lecture));
    musique.quitter('G1', 'fin de test');
  }

  console.log('\n7) /radio liste et /radio stop');
  {
    labo.reinitialiser();
    const sc = scene();
    sc.options.sub = 'liste';
    await commande.execute(sc);
    const rep = sc.reponses[sc.reponses.length - 1];
    const texte = JSON.stringify(rep);
    V('la liste montre le classement', /France Inter/.test(texte) && /Skyrock/.test(texte));

    const sc2 = scene();
    sc2.options.sub = 'stop';
    await commande.execute(sc2);
    V('stop sans lecture le dit', /Rien en lecture/.test(JSON.stringify(sc2.reponses)));
  }

  console.log('\n8) L\'autocomplétion propose, avec l\'uuid en valeur');
  {
    const sc = scene();
    sc.options.focus = 'inter';
    await commande.autocomplete(sc);
    const rep = sc.reponses[sc.reponses.length - 1];
    V('des choix arrivent', Boolean(rep?.autocomplete?.length), JSON.stringify(rep));
    V('… le nom est décoré, la valeur est l\'uuid',
      /📻 France Inter/.test(rep.autocomplete[0].name) && rep.autocomplete[0].value === 'aaaaaaaa-1111-2222-3333-444444444444');
  }

  console.log('\n9) Sans FFmpeg, la marche à suivre — pas « une erreur est survenue »');
  {
    // Un moteur TOUT NEUF, sans FFMPEG_PATH ni PATH : la détection échoue, et
    // le message doit dire QUOI installer, différemment selon Node ou exe.
    const sauvegarde = { FFMPEG_PATH: process.env.FFMPEG_PATH, PATH: process.env.PATH };
    delete process.env.FFMPEG_PATH;
    process.env.PATH = '';
    delete require.cache[require.resolve('../src/utils/musiqueMoteur')];
    const moteurNu = require('../src/utils/musiqueMoteur');
    const souci = moteurNu.ffmpegManquant();
    V('le manque est constaté', typeof souci === 'string' && /FFmpeg/.test(souci), souci);
    V('… avec la commande d\'installation', /apt install ffmpeg|ffmpeg-static/.test(souci));
    process.env.FFMPEG_PATH = sauvegarde.FFMPEG_PATH;
    process.env.PATH = sauvegarde.PATH;
    delete require.cache[require.resolve('../src/utils/musiqueMoteur')];
  }

  console.log('\n9 bis) L\'annuaire des bénévoles ne casse jamais l\'embed');
  {
    // Une vignette « logo.png » ou un site « www.radio.fr » y traînent : passés
    // tels quels à discord.js, setThumbnail/setURL LÈVENT.
    const s1 = radios.alleger({ stationuuid: 'u', name: 'X', url_resolved: 'http://flux/x', favicon: 'logo.png', homepage: 'www.radio.fr' });
    V('une vignette relative est écartée', s1.logo === null);
    V('un site sans protocole est écarté', s1.site === null);
    const s2 = radios.alleger({ stationuuid: 'u', name: 'X', url_resolved: 'http://flux/x', favicon: 'https://ok/l.png', homepage: 'https://ok' });
    V('les vraies URL passent', s2.logo === 'https://ok/l.png' && s2.site === 'https://ok');
  }

  console.log('\n9 ter) Une panne totale se retient — l\'autocomplétion ne martèle pas');
  {
    radios.reinitialiser();
    const vraiFetch = global.fetch;
    global.fetch = async (url) => { appels.push(String(url)); throw new Error('tout est mort'); };
    await radios.francaises().catch(() => null);
    const apresEchec = appels.length;
    V('l\'échec a balayé les miroirs', apresEchec >= radios.MIROIRS.length);
    await radios.francaises().catch(() => null);
    V('la frappe suivante n\'appelle PERSONNE pendant la panne', appels.length === apresEchec, String(appels.length - apresEchec));
    global.fetch = vraiFetch;
    radios.reinitialiser();
  }

  console.log('\n10) Branchements');
  {
    const idx = fs.readFileSync(`${__dirname}/../src/index.js`, 'utf8');
    V('l\'exécutable regarde si ffmpeg est posé à côté de lui', /FFMPEG_PATH/.test(idx) && /ffmpeg\.exe/.test(idx));
    const pkg = JSON.parse(fs.readFileSync(`${__dirname}/../package.json`, 'utf8'));
    V('ffmpeg-static est déclaré pour les hébergements Node', Boolean(pkg.dependencies['ffmpeg-static']));
    const src = fs.readFileSync(`${__dirname}/../src/commands/radio.js`, 'utf8');
    V('la commande vérifie FFmpeg AVANT d\'entrer dans le vocal', src.indexOf('ffmpegManquant') < src.indexOf('radios.trouver'));
    const ic = fs.readFileSync(`${__dirname}/../src/events/interactionCreate.js`, 'utf8');
    V('l\'autocomplétion est routée par l\'événement central', /isAutocomplete\(\)/.test(ic));
  }

  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})();
