window.SettingsPage = {
  settings: {},
  plans: [],

  async render(container) {
    try {
      this.settings = await App.api('GET', '/api/settings');
      this.plans = await App.api('GET', '/api/plans');
    } catch(e) { container.innerHTML = '<div class="empty-state">Error loading settings</div>'; return; }
    const authStatus = await App.api('GET', '/auth/status').catch(() => ({}));
    const activePlan = this.plans.find(p => p.is_active);

    let updateHtml = '';
    try {
      const updateStatus = await App.api('GET', '/api/update-status');
      if (updateStatus.update_available) {
        updateHtml = `
          <div class="card" style="border: 1px solid var(--accent-warn-text); background: rgba(255, 193, 7, 0.05); margin-bottom: 20px; padding: 15px;">
            <div style="font-weight: bold; color: var(--accent-warn-text); font-size: 14px; margin-bottom: 8px;">System Update Available!</div>
            <p style="margin-bottom: 10px; font-size:12px;">A new commit is available on the remote main branch.</p>
            <div style="font-size: 11px; margin-bottom: 10px; font-family: monospace;">
              <div>Current Commit: ${updateStatus.current_commit.substring(0, 7)}</div>
              <div>Latest Commit: ${updateStatus.latest_commit.substring(0, 7)}</div>
            </div>
            <p style="margin-bottom: 5px; font-weight: bold; font-size:12px;">Run these commands on your host server to update:</p>
            <pre style="background: rgba(0,0,0,0.4); padding: 8px; border-radius: 4px; font-family: monospace; font-size: 11px; overflow-x: auto; color: #fff;">${updateStatus.commands}</pre>
          </div>
        `;
      } else {
        updateHtml = `
          <div class="card" style="border: 1px solid var(--border); background: rgba(255, 255, 255, 0.02); margin-bottom: 20px; padding: 15px; font-size: 12px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <span style="color: var(--accent-safe-text); font-weight: bold;">✔ System is up to date</span>
              <span style="color: var(--text-muted); font-size: 11px; margin-left: 10px;">(Commit: ${updateStatus.current_commit.substring(0, 7)})</span>
            </div>
          </div>
        `;
      }
    } catch (e) {
      console.warn('Failed to fetch update status:', e);
    }

    container.innerHTML = `
      <div class="page-header"><span class="page-title">Settings</span></div>

      ${updateHtml}

      <!-- Twitch Connections -->
      <div class="settings-section">
        <div class="settings-section-header" onclick="this.nextElementSibling.classList.toggle('collapsed')">Twitch Connections <span>▾</span></div>
        <div class="settings-section-body">
          <div class="setting-row">
            <span class="setting-label"><span class="status-dot ${authStatus.streamerConnected ? 'connected' : 'disconnected'}"></span>Streamer: ${authStatus.streamerConnected ? authStatus.streamerUsername || 'Connected' : 'Not connected'}</span>
            <span class="setting-value"><button onclick="window.open('/auth/twitch/streamer','_blank','width=500,height=700')">Connect Streamer</button></span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Use separate bot account</span>
            <span class="setting-value"><label class="toggle"><input type="checkbox" id="set-use-bot" ${this.settings.use_bot_account === 'true' ? 'checked' : ''}><span class="toggle-slider"></span></label></span>
          </div>
          <div class="setting-row" id="bot-connect-row" style="${this.settings.use_bot_account !== 'true' ? 'display:none' : ''}">
            <span class="setting-label"><span class="status-dot ${authStatus.botConnected ? 'connected' : 'disconnected'}"></span>Bot: ${authStatus.botConnected ? authStatus.botUsername || 'Connected' : 'Not connected'}</span>
            <span class="setting-value"><button onclick="window.open('/auth/twitch/bot','_blank','width=500,height=700')">Connect Bot</button></span>
          </div>
        </div>
      </div>

      <!-- Protection Plans -->
      <div class="settings-section">
        <div class="settings-section-header" onclick="this.nextElementSibling.classList.toggle('collapsed')">Protection Plans <span>▾</span></div>
        <div class="settings-section-body">
          <div class="setting-row">
            <span class="setting-label">Active Plan</span>
            <span class="setting-value">
              <select id="plan-select" style="width:auto">
                ${this.plans.map(p => `<option value="${p.id}" ${p.is_active ? 'selected' : ''}>${App.escapeHtml(p.name)}</option>`).join('')}
              </select>
            </span>
          </div>
          <div id="plans-list" class="mt-8">
            ${this.plans.map(p => `
              <div class="setting-row">
                <span class="setting-label">${App.escapeHtml(p.name)} ${p.is_active ? '<span class="badge badge-safe">active</span>' : ''}</span>
                <span class="setting-value flex gap-8">
                  <button onclick="SettingsPage.editPlan('${p.id}')">Edit</button>
                  <button onclick="SettingsPage.duplicatePlan('${p.id}')" class="btn-primary">Dup</button>
                  ${!p.is_active ? `<button onclick="SettingsPage.deletePlan('${p.id}')" class="btn-danger">Del</button>` : ''}
                </span>
              </div>
            `).join('')}
          </div>
          <div class="mt-8"><button onclick="SettingsPage.createPlan()" class="btn-primary">+ New Plan</button></div>
        </div>
      </div>

      <!-- AI Filtering -->
      <div class="settings-section">
        <div class="settings-section-header" onclick="this.nextElementSibling.classList.toggle('collapsed')">AI Filtering (OpenRouter) <span>▾</span></div>
        <div class="settings-section-body">
          <div class="setting-row">
            <span class="setting-label">Enable AI Filtering</span>
            <span class="setting-value"><label class="toggle"><input type="checkbox" id="set-ai-enabled" ${this.settings.ai_enabled === 'true' ? 'checked' : ''}><span class="toggle-slider"></span></label></span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Mode</span>
            <span class="setting-value">
              <label><input type="radio" name="ai-mode" value="borderline" ${this.settings.ai_mode !== 'all' ? 'checked' : ''}> Borderline only</label>&nbsp;
              <label><input type="radio" name="ai-mode" value="all" ${this.settings.ai_mode === 'all' ? 'checked' : ''}> All messages</label>
            </span>
          </div>
          <div class="setting-row">
            <span class="setting-label">API Key</span>
            <span class="setting-value" style="flex:1;max-width:300px"><input type="password" id="set-ai-key" value="${this.settings.ai_api_key || ''}" placeholder="OpenRouter API Key"></span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Model</span>
            <span class="setting-value" style="flex:1;max-width:300px"><input type="text" id="set-ai-model" value="${this.settings.ai_model || 'google/gemma-4-31b-it:free'}"></span>
          </div>
          <div class="text-muted mt-8" style="font-size:11px">Suggested free models: <a href="#" onclick="document.getElementById('set-ai-model').value='google/gemma-4-31b-it:free';return false" style="color:var(--accent-info-text)">gemma-4-31b (recommended)</a> · <a href="#" onclick="document.getElementById('set-ai-model').value='liquid/lfm-2.5-1.2b-instruct:free';return false" style="color:var(--accent-info-text)">liquid-1.2b</a> · <a href="#" onclick="document.getElementById('set-ai-model').value='meta-llama/llama-3.3-70b-instruct:free';return false" style="color:var(--accent-info-text)">llama-3.3-70b</a></div>
          <div class="mt-8"><button onclick="SettingsPage.saveAI()" class="btn-primary">Save AI Settings</button></div>
        </div>
      </div>

      <!-- Ad-Bot Blocklist -->
      <div class="settings-section">
        <div class="settings-section-header" onclick="this.nextElementSibling.classList.toggle('collapsed')">Ad-Bot Blocklist <span>▾</span></div>
        <div class="settings-section-body">
          <textarea id="adbots-content" rows="12" placeholder="Loading..."></textarea>
          <div class="mt-8"><button onclick="SettingsPage.saveBlocklist()" class="btn-primary">Save Blocklist</button></div>
        </div>
      </div>

      <!-- General -->
      <div class="settings-section">
        <div class="settings-section-header" onclick="this.nextElementSibling.classList.toggle('collapsed')">General <span>▾</span></div>
        <div class="settings-section-body">
          <div class="setting-row">
            <span class="setting-label">Rolling Window (hours)</span>
            <span class="setting-value"><input type="number" id="set-window" class="inline-input" value="${this.settings.rolling_window_hours || 24}" min="1" max="168"></span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Desktop Notifications (notify-send)</span>
            <span class="setting-value"><label class="toggle"><input type="checkbox" id="set-notify" ${this.settings.notify_send_enabled !== 'false' ? 'checked' : ''}><span class="toggle-slider"></span></label></span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Test Mode (moderate streamer & mods, but don't delete/timeout)</span>
            <span class="setting-value"><label class="toggle"><input type="checkbox" id="set-testmode" ${this.settings.test_mode === 'true' ? 'checked' : ''}><span class="toggle-slider"></span></label></span>
          </div>
          <div class="setting-row">
            <span class="setting-label">Hyper Test Mode (actually execute deletes/timeouts on streamer & mods)</span>
            <span class="setting-value"><label class="toggle"><input type="checkbox" id="set-hypertestmode" ${this.settings.hyper_test_mode === 'true' ? 'checked' : ''}><span class="toggle-slider"></span></label></span>
          </div>
          <div class="mt-8"><button onclick="SettingsPage.saveGeneral()" class="btn-primary">Save General</button></div>
        </div>
      </div>
    `;

    // Event: plan select
    document.getElementById('plan-select').addEventListener('change', async (e) => {
      await App.api('PUT', `/api/plans/${e.target.value}/activate`);
      Toast.show('Protection plan changed', 'success');
      SettingsPage.render(container);
    });

    // Event: use bot toggle
    document.getElementById('set-use-bot').addEventListener('change', async (e) => {
      await App.api('PUT', '/api/settings', { use_bot_account: e.target.checked ? 'true' : 'false' });
      document.getElementById('bot-connect-row').style.display = e.target.checked ? '' : 'none';
    });

    // Load ad-bot blocklist
    App.api('GET', '/api/blocklists/ad_bots').then(data => {
      const ta = document.getElementById('adbots-content');
      if (ta && data.content) ta.value = data.content;
    }).catch(() => {});
  },

  async saveAI() {
    const aiEnabled = document.getElementById('set-ai-enabled').checked;
    const aiMode = document.querySelector('input[name="ai-mode"]:checked').value;
    const aiKey = document.getElementById('set-ai-key').value;
    const aiModel = document.getElementById('set-ai-model').value;
    await App.api('PUT', '/api/settings', { ai_enabled: aiEnabled ? 'true' : 'false', ai_mode: aiMode, ai_api_key: aiKey, ai_model: aiModel });
    Toast.show('AI settings saved', 'success');
  },

  async saveBlocklist() {
    const content = document.getElementById('adbots-content').value;
    await App.api('PUT', '/api/blocklists/ad_bots', { content });
    Toast.show('Ad-bot blocklist saved', 'success');
  },

  async saveGeneral() {
    const window_h = document.getElementById('set-window').value;
    const notify = document.getElementById('set-notify').checked;
    const testmode = document.getElementById('set-testmode').checked;
    const hypertestmode = document.getElementById('set-hypertestmode').checked;
    await App.api('PUT', '/api/settings', { rolling_window_hours: window_h, notify_send_enabled: notify ? 'true' : 'false', test_mode: testmode ? 'true' : 'false', hyper_test_mode: hypertestmode ? 'true' : 'false' });
    Toast.show('General settings saved', 'success');
  },


  async editPlan(planId) {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan) return;
    const config = plan.config;
    const catNames = ['hate_speech','sexual','spam','scam_links','ad_bots','ai_flagged'];
    let catRows = catNames.map(c => {
      const cat = config.categories[c] || { enabled: false, weight: 5 };
      return `<div class="setting-row"><span class="setting-label">${c}</span><label class="toggle" style="margin-right:8px"><input type="checkbox" data-cat="${c}" ${cat.enabled?'checked':''}><span class="toggle-slider"></span></label><input type="number" data-cat-weight="${c}" class="inline-input" value="${cat.weight}" min="0" max="100"></div>`;
    }).join('');
    let tierRows = (config.tiers||[]).map((t,i) => `<div class="setting-row"><span class="setting-label">Tier ${i+1}: ≤${t.maxPoints===Infinity?'∞':t.maxPoints}pts → ${t.action}${t.duration?' ('+t.duration+'s)':''}</span></div>`).join('');
    Modal.show(`Edit Plan: ${plan.name}`, `
      <div class="mb-8"><label>Name:</label><input type="text" id="plan-name" value="${App.escapeHtml(plan.name)}" style="margin-top:4px"></div>
      <div class="mb-8" style="font-weight:700;font-size:11px;text-transform:uppercase">Categories & Weights</div>
      ${catRows}
      <div class="mb-8 mt-16" style="font-weight:700;font-size:11px;text-transform:uppercase">Action Tiers</div>
      ${tierRows}
      <div class="text-muted" style="font-size:11px">Tier editing coming soon. Edit plan JSON in the database for custom tiers.</div>
    `, [
      { text: 'Cancel', onClick: () => Modal.hide() },
      { text: 'Save', className: 'btn-primary', onClick: async () => {
        const name = document.getElementById('plan-name').value;
        catNames.forEach(c => {
          const enabled = document.querySelector(`[data-cat="${c}"]`).checked;
          const weight = parseInt(document.querySelector(`[data-cat-weight="${c}"]`).value) || 5;
          config.categories[c] = { enabled, weight };
        });
        await App.api('POST', '/api/plans', { id: planId, name, config, is_active: plan.is_active });
        Toast.show('Plan saved', 'success');
        Modal.hide();
        SettingsPage.render(document.getElementById('content'));
      }}
    ]);
  },

  async duplicatePlan(planId) {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan) return;
    const newPlan = { name: plan.name + ' (copy)', config: plan.config, is_active: 0 };
    await App.api('POST', '/api/plans', newPlan);
    Toast.show('Plan duplicated', 'success');
    SettingsPage.render(document.getElementById('content'));
  },

  async deletePlan(planId) {
    Modal.confirm('Delete Plan', 'Are you sure?', async () => {
      try {
        await App.api('DELETE', `/api/plans/${planId}`);
        Toast.show('Plan deleted', 'success');
        SettingsPage.render(document.getElementById('content'));
      } catch(e) { Toast.show(e.message || 'Cannot delete active plan', 'error'); }
    });
  },

  createPlan() {
    Modal.show('New Plan', `<div><label>Name:</label><input type="text" id="new-plan-name" value="Custom" style="margin-top:4px"></div>`, [
      { text: 'Cancel', onClick: () => Modal.hide() },
      { text: 'Create', className: 'btn-primary', onClick: async () => {
        const name = document.getElementById('new-plan-name').value || 'Custom';
        const config = { categories: { hate_speech:{enabled:true,weight:10}, sexual:{enabled:true,weight:7}, spam:{enabled:true,weight:3}, scam_links:{enabled:true,weight:10}, ad_bots:{enabled:true,weight:8}, ai_flagged:{enabled:true,weight:6} }, tiers: [{maxPoints:4,action:'log'},{maxPoints:9,action:'delete',alert:true},{maxPoints:19,action:'timeout',duration:600,alert:true},{maxPoints:Infinity,action:'timeout',duration:86400,alert:true}] };
        await App.api('POST', '/api/plans', { name, config, is_active: 0 });
        Toast.show('Plan created', 'success');
        Modal.hide();
        SettingsPage.render(document.getElementById('content'));
      }}
    ]);
  }
};
