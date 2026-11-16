/* ============================================================================
   AutoSponsorAds - Frontend Application Controller (v3.0)
   Layout: Left Sidebar Menu | Center Workspace (List & Timeline) | Right Status
   Theme: Carbon Black & Neon Green | Zero Emojis | Meta POST Only
============================================================================ */

const SESSION_TOKEN_KEY = "autosponsor_session_token";

const state = {
  authenticated: false,
  setupRequired: false,
  automations: [],
  adAccounts: [],
  campaignsByAccount: {},
  adsetsByCampaign: {},
  rulesByAccount: {},
  sourcesByAccount: {},
  manualPosts: [],
  manualSelectedPostIds: new Set(),
  pubblieStatus: { configured: false, connection: { ok: false } },
  pubblieProjects: [],
  archivedProjectIds: [],
  pubblieMappings: [],
  timelineItems: [],
  timelineStats: {
    total: 0,
    upcomingCount: 0,
    includedCount: 0,
    excludedCount: 0,
    sponsoredCount: 0,
    externalCount: 0,
    mappingsCount: 0
  },
  nextCheckInfo: null,
  countdownTimerId: null
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function getStoredSessionToken() {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function setStoredSessionToken(token) {
  try {
    if (token) {
      localStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {}
}

// ============================================================================
// Authentication & Session Protection
// ============================================================================
async function checkAuthStatus() {
  try {
    const token = getStoredSessionToken();
    const headers = token ? { "x-session-token": token } : {};
    const res = await fetch("/api/auth/status", {
      headers,
      credentials: "same-origin",
      cache: "no-store"
    });
    const data = await res.json();
    state.authenticated = Boolean(data.authenticated);
    state.setupRequired = Boolean(data.setupRequired);
    return data;
  } catch (err) {
    console.error("Auth check failed:", err);
    return { authenticated: false, setupRequired: false };
  }
}

function updateAuthUI() {
  const overlay = $("#authOverlay");
  const setupGroup = $("#authSetupGroup");
  const loginGroup = $("#authLoginGroup");
  const infoBanner = $("#authInfoBanner");
  const submitText = $("#authSubmitBtnText");
  const subtitle = $("#authSubtitle");

  if (state.authenticated) {
    overlay?.classList.add("hidden");
    return;
  }

  overlay?.classList.remove("hidden");
  if (state.setupRequired) {
    if (setupGroup) setupGroup.style.display = "block";
    if (loginGroup) loginGroup.style.display = "none";
    if (subtitle) subtitle.textContent = "Configurazione Iniziale Sicurezza";
    if (infoBanner) {
      infoBanner.innerHTML = "<strong>Benvenuto su AutoSponsorAds!</strong> Imposta una <strong>Master Password</strong> per proteggere l'accesso al pannello.";
    }
    if (submitText) submitText.textContent = "Imposta Password e Accedi";
    const newInput = $("#authNewPassword");
    if (newInput) newInput.required = true;
    const pwdInput = $("#authPassword");
    if (pwdInput) pwdInput.required = false;
  } else {
    if (setupGroup) setupGroup.style.display = "none";
    if (loginGroup) loginGroup.style.display = "block";
    if (subtitle) subtitle.textContent = "Pannello Protetto - Meta Ads";
    if (infoBanner) {
      infoBanner.innerHTML = "Inserisci la <strong>Master Password</strong> per accedere al pannello e gestire le inserzioni dei clienti Meta.";
    }
    if (submitText) submitText.textContent = "Sblocca Accesso";
    const newInput = $("#authNewPassword");
    if (newInput) newInput.required = false;
    const pwdInput = $("#authPassword");
    if (pwdInput) pwdInput.required = true;
  }
}

function bindAuthEvents() {
  const authForm = $("#authForm");
  const alertBox = $("#authAlert");
  const spinner = $("#authSpinner");
  const submitBtn = $("#authSubmitBtn");

  $("#togglePwdBtn")?.addEventListener("click", () => {
    const inp = $("#authPassword");
    if (!inp) return;
    const isPwd = inp.type === "password";
    inp.type = isPwd ? "text" : "password";
    $("#togglePwdBtn").textContent = isPwd ? "NASCONDI" : "MOSTRA";
  });

  $("#toggleNewPwdBtn")?.addEventListener("click", () => {
    const inp = $("#authNewPassword");
    if (!inp) return;
    const isPwd = inp.type === "password";
    inp.type = isPwd ? "text" : "password";
    $("#toggleNewPwdBtn").textContent = isPwd ? "NASCONDI" : "MOSTRA";
  });

  authForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (alertBox) alertBox.style.display = "none";
    if (spinner) spinner.style.display = "inline-block";
    if (submitBtn) submitBtn.disabled = true;

    try {
      const endpoint = state.setupRequired ? "/api/auth/setup" : "/api/auth/login";
      const password = state.setupRequired
        ? ($("#authNewPassword")?.value || "").trim()
        : ($("#authPassword")?.value || "").trim();

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password })
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Autenticazione fallita");
      }

      if (data.token) {
        setStoredSessionToken(data.token);
      }

      state.authenticated = true;
      state.setupRequired = false;
      updateAuthUI();
      await bootDashboardData();
    } catch (err) {
      if (alertBox) {
        alertBox.textContent = err.message;
        alertBox.style.display = "block";
      }
    } finally {
      if (spinner) spinner.style.display = "none";
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  $("#logoutBtn")?.addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch {}
    setStoredSessionToken("");
    state.authenticated = false;
    updateAuthUI();
  });
}

// ============================================================================
// API Helper & Global Banner
// ============================================================================
async function api(url, options = {}) {
  const token = getStoredSessionToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { "x-session-token": token } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && !url.startsWith("/api/auth/") && (data.code === "SESSION_UNAUTHORIZED" || data.error === "UNAUTHORIZED")) {
    setStoredSessionToken("");
    state.authenticated = false;
    updateAuthUI();
    throw new Error("Sessione scaduta o non autorizzata. Effettua nuovamente l'accesso.");
  }

  if (!res.ok || data.error) {
    throw new Error(data.error || `Errore richiesta HTTP (${res.status})`);
  }
  return data;
}

function showBanner(message, type = "info") {
  const banner = $("#globalBanner");
  const text = $("#globalBannerText");
  const icon = banner?.querySelector(".banner-icon");
  if (!banner || !text) return;

  banner.className = `banner ${type}`;
  if (icon) {
    icon.textContent = type === "error" ? "[ERRORE]" : type === "success" ? "[OK]" : "[INFO]";
  }
  text.textContent = message;
  banner.hidden = false;

  clearTimeout(banner._hideTimer);
  banner._hideTimer = setTimeout(() => {
    banner.hidden = true;
  }, 7000);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateTime(iso) {
  if (!iso) return "Mai eseguito";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatTimeShort(iso) {
  if (!iso) return "--:--";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function formatDurationHMS(ms) {
  if (ms === null || ms === undefined || ms < 0) return "--:--:--";
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// ============================================================================
// Navigation Tabs
// ============================================================================
function bindNavigation() {
  $$(".nav-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.tab;
      $$(".nav-tab").forEach((b) => {
        const isActive = b === btn;
        b.classList.toggle("active", isActive);
        b.setAttribute("aria-selected", String(isActive));
      });
      $$(".app-view").forEach((view) => {
        const isMatch = view.id === targetId;
        view.classList.toggle("active", isMatch);
        view.hidden = !isMatch;
      });

      if (targetId === "timelineView") {
        loadTimelineFeed();
      } else if (targetId === "logsView") {
        loadLogsAndHistory();
      }
    });
  });

  $("#globalBannerClose")?.addEventListener("click", () => {
    const b = $("#globalBanner");
    if (b) b.hidden = true;
  });

  const cronUrlInput = $("#guideCronUrl");
  if (cronUrlInput) {
    cronUrlInput.value = `${window.location.origin}/api/cron/check-and-sponsor`;
  }

  $("#copyCronUrlBtn")?.addEventListener("click", () => {
    const val = $("#guideCronUrl")?.value || "";
    navigator.clipboard?.writeText(val);
    showBanner("URL Cron copiato negli appunti!", "success");
  });
}

// ============================================================================
// Boot & Platform Status Right Sidebar
// ============================================================================
async function bootDashboardData() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("login") === "ok") {
    showBanner("Connessione Facebook completata! Token Meta salvato per 60 giorni.", "success");
    window.history.replaceState({}, "", "/");
  } else if (params.get("login_error")) {
    showBanner(`Errore autenticazione Meta: ${params.get("login_error")}`, "error");
    window.history.replaceState({}, "", "/");
  }

  await Promise.all([
    loadStatusAndKPIs(),
    loadMetaConfig(),
    loadAutomations(),
    loadPubblieStatusAndData()
  ]);

  loadTimelineFeed();
  loadLogsAndHistory();
  startCountdownLoop();
}

async function loadStatusAndKPIs() {
  try {
    const status = await api("/api/status");

    const dbTypeEl = $("#kpiDbType");
    const dbStatusEl = $("#kpiDbStatus");
    if (dbTypeEl) dbTypeEl.textContent = status.dbType === "postgres" ? "PostgreSQL" : "SQLite";
    if (dbStatusEl) dbStatusEl.textContent = status.dbType === "postgres" ? "Cloud Persistente" : "Disco Locale";

    const metaStatusEl = $("#kpiMetaStatus");
    const metaIndEl = $("#kpiMetaIndicator");
    if (status.tokenHealth?.ok) {
      if (metaStatusEl) metaStatusEl.textContent = status.tokenHealth.user?.name || "Connesso";
      if (metaIndEl) metaIndEl.className = "status-indicator ok";
    } else {
      if (metaStatusEl) metaStatusEl.textContent = "Token Mancante o Scaduto";
      if (metaIndEl) metaIndEl.className = "status-indicator err";
    }

    const sched = status.scheduler || status.nextCheck;
    if (sched) {
      state.nextCheckInfo = {
        ...sched,
        fetchedAt: Date.now()
      };
      renderCountdownUI();
    }
  } catch (err) {
    console.warn("Status load warning:", err.message);
  }
}

