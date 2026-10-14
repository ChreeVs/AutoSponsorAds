const STORAGE_KEY = "autosponsor-ads-state-v1";
const DEFAULT_IMAGE = "assets/default-creative.svg";

// -----------------------------------------------------------------------------
// State Management
// -----------------------------------------------------------------------------
const state = {
  // Navigation
  activeTab: "automationsView",

  // Automations
  automations: [],
  systemStatus: null,
  logs: [],
  processedPosts: [],

  // Modal Editing
  editingAutoId: null,
  modalSelectedPlatform: "Facebook",

  // Manual Bulk Sponsor State (Preserved)
  manual: {
    target: {
      adAccountId: "",
      campaignId: "",
      adsetId: "",
      ruleId: "",
      adNamePattern: "ADV - {platform} - {post}"
    },
    filters: {
      account: "",
      campaign: "",
      adset: "",
      rule: ""
    },
    createActive: false,
    activePlatform: "Facebook",
    sourceId: "",
    selectedIds: [],
    queue: [],
    adAccounts: [],
    campaigns: [],
    adsets: [],
    rules: [],
    facebookPages: [],
    instagramAccounts: [],
    sourcesMode: "configured",
    sourcesNote: "",
    publishedPosts: [],
    postsError: "",
    loading: {
      config: false,
      campaigns: false,
      adsets: false,
      rules: false,
      posts: false,
      creating: false
    },
    results: []
  }
};

let visiblePostIds = [];

// -----------------------------------------------------------------------------
// API Helper
// -----------------------------------------------------------------------------
async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    const errorMsg = payload.error?.message || payload.error || `Errore HTTP ${response.status}`;
    const err = new Error(errorMsg);
    err.meta = payload.meta || payload;
    throw err;
  }
  return payload;
}

// -----------------------------------------------------------------------------
// DOM Elements
// -----------------------------------------------------------------------------
const dom = {
  // Navigation
  navTabs: document.querySelectorAll(".nav-tab"),
  appViews: document.querySelectorAll(".app-view"),
  badgeActiveCount: document.getElementById("badgeActiveCount"),
  globalRunBtn: document.getElementById("globalRunBtn"),
  globalRunSpinner: document.getElementById("globalRunSpinner"),
  globalRunText: document.getElementById("globalRunText"),
  openNewAutoModalBtn: document.getElementById("openNewAutoModalBtn"),
  createAutomationBannerBtn: document.getElementById("createAutomationBannerBtn"),
  emptyCreateBtn: document.getElementById("emptyCreateBtn"),
  refreshAutomationsBtn: document.getElementById("refreshAutomationsBtn"),

  // KPIs
  kpiActiveAutomations: document.getElementById("kpiActiveAutomations"),
  kpiTotalAutomations: document.getElementById("kpiTotalAutomations"),
  kpiProcessedPosts: document.getElementById("kpiProcessedPosts"),
  kpiDbType: document.getElementById("kpiDbType"),
  kpiDbStatus: document.getElementById("kpiDbStatus"),
  kpiMetaStatus: document.getElementById("kpiMetaStatus"),
  kpiMetaIndicator: document.getElementById("kpiMetaIndicator"),

  // Automations Grid
  automationsGrid: document.getElementById("automationsGrid"),
  automationsEmptyState: document.getElementById("automationsEmptyState"),

  // Modal Form
  automationModal: document.getElementById("automationModal"),
  automationForm: document.getElementById("automationForm"),
  modalTitle: document.getElementById("modalTitle"),
  closeModalBtn: document.getElementById("closeModalBtn"),
  cancelModalBtn: document.getElementById("cancelModalBtn"),
  autoFormId: document.getElementById("autoFormId"),
  autoNameInput: document.getElementById("autoNameInput"),
  btnPlatformFB: document.getElementById("btnPlatformFB"),
  btnPlatformIG: document.getElementById("btnPlatformIG"),
  autoSourceSelect: document.getElementById("autoSourceSelect"),
  autoAdAccountSelect: document.getElementById("autoAdAccountSelect"),
  autoCampaignSelect: document.getElementById("autoCampaignSelect"),
  autoAdsetSelect: document.getElementById("autoAdsetSelect"),
  autoRuleSelect: document.getElementById("autoRuleSelect"),
  autoIntervalSelect: document.getElementById("autoIntervalSelect"),
  autoAdStatusSelect: document.getElementById("autoAdStatusSelect"),
  autoNamingPattern: document.getElementById("autoNamingPattern"),
  autoFilterKeywords: document.getElementById("autoFilterKeywords"),
  autoStartTimeInput: document.getElementById("autoStartTimeInput"),
  autoAdsetStrategySelect: document.getElementById("autoAdsetStrategySelect"),
  liveAdNamePreview: document.getElementById("liveAdNamePreview"),
  sourcePreviewContainer: document.getElementById("sourcePreviewContainer"),
  sourcePreviewCards: document.getElementById("sourcePreviewCards"),
  sourcePreviewBadge: document.getElementById("sourcePreviewBadge"),
  duplicateFromModalBtn: document.getElementById("duplicateFromModalBtn"),

  // Logs & Tables
  refreshLogsBtn: document.getElementById("refreshLogsBtn"),
  runsTableBody: document.getElementById("runsTableBody"),
  postsTableBody: document.getElementById("postsTableBody"),
  logsCountBadge: document.getElementById("logsCountBadge"),
  postsCountBadge: document.getElementById("postsCountBadge"),

  // Guide & Diagnostics
  checkMetaHealthBtn: document.getElementById("checkMetaHealthBtn"),
  diagTokenStatus: document.getElementById("diagTokenStatus"),
  diagTokenUser: document.getElementById("diagTokenUser"),
  diagDbType: document.getElementById("diagDbType"),
  cronWebhookUrl: document.getElementById("cronWebhookUrl"),
  cronAuthHeader: document.getElementById("cronAuthHeader"),
  copyCronUrlBtn: document.getElementById("copyCronUrlBtn"),
  copyCronHeaderBtn: document.getElementById("copyCronHeaderBtn"),

  // Reports
  runReportDialog: document.getElementById("runReportDialog"),
  reportTitle: document.getElementById("reportTitle"),
  reportContent: document.getElementById("reportContent"),

  // Manual Bulk Sponsor Elements
  summaryAccount: document.querySelector("#summaryAccount"),
  summaryCampaign: document.querySelector("#summaryCampaign"),
  summaryAdset: document.querySelector("#summaryAdset"),
  metricAvailable: document.querySelector("#metricAvailable"),
  metricSelected: document.querySelector("#metricSelected"),
  metricQueued: document.querySelector("#metricQueued"),
  adAccountSelect: document.querySelector("#adAccountSelect"),
  campaignSelect: document.querySelector("#campaignSelect"),
  adsetSelect: document.querySelector("#adsetSelect"),
  ruleSelect: document.querySelector("#ruleSelect"),
  accountSearch: document.querySelector("#accountSearch"),
  campaignSearch: document.querySelector("#campaignSearch"),
  adsetSearch: document.querySelector("#adsetSearch"),
  ruleSearch: document.querySelector("#ruleSearch"),
  adNamePattern: document.querySelector("#adNamePattern"),
  destinationPanel: document.querySelector("#destinationPanel"),
  pathAccount: document.querySelector("#pathAccount"),
  pathCampaign: document.querySelector("#pathCampaign"),
  pathAdset: document.querySelector("#pathAdset"),
  pathRule: document.querySelector("#pathRule"),
  refreshTargetBtn: document.querySelector("#refreshTargetBtn"),
  sourceSelect: document.querySelector("#sourceSelect"),
  sourceNote: document.querySelector("#sourceNote"),
  searchInput: document.querySelector("#searchInput"),
  selectVisibleBtn: document.querySelector("#selectVisibleBtn"),
  queueSelectedBtn: document.querySelector("#queueSelectedBtn"),
  postLibrary: document.querySelector("#postLibrary"),
  queueList: document.querySelector("#queueList"),
  clearQueueBtn: document.querySelector("#clearQueueBtn"),
  renameQueueBtn: document.querySelector("#renameQueueBtn"),
  activeStatusCheckbox: document.querySelector("#activeStatusCheckbox"),
  createAdsBtn: document.querySelector("#createAdsBtn"),
  createAdsBtnBottom: document.querySelector("#createAdsBtnBottom"),
  resultCard: document.querySelector("#resultCard"),
  resultList: document.querySelector("#resultList"),
  exportBtn: document.querySelector("#exportBtn"),
  exportDialog: document.querySelector("#exportDialog"),
  exportOutput: document.querySelector("#exportOutput"),
  copyExportBtn: document.querySelector("#copyExportBtn")
};

