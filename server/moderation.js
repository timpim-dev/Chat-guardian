let deps = {};
const recentMessages = []; // ring buffer for AI context
const MAX_CONTEXT = 10;

function sendChatMessage(channel, message) {
  if (deps.twitchIrc) {
    const client = deps.twitchIrc.getClient();
    if (client) {
      client.say(channel, message).catch(err => {
        console.warn('[Moderation] Failed to send chat message:', err.message);
      });
    }
  }
}

function init(d) { deps = d; }

function getActionForPoints(totalPoints, tiers) {
  if (!tiers || tiers.length === 0) return { action: 'log' };
  for (const tier of tiers) {
    if (totalPoints <= tier.maxPoints) return tier;
  }
  return tiers[tiers.length - 1];
}

async function executeModerationAction(channel, userId, username, messageId, messageText, tags, totalUserPoints, categories) {
  const testMode = deps.db.getSetting('test_mode') === 'true';
  const hyperTestMode = deps.db.getSetting('hyper_test_mode') === 'true';
  const isModOrBroadcaster = tags.mod || (tags.badges && tags.badges.broadcaster);

  const plan = deps.db.getActivePlan();
  const planConfig = plan ? plan.config : null;
  if (!planConfig || !planConfig.tiers) return 'none';

  let tier = getActionForPoints(totalUserPoints, planConfig.tiers);

  // Escalate to minimum 5-minute timeout if tagged as dangerous or severe AI category
  if (categories.includes('dangerous') || categories.includes('threats') || categories.includes('self_harm')) {
    const isAlreadyHarder = tier.action === 'ban' || (tier.action === 'timeout' && tier.duration >= 300);
    if (!isAlreadyHarder) {
      tier = { action: 'timeout', duration: 300, alert: true };
    }
  }

  let actionTaken = 'none';

  if (tier.action === 'delete' || tier.action === 'timeout' || tier.action === 'ban') {
    if (testMode && isModOrBroadcaster && !hyperTestMode) {
      actionTaken = `test_${tier.action}`;
      if (tier.alert) {
        deps.alerts.alertStreamer(
          `[TEST MODE] ${username}: ${messageText.slice(0, 100)}${messageText.length > 100 ? '...' : ''} [${categories.join(', ')}]`,
          'warning',
          { userId, username, messageId, action: actionTaken, points: totalUserPoints }
        );
      }
    } else {
      const streamerSession = deps.db.getSessionByType('streamer');
      const botSession = deps.db.getSessionByType('bot');
      const modToken = botSession ? botSession.access_token : (streamerSession ? streamerSession.access_token : null);
      const modId = botSession ? botSession.twitch_user_id : (streamerSession ? streamerSession.twitch_user_id : null);
      const broadcasterId = tags['room-id'] || (streamerSession ? streamerSession.twitch_user_id : null);

      // Delete the message
      if (modToken && modId && broadcasterId) {
        deps.twitchApi.deleteMessage(broadcasterId, modId, messageId, modToken).catch(() => {});
      }
      actionTaken = 'deleted';

      if (tier.action === 'timeout' && tier.duration) {
        if (modToken && modId && broadcasterId) {
          const reason = `Auto-mod: ${categories.join(', ')} (${totalUserPoints} pts)`;
          deps.twitchApi.timeoutUser(broadcasterId, modId, userId, tier.duration, reason, modToken).catch(() => {});
        }
        actionTaken = `timeout_${tier.duration}s`;
        deps.db.updateUserTimeout(userId);
      } else if (tier.action === 'ban') {
        if (modToken && modId && broadcasterId) {
          const reason = `Auto-mod ban: ${categories.join(', ')} (${totalUserPoints} pts)`;
          deps.twitchApi.banUser(broadcasterId, modId, userId, reason, modToken).catch(() => {});
        }
        actionTaken = 'banned';
        deps.db.updateUserTimeout(userId);
      }

      // Alert streamer
      if (tier.alert) {
        const severity = tier.action === 'ban' ? 'critical' : (tier.action === 'timeout' ? 'warning' : 'info');
        deps.alerts.alertStreamer(
          `${username}: ${messageText.slice(0, 100)}${messageText.length > 100 ? '...' : ''} [${categories.join(', ')}]`,
          severity,
          { userId, username, messageId, action: actionTaken, points: totalUserPoints }
        );
      }
    }
  }

  return actionTaken;
}

