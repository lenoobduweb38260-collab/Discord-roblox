const { Events } = require('discord.js');
const { getGuildConfig } = require('../database');
const { gagnerXpServeur, gainTexteXp, estExcluXp, levelsEnabled } = require('../utils/levels');
const { scanMessage } = require('../utils/scamImages');

// Anti-spam XP : un gain par utilisateur et par période de cooldown.
const cooldowns = new Map();

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.inGuild()) return;

    // ⏰ Le rappel de bump écoute DISBOARD — qui EST un bot : sa réponse doit
    // passer AVANT l'écarte-bots, sans quoi aucun bump ne serait jamais vu.
    if (message.author.bot) {
      try {
        await require('../utils/bumpReminder').surveiller(message);
      } catch (err) {
        console.warn(`⚠️ Rappel de bump : ${err.message}`);
      }
      return;
    }

    const cfg = getGuildConfig(message.guild.id);
    const salonComptage = Boolean(cfg.comptage_channel_id) && String(message.channelId) === String(cfg.comptage_channel_id);

    // 🔢 Un nombre du salon de comptage prend sa place dans la file de son
    // salon ICI, avant le premier `await` : les messages y sont jugés dans
    // l'ordre d'ARRIVÉE. Un nombre accompagné d'une image (l'anti-scam la
    // télécharge) passait sinon après les suivants, et la série cassait à
    // tort. Sa place attend le verdict des filtres ci-dessous.
    let placeComptage = null;
    if (salonComptage) {
      try {
        placeComptage = require('../utils/comptage').reserverPlaceComptage(message, cfg);
      } catch (err) {
        console.error('Erreur salon de comptage :', err);
      }
    }
    const abandonnerComptage = () => placeComptage?.liberer(false);

    // Anti-scam : vérifie les images jointes contre les échantillons enregistrés.
    // Une image reconnue rend sa place au comptage AUSSITÔT : la sanction qui
    // suit (preuves, effacement, ban partout) peut dépasser le délai d'attente
    // de la file, et le nombre aurait alors été jugé quand même.
    if (message.attachments.size) {
      const handled = await scanMessage(message, { surCorrespondance: abandonnerComptage }).catch((err) => {
        console.error('Erreur scan anti-scam :', err);
        return false;
      });
      if (handled) { abandonnerComptage(); return; } // message supprimé + auteur banni : pas d'XP
    }

    // Anti-spam + filtre de contenu malveillant (si activé sur ce serveur).
    if (cfg.antispam_enabled) {
      const handled = await require('../utils/messageGuard')
        .guard(message, cfg)
        .catch((err) => {
          console.error('Erreur messageGuard :', err);
          return false;
        });
      if (handled) { abandonnerComptage(); return; }
    }

    // ══ 🔢 SALON DE COMPTAGE ═══════════════════════════════════════════
    // Après l'anti-scam et l'anti-spam : un message qu'ils ont supprimé ne
    // compte pas. Avant le délai d'XP, dont le `return` sauterait le jeu.
    // Un nombre compté continue ensuite son chemin normal (IA, XP) ; seul un
    // hors-jeu que le comptage vient d'EFFACER s'arrête ici.
    if (salonComptage) {
      const compte = await require('../utils/comptage')
        .traiterMessageComptage(message, cfg, placeComptage)
        .catch((err) => {
          console.error('Erreur salon de comptage :', err);
          return null;
        });
      if (compte?.supprime) return;
    }
    // ══ fin du salon de comptage ═══════════════════════════════════════

    // Réponse IA supervisée : sur mention du bot, il propose une réponse au
    // créateur en MP (ne bloque pas l'XP ; inactif sans AI_API_KEY).
    if (process.env.AI_API_KEY && message.mentions.has(message.client.user) && !message.mentions.everyone) {
      require('../utils/aiResponder').onMention(message).catch(() => null);
    }

    // 📈 XP : système actif, message assez long, salon et rôles non exclus —
    // vérifiés AVANT le délai, pour qu'un message qui ne rapporte rien ne
    // consomme pas le droit au prochain gain.
    if (!levelsEnabled(message.guild.id)) return;
    const longueurMin = Number(cfg.xp_longueur_min ?? 0) || 0;
    if (longueurMin > 0 && String(message.content || '').trim().length < longueurMin) return;
    const contexte = { membre: message.member, salon: message.channel };
    if (estExcluXp(message.guild.id, 'text', contexte)) return;

    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const last = cooldowns.get(key) || 0;
    if (now - last < (cfg.xp_cooldown ?? 60) * 1000) return;
    cooldowns.set(key, now);

    // Gain fixe, ou tiré entre le minimum et le maximum ; annonce et
    // récompenses dans le salon du message quand le serveur le veut.
    await gagnerXpServeur(message.guild, message.author.id, 'text', gainTexteXp(cfg), contexte);
  },
};
