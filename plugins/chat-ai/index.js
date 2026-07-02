const express = require('express');

let context = null;
let lastChatAiUse = 0;
const thoughtLogs = [];

function addThoughtLog(text) {
  const logEntry = { timestamp: Date.now(), text };
  thoughtLogs.push(logEntry);
  if (thoughtLogs.length > 100) thoughtLogs.shift();
  // Broadcast to WS
  if (context && context.wsManager) {
    context.wsManager.broadcast('chatai_thought', logEntry);
  }
}

async function callOpenRouter(prompt, systemPrompt) {
  const settings = context.db.getAllSettings();
  const apiKey = settings.ai_api_key;
  let model = settings.ai_model || 'google/gemma-4-31b-it:free';
  if (!apiKey) {
    throw new Error('OpenRouter API Key not configured in Chat Guardian settings.');
  }

  const makeRequest = async (selectedModel) => {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      let parsed = {};
      try { parsed = JSON.parse(errText); } catch (e) {}
      const errMsg = parsed.error ? parsed.error.message : errText;
      if (res.status === 429 || errMsg.includes('rate-limit') || errMsg.includes('limit') || errMsg.includes('unavailable')) {
        throw { isRateLimit: true, message: errMsg };
      }
      throw new Error(`OpenRouter API error (${res.status}): ${errMsg}`);
    }

    const data = await res.json();
    if (data.error) {
      if (data.error.code === 429 || data.error.message.includes('rate-limit') || data.error.message.includes('limit') || data.error.message.includes('unavailable')) {
        throw { isRateLimit: true, message: data.error.message };
      }
      throw new Error(data.error.message);
    }
    return data.choices[0].message.content.trim();
  };

  try {
    return await makeRequest(model);
  } catch (e) {
    if (e.isRateLimit && model !== 'google/gemma-4-26b-a4b-it:free') {
      addThoughtLog(`[Chat AI] Model "${model}" rate-limited or unavailable. Retrying with fallback model (google/gemma-4-26b-a4b-it:free)...`);
      return await makeRequest('google/gemma-4-26b-a4b-it:free');
    }
    throw new Error(e.message || e);
  }
}

