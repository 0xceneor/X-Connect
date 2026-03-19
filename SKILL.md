---
name: x-connect
description: Automated X/Twitter engagement — three modes (Automation, Hybrid, API). Classifies posts, generates AI replies, likes, and manages daily quotas. Use when asked to run engagement batches or manage X accounts.
---

# X Connect

Tri-mode X engagement engine. Classifies posts (SKIP/PASS/SHILL), generates AI replies, likes with human pacing.

> Full technical docs: `documentation.md`
> Command reference (how user starts/stops batches): `user-behavior.md`
> VPS error guide: `debug.md`

## Engagement Modes

| Mode | Read | Write | Cost | Command |
|------|------|-------|------|---------|
| **Automation** | Puppeteer (browser) | Puppeteer (keyboard) | Free | `x-feed-engage.js` |
| **Hybrid** | Puppeteer (browser) | X API | Free tier (1,500/mo) | `x-api-engage.js --mode hybrid` |
| **API** | X API | X API | Paid credits | `x-api-engage.js --mode api` |

## Quick Start

```bash
# Automation — budget (browser-based)
node "{baseDir}/scripts/x-feed-engage.js" --quota 100 --min-pause 25 --max-pause 55 --reply-back --rb-limit 20

# Hybrid — mid-tier (Puppeteer read + API write)
node "{baseDir}/scripts/x-api-engage.js" --mode hybrid --quota 100 --min-pause 25 --max-pause 55

# API — business (full API, needs paid credits)
node "{baseDir}/scripts/x-api-engage.js" --mode api --quota 50

# API — search-based engagement
node "{baseDir}/scripts/x-api-engage.js" --mode api --search "crypto" --quota 30

# Per-client (isolated data + credentials)
node "{baseDir}/scripts/x-api-engage.js" --mode hybrid --client-id acme --credentials ./clients/acme/keys.json

# Dry run
node "{baseDir}/scripts/x-api-engage.js" --mode api --dry-run --verbose

# Stop everything
taskkill /F /IM chrome.exe; taskkill /F /IM node.exe
```

## CLI Flags (x-api-engage.js)

| Flag | Default | Description |
|------|---------|-------------|
| `--mode` | api | `api` / `hybrid` / `automation` |
| `--quota N` | 50 | Daily engagement limit |
| `--max-age N` | 180 | Max tweet age in minutes |
| `--min-pause N` | 25 | Min seconds between actions |
| `--max-pause N` | 55 | Max seconds between actions |
| `--search "query"` | — | Search-based engagement (API mode) |
| `--list URL` | — | Engage from X list (hybrid mode) |
| `--credentials path` | `credentials.json` | Client's X API key file |
| `--client-id name` | default | Per-client data isolation |
| `--like-only` | off | Skip commenting, only like |
| `--dry-run` | off | Preview mode, no actual actions |
| `--verbose` | off | Extra logging |

## Pipeline

1. **Extract** — API timeline/search or DOM scraping (by mode)
2. **Classify** — SKIP (bait) / PASS (genuine) / SHILL (mention $A)
3. **Enrich** — Vision (images) + NewsAPI + Dune (on-chain data)
4. **Generate** — AI reply via NVIDIA Kimi-K2
5. **Proofread** — Grammar, coherence, factual accuracy
6. **Clean** — Strip competing tickers, blocked coins, markdown
7. **Write** — API calls or keyboard shortcuts (by mode)

## Scripts

| Script | Purpose |
|--------|---------|
| `x-feed-engage.js` | Automation engine (Puppeteer only) |
| `x-api-engage.js` | API + Hybrid engine |
| `engage-core.js` | Shared AI pipeline module |
| `x-api-test.js` | API test utility |
| `news.js` | NewsAPI enrichment module |
| `api-server.js` | REST API server for remote/multi-tenant management |
| `instance-manager.js` | Child process manager (used by api-server) |
| `setup-client.js` | CLI client onboarding tool |
| `test-cookies.js` | Cookie session validation utility |
| `x-analytics-scraper.js` | X analytics scraper |
| `stats.js` / `stats.php` | Analytics receivers |

## Per-Client Setup

Each client gets isolated data under `clients/<client-id>/`:
```
clients/
├── acme/
│   ├── keys.json         # Client's X API credentials
│   ├── engage.log        # Client's activity log
│   ├── replied.json      # Client's dedup registry
│   └── feed-progress-*.json
└── default/              # Default (your own account)
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NVIDIA_API_KEY` | Yes | NVIDIA NIM API key for LLM calls |
| `NEWS_API_KEY` | No | NewsAPI key (fallback exists) |
