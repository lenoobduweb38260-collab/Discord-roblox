const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getGuildConfig } = require('../database');
const { mettreAJour, suivre } = require('./reponse');
const M = require('./miseEnPage');
const C = require('./couple');

// 💞 Vie de couple, côté Discord : la fiche du couple (/mariage statut), le
// bisou du jour (/mariage bisou et son bouton), le mot doux, et l'annonce
// des mensiversaires. Toute la logique vit dans couple.js.

const COULEUR_COUPLE = 0xf6c177; // l'or de /mariage
const COULEUR_FLAMME = 0xff7a45;
const HEURE_ANNONCE = 9; // pas d'annonce d'anniversaire avant 9 h (Paris)
const COUPES = '⛔ Les avantages du mariage sont coupés sur ce serveur. Un staff peut les rallumer via `/config` → 💍 Mariage.';
const PAS_MARIE = '💭 Tu n\'es pas marié·e : cela se vit à deux. Fais ta demande avec `/mariage demander`.';

async function pseudoCouple(guild, client, userId, user = null) {
  const membre = guild?.members?.cache?.get(userId);
  if (membre?.displayName) return membre.displayName;
  const u = user || await client?.users?.fetch?.(userId)?.catch?.(() => null);
  return u?.displayName || u?.globalName || u?.username || 'quelqu\'un';
}

const dureeFete = (fete) => (fete.anniversaire ? M.pluriel(fete.annees, 'an') : M.pluriel(fete.mois, 'mois', 'mois'));

// ── 💍 /mariage statut : la fiche du couple ─────────────────────────────