function startCountdownLoop() {
  if (state.countdownTimerId) clearInterval(state.countdownTimerId);
  state.countdownTimerId = setInterval(() => {
    renderCountdownUI();
  }, 1000);
}

function renderCountdownUI() {
  const info = state.nextCheckInfo;
  const headerVal = $("#headerCountdownTimer");
  const headerDot = $("#headerTimerDot");
  const kpiVal = $("#kpiNextCheckTimer");
  const kpiSub = $("#kpiNextCheckSub");
  const kpiInd = $("#kpiNextCheckIndicator");

  if (!info || !info.hasActive) {
    if (headerVal) headerVal.textContent = "In Pausa";
    if (headerDot) headerDot.className = "timer-pulse-dot paused";
    if (kpiVal) kpiVal.textContent = "--:--:--";
    if (kpiSub) kpiSub.textContent = "Nessuna regola attiva";
    if (kpiInd) kpiInd.className = "status-indicator";
    return;
  }

  if (info.isRunning) {
    if (headerVal) headerVal.textContent = "In corso...";
    if (kpiVal) kpiVal.textContent = "ATTIVO";
    if (kpiSub) kpiSub.textContent = "Controllo post in esecuzione...";
    if (kpiInd) kpiInd.className = "status-indicator ok";
    return;
  }

  const elapsed = Date.now() - (info.fetchedAt || Date.now());
  const remaining = Math.max(0, (info.nextDueMs || 0) - elapsed);
  const formatted = formatDurationHMS(remaining);

  if (headerVal) headerVal.textContent = formatted;
  if (headerDot) headerDot.className = "timer-pulse-dot";
  if (kpiVal) kpiVal.textContent = formatted;
  if (kpiInd) kpiInd.className = "status-indicator ok";
  if (kpiSub) {
    kpiSub.textContent = info.targetAutomation
      ? `Prossima: ${info.targetAutomation.name}`
      : "Monitoraggio attivo";
  }
}

// ============================================================================
// Meta Accounts, Campaigns, AdSets & Sources Helpers
// ============================================================================
async function loadMetaConfig() {
  try {
    const cfg = await api("/api/meta/config");
    state.adAccounts = cfg.adAccounts || [];
    populateAdAccountSelectors();
  } catch (err) {
    console.warn("Meta config error:", err.message);
  }
}

