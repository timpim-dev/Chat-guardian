const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = `You are a Twitch chat content moderator. Analyze the following chat message and respond with ONLY a JSON object (no markdown, no explanation, no code fences). Format: {"unsafe": true/false, "categories": ["harassment", "hate_speech", "sexual", "threats", "spam", "self_harm"], "confidence": 0.0-1.0}. Only include categories that apply. Be calibrated: normal Twitch chat banter, memes, and emotes are safe. Only flag genuinely problematic content.`;

async function checkMessageAI(messageText, context, settings) {
  const apiKey = settings.ai_api_key || process.env.OPENROUTER_DEFAULT_API_KEY;
  if (!apiKey) {
    console.warn('[AI] No OpenRouter API key configured');
    return null;
  }

  const model = settings.ai_model || 'meta-llama/llama-3.1-8b-instruct:free';
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (context && context.length > 0) {
    messages.push({ role: 'user', content: `Recent chat context:\n${context.join('\n')}\n\nNow analyze this message:` });
  }
  messages.push({ role: 'user', content: messageText });

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
      body: JSON.stringify({ model, messages, max_tokens: 200, temperature: 0.1 }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown');
      console.warn(`[AI] OpenRouter returned ${res.status}: ${err}`);
      return null;
    }

    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) {
      console.warn('[AI] Empty response from OpenRouter');
      return null;
    }

    // Parse JSON from response (handle markdown code fences)
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
    if (err.name === 'AbortError') {
      console.warn('[AI] OpenRouter request timed out (10s)');
    } else {
      console.warn('[AI] OpenRouter error:', err.message);
    }
    return null;
  }
}

module.exports = { checkMessageAI };
