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
  const model = settings.ai_model || 'google/gemma-4-31b-it:free';
  if (!apiKey) {
    throw new Error('OpenRouter API Key not configured in Chat Guardian settings.');
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message);
  }
  return data.choices[0].message.content.trim();
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
  if (!context.db.getSetting('chatai_commands')) {
    const defaultCommands = [
      { trigger: 'ban ([a-zA-Z0-9_]+)', action: 'ban', label: 'Ban [user]' },
      { trigger: 'shoutout ([a-zA-Z0-9_]+)', action: 'shoutout', label: 'Shoutout [user]' }
    ];
    context.db.setSetting('chatai_commands', JSON.stringify(defaultCommands));
  }

  // Register endpoints
  const router = express.Router();

  router.get('/settings', (req, res) => {
    res.json({
      cooldown: context.db.getSetting('chatai_cooldown') || '500',
      wake_word: context.db.getSetting('chatai_wake_word') || 'guardian',
      commands: JSON.parse(context.db.getSetting('chatai_commands') || '[]')
    });
  });

  router.put('/settings', (req, res) => {
    const { cooldown, wake_word, commands } = req.body;
    context.db.setSetting('chatai_cooldown', cooldown.toString());
    context.db.setSetting('chatai_wake_word', wake_word);
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
      const systemPrompt = "You are Chat AI, an advanced moderation and streaming companion. You can assist the streamer. Be helpful, concise, and professional. Do not use emojis.";
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
      const rx = new RegExp(cmd.trigger, 'i');
      const m = text.match(rx);
      if (m) {
        matched = cmd;
        targetUser = m[1] || '';
        break;
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
        const systemPrompt = `Analyze the user input. Determine if they want to execute an action. 
Available actions:
- "ban": Ban a user
- "shoutout": Give a shoutout to a user

Reply ONLY with a JSON object in this format:
{"action": "ban" or "shoutout" or "none", "target": "username" or ""}
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
      } else {
        res.status(400).json({ error: 'Unsupported action.' });
      }
    } catch (e) {
      addThoughtLog(`Execution error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  context.app.use('/api/plugins/chat-ai', router);

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
