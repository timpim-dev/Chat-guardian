const express = require('express');

let context = null;

function init(ctx) {
  context = ctx;
  console.log('[Styler] Initializing Styler addon...');

  // Setup defaults
  if (!context.db.getSetting('styler_ai_mood')) {
    context.db.setSetting('styler_ai_mood', 'Strict');
  }
  if (!context.db.getSetting('styler_ui_theme')) {
    context.db.setSetting('styler_ui_theme', 'dark');
  }

  // Register AI system prompt modifier
  global.aiSystemPromptModifier = (prompt, settings) => {
    const mood = context.db.getSetting('styler_ai_mood') || 'Strict';
    let selectedMood = mood;
    if (mood === 'Moodswings') {
      const moods = ['Friendly', 'Sarcastic', 'Strict', 'Passive-Aggressive', 'Pirate'];
      selectedMood = moods[Math.floor(Math.random() * moods.length)];
    }

    let moodInstruction = '';
    if (selectedMood === 'Friendly') {
      moodInstruction = ' Keep your moderation style positive and friendly. Warn the user gently.';
    } else if (selectedMood === 'Sarcastic') {
      moodInstruction = ' Be highly sarcastic, sassy, and mocking of violations in your thought process.';
    } else if (selectedMood === 'Passive-Aggressive') {
      moodInstruction = ' Be extremely passive-aggressive and annoyed that viewers are sending bad messages.';
    } else if (selectedMood === 'Pirate') {
      moodInstruction = ' Adopt a pirate persona in your thought process. Ahoy matey!';
    }
    return prompt + moodInstruction;
  };

  // Register endpoints
  const router = express.Router();

  router.get('/settings', (req, res) => {
    res.json({
      ai_mood: context.db.getSetting('styler_ai_mood') || 'Strict',
      ui_theme: context.db.getSetting('styler_ui_theme') || 'dark'
    });
  });

  router.put('/settings', (req, res) => {
    const { ai_mood, ui_theme } = req.body;
    context.db.setSetting('styler_ai_mood', ai_mood);
    context.db.setSetting('styler_ui_theme', ui_theme);
    res.json({ success: true });
  });

  context.app.use('/api/plugins/styler', router);
}

function cleanup() {
  console.log('[Styler] Cleaning up Styler addon...');
  global.aiSystemPromptModifier = null;
}

module.exports = { init, cleanup };
