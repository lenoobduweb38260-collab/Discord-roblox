const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { GRADES } = require('../utils/permissions');
const { repondreVite } = require('../utils/reponse');
const { planAmour, fabriquer } = require('../utils/imageAmour');

// 💘 /lc — le calculateur d'amour.
//
// Le pourcentage est tiré au hasard, mais FIGÉ pour un même duo jusqu'à
// minuit : relancer la commande dix fois de suite pour obtenir 100 % ne
// marche pas, et deux personnes qui comparent voient le même chiffre. Sans
// membre choisi, le partenaire est tiré au sort parmi les membres humains.

const COULEUR = 0xff6b81;

// Hachage FNV-1a : rapide, stable, assez bien réparti pour un jeu.
function hacher(texte) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// 0 à 100, identique pour (A, B) et (B, A) le même jour.
function pourcentageDuJour(idA, idB, date = new Date()) {
  const jour = date.toISOString().slice(0, 10);
  const [x, y] = [String(idA), String(idB)].sort();
  return hacher(`${x}:${y}:${jour}`) % 101;
}

const VERDICTS = [
  [100, '💍 Le destin est écrit : c\'est l\'amour parfait !'],
  [90, '💖 Des âmes sœurs, ni plus ni moins.'],
  [70, '😍 Le coup de foudre n\'est pas loin !'],
  [50, '😊 Une belle complicité entre vous deux.'],
  [30, '🙂 Il y a une petite étincelle… à entretenir.'],
  [10, '😬 Ça ne colle pas vraiment pour l\'instant.'],
  [0, '🧊 Glacial… mieux vaut rester amis.'],
];
const verdict = (p) => VERDICTS.find(([seuil]) => p >= seuil)[1];

function nom(interaction, user) {
  const membre = interaction.guild?.members?.cache?.get(user.id);
  return membre?.displayName || user.displayName || user.globalName || user.username;
}

// Un membre humain au hasard, autre que l'auteur. On complète le cache par
// un chargement des membres si le serveur paraît vide (cache froid).
async function membreAuHasard(interaction) {
  const humains = () => [...(interaction.guild?.members?.cache?.values?.() || [])]
    .filter((m) => !m.user?.bot && m.id !== interaction.user.id);
  let candidats = humains();
  if (candidats.length < 2 && interaction.guild?.members?.fetch) {
    await Promise.race([
      interaction.guild.members.fetch().catch(() => null),
      new Promise((r) => setTimeout(r, 1200)),
    ]);
    candidats = humains();
  }
  if (!candidats.length) return null;
  return candidats[Math.floor(Math.random() * candidats.length)].user;
}

async function carteLc(interaction, auteur, cible, auHasard) {
  const { pourcentage, verdict: verdictCouple } = require('../utils/couple').pourcentageLcCouple(auteur.id, cible.id, pourcentageDuJour(auteur.id, cible.id), interaction.guildId); // 💍 conjoints : ≥ 90 %
  const nomA = nom(interaction, auteur);
  const nomB = nom(interaction, cible);
  const png = await fabriquer(planAmour({ pourcentage, nomA, nomB }), [auteur, cible]).catch(() => null);
  const lignes = [
    `**${nomA}** 💞 **${nomB}**`,
    `## ${pourcentage} %`,
    verdictCouple || verdict(pourcentage),
  ];
  if (auHasard) lignes.push('-# 🎲 Partenaire tiré au sort parmi les membres du serveur');
  lignes.push('-# 📅 Même duo, même résultat jusqu\'à minuit');
  const embed = new EmbedBuilder().setColor(COULEUR).setTitle('💘 Calculateur d\'amour').setDescription(lignes.join('\n'));
  const payload = { embeds: [embed] };
  if (png) {
    embed.setImage('attachment://lc.png');
    payload.files = [new AttachmentBuilder(png, { name: 'lc.png' })];
  }
  // On ne mentionne que la personne CHOISIE : un tirage au sort ne doit pas
  // réveiller un inconnu.
  if (!auHasard) payload.content = `<@${cible.id}>`;
  return payload;
}

module.exports = {
  grade: GRADES.EVERYONE,
  public: true,
  guildModule: 'interact', // comme /interact : activable dans /config → 🎉 Communauté
  pourcentageDuJour, verdict, membreAuHasard, carteLc,
  data: new SlashCommandBuilder()
    .setName('lc')
    .setDescription('Calculateur d\'amour : votre compatibilité avec un membre 💘')
    .addUserOption((o) =>
      o.setName('membre').setDescription('Avec qui ? (vide : un membre tiré au sort)').setRequired(false)
    ),

  async execute(interaction) {
    let cible = interaction.options.getUser('membre');
    const auHasard = !cible;
    if (cible?.bot) {
      return interaction.reply({ content: '🤖 Les bots n\'ont pas de cœur… choisis un membre humain.', flags: MessageFlags.Ephemeral });
    }
    if (cible && cible.id === interaction.user.id) {
      return interaction.reply({ content: '🪞 S\'aimer soi-même, c\'est 100 % — mais choisis quelqu\'un d\'autre pour le calcul.', flags: MessageFlags.Ephemeral });
    }
    // Pas de report d'office : la carte (et son image) part en un seul
    // message ; on ne diffère qu'à la dernière seconde si le tirage ou
    // l'image traînent. Le tirage au sort se fait DANS ce travail : charger
    // les membres peut prendre une seconde, et Discord n'en accorde que trois.
    return repondreVite(interaction, async () => {
      if (!cible) cible = await membreAuHasard(interaction);
      if (!cible) {
        return { content: '🫥 Personne d\'autre à tirer au sort ici : choisis un membre avec l\'option `membre`.', flags: MessageFlags.Ephemeral };
      }
      return carteLc(interaction, interaction.user, cible, auHasard);
    });
  },
};
