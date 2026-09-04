// 📖 Le journal exhaustif — les DIFFS, en une seule grammaire.
//
// Chaque événement « quelque chose a changé » de Discord livre un avant et un
// après. Ce module les compare et rend des lignes `➜` prêtes pour le journal :
// les gestionnaires d'événements (src/events/*.js) n'ont plus qu'à les poser
// dans un embed. Tout est en accès prudent (`?.`) : selon le cache, l'« avant »
// peut être un objet partiel — un diff raté ne doit jamais casser l'événement.
//
// ⚠️ Volontairement absent : la POSITION des salons. Glisser un salon décale
// tous ceux d'en dessous — un seul geste déclencherait vingt logs.

// Le type d'un salon, en français.
const TYPES_SALON = {
  0: 'texte', 2: 'vocal', 4: 'catégorie', 5: 'annonces',
  10: 'fil d\'annonce', 11: 'fil public', 12: 'fil privé',
  13: 'conférence', 14: 'répertoire', 15: 'forum', 16: 'média',
};
const typeSalon = (type) => TYPES_SALON[type] || `type ${type}`;

const VIDE = '*(vide)*';
const AUCUNE = '*(aucune)*';

// Les noms de permissions d'un bitfield discord.js — [] si l'objet n'en est pas un.
const nomsPermissions = (bits) => (bits && typeof bits.toArray === 'function' ? bits.toArray() : []);

// 👤 Un membre ou un utilisateur, TOUJOURS lisible dans un log.
//
// Une mention `<@id>` seule s'affiche « @utilisateur-inconnu » dès que le
// client Discord du lecteur n'a pas ce membre sous la main — fréquent dans
// les embeds. On écrit donc le nom en clair d'abord, la mention ensuite, et
// l'identifiant en dernier : quoi qu'affiche le client, on sait de qui on parle.
function etiquetteMembre(membreOuUser) {
  const user = membreOuUser?.user ?? membreOuUser;
  const id = membreOuUser?.id ?? user?.id ?? '?';
  const nom = membreOuUser?.displayName ?? user?.globalName ?? user?.username ?? user?.tag ?? null;
  return nom ? `**${nom}** (<@${id}> · \`${id}\`)` : `<@${id}> (\`${id}\`)`;
}

// La même chose quand on n'a QUE l'identifiant sous la main.
const mentionAvecId = (id) => `<@${id}> (\`${id}\`)`;

// ── Salons ────────────────────────────────────────────────────────

function diffSalon(ancien, nouveau) {
  const lignes = [];
  if (ancien?.name !== nouveau?.name) lignes.push(`➜ Nom : **${ancien?.name ?? '?'}** → **${nouveau?.name ?? '?'}**`);
  if ((ancien?.topic ?? null) !== (nouveau?.topic ?? null)) {
    lignes.push(`➜ Sujet : ${ancien?.topic ? `« ${String(ancien.topic).slice(0, 120)} »` : VIDE} → ${nouveau?.topic ? `« ${String(nouveau.topic).slice(0, 120)} »` : VIDE}`);
  }
  if (Boolean(ancien?.nsfw) !== Boolean(nouveau?.nsfw)) lignes.push(`➜ Âge restreint (NSFW) : ${nouveau?.nsfw ? 'oui' : 'non'}`);
  if ((ancien?.rateLimitPerUser ?? 0) !== (nouveau?.rateLimitPerUser ?? 0)) {
    const mot = (s) => (s ? `${s} s` : 'désactivé');
    lignes.push(`➜ Mode lent : ${mot(ancien?.rateLimitPerUser ?? 0)} → ${mot(nouveau?.rateLimitPerUser ?? 0)}`);
  }
  if ((ancien?.parentId ?? null) !== (nouveau?.parentId ?? null)) {
    const mot = (id) => (id ? `<#${id}>` : AUCUNE);
    lignes.push(`➜ Catégorie : ${mot(ancien?.parentId)} → ${mot(nouveau?.parentId)}`);
  }
  if ((ancien?.bitrate ?? null) !== (nouveau?.bitrate ?? null) && nouveau?.bitrate != null) {
    lignes.push(`➜ Qualité audio : ${Math.round((ancien?.bitrate ?? 0) / 1000)} kbps → ${Math.round(nouveau.bitrate / 1000)} kbps`);
  }
  if ((ancien?.userLimit ?? null) !== (nouveau?.userLimit ?? null) && nouveau?.userLimit != null) {
    const mot = (n) => (n ? `${n}` : 'illimitée');
    lignes.push(`➜ Limite de membres : ${mot(ancien?.userLimit ?? 0)} → ${mot(nouveau.userLimit)}`);
  }
  if ((ancien?.rtcRegion ?? null) !== (nouveau?.rtcRegion ?? null)) {
    const mot = (r) => r || 'automatique';
    lignes.push(`➜ Région vocale : ${mot(ancien?.rtcRegion)} → ${mot(nouveau?.rtcRegion)}`);
  }
  lignes.push(...diffPermissionsSalon(ancien, nouveau));
  return lignes;
}

