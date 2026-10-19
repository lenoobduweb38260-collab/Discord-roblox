// 🎴 Aventure SAO — les cartes.
//
// Tout passe par la grammaire de miseEnPage (◆ en-tête, ➜ entrée, filet entre
// sections), jamais par la grille de champs de Discord. Couleurs :
//   ➜ PRIMARY (neutre → accent du serveur) pour ce qui informe ;
//   ➜ SUCCESS / DANGER / WARNING pour une issue ;
//   ➜ rouge sang pour un boss en cours, or pour le légendaire.
// Pied de page : seulement quand il apprend quelque chose (page, total).
//
// Identifiants des composants (préfixe `sao:`, 100 signes au plus) :
//   sao:ch:<uid>                 rechasser
//   sao:au:<uid>                 auberge
//   sao:bo:<uid>                 ouvrir / reprendre le boss
//   sao:cb:<action>:<id>:<tour>[:<skill>]   combat de boss (id EN BASE)
//   sao:inv:<uid>:<page>         inventaire
//   sao:ag:<a|v|tout>:<uid>      Agil (acheter, vendre, tout le butin)
//   sao:fo:<cle|plus>:<uid>      Lisbeth
//   sao:ar:<uid>                 Argo
//   sao:pl:<uid> / sao:pe:<uid>:<jeton>     pêche (lancer / ferrer)
//   sao:cl:<cat>:<page> · sao:clc            classements
//   sao:du:<ok|no>:<id>          duel
//   sao:rd:<id>                  raid

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { COLORS } = require('../embeds');
const M = require('../miseEnPage');
const D = require('./donnees');
const F = require('./formules');

const OR = 0xffd700;
const ROUGE_BOSS = 0xa61c1c;

const nombreSao = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

function dureeSao(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 ? ` ${s % 60} s` : ''}`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
function objetLigne(cle, qte = 1) {
  const o = D.OBJETS[cle];
  if (!o) return `❔ ${cle}`;
  return `${o.emoji} **${o.nom}**${qte > 1 ? ` ×${qte}` : ''}`;
}
function rareteLigne(cle) {
  const r = D.RARETES[D.OBJETS[cle]?.rarete] || D.RARETES.commun;
  return `${r.emoji} ${r.nom}`;
}
function badgesLignes(cles = []) {
  return cles.filter((k) => D.BADGES[k]).map((k) => `🏅 Badge débloqué : ${D.BADGES[k].emoji} **${D.BADGES[k].name}**`);
}
function quetesLignes(quetes = []) {
  return quetes.map((q) => `📜 Quête accomplie : ${q.texte} — **+${nombreSao(q.col)} Col**, **+${nombreSao(q.xp)} XP**${q.coffre ? ' · 🎁 coffre bonus, 3 quêtes sur 3 !' : ''}`);
}
function xpServeurLigne(r) {
  return r && r.gagne > 0 ? `📈 **+${nombreSao(r.gagne)} XP serveur**` : null;
}
// Un combat de boss laissé en plan, clos au passage par l'action suivante :
// sa pénalité est toujours dite, jamais prélevée en silence.
function abandonLigne(abandon) {
  if (!abandon?.combat) return null;
  return `⌛ Ton combat contre **${abandon.combat.etat.boss.nom}** a été abandonné : il compte comme une fuite (−${nombreSao(abandon.perte)} Col).`;
}
const sansVide = (t) => t.filter(Boolean);
// « d'Alice », « de Bob » : l'élision devant une voyelle.
const deNom = (nom) => (/^[aeiouyàâäéèêëîïôöùûüœ]/i.test(String(nom)) ? `d'${nom}` : `de ${nom}`);
function lieuLigne(etage) {
  const v = D.villeDe(etage);
  return `Étage **${etage}** — ${v.ville} *(${v.zone})*`;
}
function niveauLigne(p) {
  const besoin = F.xpPourNiveau(p.level);
  return `⭐ Niveau **${p.level}** ${F.barreSao(p.xp, besoin, 10)} ${nombreSao(p.xp)}/${nombreSao(besoin)} XP`;
}
function pvLigne(pv, max) {
  return `❤️ PV ${F.barreSao(pv, max, 10)} **${nombreSao(pv)}**/${nombreSao(max)}`;
}
const bouton = (id, label, emoji, style = ButtonStyle.Secondary, desactive = false) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(Boolean(desactive));
  if (emoji) b.setEmoji(emoji);
  return b;
};
const rangee = (...c) => new ActionRowBuilder().addComponents(...c.flat().filter(Boolean));

// ── Accueil ─────────────────────────────────────────────────────────────
function carteBienvenue(userId, { xpServeur = null } = {}) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('⚔️ Bienvenue dans Aincrad')
    .setDescription(M.description([
      `<@${userId}>, te voilà piégé dans **Sword Art Online**. Pour te libérer, il faut vaincre les **100 boss d'étage** du château flottant.`,
      M.bloc('Pour commencer', [
        '`/sao chasser` — combattre des monstres : XP, Col et butin',
        '`/sao forge` — Lisbeth forge l\'**Anneal Blade** : il te la faut contre Illfang',
        '`/sao boss` — le combat d\'étage, tour par tour, avec tes Sword Skills',
        '`/sao quotidien` et `/sao quetes` — reviens chaque jour, la série paie',
      ], { prefixe: '🗺️', compte: null }),
      M.bloc('Ton paquetage', [
        `${objetLigne('potion_soin', 3)}, ${objetLigne('cristal_soin', 1)} et **${F.COL_DEPART} Col**`,
        '🏅 Badge débloqué : 🗡️ **Débutant**',
        xpServeurLigne(xpServeur),
      ].filter(Boolean), { prefixe: '🎒', compte: null }),
    ]));
  return { embeds: [embed], components: [rangee(bouton(`sao:ch:${userId}`, 'Première chasse', '🗡️', ButtonStyle.Success))] };
}

