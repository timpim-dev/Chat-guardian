window.StylerPage = {
  settings: { ai_mood: 'Strict', ui_theme: 'dark' },

  themes: {
    dark: {}, // default css values
    matrix: {
      '--bg': '#000000',
      '--bg-panel': '#0a0a0a',
      '--bg-panel-alt': '#050505',
      '--bg-sidebar': '#020202',
      '--bg-input': '#020202',
      '--text': '#00ff00',
      '--text-muted': '#00bb00',
      '--text-dim': '#008800',
      '--border': '#005500',
      '--border-light': '#007700',
      '--accent-safe-text': '#00ff00',
      '--accent-danger-text': '#ff3333'
    },
    vampire: {
      '--bg': '#0e0b0b',
      '--bg-panel': '#161010',
      '--bg-panel-alt': '#140e0e',
      '--bg-sidebar': '#0a0707',
      '--bg-input': '#080505',
      '--text': '#f4e6e6',
      '--text-muted': '#c4a6a6',
      '--text-dim': '#9c7373',
      '--border': '#4c1717',
      '--border-light': '#6c2222',
      '--accent-safe-text': '#9abcca',
      '--accent-danger-text': '#ff3333'
    },
    purple: {
      '--bg': '#08050e',
      '--bg-panel': '#120d20',
      '--bg-panel-alt': '#100b1d',
      '--bg-sidebar': '#07040b',
      '--bg-input': '#050308',
      '--text': '#ebdff7',
      '--text-muted': '#baa0db',
      '--text-dim': '#9173b9',
      '--border': '#391663',
      '--border-light': '#512288',
      '--accent-safe-text': '#c792ea',
      '--accent-danger-text': '#ff5376'
    },
    monochrome: {
      '--bg': '#ffffff',
      '--bg-panel': '#f6f6f6',
      '--bg-panel-alt': '#eeeeee',
      '--bg-sidebar': '#e0e0e0',
      '--bg-input': '#ffffff',
      '--text': '#000000',
      '--text-muted': '#555555',
      '--text-dim': '#777777',
      '--border': '#cccccc',
      '--border-light': '#bbbbbb',
      '--accent-safe-text': '#22aa22',
      '--accent-danger-text': '#ff2222'
    }
  },

  injectTheme(themeName) {
    const theme = this.themes[themeName];
    // Remove existing styler tag if present
    let styleTag = document.getElementById('styler-theme-overrides');
    if (styleTag) styleTag.remove();

    if (theme && Object.keys(theme).length > 0) {
      styleTag = document.createElement('style');
      styleTag.id = 'styler-theme-overrides';

      let css = ':root {\n';
      for (const [key, val] of Object.entries(theme)) {
        css += `  ${key}: ${val} !important;\n`;
      }
      css += '}';
      styleTag.innerHTML = css;
      document.head.appendChild(styleTag);
    }

    // Handle Custom CSS injection
    let customStyleTag = document.getElementById('styler-custom-css-block');
    if (customStyleTag) customStyleTag.remove();

    if (this.settings.custom_css) {
      customStyleTag = document.createElement('style');
      customStyleTag.id = 'styler-custom-css-block';
      customStyleTag.innerHTML = this.settings.custom_css;
      document.head.appendChild(customStyleTag);
    }
  },

  render(container) {
    container.innerHTML = `
      <div class="header-row">
        <h1 class="page-title">Styler Customization</h1>
      </div>

      <div style="display:flex;gap:20px;height:calc(100vh - 180px)">
        <!-- Settings Form -->
        <div class="card" style="flex:1;display:flex;flex-direction:column;gap:20px;overflow-y:auto">
          <h2>Appearance & AI Settings</h2>
          
          <div class="setting-row">
            <span class="setting-label">AI Mood / Persona</span>
            <span class="setting-value">
              <select id="styler-mood-select">
                <option value="Strict" ${this.settings.ai_mood === 'Strict' ? 'selected' : ''}>Strict (Default)</option>
                <option value="Friendly" ${this.settings.ai_mood === 'Friendly' ? 'selected' : ''}>Friendly</option>
                <option value="Sarcastic" ${this.settings.ai_mood === 'Sarcastic' ? 'selected' : ''}>Sarcastic</option>
                <option value="Passive-Aggressive" ${this.settings.ai_mood === 'Passive-Aggressive' ? 'selected' : ''}>Passive-Aggressive</option>
                <option value="Pirate" ${this.settings.ai_mood === 'Pirate' ? 'selected' : ''}>Pirate</option>
                <option value="Moodswings" ${this.settings.ai_mood === 'Moodswings' ? 'selected' : ''}>Moodswings (Randomize)</option>
              </select>
            </span>
          </div>

          <div class="setting-row">
            <span class="setting-label">Web UI Theme Preset</span>
            <span class="setting-value">
              <select id="styler-theme-select" onchange="StylerPage.previewTheme(this.value)">
                <option value="dark" ${this.settings.ui_theme === 'dark' ? 'selected' : ''}>Classic Dark</option>
                <option value="matrix" ${this.settings.ui_theme === 'matrix' ? 'selected' : ''}>Matrix Neon</option>
                <option value="vampire" ${this.settings.ui_theme === 'vampire' ? 'selected' : ''}>Crimson Vampire</option>
                <option value="purple" ${this.settings.ui_theme === 'purple' ? 'selected' : ''}>Neon Purple</option>
                <option value="monochrome" ${this.settings.ui_theme === 'monochrome' ? 'selected' : ''}>Monochrome Light</option>
              </select>
            </span>
          </div>

          <div style="margin-top:10px">
            <button onclick="StylerPage.saveSettings()" class="btn-primary" style="width:100%">Apply Settings</button>
          </div>
        </div>

        <!-- Custom CSS Editor -->
        <div class="card" style="flex:1.2;display:flex;flex-direction:column;gap:10px">
          <h2>Custom CSS Editor</h2>
          <p class="text-muted" style="font-size:11px">Write custom CSS rules to override any dashboard styles. Rules are applied globally.</p>
          <textarea id="styler-custom-css-editor" style="flex:1;font-family:monospace;background:#000;color:#fff;border:1px solid var(--border);padding:10px;resize:none" placeholder="/* Example: \nbody { \n  font-family: sans-serif; \n} */">${this.settings.custom_css || ''}</textarea>
          <button onclick="StylerPage.saveCustomCss()" class="btn-primary">Save Custom CSS</button>
        </div>
      </div>
    `;
  },

  async loadSettings() {
    try {
      const data = await App.api('GET', '/api/plugins/styler/settings');
      this.settings = data;
      this.injectTheme(data.ui_theme);
    } catch (e) {
      console.warn('Failed to load Styler settings:', e);
    }
  },

  previewTheme(themeName) {
    this.injectTheme(themeName);
  },

  async saveSettings() {
    const ai_mood = document.getElementById('styler-mood-select').value;
    const ui_theme = document.getElementById('styler-theme-select').value;

    try {
      await App.api('PUT', '/api/plugins/styler/settings', { ai_mood, ui_theme });
      this.settings.ai_mood = ai_mood;
      this.settings.ui_theme = ui_theme;
      this.injectTheme(ui_theme);
      Toast.show('Appearance settings successfully applied', 'success');
    } catch (e) {
      Toast.show('Failed to save styles: ' + e.message, 'error');
    }
  },

  async saveCustomCss() {
    const custom_css = document.getElementById('styler-custom-css-editor').value;
    try {
      await App.api('PUT', '/api/plugins/styler/settings', { custom_css });
      this.settings.custom_css = custom_css;
      this.injectTheme(this.settings.ui_theme);
      Toast.show('Custom CSS successfully saved and applied', 'success');
    } catch (e) {
      Toast.show('Failed to save custom CSS: ' + e.message, 'error');
    }
  }
};

// Autoload Styler settings and inject theme when script loads
(async () => {
  await StylerPage.loadSettings();
})();

App.registerPlugin({
  id: 'styler',
  name: 'Styler',
  pages: [
    { id: 'styler', title: 'Styler', render: (c) => StylerPage.render(c) }
  ]
});
