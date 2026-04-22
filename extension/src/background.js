(function runBackground() {
  const DEFAULT_SETTINGS = {
    enabled: true,
    direction: "both",
    strength: "low",
    useBuiltinDictionary: true,
    disabledSites: [],
    aiEnabled: false,
    aiEndpoint: "https://api.openai.com/v1/chat/completions",
    aiModel: "gpt-4o-mini",
    apiKey: ""
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "ael-open-app") {
      chrome.tabs.create({ url: chrome.runtime.getURL(`app.html${message.hash || ""}`) });
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "ael-ai-replacements") {
      handleAiReplacements(message.payload).then(sendResponse);
      return true;
    }

    if (message.type === "ael-ai-rewrite") {
      handleAiRewrite(message.payload).then(sendResponse);
      return true;
    }

    if (message.type === "ael-ai-review") {
      handleAiReview(message.payload).then(sendResponse);
      return true;
    }

    if (message.type === "ael-ai-entry") {
      handleAiEntry(message.payload).then(sendResponse);
      return true;
    }

    if (message.type === "ael-ai-test") {
      handleAiTest(message.payload).then(sendResponse);
      return true;
    }

    if (message.type === "ael-phonetic-lookup") {
      handlePhoneticLookup(message.payload).then(sendResponse);
      return true;
    }

    return false;
  });

  async function handleAiReplacements(payload) {
    const settings = await getSettings();
    if (!settings.aiEnabled || !settings.apiKey) {
      return { ok: false, reason: "AI 未启用或缺少 API Key" };
    }

    const maxItems = settings.strength === "high" ? 12 : settings.strength === "medium" ? 8 : 4;
    const prompt = [
      "你是一个英语学习浏览器插件的替换决策器。",
      "任务：从页面片段中选择少量适合学习的中文词组替换成英文，或英文词组替换成中文。",
      "只返回 JSON，不要 Markdown。",
      "JSON 格式：{\"items\":[{\"original\":\"原文片段\",\"replacement\":\"替换文本\",\"direction\":\"zh-to-en 或 en-to-zh\",\"term\":\"核心词\",\"phonetic\":\"英式或美式 IPA 音标，例如 /kənˈstreɪnt/\",\"explanation\":\"中文解释\",\"example\":\"自然英文例句\",\"difficulty\":\"A2/B1/B2/C1\"}]}",
      `替换方向：${payload.direction || settings.direction}`,
      `最多返回 ${maxItems} 个。`,
      "规则：不要替换专有名词、数字、代码、标题党词。替换后必须自然，不要过密。",
      "页面片段：",
      payload.text || ""
    ].join("\n");

    return callChatJson(settings, [
      { role: "system", content: "Return strict JSON only." },
      { role: "user", content: prompt }
    ], "items");
  }

  async function handleAiRewrite(payload) {
    const settings = await getSettings();
    if (!settings.aiEnabled || !settings.apiKey) {
      return { ok: false, reason: "AI 未启用或缺少 API Key" };
    }

    const vocabulary = payload.vocabulary || [];
    const prompt = [
      "你是一个帮助中文用户自然写英文的助手。",
      "用户会给一句中文，请给 2 到 3 个自然英文表达，并优先使用用户最近学过的词。",
      "只返回 JSON，不要 Markdown。",
      "JSON 格式：{\"recommendation\":\"最推荐表达\",\"usedTerms\":[\"term\"],\"alternatives\":[\"表达1\",\"表达2\"],\"notes\":\"简短中文说明\"}",
      `用户最近词汇：${vocabulary.map((item) => `${item.en}=${item.zh}`).join(", ") || "无"}`,
      `中文：${payload.text || ""}`
    ].join("\n");

    return callChatJson(settings, [
      { role: "system", content: "Return strict JSON only." },
      { role: "user", content: prompt }
    ], "recommendation");
  }

  async function handleAiReview(payload) {
    const settings = await getSettings();
    if (!settings.aiEnabled || !settings.apiKey) {
      return { ok: false, reason: "AI 未启用或缺少 API Key" };
    }

    const prompt = [
      "你是英语学习复习反馈助手。",
      "请判断用户是否正确使用目标词，给出 0-100 分和一句简短中文反馈。",
      "只返回 JSON，不要 Markdown。",
      "JSON 格式：{\"score\":80,\"feedback\":\"反馈\",\"suggestedAnswer\":\"参考答案\"}",
      `目标词：${payload.term || ""}`,
      `中文含义：${payload.zh || ""}`,
      `任务：${payload.prompt || ""}`,
      `用户答案：${payload.answer || ""}`
    ].join("\n");

    return callChatJson(settings, [
      { role: "system", content: "Return strict JSON only." },
      { role: "user", content: prompt }
    ], "score");
  }

  async function handleAiEntry(payload) {
    const settings = await getSettings();
    if (!settings.aiEnabled || !settings.apiKey) {
      return { ok: false, reason: "AI 未启用或缺少 API Key" };
    }

    const prompt = [
      "你是英语学习词库助手。",
      "用户划选了网页中的一个词或词组，请补全个人词库条目。",
      "只返回 JSON，不要 Markdown。",
      "JSON 格式：{\"zh\":\"中文含义\",\"en\":\"英文表达\",\"phonetic\":\"英式或美式 IPA 音标，例如 /kənˈstreɪnt/\",\"direction\":\"zh-to-en 或 en-to-zh\",\"explanation\":\"一句中文解释\",\"example\":\"一个自然英文例句\",\"difficulty\":\"A2/B1/B2/C1\"}",
      `用户划选：${payload.selectedText || ""}`,
      `默认方向：${payload.direction || "zh-to-en"}`,
      "页面上下文：",
      payload.context || ""
    ].join("\n");

    return callChatJson(settings, [
      { role: "system", content: "Return strict JSON only." },
      { role: "user", content: prompt }
    ], "en");
  }

  async function handleAiTest(payload) {
    const settings = {
      ...DEFAULT_SETTINGS,
      aiEndpoint: String(payload?.aiEndpoint || "").trim() || DEFAULT_SETTINGS.aiEndpoint,
      aiModel: String(payload?.aiModel || "").trim() || DEFAULT_SETTINGS.aiModel,
      apiKey: String(payload?.apiKey || "").trim()
    };

    if (!settings.aiEndpoint) {
      return { ok: false, reason: "缺少 API Endpoint" };
    }

    if (!settings.aiModel) {
      return { ok: false, reason: "缺少 Model" };
    }

    if (!settings.apiKey) {
      return { ok: false, reason: "缺少 API Key" };
    }

    const startedAt = Date.now();

    try {
      const response = await postChat(settings, [
        { role: "system", content: "You are a connectivity check. Reply briefly." },
        { role: "user", content: "Reply with PONG" }
      ], false);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        return { ok: false, reason: formatApiError(response.status, payload) };
      }

      const preview = String(payload.choices?.[0]?.message?.content || "").trim().replace(/\s+/g, " ").slice(0, 48);
      if (!preview) {
        return { ok: false, reason: "接口已连接，但没有返回可用内容" };
      }

      return {
        ok: true,
        data: {
          latencyMs: Date.now() - startedAt,
          preview
        }
      };
    } catch (error) {
      return { ok: false, reason: error.message || "接口测试失败" };
    }
  }

  async function handlePhoneticLookup(payload) {
    const term = String(payload?.term || "").trim().toLowerCase();
    if (!term || !/^[a-z][a-z-]*$/i.test(term)) {
      return { ok: false, reason: "只支持英文单词音标查询" };
    }

    const cacheKey = `phonetic:${term}`;
    const stored = await chrome.storage.local.get(["aelPhoneticCache"]);
    const cache = stored.aelPhoneticCache || {};

    if (cache[cacheKey]) {
      return { ok: true, phonetic: cache[cacheKey], cached: true };
    }

    try {
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`);
      if (!response.ok) return { ok: false, reason: `音标查询失败：${response.status}` };

      const entries = await response.json();
      const phonetic = findPhonetic(entries);
      if (!phonetic) return { ok: false, reason: "没有找到音标" };

      cache[cacheKey] = phonetic;
      await chrome.storage.local.set({ aelPhoneticCache: cache });
      return { ok: true, phonetic, cached: false };
    } catch (error) {
      return { ok: false, reason: error.message || "音标查询失败" };
    }
  }

  function findPhonetic(payload) {
    const entries = Array.isArray(payload) ? payload : [];
    for (const entry of entries) {
      if (entry.phonetic) return entry.phonetic;
      const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
      const found = phonetics.find((item) => item.text);
      if (found?.text) return found.text;
    }
    return "";
  }

  async function callChatJson(settings, messages, requiredKey) {
    try {
      let response = await postChat(settings, messages, true);
      let payload = await response.json().catch(() => ({}));

      if (!response.ok && response.status === 400) {
        response = await postChat(settings, messages, false);
        payload = await response.json().catch(() => ({}));
      }

      if (!response.ok) {
        return { ok: false, reason: `AI 请求失败：${response.status}` };
      }

      const content = payload.choices?.[0]?.message?.content || "{}";
      const parsed = parseJsonContent(content);

      if (requiredKey && parsed[requiredKey] === undefined) {
        return { ok: false, reason: "AI 返回格式不完整" };
      }

      return { ok: true, data: parsed };
    } catch (error) {
      return { ok: false, reason: error.message || "AI 请求失败" };
    }
  }

  function postChat(settings, messages, useJsonMode) {
    const body = {
      model: settings.aiModel,
      messages,
      temperature: 0.2
    };

    if (useJsonMode) {
      body.response_format = { type: "json_object" };
    }

    return fetch(settings.aiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify(body)
    });
  }

  function parseJsonContent(content) {
    const trimmed = String(content || "").trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    return JSON.parse(candidate);
  }

  function formatApiError(status, payload) {
    const detail = payload?.error?.message
      || payload?.message
      || payload?.detail
      || "";
    return detail ? `AI 请求失败：${status}，${detail}` : `AI 请求失败：${status}`;
  }

  async function getSettings() {
    const stored = await chrome.storage.local.get(["aelSettings"]);
    return { ...DEFAULT_SETTINGS, ...(stored.aelSettings || {}) };
  }
})();
