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

const i18n = {};
let languageLoadPromise = null;

async function loadLanguagePack(lang) {
  if (!SUPPORTED_LANGUAGES.includes(lang)) {
    console.warn(`[i18n] Attempted to load unsupported language: ${lang}`);
    return null;
  }

  if (i18n[lang]) {
    return i18n[lang];
  }

  try {
    const response = await fetch(`${LANGUAGE_ENDPOINT}/${lang}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    i18n[lang] = data ?? {};
    return i18n[lang];
  } catch (error) {
    console.error(`[i18n] Failed to load language pack "${lang}"`, error);
    if (!i18n[lang]) {
      i18n[lang] = {};
    }
    return i18n[lang];
  }
}

async function ensureLanguageResources() {
  if (!languageLoadPromise) {
    languageLoadPromise = Promise.all(
      SUPPORTED_LANGUAGES.map((lang) => loadLanguagePack(lang))
    ).then(() => undefined);
  }
  return languageLoadPromise;
}

function getCurrentLanguage() {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored && SUPPORTED_LANGUAGES.includes(stored)) {
    return stored;
  }
  return DEFAULT_LANGUAGE;
}

// Set language and persist to localStorage
function setLanguage(lang) {
  if (!SUPPORTED_LANGUAGES.includes(lang)) {
    console.warn(`Unsupported language: ${lang}, falling back to ${DEFAULT_LANGUAGE}`);
    lang = DEFAULT_LANGUAGE;
  }
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  return lang;
}

function getLanguageLabel(lang) {
  if (lang && Object.prototype.hasOwnProperty.call(LANGUAGE_LABELS, lang)) {
    return LANGUAGE_LABELS[lang];
  }
  if (typeof lang === "string" && lang.length) {
    return lang.toUpperCase();
  }
  return lang;
}

function updateLanguageSelectorUI() {
  const selector = document.getElementById("language-selector");
  if (!selector) {
    return;
  }
  const currentLang = getCurrentLanguage();
  const toggle = document.getElementById("language-toggle");
  const labelEl = toggle ? toggle.querySelector(".language-label") : null;
  const languageLabel = getLanguageLabel(currentLang) ?? "";
  if (labelEl) {
    labelEl.textContent = languageLabel;
  }
  if (toggle) {
    toggle.setAttribute("data-current-lang", currentLang);
    const isOpen = selector.classList.contains("is-open");
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    const tooltipText = t("navigation.languageTooltip", { language: languageLabel });
    toggle.setAttribute("title", tooltipText);
    toggle.setAttribute("aria-label", tooltipText);
  }
  selector.querySelectorAll(".language-option").forEach((option) => {
    const optionLang = option.getAttribute("data-lang");
    option.classList.toggle("is-active", optionLang === currentLang);
  });
}

function t(key, replacements = null) {
  if (!key) {
    return key;
  }

  const lang = getCurrentLanguage();
  const segments = String(key).split(".");

  const resolveValue = (source) => {
    let current = source;
    for (const segment of segments) {
      if (current && typeof current === "object" && segment in current) {
        current = current[segment];
      } else {
        return undefined;
      }
    }
    return current;
  };

  let value = resolveValue(i18n[lang]);
  if (value === undefined && lang !== DEFAULT_LANGUAGE) {
    value = resolveValue(i18n[DEFAULT_LANGUAGE]);
  }
  if (value === undefined) {
    return key;
  }

  if (typeof value === "string" && replacements && typeof replacements === "object") {
    return value.replace(/\{\{(\w+)\}\}/g, (match, token) => {
      if (Object.prototype.hasOwnProperty.call(replacements, token)) {
        return String(replacements[token]);
      }
      return match;
    });
  }

  return value;
}

// Apply i18n translations to DOM elements
function applyI18nToDOM() {
  // Update all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    if (key) {
      element.textContent = t(key);
    }
  });
  
  // Update all elements with data-i18n-placeholder attribute
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    if (key) {
      element.placeholder = t(key);
    }
  });
  
  // Update all elements with data-i18n-html attribute
  document.querySelectorAll('[data-i18n-html]').forEach(element => {
    const key = element.getAttribute('data-i18n-html');
    if (key) {
      element.innerHTML = t(key);
    }
  });
  
  // Update all elements with data-i18n-title attribute
  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    const key = element.getAttribute('data-i18n-title');
    if (key) {
      element.title = t(key);
    }
  });
  
  document.querySelectorAll('[data-i18n-aria]').forEach(element => {
    const key = element.getAttribute('data-i18n-aria');
    if (key) {
      element.setAttribute('aria-label', t(key));
    }
  });
  
  // Update strategy labels dynamically
  updateStrategyLabels();
  updateLanguageSelectorUI();
}

// Update strategy labels based on current language
function updateStrategyLabels() {
  const lang = getCurrentLanguage();
  const langPack = i18n[lang];
  const defaultPack = i18n[DEFAULT_LANGUAGE];
  const fallbackLabels =
    defaultPack?.strategy?.labelMap ||
    defaultPack?.strategyLabels ||
    DEFAULT_STRATEGY_LABELS;

  const labels =
    langPack?.strategy?.labelMap ||
    langPack?.strategyLabels ||
    fallbackLabels;

  if (labels) {
    STRATEGY_LABELS = {
      ...DEFAULT_STRATEGY_LABELS,
      ...labels,
    };
  }
}

// ========== End of Language & i18n ==========

const DEFAULT_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE"];
const REFRESH_INTERVAL = 20000;
const PRICE_REFRESH_INTERVAL = 10000;
const DEFAULT_INTERVAL = "1m";
const CANDLE_LIMIT = 200;
const ACCOUNT_CONFIG_KEYS = [
  "OKX_API_KEY",
  "OKX_API_SECRET",
  "OKX_API_PASSPHRASE",
  "OKX_USE_PAPER",
  "INITIAL_BALANCE",
  "ACCOUNT_STOP_LOSS_USDT",
  "ACCOUNT_TAKE_PROFIT_USDT",
];

const STRATEGY_CONFIG_KEYS = [
  "TRADING_SYMBOLS",
  "TRADING_INTERVAL_MINUTES",
  "MAX_LEVERAGE",
  "MAX_POSITIONS",
  "MAX_HOLDING_HOURS",
  "EXTREME_STOP_LOSS_PERCENT",
  "ACCOUNT_DRAWDOWN_WARNING_PERCENT",
  "ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT",
  "ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT",
  "PROMPT_SECTION_ENTRY",
  "PROMPT_SECTION_EXIT",
  "PROMPT_SECTION_VARIABLES",
];

// Strategy labels - will be updated by i18n
let STRATEGY_LABELS = { ...DEFAULT_STRATEGY_LABELS };

const SETTINGS_CONFIG_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "AI_MODEL_NAME",
  "HTTP_PROXY_URL",
  "COMMUNITY_REPORT_ENABLED",
  "COMMUNITY_SHARE_PROMPTS",
];

const CLIENT_NUMERIC_KEYS = new Set([
  "TRADING_INTERVAL_MINUTES",
  "MAX_LEVERAGE",
  "MAX_POSITIONS",
  "MAX_HOLDING_HOURS",
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

const DEFAULT_AI_ICON = "/static/icons/openai.png";

class TradingMonitor {
  constructor() {
    this.activeSymbol = DEFAULT_SYMBOLS[0];
    this.activeInterval = DEFAULT_INTERVAL;
    this.availableSymbols = new Set(DEFAULT_SYMBOLS);
    this.symbolOrder = [...DEFAULT_SYMBOLS];
    this.prices = new Map();
    this.priceDeltas = new Map();
    this.priceChanges = new Map();
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
    this.decisionListEl = document.getElementById("decision-list");
    this.decisionUpdatedEl = document.getElementById("decision-updated");
    this.positionsContainerEl = document.getElementById("positions-container");
    this.positionsUpdatedEl = document.getElementById("positions-updated");
    this.tradesContainerEl = document.getElementById("trades-container");
    this.logsContainerEl = document.getElementById("logs-container");
    this.decisionLogsContainerEl = document.getElementById("decision-logs-container");
    this.decisionModal = document.getElementById("decision-modal");
    this.decisionDetailEl = document.getElementById("decision-detail");
    this.logModal = document.getElementById("log-modal");
    this.logDetailEl = document.getElementById("log-detail");
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
    this.accountBtn = document.getElementById("account-btn");
    this.strategyBtn = document.getElementById("strategy-btn");
    this.settingsBtn = document.getElementById("settings-btn");
    this.logoutBtn = document.getElementById("logout-btn");
  this.tradingLoopToggle = document.getElementById("trading-loop-toggle");
    this.aiOverlay = null;
    this.aiOverlayText = null;
    this.aiOverlayIcon = null;
    this.toastContainer = document.getElementById("toast-container");
    this.accountModal = document.getElementById("account-modal");
    this.strategyModal = document.getElementById("strategy-modal");
    this.settingsModal = document.getElementById("settings-modal");
    this.statisticsModal = document.getElementById("statistics-modal");
    this.decisionRequestModal = document.getElementById("decision-request-modal");
    this.decisionRequestDetailEl = document.getElementById("decision-request-detail");
    this.accountForm = document.getElementById("account-form");
    this.strategyForm = document.getElementById("strategy-form");
    this.settingsForm = document.getElementById("settings-form");
    this.strategyPreviewEl = document.getElementById("strategy-preview");
    this.accountCancelBtn = document.getElementById("account-cancel");
    this.strategyCancelBtn = document.getElementById("strategy-cancel");
    this.settingsCancelBtn = document.getElementById("settings-cancel");
    this.testOkxBtn = document.getElementById("test-okx-api");
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

    this.strategyPromptCache = new Map();

    this.isAuthenticated = false;

    this.setupAuthControls();
    void this.syncAuthState();

    this.setupTabSwitching();
    this.setupModals();
    this.connectWebSocket();
    this.initViewAllControls();
    this.setupRecordsControls();
    this.setupIntervalSelector();
    this.renderSymbolList();

    this.bindSettingsForms();
    this.setupPrivacyControls();
  this.setupStrategyTabs();
  this.setupStrategyPromptEditors();
    this.initAiModelOverlay();
    void this.fetchPublicModelInfo();
    
    // 延迟初始化图表，确保容器已渲染
    setTimeout(() => {
      this.initChart();
      this.initEquityChart();
    }, 100);
    
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
      this.loadTrades(),
      this.loadTradeLogs(),
      this.loadDecisions(),
      this.loadDecisionRequests(),
    ]);

    await Promise.all([this.loadPrices(), this.loadCandles(this.activeSymbol)]);
  }

  startAutoRefresh() {
    if (this.dataTimer) clearInterval(this.dataTimer);
    if (this.priceTimer) clearInterval(this.priceTimer);

    this.dataTimer = setInterval(() => {
      void this.loadAccountSummary();
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
      this.accountModal,
      this.strategyModal,
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

  activateStrategyTab(tab) {
    if (!this.strategyModal) {
      return;
    }

    const buttons = this.strategyModal.querySelectorAll("[data-strategy-tab]");
    const panels = this.strategyModal.querySelectorAll("[data-strategy-panel]");

    buttons.forEach((btn) => {
      const target = btn.dataset.strategyTab;
      btn.classList.toggle("active", target === tab);
    });

    panels.forEach((panel) => {
      const target = panel.dataset.strategyPanel;
      panel.classList.toggle("active", target === tab);
    });
  }

  setupStrategyTabs() {
    if (!this.strategyModal) {
      return;
    }

    const buttons = this.strategyModal.querySelectorAll("[data-strategy-tab]");
    if (!buttons || buttons.length === 0) {
      return;
    }

    buttons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const tab = button.dataset.strategyTab;
        if (!tab) {
          return;
        }
        this.activateStrategyTab(tab);
      });
    });
  }

  setupStrategyPromptEditors() {
    if (!this.strategyForm) {
      return;
    }

    const fields = [
      "PROMPT_SECTION_ENTRY",
      "PROMPT_SECTION_EXIT",
      "PROMPT_SECTION_VARIABLES",
    ];

    fields.forEach((name) => {
      const field = this.strategyForm.querySelector(`[name="${name}"]`);
      if (!field) {
        return;
      }
      field.addEventListener("input", () => {
        this.updateStrategyPreview();
      });
    });

    this.setupQuickInsertButtons();
    this.updateStrategyPreview();
  }

  updateStrategyPreview() {
    if (!this.strategyForm || !this.strategyPreviewEl) {
      return;
    }

    const getValue = (name) => {
      const element = this.strategyForm.querySelector(`[name="${name}"]`);
      if (!element || typeof element.value !== "string") {
        return "";
      }
      return element.value.trim();
    };

    const entry = getValue("PROMPT_SECTION_ENTRY");
    const exit = getValue("PROMPT_SECTION_EXIT");
    const variables = getValue("PROMPT_SECTION_VARIABLES");

    const segments = [];
    if (entry) {
      segments.push(`【策略入场逻辑】\n${entry}`);
    }
    if (exit) {
      segments.push(`【策略出场与持仓管理】\n${exit}`);
    }
    if (variables) {
      segments.push(`【策略变量参考】\n${variables}`);
    }

    if (segments.length === 0) {
      this.strategyPreviewEl.textContent = "尚无内容";
    } else {
      this.strategyPreviewEl.textContent = segments.join("\n\n");
    }
  }

  setupQuickInsertButtons() {
    if (!this.strategyForm) {
      return;
    }

    const buttons = this.strategyForm.querySelectorAll("[data-strategy-insert][data-target-field]");
    if (!buttons || buttons.length === 0) {
      return;
    }

    buttons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const strategy = button.dataset.strategyInsert;
        const targetField = button.dataset.targetField;
        if (!strategy || !targetField) {
          return;
        }
        void this.handleQuickInsertStrategy(button, strategy, targetField);
      });
    });
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

  resolveFieldLabel(fieldName) {
    switch (fieldName) {
      case "PROMPT_SECTION_ENTRY":
        return t("strategy.fieldNames.entry");
      case "PROMPT_SECTION_EXIT":
        return t("strategy.fieldNames.exit");
      case "PROMPT_SECTION_VARIABLES":
        return t("strategy.fieldNames.variables");
      default:
        return t("strategy.fieldNames.default");
    }
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

  async handleQuickInsertStrategy(button, strategy, targetField) {
    if (!this.ensureAuthenticated()) {
      return;
    }

    if (!this.strategyForm) {
      return;
    }

    const field = this.strategyForm.querySelector(`[name="${targetField}"]`);
    if (!field) {
      console.warn(`[quick-insert] 未找到目标字段 ${targetField}`);
      return;
    }

    const intervalInput = this.strategyForm.querySelector('[name="TRADING_INTERVAL_MINUTES"]');
    const intervalValue = intervalInput && typeof intervalInput.value === "string" ? intervalInput.value.trim() : "";

    const originalText = button.dataset.originalLabel || button.textContent || t("strategy.fieldNames.default");
    button.dataset.originalLabel = originalText;
    button.disabled = true;
    button.classList.add("loading");
    button.textContent = t("loading");

    try {
      const sections = await this.fetchStrategySections(strategy, intervalValue);
      if (!sections) {
        this.showToast(
          "error",
          t("notifications.loadFailedTitle"),
          t("notifications.loadFailedDefault"),
        );
        return;
      }

      let nextValue = "";
      if (targetField === "PROMPT_SECTION_ENTRY") {
        nextValue = sections.entry ?? "";
      } else if (targetField === "PROMPT_SECTION_EXIT") {
        nextValue = sections.exit ?? "";
      } else if (targetField === "PROMPT_SECTION_VARIABLES") {
        nextValue = sections.variables ?? "";
      } else {
        console.warn(`[quick-insert] 未知的目标字段 ${targetField}`);
        return;
      }

      field.value = typeof nextValue === "string" ? nextValue : "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      this.updateStrategyPreview();

      const strategyLabel = this.resolveStrategyLabel(strategy);
      const fieldLabel = this.resolveFieldLabel(targetField);
      this.showToast(
        "success",
        t("notifications.templateInsertedTitle"),
        t("notifications.templateInsertedMessage", { strategy: strategyLabel, field: fieldLabel }),
      );
    } catch (error) {
      console.error("[quick-insert] 获取策略模板失败:", error);
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
        
        // 将张数转换为币数量
        const actualQuantity = this.convertContractsToQuantity(symbol, quantityValue);
        const quantityLabel = Number.isFinite(actualQuantity) ? this.formatQuantity(actualQuantity) : "--";
        
        const contractsValue = Number(trade.contracts);
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
        const statusKey = typeof request.status === "string" ? request.status.toLowerCase() : "unknown";
        const statusLabelKey = `decisionRequest.status.${statusKey}`;
        let statusLabel = t(statusLabelKey);
        if (!statusLabel || statusLabel === statusLabelKey) {
          statusLabel = request.status || t("decisionRequest.status.unknown");
        }
        const statusClass = statusKey === "error" ? "negative" : "";
        const durationLabel = this.formatOutputDuration(request.outputDurationMs);

        return `
          <tr data-decision-request-index="${index}">
            <td>${timestamp}</td>
            <td>${model}</td>
            <td>${summary}</td>
            <td>${durationLabel}</td>
            <td><span class="${statusClass}">${this.escapeHtml(statusLabel)}</span></td>
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
            <th>${t("tables.logs.headers.status")}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    this.recordsTableContainer.querySelectorAll("tbody tr").forEach((row) => {
      const index = Number(row.dataset.decisionRequestIndex);
      if (Number.isInteger(index)) {
        row.addEventListener("click", () => {
          const request = this.recordsCurrentItems[index];
          if (request) {
            this.showDecisionRequestDetail(request);
          }
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
        if (symbol && symbol !== this.activeSymbol) {
          this.activeSymbol = symbol;
          this.renderSymbolList();
          this.updateChartTitle();
          void this.loadCandles(symbol);
        }
      });
    });
  }

  updateChartTitle() {
    if (this.chartTitleEl) {
      this.chartTitleEl.textContent = `${this.activeSymbol}/USDT`;
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

    const totalEq = data.totalBalance + data.unrealisedPnl;
    this.setText("metric-total", this.formatCurrency(totalEq));
    this.setText("metric-available", this.formatCurrency(data.availableBalance));
    this.setText("metric-unrealised", this.formatCurrency(data.unrealisedPnl, 2, true));
    this.setText("metric-return", this.formatPercent(data.returnPercent));
    // 胜率和最大回撤不显示正负号
    this.setText("metric-winrate", `${(data.winRate || 0).toFixed(2)}%`);
    this.setText("metric-maxdrawdown", `${(data.maxDrawdown || 0).toFixed(2)}%`);

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

    if (!positions.length) {
      this.positionsContainerEl.innerHTML = `<p class="empty-state">${t("tables.positions.empty")}</p>`;
      this.updateTimestamp(this.positionsUpdatedEl, timestamp);
      if (newSymbolAdded) {
        this.schedulePriceSubscriptionUpdate();
      }
      return;
    }

    const rows = positions
      .map((pos) => {
        const symbol = String(pos.symbol || "--").toUpperCase();
        const leverage = pos.leverage ? `${pos.leverage}x` : "";
        const symbolDisplay = leverage 
          ? `<span class="symbol-name">${symbol}</span> <span class="leverage-label">${leverage}</span>` 
          : `<span class="symbol-name">${symbol}</span>`;
        const sideRaw = String(pos.side || "").toLowerCase();
        const sideLabel = sideRaw === "long"
          ? t("long")
          : sideRaw === "short"
            ? t("short")
            : "--";
        const sideClass = sideRaw === "long" ? "positive" : sideRaw === "short" ? "negative" : "";
        const quantityValue = Number(pos.quantity);
        
        // 将张数转换为币数量
        const actualQuantity = this.convertContractsToQuantity(symbol, quantityValue);
        const quantityLabel = Number.isFinite(actualQuantity) ? this.formatQuantity(actualQuantity) : "--";
        
        const contractsValue = Number(pos.contracts);
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
        const openedAtRaw = pos.exchangeOpenedAt || pos.openedAt || pos.opened_at;
        const openedAt = openedAtRaw ? this.formatTime(openedAtRaw) : "--";

        return `
          <tr>
            <td class="text-primary">${symbolDisplay}</td>
            <td><span class="${sideClass}">${sideLabel}</span></td>
            <td${contractsLabel ? ` title="${contractsLabel}"` : ""}>${quantityCell}</td>
            <td>${entryPrice}</td>
            <td>${markPrice}</td>
            <td class="${pnlClass}">${this.formatCurrency(pnl, 2, true)}</td>
            <td>${openedAt}</td>
          </tr>
        `;
      })
      .join("");

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
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    this.updateTimestamp(this.positionsUpdatedEl, timestamp);

    if (newSymbolAdded) {
      this.schedulePriceSubscriptionUpdate();
    }
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
        
        // 将张数转换为币数量
        const actualQuantity = this.convertContractsToQuantity(symbol, quantityValue);
        
        const contractsValue = Number(trade.contracts);
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
        const statusClass = statusKey === "success" ? "" : "negative";
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
    const requests = Array.isArray(data?.requests) ? data.requests : [];

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
      const sizeMatch = message.match(/(\d+(?:\.\d+)?)\s*张/i) || message.match(/数量[：:]\s*(\d+(?:\.\d+)?)/i);
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
      /(\d+\.?\d*)\s*张/i,
      /持仓[：:]\s*(\d+\.?\d*)/i,
      /开仓.*?(\d+\.?\d*)\s*张/i
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
                  <th>张数</th>
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
    let statusLabel = statusTranslationKey ? t(statusTranslationKey) : "";
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
    bind(this.strategyBtn, this.openStrategyModal);
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

    if (this.strategyForm) {
      this.strategyForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void this.submitStrategyForm();
      });
    }

    if (this.settingsForm) {
      this.settingsForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void this.submitSettingsForm();
      });
    }

    if (this.accountCancelBtn) {
      this.accountCancelBtn.addEventListener("click", (event) => {
        event.preventDefault();
        this.hideModal(this.accountModal);
      });
    }

    if (this.strategyCancelBtn) {
      this.strategyCancelBtn.addEventListener("click", (event) => {
        event.preventDefault();
        this.hideModal(this.strategyModal);
      });
    }

    if (this.settingsCancelBtn) {
      this.settingsCancelBtn.addEventListener("click", (event) => {
        event.preventDefault();
        this.hideResetConfirmation();
        this.hideModal(this.settingsModal);
      });
    }

    if (this.testOkxBtn) {
      this.testOkxBtn.addEventListener("click", (event) => {
        event.preventDefault();
        void this.testOkxConnection();
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
      const response = await fetch("/api/public/model", {
        cache: "no-store",
        credentials: "same-origin",
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      if (data && typeof data.aiModelName === "string") {
        const publicConfig = { AI_MODEL_NAME: data.aiModelName };
        this.latestConfig = {
          ...(this.latestConfig ?? {}),
          ...publicConfig,
        };
        this.updateAiOverlay(publicConfig);
      }
    } catch (error) {
      console.warn("[ai-overlay] 获取公开模型信息失败", error);
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

      if (this.isAuthenticated && status && typeof status.csrfToken === "string" && window.csrfManager && typeof window.csrfManager.setToken === "function") {
        window.csrfManager.setToken(status.csrfToken);
      }

      if (this.isAuthenticated) {
        void this.fetchFullConfig();
        void this.fetchTradingLoopStatus();
      }
      // 未登录时不调用 updateAiOverlay()，保持 fetchPublicModelInfo() 设置的模型信息
    } catch (error) {
      console.warn("[auth] 查询登录状态失败", error);
      this.isAuthenticated = false;
      // 认证失败时也不覆盖 fetchPublicModelInfo() 的结果
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
    toggle(this.strategyBtn);
    toggle(this.settingsBtn);
    toggle(this.logoutBtn);
    toggle(this.tradingLoopToggle);
    
    // Show/hide language selector based on authentication
    const languageSelector = document.getElementById('language-selector');
    toggle(languageSelector);
    if (!shouldShow && languageSelector) {
      languageSelector.classList.remove("is-open");
    }
    updateLanguageSelectorUI();

    // 更新 AI 图标的可点击状态
    this.updateAiOverlayClickable();

    if (!shouldShow) {
      this.updateTradingLoopToggle(null);
      // 注意：不要隐藏 AI overlay，未登录用户也应该能看到状态更新
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
    if (!this.ensureAuthenticated() || !this.accountModal || !this.accountForm) {
      return;
    }

    const config = await this.fetchFullConfig();
    if (!config) {
      this.showToast("error", "加载失败", "无法加载配置，请稍后重试。");
      return;
    }

    this.populateForm(this.accountForm, config, ACCOUNT_CONFIG_KEYS);
    this.showModal(this.accountModal);
  }

  async openStrategyModal() {
    if (!this.ensureAuthenticated() || !this.strategyModal || !this.strategyForm) {
      return;
    }

    const config = await this.fetchFullConfig();
    if (!config) {
      this.showToast("error", "加载失败", "无法加载配置，请稍后重试。");
      return;
    }

    this.populateForm(this.strategyForm, config, STRATEGY_CONFIG_KEYS);
    this.activateStrategyTab("basic");
    this.updateStrategyPreview();
    this.showModal(this.strategyModal);
  }

  async openSettingsModal() {
    if (!this.ensureAuthenticated() || !this.settingsModal || !this.settingsForm) {
      return;
    }

    this.hideResetConfirmation();

    const config = await this.fetchFullConfig();
    if (!config) {
      this.showToast("error", "加载失败", "无法加载配置，请稍后重试。");
      return;
    }

    this.populateForm(this.settingsForm, config, SETTINGS_CONFIG_KEYS);
    this.applyPrivacyDependencies();
    this.showModal(this.settingsModal);
  }

  async fetchFullConfig(force = false) {
    if (!force && this.latestConfig) {
      this.updateAiOverlay(this.latestConfig);
      this.applyConfigSymbols(this.latestConfig);
      return this.latestConfig;
    }

    const response = await this.fetchJson("/api/config");
    if (!response || !response.config) {
      this.updateAiOverlay();
      return null;
    }

    this.latestConfig = response.config;
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
    if (!form || !config) return;

    keys.forEach((key) => {
      const field = form.querySelector(`[name="${key}"]`);
      if (!field) return;

      const value = config[key];
      if (field.type === "checkbox") {
        field.checked = String(value).toLowerCase() === "true";
        return;
      }

      if (typeof value === "string") {
        if (key === "TRADING_SYMBOLS") {
          field.value = value;
          return;
        }
        field.value = value;
        return;
      }

      if (value === undefined || value === null) {
        field.value = "";
      } else {
        field.value = String(value);
      }
    });
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

  async submitStrategyForm() {
    if (!this.ensureAuthenticated() || !this.strategyForm) {
      return;
    }

    const payload = this.collectFormValues(this.strategyForm, STRATEGY_CONFIG_KEYS);
    if (!payload) {
      this.showToast(
        "info",
        t("notifications.noChangesTitle"),
        t("notifications.noChangesMessage"),
      );
      return;
    }

    // 调试日志：查看 payload 内容
    console.log("[strategy] 提交的 payload:", payload);
    console.log("[strategy] TRADING_SYMBOLS 值:", payload.TRADING_SYMBOLS);
    console.log("[strategy] TRADING_SYMBOLS 是否存在:", payload.hasOwnProperty('TRADING_SYMBOLS'));

    // 验证交易币种：只在 payload 中包含 TRADING_SYMBOLS 时才验证（如果不包含说明值未改变）
    if (payload.hasOwnProperty('TRADING_SYMBOLS')) {
      if (!payload.TRADING_SYMBOLS || typeof payload.TRADING_SYMBOLS !== 'string' || payload.TRADING_SYMBOLS.trim() === '') {
        this.showToast(
          "warning",
          t("notifications.fieldMissingTitle"),
          t("notifications.tradingSymbolsRequired"),
        );
        return;
      }
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
          t("notifications.strategySaveTitle"),
          t("notifications.strategySaveMessage"),
        );
      } else if (reloadResult.error) {
        this.showToast(
          "warning",
          t("notifications.reloadFailedTitle"),
          t("notifications.reloadFailedMessage", { error: reloadResult.error }),
        );
      }

      this.hideModal(this.strategyModal);
      await this.fetchFullConfig(true);
      await this.refreshAll();
    } catch (error) {
      console.error("[strategy] 保存配置失败", error);
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
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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
      const response = await fetch("/api/reload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      const response = await fetch("/api/reset-live-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  async testOkxConnection() {
    if (!this.ensureAuthenticated() || !this.accountForm) {
      return;
    }

    const apiKey = this.accountForm.querySelector('[name="OKX_API_KEY"]')?.value.trim() || "";
    const apiSecret = this.accountForm.querySelector('[name="OKX_API_SECRET"]')?.value.trim() || "";
    const passphrase = this.accountForm.querySelector('[name="OKX_API_PASSPHRASE"]')?.value.trim() || "";
    const usePaper = this.accountForm.querySelector('[name="OKX_USE_PAPER"]')?.checked || false;

    const proxyInput = this.settingsForm?.querySelector('[name="HTTP_PROXY_URL"]');
    const proxyValue = proxyInput ? proxyInput.value.trim() : this.latestConfig?.HTTP_PROXY_URL || "";

    if (!apiKey || !apiSecret || !passphrase) {
      this.displayApiTestResult("api-test-result", "error", t("account.okx.testMessages.fillRequired"));
      return;
    }

    this.displayApiTestResult("api-test-result", "loading", t("account.okx.testMessages.testing"));

    try {
      const response = await fetch("/api/test-okx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          apiSecret,
          passphrase,
          usePaper,
          proxyUrl: proxyValue,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (response.ok && result.success) {
        let message = t("account.okx.testMessages.success");
        if (result.balance) {
          const balanceSuffix = t("account.okx.testMessages.balanceLabel", { balance: result.balance });
          if (balanceSuffix) {
            message = `${message}${balanceSuffix}`;
          }
        }
        this.displayApiTestResult("api-test-result", "success", message);
      } else {
        const detail = typeof result.error === "string" && result.error.trim()
          ? result.error.trim()
          : `HTTP ${response.status}`;
        this.displayApiTestResult("api-test-result", "error", t("account.okx.testMessages.failure", { detail }));
      }
    } catch (error) {
      console.error("[account] 测试 OKX API 失败", error);
      this.displayApiTestResult("api-test-result", "error", t("account.okx.testMessages.networkError"));
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
    const proxyValue = proxyInput ? proxyInput.value.trim() : this.latestConfig?.HTTP_PROXY_URL || "";

    if (!apiKey || !baseUrl || !modelName) {
      this.displayApiTestResult("ai-test-result", "error", t("settings.ai.testMessages.fillRequired"));
      return;
    }

    this.displayApiTestResult("ai-test-result", "loading", t("settings.ai.testMessages.testing"));

    try {
      const response = await fetch("/api/test-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      if (languageSelector.classList.contains("hidden")) {
        return;
      }
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
      if (languageSelector.classList.contains("hidden")) {
        return;
      }
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
