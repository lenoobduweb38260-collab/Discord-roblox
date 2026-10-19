// 💘 /lc, 💍 /mariage et 💌 /confession — images, tirages, couples, détection,
// publication anonyme et relecture au QG du staff du bot.
const path = require('path');
const fs = require('fs');
const os = require('os');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-mariage-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');
process.env.OWNER_ID = 'CREA';
delete process.env.GIPHY_KEY;

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  return vrai.apply(this, arguments);
};

const { db, setGuildConfig, getGuildConfig } = require('../src/database');
const IMG = require('../src/utils/imageAmour');
const LC = require('../src/commands/lc');
const MAR = require('../src/commands/mariage');
const CONF = require('../src/commands/confession');
const C = require('../src/utils/confessions');
const { setHq } = require('../src/utils/botTickets');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };
const texte = (o) => JSON.stringify(o, (k, v) => (Buffer.isBuffer(v) ? `<png ${v.length}>` : v));
const warnOrig = console.warn;
console.warn = () => {};

// Le réseau : aucun avatar ni GIF joignable (rendu avec les initiales).
const vraiFetch = global.fetch;
global.fetch = async () => ({ ok: false, status: 404 });

// ── Faux Discord ────────────────────────────────────────────────────────
const personne = (id, nom, bot = false) => ({
  id, username: nom, displayName: nom, globalName: nom, bot, tag: `${nom}#0`,
  displayAvatarURL: () => `https://cdn.test/${id}.png`,
  dms: [], async send(m) { this.dms.push(m); return {}; },
});
const USERS = {
  u1: personne('u1', 'Alice'), u2: personne('u2', 'Bob'), u3: personne('u3', 'Chloé'),
  b1: personne('b1', 'RoboBot', true), CREA: personne('CREA', 'Créateur'), staff: personne('staff', 'Modo'),
};
function salon(id) {
  return {
    id, envois: [], isTextBased: () => true, guild: null,
    async send(m) { const msg = { id: `m${this.envois.length + 1}-${id}`, url: `https://discord.com/channels/G1/${id}/m${this.envois.length + 1}`, ...m }; this.envois.push(m); return msg; },
    messages: { fetch: async () => null },
  };
}
const SALONS = { CONF: salon('CONF'), QG: salon('QG'), LOGS: salon('LOGS') };
const client = {
  user: { id: 'bot' },
  application: { fetch: async () => ({ owner: { id: 'CREA' } }) },
  users: { fetch: async (id) => USERS[id] || null },
  channels: { fetch: async (id) => SALONS[id] || null },
  guilds: { cache: new Map() },
};
const membres = (ids) => new Map(ids.map((id) => [id, { id, user: USERS[id], displayName: USERS[id].displayName }]));
const guild = { id: 'G1', name: 'Labo RP', members: { cache: membres(['u1', 'u2', 'b1']), fetch: async () => null }, channels: { fetch: async (id) => SALONS[id] || null } };
SALONS.CONF.guild = guild;

function fausse({ user = 'u1', sub = null, strings = {}, users = {}, customId, message } = {}) {
  const it = {
    client, guild, guildId: 'G1', locale: 'fr', customId, user: USERS[user],
    deferred: false, replied: false,
    message: message || { components: [], embeds: [{}], flags: 0, createdTimestamp: Date.now() },
    inGuild: () => true,
    options: {
      getSubcommand: () => sub,
      getString: (n) => (strings[n] === undefined ? null : strings[n]),
      getUser: (n) => (users[n] ? USERS[users[n]] : null),
    },
    async reply(p) { this.replied = true; this.reponses.push(p); return p; },
    async deferReply() { this.deferred = true; },
    async editReply(p) { this.reponses.push(p); return p; },
    async followUp(p) { this.suivis.push(p); return p; },
    async update(p) { this.replied = true; this.mises.push(p); return p; },
    async deferUpdate() {},
    reponses: [], suivis: [], mises: [],
  };
  return it;
}
const premiere = (it) => it.reponses[0] || {};
const embedDe = (p) => p?.embeds?.[0]?.data || p?.embeds?.[0] || {};

