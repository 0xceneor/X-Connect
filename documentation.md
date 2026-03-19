# x-connect — Documentation

> Tri-mode X (Twitter) engagement system. Supports Automation (Puppeteer), Hybrid (Puppeteer read + API write), and full API modes. Classifies posts, generates AI replies, and manages daily quotas.

---

## Engagement Modes

| Mode | Read | Write | Cost | Script |
|------|------|-------|------|--------|
| **Automation** | Puppeteer (browser) | Puppeteer (keyboard) | Free | `x-feed-engage.js` |
| **Hybrid** | Puppeteer (browser) | X API v2 | Free tier (1,500/mo writes) | `x-api-engage.js --mode hybrid` |
| **API** | X API v2 | X API v2 | Paid credits | `x-api-engage.js --mode api` |

---

## Directory Structure

```
x-connect/
├── .env                              # API keys (NVIDIA_API_KEY, NEWS_API_KEY, MASTER_API_KEY)
├── .env.example                      # Environment variable template
├── .gitignore
├── package.json                      # puppeteer-core, twitter-api-v2, express, openai, dotenv
│
├── ── Documentation ──
├── README.md                         # Quick-start overview
├── SKILL.md                          # Agent skill manifest
├── documentation.md                  # ← this file — full technical reference
├── operations.md                     # Step-by-step VPS/local run guide
├── setup.md                          # First-time setup instructions
├── debug.md                          # VPS debug guide — 16-section error reference
├── user-behavior.md                  # User command lookup tables (start/stop/status)
├── changelog.md                      # Version history and change log
├── context.md                        # Pitch context — API products, Base integration scope
├── reply-pipeline.md                 # Reply generation pipeline deep-dive
├── reply-prompt.md                   # @aptum_ persona & reply rules
├── showcase.md                       # Feature showcase / demo writeup
├── updatedlog.md                     # Running notes on updates
│
├── ── Web Dashboards ──
├── dashboard.html                    # Static engagement dashboard (served by api-server.js)
├── dashboard.php                     # PHP dashboard for cPanel/shared hosting deployments
├── showcase.php                      # PHP showcase page
│
├── scripts/
│   ├── engage-core.js                # Shared AI pipeline (25 exports)
│   ├── x-feed-engage.js              # Automation engine (Puppeteer only)
│   ├── x-api-engage.js               # API + Hybrid engine
│   ├── x-api-test.js                 # API test utility
│   ├── news.js                       # NewsAPI enrichment module
│   ├── api-server.js                 # REST API server (multi-tenant, Express)
│   ├── instance-manager.js           # Child process manager for multi-client sessions
│   ├── setup-client.js               # CLI tool to onboard a new client
│   ├── test-cookies.js               # Cookie validation utility (Puppeteer)
│   ├── x-analytics-scraper.js        # X analytics page scraper
│   ├── stats.js                      # Analytics receiver (Node HTTP server)
│   ├── engagement-bait-filter.md     # SKIP/PASS/SHILL classification guide
│   ├── cookies.json                  # X.com session cookies (Puppeteer)
│   ├── cookies.example.json          # Cookie format template
│   ├── credentials.json              # X API OAuth credentials
│   └── credentials.example.json      # OAuth credentials template
│
├── config/
│   └── cookies.json                  # Alternate/global cookies config
│
├── clients/                          # Per-client isolated data
│   └── <client-id>/
│       ├── config.json               # Client's API key + default settings
│       ├── credentials.json          # Client's X API OAuth keys
│       ├── cookies.json              # Client's X session cookies (optional)
│       ├── engage.log                # Client's activity log
│       ├── replied.json              # Client's dedup registry (optional)
│       └── feed-progress-*.json      # Client's daily counters
│
└── debug/                            # Default account data
    ├── feed-progress-YYYY-MM-DD.json
    ├── replied.json
    ├── replyback-seen.json
    └── x-feed-engage.log
```

