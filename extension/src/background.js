(function runBackground() {
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
      "JSON 格式：{\"items\":[{\"original\":\"原文片段\",\"replacement\":\"替换文本\",\"direction\":\"zh-to-en 或 en-to-zh\",\"term\":\"核心词\",\"explanation\":\"中文解释\",\"example\":\"自然英文例句\",\"difficulty\":\"A2/B1/B2/C1\"}]}",
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

  async function callChatJson(settings, messages, requiredKey) {
    try {
      const response = await fetch(settings.aiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.aiModel,
          messages,
          temperature: 0.2,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        return { ok: false, reason: `AI 请求失败：${response.status}` };
      }

      const payload = await response.json();
      const content = payload.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);

      if (requiredKey && parsed[requiredKey] === undefined) {
        return { ok: false, reason: "AI 返回格式不完整" };
      }

      return { ok: true, data: parsed };
    } catch (error) {
      return { ok: false, reason: error.message || "AI 请求失败" };
    }
  }

  async function getSettings() {
    const stored = await chrome.storage.local.get(["aelSettings"]);
    return { ...DEFAULT_SETTINGS, ...(stored.aelSettings || {}) };
  }
})();

