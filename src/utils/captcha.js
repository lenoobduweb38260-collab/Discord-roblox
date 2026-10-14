const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { getGuildConfig } = require('../database');
const { COLORS } = require('./embeds');

// Captcha de vérification à l'arrivée : un bouton, puis un code aléatoire à
// recopier.
//
//   • le bouton n'obéit qu'au membre pour qui il a été publié ;
//   • au bout de N erreurs (3 par défaut), le membre est expulsé ;
//   • réussite → un rôle est donné, un autre peut être retiré
//     (typiquement « Visiteur »), plus les rôles automatiques.
const pending = new Map();  // "guild:user" -> code attendu
const essais = new Map();   // "guild:user" -> nombre d'échecs

// Code de vérification : TOUJOURS un mélange de lettres et de chiffres.
// Avant, les 5 caractères étaient tirés d'un seul sac : une fois sur trois le
// code ne contenait que des lettres. Ici on impose 3 lettres + 2 chiffres,
// puis on mélange les positions.
// I, L, O, 0 et 1 sont exclus : illisibles selon la police.
const LETTRES = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const CHIFFRES = '23456789';
const LONGUEUR = 5;

function tirer(sac, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += sac[Math.floor(Math.random() * sac.length)];
  return s;
}

function genCode(precedent) {
  for (let essai = 0; essai < 12; essai++) {
    const brut = (tirer(LETTRES, 3) + tirer(CHIFFRES, LONGUEUR - 3)).split('');
    // Mélange de Fisher-Yates : les chiffres ne sont pas toujours à la fin.
    for (let i = brut.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [brut[i], brut[j]] = [brut[j], brut[i]];
    }
    const code = brut.join('');
    // Un nouveau tirage à chaque tentative : jamais deux fois le même code
    // d'affilée, sinon la vérification paraîtrait figée.
    if (code !== precedent) return code;
  }
  return tirer(LETTRES, 3) + tirer(CHIFFRES, LONGUEUR - 3);
}

// Nombre d'erreurs tolérées avant l'expulsion (1 à 10, 3 par défaut).
function maxEssais(cfg) {
  const n = parseInt(cfg.captcha_max_essais, 10);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : 3;
}

async function onJoin(member) {
  const cfg = getGuildConfig(member.guild.id);
  if (!cfg.captcha_enabled || !cfg.verified_role_id) return;
  const channel = cfg.captcha_channel_id
    ? await member.guild.channels.fetch(cfg.captcha_channel_id).catch(() => null)
    : member.guild.systemChannel;
  if (!channel?.isTextBased()) return;

  const max = maxEssais(cfg);
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🤖 Vérification')
    .setDescription(
      `Bienvenue <@${member.id}> ! Cliquez sur le bouton pour prouver que vous n'êtes pas un robot ` +
      'et accéder au serveur.'
    )
    .addFields({
      name: '⚠️ Attention',
      value: cfg.captcha_kick === 0
        ? `Vous avez ${max} tentative(s).`
        : `Au bout de **${max} erreurs**, vous serez expulsé du serveur.`,
    });
  // L'identifiant du membre est inscrit dans le bouton : personne d'autre ne
  // peut consommer sa vérification (avant, n'importe qui pouvait cliquer).
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`captcha:verify:${member.id}`)
      .setLabel('Je ne suis pas un robot')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
  );
  await channel.send({ content: `<@${member.id}>`, embeds: [embed], components: [row] }).catch(() => null);
}

