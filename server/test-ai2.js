const db = require('./db');
const filterAi = require('./filter-ai');

db.initDb();
const settings = db.getAllSettings();
console.log('Model:', settings.ai_model);
console.log('Key (truncated):', settings.ai_api_key ? settings.ai_api_key.slice(0, 15) + '...' : 'none');

filterAi.checkMessageAI('bitch', [], settings)
  .then(res => {
    console.log('AI Response:', JSON.stringify(res));
    db.close();
  })
  .catch(err => {
    console.error('AI Error:', err);
    db.close();
  });
