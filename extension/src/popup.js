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
  const applyPageButton = document.querySelector("#applyPage");
  const restorePageButton = document.querySelector("#restorePage");
  const statusText = document.querySelector("#status");

  initialize();

  async function initialize() {
    const stored = await storageGet(["aelSettings", "aelVocabulary", "aelIgnoredIds"]);
    const settings = { ...DEFAULT_SETTINGS, ...(stored.aelSettings || {}) };

    enabledInput.checked = Boolean(settings.enabled);
    directionInput.value = settings.direction;
    strengthInput.value = settings.strength;
    updateStats(stored);
    bindEvents();
  }

  function bindEvents() {
    enabledInput.addEventListener("change", saveSettingsFromForm);
    directionInput.addEventListener("change", saveSettingsFromForm);
    strengthInput.addEventListener("change", saveSettingsFromForm);

    applyPageButton.addEventListener("click", async () => {
      await sendActiveTabMessage({ type: "ael-apply" });
      showStatus("已重新应用本页");
    });

    restorePageButton.addEventListener("click", async () => {
      await sendActiveTabMessage({ type: "ael-restore" });
      showStatus("已恢复本页原文");
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (changes.aelVocabulary || changes.aelIgnoredIds) {
        refreshStats();
      }
    });
  }

  async function saveSettingsFromForm() {
    const settings = {
      enabled: enabledInput.checked,
      direction: directionInput.value,
      strength: strengthInput.value
    };

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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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

