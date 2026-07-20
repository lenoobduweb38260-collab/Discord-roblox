const http = require('http');
const fs = require('fs');
const path = require('path');

// API locale (127.0.0.1, port aléatoire) démarrée uniquement quand le bot est
// lancé par le Gestionnaire de bots (BOT_MANAGED=1). Elle alimente le
// dashboard et le créateur d'embed de l'interface développeur. Le port est
// écrit dans api.port à côté de l'exécutable pour que le gestionnaire le trouve.

function startManagedApi(client, baseDir) {
  const { EmbedBuilder, ChannelType } = require('discord.js');
  const { db, getGuildConfig, setGuildConfig } = require('./database');

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
    'INSERT INTO ticket_types (guild_id, label, emoji, category_id, support_role_id) VALUES (?, ?, ?, ?, ?)'
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

  // Clés de configuration modifiables depuis le dashboard ('s' = id, 'n' = nombre).
  const CONFIG_KEYS = {
    staff_role_id: 's',
    admin_role_id: 's',
    service_role_id: 's',
    log_channel_id: 's',
    level_channel_id: 's',
    service_channel_id: 's',
    staff_channel_id: 's',
    member_channel_id: 's',
    welcome_message: 't',
    goodbye_message: 't',
    welcome_mention: 'b',
    xp_text: 'n',
    xp_voice: 'n',
    xp_cooldown: 'n',
  };
  const NUM_LIMITS = { xp_text: [1, 1000], xp_voice: [1, 1000], xp_cooldown: [5, 3600] };
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

      if (req.method === 'GET' && url.pathname === '/dashboard') {
        const guild = client.guilds.cache.get(url.searchParams.get('guild'));
        if (!guild) return send(404, { error: 'Serveur introuvable (le bot y est-il ?).' });
        const cfg = getGuildConfig(guild.id);
        const roleName = (id) => (id ? `@${guild.roles.cache.get(id)?.name || id}` : null);
        const chanName = (id) => (id ? `#${guild.channels.cache.get(id)?.name || id}` : null);
        const stats = {};
        for (const [key, stmt] of Object.entries(countStmts)) stats[key] = stmt.get(guild.id).n;
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
        const tickets = listTicketTypes.all(guild.id).map((t) => ({
          id: t.id,
          label: t.label,
          emoji: t.emoji,
          categorie: guild.channels.cache.get(t.category_id)?.name || t.category_id || '?',
          support: t.support_role_id ? guild.roles.cache.get(t.support_role_id)?.name || t.support_role_id : null,
        }));
        const bans = listBans.all().map((b) => ({
          userId: b.user_id,
          name: client.users.cache.get(b.user_id)?.tag || null,
          reason: b.reason,
          at: b.banned_at,
        }));
        return send(200, { config: getGuildConfig(guild.id), roles, channels, categories, whitelist, tickets, bans });
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
        const supportRole = body.supportRoleId ? guild.roles.cache.get(body.supportRoleId) : null;
        insertTicketType.run(guild.id, label, String(body.emoji || '').trim() || null, category.id, supportRole?.id || null);
        return send(200, { ok: true, note: 'Republiez le panneau (/ticket panneau-modifier) pour afficher le nouveau bouton.' });
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
          const [min, max] = NUM_LIMITS[key];
          if (Number.isNaN(value)) return send(400, { error: 'Valeur numérique attendue.' });
          value = Math.min(max, Math.max(min, value));
        } else if (CONFIG_KEYS[key] === 'b') {
          value = value ? 1 : 0;
        } else if (CONFIG_KEYS[key] === 't' && value !== null) {
          value = String(value).slice(0, 1500);
        }
        setGuildConfig(body.guildId, key, value);
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
