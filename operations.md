# X-Connect Operations Guide for AI Agents

When an AI agent is asked to interact with X (Twitter) using this skill, use the following commands based on the user's intent. Do not create new scripts; use these strictly.

Ensure that the command is executed in the `skills/x-connect/scripts/` directory, or use absolute paths for the scripts.

---

## Pre-Flight Checklist (Run Before Any Batch)

Before launching any engagement batch, verify these three things:

### 1. Cookies are valid (`scripts/cookies.json`)

The session cookie file must contain a fresh, authenticated session from x.com. Stale cookies cause an immediate **"Not logged in!"** error and the script exits.

**How to refresh cookies:**
1. Open x.com in Chrome/Edge and confirm you are logged in
2. Install a cookie export extension (e.g. **Cookie-Editor** or **EditThisCookie**)
3. Export all cookies for `x.com` as JSON
4. Replace `skills/x-connect/scripts/cookies.json` with the exported file

**How to verify cookies without running a full batch:**
```bash
node test-cookies.js
```
Expected output: `Logged In elements found: true`

**Key cookies to look for** — if any of these are missing or expired, the session will fail:
| Cookie | Purpose |
|---|---|
| `auth_token` | Primary session token (most important) |
| `ct0` | CSRF token (required for POST actions) |
| `twid` | Logged-in user ID |

> **Note:** `__cf_bm` (Cloudflare) expires in ~30 minutes and does not need to be fresh — X will issue a new one on first request.

### 2. `.env` file is present (`skills/x-connect/.env`)

Required variables:
```
NVIDIA_API_KEY=nvapi-...        # LLM calls (required for all engagement modes)
NEWS_API_KEY=...                 # Optional — enriches replies with news context
MASTER_API_KEY=...               # Only needed if running api-server.js
```

### 3. Node modules are installed

```bash
cd skills/x-connect && npm install
```

---

## Core Engagement Engine

