# X-Connect VPS Debug Guide

Step-by-step troubleshooting for every error you can hit running `x-feed-engage.js` on an Ubuntu VPS.
Each section: **what the error looks like → why it happens → exact fix**.

---

## AGENT RULES

If an AI agent is reading this guide to help debug:

1. Do NOT create new scripts. Use only the existing scripts in scripts/.
2. Do NOT modify x-feed-engage.js unless the user explicitly says to.
3. Do NOT run arbitrary Node.js code beyond the one-liner diagnostics shown here.
4. Do NOT install new npm packages without being asked.
5. Follow sections in order. Copy commands exactly. Do not improvise.
6. Do NOT delete files without reading section 16 first and getting user confirmation.
7. Match error to section using the Quick Reference table at the bottom.

---

## Table of Contents

1. [How to Read the Logs](#1-how-to-read-the-logs)
2. [Chrome Not Found](#2-chrome-not-found)
3. [Login Failing — "Not logged in after 3 attempts!"](#3-login-failing--not-logged-in-after-3-attempts)
4. [Infinity Loading / 0 Tweets After Login](#4-infinity-loading--0-tweets-after-login)
5. [NVIDIA API Errors](#5-nvidia-api-errors)
6. [Node / npm Errors on First Run](#6-node--npm-errors-on-first-run)
7. [Permission Errors (EACCES)](#7-permission-errors-eacces)
8. [Chrome Crashes on Launch (DevToolsActivePort)](#8-chrome-crashes-on-launch-devtoolsactiveport)
9. [Missing Shared Libraries (libnss3, libgbm1, etc.)](#9-missing-shared-libraries-libnss3-libgbm1-etc)
10. [Script Runs But Engages 0 Tweets (Quota Logic)](#10-script-runs-but-engages-0-tweets-quota-logic)
11. [Replies Not Posting / Reply Box Won't Open](#11-replies-not-posting--reply-box-wont-open)
12. [Script Exits Mid-Run (Detached Frame / Stale Element)](#12-script-exits-mid-run-detached-frame--stale-element)
13. [Xvfb / DISPLAY Errors](#13-xvfb--display-errors)
14. [Progress File Corruption](#14-progress-file-corruption)
15. [How to Take a Manual Debug Screenshot](#15-how-to-take-a-manual-debug-screenshot)
16. [Full Reset — Start from Zero](#16-full-reset--start-from-zero)

---

## 1. How to Read the Logs

All logs go to `debug/x-feed-engage.log`. Every line has this format:

```
[2026-03-17T09:12:45.123Z] [INFO] Warming up session (profile browse)...
[2026-03-17T09:12:48.001Z] [WARN] No reply-prompt.md found, using inline fallback
[2026-03-17T09:12:55.002Z] [ERROR] Login check failed: TimeoutError: ...
```

### Live tail (follow as it runs)

```bash
tail -f ~/x-connect/debug/x-feed-engage.log
```

### Last 100 lines (after a run)

```bash
tail -100 ~/x-connect/debug/x-feed-engage.log
```

### Search for errors only

```bash
grep "ERROR\|WARN" ~/x-connect/debug/x-feed-engage.log | tail -50
```

### Check today's progress numbers

```bash
cat ~/x-connect/debug/feed-progress-$(date +%Y-%m-%d).json
```

Expected output when working:
```json
{
  "date": "2026-03-17",
  "liked": 12,
  "commented": 8,
  "skipped": 5,
  "errors": 0,
  "seenTweetIds": ["..."],
  "startedAt": "2026-03-17T09:00:00.000Z",
  "lastAction": "2026-03-17T09:45:00.000Z"
}
```

---

## 2. Chrome Not Found

### What it looks like

```
❌ Chrome not found. Install Google Chrome or set CHROME_PATH in .env
```

or the script just exits with no browser launching.

### Diagnose

```bash
which google-chrome
google-chrome --version
which chromium-browser
```

If all return empty or "not found", Chrome isn't installed.

### Fix

**Option A — Install Google Chrome (amd64 VPS):**
```bash
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" \
  | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update && sudo apt install -y google-chrome-stable
google-chrome --version
```

Expected: `Google Chrome 132.0.xxxx.xx`

**Option B — Install Chromium (ARM VPS / non-amd64):**
```bash
sudo apt install -y chromium-browser
chromium-browser --version
```

**Option C — Set CHROME_PATH manually in `.env`:**
```bash
which google-chrome   # get the full path
# → /usr/bin/google-chrome

# Add to .env:
echo "CHROME_PATH=/usr/bin/google-chrome" >> ~/x-connect/.env
```

The script reads `CHROME_PATH` from `.env` and uses it directly if set, skipping auto-detection.

---

## 3. Login Failing — "Not logged in after 3 attempts!"

### What it looks like in the log

```
[INFO] Navigating to x.com...
[INFO] Checking login status... (attempt 1/3)
[WARN] Not logged in after 3 attempts!
[ERROR] Login failed — aborting.
```

### Causes and fixes (try in order)

---

#### Cause A — Cookies are stale

The most common cause. The `auth_token` cookie has expired or been invalidated.

**Diagnose:**
```bash
node ~/x-connect/scripts/test-cookies.js
```

Expected output when valid: `Logged In elements found: true`
Broken output: `Logged In elements found: false` or timeout.

**Fix:**
1. On your **local Windows machine**, open Chrome and log into x.com
2. Install the **Cookie-Editor** browser extension
3. Go to x.com → Click Cookie-Editor → Export → "Export as JSON"
4. Copy the JSON
5. On the VPS, overwrite the file:

```bash
nano ~/x-connect/scripts/cookies.json
# Select all text (Ctrl+A), delete, paste the new JSON
# Save: Ctrl+O → Enter → Ctrl+X
```

Verify the key cookies are present:
```bash
node -e "
const c = require('./scripts/cookies.json');
['auth_token','ct0','twid'].forEach(n => {
  const found = c.find(x => x.name === n);
  console.log(n + ':', found ? 'FOUND (expires ' + new Date(found.expirationDate*1000).toISOString().slice(0,10) + ')' : 'MISSING ❌');
});
"
```

Run this from `~/x-connect/`. Expected:
```
auth_token: FOUND (expires 2026-09-12)
ct0: FOUND (expires 2026-09-12)
twid: FOUND (expires 2026-09-12)
```

---

#### Cause B — React page not finishing hydration (stuck spinner)

X.com's SPA never fully loads in pure headless. You see a loading spinner in debug screenshots but `waitForLogin()` times out at 45s.

**Diagnose:** Check for a screenshot in the debug folder:
```bash
ls ~/x-connect/debug/*.png | tail -5
```

If there's a `login-fail-*.png` or `feed-after-warmup-*.png`, download and view it:
```bash
# From your local machine:
scp user@vps-ip:~/x-connect/debug/login-fail-*.png .
```

If the screenshot shows a loading spinner, cookies are likely fine — it's a headless detection issue.

**Fix:** Switch to Xvfb + non-headless mode (see [Section 13](#13-xvfb--display-errors)).

---

#### Cause C — X.com blocked the session (soft-ban)

If you ran too many sessions in a short window, X.com's server-side checks serve a login wall even with valid cookies.

**Diagnose:** Screenshot shows the login form/phone verification, not the home feed.

**Fix:** Wait 2–4 hours before retrying. Do not run more than 3 sessions per day on the same account.

---

#### Cause D — Account requires phone/email verification

X.com added a checkpoint to the account.

**Diagnose:** Screenshot shows "Confirm your phone number" or similar.

**Fix:** Log in manually on your local browser, complete the verification, export fresh cookies, re-upload.

---

## 4. Infinity Loading / 0 Tweets After Login

### What it looks like

Login succeeds (you see `[INFO] Logged in!`) but then:
```
[INFO] Feed DOM check: {"articles":0,"primaryCol":true,"newTweetsBar":"no","title":"Home / X"}
[WARN] Feed empty after scroll cycle 10
[WARN] Feed empty after scroll cycle 20
...
[WARN] Feed still empty after 90 scroll cycles — refreshing
[WARN] Feed empty — aborting after max refresh attempts
```

### Why it happens

X.com detects the Puppeteer session as a bot (headless Chrome fingerprint, datacenter IP, or session velocity) and serves an empty feed shell — the page loads but no tweets render.

### Fix in priority order

---

#### Fix 1 — Use Xvfb (non-headless) ← DO THIS FIRST

```bash
sudo apt install -y xvfb
```

Create a run script:
```bash
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
```

Run it:
```bash
nohup ~/x-connect/run.sh > ~/x-connect/debug/vps-run-$(date +%Y%m%d-%H%M).log 2>&1 &
echo "Started PID: $!"
```

After ~60 seconds, check the feed DOM check line:
```bash
grep "Feed DOM check" ~/x-connect/debug/x-feed-engage.log | tail -3
```

Expected when working: `{"articles":4,"primaryCol":true,...}`
Still broken: `{"articles":0,...}` → continue to Fix 2.

---

#### Fix 2 — Install stealth plugin

```bash
cd ~/x-connect
npm install puppeteer-extra puppeteer-extra-plugin-stealth
```

Then edit `x-feed-engage.js` — replace line 26 (the puppeteer require):
```bash
nano ~/x-connect/scripts/x-feed-engage.js
# Find: const puppeteer = require('puppeteer-core');
# Replace with the 4 lines below, then save
```

Replace with:
```js
const { addExtra } = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const puppeteerCore = require('puppeteer-core');
const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());
```

Re-run via `~/x-connect/run.sh`.

---

#### Fix 3 — Check for datacenter IP block

Even with stealth, datacenter IPs (Hetzner, DigitalOcean, Vultr) are often flagged at the CDN level.

**Test if your IP is blocked:**
```bash
curl -I https://x.com/home
```

If you get `403 Forbidden` or a Cloudflare challenge page in the response headers, your IP is flagged.

**Fix A — Residential proxy (cheapest: Webshare.io free tier, 10 IPs):**
```bash
# Add to .env:
echo "PROXY_URL=http://user:pass@proxy-host:port" >> ~/x-connect/.env
```

Then in `x-feed-engage.js`, in the `puppeteer.launch` args array, add:
```js
...(process.env.PROXY_URL ? [`--proxy-server=${process.env.PROXY_URL}`] : []),
```

**Fix B — If you can't get a proxy, try a different VPS provider** (OVH, Contabo, and smaller providers are less likely to be in X's blocklist than Hetzner/DO/Vultr).

---

#### Fix 4 — Check session velocity (too many runs)

If you ran 3+ sessions today:
```bash
grep "Logged in\|Login failed\|aborting" ~/x-connect/debug/x-feed-engage.log | grep $(date +%Y-%m-%d)
```

If you see 3+ "Logged in!" lines in one day, X.com may have applied a soft-ban. Wait 2 hours.

---

## 5. NVIDIA API Errors

### Error A — API key not set

```
❌ NVIDIA_API_KEY not set in .env
```

**Fix:**
```bash
cat ~/x-connect/.env
# Should show: NVIDIA_API_KEY=nvapi-xxxxx

# If missing:
echo "NVIDIA_API_KEY=nvapi-your-key-here" > ~/x-connect/.env
```

Verify the key is readable by Node:
```bash
cd ~/x-connect && node -e "require('dotenv').config({path:'.env'}); console.log(process.env.NVIDIA_API_KEY ? 'KEY LOADED ✅' : 'MISSING ❌')"
```

---

### Error B — API timeout / model slow

```
[WARN] LLM call timed out (30s) — skipping reply for tweet ...
```

The script uses `moonshotai/kimi-k2-instruct` with a 30s hard timeout and 1 retry. If NVIDIA's API is overloaded, replies are skipped but the run continues (likes still happen).

**Diagnose:**
```bash
grep "LLM\|NVIDIA\|timeout\|model" ~/x-connect/debug/x-feed-engage.log | tail -20
```

**If it's consistent (every tweet fails):**

Test the API key directly:
```bash
cd ~/x-connect && node -e "
require('dotenv').config({path:'.env'});
const OpenAI = require('openai').default || require('openai');
const client = new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: 'https://integrate.api.nvidia.com/v1' });
client.chat.completions.create({
  model: 'moonshotai/kimi-k2-instruct',
  messages: [{ role: 'user', content: 'Say OK' }],
  max_tokens: 5
}).then(r => console.log('API OK:', r.choices[0].message.content))
  .catch(e => console.error('API ERROR:', e.message));
"
```

Expected: `API OK: OK`

If you get `401 Unauthorized`: your key is invalid or expired — get a new one from [build.nvidia.com](https://build.nvidia.com).
If you get `429 Too Many Requests`: you've hit your rate limit — wait or upgrade the NVIDIA tier.
If you get a network timeout: the VPS can't reach the NVIDIA API — check firewall/DNS:

```bash
curl -s https://integrate.api.nvidia.com/ | head -5
```

---

### Error C — Model not available

```
[ERROR] LLM error: 404 model not found: moonshotai/kimi-k2-instruct
```

The model was removed from NVIDIA's catalog.

**Fix:** Change `NVIDIA_MODEL` at the top of `x-feed-engage.js`. Currently set to `moonshotai/kimi-k2-instruct`. Try these alternatives (all available on NVIDIA NIM free tier):

```
meta/llama-3.1-8b-instruct
mistralai/mistral-7b-instruct-v0.3
microsoft/phi-3-mini-128k-instruct
```

Edit the file:
```bash
sed -i "s|moonshotai/kimi-k2-instruct|meta/llama-3.1-8b-instruct|g" ~/x-connect/scripts/x-feed-engage.js
```

---

## 6. Node / npm Errors on First Run

### Error A — Node not installed / wrong version

```
node: command not found
```

or:

```
SyntaxError: Cannot use import statement outside a module
```

The script requires **Node.js v18 or higher** (uses optional chaining, async/await throughout).

**Check version:**
```bash
node --version
# Expected: v20.x.x or v18.x.x
```

**Install Node 20:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # should print v20.x.x
```

---

### Error B — puppeteer-core not found

```
Error: Cannot find module 'puppeteer-core'
```

**Fix:**
```bash
cd ~/x-connect
npm install
```

If `package.json` is missing:
```bash
ls ~/x-connect/package.json
```

If it doesn't exist, you need to re-upload the skill folder from your local machine:
```bash
# From local Windows machine:
scp -r ~/Desktop/AgentZero/skills/x-connect user@vps-ip:~/x-connect
```

Then on VPS:
```bash
cd ~/x-connect && npm install
```

---

### Error C — openai package not found

```
Error: Cannot find module 'openai'
```

```bash
cd ~/x-connect && npm install openai
```

---

### Error D — dotenv not found

```
Error: Cannot find module 'dotenv'
```

```bash
cd ~/x-connect && npm install dotenv
```

---

### Reinstall all dependencies cleanly

If multiple modules are missing:
```bash
cd ~/x-connect
rm -rf node_modules package-lock.json
npm install
```

---

## 7. Permission Errors (EACCES)

### Error A — Can't write to debug/

```
[ERROR] EACCES: permission denied, open '/root/x-connect/debug/x-feed-engage.log'
```

**Fix:**
```bash
chmod -R 755 ~/x-connect/debug
# If the directory doesn't exist:
mkdir -p ~/x-connect/debug && chmod 755 ~/x-connect/debug
```

---

### Error B — Can't write user data dir

```
[ERROR] EACCES: permission denied, mkdir '/root/.openclaw/x-profile-v2'
```

**Fix:**
```bash
mkdir -p ~/.openclaw/x-profile-v2
chmod -R 755 ~/.openclaw
```

---

### Error C — Can't read cookies.json

```
[ERROR] ENOENT: no such file or directory, open '.../scripts/cookies.json'
```

The file doesn't exist on the VPS.

**Fix — upload from local:**
```bash
# From local Windows machine:
scp ~/Desktop/AgentZero/skills/x-connect/scripts/cookies.json user@vps-ip:~/x-connect/scripts/cookies.json
```

**Verify it's there:**
```bash
ls -la ~/x-connect/scripts/cookies.json
node -e "const c = require('./scripts/cookies.json'); console.log('Cookies loaded:', c.length, 'entries')"
```

---

## 8. Chrome Crashes on Launch (DevToolsActivePort)

### What it looks like

```
Error: Failed to launch the browser process!
...
DevToolsActivePort file doesn't exist
```

Chrome launched but immediately crashed before opening a DevTools port.

### Step 1 — Test Chrome alone

```bash
google-chrome --headless --no-sandbox --dump-dom https://example.com 2>&1 | head -30
```

This runs Chrome directly. Any crash output will show here.

### Step 2 — Common causes and fixes

**Missing `--no-sandbox` (running as root):**

Chrome refuses to run as root without `--no-sandbox`. The script adds this automatically on Linux, but verify:
```bash
grep "no-sandbox" ~/x-connect/scripts/x-feed-engage.js
```

Should see it in the Linux args block. If missing, the script's platform detection failed.

**Force it as an env var workaround:**
```bash
export PUPPETEER_CHROMIUM_FLAGS="--no-sandbox --disable-setuid-sandbox"
```

**Shared memory too small (`/dev/shm`):**
```bash
df -h /dev/shm
```

If it shows less than 64MB free:
```bash
# Add to launch args in x-feed-engage.js:
'--disable-dev-shm-usage',
```

(This is already in the script — verify it's there):
```bash
grep "disable-dev-shm" ~/x-connect/scripts/x-feed-engage.js
```

**GPU init failure:**

Verify `--disable-gpu` is in the args (it is by default in the script):
```bash
grep "disable-gpu" ~/x-connect/scripts/x-feed-engage.js
```

---

## 9. Missing Shared Libraries (libnss3, libgbm1, etc.)

### What it looks like

```
google-chrome: error while loading shared libraries: libnss3.so: cannot open shared object file
```

or:

```
/usr/bin/google-chrome: error while loading shared libraries: libgbm.so.1
```

### Fix — install all Chrome dependencies at once

```bash
sudo apt install -y \
  libnss3 \
  libatk-bridge2.0-0 \
  libdrm2 \
  libxkbcommon0 \
  libgbm1 \
  libasound2 \
  libxss1 \
  libxtst6 \
  libx11-xcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxi6 \
  libxrandr2 \
  libpango-1.0-0 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libgdk-pixbuf2.0-0 \
  libgtk-3-0
```

After installing, test Chrome:
```bash
google-chrome --headless --no-sandbox --dump-dom https://example.com 2>&1 | head -5
```

Expected first line: `<!doctype html>` or `<html>` — not an error.

---

## 10. Script Runs But Engages 0 Tweets (Quota Logic)

### What it looks like

The script runs, login succeeds, tweets appear in the log, but `liked: 0, commented: 0` in the progress file.

### Cause A — Daily quota already hit from a previous run today

```bash
cat ~/x-connect/debug/feed-progress-$(date +%Y-%m-%d).json
```

If `liked + commented >= DAILY_QUOTA (default 150)`, the script exits immediately after loading progress.

**Fix:**
```bash
# Delete today's progress to reset the quota counter
rm ~/x-connect/debug/feed-progress-$(date +%Y-%m-%d).json
```

Or use `--no-resume` flag to ignore saved progress:
```bash
node x-feed-engage.js --quota 100 --no-resume --min-pause 25 --max-pause 55
```

---

### Cause B — All tweets are older than max-age

Default `MAX_AGE_MIN = 180` (3 hours). If you're running at a quiet time and no tweets in the feed are less than 3 hours old, every tweet gets skipped.

**Diagnose:**
```bash
grep "SKIP\|too old\|age" ~/x-connect/debug/x-feed-engage.log | tail -20
```

**Fix:** Increase max age:
```bash
node x-feed-engage.js --quota 100 --max-age 720 --min-pause 25 --max-pause 55
# 720 minutes = 12 hours
```

---

### Cause C — Account follows very few people (sparse feed)

If the account is new and follows < 20 people, the home feed will be nearly empty.

**Fix:** Use `--list` with a curated X list URL instead of the home feed:
```bash
node x-feed-engage.js --list "https://x.com/i/lists/YOUR_LIST_ID" --quota 100 --min-pause 25 --max-pause 55
```

Replace `YOUR_LIST_ID` with the numeric ID from a public X list.

---

### Cause D — Dry run mode active

Check if `--dry-run` is in the command:
```bash
grep "dry.run\|DRY_RUN" ~/x-connect/debug/x-feed-engage.log | head -5
```

Remove `--dry-run` from the command if present.

---

## 11. Replies Not Posting / Reply Box Won't Open

### What it looks like

```
[WARN] Reply box not found — skipping reply
```

or tweet navigated to but reply box never opens.

### Cause A — Tweet page didn't load

```bash
grep "Navigating to tweet\|reply box" ~/x-connect/debug/x-feed-engage.log | tail -20
```

If "Navigating to tweet" appears but no "Reply box found" after it, the tweet page timed out.

**Fix:** X.com may be rate-limiting page loads. Increase `--min-pause` and `--max-pause`:
```bash
node x-feed-engage.js --quota 50 --min-pause 60 --max-pause 120 --reply-back --rb-limit 10
```

---

### Cause B — `--reply-back` flag missing

Replies only happen when `--reply-back` is passed. Without it, the script likes only.

**Fix:** Add `--reply-back` to the command:
```bash
node x-feed-engage.js --quota 100 --min-pause 25 --max-pause 55 --reply-back --rb-limit 20
```

---

### Cause C — `reply-prompt.md` missing

```bash
ls ~/x-connect/reply-prompt.md
```

If missing, the script falls back to the inline hardcoded prompt. This is fine — replies still generate. But if you want the custom prompt:

```bash
# Upload from local:
scp ~/Desktop/AgentZero/skills/x-connect/reply-prompt.md user@vps-ip:~/x-connect/reply-prompt.md
```

---

## 12. Script Exits Mid-Run (Detached Frame / Stale Element)

### What it looks like

```
[WARN] Detached Frame — skipping tweet
```

or:

```
[ERROR] Execution context was destroyed, most likely because of a navigation.
```

### Why it happens

A page navigation happened while the script was mid-interaction with a DOM element. Non-fatal — the script catches these and continues.

**These are not real errors.** They appear when:
- Chrome navigated away from the page mid-action
- A tweet was deleted while the script was processing it
- Rate-limit redirect happened

**If the script is still running:** ignore these warnings.
**If the script exited:** look for a hard crash line above the detached frame warning:
```bash
grep -A5 "Detached\|context was destroyed" ~/x-connect/debug/x-feed-engage.log | tail -30
```

---

### Script exits with "process killed" or no log entry

The script was killed externally (OOM, manual kill, cron timeout).

**Check memory:**
```bash
free -h
```

If available memory is < 200MB, Chrome OOM-killed itself.

**Fix:**
```bash
# Add swap space (1GB):
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
# Make it permanent:
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 13. Xvfb / DISPLAY Errors

### Error A — DISPLAY not set

```
[ERROR] No usable sandbox, Xvfb or DISPLAY required
```

or Chrome fails silently when `--no-headless` is passed.

**Diagnose:**
```bash
echo $DISPLAY
# Should print :99 if Xvfb is running
```

**Check if Xvfb is running:**
```bash
pgrep -a Xvfb
```

If empty, Xvfb isn't running.

**Fix — Start Xvfb manually:**
```bash
sudo apt install -y xvfb
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99
```

Then run the script in the same terminal session (DISPLAY must be exported).

**Better fix — always use `run.sh`** which handles Xvfb automatically:
```bash
~/x-connect/run.sh
```

---

### Error B — Xvfb: No such file or directory / failed to bind socket

```
_XSERVTransSocketUNIXCreateListener: ...SocketCreateListener() failed
Xvfb: failed to bind socket
```

Port `:99` is already in use by a zombie Xvfb process.

**Fix:**
```bash
pkill Xvfb
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99
```

---

### Error C — Fonts not rendering / garbled text in screenshots

```bash
sudo apt install -y \
  fonts-liberation \
  fonts-dejavu-core \
  fonts-freefont-ttf \
  fontconfig
sudo fc-cache -fv
```

---

## 14. Progress File Corruption

### What it looks like

```
[WARN] Failed to parse progress file — starting fresh
```

or the script starts from 0 every time even with `--resume`.

**Diagnose:**
```bash
cat ~/x-connect/debug/feed-progress-$(date +%Y-%m-%d).json
```

If the output is malformed JSON (truncated, missing braces), it's corrupted.

**Fix — delete and start fresh:**
```bash
rm ~/x-connect/debug/feed-progress-$(date +%Y-%m-%d).json
```

The script will create a new one on next run.

**Fix — if all progress files seem broken:**
```bash
ls ~/x-connect/debug/feed-progress-*.json
# Check sizes:
du -sh ~/x-connect/debug/feed-progress-*.json
```

Files of 0 bytes are always corrupt. Delete them:
```bash
find ~/x-connect/debug -name "feed-progress-*.json" -empty -delete
```

---

## 15. How to Take a Manual Debug Screenshot

If you need to see what the browser is actually showing during a run, you can add a one-line screenshot to any point in the script.

The script already takes screenshots on errors. They land in:
```bash
ls ~/x-connect/debug/*.png
```

**Download a screenshot to your local machine for viewing:**
```bash
# Run from your local Windows machine (Git Bash / WSL):
scp user@vps-ip:~/x-connect/debug/feed-after-warmup-*.png ~/Desktop/
```

Then open from your Desktop.

**The key screenshot to check is `feed-after-warmup-*.png`** — it shows the state of the feed immediately after the warmup navigation. If it shows tweets, the script is working. If it shows a spinner or empty white page, the stealth/Xvfb fix hasn't worked yet.

---

## 16. Full Reset — Start from Zero

Use this when nothing else works and you want a completely clean state.

```bash
# 1. Kill everything
pkill -f x-feed-engage.js 2>/dev/null
pkill node 2>/dev/null
pkill chrome 2>/dev/null
pkill Xvfb 2>/dev/null
rm -f /tmp/.X99-lock

# 2. Clear Chrome profile (forces fresh fingerprint)
rm -rf ~/.openclaw/x-profile-v2
mkdir -p ~/.openclaw/x-profile-v2

# 3. Clear debug files (logs and progress)
rm -f ~/x-connect/debug/*.log
rm -f ~/x-connect/debug/feed-progress-*.json
# Keep screenshots for reference: do NOT delete *.png yet

# 4. Clear replied cache (so you can re-engage previously-seen tweets)
rm -f ~/x-connect/debug/replied.json

# 5. Reinstall node modules
cd ~/x-connect
rm -rf node_modules package-lock.json
npm install

# 6. Verify .env is correct
cat ~/x-connect/.env
# Should show NVIDIA_API_KEY=nvapi-...

# 7. Verify cookies are valid
cd ~/x-connect && node -e "
const c = require('./scripts/cookies.json');
['auth_token','ct0','twid'].forEach(n => {
  const found = c.find(x => x.name === n);
  console.log(n + ':', found ? 'OK (' + new Date(found.expirationDate*1000).toISOString().slice(0,10) + ')' : 'MISSING ❌');
});
"

# 8. Start fresh with Xvfb
sudo apt install -y xvfb
pkill Xvfb; sleep 1
Xvfb :99 -screen 0 1920x1080x24 &
sleep 2
export DISPLAY=:99

# 9. Run with minimal quota to test
cd ~/x-connect/scripts
node x-feed-engage.js --no-headless --quota 5 --min-pause 25 --max-pause 55 --reply-back --rb-limit 2

# 10. Check outcome
grep "Feed DOM check\|Logged in\|liked\|commented\|ERROR" ~/x-connect/debug/x-feed-engage.log | tail -20
```

If step 9 shows `articles > 0` in the Feed DOM check and `[INFO] Liked` entries appear — everything is working. Scale up quota and switch to background via `nohup`:

```bash
nohup ~/x-connect/run.sh > ~/x-connect/debug/vps-run-$(date +%Y%m%d-%H%M).log 2>&1 &
echo "Running as PID $!"
```

---

## Quick Reference — Error → Section

| Error message | Section |
|---|---|
| `Chrome not found` | §2 |
| `Not logged in after 3 attempts` | §3 |
| `Feed DOM check: {"articles":0}` | §4 |
| `NVIDIA_API_KEY not set` | §5 |
| `Cannot find module 'puppeteer-core'` | §6 |
| `EACCES: permission denied` | §7 |
| `DevToolsActivePort file doesn't exist` | §8 |
| `error while loading shared libraries` | §9 |
| `liked: 0, commented: 0` in progress file | §10 |
| `Reply box not found — skipping` | §11 |
| `Detached Frame` warnings | §12 |
| `No usable sandbox` / DISPLAY errors | §13 |
| Progress file parse error / resets every run | §14 |
| Want to see what browser shows | §15 |
| Nothing works, start over | §16 |
