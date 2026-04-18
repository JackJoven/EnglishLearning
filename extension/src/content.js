(function runContextualReplacement() {
  const dictionary = window.AEL_DICTIONARY || [];
  const DEFAULT_SETTINGS = {
    enabled: true,
    direction: "both",
    strength: "low"
  };
  const STRENGTH_LIMITS = {
    low: 5,
    medium: 10,
    high: 18
  };
  const SKIP_SELECTOR = [
    "a",
    "button",
    "code",
    "pre",
    "script",
    "style",
    "noscript",
    "textarea",
    "input",
    "select",
    "option",
    "nav",
    "header",
    "footer",
    "[contenteditable='true']",
    "[role='button']",
    ".ael-replacement",
    ".ael-tooltip"
  ].join(",");

  let settings = { ...DEFAULT_SETTINGS };
  let ignoredIds = [];
  let tooltip;
  let hideTimer;
  let observer;
  let applying = false;
  let pagePaused = false;

  initialize();

  async function initialize() {
    const stored = await storageGet(["aelSettings", "aelIgnoredIds"]);
    settings = { ...DEFAULT_SETTINGS, ...(stored.aelSettings || {}) };
    ignoredIds = stored.aelIgnoredIds || [];

    createTooltip();
    bindDocumentEvents();
    bindMessages();
    bindStorageChanges();

    if (settings.enabled) {
      applyReplacements();
      observeDynamicContent();
    }
  }

  function bindDocumentEvents() {
    document.addEventListener("mouseover", (event) => {
      const target = event.target.closest(".ael-replacement");
      if (!target) return;
      showTooltip(target, event);
    });

    document.addEventListener("mousemove", (event) => {
      const target = event.target.closest(".ael-replacement");
      if (!target || !tooltip || tooltip.hidden) return;
      positionTooltip(event.clientX, event.clientY);
    });

    document.addEventListener("mouseout", (event) => {
      const target = event.target.closest(".ael-replacement");
      if (!target) return;
      scheduleTooltipHide();
    });
  }

  function bindMessages() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "ael-restore") {
        pagePaused = true;
        stopObservingDynamicContent();
        restoreOriginalText();
        sendResponse({ ok: true });
      }

      if (message.type === "ael-apply") {
        pagePaused = false;
        restoreOriginalText();
        if (settings.enabled) {
          applyReplacements();
          observeDynamicContent();
        }
        sendResponse({ ok: true });
      }

      return true;
    });
  }

  function bindStorageChanges() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;

      if (changes.aelSettings) {
        settings = { ...DEFAULT_SETTINGS, ...(changes.aelSettings.newValue || {}) };
        pagePaused = false;
        restoreOriginalText();

        if (settings.enabled) {
          applyReplacements();
          observeDynamicContent();
        } else {
          stopObservingDynamicContent();
        }
      }

      if (changes.aelIgnoredIds) {
        ignoredIds = changes.aelIgnoredIds.newValue || [];
        restoreIgnoredEntries();
      }
    });
  }

  function applyReplacements() {
    if (pagePaused) return;
    if (applying || !settings.enabled || !dictionary.length) return;
    if (!document.body) return;

    applying = true;
    const limit = STRENGTH_LIMITS[settings.strength] || STRENGTH_LIMITS.low;
    let count = document.querySelectorAll(".ael-replacement").length;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (count >= limit) return NodeFilter.FILTER_REJECT;
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodes = [];
    while (count < limit) {
      const node = walker.nextNode();
      if (!node) break;
      nodes.push(node);
    }

    for (const node of nodes) {
      if (count >= limit) break;
      const match = findBestMatch(node.nodeValue);
      if (!match) continue;
      replaceTextNode(node, match);
      count += 1;
    }

    applying = false;
  }

  function shouldSkipNode(node) {
    const parent = node.parentElement;
    if (!parent) return true;
    if (parent.closest(SKIP_SELECTOR)) return true;
    if (!isVisible(parent)) return true;
    return false;
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity) === 0) return false;
    return true;
  }

  function findBestMatch(text) {
    const candidates = dictionary.filter((entry) => !ignoredIds.includes(entry.id));
    let bestMatch = null;

    for (const entry of candidates) {
      const zhMatch = findZhMatch(text, entry);
      const enMatch = findEnMatch(text, entry);
      const nextMatch = chooseEarlier(zhMatch, enMatch);

      if (!nextMatch) continue;
      if (!bestMatch || nextMatch.index < bestMatch.index) {
        bestMatch = nextMatch;
      }
    }

    return bestMatch;
  }

  function findZhMatch(text, entry) {
    if (settings.direction === "en-to-zh") return null;
    const index = text.indexOf(entry.zh);
    if (index === -1) return null;
    return {
      entry,
      index,
      length: entry.zh.length,
      original: entry.zh,
      replacement: entry.en,
      direction: "zh-to-en"
    };
  }

  function findEnMatch(text, entry) {
    if (settings.direction === "zh-to-en") return null;
    const pattern = new RegExp(`\\b${escapeRegExp(entry.en)}\\b`, "i");
    const match = text.match(pattern);
    if (!match) return null;
    return {
      entry,
      index: match.index,
      length: match[0].length,
      original: match[0],
      replacement: entry.zh,
      direction: "en-to-zh"
    };
  }

  function chooseEarlier(first, second) {
    if (!first) return second;
    if (!second) return first;
    return first.index <= second.index ? first : second;
  }

  function replaceTextNode(node, match) {
    const fragment = document.createDocumentFragment();
    const before = node.nodeValue.slice(0, match.index);
    const after = node.nodeValue.slice(match.index + match.length);

    if (before) fragment.append(document.createTextNode(before));
    fragment.append(createReplacementSpan(match));
    if (after) fragment.append(document.createTextNode(after));

    node.replaceWith(fragment);
    recordExposure(match.entry.id);
  }

  function createReplacementSpan(match) {
    const span = document.createElement("span");
    span.className = "ael-replacement";
    span.textContent = match.replacement;
    span.dataset.aelEntryId = match.entry.id;
    span.dataset.aelOriginal = match.original;
    span.dataset.aelReplacement = match.replacement;
    span.dataset.aelDirection = match.direction;
    return span;
  }

  function restoreOriginalText() {
    hideTooltip();
    const spans = document.querySelectorAll(".ael-replacement");
    spans.forEach((span) => {
      const text = document.createTextNode(span.dataset.aelOriginal || span.textContent);
      const parent = span.parentNode;
      span.replaceWith(text);
      if (parent) parent.normalize();
    });
  }

  function restoreIgnoredEntries() {
    const spans = document.querySelectorAll(".ael-replacement");
    spans.forEach((span) => {
      if (!ignoredIds.includes(span.dataset.aelEntryId)) return;
      const text = document.createTextNode(span.dataset.aelOriginal || span.textContent);
      const parent = span.parentNode;
      span.replaceWith(text);
      if (parent) parent.normalize();
    });
  }

  function createTooltip() {
    tooltip = document.createElement("div");
    tooltip.className = "ael-tooltip";
    tooltip.hidden = true;
    tooltip.addEventListener("mouseenter", cancelTooltipHide);
    tooltip.addEventListener("mouseleave", scheduleTooltipHide);
    document.documentElement.append(tooltip);
  }

  function showTooltip(target, event) {
    const entry = dictionary.find((item) => item.id === target.dataset.aelEntryId);
    if (!entry) return;

    cancelTooltipHide();
    tooltip.innerHTML = renderTooltip(entry, target);
    tooltip.hidden = false;
    positionTooltip(event.clientX, event.clientY);
    bindTooltipActions(entry, target);
    markHoverOpened(entry.id);
  }

  function renderTooltip(entry, target) {
    const direction = target.dataset.aelDirection;
    const explanation = direction === "zh-to-en" ? entry.zhExplanation : entry.enExplanation;
    return `
      <div class="ael-tooltip__title">
        <span class="ael-tooltip__term">${escapeHtml(target.dataset.aelReplacement)}</span>
        <span class="ael-tooltip__tag">${escapeHtml(entry.difficulty)}</span>
      </div>
      <div class="ael-tooltip__row">
        <span class="ael-tooltip__label">原文：</span>${escapeHtml(target.dataset.aelOriginal)}
      </div>
      <div class="ael-tooltip__row">
        <span class="ael-tooltip__label">解释：</span>${escapeHtml(explanation)}
      </div>
      <div class="ael-tooltip__example">${escapeHtml(entry.example)}</div>
      <div class="ael-tooltip__actions">
        <button type="button" data-action="save">收藏</button>
        <button type="button" data-action="ignore">忽略这个词</button>
      </div>
    `;
  }

  function bindTooltipActions(entry, target) {
    const saveButton = tooltip.querySelector("[data-action='save']");
    const ignoreButton = tooltip.querySelector("[data-action='ignore']");

    saveButton.addEventListener("click", async () => {
      await saveEntry(entry, target);
      saveButton.textContent = "已收藏";
    });

    ignoreButton.addEventListener("click", async () => {
      await ignoreEntry(entry.id);
      hideTooltip();
    });
  }

  function positionTooltip(clientX, clientY) {
    const gap = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rect = tooltip.getBoundingClientRect();
    let left = clientX + gap;
    let top = clientY + gap;

    if (left + rect.width > viewportWidth - gap) {
      left = viewportWidth - rect.width - gap;
    }

    if (top + rect.height > viewportHeight - gap) {
      top = clientY - rect.height - gap;
    }

    tooltip.style.left = `${Math.max(gap, left)}px`;
    tooltip.style.top = `${Math.max(gap, top)}px`;
  }

  function scheduleTooltipHide() {
    hideTimer = window.setTimeout(hideTooltip, 180);
  }

  function cancelTooltipHide() {
    if (hideTimer) window.clearTimeout(hideTimer);
  }

  function hideTooltip() {
    if (tooltip) tooltip.hidden = true;
  }

  async function saveEntry(entry, target) {
    const stored = await storageGet(["aelVocabulary"]);
    const vocabulary = stored.aelVocabulary || {};
    vocabulary[entry.id] = {
      id: entry.id,
      zh: entry.zh,
      en: entry.en,
      explanation: entry.zhExplanation,
      example: entry.example,
      lastOriginal: target.dataset.aelOriginal,
      lastReplacement: target.dataset.aelReplacement,
      direction: target.dataset.aelDirection,
      sourceUrl: location.href,
      sourceTitle: document.title,
      savedAt: new Date().toISOString()
    };
    await storageSet({ aelVocabulary: vocabulary });
  }

  async function ignoreEntry(entryId) {
    const nextIgnoredIds = Array.from(new Set([...ignoredIds, entryId]));
    ignoredIds = nextIgnoredIds;
    await storageSet({ aelIgnoredIds: nextIgnoredIds });
    restoreIgnoredEntries();
  }

  async function recordExposure(entryId) {
    const stored = await storageGet(["aelExposureCounts"]);
    const counts = stored.aelExposureCounts || {};
    counts[entryId] = (counts[entryId] || 0) + 1;
    await storageSet({ aelExposureCounts: counts });
  }

  async function markHoverOpened(entryId) {
    const stored = await storageGet(["aelHoverCounts"]);
    const counts = stored.aelHoverCounts || {};
    counts[entryId] = (counts[entryId] || 0) + 1;
    await storageSet({ aelHoverCounts: counts });
  }

  function observeDynamicContent() {
    if (pagePaused) return;
    if (observer || !document.body) return;

    observer = new MutationObserver(() => {
      window.clearTimeout(observeDynamicContent.timer);
      observeDynamicContent.timer = window.setTimeout(applyReplacements, 300);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function stopObservingDynamicContent() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(values) {
    return new Promise((resolve) => chrome.storage.local.set(values, resolve));
  }
})();