| User Request | Command to Execute | Description |
|---|---|---|
| "Run an engagement batch" / "Engage on X" | `node x-feed-engage.js --quota 100 --min-pause 25 --max-pause 55 --reply-back --rb-limit 20` | Standard automation mode (safest for accounts with no paid API credits). Browses the home feed using Puppeteer. |
| "Engage with a specific list" | `node x-feed-engage.js --list <URL> --quota 100 --min-pause 25 --max-pause 55` | Replaces the home feed with a specific X list URL. |
| "Run non-headless" / "Show the browser" | `node x-feed-engage.js --list <URL> --quota 100 --no-headless` | Opens Chrome visibly. Use this if headless mode fails to authenticate (cookies load but X doesn't recognize the session). |
| "Run a stealth batch" / "Engage slowly" | `node x-feed-engage.js --quota 50 --min-pause 120 --max-pause 300` | Uses longer wait times between actions to mimic slower human pacing. |
| "Run a hybrid batch" | `node x-api-engage.js --mode hybrid --quota 100` | Uses Puppeteer to read the feed, but the **X API** to write (post replies/likes). *Requires OAuth 1.0a User Tokens in credentials.json*. |
| "Engage via API" / "Business mode" | `node x-api-engage.js --mode api --quota 50` | Uses the X API for everything (reading and writing). *Requires a paid X API tier for read credits.* |
| "Search and engage" / "Engage about [topic]" | `node x-api-engage.js --mode api --search "[query]" --quota 30` | Searches for a specific keyword and engages with matching tweets via API. |
| "Dry run" / "Test engagement" | `node x-api-engage.js --dry-run --verbose` | Previews what the engine *would* do without actually taking any actions on X. |

## Utility Commands

| User Request | Command to Execute | Description |
|---|---|---|
| "Stop all processes" / "Stop batch" | `powershell -Command "Get-Process chrome,node -ErrorAction SilentlyContinue \| Stop-Process -Force"` | Reliably kills all Chrome and Node processes. Preferred over `taskkill` from bash — `taskkill /T` can silently fail to release the Chrome profile lock (`~/.openclaw/x-profile-v2`), causing "browser already running" on the next launch. |
| "Check API Authentication" / "Test X API" | `node x-api-test.js me` | verifies that the credentials in `credentials.json` are valid and returns the authenticated user's profile. |
| "Post a tweet" | `node x-api-test.js tweet "Your text here"` | Posts a new standalone tweet using the X API. |

## News & Context Enrichment

`news.js` automatically enriches replies with live headlines. It extracts a search query **directly from the tweet text** — no hardcoded topic routing. `$TICKER` symbols are expanded to full names (`$BTC` → `"bitcoin"`), named entities and capitalized words are extracted, stop words are stripped. It tries a 12h window first, widens to 48h if empty, and validates that the articles actually overlap with the tweet before injecting context. Topics like `motivational`, `meme`, and `personal` are always skipped.

| User Request | Command to Execute | Description |
|---|---|---|
| "Get tech headlines" | `node news.js headlines --category technology` | Fetches the latest breaking news using NewsAPI. |
| "Search news about [topic]" | `node news.js search --q "[topic]"` | Searches for specific news articles, sorted by `publishedAt`. |
| "What news context would this tweet get?" | `node news.js context --tweet "fed just hiked again"` | Runs the full enrichment pipeline on a test tweet and prints the result. |
| "What query would be extracted from this tweet?" | `node news.js extract --tweet "$BTC dumped 10% on CPI data"` | Prints the extracted search query without making any API calls. Useful for debugging. |

## API Server (Multi-Tenant)

| User Request | Command to Execute | Description |
|---|---|---|
| "Start the API server" | `node api-server.js` | Starts the REST API server on port 3000. Exposes endpoints to manage client sessions remotely. |
| "Start API server on port X" | `node api-server.js --port <X>` | Runs on a custom port. |
| "Register a new client" | `node setup-client.js --id <id> --name "Name"` | Creates a new client directory and generates an API key. |
| "Register client with credentials" | `node setup-client.js --id <id> --credentials ./keys.json` | Onboards a client and copies their X API keys in one step. |
| "Test cookies / verify login" | `node test-cookies.js` | Opens X.com with current cookies.json and prints whether the session is logged in. |

## Pacing & Timing Reference

`x-feed-engage.js` has multiple layers of pauses built in. Understanding them helps you tune the batch correctly.

### The main pause — between every like+reply action

Controlled by `--min-pause` and `--max-pause` (values in **seconds**).

```bash
node x-feed-engage.js --min-pause 25 --max-pause 60    # default (human-aggressive)
node x-feed-engage.js --min-pause 120 --max-pause 300  # moderate
node x-feed-engage.js --min-pause 420 --max-pause 720  # stealth (7–12 min)
```

> **Default when no flags are passed: 25–60 seconds**
> The script picks a random value in your range after each completed engagement action (like + reply). This pause is logged as `💤 Xs pause...`

| Pace profile | `--min-pause` | `--max-pause` | Use case |
|---|---|---|---|
| Fast / testing | `10` | `30` | Dev testing only — risky for real accounts |
| **Default** | **`25`** | **`60`** | **Standard — used when no flags passed** |
| Moderate | `120` | `300` | Balanced — reasonable throughput |
| Stealth | `420` | `720` | New/valuable accounts — mimics human reading |
| Ultra-slow | `900` | `1800` | Maximum safety, 15–30 min between actions |

### Other built-in pauses (not configurable)

These happen automatically and cannot be changed via flags:

| When | Duration | Why |
|---|---|---|
| Between scroll cycles (no fresh tweets) | 1.8–3.5s random | Natural scrolling rhythm |
| After navigating back to feed post-action | 2s | Let feed reload |
| Between reply-back actions (notifications phase) | 10–25s random | Separate pacing for the reply-back phase |
| DOM interaction waits (click, keypress, etc.) | 300ms–1.5s | Waiting for UI state changes |
| Character-by-character typing | Random per char | Humanizes reply input to avoid bot detection |

### How pacing affects total batch time (approximate)

| Quota | Pause range | Est. total time |
|---|---|---|
| 100 tweets | 25–55s | ~1.5–2 hours |
| 100 tweets | 120–300s | ~5–8 hours |
| 100 tweets | 420–720s | ~13–20 hours |
| 50 tweets | 420–720s | ~7–10 hours |

> These estimates assume every tweet gets a like+reply. Skipped tweets (SKIP classification, ads, seen) add scroll time but no pause.

---

## Observed User Behaviour (How This Skill Is Actually Used)
> Full command reference: **`user-behavior.md`** — read before assuming what a short message means.

| Setting | Value |
|---|---|
| Mode | `--no-headless` always (with Xvfb on VPS) |
| Quota | 100 unless specified |
| Pacing | `--min-pause 25 --max-pause 55` |
| Replies | `--reply-back --rb-limit 20` |

### Cookies
The user provides fresh cookies by pasting the JSON array directly into the chat:
1. Write the pasted JSON directly to `scripts/cookies.json` (overwrite completely)
2. Do NOT auto-start — wait for the user to say `run`

### On failure
1. Read the log: `tail -50 debug/x-feed-engage.log`
2. Match the error to a section in **`debug.md`** using the Quick Reference table
3. Follow that section exactly — do not improvise

### Documentation
Keep this file up to date as new patterns, errors, or preferences are observed.
---

## Important Notes for Agents

### Authentication
1. **Cookies expire.** The most common failure mode is `[ERROR] Not logged in!` immediately after navigation. This always means `cookies.json` is stale. Re-export from the browser and replace the file — do not try other fixes first.
2. **`--no-headless` can help.** If cookies look valid but headless mode still fails to authenticate, run with `--no-headless`. Headless Chrome sometimes handles cookie injection differently than a visible browser window.
3. A **debug screenshot** is saved to `debug/feed-not-logged-in-<timestamp>.png` on every login failure. Read this image to diagnose what X is showing (login wall, CAPTCHA, error page, etc.).

### Modes
4. **Automation (`x-feed-engage.js`)** requires a browser. **Do not** run this in headless environments that block UI, though it handles it automatically via Puppeteer.
5. **Hybrid & API (`x-api-engage.js`)** rely on `credentials.json`.
   - **Hybrid mode** bypasses paid API read limits but uses the generous free tier write limits.
   - **API Mode** requires the user to have explicitly purchased X API credits (otherwise the script will throw `402 CreditsDepleted`).
6. Per-Client Isolation: The API/Hybrid engine supports per-client configurations.
   - Run using: `node x-api-engage.js --mode hybrid --client-id <name> --credentials ./clients/<name>/keys.json`

### Classification & Filtering
7. The system automatically classifies tweets as SKIP, PASS, or SHILL based on `engagement-bait-filter.md`.
8. Promoted/ad tweets are filtered out automatically (`isAd` detection via `[data-testid="promotedIndicator"]`).
9. Vision model (image description) has a 60s timeout. If it times out, the tweet is still classified using text only — this is expected and non-fatal.

### Paths
10. `reply-prompt.md` lives at `skills/x-connect/reply-prompt.md` (root of the skill, **not** inside `scripts/`). Both `engage-core.js` and `x-feed-engage.js` reference it via `path.join(__dirname, '..', 'reply-prompt.md')`.
11. Progress files are saved daily to `debug/feed-progress-YYYY-MM-DD.json`. The script reads this on startup to resume from where it left off within the same day.

### Reply prompt loading
12. `x-feed-engage.js` loads `reply-prompt.md` at startup via `loadReplyPrompt()`. If the file exists, it takes priority over the hardcoded inline fallback. **Known historical bug (now fixed):** the original regex used the `m` flag (`/^---[\s\S]*?^---\s*/m`), which made `^` match any line start and silently stripped the entire **Core Rules section** (everything between the first and second `---` divider) from the loaded prompt. Fixed to `/^---\n[\s\S]*?\n---\n/` (no `m` flag) so it only strips YAML frontmatter at position 0 — which the file doesn't have, so the full prompt now loads intact.

### $A token details (reply-prompt.md)
13. `$A` is on **Base** chain (not Clanker). CA: `0xaa681b1D3dE076f2524c94Ceb2Db712878Bb6b07`. Chart: `https://www.geckoterminal.com/base/pools/0x23e52ed0f63f3663bc5a8b688ac0e1dbafabe928c5a2de552f5f67ac1b33cd4d`. Whitepaper: `https://aptum.fun/whitepaper`. Revenue-generating AI agent token, 100B fixed supply, non-inflationary. Earnings flow back to holders via buybacks, burns, and airdrops. If these details need updating, edit `reply-prompt.md` and the `REPLY_SYSTEM_PROMPT_INLINE` constant in `x-feed-engage.js` (the inline fallback used when the file can't be loaded).

---

## VPS Automation Mode (Ubuntu)

Running `x-feed-engage.js` on a headless Ubuntu VPS requires a one-time setup. After that, batches run identically to local — just without `--no-headless`.

### Step 1 — Install Google Chrome

```bash
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" \
  | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update && sudo apt install -y google-chrome-stable
# Verify
google-chrome --version
```

> If on ARM/non-amd64, install Chromium instead:
> `sudo apt install -y chromium-browser`

---

### Step 2 — Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should print v20.x.x
```

---

### Step 3 — Upload the skill

From your local machine, copy the `x-connect` folder to the VPS:

```bash
scp -r skills/x-connect user@your-vps-ip:~/x-connect
```

Or clone/pull your repo if it's on GitHub.

---

### Step 4 — Install dependencies on VPS

```bash
cd ~/x-connect
npm install
```

---

### Step 5 — Create `.env`

```bash
cat > .env << 'EOF'
NVIDIA_API_KEY=nvapi-your-key-here
EOF
```

---

### Step 6 — Upload cookies

Export fresh cookies from your browser (Cookie-Editor → Export as JSON) and paste/upload to the VPS:

```bash
# From local machine
scp scripts/cookies.json user@your-vps-ip:~/x-connect/scripts/cookies.json
```

Or paste the JSON directly on the server:
```bash
nano ~/x-connect/scripts/cookies.json
# paste the JSON array, save with Ctrl+O, exit with Ctrl+X
```

**Key cookies required:** `auth_token`, `ct0`, `twid` — if any are missing the session will fail immediately.

---

### Step 7 — Run a batch

On VPS, always use **`--no-headless` with Xvfb** (pure headless is detected and serves empty feed). The `run.sh` handles Xvfb automatically — use it instead of calling node directly:

```bash
cd ~/x-connect/scripts
node x-feed-engage.js --quota 100 --min-pause 25 --max-pause 55 --reply-back --rb-limit 20
```

To run in background and keep it alive after SSH disconnect:

```bash
# Using nohup
nohup node x-feed-engage.js --quota 100 --min-pause 25 --max-pause 55 --reply-back --rb-limit 20 \
  > ../debug/vps-run-$(date +%Y%m%d-%H%M).log 2>&1 &
echo "PID: $!"

# Or using screen (persistent session)
screen -S xconnect
node x-feed-engage.js --quota 100 --min-pause 25 --max-pause 55 --reply-back --rb-limit 20
# Detach: Ctrl+A then D
# Reattach: screen -r xconnect
```

---

### Step 8 — Monitor the run

```bash
# Follow live log
tail -f ~/x-connect/debug/x-feed-engage.log

# Check today's progress
cat ~/x-connect/debug/feed-progress-$(date +%Y-%m-%d).json

# Check if still running
pgrep -a node
```

---

### Step 9 — Stop the batch

```bash
pkill -f x-feed-engage.js   # kill only the engage script
# or
pkill node && pkill chrome   # kill all node + chrome
```

---

### Step 10 — Automate with cron (optional)

Run a batch every day at 9am UTC:

```bash
crontab -e
```

Add:
```
0 9 * * * cd /root/x-connect/scripts && node x-feed-engage.js --quota 100 --min-pause 25 --max-pause 55 --reply-back --rb-limit 20 >> /root/x-connect/debug/cron-$(date +\%Y\%m\%d).log 2>&1
```

---

### VPS Troubleshooting
> For detailed step-by-step fixes for every error: **`debug.md`**
> Match your error to a section using the Quick Reference table at the bottom of that file.

| Problem | debug.md section |
|---------|------------------|
| `Chrome not found` | §2 |
| Login fails / "Not logged in after 3 attempts" | §3 |
| Feed shows 0 tweets / infinity loading | §4 |
| NVIDIA API errors | §5 |
| `Cannot find module` / npm errors | §6 |
| `EACCES: permission denied` | §7 |
| `DevToolsActivePort file doesn't exist` | §8 |
| `error while loading shared libraries` | §9 |
| Script runs but likes/comments = 0 | §10 |
| Xvfb / DISPLAY errors | §13 |
| Nothing works | §16 — Full Reset |
---

### Infinity Loading Fix — All Techniques

X.com serves an empty feed shell when it detects a datacenter IP or headless Chrome fingerprint. Apply techniques in order — start with A, layer on more if still failing.

---

#### Fix A — Xvfb Virtual Display ⭐ Start here

Xvfb gives Chrome a fake screen so `--no-headless` works on VPS. Non-headless Chrome has a completely different browser fingerprint and bypasses the loading block in most cases.

```bash
sudo apt install -y xvfb

cat > ~/x-connect/run.sh << 'EOF'
#!/bin/bash
cd ~/x-connect/scripts
Xvfb :99 -screen 0 1920x1080x24 &
XVFB_PID=$!
export DISPLAY=:99
sleep 1
node x-feed-engage.js --no-headless --quota 100 --min-pause 25 --max-pause 55 --reply-back --rb-limit 20
kill $XVFB_PID 2>/dev/null
EOF
chmod +x ~/x-connect/run.sh

nohup ~/x-connect/run.sh > ~/x-connect/debug/vps-run-$(date +%Y%m%d-%H%M).log 2>&1 &
```

> Once Xvfb is set up, always use `--no-headless`. Never run headless on VPS.

---

#### Fix B — puppeteer-extra Stealth Plugin

The `puppeteer-extra-plugin-stealth` library patches 15+ additional detection vectors beyond what the manual `evaluateOnNewDocument` patches cover — including `iframe.contentWindow`, `toString()` spoofing, and Chrome runtime object completeness.

```bash
cd ~/x-connect
npm install puppeteer-extra puppeteer-extra-plugin-stealth
```

Then in `x-feed-engage.js`, replace the top require:
```js
// Replace:
const puppeteer = require('puppeteer-core');

// With:
const { addExtra } = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const puppeteerCore = require('puppeteer-core');
const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());
```

---

#### Fix C — Residential Proxy

Datacenter IPs (Hetzner, DigitalOcean, Vultr, etc.) are often flagged at X.com's CDN level regardless of browser fingerprint. A residential proxy routes all Chrome traffic through a home ISP IP.

1. Get a proxy — **Webshare.io** (free tier: 10 IPs), Oxylabs, Bright Data, IPRoyal
2. Add to `.env`:
```
PROXY_URL=http://user:pass@proxy-host:port
```
3. Add to `puppeteer.launch` args in `x-feed-engage.js`:
```js
...(process.env.PROXY_URL ? [`--proxy-server=${process.env.PROXY_URL}`] : []),
```

---

#### Fix D — Profile Warmup (pre-navigate before X.com)

A cold Chrome profile with no cache, no localStorage, and no history looks robotic. Pre-warm the profile directory by visiting neutral sites before hitting X.com. Add to `run.sh` before the node command:

```bash
DISPLAY=:99 google-chrome --no-sandbox \
  --user-data-dir=$HOME/.openclaw/x-profile-v2 \
  --disable-gpu --virtual-time-budget=5000 \
  "https://www.google.com" "https://www.reddit.com" 2>/dev/null
sleep 3
```

---

#### Fix E — Export Real Chrome Profile from Windows

The most natural profile is one that was actually used by a real human. Export your Windows Chrome profile and use it on the VPS — it carries real cookies, history, localStorage, and fingerprint state.

```bash
# On Windows, zip your Chrome profile (adjust path):
# C:\Users\admin\AppData\Local\Google\Chrome\User Data\Default
# → compress to profile.zip, upload to VPS

# On VPS:
mkdir -p ~/.openclaw/x-profile-v2
cd ~/.openclaw/x-profile-v2
unzip ~/profile.zip
```

Then make sure `USER_DATA_DIR` in `x-feed-engage.js` points to the directory containing the `Default` folder.

---

#### Fix F — CDP Stealth: Spoof Timezone & Geolocation

X.com's JS checks `Intl.DateTimeFormat().resolvedOptions().timeZone` and compares it against the request IP's geolocation. A mismatch (e.g. VPS in Germany but timezone set to UTC) is a detection signal. Set these via CDP after page creation:

```js
const client = await page.createCDPSession();

// Match timezone to your VPS/proxy location
await client.send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });

// Spoof geolocation to match
await client.send('Emulation.setGeolocationOverride', {
    latitude: 40.7128, longitude: -74.0060, accuracy: 100
});

await client.detach();
```

Add this block immediately after `const page = (await browser.pages())[0];` in `x-feed-engage.js`.

---

#### Fix G — Spoof Client Hints Headers (sec-ch-ua)

Chromium sends `sec-ch-ua` headers that reveal the browser version. Puppeteer's default value sometimes diverges from the User-Agent string, creating a detectable inconsistency. Set them via CDP:

```js
const client = await page.createCDPSession();
await client.send('Network.setExtraHTTPHeaders', {
    headers: {
        'sec-ch-ua': '"Chromium";v="132", "Google Chrome";v="132", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Accept-Language': 'en-US,en;q=0.9',
    }
});
await client.detach();
```

---

#### Fix H — Disable WebRTC (IP leak prevention)

WebRTC can leak the real VPS IP even when using a proxy, bypassing the proxy entirely for local IP discovery. Disable it via launch arg:

```js
'--disable-webrtc',
'--enforce-webrtc-ip-permission-check',
```

Add to the `args` array in `puppeteer.launch`.

---

#### Fix I — Spoof Additional Navigator APIs

Add these to the `evaluateOnNewDocument` block to cover remaining fingerprint vectors:

```js
// Battery API — headless Chrome has no battery; real browsers do
if (navigator.getBattery) {
    navigator.getBattery = () => Promise.resolve({
        charging: true, chargingTime: 0,
        dischargingTime: Infinity, level: 1.0,
        addEventListener: () => {}
    });
}

// Gamepad API — return empty array like a real desktop
if (navigator.getGamepads) {
    navigator.getGamepads = () => [null, null, null, null];
}

// Media devices — spoof camera/mic presence
if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    navigator.mediaDevices.enumerateDevices = () => Promise.resolve([
        { deviceId: 'default', kind: 'audioinput', label: '', groupId: 'default' },
        { deviceId: 'default', kind: 'audiooutput', label: '', groupId: 'default' },
    ]);
}

// AudioContext fingerprint noise
const origGetChannelData = AudioBuffer.prototype.getChannelData;
AudioBuffer.prototype.getChannelData = function(...args) {
    const data = origGetChannelData.apply(this, args);
    for (let i = 0; i < data.length; i += 100) {
        data[i] += Math.random() * 0.0000001;
    }
    return data;
};
```

---

#### Fix J — Rotate Chrome Profiles

Running the same profile repeatedly builds up a pattern X.com can track. Maintain 2–3 different `userDataDir` paths and rotate between runs:

```js
const PROFILES = [
    path.join(process.env.HOME, '.openclaw', 'x-profile-v2'),
    path.join(process.env.HOME, '.openclaw', 'x-profile-v3'),
    path.join(process.env.HOME, '.openclaw', 'x-profile-v4'),
];
const USER_DATA_DIR = PROFILES[Math.floor(Math.random() * PROFILES.length)];
```

---

#### Fix K — Font Fingerprint

Headless Chrome has very few installed fonts. Install common fonts on the VPS to match a real Windows/Mac browser:

```bash
sudo apt install -y \
  fonts-liberation \
  fonts-dejavu-core \
  fonts-freefont-ttf \
  ttf-mscorefonts-installer \
  fontconfig

sudo fc-cache -fv
```

---

#### Fix L — Mimic Real Chrome Launch Flags

Real Chrome launches with many additional flags that Puppeteer omits. Adding known Chrome startup flags makes the browser process harder to fingerprint at the OS level:

```js
'--enable-features=NetworkService,NetworkServiceInProcess',
'--disable-features=IsolateOrigins,site-per-process',
'--allow-running-insecure-content',
'--disable-web-security',
```

> Only add `--disable-web-security` in headless/automation contexts — it disables CORS.

---

#### Fix M — Session Cool-Down Between Runs

X.com tracks session velocity — too many logins in a short window triggers soft-ban (empty feed without error). Enforce a minimum gap between runs:

- Wait **at least 30 minutes** between sessions on the same account
- Never run more than **3 sessions per day** on a fresh account
- After a failed run (0 tweets after 50 scrolls), wait **2 hours** before retrying

---

#### Priority Order — Apply in This Sequence

| Step | Fix | Effect | Cost |
|------|-----|--------|------|
| 1 | A — Xvfb | Eliminates headless detection | Free |
| 2 | B — Stealth plugin | Patches 15+ remaining JS signals | Free |
| 3 | D — Profile warmup | Removes cold-start fingerprint | Free |
| 4 | F — CDP timezone | Fixes IP/timezone mismatch | Free |
| 5 | G — Client hints | Fixes UA/header inconsistency | Free |
| 6 | H — Disable WebRTC | Prevents real IP leak via WebRTC | Free |
| 7 | I — Navigator APIs | Covers battery/gamepad/audio | Free |
| 8 | K — Fonts | Normalises font fingerprint | Free |
| 9 | C — Residential proxy | Removes datacenter IP flag | ~$5/mo |
| 10 | E — Real Chrome profile | Most natural profile possible | Free |
| 11 | J — Profile rotation | Reduces per-profile tracking | Free |
| 12 | M — Session cool-down | Avoids velocity-based soft ban | Free |

---

### VPS vs Local — Key Differences

| | Local (Windows) | VPS (Ubuntu) |
|---|---|---|
| `--no-headless` | Use it (visible browser) | Use with Xvfb (`DISPLAY=:99`) |
| `--no-sandbox` | Not needed | Auto-added by script |
| Chrome path | Auto-detected from Program Files | `/usr/bin/google-chrome` |
| Kill command | `taskkill /F /IM node.exe` | `pkill node && pkill chrome` |
| Keep alive after disconnect | N/A | Use `nohup` or `screen` |
| Cron scheduling | Task Scheduler | `crontab -e` |
| Infinity loading fix | Usually not needed | Xvfb + optional proxy |
