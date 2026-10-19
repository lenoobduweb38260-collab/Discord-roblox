const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../database');
const { COLORS, sendLog, logEmbed } = require('./embeds');
const { GRADES } = require('./permissions');
const { mettreAJour, suivre } = require('./reponse');
const L = require('./levels');
const M = require('./miseEnPage');

// 📈 /config → XP & niveaux : un tableau de bord et ses rubriques.
//
// Chaque rubrique tient en 5 rangées au plus (limite Discord). Tous les
// identifiants commencent par `cfgniv:` — ils passent donc par le routeur
// du panneau (tout ce qui commence par « cfg »), qui vérifie déjà le grade
// staff. Ce qui touche aux niveaux de TOUT le serveur (courbe, niveau
// maximum, effacement au départ) exige en plus le grade admin.
//
// Les anciens identifiants (cfgxp, cfglvlon/off, cfgrec, cfgrecdel,
// cfgreccumul et leurs formulaires) restent reconnus : un panneau ouvert
// avant la mise à jour mène à la bonne rubrique au lieu d'échouer.

const PAGES_CONFIG_NIVEAUX = {
  gains: { emoji: '⚡', nom: 'Gains', desc: 'XP par message et par minute de vocal, délai, longueur' },
  vocal: { emoji: '🎙️', nom: 'Vocal anti-AFK', desc: 'Seul dans le salon, muet ou sourd' },
  annonces: { emoji: '📢', nom: 'Annonces', desc: 'Où, quel message, à quelle fréquence' },
  recompenses: { emoji: '🏅', nom: 'Récompenses', desc: 'Rôles, Col et objets SAO, messages privés' },
  exclusions: { emoji: '🚫', nom: 'Exclusions', desc: 'Salons, catégories et rôles sans XP' },
  multiplicateurs: { emoji: '✖️', nom: 'Multiplicateurs', desc: 'Rôles et salons qui rapportent plus (ou moins)' },
  courbe: { emoji: '📐', nom: 'Courbe & niveau max', desc: 'La difficulté de chaque niveau' },
  boost: { emoji: '🚀', nom: 'Boost & week-end', desc: 'Bonus temporaires pour tout le serveur' },
};

const ANCIENS_IDS = new Set(['cfgxp', 'cfgxpmodal', 'cfglvlon', 'cfglvloff', 'cfgrec', 'cfgrecdel', 'cfgreccumul', 'cfgrecmodal', 'cfgrecdelmodal']);
const estIdConfigNiveaux = (id) => String(id || '').startsWith('cfgniv:') || ANCIENS_IDS.has(id);

// Interrupteurs : valeur lue quand la colonne est NULL, rubrique d'origine.
const BASCULES = {
  levels_enabled: { defaut: 1, page: 'accueil', libelle: '📊 Système de niveaux' },
  level_reset_depart: { defaut: 0, page: 'accueil', libelle: '🚪 XP effacée au départ d\'un membre', admin: true },
  xp_vocal_seul: { defaut: 0, page: 'vocal', libelle: '👤 XP vocale même seul' },
  xp_vocal_muet: { defaut: 0, page: 'vocal', libelle: '🔇 XP vocale même muet ou sourd' },
  level_mention: { defaut: 1, page: 'annonces', libelle: '🔔 Mention du membre dans l\'annonce' },
  level_rewards_stack: { defaut: 1, page: 'recompenses', libelle: '🧱 Rôles de récompense cumulés' },
  xp_mult_cumul: { defaut: 0, page: 'multiplicateurs', libelle: '➕ Multiplicateurs de rôles cumulés' },
};
const actif = (cfg, cle) => Number(cfg[cle] ?? BASCULES[cle].defaut) === 1 || (cle === 'levels_enabled' && cfg[cle] == null);

const MODES_ANNONCE = {
  defaut: { emoji: '♻️', nom: 'Automatique', desc: 'Le salon des niveaux s\'il est réglé, sinon aucune annonce' },
  salon: { emoji: '📌', nom: 'Salon dédié', desc: 'Toujours dans le salon des niveaux' },
  ici: { emoji: '💬', nom: 'Là où le membre gagne', desc: 'Le salon du message, ou le salon vocal' },
  mp: { emoji: '✉️', nom: 'En message privé', desc: 'Le membre reçoit l\'annonce en MP' },
  off: { emoji: '🔕', nom: 'Aucune annonce', desc: 'Les récompenses sont tout de même données' },
};
const PORTEES = {
  tout: { emoji: '🌐', nom: 'Tout', desc: 'Aucune XP, quelle qu\'en soit la source' },
  texte: { emoji: '✍️', nom: 'Écrit', desc: 'Les messages ne rapportent rien' },
  vocal: { emoji: '🎙️', nom: 'Vocal', desc: 'Les minutes de vocal ne rapportent rien' },
};
const SALONS_XP = [
  ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory, ChannelType.GuildAnnouncement,
  ChannelType.GuildStageVoice, ChannelType.GuildForum,
].filter((t) => t !== undefined);

const nombreFr = (n) => Number(n || 0).toLocaleString('fr-FR');
const facteurFr = (p) => `×${(Number(p) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;
const ouiNon = (v) => (v ? 'oui' : 'non');

function ligneRetour() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgniv:aller:accueil').setLabel('Tableau de bord XP').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cfgback').setLabel('Panneau').setEmoji('⚙️').setStyle(ButtonStyle.Secondary)
  );
}

function boutonBascule(cfg, cle, { court = null } = {}) {
  const on = actif(cfg, cle);
  return new ButtonBuilder()
    .setCustomId(`cfgniv:bascule:${cle}`)
    .setLabel(`${court || BASCULES[cle].libelle.replace(/^\S+\s/, '')} : ${ouiNon(on)}`)
    .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);
}

function enteteVue(titre) {
  return new EmbedBuilder().setColor(COLORS.INFO).setTitle(`📈 XP & niveaux — ${titre}`);
}

// ── Résumés ────────────────────────────────────────────────────────────

function resumeGains(cfg) {
  const fixe = cfg.xp_text_min == null && cfg.xp_text_max == null;
  const bas = Number(cfg.xp_text_min ?? cfg.xp_text ?? 20);
  const haut = Number(cfg.xp_text_max ?? cfg.xp_text ?? 20);
  const texte = fixe ? `**${cfg.xp_text ?? 20}**` : `**${Math.min(bas, haut)} à ${Math.max(bas, haut)}**`;
  const longueur = Number(cfg.xp_longueur_min ?? 0);
  return [
    `✍️ ${texte} XP par message · ⏱️ un gain toutes les **${cfg.xp_cooldown ?? 60}** s`,
    `🎙️ **${cfg.xp_voice ?? 20}** XP par minute de vocal`,
    longueur > 0 ? `📏 messages de **${longueur}** signes au moins` : null,
  ].filter(Boolean).join('\n');
}

function resumeAnnonces(cfg) {
  const brut = ['salon', 'ici', 'mp', 'off'].includes(cfg.level_annonce) ? cfg.level_annonce : 'defaut';
  const mode = MODES_ANNONCE[brut];
  const effectif = L.modeAnnonceNiveau(cfg);
  const pas = Math.max(1, Number(cfg.level_annonce_pas ?? 1) || 1);
  const ou = effectif === 'off'
    ? '*aucune annonce*'
    : effectif === 'mp' ? 'en message privé'
      : effectif === 'ici' ? 'là où le membre gagne'
        : cfg.level_channel_id ? `<#${cfg.level_channel_id}>` : '*salon non réglé : là où le membre gagne*';
  return [
    `${mode.emoji} **${mode.nom}** → ${ou}`,
    `${pas > 1 ? `Tous les **${pas}** niveaux` : 'À chaque niveau'} · mention : ${ouiNon(actif(cfg, 'level_mention'))}`,
    cfg.level_message ? '✏️ Message personnalisé' : '✏️ Message par défaut',
  ].join('\n');
}