async function ficheCouple(interaction, qui) {
  const { guild, client } = interaction;
  const nomQui = await pseudoCouple(guild, client, qui.id, qui);
  const union = C.unionCouple(qui.id, { frais: true });
  const embed = new EmbedBuilder().setColor(COULEUR_COUPLE);
  if (!union) {
    embed.setTitle('💍 État civil').setDescription(`**${nomQui}** n'est marié·e à personne pour le moment.`);
    return { embeds: [embed] };
  }

  const nomConjoint = await pseudoCouple(guild, client, union.conjoint);
  const quand = Math.floor(new Date(union.depuis).getTime() / 1000);
  const tete = [`**${nomQui}** est marié·e à **${nomConjoint}** depuis <t:${quand}:R>.`, `-# Le <t:${quand}:D>`];
  embed.setTitle('💞 Fiche de couple');

  const cfg = getGuildConfig(interaction.guildId);
  if (!C.avantagesCoupleActifs(cfg)) {
    tete.push('-# 💤 Les avantages du mariage sont coupés sur ce serveur.');
    embed.setDescription(tete.join('\n'));
    return { embeds: [embed], allowedMentions: { parse: [] } };
  }

  const maintenant = Date.now();
  const r = C.reglagesCouple(cfg);
  const [nomA, nomB] = union.a === String(qui.id) ? [nomQui, nomConjoint] : [nomConjoint, nomQui];
  const alliance = C.allianceCouple(union.depuis, maintenant);
  const flamme = C.etatFlammeCouple(union.a, union.b, new Date(maintenant));
  const fete = C.prochaineFeteCouple(union.depuis, new Date(maintenant));
  const bonus = C.calculBonusCouple(union, r, maintenant);
  const blocs = [tete.join('\n')];

  blocs.push(M.bloc('Nom de couple', [`**${C.nomDeCouple(nomA, nomB)}**`], { prefixe: '🏷️', compte: null }));

  blocs.push(M.bloc(alliance.titre, [
    alliance.bonus ? `Bonus d'alliance : **+${alliance.bonus} %** d'XP` : 'Pas encore de bonus d\'alliance',
    alliance.suivant
      ? `${alliance.suivant.emoji} ${alliance.suivant.titre} dans **${M.pluriel(alliance.joursAvantSuivant, 'jour')}**`
      : 'Le plus haut palier : elle ne changera plus',
  ], { prefixe: alliance.emoji, compte: null }));

  blocs.push(M.bloc('Flamme du couple', [
    flamme.flamme
      ? `**${M.pluriel(flamme.flamme, 'jour')}** de suite · record **${M.pluriel(flamme.record, 'jour')}**`
      : flamme.record
        ? `Éteinte : un bisou chacun aujourd'hui la rallume · record **${M.pluriel(flamme.record, 'jour')}**`
        : 'Pas encore allumée : un bisou chacun, le même jour, l\'allume (`/mariage bisou`)',
    `Aujourd'hui : ${flamme.bisouA ? '💋' : '⏳'} ${nomA} · ${flamme.bisouB ? '💋' : '⏳'} ${nomB}`,
  ], { prefixe: '🔥', compte: null }));

  if (bonus.lune.active && r.bonus > 0) {
    blocs.push(M.bloc('Lune de miel', [`Encore **${M.pluriel(bonus.lune.joursRestants, 'jour')}** : bonus d'XP doublé`], { prefixe: '🌙', compte: null }));
  }

  const lignesBonus = [];
  if (cfg.levels_enabled === 0) lignesBonus.push('Les niveaux sont coupés sur ce serveur : pas de bonus d\'XP.');
  else if (bonus.pourcent <= 0) lignesBonus.push('Bonus d\'XP de couple coupé sur ce serveur.');
  else {
    lignesBonus.push(`**+${bonus.pourcent} %** d'XP quand vous êtes actifs ensemble (moins de ${r.actifMinutes} min d'écart)`);
    const ensemble = C.actifRecemmentCouple(interaction.guildId, union.a, r.actifMinutes, maintenant)
      && C.actifRecemmentCouple(interaction.guildId, union.b, r.actifMinutes, maintenant);
    lignesBonus.push(ensemble ? '🟢 Actif en ce moment' : '⏳ Écrivez ou parlez en même temps pour le déclencher');
  }
  blocs.push(M.bloc('Bonus d\'XP de couple', lignesBonus, { prefixe: '💞', compte: null }));

  if (fete) {
    blocs.push(M.bloc(fete.anniversaire ? 'Prochain anniversaire' : 'Prochain mensiversaire', [
      fete.aujourdhui
        ? `🎉 **C'est aujourd'hui** : ${dureeFete(fete)} de mariage !`
        : `**${dureeFete(fete)}**, le <t:${fete.ts}:D> (<t:${fete.ts}:R>)`,
    ], { prefixe: fete.anniversaire ? '🎉' : '🎂', compte: null }));
  }

  const enAttente = [[union.a, nomA], [union.b, nomB]].filter(([id]) => {
    const mot = C.lireMotDoux(union.a, union.b, id);
    return mot && !mot.lu;
  });
  if (enAttente.length) {
    blocs.push(M.bloc('Mot doux', enAttente.map(([, n]) => `Un mot doux attend **${n}** : \`/mariage motdoux\``), { prefixe: '💌', compte: null }));
  }

  if (cfg.sao_enabled) {
    blocs.push(M.bloc('Aventure SAO', ['Lien du cœur et coffre commun : à retrouver dans `/sao`'], { prefixe: '⚔️', compte: null }));
  }

  embed.setDescription(M.description(blocs));
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

// ── 🔥 Le bisou du jour ─────────────────────────────────────────────────

// Contrat C (agent XP) : `gagnerXpServeur` ajoute l'XP et annonce le niveau,
// sans jamais lever. Tant qu'il n'existe pas, addXp + annonce font la même
// chose. Ne lève jamais.
async function xpDeCouple(guild, userId, montant) {
  try {
    const L = require('./levels');
    if (typeof L.gagnerXpServeur === 'function') return await L.gagnerXpServeur(guild, userId, 'couple', montant);
    const r = L.addXp(guild.id, userId, 'couple', montant);
    if (r?.leveledUp) await L.announceLevelUp(guild, userId, 'couple', r.newLevel);
    return r;
  } catch (err) {
    console.warn(`⚠️ XP du bisou non accordée : ${err.message}`);
    return null;
  }
}

// L'XP du jour, à chacun des deux — s'il est bien membre de ce serveur, et
// s'il ne l'a pas déjà reçue ce jour-là (`jour` : celui du bisou, à Paris).
// Une fois par PERSONNE et par jour, quel que soit le couple : divorcer puis
// se remarier dans la journée ne rouvre pas un second gain.
async function accorderXpBisou(guild, union, cfg, jour = C.jourDeParis()) {
  const r = C.reglagesCouple(cfg);
  if (!guild || r.bisouXp <= 0 || cfg.levels_enabled === 0) return [];
  const gains = [];
  for (const id of [union.a, union.b]) {
    const membre = guild.members?.cache?.get(id) || await guild.members?.fetch?.(id)?.catch?.(() => null);
    if (!membre) continue;
    if (!C.reserverXpBisouCouple(id, jour)) continue;
    gains.push({ id, resultat: await xpDeCouple(guild, id, r.bisouXp) });
  }
  return gains;
}

async function carteBisou(interaction, union, auteurId, res, cfg, { miseAJour = false } = {}) {
  const r = C.reglagesCouple(cfg);
  const conjoint = auteurId === union.a ? union.b : union.a;
  const nomAuteur = await pseudoCouple(interaction.guild, interaction.client, auteurId, interaction.user?.id === auteurId ? interaction.user : null);
  const nomConjoint = await pseudoCouple(interaction.guild, interaction.client, conjoint);
  const embed = new EmbedBuilder();

  if (!res.complet) {
    const lignes = [
      `**${nomAuteur}** fait un bisou à **${nomConjoint}** 💋`,
      res.flamme > 0
        ? `🔥 La flamme brûle depuis **${M.pluriel(res.flamme, 'jour')}** : rends le bisou avant minuit pour la faire grandir.`
        : `🌑 La flamme est éteinte : rends le bisou avant minuit pour la rallumer.${res.eteinte ? ' *(un jour a manqué)*' : ''}`,
      '-# Un bisou par jour chacun · minuit à l\'heure de Paris',
    ];
    embed.setColor(COULEUR_COUPLE).setTitle('💋 Bisou du jour').setDescription(lignes.join('\n'));
    // À l'envoi, on appelle le conjoint (et lui seul). Une modification ne
    // sonne jamais : la mention y dit seulement à qui c'est le tour.
    return {
      content: `<@${conjoint}>`,
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`mar:bisou:${union.a}:${union.b}`).setLabel('Rendre le bisou').setEmoji('💋').setStyle(ButtonStyle.Success)
      )],
      allowedMentions: miseAJour ? { parse: [] } : { users: [conjoint] },
    };
  }

  const lignes = [
    `**${nomAuteur}** rend son bisou à **${nomConjoint}** 💋`,
    `🔥 Flamme : **${M.pluriel(res.flamme, 'jour')}** de suite`,
    res.nouveauRecord && res.flamme > 1 ? '🏆 **Nouveau record** du couple !' : `🏆 Record : **${M.pluriel(res.record, 'jour')}**`,
  ];
  if (r.bisouXp > 0 && cfg.levels_enabled !== 0) {
    // L'XP ne se gagne qu'une fois par jour et par personne : un couple
    // formé dans la journée (remariage) ne la touche pas deux fois.
    const recue = [union.a, union.b].filter((id) => C.xpBisouRecueCouple(id, res.jour));
    if (!recue.length) lignes.push(`✨ **+${r.bisouXp} XP** chacun`);
    else if (recue.length === 2) lignes.push('-# 💋 L\'XP du bisou ne se gagne qu\'une fois par jour et par personne : vous l\'avez déjà reçue aujourd\'hui.');
    else {
      const [gagnant] = [union.a, union.b].filter((id) => !recue.includes(id));
      const nomGagnant = gagnant === auteurId ? nomAuteur : nomConjoint;
      const nomRecue = gagnant === auteurId ? nomConjoint : nomAuteur;
      lignes.push(`✨ **${nomGagnant}** : **+${r.bisouXp} XP**`);
      lignes.push(`-# 💋 L'XP du bisou ne se gagne qu'une fois par jour et par personne : **${nomRecue}** l'a déjà reçue aujourd'hui.`);
    }
  }
  const mot = C.lireMotDoux(union.a, union.b, conjoint);
  if (mot && !mot.lu) lignes.push(`-# 💌 Un mot doux attend ${nomConjoint} : \`/mariage motdoux\``);
  embed.setColor(COULEUR_FLAMME).setTitle('🔥 La flamme grandit !').setDescription(lignes.join('\n'));
  const payload = { embeds: [embed], components: [], allowedMentions: { parse: [] } };
  // Le message d'origine appelait le conjoint : on remplace cet appel par
  // les deux mariés, sans faire sonner personne.
  if (miseAJour) payload.content = `<@${union.a}> <@${union.b}>`;
  return payload;
}

