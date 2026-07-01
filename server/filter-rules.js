const fs = require('fs');
const path = require('path');

const BLOCKLIST_DIR = path.join(__dirname, '..', 'data', 'blocklists');

let lists = {
  hate_speech: [],
  sexual: [],
  spam: [],
  scam_links: [],
  dangerous: [],
  ad_bots: { username: [], message: [] }
};

function loadTextList(filename) {
  const filepath = path.join(BLOCKLIST_DIR, filename);
  if (!fs.existsSync(filepath)) return [];
  const content = fs.readFileSync(filepath, 'utf-8');
  const patterns = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    try {
      patterns.push(new RegExp(trimmed, 'i'));
    } catch (e) {
      console.warn(`[Filter] Invalid regex in ${filename}: ${trimmed}`);
    }
  }
  return patterns;
}

function loadBlocklists() {
  lists.hate_speech = loadTextList('slurs.txt');
  lists.sexual = loadTextList('sexual.txt');
  lists.spam = loadTextList('spam-patterns.txt');
  lists.scam_links = loadTextList('scam-links.txt');
  lists.dangerous = loadTextList('dangerous.txt');

  // Load ad-bots JSON
  const adBotsPath = path.join(BLOCKLIST_DIR, 'ad-bots.json');
  lists.ad_bots = { username: [], message: [] };
  if (fs.existsSync(adBotsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(adBotsPath, 'utf-8'));
      for (const entry of (data.patterns || [])) {
        try {
          const compiled = { regex: new RegExp(entry.pattern, 'i'), label: entry.label };
          if (entry.type === 'username') lists.ad_bots.username.push(compiled);
          else lists.ad_bots.message.push(compiled);
        } catch (e) {
          console.warn(`[Filter] Invalid ad-bot pattern: ${entry.pattern}`);
        }
      }
    } catch (e) {
      console.warn('[Filter] Failed to parse ad-bots.json:', e.message);
    }
  }

  const counts = {
    hate_speech: lists.hate_speech.length,
    sexual: lists.sexual.length,
    spam: lists.spam.length,
    scam_links: lists.scam_links.length,
    dangerous: lists.dangerous.length,
    ad_bots: lists.ad_bots.username.length + lists.ad_bots.message.length
  };
  console.log('[Filter] Blocklists loaded:', counts);
}

function checkMessage(username, messageText, planConfig) {
  const result = { matched: false, categories: [], points: 0, details: [] };
  const cats = planConfig ? planConfig.categories : null;

  // Dangerous
  if (!cats || (cats.dangerous && cats.dangerous.enabled)) {
    for (const regex of lists.dangerous) {
      const match = messageText.match(regex);
      if (match) {
        const w = cats && cats.dangerous ? cats.dangerous.weight : 15;
        result.matched = true;
        if (!result.categories.includes('dangerous')) result.categories.push('dangerous');
        result.points += w;
        result.details.push({ category: 'dangerous', pattern: regex.source, matched_text: match[0] });
        break;
      }
    }
  }

  // Hate speech
  if (!cats || (cats.hate_speech && cats.hate_speech.enabled)) {
    for (const regex of lists.hate_speech) {
      const match = messageText.match(regex);
      if (match) {
        const w = cats && cats.hate_speech ? cats.hate_speech.weight : 10;
        result.matched = true;
        result.categories.push('hate_speech');
        result.points += w;
        result.details.push({ category: 'hate_speech', pattern: regex.source, matched_text: match[0] });
        break; // one match per category
      }
    }
  }

  // Sexual
  if (!cats || (cats.sexual && cats.sexual.enabled)) {
    for (const regex of lists.sexual) {
      const match = messageText.match(regex);
      if (match) {
        const w = cats && cats.sexual ? cats.sexual.weight : 7;
        result.matched = true;
        if (!result.categories.includes('sexual')) result.categories.push('sexual');
        result.points += w;
        result.details.push({ category: 'sexual', pattern: regex.source, matched_text: match[0] });
        break;
      }
    }
  }

  // Spam (patterns + built-in checks)
  if (!cats || (cats.spam && cats.spam.enabled)) {
    const w = cats && cats.spam ? cats.spam.weight : 3;
    let spamDetected = false;

    // Pattern-based
    for (const regex of lists.spam) {
      const match = messageText.match(regex);
      if (match) {
        spamDetected = true;
        result.details.push({ category: 'spam', pattern: regex.source, matched_text: match[0] });
        break;
      }
    }

    // Built-in: excessive caps
    if (!spamDetected && messageText.length > 5) {
      const upperCount = (messageText.match(/[A-Z]/g) || []).length;
      const letterCount = (messageText.match(/[a-zA-Z]/g) || []).length;
      if (letterCount > 0 && upperCount / letterCount > 0.7) {
        spamDetected = true;
        result.details.push({ category: 'spam', pattern: 'excessive_caps', matched_text: messageText.slice(0, 50) });
      }
    }

    // Built-in: repeated chars (>5 same char in a row)
    if (!spamDetected && /(.{1})\1{5,}/.test(messageText)) {
      spamDetected = true;
      result.details.push({ category: 'spam', pattern: 'repeated_chars', matched_text: (messageText.match(/(.{1})\1{5,}/) || [])[0] || '' });
    }

    if (spamDetected) {
      result.matched = true;
      if (!result.categories.includes('spam')) result.categories.push('spam');
      result.points += w;
    }
  }

  // Scam links
  if (!cats || (cats.scam_links && cats.scam_links.enabled)) {
    for (const regex of lists.scam_links) {
      const match = messageText.match(regex);
      if (match) {
        const w = cats && cats.scam_links ? cats.scam_links.weight : 10;
        result.matched = true;
        if (!result.categories.includes('scam_links')) result.categories.push('scam_links');
        result.points += w;
        result.details.push({ category: 'scam_links', pattern: regex.source, matched_text: match[0] });
        break;
      }
    }
  }

  // Ad bots
  if (!cats || (cats.ad_bots && cats.ad_bots.enabled)) {
    const w = cats && cats.ad_bots ? cats.ad_bots.weight : 8;
    let adDetected = false;

    // Check username
    for (const entry of lists.ad_bots.username) {
      if (entry.regex.test(username)) {
        adDetected = true;
        result.details.push({ category: 'ad_bots', pattern: entry.regex.source, matched_text: username });
        break;
      }
    }

    // Check message
    if (!adDetected) {
      for (const entry of lists.ad_bots.message) {
        const match = messageText.match(entry.regex);
        if (match) {
          adDetected = true;
          result.details.push({ category: 'ad_bots', pattern: entry.regex.source, matched_text: match[0] });
          break;
        }
      }
    }

    if (adDetected) {
      result.matched = true;
      if (!result.categories.includes('ad_bots')) result.categories.push('ad_bots');
      result.points += w;
    }
  }

  return result;
}

module.exports = { loadBlocklists, checkMessage };