function resumeBonus(cfg) {
  const lignes = [];
  if (L.boostXpActif(cfg)) {
    const fin = Date.parse(cfg.xp_boost_fin || '');
    lignes.push(`🚀 Boost **+${cfg.xp_boost_pourcent} %**${Number.isNaN(fin) ? ' (sans fin)' : ` jusqu'au <t:${Math.floor(fin / 1000)}:f>`}`);
  } else lignes.push('🚀 Aucun boost en cours');
  const we = Number(cfg.xp_weekend_pourcent ?? 0) || 0;
  lignes.push(we > 0 ? `🗓️ Week-end : **+${we} %**` : '🗓️ Pas de bonus le week-end');
  return lignes.join('\n');
}

// ── Les vues ───────────────────────────────────────────────────────────

function vueAccueil(guild) {
  const cfg = getGuildConfig(guild.id);
  const on = actif(cfg, 'levels_enabled');
  const recompenses = L.diagnostiquerRecompenses(guild);
  const soucis = recompenses.filter((r) => r.souci).length;
  const exclusions = L.listerExclusionsXp(guild.id);
  const mults = L.listerMultiplicateursXp(guild.id);
  const { courbe, max } = L.courbeXpDe(guild.id);
  const C = L.COURBES_XP[courbe];
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('📈 Configuration — XP & niveaux')
    .setDescription(
      `${on ? '🟢 **Système activé**' : '🔴 **Système désactivé** — plus personne ne gagne d\'XP'}\n`
      + 'Une seule XP par membre : l\'écrit, le vocal, l\'Aventure SAO et les jeux alimentent le même niveau.\n'
      + '➜ Choisissez une rubrique dans le menu.'
    )
    .addFields(
      { name: '⚡ Gains', value: resumeGains(cfg), inline: false },
      {
        name: '🎙️ Vocal anti-AFK',
        value: `Seul : ${actif(cfg, 'xp_vocal_seul') ? 'gagne' : 'ne gagne rien'} · muet ou sourd : ${actif(cfg, 'xp_vocal_muet') ? 'gagne' : 'ne gagne rien'}`,
        inline: false,
      },
      { name: '📢 Annonces', value: resumeAnnonces(cfg), inline: false },
      {
        name: '🏅 Récompenses',
        value: recompenses.length
          ? `**${recompenses.length}** récompense(s)${soucis ? ` · ⚠️ **${soucis}** à vérifier` : ''} · rôles ${actif(cfg, 'level_rewards_stack') ? 'cumulés' : 'remplacés'}`
          : '*Aucune — le bot ne donne rien de lui-même.*',
        inline: false,
      },
      {
        name: '🚫 Exclusions · ✖️ Multiplicateurs',
        value: `${exclusions.length} exclusion(s) · ${mults.length} multiplicateur(s) · toute l'XP ${facteurFr(cfg.xp_mult_global ?? 100)}`,
        inline: false,
      },
      { name: '📐 Courbe', value: `${C.emoji} **${C.nom}**${max ? ` · niveau maximum **${max}**` : ''}`, inline: true },
      { name: '🚀 Bonus', value: resumeBonus(cfg), inline: true },
      {
        name: '🚪 Départ d\'un membre',
        value: actif(cfg, 'level_reset_depart') ? 'Son XP est **effacée**.' : 'Son XP est gardée (il quitte le classement).',
        inline: false,
      }
    );
  const menu = new StringSelectMenuBuilder()
    .setCustomId('cfgniv:menu')
    .setPlaceholder('📈 Choisissez une rubrique…')
    .addOptions(Object.entries(PAGES_CONFIG_NIVEAUX).map(([value, p]) => ({ label: p.nom, value, emoji: p.emoji, description: p.desc })));
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cfgniv:bascule:levels_enabled')
      .setLabel(on ? 'Désactiver les niveaux' : 'Activer les niveaux')
      .setEmoji(on ? '🔴' : '🟢')
      .setStyle(on ? ButtonStyle.Danger : ButtonStyle.Success),
    boutonBascule(cfg, 'level_reset_depart', { court: 'Effacer au départ' })
  );
  const retour = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgback').setLabel('⬅ Retour au panneau').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), boutons, retour] };
}

function vueGains(guild) {
  const cfg = getGuildConfig(guild.id);
  const embed = enteteVue('⚡ Gains')
    .setDescription(
      'Un message rapporte une XP **tirée au hasard** entre le minimum et le maximum (égaux = XP fixe), '
      + 'au plus une fois par délai. Une minute de vocal rapporte son propre gain.\n'
      + '-# Les messages trop courts (« ok », « mdr ») peuvent ne rien rapporter : réglez la longueur minimale.'
    )
    .addFields({ name: 'Réglages actuels', value: resumeGains(cfg) });
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfgniv:ouvrir:gains').setLabel('Modifier les gains').setEmoji('✏️').setStyle(ButtonStyle.Primary)
      ),
      ligneRetour(),
    ],
  };
}

function vueVocal(guild) {
  const cfg = getGuildConfig(guild.id);
  const embed = enteteVue('🎙️ Vocal anti-AFK')
    .setDescription(
      'Chaque minute, chaque membre en vocal gagne l\'XP vocale. Jamais dans le salon AFK, jamais un bot.\n'
      + '➜ **Seul** : un membre seul (ou seul humain avec des bots) ne gagne rien, sauf si vous l\'autorisez.\n'
      + '➜ **Muet ou sourd** : micro ou casque coupé (par lui-même ou par le serveur) — rien, sauf si vous l\'autorisez.'
    )
    .addFields(
      { name: '👤 Seul dans le salon', value: actif(cfg, 'xp_vocal_seul') ? '✅ Gagne de l\'XP' : '⛔ Ne gagne rien', inline: true },
      { name: '🔇 Muet ou sourd', value: actif(cfg, 'xp_vocal_muet') ? '✅ Gagne de l\'XP' : '⛔ Ne gagne rien', inline: true },
      { name: '🎙️ Gain', value: `**${cfg.xp_voice ?? 20}** XP par minute (rubrique ⚡ Gains)`, inline: false }
    );
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        boutonBascule(cfg, 'xp_vocal_seul', { court: 'XP même seul' }),
        boutonBascule(cfg, 'xp_vocal_muet', { court: 'XP même muet ou sourd' })
      ),
      ligneRetour(),
    ],
  };
}