// ── Profil ──────────────────────────────────────────────────────────────
function carteProfil({ joueur: p, stats: s, nom, avatar = null, badges = [], conjoint = null, uniques = [] }) {
  const titre = p.title && D.BADGES[p.title] ? D.BADGES[p.title] : null;
  const conquis = p.floor > 100;
  const front = conquis
    ? '👑 **Aincrad conquis** — les cent étages sont tombés'
    : `🐉 Front : étage **${p.floor}** — ${D.bossDe(p.floor).nom}`;
  const skills = s.skills.map((k) => `${D.SKILLS[k].emoji} ${D.SKILLS[k].nom}`);
  const plus = s.plus ? ` **+${s.plus}**` : '';
  const blocs = [
    titre ? `🏅 *${titre.emoji} ${titre.name}*` : null,
    M.bloc('Aincrad', [`📍 ${lieuLigne(Math.min(p.position, 100))}`, front], { prefixe: '🏯', compte: null }),
    M.bloc('Aventurier', [
      niveauLigne(p),
      pvLigne(p.hp, s.pvMax),
      `⚔️ ATK **${nombreSao(s.atk)}** · 🛡️ DEF **${nombreSao(s.def)}** · 💰 **${nombreSao(p.col)}** Col`,
    ], { prefixe: '🧝', compte: null }),
    M.bloc('Équipement', sansVide([
      `${s.arme.emoji} ${s.arme.nom}${plus} *(${s.famille === 'rapiere' ? 'rapière' : 'épée'}, +${nombreSao(Math.round((s.arme.atk || 0) * (1 + 0.07 * s.plus)))} ATK)*`,
      `${s.armure.emoji} ${s.armure.nom} *(+${s.armure.def || 0} DEF, +${s.armure.pv || 0} PV)*`,
      p.repas ? `${D.OBJETS[p.repas].emoji} Repas : **${D.OBJETS[p.repas].nom}** — encore ${M.pluriel(p.repas_reste, 'chasse')}` : null,
    ]), { prefixe: '🗡️', compte: null }),
    M.bloc('Sword Skills', sansVide([
      skills.join(' · ') || '*Aucun*',
      ...uniques.map((k) => `✨ Compétence unique : **${D.UNIQUES[k].nom}** — seul(e) sur ce serveur`),
    ]), { prefixe: '🌀', compte: null }),
    M.bloc('Exploits', [
      `🐉 **${nombreSao(p.boss_vaincus)}** boss · ⚔️ **${nombreSao(p.monstres)}** monstres · 🎣 **${nombreSao(p.poissons)}** poissons`,
      `🤺 Duels : **${p.pvp_victoires}** V / ${p.pvp_defaites} D · 🪦 Morts : **${p.morts}**`,
      `🏅 Badges : **${badges.length}**/${Object.keys(D.BADGES).length}`,
    ], { prefixe: '📊', compte: null }),
    conjoint ? M.bloc('Lien du cœur', [conjoint.aventurier
      ? `💍 Uni(e) à <@${conjoint.conjoint}> · 💞 **actif** : +10 % ATK et XP d'aventure, coffre commun`
      : `💍 Uni(e) à <@${conjoint.conjoint}> · 💤 inactif tant qu'il ou elle n'a pas de personnage ici`], { prefixe: '💞', compte: null }) : null,
  ];
  const embed = new EmbedBuilder()
    .setColor(conquis ? OR : COLORS.PRIMARY)
    .setTitle(`⚔️ ${nom}`)
    .setDescription(M.description(blocs));
  if (avatar) embed.setThumbnail(avatar);
  return { embeds: [embed] };
}

function carteBadges({ nom, possedes, titre }) {
  const lignes = Object.entries(D.BADGES).map(([k, b]) => `${possedes.includes(k) ? '✅' : '🔒'} ${b.emoji} **${b.name}** — ${b.desc}`);
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`🏅 Badges ${deNom(nom)}`)
    .setDescription(M.description([
      M.bloc('Badges', lignes, { prefixe: '🏅', compte: possedes.length, motCompte: 'débloqué' }),
      titre && D.BADGES[titre] ? `🎖️ Titre porté : ${D.BADGES[titre].emoji} **${D.BADGES[titre].name}** · \`/sao titre\` pour changer` : '🎖️ Aucun titre porté · `/sao titre` pour en choisir un',
    ]));
  return { embeds: [embed] };
}

// ── Chasse ──────────────────────────────────────────────────────────────
function boutonsChasse(userId, p, pvMax) {
  return rangee(
    bouton(`sao:ch:${userId}`, 'Rechasser', '🔁', ButtonStyle.Primary),
    bouton(`sao:au:${userId}`, 'Auberge', '🏥', ButtonStyle.Secondary, p.hp >= pvMax),
    bouton(`sao:bo:${userId}`, p.floor > 100 ? 'Aincrad conquis' : `Boss de l'étage ${p.floor}`, '🐉', ButtonStyle.Danger, p.floor > 100),
  );
}

function carteChasse(r, { userId, xpServeur = null }) {
  const p = r.joueur;
  const m = r.monstre;
  const embed = new EmbedBuilder();
  const blocs = [];
  if (r.abandon) blocs.push(abandonLigne(r.abandon));
  if (r.victoire) {
    embed.setColor(r.rare ? OR : COLORS.SUCCESS).setTitle(`${r.rare ? '✨' : '🗡️'} ${m.emoji} ${m.nom} vaincu${r.rare ? ' — rencontre rare !' : ''}`);
    blocs.push(sansVide([
      `📍 ${lieuLigne(r.etage)}`,
      `⚔️ Tu infliges **${nombreSao(r.inflige)}** · 💢 tu encaisses **${nombreSao(r.subi)}**`,
      `✨ **+${nombreSao(r.xp)} XP** · 💰 **+${nombreSao(r.col)} Col**`,
      r.niveaux ? `⭐ **Niveau ${p.level} atteint !**` : null,
      pvLigne(p.hp, r.pvMax),
    ]).join('\n'));
    if (r.butin?.length) blocs.push(M.bloc('Butin', r.butin.map((b) => objetLigne(b.cle, b.qte)), { prefixe: '🎒', compte: null }));
    const extra = sansVide([
      ...quetesLignes(r.quetes),
      ...badgesLignes(r.badges),
      r.repasFini ? `🍽️ Ton repas (**${D.OBJETS[r.repasFini].nom}**) ne fait plus effet.` : null,
      xpServeurLigne(xpServeur),
      p.hp < r.pvMax * 0.3 ? '⚠️ Tes PV sont bas : `🏥 Auberge`, une potion (`/sao utiliser`) ou un peu de repos (+2 %/min).' : null,
    ]);
    if (extra.length) blocs.push(extra.join('\n'));
  } else if (r.mort?.pierre) {
    embed.setColor(OR).setTitle(`✨ ${m.emoji} ${m.nom} a failli t'avoir`);
    blocs.push(['✨ La **Divine Stone of Returning Soul** se brise : ta mort est **annulée**, PV rendus.', pvLigne(p.hp, r.pvMax)].join('\n'));
  } else {
    embed.setColor(COLORS.DANGER).setTitle(`💀 Vaincu par ${m.emoji} ${m.nom}`);
    blocs.push(sansVide([
      `📍 ${lieuLigne(r.etage)}`,
      `🪦 Ton nom s'ajoute au **Monument of Life** — tu en reviens à 25 % de tes PV ${ts(r.mort.reapparition)}.`,
      `💸 Perte : **${nombreSao(r.mort.col)} Col** et **${nombreSao(r.mort.xp)} XP**.`,
      pvLigne(p.hp, r.pvMax),
      '🔨 Une meilleure arme (`/sao forge`) ou un étage plus bas (`/sao voyager`) aideront.',
      ...badgesLignes(r.badges),
    ]).join('\n'));
  }
  embed.setDescription(M.description(blocs));
  return { embeds: [embed], components: [boutonsChasse(userId, p, r.pvMax)] };
}

