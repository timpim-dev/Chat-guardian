const { execFile } = require('child_process');

let deps = {};

function init(d) {
  deps = d;
}

function alertStreamer(message, severity, details) {
  const severityMap = { info: 'low', warning: 'normal', critical: 'critical' };
  const urgency = severityMap[severity] || 'normal';

  // 1. Push to dashboard via WebSocket
  if (deps.wsManager) {
    deps.wsManager.broadcast('alert', { message, severity, details, timestamp: Date.now() });
  }

  // 2. Desktop notification via notify-send
  const notifyEnabled = deps.db ? deps.db.getSetting('notify_send_enabled') : 'true';
  if (notifyEnabled !== 'false') {
    try {
      execFile('notify-send', ['-u', urgency, 'Chat Guardian', message], (err) => {
        if (err) console.log('[Alerts] notify-send unavailable:', err.message);
      });
    } catch (e) { /* silent */ }
  }

  // 3. Whisper (if enabled)
  const whisperEnabled = deps.db ? deps.db.getSetting('whisper_enabled') : 'false';
  if (whisperEnabled === 'true' && deps.twitchApi) {
    const streamerSession = deps.db.getSessionByType('streamer');
    const botSession = deps.db.getSessionByType('bot');
    if (streamerSession && botSession) {
      deps.twitchApi.sendWhisper(
        botSession.twitch_user_id, streamerSession.twitch_user_id,
        `[${severity.toUpperCase()}] ${message}`, botSession.access_token
      ).catch(() => {});
    }
  }
}

module.exports = { init, alertStreamer };
