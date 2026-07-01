// Helix API rate limiter - token bucket (800 points/min)
let remaining = 800;
let resetTime = Date.now() + 60000;
const queue = [];
let processing = false;

function updateFromHeaders(headers) {
  if (headers && headers.get) {
    const rem = headers.get('ratelimit-remaining');
    const reset = headers.get('ratelimit-reset');
    if (rem !== null) remaining = parseInt(rem);
    if (reset !== null) resetTime = parseInt(reset) * 1000;
    if (remaining < 100) {
      console.warn(`[RateLimit] WARNING: Only ${remaining} Helix API points remaining. Resets at ${new Date(resetTime).toISOString()}`);
    }
  }
}

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const now = Date.now();
    if (now > resetTime) {
      remaining = 800;
      resetTime = now + 60000;
    }
    if (remaining <= 0) {
      const waitMs = Math.max(resetTime - now, 1000);
      console.log(`[RateLimit] Rate limited. Waiting ${waitMs}ms...`);
      await new Promise(r => setTimeout(r, waitMs));
      remaining = 800;
      resetTime = Date.now() + 60000;
    }
    const { url, options, resolve, reject } = queue.shift();
    try {
      remaining--;
      const response = await fetch(url, options);
      updateFromHeaders(response.headers);
      resolve(response);
    } catch (err) {
      reject(err);
    }
  }
  processing = false;
}

function rateLimitedFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    queue.push({ url, options, resolve, reject });
    processQueue();
  });
}

module.exports = { rateLimitedFetch };