---

## Core Scripts

### 0. `engage-core.js` — Shared AI Pipeline

Reusable module containing all AI logic, shared by both engines. Supports per-client data isolation via `init({ dataDir })`.

**Key exports:** `callModel()`, `classifyTweet()`, `generateReply()`, `proofreadReply()`, `cleanReply()`, `describeImages()`, `fetchDuneContext()`, `fetchNewsContext()`, `getEngageRate()`, `isLikelyBot()`, `generateReplyBack()`, `loadProgress()`, `saveProgress()`, `loadReplied()`, `saveReply()`

---

### 1. `x-feed-engage.js` — Automation Engine (Puppeteer)

Browser-based engine. Scrolls the X feed, classifies tweets, generates replies, and posts via keyboard shortcuts. **No API credits needed.**

#### Usage

```bash
# Basic — home feed, default settings
node x-feed-engage.js

# Full options
node x-feed-engage.js \
  --quota 100 \           # Daily engagement limit (default: 150)
  --max-age 180 \         # Max tweet age in minutes (default: 180)
  --min-pause 25 \        # Min seconds between actions (default: 25)
  --max-pause 55 \        # Max seconds between actions (default: 60)
  --list URL \            # Engage from an X list instead of home feed
  --reply-back \          # Enable reply-back phase (respond to our notifications)
  --rb-limit 20 \         # Max reply-backs per session
  --like-only \           # Skip commenting, only like
  --dry-run \             # Preview mode, no actual actions
  --verbose               # Extra logging
```

#### Pipeline (per tweet)

```
┌─────────────┐
│  Scroll Feed │ ← Extracts tweets from DOM, filters by age/dupe
└──────┬──────┘
       ▼
┌──────────────┐
│   Classify    │ ← SKIP (bait) / PASS (genuine) / SHILL (mention $A)
└──────┬───────┘
       ▼
┌──────────────┐     ┌───────────┐     ┌───────────┐
│  Vision (opt)│ ──▸ │ News (opt)│ ──▸ │ Dune (opt)│
│ Describe imgs│     │ Headlines │     │ On-chain  │
└──────┬───────┘     └─────┬─────┘     └─────┬─────┘
       └───────────────────┴───────────────────┘
                           ▼
                  ┌────────────────┐
                  │ Generate Reply  │ ← NVIDIA Kimi-K2 model
                  └────────┬───────┘
                           ▼
                  ┌────────────────┐
                  │   Proofread     │ ← Grammar, facts, tone check
                  └────────┬───────┘
                           ▼
                  ┌────────────────┐
                  │  Clean Reply    │ ← Strip competing tickers, fix formatting
                  └────────┬───────┘
                           ▼
                  ┌────────────────┐
                  │  Like + Post    │ ← Keyboard shortcuts (L to like, R to reply)
                  └────────────────┘
```

---

### 1b. `x-api-engage.js` — API + Hybrid Engine

Node.js engine supporting two modes:
- **API mode** — Full API read + write (requires paid credits for reads)
- **Hybrid mode** — Puppeteer reads + API writes (free tier for writes)

#### Usage

```bash
# API mode (business clients, paid credits)
node x-api-engage.js --mode api --quota 50

# API search-based engagement
node x-api-engage.js --mode api --search "crypto" --quota 30

# Hybrid mode (mid-tier, free writes)
node x-api-engage.js --mode hybrid --quota 100 --min-pause 25 --max-pause 55

# Per-client isolation
node x-api-engage.js --mode hybrid --client-id acme --credentials ./clients/acme/keys.json

# Dry run
node x-api-engage.js --mode api --dry-run --verbose
```

#### Key Differences from Automation