// ── Combat de boss ──────────────────────────────────────────────────────
const ID_COMBAT = (action, c, extra = null) => `sao:cb:${action}:${c.id}:${c.etat.tour}${extra ? `:${extra}` : ''}`;

function objetsDeCombat(etat, inventaire) {
  return ['grand_cristal', 'cristal_soin', 'potion_soin', 'antidote']
    .map((cle) => ({ cle, qte: inventaire.find((r) => r.objet === cle)?.qte || 0 }))
    .filter((x) => x.qte > 0 && !(D.OBJETS[x.cle].cristal && etat.antiCristal));
}

function carteBoss(c, { nom, inventaire = [], avis = null }) {
  const e = c.etat;
  const etats = sansVide([e.rage ? '💢 en rage' : null, e.charge ? '⚠️ charge une attaque' : null, e.etourdi ? '💫 étourdi' : null]);
  const toi = sansVide([e.poison ? `🤢 empoisonné (${e.poison} tour${e.poison > 1 ? 's' : ''})` : null, e.ouverture ? '✨ ouverture : +50 % au prochain coup' : null]);
  const entete = sansVide([
    `**Boss de l'étage ${e.etage}** · tour ${e.tour + 1}`,
    e.argo ? '🐀 renseigné par Argo (−15 % ATK)' : null,
    e.antiCristal ? '🚫 salle anti-cristal' : null,
  ]).join(' · ');
  const blocs = [
    avis ? `ℹ️ ${avis}` : null,
    entete,
    M.bloc(e.boss.nom, [`${F.barreSao(e.bPv, e.bMax, 14)} **${nombreSao(e.bPv)}**/${nombreSao(e.bMax)} PV${etats.length ? ` · ${etats.join(' · ')}` : ''}`], { prefixe: e.boss.emoji, compte: null }),
    M.bloc(nom, [`${F.barreSao(e.jPv, e.jMax, 14)} **${nombreSao(e.jPv)}**/${nombreSao(e.jMax)} PV${toi.length ? ` · ${toi.join(' · ')}` : ''}`], { prefixe: '🛡️', compte: null }),
    ...(e.journal || []).map((j) => M.bloc(`Tour ${j.tour}`, j.lignes, { prefixe: '📜', compte: null })),
  ];
  if (!e.journal?.length) blocs.push('🗡️ *Le combat commence. Pare les charges (🛡️ Garde), enchaîne tes Sword Skills, soigne-toi à temps.*');
  const embed = new EmbedBuilder().setColor(ROUGE_BOSS).setTitle(`${e.boss.emoji} ${e.boss.nom}`).setDescription(M.description(blocs));

  const aCristal = inventaire.some((r) => r.objet === 'cristal_tp' && r.qte > 0) && !e.antiCristal;
  const lignes = [rangee(
    bouton(ID_COMBAT('atk', c), 'Attaquer', '⚔️', ButtonStyle.Danger),
    bouton(ID_COMBAT('gar', c), 'Garde', '🛡️', e.charge ? ButtonStyle.Success : ButtonStyle.Primary),
    bouton(ID_COMBAT('fuir', c), aCristal ? 'Fuir (cristal)' : 'Fuir', aCristal ? '🌀' : '🏃', ButtonStyle.Secondary),
  )];
  if (e.skills.length) {
    lignes.push(rangee(e.skills.slice(0, 5).map((k) => {
      const s = D.SKILLS[k];
      const reste = e.recharges[k] || 0;
      return bouton(ID_COMBAT('sk', c, k), reste ? `${s.nom} (${reste})` : s.nom, s.emoji, reste ? ButtonStyle.Secondary : ButtonStyle.Success, reste > 0);
    })));
  }
  const objets = objetsDeCombat(e, inventaire);
  if (objets.length) {
    lignes.push(rangee(new StringSelectMenuBuilder()
      .setCustomId(ID_COMBAT('obj', c))
      .setPlaceholder('🎒 Utiliser un objet (prend le tour)')
      .addOptions(objets.map((o) => ({
        label: `${D.OBJETS[o.cle].nom} ×${o.qte}`,
        value: o.cle,
        emoji: D.OBJETS[o.cle].emoji,
        description: D.OBJETS[o.cle].desc.slice(0, 100),
      })))));
  }
  return { embeds: [embed], components: lignes };
}

function carteFinBoss(sortie, { userId, nom, xpServeur = null }) {
  const c = sortie.combat;
  const e = c.etat;
  const p = sortie.joueur;
  const embed = new EmbedBuilder();
  const blocs = [];
  const journal = (e.journal || []).slice(-1).map((j) => M.bloc(`Tour ${j.tour}`, j.lignes, { prefixe: '📜', compte: null }));
  if (sortie.fin === 'victoire') {
    embed.setColor(sortie.clear || sortie.lab || sortie.unique ? OR : COLORS.SUCCESS)
      .setTitle(sortie.clear ? '👑 AINCRAD VAINCU !' : `🏆 Étage ${e.etage} nettoyé !`);
    blocs.push(`${nom} terrasse ${e.boss.emoji} **${e.boss.nom}** en ${M.pluriel(e.tour, 'tour')}.`);
    blocs.push(...journal);
    blocs.push(M.bloc('Récompenses', sansVide([
      `💰 **+${nombreSao(sortie.col)} Col** · ✨ **+${nombreSao(sortie.xp)} XP**${sortie.niveaux ? ` · ⭐ niveau **${p.level}**` : ''}`,
      sortie.lab ? `🏆 **Last Attack Bonus** : ${objetLigne(sortie.lab)} — ${D.OBJETS[sortie.lab].desc}` : null,
      sortie.unique ? `⚔️ **Compétence unique : ${D.UNIQUES[sortie.unique].nom}** — tu es le premier du serveur ! ${D.UNIQUES[sortie.unique].desc}` : null,
      xpServeurLigne(xpServeur),
    ]), { prefixe: '🎁', compte: null }));
    const extra = sansVide([...quetesLignes(sortie.quetes), ...badgesLignes(sortie.badges)]);
    if (extra.length) blocs.push(extra.join('\n'));
    blocs.push(sortie.clear
      ? '🕊️ Les cent étages sont tombés : te voilà **libéré de Sword Art Online**. Légende vivante !'
      : `➡️ Cap sur ${lieuLigne(p.position)}.`);
  } else if (sortie.fin === 'defaite') {
    embed.setColor(COLORS.DANGER).setTitle(`💀 Défaite face à ${e.boss.nom}`);
    blocs.push(...journal);
    blocs.push(sansVide([
      `🪦 Ton nom s'ajoute au **Monument of Life**. Retour à 25 % de tes PV ${ts(sortie.mort.reapparition)}.`,
      `💸 Perte : **${nombreSao(sortie.mort.col)} Col** et **${nombreSao(sortie.mort.xp)} XP**.`,
      // Le Sword Skill du dernier tour a pu boucler une quête : elle compte.
      ...quetesLignes(sortie.quetes),
      xpServeurLigne(xpServeur),
      ...badgesLignes(sortie.badges),
    ]).join('\n'));
    blocs.push(M.bloc('Pour la revanche', [
      '🔨 Lisbeth forge et améliore ton arme : `/sao forge`',
      '🐀 Argo vend le point faible du boss (−15 % ATK) : `/sao argo`',
      '💎 Agil vend cristaux et potions : `/sao boutique`',
      `⭐ Niveau conseillé : **${F.niveauConseille(e.etage)}**`,
    ], { prefixe: '💡', compte: null }));
  } else {
    embed.setColor(COLORS.WARNING).setTitle(`🏃 Fuite face à ${e.boss.nom}`);
    blocs.push(sortie.cristal
      ? '🌀 « Téléportation ! » Le cristal t\'emporte en ville, **sans aucune pénalité**.'
      : `🏃 Tu t'enfuis à pied${sortie.antiCristal ? ' (salle anti-cristal : pas de téléportation possible)' : ''} : **−${nombreSao(sortie.perte)} Col** dans la débandade.`);
    blocs.push(`❤️ Tu gardes tes PV (${nombreSao(p.hp)}). Le boss, lui, récupère toutes ses forces.`);
  }
  embed.setDescription(M.description(blocs));
  const rows = [rangee(
    bouton(`sao:bo:${userId}`, sortie.fin === 'victoire' ? 'Boss suivant' : 'Retenter', '🐉', ButtonStyle.Danger, p.floor > 100),
    bouton(`sao:ch:${userId}`, 'Chasser', '🗡️', ButtonStyle.Primary),
  )];
  return { embeds: [embed], components: rows };
}