function vueAnnonces(guild) {
  const cfg = getGuildConfig(guild.id);
  const brut = ['salon', 'ici', 'mp', 'off'].includes(cfg.level_annonce) ? cfg.level_annonce : 'defaut';
  const embed = enteteVue('📢 Annonces')
    .addFields(
      { name: 'Réglage', value: resumeAnnonces(cfg) },
      {
        name: '✏️ Message',
        value: cfg.level_message ? M.citation(cfg.level_message, 900) : '*Par défaut :* 🎉 {membre} passe au **niveau {niveau}** !',
      },
      {
        name: '🔤 Variables',
        value: '`{membre}` `{pseudo}` `{niveau}` `{ancien_niveau}` `{xp}` `{rang}` `{recompenses}` `{serveur}`\n'
          + '-# Balises : `&&` une barre · `&& Titre` une section · `&> texte` une entrée ➜ · `\\n` un retour à la ligne.',
      }
    );
  const mode = new StringSelectMenuBuilder()
    .setCustomId('cfgniv:annmode')
    .setPlaceholder('📢 Où annoncer les niveaux…')
    .addOptions(Object.entries(MODES_ANNONCE).map(([value, m]) => ({
      label: m.nom, value, emoji: m.emoji, description: m.desc, default: value === brut,
    })));
  const salon = new ChannelSelectMenuBuilder()
    .setCustomId('cfgniv:annsalon')
    .setPlaceholder('📌 Le salon des annonces de niveau')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1);
  if (cfg.level_channel_id) salon.setDefaultChannels(cfg.level_channel_id);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(mode),
      new ActionRowBuilder().addComponents(salon),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfgniv:ouvrir:annonce').setLabel('Message et fréquence').setEmoji('✏️').setStyle(ButtonStyle.Primary),
        boutonBascule(cfg, 'level_mention', { court: 'Mention' }),
        new ButtonBuilder().setCustomId('cfgniv:apercu').setLabel('Aperçu').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('cfgniv:annreset').setLabel('Message par défaut').setEmoji('♻️').setStyle(ButtonStyle.Secondary)
          .setDisabled(!cfg.level_message)
      ),
      ligneRetour(),
    ],
  };
}