// Les surcharges de permissions, cible par cible.
function diffPermissionsSalon(ancien, nouveau) {
  const anciens = ancien?.permissionOverwrites?.cache ?? new Map();
  const nouveaux = nouveau?.permissionOverwrites?.cache ?? new Map();
  const guildId = nouveau?.guild?.id ?? ancien?.guild?.id ?? null;
  // type 0 = rôle, 1 = membre (OverwriteType de discord.js).
  const cible = (id, sur) => {
    if (guildId && String(id) === String(guildId)) return '@everyone';
    return sur?.type === 1 ? `<@${id}>` : `<@&${id}>`;
  };
  const lignes = [];
  for (const id of new Set([...anciens.keys(), ...nouveaux.keys()])) {
    const a = anciens.get(id);
    const n = nouveaux.get(id);
    if (!a && n) { lignes.push(`➜ Permissions ajoutées pour ${cible(id, n)}`); continue; }
    if (a && !n) { lignes.push(`➜ Permissions retirées pour ${cible(id, a)}`); continue; }
    const avantOk = new Set(nomsPermissions(a.allow));
    const apresOk = new Set(nomsPermissions(n.allow));
    const avantNon = new Set(nomsPermissions(a.deny));
    const apresNon = new Set(nomsPermissions(n.deny));
    const autorise = [...apresOk].filter((p) => !avantOk.has(p));
    const refuse = [...apresNon].filter((p) => !avantNon.has(p));
    const defaut = [...new Set([...avantOk, ...avantNon])].filter((p) => !apresOk.has(p) && !apresNon.has(p));
    const bouts = [];
    if (autorise.length) bouts.push(`✅ ${autorise.join(', ')}`);
    if (refuse.length) bouts.push(`⛔ ${refuse.join(', ')}`);
    if (defaut.length) bouts.push(`↩️ ${defaut.join(', ')}`);
    if (bouts.length) lignes.push(`➜ Permissions de ${cible(id, n)} : ${bouts.join(' · ')}`);
  }
  return lignes;
}

// ── Fils de discussion ────────────────────────────────────────────

function diffFil(ancien, nouveau) {
  const lignes = [];
  if (ancien?.name !== nouveau?.name) lignes.push(`➜ Nom : **${ancien?.name ?? '?'}** → **${nouveau?.name ?? '?'}**`);
  if (Boolean(ancien?.archived) !== Boolean(nouveau?.archived)) lignes.push(`➜ ${nouveau?.archived ? 'Archivé' : 'Désarchivé'}`);
  if (Boolean(ancien?.locked) !== Boolean(nouveau?.locked)) lignes.push(`➜ ${nouveau?.locked ? 'Verrouillé' : 'Déverrouillé'}`);
  if ((ancien?.rateLimitPerUser ?? 0) !== (nouveau?.rateLimitPerUser ?? 0)) {
    const mot = (s) => (s ? `${s} s` : 'désactivé');
    lignes.push(`➜ Mode lent : ${mot(ancien?.rateLimitPerUser ?? 0)} → ${mot(nouveau?.rateLimitPerUser ?? 0)}`);
  }
  if ((ancien?.autoArchiveDuration ?? null) !== (nouveau?.autoArchiveDuration ?? null)) {
    lignes.push(`➜ Archivage automatique : ${ancien?.autoArchiveDuration ?? '?'} min → ${nouveau?.autoArchiveDuration ?? '?'} min`);
  }
  return lignes;
}

