(function runContextualReplacement() {
  const dictionary = window.AEL_DICTIONARY || [];
  const DEFAULT_SETTINGS = {
    enabled: true,
    direction: "both",
    strength: "low",
    disabledSites: [],
    aiEnabled: false,
    aiEndpoint: "https://api.openai.com/v1/chat/completions",
    aiModel: "gpt-4o-mini",
    apiKey: ""
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
  let aiEntries = [];
  let aiRequestInFlight = false;
  let aiRequestedForPage = false;

  initialize();

  async function initialize() {
    const stored = await storageGet(["aelSettings", "aelIgnoredIds"]);
    settings = { ...DEFAULT_SETTINGS, ...(stored.aelSettings || {}) };
    ignoredIds = stored.aelIgnoredIds || [];

    createTooltip();
    bindDocumentEvents();
    bindMessages();
    bindStorageChanges();

    if (isReplacementAllowed()) {
      applyReplacements();
      requestAiReplacementSuggestions();
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
        aiRequestedForPage = false;
        restoreOriginalText();
        if (isReplacementAllowed()) {
          applyReplacements();
          requestAiReplacementSuggestions();
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
        aiRequestedForPage = false;
        aiEntries = [];
        restoreOriginalText();

        if (isReplacementAllowed()) {
          applyReplacements();
          requestAiReplacementSuggestions();
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
    if (applying || !isReplacementAllowed() || !getReplacementEntries().length) return;
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
    const candidates = getReplacementEntries().filter((entry) => !ignoredIds.includes(entry.id));
    let bestMatch = null;

    for (const entry of candidates) {
      const zhMatch = entry.kind === "ai" ? findAiMatch(text, entry) : findZhMatch(text, entry);
      const enMatch = entry.kind === "ai" ? null : findEnMatch(text, entry);
      const nextMatch = chooseEarlier(zhMatch, enMatch);

      if (!nextMatch) continue;
      if (!bestMatch || nextMatch.index < bestMatch.index) {
        bestMatch = nextMatch;
      }
    }

    return bestMatch;
  }

  function getReplacementEntries() {
    return [...aiEntries, ...dictionary];
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

  function findAiMatch(text, entry) {
    if (!entry.original || !entry.replacement) return null;
    if (settings.direction !== "both" && settings.direction !== entry.direction) return null;

    const isEnglish = entry.direction === "en-to-zh";
    const pattern = isEnglish ? new RegExp(`\\b${escapeRegExp(entry.original)}\\b`, "i") : null;
    const match = pattern ? text.match(pattern) : null;
    const index = pattern ? match?.index ?? -1 : text.indexOf(entry.original);
    const matchedText = pattern && match ? match[0] : entry.original;

    if (index === -1) return null;

    return {
      entry,
      index,
      length: matchedText.length,
      original: matchedText,
      replacement: entry.replacement,
      direction: entry.direction
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
    span.dataset.aelSource = match.entry.kind || "builtin";
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
    const entry = getReplacementEntries().find((item) => item.id === target.dataset.aelEntryId);
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
    const explanation = entry.kind === "ai" ? entry.explanation : direction === "zh-to-en" ? entry.zhExplanation : entry.enExplanation;
    return `
      <div class="ael-tooltip__title">
        <span class="ael-tooltip__term">${escapeHtml(target.dataset.aelReplacement)}</span>
        <span class="ael-tooltip__tag">${escapeHtml(entry.difficulty || "AI")}</span>
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
      zh: entry.zh || (target.dataset.aelDirection === "zh-to-en" ? target.dataset.aelOriginal : target.dataset.aelReplacement),
      en: entry.en || entry.term || (target.dataset.aelDirection === "zh-to-en" ? target.dataset.aelReplacement : target.dataset.aelOriginal),
      explanation: entry.kind === "ai" ? entry.explanation : entry.zhExplanation,
      example: entry.example,
      masteryStatus: vocabulary[entry.id]?.masteryStatus || "new",
      lastOriginal: target.dataset.aelOriginal,
      lastReplacement: target.dataset.aelReplacement,
      direction: target.dataset.aelDirection,
      source: entry.kind || "builtin",
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
    const stored = await storageGet(["aelExposureCounts", "aelReplacementEvents"]);
    const counts = stored.aelExposureCounts || {};
    counts[entryId] = (counts[entryId] || 0) + 1;
    const events = stored.aelReplacementEvents || [];
    events.unshift({
      id: crypto.randomUUID(),
      entryId,
      pageUrl: location.href,
      pageTitle: document.title,
      createdAt: new Date().toISOString()
    });
    await storageSet({
      aelExposureCounts: counts,
      aelReplacementEvents: events.slice(0, 200)
    });
  }

  async function markHoverOpened(entryId) {
    const stored = await storageGet(["aelHoverCounts"]);
    const counts = stored.aelHoverCounts || {};
    counts[entryId] = (counts[entryId] || 0) + 1;
    await storageSet({ aelHoverCounts: counts });
  }

  function observeDynamicContent() {
    if (pagePaused) return;
    if (!isReplacementAllowed()) return;
    if (observer || !document.body) return;

    observer = new MutationObserver(() => {
      window.clearTimeout(observeDynamicContent.timer);
      observeDynamicContent.timer = window.setTimeout(() => {
        applyReplacements();
        requestAiReplacementSuggestions();
      }, 300);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  async function requestAiReplacementSuggestions() {
    if (aiRequestInFlight || aiRequestedForPage) return;
    if (!isReplacementAllowed() || !settings.aiEnabled || !settings.apiKey) return;

    const text = collectVisibleTextSample();
    if (text.length < 80) return;

    aiRequestInFlight = true;
    aiRequestedForPage = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "ael-ai-replacements",
        payload: {
          text,
          direction: settings.direction,
          strength: settings.strength,
          url: location.href,
          title: document.title
        }
      });

      if (response?.ok && Array.isArray(response.data?.items)) {
        aiEntries = response.data.items.map(normalizeAiEntry).filter(Boolean);
        applyReplacements();
      }
    } catch (_error) {
      aiEntries = [];
    } finally {
      aiRequestInFlight = false;
    }
  }

  function normalizeAiEntry(item, index) {
    const original = String(item.original || "").trim();
    const replacement = String(item.replacement || "").trim();
    const direction = item.direction === "en-to-zh" ? "en-to-zh" : item.direction === "zh-to-en" ? "zh-to-en" : "";

    if (!original || !replacement || !direction) return null;

    return {
      id: `ai-${hashText(`${original}-${replacement}-${direction}`)}-${index}`,
      kind: "ai",
      original,
      replacement,
      direction,
      zh: direction === "zh-to-en" ? original : replacement,
      en: direction === "zh-to-en" ? replacement : original,
      term: item.term || replacement,
      explanation: item.explanation || "AI 根据当前网页语境推荐的替换。",
      example: item.example || "",
      difficulty: item.difficulty || "AI"
    };
  }

  function collectVisibleTextSample() {
    if (!document.body) return "";

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const chunks = [];
    let total = 0;
    while (total < 3500) {
      const node = walker.nextNode();
      if (!node) break;
      const text = node.nodeValue.trim().replace(/\s+/g, " ");
      if (text.length < 12) continue;
      chunks.push(text);
      total += text.length;
    }

    return chunks.join("\n").slice(0, 3500);
  }

  function isReplacementAllowed() {
    if (!settings.enabled || pagePaused) return false;
    return !isCurrentSiteDisabled();
  }

  function isCurrentSiteDisabled() {
    const hostname = location.hostname;
    return (settings.disabledSites || []).some((site) => {
      const normalized = String(site).trim().replace(/^https?:\/\//, "").split("/")[0];
      return normalized && (hostname === normalized || hostname.endsWith(`.${normalized}`));
    });
  }

  function hashText(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
    }
    return Math.abs(hash).toString(36);
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