const PAR_PAGE_RECOMPENSES = 25;
function vueRecompenses(guild, { page = 1 } = {}) {
  const cfg = getGuildConfig(guild.id);
  const toutes = L.diagnostiquerRecompenses(guild);
  const pages = Math.max(1, Math.ceil(toutes.length / PAR_PAGE_RECOMPENSES));
  const p = Math.min(Math.max(1, Number(page) || 1), pages);
  const tranche = toutes.slice((p - 1) * PAR_PAGE_RECOMPENSES, p * PAR_PAGE_RECOMPENSES);
  const niveaux = [...new Set(tranche.map((r) => r.niveau))];
  const blocs = niveaux.map((n) => M.bloc(
    `Niveau ${n}`,
    tranche.filter((r) => r.niveau === n).map((r) => `${r.libelle}${r.souci ? ` — ⚠️ *${r.souci}*` : ''}`),
    { prefixe: '🏅', compte: null }
  ));
  const embed = enteteVue('🏅 Récompenses')
    .setDescription(M.borner(
      toutes.length
        ? M.description(blocs)
        : '*Aucune récompense — le bot ne donne rien de lui-même.*\n➜ Ajoutez-en une avec le premier menu.',
      M.MAX_DESCRIPTION - 96
    ))
    .addFields({
      name: actif(cfg, 'level_rewards_stack') ? '🧱 Les rôles s\'ajoutent' : '🔄 Un seul rôle à la fois',
      value: (actif(cfg, 'level_rewards_stack')
        ? 'Chaque palier atteint s\'ajoute aux précédents.'
        : 'Le rôle du plus haut palier atteint remplace les précédents.')
        + '\n-# Col et objets : versés une fois, si l\'Aventure SAO est active. Message privé : au passage du palier.',
    });
  if (pages > 1) embed.setFooter({ text: M.piedDePage({ total: toutes.length, motTotal: 'récompense', page: p, pages, heure: false }) });

  const ajout = new StringSelectMenuBuilder()
    .setCustomId('cfgniv:recajout')
    .setPlaceholder('➕ Ajouter une récompense…')
    .addOptions(Object.entries(L.TYPES_RECOMPENSE_NIVEAU).map(([value, t]) => ({ label: t.nom, value, emoji: t.emoji })));
  const lignes = [new ActionRowBuilder().addComponents(ajout)];
  if (tranche.length) {
    const nomDe = (r) => {
      if (r.roleId) return `@${r.nom || r.roleId}`;
      return r.libelle.replace(/<@&?\d+>|[*`]/g, '').replace(/^\S+\s/, '').trim();
    };
    lignes.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`cfgniv:recsuppr:${p}`)
        .setPlaceholder('🗑 Retirer une récompense…')
        .addOptions(tranche.map((r) => ({
          label: M.borner(`Niv. ${r.niveau} · ${L.TYPES_RECOMPENSE_NIVEAU[r.type]?.nom || r.type}`, 100),
          value: String(r.id),
          description: M.borner(nomDe(r) || '—', 100),
          emoji: L.TYPES_RECOMPENSE_NIVEAU[r.type]?.emoji || '🏅',
        })))
    ));
  }
  const boutons = new ActionRowBuilder().addComponents(boutonBascule(cfg, 'level_rewards_stack', { court: 'Rôles cumulés' }));
  if (pages > 1) {
    boutons.addComponents(
      new ButtonBuilder().setCustomId(`cfgniv:recpage:${p - 1}`).setLabel('Précédentes').setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(p <= 1),
      new ButtonBuilder().setCustomId(`cfgniv:recpage:${p + 1}`).setLabel('Suivantes').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(p >= pages)
    );
  }
  lignes.push(boutons, ligneRetour());
  return { embeds: [embed], components: lignes };
}

// Deuxième étape de l'ajout d'un rôle (donné ou retiré) ou d'un objet SAO.
function vueAjoutRecompense(guild, type) {
  const T = L.TYPES_RECOMPENSE_NIVEAU[type];
  const embed = enteteVue(`${T.emoji} ${T.nom}`);
  const lignes = [];
  if (type === 'objet') {
    const objets = L.objetsSaoNiveau();
    embed.setDescription(
      'Choisissez l\'objet, puis le niveau et la quantité.\n'
      + (getGuildConfig(guild.id).sao_enabled ? '' : '⚠️ *L\'Aventure SAO est désactivée : la récompense ne sera versée qu\'une fois SAO activé.*')
    );
    lignes.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('cfgniv:recobjet')
        .setPlaceholder('🎁 Quel objet ?')
        .addOptions(objets.map((o) => ({
          label: M.borner(o.nom || o.cle, 100), value: String(o.cle), ...(o.emoji ? { emoji: o.emoji } : {}),
        })))
    ));
  } else {
    embed.setDescription(type === 'role'
      ? 'Choisissez le rôle à **donner**, puis le niveau à atteindre.\n-# Le rôle doit être sous le mien et ne pas être géré par une intégration.'
      : 'Choisissez le rôle à **retirer** quand le membre atteint le niveau (un rôle « Nouveau », par exemple).');
    lignes.push(new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId(`cfgniv:recrole:${type}`).setPlaceholder('🎭 Quel rôle ?').setMinValues(1).setMaxValues(1)
    ));
  }
  lignes.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfgniv:aller:recompenses').setLabel('Annuler').setEmoji('⬅️').setStyle(ButtonStyle.Secondary)
  ));
  return { embeds: [embed], components: lignes };
}

function vueExclusions(guild, { portee = 'tout' } = {}) {
  const po = PORTEES[portee] ? portee : 'tout';
  const exclusions = L.listerExclusionsXp(guild.id);
  const liste = (type, p) => exclusions.filter((e) => e.type === type && e.portee === p).map((e) => e.cible_id);
  // Dix mentions au plus par ligne : la liste complète de la portée réglée
  // est dans les menus, et la carte reste sous ses 4000 signes.
  const resumer = (ids, mention) => (ids.length > 10
    ? `${ids.slice(0, 10).map(mention).join(' ')} *… et ${ids.length - 10} autre(s)*`
    : ids.map(mention).join(' '));
  const blocs = Object.entries(PORTEES).map(([cle, P]) => {
    const salons = liste('salon', cle);
    const roles = liste('role', cle);
    const entrees = [
      salons.length ? `Salons : ${resumer(salons, (id) => `<#${id}>`)}` : null,
      roles.length ? `Rôles : ${resumer(roles, (id) => `<@&${id}>`)}` : null,
    ].filter(Boolean);
    return M.bloc(`${P.nom} — ${P.desc.charAt(0).toLowerCase()}${P.desc.slice(1)}`, entrees, { prefixe: P.emoji, compte: null, vide: 'Rien d\'exclu' });
  });
  const embed = enteteVue('🚫 Exclusions')
    .setDescription(M.borner(
      'Une **catégorie** exclut tous ses salons, un **salon** exclut aussi ses fils.\n'
      + `➜ Vous réglez la portée **${PORTEES[po].emoji} ${PORTEES[po].nom}** : cochez les salons et les rôles concernés.\n\n`
      + M.description(blocs),
      M.MAX_DESCRIPTION - 96
    ));
  const choix = new StringSelectMenuBuilder()
    .setCustomId('cfgniv:exportee')
    .setPlaceholder('Portée à régler…')
    .addOptions(Object.entries(PORTEES).map(([value, P]) => ({
      label: P.nom, value, emoji: P.emoji, description: P.desc, default: value === po,
    })));
  const salons = new ChannelSelectMenuBuilder()
    .setCustomId(`cfgniv:exsalon:${po}`)
    .setPlaceholder(`${PORTEES[po].emoji} Salons et catégories exclus (${PORTEES[po].nom.toLowerCase()})`)
    .setChannelTypes(...SALONS_XP)
    .setMinValues(0)
    .setMaxValues(L.MAX_EXCLUSIONS_PAR_PORTEE);
  const salonsActuels = liste('salon', po);
  if (salonsActuels.length) salons.setDefaultChannels(...salonsActuels);
  const roles = new RoleSelectMenuBuilder()
    .setCustomId(`cfgniv:exrole:${po}`)
    .setPlaceholder(`${PORTEES[po].emoji} Rôles exclus (${PORTEES[po].nom.toLowerCase()})`)
    .setMinValues(0)
    .setMaxValues(L.MAX_EXCLUSIONS_PAR_PORTEE);
  const rolesActuels = liste('role', po);
  if (rolesActuels.length) roles.setDefaultRoles(...rolesActuels);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(choix),
      new ActionRowBuilder().addComponents(salons),
      new ActionRowBuilder().addComponents(roles),
      ligneRetour(),
    ],
  };
}

function vueMultiplicateurs(guild) {
  const cfg = getGuildConfig(guild.id);
  const mults = L.listerMultiplicateursXp(guild.id);
  const roles = mults.filter((m) => m.type === 'role');
  const salons = mults.filter((m) => m.type === 'salon');
  const sao = Number(cfg.xp_sao_pourcent ?? 100);
  const embed = enteteVue('✖️ Multiplicateurs')
    .setDescription(M.borner(
      '100 % = normal · 150 % = ×1,5 · 0 % = aucune XP. Les facteurs se multiplient entre eux.\n\n'
      + M.description([
        M.bloc('Rôles', roles.map((m) => `<@&${m.cible_id}> : **${m.pourcent} %** (${facteurFr(m.pourcent)})`), { prefixe: '🎭', compte: null, vide: 'Aucun' }),
        M.bloc('Salons et catégories', salons.map((m) => `<#${m.cible_id}> : **${m.pourcent} %** (${facteurFr(m.pourcent)})`), { prefixe: '💬', compte: null, vide: 'Aucun' }),
        M.bloc('Serveur', [
          `Toutes les sources : **${cfg.xp_mult_global ?? 100} %**`,
          `Part de l'XP SAO versée au niveau : **${sao} %**${sao === 0 ? ' *(aucune)*' : ''}`,
          `Plusieurs rôles : ${actif(cfg, 'xp_mult_cumul') ? '**bonus cumulés** (+50 % et +20 % = +70 %)' : '**le plus haut rôle** seulement'}`,
        ], { prefixe: '🌐', compte: null }),
      ]),
      M.MAX_DESCRIPTION - 96
    ));
  const lignes = [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId('cfgniv:multrole').setPlaceholder('🎭 Multiplicateur pour un rôle…').setMinValues(1).setMaxValues(1)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('cfgniv:multsalon').setPlaceholder('💬 Multiplicateur pour un salon ou une catégorie…')
        .setChannelTypes(...SALONS_XP).setMinValues(1).setMaxValues(1)
    ),
  ];
  if (mults.length) {
    const nom = (m) => (m.type === 'role'
      ? `@${guild.roles?.cache?.get(m.cible_id)?.name || m.cible_id}`
      : `#${guild.channels?.cache?.get(m.cible_id)?.name || m.cible_id}`);
    lignes.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('cfgniv:multsuppr')
        .setPlaceholder('🗑 Retirer un multiplicateur…')
        .addOptions(mults.slice(0, 25).map((m) => ({
          label: M.borner(`${nom(m)} · ${m.pourcent} %`, 100),
          value: `${m.type}:${m.cible_id}`,
          emoji: m.type === 'role' ? '🎭' : '💬',
        })))
    ));
  }
  lignes.push(
    new ActionRowBuilder().addComponents(
      boutonBascule(cfg, 'xp_mult_cumul', { court: 'Rôles cumulés' }),
      new ButtonBuilder().setCustomId('cfgniv:ouvrir:global').setLabel('Serveur et part SAO').setEmoji('🌐').setStyle(ButtonStyle.Primary)
    ),
    ligneRetour()
  );
  return { embeds: [embed], components: lignes };
}

