// ========== Language & i18n Configuration ==========
const SUPPORTED_LANGUAGES = ["en", "zh", "ja"];
const DEFAULT_LANGUAGE = "en";
const LANGUAGE_STORAGE_KEY = "nof1_ui_language";
const LANGUAGE_ENDPOINT = "/language";
const LANGUAGE_LABELS = {
  en: "English",
  zh: "中文",
  ja: "日本語",
};

// ========== Contract Multipliers (OKX) ==========
// 1张合约 = 多少个币
// 默认值（作为备用）- 这些值会从 API 自动更新
const DEFAULT_CONTRACT_MULTIPLIERS = {
  'BTC': 0.01,
  'ETH': 0.1,
  'SOL': 1,
  'XRP': 10,
  'BNB': 0.1,
  'BCH': 0.1,
  'ADA': 100,
  'DOGE': 10,
  'LTC': 1,
  'POL': 1,
};

// 从 API 加载的乘数数据（会自动更新）
let CONTRACT_MULTIPLIERS = { ...DEFAULT_CONTRACT_MULTIPLIERS };
let contractMultipliersLastUpdated = null;

const DEFAULT_STRATEGY_LABELS = {
  "ultra-short": "Ultra-Short",
  "swing-trend": "Swing Trend",
  "dca": "DCA",
  conservative: "Conservative",
  balanced: "Balanced",
  aggressive: "Aggressive",
};

const STRATEGY_DEFAULT_PROMPTS = Object.freeze({
  entryLogic: "",
  exitLogic: "",
});

const STRATEGY_DEFAULT_PARAMS = Object.freeze({
  tradingSymbols: "BTC,ETH,SOL",
  intervalMinutes: 20,
  leverage: 10,
  maxPositions: 5,
  maxHoldingHours: 36,
  minHoldingMinutes: 1,
  extremeStopLossPercent: 12.5,
  accountStopLoss: 1000,
  accountTakeProfit: 5000,
  drawdownWarning: 10,
  drawdownNoNew: 15,
  drawdownForceClose: 25,
});

const STRATEGY_PARAM_FIELD_IDS = [
  "st-symbols",
  "st-interval",
  "st-leverage",
  "st-max-positions",
  "st-max-holding",
  "st-min-holding",
  "st-extreme-stop",
  "st-stop-loss",
  "st-take-profit",
  "st-dd-warning",
  "st-dd-pause",
  "st-dd-close",
];

const STRATEGY_EDITOR_STORAGE_KEY = "strategyEditorDraft";

const REFRESH_INTERVAL = 15000; // ms between dashboard refreshes
const DEFAULT_INTERVAL = "1m";
const DEFAULT_SYMBOL = "BTC";
const CANDLE_LIMIT = 500;
const DEFAULT_AI_ICON = "/static/icons/openai.png";
const ACCOUNT_CONFIG_KEYS = [
  "EXCHANGE_PROVIDER",
  "OKX_API_KEY",
  "OKX_API_SECRET",
  "OKX_API_PASSPHRASE",
  "OKX_USE_PAPER",
  "BINANCE_API_KEY",
  "BINANCE_API_SECRET",
  "BINANCE_USE_TESTNET",
  "INITIAL_BALANCE",
  "ACCOUNT_STOP_LOSS_USDT",
  "ACCOUNT_TAKE_PROFIT_USDT",
];


const SETTINGS_CONFIG_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "AI_MODEL_NAME",
  "HTTP_PROXY_URL",
  "COMMUNITY_REPORT_ENABLED",
  "COMMUNITY_SHARE_PROMPTS",
];

let STRATEGY_LABELS = { ...DEFAULT_STRATEGY_LABELS };

const CLIENT_NUMERIC_KEYS = new Set([
  "TRADING_INTERVAL_MINUTES",
  "MAX_LEVERAGE",
  "MAX_POSITIONS",
  "MAX_HOLDING_HOURS",
  "MIN_HOLDING_MINUTES",
  "EXTREME_STOP_LOSS_PERCENT",
  "INITIAL_BALANCE",
  "ACCOUNT_STOP_LOSS_USDT",
  "ACCOUNT_TAKE_PROFIT_USDT",
  "ACCOUNT_DRAWDOWN_WARNING_PERCENT",
  "ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT",
  "ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT",
]);

const MODEL_ICON_MATCHERS = [
  { pattern: /deepseek/i, icon: "/static/icons/deepseek-color.png" },
  { pattern: /claude|anthropic/i, icon: "/static/icons/claude-color.png" },
  { pattern: /chatglm|glm/i, icon: "/static/icons/chatglm-color.png" },
  { pattern: /qwen/i, icon: "/static/icons/qwen-color.png" },
  { pattern: /gemini|palm/i, icon: "/static/icons/gemini-color.png" },
  { pattern: /grok/i, icon: "/static/icons/grok-color.png" },
  { pattern: /kling/i, icon: "/static/icons/kling-color.png" },
  { pattern: /doubao/i, icon: "/static/icons/doubao-color.png" },
  { pattern: /minimax/i, icon: "/static/icons/minimax-color.png" },
  { pattern: /mistral/i, icon: "/static/icons/mistral-color.png" },
  { pattern: /gpt|openai|openrouter/i, icon: "/static/icons/openai.png" },
];

let defaultLanguagePack = {};
let activeLanguagePack = {};
let activeLanguage = DEFAULT_LANGUAGE;
let languageLoadPromise = null;