// -----------------------------------------------------------------------------
// Toast & Banner Notification
// -----------------------------------------------------------------------------
function showBanner(text, type = "info") {
  const banner = document.getElementById("globalBanner");
  const bannerText = document.getElementById("globalBannerText");
  if (!banner || !bannerText) return;

  bannerText.textContent = text;
  banner.className = `banner banner-${type}`;
  banner.hidden = false;

  setTimeout(() => {
    banner.hidden = true;
  }, 6000);
}

document.getElementById("globalBannerClose")?.addEventListener("click", () => {
  document.getElementById("globalBanner").hidden = true;
});

// -----------------------------------------------------------------------------
// Tab Switching
// -----------------------------------------------------------------------------
function setupTabs() {
  dom.navTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const targetViewId = tab.getAttribute("data-tab");
      state.activeTab = targetViewId;

      dom.navTabs.forEach(t => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });

      dom.appViews.forEach(view => {
        const isTarget = view.id === targetViewId;
        view.hidden = !isTarget;
        if (isTarget) view.classList.add("active");
        else view.classList.remove("active");
      });

      if (targetViewId === "logsView") {
        loadLogs();
      } else if (targetViewId === "guideView") {
        updateGuideView();
      }
    });
  });
}

// -----------------------------------------------------------------------------
// Automations Controller
// -----------------------------------------------------------------------------
async function loadAutomations() {
  try {
    const res = await api("/api/automations");
    state.automations = res.data || [];
    renderAutomationsGrid();
    updateKpis();
  } catch (err) {
    console.error("Errore caricamento automazioni:", err);
    showBanner(`Errore caricamento automazioni: ${err.message}`, "danger");
  }
}

