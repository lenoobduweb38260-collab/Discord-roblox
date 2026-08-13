const http = require('http');
const fs = require('fs');
const path = require('path');

// API locale (127.0.0.1, port aléatoire) démarrée uniquement quand le bot est
// lancé par le Gestionnaire de bots (BOT_MANAGED=1). Elle alimente le
// dashboard et le créateur d'embed de l'interface développeur. Le port est
// écrit dans api.port à côté de l'exécutable pour que le gestionnaire le trouve.

function startManagedApi(client, baseDir) {
  const { EmbedBuilder, ChannelType } = require('discord.js');
  const { db, getGuildConfig, setGuildConfig, RP_SCOPE } = require('./database');
  // Entités RP partagées sur tous les serveurs (comptées en portée globale).
  const GLOBAL_COUNT = new Set(['cartes', 'permis', 'entreprises', 'vehicules']);

  const readBody = (req) =>
    new Promise((resolve) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        try {
          resolve(JSON.parse(raw || '{}'));
        } catch {
          resolve({});
        }
      });
    });

  const insertTicketType = db.prepare(
    'INSERT INTO ticket_types (guild_id, label, emoji, category_id, support_role_id, description, support_role_ids) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const deleteTicketType = db.prepare('DELETE FROM ticket_types WHERE id = ? AND guild_id = ?');
  const getTicketTypeByLabel = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? AND label = ?');
  const countTicketTypes = db.prepare('SELECT COUNT(*) AS n FROM ticket_types WHERE guild_id = ?');
  const insertWl = db.prepare(
    'INSERT OR IGNORE INTO whitelist_managers (guild_id, role_id, manager_role_id) VALUES (?, ?, ?)'
  );
  const deleteWl = db.prepare(
    'DELETE FROM whitelist_managers WHERE guild_id = ? AND role_id = ? AND manager_role_id = ?'
  );
  const listBans = db.prepare('SELECT * FROM global_bans ORDER BY banned_at DESC');
  const deleteBanStmt = db.prepare('DELETE FROM global_bans WHERE user_id = ?');
  // Profils d'envoi (nom + avatar personnalisés) pour les panneaux.
  const listProfiles = db.prepare('SELECT * FROM webhook_profiles WHERE guild_id = ? ORDER BY id');
  const getProfile = db.prepare('SELECT * FROM webhook_profiles WHERE id = ? AND guild_id = ?');
  const insertProfile = db.prepare('INSERT INTO webhook_profiles (guild_id, name, avatar_url) VALUES (?, ?, ?)');
  const deleteProfile = db.prepare('DELETE FROM webhook_profiles WHERE id = ? AND guild_id = ?');
  const insertTicketPanel = db.prepare(
    'INSERT INTO ticket_panels (guild_id, channel_id, message_id, options, webhook_id, webhook_token) VALUES (?, ?, ?, ?, ?, ?)'
  );

  // Clés de configuration modifiables depuis le dashboard
  // ('s' = id, 'n' = nombre, 'b' = booléen, 't' = texte, 'j' = liste d'IDs).
  const CONFIG_KEYS = {
    staff_role_id: 's',
    admin_role_id: 's',
    staff_role_ids: 'j',
    admin_role_ids: 'j',
    service_role_id: 's',
    log_channel_id: 's',
    level_channel_id: 's',
    service_channel_id: 's',
    staff_channel_id: 's',
    member_channel_id: 's',
    update_channel_id: 's',
    proof_channel_id: 's',
    welcome_message: 't',
    goodbye_message: 't',
    welcome_mention: 'b',
    rp_enabled: 'b',
    rp_locked: 'b',
    xp_text: 'n',
    xp_voice: 'n',
    xp_cooldown: 'n',
    // ----- Réglables depuis le site : TOUS les modules -----
    // Salons
    goodbye_channel_id: 's',
    patch_channel_id: 's',
    partner_channel_id: 's',
    captcha_channel_id: 's',
    ticket_transcript_channel_id: 's',
    // Rôles
    police_role_ids: 'j',
    wlrp_role_id: 's',
    verified_role_id: 's',
    captcha_role_remove: 's',
    autorole_role_ids: 'j',
    // Captcha : nombre d'erreurs tolérées, puis expulsion
    captcha_max_essais: 'n',
    captcha_kick: 'b',
    // Interrupteurs de module
    levels_enabled: 'b',
    antispam_enabled: 'b',
    antinuke_enabled: 'b',
    captcha_enabled: 'b',
    interact_enabled: 'b',
    sao_enabled: 'b',
    // Apparence des arrivées / départs
    welcome_color: 's',
    welcome_image: 's',
    welcome_avatar: 's',
    welcome_title: 't',
    welcome_fields: 'b',
    goodbye_color: 's',
    goodbye_image: 's',
    goodbye_avatar: 's',
    goodbye_title: 't',
    goodbye_fields: 'b',
    level_image_url: 's',
  };
  const NUM_LIMITS = {
    xp_text: [1, 1000], xp_voice: [1, 1000], xp_cooldown: [5, 3600],
    captcha_max_essais: [1, 10],
  };
  const listWhitelist = db.prepare('SELECT * FROM whitelist_managers WHERE guild_id = ? ORDER BY role_id');
  const listTicketTypes = db.prepare('SELECT * FROM ticket_types WHERE guild_id = ? ORDER BY id');

  const countStmts = {
    cartes: db.prepare('SELECT COUNT(*) AS n FROM identity_cards WHERE guild_id = ?'),
    permis: db.prepare('SELECT COUNT(*) AS n FROM permits WHERE guild_id = ?'),
    entreprises: db.prepare('SELECT COUNT(*) AS n FROM enterprises WHERE guild_id = ?'),
    ticketsOuverts: db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND status = 'ouvert'"),
    whitelist: db.prepare('SELECT COUNT(*) AS n FROM whitelist_entries WHERE guild_id = ?'),
    vehicules: db.prepare('SELECT COUNT(*) AS n FROM insured_vehicles WHERE guild_id = ?'),
  };
  const topNiveaux = db.prepare(
    'SELECT user_id, text_xp, text_level FROM levels WHERE guild_id = ? ORDER BY text_xp DESC LIMIT 5'
  );

  const server = http.createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    try {
      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/infos') {
        const guilds = [...client.guilds.cache.values()].map((g) => ({
          id: g.id,
          name: g.name,
          memberCount: g.memberCount,
          icon: g.iconURL({ size: 64 }),
          channels: [...g.channels.cache.filter((c) => c.isTextBased() && !c.isThread()).values()]
            .map((c) => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        }));
        return send(200, {
          bot: { tag: client.user.tag, avatar: client.user.displayAvatarURL({ size: 64 }), clientId: client.user.id },
          guilds,
        });
      }

      // ----- Grade RÉEL d'un membre sur un serveur -----
      // Utilisé par le site : quand quelqu'un s'y connecte avec Discord, on
      // demande au bot ce que vaut cette personne sur CE serveur (rôles staff,
      // administration, police configurés), plutôt que de le deviner.
      if (req.method === 'GET' && url.pathname === '/membre') {
        const guild = client.guilds.cache.get(url.searchParams.get('guild'));
        const userId = String(url.searchParams.get('user') || '');
        if (!guild) return send(404, { error: 'Serveur introuvable (le bot y est-il ?).' });
        if (!/^\d{15,25}$/.test(userId)) return send(400, { error: 'Identifiant de membre invalide.' });
        let membre = guild.members.cache.get(userId);
        if (!membre) {
          try { membre = await guild.members.fetch(userId); } catch { membre = null; }
        }
        if (!membre) return send(404, { error: "Ce membre n'est pas sur ce serveur." });
        const { GRADES, GRADE_NAMES, getGrade, isPolice } = require('./utils/permissions');
        const cfg = getGuildConfig(guild.id);
        const grade = getGrade(membre, cfg);
        return send(200, {
          id: membre.id,
          pseudo: membre.user?.username || null,
          surnom: membre.nickname || null,
          avatar: membre.displayAvatarURL?.({ size: 64 }) || null,
          // « membre » | « staff » | « admin », plus le drapeau police.
          grade: grade >= GRADES.ADMIN ? 'admin' : grade >= GRADES.STAFF ? 'staff' : 'membre',
          gradeNom: GRADE_NAMES[grade] || 'Membre',
          police: isPolice(membre, cfg),
          proprietaire: guild.ownerId === membre.id,
          roles: [...membre.roles.cache.values()]
            .filter((r) => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map((r) => ({ id: r.id, name: r.name, couleur: r.hexColor })),
        });
      }

      if (req.method === 'GET' && url.pathname === '/dashboard') {
        const guild = client.guilds.cache.get(url.searchParams.get('guild'));
        if (!guild) return send(404, { error: 'Serveur introuvable (le bot y est-il ?).' });
        const cfg = getGuildConfig(guild.id);
        const roleName = (id) => (id ? `@${guild.roles.cache.get(id)?.name || id}` : null);
        const chanName = (id) => (id ? `#${guild.channels.cache.get(id)?.name || id}` : null);
        const stats = {};
        for (const [key, stmt] of Object.entries(countStmts)) {
          stats[key] = stmt.get(GLOBAL_COUNT.has(key) ? RP_SCOPE : guild.id).n;
        }
        const top = topNiveaux.all(guild.id).map((r) => ({
          user: client.users.cache.get(r.user_id)?.username || r.user_id,
          level: r.text_level,
          xp: r.text_xp,
        }));
        return send(200, {
          serveur: { name: guild.name, membres: guild.memberCount, icon: guild.iconURL({ size: 128 }) },
          stats,
          top,
          config: {
            'Rôle staff': roleName(cfg.staff_role_id),
            'Rôle administration': roleName(cfg.admin_role_id),
            'Rôle en service': roleName(cfg.service_role_id),
            'Salon logs': chanName(cfg.log_channel_id),
            'Salon niveaux': chanName(cfg.level_channel_id),
            'Salon service': chanName(cfg.service_channel_id),
            'Salon staff': chanName(cfg.staff_channel_id),
            'Salon membres (arrivées/départs)': chanName(cfg.member_channel_id),
            'Salon mises à jour': chanName(cfg.update_channel_id) || '#shadow-logs (auto)',
            'XP texte': `${cfg.xp_text} XP/message (cooldown ${cfg.xp_cooldown} s)`,
            'XP vocal': `${cfg.xp_voice} XP/minute`,
          },
        });
      }

      // Données pour les pages de configuration du dashboard.
      if (req.method === 'GET' && url.pathname === '/parametres') {
        const guild = client.guilds.cache.get(url.searchParams.get('guild'));
        if (!guild) return send(404, { error: 'Serveur introuvable.' });
        const roles = [...guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed).values()]
          .sort((a, b) => b.position - a.position)
          .map((r) => ({ id: r.id, name: r.name }));
        const channels = [...guild.channels.cache.filter((c) => c.isTextBased() && !c.isThread()).values()]
          .map((c) => ({ id: c.id, name: c.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const categories = [...guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).values()]
          .map((c) => ({ id: c.id, name: c.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const whitelist = listWhitelist.all(guild.id).map((m) => ({
          roleId: m.role_id,
          managerId: m.manager_role_id,
          role: guild.roles.cache.get(m.role_id)?.name || m.role_id,
          manager: guild.roles.cache.get(m.manager_role_id)?.name || m.manager_role_id,
        }));
        const tickets = listTicketTypes.all(guild.id).map((t) => {
          let roleIds = [];
          try {
            const arr = JSON.parse(t.support_role_ids || '[]');
            if (Array.isArray(arr) && arr.length) roleIds = arr.map(String);
          } catch {}
          if (!roleIds.length && t.support_role_id) roleIds = [String(t.support_role_id)];
          const supports = roleIds.map((id) => ({ id, name: guild.roles.cache.get(id)?.name || id }));
          return {
            id: t.id,
            label: t.label,
            emoji: t.emoji,
            description: t.description || null,
            categorie: guild.channels.cache.get(t.category_id)?.name || t.category_id || '?',
            support: supports[0]?.name || null,
            supports,
          };
        });
        const bans = listBans.all().map((b) => ({
          userId: b.user_id,
          name: client.users.cache.get(b.user_id)?.tag || null,
          reason: b.reason,
          at: b.banned_at,
        }));
        const profils = listProfiles.all(guild.id).map((p) => ({ id: p.id, name: p.name, avatar: p.avatar_url }));
        return send(200, { config: getGuildConfig(guild.id), roles, channels, categories, whitelist, tickets, bans, profils });
      }

      // ----- Profils d'envoi (nom + avatar) pour les panneaux -----
      if (req.method === 'POST' && url.pathname === '/profil-ajouter') {
        const body = await readBody(req);
        if (!client.guilds.cache.has(body.guildId)) return send(404, { error: 'Serveur introuvable.' });
        const name = String(body.name || '').trim().slice(0, 80);
        if (!name) return send(400, { error: 'Nom du profil requis.' });
        const avatar = String(body.avatarUrl || '').trim();
        if (avatar && !/^https?:\/\/.+/i.test(avatar)) return send(400, { error: 'URL d\'avatar invalide.' });
        insertProfile.run(body.guildId, name, avatar || null);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/profil-suppr') {
        const body = await readBody(req);
        deleteProfile.run(parseInt(body.id, 10), body.guildId);
        return send(200, { ok: true });
      }

      // ----- Publier un panneau de tickets (depuis le dashboard) -----
      // Message + embed personnalisables, envoyés sous un profil (webhook) si choisi.
      if (req.method === 'POST' && url.pathname === '/ticket-panneau') {
        const body = await readBody(req);
        const guild = client.guilds.cache.get(body.guildId);
        if (!guild) return send(404, { error: 'Serveur introuvable.' });
        const channel = guild.channels.cache.get(body.channelId);
        if (!channel?.isTextBased()) return send(400, { error: 'Salon introuvable.' });
        if (!listTicketTypes.all(guild.id).length) return send(400, { error: 'Ajoutez d\'abord au moins une raison de ticket.' });
        const { buildPanelPayload } = require('./utils/tickets');
        const opts = body.options && typeof body.options === 'object' ? body.options : {};
        const payload = buildPanelPayload(guild.id, opts);
        // Profil personnalisé → envoi via webhook (nom + avatar).
        const profile = body.profileId ? getProfile.get(parseInt(body.profileId, 10), guild.id) : null;
        try {
          if (profile) {
            const me = guild.members.me;
            if (!channel.permissionsFor(me)?.has(require('discord.js').PermissionFlagsBits.ManageWebhooks)) {
              return send(400, { error: 'Le bot a besoin de la permission « Gérer les webhooks » dans ce salon pour envoyer sous un profil.' });
            }
            const webhook = await channel.createWebhook({ name: profile.name.slice(0, 80), avatar: profile.avatar_url || undefined });
            const msg = await webhook.send({ ...payload, username: profile.name.slice(0, 80), avatarURL: profile.avatar_url || undefined });
            insertTicketPanel.run(guild.id, channel.id, msg.id, JSON.stringify(opts), webhook.id, webhook.token);
          } else {
            const msg = await channel.send(payload);
            insertTicketPanel.run(guild.id, channel.id, msg.id, JSON.stringify(opts), null, null);
          }
        } catch (err) {
          return send(500, { error: `Publication impossible : ${err.message}` });
        }
        return send(200, { ok: true, note: `Panneau publié dans #${channel.name}.` });
      }

      // Gestion des types de tickets depuis le dashboard.
      if (req.method === 'POST' && url.pathname === '/tickets-type') {
        const body = await readBody(req);
        const guild = client.guilds.cache.get(body.guildId);
        if (!guild) return send(404, { error: 'Serveur introuvable.' });
        const label = String(body.label || '').trim().slice(0, 60);
        if (!label) return send(400, { error: 'Nom du type requis.' });
        if (getTicketTypeByLabel.get(guild.id, label)) return send(400, { error: 'Ce type existe déjà.' });
        if (countTicketTypes.get(guild.id).n >= 25) return send(400, { error: 'Maximum 25 types (limite des boutons Discord).' });
        const category = guild.channels.cache.get(body.categoryId);
        if (!category || category.type !== ChannelType.GuildCategory) return send(400, { error: 'Catégorie invalide.' });
        // Plusieurs rôles support possibles (supportRoleIds) ; compat : supportRoleId.
        const rawRoleIds = Array.isArray(body.supportRoleIds)
          ? body.supportRoleIds
          : (body.supportRoleId ? [body.supportRoleId] : []);
        const roleIds = [...new Set(rawRoleIds.map(String).filter((id) => guild.roles.cache.has(id)))];
        const description = String(body.description || '').trim().slice(0, 100) || null;
        insertTicketType.run(
          guild.id, label, String(body.emoji || '').trim() || null, category.id,
          roleIds[0] || null, description, roleIds.length ? JSON.stringify(roleIds) : null
        );
        return send(200, { ok: true, note: 'Republiez le panneau (/ticket panneau) pour afficher la nouvelle raison.' });
      }
      if (req.method === 'POST' && url.pathname === '/tickets-type-suppr') {
        const body = await readBody(req);
        if (!client.guilds.cache.has(body.guildId)) return send(404, { error: 'Serveur introuvable.' });
        deleteTicketType.run(parseInt(body.id, 10), body.guildId);
        return send(200, { ok: true });
      }

      // Gestion des autorisations de whitelist métiers depuis le dashboard.
      if (req.method === 'POST' && url.pathname === '/whitelist-ajouter') {
        const body = await readBody(req);
        const guild = client.guilds.cache.get(body.guildId);
        if (!guild) return send(404, { error: 'Serveur introuvable.' });
        if (!guild.roles.cache.has(body.roleId) || !guild.roles.cache.has(body.managerRoleId)) {
          return send(400, { error: 'Rôle invalide.' });
        }
        insertWl.run(guild.id, body.roleId, body.managerRoleId);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/whitelist-retirer') {
        const body = await readBody(req);
        if (!client.guilds.cache.has(body.guildId)) return send(404, { error: 'Serveur introuvable.' });
        deleteWl.run(body.guildId, String(body.roleId), String(body.managerRoleId));
        return send(200, { ok: true });
      }

      // ----- Rôle d'un membre vis-à-vis du bot (pour le dashboard web) -----
      // Le dashboard passe l'ID Discord (vérifié par OAuth) : le bot répond
      // s'il est créateur / staff et quelles permissions il a.
      if (req.method === 'GET' && url.pathname === '/whoami') {
        const { isCreator, staffPermsOf } = require('./utils/botTeam');
        const userId = String(url.searchParams.get('userId') || '');
        const creator = await isCreator(client, userId);
        const sp = staffPermsOf(userId);
        return send(200, {
          creator,
          staff: creator || Boolean(sp),
          rank: sp?.rank || (creator ? 'Créateur' : null),
          perms: creator ? ['blacklist', 'tickets', 'staff'] : sp?.perms || [],
        });
      }

      // ----- 🗂️ Base de données : historique permanent des blacklists -----
      if (req.method === 'GET' && url.pathname === '/blacklist-historique') {
        const { listHistory } = require('./utils/botTeam');
        const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
        let rows = listHistory.all().map((r) => ({
          id: r.id,
          userId: r.user_id,
          tag: r.tag || client.users.cache.get(r.user_id)?.tag || null,
          action: r.action,
          reason: r.reason,
          proof: r.proof,
          by: r.by_id,
          at: r.at,
        }));
        if (q) rows = rows.filter((r) => [r.userId, r.tag, r.reason].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
        return send(200, { historique: rows });
      }

      // ----- 🖼️ Preuves : messages récupérés du salon preuves -----
      if (req.method === 'GET' && url.pathname === '/preuves') {
        const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
        let rows = db
          .prepare('SELECT * FROM proof_messages ORDER BY id DESC LIMIT 200')
          .all()
          .map((r) => ({
            id: r.id,
            authorId: r.author_id,
            authorTag: r.author_tag,
            content: r.content,
            attachments: (() => {
              try {
                return JSON.parse(r.attachments || '[]');
              } catch {
                return [];
              }
            })(),
            at: r.at,
          }));
        if (q) rows = rows.filter((r) => [r.authorId, r.authorTag, r.content].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
        return send(200, { preuves: rows });
      }

      // ----- 🚫 Blacklist globale du bot (mode staff du dashboard) -----
      if (url.pathname.startsWith('/blacklist')) {
        const { hasPerm, isCreator, listBlacklistRows, getBlacklistRow, applyBlacklist, removeBlacklist } = require('./utils/botTeam');
        const actorId = String((url.searchParams.get('actorId') || '')).trim();
        if (req.method === 'GET' && url.pathname === '/blacklist') {
          const rows = listBlacklistRows.all().map((r) => ({
            userId: r.user_id,
            tag: client.users.cache.get(r.user_id)?.tag || null,
            reason: r.reason,
            by: r.by_id,
            at: r.at,
          }));
          return send(200, { blacklist: rows });
        }
        // Écritures : réservées aux détenteurs de la permission 🚫 Blacklist.
        const body = await readBody(req);
        const who = String(body.actorId || actorId);
        if (!(await hasPerm(client, who, 'blacklist'))) {
          return send(403, { error: 'Permission 🚫 Blacklist requise.' });
        }
        if (url.pathname === '/blacklist-ajouter') {
          const userId = String(body.userId || '').trim();
          if (!/^\d{5,25}$/.test(userId)) return send(400, { error: 'ID Discord invalide.' });
          if (await isCreator(client, userId)) return send(400, { error: 'Le créateur du bot ne peut pas être blacklisté.' });
          const result = await applyBlacklist(client, userId, String(body.reason || '').slice(0, 500) || null, who, String(body.proof || '').slice(0, 1000) || null);
          if (result.immune) return send(400, { error: 'Utilisateur immunisé (créateur ou liste d\'immunité) — blacklist refusée.' });
          return send(200, { ok: true, tag: result.tag, banned: result.banned, dmOk: result.dmOk });
        }
        if (url.pathname === '/blacklist-retirer') {
          if (!getBlacklistRow.get(String(body.userId || ''))) return send(404, { error: 'Non blacklisté.' });
          const result = await removeBlacklist(client, String(body.userId), who);
          return send(200, { ok: true, unbanned: result.unbanned });
        }
      }

      // ----- 🎫 Tickets de bannissement du QG (mode staff du dashboard) -----
      if (url.pathname.startsWith('/qg')) {
        const { hasPerm, applyBlacklist } = require('./utils/botTeam');
        const setClaim = db.prepare('UPDATE bot_tickets SET status = ?, claimed_by = ? WHERE id = ?');
        const setDone = db.prepare("UPDATE bot_tickets SET status = 'traite', resolution = ?, proof = ? WHERE id = ?");
        const getT = db.prepare('SELECT * FROM bot_tickets WHERE id = ?');
        if (req.method === 'GET' && url.pathname === '/qg-tickets') {
          const rows = db.prepare('SELECT * FROM bot_tickets ORDER BY id DESC LIMIT 100').all().map((t) => ({
            id: t.id, kind: t.kind, guildName: t.guild_name, guildId: t.guild_id,
            targetId: t.target_id, targetTag: t.target_tag, reporterId: t.reporter_id,
            reason: t.reason, status: t.status, claimedBy: t.claimed_by, resolution: t.resolution, at: t.created_at,
          }));
          return send(200, { tickets: rows });
        }
        const body = await readBody(req);
        const who = String(body.actorId || '');
        if (!(await hasPerm(client, who, 'tickets'))) return send(403, { error: 'Permission 🎫 Tickets du QG requise.' });
        const ticket = getT.get(parseInt(body.ticketId, 10));
        if (!ticket) return send(404, { error: 'Ticket introuvable.' });
        if (url.pathname === '/qg-claim') {
          if (ticket.claimed_by && ticket.claimed_by !== who) return send(400, { error: `Déjà claim.` });
          setClaim.run('claim', who, ticket.id);
          return send(200, { ok: true });
        }
        if (url.pathname === '/qg-invite') {
          const guild = client.guilds.cache.get(ticket.guild_id);
          if (!guild) return send(400, { error: 'Le bot n\'est plus sur ce serveur.' });
          const chan = guild.channels.cache.find((c) => c.isTextBased() && !c.isThread() && c.permissionsFor(guild.members.me)?.has(require('discord.js').PermissionFlagsBits.CreateInstantInvite));
          if (!chan) return send(400, { error: 'Le bot ne peut pas créer d\'invitation ici.' });
          const invite = await chan.createInvite({ maxAge: 3600, maxUses: 1, unique: true, reason: `Ticket QG n°${ticket.id}` }).catch(() => null);
          if (!invite) return send(500, { error: 'Création de l\'invitation impossible.' });
          return send(200, { ok: true, url: invite.url });
        }
        if (url.pathname === '/qg-traiter') {
          if (ticket.status === 'traite') return send(400, { error: 'Ticket déjà traité.' });
          if (body.resolution === 'blacklist') {
            if (!(await hasPerm(client, who, 'blacklist'))) return send(403, { error: 'Permission 🚫 Blacklist requise.' });
            const proof = String(body.proof || '').trim();
            if (!proof) return send(400, { error: 'Preuves obligatoires pour appliquer une blacklist.' });
            const result = await applyBlacklist(client, ticket.target_id, `Ticket QG n°${ticket.id}${ticket.reason ? ` — ${ticket.reason}` : ''}`, who, proof.slice(0, 1000));
            if (result.immune) return send(400, { error: 'Utilisateur immunisé — blacklist refusée.' });
            setDone.run('blacklist', proof.slice(0, 1000), ticket.id);
            return send(200, { ok: true, tag: result.tag, banned: result.banned });
          }
          setDone.run('aucune', null, ticket.id);
          return send(200, { ok: true });
        }
      }

      // ----- ⚙️ Configuration du dashboard (créateur du bot) -----
      // Modules affichés + marque, stockés dans app_state (partagés).
      if (url.pathname.startsWith('/dashboard-config')) {
        const { isCreator, state, setState } = require('./utils/botTeam');
        const parse = () => {
          try {
            return JSON.parse(state('dashboard_config') || '{}');
          } catch {
            return {};
          }
        };
        if (req.method === 'GET') return send(200, { config: parse() });
        const body = await readBody(req);
        if (!(await isCreator(client, String(body.actorId || '')))) {
          return send(403, { error: 'Réservé au créateur du bot.' });
        }
        const incoming = body.config && typeof body.config === 'object' ? body.config : {};
        setState('dashboard_config', JSON.stringify(incoming).slice(0, 8000));
        return send(200, { ok: true, config: incoming });
      }

      // ----- 🟢 Statut personnalisé du bot (créateur) -----
      // Type d'activité + texte, appliqués à la présence Discord et mémorisés.
      if (url.pathname.startsWith('/bot-status')) {
        const { isCreator, state, setState } = require('./utils/botTeam');
        const { ActivityType, PresenceUpdateStatus } = require('discord.js');
        const parse = () => {
          try {
            return JSON.parse(state('bot_status') || 'null');
          } catch {
            return null;
          }
        };
        if (req.method === 'GET') {
          return send(200, { status: parse(), tag: client.user.tag });
        }
        const body = await readBody(req);
        if (!(await isCreator(client, String(body.actorId || '')))) {
          return send(403, { error: 'Réservé au créateur du bot.' });
        }
        const cfg = body.status && typeof body.status === 'object' ? body.status : null;
        setState('bot_status', cfg ? JSON.stringify(cfg) : '');
        // Application immédiate.
        try {
          if (!cfg || !cfg.text) {
            client.user.setPresence({ activities: [], status: 'online' });
          } else {
            const typeMap = {
              playing: ActivityType.Playing,
              watching: ActivityType.Watching,
              listening: ActivityType.Listening,
              competing: ActivityType.Competing,
              custom: ActivityType.Custom,
            };
            const presenceMap = {
              online: PresenceUpdateStatus.Online,
              idle: PresenceUpdateStatus.Idle,
              dnd: PresenceUpdateStatus.DoNotDisturb,
              invisible: PresenceUpdateStatus.Invisible,
            };
            const activity = { name: String(cfg.text).slice(0, 128), type: typeMap[cfg.type] ?? ActivityType.Custom };
            if (activity.type === ActivityType.Custom) activity.state = activity.name;
            if (cfg.type === 'streaming' && /^https?:\/\/(www\.)?twitch\.tv\//i.test(cfg.url || '')) {
              activity.type = ActivityType.Streaming;
              activity.url = cfg.url;
            }
            client.user.setPresence({ activities: [activity], status: presenceMap[cfg.presence] || PresenceUpdateStatus.Online });
          }
        } catch (err) {
          return send(500, { error: `Application du statut impossible : ${err.message}` });
        }
        return send(200, { ok: true, status: cfg });
      }

      // ----- 🛡️ Staff du bot (équipe globale, page dédiée du gestionnaire) -----
      // IDs Discord des staffs, grades libres et permissions par personne.
      if (url.pathname.startsWith('/botstaff')) {
        const { PERMS, listStaffRows, getStaffRow, insertStaff, updatePerms, deleteStaff, state, setState } = require('./utils/botTeam');
        const ranks = () => {
          try {
            const list = JSON.parse(state('staff_ranks') || '[]');
            return Array.isArray(list) && list.length ? list : ['Responsable', 'Modérateur'];
          } catch {
            return ['Responsable', 'Modérateur'];
          }
        };
        if (req.method === 'GET' && url.pathname === '/botstaff') {
          const rows = listStaffRows.all();
          const staffList = await Promise.all(
            rows.map(async (row) => {
              const user = await client.users.fetch(row.user_id).catch(() => null);
              let perms = [];
              try {
                perms = JSON.parse(row.perms);
              } catch {}
              return { userId: row.user_id, tag: user?.tag || null, rank: row.rank, perms };
            })
          );
          return send(200, { staff: staffList, grades: ranks(), perms: PERMS });
        }
        if (req.method === 'POST' && url.pathname === '/botstaff-ajouter') {
          const body = await readBody(req);
          const userId = String(body.userId || '').trim();
          if (!/^\d{5,25}$/.test(userId)) return send(400, { error: 'ID Discord invalide (clic droit sur le membre → Copier l\'identifiant).' });
          const rank = String(body.rank || '').trim().slice(0, 50) || ranks()[0];
          insertStaff.run(userId, rank, '[]', 'gestionnaire', new Date().toISOString());
          const user = await client.users.fetch(userId).catch(() => null);
          return send(200, { ok: true, tag: user?.tag || null });
        }
        if (req.method === 'POST' && url.pathname === '/botstaff-retirer') {
          const body = await readBody(req);
          deleteStaff.run(String(body.userId || ''));
          return send(200, { ok: true });
        }
        if (req.method === 'POST' && url.pathname === '/botstaff-perm') {
          const body = await readBody(req);
          const row = getStaffRow.get(String(body.userId || ''));
          if (!row) return send(404, { error: 'Ce membre n\'est pas dans le staff du bot.' });
          if (!(body.perm in PERMS)) return send(400, { error: 'Permission inconnue.' });
          let perms = [];
          try {
            perms = JSON.parse(row.perms);
          } catch {}
          perms = perms.filter((p) => p !== body.perm);
          if (body.on) perms.push(body.perm);
          updatePerms.run(JSON.stringify(perms), row.user_id);
          return send(200, { ok: true, perms });
        }
        if (req.method === 'POST' && url.pathname === '/botstaff-grade') {
          const body = await readBody(req);
          const name = String(body.name || '').trim().slice(0, 50);
          if (!name) return send(400, { error: 'Nom de grade requis.' });
          const list = ranks().filter((g) => g !== name);
          list.push(name);
          setState('staff_ranks', JSON.stringify(list.slice(0, 25)));
          return send(200, { ok: true });
        }
        if (req.method === 'POST' && url.pathname === '/botstaff-grade-suppr') {
          const body = await readBody(req);
          setState('staff_ranks', JSON.stringify(ranks().filter((g) => g !== String(body.name || ''))));
          return send(200, { ok: true });
        }
      }

      // Retrait du bot d'un serveur (demandé depuis la page 🌐 Serveurs du gestionnaire).
      if (req.method === 'POST' && url.pathname === '/leave') {
        const body = await readBody(req);
        const guild = client.guilds.cache.get(String(body.guildId || ''));
        if (!guild) return send(404, { error: 'Serveur introuvable (le bot y est-il encore ?).' });
        const name = guild.name;
        await guild.leave();
        return send(200, { ok: true, name });
      }

      // Retrait d'un ban global (débannit sur tous les serveurs du bot).
      if (req.method === 'POST' && url.pathname === '/ban-retirer') {
        const body = await readBody(req);
        const userId = String(body.userId || '').trim();
        if (!userId) return send(400, { error: 'ID utilisateur requis.' });
        deleteBanStmt.run(userId);
        let count = 0;
        for (const guild of client.guilds.cache.values()) {
          const ok = await guild.members.unban(userId, 'Retrait du ban global via le dashboard').then(() => true).catch(() => false);
          if (ok) count++;
        }
        return send(200, { ok: true, count });
      }

      // Écriture d'un réglage depuis le dashboard.
      if (req.method === 'POST' && url.pathname === '/config') {
        let raw = '';
        req.on('data', (c) => (raw += c));
        await new Promise((resolve) => req.on('end', resolve));
        const body = JSON.parse(raw || '{}');
        if (!client.guilds.cache.has(body.guildId)) return send(404, { error: 'Serveur introuvable.' });
        const key = String(body.key || '');
        if (!(key in CONFIG_KEYS)) return send(400, { error: `Réglage inconnu : ${key}` });
        let value = body.value;
        if (value === '' || value === null || value === undefined) value = null;
        if (CONFIG_KEYS[key] === 'n') {
          value = parseInt(value, 10);
          // Sans borne déclarée, on refuse plutôt que de planter sur un
          // tableau absent (c'est arrivé en ajoutant une clé numérique).
          const [min, max] = NUM_LIMITS[key] || [];
          if (min === undefined) return send(500, { error: `Bornes manquantes pour « ${key} ».` });
          if (Number.isNaN(value)) return send(400, { error: 'Valeur numérique attendue.' });
          value = Math.min(max, Math.max(min, value));
        } else if (CONFIG_KEYS[key] === 'b') {
          value = value ? 1 : 0;
        } else if (CONFIG_KEYS[key] === 't' && value !== null) {
          value = String(value).slice(0, 1500);
        } else if (CONFIG_KEYS[key] === 'j' && value !== null) {
          const ids = (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter((v) => /^\d{5,25}$/.test(v));
          value = ids.length ? JSON.stringify(ids.slice(0, 10)) : null;
        }
        setGuildConfig(body.guildId, key, value);
        // Colonnes historiques mono-rôle synchronisées avec les listes (le
        // grade fusionne les deux : sans ça, un rôle retiré de la liste
        // resterait actif via l'ancienne colonne).
        if (key === 'staff_role_ids' || key === 'admin_role_ids') {
          let first = null;
          try {
            first = JSON.parse(value || '[]')[0] || null;
          } catch {}
          setGuildConfig(body.guildId, key.replace('_ids', '_id'), first);
        }
        // Le Module RP change la liste des commandes du serveur : resynchronisation.
        if (key === 'rp_enabled') {
          require('./commandSync')
            .syncGuild(body.guildId)
            .then((result) => console.log(`🔄 Module RP ${result.rp ? 'activé' : 'désactivé'} — ${result.total} commande(s) synchronisées.`))
            .catch((err) => console.warn(`⚠️ Sync commandes : ${err.message}`));
        }
        return send(200, { ok: true, value });
      }

      if (req.method === 'POST' && url.pathname === '/embed') {
        let raw = '';
        req.on('data', (c) => (raw += c));
        await new Promise((resolve) => req.on('end', resolve));
        const body = JSON.parse(raw || '{}');
        const guild = client.guilds.cache.get(body.guildId);
        const channel = guild?.channels.cache.get(body.channelId);
        if (!channel?.isTextBased()) return send(400, { error: 'Salon introuvable.' });

        const e = body.embed || {};
        const payload = {};
        if (body.content?.trim()) payload.content = String(body.content).slice(0, 2000);
        const hasEmbed = [e.titre, e.description, e.image, e.miniature, e.footer, e.auteur].some((v) => v?.trim?.());
        if (hasEmbed) {
          const embed = new EmbedBuilder();
          const color = String(e.couleur || '').match(/^#?([0-9a-f]{6})$/i);
          embed.setColor(color ? parseInt(color[1], 16) : 0x5865f2);
          if (e.titre?.trim()) embed.setTitle(String(e.titre).slice(0, 256));
          if (e.description?.trim()) embed.setDescription(String(e.description).slice(0, 4000));
          if (e.image?.trim()) embed.setImage(e.image.trim());
          if (e.miniature?.trim()) embed.setThumbnail(e.miniature.trim());
          if (e.footer?.trim()) embed.setFooter({ text: String(e.footer).slice(0, 2048) });
          if (e.auteur?.trim()) {
            embed.setAuthor({ name: String(e.auteur).slice(0, 256), iconURL: e.auteur_icone?.trim() || undefined });
          }
          payload.embeds = [embed];
        }
        if (!payload.content && !payload.embeds) return send(400, { error: 'Message vide : remplissez au moins un champ.' });
        await channel.send(payload);
        return send(200, { ok: true });
      }

      // ----- 🎭 Rattrapage : donner les rôles automatiques à TOUS -----
      // Les membres déjà présents avant la configuration n'ont rien reçu.
      // Cette route les rattrape, sans toucher à ceux qui ont déjà le rôle.
      if (req.method === 'POST' && url.pathname === '/autorole-rattraper') {
        const body = await readBody(req);
        const guild = client.guilds.cache.get(String(body.guildId || ''));
        if (!guild) return send(404, { error: 'Serveur introuvable.' });
        const autoRoles = require('./utils/autoRoles');
        const ids = autoRoles.rolesConfigures(getGuildConfig(guild.id));
        if (!ids.length) return send(400, { error: 'Aucun rôle automatique configuré.' });
        let membres;
        try {
          membres = await guild.members.fetch();
        } catch (err) {
          return send(500, { error: `Impossible de lister les membres : ${err.message}. L'intention « SERVER MEMBERS » est-elle activée pour le bot ?` });
        }
        let traites = 0;
        let deja = 0;
        const echecs = [];
        for (const membre of membres.values()) {
          if (membre.user.bot) continue;
          if (ids.every((id) => membre.roles.cache.has(id))) { deja++; continue; }
          const r = await autoRoles.appliquer(membre, 'Rattrapage des rôles automatiques');
          if (r.donnes.length) traites++;
          else if (r.refuses.length && echecs.length < 3) echecs.push(r.refuses[0].motif);
          // Discord limite le rythme des requêtes : on souffle un peu.
          await new Promise((r2) => setTimeout(r2, 350));
        }
        return send(200, {
          ok: true,
          traites,
          deja,
          total: membres.filter((m) => !m.user.bot).size,
          note: `${traites} membre(s) mis à jour, ${deja} avaient déjà le rôle.`,
          echecs: [...new Set(echecs)],
        });
      }

      // ----- 📨 Envoi d'un message complet composé depuis le site -----
      // Reçoit exactement ce que le créateur a construit : texte, plusieurs
      // embeds (avec champs), boutons et menus déroulants. Sert aussi
      // d'aperçu : « test: true » renvoie le rendu sans rien publier.
      if (req.method === 'POST' && url.pathname === '/message-envoyer') {
        const body = await readBody(req);
        const guild = client.guilds.cache.get(String(body.guildId || ''));
        if (!guild) return send(404, { error: 'Serveur introuvable.' });
        const channel = guild.channels.cache.get(String(body.channelId || ''));
        if (!channel?.isTextBased() || channel.isThread?.()) {
          return send(400, { error: 'Choisissez un salon textuel du serveur.' });
        }
        const me = guild.members.me;
        const { PermissionFlagsBits, ButtonStyle, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder } = require('discord.js');
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return send(400, { error: `Le bot n'a pas le droit d'écrire dans #${channel.name}.` });
        }

        const payload = {};
        if (String(body.content || '').trim()) payload.content = String(body.content).slice(0, 2000);

        // Embeds : autant que Discord en accepte (10 maximum).
        const embeds = [];
        for (const e of (Array.isArray(body.embeds) ? body.embeds : []).slice(0, 10)) {
          const rempli = [e.titre, e.description, e.image, e.miniature, e.footer, e.auteur]
            .some((v) => String(v || '').trim() !== '') || (Array.isArray(e.champs) && e.champs.length);
          if (!rempli) continue;
          const embed = new EmbedBuilder();
          const c = String(e.couleur || '').match(/^#?([0-9a-f]{6})$/i);
          embed.setColor(c ? parseInt(c[1], 16) : 0x5865f2);
          if (String(e.titre || '').trim()) embed.setTitle(String(e.titre).slice(0, 256));
          if (String(e.description || '').trim()) embed.setDescription(String(e.description).slice(0, 4000));
          if (String(e.url || '').trim()) { try { embed.setURL(String(e.url).trim()); } catch {} }
          if (String(e.image || '').trim()) embed.setImage(String(e.image).trim());
          if (String(e.miniature || '').trim()) embed.setThumbnail(String(e.miniature).trim());
          if (String(e.footer || '').trim()) {
            embed.setFooter({ text: String(e.footer).slice(0, 2048), iconURL: String(e.footer_icone || '').trim() || undefined });
          }
          if (String(e.auteur || '').trim()) {
            embed.setAuthor({ name: String(e.auteur).slice(0, 256), iconURL: String(e.auteur_icone || '').trim() || undefined });
          }
          if (e.horodatage) embed.setTimestamp();
          for (const f of (Array.isArray(e.champs) ? e.champs : []).slice(0, 25)) {
            const nom = String(f.nom || '').trim();
            const valeur = String(f.valeur || '').trim();
            if (!nom || !valeur) continue;
            embed.addFields({ name: nom.slice(0, 256), value: valeur.slice(0, 1024), inline: Boolean(f.aligne) });
          }
          embeds.push(embed);
        }
        if (embeds.length) payload.embeds = embeds;

        // Boutons et menus : 5 rangées maximum, 5 boutons par rangée.
        const rows = [];
        const boutons = (Array.isArray(body.boutons) ? body.boutons : []).filter((b) => String(b.label || '').trim());
        const STYLES = { primaire: ButtonStyle.Primary, secondaire: ButtonStyle.Secondary, succes: ButtonStyle.Success, danger: ButtonStyle.Danger };
        for (let i = 0; i < boutons.length && rows.length < 5; i += 5) {
          const row = new ActionRowBuilder();
          for (const b of boutons.slice(i, i + 5)) {
            const bouton = new ButtonBuilder().setLabel(String(b.label).slice(0, 80));
            if (String(b.lien || '').trim()) {
              // Un bouton-lien ne déclenche rien côté bot : Discord l'ouvre.
              try { bouton.setStyle(ButtonStyle.Link).setURL(String(b.lien).trim()); }
              catch { continue; }
            } else {
              bouton.setStyle(STYLES[b.style] || ButtonStyle.Secondary)
                .setCustomId(`site:${String(b.action || 'rien').slice(0, 80)}`);
            }
            if (String(b.emoji || '').trim()) { try { bouton.setEmoji(String(b.emoji).trim()); } catch {} }
            row.addComponents(bouton);
          }
          if (row.components.length) rows.push(row);
        }
        const options = (Array.isArray(body.selecteur) ? body.selecteur : []).filter((o) => String(o.label || '').trim());
        if (options.length && rows.length < 5) {
          const menu = new StringSelectMenuBuilder()
            .setCustomId(`site:menu:${Date.now()}`)
            .setPlaceholder(String(body.selecteurTexte || 'Faites un choix…').slice(0, 150))
            .addOptions(options.slice(0, 25).map((o, i) => ({
              label: String(o.label).slice(0, 100),
              value: String(o.valeur || `option-${i}`).slice(0, 100),
              description: String(o.description || '').slice(0, 100) || undefined,
              emoji: String(o.emoji || '').trim() || undefined,
            })));
          rows.push(new ActionRowBuilder().addComponents(menu));
        }
        if (rows.length) payload.components = rows;

        if (!payload.content && !payload.embeds) {
          return send(400, { error: 'Message vide : écrivez un texte ou remplissez un embed.' });
        }
        if (body.test) return send(200, { ok: true, apercu: true, note: 'Rendu valide — rien n\'a été publié.' });

        // Profil d'envoi (nom + avatar personnalisés) via webhook.
        const profile = body.profileId ? getProfile.get(parseInt(body.profileId, 10), guild.id) : null;
        try {
          if (profile) {
            if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageWebhooks)) {
              return send(400, { error: 'Le bot a besoin de « Gérer les webhooks » dans ce salon pour envoyer sous un profil.' });
            }
            const webhook = await channel.createWebhook({ name: profile.name.slice(0, 80), avatar: profile.avatar_url || undefined });
            const msg = await webhook.send({ ...payload, username: profile.name.slice(0, 80), avatarURL: profile.avatar_url || undefined });
            return send(200, { ok: true, messageId: msg.id, note: `Message publié dans #${channel.name}.` });
          }
          const msg = await channel.send(payload);
          return send(200, { ok: true, messageId: msg.id, note: `Message publié dans #${channel.name}.` });
        } catch (err) {
          return send(500, { error: `Publication impossible : ${err.message}` });
        }
      }

      send(404, { error: 'Route inconnue.' });
    } catch (err) {
      send(500, { error: String(err.message || err) });
    }
  });

  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    try {
      fs.writeFileSync(path.join(baseDir, 'api.port'), String(port));
    } catch {}
    console.log(`🔌 API locale du gestionnaire prête (port ${port}).`);
  });
}

module.exports = { startManagedApi };