function init(ctx) {
  context = ctx;
  console.log('[Chat AI] Initializing Chat AI addon...');

  // Setup default settings if not exists
  if (!context.db.getSetting('chatai_cooldown')) {
    context.db.setSetting('chatai_cooldown', '500');
  }
  if (!context.db.getSetting('chatai_wake_word')) {
    context.db.setSetting('chatai_wake_word', 'guardian');
  }
  if (!context.db.getSetting('chatai_turbo_mode')) {
    context.db.setSetting('chatai_turbo_mode', 'false');
  }
  if (!context.db.getSetting('chatai_commands')) {
    const defaultCommands = [
      { trigger: 'ban ([a-zA-Z0-9_]+)', action: 'ban', label: 'Ban [user]' },
      { trigger: 'shoutout ([a-zA-Z0-9_]+)', action: 'shoutout', label: 'Shoutout [user]' },
      { trigger: 'tell chat', action: 'say', label: 'Say in Chat' },
      { trigger: 'tell message', action: 'imagine', label: 'Imagine & Say' }
    ];
    context.db.setSetting('chatai_commands', JSON.stringify(defaultCommands));
  }

  // Register endpoints
  const router = express.Router();

  router.get('/settings', (req, res) => {
    res.json({
      cooldown: context.db.getSetting('chatai_cooldown') || '500',
      wake_word: context.db.getSetting('chatai_wake_word') || 'guardian',
      turbo_mode: context.db.getSetting('chatai_turbo_mode') === 'true',
      commands: JSON.parse(context.db.getSetting('chatai_commands') || '[]')
    });
  });

  router.put('/settings', (req, res) => {
    const { cooldown, wake_word, turbo_mode, commands } = req.body;
    context.db.setSetting('chatai_cooldown', cooldown.toString());
    context.db.setSetting('chatai_wake_word', wake_word);
    if (turbo_mode !== undefined) {
      context.db.setSetting('chatai_turbo_mode', turbo_mode ? 'true' : 'false');
    }
    context.db.setSetting('chatai_commands', JSON.stringify(commands));
    res.json({ success: true });
  });

  router.get('/thought-logs', (req, res) => {
    res.json(thoughtLogs);
  });

  router.post('/chat', async (req, res) => {
    const { message } = req.body;
    addThoughtLog(`Streamer: "${message}"`);
    try {
      const channel = process.env.BROADCASTER_CHANNEL || 'streamer';
      const systemPrompt = `You are Chat AI, an advanced moderation and streaming companion for the streamer named "${channel}". You MUST preserve the exact spelling of "${channel}" (do not autocorrect it to Thrion or Therian, it contains the number 3). Be helpful, concise, and professional. Do not use emojis.`;
      const reply = await callOpenRouter(message, systemPrompt);
      addThoughtLog(`Chat AI Reply: "${reply}"`);
      res.json({ reply });
    } catch (e) {
      addThoughtLog(`AI Call Error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/command', async (req, res) => {
    const { text } = req.body;
    addThoughtLog(`Voice command received: "${text}"`);

    const commands = JSON.parse(context.db.getSetting('chatai_commands') || '[]');
    let matched = null;
    let targetUser = '';

    for (const cmd of commands) {
      try {
        const rx = new RegExp(cmd.trigger, 'i');
        const m = text.match(rx);
        if (m) {
          matched = cmd;
          if (m[1]) {
            targetUser = m[1].trim();
          } else {
            // Extract everything after the matched trigger phrase
            const idx = text.toLowerCase().indexOf(cmd.trigger.toLowerCase());
            if (idx !== -1) {
              targetUser = text.substring(idx + cmd.trigger.length).trim();
            } else {
              targetUser = '';
            }
          }
          break;
        }
      } catch (e) {
        console.warn('Invalid regex trigger:', cmd.trigger, e.message);
      }
    }

    if (matched) {
      addThoughtLog(`Command matched: ${matched.action} on "${targetUser}"`);
      res.json({
        matched: true,
        action: matched.action,
        target: targetUser,
        message: `Matched command: ${matched.action} on ${targetUser}. Do you want to proceed?`
      });
    } else {
      // Fallback: Use AI to interpret command
      addThoughtLog('No static regex matched. Asking AI to interpret command...');
      try {
        const systemPrompt = `Analyze the user input. Determine if they want to execute a command. 
Available actions:
- "ban": Ban a user
- "shoutout": Give a shoutout to a user
- "say": Say/send a message directly to chat
- "imagine": Imagine a creative message and say it in chat

IMPORTANT: If the user input is a general question (e.g. math queries like "how much is 3*4", trivia, facts), a greeting, general chat, or has no explicit request to execute a command or post to chat, you MUST reply with:
{"action": "none", "target": ""}

Reply ONLY with a JSON object in this format:
{"action": "ban" or "shoutout" or "say" or "imagine" or "none", "target": "username" or "message text" or "imagined message instruction" or ""}
Do not include any other text.`;

        const aiResponse = await callOpenRouter(text, systemPrompt);
        const parsed = JSON.parse(aiResponse);
        if (parsed.action && parsed.action !== 'none' && parsed.target) {
          addThoughtLog(`AI interpreted command: ${parsed.action} on "${parsed.target}"`);
          res.json({
            matched: true,
            action: parsed.action,
            target: parsed.target,
            message: `AI detected command: ${parsed.action} on ${parsed.target}. Do you want to proceed?`
          });
        } else {
          addThoughtLog('AI could not interpret any action.');
          res.json({ matched: false, message: "No action detected." });
        }
      } catch (e) {
        addThoughtLog(`AI Command interpretation failed: ${e.message}`);
        res.json({ matched: false, message: "Failed to parse command." });
      }
    }
  });

  router.post('/execute-command', async (req, res) => {
    const { action, target } = req.body;
    addThoughtLog(`Executing command: ${action} on ${target}`);

    const channel = process.env.BROADCASTER_CHANNEL;
    const streamerSession = context.db.getSessionByType('streamer');
    const botSession = context.db.getSessionByType('bot');
    const modToken = botSession ? botSession.access_token : (streamerSession ? streamerSession.access_token : null);
    const modId = botSession ? botSession.twitch_user_id : (streamerSession ? streamerSession.twitch_user_id : null);
    const broadcasterId = streamerSession ? streamerSession.twitch_user_id : null;

    if (!broadcasterId || !modToken || !modId) {
      addThoughtLog('Execution failed: Twitch session not connected.');
      return res.status(400).json({ error: 'Twitch sessions not connected.' });
    }

    try {
      if (action === 'ban') {
        // Resolve user ID
        const userObj = await context.twitchApi.resolveUser(target, modToken);
        if (userObj) {
          const reason = 'Chat AI Voice/Text command';
          await context.twitchApi.banUser(broadcasterId, modId, userObj.id, reason, modToken);
          addThoughtLog(`Successfully banned user ${target}`);
          
          // Send chat notification
          const client = context.twitchIrc.getClient();
          if (client) {
            client.say(channel, `[Chat AI] Banned user @${target}.`).catch(() => {});
          }
          res.json({ success: true, message: `Successfully banned @${target}.` });
        } else {
          throw new Error('User not found.');
        }
      } else if (action === 'shoutout') {
        const client = context.twitchIrc.getClient();
        if (client) {
          client.say(channel, `!so ${target}`).catch(() => {});
          addThoughtLog(`Sent shoutout command for ${target} to chat`);
        }
        res.json({ success: true, message: `Shoutout sent for @${target}.` });
      } else if (action === 'say') {
        const client = context.twitchIrc.getClient();
        if (client) {
          client.say(channel, target).catch(() => {});
          addThoughtLog(`Sent message to chat: "${target}"`);
        }
        res.json({ success: true, message: `Sent message: "${target}" to chat.` });
      } else if (action === 'imagine') {
        const client = context.twitchIrc.getClient();
        if (client) {
          addThoughtLog(`Imagining message content for instruction: "${target}"`);
          const imaginePrompt = `The streamer's name is "${channel}". You MUST use this exact spelling "${channel}" (preserve the underscore and the number 3, do not autocorrect it to Thrion/Therian). Imagine a short, creative, and engaging message to send to Twitch chat based on this instruction: "${target}". Respond with ONLY the imagined message text. Do not write any quotes, emojis, or conversational filler. Keep it under 200 characters.`;
          const systemPrompt = `You are a creative streaming companion writing a chat message on behalf of the streamer named "${channel}". You must preserve the spelling of "${channel}" exactly (with the number 3 and underscore, do not change it). Be concise, engaging, and professional.`;
          const imaginedMessage = await callOpenRouter(imaginePrompt, systemPrompt);
          
          client.say(channel, imaginedMessage).catch(() => {});
          addThoughtLog(`Successfully imagined and sent message: "${imaginedMessage}"`);
          res.json({ success: true, message: `Imagined and sent: "${imaginedMessage}"` });
        } else {
          throw new Error('IRC client not connected.');
        }
      } else {
        res.status(400).json({ error: 'Unsupported action.' });
      }
    } catch (e) {
      addThoughtLog(`Execution error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  context.api.use('/plugins/chat-ai', router);

  // Hook into Twitch IRC messages for !chatai
  const handleIrcMessage = async (channel, tags, messageText, self) => {
    if (self) return;
    if (messageText.startsWith('!chatai ')) {
      const cooldownSec = parseInt(context.db.getSetting('chatai_cooldown') || '500');
      const now = Date.now();
      if (now - lastChatAiUse < cooldownSec * 1000) {
        console.log('[Chat AI] Cooldown active, command ignored.');
        return;
      }
      lastChatAiUse = now;

      const question = messageText.slice(8).trim();
      addThoughtLog(`Viewer @${tags.username} asked: "${question}"`);

      try {
        const systemPrompt = "You are Chat AI, replying to a viewer in Twitch chat. Be extremely brief (under 150 chars). Do not use emojis.";
        const reply = await callOpenRouter(question, systemPrompt);
        addThoughtLog("Response to @" + tags.username + ": " + reply);
        
        const client = context.twitchIrc.getClient();
        if (client) {
          client.say(channel, `@${tags.username}: ${reply}`).catch(() => {});
        }
      } catch (e) {
        addThoughtLog(`Failed to answer viewer: ${e.message}`);
      }
    }
  };

  const client = context.twitchIrc.getClient();
  if (client) {
    client.on('message', handleIrcMessage);
    activePlugins.chat_ai_irc_handler = handleIrcMessage;
  }
}

function cleanup() {
  console.log('[Chat AI] Cleaning up Chat AI addon...');
  if (context && context.twitchIrc && activePlugins.chat_ai_irc_handler) {
    const client = context.twitchIrc.getClient();
    if (client) {
      client.off('message', activePlugins.chat_ai_irc_handler);
    }
  }
}

module.exports = { init, cleanup };
