const { getGuildConfig } = require('../database');

// 🌍 La langue du bot, par serveur.
//
// Le français est la langue SOURCE : c'est en français que les messages sont
// écrits, et c'est vers lui qu'on retombe quand une traduction manque. Un
// message en français vaut infiniment mieux qu'une clé technique affichée
// telle quelle — et infiniment mieux qu'un texte vide.
//
// ⚠️ Ce fichier n'est PAS le dictionnaire du bot. Il ne porte que les rares
// textes dont la traduction dépend de variables — un accord, un ordre de
// mots — et qui ne peuvent donc pas être une simple correspondance de
// phrase à phrase.
//
// Tout le reste vit dans `traductions.json`, indexé par le texte français
// lui-même, et s'applique sur la couche réseau (`traduire.js`). Le panneau
// `/config` dit noir sur blanc ce qui est traduit et ce qui ne l'est pas :
// un texte sans traduction reste en français, jamais vide.
//
// Ajouter une langue = ajouter une colonne dans DICO. Une clé oubliée retombe
// en français, jamais dans le vide : un test le vérifie.

// `nomFr` sert aux consignes rédigées en français — celle envoyée à l'IA,
// par exemple : « réponds en anglais » se comprend mieux que « réponds en
// English ».
const LANGUES = {
  fr: { cle: 'fr', nom: 'Français', nomFr: 'français', drapeau: '🇫🇷', discord: 'fr' },
  en: { cle: 'en', nom: 'English', nomFr: 'anglais', drapeau: '🇬🇧', discord: 'en-GB' },
  de: { cle: 'de', nom: 'Deutsch', nomFr: 'allemand', drapeau: '🇩🇪', discord: 'de' },
  ru: { cle: 'ru', nom: 'Русский', nomFr: 'russe', drapeau: '🇷🇺', discord: 'ru' },
  es: { cle: 'es', nom: 'Español', nomFr: 'espagnol', drapeau: '🇪🇸', discord: 'es-ES' },
};
const CLES = Object.keys(LANGUES);
const DEFAUT = 'fr';

