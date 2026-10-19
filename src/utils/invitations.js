const { db } = require('../database');

// 📨 Traqueur d'invitations : qui a fait venir chaque membre.
//
// Discord ne dit PAS quelle invitation a servi : il faut compter. Le bot
// garde en mémoire le nombre d'utilisations de chaque invitation ; à chaque
// arrivée, il recompte et l'invitation dont le compteur a bougé est la bonne.
// Une invitation à usage unique disparaît au moment où elle sert : elle se
// repère alors par son absence.
//
// Limites assumées, toutes silencieuses (le reste du bot ne dépend pas du
// traqueur) :
//   • lire les invitations exige la permission « Gérer le serveur » — sans
//     elle, l'arrivée est simplement enregistrée « inviteur inconnu » ;
//   • le lien de vanité (discord.gg/monserveur) n'a pas d'inviteur ;
//   • deux arrivées dans la même seconde peuvent se partager un compteur —
//     la première détectée gagne, l'autre reste « inconnue ».

const enregistrer = db.prepare(
  'INSERT INTO invitations (guild_id, member_id, inviter_id, code, at) VALUES (?, ?, ?, ?, ?)'
);
const totalStmt = db.prepare(
  'SELECT COUNT(*) AS n FROM invitations WHERE guild_id = ? AND inviter_id = ?'
);
const inviteurStmt = db.prepare(
  'SELECT * FROM invitations WHERE guild_id = ? AND member_id = ? ORDER BY at DESC LIMIT 1'
);
const classementStmt = db.prepare(
  `SELECT inviter_id, COUNT(*) AS n FROM invitations
   WHERE guild_id = ? AND inviter_id IS NOT NULL
   GROUP BY inviter_id ORDER BY n DESC, inviter_id LIMIT ?`
);

// guildId → Map(code → { uses, inviterId })
const compteurs = new Map();

function photographier(invites) {
  return new Map(
    [...invites.values()].map((i) => [i.code, { uses: i.uses || 0, inviterId: i.inviterId || i.inviter?.id || null }])
  );
}

// Mémorise l'état des invitations d'un serveur (au démarrage, et à l'entrée
// du bot sur un nouveau serveur).
async function primer(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (invites) compteurs.set(guild.id, photographier(invites));
}

async function primerTout(client) {
  for (const guild of client.guilds.cache.values()) await primer(guild);
}

// Tenues à jour au fil de l'eau, pour que la différence reste juste.
function invitationCreee(invite) {
  if (!invite.guild) return;
  const parCode = compteurs.get(invite.guild.id) || new Map();
  parCode.set(invite.code, { uses: invite.uses || 0, inviterId: invite.inviterId || invite.inviter?.id || null });
  compteurs.set(invite.guild.id, parCode);
}

// Invitations tout juste disparues : une invitation à usage unique est
// SUPPRIMÉE par Discord au moment où elle sert, et l'événement de suppression
// peut arriver AVANT celui de l'arrivée. On garde donc les dernières
// disparitions quelques secondes, pour que detecter() les retrouve.
const disparues = new Map(); // guildId → [{ code, inviterId, uses, at }]

function invitationSupprimee(invite) {
  const guildId = invite.guild?.id;
  if (!guildId) return;
  const parCode = compteurs.get(guildId);
  const info = parCode?.get(invite.code);
  parCode?.delete(invite.code);
  const liste = disparues.get(guildId) || [];
  liste.push({
    code: invite.code,
    inviterId: info?.inviterId ?? invite.inviterId ?? invite.inviter?.id ?? null,
    uses: (info?.uses || 0) + 1,
    at: Date.now(),
  });
  disparues.set(guildId, liste.slice(-5));
}

// À l'arrivée d'un membre : quelle invitation a servi ?
// Enregistre la réponse en base et la renvoie ({ code, inviterId, uses }),
// ou null si la détection est impossible.
async function detecter(member) {
  const avant = compteurs.get(member.guild.id);
  const invites = await member.guild.invites.fetch().catch(() => null);
  if (!invites) return null;
  const apres = photographier(invites);
  compteurs.set(member.guild.id, apres);

  // Sans photo « avant » (bot fraîchement démarré ou arrivé), impossible de
  // dire quelle invitation a bougé : on enregistre l'arrivée sans inviteur
  // plutôt que d'en accuser une au hasard.
  if (!avant) {
    enregistrer.run(String(member.guild.id), String(member.id), null, null, Date.now());
    return null;
  }

  let trouvee = null;
  for (const [code, info] of apres) {
    if (info.uses > (avant?.get(code)?.uses ?? 0)) {
      trouvee = { code, inviterId: info.inviterId, uses: info.uses };
      break;
    }
  }
  // Invitation à usage unique : consommée, elle a disparu de la liste.
  if (!trouvee) {
    for (const [code, info] of avant) {
      if (!apres.has(code)) {
        trouvee = { code, inviterId: info.inviterId, uses: (info.uses || 0) + 1 };
        break;
      }
    }
  }
  // … ou sa suppression est déjà passée par invitationSupprimee (l'événement
  // de suppression arrive parfois avant celui de l'arrivée).
  if (!trouvee) {
    const liste = disparues.get(member.guild.id) || [];
    const fraiche = liste.find((d) => Date.now() - d.at < 15_000);
    if (fraiche) {
      trouvee = { code: fraiche.code, inviterId: fraiche.inviterId, uses: fraiche.uses };
      disparues.set(member.guild.id, liste.filter((d) => d !== fraiche));
    }
  }

  enregistrer.run(
    String(member.guild.id), String(member.id),
    trouvee?.inviterId ? String(trouvee.inviterId) : null,
    trouvee?.code || null, Date.now()
  );
  return trouvee;
}

// Nombre de membres amenés par quelqu'un sur ce serveur.
function totalDe(guildId, userId) {
  return totalStmt.get(String(guildId), String(userId))?.n || 0;
}

// Qui a invité ce membre (sa dernière arrivée enregistrée) ?
function inviteurDe(guildId, memberId) {
  return inviteurStmt.get(String(guildId), String(memberId)) || null;
}

function classement(guildId, limite = 10) {
  return classementStmt.all(String(guildId), limite);
}

module.exports = { primer, primerTout, invitationCreee, invitationSupprimee, detecter, totalDe, inviteurDe, classement };
