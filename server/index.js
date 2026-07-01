require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const db = require('./db');
const wsManager = require('./ws-manager');
const twitchApi = require('./twitch-api');
const twitchIrc = require('./twitch-irc');
const auth = require('./auth');
const filterRules = require('./filter-rules');
const filterAi = require('./filter-ai');
const moderation = require('./moderation');
const alerts = require('./alerts');
const pluginManager = require('./plugin-manager');

const startTime = Date.now();

// --- Port detection ---
function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const maxPort = startPort + 100;
    function tryPort() {
      if (port > maxPort) return reject(new Error(`No free port found in range ${startPort}-${maxPort}`));
      const srv = net.createServer();
      srv.once('error', () => { port++; tryPort(); });
      srv.once('listening', () => { srv.close(() => resolve(port)); });
      srv.listen(port, '0.0.0.0');
    }
    tryPort();
  });
}

async function main() {
  // Initialize database
  db.initDb();

  // Load blocklists
  filterRules.loadBlocklists();

  // Create Express app
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Mount auth routes (no auth required)
  auth.setDb(db);
  app.use(auth.router);

  // --- API Routes (auth required) ---
  const api = express.Router();
  api.use(auth.requireAuth);

  // Messages
  api.get('/messages', (req, res) => {
    const filters = {
      verdict: req.query.verdict || undefined,
      username: req.query.username || undefined,
      search: req.query.search || undefined,
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0
    };
    res.json(db.getMessages(filters));
  });

  api.get('/messages/flagged', (req, res) => {
    const filters = {
      verdict: 'flagged_blocked',
      search: req.query.search || undefined,
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0
    };
    res.json(db.getMessages(filters));
  });

  api.get('/messages/disputed', (req, res) => {
    res.json(db.getDisputedMessages());
  });

  api.post('/messages/:id/dispute', (req, res) => {
    try {
      db.markDisputed(req.params.id);
      wsManager.broadcast('message_updated', { id: req.params.id, disputed: true });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  api.post('/messages/:id/resolve', (req, res) => {
    try {
      const { reverse } = req.body;
      db.resolveDispute(req.params.id, !!reverse);
      wsManager.broadcast('message_updated', { id: req.params.id, dispute_resolved: true, reversed: !!reverse });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Users
  api.get('/users', (req, res) => {
    res.json(db.getUsers({ hasStrikes: req.query.hasStrikes === 'true', limit: req.query.limit }));
  });

  api.get('/users/:userId', (req, res) => {
    const user = db.getUser(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const strikes = db.getUserStrikes(req.params.userId);
    res.json({ ...user, strikes });
  });

  api.post('/users/:userId/clear-strikes', (req, res) => {
    try {
      db.clearUserStrikes(req.params.userId);
      wsManager.broadcast('user_action', { userId: req.params.userId, action: 'strikes_cleared' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  api.post('/users/:userId/timeout', async (req, res) => {
    try {
      const { duration, reason } = req.body;
      const streamerSession = db.getSessionByType('streamer');
      const botSession = db.getSessionByType('bot');
      const modToken = botSession ? botSession.access_token : (streamerSession ? streamerSession.access_token : null);
      const modId = botSession ? botSession.twitch_user_id : (streamerSession ? streamerSession.twitch_user_id : null);
      const broadcasterId = streamerSession ? streamerSession.twitch_user_id : null;

      if (!modToken || !broadcasterId) return res.status(400).json({ error: 'Twitch not connected' });

      const result = await twitchApi.timeoutUser(broadcasterId, modId, req.params.userId, duration || 600, reason || 'Manual timeout', modToken);
      if (result.success) db.updateUserTimeout(req.params.userId);
      wsManager.broadcast('user_action', { userId: req.params.userId, action: 'timeout', duration });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  api.post('/users/:userId/unban', async (req, res) => {
    try {
      const streamerSession = db.getSessionByType('streamer');
      const botSession = db.getSessionByType('bot');
      const modToken = botSession ? botSession.access_token : (streamerSession ? streamerSession.access_token : null);
      const modId = botSession ? botSession.twitch_user_id : (streamerSession ? streamerSession.twitch_user_id : null);
      const broadcasterId = streamerSession ? streamerSession.twitch_user_id : null;

      if (!modToken || !broadcasterId) return res.status(400).json({ error: 'Twitch not connected' });

      const result = await twitchApi.unbanUser(broadcasterId, modId, req.params.userId, modToken);
      wsManager.broadcast('user_action', { userId: req.params.userId, action: 'unbanned' });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Settings
  api.get('/settings', (req, res) => {
    res.json(db.getAllSettings());
  });

  api.put('/settings', (req, res) => {
    try {
      for (const [key, value] of Object.entries(req.body)) {
        db.setSetting(key, value);
      }
      wsManager.broadcast('settings_changed', req.body);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Plans
  api.get('/plans', (req, res) => {
    res.json(db.getPlans());
  });

  api.post('/plans', (req, res) => {
    try {
      db.savePlan(req.body);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  api.put('/plans/:id/activate', (req, res) => {
    try {
      db.setActivePlan(req.params.id);
      wsManager.broadcast('settings_changed', { active_plan: req.params.id });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  api.delete('/plans/:id', (req, res) => {
    try {
      db.deletePlan(req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Status
  api.get('/status', (req, res) => {
    res.json({
      irc_connected: twitchIrc.isConnected(),
      ai_enabled: db.getSetting('ai_enabled') === 'true',
      active_plan: db.getActivePlan(),
      ws_clients: wsManager.getClientCount(),
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000)
    });
  });

  // Blocklists
  api.get('/blocklists/:category', (req, res) => {
    const fileMap = {
      hate_speech: 'slurs.txt', sexual: 'sexual.txt',
      spam: 'spam-patterns.txt', scam_links: 'scam-links.txt', ad_bots: 'ad-bots.json'
    };
    const filename = fileMap[req.params.category];
    if (!filename) return res.status(404).json({ error: 'Unknown category' });
    const filepath = path.join(__dirname, '..', 'data', 'blocklists', filename);
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      res.json({ content, category: req.params.category });
    } catch (e) {
      res.json({ content: '', category: req.params.category });
    }
  });

  api.put('/blocklists/:category', (req, res) => {
    const fileMap = {
      hate_speech: 'slurs.txt', sexual: 'sexual.txt',
      spam: 'spam-patterns.txt', scam_links: 'scam-links.txt', ad_bots: 'ad-bots.json'
    };
    const filename = fileMap[req.params.category];
    if (!filename) return res.status(404).json({ error: 'Unknown category' });
    const filepath = path.join(__dirname, '..', 'data', 'blocklists', filename);
    try {
      fs.writeFileSync(filepath, req.body.content, 'utf-8');
      filterRules.loadBlocklists(); // Reload
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  api.get('/update-status', async (req, res) => {
    const { exec } = require('child_process');
    const getLocalCommit = () => new Promise(resolve => {
      exec('git rev-parse HEAD', (err, stdout) => {
        resolve(err ? '' : stdout.trim());
      });
    });

    const getRemoteCommit = () => new Promise(resolve => {
      exec('git ls-remote https://github.com/timpim-dev/Chat-guardian refs/heads/main', (err, stdout) => {
        if (err || !stdout) return resolve('');
        const parts = stdout.trim().split(/\s+/);
        resolve(parts[0] || '');
      });
    });

    try {
      const [localHash, remoteHash] = await Promise.all([
        getLocalCommit(),
        getRemoteCommit()
      ]);

      if (!localHash || !remoteHash) {
        return res.json({
          update_available: false,
          current_commit: localHash || 'unknown',
          latest_commit: remoteHash || 'unknown',
          error: 'Could not fetch repository information.'
        });
      }

      res.json({
        update_available: localHash !== remoteHash,
        current_commit: localHash,
        latest_commit: remoteHash,
        commands: 'git pull && npm install && systemctl --user restart chat-guardian'
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.use('/api', api);

  // Find free port
  const portStart = parseInt(process.env.PORT_RANGE_START) || 4242;
  const port = await findFreePort(portStart);
  auth.setPort(port);

  // Start HTTP server
  const server = http.createServer(app);

  // WebSocket server
  const wss = new WebSocketServer({ server });
  wsManager.init(wss);

  // Initialize modules
  alerts.init({ wsManager, twitchApi, db });
  moderation.init({ db, twitchApi, wsManager, alerts, filterRules, filterAi, twitchIrc });
  twitchIrc.init({ moderation, db, wsManager });
  pluginManager.init({ app, api, db, twitchIrc, twitchApi, wsManager, moderation });

  // SPA fallback (MUST BE REGISTERED LAST!)
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  // Start server
  server.listen(port, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║          CHAT GUARDIAN — v1.0.0              ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log(`  Dashboard: http://localhost:${port}`);
    console.log(`  PIN: ${process.env.DASHBOARD_PIN || '1234'}`);
    console.log('');
  });

  // Auto-connect to Twitch if tokens are configured
  const channel = process.env.BROADCASTER_CHANNEL;
  if (channel) {
    const streamerSession = db.getSessionByType('streamer');
    const botSession = db.getSessionByType('bot');
    const useBot = db.getSetting('use_bot_account') === 'true';
    const session = useBot && botSession ? botSession : streamerSession;
    const token = session ? session.access_token : (process.env.BOT_TWITCH_OAUTH_TOKEN || process.env.STREAMER_TWITCH_OAUTH_TOKEN);
    const username = session ? 'bot' : 'anonymous';

    if (token) {
      console.log(`[Main] Connecting to Twitch channel: #${channel}`);
      twitchIrc.connect(channel, token, username);
    } else {
      console.log('[Main] No Twitch tokens configured. Connect via the dashboard Settings page.');
    }
  } else {
    console.log('[Main] No BROADCASTER_CHANNEL set. Configure it in .env or via the dashboard.');
  }

  // Start token refresh loop
  auth.startTokenRefreshLoop();

  // Graceful shutdown
  function shutdown() {
    console.log('\n[Main] Shutting down...');
    twitchIrc.disconnect();
    if (wss) wss.close();
    db.close();
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