// Chaque entrée : une clé, cinq traductions. Les valeurs peuvent être des
// fonctions quand le texte dépend de variables — c'est indispensable hors du
// français, où l'ordre des mots et les accords diffèrent.
const DICO = {
  // ── Niveaux ──
  'niveau.montee': {
    fr: (v) => `🎉 <@${v.membre}> passe au **niveau ${v.niveau}** ! *(${v.origine})*`,
    en: (v) => `🎉 <@${v.membre}> reached **level ${v.niveau}**! *(${v.origine})*`,
    de: (v) => `🎉 <@${v.membre}> hat **Level ${v.niveau}** erreicht! *(${v.origine})*`,
    ru: (v) => `🎉 <@${v.membre}> достигает **уровня ${v.niveau}**! *(${v.origine})*`,
    es: (v) => `🎉 ¡<@${v.membre}> alcanza el **nivel ${v.niveau}**! *(${v.origine})*`,
  },
  'niveau.origine.vocal': { fr: 'en vocal 🎙️', en: 'in voice 🎙️', de: 'im Sprachkanal 🎙️', ru: 'в голосовом канале 🎙️', es: 'en voz 🎙️' },
  'niveau.origine.ecrit': { fr: 'en écrivant ✍️', en: 'by chatting ✍️', de: 'beim Schreiben ✍️', ru: 'в переписке ✍️', es: 'escribiendo ✍️' },
  'niveau.recompense': {
    fr: (v) => `🏅 Récompense débloquée : ${v.roles}`,
    en: (v) => `🏅 Reward unlocked: ${v.roles}`,
    de: (v) => `🏅 Belohnung freigeschaltet: ${v.roles}`,
    ru: (v) => `🏅 Открыта награда: ${v.roles}`,
    es: (v) => `🏅 Recompensa desbloqueada: ${v.roles}`,
  },
  'niveau.desactive': {
    fr: '📴 Le système de niveaux est **désactivé** sur ce serveur.',
    en: '📴 The level system is **disabled** on this server.',
    de: '📴 Das Levelsystem ist auf diesem Server **deaktiviert**.',
    ru: '📴 Система уровней на этом сервере **отключена**.',
    es: '📴 El sistema de niveles está **desactivado** en este servidor.',
  },

  // ── Rôles au clic ──
  'role.donne': {
    fr: (v) => `➕ Le rôle **${v.role}** vous a été donné.`,
    en: (v) => `➕ You have been given the **${v.role}** role.`,
    de: (v) => `➕ Du hast die Rolle **${v.role}** erhalten.`,
    ru: (v) => `➕ Вам выдана роль **${v.role}**.`,
    es: (v) => `➕ Se te ha dado el rol **${v.role}**.`,
  },
  'role.retire': {
    fr: (v) => `➖ Le rôle **${v.role}** vous a été retiré.`,
    en: (v) => `➖ The **${v.role}** role has been removed.`,
    de: (v) => `➖ Die Rolle **${v.role}** wurde entfernt.`,
    ru: (v) => `➖ Роль **${v.role}** снята.`,
    es: (v) => `➖ Se te ha quitado el rol **${v.role}**.`,
  },
  'role.disparu': {
    fr: '❌ Ce rôle n\'existe plus. Prévenez un responsable du serveur.',
    en: '❌ That role no longer exists. Please tell a server admin.',
    de: '❌ Diese Rolle existiert nicht mehr. Bitte informiere die Serverleitung.',
    ru: '❌ Этой роли больше нет. Сообщите администрации сервера.',
    es: '❌ Ese rol ya no existe. Avisa a un responsable del servidor.',
  },
  'role.tropHaut': {
    fr: (v) => `❌ Le rôle **${v.role}** est au-dessus du mien : je ne peux pas l'attribuer. Remontez mon rôle dans les paramètres du serveur.`,
    en: (v) => `❌ The **${v.role}** role is above mine, so I can't assign it. Move my role higher in the server settings.`,
    de: (v) => `❌ Die Rolle **${v.role}** steht über meiner — ich kann sie nicht vergeben. Verschiebe meine Rolle in den Servereinstellungen nach oben.`,
    ru: (v) => `❌ Роль **${v.role}** выше моей — я не могу её выдать. Поднимите мою роль в настройках сервера.`,
    es: (v) => `❌ El rol **${v.role}** está por encima del mío: no puedo asignarlo. Sube mi rol en los ajustes del servidor.`,
  },
  'role.sansPermission': {
    fr: '❌ Je n\'ai pas la permission « Gérer les rôles » sur ce serveur.',
    en: '❌ I don\'t have the "Manage Roles" permission on this server.',
    de: '❌ Mir fehlt die Berechtigung „Rollen verwalten" auf diesem Server.',
    ru: '❌ У меня нет права «Управление ролями» на этом сервере.',
    es: '❌ No tengo el permiso «Gestionar roles» en este servidor.',
  },
  'role.gere': {
    fr: (v) => `❌ **${v.role}** est géré par une intégration : il ne s'attribue pas à la main.`,
    en: (v) => `❌ **${v.role}** is managed by an integration and can't be assigned manually.`,
    de: (v) => `❌ **${v.role}** wird von einer Integration verwaltet und kann nicht manuell vergeben werden.`,
    ru: (v) => `❌ **${v.role}** управляется интеграцией — вручную её выдать нельзя.`,
    es: (v) => `❌ **${v.role}** lo gestiona una integración: no se puede asignar a mano.`,
  },
  'role.refuse': {
    fr: (v) => `❌ Discord a refusé la modification du rôle **${v.role}**.`,
    en: (v) => `❌ Discord refused to change the **${v.role}** role.`,
    de: (v) => `❌ Discord hat die Änderung der Rolle **${v.role}** abgelehnt.`,
    ru: (v) => `❌ Discord отклонил изменение роли **${v.role}**.`,
    es: (v) => `❌ Discord ha rechazado el cambio del rol **${v.role}**.`,
  },
  'role.menuRien': {
    fr: '➖ Aucun changement : vous aviez déjà exactement ces rôles.',
    en: '➖ Nothing changed: you already had exactly those roles.',
    de: '➖ Keine Änderung: Du hattest genau diese Rollen bereits.',
    ru: '➖ Ничего не изменилось: у вас уже были именно эти роли.',
    es: '➖ Sin cambios: ya tenías exactamente esos roles.',
  },

  // ── Tickets ──
  'ticket.ouvert': {
    fr: (v) => `🎫 Bonjour <@${v.membre}> ! Décrivez votre demande, le staff vous répondra ici.`,
    en: (v) => `🎫 Hello <@${v.membre}>! Describe your request and the staff will answer here.`,
    de: (v) => `🎫 Hallo <@${v.membre}>! Beschreibe dein Anliegen — das Team antwortet hier.`,
    ru: (v) => `🎫 Здравствуйте, <@${v.membre}>! Опишите ваш вопрос — команда ответит здесь.`,
    es: (v) => `🎫 ¡Hola <@${v.membre}>! Describe tu solicitud y el staff te responderá aquí.`,
  },
  'ticket.ferme': {
    fr: (v) => `Fermé par <@${v.par}>.`,
    en: (v) => `Closed by <@${v.par}>.`,
    de: (v) => `Geschlossen von <@${v.par}>.`,
    ru: (v) => `Закрыт пользователем <@${v.par}>.`,
    es: (v) => `Cerrado por <@${v.par}>.`,
  },
  'ticket.fermeTitre': { fr: '🔒 Ticket fermé', en: '🔒 Ticket closed', de: '🔒 Ticket geschlossen', ru: '🔒 Тикет закрыт', es: '🔒 Ticket cerrado' },
  'ticket.suppressionAuto': {
    fr: '🗑️ Ce salon va être **supprimé automatiquement**…',
    en: '🗑️ This channel will be **deleted automatically**…',
    de: '🗑️ Dieser Kanal wird **automatisch gelöscht**…',
    ru: '🗑️ Этот канал будет **удалён автоматически**…',
    es: '🗑️ Este canal se **eliminará automáticamente**…',
  },
  'ticket.reserveStaff': {
    fr: '⛔ Ces actions sont réservées au **staff du serveur** et aux rôles support de ce type de ticket.',
    en: '⛔ These actions are reserved for **server staff** and the support roles of this ticket type.',
    de: '⛔ Diese Aktionen sind dem **Serverteam** und den Support-Rollen dieses Ticket-Typs vorbehalten.',
    ru: '⛔ Эти действия доступны только **команде сервера** и ролям поддержки этого типа тикетов.',
    es: '⛔ Estas acciones están reservadas al **staff del servidor** y a los roles de soporte de este tipo de ticket.',
  },

  // ── Musique ──
  'musique.pasEnVocal': {
    fr: 'Rejoignez d\'abord un salon vocal.',
    en: 'Join a voice channel first.',
    de: 'Betritt zuerst einen Sprachkanal.',
    ru: 'Сначала зайдите в голосовой канал.',
    es: 'Entra primero en un canal de voz.',
  },
  'musique.rienEnLecture': {
    fr: '📭 Je ne joue rien pour le moment.',
    en: '📭 I\'m not playing anything right now.',
    de: '📭 Ich spiele gerade nichts.',
    ru: '📭 Сейчас ничего не играет.',
    es: '📭 No estoy reproduciendo nada ahora mismo.',
  },
  'musique.lecture': { fr: '▶️ Lecture', en: '▶️ Now playing', de: '▶️ Wiedergabe', ru: '▶️ Воспроизведение', es: '▶️ Reproduciendo' },
  'musique.ajoute': { fr: '➕ Ajouté à la file', en: '➕ Added to queue', de: '➕ Zur Warteschlange hinzugefügt', ru: '➕ Добавлено в очередь', es: '➕ Añadido a la cola' },
  'musique.file': { fr: '🎶 File d\'attente', en: '🎶 Queue', de: '🎶 Warteschlange', ru: '🎶 Очередь', es: '🎶 Cola de reproducción' },
  'musique.arrete': {
    fr: '⏹️ Terminé, je quitte le vocal.',
    en: '⏹️ Done — leaving the voice channel.',
    de: '⏹️ Fertig — ich verlasse den Sprachkanal.',
    ru: '⏹️ Готово — выхожу из голосового канала.',
    es: '⏹️ Listo, salgo del canal de voz.',
  },
  'musique.pause': { fr: '⏸️ En pause.', en: '⏸️ Paused.', de: '⏸️ Pausiert.', ru: '⏸️ Пауза.', es: '⏸️ En pausa.' },
  'musique.reprise': { fr: '▶️ On reprend.', en: '▶️ Resuming.', de: '▶️ Weiter geht\'s.', ru: '▶️ Продолжаем.', es: '▶️ Reanudando.' },
  'musique.relais': {
    fr: (v) => `ℹ️ ${v.source} ne permet à personne de diffuser son audio : je joue le même titre depuis YouTube.`,
    en: (v) => `ℹ️ ${v.source} lets no one stream its audio, so I play the same track from YouTube.`,
    de: (v) => `ℹ️ ${v.source} erlaubt niemandem, seinen Ton zu streamen — ich spiele denselben Titel von YouTube.`,
    ru: (v) => `ℹ️ ${v.source} никому не разрешает транслировать свой звук — я играю тот же трек с YouTube.`,
    es: (v) => `ℹ️ ${v.source} no permite a nadie retransmitir su audio: reproduzco el mismo tema desde YouTube.`,
  },
  'musique.reservePresents': {
    fr: (v) => `⛔ Rejoignez <#${v.salon}> pour piloter la lecture.`,
    en: (v) => `⛔ Join <#${v.salon}> to control playback.`,
    de: (v) => `⛔ Betritt <#${v.salon}>, um die Wiedergabe zu steuern.`,
    ru: (v) => `⛔ Зайдите в <#${v.salon}>, чтобы управлять воспроизведением.`,
    es: (v) => `⛔ Entra en <#${v.salon}> para controlar la reproducción.`,
  },

  // ── Refus et pannes vus par tout le monde ──
  'commun.horsServeur': {
    fr: '⛔ Ce bouton ne fonctionne que sur un serveur, pas en message privé.',
    en: '⛔ This button only works on a server, not in direct messages.',
    de: '⛔ Dieser Knopf funktioniert nur auf einem Server, nicht in Direktnachrichten.',
    ru: '⛔ Эта кнопка работает только на сервере, не в личных сообщениях.',
    es: '⛔ Este botón solo funciona en un servidor, no en mensajes privados.',
  },
  'commun.boutonPerime': {
    fr: '⏳ Ce bouton vient d\'une version précédente du bot et n\'est plus relié à rien.\n➜ Relancez la commande, ou demandez au staff de republier le panneau.',
    en: '⏳ This button is from an older version of the bot and no longer leads anywhere.\n➜ Run the command again, or ask the staff to repost the panel.',
    de: '⏳ Dieser Knopf stammt aus einer älteren Version des Bots und führt ins Leere.\n➜ Führe den Befehl erneut aus oder bitte das Team, das Panel neu zu posten.',
    ru: '⏳ Эта кнопка осталась от прежней версии бота и больше ни к чему не ведёт.\n➜ Запустите команду заново или попросите команду сервера переопубликовать панель.',
    es: '⏳ Este botón es de una versión anterior del bot y ya no lleva a ninguna parte.\n➜ Vuelve a ejecutar el comando, o pide al staff que republique el panel.',
  },
  'commun.actionEchouee': {
    fr: '❌ Cette action a échoué. Réessayez ; si cela recommence, prévenez le staff.',
    en: '❌ That action failed. Try again; if it keeps happening, tell the staff.',
    de: '❌ Diese Aktion ist fehlgeschlagen. Versuche es erneut; wenn es wieder passiert, sag dem Team Bescheid.',
    ru: '❌ Действие не удалось. Попробуйте ещё раз; если повторится — сообщите команде сервера.',
    es: '❌ La acción ha fallado. Inténtalo de nuevo; si se repite, avisa al staff.',
  },
  'commun.reserveStaff': {
    fr: '⛔ Réservé au **staff** du serveur.',
    en: '⛔ Reserved for server **staff**.',
    de: '⛔ Nur für das **Serverteam**.',
    ru: '⛔ Только для **команды сервера**.',
    es: '⛔ Reservado al **staff** del servidor.',
  },
};

