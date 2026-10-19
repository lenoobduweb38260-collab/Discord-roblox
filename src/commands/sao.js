const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { getGuildConfig } = require('../database');
const { mettreAJour, repondreVite, suivre } = require('../utils/reponse');
const G = require('../utils/saoGame');
const D = require('../utils/sao/donnees');
const V = require('../utils/sao/vues');
const L = require('../utils/sao/liens');
const RAID = require('../utils/sao/raid');

// ----- ⚔️ Aventure SAO -----
// Un vrai RPG Discord dans Aincrad : chasse, boss au tour par tour avec Sword
// Skills, forge de Lisbeth, boutique d'Agil, renseignements d'Argo, pêche,
// cuisine, quêtes du jour, raids de serveur, duels, coffre de couple et
// compétence unique. La logique vit dans utils/saoGame.js, les cartes dans
// utils/sao/vues.js.
//
// Chaque bouton porte ce qu'il lui faut (`sao:…:<id>`) et l'état vit en base :
// rien ne se perd au redémarrage, et un vieux message ne pilote jamais le
// combat d'un autre (le bouton porte l'id du combat ET le numéro du tour).

const EPH = MessageFlags.Ephemeral;

function nomMembre(guild, user) {
  const m = guild?.members?.cache?.get?.(user.id);
  return m?.displayName || user.displayName || user.globalName || user.username || 'Aventurier';
}
const contexteXp = (interaction) => ({ salon: interaction.channel || null, membre: interaction.member || null });
const prive = (content) => ({ content, flags: EPH });

// Les refus, dits clairement : ce qui s'est passé, et quoi faire.
function texteRefus(r, extra = {}) {
  switch (r.refus) {
    case 'sans_perso': return '🕹️ Tu n\'as pas encore de personnage. Lance `/sao start` pour entrer dans Aincrad.';
    case 'delai': return `⏳ Tu reprends ton souffle : réessaie dans **${V.dureeSao(r.ms)}**.`;
    case 'reapparition': return `🪦 Tu es encore au Monument of Life : retour dans **${V.dureeSao(r.ms)}**.`;
    case 'en_combat': return `🐉 Tu es en plein combat${r.combat ? ` contre **${r.combat.etat.boss.nom}**` : ''} : termine-le ou fuis d'abord (\`/sao boss\` le rouvre).`;
    case 'conquis': return '👑 Tu as vaincu les cent étages : il n\'y a plus de boss à affronter.';
    case 'plein': return '💚 Tes PV sont déjà au maximum.';
    case 'fonds': return `💸 Il te faut **${V.nombreSao(r.cout ?? r.total ?? r.info?.prix)} Col** (tu en as ${V.nombreSao(r.joueur?.col ?? r.possede ?? 0)}). Va chasser un peu !`;
    case 'coupe': return '😴 Le farm AFK est coupé sur ce serveur.';
    case 'trop_tot': return `😴 Il faut au moins **${r.minimum} min** sans jouer (là : ${r.minutes} min). Chaque action remet le compteur à zéro.`;
    case 'verrouille': return extra.peche
      ? `🎣 Le lac est à l'étage **${D.ETAGE_PECHE}** : bats d'abord le boss de l'étage ${D.ETAGE_PECHE - 1}.`
      : `🔒 Étage verrouillé : tu peux voyager de l'étage 1 à l'étage **${r.haut}**.`;
    case 'ailleurs': return `🎣 Tu es à l'étage ${r.position} : \`/sao voyager ${D.ETAGE_PECHE}\` pour rejoindre le lac de Coral.`;
    case 'deja': return extra.voyage ? '📍 Tu es déjà à cet étage.' : '📁 Tu as déjà ce renseignement : il vaut pour ton prochain combat.';
    case 'inconnu': return '❔ Objet ou recette inconnu. Choisis dans la liste proposée.';
    case 'quantite': return '🔢 Quantité invalide (de 1 à 99).';
    case 'manque': return r.manques
      ? `❌ Il manque : ${r.manques.map((m) => (m.cle === 'col' ? `${V.nombreSao(m.manque)} Col` : `${D.OBJETS[m.cle].nom} ×${m.manque}`)).join(', ')}.`
      : `🎒 Tu n'en as pas assez (tu en as ${r.possede ?? 0}).`;
    case 'verrou': return `🔒 Lisbeth ne forge ce palier qu'à partir de l'étage **${r.etage}**.`;
    case 'max': return '✨ Ton arme est déjà à **+10**.';
    case 'impossible': return '🔨 L\'arme de départ ne s\'améliore pas : forge d\'abord une vraie lame (`/sao forge`).';
    case 'vide': return '🎒 Tu n\'as aucun butin à revendre.';
    case 'antidote': return '🧴 L\'antidote s\'utilise pendant un combat de boss, contre le poison.';
    case 'teleport': return '🌀 Le cristal de téléportation sert à fuir un boss sans pénalité : il part tout seul quand tu cliques **Fuir**.';
    case 'passif': return '✨ La Divine Stone agit d\'elle-même : elle se brisera à ta prochaine mort pour l\'annuler.';
    case 'inutilisable': return '🎒 Cet objet ne s\'utilise pas : matériau pour Lisbeth, ingrédient pour la cuisine, ou butin pour Agil.';
    case 'pvp_coupe': return '🤺 Les duels sont coupés sur ce serveur.';
    case 'soi': return '🤺 Tu ne peux pas te défier toi-même.';
    case 'adversaire_sans_perso': return '🤺 Ton adversaire n\'a pas encore de personnage (`/sao start`).';
    case 'pas_a_toi': return '⛔ Ce n\'est pas à toi de répondre ici.';
    case 'rien': return '💞 Précise un montant de Col et/ou un objet.';
    case 'coffre_fonds': return `💞 Le coffre ne contient que **${V.nombreSao(r.possede)} Col**.`;
    case 'coffre_manque': return `💞 Le coffre n'en contient que ${r.possede}.`;
    default: return '❌ Action impossible pour le moment. Réessaie, ou relance la commande.';
  }
}