// ── Inventaire ──────────────────────────────────────────────────────────
const TITRES_TYPES = {
  consommable: ['🧪', 'Consommables'], repas: ['🍱', 'Repas'], arme: ['🗡️', 'Armes de rechange'], armure: ['🛡️', 'Armures de rechange'],
  materiau: ['⛏️', 'Matériaux'], ingredient: ['🥩', 'Ingrédients'], butin: ['💰', 'Butin à revendre'],
};
function carteInventaire({ nom, userId, joueur: p, lignes, page = 1, ventes = null }) {
  const parType = {};
  for (const l of lignes) (parType[D.OBJETS[l.objet].type] ||= []).push(l);
  const blocs = Object.entries(TITRES_TYPES)
    .filter(([type]) => parType[type])
    .map(([type, [emoji, titre]]) => M.bloc(titre, parType[type].map((l) => `${objetLigne(l.objet, l.qte)} · ${rareteLigne(l.objet)}`), { prefixe: emoji, compte: null }));
  const pages = M.paginer(blocs, { maxParPage: 4 });
  const n = Math.min(Math.max(1, page), pages.length);
  const tete = `🗡️ ${objetLigne(p.arme)} · 🛡️ ${objetLigne(p.armure)} · 💰 **${nombreSao(p.col)}** Col`;
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`🎒 Inventaire ${deNom(nom)}`)
    .setDescription(M.description([tete, ...(pages[n - 1].length ? pages[n - 1] : ['*Sac vide. Les chasses le rempliront vite.*'])]));
  const total = lignes.reduce((s, l) => s + l.qte, 0);
  embed.setFooter({ text: M.piedDePage({ total, motTotal: 'objet', page: n, pages: pages.length, extra: ventes ? `revente du butin : ${nombreSao(ventes)} Col` : null, heure: false }) });
  const pagination = M.boutonsPages(`sao:inv:${userId}`, n, pages.length);
  return { embeds: [embed], components: pagination ? [pagination] : [] };
}

// ── Agil : boutique ─────────────────────────────────────────────────────
function carteBoutique({ userId, joueur: p, prix, ventes, totalButin, message = null }) {
  const blocs = [
    '🧔🏿 *Agil, marchand d\'Algade* — « Bon prix pour les bons clients. Et toi, tu es un bon client. »',
    message,
    M.bloc('À vendre', D.BOUTIQUE.map((k) => `${objetLigne(k)} — **${nombreSao(prix[k])} Col** · ${D.OBJETS[k].desc}`), { prefixe: '🛒', compte: null }),
    M.bloc('Ton butin', [ventes.length
      ? `${M.pluriel(ventes.length, 'lot')} à revendre · trophées : **${nombreSao(totalButin)} Col** d'un coup`
      : '*Rien à revendre pour l\'instant*'], { prefixe: '💰', compte: null }),
    `💰 Tu as **${nombreSao(p.col)} Col**.`,
  ];
  const embed = new EmbedBuilder().setColor(COLORS.PRIMARY).setTitle('🏪 Boutique d\'Agil').setDescription(M.description(blocs));
  const lignes = [rangee(new StringSelectMenuBuilder()
    .setCustomId(`sao:ag:a:${userId}`)
    .setPlaceholder('🛒 Acheter un objet (×1)')
    .addOptions(D.BOUTIQUE.map((k) => ({
      label: `${D.OBJETS[k].nom} — ${nombreSao(prix[k])} Col`.slice(0, 100), value: k, emoji: D.OBJETS[k].emoji,
      description: D.OBJETS[k].desc.slice(0, 100),
    }))))];
  if (ventes.length) {
    lignes.push(rangee(new StringSelectMenuBuilder()
      .setCustomId(`sao:ag:v:${userId}`)
      .setPlaceholder('💰 Vendre tout un lot')
      .addOptions(ventes.slice(0, 25).map((v) => ({
        label: `${D.OBJETS[v.objet].nom} ×${v.qte}`.slice(0, 100), value: v.objet, emoji: D.OBJETS[v.objet].emoji,
        description: `Tout vendre : ${nombreSao(v.total)} Col`,
      })))));
  }
  lignes.push(rangee(bouton(`sao:ag:tout:${userId}`, totalButin ? `Vendre tout le butin (${nombreSao(totalButin)} Col)` : 'Aucun butin à vendre', '💰', ButtonStyle.Success, !totalButin)));
  return { embeds: [embed], components: lignes };
}

