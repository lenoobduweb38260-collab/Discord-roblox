// 💌 Confessions anonymes : détection, publication, relecture au QG.
//
// Une confession propre part tout de suite dans le salon du serveur, SANS
// auteur. Une confession qui parle de suicide, de menace ou d'insulte ne part
// pas : elle est envoyée au salon QG du staff du bot (le même que les tickets,
// réglé par /botstaff salon-qg), qui la publie, la refuse ou blackliste son
// auteur.
//
// Trois règles :
//  • l'anonymat : on publie par `channel.send` — jamais par la réponse à la
//    commande, que Discord signerait « X a utilisé /confession » ;
//  • une confession signalée n'est JAMAIS publiée par défaut, même si le QG
//    est injoignable ;
//  • une seule décision par confession : le passage « en revue → publiée /
//    refusée » est verrouillé en base, deux clics simultanés n'en font qu'un.

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const { db, getGuildConfig } = require('../database');
const { COLORS } = require('./embeds');
const M = require('./miseEnPage');
const { etiquetteMembre } = require('./journal');
const { mettreAJour, suivre } = require('./reponse');

const COULEUR = 0xc77dff; // le violet des confessions (une couleur choisie, conservée par l'identité)

// ── Détection ───────────────────────────────────────────────────────────
//
// Le texte est ramené à une forme simple avant comparaison : minuscules,
// sans accents, chiffres « leet » remis en lettres (s4l0p3 → salope), lettres
// étirées raccourcies (connaaaard → connard), lettres espacées recollées
// (c o n n a r d → connard). Les motifs sont des EXPRESSIONS ENTIÈRES, pour
// ne pas signaler « tuer le temps » ou « mort de rire ».

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '€': 'e' };