// Réussite : rôle donné, rôle retiré, rôles automatiques.
async function reussir(interaction, cfg, member) {
  const donnes = [];
  if (cfg.verified_role_id) {
    const ok = await member.roles.add(cfg.verified_role_id, 'Captcha validé').then(() => true).catch(() => false);
    if (ok) donnes.push(cfg.verified_role_id);
  }
  // Retrait du rôle d'attente (« Visiteur », « Non vérifié »…) : c'est lui qui
  // bloquait l'accès tant que la vérification n'était pas faite.
  let retire = false;
  if (cfg.captcha_role_remove && member.roles.cache.has(cfg.captcha_role_remove)) {
    retire = await member.roles
      .remove(cfg.captcha_role_remove, 'Captcha validé')
      .then(() => true)
      .catch((err) => {
        console.warn(`⚠️ Captcha : rôle « ${cfg.captcha_role_remove} » non retiré sur ${member.guild.name} : ${err.message}`);
        return false;
      });
  }
  // 🎭 Rôles automatiques : c'est ICI qu'ils arrivent quand un captcha est
  // actif. Sans cela, le membre resterait « Visiteur » après s'être vérifié.
  await require('./autoRoles').appliquer(member, 'Rôle automatique après captcha').catch(() => null);

  const detail = [
    donnes.length ? '✅ accès débloqué' : null,
    retire ? '🧹 rôle d\'attente retiré' : null,
  ].filter(Boolean).join(' · ');
  return interaction.reply({
    content: `✅ Vérifié ! Bienvenue 🎉${detail ? `\n${detail}` : ''}`,
    flags: MessageFlags.Ephemeral,
  });
}

// Échec : on compte, on prévient, et on expulse au dernier.
async function echouer(interaction, cfg, key, member) {
  const n = (essais.get(key) || 0) + 1;
  essais.set(key, n);
  const max = maxEssais(cfg);
  const restant = max - n;

  if (restant > 0) {
    return interaction.reply({
      content: `❌ Code incorrect. Il vous reste **${restant}** tentative(s) — recliquez sur le bouton pour réessayer.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  essais.delete(key);
  pending.delete(key);

  if (cfg.captcha_kick === 0) {
    return interaction.reply({
      content: `❌ Code incorrect. Vous avez épuisé vos ${max} tentatives — contactez le staff.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // On prévient AVANT d'expulser : après le kick, le membre n'est plus là pour
  // recevoir la réponse à son interaction.
  await interaction.reply({
    content: `❌ Code incorrect — ${max} erreurs. Vous allez être expulsé du serveur. Vous pourrez revenir et réessayer.`,
    flags: MessageFlags.Ephemeral,
  }).catch(() => null);

  if (!member) return null;
  if (!member.kickable) {
    console.warn(`⚠️ Captcha : impossible d'expulser ${member.user.tag} de ${member.guild.name} ` +
      '(rôle du bot trop bas, ou permission « Expulser des membres » manquante).');
    return null;
  }
  return member.kick(`Captcha échoué ${max} fois`).catch((err) => {
    console.warn(`⚠️ Captcha : expulsion refusée sur ${member.guild.name} : ${err.message}`);
    return null;
  });
}

async function handle(interaction) {
  if (interaction.isButton()) {
    // Le bouton porte l'identifiant de son destinataire : « captcha:verify:123 ».
    // (Les anciens messages, sans identifiant, restent utilisables par tous.)
    const cible = interaction.customId.split(':')[2];
    if (cible && cible !== interaction.user.id) {
      return interaction.reply({
        content: '⛔ Cette vérification ne vous est pas destinée — attendez la vôtre à votre arrivée.',
        flags: MessageFlags.Ephemeral,
      });
    }
    const cle = `${interaction.guildId}:${interaction.user.id}`;
    const code = genCode(pending.get(cle));
    pending.set(cle, code);
    const modal = new ModalBuilder().setCustomId('captcha:check').setTitle('Vérification');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('code')
          .setLabel(`Recopiez ce code : ${code}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(LONGUEUR)
          .setMaxLength(LONGUEUR)
      )
    );
    return interaction.showModal(modal);
  }

  // Soumission du modal
  const key = `${interaction.guildId}:${interaction.user.id}`;
  const expected = pending.get(key);
  const given = interaction.fields.getTextInputValue('code').trim().toUpperCase();
  const cfg = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

  if (!expected || given !== expected) {
    return echouer(interaction, cfg, key, member);
  }
  pending.delete(key);
  essais.delete(key);
  if (!member) {
    return interaction.reply({ content: '✅ Code correct, mais vous n\'êtes plus sur le serveur.', flags: MessageFlags.Ephemeral });
  }
  return reussir(interaction, cfg, member);
}

module.exports = { onJoin, handle };
