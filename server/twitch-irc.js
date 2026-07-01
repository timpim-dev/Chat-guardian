const tmi = require('tmi.js');

let client = null;
let connected = false;
let deps = {};

function init(d) { deps = d; }

async function connect(channel, token, username) {
  if (client) {
    try { await client.disconnect(); } catch (e) {}
  }

  const opts = {
    options: { debug: false },
    connection: { reconnect: true, secure: true },
    identity: { username: username || 'justinfan12345', password: token ? `oauth:${token.replace('oauth:', '')}` : undefined },
    channels: [channel]
  };

  // If no token, connect anonymously (read-only)
  if (!token) {
    delete opts.identity;
    opts.options.skipUpdatingEmotesets = true;
  }

  client = new tmi.Client(opts);

  client.on('message', (ch, tags, message, self) => {
    if (self) return;
    deps.moderation.processMessage(ch, tags, message).catch(err => {
      console.error('[IRC] Error processing message:', err.message);
    });
  });

  client.on('connected', (addr, port) => {
    connected = true;
    console.log(`[IRC] Connected to ${addr}:${port}`);
    deps.wsManager.broadcast('status_update', { irc_connected: true });
  });

  client.on('disconnected', (reason) => {
    connected = false;
    console.log('[IRC] Disconnected:', reason);
    deps.wsManager.broadcast('status_update', { irc_connected: false });
  });

  try {
    await client.connect();
    console.log(`[IRC] Joining channel: #${channel}`);
  } catch (err) {
    console.error('[IRC] Connection failed:', err.message);
    connected = false;
  }
}

async function disconnect() {
  if (client) {
    try { await client.disconnect(); } catch (e) {}
    connected = false;
    client = null;
  }
}

function getClient() { return client; }
function isConnected() { return connected; }

module.exports = { init, connect, disconnect, getClient, isConnected };
