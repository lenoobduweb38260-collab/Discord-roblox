// 🚨 L'anti-scam qui blackliste, /unban-bl et /unban-all — sans réseau.
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const AIDES = path.join(__dirname, 'aides');

// ⚠️ AVANT tout require : src/database.js ouvre sa base au chargement.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'antiscam-'));
process.env.DATA_FILE = path.join(RACINE, 'data.sqlite');

const Module = require('module');
const vrai = Module.prototype.require;
Module.prototype.require = function (n) {
  if (n === 'discord.js') return vrai.call(this, path.join(AIDES, 'stub-discord.js'));
  if (n === 'better-sqlite3') return vrai.call(this, path.join(AIDES, 'shim-sqlite.js'));
  return vrai.apply(this, arguments);
};

const { db } = require('../src/database');
const botTeam = require('../src/utils/botTeam');
const scam = require('../src/utils/scamImages');

let ok = 0, ko = 0;
const V = (t, c, d = '') => { if (c) { ok++; console.log('  ✅ ' + t); } else { ko++; console.log('  ❌ ' + t + (d ? ' — ' + d : '')); } };

// ── Le laboratoire ────────────────────────────────────────────────
const traces = [];
const fauxGuild = (id) => ({
  id,
  name: `Serveur ${id}`,
  members: {
    ban: async (uid, opts) => { traces.push(['ban', id, uid, opts?.deleteMessageSeconds || 0]); },
    unban: async (uid) => { traces.push(['unban', id, uid]); },
  },
  // sendLog s'arrête avant (pas de log_channel_id configuré) : rien à servir.
  channels: { fetch: async () => null },
});
const guildes = [fauxGuild('G1'), fauxGuild('G2')];
const client = {
  user: { id: 'BOT' },
  users: { fetch: async (id) => ({ id, tag: `tag-${id}`, send: async () => { traces.push(['mp', id]); } }) },
  guilds: { cache: new Map(guildes.map((g) => [g.id, g])) },
  application: { fetch: async () => { throw new Error('hors ligne'); } },
};

const SCAM_BUF = Buffer.from('affiche-de-scam-bien-connue');
const AUTRE_BUF = Buffer.from('deuxieme-image-du-message');
const vraiFetch = global.fetch;
global.fetch = async (url) => {
  traces.push(['fetch', String(url)]);
  const corps = String(url).includes('scam.png') ? SCAM_BUF : AUTRE_BUF;
  return { ok: true, arrayBuffer: async () => corps };
};

function fauxMessage(auteurId) {
  return {
    guildId: 'G1',
    channelId: 'C1',
    channel: { name: 'général' },
    guild: guildes[0],
    author: { id: auteurId, tag: `tag-${auteurId}` },
    client,
    attachments: new Map([
      ['a1', { id: 'a1', name: 'scam.png', contentType: 'image/png', size: 100, url: 'https://cdn/scam.png' }],
      ['a2', { id: 'a2', name: 'autre.png', contentType: 'image/png', size: 100, url: 'https://cdn/autre.png' }],
    ]),
    delete: async () => { traces.push(['delete']); },
  };
}

