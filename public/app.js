window.App = {
  state: {
    authenticated: false,
    currentPage: null,
    pin: null,
    ws: null
  },

  async init() {
    try {
      const status = await this.api('GET', '/auth/status');
      if (status.authenticated) {
        this.state.authenticated = true;
        this.showApp();
        await this.loadPlugins();
        this.connectWebSocket();
        const hash = window.location.hash || '#/live';
        this.navigate(hash);
      } else {
        this.showLogin();
      }
    } catch (e) {
      this.showLogin();
    }
    window.addEventListener('hashchange', () => {
      if (this.state.authenticated) this.navigate(window.location.hash);
    });
  },

  showLogin() {
    document.getElementById('sidebar').style.display = 'none';
    LoginPage.render(document.getElementById('content'));
  },

  showApp() {
    document.getElementById('sidebar').style.display = 'flex';
  },

  async onAuthenticated() {
    this.state.authenticated = true;
    this.showApp();
    await this.loadPlugins();
    this.connectWebSocket();
    window.location.hash = '#/live';
    this.navigate('#/live');
    this.updateStatusIndicators();
  },

  registerPlugin(config) {
    this.state.registeredPlugins = this.state.registeredPlugins || [];
    if (!this.state.registeredPlugins.find(p => p.id === config.id)) {
      this.state.registeredPlugins.push(config);
    }
    this.updateSidebarNav();
  },

  updateSidebarNav() {
    const navContainer = document.querySelector('#sidebar nav');
    if (navContainer) {
      navContainer.querySelectorAll('.plugin-nav-item').forEach(el => el.remove());

      const pluginsEl = document.createElement('a');
      pluginsEl.className = 'nav-item plugin-nav-item';
      pluginsEl.href = '#/plugins';
      pluginsEl.dataset.page = 'plugins';
      pluginsEl.textContent = '▸ Plugins';
      navContainer.appendChild(pluginsEl);

      const registered = this.state.registeredPlugins || [];
      for (const plugin of registered) {
        if (plugin.pages) {
          for (const page of plugin.pages) {
            const el = document.createElement('a');
            el.className = 'nav-item plugin-nav-item';
            el.href = `#/${page.id}`;
            el.dataset.page = page.id;
            el.textContent = `▸ ${page.title}`;
            navContainer.appendChild(el);
          }
        }
      }
    }
  },

  async loadPlugins() {
    try {
      const plugins = await this.api('GET', '/api/plugins');
      this.state.plugins = plugins;
      this.state.registeredPlugins = [];

      for (const p of plugins) {
        if (p.installed && p.enabled) {
          await new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = `/plugins/${p.id}/public/page.js`;
            script.onload = resolve;
            script.onerror = resolve;
            document.body.appendChild(script);
          });
        }
      }
    } catch (e) {
      console.warn('Failed to load plugins:', e);
    } finally {
      this.updateSidebarNav();
    }
  },

  navigate(hash) {
    const page = hash.replace('#/', '') || 'live';
    this.state.currentPage = page;
    const content = document.getElementById('content');
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    const matchedPluginPage = (this.state.registeredPlugins || [])
      .flatMap(p => p.pages || [])
      .find(p => p.id === page);

    if (matchedPluginPage) {
      matchedPluginPage.render(content);
      return;
    }

    switch (page) {
      case 'live': LiveFeedPage.render(content); break;
      case 'flagged': FlaggedLogPage.render(content); break;
      case 'users': UserStrikesPage.render(content); break;
      case 'settings': SettingsPage.render(content); break;
      case 'plugins': PluginsPage.render(content); break;
      default: LiveFeedPage.render(content);
    }
  },

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    const ws = new WebSocket(wsUrl);
    this.state.ws = ws;

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ event: 'auth', pin: this.state.pin || '' }));
      this.setWsStatus(true);
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.event) {
          case 'auth_ok': break;
          case 'auth_failed': Toast.show('WebSocket auth failed', 'error'); break;
          case 'new_message': LiveFeedPage.addMessage(msg.data); break;
          case 'message_updated': LiveFeedPage.updateMessage(msg.data); break;
          case 'alert':
            Toast.show(msg.data.message, msg.data.severity === 'critical' ? 'error' : msg.data.severity, 8000);
            break;
          case 'user_action':
            if (this.state.currentPage === 'users') UserStrikesPage.loadData();
            break;
          case 'settings_changed':
            if (this.state.currentPage === 'settings') SettingsPage.render(document.getElementById('content'));
            break;
          case 'status_update': this.updateStatusIndicators(msg.data); break;
        }
      } catch (e) { /* ignore */ }
    });

    ws.addEventListener('close', () => {
      this.setWsStatus(false);
      setTimeout(() => {
        if (this.state.authenticated) this.connectWebSocket();
      }, 5000);
    });

    ws.addEventListener('error', () => { /* handled by close */ });
  },

  setWsStatus(connected) {
    const el = document.getElementById('status-ws');
    if (el) {
      const dot = el.querySelector('.status-dot');
      dot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
      el.childNodes[1].textContent = `WS: ${connected ? 'connected' : 'disconnected'}`;
    }
  },

  async updateStatusIndicators(data) {
    try {
      const status = data || await this.api('GET', '/api/status');
      const ircEl = document.getElementById('status-irc');
      if (ircEl) {
        const dot = ircEl.querySelector('.status-dot');
        const conn = status.irc_connected;
        dot.className = `status-dot ${conn ? 'connected' : 'disconnected'}`;
        ircEl.childNodes[1].textContent = `IRC: ${conn ? 'online' : 'offline'}`;
      }
      const aiEl = document.getElementById('status-ai');
      if (aiEl) {
        const dot = aiEl.querySelector('.status-dot');
        const on = status.ai_enabled;
        dot.className = `status-dot ${on ? 'connected' : 'disconnected'}`;
        aiEl.childNodes[1].textContent = `AI: ${on ? 'on' : 'off'}`;
      }
    } catch (e) { /* ignore */ }
  },

  async api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (res.status === 401) { this.state.authenticated = false; this.showLogin(); throw new Error('Unauthorized'); }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP error ${res.status}`);
    }
    return res.json();
  },

  formatTime(ts) {
    const d = new Date(typeof ts === 'number' ? ts : parseInt(ts));
    return d.toTimeString().slice(0, 8);
  },

  formatDate(ts) {
    const d = new Date(typeof ts === 'number' ? ts : parseInt(ts));
    return d.toISOString().replace('T', ' ').slice(0, 19);
  },

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
