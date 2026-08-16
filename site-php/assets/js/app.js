(() => {
  "use strict";

  const app = document.querySelector("#app");
  const modalRoot = document.querySelector("#modal-root");
  const toastRoot = document.querySelector("#toast-root");
  const boot = document.querySelector("#boot-screen");
  const sky = document.querySelector(".sky-layer");
  const cursorAura = document.querySelector("#cursor-aura");

  let state = window.AINCRAD_BOOT_STATE || {};
  const storage = (() => {
    try {
      const probe = "aincrad.storage.probe";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (_) {
      const memory = new Map();
      return {
        getItem: key => memory.has(key) ? memory.get(key) : null,
        setItem: (key, value) => memory.set(key, String(value)),
        removeItem: key => memory.delete(key),
      };
    }
  })();
  const ui = {
    activeBotId: storage.getItem("aincrad.activeBot") || null,
    route: storage.getItem("aincrad.activeBot") ? "dashboard" : "gate",
    selectedServerId: storage.getItem("aincrad.server") || (state.servers?.[0]?.id ?? null),
    module: "overview",
    selectedTicketId: state.tickets?.find(t => t.status !== "fermé")?.id || state.tickets?.[0]?.id || null,
    blacklistQuery: "",
    serverQuery: "",
    mobileOpen: false,
    creatorTab: "page",
    blocks: null,        // blocs en cours d'édition dans le constructeur de page
    previewGrade: null,  // grade simulé (aperçu « qui voit quoi »)
    agentBots: null,     // bots vus chez l'agent (null = pas encore interrogé)
    agentErreur: null,
    agentReglages: null, // adresse retenue + origine (la clé n'arrive jamais ici)
    discord: null,       // réglages de la connexion Discord (null = pas encore lus)
    maj: null,           // état des mises à jour (null = pas encore lu)
    db: null,            // configuration de la base (null = pas encore lue)
    serveursTous: false, // afficher TOUS les serveurs plutôt que les miens
    // Renseignés dès le chargement de la page, puis rafraîchis par l'API.
    mesServeursSansBot: (window.AINCRAD_MES_SERVEURS || {}).sansBot || [],
    nbMesServeurs: (window.AINCRAD_MES_SERVEURS || {}).total || 0,
    monGrade: {},        // grade réel par serveur, renvoyé par le bot
    srvParams: {},       // salons/rôles/config par serveur (venant du bot)
    msg: null,           // brouillon du constructeur de messages
    bandeauVu: false,    // bandeau Discord (erreur / bienvenue) déjà refermé
    menuProfil: false,   // menu déroulant du profil ouvert ?
    ticketTab: "open",   // tickets en cours / archives
    selectedArchiveId: null,
    archiveQuery: "",
  };

  const icons = {
    dashboard: "⌂",
    servers: "⌘",
    blacklist: "⊘",
    tickets: "▣",
    creator: "◇",
    config: "⚙",
    overview: "01",
    rp: "02",
    arrivals: "03",
    roles: "04",
    channels: "05",
    levels: "06",
    whitelist: "07",
    ticketModule: "08",
  };

  const modules = [
    { id: "overview", label: "Vue d'ensemble", desc: "État global, activité et identité du serveur" },
    { id: "rp", label: "Module RP", desc: "Personnages, économie et systèmes de jeu" },
    { id: "identite", label: "Identité des embeds", desc: "Couleur et signature de TOUS les messages du bot" },
    { id: "arrivals", label: "Arrivées & départs", desc: "Messages et salons d'accueil" },
    { id: "roles", label: "Rôles & sécurité", desc: "Protection, permissions et autorôles" },
    { id: "channels", label: "Salons & logs", desc: "Journalisation complète du serveur" },
    { id: "levels", label: "Niveaux", desc: "XP, récompenses et progression" },
    { id: "messages", label: "Messages & embeds", desc: "Composer et envoyer sur Discord" },
    { id: "tickets", label: "Tickets", desc: "Configuration du support intégré" },
  ];

  // Avatar d'un bot : sa VRAIE photo de profil Discord si elle a été
  // récupérée, sinon l'initiale colorée.
  function botAvatar(bot, cls = "") {
    const accent = bot?.accent === "rose" ? "rose" : (bot?.accent || "cyan");
    if (bot?.avatar) {
      return `<span class="bot-avatar ${accent} ${cls} has-img"><img src="${esc(bot.avatar)}" alt="" loading="lazy"></span>`;
    }
    return `<span class="bot-avatar ${accent} ${cls}">${esc((bot?.name || "B").slice(0, 1))}</span>`;
  }
  // Icône d'un serveur : celle de Discord si connue, sinon les initiales.
  function serverIcon(server) {
    if (server?.icon) return `<span class="server-emblem has-img"><img src="${esc(server.icon)}" alt="" loading="lazy"></span>`;
    return `<span class="server-emblem">${esc(server?.short || "SV")}</span>`;
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
  }

  function slug(value) {
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }

  function activeBot() {
    return state.bots?.find(bot => bot.id === ui.activeBotId) || state.bots?.[0] || {};
  }

  function selectedServer() {
    return state.servers?.find(server => server.id === ui.selectedServerId) || state.servers?.[0] || {};
  }

  function botServers(botId = ui.activeBotId) {
    return (state.servers || []).filter(server => server.botIds?.includes(botId));
  }

  function siteConfig() {
    return state.siteConfig || {};
  }

  // ── Site builder : navigation configurable ─────────────────────────
  const NAV_DEFAULTS = [
    { id: "dashboard", label: "Vue d'ensemble", show: true },
    { id: "servers", label: "Mes serveurs", show: true },
    { id: "blacklist", label: "Blacklist & preuves", show: true },
    { id: "tickets", label: "Gestion des tickets", show: true },
    { id: "creator", label: "Espace créateur", show: true },
    { id: "site-config", label: "Site builder", show: true },
  ];
  function navConfig() {
    const saved = Array.isArray(siteConfig().nav) ? siteConfig().nav : [];
    const merged = saved
      .filter(item => NAV_DEFAULTS.some(d => d.id === item.id))
      .map(item => ({ ...NAV_DEFAULTS.find(d => d.id === item.id), ...item }));
    NAV_DEFAULTS.forEach(d => { if (!merged.some(item => item.id === d.id)) merged.push({ ...d }); });
    return merged;
  }

  // Accents nommés hérités de l'ancienne version + conversion hexadécimale.
  const ACCENT_PRESETS = { cyan: "#4fd9ff", rose: "#ff7ca5", gold: "#f3c86a" };
  const SWATCHES = ["#a970ff", "#4fd9ff", "#ff7ca5", "#2fe38b", "#f3c86a", "#ff5c74", "#6a8bff", "#ff9d5c"];
  // Fonds proposés dans le Site builder (l'ordre est celui des vignettes).
  const BG_TYPES = ["image", "video", "aurora", "stars", "grid", "none"];
  function accentHex(cfg = siteConfig()) {
    const value = cfg.accentColor || ACCENT_PRESETS[cfg.accent] || "#a970ff";
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#a970ff";
  }
  function hexToRgb(hex) {
    return `${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}`;
  }

  function defaultServerSettings() {
    return state.serverSettings?.["srv-aincrad"] || {
      overview: {}, rp: {}, arrivals: {}, roles: {}, channels: {}, levels: {}, whitelist: {}, tickets: {},
    };
  }

  function serverSettings(serverId = ui.selectedServerId) {
    const original = state.serverSettings?.[serverId];
    if (original) return original;
    return JSON.parse(JSON.stringify(defaultServerSettings()));
  }

  async function api(action, payload = {}, options = {}) {
    const url = `${window.AINCRAD_API}?action=${encodeURIComponent(action)}`;

    // Envoie la requête et essaie de lire du JSON. En cas de réponse
    // illisible, on renvoie le texte brut pour pouvoir diagnostiquer.
    async function envoyer(config) {
      const response = await fetch(url, config);
      const texte = await response.text();
      try {
        return { data: JSON.parse(texte), response };
      } catch (_) {
        return { data: null, texte, response };
      }
    }

    let tentative;
    if (options.formData) {
      tentative = await envoyer({ method: "POST", body: options.formData });
    } else {
      const corps = JSON.stringify({ action, ...payload });
      tentative = await envoyer({ method: "POST", headers: { "Content-Type": "application/json" }, body: corps });
      // Plan B : certains hébergeurs mutualisés bloquent les POST JSON.
      // On rejoue la même requête en formulaire classique.
      if (!tentative.data) {
        const form = new URLSearchParams();
        form.set("action", action);
        form.set("payload", corps);
        tentative = await envoyer({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
      }
    }

    const { data, texte, response } = tentative;
    if (!data) {
      // Message précis plutôt qu'un « réponse invalide » sans info.
      const extrait = String(texte || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      throw new Error(`Le serveur n'a pas renvoyé de JSON (HTTP ${response.status}). ` +
        (extrait ? `Réponse : « ${extrait} »` : "Réponse vide.") +
        " — ouvrez api.php?action=selftest pour un diagnostic.");
    }
    // 🔒 Mot de passe demandé : on ouvre la fenêtre de connexion.
    if (response.status === 401 && data.authRequired) {
      openLoginModal();
      throw new Error("Connexion requise pour modifier le site.");
    }
    if (!response.ok || !data.ok) {
      // On garde la réponse complète : certains écrans (connexion à l'agent)
      // ont besoin du détail même quand l'appel échoue.
      const erreur = new Error(data.error || `Une erreur est survenue (HTTP ${response.status}).`);
      erreur.data = data;
      throw erreur;
    }
    if (data.state) state = data.state;
    if (Array.isArray(data.mesServeursSansBot)) ui.mesServeursSansBot = data.mesServeursSansBot;
    if (typeof data.nbMesServeurs === "number") ui.nbMesServeurs = data.nbMesServeurs;
    if (typeof data.authOk === "boolean") AUTH.ok = data.authOk;
    return data;
  }

  // État de la protection et compte connecté.
  const AUTH = window.AINCRAD_AUTH || { required: false, ok: true, motDePasse: false };
  const MOI = window.AINCRAD_MOI || null;                 // profil Discord, ou null
  const DISCORD = window.AINCRAD_DISCORD || { pret: false };

  // 🔑 Fenêtre de connexion : le compte Discord d'abord, le mot de passe de
  // secours seulement s'il en existe un.
  function openLoginModal() {
    const boutonDiscord = DISCORD.pret
      ? `<a class="btn primary" href="oauth.php?p=login" style="width:100%;justify-content:center;text-decoration:none">
           <span style="font-size:15px">🎮</span> Se connecter avec Discord</a>`
      : `<div class="row" style="border-color:rgba(243,200,106,.45)">⚙️ <b>Connexion Discord pas encore configurée</b>
           <span style="color:var(--muted)">Le propriétaire du site doit la mettre en place dans ⚙️ Créateur → 🔑 Connexion Discord.</span></div>`;
    const secours = AUTH.motDePasse ? `
      <div style="display:flex;align-items:center;gap:10px;margin:16px 0 12px">
        <i style="flex:1;height:1px;background:rgba(255,255,255,.12)"></i>
        <span style="color:var(--muted-2);font-size:12px">ou mot de passe de secours</span>
        <i style="flex:1;height:1px;background:rgba(255,255,255,.12)"></i>
      </div>
      <form data-form="auth-login">
        <div class="field"><label>Mot de passe</label><input class="input" type="password" name="password" autocomplete="current-password" required></div>
        <div class="form-actions"><button class="btn ghost" type="button" data-action="close-modal">Annuler</button><button class="btn success" type="submit">Se connecter</button></div>
      </form>` : `<div class="form-actions" style="margin-top:14px"><button class="btn ghost" type="button" data-action="close-modal">Fermer</button></div>`;
    openModal("🔒 Connexion", `
      <p style="color:var(--muted);font-size:13px;margin-bottom:14px">
        Identifiez-vous avec <b>votre compte Discord</b> — c'est le même que sur vos serveurs.
      </p>
      ${boutonDiscord}
      ${secours}`);
  }

  // Une session est-elle ouverte, d'une façon ou d'une autre ?
  function connecte() { return Boolean(MOI) || (AUTH.required && AUTH.ok); }

  // Relit l'état complet (serveurs, mes serveurs, grades) depuis le serveur.
  async function rafraichirEtat() {
    const r = await fetch(`${window.AINCRAD_API}?action=state`);
    const d = await r.json();
    if (!d.ok) return;
    state = d.state;
    ui.mesServeursSansBot = d.mesServeursSansBot || [];
    ui.nbMesServeurs = d.nbMesServeurs || 0;
  }

  // 🎭 Grade réel du membre sur un serveur, tel que le bot le calcule
  // (rôles staff / administration / police configurés dans le bot).
  async function chargerMonGrade(serveurId) {
    if (!MOI || !serveurId || ui.monGrade[serveurId] !== undefined) return;
    ui.monGrade[serveurId] = null;             // évite de redemander en boucle
    try {
      const r = await api("moi.grade", { serveur: serveurId });
      ui.monGrade[serveurId] = r.grade || null;
    } catch (_) {
      ui.monGrade[serveurId] = null;
    }
    if (ui.route === "server") render();
  }

  // 🔒 Droits de la personne connectée, calculés par le serveur.
  //   gestion     : peut entrer dans l'espace de gestion
  //   siteEntier  : équipe du site (blacklist, créateur, tous les serveurs)
  //   mesServeurs : identifiants des serveurs qu'elle administre elle-même
  const ACCES = window.AINCRAD_ACCES || { gestion: false, siteEntier: false, mesServeurs: [] };
  function peutGerer() {
    if (!AUTH.required) return true;
    return ACCES.gestion === true || AUTH.ok === true;
  }
  // Équipe du site : accès à tout (blacklist mutualisée, espace créateur…).
  function estEquipeSite() {
    if (!AUTH.required) return true;
    return ACCES.siteEntier === true || AUTH.ok === true;
  }
  // Pages accessibles à un visiteur non identifié : la vue d'ensemble seule.
  const PAGES_PUBLIQUES = ["dashboard"];
  // Pages ouvertes à quelqu'un qui gère seulement SES serveurs.
  const PAGES_GESTIONNAIRE = ["dashboard", "servers", "server", "tickets"];
  function pagesAutorisees() {
    if (estEquipeSite()) return null;                 // null = tout
    return peutGerer() ? PAGES_GESTIONNAIRE : PAGES_PUBLIQUES;
  }

  // Bloc profil du bandeau : le vrai compte Discord, la session par mot de
  // passe, ou une invitation à se connecter.
  function profileBlock() {
    const ouvert = ui.menuProfil ? " on" : "";
    if (!MOI) {
      // Connecté par le mot de passe de secours, sans compte Discord.
      if (AUTH.required && AUTH.ok) {
        return `<div class="profile${ouvert}" data-action="menu-profil" title="Session ouverte avec le mot de passe de secours">
          <div class="profile-avatar">🔑</div>
          <div><strong>Administration</strong><span style="color:var(--muted-2)">mot de passe de secours</span></div>
          <i class="status-dot"></i>
        </div>`;
      }
      // Visiteur : le menu reste accessible (aperçu, notifications…), mais
      // c'est « Se connecter » qui saute aux yeux.
      return `<button class="btn primary small" data-action="auth-open" title="Se connecter avec Discord">🎮 Se connecter</button>
        <button class="icon-btn${ouvert}" data-action="menu-profil" title="Menu" aria-haspopup="menu">⋯</button>`;
    }
    const g = MOI.grade ? gradeById(MOI.grade) : null;
    const sousTitre = MOI.owner ? "👑 Propriétaire du site" : (g ? g.label : "Visiteur connecté");
    return `
      <div class="profile${ouvert}" data-action="menu-profil" title="Mon compte et réglages" aria-haspopup="menu">
        <div class="profile-avatar">${avatarImg(MOI)}</div>
        <div><strong>${esc(MOI.nom)}</strong><span${g ? ` style="color:${g.color}"` : ""}>${esc(sousTitre)}</span></div>
        <i class="pm-chevron">▾</i>
      </div>`;
  }
  // Photo de profil Discord, avec repli sur les initiales si elle ne charge pas.
  function avatarImg(u) {
    const initiales = String(u.nom || "?").trim().slice(0, 2).toUpperCase();
    return u.avatar
      ? `<img src="${esc(u.avatar)}" alt="" onerror="this.replaceWith(document.createTextNode('${esc(initiales)}'))">`
      : esc(initiales);
  }

  // ── 📂 Menu déroulant du profil ─────────────────────────────────────
  // Tout ce qui encombrait le bandeau (horloge, aperçu, synchronisation,
  // notifications) vit ici : sur téléphone, le bandeau ne garde que le nom
  // du site et l'avatar.
  function profileMenu() {
    if (!ui.menuProfil) return "";
    const item = (action, icone, texte, note = "", classe = "") =>
      `<button class="pm-item ${classe}" data-action="${action}">
         <span class="pm-ico">${icone}</span>
         <span><b>${texte}</b>${note ? `<i>${note}</i>` : ""}</span>
       </button>`;
    const entete = MOI
      ? `<div class="pm-head">
           <div class="profile-avatar">${avatarImg(MOI)}</div>
           <div><strong>${esc(MOI.nom)}</strong><span>${MOI.pseudo ? "@" + esc(MOI.pseudo) : (MOI.owner ? "Propriétaire" : "Connecté")}</span></div>
         </div>`
      : (connecte()
        ? `<div class="pm-head"><div class="profile-avatar">🔑</div>
             <div><strong>Administration</strong><span>mot de passe de secours</span></div></div>`
        : `<div class="pm-head"><div class="profile-avatar">👤</div>
             <div><strong>Visiteur</strong><span>non connecté</span></div></div>`);
    const compte = connecte()
      ? `${item("account-open", "👤", "Mon compte", MOI ? "identifiant, grade, serveurs" : "session en cours")}
         ${MOI ? item("account-switch", "🔁", "Changer de compte", "choisir un autre compte Discord") : ""}
         ${item("deconnexion", "⏻", "Se déconnecter", "", "danger")}`
      : `${item("auth-open", "🎮", "Se connecter", "avec votre compte Discord")}`;
    return `
      <div class="pm-layer" data-action="menu-profil-fermer"></div>
      <div class="profile-menu" role="menu">
        ${entete}
        <div class="pm-clock" id="live-clock">--:--:--</div>
        <div class="pm-sep"></div>
        ${item("preview-gate", "👁", "Voir la page d'accueil", "telle que la voient vos visiteurs")}
        ${item("pulse-system", "⌁", "Synchroniser", "rafraîchir les données")}
        ${item("show-notifications", "♢", "Notifications", "")}
        <div class="pm-sep"></div>
        ${compte}
      </div>`;
  }

  // 👤 Fiche du compte Discord connecté : ce que le site sait de vous, et les
  // réglages qui en découlent.
  function openAccountModal() {
    // Session ouverte par mot de passe, sans compte Discord : on explique et
    // on propose de basculer sur un vrai compte.
    if (!MOI && AUTH.required && AUTH.ok) {
      openModal("🔑 Session d'administration", `
        <div class="acc-head">
          <div class="acc-avatar">🔑</div>
          <div><strong>Administration</strong><span>connexion par mot de passe de secours</span></div>
        </div>
        <div class="row" style="flex-direction:column;align-items:flex-start;gap:6px">
          <span style="color:var(--muted)">Vous avez tous les droits, mais le site ne sait pas <b>qui</b> vous êtes : aucun nom, aucune photo, aucun grade.</span>
          <span style="color:var(--muted)">Connectez-vous avec votre compte Discord pour être identifié, et pour que vos actions vous soient attribuées.</span>
        </div>
        <div class="form-actions" style="flex-wrap:wrap">
          ${DISCORD.pret ? `<a class="btn primary" href="oauth.php?p=login" style="text-decoration:none">🎮 Passer à mon compte Discord</a>` : ""}
          <button class="btn danger" type="button" data-action="deconnexion">Se déconnecter</button>
          <button class="btn success" type="button" data-action="close-modal">Fermer</button>
        </div>`);
      return;
    }
    if (!MOI) { openLoginModal(); return; }
    const g = MOI.grade ? gradeById(MOI.grade) : null;
    const ligne = (label, valeur, note = "") =>
      `<div class="acc-row"><span>${label}</span><div><b>${valeur}</b>${note ? `<i>${note}</i>` : ""}</div></div>`;
    const badgeGrade = g
      ? `<span class="acc-grade" style="--gc:${g.color}">${esc(g.label)}</span> <i style="color:var(--muted-2)">${esc(g.family)}</i>`
      : `<span style="color:var(--red)">Aucun grade</span> <i style="color:var(--muted-2)">pas d'accès à la gestion</i>`;
    const conseilOwner = MOI.owner
      ? `<div class="row" style="border-color:rgba(47,227,139,.45)">👑 <span style="color:var(--muted)">Vous êtes le propriétaire : accès total, et personne ne peut vous le retirer.</span></div>`
      : `<div class="row" style="border-color:rgba(243,200,106,.45);flex-direction:column;align-items:flex-start;gap:6px">
           <b>💡 Pour être propriétaire définitif</b>
           <span style="color:var(--muted)">Collez l'identifiant ci-dessus dans <code>SITE_OWNER_ID</code>, dans le fichier <code>config.php</code> du site. Vous serez alors le seul et unique propriétaire.</span></div>`;
    openModal("👤 Mon compte Discord", `
      <div class="acc-head">
        <div class="acc-avatar">${avatarImg(MOI)}</div>
        <div>
          <strong>${esc(MOI.nom)}</strong>
          ${MOI.pseudo ? `<span>@${esc(MOI.pseudo)}</span>` : ""}
        </div>
      </div>
      ${ligne("Identifiant Discord", `<code class="acc-id" id="acc-id">${esc(MOI.id)}</code>`, "sert à vous déclarer propriétaire ou membre de l'équipe")}
      ${ligne("Grade sur ce site", badgeGrade, MOI.admin ? "peut tout modifier" : "selon ce qui est coché dans 🔐 Fonctions & grades")}
      ${ligne("Serveurs Discord", `${MOI.serveurs}`, "ceux dont Discord nous a communiqué la liste")}
      <div style="margin-top:14px">${conseilOwner}</div>
      <div class="form-actions" style="flex-wrap:wrap">
        <button class="btn ghost" type="button" data-action="account-copy-id">📋 Copier mon identifiant</button>
        ${MOI.admin ? `<button class="btn ghost" type="button" data-action="account-equipe">🔑 Connexion &amp; équipe</button>` : ""}
        <button class="btn ghost" type="button" data-action="account-switch">🔁 Changer de compte</button>
        <button class="btn danger" type="button" data-action="deconnexion">⏻ Se déconnecter</button>
        <button class="btn success" type="button" data-action="close-modal">Fermer</button>
      </div>`);
  }

  function toast(title, message, type = "success") {
    const element = document.createElement("div");
    element.className = `toast ${type === "error" ? "error" : ""}`;
    element.innerHTML = `<strong>${esc(title)}</strong><span>${esc(message)}</span>`;
    toastRoot.appendChild(element);
    setTimeout(() => {
      element.style.opacity = "0";
      element.style.transform = "translateX(18px)";
      setTimeout(() => element.remove(), 250);
    }, 3300);
  }

  function openModal(title, body, wide = false) {
    // ⚡ Les classes sont posées AVANT d'écrire la pop-up : le décor animé du
    // fond est déjà figé quand le navigateur calcule le flou, au lieu de devoir
    // le recalculer sur une scène encore en mouvement.
    document.body.classList.add("overlay-open", "modal-open");
    modalRoot.innerHTML = `
      <div class="modal-layer" data-action="close-modal">
        <section class="modal ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}" data-modal-panel>
          <header class="modal-head">
            <h3>${esc(title)}</h3>
            <button class="modal-close" type="button" data-action="close-modal" aria-label="Fermer">×</button>
          </header>
          <div class="modal-body">${body}</div>
        </section>
      </div>`;
    const firstInput = modalRoot.querySelector("input, textarea, select");
    setTimeout(() => firstInput?.focus(), 40);
  }

  function closeModal() {
    modalRoot.innerHTML = "";
    document.body.classList.remove("modal-open");
    // Le décor ne repart que si aucun autre calque n'est ouvert.
    if (!ui.menuProfil) document.body.classList.remove("overlay-open");
  }

  function button(label, action, cls = "", extra = "") {
    return `<button type="button" class="btn ${cls}" data-action="${esc(action)}" ${extra}>${label}</button>`;
  }

  function toggleField(name, checked, title, description) {
    return `
      <div class="toggle-row">
        <div class="toggle-copy"><strong>${esc(title)}</strong><span>${esc(description)}</span></div>
        <input type="checkbox" name="${esc(name)}" ${checked ? "checked" : ""} hidden>
        <button type="button" class="toggle ${checked ? "on" : ""}" data-action="toggle-input" aria-label="Activer ou désactiver ${esc(title)}"></button>
      </div>`;
  }

  function inputField(name, label, value, type = "text", note = "", attrs = "") {
    return `
      <div class="field">
        <label for="field-${esc(name)}">${esc(label)}</label>
        <input class="input" id="field-${esc(name)}" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${attrs}>
        ${note ? `<span class="field-note">${esc(note)}</span>` : ""}
      </div>`;
  }

  function selectField(name, label, value, options, note = "") {
    return `
      <div class="field">
        <label for="field-${esc(name)}">${esc(label)}</label>
        <select class="select" id="field-${esc(name)}" name="${esc(name)}">
          ${options.map(option => {
            const item = typeof option === "string" ? { value: option, label: option } : option;
            return `<option value="${esc(item.value)}" ${String(item.value) === String(value) ? "selected" : ""}>${esc(item.label)}</option>`;
          }).join("")}
        </select>
        ${note ? `<span class="field-note">${esc(note)}</span>` : ""}
      </div>`;
  }

  function textAreaField(name, label, value, note = "") {
    return `
      <div class="field full">
        <label for="field-${esc(name)}">${esc(label)}</label>
        <textarea class="textarea" id="field-${esc(name)}" name="${esc(name)}">${esc(value)}</textarea>
        ${note ? `<span class="field-note">${esc(note)}</span>` : ""}
      </div>`;
  }

  // Page d'accueil publique : rendue depuis les BLOCS composés par le
  // créateur dans « Constructeur de page ».
  function renderGate() {
    const blocks = pageBlocks();
    app.innerHTML = `
      <div class="page-public">
        ${blocks.map((block, index) => renderBlock(block, index)).join("")}
      </div>
      ${ui.activeBotId ? `<button class="btn primary gate-back" data-action="navigate" data-route="dashboard">← Retour à l'administration</button>` : ""}`;
    startAnnouncements();
  }

  // Fait défiler les blocs « Annonces » présents sur la page.
  function startAnnouncements() {
    document.querySelectorAll(".annwin[data-ann]").forEach(box => {
      let items = [];
      try { items = JSON.parse(box.dataset.ann); } catch (_) { return; }
      if (!items.length) return;
      const titre = box.querySelector(".antitre");
      const texte = box.querySelector(".antexte");
      const dots = box.querySelector(".andots");
      let index = 0;
      dots.innerHTML = items.map((_, i) => `<i data-i="${i}"></i>`).join("");
      const show = next => {
        index = ((next % items.length) + items.length) % items.length;
        const body = box.querySelector(".anbody");
        body.style.opacity = 0;
        setTimeout(() => {
          titre.textContent = items[index].titre || "";
          texte.textContent = items[index].texte || "";
          dots.querySelectorAll("i").forEach((dot, i) => dot.className = i === index ? "on" : "");
          body.style.opacity = 1;
        }, 200);
      };
      let timer = setInterval(() => show(index + 1), 6000);
      const rearm = () => { clearInterval(timer); timer = setInterval(() => show(index + 1), 6000); };
      box.querySelector('[data-action="ann-prev"]').onclick = () => { show(index - 1); rearm(); };
      box.querySelector('[data-action="ann-next"]').onclick = () => { show(index + 1); rearm(); };
      dots.querySelectorAll("i").forEach(dot => { dot.onclick = () => { show(Number(dot.dataset.i)); rearm(); }; });
      show(0);
    });
  }

  function sidebarNavButton(route, label, icon, badge = "") {
    return `<button class="nav-btn ${ui.route === route ? "active" : ""}" data-action="navigate" data-route="${route}">
      <span class="nav-icon">${icon}</span><span class="nav-text">${label}</span>${badge ? `<span class="nav-badge">${badge}</span>` : ""}
    </button>`;
  }

  function brandMark() {
    const logo = String(siteConfig().logo || "⚔️");
    if (/^https?:\/\//.test(logo) || logo.startsWith("uploads/") || logo.startsWith("assets/")) {
      return `<img src="${esc(logo)}" alt="">`;
    }
    return `<span>${esc(logo)}</span>`;
  }

  function renderShell() {
    const bot = activeBot();
    const openTickets = (state.tickets || []).filter(t => t.status !== "fermé").length;
    const badges = { blacklist: state.blacklist?.length || 0, tickets: openTickets };
    // La navigation est composée dans le Site builder (ordre, libellés,
    // visibilité) PUIS filtrée par le grade prévisualisé.
    // En aperçu, le menu est filtré EXACTEMENT comme le verrait ce grade
    // (la sortie de l'aperçu reste possible via le bandeau en haut).
    const navItems = navConfig()
      .filter(item => item.show !== false || (item.id === "site-config" && !ui.previewGrade))
      .filter(item => !ui.previewGrade || gradeCan("page." + (item.id === "site-config" ? "creator" : item.id)))
      // 🔒 Le menu ne propose que les pages réellement accessibles.
      .filter(item => { const p = pagesAutorisees(); return !p || p.includes(item.id); });
    app.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand">
            <button class="icon-btn mobile-menu" data-action="toggle-sidebar" aria-label="Ouvrir le menu">☰</button>
            <!-- Logo + nom : retour à la page d'accueil du site, SANS se déconnecter. -->
            <div class="brand-home" data-action="go-home" title="Retour à l'accueil du site">
              <div class="brand-mark">${brandMark()}</div>
              <div><h1>${esc(siteConfig().siteName || "AINCRAD CONTROL PANEL")}</h1><p>${esc(siteConfig().subtitle || "Sword Art Online Discord Management")}</p></div>
            </div>
          </div>
          <div class="top-actions">
            ${profileBlock()}
          </div>
        </header>
        <!-- Le menu du profil vit HORS du bandeau : celui-ci a un
             backdrop-filter, qui en fait le bloc conteneur de ses enfants en
             position fixe — le voile de fermeture n'aurait couvert que le
             bandeau, pas la page. -->
        ${profileMenu()}

        <aside class="sidebar ${ui.mobileOpen ? "open" : ""}">
          <div class="sidebar-scroll">
            <nav class="nav-section"><div class="nav-label">Menu</div>
              ${navItems.map(item => sidebarNavButton(item.id, item.label, icons[item.id === "site-config" ? "config" : item.id] || "◆", badges[item.id] || "")).join("")}
            </nav>
          </div>
          <div class="active-bot-card">
            <small>BOT ACTUEL</small>
            <div class="active-bot-row">
              ${botAvatar(bot)}
              <div><strong>${esc(bot.name || "Bot")}</strong><span>${esc(bot.tag || "EN LIGNE")}</span></div>
              <i class="status-dot"></i>
            </div>
            <button class="switch-bot" data-action="switch-bot">CHANGER DE BOT</button>
          </div>
        </aside>
        <section class="content">${discordBanner()}${previewBanner()}${renderRoute()}</section>
      </div>`;
    startClock();
  }

  // Bandeau rappelant que l'on regarde le site à travers un grade.
  // Bandeau du haut : erreur de connexion Discord, ou prise de possession du
  // site par le tout premier compte connecté. Affiché une seule fois.
  function discordBanner() {
    // 🚨 Site ouvert à tous : le plus important, donc affiché en premier et
    // impossible à refermer tant que ce n'est pas réglé.
    if (!AUTH.required) {
      return `<div class="previewbar alerte" style="--gc:#ff5c74;align-items:flex-start">
        <span>🚨 <b>Ce site est modifiable par N'IMPORTE QUI.</b>
        Aucun propriétaire n'est déclaré : toute personne connaissant l'adresse peut changer la page,
        les bots, les permissions et lire les tickets — <b>sans se connecter</b>.
        <br>Ouvrez <code>config.php</code> et collez votre identifiant Discord dans <code>SITE_OWNER_ID</code>${
          MOI ? ` — le vôtre : <code style="user-select:all">${esc(MOI.id)}</code>` : ""}.
        ${DISCORD.pret ? "Ou connectez-vous avec Discord dès maintenant : le premier compte connecté devient propriétaire." : ""}</span>
      </div>`;
    }
    if (DISCORD.erreur && !ui.bandeauVu) {
      return `<div class="previewbar" style="--gc:#ff5c74;align-items:flex-start">
        <span>❌ <b>Connexion Discord impossible</b> — ${esc(DISCORD.erreur)}
        ${DISCORD.detail ? `<br><i style="color:var(--muted-2);font-size:12px">${esc(DISCORD.detail)}</i>` : ""}</span>
        <button class="btn small" data-action="banner-close">Fermer</button>
      </div>`;
    }
    if (MOI && MOI.premier && !ui.bandeauVu) {
      return `<div class="previewbar" style="--gc:#2fe38b;align-items:flex-start">
        <span>👑 <b>Bienvenue, vous êtes maintenant propriétaire de ce site.</b>
        Votre compte Discord <b>${esc(MOI.nom)}</b> est le seul à pouvoir le modifier.
        Pour autoriser quelqu'un d'autre : ⚙️ Créateur → 🔑 Connexion Discord.</span>
        <button class="btn small" data-action="banner-close">J'ai compris</button>
      </div>`;
    }
    return "";
  }

  function previewBanner() {
    if (!ui.previewGrade) return "";
    const g = gradeById(ui.previewGrade);
    return `<div class="previewbar" style="--gc:${g.color}">
      <span>👁 Aperçu du grade <b>${esc(g.label)}</b> <i>(${esc(g.family)})</i> — les éléments non autorisés sont masqués.</span>
      <button class="btn small" data-action="preview-grade" data-grade="">Quitter l'aperçu</button>
    </div>`;
  }

  function renderRoute() {
    // Chacun reste dans son périmètre, même en forçant l'adresse d'une page.
    const permises = pagesAutorisees();
    if (permises && !permises.includes(ui.route)) ui.route = "dashboard";
    switch (ui.route) {
      case "dashboard": return dashboardView();
      case "servers": return serversView();
      case "server": return serverView();
      case "blacklist": return blacklistView();
      case "tickets": return ticketsView();
      case "creator": return creatorView();
      case "site-config": return siteConfigView();
      default: return dashboardView();
    }
  }

  function pageHead(kicker, title, description, actions = "") {
    return `<div class="page-head"><div class="page-title"><small>${esc(kicker)}</small><h2>${esc(title)}</h2><p>${esc(description)}</p></div><div class="page-actions">${actions}</div></div>`;
  }

  // 🩺 Pourquoi je n'ai pas accès ? On affiche les FAITS relevés par le
  // serveur, puis la seule action qui débloque réellement la situation —
  // au lieu de laisser deviner.
  function panneauAccesRefuse() {
    const d = window.AINCRAD_DIAG || {};
    if (!MOI) {
      return `<section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>🔒 Espace de gestion</h3>
          <p>Identifiez-vous pour accéder à vos serveurs.</p></div></div>
        <div class="row" style="flex-direction:column;align-items:flex-start;gap:8px">
          <span style="color:var(--muted)">Si vous administrez un serveur Discord où ce bot est présent,
            la gestion de ce serveur s'ouvrira <b>automatiquement</b> après connexion.</span>
          <div class="page-actions">${button("🎮 Se connecter avec Discord", "auth-open", "primary")}</div>
        </div>
      </div></section>`;
    }
    const fait = (ok, texte) => `<div class="diag-ligne"><span>${ok ? "✅" : "❌"}</span><span>${texte}</span></div>`;
    // La cause la plus probable, dans l'ordre où elle doit être traitée.
    let cause, remede;
    if (d.jamaisSynchronise) {
      cause = "Le site ne connaît aucun serveur réel : la synchronisation avec vos bots n'a jamais abouti.";
      remede = `Tant qu'elle n'a pas eu lieu, le site ne peut pas savoir sur quels serveurs le bot se trouve —
        il affiche encore des serveurs de démonstration. <b>Un membre de l'équipe doit ouvrir
        ⚙️ Créateur → 🤖 Mes bots et cliquer sur « 🔄 Synchroniser »</b> (l'agent doit être joignable et le bot démarré).`;
    } else if (d.mesGuildesAdmin === 0) {
      cause = "Vous n'administrez aucun serveur Discord.";
      remede = "Vous devez être <b>propriétaire ou administrateur</b> d'un serveur pour le configurer ici. Sinon, demandez à rejoindre l'équipe du site.";
    } else if (d.serveursGeres === 0) {
      cause = `Le bot n'est présent sur aucun des ${d.mesGuildesAdmin} serveur(s) que vous administrez.`;
      remede = `<b>Invitez le bot sur votre serveur</b>, puis demandez une synchronisation — la gestion de ce serveur s'ouvrira toute seule.`;
    } else {
      cause = "Votre compte ne fait pas partie de l'équipe du site.";
      remede = "Vos serveurs devraient pourtant apparaître. Rechargez la page ; si le problème persiste, transmettez votre identifiant au propriétaire.";
    }
    return `<section class="panel mt-16"><div class="panel-inner">
      <div class="panel-head"><div><h3>🔒 Pourquoi je ne peux rien gérer ?</h3>
        <p>Voici exactement ce que le site constate pour votre compte.</p></div></div>
      <div class="row" style="border-color:rgba(255,92,116,.45);flex-direction:column;align-items:flex-start;gap:6px">
        <b>${esc(cause)}</b><span style="color:var(--muted)">${remede}</span>
      </div>
      <div class="diag mt-16">
        ${fait(true, `Connecté en tant que <b>${esc(MOI.nom)}</b>`)}
        ${fait(d.mesGuildes > 0, `Vous êtes sur <b>${d.mesGuildes || 0}</b> serveur(s) Discord, dont <b>${d.mesGuildesAdmin || 0}</b> que vous administrez`)}
        ${fait(!d.jamaisSynchronise, d.jamaisSynchronise
          ? `Le site ne connaît <b>aucun serveur réel</b> (jamais synchronisé — ${d.serveursDemo || 0} serveur(s) de démonstration affichés)`
          : `Le bot est présent sur <b>${d.serveursDuBot}</b> serveur(s) connus du site`)}
        ${fait(d.serveursGeres > 0, `Serveurs que vous pouvez configurer ici : <b>${d.serveursGeres || 0}</b>`)}
        ${fait(d.equipeSite, d.equipeSite ? "Vous faites partie de l'équipe du site" : "Vous ne faites pas partie de l'équipe du site")}
        ${fait(d.proprietaireEpingle, d.proprietaireEpingle
          ? "Un propriétaire est épinglé dans <code>config.php</code>"
          : "Aucun propriétaire épinglé dans <code>config.php</code> (<code>SITE_OWNER_ID</code> vide)")}
      </div>
      <div class="row mt-16" style="flex-direction:column;align-items:flex-start;gap:6px">
        <b>👑 Vous êtes le propriétaire du site ?</b>
        <span style="color:var(--muted)">Ouvrez <code>config.php</code> et collez votre identifiant dans <code>SITE_OWNER_ID</code> :
          vous aurez alors accès à tout, définitivement.</span>
        <code class="acc-id" id="acc-id" style="user-select:all">${esc(MOI.id)}</code>
        <div class="page-actions">${button("📋 Copier mon identifiant", "account-copy-id", "ghost")}</div>
      </div>
    </div></section>`;
  }

  function dashboardView() {
    const bot = activeBot();
    const servers = botServers();
    const totalMembers = servers.reduce((sum, server) => sum + server.members, 0);
    const totalOnline = servers.reduce((sum, server) => sum + server.online, 0);
    const openTickets = (state.tickets || []).filter(t => t.status !== "fermé").length;
    // 🔒 Visiteur non identifié : il ne voit que cette page, et ses chiffres
    // sont vides (le serveur ne lui envoie ni serveurs, ni tickets, ni
    // sanctions). On lui présente donc le bot et une invitation à se
    // connecter, plutôt que des panneaux vides et des boutons qui refusent.
    const gestion = peutGerer();
    // Il gère ses serveurs sans être de l'équipe du site : on le lui dit,
    // sinon l'absence de blacklist et d'espace créateur paraît anormale.
    const proprio = gestion && !estEquipeSite();
    return `<div class="content-view">
      ${pageHead("Cardinal / Centre de contrôle", `Bienvenue dans l'interface ${bot.name}`,
        gestion
          ? "Surveillez vos serveurs Discord et accédez rapidement aux systèmes de gestion."
          : "Voici le bot de la communauté. Identifiez-vous avec Discord pour accéder à la gestion.",
        gestion ? button("Synchroniser", "pulse-system", "primary") : "")}
      <div class="hero-grid">
        <article class="panel hero-panel"><div class="hero-content">
          <span class="hero-kicker">A I N C R A D · FLOOR 75</span>
          <h3>Cardinal System opérationnel</h3>
          <p>${esc(bot.description)} Tous les modules sont synchronisés avec l'infrastructure Discord.</p>
          <div class="hero-status"><span class="chip green"><i class="status-dot"></i> BOT EN LIGNE</span><span class="chip">PING ${esc(bot.latency)} MS</span><span class="chip gold">VERSION 2.0.0</span></div>
        </div></article>
        <div class="stat-stack">
          ${gestion ? `
          <div class="stat-card"><span>Serveurs connectés</span><strong>${servers.length}</strong><em>+1 ce mois</em></div>
          <div class="stat-card"><span>Membres cumulés</span><strong>${formatNumber(totalMembers)}</strong><em>${formatNumber(totalOnline)} en ligne</em></div>
          <div class="stat-card"><span>Tickets actifs</span><strong>${openTickets}</strong><em>support disponible</em></div>
          <div class="stat-card"><span>Entrées blacklist</span><strong>${state.blacklist?.length || 0}</strong><em>base globale</em></div>`
          : `
          <div class="stat-card"><span>Bots de la communauté</span><strong>${(state.bots || []).length}</strong><em>en service</em></div>
          <div class="stat-card"><span>État</span><strong>En ligne</strong><em>tous les modules actifs</em></div>`}
        </div>
      </div>

      ${proprio ? `<div class="row mt-16" style="border-color:rgba(47,227,139,.45);flex-direction:column;align-items:flex-start;gap:6px">
        <b>🏠 Vous gérez vos propres serveurs</b>
        <span style="color:var(--muted)">Vous administrez ${ACCES.mesServeurs.length} serveur(s) Discord où ce bot est présent : vous pouvez les configurer entièrement.
        La blacklist et l'espace créateur, eux, sont mutualisés entre tous les serveurs et restent réservés à l'équipe du site.</span>
      </div>` : ""}
      ${gestion ? `
      <section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>Mes serveurs</h3><p>Sélectionnez un serveur pour ouvrir ses huit modules.</p></div>${button("Voir tous", "navigate", "ghost", 'data-route="servers"')}</div>
        <div class="server-strip">${servers.map(serverCard).join("") || emptyBlock("Aucun serveur", "Ce bot n'est lié à aucun serveur.")}</div>
      </div></section>

      <section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>Accès rapides</h3><p>Les systèmes les plus utilisés par votre équipe.</p></div></div>
        <div class="quick-grid">
          ${quickAction("BL", "Blacklist", `${state.blacklist?.length || 0} utilisateurs enregistrés`, "blacklist")}
          ${quickAction("TK", "Tickets", `${openTickets} conversations actives`, "tickets")}
          ${quickAction("SV", "Serveurs", `${servers.length} configurations disponibles`, "servers")}
          ${quickAction("CF", "Configuration", "Personnaliser le Cardinal System", "site-config")}
        </div>
      </div></section>

      <div class="grid-2 mt-16">
        <section class="panel"><div class="panel-inner"><div class="panel-head"><div><h3>Activité récente</h3><p>Flux des actions importantes du bot.</p></div></div><div class="activity-list">${activityRows()}</div></div></section>
        <section class="panel"><div class="panel-inner"><div class="panel-head"><div><h3>Signal Cardinal</h3><p>État global des connexions Discord.</p></div><span class="chip green">STABLE</span></div><div class="radar"><div class="radar-grid"><i class="radar-dot" style="left:30%;top:42%"></i><i class="radar-dot" style="left:63%;top:25%"></i><i class="radar-dot" style="left:72%;top:68%"></i><i class="radar-dot" style="left:44%;top:73%"></i></div></div></div></section>
      </div>` : `
      ${panneauAccesRefuse()}` }
    </div>`;
  }

  // Bandeau « votre grade sur ce serveur », renseigné par le bot lui-même.
  function monGradeBandeau(server) {
    if (!MOI || !server?.id) return "";
    const g = ui.monGrade[server.id];
    if (g === undefined) return `<div class="row">⏳ <span style="color:var(--muted)">Lecture de votre grade sur ce serveur…</span></div>`;
    if (g === null) {
      return `<div class="row" style="border-color:rgba(243,200,106,.4)">🎭 <span style="color:var(--muted)">
        Impossible de lire votre grade ici : le bot doit être <b>démarré</b> et vous devez être membre de ce serveur.
        ${server.mien ? "" : "D'après Discord, vous n'êtes pas sur ce serveur."}</span></div>`;
    }
    const couleurs = { admin: "#f3c86a", staff: "#2fe38b", membre: "#948aa3" };
    const c = couleurs[g.grade] || "var(--accent)";
    const roles = (g.roles || []).slice(0, 6);
    return `<div class="row" style="border-color:${c}55;flex-wrap:wrap;gap:10px">
      <span>🎭 Votre grade ici : <b style="color:${c}">${esc(g.gradeNom)}</b></span>
      ${g.proprietaire ? `<span class="chip gold">PROPRIÉTAIRE DU SERVEUR</span>` : ""}
      ${g.police ? `<span class="chip">🚓 POLICE</span>` : ""}
      ${roles.length ? `<span style="color:var(--muted);font-size:12px">Rôles : ${roles.map(r =>
        `<b style="color:${esc(r.couleur && r.couleur !== "#000000" ? r.couleur : "var(--muted)")}">${esc(r.name)}</b>`).join(", ")}${(g.roles || []).length > roles.length ? "…" : ""}</span>` : ""}
    </div>`;
  }

  function serverCard(server) {
    return `<button class="server-card ${ui.selectedServerId === server.id ? "selected" : ""}${server.mien ? " mien" : ""}" data-action="open-server" data-server-id="${esc(server.id)}">
      <span class="server-card-top">${serverIcon(server)}${server.mien ? `<span class="chip green" style="font-size:9.5px">VOUS Y ÊTES</span>` : ""}<i class="status-dot"></i></span>
      <h4>${esc(server.name)}</h4><p>${esc(server.region)} · ${esc(server.role)}${server.verified ? " · Vérifié" : ""}</p>
      <span class="server-meta"><span>${formatNumber(server.members)} membres</span><span>${formatNumber(server.online)} en ligne</span></span>
      <span class="server-progress"><span style="width:${Math.max(5, Number(server.activity || 0))}%"></span></span>
    </button>`;
  }

  function quickAction(icon, title, subtitle, route) {
    return `<button class="quick-action" data-action="navigate" data-route="${route}"><span class="quick-icon">${icon}</span><span><strong>${esc(title)}</strong><span>${esc(subtitle)}</span></span></button>`;
  }

  function activityRows() {
    return (state.activity || []).slice(0, 7).map((item, index) => `
      <div class="activity-row"><span class="activity-icon">${String(index + 1).padStart(2,"0")}</span><span><strong>${esc(item.label)}</strong><span> · ${esc(item.detail)}</span></span><time>${esc(item.time)}</time></div>`).join("");
  }

  function serversView() {
    const bot = activeBot();
    const query = ui.serverQuery.trim().toLowerCase();
    const tous = botServers();
    // 🌐 « Mes serveurs » = ceux où le membre connecté est réellement présent,
    // repérés en croisant son compte Discord avec les serveurs du bot.
    const miens = tous.filter(s => s.mien);
    const aDesMiens = miens.length > 0;
    // Par défaut on montre les siens ; le créateur peut basculer sur tout.
    const filtreMien = ui.serveursTous ? false : aDesMiens;
    const base = filtreMien ? miens : tous;
    const servers = base.filter(server => !query || `${server.name} ${server.region}`.toLowerCase().includes(query));
    const sansBot = ui.mesServeursSansBot || [];
    const bascule = aDesMiens && tous.length > miens.length
      ? `<div class="segmented">
           <button class="seg ${filtreMien ? "on" : ""}" data-action="serveurs-filtre" data-tous="0">🌐 Mes serveurs (${miens.length})</button>
           <button class="seg ${filtreMien ? "" : "on"}" data-action="serveurs-filtre" data-tous="1">Tous (${tous.length})</button>
         </div>` : "";
    const infoMiens = MOI && !aDesMiens && tous.length
      ? `<div class="row" style="border-color:rgba(243,200,106,.45);flex-direction:column;align-items:flex-start;gap:6px">
           <b>ℹ️ Aucun de vos serveurs Discord n'a encore ce bot</b>
           <span style="color:var(--muted)">Vous êtes sur ${ui.nbMesServeurs || 0} serveur(s) Discord, mais ${esc(bot.name)} n'est présent sur aucun d'eux. Les serveurs ci-dessous sont ceux du bot.</span>
           <span style="color:var(--muted);font-size:12px">Si vous venez d'inviter le bot, cliquez sur « 🔄 Synchroniser » : la liste se met à jour depuis l'agent.</span>
         </div>` : "";
    return `<div class="content-view">
      ${pageHead("Gestion / Serveurs", `Serveurs de ${bot.name}`, "Ouvrez un serveur pour configurer ses modules et consulter ses statistiques.",
        button("🔄 Synchroniser", "bots-sync-rapide", "ghost") + button("Ajouter un serveur", "invite-bot", "primary"))}
      ${infoMiens}
      <section class="panel"><div class="panel-inner">
        <div class="panel-head"><div><h3>Infrastructure Discord</h3><p>${servers.length} serveur(s) correspondent à la sélection actuelle.</p></div><div class="searchbar"><input class="input" id="server-search" value="${esc(ui.serverQuery)}" placeholder="Rechercher un serveur…"><button class="btn" data-action="server-search">Rechercher</button></div></div>
        ${bascule}
        <div class="grid-3">${servers.map(serverCard).join("") || emptyBlock("Aucun résultat", "Essayez une autre recherche.")}</div>
      </div></section>
      ${sansBot.length ? `<section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>➕ Vos serveurs sans le bot</h3>
          <p>Vous administrez ${sansBot.length} serveur(s) Discord où ${esc(bot.name)} n'est pas encore présent.</p></div></div>
        <div class="grid-3">${sansBot.map(s => `
          <div class="server-card" style="cursor:default">
            <span class="server-card-top">${s.icon
              ? `<img class="server-icon" src="https://cdn.discordapp.com/icons/${esc(s.id)}/${esc(s.icon)}.png?size=64" alt="">`
              : `<span class="server-icon">${esc(String(s.name).slice(0, 2).toUpperCase())}</span>`}</span>
            <h4>${esc(s.name)}</h4><p>Vous y êtes ${esc(s.role)}</p>
            <div class="page-actions" style="margin-top:10px">${button("🔗 Inviter le bot", "invite-bot", "primary small")}</div>
          </div>`).join("")}</div>
      </div></section>` : ""}
      <div class="grid-3 mt-16">
        <div class="stat-card"><span>Membres gérés</span><strong>${formatNumber(servers.reduce((s,x)=>s+x.members,0))}</strong><em>portée du bot</em></div>
        <div class="stat-card"><span>Utilisateurs en ligne</span><strong>${formatNumber(servers.reduce((s,x)=>s+x.online,0))}</strong><em>temps réel</em></div>
        <div class="stat-card"><span>Serveurs vérifiés</span><strong>${servers.filter(x=>x.verified).length}</strong><em>permissions complètes</em></div>
      </div>
    </div>`;
  }

  function serverView() {
    const server = selectedServer();
    const current = modules.find(module => module.id === ui.module) || modules[0];
    // 🎭 On demande au bot le grade réel du membre sur CE serveur.
    if (MOI && server?.id) chargerMonGrade(server.id);
    return `<div class="content-view">
      ${pageHead("Serveurs / Configuration", server.name, `Module actif : ${current.label}. Les modifications sont enregistrées dans le fichier JSON du projet.`, button("Retour aux serveurs", "navigate", "ghost", 'data-route="servers"'))}
      ${monGradeBandeau(server)}
      <div class="server-layout">
        <aside class="server-sidebar">
          <section class="panel"><div class="server-id-card">
            ${serverIcon(server)}<h3>${esc(server.name)}</h3><p>${formatNumber(server.members)} membres · ${formatNumber(server.online)} en ligne</p>
            <div class="hero-status" style="justify-content:center"><span class="chip green">CONNECTÉ</span><span class="chip">${esc(server.region)}</span></div>
          </div></section>
          <nav class="module-nav">${modules.filter(m => gradeCan("mod." + m.id)).map((module, index) => `
            <button class="module-btn ${ui.module === module.id ? "active" : ""}" data-action="select-module" data-module="${module.id}"><span class="index">${String(index+1).padStart(2,"0")}</span><span class="label">${esc(module.label)}</span><i class="state"></i></button>`).join("")}</nav>
        </aside>
        <section>${moduleView(ui.module, server)}</section>
      </div>
    </div>`;
  }

  // ══════════════════════════════════════════════════════════════════
  // 🎛️ MODULES D'UN SERVEUR — réglages RÉELS, écrits dans le bot
  // ══════════════════════════════════════════════════════════════════
  // Les salons et les rôles proviennent du serveur Discord lui-même
  // (récupérés auprès du bot) : on choisit dans une liste, jamais en tapant
  // un nom. Chaque changement est envoyé au bot, pas seulement au site.

  // Réglages du serveur en cours : { config, roles, channels, categories }
  function srvParams() { return ui.srvParams[ui.selectedServerId] || null; }

  async function chargerParametresServeur(guildId) {
    if (!guildId || ui.srvParams[guildId] !== undefined) return;
    ui.srvParams[guildId] = null;                 // évite les appels en rafale
    try {
      const r = await api("serveur.parametres", { serveur: guildId });
      ui.srvParams[guildId] = { config: r.config || {}, roles: r.roles || [], channels: r.channels || [], categories: r.categories || [] };
    } catch (e) {
      ui.srvParams[guildId] = { erreur: e.message, config: {}, roles: [], channels: [], categories: [] };
    }
    if (ui.route === "server") render();
  }

  // Liste déroulante de SALONS du serveur.
  // Choix courant d'une clé : une valeur simple, ou une liste JSON quand le
  // champ accepte plusieurs entrées.
  function choixCourants(valeur, multiple) {
    if (!multiple) return [String(valeur ?? "")];
    try {
      const l = JSON.parse(valeur || "[]");
      return Array.isArray(l) ? l.map(String) : (valeur ? [String(valeur)] : []);
    } catch {
      return valeur ? [String(valeur)] : [];
    }
  }

  // ⚡ Configuration AFFICHÉE dans les champs et l'aperçu : ce qui est
  // enregistré dans le bot, recouvert par les changements non encore
  // enregistrés. L'aperçu suit ainsi le moindre réglage.
  // On ne touche PAS à p.config : c'est lui qui sert de référence pour savoir
  // ce qui a réellement changé au moment d'enregistrer.
  function cfgCourant() {
    return { ...(srvParams()?.config || {}), ...(ui.brouillonModule || {}) };
  }

  function champSalon(cle, label, aide = "", multiple = false) {
    const p = srvParams();
    const choisis = choixCourants(cfgCourant()[cle], multiple);
    const options = (p?.channels || []).map(c =>
      `<option value="${esc(c.id)}"${choisis.includes(String(c.id)) ? " selected" : ""}># ${esc(c.name)}</option>`).join("");
    return `<div class="field"><label>${label}</label>
      <select class="select" data-cfg="${esc(cle)}"${multiple ? ' multiple size="6" data-multi="1"' : ""}>
        ${multiple ? "" : '<option value="">— Aucun —</option>'}${options}
      </select>
      <span class="field-note">${multiple ? "Maintenez Ctrl (⌘ sur Mac) pour en choisir plusieurs. " : ""}${aide}</span></div>`;
  }

  // Liste déroulante de CATÉGORIES — simple, ou à choix multiple.
  function champCategorie(cle, label, aide = "", multiple = false) {
    const p = srvParams();
    const choisis = choixCourants(cfgCourant()[cle], multiple);
    const options = (p?.categories || []).map(c =>
      `<option value="${esc(c.id)}"${choisis.includes(String(c.id)) ? " selected" : ""}>${esc(c.name)}</option>`).join("");
    return `<div class="field"><label>${label}</label>
      <select class="select" data-cfg="${esc(cle)}"${multiple ? ' multiple size="5" data-multi="1"' : ""}>
        ${multiple ? "" : '<option value="">— Aucune —</option>'}${options}
      </select>
      <span class="field-note">${multiple ? "Maintenez Ctrl (⌘ sur Mac) pour en choisir plusieurs. " : ""}${aide}</span></div>`;
  }

  // Liste déroulante de RÔLES — simple, ou à choix multiple.
  function champRole(cle, label, aide = "", multiple = false) {
    const p = srvParams();
    let valeur = cfgCourant()[cle] ?? "";
    let choisis = [];
    if (multiple) {
      try { choisis = JSON.parse(valeur || "[]").map(String); } catch { choisis = valeur ? [String(valeur)] : []; }
    }
    const options = (p?.roles || []).map(r => {
      const pris = multiple ? choisis.includes(String(r.id)) : String(r.id) === String(valeur);
      return `<option value="${esc(r.id)}"${pris ? " selected" : ""}>@ ${esc(r.name)}</option>`;
    }).join("");
    return `<div class="field"><label>${label}</label>
      <select class="select" data-cfg="${esc(cle)}"${multiple ? ' multiple size="5" data-multi="1"' : ""}>
        ${multiple ? "" : '<option value="">— Aucun —</option>'}${options}
      </select>
      <span class="field-note">${multiple ? "Maintenez Ctrl (⌘ sur Mac) pour en choisir plusieurs. " : ""}${aide}</span></div>`;
  }

  // Interrupteur enregistré dans le bot.
  // `defaut` : valeur du bot quand le réglage n'a jamais été touché.
  // Sans lui, un réglage ACTIF par défaut s'affichait éteint — l'interrupteur
  // mentait sur l'état réel, et le premier clic l'éteignait vraiment.
  function champBascule(cle, label, aide = "", defaut = 0) {
    const p = srvParams();
    const actif = Number(cfgCourant()[cle] ?? defaut) === 1;
    return `<div class="row" style="justify-content:flex-start;gap:12px">
      <button type="button" class="toggle ${actif ? "on" : ""}" data-cfg-toggle="${esc(cle)}" data-defaut="${defaut}" aria-label="${esc(label)}"></button>
      <span><b>${label}</b>${aide ? `<i style="display:block;color:var(--muted);font-size:11.5px;font-style:normal">${aide}</i>` : ""}</span>
    </div>`;
  }

  // Champ texte enregistré dans le bot.
  function champTexte(cle, label, aide = "", zone = false, placeholder = "") {
    const p = srvParams();
    const valeur = String(cfgCourant()[cle] ?? "");
    return `<div class="field full"><label>${label}</label>
      ${zone
        ? `<textarea class="textarea" rows="3" data-cfg="${esc(cle)}" placeholder="${esc(placeholder)}">${esc(valeur)}</textarea>`
        : `<input class="input" data-cfg="${esc(cle)}" value="${esc(valeur)}" placeholder="${esc(placeholder)}">`}
      ${aide ? `<span class="field-note">${aide}</span>` : ""}</div>`;
  }


  // 🏷️ Aide au balisage : rappelée partout où l'on écrit du texte libre.
  // Un balisage qu'on ne connaît pas ne sert à rien, donc il s'affiche là où
  // on écrit, pas dans une documentation à part.
  const BALISES = [
    ["&&", "une barre de séparation"],
    ["&& Titre", "une barre puis un titre de section ◆"],
    ["&&&", "une barre avec plus d'air autour"],
    ["&> Texte", "une entrée de liste ➜"],
    ["\\n", "un retour à la ligne"],
  ];
  function aideBalises() {
    return `<div class="balises">
      <span class="balises-titre">🏷️ MISE EN FORME — tapez ceci en début de ligne</span>
      <div class="balises-liste">
        ${BALISES.map(([b, r]) => `<div><code>${esc(b)}</code><span>${esc(r)}</span></div>`).join("")}
      </div>
      <div class="balises-ex">
        <div><b>Vous écrivez</b><pre>Bienvenue !
&& Pour commencer
&> Lis le règlement
&> Choisis tes rôles</pre></div>
        <div><b>Le bot affiche</b><pre>Bienvenue !
────────────────
◆ <b>Pour commencer</b>
➜ Lis le règlement
➜ Choisis tes rôles</pre></div>
      </div>
      <span class="field-note">Une balise n'est lue qu'en début de ligne, et jamais dans un bloc de code — votre <code>if (a &amp;&amp; b)</code> reste intact.</span>
    </div>`;
  }

  // 🔔 Qui mentionner ? Les deux mentions spéciales de Discord et la liste des
  // rôles dans un même menu — c'est la même question, autant la poser une fois.
  // « Personne » est le premier choix ET le défaut : une annonce du bot ne
  // justifie pas de faire sonner tout le serveur sans qu'on l'ait demandé.
  function champMention(cle, label, aide = "") {
    const p = srvParams();
    const valeur = String(cfgCourant()[cle] ?? "");
    const speciales = [["", "— Personne (défaut) —"], ["everyone", "@everyone — tout le serveur"], ["here", "@here — les membres connectés"]];
    const roles = (p?.roles || []).map(r => [String(r.id), `@ ${r.name}`]);
    return `<div class="field"><label>${label}</label>
      <select class="select" data-cfg="${esc(cle)}">
        ${speciales.map(([v, l]) => `<option value="${esc(v)}"${valeur === v ? " selected" : ""}>${esc(l)}</option>`).join("")}
        ${roles.length ? `<optgroup label="Rôles du serveur">${roles.map(([v, l]) => `<option value="${esc(v)}"${valeur === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</optgroup>` : ""}
      </select>
      ${aide ? `<span class="field-note">${aide}</span>` : ""}</div>`;
  }

  // Liste déroulante enregistrée dans le bot. `choix` = [[valeur, libellé], …]
  function champChoix(cle, label, choix, aide = "", defaut = "") {
    const valeur = String(cfgCourant()[cle] ?? defaut);
    return `<div class="field"><label>${label}</label>
      <select class="select" data-cfg="${esc(cle)}">
        ${choix.map(([v, l]) => `<option value="${esc(v)}"${valeur === v ? " selected" : ""}>${esc(l)}</option>`).join("")}
      </select>
      ${aide ? `<span class="field-note">${aide}</span>` : ""}</div>`;
  }

  function champNombre(cle, label, aide = "", min = 1, max = 10, defaut = "") {
    const p = srvParams();
    const brut = cfgCourant()[cle];
    const valeur = brut === null || brut === undefined || brut === "" ? defaut : brut;
    return `<div class="field"><label>${label}</label>
      <input class="input" type="number" min="${min}" max="${max}" data-cfg="${esc(cle)}" value="${esc(String(valeur))}">
      ${aide ? `<span class="field-note">${aide}</span>` : ""}</div>`;
  }

  // Cadre d'un module : bandeau d'état + bouton d'enregistrement vers le bot.
  function modulePanel(title, description, formBody, moduleId) {
    const p = srvParams();
    if (p === null) return `<section class="panel"><div class="panel-inner"><div class="row">⏳ Lecture des salons et rôles du serveur…</div></div></section>`;
    if (p?.erreur) {
      return `<section class="panel"><div class="panel-inner">
        <div class="panel-head"><div><h3>${esc(title)}</h3><p>${esc(description)}</p></div></div>
        <div class="row" style="border-color:rgba(255,92,116,.45);flex-direction:column;align-items:flex-start;gap:6px">
          <b>❌ Impossible de lire la configuration de ce serveur</b>
          <span style="color:var(--muted)">${esc(p.erreur)}</span>
          <span style="color:var(--muted);font-size:12px">Le bot doit être <b>démarré</b> et à jour. Vérifiez ⚙️ Créateur → 🤖 Mes bots.</span>
        </div>
      </div></section>`;
    }
    return `<section class="panel"><div class="panel-inner">
      <div class="panel-head"><div><h3>${esc(title)}</h3><p>${esc(description)}</p></div><span class="chip green">RÉGLAGES DU BOT</span></div><div class="panel-line"></div>
      <form data-form="module-bot" data-module="${esc(moduleId)}">${formBody}
        <div class="form-actions">
          <button type="button" class="btn ghost" data-action="module-recharger">↺ Recharger</button>
          <button type="submit" class="btn success">💾 Enregistrer dans le bot</button>
        </div>
      </form>
    </div></section>`;
  }

  function moduleView(moduleId, server) {
    chargerParametresServeur(server.id);
    switch (moduleId) {
      case "overview": return overviewModule(server);
      case "rp": return rpModule();
      case "identite": return identiteModule();
      case "arrivals": return arrivalsModule();
      case "roles": return rolesModule();
      case "channels": return channelsModule();
      case "levels": return levelsModule();
      case "messages": return messagesModule(server);
      case "tickets": return ticketModule();
      default: return overviewModule(server);
    }
  }

  function overviewModule(server) {
    const p = srvParams();
    const cfg = p?.config || {};
    const compte = (liste) => (p?.[liste] || []).length;
    const body = `<div class="grid-3">
      <div class="stat-card"><span>Membres</span><strong>${formatNumber(server.members)}</strong><em>sur ce serveur</em></div>
      <div class="stat-card"><span>Salons textuels</span><strong>${compte("channels")}</strong><em>utilisables par le bot</em></div>
      <div class="stat-card"><span>Rôles</span><strong>${compte("roles")}</strong><em>attribuables</em></div>
    </div>
    <div class="mt-22">
      ${champBascule("rp_enabled", "Module RP", "Cartes d'identité, permis, entreprises, assurances. Change les commandes disponibles sur le serveur.")}
      ${champBascule("levels_enabled", "Niveaux", "XP écrit et vocal, classement et récompenses.")}
      ${champBascule("interact_enabled", "Interactions", "Câlins, bisous et autres interactions entre membres.")}
      ${champBascule("sao_enabled", "Aventure SAO", "Les 100 étages d'Aincrad, boss et badges.")}
    </div>`;
    return modulePanel("Vue d'ensemble", "Activez ou coupez les grands modules du bot sur ce serveur.", body, "overview");
  }

  function rpModule() {
    const body = `<div class="builder-hint">🎭 Le module RP apporte les cartes d'identité, permis, entreprises et assurances. Les rôles ci-dessous décident qui peut quoi.</div>
    <div class="form-grid">
      ${champRole("police_role_ids", "Rôles Police", "Peuvent retirer des points de permis et tenir le casier judiciaire.", true)}
      ${champRole("wlrp_role_id", "Rôle donné par la Whitelist RP", "Attribué automatiquement quand vous whitelistez quelqu'un.")}
    </div>
    <div class="mt-16">
      ${champBascule("rp_enabled", "Activer le module RP", "Synchronise les commandes RP sur ce serveur.")}
      ${champBascule("rp_locked", "Verrouiller les modifications RP", "Empêche les changements de cartes et de permis.")}
    </div>`;
    return modulePanel("Module RP", "Personnages, permis, entreprises et rôles métier.", body, "rp");
  }

  // 🎨 Identité visuelle appliquée à TOUS les embeds du bot.
  function identiteModule() {
    const cfg = cfgCourant();
    const accent = /^#[0-9a-f]{6}$/i.test(cfg.embed_accent || "") ? cfg.embed_accent : "#5865F2";
    const body = `<div class="builder-hint">🎨 Ces réglages s'appliquent à <b>tout ce que le bot envoie</b> : arrivées, logs, sanctions, tickets, niveaux, réponses de commandes… Un seul endroit, partout à la fois.</div>
      <div class="mt-16">
        ${champBascule("embed_style", "Activer l'identité visuelle", "Décochez pour laisser chaque message avec son apparence d'origine.", 1)}
      </div>
      <div class="form-grid mt-16">
        <div class="field"><label>Couleur d'accent</label>
          <input class="input" type="color" data-cfg="embed_accent" value="${esc(accent)}">
          <span class="field-note">Barre colorée à gauche de chaque embed.</span></div>
      </div>
      <div class="mt-16">
        ${champBascule("embed_force_color", "Même couleur pour tous les embeds",
          "⚠️ Désactivé, les couleurs qui portent un sens sont conservées : rouge pour une sanction, vert pour une réussite, orange pour un avertissement. Activé, tout devient votre couleur d'accent.")}
        ${champBascule("embed_author", "Ligne d'identité en haut", "Le nom et l'icône du serveur, au-dessus du titre. Une ligne d'auteur porteuse de sens (« Avis de @membre ») n'est jamais remplacée.", 1)}
        ${champBascule("embed_footer", "Signature en pied de page", "« NomDuBot • NomDuServeur », avec l'icône du serveur. Un pied de page déjà écrit par le bot n'est jamais remplacé.", 1)}
        ${champBascule("embed_cartes", "Cartes sans bordure (recommandé)", "⭐⭐ Le message n'est plus un embed mais une carte. C'est la SEULE façon de supprimer la barre verticale colorée que Discord colle au bord gauche de chaque embed — elle n'est pas réglable autrement. Les séparateurs deviennent de vrais traits tracés par Discord, à la largeur exacte de la carte. Ne s'applique qu'aux nouveaux messages : pour les anciens, voir /esthetique appliquer mode:recréer.", 1)}
        ${champBascule("embed_fusion", "Sections au lieu de la grille de champs", "⭐ C'est ce réglage qui retire l'aspect « Discord de base » : les champs deviennent des sections ◆ / ➜ dans le texte.", 1)}
        ${champBascule("embed_ligne", "Filet sous le titre", "La fine ligne qui sépare le titre du texte — c'est elle qui donne l'allure « carte » au lieu d'un embed brut.", 1)}
        ${champBascule("embed_timestamp", "Horodatage", "L'heure d'envoi sous chaque embed.", 1)}
      </div>
      <div class="form-grid mt-16">
        ${champChoix("embed_bordure", "🎨 Barre colorée à gauche", [
          ["aucune", "Aucune — carte nette (défaut)"],
          ["accent", "La garder, à la couleur du message"],
        ], "N'a d'effet que si « Cartes sans bordure » est activé : un embed classique a toujours sa barre.", "aucune")}
        ${champChoix("embed_titre", "🔠 Taille du titre", [
          ["grand", "Grand — en-tête de panneau (défaut)"],
          ["moyen", "Moyen — plus discret"],
        ], "Le grand titre ouvre la carte comme un vrai panneau, au lieu d'un titre noyé dans le texte.", "grand")}
        ${champNombre("embed_filet_taille", "📏 Longueur du filet", "Sans effet en mode carte : Discord y trace de vrais séparateurs. Ne sert qu'aux embeds classiques — trop long, la ligne passe à la ligne sur téléphone.", 6, 30, 16)}
        ${champTexte("embed_banniere", "🖼️ Bannière de bas de carte (URL)", "Image large affichée en bas de chaque embed, comme une signature visuelle. Laissez vide pour aucune. Un embed qui a déjà son image la garde.", false, "https://…/support.png")}
      </div>
      ${apercuIdentite(cfg)}`;
    return modulePanel("Identité des embeds", "L'apparence commune à tous les messages du bot.", body, "identite");
  }

  // Aperçu : trois embeds de nature différente, pour montrer l'effet de
  // « même couleur pour tous » sur des messages qui ont un sens de couleur.
  function apercuIdentite(cfg) {
    // Même moteur que l'aperçu du constructeur de messages, donc même
    // promesse : ce qui est dessiné ici est ce que Discord affichera.
    const r = reglagesApercu();
    const ctx = contexteApercu(r);
    const exemples = [
      { titre: "📥 Arrivée d'un membre", texte: "Bienvenue à @NouveauMembre !",
        couleur: null, champs: [["👤 Nom RP", "Durand"], ["🌍 Nationalité", "Française"]] },
      { titre: "🚫 Sanction appliquée", texte: "@Tricheur a été banni du serveur.", couleur: 0xff5c74 },
      { titre: "✅ Ticket fermé", texte: "Le ticket n°0042 a été archivé.", couleur: 0x2fe38b },
    ];
    return `<div class="apercu mt-16">
      <span class="apercu-titre">PRÉVISUALISATION — TROIS MESSAGES DE NATURES DIFFÉRENTES</span>
      ${exemples.map(x => {
        const json = { color: x.couleur ?? 0x5865f2, title: x.titre, description: x.texte };
        if (x.champs) json.fields = x.champs.map(([n, v]) => ({ name: n, value: v }));
        if (r.actif) window.Identite.styliserUn(json, ctx);
        const carte = r.actif && r.cartes
          ? window.Cartes.enCarte(json, { bordure: r.bordure, titre: r.titre }) : null;
        return `<div class="dc-msg">
          <div class="dc-pp"></div>
          <div class="dc-corps">
            <div class="dc-nom">${esc(ctx.bot)} <span class="dc-tag">APP</span></div>
            ${carte ? carteFigee(carte) : apercuEmbedClassique(json, 0)}
          </div>
        </div>`;
      }).join("")}
      <span class="field-note">${r.actif && r.cartes
        ? "🃏 Mode carte : aucune barre colorée, et les séparateurs sont tracés par Discord."
        : "⚠️ Mode embed classique : Discord impose sa barre verticale colorée à gauche."}</span>
    </div>`;
  }

  // Une carte non modifiable — pour les aperçus de réglages, où il n'y a rien
  // à écrire.
  function carteFigee(carte) {
    const style = carte.accent_color !== undefined
      ? ` style="--cv-accent:#${carte.accent_color.toString(16).padStart(6, "0")}"` : "";
    return `<div class="cv-carte${carte.accent_color !== undefined ? " cv-bordure" : ""}"${style}>
      ${dessinerComposants(carte.components, false)}</div>`;
  }

  // 👋 Arrivées & départs : salon, message, et APPARENCE de l'embed.
  function arrivalsModule() {
    const p = srvParams();
    const cfg = cfgCourant();
    const cadres = [
      { value: "rond", label: "Vignette ronde (en haut à droite)" },
      { value: "grand", label: "Grande image (pleine largeur)" },
      { value: "aucun", label: "Ne pas afficher la photo" },
    ];
    const choixCadre = (cle) => `<div class="field"><label>Cadre de la photo de profil</label>
      <select class="select" data-cfg="${cle}">
        ${cadres.map(c => `<option value="${c.value}"${String(cfg[cle] || "rond") === c.value ? " selected" : ""}>${c.label}</option>`).join("")}
      </select></div>`;
    const couleur = (cle, label) => `<div class="field"><label>${label}</label>
      <input class="input" type="color" data-cfg="${cle}" value="${esc(/^#[0-9a-f]{6}$/i.test(cfg[cle] || "") ? cfg[cle] : (cle === "welcome_color" ? "#2ecc71" : "#e74c3c"))}">
      <span class="field-note">Barre colorée à gauche de l'embed.</span></div>`;

    const styles = [
      { value: "classique", label: "Classique — message court + informations en champs" },
      { value: "detaille", label: "Détaillé — panneau d'accueil complet (règlement, staff, n° de membre)" },
    ];
    const choixStyle = `<div class="field"><label>🎨 Style de l'accueil</label>
      <select class="select" data-cfg="welcome_style">
        ${styles.map(s => `<option value="${s.value}"${String(cfg.welcome_style || "classique") === s.value ? " selected" : ""}>${s.label}</option>`).join("")}
      </select>
      <span class="field-note">Le style détaillé compose le texte tout seul à partir des salons choisis ci-dessous. Un message écrit à la main a toujours la priorité.</span></div>`;

    const body = `<div class="builder-hint">👋 Variables utilisables dans les messages : <code>{user}</code> (mention), <code>{user.username}</code>, <code>{server}</code>, <code>{membercount}</code>, <code>{regles}</code> et <code>{support}</code> (liens vers les salons choisis).</div>
      <h4 class="sous-titre">📥 Arrivées</h4>
      <div class="form-grid">
        ${champSalon("member_channel_id", "Salon des arrivées", "Laissez « Aucun » pour désactiver les messages d'arrivée.")}
        ${choixStyle}
        ${couleur("welcome_color", "Couleur de l'embed")}
        ${champTexte("welcome_title", "Titre de l'embed", "Vide = « 📥 Arrivée d'un membre ».", false, "Bienvenue sur {server} !")}
        ${choixCadre("welcome_avatar")}
        ${champSalon("welcome_rules_channel_id", "📌 Salon du règlement", "Cité dans l'accueil détaillé, et disponible via {regles}.")}
        ${champSalon("welcome_help_channel_id", "💡 Salon d'aide / tickets", "Cité dans l'accueil détaillé, et disponible via {support}.")}
        ${champTexte("welcome_image", "Image de fond (URL)", "Grande image affichée dans l'embed — sert aussi de fond à la bannière.", false, "https://…/banniere.png")}
        ${champTexte("welcome_message", "Message de bienvenue", "Laissez vide pour laisser le style choisi composer le texte.", true, "Bienvenue sur {server}, {user} ! 🎉")}
        ${aideBalises()}
      </div>
      <div class="mt-16">
        ${champBascule("welcome_fields", "Afficher les informations du membre", "Nom Discord, identifiant, numéro de membre et date de création du compte. Ignoré en style détaillé : l'information est déjà dans le texte.")}
        ${champBascule("welcome_mention", "Mentionner le membre", "Le ping s'ajoute au-dessus de l'embed.")}
      </div>

      <div class="builder-hint mt-16">🖼️ <b>Bannière fabriquée par le bot</b> — Discord ne permet pas de changer la police d'un embed : les bannières stylées sont des <b>images</b> générées. Le bot dessine la photo de profil, le pseudo et le numéro de membre sur un fond de votre choix.</div>
      <div class="mt-16">
        ${champBascule("welcome_banner", "Générer une bannière d'arrivée", "Elle remplace l'image de l'embed.")}
      </div>
      <div class="form-grid mt-16">
        ${couleur("welcome_banner_color", "Fond de la bannière")}
      </div>
      <div class="row mt-16" style="flex-direction:column;align-items:flex-start;gap:5px">
        <span style="color:var(--muted);font-size:12px">⚠️ La police de la bannière ne sait écrire que l'alphabet latin sans accent.
        Les pseudos accentués sont convertis (« Émilie » → « Emilie ») et les caractères impossibles à tracer sont retirés,
        plutôt que d'afficher des carrés « □□□□ » comme le font d'autres bots.</span>
      </div>
      ${apercuArrivee(cfg, "welcome")}

      <h4 class="sous-titre mt-22">📤 Départs</h4>
      <div class="form-grid">
        ${champSalon("goodbye_channel_id", "Salon des départs", "Peut être différent du salon d'arrivée.")}
        ${couleur("goodbye_color", "Couleur de l'embed")}
        ${champTexte("goodbye_title", "Titre de l'embed", "", false, "À bientôt…")}
        ${choixCadre("goodbye_avatar")}
        ${champTexte("goodbye_image", "Image de fond (URL)", "", false, "https://…/aurevoir.png")}
        ${champTexte("goodbye_message", "Message de départ", "", true, "{user.username} nous a quittés.")}
        ${aideBalises()}
      </div>
      <div class="mt-16">${champBascule("goodbye_fields", "Afficher les informations du membre", "")}</div>`;
    return modulePanel("Arrivées & départs", "Salon, message et apparence complète de l'embed.", body, "arrivals");
  }

  // Aperçu façon Discord de l'embed d'arrivée.
  // Rendu Discord minimal pour les aperçus : gras, italique, souligné, code.
  // Le texte est ÉCHAPPÉ avant, jamais après — sinon on rouvrirait la porte à
  // l'injection de HTML par un message de bienvenue.
  function mdApercu(texte) {
    return esc(texte)
      .replace(/\*\*\*(.+?)\*\*\*/g, "<b><i>$1</i></b>")
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/__(.+?)__/g, "<u>$1</u>")
      .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<i>$2</i>")
      .replace(/`([^`\n]+?)`/g, "<code>$1</code>")
      .replace(/^### (.+)$/gm, "<b>$1</b>")
      .replace(/^## (.+)$/gm, "<b>$1</b>");
  }

  function apercuArrivee(cfg, prefixe) {
    const couleur = /^#[0-9a-f]{6}$/i.test(cfg[`${prefixe}_color`] || "") ? cfg[`${prefixe}_color`] : "#2ecc71";
    const titre = cfg[`${prefixe}_title`] || "📥 Arrivée d'un membre";
    // Le style détaillé compose son texte : l'aperçu doit montrer le même.
    const nomSalon = (id) => {
      const c = (srvParams()?.channels || []).find(x => String(x.id) === String(id));
      return c ? `#${c.name}` : null;
    };
    const detaille = prefixe === "welcome" && String(cfg.welcome_style || "classique") === "detaille";
    const parDefaut = detaille ? (() => {
      const l = [
        "Bienvenue sur le serveur **{server}**", "",
        "Salut {user} ! Content de vous compter parmi nous.", "",
        "Ce serveur rassemble sa communauté autour de **{server}**, avec des échanges, des annonces et une bonne ambiance entre les membres.",
      ];
      const regles = nomSalon(cfg.welcome_rules_channel_id);
      const aide = nomSalon(cfg.welcome_help_channel_id);
      if (regles) l.push("", `📌 Avant de commencer, merci de prendre connaissance du ${regles} et d'adopter un comportement respectueux.`);
      if (aide) l.push("", `💡 Le staff reste disponible ici : ${aide} pour toute question.`);
      l.push("", "👤 **Membre** : {user.username}", "» **Membre n°{membercount}**");
      return l.join("\n");
    })() : "Bienvenue à {user} sur **{server}** ! 🎉";
    const message = (cfg[`${prefixe}_message`] || parDefaut)
      .replace(/\{user\.username\}/g, "NouveauMembre")
      .replace(/\{user\.mention\}|\{user\}/g, "@NouveauMembre")
      .replace(/\{server\}/g, "Votre serveur")
      .replace(/\{membercount\}|\{numero\}/g, "128")
      .replace(/\{regles\}/g, nomSalon(cfg.welcome_rules_channel_id) || "#règlement")
      .replace(/\{support\}/g, nomSalon(cfg.welcome_help_channel_id) || "#tickets");
    const cadre = cfg[`${prefixe}_avatar`] || "rond";
    const image = String(cfg[`${prefixe}_image`] || "").trim();
    const avatar = `<div class="dc-avatar-mini"></div>`;
    return `<div class="apercu mt-16">
      <span class="apercu-titre">PRÉVISUALISATION</span>
      <div class="dc-msg">
        <div class="dc-pp"></div>
        <div class="dc-corps">
          <div class="dc-nom">Votre bot <span class="dc-tag">APP</span></div>
          <div class="dc-embed" style="border-left-color:${esc(couleur)}">
            <div class="dc-embed-corps">
              ${detaille ? `<div class="dc-auteur">ℹ️ Bienvenue sur Votre serveur !</div>` : ""}
              <div class="dc-titre">${esc(titre)}</div>
              <div class="dc-desc">${mdApercu(message)}</div>
              ${Number(cfg[`${prefixe}_fields`] ?? 1) === 1 && !detaille ? `<div class="dc-champs">
                <div><b>💬 Nom Discord</b><span>NouveauMembre</span></div>
                <div><b>🔢 ID Discord</b><span>123456789012345678</span></div>
                <div><b>👥 Membre n°</b><span>128</span></div>
              </div>` : ""}
              ${prefixe === "welcome" && Number(cfg.welcome_banner ?? 0) === 1
                ? `<div class="dc-banniere" style="background:${esc(/^#[0-9a-f]{6}$/i.test(cfg.welcome_banner_color || "") ? cfg.welcome_banner_color : "#1b1b2f")}">
                     <div class="dc-ban-pp"></div>
                     <div class="dc-ban-txt"><b>Bienvenue !</b><strong>NouveauMembre</strong><i>Membre n°128</i></div>
                     <span class="dc-ban-srv">Votre serveur</span>
                   </div>`
                : (image ? `<img class="dc-image" src="${esc(image)}" alt="" onerror="this.style.display='none'">`
                : (cadre === "grand" ? `<div class="dc-image dc-image-vide">photo du membre en grand</div>` : ""))}
              ${detaille ? `<div class="dc-pied">Votre bot • Votre serveur</div>` : ""}
            </div>
            ${cadre === "rond" && !image ? `<div class="dc-miniature"></div>` : ""}
            ${image && cadre !== "aucun" ? `<div class="dc-miniature"></div>` : ""}
          </div>
        </div>
      </div>
    </div>`;
  }

  function rolesModule() {
    const body = `<div class="builder-hint">🎭 Les rôles ci-dessous viennent directement de votre serveur Discord. Le bot ne peut donner qu'un rôle situé <b>sous le sien</b> dans la hiérarchie.</div>
      <div class="form-grid">
        ${champRole("autorole_role_ids", "🤖 Rôles automatiques à l'arrivée", "Donnés à chaque nouveau membre — ou, si le captcha est actif, juste après sa validation.", true)}
        ${champRole("staff_role_ids", "🛡️ Rôles Staff", "Accès aux commandes de modération.", true)}
        ${champRole("admin_role_ids", "👑 Rôles Administration", "Accès complet à la configuration.", true)}
        ${champRole("service_role_id", "🧑‍💼 Rôle « en service »", "Ajouté pendant une prise de service.")}
      </div>
      <div class="mt-16">
        ${champBascule("antispam_enabled", "Anti-spam", "Sanctionne les envois répétés (plus de 5 messages en 7 secondes) et filtre les arnaques et invitations. Le staff n'est jamais concerné.")}
        ${champBascule("antinuke_enabled", "Anti-nuke", "Bloque les suppressions massives de salons et de rôles.")}
      </div>

      <div class="builder-hint mt-16">🔕 <b>Salons épargnés par l'anti-spam</b> — pour vos salons de flood, de commandes ou de comptage, où enchaîner les messages est normal. Une <b>catégorie</b> épargne tout ce qu'elle contient, fils compris.</div>
      <div class="form-grid mt-16">
        ${champSalon("antispam_exempt_channels", "🔕 Salons épargnés", "Aucune limite de fréquence dans ces salons.", true)}
        ${champCategorie("antispam_exempt_categories", "🗂️ Catégories épargnées", "Tous les salons de ces catégories sont épargnés.", true)}
      </div>
      <div class="mt-16">
        ${champBascule("antispam_exempt_filtre", "Y désactiver aussi le filtre arnaques et invitations",
          "⚠️ Par défaut les liens d'arnaque et les invitations Discord restent bloqués même dans les salons épargnés. À n'activer que pour un salon de partenariats, où poster une invitation est le but.")}
      </div>

      <div class="builder-hint mt-16">🤖 <b>Captcha de vérification</b> — le bouton n'obéit qu'au membre pour qui il a été publié : personne ne peut se vérifier à sa place.</div>
      <div class="mt-16">
        ${champBascule("captcha_enabled", "Captcha de vérification", "Le nouveau membre doit se vérifier avant d'accéder au serveur.")}
        ${champBascule("captcha_kick", "Expulser après trop d'erreurs", "Le membre pourra revenir et réessayer. Désactivé, il reste bloqué sans accès.")}
      </div>
      <div class="form-grid mt-16">
        ${champSalon("captcha_channel_id", "Salon du captcha", "Là où le message de vérification est publié.")}
        ${champNombre("captcha_max_essais", "🔢 Erreurs tolérées", "Au-delà, le membre est expulsé (si l'option ci-dessus est active).", 1, 10, 3)}
        ${champRole("verified_role_id", "✅ Rôle donné en cas de réussite", "Celui qui débloque l'accès au serveur.")}
        ${champRole("captcha_role_remove", "🧹 Rôle retiré en cas de réussite", "Le rôle d'attente, par exemple « Visiteur » ou « Non vérifié ». Laissez vide si vous n'en utilisez pas.")}
      </div>
      <div class="row mt-16" style="flex-direction:column;align-items:flex-start;gap:7px">
        <b>🕒 Et les membres déjà présents ?</b>
        <span style="color:var(--muted)">Les rôles automatiques ne s'appliquent qu'aux nouvelles arrivées.
          Ce bouton les donne à <b>tous les membres actuels</b> qui ne les ont pas encore — ceux qui les ont déjà sont ignorés.</span>
        <span style="color:var(--muted);font-size:12px">⚠️ Enregistrez d'abord vos rôles ci-dessus. Sur un grand serveur, comptez environ une seconde pour trois membres.</span>
        <div class="page-actions">${button("🎭 Donner le rôle à tous les membres", "autorole-rattraper", "primary")}</div>
      </div>
      <div id="autorole-rapport"></div>`;
    return modulePanel("Rôles & sécurité", "Rôles automatiques, staff, vérification et protections.", body, "roles");
  }

  function channelsModule() {
    const body = `<div class="builder-hint">📁 Chaque salon se choisit dans la liste — impossible de se tromper de nom ou d'identifiant.</div>
      <div class="form-grid">
        ${champSalon("log_channel_id", "📋 Salon des logs", "Modération, rôles, messages supprimés, vocaux.")}
        ${champSalon("member_channel_id", "👋 Salon des arrivées", "")}
        ${champSalon("goodbye_channel_id", "📤 Salon des départs", "")}
        ${champSalon("staff_channel_id", "🛡️ Salon du staff", "")}
        ${champSalon("service_channel_id", "🧑‍💼 Salon des prises de service", "")}
        ${champSalon("level_channel_id", "📈 Salon des niveaux", "Annonces de montée de niveau.")}
        ${champSalon("proof_channel_id", "📎 Salon des preuves", "")}
        ${champSalon("partner_channel_id", "🤝 Salon des partenariats", "")}
        ${champSalon("patch_channel_id", "📝 Salon des notes de mise à jour", "Le bot y publie ses nouveautés.")}
        ${champMention("patch_mention", "🔔 Mentionner à chaque note", "Aucune mention par défaut : une note de version ne fait sonner personne tant que vous ne l'avez pas demandé.")}
        ${champSalon("update_channel_id", "🔄 Salon des mises à jour techniques", "")}
        ${champSalon("ticket_transcript_channel_id", "🗄️ Salon des transcriptions de tickets", "")}
      </div>`;
    return modulePanel("Salons & logs", "Où le bot écrit chacune de ses annonces.", body, "channels");
  }

  function levelsModule() {
    const body = `<div class="form-grid">
        ${champSalon("level_channel_id", "Salon des annonces de niveau", "Vide = annonce dans le salon où le membre écrit.")}
        ${champTexte("level_image_url", "Image de fond de la carte de niveau", "URL d'une image large (1000×300 environ).", false, "https://…/fond-niveau.png")}
      </div>
      <div class="mt-16">${champBascule("levels_enabled", "Système de niveaux", "XP écrit et vocal.")}</div>
      <div class="builder-hint mt-16">💡 Les valeurs d'XP (par message, par minute de vocal, temps de recharge) se règlent avec la commande <code>/config</code> sur Discord — elles demandent des bornes que le site ne peut pas deviner.</div>`;
    return modulePanel("Niveaux", "Progression, annonces et carte personnalisée.", body, "levels");
  }

  function ticketModule() {
    const body = `<div class="builder-hint">🎫 Les types de tickets (catégories, rôles support, emojis) se créent avec <code>/ticket</code> sur Discord. Ici vous réglez les salons associés.</div>
      <div class="form-grid">
        ${champSalon("ticket_transcript_channel_id", "Salon des transcriptions", "Chaque ticket fermé y est archivé.")}
        ${champRole("staff_role_ids", "Rôles pouvant traiter les tickets", "", true)}
      </div>`;
    return modulePanel("Tickets", "Archives et rôles du support.", body, "tickets");
  }

  // ══════════════════════════════════════════════════════════════════
  // 📨 CONSTRUCTEUR DE MESSAGES — composer, prévisualiser, envoyer
  // ══════════════════════════════════════════════════════════════════

  // Relit le brouillon depuis les champs affichés (avant toute action).
  function lireBrouillon() {
    const m = brouillon();
    const v = sel => document.querySelector(sel)?.value ?? "";
    m.salon = v("#msg-salon");
    m.content = v("#msg-content");
    m.selecteurTexte = v("#msg-sel-texte");
    document.querySelectorAll(".embed-edit[data-embed]").forEach(bloc => {
      const i = Number(bloc.dataset.embed);
      const e = m.embeds[i];
      if (!e) return;
      bloc.querySelectorAll("[data-emb]").forEach(ch => { e[ch.dataset.emb] = ch.value; });
      e.champs = [...bloc.querySelectorAll("[data-champ]")].map(l => ({
        nom: l.querySelector("[data-champ-nom]")?.value || "",
        valeur: l.querySelector("[data-champ-valeur]")?.value || "",
        aligne: l.querySelector("[data-champ-aligne]")?.classList.contains("on") || false,
      }));
    });
    m.boutons = [...document.querySelectorAll("[data-bouton]")].map(l => ({
      label: l.querySelector("[data-btn-label]")?.value || "",
      style: l.querySelector("[data-btn-style]")?.value || "secondaire",
      lien: l.querySelector("[data-btn-lien]")?.value || "",
    }));
    m.selecteur = [...document.querySelectorAll("[data-option]")].map(l => ({
      label: l.querySelector("[data-opt-label]")?.value || "",
      description: l.querySelector("[data-opt-desc]")?.value || "",
    }));
    return m;
  }

  // 💾 Enregistre TOUS les réglages modifiés d'un module dans le bot.
  // Chaque clé part séparément : le bot valide chacune, et un refus isolé
  // n'annule pas les autres.
  async function enregistrerModule(form) {
    const p = srvParams();
    if (!p) return;
    const aEnvoyer = [];
    form.querySelectorAll("[data-cfg]").forEach(ch => {
      const cle = ch.dataset.cfg;
      let valeur;
      if (ch.multiple) valeur = [...ch.selectedOptions].map(o => o.value).filter(Boolean);
      else valeur = ch.value;
      // Inchangé ? on n'envoie rien.
      const actuel = p.config[cle];
      const pareil = Array.isArray(valeur)
        ? JSON.stringify(valeur) === JSON.stringify((() => { try { return JSON.parse(actuel || "[]"); } catch { return []; } })())
        : String(actuel ?? "") === String(valeur);
      if (!pareil) aEnvoyer.push({ cle, valeur });
    });
    form.querySelectorAll("[data-cfg-toggle]").forEach(b => {
      const cle = b.dataset.cfgToggle;
      const valeur = b.classList.contains("on") ? 1 : 0;
      // Comparaison à l'état RÉELLEMENT affiché : sans le défaut, un réglage
      // actif par défaut aurait paru « changé » à chaque enregistrement.
      const defaut = b.dataset.defaut === undefined ? 0 : Number(b.dataset.defaut);
      if (Number(p.config[cle] ?? defaut) !== valeur) aEnvoyer.push({ cle, valeur });
    });
    if (!aEnvoyer.length) { toast("RIEN À ENREGISTRER", "Aucun réglage n'a changé."); return; }
    const echecs = [];
    for (const { cle, valeur } of aEnvoyer) {
      try {
        await api("serveur.config", { serveur: ui.selectedServerId, cle, valeur });
        p.config[cle] = Array.isArray(valeur) ? JSON.stringify(valeur) : valeur;
      } catch (e) { echecs.push(`${cle} : ${e.message}`); }
    }
    ui.brouillonModule = {};   // enregistré : le brouillon n'a plus lieu d'être
    render();
    if (echecs.length) toast("ENREGISTREMENT PARTIEL", echecs[0], "error");
    else toast("ENREGISTRÉ DANS LE BOT", `${aEnvoyer.length} réglage(s) appliqué(s) sur Discord.`);
  }

  function brouillon() {
    if (!ui.msg) {
      ui.msg = { salon: "", content: "", embeds: [], boutons: [], selecteur: [], selecteurTexte: "" };
    }
    return ui.msg;
  }

  function messagesModule(server) {
    const p = srvParams();
    if (p === null) return `<section class="panel"><div class="panel-inner"><div class="row">⏳ Lecture des salons du serveur…</div></div></section>`;
    if (p?.erreur) return modulePanel("Messages", "", "", "messages");
    const m = brouillon();
    const salons = (p.channels || []).map(c =>
      `<option value="${esc(c.id)}"${c.id === m.salon ? " selected" : ""}># ${esc(c.name)}</option>`).join("");
    return `
      <div class="builder-hint">📨 Composez votre message — texte, embeds, boutons, menu déroulant — puis <b>Envoyer</b> : le bot le publiera dans le salon choisi.</div>
      <section class="panel"><div class="panel-inner">
        <div class="panel-head"><div><h3>📨 Messages & embeds</h3><p>Ce que vous voyez à droite est ce que Discord affichera.</p></div></div>
        <div class="field full"><label>Salon de destination</label>
          <select class="select" id="msg-salon">
            <option value="">Veuillez sélectionner un salon</option>${salons}
          </select>
        </div>
        <div class="msg-layout mt-16">
          <div class="msg-edit">
            <div class="field full"><label>Contenu du message (hors embed)</label>
              <textarea class="textarea" rows="3" id="msg-content" placeholder="Texte affiché au-dessus des embeds…">${esc(m.content)}</textarea>
              <span class="field-note">2000 caractères maximum. Laissez vide si vous n'envoyez qu'un embed.</span></div>
            ${m.embeds.map((e, i) => editeurEmbed(e, i)).join("")}
            ${editeurBoutons(m)}
            ${editeurSelecteur(m)}
            <div class="page-actions mt-16">
              ${button("➕ Ajouter un embed", "msg-embed-add", "ghost")}
              ${button("➕ Bouton", "msg-bouton-add", "ghost")}
              ${button("➕ Option de menu", "msg-option-add", "ghost")}
            </div>
          </div>
          <div class="msg-apercu">
            <span class="apercu-titre">APERÇU — ÉCRIVEZ DIRECTEMENT DEDANS</span>
            ${apercuMessage(m)}
            <div class="cv-pied">
              <span id="msg-jauge" class="cv-jauge">0 / ${window.Cartes ? window.Cartes.MAX_TEXTE_TOTAL : 4000} caractères</span>
              <span class="cv-balises-rappel">🏷️ <code>&&</code> une barre · <code>&& Titre</code> une section · <code>&></code> une entrée</span>
            </div>
            <div class="form-actions" style="margin-top:14px">
              ${button("🧪 Vérifier", "msg-tester", "ghost")}
              ${button("📨 Envoyer sur Discord", "msg-envoyer", "success")}
            </div>
            <div id="msg-rapport"></div>
          </div>
        </div>
      </div></section>`;
  }

  function editeurEmbed(e, i) {
    return `<div class="embed-edit" data-embed="${i}">
      <div class="embed-edit-head">
        <strong>Embed ${i + 1}</strong>
        <button type="button" class="btn danger small" data-action="msg-embed-suppr" data-index="${i}">🗑 Retirer</button>
      </div>
      <div class="form-grid">
        <div class="field"><label>Couleur</label><input class="input" type="color" data-emb="couleur" value="${esc(e.couleur || "#5865f2")}"></div>
        <div class="field"><label>Titre</label><input class="input" data-emb="titre" value="${esc(e.titre || "")}" placeholder="Titre de l'embed"></div>
        <div class="field full"><label>Description</label><textarea class="textarea" rows="3" data-emb="description" placeholder="Texte principal…">${esc(e.description || "")}</textarea></div>
        <div class="field"><label>Nom de l'auteur</label><input class="input" data-emb="auteur" value="${esc(e.auteur || "")}"></div>
        <div class="field"><label>Icône de l'auteur (URL)</label><input class="input" data-emb="auteur_icone" value="${esc(e.auteur_icone || "")}"></div>
        <div class="field"><label>Grande image (URL)</label><input class="input" data-emb="image" value="${esc(e.image || "")}" placeholder="https://…"></div>
        <div class="field"><label>Miniature (URL)</label><input class="input" data-emb="miniature" value="${esc(e.miniature || "")}" placeholder="https://…"></div>
        <div class="field full"><label>Pied de page</label><input class="input" data-emb="footer" value="${esc(e.footer || "")}"></div>
      </div>
      <div class="mt-16">
        <div class="panel-head" style="margin:0 0 8px"><div><h3 style="font-size:13px">Champs</h3></div>
          <button type="button" class="btn ghost small" data-action="msg-champ-add" data-index="${i}">➕ Ajouter un champ</button></div>
        ${(e.champs || []).map((c, j) => `<div class="row" data-champ="${j}" style="gap:8px">
          <input class="input" data-champ-nom value="${esc(c.nom || "")}" placeholder="Nom du champ" style="max-width:190px">
          <input class="input" data-champ-valeur value="${esc(c.valeur || "")}" placeholder="Valeur du champ">
          <button type="button" class="toggle ${c.aligne ? "on" : ""}" data-champ-aligne title="Afficher sur la même ligne"></button>
          <button type="button" class="btn danger small" data-action="msg-champ-suppr" data-index="${i}" data-champ-index="${j}">🗑</button>
        </div>`).join("")}
      </div>
    </div>`;
  }

  function editeurBoutons(m) {
    if (!m.boutons.length) return "";
    const styles = [["primaire","Bleu"],["secondaire","Gris"],["succes","Vert"],["danger","Rouge"]];
    return `<div class="embed-edit"><div class="embed-edit-head"><strong>Boutons</strong></div>
      ${m.boutons.map((b, i) => `<div class="row" data-bouton="${i}" style="gap:8px;flex-wrap:wrap">
        <input class="input" data-btn-label value="${esc(b.label || "")}" placeholder="Texte du bouton" style="max-width:170px">
        <select class="select" data-btn-style style="max-width:110px">
          ${styles.map(([v, l]) => `<option value="${v}"${b.style === v ? " selected" : ""}>${l}</option>`).join("")}
        </select>
        <input class="input" data-btn-lien value="${esc(b.lien || "")}" placeholder="Lien (facultatif)" style="max-width:210px">
        <button type="button" class="btn danger small" data-action="msg-bouton-suppr" data-index="${i}">🗑</button>
      </div>`).join("")}
      <span class="field-note" style="display:block;margin-top:8px">Un bouton avec un lien ouvre une page. Sans lien, il ne déclenche encore aucune action côté bot.</span>
    </div>`;
  }

  function editeurSelecteur(m) {
    if (!m.selecteur.length) return "";
    return `<div class="embed-edit"><div class="embed-edit-head"><strong>Menu déroulant</strong></div>
      <div class="field full"><label>Texte affiché quand rien n'est choisi</label>
        <input class="input" id="msg-sel-texte" value="${esc(m.selecteurTexte || "")}" placeholder="Faites un choix…"></div>
      ${m.selecteur.map((o, i) => `<div class="row" data-option="${i}" style="gap:8px">
        <input class="input" data-opt-label value="${esc(o.label || "")}" placeholder="Intitulé" style="max-width:190px">
        <input class="input" data-opt-desc value="${esc(o.description || "")}" placeholder="Description (facultatif)">
        <button type="button" class="btn danger small" data-action="msg-option-suppr" data-index="${i}">🗑</button>
      </div>`).join("")}
    </div>`;
  }

  // Rendu fidèle du message, façon Discord.
  // ══════════════════════════════════════════════════════════════════
  // 🃏 APERÇU FIDÈLE — et éditable directement dedans
  // ══════════════════════════════════════════════════════════════════
  //
  // L'aperçu ne « ressemble » pas au résultat : il est calculé par LES MÊMES
  // fonctions que celles du bot (moteur-balises, moteur-identite,
  // moteur-cartes, copiés tels quels depuis src/utils). On construit donc ici
  // exactement l'arbre de composants que Discord recevra, et on se contente
  // de le dessiner.
  //
  // On écrit AUSSI directement dans cet aperçu : titre, texte et contenu sont
  // des zones éditables placées à leur place définitive. Pendant qu'on tape,
  // la zone montre le texte brut (les balises restent visibles, comme dans la
  // zone de saisie de Discord) ; dès qu'on en sort, tout est rendu.

  // Réglages d'identité du serveur, lus depuis la configuration enregistrée.
  // Mêmes noms et mêmes défauts que reglages() côté bot.
  function reglagesApercu() {
    const cfg = cfgCourant();
    const I = window.Identite;
    return {
      actif: Number(cfg.embed_style ?? 1) === 1,
      accent: I.versEntier(cfg.embed_accent) ?? I.versEntier(I.DEFAUT_ACCENT),
      piedDePage: Number(cfg.embed_footer ?? 1) === 1,
      ligneAuteur: Number(cfg.embed_author ?? 1) === 1,
      horodatage: Number(cfg.embed_timestamp ?? 1) === 1,
      couleurUnique: Number(cfg.embed_force_color ?? 0) === 1,
      ligne: Number(cfg.embed_ligne ?? 1) === 1,
      filet: I.filetDe(cfg.embed_filet_taille ?? I.FILET_DEFAUT),
      fusion: Number(cfg.embed_fusion ?? 1) === 1,
      banniere: /^https?:\/\/\S+$/i.test(String(cfg.embed_banniere || "").trim()) ? String(cfg.embed_banniere).trim() : null,
      cartes: Number(cfg.embed_cartes ?? 1) === 1,
      bordure: String(cfg.embed_bordure || "aucune") === "accent" ? "accent" : "aucune",
      titre: String(cfg.embed_titre || "grand") === "moyen" ? "moyen" : "grand",
    };
  }

  // Le contexte que le bot passera à styliserUn : nom du bot, nom du serveur.
  function contexteApercu(r) {
    const srv = selectedServer();
    return {
      reglages: r,
      bot: activeBot()?.name || "Votre bot",
      serveur: srv?.name || "Votre serveur",
      // L'icône n'est pas dessinée dans l'aperçu, mais styliserUn s'en sert
      // pour décider d'écrire ou non icon_url : on lui donne la même valeur
      // qu'aura le bot, sinon la signature différerait.
      icone: srv?.icon ? `https://cdn.discordapp.com/icons/${srv.id}/${srv.icon}.png?size=64` : null,
    };
  }

  // Forme d'un embed vierge — la même que celle du bouton « Ajouter un embed ».
  function embedNeuf() {
    return { couleur: "#5865f2", titre: "", description: "", champs: [] };
  }

  // 🎴 Construit l'embed JSON tel que le bot le construira à l'envoi, puis le
  // fait passer par l'identité. C'est le point où l'aperçu et la réalité se
  // rejoignent : mêmes entrées, mêmes fonctions, même sortie.
  function embedJSON(e, r, ctx) {
    const B = window.Balises;
    const t = v => B.appliquer(String(v || "")).trim();
    const json = {};
    const couleur = String(e.couleur || "").match(/^#?([0-9a-f]{6})$/i);
    // Le bot pose 0x5865f2 quand aucune couleur n'est choisie ; l'identité
    // reconnaît ce bleu comme neutre et met l'accent du serveur à la place.
    json.color = couleur ? parseInt(couleur[1], 16) : 0x5865f2;
    if (t(e.titre)) json.title = t(e.titre).slice(0, 256);
    if (t(e.description)) json.description = t(e.description).slice(0, 4000);
    if (String(e.url || "").trim()) json.url = String(e.url).trim();
    if (String(e.image || "").trim()) json.image = { url: String(e.image).trim() };
    if (String(e.miniature || "").trim()) json.thumbnail = { url: String(e.miniature).trim() };
    if (t(e.footer)) json.footer = { text: t(e.footer).slice(0, 2048) };
    if (t(e.auteur)) json.author = { name: t(e.auteur).slice(0, 256) };
    if (e.horodatage) json.timestamp = new Date().toISOString();
    const champs = (e.champs || []).filter(c => String(c.nom || "").trim() && String(c.valeur || "").trim());
    if (champs.length) {
      json.fields = champs.slice(0, 25).map(c => ({
        name: t(c.nom).slice(0, 256), value: t(c.valeur).slice(0, 1024), inline: Boolean(c.aligne),
      }));
    }
    if (r.actif) window.Identite.styliserUn(json, ctx);
    return json;
  }

  // Un embed vide ne produit rien : inutile de dessiner une carte fantôme.
  const embedVide = e =>
    ![e.titre, e.description, e.image, e.miniature, e.footer, e.auteur].some(v => String(v || "").trim())
    && !(e.champs || []).filter(c => String(c.nom || "").trim() || String(c.valeur || "").trim()).length;

  // ── Rendu du markdown de Discord ──────────────────────────────────
  // Volontairement limité à ce que les cartes utilisent : titres #, ##, ###,
  // sous-texte -#, gras, italique, barré, code, liens, citations.
  function mdCarte(texte) {
    return String(texte || "").split("\n").map(ligne => {
      const sous = /^-#\s+(.*)$/.exec(ligne);
      if (sous) return `<div class="cv-sous">${mdEnLigne(sous[1])}</div>`;
      const h = /^(#{1,3})\s+(.*)$/.exec(ligne);
      if (h) return `<div class="cv-h${h[1].length}">${mdEnLigne(h[2])}</div>`;
      const cite = /^>\s?(.*)$/.exec(ligne);
      if (cite) return `<div class="cv-cite">${mdEnLigne(cite[1])}</div>`;
      if (!ligne.trim()) return `<div class="cv-vide"></div>`;
      return `<div class="cv-ligne">${mdEnLigne(ligne)}</div>`;
    }).join("");
  }

  function mdEnLigne(texte) {
    let t = esc(texte);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    t = t.replace(/\*([^*]+)\*/g, "<i>$1</i>");
    t = t.replace(/~~([^~]+)~~/g, "<s>$1</s>");
    t = t.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Un horodatage Discord s'affiche à l'heure de chaque lecteur ; ici on
    // montre l'heure locale du navigateur, ce que verra l'auteur.
    t = t.replace(/&lt;t:(\d+):[a-zA-Z]&gt;/g, (_, s) => new Date(Number(s) * 1000).toLocaleString("fr-FR"));
    return t;
  }

  // ── Dessin de l'arbre de composants ───────────────────────────────
  // Un composant = une brique de l'API Discord. On les dessine une à une,
  // sans jamais réinterpréter : ce qui n'est pas dans l'arbre n'apparaît pas.
  function dessinerComposants(liste, editable) {
    const C = window.Cartes.T;
    return (liste || []).map(c => {
      if (c.type === C.SEPARATEUR) return `<div class="cv-sep"></div>`;
      if (c.type === C.TEXTE) return mdCarte(c.content);
      if (c.type === C.SECTION) {
        return `<div class="cv-section">
          <div class="cv-section-txt">${dessinerComposants(c.components, editable)}</div>
          ${c.accessory?.media?.url ? `<img class="cv-vignette" src="${esc(c.accessory.media.url)}" alt="" onerror="this.remove()">` : ""}
        </div>`;
      }
      if (c.type === C.GALERIE) {
        return `<div class="cv-galerie">${(c.items || []).map(i =>
          `<img src="${esc(i.media?.url || "")}" alt="" onerror="this.remove()">`).join("")}</div>`;
      }
      return "";
    }).join("");
  }

  // 🖊️ Zone éditable posée à sa place définitive dans la carte.
  // `champ` = chemin de la donnée ; `rendu` = ce qu'on affiche au repos.
  function zone(champ, rendu, brut, classe, vide) {
    const attrs = `contenteditable="plaintext-only" spellcheck="false" data-zone="${esc(champ)}"`;
    if (!String(brut || "").trim()) {
      return `<div class="cv-zone cv-zone-vide ${classe}" ${attrs} data-vide="${esc(vide)}"></div>`;
    }
    return `<div class="cv-zone ${classe}" ${attrs} data-brut="${esc(brut)}">${rendu}</div>`;
  }

  function apercuMessage(m) {
    const r = reglagesApercu();
    const ctx = contexteApercu(r);
    const nomBot = esc(ctx.bot);
    const cartesActives = r.actif && r.cartes;

    const liste = m.embeds.length ? m.embeds : [embedNeuf()];
    const corps = liste.map((e, i) => {
      if (embedVide(e)) return apercuCarteVide(i);
      const json = embedJSON(e, r, ctx);
      if (!cartesActives) return apercuEmbedClassique(json, i);
      const carte = window.Cartes.enCarte(json, { bordure: r.bordure, titre: r.titre });
      if (!carte) return apercuCarteVide(i);
      return apercuCarte(carte, json, i, e);
    }).join("");

    const rienDuTout = !String(m.content || "").trim() && !m.embeds.some(e => !embedVide(e));

    return `<div class="dc-msg">
      <div class="dc-pp"></div>
      <div class="dc-corps">
        <div class="dc-nom">${nomBot} <span class="dc-tag">APP</span> <span class="dc-heure">aujourd'hui</span></div>
        ${zone("content", mdCarte(window.Balises.appliquer(m.content || "")), m.content, "cv-contenu", "Texte au-dessus de la carte (facultatif)")}
        ${corps}
        ${m.boutons.length ? `<div class="dc-boutons">${m.boutons.map(b =>
          `<span class="dc-bouton ${b.lien ? "lien" : esc(b.style || "secondaire")}">${esc(b.label || "Bouton")}${b.lien ? " ↗" : ""}</span>`).join("")}</div>` : ""}
        ${m.selecteur.length ? `<div class="dc-select">${esc(m.selecteurTexte || "Faites un choix…")} ▾</div>` : ""}
        ${rienDuTout ? `<div class="cv-astuce">✍️ Cliquez ci-dessus et écrivez : ce que vous voyez est exactement ce que Discord affichera.</div>` : ""}
      </div>
    </div>`;
  }

  // La carte elle-même. Les zones éditables remplacent le rendu du titre et
  // du corps : on écrit à l'endroit exact où le texte apparaîtra.
  function apercuCarte(carte, json, i, e) {
    const C = window.Cartes.T;
    const composants = carte.components || [];
    // Le premier bloc porte la tête (auteur + titre).
    const tete = composants[0];
    const aTete = tete && (tete.type === C.TEXTE || tete.type === C.SECTION) && /^(-#|#)/.test(
      tete.type === C.TEXTE ? tete.content : (tete.components?.[0]?.content || "")
    );
    // Après la tête vient un séparateur, puis le corps.
    let reste = composants.slice(aTete ? 1 : 0);
    if (reste[0]?.type === C.SEPARATEUR) reste = reste.slice(1);

    // ⚠️ Seul le CORPS est éditable. La galerie et la signature sont posées
    // par l'identité, pas écrites par l'auteur : les rendre modifiables ferait
    // croire qu'on peut les changer là, et elles disparaîtraient en cours de
    // frappe pour réapparaître à la sortie.
    // On sait exactement combien de composants vient de la description : ce
    // sont ceux que produit enBlocs, la fonction même qu'utilise enCarte.
    const nCorps = window.Cartes.enBlocs(json.description || "").length;
    const corps = reste.slice(0, nCorps);
    let chrome = reste.slice(nCorps);
    if (chrome[0]?.type === C.SEPARATEUR) chrome = chrome.slice(1);

    const style = carte.accent_color !== undefined
      ? ` style="--cv-accent:#${carte.accent_color.toString(16).padStart(6, "0")}"` : "";
    return `<div class="cv-carte${carte.accent_color !== undefined ? " cv-bordure" : ""}"${style} data-embed-apercu="${i}">
      ${aTete ? `<div class="cv-tete">${zone(`embeds.${i}.titre`, mdCarte(tete.type === C.TEXTE ? tete.content : tete.components[0].content), e.titre, "cv-titre-zone", "Titre de la carte")}</div>` : ""}
      ${aTete && (corps.length || chrome.length) ? `<div class="cv-sep"></div>` : ""}
      ${zone(`embeds.${i}.description`, dessinerComposants(corps, true), e.description, "cv-corps-zone", "Texte de la carte — tapez && pour une barre")}
      ${chrome.length ? `<div class="cv-sep"></div><div class="cv-chrome">${dessinerComposants(chrome, false)}</div>` : ""}
    </div>`;
  }

  function apercuCarteVide(i) {
    return `<div class="cv-carte cv-carte-vide" data-embed-apercu="${i}">
      ${zone(`embeds.${i}.titre`, "", "", "cv-titre-zone", "Titre de la carte")}
      ${zone(`embeds.${i}.description`, "", "", "cv-corps-zone", "Texte de la carte — tapez && pour une barre")}
    </div>`;
  }

  // Repli : identité coupée, ou cartes désactivées → l'embed d'origine, barre
  // colorée comprise. L'aperçu doit montrer ce cas tel qu'il est.
  function apercuEmbedClassique(json, i) {
    const couleur = typeof json.color === "number" ? `#${json.color.toString(16).padStart(6, "0")}` : "#5865f2";
    return `<div class="dc-embed" style="border-left-color:${esc(couleur)}" data-embed-apercu="${i}">
      <div class="dc-embed-corps">
        ${json.author?.name ? `<div class="dc-auteur">${esc(json.author.name)}</div>` : ""}
        ${json.title ? `<div class="dc-titre">${esc(json.title)}</div>` : ""}
        ${json.description ? `<div class="dc-desc">${mdApercu(json.description)}</div>` : ""}
        ${(json.fields || []).length ? `<div class="dc-champs">${json.fields.map(c =>
          `<div class="${c.inline ? "aligne" : ""}"><b>${esc(c.name)}</b><span>${esc(c.value)}</span></div>`).join("")}</div>` : ""}
        ${json.image?.url ? `<img class="dc-image" src="${esc(json.image.url)}" alt="" onerror="this.style.display='none'">` : ""}
        ${json.footer?.text ? `<div class="dc-footer">${esc(json.footer.text)}</div>` : ""}
      </div>
      ${json.thumbnail?.url ? `<img class="dc-miniature-img" src="${esc(json.thumbnail.url)}" alt="" onerror="this.remove()">` : ""}
    </div>`;
  }


  // ══════════════════════════════════════════════════════════════════
  // ✍️ ÉCRIRE DIRECTEMENT DANS L'APERÇU
  // ══════════════════════════════════════════════════════════════════
  //
  // Le principe est celui de la zone de saisie de Discord : pendant qu'on
  // écrit, on voit le texte BRUT (les « && » et les « ** » restent lisibles) ;
  // dès qu'on quitte la zone, tout est rendu.
  //
  // On ne redessine JAMAIS pendant la frappe : reconstruire le HTML d'un
  // élément éditable replace le curseur au début, et écrire devient
  // impossible. Le modèle est mis à jour à chaque frappe, l'affichage
  // seulement à la sortie.

  // Écrit une valeur dans le brouillon à partir du chemin de la zone.
  // « content » ou « embeds.0.titre ».
  function ecrireDansBrouillon(chemin, valeur) {
    const m = brouillon();
    const bouts = String(chemin).split(".");
    if (bouts[0] === "content") m.content = valeur;
    else if (bouts[0] === "embeds") {
      const i = Number(bouts[1]);
      while (m.embeds.length <= i) m.embeds.push(embedNeuf());
      m.embeds[i][bouts[2]] = valeur;
    }
    refleterDansFormulaire(chemin, valeur);
  }

  // ⚠️ Le panneau de gauche et l'aperçu écrivent dans le MÊME brouillon, mais
  // l'envoi relit d'abord les champs du formulaire (lireBrouillon). Sans cette
  // recopie, écrire dans l'aperçu puis envoyer publierait l'ancien texte —
  // exactement la promesse qu'on cherche à tenir. On tient donc les deux
  // affichages synchronisés dans les deux sens.
  function refleterDansFormulaire(chemin, valeur) {
    const bouts = String(chemin).split(".");
    let champ = null;
    if (bouts[0] === "content") champ = document.querySelector("#msg-content");
    else if (bouts[0] === "embeds") {
      champ = document.querySelector(`.embed-edit[data-embed="${bouts[1]}"] [data-emb="${bouts[2]}"]`);
    }
    if (champ && champ.value !== valeur) champ.value = valeur;
  }

  function lireDansBrouillon(chemin) {
    const m = brouillon();
    const bouts = String(chemin).split(".");
    if (bouts[0] === "content") return m.content || "";
    if (bouts[0] === "embeds") return m.embeds[Number(bouts[1])]?.[bouts[2]] || "";
    return "";
  }

  // Au clic dans une zone : on montre le texte brut, tel qu'il est enregistré.
  document.addEventListener("focusin", event => {
    const z = event.target.closest?.("[data-zone]");
    if (!z || z.dataset.edition === "1") return;
    z.dataset.edition = "1";
    z.textContent = lireDansBrouillon(z.dataset.zone);
    z.classList.remove("cv-zone-vide");
  });

  // Pendant la frappe : on tient le modèle à jour, sans redessiner.
  document.addEventListener("input", event => {
    const z = event.target.closest?.("[data-zone]");
    if (!z) return;
    ecrireDansBrouillon(z.dataset.zone, z.innerText.replace(/ /g, " "));
    majEtatMessage();
  });

  // À la sortie : on redessine tout, donc on voit le résultat définitif.
  document.addEventListener("focusout", event => {
    const z = event.target.closest?.("[data-zone]");
    if (!z) return;
    ecrireDansBrouillon(z.dataset.zone, z.innerText.replace(/ /g, " "));
    redessinerApercu();
  });

  // Entrée insère un saut de ligne ; Échap sort de la zone.
  document.addEventListener("keydown", event => {
    const z = event.target.closest?.("[data-zone]");
    if (!z) return;
    if (event.key === "Escape") { event.preventDefault(); z.blur(); }
  });

  // Redessine l'aperçu sans toucher au reste de la page : reconstruire tout
  // le module ferait perdre le défilement et la sélection.
  function redessinerApercu() {
    const boite = document.querySelector(".msg-apercu");
    if (!boite) return;
    const ancien = boite.querySelector(".dc-msg");
    if (!ancien) return;
    const provisoire = document.createElement("div");
    provisoire.innerHTML = apercuMessage(brouillon());
    const neuf = provisoire.firstElementChild;
    if (neuf) ancien.replaceWith(neuf);
    majEtatMessage();
  }

  // Compteur de longueur : les cartes ont un budget de texte, et dépasser
  // annule la conversion — mieux vaut le savoir en écrivant qu'à l'envoi.
  function majEtatMessage() {
    const jauge = document.querySelector("#msg-jauge");
    if (!jauge) return;
    const m = brouillon();
    const B = window.Balises;
    const total = [String(m.content || ""), ...m.embeds.flatMap(e => [e.titre, e.description, e.footer, e.auteur])]
      .map(v => B.appliquer(String(v || "")).length)
      .reduce((a, b) => a + b, 0);
    const max = window.Cartes.MAX_TEXTE_TOTAL;
    jauge.textContent = `${total} / ${max} caractères`;
    jauge.className = total > max ? "cv-jauge cv-jauge-plein" : "cv-jauge";
    jauge.title = total > max
      ? "Au-delà de cette limite, Discord refuse la carte : le message partira en embed classique, avec sa barre colorée."
      : "Longueur totale du texte de la carte.";
  }

  // 📥 Import des sanctions prononcées sur Discord.
  // Lancé tout seul en arrivant sur la page (sans bloquer l'affichage) et
  // par le bouton. L'appel automatique est espacé : inutile d'interroger
  // les bots à chaque aller-retour dans le menu.
  let _importEnCours = false;
  let _dernierImport = 0;
  async function importerBlacklistDiscord(manuel = false) {
    if (_importEnCours) return;
    if (!manuel && Date.now() - _dernierImport < 60000) return;
    _importEnCours = true;
    const boite = () => document.querySelector("#bl-import-rapport");
    if (manuel && boite()) boite().innerHTML = `<div class="row">⏳ Lecture des sanctions sur vos bots…</div>`;
    try {
      const r = await api("blacklist.import", {});
      _dernierImport = Date.now();
      const im = r?.import || {};
      const ko = (im.bots || []).filter(b => !b.ok);
      const bouge = (im.ajoutees || 0) + (im.completees || 0) + (im.levees || 0);
      if (bouge) render();
      const b = boite();
      if (b && (manuel || ko.length)) {
        b.innerHTML = `<div class="row" style="flex-direction:column;align-items:flex-start;gap:5px">
          <b>${im.ajoutees || 0} sanction(s) importée(s) de Discord${im.completees ? `, ${im.completees} complétée(s) avec leur preuve` : ""}${im.levees ? `, ${im.levees} levée(s) sur Discord` : ""}.</b>
          ${(im.bots || []).map(x => `<span style="color:var(--muted)">${x.ok ? "✅" : "❌"} ${esc(x.bot)} — ${esc(x.message)}</span>`).join("")}
        </div>`;
      }
      if (manuel) {
        toast("IMPORT", ko.length
          ? `${ko.length} bot(s) injoignable(s) : ${ko[0].message}`
          : `${im.ajoutees || 0} sanction(s) importée(s) depuis Discord.`, ko.length ? "error" : "success");
      }
    } catch (err) {
      const b = boite();
      if (b && manuel) b.innerHTML = `<div class="row" style="color:var(--red)">❌ ${esc(err.message)}</div>`;
      if (manuel) toast("IMPORT", err.message, "error");
    } finally {
      _importEnCours = false;
    }
  }

  function blacklistView() {
    // On affiche d'abord ce qu'on a, puis on va voir les bots : la page ne
    // reste jamais bloquée sur un bot qui met du temps à répondre.
    if (estEquipeSite()) setTimeout(() => importerBlacklistDiscord(false), 60);
    const query = ui.blacklistQuery.trim().toLowerCase();
    const entries = (state.blacklist || []).filter(item => !query || `${item.username} ${item.discordId} ${item.reason} ${item.server}`.toLowerCase().includes(query));
    return `<div class="content-view">
      ${pageHead("Staff bot / Sécurité", "Blacklist globale", "Les sanctions posées ici partent sur Discord, et celles prononcées sur Discord remontent ici.",
        button("📥 Importer depuis Discord", "blacklist-import", "ghost") + button("Ajouter une entrée", "open-blacklist-modal", "danger"))}
      <section class="panel"><div class="panel-inner">
        <div class="panel-head"><div><h3>Base de sanctions</h3><p>${entries.length} résultat(s) sur ${state.blacklist?.length || 0} entrées.</p></div><div class="searchbar"><input class="input" id="blacklist-search" value="${esc(ui.blacklistQuery)}" placeholder="Nom, ID Discord, serveur ou motif…"><button class="btn" data-action="blacklist-search">Rechercher</button></div></div>
        <div id="bl-import-rapport"></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Utilisateur</th><th>Motif</th><th>Sévérité</th><th>Origine</th><th>Preuves</th><th>Actions</th></tr></thead><tbody>
        ${entries.map(entry => `<tr class="cliquable" data-action="open-sanction" data-id="${esc(entry.id)}" title="Ouvrir la fiche et voir toutes les preuves">
          <td><strong>${esc(entry.username)}</strong><br><span>${esc(entry.discordId)}</span><br><span>${esc(entry.id)} · ${esc(entry.date)}</span></td>
          <td>${esc(entry.reason)}${entry.leveeSurDiscord ? `<br><span class="field-note" style="color:var(--amber,#f3c86a)">⚠️ levée sur Discord</span>` : ""}</td>
          <td><span class="severity ${esc(entry.severity)}">${esc(entry.severity)}</span></td>
          <td>${entry.origine === "discord" ? "💬 Discord" : "🖥️ Panel"}<br><span>${esc(entry.server)} · par ${esc(entry.author)}</span></td>
          <td><div class="proof-list">${
            (entry.proofs?.length ? entry.proofs.map(proof => `<span class="proof-pill">${esc(proof)}</span>`).join("") : "")
            + (entry.preuveDiscord ? `<span class="proof-pill" title="${esc(entry.preuveDiscord)}">💬 preuve Discord</span>` : "")
            || `<span class="field-note">Aucune preuve</span>`}</div></td>
          <td><div class="page-actions">${button("📂 Fiche", "open-sanction", "small", `data-id="${esc(entry.id)}"`)}${button("Preuve", "open-proof-modal", "small", `data-id="${esc(entry.id)}"`)}${button("Retirer", "delete-blacklist", "danger small", `data-id="${esc(entry.id)}"`)}</div></td>
        </tr>`).join("") || `<tr><td colspan="6">${emptyBlock("Aucun résultat", "Aucune entrée ne correspond à cette recherche.")}</td></tr>`}
        </tbody></table></div>
      </div></section>
      <div class="grid-3 mt-16">
        <div class="stat-card"><span>Sanctions critiques</span><strong>${(state.blacklist || []).filter(x=>x.severity==="critique").length}</strong><em>surveillance renforcée</em></div>
        <div class="stat-card"><span>Preuves enregistrées</span><strong>${(state.blacklist || []).reduce((s,x)=>s+(x.proofs?.length||0),0)}</strong><em>images, PDF et logs</em></div>
        <div class="stat-card"><span>Serveurs concernés</span><strong>${new Set((state.blacklist || []).map(x=>x.server)).size}</strong><em>base mutualisée</em></div>
      </div>
    </div>`;
  }

  // ── 📂 Fiche complète d'une sanction, avec TOUTES ses preuves ───────
  // Les images s'affichent directement ; les autres fichiers (PDF, logs)
  // sont proposés en ouverture. Un clic sur une image l'agrandit.
  function openSanctionModal(id) {
    const e = (state.blacklist || []).find(x => x.id === id);
    if (!e) { toast("INTROUVABLE", "Cette sanction n'existe plus.", "error"); return; }
    const preuves = e.proofs || [];
    const estImage = f => /\.(png|jpe?g|webp|gif|avif)$/i.test(String(f));
    const url = f => {
      const s = String(f);
      // Les preuves téléversées sont dans uploads/proofs/ ; les anciennes
      // entrées ne contiennent qu'un nom de fichier.
      if (/^(https?:\/\/|uploads\/)/.test(s)) return s;
      return "uploads/proofs/" + s;
    };
    const vignettes = preuves.length
      ? `<div class="preuve-grille">${preuves.map((f, i) => estImage(f)
          ? `<figure class="preuve" data-action="preuve-zoom" data-src="${esc(url(f))}" title="Agrandir">
               <img src="${esc(url(f))}" alt="" loading="lazy"
                    onerror="this.closest('figure').classList.add('absente')">
               <figcaption>${esc(String(f).split('/').pop())}</figcaption>
             </figure>`
          : `<a class="preuve fichier" href="${esc(url(f))}" target="_blank" rel="noopener">
               <span class="preuve-ico">${/\.pdf$/i.test(f) ? "📕" : "📄"}</span>
               <figcaption>${esc(String(f).split('/').pop())}</figcaption>
             </a>`).join("")}</div>`
      : emptyBlock("Aucune preuve", "Utilisez « Ajouter une preuve » pour joindre une capture, un PDF ou un journal.");
    const g = { critique: "#ff5c74", élevée: "#f3c86a", moyenne: "#4fd9ff", faible: "#948aa3" }[e.severity] || "var(--accent)";
    openModal(`📂 Sanction ${esc(e.id)}`, `
      <div class="acc-head">
        <div class="acc-avatar" style="background:linear-gradient(135deg, ${g}, ${g}99)">${esc(String(e.username || "?").slice(0, 2).toUpperCase())}</div>
        <div>
          <strong>${esc(e.username)}</strong>
          <span>${esc(e.discordId)}</span>
        </div>
        <span class="acc-grade" style="--gc:${g};margin-left:auto">${esc(e.severity)}</span>
      </div>
      <div class="acc-row"><span>Motif</span><div><b>${esc(e.reason)}</b></div></div>
      <div class="acc-row"><span>Portée</span><div><b>${e.portee === "bot" ? "🤖 " + esc(e.server || "un bot") : "🌍 Globale — tous les bots"}</b><i>sanction prononcée par ${esc(e.author || "inconnu")}</i></div></div>
      <div class="acc-row"><span>Date</span><div><b>${esc(e.date || "—")}</b></div></div>
      <div class="acc-row"><span>Preuves</span><div><b>${preuves.length} fichier(s)</b></div></div>
      <div class="acc-row"><span>Origine</span><div><b>${e.origine === "discord"
        ? "💬 Prononcée sur Discord"
        : "🖥️ Prononcée depuis le panel"}</b>${e.leveeSurDiscord
        ? `<i style="color:var(--amber,#f3c86a)">⚠️ Elle n'est plus active sur le bot : quelqu'un l'a levée sur Discord. La fiche et ses preuves sont conservées.</i>`
        : ""}</div></div>
      ${e.preuveDiscord ? `<div class="acc-row"><span>Preuve Discord</span><div><b style="white-space:pre-wrap">${esc(e.preuveDiscord)}</b><i>saisie par le staff au moment de la sanction</i></div></div>` : ""}
      <div class="acc-row"><span>Sur Discord</span><div>${e.diffusion?.length
        ? rapportDiffusion(e.diffusion)
        : `<b style="color:var(--muted)">Jamais appliquée sur Discord</b><i>fiche créée avant la liaison avec les bots — utilisez « Réappliquer »</i>`}</div></div>
      <div style="margin-top:14px">${vignettes}</div>
      <div class="form-actions" style="flex-wrap:wrap">
        <button class="btn ghost" type="button" data-action="open-proof-modal" data-id="${esc(e.id)}">📎 Ajouter une preuve</button>
        <button class="btn primary" type="button" data-action="blacklist-resync" data-id="${esc(e.id)}">🔁 Réappliquer sur Discord</button>
        <button class="btn danger" type="button" data-action="delete-blacklist" data-id="${esc(e.id)}">Retirer la sanction</button>
        <button class="btn success" type="button" data-action="close-modal">Fermer</button>
      </div>
      <div id="bl-resync-rapport" style="margin-top:10px"></div>`, true);
  }

  function ticketsView() {
    // 🗄️ Deux vues : les tickets EN COURS et les ARCHIVES (tickets fermés).
    if (ui.ticketTab === "archives") return archivesView();
    const ticket = (state.tickets || []).find(item => item.id === ui.selectedTicketId) || state.tickets?.[0];
    const nbArchives = (state.archives || []).length;
    return `<div class="content-view">
      ${pageHead("Staff bot / Support", "Gestion des tickets", "Ouvrez une conversation, répondez depuis le site et modifiez son statut. Un ticket fermé part automatiquement dans les archives.",
        button(`🗄️ Archives (${nbArchives})`, "ticket-tab", "ghost", 'data-tab="archives"') + button("Actualiser", "pulse-system", "primary"))}
      <div class="ticket-layout">
        <section class="panel"><div class="panel-head" style="padding:17px;margin:0"><div><h3>Tickets en cours</h3><p>${state.tickets?.length || 0} ticket(s) ouvert(s).</p></div></div><div class="ticket-list">
          ${(state.tickets || []).map(item => `<button class="ticket-card ${ticket?.id === item.id ? "active" : ""}" data-action="select-ticket" data-ticket-id="${esc(item.id)}"><span><strong>${esc(item.id)} · ${esc(item.user)}</strong><p>${esc(item.subject)}</p><small>${esc(item.server)} · ${esc(item.date)}</small></span><span class="ticket-status ${slug(item.status)}">${esc(item.status)}</span></button>`).join("")
            || emptyBlock("Aucun ticket en cours", "Les tickets fermés sont dans les archives.")}
        </div></section>
        ${ticket ? `<section class="panel chat-panel"><header class="chat-head"><div><h3>${esc(ticket.id)} · ${esc(ticket.subject)}</h3><p>${esc(ticket.user)} — ${esc(ticket.server)} — priorité ${esc(ticket.priority)}</p></div><select class="select" style="width:auto;min-width:135px" data-action="ticket-status" data-ticket-id="${esc(ticket.id)}"><option value="ouvert" ${ticket.status==="ouvert"?"selected":""}>Ouvert</option><option value="en attente" ${ticket.status==="en attente"?"selected":""}>En attente</option><option value="fermé" ${ticket.status==="fermé"?"selected":""}>Fermé</option></select></header>
          <div class="chat-messages" id="chat-messages">${(ticket.messages || []).map(message => `<article class="message ${message.staff ? "staff" : ""}"><div class="message-head"><strong>${esc(message.author)}</strong><time>${esc(message.time)}</time></div><p>${esc(message.content)}</p></article>`).join("")}</div>
          <form class="chat-compose" data-form="ticket-message" data-ticket-id="${esc(ticket.id)}"><textarea class="textarea" name="content" placeholder="Écrire une réponse au membre…" ${ticket.status === "fermé" ? "" : ""}></textarea><button class="btn success" type="submit">Envoyer la réponse</button></form>
        </section>` : `<section class="panel">${emptyBlock("Aucun ticket", "Aucune conversation n'est disponible.")}</section>`}
      </div>
    </div>`;
  }

  // 🗄️ Archives : tickets fermés, conservés avec toute leur conversation.
  function archivesView() {
    const archives = state.archives || [];
    const query = (ui.archiveQuery || "").trim().toLowerCase();
    const list = archives.filter(t => !query || `${t.id} ${t.user} ${t.subject} ${t.server}`.toLowerCase().includes(query));
    const open = archives.find(t => t.id === ui.selectedArchiveId) || list[0];
    return `<div class="content-view">
      ${pageHead("Staff bot / Archives", "Tickets archivés", "Chaque ticket fermé est conservé ici avec l'intégralité de sa conversation.",
        button("← Tickets en cours", "ticket-tab", "ghost", 'data-tab="open"'))}
      <div class="ticket-layout">
        <section class="panel">
          <div class="panel-head" style="padding:17px;margin:0"><div><h3>${archives.length} archive(s)</h3><p>${list.length} résultat(s).</p></div></div>
          <div style="padding:0 14px 12px"><input class="input" id="archive-search" placeholder="Rechercher (n°, membre, sujet…)" value="${esc(ui.archiveQuery || "")}"></div>
          <div class="ticket-list">
            ${list.map(t => `<button class="ticket-card ${open?.id === t.id ? "active" : ""}" data-action="select-archive" data-ticket-id="${esc(t.id)}">
              <span><strong>${esc(t.id)} · ${esc(t.user)}</strong><p>${esc(t.subject)}</p><small>Fermé le ${esc(t.closedAt || "?")} · ${esc(t.server)}</small></span>
              <span class="ticket-status ferme">archivé</span></button>`).join("")
              || emptyBlock("Aucune archive", "Les tickets fermés apparaîtront ici.")}
          </div>
        </section>
        ${open ? `<section class="panel chat-panel">
          <header class="chat-head">
            <div><h3>${esc(open.id)} · ${esc(open.subject)}</h3><p>${esc(open.user)} — ${esc(open.server)} — fermé le ${esc(open.closedAt || "?")} par ${esc(open.closedBy || "staff")}</p></div>
            <div class="page-actions">
              ${button("↩ Rouvrir", "archive-restore", "ghost small", `data-ticket-id="${esc(open.id)}"`)}
              ${button("🗑 Supprimer", "archive-purge", "danger small", `data-ticket-id="${esc(open.id)}"`)}
            </div>
          </header>
          <div class="chat-messages">${(open.messages || []).map(m => `
            <article class="message ${m.staff ? "staff" : ""}"><div class="message-head"><strong>${esc(m.author)}</strong><time>${esc(m.time)}</time></div><p>${esc(m.content)}</p></article>`).join("")}</div>
          <div style="padding:14px 16px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px">🔒 Conversation archivée — rouvrez le ticket pour y répondre à nouveau.</div>
        </section>` : `<section class="panel">${emptyBlock("Aucune archive sélectionnée", "Choisissez un ticket dans la liste.")}</section>`}
      </div>
    </div>`;
  }

  // ══════════════════════════════════════════════════════════════════
  // CONSTRUCTEUR DE PAGE — blocs empilables composés par le créateur
  // ══════════════════════════════════════════════════════════════════
  // Chaque bloc a un type, des champs décrits ici (l'éditeur est généré
  // automatiquement) et s'affiche sur la page d'accueil publique.
  const BLOCK_TYPES = {
    hero: {
      label: "🏔️ Bannière (hero)", desc: "Grand titre, texte et boutons d'appel",
      fields: [
        { k: "eyebrow", l: "Sur-titre", t: "text" },
        { k: "title", l: "Titre", t: "text" },
        { k: "highlight", l: "Mot mis en couleur", t: "text", note: "Affiché dans votre couleur d'accent, sous le titre." },
        { k: "text", l: "Texte de présentation", t: "textarea" },
        { k: "btn1", l: "Bouton principal — texte", t: "text" },
        { k: "btn1url", l: "Bouton principal — lien", t: "text", note: "URL, ou une page du site : #servers, #tickets…" },
        { k: "btn2", l: "Bouton secondaire — texte", t: "text" },
        { k: "btn2url", l: "Bouton secondaire — lien", t: "text" },
      ],
      def: { eyebrow: "Cardinal System connecté", title: "Aincrad", highlight: "Control", text: "Une interface de gestion Discord complète.", btn1: "Ouvrir le panneau", btn1url: "#dashboard", btn2: "", btn2url: "" },
    },
    bots: {
      label: "🤖 Sélection des bots", desc: "Les cartes pour choisir/inviter un bot",
      fields: [{ k: "title", l: "Titre de la section", t: "text" }],
      def: { title: "Sélectionnez l'interface du bot" },
    },
    stats: {
      label: "📊 Chiffres clés", desc: "Une rangée de statistiques",
      fields: [{ k: "items", l: "Chiffres", t: "list", item: [{ k: "value", l: "Valeur" }, { k: "label", l: "Libellé" }] }],
      def: { items: [{ value: "auto:servers", label: "serveurs liés" }, { value: "auto:users", label: "utilisateurs" }, { value: "8", label: "modules" }] },
      hint: "Astuce : écrivez auto:servers, auto:users ou auto:bots pour un chiffre calculé automatiquement.",
    },
    features: {
      label: "✨ Cartes / fonctionnalités", desc: "Une grille de cartes illustrées",
      fields: [{ k: "title", l: "Titre de la section", t: "text" },
        { k: "items", l: "Cartes", t: "list", item: [{ k: "icon", l: "Emoji" }, { k: "title", l: "Titre" }, { k: "text", l: "Texte" }] }],
      def: { title: "Ce que fait le bot", items: [
        { icon: "⚔️", title: "Module RP", text: "Personnages, économie et progression." },
        { icon: "🛡️", title: "Sécurité", text: "Anti-raid, anti-spam et journaux complets." },
        { icon: "🎫", title: "Tickets", text: "Support intégré avec transcriptions." },
      ] },
    },
    text: {
      label: "📝 Texte libre", desc: "Un titre et un paragraphe",
      fields: [{ k: "title", l: "Titre", t: "text" }, { k: "body", l: "Texte", t: "textarea" }],
      def: { title: "À propos", body: "Écrivez ici la présentation de votre communauté." },
    },
    gallery: {
      label: "🖼️ Galerie d'images", desc: "Vos captures ou visuels",
      fields: [{ k: "title", l: "Titre", t: "text" },
        { k: "items", l: "Images", t: "list", item: [{ k: "url", l: "URL de l'image" }, { k: "caption", l: "Légende" }] }],
      def: { title: "Galerie", items: [{ url: "assets/images/aincrad-bg.jpg", caption: "Aincrad" }] },
    },
    faq: {
      label: "❓ FAQ", desc: "Questions/réponses dépliables",
      fields: [{ k: "title", l: "Titre", t: "text" },
        { k: "items", l: "Questions", t: "list", item: [{ k: "q", l: "Question" }, { k: "a", l: "Réponse" }] }],
      def: { title: "Questions fréquentes", items: [{ q: "Comment inviter le bot ?", a: "Cliquez sur la carte du bot puis autorisez-le sur votre serveur." }] },
    },
    announcements: {
      label: "📣 Annonces défilantes", desc: "Messages qui défilent automatiquement",
      fields: [{ k: "items", l: "Messages", t: "list", item: [{ k: "titre", l: "Titre" }, { k: "texte", l: "Texte" }] }],
      def: { items: [{ titre: "🎉 Nouveauté", texte: "Décrivez ici votre annonce." }] },
    },
    cta: {
      label: "🚀 Appel à l'action", desc: "Un bandeau avec un gros bouton",
      fields: [{ k: "title", l: "Titre", t: "text" }, { k: "text", l: "Texte", t: "text" },
        { k: "btn", l: "Bouton — texte", t: "text" }, { k: "btnurl", l: "Bouton — lien", t: "text" }],
      def: { title: "Rejoignez l'aventure", text: "Ajoutez le bot à votre serveur en un clic.", btn: "Ajouter le bot", btnurl: "#dashboard" },
    },
    footer: {
      label: "🔻 Pied de page", desc: "Mentions de bas de page",
      fields: [{ k: "text", l: "Texte", t: "text" }],
      def: { text: "© 2026 — Tous droits réservés" },
    },
  };

  // Blocs en cours d'édition (non encore enregistrés) puis blocs enregistrés.
  function stageBlocks(blocks) {
    ui.blocks = blocks;
  }
  function pageBlocks() {
    if (Array.isArray(ui.blocks)) return ui.blocks;
    const blocks = siteConfig().blocks;
    if (Array.isArray(blocks) && blocks.length) return blocks;
    // Page par défaut (équivalent de l'accueil d'origine).
    return [
      { id: "b1", type: "hero", props: { ...BLOCK_TYPES.hero.def } },
      { id: "b2", type: "stats", props: { ...BLOCK_TYPES.stats.def } },
      { id: "b3", type: "bots", props: { ...BLOCK_TYPES.bots.def } },
    ];
  }

  function autoValue(raw) {
    const text = String(raw ?? "");
    if (text === "auto:servers") return formatNumber(state.servers?.length || 0);
    if (text === "auto:users") return formatNumber((state.servers || []).reduce((sum, s) => sum + Number(s.members || 0), 0));
    if (text === "auto:bots") return formatNumber(state.bots?.length || 0);
    return text;
  }

  // Rendu public d'un bloc sur la page d'accueil.
  function renderBlock(block, index) {
    const p = block.props || {};
    const anim = `style="animation-delay:${.06 * index}s"`;
    const list = key => Array.isArray(p[key]) ? p[key] : [];
    switch (block.type) {
      case "hero":
        return `<section class="blk blk-hero" ${anim}>
          ${p.eyebrow ? `<div class="eyebrow">${esc(p.eyebrow)}</div>` : ""}
          <h1>${esc(p.title || "")}${p.highlight ? `<br><span>${esc(p.highlight)}</span>` : ""}</h1>
          ${p.text ? `<p>${esc(p.text)}</p>` : ""}
          <div class="blk-btns">
            ${p.btn1 ? `<button class="btn primary" data-action="block-link" data-url="${esc(p.btn1url || "")}">${esc(p.btn1)}</button>` : ""}
            ${p.btn2 ? `<button class="btn" data-action="block-link" data-url="${esc(p.btn2url || "")}">${esc(p.btn2)}</button>` : ""}
          </div>
        </section>`;
      case "bots":
        return `<section class="blk" ${anim}>
          ${p.title ? `<div class="bot-select-title">${esc(p.title)}</div>` : ""}
          <div class="bot-select">${(state.bots || []).map(bot => `
            <button class="bot-card" data-action="select-bot" data-bot-id="${esc(bot.id)}">
              ${botAvatar(bot)}
              <span>
                <span style="display:flex;align-items:center;gap:8px"><h2>${esc(bot.name)}</h2><i class="status-dot"></i></span>
                <p>${esc(bot.description)}</p>
                <small>${esc(bot.tag)} · ${formatNumber(bot.servers)} SERVEURS</small>
              </span>
              <span class="arrow">›</span>
            </button>`).join("")}</div>
        </section>`;
      case "stats":
        return `<section class="blk" ${anim}><div class="gate-metrics">${list("items").map(item => `
          <div class="gate-metric"><strong>${esc(autoValue(item.value))}</strong><span>${esc(item.label || "")}</span></div>`).join("")}
        </div></section>`;
      case "features":
        return `<section class="blk" ${anim}>
          ${p.title ? `<h3 class="blk-title">${esc(p.title)}</h3>` : ""}
          <div class="feature-grid">${list("items").map(item => `
            <div class="feature-card"><span class="feature-icon">${esc(item.icon || "◆")}</span>
              <strong>${esc(item.title || "")}</strong><p>${esc(item.text || "")}</p></div>`).join("")}</div>
        </section>`;
      case "text":
        return `<section class="blk blk-text" ${anim}>
          ${p.title ? `<h3 class="blk-title">${esc(p.title)}</h3>` : ""}
          <p>${esc(p.body || "")}</p>
        </section>`;
      case "gallery":
        return `<section class="blk" ${anim}>
          ${p.title ? `<h3 class="blk-title">${esc(p.title)}</h3>` : ""}
          <div class="gallery-grid">${list("items").map(item => `
            <figure class="gallery-item"><img src="${esc(item.url || "")}" alt="${esc(item.caption || "")}" loading="lazy">
            ${item.caption ? `<figcaption>${esc(item.caption)}</figcaption>` : ""}</figure>`).join("")}</div>
        </section>`;
      case "faq":
        return `<section class="blk" ${anim}>
          ${p.title ? `<h3 class="blk-title">${esc(p.title)}</h3>` : ""}
          <div class="faq-list">${list("items").map(item => `
            <details class="faq-item"><summary>${esc(item.q || "")}</summary><p>${esc(item.a || "")}</p></details>`).join("")}</div>
        </section>`;
      case "announcements": {
        const items = list("items");
        if (!items.length) return "";
        return `<section class="blk" ${anim}><div class="annwin" data-ann='${esc(JSON.stringify(items))}'>
          <div class="anhead">A N N O N C E S</div>
          <button class="anv" data-action="ann-prev">‹</button>
          <div class="anbody"><div class="antitre"></div><div class="antexte"></div></div>
          <button class="anv" data-action="ann-next">›</button>
          <div class="andots"></div>
        </div></section>`;
      }
      case "cta":
        return `<section class="blk" ${anim}><div class="cta-band">
          <div><strong>${esc(p.title || "")}</strong><span>${esc(p.text || "")}</span></div>
          ${p.btn ? `<button class="btn primary" data-action="block-link" data-url="${esc(p.btnurl || "")}">${esc(p.btn)}</button>` : ""}
        </div></section>`;
      case "footer":
        return `<section class="blk blk-footer" ${anim}>${esc(p.text || "")}</section>`;
      default:
        return "";
    }
  }

  // ── Espace créateur : bots + page + apparence + écosystème ──────────
  function creatorView() {
    const valid = ["ecosystem", "page", "builder", "bots", "perms", "discord", "db", "maj"];
    const tab = valid.includes(ui.creatorTab) ? ui.creatorTab : "page";
    const tabs = [
      ["page", "🧱 Constructeur de page", "Blocs de la page d'accueil"],
      ["bots", "🤖 Mes bots", "Ajoutez autant de bots que voulu"],
      ["perms", "🔐 Fonctions & grades", "Qui voit quoi, avec aperçu"],
      ["discord", "🔑 Connexion & équipe", "Qui entre, avec quel grade"],
      ["db", "🗄️ Base de données", "Tout sauvegarder en base"],
      ["maj", "🔄 Mises à jour", "Le site et tous les bots"],
      ["builder", "🎨 Apparence du site", "Thème, fond, navigation, CSS"],
      ["ecosystem", "🌍 Écosystème", "Serveurs et indicateurs"],
    ];
    const heads = {
      page: pageHead("Créateur / Site builder", "Construisez votre page", "Ajoutez, réordonnez et modifiez les blocs de votre page d'accueil : bannière, cartes, chiffres, galerie, FAQ, annonces…"),
      bots: pageHead("Créateur / Bots", "Mes bots", "Déclarez ici tous vos bots — il n'y a aucune limite. Reliez-les à votre agent pour récupérer leurs vrais serveurs."),
      perms: pageHead("Créateur / Permissions", "Fonctions & grades", "Toutes les fonctions du bot et toutes les pages du site : choisissez qui y a accès, et prévisualisez le site avec les yeux d'un grade."),
      builder: pageHead("Créateur / Site builder", "Apparence du site", "Identité, thème, fond animé ou image, navigation, effets et CSS libre — appliqués en direct."),
      discord: pageHead("Créateur / Connexion", "Connexion & équipe", "Vos membres se connectent avec leur compte Discord. Seuls les identifiants que vous listez entrent dans l'espace de gestion."),
      db: pageHead("Créateur / Données", "Base de données", "Rangez sanctions, preuves, tickets et réglages dans une vraie base — MySQL chez votre hébergeur, ou un simple fichier SQLite."),
      maj: pageHead("Créateur / Maintenance", "Mises à jour", "Le site se met à jour tout seul depuis GitHub et aligne tous les bots qu'il pilote sur la même version."),
      ecosystem: pageHead("Créateur / Écosystème", "Vue globale", "Consultez l'ensemble des bots, des serveurs et des indicateurs de déploiement.", button("Exporter les données", "export-state", "primary")),
    };
    const tabBar = `<div class="subtabs">${tabs.map(t => `
      <button class="subtab ${tab === t[0] ? "active" : ""}" data-action="creator-tab" data-tab="${t[0]}">
        <strong>${t[1]}</strong><span>${t[2]}</span>
      </button>`).join("")}</div>`;
    const body = tab === "builder" ? siteBuilderBody()
      : tab === "page" ? pageBuilderBody()
      : tab === "bots" ? botsBuilderBody()
      : tab === "perms" ? permissionsBody()
      : tab === "discord" ? discordBody()
      : tab === "db" ? dbBody()
      : tab === "maj" ? majBody()
      : creatorEcosystem();
    return `<div class="content-view">${heads[tab]}${tabBar}${body}</div>`;
  }

  // ══════════════════════════════════════════════════════════════════
  // GRADES & FONCTIONS DU BOT
  // ══════════════════════════════════════════════════════════════════
  // Deux familles de grades : ceux du SERVEUR (comme dans le bot :
  // Membre → Staff → Administration) et ceux de l'ÉQUIPE DU BOT
  // (permissions de /botstaff : tickets, blacklist, gestion du staff, créateur).
  const GRADES = [
    { id: "membre", label: "Membre", family: "Serveur", rank: 0, color: "#948aa3", desc: "Tout le monde sur le serveur" },
    { id: "police", label: "Police / Métier", family: "Serveur", rank: 1, color: "#4fd9ff", desc: "Rôle métier whitelisté" },
    { id: "staff", label: "Staff", family: "Serveur", rank: 2, color: "#2fe38b", desc: "Rôle staff configuré" },
    { id: "admin", label: "Administration", family: "Serveur", rank: 3, color: "#f3c86a", desc: "Rôle admin ou permission Administrateur" },
    { id: "bot-tickets", label: "Support du bot", family: "Équipe du bot", rank: 4, color: "#62b8ff", desc: "Permission 🎫 Tickets du QG" },
    { id: "bot-blacklist", label: "Modérateur du bot", family: "Équipe du bot", rank: 5, color: "#ff7ca5", desc: "Permission 🚫 Blacklist" },
    { id: "bot-staff", label: "Responsable du bot", family: "Équipe du bot", rank: 6, color: "#a970ff", desc: "Permission 🛡️ Gestion du staff" },
    { id: "createur", label: "Créateur", family: "Équipe du bot", rank: 7, color: "#ff5c74", desc: "Propriétaire du bot — accès total" },
  ];
  const gradeById = id => GRADES.find(g => g.id === id) || GRADES[0];

  // Toutes les fonctions du bot, reprises de ses commandes réelles.
  // « g » = grades autorisés par défaut (repris des grades du bot).
  const FEATURES = [
    // 🎭 Roleplay
    { id: "cmd.carte", cat: "🎭 Roleplay", label: "/carte", desc: "Cartes d'identité RP (création, recherche, modification)", g: ["staff", "admin"] },
    { id: "cmd.permis", cat: "🎭 Roleplay", label: "/permis", desc: "Permis de conduire : délivrance, points, invalidation", g: ["staff", "admin"] },
    { id: "cmd.entreprise", cat: "🎭 Roleplay", label: "/entreprise", desc: "Entreprises RP, patrons et employés", g: ["staff", "admin"] },
    { id: "cmd.assurance", cat: "🎭 Roleplay", label: "/assurance", desc: "Contrats d'assurance (véhicule, maison, entreprise, santé)", g: ["staff", "admin"] },
    { id: "cmd.service", cat: "🎭 Roleplay", label: "/service", desc: "Prise et fin de service RP", g: ["membre", "police", "staff", "admin"] },
    { id: "cmd.temps", cat: "🎭 Roleplay", label: "/temps", desc: "Temps de service des membres d'une faction", g: ["police", "staff", "admin"] },
    { id: "cmd.casier", cat: "🎭 Roleplay", label: "/casier", desc: "Casier d'un membre (historique RP)", g: ["staff", "admin"] },
    { id: "cmd.casierjudiciaire", cat: "🎭 Roleplay", label: "/casierjudiciaire", desc: "Casier judiciaire — réservé à la police", g: ["police", "staff", "admin"] },
    { id: "cmd.warnrp", cat: "🎭 Roleplay", label: "/warnrp", desc: "Avertissements RP à points", g: ["staff", "admin"] },
    { id: "cmd.whitelistrp", cat: "🎭 Roleplay", label: "/whitelistrp", desc: "Whitelist RP : panneau, recherche, casier", g: ["staff", "admin"] },
    { id: "cmd.blacklistrp", cat: "🎭 Roleplay", label: "/blacklistrp", desc: "Blacklist RP du serveur", g: ["staff", "admin"] },
    { id: "cmd.whitelist", cat: "🎭 Roleplay", label: "/whitelist", desc: "Whitelist métiers : les gérants recrutent", g: ["police", "staff", "admin"] },
    // 🛡️ Modération
    { id: "cmd.ban", cat: "🛡️ Modération", label: "/ban · /kick · /mute", desc: "Sanctions classiques du serveur", g: ["staff", "admin"] },
    { id: "cmd.banglobal", cat: "🛡️ Modération", label: "/banglobal", desc: "Bannir sur tous les serveurs du bot", g: ["admin"] },
    { id: "cmd.securite", cat: "🛡️ Modération", label: "/securite", desc: "Anti-spam, anti-nuke et captcha", g: ["admin"] },
    { id: "cmd.snipe", cat: "🛡️ Modération", label: "/snipe", desc: "Derniers messages supprimés", g: ["staff", "admin"] },
    { id: "cmd.report", cat: "🛡️ Modération", label: "/report", desc: "Signaler un utilisateur au staff", g: ["membre", "police", "staff", "admin"] },
    // ⚙️ Configuration
    { id: "cmd.config", cat: "⚙️ Configuration", label: "/config", desc: "Panneau central : rôles, salons, XP, whitelist", g: ["staff", "admin"] },
    { id: "cmd.ticket", cat: "⚙️ Configuration", label: "/ticket", desc: "Tickets : panneau, raisons, ouverture pour un membre", g: ["staff", "admin"] },
    { id: "cmd.esthetique", cat: "🤖 Équipe du bot", label: "/esthetique", desc: "Ré-applique l'esthétique du bot sur tous ses serveurs", g: ["createur"] },
    { id: "cmd.preset", cat: "⚙️ Configuration", label: "/preset", desc: "Réponses types envoyées dans les tickets", g: ["staff", "admin"] },
    { id: "cmd.embed", cat: "⚙️ Configuration", label: "/embed", desc: "Composer, modifier et poser des rôles au clic sur un message du bot", g: ["staff", "admin"] },
    { id: "cmd.reseaux", cat: "⚙️ Configuration", label: "/reseaux", desc: "Annonces automatiques des réseaux sociaux", g: ["staff", "admin"] },
    { id: "cmd.staff", cat: "⚙️ Configuration", label: "/arrivee · /depart", desc: "Annonces d'arrivée et de départ de poste", g: ["staff", "admin"] },
    { id: "cmd.partenariat", cat: "⚙️ Configuration", label: "/partenariat", desc: "Proposer et publier des partenariats", g: ["membre", "staff", "admin"] },
    // 📈 Communauté
    { id: "cmd.niveau", cat: "📈 Communauté", label: "/niveau", desc: "Niveaux et classements (écrit et vocal)", g: ["membre", "police", "staff", "admin"] },
    { id: "cmd.info", cat: "📈 Communauté", label: "/info", desc: "Fiche d'un membre", g: ["membre", "police", "staff", "admin"] },
    { id: "cmd.musique", cat: "📈 Communauté", label: "/musique", desc: "Musique en vocal (YouTube, Spotify, Deezer…)", g: ["membre", "police", "staff", "admin"] },
    { id: "cmd.interact", cat: "📈 Communauté", label: "/interact", desc: "Interactions entre membres (câlin, high-five…)", g: ["membre", "police", "staff", "admin"] },
    { id: "cmd.sao", cat: "📈 Communauté", label: "/sao", desc: "Mini-jeu Aincrad : personnage et progression", g: ["membre", "police", "staff", "admin"] },
    { id: "cmd.vgache", cat: "📈 Communauté", label: "/vgache", desc: "Gacha de VTubeuses", g: ["membre", "police", "staff", "admin"] },
    { id: "cmd.invite", cat: "📈 Communauté", label: "/invite", desc: "Lien d'invitation du bot", g: ["membre", "police", "staff", "admin"] },
    // 🤖 Équipe du bot
    { id: "cmd.blacklist", cat: "🤖 Équipe du bot", label: "/blacklist", desc: "Blacklist GLOBALE du bot (MP + ban partout)", g: ["bot-blacklist", "bot-staff", "createur"] },
    { id: "cmd.botstaff", cat: "🤖 Équipe du bot", label: "/botstaff", desc: "Hiérarchie et permissions de l'équipe du bot", g: ["bot-staff", "createur"] },
    { id: "cmd.qgtickets", cat: "🤖 Équipe du bot", label: "Tickets du QG", desc: "Traiter les tickets de bannissement remontés", g: ["bot-tickets", "bot-staff", "createur"] },
    { id: "cmd.scamimage", cat: "🤖 Équipe du bot", label: "/scamimage", desc: "Anti-scam global par image", g: ["createur"] },
    { id: "cmd.patchnote", cat: "🤖 Équipe du bot", label: "/patchnote", desc: "Notes de mise à jour du bot", g: ["createur"] },
    { id: "cmd.update", cat: "🤖 Équipe du bot", label: "/update · /forceupdate", desc: "Mise à jour et redémarrage du bot", g: ["admin", "createur"] },
    // 🖥️ Pages du site
    { id: "page.dashboard", cat: "🖥️ Pages du site", label: "Vue d'ensemble", desc: "Tableau de bord du site", g: ["staff", "admin", "bot-tickets", "bot-blacklist", "bot-staff", "createur"] },
    { id: "page.servers", cat: "🖥️ Pages du site", label: "Mes serveurs", desc: "Liste et configuration des serveurs", g: ["staff", "admin", "bot-staff", "createur"] },
    { id: "page.blacklist", cat: "🖥️ Pages du site", label: "Blacklist & preuves", desc: "Base de sanctions et preuves", g: ["bot-blacklist", "bot-staff", "createur"] },
    { id: "page.tickets", cat: "🖥️ Pages du site", label: "Gestion des tickets", desc: "Conversations et archives", g: ["bot-tickets", "bot-staff", "createur"] },
    { id: "page.creator", cat: "🖥️ Pages du site", label: "Espace créateur", desc: "Site builder, bots, permissions", g: ["createur"] },
    // 🧩 Modules de configuration serveur
    { id: "mod.overview", cat: "🧩 Modules serveur", label: "Vue d'ensemble", desc: "Identité, langue et réglages généraux", g: ["staff", "admin", "createur"] },
    { id: "mod.rp", cat: "🧩 Modules serveur", label: "Module RP", desc: "Personnages, économie, inventaire", g: ["admin", "createur"] },
    { id: "mod.arrivals", cat: "🧩 Modules serveur", label: "Arrivées & départs", desc: "Messages de bienvenue et d'au revoir", g: ["staff", "admin", "createur"] },
    { id: "mod.roles", cat: "🧩 Modules serveur", label: "Rôles & sécurité", desc: "Anti-raid, autorôles, permissions", g: ["admin", "createur"] },
    { id: "mod.channels", cat: "🧩 Modules serveur", label: "Salons & logs", desc: "Journalisation du serveur", g: ["admin", "createur"] },
    { id: "mod.levels", cat: "🧩 Modules serveur", label: "Niveaux", desc: "XP, récompenses et progression", g: ["staff", "admin", "createur"] },
    { id: "mod.whitelist", cat: "🧩 Modules serveur", label: "Whitelist métiers", desc: "Candidatures et métiers autorisés", g: ["staff", "admin", "createur"] },
    { id: "mod.tickets", cat: "🧩 Modules serveur", label: "Tickets", desc: "Panneau, rôles support et archives", g: ["staff", "admin", "createur"] },
  ];

  // Permissions enregistrées (sinon valeurs par défaut de chaque fonction).
  function permissions() {
    const saved = siteConfig().permissions || {};
    const out = {};
    FEATURES.forEach(f => { out[f.id] = Array.isArray(saved[f.id]) ? saved[f.id] : f.g; });
    return out;
  }
  // Le grade actuellement simulé voit-il cette fonction ?
  function gradeCan(featureId, gradeId = ui.previewGrade) {
    if (!gradeId) return true;                       // aperçu désactivé
    if (gradeId === "createur") return true;         // le créateur voit tout
    return (permissions()[featureId] || []).includes(gradeId);
  }

  // ── 🤖 Gestion des bots : autant de bots que souhaité ───────────────
  const ACCENTS = [
    { value: "cyan", label: "Bleu" }, { value: "violet", label: "Violet" },
    { value: "rose", label: "Rose" }, { value: "gold", label: "Or" }, { value: "green", label: "Vert" },
  ];
  // Champ « Nom chez l'agent » : liste déroulante quand l'agent est joignable
  // (impossible de se tromper de nom), champ libre sinon.
  function agentNameField(bot) {
    const dispo = ui.agentBots;
    if (!Array.isArray(dispo) || !dispo.length) {
      return `<input class="input" data-f="agentName" value="${esc(bot.agentName || "")}" placeholder="colmar_rp">`;
    }
    const connu = dispo.some(b => b.nom === bot.agentName);
    return `<select class="select" data-f="agentName">
      <option value="">— Choisissez le bot —</option>
      ${dispo.map(b => `<option value="${esc(b.nom)}"${b.nom === bot.agentName ? " selected" : ""}>${b.demarre ? "🟢" : "⚪"} ${esc(b.nom)}</option>`).join("")}
      ${bot.agentName && !connu ? `<option value="${esc(bot.agentName)}" selected>⚠️ ${esc(bot.agentName)} (inconnu chez l'agent)</option>` : ""}
    </select>`;
  }
  // Lien d'invitation Discord d'un bot, construit depuis son Client ID.
  // Permissions 8 = Administrateur ; scopes bot + commandes slash.
  function inviteUrl(bot) {
    const id = String(bot?.clientId || "").trim();
    if (!/^\d{17,20}$/.test(id)) return null;
    return `https://discord.com/oauth2/authorize?client_id=${id}&scope=bot%20applications.commands&permissions=8`;
  }

  // Message d'aide sous le Client ID, qui signale une valeur invalide.
  function clientIdNote(valeur) {
    const v = String(valeur || "").trim();
    if (v === "") return "Laissez vide : la synchronisation le récupère toute seule depuis votre bot. Il sert à créer le lien « Inviter ce bot ».";
    if (!/^\d{17,20}$/.test(v)) {
      return `⚠️ « ${esc(v)} » n'est pas un Client ID Discord : il faut 17 à 20 chiffres (vous en avez ${v.replace(/\D/g, "").length}). Ce n'est NI l'adresse de votre agent, NI un port — c'est l'« Application ID » du portail développeur Discord.`;
    }
    return "✅ Format correct — le bouton « 🔗 Lien d'invitation » ci-dessus est actif.";
  }

  function botsBuilderBody() {
    const bots = state.bots || [];
    const rows = bots.map((bot, index) => `
      <div class="botcfg" data-bot-index="${index}">
        <div class="botcfg-head">
          ${botAvatar(bot)}
          <strong>${esc(bot.name || "Bot")}</strong>
          <span class="chip">${bot.servers || 0} serveur(s)</span>
          <div class="botcfg-move">
            <button type="button" class="btn ghost small" data-action="bot-move" data-dir="-1" ${index === 0 ? "disabled" : ""}>▲</button>
            <button type="button" class="btn ghost small" data-action="bot-move" data-dir="1" ${index === bots.length - 1 ? "disabled" : ""}>▼</button>
            <button type="button" class="btn small" data-action="bot-test">🔌 Tester</button>
            ${inviteUrl(bot) ? `<button type="button" class="btn small" data-action="invite-bot" data-bot-id="${esc(bot.id)}">🔗 Lien d'invitation</button>` : ""}
            <button type="button" class="btn danger small" data-action="bot-remove">🗑</button>
          </div>
        </div>
        <div class="form-grid">
          <div class="field"><label>Nom affiché</label><input class="input" data-f="name" value="${esc(bot.name || "")}" placeholder="Colmar RP"></div>
          <div class="field"><label>Étiquette</label><input class="input" data-f="tag" value="${esc(bot.tag || "")}" placeholder="BOT RP"></div>
          <div class="field"><label>Couleur</label><select class="select" data-f="accent">${ACCENTS.map(a => `<option value="${a.value}"${(bot.accent || "cyan") === a.value ? " selected" : ""}>${a.label}</option>`).join("")}</select></div>
          <div class="field full"><label>Description</label><input class="input" data-f="description" value="${esc(bot.description || "")}" placeholder="Ce que fait ce bot"></div>
          <div class="field"><label>1️⃣ Nom chez l'agent</label>${agentNameField(bot)}
            <span class="field-note">Le nom EXACT du bot chez votre agent (dossier <code>bots/&lt;nom&gt;</code>). C'est ce qui relie le site au bot.</span></div>
          <div class="field"><label>2️⃣ Client ID Discord <span style="color:var(--muted-2);font-weight:400">(facultatif)</span></label>
            <input class="input" data-f="clientId" value="${esc(bot.clientId || "")}" placeholder="1528910533183541308" inputmode="numeric">
            <span class="field-note">${clientIdNote(bot.clientId)}</span></div>
        </div>
      </div>`).join("");
    const etatAgent = ui.agentBots === null
      ? `<div class="row" style="border-color:rgba(243,200,106,.45)">⏳ Recherche de votre agent…</div>`
      : (Array.isArray(ui.agentBots) && ui.agentBots.length
        ? `<div class="row" style="border-color:rgba(47,227,139,.45)">✅ <b>Agent joignable</b><span style="color:var(--muted)">${ui.agentBots.length} bot(s) détecté(s) : ${ui.agentBots.map(b => esc(b.nom)).join(" · ")}. Choisissez-les dans la liste déroulante ci-dessous.</span></div>`
        : `<div class="row" style="border-color:rgba(255,92,116,.45);flex-direction:column;align-items:flex-start;gap:6px">
             <b>❌ Agent injoignable — la synchronisation ne peut pas fonctionner</b>
             <span style="color:var(--muted)">${esc(ui.agentErreur || "Renseignez l'adresse et la clé dans l'encadré ci-dessous.")}</span>
             <span style="color:var(--muted);font-size:12px">Corrigez-les dans « 🔗 Connexion à votre agent » juste en dessous — aucun fichier à modifier.</span>
           </div>`);
    return `
      <div class="builder-hint">🤖 <b>3 étapes</b> : 1) connectez votre agent ci-dessous · 2) choisissez le bot dans la liste · 3) <b>Enregistrer</b> puis <b>Synchroniser</b>.</div>
      ${etatAgent}
      ${agentConfigPanel()}
      <section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>❓ Où trouver chaque valeur</h3><p>Les deux champs viennent d'endroits différents — voici lesquels.</p></div></div>
        <div class="row" style="flex-direction:column;align-items:flex-start;gap:7px">
          <span><b>1️⃣ Nom chez l'agent</b> — le nom du bot dans <b>votre panel</b> (Gestionnaire de bots), c'est-à-dire le dossier <code>bots/&lt;nom&gt;</code> chez votre hébergeur. Exemple : <code>colmar_rp</code>. <b>Ce n'est pas</b> le nom affiché sur le site.</span>
          <span><b>2️⃣ Client ID Discord</b> — l'<b>Application ID</b> du bot, dans le <b>Portail développeur Discord</b> (17 à 20 chiffres). Exemple : <code>1528910533183541308</code>. <b>Ce n'est ni l'IP, ni le port de votre agent.</b> Laissez vide : la synchronisation le remplit toute seule.</span>
        </div>
      </div></section>
      <div style="height:16px"></div>
      <section class="panel"><div class="panel-inner">
        <div class="panel-head"><div><h3>Mes bots</h3><p>${bots.length} bot(s) déclaré(s) — aucune limite.</p></div>
          <div class="page-actions">${button("🔄 Synchroniser avec l'agent", "bots-sync", "ghost")}${button("💾 Enregistrer les bots", "bots-save", "success")}</div></div>
        <div id="bots-list">${rows || emptyBlock("Aucun bot", "Ajoutez votre premier bot ci-dessous.")}</div>
        <div style="margin-top:12px">${button("➕ Ajouter un bot", "bot-add", "primary")}</div>
      </div></section>
      <section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>🔎 Bots vus chez l'agent</h3><p>La liste exacte des dossiers <code>bots/&lt;nom&gt;</code> de votre hébergeur.</p></div>
          <div class="page-actions">${button("🔎 Rafraîchir la liste", "agent-bots", "ghost")}</div></div>
        <div id="agent-bots" style="margin-top:12px"></div>
        <div id="sync-report" style="margin-top:12px"></div>
      </div></section>`;
  }

  // ── 🔗 Connexion à l'agent, saisie DANS le site (plus de config.php) ──
  // La clé n'est jamais renvoyée au navigateur : le champ reste vide et,
  // laissé vide, conserve la clé déjà enregistrée côté serveur.
  function agentConfigPanel() {
    const r = ui.agentReglages || {};
    const origines = {
      "saisi dans le site": "✅ enregistrée depuis cette page",
      "config.php du site": "📄 lue dans config.php",
      "aucune": "⚠️ aucune adresse pour l'instant",
    };
    const origine = origines[r.origine] || (r.origine ? `📄 ${esc(r.origine)}` : "…");
    const alerteEcriture = r.modifiable === false
      ? `<div class="row" style="border-color:rgba(255,92,116,.45)">🚫 <b>Dossier <code>data/</code> non inscriptible</b><span style="color:var(--muted)">Impossible d'enregistrer ici. Donnez les droits d'écriture au dossier <code>data</code> (chmod 775) chez votre hébergeur.</span></div>`
      : "";
    return `
      <section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>🔗 Connexion à votre agent</h3>
          <p>Collez les deux valeurs ici, cliquez sur « Tester et enregistrer ». <b>Aucun fichier à modifier.</b></p></div></div>
        ${alerteEcriture}
        <div class="form-grid">
          <div class="field full"><label>Adresse de l'agent</label>
            <input class="input" id="agent-url" value="${esc(r.adresse || "")}" placeholder="http://123.45.67.89:9999" spellcheck="false" autocomplete="off">
            <span class="field-note">L'<b>IP de votre serveur</b> suivie du <b>port de l'agent</b> (celui du panel de votre hébergeur).
              Le <code>http://</code> est ajouté tout seul si vous l'oubliez.
              <span style="color:var(--red)">Ce n'est ni le Client ID du bot, ni l'adresse de votre site.</span>
              État actuel : <b>${origine}</b>.</span></div>
          <div class="field full"><label>Clé de l'agent</label>
            <input class="input" id="agent-key" type="password" value="" placeholder="${r.cleEnregistree ? "•••••••• (déjà enregistrée — laissez vide pour la garder)" : "collez ici AGENT_KEY"}" spellcheck="false" autocomplete="new-password">
            <span class="field-note">C'est la valeur <code>AGENT_KEY</code> du fichier <code>config.env</code> de votre agent — la <b>même</b> que dans votre dashboard.
              ${r.cleEnregistree ? "Une clé est déjà enregistrée : laissez ce champ vide pour la conserver." : "Si votre agent n'en demande pas, laissez vide."}
              Elle est stockée hors du web et n'est jamais réaffichée.</span></div>
        </div>
        <div class="form-actions">
          ${button("🧹 Effacer", "agent-forget", "ghost")}
          ${button("🔌 Tester et enregistrer", "agent-config-save", "success")}
        </div>
        <div id="agent-config-report" style="margin-top:12px"></div>
      </div></section>`;
  }

  // ── 🔑 Connexion Discord : application + comptes autorisés ──────────
  function discordBody() {
    const d = ui.discord;
    if (!d) { chargerDiscord(); return `<div class="row">⏳ Lecture des réglages…</div>`; }
    const origines = {
      "saisi dans le site": "✅ enregistrés depuis cette page",
      "aucune": "⚠️ pas encore configurés",
    };
    const origine = origines[d.origine] || `📄 ${esc(d.origine || "")}`;
    const etat = d.clientId
      ? `<div class="row" style="border-color:rgba(47,227,139,.45)">✅ <b>Connexion Discord active</b><span style="color:var(--muted)">Application <code>${esc(d.clientId)}</code> — ${origine}. Le bouton « Se connecter » du bandeau fonctionne.</span></div>`
      : `<div class="row" style="border-color:rgba(243,200,106,.45);flex-direction:column;align-items:flex-start;gap:6px">
           <b>⚠️ Personne ne peut encore se connecter</b>
           <span style="color:var(--muted)">Renseignez les deux valeurs ci-dessous. Si votre dashboard est installé à côté, ses identifiants sont repris automatiquement.</span></div>`;
    const alerteEcriture = d.modifiable === false
      ? `<div class="row" style="border-color:rgba(255,92,116,.45)">🚫 <b>Dossier <code>data/</code> non inscriptible</b><span style="color:var(--muted)">Donnez les droits d'écriture au dossier <code>data</code> (chmod 775).</span></div>` : "";
    const admins = d.admins || [];
    const lignes = admins.length ? admins.map(id => `
      <div class="row" data-admin-id="${esc(id)}">
        <span>👑 <code>${esc(id)}</code>${MOI && MOI.id === id ? " <b>(vous)</b>" : ""}</span>
        <button type="button" class="btn danger small" data-action="admin-remove" data-id="${esc(id)}" style="margin-left:auto">Retirer</button>
      </div>`).join("")
      : `<div class="row" style="border-color:rgba(255,92,116,.45);flex-direction:column;align-items:flex-start;gap:5px">
           <b>🚨 Aucun administrateur — le site est modifiable par n'importe qui</b>
           <span style="color:var(--muted)">Connectez-vous avec Discord : le <b>premier compte</b> à le faire devient automatiquement propriétaire du site. Faites-le <b>maintenant</b>, avant de communiquer l'adresse.</span></div>`;
    return `
      <div class="builder-hint">🔑 Vos membres se connectent avec <b>leur compte Discord</b> — le même que sur vos serveurs. Aucun mot de passe à créer, aucun fichier à modifier.</div>
      ${etat}
      ${alerteEcriture}
      <section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>1️⃣ Déclarez l'adresse de retour chez Discord</h3>
          <p>À faire une seule fois, sinon Discord refusera la connexion.</p></div></div>
        <div class="row" style="flex-direction:column;align-items:flex-start;gap:7px">
          <span>Ouvrez le <b>Portail développeur Discord</b> → votre application → <b>OAuth2</b> → <b>Redirects</b> → <b>Add Redirect</b>, et collez <b>exactement</b> ceci :</span>
          <code style="user-select:all;padding:9px 12px;border-radius:8px;background:rgba(255,255,255,.06);display:block;width:100%;word-break:break-all">${esc(d.redirect || "")}</code>
          <span style="color:var(--muted)">Puis <b>Save Changes</b>. Cette adresse est détectée depuis la page que vous consultez : si vous changez de domaine, revenez la recopier.</span>
        </div>
      </div></section>
      <section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>2️⃣ Identifiants de l'application</h3>
          <p>Portail développeur Discord → votre application → OAuth2.</p></div></div>
        <div class="form-grid">
          <div class="field full"><label>Client ID</label>
            <input class="input" id="dc-id" value="${esc(d.clientId || "")}" placeholder="1528910533183541308" inputmode="numeric" autocomplete="off">
            <span class="field-note">17 à 20 chiffres. C'est le même que celui de votre bot si c'est la même application.</span></div>
          <div class="field full"><label>Clé secrète (Client Secret)</label>
            <input class="input" id="dc-secret" type="password" value="" placeholder="${d.secretEnregistre ? "•••••••• (déjà enregistrée — laissez vide pour la garder)" : "OAuth2 → Reset Secret"}" autocomplete="new-password">
            <span class="field-note">Environ 32 caractères. ⚠️ Ne la partagez <b>jamais</b> : elle donne accès à votre application. Elle est stockée hors du web et n'est jamais réaffichée.</span></div>
        </div>
        <div class="form-actions">
          ${button("🧹 Effacer", "discord-forget", "ghost")}
          ${button("🔌 Vérifier et enregistrer", "discord-save", "success")}
        </div>
        <div id="discord-report" style="margin-top:12px"></div>
      </div></section>
      ${equipeSection(d)}`;
  }

  // 3️⃣ L'équipe : un identifiant Discord = un grade. Personne d'autre
  // n'entre dans l'espace de gestion.
  function equipeSection(d) {
    const equipe = d.staff || {};
    const ids = Object.keys(equipe);
    const owner = d.owner || "";
    const bandeauOwner = d.ownerEpingle
      ? `<div class="row" style="border-color:rgba(47,227,139,.45)">👑 <b>Propriétaire épinglé</b><span style="color:var(--muted)">
           <code>${esc(owner)}</code> est propriétaire via <code>SITE_OWNER_ID</code> dans <code>config.php</code>.
           Personne ne peut lui retirer ce grade depuis le site, et aucun inconnu ne peut s'emparer du site.</span></div>`
      : `<div class="row" style="border-color:rgba(243,200,106,.45);flex-direction:column;align-items:flex-start;gap:6px">
           <b>⚠️ Aucun propriétaire épinglé</b>
           <span style="color:var(--muted)">Ouvrez <code>config.php</code> et collez votre identifiant Discord dans <code>SITE_OWNER_ID</code> :
             vous serez alors le <b>seul et unique</b> propriétaire, définitivement.
             ${MOI ? `Le vôtre : <code style="user-select:all">${esc(MOI.id)}</code>` : "Connectez-vous pour voir le vôtre."}</span></div>`;
    const lignes = ids.length ? ids.map(id => {
      const g = gradeById(equipe[id]);
      const fixe = id === owner && d.ownerEpingle;
      return `<div class="row" data-staff-id="${esc(id)}">
        <span style="min-width:190px">${fixe ? "👑" : "🎭"} <code>${esc(id)}</code>${MOI && MOI.id === id ? " <b>(vous)</b>" : ""}</span>
        <select class="select" data-staff-grade="${esc(id)}" style="max-width:230px" ${fixe ? "disabled" : ""}>
          ${GRADES.map(x => `<option value="${x.id}"${equipe[id] === x.id ? " selected" : ""}>${esc(x.label)} — ${esc(x.family)}</option>`).join("")}
        </select>
        <span style="color:${g.color};font-size:12px">${esc(g.desc)}</span>
        ${fixe ? `<span style="margin-left:auto;color:var(--muted-2);font-size:12px">verrouillé par config.php</span>`
               : `<button type="button" class="btn danger small" data-action="staff-remove" data-id="${esc(id)}" style="margin-left:auto">Retirer</button>`}
      </div>`;
    }).join("")
      : `<div class="row" style="border-color:rgba(255,92,116,.45);flex-direction:column;align-items:flex-start;gap:5px">
           <b>Personne dans l'équipe</b>
           <span style="color:var(--muted)">Tant que la liste est vide, <b>aucun visiteur</b> n'accède à l'espace de gestion (serveurs, blacklist, tickets, créateur).</span></div>`;
    return `
      <section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>3️⃣ Qui fait partie de l'équipe</h3>
          <p>Seuls ces identifiants Discord entrent dans l'espace de gestion — chacun avec son grade.</p></div>
          <div class="page-actions">${button("➕ Ajouter un membre", "staff-add", "primary")}${button("💾 Enregistrer l'équipe", "staff-save", "success")}</div></div>
        ${bandeauOwner}
        <div style="margin-top:12px">${lignes}</div>
        <span class="field-note" style="display:block;margin-top:10px">
          Un visiteur non listé voit uniquement la <b>page d'accueil publique</b> : ni les tickets, ni la blacklist, ni les serveurs — le serveur ne les lui envoie même pas.
          Pour obtenir l'identifiant de quelqu'un : Discord → Paramètres → Avancés → <b>Mode développeur</b>, puis clic droit sur la personne → <b>Copier l'identifiant</b>.
        </span>
      </div></section>`;
  }

  // ── 🗄️ Base de données ──────────────────────────────────────────────
  function dbBody() {
    const d = ui.db;
    if (!d) { chargerDb(); return `<div class="row">⏳ Lecture de la configuration…</div>`; }
    const sqlite = d.type === "sqlite";
    const etat = d.active
      ? `<div class="row" style="border-color:rgba(47,227,139,.45);flex-direction:column;align-items:flex-start;gap:6px">
           <b>✅ Base connectée — vos données y sont enregistrées</b>
           <span style="color:var(--muted)">${d.stats ? `${d.stats.blacklist} sanction(s) · ${d.stats.preuves} preuve(s) · ${d.stats.tickets} ticket(s) · ${d.stats.ticket_messages} message(s) · ${d.stats.activite} ligne(s) de journal` : ""}</span></div>`
      : d.configuree
        ? `<div class="row" style="border-color:rgba(255,92,116,.45);flex-direction:column;align-items:flex-start;gap:6px">
             <b>❌ Base configurée mais injoignable</b>
             <span style="color:var(--muted)">${esc(d.erreur || "")}</span>
             <span style="color:var(--muted);font-size:12px">Le site continue de lire <code>data/app.json</code> en attendant, mais <b>toute modification sera refusée</b>.</span></div>`
        : `<div class="row" style="border-color:rgba(243,200,106,.45);flex-direction:column;align-items:flex-start;gap:6px">
             <b>💾 Aucune base configurée</b>
             <span style="color:var(--muted)">Le site fonctionne sur le fichier <code>data/app.json</code>. C'est suffisant pour démarrer, mais une base encaisse bien mieux la montée en charge et se sauvegarde plus facilement.</span></div>`;
    const manque = !d.pilotes.mysql
      ? `<div class="row mt-16" style="border-color:rgba(243,200,106,.45)">⚠️ <span style="color:var(--muted)">Votre hébergeur n'a pas l'extension PHP <code>pdo_mysql</code> : MySQL est indisponible. ${d.pilotes.sqlite ? "SQLite reste possible." : ""}</span></div>`
      : "";
    return `
      <div class="builder-hint">🗄️ Tout ce que le site enregistre — sanctions, preuves, tickets, messages, archives, journal, thème et page d'accueil — part dans votre base. <b>L'import de vos données actuelles est automatique</b> à la première connexion.</div>
      ${etat}
      ${manque}
      ${d.modifiable === false ? `<div class="row mt-16" style="border-color:rgba(255,92,116,.45)">🚫 <b>Dossier <code>data/</code> non inscriptible</b><span style="color:var(--muted)">chmod 775 sur le dossier <code>data</code>.</span></div>` : ""}
      <section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>Connexion</h3><p>Les valeurs viennent du panel de votre hébergeur, section « Bases de données ».</p></div></div>
        <div class="form-grid">
          <div class="field full"><label>Type de base</label>
            <select class="select" id="db-type" data-bascule="db">
              <option value="mysql"${!sqlite ? " selected" : ""}${!d.pilotes.mysql ? " disabled" : ""}>MySQL / MariaDB (recommandé)</option>
              <option value="sqlite"${sqlite ? " selected" : ""}${!d.pilotes.sqlite ? " disabled" : ""}>SQLite (un simple fichier, sans serveur)</option>
            </select>
            <span class="field-note">MySQL si votre hébergeur vous en fournit une. SQLite si vous n'avez pas de serveur de base : tout tient dans un fichier de <code>data/</code>.</span></div>
        </div>
        <div class="form-grid db-mysql" style="${sqlite ? "display:none" : ""}">
          <div class="field"><label>Hôte</label>
            <input class="input" id="db-hote" value="${esc(d.hote || "")}" placeholder="game1.exemple.fr" spellcheck="false" autocomplete="off">
            <span class="field-note">Vous pouvez coller <code>serveur:port</code> d'un bloc : le port sera séparé tout seul.</span></div>
          <div class="field"><label>Port</label>
            <input class="input" id="db-port" value="${esc(String(d.port || 3306))}" inputmode="numeric">
            <span class="field-note">3306 pour MySQL, sauf indication contraire.</span></div>
          <div class="field"><label>Nom de la base</label>
            <input class="input" id="db-base" value="${esc(d.base || "")}" placeholder="nom_de_votre_base" spellcheck="false" autocomplete="off"></div>
          <div class="field"><label>Nom d'utilisateur</label>
            <input class="input" id="db-user" value="${esc(d.utilisateur || "")}" placeholder="utilisateur_de_la_base" spellcheck="false" autocomplete="off"></div>
          <div class="field full"><label>Mot de passe</label>
            <input class="input" id="db-mdp" type="password" value="" placeholder="${d.motDePasseEnregistre ? "•••••••• (déjà enregistré — laissez vide pour le garder)" : "mot de passe de la base"}" autocomplete="new-password">
            <span class="field-note">Stocké hors d'atteinte du web et jamais réaffiché. ⚠️ Ne le partagez avec personne.</span></div>
        </div>
        <div class="form-grid db-sqlite" style="${sqlite ? "" : "display:none"}">
          <div class="field full"><label>Fichier de la base</label>
            <input class="input" id="db-fichier" value="${esc(d.fichier || "")}" placeholder="data/site.sqlite" spellcheck="false">
            <span class="field-note">Laissez tel quel si vous ne savez pas : le fichier sera créé dans <code>data/</code>.</span></div>
        </div>
        <div class="form-actions">
          ${d.configuree ? button("🧹 Revenir au fichier JSON", "db-forget", "ghost") : ""}
          ${button("🔌 Tester et enregistrer", "db-save", "success")}
        </div>
        <div id="db-rapport" style="margin-top:12px"></div>
      </div></section>
      <section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>❓ Ce qui est enregistré, et où</h3></div></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Table</th><th>Contenu</th></tr></thead><tbody>
          <tr><td><code>blacklist</code></td><td>Une ligne par sanction (pseudo, identifiant Discord, motif, gravité, serveur, auteur, date)</td></tr>
          <tr><td><code>preuves</code></td><td>Une ligne par fichier joint, rattachée à sa sanction</td></tr>
          <tr><td><code>tickets</code></td><td>Tickets en cours <b>et</b> archivés (colonne <code>archive</code>)</td></tr>
          <tr><td><code>ticket_messages</code></td><td>Chaque message d'un ticket, dans l'ordre</td></tr>
          <tr><td><code>activite</code></td><td>Journal des actions du site</td></tr>
          <tr><td><code>kv</code></td><td>Thème, page d'accueil, bots, serveurs, permissions</td></tr>
        </tbody></table></div>
        <span class="field-note" style="display:block;margin-top:10px">Les <b>fichiers</b> de preuve restent dans <code>uploads/proofs/</code> : la base ne stocke que leur nom. Pensez à les sauvegarder aussi.</span>
      </div></section>`;
  }

  async function chargerDb() {
    try {
      const r = await api("db.config", { lire: true });
      ui.db = r.db;
    } catch (e) {
      ui.db = { type: "mysql", pilotes: { mysql: true, sqlite: true }, erreur: e.message, configuree: false, active: false };
    }
    if (ui.creatorTab === "db") render();
  }

  // ── 🔄 Mises à jour du site et des bots ─────────────────────────────
  function majBody() {
    const m = ui.maj;
    if (!m) { chargerMaj(); return `<div class="row">⏳ Recherche de la dernière version…</div>`; }
    const dispo = m.disponible;
    const etat = m.erreur
      ? `<div class="row" style="border-color:rgba(255,92,116,.45);flex-direction:column;align-items:flex-start;gap:6px">
           <b>❌ Impossible de vérifier les mises à jour</b><span style="color:var(--muted)">${esc(m.erreur)}</span></div>`
      : dispo
        ? `<div class="row" style="border-color:rgba(243,200,106,.45);flex-direction:column;align-items:flex-start;gap:6px">
             <b>🎉 Une nouvelle version est disponible : ${esc(m.derniere)}</b>
             <span style="color:var(--muted)">Vous êtes en <b>${esc(m.installee)}</b>. La mise à jour remplace les fichiers du site et relance tous vos bots à la même version.</span></div>`
        : `<div class="row" style="border-color:rgba(47,227,139,.45)">✅ <b>Tout est à jour</b><span style="color:var(--muted)">Version ${esc(m.installee)} — la plus récente publiée.</span></div>`;
    const obstacles = [];
    if (!m.zipDispo) obstacles.push("L'extension PHP <b>zip</b> manque chez votre hébergeur : le site ne peut pas se remplacer tout seul (les bots, eux, se mettent quand même à jour).");
    if (!m.siteModifiable) obstacles.push("Le dossier du site n'est pas modifiable par PHP : donnez-lui les droits d'écriture, sinon la mise à jour du site échouera.");
    return `
      <div class="builder-hint">🔄 Le site va chercher la dernière version publiée sur GitHub, se met à jour <b>lui-même</b>, puis demande à l'agent de mettre à jour <b>tous les bots</b> qu'il pilote — d'un seul coup.</div>
      ${etat}
      ${obstacles.map(o => `<div class="row mt-16" style="border-color:rgba(243,200,106,.45)">⚠️ <span style="color:var(--muted)">${o}</span></div>`).join("")}
      <section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>⚡ Mise à jour automatique</h3>
          <p>Activée, le site se met à jour tout seul dès qu'une version sort — et aligne vos bots dans la foulée.</p></div></div>
        <div class="row">
          <button type="button" class="toggle ${m.auto ? "on" : ""}" data-action="maj-auto" aria-label="Mise à jour automatique"></button>
          <span style="color:var(--muted)">${m.auto
            ? "✅ <b>Activée</b> — la vérification a lieu au plus une fois toutes les 6 heures, lors d'une visite du site (un hébergeur mutualisé n'a pas de tâche planifiée)."
            : "⚪ Désactivée — vous mettez à jour à la main avec le bouton ci-dessous."}</span>
        </div>
        ${m.derniereMaj ? `<div class="row mt-16"><span style="color:var(--muted)">Dernier passage : ${esc(new Date(m.derniereMaj * 1000).toLocaleString("fr-FR"))}${m.message ? ` — ${esc(m.message)}` : ""}</span></div>` : ""}
      </div></section>
      <section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>▶️ Mettre à jour maintenant</h3>
          <p>Le site puis tous les bots déclarés, dans cet ordre.</p></div>
          <div class="page-actions">
            ${button("🤖 Les bots seulement", "maj-bots", "ghost")}
            ${button("🔄 Tout mettre à jour", "maj-tout", "success")}
          </div></div>
        <div class="row" style="flex-direction:column;align-items:flex-start;gap:5px">
          <span style="color:var(--muted)">Vos données sont préservées : <code>data/</code>, <code>uploads/</code> et <code>config.php</code> ne sont jamais écrasés.</span>
          <span style="color:var(--muted)">Chaque bot est arrêté, mis à jour, puis relancé par l'agent — quelques secondes d'interruption.</span>
        </div>
        <div id="maj-rapport" style="margin-top:12px"></div>
      </div></section>`;
  }

  async function chargerMaj() {
    try {
      const r = await api("maj.etat");
      ui.maj = r.maj;
    } catch (e) {
      ui.maj = { installee: "inconnue", derniere: "", erreur: e.message, zipDispo: true, siteModifiable: true };
    }
    if (ui.creatorTab === "maj") render();
  }

  async function chargerDiscordStaff() {
    try {
      const r = await api("discord.staff", { lire: true });
      if (ui.discord) Object.assign(ui.discord, { staff: r.staff, owner: r.owner, ownerEpingle: r.ownerEpingle });
    } catch (_) { /* la section affichera l'état par défaut */ }
  }

  // ── 🔐 Permissions par grade + aperçu ───────────────────────────────

  async function chargerDiscord() {
    try {
      const r = await api("discord.config", { lire: true });
      ui.discord = r.discord;
      await chargerDiscordStaff();
    } catch (e) {
      ui.discord = { clientId: "", admins: [], redirect: DISCORD.redirect || "", erreur: e.message };
    }
    if (ui.creatorTab === "discord") render();
  }

  // ── 🔐 Permissions par grade + aperçu ───────────────────────────────
  function permissionsBody() {
    const perms = permissions();
    const cats = [...new Set(FEATURES.map(f => f.cat))];
    const previewBar = `
      <section class="panel"><div class="panel-inner">
        <div class="panel-head"><div><h3>👁 Aperçu par grade</h3><p>Choisissez un grade : le site n'affiche plus que ce que ce grade peut voir (menu, pages et modules).</p></div></div>
        <div class="gradepick">
          <button class="gradechip ${!ui.previewGrade ? "on" : ""}" data-action="preview-grade" data-grade="">🔓 Aucun (tout voir)</button>
          ${GRADES.map(g => `<button class="gradechip ${ui.previewGrade === g.id ? "on" : ""}" data-action="preview-grade" data-grade="${g.id}" style="--gc:${g.color}">
            <b>${esc(g.label)}</b><span>${esc(g.family)}</span></button>`).join("")}
        </div>
        ${ui.previewGrade ? `<div class="previewnote">🎭 Aperçu actif : <b style="color:${gradeById(ui.previewGrade).color}">${esc(gradeById(ui.previewGrade).label)}</b> — ${esc(gradeById(ui.previewGrade).desc)}. ${countVisible()} fonction(s) visible(s) sur ${FEATURES.length}.</div>` : ""}
      </div></section>`;
    const table = cats.map(cat => {
      const rows = FEATURES.filter(f => f.cat === cat).map(f => `
        <div class="permrow ${ui.previewGrade && !gradeCan(f.id) ? "hidden-for-grade" : ""}" data-feature="${esc(f.id)}">
          <div class="perminfo"><strong>${esc(f.label)}</strong><span>${esc(f.desc)}</span></div>
          <div class="permgrades">
            ${GRADES.map(g => `<button type="button" class="gtoggle ${(perms[f.id] || []).includes(g.id) ? "on" : ""}"
              data-action="perm-toggle" data-grade="${g.id}" style="--gc:${g.color}" title="${esc(g.label)} — ${esc(g.family)}">${esc(g.label)}</button>`).join("")}
          </div>
        </div>`).join("");
      return `<section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>${cat}</h3><p>Cliquez sur un grade pour l'autoriser ou le retirer.</p></div>
        <div class="page-actions">${button("Tout cocher", "perm-all", "ghost small", `data-cat="${esc(cat)}"`)}${button("Tout décocher", "perm-none", "ghost small", `data-cat="${esc(cat)}"`)}</div></div>
        ${rows}
      </div></section>`;
    }).join("");
    return `
      <div class="builder-hint">🔐 Chaque fonction du bot et chaque page du site peut être réservée aux grades de votre choix — <b>grades du serveur</b> (Membre, Police, Staff, Admin) et <b>grades de l'équipe du bot</b> (Support, Modérateur, Responsable, Créateur).</div>
      ${previewBar}
      ${table}
      <div class="form-actions" style="position:sticky;bottom:14px">
        ${button("↺ Rétablir les valeurs du bot", "perm-reset", "ghost")}
        ${button("💾 Enregistrer les permissions", "perm-save", "success")}
      </div>`;
  }
  function countVisible() {
    return FEATURES.filter(f => gradeCan(f.id)).length;
  }
  // Lit les permissions depuis les cases affichées.
  function collectPermissions() {
    const out = {};
    document.querySelectorAll(".permrow[data-feature]").forEach(row => {
      out[row.dataset.feature] = Array.from(row.querySelectorAll(".gtoggle.on")).map(el => el.dataset.grade);
    });
    return out;
  }

  // Interroge l'agent pour connaître les bots disponibles (sans bloquer l'UI).
  async function chargerBotsAgent() {
    try {
      const r = await api("agent.bots");
      ui.agentBots = r.bots || [];
      ui.agentErreur = null;
      if (r.reglages) ui.agentReglages = r.reglages;
    } catch (e) {
      ui.agentBots = [];
      ui.agentErreur = e.message;
      // Même en échec, le serveur renvoie l'adresse retenue : le formulaire
      // de connexion s'affiche pré-rempli avec ce qui a été essayé.
      if (e.data && e.data.reglages) ui.agentReglages = e.data.reglages;
    }
    if (ui.creatorTab === "bots") render();
  }

  // Lit la liste des bots depuis les champs affichés.
  function collectBots() {
    return Array.from(document.querySelectorAll(".botcfg")).map(card => {
      const get = f => card.querySelector(`[data-f="${f}"]`)?.value.trim() || "";
      const index = Number(card.dataset.botIndex);
      const existing = (state.bots || [])[index] || {};
      return { ...existing, name: get("name"), tag: get("tag"), accent: get("accent"), description: get("description"), agentName: get("agentName"), clientId: get("clientId") };
    }).filter(bot => bot.name);
  }

  // ── Constructeur de page : liste des blocs + ajout ──────────────────
  function pageBuilderBody() {
    const blocks = pageBlocks();
    const rows = blocks.map((block, index) => {
      const type = BLOCK_TYPES[block.type];
      if (!type) return "";
      const count = Object.values(block.props || {}).filter(Array.isArray)[0]?.length;
      return `<div class="blk-row" data-block-id="${esc(block.id)}">
        <span class="blk-index">${String(index + 1).padStart(2, "0")}</span>
        <div class="blk-info"><strong>${type.label}</strong><span>${esc(block.props?.title || block.props?.text || type.desc)}${count != null ? ` · ${count} élément(s)` : ""}</span></div>
        <div class="blk-actions">
          <button class="btn ghost small" data-action="block-move" data-dir="-1" ${index === 0 ? "disabled" : ""}>▲</button>
          <button class="btn ghost small" data-action="block-move" data-dir="1" ${index === blocks.length - 1 ? "disabled" : ""}>▼</button>
          <button class="btn small" data-action="block-edit">✏️ Modifier</button>
          <button class="btn small" data-action="block-duplicate">⧉</button>
          <button class="btn danger small" data-action="block-delete">🗑</button>
        </div>
      </div>`;
    }).join("");
    const addButtons = Object.entries(BLOCK_TYPES).map(([id, type]) => `
      <button class="addblk" data-action="block-add" data-type="${id}">
        <strong>${type.label}</strong><span>${esc(type.desc)}</span>
      </button>`).join("");
    return `
      <div class="builder-hint">🧱 Composez votre page d'accueil bloc par bloc. Le bouton 👁 de la barre du haut affiche le rendu public.</div>
      <section class="panel"><div class="panel-inner">
        <div class="panel-head"><div><h3>Blocs de la page</h3><p>${blocks.length} bloc(s) — glissez-les avec ▲▼, modifiez leur contenu, dupliquez ou supprimez.</p></div>
          <div class="page-actions">${button("👁 Voir le rendu", "preview-gate", "ghost")}${button("💾 Enregistrer la page", "save-blocks", "success")}</div></div>
        <div id="block-list">${rows || emptyBlock("Page vide", "Ajoutez votre premier bloc ci-dessous.")}</div>
      </div></section>
      <section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>➕ Ajouter un bloc</h3><p>Cliquez pour l'ajouter à la fin de la page.</p></div></div>
        <div class="addblk-grid">${addButtons}</div>
      </div></section>`;
  }

  // Éditeur d'un bloc (modale générée depuis la description des champs).
  function openBlockEditor(blockId) {
    const blocks = pageBlocks();
    const block = blocks.find(item => item.id === blockId);
    if (!block) return;
    const type = BLOCK_TYPES[block.type];
    const p = block.props || {};
    const body = type.fields.map(field => {
      if (field.t === "textarea") return textAreaField(field.k, field.l, p[field.k] || "", field.note || "");
      if (field.t === "list") {
        const items = Array.isArray(p[field.k]) ? p[field.k] : [];
        return `<div class="field full"><label>${esc(field.l)}</label>
          <div class="blk-items" data-list="${esc(field.k)}">
            ${items.map(item => blockItemRow(field, item)).join("")}
          </div>
          <button type="button" class="btn small" data-action="item-add" data-list="${esc(field.k)}">➕ Ajouter</button>
          ${type.hint ? `<span class="field-note">${esc(type.hint)}</span>` : ""}
        </div>`;
      }
      return inputField(field.k, field.l, p[field.k] ?? "", "text", field.note || "");
    }).join("");
    openModal(`Modifier · ${type.label}`, `
      <form data-form="block-edit" data-block-id="${esc(blockId)}">
        <div class="form-grid">${body}</div>
        <div class="form-actions"><button class="btn ghost" type="button" data-action="close-modal">Annuler</button><button class="btn success" type="submit">Appliquer</button></div>
      </form>`, true);
  }

  function blockItemRow(field, item = {}) {
    return `<div class="blk-item">
      ${field.item.map(sub => `<input class="input" data-sub="${esc(sub.k)}" placeholder="${esc(sub.l)}" value="${esc(item[sub.k] ?? "")}">`).join("")}
      <button type="button" class="btn danger small" data-action="item-remove">✕</button>
    </div>`;
  }

  function creatorEcosystem() {
    const totalMembers = (state.servers || []).reduce((s,x)=>s+x.members,0);
    return `
      <div class="grid-2">${(state.bots || []).map(bot => {
        const servers = botServers(bot.id);
        return `<section class="panel"><div class="panel-inner"><div class="panel-head"><div style="display:flex;gap:13px;align-items:center">${botAvatar(bot)}<div><h3>${esc(bot.name)}</h3><p>${esc(bot.description)}</p></div></div><span class="chip green">EN LIGNE</span></div><div class="grid-3"><div class="stat-card"><span>Serveurs</span><strong>${servers.length}</strong><em>déploiements</em></div><div class="stat-card"><span>Utilisateurs</span><strong>${formatNumber(servers.reduce((s,x)=>s+x.members,0))}</strong><em>portée</em></div><div class="stat-card"><span>Latence</span><strong>${bot.latency}</strong><em>millisecondes</em></div></div></div></section>`;
      }).join("")}</div>
      <section class="panel mt-16"><div class="panel-inner"><div class="panel-head"><div><h3>Tous les serveurs</h3><p>${state.servers?.length || 0} déploiements · ${formatNumber(totalMembers)} membres cumulés.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Serveur</th><th>Région</th><th>Membres</th><th>En ligne</th><th>Bots installés</th><th>Accès</th></tr></thead><tbody>${(state.servers || []).map(server => `<tr><td><strong>${esc(server.name)}</strong><br><span>${esc(server.id)}</span></td><td>${esc(server.region)}</td><td>${formatNumber(server.members)}</td><td>${formatNumber(server.online)}</td><td>${server.botIds.map(id => `<span class="chip">${esc(state.bots.find(bot=>bot.id===id)?.name || id)}</span>`).join(" ")}</td><td>${button("Configurer", "open-server", "small", `data-server-id="${esc(server.id)}"`)}</td></tr>`).join("")}</tbody></table></div></div></section>
      <div class="grid-3 mt-16"><div class="stat-card"><span>Disponibilité</span><strong>99.98%</strong><em>30 derniers jours</em></div><div class="stat-card"><span>Commandes exécutées</span><strong>1.24 M</strong><em>total historique</em></div><div class="stat-card"><span>Événements traités</span><strong>8.7 M</strong><em>Cardinal System</em></div></div>`;
  }

  // Corps du Site builder (réutilisé par l'onglet dédié ET par l'espace
  // Créateur, pour que le créateur construise son site sans changer de page).
  function siteBuilderBody() {
    const s = siteConfig();
    const accent = accentHex(s);
    const bgType = BG_TYPES.includes(s.bgType) ? s.bgType : "image";
    const bgChoice = (id, label, note, thumbStyle, badge = "") => `
      <div class="bg-choice ${bgType === id ? "on" : ""}" data-action="pick-bg" data-bg="${id}">
        <div class="thumb" style="${thumbStyle}">${badge ? `<span class="thumb-badge">${badge}</span>` : ""}</div>
        <strong>${label}</strong><span>${note}</span>
      </div>`;
    const identity = `<section class="panel"><div class="panel-inner"><div class="panel-head"><div><h3>🪪 Identité</h3><p>Nom, logo, sous-titre et pied de page — visibles partout.</p></div></div><div class="form-grid">
      ${inputField("siteName", "Nom du site", s.siteName || "Aincrad Control Panel")}
      ${inputField("subtitle", "Sous-titre / accroche", s.subtitle || "Sword Art Online Discord Management")}
      ${inputField("logo", "Logo (emoji ou URL d'image)", s.logo || "⚔️", "text", "Un emoji (⚔️, 🐉…) ou l'URL d'une image carrée.")}
      ${inputField("footer", "Pied de page", s.footer || "© 2026 Aincrad Corporation")}
    </div></div></section>`;
    const theme = `<section class="panel"><div class="panel-inner"><div class="panel-head"><div><h3>🎨 Thème</h3><p>Couleur, police, forme des boutons et arrondi des cartes — appliqués en direct.</p></div></div>
      <div class="form-grid">
        <div class="field"><label>Couleur d'accent</label>
          <div class="swatch-row">
            ${SWATCHES.map(c => `<span class="swatch ${accent.toLowerCase() === c ? "on" : ""}" data-action="pick-swatch" data-color="${c}" style="background:${c}"></span>`).join("")}
            <input class="input" type="color" name="accentColor" value="${esc(accent)}">
          </div>
          <span class="field-note">Cliquez une pastille ou choisissez une couleur libre.</span>
        </div>
        ${selectField("font", "Police du site", s.font || "exo", [
          { value: "exo", label: "Exo 2 (défaut)" }, { value: "orbitron", label: "Orbitron (titres futuristes)" },
          { value: "inter", label: "Inter (moderne sobre)" }, { value: "poppins", label: "Poppins (arrondie)" },
        ])}
        ${selectField("buttonStyle", "Style des boutons", s.buttonStyle || "pill", [
          { value: "pill", label: "Pilule (arrondi complet)" }, { value: "rounded", label: "Arrondi" },
          { value: "square", label: "Carré" }, { value: "cut", label: "Coins coupés (SAO)" },
        ])}
        ${inputField("radius", "Arrondi des cartes", s.radius ?? 18, "range", "", 'min="0" max="30" step="1"')}
      </div>
    </div></section>`;
    // Vignette « vidéo » : on affiche l'image de secours en fond, avec un ▶.
    const videoThumb = `background-image:url('${esc(String(s.bgImage || "assets/images/aincrad-bg.jpg").replaceAll("'", "%27"))}');background-size:cover;background-position:center`;
    const background = `<section class="panel"><div class="panel-inner"><div class="panel-head"><div><h3>🌌 Fond du site</h3><p>Une image, un GIF, <b>votre vidéo MP4</b>, ou un fond animé généré.</p></div></div>
      <div class="bg-choices">
        ${bgChoice("image", "Image / GIF", "votre visuel", `background-image:url('${esc(String(s.bgImage || "assets/images/aincrad-bg.jpg").replaceAll("'", "%27"))}')`)}
        ${bgChoice("video", "Vidéo MP4", "votre vidéo en boucle", videoThumb, "▶")}
        ${bgChoice("aurora", "Aurora", "dégradé animé", "background:radial-gradient(60% 80% at 25% 20%, rgba(169,112,255,.6), transparent 60%), radial-gradient(50% 70% at 80% 60%, rgba(79,140,255,.45), transparent 60%), #0b090e")}
        ${bgChoice("stars", "Étoiles", "ciel dérivant", "background:radial-gradient(2px 2px at 25% 30%, #fff, transparent 55%), radial-gradient(1.5px 1.5px at 60% 65%, rgba(255,255,255,.8), transparent 55%), radial-gradient(1.5px 1.5px at 80% 25%, rgba(255,255,255,.7), transparent 55%), #0b090e")}
        ${bgChoice("grid", "Grille", "trame discrète", "background:linear-gradient(rgba(169,112,255,.25) 1px, transparent 1px), linear-gradient(90deg, rgba(169,112,255,.25) 1px, transparent 1px), #0b090e; background-size:11px 11px")}
        ${bgChoice("none", "Uni", "couleur sombre", "background:#0b090e")}
      </div>
      <input type="hidden" name="bgType" value="${esc(bgType)}">
      <div class="form-grid mt-22">
        <div class="field full bg-only-video">
          <label>Adresse de la vidéo (MP4 / WEBM)</label>
          <input class="input" name="bgVideo" value="${esc(s.bgVideo || "")}" placeholder="uploads/backgrounds/ma-video.mp4">
          <span class="field-note">Téléversez un fichier juste en dessous (le champ se remplit tout seul), ou collez une adresse se terminant par <code>.mp4</code>. La vidéo tourne <b>en boucle et sans son</b>.</span>
        </div>
        ${inputField("bgImage", "Image de fond", s.bgImage || "assets/images/aincrad-bg.jpg", "text", "Fond « Image / GIF » — et, en mode vidéo, l'image affichée le temps que la vidéo se charge.")}
        ${inputField("bgOverlay", "Assombrissement du fond", s.bgOverlay ?? 62, "range", "0 = fond pur, 92 = presque noir. Indispensable pour garder le texte lisible sur une vidéo.", 'min="0" max="92" step="1"')}
        ${inputField("bgBlur", "Flou du fond", s.bgBlur ?? 0, "range", "0 à 24 pixels.", 'min="0" max="24" step="1"')}
      </div>
      <div class="row mt-16 bg-only-video" style="flex-direction:column;align-items:flex-start;gap:5px">
        <span><b>ℹ️ Bon à savoir sur une vidéo de fond</b></span>
        <span style="color:var(--muted)">Elle est <b>toujours muette</b> et en boucle : aucun navigateur ne lance tout seul une vidéo avec du son.</span>
        <span style="color:var(--muted)">Elle est téléchargée par <b>chaque visiteur</b> — visez <b>court et compressé</b> (quelques Mo), sous peine de ralentir votre site.</span>
        <span style="color:var(--muted)">Si le visiteur a coupé les animations (section ✨ Effets), la vidéo reste figée sur sa première image.</span>
      </div>
    </div></section>`;
    // Le téléversement est un formulaire séparé (un <form> ne peut pas en
    // contenir un autre) — affiché juste sous la section « Fond du site ».
    const limite = window.AINCRAD_UPLOAD_MAX || "";
    const uploadSection = `<section class="panel mt-16"><div class="panel-inner"><div class="panel-head"><div><h3>📤 Téléverser un fond</h3><p>Depuis votre PC — image (10 Mo max) ou <b>vidéo MP4 / WEBM</b> (60 Mo max). Appliqué immédiatement.</p></div></div>
      <form data-form="bg-upload" enctype="multipart/form-data" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <input class="input" type="file" name="background" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" required style="max-width:340px">
        <button class="btn primary" type="submit">Téléverser et appliquer</button>
      </form>
      <span class="field-note" style="display:block;margin-top:8px">Un MP4 devient automatiquement le fond vidéo ; une image devient le fond image.${
        limite ? ` Votre hébergeur limite chaque envoi à <b>${esc(limite)}</b> — au-delà, hébergez la vidéo ailleurs et collez son adresse.` : ""}</span>
    </div></section>`;
    const navigation = `<section class="panel"><div class="panel-inner"><div class="panel-head"><div><h3>🧭 Navigation</h3><p>Renommez, masquez et réordonnez les onglets du menu. Le Site builder reste toujours accessible.</p></div></div>
      <div id="nav-builder">
        ${navConfig().map((item, index, list) => `
          <div class="navbuild-row" data-nav-id="${esc(item.id)}">
            <div class="navbuild-move">
              <button type="button" class="btn ghost" data-action="nav-move" data-dir="-1" ${index === 0 ? "disabled" : ""}>▲</button>
              <button type="button" class="btn ghost" data-action="nav-move" data-dir="1" ${index === list.length - 1 ? "disabled" : ""}>▼</button>
            </div>
            <input class="input navbuild-label" value="${esc(item.label)}" maxlength="40">
            <button type="button" class="toggle navbuild-show ${item.show !== false ? "on" : ""}" data-action="nav-toggle" aria-label="Afficher ou masquer cet onglet" ${item.id === "site-config" ? "disabled title='Toujours visible'" : ""}></button>
          </div>`).join("")}
      </div>
    </div></section>`;
    const effects = `<section class="panel"><div class="panel-inner"><div class="panel-head"><div><h3>✨ Effets & comportement</h3><p>Chaque effet s'active ou se coupe indépendamment.</p></div></div>
      <div class="grid-2"><div>
        ${toggleField("animations", s.animations !== false, "Animations", "Transitions, apparitions et effets lumineux.")}
        ${toggleField("particles", s.particles !== false, "Particules flottantes", "Fragments lumineux en arrière-plan.")}
        ${toggleField("scanline", s.scanline !== false, "Balayage lumineux", "Ligne de scan qui traverse l'écran.")}
        ${toggleField("cursorAura", s.cursorAura !== false, "Aura du curseur", "Halo lumineux qui suit la souris.")}
      </div><div>
        ${toggleField("bootScreen", s.bootScreen !== false, "Écran de démarrage", "Séquence d'initialisation à l'ouverture.")}
        ${toggleField("compactMode", !!s.compactMode, "Mode compact", "Réduit les espacements sur grands écrans.")}
        ${toggleField("maintenance", !!s.maintenance, "Maintenance publique", "Affiche une alerte aux utilisateurs non-staff.")}
        ${toggleField("publicStatus", s.publicStatus !== false, "Statut public", "Autorise l'affichage de l'état des bots.")}
      </div></div>
    </div></section>`;
    const boot = `<section class="panel"><div class="panel-inner"><div class="panel-head"><div><h3>⏳ Écran de chargement</h3><p>Ce que vos visiteurs voient à l'ouverture du site — texte, logo, durée et anneau.</p></div>
      <div class="page-actions">${button("👁 Le revoir", "replay-boot", "ghost small")}</div></div>
      <div class="form-grid">
        ${inputField("bootTitle", "Titre", s.bootTitle ?? "INITIALISATION", "text", "Affiché en gros sous le logo.")}
        ${inputField("bootSubtitle", "Sous-titre", s.bootSubtitle ?? "Chargement du système…")}
        ${inputField("bootLogo", "Logo de l'écran", s.bootLogo ?? "", "text", "Emoji ou URL d'image. Vide = le logo du site.")}
        ${inputField("bootDuration", "Durée d'affichage (ms)", s.bootDuration ?? 650, "range", "0 = disparaît aussitôt, 4000 = 4 secondes.", 'min="0" max="4000" step="50"')}
      </div>
      <div class="mt-16">${toggleField("bootRing", s.bootRing !== false, "Anneau animé", "Le cercle lumineux qui tourne autour du logo.")}</div>
    </div></section>`;
    const advanced = `<section class="panel"><div class="panel-inner"><div class="panel-head"><div><h3>🧪 CSS personnalisé</h3><p>Pouvoir total : ce CSS est injecté tel quel sur tout le site (20 000 caractères max).</p></div></div>
      ${textAreaField("customCss", "Votre CSS", s.customCss || "", "Exemple : .panel { border-width: 2px; }  ·  body { letter-spacing: .02em; }")}
    </div></section>`;
    return `<div class="builder-hint">💡 Chaque réglage se prévisualise <b>en direct</b> pendant que vous le modifiez. « Enregistrer » l'applique pour tout le monde.</div>
      <form data-form="site-config" id="site-builder-form" data-bgtype="${esc(bgType)}">${identity}<div class="mt-16">${theme}</div><div class="mt-16">${background}</div><div class="mt-16">${boot}</div><div class="mt-16">${navigation}</div><div class="mt-16">${effects}</div><div class="mt-16">${advanced}</div>
      <div class="form-actions"><button class="btn ghost" type="button" data-action="reset-site-config">Annuler les modifications</button><button class="btn success" type="submit">💾 Enregistrer le site</button></div></form>
      ${uploadSection}`;
  }

  // Page « Site builder » autonome (onglet dédié du menu).
  function siteConfigView() {
    return `<div class="content-view">${pageHead("Administration / Site builder", "Construisez votre site", "Composez le site de A à Z : identité, thème, fond animé ou image, navigation, effets et CSS libre. Tout s'applique en direct — enregistrez pour le rendre permanent.")}
      ${siteBuilderBody()}
    </div>`;
  }

  // Reconstitue la configuration complète du site depuis le formulaire du
  // builder (champs + pastilles + lignes de navigation), pour l'aperçu en
  // direct comme pour l'enregistrement.
  function collectSiteConfig(form) {
    const config = formToObject(form);
    config.radius = Number(config.radius ?? 18);
    config.bgOverlay = Number(config.bgOverlay ?? 62);
    config.bgBlur = Number(config.bgBlur ?? 0);
    config.nav = Array.from(form.querySelectorAll(".navbuild-row")).map(row => ({
      id: row.dataset.navId,
      label: (row.querySelector(".navbuild-label")?.value || "").trim().slice(0, 40) || row.dataset.navId,
      show: row.querySelector(".navbuild-show")?.classList.contains("on") !== false,
    }));
    return config;
  }

  function emptyBlock(title, text) {
    return `<div class="empty"><div><strong>${esc(title)}</strong><span>${esc(text)}</span></div></div>`;
  }

  function render() {
    if (!ui.activeBotId || ui.route === "gate") renderGate();
    else renderShell();
    applySitePreferences();
    // Le menu du profil est un calque par-dessus la page, comme une pop-up :
    // il profite du même gel du décor animé (voir .overlay-open dans le CSS).
    document.body.classList.toggle("overlay-open", Boolean(ui.menuProfil) || modalRoot.innerHTML !== "");
    setTimeout(scrollChatToBottom, 0);
  }

  // Applique TOUTE la configuration du builder (accent, police, boutons,
  // rayon, fond, effets, CSS personnalisé). Accepte une config temporaire
  // pour l'aperçu en direct pendant l'édition.
  // ⚡ Écriture « seulement si ça change ».
  // Poser une variable CSS sur :root invalide le style de TOUTE la page
  // (mesuré à ~35 ms sur un téléphone d'entrée de gamme). Comme l'aperçu en
  // direct réécrit ces valeurs à chaque frappe, on compare d'abord : taper
  // dans « Nom du site » ne touche aucune couleur et ne coûte donc plus rien.
  const _css = new Map();
  function setVar(root, nom, valeur) {
    if (_css.get(nom) === valeur) return;
    _css.set(nom, valeur);
    root.style.setProperty(nom, valeur);
  }
  function setData(el, cle, valeur) {
    if (el.dataset[cle] !== valeur) el.dataset[cle] = valeur;
  }

  function applySitePreferences(cfg = siteConfig()) {
    const root = document.documentElement;
    const accent = accentHex(cfg);
    setVar(root, "--accent", accent);
    setVar(root, "--accent-rgb", hexToRgb(accent));
    const radius = Math.min(30, Math.max(0, Number(cfg.radius ?? 18)));
    setVar(root, "--radius", `${radius}px`);
    setData(document.body, "font", ["exo", "inter", "poppins", "orbitron"].includes(cfg.font) ? cfg.font : "exo");
    setData(document.body, "btnstyle", ["pill", "rounded", "square", "cut"].includes(cfg.buttonStyle) ? cfg.buttonStyle : "pill");

    // Fond du site : image téléversée / URL, vidéo MP4, ou fond animé.
    const bgType = BG_TYPES.includes(cfg.bgType) ? cfg.bgType : "image";
    setData(document.body, "bg", bgType);
    // L'assombrissement et le flou servent à l'image ET à la vidéo.
    setVar(root, "--bg-overlay", String(Math.min(92, Math.max(0, Number(cfg.bgOverlay ?? 62))) / 100));
    const flou = Math.min(24, Math.max(0, Number(cfg.bgBlur ?? 0)));
    setVar(root, "--bg-blur", `${flou}px`);
    // Marqueur lu par le CSS : sans flou, aucun filtre n'est appliqué.
    setData(document.body, "blur", flou === 0 ? "0" : "1");
    if (bgType === "image") {
      // URL absolue : dans une variable CSS, une URL relative serait résolue
      // depuis le fichier .css (assets/css/) et non depuis la page.
      let image = String(cfg.bgImage || "assets/images/aincrad-bg.jpg");
      try { image = new URL(image, document.baseURI).href; } catch (_) {}
      image = image.replaceAll('"', "%22");
      setVar(root, "--bg-image", `url("${image}")`);
    }
    appliquerVideoDeFond(bgType === "video" ? cfg : null);

    // Effets activables un par un.
    document.body.classList.toggle("reduce-effects", cfg.animations === false);
    document.body.classList.toggle("compact", cfg.compactMode === true);
    const affiche = (el, visible) => {
      const v = visible ? "block" : "none";
      if (el && el.style.display !== v) el.style.display = v;
    };
    affiche(document.querySelector("#particle-field"), cfg.particles !== false);
    affiche(document.querySelector(".scanline"), cfg.scanline !== false);
    affiche(cursorAura, cfg.cursorAura !== false);

    // CSS personnalisé du créateur (pouvoir total sur le style).
    let customTag = document.querySelector("#site-custom-css");
    if (!customTag) {
      customTag = document.createElement("style");
      customTag.id = "site-custom-css";
      document.head.appendChild(customTag);
    }
    // Réécrire ce <style> refait analyser la feuille par le navigateur :
    // on ne le touche que si le CSS a réellement changé.
    const css = String(cfg.customCss || "").slice(0, 20000);
    if (customTag.textContent !== css) customTag.textContent = css;
    const titre = cfg.siteName || "Aincrad Control Panel";
    if (document.title !== titre) document.title = titre;

    // Écran de chargement : textes, logo et anneau modifiables en direct.
    if (boot) {
      const title = boot.querySelector("strong");
      const sub = boot.querySelector("span");
      const logo = boot.querySelector(".boot-logo");
      const ring = boot.querySelector(".boot-ring");
      if (title) title.textContent = cfg.bootTitle ?? "INITIALISATION";
      if (sub) sub.textContent = cfg.bootSubtitle ?? "Chargement du système…";
      if (logo) {
        const mark = String(cfg.bootLogo || cfg.logo || "⚔️");
        logo.innerHTML = /^(https?:\/\/|uploads\/|assets\/)/.test(mark)
          ? `<img src="${esc(mark)}" alt="">` : esc(mark);
      }
      if (ring) ring.style.display = cfg.bootRing === false ? "none" : "";
    }
  }

  // ── 🎬 Vidéo de fond (MP4 / WEBM) ───────────────────────────────────
  // Passer `null` retire la vidéo. La balise est créée une seule fois et sa
  // source n'est réécrite que si elle change : sans cela, la lecture
  // repartirait de zéro à chaque frappe pendant l'aperçu en direct.
  function appliquerVideoDeFond(cfg) {
    let video = document.querySelector("#bg-video");
    if (!cfg) {
      if (video) { video.pause(); video.remove(); }
      return;
    }
    const source = String(cfg.bgVideo || "").trim();
    if (!source) {           // type « vidéo » choisi mais aucun fichier
      if (video) { video.pause(); video.remove(); }
      return;
    }
    let url = source;
    try { url = new URL(source, document.baseURI).href; } catch (_) {}
    if (!video) {
      video = document.createElement("video");
      video.id = "bg-video";
      video.className = "sky-video";
      // muted + playsinline : sans eux, les navigateurs refusent la lecture
      // automatique. loop : le fond ne doit jamais s'arrêter sur une image fixe.
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      video.setAttribute("aria-hidden", "true");
      video.preload = "auto";
      document.body.insertBefore(video, document.body.firstChild);
    }
    // Image affichée le temps que la vidéo se charge (et si elle échoue).
    const poster = String(cfg.bgImage || "");
    if (poster) { try { video.poster = new URL(poster, document.baseURI).href; } catch (_) {} }
    if (video.dataset.src !== url) {
      video.dataset.src = url;
      video.src = url;
      video.load();
    }
    // « Animations » coupées : on fige la vidéo au lieu de la faire tourner.
    if (cfg.animations === false) video.pause();
    else { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
  }

  function startClock() {
    const clock = document.querySelector("#live-clock");
    if (!clock) return;
    const update = () => {
      if (!document.body.contains(clock)) return;
      clock.textContent = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
      requestAnimationFrame(() => setTimeout(update, 900));
    };
    update();
  }

  function scrollChatToBottom() {
    const chat = document.querySelector("#chat-messages");
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  function navigate(route) {
    ui.route = route;
    ui.mobileOpen = false;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openBlacklistModal() {
    const bots = state.bots || [];
    const options = bots.map(b => `<option value="${esc(b.id)}">${esc(b.name)}${b.agentName ? "" : " — ⚠️ non relié à l'agent"}</option>`).join("");
    openModal("Ajouter à la blacklist", `
      <form data-form="blacklist-add"><div class="form-grid">
        ${inputField("username", "Nom Discord", "", "text", "Exemple : DarkBlade_X", "required")}
        ${inputField("discordId", "Identifiant Discord", "", "text", "17 à 20 chiffres.", "required pattern=\\d{15,22}")}
        ${selectField("severity", "Sévérité", "moyenne", ["faible","moyenne","élevée","critique"])}
        <div class="field">
          <label for="field-portee">Portée de la sanction</label>
          <select class="input" id="field-portee" name="portee">
            <option value="global">🌍 Globale — tous mes bots (${bots.length})</option>
            <option value="bot">🤖 Un seul bot</option>
          </select>
          <span class="field-note">Le bot bannit l'utilisateur sur <b>tous ses serveurs</b> et le re-bannit s'il tente de revenir.</span>
        </div>
        <div class="field" id="champ-bot" style="display:none">
          <label for="field-bot">Bot concerné</label>
          <select class="input" id="field-bot" name="bot">${options || `<option value="">Aucun bot enregistré</option>`}</select>
        </div>
      </div>
      ${textAreaField("reason", "Motif complet", "", "Décrivez précisément les faits, les avertissements et le contexte.")}
      <div class="field-note" style="margin-top:8px">⚠️ La sanction est appliquée sur Discord immédiatement : message privé à l'utilisateur puis bannissement.</div>
      <div class="form-actions"><button class="btn ghost" type="button" data-action="close-modal">Annuler</button><button class="btn danger" type="submit">Confirmer la sanction</button></div></form>`);
    // Le choix du bot n'apparaît que si la portée n'est pas globale.
    const portee = document.querySelector("#field-portee");
    portee?.addEventListener("change", () => {
      const champ = document.querySelector("#champ-bot");
      if (champ) champ.style.display = portee.value === "bot" ? "" : "none";
    });
  }

  // Rapport de diffusion : ce que chaque bot a réellement fait.
  function rapportDiffusion(diffusion) {
    if (!Array.isArray(diffusion) || !diffusion.length) return "";
    return `<div class="bl-diffusion">${diffusion.map(d =>
      `<div class="acc-row"><span>${d.ok ? "✅" : "❌"} ${esc(d.bot)}</span><span style="color:var(--muted)">${esc(d.message)}</span></div>`
    ).join("")}</div>`;
  }

  function openProofModal(id) {
    const entry = state.blacklist?.find(item => item.id === id);
    if (!entry) return;
    openModal(`Ajouter une preuve · ${entry.username}`, `
      <form data-form="proof-upload" data-id="${esc(id)}" enctype="multipart/form-data">
        <div class="field"><label>Fichier de preuve</label><input class="input" type="file" name="proof" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain" required><span class="field-note">PNG, JPG, WEBP, PDF ou TXT — 8 Mo maximum.</span></div>
        <div class="form-actions"><button class="btn ghost" type="button" data-action="close-modal">Annuler</button><button class="btn success" type="submit">Téléverser la preuve</button></div>
      </form>`);
  }

  function showNotifications() {
    openModal("Notifications du système", `<div class="activity-list">${activityRows()}</div>`);
  }

  function formToObject(form) {
    const result = {};
    form.querySelectorAll("[name]").forEach(field => {
      if (field.type === "checkbox") result[field.name] = field.checked;
      else if (field.type === "number") result[field.name] = field.value === "" ? 0 : Number(field.value);
      else result[field.name] = field.value;
    });
    if (form.dataset.module === "whitelist" && typeof result.jobs === "string") {
      result.jobs = result.jobs.split(",").map(item => item.trim()).filter(Boolean);
    }
    return result;
  }

  document.addEventListener("click", async event => {
    // Interrupteurs des réglages du bot : bascule immédiate, enregistrée
    // seulement au clic sur « Enregistrer dans le bot ».
    const bascule = event.target.closest("[data-cfg-toggle]");
    if (bascule) {
      bascule.classList.toggle("on");
      // L'aperçu doit suivre l'interrupteur, lui aussi (voir brouillonModule).
      if (bascule.closest('form[data-form="module-bot"]')) {
        ui.brouillonModule = ui.brouillonModule || {};
        ui.brouillonModule[bascule.dataset.cfgToggle] = bascule.classList.contains("on") ? 1 : 0;
        render();
      }
      return;
    }
    // Cases « aligné » des champs d'embed.
    const aligne = event.target.closest("[data-champ-aligne]");
    if (aligne) { aligne.classList.toggle("on"); return; }
    const target = event.target.closest("[data-action]");
    if (!target) {
      createRipple(event);
      return;
    }

    const action = target.dataset.action;
    if (action === "close-modal" && target.classList.contains("modal-layer") && event.target !== target) return;

    try {
      switch (action) {
        case "select-bot":
          ui.activeBotId = target.dataset.botId;
          storage.setItem("aincrad.activeBot", ui.activeBotId);
          ui.route = "dashboard";
          render();
          toast("LINK START", `Interface ${activeBot().name} chargée.`);
          break;
        case "switch-bot":
          ui.activeBotId = null;
          storage.removeItem("aincrad.activeBot");
          ui.route = "gate";
          render();
          break;
        case "navigate":
          navigate(target.dataset.route || "dashboard");
          break;
        case "toggle-sidebar":
          ui.mobileOpen = !ui.mobileOpen;
          document.querySelector(".sidebar")?.classList.toggle("open", ui.mobileOpen);
          break;
        case "open-server":
          ui.selectedServerId = target.dataset.serverId;
          storage.setItem("aincrad.server", ui.selectedServerId);
          ui.module = "overview";
          ui.brouillonModule = {};
          navigate("server");
          break;
        case "select-module":
          ui.module = target.dataset.module || "overview";
          ui.brouillonModule = {};   // on change de module : brouillon oublié
          render();
          break;
        case "toggle-input": {
          const row = target.closest(".toggle-row");
          const input = row?.querySelector('input[type="checkbox"]');
          if (input) {
            input.checked = !input.checked;
            target.classList.toggle("on", input.checked);
            livePreview();
          }
          break;
        }
        // ── Site builder ────────────────────────────────────────────
        case "pick-swatch": {
          const picker = document.querySelector('#site-builder-form input[name="accentColor"]');
          if (picker) picker.value = target.dataset.color;
          document.querySelectorAll(".swatch").forEach(el => el.classList.toggle("on", el === target));
          livePreview();
          break;
        }
        case "pick-bg": {
          const formBg = document.querySelector("#site-builder-form");
          const hidden = formBg?.querySelector('input[name="bgType"]');
          if (hidden) hidden.value = target.dataset.bg;
          // Fait apparaître (ou disparaître) les réglages propres à la vidéo,
          // sans reconstruire la page : les autres champs en cours d'édition
          // ne sont pas perdus.
          if (formBg) formBg.dataset.bgtype = target.dataset.bg;
          document.querySelectorAll(".bg-choice").forEach(el => el.classList.toggle("on", el === target));
          livePreview();
          break;
        }
        case "nav-toggle":
          target.classList.toggle("on");
          break;
        case "nav-move": {
          const row = target.closest(".navbuild-row");
          const list = row?.parentElement;
          if (!row || !list) break;
          const dir = Number(target.dataset.dir);
          if (dir < 0 && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
          if (dir > 0 && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
          // Réactive les flèches selon la nouvelle position.
          Array.from(list.children).forEach((item, index, all) => {
            const up = item.querySelector('[data-dir="-1"]');
            const down = item.querySelector('[data-dir="1"]');
            if (up) up.disabled = index === 0;
            if (down) down.disabled = index === all.length - 1;
          });
          break;
        }
        case "preview-gate":
        case "go-home":
          // Page d'accueil du site en restant CONNECTÉ (le bot actif est
          // conservé) — le bouton « Retour à l'administration » ramène ici.
          ui.menuProfil = false;
          ui.route = "gate";
          render();
          window.scrollTo({ top: 0, behavior: "smooth" });
          break;
        case "creator-tab":
          ui.creatorTab = target.dataset.tab;
          render();
          // À l'ouverture de « Mes bots », on interroge l'agent une fois pour
          // proposer directement les bons noms dans la liste déroulante.
          if (ui.creatorTab === "bots" && ui.agentBots === null) chargerBotsAgent();
          if (ui.creatorTab === "discord" && ui.discord === null) chargerDiscord();
          if (ui.creatorTab === "maj" && ui.maj === null) chargerMaj();
          if (ui.creatorTab === "db" && ui.db === null) chargerDb();
          break;
        case "auth-open":
          ui.menuProfil = false;
          openLoginModal();
          break;
        case "banner-close":
          ui.bandeauVu = true;
          render();
          break;
        // ── 📂 Menu du profil ───────────────────────────────────────
        case "menu-profil":
          ui.menuProfil = !ui.menuProfil;
          render();
          break;
        case "menu-profil-fermer":
          ui.menuProfil = false;
          render();
          break;
        // ── 👤 Fiche du compte connecté ─────────────────────────────
        case "account-open":
          ui.menuProfil = false;
          openAccountModal();
          break;
        case "account-copy-id": {
          const id = MOI?.id || "";
          try {
            await navigator.clipboard.writeText(id);
            toast("IDENTIFIANT COPIÉ", "Collez-le dans SITE_OWNER_ID (config.php) pour être propriétaire.");
          } catch (_) {
            // Presse-papiers refusé (page non sécurisée) : on sélectionne
            // le texte pour que la copie manuelle soit immédiate.
            const el = document.querySelector("#acc-id");
            if (el) {
              const plage = document.createRange();
              plage.selectNodeContents(el);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(plage);
            }
            toast("COPIE MANUELLE", "L'identifiant est sélectionné : faites Ctrl+C.", "error");
          }
          break;
        }
        case "account-equipe":
          closeModal();
          ui.route = "creator";
          ui.creatorTab = "discord";
          if (ui.discord === null) chargerDiscord();
          render();
          break;
        // Déconnexion, quelle que soit la façon dont on s'est connecté.
        case "deconnexion": {
          const qui = MOI ? `du compte Discord « ${MOI.nom} »` : "de l'administration";
          if (!confirm(`Se déconnecter ${qui} ?`)) break;
          if (MOI) {
            // La session Discord vit côté serveur : oauth.php la ferme.
            window.location.href = "oauth.php?p=logout";
            break;
          }
          await api("auth.logout").catch(() => {});
          AUTH.ok = false;
          closeModal();
          render();
          toast("DÉCONNEXION", "L'administration est de nouveau verrouillée.");
          break;
        }
        // Repasser par Discord pour ouvrir une autre session.
        case "account-switch":
          if (!confirm("Vous allez être déconnecté, puis renvoyé vers Discord pour choisir un autre compte. Continuer ?")) break;
          window.location.href = "oauth.php?p=logout&puis=login";
          break;
        // ── Permissions par grade ───────────────────────────────────
        case "perm-toggle":
          target.classList.toggle("on");
          break;
        case "perm-all":
        case "perm-none": {
          const on = action === "perm-all";
          target.closest(".panel").querySelectorAll(".gtoggle").forEach(el => el.classList.toggle("on", on));
          break;
        }
        case "perm-save":
          await api("site.config.save", { config: { ...siteConfig(), permissions: collectPermissions() } });
          render();
          toast("PERMISSIONS ENREGISTRÉES", "Chaque grade ne voit plus que ce que vous avez autorisé.");
          break;
        case "perm-reset": {
          if (!confirm("Rétablir les permissions par défaut du bot ?")) break;
          const defaults = {};
          FEATURES.forEach(f => { defaults[f.id] = f.g; });
          await api("site.config.save", { config: { ...siteConfig(), permissions: defaults } });
          render();
          toast("PERMISSIONS", "Valeurs par défaut du bot rétablies.");
          break;
        }
        case "replay-boot": {
          // Rejoue l'écran de chargement avec les réglages en cours d'édition.
          const form = document.querySelector("#site-builder-form");
          const cfg = form ? { ...siteConfig(), ...collectSiteConfig(form) } : siteConfig();
          applySitePreferences(cfg);
          boot.classList.remove("is-hidden");
          setTimeout(() => boot.classList.add("is-hidden"), Math.min(4000, Math.max(300, Number(cfg.bootDuration ?? 650))));
          break;
        }
        case "preview-grade":
          ui.previewGrade = target.dataset.grade || null;
          render();
          if (ui.previewGrade) toast("APERÇU", `Le site est affiché comme le voit un « ${gradeById(ui.previewGrade).label} ».`);
          break;
        // ── Gestion des bots ────────────────────────────────────────
        case "bot-add": {
          const bots = collectBots();
          bots.push({ id: "", name: "Nouveau bot", tag: "BOT", accent: ACCENTS[bots.length % ACCENTS.length].value, description: "", agentName: "", clientId: "", servers: 0, users: 0 });
          state.bots = bots;
          render();
          toast("BOT AJOUTÉ", "Renseignez son nom et son « nom chez l'agent », puis Enregistrer.");
          break;
        }
        case "bot-remove": {
          const card = target.closest(".botcfg");
          if (!card || !confirm("Retirer ce bot du site ?")) break;
          const bots = collectBots();
          bots.splice(Number(card.dataset.botIndex), 1);
          state.bots = bots;
          render();
          break;
        }
        case "bot-move": {
          const card = target.closest(".botcfg");
          const bots = collectBots();
          const index = Number(card?.dataset.botIndex);
          const next = index + Number(target.dataset.dir);
          if (next < 0 || next >= bots.length) break;
          [bots[index], bots[next]] = [bots[next], bots[index]];
          state.bots = bots;
          render();
          break;
        }
        case "bots-save":
          await api("bots.save", { bots: collectBots() });
          render();
          toast("BOTS ENREGISTRÉS", `${(state.bots || []).length} bot(s) sur votre site.`);
          break;
        case "agent-bots":
          // Relance la détection : la liste déroulante « Nom chez l'agent »
          // se remplit avec les noms exacts vus chez l'agent.
          ui.agentBots = null;
          render();
          await chargerBotsAgent();
          toast(ui.agentBots.length ? "AGENT JOIGNABLE" : "AGENT INJOIGNABLE",
            ui.agentBots.length ? `${ui.agentBots.length} bot(s) détecté(s).` : (ui.agentErreur || ""),
            ui.agentBots.length ? "success" : "error");
          break;
        // ── 🔗 Connexion à l'agent saisie dans le site ──────────────
        case "agent-config-save": {
          const url = document.querySelector("#agent-url")?.value.trim() || "";
          const key = document.querySelector("#agent-key")?.value.trim() || "";
          const box = document.querySelector("#agent-config-report");
          if (!url) { toast("ADRESSE MANQUANTE", "Indiquez http://IP-de-votre-serveur:PORT.", "error"); break; }
          const libelle = target.textContent;
          target.textContent = "⏳ Test en cours…";
          target.disabled = true;
          try {
            const r = await api("agent.config", { url, key });
            ui.agentReglages = r.reglages || ui.agentReglages;
            ui.agentBots = r.bots || [];
            ui.agentErreur = null;
            const noms = (r.bots || []).map(b => `${b.demarre ? "🟢" : "⚪"} ${esc(b.nom)}`).join(" · ");
            render();
            const cible = document.querySelector("#agent-config-report");
            if (cible) {
              cible.innerHTML = `<div class="row" style="border-color:rgba(47,227,139,.45);flex-direction:column;align-items:flex-start;gap:6px">
                <b>✅ Connecté à ${esc(r.adresse)}</b>
                <span style="color:var(--muted)">${r.bots?.length ? `${r.bots.length} bot(s) : ${noms}. Choisissez-les dans « Nom chez l'agent », puis Enregistrer et Synchroniser.` : "Aucun bot déclaré chez cet agent pour l'instant."}</span></div>`;
            }
            toast("AGENT CONNECTÉ", r.bots?.length ? `${r.bots.length} bot(s) détecté(s).` : "Connexion établie.");
          } catch (e) {
            if (box) {
              box.innerHTML = `<div class="row" style="border-color:rgba(255,92,116,.45);flex-direction:column;align-items:flex-start;gap:6px">
                <b>❌ Connexion refusée — rien n'a été enregistré</b>
                <span style="color:var(--muted)">${esc(e.message)}</span></div>`;
            }
            toast("ÉCHEC", e.message, "error");
            target.textContent = libelle;
            target.disabled = false;
          }
          break;
        }
        // ── 🔑 Connexion Discord ────────────────────────────────────
        case "discord-save": {
          const clientId = document.querySelector("#dc-id")?.value.trim() || "";
          const clientSecret = document.querySelector("#dc-secret")?.value.trim() || "";
          if (!clientId) { toast("CLIENT ID MANQUANT", "Copiez-le depuis le portail développeur Discord.", "error"); break; }
          const libelle = target.textContent;
          target.textContent = "⏳ Vérification…";
          target.disabled = true;
          try {
            const r = await api("discord.config", { clientId, clientSecret });
            await chargerDiscord();
            const box = document.querySelector("#discord-report");
            if (box) {
              box.innerHTML = `<div class="row" style="border-color:rgba(47,227,139,.45);flex-direction:column;align-items:flex-start;gap:6px">
                <b>✅ Discord a validé vos identifiants</b>
                <span style="color:var(--muted)">Rechargez la page : le bouton « Se connecter » du bandeau ouvre maintenant Discord.</span></div>`;
            }
            toast("CONNEXION DISCORD PRÊTE", "Vos membres peuvent se connecter avec leur compte.");
          } catch (e) {
            const box = document.querySelector("#discord-report");
            if (box) {
              box.innerHTML = `<div class="row" style="border-color:rgba(255,92,116,.45);flex-direction:column;align-items:flex-start;gap:6px">
                <b>❌ Refusé — rien n'a été enregistré</b><span style="color:var(--muted)">${esc(e.message)}</span></div>`;
            }
            toast("ÉCHEC", e.message, "error");
            target.textContent = libelle;
            target.disabled = false;
          }
          break;
        }
        case "discord-forget": {
          if (!confirm("Effacer les identifiants Discord ? Plus personne ne pourra se connecter tant qu'ils ne seront pas ressaisis.")) break;
          await api("discord.config", { clientId: "" });
          await chargerDiscord();
          toast("IDENTIFIANTS EFFACÉS", "Le site reprendra ceux du dashboard voisin, s'il y en a.");
          break;
        }
        // ── 🎭 L'équipe : identifiant Discord → grade ────────────────
        case "staff-add": {
          const saisi = prompt("Identifiant Discord du membre à ajouter (17 à 20 chiffres) :");
          if (!saisi) break;
          const id = saisi.replace(/\D+/g, "");
          if (id.length < 15) { toast("IDENTIFIANT INVALIDE", "Attendu : 17 à 20 chiffres (mode développeur → Copier l'identifiant).", "error"); break; }
          const equipe = { ...(ui.discord?.staff || {}) };
          if (equipe[id]) { toast("DÉJÀ DANS L'ÉQUIPE", "Ce compte y figure — changez simplement son grade."); break; }
          equipe[id] = "staff";                 // grade de départ, modifiable juste après
          await api("discord.staff", { staff: equipe });
          await chargerDiscord();
          toast("MEMBRE AJOUTÉ", "Choisissez son grade, puis « Enregistrer l'équipe ».");
          break;
        }
        case "staff-remove": {
          const id = target.dataset.id;
          if (!confirm(`Retirer ${id} de l'équipe ? Ce compte n'aura plus accès à l'espace de gestion.`)) break;
          const equipe = { ...(ui.discord?.staff || {}) };
          delete equipe[id];
          await api("discord.staff", { staff: equipe });
          await chargerDiscord();
          toast("MEMBRE RETIRÉ", `${id} n'a plus accès à l'espace de gestion.`);
          break;
        }
        case "staff-save": {
          const equipe = {};
          document.querySelectorAll("[data-staff-grade]").forEach(sel => { equipe[sel.dataset.staffGrade] = sel.value; });
          await api("discord.staff", { staff: equipe });
          await chargerDiscord();
          toast("ÉQUIPE ENREGISTRÉE", `${Object.keys(equipe).length} membre(s) — chacun avec son grade.`);
          break;
        }
        // ── 🌐 Mes serveurs ─────────────────────────────────────────
        case "serveurs-filtre":
          ui.serveursTous = target.dataset.tous === "1";
          render();
          break;
        case "bots-sync-rapide":
          target.textContent = "⏳ Synchronisation…";
          try {
            await api("agent.sync");
            await rafraichirEtat();
            render();
            toast("SYNCHRONISÉ", "Serveurs et grades remis à jour depuis vos bots.");
          } catch (e) {
            toast("ÉCHEC", e.message, "error");
            render();
          }
          break;
        // ── 🎛️ Réglages d'un serveur, écrits dans le bot ────────────
        case "module-recharger":
          delete ui.srvParams[ui.selectedServerId];
          render();
          break;
        case "autorole-rattraper": {
          if (!confirm("Donner les rôles automatiques à TOUS les membres actuels du serveur ?\n\nCeux qui les ont déjà sont ignorés. Sur un grand serveur, l'opération peut durer plusieurs minutes.")) break;
          const libelle = target.textContent;
          target.textContent = "⏳ Attribution en cours…";
          target.disabled = true;
          try {
            const r = await api("serveur.autorole.rattraper", { serveur: ui.selectedServerId });
            const box = document.querySelector("#autorole-rapport");
            if (box) {
              box.innerHTML = `<div class="row mt-16" style="border-color:rgba(47,227,139,.45);flex-direction:column;align-items:flex-start;gap:5px">
                <b>✅ ${esc(r.note)}</b>
                <span style="color:var(--muted)">${r.total} membre(s) humains examinés.</span>
                ${(r.echecs || []).length ? `<span style="color:var(--gold)">⚠️ ${esc(r.echecs.join(" · "))}</span>` : ""}</div>`;
            }
            toast("RÔLES ATTRIBUÉS", r.note);
          } catch (e) {
            const box = document.querySelector("#autorole-rapport");
            if (box) box.innerHTML = `<div class="row mt-16" style="border-color:rgba(255,92,116,.45);flex-direction:column;align-items:flex-start;gap:5px">❌ <span style="color:var(--muted)">${esc(e.message)}</span></div>`;
            toast("ÉCHEC", e.message, "error");
          } finally {
            if (target.isConnected) { target.textContent = libelle; target.disabled = false; }
          }
          break;
        }
        // ── 📨 Constructeur de messages ─────────────────────────────
        case "msg-embed-add":
          lireBrouillon();
          brouillon().embeds.push(embedNeuf());
          render();
          break;
        case "msg-embed-suppr":
          lireBrouillon();
          brouillon().embeds.splice(Number(target.dataset.index), 1);
          render();
          break;
        case "msg-champ-add": {
          lireBrouillon();
          const e = brouillon().embeds[Number(target.dataset.index)];
          if (e) { e.champs = e.champs || []; e.champs.push({ nom: "", valeur: "", aligne: false }); }
          render();
          break;
        }
        case "msg-champ-suppr": {
          lireBrouillon();
          const e = brouillon().embeds[Number(target.dataset.index)];
          if (e) e.champs.splice(Number(target.dataset.champIndex), 1);
          render();
          break;
        }
        case "msg-bouton-add":
          lireBrouillon();
          brouillon().boutons.push({ label: "", style: "secondaire", lien: "" });
          render();
          break;
        case "msg-bouton-suppr":
          lireBrouillon();
          brouillon().boutons.splice(Number(target.dataset.index), 1);
          render();
          break;
        case "msg-option-add":
          lireBrouillon();
          brouillon().selecteur.push({ label: "", description: "" });
          render();
          break;
        case "msg-option-suppr":
          lireBrouillon();
          brouillon().selecteur.splice(Number(target.dataset.index), 1);
          render();
          break;
        case "msg-tester":
        case "msg-envoyer": {
          lireBrouillon();
          const m = brouillon();
          const test = target.dataset.action === "msg-tester";
          if (!m.salon) { toast("SALON MANQUANT", "Choisissez le salon de destination.", "error"); break; }
          if (!test && !confirm("Publier ce message sur Discord maintenant ?")) break;
          const libelle = target.textContent;
          target.textContent = test ? "⏳ Vérification…" : "⏳ Envoi…";
          target.disabled = true;
          try {
            const r = await api("serveur.message", {
              serveur: ui.selectedServerId, salon: m.salon, test,
              message: { content: m.content, embeds: m.embeds, boutons: m.boutons, selecteur: m.selecteur, selecteurTexte: m.selecteurTexte },
            });
            const box = document.querySelector("#msg-rapport");
            if (box) box.innerHTML = `<div class="row mt-16" style="border-color:rgba(47,227,139,.45)">✅ <span>${esc(r.note)}</span></div>`;
            toast(test ? "RENDU VALIDE" : "MESSAGE PUBLIÉ", r.note);
          } catch (err) {
            const box = document.querySelector("#msg-rapport");
            if (box) box.innerHTML = `<div class="row mt-16" style="border-color:rgba(255,92,116,.45);flex-direction:column;align-items:flex-start;gap:5px">❌ <span style="color:var(--muted)">${esc(err.message)}</span></div>`;
            toast("ÉCHEC", err.message, "error");
          } finally {
            if (target.isConnected) { target.textContent = libelle; target.disabled = false; }
          }
          break;
        }
        // ── 🗄️ Base de données ──────────────────────────────────────
        case "db-save": {
          const type = document.querySelector("#db-type")?.value || "mysql";
          const charge = type === "sqlite"
            ? { type, fichier: document.querySelector("#db-fichier")?.value.trim() || "" }
            : {
                type,
                hote: document.querySelector("#db-hote")?.value.trim() || "",
                port: document.querySelector("#db-port")?.value.trim() || "3306",
                base: document.querySelector("#db-base")?.value.trim() || "",
                utilisateur: document.querySelector("#db-user")?.value.trim() || "",
                motdepasse: document.querySelector("#db-mdp")?.value || "",
              };
          const libelle = target.textContent;
          target.textContent = "⏳ Connexion…";
          target.disabled = true;
          try {
            const r = await api("db.config", charge);
            await chargerDb();
            const box = document.querySelector("#db-rapport");
            if (box) {
              box.innerHTML = `<div class="row" style="border-color:rgba(47,227,139,.45);flex-direction:column;align-items:flex-start;gap:6px">
                <b>✅ ${esc(r.note)}</b>
                <span style="color:var(--muted)">Toutes les modifications du site partent désormais dans cette base.</span></div>`;
            }
            toast("BASE CONNECTÉE", r.note);
          } catch (e) {
            const box = document.querySelector("#db-rapport");
            if (box) {
              box.innerHTML = `<div class="row" style="border-color:rgba(255,92,116,.45);flex-direction:column;align-items:flex-start;gap:6px">
                <b>❌ Rien n'a été enregistré</b><span style="color:var(--muted)">${esc(e.message)}</span></div>`;
            }
            toast("ÉCHEC", e.message, "error");
            target.textContent = libelle;
            target.disabled = false;
          }
          break;
        }
        case "db-forget": {
          if (!confirm("Revenir au fichier data/app.json ?\n\nVos tables ne seront PAS supprimées, mais le site cessera de les utiliser — les données saisies depuis la connexion ne s'afficheront plus.")) break;
          await api("db.config", { effacer: true });
          await chargerDb();
          toast("RETOUR AU FICHIER", "Le site utilise de nouveau data/app.json.");
          break;
        }
        // ── 🔄 Mises à jour ─────────────────────────────────────────
        case "maj-auto": {
          const actif = !target.classList.contains("on");
          await api("maj.auto", { auto: actif });
          if (ui.maj) ui.maj.auto = actif;
          render();
          toast(actif ? "AUTOMATIQUE ACTIVÉE" : "AUTOMATIQUE COUPÉE",
            actif ? "Le site se mettra à jour tout seul, ainsi que vos bots." : "Vous garderez la main sur chaque mise à jour.");
          break;
        }
        case "maj-bots":
        case "maj-tout": {
          const toutFaire = target.dataset.action === "maj-tout";
          if (toutFaire && !confirm("Mettre à jour le site ET tous les bots ?\n\nLes bots seront arrêtés puis relancés (quelques secondes d'interruption). Vos données et vos réglages sont conservés.")) break;
          const libelle = target.textContent;
          target.textContent = "⏳ Mise à jour…";
          target.disabled = true;
          try {
            const r = await api("maj.lancer", { site: toutFaire, bots: true });
            const box = document.querySelector("#maj-rapport");
            const lignes = [];
            if (r.site) {
              lignes.push(`<div class="row" style="border-color:${r.site.ok ? "rgba(47,227,139,.4)" : "rgba(255,92,116,.45)"}">
                ${r.site.ok ? "✅" : "❌"} <b>Site</b><span style="color:var(--muted)">${esc(r.site.message)}</span></div>`);
            }
            (r.bots || []).forEach(l => lignes.push(`<div class="row" style="border-color:${l.ok ? "rgba(47,227,139,.4)" : "rgba(255,92,116,.45)"}">
              ${l.ok ? "✅" : "❌"} <b>${esc(l.bot)}</b><span style="color:var(--muted)">${esc(l.message)}</span></div>`));
            if (!lignes.length) lignes.push(`<div class="row">Aucun bot déclaré à mettre à jour.</div>`);
            if (box) box.innerHTML = lignes.join("");
            const echecs = (r.bots || []).filter(l => !l.ok).length + (r.site && !r.site.ok ? 1 : 0);
            toast(echecs ? "MISE À JOUR PARTIELLE" : "MISE À JOUR TERMINÉE",
              echecs ? `${echecs} élément(s) en échec — voir le détail.` : "Le site et vos bots sont à la même version.",
              echecs ? "error" : "success");
            if (r.site?.ok) setTimeout(() => window.location.reload(), 2500);
          } catch (e) {
            toast("ÉCHEC", e.message, "error");
          } finally {
            if (target.isConnected) { target.textContent = libelle; target.disabled = false; }
          }
          break;
        }
        case "admin-add": {
          const saisi = prompt("Identifiant Discord du compte à autoriser (17 à 20 chiffres) :");
          if (!saisi) break;
          const id = saisi.replace(/\D+/g, "");
          if (id.length < 15) { toast("IDENTIFIANT INVALIDE", "Attendu : 17 à 20 chiffres (mode développeur → Copier l'identifiant).", "error"); break; }
          const liste = [...(ui.discord?.admins || [])];
          if (liste.includes(id)) { toast("DÉJÀ AUTORISÉ", "Ce compte administre déjà le site."); break; }
          liste.push(id);
          await api("discord.admins", { admins: liste });
          await chargerDiscord();
          toast("COMPTE AUTORISÉ", `${id} peut désormais administrer le site.`);
          break;
        }
        case "admin-remove": {
          const id = target.dataset.id;
          if (!confirm(`Retirer le compte ${id} des administrateurs ?`)) break;
          const liste = (ui.discord?.admins || []).filter(x => x !== id);
          await api("discord.admins", { admins: liste });
          await chargerDiscord();
          toast("COMPTE RETIRÉ", `${id} ne peut plus modifier le site.`);
          break;
        }
        case "agent-forget": {
          if (!confirm("Effacer la connexion enregistrée ? Le site retombera sur les réglages du dashboard ou de config.php.")) break;
          await api("agent.config", { url: "" });
          ui.agentReglages = null;
          ui.agentBots = null;
          render();
          await chargerBotsAgent();
          toast("CONNEXION EFFACÉE", "Le site reprend les réglages du dashboard, s'il y en a.");
          break;
        }
        case "use-agent-name": {
          const champs = Array.from(document.querySelectorAll('.botcfg [data-f="agentName"]'));
          const cible = champs.find(c => !c.value.trim()) || champs[0];
          if (cible) {
            cible.value = target.dataset.nom;
            cible.focus();
            toast("NOM RECOPIÉ", `« ${target.dataset.nom} » — cliquez sur Enregistrer puis Synchroniser.`);
          }
          break;
        }
        case "bots-sync": {
          target.textContent = "⏳ Synchronisation…";
          await api("bots.save", { bots: collectBots() });
          const result = await api("agent.sync");
          render();
          const box = document.querySelector("#sync-report");
          if (box && result.rapport) {
            box.innerHTML = result.rapport.map(line => `<div class="row" style="border-color:${line.ok ? "rgba(47,227,139,.4)" : "rgba(255,92,116,.45)"}">
              ${line.ok ? "✅" : "❌"} <b>${esc(line.bot)}</b><span style="color:var(--muted)">${esc(line.message)}</span></div>`).join("");
          }
          toast("SYNCHRONISÉ", "Serveurs et compteurs mis à jour depuis l'agent.");
          break;
        }
        case "bot-test": {
          const card = target.closest(".botcfg");
          const name = card?.querySelector('[data-f="agentName"]')?.value.trim();
          if (!name) { toast("TEST", "Renseignez d'abord le « nom chez l'agent ».", "error"); break; }
          await api("bots.save", { bots: collectBots() });
          const result = await api("agent.sync");
          const line = (result.rapport || []).find(item => item.bot === card.querySelector('[data-f="name"]').value.trim());
          toast(line && line.ok ? "LIAISON OK" : "LIAISON KO", line ? line.message : "Bot introuvable dans le rapport.", line && line.ok ? "success" : "error");
          render();
          break;
        }
        // ── Constructeur de page ────────────────────────────────────
        case "block-add": {
          const type = target.dataset.type;
          if (!BLOCK_TYPES[type]) break;
          ui.blocks = pageBlocks().concat([{
            id: `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
            type,
            props: JSON.parse(JSON.stringify(BLOCK_TYPES[type].def || {})),
          }]);
          stageBlocks(ui.blocks);
          render();
          toast("BLOC AJOUTÉ", `${BLOCK_TYPES[type].label} — n'oubliez pas d'enregistrer.`);
          break;
        }
        case "block-move": {
          const row = target.closest(".blk-row");
          const blocks = pageBlocks().slice();
          const index = blocks.findIndex(item => item.id === row?.dataset.blockId);
          const next = index + Number(target.dataset.dir);
          if (index < 0 || next < 0 || next >= blocks.length) break;
          [blocks[index], blocks[next]] = [blocks[next], blocks[index]];
          stageBlocks(blocks);
          render();
          break;
        }
        case "block-duplicate": {
          const row = target.closest(".blk-row");
          const blocks = pageBlocks().slice();
          const index = blocks.findIndex(item => item.id === row?.dataset.blockId);
          if (index < 0) break;
          const copy = JSON.parse(JSON.stringify(blocks[index]));
          copy.id = `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
          blocks.splice(index + 1, 0, copy);
          stageBlocks(blocks);
          render();
          toast("BLOC DUPLIQUÉ", "Une copie a été insérée juste après.");
          break;
        }
        case "block-delete": {
          const row = target.closest(".blk-row");
          if (!row || !confirm("Supprimer ce bloc de la page ?")) break;
          stageBlocks(pageBlocks().filter(item => item.id !== row.dataset.blockId));
          render();
          break;
        }
        case "block-edit":
          openBlockEditor(target.closest(".blk-row")?.dataset.blockId);
          break;
        case "item-add": {
          const wrap = document.querySelector(`.blk-items[data-list="${target.dataset.list}"]`);
          const form = target.closest("form");
          const block = pageBlocks().find(item => item.id === form?.dataset.blockId);
          const field = BLOCK_TYPES[block?.type]?.fields.find(f => f.k === target.dataset.list);
          if (wrap && field) wrap.insertAdjacentHTML("beforeend", blockItemRow(field));
          break;
        }
        case "item-remove":
          target.closest(".blk-item")?.remove();
          break;
        case "save-blocks":
          await api("site.config.save", { config: { ...siteConfig(), blocks: pageBlocks() } });
          ui.blocks = null;
          render();
          toast("PAGE ENREGISTRÉE", "Votre page d'accueil est en ligne.");
          break;
        case "block-link": {
          const url = target.dataset.url || "";
          if (/^https?:\/\//.test(url)) window.open(url, "_blank");
          else if (url.startsWith("#")) {
            if (!ui.activeBotId && state.bots?.[0]) {
              ui.activeBotId = state.bots[0].id;
              storage.setItem("aincrad.activeBot", ui.activeBotId);
            }
            navigate(url.slice(1) || "dashboard");
          }
          break;
        }
        case "server-search":
          ui.serverQuery = document.querySelector("#server-search")?.value || "";
          render();
          break;
        case "blacklist-search":
          ui.blacklistQuery = document.querySelector("#blacklist-search")?.value || "";
          render();
          break;
        case "open-blacklist-modal":
          openBlacklistModal();
          break;
        // 📥 Rapatrie les sanctions prononcées sur Discord (/blacklist,
        // tickets du QG) avec leur preuve.
        case "blacklist-import":
          await importerBlacklistDiscord(true);
          break;
        case "open-sanction":
          openSanctionModal(target.dataset.id);
          break;
        case "preuve-zoom": {
          // Agrandissement plein écran d'une preuve image.
          const src = target.closest("[data-src]")?.dataset.src;
          if (!src) break;
          const vue = document.createElement("div");
          vue.className = "preuve-zoom";
          vue.innerHTML = `<img src="${esc(src)}" alt=""><button class="btn" type="button">Fermer</button>`;
          vue.addEventListener("click", () => vue.remove());
          document.body.appendChild(vue);
          break;
        }
        case "open-proof-modal":
          openProofModal(target.dataset.id);
          break;
        case "delete-blacklist":
          if (confirm("Retirer cette sanction ? L'utilisateur sera DÉBANNI des serveurs des bots concernés.")) {
            const r = await api("blacklist.delete", { id: target.dataset.id });
            closeModal();
            render();
            const ko = (r?.diffusion || []).filter(x => !x.ok);
            toast("BLACKLIST", ko.length
              ? `Fiche retirée, mais le déban a échoué sur ${ko.length} bot(s) : ${ko[0].message}`
              : "Sanction retirée et utilisateur débanni.", ko.length ? "error" : "success");
          }
          break;
        // 🔁 Réapplique la sanction : bot éteint au moment de l'ajout, ou
        // fiche créée avant que le site ne sache parler aux bots.
        case "blacklist-resync": {
          const boite = document.querySelector("#bl-resync-rapport");
          if (boite) boite.innerHTML = `<span class="field-note">⏳ Envoi aux bots…</span>`;
          try {
            const r = await api("blacklist.resync", { id: target.dataset.id });
            if (boite) boite.innerHTML = rapportDiffusion(r?.diffusion || []);
            const ko = (r?.diffusion || []).filter(x => !x.ok);
            toast("BLACKLIST", ko.length ? `${ko.length} bot(s) en échec.` : "Sanction réappliquée sur Discord.",
              ko.length ? "error" : "success");
          } catch (err) {
            if (boite) boite.innerHTML = `<span class="field-note" style="color:var(--red)">${esc(err.message)}</span>`;
          }
          break;
        }
        case "select-ticket":
          ui.selectedTicketId = target.dataset.ticketId;
          render();
          break;
        // ── 🗄️ Archives de tickets ──────────────────────────────────
        case "ticket-tab":
          ui.ticketTab = target.dataset.tab === "archives" ? "archives" : "open";
          render();
          break;
        case "select-archive":
          ui.selectedArchiveId = target.dataset.ticketId;
          render();
          break;
        case "archive-restore":
          await api("ticket.restore", { ticketId: target.dataset.ticketId });
          ui.ticketTab = "open";
          ui.selectedTicketId = target.dataset.ticketId;
          render();
          toast("TICKET ROUVERT", "Il est de retour dans les tickets en cours.");
          break;
        case "archive-purge":
          if (!confirm("Supprimer définitivement cette archive ? Cette action est irréversible.")) break;
          await api("ticket.purge", { ticketId: target.dataset.ticketId });
          ui.selectedArchiveId = null;
          render();
          toast("ARCHIVE SUPPRIMÉE", "Le ticket a été effacé définitivement.");
          break;
        case "close-modal":
          closeModal();
          break;
        case "pulse-system":
          ui.menuProfil = false;
          target.classList.add("animating");
          const response = await fetch(`${window.AINCRAD_API}?action=state`);
          const payload = await response.json();
          if (payload.ok) state = payload.state;
          render();
          toast("SYNCHRONISATION", "Le Cardinal System est à jour.");
          break;
        case "show-notifications":
          ui.menuProfil = false;
          showNotifications();
          break;
        case "invite-bot": {
          // Lien d'invitation réel, construit avec le Client ID du bot.
          const bot = target.dataset.botId
            ? (state.bots || []).find(b => b.id === target.dataset.botId)
            : activeBot();
          const url = inviteUrl(bot);
          if (url) { window.open(url, "_blank"); break; }
          openModal("Ajouter le bot à un serveur", `<div class="empty"><div>
            <strong>Client ID manquant pour « ${esc(bot?.name || "ce bot")} »</strong>
            <span>Renseignez son <b>Client ID Discord</b> dans ⚙️ Créateur → 🤖 Mes bots
            (ou cliquez sur « Synchroniser » : il se remplit tout seul depuis l'agent).</span>
            <div class="form-actions" style="justify-content:center"><button class="btn primary" data-action="close-modal">Compris</button></div>
          </div></div>`);
          break;
        }
        case "export-state": {
          const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = `aincrad-export-${new Date().toISOString().slice(0,10)}.json`;
          anchor.click();
          URL.revokeObjectURL(url);
          toast("EXPORT", "Les données JSON ont été exportées.");
          break;
        }
        case "reset-module":
          render();
          toast("MODULE", "Les modifications non enregistrées ont été annulées.");
          break;
        case "reset-site-config":
          render();
          toast("CONFIGURATION", "Les modifications non enregistrées ont été annulées.");
          break;
      }
    } catch (error) {
      toast("ERREUR", error.message || "Une erreur est survenue.", "error");
    }
    createRipple(event, target);
  });

  // Aperçu en direct : chaque frappe/glissement du builder est appliqué
  // immédiatement au site (sans enregistrer).
  // ⚡ L'aperçu est regroupé sur la prochaine image du navigateur : taper
  // « Aincrad » déclenchait 7 relectures du formulaire et 7 recalculs de
  // style. Il n'y en a plus qu'un, quel que soit le nombre de frappes.
  let _apercuPrevu = false;
  function livePreview() {
    if (_apercuPrevu) return;
    _apercuPrevu = true;
    requestAnimationFrame(() => {
      _apercuPrevu = false;
      const form = document.querySelector("#site-builder-form");
      if (!form) return;
      applySitePreferences({ ...siteConfig(), ...collectSiteConfig(form) });
    });
  }
  document.addEventListener("input", event => {
    if (event.target.closest("#site-builder-form")) livePreview();
  });

  document.addEventListener("change", async event => {
    const target = event.target;
    // 🗄️ Type de base : on montre le bon jeu de champs, sans reconstruire la
    // page (ce qui effacerait ce qui est déjà saisi).
    if (target.dataset && target.dataset.bascule === "db") {
      const sqlite = target.value === "sqlite";
      document.querySelectorAll(".db-mysql").forEach(e => { e.style.display = sqlite ? "none" : ""; });
      document.querySelectorAll(".db-sqlite").forEach(e => { e.style.display = sqlite ? "" : "none"; });
    }
    if (target.closest("#site-builder-form")) livePreview();
    // ⚡ Réglages d'un module du bot : on note le changement dans un brouillon
    // et on reconstruit, pour que l'aperçu suive AVANT l'enregistrement.
    // Le brouillon est séparé de la config enregistrée : sans ça, comparer
    // « ancien » et « nouveau » au moment d'enregistrer ne verrait plus rien
    // changer, et plus rien ne partirait dans le bot.
    if (target.matches("[data-cfg]") && target.closest('form[data-form="module-bot"]')) {
      ui.brouillonModule = ui.brouillonModule || {};
      ui.brouillonModule[target.dataset.cfg] = target.multiple
        ? JSON.stringify([...target.selectedOptions].map(o => o.value).filter(Boolean))
        : target.value;
      render();
      return;
    }
    if (target.matches('[data-action="ticket-status"]')) {
      try {
        await api("ticket.status", { ticketId: target.dataset.ticketId, status: target.value });
        render();
        toast("TICKET", "Le statut a été mis à jour.");
      } catch (error) {
        toast("ERREUR", error.message, "error");
      }
    }
  });

  document.addEventListener("submit", async event => {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    const originalText = submit?.textContent;
    if (submit) { submit.disabled = true; submit.textContent = "TRAITEMENT…"; }

    try {
      switch (form.dataset.form) {
        case "blacklist-add": {
          const values = formToObject(form);
          const r = await api("blacklist.add", values);
          closeModal();
          render();
          // On annonce ce qui s'est RÉELLEMENT passé sur Discord, pas juste
          // « enregistré » : un bot éteint doit se voir.
          const d = r?.diffusion || [];
          const ko = d.filter(x => !x.ok);
          toast(ko.length ? "BLACKLIST PARTIELLE" : "BLACKLIST",
            ko.length
              ? `${values.username} : ${d.length - ko.length}/${d.length} bot(s) — ${ko[0].bot} : ${ko[0].message}`
              : `${values.username} banni sur ${d.length} bot(s).`,
            ko.length ? "error" : "success");
          break;
        }
        case "proof-upload": {
          const data = new FormData(form);
          data.append("action", "blacklist.proof");
          data.append("id", form.dataset.id);
          await api("blacklist.proof", {}, { formData: data });
          closeModal();
          render();
          toast("PREUVE", "Le fichier a été associé à la sanction.");
          break;
        }
        case "ticket-message": {
          const values = formToObject(form);
          await api("ticket.message", { ticketId: form.dataset.ticketId, content: values.content });
          render();
          toast("TICKET", "Votre réponse a été envoyée.");
          break;
        }
        // Réglages écrits DANS LE BOT (salons, rôles, interrupteurs, textes).
        case "module-bot":
          await enregistrerModule(form);
          break;
        case "site-config": {
          const config = collectSiteConfig(form);
          await api("site.config.save", { config });
          render();
          toast("SITE ENREGISTRÉ", "Votre site est à jour pour tout le monde.");
          break;
        }
        case "bg-upload": {
          const data = new FormData(form);
          data.append("action", "site.background.upload");
          const bouton = form.querySelector('button[type="submit"]');
          const libelle = bouton?.textContent;
          // Une vidéo peut mettre du temps à monter : on le montre.
          if (bouton) { bouton.textContent = "⏳ Envoi en cours…"; bouton.disabled = true; }
          try {
            const r = await api("site.background.upload", {}, { formData: data });
            render();
            toast(r.video ? "VIDÉO APPLIQUÉE" : "FOND APPLIQUÉ",
              r.video ? "Votre vidéo tourne désormais en fond du site." : "Votre image est désormais le fond du site.");
          } finally {
            if (bouton && bouton.isConnected) { bouton.textContent = libelle; bouton.disabled = false; }
          }
          break;
        }
        case "auth-login": {
          const values = formToObject(form);
          await api("auth.login", { password: values.password });
          AUTH.ok = true;
          closeModal();
          render();
          toast("CONNECTÉ", "Vous pouvez maintenant modifier le site.");
          break;
        }
        case "block-edit": {
          const blocks = pageBlocks().slice();
          const index = blocks.findIndex(item => item.id === form.dataset.blockId);
          if (index < 0) break;
          const type = BLOCK_TYPES[blocks[index].type];
          const props = {};
          type.fields.forEach(field => {
            if (field.t === "list") {
              const wrap = form.querySelector(`.blk-items[data-list="${field.k}"]`);
              props[field.k] = Array.from(wrap?.querySelectorAll(".blk-item") || []).map(row => {
                const item = {};
                field.item.forEach(sub => { item[sub.k] = row.querySelector(`[data-sub="${sub.k}"]`)?.value.trim() || ""; });
                return item;
              }).filter(item => Object.values(item).some(Boolean));
            } else {
              props[field.k] = form.querySelector(`[name="${field.k}"]`)?.value ?? "";
            }
          });
          blocks[index] = { ...blocks[index], props };
          stageBlocks(blocks);
          closeModal();
          render();
          toast("BLOC MIS À JOUR", "Enregistrez la page pour publier vos changements.");
          break;
        }
      }
    } catch (error) {
      toast("ERREUR", error.message || "Impossible d'enregistrer.", "error");
    } finally {
      if (submit && document.body.contains(submit)) { submit.disabled = false; submit.textContent = originalText; }
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeModal();
    if (event.key === "Enter" && event.target.id === "blacklist-search") {
      ui.blacklistQuery = event.target.value;
      render();
    }
    if (event.key === "Enter" && event.target.id === "server-search") {
      ui.serverQuery = event.target.value;
      render();
    }
    if (event.key === "Enter" && event.target.id === "archive-search") {
      ui.archiveQuery = event.target.value;
      render();
    }
  });

  function createRipple(event, element = event.target.closest("button")) {
    if (!element || !(element instanceof HTMLElement)) return;
    const rect = element.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    element.appendChild(ripple);
    setTimeout(() => ripple.remove(), 650);
  }

  function createParticles() {
    const field = document.querySelector("#particle-field");
    if (!field) return;
    // Chaque particule est un élément animé en continu : sur téléphone, on en
    // met deux fois moins, et aucune si le visiteur demande moins d'animations.
    const petit = window.matchMedia("(max-width: 720px)").matches;
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nombre = reduit ? 0 : (petit ? 9 : 22);
    field.innerHTML = Array.from({ length: nombre }, (_, index) => {
      const left = (index * 37 + 11) % 100;
      const size = 3 + (index % 4) * 2;
      const duration = 12 + (index % 7) * 2.3;
      const delay = -(index % 9) * 2.1;
      return `<i class="particle" style="left:${left}%;--size:${size}px;--dur:${duration}s;--delay:${delay}s"></i>`;
    }).join("");
  }

  // ⚡ La souris émet jusqu'à 120 événements par seconde. On se contente de
  // retenir sa position et de n'écrire dans le style qu'une fois par image :
  // sinon l'aura et la parallaxe déclenchaient trois écritures par événement,
  // en concurrence directe avec la frappe au clavier.
  let _souris = null;
  let _sourisPrevue = false;
  window.addEventListener("mousemove", event => {
    _souris = { x: event.clientX, y: event.clientY };
    if (_sourisPrevue) return;
    _sourisPrevue = true;
    requestAnimationFrame(() => {
      _sourisPrevue = false;
      const p = _souris;
      if (!p) return;
      if (cursorAura) {
        cursorAura.style.left = `${p.x}px`;
        cursorAura.style.top = `${p.y}px`;
      }
      // Parallaxe du fond (désactivable dans le builder).
      if (!sky || siteConfig().parallax === false) return;
      const x = (p.x / innerWidth - .5) * 8;
      const y = (p.y / innerHeight - .5) * 5;
      sky.style.transform = `scale(1.04) translate(${x}px, ${y}px)`;
    });
  }, { passive: true });

  window.addEventListener("load", () => {
    createParticles();
    render();
    // Durée de l'écran de démarrage réglée dans le builder (0 = désactivé).
    const cfg = siteConfig();
    const delay = cfg.bootScreen === false ? 0 : Math.min(4000, Math.max(0, Number(cfg.bootDuration ?? 650)));
    setTimeout(() => boot.classList.add("is-hidden"), delay);
    // 📥 Les sanctions prononcées sur Discord sont chargées TOUT DE SUITE,
    // sans attendre qu'on ouvre la page Blacklist et sans rien cliquer.
    // En arrière-plan : l'interface est déjà utilisable pendant ce temps.
    if (estEquipeSite()) setTimeout(() => importerBlacklistDiscord(false), 1200);
    // …puis on reste à jour tout seul. Onglet caché = on ne fait rien : inutile
    // d'interroger les bots pendant qu'on regarde ailleurs.
    setInterval(() => {
      if (document.hidden || !estEquipeSite()) return;
      importerBlacklistDiscord(false);
    }, 5 * 60 * 1000);
  });
})();
