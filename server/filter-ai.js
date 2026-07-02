const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = `You are a Twitch chat content moderator. Analyze the following chat message and respond with ONLY a JSON object (no markdown, no explanation, no code fences). Format: {"unsafe": true/false, "categories": ["harassment", "hate_speech", "sexual", "threats", "spam", "self_harm"], "confidence": 0.0-1.0}. Only include categories that apply. Be calibrated: normal Twitch chat banter, memes, and emotes are safe. Only flag genuinely problematic content.`;

async function checkMessageAI(messageText, context, settings) {
  const apiKey = settings.ai_api_key || process.env.OPENROUTER_DEFAULT_API_KEY;
  if (!apiKey) {
    console.warn('[AI] No OpenRouter API key configured');
    return null;
  }

  let model = settings.ai_model || 'google/gemma-4-26b-a4b-it:free';
  if (model.includes('llama-3.1-8b')) {
    model = 'google/gemma-4-26b-a4b-it:free'; // fallback retired model
  }

  let systemPrompt = SYSTEM_PROMPT;
  if (global.aiSystemPromptModifier) {
    try {
      systemPrompt = global.aiSystemPromptModifier(systemPrompt, settings);
    } catch (e) {
      console.warn('[AI] Prompt modifier error:', e.message);
    }
  }

  const messages = [{ role: 'system', content: systemPrompt }];
  if (context && context.length > 0) {
    messages.push({ role: 'user', content: `Recent chat context:\n${context.join('\n')}\n\nNow analyze this message:` });
  }
  messages.push({ role: 'user', content: messageText });

  const makeRequest = async (selectedModel) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Chat Guardian',
          'HTTP-Referer': 'http://localhost'
        },
        body: JSON.stringify({ model: selectedModel, messages, max_tokens: 200, temperature: 0.1 }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        let parsed = {};
        try { parsed = JSON.parse(errText); } catch (e) {}
        const errMsg = parsed.error ? parsed.error.message : errText;
        if (res.status === 429 || res.status === 404 || errMsg.includes('rate-limit') || errMsg.includes('limit') || errMsg.includes('unavailable')) {
          throw { isRetryable: true, message: errMsg };
        }
        throw new Error(`OpenRouter API error (${res.status}): ${errMsg}`);
      }

      const data = await res.json();
      if (data.error) {
        if (data.error.code === 429 || data.error.code === 404 || data.error.message.includes('rate-limit') || data.error.message.includes('limit') || data.error.message.includes('unavailable')) {
          throw { isRetryable: true, message: data.error.message };
        }
        throw new Error(data.error.message);
      }

      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) {
        throw new Error('Empty response from OpenRouter');
      }

      let jsonStr = content.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();

      const verdict = JSON.parse(jsonStr);
      return {
        unsafe: !!verdict.unsafe,
        categories: Array.isArray(verdict.categories) ? verdict.categories : [],
        confidence: typeof verdict.confidence === 'number' ? verdict.confidence : 0.5
      };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  };

  try {
    return await makeRequest(model);
  } catch (err) {
    if (err.isRetryable && model !== 'google/gemma-4-26b-a4b-it:free') {
      console.warn(`[AI] Model "${model}" failed/rate-limited. Retrying with fallback model (google/gemma-4-26b-a4b-it:free)...`);
      try {
        return await makeRequest('google/gemma-4-26b-a4b-it:free');
      } catch (retryErr) {
        console.error('[AI] Fallback model also failed:', retryErr.message || retryErr);
        return null;
      }
    }
    console.warn('[AI] OpenRouter error:', err.message || err);
    return null;
  }
}

module.exports = { checkMessageAI };