// La langue d'un serveur. Français par défaut : c'est la langue d'origine du
// bot, et un serveur qui n'a rien choisi ne doit rien voir changer.
function langueDe(guildId) {
  try {
    const cle = String(getGuildConfig(guildId)?.bot_langue || DEFAUT).toLowerCase();
    return CLES.includes(cle) ? cle : DEFAUT;
  } catch {
    return DEFAUT;
  }
}

// 🗣️ Traduit une clé. `langue` accepte une clé de langue OU un identifiant de
// serveur — la plupart des appels n'ont que le serveur sous la main.
//
// Trois replis, dans cet ordre : la langue demandée, le français, puis la clé
// elle-même. Afficher la clé est laid, mais c'est visible : un texte vide
// passerait inaperçu pendant des mois.
function t(langue, cle, vars = {}) {
  const l = CLES.includes(String(langue)) ? String(langue) : langueDe(langue);
  const entree = DICO[cle];
  if (!entree) return cle;
  const valeur = entree[l] ?? entree[DEFAUT] ?? cle;
  return typeof valeur === 'function' ? valeur(vars) : valeur;
}

// Un traducteur figé sur une langue : plus lisible quand un même bloc de code
// écrit dix phrases d'affilée.
const pour = (langue) => (cle, vars) => t(langue, cle, vars);

// 📊 Ce qui est traduit, et ce qui ne l'est pas.
//
// Le panneau de configuration l'affiche : promettre un bot « multilingue »
// alors que la moitié des commandes reste en français tromperait davantage
// que de ne rien promettre.
function couverture(langue) {
  const l = CLES.includes(String(langue)) ? String(langue) : DEFAUT;
  const total = Object.keys(DICO).length;
  const traduites = Object.values(DICO).filter((e) => e[l] !== undefined).length;
  return { total, traduites, complet: traduites === total };
}

// Les clés qui manquent dans une langue — pour le test, et pour le jour où
// l'on ajoute une entrée en oubliant une colonne.
function manquantes(langue) {
  return Object.entries(DICO).filter(([, e]) => e[langue] === undefined).map(([k]) => k);
}

const liste = () => CLES.map((c) => LANGUES[c]);

module.exports = { LANGUES, CLES, DEFAUT, DICO, langueDe, t, pour, couverture, manquantes, liste };
