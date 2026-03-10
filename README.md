# X-Connect

Autonomous X (Twitter) engagement engine. Reads your feed, classifies posts, enriches with live context, and generates on-brand AI replies — with human-like pacing.

## Three Modes

| Mode | Read | Write | Cost |
|------|------|-------|------|
| **Automation** | Puppeteer (browser) | Puppeteer (keyboard) | Free |
| **Hybrid** | Puppeteer (browser) | X API | Free tier (1,500 writes/mo) |
| **API** | X API | X API | Paid credits |

## How It Works

Every tweet goes through a 7-stage pipeline:

1. **Extract** — Pull timeline/search via API or DOM scraping
2. **Classify** — `SKIP` (bait/spam) / `PASS` (engage) / `SHILL` (promote)
3. **Enrich** — Vision AI (images) + NewsAPI (headlines) + Dune (on-chain data)
4. **Generate** — AI reply via NVIDIA NIM (Kimi-K2)
5. **Proofread** — Grammar, coherence, factual accuracy check
6. **Clean** — Strip competing tickers, markdown artifacts
7. **Write** — Post via API call or keyboard automation

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure secrets
cp .env.example .env
# Edit .env with your NVIDIA_API_KEY

cp scripts/credentials.example.json scripts/credentials.json
# Edit with your X API credentials

cp scripts/cookies.example.json scripts/cookies.json
# Paste your X.com session cookies (automation/hybrid modes only)

# 3. Run
node scripts/x-api-engage.js --mode hybrid --quota 50
```

## Commands

```bash
# Automation — browser-only, free
node scripts/x-feed-engage.js --quota 100 --min-pause 25 --max-pause 55

# Hybrid — Puppeteer reads, API writes
node scripts/x-api-engage.js --mode hybrid --quota 100

# API — full API, no browser needed
node scripts/x-api-engage.js --mode api --quota 50

# Search-based engagement
node scripts/x-api-engage.js --mode api --search "crypto" --quota 30

# Per-client (isolated credentials + logs)
node scripts/x-api-engage.js --mode hybrid --client-id myclient --credentials ./clients/myclient/keys.json

# Dry run (no real actions)
node scripts/x-api-engage.js --mode api --dry-run --verbose

# Test API connectivity
node scripts/x-api-test.js
```

## CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--mode` | `api` | `api` / `hybrid` / `automation` |
| `--quota N` | `50` | Max engagements per session |
| `--max-age N` | `180` | Max tweet age in minutes |
| `--min-pause N` | `25` | Min seconds between actions |
| `--max-pause N` | `55` | Max seconds between actions |
| `--search "query"` | — | Search-based targeting (API mode) |
| `--list URL` | — | Engage from an X list (hybrid mode) |
| `--credentials path` | `credentials.json` | X API key file |
| `--client-id name` | `default` | Per-client data isolation |
| `--like-only` | off | Like only, skip replies |
| `--dry-run` | off | Preview mode, no actions taken |
| `--verbose` | off | Detailed logging |

## Scripts

| Script | Purpose |
|--------|---------|
| `x-feed-engage.js` | Automation engine (Puppeteer) |
| `x-api-engage.js` | API + Hybrid engine |
| `engage-core.js` | Shared AI pipeline module |
| `news.js` | NewsAPI enrichment |
| `x-api-test.js` | API connectivity test |
| `api-server.js` | REST API for remote/multi-tenant management |
| `instance-manager.js` | Child process manager |
| `setup-client.js` | Client onboarding CLI |
| `test-cookies.js` | Cookie session validator |
| `x-analytics-scraper.js` | X analytics scraper |
| `stats.js` / `stats.php` | Analytics receivers |

## Multi-Client Setup

Each client gets isolated credentials, logs, and progress under `clients/<id>/`:

```
clients/
└── myclient/
    ├── keys.json              # X API credentials
    ├── engage.log             # Activity log
    ├── replied.json           # Dedup registry
    └── feed-progress-*.json   # Daily progress
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NVIDIA_API_KEY` | Yes | NVIDIA NIM key — [build.nvidia.com](https://build.nvidia.com) |
| `MASTER_API_KEY` | Yes (api-server) | Master key for the REST API server |
| `NEWS_API_KEY` | No | NewsAPI key — [newsapi.org](https://newsapi.org) |

## Configuration Files

| File | Description |
|------|-------------|
| `.env` | Environment secrets (copy from `.env.example`) |
| `scripts/credentials.json` | X OAuth credentials (copy from `credentials.example.json`) |
| `scripts/cookies.json` | X.com session cookies (copy from `cookies.example.json`) |
| `reply-prompt.md` | AI persona and tone rules |
| `reply-pipeline.md` | Pipeline stage configuration and model settings |

## Docs

- [Setup on a VPS](setup.md) — Linux deployment, systemd/pm2, cron scheduling
- [Operations guide](operations.md) — Commands, pacing reference, agent instructions
- [Reply pipeline](reply-pipeline.md) — Stage-by-stage AI pipeline details
- [Showcase](showcase.md) — Feature overview and mode comparison