| Feature | Automation | API/Hybrid |
|---------|------------|------------|
| Browser needed | Yes | Hybrid: Yes, API: No |
| Selector breakage risk | Yes | No (API calls) |
| Login/cookies | Required | OAuth tokens |
| Writing method | Keyboard simulation | API calls |
| Rate limits | X's UI limits | 1,500 writes/mo (free) |
| Per-client support | No | Yes |
| Search engagement | No | Yes (API mode) |

#### `x-api-test.js` — API Test Utility

```bash
node x-api-test.js me              # Verify auth
node x-api-test.js tweet "text"     # Post a tweet
node x-api-test.js like <id>        # Like a tweet
node x-api-test.js reply <id> "text"  # Reply to a tweet
node x-api-test.js search "query"   # Search tweets (needs credits)
node x-api-test.js timeline         # Home timeline (needs credits)
node x-api-test.js mentions         # Recent mentions (needs credits)
```

#### Key Functions

| Function | Purpose |
|----------|---------|
| `callModel()` | Calls NVIDIA NIM API via OpenAI SDK with streaming |
| `describeImages()` | Vision model describes tweet images (charts, memes, etc.) |
| `classifyTweet()` | 5-line classifier: signal, topic, tone, intent, replyStyle |
| `fetchDuneContext()` | Pulls on-chain data from Dune Analytics for crypto tweets |
| `generateReply()` | Builds context-rich prompt → generates reply |
| `proofreadReply()` | QA pass for grammar, coherence, factual accuracy |
| `cleanReply()` | Strips competing tickers, blocked coin names, markdown, em dashes |
| `extractTweetsFromPage()` | DOM scraper — extracts tweets with author, text, age, images |
| `replyBackPhase()` | Checks notifications, replies to people who replied to us |
| `isLikelyBot()` | Filters bot/spam accounts from reply-back candidates |

#### Engagement Rates

Engagement probability varies by topic:

| Topic | Engage Rate |
|-------|-------------|
| crypto / defi / web3 | 95% |
| tech / ai | 85% |
| finance / business | 75% |
| politics / religion | 10% |
| other | 60% |
| shilling intent | 90% |

#### Anti-Detection Features

- `ignoreDefaultArgs: ['--enable-automation']` — removes automation flag
- `navigator.webdriver` overridden to `undefined`
- Updated user agent (Chrome 131)
- No sandbox/setuid flags (clean on Windows)

#### Shill Filter (cleanReply)

The `cleanReply()` function strips:
- All `$TICKERS` except `$A`
- Competing chain/coin names: Cardano, ADA, Solana, SOL, Polkadot, DOT, Avalanche, AVAX, XRP, Ripple, Tron, TRX, BNB, Dogecoin, DOGE, Shiba, SHIB, Litecoin, LTC, Toncoin, TON, Cosmos, ATOM, NEAR, Algorand, ALGO, Fantom, FTM, Hedera, HBAR, SUI, Aptos, APT, SEI, Injective, INJ, Kaspa, KAS
- Markdown formatting (`**bold**`, `_italic_`)
- Em dashes (→ comma)
- Model prefixes ("Reply:", "Here's my reply:")
- Stale year references (2024/2025 → 2026)

---

### 1c. `api-server.js` — REST API Server (Multi-Tenant)

Express server that exposes the engagement engine over HTTP. Enables remote session management, per-client credential upload, and log streaming without SSH access.

#### Usage

```bash
node scripts/api-server.js              # Default port 3000
node scripts/api-server.js --port 8080  # Custom port
```

Requires `MASTER_API_KEY` in `.env`. If unset, a session-only key is generated and printed at startup.

#### Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/clients/register` | Master | Register a new client |
| `POST` | `/api/clients/:id/credentials` | Master or client | Upload X API keys |
| `POST` | `/api/clients/:id/cookies` | Master or client | Upload session cookies |
| `POST` | `/api/sessions/start` | Master or client | Start engagement session |
| `POST` | `/api/sessions/stop` | Master or client | Stop engagement session |
| `GET` | `/api/sessions/status` | Master or client | Get session status |
| `GET` | `/api/sessions/list` | Master | List all sessions |
| `GET` | `/api/clients/:id/logs` | Master or client | Get recent log lines |
| `GET` | `/api/clients/:id/stats` | Master or client | Get today's engagement stats |
| `GET` | `/api/clients` | Master | List all registered clients |
| `GET` | `/api/health` | Public | Health check |
| `GET` | `/` or `/dashboard` | Public | Serve dashboard.html |

