const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const { db } = require('../database');
const { GRADES } = require('../utils/permissions');
const { mettreAJour, suivre } = require('../utils/reponse');
const { planMariage, fabriquer } = require('../utils/imageAmour');

// 💍 /mariage — demander, accepter, divorcer.
//
// Un mariage suit les deux personnes partout où le bot est présent, comme
// les compteurs de /interact. Une personne n'a qu'un seul conjoint.
// Les boutons portent tout ce qu'il faut savoir (`mar:<action>:<a>:<b>`) :
// ils fonctionnent encore après un redémarrage du bot.

const COULEUR = 0xf6c177;
const EXPIRATION = 10 * 60 * 1000;

const paire = (x, y) => [String(x), String(y)].sort();
const conjointDe = db.prepare('SELECT * FROM mariages WHERE a = ? OR b = ?');
const marier = db.prepare('INSERT OR IGNORE INTO mariages (a, b, depuis, guild_id) VALUES (?, ?, ?, ?)');
const divorcer = db.prepare('DELETE FROM mariages WHERE a = ? AND b = ?');

function mariageDe(userId) {
  const m = conjointDe.get(String(userId), String(userId));
  if (!m) return null;
  return { ...m, conjoint: m.a === String(userId) ? m.b : m.a };
}

function nom(interaction, userId, user = null) {
  const membre = interaction.guild?.members?.cache?.get(userId);
  return membre?.displayName || user?.displayName || user?.globalName || user?.username || 'quelqu\'un';
}

// ── GIF de mariage ──────────────────────────────────────────────────────
//
// Aucune source de GIF sans clé ne propose de mariage. GIPHY (GIPHY_KEY,
// gratuite) en a beaucoup : on n'y garde que les résultats dont le titre
// parle vraiment de mariage, et on les met en réserve. Sans clé ni réserve,
// la carte part avec une image générée (deux alliances, les deux avatars).

const RESERVE = 'mariage@giphy';
const MOTS_MARIAGE = /wedding|marri|marry|bride|groom|vows|just married|propos/i;
const reserve = db.prepare('SELECT url FROM gif_cache WHERE categorie = ? ORDER BY RANDOM() LIMIT 1');
const compter = db.prepare('SELECT COUNT(*) AS n FROM gif_cache WHERE categorie = ?');
const garder = db.prepare('INSERT OR IGNORE INTO gif_cache (categorie, url, anime, at) VALUES (?, ?, NULL, ?)');
let derniereRecherche = 0;

async function gifMariage() {
  const cle = (process.env.GIPHY_KEY || '').trim();
  const enReserve = Number(compter.get(RESERVE)?.n || 0);
  // Réserve garnie et recherche récente : pas d'appel (100 recherches/heure).
  if (enReserve >= 10 && Date.now() - derniereRecherche < 20 * 60 * 1000) {
    const r = reserve.get(RESERVE);
    if (r?.url) return { url: r.url, giphy: true };
  }
  if (cle) {
    derniereRecherche = Date.now();
    try {
      const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(cle)}&q=${encodeURIComponent('anime wedding')}&limit=50&rating=pg&lang=en`;
      const res = await fetch(url, { headers: { 'User-Agent': 'discord-roblox-rp-bot' }, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const { urlStable } = require('./interact');
        const d = await res.json();
        const liste = (Array.isArray(d?.data) ? d.data : [])
          .filter((g) => MOTS_MARIAGE.test(`${g?.title || ''} ${String(g?.slug || '').replace(/-/g, ' ')} ${g?.alt_text || ''}`))
          .map((g) => urlStable(g.images?.original?.url || g.images?.downsized?.url))
          .filter((u) => /^https:\/\//.test(String(u || '')));
        const maintenant = new Date().toISOString();
        for (const u of liste) garder.run(RESERVE, u, maintenant);
        if (liste.length) return { url: liste[Math.floor(Math.random() * liste.length)], giphy: true };
      } else {
        console.warn(`⚠️ GIF de mariage (GIPHY) : HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn(`⚠️ GIF de mariage (GIPHY) : ${err.message}`);
    }
  }
  const r = reserve.get(RESERVE);
  return r?.url ? { url: r.url, giphy: true } : null;
}

