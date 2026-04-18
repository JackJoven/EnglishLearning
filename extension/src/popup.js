(function runPopup() {
  const DEFAULT_SETTINGS = {
    enabled: true,
    direction: "both",
    strength: "low"
  };

  const enabledInput = document.querySelector("#enabled");
  const directionInput = document.querySelector("#direction");
  const strengthInput = document.querySelector("#strength");
  const savedCount = document.querySelector("#savedCount");
  const ignoredCount = document.querySelector("#ignoredCount");
  const openVocabularyButton = document.querySelector("#openVocabulary");
  const openReviewButton = document.querySelector("#openReview");
  const openRewriteButton = document.querySelector("#openRewrite");
  const openSettingsButton = document.querySelector("#openSettings");
  const applyPageButton = document.querySelector("#applyPage");
  const restorePageButton = document.querySelector("#restorePage");
  const toggleSiteButton = document.querySelector("#toggleSite");
  const statusText = document.querySelector("#status");
  let currentHost = "";
  let currentSettings = { ...DEFAULT_SETTINGS };

  initialize();

  async function initialize() {
    const stored = await storageGet(["aelSettings", "aelVocabulary", "aelIgnoredIds"]);
    const settings = { ...DEFAULT_SETTINGS, ...(stored.aelSettings || {}) };
    const tab = await getActiveTab();
    currentHost = tab?.url ? new URL(tab.url).hostname : "";
    currentSettings = settings;

    enabledInput.checked = Boolean(settings.enabled);
    directionInput.value = settings.direction;
    strengthInput.value = settings.strength;
    updateStats(stored);
    updateSiteButton();
    bindEvents();
  }

  function bindEvents() {
    enabledInput.addEventListener("change", saveSettingsFromForm);
    directionInput.addEventListener("change", saveSettingsFromForm);
    strengthInput.addEventListener("change", saveSettingsFromForm);

    openVocabularyButton.addEventListener("click", () => openApp("#vocabulary"));
    openReviewButton.addEventListener("click", () => openApp("#review"));
    openRewriteButton.addEventListener("click", () => openApp("#rewrite"));
    openSettingsButton.addEventListener("click", () => openApp("#settings"));

    applyPageButton.addEventListener("click", async () => {
      await sendActiveTabMessage({ type: "ael-apply" });
      showStatus("已重新应用本页");
    });

    restorePageButton.addEventListener("click", async () => {
      await sendActiveTabMessage({ type: "ael-restore" });
      showStatus("已恢复本页原文");
    });

    toggleSiteButton.addEventListener("click", toggleCurrentSite);

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (changes.aelVocabulary || changes.aelIgnoredIds) {
        refreshStats();
      }
      if (changes.aelSettings) {
        currentSettings = { ...DEFAULT_SETTINGS, ...(changes.aelSettings.newValue || {}) };
        updateSiteButton();
      }
    });
  }

  async function saveSettingsFromForm() {
    const settings = {
      enabled: enabledInput.checked,
      direction: directionInput.value,
      strength: strengthInput.value,
      disabledSites: currentSettings.disabledSites || [],
      aiEnabled: currentSettings.aiEnabled || false,
      aiEndpoint: currentSettings.aiEndpoint || "https://api.openai.com/v1/chat/completions",
      aiModel: currentSettings.aiModel || "gpt-4o-mini",
      apiKey: currentSettings.apiKey || ""
    };

    currentSettings = settings;
    await storageSet({ aelSettings: settings });
    showStatus("设置已保存");
  }

  async function refreshStats() {
    const stored = await storageGet(["aelVocabulary", "aelIgnoredIds"]);
    updateStats(stored);
  }

  function updateStats(stored) {
    savedCount.textContent = Object.keys(stored.aelVocabulary || {}).length;
    ignoredCount.textContent = (stored.aelIgnoredIds || []).length;
  }

  async function sendActiveTabMessage(message) {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      showStatus("没有找到当前页面");
      return;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, message);
    } catch (_error) {
      showStatus("当前页面暂不可用，刷新后再试");
    }
  }

  async function toggleCurrentSite() {
    if (!currentHost) {
      showStatus("当前页面没有可用域名");
      return;
    }

    const disabledSites = new Set(currentSettings.disabledSites || []);
    if (disabledSites.has(currentHost)) {
      disabledSites.delete(currentHost);
    } else {
      disabledSites.add(currentHost);
    }

    currentSettings = {
      ...currentSettings,
      disabledSites: Array.from(disabledSites)
    };
    await storageSet({ aelSettings: currentSettings });
    updateSiteButton();
    await sendActiveTabMessage(disabledSites.has(currentHost) ? { type: "ael-restore" } : { type: "ael-apply" });
  }

  function updateSiteButton() {
    if (!currentHost) {
      toggleSiteButton.textContent = "当前页面不可配置";
      toggleSiteButton.disabled = true;
      return;
    }

    const disabled = (currentSettings.disabledSites || []).includes(currentHost);
    toggleSiteButton.textContent = disabled ? `启用 ${currentHost}` : `暂停 ${currentHost}`;
    toggleSiteButton.disabled = false;
  }

  async function openApp(hash) {
    await chrome.runtime.sendMessage({ type: "ael-open-app", hash });
    window.close();
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function showStatus(message) {
    statusText.textContent = message;
    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(() => {
      statusText.textContent = "";
    }, 1800);
  }

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(values) {
    return new Promise((resolve) => chrome.storage.local.set(values, resolve));
  }
})();