**Auth:** `Authorization: Bearer <api-key>` header required on all non-public endpoints.

---

### 1d. `instance-manager.js` — Child Process Manager

Internal module used by `api-server.js`. Spawns and tracks per-client `x-api-engage.js` (or `x-feed-engage.js`) child processes. Handles stdout/stderr buffering, graceful shutdown, and crash detection.

Not intended to be run directly — required by `api-server.js`.

**Key exports:** `start(clientId, opts)`, `stop(clientId)`, `getStatus(clientId)`, `getRecentOutput(clientId, lines)`, `listAll()`, `stopAll()`

Max concurrent sessions controlled by `MAX_INSTANCES` env var (default: 10).

---

### 1e. `setup-client.js` — Client Onboarding CLI

CLI tool to create a new client directory, generate an API key, and optionally copy credentials — without needing the API server to be running.

```bash
node scripts/setup-client.js --id acme --name "Acme Corp"
node scripts/setup-client.js --id acme --name "Acme Corp" --credentials ./keys.json
```

Creates `clients/<id>/config.json` with a generated API key. Prints the key once — save it, it won't be shown again.

---

### 1f. `test-cookies.js` — Cookie Validation Utility

Quick Puppeteer script to verify that `scripts/cookies.json` produces a valid authenticated X session.

```bash
node scripts/test-cookies.js
```

Prints the current URL and whether X login elements were found. Useful for debugging session expiry before running the main engagement scripts.

---

### 2. `news.js` — NewsAPI Enrichment

Fetches live news headlines to enrich replies with real-world context.

#### Usage (standalone)

```bash
node news.js headlines --category technology
node news.js search --q "bitcoin ETF"
node news.js context --tweet "bitcoin just broke 100k"
```

#### Key Exports

| Function | Purpose |
|----------|---------|
| `headlines(opts)` | Top breaking headlines by category/country |
| `search(opts)` | Full article search (past ~1 month) |
| `formatContext(articles)` | Formats articles into compact context string |
| `contextFor(tweetText, analysis)` | Main entrypoint — auto-routes by topic |

#### Topic Routing

Maps tweet topics to targeted news searches:

| Topic | Search Strategy |
|-------|----------------|
| crypto | "cryptocurrency bitcoin blockchain" |
| defi | "DeFi decentralized finance" |
| ai | "artificial intelligence AI" |
| tech | category: technology |
| finance | "stock market finance economy" |

Keyword overrides detect specific tokens (BTC, ETH, etc.) and run targeted queries.

---

### 3. `x-analytics-scraper.js` — X Analytics Scraper

Scrapes the X account analytics page and pushes stats to `aptum.fun/api/stats`.

```bash
node x-analytics-scraper.js
```

**Metrics captured:** Impressions, Engagements, Engagement rate, Profile visits, Replies, Likes, Reposts, Bookmarks, Shares, Video views, New followers.

---

### 4. `stats.js` — Analytics Receiver (Node.js)

Simple HTTP server that receives POST requests with analytics data and saves to `analytics.json`.

```bash
node stats.js            # Runs on port 3000
PORT=8080 node stats.js  # Custom port
```

**Endpoint:** `POST /api/stats.js` — accepts JSON payload, appends to file.

---

### 5. `dashboard.html` / `dashboard.php` — Engagement Dashboards

Two versions of the engagement dashboard:
- `dashboard.html` — static file served by `api-server.js` at `/` or `/dashboard`
- `dashboard.php` — PHP equivalent for cPanel/shared hosting deployments without Node