function normaliser(texte) {
  let t = String(texte || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[013457@$€]/g, (c) => LEET[c] || c)
    .replace(/[^a-z\s]/g, ' ')
    .replace(/([a-z])\1{2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  // Lettres isolées à la suite (au moins trois) : un mot écrit espacé.
  t = t.replace(/\b(?:[a-z] ){2,}[a-z]\b/g, (m) => m.replace(/ /g, ''));
  return ` ${t} `;
}

const MOTIFS = {
  suicide: [
    /\b(je veux|j ai envie de|envie de|vais|je vais|veux) (me suicider|mourir|crever|en finir)\b/,
    /\bme (suicider|pendre|tuer|foutre en l air|scarifier|mutiler|tailler les veines)\b/,
    /\bsuicid(e|er|aire|aires)\b/,
    /\b(plus envie de vivre|plus la force de vivre|marre de vivre|en finir avec (la vie|tout)|mettre fin a mes jours)\b/,
    /\b(scarification|automutilation|auto mutilation|je me scarifie|je me mutile)\b/,
    /\b(kill myself|want to die|end my life|suicidal|self harm|kms)\b/,
  ],
  menace: [
    /\bje (vais|veux|vai) (te|le|la|vous|les|lui|leur) (tuer|buter|defoncer|egorger|planter|poignarder|frapper|cramer|massacrer|retrouver)\b/,
    /\bje vais (te|lui|vous) faire la peau\b/,
    /\b(t es|tu es|vous etes) (mort|morte|morts|mortes)\b(?! de rire)/,
    /\bje sais (ou tu|ou vous|ou il|ou elle) (habite|habites|habitez|vis|vit)\b/,
    /\b(poser une bombe|faire tout sauter|faire exploser le|tuerie|fusillade|attentat)\b/,
    /\b(i will|i ll|gonna|going to) (kill|hurt|find) you\b/,
  ],
  insulte: [
    /\b(connard|connards|connasse|connasses|salope|salopes|salaud|salauds|pute|putes|enfoire|enfoiree|encule|enculee|encules|batard|batarde|batards)\b/,
    /\b(fils de pute|fdp|ntm|nique ta mere|nique ta race|ta mere la pute|je te nique|va te faire foutre|ferme ta gueule|ftg)\b/,
    /\b(abruti|abrutie|debile|gogol|attarde|attardee|sous merde|grosse merde|tocard)\b/,
    /\b(pd|pede|tapette|tarlouze|gouine|negro|negre|bougnoule|youpin|bicot|chinetoque)\b/,
    /\bsale (noir|noire|arabe|juif|juive|blanc|blanche|chinois|chinoise|pd|gros|grosse|pute|race)\b/,
    /\b(cunt|bitch|fuck you|motherfucker|faggot|nigger|nigga|whore|slut|retard|kys)\b/,
  ],
};
const LIBELLES = { suicide: '🫶 Détresse (suicide)', menace: '⚠️ Menace', insulte: '🤬 Insulte' };

// { categories: ['suicide'|'menace'|'insulte'], extraits: ['…'] }
function detecter(texte) {
  const t = normaliser(texte);
  const categories = [];
  const extraits = [];
  for (const [categorie, motifs] of Object.entries(MOTIFS)) {
    for (const motif of motifs) {
      const m = t.match(motif);
      if (!m) continue;
      if (!categories.includes(categorie)) categories.push(categorie);
      if (extraits.length < 6 && !extraits.includes(m[0].trim())) extraits.push(m[0].trim());
    }
  }
  return { categories, extraits };
}

// ── Base ────────────────────────────────────────────────────────────────

const inserer = db.prepare(`INSERT INTO confessions
  (guild_id, guild_name, channel_id, author_id, author_tag, texte, categories, statut, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const lire = db.prepare('SELECT * FROM confessions WHERE id = ?');
const prochainNumero = db.prepare('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM confessions WHERE guild_id = ?');
const marquerPubliee = db.prepare('UPDATE confessions SET statut = ?, numero = ?, message_id = ? WHERE id = ?');
const verrouiller = db.prepare(
  "UPDATE confessions SET statut = ?, decide_par = ?, decide_le = ? WHERE id = ? AND statut = 'en_revue'"
);
const relacher = db.prepare("UPDATE confessions SET statut = 'en_revue', decide_par = NULL, decide_le = NULL WHERE id = ?");
const noterQg = db.prepare('UPDATE confessions SET qg_channel_id = ?, qg_message_id = ? WHERE id = ?');
const effacer = db.prepare('DELETE FROM confessions WHERE id = ?');
// Une confession propre dont la publication a échoué ne reste pas en base.
const oublier = (id) => effacer.run(id);

function enregistrer({ guild, salonId, auteur, texte, categories, statut }) {
  const r = inserer.run(
    guild.id, guild.name || null, salonId, auteur.id, auteur.tag || auteur.username || null,
    texte, categories.join(',') || null, statut, new Date().toISOString()
  );
  return lire.get(r.lastInsertRowid);
}

// ── Réglages ────────────────────────────────────────────────────────────

// Le salon des confessions de ce serveur, ou null si elles sont fermées.
function salonConfessions(guildId) {
  const cfg = getGuildConfig(guildId);
  if (!cfg.confession_enabled) return null;
  return cfg.confession_channel_id || null;
}

// ── Publication ─────────────────────────────────────────────────────────

function carteConfession(numero, texte) {
  return new EmbedBuilder()
    .setColor(COULEUR)
    .setTitle(`💌 Confession n°${numero}`)
    .setDescription(M.citation(texte, 4000));
}

// Publie dans le salon d'origine. Rend { ok: true, numero, url } ou
// { ok: false, raison } — jamais d'exception.
async function publier(client, confession) {
  const salon = await client.channels.fetch(confession.channel_id).catch(() => null);
  if (!salon?.isTextBased?.()) return { ok: false, raison: 'salon' };
  const numero = prochainNumero.get(confession.guild_id).n;
  const message = await salon
    .send({ embeds: [carteConfession(numero, confession.texte)], allowedMentions: { parse: [] } })
    .catch(() => null);
  if (!message) return { ok: false, raison: 'envoi' };
  marquerPubliee.run('publiee', numero, message.id, confession.id);
  return { ok: true, numero, url: message.url };
}

// ── Relecture au QG ─────────────────────────────────────────────────────

const STATUTS = {
  en_revue: '⏳ En attente de relecture',
  publiee: '✅ Publiée',
  refusee: '🗑️ Refusée',
  blacklist: '🚫 Refusée — auteur blacklisté',
};

function carteQg(confession, auteur = null) {
  const categories = String(confession.categories || '').split(',').filter(Boolean);
  const { extraits } = detecter(confession.texte);
  const qui = auteur ? etiquetteMembre(auteur) : `(\`${confession.author_id}\`) <@${confession.author_id}>`;
  const statut = STATUTS[confession.statut] || confession.statut;
  const par = confession.decide_par ? ` par <@${confession.decide_par}>` : '';
  const embed = new EmbedBuilder()
    .setColor(confession.statut === 'publiee' ? COLORS.SUCCESS : categories.includes('suicide') ? COLORS.WARNING : COLORS.DANGER)
    .setTitle('💌 Confession à relire')
    .setDescription(M.description([
      `**${confession.guild_name || 'Serveur'}** (\`${confession.guild_id}\`) · salon \`${confession.channel_id}\``,
      M.bloc('Détecté', [categories.map((c) => LIBELLES[c] || c).join(' · ') || '—', ...extraits.map((e) => `« ${e} »`)], { compte: null }),
      M.bloc('Auteur — confidentiel, jamais montré sur le serveur', [qui], { compte: null }),
      `📌 **${statut}**${par}`,
    ]))
    .addFields({ name: '💬 Confession', value: M.citation(confession.texte) });
  if (categories.includes('suicide')) {
    embed.addFields({
      name: '🫶 Une personne peut-être en détresse',
      value: 'Le bouton « Lui envoyer de l\'aide » lui écrit en privé avec le 3114 (France, gratuit, 24 h/24). Une réponse humaine compte aussi.',
    });
  }
  return embed;
}

function boutonsQg(confession) {
  if (confession.statut !== 'en_revue') return [];
  const categories = String(confession.categories || '').split(',');
  const rangee = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfs:pub:${confession.id}`).setLabel('Publier').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`cfs:del:${confession.id}`).setLabel('Refuser').setEmoji('🗑️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`cfs:ban:${confession.id}`).setLabel('Blacklister l\'auteur').setEmoji('🚫').setStyle(ButtonStyle.Danger)
  );
  if (categories.includes('suicide')) {
    rangee.addComponents(
      new ButtonBuilder().setCustomId(`cfs:aide:${confession.id}`).setLabel('Lui envoyer de l\'aide').setEmoji('🫶').setStyle(ButtonStyle.Primary)
    );
  }
  return [rangee];
}

// Envoie la carte au salon QG. Rend true si elle est partie.
async function signaler(client, confession, auteur) {
  const { hq } = require('./botTickets');
  const qg = hq();
  if (!qg?.channelId) return false;
  const salon = await client.channels.fetch(qg.channelId).catch(() => null);
  if (!salon?.isTextBased?.()) return false;
  const message = await salon
    .send({ embeds: [carteQg(confession, auteur)], components: boutonsQg(confession), allowedMentions: { parse: [] } })
    .catch(() => null);
  if (!message) return false;
  noterQg.run(salon.id, message.id, confession.id);
  return true;
}

// Réédite la carte du QG hors interaction (après une confirmation éphémère).
async function rafraichirQg(client, confession) {
  if (!confession.qg_channel_id || !confession.qg_message_id) return;
  const { enComposants, estCarte } = require('./reponse');
  const salon = await client.channels.fetch(confession.qg_channel_id).catch(() => null);
  const message = await salon?.messages?.fetch?.(confession.qg_message_id).catch(() => null);
  if (!message) return;
  const auteur = await client.users.fetch(confession.author_id).catch(() => null);
  const contenu = { embeds: [carteQg(confession, auteur)], components: boutonsQg(confession) };
  if (estCarte(message)) {
    const composants = enComposants(salon.guild, client, contenu);
    if (composants) await message.edit({ components: composants }).catch(() => null);
  } else {
    await message.edit(contenu).catch(() => null);
  }
}

// Le message d'aide envoyé à une personne en détresse.
const AIDE = [
  '🫶 **Tu n\'es pas seul·e.**',
  'Ta confession a été lue par une vraie personne de l\'équipe du bot, et elle compte.',
  '',
  'Si ça va mal, parler aide vraiment :',
  '➜ 📞 **3114** — numéro national de prévention du suicide (France), gratuit, 24 h/24 et 7 j/7',
  '➜ 🚑 **15** ou **112** en cas de danger immédiat',
  '➜ 🌍 Ailleurs : https://findahelpline.com',
  '',
  'Tu peux aussi en parler à quelqu\'un en qui tu as confiance. Prends soin de toi.',
].join('\n');

// ── Boutons du QG (cfs:<action>:<id>) ───────────────────────────────────

async function handleButton(interaction) {
  const { hasPerm, applyBlacklist } = require('./botTeam');
  const [, action, idBrut] = interaction.customId.split(':');
  const confession = lire.get(Number(idBrut));
  const prive = (content) => suivre(interaction, { content, flags: MessageFlags.Ephemeral });
  if (!confession) return prive('📭 Cette confession n\'existe plus en base : rien à faire.');

  const perm = action === 'ban' || action === 'banok' ? 'blacklist' : 'tickets';
  if (!(await hasPerm(interaction.client, interaction.user.id, perm))) {
    return prive(`⛔ Réservé au staff du bot qui a la permission **${perm === 'blacklist' ? 'Blacklist' : 'Tickets du QG'}**.`);
  }

  const auteur = await interaction.client.users.fetch(confession.author_id).catch(() => null);

  if (action === 'aide') {
    const parti = auteur ? await auteur.send({ content: AIDE }).then(() => true).catch(() => false) : false;
    return prive(parti
      ? '🫶 Message d\'aide envoyé en privé à l\'auteur.'
      : '📪 Impossible de lui écrire : ses messages privés sont fermés. Le message d\'aide lui a déjà été montré à l\'envoi de sa confession.');
  }

  if (confession.statut !== 'en_revue' && action !== 'banok') {
    return prive(`ℹ️ Déjà traitée : ${STATUTS[confession.statut] || confession.statut}.`);
  }

  if (action === 'ban') {
    return interaction.reply({
      content: `🚫 Blacklister l'auteur de la confession n°${confession.id} ? Il sera banni de **tous** les serveurs du bot, et la confession sera refusée.`,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cfs:banok:${confession.id}`).setLabel('Confirmer la blacklist').setEmoji('🚫').setStyle(ButtonStyle.Danger)
      )],
      flags: MessageFlags.Ephemeral,
    });
  }

  const maintenant = new Date().toISOString();

  if (action === 'banok') {
    if (confession.statut !== 'en_revue' && confession.statut !== 'refusee') {
      return mettreAJour(interaction, { content: `ℹ️ Déjà traitée : ${STATUTS[confession.statut] || confession.statut}.`, components: [] });
    }
    const r = await applyBlacklist(
      interaction.client, confession.author_id, `Confession signalée n°${confession.id}`, interaction.user.id, null
    ).catch((err) => ({ erreur: err.message }));
    if (r?.immune) {
      return mettreAJour(interaction, { content: '🛡️ Cet auteur est immunisé (créateur ou liste d\'immunité) : blacklist impossible. Refusez la confession à la place.', components: [] });
    }
    if (r?.erreur) {
      return mettreAJour(interaction, { content: `❌ La blacklist a échoué : ${r.erreur}. Réessayez, ou refusez la confession.`, components: [] });
    }
    db.prepare('UPDATE confessions SET statut = ?, decide_par = ?, decide_le = ? WHERE id = ?')
      .run('blacklist', interaction.user.id, maintenant, confession.id);
    await rafraichirQg(interaction.client, lire.get(confession.id));
    return mettreAJour(interaction, { content: `🚫 Auteur blacklisté (banni sur ${r?.banned ?? 0} serveur(s)), confession refusée.`, components: [] });
  }

  if (action === 'del') {
    if (verrouiller.run('refusee', interaction.user.id, maintenant, confession.id).changes !== 1) {
      return prive('ℹ️ Un autre membre du staff vient de la traiter.');
    }
    const maj = lire.get(confession.id);
    await mettreAJour(interaction, { embeds: [carteQg(maj, auteur)], components: [] });
    await auteur?.send({
      content: `💌 Ta confession sur **${maj.guild_name || 'le serveur'}** n'a pas été publiée : elle ne respecte pas les règles. Tu peux en écrire une autre.`,
    }).catch(() => null);
    return;
  }

  if (action === 'pub') {
    if (verrouiller.run('publiee', interaction.user.id, maintenant, confession.id).changes !== 1) {
      return prive('ℹ️ Un autre membre du staff vient de la traiter.');
    }
    const r = await publier(interaction.client, lire.get(confession.id));
    if (!r.ok) {
      relacher.run(confession.id);
      return prive(r.raison === 'salon'
        ? '📭 Le salon des confessions de ce serveur n\'existe plus, ou le bot n\'y a plus accès : publication impossible.'
        : '❌ Le bot n\'arrive pas à écrire dans le salon des confessions (permissions ?). La confession reste en attente.');
    }
    const maj = lire.get(confession.id);
    await mettreAJour(interaction, { embeds: [carteQg(maj, auteur)], components: [] });
    await auteur?.send({ content: `💌 Ta confession sur **${maj.guild_name || 'le serveur'}** a été relue et publiée (n°${r.numero}).` }).catch(() => null);
    return;
  }

  return prive('❓ Action inconnue sur cette confession : la carte vient sans doute d\'une ancienne version.');
}

module.exports = {
  normaliser, detecter, MOTIFS, LIBELLES, AIDE,
  salonConfessions, enregistrer, publier, signaler, carteConfession, carteQg, boutonsQg, handleButton, lire, oublier,
};
