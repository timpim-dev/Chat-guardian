# Chat Guardian

Self-hosted Twitch chat moderation tool. It runs as a background service on Arch Linux (or any Linux with systemd) and exposes a local web dashboard. It reads live Twitch chat in real time, scores messages for safety using rule-based filters and an optional AI filter (OpenRouter), takes automatic moderation action (delete + timeout after repeated flags), logs everything to SQLite, and lets the streamer review/appeal blocked messages.

## Features
- **Real-Time IRC Chat Reader**: Connects to Twitch chat via IRC (`tmi.js`) with lowest latency.
- **Helix API Action Path**: Uses official Twitch Helix API endpoints for message deletions, timeouts, bans, and whispers.
- **Two-Layer content safety filtering**:
  - **Layer 1 (Rule-based)**: Fast, always-on regex and keyword lists for slurs, sexual content, spam, scam/phishing links, and promo ad-bots.
  - **Layer 2 (AI-based)**: Optional OpenRouter integration using free-tier models (like Llama-3.1-8b) with structured moderation prompts and borderline checks.
- **Rolling security points system**: Assign points for violations; actions are taken automatically as cumulative points cross thresholds.
- **Multiple Named Protection Plans**: Chill, Standard (default), Strict, and custom plans with distinct point weights and threshold actions.
- **Web Dashboard**: Utilitarian, flat-color dark-theme SPA with real-time updates via WebSockets.
- **Double Login Path**: Secure streamer login + optional dedicated bot account authorization code flow.
- **False-Positive Dispute Flow**: Streamer can review flagged/blocked messages and click "Report as wrongly blocked" to dispute, resolve, and reverse strike points.
- **Arch Linux Desktop Alerts**: Optional system-wide desktop notifications via `notify-send` when severe moderation actions occur.

## Prerequisites
- Node.js >= 18
- Arch Linux (or any standard systemd Linux distribution)
- `libnotify` (for desktop alerts):
  ```bash
  sudo pacman -S libnotify
  ```

## Quick Start
1. Clone this repository to your target directory.
2. Initialize environment:
   ```bash
   cp .env.example .env
   ```
   Fill in `.env` with your Twitch credentials and settings (see below).
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the server:
   ```bash
   npm start
   ```
   For development auto-reloads:
   ```bash
   npm run dev
   ```
5. Open the dashboard URL printed on boot (defaults to `http://localhost:4242`).

---

## Twitch App Registration
To use Chat Guardian, you must register a Twitch Developer Application:
1. Go to the [Twitch Developer Console](https://dev.twitch.tv/console).
2. Register a new application. Set **OAuth Redirect URLs** to:
   `http://localhost:4242/auth/twitch/callback`
   *(If you configure a different port range start in `.env`, adjust the port here accordingly).*
3. Copy the **Client ID** and generate a **Client Secret**. Add them to your `.env` file.

### Required Scopes:
- **Streamer**: `chat:read`, `chat:edit`, `moderator:manage:chat_messages`, `moderator:manage:banned_users`, `user:manage:whispers`, `channel:moderate`
- **Bot**: `chat:read`, `chat:edit`, `moderator:manage:chat_messages`, `moderator:manage:banned_users`, `user:manage:whispers`

---

## Process Model & Deployment

### Option A — systemd user service (Recommended)
Keep Chat Guardian running 24/7 as a background service:
1. Copy the `chat-guardian.service` template to systemd user configuration directory:
   ```bash
   mkdir -p ~/.config/systemd/user/
   cp chat-guardian.service ~/.config/systemd/user/
   ```
2. Edit `~/.config/systemd/user/chat-guardian.service` to set your absolute paths for `WorkingDirectory` and `EnvironmentFile`.
3. Enable and start the service:
   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now chat-guardian
   ```
4. Allow the service to persist after you log out:
   ```bash
   loginctl enable-linger $USER
   ```
5. View live logs:
   ```bash
   journalctl --user -u chat-guardian -f
   ```

### Option B — nohup launcher
For manual starts that survive terminal closure in the same session:
- To start: `./start.sh`
- To stop: `./stop.sh`
- Logs are located at `logs/out.log`. Note that this method does not persist after reboots or system logout.

---

## Configuration Reference (`.env`)
- `TWITCH_CLIENT_ID`: Twitch App Client ID.
- `TWITCH_CLIENT_SECRET`: Twitch App Client Secret.
- `BROADCASTER_CHANNEL`: Target channel to moderate (lowercase).
- `OPENROUTER_DEFAULT_API_KEY`: OpenRouter API key.
- `DASHBOARD_PIN`: Local web dashboard PIN (for access protection).
- `PORT_RANGE_START`: Defaults to `4242`. Auto-detects ports upward if in use.

---

## Blocklist Customization
Custom filters are loaded dynamically from the `data/blocklists/` directory:
- `slurs.txt`: Fill in word patterns (one per line). Case-insensitive, matched on word boundaries.
- `sexual.txt`: Starter regexes for explicit terms.
- `spam-patterns.txt`: Regexes matching spam/repeated characters.
- `scam-links.txt`: Phishing/scam domain matching.
- `ad-bots.json`: Structured list of ad bot templates matching usernames or patterns.