function normalizeLanguageCode(lang) {
  if (typeof lang !== "string") {
    return DEFAULT_LANGUAGE;
  }
  const trimmed = lang.trim().toLowerCase();
  if (SUPPORTED_LANGUAGES.includes(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("zh")) {
    return "zh";
  }
  if (trimmed.startsWith("ja")) {
    return "ja";
  }
  return DEFAULT_LANGUAGE;
}

function getCurrentLanguage() {
  try {
    const stored = window.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    if (stored) {
      return normalizeLanguageCode(stored);
    }
  } catch (error) {
    console.warn("[i18n] 读取本地语言偏好失败", error);
  }
  return DEFAULT_LANGUAGE;
}

function setLanguage(lang) {
  const normalized = normalizeLanguageCode(lang);
  try {
    window.localStorage?.setItem(LANGUAGE_STORAGE_KEY, normalized);
  } catch (error) {
    console.warn("[i18n] 写入语言偏好失败", error);
  }
  activeLanguage = normalized;
  return normalized;
}

function resolveLanguageValue(pack, key) {
  if (!pack || typeof pack !== "object" || !key) {
    return undefined;
  }
  return key.split(".").reduce((acc, segment) => {
    if (acc && Object.prototype.hasOwnProperty.call(acc, segment)) {
      return acc[segment];
    }
    return undefined;
  }, pack);
}

function formatLanguageValue(value, replacements) {
  if (typeof value !== "string" || !replacements) {
    return value;
  }
  return value.replace(/\{\{(\w+)\}\}/g, (match, token) => {
    if (Object.prototype.hasOwnProperty.call(replacements, token)) {
      return String(replacements[token]);
    }
    return match;
  });
}

function t(key, replacements) {
  if (!key) {
    return "";
  }
  let value = resolveLanguageValue(activeLanguagePack, key);
  if (value === undefined) {
    value = resolveLanguageValue(defaultLanguagePack, key);
  }
  if (value === undefined) {
    return typeof key === "string" ? key : "";
  }
  if (typeof value === "string") {
    return formatLanguageValue(value, replacements);
  }
  return value;
}

async function fetchLanguagePack(lang) {
  const normalized = normalizeLanguageCode(lang);
  const response = await fetch(`${LANGUAGE_ENDPOINT}/${normalized}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`Failed to load language pack ${normalized}: HTTP ${response.status}`);
  }
  return response.json();
}

async function ensureLanguageResources(force = false) {
  const storedLang = normalizeLanguageCode(getCurrentLanguage());
  if (!force && !languageLoadPromise) {
    const hasDefault = Object.keys(defaultLanguagePack).length > 0;
    const hasActive = Object.keys(activeLanguagePack).length > 0;
    if (hasDefault && hasActive && activeLanguage === storedLang) {
      return;
    }
  }

  if (!languageLoadPromise) {
    languageLoadPromise = (async () => {
      const targetLang = storedLang;

      if (force || !Object.keys(defaultLanguagePack).length) {
        try {
          defaultLanguagePack = await fetchLanguagePack(DEFAULT_LANGUAGE);
        } catch (error) {
          console.error("[i18n] 载入默认语言包失败", error);
          defaultLanguagePack = {};
        }
      }

      if (targetLang === DEFAULT_LANGUAGE) {
        activeLanguagePack = defaultLanguagePack;
        activeLanguage = DEFAULT_LANGUAGE;
        return;
      }

      try {
        activeLanguagePack = await fetchLanguagePack(targetLang);
        activeLanguage = targetLang;
      } catch (error) {
        console.warn(`[i18n] 载入语言 "${targetLang}" 失败，回退到默认`, error);
        activeLanguagePack = defaultLanguagePack;
        activeLanguage = DEFAULT_LANGUAGE;
        setLanguage(DEFAULT_LANGUAGE);
      }
    })().finally(() => {
      languageLoadPromise = null;
    });
  }

  return languageLoadPromise;
}

function applyI18nToDOM(root = document) {
  const scope = root || document;
  const langCode = activeLanguage || getCurrentLanguage();
  const htmlLang = langCode === "zh" ? "zh-CN" : langCode === "ja" ? "ja-JP" : langCode;
  if (document?.documentElement) {
    document.documentElement.lang = htmlLang;
  }

  scope.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    if (!key) return;
    const translation = t(key);
    if (typeof translation === "string") {
      element.textContent = translation;
    }
  });

  scope.querySelectorAll("[data-i18n-html]").forEach((element) => {
    const key = element.getAttribute("data-i18n-html");
    if (!key) return;
    const translation = t(key);
    if (typeof translation === "string") {
      element.innerHTML = translation;
    }
  });

  const attrMappings = [
    ["data-i18n-placeholder", "placeholder"],
    ["data-i18n-title", "title"],
    ["data-i18n-aria", "aria-label"],
    ["data-i18n-aria-label", "aria-label"],
    ["data-i18n-aria-description", "aria-description"],
    ["data-i18n-value", "value"],
  ];

  attrMappings.forEach(([dataAttr, targetAttr]) => {
    scope.querySelectorAll(`[${dataAttr}]`).forEach((element) => {
      const key = element.getAttribute(dataAttr);
      if (!key) return;
      const translation = t(key);
      if (typeof translation === "string") {
        element.setAttribute(targetAttr, translation);
      }
    });
  });

  updateStrategyLabels();
  updateLanguageSelectorUI();
}

function updateStrategyLabels() {
  const fallbackLabels =
    defaultLanguagePack?.strategy?.labelMap ||
    defaultLanguagePack?.strategyLabels ||
    DEFAULT_STRATEGY_LABELS;

  const activeLabels =
    activeLanguagePack?.strategy?.labelMap ||
    activeLanguagePack?.strategyLabels ||
    fallbackLabels;

  if (activeLabels && typeof activeLabels === "object") {
    STRATEGY_LABELS = {
      ...DEFAULT_STRATEGY_LABELS,
      ...(fallbackLabels || {}),
      ...activeLabels,
    };
  } else {
    STRATEGY_LABELS = { ...DEFAULT_STRATEGY_LABELS };
  }
}

function updateLanguageSelectorUI() {
  const selector = document.getElementById("language-selector");
  const toggle = document.getElementById("language-toggle");
  const label = toggle?.querySelector(".language-label");
  const currentLang = activeLanguage || getCurrentLanguage();
  const labelText = LANGUAGE_LABELS[currentLang] || currentLang.toUpperCase();

  if (label) {
    label.textContent = labelText;
  }

  const menu = document.getElementById("language-menu");
  if (menu) {
    menu.querySelectorAll(".language-option").forEach((option) => {
      const optionLang = option.getAttribute("data-lang");
      const isActive = optionLang === currentLang;
      option.classList.toggle("is-active", isActive);
      option.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  if (selector) {
    selector.setAttribute("data-current-lang", currentLang);
  }
}

async function syncLanguagePreferenceFromBackend() {
  // 如果本地已有语言偏好，优先使用本地设置
  const localLang = getCurrentLanguage();
  if (localLang && localLang !== DEFAULT_LANGUAGE) {
    // 本地已有非默认语言设置，不从后端同步
    return false;
  }

  try {
    const response = await fetch("/api/user/language", {
      cache: "no-store",
      credentials: "same-origin",
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    const backendLang = normalizeLanguageCode(data?.language);
    // 只有当后端有明确的非默认语言设置，且本地是默认语言时才同步
    if (backendLang && backendLang !== DEFAULT_LANGUAGE && backendLang !== localLang) {
      setLanguage(backendLang);
      return true;
    }
  } catch (error) {
    console.warn("[i18n] 同步后端语言偏好失败", error);
  }
  return false;
}

function createDefaultStrategyContent(rawName = "") {
  const normalizedName = typeof rawName === "string" && rawName.trim() ? rawName.trim() : "strategy";
  return {
    meta: {
      name: normalizedName,
      version: "1.0",
      updatedAt: new Date().toISOString(),
      description: "",
    },
    prompts: { ...STRATEGY_DEFAULT_PROMPTS },
    params: { ...STRATEGY_DEFAULT_PARAMS },
  };
}

class TradingMonitor {
  constructor() {
    this.activeSymbol = DEFAULT_SYMBOL;
    this.activeInterval = DEFAULT_INTERVAL;
    this.prices = new Map();
    this.priceDeltas = new Map();
    this.priceChanges = new Map();
    this.availableSymbols = new Set();
    this.symbolOrder = [];
    this.chart = null;
    this.candleSeries = null;
    this.pendingCandleSymbol = this.activeSymbol;
    this.equityChart = null;
    this.resizeHandler = null;
    this.dataTimer = null;
    this.priceTimer = null;
    this.loadingOverlay = document.getElementById("global-loading");

    // WebSocket 连接
    this.ws = null;
    this.wsReconnectTimer = null;
    this.wsReconnectAttempts = 0;
    this.pendingWebSocketMessages = [];
    this.priceSubscriptionDebounceTimer = null;
    this.activeCandleSubscription = { symbol: null, interval: null };
    this.latestCandleSnapshots = new Map();

    // DOM 元素
    this.symbolListEl = document.getElementById("symbol-list");
    this.pricesUpdatedEl = document.getElementById("prices-updated");
    this.chartTitleEl = document.getElementById("chart-title");
    this.chartIntervalEl = document.getElementById("chart-interval");
    this.klineChartEl = document.getElementById("kline-chart");
    this.strategyEditorEl = document.getElementById("strategy-editor-view");
    this.tradingDashboardEl = document.querySelector(".main-content");
    this.bottomTabsEl = document.querySelector(".bottom-tabs");
    this.strategyActiveLabelEl = document.getElementById("active-strategy-label");
    this.currentStrategyName = "";
    this.activeStrategyName = "";
    this.decisionListEl = document.getElementById("decision-list");
    this.decisionUpdatedEl = document.getElementById("decision-updated");
    this.positionsContainerEl = document.getElementById("positions-container");
    this.positionsUpdatedEl = document.getElementById("positions-updated");
    this.openOrdersContainerEl = document.getElementById("open-orders-container");
    this.pendingPositionClosures = new Set();
    this.emptyPositionsTimeout = null;
    this.lastPositionsData = null;
    this.lastPositionsTimestamp = 0;
    
    // 手动交易设置缓存（按币种）
    this.manualTradeSettings = new Map();
    this.restoreManualTradeSettings();
    this.availableBalance = 0;
    this.manualTradeControlsInitialized = false;
    this.manualSymbolSelectorBound = false;
    this.marginModeSelectorBound = false;
    this.orderTypeToggleBound = false;
    this.amountUnitToggleBound = false;
    this.actionToggleBound = false;
    this.manualTradeButtonsBound = false;
    this.leverageInputBound = false;
    
    this.activeCloseConfirmationSymbol = null;
    this.handleCloseConfirmationOutsideClick = (event) => this.onDocumentClickForCloseConfirmation(event);
    this.handleCloseConfirmationKeydown = (event) => {
      if (event?.key === "Escape") {
        this.hideCloseConfirmation();
      }
    };
    this.handleCloseConfirmationResize = () => this.repositionActiveCloseConfirmation();
    if (this.positionsContainerEl) {
      this.positionsContainerEl.addEventListener("click", (event) => this.handlePositionsContainerClick(event));
    }
    this.tradesContainerEl = document.getElementById("trades-container");
    this.logsContainerEl = document.getElementById("logs-container");
    this.decisionLogsContainerEl = document.getElementById("decision-logs-container");
    this.decisionModal = document.getElementById("decision-modal");
    this.decisionDetailEl = document.getElementById("decision-detail");
    this.logModal = document.getElementById("log-modal");
    this.logDetailEl = document.getElementById("log-detail");
    this.strategyBottomTabsEl = document.getElementById("strategy-bottom-tabs");
    this.allTasksContainerEl = document.getElementById("all-tasks-container");
    this.allTasksListEl = document.getElementById("all-tasks-list");
    this.allTasksEmptyEl = document.getElementById("all-tasks-empty");
    this.runningTasksContainerEl = document.getElementById("running-tasks-container");
    this.runningTasksListEl = document.getElementById("running-tasks-list");
    this.runningTasksEmptyEl = document.getElementById("running-tasks-empty");
    this.bindInstanceTableActions(this.allTasksListEl);
    this.bindInstanceTableActions(this.runningTasksListEl);
    this.initStrategyBottomTabs();
    this.recordsModal = document.getElementById("records-modal");
    this.recordsTableContainer = document.getElementById("records-table-container");
    this.recordsTitleEl = document.getElementById("records-modal-title");
    this.recordsPaginationEl = document.getElementById("records-pagination");
    this.recordsPageInfoEl = document.getElementById("records-page-info");
    this.recordsPrevBtn = this.recordsPaginationEl
      ? this.recordsPaginationEl.querySelector('[data-direction="prev"]')
      : null;
    this.recordsNextBtn = this.recordsPaginationEl
      ? this.recordsPaginationEl.querySelector('[data-direction="next"]')
      : null;
    this.recordsState = {
      type: null,
      page: 1,
      pageSize: 20,
      total: 0,
    };
    this.recordsCurrentItems = [];
    this.recordsModalStack = 0;
    this.tradesViewAllLink = null;
    this.logsViewAllLink = null;
    this.decisionsViewAllLink = null;
    this.decisionRequestsViewAllLink = null;
    // this.accountBtn = document.getElementById("account-btn"); // Removed
    this.settingsBtn = document.getElementById("settings-btn");
    this.logoutBtn = document.getElementById("logout-btn");
  this.tradingLoopToggle = document.getElementById("trading-loop-toggle");
    this.accountSwitcherEl = document.getElementById("account-switcher");
    this.accountSwitcherTrigger = document.getElementById("account-switcher-trigger");
    this.accountSwitcherLabel = document.getElementById("account-switcher-label");
    this.accountSwitcherDropdown = document.getElementById("account-switcher-dropdown");
    this.accountSwitcherList = document.getElementById("account-switcher-list");
    this.accountSwitcherEmpty = document.getElementById("account-switcher-empty");
    this.accountSwitcherCloseTimer = null;
    this.aiOverlay = null;
    this.aiOverlayText = null;
    this.aiOverlayIcon = null;
    this.toastContainer = document.getElementById("toast-container");
    // this.accountModal = document.getElementById("account-modal"); // Removed
    // this.accountsListModal = document.getElementById("accounts-list-modal"); // Removed
    this.accountFormModal = document.getElementById("account-form-modal");
    this.instanceFormModal = document.getElementById("instance-form-modal");
    this.settingsModal = document.getElementById("settings-modal");
    this.statisticsModal = document.getElementById("statistics-modal");
    this.decisionRequestModal = document.getElementById("decision-request-modal");
    this.decisionRequestDetailEl = document.getElementById("decision-request-detail");
    this.accountForm = document.getElementById("account-form");
    this.accountEditForm = document.getElementById("account-edit-form");
    this.instanceEditForm = document.getElementById("instance-edit-form");
    this.settingsForm = document.getElementById("settings-form");
    this.accountCancelBtn = document.getElementById("account-cancel");
    this.instanceCancelBtn = document.getElementById("instance-cancel");
    this.settingsCancelBtn = document.getElementById("settings-cancel");
    this.exchangeSelect = document.getElementById("exchange-provider");
    this.exchangePanels = document.querySelectorAll("[data-exchange-panel]");
    this.testOkxBtn = document.getElementById("test-okx-api");
    this.testBinanceBtn = document.getElementById("test-binance-api");
    this.testAiBtn = document.getElementById("test-ai-api");
    this.resetLiveDataBtn = document.getElementById("reset-live-data-btn");
  this.resetLiveDataConfirmContainer = document.getElementById("reset-live-data-confirm");
  this.resetLiveDataInput = document.getElementById("reset-live-data-input");
  this.resetLiveDataCancelBtn = document.getElementById("reset-live-data-cancel");
  this.resetLiveDataConfirmBtn = document.getElementById("reset-live-data-confirm-btn");
    this.communityReportCheckbox = document.querySelector('input[name="COMMUNITY_REPORT_ENABLED"]');
    this.communityShareCheckbox = document.querySelector('input[name="COMMUNITY_SHARE_PROMPTS"]');
    this.statsDetailBtn = document.getElementById("stats-detail-btn");
    this.statsPnlChart = null;
    this.latestConfig = null;
  this.tradingLoopState = null;
    this.tradingLoopConfirmTimer = null;
    this.tradingLoopDisableConfirm = false;
  this.accountsCache = [];
  this.aiModelsCache = [];
  this.instancesCache = [];
  this.instancesCacheLoaded = false;
  this.strategyFilesCache = [];
  this.runningTasksRefreshTimer = null;

    this.strategyPromptCache = new Map();
    this.strategyDeleteActivePopover = null;
    this.strategyDeleteOutsideHandler = null;
    this.variableGuideModal = null;
    this.variableGuideTrigger = null;
    this.variableGuideEscHandler = null;
    this.strategyDraftSaveTimer = null;
    this.isStrategyDraftSyncSuspended = false;

    this.isAuthenticated = false;

    this.setupAuthControls();
    void this.syncAuthState();

    this.setupTabSwitching();
    this.setupModals();
    this.setupSidebarTabs();
    this.connectWebSocket();
    this.initViewAllControls();
    this.setupRecordsControls();
    this.setupIntervalSelector();
    this.renderSymbolList();
    this.initManualTradeControls();

    this.bindSettingsForms();
    this.bindExchangeControls();
    this.setupPrivacyControls();
    this.setupStrategyEditorQuickInsert();
    this.initAccountSwitcher();
    this.initStrategyDraftPersistence();
    this.setupVariableGuideModal();
    this.initAiModelOverlay();
    this.bindViewSwitcher(); // 绑定视图切换
    void this.fetchPublicModelInfo();

    if (this.strategyBottomTabsEl) {
      this.strategyBottomTabsEl.style.display = "none";
    }
    
    // 立即初始化图表，确保在数据加载前就准备好
    this.initChart();
    this.initEquityChart();
    
    this.refreshAll()
      .catch((error) => {
        console.error("[init] 初始加载失败", error);
      })
      .finally(() => {
        this.startAutoRefresh();
        this.hideLoadingOverlay();
      });
  }

  async refreshAll() {
    await Promise.all([
      this.loadAccountSummary(),
      this.loadPositions(),
      this.loadOpenOrders(),
      this.loadTrades(),
      this.loadTradeLogs(),
      this.loadDecisions(),
      this.loadDecisionRequests(),
    ]);

    await this.refreshRunningTasksPanel();

    await Promise.all([this.loadPrices(), this.loadCandles(this.activeSymbol)]);
  }

  startAutoRefresh() {
    if (this.dataTimer) clearInterval(this.dataTimer);
    if (this.priceTimer) clearInterval(this.priceTimer);

    this.dataTimer = setInterval(() => {
      void this.loadAccountSummary();
      void this.loadPositions();
      void this.loadOpenOrders();
      void this.loadTrades();
      void this.loadTradeLogs();
      void this.loadDecisions();
      void this.loadDecisionRequests();
      
      // 未登录用户也需要定期刷新交易循环状态
      if (!this.isAuthenticated) {
        void this.fetchPublicTradingLoopStatus();
      }
    }, REFRESH_INTERVAL);

    if (this.priceTimer) {
      clearInterval(this.priceTimer);
      this.priceTimer = null;
    }
  }

  setupTabSwitching() {
    const nav = document.getElementById("tab-nav");
    if (!nav) return;

    nav.addEventListener("click", (event) => {
      const button = event.target.closest(".tab-btn");
      if (!button) return;

      const { tab } = button.dataset;
      if (!tab) return;

      nav.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");

      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === `tab-${tab}`);
      });
    });
  }

  setupModals() {
    [
      this.decisionModal,
      this.logModal,
      this.decisionRequestModal,
      // this.accountModal, // Removed
      // this.accountsListModal, // Removed
      this.accountFormModal,
      this.instanceFormModal,
      this.settingsModal,
      this.statisticsModal,
      this.recordsModal,
    ].forEach((modal) => {
      if (!modal) return;

      const overlay = modal.querySelector(".modal-overlay");
      const closeBtn = modal.querySelector(".modal-close");

      overlay?.addEventListener("click", () => this.hideModal(modal));
      closeBtn?.addEventListener("click", () => this.hideModal(modal));
    });

    // 统计详情按钮
    if (this.statsDetailBtn) {
      this.statsDetailBtn.addEventListener("click", (e) => {
        e.preventDefault();
        void this.showStatisticsModal();
      });
    }
  }

  setupSidebarTabs() {
    const tabButtons = document.querySelectorAll(".info-sidebar .main-tabs .tab-btn");
    const sidebarViews = document.querySelectorAll(".info-sidebar .sidebar-view");

    if (!tabButtons.length || !sidebarViews.length) {
      return;
    }

    tabButtons.forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        const targetView = btn.getAttribute("data-tab");
        if (!targetView) return;

        // 切换按钮激活状态
        tabButtons.forEach((tab) => tab.classList.toggle("active", tab === btn));

        // 切换视图显示
        sidebarViews.forEach((view) => {
          view.classList.toggle("active", view.id === targetView);
        });

        // 如果切换到手动交易，初始化控件
        if (targetView === "view-manual") {
          this.initManualTradeControls();
        }

        console.log(`[Sidebar] 切换到: ${targetView}`);
      });
    });
  }

  initManualTradeControls() {
    this.setupSymbolSelector();

    if (this.manualTradeControlsInitialized) {
      return;
    }

    this.setupMarginModeSelector();
    this.setupOrderTypeToggle();
    this.setupAmountUnitToggle();
    this.setupActionToggle();
    this.setupTradeButtons();

    const leverageInput = document.getElementById("manual-leverage");
    if (leverageInput && !this.leverageInputBound) {
      this.leverageInputBound = true;
      leverageInput.addEventListener("change", () => {
        const symbolSelect = document.getElementById("manual-symbol");
        if (symbolSelect && symbolSelect.value) {
          this.saveManualTradeSettings(symbolSelect.value);
        }
      });
    }

    this.manualTradeControlsInitialized = true;
  }

  setupSymbolSelector() {
    const trigger = document.getElementById("manual-symbol-trigger");
    const menu = document.getElementById("manual-symbol-menu");
    const select = document.getElementById("manual-symbol");
    
    if (!trigger || !menu || !select) return;

    const populateOptions = () => {
      menu.innerHTML = "";
      select.innerHTML = "";
      const symbols = Array.from(this.availableSymbols || []);
      symbols.forEach((symbol) => {
        const option = document.createElement("div");
        option.className = "manual-select-option";
        option.textContent = symbol;
        option.setAttribute("role", "option");
        option.setAttribute("data-value", symbol);

        option.addEventListener("click", () => {
          if (this.activeSymbol) {
            this.saveManualTradeSettings(this.activeSymbol);
          }
          menu.classList.remove("is-open");
          trigger.setAttribute("aria-expanded", "false");
          this.switchToSymbol(symbol);
        });

        menu.appendChild(option);

        const nativeOption = document.createElement("option");
        nativeOption.value = symbol;
        nativeOption.textContent = symbol;
        select.appendChild(nativeOption);
      });

      if (symbols.length > 0) {
        const initialSymbol = symbols.includes(this.activeSymbol) ? this.activeSymbol : symbols[0];
        const label = trigger.querySelector(".manual-select-label");
        if (label) label.textContent = initialSymbol;
        select.value = initialSymbol;
        this.loadManualTradeSettings(initialSymbol);
      }
    };

    populateOptions();

    if (this.manualSymbolSelectorBound) {
      return;
    }
    this.manualSymbolSelectorBound = true;

    select.addEventListener("change", () => {
      const selectedSymbol = select.value;
      if (!selectedSymbol) {
        return;
      }
      if (this.activeSymbol) {
        this.saveManualTradeSettings(this.activeSymbol);
      }
      this.switchToSymbol(selectedSymbol);
    });

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isExpanded = menu.classList.toggle("is-open");
      trigger.setAttribute("aria-expanded", String(isExpanded));
    });

    document.addEventListener("click", (e) => {
      if (!trigger.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  setupMarginModeSelector() {
    const trigger = document.getElementById("manual-margin-trigger");
    const menu = document.getElementById("manual-margin-menu");
    const select = document.getElementById("manual-margin-mode");
    
    if (!trigger || !menu || !select) return;

    const populateOptions = () => {
      menu.innerHTML = "";
      select.innerHTML = "";
      const modes = [
        { value: "cross", label: t("trade.cross") },
        { value: "isolated", label: t("trade.isolated") }
      ];

      modes.forEach((mode) => {
        const option = document.createElement("div");
        option.className = "manual-select-option";
        option.textContent = mode.label;
        option.setAttribute("role", "option");
        option.setAttribute("data-value", mode.value);

        option.addEventListener("click", () => {
          const label = trigger.querySelector(".manual-select-label");
          if (label) label.textContent = mode.label;
          select.value = mode.value;
          menu.classList.remove("is-open");
          trigger.setAttribute("aria-expanded", "false");

          const symbolSelect = document.getElementById("manual-symbol");
          if (symbolSelect && symbolSelect.value) {
            this.saveManualTradeSettings(symbolSelect.value);
          }
        });

        menu.appendChild(option);

        const nativeOption = document.createElement("option");
        nativeOption.value = mode.value;
        nativeOption.textContent = mode.label;
        select.appendChild(nativeOption);
      });

      const defaultLabel = trigger.querySelector(".manual-select-label");
      if (defaultLabel) defaultLabel.textContent = t("trade.cross");
      select.value = "cross";
    };

    populateOptions();

    if (this.marginModeSelectorBound) {
      return;
    }
    this.marginModeSelectorBound = true;

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isExpanded = menu.classList.toggle("is-open");
      trigger.setAttribute("aria-expanded", String(isExpanded));
    });

    document.addEventListener("click", (e) => {
      if (!trigger.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  setupOrderTypeToggle() {
    if (this.orderTypeToggleBound) return;
    const buttons = document.querySelectorAll("[data-order-type]");
    const priceInput = document.getElementById("manual-price");
    
    if (!buttons.length || !priceInput) return;

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const orderType = btn.getAttribute("data-order-type");
        
        // 更新按钮状态
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        
        // 根据订单类型启用/禁用价格输入
        if (orderType === "market") {
          priceInput.disabled = true;
          priceInput.placeholder = t("trade.market") + " " + t("trade.price");
          priceInput.value = "";
        } else {
          priceInput.disabled = false;
          priceInput.placeholder = t("trade.pricePlaceholder");
          
          // 自动填充当前币种的最新价格
          const symbolSelect = document.getElementById("manual-symbol");
          if (symbolSelect && symbolSelect.value) {
            this.updateLimitOrderPrice(symbolSelect.value);
          }
        }
        
        // 保存设置
        const symbolSelect = document.getElementById("manual-symbol");
        if (symbolSelect && symbolSelect.value) {
          this.saveManualTradeSettings(symbolSelect.value);
        }
      });
    });

    this.orderTypeToggleBound = true;
  }

  updateLimitOrderPrice(symbol) {
    // 检查是否为限价单模式
    const activeOrderType = document.querySelector("[data-order-type].active");
    if (!activeOrderType || activeOrderType.getAttribute("data-order-type") !== "limit") {
      return;
    }

    const priceInput = document.getElementById("manual-price");
    if (!priceInput || priceInput.disabled) {
      return;
    }

    // 从价格缓存中获取最新价格
    const price = this.prices.get(symbol);
    if (price && Number.isFinite(price)) {
      priceInput.value = price.toFixed(4);
      console.log(`[Manual Trade] 已自动填充 ${symbol} 价格: ${price.toFixed(4)}`);
    } else {
      console.warn(`[Manual Trade] 无法获取 ${symbol} 的价格`);
    }
  }

  setupAmountUnitToggle() {
    if (this.amountUnitToggleBound) return;
    const buttons = document.querySelectorAll("[data-amount-unit]");
    const amountInput = document.getElementById("manual-amount");
    
    if (!buttons.length || !amountInput) return;

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const unit = btn.getAttribute("data-amount-unit");
        
        // 更新按钮状态
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        
        // 更新输入框占位符
        if (unit === "usdt") {
          amountInput.placeholder = "100";
        } else {
          amountInput.placeholder = "0.01";
        }
      });
    });

    this.amountUnitToggleBound = true;
  }

  setupActionToggle() {
    if (this.actionToggleBound) return;
    const radios = document.querySelectorAll('input[name="manual-action"]');
    const openActions = document.getElementById("manual-open-actions");
    const closeActions = document.getElementById("manual-close-actions");
    
    if (!radios.length || !openActions || !closeActions) return;

    radios.forEach((radio) => {
      radio.addEventListener("change", () => {
        const action = radio.value;
        
        if (action === "open") {
          openActions.classList.remove("hidden");
          closeActions.classList.add("hidden");
        } else {
          openActions.classList.add("hidden");
          closeActions.classList.remove("hidden");
        }
      });
    });

    this.actionToggleBound = true;
  }

  setupTradeButtons() {
    if (this.manualTradeButtonsBound) return;
    const buttons = document.querySelectorAll("[data-manual-action-btn]");
    
    if (!buttons.length) return;

    buttons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-action");
        const direction = btn.getAttribute("data-direction");
        
        await this.executeManualTrade(action, direction, btn);
      });
    });

    this.manualTradeButtonsBound = true;
  }

  async executeManualTrade(action, direction, clickedButton) {
    if (!this.isAuthenticated) {
      this.showToast("warning", "未登录", "请先登录后台才能进行手动交易");
      return;
    }

    const symbolSelect = document.getElementById("manual-symbol");
    const marginSelect = document.getElementById("manual-margin-mode");
    const leverageInput = document.getElementById("manual-leverage");
    const amountInput = document.getElementById("manual-amount");
    const priceInput = document.getElementById("manual-price");
    const orderTypeButtons = document.querySelectorAll("[data-order-type].active");
    const amountUnitButtons = document.querySelectorAll("[data-amount-unit].active");

    if (!symbolSelect || !marginSelect || !leverageInput || !amountInput) return;

    const symbol = symbolSelect.value;
    const marginMode = marginSelect.value;
    const leverage = Number(leverageInput.value);
    const amount = Number(amountInput.value);
    const orderType = orderTypeButtons[0]?.getAttribute("data-order-type") || "market";
    const amountUnit = amountUnitButtons[0]?.getAttribute("data-amount-unit") || "usdt";
    const price = orderType === "limit" ? Number(priceInput.value) : undefined;

    // 验证输入（在禁用按钮之前）
    if (!symbol) {
      this.showToast("warning", "参数错误", "请选择交易对");
      return;
    }
    if (!amount || amount <= 0) {
      this.showToast("warning", "参数错误", "请输入有效金额");
      return;
    }
    if (orderType === "limit" && (!price || price <= 0)) {
      this.showToast("warning", "参数错误", "限价单需要输入有效价格");
      return;
    }

    // 所有验证通过后，才禁用按钮并设置加载状态
    const allTradeButtons = document.querySelectorAll("[data-manual-action-btn]");
    
    allTradeButtons.forEach((btn) => {
      btn.disabled = true;
      if (btn === clickedButton) {
        btn.classList.add("loading");
      }
    });

    try {
      const csrfToken = window.csrfManager ? window.csrfManager.getToken() : "";
      const response = await fetch("/api/trading/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "same-origin",
        body: JSON.stringify({
          action,
          direction,
          symbol,
          marginMode,
          leverage,
          amount,
          amountUnit,
          orderType,
          price,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      
      this.showToast("success", "交易成功", result.message || "订单已提交");
      
      // 刷新数据
      setTimeout(() => {
        void this.loadPositions();
        void this.loadOpenOrders();
        void this.loadTrades();
      }, 1000);

    } catch (error) {
      console.error("[manual-trade] 手动交易失败:", error);
      this.showToast("error", "交易失败", error.message || "提交订单失败");
    } finally {
      // 恢复所有按钮状态
      allTradeButtons.forEach((btn) => {
        btn.disabled = false;
        if (btn === clickedButton) {
          btn.classList.remove("loading");
        }
      });
    }
  }

  pushRecordsModalBehind() {
    if (!this.recordsModal || !this.recordsModal.classList.contains("show")) {
      return false;
    }
    if (!this.recordsModalStack) {
      this.recordsModalStack = 0;
    }
    this.recordsModalStack += 1;
    this.recordsModal.classList.add("modal-stacked-behind");
    return true;
  }

  popRecordsModalBehind() {
    if (!this.recordsModal || !this.recordsModalStack) {
      return;
    }
    this.recordsModalStack = Math.max(0, this.recordsModalStack - 1);
    if (this.recordsModalStack === 0) {
      this.recordsModal.classList.remove("modal-stacked-behind");
    }
  }

  initStrategyDraftPersistence() {
    if (!this.strategyEditorEl || !window?.localStorage) {
      return;
    }

    const selectors = [
      "#strategy-filename",
      "#strategy-description",
      "#strategy-entry",
      "#strategy-exit",
      ...STRATEGY_PARAM_FIELD_IDS.map((id) => `#${id}`),
    ];

    const handleChange = () => {
      if (this.isStrategyDraftSyncSuspended) {
        return;
      }
      this.scheduleStrategyDraftSave();
    };

    selectors.forEach((selector) => {
      const element = document.querySelector(selector);
      if (!element || element.dataset.strategyDraftBound === "true") {
        return;
      }
      element.dataset.strategyDraftBound = "true";
      const eventName = element.tagName === "SELECT" ? "change" : "input";
      element.addEventListener(eventName, handleChange);
    });

    this.restoreStrategyDraft();
  }

  scheduleStrategyDraftSave() {
    if (!window?.localStorage) {
      return;
    }

    if (this.strategyDraftSaveTimer) {
      clearTimeout(this.strategyDraftSaveTimer);
    }

    this.strategyDraftSaveTimer = window.setTimeout(() => {
      this.strategyDraftSaveTimer = null;
      this.saveStrategyDraft();
    }, 400);
  }

  collectStrategyEditorState() {
    if (!this.strategyEditorEl) {
      return null;
    }

    const filename = document.getElementById("strategy-filename")?.value ?? "";
    const description = document.getElementById("strategy-description")?.value ?? "";
    const entryLogic = document.getElementById("strategy-entry")?.value ?? "";
    const exitLogic = document.getElementById("strategy-exit")?.value ?? "";

    const params = {};
    STRATEGY_PARAM_FIELD_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) {
        return;
      }
      params[id] = el.value ?? "";
    });

    return {
      meta: {
        name: filename,
        description,
      },
      prompts: {
        entryLogic,
        exitLogic,
      },
      params,
      currentStrategyName: this.currentStrategyName || filename || "",
      updatedAt: Date.now(),
    };
  }

  saveStrategyDraft() {
    if (!window?.localStorage) {
      return;
    }
    const payload = this.collectStrategyEditorState();
    if (!payload) {
      return;
    }
    try {
      window.localStorage.setItem(STRATEGY_EDITOR_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn("[strategy-editor] 写入草稿失败", error);
    }
  }

  restoreStrategyDraft() {
    if (!this.strategyEditorEl || !window?.localStorage) {
      return;
    }

    let rawDraft = null;
    try {
      rawDraft = window.localStorage.getItem(STRATEGY_EDITOR_STORAGE_KEY);
    } catch (error) {
      console.warn("[strategy-editor] 读取草稿失败", error);
      return;
    }

    if (!rawDraft) {
      return;
    }

    let draft;
    try {
      draft = JSON.parse(rawDraft);
    } catch (error) {
      console.warn("[strategy-editor] 解析草稿失败", error);
      return;
    }

    this.isStrategyDraftSyncSuspended = true;
    try {
      const nameInput = document.getElementById("strategy-filename");
      if (nameInput) {
        nameInput.value = draft?.meta?.name || "";
      }

      const descInput = document.getElementById("strategy-description");
      if (descInput) {
        descInput.value = draft?.meta?.description || "";
      }

      const entryField = document.getElementById("strategy-entry");
      if (entryField) {
        entryField.value = draft?.prompts?.entryLogic || "";
      }

      const exitField = document.getElementById("strategy-exit");
      if (exitField) {
        exitField.value = draft?.prompts?.exitLogic || "";
      }

      if (draft?.params && typeof draft.params === "object") {
        STRATEGY_PARAM_FIELD_IDS.forEach((id) => {
          const el = document.getElementById(id);
          if (!el) {
            return;
          }
          if (Object.prototype.hasOwnProperty.call(draft.params, id)) {
            el.value = draft.params[id] ?? "";
          }
        });
      }
    } finally {
      this.isStrategyDraftSyncSuspended = false;
    }

    if (typeof draft?.currentStrategyName === "string") {
      this.currentStrategyName = draft.currentStrategyName;
      this.updateStrategyListHighlight(this.currentStrategyName);
    }
  }

  setupStrategyEditorQuickInsert() {
    if (!this.strategyEditorEl) {
      return;
    }

    const buttons = this.strategyEditorEl.querySelectorAll("[data-editor-insert]");
    if (!buttons || buttons.length === 0) {
      return;
    }

    buttons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const strategy = button.dataset.editorInsert;
        if (!strategy) {
          return;
        }
        void this.applyStrategyTemplateToEditor(button, strategy);
      });
    });
  }

  setupVariableGuideModal() {
    this.variableGuideModal = document.getElementById("variable-guide-modal");
    this.variableGuideTrigger = document.getElementById("prompt-variable-guide-btn");

    if (!this.variableGuideModal || !this.variableGuideTrigger) {
      return;
    }

    this.variableGuideEscHandler = (event) => {
      if (event && event.key === "Escape") {
        event.preventDefault();
        this.closeVariableGuideModal();
      }
    };

    const closeTargets = this.variableGuideModal.querySelectorAll("[data-variable-modal-close]");
    closeTargets.forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        this.closeVariableGuideModal();
      });
    });

    this.variableGuideTrigger.addEventListener("click", (event) => {
      event.preventDefault();
      this.openVariableGuideModal();
    });
  }

  openVariableGuideModal() {
    if (!this.variableGuideModal) {
      return;
    }

    if (this.variableGuideModal.classList.contains("is-visible")) {
      return;
    }

    this.variableGuideModal.classList.add("is-visible");
    this.variableGuideModal.setAttribute("aria-hidden", "false");
    this.variableGuideTrigger?.setAttribute("aria-expanded", "true");

    if (this.variableGuideEscHandler) {
      document.addEventListener("keydown", this.variableGuideEscHandler);
    }

    window.requestAnimationFrame(() => {
      const panel = this.variableGuideModal?.querySelector(".variable-modal-panel");
      if (panel) {
        panel.focus();
      }
    });
  }

  closeVariableGuideModal() {
    if (!this.variableGuideModal) {
      return;
    }

    this.variableGuideModal.classList.remove("is-visible");
    this.variableGuideModal.setAttribute("aria-hidden", "true");
    this.variableGuideTrigger?.setAttribute("aria-expanded", "false");
    if (this.variableGuideEscHandler) {
      document.removeEventListener("keydown", this.variableGuideEscHandler);
    }

    if (document.activeElement && this.variableGuideModal.contains(document.activeElement)) {
      this.variableGuideTrigger?.focus({ preventScroll: true });
    }
  }

  initAccountSwitcher() {
    if (!this.accountSwitcherEl || !this.accountSwitcherTrigger) {
      return;
    }

    const handleMouseEnter = () => {
      this.clearAccountSwitcherCloseTimer();
      this.toggleAccountSwitcher(true);
    };
    const handleMouseLeave = () => {
      this.scheduleAccountSwitcherClose();
    };

    this.accountSwitcherEl.addEventListener("mouseenter", handleMouseEnter);
    this.accountSwitcherEl.addEventListener("mouseleave", handleMouseLeave);
    this.accountSwitcherDropdown?.addEventListener("mouseenter", handleMouseEnter);
    this.accountSwitcherDropdown?.addEventListener("mouseleave", handleMouseLeave);

    this.accountSwitcherEl.addEventListener("focusin", () => {
      this.clearAccountSwitcherCloseTimer();
      this.toggleAccountSwitcher(true);
    });

    this.accountSwitcherEl.addEventListener("focusout", (event) => {
      const nextFocused = event?.relatedTarget;
      if (nextFocused && this.accountSwitcherEl.contains(nextFocused)) {
        return;
      }
      this.scheduleAccountSwitcherClose();
    });

    this.accountSwitcherTrigger.addEventListener("click", (event) => {
      event.preventDefault();
      const nextState = !this.accountSwitcherEl.classList.contains("is-open");
      this.toggleAccountSwitcher(nextState);
    });

    if (this.accountSwitcherList) {
      this.accountSwitcherList.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-account-id]");
        if (!button) {
          return;
        }
        event.preventDefault();
        const accountId = Number(button.dataset.accountId);
        if (!Number.isFinite(accountId)) {
          return;
        }
        this.toggleAccountSwitcher(false);
        void this.handleAccountSwitcherSelect(accountId, button);
      });
    }
  }

  toggleAccountSwitcher(isOpen) {
    if (!this.accountSwitcherEl || !this.accountSwitcherTrigger) {
      return;
    }
    this.clearAccountSwitcherCloseTimer();
    const open = Boolean(isOpen);
    this.accountSwitcherEl.classList.toggle("is-open", open);
    this.accountSwitcherTrigger.setAttribute("aria-expanded", open ? "true" : "false");
    if (this.accountSwitcherDropdown) {
      this.accountSwitcherDropdown.setAttribute("aria-hidden", open ? "false" : "true");
    }
  }

  updateAccountSwitcherDisplay() {
    if (!this.accountSwitcherEl || !this.accountSwitcherLabel) {
      return;
    }

    if (!this.isAuthenticated) {
      this.accountSwitcherLabel.textContent = this.translate("accounts.switcher.label", "Account");
      this.toggleAccountSwitcher(false);
      return;
    }

    const accounts = Array.isArray(this.accountsCache) ? this.accountsCache : [];
    const activeAccount = accounts.find((account) => account?.is_active);
    const activeLabel = activeAccount?.name || this.translate("accounts.switcher.noActive", "No active account");
    this.accountSwitcherLabel.textContent = activeLabel;

    if (!this.accountSwitcherList) {
      return;
    }

    const otherAccounts = accounts.filter((account) => !account?.is_active);
    if (!otherAccounts.length) {
      if (this.accountSwitcherEmpty) {
        this.accountSwitcherEmpty.classList.remove("hidden");
        this.accountSwitcherEmpty.textContent = this.translate("accounts.switcher.empty", "No other accounts");
      }
    } else {
      this.accountSwitcherEmpty?.classList.add("hidden");
    }

    const currentLabel = this.translate("accounts.actions.current", "Current");
    const items = [];

    if (activeAccount) {
      const activeProviderLabel = this.translate(
        `accounts.providers.${activeAccount.provider}`,
        activeAccount.provider?.toUpperCase() || "OKX",
      );
      const activePaperBadge = activeAccount.use_paper
        ? `<span class="account-switcher-badge">${this.escapeHtml(this.translate("accounts.badges.paper", "Paper"))}</span>`
        : "";
      const activeMeta = `${this.escapeHtml(activeProviderLabel)}`;
      items.push(`
        <li>
          <button type="button" class="account-switcher-item is-current" data-account-id="${activeAccount.id}" disabled aria-disabled="true">
            <span class="account-switcher-name">${this.escapeHtml(activeAccount.name || activeProviderLabel)}</span>
            <span class="account-switcher-meta">${activeMeta}${activePaperBadge ? ` ${activePaperBadge}` : ""}</span>
            <span class="account-switcher-tag">${this.escapeHtml(currentLabel)}</span>
          </button>
        </li>
      `);
    }

    items.push(
      ...otherAccounts.map((account) => {
        const providerLabel = this.translate(`accounts.providers.${account.provider}`, account.provider?.toUpperCase() || "OKX");
        const paperBadge = account.use_paper
          ? `<span class="account-switcher-badge">${this.escapeHtml(this.translate("accounts.badges.paper", "Paper"))}</span>`
          : "";
        const meta = `${this.escapeHtml(providerLabel)}`;
        return `
          <li>
            <button type="button" class="account-switcher-item" data-account-id="${account.id}">
              <span class="account-switcher-name">${this.escapeHtml(account.name || providerLabel)}</span>
              <span class="account-switcher-meta">${meta}${paperBadge ? ` ${paperBadge}` : ""}</span>
            </button>
          </li>
        `;
      }),
    );

    this.accountSwitcherList.innerHTML = items.join("");
  }

  async handleAccountSwitcherSelect(accountId, triggerBtn) {
    if (!Number.isFinite(accountId)) {
      return;
    }

    const target = this.accountsCache?.find((account) => account.id === accountId);
    if (!target || target.is_active) {
      return;
    }

    await this.activateAccount(accountId, triggerBtn);
  }

  clearAccountSwitcherCloseTimer() {
    if (this.accountSwitcherCloseTimer) {
      window.clearTimeout(this.accountSwitcherCloseTimer);
      this.accountSwitcherCloseTimer = null;
    }
  }

  scheduleAccountSwitcherClose() {
    this.clearAccountSwitcherCloseTimer();
    this.accountSwitcherCloseTimer = window.setTimeout(() => {
      this.toggleAccountSwitcher(false);
      this.accountSwitcherCloseTimer = null;
    }, 180);
  }

  resolveStrategyLabel(strategy) {
    if (strategy && STRATEGY_LABELS[strategy]) {
      return STRATEGY_LABELS[strategy];
    }
    if (strategy) {
      return strategy;
    }
    return t("strategy.labels.unknown");
  }

  getStrategyPromptCacheKey(strategy, interval) {
    const normalizedInterval = interval && interval.trim() !== "" ? interval.trim() : "default";
    return `${strategy}|${normalizedInterval}`;
  }

  async fetchStrategySections(strategy, interval) {
    const currentLang = getCurrentLanguage();
    const cacheKey = `${this.getStrategyPromptCacheKey(strategy, interval || "")}_${currentLang}`;
    if (this.strategyPromptCache.has(cacheKey)) {
      return this.strategyPromptCache.get(cacheKey);
    }

    const params = new URLSearchParams();
    params.set("strategy", strategy);
    params.set("language", currentLang);
    if (interval && interval.trim() !== "") {
      params.set("interval", interval.trim());
    }

    const data = await this.fetchJson(`/api/strategy/default-prompts?${params.toString()}`);
    if (!data || !data.sections) {
      return null;
    }

    this.strategyPromptCache.set(cacheKey, data.sections);
    return data.sections;
  }

  async applyStrategyTemplateToEditor(button, strategy) {
    if (!this.ensureAuthenticated()) {
      return;
    }

    const entryField = document.getElementById("strategy-entry");
    const exitField = document.getElementById("strategy-exit");
    if (!entryField || !exitField) {
      console.warn("[strategy-editor] 缺少必要的文本区域");
      return;
    }

    const intervalInput = document.getElementById("st-interval");
    const intervalValue = intervalInput && typeof intervalInput.value === "string" ? intervalInput.value.trim() : "";

    const originalText = button.dataset.originalLabel || button.textContent || t("strategy.fieldNames.default");
    button.dataset.originalLabel = originalText;
    button.disabled = true;
    button.classList.add("loading");
    button.textContent = t("loading");

    try {
      const sections = await this.fetchStrategySections(strategy, intervalValue);
      if (!sections) {
        this.showToast("error", t("notifications.loadFailedTitle"), t("notifications.loadFailedDefault"));
        return;
      }

      entryField.value = typeof sections.entry === "string" ? sections.entry : "";
      exitField.value = typeof sections.exit === "string" ? sections.exit : "";

      [entryField, exitField].forEach((field) => {
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });

      const strategyLabel = this.resolveStrategyLabel(strategy);
      const fieldLabel = t("strategy.fieldNames.all");
      this.showToast(
        "success",
        t("notifications.templateInsertedTitle"),
        t("notifications.templateInsertedMessage", { strategy: strategyLabel, field: fieldLabel }),
      );
    } catch (error) {
      console.error("[strategy-editor] 获取策略模板失败:", error);
      const fallbackMessage = t("notifications.loadFailedDefault");
      const message = error instanceof Error ? error.message : fallbackMessage;
      this.showToast("error", t("notifications.loadFailedTitle"), message);
    } finally {
      button.disabled = false;
      button.classList.remove("loading");
      button.textContent = button.dataset.originalLabel || originalText;
    }
  }

  setupIntervalSelector() {
    const buttons = document.querySelectorAll(".interval-btn");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const interval = btn.dataset.interval;
        if (!interval || interval === this.activeInterval) return;

        // 更新激活状态
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        // 更新当前周期并重新加载K线
        this.activeInterval = interval;
        if (this.chartIntervalEl) {
          this.chartIntervalEl.textContent = interval;
        }

        console.log(`[setupIntervalSelector] 切换周期到: ${interval}`);
        void this.loadCandles(this.activeSymbol);
      });
    });
  }

  initViewAllControls() {
    if (this.decisionListEl) {
      this.decisionsViewAllLink = this.createViewAllLink("decisions");
      this.decisionListEl.addEventListener("scroll", () => {
        this.updateViewAllVisibility(this.decisionListEl, this.decisionsViewAllLink);
      });
    }

    if (this.tradesContainerEl) {
      this.tradesViewAllLink = this.createViewAllLink("trades");
      this.tradesContainerEl.addEventListener("scroll", () => {
        this.updateViewAllVisibility(this.tradesContainerEl, this.tradesViewAllLink);
      });
    }

    if (this.logsContainerEl) {
      this.logsViewAllLink = this.createViewAllLink("logs");
      this.logsContainerEl.addEventListener("scroll", () => {
        this.updateViewAllVisibility(this.logsContainerEl, this.logsViewAllLink);
      });
    }

    if (this.decisionLogsContainerEl) {
      this.decisionRequestsViewAllLink = this.createViewAllLink("decisionRequests");
      this.decisionLogsContainerEl.addEventListener("scroll", () => {
        this.updateViewAllVisibility(this.decisionLogsContainerEl, this.decisionRequestsViewAllLink);
      });
    }
  }

  createViewAllLink(type) {
    const link = document.createElement("a");
    link.href = "#";
    link.className = "table-view-all";
    link.textContent = t("tables.common.viewAll");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      this.openRecordsModal(type);
    });
    return link;
  }

  appendViewAllLink(container, link) {
    if (!container || !link) return;
    link.classList.remove("visible");
    if (link.parentElement !== container) {
      container.appendChild(link);
    } else {
      container.appendChild(link);
    }
    window.requestAnimationFrame(() => {
      this.updateViewAllVisibility(container, link);
    });
  }

  removeViewAllLink(link) {
    if (!link) return;
    link.classList.remove("visible");
    if (link.parentElement) {
      link.parentElement.removeChild(link);
    }
  }

  updateViewAllVisibility(container, link) {
    if (!container || !link) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const threshold = 12;
    const reachedBottom = scrollHeight - (scrollTop + clientHeight) <= threshold;
    const notScrollable = scrollHeight <= clientHeight + 2;
    if (reachedBottom || notScrollable) {
      link.classList.add("visible");
    } else {
      link.classList.remove("visible");
    }
  }

  setupRecordsControls() {
    if (this.recordsPrevBtn) {
      this.recordsPrevBtn.addEventListener("click", () => {
        if (!this.recordsState?.type) return;
        if (this.recordsState.page <= 1) return;
        this.openRecordsModal(this.recordsState.type, this.recordsState.page - 1);
      });
    }

    if (this.recordsNextBtn) {
      this.recordsNextBtn.addEventListener("click", () => {
        if (!this.recordsState?.type) return;
        const totalPages = this.getRecordsTotalPages();
        if (this.recordsState.page >= totalPages) return;
        this.openRecordsModal(this.recordsState.type, this.recordsState.page + 1);
      });
    }
  }

  openRecordsModal(type, page = 1) {
    if (!this.recordsModal || !this.recordsTableContainer) return;
    this.recordsState = {
      type,
      page,
      pageSize: this.recordsState?.pageSize || 20,
      total: 0,
    };
    if (this.recordsTitleEl) {
      const baseTitle = t("modals.records.title");
      let typeLabel = "";
      if (type === "trades") {
        typeLabel = t("tabs.trades");
      } else if (type === "logs") {
        typeLabel = t("tabs.logs");
      } else if (type === "decisions") {
        typeLabel = t("decision.title");
      } else if (type === "decisionRequests") {
        typeLabel = t("decisionRequest.title");
      }
      this.recordsTitleEl.textContent = typeLabel ? `${baseTitle} - ${typeLabel}` : baseTitle;
    }
    this.recordsCurrentItems = [];
    this.recordsTableContainer.innerHTML = `<p class="loading">${t("loading")}</p>`;
    if (this.recordsPageInfoEl) {
      this.recordsPageInfoEl.textContent = t("loading");
    }
    if (this.recordsPrevBtn) {
      this.recordsPrevBtn.disabled = true;
    }
    if (this.recordsNextBtn) {
      this.recordsNextBtn.disabled = true;
    }
    this.recordsModal.classList.add("show");
    void this.loadRecordsPage();
  }

  async loadRecordsPage() {
    if (!this.recordsState?.type) return;

    const { type, pageSize, page } = this.recordsState;
    let endpoint = "";
    let dataKey = "";

    if (type === "trades") {
      endpoint = "/api/trades";
      dataKey = "trades";
    } else if (type === "logs") {
      endpoint = "/api/trade-logs";
      dataKey = "logs";
    } else if (type === "decisions") {
      endpoint = "/api/logs";
      dataKey = "logs";
    } else if (type === "decisionRequests") {
      endpoint = "/api/decision-requests";
      dataKey = "requests";
    } else {
      return;
    }
    const data = await this.fetchJson(`${endpoint}?page=${page}&limit=${pageSize}`);
    if (!data) {
      if (this.recordsTableContainer) {
        this.recordsTableContainer.innerHTML = `<p class="empty-state">${t("notifications.loadFailedTitle")}</p>`;
      }
      if (this.recordsState) {
        this.recordsState.total = 0;
      }
      this.updateRecordsPagination();
      return;
    }

    const items = Array.isArray(data[dataKey]) ? data[dataKey] : [];
    const pagination = data.pagination || {};
    const total = Number(pagination.total);
    const pageSizeParsed = Number(pagination.pageSize);
    const pageParsed = Number(pagination.page);

    if (Number.isFinite(total)) {
      this.recordsState.total = total;
    } else {
      this.recordsState.total = items.length;
    }

    if (Number.isFinite(pageSizeParsed) && pageSizeParsed > 0) {
      this.recordsState.pageSize = pageSizeParsed;
    }

    if (Number.isFinite(pageParsed) && pageParsed > 0) {
      this.recordsState.page = pageParsed;
    }

    this.recordsCurrentItems = items;

    const totalPages = this.getRecordsTotalPages();
    if (!items.length && totalPages < this.recordsState.page && totalPages >= 1) {
      this.recordsState.page = totalPages;
      await this.loadRecordsPage();
      return;
    }

    if (type === "trades") {
      this.renderRecordsTrades(items);
    } else if (type === "logs") {
      this.renderRecordsLogs(items);
    } else if (type === "decisions") {
      this.renderRecordsDecisions(items);
    } else if (type === "decisionRequests") {
      this.renderRecordsDecisionRequests(items);
    }

    this.updateRecordsPagination();
  }

  renderRecordsTrades(trades) {
    if (!this.recordsTableContainer) return;
    if (!trades.length) {
      this.recordsTableContainer.innerHTML = `<p class="empty-state">${t("tables.trades.empty")}</p>`;
      return;
    }

    const rows = trades
      .map((trade) => {
        const symbol = String(trade.symbol || "").toUpperCase();
        const leverage = trade.leverage ? `${trade.leverage}x` : "";
        const symbolDisplay = leverage 
          ? `<span class="symbol-name">${symbol}</span> <span class="leverage-label">${leverage}</span>` 
          : `<span class="symbol-name">${symbol}</span>`;
        const sideRaw = String(trade.side || "").toLowerCase();
        const sideLabel = sideRaw === "long"
          ? t("long")
          : sideRaw === "short"
            ? t("short")
            : "--";
        const sideClass = sideRaw === "long" ? "positive" : sideRaw === "short" ? "negative" : "";
        const typeKey = typeof trade.type === "string" ? trade.type.toLowerCase() : "";
        let typeLabel = typeKey ? t(`tables.trades.types.${typeKey}`) : "";
        if (!typeLabel || typeLabel === `tables.trades.types.${typeKey}`) {
          typeLabel = trade.type || "--";
        }
        const price = this.formatPrice(trade.price);
        const quantityValue = Number(trade.quantity);
        const contractsValue = Number(trade.contracts);
        const actualQuantity = Number.isFinite(quantityValue) && quantityValue > 0
          ? quantityValue
          : this.convertContractsToQuantity(symbol, contractsValue);
        const quantityLabel = Number.isFinite(actualQuantity) ? this.formatQuantity(actualQuantity) : "--";
        const contractsLabel = Number.isFinite(contractsValue) && contractsValue > 0
          ? t("tables.common.contractsWithUnit", { value: this.formatQuantity(contractsValue) })
          : "";
        const quantityCell = quantityLabel !== "--"
          ? t("tables.common.quantityWithSymbol", { value: quantityLabel, symbol })
          : "--";
        const fee = typeof trade.fee === "number" ? this.formatCurrency(trade.fee, 4, true) : "--";
        const pnl = typeof trade.pnl === "number" ? trade.pnl : null;
        const pnlClass = pnl !== null ? (pnl >= 0 ? "positive" : "negative") : "";
        const pnlLabel = pnl !== null ? this.formatCurrency(pnl, 2, true) : "--";
        const timestamp = trade.timestamp ? this.formatTime(trade.timestamp) : "--";

        return `
          <tr>
            <td class="text-primary">${symbolDisplay}</td>
            <td>${typeLabel}</td>
            <td><span class="${sideClass}">${sideLabel}</span></td>
            <td>${price}</td>
            <td${contractsLabel ? ` title="${contractsLabel}"` : ""}>${quantityCell}</td>
            <td>${fee}</td>
            <td class="${pnlClass}">${pnlLabel}</td>
            <td>${timestamp}</td>
          </tr>
        `;
      })
      .join("");

    this.recordsTableContainer.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>${t("tables.trades.headers.contract")}</th>
            <th>${t("tables.trades.headers.type")}</th>
            <th>${t("tables.trades.headers.side")}</th>
            <th>${t("tables.trades.headers.price")}</th>
            <th>${t("tables.trades.headers.quantity")}</th>
            <th>${t("tables.trades.headers.fee")}</th>
            <th>${t("tables.trades.headers.pnl")}</th>
            <th>${t("tables.trades.headers.time")}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  renderRecordsLogs(logs) {
    if (!this.recordsTableContainer) return;
    if (!logs.length) {
      this.recordsTableContainer.innerHTML = `<p class="empty-state">${t("tables.logs.empty")}</p>`;
      return;
    }

    const rows = logs
      .map((log, index) => {
        const timestamp = log.createdAt ? this.formatTime(log.createdAt) : "--";
        const symbol = log.symbol ? String(log.symbol).toUpperCase() : "--";
        const action = log.action || "--";
        const statusRaw = typeof log.status === "string" ? log.status : "";
        const statusLower = statusRaw.toLowerCase();
        let statusLabel = statusLower ? t(`tables.logs.status.${statusLower}`) : "";
        if (!statusLabel || statusLabel === `tables.logs.status.${statusLower}`) {
          statusLabel = statusRaw || t("tables.logs.status.unknown");
        }
        const statusClass = statusLower === "success"
          ? "positive"
          : ["error", "failed", "failure"].includes(statusLower)
            ? "negative"
            : "";
        const message = log.message ? this.escapeHtml(String(log.message)) : "--";

        return `
          <tr data-log-index="${index}">
            <td>${timestamp}</td>
            <td class="text-primary">${symbol}</td>
            <td>${action}</td>
            <td><span class="${statusClass}">${statusLabel}</span></td>
            <td class="log-message-cell">${message}</td>
          </tr>
        `;
      })
      .join("");

    this.recordsTableContainer.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>${t("tables.logs.headers.time")}</th>
            <th>${t("tables.logs.headers.contract")}</th>
            <th>${t("tables.logs.headers.action")}</th>
            <th>${t("tables.logs.headers.status")}</th>
            <th>${t("tables.logs.headers.summary")}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    this.recordsTableContainer.querySelectorAll("tbody tr").forEach((row) => {
      const index = Number(row.dataset.logIndex);
      if (Number.isInteger(index)) {
        row.addEventListener("click", () => {
          const log = this.recordsCurrentItems[index];
          if (log) {
            this.showLogDetail(log);
          }
        });
      }
    });
  }

  renderRecordsDecisions(decisions) {
    if (!this.recordsTableContainer) return;
    if (!decisions.length) {
      this.recordsTableContainer.innerHTML = `<p class="empty-state">${t("decision.empty")}</p>`;
      return;
    }

    const rows = decisions
      .map((decision, index) => {
        const timestamp = decision.timestamp ? this.formatTime(decision.timestamp) : "--";
        const iterationValue = Number(decision.iteration);
        const iterationLabel = Number.isFinite(iterationValue) ? `#${iterationValue}` : "--";
        const positionsValue = Number(decision.positionsCount);
        const positionsLabel = Number.isFinite(positionsValue) ? positionsValue.toString() : "--";
        const accountValue = Number(decision.accountValue);
        const accountLabel = Number.isFinite(accountValue)
          ? this.formatCurrency(accountValue, 0)
          : "--";
        const actionsData = this.parseActionsData(decision);
        const summaryRaw = this.generateDecisionSummary(actionsData);
        const summary = this.escapeHtml(summaryRaw || t("tables.decisions.defaultSummary"));

        return `
          <tr data-decision-index="${index}">
            <td>${timestamp}</td>
            <td>${iterationLabel}</td>
            <td>${summary}</td>
            <td>${positionsLabel}</td>
            <td>${accountLabel}</td>
          </tr>
        `;
      })
      .join("");

    this.recordsTableContainer.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>${t("tables.decisions.headers.time")}</th>
            <th>${t("tables.decisions.headers.iteration")}</th>
            <th>${t("tables.decisions.headers.summary")}</th>
            <th>${t("tables.decisions.headers.positions")}</th>
            <th>${t("tables.decisions.headers.accountValue")}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    this.recordsTableContainer.querySelectorAll("tbody tr").forEach((row) => {
      const index = Number(row.dataset.decisionIndex);
      if (Number.isInteger(index)) {
        row.addEventListener("click", () => {
          const decision = this.recordsCurrentItems[index];
          if (decision) {
            this.showDecisionDetail(decision);
          }
        });
      }
    });
  }

  renderRecordsDecisionRequests(requests) {
    if (!this.recordsTableContainer) return;
    if (!requests.length) {
      this.recordsTableContainer.innerHTML = `<p class="empty-state">${t("decisionRequest.empty")}</p>`;
      return;
    }

    const rows = requests
      .map((request, index) => {
        const timestamp = request.createdAt ? this.formatTime(request.createdAt) : "--";
        const model = request.modelName ? this.escapeHtml(String(request.modelName)) : "--";
        const summary = this.escapeHtml(this.getDecisionRequestSummaryText(request));
        const durationLabel = this.formatOutputDuration(request.outputDurationMs);

        return `
          <tr data-decision-request-index="${index}">
            <td>${timestamp}</td>
            <td>${model}</td>
            <td>${summary}</td>
            <td>${durationLabel}</td>
          </tr>
        `;
      })
      .join("");

    this.recordsTableContainer.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>${t("tables.decisionRequests.headers.time")}</th>
            <th>${t("tables.decisionRequests.headers.model")}</th>
            <th>${t("tables.decisionRequests.headers.summary")}</th>
            <th>${t("tables.decisionRequests.headers.duration")}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    this.recordsTableContainer.querySelectorAll("tbody tr").forEach((row) => {
      const index = Number(row.dataset.decisionRequestIndex);
      if (Number.isInteger(index)) {
        row.addEventListener("click", () => {
          this.showDecisionRequestDetail(requests[index]);
        });
      }
    });
  }

  updateRecordsPagination() {
    if (!this.recordsPaginationEl || !this.recordsState) return;
    const totalPages = this.getRecordsTotalPages();
    const total = this.recordsState.total;

    if (this.recordsPageInfoEl) {
      if (!total) {
        this.recordsPageInfoEl.textContent = t("pagination.empty");
      } else {
        this.recordsPageInfoEl.textContent = t("pagination.page", {
          current: this.recordsState.page,
          total: totalPages,
          count: total,
        });
      }
    }

    if (this.recordsPrevBtn) {
      this.recordsPrevBtn.disabled = !total || this.recordsState.page <= 1;
    }

    if (this.recordsNextBtn) {
      this.recordsNextBtn.disabled = !total || this.recordsState.page >= totalPages;
    }
  }

  getRecordsTotalPages() {
    if (!this.recordsState || !this.recordsState.pageSize) return 1;
    const { total, pageSize } = this.recordsState;
    if (!total || total <= 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(total / pageSize));
  }

  addAvailableSymbol(symbol) {
    if (typeof symbol !== "string") {
      return false;
    }
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) {
      return false;
    }
    if (this.availableSymbols.has(normalized)) {
      return false;
    }
    this.availableSymbols.add(normalized);
    if (!Array.isArray(this.symbolOrder)) {
      this.symbolOrder = [];
    }
    this.symbolOrder.push(normalized);
    return true;
  }

  schedulePriceSubscriptionUpdate() {
    if (this.priceSubscriptionDebounceTimer) {
      window.clearTimeout(this.priceSubscriptionDebounceTimer);
    }
    this.priceSubscriptionDebounceTimer = window.setTimeout(() => {
      this.priceSubscriptionDebounceTimer = null;
      this.sendPriceSubscription();
    }, 200);
  }

  renderSymbolList() {
    if (!this.symbolListEl) return;

    const orderedSymbols = Array.isArray(this.symbolOrder) ? this.symbolOrder : [];
    const seen = new Set();
    const symbolsInOrder = [];

    orderedSymbols.forEach((symbol) => {
      const normalized = typeof symbol === "string" ? symbol.toUpperCase() : null;
      if (!normalized) {
        return;
      }
      if (this.availableSymbols.has(normalized) && !seen.has(normalized)) {
        symbolsInOrder.push(normalized);
        seen.add(normalized);
      }
    });

    const remaining = [];
    this.availableSymbols.forEach((symbol) => {
      if (!seen.has(symbol)) {
        remaining.push(symbol);
      }
    });
    remaining.sort();

    const symbols = symbolsInOrder.concat(remaining);

    const html = symbols
      .map((symbol) => {
        const price = this.prices.get(symbol);
        const change = this.priceChanges.get(symbol);
        const active = symbol === this.activeSymbol ? "active" : "";

        const priceLabel = Number.isFinite(price) ? this.formatPrice(price) : "--";
        const changeLabel = Number.isFinite(change) ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : "--";
        const changeClass = Number.isFinite(change) ? (change > 0 ? "positive" : change < 0 ? "negative" : "neutral") : "neutral";

        return `
          <div class="symbol-item ${active}" data-symbol="${symbol}">
            <div class="symbol-info">
              <div class="symbol-name">${symbol}/USDT</div>
              <div class="symbol-price">${priceLabel}</div>
            </div>
            <div class="symbol-change ${changeClass}">${changeLabel}</div>
          </div>
        `;
      })
      .join("");

    this.symbolListEl.innerHTML = html;

    this.symbolListEl.querySelectorAll(".symbol-item").forEach((item) => {
      item.addEventListener("click", () => {
        const symbol = item.dataset.symbol;
        if (symbol) {
          this.switchToSymbol(symbol);
        }
      });
    });
  }

  updateChartTitle() {
    if (this.chartTitleEl) {
      this.chartTitleEl.textContent = `${this.activeSymbol}/USDT`;
    }
  }

  switchToSymbol(symbol) {
    if (!symbol || symbol === this.activeSymbol) return;
    
    const normalizedSymbol = symbol.toUpperCase();
    
    // 更新左侧币种列表的选中状态
    this.activeSymbol = normalizedSymbol;
    this.renderSymbolList();
    
    // 更新中间K线图
    this.updateChartTitle();
    void this.loadCandles(normalizedSymbol);
    
    // 更新右侧手动交易面板的交易对选择器
    this.updateManualTradeSymbol(normalizedSymbol);
  }

  updateManualTradeSymbol(symbol) {
    const trigger = document.getElementById("manual-symbol-trigger");
    const select = document.getElementById("manual-symbol");
    
    if (!trigger || !select) return;
    
    // 保存当前币种的设置
    const currentSymbol = select.value;
    if (currentSymbol && currentSymbol !== symbol) {
      this.saveManualTradeSettings(currentSymbol);
    }
    
    const label = trigger.querySelector(".manual-select-label");
    if (label) {
      label.textContent = symbol;
    }
    
    select.value = symbol;
    
    // 加载新币种的设置
    this.loadManualTradeSettings(symbol);
    
    // 如果当前是限价单模式，自动更新价格
    this.updateLimitOrderPrice(symbol);
  }

  saveManualTradeSettings(symbol) {
    if (!symbol) return;
    const normalizedSymbol = symbol.toUpperCase();
    
    const leverageInput = document.getElementById("manual-leverage");
    const marginSelect = document.getElementById("manual-margin-mode");
    const orderTypeButtons = document.querySelectorAll("[data-order-type].active");
    
    const settings = {
      leverage: leverageInput ? Number(leverageInput.value) : 10,
      marginMode: marginSelect ? marginSelect.value : "cross",
      orderType: orderTypeButtons[0]?.getAttribute("data-order-type") || "market",
    };
    
    this.manualTradeSettings.set(normalizedSymbol, settings);
    this.persistManualTradeSettings();
    console.log(`[Manual Trade] 保存 ${normalizedSymbol} 设置:`, settings);
  }

  loadManualTradeSettings(symbol) {
    if (!symbol) return;
    const normalizedSymbol = symbol.toUpperCase();
    
    const settings = this.manualTradeSettings.get(normalizedSymbol);
    if (!settings) {
      console.log(`[Manual Trade] ${normalizedSymbol} 没有保存的设置，使用默认值`);
      this.applyManualTradeDefaultSettings();
      return;
    }
    
    console.log(`[Manual Trade] 加载 ${normalizedSymbol} 设置:`, settings);
    
    // 恢复杠杆
    const leverageInput = document.getElementById("manual-leverage");
    if (leverageInput) {
      leverageInput.value = settings.leverage || 10;
    }
    
    // 恢复保证金模式
    const marginTrigger = document.getElementById("manual-margin-trigger");
    const marginSelect = document.getElementById("manual-margin-mode");
    if (marginTrigger && marginSelect) {
      const label = marginTrigger.querySelector(".manual-select-label");
      if (label) {
        label.textContent = settings.marginMode === "cross" ? t("trade.cross") : t("trade.isolated");
      }
      marginSelect.value = settings.marginMode || "cross";
    }
    
    // 恢复订单类型
    const orderTypeButtons = document.querySelectorAll("[data-order-type]");
    const priceInput = document.getElementById("manual-price");
    orderTypeButtons.forEach((btn) => {
      const orderType = btn.getAttribute("data-order-type");
      if (orderType === settings.orderType) {
        btn.classList.add("active");
        
        // 更新价格输入框状态
        if (priceInput) {
          if (orderType === "market") {
            priceInput.disabled = true;
            priceInput.placeholder = t("trade.market") + " " + t("trade.price");
            priceInput.value = "";
          } else {
            priceInput.disabled = false;
            priceInput.placeholder = t("trade.pricePlaceholder");
            this.updateLimitOrderPrice(normalizedSymbol);
          }
        }
      } else {
        btn.classList.remove("active");
      }
    });
  }

  applyManualTradeDefaultSettings() {
    const leverageInput = document.getElementById("manual-leverage");
    if (leverageInput) {
      leverageInput.value = 10;
    }
    const marginTrigger = document.getElementById("manual-margin-trigger");
    const marginSelect = document.getElementById("manual-margin-mode");
    if (marginTrigger && marginSelect) {
      const label = marginTrigger.querySelector(".manual-select-label");
      if (label) {
        label.textContent = t("trade.cross");
      }
      marginSelect.value = "cross";
    }
    const orderTypeButtons = document.querySelectorAll("[data-order-type]");
    const priceInput = document.getElementById("manual-price");
    orderTypeButtons.forEach((btn) => {
      const orderType = btn.getAttribute("data-order-type");
      const isDefault = orderType === "market";
      btn.classList.toggle("active", isDefault);
    });
    if (priceInput) {
      priceInput.disabled = true;
      priceInput.placeholder = t("trade.market") + " " + t("trade.price");
      priceInput.value = "";
    }
  }

  persistManualTradeSettings() {
    try {
      if (!window?.localStorage) return;
      const payload = {};
      this.manualTradeSettings.forEach((value, key) => {
        payload[key] = value;
      });
      window.localStorage.setItem("manualTradeSettings", JSON.stringify(payload));
    } catch (error) {
      console.warn("[Manual Trade] 保存设置到本地失败", error);
    }
  }

  restoreManualTradeSettings() {
    try {
      if (!window?.localStorage) return;
      const raw = window.localStorage.getItem("manualTradeSettings");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      Object.entries(parsed).forEach(([symbol, settings]) => {
        if (!symbol || typeof settings !== "object") return;
        const normalizedSymbol = symbol.toString().toUpperCase();
        const safeSettings = {
          leverage: Number(settings.leverage) || 10,
          marginMode: settings.marginMode === "isolated" ? "isolated" : "cross",
          orderType: settings.orderType === "limit" ? "limit" : "market",
        };
        this.manualTradeSettings.set(normalizedSymbol, safeSettings);
      });
      console.log(`[Manual Trade] 已从本地加载 ${this.manualTradeSettings.size} 条设置`);
    } catch (error) {
      console.warn("[Manual Trade] 读取本地设置失败", error);
    }
  }

  updateManualTradeBalance() {
    const balanceEl = document.getElementById("manual-available-balance");
    if (balanceEl) {
      balanceEl.textContent = this.formatCurrency(this.availableBalance);
    }
  }

  initChart() {
    const container = this.klineChartEl;
    const chartLib = window.LightweightCharts;

    if (!container || !chartLib) {
      console.warn("LightweightCharts 未加载或容器缺失");
      return;
    }

    this.chart = chartLib.createChart(container, {
      layout: {
        background: { color: "transparent" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "rgba(75, 85, 105, 0.2)" },
        horzLines: { color: "rgba(75, 85, 105, 0.2)" },
      },
      crosshair: {
        mode: chartLib.CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: "rgba(75, 85, 105, 0.3)",
      },
      timeScale: {
        borderColor: "rgba(75, 85, 105, 0.3)",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    this.candleSeries = this.chart.addCandlestickSeries({
      upColor: "#10b981",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });

    // 立即更新图表尺寸
    this.updateChartSize();
    this.updateChartTitle();

    if (this.chartIntervalEl) {
      this.chartIntervalEl.textContent = this.activeInterval;
    }
    
    // 监听窗口大小变化
    this.resizeHandler = () => this.updateChartSize();
    window.addEventListener("resize", this.resizeHandler);
    
    // 再次延迟更新，确保容器完全渲染
    setTimeout(() => this.updateChartSize(), 200);

    if (this.pendingCandleSymbol) {
      const symbolToLoad = this.pendingCandleSymbol;
      this.pendingCandleSymbol = null;
      void this.loadCandles(symbolToLoad);
    }
  }

  updateChartSize() {
    if (!this.chart || !this.klineChartEl) return;
    const { clientWidth, clientHeight } = this.klineChartEl;
    
    console.log(`K线图容器尺寸: ${clientWidth}x${clientHeight}`);
    
    if (clientWidth === 0 || clientHeight === 0) {
      console.warn("K线图容器尺寸为0，稍后重试...");
      setTimeout(() => this.updateChartSize(), 100);
      return;
    }
    
    this.chart.applyOptions({ width: clientWidth, height: clientHeight });
  }

  initEquityChart() {
    const canvas = document.getElementById("equity-canvas");
    if (!canvas || !window.Chart) return;

    const ctx = canvas.getContext("2d");
    this.equityChart = new window.Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "权益",
            data: [],
            borderColor: "#06b6d4",
            backgroundColor: "rgba(6, 182, 212, 0.1)",
            borderWidth: 2,
            tension: 0.3,
            fill: true,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    });
  }

  async loadAccountSummary() {
    const data = await this.fetchJson("/api/account");
    if (!data) return;

    // 后端已经计算好了 totalBalance（包含未实现盈亏），前端不要重复加
    const totalEq = data.totalBalance;
    this.availableBalance = data.availableBalance || 0;
    
    this.setText("metric-total", this.formatCurrency(totalEq));
    this.setText("metric-available", this.formatCurrency(data.availableBalance));
    this.setText("metric-unrealised", this.formatCurrency(data.unrealisedPnl, 2, true));
    this.setText("metric-return", this.formatPercent(data.returnPercent));
    // 胜率和最大回撤不显示正负号
    this.setText("metric-winrate", `${(data.winRate || 0).toFixed(2)}%`);
    this.setText("metric-maxdrawdown", `${(data.maxDrawdown || 0).toFixed(2)}%`);

    // 更新手动交易面板的可用余额
    this.updateManualTradeBalance();

    const returnClass = data.returnPercent >= 0 ? "positive" : "negative";
    const returnEl = document.getElementById("metric-return");
    if (returnEl) {
      returnEl.className = `value ${returnClass}`;
    }

    const unrealisedEl = document.getElementById("metric-unrealised");
    if (unrealisedEl) {
      const unrealisedClass = data.unrealisedPnl >= 0 ? "positive" : "negative";
      unrealisedEl.className = `value ${unrealisedClass}`;
    }

    // 胜率和最大回撤使用默认白色，不添加颜色类
    const winrateEl = document.getElementById("metric-winrate");
    if (winrateEl) {
      winrateEl.className = "value";
    }

    const maxddEl = document.getElementById("metric-maxdrawdown");
    if (maxddEl) {
      maxddEl.className = "value";
    }

    // 加载历史权益数据更新图表
    await this.loadEquityHistory();
  }

  async loadEquityHistory() {
    if (!this.equityChart) return;

    const data = await this.fetchJson("/api/history?limit=100");
    if (!data || !data.history || !Array.isArray(data.history)) {
      console.warn('[loadEquityHistory] 无效的历史数据响应:', data);
      return;
    }

    // API 已经反转过数据，从旧到新排序
    const history = data.history;
    
    if (history.length === 0) {
      console.warn('[loadEquityHistory] 历史数据为空');
      return;
    }
    
    const labels = history.map(item => {
      const date = new Date(item.timestamp);
      return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    });
    
    const values = history.map(item => Number(item.totalValue) || 0);

    this.equityChart.data.labels = labels;
    this.equityChart.data.datasets[0].data = values;
    this.equityChart.update('none'); // 'none' 模式跳过动画以提升性能
    
    console.log(`[loadEquityHistory] 已加载 ${history.length} 条权益数据`);
  }

  async loadPositions() {
    const data = await this.fetchJson("/api/positions");
    if (!data) return;

    const { positions = [] } = data;
    const list = Array.isArray(positions) ? positions : [];
    this.applyPositionsData(list, Date.now());
  }

  applyPositionsData(rawPositions, timestamp) {
    if (!this.positionsContainerEl) {
      return;
    }

    const positions = Array.isArray(rawPositions) ? rawPositions : [];
    let newSymbolAdded = false;

    positions.forEach((pos) => {
      if (pos?.symbol) {
        const added = this.addAvailableSymbol(String(pos.symbol).toUpperCase());
        if (added) {
          newSymbolAdded = true;
        }
      }
    });

    // Check if we're receiving an empty positions array
    if (!positions.length) {
      // If we had positions before and now receiving empty, this might be a temporary glitch
      // Only clear after debounce timeout to avoid flickering
      const timeSinceLastUpdate = timestamp - this.lastPositionsTimestamp;
      
      // If last update was recent (< 30 seconds) and we had positions, ignore this empty update
      if (this.lastPositionsData && this.lastPositionsData.length > 0 && timeSinceLastUpdate < 30000) {
        console.warn('[Positions] 收到空持仓数据，但上次更新有持仓且时间较近，忽略此次更新以防止闪烁');
        return;
      }
      
      // Debounce empty state to prevent flickering
      if (!this.emptyPositionsTimeout) {
        this.emptyPositionsTimeout = setTimeout(() => {
          this.resetCloseConfirmationState();
          this.positionsContainerEl.innerHTML = `<p class="empty-state">${t("tables.positions.empty")}</p>`;
          this.updateTimestamp(this.positionsUpdatedEl, timestamp);
          this.emptyPositionsTimeout = null;
          this.lastPositionsData = null;
          this.lastPositionsTimestamp = timestamp;
        }, 500);
      }
      
      if (newSymbolAdded) {
        this.schedulePriceSubscriptionUpdate();
      }
      return;
    }

    // If we have positions, clear any pending empty timeout
    if (this.emptyPositionsTimeout) {
      clearTimeout(this.emptyPositionsTimeout);
      this.emptyPositionsTimeout = null;
    }

    // Cache the current positions data
    this.lastPositionsData = positions;
    this.lastPositionsTimestamp = timestamp;

    const showActions = Boolean(this.isAuthenticated);
    const rows = positions
      .map((pos) => {
        const symbol = String(pos.symbol || "--").toUpperCase();
        const leverageValue = Number(pos.leverage);
        const leverageLabel = Number.isFinite(leverageValue) && leverageValue > 0
          ? `${leverageValue}x`
          : (typeof pos.leverage === "string" && pos.leverage.trim() !== ""
            ? `${pos.leverage}x`
            : "");
        const marginModeRaw = typeof pos.marginMode === "string" ? pos.marginMode.toLowerCase() : "";
        const marginModeLabel = this.getMarginModeLabel(marginModeRaw);
        const leverageDisplay = leverageLabel ? `${marginModeLabel || ""}${leverageLabel}` : "";
        const symbolDisplay = leverageDisplay 
          ? `<span class="symbol-name">${symbol}</span> <span class="leverage-label">${leverageDisplay}</span>` 
          : `<span class="symbol-name">${symbol}</span>`;
        const sideRaw = String(pos.side || "").toLowerCase();
        const sideLabel = sideRaw === "long"
          ? t("long")
          : sideRaw === "short"
            ? t("short")
            : "--";
        const sideClass = sideRaw === "long" ? "positive" : sideRaw === "short" ? "negative" : "";
        const quantityValue = Number(pos.quantity);
        const contractsValue = Number(pos.contracts);
        const actualQuantity = Number.isFinite(quantityValue) && quantityValue > 0
          ? quantityValue
          : this.convertContractsToQuantity(symbol, contractsValue);
        const quantityLabel = Number.isFinite(actualQuantity) ? this.formatQuantity(actualQuantity) : "--";
        
        const contractsLabel = Number.isFinite(contractsValue) && contractsValue > 0
          ? t("tables.common.contractsWithUnit", { value: this.formatQuantity(contractsValue) })
          : "";
        const quantityCell = quantityLabel !== "--"
          ? t("tables.common.quantityWithSymbol", { value: quantityLabel, symbol })
          : "--";
        const entryPrice = this.formatPrice(pos.entryPrice);
        const markPrice = this.formatPrice(pos.currentPrice ?? pos.markPrice);
        const pnl = Number(pos.unrealizedPnl ?? pos.unrealisedPnl ?? 0);
        const pnlClass = pnl >= 0 ? "positive" : "negative";
        const pnlLabel = this.formatCurrency(pnl, 2, true);
        const openedAtRaw = pos.exchangeOpenedAt || pos.openedAt || pos.opened_at;
        const openedAt = openedAtRaw ? this.formatTime(openedAtRaw) : "--";
        const actionCell = showActions
          ? `<td class="position-action-cell">${symbol === "--" ? "--" : this.renderPositionActions(symbol, sideRaw)}</td>`
          : "";

        return `
          <tr class="position-row" data-symbol="${symbol}">
            <td class="text-primary">${symbolDisplay}</td>
            <td><span class="${sideClass}">${sideLabel}</span></td>
            <td${contractsLabel ? ` title="${contractsLabel}"` : ""}>${quantityCell}</td>
            <td>${entryPrice}</td>
            <td>${markPrice}</td>
            <td class="${pnlClass}">${this.formatCurrency(pnl, 2, true)}</td>
            <td>${openedAt}</td>
            ${actionCell}
          </tr>
        `;
      })
      .join("");

    this.resetCloseConfirmationState();
    this.positionsContainerEl.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>${t("tables.positions.headers.contract")}</th>
            <th>${t("tables.positions.headers.side")}</th>
            <th>${t("tables.positions.headers.quantity")}</th>
            <th>${t("tables.positions.headers.entryPrice")}</th>
            <th>${t("tables.positions.headers.markPrice")}</th>
            <th>${t("tables.positions.headers.unrealizedPnl")}</th>
            <th>${t("tables.positions.headers.openedAt")}</th>
            ${showActions ? `<th>${t("tables.positions.headers.actions")}</th>` : ""}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    this.updateTimestamp(this.positionsUpdatedEl, timestamp);

    if (newSymbolAdded) {
      this.schedulePriceSubscriptionUpdate();
    }

    // 添加持仓行点击事件
    this.positionsContainerEl.querySelectorAll(".position-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        // 如果点击的是操作按钮区域，不触发切换
        if (e.target.closest(".position-action-cell")) return;
        
        const symbol = row.dataset.symbol;
        if (symbol && symbol !== "--") {
          this.switchToSymbol(symbol);
        }
      });
    });
  }

  async loadOpenOrders() {
    const data = await this.fetchJson("/api/open-orders");
    if (!data) {
      console.warn("[loadOpenOrders] 获取挂单数据失败");
      return;
    }

    const { orders = [] } = data;
    console.log(`[loadOpenOrders] 加载了 ${orders.length} 个挂单`, orders);
    this.applyOpenOrdersData(orders);
  }

  applyOpenOrdersData(orders) {
    if (!this.openOrdersContainerEl) {
      return;
    }

    if (!orders.length) {
      const emptyLabel = this.escapeHtml(t("tables.openOrders.empty"));
      this.openOrdersContainerEl.innerHTML = `<p class="empty-state">${emptyLabel}</p>`;
      return;
    }

    const showActions = Boolean(this.isAuthenticated);
    const headerLabels = {
      symbol: this.escapeHtml(t("tables.openOrders.headers.symbol")),
      side: this.escapeHtml(t("tables.openOrders.headers.side")),
      type: this.escapeHtml(t("tables.openOrders.headers.type")),
      price: this.escapeHtml(t("tables.openOrders.headers.price")),
      quantity: this.escapeHtml(t("tables.openOrders.headers.quantity")),
      filled: this.escapeHtml(t("tables.openOrders.headers.filled")),
      remaining: this.escapeHtml(t("tables.openOrders.headers.remaining")),
      createdAt: this.escapeHtml(t("tables.openOrders.headers.createdAt")),
      actions: this.escapeHtml(t("tables.openOrders.headers.actions")),
    };
    const rawCancelLabel = t("tables.openOrders.actions.cancel");
    const cancelLabel = this.escapeHtml(
      rawCancelLabel && rawCancelLabel !== "tables.openOrders.actions.cancel"
        ? rawCancelLabel
        : t("common.cancel") || "Cancel"
    );

    const rows = orders
      .map((order) => {
        const symbol = (order.symbol || "--").toUpperCase();
        const safeSymbol = this.escapeHtml(symbol);
        const side = (order.side || "").toLowerCase();
        const sideLabel = side === "buy" || side === "long"
          ? t("long")
          : side === "sell" || side === "short"
            ? t("short")
            : "--";
        const sideClass = side === "buy" || side === "long"
          ? "positive"
          : side === "sell" || side === "short"
            ? "negative"
            : "";
        const orderTypeRaw = order.orderType || "";
        const orderTypeLabel = this.escapeHtml(this.getOrderTypeLabel(orderTypeRaw));
        const priceLabel = this.escapeHtml(this.formatPrice(order.price));
        const quantityCell = this.renderOrderQuantityCell(symbol, Number(order.quantity), Number(order.contracts));
        const filledCell = this.renderOrderQuantityCell(symbol, Number(order.filled), Number(order.filledContracts));
        const remainingCell = this.renderOrderQuantityCell(symbol, Number(order.remaining), Number(order.remainingContracts));
        const createTime = order.createTime ? this.escapeHtml(this.formatTime(order.createTime)) : "--";
        const orderId = order.orderId || "";
        const actionCell = showActions
          ? `<td><button type="button" class="btn-ghost btn-ghost-danger cancel-order-btn" data-order-id="${this.escapeHtml(orderId)}" data-symbol="${safeSymbol}">${cancelLabel}</button></td>`
          : "";

        return `
          <tr>
            <td class="text-primary">${safeSymbol}</td>
            <td><span class="${sideClass}">${this.escapeHtml(sideLabel)}</span></td>
            <td>${orderTypeLabel}</td>
            <td>${priceLabel}</td>
            <td>${quantityCell}</td>
            <td>${filledCell}</td>
            <td>${remainingCell}</td>
            <td>${createTime}</td>
            ${actionCell}
          </tr>
        `;
      })
      .join("");

    this.openOrdersContainerEl.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>${headerLabels.symbol}</th>
            <th>${headerLabels.side}</th>
            <th>${headerLabels.type}</th>
            <th>${headerLabels.price}</th>
            <th>${headerLabels.quantity}</th>
            <th>${headerLabels.filled}</th>
            <th>${headerLabels.remaining}</th>
            <th>${headerLabels.createdAt}</th>
            ${showActions ? `<th>${headerLabels.actions}</th>` : ""}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    // 添加取消订单按钮点击事件
    this.openOrdersContainerEl.querySelectorAll(".cancel-order-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const orderId = btn.dataset.orderId;
        const symbol = btn.dataset.symbol;
        
        btn.disabled = true;
        const cancellingLabel = t("tables.openOrders.actions.cancelling") || "Cancelling...";
        btn.textContent = cancellingLabel;

        try {
          await this.cancelOrder(orderId, symbol);
          this.showToast(
            "success",
            t("tables.openOrders.actions.cancelSuccessTitle"),
            t("tables.openOrders.actions.cancelSuccessMessage", { orderId })
          );
          // 刷新挂单列表
          await this.loadOpenOrders();
        } catch (error) {
          console.error("[cancel-order] 取消订单失败:", error);
          this.showToast(
            "error",
            t("tables.openOrders.actions.cancelErrorTitle") || t("notifications.loadFailedTitle"),
            error?.message || t("tables.openOrders.actions.cancelErrorMessage")
          );
          btn.disabled = false;
          btn.textContent = t("tables.openOrders.actions.cancel") || "Cancel";
        }
      });
    });
  }

  async cancelOrder(orderId, symbol) {
    const csrfToken = window.csrfManager ? window.csrfManager.getToken() : "";
    const response = await fetch("/api/cancel-order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      credentials: "same-origin",
      body: JSON.stringify({ orderId, symbol }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  }

  renderPositionActions(symbol, sideRaw) {
    const safeSymbol = this.escapeHtml(symbol);
    const safeSide = this.escapeHtml(sideRaw || "");
    const isPending = this.pendingPositionClosures.has(symbol);
    const mainLabel = t(isPending ? "tables.positions.actions.closing" : "tables.positions.actions.close");
    const confirmMessage = this.escapeHtml(t("tables.positions.actions.confirm", { symbol }) || "");
    const confirmLabel = this.escapeHtml(
      t("tables.positions.actions.confirmButton") || t("common.confirm") || "Confirm"
    );
    const cancelLabel = this.escapeHtml(
      t("tables.positions.actions.cancelButton") || t("common.cancel") || "Cancel"
    );
    const disabledAttr = isPending ? "disabled" : "";
    return `
      <button type="button" class="btn-ghost btn-ghost-danger close-position-btn" data-symbol="${safeSymbol}" data-side="${safeSide}" ${disabledAttr}>${mainLabel}</button>
      <div class="close-confirmation-popover" role="alert" aria-hidden="true" data-symbol="${safeSymbol}">
        <p class="close-confirmation-text">${confirmMessage}</p>
        <div class="close-confirmation-actions">
          <button type="button" class="link-button cancel-close-btn">${cancelLabel}</button>
          <button type="button" class="btn-danger btn-small confirm-close-btn" data-symbol="${safeSymbol}" ${disabledAttr}>${confirmLabel}</button>
        </div>
      </div>
    `;
  }

  handlePositionsContainerClick(event) {
    if (!event) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    if (this.positionsContainerEl && this.positionsContainerEl.contains(target)) {
      const confirmButton = target.closest(".confirm-close-btn");
      if (confirmButton) {
        event.preventDefault();
        event.stopPropagation();
        const symbol = confirmButton.getAttribute("data-symbol");
        if (!symbol) {
          return;
        }
        if (!this.isAuthenticated) {
          this.showToast("warning", t("tables.positions.actions.errorTitle"), t("tables.positions.actions.loginRequired"));
          this.hideCloseConfirmation(symbol);
          return;
        }
        this.hideCloseConfirmation(symbol);
        void this.executeClosePosition(symbol.toUpperCase());
        return;
      }

      const cancelButton = target.closest(".cancel-close-btn");
      if (cancelButton) {
        event.preventDefault();
        event.stopPropagation();
        const popover = cancelButton.closest(".close-confirmation-popover");
        const symbol = popover?.getAttribute("data-symbol");
        this.hideCloseConfirmation(symbol ? symbol.toUpperCase() : null);
        return;
      }

      const button = target.closest(".close-position-btn");
      if (!button || !this.positionsContainerEl.contains(button)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const symbol = button.getAttribute("data-symbol");
      if (!symbol || button.disabled) {
        return;
      }
      this.toggleCloseConfirmation(symbol.toUpperCase());
    }
  }

  toggleCloseConfirmation(symbol) {
    if (!symbol) {
      return;
    }
    if (this.activeCloseConfirmationSymbol === symbol) {
      this.hideCloseConfirmation(symbol);
    } else {
      this.showCloseConfirmation(symbol);
    }
  }

  showCloseConfirmation(symbol) {
    if (!symbol || this.pendingPositionClosures.has(symbol)) {
      return;
    }
    if (this.activeCloseConfirmationSymbol && this.activeCloseConfirmationSymbol !== symbol) {
      this.setCloseConfirmationVisibility(this.activeCloseConfirmationSymbol, false);
    }
    this.setCloseConfirmationVisibility(symbol, true);
    this.adjustCloseConfirmationPosition(symbol);
    this.activeCloseConfirmationSymbol = symbol;
    document.addEventListener("click", this.handleCloseConfirmationOutsideClick, true);
    document.addEventListener("keydown", this.handleCloseConfirmationKeydown, true);
    if (typeof window !== "undefined") {
      window.addEventListener("resize", this.handleCloseConfirmationResize, true);
    }
  }

  hideCloseConfirmation(symbol = null) {
    const targetSymbol = symbol || this.activeCloseConfirmationSymbol;
    if (!targetSymbol) {
      this.resetCloseConfirmationState();
      return;
    }
    this.setCloseConfirmationVisibility(targetSymbol, false);
    if (!symbol || symbol === this.activeCloseConfirmationSymbol) {
      this.resetCloseConfirmationState();
    }
  }

  getCloseActionWrapper(symbol) {
    if (!this.positionsContainerEl || !symbol) {
      return null;
    }
    const selectorSymbol = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(symbol)
      : symbol.replace(/"/g, '\\"');
    const btn = this.positionsContainerEl.querySelector(`.close-position-btn[data-symbol="${selectorSymbol}"]`);
    return btn ? btn.closest('td') : null;
  }

  setCloseConfirmationVisibility(symbol, visible) {
    const wrapper = this.getCloseActionWrapper(symbol);
    if (!wrapper) {
      return;
    }
    const popover = wrapper.querySelector(".close-confirmation-popover");
    if (!popover) {
      return;
    }
    if (visible) {
      popover.classList.add("is-visible");
      popover.setAttribute("aria-hidden", "false");
    } else {
      popover.classList.remove("is-visible", "popover-align-right", "popover-top");
      popover.setAttribute("aria-hidden", "true");
    }
  }

  repositionActiveCloseConfirmation() {
    if (!this.activeCloseConfirmationSymbol) {
      return;
    }
    this.adjustCloseConfirmationPosition(this.activeCloseConfirmationSymbol);
  }

  adjustCloseConfirmationPosition(symbol) {
    if (!symbol) {
      return;
    }
    const wrapper = this.getCloseActionWrapper(symbol);
    if (!wrapper) {
      return;
    }
    const popover = wrapper.querySelector(".close-confirmation-popover");
    if (!popover || !popover.classList.contains("is-visible")) {
      return;
    }

    const applyPosition = () => {
      popover.classList.remove("popover-align-right", "popover-top");
      const rect = popover.getBoundingClientRect();
      const docElement = document.documentElement;
      const viewportWidth = (docElement && docElement.clientWidth) || window.innerWidth || 0;
      const viewportHeight = (docElement && docElement.clientHeight) || window.innerHeight || 0;

      const overflowRight = rect.right > viewportWidth - 8;
      const overflowBottom = rect.bottom > viewportHeight - 8;

      if (overflowRight) {
        popover.classList.add("popover-align-right");
      }

      if (overflowBottom) {
        popover.classList.add("popover-top");
      }
    };

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(applyPosition);
    } else {
      applyPosition();
    }
  }

  onDocumentClickForCloseConfirmation(event) {
    if (!this.activeCloseConfirmationSymbol) {
      return;
    }
    const wrapper = this.getCloseActionWrapper(this.activeCloseConfirmationSymbol);
    if (!wrapper) {
      this.resetCloseConfirmationState();
      return;
    }
    const target = event.target instanceof Node ? event.target : null;
    if (target && wrapper.contains(target)) {
      return;
    }
    this.hideCloseConfirmation();
  }

  resetCloseConfirmationState() {
    this.activeCloseConfirmationSymbol = null;
    document.removeEventListener("click", this.handleCloseConfirmationOutsideClick, true);
    document.removeEventListener("keydown", this.handleCloseConfirmationKeydown, true);
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.handleCloseConfirmationResize, true);
    }
  }

  async executeClosePosition(symbol) {
    if (!symbol) {
      return;
    }
    if (!this.isAuthenticated) {
      this.showToast("warning", t("tables.positions.actions.errorTitle"), t("tables.positions.actions.loginRequired"));
      return;
    }
    if (this.pendingPositionClosures.has(symbol)) {
      return;
    }

    this.pendingPositionClosures.add(symbol);
    this.updateCloseButtonState(symbol, true);

    try {
      const response = await fetch(`/api/positions/${encodeURIComponent(symbol)}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ percentage: 100 }),
      });

      if (response.status === 401) {
        this.isAuthenticated = false;
        this.updateAuthUI();
        if (window.csrfManager && typeof window.csrfManager.resetToken === "function") {
          window.csrfManager.resetToken();
        }
        this.showToast("warning", t("tables.positions.actions.errorTitle"), t("tables.positions.actions.loginRequired"));
        void this.loadPositions();
        return;
      }

      const result = await response.json().catch(() => ({}));
      if (response.ok && result && result.success !== false) {
        this.showToast("success", t("tables.positions.actions.successTitle"), t("tables.positions.actions.successMessage", { symbol }));
        await this.loadPositions();
      } else {
        const reason = typeof result?.message === "string" && result.message.trim()
          ? result.message.trim()
          : typeof result?.error === "string" && result.error.trim()
            ? result.error.trim()
            : t("tables.positions.actions.errorDefault");
        this.showToast("error", t("tables.positions.actions.errorTitle"), reason);
      }
    } catch (error) {
      console.error("[positions] close request failed", error);
      this.showToast("error", t("tables.positions.actions.errorTitle"), t("tables.positions.actions.errorDefault"));
    } finally {
      this.pendingPositionClosures.delete(symbol);
      this.updateCloseButtonState(symbol, false);
    }
  }

  updateCloseButtonState(symbol, isPending) {
    if (!this.positionsContainerEl) {
      return;
    }
    const selector = `.close-position-btn[data-symbol="${symbol}"]`;
    const buttons = this.positionsContainerEl.querySelectorAll(selector);
    const nextLabel = t(isPending ? "tables.positions.actions.closing" : "tables.positions.actions.close");
    buttons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      button.disabled = Boolean(isPending);
      button.textContent = nextLabel;
    });

    const confirmSelector = `.confirm-close-btn[data-symbol="${symbol}"]`;
    const confirmButtons = this.positionsContainerEl.querySelectorAll(confirmSelector);
    const confirmLabel = t(
      isPending ? "tables.positions.actions.closing" : "tables.positions.actions.confirmButton"
    ) || (isPending ? nextLabel : t("common.confirm"));
    confirmButtons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      button.disabled = Boolean(isPending);
      button.textContent = confirmLabel;
    });
  }

  async loadTrades() {
    const data = await this.fetchJson("/api/trades?limit=20");
    if (!data || !this.tradesContainerEl) return;

    const { trades = [] } = data;

    let newSymbolAdded = false;
    trades.forEach((trade) => {
      if (trade?.symbol) {
        const added = this.addAvailableSymbol(String(trade.symbol).toUpperCase());
        if (added) {
          newSymbolAdded = true;
        }
      }
    });

    if (newSymbolAdded) {
      this.schedulePriceSubscriptionUpdate();
    }

    if (!trades.length) {
      this.tradesContainerEl.innerHTML = `<p class="empty-state">${t("tables.trades.empty")}</p>`;
      this.removeViewAllLink(this.tradesViewAllLink);
      return;
    }

    const rows = trades
      .map((trade) => {
        const symbol = String(trade.symbol).toUpperCase();
        const leverage = trade.leverage ? `${trade.leverage}x` : "";
        const symbolDisplay = leverage 
          ? `<span class="symbol-name">${symbol}</span> <span class="leverage-label">${leverage}</span>` 
          : `<span class="symbol-name">${symbol}</span>`;
        const sideRaw = String(trade.side || "").toLowerCase();
        const sideLabel = sideRaw === "long"
          ? t("long")
          : sideRaw === "short"
            ? t("short")
            : "--";
        const sideClass = sideRaw === "long" ? "positive" : sideRaw === "short" ? "negative" : "";
        const typeKey = typeof trade.type === "string" ? trade.type.toLowerCase() : "";
        let typeLabel = typeKey ? t(`tables.trades.types.${typeKey}`) : "";
        if (!typeLabel || typeLabel === `tables.trades.types.${typeKey}`) {
          typeLabel = trade.type || "--";
        }
        const pnl = typeof trade.pnl === "number" ? trade.pnl : null;
        const pnlClass = pnl !== null ? (pnl >= 0 ? "positive" : "negative") : "";
        const pnlLabel = pnl !== null ? this.formatCurrency(pnl, 2, true) : "--";
        const price = this.formatPrice(trade.price);
        const timestamp = this.formatTime(trade.timestamp);
        const quantityValue = Number(trade.quantity);
        const contractsValue = Number(trade.contracts);
        const actualQuantity = Number.isFinite(quantityValue) && quantityValue > 0
          ? quantityValue
          : this.convertContractsToQuantity(symbol, contractsValue);
        const hasQuantity = Number.isFinite(actualQuantity) && actualQuantity !== 0;
        const hasContracts = Number.isFinite(contractsValue) && contractsValue > 0;
        const quantityFormatted = hasQuantity ? this.formatQuantity(actualQuantity) : null;
        const contractsFormatted = hasContracts ? this.formatQuantity(contractsValue) : null;
        let quantityCell = "--";
        let quantityTitle = "";

        if (quantityFormatted) {
          quantityCell = t("tables.common.quantityWithSymbol", { value: quantityFormatted, symbol });
          quantityTitle = quantityCell;
        }

        if (contractsFormatted) {
          const contractText = t("tables.common.contractsWithUnit", { value: contractsFormatted });
          if (quantityCell === "--") {
            quantityCell = contractText;
            quantityTitle = contractText;
          } else {
            quantityTitle = contractText;
          }
        }

        return `
          <tr>
            <td class="text-primary">${symbolDisplay}</td>
            <td>${typeLabel}</td>
            <td><span class="${sideClass}">${sideLabel}</span></td>
            <td>${price}</td>
            <td${quantityTitle ? ` title="${quantityTitle}"` : ""}>${quantityCell}</td>
            <td class="${pnlClass}">${pnlLabel}</td>
            <td>${timestamp}</td>
          </tr>
        `;
      })
      .join("");

    this.tradesContainerEl.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>${t("tables.trades.headers.contract")}</th>
            <th>${t("tables.trades.headers.type")}</th>
            <th>${t("tables.trades.headers.side")}</th>
            <th>${t("tables.trades.headers.price")}</th>
            <th>${t("tables.trades.headers.quantity")}</th>
            <th>${t("tables.trades.headers.pnl")}</th>
            <th>${t("tables.trades.headers.time")}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    this.appendViewAllLink(this.tradesContainerEl, this.tradesViewAllLink);
  }

  async loadTradeLogs() {
    const data = await this.fetchJson("/api/trade-logs?limit=20");
    if (!data || !this.logsContainerEl) return;

    const { logs = [] } = data;

    if (!logs.length) {
      this.logsContainerEl.innerHTML = `<p class="empty-state">${t("tables.logs.empty")}</p>`;
      this.removeViewAllLink(this.logsViewAllLink);
      return;
    }

    const rows = logs
      .map((log, index) => {
        const action = log.action || "--";
        const symbol = log.symbol ? String(log.symbol).toUpperCase() : "--";
        const statusRaw = typeof log.status === "string" ? log.status : "";
        const statusKey = statusRaw.toLowerCase();
        let statusLabel = statusKey ? t(`tables.logs.status.${statusKey}`) : "";
        if (!statusLabel || statusLabel === `tables.logs.status.${statusKey}`) {
          statusLabel = statusRaw || t("tables.logs.status.unknown");
        }
        const statusClass = statusKey === "success" ? "" : ["error", "failed", "failure"].includes(statusKey) ? "negative" : "";
        const timestamp = log.createdAt ? this.formatTime(log.createdAt) : "--";

        return `
          <tr data-log-index="${index}">
            <td>${timestamp}</td>
            <td class="text-primary">${symbol}</td>
            <td>${action}</td>
            <td><span class="${statusClass}">${statusLabel}</span></td>
          </tr>
        `;
      })
      .join("");

    this.logsContainerEl.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>${t("tables.logs.headers.time")}</th>
            <th>${t("tables.logs.headers.contract")}</th>
            <th>${t("tables.logs.headers.action")}</th>
            <th>${t("tables.logs.headers.status")}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    // 点击查看详情
    this.logsContainerEl.querySelectorAll("tbody tr").forEach((row, index) => {
      row.addEventListener("click", () => {
        this.showLogDetail(logs[index]);
      });
    });

    this.appendViewAllLink(this.logsContainerEl, this.logsViewAllLink);
  }

  getDecisionRequestSummaryText(request) {
    const baseCandidates = [
      typeof request?.responseSummary === "string" ? request.responseSummary : null,
      typeof request?.response === "string" ? request.response : null,
      typeof request?.errorMessage === "string" ? request.errorMessage : null,
    ];
    const base = baseCandidates.find((text) => text && text.trim() !== "") || "";
    if (!base) {
      return t("decisionRequest.summaryLabel");
    }
    const normalized = base.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return t("decisionRequest.summaryLabel");
    }
    if (normalized.length <= 180) {
      return normalized;
    }
    return `${normalized.slice(0, 177)}…`;
  }

  async loadDecisionRequests() {
    if (!this.decisionLogsContainerEl) return;
    const timestamp = Date.now();
    const data = await this.fetchJson(`/api/decision-requests?limit=10&_t=${timestamp}`);
    const rawRequests = Array.isArray(data?.requests)
      ? data.requests
      : Array.isArray(data?.logs)
        ? data.logs
        : [];

    const requests = rawRequests.map((item) => ({
      ...item,
      modelName: item.modelName ?? item.model ?? item.model_name ?? null,
      status: item.status ?? item.state ?? item.result ?? null,
      errorMessage: item.errorMessage ?? item.error ?? item.error_message ?? null,
      outputDurationMs: item.outputDurationMs ?? item.durationMs ?? item.output_duration_ms ?? null,
    }));

    if (!requests.length) {
      this.decisionLogsContainerEl.innerHTML = `<p class="empty-state">${t("decisionRequest.empty")}</p>`;
      this.removeViewAllLink(this.decisionRequestsViewAllLink);
      return;
    }

    const rows = requests
      .map((request, index) => {
        const timestampLabel = request.createdAt ? this.formatTime(request.createdAt) : "--";
        const modelLabel = request.modelName ? this.escapeHtml(String(request.modelName)) : "--";
        const summary = this.escapeHtml(this.getDecisionRequestSummaryText(request));
        const durationLabel = this.formatOutputDuration(request.outputDurationMs);

        return `
          <tr data-decision-request-index="${index}">
            <td>${timestampLabel}</td>
            <td>${modelLabel}</td>
            <td>${summary}</td>
            <td>${durationLabel}</td>
          </tr>
        `;
      })
      .join("");

    this.decisionLogsContainerEl.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>${t("tables.decisionRequests.headers.time")}</th>
            <th>${t("tables.decisionRequests.headers.model")}</th>
            <th>${t("tables.decisionRequests.headers.summary")}</th>
            <th>${t("tables.decisionRequests.headers.duration")}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    this.decisionLogsContainerEl.querySelectorAll("tbody tr").forEach((row) => {
      const index = Number(row.dataset.decisionRequestIndex);
      if (Number.isInteger(index)) {
        row.addEventListener("click", () => {
          this.showDecisionRequestDetail(requests[index]);
        });
      }
    });

    this.appendViewAllLink(this.decisionLogsContainerEl, this.decisionRequestsViewAllLink);
  }

  async loadDecisions() {
    // 添加时间戳参数强制刷新，避免缓存
    const timestamp = Date.now();
    const data = await this.fetchJson(`/api/logs?limit=10&_t=${timestamp}`);
    if (!data || !this.decisionListEl) return;

    const { logs = [] } = data;
    
    console.log(`[loadDecisions] 收到 ${logs.length} 条 AI 决策记录`);
    if (logs.length > 0) {
      console.log(`[loadDecisions] 最新决策:`, logs[0]);
    }

    if (!logs.length) {
      this.decisionListEl.innerHTML = `<p class="empty-state">${t("decision.empty")}</p>`;
      this.setText(this.decisionUpdatedEl, "--");
      this.removeViewAllLink(this.decisionsViewAllLink);
      return;
    }

    const latest = logs[0];
    if (latest?.timestamp) {
      this.setText(this.decisionUpdatedEl, this.formatTime(latest.timestamp));
    }

    const html = logs
      .map((log, index) => {
        const timestamp = log.timestamp ? this.formatTime(log.timestamp) : "--";

        const actionsData = this.parseActionsData(log);
        const summaryHtml = this.generateDecisionSummary(actionsData, { rich: true });

        const iteration = log.iteration ? `#${log.iteration}` : "";

        return `
          <div class="decision-item" data-decision-index="${index}">
            <div class="decision-header">
              <span class="decision-time">${timestamp} ${iteration}</span>
            </div>
            <div class="decision-info">
              <span class="decision-summary">${summaryHtml}</span>
            </div>
          </div>
        `;
      })
      .join("");

    this.decisionListEl.innerHTML = html;
    this.appendViewAllLink(this.decisionListEl, this.decisionsViewAllLink);

    console.log(`[loadDecisions] 已更新 AI 决策列表，显示 ${logs.length} 条记录`);
    // 点击查看详情
    this.decisionListEl.querySelectorAll(".decision-item").forEach((item, index) => {
      item.addEventListener("click", () => {
        this.showDecisionDetail(logs[index]);
      });
    });
  }

  parseActionsData(log) {
    let actions = [];
    try {
      if (log.actionsTaken) {
        const parsed = typeof log.actionsTaken === "string"
          ? JSON.parse(log.actionsTaken)
          : log.actionsTaken;
        if (Array.isArray(parsed)) {
          actions = parsed;
          console.log(`[parseActionsData] 解析到 ${actions.length} 条交易动作:`, parsed);
        }
      }
    } catch (error) {
      console.warn("[parseActionsData] 解析 actionsTaken 失败:", error);
    }

    const normalized = actions
      .map((item) => this.normalizeTradeAction(item))
      .filter(Boolean);

    if (normalized.length > 0) {
      console.log(`[parseActionsData] 标准化后 ${normalized.length} 条:`, normalized);
      return normalized;
    }

    if (log.actionsTaken) {
      console.log("[parseActionsData] actions_taken 字段存在但未解析到有效交易动作", log.actionsTaken);
    } else {
      console.log("[parseActionsData] 本周期未写入 actions_taken，视为无实际交易");
    }

    return [];
  }

  normalizeTradeAction(rawAction) {
    if (!rawAction || typeof rawAction !== "object") {
      return null;
    }

    const messageRaw = this.getFirstNonEmpty(rawAction, [
      "message",
      "details",
      "detail",
      "info",
      "note",
      "reason",
      "response.message",
      "response.details",
      "response.info",
      "response.reason",
    ]);
    const message = messageRaw !== undefined && messageRaw !== null ? String(messageRaw) : "";

    const timestamp = this.normalizeTimestampValue(
      this.getFirstNonEmpty(rawAction, [
        "timestamp",
        "createdAt",
        "created_at",
        "response.timestamp",
        "response.createdAt",
        "response.created_at",
      ]),
    );

    const actionRaw = this.getFirstNonEmpty(rawAction, [
      "action",
      "type",
      "request.action",
      "response.action",
    ]);
    let actionName = actionRaw !== undefined && actionRaw !== null ? String(actionRaw) : "";

    const statusRaw = this.getFirstNonEmpty(rawAction, ["status", "response.status"]);
    const status = statusRaw !== undefined && statusRaw !== null ? String(statusRaw).trim() || "unknown" : "unknown";

    const orderIdRaw = this.getFirstNonEmpty(rawAction, [
      "orderId",
      "order_id",
      "response.orderId",
      "response.order_id",
    ]);
    const orderId = orderIdRaw !== undefined && orderIdRaw !== null ? String(orderIdRaw).trim() || null : null;

    const symbolRaw = this.getFirstNonEmpty(rawAction, [
      "symbol",
      "contract",
      "instrument",
      "pair",
      "ticker",
      "market",
      "response.symbol",
      "response.contract",
      "request.symbol",
    ]);
    let symbol = this.normalizeSymbol(symbolRaw);
    if (!symbol && message) {
      const inferredSymbol = this.extractSymbol(message);
      if (inferredSymbol) {
        symbol = inferredSymbol;
      }
    }
    if (!symbol && actionName) {
      const inferredFromAction = this.extractSymbol(actionName);
      if (inferredFromAction) {
        symbol = inferredFromAction;
      }
    }

    const sideCandidate = this.getFirstNonEmpty(rawAction, [
      "side",
      "direction",
      "positionSide",
      "position_side",
      "response.side",
      "response.positionSide",
      "request.side",
    ]);
    let side = typeof sideCandidate === "string" ? this.extractSide(sideCandidate) : null;
    if (!side && message) {
      side = this.extractSide(message);
    }
    if (!side && actionName) {
      side = this.extractSide(actionName);
    }

    let leverage = this.parseNumeric(
      this.getFirstNonEmpty(rawAction, [
        "leverage",
        "response.leverage",
        "request.leverage",
      ]),
    );
    if (leverage === null && message) {
      const leverageMatch = message.match(/杠杆\s*([\-\d.,]+)/i) || message.match(/(\d+(?:\.\d+)?)x/i);
      if (leverageMatch) {
        leverage = this.parseNumeric(leverageMatch[1] ?? leverageMatch[0]);
      }
    }

    let amountUsdt = this.parseNumeric(
      this.getFirstNonEmpty(rawAction, [
        "amountUsdt",
        "amount_usdt",
        "margin",
        "notional",
        "notionalUsd",
        "response.amountUsdt",
        "response.margin",
        "request.amountUsdt",
      ]),
    );
    if (amountUsdt === null && message) {
      const marginMatch = message.match(/保证金\s*([\-\d.,]+)/i) || message.match(/金额\s*([\-\d.,]+)/i);
      if (marginMatch) {
        amountUsdt = this.parseNumeric(marginMatch[1]);
      }
    }

    let size = this.parseNumeric(
      this.getFirstNonEmpty(rawAction, [
        "size",
        "quantity",
        "qty",
        "volume",
        "contracts",
        "contractAmount",
        "contract_amount",
        "response.size",
        "response.quantity",
        "response.filledSize",
        "request.size",
      ]),
    );
    if (size === null && message) {
      const sizeMatch = message.match(/(\d+(?:\.\d+)?)\s*[张个]/i) || message.match(/数量[：:]\s*(\d+(?:\.\d+)?)/i);
      if (sizeMatch) {
        size = this.parseNumeric(sizeMatch[1]);
      } else {
        const extracted = this.extractQuantity(message);
        if (extracted) {
          size = this.parseNumeric(extracted);
        }
      }
    }

    if (!actionName) {
      if (side === "long" || side === "short") {
        actionName = "open";
      } else if (side === "close") {
        actionName = "close";
      }
    }
    if (!actionName && message) {
      if (/撤单|cancel/i.test(message)) {
        actionName = "cancel";
      } else if (/调整|adjust/i.test(message)) {
        actionName = "adjust";
      }
    }

    return {
      timestamp,
      action: actionName || "",
      symbol: symbol || null,
      side: side || null,
      leverage,
      amountUsdt,
      size,
      status,
      message,
      orderId,
    };
  }

  getFirstNonEmpty(source, paths) {
    if (!source || typeof source !== "object") {
      return undefined;
    }
    for (const path of paths) {
      const value = this.getNestedValue(source, path);
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value === "string" && value.trim() === "") {
        continue;
      }
      return value;
    }
    return undefined;
  }

  getNestedValue(source, path) {
    if (!source || typeof source !== "object") {
      return undefined;
    }
    if (!path) {
      return undefined;
    }
    const segments = Array.isArray(path) ? path : String(path).split(".");
    let current = source;
    for (const segment of segments) {
      if (!current || typeof current !== "object" || !(segment in current)) {
        return undefined;
      }
      current = current[segment];
    }
    return current;
  }

  normalizeSymbol(value) {
    if (value === undefined || value === null) {
      return null;
    }
    const text = String(value).trim().toUpperCase();
    if (!text) {
      return null;
    }
    if (text.includes("/")) {
      return text.split("/")[0];
    }
    if (text.includes("_")) {
      return text.split("_")[0];
    }
    const match = text.match(/([A-Z0-9]+)(?:[-_]?(USDT|USD|USDC|PERP|SWAP))?$/);
    if (match && match[1]) {
      return match[1];
    }
    return text;
  }

  parseNumeric(value) {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "bigint") {
      return Number(value);
    }
    if (typeof value === "string") {
      const cleaned = value.replace(/,/g, "");
      const match = cleaned.match(/-?\d+(?:\.\d+)?/);
      if (match) {
        const parsed = Number.parseFloat(match[0]);
        return Number.isFinite(parsed) ? parsed : null;
      }
    }
    return null;
  }

  normalizeTimestampValue(value) {
    if (value === undefined || value === null) {
      return null;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return null;
      }
      const ms = value > 1e12 ? value : value * 1000;
      return new Date(ms).toISOString();
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed || null;
    }
    return null;
  }

  generateDecisionSummary(actions, options = {}) {
    const { rich = false, stats: providedStats } = options;

    if (!actions || actions.length === 0) {
      return t("tables.decisions.actions.watching");
    }

    const stats = providedStats ?? this.computeActionStats(actions);
    const safe = (value) => (rich ? this.escapeHtml(String(value)) : String(value));

    const buildParts = (bucket) => {
      const parts = [];

      for (const [symbol, values] of bucket.symbols.entries()) {
        const symbolLabel = safe(symbol);
        let detail = "";
        if (values.size > 0) {
          // 将合约张数转换为实际数量
          const quantity = this.convertContractsToQuantity(symbol, values.size);
          detail = safe(this.formatQuantity(quantity));
        } else if (values.amount > 0) {
          detail = safe(`${this.formatCurrency(values.amount, 0)} USDT`);
        }
        parts.push(detail ? `${symbolLabel} ${detail}` : symbolLabel);
      }

      if (!parts.length && (bucket.totalSize > 0 || bucket.totalAmount > 0)) {
        let totalDetail = "";
        if (bucket.totalSize > 0) {
          // 总数无法精确转换（因为不知道是哪个币种），保留张数显示
          totalDetail = safe(`${this.formatQuantity(bucket.totalSize)} ${t("tables.common.contracts")}`);
        } else if (bucket.totalAmount > 0) {
          totalDetail = safe(`${this.formatCurrency(bucket.totalAmount, 0)} USDT`);
        }
        const totalLabel = safe(t("tables.common.total") || "总计");
        parts.push(totalDetail ? `${totalLabel} ${totalDetail}` : totalLabel);
      }

      return parts;
    };

    const longParts = buildParts(stats.long);
    const shortParts = buildParts(stats.short);
    const sections = [];

    if (stats.long.count > 0 && (longParts.length || stats.long.totalSize > 0 || stats.long.totalAmount > 0)) {
      const label = rich ? `<span class="decision-tag-long">${t("tables.decisions.actions.long")}</span>` : t("tables.decisions.actions.long");
      sections.push(longParts.length ? `${label} ${longParts.join("，")}` : label);
    }

    if (stats.short.count > 0 && (shortParts.length || stats.short.totalSize > 0 || stats.short.totalAmount > 0)) {
      const label = rich ? `<span class="decision-tag-short">${t("tables.decisions.actions.short")}</span>` : t("tables.decisions.actions.short");
      sections.push(shortParts.length ? `${label} ${shortParts.join("，")}` : label);
    }

    if (stats.close.count > 0) {
      const closeParts = buildParts(stats.close);
      const label = rich ? `<span class="decision-tag-close">${t("tables.decisions.actions.close")}</span>` : t("tables.decisions.actions.close");
      sections.push(closeParts.length ? `${label} ${closeParts.join("，")}` : label);
    }

    if (!sections.length) {
      return t("tables.decisions.actions.watching");
    }

    return sections.join("；");
  }

  computeActionStats(actions) {
    const createBucket = () => ({ symbols: new Map(), totalSize: 0, totalAmount: 0, count: 0 });
    const stats = {
      long: createBucket(),
      short: createBucket(),
      close: createBucket(),
    };

    actions.forEach((action) => {
      if (!action || typeof action !== "object") {
        return;
      }

      const actionText = action.action || "";
      const messageText = action.message || "";
      const actionLower = actionText.toLowerCase();
      const sideRaw = typeof action.side === "string" ? action.side.toLowerCase() : null;

      const messageSignalsClose = /close|平仓|平多|平空|减仓|清仓|exit/i.test(messageText);
      const actionSignalsClose = /close|reduce|exit/i.test(actionLower);

      let side = null;

      if (actionSignalsClose || sideRaw === "close" || (!actionLower && messageSignalsClose)) {
        side = "close";
      }

      if (!side && (sideRaw === "long" || sideRaw === "short")) {
        side = sideRaw;
      }

      if (!side) {
        const derivedFromAction = this.extractSide(actionText);
        if (derivedFromAction === "long" || derivedFromAction === "short") {
          side = derivedFromAction;
        } else if (derivedFromAction === "close") {
          side = "close";
        }
      }

      if (!side) {
        const derivedFromMessage = this.extractSide(messageText);
        if (derivedFromMessage === "long" || derivedFromMessage === "short") {
          side = derivedFromMessage;
        } else if (derivedFromMessage === "close" || messageSignalsClose) {
          side = "close";
        }
      }

      if (!side || !stats[side]) {
        return;
      }

      const target = stats[side];
      target.count += 1;

      const symbol = action.symbol ? String(action.symbol).toUpperCase() : null;
      const sizeValue = Number(action.size);
      const amountValue = Number(action.amountUsdt);
      const hasSize = Number.isFinite(sizeValue) && sizeValue !== 0;
      const hasAmount = Number.isFinite(amountValue) && amountValue !== 0;

      // 调试日志：检查 size 和 amountUsdt 的值
      if (symbol && (hasSize || hasAmount)) {
        console.log(`[computeActionStats] ${side} ${symbol}: size=${action.size} (${typeof action.size}), amountUsdt=${action.amountUsdt} (${typeof action.amountUsdt}), hasSize=${hasSize}, hasAmount=${hasAmount}`);
      }

      if (symbol) {
        if (!target.symbols.has(symbol)) {
          target.symbols.set(symbol, { size: 0, amount: 0 });
        }
        const symbolStats = target.symbols.get(symbol);
        if (hasSize) {
          const absSize = Math.abs(sizeValue);
          symbolStats.size += absSize;
          target.totalSize += absSize;
        }
        if (hasAmount) {
          const absAmount = Math.abs(amountValue);
          symbolStats.amount += absAmount;
          target.totalAmount += absAmount;
        }
      } else {
        if (hasSize) {
          target.totalSize += Math.abs(sizeValue);
        }
        if (hasAmount) {
          target.totalAmount += Math.abs(amountValue);
        }
      }
    });

    return stats;
  }

  extractSymbol(text) {
    // 扩展币种匹配模式
    const match = text.match(/\b(BTC|ETH|SOL|BNB|XRP|DOGE|BCH|ADA|MATIC|LINK|UNI|AVAX|DOT|SHIB)\b/i);
    return match ? match[1].toUpperCase() : null;
  }

  extractSide(text) {
    if (text === undefined || text === null) {
      return null;
    }

    const source = typeof text === "string" ? text : String(text);

    // 先识别平仓相关描述，避免“平仓做多”被误判为做多
    if (/平仓|平多|平空|close|减仓|清仓/i.test(source)) return "close";
    if (/做多|long|买入|开多|buy|多单|开仓.*多/i.test(source)) return "long";
    if (/做空|short|卖出|开空|sell|空单|开仓.*空/i.test(source)) return "short";
    return null;
  }

  extractQuantity(text) {
    // 匹配多种数量表达方式
    const patterns = [
      /数量[：:]\s*(\d+\.?\d*)/i,
      /(\d+\.?\d*)\s*[张个]/i,
      /持仓[：:]\s*(\d+\.?\d*)/i,
      /开仓.*?(\d+\.?\d*)\s*[张个]/i
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }
    
    return null;
  }

  showDecisionDetail(log) {
    const modal = document.getElementById("decision-modal");
    const detailEl = document.getElementById("decision-detail");
    if (!modal || !detailEl) return;

  const rawContent = log.decision || log.actionsTaken || t("tables.common.noContent");
    const htmlContent = window.marked ? window.marked.parse(rawContent) : this.escapeHtml(rawContent).replace(/\n/g, "<br>");

    const timestamp = log.timestamp ? this.formatTime(log.timestamp) : "--";
    const iteration = typeof log.iteration === "number" ? `#${log.iteration}` : "--";
    const positions = typeof log.positionsCount === "number" ? `${log.positionsCount}` : "--";
    const accountValue = typeof log.accountValue === "number" ? this.formatCurrency(log.accountValue) : "--";
    const actionsData = this.parseActionsData(log);

    let actionsSection = "";
    if (actionsData.length > 0) {
      const rows = actionsData
        .map((action, idx) => {
          const timestampLabel = action.timestamp ? this.formatTime(action.timestamp) : "--";
          const symbolLabel = action.symbol ? String(action.symbol).toUpperCase() : "--";
          const sideRaw = action.side ? String(action.side).toLowerCase() : "";
          const sideLabel = sideRaw === "long" ? t("tables.decisions.actions.long") : sideRaw === "short" ? t("tables.decisions.actions.short") : sideRaw === "close" ? t("tables.decisions.actions.close") : (action.action || action.type || "");
          const actionLabel = action.action ? String(action.action).toUpperCase() : "--";
          const leverageLabel = typeof action.leverage === "number" && Number.isFinite(action.leverage)
            ? `${action.leverage}x`
            : "--";
          const amountLabel = typeof action.amountUsdt === "number" && Number.isFinite(action.amountUsdt)
            ? this.formatCurrency(action.amountUsdt, 2)
            : "--";
          
          // 将张数转换为币数量
          const sizeValue = Number(action.size);
          const actualSize = Number.isFinite(sizeValue) && action.symbol
            ? this.convertContractsToQuantity(action.symbol, sizeValue)
            : sizeValue;
          const sizeLabel = Number.isFinite(actualSize)
            ? this.formatQuantity(actualSize)
            : "--";
          
          const statusRaw = action.status ? String(action.status) : "unknown";
          const statusLower = statusRaw.toLowerCase();
          const statusClass = statusLower === "success" ? "" : ["error", "failed", "failure", "negative"].includes(statusLower) ? "negative" : "";
          const messageTextRaw = action.message ? String(action.message) : "";
          const messageText = messageTextRaw ? this.escapeHtml(messageTextRaw) : "";
          const statusTitleAttr = messageText ? ` title="${messageText}"` : "";
          const statusLabel = statusLower === "unknown"
            ? "未记录"
            : this.escapeHtml(statusRaw);
          const orderIdLabel = action.orderId ? this.escapeHtml(String(action.orderId)) : "--";

          return `
            <tr>
              <td>${idx + 1}</td>
              <td>${timestampLabel}</td>
              <td>${symbolLabel}</td>
              <td>${sideLabel}</td>
              <td>${actionLabel}</td>
              <td>${leverageLabel}</td>
              <td>${amountLabel}</td>
              <td>${sizeLabel}</td>
              <td>${orderIdLabel}</td>
              <td><span class="${statusClass}"${statusTitleAttr}>${statusLabel}</span></td>
            </tr>
          `;
        })
        .join("");

      actionsSection = `
        <div class="decision-actions" style="margin-bottom: 16px;">
          <div class="log-detail-title" style="margin-bottom: 8px;">执行的交易动作</div>
          <div class="table-wrapper" style="max-height: 220px; overflow: auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>时间</th>
                  <th>合约</th>
                  <th>方向</th>
                  <th>动作</th>
                  <th>杠杆</th>
                  <th>保证金</th>
                  <th>数量</th>
                  <th>订单ID</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `;
    } else {
      actionsSection = `
        <div class="decision-actions" style="margin-bottom: 16px;">
          <div class="log-detail-title" style="margin-bottom: 4px;">执行的交易动作</div>
          <div style="font-size: 13px; color: var(--text-muted);">本周期未记录任何实际交易执行。</div>
        </div>
      `;
    }

    detailEl.innerHTML = `
      <div style="margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color);">
        <div style="display: flex; gap: 16px; font-size: 12px; color: var(--text-muted);">
          <span>迭代：${iteration}</span>
          <span>时间：${timestamp}</span>
          <span>持仓数：${positions}</span>
          <span>账户权益：${accountValue}</span>
        </div>
      </div>
      ${actionsSection}
      <div class="markdown">${htmlContent}</div>
    `;

    modal.classList.add("show");
  }

  showLogDetail(log) {
    const modal = this.logModal;
    const detailEl = this.logDetailEl;
    if (!modal || !detailEl) return;

    const stackedFromRecords = this.pushRecordsModalBehind();
    if (stackedFromRecords) {
      modal.dataset.stackedFromRecords = "true";
    } else if (modal.dataset?.stackedFromRecords) {
      delete modal.dataset.stackedFromRecords;
    }

    const timestamp = log.createdAt ? this.formatTime(log.createdAt) : "--";
    const symbolRaw = log.symbol ? String(log.symbol).toUpperCase() : "--";
    const symbolLabel = symbolRaw !== "--" ? this.escapeHtml(symbolRaw) : symbolRaw;
    const actionRaw = log.action ? String(log.action) : "--";
    const actionLabel = actionRaw !== "--" ? this.escapeHtml(actionRaw) : actionRaw;
    const statusRaw = typeof log.status === "string" && log.status.trim() !== "" ? log.status : "";
    const statusLower = statusRaw.toLowerCase();
    const statusClass = statusLower === "success" ? "" : ["error", "failed", "failure"].includes(statusLower) ? "negative" : "";
    const statusTranslationKey = statusLower ? `tables.logs.status.${statusLower}` : "";
    let statusLabel = t(statusTranslationKey);
    if (!statusLabel || statusLabel === statusTranslationKey) {
      statusLabel = statusRaw || t("logDetail.statusUnknown");
    }

    const details = log.details || log.message || t("logDetail.noDetails");
    const detailText = this.formatStructuredText(details);
    const summaryText = detailText && detailText !== "--" ? detailText : t("logDetail.noDetails");

    const requestSection = this.buildLogRawSection(t("logDetail.rawRequest"), log.rawRequest);
    const responseSection = this.buildLogRawSection(t("logDetail.rawResponse"), log.rawResponse);
    const auxSection = this.buildLogRawSection(t("logDetail.rawMessage"), log.rawMessage || log.messageRaw);
    const rawSections = [requestSection, responseSection, auxSection].filter(Boolean).join("\n");

    const summaryTitle = this.escapeHtml(t("logDetail.summaryTitle"));
    const statusHtml = `<span class="${statusClass}">${this.escapeHtml(statusLabel)}</span>`;

    detailEl.innerHTML = `
      <div style="margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color);">
        <div style="display: flex; gap: 16px; font-size: 12px; color: var(--text-muted);">
          <span>${t("logDetail.time")}: ${timestamp}</span>
          <span>${t("logDetail.symbol")}: ${symbolLabel}</span>
          <span>${t("logDetail.action")}: ${actionLabel}</span>
          <span>${t("logDetail.status")}: ${statusHtml}</span>
        </div>
      </div>
      <div>
        <div class="log-detail-block">
          <div class="log-detail-title">${summaryTitle}</div>
          <pre class="log-detail-text">${this.escapeHtml(summaryText)}</pre>
        </div>
        ${rawSections ? `<div class="log-raw-wrapper">${rawSections}</div>` : ""}
      </div>
    `;

    modal.classList.add("show");
  }

  renderDecisionRequestSection(title, content, options = {}) {
    const hasContent = typeof content === "string" && content.trim() !== "";
    const metaText = typeof options.meta === "string" && options.meta.trim() !== ""
      ? options.meta.trim()
      : "";
    const metaHtml = metaText ? `<span class="section-meta">${this.escapeHtml(metaText)}</span>` : "";
    if (!hasContent) {
      return `
        <div class="decision-request-section">
          <div class="section-title">${this.escapeHtml(title)}${metaHtml}</div>
          <div class="decision-request-summary">${t("tables.common.noContent")}</div>
        </div>
      `;
    }

    return `
      <div class="decision-request-section">
        <div class="section-title">${this.escapeHtml(title)}${metaHtml}</div>
        <pre class="code-block">${this.escapeHtml(content)}</pre>
      </div>
    `;
  }

  showDecisionRequestDetail(request) {
    if (!this.decisionRequestModal || !this.decisionRequestDetailEl) {
      return;
    }

    const stackedFromRecords = this.pushRecordsModalBehind();
    if (stackedFromRecords) {
      this.decisionRequestModal.dataset.stackedFromRecords = "true";
    } else if (this.decisionRequestModal.dataset?.stackedFromRecords) {
      delete this.decisionRequestModal.dataset.stackedFromRecords;
    }

    const timestamp = request?.createdAt ? this.formatTime(request.createdAt) : "--";
    const iterationValue = Number(request?.iteration);
    const iteration = Number.isFinite(iterationValue) ? `#${iterationValue}` : "--";
    const modelName = request?.modelName ? this.escapeHtml(String(request.modelName)) : "--";
    const statusKey = typeof request?.status === "string" ? request.status.toLowerCase() : "unknown";
    const statusLabelKey = `decisionRequest.status.${statusKey}`;
    let statusLabel = t(statusLabelKey);
    if (!statusLabel || statusLabel === statusLabelKey) {
      statusLabel = request?.status || t("decisionRequest.status.unknown");
    }
    const statusClass = statusKey === "error" ? "decision-request-status negative" : "decision-request-status";
    const errorMessage = request?.errorMessage && String(request.errorMessage).trim() !== ""
      ? this.escapeHtml(String(request.errorMessage))
      : "";

    const durationDisplay = this.formatOutputDuration(request?.outputDurationMs);
    const durationMeta = durationDisplay !== "--"
      ? t("decisionRequest.detail.durationLabel", { value: durationDisplay })
      : "";

    const sections = [
      this.renderDecisionRequestSection(t("decisionRequest.detail.instructions"), request?.instructions || ""),
      this.renderDecisionRequestSection(t("decisionRequest.detail.prompt"), request?.prompt || ""),
      this.renderDecisionRequestSection(t("decisionRequest.detail.response"), request?.response || "", {
        meta: durationMeta,
      }),
    ].join("");

    const errorSection = errorMessage
      ? `
        <div class="decision-request-section">
          <div class="section-title">${t("decisionRequest.detail.error")}</div>
          <div class="decision-request-summary">${errorMessage}</div>
        </div>
      `
      : "";

    this.decisionRequestDetailEl.innerHTML = `
      <div class="decision-request-meta">
        <span>${t("decisionRequest.detail.time")}：${timestamp}</span>
        <span>${t("decisionRequest.detail.iteration")}：${iteration}</span>
        <span>${t("decisionRequest.detail.model")}：${modelName}</span>
        <span>${t("decisionRequest.detail.status")}：<span class="${statusClass}">${this.escapeHtml(statusLabel)}</span></span>
      </div>
      ${errorSection}
      ${sections}
    `;

    this.decisionRequestModal.classList.add("show");
  }

  async loadPrices() {
    if (!this.symbolListEl) return;

    const symbols = Array.from(this.availableSymbols);
    if (!symbols.length) return;

    const query = encodeURIComponent(symbols.join(","));
    const data = await this.fetchJson(`/api/prices?symbols=${query}`);
    if (!data || !data.prices) {
      this.renderSymbolList();
      return;
    }

    const rawEntries = Array.isArray(data.prices)
      ? data.prices
      : Object.entries(data.prices).map(([symbol, payload]) => {
          if (payload && typeof payload === "object" && !Array.isArray(payload)) {
            return {
              symbol,
              price: payload.price,
              delta: payload.delta,
              percent: payload.percent,
            };
          }
          return { symbol, price: payload };
        });

    this.applyPriceData(rawEntries, Date.now());
  }

  applyPriceData(rawEntries, timestamp) {
    const entries = Array.isArray(rawEntries) ? rawEntries : [];
    if (!entries.length) {
      return false;
    }

    let updated = false;
    let newSymbolAdded = false;

    entries.forEach((entry) => {
      if (!entry) {
        return;
      }

      const rawSymbol = "symbol" in entry ? entry.symbol : null;
      if (typeof rawSymbol !== "string") {
        return;
      }

      const symbol = rawSymbol.trim().toUpperCase();
      if (!symbol) {
        return;
      }

      if (!this.availableSymbols.has(symbol)) {
        this.availableSymbols.add(symbol);
        newSymbolAdded = true;
      }

      const rawPrice = entry.price ?? entry.last ?? entry.value;
      const numericPrice = Number(rawPrice);
      if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
        return;
      }

      const previous = this.prices.get(symbol);
      this.prices.set(symbol, numericPrice);

      let deltaValue = entry.delta;
      if (deltaValue === undefined || deltaValue === null || !Number.isFinite(Number(deltaValue))) {
        if (Number.isFinite(previous)) {
          deltaValue = numericPrice - Number(previous);
        } else {
          deltaValue = null;
        }
      }

      let percentValue = entry.percent;
      if (percentValue === undefined || percentValue === null || !Number.isFinite(Number(percentValue))) {
        const prevNumeric = Number(previous);
        if (Number.isFinite(prevNumeric) && prevNumeric !== 0) {
          percentValue = ((numericPrice - prevNumeric) / prevNumeric) * 100;
        } else {
          percentValue = null;
        }
      }

      if (deltaValue === null) {
        this.priceDeltas.delete(symbol);
      } else {
        this.priceDeltas.set(symbol, Number(deltaValue));
      }

      if (percentValue === null) {
       
        this.priceChanges.delete(symbol);
      } else {
        this.priceChanges.set(symbol, Number(percentValue));
      }

      updated = true;
    });

    if (updated || newSymbolAdded) {
      this.renderSymbolList();
    }

    if (updated) {
      this.updateTimestamp(this.pricesUpdatedEl, timestamp);
    }

    if (newSymbolAdded) {
      this.schedulePriceSubscriptionUpdate();
    }

    return updated;
  }

  async loadCandles(symbol) {
    const normalizedSymbol = typeof symbol === "string" ? symbol.toUpperCase() : this.activeSymbol;

    if (!this.candleSeries) {
      console.warn("K线序列未初始化");
      if (normalizedSymbol) {
        this.pendingCandleSymbol = normalizedSymbol;
      }
      return;
    }

    if (!normalizedSymbol) {
      console.warn("K线加载缺少有效的币种标识");
      return;
    }

    this.resubscribeCandleStream();

    const intervalKey = typeof this.activeInterval === "string" ? this.activeInterval : DEFAULT_INTERVAL;
    const cacheKey = this.getCandleCacheKey(normalizedSymbol, intervalKey);
    const cached = this.latestCandleSnapshots?.get(cacheKey);
    if (cached && Array.isArray(cached.candles) && cached.candles.length > 0) {
      console.log(`[kline] 使用缓存的 ${normalizedSymbol} ${intervalKey} K线快照`);
      this.applyCandlesData(normalizedSymbol, intervalKey, cached.candles);
      return;
    }

    console.log(`正在加载 ${symbol} ${this.activeInterval} 的K线数据...`);
    const data = await this.fetchJson(
      `/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${this.activeInterval}&limit=${CANDLE_LIMIT}`
    );
    
    if (!data || !Array.isArray(data.candles)) {
      console.warn(`${symbol} K线数据无效:`, data);
      return;
    }

    console.log(`收到 ${data.candles.length} 条原始K线数据`);
    const candles = this.transformCandles(data.candles);
    
    if (!candles.length) {
      console.warn(`${symbol} 转换后的K线数据为空`);
      this.candleSeries.setData([]);
      this.candleSeries.setMarkers([]);
      return;
    }

    console.log(`转换后有 ${candles.length} 条有效K线数据`);
    this.cacheCandlesSnapshot(normalizedSymbol, intervalKey, candles, Date.now());
    this.applyCandlesData(normalizedSymbol, intervalKey, candles);
    
    console.log(`${normalizedSymbol} K线数据加载完成`);
  }

  transformCandles(raw) {
    return raw
      .map((entry) => {
        // OKX 客户端返回格式: {t: timestamp(ms), o, h, l, c, v}
        if (entry && typeof entry === "object") {
          const time = Number(entry.t || entry.timestamp || entry.time);
          return {
            time: Number.isFinite(time) ? Math.floor(time / 1000) : undefined, // 转换为秒时间戳
            open: Number(entry.o || entry.open),
            high: Number(entry.h || entry.high),
            low: Number(entry.l || entry.low),
            close: Number(entry.c || entry.close),
          };
        }

        // 兼容数组格式: [timestamp, open, high, low, close, ...]
        if (Array.isArray(entry)) {
          const [ts, open, high, low, close] = entry;
          const time = Number(ts);
          return {
            time: Number.isFinite(time) ? Math.floor(time / 1000) : undefined,
            open: Number(open),
            high: Number(high),
            low: Number(low),
            close: Number(close),
          };
        }

        return null;
      })
      .filter((item) => item && Number.isInteger(item.time) && this.isValidCandle(item))
      .sort((a, b) => a.time - b.time);
  }

  isValidCandle(candle) {
    return ["open", "high", "low", "close"].every((key) => Number.isFinite(candle[key]));
  }

  async loadTradeMarkers(symbol, rangeStart, rangeEnd) {
    if (!this.candleSeries) return;

    const hasValidRange =
      Number.isInteger(rangeStart) &&
      Number.isInteger(rangeEnd) &&
      rangeEnd >= rangeStart;

    if (!hasValidRange) {
      console.warn(`当前 ${symbol} 的K线范围无效，跳过交易标记`);
      this.candleSeries.setMarkers([]);
      return;
    }

    // 获取该币种的所有交易记录（限制500条以避免性能问题）
    const data = await this.fetchJson(`/api/trades?symbol=${encodeURIComponent(symbol)}&limit=500`);
    if (!data || !Array.isArray(data.trades)) {
      console.warn(`无法加载 ${symbol} 的交易标记`);
      return;
    }

  const markers = [];
  const trades = data.trades;
  const symbolUpper = String(symbol || "").toUpperCase();
    
    // 构建开仓记录映射，用于计算平仓百分比
    const openTrades = new Map();
    
    for (const trade of trades) {
      const timestamp = trade.timestamp ? new Date(trade.timestamp).getTime() / 1000 : null;
      if (!timestamp || !Number.isInteger(timestamp)) continue;
      if (timestamp < rangeStart || timestamp > rangeEnd) {
        // 超出当前K线范围的历史交易标记不展示
        continue;
      }

      const side = String(trade.side || "").toLowerCase();
      const type = String(trade.type || "").toLowerCase();
      const quantityValue = Number(trade.quantity);
      const contractsValue = Number(trade.contracts);
      const multiplierValue = Number(trade.contractMultiplier);
      const baseQuantity = Number.isFinite(quantityValue)
        ? quantityValue
        : Number.isFinite(contractsValue) && Number.isFinite(multiplierValue)
          ? contractsValue * multiplierValue
          : Number.NaN;
      const quantityLabel = Number.isFinite(baseQuantity) ? this.formatQuantity(baseQuantity) : "--";
      const contractsLabel = Number.isFinite(contractsValue) && contractsValue > 0 ? this.formatQuantity(contractsValue) : null;
      const quantityDisplay = quantityLabel !== "--"
        ? t("tables.common.quantityWithSymbol", { value: quantityLabel, symbol: symbolUpper })
        : contractsLabel
          ? t("tables.common.contractsWithUnit", { value: contractsLabel })
          : "";
      const leverageValue = Number.isFinite(Number(trade.leverage)) && Number(trade.leverage) > 0
        ? Number(trade.leverage)
        : 1;
      const priceLabel = Number.isFinite(Number(trade.price)) ? this.formatPrice(trade.price) : "--";
      const sideLabel = side === "long" ? t("long") : side === "short" ? t("short") : "";
      const markerTextParts = [];
      if (sideLabel) markerTextParts.push(sideLabel);
      if (quantityDisplay) markerTextParts.push(quantityDisplay);
      if (priceLabel !== "--") markerTextParts.push(`@${priceLabel}`);
      const markerText = markerTextParts.length ? markerTextParts.join(" ") : sideLabel || t("chart.markers.trade");
      
      // 开仓标记（做多/做空）
      if (type === "open" || type === "entry") {
        // 保存开仓记录用于计算平仓百分比
        const key = `${side}_${timestamp}`;
        openTrades.set(key, {
          price: trade.price,
          quantity: Number.isFinite(baseQuantity) ? baseQuantity : null,
          contracts: Number.isFinite(contractsValue) ? contractsValue : null,
          contractMultiplier: Number.isFinite(multiplierValue) ? multiplierValue : null,
          leverage: leverageValue,
          timestamp: timestamp,
        });
        
        markers.push({
          time: timestamp,
          position: side === "long" ? "belowBar" : "aboveBar",
          color: side === "long" ? "#22c55e" : "#ef4444",
          shape: side === "long" ? "arrowUp" : "arrowDown",
          text: markerText,
        });
      }
      
      // 平仓标记
      if (type === "close" || type === "exit") {
        const pnl = Number(trade.pnl);
        const isProfitable = !Number.isNaN(pnl) && pnl > 0;
        
        // 计算盈亏百分比
        let pnlText = "";
        if (!Number.isNaN(pnl)) {
          // 尝试找到对应的开仓订单计算百分比
          let pnlPercent = null;
          
          // 查找最近的同方向开仓订单
          let closestOpenTrade = null;
          let minTimeDiff = Number.POSITIVE_INFINITY;
          
          for (const [key, openTrade] of openTrades.entries()) {
            if (key.startsWith(`${side}_`)) {
              const timeDiff = Math.abs(timestamp - openTrade.timestamp);
              if (timeDiff < minTimeDiff && openTrade.timestamp < timestamp) {
                minTimeDiff = timeDiff;
                closestOpenTrade = openTrade;
              }
            }
          }
          
          if (closestOpenTrade) {
            // 开仓成本 = 价格 × 数量 / 杠杆
            const openQuantity = Number.isFinite(closestOpenTrade.quantity)
              ? closestOpenTrade.quantity
              : Number.isFinite(closestOpenTrade.contracts) && Number.isFinite(closestOpenTrade.contractMultiplier)
                ? closestOpenTrade.contracts * closestOpenTrade.contractMultiplier
                : null;
            const leverageForCalc = Number.isFinite(closestOpenTrade.leverage) && closestOpenTrade.leverage > 0
              ? closestOpenTrade.leverage
              : leverageValue;
            if (openQuantity !== null && Number.isFinite(openQuantity) && openQuantity > 0 && leverageForCalc > 0) {
              const openCost = (closestOpenTrade.price * openQuantity) / leverageForCalc;
              if (openCost > 0) {
                pnlPercent = (pnl / openCost) * 100;
              }
            }
          }
          
          // 构建显示文本
          const pnlSign = pnl > 0 ? "+" : "";
          const pnlValue = `${pnlSign}${pnl.toFixed(2)}`;
          if (pnlPercent !== null && Number.isFinite(pnlPercent)) {
            const pnlPercentValue = `${pnlSign}${pnlPercent.toFixed(2)}`;
            pnlText = t("chart.markers.closeWithPnlPercent", { pnl: pnlValue, percent: pnlPercentValue });
          } else {
            pnlText = t("chart.markers.closeWithPnl", { pnl: pnlValue });
          }
        } else {
          pnlText = t("chart.markers.close");
        }
        
        markers.push({
          time: timestamp,
          position: side === "long" ? "aboveBar" : "belowBar",
          color: isProfitable ? "#22c55e" : "#ef4444",
          shape: "circle",
          text: pnlText,
        });
      }
    }

    // 应用标记到图表
    this.candleSeries.setMarkers(markers);
    console.log(`已为 ${symbol} 添加 ${markers.length} 个交易标记`);
  }

  async fetchJson(url) {
    try {
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        if (this.isAuthenticated) {
          this.isAuthenticated = false;
          this.updateAuthUI();
        }
        if (window.csrfManager && typeof window.csrfManager.resetToken === "function") {
          window.csrfManager.resetToken();
        }
        console.warn(`请求 ${url} 未授权`);
        return null;
      }
      if (!response.ok) {
        console.error(`请求 ${url} 失败:`, response.status, response.statusText);
        return null;
      }
      const data = await response.json();
      if (data && typeof data.csrfToken === "string" && window.csrfManager && typeof window.csrfManager.setToken === "function") {
        window.csrfManager.setToken(data.csrfToken);
      }
      return data;
    } catch (error) {
      console.error(`请求 ${url} 异常:`, error);
      return null;
    }
  }

  setText(target, value) {
    const el = typeof target === "string" ? document.getElementById(target) : target;
    if (!el) return;
    el.textContent = value;
  }

  updateTimestamp(target, sourceTimestamp) {
    if (!target) return;
    const normalized = this.normalizeTimestamp(sourceTimestamp) ?? Date.now();
    const formatted = this.formatTime(normalized);
    if (formatted && formatted !== "--") {
      this.setText(target, formatted);
    }
  }

  normalizeTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.getTime();
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  formatCurrency(value, decimals = 2, withSign = false) {
    if (!Number.isFinite(value)) return "--";

    const safeDecimals = Number.isFinite(decimals) && decimals >= 0 ? Math.min(Math.floor(decimals), 8) : 2;

    const formatWithIntl = () => {
      const formatter = new Intl.NumberFormat("zh-CN", {
        minimumFractionDigits: safeDecimals,
        maximumFractionDigits: safeDecimals,
      });
      return formatter.format(Math.abs(value));
    };

    let formatted;
    try {
      formatted = formatWithIntl();
    } catch (error) {
      console.warn("[formatCurrency] Intl.NumberFormat fallback", { error, value, decimals });
      const normalized = Math.abs(value);
      formatted = safeDecimals > 0 ? normalized.toFixed(safeDecimals) : String(Math.trunc(normalized));
    }

    if (withSign) {
      if (value > 0) return `+${formatted}`;
      if (value < 0) return `-${formatted}`;
    }
    return formatted;
  }

  formatPrice(value) {
    if (!Number.isFinite(value)) return "--";
    const abs = Math.abs(value);
    const decimals = abs >= 100 ? 1 : abs >= 1 ? 2 : 4;
    return Number(value).toLocaleString("zh-CN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  formatPercent(value) {
    if (!Number.isFinite(value)) return "--";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  }

  formatQuantity(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "--";
    const absolute = Math.abs(numeric);
    const decimals = absolute >= 100 ? 2 : absolute >= 1 ? 4 : 6;
    return absolute.toLocaleString("zh-CN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    });
  }

  /**
   * 将OKX的合约张数转换为实际数量
   * @param {string} symbol - 币种符号，如 "BTC", "ETH"
   * @param {number} contracts - 合约张数
   * @returns {number} 实际数量
   */
  convertContractsToQuantity(symbol, contracts) {
    if (!symbol || !Number.isFinite(contracts)) {
      return contracts;
    }
    
    const multiplier = CONTRACT_MULTIPLIERS[symbol.toUpperCase()] || 1;
    return contracts * multiplier;
  }

  renderOrderQuantityCell(symbol, amount, contracts) {
    if (!symbol || !Number.isFinite(amount)) {
      return "--";
    }
    const absValue = Math.abs(amount);
    const quantityLabel = t("tables.common.quantityWithSymbol", {
      value: this.formatQuantity(absValue),
      symbol,
    });
    const safeQuantity = this.escapeHtml(quantityLabel);
    const tooltip = Number.isFinite(contracts) && Math.abs(contracts) > 0
      ? this.escapeHtml(
          t("tables.common.contractsWithUnit", { value: this.formatQuantity(Math.abs(contracts)) })
        )
      : "";
    return tooltip ? `<span title="${tooltip}">${safeQuantity}</span>` : safeQuantity;
  }

  getOrderTypeLabel(orderType) {
    if (!orderType) {
      return "--";
    }
    const normalized = String(orderType).toLowerCase().replace(/-/g, "_");
    const typeKeyMap = {
      market: "tables.openOrders.types.market",
      limit: "tables.openOrders.types.limit",
      post_only: "tables.openOrders.types.postOnly",
      postonly: "tables.openOrders.types.postOnly",
      fok: "tables.openOrders.types.fok",
      ioc: "tables.openOrders.types.ioc",
      conditional: "tables.openOrders.types.conditional",
      trigger: "tables.openOrders.types.conditional",
    };
    const key = typeKeyMap[normalized];
    if (key) {
      const translated = t(key);
      if (translated && translated !== key) {
        return translated;
      }
    }
    return String(orderType).toUpperCase();
  }

  getMarginModeLabel(mode) {
    if (!mode || typeof mode !== "string") {
      return "";
    }
    const normalized = mode.toLowerCase();
    const key = normalized === "isolated" || normalized === "cross" ? normalized : null;
    if (!key) {
      return "";
    }
    const i18nKey = `tables.positions.marginMode.${key}`;
    const translated = t(i18nKey);
    if (translated && translated !== i18nKey) {
      return translated;
    }
    if (key === "isolated") {
      return "Isolated ";
    }
    if (key === "cross") {
      return "Cross ";
    }
    return "";
  }

  formatStructuredText(value) {
    if (value === null || value === undefined) {
      return "--";
    }

    const text = typeof value === "string" ? value.trim() : String(value);
    if (!text) return "--";

    const formatted = this.tryFormatJson(text);
    if (formatted) {
      return formatted;
    }

    return text;
  }

  tryFormatJson(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const firstChar = trimmed[0];
    const lastChar = trimmed[trimmed.length - 1];

    const looksLikeObject = firstChar === "{" && lastChar === "}";
    const looksLikeArray = firstChar === "[" && lastChar === "]";

    if (!looksLikeObject && !looksLikeArray) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(parsed, null, 2);
    } catch (error) {
      console.warn("[format] JSON 解析失败", error);
      return null;
    }
  }

  buildLogRawSection(title, raw) {
    if (!raw) {
      return "";
    }

    const text = this.formatStructuredText(raw);
    if (!text || text === "--") {
      return "";
    }
    const escaped = this.escapeHtml(text);
    const summaryLabel = this.escapeHtml(title ?? "");

    return `
      <details class="log-raw">
        <summary>${summaryLabel}</summary>
        <pre class="log-raw-text">${escaped}</pre>
      </details>
    `;
  }

  setupAuthControls() {
    this.updateAuthUI();

    const bind = (element, handler) => {
      if (!element || typeof handler !== "function") return;
      element.addEventListener("click", (event) => {
        event.preventDefault();
        void handler.call(this, event);
      });
    };

    bind(this.accountBtn, this.openAccountModal);
    bind(this.settingsBtn, this.openSettingsModal);
    bind(this.tradingLoopToggle, this.handleTradingLoopToggle);

    if (this.logoutBtn) {
      this.logoutBtn.addEventListener("click", (event) => {
        event.preventDefault();
        void this.handleLogout();
      });
    }
  }

  bindSettingsForms() {
    if (this.accountForm) {
      this.accountForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void this.submitAccountForm();
      });
    }

    if (this.settingsForm) {
      this.settingsForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void this.submitSettingsForm();
      });

      // Base URL Preset Selector
      const baseUrlPreset = document.getElementById("base-url-preset");
      const baseUrlInput = document.getElementById("base-url-input");
      
      if (baseUrlPreset && baseUrlInput) {
        baseUrlPreset.addEventListener("change", (event) => {
          const selectedValue = event.target.value;
          if (selectedValue) {
            baseUrlInput.value = selectedValue;
          } else {
            // 选择自定义选项时清空输入框并获得焦点
            baseUrlInput.value = "";
            baseUrlInput.focus();
          }
        });

        // Set initial preset based on current input value
        baseUrlInput.addEventListener("input", () => {
          const currentValue = baseUrlInput.value.trim();
          const matchingOption = Array.from(baseUrlPreset.options).find(
            option => option.value && option.value === currentValue
          );
          if (matchingOption) {
            baseUrlPreset.value = matchingOption.value;
          } else {
            baseUrlPreset.value = "";
          }
        });
      }

      // Settings Tab Switching
      const settingsTabs = document.getElementById("settings-tabs");
      if (settingsTabs) {
        settingsTabs.addEventListener("click", (event) => {
          const btn = event.target.closest("[data-settings-tab]");
          if (!btn) return;

          const targetTab = btn.dataset.settingsTab;
          
          // Update tab buttons
          settingsTabs.querySelectorAll(".settings-tab-btn").forEach(b => {
            b.classList.remove("active");
          });
          btn.classList.add("active");

          // Update tab panels
          document.querySelectorAll("[data-settings-panel]").forEach(panel => {
            if (panel.dataset.settingsPanel === targetTab) {
              panel.classList.add("active");
            } else {
              panel.classList.remove("active");
            }
          });

          this.prepareSettingsTab(targetTab);
        });
      }
    }

    this.bindInstancesListEvents();
    this.bindInstanceFormEvents();

    if (this.accountCancelBtn) {
      this.accountCancelBtn.addEventListener("click", (event) => {
        event.preventDefault();
        this.hideModal(this.accountModal);
      });
    }

    if (this.instanceCancelBtn) {
      this.instanceCancelBtn.addEventListener("click", (event) => {
        event.preventDefault();
        this.hideModal(this.instanceFormModal);
      });
    }

    if (this.settingsCancelBtn) {
      this.settingsCancelBtn.addEventListener("click", (event) => {
        event.preventDefault();
        this.hideResetConfirmation();
        this.hideModal(this.settingsModal);
      });
    }
  }


  prepareSettingsTab(targetTab) {
    if (!targetTab) {
      return;
    }

    if (targetTab === "account") {
      this.bindAccountsListEvents();
      void this.loadAccountsList();
      return;
    }

    if (targetTab === "instances") {
      this.bindInstancesListEvents();
      void this.loadInstancesList();
      return;
    }

    if (targetTab === "ai") {
      this.bindAiModelAddButton();
      void this.loadAiModelsList();
    }
  }
  
  bindExchangeControls() {
    if (this.testOkxBtn) {
      this.testOkxBtn.addEventListener("click", (event) => {
        event.preventDefault();
        void this.testExchangeConnection("okx");
      });
    }

    if (this.testBinanceBtn) {
      this.testBinanceBtn.addEventListener("click", (event) => {
        event.preventDefault();
        void this.testExchangeConnection("binance");
      });
    }

    if (this.testAiBtn) {
      this.testAiBtn.addEventListener("click", (event) => {
        event.preventDefault();
        void this.testAiConnection();
      });
    }

    if (this.resetLiveDataBtn) {
      this.resetLiveDataBtn.addEventListener("click", (event) => {
        event.preventDefault();
        this.showResetConfirmation();
      });
    }

    if (this.resetLiveDataCancelBtn) {
      this.resetLiveDataCancelBtn.addEventListener("click", (event) => {
        event.preventDefault();
        this.hideResetConfirmation();
      });
    }

    if (this.resetLiveDataConfirmBtn) {
      this.resetLiveDataConfirmBtn.addEventListener("click", (event) => {
        event.preventDefault();
        void this.handleResetLiveData();
      });
    }

    if (!this.exchangeSelect) {
      return;
    }
    this.exchangeSelect.addEventListener("change", () => {
      this.updateExchangePanelVisibility();
    });
    this.updateExchangePanelVisibility();
  }

  updateExchangePanelVisibility() {
    if (!this.exchangeSelect) {
      return;
    }

    const provider = this.exchangeSelect.value || "okx";
    if (this.accountForm) {
      this.accountForm.dataset.exchangeProvider = provider;
    }

    if (this.exchangePanels && typeof this.exchangePanels.forEach === "function") {
      this.exchangePanels.forEach((panel) => {
        const target = panel.getAttribute("data-exchange-panel") || "okx";
        panel.classList.toggle("is-active", target === provider);
      });
    }
  }

  setupPrivacyControls() {
    if (!this.communityReportCheckbox || !this.communityShareCheckbox) {
      return;
    }

    this.communityReportCheckbox.addEventListener("change", () => {
      this.applyPrivacyDependencies();
    });
    this.applyPrivacyDependencies();
  }

  applyPrivacyDependencies() {
    if (!this.communityShareCheckbox) {
      return;
    }

    const shareGroup = this.communityShareCheckbox.closest(".form-group");
    const enabled = this.communityReportCheckbox?.checked ?? false;
    this.communityShareCheckbox.disabled = !enabled;
    if (shareGroup) {
      shareGroup.classList.toggle("is-disabled", !enabled);
    }
  }

  initAiModelOverlay() {
    if (this.aiOverlay) {
      return;
    }

    const container = this.klineChartEl?.parentElement;
    if (!container) {
      console.warn("[ai-overlay] 找不到 AI 控件容器，跳过渲染");
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "ai-model-overlay";

    const icon = document.createElement("img");
    icon.className = "ai-model-icon";
    icon.setAttribute("alt", t("chart.modelIconAlt"));
    icon.decoding = "async";
    icon.loading = "lazy";
    icon.src = DEFAULT_AI_ICON;
    icon.addEventListener("error", () => {
      const fallbackUrl = this.toAbsoluteUrl(DEFAULT_AI_ICON);
      if (icon.src !== fallbackUrl) {
        icon.src = DEFAULT_AI_ICON;
      }
    });

    const text = document.createElement("span");
    text.className = "ai-model-text";
    text.textContent = t("chart.modelBadge");

    overlay.append(icon, text);
    container.appendChild(overlay);

    this.aiOverlay = overlay;
    this.aiOverlayText = text;
    this.aiOverlayIcon = icon;

    // 添加点击事件处理器，支持手动触发 AI 决策（绑定到整个 overlay）
    overlay.addEventListener("click", () => this.handleManualAiExecution());

    // 根据登录状态设置点击行为
    this.updateAiOverlayClickable();
  }

  async fetchPublicModelInfo() {
    try {
      // 获取当前账户关联的实例信息
      const instanceResponse = await fetch("/api/public/instances-status", {
        cache: "no-store",
        credentials: "same-origin",
      });

      if (instanceResponse.ok) {
        const instanceData = await instanceResponse.json();
        // 如果有实例，使用其模型名称
        if (instanceData?.runningInstance?.ai_model_name) {
          const modelName = instanceData.runningInstance.ai_model_name;
          const status = instanceData.runningInstance.status;
          const publicConfig = { 
            AI_MODEL_NAME: modelName,
            _INSTANCE_STATUS: status
          };
          this.latestConfig = {
            ...(this.latestConfig ?? {}),
            ...publicConfig,
          };
          this.updateAiOverlay(publicConfig);
          await this.fetchPublicTradingLoopStatus();
          return;
        }
      }
    } catch (error) {
      console.warn("[ai-overlay] 获取模型信息失败", error);
    }
    
    // 同时获取交易循环状态以显示 AI overlay
    await this.fetchPublicTradingLoopStatus();
  }

  async fetchPublicTradingLoopStatus() {
    try {
      const response = await fetch("/api/public/trading-loop-status", {
        cache: "no-store",
        credentials: "same-origin",
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      if (data && typeof data.enabled === "boolean") {
        const isActive = Boolean(data.enabled && data.scheduled);
        this.updateAiOverlayVisibility(isActive);
      }
    } catch (error) {
      console.warn("[ai-overlay] 获取公开交易循环状态失败", error);
    }
  }

  async syncAuthState() {
    const previousState = this.isAuthenticated;
    try {
      const response = await fetch("/api/auth/status", {
        cache: "no-store",
        credentials: "same-origin",
      });

      if (!response.ok) {
        this.isAuthenticated = false;
        this.updateAuthUI();
        if (window.csrfManager && typeof window.csrfManager.resetToken === "function") {
          window.csrfManager.resetToken();
        }
        return;
      }

      const status = await response.json();
      this.isAuthenticated = Boolean(status && status.authenticated);

      if (this.isAuthenticated) {
        const languageChanged = await syncLanguagePreferenceFromBackend();
        if (languageChanged) {
          window.location.reload();
          return;
        }
      }

      if (this.isAuthenticated && status && typeof status.csrfToken === "string" && window.csrfManager && typeof window.csrfManager.setToken === "function") {
        window.csrfManager.setToken(status.csrfToken);
      }

      if (this.isAuthenticated) {
        this.instancesCacheLoaded = false;
        void this.fetchFullConfig(true); // 强制刷新完整配置，覆盖公开配置缓存
        void this.fetchTradingLoopStatus();
        void this.loadAccountsList();
        void this.refreshRunningTasksPanel(true);
      } else {
        this.accountsCache = [];
        this.instancesCache = [];
        this.instancesCacheLoaded = false;
        this.renderAllTasks([]);
        this.renderRunningTasks([]);
      }
      // 未登录时不调用 updateAiOverlay()，保持 fetchPublicModelInfo() 设置的模型信息
    } catch (error) {
      console.warn("[auth] 查询登录状态失败", error);
      this.isAuthenticated = false;
      // 认证失败时也不覆盖 fetchPublicModelInfo() 的结果
    }

    if (previousState !== this.isAuthenticated) {
      void this.loadPositions();
    }

    this.updateAuthUI();
  }

  updateAuthUI() {
    const shouldShow = Boolean(this.isAuthenticated);
    const toggle = (el) => {
      if (!el) return;
      el.classList.toggle("hidden", !shouldShow);
    };

    toggle(this.accountBtn);
    toggle(this.settingsBtn);
    toggle(this.logoutBtn);
    toggle(this.tradingLoopToggle);
    toggle(this.accountSwitcherEl);
    
    // Show/hide language selector based on authentication
    const languageSelector = document.getElementById('language-selector');
    if (languageSelector) {
      languageSelector.classList.remove("hidden");
      if (!shouldShow) {
        languageSelector.classList.remove("is-open");
      }
    }
    updateLanguageSelectorUI();

    if (!shouldShow) {
      this.toggleAccountSwitcher(false);
    }

    this.updateAccountSwitcherDisplay();

    // 更新 AI 图标的可点击状态
    this.updateAiOverlayClickable();

    // 更新侧边栏显示状态
    this.updateSidebarAuthVisibility();

    if (!shouldShow) {
      this.updateTradingLoopToggle(null);
      // 注意：不要隐藏 AI overlay，未登录用户也应该能看到状态更新
    }
  }

  updateSidebarAuthVisibility() {
    const sidebarTabs = document.querySelector(".sidebar-tabs.main-tabs");
    const manualView = document.getElementById("view-manual");
    const statsView = document.getElementById("view-stats");
    const manualTabBtn = document.querySelector('.tab-btn[data-tab="view-manual"]');
    const statsTabBtn = document.querySelector('.tab-btn[data-tab="view-stats"]');
    const viewSwitcher = document.querySelector(".view-switcher");
    const viewToggle = document.getElementById("view-mode-toggle");

    if (!this.isAuthenticated) {
      // 未登录：隐藏顶部 Tabs 和视图切换器，强制显示统计面板和交易视图
      if (sidebarTabs) sidebarTabs.style.display = "none";
      if (viewSwitcher) viewSwitcher.style.display = "none";
      
      // 确保在交易视图（非策略视图）
      if (viewToggle && viewToggle.checked) {
        viewToggle.checked = false;
        this.toggleStrategyView(false);
      }
      
      if (statsView) statsView.classList.add("active");
      if (manualView) manualView.classList.remove("active");
      
      if (statsTabBtn) statsTabBtn.classList.add("active");
      if (manualTabBtn) manualTabBtn.classList.remove("active");
    } else {
      // 已登录：显示顶部 Tabs 和视图切换器
      if (sidebarTabs) sidebarTabs.style.display = "";
      if (viewSwitcher) viewSwitcher.style.display = "";
      
      // 如果当前没有激活的视图，默认显示统计面板
      if (statsView && manualView && !statsView.classList.contains("active") && !manualView.classList.contains("active")) {
        statsView.classList.add("active");
        if (statsTabBtn) statsTabBtn.classList.add("active");
      }
    }
  }

  resetTradingLoopConfirmState() {
    if (this.tradingLoopConfirmTimer) {
      clearTimeout(this.tradingLoopConfirmTimer);
      this.tradingLoopConfirmTimer = null;
    }
    this.tradingLoopDisableConfirm = false;
    if (this.tradingLoopToggle) {
      this.tradingLoopToggle.classList.remove("confirm");
    }
  }

  updateTradingLoopToggle(state) {
    const toggleEl = this.tradingLoopToggle;
    if (!toggleEl) {
      return;
    }

    toggleEl.classList.remove("is-loading");
    this.resetTradingLoopConfirmState();

    if (!state || typeof state !== "object") {
      toggleEl.classList.add("is-paused");
      toggleEl.classList.remove("is-active", "is-running");
      toggleEl.dataset.active = "false";
      toggleEl.dataset.interval = "";
      toggleEl.dataset.status = "";
      const startTitle = t("chart.aiToggleStart");
      toggleEl.title = startTitle;
      toggleEl.setAttribute("aria-label", startTitle);
      toggleEl.dataset.tooltip = t("chart.tooltipStart");
      this.tradingLoopState = null;
      this.updateAiOverlayVisibility(false);
      return;
    }

    const normalized = {
      enabled: Boolean(state.enabled),
      scheduled: Boolean(state.scheduled),
      running: Boolean(state.running),
      intervalMinutes: Number.isFinite(state.intervalMinutes) ? Number(state.intervalMinutes) : null,
      lastExecutionStartedAt: state.lastExecutionStartedAt ?? null,
      lastExecutionFinishedAt: state.lastExecutionFinishedAt ?? null,
      lastExecutionTrigger: typeof state.lastExecutionTrigger === "string" ? state.lastExecutionTrigger : null,
      lastExecutionStatus: typeof state.lastExecutionStatus === "string" ? state.lastExecutionStatus : null,
    };

    this.tradingLoopState = normalized;

    const isActive = normalized.enabled && normalized.scheduled;
    toggleEl.classList.toggle("is-paused", !isActive);
    toggleEl.classList.toggle("is-active", isActive);
    toggleEl.classList.toggle("is-running", normalized.running === true);
    toggleEl.dataset.active = isActive ? "true" : "false";
    toggleEl.dataset.interval = normalized.intervalMinutes ? String(normalized.intervalMinutes) : "";
    toggleEl.dataset.status = normalized.lastExecutionStatus || "";

    const tooltipTitle = isActive ? t("chart.aiToggleStop") : t("chart.aiToggleStart");
    toggleEl.title = tooltipTitle;
    toggleEl.setAttribute("aria-label", tooltipTitle);
    toggleEl.dataset.tooltip = isActive ? t("chart.tooltipStop") : t("chart.tooltipStart");

    this.updateAiOverlayVisibility(isActive);
  }

  updateAiOverlayVisibility(isActive) {
    if (!this.aiOverlay) {
      return;
    }

    if (isActive) {
      this.aiOverlay.classList.remove("hidden");
    } else {
      this.aiOverlay.classList.add("hidden");
    }
  }

  updateAiOverlayClickable() {
    if (!this.aiOverlay) {
      return;
    }

    if (!this.isAuthenticated) {
      this.aiOverlay.classList.add("disabled");
      this.aiOverlay.style.cursor = "not-allowed";
      this.aiOverlay.title = t("chart.loginRequired");
    } else {
      this.aiOverlay.classList.remove("disabled");
      this.aiOverlay.style.cursor = "pointer";
      this.aiOverlay.title = t("chart.manualTrigger");
    }
  }

  async fetchTradingLoopStatus() {
    if (!this.isAuthenticated) {
      return;
    }

    try {
      const payload = await this.fetchJson("/api/trading-loop/status");
      if (!payload || typeof payload !== "object") {
        return;
      }
      if (payload.state) {
        this.updateTradingLoopToggle(payload.state);
      }
    } catch (error) {
      console.warn("[trading-loop] 获取状态失败", error);
    }
  }

  async handleTradingLoopToggle() {
    if (!this.isAuthenticated) {
      this.showToast("warning", "需要登录", "请先登录后台才能控制定时任务");
      return;
    }

    if (!this.tradingLoopToggle) {
      return;
    }

    if (this.tradingLoopToggle.classList.contains("is-loading")) {
      return;
    }

    if (!this.tradingLoopState) {
      await this.fetchTradingLoopStatus();
    }

    if (!this.tradingLoopState) {
      this.showToast("error", "状态未知", "暂时无法获取当前定时任务状态，请稍后重试");
      return;
    }

    const targetEnabled = !this.tradingLoopState.enabled;

    if (!targetEnabled) {
      if (!this.tradingLoopDisableConfirm) {
        this.tradingLoopDisableConfirm = true;
        if (this.tradingLoopToggle) {
          this.tradingLoopToggle.classList.add("confirm");
        }
        if (this.tradingLoopConfirmTimer) {
          clearTimeout(this.tradingLoopConfirmTimer);
        }
        this.tradingLoopConfirmTimer = window.setTimeout(() => {
          this.resetTradingLoopConfirmState();
        }, 5000);
        this.showToast("warning", "确认停止", "再次点击确认后，AI 自动交易将立即停止。");
        return;
      }
      this.resetTradingLoopConfirmState();
    } else {
      this.resetTradingLoopConfirmState();
    }

    this.tradingLoopToggle.classList.add("is-loading");

    try {
      const csrfToken = window.csrfManager ? window.csrfManager.getToken() : "";
      const response = await fetch("/api/trading-loop/state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "same-origin",
        body: JSON.stringify({ enabled: targetEnabled }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        const message = errorPayload && typeof errorPayload.error === "string" ? errorPayload.error : `HTTP ${response.status}`;
        throw new Error(message);
      }

      const payload = await response.json().catch(() => ({}));
      if (payload && payload.state) {
        this.updateTradingLoopToggle(payload.state);
      } else {
        await this.fetchTradingLoopStatus();
      }

      this.showToast(
        "success",
        targetEnabled ? "已启动 AI 定时任务" : "已暂停 AI 定时任务",
        targetEnabled ? "定时任务将在下一周期运行" : "系统将保持待机状态"
      );

      if (targetEnabled) {
        setTimeout(() => {
          if (this.isAuthenticated) {
            void this.fetchTradingLoopStatus();
          }
        }, 2500);
      }
    } catch (error) {
      console.error("[trading-loop] 切换失败", error);
      this.showToast(
        "error",
        "操作失败",
        error instanceof Error ? error.message : "切换定时任务状态失败，请稍后重试"
      );
      await this.fetchTradingLoopStatus();
    } finally {
      if (this.tradingLoopToggle) {
        this.tradingLoopToggle.classList.remove("is-loading");
      }
    }
  }

  /**
   * 连接 WebSocket
   */
  connectWebSocket() {
    // 构建 WebSocket URL
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/trading-status`;
    
    console.log("[websocket] 正在连接:", wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("[websocket] 连接成功");
        this.wsReconnectAttempts = 0;
        
        // 清除重连定时器
        if (this.wsReconnectTimer) {
          clearTimeout(this.wsReconnectTimer);
          this.wsReconnectTimer = null;
        }

        this.flushPendingWebSocketMessages();
        this.resubscribeAllStreams();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error("[websocket] 消息解析失败:", error);
        }
      };

      this.ws.onerror = (error) => {
        console.error("[websocket] 连接错误:", error);
      };

      this.ws.onclose = () => {
        console.log("[websocket] 连接关闭");
        this.ws = null;
        
        // 自动重连（最多重试 10 次）
        if (this.wsReconnectAttempts < 10) {
          this.wsReconnectAttempts++;
          const delay = Math.min(1000 * this.wsReconnectAttempts, 10000);
          console.log(`[websocket] ${delay}ms 后尝试重连（第 ${this.wsReconnectAttempts} 次）`);
          
          this.wsReconnectTimer = setTimeout(() => {
            this.connectWebSocket();
          }, delay);
        } else {
          console.error("[websocket] 重连次数已达上限，停止重连");
        }
      };
    } catch (error) {
      console.error("[websocket] 创建连接失败:", error);
    }
  }

  flushPendingWebSocketMessages() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    while (this.pendingWebSocketMessages.length > 0) {
      const message = this.pendingWebSocketMessages.shift();
      if (!message) {
        continue;
      }
      try {
        this.ws.send(message);
      } catch (error) {
        console.error("[websocket] 发送排队消息失败", error);
        break;
      }
    }
  }

  sendWebSocketMessage(payload, options = {}) {
    const message = JSON.stringify(payload);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(message);
      } catch (error) {
        console.error("[websocket] 发送消息失败", error, payload);
      }
      return;
    }

    if (options && options.prepend) {
      this.pendingWebSocketMessages.unshift(message);
    } else {
      this.pendingWebSocketMessages.push(message);
    }
  }

  resubscribeAllStreams() {
    this.sendPositionsSubscription();
    this.sendPriceSubscription();
    this.resubscribeCandleStream(true);
  }

  sendPositionsSubscription() {
    this.sendWebSocketMessage({ type: "subscribe_positions" });
  }

  sendPriceSubscription() {
    const symbols = Array.from(this.availableSymbols);
    if (!symbols.length) {
      return;
    }
    this.sendWebSocketMessage({
      type: "subscribe_prices",
      symbols,
    });
  }

  resubscribeCandleStream(force = false) {
    const symbol = this.activeSymbol;
    const interval = this.activeInterval;
    if (!symbol || !interval) {
      return;
    }

    const current = this.activeCandleSubscription;
    const isSame =
      current &&
      current.symbol === symbol &&
      current.interval === interval;

    if (!force && isSame) {
      return;
    }

    if (current && current.symbol && current.interval) {
      this.sendWebSocketMessage(
        {
          type: "unsubscribe_candles",
          symbol: current.symbol,
          interval: current.interval,
        },
        { prepend: true }
      );
    }

    this.sendWebSocketMessage({
      type: "subscribe_candles",
      symbol,
      interval,
      limit: CANDLE_LIMIT,
    });

    this.activeCandleSubscription = { symbol, interval };
  }

  getCandleCacheKey(symbol, interval) {
    return `${String(symbol || "").toUpperCase()}::${String(interval || "").toLowerCase()}`;
  }

  cacheCandlesSnapshot(symbol, interval, candles, timestamp) {
    if (!this.latestCandleSnapshots) {
      this.latestCandleSnapshots = new Map();
    }

    const key = this.getCandleCacheKey(symbol, interval);
    const clonedCandles = Array.isArray(candles)
      ? candles.map((entry) => this.normalizeSnapshotCandle(entry)).filter((item) => item !== null)
      : [];

    const resolvedTimestamp = this.normalizeTimestamp(timestamp) ?? Date.now();
    const isoTimestamp = new Date(resolvedTimestamp).toISOString();

    this.latestCandleSnapshots.set(key, {
      type: "candles_snapshot",
      timestamp: isoTimestamp,
      symbol: String(symbol || "").toUpperCase(),
      interval,
      candles: clonedCandles,
    });
  }

  applyCandlesData(symbol, interval, rawCandles) {
    if (!this.candleSeries) {
      return;
    }

    const candles = Array.isArray(rawCandles)
      ? rawCandles
          .map((entry) => this.normalizeSnapshotCandle(entry))
          .filter((item) => item !== null)
          .sort((a, b) => a.time - b.time)
      : [];

    if (!candles.length) {
      console.warn(`[kline] ${symbol} ${interval} K线数据为空`);
      this.candleSeries.setData([]);
      this.candleSeries.setMarkers([]);
      return;
    }

    this.candleSeries.setData(candles);

    const firstTime = candles[0]?.time;
    const lastTime = candles[candles.length - 1]?.time;

    if (Number.isInteger(firstTime) && Number.isInteger(lastTime)) {
      void this.loadTradeMarkers(symbol, firstTime, lastTime);
    }

    if (this.chart) {
      this.chart.timeScale().fitContent();
    }
  }

  normalizeSnapshotCandle(entry) {
    if (!entry) {
      return null;
    }

    const source = entry;
    const rawTime = Number(source.time ?? source.t ?? source.timestamp);
    const open = Number(source.open ?? source.o);
    const high = Number(source.high ?? source.h);
    const low = Number(source.low ?? source.l);
    const close = Number(source.close ?? source.c);

    if (![rawTime, open, high, low, close].every(Number.isFinite)) {
      return null;
    }

    let normalizedTime = Math.floor(rawTime);
    if (normalizedTime > 1_000_000_000_000) {
      normalizedTime = Math.floor(normalizedTime / 1000);
    }

    return {
      time: normalizedTime,
      open,
      high,
      low,
      close,
    };
  }

  handleWebSocketMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }

    const type = message.type;
    if (typeof type !== "string") {
      return;
    }

    if (type === "trading_status") {
      this.handleTradingStatusUpdate(message);
      return;
    }

    switch (type) {
      case "prices_update":
        this.handlePricesUpdate(message);
        break;
      case "positions_update":
        this.handlePositionsUpdate(message);
        break;
      case "candles_snapshot":
        this.handleCandlesSnapshot(message);
        break;
      case "instance_status":
        this.handleInstanceStatusMessage(message);
        break;
      case "pong":
        break;
      default:
        console.debug("[websocket] 未处理的消息类型", type, message);
    }
  }

  handlePricesUpdate(message) {
    if (!message || typeof message !== "object" || !Array.isArray(message.prices)) {
      return;
    }

    const timestamp = message.timestamp ?? undefined;
    this.applyPriceData(message.prices, timestamp);
  }

  handlePositionsUpdate(message) {
    if (!message || typeof message !== "object" || !Array.isArray(message.positions)) {
      return;
    }

    const timestamp = this.normalizeTimestamp(message.timestamp);
    this.applyPositionsData(message.positions, timestamp ?? Date.now());
  }

  handleCandlesSnapshot(message) {
    if (!message || typeof message !== "object" || !Array.isArray(message.candles)) {
      return;
    }

    const symbolRaw = message.symbol;
    const intervalRaw = message.interval;
    if (typeof symbolRaw !== "string" || typeof intervalRaw !== "string") {
      return;
    }

    const symbol = symbolRaw.toUpperCase();
    const interval = intervalRaw;

  this.cacheCandlesSnapshot(symbol, interval, message.candles, message.timestamp);

    const activeSymbol = String(this.activeSymbol || "").toUpperCase();
    const activeInterval = String(this.activeInterval || "").toLowerCase();
    const intervalKey = interval.toLowerCase();

    if (symbol !== activeSymbol || intervalKey !== activeInterval) {
      return;
    }

    this.applyCandlesData(symbol, interval, message.candles);
  }

  /**
   * 处理交易状态更新
   */
  handleTradingStatusUpdate(message) {
    if (message.type !== "trading_status") {
      return;
    }

    const { status, message: statusMessage, trigger, data } = message;
    const normalizedStatusMessage = typeof statusMessage === "string" ? statusMessage.trim() : "";
    
    console.log(`[websocket] 收到状态更新: ${status} - ${normalizedStatusMessage || ""} (${trigger || "unknown"})`, data);

    if (this.tradingLoopState) {
      const activeStatuses = new Set(["preparing", "collecting_data", "analyzing", "ai_deciding", "executing_trades"]);
      const nextState = { ...this.tradingLoopState };
      if (activeStatuses.has(status)) {
        nextState.running = true;
        nextState.lastExecutionStatus = null;
      } else if (status === "completed") {
        nextState.running = false;
        nextState.lastExecutionStatus = "success";
      } else if (status === "error") {
        nextState.running = false;
        nextState.lastExecutionStatus = "error";
      } else if (status === "idle") {
        nextState.running = false;
      }
      this.updateTradingLoopToggle(nextState);

      if (status === "completed" || status === "error") {
        setTimeout(() => {
          if (this.isAuthenticated) {
            void this.fetchTradingLoopStatus();
          }
        }, 1500);
      }
    }

    // 更新 AI Overlay 状态
    if (!this.aiOverlay || !this.aiOverlayText) {
      return;
    }

    // 状态文本映射
    const statusTextMap = {
      idle: t("aiOverlay.status.idle"),
      preparing: t("aiOverlay.status.preparing"),
      collecting_data: t("aiOverlay.status.collecting_data"),
      analyzing: t("aiOverlay.status.analyzing"),
      ai_deciding: t("aiOverlay.status.ai_deciding"),
      executing_trades: t("aiOverlay.status.executing_trades"),
      completed: t("aiOverlay.status.completed"),
      error: t("aiOverlay.status.error"),
    };

    const triggerTextMap = {
      manual: t("chart.triggerType.manual"),
      scheduled: t("chart.triggerType.scheduled"),
    };

    const parts = [];
    const translatedStatus = statusTextMap[status];
    if (translatedStatus) {
      parts.push(translatedStatus);
    }

    if (!translatedStatus && normalizedStatusMessage) {
      parts.push(normalizedStatusMessage);
    }

    if (trigger && triggerTextMap[trigger]) {
      parts.push(triggerTextMap[trigger]);
    }

    if (parts.length === 0) {
      if (normalizedStatusMessage) {
        parts.push(normalizedStatusMessage);
      } else if (typeof status === "string" && status) {
        parts.push(status);
      } else {
        parts.push(t("aiOverlay.statusFallback") || t("chart.modelBadge"));
      }
    }

    const displayText = parts.join(" · ");
    this.aiOverlayText.textContent = displayText;

    // 根据状态添加/移除 executing 类
    if (status === "idle" || status === "completed" || status === "error") {
      this.aiOverlay.classList.remove("executing");
      
      // completed 或 error 状态2秒后恢复默认文本
      if (status === "completed" || status === "error") {
        setTimeout(() => {
          if (this.aiOverlayText && this.aiOverlayText.textContent === displayText) {
            this.updateAiOverlay();
          }
        }, 2000);
      } else if (status === "idle") {
        // idle 状态立即恢复默认文本
        setTimeout(() => {
          this.updateAiOverlay();
        }, 100);
      }
    } else {
      this.aiOverlay.classList.add("executing");
    }

    // 执行完成后刷新数据
    if (status === "completed") {
      setTimeout(() => {
        this.refreshData();
      }, 1000);
    }
  }

  /**
   * 手动触发 AI 交易决策
   */
  async handleManualAiExecution() {
    // 检查登录状态
    if (!this.isAuthenticated) {
      this.showToast(
        "warning",
        t("aiManual.loginRequiredTitle"),
        t("aiManual.loginRequiredMessage"),
      );
      return;
    }

    // 防止重复触发（通过检查 executing 类）
    if (this.aiOverlay?.classList.contains("executing")) {
      this.showToast(
        "info",
        t("aiManual.executingTitle"),
        t("aiManual.executingMessage"),
      );
      return;
    }

    try {
      const csrfToken = window.csrfManager ? window.csrfManager.getToken() : "";
      const response = await fetch("/api/trading/execute-manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "same-origin",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      await response.json();

      // 状态更新将通过 WebSocket 实时推送，无需手动模拟

    } catch (error) {
      console.error("[manual-ai] 手动执行 AI 决策失败:", error);
      this.showToast(
        "error",
        t("aiManual.triggerFailedTitle"),
        error.message || t("aiManual.triggerFailedMessage"),
      );
    }
  }

  async handleLogout() {
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });

      if (!response.ok) {
        console.warn("[auth] 退出登录失败", response.status, response.statusText);
        return;
      }

      this.isAuthenticated = false;
      this.updateAuthUI();
      if (window.csrfManager && typeof window.csrfManager.resetToken === "function") {
        window.csrfManager.resetToken();
      }

      window.location.reload();
    } catch (error) {
      console.error("[auth] 退出登录异常", error);
    }
  }

  ensureAuthenticated() {
    if (this.isAuthenticated) {
      return true;
    }
    this.showToast("warning", "未登录", "当前会话未登录，请先通过后台登录入口认证。");
    return false;
  }

  getCsrfToken() {
    return window.csrfManager ? window.csrfManager.getToken() : "";
  }

  showModal(modal) {
    if (!modal) return;
    modal.classList.add("show");
  }

  hideModal(modal) {
    if (!modal || !modal.classList.contains("show")) {
      if (modal === this.recordsModal) {
        this.recordsModalStack = 0;
        this.recordsModal?.classList.remove("modal-stacked-behind");
      }
      return;
    }
    modal.classList.remove("show");
    this.onModalClosed(modal);
  }

  onModalClosed(modal) {
    if (!modal) return;
    if (modal === this.recordsModal) {
      this.recordsModalStack = 0;
      this.recordsModal.classList.remove("modal-stacked-behind");
      return;
    }
    if (modal.dataset && modal.dataset.stackedFromRecords === "true") {
      delete modal.dataset.stackedFromRecords;
      this.popRecordsModalBehind();
    }
  }

  async openAccountModal() {
    // Deprecated: Account management moved to Settings > Account Config
    const settingsBtn = document.getElementById("settings-btn");
    if (settingsBtn) {
      settingsBtn.click();
      // Switch to account tab
      setTimeout(() => {
        const accountTabBtn = document.querySelector('[data-settings-tab="account"]');
        if (accountTabBtn) accountTabBtn.click();
      }, 100);
    }
  }

  async openSettingsModal() {
    if (!this.ensureAuthenticated() || !this.settingsModal || !this.settingsForm) {
      console.warn("[openSettingsModal] 前置条件不满足:", {
        authenticated: this.isAuthenticated,
        hasModal: !!this.settingsModal,
        hasForm: !!this.settingsForm
      });
      return;
    }

    console.log("[openSettingsModal] 打开设置弹窗");
    this.hideResetConfirmation();

    const config = await this.fetchFullConfig(true); // 强制刷新确保获取完整配置
    if (!config) {
      console.error("[openSettingsModal] 配置获取失败");
      this.showToast("error", "加载失败", "无法加载配置，请稍后重试。");
      return;
    }

    console.log("[openSettingsModal] 配置已获取，开始填充表单");
    this.populateForm(this.settingsForm, config, SETTINGS_CONFIG_KEYS);
    this.applyPrivacyDependencies();
    
    // Sync Base URL Preset Selector
    const baseUrlInput = document.getElementById("base-url-input");
    const baseUrlPreset = document.getElementById("base-url-preset");
    if (baseUrlInput && baseUrlPreset) {
      const currentValue = baseUrlInput.value.trim();
      const matchingOption = Array.from(baseUrlPreset.options).find(
        option => option.value && option.value === currentValue
      );
      if (matchingOption) {
        baseUrlPreset.value = matchingOption.value;
      } else {
        baseUrlPreset.value = "";
      }
    }

    const activeTabBtn = document.querySelector("#settings-tabs .settings-tab-btn.active");
    if (activeTabBtn) {
      this.prepareSettingsTab(activeTabBtn.dataset.settingsTab);
    }
    
    this.showModal(this.settingsModal);
    console.log("[openSettingsModal] 弹窗已显示");
  }

  async fetchFullConfig(force = false) {
    if (!force && this.latestConfig) {
      console.log("[fetchFullConfig] 使用缓存配置", Object.keys(this.latestConfig).length, "个键");
      this.updateAiOverlay(this.latestConfig);
      this.applyConfigSymbols(this.latestConfig);
      return this.latestConfig;
    }

    console.log("[fetchFullConfig] 从 /api/config 获取配置");
    const response = await this.fetchJson("/api/config");
    console.log("[fetchFullConfig] 响应:", response ? "有数据" : "null", response?.config ? `config有${Object.keys(response.config).length}个键` : "config为空");
    
    if (!response || !response.config) {
      console.warn("[fetchFullConfig] 配置获取失败");
      this.updateAiOverlay();
      return null;
    }

    this.latestConfig = response.config;
    console.log("[fetchFullConfig] 已缓存配置:", Object.keys(this.latestConfig).slice(0, 5));
    this.applyConfigSymbols(this.latestConfig);
    this.updateAiOverlay(this.latestConfig);
    return this.latestConfig;
  }

  applyConfigSymbols(config) {
    if (!config) {
      return;
    }

    const raw = typeof config.TRADING_SYMBOLS === "string" ? config.TRADING_SYMBOLS : "";
    if (!raw) {
      return;
    }

    const symbols = raw
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean);

    if (!symbols.length) {
      return;
    }

    const uniqueSymbols = [];
    const seen = new Set();
    symbols.forEach((symbol) => {
      if (!seen.has(symbol)) {
        seen.add(symbol);
        uniqueSymbols.push(symbol);
      }
    });

    this.symbolOrder = uniqueSymbols;

    const nextSet = new Set(uniqueSymbols);
    this.availableSymbols = nextSet;

    const previousActive = this.activeSymbol;
    let symbolChanged = false;
    if (!previousActive || !nextSet.has(previousActive)) {
      this.activeSymbol = uniqueSymbols[0];
      symbolChanged = true;
    }

    this.updateChartTitle();

    if (!this.chart) {
      this.pendingCandleSymbol = this.activeSymbol;
    } else if (symbolChanged) {
      void this.loadCandles(this.activeSymbol);
    }

    this.renderSymbolList();
  }

  updateAiOverlay(config) {
    if (!this.aiOverlay) {
      return;
    }

    if (!this.aiOverlayText || !this.aiOverlayIcon) {
      this.aiOverlayText = this.aiOverlay.querySelector(".ai-model-text");
      this.aiOverlayIcon = this.aiOverlay.querySelector(".ai-model-icon");
    }

    const textEl = this.aiOverlayText;
    const iconEl = this.aiOverlayIcon;
    if (!textEl || !iconEl) {
      return;
    }

    const cfg = config || this.latestConfig;
    const rawName = cfg && typeof cfg.AI_MODEL_NAME === "string" ? cfg.AI_MODEL_NAME.trim() : "";
    const displayName = this.extractModelDisplayName(rawName);
    const iconSrc = this.resolveAiModelIcon(rawName);

    const resolvedUrl = this.toAbsoluteUrl(iconSrc);
    if (iconEl.src !== resolvedUrl) {
      iconEl.src = iconSrc;
    }
    iconEl.setAttribute("alt", t("chart.modelIconAlt"));
    // 只显示模型名称，状态文本由 WebSocket 的 handleTradingStatusUpdate 动态更新
    textEl.textContent = displayName;
  }

  resolveAiModelIcon(modelName) {
    if (typeof modelName === "string" && modelName.trim() !== "") {
      const normalized = modelName.trim();
      for (const matcher of MODEL_ICON_MATCHERS) {
        if (matcher.pattern.test(normalized)) {
          return matcher.icon;
        }
      }
    }
    return DEFAULT_AI_ICON;
  }

  toAbsoluteUrl(path) {
    try {
      return new URL(path, window.location.href).href;
    } catch (error) {
      return path;
    }
  }

  extractModelDisplayName(modelName) {
    if (typeof modelName !== "string" || modelName.trim() === "") {
      return t("chart.modelBadge");
    }

    const trimmed = modelName.trim();
    const segments = trimmed.split(/[\/:]/).filter(Boolean);
    const lastSegment = segments.length > 0 ? segments[segments.length - 1] : trimmed;
    return lastSegment || t("chart.modelBadge");
  }

  populateForm(form, config, keys) {
    if (!form || !config) {
      console.warn("[populateForm] 参数缺失:", { hasForm: !!form, hasConfig: !!config, keysLength: keys?.length });
      return;
    }

    console.log("[populateForm] 开始填充表单:", keys.length, "个键");
    let filledCount = 0;
    let missingCount = 0;

    keys.forEach((key) => {
      const field = form.querySelector(`[name="${key}"]`);
      if (!field) {
        missingCount++;
        console.warn(`[populateForm] 字段不存在: ${key}`);
        return;
      }

      const value = config[key];

      if (key === "TRADING_MARGIN_MODE") {
        const normalized = typeof value === "string" && value.trim() !== ""
          ? value.trim().toLowerCase()
          : "cross";
        field.value = normalized === "isolated" ? "isolated" : "cross";
        filledCount++;
        return;
      }
      if (field.type === "checkbox") {
        field.checked = String(value).toLowerCase() === "true";
        filledCount++;
        return;
      }

      if (typeof value === "string") {
        if (key === "TRADING_SYMBOLS") {
          field.value = value;
          filledCount++;
          return;
        }
        field.value = value;
        filledCount++;
        return;
      }

      if (value === undefined || value === null) {
        field.value = "";
      } else {
        field.value = String(value);
      }
      filledCount++;
    });

    console.log(`[populateForm] 填充完成: ${filledCount}个字段已填充, ${missingCount}个字段未找到`);
  }

  collectFormValues(form, keys) {
    if (!form) return null;

    const payload = {};
    let hasChanges = false;

    keys.forEach((key) => {
      const field = form.querySelector(`[name="${key}"]`);
      if (!field) return;

      let rawValue;
      if (field.type === "checkbox") {
        rawValue = field.checked ? "true" : "false";
      } else {
        rawValue = field.value.trim();
      }

      if (!rawValue && field.type !== "checkbox") {
        if (CLIENT_NUMERIC_KEYS.has(key) || key === "TRADING_SYMBOLS") {
          console.log(`[collectFormValues] 跳过空值字段: ${key}`);
          return;
        }
      }

      if (key === "TRADING_SYMBOLS" && rawValue) {
        console.log("[collectFormValues] TRADING_SYMBOLS 原始值:", rawValue);
        rawValue = rawValue
          .split(",")
          .map((symbol) => symbol.trim().toUpperCase())
          .filter(Boolean)
          .join(",");
        console.log("[collectFormValues] TRADING_SYMBOLS 处理后:", rawValue);
      }

      const normalized = rawValue;

      const existing = this.latestConfig ? String(this.latestConfig[key] ?? "") : null;
      const compareValue = field.type === "checkbox" ? (field.checked ? "true" : "false") : normalized;

      if (existing !== null && existing === compareValue) {
        if (key === "TRADING_SYMBOLS") {
          console.log(`[collectFormValues] ${key} 值未改变，跳过: "${existing}" === "${compareValue}"`);
        }
        return;
      }

      if (!normalized && CLIENT_NUMERIC_KEYS.has(key)) {
        return;
      }

      payload[key] = field.type === "checkbox" ? (field.checked ? "true" : "false") : normalized;
      hasChanges = true;
    });

    return hasChanges ? payload : null;
  }

  async submitAccountForm() {
    if (!this.ensureAuthenticated() || !this.accountForm) {
      return;
    }

    const payload = this.collectFormValues(this.accountForm, ACCOUNT_CONFIG_KEYS);
    if (!payload) {
      this.showToast(
        "info",
        t("notifications.noChangesTitle"),
        t("notifications.noChangesMessage"),
      );
      return;
    }

    try {
      const updateResult = await this.sendConfigUpdate(payload);
      if (!updateResult.success) {
        const message = updateResult.error || t("notifications.saveFailedDefault");
        this.showToast("error", t("notifications.saveFailedTitle"), message);
        return;
      }

      const reloadResult = await this.triggerConfigReload();
      if (reloadResult.success) {
        this.showToast(
          "success",
          t("notifications.accountSaveTitle"),
          t("notifications.accountSaveMessage"),
        );
      } else if (reloadResult.error) {
        this.showToast(
          "warning",
          t("notifications.reloadFailedTitle"),
          t("notifications.reloadFailedMessage", { error: reloadResult.error }),
        );
      }

      this.hideModal(this.accountModal);
      await this.fetchFullConfig(true);
      await this.refreshAll();
    } catch (error) {
      console.error("[account] 保存配置失败", error);
      this.showToast(
        "error",
        t("notifications.saveExceptionTitle"),
        t("notifications.saveExceptionMessage"),
      );
    }
  }

  async submitSettingsForm() {
    if (!this.ensureAuthenticated() || !this.settingsForm) {
      return;
    }

    const payload = this.collectFormValues(this.settingsForm, SETTINGS_CONFIG_KEYS);
    if (!payload) {
      this.showToast(
        "info",
        t("notifications.noChangesTitle"),
        t("notifications.noChangesMessage"),
      );
      return;
    }

    try {
      const updateResult = await this.sendConfigUpdate(payload);
      if (!updateResult.success) {
        const message = updateResult.error || t("notifications.saveFailedDefault");
        this.showToast("error", t("notifications.saveFailedTitle"), message);
        return;
      }

      const reloadResult = await this.triggerConfigReload();
      if (reloadResult.success) {
        this.showToast(
          "success",
          t("notifications.settingsSaveTitle"),
          t("notifications.settingsSaveMessage"),
        );
      } else if (reloadResult.error) {
        this.showToast(
          "warning",
          t("notifications.reloadFailedTitle"),
          t("notifications.reloadFailedMessage", { error: reloadResult.error }),
        );
      }

      this.hideModal(this.settingsModal);
      await this.fetchFullConfig(true);
      await this.refreshAll();
    } catch (error) {
      console.error("[settings] 保存配置失败", error);
      this.showToast(
        "error",
        t("notifications.saveExceptionTitle"),
        t("notifications.saveExceptionMessage"),
      );
    }
  }

  async sendConfigUpdate(payload) {
    try {
      const csrfToken = window.csrfManager ? window.csrfManager.getToken() : "";
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.error) {
        return { success: false, error: result.error || `HTTP ${response.status}` };
      }

      return { success: true };
    } catch (error) {
      console.error("[config] 更新配置接口异常", error);
      return { success: false, error: t("notifications.networkRequestFailed") };
    }
  }

  async triggerConfigReload() {
    try {
      const csrfToken = window.csrfManager ? window.csrfManager.getToken() : "";
      const response = await fetch("/api/reload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "same-origin",
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.error) {
        return { success: false, error: result.error || `HTTP ${response.status}` };
      }

      return { success: true };
    } catch (error) {
      console.error("[config] 配置重载失败", error);
      return { success: false, error: "请求失败，请检查网络连接。" };
    }
  }

  showResetConfirmation() {
    if (!this.ensureAuthenticated()) {
      return;
    }

    if (this.resetLiveDataBtn) {
      this.resetLiveDataBtn.setAttribute("disabled", "disabled");
    }

    if (this.resetLiveDataConfirmContainer) {
      this.resetLiveDataConfirmContainer.classList.remove("hidden");
    }

    if (this.resetLiveDataConfirmBtn) {
      const original = this.resetLiveDataConfirmBtn.dataset.originalLabel
        || this.resetLiveDataConfirmBtn.textContent
        || "确认重置";
      this.resetLiveDataConfirmBtn.dataset.originalLabel = original;
      this.resetLiveDataConfirmBtn.disabled = false;
      this.resetLiveDataConfirmBtn.textContent = original;
    }

    if (this.resetLiveDataInput) {
      this.resetLiveDataInput.value = "";
      this.resetLiveDataInput.focus();
    }
  }

  hideResetConfirmation() {
    if (this.resetLiveDataConfirmContainer) {
      this.resetLiveDataConfirmContainer.classList.add("hidden");
    }

    if (this.resetLiveDataInput) {
      this.resetLiveDataInput.value = "";
    }

    if (this.resetLiveDataBtn) {
      this.resetLiveDataBtn.removeAttribute("disabled");
    }

    if (this.resetLiveDataConfirmBtn) {
      const original = this.resetLiveDataConfirmBtn.dataset.originalLabel
        || this.resetLiveDataConfirmBtn.textContent
        || "确认重置";
      this.resetLiveDataConfirmBtn.disabled = false;
      this.resetLiveDataConfirmBtn.textContent = original;
    }
  }

  async handleResetLiveData() {
    if (!this.ensureAuthenticated() || !this.resetLiveDataConfirmBtn) {
      return;
    }
    const confirmationCode = this.resetLiveDataInput ? this.resetLiveDataInput.value.trim().toUpperCase() : "";
    if (confirmationCode !== "RESET") {
      this.showToast("warning", "确认口令错误", "请输入 RESET 以继续重置。");
      if (this.resetLiveDataInput) {
        this.resetLiveDataInput.focus();
      }
      return;
    }

    const confirmButton = this.resetLiveDataConfirmBtn;
    const primaryButton = this.resetLiveDataBtn;
    const originalLabel = confirmButton.dataset.originalLabel || confirmButton.textContent || "确认重置";
    confirmButton.dataset.originalLabel = originalLabel;
    confirmButton.disabled = true;
    confirmButton.textContent = "重置中...";
    primaryButton?.setAttribute("disabled", "disabled");

    try {
      const csrfToken = window.csrfManager ? window.csrfManager.getToken() : "";
      const response = await fetch("/api/reset-live-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "same-origin",
        body: JSON.stringify({ confirmation: confirmationCode }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result || result.error || result.success === false) {
        const message = (result && result.error) || `HTTP ${response.status}`;
        this.showToast("error", "重置失败", message);
        return;
      }

      this.strategyPromptCache.clear();
      await this.fetchFullConfig(true);
      await this.refreshAll();
  this.hideModal(this.settingsModal);
  this.showToast("success", "重置完成", "系统已恢复到默认状态，请按需重新配置。");
      this.hideResetConfirmation();
    } catch (error) {
      console.error("[reset] 重置实盘数据失败", error);
      this.showToast("error", "重置失败", error instanceof Error ? error.message : "网络异常，请稍后重试。");
    } finally {
      confirmButton.disabled = false;
      confirmButton.textContent = confirmButton.dataset.originalLabel || originalLabel;
      primaryButton?.removeAttribute("disabled");
    }
  }

  displayApiTestResult(elementId, status, message) {
    const container = document.getElementById(elementId);
    if (!container) return;

    container.style.display = "block";
    container.textContent = message;
    container.classList.remove("success", "error", "loading");
    container.classList.add(status);
  }

  async testExchangeConnection(exchange) {
    if (!this.ensureAuthenticated() || !this.accountForm) {
      return;
    }

    const proxyInput = this.settingsForm?.querySelector('[name="HTTP_PROXY_URL"]');
    const proxyValue = (() => {
      const formValue = proxyInput?.value?.trim?.() || "";
      if (formValue) {
        return formValue;
      }
      const configValue = typeof this.latestConfig?.HTTP_PROXY_URL === "string"
        ? this.latestConfig.HTTP_PROXY_URL.trim()
        : "";
      return configValue;
    })();
    const target = typeof exchange === "string" ? exchange.toLowerCase() : "okx";
    const namespace = target === "binance" ? "account.binance.testMessages" : "account.okx.testMessages";
    const resolveMessage = (key, fallback) => {
      const result = t(`${namespace}.${key}`);
      if (typeof result === "string" && result !== `${namespace}.${key}`) {
        return result;
      }
      return fallback;
    };

    const payload = { exchange: target, proxyUrl: proxyValue };
    let testBtn = null;

    if (target === "binance") {
      testBtn = this.testBinanceBtn;
      const apiKey = this.accountForm.querySelector('[name="BINANCE_API_KEY"]')?.value.trim() || "";
      const apiSecret = this.accountForm.querySelector('[name="BINANCE_API_SECRET"]')?.value.trim() || "";
      const useTestnet = this.accountForm.querySelector('[name="BINANCE_USE_TESTNET"]')?.checked || false;

      if (!apiKey || !apiSecret) {
        this.displayApiTestResult("api-test-result", "error", resolveMessage("fillRequired", "Please enter required credentials."));
        return;
      }

      Object.assign(payload, {
        apiKey,
        apiSecret,
        testnet: useTestnet,
      });
    } else {
      testBtn = this.testOkxBtn;
      const apiKey = this.accountForm.querySelector('[name="OKX_API_KEY"]')?.value.trim() || "";
      const apiSecret = this.accountForm.querySelector('[name="OKX_API_SECRET"]')?.value.trim() || "";
      const passphrase = this.accountForm.querySelector('[name="OKX_API_PASSPHRASE"]')?.value.trim() || "";
      const usePaper = this.accountForm.querySelector('[name="OKX_USE_PAPER"]')?.checked || false;

      if (!apiKey || !apiSecret || !passphrase) {
        this.displayApiTestResult("api-test-result", "error", resolveMessage("fillRequired", "请填写所有必填字段"));
        return;
      }

      Object.assign(payload, {
        apiKey,
        apiSecret,
        passphrase,
        usePaper,
      });
    }

    // UI Update: Button loading state
    let originalBtnText = "";
    if (testBtn) {
      originalBtnText = testBtn.innerHTML;
      testBtn.disabled = true;
      testBtn.textContent = resolveMessage("testing", "Testing...");
    }

    // Clear previous result, hide container during test
    const resultContainer = document.getElementById("api-test-result");
    if (resultContainer) {
      resultContainer.style.display = "none";
      resultContainer.classList.remove("success", "error", "loading");
      resultContainer.textContent = "";
    }

    try {
      const csrfToken = window.csrfManager ? window.csrfManager.getToken() : "";
      const response = await fetch("/api/test-exchange", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => ({}));
      if (response.ok && result.success) {
        let message = resolveMessage("success", "Connection successful.");
        if (result.balance) {
          const balanceLabel = resolveMessage("balanceLabel", " Balance: {{balance}}");
          message = `${message}${balanceLabel.replace("{{balance}}", result.balance)}`;
        }
        this.displayApiTestResult("api-test-result", "success", message);
      } else {
        const detail = typeof result.error === "string" && result.error.trim()
          ? result.error.trim()
          : `HTTP ${response.status}`;
        const failure = resolveMessage("failure", "Connection failed: {{detail}}").replace("{{detail}}", detail);
        this.displayApiTestResult("api-test-result", "error", failure);
      }
    } catch (error) {
      console.error("[account] 测试交易所 API 失败", error);
      this.displayApiTestResult("api-test-result", "error", resolveMessage("networkError", "Network error, please retry."));
    } finally {
      // Restore button state
      if (testBtn) {
        testBtn.disabled = false;
        testBtn.innerHTML = originalBtnText;
      }
    }
  }

  async testAiConnection() {
    if (!this.ensureAuthenticated() || !this.settingsForm) {
      return;
    }

    const apiKey = this.settingsForm.querySelector('[name="OPENAI_API_KEY"]')?.value.trim() || "";
    const baseUrl = this.settingsForm.querySelector('[name="OPENAI_BASE_URL"]')?.value.trim() || "";
    const modelName = this.settingsForm.querySelector('[name="AI_MODEL_NAME"]')?.value.trim() || "";

    const proxyInput = this.settingsForm.querySelector('[name="HTTP_PROXY_URL"]');
    const proxyValue = (() => {
      const formValue = proxyInput?.value?.trim?.() || "";
      if (formValue) {
        return formValue;
      }
      const configValue = typeof this.latestConfig?.HTTP_PROXY_URL === "string"
        ? this.latestConfig.HTTP_PROXY_URL.trim()
        : "";
      return configValue;
    })();

    if (!apiKey || !baseUrl || !modelName) {
      this.displayApiTestResult("ai-test-result", "error", t("settings.ai.testMessages.fillRequired"));
      return;
    }

    this.displayApiTestResult("ai-test-result", "loading", t("settings.ai.testMessages.testing"));

    try {
      const csrfToken = window.csrfManager ? window.csrfManager.getToken() : "";
      const response = await fetch("/api/test-ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        credentials: "same-origin",
        body: JSON.stringify({
          apiKey,
          baseUrl,
          modelName,
          proxyUrl: proxyValue,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (response.ok && result.success) {
        let message = t("settings.ai.testMessages.success");
        if (result.responseTime) {
          const timeSuffix = t("settings.ai.testMessages.responseTime", { time: result.responseTime });
          if (timeSuffix) {
            message = `${message}${timeSuffix}`;
          }
        }
        this.displayApiTestResult("ai-test-result", "success", message);
      } else {
        const detail = typeof result.error === "string" && result.error.trim()
          ? result.error.trim()
          : `HTTP ${response.status}`;
        this.displayApiTestResult("ai-test-result", "error", t("settings.ai.testMessages.failure", { detail }));
      }
    } catch (error) {
      console.error("[settings] 测试 AI API 失败", error);
      this.displayApiTestResult("ai-test-result", "error", t("settings.ai.testMessages.networkError"));
    }
  }

  hideLoadingOverlay() {
    if (this.loadingOverlay) {
      this.loadingOverlay.classList.add("hidden");
    }
  }

  ensureToastContainer() {
    if (!this.toastContainer) {
      let container = document.getElementById("toast-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.className = "toast-container";
        document.body.appendChild(container);
      }
      this.toastContainer = container;
    }
    return this.toastContainer;
  }

  getToastIcon(type) {
    switch (type) {
      case "success":
        return "✅";
      case "error":
        return "❌";
      case "warning":
        return "⚠️";
      case "info":
      default:
        return "ℹ️";
    }
  }

  dismissToast(toast) {
    if (!toast) return;

    const removeToast = () => {
      toast.removeEventListener("transitionend", removeToast);
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
      }
    };

    toast.addEventListener("transitionend", removeToast, { once: true });
    toast.classList.add("toast-hide");
    window.setTimeout(removeToast, 350);
  }

  showToast(type = "info", title = "", message = "", options = {}) {
    const container = this.ensureToastContainer();
    if (!container) {
      console.log(`[toast:${type}]`, title, message);
      return;
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    const iconEl = document.createElement("span");
    iconEl.className = "toast-icon";
    iconEl.textContent = this.getToastIcon(type);

    const contentEl = document.createElement("div");
    contentEl.className = "toast-content";

    if (title) {
      const titleEl = document.createElement("div");
      titleEl.className = "toast-title";
      titleEl.textContent = title;
      contentEl.appendChild(titleEl);
    }

    if (message) {
      const messageEl = document.createElement("div");
      messageEl.className = "toast-message";
      messageEl.textContent = message;
      contentEl.appendChild(messageEl);
    }

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "toast-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", () => this.dismissToast(toast));

    toast.appendChild(iconEl);
    toast.appendChild(contentEl);
    toast.appendChild(closeBtn);

    container.appendChild(toast);

    const duration = Number.isFinite(options.duration) ? options.duration : 5000;
    if (duration > 0) {
      let timer = window.setTimeout(() => this.dismissToast(toast), duration);

      toast.addEventListener("mouseenter", () => {
        if (timer) {
          window.clearTimeout(timer);
          timer = null;
        }
      });

      toast.addEventListener("mouseleave", () => {
        if (!timer) {
          timer = window.setTimeout(() => this.dismissToast(toast), 2000);
        }
      });
    }
  }

  formatTime(value) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      hour12: false,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  formatOutputDuration(durationMs) {
    if (typeof durationMs !== "number" || Number.isNaN(durationMs) || durationMs <= 0) {
      return "--";
    }

    if (durationMs < 1000) {
      return `${Math.round(durationMs)} ms`;
    }

    const seconds = durationMs / 1000;
    if (seconds < 60) {
      return seconds >= 10 ? `${seconds.toFixed(1)} s` : `${seconds.toFixed(2)} s`;
    }

    const minutes = seconds / 60;
    return minutes >= 10 ? `${minutes.toFixed(0)} min` : `${minutes.toFixed(1)} min`;
  }

  escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async showStatisticsModal() {
    if (!this.statisticsModal) return;

    // 显示弹窗
    this.statisticsModal.classList.add("show");

    // 加载统计数据
    await this.loadStatistics();
  }

  async loadStatistics() {
    try {
      // 加载统计数据
      const stats = await this.fetchJson("/api/statistics");
      if (!stats) return;

      // 加载权益历史用于绘图
      const historyData = await this.fetchJson("/api/history");
      if (!historyData) return;

      // 更新统计数值
      this.setText("stats-winrate", `${stats.winRate.toFixed(2)}%`);
      this.setText("stats-total-profit", this.formatCurrency(stats.totalProfit, 2, true));
      this.setText("stats-total-loss", this.formatCurrency(-stats.totalLoss, 2, true));
      this.setText("stats-net-pnl", this.formatCurrency(stats.netPnl, 2, true));
      this.setText("stats-return", `${stats.returnPercent >= 0 ? '+' : ''}${stats.returnPercent.toFixed(2)}%`);
      this.setText("stats-maxdd", `${stats.maxDrawdown.toFixed(2)}%`);
      this.setText("stats-profit-factor", stats.profitFactor.toFixed(2));
      this.setText("stats-total-trades", stats.totalTrades);
      this.setText("stats-win-trades", stats.winCount);
      this.setText("stats-loss-trades", stats.lossCount);
      this.setText("stats-avg-win", this.formatCurrency(stats.avgWin, 2, true));
      this.setText("stats-avg-loss", this.formatCurrency(-stats.avgLoss, 2, true));
      this.setText("stats-max-win", this.formatCurrency(stats.maxWin, 2, true));
      this.setText("stats-max-loss", this.formatCurrency(-stats.maxLoss, 2, true));
      this.setText("stats-sharpe", stats.sharpeRatio.toFixed(2));
      this.setText("stats-sortino", stats.sortinoRatio.toFixed(2));

      // 更新颜色类
      const netPnlEl = document.getElementById("stats-net-pnl");
      if (netPnlEl) {
        netPnlEl.className = `stats-value ${stats.netPnl >= 0 ? 'positive' : 'negative'}`;
      }

      const returnEl = document.getElementById("stats-return");
      if (returnEl) {
        returnEl.className = `stats-value ${stats.returnPercent >= 0 ? 'positive' : 'negative'}`;
      }

      // 绘制PNL曲线图
      this.drawStatsPnlChart(historyData.history, stats.maxDrawdown);
    } catch (error) {
      console.error("[loadStatistics] 加载统计数据失败:", error);
    }
  }

  drawStatsPnlChart(history, maxDrawdown) {
    const canvas = document.getElementById("stats-pnl-chart");
    if (!canvas || !history || history.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 销毁旧图表
    if (this.statsPnlChart) {
      this.statsPnlChart.destroy();
    }

    // 准备数据
    const labels = history.map(item => {
      const date = new Date(item.timestamp);
      return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    });

    const values = history.map(item => Number(item.totalValue) || 0);

    // 计算最大回撤点位用于标记
    let peak = 0;
    let maxDDValue = 0;
    let maxDDIndex = 0;
    for (let i = 0; i < values.length; i++) {
      if (values[i] > peak) {
        peak = values[i];
      }
      const dd = peak - values[i];
      if (dd > maxDDValue) {
        maxDDValue = dd;
        maxDDIndex = i;
      }
    }

    // 创建图表
    this.statsPnlChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "账户权益",
            data: values,
            borderColor: "rgb(6, 182, 212)",
            backgroundColor: "rgba(6, 182, 212, 0.1)",
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              color: "#e5e7eb",
              font: { size: 11 },
            },
          },
          tooltip: {
            mode: "index",
            intersect: false,
            callbacks: {
              label: (context) => {
                return `权益: ${context.parsed.y.toFixed(2)} USDT`;
              },
            },
          },
          annotation: maxDDValue > 0 ? {
            annotations: {
              maxDD: {
                type: 'point',
                xValue: maxDDIndex,
                yValue: values[maxDDIndex],
                backgroundColor: 'rgba(239, 68, 68, 0.8)',
                borderColor: 'rgb(239, 68, 68)',
                borderWidth: 2,
                radius: 6,
                label: {
                  display: true,
                  content: `最大回撤: ${maxDrawdown.toFixed(2)}%`,
                  backgroundColor: 'rgba(239, 68, 68, 0.9)',
                  color: '#fff',
                  font: { size: 10 },
                  padding: 4,
                  position: 'top',
                },
              },
            },
          } : undefined,
        },
        scales: {
          x: {
            display: true,
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            ticks: {
              color: "#9ca3af",
              maxTicksLimit: 10,
              font: { size: 10 },
            },
          },
          y: {
            display: true,
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            ticks: {
              color: "#9ca3af",
              font: { size: 10 },
              callback: (value) => `${value.toFixed(0)}`,
            },
          },
        },
        interaction: {
          mode: "nearest",
          axis: "x",
          intersect: false,
        },
      },
    });
  }

  // ====== 账户列表管理功能 ======
  
  // async openAccountsListModal() { ... } // Removed as part of UI refactor


  async loadAccountsList() {
    const container = document.getElementById("accounts-list-container");
    const loading = document.getElementById("accounts-loading");
    
    if (!container) return;
    
    try {
      if (loading) {
        loading.style.display = "flex";
      }
      
      const response = await fetch("/api/accounts", {
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("获取账户列表失败");
      }
      
      const data = await response.json();
      const accounts = data.accounts || [];
      this.accountsCache = accounts;
      this.updateAccountSwitcherDisplay();

      if (loading) {
        loading.style.display = "none";
      }
      
      if (accounts.length === 0) {
        const emptyText = this.translate("accounts.empty", "No accounts configured");
        container.innerHTML = `
          <div class="empty-accounts">
            <div class="empty-accounts-icon">🏦</div>
            <div class="empty-accounts-text">${this.escapeHtml(emptyText)}</div>
          </div>
        `;
        return;
      }
      
      container.innerHTML = accounts.map(account => this.renderAccountCard(account)).join("");
      
      // 绑定每个账户卡片的事件
      this.bindAccountCardEvents();
      
    } catch (error) {
      console.error("加载账户列表失败:", error);
      this.accountsCache = [];
      this.updateAccountSwitcherDisplay();
      if (loading) {
        loading.style.display = "none";
      }
      const errorText = this.translate("accounts.messages.loadError", "加载失败，请稍后重试");
      container.innerHTML = `
        <div class="empty-accounts">
          <div class="empty-accounts-text" style="color: var(--accent-red);">${this.escapeHtml(errorText)}</div>
        </div>
      `;
      this.showToast("error", this.translate("common.error", "Error"), errorText);
    }
  }

  renderAccountCard(account) {
    let providerLabel = "Unknown";
    let providerBadgeClass = "badge-default";
    
    if (account.provider === "okx") {
      providerLabel = this.translate("accounts.providers.okx", "OKX");
      providerBadgeClass = "badge-okx";
    } else if (account.provider === "binance") {
      providerLabel = this.translate("accounts.providers.binance", "Binance");
      providerBadgeClass = "badge-binance";
    } else if (account.provider === "bitget") {
      providerLabel = this.translate("accounts.providers.bitget", "Bitget");
      providerBadgeClass = "badge-bitget";
    }

    const providerBadge = `<span class="account-badge ${providerBadgeClass}">${this.escapeHtml(providerLabel)}</span>`;

    const paperBadge = account.use_paper
      ? `<span class="account-badge badge-paper">${this.escapeHtml(this.translate("accounts.badges.paper", "Paper"))}</span>`
      : "";

    // 多任务模式下不再需要激活状态和激活按钮
    const deleteLabel = this.translate("accounts.actions.delete", "Delete");
    const deleteBtn = `<button class="account-action-btn btn-delete" data-account-id="${account.id}" data-action="delete">${this.escapeHtml(deleteLabel)}</button>`;

    const apiKeyLabel = this.translate("accounts.cards.apiKeyLabel", "API Key");
    const updatedLabel = this.translate("accounts.cards.updatedLabel", "Updated");
    const testLabel = this.translate("accounts.actions.test", "Test");
    const editLabel = this.translate("accounts.actions.edit", "Edit");

    return `
      <div class="account-card" data-account-id="${account.id}">
        <div class="account-card-info">
          <div class="account-card-header">
            <div class="account-card-name">${this.escapeHtml(account.name)}</div>
            ${providerBadge}
            ${paperBadge}
          </div>
          <div class="account-card-details">
            <span>${this.escapeHtml(apiKeyLabel)}: ${this.escapeHtml(account.api_key_preview || "***")}</span>
            <span>${this.escapeHtml(updatedLabel)}: ${this.escapeHtml(this.formatDate(account.updated_at))}</span>
          </div>
        </div>
        <div class="account-card-actions">
          <button class="account-action-btn" data-account-id="${account.id}" data-action="test">${this.escapeHtml(testLabel)}</button>
          <button class="account-action-btn" data-account-id="${account.id}" data-action="edit">${this.escapeHtml(editLabel)}</button>
          ${deleteBtn}
        </div>
      </div>
    `;
  }

  bindAccountsListEvents() {
    const addBtn = document.getElementById("add-account-btn");
    if (addBtn && !addBtn.dataset.bound) {
      addBtn.dataset.bound = "true";
      addBtn.addEventListener("click", () => this.openAccountFormModal());
    }

    // 多任务模式下不再需要激活相关的点击事件处理
  }

  bindAccountCardEvents() {
    const container = document.getElementById("accounts-list-container");
    if (!container) return;

    container.querySelectorAll("[data-action]").forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "true";
      
      btn.addEventListener("click", async (e) => {
        const action = btn.dataset.action;
        const accountId = btn.dataset.accountId;
        
        // 多任务模式下移除 activate 操作
        switch (action) {
          case "edit":
            await this.openAccountFormModal(Number(accountId));
            break;
          case "delete":
            await this.deleteAccount(Number(accountId), btn);
            break;
          case "test":
            await this.testAccountConnection(Number(accountId), btn);
            break;
        }
      });
    });
  }

  async openAccountFormModal(accountId = null) {
    if (!this.accountFormModal || !this.accountEditForm) return;
    
    const title = document.getElementById("account-form-title");
    const idField = document.getElementById("account-edit-id");
    
    // 重置表单
    this.accountEditForm.reset();
    idField.value = "";
    
    const titleKey = accountId ? "modals.accountForm.titleEdit" : "modals.accountForm.titleAdd";
    if (title) {
      title.setAttribute("data-i18n", titleKey);
      title.textContent = this.translate(titleKey, accountId ? "Edit Account" : "Add Account");
    }

    if (accountId) {
      // 编辑模式
      let account = this.accountsCache?.find((item) => item.id === accountId) || null;
      if (!account) {
        await this.loadAccountsList();
        account = this.accountsCache?.find((item) => item.id === accountId) || null;
      }

      if (!account) {
        this.showToast("error", this.translate("common.error", "Error"), this.translate("accounts.messages.loadError", "Failed to load account data"));
        return;
      }

      idField.value = String(account.id);
      const nameInput = document.getElementById("account-edit-name");
      const providerInput = document.getElementById("account-edit-provider");
      // const proxyInput = document.getElementById("account-edit-proxy"); // Removed
      if (nameInput) nameInput.value = account.name || "";
      if (providerInput) {
        providerInput.value = account.provider;
        // Update UI selection
        document.querySelectorAll(".provider-option-compact").forEach(opt => {
          if (opt.dataset.value === account.provider) opt.classList.add("selected");
          else opt.classList.remove("selected");
        });
      }
      // if (proxyInput) proxyInput.value = account.proxy_url || ""; // Removed

      if (account.provider === "okx") {
        document.getElementById("account-edit-okx-key").value = account.api_key || "";
        document.getElementById("account-edit-okx-secret").value = account.api_secret || "";
        document.getElementById("account-edit-okx-passphrase").value = account.api_passphrase || "";
        document.getElementById("account-edit-okx-paper").checked = Boolean(account.use_paper);
      } else if (account.provider === "bitget") {
        document.getElementById("account-edit-bitget-key").value = account.api_key || "";
        document.getElementById("account-edit-bitget-secret").value = account.api_secret || "";
        document.getElementById("account-edit-bitget-passphrase").value = account.api_passphrase || "";
      } else {
        document.getElementById("account-edit-binance-key").value = account.api_key || "";
        document.getElementById("account-edit-binance-secret").value = account.api_secret || "";
        document.getElementById("account-edit-binance-testnet").checked = Boolean(account.use_paper);
      }

      this.updateAccountFormPanels();
    } else {
      // 新建模式
      const providerInput = document.getElementById("account-edit-provider");
      if (providerInput) {
        providerInput.value = "okx";
        // Reset UI selection to default
        document.querySelectorAll(".provider-option-compact").forEach(opt => {
          if (opt.dataset.value === "okx") opt.classList.add("selected");
          else opt.classList.remove("selected");
        });
      }
      this.updateAccountFormPanels();
    }

    this.showModal(this.accountFormModal);
    this.bindAccountFormEvents();
  }

  bindAccountFormEvents() {
    const providerOptions = document.querySelectorAll(".provider-option-compact");
    const testBtn = document.getElementById("account-form-test");
    const cancelBtn = document.getElementById("account-form-cancel");
    
    providerOptions.forEach(option => {
      if (!option.dataset.bound) {
        option.dataset.bound = "true";
        option.addEventListener("click", () => {
          // Remove selected class from all
          providerOptions.forEach(opt => opt.classList.remove("selected"));
          // Add to current
          option.classList.add("selected");
          
          // Update hidden input
          const providerInput = document.getElementById("account-edit-provider");
          if (providerInput) {
            providerInput.value = option.dataset.value;
            this.updateAccountFormPanels();
          }
        });
      }
    });
    
    if (testBtn && !testBtn.dataset.bound) {
      testBtn.dataset.bound = "true";
      testBtn.addEventListener("click", (e) => {
        e.preventDefault();
        void this.testAccountFormConnection();
      });
    }
    
    if (cancelBtn && !cancelBtn.dataset.bound) {
      cancelBtn.dataset.bound = "true";
      cancelBtn.addEventListener("click", () => this.hideModal(this.accountFormModal));
    }
    
    if (this.accountEditForm && !this.accountEditForm.dataset.bound) {
      this.accountEditForm.dataset.bound = "true";
      this.accountEditForm.addEventListener("submit", (e) => {
        e.preventDefault();
        void this.submitAccountForm();
      });
    }
  }

  updateAccountFormPanels() {
    const provider = document.getElementById("account-edit-provider")?.value || "okx";
    const panels = document.querySelectorAll("[data-account-panel]");
    
    panels.forEach(panel => {
      const panelProvider = panel.dataset.accountPanel;
      if (panelProvider === provider) {
        panel.classList.add("is-active");
        panel.style.display = "block";
      } else {
        panel.classList.remove("is-active");
        panel.style.display = "none";
      }
    });
  }

  async submitAccountForm() {
    const idField = document.getElementById("account-edit-id");
    const accountId = idField?.value ? Number(idField.value) : null;
    
    const formData = this.collectAccountFormData();
    if (!formData) return;
    
    try {
      const csrfToken = this.getCsrfToken();
      const url = accountId ? `/api/accounts/${accountId}` : "/api/accounts";
      const method = accountId ? "PUT" : "POST";
      
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        credentials: "include",
        body: JSON.stringify(formData),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save account");
      }
      
      const successMessage = accountId
        ? this.translate("accounts.messages.updateSuccess", "Account updated")
        : this.translate("accounts.messages.saveSuccess", "Account created");
      this.showToast("success", this.translate("common.success", "Success"), successMessage);
      this.hideModal(this.accountFormModal);
      await this.loadAccountsList();
      
    } catch (error) {
      console.error("保存账户失败:", error);
      const message = error instanceof Error ? error.message : String(error);
      this.showToast("error", this.translate("common.error", "Error"), message);
    }
  }

  collectAccountFormData() {
    const name = document.getElementById("account-edit-name")?.value?.trim();
    const provider = document.getElementById("account-edit-provider")?.value || "okx";
    // const proxyUrl = document.getElementById("account-edit-proxy")?.value?.trim(); // Removed
    
    if (!name) {
      this.showToast("error", this.translate("common.error", "Error"), this.translate("accounts.messages.validation.missingName", "Please enter account name"));
      return null;
    }
    
    const data = { name, provider }; // Removed proxy_url
    
    if (provider === "okx") {
      const apiKey = document.getElementById("account-edit-okx-key")?.value?.trim();
      const apiSecret = document.getElementById("account-edit-okx-secret")?.value?.trim();
      const passphrase = document.getElementById("account-edit-okx-passphrase")?.value?.trim();
      const usePaper = document.getElementById("account-edit-okx-paper")?.checked || false;
      
      if (!apiKey || !apiSecret || !passphrase) {
        this.showToast("error", this.translate("common.error", "Error"), this.translate("accounts.messages.validation.missingOkx", "Please fill in all OKX credentials"));
        return null;
      }
      
      data.api_key = apiKey;
      data.api_secret = apiSecret;
      data.api_passphrase = passphrase;
      data.use_paper = usePaper;
    } else if (provider === "bitget") {
      const apiKey = document.getElementById("account-edit-bitget-key")?.value?.trim();
      const apiSecret = document.getElementById("account-edit-bitget-secret")?.value?.trim();
      const passphrase = document.getElementById("account-edit-bitget-passphrase")?.value?.trim();
      
      if (!apiKey || !apiSecret || !passphrase) {
        this.showToast("error", this.translate("common.error", "Error"), this.translate("accounts.messages.validation.missingBitget", "Please fill in all Bitget credentials"));
        return null;
      }
      
      data.api_key = apiKey;
      data.api_secret = apiSecret;
      data.api_passphrase = passphrase;
      data.use_paper = false; // Bitget V2 API doesn't support paper trading flag in the same way, or we default to false
    } else {
      const apiKey = document.getElementById("account-edit-binance-key")?.value?.trim();
      const apiSecret = document.getElementById("account-edit-binance-secret")?.value?.trim();
      const useTestnet = document.getElementById("account-edit-binance-testnet")?.checked || false;
      
      if (!apiKey || !apiSecret) {
        this.showToast("error", this.translate("common.error", "Error"), this.translate("accounts.messages.validation.missingBinance", "Please fill in all Binance credentials"));
        return null;
      }
      
      data.api_key = apiKey;
      data.api_secret = apiSecret;
      data.use_paper = useTestnet;
    }
    
    return data;
  }

  async testAccountFormConnection() {
    const formData = this.collectAccountFormData();
    if (!formData) return;
    const testBtn = document.getElementById("account-form-test");
    
    // Clear previous result
    const resultContainer = document.getElementById("account-form-test-result");
    if (resultContainer) {
      resultContainer.style.display = "none";
      resultContainer.className = "api-test-result";
      resultContainer.innerHTML = "";
    }

    this.setButtonLoading(testBtn, true, "accounts.form.testConnection", "accounts.actions.testing");
    // this.showToast("info", this.translate("common.info", "Info"), this.translate("accounts.messages.testInProgress", "Testing connection..."));
    
    try {
      const csrfToken = this.getCsrfToken();
      const response = await fetch("/api/accounts/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        credentials: "include",
        body: JSON.stringify(formData),
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        const balanceLabel = result.balance
          ? ` ${this.translate("accounts.messages.balanceLabel", "(Equity: {{balance}})", { balance: result.balance })}`
          : "";
        const successMessage = `${this.translate("accounts.messages.testSuccess", "Connection successful")}${balanceLabel}`.trim();
        this.displayApiTestResult("account-form-test-result", "success", successMessage);
      } else {
        const errorMessage = result.error || this.translate("accounts.messages.testFailed", "Connection failed");
        this.displayApiTestResult("account-form-test-result", "error", errorMessage);
      }
    } catch (error) {
      console.error("测试连接失败:", error);
      const message = error instanceof Error ? error.message : String(error);
      this.displayApiTestResult("account-form-test-result", "error", message);
    } finally {
      this.setButtonLoading(testBtn, false, "accounts.form.testConnection");
    }
  }

  async testAccountConnection(accountId, triggerBtn) {
    if (!Number.isFinite(accountId) || accountId <= 0) {
      this.showButtonInlineStatus(
        triggerBtn,
        this.translate("accounts.messages.loadError", "Failed to load account data"),
        "error",
        3000,
        "accounts.actions.test"
      );
      return;
    }

    this.setButtonLoading(triggerBtn, true, "accounts.actions.test", "accounts.actions.testing");

    let inlineStatus = null;

    try {
      const csrfToken = this.getCsrfToken();
      const response = await fetch(`/api/accounts/${accountId}/test`, {
        method: "POST",
        headers: {
          "X-CSRF-Token": csrfToken,
        },
        credentials: "include",
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result?.success) {
        const errorMessage = result?.error || this.translate("accounts.messages.testFailed", "Connection failed");
        inlineStatus = { type: "error", message: errorMessage };
      } else {
        const balanceLabel = result?.balance
          ? ` ${this.translate("accounts.messages.balanceLabel", "(Equity: {{balance}})", { balance: result.balance })}`
          : "";
        const successMessage = `${this.translate("accounts.messages.testSuccess", "Connection successful")}${balanceLabel}`.trim();
        inlineStatus = { type: "success", message: successMessage };
      }
    } catch (error) {
      console.error("测试账户连接失败:", error);
      const message = error instanceof Error ? error.message : String(error);
      inlineStatus = { type: "error", message };
    } finally {
      this.setButtonLoading(triggerBtn, false, "accounts.actions.test");
      if (inlineStatus?.message) {
        this.showButtonInlineStatus(
          triggerBtn,
          inlineStatus.message,
          inlineStatus.type,
          3000,
          "accounts.actions.test"
        );
      }
    }
  }

  async activateAccount(accountId, triggerBtn) {
    this.setButtonLoading(triggerBtn, true, "accounts.actions.activate", "accounts.actions.activating");
    
    try {
      const csrfToken = this.getCsrfToken();
      const response = await fetch(`/api/accounts/${accountId}/activate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        credentials: "include",
      });
      const payload = await response.json();
      
      if (!response.ok) {
        throw new Error(payload.error || "Failed to activate account");
      }
      
      const successMessage = payload.message || this.translate("accounts.messages.activateSuccess", "Account activated");
      this.showToast("success", this.translate("common.success", "Success"), successMessage);
      await this.loadAccountsList();
      try {
        await this.refreshAll();
      } catch (refreshError) {
        console.warn("切换账户后刷新仪表盘失败", refreshError);
      }
      
    } catch (error) {
      console.error("激活账户失败:", error);
      const message = error instanceof Error ? error.message : String(error);
      this.showToast("error", this.translate("common.error", "Error"), message);
    } finally {
      this.setButtonLoading(triggerBtn, false, "accounts.actions.activate");
    }
  }

  async deleteAccount(accountId, triggerBtn) {
    const confirmMessage = this.translate(
      "accounts.messages.deleteConfirm",
      "Delete this account? This action cannot be undone."
    );
    if (!window.confirm(confirmMessage)) {
      return;
    }

    this.setButtonLoading(triggerBtn, true, "accounts.actions.delete", "accounts.actions.deleting");
    
    try {
      const csrfToken = this.getCsrfToken();
      const response = await fetch(`/api/accounts/${accountId}`, {
        method: "DELETE",
        headers: {
          "X-CSRF-Token": csrfToken,
        },
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete account");
      }
      
      this.showToast("success", this.translate("common.success", "Success"), this.translate("accounts.messages.deleteSuccess", "Account deleted"));
      await this.loadAccountsList();
      
    } catch (error) {
      console.error("删除账户失败:", error);
      const message = error instanceof Error ? error.message : String(error);
      this.showToast("error", this.translate("common.error", "Error"), message);
    } finally {
      this.setButtonLoading(triggerBtn, false, "accounts.actions.delete");
    }
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  formatDate(dateString) {
    if (!dateString) return "N/A";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString() + " " + date.toLocaleTimeString();
    } catch {
      return "N/A";
    }
  }

  translate(key, fallback = "", replacements) {
    try {
      if (typeof t === "function") {
        const value = t(key, replacements);
        if (value && value !== key) {
          return value;
        }
      }
    } catch (error) {
      console.warn("翻译失败", { key, error });
    }

    const template = fallback || key;
    if (replacements && typeof replacements === "object") {
      return template.replace(/\{\{(\w+)\}\}/g, (match, token) => {
        if (Object.prototype.hasOwnProperty.call(replacements, token)) {
          return String(replacements[token]);
        }
        return match;
      });
    }
    return template;
  }

  setButtonLoading(button, isLoading, idleKey, loadingKey) {
    if (!button) return;
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent?.trim() || "";
    }

    this.clearButtonStatusState(button);

    if (isLoading) {
      button.classList.add("is-loading");
      button.disabled = true;
      if (loadingKey) {
        const loadingText = this.translate(loadingKey, button.dataset.originalText);
        if (loadingText) {
          button.textContent = loadingText;
        }
      }
    } else {
      button.classList.remove("is-loading");
      button.disabled = false;
      const idleText = idleKey ? this.translate(idleKey, button.dataset.originalText) : button.dataset.originalText;
      if (idleText) {
        button.textContent = idleText;
      }
    }
  }

  clearButtonStatusState(button) {
    if (!button) return;
    button.classList.remove("status-success", "status-error", "status-info");
    if (button.dataset.statusTimeoutId) {
      window.clearTimeout(Number(button.dataset.statusTimeoutId));
      delete button.dataset.statusTimeoutId;
    }
  }

  showButtonInlineStatus(button, message, type = "info", duration = 2500, idleKey = null) {
    if (!button || !message) return;
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent?.trim() || "";
    }

    this.clearButtonStatusState(button);

    const className =
      type === "success"
        ? "status-success"
        : type === "error"
          ? "status-error"
          : "status-info";
    if (className) {
      button.classList.add(className);
    }

    button.textContent = message;

    if (duration === null) {
      delete button.dataset.statusTimeoutId;
      return;
    }

    const timeoutId = window.setTimeout(() => {
      this.clearButtonStatusState(button);
      const idleText = idleKey
        ? this.translate(idleKey, button.dataset.originalText)
        : button.dataset.originalText;
      if (idleText) {
        button.textContent = idleText;
      }
    }, duration);

    button.dataset.statusTimeoutId = String(timeoutId);
  }

  // ====== Strategy Instance 管理功能 ======

  bindInstancesListEvents() {
    const addBtn = document.getElementById("add-instance-btn");
    if (addBtn && !addBtn.dataset.bound) {
      addBtn.dataset.bound = "true";
      addBtn.addEventListener("click", () => this.openInstanceFormModal());
    }

    const container = document.getElementById("instances-list-container");
    if (container && !container.dataset.bound) {
      container.dataset.bound = "true";
      container.addEventListener("click", (event) => {
        const actionBtn = event.target.closest("[data-instance-action]");
        if (!actionBtn) return;
        const action = actionBtn.dataset.instanceAction;
        const instanceId = Number(actionBtn.dataset.instanceId);
        if (!action || !Number.isFinite(instanceId)) {
          return;
        }
        void this.handleInstanceAction(action, instanceId, actionBtn);
      });
    }
  }

  bindInstanceTableActions(targetEl) {
    if (!targetEl || targetEl.dataset.actionsBound === "true") {
      return;
    }

    targetEl.dataset.actionsBound = "true";
    targetEl.addEventListener("click", (event) => {
      const actionBtn = event.target.closest("[data-instance-action]");
      if (!actionBtn) {
        return;
      }

      event.preventDefault();
      const action = actionBtn.dataset.instanceAction;
      const instanceId = Number(actionBtn.dataset.instanceId);
      if (!action || !Number.isFinite(instanceId)) {
        return;
      }

      void this.handleInstanceAction(action, instanceId, actionBtn);
    });
  }

  initStrategyBottomTabs() {
    if (!this.strategyBottomTabsEl) {
      return;
    }

    const nav = this.strategyBottomTabsEl.querySelector(".tab-nav");
    const content = this.strategyBottomTabsEl.querySelector(".tab-content");
    if (!nav || !content) {
      return;
    }

    nav.addEventListener("click", (event) => {
      const button = event.target.closest(".tab-btn");
      if (!button) {
        return;
      }

      const { tab } = button.dataset;
      if (!tab) {
        return;
      }

      nav.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.classList.toggle("active", btn === button);
      });

      content.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === `tab-${tab}`);
      });
    });
  }

  normalizeInstanceStatus(status) {
    // 统一实例状态文本，兼容旧数据中的大写/异常值
    if (typeof status !== "string") {
      return "stopped";
    }
    const normalized = status.trim().toLowerCase();
    if (normalized === "running" || normalized === "paused" || normalized === "stopped") {
      return normalized;
    }
    return "stopped";
  }

  bindInstanceFormEvents() {
    if (this.instanceEditForm && !this.instanceEditForm.dataset.bound) {
      this.instanceEditForm.dataset.bound = "true";
      this.instanceEditForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void this.submitInstanceForm();
      });
    }
  }

  async handleInstanceAction(action, instanceId, triggerBtn) {
    switch (action) {
      case "edit":
        await this.openInstanceFormModal(instanceId);
        break;
      case "delete":
        await this.deleteInstance(instanceId, triggerBtn);
        break;
      case "start":
      case "pause":
      case "stop":
        await this.updateInstanceStatus(instanceId, action, triggerBtn);
        break;
      case "trigger":
        await this.triggerInstance(instanceId, triggerBtn);
        break;
      default:
        break;
    }
  }

  async loadInstancesList() {
    const container = document.getElementById("instances-list-container");
    const loading = document.getElementById("instances-loading");
    if (!container) return;

    if (!this.isAuthenticated) {
      if (loading) loading.style.display = "none";
      this.instancesCache = [];
      this.instancesCacheLoaded = false;
      container.innerHTML = `
        <div class="empty-accounts">
          <div class="empty-accounts-text">${this.escapeHtml(this.translate("instances.messages.loginRequired", "Please sign in to manage strategy tasks."))}</div>
        </div>
      `;
      this.renderAllTasks([]);
      this.renderRunningTasks([]);
      return;
    }

    try {
      if (loading) loading.style.display = "flex";
      const instances = await this.fetchInstancesData();
      if (loading) loading.style.display = "none";

      if (!instances.length) {
        container.innerHTML = `
          <div class="empty-accounts">
            <div class="empty-accounts-icon">🧠</div>
            <div class="empty-accounts-text">${this.escapeHtml(this.translate("instances.empty", "No strategy tasks configured"))}</div>
          </div>
        `;
        this.renderAllTasks([]);
        this.renderRunningTasks([]);
        return;
      }

      container.innerHTML = instances.map((instance) => this.renderInstanceCard(instance)).join("");
      this.renderAllTasks(instances);
      this.renderRunningTasks(
        instances.filter((item) => this.normalizeInstanceStatus(item.status) === "running"),
      );
    } catch (error) {
      console.error("加载策略任务失败:", error);
      if (loading) loading.style.display = "none";
      this.instancesCacheLoaded = false;
      const message = this.translate("instances.messages.loadError", "Failed to load strategy tasks.");
      container.innerHTML = `
        <div class="empty-accounts">
          <div class="empty-accounts-text" style="color: var(--accent-red);">${this.escapeHtml(message)}</div>
        </div>
      `;
      this.renderAllTasks([]);
      this.renderRunningTasks([]);
      this.showToast("error", this.translate("common.error", "Error"), message);
    }
  }

  async fetchInstancesData() {
    if (!this.isAuthenticated) {
      this.instancesCache = [];
      this.instancesCacheLoaded = false;
      return [];
    }

    try {
      const response = await fetch("/api/trading-instances", {
        credentials: "include",
      });

      if (response.status === 401) {
        this.instancesCache = [];
        this.instancesCacheLoaded = false;
        return [];
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json().catch(() => ({}));
      const instances = Array.isArray(payload?.instances) ? payload.instances : [];
      this.instancesCache = instances;
      this.instancesCacheLoaded = true;
      return instances;
    } catch (error) {
      this.instancesCacheLoaded = false;
      throw error;
    }
  }

  renderInstanceCard(instance) {
    const normalizedStatus = this.normalizeInstanceStatus(instance?.status);
    const statusKey = `instances.status.${normalizedStatus}`;
    const statusLabel = this.translate(statusKey, normalizedStatus);
    const strategyLabel = this.translate("instances.labels.strategy", "Strategy");
    const accountLabel = this.translate("instances.labels.account", "Account");
    const modelLabel = this.translate("instances.labels.model", "AI Model");
    const intervalLabel = this.translate("instances.labels.interval", "Interval");
    const lastExecutedLabel = this.translate("instances.labels.lastExecuted", "Last Executed");
    const intervalValue = Number(instance?.interval_minutes) || null;
    const lastExecuted = instance?.last_executed_at ? this.formatDate(instance.last_executed_at) : "--";

    const actionButtons = [
      this.renderInstanceActionButton("start", instance, normalizedStatus),
      this.renderInstanceActionButton("pause", instance, normalizedStatus),
      this.renderInstanceActionButton("stop", instance, normalizedStatus),
      this.renderInstanceActionButton("trigger", instance, normalizedStatus),
      this.renderInstanceActionButton("edit", instance, normalizedStatus),
      this.renderInstanceActionButton("delete", instance, normalizedStatus),
    ]
      .filter(Boolean)
      .join("");

    return `
      <div class="account-card instance-card" data-instance-id="${instance.id}">
        <div class="account-card-info">
          <div class="account-card-header">
            <div class="instance-name">${this.escapeHtml(instance.name || `#${instance.id}`)}</div>
            <span class="instance-status-badge status-${this.escapeHtml(normalizedStatus)}">${this.escapeHtml(statusLabel)}</span>
          </div>
          <div class="instance-meta">
            <div>${this.escapeHtml(strategyLabel)}: <strong>${this.escapeHtml(instance.strategy_name || "--")}</strong></div>
            <div>${this.escapeHtml(accountLabel)}: ${this.escapeHtml(instance.account_name || "--")}</div>
            <div>${this.escapeHtml(modelLabel)}: ${this.escapeHtml(instance.ai_model_name || instance.model_name || "--")}</div>
            <div>${this.escapeHtml(intervalLabel)}: ${intervalValue ? `${intervalValue}m` : "--"}</div>
            <div>${this.escapeHtml(lastExecutedLabel)}: ${this.escapeHtml(lastExecuted)}</div>
          </div>
        </div>
        <div class="account-card-actions instance-actions">
          ${actionButtons}
        </div>
      </div>
    `;
  }

  renderInstanceActionButton(action, instance, statusOverride = null) {
    const status = statusOverride ? this.normalizeInstanceStatus(statusOverride) : this.normalizeInstanceStatus(instance?.status);
    let disabled = false;
    if (action === "start") {
      disabled = status === "running";
    } else if (action === "pause") {
      disabled = status !== "running";
    } else if (action === "stop") {
      disabled = status === "stopped";
    }
    const label = this.translate(`instances.actions.${action}`, action);
    const statusClass = action === "delete" ? "btn-delete" : action === "start" ? "btn-activate" : "";
    return `
      <button class="account-action-btn ${statusClass}" data-instance-action="${action}" data-instance-id="${instance.id}" ${disabled ? "disabled" : ""}>${this.escapeHtml(label)}</button>
    `;
  }

  async openInstanceFormModal(instanceId = null) {
    if (!this.instanceFormModal || !this.instanceEditForm) {
      return;
    }

    this.instanceEditForm.reset();
    const idField = document.getElementById("instance-edit-id");
    if (idField) {
      idField.value = instanceId ? String(instanceId) : "";
    }

    const title = document.getElementById("instance-form-title");
    const titleKey = instanceId ? "instances.form.titleEdit" : "instances.form.titleAdd";
    if (title) {
      title.setAttribute("data-i18n", titleKey);
      title.textContent = this.translate(titleKey, instanceId ? "Edit Strategy Task" : "Add Strategy Task");
    }

    let existing = null;
    if (instanceId) {
      existing = await this.ensureInstanceLoaded(instanceId);
      if (!existing) {
        this.showToast("error", this.translate("common.error", "Error"), this.translate("instances.messages.loadError", "Failed to load strategy tasks."));
        return;
      }
    }

    await this.populateInstanceFormOptions({
      accountId: existing?.account_id,
      aiModelId: existing?.ai_model_id,
      strategyName: existing?.strategy_name,
    });

    if (existing) {
      const nameInput = document.getElementById("instance-edit-name");
      if (nameInput) {
        nameInput.value = existing.name || "";
      }
    }

    this.showModal(this.instanceFormModal);
  }

  async ensureInstanceLoaded(instanceId) {
    if (!this.instancesCacheLoaded || !Array.isArray(this.instancesCache) || !this.instancesCache.length) {
      await this.fetchInstancesData();
    }
    return this.instancesCache.find((item) => item.id === instanceId) || null;
  }

  async populateInstanceFormOptions(defaults = {}) {
    const [accounts, models, strategies] = await Promise.all([
      this.fetchAccountsForSelect(),
      this.fetchAiModelsForSelect(),
      this.fetchStrategyFilesForSelect(),
    ]);

    const accountSelect = document.getElementById("instance-edit-account");
    if (accountSelect) {
      accountSelect.innerHTML = `
        <option value="">${this.escapeHtml(this.translate("instances.form.selectAccount", "Select an account"))}</option>
        ${accounts
          .map((account) => `
            <option value="${account.id}" ${defaults.accountId === account.id ? "selected" : ""}>${this.escapeHtml(account.name || `Account ${account.id}`)}</option>
          `)
          .join("")}
      `;
    }

    const modelSelect = document.getElementById("instance-edit-ai-model");
    if (modelSelect) {
      modelSelect.innerHTML = `
        <option value="">${this.escapeHtml(this.translate("instances.form.selectModel", "Select an AI model"))}</option>
        ${models
          .map((model) => `
            <option value="${model.id}" ${defaults.aiModelId === model.id ? "selected" : ""}>${this.escapeHtml(model.name || model.model_name || `Model ${model.id}`)}</option>
          `)
          .join("")}
      `;
    }

    const strategySelect = document.getElementById("instance-edit-strategy");
    if (strategySelect) {
      strategySelect.innerHTML = `
        <option value="">${this.escapeHtml(this.translate("instances.form.selectStrategy", "Select a strategy"))}</option>
        ${strategies
          .map((name) => `
            <option value="${this.escapeHtml(name)}" ${defaults.strategyName === name ? "selected" : ""}>${this.escapeHtml(name)}</option>
          `)
          .join("")}
      `;
    }
  }

  async fetchAccountsForSelect() {
    if (Array.isArray(this.accountsCache) && this.accountsCache.length) {
      return this.accountsCache;
    }

    try {
      const response = await fetch("/api/accounts", { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to fetch accounts");
      }
      const data = await response.json();
      const accounts = data?.accounts || [];
      this.accountsCache = accounts;
      this.updateAccountSwitcherDisplay();
      return accounts;
    } catch (error) {
      console.error("加载账户列表失败:", error);
      return [];
    }
  }

  async fetchAiModelsForSelect() {
    if (Array.isArray(this.aiModelsCache) && this.aiModelsCache.length) {
      return this.aiModelsCache;
    }

    try {
      const response = await fetch("/api/ai-models", { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to fetch AI models");
      }
      const data = await response.json();
      const models = data?.models || [];
      this.aiModelsCache = models;
      return models;
    } catch (error) {
      console.error("加载 AI 模型失败:", error);
      return [];
    }
  }

  async fetchStrategyFilesForSelect() {
    if (Array.isArray(this.strategyFilesCache) && this.strategyFilesCache.length) {
      return this.strategyFilesCache;
    }

    try {
      const response = await fetch("/api/strategies", { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to fetch strategies");
      }
      const data = await response.json();
      const strategies = Array.isArray(data?.strategies) ? data.strategies : [];
      this.strategyFilesCache = strategies.map((item) => item?.name).filter(Boolean);
      return this.strategyFilesCache;
    } catch (error) {
      console.error("加载策略文件失败:", error);
      this.strategyFilesCache = [];
      return [];
    }
  }

  collectInstanceFormData() {
    const nameInput = document.getElementById("instance-edit-name");
    const accountSelect = document.getElementById("instance-edit-account");
    const modelSelect = document.getElementById("instance-edit-ai-model");
    const strategySelect = document.getElementById("instance-edit-strategy");

    const name = nameInput?.value?.trim();
    const accountValue = accountSelect?.value ?? "";
    const modelValue = modelSelect?.value ?? "";
    const strategyName = strategySelect?.value?.trim();
    const accountId = accountValue ? Number(accountValue) : null;
    const aiModelId = modelValue ? Number(modelValue) : null;

    if (!name) {
      this.showToast("error", this.translate("common.error", "Error"), this.translate("instances.messages.validation.missingName", "Please enter an instance name"));
      return null;
    }

    if (!accountValue || !Number.isFinite(accountId)) {
      this.showToast("error", this.translate("common.error", "Error"), this.translate("instances.messages.validation.missingAccount", "Please select an account"));
      return null;
    }

    if (!modelValue || !Number.isFinite(aiModelId)) {
      this.showToast("error", this.translate("common.error", "Error"), this.translate("instances.messages.validation.missingModel", "Please select an AI model"));
      return null;
    }

    if (!strategyName) {
      this.showToast("error", this.translate("common.error", "Error"), this.translate("instances.messages.validation.missingStrategy", "Please select a strategy"));
      return null;
    }

    return {
      name,
      account_id: accountId,
      ai_model_id: aiModelId,
      strategy_name: strategyName,
    };
  }

  async submitInstanceForm() {
    const payload = this.collectInstanceFormData();
    if (!payload) {
      return;
    }

    const idField = document.getElementById("instance-edit-id");
    const instanceId = idField?.value ? Number(idField.value) : null;

    try {
      const csrfToken = this.getCsrfToken();
      const url = instanceId ? `/api/trading-instances/${instanceId}` : "/api/trading-instances";
      const method = instanceId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error || "Failed to save instance");
      }

      const successKey = instanceId ? "instances.messages.updateSuccess" : "instances.messages.createSuccess";
      this.showToast("success", this.translate("common.success", "Success"), this.translate(successKey, "Saved successfully"));
      this.hideModal(this.instanceFormModal);
      await this.loadInstancesList();
      await this.refreshRunningTasksPanel(true);
    } catch (error) {
      console.error("保存策略任务失败:", error);
      const message = error instanceof Error ? error.message : String(error);
      this.showToast("error", this.translate("common.error", "Error"), message);
    }
  }

  async updateInstanceStatus(instanceId, action, triggerBtn) {
    if (!Number.isFinite(instanceId)) {
      return;
    }

    this.setButtonLoading(triggerBtn, true, null, `instances.actions.${action}`);

    try {
      const csrfToken = this.getCsrfToken();
      const response = await fetch(`/api/trading-instances/${instanceId}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "X-CSRF-Token": csrfToken,
        },
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update status");
      }

      this.showToast("success", this.translate("common.success", "Success"), payload?.message || this.translate("instances.messages.statusSuccess", "Status updated"));
      await this.loadInstancesList();
      await this.refreshRunningTasksPanel(true);
    } catch (error) {
      console.error("更新策略任务状态失败:", error);
      const message = error instanceof Error ? error.message : String(error);
      this.showToast("error", this.translate("common.error", "Error"), message);
    } finally {
      this.setButtonLoading(triggerBtn, false, `instances.actions.${action}`);
    }
  }

  async triggerInstance(instanceId, triggerBtn) {
    if (!Number.isFinite(instanceId)) {
      return;
    }

    this.setButtonLoading(triggerBtn, true, "instances.actions.trigger", "instances.actions.trigger");

    try {
      const csrfToken = this.getCsrfToken();
      const response = await fetch(`/api/trading-instances/${instanceId}/trigger`, {
        method: "POST",
        credentials: "include",
        headers: {
          "X-CSRF-Token": csrfToken,
        },
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.message || "Failed to trigger instance");
      }

      this.showToast("success", this.translate("common.success", "Success"), payload?.message || this.translate("instances.messages.triggerSuccess", "Execution triggered"));
      this.scheduleRunningTasksRefresh();
    } catch (error) {
      console.error("触发策略任务失败:", error);
      const message = error instanceof Error ? error.message : String(error);
      this.showToast("error", this.translate("common.error", "Error"), message);
    } finally {
      this.setButtonLoading(triggerBtn, false, "instances.actions.trigger");
    }
  }

  async deleteInstance(instanceId, triggerBtn) {
    if (!Number.isFinite(instanceId)) {
      return;
    }

    const instance = this.instancesCache.find((item) => item.id === instanceId) || null;
    const confirmMessage = this.translate("instances.messages.deleteConfirm", 'Delete strategy task "{{name}}"?', { name: instance?.name || `#${instanceId}` });
    if (!window.confirm(confirmMessage)) {
      return;
    }

    this.setButtonLoading(triggerBtn, true, "instances.actions.delete", "instances.actions.delete");

    try {
      const csrfToken = this.getCsrfToken();
      const response = await fetch(`/api/trading-instances/${instanceId}`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "X-CSRF-Token": csrfToken,
        },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to delete instance");
      }

      this.showToast("success", this.translate("common.success", "Success"), this.translate("instances.messages.deleteSuccess", "Strategy task deleted"));
      await this.loadInstancesList();
      await this.refreshRunningTasksPanel(true);
    } catch (error) {
      console.error("删除策略任务失败:", error);
      const message = error instanceof Error ? error.message : String(error);
      this.showToast("error", this.translate("common.error", "Error"), message);
    } finally {
      this.setButtonLoading(triggerBtn, false, "instances.actions.delete");
    }
  }

  async refreshRunningTasksPanel(forceFetch = false) {
    const noRunningTargets = !this.runningTasksListEl || !this.runningTasksEmptyEl;
    const noAllTargets = !this.allTasksListEl || !this.allTasksEmptyEl;
    if (noRunningTargets && noAllTargets) {
      return;
    }

    if (!this.isAuthenticated) {
      this.renderAllTasks([]);
      this.renderRunningTasks([]);
      return;
    }

    try {
      let instances = this.instancesCache;
      if (forceFetch || !this.instancesCacheLoaded || !Array.isArray(instances)) {
        instances = await this.fetchInstancesData();
      }
      const normalizedInstances = Array.isArray(instances) ? instances : [];
      this.renderAllTasks(normalizedInstances);
      const runningInstances = normalizedInstances.filter((item) => this.normalizeInstanceStatus(item.status) === "running");
      this.renderRunningTasks(runningInstances);
    } catch (error) {
      console.warn("刷新运行任务面板失败:", error);
      this.renderAllTasks([]);
      this.renderRunningTasks([]);
    }
  }

  renderAllTasks(instances) {
    this.renderInstanceTable(instances, this.allTasksListEl, this.allTasksEmptyEl, {
      showStartForStopped: true,
    });
  }

  renderRunningTasks(instances) {
    this.renderInstanceTable(instances, this.runningTasksListEl, this.runningTasksEmptyEl);
  }

  renderInstanceTable(instances, listEl, emptyEl, options = {}) {
    if (!listEl || !emptyEl) {
      return;
    }

    const items = Array.isArray(instances) ? instances : [];

    if (!items.length) {
      listEl.innerHTML = "";
      emptyEl.style.display = "flex";
      return;
    }

    emptyEl.style.display = "none";
    const headers = {
      instance: this.translate("instances.labels.instance", "Instance"),
      strategy: this.translate("instances.labels.strategy", "Strategy"),
      account: this.translate("instances.labels.account", "Account"),
      model: this.translate("instances.labels.model", "AI Model"),
      interval: this.translate("instances.labels.interval", "Interval"),
      lastExecuted: this.translate("instances.labels.lastExecuted", "Last Executed"),
      status: this.translate("tables.logs.headers.status", "Status"),
      actions: this.translate("instances.labels.actions", "Actions"),
    };

    const rows = items
      .map((instance) => {
        const normalizedStatus = this.normalizeInstanceStatus(instance.status);
        const statusLabel = this.translate(`instances.status.${normalizedStatus}`, normalizedStatus);
        const lastExecuted = instance.last_executed_at ? this.formatDate(instance.last_executed_at) : "--";
        const intervalValue = Number(instance.interval_minutes) || null;
        const strategyName = instance.strategy_name || "--";
        const modelName = instance.ai_model_name || instance.model_name || "--";
        const accountName = instance.account_name || "--";
        const actionsCell = this.renderInstanceActions(instance, normalizedStatus, options);
        return `
          <tr>
            <td>${this.escapeHtml(instance.name || `#${instance.id}`)}</td>
            <td>${this.escapeHtml(strategyName)}</td>
            <td>${this.escapeHtml(accountName)}</td>
            <td>${this.escapeHtml(modelName)}</td>
            <td>${this.escapeHtml(intervalValue ? `${intervalValue}m` : "--")}</td>
            <td>${this.escapeHtml(lastExecuted)}</td>
            <td>
              <div class="running-task-status">
                <span class="instance-status-badge status-${this.escapeHtml(normalizedStatus)}">${this.escapeHtml(statusLabel)}</span>
              </div>
            </td>
            <td>${actionsCell}</td>
          </tr>
        `;
      })
      .join("");

    listEl.innerHTML = `
      <table class="data-table running-tasks-table">
        <thead>
          <tr>
            <th>${this.escapeHtml(headers.instance)}</th>
            <th>${this.escapeHtml(headers.strategy)}</th>
            <th>${this.escapeHtml(headers.account)}</th>
            <th>${this.escapeHtml(headers.model)}</th>
            <th>${this.escapeHtml(headers.interval)}</th>
            <th>${this.escapeHtml(headers.lastExecuted)}</th>
            <th>${this.escapeHtml(headers.status)}</th>
            <th>${this.escapeHtml(headers.actions)}</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }

  renderInstanceActions(instance, normalizedStatus, options = {}) {
    if (!instance || !instance.id) {
      return "--";
    }

    const showStartForStopped = Boolean(options.showStartForStopped);
    const actions = [];
    if (showStartForStopped && normalizedStatus === "stopped") {
      actions.push("start");
    } else {
      actions.push("stop");
    }
    actions.push("edit", "delete");

    const buttons = actions
      .map((action) => this.renderInstanceActionButton(action, instance, normalizedStatus))
      .filter(Boolean)
      .join("");

    if (!buttons) {
      return "--";
    }

    return `<div class="running-task-actions">${buttons}</div>`;
  }

  renderInstanceActionButton(action, instance, normalizedStatus) {
    if (!instance || typeof instance.id !== "number") {
      return "";
    }

    const label = this.translate(`instances.actions.${action}`, action);
    if (!label) {
      return "";
    }

    let disabled = false;
    if (action === "stop") {
      disabled = normalizedStatus === "stopped";
    }

    const extraClass = action === "delete" ? "btn-delete" : "";
    return `
      <button type="button" class="account-action-btn running-task-action-btn ${extraClass}" data-instance-action="${action}" data-instance-id="${instance.id}" ${disabled ? "disabled" : ""}>
        ${this.escapeHtml(label)}
      </button>
    `;
  }

  handleInstanceStatusMessage(message) {
    if (!message || typeof message.instanceId !== "number") {
      return;
    }
    this.scheduleRunningTasksRefresh();
  }

  scheduleRunningTasksRefresh() {
    if (this.runningTasksRefreshTimer) {
      return;
    }
    this.runningTasksRefreshTimer = window.setTimeout(() => {
      this.runningTasksRefreshTimer = null;
      void this.refreshRunningTasksPanel(true);
    }, 600);
  }

  // 多任务模式下不再需要账户激活弹出确认框相关事件处理

  // ========== AI 模型管理 ==========

  async loadAiModelsList() {
    const container = document.getElementById("ai-models-list-container");
    const loading = document.getElementById("ai-models-loading");
    
    if (!container) return;
    
    try {
      if (loading) {
        loading.style.display = "flex";
      }
      
      const response = await fetch("/api/ai-models", {
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("获取 AI 模型列表失败");
      }
      
      const data = await response.json();
      const models = data.models || [];
      this.aiModelsCache = models;

      if (loading) {
        loading.style.display = "none";
      }
      
      if (models.length === 0) {
        const emptyText = this.translate("aiModels.empty", "No AI models configured");
        const emptyHint = this.translate("aiModels.emptyHint", "Click the button above to add your first AI model");
        container.innerHTML = `
          <div class="empty-accounts">
            <div class="empty-accounts-icon">🤖</div>
            <div class="empty-accounts-text">${this.escapeHtml(emptyText)}</div>
            <div class="empty-accounts-hint">${this.escapeHtml(emptyHint)}</div>
          </div>
        `;
        this.bindAiModelCardEvents();
        return;
      }
      
      container.innerHTML = models.map(model => this.renderAiModelCard(model)).join("");
      this.bindAiModelCardEvents();
      
    } catch (error) {
      console.error("加载 AI 模型列表失败:", error);
      this.aiModelsCache = [];
      if (loading) {
        loading.style.display = "none";
      }
      const errorText = this.translate("aiModels.messages.loadError", "加载失败，请稍后重试");
      container.innerHTML = `
        <div class="empty-accounts">
          <div class="empty-accounts-text" style="color: var(--accent-red);">${this.escapeHtml(errorText)}</div>
        </div>
      `;
      this.showToast("error", this.translate("common.error", "Error"), errorText);
    }
  }

  getAiModelIcon(modelName) {
    if (!modelName) return DEFAULT_AI_ICON;
    const match = MODEL_ICON_MATCHERS.find(m => m.pattern.test(modelName));
    return match ? match.icon : DEFAULT_AI_ICON;
  }

  renderAiModelCard(model) {
    // 多任务模式下不再需要激活状态和激活按钮
    const editLabel = this.translate("aiModels.edit", "Edit");
    const deleteLabel = this.translate("aiModels.delete", "Delete");
    const testLabel = this.translate("aiModels.test", "Test");

    const iconPath = this.getAiModelIcon(model.model_name || model.name);

    return `
      <div class="account-card" data-model-id="${model.id}">
        <div class="account-card-header">
          <div class="account-card-title" style="display: flex; align-items: center; gap: 8px;">
            <img src="${iconPath}" alt="AI Icon" style="width: 20px; height: 20px; object-fit: contain; border-radius: 4px;">
            <span class="account-name">${this.escapeHtml(model.name)}</span>
          </div>
        </div>
        <div class="account-card-body">
          <div class="account-card-row">
            <span class="account-card-label">Base URL:</span>
            <span class="account-card-value">${this.escapeHtml(model.base_url)}</span>
          </div>
          <div class="account-card-row">
            <span class="account-card-label">Model:</span>
            <span class="account-card-value">${this.escapeHtml(model.model_name)}</span>
          </div>
          <div class="account-card-row">
            <span class="account-card-label">API Key:</span>
            <span class="account-card-value code">${this.escapeHtml(model.api_key_preview)}</span>
          </div>
        </div>
        <div class="account-card-actions">
          <button type="button" class="account-action-btn" data-action="test" data-model-id="${model.id}">${this.escapeHtml(testLabel)}</button>
          <button type="button" class="account-action-btn" data-action="edit" data-model-id="${model.id}">${this.escapeHtml(editLabel)}</button>
          <button type="button" class="account-action-btn account-action-btn-danger" data-action="delete" data-model-id="${model.id}">${this.escapeHtml(deleteLabel)}</button>
        </div>
      </div>
    `;
  }

  bindAiModelAddButton() {
    const addBtn = document.getElementById("add-ai-model-btn");
    if (addBtn && !addBtn.dataset.bound) {
      addBtn.dataset.bound = "true";
      addBtn.addEventListener("click", () => this.openAiModelFormModal());
    }
  }

  bindAiModelCardEvents() {
    this.bindAiModelAddButton();

    const container = document.getElementById("ai-models-list-container");
    if (!container) return;

    // Use event delegation for better performance and dynamic content handling
    if (container.dataset.bound) return;
    container.dataset.bound = "true";

    container.addEventListener("click", async (e) => {
      const target = e.target;
      if (!target) return;

      // 多任务模式下不再需要激活相关的事件处理

      // Handle other actions
      const actionBtn = target.closest("[data-action]");
      if (actionBtn) {
        const action = actionBtn.dataset.action;
        const modelId = actionBtn.dataset.modelId;
        
        switch (action) {
          case "edit":
            await this.openAiModelFormModal(Number(modelId));
            break;
          case "delete":
            await this.deleteAiModel(Number(modelId), actionBtn);
            break;
          case "test":
            await this.testAiModelConnection(Number(modelId), actionBtn);
            break;
        }
      }
    });
  }

  // 多任务模式下不再需要 AI 模型激活弹出确认框相关事件处理

  async openAiModelFormModal(modelId = null) {
    const modal = document.getElementById("ai-model-form-modal");
    const form = document.getElementById("ai-model-edit-form");
    
    if (!modal || !form) return;
    
    const title = document.getElementById("ai-model-form-title");
    const idField = document.getElementById("ai-model-edit-id");
    
    // 重置表单
    form.reset();
    if (idField) idField.value = "";
    
    const titleKey = modelId ? "modals.aiModelForm.titleEdit" : "modals.aiModelForm.titleAdd";
    if (title) {
      title.setAttribute("data-i18n", titleKey);
      title.textContent = this.translate(titleKey, modelId ? "Edit AI Model" : "Add AI Model");
    }

    if (modelId) {
      // 编辑模式 - 从API获取完整模型数据（包括完整API Key）
      try {
        const response = await fetch(`/api/ai-models/${modelId}`, {
          credentials: "include",
        });
        
        if (response.ok) {
          const data = await response.json();
          const model = data.model;
          
          if (model) {
            if (idField) idField.value = model.id;
            const nameField = document.getElementById("ai-model-edit-name");
            const baseUrlField = document.getElementById("ai-model-edit-base-url");
            const apiKeyField = document.getElementById("ai-model-edit-api-key");
            const modelNameField = document.getElementById("ai-model-edit-model-name");
            
            if (nameField) nameField.value = model.name;
            if (baseUrlField) baseUrlField.value = model.base_url;
            if (apiKeyField) apiKeyField.value = model.api_key || ""; // 显示完整 API Key
            if (modelNameField) modelNameField.value = model.model_name;
            
            // 同步 base URL 预设选择器
            const preset = document.getElementById("ai-model-base-url-preset");
            if (preset && baseUrlField) {
              const matchingOption = Array.from(preset.options).find(
                option => option.value && option.value === baseUrlField.value
              );
              preset.value = matchingOption ? matchingOption.value : "";
            }
          }
        }
      } catch (error) {
        console.error("加载 AI 模型数据失败:", error);
        this.showToast("error", this.translate("common.error", "Error"), this.translate("aiModels.messages.loadFailed", "Failed to load model data"));
      }
    }
    
    this.showModal(modal);
    
    // 绑定表单提交
    if (!form.dataset.submitBound) {
      form.dataset.submitBound = "true";
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.submitAiModelForm();
      });
    }
    
    // 绑定取消按钮
    const cancelBtn = document.getElementById("ai-model-cancel");
    if (cancelBtn && !cancelBtn.dataset.bound) {
      cancelBtn.dataset.bound = "true";
      cancelBtn.addEventListener("click", () => this.hideModal(modal));
    }
    
    // 绑定右上角关闭按钮
    const closeBtn = modal.querySelector(".modal-close");
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = "true";
      closeBtn.addEventListener("click", () => this.hideModal(modal));
    }
    
    // 绑定测试按钮
    const testBtn = document.getElementById("ai-model-test");
    if (testBtn && !testBtn.dataset.bound) {
      testBtn.dataset.bound = "true";
      testBtn.addEventListener("click", async () => {
        await this.testAiModelFormConnection();
      });
    }
    
    // 绑定 Base URL 选择器
    this.bindAiModelBaseUrlSelector();
  }

  bindAiModelBaseUrlSelector() {
    const preset = document.getElementById("ai-model-base-url-preset");
    const input = document.getElementById("ai-model-edit-base-url");
    
    if (!preset || !input) return;
    
    if (!preset.dataset.bound) {
      preset.dataset.bound = "true";
      preset.addEventListener("change", (e) => {
        const selectedValue = e.target.value;
        if (selectedValue) {
          input.value = selectedValue;
        } else {
          input.value = "";
          input.focus();
        }
      });
    }
    
    if (!input.dataset.bound) {
      input.dataset.bound = "true";
      input.addEventListener("input", () => {
        const currentValue = input.value.trim();
        const matchingOption = Array.from(preset.options).find(
          option => option.value && option.value === currentValue
        );
        preset.value = matchingOption ? matchingOption.value : "";
      });
    }
  }

  async submitAiModelForm() {
    const form = document.getElementById("ai-model-edit-form");
    const modal = document.getElementById("ai-model-form-modal");
    
    if (!form) return;
    
    const idField = document.getElementById("ai-model-edit-id");
    const nameField = document.getElementById("ai-model-edit-name");
    const baseUrlField = document.getElementById("ai-model-edit-base-url");
    const apiKeyField = document.getElementById("ai-model-edit-api-key");
    const modelNameField = document.getElementById("ai-model-edit-model-name");
    
    const modelId = idField?.value ? Number(idField.value) : null;
    const name = nameField?.value.trim();
    const base_url = baseUrlField?.value.trim();
    const api_key = apiKeyField?.value.trim();
    const model_name = modelNameField?.value.trim();
    
    if (!name || !base_url || !model_name) {
      this.showToast("error", this.translate("common.error", "Error"), this.translate("aiModels.messages.fillRequired", "Please fill in all required fields"));
      return;
    }
    
    // 编辑模式下如果 API Key 为空，不传递该字段
    const payload = {
      name,
      base_url,
      model_name,
    };
    
    if (api_key || !modelId) {
      payload.api_key = api_key;
    }
    
    try {
      const csrfToken = this.getCsrfToken();
      const url = modelId ? `/api/ai-models/${modelId}` : "/api/ai-models";
      const method = modelId ? "PUT" : "POST";
      
      const response = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "保存失败");
      }
      
      const successKey = modelId ? "aiModels.messages.updateSuccess" : "aiModels.messages.createSuccess";
      this.showToast("success", this.translate("common.success", "Success"), this.translate(successKey, "AI model saved"));
      
      if (modal) this.hideModal(modal);
      await this.loadAiModelsList();
      
    } catch (error) {
      console.error("保存 AI 模型失败:", error);
      const message = error instanceof Error ? error.message : String(error);
      this.showToast("error", this.translate("common.error", "Error"), message);
    }
  }

  async testAiModelFormConnection() {
    const apiKeyField = document.getElementById("ai-model-edit-api-key");
    const baseUrlField = document.getElementById("ai-model-edit-base-url");
    const modelNameField = document.getElementById("ai-model-edit-model-name");
    const resultDiv = document.getElementById("ai-model-test-result");
    
    const api_key = apiKeyField?.value.trim();
    const base_url = baseUrlField?.value.trim();
    const model_name = modelNameField?.value.trim();
    
    if (!api_key || !base_url || !model_name) {
      this.showToast("error", this.translate("common.error", "Error"), this.translate("aiModels.messages.fillRequiredForTest", "Please fill in API Key, Base URL, and Model Name"));
      return;
    }
    
    if (resultDiv) {
      resultDiv.style.display = "block";
      resultDiv.className = "api-test-result testing";
      resultDiv.textContent = this.translate("aiModels.messages.testing", "Testing connection...");
    }
    
    try {
      const csrfToken = this.getCsrfToken();
      const response = await fetch("/api/ai-models/test", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ api_key, base_url, model_name }),
      });
      
      const data = await response.json();
      
      if (resultDiv) {
        if (data.success) {
          resultDiv.className = "api-test-result success";
          resultDiv.textContent = `✅ ${this.translate("aiModels.messages.testSuccess", "Connection successful")} (${data.duration})`;
        } else {
          resultDiv.className = "api-test-result error";
          resultDiv.textContent = `❌ ${this.translate("aiModels.messages.testFailed", "Connection failed")}: ${data.error}`;
        }
      }
      
    } catch (error) {
      console.error("测试 AI 模型连接失败:", error);
      if (resultDiv) {
        resultDiv.className = "api-test-result error";
        resultDiv.textContent = `❌ ${this.translate("aiModels.messages.testError", "Test failed")}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  async testAiModelConnection(modelId, triggerBtn) {
    if (!modelId || !triggerBtn) return;
    
    try {
      this.setButtonLoading(triggerBtn, true, null, "aiModels.messages.testing");
      
      const csrfToken = this.getCsrfToken();
      const response = await fetch(`/api/ai-models/${modelId}/test`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
      });
      
      const data = await response.json();
      let statusType = "error";
      let statusMessage = this.translate("aiModels.messages.testFailed", "Connection failed");
      
      if (data.success) {
        statusType = "success";
        statusMessage = `${this.translate("aiModels.messages.testSuccess", "Connection successful")} (${data.duration})`;
      } else if (data.error) {
        statusMessage = `${this.translate("aiModels.messages.testFailed", "Connection failed")}: ${data.error}`;
      }
      
      this.setButtonLoading(triggerBtn, false);
      this.showButtonInlineStatus(triggerBtn, statusMessage, statusType, null);
      
    } catch (error) {
      console.error("测试 AI 模型连接失败:", error);
      const message = error instanceof Error ? error.message : String(error);
      this.setButtonLoading(triggerBtn, false);
      this.showButtonInlineStatus(
        triggerBtn,
        `${this.translate("aiModels.messages.testError", "Test failed")}: ${message}`,
        "error",
        null
      );
    }
  }

  // 多任务模式下不再需要 activateAiModel 方法

  async deleteAiModel(modelId, triggerBtn) {
    if (!modelId) return;
    
    const model = this.aiModelsCache?.find(m => m.id === modelId);
    const modelName = model ? model.name : `ID ${modelId}`;
    
    const confirmMessage = this.translate("aiModels.confirmDelete", "Confirm deletion of AI model「{{name}}」?", { name: modelName });
    
    if (!confirm(confirmMessage)) {
      return;
    }
    
    try {
      this.setButtonLoading(triggerBtn, true);
      
      const csrfToken = this.getCsrfToken();
      const response = await fetch(`/api/ai-models/${modelId}`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "删除失败");
      }
      
      this.showToast("success", this.translate("common.success", "Success"), this.translate("aiModels.messages.deleteSuccess", "AI model deleted"));
      await this.loadAiModelsList();
      
    } catch (error) {
      console.error("删除 AI 模型失败:", error);
      const message = error instanceof Error ? error.message : String(error);
      this.showToast("error", this.translate("common.error", "Error"), message);
    } finally {
      this.setButtonLoading(triggerBtn, false);
    }
  }

  // ==================== Strategy Editor Methods ====================

  bindViewSwitcher() {
    const toggle = document.getElementById("view-mode-toggle");
    const modeButtons = document.querySelectorAll(".view-switcher .view-switcher-label");

    if (!toggle || !this.strategyEditorEl || !this.tradingDashboardEl) {
      return;
    }

    const updateButtonState = (isStrategyMode) => {
      modeButtons.forEach((btn) => {
        const targetMode = btn?.dataset?.mode;
        const isActive = isStrategyMode ? targetMode === "strategy" : targetMode === "trading";
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    };

    toggle.addEventListener("change", (event) => {
      const isStrategyMode = event?.target?.checked ?? toggle.checked;
      updateButtonState(isStrategyMode);
      this.toggleStrategyView(Boolean(isStrategyMode));
      if (isStrategyMode) {
        void this.loadStrategyList();
        // 强制刷新策略任务列表（确保获取最新数据）
        void this.refreshRunningTasksPanel(true);
        if (!this.currentStrategyName) {
          this.populateStrategyEditor(this.getBlankStrategyTemplate());
          this.saveStrategyDraft();
        }
      }
    });

    modeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const shouldStrategy = btn?.dataset?.mode === "strategy";
        if (toggle.checked === shouldStrategy) {
          return;
        }
        toggle.checked = shouldStrategy;
        toggle.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });

    updateButtonState(toggle.checked);

    const newBtn = document.getElementById("new-strategy-btn");
    if (newBtn) {
      newBtn.addEventListener("click", () => this.resetStrategyEditor());
    }

    const saveBtn = document.getElementById("strategy-save-btn");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        void this.saveCurrentStrategy();
      });
    }

    const activateBtn = document.getElementById("strategy-activate-btn");
    if (activateBtn) {
      activateBtn.addEventListener("click", () => {
        void this.activateCurrentStrategy();
      });
    }
  }

  async loadStrategyList() {
    const listContainer = document.getElementById("strategy-list");
    if (!listContainer) return;

    this.hideStrategyDeleteConfirm();

    const loadingText = this.translate("strategyEditor.loading", "Loading strategies...");
    listContainer.innerHTML = `<p class="loading">${this.escapeHtml(loadingText)}</p>`;

    try {
      const response = await fetch("/api/strategies", {
        credentials: "include",
      });

      if (response.status === 401) {
        const loginText = this.translate("strategyEditor.requireLogin", "Please sign in to manage strategies.");
        listContainer.innerHTML = `<p class="error-hint">${this.escapeHtml(loginText)}</p>`;
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const strategies = Array.isArray(data?.strategies) ? data.strategies : [];

      if (strategies.length === 0) {
        const emptyText = this.translate("strategyEditor.empty", "No strategies yet. Click “New Strategy” to create one.");
        listContainer.innerHTML = `<p class="empty-hint">${this.escapeHtml(emptyText)}</p>`;
        this.activeStrategyName = "";
        this.updateActiveStrategyLabel("");
        return;
      }

      const deleteLabel = this.translate("common.delete", "Delete");
      const activeBadgeLabel = this.translate("strategyEditor.active", "Active");
      strategies.sort((a, b) => a.name.localeCompare(b.name));
      listContainer.innerHTML = "";
      let activeName = "";

      strategies.forEach((strategyInfo) => {
        const name = strategyInfo?.name || "";
        const isActive = Boolean(strategyInfo?.isActive);
        if (isActive) {
          activeName = name;
        }

        const confirmMessage = this.escapeHtml(
          this.translate("strategyEditor.deleteConfirm", 'Delete strategy "{{name}}"?', { name })
        );
        const confirmLabel = this.escapeHtml(this.translate("common.confirm", "Confirm"));
        const cancelLabel = this.escapeHtml(this.translate("common.cancel", "Cancel"));

        const item = document.createElement("div");
        item.className = "strategy-item";
        if (isActive) {
          item.classList.add("active");
        }
        if (name && name === this.currentStrategyName) {
          item.classList.add("selected");
        }
        item.dataset.name = name;

        const deleteControls = isActive
          ? ""
          : `
            <div class="strategy-delete-wrapper">
              <button class="strategy-item-btn delete-strategy-btn" data-name="${this.escapeHtml(name)}" title="${this.escapeHtml(deleteLabel)}">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M2.5 2.5h7v1h-7zM3.5 4.5h5v6h-5zM4.5 0.5h3v1h-3z"/></svg>
              </button>
              <div class="strategy-delete-popover" role="alert" aria-hidden="true" data-strategy-name="${this.escapeHtml(name)}">
                <p class="strategy-delete-text">${confirmMessage}</p>
                <div class="strategy-delete-actions">
                  <button type="button" class="link-button cancel-delete-strategy">${cancelLabel}</button>
                  <button type="button" class="btn-danger btn-small confirm-delete-strategy" data-name="${this.escapeHtml(name)}">${confirmLabel}</button>
                </div>
              </div>
            </div>
          `;

        item.innerHTML = `
          <span class="strategy-item-name">${this.escapeHtml(name)}</span>
          ${isActive ? `<span class="strategy-active-badge">${this.escapeHtml(activeBadgeLabel)}</span>` : ""}
          <div class="strategy-item-actions">
            ${deleteControls}
          </div>
        `;

        item.addEventListener("click", (event) => {
          if (event.target.closest(".strategy-item-btn")) {
            return;
          }
          this.loadStrategyFile(name);
        });

        const deleteBtn = item.querySelector(".delete-strategy-btn");
        if (deleteBtn) {
          deleteBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            this.showStrategyDeleteConfirm(name, deleteBtn);
          });
        }

        const confirmBtn = item.querySelector(".confirm-delete-strategy");
        if (confirmBtn) {
          confirmBtn.addEventListener("click", async (event) => {
            event.stopPropagation();
            confirmBtn.disabled = true;
            confirmBtn.classList.add("is-loading");
            try {
              await this.deleteStrategy(name);
            } finally {
              confirmBtn.disabled = false;
              confirmBtn.classList.remove("is-loading");
              this.hideStrategyDeleteConfirm();
            }
          });
        }

        const cancelBtn = item.querySelector(".cancel-delete-strategy");
        if (cancelBtn) {
          cancelBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            this.hideStrategyDeleteConfirm();
          });
        }

        listContainer.appendChild(item);
      });

      this.activeStrategyName = activeName;
      this.updateActiveStrategyLabel(activeName);
      this.updateStrategyListHighlight(this.currentStrategyName);
    } catch (error) {
      console.error("Error loading strategies:", error);
      const errorText = this.translate("strategyEditor.errorLoading", "Failed to load strategies.");
      listContainer.innerHTML = `<p class="error-hint">${this.escapeHtml(errorText)}</p>`;
    }
  }

  showStrategyDeleteConfirm(name, triggerBtn) {
    if (!name || !triggerBtn) {
      return;
    }

    this.hideStrategyDeleteConfirm();

    const wrapper = triggerBtn.closest(".strategy-delete-wrapper") || triggerBtn.closest(".strategy-item-actions");
    if (!wrapper) {
      return;
    }

    const popover = wrapper.querySelector(".strategy-delete-popover");
    if (!popover) {
      return;
    }

    popover.classList.add("is-visible");
    popover.setAttribute("aria-hidden", "false");
    this.strategyDeleteActivePopover = popover;

    this.strategyDeleteOutsideHandler = (event) => {
      if (!event) return;
      const target = event.target;
      if (!target) return;
      if (wrapper.contains(target)) {
        return;
      }
      this.hideStrategyDeleteConfirm();
    };

    window.setTimeout(() => {
      if (this.strategyDeleteOutsideHandler) {
        document.addEventListener("click", this.strategyDeleteOutsideHandler);
      }
    }, 0);
  }

  hideStrategyDeleteConfirm() {
    if (this.strategyDeleteActivePopover) {
      this.strategyDeleteActivePopover.classList.remove("is-visible");
      this.strategyDeleteActivePopover.setAttribute("aria-hidden", "true");
      this.strategyDeleteActivePopover = null;
    }

    if (this.strategyDeleteOutsideHandler) {
      document.removeEventListener("click", this.strategyDeleteOutsideHandler);
      this.strategyDeleteOutsideHandler = null;
    }
  }

  async loadStrategyFile(name) {
    if (!name) return;
    try {
      const response = await fetch(`/api/strategies/${encodeURIComponent(name)}`, {
        credentials: "include",
      });

      if (response.status === 401) {
        const loginText = this.translate("strategyEditor.requireLogin", "Please sign in to manage strategies.");
        this.showToast("error", this.translate("common.error", "Error"), loginText);
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to load strategy file");
      }

      const data = await response.json();
      const strategy = this.normalizeStrategyPayload(data?.strategy ?? data, name);

      if (!strategy) {
        throw new Error("Missing strategy payload");
      }

      this.populateStrategyEditor(strategy);
      this.currentStrategyName = strategy.meta?.name || name;
      this.updateStrategyListHighlight(this.currentStrategyName);

      const loadedMessage = this.translate("strategyEditor.loadSuccess", 'Strategy "{{name}}" loaded.', { name: this.currentStrategyName });
      this.showToast("success", this.translate("common.success", "Success"), loadedMessage);
      this.saveStrategyDraft();
    } catch (error) {
      console.error("Error loading strategy file:", error);
      const message = this.translate("strategyEditor.loadFailed", "Failed to load strategy file.");
      this.showToast("error", this.translate("common.error", "Error"), message);
    }
  }

  resetStrategyEditor() {
    this.populateStrategyEditor(this.getBlankStrategyTemplate());
    this.currentStrategyName = "";
    this.updateStrategyListHighlight("");
    this.saveStrategyDraft();
  }

  async saveCurrentStrategy() {
    const nameInput = document.getElementById("strategy-filename");
    const name = nameInput?.value?.trim() || "";

    if (!name) {
      const message = this.translate("strategyEditor.nameRequired", "Please enter a strategy file name.");
      this.showToast("error", this.translate("common.error", "Error"), message);
      if (nameInput) {
        nameInput.focus();
      }
      return false;
    }

    const content = {
      meta: {
        name,
        version: "1.0",
        updatedAt: new Date().toISOString(),
        description: document.getElementById("strategy-description")?.value?.trim() || "",
      },
      prompts: {
        entryLogic: document.getElementById("strategy-entry")?.value || "",
        exitLogic: document.getElementById("strategy-exit")?.value || "",
      },
      params: {
        tradingSymbols: document.getElementById("st-symbols")?.value?.trim() || "",
        intervalMinutes: this.getNumberInputValue("st-interval", STRATEGY_DEFAULT_PARAMS.intervalMinutes),
        leverage: this.getNumberInputValue("st-leverage", STRATEGY_DEFAULT_PARAMS.leverage),
        maxPositions: this.getNumberInputValue("st-max-positions", STRATEGY_DEFAULT_PARAMS.maxPositions),
        maxHoldingHours: this.getNumberInputValue("st-max-holding", STRATEGY_DEFAULT_PARAMS.maxHoldingHours),
        minHoldingMinutes: this.getNumberInputValue("st-min-holding", STRATEGY_DEFAULT_PARAMS.minHoldingMinutes),
        extremeStopLossPercent: this.getNumberInputValue("st-extreme-stop", STRATEGY_DEFAULT_PARAMS.extremeStopLossPercent),
        accountStopLoss: this.getNumberInputValue("st-stop-loss", STRATEGY_DEFAULT_PARAMS.accountStopLoss),
        accountTakeProfit: this.getNumberInputValue("st-take-profit", STRATEGY_DEFAULT_PARAMS.accountTakeProfit),
        drawdownWarning: this.getNumberInputValue("st-dd-warning", STRATEGY_DEFAULT_PARAMS.drawdownWarning),
        drawdownNoNew: this.getNumberInputValue("st-dd-pause", STRATEGY_DEFAULT_PARAMS.drawdownNoNew),
        drawdownForceClose: this.getNumberInputValue("st-dd-close", STRATEGY_DEFAULT_PARAMS.drawdownForceClose),
      },
    };

    try {
      const csrfToken = this.getCsrfToken();
      const response = await fetch(`/api/strategies/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        credentials: "include",
        body: JSON.stringify(content),
      });

      if (!response.ok) {
        throw new Error("Failed to save strategy");
      }

      this.currentStrategyName = name;
      this.updateStrategyListHighlight(name);
      await this.loadStrategyList();
      this.saveStrategyDraft();

      const successMessage = this.translate("strategyEditor.saveSuccess", 'Strategy "{{name}}" saved.', { name });
      this.showToast("success", this.translate("common.success", "Success"), successMessage);
      return true;
    } catch (error) {
      console.error("Error saving strategy:", error);
      const message = this.translate("strategyEditor.saveFailed", "Failed to save strategy.");
      this.showToast("error", this.translate("common.error", "Error"), message);
      return false;
    }
  }

  async deleteStrategy(name) {
    if (!name) return;

    try {
      const csrfToken = this.getCsrfToken();
      const response = await fetch(`/api/strategies/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: {
          "X-CSRF-Token": csrfToken,
        },
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to delete strategy");
      }

      if (this.currentStrategyName === name) {
        this.resetStrategyEditor();
      }

      const successMessage = this.translate("strategyEditor.deleteSuccess", 'Strategy "{{name}}" deleted.', { name });
      this.showToast("success", this.translate("common.success", "Success"), successMessage);
      await this.loadStrategyList();
    } catch (error) {
      console.error("Error deleting strategy:", error);
      const message = this.translate("strategyEditor.deleteFailed", "Failed to delete strategy.");
      this.showToast("error", this.translate("common.error", "Error"), message);
    }
  }

  async activateCurrentStrategy() {
    const name = document.getElementById("strategy-filename")?.value?.trim();
    if (!name) {
      const reminder = this.translate("strategyEditor.saveBeforeActivate", "Please save the strategy before activating it.");
      this.showToast("error", this.translate("common.error", "Error"), reminder);
      return;
    }

    const saved = await this.saveCurrentStrategy();
    if (!saved) {
      return;
    }

    try {
      const csrfToken = this.getCsrfToken();
      const response = await fetch(`/api/strategies/${encodeURIComponent(name)}/activate`, {
        method: "POST",
        headers: {
          "X-CSRF-Token": csrfToken,
        },
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to activate strategy");
      }

      this.activeStrategyName = name;
      this.updateActiveStrategyLabel(name);
      await this.loadStrategyList();
      this.saveStrategyDraft();

      const successMessage = this.translate("strategyEditor.activateSuccess", 'Strategy "{{name}}" is now active.', { name });
      this.showToast("success", this.translate("common.success", "Success"), successMessage);
    } catch (error) {
      console.error("Error activating strategy:", error);
      const message = this.translate("strategyEditor.activateFailed", "Failed to activate strategy.");
      this.showToast("error", this.translate("common.error", "Error"), message);
    }
  }

  toggleStrategyView(isStrategyMode) {
    if (!this.strategyEditorEl || !this.tradingDashboardEl) return;

    if (isStrategyMode) {
      this.tradingDashboardEl.style.display = "none";
      if (this.bottomTabsEl) {
        this.bottomTabsEl.style.display = "none";
      }
      if (this.strategyBottomTabsEl) {
        this.strategyBottomTabsEl.style.display = "";
      }
      this.strategyEditorEl.classList.add("active");
      this.strategyEditorEl.setAttribute("aria-hidden", "false");
      // 注意：任务列表刷新由 bindViewSwitcher 的 change 事件处理，这里不重复调用
    } else {
      this.hideStrategyDeleteConfirm();
      this.tradingDashboardEl.style.display = "";
      if (this.bottomTabsEl) {
        this.bottomTabsEl.style.display = "";
      }
      if (this.strategyBottomTabsEl) {
        this.strategyBottomTabsEl.style.display = "none";
      }
      this.strategyEditorEl.classList.remove("active");
      this.strategyEditorEl.setAttribute("aria-hidden", "true");
    }
  }

  getBlankStrategyTemplate() {
    return createDefaultStrategyContent("");
  }

  populateStrategyEditor(strategy) {
    if (!strategy) return;
    const { meta, prompts, params } = strategy;

    const nameInput = document.getElementById("strategy-filename");
    if (nameInput) {
      nameInput.value = meta?.name || "";
    }

    const descriptionInput = document.getElementById("strategy-description");
    if (descriptionInput) {
      descriptionInput.value = meta?.description || "";
    }

    const entry = document.getElementById("strategy-entry");
    if (entry) entry.value = prompts?.entryLogic || "";
    const exit = document.getElementById("strategy-exit");
    if (exit) exit.value = prompts?.exitLogic || "";

    // 加载交易币种
    const symbolsInput = document.getElementById("st-symbols");
    if (symbolsInput) {
      symbolsInput.value = params?.tradingSymbols || "";
    }

    const mappings = [
      ["st-interval", params?.intervalMinutes, STRATEGY_DEFAULT_PARAMS.intervalMinutes],
      ["st-leverage", params?.leverage, STRATEGY_DEFAULT_PARAMS.leverage],
      ["st-max-positions", params?.maxPositions, STRATEGY_DEFAULT_PARAMS.maxPositions],
      ["st-max-holding", params?.maxHoldingHours, STRATEGY_DEFAULT_PARAMS.maxHoldingHours],
      ["st-min-holding", params?.minHoldingMinutes, STRATEGY_DEFAULT_PARAMS.minHoldingMinutes],
      ["st-extreme-stop", params?.extremeStopLossPercent, STRATEGY_DEFAULT_PARAMS.extremeStopLossPercent],
      ["st-stop-loss", params?.accountStopLoss, STRATEGY_DEFAULT_PARAMS.accountStopLoss],
      ["st-take-profit", params?.accountTakeProfit, STRATEGY_DEFAULT_PARAMS.accountTakeProfit],
      ["st-dd-warning", params?.drawdownWarning, STRATEGY_DEFAULT_PARAMS.drawdownWarning],
      ["st-dd-pause", params?.drawdownNoNew, STRATEGY_DEFAULT_PARAMS.drawdownNoNew],
      ["st-dd-close", params?.drawdownForceClose, STRATEGY_DEFAULT_PARAMS.drawdownForceClose],
    ];

    mappings.forEach(([id, value, fallback]) => {
      const el = document.getElementById(id);
      if (el) {
        el.value = Number.isFinite(Number(value)) ? value : fallback;
      }
    });
  }

  updateStrategyListHighlight(name) {
    const listContainer = document.getElementById("strategy-list");
    if (!listContainer) return;
    listContainer.querySelectorAll(".strategy-item").forEach((el) => {
      if (!name) {
        el.classList.remove("selected");
        return;
      }
      if (el.dataset.name === name) {
        el.classList.add("selected");
      } else {
        el.classList.remove("selected");
      }
    });
  }

  updateActiveStrategyLabel(name) {
    if (!this.strategyActiveLabelEl) return;
    const displayName = name || this.translate("strategyEditor.none", "Not set");
    this.strategyActiveLabelEl.textContent = displayName;
  }

  normalizeStrategyPayload(payload, fallbackName = "") {
    if (!payload) return null;
    const name = payload?.meta?.name || payload?.name || fallbackName;
    const defaults = createDefaultStrategyContent(name);

    let params = {
      ...defaults.params,
      ...(payload.params || {}),
    };

    if (!payload.params && payload.config) {
      params = {
        ...params,
        ...this.mapLegacyConfigToParams(payload.config),
      };
    }

    return {
      meta: {
        ...defaults.meta,
        ...payload.meta,
        name,
      },
      prompts: {
        ...defaults.prompts,
        ...(payload.prompts || {}),
      },
      params,
    };
  }

  mapLegacyConfigToParams(config = {}) {
    const parsed = {};
    const toNumber = (value, fallback) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };

    if (config.TRADING_INTERVAL_MINUTES !== undefined) parsed.intervalMinutes = toNumber(config.TRADING_INTERVAL_MINUTES, STRATEGY_DEFAULT_PARAMS.intervalMinutes);
    if (config.MAX_LEVERAGE !== undefined) parsed.leverage = toNumber(config.MAX_LEVERAGE, STRATEGY_DEFAULT_PARAMS.leverage);
    if (config.MAX_POSITIONS !== undefined) parsed.maxPositions = toNumber(config.MAX_POSITIONS, STRATEGY_DEFAULT_PARAMS.maxPositions);
    if (config.MAX_HOLDING_HOURS !== undefined) parsed.maxHoldingHours = toNumber(config.MAX_HOLDING_HOURS, STRATEGY_DEFAULT_PARAMS.maxHoldingHours);
    if (config.MIN_HOLDING_MINUTES !== undefined) parsed.minHoldingMinutes = toNumber(config.MIN_HOLDING_MINUTES, STRATEGY_DEFAULT_PARAMS.minHoldingMinutes);
    if (config.EXTREME_STOP_LOSS_PERCENT !== undefined) parsed.extremeStopLossPercent = toNumber(config.EXTREME_STOP_LOSS_PERCENT, STRATEGY_DEFAULT_PARAMS.extremeStopLossPercent);
    if (config.ACCOUNT_STOP_LOSS_USDT !== undefined) parsed.accountStopLoss = toNumber(config.ACCOUNT_STOP_LOSS_USDT, STRATEGY_DEFAULT_PARAMS.accountStopLoss);
    if (config.ACCOUNT_TAKE_PROFIT_USDT !== undefined) parsed.accountTakeProfit = toNumber(config.ACCOUNT_TAKE_PROFIT_USDT, STRATEGY_DEFAULT_PARAMS.accountTakeProfit);
    if (config.ACCOUNT_DRAWDOWN_WARNING_PERCENT !== undefined) parsed.drawdownWarning = toNumber(config.ACCOUNT_DRAWDOWN_WARNING_PERCENT, STRATEGY_DEFAULT_PARAMS.drawdownWarning);
    if (config.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT !== undefined) parsed.drawdownNoNew = toNumber(config.ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT, STRATEGY_DEFAULT_PARAMS.drawdownNoNew);
    if (config.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT !== undefined) parsed.drawdownForceClose = toNumber(config.ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT, STRATEGY_DEFAULT_PARAMS.drawdownForceClose);
    return parsed;
  }

  getNumberInputValue(id, fallback) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const value = Number(el.value);
    return Number.isFinite(value) ? value : fallback;
  }
}


// ========== Load Contract Multipliers from API ==========
async function loadContractMultipliers() {
  try {
    const response = await fetch('/api/public/contract-multipliers');
    if (!response.ok) {
      console.warn('[Contract Multipliers] Failed to load from API, using defaults');
      return;
    }
    
    const data = await response.json();
    if (data.multipliers && typeof data.multipliers === 'object') {
      CONTRACT_MULTIPLIERS = { ...DEFAULT_CONTRACT_MULTIPLIERS, ...data.multipliers };
      contractMultipliersLastUpdated = data.lastUpdated;
      console.log(`[Contract Multipliers] Loaded ${data.count} multipliers from API (updated: ${data.lastUpdated || 'N/A'})`);
    }
  } catch (error) {
    console.error('[Contract Multipliers] Error loading:', error);
  }
}


window.addEventListener("DOMContentLoaded", async () => {
  await syncLanguagePreferenceFromBackend();

  try {
    await ensureLanguageResources();
  } catch (error) {
    console.error("[i18n] Failed to ensure language resources", error);
  }

  // 加载合约乘数
  await loadContractMultipliers();

  applyI18nToDOM();

  const languageSelector = document.getElementById("language-selector");
  const languageToggle = document.getElementById("language-toggle");
  const languageMenu = document.getElementById("language-menu");

  if (languageSelector && languageToggle && languageMenu) {
    const languageOptions = Array.from(languageMenu.querySelectorAll(".language-option"));

    const setMenuState = (isOpen) => {
      languageSelector.classList.toggle("is-open", Boolean(isOpen));
      languageToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    };

    const closeLanguageMenu = () => {
      setMenuState(false);
      updateLanguageSelectorUI();
    };

    const openLanguageMenu = () => {
      setMenuState(true);
      updateLanguageSelectorUI();
    };

    const handleDocumentClick = (event) => {
      if (!languageSelector.contains(event.target)) {
        closeLanguageMenu();
      }
    };

    const handleDocumentKeydown = (event) => {
      if (event.key === "Escape" && languageSelector.classList.contains("is-open")) {
        closeLanguageMenu();
        languageToggle.focus();
      }
    };

    async function handleLanguageSelection(newLang) {
      const targetLang = SUPPORTED_LANGUAGES.includes(newLang) ? newLang : DEFAULT_LANGUAGE;

      const normalizedLang = setLanguage(targetLang);
      updateLanguageSelectorUI();

      if (window.tradingMonitor && window.tradingMonitor.isAuthenticated) {
        try {
          const csrfToken = window.csrfManager?.getToken?.() || "";
          await fetch("/api/user/language", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken,
            },
            credentials: "include",
            body: JSON.stringify({ language: normalizedLang }),
          });
          console.log(`Language preference saved to backend: ${normalizedLang}`);
        } catch (error) {
          console.warn("Failed to save language preference to backend:", error);
        }
      }

      window.location.reload();
    }

    languageToggle.addEventListener("click", (event) => {
      event.preventDefault();
      if (languageSelector.classList.contains("is-open")) {
        closeLanguageMenu();
      } else {
        openLanguageMenu();
      }
    });

    languageOptions.forEach((option) => {
      option.addEventListener("click", (event) => {
        event.preventDefault();
        const selectedLang = option.getAttribute("data-lang");
        if (!selectedLang) {
          return;
        }
        closeLanguageMenu();
        if (selectedLang === getCurrentLanguage()) {
          return;
        }
        void handleLanguageSelection(selectedLang);
      });
    });

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleDocumentKeydown);

    updateLanguageSelectorUI();
  }

  window.tradingMonitor = new TradingMonitor();
});