function populateAdAccountSelectors() {
  const selects = [$("#autoAdAccount"), $("#manualAdAccount"), $("#mapMetaAdAccount"), $("#ptAdAccount")];
  selects.forEach((sel) => {
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = state.adAccounts.length
      ? state.adAccounts.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${escapeHtml(a.id)})</option>`).join("")
      : `<option value="">Nessun Account Ads disponibile</option>`;
    if (current && state.adAccounts.some((a) => a.id === current)) {
      sel.value = current;
    }
  });

  if (state.adAccounts.length > 0) {
    const firstAcc = state.adAccounts[0].id;
    onManualAccountChange(firstAcc);
    onMapMetaAccountChange(firstAcc);
  }
}

async function fetchSourcesForAccount(accountId) {
  if (!accountId) return { facebookPages: [], instagramAccounts: [] };
  if (state.sourcesByAccount[accountId]) return state.sourcesByAccount[accountId];
  const data = await api(`/api/meta/sources?accountId=${encodeURIComponent(accountId)}`);
  state.sourcesByAccount[accountId] = data;
  return data;
}

async function fetchCampaignsForAccount(accountId) {
  if (!accountId) return [];
  if (state.campaignsByAccount[accountId]) return state.campaignsByAccount[accountId];
  const res = await api(`/api/meta/campaigns?accountId=${encodeURIComponent(accountId)}`);
  state.campaignsByAccount[accountId] = res.data || [];
  return state.campaignsByAccount[accountId];
}

async function fetchAdsetsForCampaign(accountId, campaignId) {
  if (!accountId || !campaignId) return [];
  const key = `${accountId}_${campaignId}`;
  if (state.adsetsByCampaign[key]) return state.adsetsByCampaign[key];
  const res = await api(`/api/meta/adsets?accountId=${encodeURIComponent(accountId)}&campaignId=${encodeURIComponent(campaignId)}`);
  state.adsetsByCampaign[key] = res.data || [];
  return state.adsetsByCampaign[key];
}

async function fetchRulesForAccount(accountId) {
  if (!accountId) return [];
  if (state.rulesByAccount[accountId]) return state.rulesByAccount[accountId];
  const res = await api(`/api/meta/rules?accountId=${encodeURIComponent(accountId)}`);
  state.rulesByAccount[accountId] = res.data || [];
  return state.rulesByAccount[accountId];
}

// ============================================================================
// VIEW 1: Automations List (Elenco Strutturato, non Griglia)
// ============================================================================
async function loadAutomations() {
  try {
    const res = await api("/api/automations");
    state.automations = res.data || [];
    renderAutomations();
    updateAutomationKPIs();
    populateAutomationLinkSelect();
  } catch (err) {
    showBanner(`Errore caricamento automazioni: ${err.message}`, "error");
  }
}

function updateAutomationKPIs() {
  const total = state.automations.length;
  const active = state.automations.filter((a) => a.enabled).length;

  const badge = $("#badgeActiveCount");
  const kpiActive = $("#kpiActiveAutomations");
  const kpiTotal = $("#kpiTotalAutomations");

  if (badge) badge.textContent = String(active);
  if (kpiActive) kpiActive.textContent = String(active);
  if (kpiTotal) kpiTotal.textContent = `su ${total} totali`;
}

function renderAutomations() {
  const container = $("#automationsGrid");
  if (!container) return;

  const query = ($("#autoSearchInput")?.value || "").toLowerCase().trim();
  const statusFilter = $("#autoFilterStatus")?.value || "ALL";

  const filtered = state.automations.filter((a) => {
    if (statusFilter === "ACTIVE" && !a.enabled) return false;
    if (statusFilter === "PAUSED" && a.enabled) return false;
    if (query) {
      const hay = `${a.name} ${a.source_name} ${a.campaign_name} ${a.adset_name} ${a.filter_keywords || ""}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-box">
        <h3 style="margin: 0 0 6px; color: var(--text-primary);">Nessuna regola di automazione trovata</h3>
        <p style="margin: 0;">Clicca su <strong>+ Nuova Automazione</strong> nel menu a sinistra per configurare il monitoraggio automatico dei post Facebook o Instagram.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((auto) => {
    const isFb = auto.platform === "Facebook";
    const statusDotClass = auto.last_run_status || "IDLE";
    const intervalNum = Number(auto.check_interval_hours || 12);
    const intervalLabel = intervalNum < 1 ? `${Math.round(intervalNum * 60)} min` : `${intervalNum} ore`;

    return `
      <article class="auto-list-row ${auto.enabled ? "" : "paused"}" data-id="${escapeHtml(auto.id)}">
        <!-- Colonna 1: Stato, Piattaforma, Titolo e Sorgente -->
        <div class="auto-col-main">
          <div class="auto-row-badges">
            <span class="platform-tag ${isFb ? "fb" : "ig"}">${isFb ? "FACEBOOK" : "INSTAGRAM"}</span>
            <span class="format-tag">SOLO POST</span>
            <span class="badge-tag">${auto.enabled ? "ATTIVA" : "IN PAUSA"}</span>
          </div>
          <h3 class="auto-title" title="${escapeHtml(auto.name)}">${escapeHtml(auto.name)}</h3>
          <div class="auto-source-line" title="${escapeHtml(auto.source_name || auto.source_id)}">
            Sorgente: <strong>${escapeHtml(auto.source_name || auto.source_id)}</strong>
          </div>
        </div>

        <!-- Colonna 2: Destinazione Meta Ads e Filtri -->
        <div class="auto-col-target">
          <div class="auto-kv">
            <span>Campagna:</span>
            <strong title="${escapeHtml(auto.campaign_name || auto.campaign_id)}">${escapeHtml(auto.campaign_name || auto.campaign_id)}</strong>
          </div>
          <div class="auto-kv">
            <span>Gruppo Ads:</span>
            <strong title="${escapeHtml(auto.adset_name || auto.adset_id)}">${escapeHtml(auto.adset_name || auto.adset_id)}</strong>
          </div>
          <div class="auto-kv">
            <span>Filtro Post:</span>
            <strong>${auto.filter_keywords ? `<span class="keyword-badge">${escapeHtml(auto.filter_keywords)}</span>` : "Tutti i nuovi POST"}</strong>
          </div>
        </div>

        <!-- Colonna 3: Frequenza, Non-Retroattivita e Ultimo Controllo -->
        <div class="auto-col-schedule">
          <div class="auto-kv">
            <span>Frequenza:</span>
            <strong>Ogni ${escapeHtml(intervalLabel)} (${escapeHtml(auto.ad_status || "ACTIVE")})</strong>
          </div>
          <div class="auto-kv">
            <span>Attiva dal:</span>
            <strong>${escapeHtml(formatDateTime(auto.start_time || auto.created_at))}</strong>
          </div>
          <div class="auto-check-line" title="${escapeHtml(auto.last_run_message || "")}">
            <span class="dot-status ${escapeHtml(statusDotClass)}"></span>
            <span>Ultimo check: ${escapeHtml(formatDateTime(auto.last_checked_at))}</span>
          </div>
        </div>

        <!-- Colonna 4: Switch Attivazione e Pulsanti Azione -->
        <div class="auto-col-actions">
          <label class="toggle-switch" title="Attiva o metti in pausa la regola">
            <input type="checkbox" class="js-toggle-auto" data-id="${escapeHtml(auto.id)}" ${auto.enabled ? "checked" : ""}>
            <span class="toggle-slider"></span>
          </label>
          <button class="btn btn-secondary btn-xs js-run-auto" data-id="${escapeHtml(auto.id)}" type="button">
            Controlla Ora
          </button>
          <button class="btn btn-ghost btn-xs js-edit-auto" data-id="${escapeHtml(auto.id)}" type="button">
            Modifica
          </button>
          <button class="btn btn-danger-ghost btn-xs js-delete-auto" data-id="${escapeHtml(auto.id)}" type="button" title="Elimina regola">
            Elimina
          </button>
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll(".js-toggle-auto").forEach((chk) => {
    chk.addEventListener("change", async (e) => {
      const id = e.target.dataset.id;
      const enabled = e.target.checked;
      try {
        await api(`/api/automations/${encodeURIComponent(id)}/toggle`, {
          method: "POST",
          body: JSON.stringify({ enabled })
        });
        showBanner(`Regola ${enabled ? "attivata" : "messa in pausa"}.`, "success");
        await loadAutomations();
        await loadStatusAndKPIs();
      } catch (err) {
        e.target.checked = !enabled;
        showBanner(err.message, "error");
      }
    });
  });

  container.querySelectorAll(".js-run-auto").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Verifica...";
      try {
        const res = await api(`/api/automations/${encodeURIComponent(id)}/run`, { method: "POST" });
        const rep = res.report || {};
        showBanner(
          `Controllo completato: ${rep.postsFound || 0} POST letti, ${rep.adsCreated || 0} nuove inserzioni create.`,
          rep.errorsCount > 0 ? "error" : "success"
        );
        await loadAutomations();
        await loadStatusAndKPIs();
      } catch (err) {
        showBanner(`Errore esecuzione: ${err.message}`, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
  });

  container.querySelectorAll(".js-edit-auto").forEach((btn) => {
    btn.addEventListener("click", () => {
      const auto = state.automations.find((a) => a.id === btn.dataset.id);
      if (auto) openAutomationModal(auto);
    });
  });

  container.querySelectorAll(".js-delete-auto").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const auto = state.automations.find((a) => a.id === id);
      if (!confirm(`Vuoi eliminare definitivamente la regola "${auto?.name || id}"?`)) return;
      try {
        await api(`/api/automations/${encodeURIComponent(id)}`, { method: "DELETE" });
        showBanner("Regola eliminata.", "success");
        await loadAutomations();
        await loadStatusAndKPIs();
      } catch (err) {
        showBanner(err.message, "error");
      }
    });
  });
}

// ============================================================================
// Automation Modal Create / Edit
// ============================================================================
function bindAutomationModal() {
  $("#openNewAutoModalBtn")?.addEventListener("click", () => openAutomationModal(null));
  $("#emptyStateNewBtn")?.addEventListener("click", () => openAutomationModal(null));
  $("#closeAutoModalBtn")?.addEventListener("click", closeAutomationModal);
  $("#cancelAutoModalBtn")?.addEventListener("click", closeAutomationModal);

  $("#autoSearchInput")?.addEventListener("input", renderAutomations);
  $("#autoFilterStatus")?.addEventListener("change", renderAutomations);

  $("#autoAdAccount")?.addEventListener("change", (e) => {
    onAutoModalAccountChange(e.target.value);
  });

  $("#autoPlatform")?.addEventListener("change", () => {
    populateAutoModalSources($("#autoAdAccount")?.value);
  });

  $("#autoCampaign")?.addEventListener("change", (e) => {
    onAutoModalCampaignChange($("#autoAdAccount")?.value, e.target.value);
  });

  $("#autoAdsetFullStrategy")?.addEventListener("change", (e) => {
    const val = e.target.value;
    const row = $("#autoCloneOptionsRow");
    if (row) {
      row.style.display = (val === "CLONE_EXISTING_ADSET" || val === "CREATE_NEW_ADSET") ? "grid" : "none";
    }
  });

  $("#globalRunBtn")?.addEventListener("click", async () => {
    const btn = $("#globalRunBtn");
    const spinner = $("#globalRunSpinner");
    const text = $("#globalRunText");
    if (btn) btn.disabled = true;
    if (spinner) spinner.hidden = false;
    if (text) text.textContent = "Controllo in corso...";

    try {
      const res = await api("/api/automations/run-all", { method: "POST" });
      showBanner(
        `Controllo globale completato: eseguite ${res.result?.executedCount || 0} regole attive.`,
        "success"
      );
      await loadAutomations();
      await loadStatusAndKPIs();
    } catch (err) {
      showBanner(`Errore esecuzione globale: ${err.message}`, "error");
    } finally {
      if (btn) btn.disabled = false;
      if (spinner) spinner.hidden = true;
      if (text) text.textContent = "Esegui Tutto Ora";
    }
  });

  $("#automationForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = $("#saveAutoBtn");
    const spinner = $("#saveAutoSpinner");
    if (saveBtn) saveBtn.disabled = true;
    if (spinner) spinner.hidden = false;

    try {
      const id = $("#autoId")?.value || "";
      const accountId = $("#autoAdAccount")?.value || "";
      const accountObj = state.adAccounts.find((a) => a.id === accountId);
      const platform = $("#autoPlatform")?.value || "Facebook";
      const sourceId = $("#autoSource")?.value || "";
      const sourceOpt = $("#autoSource")?.selectedOptions?.[0];
      const sourceName = sourceOpt ? sourceOpt.textContent : sourceId;
      const pageId = sourceOpt?.dataset?.pageId || (platform === "Facebook" ? sourceId : "");

      const campaignId = $("#autoCampaign")?.value || "";
      const campaignName = $("#autoCampaign")?.selectedOptions?.[0]?.textContent || campaignId;
      const adsetId = $("#autoAdset")?.value || "";
      const adsetName = $("#autoAdset")?.selectedOptions?.[0]?.textContent || adsetId;
      const ruleId = $("#autoRule")?.value || "";
      const ruleName = ruleId ? ($("#autoRule")?.selectedOptions?.[0]?.textContent || "") : "";

      const startLocal = $("#autoStartTime")?.value;
      const startTimeIso = startLocal ? new Date(startLocal).toISOString() : new Date().toISOString();

      const payload = {
        name: ($("#autoName")?.value || "").trim(),
        platform,
        source_id: sourceId,
        source_name: sourceName,
        page_id: pageId,
        ad_account_id: accountId,
        ad_account_name: accountObj?.name || accountId,
        campaign_id: campaignId,
        campaign_name: campaignName,
        adset_id: adsetId,
        adset_name: adsetName,
        rule_id: ruleId || null,
        rule_name: ruleName,
        filter_keywords: ($("#autoKeywords")?.value || "").trim(),
        exclude_keywords: ($("#autoExcludeKeywords")?.value || "").trim(),
        ad_name_pattern: ($("#autoNamePattern")?.value || "ADV - {platform} - {post}").trim(),
        check_interval_hours: Number($("#autoInterval")?.value || 12),
        ad_status: $("#autoAdStatus")?.value || "ACTIVE",
        adset_full_strategy: $("#autoAdsetFullStrategy")?.value || "ROTATE_OLDEST",
        adset_clone_source_id: $("#autoCloneSourceAdset")?.value || null,
        adset_clone_name_pattern: ($("#autoCloneNamePattern")?.value || "{adset} - Auto {date}").trim(),
        cta_link: ($("#autoCtaLink")?.value || "").trim(),
        cta_type: $("#autoCtaType")?.value || "LEARN_MORE",
        start_time: startTimeIso,
        enabled: Boolean($("#autoEnabled")?.checked)
      };

      if (id) {
        await api(`/api/automations/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        showBanner("Regola di automazione aggiornata!", "success");
      } else {
        await api("/api/automations", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        showBanner("Nuova regola di automazione creata!", "success");
      }

      closeAutomationModal();
      await loadAutomations();
      await loadStatusAndKPIs();
    } catch (err) {
      showBanner(err.message, "error");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
      if (spinner) spinner.hidden = true;
    }
  });
}

async function openAutomationModal(auto = null) {
  const modal = $("#automationModal");
  if (!modal) return;
  modal.hidden = false;

  $("#modalTitle").textContent = auto ? "Modifica Regola di Automazione" : "Nuova Regola di Automazione";
  $("#autoId").value = auto?.id || "";
  $("#autoName").value = auto?.name || "";
  $("#autoPlatform").value = auto?.platform || "Facebook";
  $("#autoKeywords").value = auto?.filter_keywords || "";
  $("#autoExcludeKeywords").value = auto?.exclude_keywords || "";
  $("#autoInterval").value = String(auto?.check_interval_hours || 12);
  $("#autoAdStatus").value = auto?.ad_status || "ACTIVE";
  $("#autoNamePattern").value = auto?.ad_name_pattern || "ADV - {platform} - {post}";
  $("#autoAdsetFullStrategy").value = auto?.adset_full_strategy || "ROTATE_OLDEST";
  $("#autoCloneNamePattern").value = auto?.adset_clone_name_pattern || "{adset} - Auto {date}";
  $("#autoCtaLink").value = auto?.cta_link || "";
  $("#autoCtaType").value = auto?.cta_type || "LEARN_MORE";
  $("#autoEnabled").checked = auto ? Boolean(auto.enabled) : true;

  const cloneRow = $("#autoCloneOptionsRow");
  if (cloneRow) {
    const strat = $("#autoAdsetFullStrategy").value;
    cloneRow.style.display = (strat === "CLONE_EXISTING_ADSET" || strat === "CREATE_NEW_ADSET") ? "grid" : "none";
  }

  const dt = auto?.start_time ? new Date(auto.start_time) : new Date();
  const localIso = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $("#autoStartTime").value = localIso;

  const targetAcc = auto?.ad_account_id || state.adAccounts[0]?.id || "";
  if ($("#autoAdAccount")) $("#autoAdAccount").value = targetAcc;

  await onAutoModalAccountChange(targetAcc, auto);
}

