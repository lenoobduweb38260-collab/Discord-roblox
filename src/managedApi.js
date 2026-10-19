const http = require('http');
const fs = require('fs');
const path = require('path');

// API locale (127.0.0.1, port aléatoire) démarrée uniquement quand le bot est
// lancé par le Gestionnaire de bots (BOT_MANAGED=1). Elle alimente le
// dashboard et le créateur d'embed de l'interface développeur. Le port est
// écrit dans api.port à côté de l'exécutable pour que le gestionnaire le trouve.

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
  patch_mention: 's',
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
  antispam_exempt_channels: 'j',
  antispam_exempt_categories: 'j',
  antispam_exempt_filtre: 'b',
  antinuke_enabled: 'b',
  captcha_enabled: 'b',
  interact_enabled: 'b',
  confession_enabled: 'b',
  confession_channel_id: 's',
  sao_enabled: 'b',
  // Apparence des arrivées / départs
  welcome_color: 's',
  welcome_image: 's',
  welcome_avatar: 's',
  welcome_title: 't',
  // Identité visuelle des embeds
  embed_style: 'b',
  embed_accent: 's',
  embed_footer: 'b',
  embed_author: 'b',
  embed_ligne: 'b',
  embed_filet_taille: 'n',
  embed_fusion: 'b',
  embed_cartes: 'b',
  embed_bordure: 's',
  embed_titre: 's',
  embed_banniere: 's',
  embed_timestamp: 'b',
  embed_force_color: 'b',
  welcome_style: 's',
  welcome_rules_channel_id: 's',
  welcome_help_channel_id: 's',
  welcome_banner: 'b',
  welcome_banner_color: 's',
  welcome_fields: 'b',
  goodbye_color: 's',
  goodbye_image: 's',
  goodbye_avatar: 's',
  goodbye_title: 't',
  goodbye_fields: 'b',
  level_image_url: 's',
  // 🪪 Identité du bot par serveur — appliquées à Discord à l'écriture
  // (voir plus bas), pas seulement enregistrées.
  bot_nick: 's',
  bot_avatar_url: 's',
  bot_profil: 's',

  // 📈 XP & niveaux — mêmes clés et mêmes bornes que /config → 📈 XP & niveaux.
  xp_text_min: 'n',
  xp_text_max: 'n',
  xp_longueur_min: 'n',
  xp_vocal_seul: 'b',
  xp_vocal_muet: 'b',
  xp_mult_cumul: 'b',
  xp_mult_global: 'n',
  xp_boost_pourcent: 'n',
  xp_boost_fin: 's',          // date ISO 8601, ou vide (sans fin)
  xp_weekend_pourcent: 'n',
  xp_sao_pourcent: 'n',
  xp_courbe: 's',             // CHOIX_REGLAGES
  xp_niveau_max: 'n',
  level_annonce: 's',         // CHOIX_REGLAGES, vide = automatique
  level_message: 't',
  level_annonce_pas: 'n',
  level_mention: 'b',
  level_rewards_stack: 'b',
  level_reset_depart: 'b',
  // 🎲 Mini-jeux
  jeux_enabled: 'b',
  jeux_desactives: 's',       // clés du catalogue séparées par des virgules
  jeux_xp_victoire: 'n',
  jeux_xp_bot: 'n',
  jeux_xp_plafond: 'n',
  jeux_col_victoire: 'n',
  // 🔢 Comptage
  comptage_channel_id: 's',
  comptage_meme_personne: 'b',
  comptage_maths: 'b',
  comptage_reactions: 'b',
  comptage_supprimer: 'b',
  comptage_role_erreur: 's',
  comptage_xp: 'n',
  // 💍 Mariage
  mariage_avantages: 'b',
  mariage_bonus_xp: 'n',
  mariage_lune_de_miel_jours: 'n',
  mariage_bisou_xp: 'n',
  mariage_actif_minutes: 'n',
  mariage_salon_id: 's',
  // ⚔️ Aventure SAO (sao_enabled plus haut)
  sao_salon_id: 's',
  sao_raid_heures: 'n',
  sao_pvp: 'b',
  sao_chasse_delai: 'n',
  sao_afk: 'b',
  sao_afk_heures: 'n',
  sao_mort_penalite: 'n',
  sao_difficulte: 's',        // CHOIX_REGLAGES
};

// Bornes des réglages numériques : une clé 'n' sans borne est refusée.
const NUM_LIMITS = {
  xp_text: [1, 1000], xp_voice: [1, 1000], xp_cooldown: [5, 3600],
  captcha_max_essais: [1, 10],
  embed_filet_taille: [6, 30],
  xp_text_min: [0, 1000], xp_text_max: [1, 1000], xp_longueur_min: [0, 2000],
  xp_mult_global: [0, 1000], xp_boost_pourcent: [0, 1000], xp_weekend_pourcent: [0, 1000],
  xp_sao_pourcent: [0, 1000], xp_niveau_max: [0, 1000], level_annonce_pas: [1, 100],
  jeux_xp_victoire: [0, 1000], jeux_xp_bot: [0, 1000], jeux_xp_plafond: [0, 10000], jeux_col_victoire: [0, 10000],
  comptage_xp: [0, 1000],
  mariage_bonus_xp: [0, 100], mariage_lune_de_miel_jours: [0, 60], mariage_bisou_xp: [0, 1000], mariage_actif_minutes: [1, 120],
  sao_raid_heures: [0, 168], sao_chasse_delai: [5, 300], sao_afk_heures: [1, 24], sao_mort_penalite: [0, 50],
};
// Nombres qu'on peut vider : vide = « pas de tirage », l'XP fixe revient.
const NUM_VIDABLES = new Set(['xp_text_min', 'xp_text_max']);
// Longueur maximale d'un texte ('t'). Au-delà : refusé, jamais coupé.
const TEXTE_MAX = 1500;
// Valeurs permises d'un réglage à choix. Vide (null) = le défaut du bot.
const CHOIX_REGLAGES = {
  xp_courbe: ['mee6', 'douce', 'raide', 'lineaire'],
  level_annonce: ['salon', 'ici', 'mp', 'off'],
  sao_difficulte: ['facile', 'normal', 'difficile', 'heroique'],
};
// Rôles que le bot DONNE lui-même : il faut qu'il puisse les attribuer.
const ROLES_DONNES = new Set(['comptage_role_erreur']);