// La carte des jeunes mariés : GIF si possible, sinon l'image des alliances.
async function carteMariage(interaction, userA, userB, depuis) {
  const nomA = nom(interaction, userA.id, userA);
  const nomB = nom(interaction, userB.id, userB);
  const quand = Math.floor(new Date(depuis).getTime() / 1000);
  const embed = new EmbedBuilder()
    .setColor(COULEUR)
    .setTitle('💒 Vive les mariés !')
    .setDescription(`**${nomA}** et **${nomB}** sont désormais unis pour le meilleur 💍\n-# Mariés le <t:${quand}:D>`);
  const payload = { content: `<@${userA.id}> <@${userB.id}>`, embeds: [embed] };
  const gif = await gifMariage().catch(() => null);
  if (gif?.url) {
    embed.setImage(gif.url);
    if (gif.giphy) embed.setFooter({ text: 'Powered by GIPHY' });
    return payload;
  }
  const date = new Date(depuis);
  const jour = `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${date.getUTCFullYear()}`;
  const png = await fabriquer(planMariage({ nomA, nomB, date: jour }), [userA, userB]).catch(() => null);
  if (png) {
    embed.setImage('attachment://mariage.png');
    payload.files = [new AttachmentBuilder(png, { name: 'mariage.png' })];
  }
  return payload;
}