function closeAutomationModal() {
  const modal = $("#automationModal");
  if (modal) modal.hidden = true;
}

async function onAutoModalAccountChange(accountId, presetAuto = null) {
  if (!accountId) return;
  await Promise.all([
    populateAutoModalSources(accountId, presetAuto?.source_id),
    populateAutoModalCampaigns(accountId, presetAuto?.campaign_id, presetAuto?.adset_id, presetAuto?.adset_clone_source_id),
    populateAutoModalRules(accountId, presetAuto?.rule_id)
  ]);
}

async function populateAutoModalSources(accountId, selectedSourceId = null) {
  const sel = $("#autoSource");
  if (!sel) return;
  sel.innerHTML = `<option value="">Caricamento sorgenti...</option>`;

  try {
    const sources = await fetchSourcesForAccount(accountId);
    const platform = $("#autoPlatform")?.value || "Facebook";
    const list = platform === "Facebook" ? (sources.facebookPages || []) : (sources.instagramAccounts || []);

    if (!list.length) {
      sel.innerHTML = `<option value="">Nessuna sorgente ${platform} trovata</option>`;
      return;
    }

    sel.innerHTML = list.map((s) =>
      `<option value="${escapeHtml(s.id)}" data-page-id="${escapeHtml(s.pageId || "")}">${escapeHtml(s.label || s.name || s.id)}</option>`
    ).join("");

    if (selectedSourceId && list.some((s) => s.id === selectedSourceId)) {
      sel.value = selectedSourceId;
    }
  } catch (err) {
    sel.innerHTML = `<option value="">Errore caricamento sorgenti</option>`;
  }
}

async function populateAutoModalCampaigns(accountId, selectedCampaignId = null, selectedAdsetId = null, selectedCloneId = null) {
  const campSel = $("#autoCampaign");
  if (!campSel) return;
  campSel.innerHTML = `<option value="">Caricamento campagne...</option>`;

  try {
    const campaigns = await fetchCampaignsForAccount(accountId);
    if (!campaigns.length) {
      campSel.innerHTML = `<option value="">Nessuna campagna trovata</option>`;
      $("#autoAdset").innerHTML = `<option value="">Nessun gruppo inserzioni</option>`;
      return;
    }

    campSel.innerHTML = campaigns.map((c) =>
      `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} (${escapeHtml(c.status)})</option>`
    ).join("");

    const targetCamp = (selectedCampaignId && campaigns.some((c) => c.id === selectedCampaignId))
      ? selectedCampaignId
      : campaigns[0].id;
    campSel.value = targetCamp;

    await onAutoModalCampaignChange(accountId, targetCamp, selectedAdsetId, selectedCloneId);
  } catch {
    campSel.innerHTML = `<option value="">Errore caricamento campagne</option>`;
  }
}

async function onAutoModalCampaignChange(accountId, campaignId, selectedAdsetId = null, selectedCloneId = null) {
  const adsetSel = $("#autoAdset");
  const cloneSel = $("#autoCloneSourceAdset");
  if (!adsetSel) return;
  adsetSel.innerHTML = `<option value="">Caricamento gruppi inserzioni...</option>`;

  try {
    const adsets = await fetchAdsetsForCampaign(accountId, campaignId);
    if (!adsets.length) {
      adsetSel.innerHTML = `<option value="">Nessun gruppo inserzioni trovato</option>`;
      return;
    }

    adsetSel.innerHTML = adsets.map((a) =>
      `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${escapeHtml(a.status)})</option>`
    ).join("");

    if (selectedAdsetId && adsets.some((a) => a.id === selectedAdsetId)) {
      adsetSel.value = selectedAdsetId;
    }

    if (cloneSel) {
      cloneSel.innerHTML = `<option value="">Usa lo stesso Gruppo Inserzioni selezionato sopra</option>` +
        adsets.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("");
      if (selectedCloneId) cloneSel.value = selectedCloneId;
    }
  } catch {
    adsetSel.innerHTML = `<option value="">Errore caricamento AdSet</option>`;
  }
}

async function populateAutoModalRules(accountId, selectedRuleId = null) {
  const ruleSel = $("#autoRule");
  if (!ruleSel) return;
  try {
    const rules = await fetchRulesForAccount(accountId);
    ruleSel.innerHTML = `<option value="">Nessuna regola automatica</option>` +
      rules.map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join("");
    if (selectedRuleId) ruleSel.value = selectedRuleId;
  } catch {
    ruleSel.innerHTML = `<option value="">Nessuna regola automatica</option>`;
  }
}

// ============================================================================
// VIEW 2: Timeline Flow & Pubblie Integration (Meta POST Only, No Duplicates)
// ============================================================================
function bindTimelineEvents() {
  $("#refreshTimelineBtn")?.addEventListener("click", () => loadTimelineFeed());
  $("#openPubblieModalBtn")?.addEventListener("click", openPubblieModal);
  $("#closePubblieModalBtn")?.addEventListener("click", closePubblieModal);
  $("#donePubblieModalBtn")?.addEventListener("click", closePubblieModal);

  $("#tlFilterProject")?.addEventListener("change", () => loadTimelineFeed());
  $("#tlFilterPlatform")?.addEventListener("change", () => loadTimelineFeed());
  $("#tlFilterStatus")?.addEventListener("change", () => loadTimelineFeed());
  $("#tlSearchInput")?.addEventListener("input", () => renderTimeline());

  $("#tlIncludeAllBtn")?.addEventListener("click", () => bulkUpdateTimelineStatus("INCLUDED"));
  $("#tlExcludeAllBtn")?.addEventListener("click", () => bulkUpdateTimelineStatus("EXCLUDED"));

  $("#savePubblieKeyBtn")?.addEventListener("click", async () => {
    const apiKey = ($("#pubblieApiKeyInput")?.value || "").trim();
    if (!apiKey) {
      showBanner("Inserisci una API Key Pubblie valida.", "error");
      return;
    }
    const btn = $("#savePubblieKeyBtn");
    btn.disabled = true;
    btn.textContent = "Connessione...";
    try {
      await api("/api/pubblie/save-key", {
        method: "POST",
        body: JSON.stringify({ apiKey })
      });
      showBanner("API Key Pubblie salvata e connessa con successo!", "success");
      $("#pubblieApiKeyInput").value = "";
      await loadPubblieStatusAndData();
      await loadTimelineFeed();
    } catch (err) {
      showBanner(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Salva e Connetti";
    }
  });

  $("#mapPubblieProject")?.addEventListener("change", (e) => {
    loadProjectChannelsForMapping(e.target.value);
  });

  $("#mapMetaAdAccount")?.addEventListener("change", (e) => {
    onMapMetaAccountChange(e.target.value);
  });

  $("#mapMetaCampaign")?.addEventListener("change", (e) => {
    onMapMetaCampaignChange($("#mapMetaAdAccount")?.value, e.target.value);
  });

  $("#pubblieMappingForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const projectId = $("#mapPubblieProject")?.value || "";
      const projectName = $("#mapPubblieProject")?.selectedOptions?.[0]?.textContent || projectId;
      const channelOpt = $("#mapPubblieChannel")?.selectedOptions?.[0];
      const channelId = $("#mapPubblieChannel")?.value || "";
      const channelName = channelOpt?.dataset?.name || channelOpt?.textContent || channelId;
      const channelProvider = channelOpt?.dataset?.provider || "meta";

      const adAccountId = $("#mapMetaAdAccount")?.value || "";
      const adAccountName = $("#mapMetaAdAccount")?.selectedOptions?.[0]?.textContent || adAccountId;
      const campaignId = $("#mapMetaCampaign")?.value || "";
      const campaignName = $("#mapMetaCampaign")?.selectedOptions?.[0]?.textContent || campaignId;
      const adsetId = $("#mapMetaAdset")?.value || "";
      const adsetName = $("#mapMetaAdset")?.selectedOptions?.[0]?.textContent || adsetId;
      const automationId = $("#mapMetaAutomation")?.value || null;
      const ctaLink = ($("#mapCtaLink")?.value || "").trim();
      const ctaType = $("#mapCtaType")?.value || "LEARN_MORE";
      const autoSponsor = Boolean($("#mapAutoSponsor")?.checked);

      await api("/api/pubblie/mappings", {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId,
          project_name: projectName,
          channel_id: channelId,
          channel_name: channelName,
          channel_provider: channelProvider,
          ad_account_id: adAccountId,
          ad_account_name: adAccountName,
          campaign_id: campaignId,
          campaign_name: campaignName,
          adset_id: adsetId,
          adset_name: adsetName,
          automation_id: automationId,
          cta_link: ctaLink,
          cta_type: ctaType,
          auto_sponsor_on_publish: autoSponsor
        })
      });

      showBanner("Mappatura canale Pubblie -> Meta Ads salvata!", "success");
      await loadPubblieStatusAndData();
      await loadTimelineFeed();
    } catch (err) {
      showBanner(err.message, "error");
    }
  });

  // Single Post Custom Target Modal
  $("#closePostTargetModalBtn")?.addEventListener("click", closePostTargetModal);
  $("#cancelPostTargetBtn")?.addEventListener("click", closePostTargetModal);

  $("#ptAdAccount")?.addEventListener("change", (e) => {
    onPtAccountChange(e.target.value);
  });

  $("#ptCampaign")?.addEventListener("change", (e) => {
    onPtCampaignChange($("#ptAdAccount")?.value, e.target.value);
  });

  $("#postTargetForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const postId = $("#ptPostId")?.value;
    if (!postId) return;

    const item = state.timelineItems.find((i) => i.id === postId);
    const adAccountId = $("#ptAdAccount")?.value || "";
    const adAccountName = $("#ptAdAccount")?.selectedOptions?.[0]?.textContent || adAccountId;
    const campaignId = $("#ptCampaign")?.value || "";
    const campaignName = $("#ptCampaign")?.selectedOptions?.[0]?.textContent || campaignId;
    const adsetId = $("#ptAdset")?.value || "";
    const adsetName = $("#ptAdset")?.selectedOptions?.[0]?.textContent || adsetId;
    const ctaLink = ($("#ptCtaLink")?.value || "").trim();
    const ctaType = $("#ptCtaType")?.value || "LEARN_MORE";

    try {
      await api("/api/timeline/decision", {
        method: "POST",
        body: JSON.stringify({
          postId,
          status: item?.flowStatus === "EXCLUDED" ? "INCLUDED" : (item?.flowStatus || "INCLUDED"),
          source: item?.source || "pubblie",
          projectId: item?.projectId || "",
          channelId: item?.channelId || "",
          postText: item?.text || "",
          postPermalink: item?.link || "",
          customTarget: {
            ad_account_id: adAccountId,
            ad_account_name: adAccountName,
            campaign_id: campaignId,
            campaign_name: campaignName,
            adset_id: adsetId,
            adset_name: adsetName,
            cta_link: ctaLink,
            cta_type: ctaType
          }
        })
      });
      closePostTargetModal();
      showBanner("Destinazione Meta personalizzata salvata per questo post!", "success");
      await loadTimelineFeed();
    } catch (err) {
      showBanner(err.message, "error");
    }
  });

  $("#resetPostTargetBtn")?.addEventListener("click", async () => {
    const postId = $("#ptPostId")?.value;
    if (!postId) return;
    const item = state.timelineItems.find((i) => i.id === postId);
    try {
      await api("/api/timeline/decision", {
        method: "POST",
        body: JSON.stringify({
          postId,
          status: item?.flowStatus || "INCLUDED",
          source: item?.source || "pubblie",
          projectId: item?.projectId || "",
          channelId: item?.channelId || "",
          customTarget: null
        })
      });
      closePostTargetModal();
      showBanner("Ripristinata la destinazione di default del canale.", "info");
      await loadTimelineFeed();
    } catch (err) {
      showBanner(err.message, "error");
    }
  });
}

