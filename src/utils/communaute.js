const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const { db, RP_SCOPE } = require('../database');
const { COLORS } = require('./embeds');
const M = require('./miseEnPage');

// 🏢 Qui partage ses entreprises avec qui.
//
// Les entreprises RP sont stockées en portée globale : une même société existe
// sur tous les serveurs où le bot est présent. C'est ce qu'on veut entre les
// serveurs d'UNE communauté — la police de Los Santos doit être la même
// partout — et c'est une fuite entre communautés qui n'ont rien à voir : le
// bot ajouté sur un serveur inconnu voyait, et pouvait modifier, les
// entreprises de tout le monde.
//
// Un serveur doit donc DEMANDER à rejoindre une communauté, et la demande doit
// être acceptée. Et par une seule personne : **le propriétaire du serveur**,
// celui qui porte la couronne. C'est le seul dont l'autorité ne se discute
// pas — un administrateur peut être nommé le matin et parti le soir.
//
// Tant que rien n'est validé, le serveur travaille sur SES entreprises, chez
// lui. Rien n'est perdu : la liaison ne fait qu'ouvrir la porte.

db.exec(`CREATE TABLE IF NOT EXISTS community_links (
  guild_id      TEXT PRIMARY KEY,
  main_guild_id TEXT NOT NULL,
  statut        TEXT NOT NULL DEFAULT 'en_attente',
  demande_par   TEXT,
  demande_le    TEXT,
  decide_par    TEXT,
  decide_le     TEXT
)`);

const poser = db.prepare(
  `INSERT INTO community_links (guild_id, main_guild_id, statut, demande_par, demande_le)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT (guild_id) DO UPDATE SET main_guild_id = excluded.main_guild_id,
     statut = excluded.statut, demande_par = excluded.demande_par, demande_le = excluded.demande_le,
     decide_par = NULL, decide_le = NULL`
);
const trancher = db.prepare(
  'UPDATE community_links SET statut = ?, decide_par = ?, decide_le = ? WHERE guild_id = ?'
);
const lienDe = db.prepare('SELECT * FROM community_links WHERE guild_id = ?');
const oublier = db.prepare('DELETE FROM community_links WHERE guild_id = ?');
const memeCommunaute = db.prepare(
  "SELECT guild_id FROM community_links WHERE main_guild_id = ? AND statut = 'valide'"
);

const lien = (guildId) => lienDe.get(String(guildId));
const estLie = (guildId) => lienDe.get(String(guildId))?.statut === 'valide';

// 🔑 La portée des entreprises pour CE serveur.
//
// Lié et validé → la réserve partagée. Sinon → chez soi. C'est la seule
// fonction à consulter : dupliquer ce choix ailleurs finirait par diverger, et
// une divergence ici veut dire « un serveur voit des entreprises qu'il ne
// devrait pas ».
const porteeEntreprises = (guildId) => (estLie(guildId) ? RP_SCOPE : String(guildId));

const serveursDeLaCommunaute = (mainGuildId) => memeCommunaute.all(String(mainGuildId)).map((r) => r.guild_id);

// 📨 Demande de liaison.
//
// Deux chemins, et un seul aboutit tout de suite :
//   • le demandeur porte la couronne → validé sur-le-champ, il n'y a personne
//     au-dessus de lui à consulter ;
//   • sinon → le propriétaire reçoit un message privé et tranche. Le bot ne
//     décide pas à sa place, et personne d'autre ne peut le faire.
async function demanderLiaison(interaction, mainGuildId) {
  const guild = interaction.guild;
  const cible = String(mainGuildId || '').trim();
  if (!/^\d{15,25}$/.test(cible)) {
    return { erreur: '❌ Identifiant de serveur invalide.\n➜ Activez le **mode développeur** dans Discord, clic droit sur le serveur principal → **Copier l\'identifiant**.' };
  }
  if (cible === guild.id) {
    return {
      erreur: '❌ C\'est l\'identifiant de CE serveur.\n'
        + '➜ Indiquez celui du serveur **principal** de la communauté. Si c\'est lui le principal, les autres serveurs doivent pointer vers lui.',
    };
  }

  const proprietaire = await guild.fetchOwner().catch(() => null);
  const estProprietaire = proprietaire && proprietaire.id === interaction.user.id;

  if (estProprietaire) {
    poser.run(guild.id, cible, 'valide', interaction.user.id, new Date().toISOString());
    trancher.run('valide', interaction.user.id, new Date().toISOString(), guild.id);
    return { ok: true, immediat: true };
  }

  poser.run(guild.id, cible, 'en_attente', interaction.user.id, new Date().toISOString());
  if (!proprietaire) {
    return {
      erreur: '❌ Je ne trouve pas le propriétaire de ce serveur — la demande est enregistrée mais personne ne peut la valider.\n'
        + '➜ Demandez au propriétaire de lancer lui-même la liaison.',
    };
  }

  const envoye = await proprietaire
    .send(demandeMp(guild, interaction.user, cible))
    .then(() => true)
    .catch(() => false);

  return {
    ok: true,
    immediat: false,
    proprietaire: proprietaire.id,
    // Un message privé fermé n'est pas une erreur du bot : c'est un réglage
    // Discord. Le dire évite d'attendre une réponse qui n'arrivera jamais.
    mpFerme: !envoye,
  };
}

