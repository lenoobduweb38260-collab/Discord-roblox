// 🎙️ La file d'attente vocale du staff, et les salons vocaux personnels.
const fs = require('fs');
const os = require('os');
const path = require('path');
const AIDES = path.join(__dirname, 'aides');

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'vocal-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  return vrai.apply(this, arguments);
};

const { PermissionFlagsBits } = require(path.join(AIDES, 'stub-discord.js'));
const { db, setGuildConfig } = require('../src/database');
const alerte = require('../src/utils/vocalAlerte');
const perso = require('../src/utils/salonsPerso');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

// Le bit → son nom d'édition : ce que le vrai discord.js fait tout seul.
const NOMS = new Map([
  [PermissionFlagsBits.Stream, 'Stream'],
  [PermissionFlagsBits.ViewChannel, 'ViewChannel'],
  [PermissionFlagsBits.Connect, 'Connect'],
  [PermissionFlagsBits.SetVoiceChannelStatus, 'SetVoiceChannelStatus'],
]);

let compteurSalon = 0;
let compteurMessage = 0;
function fauxMonde() {
  const salons = new Map();
  const membres = new Map();
  const guild = {
    id: 'G1', name: 'Labo',
    roles: { everyone: { id: 'EVERYONE' } },
    members: {
      me: { permissions: { has: () => true } },
      fetch: async (id) => membres.get(String(id)) || null,
    },
    channels: {
      fetch: async (id) => salons.get(String(id)) || null,
      create: async (opts) => {
        const salon = fauxVocal(`V${++compteurSalon}`, guild, opts);
        for (const sur of opts.permissionOverwrites || []) {
          await salon.permissionOverwrites.edit(sur.id, Object.fromEntries((sur.allow || []).map((b) => [NOMS.get(b), true])));
        }
        salons.set(salon.id, salon);
        return salon;
      },
    },
  };
  function fauxVocal(id, g, opts = {}) {
    const surcharges = new Map();
    const envois = [];
    const messages = new Map();
    const salon = {
      id, guild: g, name: opts.name || id, parentId: opts.parent ?? null,
      supprime: false,
      members: new Map(),
      envois,
      isTextBased: () => true,
      messages: { fetch: async (mid) => messages.get(String(mid)) || null },
      async send(m) {
        envois.push(m);
        const msg = {
          id: `MSG${++compteurMessage}`, flags: 0, edits: [], supprime: false,
          async edit(e) { this.edits.push(e); return this; },
          async delete() { this.supprime = true; return this; },
        };
        messages.set(msg.id, msg);
        return msg;
      },
      async delete() { this.supprime = true; salons.delete(String(id)); return this; },
      permissionOverwrites: {
        cache: surcharges,
        async edit(cible, perms) {
          const cle = String(typeof cible === 'object' ? cible.id : cible);
          const etat = surcharges.get(cle) || { refus: new Set(), accord: new Set() };
          for (const [nom, v] of Object.entries(perms)) {
            if (v === false) { etat.refus.add(nom); etat.accord.delete(nom); }
            else if (v === true) { etat.accord.add(nom); etat.refus.delete(nom); }
            else { etat.refus.delete(nom); etat.accord.delete(nom); }
          }
          etat.deny = { has: (bit) => etat.refus.has(NOMS.get(bit)) };
          etat.allow = { has: (bit) => etat.accord.has(NOMS.get(bit)) };
          surcharges.set(cle, etat);
          return this;
        },
      },
    };
    return salon;
  }
  function fauxMembre(id, { pseudo = `Membre${id}`, bot = false, staff = false, salon = null } = {}) {
    const membre = {
      id: String(id), displayName: pseudo,
      user: { id: String(id), bot, username: pseudo, tag: `${pseudo}#0` },
      roles: { cache: new Map() },
      permissions: { has: () => staff },
      guild,
      mp: [],
      async send(m) { this.mp.push(m); return {}; },
      voice: {
        channelId: salon ? String(salon.id) : null,
        async setChannel(cible) {
          if (membre.voice.channelId) salons.get(membre.voice.channelId)?.members?.delete(membre.id);
          membre.voice.channelId = cible ? String(cible.id ?? cible) : null;
          if (cible) salons.get(String(cible.id ?? cible))?.members?.set(membre.id, membre);
          return membre;
        },
      },
    };
    membres.set(String(id), membre);
    if (salon) salon.members.set(membre.id, membre);
    return membre;
  }
  const ajouterSalon = (id, opts) => { const s = fauxVocal(id, guild, opts); salons.set(String(id), s); return s; };
  const client = { guilds: { cache: new Map([['G1', guild]]) }, channels: { fetch: async (id) => salons.get(String(id)) || null } };
  return { guild, salons, membres, fauxMembre, ajouterSalon, client };
}