function renderAutomationsGrid() {
  const grid = dom.automationsGrid;
  const empty = dom.automationsEmptyState;
  
  // Clear existing cards (except empty state element)
  Array.from(grid.querySelectorAll(".auto-card")).forEach(c => c.remove());

  if (!state.automations.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  state.automations.forEach(item => {
    const card = document.createElement("article");
    card.className = `auto-card ${item.enabled ? "" : "disabled"}`;
    card.id = `auto-card-${item.id}`;

    const isFB = item.platform === "Facebook";
    const platformClass = isFB ? "facebook" : "instagram";
    const platformIcon = isFB ? "📘" : "📸";

    const lastChecked = item.last_checked_at 
      ? new Date(item.last_checked_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })
      : "Mai eseguito";

    let statusBadgeClass = "badge-tag";
    if (item.last_run_status === "SUCCESS") statusBadgeClass += " success";
    else if (item.last_run_status === "ERROR") statusBadgeClass += " error";
    else if (item.last_run_status === "WARNING") statusBadgeClass += " warning";

    card.innerHTML = `
      <div class="auto-card-header">
        <div class="auto-card-title-group">
          <span class="auto-platform-tag ${platformClass}">
            ${platformIcon} ${item.platform}
          </span>
          <h3 class="auto-card-title">${escapeHtml(item.name)}</h3>
        </div>
        <label class="switch" title="${item.enabled ? 'Attiva' : 'Disattivata'}">
          <input type="checkbox" class="toggle-auto-check" data-id="${item.id}" ${item.enabled ? "checked" : ""}>
          <span class="slider"></span>
        </label>
      </div>

      <div class="auto-details-list">
        <div class="auto-detail-item">
          <span>Fonte Post</span>
          <strong title="${escapeHtml(item.source_name || item.source_id)}">${escapeHtml(item.source_name || item.source_id)}</strong>
        </div>
        <div class="auto-detail-item">
          <span>Campagna</span>
          <strong title="${escapeHtml(item.campaign_name || item.campaign_id)}">${escapeHtml(item.campaign_name || item.campaign_id)}</strong>
        </div>
        <div class="auto-detail-item">
          <span>Gruppo Inserzioni</span>
          <strong title="${escapeHtml(item.adset_name || item.adset_id)}">${escapeHtml(item.adset_name || item.adset_id)}</strong>
        </div>
        <div class="auto-detail-item">
          <span>Frequenza</span>
          <strong>Ogni ${item.check_interval_hours || 12}h</strong>
        </div>
        <div class="auto-detail-item">
          <span>Inizio Monitoraggio</span>
          <strong title="Zero retroattività: post prima di questa data vengono ignorati">
            🛡️ ${item.start_time ? new Date(item.start_time).toLocaleDateString('it-IT') : 'Creazione'}
          </strong>
        </div>
      </div>

      <div class="auto-status-footer">
        <div>
          <span>Ultimo: ${lastChecked}</span>
          ${item.last_run_status !== "IDLE" ? `<span class="${statusBadgeClass}" style="margin-left: 6px;">${item.last_run_status}</span>` : ""}
        </div>
        <div class="auto-actions">
          <button class="btn btn-secondary btn-sm run-single-btn" data-id="${item.id}" title="Avvia controllo adesso">
            ▶ Esegui Ora
          </button>
          <button class="icon-button duplicate-auto-btn" data-id="${item.id}" title="Duplica automazione">📋</button>
          <button class="icon-button edit-auto-btn" data-id="${item.id}" title="Modifica">✏️</button>
          <button class="icon-button delete-auto-btn" data-id="${item.id}" title="Elimina">🗑️</button>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });

  // Attach event handlers
  grid.querySelectorAll(".toggle-auto-check").forEach(chk => {
    chk.addEventListener("change", async (e) => {
      const id = e.target.getAttribute("data-id");
      const enabled = e.target.checked;
      try {
        await api(`/api/automations/${id}/toggle`, {
          method: "POST",
          body: JSON.stringify({ enabled })
        });
        showBanner(`Automazione ${enabled ? 'attivata' : 'disattivata'}`, "info");
        await loadAutomations();
      } catch (err) {
        showBanner(`Errore toggle: ${err.message}`, "danger");
        e.target.checked = !enabled;
      }
    });
  });

  grid.querySelectorAll(".run-single-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> Esecuzione...`;
      try {
        const res = await api(`/api/automations/${id}/run`, { method: "POST" });
        showRunReportModal("Risultato Controllo Manuale", res.report);
        await loadAutomations();
      } catch (err) {
        showBanner(`Errore esecuzione: ${err.message}`, "danger");
      } finally {
        btn.disabled = false;
        btn.innerHTML = `▶ Esegui Ora`;
      }
    });
  });

  grid.querySelectorAll(".delete-auto-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (!confirm("Sei sicuro di voler eliminare questa automazione?")) return;
      try {
        await api(`/api/automations/${id}`, { method: "DELETE" });
        showBanner("Automazione eliminata", "info");
        await loadAutomations();
      } catch (err) {
        showBanner(`Errore eliminazione: ${err.message}`, "danger");
      }
    });
  });

  grid.querySelectorAll(".edit-auto-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      openEditModal(id);
    });
  });

  grid.querySelectorAll(".duplicate-auto-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      btn.disabled = true;
      try {
        const res = await api(`/api/automations/${id}/duplicate`, { method: "POST" });
        showBanner(`Automazione "${res.data?.name || 'Copia'}" duplicata con successo!`, "info");
        await loadAutomations();
        if (res.data?.id) {
          openEditModal(res.data.id);
        }
      } catch (err) {
        showBanner(`Errore duplicazione: ${err.message}`, "danger");
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function showRunReportModal(title, report) {
  dom.reportTitle.textContent = title;
  const createdAdsHtml = (report.createdAds || []).length > 0
    ? `
      <h4>Inserzioni create con successo (${report.createdAds.length}):</h4>
      <ul>
        ${report.createdAds.map(ad => `<li><strong>${escapeHtml(ad.adName)}</strong> (Ad ID: <code>${ad.adId}</code>)</li>`).join("")}
      </ul>
    `
    : `<p>Nessun nuovo post da sponsorizzare al momento.</p>`;

  const errorsHtml = (report.errors || []).length > 0
    ? `
      <div style="color: #fb7185; margin-top: 12px;">
        <h4>Attenzione / Errori (${report.errors.length}):</h4>
        <ul>
          ${report.errors.map(err => `<li>${escapeHtml(err.error || err)}</li>`).join("")}
        </ul>
      </div>
    `
    : "";

  dom.reportContent.innerHTML = `
    <div style="margin-bottom: 14px;">
      <p><strong>Post totali analizzati:</strong> ${report.postsFound || 0}</p>
      <p><strong>Nuove inserzioni create:</strong> ${report.adsCreated || 0}</p>
      <p><strong>Post saltati (già sponsorizzati o non idonei):</strong> ${report.skippedCount || 0}</p>
    </div>
    ${createdAdsHtml}
    ${errorsHtml}
  `;

  dom.runReportDialog.showModal();
}

// -----------------------------------------------------------------------------
// System Status & KPIs
// -----------------------------------------------------------------------------
async function loadSystemStatus() {
  try {
    const status = await api("/api/status");
    state.systemStatus = status;

    // KPI: Database
    dom.kpiDbType.textContent = status.dbType === "postgres" ? "PostgreSQL" : "SQLite";
    dom.kpiDbStatus.textContent = status.dbType === "postgres" ? "Cloud / Neon" : "Locale";

    // KPI: Meta
    if (status.tokenHealth?.ok) {
      dom.kpiMetaStatus.textContent = "Connesso";
      dom.kpiMetaIndicator.className = "status-indicator ok";
    } else {
      dom.kpiMetaStatus.textContent = "Non connesso";
      dom.kpiMetaIndicator.className = "status-indicator err";
    }

    updateKpis();
    updateGuideView();
  } catch (err) {
    console.error("Errore lettura status:", err);
    dom.kpiMetaStatus.textContent = "Errore";
    dom.kpiMetaIndicator.className = "status-indicator err";
  }
}

function updateKpis() {
  const activeCount = state.automations.filter(a => a.enabled).length;
  const totalCount = state.automations.length;

  dom.kpiActiveAutomations.textContent = activeCount;
  dom.kpiTotalAutomations.textContent = `su ${totalCount} totali`;
  dom.badgeActiveCount.textContent = activeCount;
}

// -----------------------------------------------------------------------------
// Modal: Nuova / Modifica Automazione
// -----------------------------------------------------------------------------
function updateLiveAdNamePreview() {
  const pattern = dom.autoNamingPattern?.value || "ADV - {platform} - {post}";
  const preview = pattern
    .replace(/\{platform\}/gi, state.modalSelectedPlatform === "Facebook" ? "FB" : "IG")
    .replace(/\{post\}/gi, "Esempio Titolo Post Recente")
    .replace(/\{date\}/gi, new Date().toISOString().slice(0, 10))
    .replace(/\{id\}/gi, "891234");
  if (dom.liveAdNamePreview) dom.liveAdNamePreview.textContent = preview;
}

async function loadSourcePreviewPosts() {
  const sourceId = dom.autoSourceSelect.value;
  if (!sourceId) {
    if (dom.sourcePreviewContainer) dom.sourcePreviewContainer.hidden = true;
    return;
  }
  const sourceOpt = dom.autoSourceSelect.selectedOptions[0];
  const pageId = sourceOpt?.getAttribute("data-page-id") || "";
  const endpoint = state.modalSelectedPlatform === "Facebook"
    ? `/api/meta/facebook-posts?pageId=${encodeURIComponent(sourceId)}&limit=3`
    : `/api/meta/instagram-media?instagramId=${encodeURIComponent(sourceId)}&pageId=${encodeURIComponent(pageId)}&limit=3`;

  try {
    const payload = await api(endpoint);
    const posts = payload.data || [];
    if (!posts.length) {
      if (dom.sourcePreviewContainer) dom.sourcePreviewContainer.hidden = true;
      return;
    }
    if (dom.sourcePreviewContainer) dom.sourcePreviewContainer.hidden = false;
    if (dom.sourcePreviewBadge) dom.sourcePreviewBadge.textContent = `${posts.length} post storici`;
    if (dom.sourcePreviewCards) {
      dom.sourcePreviewCards.innerHTML = posts.map(p => {
        const dateStr = p.created_time || p.timestamp ? new Date(p.created_time || p.timestamp).toLocaleDateString("it-IT") : "";
        const text = p.message || p.caption || "Nessun testo";
        const pic = p.full_picture || p.media_url || p.thumbnail_url || DEFAULT_IMAGE;
        return `
          <div class="source-mini-card">
            <img class="source-mini-thumb" src="${escapeHtml(pic)}" onerror="this.src='${DEFAULT_IMAGE}'" alt="Thumb">
            <div class="source-mini-body">
              <span>Pubblicato il: ${dateStr}</span>
              <p title="${escapeHtml(text)}">${escapeHtml(text)}</p>
            </div>
          </div>
        `;
      }).join("");
    }
  } catch {
    if (dom.sourcePreviewContainer) dom.sourcePreviewContainer.hidden = true;
  }
}

function setupModal() {
  dom.openNewAutoModalBtn.addEventListener("click", () => openNewModal());
  dom.createAutomationBannerBtn?.addEventListener("click", () => openNewModal());
  dom.emptyCreateBtn?.addEventListener("click", () => openNewModal());

  dom.closeModalBtn.addEventListener("click", () => dom.automationModal.close());
  dom.cancelModalBtn.addEventListener("click", () => dom.automationModal.close());

  dom.duplicateFromModalBtn?.addEventListener("click", async () => {
    if (!state.editingAutoId) return;
    try {
      const res = await api(`/api/automations/${state.editingAutoId}/duplicate`, { method: "POST" });
      dom.automationModal.close();
      showBanner(`Automazione duplicata con successo come "${res.data?.name}"!`, "info");
      await loadAutomations();
      if (res.data?.id) {
        openEditModal(res.data.id);
      }
    } catch (err) {
      showBanner(`Errore duplicazione: ${err.message}`, "danger");
    }
  });

  // Platform Toggle inside Modal
  dom.btnPlatformFB.addEventListener("click", () => {
    setModalPlatform("Facebook");
    updateLiveAdNamePreview();
  });
  dom.btnPlatformIG.addEventListener("click", () => {
    setModalPlatform("Instagram");
    updateLiveAdNamePreview();
  });

  dom.autoSourceSelect.addEventListener("change", () => {
    loadSourcePreviewPosts();
  });

  // Dynamic cascades inside Modal
  dom.autoAdAccountSelect.addEventListener("change", async () => {
    const accountId = dom.autoAdAccountSelect.value;
    await populateModalCampaigns(accountId);
    await populateModalRules(accountId);
  });

  dom.autoCampaignSelect.addEventListener("change", async () => {
    const accountId = dom.autoAdAccountSelect.value;
    const campaignId = dom.autoCampaignSelect.value;
    await populateModalAdsets(accountId, campaignId);
  });

  dom.autoNamingPattern.addEventListener("input", () => {
    updateLiveAdNamePreview();
  });

  // Token Pills in Naming Pattern
  document.querySelectorAll(".tag-pills .pill").forEach(pill => {
    pill.addEventListener("click", () => {
      const tag = pill.getAttribute("data-tag");
      const input = dom.autoNamingPattern;
      input.value += ` ${tag}`;
      updateLiveAdNamePreview();
      input.focus();
    });
  });

  // Form Submission
  dom.automationForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveAutomationFromModal();
  });
}