// XP serveur de plusieurs sources (boss, quêtes, quotidienne) en un seul
// appel, et sans jamais retarder la réponse de plus de 1,2 s.
async function xpServeurDe(interaction, ...montants) {
  const total = montants.flat().reduce((s, x) => s + (Number(typeof x === 'object' ? x?.xpServeur : x) || 0), 0);
  if (!total) return null;
  return L.xpServeurRapide(interaction.guild, interaction.user.id, total, contexteXp(interaction));
}

// ── Panneaux (réutilisés par la commande et par les boutons) ────────────
function panneauBoutique(guildId, userId, message = null) {
  const p = G.chargerJoueur(guildId, userId);
  const prix = Object.fromEntries(D.BOUTIQUE.map((k) => [k, G.prixAchat(k, p.floor)]));
  const ventes = G.inventaireSao(guildId, userId)
    .filter((r) => ['butin', 'materiau', 'ingredient', 'arme', 'armure', 'repas'].includes(D.OBJETS[r.objet].type))
    .map((r) => ({ ...r, total: G.prixRevente(guildId, r.objet) * r.qte }));
  const totalButin = ventes.filter((v) => D.OBJETS[v.objet].type === 'butin').reduce((s, v) => s + v.total, 0);
  return V.carteBoutique({ userId, joueur: p, prix, ventes, totalButin, message });
}
function panneauForge(guildId, userId, message = null) {
  const p = G.chargerJoueur(guildId, userId);
  return V.carteForge({ userId, joueur: p, stats: G.statsJoueur(p, { lien: L.lienDuCoeur(guildId, userId) }), offres: G.offresForge(p), message });
}
function panneauArgo(guildId, userId, message = null) {
  const p = G.chargerJoueur(guildId, userId);
  return V.carteArgo({ userId, joueur: p, info: p.floor > 100 ? null : G.infoBoss(p), rumeur: G.rumeurDuJour(guildId), message });
}
function vueCombat(interaction, combat, avis = null) {
  return V.carteBoss(combat, { nom: nomMembre(interaction.guild, interaction.user), inventaire: G.inventaireSao(combat.guild_id, combat.user_id), avis });
}

// Ce qu'il faut savoir en ouvrant (ou en reprenant) un combat de boss.
function avisOuverture(r) {
  const e = r.combat.etat;
  return [
    r.abandon ? `Ton combat précédent a été abandonné : compté comme une fuite (−${V.nombreSao(r.abandon.perte)} Col).` : null,
    r.repris ? 'Combat repris là où tu l\'avais laissé.' : null,
    !r.repris && e.jPv < e.jMax / 2 ? `⚠️ Tu entres avec **${V.nombreSao(e.jPv)}**/${V.nombreSao(e.jMax)} PV : bois une potion au premier tour, ou fuis et passe par l'auberge.` : null,
  ].filter(Boolean).join(' ') || null;
}

// Message court d'un achat, d'une vente ou d'une forge réussis.
function ligneForge(r) {
  if (r.reussi === true) return `✨ **Réussite !** Ton arme passe à **+${r.plus}** (${r.taux} %).`;
  if (r.reussi === false) return `💥 **Échec…** Le métal se brise (${r.taux} %). Ton arme reste à +${r.plus}.`;
  return `🔨 Lisbeth te remet **${r.objet.emoji} ${r.objet.nom}** !${r.ancien && D.OBJETS[r.ancien]?.palier > 0 ? ` Ton ${D.OBJETS[r.ancien].nom} rejoint ton sac.` : ''}`;
}
const suite = (base, r) => [base, ...V.quetesLignes(r.quetes), ...V.badgesLignes(r.badges)].filter(Boolean).join('\n');

// ── Déclaration ─────────────────────────────────────────────────────────
const optMembre = (o) => o.setName('membre').setDescription('Membre (par défaut : toi)').setRequired(false);

