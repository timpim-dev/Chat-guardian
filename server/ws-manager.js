const auth = require('./auth');
const PIN = process.env.DASHBOARD_PIN || '1234';
let wss = null;
const authenticatedClients = new Set();

function init(wsServer) {
  wss = wsServer;
  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.isAuthenticated = false;

    // Authenticate via session cookie if present
    const cookies = auth.parseCookies(req);
    const sessionId = cookies.cg_session;
    if (sessionId && auth.isValidSession(sessionId)) {
      ws.isAuthenticated = true;
      authenticatedClients.add(ws);
    }

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.event === 'auth') {
          if (ws.isAuthenticated || msg.pin === PIN) {
            ws.isAuthenticated = true;
            authenticatedClients.add(ws);
            ws.send(JSON.stringify({ event: 'auth_ok', timestamp: Date.now() }));
          } else {
            ws.send(JSON.stringify({ event: 'auth_failed', error: 'Invalid PIN' }));
            ws.close();
          }
        }
      } catch (e) { /* ignore malformed */ }
    });
    ws.on('close', () => { authenticatedClients.delete(ws); });
  });


  // Heartbeat every 30s
  setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) { authenticatedClients.delete(ws); return ws.terminate(); }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  console.log('[WS] WebSocket manager initialized');
}

function broadcast(event, data) {
  const payload = JSON.stringify({ event, data, timestamp: Date.now() });
  authenticatedClients.forEach((ws) => {
    if (ws.readyState === 1) { // OPEN
      try { ws.send(payload); } catch (e) { /* ignore */ }
    }
  });
}

function getClientCount() {
  return authenticatedClients.size;
}

module.exports = { init, broadcast, getClientCount };