const MESSAGE_DEJA = (res, conjoint) => (res.complet
  ? '🔥 Vos deux bisous du jour sont faits : la flamme a déjà grandi aujourd\'hui. Rendez-vous demain !'
  : `💋 Tu as déjà fait ton bisou aujourd'hui. C'est à <@${conjoint}> de le rendre avant minuit (heure de Paris).`);

// /mariage bisou — répond d'abord, accorde l'XP ensuite : l'annonce de
// niveau peut prendre du temps, et Discord n'accorde que trois secondes.
async function commandeBisou(interaction) {
  const moi = interaction.user.id;
  const prive = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  const union = C.unionCouple(moi, { frais: true });
  if (!union) return prive(PAS_MARIE);
  const cfg = getGuildConfig(interaction.guildId);
  if (!C.avantagesCoupleActifs(cfg)) return prive(COUPES);
  const res = C.enregistrerBisou(union.a, union.b, moi);
  if (res.deja) return prive(MESSAGE_DEJA(res, union.conjoint));
  await interaction.reply(await carteBisou(interaction, union, moi, res, cfg));
  if (res.complet) await accorderXpBisou(interaction.guild, union, cfg, res.jour);
}

// mar:bisou:<a>:<b> — le conjoint rend le bisou d'un clic.
async function boutonBisouCouple(interaction, x, y) {
  const moi = interaction.user.id;
  const prive = (content) => suivre(interaction, { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (moi !== x && moi !== y) return prive('⛔ Ce bisou ne t\'est pas destiné : seuls les deux mariés peuvent y répondre.');
  const [a, b] = [String(x), String(y)].sort();
  const union = C.unionCouple(moi, { frais: true });
  if (!union || union.a !== a || union.b !== b) {
    await mettreAJour(interaction, { components: [] });
    return prive('💭 Ce mariage n\'existe plus : la flamme s\'est éteinte avec lui.');
  }
  const cfg = getGuildConfig(interaction.guildId);
  if (!C.avantagesCoupleActifs(cfg)) return prive(COUPES);
  const res = C.enregistrerBisou(a, b, moi);
  if (res.deja) return prive(MESSAGE_DEJA(res, union.conjoint));
  await mettreAJour(interaction, await carteBisou(interaction, union, moi, res, cfg, { miseAJour: true }));
  if (res.complet) await accorderXpBisou(interaction.guild, union, cfg, res.jour);
}

// ── 💌 Mot doux ─────────────────────────────────────────────────────────
//
// Avec un texte : déposé pour le conjoint (remplace le précédent). Sans :
// on lit celui qu'on a reçu. Tout reste éphémère : un mot doux ne regarde
// que les deux mariés.

async function commandeMotDoux(interaction) {
  const moi = interaction.user.id;
  const prive = (p) => interaction.reply({ ...(typeof p === 'string' ? { content: p } : p), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  const union = C.unionCouple(moi, { frais: true });
  if (!union) return prive(PAS_MARIE);
  const cfg = getGuildConfig(interaction.guildId);
  if (!C.avantagesCoupleActifs(cfg)) return prive(COUPES);
  const nomConjoint = await pseudoCouple(interaction.guild, interaction.client, union.conjoint);
  const texte = String(interaction.options.getString('texte') ?? '').trim();

  if (texte) {
    if (texte.length > C.MOT_DOUX_MAX) {
      return prive(`✂️ Ton mot doux fait ${texte.length} signes : ${C.MOT_DOUX_MAX} au maximum. Raccourcis-le et renvoie-le.`);
    }
    C.deposerMotDoux(union.a, union.b, moi, texte);
    return prive(`💌 Ton mot doux attend **${nomConjoint}**, qui le lira avec \`/mariage motdoux\`.\n-# Un nouveau mot remplace le précédent.`);
  }

  const mot = C.lireMotDoux(union.a, union.b, moi);
  if (!mot) return prive('📭 Aucun mot doux pour toi pour l\'instant. Glisses-en un à ton tour : `/mariage motdoux texte:…`');
  C.marquerMotDouxLu(union.a, union.b, moi);
  const quand = Math.floor(new Date(mot.at).getTime() / 1000);
  const embed = new EmbedBuilder().setColor(COULEUR_COUPLE).setTitle('💌 Mot doux')
    .setDescription(`De **${nomConjoint}**, <t:${quand}:R>\n${M.citation(mot.texte)}`);
  return prive({ embeds: [embed] });
}

// ── 🎂 Annonces des mensiversaires ──────────────────────────────────────
//
// Une vérification légère toutes les 30 minutes : les dates se calculent en
// mémoire, et on ne regarde les serveurs que s'il y a une fête aujourd'hui.
// Une seule annonce par serveur, couple et date (en base) : un redémarrage
// ne la répète pas. Seuls les serveurs qui ont choisi un salon annoncent,
// et seulement si les DEUX mariés en sont membres.

function carteFete(union, fete, nomA, nomB, quand) {
  const alliance = C.allianceCouple(union.depuis, quand);
  const flamme = C.etatFlammeCouple(union.a, union.b, new Date(quand));
  const lignes = [
    `**${nomA}** et **${nomB}** fêtent aujourd'hui **${dureeFete(fete)}** de mariage 💞`,
    `${alliance.emoji} ${alliance.titre}${flamme.flamme ? ` · 🔥 flamme de ${M.pluriel(flamme.flamme, 'jour')}` : ''}`,
  ];
  const embed = new EmbedBuilder()
    .setColor(COULEUR_COUPLE)
    .setTitle(fete.anniversaire ? '🎉 Joyeux anniversaire de mariage !' : '🎂 Joyeux mensiversaire !')
    .setDescription(lignes.join('\n'));
  return { content: `<@${union.a}> <@${union.b}>`, embeds: [embed], allowedMentions: { users: [union.a, union.b] } };
}

async function verifierAnniversairesCouple(client, quand = new Date()) {
  const envoyes = [];
  try {
    if (C.heureDeParis(quand) < HEURE_ANNONCE) return envoyes;
    const jour = C.jourDeParis(quand);
    const fetes = C.toutesLesUnionsCouple()
      .map((union) => ({ union, fete: C.prochaineFeteCouple(union.depuis, quand) }))
      .filter(({ fete }) => C.feteAnnonceeCouple(fete));
    if (!fetes.length) return envoyes;

    for (const guild of client?.guilds?.cache?.values?.() || []) {
      const cfg = getGuildConfig(guild.id);
      const r = C.reglagesCouple(cfg);
      if (!r.salon || !C.avantagesCoupleActifs(cfg)) continue;
      for (const { union, fete } of fetes) {
        const membres = await Promise.all([union.a, union.b].map((id) =>
          guild.members?.cache?.get(id) || guild.members?.fetch?.(id)?.catch?.(() => null)));
        if (membres.some((m) => !m)) continue;
        const salon = await guild.channels?.fetch?.(r.salon)?.catch?.(() => null);
        if (!salon?.isTextBased?.()) continue;
        if (!C.noterAnnonceCouple(guild.id, union.a, union.b, jour)) continue;
        const [nomA, nomB] = membres.map((m) => m.displayName || m.user?.username || 'quelqu\'un');
        try {
          await salon.send(carteFete(union, fete, nomA, nomB, new Date(quand).getTime()));
          envoyes.push({ guildId: guild.id, a: union.a, b: union.b, mois: fete.mois });
        } catch (err) {
          console.warn(`⚠️ Anniversaire de mariage non annoncé sur ${guild.id} : ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ Vérification des anniversaires de mariage : ${err.message}`);
  }
  return envoyes;
}

let minuteurAnniversaires = null;

function demarrerAnniversaires(client) {
  if (minuteurAnniversaires) return;
  const tour = () => verifierAnniversairesCouple(client).catch(() => null);
  const premier = setTimeout(tour, 60_000);
  premier.unref?.();
  minuteurAnniversaires = setInterval(tour, 30 * 60_000);
  minuteurAnniversaires.unref?.();
}

module.exports = {
  ficheCouple, commandeBisou, boutonBisouCouple, commandeMotDoux,
  xpDeCouple, accorderXpBisou, verifierAnniversairesCouple, demarrerAnniversaires,
};
