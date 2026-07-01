const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'data', 'chat-guardian.db');
let db;

function initDb() {
  const fs = require('fs');
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      username TEXT NOT NULL,
      user_id TEXT NOT NULL,
      message_text TEXT NOT NULL,
      verdict TEXT NOT NULL DEFAULT 'safe',
      categories TEXT DEFAULT '[]',
      points INTEGER DEFAULT 0,
      action_taken TEXT DEFAULT 'none',
      disputed INTEGER DEFAULT 0,
      dispute_resolved INTEGER DEFAULT 0,
      ai_verdict TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      current_points REAL DEFAULT 0,
      last_timeout_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strikes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      message_id TEXT,
      category TEXT NOT NULL,
      points INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      reversed INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      user_type TEXT NOT NULL,
      twitch_user_id TEXT,
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS protection_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      is_active INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_username ON messages(username);
    CREATE INDEX IF NOT EXISTS idx_messages_verdict ON messages(verdict);
    CREATE INDEX IF NOT EXISTS idx_strikes_user_id ON strikes(user_id);
  `);

  // Insert default settings if empty
  const settingsCount = db.prepare('SELECT COUNT(*) as c FROM settings').get().c;
  if (settingsCount === 0) {
    const defaults = {
      ai_enabled: 'false',
      ai_mode: 'borderline',
      ai_model: 'google/gemma-4-31b-it:free',
      ai_api_key: '',
      rolling_window_hours: '24',
      use_bot_account: 'false',
      notify_send_enabled: 'true',
      whisper_enabled: 'false',
      dispute_mode: 'manual'
    };
    const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(defaults)) {
      insert.run(k, v);
    }
  }

  // Insert default protection plans if empty
  const planCount = db.prepare('SELECT COUNT(*) as c FROM protection_plans').get().c;
  if (planCount === 0) {
    const plans = [
      {
        id: 'plan_chill',
        name: 'Chill',
        is_active: 0,
        config: JSON.stringify({
          categories: {
            hate_speech: { enabled: true, weight: 10 },
            sexual: { enabled: false, weight: 7 },
            spam: { enabled: false, weight: 3 },
            scam_links: { enabled: true, weight: 10 },
            ad_bots: { enabled: false, weight: 8 },
            ai_flagged: { enabled: false, weight: 6 }
          },
          tiers: [
            { maxPoints: 14, action: 'log' },
            { maxPoints: 29, action: 'delete', alert: true },
            { maxPoints: 49, action: 'timeout', duration: 600, alert: true },
            { maxPoints: Infinity, action: 'timeout', duration: 86400, alert: true }
          ]
        })
      },
      {
        id: 'plan_standard',
        name: 'Standard',
        is_active: 1,
        config: JSON.stringify({
          categories: {
            hate_speech: { enabled: true, weight: 10 },
            sexual: { enabled: true, weight: 7 },
            spam: { enabled: true, weight: 3 },
            scam_links: { enabled: true, weight: 10 },
            ad_bots: { enabled: true, weight: 8 },
            ai_flagged: { enabled: true, weight: 6 }
          },
          tiers: [
            { maxPoints: 4, action: 'log' },
            { maxPoints: 9, action: 'delete', alert: true },
            { maxPoints: 19, action: 'timeout', duration: 600, alert: true },
            { maxPoints: Infinity, action: 'timeout', duration: 86400, alert: true }
          ]
        })
      },
      {
        id: 'plan_strict',
        name: 'Strict',
        is_active: 0,
        config: JSON.stringify({
          categories: {
            hate_speech: { enabled: true, weight: 15 },
            sexual: { enabled: true, weight: 10 },
            spam: { enabled: true, weight: 5 },
            scam_links: { enabled: true, weight: 15 },
            ad_bots: { enabled: true, weight: 12 },
            ai_flagged: { enabled: true, weight: 8 }
          },
          tiers: [
            { maxPoints: 2, action: 'log' },
            { maxPoints: 7, action: 'delete', alert: true },
            { maxPoints: 14, action: 'timeout', duration: 600, alert: true },
            { maxPoints: 24, action: 'timeout', duration: 86400, alert: true },
            { maxPoints: Infinity, action: 'ban', alert: true }
          ]
        })
      }
    ];
    const insertPlan = db.prepare('INSERT INTO protection_plans (id, name, config, is_active) VALUES (?, ?, ?, ?)');
    for (const p of plans) {
      insertPlan.run(p.id, p.name, p.config, p.is_active);
    }
  }

  console.log('[DB] Database initialized at', DB_PATH);
  return db;
}

function getDb() { return db; }

// --- Messages ---
function insertMessage(msg) {
  const stmt = db.prepare(`INSERT INTO messages (id, timestamp, username, user_id, message_text, verdict, categories, points, action_taken, disputed, dispute_resolved, ai_verdict)
    VALUES (@id, @timestamp, @username, @user_id, @message_text, @verdict, @categories, @points, @action_taken, @disputed, @dispute_resolved, @ai_verdict)`);
  return stmt.run({
    id: msg.id,
    timestamp: msg.timestamp,
    username: msg.username,
    user_id: msg.user_id,
    message_text: msg.message_text,
    verdict: msg.verdict || 'safe',
    categories: JSON.stringify(msg.categories || []),
    points: msg.points || 0,
    action_taken: msg.action_taken || 'none',
    disputed: msg.disputed || 0,
    dispute_resolved: msg.dispute_resolved || 0,
    ai_verdict: msg.ai_verdict ? JSON.stringify(msg.ai_verdict) : null
  });
}

function updateMessageVerdict(id, verdict, aiVerdict, categories, points, actionTaken) {
  const stmt = db.prepare(`UPDATE messages SET verdict = ?, ai_verdict = ?, categories = ?, points = ?, action_taken = ? WHERE id = ?`);
  return stmt.run(verdict, aiVerdict ? JSON.stringify(aiVerdict) : null, JSON.stringify(categories || []), points || 0, actionTaken || 'none', id);
}

function getMessages(filters = {}) {
  let sql = 'SELECT * FROM messages WHERE 1=1';
  const params = [];
  if (filters.verdict) {
    if (filters.verdict === 'flagged_blocked') {
      sql += " AND verdict IN ('flagged', 'blocked')";
    } else {
      sql += ' AND verdict = ?';
      params.push(filters.verdict);
    }
  }
  if (filters.username) { sql += ' AND username LIKE ?'; params.push('%' + filters.username + '%'); }
  if (filters.search) { sql += ' AND (message_text LIKE ? OR username LIKE ?)'; params.push('%' + filters.search + '%', '%' + filters.search + '%'); }
  if (filters.disputed !== undefined) { sql += ' AND disputed = ?'; params.push(filters.disputed ? 1 : 0); }
  if (filters.dispute_resolved !== undefined) { sql += ' AND dispute_resolved = ?'; params.push(filters.dispute_resolved ? 1 : 0); }
  sql += ' ORDER BY timestamp DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }
  if (filters.offset) { sql += ' OFFSET ?'; params.push(filters.offset); }
  return db.prepare(sql).all(...params);
}

function getMessage(id) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

// --- Strikes ---
function insertStrike(strike) {
  const stmt = db.prepare('INSERT INTO strikes (user_id, message_id, category, points, timestamp) VALUES (?, ?, ?, ?, ?)');
  return stmt.run(strike.user_id, strike.message_id, strike.category, strike.points, strike.timestamp);
}

function getUserStrikes(userId) {
  return db.prepare('SELECT * FROM strikes WHERE user_id = ? ORDER BY timestamp DESC').all(userId);
}

function getUserPoints(userId, windowMs) {
  const cutoff = Date.now() - windowMs;
  const row = db.prepare('SELECT COALESCE(SUM(points), 0) as total FROM strikes WHERE user_id = ? AND reversed = 0 AND timestamp > ?').get(userId, cutoff);
  return row.total;
}

function clearUserStrikes(userId) {
  db.prepare('UPDATE strikes SET reversed = 1 WHERE user_id = ? AND reversed = 0').run(userId);
  db.prepare('UPDATE users SET current_points = 0 WHERE user_id = ?').run(userId);
}

// --- Users ---
function getOrCreateUser(userId, username) {
  let user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  if (!user) {
    db.prepare('INSERT INTO users (user_id, username, current_points, created_at) VALUES (?, ?, 0, ?)').run(userId, username, Date.now());
    user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  } else if (user.username !== username) {
    db.prepare('UPDATE users SET username = ? WHERE user_id = ?').run(username, userId);
    user.username = username;
  }
  return user;
}

function updateUserPoints(userId, points) {
  db.prepare('UPDATE users SET current_points = ? WHERE user_id = ?').run(points, userId);
}

function updateUserTimeout(userId) {
  db.prepare('UPDATE users SET last_timeout_at = ? WHERE user_id = ?').run(Date.now(), userId);
}

function getUsers(filters = {}) {
  let sql = `SELECT u.*, COUNT(s.id) as strike_count FROM users u LEFT JOIN strikes s ON u.user_id = s.user_id AND s.reversed = 0 GROUP BY u.user_id`;
  if (filters.hasStrikes) sql += ' HAVING strike_count > 0';
  sql += ' ORDER BY u.current_points DESC';
  if (filters.limit) sql += ' LIMIT ' + parseInt(filters.limit);
  return db.prepare(sql).all();
}

function getUser(userId) {
  return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
}

// --- Settings ---
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

function getAllSettings() {
  const rows = db.prepare('SELECT * FROM settings').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return obj;
}

// --- Protection Plans ---
function getActivePlan() {
  const row = db.prepare('SELECT * FROM protection_plans WHERE is_active = 1').get();
  if (!row) return null;
  return { ...row, config: JSON.parse(row.config) };
}

function getPlans() {
  return db.prepare('SELECT * FROM protection_plans ORDER BY name').all().map(p => ({ ...p, config: JSON.parse(p.config) }));
}

function savePlan(plan) {
  const config = typeof plan.config === 'string' ? plan.config : JSON.stringify(plan.config);
  db.prepare('INSERT OR REPLACE INTO protection_plans (id, name, config, is_active) VALUES (?, ?, ?, ?)').run(plan.id || 'plan_' + uuidv4().slice(0, 8), plan.name, config, plan.is_active || 0);
}

function setActivePlan(planId) {
  db.prepare('UPDATE protection_plans SET is_active = 0').run();
  db.prepare('UPDATE protection_plans SET is_active = 1 WHERE id = ?').run(planId);
}

function deletePlan(planId) {
  const plan = db.prepare('SELECT is_active FROM protection_plans WHERE id = ?').get(planId);
  if (plan && plan.is_active) throw new Error('Cannot delete active plan');
  db.prepare('DELETE FROM protection_plans WHERE id = ?').run(planId);
}

// --- Sessions ---
function createSession(session) {
  db.prepare('INSERT OR REPLACE INTO sessions (session_id, user_type, twitch_user_id, access_token, refresh_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    session.session_id, session.user_type, session.twitch_user_id || null,
    session.access_token || null, session.refresh_token || null,
    session.expires_at || null, session.created_at || Date.now()
  );
}

function getSession(sessionId) {
  return db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
}

function deleteSession(sessionId) {
  db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
}

function getSessionByType(userType) {
  return db.prepare('SELECT * FROM sessions WHERE user_type = ? ORDER BY created_at DESC LIMIT 1').get(userType);
}

function updateSessionTokens(sessionId, accessToken, refreshToken, expiresAt) {
  db.prepare('UPDATE sessions SET access_token = ?, refresh_token = ?, expires_at = ? WHERE session_id = ?').run(accessToken, refreshToken, expiresAt, sessionId);
}

// --- Disputes ---
function markDisputed(messageId) {
  db.prepare('UPDATE messages SET disputed = 1 WHERE id = ?').run(messageId);
}

function resolveDispute(messageId, reverse) {
  db.prepare('UPDATE messages SET dispute_resolved = 1 WHERE id = ?').run(messageId);
  if (reverse) {
    const msg = getMessage(messageId);
    if (msg) {
      db.prepare('UPDATE strikes SET reversed = 1 WHERE message_id = ?').run(messageId);
      // Recalculate user points
      const windowMs = parseInt(getSetting('rolling_window_hours') || '24') * 3600000;
      const newPoints = getUserPoints(msg.user_id, windowMs);
      updateUserPoints(msg.user_id, newPoints);
    }
  }
}

function getDisputedMessages() {
  return db.prepare("SELECT * FROM messages WHERE disputed = 1 AND dispute_resolved = 0 ORDER BY timestamp DESC").all();
}

function close() {
  if (db) db.close();
}

module.exports = {
  initDb, getDb, close,
  insertMessage, updateMessageVerdict, getMessages, getMessage,
  insertStrike, getUserStrikes, getUserPoints, clearUserStrikes,
  getOrCreateUser, updateUserPoints, updateUserTimeout, getUsers, getUser,
  getSetting, setSetting, getAllSettings,
  getActivePlan, getPlans, savePlan, setActivePlan, deletePlan,
  createSession, getSession, deleteSession, getSessionByType, updateSessionTokens,
  markDisputed, resolveDispute, getDisputedMessages
};
