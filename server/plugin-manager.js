const fs = require('fs');
const path = require('path');
const express = require('express');

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');

let activePlugins = {};
let contextObj = null;

function init(context) {
  contextObj = context;
  
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }

  // Register plugin manager API endpoints
  const router = express.Router();

  router.get('/', (req, res) => {
    const list = getPluginsList();
    res.json(list);
  });

  router.post('/install', (req, res) => {
    const { id } = req.body;
    try {
      if (id === 'chat-ai') {
        installChatAiPlugin();
      } else if (id === 'styler') {
        installStylerPlugin();
      } else {
        return res.status(400).json({ error: 'Unknown plugin' });
      }
      loadPlugin(id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/uninstall', (req, res) => {
    const { id } = req.body;
    try {
      unloadPlugin(id);
      const pluginPath = path.join(PLUGINS_DIR, id);
      if (fs.existsSync(pluginPath)) {
        fs.rmSync(pluginPath, { recursive: true, force: true });
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/toggle', (req, res) => {
    const { id, enabled } = req.body;
    context.db.setSetting(`plugin_${id}_enabled`, enabled ? 'true' : 'false');
    if (enabled) {
      loadPlugin(id);
    } else {
      unloadPlugin(id);
    }
    res.json({ success: true });
  });

  context.api.use('/plugins', router);

  // Scan and load already installed plugins
  loadInstalledPlugins();
}

function getPluginsList() {
  const catalogPath = path.join(__dirname, 'plugin-catalog.json');
  if (!fs.existsSync(catalogPath)) return [];
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  return catalog.map(p => {
    const installed = fs.existsSync(path.join(PLUGINS_DIR, p.id));
    const enabled = contextObj.db.getSetting(`plugin_${p.id}_enabled`) !== 'false';
    return { ...p, installed, enabled };
  });
}

function loadInstalledPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) return;
  const dirs = fs.readdirSync(PLUGINS_DIR);
  for (const dir of dirs) {
    const p = path.join(PLUGINS_DIR, dir);
    if (fs.statSync(p).isDirectory()) {
      const enabled = contextObj.db.getSetting(`plugin_${dir}_enabled`) !== 'false';
      if (enabled) {
        loadPlugin(dir);
      }
    }
  }
}

function loadPlugin(id) {
  if (activePlugins[id]) return; // already loaded
  const pluginPath = path.join(PLUGINS_DIR, id, 'index.js');
  if (fs.existsSync(pluginPath)) {
    try {
      // Register static folder for public files
      const publicPath = path.join(PLUGINS_DIR, id, 'public');
      if (fs.existsSync(publicPath)) {
        contextObj.app.use(`/plugins/${id}/public`, express.static(publicPath));
      }

      const pluginModule = require(pluginPath);
      if (typeof pluginModule.init === 'function') {
        pluginModule.init(contextObj);
      }
      activePlugins[id] = pluginModule;
      console.log(`[Plugins] Loaded plugin: ${id}`);
    } catch (e) {
      console.error(`[Plugins] Failed to load plugin ${id}:`, e.message);
    }
  }
}

function unloadPlugin(id) {
  const plugin = activePlugins[id];
  if (plugin) {
    if (typeof plugin.cleanup === 'function') {
      try { plugin.cleanup(); } catch (e) { /* ignore */ }
    }
    // Delete from require cache so it can be reloaded
    const pluginPath = path.join(PLUGINS_DIR, id, 'index.js');
    delete require.cache[require.resolve(pluginPath)];
    delete activePlugins[id];
    console.log(`[Plugins] Unloaded plugin: ${id}`);
  }
}

function installPluginFromRepo(id, repoDirName) {
  const repoDir = path.join(PLUGINS_DIR, '..', '..', repoDirName);
  const pluginDir = path.join(PLUGINS_DIR, id);
  const publicDir = path.join(pluginDir, 'public');

  if (!fs.existsSync(repoDir)) {
    throw new Error(`Repository directory not found at: ${repoDir}`);
  }

  fs.mkdirSync(publicDir, { recursive: true });

  // Copy index.js
  const indexSrc = path.join(repoDir, 'index.js');
  if (fs.existsSync(indexSrc)) {
    fs.copyFileSync(indexSrc, path.join(pluginDir, 'index.js'));
  } else {
    throw new Error(`index.js not found in repository ${repoDirName}`);
  }

  // Copy public/page.js
  const pageSrc = path.join(repoDir, 'public', 'page.js');
  if (fs.existsSync(pageSrc)) {
    fs.copyFileSync(pageSrc, path.join(publicDir, 'page.js'));
  } else {
    const directPageSrc = path.join(repoDir, 'page.js');
    if (fs.existsSync(directPageSrc)) {
      fs.copyFileSync(directPageSrc, path.join(publicDir, 'page.js'));
    } else {
      throw new Error(`page.js not found in repository ${repoDirName}`);
    }
  }
}

function installChatAiPlugin() {
  installPluginFromRepo('chat-ai', 'Chat AI');
}

function installStylerPlugin() {
  installPluginFromRepo('styler', 'Styler_for_chatGuardian');
}

module.exports = { init, getPluginsList };