(async () => {
  console.log('\n1) Image : PNG valide, pixels attendus, texte dessinable');
  {
    const t = new IMG.Toile(3, 2);
    t.poser(0, 0, [255, 0, 0]); t.poser(2, 1, [0, 0, 255], 0.5);
    const rond = IMG.decoderPng(t.png());
    V('encoder puis décoder rend les mêmes pixels', rond && rond.largeur === 3 && rond.hauteur === 2 && rond.rgba[0] === 255 && rond.rgba[1] === 0 && rond.rgba[3] === 255);
    V('un PNG invalide se décode en null, sans exception', IMG.decoderPng(Buffer.from('pas une image')) === null && IMG.decoderPng(null) === null);
    const plan = IMG.planAmour({ pourcentage: 140, nomA: 'Émilie✨', nomB: '日本語' });
    V('pourcentage borné à 100', plan.pourcentage === 100 && plan.texte.contenu === '100%');
    V('pseudos ramenés à l\'ASCII, jamais vides', plan.avatars[0].nom === 'EMILIE' && plan.avatars[1].nom === 'MEMBRE', texte(plan.avatars));
    V('un pseudo trop long est coupé proprement', IMG.tronquer('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 3, 230).endsWith('..'));
    const plein = IMG.decoderPng(IMG.dessiner(IMG.planAmour({ pourcentage: 100, nomA: 'A', nomB: 'B' })));
    const vide = IMG.decoderPng(IMG.dessiner(IMG.planAmour({ pourcentage: 0, nomA: 'A', nomB: 'B' })));
    const px = (img, x, y) => { const i = (y * img.largeur + x) * 4; return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]]; };
    V('image de 900×360', plein.largeur === 900 && plein.hauteur === 360);
    // Bas du cœur (au-dessus de la pointe) : rouge quand c'est plein, sombre à 0 %.
    const [r1, g1] = px(plein, 450, 228), [r0, g0, b0] = px(vide, 450, 228);
    V('à 100 %, le cœur est rempli de rouge', r1 > 150 && g1 < 120, `${r1},${g1}`);
    V('à 0 %, le cœur reste sombre', r0 < 80 && g0 < 40 && b0 < 80, `${r0},${g0},${b0}`);
    V('jauge : pleine à 100 %, vide à 0 % (bout droit)', px(plein, 870 - 120 - 20, 313)[0] > 150 && px(vide, 870 - 120 - 20, 313)[0] < 200);
    const mariage = IMG.decoderPng(IMG.dessiner(IMG.planMariage({ nomA: 'A', nomB: 'B', date: '19.10.2026' })));
    V('image de mariage : 900×360 avec des alliances dorées au centre', mariage?.largeur === 900 && px(mariage, 450 + 23, 150 - 62 + 7)[0] > 180, texte(px(mariage, 473, 95)));
    const rendu = await IMG.fabriquer(IMG.planAmour({ pourcentage: 50, nomA: 'A', nomB: 'B' }), [USERS.u1, USERS.u2]);
    V('avatars introuvables : l\'image part quand même (initiales)', Buffer.isBuffer(rendu) && IMG.decoderPng(rendu)?.largeur === 900);
  }

  console.log('\n2) /lc : pourcentage du jour, partenaire au hasard, carte');
  {
    const jour = new Date('2026-10-19T10:00:00Z');
    const p = LC.pourcentageDuJour('u1', 'u2', jour);
    V('entre 0 et 100', p >= 0 && p <= 100);
    V('même duo, même jour → même résultat, dans les deux sens', LC.pourcentageDuJour('u2', 'u1', jour) === p && LC.pourcentageDuJour('u1', 'u2', new Date('2026-10-19T23:00:00Z')) === p);
    const jours = new Set(Array.from({ length: 30 }, (_, k) => LC.pourcentageDuJour('u1', 'u2', new Date(Date.UTC(2026, 9, k + 1)))));
    V('… et il change d\'un jour à l\'autre', jours.size > 10, String(jours.size));
    V('verdicts : 100 = parfait, 0 = glacial', /parfait/.test(LC.verdict(100)) && /Glacial/.test(LC.verdict(0)) && /complicit/.test(LC.verdict(55)));

    const tirages = new Set();
    for (let k = 0; k < 30; k++) tirages.add((await LC.membreAuHasard(fausse({ user: 'u1' })))?.id);
    V('tirage au sort : jamais un bot ni soi-même', [...tirages].every((id) => id === 'u2'), [...tirages].join());

    let it = fausse({ users: { membre: 'b1' } });
    await LC.execute(it);
    V('un bot choisi → refus éphémère', premiere(it).flags === 64 && /bots/.test(premiere(it).content));
    it = fausse({ users: { membre: 'u1' } });
    await LC.execute(it);
    V('soi-même → refus éphémère', premiere(it).flags === 64);

    it = fausse({ users: { membre: 'u2' } });
    await LC.execute(it);
    let r = premiere(it);
    const e = embedDe(r);
    V('membre choisi : carte avec l\'image lc.png', e.image?.url === 'attachment://lc.png' && r.files?.[0]?.name === 'lc.png' && Buffer.isBuffer(r.files[0].data), texte(r).slice(0, 300));
    V('… le pourcentage écrit en grand dans la carte', new RegExp(`## ${LC.pourcentageDuJour('u1', 'u2')} %`).test(e.description), e.description);
    V('… et la personne choisie est mentionnée', r.content === '<@u2>');

    it = fausse({});
    await LC.execute(it);
    r = premiere(it);
    V('sans membre : partenaire tiré au sort, annoncé, sans mention', /tiré au sort/.test(embedDe(r).description) && !r.content, texte(r).slice(0, 200));
    const seul = { ...guild, members: { cache: membres(['u1', 'b1']), fetch: async () => null } };
    it = fausse({}); it.guild = seul;
    await LC.execute(it);
    V('personne d\'autre à tirer → message clair, éphémère', premiere(it).flags === 64 && /Personne/.test(premiere(it).content), texte(premiere(it)));
  }

  console.log('\n3) /mariage : demande, réponse, statut, divorce');
  {
    let it = fausse({ sub: 'demander', users: { membre: 'u1' } });
    await MAR.execute(it);
    V('s\'épouser soi-même → refus', premiere(it).flags === 64);
    it = fausse({ sub: 'demander', users: { membre: 'b1' } });
    await MAR.execute(it);
    V('épouser un bot → refus', premiere(it).flags === 64 && /bots/.test(premiere(it).content));

    it = fausse({ sub: 'demander', users: { membre: 'u2' } });
    await MAR.execute(it);
    const demande = premiere(it);
    const ids = texte(demande);
    V('demande : la personne demandée est mentionnée, boutons oui/non', demande.content === '<@u2>' && ids.includes('mar:oui:u1:u2') && ids.includes('mar:non:u1:u2'), ids.slice(0, 300));

    it = fausse({ user: 'u3', customId: 'mar:oui:u1:u2' });
    await MAR.handleButton(it);
    V('un tiers ne peut pas répondre', it.reponses[0]?.flags === 64 && !MAR.mariageDe('u1'));

    it = fausse({ user: 'u2', customId: 'mar:oui:u1:u2', message: { components: [], embeds: [{}], flags: 0, createdTimestamp: Date.now() - MAR.EXPIRATION - 1000 } });
    await MAR.handleButton(it);
    V('demande expirée → refus, pas de mariage', !MAR.mariageDe('u1') && /expiré/.test(texte(it.suivis[0] || it.reponses[0])));

    it = fausse({ user: 'u2', customId: 'mar:oui:u1:u2' });
    await MAR.handleButton(it);
    const fete = it.suivis[0] || {};
    V('« oui » : le mariage est enregistré', MAR.mariageDe('u1')?.conjoint === 'u2' && MAR.mariageDe('u2')?.conjoint === 'u1');
    V('… les boutons de la demande sont retirés', texte(it.mises[0]).includes('"components":[]'), texte(it.mises[0]));
    V('… carte des mariés : les deux mentionnés, image des alliances (sans clé GIPHY)', fete.content === '<@u1> <@u2>' && embedDe(fete).image?.url === 'attachment://mariage.png' && fete.files?.[0]?.name === 'mariage.png', texte(fete).slice(0, 300));

    it = fausse({ sub: 'demander', users: { membre: 'u3' } });
    await MAR.execute(it);
    V('déjà marié·e → impossible de redemander', premiere(it).flags === 64 && /déjà marié/.test(premiere(it).content));
    it = fausse({ user: 'u3', sub: 'demander', users: { membre: 'u2' } });
    await MAR.execute(it);
    V('demander quelqu\'un de déjà marié → refus', premiere(it).flags === 64);

    it = fausse({ user: 'u3', sub: 'statut', users: { membre: 'u1' } });
    await MAR.execute(it);
    V('statut : « marié·e à Bob depuis … »', /marié·e à \*\*Bob\*\*/.test(embedDe(premiere(it)).description), embedDe(premiere(it)).description);

    it = fausse({ user: 'u1', sub: 'divorcer' });
    await MAR.execute(it);
    V('divorcer : confirmation éphémère avec bouton', premiere(it).flags === 64 && texte(premiere(it)).includes('mar:div:u1:u2'));
    it = fausse({ user: 'u3', customId: 'mar:div:u1:u2' });
    await MAR.handleButton(it);
    V('un tiers ne prononce pas le divorce', MAR.mariageDe('u1') && it.reponses[0]?.flags === 64);
    it = fausse({ user: 'u1', customId: 'mar:div:u1:u2' });
    await MAR.handleButton(it);
    V('divorce prononcé et annoncé', !MAR.mariageDe('u1') && !MAR.mariageDe('u2') && /divorcé/.test(texte(it.suivis[0])));

    it = fausse({ user: 'u2', customId: 'mar:non:u1:u2' });
    await MAR.handleButton(it);
    V('« refuser » : pas de mariage, annonce sans mention qui sonne', !MAR.mariageDe('u1') && /décliné/.test(texte(it.suivis[0])) && it.suivis[0].allowedMentions?.parse?.length === 0);
  }

  console.log('\n4) Détection des confessions à relire');
  {
    const cat = (t) => C.detecter(t).categories.join(',');
    const signales = [
      ['Je veux me suicider ce soir', 'suicide'], ['j\'ai envie de mourir', 'suicide'], ['plus envie de vivre', 'suicide'],
      ['je me scarifie depuis un mois', 'suicide'], ['I want to die', 'suicide'],
      ['je vais te tuer demain', 'menace'], ['t\'es mort toi', 'menace'], ['je sais où tu habites', 'menace'],
      ['quel connard ce prof', 'insulte'], ['espèce de s4l0p3', 'insulte'], ['c o n n a r d', 'insulte'], ['connaaaard', 'insulte'],
      ['fdp va', 'insulte'], ['Nique ta mère', 'insulte'],
    ];
    for (const [phrase, attendu] of signales) V(`« ${phrase} » → ${attendu}`, cat(phrase).includes(attendu), cat(phrase));
    const propres = [
      'J\'ai tué le temps en jouant', 'je suis mort de rire', 't\'es mort de rire là', 'ce film est une bombe',
      'je kiffe trop ma voisine', 'putain que je t\'aime', 'on a tué la soirée hier', 'la mort de mon chat m\'a rendu triste',
      'j\'ai un crush sur quelqu\'un du serveur', 'mon pote est trop con parfois haha',
    ];
    for (const phrase of propres) V(`« ${phrase} » → rien`, cat(phrase) === '', cat(phrase));
    V('extraits relevés pour le staff', C.detecter('je vais te tuer, connard').extraits.length >= 2);
  }

  console.log('\n5) /confession : fermée, publiée anonymement, attente');
  {
    let it = fausse({ strings: { texte: 'coucou' } });
    await CONF.execute(it);
    V('pas de salon réglé → message qui dit quoi faire', /Communauté/.test(premiere(it).content) && SALONS.CONF.envois.length === 0);

    setGuildConfig('G1', 'confession_enabled', 1);
    setGuildConfig('G1', 'confession_channel_id', 'CONF');
    it = fausse({ strings: { texte: 'J\'ai un crush sur @everyone du serveur' } });
    await CONF.execute(it);
    const pub = SALONS.CONF.envois[0] || {};
    V('propre → publiée dans le salon, n°1', embedDe(pub).title === '💌 Confession n°1' && /crush/.test(embedDe(pub).description), texte(pub).slice(0, 200));
    V('… sans aucune trace de l\'auteur', !texte(pub).includes('u1') && !texte(pub).includes('Alice'));
    V('… et sans faire sonner personne', Array.isArray(pub.allowedMentions?.parse) && pub.allowedMentions.parse.length === 0);
    V('l\'auteur reçoit le lien de sa confession', /n°1/.test(premiere(it).content) && /https:\/\//.test(premiere(it).content));

    it = fausse({ strings: { texte: 'encore une' } });
    await CONF.execute(it);
    V('une confession par minute', /par minute/.test(premiere(it).content) && SALONS.CONF.envois.length === 1);

    it = fausse({ user: 'u2', strings: { texte: 'je vais te tuer' } });
    await CONF.execute(it);
    V('signalée sans QG réglé → PAS publiée, et l\'auteur le sait', SALONS.CONF.envois.length === 1 && /pas\*\* publiée/.test(premiere(it).content), premiere(it).content);

    setHq('QGG', 'QG');
    it = fausse({ user: 'u3', strings: { texte: 'je veux me suicider' } });
    await CONF.execute(it);
    V('détresse : l\'auteur reçoit tout de suite le 3114', /3114/.test(premiere(it).content) && /relue/.test(premiere(it).content), premiere(it).content);
    const carte = SALONS.QG.envois[0] || {};
    const ct = texte(carte);
    V('… la carte part au QG, pas sur le serveur', SALONS.QG.envois.length === 1 && SALONS.CONF.envois.length === 1);
    V('… avec l\'auteur (confidentiel), la catégorie et le texte', ct.includes('u3') && /Détresse/.test(ct) && /suicider/.test(ct), ct.slice(0, 400));
    V('… et les boutons Publier / Refuser / Blacklister / Aide', ['cfs:pub:', 'cfs:del:', 'cfs:ban:', 'cfs:aide:'].every((p) => ct.includes(p)));
  }

  console.log('\n6) Relecture au QG : droits, publication unique, refus, aide');
  {
    const id = db.prepare("SELECT id FROM confessions WHERE author_id = 'u3'").get().id;
    let it = fausse({ user: 'u1', customId: `cfs:pub:${id}` });
    await C.handleButton(it);
    V('sans permission → refus, rien publié', it.reponses[0]?.flags === 64 && SALONS.CONF.envois.length === 1);

    it = fausse({ user: 'CREA', customId: `cfs:aide:${id}` });
    await C.handleButton(it);
    V('« aide » : message privé avec le 3114 à l\'auteur', USERS.u3.dms.some((m) => /3114/.test(m.content)));

    it = fausse({ user: 'CREA', customId: `cfs:pub:${id}` });
    await C.handleButton(it);
    V('publier : la confession part dans le salon d\'origine, n°2', embedDe(SALONS.CONF.envois[1]).title === '💌 Confession n°2', texte(SALONS.CONF.envois[1]).slice(0, 120));
    V('… la carte du QG perd ses boutons et dit « Publiée »', texte(it.mises[0]).includes('"components":[]') && /Publiée/.test(texte(it.mises[0])));
    V('… et l\'auteur est prévenu en privé', USERS.u3.dms.some((m) => /publiée \(n°2\)/.test(m.content)));
    it = fausse({ user: 'CREA', customId: `cfs:pub:${id}` });
    await C.handleButton(it);
    V('second clic : déjà traitée, rien de plus', SALONS.CONF.envois.length === 2 && /Déjà traitée/.test(texte(it.reponses[0])));

    const autre = C.enregistrer({ guild, salonId: 'CONF', auteur: USERS.u2, texte: 'quel connard', categories: ['insulte'], statut: 'en_revue' });
    it = fausse({ user: 'CREA', customId: `cfs:del:${autre.id}` });
    await C.handleButton(it);
    V('refuser : statut refusée, rien publié, auteur prévenu', C.lire.get(autre.id).statut === 'refusee' && SALONS.CONF.envois.length === 2 && USERS.u2.dms.some((m) => /pas été publiée/.test(m.content)));

    const crea = C.enregistrer({ guild, salonId: 'CONF', auteur: USERS.CREA, texte: 'quel connard', categories: ['insulte'], statut: 'en_revue' });
    it = fausse({ user: 'CREA', customId: `cfs:ban:${crea.id}` });
    await C.handleButton(it);
    V('blacklister : une confirmation est demandée d\'abord', it.reponses[0]?.flags === 64 && texte(it.reponses[0]).includes(`cfs:banok:${crea.id}`));
    it = fausse({ user: 'CREA', customId: `cfs:banok:${crea.id}` });
    await C.handleButton(it);
    V('auteur immunisé → blacklist refusée, expliquée', /immunisé/.test(texte(it.mises[0])) && C.lire.get(crea.id).statut === 'en_revue', texte(it.mises[0]));
  }

  console.log('\n7) Branchements : /config, routage, guide, dashboard');
  {
    const P = require('../src/utils/configPanel');
    const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const panneau = src('src/utils/configPanel.js');
    V('/config : catégorie Communauté avec interrupteurs et salon des confessions', /value: 'communaute'/.test(panneau) && /cfgconfsalon/.test(panneau) && /cfgconfon/.test(panneau) && /communaute: communauteView/.test(panneau));
    V('… les bascules Interactions et SAO reviennent sur cette vue', (panneau.match(/mettreAJour\(interaction, communauteView\(interaction.guild\)\)/g) || []).length >= 4);
    V('réglages en base : confession_enabled et confession_channel_id', 'confession_enabled' in getGuildConfig('ZZ') && 'confession_channel_id' in getGuildConfig('ZZ'));
    const routeur = src('src/events/interactionCreate.js');
    V('routage des boutons mar: (module revérifié) et cfs:', /startsWith\('mar:'\)[\s\S]{0,300}interact_enabled/.test(routeur) && /startsWith\('cfs:'\)/.test(routeur));
    V('libellé du module Confessions', /confession: 'Confessions'/.test(routeur));
    V('guide : lc, mariage et confession rangés dans Communauté', /'lc', 'mariage', 'confession'/.test(src('src/utils/tutoriel.js')));
    V('API du dashboard : les deux réglages sont acceptés', /confession_enabled: 'b'/.test(src('src/managedApi.js')) && /confession_channel_id: 's'/.test(src('src/managedApi.js')));
    const app = src('site-php/assets/js/app.js');
    V('dashboard : salon et interrupteur des confessions', /champSalon\("confession_channel_id"/.test(app) && /champBascule\("confession_enabled"/.test(app));
    V('dashboard : un salon choisi dans un sélecteur est enfin enregistré', /querySelectorAll\("\[data-picker\]"\)/.test(app) && /data-mode="\$\{mode\}"/.test(app));
    V('modules : /lc et /mariage dans Interactions, /confession dans Confessions', LC.guildModule === 'interact' && MAR.guildModule === 'interact' && CONF.guildModule === 'confession');
    V('/lc et /mariage publics, /confession privée', LC.public === true && MAR.public === true && !CONF.public);
    V('le panneau se charge', typeof P.handleConfigInteraction === 'function');
  }

  console.warn = warnOrig;
  global.fetch = vraiFetch;
  console.log(`\n${ok} réussis, ${ko} échoués`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.warn = warnOrig; console.error(e); console.log('\n0 réussis, 1 échoués'); process.exit(1); });