function demandeMp(guild, demandeur, mainGuildId) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.WARNING)
        .setTitle('🏢 Demande de liaison des entreprises')
        .setDescription(M.description([
          M.bloc('Ce qui est demandé', [
            `<@${demandeur.id}> veut relier **${guild.name}** à la communauté du serveur \`${mainGuildId}\`.`,
          ], { prefixe: '📨', compte: null }),
          M.bloc('Ce que ça change', [
            'Les **entreprises RP** deviennent communes aux serveurs de cette communauté.',
            'Le staff de ces serveurs pourra les voir et les modifier.',
            'Rien d\'autre n\'est partagé : niveaux, tickets, whitelist et rôles restent chez vous.',
          ], { prefixe: '🔗', compte: null }),
          M.bloc('Vous seul décidez', [
            'Vous recevez ce message parce que vous êtes **propriétaire** de ce serveur.',
            'Sans votre accord, rien n\'est partagé : le serveur garde ses entreprises pour lui.',
          ], { prefixe: '👑', compte: null }),
        ]))
        .setFooter({ text: `Serveur : ${guild.name}` }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`comm:ok:${guild.id}`).setLabel('Valider la liaison').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`comm:no:${guild.id}`).setLabel('Refuser').setEmoji('🚫').setStyle(ButtonStyle.Danger)
      ),
    ],
  };
}

// Le propriétaire tranche, depuis son message privé.
async function handleDecision(interaction) {
  const [, choix, guildId] = interaction.customId.split(':');
  const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    return interaction.reply({ content: '❌ Ce serveur n\'est plus accessible.', flags: MessageFlags.Ephemeral }).catch(() => null);
  }
  const proprietaire = await guild.fetchOwner().catch(() => null);
  // ⚠️ On revérifie la couronne au moment de la décision : le bouton vit dans
  // un message privé, qui survit à un changement de propriétaire.
  if (!proprietaire || proprietaire.id !== interaction.user.id) {
    return interaction.reply({
      content: '⛔ Seul le **propriétaire** de ce serveur peut répondre à cette demande.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => null);
  }

  const valide = choix === 'ok';
  trancher.run(valide ? 'valide' : 'refuse', interaction.user.id, new Date().toISOString(), guild.id);

  const { mettreAJour } = require('./reponse');
  await mettreAJour(interaction, {
    embeds: [
      new EmbedBuilder()
        .setColor(valide ? COLORS.SUCCESS : COLORS.DANGER)
        .setTitle(valide ? '✅ Liaison validée' : '🚫 Liaison refusée')
        .setDescription(valide
          ? `**${guild.name}** partage désormais ses entreprises avec sa communauté.\n`
            + '-# Vous pouvez revenir en arrière à tout moment : `/config` → 🎭 Module RP.'
          : `**${guild.name}** garde ses entreprises pour lui.\n`
            + '-# La demande peut être refaite plus tard.'),
    ],
    components: [],
  });

  // Le staff qui a demandé mérite de savoir, sans avoir à relancer.
  const l = lien(guild.id);
  if (l?.demande_par) {
    const auteur = await interaction.client.users.fetch(l.demande_par).catch(() => null);
    await auteur?.send({
      content: valide
        ? `✅ Le propriétaire de **${guild.name}** a **validé** la liaison des entreprises.`
        : `🚫 Le propriétaire de **${guild.name}** a **refusé** la liaison des entreprises.`,
    }).catch(() => null);
  }
  return null;
}

function delier(guildId) {
  return oublier.run(String(guildId)).changes > 0;
}

module.exports = {
  lien, estLie, porteeEntreprises, serveursDeLaCommunaute,
  demanderLiaison, handleDecision, delier, demandeMp,
};