function setModalPlatform(platform) {
  state.modalSelectedPlatform = platform;
  dom.btnPlatformFB.classList.toggle("active", platform === "Facebook");
  dom.btnPlatformIG.classList.toggle("active", platform === "Instagram");
  populateModalSources(platform);
  updateLiveAdNamePreview();
}

function openNewModal() {
  state.editingAutoId = null;
  dom.modalTitle.textContent = "Nuova Regola di Automazione";
  dom.autoFormId.value = "";
  dom.autoNameInput.value = "";
  dom.autoNamingPattern.value = "ADV - {platform} - {post}";
  dom.autoFilterKeywords.value = "";
  dom.autoIntervalSelect.value = "12";
  dom.autoAdStatusSelect.value = "PAUSED";
  if (dom.autoAdsetStrategySelect) dom.autoAdsetStrategySelect.value = "ROTATE_OLDEST";

  // Default start time to NOW in local datetime-local format
  if (dom.autoStartTimeInput) {
    const now = new Date();
    const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    dom.autoStartTimeInput.value = localNow;
  }

  if (dom.sourcePreviewContainer) dom.sourcePreviewContainer.hidden = true;
  if (dom.duplicateFromModalBtn) dom.duplicateFromModalBtn.style.display = "none";

  setModalPlatform("Facebook");
  populateModalAdAccounts();
  updateLiveAdNamePreview();
  dom.automationModal.showModal();
}

function openEditModal(id) {
  const item = state.automations.find(a => a.id === id);
  if (!item) return;

  state.editingAutoId = id;
  dom.modalTitle.textContent = "Modifica Regola di Automazione";
  dom.autoFormId.value = item.id;
  dom.autoNameInput.value = item.name;
  dom.autoNamingPattern.value = item.ad_name_pattern || "ADV - {platform} - {post}";
  dom.autoFilterKeywords.value = item.filter_keywords || "";
  dom.autoIntervalSelect.value = String(item.check_interval_hours || 12);
  dom.autoAdStatusSelect.value = item.ad_status || "PAUSED";
  if (dom.autoAdsetStrategySelect) dom.autoAdsetStrategySelect.value = item.adset_full_strategy || "ROTATE_OLDEST";

  if (dom.autoStartTimeInput) {
    const rawStart = item.start_time || item.created_at || new Date().toISOString();
    const startDate = new Date(rawStart);
    const localStart = new Date(startDate.getTime() - startDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    dom.autoStartTimeInput.value = localStart;
  }

  setModalPlatform(item.platform);
  if (dom.duplicateFromModalBtn) dom.duplicateFromModalBtn.style.display = "inline-flex";
  populateModalAdAccounts(item.ad_account_id, item.campaign_id, item.adset_id, item.rule_id);
  updateLiveAdNamePreview();
  dom.automationModal.showModal();
  setTimeout(() => loadSourcePreviewPosts(), 300);
}

function populateModalSources(platform, selectedId = "") {
  const select = dom.autoSourceSelect;
  select.innerHTML = "";

  const sources = platform === "Facebook" ? state.manual.facebookPages : state.manual.instagramAccounts;
  if (!sources || !sources.length) {
    select.innerHTML = `<option value="">Nessuna fonte ${platform} trovata</option>`;
    return;
  }

  sources.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.label || s.name || s.id;
    if (s.pageId) opt.setAttribute("data-page-id", s.pageId);
    if (selectedId && s.id === selectedId) opt.selected = true;
    select.appendChild(opt);
  });
}

async function populateModalAdAccounts(targetAccountId = "", targetCampaignId = "", targetAdsetId = "", targetRuleId = "") {
  const select = dom.autoAdAccountSelect;
  select.innerHTML = "";

  const accounts = state.manual.adAccounts || [];
  if (!accounts.length) {
    select.innerHTML = `<option value="">Nessun account pubblicitario disponibile</option>`;
    return;
  }

  accounts.forEach(acc => {
    const opt = document.createElement("option");
    opt.value = acc.id;
    opt.textContent = `${acc.name} (${acc.id})`;
    if (targetAccountId ? acc.id === targetAccountId : false) opt.selected = true;
    select.appendChild(opt);
  });

  const selectedAccountId = select.value || accounts[0]?.id;
  if (selectedAccountId) {
    await populateModalCampaigns(selectedAccountId, targetCampaignId);
    await populateModalRules(selectedAccountId, targetRuleId);
    if (targetCampaignId) {
      await populateModalAdsets(selectedAccountId, targetCampaignId, targetAdsetId);
    }
  }
}