// ── Membres ───────────────────────────────────────────────────────

function diffMembre(ancien, nouveau) {
  const lignes = [];
  if ((ancien?.nickname ?? null) !== (nouveau?.nickname ?? null)) {
    const mot = (n) => (n ? `**${n}**` : '*(aucun)*');
    lignes.push(`➜ Surnom : ${mot(ancien?.nickname)} → ${mot(nouveau?.nickname)}`);
  }
  const avant = ancien?.roles?.cache ?? new Map();
  const apres = nouveau?.roles?.cache ?? new Map();
  const ajoutes = [...apres.keys()].filter((id) => !avant.has(id));
  const retires = [...avant.keys()].filter((id) => !apres.has(id));
  // Le nom du rôle en clair à côté de la mention : un rôle supprimé depuis
  // s'afficherait « @rôle-supprimé », et l'ID permet de le retrouver.
  const nomRole = (id, depuis) => {
    const role = depuis?.get?.(id);
    return role?.name ? `<@&${id}> (**${role.name}** · \`${id}\`)` : `<@&${id}> (\`${id}\`)`;
  };
  if (ajoutes.length) lignes.push(`➜ Rôles ajoutés : ${ajoutes.map((id) => nomRole(id, apres)).join(' · ')}`);
  if (retires.length) lignes.push(`➜ Rôles retirés : ${retires.map((id) => nomRole(id, avant)).join(' · ')}`);
  const exclAvant = ancien?.communicationDisabledUntilTimestamp ?? null;
  const exclApres = nouveau?.communicationDisabledUntilTimestamp ?? null;
  if (exclAvant !== exclApres) {
    if (exclApres && exclApres > Date.now()) lignes.push(`➜ Exclusion temporaire jusqu'au <t:${Math.floor(exclApres / 1000)}:f>`);
    else lignes.push('➜ Exclusion temporaire levée');
  }
  const boostAvant = ancien?.premiumSinceTimestamp ?? null;
  const boostApres = nouveau?.premiumSinceTimestamp ?? null;
  if (Boolean(boostAvant) !== Boolean(boostApres)) {
    lignes.push(boostApres ? '➜ 💎 A commencé à booster le serveur' : '➜ 💎 Ne booste plus le serveur');
  }
  if ((ancien?.avatar ?? null) !== (nouveau?.avatar ?? null)) lignes.push('➜ Avatar de serveur modifié');
  return lignes;
}

// ── Le serveur lui-même ───────────────────────────────────────────

const NIVEAUX_VERIF = { 0: 'aucune', 1: 'faible', 2: 'moyenne', 3: 'haute', 4: 'maximale' };