// Le catalogue des mini-jeux, chargé à la demande (il tire la base).
const clesJeux = () => require('./utils/jeux/parties').CLES_JEUX;

// Contrôles propres à certains réglages, après la conversion de type.
// Rend `{ valeur }` (normalisée) ou `{ erreur }`.
function normaliserReglageDashboard(cle, valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return { valeur: null };
  if (CHOIX_REGLAGES[cle]) {
    const v = String(valeur).trim();
    if (!CHOIX_REGLAGES[cle].includes(v)) {
      return { erreur: `Valeur inconnue pour ${cle} : « ${v.slice(0, 40)} ». Possibles : ${CHOIX_REGLAGES[cle].join(', ')}.` };
    }
    return { valeur: v };
  }
  if (cle === 'xp_boost_fin') {
    const v = String(valeur).trim();
    const iso = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v);
    const t = iso ? Date.parse(v) : NaN;
    // Un jour qui n'existe pas (31 février) serait reporté au mois suivant.
    const [a, m, j] = v.slice(0, 10).split('-').map(Number);
    const jourReel = new Date(Date.UTC(a, m - 1, j));
    const calendrier = jourReel.getUTCFullYear() === a && jourReel.getUTCMonth() === m - 1 && jourReel.getUTCDate() === j;
    if (Number.isNaN(t) || !calendrier || t < Date.UTC(2000, 0, 1) || t > Date.UTC(2100, 0, 1)) {
      return { erreur: 'Fin du boost : date ISO 8601 attendue (ex. 2026-10-25T20:00:00Z), ou vide pour un boost sans fin.' };
    }
    return { valeur: new Date(t).toISOString() };
  }
  if (cle === 'jeux_desactives') {
    const brut = Array.isArray(valeur) ? valeur : String(valeur).split(',');
    const demandes = [...new Set(brut.map((c) => String(c).trim()).filter(Boolean))];
    const connus = clesJeux();
    const inconnu = demandes.find((c) => !connus.includes(c));
    if (inconnu) return { erreur: `Jeu inconnu : « ${inconnu.slice(0, 40)} ». Possibles : ${connus.join(', ')}.` };
    const liste = connus.filter((c) => demandes.includes(c));
    return { valeur: liste.length ? liste.join(',') : null };
  }
  if (cle === 'level_image_url') {
    const v = String(valeur).trim();
    if (!/^https?:\/\/\S+$/i.test(v) || v.length > 500) {
      return { erreur: 'Image de fond : une adresse http(s) complète est attendue (500 signes au plus).' };
    }
    return { valeur: v };
  }
  return { valeur };
}

// Un rôle que le bot doit donner ou retirer : de ce serveur (déjà vérifié),
// pas géré par une intégration, et sous le plus haut rôle du bot — le même
// contrôle que /config. Rend un message d'erreur, ou null.
function refusRoleDonne(guild, roleId) {
  const role = guild?.roles?.cache?.get?.(String(roleId));
  if (!role) return REFUS_REFERENCE.role(roleId);
  const nom = role.name || role.id;
  if (role.managed) return `Le rôle ${nom} est géré par une intégration : il ne se donne ni ne se retire à la main.`;
  const moi = guild.members?.me;
  const haut = moi?.roles?.highest?.position;
  if (Number.isFinite(haut) && Number(role.position) >= haut) {
    return `Le rôle ${nom} est au-dessus de mon rôle : remontez mon rôle dans Paramètres du serveur → Rôles, puis réessayez.`;
  }
  return null;
}

// 🔒 Les réglages qui désignent un salon, une catégorie ou un rôle.
//
// Le dashboard ne propose que ceux du serveur, mais l'API ne doit pas le
// croire sur parole : le site sert plusieurs serveurs, et quiconque gère le
// serveur B peut lui envoyer n'importe quelle valeur. Un salon du serveur A
// enregistré chez B faisait écrire le bot chez A — confessions anonymes
// comprises, que tout membre de B peut envoyer.
//
// Le genre se lit dans le NOM de la clé : une clé ajoutée demain est couverte
// sans y penser, et un test vérifie qu'aucune n'échappe à la règle. Les noms
// français (`_salon_id`, `_categorie_id`) suivent la même règle ; ceux qui ne
// se devinent pas sont dans la table.
const REFERENCES_NOMMEES = { patch_mention: 'role', comptage_role_erreur: 'role' };
function genreReference(cle) {
  if (REFERENCES_NOMMEES[cle]) return REFERENCES_NOMMEES[cle];
  if (/_category_id$|_categories$|_categorie_id$/.test(cle)) return 'categorie';
  if (/_channel_id$|_channels$|_salon_id$|_salons$/.test(cle)) return 'salon';
  if (/_role_ids?$|_role_remove$/.test(cle)) return 'role';
  return null;
}
// `patch_mention` accepte aussi ces valeurs, qui ne sont pas des rôles.
const MENTIONS_SPECIALES = new Set(['everyone', 'here', 'aucune']);
// Sans identifiant lisible (un objet à la place d'un texte), « demandé ».
const REFUS_REFERENCE = {
  salon: (id) => `Le salon ${id || 'demandé'} n'est pas un salon de ce serveur (supprimé, ou d'un autre serveur) : choisissez-en un dans la liste.`,
  categorie: (id) => `La catégorie ${id || 'demandée'} n'est pas une catégorie de ce serveur (supprimée, ou d'un autre serveur) : choisissez-en une dans la liste.`,
  role: (id) => `Le rôle ${id || 'demandé'} n'est pas un rôle de ce serveur (supprimé, ou d'un autre serveur) : choisissez-en un dans la liste.`,
};

const idsDe = (v) => {
  if (v === null || v === undefined || v === '') return [];
  if (Array.isArray(v)) return v.map(String);
  try {
    const l = JSON.parse(v);
    if (Array.isArray(l)) return l.map(String);
  } catch {}
  return [String(v)];
};