function boutonsDemande(a, b) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mar:oui:${a}:${b}`).setLabel('Oui, je le veux').setEmoji('💍').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`mar:non:${a}:${b}`).setLabel('Refuser').setStyle(ButtonStyle.Secondary)
  )];
}

module.exports = {
  grade: GRADES.EVERYONE,
  public: true,
  guildModule: 'interact', // comme /interact : activable dans /config → 🎉 Communauté
  mariageDe, gifMariage, carteMariage, EXPIRATION,
  data: new SlashCommandBuilder()
    .setName('mariage')
    .setDescription('Demander quelqu\'un en mariage, voir un couple, divorcer 💍')
    .addSubcommand((s) =>
      s.setName('demander').setDescription('Demander un membre en mariage 💍')
        .addUserOption((o) => o.setName('membre').setDescription('Qui veux-tu épouser ?').setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName('statut').setDescription('Voir avec qui un membre est marié')
        .addUserOption((o) => o.setName('membre').setDescription('Quel membre ? (vide : toi)').setRequired(false))
    )
    .addSubcommand((s) => s.setName('divorcer').setDescription('Mettre fin à ton mariage 💔')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const moi = interaction.user;
    const prive = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (sub === 'statut') {
      const qui = interaction.options.getUser('membre') || moi;
      const m = mariageDe(qui.id);
      const embed = new EmbedBuilder().setColor(COULEUR).setTitle('💍 État civil');
      if (!m) {
        embed.setDescription(`**${nom(interaction, qui.id, qui)}** n'est marié·e à personne pour le moment.`);
      } else {
        const quand = Math.floor(new Date(m.depuis).getTime() / 1000);
        const conjoint = await interaction.client.users.fetch(m.conjoint).catch(() => null);
        embed.setDescription(`**${nom(interaction, qui.id, qui)}** est marié·e à **${nom(interaction, m.conjoint, conjoint)}** depuis <t:${quand}:R>.\n-# Le <t:${quand}:D>`);
      }
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'divorcer') {
      const m = mariageDe(moi.id);
      if (!m) return prive('💭 Tu n\'es pas marié·e : il n\'y a rien à rompre.');
      return interaction.reply({
        content: `💔 Divorcer de <@${m.conjoint}> ? C'est immédiat et sans retour (il faudra une nouvelle demande).`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`mar:div:${m.a}:${m.b}`).setLabel('Confirmer le divorce').setEmoji('💔').setStyle(ButtonStyle.Danger)
        )],
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral,
      });
    }

    // demander
    const cible = interaction.options.getUser('membre');
    if (cible.id === moi.id) return prive('🪞 Tu ne peux pas t\'épouser toi-même… choisis quelqu\'un d\'autre !');
    if (cible.bot) return prive('🤖 Les bots ne se marient pas… choisis un membre humain.');
    const mien = mariageDe(moi.id);
    if (mien) return prive(`💍 Tu es déjà marié·e à <@${mien.conjoint}>. Utilise \`/mariage divorcer\` d'abord.`);
    if (mariageDe(cible.id)) return prive(`💍 **${nom(interaction, cible.id, cible)}** est déjà marié·e.`);

    const embed = new EmbedBuilder()
      .setColor(COULEUR)
      .setTitle('💍 Demande en mariage')
      .setDescription(`**${nom(interaction, moi.id, moi)}** demande **${nom(interaction, cible.id, cible)}** en mariage !\n\n**${nom(interaction, cible.id, cible)}**, acceptes-tu ?\n-# La demande expire dans 10 minutes.`);
    return interaction.reply({ content: `<@${cible.id}>`, embeds: [embed], components: boutonsDemande(moi.id, cible.id) });
  },

  // mar:oui|non:<demandeur>:<demandé> ; mar:div:<a>:<b>
  async handleButton(interaction) {
    const [, action, x, y] = interaction.customId.split(':');
    const prive = (content) => suivre(interaction, { content, flags: MessageFlags.Ephemeral });

    if (action === 'div') {
      if (interaction.user.id !== x && interaction.user.id !== y) return prive('⛔ Seuls les deux mariés peuvent prononcer ce divorce.');
      const [a, b] = paire(x, y);
      if (divorcer.run(a, b).changes !== 1) {
        return mettreAJour(interaction, { content: '💭 Ce mariage n\'existe déjà plus.', components: [] });
      }
      const autre = interaction.user.id === x ? y : x;
      await mettreAJour(interaction, { content: '💔 Divorce prononcé.', components: [] });
      return suivre(interaction, {
        content: `💔 **${nom(interaction, interaction.user.id, interaction.user)}** et <@${autre}> ont divorcé.`,
        allowedMentions: { parse: [] },
      });
    }

    const demandeur = x;
    const demande = y;
    if (interaction.user.id !== demande) return prive('⛔ Seule la personne demandée peut répondre à cette demande.');
    if (Date.now() - (interaction.message?.createdTimestamp || Date.now()) > EXPIRATION) {
      await mettreAJour(interaction, { components: [] });
      return prive('⌛ Cette demande a expiré : il faut en refaire une avec `/mariage demander`.');
    }

    if (action === 'non') {
      await mettreAJour(interaction, { components: [] });
      return suivre(interaction, {
        content: `💔 **${nom(interaction, demande, interaction.user)}** a décliné la demande en mariage de <@${demandeur}>.`,
        allowedMentions: { parse: [] },
      });
    }

    if (action !== 'oui') return prive('❓ Bouton inconnu : il vient sans doute d\'une ancienne version.');

    // Revérifier au moment du « oui » : l'un des deux a pu se marier entre-temps.
    if (mariageDe(demandeur)) {
      await mettreAJour(interaction, { components: [] });
      return prive(`💍 <@${demandeur}> s'est marié·e entre-temps : la demande ne tient plus.`);
    }
    if (mariageDe(demande)) return prive('💍 Tu es déjà marié·e : divorce d\'abord avec `/mariage divorcer`.');

    const depuis = new Date().toISOString();
    const [a, b] = paire(demandeur, demande);
    if (marier.run(a, b, depuis, interaction.guildId || null).changes !== 1) {
      return prive('💍 Ce mariage existe déjà.');
    }
    await mettreAJour(interaction, { components: [] });
    const userA = await interaction.client.users.fetch(demandeur).catch(() => null);
    const payload = await carteMariage(interaction, userA || { id: demandeur }, interaction.user, depuis);
    return suivre(interaction, payload);
  },
};
