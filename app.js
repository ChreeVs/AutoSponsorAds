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

  // Modal Editing & Independent Automations State
  editingAutoId: null,
  modalSelectedPlatform: "Facebook",
  allAdAccounts: [],
  hiddenAccountIds: new Set(),
  showHiddenInManual: false,
  modalSources: {
    facebookPages: [],
    instagramAccounts: []
  },
  modalSelectedAccountId: "",

  // Manual Bulk Sponsor State (Preserved & Independent)
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
  },

  // Timeline Flow & Pubblie Integration State
  timeline: {
    items: [],
    stats: { total: 0, upcomingCount: 0, includedCount: 0, excludedCount: 0, sponsoredCount: 0 },
    pubblieConfigured: false,
    pubblieKey: "",
    pubblieUser: null,
    projects: [],
    archivedProjectIds: new Set(),
    channels: [],
    mappings: [],
    filters: {
      projectId: "",
      platform: "meta",
      status: "",
      days: 30,
      query: ""
    },
    loading: false
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
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    showAuthOverlay(false);
    throw new Error("Accesso non autorizzato. Effettua il login.");
  }
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
  autoIntervalInput: document.getElementById("autoIntervalInput"),
  autoIntervalSelect: document.getElementById("autoIntervalSelect"),
  autoAdStatusSelect: document.getElementById("autoAdStatusSelect"),
  autoNamingPattern: document.getElementById("autoNamingPattern"),
  autoFilterKeywords: document.getElementById("autoFilterKeywords"),
  autoExcludeKeywords: document.getElementById("autoExcludeKeywords"),
  autoStartTimeInput: document.getElementById("autoStartTimeInput"),
  autoAdsetStrategySelect: document.getElementById("autoAdsetStrategySelect"),
  liveAdNamePreview: document.getElementById("liveAdNamePreview"),
  sourcePreviewContainer: document.getElementById("sourcePreviewContainer"),
  sourcePreviewCards: document.getElementById("sourcePreviewCards"),
  sourcePreviewBadge: document.getElementById("sourcePreviewBadge"),
  duplicateFromModalBtn: document.getElementById("duplicateFromModalBtn"),
  cloneAdsetBox: document.getElementById("cloneAdsetBox"),
  autoAdsetCloneSourceSelect: document.getElementById("autoAdsetCloneSourceSelect"),
  autoAdsetCloneNameInput: document.getElementById("autoAdsetCloneNameInput"),
  manageModalAccountsBtn: document.getElementById("manageModalAccountsBtn"),
  manageManualAccountsBtn: document.getElementById("manageManualAccountsBtn"),
  showHiddenManualAccountsToggle: document.getElementById("showHiddenManualAccountsToggle"),
  hiddenAccountsCountManual: document.getElementById("hiddenAccountsCountManual"),
  manageAccountsDialog: document.getElementById("manageAccountsDialog"),
  closeManageAccountsBtn: document.getElementById("closeManageAccountsBtn"),
  manageAccountsSearch: document.getElementById("manageAccountsSearch"),
  manageAccountsList: document.getElementById("manageAccountsList"),
  restoreAllAccountsBtn: document.getElementById("restoreAllAccountsBtn"),
  saveManagedAccountsBtn: document.getElementById("saveManagedAccountsBtn"),

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
  copyExportBtn: document.querySelector("#copyExportBtn"),
  // Auth DOM elements
  authOverlay: document.getElementById("authOverlay"),
  authSubtitle: document.getElementById("authSubtitle"),
  authInfoBanner: document.getElementById("authInfoBanner"),
  authForm: document.getElementById("authForm"),
  authSetupGroup: document.getElementById("authSetupGroup"),
  authNewPassword: document.getElementById("authNewPassword"),
  toggleNewPwdBtn: document.getElementById("toggleNewPwdBtn"),
  authLoginGroup: document.getElementById("authLoginGroup"),
  authPassword: document.getElementById("authPassword"),
  togglePwdBtn: document.getElementById("togglePwdBtn"),
  authAlert: document.getElementById("authAlert"),
  authSubmitBtn: document.getElementById("authSubmitBtn"),
  authSpinner: document.getElementById("authSpinner"),
  authSubmitBtnText: document.getElementById("authSubmitBtnText"),
  logoutBtn: document.getElementById("logoutBtn"),

  // Timeline DOM Elements
  tabBtnTimeline: document.getElementById("tabBtnTimeline"),
  badgeTimelineCount: document.getElementById("badgeTimelineCount"),
  kpiTimelineFuture: document.getElementById("kpiTimelineFuture"),
  kpiTimelineIncluded: document.getElementById("kpiTimelineIncluded"),
  kpiTimelineExcluded: document.getElementById("kpiTimelineExcluded"),
  kpiTimelineSponsored: document.getElementById("kpiTimelineSponsored"),
  kpiPubblieStatus: document.getElementById("kpiPubblieStatus"),
  kpiPubblieIndicator: document.getElementById("kpiPubblieIndicator"),
  pubblieConnectPrompt: document.getElementById("pubblieConnectPrompt"),
  promptConnectPubblieBtn: document.getElementById("promptConnectPubblieBtn"),
  openPubblieConfigBtn: document.getElementById("openPubblieConfigBtn"),
  refreshTimelineBtn: document.getElementById("refreshTimelineBtn"),
  timelineSpinner: document.getElementById("timelineSpinner"),
  refreshTimelineBtnText: document.getElementById("refreshTimelineBtnText"),
  timelineFilterProject: document.getElementById("timelineFilterProject"),
  managePubblieProjectsBtn: document.getElementById("managePubblieProjectsBtn"),
  archivedProjectsCountBadge: document.getElementById("archivedProjectsCountBadge"),
  managePubblieProjectsDialog: document.getElementById("managePubblieProjectsDialog"),
  managePubblieProjectsSearch: document.getElementById("managePubblieProjectsSearch"),
  managePubblieProjectsList: document.getElementById("managePubblieProjectsList"),
  restoreAllPubblieProjectsBtn: document.getElementById("restoreAllPubblieProjectsBtn"),
  cancelManagePubblieProjectsBtn: document.getElementById("cancelManagePubblieProjectsBtn"),
  saveManagedPubblieProjectsBtn: document.getElementById("saveManagedPubblieProjectsBtn"),
  closeManagePubblieProjectsBtn: document.getElementById("closeManagePubblieProjectsBtn"),
  timelineFilterPlatform: document.getElementById("timelineFilterPlatform"),
  timelineFilterStatus: document.getElementById("timelineFilterStatus"),
  timelineFilterDays: document.getElementById("timelineFilterDays"),
  timelineSearchInput: document.getElementById("timelineSearchInput"),
  timelineIncludeAllBtn: document.getElementById("timelineIncludeAllBtn"),
  timelineExcludeAllBtn: document.getElementById("timelineExcludeAllBtn"),
  timelineStream: document.getElementById("timelineStream"),
  timelineStreamWrapper: document.getElementById("timelineStreamWrapper"),
  timelineScrollPrevBtn: document.getElementById("timelineScrollPrevBtn"),
  timelineScrollNextBtn: document.getElementById("timelineScrollNextBtn"),
  timelineScrollTodayBtn: document.getElementById("timelineScrollTodayBtn"),
  timelineEmptyState: document.getElementById("timelineEmptyState"),
  timelineEmptyText: document.getElementById("timelineEmptyText"),
  timelineEmptyActionBtn: document.getElementById("timelineEmptyActionBtn"),

  // Pubblie Modal Elements
  pubblieConfigDialog: document.getElementById("pubblieConfigDialog"),
  closePubblieConfigBtn: document.getElementById("closePubblieConfigBtn"),
  closePubblieConfigBottomBtn: document.getElementById("closePubblieConfigBottomBtn"),
  subtabBtnPubblieKey: document.getElementById("subtabBtnPubblieKey"),
  subtabBtnPubblieMapping: document.getElementById("subtabBtnPubblieMapping"),
  subtabBtnPubblieList: document.getElementById("subtabBtnPubblieList"),
  pubblieKeySection: document.getElementById("pubblieKeySection"),
  pubblieMappingSection: document.getElementById("pubblieMappingSection"),
  pubblieListSection: document.getElementById("pubblieListSection"),
  pubblieApiKeyInput: document.getElementById("pubblieApiKeyInput"),
  togglePubblieKeyBtn: document.getElementById("togglePubblieKeyBtn"),
  testAndSavePubblieKeyBtn: document.getElementById("testAndSavePubblieKeyBtn"),
  pubblieKeySpinner: document.getElementById("pubblieKeySpinner"),
  testAndSavePubblieKeyText: document.getElementById("testAndSavePubblieKeyText"),
  disconnectPubblieBtn: document.getElementById("disconnectPubblieBtn"),
  pubblieConnectionAlert: document.getElementById("pubblieConnectionAlert"),
  pubblieCopyFromAutoSelect: document.getElementById("pubblieCopyFromAutoSelect"),
  pubblieApplyAutoShortcutBtn: document.getElementById("pubblieApplyAutoShortcutBtn"),
  mappingPubblieProjectSelect: document.getElementById("mappingPubblieProjectSelect"),
  mappingPubblieChannelSelect: document.getElementById("mappingPubblieChannelSelect"),
  mappingAdAccountSelect: document.getElementById("mappingAdAccountSelect"),
  mappingCampaignSelect: document.getElementById("mappingCampaignSelect"),
  mappingAdsetSelect: document.getElementById("mappingAdsetSelect"),
  mappingRuleSelect: document.getElementById("mappingRuleSelect"),
  mappingNamingPattern: document.getElementById("mappingNamingPattern"),
  mappingAdStatusSelect: document.getElementById("mappingAdStatusSelect"),
  mappingAutoIncludeFlowCheckbox: document.getElementById("mappingAutoIncludeFlowCheckbox"),
  savePubblieMappingBtn: document.getElementById("savePubblieMappingBtn"),
  pubblieMappingsListContainer: document.getElementById("pubblieMappingsListContainer"),
  pubblieMappingsCountBadge: document.getElementById("pubblieMappingsCountBadge")
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
      } else if (targetViewId === "timelineView") {
        loadTimelineFeed();
        checkPubblieStatus();
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
        <div class="auto-detail-item">
          <span>Limite 50 Ads</span>
          <strong title="Strategia gestione limite 50 inserzioni per AdSet">
            ${item.adset_full_strategy === 'CREATE_NEW_ADSET' ? '📋 Duplica da pre-esistente' : item.adset_full_strategy === 'STOP_AND_ALERT' ? '⏸️ Stop & Avviso' : '🔄 Rotazione'}
          </strong>
        </div>
        ${item.filter_keywords ? `
        <div class="auto-detail-item">
          <span>Solo con</span>
          <strong title="${escapeHtml(item.filter_keywords)}">🔍 ${escapeHtml(item.filter_keywords)}</strong>
        </div>` : ""}
        ${item.exclude_keywords ? `
        <div class="auto-detail-item">
          <span>Escludi se</span>
          <strong title="${escapeHtml(item.exclude_keywords)}" style="color: #f87171;">🚫 ${escapeHtml(item.exclude_keywords)}</strong>
        </div>` : ""}
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

  // Dynamic cascades inside Modal - INDEPENDENT FROM MANUAL SPONSOR!
  dom.autoAdAccountSelect.addEventListener("change", async () => {
    const accountId = dom.autoAdAccountSelect.value;
    state.modalSelectedAccountId = accountId;
    if (!accountId) return;
    await loadModalSourcesForAccount(accountId);
    populateModalSources(state.modalSelectedPlatform);
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

  dom.autoAdsetStrategySelect?.addEventListener("change", (e) => {
    if (dom.cloneAdsetBox) {
      dom.cloneAdsetBox.style.display = (e.target.value === "CREATE_NEW_ADSET") ? "block" : "none";
    }
  });

  // Token Pills in Naming Pattern
  document.querySelectorAll(".tag-pills .pill").forEach(pill => {
    pill.addEventListener("click", () => {
      const tag = pill.getAttribute("data-tag");
      if (!tag) return;
      const input = dom.autoNamingPattern;
      input.value += ` ${tag}`;
      updateLiveAdNamePreview();
      input.focus();
    });
  });

  // Hours presets pills
  document.querySelectorAll("[data-hours]").forEach(pill => {
    pill.addEventListener("click", () => {
      const hours = pill.getAttribute("data-hours");
      const el = dom.autoIntervalInput || dom.autoIntervalSelect;
      if (el) el.value = hours;
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

async function openNewModal() {
  state.editingAutoId = null;
  dom.modalTitle.textContent = "Nuova Regola di Automazione";
  dom.autoFormId.value = "";
  dom.autoNameInput.value = "";
  dom.autoNamingPattern.value = "ADV - {platform} - {post}";
  dom.autoFilterKeywords.value = "";
  if (dom.autoExcludeKeywords) dom.autoExcludeKeywords.value = "";
  const newIntervalEl = dom.autoIntervalInput || dom.autoIntervalSelect;
  if (newIntervalEl) newIntervalEl.value = "3";
  dom.autoAdStatusSelect.value = "PAUSED";
  if (dom.autoAdsetStrategySelect) {
    dom.autoAdsetStrategySelect.value = "ROTATE_OLDEST";
    if (dom.cloneAdsetBox) dom.cloneAdsetBox.style.display = "none";
  }
  if (dom.autoAdsetCloneNameInput) dom.autoAdsetCloneNameInput.value = "";
  if (dom.autoAdsetCloneSourceSelect) dom.autoAdsetCloneSourceSelect.innerHTML = `<option value="">Usa lo stesso gruppo iniziale</option>`;

  // Default start time to NOW in local datetime-local format
  if (dom.autoStartTimeInput) {
    const now = new Date();
    const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    dom.autoStartTimeInput.value = localNow;
  }

  if (dom.sourcePreviewContainer) dom.sourcePreviewContainer.hidden = true;
  if (dom.duplicateFromModalBtn) dom.duplicateFromModalBtn.style.display = "none";

  state.modalSelectedPlatform = "Facebook";
  dom.btnPlatformFB.classList.add("active");
  dom.btnPlatformIG.classList.remove("active");

  await populateModalAdAccounts();
  updateLiveAdNamePreview();
  dom.automationModal.showModal();
}

async function openEditModal(id) {
  const item = state.automations.find(a => a.id === id);
  if (!item) return;

  state.editingAutoId = id;
  dom.modalTitle.textContent = "Modifica Regola di Automazione";
  dom.autoFormId.value = item.id;
  dom.autoNameInput.value = item.name;
  dom.autoNamingPattern.value = item.ad_name_pattern || "ADV - {platform} - {post}";
  dom.autoFilterKeywords.value = item.filter_keywords || "";
  if (dom.autoExcludeKeywords) dom.autoExcludeKeywords.value = item.exclude_keywords || "";
  const editIntervalEl = dom.autoIntervalInput || dom.autoIntervalSelect;
  if (editIntervalEl) editIntervalEl.value = String(item.check_interval_hours || 3);
  dom.autoAdStatusSelect.value = item.ad_status || "PAUSED";
  if (dom.autoAdsetStrategySelect) {
    dom.autoAdsetStrategySelect.value = item.adset_full_strategy || "ROTATE_OLDEST";
    if (dom.cloneAdsetBox) {
      dom.cloneAdsetBox.style.display = (item.adset_full_strategy === "CREATE_NEW_ADSET") ? "block" : "none";
    }
  }
  if (dom.autoAdsetCloneNameInput) {
    dom.autoAdsetCloneNameInput.value = item.adset_clone_name_pattern || "";
  }

  if (dom.autoStartTimeInput) {
    const rawStart = item.start_time || item.created_at || new Date().toISOString();
    const startDate = new Date(rawStart);
    const localStart = new Date(startDate.getTime() - startDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    dom.autoStartTimeInput.value = localStart;
  }

  state.modalSelectedPlatform = item.platform;
  dom.btnPlatformFB.classList.toggle("active", item.platform === "Facebook");
  dom.btnPlatformIG.classList.toggle("active", item.platform === "Instagram");

  if (dom.duplicateFromModalBtn) dom.duplicateFromModalBtn.style.display = "inline-flex";
  await populateModalAdAccounts(item.ad_account_id, item.campaign_id, item.adset_id, item.rule_id, item.adset_clone_source_id);
  if (item.source_id && dom.autoSourceSelect) {
    dom.autoSourceSelect.value = item.source_id;
  }

  updateLiveAdNamePreview();
  dom.automationModal.showModal();
  setTimeout(() => loadSourcePreviewPosts(), 300);
}

async function loadModalSourcesForAccount(accountId) {
  if (!accountId) {
    state.modalSources = { facebookPages: [], instagramAccounts: [] };
    return;
  }
  try {
    const payload = await api(`/api/meta/sources?accountId=${encodeURIComponent(accountId)}`);
    state.modalSources = {
      facebookPages: payload.facebookPages || [],
      instagramAccounts: payload.instagramAccounts || []
    };
  } catch (err) {
    console.warn("Impossibile caricare fonti per account modal:", err);
    state.modalSources = { facebookPages: [], instagramAccounts: [] };
  }
}

function populateModalSources(platform, selectedId = "") {
  const select = dom.autoSourceSelect;
  select.innerHTML = "";

  const sources = platform === "Facebook" ? state.modalSources.facebookPages : state.modalSources.instagramAccounts;
  if (!sources || !sources.length) {
    select.innerHTML = `<option value="">Nessuna fonte ${platform} trovata per questo account</option>`;
    if (dom.sourcePreviewContainer) dom.sourcePreviewContainer.hidden = true;
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

  loadSourcePreviewPosts();
}

async function populateModalAdAccounts(targetAccountId = "", targetCampaignId = "", targetAdsetId = "", targetRuleId = "", targetCloneSourceId = "") {
  const select = dom.autoAdAccountSelect;
  select.innerHTML = "";

  // Show only active/non-hidden accounts, UNLESS the targetAccountId is hidden (preserve existing rule)
  const visibleAccounts = (state.allAdAccounts || []).filter(acc => !state.hiddenAccountIds.has(acc.id) || acc.id === targetAccountId);

  if (!visibleAccounts.length) {
    select.innerHTML = `<option value="">Nessun account pubblicitario disponibile (o tutti archiviati)</option>`;
    return;
  }

  visibleAccounts.forEach(acc => {
    const opt = document.createElement("option");
    opt.value = acc.id;
    opt.textContent = `${acc.name} (${acc.id})` + (state.hiddenAccountIds.has(acc.id) ? " [Archiviato]" : "");
    if (targetAccountId ? acc.id === targetAccountId : false) opt.selected = true;
    select.appendChild(opt);
  });

  const selectedAccountId = select.value || visibleAccounts[0]?.id;
  state.modalSelectedAccountId = selectedAccountId;
  if (selectedAccountId) {
    await loadModalSourcesForAccount(selectedAccountId);
    populateModalSources(state.modalSelectedPlatform);
    await populateModalCampaigns(selectedAccountId, targetCampaignId, targetAdsetId, targetCloneSourceId);
    await populateModalRules(selectedAccountId, targetRuleId);
  }
}

async function populateModalCampaigns(accountId, targetCampaignId = "", targetAdsetId = "", targetCloneSourceId = "") {
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
      await populateModalAdsets(accountId, activeCampaignId, targetAdsetId, targetCloneSourceId);
    }
  } catch (err) {
    select.innerHTML = `<option value="">Errore campagne: ${err.message}</option>`;
  }
}

async function populateModalAdsets(accountId, campaignId, targetAdsetId = "", targetCloneSourceId = "") {
  const select = dom.autoAdsetSelect;
  const cloneSelect = dom.autoAdsetCloneSourceSelect;
  select.innerHTML = `<option value="">Caricamento gruppi...</option>`;
  if (cloneSelect) cloneSelect.innerHTML = `<option value="">Caricamento gruppi...</option>`;

  try {
    const payload = await api(`/api/meta/adsets?accountId=${encodeURIComponent(accountId)}&campaignId=${encodeURIComponent(campaignId)}`);
    const adsets = payload.data || [];
    select.innerHTML = "";
    if (cloneSelect) cloneSelect.innerHTML = `<option value="">Usa lo stesso gruppo iniziale</option>`;

    if (!adsets.length) {
      select.innerHTML = `<option value="">Nessun gruppo inserzioni</option>`;
      return;
    }

    adsets.forEach(a => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.dataset.name = a.name;
      opt.textContent = `${a.name} [${a.effective_status || a.status}]`;
      if (targetAdsetId ? a.id === targetAdsetId : false) opt.selected = true;
      select.appendChild(opt);

      if (cloneSelect) {
        const cloneOpt = document.createElement("option");
        cloneOpt.value = a.id;
        cloneOpt.dataset.name = a.name;
        cloneOpt.textContent = `${a.name} [${a.effective_status || a.status}]`;
        if (targetCloneSourceId ? a.id === targetCloneSourceId : false) cloneOpt.selected = true;
        cloneSelect.appendChild(cloneOpt);
      }
    });

    if (targetAdsetId && !adsets.some(a => a.id === targetAdsetId)) {
      const opt = document.createElement("option");
      opt.value = targetAdsetId;
      opt.dataset.name = targetAdsetId;
      opt.textContent = `Gruppo configurato (${targetAdsetId})`;
      opt.selected = true;
      select.prepend(opt);
    }

    if (cloneSelect && targetCloneSourceId && !adsets.some(a => a.id === targetCloneSourceId)) {
      const cloneOpt = document.createElement("option");
      cloneOpt.value = targetCloneSourceId;
      cloneOpt.dataset.name = targetCloneSourceId;
      cloneOpt.textContent = `Gruppo sorgente configurato (${targetCloneSourceId})`;
      cloneOpt.selected = true;
      cloneSelect.appendChild(cloneOpt);
    }
  } catch (err) {
    select.innerHTML = `<option value="">Errore gruppi: ${err.message}</option>`;
    if (cloneSelect) cloneSelect.innerHTML = `<option value="">Errore gruppi: ${err.message}</option>`;
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
    check_interval_hours: Math.max(1, Number((dom.autoIntervalInput || dom.autoIntervalSelect)?.value) || 3),
    ad_status: dom.autoAdStatusSelect.value || "PAUSED",
    ad_name_pattern: dom.autoNamingPattern.value || "ADV - {platform} - {post}",
    filter_keywords: dom.autoFilterKeywords.value.trim(),
    exclude_keywords: dom.autoExcludeKeywords ? dom.autoExcludeKeywords.value.trim() : "",
    start_time: dom.autoStartTimeInput?.value ? new Date(dom.autoStartTimeInput.value).toISOString() : new Date().toISOString(),
    adset_full_strategy: dom.autoAdsetStrategySelect?.value || "ROTATE_OLDEST",
    adset_clone_source_id: (dom.autoAdsetStrategySelect?.value === "CREATE_NEW_ADSET") ? (dom.autoAdsetCloneSourceSelect?.value || "") : "",
    adset_clone_name_pattern: (dom.autoAdsetStrategySelect?.value === "CREATE_NEW_ADSET") ? (dom.autoAdsetCloneNameInput?.value?.trim() || "") : ""
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
    state.allAdAccounts = config.adAccounts || [];

    // Load hidden accounts from server & local storage
    const serverHidden = config.hiddenAccounts || [];
    let localHidden = [];
    try { localHidden = JSON.parse(localStorage.getItem("autosponsor_hidden_accounts") || "[]"); } catch {}
    state.hiddenAccountIds = new Set([...serverHidden, ...localHidden]);

    updateHiddenAccountsCount();

    // Populate manual accounts from allAdAccounts
    state.manual.adAccounts = state.allAdAccounts;
    state.manual.facebookPages = config.facebookPages || [];
    state.manual.instagramAccounts = config.instagramAccounts || [];
    state.manual.sourcesMode = "configured";
    state.manual.sourcesNote = "Fonti configurate nel sistema.";

    const visibleAccounts = state.allAdAccounts.filter(a => !state.hiddenAccountIds.has(a.id));
    if (!state.manual.target.adAccountId && visibleAccounts.length) {
      state.manual.target.adAccountId = visibleAccounts[0].id;
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

  // Selectors (Filtering hidden/archived accounts in manual unless toggle checked)
  const visibleManualAccounts = (state.allAdAccounts || []).filter(a => state.showHiddenInManual || !state.hiddenAccountIds.has(a.id) || a.id === m.target.adAccountId);
  dom.adAccountSelect.innerHTML = visibleManualAccounts.map(a => {
    const isArchived = state.hiddenAccountIds.has(a.id);
    return `<option value="${a.id}" ${a.id === m.target.adAccountId ? "selected" : ""}>${escapeHtml(a.name)} (${a.id})${isArchived ? " [Archiviato]" : ""}</option>`;
  }).join("");
  dom.campaignSelect.innerHTML = m.campaigns.map(c => `<option value="${c.id}" ${c.id === m.target.campaignId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("");
  dom.adsetSelect.innerHTML = m.adsets.map(a => `<option value="${a.id}" data-name="${escapeHtml(a.name)}" ${a.id === m.target.adsetId ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("");
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
// Account Management & Archive Dialog Logic
// -----------------------------------------------------------------------------
function updateHiddenAccountsCount() {
  if (dom.hiddenAccountsCountManual) {
    dom.hiddenAccountsCountManual.textContent = state.hiddenAccountIds.size;
  }
}

function openManageAccountsDialog() {
  if (!dom.manageAccountsDialog) return;
  renderManageAccountsList();
  dom.manageAccountsDialog.showModal();
}

function renderManageAccountsList(searchQuery = "") {
  const container = dom.manageAccountsList;
  if (!container) return;
  container.innerHTML = "";

  const query = (searchQuery || dom.manageAccountsSearch?.value || "").toLowerCase().trim();
  const accounts = (state.allAdAccounts || []).filter(a => {
    if (!query) return true;
    return a.name.toLowerCase().includes(query) || a.id.toLowerCase().includes(query);
  });

  if (!accounts.length) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 24px;">Nessun account trovato</div>`;
    return;
  }

  accounts.forEach(acc => {
    const isHidden = state.hiddenAccountIds.has(acc.id);
    const row = document.createElement("div");
    row.className = `account-manage-item ${isHidden ? 'is-hidden' : ''}`;
    row.innerHTML = `
      <div class="account-manage-info">
        <strong>${escapeHtml(acc.name)} ${isHidden ? '<span class="badge-archived">Archiviato</span>' : ''}</strong>
        <span>${escapeHtml(acc.id)} · ${escapeHtml(acc.currency || 'EUR')} · ${escapeHtml(acc.timezone_name || 'N/D')}</span>
      </div>
      <button class="btn btn-sm ${isHidden ? 'btn-secondary' : 'btn-ghost'} toggle-archive-btn" data-id="${acc.id}" type="button">
        ${isHidden ? '🙈 Ripristina' : '👁️ Archivia'}
      </button>
    `;

    row.querySelector(".toggle-archive-btn").addEventListener("click", () => {
      if (state.hiddenAccountIds.has(acc.id)) {
        state.hiddenAccountIds.delete(acc.id);
      } else {
        state.hiddenAccountIds.add(acc.id);
      }
      renderManageAccountsList();
    });

    container.appendChild(row);
  });
}

async function saveManagedAccounts() {
  const hiddenArray = Array.from(state.hiddenAccountIds);
  try {
    await api("/api/settings/hidden-accounts", {
      method: "POST",
      body: JSON.stringify({ hiddenAccounts: hiddenArray })
    });
    try {
      localStorage.setItem("autosponsor_hidden_accounts", JSON.stringify(hiddenArray));
    } catch {}

    updateHiddenAccountsCount();
    renderManual();

    // If modal is open, re-populate modal accounts
    if (dom.automationModal.open) {
      await populateModalAdAccounts(dom.autoAdAccountSelect.value);
    }

    dom.manageAccountsDialog.close();
    showBanner("Impostazioni account pubblicitari salvate", "info");
  } catch (err) {
    showBanner(`Errore salvataggio: ${err.message}`, "danger");
  }
}

function setupAccountManagement() {
  dom.manageManualAccountsBtn?.addEventListener("click", () => openManageAccountsDialog());
  dom.manageModalAccountsBtn?.addEventListener("click", () => openManageAccountsDialog());
  dom.closeManageAccountsBtn?.addEventListener("click", () => dom.manageAccountsDialog.close());

  dom.manageAccountsSearch?.addEventListener("input", (e) => {
    renderManageAccountsList(e.target.value);
  });

  dom.restoreAllAccountsBtn?.addEventListener("click", () => {
    state.hiddenAccountIds.clear();
    renderManageAccountsList();
  });

  dom.saveManagedAccountsBtn?.addEventListener("click", async () => {
    await saveManagedAccounts();
  });

  dom.showHiddenManualAccountsToggle?.addEventListener("change", (e) => {
    state.showHiddenInManual = e.target.checked;
    renderManual();
  });
}

// -----------------------------------------------------------------------------
// Authentication & Protection Logic
// -----------------------------------------------------------------------------
let isAuthSetupMode = false;

async function checkAuthStatus() {
  try {
    const res = await fetch("/api/auth/status", { cache: "no-store" });
    const data = await res.json();
    return data;
  } catch (err) {
    return { authenticated: false, setupRequired: false };
  }
}

function showAuthOverlay(setupRequired = false) {
  if (!dom.authOverlay) return;
  isAuthSetupMode = setupRequired;
  dom.authOverlay.style.display = "flex";

  if (setupRequired) {
    if (dom.authSetupGroup) dom.authSetupGroup.style.display = "block";
    if (dom.authLoginGroup) dom.authLoginGroup.style.display = "none";
    if (dom.authSubtitle) dom.authSubtitle.textContent = "Prima Configurazione • Crea la tua Master Password";
    if (dom.authInfoBanner) dom.authInfoBanner.innerHTML = "⚡ <strong>Benvenuto!</strong> Crea una Master Password per proteggere l'accesso al pannello e nascondere tutti i clienti Meta da occhi indiscreti.";
    if (dom.authSubmitBtnText) dom.authSubmitBtnText.textContent = "Salva Password e Accedi 🔐";
    if (dom.authNewPassword) setTimeout(() => dom.authNewPassword.focus(), 100);
  } else {
    if (dom.authSetupGroup) dom.authSetupGroup.style.display = "none";
    if (dom.authLoginGroup) dom.authLoginGroup.style.display = "block";
    if (dom.authSubtitle) dom.authSubtitle.textContent = "Pannello Protetto • Meta Ads";
    if (dom.authInfoBanner) dom.authInfoBanner.innerHTML = "🔒 Inserisci la <strong>Master Password</strong> per accedere al pannello e gestire le inserzioni dei clienti Meta.";
    if (dom.authSubmitBtnText) dom.authSubmitBtnText.textContent = "Sblocca Accesso 🔓";
    if (dom.authPassword) {
      dom.authPassword.value = "";
      setTimeout(() => dom.authPassword.focus(), 100);
    }
  }

  if (dom.authAlert) {
    dom.authAlert.style.display = "none";
    dom.authAlert.textContent = "";
  }
}

function hideAuthOverlay() {
  if (!dom.authOverlay) return;
  dom.authOverlay.style.display = "none";
}

function showAuthError(msg) {
  if (!dom.authAlert) return;
  dom.authAlert.textContent = msg;
  dom.authAlert.style.display = "block";
}

function setAuthLoading(loading) {
  if (dom.authSpinner) dom.authSpinner.style.display = loading ? "inline-block" : "none";
  if (dom.authSubmitBtn) dom.authSubmitBtn.disabled = loading;
}

function setupAuth() {
  if (!dom.authForm) return;

  // Toggle password visibility
  dom.togglePwdBtn?.addEventListener("click", () => {
    if (!dom.authPassword) return;
    const isPwd = dom.authPassword.type === "password";
    dom.authPassword.type = isPwd ? "text" : "password";
    dom.togglePwdBtn.textContent = isPwd ? "🙈" : "👁️";
  });

  dom.toggleNewPwdBtn?.addEventListener("click", () => {
    if (!dom.authNewPassword) return;
    const isPwd = dom.authNewPassword.type === "password";
    dom.authNewPassword.type = isPwd ? "text" : "password";
    dom.toggleNewPwdBtn.textContent = isPwd ? "🙈" : "👁️";
  });

  // Handle Login / Setup submit
  dom.authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (dom.authAlert) dom.authAlert.style.display = "none";

    const password = isAuthSetupMode ? dom.authNewPassword?.value?.trim() : dom.authPassword?.value?.trim();
    if (!password) {
      showAuthError("Inserisci una password valida.");
      return;
    }

    if (isAuthSetupMode && password.length < 4) {
      showAuthError("La password deve contenere almeno 4 caratteri.");
      return;
    }

    setAuthLoading(true);

    try {
      const endpoint = isAuthSetupMode ? "/api/auth/setup" : "/api/auth/login";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        showAuthError(data.error || "Accesso fallito. Riprova.");
        setAuthLoading(false);
        return;
      }

      // Success!
      hideAuthOverlay();
      showBanner("✓ Accesso completato con successo. Dati clienti sbloccati.", "info");
      await loadInitialData();
    } catch (err) {
      showAuthError(err.message || "Errore di connessione al server.");
    } finally {
      setAuthLoading(false);
    }
  });

  // Logout button
  dom.logoutBtn?.addEventListener("click", async () => {
    if (!confirm("Vuoi disconnetterti e bloccare l'accesso al pannello su questo computer?")) return;
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    // Clear in-memory client data
    state.allAdAccounts = [];
    state.modalSources = { facebookPages: [], instagramAccounts: [] };
    state.automations = [];
    state.manual.publishedPosts = [];
    renderAutomationsGrid();
    renderManual();

    showAuthOverlay(false);
    showBanner("Sessione terminata. Il pannello è stato bloccato.", "info");
  });
}

async function loadInitialData() {
  await Promise.all([
    loadAutomations(),
    loadSystemStatus(),
    loadLogs(),
    loadManualConfig(),
    checkPubblieStatus(),
    loadTimelineFeed()
  ]);
}

// -----------------------------------------------------------------------------
// TIMELINE FLOW & PUBBLIE CONTROLLER IMPLEMENTATION
// -----------------------------------------------------------------------------

function parseTimelineDate(dateStr) {
  if (!dateStr) {
    return {
      dateKey: "nodate",
      diffDays: 999,
      isToday: false,
      badgeText: "Senza Data",
      fullDate: "",
      countTag: ""
    };
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    return {
      dateKey: "invalid",
      diffDays: 999,
      isToday: false,
      badgeText: "Data non valida",
      fullDate: "",
      countTag: ""
    };
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((targetDay - today) / (1000 * 60 * 60 * 24));
  const isToday = diffDays === 0;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const dateKey = `${yyyy}-${mm}-${dd}`;

  const weekdayStr = d.toLocaleDateString("it-IT", { weekday: "short" });
  const capitalizedWeekday = weekdayStr.charAt(0).toUpperCase() + weekdayStr.slice(1);
  const dayMonthStr = d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
  const fullDate = d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

  let badgeText = `${capitalizedWeekday} ${dayMonthStr}`;
  if (diffDays === 0) badgeText = `OGGI • ${dayMonthStr}`;
  else if (diffDays === 1) badgeText = `DOMANI • ${dayMonthStr}`;
  else if (diffDays === -1) badgeText = `IERI • ${dayMonthStr}`;

  return {
    dateKey,
    diffDays,
    isToday,
    badgeText,
    fullDate,
    weekday: capitalizedWeekday,
    dayMonth: dayMonthStr
  };
}

function formatTimelineDateGroup(dateStr) {
  return parseTimelineDate(dateStr).badgeText;
}

function formatTimeOnly(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

async function checkPubblieStatus() {
  try {
    const res = await api("/api/pubblie/status");
    state.timeline.pubblieConfigured = Boolean(res.configured && res.connection?.ok);
    state.timeline.pubblieUser = res.connection?.user || null;

    if (dom.kpiPubblieStatus && dom.kpiPubblieIndicator) {
      if (state.timeline.pubblieConfigured) {
        dom.kpiPubblieStatus.textContent = "Connesso";
        dom.kpiPubblieStatus.style.color = "var(--accent-emerald)";
        dom.kpiPubblieIndicator.className = "status-indicator success";
      } else if (res.configured) {
        dom.kpiPubblieStatus.textContent = "Errore Connessione";
        dom.kpiPubblieStatus.style.color = "var(--accent-rose)";
        dom.kpiPubblieIndicator.className = "status-indicator danger";
      } else {
        dom.kpiPubblieStatus.textContent = "Non Connesso";
        dom.kpiPubblieStatus.style.color = "var(--accent-amber)";
        dom.kpiPubblieIndicator.className = "status-indicator warning";
      }
    }

    if (dom.pubblieConnectPrompt) {
      dom.pubblieConnectPrompt.style.display = state.timeline.pubblieConfigured ? "none" : "flex";
    }

    if (state.timeline.pubblieConfigured) {
      loadPubblieProjects();
    }
  } catch (err) {
    console.warn("Errore verifica Pubblie:", err);
  }
}

async function loadTimelineFeed() {
  if (state.timeline.loading) return;
  state.timeline.loading = true;

  if (dom.timelineSpinner) dom.timelineSpinner.style.display = "inline-block";
  if (dom.refreshTimelineBtnText) dom.refreshTimelineBtnText.textContent = "Sincronizzazione...";

  try {
    const params = new URLSearchParams();
    if (state.timeline.filters.projectId) params.set("projectId", state.timeline.filters.projectId);
    if (state.timeline.filters.platform) params.set("platform", state.timeline.filters.platform);
    if (state.timeline.filters.status) params.set("status", state.timeline.filters.status);
    if (state.timeline.filters.days) params.set("days", state.timeline.filters.days);

    const res = await api(`/api/timeline/feed?${params.toString()}`);
    state.timeline.items = res.data || [];
    state.timeline.stats = res.stats || {};
    state.timeline.mappings = res.mappings || [];

    // Update badges & KPIs
    if (dom.badgeTimelineCount) dom.badgeTimelineCount.textContent = res.stats?.upcomingCount || 0;
    if (dom.pubblieMappingsCountBadge) dom.pubblieMappingsCountBadge.textContent = res.mappings?.length || 0;

    if (dom.kpiTimelineFuture) dom.kpiTimelineFuture.textContent = res.stats?.upcomingCount || 0;
    if (dom.kpiTimelineIncluded) dom.kpiTimelineIncluded.textContent = res.stats?.includedCount || 0;
    if (dom.kpiTimelineExcluded) dom.kpiTimelineExcluded.textContent = res.stats?.excludedCount || 0;
    if (dom.kpiTimelineSponsored) dom.kpiTimelineSponsored.textContent = res.stats?.sponsoredCount || 0;

    renderTimelineStream();
  } catch (err) {
    console.error("Errore caricamento timeline feed:", err);
    showBanner(`Errore caricamento feed timeline: ${err.message}`, "danger");
  } finally {
    state.timeline.loading = false;
    if (dom.timelineSpinner) dom.timelineSpinner.style.display = "none";
    if (dom.refreshTimelineBtnText) dom.refreshTimelineBtnText.textContent = "🔄 Sincronizza Previsioni";
  }
}

function renderTimelineStream() {
  const container = dom.timelineStream;
  const empty = dom.timelineEmptyState;
  const wrapper = dom.timelineStreamWrapper;
  if (!container || !empty) return;

  container.innerHTML = "";

  const query = (state.timeline.filters.query || "").toLowerCase().trim();
  let items = state.timeline.items;

  if (query) {
    items = items.filter(it => 
      (it.text || "").toLowerCase().includes(query) ||
      (it.projectName || "").toLowerCase().includes(query) ||
      (it.channelName || "").toLowerCase().includes(query)
    );
  }

  if (!items.length) {
    empty.style.display = "block";
    if (wrapper) wrapper.style.display = "none";
    else container.style.display = "none";
    return;
  }

  empty.style.display = "none";
  if (wrapper) wrapper.style.display = "block";
  container.style.display = "flex";

  // Group items by dateKey in chronological sequence
  const dayGroups = new Map();
  for (const item of items) {
    const info = parseTimelineDate(item.effectiveDate);
    if (!dayGroups.has(info.dateKey)) {
      dayGroups.set(info.dateKey, {
        info,
        items: []
      });
    }
    dayGroups.get(info.dateKey).items.push(item);
  }

  for (const { info, items: groupItems } of dayGroups.values()) {
    const groupEl = document.createElement("div");
    groupEl.className = "timeline-date-group";
    if (info.isToday) groupEl.dataset.isToday = "true";

    // Date milestone header
    const headerEl = document.createElement("div");
    headerEl.className = `timeline-date-header ${info.isToday ? "is-today" : ""}`;
    headerEl.title = info.fullDate || info.badgeText;
    headerEl.innerHTML = `
      <span class="date-milestone-marker"></span>
      <div class="date-title-box">
        <span>${info.isToday ? "🟢" : "📅"}</span>
        <span>${escapeHtml(info.badgeText)}</span>
      </div>
      <span class="date-badge-count">${groupItems.length} post</span>
    `;
    groupEl.appendChild(headerEl);

    const cardsListEl = document.createElement("div");
    cardsListEl.className = "timeline-cards-list";

    for (const item of groupItems) {
      const cardWrapper = document.createElement("div");
      cardWrapper.className = `timeline-card-wrapper ${item.flowStatus.toLowerCase()}`;
      cardWrapper.dataset.postId = item.rawId;

      const card = document.createElement("div");
      card.className = `timeline-card flow-${item.flowStatus.toLowerCase()}`;

      // 1. Header
      const header = document.createElement("div");
      header.className = "timeline-card-header";

      const badgesLeft = document.createElement("div");
      badgesLeft.className = "timeline-badges-left";

      const isIg = (item.platform || "").toLowerCase().includes("instagram");
      const isFb = (item.platform || "").toLowerCase().includes("facebook");
      const isTikTok = (item.platform || "").toLowerCase().includes("tiktok");
      const isLinkedIn = (item.platform || "").toLowerCase().includes("linkedin");
      const isGmb = (item.platform || "").toLowerCase().includes("google") || (item.platform || "").toLowerCase().includes("business");
      const isTwitter = (item.platform || "").toLowerCase().includes("twit") || (item.platform || "").toLowerCase().includes("x ");

      const platformPill = document.createElement("span");
      let icon = "📱";
      if (item.isMetaCompatible) {
        if (isFb && isIg) {
          platformPill.className = "timeline-platform-pill fb";
          platformPill.textContent = "📘 FB + 📸 IG";
          icon = "📘";
        } else if (isFb) {
          platformPill.className = "timeline-platform-pill fb";
          platformPill.textContent = "📘 FB";
          icon = "📘";
        } else {
          platformPill.className = "timeline-platform-pill ig";
          platformPill.textContent = "📸 IG";
          icon = "📸";
        }
      } else {
        if (isTikTok) {
          platformPill.className = "timeline-platform-pill tiktok";
          platformPill.textContent = "🎵 TikTok";
          icon = "🎵";
        } else if (isLinkedIn) {
          platformPill.className = "timeline-platform-pill linkedin";
          platformPill.textContent = "💼 LinkedIn";
          icon = "💼";
        } else if (isGmb) {
          platformPill.className = "timeline-platform-pill googlebusiness";
          platformPill.textContent = "📍 GMB";
          icon = "📍";
        } else if (isTwitter) {
          platformPill.className = "timeline-platform-pill twitter";
          platformPill.textContent = "🐦 Twitter";
          icon = "🐦";
        } else {
          platformPill.className = "timeline-platform-pill external";
          platformPill.textContent = `🌐 ${item.platform}`;
          icon = "🌐";
        }
      }
      badgesLeft.appendChild(platformPill);

      const timeBadge = document.createElement("span");
      timeBadge.className = "timeline-time-badge";
      timeBadge.textContent = formatTimeOnly(item.effectiveDate) || "Schedulato";
      badgesLeft.appendChild(timeBadge);

      if (item.projectName) {
        const projBadge = document.createElement("span");
        projBadge.className = "badge-tag";
        projBadge.style.fontSize = "0.70rem";
        projBadge.style.padding = "2px 6px";
        projBadge.textContent = item.projectName;
        badgesLeft.appendChild(projBadge);
      }

      header.appendChild(badgesLeft);

      // Status Pill Right
      const statusPill = document.createElement("span");
      if (!item.isMetaCompatible) {
        statusPill.className = "timeline-status-badge external";
        statusPill.innerHTML = `⚪ Canale Esterno`;
        statusPill.title = `Questo post è programmato su ${item.platform}. Meta Ads supporta solo post di Facebook e Instagram.`;
      } else if (item.flowStatus === "SPONSORED") {
        statusPill.className = "timeline-status-badge sponsored";
        statusPill.innerHTML = `🚀 ADV Attiva`;
      } else if (item.flowStatus === "INCLUDED") {
        statusPill.className = "timeline-status-badge included";
        statusPill.innerHTML = `🟢 Nel Flow`;
      } else {
        statusPill.className = "timeline-status-badge excluded";
        statusPill.innerHTML = `⚪ Escluso`;
      }
      header.appendChild(statusPill);
      card.appendChild(header);

      // 2. Body: media + preview
      const body = document.createElement("div");
      body.className = "timeline-card-body";

      const mediaBox = document.createElement("div");
      mediaBox.className = "timeline-media-box";
      if (item.images && item.images.length > 0) {
        const img = document.createElement("img");
        img.src = item.images[0];
        img.alt = "Anteprima";
        img.loading = "lazy";
        img.onerror = () => {
          mediaBox.innerHTML = `<span class="timeline-media-placeholder">${icon}</span>`;
        };
        mediaBox.appendChild(img);
      } else {
        mediaBox.innerHTML = `<span class="timeline-media-placeholder">${icon}</span>`;
      }
      body.appendChild(mediaBox);

      const contentBox = document.createElement("div");
      contentBox.className = "timeline-content-box";

      const caption = document.createElement("p");
      caption.className = "timeline-caption-text";
      caption.textContent = item.text || "(Nessun testo / media caption)";
      caption.title = item.text || "";
      contentBox.appendChild(caption);

      const targetPill = document.createElement("div");
      targetPill.className = "timeline-destination-pill";
      if (!item.isMetaCompatible) {
        targetPill.innerHTML = `<span class="dest-icon">${icon}</span> Pubblie: <strong>${escapeHtml(item.channelName || item.platform)}</strong> <small style="color: var(--text-dim);">(Solo organico)</small>`;
      } else if (item.mapping) {
        const campName = item.mapping.campaign_name || item.mapping.campaign_id;
        const adsetName = item.mapping.adset_name || item.mapping.adset_id;
        targetPill.title = `Campagna: ${campName} | Gruppo: ${adsetName}`;
        targetPill.innerHTML = `<span class="dest-icon">🎯</span> Meta: <strong>${escapeHtml(adsetName || campName)}</strong>`;
      } else {
        targetPill.innerHTML = `<span style="color: var(--accent-amber);">⚠️ Nessun target Meta</span> • <a href="#" class="configure-mapping-link" style="color: var(--accent-emerald); text-decoration: underline;">Associa</a>`;
        targetPill.querySelector(".configure-mapping-link")?.addEventListener("click", (e) => {
          e.preventDefault();
          openPubblieConfigModal("mapping");
        });
      }
      contentBox.appendChild(targetPill);

      body.appendChild(contentBox);
      card.appendChild(body);

      // 3. Footer / Decision Switch
      const footer = document.createElement("div");
      footer.className = "timeline-card-footer";

      if (!item.isMetaCompatible) {
        const nonMetaNote = document.createElement("span");
        nonMetaNote.style.fontSize = "0.78rem";
        nonMetaNote.style.color = "var(--text-dim)";
        nonMetaNote.title = "Questo post è destinato a un canale non Meta. Le campagne pubblicitarie Meta Ads supportano solo Facebook e Instagram.";
        nonMetaNote.innerHTML = `${icon} Canale <strong>${escapeHtml(item.platform)}</strong> (Non sponsorizzabile su Meta Ads)`;
        footer.appendChild(nonMetaNote);
      } else if (item.flowStatus !== "SPONSORED") {
        const flowToggleWrapper = document.createElement("label");
        flowToggleWrapper.className = "flow-toggle-wrapper";
        flowToggleWrapper.title = "Attiva per sponsorizzare automaticamente questo post o disattiva per escluderlo";

        const isChecked = item.flowStatus === "INCLUDED";
        flowToggleWrapper.innerHTML = `
          <input type="checkbox" class="flow-toggle-checkbox" ${isChecked ? "checked" : ""}>
          <span class="flow-toggle-switch"></span>
          <span class="flow-toggle-label">${isChecked ? "Sponsorizza Post" : "Non Sponsorizzare"}</span>
        `;

        const checkbox = flowToggleWrapper.querySelector(".flow-toggle-checkbox");
        checkbox.addEventListener("change", () => {
          flowToggleWrapper.querySelector(".flow-toggle-label").textContent = checkbox.checked ? "Sponsorizza Post" : "Non Sponsorizzare";
          togglePostFlow(item.rawId, checkbox.checked);
        });

        footer.appendChild(flowToggleWrapper);
      } else {
        const sponsoredNote = document.createElement("span");
        sponsoredNote.style.fontSize = "0.78rem";
        sponsoredNote.style.color = "var(--accent-blue)";
        sponsoredNote.style.fontWeight = "600";
        sponsoredNote.innerHTML = `✓ ADV Meta Creata ${item.adId ? `(${item.adId.slice(-6)})` : ""}`;
        footer.appendChild(sponsoredNote);
      }

      const actions = document.createElement("div");
      actions.className = "timeline-card-actions";

      if (item.isMetaCompatible && item.flowStatus !== "SPONSORED" && item.mapping) {
        const sponsorNowBtn = document.createElement("button");
        sponsorNowBtn.type = "button";
        sponsorNowBtn.className = "btn btn-secondary btn-xs";
        sponsorNowBtn.innerHTML = `⚡ Ora`;
        sponsorNowBtn.title = "Crea subito l'inserzione su Meta Ads per questo post";
        sponsorNowBtn.addEventListener("click", () => sponsorTimelinePostNow(item));
        actions.appendChild(sponsorNowBtn);
      }

      if (item.link) {
        const openLink = document.createElement("a");
        openLink.href = item.link;
        openLink.target = "_blank";
        openLink.rel = "noopener noreferrer";
        openLink.className = "btn btn-ghost btn-xs";
        openLink.innerHTML = `🔗 Post`;
        actions.appendChild(openLink);
      }

      footer.appendChild(actions);
      card.appendChild(footer);

      cardWrapper.appendChild(card);
      cardsListEl.appendChild(cardWrapper);
    }

    groupEl.appendChild(cardsListEl);
    container.appendChild(groupEl);
  }
}

async function togglePostFlow(postId, included) {
  const newStatus = included ? "INCLUDED" : "EXCLUDED";
  const item = state.timeline.items.find(i => i.rawId === postId);
  if (item) {
    item.flowStatus = newStatus;
  }

  // Update card in DOM
  const wrapper = document.querySelector(`.timeline-card-wrapper[data-post-id="${postId}"]`);
  if (wrapper) {
    wrapper.className = `timeline-card-wrapper ${newStatus.toLowerCase()}`;
    const card = wrapper.querySelector(".timeline-card");
    if (card) {
      card.className = `timeline-card flow-${newStatus.toLowerCase()}`;
    }
    const statusPill = wrapper.querySelector(".timeline-status-badge");
    if (statusPill) {
      statusPill.className = `timeline-status-badge ${newStatus.toLowerCase()}`;
      statusPill.innerHTML = included ? `🟢 Nel Flow` : `⚪ Escluso`;
    }
    const toggleLabel = wrapper.querySelector(".flow-toggle-label");
    if (toggleLabel) {
      toggleLabel.textContent = included ? "Sponsorizza Post" : "Non Sponsorizzare";
    }
    const checkbox = wrapper.querySelector(".flow-toggle-checkbox");
    if (checkbox && checkbox.checked !== included) {
      checkbox.checked = included;
    }
  }

  // Update KPI counters
  const incCount = state.timeline.items.filter(i => i.flowStatus === "INCLUDED").length;
  const excCount = state.timeline.items.filter(i => i.flowStatus === "EXCLUDED").length;
  if (dom.kpiTimelineIncluded) dom.kpiTimelineIncluded.textContent = incCount;
  if (dom.kpiTimelineExcluded) dom.kpiTimelineExcluded.textContent = excCount;

  try {
    await api("/api/timeline/decision", {
      method: "POST",
      body: JSON.stringify({
        postId,
        status: newStatus,
        source: item?.source || "pubblie",
        projectId: item?.projectId || "",
        channelId: item?.channelIds?.[0] || "",
        postText: item?.text || "",
        postPermalink: item?.link || ""
      })
    });
  } catch (err) {
    console.error("Errore aggiornamento decisione flow:", err);
    showBanner(`Errore salvataggio decisione flow: ${err.message}`, "danger");
  }
}

async function bulkToggleFlow(status) {
  const visibleCards = Array.from(document.querySelectorAll(".timeline-card-wrapper"));
  const postIds = visibleCards.map(c => c.dataset.postId).filter(Boolean);

  if (!postIds.length) {
    showBanner("Nessun post visibile da aggiornare.", "warning");
    return;
  }

  const isIncluded = status === "INCLUDED";
  postIds.forEach(id => {
    const item = state.timeline.items.find(i => i.rawId === id);
    if (item && item.flowStatus !== "SPONSORED") {
      item.flowStatus = status;
    }
  });

  renderTimelineStream();

  const incCount = state.timeline.items.filter(i => i.flowStatus === "INCLUDED").length;
  const excCount = state.timeline.items.filter(i => i.flowStatus === "EXCLUDED").length;
  if (dom.kpiTimelineIncluded) dom.kpiTimelineIncluded.textContent = incCount;
  if (dom.kpiTimelineExcluded) dom.kpiTimelineExcluded.textContent = excCount;

  try {
    await api("/api/timeline/bulk-decision", {
      method: "POST",
      body: JSON.stringify({ postIds, status })
    });
    showBanner(`✓ ${postIds.length} post aggiornati nel Flow (${isIncluded ? "Tutti Inclusi" : "Tutti Esclusi"}).`, "info");
  } catch (err) {
    console.error("Errore bulk toggle flow:", err);
    showBanner(`Errore aggiornamento batch: ${err.message}`, "danger");
  }
}

async function sponsorTimelinePostNow(item) {
  if (!item.mapping) {
    alert("Devi prima associare i parametri Meta a questo canale nelle impostazioni di Pubblie.");
    openPubblieConfigModal("mapping");
    return;
  }

  const confirmMsg = `Vuoi creare subito un'inserzione Meta per questo post?\n\n` +
    `• Account: ${item.mapping.ad_account_name || item.mapping.ad_account_id}\n` +
    `• Campagna: ${item.mapping.campaign_name || item.mapping.campaign_id}\n` +
    `• Gruppo (AdSet): ${item.mapping.adset_name || item.mapping.adset_id}\n` +
    `• Stato: ${item.mapping.ad_status || "PAUSED"}`;

  if (!confirm(confirmMsg)) return;

  try {
    showBanner("Creazione inserzione su Meta in corso...", "info");
    const payload = {
      postId: item.rawId,
      sourcePostId: item.rawId,
      platform: item.platform,
      adAccountId: item.mapping.ad_account_id,
      adsetId: item.mapping.adset_id,
      ruleId: item.mapping.rule_id || null,
      adName: `ADV - ${item.platform} - ${item.text.slice(0, 30).trim() || item.rawId.slice(-6)}`,
      adStatus: item.mapping.ad_status || "PAUSED",
      permalink: item.link || ""
    };

    const res = await api("/api/timeline/sponsor-now", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    item.flowStatus = "SPONSORED";
    item.adId = res.adId;
    renderTimelineStream();

    showBanner(`✓ Inserzione creata con successo su Meta Ads! (Ad ID: ${res.adId})`, "info");
  } catch (err) {
    console.error("Errore sponsorizzazione immediata:", err);
    alert(`Errore creazione inserzione Meta: ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// PUBBLIE CONFIGURATION & META MAPPING MODAL
// -----------------------------------------------------------------------------

function openPubblieConfigModal(targetSubtab = "key") {
  if (!dom.pubblieConfigDialog) return;
  dom.pubblieConfigDialog.showModal();
  switchPubblieSubtab(targetSubtab === "mapping" ? "pubblieMappingSection" : (targetSubtab === "list" ? "pubblieListSection" : "pubblieKeySection"));
  loadPubblieMappings();
  loadPubblieProjects();
  populatePubblieAutoShortcuts();
  populatePubblieMetaAccounts();
}

function switchPubblieSubtab(sectionId) {
  const tabs = [
    { btn: dom.subtabBtnPubblieKey, sec: dom.pubblieKeySection, id: "pubblieKeySection" },
    { btn: dom.subtabBtnPubblieMapping, sec: dom.pubblieMappingSection, id: "pubblieMappingSection" },
    { btn: dom.subtabBtnPubblieList, sec: dom.pubblieListSection, id: "pubblieListSection" }
  ];

  tabs.forEach(t => {
    const isTarget = t.id === sectionId;
    t.btn?.classList.toggle("active", isTarget);
    if (t.sec) t.sec.style.display = isTarget ? "block" : "none";
  });
}

function populatePubblieAutoShortcuts() {
  const select = dom.pubblieCopyFromAutoSelect;
  if (!select) return;
  select.innerHTML = `<option value="">-- Seleziona un'automazione da copiare --</option>`;
  for (const auto of state.automations) {
    const opt = document.createElement("option");
    opt.value = auto.id;
    opt.textContent = `${auto.name} (${auto.platform} • ${auto.adset_name || auto.adset_id})`;
    select.appendChild(opt);
  }
}

function populatePubblieMetaAccounts(targetAccountId = "") {
  const select = dom.mappingAdAccountSelect;
  if (!select) return;
  select.innerHTML = `<option value="">-- Seleziona Account Pubblicitario Meta --</option>`;
  const visible = (state.allAdAccounts || []).filter(acc => !state.hiddenAccountIds.has(acc.id) || acc.id === targetAccountId);
  visible.forEach(acc => {
    const opt = document.createElement("option");
    opt.value = acc.id;
    opt.textContent = `${acc.name} (${acc.id})` + (state.hiddenAccountIds.has(acc.id) ? " [Archiviato]" : "");
    if (targetAccountId && acc.id === targetAccountId) opt.selected = true;
    select.appendChild(opt);
  });
}

async function loadPubblieMetaCampaigns(accountId, targetCampaignId = "", targetAdsetId = "", targetRuleId = "") {
  const campSelect = dom.mappingCampaignSelect;
  const adsetSelect = dom.mappingAdsetSelect;
  const ruleSelect = dom.mappingRuleSelect;
  if (!campSelect || !accountId) return;

  campSelect.innerHTML = `<option value="">Caricamento campagne...</option>`;
  if (adsetSelect) adsetSelect.innerHTML = `<option value="">-- Seleziona prima campagna --</option>`;
  if (ruleSelect) ruleSelect.innerHTML = `<option value="">Caricamento regole...</option>`;

  try {
    const [campRes, ruleRes] = await Promise.all([
      api(`/api/meta/campaigns?accountId=${encodeURIComponent(accountId)}`),
      api(`/api/meta/rules?accountId=${encodeURIComponent(accountId)}`).catch(() => ({ data: [] }))
    ]);

    const campaigns = campRes.data || [];
    campSelect.innerHTML = `<option value="">-- Seleziona Campagna Meta --</option>`;
    campaigns.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} [${c.effective_status || c.status}]`;
      if (targetCampaignId && c.id === targetCampaignId) opt.selected = true;
      campSelect.appendChild(opt);
    });

    if (ruleSelect) {
      const rules = ruleRes.data || [];
      ruleSelect.innerHTML = `<option value="">Nessuna regola</option>`;
      rules.forEach(r => {
        const opt = document.createElement("option");
        opt.value = r.id;
        opt.textContent = r.name || r.id;
        if (targetRuleId && r.id === targetRuleId) opt.selected = true;
        ruleSelect.appendChild(opt);
      });
    }

    const selectedCampId = targetCampaignId || campSelect.value;
    if (selectedCampId) {
      await loadPubblieMetaAdsets(accountId, selectedCampId, targetAdsetId);
    }
  } catch (err) {
    campSelect.innerHTML = `<option value="">Errore campagne: ${escapeHtml(err.message)}</option>`;
  }
}

async function loadPubblieMetaAdsets(accountId, campaignId, targetAdsetId = "") {
  const adsetSelect = dom.mappingAdsetSelect;
  if (!adsetSelect || !accountId || !campaignId) return;

  adsetSelect.innerHTML = `<option value="">Caricamento gruppi...</option>`;
  try {
    const res = await api(`/api/meta/adsets?accountId=${encodeURIComponent(accountId)}&campaignId=${encodeURIComponent(campaignId)}`);
    const adsets = res.data || [];
    adsetSelect.innerHTML = `<option value="">-- Seleziona Gruppo Inserzioni (AdSet) --</option>`;
    adsets.forEach(a => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = `${a.name} [${a.effective_status || a.status}]`;
      if (targetAdsetId && a.id === targetAdsetId) opt.selected = true;
      adsetSelect.appendChild(opt);
    });
  } catch (err) {
    adsetSelect.innerHTML = `<option value="">Errore gruppi: ${escapeHtml(err.message)}</option>`;
  }
}

async function loadPubblieProjects() {
  const projectSelect = dom.mappingPubblieProjectSelect;
  const filterProject = dom.timelineFilterProject;
  if (!projectSelect && !filterProject) return;

  try {
    const res = await api("/api/pubblie/projects");
    state.timeline.projects = res.data || [];
    if (Array.isArray(res.archivedProjectIds)) {
      state.timeline.archivedProjectIds = new Set(res.archivedProjectIds);
    }

    if (dom.archivedProjectsCountBadge) {
      dom.archivedProjectsCountBadge.textContent = state.timeline.archivedProjectIds.size;
    }

    if (projectSelect) {
      projectSelect.innerHTML = `<option value="">-- Seleziona un Progetto Pubblie --</option>`;
    }
    if (filterProject) {
      filterProject.innerHTML = `<option value="">Tutti i Progetti Attivi</option>`;
    }

    const activeProjects = state.timeline.projects.filter(p => !state.timeline.archivedProjectIds.has(p.id));
    const archivedProjects = state.timeline.projects.filter(p => state.timeline.archivedProjectIds.has(p.id));

    for (const p of activeProjects) {
      const label = `${p.name} ${p.teamName ? `(${p.teamName})` : ""}`;
      if (projectSelect) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = label;
        projectSelect.appendChild(opt);
      }

      if (filterProject) {
        const optFilter = document.createElement("option");
        optFilter.value = p.id;
        optFilter.textContent = label;
        if (state.timeline.filters.projectId === p.id) optFilter.selected = true;
        filterProject.appendChild(optFilter);
      }
    }

    if (archivedProjects.length > 0) {
      if (filterProject) {
        const optGroupFilter = document.createElement("optgroup");
        optGroupFilter.label = "── Progetti Archiviati ──";
        for (const p of archivedProjects) {
          const optFilter = document.createElement("option");
          optFilter.value = p.id;
          optFilter.textContent = `${p.name} [Archiviato]`;
          if (state.timeline.filters.projectId === p.id) optFilter.selected = true;
          optGroupFilter.appendChild(optFilter);
        }
        filterProject.appendChild(optGroupFilter);
      }

      if (projectSelect) {
        const optGroupProj = document.createElement("optgroup");
        optGroupProj.label = "── Progetti Archiviati ──";
        for (const p of archivedProjects) {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = `${p.name} [Archiviato]`;
          optGroupProj.appendChild(opt);
        }
        projectSelect.appendChild(optGroupProj);
      }
    }
  } catch (err) {
    console.warn("Impossibile caricare progetti Pubblie:", err);
    if (projectSelect) projectSelect.innerHTML = `<option value="">(Nessun progetto trovato o chiave non valida)</option>`;
  }
}

function openManageProjectsDialog() {
  if (!dom.managePubblieProjectsDialog) return;
  renderManageProjectsList();
  dom.managePubblieProjectsDialog.showModal();
}

function renderManageProjectsList(searchQuery = "") {
  const container = dom.managePubblieProjectsList;
  if (!container) return;
  container.innerHTML = "";

  const query = (searchQuery || dom.managePubblieProjectsSearch?.value || "").toLowerCase().trim();
  const projects = (state.timeline.projects || []).filter(p => {
    if (!query) return true;
    return (p.name || "").toLowerCase().includes(query) ||
           (p.teamName || "").toLowerCase().includes(query) ||
           (p.id || "").toLowerCase().includes(query);
  });

  if (!projects.length) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 24px;">Nessun progetto trovato</div>`;
    return;
  }

  projects.forEach(p => {
    const isArchived = state.timeline.archivedProjectIds.has(p.id);
    const row = document.createElement("div");
    row.className = `project-manage-item ${isArchived ? "is-archived" : ""}`;
    row.innerHTML = `
      <div class="project-manage-info">
        <strong>${escapeHtml(p.name)} ${isArchived ? '<span class="badge-archived">Archiviato</span>' : ''}</strong>
        <span>${escapeHtml(p.teamName ? `Team: ${p.teamName} · ` : "")}ID: ${escapeHtml(p.id)}</span>
      </div>
      <button class="btn btn-sm ${isArchived ? 'btn-secondary' : 'btn-ghost'} toggle-archive-proj-btn" data-id="${p.id}" type="button">
        ${isArchived ? '👁️ Ripristina' : '🙈 Archivia'}
      </button>
    `;

    row.querySelector(".toggle-archive-proj-btn").addEventListener("click", () => {
      if (state.timeline.archivedProjectIds.has(p.id)) {
        state.timeline.archivedProjectIds.delete(p.id);
      } else {
        state.timeline.archivedProjectIds.add(p.id);
      }
      renderManageProjectsList();
    });

    container.appendChild(row);
  });
}

async function saveManagedProjects() {
  const archivedArray = Array.from(state.timeline.archivedProjectIds);
  try {
    await api("/api/pubblie/archived-projects", {
      method: "POST",
      body: JSON.stringify({ archivedProjectIds: archivedArray })
    });
    try {
      localStorage.setItem("autosponsor_archived_projects", JSON.stringify(archivedArray));
    } catch {}

    if (dom.archivedProjectsCountBadge) {
      dom.archivedProjectsCountBadge.textContent = state.timeline.archivedProjectIds.size;
    }

    await loadPubblieProjects();
    await loadTimelineFeed();

    dom.managePubblieProjectsDialog.close();
    showBanner(`✓ Progetti aggiornati (${archivedArray.length} archiviati)`, "info");
  } catch (err) {
    showBanner(`Errore salvataggio progetti archiviati: ${err.message}`, "danger");
  }
}

function setupProjectManagement() {
  dom.managePubblieProjectsBtn?.addEventListener("click", () => openManageProjectsDialog());
  dom.closeManagePubblieProjectsBtn?.addEventListener("click", () => dom.managePubblieProjectsDialog?.close());
  dom.cancelManagePubblieProjectsBtn?.addEventListener("click", () => dom.managePubblieProjectsDialog?.close());

  dom.managePubblieProjectsSearch?.addEventListener("input", (e) => {
    renderManageProjectsList(e.target.value);
  });

  dom.restoreAllPubblieProjectsBtn?.addEventListener("click", () => {
    state.timeline.archivedProjectIds.clear();
    renderManageProjectsList();
  });

  dom.saveManagedPubblieProjectsBtn?.addEventListener("click", async () => {
    await saveManagedProjects();
  });
}

async function loadPubblieChannels(projectId) {
  const channelSelect = dom.mappingPubblieChannelSelect;
  if (!channelSelect || !projectId) return;

  channelSelect.innerHTML = `<option value="">Caricamento canali...</option>`;
  try {
    const res = await api(`/api/pubblie/projects/${encodeURIComponent(projectId)}/channels`);
    state.timeline.channels = res.data || [];

    channelSelect.innerHTML = `<option value="">Tutti i Canali del Progetto (Predefinito)</option>`;
    for (const c of state.timeline.channels) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.dataset.provider = c.provider;
      opt.textContent = `${c.provider?.toUpperCase() || "SOCIAL"}: ${c.name} ${c.accountUsername ? `(@${c.accountUsername})` : ""}`;
      channelSelect.appendChild(opt);
    }
  } catch (err) {
    console.warn("Impossibile caricare canali Pubblie:", err);
    channelSelect.innerHTML = `<option value="">Errore caricamento canali</option>`;
  }
}

async function loadPubblieMappings() {
  try {
    const res = await api("/api/pubblie/mappings");
    state.timeline.mappings = res.data || [];
    if (dom.pubblieMappingsCountBadge) {
      dom.pubblieMappingsCountBadge.textContent = state.timeline.mappings.length;
    }
    renderPubblieMappingsList();
  } catch (err) {
    console.warn("Errore caricamento mappature Pubblie:", err);
  }
}

function renderPubblieMappingsList() {
  const container = dom.pubblieMappingsListContainer;
  if (!container) return;

  container.innerHTML = "";
  if (!state.timeline.mappings.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 24px 16px;">
        <p style="margin: 0; color: var(--text-dim); font-size: 0.88rem;">
          Nessuna associazione configurata. Vai nel tab <strong>"2. Associa Canali a Meta Ads"</strong> per collegare i tuoi canali Pubblie agli account pubblicitari Meta.
        </p>
      </div>
    `;
    return;
  }

  for (const m of state.timeline.mappings) {
    const card = document.createElement("div");
    card.className = "pubblie-mapping-card";

    const isIg = (m.channel_provider || "").toLowerCase().includes("insta");
    card.innerHTML = `
      <div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <span class="timeline-platform-pill ${isIg ? "ig" : "fb"}">${isIg ? "📸 Instagram" : "📘 Facebook"}</span>
          <strong>${escapeHtml(m.channel_name || m.project_name || "Canale")}</strong>
          <span style="font-size: 0.75rem; color: var(--text-dim); font-family: 'JetBrains Mono', monospace;">(Proj: ${escapeHtml(m.project_name)})</span>
        </div>
        <div style="font-size: 0.82rem; color: var(--text-muted); font-family: 'JetBrains Mono', monospace;">
          🎯 ${escapeHtml(m.ad_account_name || m.ad_account_id)} &gt; ${escapeHtml(m.campaign_name || m.campaign_id)} &gt; <strong>${escapeHtml(m.adset_name || m.adset_id)}</strong>
        </div>
      </div>
      <div>
        <button type="button" class="btn btn-ghost btn-sm delete-pub-map-btn" data-id="${escapeHtml(m.id)}" style="color: var(--accent-rose);" title="Elimina associazione">
          🗑️ Elimina
        </button>
      </div>
    `;

    card.querySelector(".delete-pub-map-btn")?.addEventListener("click", () => handleDeletePubblieMapping(m.id));
    container.appendChild(card);
  }
}

async function handleDeletePubblieMapping(id) {
  if (!confirm("Sei sicuro di voler eliminare questa associazione?")) return;
  try {
    await api(`/api/pubblie/mappings/${encodeURIComponent(id)}`, { method: "DELETE" });
    showBanner("Associazione eliminata.", "info");
    await loadPubblieMappings();
    await loadTimelineFeed();
  } catch (err) {
    alert(`Errore eliminazione: ${err.message}`);
  }
}

async function handleSavePubblieMapping() {
  const projSelect = dom.mappingPubblieProjectSelect;
  const chanSelect = dom.mappingPubblieChannelSelect;
  const accSelect = dom.mappingAdAccountSelect;
  const campSelect = dom.mappingCampaignSelect;
  const adsetSelect = dom.mappingAdsetSelect;
  const ruleSelect = dom.mappingRuleSelect;

  const projectId = projSelect?.value;
  const projectName = projSelect?.options[projSelect.selectedIndex]?.text || "";
  const channelId = chanSelect?.value || "";
  const channelName = chanSelect?.options[chanSelect.selectedIndex]?.text || "";
  const channelProvider = chanSelect?.selectedOptions[0]?.dataset?.provider || "";

  const adAccountId = accSelect?.value;
  const adAccountName = accSelect?.options[accSelect.selectedIndex]?.text || "";
  const campaignId = campSelect?.value;
  const campaignName = campSelect?.options[campSelect.selectedIndex]?.text || "";
  const adsetId = adsetSelect?.value;
  const adsetName = adsetSelect?.options[adsetSelect.selectedIndex]?.text || "";
  const ruleId = ruleSelect?.value || "";
  const ruleName = ruleSelect?.options[ruleSelect?.selectedIndex]?.text || "";

  if (!projectId || !adAccountId || !campaignId || !adsetId) {
    alert("Compila tutti i campi obbligatori: Progetto Pubblie, Account Meta, Campagna e Gruppo Inserzioni.");
    return;
  }

  const payload = {
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
    rule_id: ruleId,
    rule_name: ruleName,
    ad_name_pattern: dom.mappingNamingPattern?.value || "ADV - {platform} - {post}",
    ad_status: dom.mappingAdStatusSelect?.value || "PAUSED",
    auto_sponsor_on_publish: dom.mappingAutoIncludeFlowCheckbox ? dom.mappingAutoIncludeFlowCheckbox.checked : true
  };

  try {
    await api("/api/pubblie/mappings", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    showBanner("✓ Associazione salvata! Parametri Meta collegati con successo.", "info");
    await loadPubblieMappings();
    await loadTimelineFeed();
    switchPubblieSubtab("pubblieListSection");
  } catch (err) {
    alert(`Errore salvataggio associazione: ${err.message}`);
  }
}

function setupTimelineListeners() {
  dom.refreshTimelineBtn?.addEventListener("click", () => loadTimelineFeed());
  dom.openPubblieConfigBtn?.addEventListener("click", () => openPubblieConfigModal("key"));
  dom.promptConnectPubblieBtn?.addEventListener("click", () => openPubblieConfigModal("key"));
  dom.timelineEmptyActionBtn?.addEventListener("click", () => openPubblieConfigModal("key"));

  // Filters
  dom.timelineFilterProject?.addEventListener("change", (e) => {
    state.timeline.filters.projectId = e.target.value;
    loadTimelineFeed();
  });

  dom.timelineFilterPlatform?.addEventListener("change", (e) => {
    state.timeline.filters.platform = e.target.value;
    loadTimelineFeed();
  });

  dom.timelineFilterStatus?.addEventListener("change", (e) => {
    state.timeline.filters.status = e.target.value;
    loadTimelineFeed();
  });

  dom.timelineFilterDays?.addEventListener("change", (e) => {
    state.timeline.filters.days = Number(e.target.value) || 30;
    loadTimelineFeed();
  });

  dom.timelineSearchInput?.addEventListener("input", (e) => {
    state.timeline.filters.query = e.target.value;
    renderTimelineStream();
  });

  // Bulk actions
  dom.timelineIncludeAllBtn?.addEventListener("click", () => bulkToggleFlow("INCLUDED"));
  dom.timelineExcludeAllBtn?.addEventListener("click", () => bulkToggleFlow("EXCLUDED"));

  // Horizontal flow rail navigation
  dom.timelineScrollPrevBtn?.addEventListener("click", () => {
    dom.timelineStreamWrapper?.scrollBy({ left: -340, behavior: "smooth" });
  });
  dom.timelineScrollNextBtn?.addEventListener("click", () => {
    dom.timelineStreamWrapper?.scrollBy({ left: 340, behavior: "smooth" });
  });
  dom.timelineScrollTodayBtn?.addEventListener("click", () => {
    const todayEl = dom.timelineStream?.querySelector(".timeline-date-group[data-is-today='true']");
    if (todayEl) {
      todayEl.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    } else {
      dom.timelineStreamWrapper?.scrollTo({ left: 0, behavior: "smooth" });
    }
  });

  // Wheel horizontal scrolling on stream wrapper
  if (dom.timelineStreamWrapper) {
    dom.timelineStreamWrapper.addEventListener("wheel", (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        dom.timelineStreamWrapper.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }
}

function setupPubblieModalListeners() {
  dom.closePubblieConfigBtn?.addEventListener("click", () => dom.pubblieConfigDialog?.close());
  dom.closePubblieConfigBottomBtn?.addEventListener("click", () => dom.pubblieConfigDialog?.close());

  dom.subtabBtnPubblieKey?.addEventListener("click", () => switchPubblieSubtab("pubblieKeySection"));
  dom.subtabBtnPubblieMapping?.addEventListener("click", () => switchPubblieSubtab("pubblieMappingSection"));
  dom.subtabBtnPubblieList?.addEventListener("click", () => switchPubblieSubtab("pubblieListSection"));

  // Toggle API Key visibility
  dom.togglePubblieKeyBtn?.addEventListener("click", () => {
    const isPwd = dom.pubblieApiKeyInput.type === "password";
    dom.pubblieApiKeyInput.type = isPwd ? "text" : "password";
    dom.togglePubblieKeyBtn.textContent = isPwd ? "🙈" : "👁️";
  });

  // Test and Save API Key
  dom.testAndSavePubblieKeyBtn?.addEventListener("click", async () => {
    const key = dom.pubblieApiKeyInput?.value?.trim();
    if (!key) {
      alert("Inserisci la tua API Key di Pubblie");
      return;
    }

    if (dom.pubblieKeySpinner) dom.pubblieKeySpinner.style.display = "inline-block";
    if (dom.testAndSavePubblieKeyText) dom.testAndSavePubblieKeyText.textContent = "Verifica in corso...";

    try {
      const res = await api("/api/pubblie/save-key", {
        method: "POST",
        body: JSON.stringify({ apiKey: key })
      });

      if (dom.pubblieConnectionAlert) {
        dom.pubblieConnectionAlert.className = "auth-alert";
        dom.pubblieConnectionAlert.style.background = "rgba(16, 185, 129, 0.16)";
        dom.pubblieConnectionAlert.style.border = "1px solid rgba(16, 185, 129, 0.35)";
        dom.pubblieConnectionAlert.style.color = "#34d399";
        dom.pubblieConnectionAlert.style.display = "block";
        dom.pubblieConnectionAlert.innerHTML = `✓ Connesso con successo come: <strong>${escapeHtml(res.user?.name || res.user?.email || "Utente Pubblie")}</strong>`;
      }

      showBanner("✓ Chiave API Pubblie verificata e salvata con successo!", "info");
      await checkPubblieStatus();
      await loadPubblieProjects();
      await loadTimelineFeed();
      if (dom.disconnectPubblieBtn) dom.disconnectPubblieBtn.style.display = "inline-block";
    } catch (err) {
      if (dom.pubblieConnectionAlert) {
        dom.pubblieConnectionAlert.className = "auth-alert error";
        dom.pubblieConnectionAlert.style.display = "block";
        dom.pubblieConnectionAlert.innerHTML = `✕ Errore verifica chiave: ${escapeHtml(err.message)}`;
      }
    } finally {
      if (dom.pubblieKeySpinner) dom.pubblieKeySpinner.style.display = "none";
      if (dom.testAndSavePubblieKeyText) dom.testAndSavePubblieKeyText.textContent = "Verifica e Salva Chiave 🚀";
    }
  });

  // Disconnect Pubblie
  dom.disconnectPubblieBtn?.addEventListener("click", async () => {
    if (!confirm("Vuoi scollegare Pubblie.io e cancellare l'API Key salvata?")) return;
    try {
      await api("/api/pubblie/disconnect", { method: "POST" });
      dom.pubblieApiKeyInput.value = "";
      if (dom.pubblieConnectionAlert) dom.pubblieConnectionAlert.style.display = "none";
      dom.disconnectPubblieBtn.style.display = "none";
      showBanner("Pubblie.io scollegato.", "info");
      await checkPubblieStatus();
      await loadTimelineFeed();
    } catch (err) {
      alert(`Errore: ${err.message}`);
    }
  });

  // Project select change
  dom.mappingPubblieProjectSelect?.addEventListener("change", (e) => {
    loadPubblieChannels(e.target.value);
  });

  // Shortcut apply from existing Automation
  dom.pubblieApplyAutoShortcutBtn?.addEventListener("click", async () => {
    const autoId = dom.pubblieCopyFromAutoSelect?.value;
    if (!autoId) {
      alert("Seleziona prima un'automazione dall'elenco a tendina.");
      return;
    }
    const auto = state.automations.find(a => a.id === autoId);
    if (!auto) return;

    if (dom.mappingAdAccountSelect) {
      populatePubblieMetaAccounts(auto.ad_account_id);
      dom.mappingAdAccountSelect.value = auto.ad_account_id;
      await loadPubblieMetaCampaigns(auto.ad_account_id, auto.campaign_id, auto.adset_id, auto.rule_id);
    }
    if (dom.mappingNamingPattern) dom.mappingNamingPattern.value = auto.ad_name_pattern || "ADV - {platform} - {post}";
    if (dom.mappingAdStatusSelect) dom.mappingAdStatusSelect.value = auto.ad_status || "PAUSED";

    showBanner(`Parametri copiati dall'automazione "${auto.name}".`, "info");
  });

  // Ad Account Select in Mapping Modal
  dom.mappingAdAccountSelect?.addEventListener("change", (e) => {
    const accId = e.target.value;
    loadPubblieMetaCampaigns(accId);
  });

  dom.mappingCampaignSelect?.addEventListener("change", (e) => {
    const accId = dom.mappingAdAccountSelect?.value;
    const campId = e.target.value;
    loadPubblieMetaAdsets(accId, campId);
  });

  // Save Mapping
  dom.savePubblieMappingBtn?.addEventListener("click", handleSavePubblieMapping);
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
  setupAccountManagement();
  setupProjectManagement();
  setupAuth();
  setupTimelineListeners();
  setupPubblieModalListeners();

  const authStatus = await checkAuthStatus();
  if (authStatus.authenticated) {
    hideAuthOverlay();
    await loadInitialData();
  } else {
    showAuthOverlay(authStatus.setupRequired);
  }

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("login") === "ok") {
    showBanner("✓ Accesso con Facebook completato! Token Meta attivo per 60 giorni.", "info");
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (urlParams.get("login_error")) {
    showBanner("✕ Errore login: " + decodeURIComponent(urlParams.get("login_error")), "danger");
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

window.addEventListener("DOMContentLoaded", initApp);