function vueCourbe(guild) {
  const { courbe, max } = L.courbeXpDe(guild.id);
  const repere = [5, 10, 25, 50];
  const embed = enteteVue('📐 Courbe & niveau max')
    .setDescription(
      'La courbe dit combien d\'XP coûte chaque niveau. En changer recalcule le niveau de tout le monde, sans annonce '
      + '(l\'XP de chacun ne bouge pas).\n'
      + `➜ Niveau maximum : ${max ? `**${max}**` : '*aucun*'}\n`
      + '-# 🛡️ Réservé à l\'administration.'
    )
    .addFields(Object.entries(L.COURBES_XP).map(([cle, C]) => ({
      name: `${C.emoji} ${C.nom}${cle === courbe ? ' — ✅ actuelle' : ''}`,
      value: `${C.aide}\n${repere.map((n) => `Niv. ${n} : **${nombreFr(L.totalXpForLevel(n, cle))}**`).join(' · ')} XP`,
      inline: false,
    })));
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('cfgniv:courbe')
          .setPlaceholder('📐 Choisir la courbe…')
          .addOptions(Object.entries(L.COURBES_XP).map(([value, C]) => ({
            label: C.nom, value, emoji: C.emoji, description: M.borner(C.aide, 100), default: value === courbe,
          })))
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfgniv:ouvrir:nivmax').setLabel('Niveau maximum').setEmoji('🔝').setStyle(ButtonStyle.Primary)
      ),
      ligneRetour(),
    ],
  };
}

function vueBoost(guild) {
  const cfg = getGuildConfig(guild.id);
  const enCours = L.boostXpActif(cfg);
  const embed = enteteVue('🚀 Boost & week-end')
    .setDescription(
      'Un **boost** ajoute un pourcentage à toute l\'XP gagnée, pour une durée choisie (un événement, une fête…). '
      + 'Le **bonus du week-end** s\'applique chaque samedi et chaque dimanche, heure de Paris.'
    )
    .addFields({ name: 'En ce moment', value: resumeBonus(cfg) });
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfgniv:ouvrir:boost').setLabel(enCours ? 'Changer le boost' : 'Lancer un boost').setEmoji('🚀').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cfgniv:boostfin').setLabel('Arrêter le boost').setEmoji('⏹️').setStyle(ButtonStyle.Danger).setDisabled(!enCours),
        new ButtonBuilder().setCustomId('cfgniv:ouvrir:weekend').setLabel('Bonus du week-end').setEmoji('🗓️').setStyle(ButtonStyle.Secondary)
      ),
      ligneRetour(),
    ],
  };
}

function vueConfigNiveaux(guild, page = 'accueil', etat = {}) {
  switch (page) {
    case 'gains': return vueGains(guild);
    case 'vocal': return vueVocal(guild);
    case 'annonces': return vueAnnonces(guild);
    case 'recompenses': return vueRecompenses(guild, etat);
    case 'exclusions': return vueExclusions(guild, etat);
    case 'multiplicateurs': return vueMultiplicateurs(guild);
    case 'courbe': return vueCourbe(guild);
    case 'boost': return vueBoost(guild);
    default: return vueAccueil(guild);
  }
}

// ── Formulaires (5 champs au plus, libellés de 45 signes au plus) ───────

