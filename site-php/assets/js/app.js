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
    { id: "arrivals", label: "Arrivées & départs", desc: "Messages et salons d'accueil" },
    { id: "roles", label: "Rôles & sécurité", desc: "Protection, permissions et autorôles" },
    { id: "channels", label: "Salons & logs", desc: "Journalisation complète du serveur" },
    { id: "levels", label: "Niveaux", desc: "XP, récompenses et progression" },
    { id: "whitelist", label: "Whitelist métiers", desc: "Candidatures et métiers autorisés" },
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
    const config = options.formData
      ? { method: "POST", body: options.formData }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...payload }),
        };

    const response = await fetch(`${window.AINCRAD_API}?action=${encodeURIComponent(action)}`, config);
    const data = await response.json().catch(() => ({ ok: false, error: "Réponse serveur invalide." }));
    if (!response.ok || !data.ok) throw new Error(data.error || "Une erreur est survenue.");
    if (data.state) state = data.state;
    return data;
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
      .filter(item => !ui.previewGrade || gradeCan("page." + (item.id === "site-config" ? "creator" : item.id)));
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
            <div class="clock" id="live-clock">--:--:--</div>
            <button class="icon-btn" data-action="preview-gate" title="Voir la page d'accueil">👁</button>
            <button class="icon-btn" data-action="pulse-system" title="Synchroniser">⌁</button>
            <button class="icon-btn" data-action="show-notifications" title="Notifications">♢</button>
            <div class="profile">
              <div class="profile-avatar">KS</div>
              <div><strong>Kirito_Admin</strong><span>Créateur · Cardinal</span></div>
              <i class="status-dot"></i>
            </div>
          </div>
        </header>

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
        <section class="content">${previewBanner()}${renderRoute()}</section>
      </div>`;
    startClock();
  }

  // Bandeau rappelant que l'on regarde le site à travers un grade.
  function previewBanner() {
    if (!ui.previewGrade) return "";
    const g = gradeById(ui.previewGrade);
    return `<div class="previewbar" style="--gc:${g.color}">
      <span>👁 Aperçu du grade <b>${esc(g.label)}</b> <i>(${esc(g.family)})</i> — les éléments non autorisés sont masqués.</span>
      <button class="btn small" data-action="preview-grade" data-grade="">Quitter l'aperçu</button>
    </div>`;
  }

  function renderRoute() {
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

  function dashboardView() {
    const bot = activeBot();
    const servers = botServers();
    const totalMembers = servers.reduce((sum, server) => sum + server.members, 0);
    const totalOnline = servers.reduce((sum, server) => sum + server.online, 0);
    const openTickets = (state.tickets || []).filter(t => t.status !== "fermé").length;
    return `<div class="content-view">
      ${pageHead("Cardinal / Centre de contrôle", `Bienvenue dans l'interface ${bot.name}`, "Surveillez vos serveurs Discord et accédez rapidement aux systèmes de gestion.", button("Synchroniser", "pulse-system", "primary"))}
      <div class="hero-grid">
        <article class="panel hero-panel"><div class="hero-content">
          <span class="hero-kicker">A I N C R A D · FLOOR 75</span>
          <h3>Cardinal System opérationnel</h3>
          <p>${esc(bot.description)} Tous les modules sont synchronisés avec l'infrastructure Discord.</p>
          <div class="hero-status"><span class="chip green"><i class="status-dot"></i> BOT EN LIGNE</span><span class="chip">PING ${esc(bot.latency)} MS</span><span class="chip gold">VERSION 2.0.0</span></div>
        </div></article>
        <div class="stat-stack">
          <div class="stat-card"><span>Serveurs connectés</span><strong>${servers.length}</strong><em>+1 ce mois</em></div>
          <div class="stat-card"><span>Membres cumulés</span><strong>${formatNumber(totalMembers)}</strong><em>${formatNumber(totalOnline)} en ligne</em></div>
          <div class="stat-card"><span>Tickets actifs</span><strong>${openTickets}</strong><em>support disponible</em></div>
          <div class="stat-card"><span>Entrées blacklist</span><strong>${state.blacklist?.length || 0}</strong><em>base globale</em></div>
        </div>
      </div>

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
      </div>
    </div>`;
  }

  function serverCard(server) {
    return `<button class="server-card ${ui.selectedServerId === server.id ? "selected" : ""}" data-action="open-server" data-server-id="${esc(server.id)}">
      <span class="server-card-top">${serverIcon(server)}<i class="status-dot"></i></span>
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
    const servers = botServers().filter(server => !query || `${server.name} ${server.region}`.toLowerCase().includes(query));
    return `<div class="content-view">
      ${pageHead("Gestion / Serveurs", `Serveurs de ${bot.name}`, "Ouvrez un serveur pour configurer ses modules et consulter ses statistiques.", button("Ajouter un serveur", "invite-bot", "primary"))}
      <section class="panel"><div class="panel-inner">
        <div class="panel-head"><div><h3>Infrastructure Discord</h3><p>${servers.length} serveur(s) correspondent à la sélection actuelle.</p></div><div class="searchbar"><input class="input" id="server-search" value="${esc(ui.serverQuery)}" placeholder="Rechercher un serveur…"><button class="btn" data-action="server-search">Rechercher</button></div></div>
        <div class="grid-3">${servers.map(serverCard).join("") || emptyBlock("Aucun résultat", "Essayez une autre recherche.")}</div>
      </div></section>
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
    return `<div class="content-view">
      ${pageHead("Serveurs / Configuration", server.name, `Module actif : ${current.label}. Les modifications sont enregistrées dans le fichier JSON du projet.`, button("Retour aux serveurs", "navigate", "ghost", 'data-route="servers"'))}
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

  function modulePanel(title, description, formBody, moduleId) {
    return `<section class="panel"><div class="panel-inner">
      <div class="panel-head"><div><h3>${esc(title)}</h3><p>${esc(description)}</p></div><span class="chip green">MODULE ACTIF</span></div><div class="panel-line"></div>
      <form data-form="module" data-module="${esc(moduleId)}">${formBody}<div class="form-actions"><button type="button" class="btn ghost" data-action="reset-module">Réinitialiser</button><button type="submit" class="btn success">Enregistrer le module</button></div></form>
    </div></section>`;
  }

  function moduleView(moduleId, server) {
    const settings = serverSettings(server.id)[moduleId] || {};
    switch (moduleId) {
      case "overview": return overviewModule(server, settings);
      case "rp": return rpModule(settings);
      case "arrivals": return arrivalsModule(settings);
      case "roles": return rolesModule(settings);
      case "channels": return channelsModule(settings);
      case "levels": return levelsModule(settings);
      case "whitelist": return whitelistModule(settings);
      case "tickets": return ticketModule(settings);
      default: return overviewModule(server, settings);
    }
  }

  function overviewModule(server, s) {
    const body = `<div class="grid-3">
      <div class="stat-card"><span>Niveau de configuration</span><strong>${server.level}%</strong><em>profil serveur</em></div>
      <div class="stat-card"><span>Activité Discord</span><strong>${server.activity}%</strong><em>7 derniers jours</em></div>
      <div class="stat-card"><span>Modules actifs</span><strong>8 / 8</strong><em>système complet</em></div>
    </div>
    <div class="form-grid mt-22">
      ${selectField("language", "Langue du bot", s.language || "fr", [{value:"fr",label:"Français"},{value:"en",label:"English"},{value:"de",label:"Deutsch"}])}
      ${selectField("timezone", "Fuseau horaire", s.timezone || "Europe/Paris", ["Europe/Paris","Europe/Brussels","Europe/Berlin","UTC"])}
      ${inputField("prefix", "Préfixe des commandes", s.prefix || "!", "text", "Utilisé pour les commandes textuelles.", "maxlength=4")}
      ${selectField("presence", "Présence du bot", s.presence || "Aincrad", ["Aincrad","Sword Art Online","Gestion du serveur","Mode maintenance"])}
    </div>
    <div class="mt-16">${toggleField("maintenance", !!s.maintenance, "Mode maintenance", "Suspend les modules publics sans déconnecter le bot.")}</div>`;
    return modulePanel("Vue d'ensemble", "Identité, langue, statut et paramètres généraux du serveur.", body, "overview");
  }

  function rpModule(s) {
    const body = `<div class="grid-2"><div>
      ${toggleField("enabled", s.enabled !== false, "Activer le module RP", "Active les personnages, profils et commandes RP.")}
      ${toggleField("characterCreation", s.characterCreation !== false, "Création de personnages", "Permet aux membres de créer leur identité RP.")}
      ${toggleField("economy", s.economy !== false, "Économie Col", "Active la monnaie, les achats et les récompenses.")}
      ${toggleField("inventory", s.inventory !== false, "Inventaire", "Active les objets, équipements et consommables.")}
    </div><div class="form-grid">
      ${inputField("startingCoins", "Col de départ", s.startingCoins ?? 250, "number", "Montant remis à la création.", "min=0 max=100000")}
      ${inputField("deathPenalty", "Pénalité de mort (%)", s.deathPenalty ?? 15, "number", "Perte appliquée au portefeuille.", "min=0 max=100")}
      ${inputField("maxCharacters", "Personnages maximum", s.maxCharacters ?? 3, "number", "Par utilisateur Discord.", "min=1 max=10")}
      ${selectField("combatMode", "Mode de combat", s.combatMode || "semi-rp", [{value:"narratif",label:"Narratif"},{value:"semi-rp",label:"Semi-RP"},{value:"statistiques",label:"Statistiques complètes"}])}
    </div></div>`;
    return modulePanel("Module RP", "Configurez la progression, l'économie et les mécaniques de rôleplay.", body, "rp");
  }

  function arrivalsModule(s) {
    const body = `<div class="grid-2"><div>
      ${toggleField("welcome", s.welcome !== false, "Message d'arrivée", "Annonce chaque nouveau joueur dans le salon choisi.")}
      ${toggleField("goodbye", s.goodbye !== false, "Message de départ", "Informe la communauté lorsqu'un membre quitte le serveur.")}
      ${toggleField("directMessage", !!s.directMessage, "Message privé d'accueil", "Envoie également les règles en message privé.")}
    </div><div class="form-grid">
      ${inputField("welcomeChannel", "Salon d'arrivée", s.welcomeChannel || "#arrivées")}
      ${inputField("goodbyeChannel", "Salon de départ", s.goodbyeChannel || "#départs")}
      ${textAreaField("welcomeMessage", "Message d'accueil", s.welcomeMessage || "Bienvenue {user} dans Aincrad. Votre aventure commence ici.", "Variables : {user}, {server}, {memberCount}.")}
      ${textAreaField("goodbyeMessage", "Message de départ", s.goodbyeMessage || "{user} a quitté Aincrad. Son nom restera inscrit dans les archives.")}
    </div></div>`;
    return modulePanel("Arrivées & départs", "Créez une entrée immersive pour chaque nouveau membre.", body, "arrivals");
  }

  function rolesModule(s) {
    const body = `<div class="grid-2"><div>
      ${toggleField("antiRaid", s.antiRaid !== false, "Protection anti-raid", "Bloque les arrivées massives et actions coordonnées.")}
      ${toggleField("antiSpam", s.antiSpam !== false, "Protection anti-spam", "Analyse la fréquence, les liens et les mentions.")}
      ${toggleField("lockDangerousPermissions", s.lockDangerousPermissions !== false, "Verrouillage des permissions", "Surveille les rôles administrateur et les webhooks.")}
      ${toggleField("captcha", !!s.captcha, "Vérification captcha", "Demande une validation avant d'accéder au serveur.")}
    </div><div class="form-grid">
      ${inputField("autoRole", "Rôle automatique", s.autoRole || "Joueur")}
      ${inputField("verifiedRole", "Rôle vérifié", s.verifiedRole || "Citoyen d'Aincrad")}
      ${inputField("minimumAccountDays", "Âge minimum du compte", s.minimumAccountDays ?? 7, "number", "En jours.", "min=0 max=365")}
      ${selectField("raidAction", "Action en cas de raid", s.raidAction || "quarantaine", [{value:"alerte",label:"Alerte uniquement"},{value:"quarantaine",label:"Quarantaine automatique"},{value:"ban",label:"Bannissement automatique"}])}
    </div></div>`;
    return modulePanel("Rôles & sécurité", "Centralisez les protections et les rôles attribués automatiquement.", body, "roles");
  }

  function channelsModule(s) {
    const body = `<div class="grid-2"><div>
      ${toggleField("messageLogs", s.messageLogs !== false, "Logs des messages", "Suppressions, éditions et pièces jointes.")}
      ${toggleField("voiceLogs", s.voiceLogs !== false, "Logs vocaux", "Entrées, sorties et déplacements vocaux.")}
      ${toggleField("moderationLogs", s.moderationLogs !== false, "Logs de modération", "Avertissements, exclusions et bannissements.")}
      ${toggleField("memberLogs", s.memberLogs !== false, "Logs des membres", "Pseudos, rôles et changements de profil.")}
    </div><div class="form-grid">
      ${inputField("logChannel", "Salon principal des logs", s.logChannel || "#logs-cardinal")}
      ${inputField("ticketLogChannel", "Archives des tickets", s.ticketLogChannel || "#archives-tickets")}
      ${selectField("retention", "Conservation", s.retention || "90", [{value:"30",label:"30 jours"},{value:"90",label:"90 jours"},{value:"365",label:"1 an"},{value:"unlimited",label:"Illimitée"}])}
      ${selectField("detailLevel", "Niveau de détail", s.detailLevel || "complet", [{value:"minimal",label:"Minimal"},{value:"standard",label:"Standard"},{value:"complet",label:"Complet"}])}
    </div></div>`;
    return modulePanel("Salons & logs", "Définissez les salons d'archives et les événements enregistrés.", body, "channels");
  }

  function levelsModule(s) {
    const body = `<div class="grid-2"><div>
      ${toggleField("enabled", s.enabled !== false, "Système de niveaux", "Distribue de l'XP lors des interactions valides.")}
      ${toggleField("voiceXp", s.voiceXp !== false, "XP vocal", "Récompense le temps passé dans les salons vocaux.")}
      ${toggleField("roleRewards", s.roleRewards !== false, "Récompenses de rôle", "Attribue automatiquement les rôles de palier.")}
      ${toggleField("antiFarm", s.antiFarm !== false, "Protection anti-farm", "Ignore les messages répétés ou artificiels.")}
    </div><div class="form-grid">
      ${inputField("xpMin", "XP minimum", s.xpMin ?? 10, "number", "Par message valide.", "min=1 max=100")}
      ${inputField("xpMax", "XP maximum", s.xpMax ?? 25, "number", "Par message valide.", "min=1 max=200")}
      ${inputField("cooldown", "Délai entre gains (s)", s.cooldown ?? 60, "number", "Protection contre le farm.", "min=10 max=3600")}
      ${inputField("announceChannel", "Salon des niveaux", s.announceChannel || "#progression")}
      ${selectField("curve", "Courbe de progression", s.curve || "progressive", [{value:"rapide",label:"Rapide"},{value:"progressive",label:"Progressive"},{value:"difficile",label:"Difficile"}])}
      ${inputField("maxLevel", "Niveau maximum", s.maxLevel ?? 100, "number", "Plafond du classement.", "min=10 max=1000")}
    </div></div>`;
    return modulePanel("Niveaux", "Réglez l'expérience, les délais et les récompenses de progression.", body, "levels");
  }

  function whitelistModule(s) {
    const jobs = Array.isArray(s.jobs) ? s.jobs : [];
    const body = `<div class="grid-2"><div>
      ${toggleField("enabled", s.enabled !== false, "Whitelist métiers", "Active les candidatures pour les métiers protégés.")}
      ${toggleField("dmResult", s.dmResult !== false, "Résultat en message privé", "Informe automatiquement le candidat.")}
      ${toggleField("requireCharacter", s.requireCharacter !== false, "Personnage RP obligatoire", "Refuse les candidatures sans profil actif.")}
    </div><div class="form-grid">
      ${inputField("reviewRole", "Rôle chargé des validations", s.reviewRole || "Responsable Whitelist")}
      ${inputField("reviewChannel", "Salon des candidatures", s.reviewChannel || "#candidatures-métiers")}
      ${inputField("reviewDelay", "Délai conseillé (h)", s.reviewDelay ?? 48, "number", "Affiché au candidat.", "min=1 max=720")}
      <div class="field full"><label>Métiers disponibles</label><input class="input" name="jobs" value="${esc(jobs.join(", "))}" placeholder="Forgeron, Alchimiste, Garde…"><span class="field-note">Séparez les métiers par une virgule.</span></div>
      <div class="field full"><label>Aperçu</label><div class="tag-list">${jobs.map(job => `<span class="tag-item">${esc(job)}</span>`).join("") || `<span class="field-note">Aucun métier configuré.</span>`}</div></div>
    </div></div>`;
    return modulePanel("Whitelist métiers", "Gérez les métiers accessibles uniquement après validation du staff.", body, "whitelist");
  }

  function ticketModule(s) {
    const body = `<div class="grid-2"><div>
      ${toggleField("enabled", s.enabled !== false, "Système de tickets", "Permet aux membres d'ouvrir une demande privée.")}
      ${toggleField("transcripts", s.transcripts !== false, "Transcriptions automatiques", "Archive chaque conversation à sa fermeture.")}
      ${toggleField("claimSystem", s.claimSystem !== false, "Attribution aux membres du staff", "Empêche plusieurs agents de traiter le même ticket.")}
      ${toggleField("rating", !!s.rating, "Évaluation du support", "Demande une note après la fermeture.")}
    </div><div class="form-grid">
      ${inputField("category", "Catégorie Discord", s.category || "TICKETS")}
      ${inputField("staffRole", "Rôle du support", s.staffRole || "Support")}
      ${inputField("closeDelay", "Délai de fermeture (min)", s.closeDelay ?? 15, "number", "Avant suppression du salon.", "min=0 max=1440")}
      ${inputField("maxOpen", "Tickets maximum par membre", s.maxOpen ?? 2, "number", "Limite simultanée.", "min=1 max=20")}
      ${textAreaField("panelMessage", "Texte du panneau", s.panelMessage || "Besoin d'aide ? Ouvrez un ticket et un membre du staff vous répondra.")}
    </div></div>`;
    return modulePanel("Tickets", "Configurez le panneau, les rôles du staff et les archives.", body, "tickets");
  }

  function blacklistView() {
    const query = ui.blacklistQuery.trim().toLowerCase();
    const entries = (state.blacklist || []).filter(item => !query || `${item.username} ${item.discordId} ${item.reason} ${item.server}`.toLowerCase().includes(query));
    return `<div class="content-view">
      ${pageHead("Staff bot / Sécurité", "Blacklist globale", "Recherchez un utilisateur, consultez le motif et associez des preuves à chaque sanction.", button("Ajouter une entrée", "open-blacklist-modal", "danger"))}
      <section class="panel"><div class="panel-inner">
        <div class="panel-head"><div><h3>Base de sanctions</h3><p>${entries.length} résultat(s) sur ${state.blacklist?.length || 0} entrées.</p></div><div class="searchbar"><input class="input" id="blacklist-search" value="${esc(ui.blacklistQuery)}" placeholder="Nom, ID Discord, serveur ou motif…"><button class="btn" data-action="blacklist-search">Rechercher</button></div></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Utilisateur</th><th>Motif</th><th>Sévérité</th><th>Serveur</th><th>Preuves</th><th>Actions</th></tr></thead><tbody>
        ${entries.map(entry => `<tr>
          <td><strong>${esc(entry.username)}</strong><br><span>${esc(entry.discordId)}</span><br><span>${esc(entry.id)} · ${esc(entry.date)}</span></td>
          <td>${esc(entry.reason)}</td>
          <td><span class="severity ${esc(entry.severity)}">${esc(entry.severity)}</span></td>
          <td>${esc(entry.server)}<br><span>par ${esc(entry.author)}</span></td>
          <td><div class="proof-list">${entry.proofs?.length ? entry.proofs.map(proof => `<span class="proof-pill">${esc(proof)}</span>`).join("") : `<span class="field-note">Aucune preuve</span>`}</div></td>
          <td><div class="page-actions">${button("Preuve", "open-proof-modal", "small", `data-id="${esc(entry.id)}"`)}${button("Retirer", "delete-blacklist", "danger small", `data-id="${esc(entry.id)}"`)}</div></td>
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
    const valid = ["ecosystem", "page", "builder", "bots", "perms"];
    const tab = valid.includes(ui.creatorTab) ? ui.creatorTab : "page";
    const tabs = [
      ["page", "🧱 Constructeur de page", "Blocs de la page d'accueil"],
      ["bots", "🤖 Mes bots", "Ajoutez autant de bots que voulu"],
      ["perms", "🔐 Fonctions & grades", "Qui voit quoi, avec aperçu"],
      ["builder", "🎨 Apparence du site", "Thème, fond, navigation, CSS"],
      ["ecosystem", "🌍 Écosystème", "Serveurs et indicateurs"],
    ];
    const heads = {
      page: pageHead("Créateur / Site builder", "Construisez votre page", "Ajoutez, réordonnez et modifiez les blocs de votre page d'accueil : bannière, cartes, chiffres, galerie, FAQ, annonces…"),
      bots: pageHead("Créateur / Bots", "Mes bots", "Déclarez ici tous vos bots — il n'y a aucune limite. Reliez-les à votre agent pour récupérer leurs vrais serveurs."),
      perms: pageHead("Créateur / Permissions", "Fonctions & grades", "Toutes les fonctions du bot et toutes les pages du site : choisissez qui y a accès, et prévisualisez le site avec les yeux d'un grade."),
      builder: pageHead("Créateur / Site builder", "Apparence du site", "Identité, thème, fond animé ou image, navigation, effets et CSS libre — appliqués en direct."),
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
    { id: "cmd.embed", cat: "⚙️ Configuration", label: "/embed", desc: "Composer un embed envoyé par le bot", g: ["staff", "admin"] },
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
            <button type="button" class="btn danger small" data-action="bot-remove">🗑</button>
          </div>
        </div>
        <div class="form-grid">
          <div class="field"><label>Nom affiché</label><input class="input" data-f="name" value="${esc(bot.name || "")}" placeholder="Colmar RP"></div>
          <div class="field"><label>Étiquette</label><input class="input" data-f="tag" value="${esc(bot.tag || "")}" placeholder="BOT RP"></div>
          <div class="field"><label>Couleur</label><select class="select" data-f="accent">${ACCENTS.map(a => `<option value="${a.value}"${(bot.accent || "cyan") === a.value ? " selected" : ""}>${a.label}</option>`).join("")}</select></div>
          <div class="field full"><label>Description</label><input class="input" data-f="description" value="${esc(bot.description || "")}" placeholder="Ce que fait ce bot"></div>
          <div class="field"><label>Nom chez l'agent</label><input class="input" data-f="agentName" value="${esc(bot.agentName || "")}" placeholder="Colmar_rp">
            <span class="field-note">Le nom EXACT du bot dans votre panel / dossier bots/.</span></div>
          <div class="field"><label>Client ID Discord</label><input class="input" data-f="clientId" value="${esc(bot.clientId || "")}" placeholder="123456789012345678">
            <span class="field-note">Sert au lien « Inviter ce bot ».</span></div>
        </div>
      </div>`).join("");
    return `
      <div class="builder-hint">🤖 Ajoutez <b>autant de bots que vous voulez</b>. Renseignez le « nom chez l'agent » puis cliquez sur <b>Synchroniser</b> : le site récupère les vrais serveurs de chaque bot.</div>
      <section class="panel"><div class="panel-inner">
        <div class="panel-head"><div><h3>Mes bots</h3><p>${bots.length} bot(s) déclaré(s) — aucune limite.</p></div>
          <div class="page-actions">${button("🔄 Synchroniser avec l'agent", "bots-sync", "ghost")}${button("💾 Enregistrer les bots", "bots-save", "success")}</div></div>
        <div id="bots-list">${rows || emptyBlock("Aucun bot", "Ajoutez votre premier bot ci-dessous.")}</div>
        <div style="margin-top:12px">${button("➕ Ajouter un bot", "bot-add", "primary")}</div>
      </div></section>
      <section class="panel mt-16"><div class="panel-inner">
        <div class="panel-head"><div><h3>🔗 Liaison à vos bots</h3><p>Renseignée une seule fois dans <code>config.php</code>, à côté de index.php.</p></div></div>
        <div class="row" style="flex-direction:column;align-items:flex-start;gap:6px">
          <span><b>SITE_AGENT_URL</b> — l'adresse de votre agent, ex. <code>http://123.45.67.89:9999</code></span>
          <span><b>SITE_AGENT_KEY</b> — la même clé que dans votre dashboard</span>
          <span style="color:var(--muted)">Sans ces deux valeurs, le site fonctionne avec des données de démonstration.</span>
        </div>
        <div id="sync-report" style="margin-top:12px"></div>
      </div></section>`;
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
    const bgType = ["image", "aurora", "stars", "grid", "none"].includes(s.bgType) ? s.bgType : "image";
    const bgChoice = (id, label, note, thumbStyle) => `
      <div class="bg-choice ${bgType === id ? "on" : ""}" data-action="pick-bg" data-bg="${id}">
        <div class="thumb" style="${thumbStyle}"></div>
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
    const background = `<section class="panel"><div class="panel-inner"><div class="panel-head"><div><h3>🌌 Fond du site</h3><p>Une image (ou un GIF animé) à vous, ou un fond animé généré.</p></div></div>
      <div class="bg-choices">
        ${bgChoice("image", "Image / GIF", "votre visuel", `background-image:url('${esc(String(s.bgImage || "assets/images/aincrad-bg.jpg").replaceAll("'", "%27"))}')`)}
        ${bgChoice("aurora", "Aurora", "dégradé animé", "background:radial-gradient(60% 80% at 25% 20%, rgba(169,112,255,.6), transparent 60%), radial-gradient(50% 70% at 80% 60%, rgba(79,140,255,.45), transparent 60%), #0b090e")}
        ${bgChoice("stars", "Étoiles", "ciel dérivant", "background:radial-gradient(2px 2px at 25% 30%, #fff, transparent 55%), radial-gradient(1.5px 1.5px at 60% 65%, rgba(255,255,255,.8), transparent 55%), radial-gradient(1.5px 1.5px at 80% 25%, rgba(255,255,255,.7), transparent 55%), #0b090e")}
        ${bgChoice("grid", "Grille", "trame discrète", "background:linear-gradient(rgba(169,112,255,.25) 1px, transparent 1px), linear-gradient(90deg, rgba(169,112,255,.25) 1px, transparent 1px), #0b090e; background-size:11px 11px")}
        ${bgChoice("none", "Uni", "couleur sombre", "background:#0b090e")}
      </div>
      <input type="hidden" name="bgType" value="${esc(bgType)}">
      <div class="form-grid mt-22">
        ${inputField("bgImage", "URL de l'image de fond", s.bgImage || "assets/images/aincrad-bg.jpg", "text", "Collez une URL (PNG, JPG, WEBP, GIF animé) — ou téléversez ci-dessous.")}
        ${inputField("bgOverlay", "Assombrissement du fond", s.bgOverlay ?? 62, "range", "0 = image pure, 92 = presque noir.", 'min="0" max="92" step="1"')}
        ${inputField("bgBlur", "Flou du fond", s.bgBlur ?? 0, "range", "0 à 24 pixels.", 'min="0" max="24" step="1"')}
      </div>
    </div></section>`;
    // Le téléversement est un formulaire séparé (un <form> ne peut pas en
    // contenir un autre) — affiché juste sous la section « Fond du site ».
    const uploadSection = `<section class="panel mt-16"><div class="panel-inner"><div class="panel-head"><div><h3>📤 Téléverser un fond</h3><p>Depuis votre PC — PNG, JPG, WEBP ou GIF animé (10 Mo max). Il devient immédiatement le fond du site.</p></div></div>
      <form data-form="bg-upload" enctype="multipart/form-data" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <input class="input" type="file" name="background" accept="image/png,image/jpeg,image/webp,image/gif" required style="max-width:340px">
        <button class="btn primary" type="submit">Téléverser et appliquer</button>
      </form>
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
      <form data-form="site-config" id="site-builder-form">${identity}<div class="mt-16">${theme}</div><div class="mt-16">${background}</div><div class="mt-16">${boot}</div><div class="mt-16">${navigation}</div><div class="mt-16">${effects}</div><div class="mt-16">${advanced}</div>
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
    setTimeout(scrollChatToBottom, 0);
  }

  // Applique TOUTE la configuration du builder (accent, police, boutons,
  // rayon, fond, effets, CSS personnalisé). Accepte une config temporaire
  // pour l'aperçu en direct pendant l'édition.
  function applySitePreferences(cfg = siteConfig()) {
    const root = document.documentElement;
    const accent = accentHex(cfg);
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-rgb", hexToRgb(accent));
    const radius = Math.min(30, Math.max(0, Number(cfg.radius ?? 18)));
    root.style.setProperty("--radius", `${radius}px`);
    document.body.dataset.font = ["exo", "inter", "poppins", "orbitron"].includes(cfg.font) ? cfg.font : "exo";
    document.body.dataset.btnstyle = ["pill", "rounded", "square", "cut"].includes(cfg.buttonStyle) ? cfg.buttonStyle : "pill";

    // Fond du site : image téléversée / URL, ou fond animé.
    const bgType = ["image", "aurora", "stars", "grid", "none"].includes(cfg.bgType) ? cfg.bgType : "image";
    document.body.dataset.bg = bgType;
    if (bgType === "image") {
      // URL absolue : dans une variable CSS, une URL relative serait résolue
      // depuis le fichier .css (assets/css/) et non depuis la page.
      let image = String(cfg.bgImage || "assets/images/aincrad-bg.jpg");
      try { image = new URL(image, document.baseURI).href; } catch (_) {}
      image = image.replaceAll('"', "%22");
      root.style.setProperty("--bg-image", `url("${image}")`);
      root.style.setProperty("--bg-overlay", String(Math.min(92, Math.max(0, Number(cfg.bgOverlay ?? 62))) / 100));
      root.style.setProperty("--bg-blur", `${Math.min(24, Math.max(0, Number(cfg.bgBlur ?? 0)))}px`);
    }

    // Effets activables un par un.
    document.body.classList.toggle("reduce-effects", cfg.animations === false);
    document.body.classList.toggle("compact", cfg.compactMode === true);
    const particleField = document.querySelector("#particle-field");
    if (particleField) particleField.style.display = cfg.particles === false ? "none" : "block";
    const scan = document.querySelector(".scanline");
    if (scan) scan.style.display = cfg.scanline === false ? "none" : "block";
    if (cursorAura) cursorAura.style.display = cfg.cursorAura === false ? "none" : "block";

    // CSS personnalisé du créateur (pouvoir total sur le style).
    let customTag = document.querySelector("#site-custom-css");
    if (!customTag) {
      customTag = document.createElement("style");
      customTag.id = "site-custom-css";
      document.head.appendChild(customTag);
    }
    customTag.textContent = String(cfg.customCss || "").slice(0, 20000);
    document.title = cfg.siteName || "Aincrad Control Panel";

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
    openModal("Ajouter à la blacklist", `
      <form data-form="blacklist-add"><div class="form-grid">
        ${inputField("username", "Nom Discord", "", "text", "Exemple : DarkBlade_X", "required")}
        ${inputField("discordId", "Identifiant Discord", "", "text", "17 à 20 chiffres.", "required pattern=\\d{15,22}")}
        ${selectField("severity", "Sévérité", "moyenne", ["faible","moyenne","élevée","critique"])}
        ${selectField("server", "Serveur concerné", state.servers?.[0]?.name || "Global", ["Global", ...(state.servers || []).map(server=>server.name)])}
        ${textAreaField("reason", "Motif complet", "", "Décrivez précisément les faits, les avertissements et le contexte.")}
      </div><div class="form-actions"><button class="btn ghost" type="button" data-action="close-modal">Annuler</button><button class="btn danger" type="submit">Confirmer la sanction</button></div></form>`);
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
          navigate("server");
          break;
        case "select-module":
          ui.module = target.dataset.module || "overview";
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
          const hidden = document.querySelector('#site-builder-form input[name="bgType"]');
          if (hidden) hidden.value = target.dataset.bg;
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
          ui.route = "gate";
          render();
          window.scrollTo({ top: 0, behavior: "smooth" });
          break;
        case "creator-tab":
          ui.creatorTab = target.dataset.tab;
          render();
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
        case "open-proof-modal":
          openProofModal(target.dataset.id);
          break;
        case "delete-blacklist":
          if (confirm("Retirer définitivement cette entrée de la blacklist ?")) {
            await api("blacklist.delete", { id: target.dataset.id });
            render();
            toast("BLACKLIST", "L'entrée a été retirée.");
          }
          break;
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
          target.classList.add("animating");
          const response = await fetch(`${window.AINCRAD_API}?action=state`);
          const payload = await response.json();
          if (payload.ok) state = payload.state;
          render();
          toast("SYNCHRONISATION", "Le Cardinal System est à jour.");
          break;
        case "show-notifications":
          showNotifications();
          break;
        case "invite-bot":
          openModal("Ajouter le bot à un serveur", `<div class="empty"><div><strong>Connexion Discord OAuth2</strong><span>Branchez ici votre URL d'autorisation Discord avec les permissions nécessaires au bot.</span><div class="form-actions" style="justify-content:center"><button class="btn primary" data-action="close-modal">Compris</button></div></div></div>`);
          break;
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
  function livePreview() {
    const form = document.querySelector("#site-builder-form");
    if (!form) return;
    applySitePreferences({ ...siteConfig(), ...collectSiteConfig(form) });
  }
  document.addEventListener("input", event => {
    if (event.target.closest("#site-builder-form")) livePreview();
  });

  document.addEventListener("change", async event => {
    const target = event.target;
    if (target.closest("#site-builder-form")) livePreview();
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
          await api("blacklist.add", values);
          closeModal();
          render();
          toast("BLACKLIST", `${values.username} a été ajouté à la base globale.`);
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
        case "module": {
          const settings = formToObject(form);
          await api("server.module.save", { serverId: ui.selectedServerId, module: form.dataset.module, settings });
          render();
          toast("MODULE ENREGISTRÉ", `${modules.find(item=>item.id===form.dataset.module)?.label || "Configuration"} a été mis à jour.`);
          break;
        }
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
          await api("site.background.upload", {}, { formData: data });
          render();
          toast("FOND APPLIQUÉ", "Votre image est désormais le fond du site.");
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
    field.innerHTML = Array.from({ length: 22 }, (_, index) => {
      const left = (index * 37 + 11) % 100;
      const size = 3 + (index % 4) * 2;
      const duration = 12 + (index % 7) * 2.3;
      const delay = -(index % 9) * 2.1;
      return `<i class="particle" style="left:${left}%;--size:${size}px;--dur:${duration}s;--delay:${delay}s"></i>`;
    }).join("");
  }

  window.addEventListener("mousemove", event => {
    if (cursorAura) {
      cursorAura.style.left = `${event.clientX}px`;
      cursorAura.style.top = `${event.clientY}px`;
    }
    // Parallaxe du fond (désactivable dans le builder).
    if (!sky || siteConfig().parallax === false) return;
    const x = (event.clientX / innerWidth - .5) * 8;
    const y = (event.clientY / innerHeight - .5) * 5;
    sky.style.transform = `scale(1.04) translate(${x}px, ${y}px)`;
  }, { passive: true });

  window.addEventListener("load", () => {
    createParticles();
    render();
    // Durée de l'écran de démarrage réglée dans le builder (0 = désactivé).
    const cfg = siteConfig();
    const delay = cfg.bootScreen === false ? 0 : Math.min(4000, Math.max(0, Number(cfg.bootDuration ?? 650)));
    setTimeout(() => boot.classList.add("is-hidden"), delay);
  });
})();
