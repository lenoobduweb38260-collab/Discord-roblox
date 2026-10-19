// 💌 Confessions : le filtre (détection, contournements, faux positifs,
// temps de calcul) et les flux de publication qui ont déjà cassé (salon d'un
// autre serveur, serveur fermé entre-temps, blacklist concurrente, numéros
// en double, raison de ban, réponse en moins de 3 secondes).
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'confessions-filtre-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');
process.env.OWNER_ID = 'CREA';

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  return vrai.apply(this, arguments);
};

const { db, setGuildConfig } = require('../src/database');
const C = require('../src/utils/confessions');
const CONF = require('../src/commands/confession');
const { setHq } = require('../src/utils/botTickets');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };
const texte = (o) => JSON.stringify(o);
const cat = (t) => C.detecter(t).categories.join(',');
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const warnOrig = console.warn;
console.warn = () => {};

const positives = (titre, attendu, phrases) => {
  console.log(`\n${titre}`);
  for (const p of phrases) V(`« ${p} » → ${attendu}`, cat(p).split(',').includes(attendu), cat(p) || '—');
};

(async () => {
  // ════════════════════════════════════════════════════════════════════
  positives('1) Détresse : signalée (et le 3114 envoyé)', 'suicide', [
    // témoins qui marchaient déjà
    'Je veux me suicider ce soir', 'j\'ai envie de mourir', 'plus envie de vivre', 'je me scarifie depuis un mois',
    'I want to die', 'je veux mourir', 'je veux me tuer', 'kms', 'suicide',
    // formulations courantes
    'j\'en peux plus de vivre', 'je veux plus vivre', 'je ne veux plus vivre', 'je voudrais mourir', 'j\'aimerais mourir',
    'je mérite de mourir', 'je pense à mourir tous les jours', 'je veux mettre fin à ma vie', 'je vais mettre fin à mes jours',
    'je veux disparaître', 'je me suis scarifié hier', 'je me suis scarifiée', 'je me scarifiais', 'je me suis mutilée',
    'je m\'automutile', 'je me coupe les bras depuis des mois', 'je vais sauter du pont', 'je vais me jeter sous le métro',
    'je vais avaler toutes mes pilules', 'j\'ai des idées noires', 'j\'ai fait une TS', 'i wanna die', 'j\'ai envie d\'en finir',
    'je veux en finir avec la vie', 'en finir avec tout',
    // oral et fautes
    'jveux mourir', 'je veu mourir', 'je veux mourrir', 'jveux en finir', 'j\'veux crever',
    // élisions
    'je vais m\'ouvrir les veines', 'je veux m\'immoler', 'je vais m\'empoisonner',
    // autres formulations
    'je n\'ai plus de raison de vivre', 'la vie n\'a plus de sens', 'je veux m\'endormir et ne jamais me réveiller',
    'je me fais du mal', 'je pense à me tuer', 'je voudrais disparaître',
  ]);

  positives('2) Menaces : signalées', 'menace', [
    // témoins
    'je vais te tuer demain', 't\'es mort toi', 'je sais où tu habites', 'je vais le tuer ce mec', 'je vais poser une bombe',
    // oral contracté
    'jvais te tuer', 'j\'vais te tuer', 'j vais te buter', 'je te tue', 'jte bute', 'tes mort', 't\'es un homme mort',
    'tu es un homme mort', 'tu vas crever', 'tu vas mourir',
    // cible nommée
    'je vais tuer mon prof', 'je vais tuer mon beau-père', 'je vais buter Kevin', 'je vais poignarder mon prof demain',
    // collectives, scolaires
    'je vais tous vous tuer', 'je vais tous les tuer', 'je vais tirer sur tout le monde au lycée',
    'je vais amener le fusil de mon père au collège', 'je vais faire sauter le lycée',
    // viol, coups, feu
    'je vais te violer', 'je vais violer cette fille', 'je vais te casser la gueule', 'je vais te tabasser',
    'je vais brûler ta maison', 'kill yourself', 'go kill yourself',
    // verbes à voyelle (élision)
    'je vais t\'égorger', 'je vais t\'étrangler', 'je vais t\'éclater', 'je vais t\'exploser', 'je vais t\'achever',
    'je vais t\'abattre', 'je vais t\'assassiner', 'je vais t\'empoisonner', 'je vais t\'immoler', 'je vais l\'égorger',
    'je sais où t\'habites',
  ]);

  positives('3) Insultes et propos haineux : signalés', 'insulte', [
    // témoins
    'quel connard ce prof', 'espèce de s4l0p3', 'c o n n a r d', 'connaaaard', 'fdp va', 'Nique ta mère', 'ntm',
    'sale noir', 'sale arabe', 'sale juif',
    // nouveaux
    'va te faire enculer', 'enculer', 'nik ta mère', 'nik ta race', 'niquer ta mère', 'nique ta reum', 'nique ta race',
    'pauvre conne', 'sale conne', 'grosse conne', 'espèce de conne', 'fiotte', 'tafiole', 'lopette', 'négresse',
    'bougnoule', 'sale bougnoul', 'bamboula', 'trou du cul', 'sale gitan', 'sale rebeu', 'sale renoi', 'sale feuj',
    'sale musulman', 'sale gay', 'sale homo', 'sale lesbienne', 'sale travelo', 'sale singe', 'sale chienne',
    'ta mère la chienne', 'fils de p*te', 'c*nnard', 'enc*lé', 'tgfdp', 'filsdepute', 'niquetamere', 'conard',
    'espèce d\'attardé',
  ]);

  console.log('\n4) Phrases anodines : rien à relire');
  {
    const propres = [
      // témoins
      'J\'ai tué le temps en jouant', 'je suis mort de rire', 't\'es mort de rire là', 'ce film est une bombe',
      'je kiffe trop ma voisine', 'putain que je t\'aime', 'on a tué la soirée hier', 'la mort de mon chat m\'a rendu triste',
      'j\'ai un crush sur quelqu\'un du serveur', 'mon pote est trop con parfois haha', 'connaissance', 'computer', 'Scunthorpe',
      // « retard », « tuerie », « attardé »
      'je suis en retard', 'désolé pour le retard', 'j\'ai du retard', 'retard de train', 'le bus a du retard',
      'c\'était une tuerie ce concert', 'ce burger est une tuerie', 'je me suis attardé', 'attardé au travail',
      // hyperboles
      's\'il lit ça je vais mourir de honte', 'je veux mourir de rire', 'j\'ai envie de mourir de rire', 'je vais mourir de chaud',
      'je vais crever de chaud', 'je vais crever de faim', 'je vais mourir de fatigue', 'je vais mourir de peur',
      'je vais mourir d\'ennui', 'je veux mourir vieux', 'je voudrais mourir de honte', 'je veux en finir avec mes exams',
      'je vais en finir avec ce devoir', 'en finir avec tout ce stress', 'je vais me tuer à la salle', 'je vais me tuer au travail',
      'mes parents vont me tuer', 'j\'ai couru 5 kms', 'on a fait 10 kms',
      // jeux et choses
      'je vais te tuer à Fortnite', 'je vais te défoncer à Mario Kart', 'je vais te frapper aux échecs',
      'je vais le planter dans le jardin', 'je vais les planter demain', 'je vais la cramer cette pizza',
      'je vais te retrouver demain à la gare', 'je vais tuer le temps',
      // « mort », titres, mots composés
      't\'es mort ou quoi ?', 't\'es mort ? réponds', 'tu es mort de fatigue', 'tu es mort de faim', 'je suis mort de fatigue',
      'j\'ai regardé Suicide Squad', 'un pain bâtard', 'l\'épée bâtarde', 'le pd-g de la boîte', 'les fdp sont offerts',
      'NTM en concert', 'Niger', 'un fagot de bois', 'une tapette à mouches', 'tu vas te casser la gueule si tu cours',
      'je respecte tes morts', 'ni ta mère ni ton père', 'je vais te tuer de rire avec cette blague',
      'je vais le violer ce règlement', 'je vais tuer cette chanson au karaoké', 'je vais tuer l\'exam demain',
      'je vais l\'achever ce livre ce soir', 'je vais t\'écraser au foot', 'je veux disparaître quelques jours',
      'tu vas mourir de rire', 'je me suis coupé le doigt en cuisinant', 'j\'ai sauté du pont de la piscine',
      'je vais me jeter à l\'eau et lui dire', 'tu me fais du mal', 'il va me tuer quand il saura', 'on va tous mourir un jour',
    ];
    for (const p of propres) V(`« ${p} » → rien`, cat(p) === '', cat(p));
    V('extraits relevés pour le staff', C.detecter('je vais te tuer, connard').extraits.length >= 2);
  }

  console.log('\n5) Contournements : le mot affiché entier est lu entier');
  {
    const ruses = [
      ['con​nard', 'insulte', 'espace de largeur nulle'],
      ['con‍nard', 'insulte', 'liant sans chasse'],
      ['sa‌lope', 'insulte', 'antiliant'],
      ['je veux mou⁠rir', 'suicide', 'gluon de mots'],
      ['fils de pu­te', 'insulte', 'trait d\'union conditionnel'],
      ['je vais te tu­er', 'menace', 'trait d\'union conditionnel'],
      ['je vais te t​uer', 'menace', 'espace de largeur nulle'],
      ['﻿connard', 'insulte', 'indicateur d\'ordre'],
      ['co**nn**ard', 'insulte', '**gras**'],
      ['**con**nard', 'insulte', '**gras** en tête'],
      ['c**o**nnard', 'insulte', '**gras** d\'une lettre'],
      ['__sal__ope', 'insulte', '__souligné__'],
      ['je veux mo*u*rir', 'suicide', '*italique*'],
      ['je veux me sui**ci**der', 'suicide', '**gras**'],
      ['je veux me ~~~~sui~~cider', 'suicide', '~~barré~~'],
      ['con||nard||', 'insulte', '||spoiler||'],
      ['je vais te t||u||er', 'menace', '||spoiler||'],
      ['fils de p__u__te', 'insulte', '__souligné__'],
      ['`connard`', 'insulte', '`code`'],
      ['ｃｏｎｎａｒｄ', 'insulte', 'pleine chasse'],
      ['je veux ｍｏｕｒｉｒ', 'suicide', 'pleine chasse'],
      ['𝐜𝐨𝐧𝐧𝐚𝐫𝐝', 'insulte', '𝐠𝐫𝐚𝐬 mathématique'],
      ['𝓈𝒶𝓁𝑜𝓅𝑒', 'insulte', 'cursive mathématique'],
      ['Ⓒⓞⓝⓝⓐⓡⓓ', 'insulte', 'lettres cerclées'],
      ['ⓢⓐⓛⓞⓟⓔ', 'insulte', 'ⓒⓔⓡⓒⓛⓔⓢ'],
      ['сonnard', 'insulte', 'с cyrillique'],
      ['sаlope', 'insulte', 'а cyrillique'],
      ['соnnаrd', 'insulte', 'trois lettres cyrilliques'],
      ['ѕаlоре', 'insulte', 'ѕ et р cyrilliques'],
      ['je vais te tυer', 'menace', 'υ grec'],
      ['cοnnard', 'insulte', 'ο grec'],
      ['connnnard', 'insulte', 'lettre double étirée'],
      ['connnnnnard', 'insulte', 'lettre double très étirée'],
      ['cooonnnaaard', 'insulte', 'tout étiré'],
      ['connasssse', 'insulte', 'double s étiré'],
      ['tapettte', 'insulte', 'double t étiré'],
      ['fagggot', 'insulte', 'double g étiré'],
      ['niggggger', 'insulte', 'double g étiré'],
      ['killll myself', 'suicide', 'double l étiré'],
      ['salooope', 'insulte', 'voyelle étirée'],
      ['puuuute', 'insulte', 'voyelle étirée'],
      ['je veux mouuuurir', 'suicide', 'voyelle étirée'],
      ['C O N N A R D', 'insulte', 'majuscules espacées'],
    ];
    for (const [phrase, attendu, ruse] of ruses) V(`${ruse} : « ${phrase} » → ${attendu}`, cat(phrase).split(',').includes(attendu), cat(phrase) || '—');
    V('« Ł », « Ø », « Æ », « Œ », « Đ », « ß » ramenés au latin',
      C.normaliser('ŁØÆŒĐß') === ' loaeoedss ', C.normaliser('ŁØÆŒĐß'));
    V('normaliser ne lève jamais', [null, undefined, '', 0, 42, {}, [], '\uD800', 'İ', '́'.repeat(50)].every((x) => typeof C.normaliser(x) === 'string'));
    V('detecter ne lève jamais', [null, undefined, '', 0, 42, {}, [], '\uD800'].every((x) => Array.isArray(C.detecter(x).categories)));
  }

  console.log('\n6) Anti-ReDoS : 1000 caractères pathologiques, moins de 50 ms par appel');
  {
    const pires = {
      'a × 1000': 'a'.repeat(1000),
      'a␠ × 500': 'a '.repeat(500),
      'aaab × 250': 'aaab'.repeat(250),
      '*a × 500': '*a'.repeat(500),
      'a*b × 333': 'a*b'.repeat(333),
      '_ et | mêlés': '_|*~`a'.repeat(166),
      'ZWSP × 1000': '​'.repeat(1000),
      'zalgo': ('c' + '̀́̂̃̄'.repeat(3)).repeat(62),
      'je vais te × 90': 'je vais te '.repeat(90),
      'je vais te tuer × 66': 'je vais te tuer '.repeat(66),
      'je vais tuer × 80': 'je vais tuer '.repeat(80),
      'tu es mort × 90': 'tu es mort '.repeat(90),
      'sale × 200': 'sale '.repeat(200),
      'me me me × 333': 'me '.repeat(333),
      'en finir avec × 70': 'en finir avec '.repeat(70),
      'veux × 200': 'veux '.repeat(200),
      'j j j × 500': 'j '.repeat(500),
      'chiffres': '5 '.repeat(500),
      'kms collés': '5kms'.repeat(250),
      'pleine chasse': 'ｃｏｎｎａｒｄ'.repeat(143),
      'cyrillique': 'сонн'.repeat(250),
      'emojis': '💌'.repeat(500),
    };
    let pire = 0, quoi = '';
    for (const [nom, t] of Object.entries(pires)) {
      C.detecter(t); // chauffe
      const debut = process.hrtime.bigint();
      C.detecter(t);
      const ms = Number(process.hrtime.bigint() - debut) / 1e6;
      if (ms > pire) { pire = ms; quoi = nom; }
      V(`${nom} (${t.length} car.) : ${ms.toFixed(2)} ms`, ms < 50 && t.length >= 900, `${ms.toFixed(1)} ms`);
    }
    console.log(`  ⏱️ pire cas : ${quoi}, ${pire.toFixed(2)} ms`);
  }

  await flux();

  console.warn = warnOrig;
  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.warn = warnOrig; console.error(e); console.log('\n0 réussis, 1 échoués'); process.exit(1); });