// ── Lisbeth : forge ─────────────────────────────────────────────────────
function coutLigne(col, mats) {
  return [`**${nombreSao(col)} Col**`, ...Object.entries(mats || {}).map(([k, n]) => `${D.OBJETS[k].emoji} ${D.OBJETS[k].nom} ×${n}`)].join(' · ');
}
function etatOffre(o) {
  if (o.verrou) return `🔒 Lisbeth ne la forge qu'à partir de l'étage **${o.verrou}**`;
  if (o.manques.length) return `❌ Il manque : ${o.manques.map((m) => (m.cle === 'col' ? `${nombreSao(m.manque)} Col` : `${D.OBJETS[m.cle].nom} ×${m.manque}`)).join(', ')}`;
  return '✅ Tout est prêt';
}
function carteForge({ userId, joueur: p, stats: s, offres, message = null }) {
  const blocs = [
    '🔨 *Lisbeth, forgeronne de Lindarth* — « Une arme, ça se mérite. Apporte-moi le métal, je fais le reste. »',
    message,
    M.bloc('Ton équipement', [
      `${s.arme.emoji} **${s.arme.nom}**${s.plus ? ` +${s.plus}` : ''} · ATK totale **${nombreSao(s.atk)}**`,
      `${s.armure.emoji} **${s.armure.nom}** · DEF **${nombreSao(s.def)}**, PV max **${nombreSao(s.pvMax)}**`,
    ], { prefixe: '🧝', compte: null }),
  ];
  const offre = (cle, titre, emoji) => {
    const o = offres[cle];
    if (!o) return null;
    const stat = o.objet.type === 'armure' ? `+${o.objet.def} DEF, +${o.objet.pv} PV` : `+${o.objet.atk} ATK`;
    return M.bloc(`${titre} : ${o.objet.nom}`, [`${stat} · palier ${o.objet.palier}`, `Coût : ${coutLigne(o.col, o.mats)}`, etatOffre(o)], { prefixe: emoji, compte: null });
  };
  blocs.push(offre('epee', 'Épée', '🗡️'), offre('rapiere', 'Rapière', '🤺'), offre('armure', 'Armure', '🛡️'));
  if (offres.amelioration) {
    const a = offres.amelioration;
    blocs.push(M.bloc(`Amélioration +${a.plus} → +${a.plus + 1}`, [
      `Réussite : **${a.taux} %** · un échec coûte le métal, jamais l'amélioration acquise`,
      `Coût : ${coutLigne(a.col, a.mats)}`,
      etatOffre({ manques: a.manques }),
    ], { prefixe: '✨', compte: null }));
  } else if (s.plus >= F.PLUS_MAX) {
    blocs.push('✨ Ton arme est à **+10** : Lisbeth n\'a plus rien à lui apprendre.');
  }
  if (!offres.epee && !offres.rapiere && !offres.armure) blocs.push('🏆 Tu portes ce qui se forge de mieux à Aincrad.');
  const embed = new EmbedBuilder().setColor(COLORS.PRIMARY).setTitle('🔨 Forge de Lisbeth').setDescription(M.description(blocs));
  const pret = (o) => o && !o.verrou && !o.manques.length;
  const boutons = [];
  if (offres.epee) boutons.push(bouton(`sao:fo:${offres.epee.cle}:${userId}`, 'Forger l\'épée', '🗡️', ButtonStyle.Success, !pret(offres.epee)));
  if (offres.rapiere) boutons.push(bouton(`sao:fo:${offres.rapiere.cle}:${userId}`, 'Forger la rapière', '🤺', ButtonStyle.Success, !pret(offres.rapiere)));
  if (offres.armure) boutons.push(bouton(`sao:fo:${offres.armure.cle}:${userId}`, 'Forger l\'armure', '🛡️', ButtonStyle.Success, !pret(offres.armure)));
  if (offres.amelioration) boutons.push(bouton(`sao:fo:plus:${userId}`, `Améliorer (+${offres.amelioration.plus + 1})`, '✨', ButtonStyle.Primary, offres.amelioration.manques.length > 0));
  return { embeds: [embed], components: boutons.length ? [rangee(boutons)] : [] };
}

// ── Argo ────────────────────────────────────────────────────────────────
function carteArgo({ userId, joueur: p, info, rumeur, message = null }) {
  const blocs = [
    '🐀 *Argo le Rat, courtière en informations* — « Tout se sait, tout se vend. Même ce que je te dis là, nya. »',
    message,
    M.bloc('Rumeur du jour', [`Il paraît que ${rumeur.texte}.`], { prefixe: '🗞️', compte: null }),
  ];
  if (!info) {
    blocs.push('👑 Aincrad est conquis : plus aucun boss à espionner.');
  } else if (info.achete) {
    blocs.push(M.bloc(`Dossier : ${info.boss.nom}`, sansVide([
      `${info.boss.emoji} Étage **${info.etage}** · **${nombreSao(info.pv)}** PV · ATK **${nombreSao(info.atk)}** (**−15 %** pendant ton combat)`,
      `⭐ Niveau conseillé **${info.niveauConseille}** · 🗡️ arme de palier **${info.palierConseille}**`,
      '⚠️ Il charge une attaque dévastatrice tous les trois tours : **Garde** au bon moment, puis frappe l\'ouverture.',
      info.venimeux ? '🤢 Son coup empoisonne : emporte des **antidotes**.' : '🍃 Pas de poison chez celui-là.',
      info.antiCristal ? '🚫 **Salle anti-cristal** : ni cristal de soin, ni fuite par téléportation. Des potions !' : null,
      info.boss.lab ? `🏆 Dernier coup : ${objetLigne(info.boss.lab)}` : null,
    ]), { prefixe: '📁', compte: null }));
  } else {
    blocs.push(M.bloc(`Boss de l'étage ${info.etage}`, [
      `Le dossier complet sur ${info.boss.emoji} **${info.boss.nom}** : **${nombreSao(info.prix)} Col**.`,
      'Ses forces, ses manies — et son point faible : **−15 % d\'attaque** pendant ton combat.',
    ], { prefixe: '📁', compte: null }));
  }
  blocs.push(`💰 Tu as **${nombreSao(p.col)} Col**.`);
  const embed = new EmbedBuilder().setColor(COLORS.PRIMARY).setTitle('🐀 Les renseignements d\'Argo').setDescription(M.description(blocs));
  const components = info && !info.achete
    ? [rangee(bouton(`sao:ar:${userId}`, `Acheter le dossier (${nombreSao(info.prix)} Col)`, '🐀', ButtonStyle.Success, p.col < info.prix))]
    : [];
  return { embeds: [embed], components };
}