function champ(id, label, { valeur = null, requis = true, long = false, max = 6, aide = null } = {}) {
  const t = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(long ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(requis)
    .setMaxLength(max);
  if (valeur !== null && valeur !== undefined && String(valeur) !== '') t.setValue(String(valeur));
  if (aide) t.setPlaceholder(aide);
  return new ActionRowBuilder().addComponents(t);
}

function formulaireNiveaux(nom, cfg, extra = {}) {
  const modal = new ModalBuilder();
  switch (nom) {
    case 'gains': {
      const fixe = cfg.xp_text ?? 20;
      return modal.setCustomId('cfgniv:m:gains').setTitle('⚡ Gains d\'XP').addComponents(
        champ('min', 'XP minimum par message (0 à 1000)', { valeur: cfg.xp_text_min ?? fixe, max: 4 }),
        champ('max', 'XP maximum par message (1 à 1000)', { valeur: cfg.xp_text_max ?? fixe, max: 4 }),
        champ('cooldown', 'Secondes entre deux gains (5 à 3600)', { valeur: cfg.xp_cooldown ?? 60, max: 4 }),
        champ('longueur', 'Signes minimum d\'un message (0 à 2000)', { valeur: cfg.xp_longueur_min ?? 0, max: 4 }),
        champ('vocal', 'XP par minute de vocal (1 à 1000)', { valeur: cfg.xp_voice ?? 20, max: 4 })
      );
    }
    case 'annonce':
      return modal.setCustomId('cfgniv:m:annonce').setTitle('📢 Annonce de niveau').addComponents(
        champ('message', 'Message (vide = message par défaut)', {
          valeur: cfg.level_message, requis: false, long: true, max: 1500,
          aide: '🎉 {membre} passe au niveau {niveau} ! {recompenses}',
        }),
        champ('pas', 'Annoncer tous les N niveaux (1 à 100)', { valeur: cfg.level_annonce_pas ?? 1, max: 3 })
      );
    case 'global':
      return modal.setCustomId('cfgniv:m:global').setTitle('🌐 Multiplicateurs du serveur').addComponents(
        champ('global', 'Toute l\'XP, en % (100 = normal, 0 à 1000)', { valeur: cfg.xp_mult_global ?? 100, max: 4 }),
        champ('sao', 'Part de l\'XP SAO, en % (100 = tout, 0 = rien)', { valeur: cfg.xp_sao_pourcent ?? 100, max: 4 })
      );
    case 'boost':
      return modal.setCustomId('cfgniv:m:boost').setTitle('🚀 Boost temporaire').addComponents(
        champ('pourcent', 'Bonus en % (1 à 1000, 100 = XP doublée)', { valeur: Number(cfg.xp_boost_pourcent ?? 0) || 50, max: 4 }),
        champ('heures', 'Durée en heures (1 à 720, 0 = sans fin)', { valeur: 24, max: 3 })
      );
    case 'weekend':
      return modal.setCustomId('cfgniv:m:weekend').setTitle('🗓️ Bonus du week-end').addComponents(
        champ('pourcent', 'Bonus du samedi et du dimanche, en %', { valeur: cfg.xp_weekend_pourcent ?? 0, max: 4, aide: '0 = aucun bonus, 50 = +50 %' })
      );
    case 'nivmax':
      return modal.setCustomId('cfgniv:m:nivmax').setTitle('🔝 Niveau maximum').addComponents(
        champ('max', 'Niveau maximum (0 = aucun, jusqu\'à 1000)', { valeur: cfg.xp_niveau_max ?? 0, max: 4 })
      );
    case 'rec': {
      // extra : { type, valeur } — le rôle ou l'objet déjà choisi.
      const T = L.TYPES_RECOMPENSE_NIVEAU[extra.type];
      const id = `cfgniv:m:rec:${extra.type}${extra.valeur ? `:${extra.valeur}` : ''}`;
      modal.setCustomId(id).setTitle(`${T.emoji} ${T.nom}`.slice(0, 45));
      modal.addComponents(champ('niveau', `Niveau à atteindre (1 à ${L.NIVEAU_RECOMPENSE_MAX})`, { max: 4, aide: '10' }));
      if (extra.type === 'col') modal.addComponents(champ('quantite', 'Montant de Col (1 à 1 000 000)', { max: 7, aide: '500' }));
      if (extra.type === 'objet') modal.addComponents(champ('quantite', 'Quantité (1 à 999)', { valeur: 1, max: 3 }));
      if (extra.type === 'mp') {
        modal.addComponents(champ('texte', 'Message privé (variables et balises)', {
          long: true, max: 1500, aide: 'Bravo {pseudo}, te voilà niveau {niveau} sur {serveur} !',
        }));
      }
      return modal;
    }
    case 'mult': {
      const actuel = L.listerMultiplicateursXp(extra.guildId).find((m) => m.type === extra.type && m.cible_id === extra.valeur);
      return modal.setCustomId(`cfgniv:m:mult:${extra.type}:${extra.valeur}`)
        .setTitle(extra.type === 'role' ? '🎭 Multiplicateur de rôle' : '💬 Multiplicateur de salon')
        .addComponents(champ('pourcent', 'Pourcentage (100 = normal, 0 à 1000)', { valeur: actuel?.pourcent ?? 150, max: 4 }));
    }
    default:
      return null;
  }
}

// ── Le routeur ─────────────────────────────────────────────────────────

const lireEntier = (interaction, nom) => {
  const brut = String(interaction.fields.getTextInputValue(nom) ?? '').trim().replace(/[\s.]/g, '');
  if (!/^-?\d+$/.test(brut)) return null;
  return parseInt(brut, 10);
};
const prive = (interaction, content) => suivre(interaction, { content, flags: MessageFlags.Ephemeral });
const journal = (interaction, texte, couleur = COLORS.INFO) => sendLog(
  interaction.guild,
  logEmbed('⚙️ Configuration modifiée', `📈 ${texte}\nPar <@${interaction.user.id}>`, couleur)
);
// Un formulaire ouvert depuis le panneau met le panneau à jour ; ouvert
// d'ailleurs, il répond par un mot.
async function afficher(interaction, vue, confirmation = '✅ Réglage enregistré.') {
  if (!interaction.isModalSubmit?.() || interaction.isFromMessage?.()) return mettreAJour(interaction, vue);
  return prive(interaction, confirmation);
}

async function gererConfigNiveaux(interaction, grade) {
  const id = interaction.customId;
  const guild = interaction.guild;
  const gid = interaction.guildId;
  const cfg = getGuildConfig(gid);
  const exigerAdmin = async () => {
    if (grade >= GRADES.ADMIN) return false;
    await prive(interaction, '⛔ Ce réglage change le niveau de tout le serveur : il est réservé à l\'**administration**.');
    return true;
  };

  // ── Anciens identifiants : on mène à la bonne rubrique ───────────────
  if (id === 'cfgxp') return interaction.showModal(formulaireNiveaux('gains', cfg));
  if (id === 'cfglvlon' || id === 'cfglvloff') {
    const on = id === 'cfglvlon' ? 1 : 0;
    setGuildConfig(gid, 'levels_enabled', on);
    await mettreAJour(interaction, vueAccueil(guild));
    await journal(interaction, `Système de niveaux ${on ? 'activé' : 'désactivé'}.`, on ? COLORS.SUCCESS : COLORS.DANGER);
    return;
  }
  if (id === 'cfgrec' || id === 'cfgrecdel') return mettreAJour(interaction, vueRecompenses(guild));
  if (id === 'cfgreccumul') {
    setGuildConfig(gid, 'level_rewards_stack', actif(cfg, 'level_rewards_stack') ? 0 : 1);
    return mettreAJour(interaction, vueRecompenses(guild));
  }
  if (id === 'cfgxpmodal' || id === 'cfgrecmodal' || id === 'cfgrecdelmodal') {
    await afficher(interaction, id === 'cfgxpmodal' ? vueGains(guild) : vueRecompenses(guild));
    return prive(interaction, '⏳ Ce formulaire date d\'une version précédente : rien n\'a été changé.\n'
      + '➜ Refaites le réglage depuis la rubrique affichée.');
  }

  const [, action, a, b] = id.split(':');

  // ── Navigation ───────────────────────────────────────────────────────
  if (action === 'menu') return mettreAJour(interaction, vueConfigNiveaux(guild, interaction.values?.[0]));
  if (action === 'aller') return mettreAJour(interaction, vueConfigNiveaux(guild, a));
  if (action === 'recpage') return mettreAJour(interaction, vueRecompenses(guild, { page: Number(a) }));
  if (action === 'exportee') return mettreAJour(interaction, vueExclusions(guild, { portee: interaction.values?.[0] }));

  // ── Interrupteurs ────────────────────────────────────────────────────
  if (action === 'bascule') {
    const B = BASCULES[a];
    if (!B) return prive(interaction, '❌ Réglage inconnu.');
    if (B.admin && (await exigerAdmin())) return;
    const suivant = actif(cfg, a) ? 0 : 1;
    setGuildConfig(gid, a, suivant);
    await mettreAJour(interaction, vueConfigNiveaux(guild, B.page));
    await journal(interaction, `${B.libelle} : **${ouiNon(suivant)}**.`, a === 'levels_enabled' ? (suivant ? COLORS.SUCCESS : COLORS.DANGER) : COLORS.INFO);
    return;
  }

  // ── Ouvrir un formulaire ─────────────────────────────────────────────
  if (action === 'ouvrir') {
    if (a === 'nivmax' && (await exigerAdmin())) return;
    const modal = formulaireNiveaux(a, cfg);
    if (!modal) return prive(interaction, '❌ Formulaire inconnu.');
    return interaction.showModal(modal);
  }

  // ── Annonces ─────────────────────────────────────────────────────────
  if (action === 'annmode') {
    const choix = interaction.values?.[0];
    const valeur = ['salon', 'ici', 'mp', 'off'].includes(choix) ? choix : null;
    setGuildConfig(gid, 'level_annonce', valeur);
    await mettreAJour(interaction, vueAnnonces(guild));
    await journal(interaction, `Annonces de niveau : **${MODES_ANNONCE[valeur || 'defaut'].nom}**.`);
    return;
  }
  if (action === 'annsalon') {
    const salon = interaction.values?.[0] || null;
    setGuildConfig(gid, 'level_channel_id', salon);
    await mettreAJour(interaction, vueAnnonces(guild));
    await journal(interaction, `Salon des annonces de niveau → ${salon ? `<#${salon}>` : '*retiré*'}.`);
    return;
  }
  if (action === 'annreset') {
    setGuildConfig(gid, 'level_message', null);
    await mettreAJour(interaction, vueAnnonces(guild));
    await journal(interaction, 'Message d\'annonce de niveau remis par défaut.');
    return;
  }
  if (action === 'apercu') {
    const niveau = 5;
    const exemple = [{ libelle: '🎭 **@Membre actif**' }, { libelle: '💰 **500 Col**' }];
    const texte = L.texteAnnonceNiveau(guild, interaction.user.id, {
      source: 'text', niveau, ancien: niveau - 1, recompenses: exemple, membre: interaction.member, cfg,
    });
    const embed = new EmbedBuilder().setColor(COLORS.SUCCESS).setDescription(texte)
      .setFooter({ text: 'Aperçu — rien n\'a été envoyé' });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  // ── Récompenses ──────────────────────────────────────────────────────
  if (action === 'recajout') {
    const type = interaction.values?.[0];
    if (!L.TYPES_RECOMPENSE_NIVEAU[type]) return prive(interaction, '❌ Type de récompense inconnu.');
    if (type === 'col' || type === 'mp') return interaction.showModal(formulaireNiveaux('rec', cfg, { type }));
    if (type === 'objet' && !L.objetsSaoNiveau().length) {
      return prive(interaction, '❌ Le catalogue d\'objets de l\'Aventure SAO n\'est pas disponible.\n'
        + '➜ Les récompenses en **Col** fonctionnent déjà ; les objets arriveront avec la mise à jour de SAO.');
    }
    return mettreAJour(interaction, vueAjoutRecompense(guild, type));
  }
  if (action === 'recrole') {
    const type = a === 'role_retrait' ? 'role_retrait' : 'role';
    const roleId = interaction.values?.[0];
    const role = guild.roles.cache.get(roleId);
    if (!role) return prive(interaction, '❌ Rôle introuvable : choisissez-en un autre.');
    const moi = guild.members.me;
    if (role.managed) return prive(interaction, `❌ **${role.name}** est géré par une intégration : il ne se donne ni ne se retire à la main.`);
    if (moi && role.position >= moi.roles.highest.position) {
      return prive(interaction, `❌ **${role.name}** est au-dessus de mon rôle : je ne pourrai pas le ${type === 'role' ? 'donner' : 'retirer'}.\n`
        + '➜ Remontez mon rôle dans **Paramètres du serveur → Rôles**, puis réessayez.');
    }
    return interaction.showModal(formulaireNiveaux('rec', cfg, { type, valeur: role.id }));
  }
  if (action === 'recobjet') {
    const cle = interaction.values?.[0];
    if (!/^[\w-]{1,64}$/.test(cle || '')) return prive(interaction, '❌ Objet inconnu.');
    return interaction.showModal(formulaireNiveaux('rec', cfg, { type: 'objet', valeur: cle }));
  }
  if (action === 'recsuppr') {
    const recId = Number(interaction.values?.[0]);
    const avant = L.listerRecompensesNiveau(gid).find((r) => r.id === recId);
    if (!avant || !L.supprimerRecompenseNiveau(gid, recId)) return prive(interaction, '❌ Cette récompense n\'existe déjà plus.');
    await mettreAJour(interaction, vueRecompenses(guild, { page: Number(a) || 1 }));
    // ⚠️ Un rôle déjà donné n'est PAS repris : le retirer sans prévenir
    // serait pire que de laisser la trace d'un palier supprimé.
    await sendLog(guild, logEmbed('🏅 Récompense de niveau retirée',
      `Niveau **${avant.niveau}** : ${L.libelleRecompenseNiveau(avant)}\nPar <@${interaction.user.id}>\n-# Ce qui a déjà été donné reste acquis.`,
      COLORS.WARNING));
    return;
  }

  // ── Exclusions ───────────────────────────────────────────────────────
  if (action === 'exsalon' || action === 'exrole') {
    const portee = PORTEES[a] ? a : 'tout';
    const type = action === 'exsalon' ? 'salon' : 'role';
    const r = L.remplacerExclusionsXp(gid, type, portee, interaction.values || []);
    await mettreAJour(interaction, vueExclusions(guild, { portee }));
    if (r.ajoutes || r.retires) {
      await journal(interaction, `Exclusions d'XP (${type === 'salon' ? 'salons' : 'rôles'}, ${PORTEES[portee].nom.toLowerCase()}) : `
        + `${r.ajoutes} ajoutée(s), ${r.retires} retirée(s).`);
    }
    return;
  }

  // ── Multiplicateurs ──────────────────────────────────────────────────
  if (action === 'multrole' || action === 'multsalon') {
    const cible = interaction.values?.[0];
    if (!cible) return prive(interaction, '❌ Rien n\'a été choisi.');
    return interaction.showModal(formulaireNiveaux('mult', cfg, { guildId: gid, type: action === 'multrole' ? 'role' : 'salon', valeur: cible }));
  }
  if (action === 'multsuppr') {
    const [type, cible] = String(interaction.values?.[0] || '').split(':');
    if (!L.retirerMultiplicateurXp(gid, type, cible)) return prive(interaction, '❌ Ce multiplicateur n\'existe déjà plus.');
    await mettreAJour(interaction, vueMultiplicateurs(guild));
    await journal(interaction, `Multiplicateur retiré : ${type === 'role' ? `<@&${cible}>` : `<#${cible}>`}.`);
    return;
  }

  // ── Courbe ───────────────────────────────────────────────────────────
  if (action === 'courbe') {
    if (await exigerAdmin()) return;
    const choix = interaction.values?.[0];
    if (!L.COURBES_XP[choix]) return prive(interaction, '❌ Courbe inconnue.');
    setGuildConfig(gid, 'xp_courbe', choix);
    const changes = L.recalculerNiveaux(gid);
    await mettreAJour(interaction, vueCourbe(guild));
    await journal(interaction, `Courbe d'XP → **${L.COURBES_XP[choix].nom}** · ${changes} niveau(x) recalculé(s).\n`
      + '-# Les rôles de récompense se réalignent au prochain gain, ou tout de suite avec `/xp synchroniser`.');
    return;
  }
  if (action === 'boostfin') {
    setGuildConfig(gid, 'xp_boost_pourcent', 0);
    setGuildConfig(gid, 'xp_boost_fin', null);
    await mettreAJour(interaction, vueBoost(guild));
    await journal(interaction, 'Boost d\'XP arrêté.');
    return;
  }

  // ── Formulaires envoyés ──────────────────────────────────────────────
  if (action === 'm') return soumettreFormulaire(interaction, { nom: a, type: b, valeur: id.split(':').slice(4).join(':') || null, cfg, grade, exigerAdmin });

  return prive(interaction, '⏳ Ce bouton vient d\'une version précédente du panneau.\n➜ Rouvrez `/config` → 📈 XP & niveaux.');
}

async function soumettreFormulaire(interaction, { nom, type, valeur, cfg, exigerAdmin }) {
  const guild = interaction.guild;
  const gid = interaction.guildId;
  const borne = (n, min, max) => n !== null && n >= min && n <= max;

  if (nom === 'gains') {
    const [min, max, cooldown, longueur, vocal] = ['min', 'max', 'cooldown', 'longueur', 'vocal'].map((n) => lireEntier(interaction, n));
    if (!borne(min, 0, 1000) || !borne(max, 1, 1000) || !borne(cooldown, 5, 3600) || !borne(longueur, 0, 2000) || !borne(vocal, 1, 1000)) {
      return prive(interaction, '❌ Valeurs invalides : des nombres entiers, dans les bornes indiquées.\n'
        + '➜ Minimum 0 à 1000 · maximum 1 à 1000 · délai 5 à 3600 s · longueur 0 à 2000 · vocal 1 à 1000.');
    }
    const bas = Math.min(min, max);
    const haut = Math.max(min, max);
    if (bas === haut) {
      // Une seule valeur : l'XP fixe d'avant, sans tirage.
      setGuildConfig(gid, 'xp_text', bas || 1);
      setGuildConfig(gid, 'xp_text_min', null);
      setGuildConfig(gid, 'xp_text_max', null);
    } else {
      setGuildConfig(gid, 'xp_text', Math.max(1, Math.round((bas + haut) / 2)));
      setGuildConfig(gid, 'xp_text_min', bas);
      setGuildConfig(gid, 'xp_text_max', haut);
    }
    setGuildConfig(gid, 'xp_cooldown', cooldown);
    setGuildConfig(gid, 'xp_longueur_min', longueur);
    setGuildConfig(gid, 'xp_voice', vocal);
    await afficher(interaction, vueGains(guild), '✅ Gains d\'XP mis à jour.');
    await journal(interaction, `Gains : ${bas === haut ? bas : `${bas} à ${haut}`} XP/message, délai ${cooldown} s, `
      + `longueur ${longueur}, vocal ${vocal} XP/min.`);
    return;
  }

  if (nom === 'annonce') {
    const message = String(interaction.fields.getTextInputValue('message') ?? '').trim();
    const pas = lireEntier(interaction, 'pas');
    if (!borne(pas, 1, 100)) return prive(interaction, '❌ La fréquence va de **1** (chaque niveau) à **100**.');
    setGuildConfig(gid, 'level_message', message || null);
    setGuildConfig(gid, 'level_annonce_pas', pas);
    await afficher(interaction, vueAnnonces(guild), '✅ Annonce mise à jour.');
    await journal(interaction, `Annonce de niveau : ${message ? 'message personnalisé' : 'message par défaut'}, tous les ${pas} niveau(x).`);
    return;
  }

  if (nom === 'global') {
    const global = lireEntier(interaction, 'global');
    const sao = lireEntier(interaction, 'sao');
    if (!borne(global, 0, 1000) || !borne(sao, 0, 1000)) return prive(interaction, '❌ Les pourcentages vont de **0** à **1000**.');
    setGuildConfig(gid, 'xp_mult_global', global);
    setGuildConfig(gid, 'xp_sao_pourcent', sao);
    await afficher(interaction, vueMultiplicateurs(guild));
    await journal(interaction, `Multiplicateur du serveur : ${global} % · part de l'XP SAO : ${sao} %.`);
    return;
  }

  if (nom === 'boost') {
    const pourcent = lireEntier(interaction, 'pourcent');
    const heures = lireEntier(interaction, 'heures');
    if (!borne(pourcent, 1, 1000) || !borne(heures, 0, 720)) {
      return prive(interaction, '❌ Bonus de **1** à **1000** %, durée de **0** (sans fin) à **720** heures.');
    }
    const fin = heures ? new Date(Date.now() + heures * 3600_000).toISOString() : null;
    setGuildConfig(gid, 'xp_boost_pourcent', pourcent);
    setGuildConfig(gid, 'xp_boost_fin', fin);
    await afficher(interaction, vueBoost(guild), '🚀 Boost lancé.');
    await journal(interaction, `Boost d'XP : +${pourcent} % ${fin ? `jusqu'au <t:${Math.floor(Date.parse(fin) / 1000)}:f>` : 'sans fin'}.`, COLORS.SUCCESS);
    return;
  }

  if (nom === 'weekend') {
    const pourcent = lireEntier(interaction, 'pourcent');
    if (!borne(pourcent, 0, 1000)) return prive(interaction, '❌ Le bonus va de **0** (aucun) à **1000** %.');
    setGuildConfig(gid, 'xp_weekend_pourcent', pourcent);
    await afficher(interaction, vueBoost(guild));
    await journal(interaction, `Bonus du week-end : +${pourcent} %.`);
    return;
  }

  if (nom === 'nivmax') {
    if (await exigerAdmin()) return;
    const max = lireEntier(interaction, 'max');
    if (!borne(max, 0, 1000)) return prive(interaction, '❌ Le niveau maximum va de **0** (aucun) à **1000**.');
    setGuildConfig(gid, 'xp_niveau_max', max);
    const changes = L.recalculerNiveaux(gid);
    await afficher(interaction, vueCourbe(guild));
    await journal(interaction, `Niveau maximum → ${max || 'aucun'} · ${changes} niveau(x) recalculé(s).`);
    return;
  }

  if (nom === 'mult') {
    const pourcent = lireEntier(interaction, 'pourcent');
    const r = L.definirMultiplicateurXp(gid, type, valeur, pourcent);
    if (!r.ok) return prive(interaction, `❌ ${r.erreur}`);
    await afficher(interaction, vueMultiplicateurs(guild));
    await journal(interaction, `Multiplicateur ${type === 'role' ? `<@&${valeur}>` : `<#${valeur}>`} : ${pourcent} %.`);
    return;
  }

  if (nom === 'rec') {
    const niveau = lireEntier(interaction, 'niveau');
    const donnees = { niveau, type, valeur: valeur || null, quantite: 1 };
    if (type === 'col' || type === 'objet') donnees.quantite = lireEntier(interaction, 'quantite');
    if (type === 'mp') donnees.valeur = String(interaction.fields.getTextInputValue('texte') ?? '').trim();
    const r = L.ajouterRecompenseNiveau(gid, donnees);
    if (!r.ok) return prive(interaction, `❌ ${r.erreur}`);
    const ajoutee = L.listerRecompensesNiveau(gid).find((x) => x.id === r.id);
    const toutes = L.listerRecompensesNiveau(gid);
    const page = Math.floor(toutes.findIndex((x) => x.id === r.id) / PAR_PAGE_RECOMPENSES) + 1;
    await afficher(interaction, vueRecompenses(guild, { page }), `🏅 Niveau **${niveau}** → ${ajoutee ? L.libelleRecompenseNiveau(ajoutee) : 'récompense ajoutée'}.`);
    await sendLog(guild, logEmbed('🏅 Récompense de niveau ajoutée',
      `Niveau **${niveau}** : ${ajoutee ? L.libelleRecompenseNiveau(ajoutee) : type}\nPar <@${interaction.user.id}>\n`
      + '-# Les membres qui ont déjà ce niveau la recevront à leur prochain gain, ou avec `/xp synchroniser`.',
      COLORS.SUCCESS));
    return;
  }

  return prive(interaction, '❌ Formulaire inconnu.');
}

module.exports = { vueConfigNiveaux, gererConfigNiveaux, estIdConfigNiveaux, formulaireNiveaux, PAGES_CONFIG_NIVEAUX };