async function loadPubblieStatusAndData() {
  try {
    const st = await api("/api/pubblie/status");
    state.pubblieStatus = st;

    const dot = $("#pubblieStatusDot");
    const txt = $("#pubblieStatusText");

    if (st.configured && st.connection?.ok) {
      if (dot) dot.className = "status-indicator ok";
      if (txt) txt.textContent = "Connesso";
    } else if (st.configured) {
      if (dot) dot.className = "status-indicator err";
      if (txt) txt.textContent = "Errore API Key";
    } else {
      if (dot) dot.className = "status-indicator";
      if (txt) txt.textContent = "Non configurato";
    }

    const [projRes, mapRes] = await Promise.all([
      st.configured ? api("/api/pubblie/projects").catch(() => ({ data: [], archivedProjectIds: [] })) : Promise.resolve({ data: [], archivedProjectIds: [] }),
      api("/api/pubblie/mappings").catch(() => ({ data: [] }))
    ]);

    state.pubblieProjects = projRes.data || [];
    state.archivedProjectIds = projRes.archivedProjectIds || [];
    state.pubblieMappings = mapRes.data || [];

    populatePubblieProjectSelectors();
    renderPubblieMappingsTable();
    renderPubblieProjectsVisibilityTable();
  } catch (err) {
    console.warn("Pubblie status error:", err.message);
  }
}

function populatePubblieProjectSelectors() {
  const filterSel = $("#tlFilterProject");
  const mapSel = $("#mapPubblieProject");

  const activeProjects = state.pubblieProjects.filter((p) => !state.archivedProjectIds.includes(p.id));

  if (filterSel) {
    const curr = filterSel.value;
    filterSel.innerHTML = `<option value="">Tutti i Progetti Attivi (${activeProjects.length})</option>` +
      activeProjects.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}${p.teamName ? ` (${escapeHtml(p.teamName)})` : ""}</option>`).join("");
    if (curr) filterSel.value = curr;
  }

  if (mapSel) {
    const curr = mapSel.value;
    mapSel.innerHTML = activeProjects.length
      ? activeProjects.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}${p.teamName ? ` (${escapeHtml(p.teamName)})` : ""}</option>`).join("")
      : `<option value="">Nessun progetto Pubblie attivo</option>`;
    if (curr && activeProjects.some((p) => p.id === curr)) {
      mapSel.value = curr;
    }
    if (mapSel.value) {
      loadProjectChannelsForMapping(mapSel.value);
    }
  }
}

async function loadProjectChannelsForMapping(projectId) {
  const chSel = $("#mapPubblieChannel");
  if (!chSel || !projectId) return;
  chSel.innerHTML = `<option value="">Caricamento canali...</option>`;
  try {
    const res = await api(`/api/pubblie/projects/${encodeURIComponent(projectId)}/channels`);
    const allChannels = res.data || [];
    // Filtra solo canali Facebook e Instagram per le mappature Meta Ads
    const metaChannels = allChannels.filter((c) => {
      const prov = (c.provider || "").toLowerCase();
      return prov.includes("insta") || prov.includes("face") || prov === "ig" || prov === "fb";
    });
    const channels = metaChannels.length ? metaChannels : allChannels;
    if (!channels.length) {
      chSel.innerHTML = `<option value="">Nessun canale Meta collegato in questo progetto</option>`;
      return;
    }
    chSel.innerHTML = channels.map((c) =>
      `<option value="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}" data-provider="${escapeHtml(c.provider)}">[${escapeHtml((c.provider || "SOCIAL").toUpperCase())}] ${escapeHtml(c.name)}</option>`
    ).join("");
  } catch {
    chSel.innerHTML = `<option value="">Errore caricamento canali</option>`;
  }
}

async function onMapMetaAccountChange(accountId) {
  const campSel = $("#mapMetaCampaign");
  if (!campSel || !accountId) return;
  campSel.innerHTML = `<option value="">Caricamento...</option>`;
  try {
    const campaigns = await fetchCampaignsForAccount(accountId);
    campSel.innerHTML = campaigns.length
      ? campaigns.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("")
      : `<option value="">Nessuna campagna</option>`;
    if (campaigns[0]?.id) {
      await onMapMetaCampaignChange(accountId, campaigns[0].id);
    }
  } catch {
    campSel.innerHTML = `<option value="">Errore campagne</option>`;
  }
}

async function onMapMetaCampaignChange(accountId, campaignId) {
  const adsetSel = $("#mapMetaAdset");
  if (!adsetSel || !accountId || !campaignId) return;
  adsetSel.innerHTML = `<option value="">Caricamento...</option>`;
  try {
    const adsets = await fetchAdsetsForCampaign(accountId, campaignId);
    adsetSel.innerHTML = adsets.length
      ? adsets.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("")
      : `<option value="">Nessun gruppo inserzioni</option>`;
  } catch {
    adsetSel.innerHTML = `<option value="">Errore AdSet</option>`;
  }
}

function populateAutomationLinkSelect() {
  const sel = $("#mapMetaAutomation");
  if (!sel) return;
  sel.innerHTML = `<option value="">Nessuna (solo mappatura Timeline)</option>` +
    state.automations.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${escapeHtml(a.platform)})</option>`).join("");
}

function renderPubblieMappingsTable() {
  const tbody = $("#pubblieMappingsTableBody");
  if (!tbody) return;

  if (!state.pubblieMappings.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-muted);">Nessuna mappatura configurata.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.pubblieMappings.map((m) => `
    <tr>
      <td>
        <strong>${escapeHtml(m.project_name)}</strong><br>
        <small style="color: var(--text-secondary);">[${escapeHtml((m.channel_provider || "").toUpperCase())}] ${escapeHtml(m.channel_name)}</small>
      </td>
      <td>
        <strong>${escapeHtml(m.campaign_name || m.campaign_id)}</strong><br>
        <small style="color: var(--text-muted);">${escapeHtml(m.ad_account_name || m.ad_account_id)}</small>
      </td>
      <td>
        <strong>${escapeHtml(m.adset_name || m.adset_id)}</strong>
        ${m.cta_link ? `<br><small style="color: var(--neon);">CTA: ${escapeHtml(m.cta_link)}</small>` : ""}
      </td>
      <td>
        <span class="status-pill ${m.auto_sponsor_on_publish ? "SUCCESS" : "WARNING"}">
          ${m.auto_sponsor_on_publish ? "INCLUSO" : "ESCLUSO"}
        </span>
      </td>
      <td>
        <button class="btn btn-danger-ghost btn-xs js-del-mapping" data-id="${escapeHtml(m.id)}" type="button">Rimuovi</button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".js-del-mapping").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/api/pubblie/mappings/${encodeURIComponent(btn.dataset.id)}`, { method: "DELETE" });
        await loadPubblieStatusAndData();
        await loadTimelineFeed();
      } catch (err) {
        showBanner(err.message, "error");
      }
    });
  });
}

function renderPubblieProjectsVisibilityTable() {
  const tbody = $("#pubblieProjectsVisibilityBody");
  if (!tbody) return;

  if (!state.pubblieProjects.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">Nessun progetto caricato.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.pubblieProjects.map((p) => {
    const isArchived = state.archivedProjectIds.includes(p.id);
    return `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${escapeHtml(p.teamName || "-")}</td>
        <td>
          <span class="status-pill ${isArchived ? "WARNING" : "SUCCESS"}">
            ${isArchived ? "NASCOSTO" : "VISIBILE"}
          </span>
        </td>
        <td>
          <button class="btn btn-secondary btn-xs js-toggle-proj-vis" data-id="${escapeHtml(p.id)}" type="button">
            ${isArchived ? "Mostra nella Timeline" : "Nascondi"}
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".js-toggle-proj-vis").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pid = btn.dataset.id;
      const next = state.archivedProjectIds.includes(pid)
        ? state.archivedProjectIds.filter((x) => x !== pid)
        : [...state.archivedProjectIds, pid];
      try {
        await api("/api/pubblie/archived-projects", {
          method: "POST",
          body: JSON.stringify({ archivedProjectIds: next })
        });
        state.archivedProjectIds = next;
        populatePubblieProjectSelectors();
        renderPubblieProjectsVisibilityTable();
        await loadTimelineFeed();
      } catch (err) {
        showBanner(err.message, "error");
      }
    });
  });
}

