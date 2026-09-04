const M = require('./miseEnPage');
const { GRADES } = require('./permissions');
const { COLORS } = require('./embeds');

// 📖 Le tutoriel des commandes — /tuto (membres) et /tutos (staff).
//
// Il n'est PAS écrit à la main : il se génère depuis les définitions réelles
// des commandes chargées (nom, description, sous-commandes, grade). Un guide
// rédigé à part aurait menti dès la commande suivante — celui-ci ne peut pas
// être en retard, puisqu'il lit ce que le bot a réellement enregistré.
//
// Deux vues, une seule mécanique :
//  • /tuto  — les commandes ouvertes à tout le monde, rien de staff ;
//  • /tutos — tout, avec un badge sur ce qui est réservé (👮 staff, 🛡️ admin).
// Les commandes du CRÉATEUR du bot n'apparaissent dans aucune des deux.

// Les commandes du créateur : gérées à l'exécution par isCreator(), donc
// invisibles dans les grades — la liste est ici, à compléter si on en ajoute.
const CREATRICES = new Set(['annonce', 'forceupdate', 'esthetique', 'patchnote', 'scamimage', 'vgache', 'botstaff']);

// L'ordre de lecture : du quotidien vers l'outillage. Une commande absente de
// ces listes n'est pas perdue : elle tombe dans « Autres », en fin de guide.
const CATEGORIES = [
  { emoji: '🎭', titre: 'Vie RP', noms: ['carte', 'permis', 'entreprise', 'assurance', 'matricule', 'service', 'temps', 'casierjudiciaire', 'interact', 'sao'] },
  { emoji: '🎵', titre: 'Musique et vocal', noms: ['musique', 'radio', 'vocal'] },
  { emoji: '👥', titre: 'Communauté', noms: ['niveau', 'invites', 'invite', 'absence', 'report', 'partenariat', 'info', 'tuto', 'tutos'] },
  { emoji: '📋', titre: 'Whitelists et fiches', noms: ['whitelist', 'whitelistrp', 'blacklistrp', 'casier', 'warnrp'] },
  { emoji: '👮', titre: 'Modération et sécurité', noms: ['ban', 'kick', 'mute', 'unmute', 'banglobal', 'moderation', 'snipe', 'securite', 'blacklist'] },
  { emoji: '🎫', titre: 'Organisation du serveur', noms: ['ticket', 'mode', 'preset', 'embed', 'arrivee', 'depart', 'staff', 'reseaux', 'rappel-bump', 'config'] },
  { emoji: '🧰', titre: 'Autres', noms: [] },
];

const BADGES = { [GRADES.STAFF]: '👮 staff', [GRADES.ADMIN]: '🛡️ admin' };

// La catégorie d'un nom de commande — « Autres » si personne ne la revendique.
function categorieDe(nom) {
  return CATEGORIES.find((c) => c.noms.includes(nom)) || CATEGORIES[CATEGORIES.length - 1];
}

// Les sous-commandes d'une définition, groupes compris, en lignes prêtes.
function lignesSousCommandes(json) {
  const lignes = [];
  for (const o of json.options || []) {
    if (o.type === 1) lignes.push(`\`/${json.name} ${o.name}\` — ${o.description}`);
    else if (o.type === 2) {
      for (const s of o.options || []) {
        if (s.type === 1) lignes.push(`\`/${json.name} ${o.name} ${s.name}\` — ${s.description}`);
      }
    }
  }
  return lignes;
}

// Les blocs du guide, dans l'ordre des catégories.
//  • staff: false → seulement les commandes ouvertes à tous ;
//  • staff: true  → tout (sauf créateur), badge sur ce qui est réservé.
// `cfg` permet de taire les modules désactivés sur CE serveur : un guide qui
// vante une commande refusée trois lignes plus loin n'apprend rien de bon.
function blocsPour(client, { staff = false, cfg = null } = {}) {
  const commandes = [...(client?.commands?.values?.() || [])]
    .filter((c) => c?.data?.name && !CREATRICES.has(c.data.name))
    .filter((c) => staff || (c.grade ?? GRADES.EVERYONE) < GRADES.STAFF)
    .filter((c) => !c.guildModule || !cfg || Boolean(cfg[`${c.guildModule}_enabled`]));

  const rang = (nom) => CATEGORIES.indexOf(categorieDe(nom));
  commandes.sort((a, b) => rang(a.data.name) - rang(b.data.name) || a.data.name.localeCompare(b.data.name));

  return commandes.map((c) => {
    const json = c.data.toJSON();
    const badge = staff && BADGES[c.grade] ? ` · ${BADGES[c.grade]}` : '';
    return M.bloc(`\`/${json.name}\`${badge} — ${json.description}`, lignesSousCommandes(json), {
      prefixe: categorieDe(json.name).emoji,
      compte: null,
      vide: 'S\'utilise telle quelle, sans sous-commande.',
    });
  });
}

// La page demandée, prête à répondre (SANS drapeau : l'appelant le pose).
function vue(interaction, { staff = false, page = 1 } = {}) {
  const { EmbedBuilder } = require('discord.js');
  let cfg = null;
  try { cfg = require('../database').getGuildConfig(interaction.guildId); } catch { cfg = null; }
  const blocs = blocsPour(interaction.client, { staff, cfg });
  const pages = M.paginer(blocs, { maxParPage: 6 });
  const p = Math.min(Math.max(1, Number(page) || 1), pages.length);
  const entete = staff
    ? '-# 👮 staff · 🛡️ admin — sans badge, la commande est ouverte à tout le monde.'
    : '-# Toutes les commandes ouvertes aux membres. Le staff a son guide complet : `/tutos`.';
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle(staff ? '📖 Guide du staff — toutes les commandes' : '📖 Guide des commandes')
    .setDescription(M.borner(`${entete}\n${M.description(pages[p - 1])}`, M.MAX_DESCRIPTION))
    .setFooter({ text: M.piedDePage({ total: blocs.length, motTotal: 'commande', page: p, pages: pages.length, heure: false }) });
  const nav = M.boutonsPages(staff ? 'tutost' : 'tutom', p, pages.length);
  return { embeds: [embed], components: nav ? [nav] : [] };
}

module.exports = { vue, blocsPour, lignesSousCommandes, CREATRICES, CATEGORIES };