---

## Prompt Files

### `reply-prompt.md` — @aptum_ Persona

Defines the reply agent's personality:
- **Identity**: @aptum_ — web3 builder, AI agent creator, launched $A on Clanker
- **Tone**: Casually sharp, never trying too hard, crypto-native
- **Rules**: Lowercase default, no emojis (unless original used them), no hashtags, no em dashes
- **Reply depth**: Matches post weight (1-word for GM, 2-3 sentences for deep tech)
- **$A promotion**: Subtle, organic, only when context fits (~1 in 3-4 crypto replies)
- **Blocked content**: Never promotes competing L1 chains (Cardano, Solana, etc.)

### `engagement-bait-filter.md` — Classification Guide

Three-signal system for the classifier:

| Signal | Meaning | Action |
|--------|---------|--------|
| `SKIP` | Engagement bait, follow farming, no substance | Do not engage |
| `PASS` | Genuine post, worth replying to | Generate normal reply |
| `SHILL` | Genuine post + natural $A mention opportunity | Reply with subtle $A drop |

**SKIP triggers:** Follow farming, "like if you agree", vague hype with no content, fake giveaways.

**Not bait:** Short news headlines, hot takes with specific claims, posts with data/charts.

**SHILL rules:** Max ~1 in 15 qualifying posts. Natural fit only. Never on bait.

---

## Data Files

### `debug/feed-progress-YYYY-MM-DD.json`

Daily counters — survives script restarts:

```json
{
  "date": "2026-03-03",
  "liked": 45,
  "commented": 38,
  "skipped": 12,
  "errors": 2
}
```

### `debug/replied.json`

Deduplication registry — all replies ever sent, prevents double-replying:

```json
{
  "version": 1,
  "totalReplies": 1234,
  "entries": [
    { "tweetId": "...", "author": "...", "reply": "...", "timestamp": "..." }
  ]
}
```

### `debug/replyback-seen.json`

Tracks notification IDs already processed during reply-back phase.

### `debug/x-feed-engage.log`

Runtime log with timestamped entries for every action (classify, reply, error, etc.).

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NVIDIA_API_KEY` | Yes | NVIDIA NIM API key for LLM calls |
| `NEWS_API_KEY` | No | NewsAPI key (hardcoded fallback exists) |

Stored in `.env` at the skill root.

---

## External Dependencies

| Dependency | Purpose |
|------------|---------|
| `puppeteer-core` | Browser automation (Automation + Hybrid modes) |
| `twitter-api-v2` | Official X API v2 client (Hybrid + API modes) |
| `openai` | NVIDIA NIM API client (OpenAI-compatible) |
| `dotenv` | Environment variable loading |
| `../../dune-api/dune` | On-chain data enrichment (optional, graceful fallback) |

---

## Common Operations

### Automation (budget)
```bash
node x-feed-engage.js --quota 100 --min-pause 25 --max-pause 55 --reply-back --rb-limit 20
node x-feed-engage.js --list https://x.com/i/lists/YOUR_LIST_ID --quota 100
node x-feed-engage.js --quota 50 --min-pause 120 --max-pause 300  # stealth (slower)
```

### Hybrid (mid-tier)
```bash
node x-api-engage.js --mode hybrid --quota 100 --min-pause 25 --max-pause 55
node x-api-engage.js --mode hybrid --list https://x.com/i/lists/YOUR_LIST_ID
```

### API (business)
```bash
node x-api-engage.js --mode api --quota 50
node x-api-engage.js --mode api --search "crypto" --quota 30
```

### Per-client
```bash
node x-api-engage.js --mode hybrid --client-id acme --credentials ./clients/acme/keys.json
```

### Dry run
```bash
node x-api-engage.js --dry-run --verbose
```

### Stop all
```bash
taskkill /F /IM chrome.exe; taskkill /F /IM node.exe
```
