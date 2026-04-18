(function runApp() {
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
  const MASTERY_LABELS = {
    new: "陌生",
    passive: "被动认识",
    familiar: "半熟",
    active: "主动可用",
    mastered: "已掌握"
  };

  let state = {
    settings: { ...DEFAULT_SETTINGS },
    vocabulary: {},
    ignoredIds: [],
    reviewRecords: [],
    reviewQueue: [],
    reviewIndex: 0,
    latestRewrite: ""
  };

  const viewButtons = document.querySelectorAll(".nav__item");
  const views = document.querySelectorAll(".view");
  const vocabularyList = document.querySelector("#vocabularyList");
  const vocabularySearch = document.querySelector("#vocabularySearch");
  const masteryFilter = document.querySelector("#masteryFilter");
  const totalWords = document.querySelector("#totalWords");
  const activeWords = document.querySelector("#activeWords");
  const reviewRecords = document.querySelector("#reviewRecords");
  const startReview = document.querySelector("#startReview");
  const reviewEmpty = document.querySelector("#reviewEmpty");
  const reviewCard = document.querySelector("#reviewCard");
  const reviewProgress = document.querySelector("#reviewProgress");
  const reviewTaskType = document.querySelector("#reviewTaskType");
  const reviewTerm = document.querySelector("#reviewTerm");
  const reviewPrompt = document.querySelector("#reviewPrompt");
  const reviewAnswer = document.querySelector("#reviewAnswer");
  const reviewFeedback = document.querySelector("#reviewFeedback");
  const checkReview = document.querySelector("#checkReview");
  const nextReview = document.querySelector("#nextReview");
  const rewriteInput = document.querySelector("#rewriteInput");
  const rewriteButton = document.querySelector("#rewriteButton");
  const copyRewrite = document.querySelector("#copyRewrite");
  const rewriteResults = document.querySelector("#rewriteResults");
  const settingsForm = document.querySelector("#settingsForm");
  const exportData = document.querySelector("#exportData");
  const exportOutput = document.querySelector("#exportOutput");
  const clearIgnored = document.querySelector("#clearIgnored");
  const resetData = document.querySelector("#resetData");
  const settingsStatus = document.querySelector("#settingsStatus");

  initialize();

  async function initialize() {
    await loadState();
    bindNavigation();
    bindVocabulary();
    bindReview();
    bindRewrite();
    bindSettings();
    routeFromHash();
    renderAll();
  }

  async function loadState() {
    const stored = await chrome.storage.local.get([
      "aelSettings",
      "aelVocabulary",
      "aelIgnoredIds",
      "aelReviewRecords"
    ]);
    state.settings = { ...DEFAULT_SETTINGS, ...(stored.aelSettings || {}) };
    state.vocabulary = stored.aelVocabulary || {};
    state.ignoredIds = stored.aelIgnoredIds || [];
    state.reviewRecords = stored.aelReviewRecords || [];
  }

  function bindNavigation() {
    viewButtons.forEach((button) => {
      button.addEventListener("click", () => {
        activateView(button.dataset.view);
      });
    });

    window.addEventListener("hashchange", routeFromHash);
  }

  function bindVocabulary() {
    vocabularySearch.addEventListener("input", renderVocabulary);
    masteryFilter.addEventListener("change", renderVocabulary);
    vocabularyList.addEventListener("click", async (event) => {
      const action = event.target.dataset.action;
      const id = event.target.closest("[data-id]")?.dataset.id;
      if (!action || !id) return;

      if (action === "delete") {
        delete state.vocabulary[id];
        await saveVocabulary();
      }
    });

    vocabularyList.addEventListener("change", async (event) => {
      if (event.target.dataset.action !== "mastery") return;
      const id = event.target.closest("[data-id]")?.dataset.id;
      if (!id || !state.vocabulary[id]) return;
      state.vocabulary[id].masteryStatus = event.target.value;
      state.vocabulary[id].updatedAt = new Date().toISOString();
      await saveVocabulary();
    });
  }

  function bindReview() {
    startReview.addEventListener("click", startReviewRound);
    nextReview.addEventListener("click", showNextReview);
    checkReview.addEventListener("click", checkCurrentReview);
  }

  function bindRewrite() {
    rewriteButton.addEventListener("click", rewriteChinese);
    copyRewrite.addEventListener("click", async () => {
      if (!state.latestRewrite) return;
      await navigator.clipboard.writeText(state.latestRewrite);
      renderRewriteMessage("已复制推荐表达。");
    });
  }

  function bindSettings() {
    settingsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      state.settings = readSettingsForm();
      await chrome.storage.local.set({ aelSettings: state.settings });
      showSettingsStatus("设置已保存。");
    });

    exportData.addEventListener("click", () => {
      exportOutput.value = JSON.stringify({
        settings: { ...state.settings, apiKey: state.settings.apiKey ? "***" : "" },
        vocabulary: state.vocabulary,
        ignoredIds: state.ignoredIds,
        reviewRecords: state.reviewRecords
      }, null, 2);
    });

    clearIgnored.addEventListener("click", async () => {
      state.ignoredIds = [];
      await chrome.storage.local.set({ aelIgnoredIds: [] });
      showSettingsStatus("已清空忽略词。");
    });

    resetData.addEventListener("click", async () => {
      const confirmed = window.confirm("确定要清空生词、复习记录、忽略词和替换统计吗？这个操作不可恢复。");
      if (!confirmed) return;

      state.vocabulary = {};
      state.ignoredIds = [];
      state.reviewRecords = [];
      await chrome.storage.local.remove([
        "aelVocabulary",
        "aelIgnoredIds",
        "aelReviewRecords",
        "aelExposureCounts",
        "aelHoverCounts",
        "aelReplacementEvents"
      ]);
      renderAll();
      showSettingsStatus("学习数据已清空。");
    });
  }

  function routeFromHash() {
    const view = location.hash.replace("#", "") || "vocabulary";
    activateView(view);
  }

  function activateView(viewName) {
    viewButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === viewName);
    });
    views.forEach((view) => {
      view.classList.toggle("is-active", view.id === `view-${viewName}`);
    });
    if (location.hash !== `#${viewName}`) {
      history.replaceState(null, "", `#${viewName}`);
    }
  }

  function renderAll() {
    renderVocabulary();
    renderSettings();
    renderStats();
  }

  function renderStats() {
    const items = Object.values(state.vocabulary);
    totalWords.textContent = items.length;
    activeWords.textContent = items.filter((item) => ["active", "mastered"].includes(item.masteryStatus)).length;
    reviewRecords.textContent = state.reviewRecords.length;
  }

  function renderVocabulary() {
    const keyword = vocabularySearch.value.trim().toLowerCase();
    const status = masteryFilter.value;
    const items = Object.values(state.vocabulary)
      .filter((item) => status === "all" || getMastery(item) === status)
      .filter((item) => {
        const haystack = [item.en, item.zh, item.example, item.explanation].join(" ").toLowerCase();
        return !keyword || haystack.includes(keyword);
      })
      .sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));

    if (!items.length) {
      vocabularyList.innerHTML = `<div class="empty">还没有匹配的词。去网页里 hover 一个替换词并收藏它。</div>`;
      renderStats();
      return;
    }

    vocabularyList.innerHTML = items.map((item) => renderVocabularyCard(item)).join("");
    renderStats();
  }

  function renderVocabularyCard(item) {
    const mastery = getMastery(item);
    return `
      <article class="card" data-id="${escapeHtml(item.id)}">
        <div class="card__head">
          <div>
            <div class="term">${escapeHtml(item.en || item.term || item.id)}</div>
            <div class="translation">${escapeHtml(item.zh || "")}</div>
          </div>
          <select data-action="mastery" aria-label="掌握状态">
            ${Object.entries(MASTERY_LABELS).map(([value, label]) => (
              `<option value="${value}" ${value === mastery ? "selected" : ""}>${label}</option>`
            )).join("")}
          </select>
        </div>
        <div>${escapeHtml(item.explanation || "")}</div>
        <div class="meta">${escapeHtml(item.example || "")}</div>
        <div class="tag-row">
          <span class="tag">${escapeHtml(MASTERY_LABELS[mastery])}</span>
          <span class="tag">${escapeHtml(item.direction || "saved")}</span>
          ${item.sourceTitle ? `<span class="tag">${escapeHtml(item.sourceTitle)}</span>` : ""}
        </div>
        <div class="button-row">
          <button type="button" data-action="delete">删除</button>
        </div>
      </article>
    `;
  }

  function startReviewRound() {
    const items = Object.values(state.vocabulary);
    if (!items.length) {
      reviewEmpty.hidden = false;
      reviewCard.hidden = true;
      return;
    }

    state.reviewQueue = items
      .filter((item) => getMastery(item) !== "mastered")
      .sort(() => Math.random() - 0.5)
      .slice(0, 5);

    if (!state.reviewQueue.length) {
      state.reviewQueue = items.sort(() => Math.random() - 0.5).slice(0, 5);
    }

    state.reviewIndex = 0;
    reviewEmpty.hidden = true;
    reviewCard.hidden = false;
    renderReviewCard();
  }

  function renderReviewCard() {
    const item = getCurrentReviewItem();
    if (!item) {
      reviewCard.hidden = true;
      reviewEmpty.hidden = false;
      reviewEmpty.textContent = "这一轮复习完成了。";
      renderVocabulary();
      return;
    }

    const task = buildReviewTask(item, state.reviewIndex);
    reviewCard.dataset.taskType = task.type;
    reviewProgress.textContent = `${state.reviewIndex + 1} / ${state.reviewQueue.length}`;
    reviewTaskType.textContent = task.label;
    reviewTerm.textContent = item.en || item.term;
    reviewPrompt.textContent = task.prompt;
    reviewAnswer.value = "";
    reviewFeedback.hidden = true;
    reviewFeedback.textContent = "";
  }

  function buildReviewTask(item, index) {
    const type = ["meaning", "rewrite", "sentence"][index % 3];
    if (type === "meaning") {
      return { type, label: "回忆含义", prompt: `不用查资料，写出 ${item.en} 在语境里的中文意思。` };
    }
    if (type === "rewrite") {
      return { type, label: "中文改写", prompt: `用 ${item.en} 改写这句话：${item.zh || item.explanation || "这个表达更自然。"}` };
    }
    return { type, label: "主动造句", prompt: `用 ${item.en} 写一句和你工作或生活有关的英文句子。` };
  }

  async function checkCurrentReview() {
    const item = getCurrentReviewItem();
    if (!item) return;

    const answer = reviewAnswer.value.trim();
    if (!answer) {
      reviewFeedback.hidden = false;
      reviewFeedback.textContent = "先写一点答案，再提交。";
      return;
    }

    let result = scoreReviewLocally(item, answer);
    const aiResult = await requestAiReview(item, answer);
    if (aiResult) result = aiResult;

    reviewFeedback.hidden = false;
    reviewFeedback.innerHTML = `
      <strong>${result.score} 分</strong>
      <p>${escapeHtml(result.feedback)}</p>
      ${result.suggestedAnswer ? `<p>参考：${escapeHtml(result.suggestedAnswer)}</p>` : ""}
    `;

    updateMasteryAfterReview(item, result.score);
    state.reviewRecords.push({
      id: crypto.randomUUID(),
      vocabularyItemId: item.id,
      term: item.en,
      prompt: reviewPrompt.textContent,
      answer,
      score: result.score,
      feedback: result.feedback,
      createdAt: new Date().toISOString()
    });
    await Promise.all([saveVocabulary(false), saveReviewRecords()]);
    renderStats();
  }

  function showNextReview() {
    state.reviewIndex += 1;
    renderReviewCard();
  }

  function getCurrentReviewItem() {
    return state.reviewQueue[state.reviewIndex];
  }

  function scoreReviewLocally(item, answer) {
    const lower = answer.toLowerCase();
    const term = (item.en || "").toLowerCase();
    const zh = item.zh || "";
    let score = 55;

    if (term && lower.includes(term)) score += 30;
    if (zh && answer.includes(zh)) score += 10;
    if (answer.length > 24) score += 5;

    score = Math.min(100, score);
    return {
      score,
      feedback: score >= 80 ? "不错，已经能主动唤醒这个词了。" : "意思接近了，下一次尽量把目标词放进完整句子里。",
      suggestedAnswer: item.example
    };
  }

  async function requestAiReview(item, answer) {
    if (!state.settings.aiEnabled || !state.settings.apiKey) return null;
    const response = await chrome.runtime.sendMessage({
      type: "ael-ai-review",
      payload: {
        term: item.en,
        zh: item.zh,
        prompt: reviewPrompt.textContent,
        answer
      }
    });
    if (!response?.ok) return null;
    return response.data;
  }

  async function rewriteChinese() {
    const text = rewriteInput.value.trim();
    if (!text) {
      renderRewriteMessage("先输入一句中文。");
      return;
    }

    const local = rewriteLocally(text);
    let result = local;

    if (state.settings.aiEnabled && state.settings.apiKey) {
      const ai = await chrome.runtime.sendMessage({
        type: "ael-ai-rewrite",
        payload: {
          text,
          vocabulary: Object.values(state.vocabulary).slice(0, 30)
        }
      });
      if (ai?.ok) result = ai.data;
    }

    state.latestRewrite = result.recommendation || result.alternatives?.[0] || "";
    renderRewriteResult(result);
  }

  function rewriteLocally(text) {
    const used = [];
    let recommendation = text;
    const entries = [...Object.values(state.vocabulary), ...dictionary];

    entries.forEach((entry) => {
      if (!entry.zh || !entry.en) return;
      if (recommendation.includes(entry.zh)) {
        recommendation = recommendation.replace(entry.zh, entry.en);
        used.push(entry.en);
      }
    });

    if (recommendation === text) {
      const first = entries.find((entry) => entry.en && entry.example);
      recommendation = first ? first.example : "Try turning this idea into a short English sentence.";
    }

    return {
      recommendation,
      usedTerms: used.slice(0, 5),
      alternatives: [recommendation],
      notes: used.length ? "已优先使用你的词库表达。" : "本地词表没有命中；配置 AI 后可以生成更自然的表达。"
    };
  }

  function renderRewriteResult(result) {
    rewriteResults.innerHTML = `
      <article class="card">
        <h3>推荐表达</h3>
        <p class="term">${escapeHtml(result.recommendation || "")}</p>
        <p>${escapeHtml(result.notes || "")}</p>
        <div class="tag-row">
          ${(result.usedTerms || []).map((term) => `<span class="tag">${escapeHtml(term)}</span>`).join("")}
        </div>
      </article>
      ${(result.alternatives || []).map((item) => `<article class="card">${escapeHtml(item)}</article>`).join("")}
    `;
  }

  function renderRewriteMessage(message) {
    rewriteResults.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  }

  function renderSettings() {
    document.querySelector("#settingEnabled").checked = state.settings.enabled;
    document.querySelector("#settingDirection").value = state.settings.direction;
    document.querySelector("#settingStrength").value = state.settings.strength;
    document.querySelector("#disabledSites").value = (state.settings.disabledSites || []).join("\n");
    document.querySelector("#aiEnabled").checked = state.settings.aiEnabled;
    document.querySelector("#aiEndpoint").value = state.settings.aiEndpoint;
    document.querySelector("#aiModel").value = state.settings.aiModel;
    document.querySelector("#apiKey").value = state.settings.apiKey;
  }

  function readSettingsForm() {
    return {
      enabled: document.querySelector("#settingEnabled").checked,
      direction: document.querySelector("#settingDirection").value,
      strength: document.querySelector("#settingStrength").value,
      disabledSites: document.querySelector("#disabledSites").value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      aiEnabled: document.querySelector("#aiEnabled").checked,
      aiEndpoint: document.querySelector("#aiEndpoint").value.trim() || DEFAULT_SETTINGS.aiEndpoint,
      aiModel: document.querySelector("#aiModel").value.trim() || DEFAULT_SETTINGS.aiModel,
      apiKey: document.querySelector("#apiKey").value.trim()
    };
  }

  function updateMasteryAfterReview(item, score) {
    const current = getMastery(item);
    const order = ["new", "passive", "familiar", "active", "mastered"];
    const index = order.indexOf(current);
    const nextIndex = score >= 85 ? Math.min(order.length - 1, index + 1) : score < 50 ? Math.max(0, index - 1) : index;
    item.masteryStatus = order[nextIndex] || "new";
    item.updatedAt = new Date().toISOString();
    item.lastReviewedAt = new Date().toISOString();
  }

  async function saveVocabulary(rerender = true) {
    await chrome.storage.local.set({ aelVocabulary: state.vocabulary });
    if (rerender) renderVocabulary();
  }

  async function saveReviewRecords() {
    await chrome.storage.local.set({ aelReviewRecords: state.reviewRecords });
  }

  function getMastery(item) {
    return item.masteryStatus || "new";
  }

  function showSettingsStatus(message) {
    settingsStatus.textContent = message;
    window.clearTimeout(showSettingsStatus.timer);
    showSettingsStatus.timer = window.setTimeout(() => {
      settingsStatus.textContent = "";
    }, 2000);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
