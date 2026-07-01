const { rateLimitedFetch } = require('./rate-limiter');

const HELIX_BASE = 'https://api.twitch.tv/helix';
const AUTH_BASE = 'https://id.twitch.tv/oauth2';

function helixHeaders(accessToken) {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'Client-Id': process.env.TWITCH_CLIENT_ID,
    'Content-Type': 'application/json'
  };
}

async function deleteMessage(broadcasterId, moderatorId, messageId, accessToken) {
  try {
    const url = `${HELIX_BASE}/moderation/chat?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}&message_id=${messageId}`;
    const res = await rateLimitedFetch(url, { method: 'DELETE', headers: helixHeaders(accessToken) });
    if (res.status === 204) return { success: true };
    const body = await res.json().catch(() => ({}));
    console.error('[TwitchAPI] Delete message failed:', res.status, body);
    return { success: false, status: res.status, error: body };
  } catch (err) {
    console.error('[TwitchAPI] Delete message error:', err.message);
    return { success: false, error: err.message };
  }
}

async function timeoutUser(broadcasterId, moderatorId, userId, duration, reason, accessToken) {
  try {
    const url = `${HELIX_BASE}/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`;
    const res = await rateLimitedFetch(url, {
      method: 'POST', headers: helixHeaders(accessToken),
      body: JSON.stringify({ data: { user_id: userId, duration, reason: reason || 'Chat Guardian auto-moderation' } })
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { success: true, data: body };
    console.error('[TwitchAPI] Timeout user failed:', res.status, body);
    return { success: false, status: res.status, error: body };
  } catch (err) {
    console.error('[TwitchAPI] Timeout user error:', err.message);
    return { success: false, error: err.message };
  }
}

async function banUser(broadcasterId, moderatorId, userId, reason, accessToken) {
  try {
    const url = `${HELIX_BASE}/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`;
    const res = await rateLimitedFetch(url, {
      method: 'POST', headers: helixHeaders(accessToken),
      body: JSON.stringify({ data: { user_id: userId, reason: reason || 'Chat Guardian auto-ban' } })
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { success: true, data: body };
    console.error('[TwitchAPI] Ban user failed:', res.status, body);
    return { success: false, status: res.status, error: body };
  } catch (err) {
    console.error('[TwitchAPI] Ban user error:', err.message);
    return { success: false, error: err.message };
  }
}

async function unbanUser(broadcasterId, moderatorId, userId, accessToken) {
  try {
    const url = `${HELIX_BASE}/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}&user_id=${userId}`;
    const res = await rateLimitedFetch(url, { method: 'DELETE', headers: helixHeaders(accessToken) });
    if (res.status === 204) return { success: true };
    const body = await res.json().catch(() => ({}));
    return { success: false, status: res.status, error: body };
  } catch (err) {
    console.error('[TwitchAPI] Unban user error:', err.message);
    return { success: false, error: err.message };
  }
}

async function sendWhisper(fromUserId, toUserId, message, accessToken) {
  try {
    const url = `${HELIX_BASE}/whispers?from_user_id=${fromUserId}&to_user_id=${toUserId}`;
    const res = await rateLimitedFetch(url, {
      method: 'POST', headers: helixHeaders(accessToken),
      body: JSON.stringify({ message })
    });
    if (res.status === 204) return { success: true };
    const body = await res.json().catch(() => ({}));
    console.warn('[TwitchAPI] Whisper failed (expected - see docs):', res.status, body);
    return { success: false, status: res.status, error: body };
  } catch (err) {
    console.warn('[TwitchAPI] Whisper error:', err.message);
    return { success: false, error: err.message };
  }
}

async function refreshToken(refreshTokenStr) {
  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshTokenStr,
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET
    });
    const res = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const data = await res.json();
    if (res.ok) return { success: true, access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in };
    console.error('[TwitchAPI] Token refresh failed:', data);
    return { success: false, error: data };
  } catch (err) {
    console.error('[TwitchAPI] Token refresh error:', err.message);
    return { success: false, error: err.message };
  }
}

async function validateToken(accessToken) {
  try {
    const res = await fetch(`${AUTH_BASE}/validate`, { headers: { 'Authorization': `OAuth ${accessToken}` } });
    const data = await res.json();
    if (res.ok) return { success: true, ...data };
    return { success: false, error: data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getUserInfo(accessToken) {
  try {
    const res = await fetch(`${HELIX_BASE}/users`, { headers: helixHeaders(accessToken) });
    const data = await res.json();
    if (res.ok && data.data && data.data.length > 0) return { success: true, user: data.data[0] };
    return { success: false, error: data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { deleteMessage, timeoutUser, banUser, unbanUser, sendWhisper, refreshToken, validateToken, getUserInfo };