(async () => {
  console.log('\n1) La file d\'attente : le ticket s\'ouvre, sonne, se prend en charge et se clôt');
  {
    const monde = fauxMonde();
    const attente = monde.ajouterSalon('ATTENTE');
    const aide1 = monde.ajouterSalon('AIDE1');
    monde.ajouterSalon('AIDE2');
    const texte = monde.ajouterSalon('ALERTE');
    setGuildConfig('G1', 'vocal_attente_channel_id', 'ATTENTE');
    setGuildConfig('G1', 'vocal_alerte_channel_id', 'ALERTE');
    setGuildConfig('G1', 'vocal_assistance_ids', JSON.stringify(['AIDE1', 'AIDE2']));
    setGuildConfig('G1', 'staff_role_ids', JSON.stringify(['R1', 'R2']));

    const arrivant = monde.fauxMembre('U1', { pseudo: 'Bayouss' });
    const etat = (channelId) => ({ guild: monde.guild, member: arrivant, channelId, client: monde.client });

    // — La mécanique du temps, d'abord : c'est elle que la carte affiche.
    V('durée : les secondes seules', alerte.duree(12_000) === '12 s', alerte.duree(12_000));
    V('durée : minutes et secondes', alerte.duree(245_000) === '4 min 05 s', alerte.duree(245_000));
    V('durée : heures et minutes', alerte.duree(3_845_000) === '1 h 04 min', alerte.duree(3_845_000));

    // — Entrer dans le vocal d'attente ouvre un ticket.
    await arrivant.voice.setChannel(attente);
    const envoi = await alerte.surveiller(etat(null), etat('ATTENTE'));
    V('la carte du ticket part dans le salon des annonces', Boolean(texte.envois[0]?.embeds?.length));
    const desc = JSON.stringify(texte.envois[0].embeds[0].data ?? texte.envois[0].embeds[0]);
    V('… elle nomme la personne et dit depuis quand', /U1/.test(desc) && /<t:\d+:R>/.test(desc), desc.slice(0, 140));
    V('le staff est mentionné dans le CONTENU — donc il sonne', texte.envois[0].content === '<@&R1> <@&R2>', texte.envois[0].content);
    V('le bouton « Prendre en charge » est sur la carte', JSON.stringify(texte.envois[0].components || []).includes('va:claim'));
    const ligne = alerte.enAttente.get('G1', 'U1');
    V('l\'attente vit en base, rattachée à son message', Boolean(ligne) && ligne.message_id === envoi.id);

    // — Le claim : refusé aux membres, noté pour le staff.
    const message = await texte.messages.fetch(envoi.id);
    const clicClaim = (user, msg) => ({
      guildId: 'G1', customId: 'va:claim', message: msg,
      user: { id: user.id }, member: user, client: monde.client, guild: monde.guild,
      reponses: [], suites: [],
      replied: false, deferred: false,
      async reply(m) { this.reponses.push(m); this.replied = true; return {}; },
      async followUp(m) { this.suites.push(m); return {}; },
      async update(m) { msg.edits.push(m); this.replied = true; return {}; },
      async deferUpdate() { this.deferred = true; return {}; },
    });

    const quidam = monde.fauxMembre('U2', { pseudo: 'Quidam' });
    const refuse = clicClaim(quidam, message);
    await alerte.handleBouton(refuse);
    V('un membre ordinaire ne prend pas en charge', /⛔/.test(refuse.reponses[0]?.content), refuse.reponses[0]?.content);

    const staffeur = monde.fauxMembre('S1', { pseudo: 'Staffeur', staff: true });
    const clic = clicClaim(staffeur, message);
    await alerte.handleBouton(clic);
    V('le claim du staff est noté en base', alerte.enAttente.get('G1', 'U1')?.claim_par === 'S1');
    V('… la carte rééditée le dit', /S1/.test(JSON.stringify(message.edits)), JSON.stringify(message.edits).slice(0, 140));
    V('… et le staffeur sait quoi faire ensuite', /assistance/.test(clic.suites[0]?.content), clic.suites[0]?.content);

    const reclic = clicClaim(staffeur, message);
    await alerte.handleBouton(reclic);
    V('un second claim informe sans écraser', /Déjà pris en charge/.test(reclic.reponses[0]?.content), reclic.reponses[0]?.content);

    // — Déplacé dans un salon d'assistance : le ticket se referme en « aidé ».
    await arrivant.voice.setChannel(aide1);
    await alerte.surveiller(etat('ATTENTE'), etat('AIDE1'));
    V('déplacé en assistance : le ticket se clôt', !alerte.enAttente.get('G1', 'U1'));
    const finale = JSON.stringify(message.edits[message.edits.length - 1] || {});
    V('… la carte dit l\'assistance terminée', /Assistance terminée/.test(finale), finale.slice(0, 140));
    V('… avec le temps d\'attente', /Temps d\u2019attente|Temps d'attente/.test(finale));
    V('… et le bouton est retiré', !/va:claim/.test(finale));

    // — Partir sans être aidé referme aussi, en le disant.
    await arrivant.voice.setChannel(attente);
    const envoi2 = await alerte.surveiller(etat(null), etat('ATTENTE'));
    const message2 = await texte.messages.fetch(envoi2.id);
    await arrivant.voice.setChannel(null);
    await alerte.surveiller(etat('ATTENTE'), etat(null));
    V('parti sans aide : le ticket se clôt aussi', !alerte.enAttente.get('G1', 'U1'));
    V('… et la carte le dit', /Parti sans être aidé/.test(JSON.stringify(message2.edits)));

    // — Une carte orpheline (sortie ratée) est refermée à la ré-entrée.
    await arrivant.voice.setChannel(attente);
    const envoi3 = await alerte.surveiller(etat(null), etat('ATTENTE'));
    const message3 = await texte.messages.fetch(envoi3.id);
    const envoi4 = await alerte.surveiller(etat(null), etat('ATTENTE')); // la sortie n'a jamais été vue
    V('la vieille attente est refermée, une seule reste',
      Boolean(envoi4) && alerte.enAttente.get('G1', 'U1')?.message_id === envoi4.id);
    V('… et sa carte est soldée', /Parti sans être aidé/.test(JSON.stringify(message3.edits)));

    // — Le balayage du démarrage remet chaque ticket en face de la réalité.
    let fermees = await alerte.balayer(monde.client);
    V('balayage : celui qui attend encore est gardé', fermees === 0 && Boolean(alerte.enAttente.get('G1', 'U1')));
    await arrivant.voice.setChannel(aide1); // déplacé pendant que le bot dormait
    fermees = await alerte.balayer(monde.client);
    const message4 = await texte.messages.fetch(envoi4.id);
    V('balayage : déplacé en assistance pendant le sommeil = aidé',
      fermees === 1 && !alerte.enAttente.get('G1', 'U1'));
    V('… la carte finale le dit', /Assistance terminée/.test(JSON.stringify(message4.edits)));

    // — File coupée = plus aucun ticket.
    setGuildConfig('G1', 'vocal_attente_channel_id', null);
    const avant = texte.envois.length;
    await arrivant.voice.setChannel(attente);
    await alerte.surveiller(etat(null), etat('ATTENTE'));
    V('file coupée = aucun envoi', texte.envois.length === avant && !alerte.enAttente.get('G1', 'U1'));
    await arrivant.voice.setChannel(null);
  }

  console.log('\n1 bis) Déplacer en assistance, MP de secours, purge des tickets clos');
  {
    const monde = fauxMonde();
    const attente = monde.ajouterSalon('ATTENTE');
    const aide1 = monde.ajouterSalon('AIDE1');
    const aide2 = monde.ajouterSalon('AIDE2');
    const texte = monde.ajouterSalon('ALERTE');
    setGuildConfig('G1', 'vocal_attente_channel_id', 'ATTENTE');
    setGuildConfig('G1', 'vocal_alerte_channel_id', 'ALERTE');
    setGuildConfig('G1', 'vocal_assistance_ids', JSON.stringify(['AIDE1', 'AIDE2']));
    setGuildConfig('G1', 'staff_role_ids', JSON.stringify(['R1']));

    const arrivant = monde.fauxMembre('U50', { pseudo: 'Attendant' });
    const staffeur = monde.fauxMembre('S50', { pseudo: 'Staffeur', staff: true });
    const etat = (channelId) => ({ guild: monde.guild, member: arrivant, channelId, client: monde.client });
    const clic = (customId, user, msg) => ({
      guildId: 'G1', guild: monde.guild, customId, message: msg,
      user: { id: user.id }, member: user, client: monde.client,
      reponses: [], suites: [],
      replied: false, deferred: false,
      async reply(m) { this.reponses.push(m); this.replied = true; return {}; },
      async followUp(m) { this.suites.push(m); return {}; },
      async update(m) { msg.edits.push(m); this.replied = true; return {}; },
      async deferUpdate() { this.deferred = true; return {}; },
    });

    // Ticket ouvert puis claim : le bouton 📥 apparaît.
    await arrivant.voice.setChannel(attente);
    const envoi = await alerte.surveiller(etat(null), etat('ATTENTE'));
    const message = await texte.messages.fetch(envoi.id);
    V('avant le claim, pas de bouton de déplacement', !/va:mv/.test(JSON.stringify(texte.envois[0].components || [])));
    await alerte.handleBouton(clic('va:claim', staffeur, message));
    V('après le claim, le bouton « Déplacer en assistance » apparaît',
      /va:mv/.test(JSON.stringify(message.edits[message.edits.length - 1] || {})));

    const quidam = monde.fauxMembre('U51', { pseudo: 'Quidam' });
    const refus = clic('va:mv', quidam, message);
    await alerte.handleBouton(refus);
    V('le déplacement est réservé au staff', /⛔/.test(refus.reponses[0]?.content), refus.reponses[0]?.content);

    // AIDE1 est vide : la personne y est déplacée.
    const mv = clic('va:mv', staffeur, message);
    await alerte.handleBouton(mv);
    V('la personne est déplacée dans le salon d\'assistance vide', arrivant.voice.channelId === 'AIDE1');
    V('… et la réponse le dit', /AIDE1/.test(mv.reponses[0]?.content), mv.reponses[0]?.content);
    await alerte.surveiller(etat('ATTENTE'), etat('AIDE1')); // le mouvement vocal suit
    const ligneClose = alerte.parMessage.get(envoi.id);
    V('le ticket est clos… mais encore affiché', Boolean(ligneClose?.clos_a) && !alerte.enAttente.get('G1', 'U50'));

    const tard = clic('va:claim', staffeur, message);
    await alerte.handleBouton(tard);
    V('un clic sur un ticket clos informe', /déjà terminé/.test(tard.reponses[0]?.content), tard.reponses[0]?.content);

    // La purge n'efface qu'après la minute de lecture.
    V('la purge attend la minute de lecture', (await alerte.purgerCloses(monde.client)) === 0 && !message.supprime);
    db.prepare('UPDATE attentes_vocales SET clos_a = ? WHERE rowid = ?')
      .run(Date.now() - alerte.DELAI_SUPPRESSION - 1000, ligneClose.id);
    const purges = await alerte.purgerCloses(monde.client);
    V('… puis supprime le message ET la ligne', purges === 1 && message.supprime && !alerte.parMessage.get(envoi.id));

    // Plus aucun salon libre : le staff en assistance est prévenu en MP.
    const occupant = monde.fauxMembre('U52', { pseudo: 'Occupant' });
    await occupant.voice.setChannel(aide2);
    const staffAssist = monde.fauxMembre('S51', { pseudo: 'StaffAssist', staff: true });
    await staffAssist.voice.setChannel(aide1);
    await arrivant.voice.setChannel(attente);
    const envoi2 = await alerte.surveiller(etat('AIDE1'), etat('ATTENTE'));
    const message2 = await texte.messages.fetch(envoi2.id);
    await alerte.handleBouton(clic('va:claim', staffeur, message2));
    const mv2 = clic('va:mv', staffeur, message2);
    await alerte.handleBouton(mv2);
    V('aucun salon libre : personne n\'est déplacé', arrivant.voice.channelId === 'ATTENTE');
    V('… le staff en assistance reçoit un MP', staffAssist.mp.length === 1 && /Attendant/.test(staffAssist.mp[0]));
    V('… et la réponse nomme le prévenu', /S51/.test(mv2.reponses[0]?.content), mv2.reponses[0]?.content);

    await arrivant.voice.setChannel(null);
    await alerte.surveiller(etat('ATTENTE'), etat(null));
  }

  console.log('\n2) Salon perso : créé au pseudo, membre déplacé, carte de gestion');
  {
    const monde = fauxMonde();
    const createur = monde.ajouterSalon('CREATEUR', { parent: 'CAT1' });
    const proprio = monde.fauxMembre('U10', { pseudo: 'Bayouss', salon: createur });
    setGuildConfig('G1', 'vocal_perso_createur_id', 'CREATEUR');

    const salon = await perso.accueillir({ guild: monde.guild, member: proprio, channelId: 'CREATEUR', channel: createur });
    V('le salon est créé au pseudo', salon && /Bayouss/.test(salon.name), salon?.name);
    V('… dans la même catégorie que le créateur', salon.parentId === 'CAT1');
    V('le membre y est déplacé', proprio.voice.channelId === salon.id);
    V('la carte de gestion est postée dans son chat', salon.envois.length === 1 && salon.envois[0].components?.length === 2);
    V('le propriétaire garde toujours la porte',
      salon.permissionOverwrites.cache.get('U10')?.allow.has(PermissionFlagsBits.Connect));
    V('la déclaration est en base', Boolean(perso.parSalon.get(salon.id)));

    // Un autre salon que le créateur ne déclenche rien.
    const avant = monde.salons.size;
    await perso.accueillir({ guild: monde.guild, member: proprio, channelId: salon.id, channel: salon });
    V('entrer dans un salon ordinaire ne crée rien', monde.salons.size === avant);

    // Le salon disparaît quand il se vide.
    await proprio.voice.setChannel(null);
    await perso.verifierDepart({ guild: monde.guild, channelId: salon.id, channel: salon });
    V('vidé, le salon disparaît', salon.supprime === true);
    V('… et sa déclaration aussi', !perso.parSalon.get(salon.id));
  }

  console.log('\n3) La carte : caméras, statuts, mode privé');
  {
    const monde = fauxMonde();
    const createur = monde.ajouterSalon('CREATEUR');
    const proprio = monde.fauxMembre('U20', { pseudo: 'Proprio', salon: createur });
    setGuildConfig('G1', 'vocal_perso_createur_id', 'CREATEUR');
    setGuildConfig('G1', 'staff_role_ids', JSON.stringify(['R1']));
    const salon = await perso.accueillir({ guild: monde.guild, member: proprio, channelId: 'CREATEUR', channel: createur });

    const clic = (customId, user = proprio, values = []) => ({
      guildId: 'G1', channelId: salon.id, channel: salon, customId, values,
      user: { id: user.id }, member: user, client: monde.client,
      reponses: [],
      async reply(m) { this.reponses.push(m); return {}; },
      async deferUpdate() { return {}; },
      async editReply(m) { this.reponses.push(m); return {}; },
      isRepliable: () => true,
      message: { flags: 0, async edit() { return {}; } },
    });

    const cam = clic('vp:cam');
    await perso.handleBouton(cam);
    V('caméras coupées via @everyone', perso.everyoneBloque(salon, PermissionFlagsBits.Stream));
    V('… et le message dit la nuance Discord (une seule permission)', /une seule permission/.test(cam.reponses[0]?.content), cam.reponses[0]?.content);
    await perso.handleBouton(clic('vp:cam'));
    V('… second clic = réautorisées', !perso.everyoneBloque(salon, PermissionFlagsBits.Stream));

    await perso.handleBouton(clic('vp:statut'));
    V('les statuts se coupent', perso.everyoneBloque(salon, PermissionFlagsBits.SetVoiceChannelStatus));

    await perso.handleBouton(clic('vp:prive'));
    V('mode privé : la connexion @everyone est coupée', perso.everyoneBloque(salon, PermissionFlagsBits.Connect));
    V('… mais le salon reste VISIBLE', !salon.permissionOverwrites.cache.get('EVERYONE').deny.has(PermissionFlagsBits.ViewChannel));
    V('… et le staff regagne la porte', salon.permissionOverwrites.cache.get('R1')?.allow.has(PermissionFlagsBits.Connect));
    await perso.handleBouton(clic('vp:prive'));
    V('… second clic = réouvert', !perso.everyoneBloque(salon, PermissionFlagsBits.Connect));

    const intrus = monde.fauxMembre('U21', { pseudo: 'Intrus' });
    const refuse = clic('vp:cam', intrus);
    await perso.handleBouton(refuse);
    V('un tiers ne pilote pas le salon des autres', /⛔/.test(refuse.reponses[0]?.content), refuse.reponses[0]?.content);
  }

  console.log('\n4) Blacklist et whitelist — par les permissions du salon');
  {
    const monde = fauxMonde();
    const createur = monde.ajouterSalon('CREATEUR');
    const proprio = monde.fauxMembre('U30', { pseudo: 'Proprio', salon: createur });
    setGuildConfig('G1', 'vocal_perso_createur_id', 'CREATEUR');
    const salon = await perso.accueillir({ guild: monde.guild, member: proprio, channelId: 'CREATEUR', channel: createur });
    const vise = monde.fauxMembre('U31', { pseudo: 'Visé' });
    await vise.voice.setChannel(salon);
    const staff = monde.fauxMembre('U32', { pseudo: 'Staffeur', staff: true });

    const menu = (customId, values) => ({
      guildId: 'G1', channelId: salon.id, channel: salon, customId, values,
      user: { id: proprio.id }, member: proprio, client: monde.client,
      reponses: [],
      async reply(m) { this.reponses.push(m); return {}; },
      async deferUpdate() { return {}; },
      async editReply(m) { this.reponses.push(m); return {}; },
      isRepliable: () => true, replied: false, deferred: false,
      isMessageComponent: () => true,
      message: { flags: 0, components: [], async edit(m) { this.edite = m; return {}; } },
      async update(m) { this.reponses.push(m); return {}; },
    });

    const bl = menu('vp:blsel', ['U31', 'U30', 'U32']);
    await perso.handleMenu(bl);
    const surV = salon.permissionOverwrites.cache.get('U31');
    V('blacklisté : le salon lui est caché ET fermé',
      surV?.deny.has(PermissionFlagsBits.ViewChannel) && surV?.deny.has(PermissionFlagsBits.Connect));
    V('… et il est déconnecté sur-le-champ', vise.voice.channelId === null);
    V('le propriétaire est infranchissable', !salon.permissionOverwrites.cache.get('U30')?.deny?.has(PermissionFlagsBits.Connect));
    V('le staff aussi', !salon.permissionOverwrites.cache.get('U32')?.deny?.has(PermissionFlagsBits.Connect));
    V('… et les refus sont expliqués', /propriétaire/.test(JSON.stringify(bl.reponses)) && /staff/.test(JSON.stringify(bl.reponses)));

    const wl = menu('vp:wlsel', ['U33']);
    await perso.handleMenu(wl);
    const surW = salon.permissionOverwrites.cache.get('U33');
    V('whitelisté : connexion garantie, même en privé',
      surW?.allow.has(PermissionFlagsBits.Connect) && surW?.allow.has(PermissionFlagsBits.ViewChannel));
  }

  console.log('\n5) Le balayage du démarrage');
  {
    const monde = fauxMonde();
    const createur = monde.ajouterSalon('CREATEUR');
    const p1 = monde.fauxMembre('U40', { salon: createur });
    setGuildConfig('G1', 'vocal_perso_createur_id', 'CREATEUR');
    const salon = await perso.accueillir({ guild: monde.guild, member: p1, channelId: 'CREATEUR', channel: createur });
    await p1.voice.setChannel(null); // vidé pendant que le bot « dormait »
    const fermes = await perso.balayer(monde.client);
    V('un salon vidé hors ligne est rattrapé', fermes === 1 && salon.supprime === true);
    V('… et la base est propre', !perso.parSalon.get(salon.id));
  }

  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})();