async function populateModalCampaigns(accountId, targetCampaignId = "") {
  const select = dom.autoCampaignSelect;
  select.innerHTML = `<option value="">Caricamento campagne...</option>`;

  try {
    const payload = await api(`/api/meta/campaigns?accountId=${encodeURIComponent(accountId)}`);
    const campaigns = payload.data || [];
    select.innerHTML = "";

    if (!campaigns.length) {
      select.innerHTML = `<option value="">Nessuna campagna attiva</option>`;
      return;
    }

    campaigns.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} [${c.effective_status || c.status}]`;
      if (targetCampaignId ? c.id === targetCampaignId : false) opt.selected = true;
      select.appendChild(opt);
    });

    const activeCampaignId = select.value || campaigns[0]?.id;
    if (activeCampaignId) {
      await populateModalAdsets(accountId, activeCampaignId);
    }
  } catch (err) {
    select.innerHTML = `<option value="">Errore campagne: ${err.message}</option>`;
  }
}

async function populateModalAdsets(accountId, campaignId, targetAdsetId = "") {
  const select = dom.autoAdsetSelect;
  select.innerHTML = `<option value="">Caricamento gruppi...</option>`;

  try {
    const payload = await api(`/api/meta/adsets?accountId=${encodeURIComponent(accountId)}&campaignId=${encodeURIComponent(campaignId)}`);
    const adsets = payload.data || [];
    select.innerHTML = "";

    if (!adsets.length) {
      select.innerHTML = `<option value="">Nessun gruppo inserzioni</option>`;
      return;
    }

    adsets.forEach(a => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = `${a.name} [${a.effective_status || a.status}]`;
      if (targetAdsetId ? a.id === targetAdsetId : false) opt.selected = true;
      select.appendChild(opt);
    });
  } catch (err) {
    select.innerHTML = `<option value="">Errore gruppi: ${err.message}</option>`;
  }
}

async function populateModalRules(accountId, targetRuleId = "") {
  const select = dom.autoRuleSelect;
  select.innerHTML = `<option value="">Nessuna regola collegata</option>`;

  try {
    const payload = await api(`/api/meta/rules?accountId=${encodeURIComponent(accountId)}`);
    const rules = payload.data || [];

    rules.forEach(r => {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = `${r.name}`;
      if (targetRuleId ? r.id === targetRuleId : false) opt.selected = true;
      select.appendChild(opt);
    });
  } catch {
    // Rules are optional, ignore error
  }
}

async function saveAutomationFromModal() {
  const sourceOption = dom.autoSourceSelect.selectedOptions[0];
  const campaignOption = dom.autoCampaignSelect.selectedOptions[0];
  const adsetOption = dom.autoAdsetSelect.selectedOptions[0];
  const ruleOption = dom.autoRuleSelect.selectedOptions[0];

  const payload = {
    name: dom.autoNameInput.value.trim(),
    platform: state.modalSelectedPlatform,
    source_id: dom.autoSourceSelect.value,
    source_name: sourceOption?.textContent || "",
    page_id: sourceOption?.getAttribute("data-page-id") || "",
    ad_account_id: dom.autoAdAccountSelect.value,
    campaign_id: dom.autoCampaignSelect.value,
    campaign_name: campaignOption?.textContent || "",
    adset_id: dom.autoAdsetSelect.value,
    adset_name: adsetOption?.textContent || "",
    rule_id: dom.autoRuleSelect.value || "",
    rule_name: dom.autoRuleSelect.value ? ruleOption?.textContent || "" : "",
    check_interval_hours: Number(dom.autoIntervalSelect.value) || 12,
    ad_status: dom.autoAdStatusSelect.value || "PAUSED",
    ad_name_pattern: dom.autoNamingPattern.value || "ADV - {platform} - {post}",
    filter_keywords: dom.autoFilterKeywords.value.trim(),
    start_time: dom.autoStartTimeInput?.value ? new Date(dom.autoStartTimeInput.value).toISOString() : new Date().toISOString(),
    adset_full_strategy: dom.autoAdsetStrategySelect?.value || "ROTATE_OLDEST"
  };

  try {
    if (state.editingAutoId) {
      await api(`/api/automations/${state.editingAutoId}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      showBanner("Automazione aggiornata con successo", "info");
    } else {
      await api("/api/automations", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      showBanner("Nuova automazione salvata con successo", "info");
    }

    dom.automationModal.close();
    await loadAutomations();
  } catch (err) {
    showBanner(`Errore salvataggio: ${err.message}`, "danger");
  }
}

// -----------------------------------------------------------------------------
// Logs View Controller
// -----------------------------------------------------------------------------
async function loadLogs() {
  try {
    const [runsRes, postsRes] = await Promise.all([
      api("/api/logs?limit=40"),
      api("/api/processed-posts?limit=40")
    ]);

    state.logs = runsRes.data || [];
    state.processedPosts = postsRes.data || [];

    // KPI total processed
    dom.kpiProcessedPosts.textContent = state.processedPosts.length;
    dom.logsCountBadge.textContent = `${state.logs.length} esecuzioni`;
    dom.postsCountBadge.textContent = `${state.processedPosts.length} post memorizzati`;

    renderLogsTables();
  } catch (err) {
    console.error("Errore caricamento log:", err);
  }
}

