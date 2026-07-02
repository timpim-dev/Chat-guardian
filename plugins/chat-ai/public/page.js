// Chat AI Plugin Frontend page scripts
window.ChatAiPage = {
  settings: { cooldown: 500, wake_word: 'guardian', commands: [] },
  thoughtLogs: [],
  speechRecognizer: null,
  isListening: false,
  pendingCommand: null,

  renderChat(container) {
    // Inject custom voice orb CSS if not already present
    let styleTag = document.getElementById('chatai-voice-orb-styles');
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'chatai-voice-orb-styles';
      styleTag.innerHTML = `
        .voice-orb-container {
          position: relative;
          width: 100px;
          height: 100px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 30px auto;
        }
        .voice-orb {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          background: var(--accent-safe-text, #8a2be2);
          box-shadow: 0 0 25px var(--accent-safe-text, #8a2be2);
          z-index: 2;
          animation: orb-pulse-size 2s infinite ease-in-out;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .voice-orb-pulse {
          position: absolute;
          width: 50px;
          height: 50px;
          border-radius: 50%;
          border: 2px solid var(--accent-safe-text, #8a2be2);
          opacity: 0;
          animation: orb-ripple 2s infinite ease-out;
          z-index: 1;
        }
        .voice-orb-pulse.delay-1 {
          animation-delay: 0.6s;
        }
        .voice-orb-pulse.delay-2 {
          animation-delay: 1.2s;
        }
        @keyframes orb-pulse-size {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          50% { transform: scale(1.15); filter: brightness(1.3); }
        }
        @keyframes orb-ripple {
          0% {
            transform: scale(1);
            opacity: 0.8;
          }
          100% {
            transform: scale(2.8);
            opacity: 0;
          }
        }
        #chatai-chat-card {
          transition: border-color 0.3s ease, box-shadow 0.3s ease;
        }
        #chatai-chat-card.listening-active {
          border-color: var(--accent-safe-text, #8a2be2) !important;
          box-shadow: 0 0 15px var(--accent-safe-text, #8a2be2);
          animation: card-border-pulse 2s infinite ease-in-out;
        }
        @keyframes card-border-pulse {
          0%, 100% { box-shadow: 0 0 5px rgba(138, 43, 226, 0.2); }
          50% { box-shadow: 0 0 20px var(--accent-safe-text, #8a2be2); }
        }
      `;
      document.head.appendChild(styleTag);
    }

    container.innerHTML = `
      <div class="header-row">
        <h1 class="page-title">Chat AI Assistant</h1>
        <div>
          <button id="btn-audio-toggle" onclick="ChatAiPage.toggleAudioMode()" class="btn-secondary">Audio Mode: Off</button>
        </div>
      </div>

      <div style="display:flex;gap:20px;height:calc(100vh - 180px)">
        <!-- Chat Area -->
        <div id="chatai-chat-card" class="card" style="flex:2;display:flex;flex-direction:column;justify-content:space-between">
          <div id="chatai-chat-messages" style="flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:10px">
            <div class="text-muted" style="text-align:center;margin-top:20px">Send a message or enable voice mode to start.</div>
          </div>
          <div style="display:flex;gap:10px;padding-top:10px;border-top:1px solid var(--border)">
            <input type="text" id="chatai-input" placeholder="Type a message to Chat AI..." style="flex:1" onkeydown="if(event.key==='Enter') ChatAiPage.sendMessage()">
            <button onclick="ChatAiPage.sendMessage()" class="btn-primary">Send</button>
          </div>
        </div>

        <!-- Dynamic Action Overlay / Status -->
        <div class="card" style="flex:1;display:flex;flex-direction:column;gap:15px">
          <h3>AI Voice Command Status</h3>
          <div id="audio-status-box" class="text-muted" style="font-size:12px;background:rgba(255,255,255,0.02);padding:10px;border-radius:4px;text-align:center">
            Audio mode is currently disabled. Enable Audio Mode to use voice commands.
          </div>
          <div id="voice-confirmation-box" style="display:none;background:rgba(255,193,7,0.05);padding:12px;border:1px solid #ffc107;border-radius:4px">
            <p id="voice-confirmation-msg" style="margin-bottom:10px;font-weight:bold"></p>
            <div style="display:flex;gap:10px">
              <button onclick="ChatAiPage.confirmCommand(true)" class="btn-primary" style="background:#ffc107;color:#000">Yes, execute</button>
              <button onclick="ChatAiPage.confirmCommand(false)" class="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  renderSettings(container) {
    container.innerHTML = `
      <div class="header-row">
        <h1 class="page-title">Chat AI Settings & Logs</h1>
      </div>

      <div style="display:flex;gap:20px;height:calc(100vh - 180px)">
        <!-- Settings Form -->
        <div class="card" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:20px">
          <h2>Addon Configuration</h2>
          <div class="setting-row">
            <span class="setting-label">!chatai Cooldown (seconds)</span>
            <span class="setting-value"><input type="number" id="chatai-cooldown-input" value="${this.settings.cooldown}"></span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Voice Wake Word</span>
            <span class="setting-value"><input type="text" id="chatai-wakeword-input" value="${this.settings.wake_word}"></span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Turbo Mode (No Confirmation)</span>
            <span class="setting-value">
              <label class="toggle">
                <input type="checkbox" id="chatai-turbomode-input" ${this.settings.turbo_mode ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </span>
          </div>
          <div>
            <h3>Voice / Text Command Triggers</h3>
            <div id="commands-list" style="display:flex;flex-direction:column;gap:10px;margin-top:10px"></div>
            <button onclick="ChatAiPage.addCommandRow()" class="btn-secondary" style="margin-top:10px;width:100%">+ Add Command</button>
          </div>
          <button onclick="ChatAiPage.saveSettings()" class="btn-primary" style="margin-top:20px">Save Settings</button>
        </div>

        <!-- Thought Logs -->
        <div class="card" style="flex:1.5;display:flex;flex-direction:column">
          <h2>AI Thought Logs</h2>
          <div id="thought-logs-container" style="flex:1;overflow-y:auto;background:#000;color:#0f0;font-family:monospace;padding:10px;border-radius:4px;font-size:12px;margin-top:10px">
            Loading thought logs...
          </div>
        </div>
      </div>
    `;
    this.renderCommandsList();
    this.loadThoughtLogs();
  },

  async loadSettings() {
    try {
      const data = await App.api('GET', '/api/plugins/chat-ai/settings');
      this.settings = data;
    } catch (e) {
      console.warn('Failed to load Chat AI settings:', e);
    }
  },

  async saveSettings() {
    const cooldown = parseInt(document.getElementById('chatai-cooldown-input').value) || 500;
    const wake_word = document.getElementById('chatai-wakeword-input').value.trim() || 'guardian';
    const turbo_mode = document.getElementById('chatai-turbomode-input').checked;

    const commands = [];
    const rows = document.querySelectorAll('.command-item-row');
    rows.forEach(row => {
      const trigger = row.querySelector('.cmd-trigger').value.trim();
      const action = row.querySelector('.cmd-action').value;
      if (trigger) {
        let label = 'Say in Chat';
        if (action === 'ban') label = 'Ban [user]';
        else if (action === 'shoutout') label = 'Shoutout [user]';
        else if (action === 'imagine') label = 'Imagine & Say';
        commands.push({ trigger, action, label });
      }
    });

    try {
      await App.api('PUT', '/api/plugins/chat-ai/settings', { cooldown, wake_word, turbo_mode, commands });
      this.settings = { cooldown, wake_word, turbo_mode, commands };
      Toast.show('Chat AI settings saved', 'success');
    } catch (e) {
      Toast.show('Failed to save settings: ' + e.message, 'error');
    }
  },

  renderCommandsList() {
    const list = document.getElementById('commands-list');
    if (!list) return;
    list.innerHTML = '';
    this.settings.commands.forEach((cmd, idx) => {
      this.addCommandRow(cmd);
    });
  },

  addCommandRow(cmd = { trigger: '', action: 'shoutout' }) {
    const list = document.getElementById('commands-list');
    const div = document.createElement('div');
    div.className = 'command-item-row';
    div.style = 'display:flex;gap:10px;align-items:center';
    div.innerHTML = `
      <input type="text" class="cmd-trigger" placeholder="Regex trigger, ex: ban (\\w+)" value="${cmd.trigger}" style="flex:2">
      <select class="cmd-action" style="flex:1">
        <option value="shoutout" ${cmd.action === 'shoutout' ? 'selected' : ''}>Shoutout</option>
        <option value="ban" ${cmd.action === 'ban' ? 'selected' : ''}>Ban</option>
        <option value="say" ${cmd.action === 'say' ? 'selected' : ''}>Say in Chat</option>
        <option value="imagine" ${cmd.action === 'imagine' ? 'selected' : ''}>Imagine & Say</option>
      </select>
      <button onclick="this.parentElement.remove()" class="btn-secondary" style="padding:4px 8px;background:var(--accent-error-text);color:#fff">Delete</button>
    `;
    list.appendChild(div);
  },

  async loadThoughtLogs() {
    const container = document.getElementById('thought-logs-container');
    if (!container) return;
    try {
      const data = await App.api('GET', '/api/plugins/chat-ai/thought-logs');
      this.thoughtLogs = data;
      this.renderThoughtLogs();
    } catch (e) {
      container.textContent = 'Failed to load logs.';
    }
  },

  renderThoughtLogs() {
    const container = document.getElementById('thought-logs-container');
    if (!container) return;
    if (this.thoughtLogs.length === 0) {
      container.textContent = 'No thought logs recorded.';
      return;
    }
    container.innerHTML = this.thoughtLogs.map(log => {
      const time = App.formatTime(log.timestamp);
      return `<div style="margin-bottom:4px"><span style="color:#aaa">[${time}]</span> ${App.escapeHtml(log.text)}</div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
  },

  addLocalMessage(sender, text) {
    const container = document.getElementById('chatai-chat-messages');
    if (!container) return;
    const child = container.querySelector('.text-muted');
    if (child) child.remove();

    const div = document.createElement('div');
    div.style = sender === 'You' ? 'align-self:flex-end;background:rgba(255,255,255,0.05);padding:10px;border-radius:8px;max-width:70%' : 'align-self:flex-start;background:rgba(138,43,226,0.1);padding:10px;border-radius:8px;max-width:70%';
    div.innerHTML = `<strong style="color:var(--accent-info-text)">${sender}:</strong> <div>${App.escapeHtml(text)}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  async sendMessage() {
    const input = document.getElementById('chatai-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    this.addLocalMessage('You', msg);

    try {
      // First, check if the text matches a command trigger (regex or AI command)
      const cmdRes = await App.api('POST', '/api/plugins/chat-ai/command', { text: msg });
      if (cmdRes.matched) {
        const cmdPayload = { action: cmdRes.action, target: cmdRes.target };
        if (this.settings.turbo_mode) {
          Toast.show('Turbo execution: sending message...', 'info');
          try {
            const execRes = await App.api('POST', '/api/plugins/chat-ai/execute-command', cmdPayload);
            Toast.show(execRes.message, 'success');
          } catch (err) {
            Toast.show('Turbo execution failed: ' + err.message, 'error');
          }
        } else {
          this.pendingCommand = cmdPayload;
          const confirmBox = document.getElementById('voice-confirmation-box');
          if (confirmBox) {
            document.getElementById('voice-confirmation-msg').textContent = cmdRes.message;
            confirmBox.style.display = 'block';
          }
        }
        return;
      }

      // If no command matched, fall back to normal AI conversation
      const res = await App.api('POST', '/api/plugins/chat-ai/chat', { message: msg });
      this.addLocalMessage('Chat AI', res.reply);
    } catch (e) {
      this.addLocalMessage('System Error', e.message);
    }
  },

  toggleAudioMode() {
    if (this.isListening) {
      this.stopSpeechRecognition();
    } else {
      this.startSpeechRecognition();
    }
  },

  startSpeechRecognition() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) {
      Toast.show('Web Speech API is not supported in this browser.', 'error');
      return;
    }

    const rec = new Speech();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';

    rec.onstart = () => {
      this.isListening = true;
      document.getElementById('btn-audio-toggle').textContent = 'Audio Mode: On';
      document.getElementById('btn-audio-toggle').style.background = 'var(--accent-error-text)';
      const card = document.getElementById('chatai-chat-card');
      if (card) card.classList.add('listening-active');
      document.getElementById('audio-status-box').innerHTML = `
        <div style="margin-bottom:10px;text-align:center">Listening for wake word: <strong>"${this.settings.wake_word}"</strong>...</div>
        <div class="voice-orb-container">
          <div class="voice-orb-pulse"></div>
          <div class="voice-orb-pulse delay-1"></div>
          <div class="voice-orb-pulse delay-2"></div>
          <div class="voice-orb">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="var(--bg, #0a0a0a)">
              <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
            </svg>
          </div>
        </div>
      `;
    };

    rec.onerror = (e) => {
      console.error('Speech recognition error:', e.error);
      Toast.show('Speech recognition error: ' + e.error + '. Please check microphone settings.', 'error');
      this.stopSpeechRecognition();
    };

    rec.onresult = async (event) => {
      const rawResult = event.results[event.results.length - 1][0].transcript.trim();
      console.log('Heard speech:', rawResult);

      const result = rawResult.toLowerCase();
      const wake = this.settings.wake_word.toLowerCase();
      
      // Smart check: allow matching even with punctuation (e.g. "hey, guardian")
      const cleanResult = result.replace(/[\s,.:;!?]+/g, ' ');
      const cleanWake = wake.replace(/[\s,.:;!?]+/g, ' ');

      if (cleanResult.includes(cleanWake)) {
        let cmdText = '';
        const idx = cleanResult.indexOf(cleanWake);
        if (idx !== -1) {
          cmdText = cleanResult.substring(idx + cleanWake.length).trim();
        } else {
          cmdText = result.split(wake).pop().trim();
        }

        // Clean leading/trailing punctuation from the command text (e.g. leading commas, dots)
        cmdText = cmdText.replace(/^[\s,.:;!?]+/, '').trim();

        if (cmdText) {
          Toast.show('Wake word detected. Parsing command: ' + cmdText, 'info');
          // Send to server to parse
          try {
            const res = await App.api('POST', '/api/plugins/chat-ai/command', { text: cmdText });
            if (res.matched) {
              const cmdPayload = { action: res.action, target: res.target };
              if (ChatAiPage.settings.turbo_mode) {
                Toast.show('Turbo execution: sending message...', 'info');
                try {
                  const execRes = await App.api('POST', '/api/plugins/chat-ai/execute-command', cmdPayload);
                  Toast.show(execRes.message, 'success');
                } catch (err) {
                  Toast.show('Turbo execution failed: ' + err.message, 'error');
                }
              } else {
                this.pendingCommand = cmdPayload;
                document.getElementById('voice-confirmation-msg').textContent = res.message;
                document.getElementById('voice-confirmation-box').style.display = 'block';
              }
            } else {
              Toast.show('Voice command not recognized: ' + cmdText, 'warning');
            }
          } catch (e) {
            console.error('Failed to parse command:', e);
          }
        }
      }
    };

    rec.onend = () => {
      if (this.isListening) {
        // restart
        try { rec.start(); } catch(e) {}
      } else {
        document.getElementById('btn-audio-toggle').textContent = 'Audio Mode: Off';
        document.getElementById('btn-audio-toggle').style.background = '';
        const card = document.getElementById('chatai-chat-card');
        if (card) card.classList.remove('listening-active');
        document.getElementById('audio-status-box').textContent = 'Audio mode is currently disabled. Enable Audio Mode to use voice commands.';
      }
    };

    this.speechRecognizer = rec;
    rec.start();
  },

  stopSpeechRecognition() {
    this.isListening = false;
    const card = document.getElementById('chatai-chat-card');
    if (card) card.classList.remove('listening-active');
    if (this.speechRecognizer) {
      this.speechRecognizer.stop();
    }
  },

  async confirmCommand(confirm) {
    document.getElementById('voice-confirmation-box').style.display = 'none';
    if (confirm && this.pendingCommand) {
      try {
        const res = await App.api('POST', '/api/plugins/chat-ai/execute-command', this.pendingCommand);
        Toast.show(res.message, 'success');
      } catch (e) {
        Toast.show('Execution failed: ' + e.message, 'error');
      }
    }
    this.pendingCommand = null;
  }
};

// Listen for WebSocket thought logs updates
App.state.ws?.addEventListener('message', (event) => {
  try {
    const msg = JSON.parse(event.data);
    if (msg.event === 'chatai_thought') {
      ChatAiPage.thoughtLogs.push(msg.data);
      if (ChatAiPage.thoughtLogs.length > 100) ChatAiPage.thoughtLogs.shift();
      ChatAiPage.renderThoughtLogs();
    }
  } catch(e) {}
});

// Autoload Chat AI settings when script loads
(async () => {
  await ChatAiPage.loadSettings();
})();

App.registerPlugin({
  id: 'chat-ai',
  name: 'Chat AI',
  pages: [
    { id: 'chat-ai', title: 'Chat AI', render: (c) => ChatAiPage.renderChat(c) },
    { id: 'chat-ai-settings', title: 'Chat AI Settings', render: (c) => ChatAiPage.renderSettings(c) }
  ]
});
