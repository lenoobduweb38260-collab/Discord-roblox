const { getGuildConfig, setGuildConfig } = require('../database');

// 🪪 L'identité du bot PAR SERVEUR : pseudo + photo de profil de membre.
//
// Depuis le 10 septembre 2025, Discord laisse un bot poser, serveur par
// serveur, un pseudo, un avatar (et une bannière, une bio) — « Modify
// Current Member », PATCH /guilds/{id}/members/@me. Réponses de commandes,
// cartes, messages de salon : tout ce que le bot envoie dans CE serveur porte
// alors ce profil, sans webhook et sans rien changer à l'envoi. Les MP et les
// autres serveurs gardent le profil global.
//
// Deux sources possibles pour un serveur :
//  • un PROFIL de la liste du créateur (BOT_PROFILS dans le .env, écrit par le
//    site à la création du bot) — choisi d'un clic ;
//  • un nom et une photo PERSONNALISÉS, saisis par le serveur lui-même.

const MAX_AVATAR = 8 * 1024 * 1024;
// Discord n'accepte que PNG, JPG et GIF en « image data » — un webp passe le
// téléchargement puis se fait refuser sans explication utile : on tranche ici.
const MIME_ACCEPTES = new Set(['image/png', 'image/jpeg', 'image/gif']);
// Discord limite les changements de photo (≈ 10 min, code AVATAR_RATE_LIMIT,
// qui est un 400 — pas un 429, donc rien ne le rejoue tout seul).
const ECART_AVATAR = 10 * 60 * 1000;
const dernierAvatar = new Map(); // guildId → dernier changement de photo

// Les profils proposés par le créateur : [{ id, nom, avatar }].
function profils() {
  let brut = process.env.BOT_PROFILS;
  if (!brut) {
    try { brut = require('./botTeam').state('bot_profils'); } catch { brut = null; }
  }
  try {
    const liste = JSON.parse(brut || '[]');
    if (!Array.isArray(liste)) return [];
    return liste
      .map((p, i) => ({
        id: String(p?.id || i + 1),
        nom: String(p?.nom || p?.name || '').trim().slice(0, 32),
        avatar: String(p?.avatar || p?.avatarUrl || '').trim() || null,
      }))
      .filter((p) => p.nom)
      .slice(0, 25);
  } catch {
    return [];
  }
}

// Télécharge la photo et la met au format que Discord attend (data URI).
async function dataUriDepuis(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('l\'adresse de la photo doit commencer par http(s)://');
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'discord-roblox-rp-bot' } });
  if (!res.ok) throw new Error(`la photo n'a pas pu être téléchargée (HTTP ${res.status})`);
  const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!MIME_ACCEPTES.has(type)) {
    throw new Error(`format ${type || 'inconnu'} refusé par Discord — utilisez une image PNG, JPG ou GIF`);
  }
  const donnees = Buffer.from(await res.arrayBuffer());
  if (donnees.length > MAX_AVATAR) throw new Error('photo trop lourde (8 Mo maximum)');
  return `data:${type};base64,${donnees.toString('base64')}`;
}

// La route « membre courant ». `Routes.guildMember(id, '@me')` existe sur
// toute 14.x ; l'équivalent en clair sert aux laboratoires sans discord.js.
function routeMembre(guildId) {
  try {
    const { Routes } = require('discord.js');
    if (typeof Routes?.guildMember === 'function') return Routes.guildMember(guildId, '@me');
  } catch { /* stub sans Routes */ }
  return `/guilds/${guildId}/members/@me`;
}

// Ce que Discord a VRAIMENT dit — plutôt qu'un « Discord a refusé » muet.
function lireErreurDiscord(err) {
  const code = err?.rawError?.errors?.avatar?._errors?.[0]?.code;
  if (code === 'AVATAR_RATE_LIMIT') {
    return 'Discord limite les changements de photo de profil : patientez une dizaine de minutes avant de réessayer';
  }
  if (err?.code === 50013 || err?.status === 403) return 'il me manque la permission « Changer le pseudo » sur ce serveur';
  return err?.rawError?.message || err?.message || 'Discord a refusé';
}

// Applique nom et/ou photo au membre-bot de ce serveur, puis l'enregistre.
// `undefined` = ne pas toucher ; null/'' = retour au profil global.
async function appliquer(guild, { nom, avatarUrl, profil, raison = 'Identité du bot sur ce serveur' } = {}) {
  const body = {};
  if (nom !== undefined) body.nick = String(nom || '').trim().slice(0, 32) || null;
  if (avatarUrl !== undefined) {
    const url = String(avatarUrl || '').trim();
    if (url) {
      const reste = ECART_AVATAR - (Date.now() - (dernierAvatar.get(guild.id) || 0));
      if (reste > 0) throw new Error(`Discord limite les changements de photo : réessayez dans ${Math.ceil(reste / 60000)} min`);
      body.avatar = await dataUriDepuis(url);
    } else {
      body.avatar = null;
    }
  }
  if (Object.keys(body).length) {
    try {
      await guild.client.rest.patch(routeMembre(guild.id), { body, reason: raison });
    } catch (err) {
      throw new Error(lireErreurDiscord(err));
    }
    if (body.avatar) dernierAvatar.set(guild.id, Date.now());
  }
  if (nom !== undefined) setGuildConfig(guild.id, 'bot_nick', body.nick);
  if (avatarUrl !== undefined) setGuildConfig(guild.id, 'bot_avatar_url', String(avatarUrl || '').trim() || null);
  if (profil !== undefined) setGuildConfig(guild.id, 'bot_profil', profil || null);
  return body;
}

// Un profil de la liste du créateur — '' = retour au profil global.
async function appliquerProfil(guild, id) {
  if (!id) return appliquer(guild, { nom: null, avatarUrl: null, profil: null });
  const p = profils().find((x) => x.id === String(id));
  if (!p) throw new Error('profil introuvable dans la liste du bot');
  return appliquer(guild, { nom: p.nom, avatarUrl: p.avatar, profil: p.id });
}

// Le nom sous lequel le bot parle dans CE serveur : son pseudo, sinon son nom.
function nomDuBot(client, guild) {
  return guild?.members?.me?.displayName || client?.user?.username || null;
}

// L'état lisible : ce qui est posé sur ce serveur.
function etat(guild) {
  const cfg = getGuildConfig(guild.id);
  const moi = guild.members?.me;
  return {
    nom: moi?.displayName || guild.client?.user?.username || null,
    nomGlobal: guild.client?.user?.username || null,
    pseudo: moi?.nickname || null,
    avatar: moi?.avatarURL?.({ size: 128 }) || null, // l'avatar PROPRE à ce serveur, sinon null
    profil: cfg.bot_profil || null,
    nomEnregistre: cfg.bot_nick || null,
    avatarEnregistre: cfg.bot_avatar_url || null,
  };
}

module.exports = {
  profils, appliquer, appliquerProfil, nomDuBot, etat, dataUriDepuis, routeMembre,
  MIME_ACCEPTES, ECART_AVATAR, _dernierAvatar: dernierAvatar,
};