// ── Quotidienne, quêtes, délais ─────────────────────────────────────────
function carteQuotidien(r, { xpServeur = null } = {}) {
  const prochain = 7 - (r.serie % 7);
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle('📅 Récompense du jour')
    .setDescription(M.description([
      M.bloc('Dans ta besace', sansVide([
        `💰 **+${nombreSao(r.col)} Col** · ✨ **+${nombreSao(r.xp)} XP**${r.niveaux ? ` · ⭐ niveau **${r.joueur.level}**` : ''}`,
        ...r.objets.map((o) => objetLigne(o.cle, o.qte)),
        xpServeurLigne(xpServeur),
      ]), { prefixe: '🎁', compte: null }),
      sansVide([
        `🔥 Série : **${M.pluriel(r.serie, 'jour')}** de suite${r.serie > 1 ? ` (+${Math.min(r.serie - 1, 9) * 10} % de Col et d'XP)` : ''}`,
        prochain === 7 ? '🎁 Coffre au trésor gagné : la série de 7 jours est bouclée !' : `🎁 Coffre au trésor dans ${M.pluriel(prochain, 'jour')}`,
        ...badgesLignes(r.badges),
        '📜 Tes quêtes du jour : `/sao quetes`',
      ]).join('\n'),
    ]));
  return { embeds: [embed] };
}

function ligneQuete(q) {
  const def = D.QUETES[q.cle];
  const texte = def.texte.replace('{n}', String(q.objectif));
  return q.faite
    ? `✅ ~~${def.emoji} ${texte}~~`
    : `${def.emoji} ${texte} ${F.barreSao(q.progres, q.objectif, 6)} ${q.progres}/${q.objectif}`;
}
function carteQuetes({ nom, quetes, joueur: p, now = Date.now(), msMinuit }) {
  const faites = quetes.filter((q) => q.faite).length;
  const g = F.gainsQuete(Math.min(p.floor, 100));
  const embed = new EmbedBuilder()
    .setColor(faites === quetes.length && quetes.length ? COLORS.SUCCESS : COLORS.PRIMARY)
    .setTitle(`📜 Quêtes du jour ${deNom(nom)}`)
    .setDescription(M.description([
      M.bloc('Quêtes', quetes.map(ligneQuete), { prefixe: '📜', compte: faites, motCompte: 'faite', vide: 'Aucune quête aujourd\'hui' }),
      [
        `🎁 Chaque quête : **+${nombreSao(g.col)} Col** et **+${nombreSao(g.xp)} XP** · les trois : un 🎁 coffre au trésor`,
        `🔄 Nouvelles quêtes ${ts(now + msMinuit)}`,
      ].join('\n'),
    ]));
  return { embeds: [embed] };
}

function carteDelais({ nom, d, raid = null }) {
  const pret = (ms) => (ms > 0 ? `⏳ ${dureeSao(ms)}` : '✅ prêt');
  const p = d.joueur;
  const entrees = sansVide([
    d.reapparition > 0 ? `🪦 Monument of Life : retour dans **${dureeSao(d.reapparition)}**` : null,
    `🗡️ Chasse : ${pret(d.chasse)}`,
    d.combat ? `🐉 Boss : combat **en cours** contre ${d.combat.etat.boss.nom} (tour ${d.combat.etat.tour + 1}) — \`/sao boss\`` : `🐉 Boss : ${p.floor > 100 ? '👑 Aincrad conquis' : `étage **${p.floor}** ${pret(d.reapparition)}`}`,
    `📅 Quotidienne : ${d.quotidien > 0 ? `⏳ ${dureeSao(d.quotidien)}` : '✅ à réclamer'}`,
    `📜 Quêtes : **${d.quetes.filter((q) => q.faite).length}/${d.quetes.length}**`,
    d.afk ? `😴 AFK : **${d.afk.minutes}**/${d.afk.plafond} min ${d.afk.pret ? '✅ récoltable' : '⏳ 10 min minimum'}` : '😴 AFK : coupé sur ce serveur',
    d.peche === null ? '🎣 Pêche : 🔒 étage 22' : `🎣 Pêche : ${pret(d.peche)}`,
    d.repas ? `🍽️ Repas : **${D.OBJETS[d.repas.cle].nom}** — encore ${M.pluriel(d.repas.reste, 'chasse')}` : null,
    raid,
  ]);
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`⏱️ Délais ${deNom(nom)}`)
    .setDescription(M.bloc('Délais', entrees, { prefixe: '⏱️', compte: null }));
  return { embeds: [embed] };
}

// ── Monde : voyage, pêche, cuisine ──────────────────────────────────────
function carteVoyage(r) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`🌀 Téléportation — étage ${r.etage}`)
    .setDescription(sansVide([
      `« Téléportation : **${r.ville}** ! » Te voilà sur ${lieuLigne(r.etage)}.`,
      r.etage < Math.min(r.joueur.floor, 100) ? `🗡️ Les chasses rapportent moins ici, mais sans danger. Le front t'attend à l'étage **${r.joueur.floor}**.` : '🐉 Tu es sur le front.',
      r.etage === D.ETAGE_PECHE ? '🎣 Le lac de Coral est tout proche : `/sao pecher`.' : null,
    ]).join('\n'));
  return { embeds: [embed] };
}

function cartePecheLancee(r, { userId }) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('🎣 Le lac de Coral, étage 22')
    .setDescription([
      'Ta ligne est à l\'eau. Le bouchon frémit…',
      `🐟 **Ça mord ${ts(r.morsure)}** — clique **Ferrer** juste après.`,
      '-# Trop tôt, le poisson file. Trop tard (3 s), il a mangé l\'appât. Plus tu es vif, plus la prise est rare.',
    ].join('\n'));
  return { embeds: [embed], components: [rangee(bouton(`sao:pe:${userId}:${r.jeton}`, 'Ferrer !', '🎣', ButtonStyle.Success))] };
}

function cartePecheResultat(r, { userId }) {
  const embed = new EmbedBuilder();
  if (r.resultat === 'prise') {
    const o = D.OBJETS[r.objet];
    embed.setColor(o.rarete === 'legendaire' ? OR : COLORS.SUCCESS)
      .setTitle(`🎣 ${o.emoji} ${o.nom} !`)
      .setDescription(sansVide([
        `Ferré en **${(r.delta / 1000).toFixed(2).replace('.', ',')} s** · ${rareteLigne(r.objet)}`,
        r.objet === 'seigneur_lac' ? '🐋 Nishida en tomberait à la renverse : **le Seigneur du lac** !' : null,
        ...quetesLignes(r.quetes),
        ...badgesLignes(r.badges),
      ]).join('\n'));
  } else if (r.resultat === 'trop_tot') {
    embed.setColor(COLORS.WARNING).setTitle('🎣 Trop tôt !').setDescription(`Tu ferres **${(r.avance / 1000).toFixed(1).replace('.', ',')} s** avant la touche : le poisson file.`);
  } else {
    embed.setColor(COLORS.WARNING).setTitle('🎣 Trop tard…').setDescription('Le poisson a mangé l\'appât et s\'en est allé.');
  }
  return { embeds: [embed], components: [rangee(bouton(`sao:pl:${userId}`, 'Relancer', '🎣', ButtonStyle.Primary))] };
}