function renderLogsTables() {
  // Runs Table
  const tbodyRuns = dom.runsTableBody;
  tbodyRuns.innerHTML = "";

  if (!state.logs.length) {
    tbodyRuns.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 24px;">Nessuna esecuzione registrata</td></tr>`;
  } else {
    state.logs.forEach(log => {
      const dateStr = new Date(log.executed_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${dateStr}</td>
        <td><strong>${escapeHtml(log.automation_name || "Globale")}</strong></td>
        <td><span class="badge-tag">${log.trigger_type}</span></td>
        <td>${log.posts_found}</td>
        <td><span style="color: var(--accent-emerald); font-weight: 700;">${log.ads_created}</span></td>
        <td>${log.errors_count > 0 ? `<span style="color: var(--accent-rose); font-weight: 700;">${log.errors_count}</span>` : '0'}</td>
      `;
      tbodyRuns.appendChild(tr);
    });
  }

  // Posts Table
  const tbodyPosts = dom.postsTableBody;
  tbodyPosts.innerHTML = "";

  if (!state.processedPosts.length) {
    tbodyPosts.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 24px;">Nessun post sponsorizzato finora</td></tr>`;
  } else {
    state.processedPosts.forEach(p => {
      const dateStr = new Date(p.created_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="auto-platform-tag ${p.platform === 'Facebook' ? 'facebook' : 'instagram'}">${p.platform}</span></td>
        <td>
          <div style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <strong>${escapeHtml(p.ad_name || p.post_message || p.post_id)}</strong>
          </div>
        </td>
        <td><code>${p.ad_id || '-'}</code></td>
        <td><span class="badge-tag ${p.status === 'SUCCESS' ? 'success' : 'error'}">${p.status}</span></td>
        <td>${dateStr}</td>
      `;
      tbodyPosts.appendChild(tr);
    });
  }
}

// -----------------------------------------------------------------------------
// Guide & External Cron Setup
// -----------------------------------------------------------------------------
function updateGuideView() {
  const currentHost = window.location.origin;
  dom.cronWebhookUrl.textContent = `${currentHost}/api/cron/check-and-sponsor`;

  const status = state.systemStatus;
  if (status) {
    dom.diagDbType.textContent = status.dbType === "postgres" ? "PostgreSQL Cloud (Neon/Supabase)" : "SQLite Locale";
    if (status.tokenHealth?.ok) {
      dom.diagTokenStatus.textContent = "✓ Valido e Connesso";
      dom.diagTokenStatus.style.color = "var(--accent-emerald)";
      dom.diagTokenUser.textContent = status.tokenHealth.user?.name || "Utente Meta Verificato";
    } else {
      dom.diagTokenStatus.textContent = "✕ Non Connesso / Errore";
      dom.diagTokenStatus.style.color = "var(--accent-rose)";
      dom.diagTokenUser.textContent = status.tokenHealth?.error || "Token mancante o scaduto";
    }
  }
}

function setupGuideActions() {
  dom.copyCronUrlBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(dom.cronWebhookUrl.textContent);
    dom.copyCronUrlBtn.textContent = "Copiato!";
    setTimeout(() => { dom.copyCronUrlBtn.textContent = "Copia URL"; }, 2000);
  });

  dom.copyCronHeaderBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(dom.cronAuthHeader.textContent);
    dom.copyCronHeaderBtn.textContent = "Copiato!";
    setTimeout(() => { dom.copyCronHeaderBtn.textContent = "Copia Header"; }, 2000);
  });

  dom.checkMetaHealthBtn.addEventListener("click", async () => {
    dom.checkMetaHealthBtn.disabled = true;
    dom.checkMetaHealthBtn.textContent = "Verifica in corso...";
    await loadSystemStatus();
    dom.checkMetaHealthBtn.disabled = false;
    dom.checkMetaHealthBtn.textContent = "🩺 Verifica Connessione Meta";
    showBanner("Stato Meta aggiornato", "info");
  });

  const saveBtn = document.getElementById("saveManualTokenBtn");
  const tokenInp = document.getElementById("manualTokenInput");
  if (saveBtn && tokenInp) {
    saveBtn.addEventListener("click", async () => {
      const val = tokenInp.value.trim();
      if (!val) {
        alert("Inserisci un token valido (inizia con EAA...)");
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Salvataggio...";
      try {
        await api("/api/meta/save-token", {
          method: "POST",
          body: JSON.stringify({ token: val })
        });
        tokenInp.value = "";
        showBanner("Token salvato con successo nel database!", "info");
        await loadSystemStatus();
        await loadManualConfig();
      } catch (err) {
        alert("Errore salvataggio token: " + err.message);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Salva";
      }
    });
  }
}

// -----------------------------------------------------------------------------
// Global "Esegui Tutto Ora" Button
// -----------------------------------------------------------------------------
function setupGlobalRun() {
  dom.globalRunBtn.addEventListener("click", async () => {
    dom.globalRunBtn.disabled = true;
    dom.globalRunSpinner.hidden = false;
    dom.globalRunText.textContent = "Controllo in corso...";

    try {
      const res = await api("/api/automations/run-all", { method: "POST" });
      const results = res.result?.results || [];
      const totalCreated = results.reduce((acc, r) => acc + (r.adsCreated || 0), 0);
      const totalPosts = results.reduce((acc, r) => acc + (r.postsFound || 0), 0);
      const totalErrors = results.reduce((acc, r) => acc + (r.errorsCount || 0), 0);

      showRunReportModal("Risultato Controllo Globale", {
        postsFound: totalPosts,
        adsCreated: totalCreated,
        skippedCount: 0,
        errorsCount: totalErrors,
        createdAds: results.flatMap(r => r.createdAds || []),
        errors: results.flatMap(r => r.errors || [])
      });

      await loadAutomations();
      await loadLogs();
    } catch (err) {
      showBanner(`Errore esecuzione globale: ${err.message}`, "danger");
    } finally {
      dom.globalRunBtn.disabled = false;
      dom.globalRunSpinner.hidden = true;
      dom.globalRunText.textContent = "▶ Esegui Tutto Ora";
    }
  });

  dom.refreshAutomationsBtn?.addEventListener("click", () => loadAutomations());
  dom.refreshLogsBtn?.addEventListener("click", () => loadLogs());
}

// -----------------------------------------------------------------------------
// PRESERVED & INTEGRATED: Manual Bulk Sponsor Logic
// -----------------------------------------------------------------------------
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truncate(text, max = 110) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}...`;
}

function matchesFilter(text, query) {
  if (!query) return true;
  return String(text || "").toLowerCase().includes(query.toLowerCase().trim());
}

function formatAdName(pattern, { platform, post, fallback }) {
  const template = pattern?.trim() || "ADV - {platform} - {post}";
  const cleanPost = truncate(post?.message || fallback, 35)
    .replace(/[^\p{L}\p{N}\s\-_]/gu, "")
    .trim();

  return template
    .replaceAll("{platform}", platform)
    .replaceAll("{post}", cleanPost || fallback)
    .replaceAll("{source}", post?.sourceName || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadManualConfig() {
  try {
    const config = await api("/api/meta/config");
    state.manual.adAccounts = config.adAccounts || [];
    state.manual.facebookPages = config.facebookPages || [];
    state.manual.instagramAccounts = config.instagramAccounts || [];
    state.manual.sourcesMode = "configured";
    state.manual.sourcesNote = "Fonti configurate nel sistema.";

    if (!state.manual.target.adAccountId && state.manual.adAccounts.length) {
      state.manual.target.adAccountId = state.manual.adAccounts[0].id;
    }
    if (!state.manual.sourceId) {
      state.manual.sourceId = state.manual.facebookPages[0]?.id || state.manual.instagramAccounts[0]?.id || "";
    }

    renderManual();
    await loadManualSources();
    await Promise.all([loadManualCampaigns(), loadManualRules(), loadManualPosts()]);
  } catch (err) {
    console.error("Errore configurazione manuale:", err);
  }
}

async function loadManualSources() {
  if (!state.manual.target.adAccountId) return;
  try {
    const payload = await api(`/api/meta/sources?accountId=${encodeURIComponent(state.manual.target.adAccountId)}`);
    state.manual.facebookPages = payload.facebookPages || [];
    state.manual.instagramAccounts = payload.instagramAccounts || [];
    state.manual.sourcesMode = payload.mode || "configured";
    state.manual.sourcesNote = payload.note || "";
    state.manual.sourceId = "";
    state.manual.selectedIds = [];
    renderManual();
  } catch (err) {
    state.manual.sourcesNote = `Fonti non aggiornate: ${err.message}`;
    renderManual();
  }
}

async function loadManualCampaigns() {
  if (!state.manual.target.adAccountId) return;
  try {
    const payload = await api(`/api/meta/campaigns?accountId=${encodeURIComponent(state.manual.target.adAccountId)}`);
    state.manual.campaigns = payload.data || [];
    if (!state.manual.campaigns.some(c => c.id === state.manual.target.campaignId)) {
      state.manual.target.campaignId = state.manual.campaigns[0]?.id || "";
    }
    renderManual();
    await loadManualAdsets();
  } catch {
    state.manual.campaigns = [];
    renderManual();
  }
}

async function loadManualAdsets() {
  if (!state.manual.target.adAccountId || !state.manual.target.campaignId) {
    state.manual.adsets = [];
    renderManual();
    return;
  }
  try {
    const payload = await api(`/api/meta/adsets?accountId=${encodeURIComponent(state.manual.target.adAccountId)}&campaignId=${encodeURIComponent(state.manual.target.campaignId)}`);
    state.manual.adsets = payload.data || [];
    if (!state.manual.adsets.some(a => a.id === state.manual.target.adsetId)) {
      state.manual.target.adsetId = state.manual.adsets[0]?.id || "";
    }
    renderManual();
  } catch {
    state.manual.adsets = [];
    renderManual();
  }
}

async function loadManualRules() {
  if (!state.manual.target.adAccountId) return;
  try {
    const payload = await api(`/api/meta/rules?accountId=${encodeURIComponent(state.manual.target.adAccountId)}`);
    state.manual.rules = payload.data || [];
    renderManual();
  } catch {
    state.manual.rules = [];
    renderManual();
  }
}

async function loadManualPosts() {
  const currentSources = state.manual.activePlatform === "Facebook" ? state.manual.facebookPages : state.manual.instagramAccounts;
  if (!currentSources.length) {
    state.manual.publishedPosts = [];
    renderManual();
    return;
  }

  if (!state.manual.sourceId || !currentSources.some(s => s.id === state.manual.sourceId)) {
    state.manual.sourceId = currentSources[0]?.id || "";
  }

  const selectedSource = currentSources.find(s => s.id === state.manual.sourceId);
  const endpoint = state.manual.activePlatform === "Facebook"
    ? `/api/meta/facebook-posts?pageId=${encodeURIComponent(state.manual.sourceId)}`
    : `/api/meta/instagram-media?instagramId=${encodeURIComponent(state.manual.sourceId)}&pageId=${encodeURIComponent(selectedSource?.pageId || "")}`;

  try {
    const payload = await api(endpoint);
    state.manual.publishedPosts = (payload.data || []).map(item => ({
      id: item.id,
      platform: state.manual.activePlatform,
      sourceId: state.manual.sourceId,
      sourceName: selectedSource?.label || selectedSource?.name || state.manual.sourceId,
      pageId: selectedSource?.pageId || (state.manual.activePlatform === "Facebook" ? state.manual.sourceId : ""),
      instagramAccountId: state.manual.activePlatform === "Instagram" ? state.manual.sourceId : "",
      message: item.message || item.caption || item.attachments?.data?.[0]?.title || "",
      permalink: item.permalink || item.permalink_url || "",
      createdTime: item.created_time || item.timestamp || "",
      picture: item.full_picture || item.media_url || item.thumbnail_url || DEFAULT_IMAGE
    }));
    state.manual.selectedIds = [];
    renderManual();
  } catch (err) {
    state.manual.publishedPosts = [];
    state.manual.postsError = err.message;
    renderManual();
  }
}

function renderManual() {
  const m = state.manual;

  // Status strip
  const currentAccount = m.adAccounts.find(a => a.id === m.target.adAccountId);
  const currentCampaign = m.campaigns.find(c => c.id === m.target.campaignId);
  const currentAdset = m.adsets.find(a => a.id === m.target.adsetId);

  dom.summaryAccount.textContent = currentAccount ? currentAccount.name : "Non selezionato";
  dom.summaryCampaign.textContent = currentCampaign ? currentCampaign.name : "Non selezionata";
  dom.summaryAdset.textContent = currentAdset ? currentAdset.name : "Non selezionato";
  dom.metricQueued.textContent = m.queue.length;

  dom.pathAccount.querySelector("strong").textContent = currentAccount ? currentAccount.name : "Da scegliere";
  dom.pathAccount.classList.toggle("done", Boolean(currentAccount));

  dom.pathCampaign.querySelector("strong").textContent = currentCampaign ? currentCampaign.name : "Da scegliere";
  dom.pathCampaign.classList.toggle("done", Boolean(currentCampaign));

  dom.pathAdset.querySelector("strong").textContent = currentAdset ? currentAdset.name : "Da scegliere";
  dom.pathAdset.classList.toggle("done", Boolean(currentAdset));

  const currentRule = m.rules.find(r => r.id === m.target.ruleId);
  dom.pathRule.querySelector("strong").textContent = currentRule ? currentRule.name : "Facoltativa";
  dom.pathRule.classList.toggle("done", Boolean(currentRule));

  // Selectors
  dom.adAccountSelect.innerHTML = m.adAccounts.map(a => `<option value="${a.id}" ${a.id === m.target.adAccountId ? "selected" : ""}>${escapeHtml(a.name)} (${a.id})</option>`).join("");
  dom.campaignSelect.innerHTML = m.campaigns.map(c => `<option value="${c.id}" ${c.id === m.target.campaignId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("");
  dom.adsetSelect.innerHTML = m.adsets.map(a => `<option value="${a.id}" ${a.id === m.target.adsetId ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("");
  dom.ruleSelect.innerHTML = `<option value="">Nessuna regola</option>` + m.rules.map(r => `<option value="${r.id}" ${r.id === m.target.ruleId ? "selected" : ""}>${escapeHtml(r.name)}</option>`).join("");

  // Sources dropdown
  const sources = m.activePlatform === "Facebook" ? m.facebookPages : m.instagramAccounts;
  dom.sourceSelect.innerHTML = sources.map(s => `<option value="${s.id}" ${s.id === m.sourceId ? "selected" : ""}>${escapeHtml(s.label || s.name || s.id)}</option>`).join("");
  dom.sourceNote.textContent = m.sourcesNote || "";

  // Render Post Library
  renderPostLibrary();

  // Render Queue List
  renderQueueList();
}

function renderPostLibrary() {
  const m = state.manual;
  const container = dom.postLibrary;
  container.innerHTML = "";

  const query = dom.searchInput.value.toLowerCase().trim();
  const filtered = m.publishedPosts.filter(p => matchesFilter(p.message, query) || matchesFilter(p.id, query));
  visiblePostIds = filtered.map(p => p.id);

  dom.metricAvailable.textContent = filtered.length;
  dom.metricSelected.textContent = m.selectedIds.length;

  if (!filtered.length) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 40px;">Nessun post trovato</div>`;
    return;
  }

  filtered.forEach(p => {
    const isSelected = m.selectedIds.includes(p.id);
    const card = document.createElement("div");
    card.className = `post-card ${isSelected ? "selected" : ""}`;
    const dateStr = p.createdTime ? new Date(p.createdTime).toLocaleDateString("it-IT") : "";

    card.innerHTML = `
      <img class="post-thumb" src="${escapeHtml(p.picture)}" alt="Creative" onerror="this.src='${DEFAULT_IMAGE}'">
      <div class="post-card-body">
        <span class="post-card-date">${dateStr} · ${p.platform}</span>
        <div class="post-card-caption">${escapeHtml(p.message || "Senza testo")}</div>
      </div>
    `;

    card.addEventListener("click", () => {
      if (m.selectedIds.includes(p.id)) {
        m.selectedIds = m.selectedIds.filter(id => id !== p.id);
      } else {
        m.selectedIds.push(p.id);
      }
      renderPostLibrary();
    });

    container.appendChild(card);
  });
}

function renderQueueList() {
  const m = state.manual;
  const container = dom.queueList;
  container.innerHTML = "";

  if (!m.queue.length) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 24px;">La coda è vuota. Seleziona i post al punto 2.</div>`;
    return;
  }

  m.queue.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "queue-item";
    row.innerHTML = `
      <span class="auto-platform-tag ${item.platform === 'Facebook' ? 'facebook' : 'instagram'}">${item.platform}</span>
      <input type="text" class="queue-name-input" data-index="${index}" value="${escapeHtml(item.adName)}" autocomplete="off">
      <button class="icon-button remove-queue-btn" data-index="${index}" title="Rimuovi">✕</button>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll(".queue-name-input").forEach(inp => {
    inp.addEventListener("input", (e) => {
      const idx = Number(e.target.getAttribute("data-index"));
      m.queue[idx].adName = e.target.value;
    });
  });

  container.querySelectorAll(".remove-queue-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = Number(btn.getAttribute("data-index"));
      m.queue.splice(idx, 1);
      renderQueueList();
      dom.metricQueued.textContent = m.queue.length;
    });
  });
}

function setupManualListeners() {
  // Tabs FB / IG in manual
  document.querySelectorAll("[data-platform-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-platform-tab]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.manual.activePlatform = btn.getAttribute("data-platform-tab");
      loadManualPosts();
    });
  });

  dom.adAccountSelect.addEventListener("change", async (e) => {
    state.manual.target.adAccountId = e.target.value;
    await loadManualSources();
    await Promise.all([loadManualCampaigns(), loadManualRules()]);
  });

  dom.campaignSelect.addEventListener("change", async (e) => {
    state.manual.target.campaignId = e.target.value;
    await loadManualAdsets();
  });

  dom.adsetSelect.addEventListener("change", (e) => {
    state.manual.target.adsetId = e.target.value;
    renderManual();
  });

  dom.ruleSelect.addEventListener("change", (e) => {
    state.manual.target.ruleId = e.target.value;
    renderManual();
  });

  dom.sourceSelect.addEventListener("change", (e) => {
    state.manual.sourceId = e.target.value;
    loadManualPosts();
  });

  dom.searchInput.addEventListener("input", () => {
    renderPostLibrary();
  });

  dom.selectVisibleBtn.addEventListener("click", () => {
    state.manual.selectedIds = Array.from(new Set([...state.manual.selectedIds, ...visiblePostIds]));
    renderPostLibrary();
  });

  dom.queueSelectedBtn.addEventListener("click", () => {
    const selectedPosts = state.manual.publishedPosts.filter(p => state.manual.selectedIds.includes(p.id));
    selectedPosts.forEach(post => {
      if (!state.manual.queue.some(q => q.sourcePostId === post.id)) {
        state.manual.queue.push({
          id: `queue_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
          sourcePostId: post.id,
          platform: post.platform,
          pageId: post.pageId,
          instagramAccountId: post.instagramAccountId,
          adsetId: state.manual.target.adsetId,
          ruleId: state.manual.target.ruleId,
          adName: formatAdName(dom.adNamePattern.value, {
            platform: post.platform,
            post,
            fallback: "Post"
          })
        });
      }
    });
    state.manual.selectedIds = [];
    renderManual();
    showBanner(`Aggiunti ${selectedPosts.length} post alla coda!`, "info");
  });

  dom.clearQueueBtn.addEventListener("click", () => {
    state.manual.queue = [];
    renderQueueList();
    dom.metricQueued.textContent = "0";
  });

  dom.renameQueueBtn.addEventListener("click", () => {
    state.manual.queue.forEach(item => {
      const original = state.manual.publishedPosts.find(p => p.id === item.sourcePostId);
      item.adName = formatAdName(dom.adNamePattern.value, {
        platform: item.platform,
        post: original,
        fallback: "Post"
      });
    });
    renderQueueList();
    showBanner("Nomi inserzioni aggiornati secondo lo schema", "info");
  });

  // Create ads
  const triggerCreateAds = async () => {
    if (!state.manual.queue.length) {
      alert("La coda è vuota. Aggiungi prima almeno un post.");
      return;
    }
    if (!state.manual.target.adAccountId) {
      alert("Seleziona prima un account pubblicitario.");
      return;
    }

    const createBtn = dom.createAdsBtn;
    createBtn.disabled = true;
    createBtn.textContent = "Creazione in corso...";

    try {
      const res = await api("/api/meta/create-ads", {
        method: "POST",
        body: JSON.stringify({
          adAccountId: state.manual.target.adAccountId,
          status: dom.activeStatusCheckbox.checked ? "ACTIVE" : "PAUSED",
          ads: state.manual.queue
        })
      });

      state.manual.queue = [];
      renderQueueList();
      dom.metricQueued.textContent = "0";

      dom.resultCard.hidden = false;
      dom.resultList.innerHTML = (res.data || []).map(r => `
        <div style="padding: 10px; border-bottom: 1px solid var(--border-subtle);">
          <strong style="color: ${r.ok ? 'var(--accent-emerald)' : 'var(--accent-rose)'};">
            ${r.ok ? '✓ Creata:' : '✕ Errore:'} ${escapeHtml(r.adName)}
          </strong>
          ${r.ok ? `<div style="font-size: 0.8rem; color: var(--text-muted);">Ad ID: ${r.adId} ${r.ruleMessage ? `· ${escapeHtml(r.ruleMessage)}` : ''}</div>` : `<div style="color: var(--accent-rose); font-size: 0.8rem;">${escapeHtml(r.error)}</div>`}
        </div>
      `).join("");

      dom.resultCard.scrollIntoView({ behavior: "smooth" });
      showBanner("Creazione inserzioni completata!", "info");
      loadLogs();
    } catch (err) {
      alert(`Errore creazione inserzioni: ${err.message}`);
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = "Crea inserzioni in pausa";
    }
  };

  dom.createAdsBtn.addEventListener("click", triggerCreateAds);
  dom.createAdsBtnBottom.addEventListener("click", triggerCreateAds);

  // Export Dialog
  dom.exportBtn.addEventListener("click", () => {
    dom.exportOutput.value = JSON.stringify({
      target: state.manual.target,
      queue: state.manual.queue
    }, null, 2);
    dom.exportDialog.showModal();
  });

  dom.copyExportBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(dom.exportOutput.value);
    dom.copyExportBtn.textContent = "Copiato!";
    setTimeout(() => { dom.copyExportBtn.textContent = "Copia Dati"; }, 2000);
  });
}

// -----------------------------------------------------------------------------
// App Initialization
// -----------------------------------------------------------------------------
async function initApp() {
  setupTabs();
  setupModal();
  setupGlobalRun();
  setupGuideActions();
  setupManualListeners();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("login") === "ok") {
    showBanner("✓ Accesso con Facebook completato! Token Meta attivo per 60 giorni.", "info");
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (urlParams.get("login_error")) {
    showBanner("✕ Errore login: " + decodeURIComponent(urlParams.get("login_error")), "danger");
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  await Promise.all([
    loadAutomations(),
    loadSystemStatus(),
    loadLogs(),
    loadManualConfig()
  ]);
}

window.addEventListener("DOMContentLoaded", initApp);