function diffGuilde(ancienne, nouvelle) {
  const lignes = [];
  if (ancienne?.name !== nouvelle?.name) lignes.push(`➜ Nom : **${ancienne?.name ?? '?'}** → **${nouvelle?.name ?? '?'}**`);
  if ((ancienne?.description ?? null) !== (nouvelle?.description ?? null)) {
    lignes.push(`➜ Description : ${ancienne?.description ? `« ${String(ancienne.description).slice(0, 120)} »` : VIDE} → ${nouvelle?.description ? `« ${String(nouvelle.description).slice(0, 120)} »` : VIDE}`);
  }
  if ((ancienne?.icon ?? null) !== (nouvelle?.icon ?? null)) lignes.push('➜ Icône du serveur modifiée');
  if ((ancienne?.banner ?? null) !== (nouvelle?.banner ?? null)) lignes.push('➜ Bannière du serveur modifiée');
  if ((ancienne?.splash ?? null) !== (nouvelle?.splash ?? null)) lignes.push('➜ Image d\'invitation modifiée');
  if ((ancienne?.vanityURLCode ?? null) !== (nouvelle?.vanityURLCode ?? null)) {
    lignes.push(`➜ URL personnalisée : ${ancienne?.vanityURLCode || AUCUNE} → ${nouvelle?.vanityURLCode || AUCUNE}`);
  }
  if ((ancienne?.ownerId ?? null) !== (nouvelle?.ownerId ?? null)) {
    lignes.push(`➜ 👑 Propriétaire : ${mentionAvecId(ancienne?.ownerId)} → ${mentionAvecId(nouvelle?.ownerId)}`);
  }
  if ((ancienne?.verificationLevel ?? null) !== (nouvelle?.verificationLevel ?? null)) {
    const mot = (n) => NIVEAUX_VERIF[n] ?? n;
    lignes.push(`➜ Niveau de vérification : ${mot(ancienne?.verificationLevel)} → ${mot(nouvelle?.verificationLevel)}`);
  }
  if ((ancienne?.afkChannelId ?? null) !== (nouvelle?.afkChannelId ?? null)) {
    const mot = (id) => (id ? `<#${id}>` : '*(aucun)*');
    lignes.push(`➜ Salon AFK : ${mot(ancienne?.afkChannelId)} → ${mot(nouvelle?.afkChannelId)}`);
  }
  if ((ancienne?.afkTimeout ?? null) !== (nouvelle?.afkTimeout ?? null)) {
    lignes.push(`➜ Délai AFK : ${Math.round((ancienne?.afkTimeout ?? 0) / 60)} min → ${Math.round((nouvelle?.afkTimeout ?? 0) / 60)} min`);
  }
  if ((ancienne?.systemChannelId ?? null) !== (nouvelle?.systemChannelId ?? null)) {
    const mot = (id) => (id ? `<#${id}>` : '*(aucun)*');
    lignes.push(`➜ Salon système : ${mot(ancienne?.systemChannelId)} → ${mot(nouvelle?.systemChannelId)}`);
  }
  if ((ancienne?.rulesChannelId ?? null) !== (nouvelle?.rulesChannelId ?? null)) {
    const mot = (id) => (id ? `<#${id}>` : '*(aucun)*');
    lignes.push(`➜ Salon du règlement : ${mot(ancienne?.rulesChannelId)} → ${mot(nouvelle?.rulesChannelId)}`);
  }
  if ((ancienne?.premiumTier ?? null) !== (nouvelle?.premiumTier ?? null)) {
    lignes.push(`➜ 💎 Palier de boost : ${ancienne?.premiumTier ?? 0} → ${nouvelle?.premiumTier ?? 0}`);
  }
  return lignes;
}

// ── Événements planifiés ──────────────────────────────────────────

const STATUTS_EVENEMENT = { 1: 'planifié', 2: 'en cours', 3: 'terminé', 4: 'annulé' };

function diffEvenement(ancien, nouveau) {
  const lignes = [];
  if (ancien?.name !== nouveau?.name) lignes.push(`➜ Nom : **${ancien?.name ?? '?'}** → **${nouveau?.name ?? '?'}**`);
  if ((ancien?.description ?? null) !== (nouveau?.description ?? null)) lignes.push('➜ Description modifiée');
  if ((ancien?.scheduledStartTimestamp ?? null) !== (nouveau?.scheduledStartTimestamp ?? null) && nouveau?.scheduledStartTimestamp) {
    lignes.push(`➜ Début : <t:${Math.floor(nouveau.scheduledStartTimestamp / 1000)}:f>`);
  }
  if ((ancien?.channelId ?? null) !== (nouveau?.channelId ?? null) && nouveau?.channelId) {
    lignes.push(`➜ Salon : <#${nouveau.channelId}>`);
  }
  const lieuAvant = ancien?.entityMetadata?.location ?? null;
  const lieuApres = nouveau?.entityMetadata?.location ?? null;
  if (lieuAvant !== lieuApres && lieuApres) lignes.push(`➜ Lieu : ${lieuApres}`);
  if ((ancien?.status ?? null) !== (nouveau?.status ?? null)) {
    lignes.push(`➜ Statut : ${STATUTS_EVENEMENT[nouveau?.status] ?? nouveau?.status}`);
  }
  return lignes;
}

module.exports = {
  typeSalon, TYPES_SALON, etiquetteMembre, mentionAvecId,
  diffSalon, diffPermissionsSalon, diffFil, diffMembre, diffGuilde, diffEvenement,
};