function openPubblieModal() {
  const modal = $("#pubblieModal");
  if (modal) modal.hidden = false;
}

function closePubblieModal() {
  const modal = $("#pubblieModal");
  if (modal) modal.hidden = true;
}

async function loadTimelineFeed() {
  const spinner = $("#refreshTimelineSpinner");
  if (spinner) spinner.hidden = false;

  try {
    const projectId = $("#tlFilterProject")?.value || "";
    const platform = $("#tlFilterPlatform")?.value || "meta";
    const status = $("#tlFilterStatus")?.value || "";

    const qs = new URLSearchParams({
      projectId,
      platform,
      status,
      days: "30"
    });

    const res = await api(`/api/timeline/feed?${qs.toString()}`);
    state.timelineItems = res.data || [];
    state.timelineStats = res.stats || state.timelineStats;
    if (res.mappings) state.pubblieMappings = res.mappings;

    renderTimelineStats();
    renderTimeline();
  } catch (err) {
    showBanner(`Errore caricamento Timeline: ${err.message}`, "error");
  } finally {
    if (spinner) spinner.hidden = true;
  }
}

function renderTimelineStats() {
  const st = state.timelineStats;
  const badge = $("#badgeTimelineCount");
  if (badge) badge.textContent = String(st.upcomingCount || st.total || 0);

  if ($("#tlStatUpcoming")) $("#tlStatUpcoming").textContent = String(st.upcomingCount || 0);
  if ($("#tlStatIncluded")) $("#tlStatIncluded").textContent = String(st.includedCount || 0);
  if ($("#tlStatExcluded")) $("#tlStatExcluded").textContent = String(st.excludedCount || 0);
  if ($("#tlStatSponsored")) $("#tlStatSponsored").textContent = String(st.sponsoredCount || 0);
  if ($("#tlStatExternal")) $("#tlStatExternal").textContent = "0";
}

