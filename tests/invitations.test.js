// 📨 Traqueur d'invitations + 🤖 rôles automatiques des bots.
const fs = require('fs');
const os = require('os');
const path = require('path');
const AIDES = path.join(__dirname, 'aides');

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'invites-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  return vrai.apply(this, arguments);
};

const invitations = require('../src/utils/invitations');
const { setGuildConfig } = require('../src/database');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

// Un serveur factice dont on pilote la liste d'invitations à la main.
function fauxServeur(id) {
  const etat = { liste: new Map() };
  return {
    guild: {
      id,
      invites: { fetch: async () => new Map(etat.liste) },
    },
    poser(...invites) {
      etat.liste = new Map(invites.map((i) => [i.code, i]));
    },
  };
}

(async () => {
  console.log('1) L\'invitation dont le compteur bouge est la bonne');
  {
    const s = fauxServeur('G1');
    s.poser({ code: 'aaa', uses: 2, inviterId: 'U1' }, { code: 'bbb', uses: 0, inviterId: 'U2' });
    await invitations.primer(s.guild);
    s.poser({ code: 'aaa', uses: 3, inviterId: 'U1' }, { code: 'bbb', uses: 0, inviterId: 'U2' });
    const t = await invitations.detecter({ guild: s.guild, id: 'M1' });
    V('le code utilisé est identifié', t?.code === 'aaa', JSON.stringify(t));
    V('l\'inviteur est identifié', t?.inviterId === 'U1');
    V('le total de l\'inviteur monte', invitations.totalDe('G1', 'U1') === 1);
    V('on sait qui a invité le membre', invitations.inviteurDe('G1', 'M1')?.inviter_id === 'U1');
  }

  console.log('\n2) Une invitation à usage unique disparaît — retrouvée par son absence');
  {
    const s = fauxServeur('G2');
    s.poser({ code: 'unique', uses: 0, inviterId: 'U3' });
    await invitations.primer(s.guild);
    s.poser(); // consommée : plus dans la liste
    const t = await invitations.detecter({ guild: s.guild, id: 'M2' });
    V('l\'invitation disparue est reconnue', t?.code === 'unique', JSON.stringify(t));
    V('son inviteur aussi', t?.inviterId === 'U3');
  }

  console.log('\n3) La suppression peut arriver AVANT l\'arrivée — mémoire courte');
  {
    const s = fauxServeur('G3');
    s.poser({ code: 'ddd', uses: 0, inviterId: 'U4' });
    await invitations.primer(s.guild);
    invitations.invitationSupprimee({ guild: { id: 'G3' }, code: 'ddd' });
    s.poser();
    const t = await invitations.detecter({ guild: s.guild, id: 'M3' });
    V('l\'invitation tout juste supprimée est retrouvée', t?.code === 'ddd', JSON.stringify(t));
    V('avec son inviteur', t?.inviterId === 'U4');
  }

  console.log('\n4) Sans photo de départ, personne n\'est accusé au hasard');
  {
    const s = fauxServeur('G4');
    s.poser({ code: 'xxx', uses: 7, inviterId: 'U5' });
    const t = await invitations.detecter({ guild: s.guild, id: 'M4' });
    V('aucune invitation désignée', t === null);
    V('l\'arrivée est quand même enregistrée, inviteur inconnu',
      invitations.inviteurDe('G4', 'M4') !== null && invitations.inviteurDe('G4', 'M4').inviter_id === null);
  }

  console.log('\n5) Le classement compte juste');
  {
    const s = fauxServeur('G5');
    s.poser({ code: 'k', uses: 0, inviterId: 'U9' }, { code: 'l', uses: 0, inviterId: 'U8' });
    await invitations.primer(s.guild);
    s.poser({ code: 'k', uses: 1, inviterId: 'U9' }, { code: 'l', uses: 0, inviterId: 'U8' });
    await invitations.detecter({ guild: s.guild, id: 'MA' });
    s.poser({ code: 'k', uses: 2, inviterId: 'U9' }, { code: 'l', uses: 0, inviterId: 'U8' });
    await invitations.detecter({ guild: s.guild, id: 'MB' });
    s.poser({ code: 'k', uses: 2, inviterId: 'U9' }, { code: 'l', uses: 1, inviterId: 'U8' });
    await invitations.detecter({ guild: s.guild, id: 'MC' });
    const rangs = invitations.classement('G5');
    V('U9 en tête avec 2', rangs[0]?.inviter_id === 'U9' && rangs[0]?.n === 2, JSON.stringify(rangs));
    V('U8 ensuite avec 1', rangs[1]?.inviter_id === 'U8' && rangs[1]?.n === 1);
  }

  console.log('\n6) 🤖 Rôles automatiques des bots — la bonne liste, au bon public');
  {
    const autoRoles = require('../src/utils/autoRoles');
    setGuildConfig('G6', 'autorole_role_ids', JSON.stringify(['R_MEMBRE']));
    setGuildConfig('G6', 'autorole_bot_role_ids', JSON.stringify(['R_BOT']));
    const fauxMembre = (estBot) => {
      const donnes = [];
      return {
        donnes,
        guild: {
          id: 'G6',
          name: 'G6',
          roles: { cache: new Map([
            ['R_MEMBRE', { id: 'R_MEMBRE', name: 'Membre', managed: false, position: 1 }],
            ['R_BOT', { id: 'R_BOT', name: 'Bots', managed: false, position: 1 }],
          ]) },
          members: { me: { permissions: { has: () => true }, roles: { highest: { position: 9 } } } },
        },
        user: { bot: estBot },
        roles: { cache: new Map(), add: async (ids) => donnes.push(...ids) },
      };
    };
    const bot = fauxMembre(true);
    await autoRoles.appliquerBot(bot);
    V('un bot reçoit le rôle des bots', bot.donnes.includes('R_BOT'), JSON.stringify(bot.donnes));
    V('… et jamais celui des membres', !bot.donnes.includes('R_MEMBRE'));
    const refusBot = await autoRoles.appliquer(bot);
    V('la liste des membres ignore les bots', refusBot.donnes.length === 0);
    const membre = fauxMembre(false);
    await autoRoles.appliquer(membre);
    V('un membre reçoit le rôle des membres', membre.donnes.includes('R_MEMBRE'), JSON.stringify(membre.donnes));
    V('… et jamais celui des bots', !membre.donnes.includes('R_BOT'));
    const refusMembre = await autoRoles.appliquerBot(membre);
    V('la liste des bots ignore les membres', refusMembre.donnes.length === 0);
  }

  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})();
