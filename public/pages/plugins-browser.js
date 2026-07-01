window.PluginsPage = {
  plugins: [],

  async render(container) {
    container.innerHTML = `
      <div class="header-row">
        <h1 class="page-title">Plugin Manager</h1>
      </div>
      
      <div class="card">
        <h2>Available Add-ons</h2>
        <p class="text-muted" style="margin-bottom: 20px">Enhance your Chat Guardian instance with server-side plugins and dashboard add-ons.</p>
        
        <div id="plugins-list" style="display:flex; flex-direction:column; gap:16px">
          Loading plugins...
        </div>
      </div>
    `;

    await this.loadData();
  },

  async loadData() {
    try {
      this.plugins = await App.api('GET', '/api/plugins');
      this.renderPluginsList();
    } catch (e) {
      const container = document.getElementById('plugins-list');
      if (container) container.textContent = 'Failed to load plugins list: ' + e.message;
    }
  },

  renderPluginsList() {
    const container = document.getElementById('plugins-list');
    if (!container) return;

    if (this.plugins.length === 0) {
      container.innerHTML = `<div class="text-muted">No plugins available.</div>`;
      return;
    }

    container.innerHTML = this.plugins.map(p => {
      const btnClass = p.installed ? 'btn-secondary' : 'btn-primary';
      const actionText = p.installed ? 'Uninstall' : 'Install';
      const onClick = p.installed ? `PluginsPage.uninstall('${p.id}')` : `PluginsPage.install('${p.id}')`;
      
      let statusHtml = '';
      if (p.installed) {
        statusHtml = `
          <div style="display:flex; align-items:center; gap:10px; margin-top:10px">
            <span style="font-size:12px; color:var(--accent-success-text)">● Installed</span>
            <label class="toggle" style="margin-left: 10px">
              <input type="checkbox" onchange="PluginsPage.toggle('${p.id}', this.checked)" ${p.enabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
            <span style="font-size:12px">Enabled</span>
          </div>
        `;
      } else {
        statusHtml = `<div style="font-size:12px; color:#888; margin-top:10px">Not installed</div>`;
      }

      return `
        <div class="setting-row" style="align-items: flex-start; padding: 15px; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 6px">
          <div style="flex: 1">
            <h3 style="margin-top: 0; margin-bottom: 6px; display:flex; align-items:center; gap:8px">
              ${App.escapeHtml(p.name)}
              <span style="font-size:11px; font-weight:normal"><a href="${p.github}" target="_blank" style="color:var(--accent-info-text)">GitHub Repo</a></span>
            </h3>
            <p class="text-muted" style="margin-bottom: 10px; font-size:13px">${App.escapeHtml(p.description)}</p>
            ${statusHtml}
          </div>
          <div style="margin-left: 20px">
            <button onclick="${onClick}" class="${btnClass}">${actionText}</button>
          </div>
        </div>
      `;
    }).join('');
  },

  async install(id) {
    Toast.show(`Installing plugin ${id}...`, 'info');
    try {
      await App.api('POST', '/api/plugins/install', { id });
      Toast.show(`Plugin ${id} installed successfully`, 'success');
      // Reload plugins list and sidebar
      await App.loadPlugins();
      await this.loadData();
    } catch (e) {
      Toast.show('Failed to install plugin: ' + e.message, 'error');
    }
  },

  async uninstall(id) {
    if (!confirm(`Are you sure you want to uninstall ${id}? This will remove its files.`)) return;
    Toast.show(`Uninstalling plugin ${id}...`, 'info');
    try {
      await App.api('POST', '/api/plugins/uninstall', { id });
      Toast.show(`Plugin ${id} uninstalled`, 'success');
      await App.loadPlugins();
      await this.loadData();
    } catch (e) {
      Toast.show('Failed to uninstall plugin: ' + e.message, 'error');
    }
  },

  async toggle(id, enabled) {
    try {
      await App.api('POST', '/api/plugins/toggle', { id, enabled });
      Toast.show(enabled ? `Plugin ${id} enabled` : `Plugin ${id} disabled`, 'success');
      await App.loadPlugins();
    } catch (e) {
      Toast.show('Failed to toggle plugin: ' + e.message, 'error');
    }
  }
};
