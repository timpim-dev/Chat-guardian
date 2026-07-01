const express = require('express');
const { v4: uuidv4 } = require('uuid');
const twitchApi = require('./twitch-api');

const router = express.Router();
const pendingStates = new Map(); // CSRF state tokens
const dashboardSessions = new Map(); // PIN sessions

let currentPort = 4242; // updated by index.js
let db = null;

function setPort(port) { currentPort = port; }
function setDb(database) { db = database; }

// --- Cookie helpers ---
function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(c => {
    const [key, ...rest] = c.trim().split('=');
    if (key) cookies[key] = rest.join('=');
  });
  return cookies;
}

function setSessionCookie(res, sessionId) {
  res.setHeader('Set-Cookie', `cg_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'cg_session=; Path=/; HttpOnly; Max-Age=0');
}

// --- Middleware ---
function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const sessionId = cookies.cg_session;
  if (!sessionId || !dashboardSessions.has(sessionId)) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.sessionId = sessionId;
  next();
}

// --- PIN Auth ---
router.post('/auth/pin', (req, res) => {
  const { pin } = req.body;
  const expectedPin = process.env.DASHBOARD_PIN || '1234';
  if (pin === expectedPin) {
    const sessionId = uuidv4();
    dashboardSessions.set(sessionId, { created: Date.now() });
    setSessionCookie(res, sessionId);
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, error: 'Invalid PIN' });
});

// --- Auth Status ---
router.get('/auth/status', (req, res) => {
  const cookies = parseCookies(req);
  const sessionId = cookies.cg_session;
  const authenticated = sessionId && dashboardSessions.has(sessionId);

  let streamerConnected = false, botConnected = false;
  let streamerUsername = null, botUsername = null;

  if (db) {
    const ss = db.getSessionByType('streamer');
    if (ss && ss.access_token) { streamerConnected = true; streamerUsername = ss.twitch_user_id; }
    const bs = db.getSessionByType('bot');
    if (bs && bs.access_token) { botConnected = true; botUsername = bs.twitch_user_id; }
  }

  res.json({ authenticated, streamerConnected, botConnected, streamerUsername, botUsername });
});

// --- Twitch OAuth ---
const STREAMER_SCOPES = 'chat:read chat:edit moderator:manage:chat_messages moderator:manage:banned_users user:manage:whispers channel:moderate';
const BOT_SCOPES = 'chat:read chat:edit moderator:manage:chat_messages moderator:manage:banned_users user:manage:whispers';

router.get('/auth/twitch/streamer', (req, res) => {
  const state = uuidv4();
  pendingStates.set(state, { type: 'streamer', created: Date.now() });
  const params = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    redirect_uri: `http://localhost:${currentPort}/auth/twitch/callback`,
    response_type: 'code',
    scope: STREAMER_SCOPES,
    state,
    force_verify: 'true'
  });
  res.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
});

router.get('/auth/twitch/bot', (req, res) => {
  const state = uuidv4();
  pendingStates.set(state, { type: 'bot', created: Date.now() });
  const params = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    redirect_uri: `http://localhost:${currentPort}/auth/twitch/callback`,
    response_type: 'code',
    scope: BOT_SCOPES,
    state,
    force_verify: 'true'
  });
  res.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
});

router.get('/auth/twitch/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(`<html><body style="background:#121212;color:#e0e0e0;font-family:monospace;padding:40px"><h2>Authorization denied</h2><p>${error}</p><script>setTimeout(()=>window.close(),3000)</script></body></html>`);

  const stateData = pendingStates.get(state);
  if (!stateData) return res.status(400).send('Invalid state parameter');
  pendingStates.delete(state);

  const accountType = stateData.type; // 'streamer' or 'bot'

  try {
    // Exchange code for tokens
    const params = new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `http://localhost:${currentPort}/auth/twitch/callback`
    });

    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(JSON.stringify(tokenData));

    // Get user info
    const userInfo = await twitchApi.getUserInfo(tokenData.access_token);
    if (!userInfo.success) throw new Error('Failed to get user info');

    // Store session
    const sessionId = `twitch_${accountType}_${userInfo.user.id}`;
    if (db) {
      db.createSession({
        session_id: sessionId,
        user_type: accountType,
        twitch_user_id: userInfo.user.id,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: Date.now() + (tokenData.expires_in * 1000),
        created_at: Date.now()
      });
    }

    console.log(`[Auth] ${accountType} account connected: ${userInfo.user.display_name} (${userInfo.user.id})`);

    res.send(`<html><body style="background:#121212;color:#e0e0e0;font-family:monospace;padding:40px"><h2>Success: ${accountType} account connected</h2><p>${userInfo.user.display_name}</p><p>You can close this window.</p><script>setTimeout(()=>window.close(),2000)</script></body></html>`);
  } catch (err) {
    console.error('[Auth] OAuth callback error:', err.message);
    res.status(500).send(`<html><body style="background:#121212;color:#e0e0e0;font-family:monospace;padding:40px"><h2>Error</h2><p>${err.message}</p></body></html>`);
  }
});

router.post('/auth/logout', (req, res) => {
  const cookies = parseCookies(req);
  const sessionId = cookies.cg_session;
  if (sessionId) dashboardSessions.delete(sessionId);
  clearSessionCookie(res);
  res.json({ success: true });
});

// --- Token Refresh Loop ---
function startTokenRefreshLoop() {
  setInterval(async () => {
    if (!db) return;
    for (const type of ['streamer', 'bot']) {
      const session = db.getSessionByType(type);
      if (!session || !session.refresh_token) continue;
      // Refresh if expires within 60 minutes
      const expiresAt = session.expires_at || 0;
      if (Date.now() > expiresAt - 3600000) {
        console.log(`[Auth] Refreshing ${type} token...`);
        const result = await twitchApi.refreshToken(session.refresh_token);
        if (result.success) {
          db.updateSessionTokens(
            session.session_id,
            result.access_token,
            result.refresh_token,
            Date.now() + (result.expires_in * 1000)
          );
          console.log(`[Auth] ${type} token refreshed successfully`);
        } else {
          console.error(`[Auth] Failed to refresh ${type} token:`, result.error);
        }
      }
    }
  }, 30 * 60 * 1000); // Every 30 minutes
}

function isValidSession(sessionId) {
  return dashboardSessions.has(sessionId);
}

// Clean up old states periodically
setInterval(() => {
  const cutoff = Date.now() - 600000; // 10 min
  for (const [key, val] of pendingStates) {
    if (val.created < cutoff) pendingStates.delete(key);
  }
}, 60000);

module.exports = { router, requireAuth, setPort, setDb, startTokenRefreshLoop, parseCookies, isValidSession };