(async () => {
  // L'échantillon du créateur : l'empreinte exacte de SCAM_BUF (jimp absent
  // dans le laboratoire → dhash null → seule la copie identique matche).
  scam.insertSample.run('GLOBAL', 'faux nitro', crypto.createHash('sha256').update(SCAM_BUF).digest('hex'), null, 'CREA', '2026-01-01');

  console.log('\n1) Une affiche de scam vaut blacklist automatique, preuves d\'abord');
  {
    traces.length = 0;
    const traite = await scam.scanMessage(fauxMessage('U1'));
    V('le message est traité comme scam', traite === true);
    const iAutre = traces.findIndex(([q, u]) => q === 'fetch' && u.includes('autre.png'));
    const iDelete = traces.findIndex(([q]) => q === 'delete');
    V('TOUTES ses images sont téléchargées AVANT la suppression', iAutre !== -1 && iDelete !== -1 && iAutre < iDelete,
      JSON.stringify({ iAutre, iDelete }));
    V('l\'auteur est blacklisté', Boolean(botTeam.getBlacklistRow.get('U1')));
    const hist = db.prepare('SELECT * FROM blacklist_history WHERE user_id = ? ORDER BY id DESC').get('U1');
    V('… avec la preuve dans l\'historique', /2 image\(s\)/.test(hist?.proof || ''), hist?.proof);
    V('… et prévenu en MP', traces.some(([q, id]) => q === 'mp' && id === 'U1'));
    const bans = traces.filter(([q]) => q === 'ban');
    V('banni sur TOUS les serveurs du bot', bans.length === 2 && bans.every(([, , uid]) => uid === 'U1'), JSON.stringify(bans));
    V('… avec la purge 24 h de ses messages', bans.every(([, , , purge]) => purge === 86400), JSON.stringify(bans));
    V('plus AUCUNE écriture dans global_bans (un seul circuit)', db.prepare('SELECT * FROM global_bans').all().length === 0);
  }

  console.log('\n2) Un membre immunisé n\'est jamais sanctionné');
  {
    traces.length = 0;
    botTeam.addImmunity('U_IMM');
    const traite = await scam.scanMessage(fauxMessage('U_IMM'));
    V('l\'affiche est tout de même effacée', traite === true && traces.some(([q]) => q === 'delete'));
    V('aucun ban', !traces.some(([q]) => q === 'ban'), JSON.stringify(traces.filter(([q]) => q === 'ban')));
    V('aucune blacklist', !botTeam.getBlacklistRow.get('U_IMM'));
    botTeam.removeImmunity('U_IMM');
  }

  console.log('\n3) /unban-bl — staff du bot uniquement, lève LES DEUX automatismes');
  {
    const cmd = require('../src/commands/unbanbl');
    V('la commande existe sous son bon nom', cmd.data.name === 'unban-bl');
    const faireInteraction = (userId) => {
      const i = {
        user: { id: userId, tag: `tag-${userId}` },
        client,
        guild: guildes[0],
        guildId: 'G1',
        options: { getUser: () => ({ id: 'U1' }) },
        deferred: false,
        replied: false,
        reponses: [],
      };
      i.reply = async (p) => { i.replied = true; i.reponses.push(typeof p === 'string' ? p : p.content); };
      i.deferReply = async () => { i.deferred = true; };
      i.editReply = async (p) => { i.reponses.push(typeof p === 'string' ? p : p.content); };
      return i;
    };

    // Sans la permission 'blacklist' : refus net.
    const refus = faireInteraction('RANDO');
    await cmd.execute(refus);
    V('refusée sans la permission du staff du bot', /staff du bot/.test(refus.reponses[0] || ''), refus.reponses[0]);

    // Avec la permission : la blacklist (posée au test 1) ET un ban global
    // hérité de l'ancien circuit sont levés ensemble.
    db.prepare('INSERT OR REPLACE INTO bot_staff (user_id, rank, perms, added_by, added_at) VALUES (?, ?, ?, ?, ?)')
      .run('STAFF1', 'Modérateur', JSON.stringify(['blacklist']), 'CREA', '2026-01-01');
    db.prepare('INSERT OR REPLACE INTO global_bans (user_id, reason, banned_by, banned_at) VALUES (?, ?, ?, ?)')
      .run('U1', 'ancien circuit', 'BOT', '2026-01-01');
    traces.length = 0;
    const leve = faireInteraction('STAFF1');
    await cmd.execute(leve);
    V('la ligne de blacklist est levée', !botTeam.getBlacklistRow.get('U1'));
    V('la ligne de ban global aussi', db.prepare('SELECT * FROM global_bans WHERE user_id = ?').all('U1').length === 0);
    const unbans = traces.filter(([q]) => q === 'unban');
    V('débanni sur TOUS les serveurs', unbans.length === 2, JSON.stringify(unbans));
    V('la réponse nomme les deux automatismes levés',
      /blacklist/.test(leve.reponses[0] || '') && /ban global/.test(leve.reponses[0] || ''), leve.reponses[0]);

    // Plus rien à lever : la commande le dit au lieu de promettre un geste vide.
    const rien = faireInteraction('STAFF1');
    await cmd.execute(rien);
    V('sans automatisme, elle le dit', /aucun automatisme/.test(rien.reponses[0] || ''), rien.reponses[0]);
  }

  console.log('\n4) /unban-all — tous les bans du serveur, et la vérité sur les automatiques');
  {
    const commandes = require('../src/commands/moderation');
    const cmd = commandes.find((c) => c.data?.name === 'unban-all');
    V('la commande existe dans le module de modération', Boolean(cmd));
    V('… réservée à l\'administration', cmd?.grade === 3, String(cmd?.grade));

    // Trois bannis, dont un re-bannissable (ban global remis pour le test).
    db.prepare('INSERT OR REPLACE INTO global_bans (user_id, reason, banned_by, banned_at) VALUES (?, ?, ?, ?)')
      .run('B3', 'automatique', 'BOT', '2026-01-01');
    const banMap = new Map([['B1', {}], ['B2', {}], ['B3', {}]]);
    Object.defineProperty(banMap, 'size', { value: 3 });
    const serveur = {
      id: 'G1',
      bans: { fetch: async () => banMap },
      members: { unban: async (uid) => { traces.push(['unban-all', uid]); } },
      channels: { fetch: async () => null },
    };
    traces.length = 0;
    const i = {
      user: { id: 'ADMIN1', tag: 'admin' },
      client,
      guild: serveur,
      guildId: 'G1',
      deferred: false,
      replied: false,
      reponses: [],
    };
    i.reply = async (p) => { i.replied = true; i.reponses.push(typeof p === 'string' ? p : p.content); };
    i.deferReply = async () => { i.deferred = true; };
    i.editReply = async (p) => { i.reponses.push(typeof p === 'string' ? p : p.content); };
    await cmd.execute(i);
    const leves = traces.filter(([q]) => q === 'unban-all');
    V('les trois bans sont levés', leves.length === 3, JSON.stringify(leves));
    V('la réponse donne le compte', /\*\*3\*\*/.test(i.reponses[0] || ''), i.reponses[0]);
    V('… et prévient que l\'automatique sera re-banni à son retour',
      /re-bannis à leur retour/.test(i.reponses[0] || ''), i.reponses[0]);
  }

  global.fetch = vraiFetch;
  fs.rmSync(RACINE, { recursive: true, force: true });
  console.log(`\n${ko === 0 ? '✅' : '❌'} ${ok} réussis, ${ko} échoués`);
  process.exit(ko === 0 ? 0 : 1);
})();