// ════════════════════════════════════════════════════════════════════
// Les flux : un faux Discord à deux serveurs (G1 a les confessions, G2 est un
// serveur tiers où le bot est aussi présent).
// ════════════════════════════════════════════════════════════════════
async function flux() {
  const TeamBot = require('../src/utils/botTeam');
  const personne = (id, nom) => ({
    id, username: nom, displayName: nom, globalName: nom, bot: false, tag: `${nom}#0`,
    displayAvatarURL: () => `https://cdn.test/${id}.png`,
    dms: [], async send(m) { this.dms.push(m); return {}; },
  });
  const USERS = {};
  for (const [id, nom] of [['CREA', 'Créateur'], ['u1', 'Alice'], ['u2', 'Bob'], ['u3', 'Chloé'], ['u4', 'Dan'],
    ['u5', 'Eve'], ['u6', 'Fred'], ['u7', 'Gina'], ['u8', 'Hugo'], ['x', 'Xavier'], ['y', 'Yann'], ['z', 'Zoé']]) USERS[id] = personne(id, nom);

  const SALONS = {};
  function salon(id, guildId) {
    const s = {
      id, guildId, guild: null, envois: [], delai: 0, panne: false, isTextBased: () => true,
      async send(m) {
        if (this.delai) await attendre(this.delai);
        if (this.panne) throw new Error('Missing Permissions');
        this.envois.push(m);
        const n = this.envois.length;
        return { id: `m${n}-${id}`, url: `https://discord.com/channels/${guildId}/${id}/m${n}`, ...m };
      },
      messages: { fetch: async () => null },
    };
    SALONS[id] = s;
    return s;
  }
  const bans = [];
  function serveur(id, nom) {
    const g = {
      id, name: nom, delaiBan: 0,
      // Comme GuildChannelManager.fetch : un salon d'un autre serveur est refusé.
      channels: {
        fetch: async (cid) => {
          const s = SALONS[cid];
          if (!s) throw new Error('Unknown Channel');
          if (s.guildId !== id) throw new Error('GuildChannelUnowned');
          return s;
        },
      },
      members: {
        cache: new Map(),
        fetch: async () => null,
        ban: async (userId, options) => {
          if (g.delaiBan) await attendre(g.delaiBan);
          bans.push({ guild: id, userId, reason: options?.reason });
        },
      },
    };
    return g;
  }
  const G1 = serveur('G1', 'Labo RP');
  const G2 = serveur('G2', 'Serveur tiers');
  for (const [sid, gid] of [['CONF1', 'G1'], ['CONF1B', 'G1'], ['AUTRE', 'G2'], ['QG', 'GQ']]) salon(sid, gid).guild = { G1, G2 }[gid] || null;
  const client = {
    user: { id: 'bot' },
    application: { fetch: async () => ({ owner: { id: 'CREA' } }) },
    users: { fetch: async (id) => USERS[id] || null },
    // Comme ChannelManager.fetch : le cache GLOBAL, tous serveurs confondus.
    channels: { fetch: async (id) => SALONS[id] || null },
    guilds: { cache: new Map([['G1', G1], ['G2', G2]]) },
  };

  function fausse({ user = 'u1', strings = {}, customId, guild = G1 } = {}) {
    return {
      client, guild, guildId: guild.id, locale: 'fr', customId, user: USERS[user],
      deferred: false, replied: false, appels: [],
      message: { components: [], embeds: [{}], flags: 0, createdTimestamp: Date.now() },
      inGuild: () => true,
      options: { getString: (n) => (strings[n] === undefined ? null : strings[n]), getSubcommand: () => null, getUser: () => null },
      async reply(p) { this.appels.push(['reply', p]); this.replied = true; this.reponses.push(p); return p; },
      async deferReply(p) { this.appels.push(['deferReply', p]); this.deferred = true; },
      async editReply(p) { this.appels.push(['editReply', p]); this.reponses.push(p); return p; },
      async followUp(p) { this.appels.push(['followUp', p]); this.suivis.push(p); return p; },
      async update(p) { this.appels.push(['update', p]); this.replied = true; this.mises.push(p); return p; },
      async deferUpdate() { this.appels.push(['deferUpdate']); },
      reponses: [], suivis: [], mises: [],
    };
  }
  const contenu = (it) => texte(it.reponses[0] || it.suivis[0] || it.mises[0] || {});
  const titre = (m) => m?.embeds?.[0]?.data?.title || m?.embeds?.[0]?.title || '';
  const ligne = (id) => C.lire.get(id);
  const derniereDe = (auteur) => db.prepare('SELECT * FROM confessions WHERE author_id = ? ORDER BY id DESC').get(auteur);
  // Une confession par minute et par membre : chaque envoi a son auteur.
  let compteur = 0;
  const nouveau = () => { const id = `p${++compteur}`; USERS[id] = personne(id, `Membre ${compteur}`); return id; };
  const confesser = async (user, phrase, guild = G1) => {
    const it = fausse({ user, strings: { texte: phrase }, guild });
    await CONF.execute(it);
    return it;
  };
  const cliquer = async (user, action, id) => {
    const it = fausse({ user, customId: `cfs:${action}:${id}` });
    await C.handleButton(it);
    return it;
  };

  console.log('\n7) Salon d\'un AUTRE serveur : refusé');
  {
    setGuildConfig('G1', 'confession_enabled', 1);
    setGuildConfig('G1', 'confession_channel_id', 'AUTRE'); // réglage forgé depuis le tableau de bord
    const it = await confesser('u1', 'pub pour mon serveur discord.gg/xxx');
    V('/confession : rien n\'est écrit dans le salon de G2', SALONS.AUTRE.envois.length === 0, texte(SALONS.AUTRE.envois));
    V('… l\'auteur lit que le salon est inaccessible', /salon des confessions/.test(contenu(it)) && !/publiée/.test(contenu(it)), contenu(it));
    V('… et la confession ne reste pas en base', !derniereDe('u1'));
    // Sans le serveur en cache : le contrôle du serveur du salon suffit.
    const seul = { ...client, guilds: { cache: new Map() } };
    const r = await C.publier(seul, { id: 0, guild_id: 'G1', channel_id: 'AUTRE', texte: 'x' });
    V('publier() : salon d\'un autre serveur → { ok:false, raison:"salon" }, même sans cache', r.ok === false && r.raison === 'salon' && SALONS.AUTRE.envois.length === 0, texte(r));
    const r2 = await C.publier(client, { id: 0, guild_id: 'G1', channel_id: 'INCONNU', texte: 'x' });
    V('publier() : salon inexistant → raison "salon"', r2.ok === false && r2.raison === 'salon');
  }

  console.log('\n8) Publier au QG après la fermeture des confessions');
  {
    setGuildConfig('G1', 'confession_channel_id', 'CONF1');
    setHq('GQ', 'QG');
    const a2 = nouveau();
    await confesser(a2, 'quel connard ce prof');
    const id = derniereDe(a2).id;
    V('la confession signalée attend au QG', SALONS.QG.envois.length === 1 && ligne(id).statut === 'en_revue');

    setGuildConfig('G1', 'confession_enabled', 0);
    let it = await cliquer('CREA', 'pub', id);
    V('module coupé → réponse privée « fermé ses confessions »', /fermé ses confessions/.test(contenu(it)) && it.reponses[0]?.flags === 64, contenu(it));
    V('… rien publié, statut inchangé', SALONS.CONF1.envois.length === 0 && ligne(id).statut === 'en_revue' && !ligne(id).decide_par);

    setGuildConfig('G1', 'confession_enabled', 1);
    setGuildConfig('G1', 'confession_channel_id', null);
    it = await cliquer('CREA', 'pub', id);
    V('salon retiré → même refus, statut inchangé', /fermé ses confessions/.test(contenu(it)) && ligne(id).statut === 'en_revue');

    setGuildConfig('G1', 'confession_channel_id', 'CONF1B');
    it = await cliquer('CREA', 'pub', id);
    V('salon changé → publiée dans le salon ACTUEL', SALONS.CONF1B.envois.length === 1 && SALONS.CONF1.envois.length === 0, texte(it.mises[0]).slice(0, 200));
    V('… et la base le sait', ligne(id).statut === 'publiee' && ligne(id).channel_id === 'CONF1B' && ligne(id).numero === 1, texte(ligne(id)));

    setGuildConfig('G1', 'confession_channel_id', 'AUTRE');
    const a3 = nouveau();
    await confesser(a3, 'quel connard ce voisin');
    const id2 = derniereDe(a3).id;
    it = await cliquer('CREA', 'pub', id2);
    V('salon actuel dans un autre serveur → refus, la confession reste en attente', SALONS.AUTRE.envois.length === 0 && ligne(id2).statut === 'en_revue' && ligne(id2).numero === null, contenu(it));
    setGuildConfig('G1', 'confession_channel_id', 'CONF1');
  }

  console.log('\n9) Blacklister et publier en même temps');
  {
    // a) la blacklist d'abord (lente : un ban par serveur), « Publier » 50 ms après
    await confesser('x', 'quel connard ce prof de maths');
    const id = derniereDe('x').id;
    const avant = SALONS.CONF1.envois.length;
    G1.delaiBan = G2.delaiBan = 200;
    const ban = cliquer('CREA', 'banok', id);
    await attendre(50);
    const pub = await cliquer('CREA', 'pub', id);
    const itBan = await ban;
    G1.delaiBan = G2.delaiBan = 0;
    V('« Publier » pendant la blacklist → déjà traitée, rien publié', SALONS.CONF1.envois.length === avant && /Déjà traitée|autre membre/.test(contenu(pub)), contenu(pub));
    V('… la blacklist aboutit et la carte dit vrai', ligne(id).statut === 'blacklist' && /Auteur blacklisté/.test(texte(itBan.mises[0])), texte(itBan.mises[0]));

    // b) « Publier » d'abord (envoi lent), la blacklist 50 ms après
    await confesser('y', 'quel connard ce chef');
    const id2 = derniereDe('y').id;
    SALONS.CONF1.delai = 200;
    const nbBans = bans.length;
    const pub2 = cliquer('CREA', 'pub', id2);
    await attendre(50);
    const itBan2 = await cliquer('CREA', 'banok', id2);
    await pub2;
    SALONS.CONF1.delai = 0;
    V('blacklist pendant la publication → « Déjà traitée », personne banni', /Déjà traitée/.test(texte(itBan2.mises[0])) && bans.length === nbBans, texte(itBan2.mises[0]));
    V('… la confession est publiée et marquée publiée', ligne(id2).statut === 'publiee' && ligne(id2).message_id);

    // c) deux blacklists cliquées ensemble : un seul ban par serveur
    await confesser('z', 'quel connard ce gars');
    const id3 = derniereDe('z').id;
    G1.delaiBan = 100;
    const nb3 = bans.length;
    const [b1, b2] = await Promise.all([cliquer('CREA', 'banok', id3), cliquer('CREA', 'banok', id3)]);
    G1.delaiBan = 0;
    V('deux confirmations simultanées → une seule blacklist', bans.length - nb3 === 2 && [b1, b2].filter((b) => /Déjà traitée/.test(texte(b.mises[0]))).length === 1, `${bans.length - nb3} bans`);

    // d) auteur immunisé sur une confession refusée : elle REDEVIENT refusée
    const crea = C.enregistrer({ guild: G1, salonId: 'CONF1', auteur: USERS.CREA, texte: 'quel connard', categories: ['insulte'], statut: 'en_revue' });
    await cliquer('CREA', 'del', crea.id);
    const itImm = await cliquer('CREA', 'banok', crea.id);
    V('immunisé → blacklist refusée, statut d\'avant rendu (refusée)', /immunisé/.test(texte(itImm.mises[0])) && ligne(crea.id).statut === 'refusee', ligne(crea.id).statut);

    // e) la blacklist échoue : la confession revient en attente
    const vraie = TeamBot.applyBlacklist;
    TeamBot.applyBlacklist = async () => { throw new Error('base verrouillée'); };
    const a4 = nouveau();
    await confesser(a4, 'quel connard ce mec');
    const id5 = derniereDe(a4).id;
    const itKo = await cliquer('CREA', 'banok', id5);
    TeamBot.applyBlacklist = vraie;
    V('échec de la blacklist → message clair, retour « en attente »', /La blacklist a échoué : base verrouillée/.test(texte(itKo.mises[0])) && ligne(id5).statut === 'en_revue' && !ligne(id5).decide_par, ligne(id5).statut);
    const itPub5 = await cliquer('CREA', 'pub', id5);
    V('… et on peut encore la publier', ligne(id5).statut === 'publiee', contenu(itPub5));
  }

  console.log('\n10) Raison du ban : neutre sur les serveurs, référence gardée en interne');
  {
    const id = derniereDe('x').id;
    const deX = bans.filter((b) => b.userId === 'x');
    V('banni sur les deux serveurs du bot', deX.length === 2 && deX.some((b) => b.guild === 'G1') && deX.some((b) => b.guild === 'G2'), texte(deX));
    V('raison visible : « Blacklist du bot : Décision du staff du bot »', deX.every((b) => b.reason === `Blacklist du bot : ${C.RAISON_BAN}`) && C.RAISON_BAN === 'Décision du staff du bot', texte(deX));
    V('… aucun mot sur la confession, aucun numéro', deX.every((b) => !/onfession|n°|#|\d/.test(b.reason)));
    const bl = TeamBot.getBlacklistRow.get('x');
    V('blacklist (relue au retour sur un serveur) : raison neutre', bl?.reason === C.RAISON_BAN, texte(bl));
    const hist = db.prepare("SELECT * FROM blacklist_history WHERE user_id = 'x' AND action = 'blacklist'").get();
    V('historique interne : la preuve cite la confession', hist && new RegExp(`Confession #${id}`).test(hist.proof) && /Labo RP/.test(hist.proof) && /connard ce prof/.test(hist.proof), texte(hist));
    const mp = USERS.x.dms.find((m) => m.embeds);
    V('le MP de blacklist ne cite pas non plus de numéro trompeur', mp && !/n°/.test(texte(mp)), texte(mp).slice(0, 300));
  }

  console.log('\n11) Numéros : jamais deux fois le même');
  {
    const max = () => db.prepare("SELECT COALESCE(MAX(numero), 0) AS n FROM confessions WHERE guild_id = 'G1'").get().n;
    const depart = max();
    SALONS.CONF1.delai = 150;
    const [a, b] = await Promise.all([confesser(nouveau(), 'j\'ai un crush sur quelqu\'un'), confesser(nouveau(), 'j\'ai menti à ma mère')]);
    SALONS.CONF1.delai = 0;
    const n = (it) => Number((contenu(it).match(/n°(\d+)/) || [])[1]);
    V('deux /confession simultanées → deux numéros distincts', n(a) && n(b) && n(a) !== n(b), `${n(a)} / ${n(b)}`);
    const titres = SALONS.CONF1.envois.slice(-2).map(titre);
    V('… et deux titres distincts dans le salon', titres.length === 2 && titres[0] !== titres[1], texte(titres));
    V('… qui suivent le dernier numéro', [n(a), n(b)].sort().join() === `${depart + 1},${depart + 2}`, `${depart} → ${n(a)}, ${n(b)}`);

    // une confession propre et un « Publier » du QG au même moment
    const a7 = nouveau();
    await confesser(a7, 'quel connard ce collègue');
    const idQg = derniereDe(a7).id;
    SALONS.CONF1.delai = 150;
    const [itPropre, itQg] = await Promise.all([confesser(nouveau(), 'je kiffe le cours de SVT'), cliquer('CREA', 'pub', idQg)]);
    SALONS.CONF1.delai = 0;
    const numQg = ligne(idQg).numero, numPropre = n(itPropre);
    V('confession propre + publication du QG simultanées → numéros distincts', numQg && numPropre && numQg !== numPropre, `${numQg} / ${numPropre} ${contenu(itQg).slice(0, 80)}`);
    const dupes = db.prepare("SELECT numero, COUNT(*) AS c FROM confessions WHERE guild_id = 'G1' AND numero IS NOT NULL GROUP BY numero HAVING c > 1").all();
    V('aucun numéro en double en base', dupes.length === 0, texte(dupes));

    // un envoi qui échoue libère son numéro
    const avant = max();
    SALONS.CONF1.panne = true;
    const echec = await confesser(nouveau(), 'une confession qui ne partira pas');
    SALONS.CONF1.panne = false;
    V('envoi refusé → l\'auteur sait quoi faire, numéro libéré', /permission/.test(contenu(echec)) && max() === avant, `${contenu(echec)} max=${max()}`);
    await confesser(nouveau(), 'il fait beau aujourd\'hui');
    V('… la suivante prend le numéro suivant, sans trou', max() === avant + 1, String(max()));
    const a9 = nouveau();
    await confesser(a9, 'quel connard ce passant');
    const idPanne = derniereDe(a9).id;
    SALONS.CONF1.panne = true;
    const itPanne = await cliquer('CREA', 'pub', idPanne);
    SALONS.CONF1.panne = false;
    V('publication du QG refusée → reste en attente, sans numéro', ligne(idPanne).statut === 'en_revue' && ligne(idPanne).numero === null && /reste en attente/.test(contenu(itPanne)), texte(ligne(idPanne)));
  }

  console.log('\n12) /confession répond en moins de 3 secondes, en privé');
  {
    let it = await confesser(nouveau(), 'je kiffe la cantine');
    V('envoi rapide → une seule réponse, par reply (donc une carte), sans différé', it.appels.map((a) => a[0]).join() === 'reply' && /publiée anonymement/.test(contenu(it)), it.appels.map((a) => a[0]).join());
    SALONS.CONF1.delai = 2600;
    const debut = Date.now();
    it = await confesser(nouveau(), 'je kiffe le CDI');
    SALONS.CONF1.delai = 0;
    const etapes = it.appels.map((a) => a[0]).join();
    const differe = it.appels.find((a) => a[0] === 'deferReply');
    V('envoi lent → réponse différée AVANT 3 s, puis complétée', etapes === 'deferReply,editReply' && /n°\d+/.test(texte(it.reponses[0])), etapes);
    V('… le différé est éphémère (la commande n\'est pas publique)', differe?.[1]?.flags === 64 && !CONF.public, texte(differe));
    V('… et la confession est bien partie une seule fois', SALONS.CONF1.envois.filter((m) => /CDI/.test(texte(m))).length === 1 && Date.now() - debut >= 2600);
    setHq('GQ', 'QG');
    SALONS.QG.delai = 2600;
    it = await confesser(nouveau(), 'je veux mourir');
    SALONS.QG.delai = 0;
    V('signalée et QG lent → différé éphémère, le 3114 arrive quand même', it.appels[0]?.[0] === 'deferReply' && it.appels[0]?.[1]?.flags === 64 && /3114/.test(texte(it.reponses[0])), it.appels.map((a) => a[0]).join());
  }
}
