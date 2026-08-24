// 🎙️ L'alerte vocale au staff, et les salons vocaux personnels.
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
const { setGuildConfig } = require('../src/database');
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
    const salon = {
      id, guild: g, name: opts.name || id, parentId: opts.parent ?? null,
      supprime: false,
      members: new Map(),
      envois,
      isTextBased: () => true,
      async send(m) { envois.push(m); return { id: `M${id}` }; },
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
  console.log('\n1) L\'alerte vocale : une carte, les présents, et le staff qui SONNE');
  {
    const monde = fauxMonde();
    const vocal = monde.ajouterSalon('VOC1');
    const texte = monde.ajouterSalon('ALERTE');
    const arrivant = monde.fauxMembre('U1', { pseudo: 'Bayouss', salon: vocal });
    monde.fauxMembre('U2', { pseudo: 'Leen', salon: vocal });
    monde.fauxMembre('B1', { bot: true, salon: vocal });
    setGuildConfig('G1', 'vocal_alerte_channel_id', 'ALERTE');
    setGuildConfig('G1', 'staff_role_ids', JSON.stringify(['R1', 'R2']));

    await alerte.signaler({ guild: monde.guild, member: arrivant, channelId: 'VOC1', channel: vocal });
    const envoi = texte.envois[0];
    V('la carte part dans le salon d\'alerte', Boolean(envoi?.embeds?.length));
    const desc = JSON.stringify(envoi.embeds[0].data ?? envoi.embeds[0]);
    V('… elle nomme l\'arrivant et le salon', /U1/.test(desc) && /VOC1/.test(desc), desc.slice(0, 120));
    V('… et liste les présents SANS les bots', /U2/.test(desc) && !/B1/.test(desc));
    V('le staff est mentionné dans le CONTENU — donc il sonne', envoi.content === '<@&R1> <@&R2>', envoi.content);

    setGuildConfig('G1', 'vocal_alerte_channel_id', null);
    const avant = texte.envois.length;
    await alerte.signaler({ guild: monde.guild, member: arrivant, channelId: 'VOC1', channel: vocal });
    V('alerte coupée = aucun envoi', texte.envois.length === avant);
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