function carteRecettes(joueurInv) {
  const possede = (k) => joueurInv.find((r) => r.objet === k)?.qte || 0;
  const lignes = Object.entries(D.RECETTES).map(([, r]) => {
    const ing = Object.entries(r.ingredients).map(([k, n]) => `${D.OBJETS[k].emoji} ${possede(k)}/${n}`).join(' ');
    const pret = Object.entries(r.ingredients).every(([k, n]) => possede(k) >= n);
    return `${pret ? '✅' : '⬜'} ${objetLigne(r.plat)} — ${ing} · *${D.OBJETS[r.plat].desc}*`;
  });
  return new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('🍳 La cuisine d\'Asuna')
    .setDescription(M.description([
      M.bloc('Recettes', lignes, { prefixe: '📖', compte: null }),
      '`/sao cuisiner recette:…` prépare le plat, `/sao utiliser` le mange.',
    ]));
}

// ── AFK et objets ───────────────────────────────────────────────────────
function carteAfk(r) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle('😴 Gains AFK récoltés')
    .setDescription(M.description([
      `Pendant **${dureeSao(r.minutes * 60000)}** loin du jeu${r.minutes >= r.plafond ? ' (plafond atteint)' : ''}, ton personnage a farmé :`,
      M.bloc('Récolte', sansVide([
        `✨ **+${nombreSao(r.xp)} XP** d'aventure${r.niveaux ? ` · ⭐ niveau **${r.joueur.level}**` : ''}`,
        `💰 **+${nombreSao(r.col)} Col**`,
        r.materiau ? objetLigne(r.materiau.cle, r.materiau.qte) : null,
      ]), { prefixe: '🌾', compte: null }),
      sansVide([
        '-# L\'AFK ne compte que le temps passé sans jouer : chaque action remet le compteur à zéro. Il ne rapporte pas d\'XP serveur.',
        ...badgesLignes(r.badges),
      ]).join('\n'),
    ]));
  return { embeds: [embed] };
}

function carteObjetUtilise(r) {
  const o = r.objet;
  const embed = new EmbedBuilder().setColor(COLORS.SUCCESS);
  if (r.equipe) {
    embed.setTitle(`${o.emoji} ${o.nom} équipé${o.type === 'armure' ? 'e' : ''}`).setDescription(sansVide([
      r.equipe === 'arme' ? `⚔️ ATK **${nombreSao(r.stats.atk)}** · Sword Skills : ${r.stats.skills.map((k) => D.SKILLS[k].nom).join(', ')}` : `🛡️ DEF **${nombreSao(r.stats.def)}** · PV max **${nombreSao(r.stats.pvMax)}**`,
      r.ancien && D.OBJETS[r.ancien] ? `🎒 ${objetLigne(r.ancien)} rejoint ton sac.` : null,
    ]).join('\n'));
  } else if (r.repas) {
    embed.setTitle(`${o.emoji} ${o.nom}, un régal`).setDescription(`🍽️ ${o.desc}`);
  } else if (r.coffre) {
    embed.setColor(OR).setTitle('🎁 Coffre au trésor ouvert').setDescription(M.bloc('Contenu', [`💰 **+${nombreSao(r.coffre.col)} Col**`, ...r.coffre.contenu.map((c) => objetLigne(c.cle, c.qte))], { prefixe: '🎁', compte: null }));
  } else {
    embed.setTitle(`${o.emoji} ${o.nom}`).setDescription(`❤️ **+${nombreSao(r.soin)} PV** · ${pvLigne(r.joueur.hp, r.pvMax)}`);
  }
  return { embeds: [embed] };
}

// ── Classements ─────────────────────────────────────────────────────────
const MEDAILLES = ['🥇', '🥈', '🥉'];
function valeurClassement(cat, p) {
  switch (cat) {
    case 'niveau': return `niv. **${p.level}**`;
    case 'col': return `**${nombreSao(p.col)}** Col`;
    case 'boss': return `**${M.pluriel(p.boss_vaincus, 'boss', 'boss')}**`;
    case 'monstres': return `**${nombreSao(p.monstres)}** monstres`;
    case 'pvp': return `**${p.pvp_victoires}** V / ${p.pvp_defaites} D`;
    case 'morts': return `**${M.pluriel(p.morts, 'mort')}**`;
    default: return p.floor > 100 ? '👑 **Aincrad conquis**' : `étage **${p.floor}** · niv. ${p.level}`;
  }
}
function carteClassement({ categorie, rangs, page = 1, CLASSEMENTS }) {
  const cat = CLASSEMENTS[categorie] || CLASSEMENTS.etage;
  const cle = CLASSEMENTS[categorie] ? categorie : 'etage';
  const morts = cle === 'morts';
  const blocs = [];
  for (let i = 0; i < rangs.length; i += 10) {
    const tranche = rangs.slice(i, i + 10).map((p, j) => {
      const rang = i + j;
      const titre = p.title && D.BADGES[p.title] ? ` ${D.BADGES[p.title].emoji} *${D.BADGES[p.title].name}*` : '';
      const qui = morts ? `~~<@${p.user_id}>~~` : `<@${p.user_id}>${titre}`;
      return `${MEDAILLES[rang] || `**${rang + 1}.**`} ${qui} — ${valeurClassement(cle, p)}`;
    });
    blocs.push(M.bloc(`Rangs ${i + 1} à ${i + tranche.length}`, tranche, { prefixe: cat.emoji, compte: null }));
  }
  const pages = M.paginer(blocs, { maxParPage: 1 });
  const n = Math.min(Math.max(1, page), pages.length);
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(morts ? '🪦 Monument of Life' : `🏆 Classement — ${cat.nom}`)
    .setDescription(M.description([
      morts ? '*Les noms des tombés, barrés comme sur la stèle de Town of Beginnings.*' : null,
      ...(pages[n - 1].length ? pages[n - 1] : [morts ? '*Personne n\'est encore tombé. Pourvu que ça dure.*' : '*Aucun aventurier pour l\'instant : `/sao start` !*']),
    ]));
  embed.setFooter({ text: M.piedDePage({ total: rangs.length, motTotal: morts ? 'tombé' : 'aventurier', page: n, pages: pages.length }) });
  const menu = rangee(new StringSelectMenuBuilder()
    .setCustomId('sao:clc')
    .setPlaceholder(`${cat.emoji} ${cat.nom} — changer de classement`)
    .addOptions(Object.entries(CLASSEMENTS).map(([k, c]) => ({ label: c.nom, value: k, emoji: c.emoji, default: k === cle }))));
  const pagination = M.boutonsPages(`sao:cl:${cle}`, n, pages.length);
  return { embeds: [embed], components: pagination ? [menu, pagination] : [menu] };
}