module.exports = {
  grade: GRADES.EVERYONE,
  public: true, // module de jeu : réponses visibles dans le salon
  guildModule: 'sao', // coupé par défaut, activable dans /config → ⚔️ Aventure SAO
  nomMembre,
  data: new SlashCommandBuilder()
    .setName('sao')
    .setDescription('Aventure SAO : gravis les 100 étages d\'Aincrad')
    .addSubcommand((s) => s.setName('start').setDescription('Rejoindre Aincrad et créer ton personnage'))
    .addSubcommand((s) => s.setName('profil').setDescription('Ta fiche d\'aventurier (ou celle d\'un membre)').addUserOption(optMembre))
    .addSubcommand((s) => s.setName('chasser').setDescription('Chasser un monstre là où tu te trouves'))
    .addSubcommand((s) => s.setName('boss').setDescription('Affronter (ou reprendre) le boss de ton étage le plus haut'))
    .addSubcommand((s) => s.setName('afk').setDescription('Récolter ce que ton personnage a farmé pendant ton absence'))
    .addSubcommand((s) => s.setName('soin').setDescription('Dormir à l\'auberge pour retrouver tous tes PV (coûte des Col)'))
    .addSubcommand((s) => s.setName('inventaire').setDescription('Ton sac (ou celui d\'un membre)').addUserOption(optMembre))
    .addSubcommand((s) => s.setName('utiliser').setDescription('Utiliser ou équiper un objet de ton sac')
      .addStringOption((o) => o.setName('objet').setDescription('Objet à utiliser').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('boutique').setDescription('La boutique d\'Agil : acheter et revendre')
      .addStringOption((o) => o.setName('acheter').setDescription('Objet à acheter').setRequired(false).setAutocomplete(true))
      .addStringOption((o) => o.setName('vendre').setDescription('Objet à revendre').setRequired(false).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('quantite').setDescription('Combien (1 à 99, défaut 1)').setRequired(false).setMinValue(1).setMaxValue(99)))
    .addSubcommand((s) => s.setName('forge').setDescription('La forge de Lisbeth : armes, armures et améliorations'))
    .addSubcommand((s) => s.setName('argo').setDescription('Argo le Rat : rumeur du jour et dossier sur le boss'))
    .addSubcommand((s) => s.setName('quotidien').setDescription('Ta récompense du jour (la série paie)'))
    .addSubcommand((s) => s.setName('quetes').setDescription('Tes trois quêtes du jour'))
    .addSubcommand((s) => s.setName('cd').setDescription('Tous tes délais : chasse, quotidienne, AFK, pêche, raid…'))
    .addSubcommand((s) => s.setName('voyager').setDescription('Se téléporter vers un étage déjà débloqué')
      .addIntegerOption((o) => o.setName('etage').setDescription('Étage de destination').setRequired(true).setMinValue(1).setMaxValue(100)))
    .addSubcommand((s) => s.setName('pecher').setDescription('Pêcher dans le lac de l\'étage 22 (mini-jeu de timing)'))
    .addSubcommand((s) => s.setName('cuisiner').setDescription('La cuisine d\'Asuna : un repas, un bonus pour plusieurs chasses')
      .addStringOption((o) => o.setName('recette').setDescription('Plat à préparer (vide : voir les recettes)').setRequired(false)
        .addChoices(...Object.values(D.RECETTES).map((r) => ({ name: D.OBJETS[r.plat].nom, value: r.plat })))))
    .addSubcommand((s) => s.setName('raid').setDescription('Le boss de raid du serveur'))
    .addSubcommand((s) => s.setName('duel').setDescription('Défier un aventurier en duel First Strike')
      .addUserOption((o) => o.setName('membre').setDescription('Ton adversaire').setRequired(true)))
    .addSubcommandGroup((g) => g.setName('coffre').setDescription('Le coffre commun des mariés')
      .addSubcommand((s) => s.setName('voir').setDescription('Voir le coffre du couple'))
      .addSubcommand((s) => s.setName('deposer').setDescription('Déposer du Col et/ou un objet')
        .addIntegerOption((o) => o.setName('col').setDescription('Col à déposer').setRequired(false).setMinValue(1))
        .addStringOption((o) => o.setName('objet').setDescription('Objet à déposer').setRequired(false).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('quantite').setDescription('Combien (défaut 1)').setRequired(false).setMinValue(1).setMaxValue(999)))
      .addSubcommand((s) => s.setName('retirer').setDescription('Retirer du Col et/ou un objet')
        .addIntegerOption((o) => o.setName('col').setDescription('Col à retirer').setRequired(false).setMinValue(1))
        .addStringOption((o) => o.setName('objet').setDescription('Objet à retirer').setRequired(false).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('quantite').setDescription('Combien (défaut 1)').setRequired(false).setMinValue(1).setMaxValue(999))))
    .addSubcommand((s) => s.setName('classement').setDescription('Les classements du serveur')
      .addStringOption((o) => o.setName('categorie').setDescription('Classement à afficher').setRequired(false)
        .addChoices(...Object.entries(G.CLASSEMENTS).map(([k, c]) => ({ name: c.nom, value: k })))))
    .addSubcommand((s) => s.setName('badges').setDescription('Les badges d\'aventurier').addUserOption(optMembre))
    .addSubcommand((s) => s.setName('titre').setDescription('Porter un badge comme titre (vide : retirer)')
      .addStringOption((o) => o.setName('badge').setDescription('Badge à porter').setRequired(false).setAutocomplete(true))),

  // ── Autocomplétion ──
  async autocomplete(interaction) {
    // Le module coupé ne propose rien : c'était un trou (bug 10).
    if (!getGuildConfig(interaction.guildId).sao_enabled) return interaction.respond([]);
    const g = interaction.guildId;
    const u = interaction.user.id;
    const f = interaction.options.getFocused(true);
    const nomOption = typeof f === 'object' ? f.name : null;
    const tape = String(typeof f === 'object' ? f.value : f || '').toLowerCase();
    const groupe = interaction.options.getSubcommandGroup?.(false) || null;
    const sub = interaction.options.getSubcommand?.(false) || null;
    const choix = (liste) => liste
      .filter((c) => c.name.toLowerCase().includes(tape))
      .slice(0, 25)
      .map((c) => ({ name: c.name.slice(0, 100), value: c.value }));
    const ligneInv = (r) => ({ name: `${D.OBJETS[r.objet].nom} ×${r.qte}`, value: r.objet });

    if (nomOption === 'badge' || sub === 'titre') {
      return interaction.respond(choix(G.ownedBadges(g, u).map((k) => ({ name: `${D.BADGES[k].emoji} ${D.BADGES[k].name}`, value: k }))));
    }
    if (sub === 'boutique' && nomOption === 'acheter') {
      const p = G.getPlayer(g, u);
      return interaction.respond(choix(D.BOUTIQUE.map((k) => ({ name: `${D.OBJETS[k].nom} — ${V.nombreSao(G.prixAchat(k, p?.floor || 1))} Col`, value: k }))));
    }
    if (sub === 'boutique' && nomOption === 'vendre') {
      return interaction.respond(choix(G.inventaireSao(g, u).filter((r) => D.OBJETS[r.objet].type !== 'consommable').map(ligneInv)));
    }
    if (groupe === 'coffre' && sub === 'retirer') {
      const conj = L.conjointSao(g, u);
      const objets = conj ? G.coffreSao(g, conj.couple).objets : [];
      return interaction.respond(choix(objets.map(ligneInv)));
    }
    if (groupe === 'coffre') return interaction.respond(choix(G.inventaireSao(g, u).map(ligneInv)));
    // /sao utiliser : ce qui s'utilise vraiment hors combat.
    const utile = (o) => ['arme', 'armure', 'repas'].includes(o.type) || o.soin || o.coffre;
    return interaction.respond(choix(G.inventaireSao(g, u).filter((r) => utile(D.OBJETS[r.objet])).map(ligneInv)));
  },

  async execute(interaction) {
    const groupe = interaction.options.getSubcommandGroup?.(false) || null;
    const sub = interaction.options.getSubcommand();
    const g = interaction.guildId;
    const u = interaction.user.id;
    const nom = nomMembre(interaction.guild, interaction.user);

    if (sub === 'start') {
      return repondreVite(interaction, async () => {
        const { player, created } = G.ensurePlayer(g, u);
        if (!created) {
          const p = G.chargerJoueur(g, u);
          return { content: '🎮 Tu es déjà dans Aincrad ! Voici ta fiche.', ...V.carteProfil({ joueur: p, stats: G.statsJoueur(p), nom, badges: G.ownedBadges(g, u), uniques: G.uniquesDe(g, u) }) };
        }
        G.award(g, player.user_id, 'debutant');
        const xp = await xpServeurDe(interaction, 20);
        return V.carteBienvenue(u, { xpServeur: xp });
      });
    }

    if (sub === 'profil' || sub === 'inventaire' || sub === 'badges') {
      const cible = interaction.options.getUser('membre') || interaction.user;
      const p = G.chargerJoueur(g, cible.id);
      const nomCible = nomMembre(interaction.guild, cible);
      if (!p) {
        return interaction.reply(prive(cible.id === u ? texteRefus({ refus: 'sans_perso' }) : `📭 **${nomCible}** n'a pas encore rejoint l'aventure.`));
      }
      if (sub === 'badges') return interaction.reply(V.carteBadges({ nom: nomCible, possedes: G.ownedBadges(g, cible.id), titre: p.title }));
      if (sub === 'inventaire') {
        const lignes = G.inventaireSao(g, cible.id);
        const ventes = lignes.filter((l) => D.OBJETS[l.objet].type === 'butin').reduce((s, l) => s + G.prixRevente(g, l.objet) * l.qte, 0);
        return interaction.reply(V.carteInventaire({ nom: nomCible, userId: cible.id, joueur: p, lignes, ventes }));
      }
      const conjoint = L.conjointSao(g, cible.id);
      return interaction.reply(V.carteProfil({
        joueur: p, stats: G.statsJoueur(p, { lien: Boolean(conjoint?.aventurier) }), nom: nomCible,
        avatar: cible.displayAvatarURL?.({ size: 128 }) || null, badges: G.ownedBadges(g, cible.id), conjoint, uniques: G.uniquesDe(g, cible.id),
      }));
    }

    if (sub === 'classement') {
      const categorie = interaction.options.getString('categorie') || 'etage';
      return interaction.reply(V.carteClassement({ categorie, rangs: G.classementSao(g, categorie), CLASSEMENTS: G.CLASSEMENTS }));
    }

    if (sub === 'raid') {
      const R = G.reglagesSao(g);
      const raid = RAID.raidActif(g);
      if (raid) {
        const lien = raid.salon_id && raid.message_id ? `https://discord.com/channels/${g}/${raid.salon_id}/${raid.message_id}` : null;
        const d = RAID.delaiRaid(g, u);
        return interaction.reply(prive([
          `${D.RAIDS[raid.boss]?.emoji || '🐲'} **${D.RAIDS[raid.boss]?.nom || raid.boss}** attaque : **${V.nombreSao(raid.pv)}**/${V.nombreSao(raid.pv_max)} PV.`,
          lien ? `➜ Rejoins le combat : ${lien}` : `➜ Dans <#${raid.salon_id}>.`,
          d?.ms ? `⏳ Ton prochain coup dans **${V.dureeSao(d.ms)}**.` : '⚔️ Ton coup est prêt.',
        ].join('\n')));
      }
      if (!R.salonRaid || R.raidHeures <= 0) {
        return interaction.reply(prive('🐲 Les raids ne sont pas réglés sur ce serveur : un membre du staff choisit le salon dans `/config` → ⚔️ Aventure SAO.'));
      }
      return interaction.reply(prive(`🐲 Aucun boss de raid pour l'instant. Il en surgit un toutes les **${R.raidHeures} h** dans <#${R.salonRaid}>.`));
    }

    if (groupe === 'coffre') return module.exports.coffre(interaction, sub);

    // À partir d'ici : il faut SON personnage.
    if (!G.getPlayer(g, u)) return interaction.reply(prive(texteRefus({ refus: 'sans_perso' })));
    const lien = L.lienDuCoeur(g, u);

    if (sub === 'titre') {
      const badge = interaction.options.getString('badge');
      const p = G.chargerJoueur(g, u);
      if (!badge) {
        p.title = null;
        G.savePlayer(p);
        return interaction.reply(prive('🧹 Titre retiré.'));
      }
      if (!D.BADGES[badge]) return interaction.reply(prive('❔ Badge inconnu. Choisis-le dans la liste proposée.'));
      if (!G.ownedBadges(g, u).includes(badge)) return interaction.reply(prive('🔒 Tu n\'as pas encore débloqué ce badge (`/sao badges`).'));
      p.title = badge;
      G.savePlayer(p);
      return interaction.reply(prive(`🏅 Titre porté : ${D.BADGES[badge].emoji} **${D.BADGES[badge].name}**.`));
    }

    if (sub === 'chasser') {
      const r = G.chasserSao(g, u, { lien });
      if (r.refus) return interaction.reply(prive(texteRefus(r)));
      return repondreVite(interaction, async () => V.carteChasse(r, { userId: u, xpServeur: await xpServeurDe(interaction, r.quetes || []) }));
    }

    if (sub === 'boss') {
      const r = G.commencerBoss(g, u, { lien });
      if (r.refus) return interaction.reply(prive(texteRefus(r)));
      return interaction.reply(vueCombat(interaction, r.combat, avisOuverture(r)));
    }

    if (sub === 'afk') {
      const r = G.recolterAfk(g, u);
      if (r.refus) return interaction.reply(prive(texteRefus(r)));
      return interaction.reply(V.carteAfk(r));
    }

    if (sub === 'soin') {
      const r = G.soignerAuberge(g, u);
      if (r.refus) return interaction.reply(prive(texteRefus(r)));
      return interaction.reply(prive(`🏥 Une nuit à l'auberge pour **${V.nombreSao(r.cout)} Col** : ❤️ ${V.nombreSao(r.joueur.hp)}/${V.nombreSao(r.pvMax)} PV · 💰 ${V.nombreSao(r.joueur.col)} Col.`));
    }

    if (sub === 'utiliser') {
      const r = G.utiliserObjet(g, u, interaction.options.getString('objet'));
      if (r.refus) return interaction.reply(prive(r.refus === 'manque' ? '🎒 Tu n\'as pas cet objet.' : r.refus === 'en_combat' ? '🐉 Pas pendant un combat de boss : utilise le menu du combat.' : texteRefus(r)));
      return interaction.reply(V.carteObjetUtilise(r));
    }

    if (sub === 'boutique') {
      const acheter = interaction.options.getString('acheter');
      const vendre = interaction.options.getString('vendre');
      const qte = interaction.options.getInteger('quantite') || 1;
      let message = null;
      let quetes = [];
      if (acheter) {
        const r = G.acheterSao(g, u, acheter, qte);
        if (r.refus) return interaction.reply(prive(texteRefus(r)));
        message = `✅ Acheté : ${V.objetLigne(acheter, r.qte)} pour **${V.nombreSao(r.total)} Col**.`;
      }
      if (vendre) {
        const r = G.vendreSao(g, u, vendre, qte);
        // Un achat déjà fait ne doit pas disparaître derrière le refus de la vente.
        if (r.refus && !message) return interaction.reply(prive(texteRefus(r)));
        if (!r.refus) quetes = r.quetes;
        const ligne = r.refus ? `❌ Vente impossible : ${texteRefus(r)}` : suite(`✅ Vendu : ${V.objetLigne(vendre, r.qte)} pour **${V.nombreSao(r.total)} Col**.`, r);
        message = [message, ligne].filter(Boolean).join('\n');
      }
      return repondreVite(interaction, async () => {
        const xp = await xpServeurDe(interaction, quetes);
        return panneauBoutique(g, u, [message, V.xpServeurLigne(xp)].filter(Boolean).join('\n') || null);
      });
    }

    if (sub === 'forge') return interaction.reply(panneauForge(g, u));
    if (sub === 'argo') return interaction.reply(panneauArgo(g, u));

    if (sub === 'quotidien') {
      const r = G.reclamerQuotidien(g, u);
      if (r.refus === 'deja') return interaction.reply(prive(`📅 Déjà réclamée aujourd'hui (série : **${r.serie}**). La prochaine dans **${V.dureeSao(r.ms)}**.`));
      if (r.refus) return interaction.reply(prive(texteRefus(r)));
      return repondreVite(interaction, async () => V.carteQuotidien(r, { xpServeur: await xpServeurDe(interaction, r.xpServeur) }));
    }

    if (sub === 'quetes') {
      const p = G.chargerJoueur(g, u);
      return interaction.reply(V.carteQuetes({ nom, quetes: G.quetesDuJour(g, u), joueur: p, msMinuit: G.msAvantMinuit() }));
    }

    if (sub === 'cd') {
      const d = G.delaisSao(g, u);
      const dr = RAID.delaiRaid(g, u);
      const raid = dr ? `🐲 Raid : ${dr.ms ? `⏳ ${V.dureeSao(dr.ms)}` : '✅ coup prêt'} (${D.RAIDS[dr.raid.boss]?.nom || 'boss'} dans <#${dr.raid.salon_id}>)` : null;
      return interaction.reply({ ...V.carteDelais({ nom, d, raid }), flags: EPH });
    }

    if (sub === 'voyager') {
      const r = G.voyagerSao(g, u, interaction.options.getInteger('etage'));
      if (r.refus) return interaction.reply(prive(texteRefus(r, { voyage: true })));
      return interaction.reply(V.carteVoyage(r));
    }

    if (sub === 'pecher') {
      const r = G.lancerPeche(g, u);
      if (r.refus) return interaction.reply(prive(texteRefus(r, { peche: true })));
      return interaction.reply(V.cartePecheLancee(r, { userId: u }));
    }

    if (sub === 'cuisiner') {
      const recette = interaction.options.getString('recette');
      if (!recette) return interaction.reply({ embeds: [V.carteRecettes(G.inventaireSao(g, u))] });
      const r = G.cuisinerSao(g, u, recette);
      if (r.refus) return interaction.reply(prive(texteRefus(r)));
      const o = D.OBJETS[r.plat];
      return repondreVite(interaction, async () => {
        const xp = await xpServeurDe(interaction, r.quetes);
        return { embeds: [V.carteRecettes(G.inventaireSao(g, u)).setTitle(`🍳 ${o.emoji} ${o.nom} préparé !`).setDescription(
          [suite(`🍽️ ${o.desc}\n➜ \`/sao utiliser objet:${o.nom}\` pour le manger.`, r), V.xpServeurLigne(xp)].filter(Boolean).join('\n')
        )] };
      });
    }

    if (sub === 'duel') {
      const cible = interaction.options.getUser('membre');
      if (cible.bot) return interaction.reply(prive('🤖 Les bots ne se battent pas en duel.'));
      const r = G.proposerDuel(g, u, cible.id);
      if (r.refus === 'deja') return interaction.reply(prive('🤺 Un défi entre vous deux attend déjà sa réponse.'));
      if (r.refus) return interaction.reply(prive(texteRefus(r)));
      return interaction.reply(V.carteDuelInvitation(r.duel, r.duel.cree_le + G.DUEL_EXPIRATION_MS));
    }

    return interaction.reply(prive('❔ Sous-commande inconnue.'));
  },

  // ── /sao coffre ──
  async coffre(interaction, sub) {
    const g = interaction.guildId;
    const u = interaction.user.id;
    const conj = L.conjointSao(g, u);
    // Un coffre d'un ancien couple est partagé à parts égales avant tout.
    const partages = G.partagerCoffresOrphelins(g, u, conj?.couple || null);
    const notePartage = partages.length
      ? `⚖️ Un ancien coffre commun a été partagé à parts égales avec ${partages.map((x) => `<@${x.autre}>`).join(', ')}.`
      : null;
    if (!conj) return interaction.reply(prive([notePartage, '💍 Le coffre commun est réservé aux mariés : `/mariage` d\'abord.'].filter(Boolean).join('\n')));
    if (!G.getPlayer(g, u)) return interaction.reply(prive(texteRefus({ refus: 'sans_perso' })));
    if (!conj.aventurier) {
      return interaction.reply(prive([notePartage, `💞 <@${conj.conjoint}> n'a pas encore de personnage ici : le coffre s'ouvrira quand il ou elle fera \`/sao start\`.`].filter(Boolean).join('\n')));
    }
    if (sub === 'voir') return interaction.reply(V.carteCoffre({ couple: conj.couple, coffre: G.coffreSao(g, conj.couple), message: notePartage }));
    const r = G.mouvementCoffre(g, u, conj.couple, sub === 'deposer' ? 'deposer' : 'retirer', {
      col: interaction.options.getInteger('col') || 0,
      cle: interaction.options.getString('objet') || null,
      qte: interaction.options.getInteger('quantite') || 1,
    });
    if (r.refus) return interaction.reply(prive(texteRefus(r)));
    const quoi = [r.col ? `**${V.nombreSao(r.col)} Col**` : null, r.objet ? V.objetLigne(r.objet.cle, r.objet.qte) : null].filter(Boolean).join(' et ');
    const message = [notePartage, sub === 'deposer' ? `📥 Tu déposes ${quoi}.` : `📤 Tu retires ${quoi}.`].filter(Boolean).join('\n');
    return interaction.reply(V.carteCoffre({ couple: conj.couple, coffre: r.coffre, message }));
  },

  // ── Boutons et menus (routés depuis interactionCreate, préfixe « sao: ») ──
  async handleButton(interaction) {
    if (!getGuildConfig(interaction.guildId).sao_enabled) {
      return interaction.reply(prive('⛔ Le module Aventure SAO a été désactivé sur ce serveur : ce bouton ne fait plus rien.'));
    }
    const parts = interaction.customId.split(':');
    const type = parts[1];
    const g = interaction.guildId;
    const u = interaction.user.id;

    // Classements et inventaire : consultables par tous.
    if (type === 'cl' || type === 'clc') {
      const categorie = type === 'clc' ? interaction.values?.[0] : parts[2];
      const page = type === 'clc' ? 1 : Number(parts[3]) || 1;
      return mettreAJour(interaction, V.carteClassement({ categorie, page, rangs: G.classementSao(g, categorie), CLASSEMENTS: G.CLASSEMENTS }));
    }
    if (type === 'inv') {
      const cible = parts[2];
      const p = G.chargerJoueur(g, cible);
      if (!p) return interaction.reply(prive('📭 Cet aventurier n\'existe plus sur ce serveur.'));
      const membre = interaction.guild?.members?.cache?.get?.(cible);
      const nomCible = membre?.displayName || (cible === u ? nomMembre(interaction.guild, interaction.user) : 'Aventurier');
      return mettreAJour(interaction, V.carteInventaire({ nom: nomCible, userId: cible, joueur: p, lignes: G.inventaireSao(g, cible), page: Number(parts[3]) || 1 }));
    }

    if (type === 'cb') return module.exports.boutonCombat(interaction, parts);
    if (type === 'du') return module.exports.boutonDuel(interaction, parts);
    if (type === 'rd') return module.exports.boutonRaid(interaction, parts);

    // Le reste porte le propriétaire en dernière position (ou avant le jeton).
    const owner = type === 'pe' ? parts[2] : parts[parts.length - 1];
    if (owner && owner !== u) return interaction.reply(prive('⛔ Ce n\'est pas ton aventure : lance la tienne avec `/sao`.'));
    if (!G.getPlayer(g, u)) return interaction.reply(prive(texteRefus({ refus: 'sans_perso' })));
    const lien = L.lienDuCoeur(g, u);

    if (type === 'ch') {
      const r = G.chasserSao(g, u, { lien });
      if (r.refus) return interaction.reply(prive(texteRefus(r)));
      const xp = await xpServeurDe(interaction, r.quetes || []);
      return mettreAJour(interaction, V.carteChasse(r, { userId: u, xpServeur: xp }));
    }
    if (type === 'au') {
      const r = G.soignerAuberge(g, u);
      if (r.refus) return interaction.reply(prive(texteRefus(r)));
      return interaction.reply(prive(`🏥 Une nuit à l'auberge pour **${V.nombreSao(r.cout)} Col** : ❤️ ${V.nombreSao(r.joueur.hp)}/${V.nombreSao(r.pvMax)} PV.`));
    }
    if (type === 'bo') {
      const r = G.commencerBoss(g, u, { lien });
      if (r.refus) return interaction.reply(prive(texteRefus(r)));
      return mettreAJour(interaction, vueCombat(interaction, r.combat, avisOuverture(r)));
    }
    if (type === 'ag') {
      const action = parts[2];
      let r;
      let ligne;
      if (action === 'a') {
        r = G.acheterSao(g, u, interaction.values?.[0], 1);
        ligne = r.refus ? null : `✅ Acheté : ${V.objetLigne(r.cle)} pour **${V.nombreSao(r.total)} Col**.`;
      } else if (action === 'v') {
        r = G.vendreSao(g, u, interaction.values?.[0], 'tout');
        ligne = r.refus ? null : suite(`✅ Vendu : ${V.objetLigne(r.cle, r.qte)} pour **${V.nombreSao(r.total)} Col**.`, r);
      } else {
        r = G.vendreButin(g, u);
        ligne = r.refus ? null : suite(`✅ Tout le butin (${r.nombre} objet${r.nombre > 1 ? 's' : ''}) part pour **${V.nombreSao(r.total)} Col**.`, r);
      }
      if (r.refus) return interaction.reply(prive(texteRefus(r)));
      const xp = await xpServeurDe(interaction, r.quetes || []);
      return mettreAJour(interaction, panneauBoutique(g, u, [ligne, V.xpServeurLigne(xp)].filter(Boolean).join('\n')));
    }
    if (type === 'fo') {
      const cle = parts[2];
      const r = cle === 'plus' ? G.ameliorerSao(g, u) : G.forgerSao(g, u, cle);
      if (r.refus) return interaction.reply(prive(texteRefus(r)));
      const xp = await xpServeurDe(interaction, r.quetes || []);
      return mettreAJour(interaction, panneauForge(g, u, [suite(ligneForge(r), r), V.xpServeurLigne(xp)].filter(Boolean).join('\n')));
    }
    if (type === 'ar') {
      const r = G.acheterRenseignement(g, u);
      if (r.refus) return interaction.reply(prive(texteRefus(r)));
      return mettreAJour(interaction, panneauArgo(g, u, `🐀 Marché conclu pour **${V.nombreSao(r.info.prix)} Col**. « Lis bien, je ne répète pas. »`));
    }
    if (type === 'pl') {
      const r = G.lancerPeche(g, u);
      if (r.refus) return interaction.reply(prive(texteRefus(r, { peche: true })));
      return mettreAJour(interaction, V.cartePecheLancee(r, { userId: u }));
    }
    if (type === 'pe') {
      const r = G.ferrerSao(g, u, parts[3]);
      if (r.refus === 'perime') return interaction.reply(prive('🎣 Cette ligne n\'est plus à l\'eau. Relance avec `/sao pecher`.'));
      if (r.refus) return interaction.reply(prive(texteRefus(r)));
      const xp = await xpServeurDe(interaction, r.quetes || []);
      const vue = V.cartePecheResultat(r, { userId: u });
      if (xp?.gagne) vue.embeds[0].setDescription(`${vue.embeds[0].data.description}\n${V.xpServeurLigne(xp)}`);
      return mettreAJour(interaction, vue);
    }
    return interaction.reply(prive('⏳ Ce bouton vient d\'une version précédente du jeu. Relance la commande `/sao`.'));
  },

  // sao:cb:<action>:<idCombat>:<tour>[:<skill>]
  async boutonCombat(interaction, parts) {
    const [, , action, id, tour, extra] = parts;
    const u = interaction.user.id;
    const c = G.combatParId(id);
    if (!c) return interaction.reply(prive('⌛ Ce combat n\'existe plus. Relance `/sao boss`.'));
    if (c.user_id !== u) return interaction.reply(prive(`⛔ Ce combat est celui de <@${c.user_id}>. Lance le tien avec \`/sao boss\`.`));
    const actions = { atk: { type: 'attaque' }, gar: { type: 'garde' }, fuir: { type: 'fuir' }, sk: { type: 'skill', cle: extra }, obj: { type: 'objet', cle: interaction.values?.[0] } };
    const act = actions[action];
    if (!act) return interaction.reply(prive('❔ Action de combat inconnue.'));
    const lien = L.lienDuCoeur(c.guild_id, u);
    const r = G.jouerTourSao(c.id, u, act, { tour: Number(tour), lien });

    if (r.refus === 'perime') {
      // Un message en retard d'un tour : on le remet à jour sans rien jouer.
      return mettreAJour(interaction, vueCombat(interaction, r.combat, 'Ce message n\'était plus à jour : voici l\'état actuel du combat. Rejoue ton action.'));
    }
    if (r.refus === 'termine' || r.refus === 'abandonne') {
      const issue = { gagne: 'gagné', perdu: 'perdu', fui: 'fini par une fuite', abandon: 'abandonné' }[r.combat?.statut] || 'terminé';
      await mettreAJour(interaction, { components: [] });
      return suivre(interaction, prive(`⌛ Ce combat est ${issue}${r.perte ? ` (−${V.nombreSao(r.perte)} Col)` : ''}. \`/sao boss\` pour le suivant.`));
    }
    if (r.refus === 'action') return interaction.reply(prive(`🚫 ${r.message}`));
    if (r.refus === 'sans_objet') return interaction.reply(prive('🎒 Tu n\'as plus cet objet.'));
    if (r.refus) return interaction.reply(prive(texteRefus(r)));

    const nom = nomMembre(interaction.guild, interaction.user);
    if (r.fin === 'victoire') {
      const xp = await xpServeurDe(interaction, r.xpServeur || 0, r.quetes || []);
      return mettreAJour(interaction, V.carteFinBoss(r, { userId: u, nom, xpServeur: xp }));
    }
    if (r.fin) return mettreAJour(interaction, V.carteFinBoss(r, { userId: u, nom }));
    // Quête « Sword Skills » accomplie en plein combat : dite dans l'avis.
    if (r.quetes?.length) L.xpServeurSao(interaction.guild, u, r.quetes.reduce((s, q) => s + q.xpServeur, 0), contexteXp(interaction));
    const avis = [r.pierre ? '✨ La Divine Stone of Returning Soul t\'a ramené à la vie !' : null, ...V.quetesLignes(r.quetes)].filter(Boolean).join('\n') || null;
    return mettreAJour(interaction, vueCombat(interaction, r.combat, avis));
  },

  // sao:du:<ok|no>:<idDuel>
  async boutonDuel(interaction, parts) {
    const [, , choix, id] = parts;
    const d = G.duelParId(id);
    if (!d) return interaction.reply(prive('⌛ Ce duel n\'existe plus.'));
    const u = interaction.user.id;
    if (choix === 'ok' && u !== d.b) return interaction.reply(prive(u === d.a ? `⏳ C'est à <@${d.b}> d'accepter ton défi.` : '⛔ Ce duel ne te concerne pas.'));
    const r = G.repondreDuel(d.id, u, choix === 'ok', { liens: { a: L.lienDuCoeur(d.guild_id, d.a), b: L.lienDuCoeur(d.guild_id, d.b) } });
    if (r.refus === 'pas_a_toi') return interaction.reply(prive('⛔ Ce duel ne te concerne pas.'));
    if (r.refus === 'termine') return interaction.reply(prive('⌛ Ce duel est déjà réglé.'));
    if (r.refus && r.refus !== 'expire') return interaction.reply(prive(texteRefus(r)));
    const membre = (id2) => interaction.guild?.members?.cache?.get?.(id2)?.displayName || `<@${id2}>`;
    const noms = { a: membre(d.a), b: membre(d.b) };
    if (r.refus === 'expire') return mettreAJour(interaction, V.carteDuelFin({ statut: 'expire', duel: r.duel }, { noms }));
    if (r.quetes?.length) L.xpServeurSao(interaction.guild, r.vainqueur, r.quetes.reduce((s, q) => s + q.xpServeur, 0), contexteXp(interaction));
    return mettreAJour(interaction, V.carteDuelFin(r, { noms }));
  },

  // sao:rd:<idRaid>
  async boutonRaid(interaction, parts) {
    const u = interaction.user.id;
    const raid = RAID.raidParId(parts[2]);
    if (!raid || raid.guild_id !== interaction.guildId) return interaction.reply(prive('⌛ Ce raid n\'existe plus.'));
    const r = RAID.frapperRaid(raid.id, u, { lien: L.lienDuCoeur(raid.guild_id, u) });
    if (r.refus === 'delai') return interaction.reply(prive(`⏳ Tu reprends ton souffle : prochain coup dans **${V.dureeSao(r.ms)}**.`));
    if (r.refus === 'termine') {
      await mettreAJour(interaction, { components: [] });
      return suivre(interaction, prive('⌛ Ce raid est terminé. Le prochain boss surgira bientôt.'));
    }
    if (r.refus === 'expire') return mettreAJour(interaction, V.carteRaid(r.raid, { coups: RAID.coupsRaid(r.raid.id), fin: 'expire' }));
    if (r.refus) return interaction.reply(prive(texteRefus(r)));
    // XP serveur : le frappeur pour ses quêtes, chaque participant à la chute.
    // En arrière-plan : la carte n'attend personne.
    const quetesXp = (r.quetes || []).reduce((s, q) => s + q.xpServeur, 0);
    if (quetesXp) L.xpServeurSao(interaction.guild, u, quetesXp, contexteXp(interaction));
    for (const rec of r.recompenses) L.xpServeurSao(interaction.guild, rec.user_id, rec.xpServeur, { salon: interaction.channel || null });
    return mettreAJour(interaction, V.carteRaid(r.raid, {
      coups: r.coups, fin: r.fin, recompenses: r.recompenses, dernier: { user_id: u, degats: r.degats, crit: r.crit, cree: r.cree },
    }));
  },
};
