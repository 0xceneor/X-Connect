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
| "Run a stealth batch" / "Engage slowly" | `node x-feed-engage.js --quota 50 --min-pause 420 --max-pause 720` | Uses longer wait times between actions to mimic slow human pacing. |
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
node x-feed-engage.js --min-pause 25 --max-pause 55    # fast (human-aggressive)
node x-feed-engage.js --min-pause 120 --max-pause 300  # moderate
node x-feed-engage.js --min-pause 420 --max-pause 720  # stealth (7–12 min, default)
```

> **Default when no flags are passed: 420–720 seconds (7–12 minutes)**
> The script picks a random value in your range after each completed engagement action (like + reply). This pause is logged as `💤 Xs pause...`

| Pace profile | `--min-pause` | `--max-pause` | Use case |
|---|---|---|---|
| Fast / testing | `10` | `30` | Dev testing only — risky for real accounts |
| Human-aggressive | `25` | `55` | Active campaign, quota to fill quickly |
| Moderate | `120` | `300` | Balanced — reasonable throughput |
| Stealth (default) | `420` | `720` | New/valuable accounts — mimics human reading |
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

This section documents real usage patterns observed in practice. Agents should use these as defaults when the user gives a short or ambiguous instruction.

### Standard run command
The user always runs list-based engagement, not the home feed, in non-headless mode with fast pacing:
```bash
node x-feed-engage.js --list <URL> --quota 100 --min-pause 25 --max-pause 55 --no-headless
```
When the user says "run a batch" or "engage" and provides a list URL, use this command exactly — do not add `--reply-back` or change the pacing unless explicitly asked.

### Headless mode
Always use `--no-headless`. Headless mode has repeatedly failed to authenticate even with valid cookies. Non-headless is the reliable default for this setup.

### Quota
Always 100 unless the user specifies otherwise.

### Pacing
Always `--min-pause 25 --max-pause 55` (fast / human-aggressive). The user prioritises throughput over stealth pacing.

### Cookies
The user provides fresh cookies by pasting the JSON array directly into the chat. When this happens:
1. Write the pasted JSON directly to `scripts/cookies.json` (overwrite completely)
2. Immediately relaunch the batch — no need to run `test-cookies.js` first

### Switching lists mid-session
When the user asks to switch to a different list:
1. Kill all running Chrome and Node processes: `powershell -Command "Get-Process chrome,node -ErrorAction SilentlyContinue | Stop-Process -Force"`
2. Verify they're gone: `powershell -Command "Get-Process chrome,node -ErrorAction SilentlyContinue"` — expect exit code 1 (no processes found)
3. Then launch the new batch

> **Use PowerShell to kill, not `taskkill`.** `taskkill` from bash can silently fail to release the Chrome profile lock (`~/.openclaw/x-profile-v2`), causing "browser already running for userDataDir" on the next launch.

### Monitoring
The user does **not** want to monitor batches. Run in background. Only report back if the batch fails — read the output file and diagnose before reporting.

### On failure
1. Read the output file immediately
2. Check `debug/feed-not-logged-in-<timestamp>.png` if the error is login-related
3. Diagnose root cause and fix or explain — do not just report the error message

### Documentation
The user expects this file to be kept up to date as new patterns, errors, or preferences are observed. Update proactively after any meaningful session.

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
