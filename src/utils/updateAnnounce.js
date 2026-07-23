const { EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { db, getGuildConfig, setGuildConfig } = require('../database');
const { currentVersion, REPO, HEADERS } = require('../updater');
const { staffRoleIds, adminRoleIds } = require('./permissions');

// Annonces de mise à jour : quand une nouvelle release GitHub est prête, le
// bot l'annonce sur chaque serveur en mentionnant le rôle staff. Le salon
// d'annonce se configure dans /config → Salons ; sans salon configuré, le bot
// crée automatiquement #shadow-logs, visible uniquement du staff (les membres
// avec la permission Administrateur voient le salon dans tous les cas).

const getState = db.prepare('SELECT value FROM app_state WHERE key = ?');
const setState = db.prepare(
  'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
const state = (key) => getState.get(key)?.value || null;

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // vérification toutes les 30 minutes

// Salon d'annonce d'un serveur : celui configuré, sinon un #shadow-logs
// existant, sinon création de #shadow-logs réservé au staff.
async function resolveUpdateChannel(guild) {
  const cfg = getGuildConfig(guild.id);
  const configured = cfg.update_channel_id && guild.channels.cache.get(cfg.update_channel_id);
  if (configured?.isTextBased()) return configured;

  const existing = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === 'shadow-logs'
  );
  if (existing) {
    setGuildConfig(guild.id, 'update_channel_id', existing.id);
    return existing;
  }

  try {
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: guild.members.me?.id || guild.client.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      },
    ];
    for (const roleId of [...staffRoleIds(cfg), ...adminRoleIds(cfg)]) {
      if (roleId && guild.roles.cache.has(roleId)) {
        overwrites.push({
          id: roleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        });
      }
    }
    const channel = await guild.channels.create({
      name: 'shadow-logs',
      type: ChannelType.GuildText,
      permissionOverwrites: overwrites,
      reason: 'Salon des annonces de mise à jour du bot (créé automatiquement, visible du staff uniquement)',
    });
    setGuildConfig(guild.id, 'update_channel_id', channel.id);
    return channel;
  } catch (err) {
    console.warn(`⚠️ Création de #shadow-logs impossible sur ${guild.name} : ${err.message}`);
    return null;
  }
}

// Envoie l'embed sur tous les serveurs, avec mention du rôle staff configuré.
// Avec { track: true }, renvoie les références des messages envoyés (pour les
// supprimer une fois la mise à jour installée).
async function broadcast(client, embed, { track = false } = {}) {
  const sent = [];
  for (const guild of client.guilds.cache.values()) {
    try {
      const channel = await resolveUpdateChannel(guild);
      if (!channel) continue;
      const cfg = getGuildConfig(guild.id);
      const ping = staffRoleIds(cfg)
        .filter((id) => guild.roles.cache.has(id))
        .map((id) => `<@&${id}>`)
        .join(' ');
      const msg = await channel.send({ content: ping || undefined, embeds: [embed] });
      if (track && msg) sent.push({ c: channel.id, m: msg.id });
    } catch (err) {
      console.warn(`⚠️ Annonce de mise à jour impossible sur ${guild.name} : ${err.message}`);
    }
  }
  return sent;
}

// Supprime les messages « mise à jour prête » précédemment envoyés (appelé une
// fois la mise à jour installée).
async function deleteReadyMessages(client) {
  let refs = [];
  try {
    refs = JSON.parse(state('update_ready_msgs') || '[]');
  } catch {}
  for (const ref of refs) {
    try {
      const channel = await client.channels.fetch(ref.c).catch(() => null);
      if (channel?.isTextBased()) await channel.messages.delete(ref.m).catch(() => null);
    } catch {}
  }
  setState.run('update_ready_msgs', '[]');
}

// Une nouvelle release est-elle prête ? (annoncée une seule fois par version)
async function checkReadyUpdate(client) {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: HEADERS });
    if (!res.ok) return;
    const release = await res.json();
    const latest = release.tag_name;
    const current = currentVersion();
    if (!latest || latest === current) return;
    if (state('last_announced_update') === latest) return;
    setState.run('last_announced_update', latest);
    // Nouvelle version annoncée : on nettoie d'abord un éventuel ancien message
    // « prête » resté d'une version précédente.
    await deleteReadyMessages(client);
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('📦 Mise à jour prête !')
      .setDescription(
        `Une nouvelle version du bot est disponible : **${current} → ${latest}**.\n\n` +
          '• `/update` (ou `/forceupdate`) — installer et redémarrer **maintenant**\n' +
          '• Sinon, elle sera installée automatiquement au **prochain redémarrage** du bot.\n\n' +
          '_Ce message disparaîtra automatiquement une fois la mise à jour installée._'
      )
      .setTimestamp()
      .setFooter({ text: 'Annonce automatique de mise à jour' });
    const sent = await broadcast(client, embed, { track: true });
    setState.run('update_ready_msgs', JSON.stringify(sent));
    console.log(`📦 Mise à jour ${latest} annoncée au staff de chaque serveur.`);
  } catch (err) {
    console.warn(`⚠️ Vérification des mises à jour : ${err.message}`);
  }
}

// Le bot vient-il d'être mis à jour ? (comparaison avec la dernière version lancée)
async function announceInstalled(client) {
  const current = currentVersion();
  const last = state('last_running_version');
  setState.run('last_running_version', current);
  if (!last || last === current) return;
  // Le bot vient d'être mis à jour : on retire le message « mise à jour prête »
  // (qui disait qu'il fallait mettre à jour) puis on confirme l'installation.
  await deleteReadyMessages(client);
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Mise à jour installée')
    .setDescription(`Le bot vient d'être mis à jour : **${last} → ${current}**. Tout est en ligne !`)
    .setTimestamp()
    .setFooter({ text: 'Annonce automatique de mise à jour' });
  await broadcast(client, embed);
  console.log(`✅ Installation de ${current} annoncée au staff de chaque serveur.`);
}

// À appeler une fois le bot connecté : annonce d'installation si besoin, puis
// vérification périodique des nouvelles releases.
function start(client) {
  announceInstalled(client).catch(() => null);
  checkReadyUpdate(client).catch(() => null);
  const timer = setInterval(() => checkReadyUpdate(client).catch(() => null), CHECK_INTERVAL_MS);
  timer.unref?.();
}

module.exports = { start, resolveUpdateChannel };