function renderTimeline() {
  const container = $("#timelineFlowContainer");
  if (!container) return;

  const search = ($("#tlSearchInput")?.value || "").toLowerCase().trim();
  const filtered = state.timelineItems.filter((item) => {
    // Sicurezza extra lato client: mostra solo Facebook e Instagram in formato POST
    const plat = (item.platform || "").toLowerCase();
    if (plat !== "facebook" && plat !== "instagram") return false;
    if (!search) return true;
    const hay = `${item.text || ""} ${item.projectName || ""} ${item.channelName || ""} ${item.platform || ""}`.toLowerCase();
    return hay.includes(search);
  });

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-box">
        <h3 style="margin: 0 0 6px; color: var(--text-primary);">Nessun POST Facebook o Instagram in programma per i filtri selezionati</h3>
        <p style="margin: 0;">Verifica la configurazione di Pubblie o cambia i filtri sopra. Ricorda che vengono mostrati esclusivamente i post in formato POST su canali Facebook e Instagram.</p>
      </div>
    `;
    return;
  }

  // Group chronologically by calendar day
  const groups = new Map();
  filtered.forEach((item) => {
    const dt = new Date(item.effectiveDate);
    const dayKey = isNaN(dt.getTime()) ? "Senza Data" : dt.toISOString().slice(0, 10);
    if (!groups.has(dayKey)) groups.set(dayKey, []);
    groups.get(dayKey).push(item);
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const tomorrowIso = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  container.innerHTML = Array.from(groups.entries()).map(([dayKey, dayItems]) => {
    let dayLabel = dayKey;
    if (dayKey === todayIso) {
      dayLabel = "OGGI - " + new Date(dayKey).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
    } else if (dayKey === tomorrowIso) {
      dayLabel = "DOMANI - " + new Date(dayKey).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
    } else if (dayKey !== "Senza Data") {
      dayLabel = new Date(dayKey).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    }

    return `
      <div class="timeline-day-group">
        <div class="timeline-day-header">
          <span class="timeline-day-badge">${escapeHtml(dayLabel)}</span>
          <span class="timeline-day-count">${dayItems.length} POST META</span>
        </div>
        <div class="timeline-day-list">
          ${dayItems.map((item) => renderTimelineRow(item)).join("")}
        </div>
      </div>
    `;
  }).join("");

  // Bind Timeline Row Actions
  container.querySelectorAll(".js-tl-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const nextStatus = btn.dataset.next;
      const item = state.timelineItems.find((i) => i.id === id);
      try {
        await api("/api/timeline/decision", {
          method: "POST",
          body: JSON.stringify({
            postId: id,
            status: nextStatus,
            source: item?.source || "pubblie",
            projectId: item?.projectId || "",
            channelId: item?.channelId || "",
            customTarget: item?.customTarget || null,
            postText: item?.text || "",
            postPermalink: item?.link || ""
          })
        });
        await loadTimelineFeed();
      } catch (err) {
        showBanner(err.message, "error");
      }
    });
  });

  container.querySelectorAll(".js-tl-custom-target").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = state.timelineItems.find((i) => i.id === btn.dataset.id);
      if (item) openPostTargetModal(item);
    });
  });

  container.querySelectorAll(".js-tl-open-mapping").forEach((btn) => {
    btn.addEventListener("click", () => openPubblieModal());
  });

  container.querySelectorAll(".js-tl-sponsor-now").forEach((btn) => {
    btn.addEventListener("click", () => sponsorTimelinePostNow(btn.dataset.id, btn));
  });
}

function renderTimelineRow(item) {
  const isIg = item.platform === "Instagram";
  const statusClass = item.flowStatus === "SPONSORED"
    ? "status-sponsored"
    : item.flowStatus === "EXCLUDED"
      ? "status-excluded"
      : "status-included";

  const statusPillClass = item.flowStatus === "SPONSORED"
    ? "sponsored"
    : item.flowStatus === "EXCLUDED"
      ? "excluded"
      : "included";

  const statusLabel = item.flowStatus === "SPONSORED"
    ? "SPONSORIZZATO"
    : item.flowStatus === "EXCLUDED"
      ? "ESCLUSO DAL FLOW"
      : "INCLUSO NEL FLOW";

  const target = item.customTarget || item.mapping;
  const imgUrl = item.images?.[0] || "";

  let targetHtml = "";
  if (target) {
    targetHtml = `
      <div class="tl-target-header">
        <span class="tl-target-title">${item.customTarget ? "TARGET PERSONALIZZATO" : "DESTINAZIONE META ADS"}</span>
      </div>
      <div class="auto-kv"><span>Account:</span> <strong>${escapeHtml(target.ad_account_name || target.ad_account_id)}</strong></div>
      <div class="auto-kv"><span>Campagna:</span> <strong>${escapeHtml(target.campaign_name || target.campaign_id)}</strong></div>
      <div class="auto-kv"><span>Gruppo Ads:</span> <strong>${escapeHtml(target.adset_name || target.adset_id)}</strong></div>
      ${target.cta_link ? `<div class="auto-kv"><span>URL CTA:</span> <strong>${escapeHtml(target.cta_link)}</strong></div>` : ""}
    `;
  } else {
    targetHtml = `
      <div class="tl-target-unmapped">
        Canale non ancora associato a una campagna Meta Ads.
        <div style="margin-top: 6px;">
          <button class="btn btn-secondary btn-xs js-tl-open-mapping" type="button">Configura Mappatura Canale</button>
        </div>
      </div>
    `;
  }

  return `
    <article class="tl-post-row ${statusClass}" data-id="${escapeHtml(item.id)}">
      <!-- Colonna 1: Orario, Piattaforma, Formato POST e Canale -->
      <div class="tl-col-meta">
        <div class="tl-time-box">
          <span class="tl-time-val">${escapeHtml(formatTimeShort(item.effectiveDate))}</span>
          <span class="tl-pub-state">${item.isFuture ? "PROGRAMMATO" : "PUBBLICATO"}</span>
        </div>
        <div class="auto-row-badges">
          <span class="platform-tag ${isIg ? "ig" : "fb"}">${isIg ? "INSTAGRAM" : "FACEBOOK"}</span>
          <span class="format-tag">POST</span>
        </div>
        <div class="tl-channel-title" title="${escapeHtml(item.channelName)}">${escapeHtml(item.channelName)}</div>
        <div class="tl-project-sub" title="${escapeHtml(item.projectName)}">${escapeHtml(item.projectName)}</div>
      </div>

      <!-- Colonna 2: Anteprima Media e Testo del Post -->
      <div class="tl-col-content">
        <div class="tl-thumb">
          ${imgUrl
            ? `<img src="${escapeHtml(imgUrl)}" alt="Anteprima post" loading="lazy">`
            : `<span class="tl-thumb-placeholder">POST</span>`}
        </div>
        <div class="tl-text-wrap">
          <p class="tl-post-copy" title="${escapeHtml(item.text || "")}">
            ${escapeHtml(item.text || "(Post senza didascalia testuale)")}
          </p>
          <span class="tl-post-id">ID: ${escapeHtml(String(item.rawId || item.id).slice(-10))}</span>
        </div>
      </div>

      <!-- Colonna 3: Destinazione Meta Ads -->
      <div class="tl-col-target">
        ${targetHtml}
      </div>

      <!-- Colonna 4: Stato nel Flow e Azioni -->
      <div class="tl-col-actions">
        <span class="tl-flow-status-pill ${statusPillClass}">${statusLabel}</span>
        ${item.flowStatus !== "SPONSORED" ? `
          <div class="tl-action-btns">
            ${item.flowStatus === "INCLUDED"
              ? `<button class="btn btn-ghost btn-xs js-tl-toggle" data-id="${escapeHtml(item.id)}" data-next="EXCLUDED" type="button">Escludi dal Flow</button>`
              : `<button class="btn btn-primary btn-xs js-tl-toggle" data-id="${escapeHtml(item.id)}" data-next="INCLUDED" type="button">Includi nel Flow</button>`
            }
            <button class="btn btn-secondary btn-xs js-tl-custom-target" data-id="${escapeHtml(item.id)}" type="button" title="Scegli Campagna e Gruppo Inserzioni per questo post">
              Target Ads
            </button>
          </div>
          <button class="btn btn-secondary btn-xs btn-block js-tl-sponsor-now" data-id="${escapeHtml(item.id)}" type="button">
            Sponsorizza Ora
          </button>
        ` : `
          <div style="text-align: center; font-size: 0.74rem; color: var(--neon); font-family: 'JetBrains Mono', monospace;">
            Ad ID: ${escapeHtml(item.adId || "Creata")}
          </div>
        `}
      </div>
    </article>
  `;
}

async function bulkUpdateTimelineStatus(status) {
  const eligibleIds = state.timelineItems
    .filter((i) => i.flowStatus !== "SPONSORED")
    .map((i) => i.id);

  if (!eligibleIds.length) {
    showBanner("Nessun post aggiornabile nella vista corrente.", "info");
    return;
  }

  try {
    await api("/api/timeline/bulk-decision", {
      method: "POST",
      body: JSON.stringify({ postIds: eligibleIds, status })
    });
    showBanner(
      `${eligibleIds.length} post impostati come ${status === "INCLUDED" ? "INCLUSI nel Flow" : "ESCLUSI dal Flow"}.`,
      "success"
    );
    await loadTimelineFeed();
  } catch (err) {
    showBanner(err.message, "error");
  }
}

async function openPostTargetModal(item) {
  const modal = $("#postTargetModal");
  if (!modal) return;
  modal.hidden = false;

  $("#ptPostId").value = item.id;
  const target = item.customTarget || item.mapping || {};
  const accId = target.ad_account_id || state.adAccounts[0]?.id || "";
  if ($("#ptAdAccount")) $("#ptAdAccount").value = accId;
  $("#ptCtaLink").value = target.cta_link || "";
  $("#ptCtaType").value = target.cta_type || "LEARN_MORE";

  await onPtAccountChange(accId, target.campaign_id, target.adset_id);
}

function closePostTargetModal() {
  const modal = $("#postTargetModal");
  if (modal) modal.hidden = true;
}

async function onPtAccountChange(accountId, selectedCampaignId = null, selectedAdsetId = null) {
  const campSel = $("#ptCampaign");
  if (!campSel || !accountId) return;
  campSel.innerHTML = `<option value="">Caricamento...</option>`;
  try {
    const campaigns = await fetchCampaignsForAccount(accountId);
    campSel.innerHTML = campaigns.length
      ? campaigns.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("")
      : `<option value="">Nessuna campagna</option>`;
    const targetCamp = (selectedCampaignId && campaigns.some((c) => c.id === selectedCampaignId))
      ? selectedCampaignId
      : campaigns[0]?.id;
    if (targetCamp) {
      campSel.value = targetCamp;
      await onPtCampaignChange(accountId, targetCamp, selectedAdsetId);
    }
  } catch {
    campSel.innerHTML = `<option value="">Errore campagne</option>`;
  }
}

async function onPtCampaignChange(accountId, campaignId, selectedAdsetId = null) {
  const adsetSel = $("#ptAdset");
  if (!adsetSel || !accountId || !campaignId) return;
  adsetSel.innerHTML = `<option value="">Caricamento...</option>`;
  try {
    const adsets = await fetchAdsetsForCampaign(accountId, campaignId);
    adsetSel.innerHTML = adsets.length
      ? adsets.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("")
      : `<option value="">Nessun gruppo inserzioni</option>`;
    if (selectedAdsetId && adsets.some((a) => a.id === selectedAdsetId)) {
      adsetSel.value = selectedAdsetId;
    }
  } catch {
    adsetSel.innerHTML = `<option value="">Errore AdSet</option>`;
  }
}

async function sponsorTimelinePostNow(itemId, btnEl) {
  const item = state.timelineItems.find((i) => i.id === itemId);
  if (!item) return;

  const target = item.customTarget || item.mapping;
  if (!target || !target.ad_account_id || !target.adset_id) {
    showBanner("Configura prima la Destinazione Meta Ads per questo canale o post.", "error");
    openPostTargetModal(item);
    return;
  }

  const orig = btnEl.textContent;
  btnEl.disabled = true;
  btnEl.textContent = "Invio a Meta...";

  try {
    const res = await api("/api/timeline/sponsor-now", {
      method: "POST",
      body: JSON.stringify({
        postId: item.id,
        sourcePostId: item.rawId,
        platform: item.platform,
        adAccountId: target.ad_account_id,
        adsetId: target.adset_id,
        channelId: item.channelId,
        permalink: item.link || "",
        postText: item.text || "",
        ctaLink: target.cta_link || "",
        ctaType: target.cta_type || "LEARN_MORE",
        adStatus: "ACTIVE"
      })
    });
    showBanner(`Inserzione creata con successo su Meta Ads (ID: ${res.adId})!`, "success");
    await loadTimelineFeed();
  } catch (err) {
    showBanner(err.message, "error");
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = orig;
  }
}

// ============================================================================
// VIEW 3: Manual Bulk Sponsor
// ============================================================================
function bindManualSponsorEvents() {
  $("#manualAdAccount")?.addEventListener("change", (e) => {
    onManualAccountChange(e.target.value);
  });

  $("#manualCampaign")?.addEventListener("change", (e) => {
    onManualCampaignChange($("#manualAdAccount")?.value, e.target.value);
  });

  $("#manualPlatform")?.addEventListener("change", () => {
    populateManualSources($("#manualAdAccount")?.value);
  });

  $("#manualLoadPostsBtn")?.addEventListener("click", loadManualSourcePosts);

  $("#manualSelectAllBtn")?.addEventListener("click", () => {
    state.manualPosts.forEach((p) => state.manualSelectedPostIds.add(p.id));
    renderManualPostsList();
  });

  $("#manualDeselectAllBtn")?.addEventListener("click", () => {
    state.manualSelectedPostIds.clear();
    renderManualPostsList();
  });

  $("#manualSponsorBtn")?.addEventListener("click", executeManualBulkSponsor);
}

async function onManualAccountChange(accountId) {
  if (!accountId) return;
  await Promise.all([
    populateManualSources(accountId),
    populateManualCampaigns(accountId),
    populateManualRules(accountId)
  ]);
}

async function populateManualSources(accountId) {
  const sel = $("#manualSource");
  if (!sel || !accountId) return;
  sel.innerHTML = `<option value="">Caricamento...</option>`;
  try {
    const sources = await fetchSourcesForAccount(accountId);
    const platform = $("#manualPlatform")?.value || "Facebook";
    const list = platform === "Facebook" ? (sources.facebookPages || []) : (sources.instagramAccounts || []);
    sel.innerHTML = list.length
      ? list.map((s) => `<option value="${escapeHtml(s.id)}" data-page-id="${escapeHtml(s.pageId || "")}">${escapeHtml(s.label || s.name || s.id)}</option>`).join("")
      : `<option value="">Nessuna sorgente ${platform}</option>`;
  } catch {
    sel.innerHTML = `<option value="">Errore sorgenti</option>`;
  }
}

async function populateManualCampaigns(accountId) {
  const sel = $("#manualCampaign");
  if (!sel || !accountId) return;
  sel.innerHTML = `<option value="">Caricamento...</option>`;
  try {
    const campaigns = await fetchCampaignsForAccount(accountId);
    sel.innerHTML = campaigns.length
      ? campaigns.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("")
      : `<option value="">Nessuna campagna</option>`;
    if (campaigns[0]?.id) {
      await onManualCampaignChange(accountId, campaigns[0].id);
    }
  } catch {
    sel.innerHTML = `<option value="">Errore campagne</option>`;
  }
}

async function onManualCampaignChange(accountId, campaignId) {
  const sel = $("#manualAdset");
  if (!sel || !accountId || !campaignId) return;
  sel.innerHTML = `<option value="">Caricamento...</option>`;
  try {
    const adsets = await fetchAdsetsForCampaign(accountId, campaignId);
    sel.innerHTML = adsets.length
      ? adsets.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("")
      : `<option value="">Nessun gruppo inserzioni</option>`;
  } catch {
    sel.innerHTML = `<option value="">Errore AdSet</option>`;
  }
}

async function populateManualRules(accountId) {
  const sel = $("#manualRule");
  if (!sel || !accountId) return;
  try {
    const rules = await fetchRulesForAccount(accountId);
    sel.innerHTML = `<option value="">Nessuna regola</option>` +
      rules.map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join("");
  } catch {
    sel.innerHTML = `<option value="">Nessuna regola</option>`;
  }
}

async function loadManualSourcePosts() {
  const platform = $("#manualPlatform")?.value || "Facebook";
  const sourceId = $("#manualSource")?.value || "";
  const pageId = $("#manualSource")?.selectedOptions?.[0]?.dataset?.pageId || "";
  const kw = ($("#manualKeywordFilter")?.value || "").toLowerCase().trim();
  const listEl = $("#manualPostsList");

  if (!sourceId) {
    showBanner("Seleziona una pagina Facebook o un profilo Instagram.", "error");
    return;
  }

  if (listEl) listEl.innerHTML = `<div class="empty-box"><p>Caricamento POST pubblicati in corso...</p></div>`;

  try {
    let raw = [];
    if (platform === "Facebook") {
      const res = await api(`/api/meta/facebook-posts?pageId=${encodeURIComponent(sourceId)}&limit=25`);
      raw = (res.data || []).map((p) => ({
        id: p.id,
        text: p.message || p.attachments?.data?.[0]?.title || "(Post senza testo)",
        date: p.created_time,
        permalink: p.permalink_url || ""
      }));
    } else {
      const res = await api(`/api/meta/instagram-media?instagramId=${encodeURIComponent(sourceId)}&pageId=${encodeURIComponent(pageId)}&limit=25`);
      raw = (res.data || []).map((m) => ({
        id: m.id,
        text: m.caption || "(Post Instagram senza didascalia)",
        date: m.timestamp,
        permalink: m.permalink || ""
      }));
    }

    if (kw) {
      raw = raw.filter((p) => p.text.toLowerCase().includes(kw));
    }

    state.manualPosts = raw;
    state.manualSelectedPostIds.clear();
    renderManualPostsList();
  } catch (err) {
    if (listEl) listEl.innerHTML = `<div class="empty-box"><p style="color: var(--danger);">${escapeHtml(err.message)}</p></div>`;
  }
}

function renderManualPostsList() {
  const listEl = $("#manualPostsList");
  const countEl = $("#manualSelectedCount");
  const sponsorBtn = $("#manualSponsorBtn");
  if (!listEl) return;

  if (countEl) countEl.textContent = String(state.manualSelectedPostIds.size);
  if (sponsorBtn) sponsorBtn.disabled = state.manualSelectedPostIds.size === 0;

  if (!state.manualPosts.length) {
    listEl.innerHTML = `<div class="empty-box"><p>Nessun POST trovato per i criteri selezionati.</p></div>`;
    return;
  }

  listEl.innerHTML = state.manualPosts.map((p) => {
    const checked = state.manualSelectedPostIds.has(p.id);
    return `
      <label class="manual-post-item">
        <input type="checkbox" class="js-manual-post-chk" data-id="${escapeHtml(p.id)}" ${checked ? "checked" : ""}>
        <div class="manual-post-content">
          <p class="manual-post-text">${escapeHtml(p.text.slice(0, 220))}</p>
          <div class="manual-post-meta">
            <span>Data: ${escapeHtml(formatDateTime(p.date))}</span>
            <span>ID: ${escapeHtml(p.id)}</span>
          </div>
        </div>
      </label>
    `;
  }).join("");

  listEl.querySelectorAll(".js-manual-post-chk").forEach((chk) => {
    chk.addEventListener("change", () => {
      const id = chk.dataset.id;
      if (chk.checked) state.manualSelectedPostIds.add(id);
      else state.manualSelectedPostIds.delete(id);
      if (countEl) countEl.textContent = String(state.manualSelectedPostIds.size);
      if (sponsorBtn) sponsorBtn.disabled = state.manualSelectedPostIds.size === 0;
    });
  });
}

async function executeManualBulkSponsor() {
  const adAccountId = $("#manualAdAccount")?.value || "";
  const adsetId = $("#manualAdset")?.value || "";
  const platform = $("#manualPlatform")?.value || "Facebook";
  const sourceId = $("#manualSource")?.value || "";
  const pageId = $("#manualSource")?.selectedOptions?.[0]?.dataset?.pageId || (platform === "Facebook" ? sourceId : "");
  const adStatus = $("#manualAdStatus")?.value || "PAUSED";
  const ruleId = $("#manualRule")?.value || "";

  if (!adAccountId || !adsetId || !state.manualSelectedPostIds.size) {
    showBanner("Seleziona Account, Gruppo Inserzioni e almeno un post.", "error");
    return;
  }

  const btn = $("#manualSponsorBtn");
  const spinner = $("#manualSponsorSpinner");
  if (btn) btn.disabled = true;
  if (spinner) spinner.hidden = false;

  try {
    const selectedPosts = state.manualPosts.filter((p) => state.manualSelectedPostIds.has(p.id));
    const adsPayload = selectedPosts.map((p) => ({
      id: p.id,
      sourcePostId: p.id,
      platform,
      pageId,
      instagramAccountId: platform === "Instagram" ? sourceId : null,
      adsetId,
      ruleId: ruleId || null,
      adName: `ADV - ${platform === "Facebook" ? "FB" : "IG"} - ${p.text.slice(0, 30).replace(/[\r\n]+/g, " ")}`
    }));

    const res = await api("/api/meta/create-ads", {
      method: "POST",
      body: JSON.stringify({
        adAccountId,
        status: adStatus,
        ads: adsPayload
      })
    });

    const results = res.data || [];
    const okCount = results.filter((r) => r.ok).length;
    const errCount = results.length - okCount;

    showBanner(
      `Sponsorizzazione completata: ${okCount} inserzioni create${errCount ? `, ${errCount} errori` : ""}.`,
      errCount > 0 ? "error" : "success"
    );
    state.manualSelectedPostIds.clear();
    renderManualPostsList();
    await loadLogsAndHistory();
  } catch (err) {
    showBanner(err.message, "error");
  } finally {
    if (btn) btn.disabled = false;
    if (spinner) spinner.hidden = true;
  }
}

// ============================================================================
// VIEW 4: Logs & Processed Posts History
// ============================================================================
function bindLogsEvents() {
  $("#refreshLogsBtn")?.addEventListener("click", loadLogsAndHistory);
}

async function loadLogsAndHistory() {
  try {
    const [postsRes, logsRes] = await Promise.all([
      api("/api/processed-posts?limit=100"),
      api("/api/logs?limit=50")
    ]);

    const posts = postsRes.data || [];
    const logs = logsRes.data || [];

    const kpiProc = $("#kpiProcessedPosts");
    if (kpiProc) kpiProc.textContent = String(posts.filter((p) => p.status === "SUCCESS").length);

    renderProcessedPostsTable(posts);
    renderExecutionLogsTable(logs);
  } catch (err) {
    console.warn("Logs load error:", err.message);
  }
}

function renderProcessedPostsTable(posts) {
  const tbody = $("#processedPostsTableBody");
  if (!tbody) return;

  if (!posts.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Nessun post sponsorizzato registrato.</td></tr>`;
    return;
  }

  tbody.innerHTML = posts.map((p) => `
    <tr>
      <td>${escapeHtml(formatDateTime(p.created_at))}</td>
      <td>
        <strong>${escapeHtml(p.platform || "-")}</strong><br>
        <small>${escapeHtml(p.source_name || p.source_id || "")}</small>
      </td>
      <td title="${escapeHtml(p.post_message || "")}">
        ${escapeHtml((p.post_message || p.post_id || "").slice(0, 60))}
      </td>
      <td>
        <strong>${escapeHtml(p.ad_name || "-")}</strong><br>
        <code style="font-size: 0.72rem;">${escapeHtml(p.ad_id || p.error_message || "")}</code>
      </td>
      <td>
        <span class="status-pill ${escapeHtml(p.status || "SUCCESS")}">${escapeHtml(p.status || "SUCCESS")}</span>
      </td>
      <td>
        <button class="btn btn-ghost btn-xs js-del-proc" data-id="${escapeHtml(p.post_id)}" type="button" title="Sblocca post per consentire una nuova sponsorizzazione">
          Sblocca
        </button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".js-del-proc").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/api/processed-posts/${encodeURIComponent(btn.dataset.id)}`, { method: "DELETE" });
        showBanner("Post rimosso dallo storico anti-duplicazione.", "info");
        await loadLogsAndHistory();
      } catch (err) {
        showBanner(err.message, "error");
      }
    });
  });
}