// ── Duel ────────────────────────────────────────────────────────────────
function carteDuelInvitation(duel, expireLe) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('🤺 Défi en duel')
    .setDescription([
      `<@${duel.a}> défie <@${duel.b}> en duel **First Strike**.`,
      '➜ Le premier à faire tomber l\'autre sous **50 %** de ses PV l\'emporte.',
      '➜ Aucun Col ni PV n\'est perdu : seul l\'honneur est en jeu.',
      `⌛ L'offre expire ${ts(expireLe)}.`,
    ].join('\n'));
  return {
    content: `<@${duel.b}>`,
    allowedMentions: { users: [duel.b] },
    embeds: [embed],
    components: [rangee(
      bouton(`sao:du:ok:${duel.id}`, 'Accepter', '⚔️', ButtonStyle.Success),
      bouton(`sao:du:no:${duel.id}`, 'Refuser', '✖️', ButtonStyle.Secondary),
    )],
  };
}
function carteDuelFin(r, { noms }) {
  const remplacer = (l) => l.replaceAll('{a}', noms.a).replaceAll('{b}', noms.b);
  const embed = new EmbedBuilder();
  if (r.statut === 'fini') {
    embed.setColor(COLORS.SUCCESS)
      .setTitle(`🏁 Duel — victoire de ${noms[r.vainqueur === r.duel.a ? 'a' : 'b']}`)
      .setDescription(M.description([
        M.bloc('Le duel', r.journal.map(remplacer), { prefixe: '🤺', compte: null }),
        sansVide([`🏆 <@${r.vainqueur}> l'emporte au First Strike. Personne ne perd de Col.`, ...quetesLignes(r.quetes), ...badgesLignes(r.badges)]).join('\n'),
      ]));
  } else {
    embed.setColor(COLORS.WARNING)
      .setTitle(r.statut === 'annule' ? '🤺 Défi retiré' : r.statut === 'expire' ? '🤺 Défi expiré' : '🤺 Défi refusé')
      .setDescription(r.statut === 'annule' ? `${noms.a} retire son défi.` : r.statut === 'expire' ? 'Personne n\'a répondu à temps.' : `${noms.b} décline le duel.`);
  }
  return { content: '', embeds: [embed], components: [] };
}

// ── Coffre de couple ────────────────────────────────────────────────────
function carteCoffre({ couple, coffre, message = null }) {
  const [a, b] = couple.split(':');
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('💞 Coffre du couple')
    .setDescription(M.description([
      `<@${a}> & <@${b}> partagent ce coffre, comme les mariés d'Aincrad partagent leur inventaire.`,
      message,
      M.bloc('Col', [`💰 **${nombreSao(coffre.col)} Col**`], { prefixe: '💰', compte: null }),
      M.bloc('Objets', coffre.objets.map((o) => objetLigne(o.objet, o.qte)), { prefixe: '🎒', compte: null, vide: 'Le coffre est vide' }),
      '`/sao coffre deposer` · `/sao coffre retirer` (Col et/ou objet)',
    ]));
  return { embeds: [embed] };
}

// ── Raid ────────────────────────────────────────────────────────────────
function carteRaid(raid, { coups = [], fin = null, recompenses = [], dernier = null } = {}) {
  const def = D.RAIDS[raid.boss] || { nom: raid.boss, emoji: '🐲', desc: '' };
  const total = coups.reduce((s, c) => s + c.degats, 0) || 1;
  const top = coups.slice(0, 5).map((c, i) => `${MEDAILLES[i] || `**${i + 1}.**`} <@${c.user_id}> — **${nombreSao(c.degats)}** (${Math.round((100 * c.degats) / total)} %, ${M.pluriel(c.coups, 'coup')})`);
  const embed = new EmbedBuilder();
  const blocs = [`*${def.desc}*`];
  if (fin === 'vaincu') {
    embed.setColor(OR).setTitle(`🏆 RAID — ${def.nom} est tombé !`);
    blocs.push(sansVide([
      `⚔️ Dernier coup : <@${raid.dernier_coup}> — **Last Attack Bonus** : ${objetLigne(def.lab, def.labQte || 1)}`,
      `👥 ${M.pluriel(coups.length, 'participant')} · récompenses au prorata des dégâts`,
    ]).join('\n'));
    blocs.push(M.bloc('Récompenses', recompenses.slice(0, 10).map((r) => `<@${r.user_id}> — **+${nombreSao(r.col)} Col**, **+${nombreSao(r.xp)} XP**${r.materiaux ? `, ${objetLigne(r.materiaux.cle, r.materiaux.qte)}` : ''}`), { prefixe: '🎁', compte: null, vide: 'Personne' }));
  } else if (fin === 'expire') {
    embed.setColor(COLORS.WARNING).setTitle(`⌛ RAID — ${def.nom} s'est retiré`);
    blocs.push(`Le boss a survécu avec **${nombreSao(raid.pv)}**/${nombreSao(raid.pv_max)} PV. Les participants gardent un lot de consolation.`);
  } else {
    embed.setColor(ROUGE_BOSS).setTitle(`${def.emoji} RAID — ${def.nom}`);
    blocs.push([
      `👹 ${F.barreSao(raid.pv, raid.pv_max, 16)} **${nombreSao(raid.pv)}**/${nombreSao(raid.pv_max)} PV`,
      `⌛ Il se retire ${ts(raid.expire_le)} · un coup toutes les 90 s par aventurier`,
      `🏆 Le dernier coup emporte ${objetLigne(def.lab, def.labQte || 1)}`,
    ].join('\n'));
  }
  if (dernier && fin !== 'vaincu') {
    blocs.push(`⚔️ <@${dernier.user_id}> vient d'infliger **${nombreSao(dernier.degats)}**${dernier.crit ? ' 💥 critique' : ''}.${dernier.cree ? ' *(Personnage créé : bienvenue dans Aincrad !)*' : ''}`);
  }
  blocs.push(M.bloc('Dégâts', top, { prefixe: '⚔️', compte: null, vide: 'Personne n\'a encore frappé' }));
  embed.setDescription(M.description(blocs));
  const components = fin ? [] : [rangee(bouton(`sao:rd:${raid.id}`, 'Frapper', '⚔️', ButtonStyle.Danger))];
  return { embeds: [embed], components };
}

module.exports = {
  OR, ROUGE_BOSS, nombreSao, dureeSao, deNom, objetLigne, rareteLigne, badgesLignes, quetesLignes, xpServeurLigne, abandonLigne,
  carteBienvenue, carteProfil, carteBadges, carteChasse, carteBoss, carteFinBoss, carteInventaire, carteBoutique,
  carteForge, carteArgo, carteQuotidien, carteQuetes, carteDelais, carteVoyage, cartePecheLancee, cartePecheResultat,
  carteRecettes, carteAfk, carteObjetUtilise, carteClassement, carteDuelInvitation, carteDuelFin, carteCoffre, carteRaid, ligneQuete,
};