// Vérifie qu'un réglage désigne bien un salon, une catégorie ou un rôle DU
// serveur visé. Rend `{ valeur }` (la valeur à enregistrer) ou `{ erreur }`.
//
// - null (retrait du réglage) passe toujours ;
// - une clé simple étrangère au serveur est refusée ;
// - dans une liste, un identifiant NOUVEAU étranger au serveur est refusé.
//   Celui qui y figurait déjà mais a disparu depuis (salon ou rôle supprimé)
//   n'est pas une erreur de la personne : il est retiré sans bloquer
//   l'enregistrement — sinon un rôle supprimé interdirait de toucher à la
//   liste tant qu'on ne l'a pas repéré.
function verifierReference(guild, cle, valeur, avant = null) {
  const genre = genreReference(cle);
  if (!genre || valeur === null || valeur === undefined || valeur === '') return { valeur };
  const cache = genre === 'role' ? guild?.roles?.cache : guild?.channels?.cache;
  const existe = (id) => Boolean(cache?.has?.(id));
  if (CONFIG_KEYS[cle] === 'j') {
    const ids = idsDe(valeur);
    const anciens = new Set(idsDe(avant));
    const intrus = ids.find((id) => !existe(id) && !anciens.has(id));
    if (intrus) return { erreur: REFUS_REFERENCE[genre](intrus) };
    const gardes = ids.filter(existe);
    return { valeur: gardes.length ? JSON.stringify(gardes) : null };
  }
  const id = ['string', 'number'].includes(typeof valeur) ? String(valeur).trim() : '';
  if (cle === 'patch_mention' && MENTIONS_SPECIALES.has(id)) return { valeur: id };
  if (!existe(id)) return { erreur: REFUS_REFERENCE[genre](id) };
  return { valeur: id };
}

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

  // Nombre maximum d'identifiants par liste (défaut : 10).
  const LIST_LIMITS = { antispam_exempt_channels: 60, antispam_exempt_categories: 30 };
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

  // ── 📈 🎲 🔢 Données des modules pour le tableau de bord ───────────────
  // Une partie qui échoue (module absent d'un vieux bot, table vide…) est
  // simplement omise : la page s'affiche avec le reste.
  const essayer = (f) => { try { return f(); } catch { return undefined; } };
  function listesNiveaux(guild) {
    const L = require('./utils/levels');
    return {
      recompensesNiveau: essayer(() => L.diagnostiquerRecompenses(guild)),
      exclusionsXp: essayer(() => L.listerExclusionsXp(guild.id)),
      multiplicateursXp: essayer(() => L.listerMultiplicateursXp(guild.id)),
    };
  }
  function listesModules(guild) {
    const L = require('./utils/levels');
    const comptage = essayer(() => {
      const C = require('./utils/comptage');
      const salon = getGuildConfig(guild.id).comptage_channel_id || null;
      const e = C.etatComptage(guild.id);
      return {
        salon,
        courant: C.nombreActuelComptage(guild.id, salon),
        record: Number(e.record || 0),
        recordLe: e.record_le || null,
        erreurs: Number(e.erreurs || 0),
        compteurs: C.compterCompteursComptage(guild.id),
        classement: C.classementComptage(guild.id, { limite: 5 }).map((r) => ({
          userId: r.user_id, nom: client.users?.cache?.get(r.user_id)?.username || null, justes: r.justes, erreurs: r.erreurs,
        })),
      };
    });
    return {
      ...listesNiveaux(guild),
      objetsSao: essayer(() => L.objetsSaoNiveau()),
      typesRecompense: L.TYPES_RECOMPENSE_NIVEAU,
      courbesXp: L.COURBES_XP,
      limitesNiveaux: {
        niveau: L.NIVEAU_RECOMPENSE_MAX, recompenses: L.MAX_RECOMPENSES,
        exclusions: L.MAX_EXCLUSIONS_PAR_PORTEE, multiplicateurs: L.MAX_MULTIPLICATEURS,
      },
      comptage,
      jeux: essayer(() => require('./utils/jeux/parties').CATALOGUE_JEUX),
      sao: essayer(() => ({
        joueurs: db.prepare('SELECT COUNT(*) AS n FROM sao_players WHERE guild_id = ?').get(guild.id).n,
        difficultes: require('./utils/sao/formules').DIFFICULTES,
      })),
    };
  }

  // ── Ce qu'un réglage change au-delà de sa colonne — comme /config ───────
  //  • nouveau salon de comptage : le compte repart de 0 (record gardé) et le
  //    salon est prévenu ;
  //  • courbe ou niveau maximum : tous les niveaux sont recalculés, sans
  //    annonce (personne n'a rien gagné, c'est la règle qui a changé).
  // Rend une note pour le site, ou null.
  async function effetReglageDashboard(guild, key, value, acteur) {
    const { sendLog, logEmbed } = require('./utils/embeds');
    const par = /^\d{15,25}$/.test(String(acteur || '')) ? `Par <@${acteur}> (tableau de bord)` : 'Depuis le tableau de bord';
    const journal = (texte) => sendLog(guild, logEmbed('⚙️ Configuration modifiée', `${texte}\n${par}`));
    if (key === 'comptage_channel_id') {
      const C = require('./utils/comptage');
      C.changerSalonComptage(guild.id, value);
      // Comptage coupé : le dernier fautif rend son rôle d'erreur, comme dans /config.
      if (!value) await C.retirerRoleFautifComptage(guild);
      if (value) await C.annoncerComptage(guild, value, C.ANNONCE_SALON_COMPTAGE);
      await journal(`🔢 Salon de comptage → ${value ? `<#${value}>` : '*aucun (comptage coupé)*'}`);
      return value ? 'Compte remis à 0 dans le nouveau salon (record et classement conservés).' : null;
    }
    // comptage_role_erreur : le retrait de l'ancien rôle est lancé dans
    // POST /config AVANT d'écrire le réglage (il doit lire l'ancien).
    if (key === 'xp_courbe' || key === 'xp_niveau_max') {
      const L = require('./utils/levels');
      const n = L.recalculerNiveaux(guild.id);
      // Les rôles des paliers perdus sont repris tout de suite, en arrière-plan.
      L.realignerBaisses(guild).catch(() => null);
      await journal(`📈 ${key === 'xp_courbe' ? `Courbe d'XP → **${value || 'mee6'}**` : `Niveau maximum → ${value || 'aucun'}`} · ${n} niveau(x) recalculé(s).`);
      return `${n} niveau(x) recalculé(s). Les rôles des paliers perdus sont repris dans la foulée.`;
    }
    return null;
  }

  // ── Opérations sur les listes des niveaux (récompenses, exclusions,
  // multiplicateurs) — les fonctions de levels.js, avec les contrôles de
  // /config : salon ou rôle DE CE SERVEUR, et rôle donnable par le bot.
  const LISTES_NIVEAUX = new Set(['/niveau-recompenses', '/xp-exclusions', '/xp-multiplicateurs']);
  async function operationListeNiveaux(guild, chemin, retrait, d) {
    const L = require('./utils/levels');
    const { sendLog, logEmbed, COLORS } = require('./utils/embeds');
    const gid = guild.id;
    const par = /^\d{15,25}$/.test(String(d.acteur || '')) ? `Par <@${d.acteur}> (tableau de bord)` : 'Depuis le tableau de bord';
    const journal = (titre, texte, couleur = COLORS.INFO) => sendLog(guild, logEmbed(titre, `${texte}\n${par}`, couleur));
    const refus = (erreur, code = 400) => ({ code, erreur });
    const cible = String(d.cibleId ?? '').trim();
    // « categorie » est un salon pour l'XP : une catégorie couvre ses salons.
    const typeCible = d.type === 'categorie' ? 'salon' : String(d.type || '');
    const mention = (type, id) => (type === 'role' ? `<@&${id}>` : `<#${id}>`);
    const cibleDuServeur = () => {
      if (typeCible === 'role') return guild.roles?.cache?.has?.(cible) ? null : REFUS_REFERENCE.role(cible);
      if (typeCible === 'salon') return guild.channels?.cache?.has?.(cible) ? null : REFUS_REFERENCE.salon(cible);
      return null; // type inconnu : levels.js le refuse avec son message
    };

    if (chemin === '/niveau-recompenses') {
      if (retrait) {
        const id = Number(d.id);
        const avant = L.listerRecompensesNiveau(gid).find((r) => r.id === id);
        if (!avant || !L.supprimerRecompenseNiveau(gid, id)) return refus('Cette récompense n\'existe déjà plus.', 404);
        await journal('🏅 Récompense de niveau retirée',
          `Niveau **${avant.niveau}** : ${L.libelleRecompenseNiveau(avant)}\n-# Ce qui a déjà été donné reste acquis.`, COLORS.WARNING);
        return { corps: { id } };
      }
      const type = String(d.type || '');
      const valeur = d.valeur === null || d.valeur === undefined ? null : String(d.valeur).trim();
      if (type === 'role' || type === 'role_retrait') {
        if (!guild.roles?.cache?.has?.(valeur)) return refus(REFUS_REFERENCE.role(valeur));
        const souci = refusRoleDonne(guild, valeur);
        if (souci) return refus(souci);
        // 🛡️ Jamais un rôle qui porte un pouvoir (Administrateur, Bannir…),
        // ni un rôle staff ou admin du bot : le même refus que /config.
        const sensible = L.refusRoleRecompense(guild, guild.roles.cache.get(valeur));
        if (sensible) return refus(sensible.replace(/\n➜ /g, ' '));
      }
      if (type === 'objet') {
        const objets = L.objetsSaoNiveau();
        if (!objets.length) return refus('Le catalogue d\'objets de l\'Aventure SAO n\'est pas disponible : les récompenses en Col fonctionnent déjà.');
        if (!objets.some((o) => o.cle === valeur)) return refus(`L'objet « ${String(valeur).slice(0, 40)} » ne fait pas partie des objets proposables en récompense.`);
      }
      const vide = d.quantite === null || d.quantite === undefined || d.quantite === '';
      const r = L.ajouterRecompenseNiveau(gid, { niveau: Number(d.niveau), type, valeur, quantite: vide ? 1 : Number(d.quantite) });
      if (!r.ok) return refus(r.erreur);
      const ajoutee = L.listerRecompensesNiveau(gid).find((x) => x.id === r.id);
      await journal('🏅 Récompense de niveau ajoutée',
        `Niveau **${ajoutee.niveau}** : ${L.libelleRecompenseNiveau(ajoutee)}\n`
        + '-# Les membres qui ont déjà ce niveau la recevront à leur prochain gain, ou avec `/xp synchroniser`.', COLORS.SUCCESS);
      return { corps: { id: r.id } };
    }

    if (chemin === '/xp-exclusions') {
      if (retrait) {
        if (!L.retirerExclusionXp(gid, typeCible, cible)) return refus('Cette exclusion n\'existe déjà plus.', 404);
        await journal('⚙️ Configuration modifiée', `📈 Exclusion d'XP retirée : ${mention(typeCible, cible)}.`);
        return { corps: {} };
      }
      const etranger = cibleDuServeur();
      if (etranger) return refus(etranger);
      const portee = d.portee ? String(d.portee) : 'tout';
      const r = L.ajouterExclusionXp(gid, typeCible, cible, portee);
      if (!r.ok) return refus(r.erreur);
      // Déjà exclue ailleurs : les deux portées se fusionnent en « tout »,
      // jamais l'une n'efface l'autre en silence.
      const fusion = r.avant && r.avant !== portee
        ? `Cette cible était déjà exclue (${r.avant}) : les deux portées sont fusionnées en « tout ».`
        : null;
      await journal('⚙️ Configuration modifiée', `📈 Exclusion d'XP : ${mention(typeCible, cible)} (${r.portee || portee}).${fusion ? `\n-# ${fusion}` : ''}`);
      return { corps: fusion ? { note: fusion } : {} };
    }

    // /xp-multiplicateurs
    if (retrait) {
      if (!L.retirerMultiplicateurXp(gid, typeCible, cible)) return refus('Ce multiplicateur n\'existe déjà plus.', 404);
      await journal('⚙️ Configuration modifiée', `📈 Multiplicateur retiré : ${mention(typeCible, cible)}.`);
      return { corps: {} };
    }
    const etranger = cibleDuServeur();
    if (etranger) return refus(etranger);
    if (d.pourcent === null || d.pourcent === undefined || d.pourcent === '') return refus('Le pourcentage va de 0 à 1000 (100 = normal).');
    const r = L.definirMultiplicateurXp(gid, typeCible, cible, Number(d.pourcent));
    if (!r.ok) return refus(r.erreur);
    await journal('⚙️ Configuration modifiée', `📈 Multiplicateur ${mention(typeCible, cible)} : ${Number(d.pourcent)} %.`);
    return { corps: {} };
  }

  const server = http.createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    try {
      const url = new URL(req.url, 'http://localhost');

      // ⏳ L'API écoute AVANT la connexion à Discord. Tant que le bot n'est
      // pas prêt, on répond 503 en expliquant — le site affiche la cause au
      // lieu d'un « injoignable » mystère.
      if (!client.isReady()) {
        return send(503, {
          error: "Le bot n'est pas encore connecté à Discord : démarrage en cours, token refusé ou coupure réseau — ouvrez sa console chez l'hébergeur pour voir la raison exacte.",
        });
      }

      // 📎 Archives des pièces jointes supprimées.
      // L'API n'écoute que sur 127.0.0.1 : c'est la frontière de sécurité,
      // l'agent de l'hébergeur est le seul à pouvoir l'appeler.
      if (req.method === 'GET' && url.pathname === '/archives') {
        const A = require('./utils/piecesJointes');
        const guildId = String(url.searchParams.get('serveur') || '');
        if (!guildId) return send(400, { error: 'Serveur manquant.' });
        const limite = Math.min(200, Math.max(1, Number(url.searchParams.get('limite')) || 50));
        const depuis = Math.max(0, Number(url.searchParams.get('depuis')) || 0);
        const lignes = A.listerArchives.all(guildId, limite, depuis).map((a) => ({
          id: a.id,
          nom: a.name,
          taille: a.size,
          lisible: A.tailleLisible(a.size),
          type: a.content_type,
          salon: a.channel_id,
          message: a.message_id,
          auteur: a.author_id,
          date: a.created_at,
        }));
        return send(200, { archives: lignes, etat: A.etatArchives() });
      }

      // Téléchargement d'une archive. Le chemin vient de la BASE, jamais de
      // l'appelant : impossible de demander un fichier arbitraire du disque.
      if (req.method === 'GET' && url.pathname === '/archive-fichier') {
        const A = require('./utils/piecesJointes');
        const ligne = A.archiveParId.get(Number(url.searchParams.get('id')) || 0);
        if (!ligne) return send(404, { error: 'Archive introuvable.' });
        // Une double sécurité : le chemin enregistré doit rester DANS le
        // dossier d'archives, même si la base avait été altérée.
        const resolu = path.resolve(ligne.chemin);
        if (!resolu.startsWith(path.resolve(A.DOSSIER) + path.sep)) {
          return send(403, { error: 'Chemin hors du dossier d\'archives.' });
        }
        if (!fs.existsSync(resolu)) return send(410, { error: 'Fichier effacé (rétention ou budget disque).' });
        res.writeHead(200, {
          'Content-Type': ligne.content_type || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(ligne.name)}"`,
          'Content-Length': String(ligne.size),
        });
        return fs.createReadStream(resolu).pipe(res);
      }

      if (req.method === 'GET' && url.pathname === '/infos') {
        const guilds = [...client.guilds.cache.values()].map((g) => ({
          id: g.id,
          name: g.name,
          memberCount: g.memberCount,
          icon: g.iconURL({ size: 64 }),
          channels: [...g.channels.cache.filter((c) => c.isTextBased() && !c.isThread()).values()]
            .map((c) => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          // 🎭 Les rôles attribuables. On écarte @everyone (que personne ne
          // « reçoit ») et les rôles gérés par une intégration, qu'un bot ne
          // peut pas donner : les proposer ne mènerait qu'à un refus.
          roles: [...g.roles.cache.values()]
            .filter((r) => r.id !== g.id && !r.managed)
            .sort((a, b) => b.position - a.position)
            .map((r) => ({ id: r.id, name: r.name, couleur: r.hexColor })),
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
        // 📊 Classement sur le compteur UNIQUE (écrit + vocal réunis), sans
        // les membres partis : le même que /niveau classement.
        const top = require('./utils/levels').classementNiveaux(guild.id).slice(0, 5).map((r) => ({
          user: client.users.cache.get(r.user_id)?.username || r.user_id,
          level: r.level,
          xp: r.xp,
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
        const hautBot = guild.members?.me?.roles?.highest?.position;
        const roles = [...guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed).values()]
          .sort((a, b) => b.position - a.position)
          // `attribuable` : sous le rôle du bot, donc donnable par lui.
          .map((r) => ({ id: r.id, name: r.name, couleur: r.hexColor, attribuable: !Number.isFinite(hautBot) || r.position < hautBot }));
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
        // 🪪 Les profils du bot (nom + photo) définis par le créateur, et
        // l'identité effective sur CE serveur.
        const identite = require('./utils/identiteBot');
        const etatIdentite = identite.etat(guild);
        return send(200, {
          // `bot_profil` : l'identifiant STABLE du profil retrouvé (un ancien
          // numéro de position est traduit). Un profil retiré de la liste
          // donne null : le menu du site retombe sur le profil global — sans
          // en cocher un autre — et `identiteBot.profilRetire` le signale.
          config: { ...getGuildConfig(guild.id), bot_profil: etatIdentite.profil },
          roles, channels, categories, whitelist, tickets, bans, profils,
          profilsBot: identite.profils(), identiteBot: etatIdentite,
          ...listesModules(guild),
        });
      }

      // ----- 📈 Listes des niveaux : récompenses, exclusions, multiplicateurs -----
      // Ajout : POST + corps JSON. Retrait : DELETE (?guild=&id= ou &type=&cible=),
      // ou POST avec { op: 'retirer' } — l'agent de l'hébergeur ne relaie le
      // corps que des POST et des PUT. Chaque réponse rend la liste à jour.
      if (LISTES_NIVEAUX.has(url.pathname) && (req.method === 'POST' || req.method === 'DELETE')) {
        const body = req.method === 'POST' ? await readBody(req) : {};
        const champ = (cle, param = cle) => body[cle] ?? url.searchParams.get(param) ?? null;
        const guild = client.guilds.cache.get(String(champ('guildId', 'guild') || ''));
        if (!guild) return send(404, { error: 'Serveur introuvable.' });
        const retrait = req.method === 'DELETE' || body.op === 'retirer';
        const r = await operationListeNiveaux(guild, url.pathname, retrait, {
          id: champ('id'), niveau: champ('niveau'), type: champ('type'), valeur: champ('valeur'),
          quantite: champ('quantite'), cibleId: champ('cibleId', 'cible'), portee: champ('portee'),
          pourcent: champ('pourcent'), acteur: champ('acteur'),
        });
        if (r.code) return send(r.code, { error: r.erreur });
        return send(200, { ok: true, ...r.corps, ...listesNiveaux(guild) });
      }

      // ----- ⚔️ Réinitialiser l'Aventure SAO (un joueur, ou tout le serveur) -----
      // Irréversible : réservé à l'administration du serveur, comme /config.
      // Le site vérifie les droits et fait confirmer ; on revérifie ici le
      // grade de celui qui agit (sauf l'équipe du site, qui peut ne pas être
      // membre du serveur), et on exige le mot de confirmation.
      if (req.method === 'POST' && url.pathname === '/sao-reinitialiser') {
        const body = await readBody(req);
        const guild = client.guilds.cache.get(String(body.guildId || ''));
        if (!guild) return send(404, { error: 'Serveur introuvable.' });
        if (body.confirmation !== 'REINITIALISER') return send(400, { error: 'Confirmation manquante : rien n\'a été effacé.' });
        const acteur = String(body.acteur || '');
        if (body.equipeSite !== true) {
          const { GRADES, getGrade } = require('./utils/permissions');
          const membre = /^\d{15,25}$/.test(acteur)
            ? guild.members.cache.get(acteur) || (await guild.members.fetch(acteur).catch(() => null))
            : null;
          const admin = membre && (guild.ownerId === membre.id || getGrade(membre, getGuildConfig(guild.id)) >= GRADES.ADMIN);
          if (!admin) return send(403, { error: 'Réservé à l\'administration du serveur : rien n\'a été effacé.' });
        }
        const G = require('./utils/saoGame');
        const { sendLog, logEmbed, COLORS } = require('./utils/embeds');
        const par = /^\d{15,25}$/.test(acteur) ? `Par <@${acteur}> (tableau de bord)` : 'Depuis le tableau de bord';
        if (body.cible === 'serveur') {
          const r = G.reinitialiserServeurSao(guild.id);
          await sendLog(guild, logEmbed('⚙️ Configuration modifiée', `🧨 Aventure SAO réinitialisée (${r.joueurs} personnage(s)).\n${par}`, COLORS.DANGER));
          return send(200, { ok: true, joueurs: r.joueurs, note: `${r.joueurs} personnage(s) effacé(s).` });
        }
        const userId = String(body.userId || '').trim();
        if (!/^\d{15,25}$/.test(userId)) return send(400, { error: 'Identifiant Discord du joueur invalide (clic droit sur le membre → Copier l\'identifiant).' });
        const r = G.reinitialiserJoueurSao(guild.id, userId);
        if (r.existait) await sendLog(guild, logEmbed('⚙️ Configuration modifiée', `🧹 Personnage SAO de <@${userId}> réinitialisé.\n${par}`, COLORS.WARNING));
        return send(200, { ok: true, existait: r.existait, note: r.existait ? 'Personnage effacé.' : 'Ce membre n\'avait pas de personnage ici : rien à effacer.' });
      }

      // 🪪 Profils du bot rechargés À CHAUD : le site vient d'écrire
      // BOT_PROFILS dans le .env, le bot les prend sans redémarrer.
      if (req.method === 'POST' && url.pathname === '/profils-bot') {
        const body = await readBody(req);
        // L'`id` explicite d'un profil est gardé : c'est lui que les serveurs
        // enregistrent (sans lui, l'empreinte du nom en tient lieu).
        const liste = (Array.isArray(body.profils) ? body.profils : [])
          .map((p) => {
            const avatar = String(p?.avatar || '').trim();
            const id = String(p?.id ?? '').trim();
            return {
              nom: String(p?.nom || '').trim().slice(0, 32),
              avatar: /^https?:\/\//i.test(avatar) ? avatar.slice(0, 500) : '',
              ...(/^[A-Za-z0-9_-]{1,32}$/.test(id) ? { id } : {}),
            };
          })
          .filter((p) => p.nom)
          .slice(0, 25);
        const json = JSON.stringify(liste);
        process.env.BOT_PROFILS = json;
        try { require('./utils/botTeam').setState('bot_profils', json); } catch { /* le .env reste la source au démarrage */ }
        return send(200, { ok: true, profils: require('./utils/identiteBot').profils().length });
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
            // 🛡️ Pas d'`avatar` au webhook : discord.js TÉLÉCHARGERAIT ce lien
            // depuis la machine du bot, sans filtre (adresses internes
            // comprises). `avatarURL`, lui, est lu par Discord, pas par nous.
            const webhook = await channel.createWebhook({ name: profile.name.slice(0, 80) });
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
        const demandes = rawRoleIds.map((v) => String(v ?? '').trim()).filter(Boolean);
        const etranger = demandes.find((id) => !guild.roles.cache.has(id));
        if (etranger) return send(400, { error: REFUS_REFERENCE.role(etranger) });
        const roleIds = [...new Set(demandes)];
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
          // Même geste que /unban-bl : l'ancien ban global re-bannirait à
          // l'arrivée, on le lève avec la blacklist.
          db.prepare('DELETE FROM global_bans WHERE user_id = ?').run(String(body.userId));
          return send(200, { ok: true, unbanned: result.unbanned });
        }
      }

      // ----- 🚨 Échantillons anti-scam : mis en commun entre TOUS les bots -----
      // Un échantillon ajouté sur un bot ne valait que pour lui : chaque bot a
      // sa propre base. Le site fait maintenant la mise en commun — il lit les
      // échantillons de chacun et distribue aux autres ceux qui leur manquent.
      // On échange les EMPREINTES (SHA-256 + dHash), pas les images : rien de
      // lourd ne circule, et le bot qui reçoit n'a rien à recalculer.
      if (url.pathname.startsWith('/scam-echantillon')) {
        const { listGlobalSamples, insertSample, GLOBAL_SCOPE } = require('./utils/scamImages');

        if (req.method === 'GET' && url.pathname === '/scam-echantillons') {
          return send(200, {
            echantillons: listGlobalSamples.all(GLOBAL_SCOPE).map((s) => ({
              id: s.id, nom: s.name, sha256: s.sha256, dhash: s.dhash,
              parQui: s.added_by, quand: s.added_at,
            })),
          });
        }

        const body = await readBody(req);
        const sha = String(body.sha256 || '').trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(sha)) return send(400, { error: 'Empreinte SHA-256 invalide.' });
        const deja = db.prepare('SELECT * FROM scam_images WHERE guild_id = ? AND sha256 = ?').get(GLOBAL_SCOPE, sha);

        if (url.pathname === '/scam-echantillon-ajouter') {
          if (deja) return send(200, { ok: true, deja: true, id: deja.id });
          const dhash = String(body.dhash || '').trim();
          const r = insertSample.run(
            GLOBAL_SCOPE,
            String(body.nom || '').slice(0, 120) || null,
            sha,
            /^[01]{64}$/.test(dhash) ? dhash : null,
            String(body.parQui || 'site').slice(0, 25),
            String(body.quand || new Date().toISOString()).slice(0, 40)
          );
          return send(200, { ok: true, deja: false, id: r.lastInsertRowid });
        }

        if (url.pathname === '/scam-echantillon-retirer') {
          if (!deja) return send(200, { ok: true, absent: true });
          db.prepare('DELETE FROM scam_images WHERE guild_id = ? AND sha256 = ?').run(GLOBAL_SCOPE, sha);
          return send(200, { ok: true, absent: false });
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
        if (CONFIG_KEYS[key] === 'n' && !(value === null && NUM_VIDABLES.has(key))) {
          value = parseInt(value, 10);
          // Sans borne déclarée, on refuse plutôt que de planter sur un
          // tableau absent (c'est arrivé en ajoutant une clé numérique).
          const [min, max] = NUM_LIMITS[key] || [];
          if (min === undefined) return send(500, { error: `Bornes manquantes pour « ${key} ».` });
          if (Number.isNaN(value)) return send(400, { error: 'Valeur numérique attendue.' });
          value = Math.min(max, Math.max(min, value));
        } else if (CONFIG_KEYS[key] === 'b') {
          // « 0 », « false » ou « off » envoyés en texte valent bien 0.
          value = value && !['0', 'false', 'off', 'non'].includes(String(value).trim().toLowerCase()) ? 1 : 0;
        } else if (CONFIG_KEYS[key] === 't' && value !== null) {
          value = String(value);
          // Jamais coupé sans le dire : un texte trop long est refusé.
          if (value.length > TEXTE_MAX) {
            return send(400, { error: `Texte trop long : ${value.length} signes, ${TEXTE_MAX} au plus.` });
          }
        } else if (CONFIG_KEYS[key] === 'j' && value !== null) {
          const ids = (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter((v) => /^\d{5,25}$/.test(v));
          // 10 suffit pour des rôles ; une liste d'exemptions couvre parfois
          // tout un serveur, d'où un plafond plus large sur ces clés-là.
          value = ids.length ? JSON.stringify(ids.slice(0, LIST_LIMITS[key] || 10)) : null;
        }
        // 🔒 Un salon, une catégorie ou un rôle : de CE serveur, rien d'autre.
        const reference = verifierReference(
          client.guilds.cache.get(body.guildId), key, value, getGuildConfig(body.guildId)[key]
        );
        if (reference.erreur) return send(400, { error: reference.erreur });
        value = reference.valeur;
        // 🎭 Un rôle que le bot donne lui-même : il doit pouvoir le donner.
        if (ROLES_DONNES.has(key) && value) {
          const serveurCible = client.guilds.cache.get(body.guildId);
          // Le rôle d'erreur du comptage est donné à quiconque casse la
          // série : jamais un rôle porteur de pouvoirs (Administrateur…).
          const souci = refusRoleDonne(serveurCible, value)
            || (key === 'comptage_role_erreur' ? require('./utils/comptage').refusRoleErreurComptage(serveurCible, value) : null);
          if (souci) return send(400, { error: souci });
        }
        // 🧭 Choix, date, liste de jeux, adresse d'image : formes contrôlées.
        const forme = normaliserReglageDashboard(key, value);
        if (forme.erreur) return send(400, { error: forme.erreur });
        value = forme.valeur;
        const avant = getGuildConfig(body.guildId)[key] ?? null;
        // 🪪 Nom / photo / profil du bot : on l'applique à Discord d'abord —
        // enregistrer une photo que Discord refuse mentirait au dashboard.
        if (key === 'bot_nick' || key === 'bot_avatar_url' || key === 'bot_profil') {
          const guild = client.guilds.cache.get(body.guildId);
          try {
            const identite = require('./utils/identiteBot');
            if (key === 'bot_profil') await identite.appliquerProfil(guild, value || '');
            else if (key === 'bot_nick') await identite.appliquer(guild, { nom: value, profil: null });
            else await identite.appliquer(guild, { avatarUrl: value, profil: null });
          } catch (err) {
            return send(400, { error: `Identité du bot : ${err.message}` });
          }
          // La photo : on renvoie ce qui est VRAIMENT enregistré — l'adresse
          // stable de la photo posée sur Discord, jamais une data URI.
          if (key === 'bot_avatar_url') return send(200, { ok: true, value: getGuildConfig(body.guildId).bot_avatar_url ?? null });
          return send(200, { ok: true, value });
        }
        // 🎭 Rôle d'erreur du comptage changé ou vidé : le dernier fautif rend
        // l'ancien, comme dans /config. Lancé AVANT d'écrire : sa partie
        // synchrone lit l'ANCIEN réglage — le seul repère quand la base ne
        // dit pas quel rôle il a reçu (ligne d'avant la colonne role_fautif).
        const retraitComptage = key === 'comptage_role_erreur' && String(avant ?? '') !== String(value ?? '')
          ? require('./utils/comptage').retirerRoleFautifComptage(client.guilds.cache.get(body.guildId), { garder: value })
          : null;
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
        await retraitComptage;
        // Les effets de /config, à l'identique (voir effetReglageDashboard).
        const note = String(avant ?? '') === String(value ?? '')
          ? null
          : await effetReglageDashboard(client.guilds.cache.get(body.guildId), key, value, body.acteur);
        return send(200, note ? { ok: true, value, note } : { ok: true, value });
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

        // Le texte écrit depuis le tableau de bord passe par les balises,
        // exactement comme l'aperçu du site : « && » devient une barre, « &> »
        // une entrée. Sans cela, l'aperçu et le message envoyé divergeraient.
        const balises = require('./utils/balises');
        const t = (v) => balises.appliquer(String(v || '')).trim();

        const payload = {};
        if (t(body.content)) payload.content = t(body.content).slice(0, 2000);

        // Embeds : autant que Discord en accepte (10 maximum).
        const embeds = [];
        for (const e of (Array.isArray(body.embeds) ? body.embeds : []).slice(0, 10)) {
          const rempli = [e.titre, e.description, e.image, e.miniature, e.footer, e.auteur]
            .some((v) => String(v || '').trim() !== '') || (Array.isArray(e.champs) && e.champs.length);
          if (!rempli) continue;
          const embed = new EmbedBuilder();
          const c = String(e.couleur || '').match(/^#?([0-9a-f]{6})$/i);
          embed.setColor(c ? parseInt(c[1], 16) : 0x5865f2);
          if (t(e.titre)) embed.setTitle(t(e.titre).slice(0, 256));
          if (t(e.description)) embed.setDescription(t(e.description).slice(0, 4000));
          if (String(e.url || '').trim()) { try { embed.setURL(String(e.url).trim()); } catch {} }
          if (String(e.image || '').trim()) embed.setImage(String(e.image).trim());
          if (String(e.miniature || '').trim()) embed.setThumbnail(String(e.miniature).trim());
          if (String(e.footer || '').trim()) {
            embed.setFooter({ text: t(e.footer).slice(0, 2048), iconURL: String(e.footer_icone || '').trim() || undefined });
          }
          if (String(e.auteur || '').trim()) {
            embed.setAuthor({ name: t(e.auteur).slice(0, 256), iconURL: String(e.auteur_icone || '').trim() || undefined });
          }
          if (e.horodatage) embed.setTimestamp();
          for (const f of (Array.isArray(e.champs) ? e.champs : []).slice(0, 25)) {
            const nom = t(f.nom);
            const valeur = t(f.valeur);
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
            } else if (/^\d{15,25}$/.test(String(b.role || '').trim())) {
              // 🎭 Bouton qui donne un rôle. L'identifiant du composant PORTE
              // le rôle : le clic est traité sans rien relire en base, donc
              // sans rien à perdre si le bot redémarre. Un rôle d'un autre
              // serveur ne pourrait jamais être donné ici : refusé.
              if (!guild.roles.cache.has(String(b.role).trim())) {
                return send(400, {
                  error: `Le bouton « ${String(b.label).slice(0, 40)} » donne un rôle qui n'existe pas sur ce serveur : `
                    + 'choisissez un rôle de ce serveur dans la liste.',
                });
              }
              bouton.setStyle(STYLES[b.style] || ButtonStyle.Secondary)
                .setCustomId(`rr:${String(b.role).trim()}`);
            } else {
              // ⛔ Ni lien, ni rôle : ce bouton ne ferait RIEN. Publié, il
              // affichait « Échec de l'interaction » à chaque clic — Discord
              // marque en rouge tout composant qui reste sans réponse. Mieux
              // vaut refuser l'envoi et le dire.
              return send(400, {
                error: `Le bouton « ${String(b.label).slice(0, 40)} » ne fait rien : donnez-lui un lien à ouvrir, `
                  + 'ou un rôle à attribuer. Un bouton sans action affiche « Échec de l\'interaction » à chaque clic.',
              });
            }
            if (String(b.emoji || '').trim()) { try { bouton.setEmoji(String(b.emoji).trim()); } catch {} }
            row.addComponents(bouton);
          }
          if (row.components.length) rows.push(row);
        }
        const options = (Array.isArray(body.selecteur) ? body.selecteur : []).filter((o) => String(o.label || '').trim());
        if (options.length && rows.length < 5) {
          // Même règle que pour les boutons : une option qui ne mène à rien
          // laisse le menu sans réponse, donc en échec.
          const sansRole = options.find((o) => !/^\d{15,25}$/.test(String(o.role || '').trim()));
          if (sansRole) {
            return send(400, {
              error: `L'option « ${String(sansRole.label).slice(0, 40)} » du menu ne fait rien : choisissez le rôle `
                + 'qu\'elle doit donner. Une option sans action affiche « Échec de l\'interaction ».',
            });
          }
          const etrangere = options.find((o) => !guild.roles.cache.has(String(o.role).trim()));
          if (etrangere) {
            return send(400, {
              error: `L'option « ${String(etrangere.label).slice(0, 40)} » du menu donne un rôle qui n'existe pas sur ce serveur : `
                + 'choisissez un rôle de ce serveur dans la liste.',
            });
          }
          const menu = new StringSelectMenuBuilder()
            .setCustomId('rrm:1')
            .setPlaceholder(String(body.selecteurTexte || 'Faites un choix…').slice(0, 150))
            .setMinValues(0)
            .setMaxValues(Math.min(options.length, 25))
            .addOptions(options.slice(0, 25).map((o) => ({
              label: String(o.label).slice(0, 100),
              value: String(o.role).trim(),
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
            // 🛡️ Sans `avatar` : voir /ticket-panneau (Discord lit avatarURL lui-même).
            const webhook = await channel.createWebhook({ name: profile.name.slice(0, 80) });
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

module.exports = {
  startManagedApi, CONFIG_KEYS, NUM_LIMITS, CHOIX_REGLAGES, genreReference, verifierReference,
  normaliserReglageDashboard, refusRoleDonne,
};