function renderExecutionLogsTable(logs) {
  const tbody = $("#executionLogsTableBody");
  if (!tbody) return;

  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Nessuna esecuzione registrata.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map((l) => {
    const hasErr = Number(l.errors_count) > 0;
    return `
      <tr>
        <td>${escapeHtml(formatDateTime(l.executed_at))}</td>
        <td><strong>${escapeHtml(l.automation_name || "Controllo Globale")}</strong></td>
        <td><code>${escapeHtml(l.trigger_type || "CRON")}</code></td>
        <td>${escapeHtml(l.posts_found ?? 0)}</td>
        <td><strong style="color: var(--neon);">${escapeHtml(l.ads_created ?? 0)}</strong></td>
        <td>
          <span class="status-pill ${hasErr ? "ERROR" : "SUCCESS"}">
            ${hasErr ? `${l.errors_count} ERRORI` : "OK"}
          </span>
        </td>
      </tr>
    `;
  }).join("");
}

// ============================================================================
// Initialization
// ============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  bindAuthEvents();
  bindNavigation();
  bindAutomationModal();
  bindTimelineEvents();
  bindManualSponsorEvents();
  bindLogsEvents();

  await checkAuthStatus();
  updateAuthUI();

  if (state.authenticated) {
    await bootDashboardData();
  }
});