async function processMessage(channel, tags, messageText) {
  const testMode = deps.db.getSetting('test_mode') === 'true';
  const hyperTestMode = deps.db.getSetting('hyper_test_mode') === 'true';
  const isModOrBroadcaster = tags.mod || (tags.badges && tags.badges.broadcaster);

  // Skip broadcaster and mods unless test mode or hyper test mode is enabled
  if (isModOrBroadcaster && !testMode && !hyperTestMode) {
    const msg = {
      id: tags.id || `local_${Date.now()}`,
      timestamp: parseInt(tags['tmi-sent-ts']) || Date.now(),
      username: tags.username || tags['display-name'] || 'unknown',
      user_id: tags['user-id'] || 'unknown',
      message_text: messageText,
      verdict: 'safe',
      categories: [],
      points: 0,
      action_taken: 'none'
    };
    // Store and broadcast even safe messages for the live feed
    try { deps.db.insertMessage(msg); } catch (e) { /* dup key ok */ }
    deps.wsManager.broadcast('new_message', msg);
    return msg;
  }

  const userId = tags['user-id'] || 'unknown';
  const username = tags.username || tags['display-name'] || 'unknown';
  const messageId = tags.id || `local_${Date.now()}`;
  const timestamp = parseInt(tags['tmi-sent-ts']) || Date.now();

  // Get or create user
  deps.db.getOrCreateUser(userId, username);

  // Get active plan
  const plan = deps.db.getActivePlan();
  const planConfig = plan ? plan.config : null;

  // Layer 1: Rule-based filtering
  const ruleResult = deps.filterRules.checkMessage(username, messageText, planConfig);

  // Determine initial verdict
  let verdict = 'safe';
  let points = ruleResult.points;
  let categories = ruleResult.categories;
  let actionTaken = 'none';

  if (ruleResult.matched) {
    verdict = points >= 5 ? 'blocked' : 'flagged';
  }

  // Create message record
  const msg = {
    id: messageId, timestamp, username, user_id: userId,
    message_text: messageText, verdict, categories,
    points, action_taken: actionTaken
  };

  // Insert strikes if points > 0
  if (points > 0) {
    for (const detail of ruleResult.details) {
      deps.db.insertStrike({
        user_id: userId, message_id: messageId,
        category: detail.category, points: detail.category === ruleResult.details[0].category ? points : 0,
        timestamp
      });
    }
  }

  // Calculate rolling window points for user
  const windowHours = parseInt(deps.db.getSetting('rolling_window_hours') || '24');
  const windowMs = windowHours * 3600000;
  const totalUserPoints = deps.db.getUserPoints(userId, windowMs);
  deps.db.updateUserPoints(userId, totalUserPoints);

  // Determine action based on plan tiers (only if this message itself has violations)
  if (points > 0 && totalUserPoints > 0) {
    actionTaken = await executeModerationAction(channel, userId, username, messageId, messageText, tags, totalUserPoints, categories);
    if (actionTaken !== 'none') {
      verdict = 'blocked';
    }
  }

  msg.verdict = verdict;
  msg.action_taken = actionTaken;

  // Store message
  try { deps.db.insertMessage(msg); } catch (e) { /* dup key ok */ }

  // Broadcast to dashboard
  deps.wsManager.broadcast('new_message', msg);

  // Send chat message if blocked
  if (verdict === 'blocked') {
    const cutoff = Date.now() - windowMs;
    const strikes = deps.db.getUserStrikes(userId).filter(s => s.reversed === 0 && s.timestamp > cutoff).length;
    sendChatMessage(channel, `@${username}, your message has been blocked for violating community guidelines. Active strikes: ${strikes}.`);
  }

  // Layer 2: AI filtering (async, non-blocking)
  const aiEnabled = deps.db.getSetting('ai_enabled') === 'true';
  if (aiEnabled) {
    const aiMode = deps.db.getSetting('ai_mode') || 'borderline';
    const shouldCheck = aiMode === 'all' || (aiMode === 'borderline' && ruleResult.matched && points < 5);
    if (shouldCheck) {
      const settings = deps.db.getAllSettings();
      const context = recentMessages.slice(-MAX_CONTEXT).map(m => `${m.username}: ${m.message_text}`);
      deps.filterAi.checkMessageAI(messageText, context, settings).then(aiResult => {
        if (aiResult) {
          let newVerdict = verdict;
          let newPoints = points;
          let newCategories = [...categories];
          let newAction = actionTaken;

          if (aiResult.unsafe) {
            const aiWeight = planConfig && planConfig.categories && planConfig.categories.ai_flagged
              ? planConfig.categories.ai_flagged.weight : 6;
            newPoints += aiWeight;
            for (const cat of aiResult.categories) {
              if (!newCategories.includes(cat)) newCategories.push(cat);
            }
            newVerdict = newPoints >= 5 ? 'blocked' : 'flagged';

            // Insert AI strike
            deps.db.insertStrike({
              user_id: userId, message_id: messageId,
              category: 'ai_flagged', points: aiWeight, timestamp
            });

            // Recalculate and possibly take action
            const newTotal = deps.db.getUserPoints(userId, windowMs);
            deps.db.updateUserPoints(userId, newTotal);

            // Escalate categories if AI flagged severe threats/self_harm
            if (aiResult.categories.includes('threats') || aiResult.categories.includes('self_harm')) {
              if (!newCategories.includes('dangerous')) newCategories.push('dangerous');
            }

            executeModerationAction(channel, userId, username, messageId, messageText, tags, newTotal, newCategories).then(act => {
              if (act !== 'none') {
                newVerdict = 'blocked';
                newAction = act;
              }
              deps.db.updateMessageVerdict(messageId, newVerdict, aiResult, newCategories, newPoints, newAction);
              deps.wsManager.broadcast('message_updated', {
                id: messageId, verdict: newVerdict, ai_verdict: aiResult,
                categories: newCategories, points: newPoints, action_taken: newAction
              });

              // Send chat warning if AI upgrade caused it to be blocked
              if (newVerdict === 'blocked' && verdict !== 'blocked') {
                const cutoff = Date.now() - windowMs;
                const strikes = deps.db.getUserStrikes(userId).filter(s => s.reversed === 0 && s.timestamp > cutoff).length;
                sendChatMessage(channel, `@${username}, warning: your message was flagged as highly inappropriate by our automated filters. Active strikes: ${strikes}.`);
              }
            });
          } else {
            deps.db.updateMessageVerdict(messageId, newVerdict, aiResult, newCategories, newPoints, newAction);
            deps.wsManager.broadcast('message_updated', {
              id: messageId, verdict: newVerdict, ai_verdict: aiResult,
              categories: newCategories, points: newPoints, action_taken: newAction
            });
          }
        }
      }).catch(err => {
        console.warn('[Moderation] AI check failed:', err.message);
      });
    }
  }

  // Track context
  recentMessages.push({ username, message_text: messageText });
  if (recentMessages.length > MAX_CONTEXT * 2) recentMessages.splice(0, MAX_CONTEXT);

  return msg;
}

function getActivePlanConfig() {
  const plan = deps.db.getActivePlan();
  return plan ? plan.config : null;
}

function handleDispute(messageId, autoReverse) {
  deps.db.markDisputed(messageId);
  if (autoReverse) {
    deps.db.resolveDispute(messageId, true);
  }
  deps.wsManager.broadcast('message_updated', { id: messageId, disputed: true });
}

module.exports = { init, processMessage, getActivePlanConfig, handleDispute };
