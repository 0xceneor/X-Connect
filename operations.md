# X-Connect Operations Guide for AI Agents

When an AI agent is asked to interact with X (Twitter) using this skill, use the following commands based on the user's intent. Do not create new scripts; use these strictly.

Ensure that the command is executed in the `skills/x-connect/scripts/` directory, or use absolute paths for the scripts.

## Core Engagement Engine

| User Request | Command to Execute | Description |
|---|---|---|
| "Run an engagement batch" / "Engage on X" | `node x-feed-engage.js --quota 100 --min-pause 25 --max-pause 55 --reply-back --rb-limit 20` | Standard automation mode (safest for accounts with no paid API credits). Browses the home feed using Puppeteer. |
| "Engage with a specific list" | `node x-feed-engage.js --list <URL> --quota 100` | Replaces the home feed with a specific X list URL. |
| "Run a stealth batch" / "Engage slowly" | `node x-feed-engage.js --quota 50 --min-pause 420 --max-pause 720` | Uses longer wait times between actions to mimic slow human pacing. |
| "Run a hybrid batch" | `node x-api-engage.js --mode hybrid --quota 100` | Uses Puppeteer to read the feed, but the **X API** to write (post replies/likes). *Requires OAuth 1.0a User Tokens in credentials.json*. |
| "Engage via API" / "Business mode" | `node x-api-engage.js --mode api --quota 50` | Uses the X API for everything (reading and writing). *Requires a paid X API tier for read credits.* |
| "Search and engage" / "Engage about [topic]" | `node x-api-engage.js --mode api --search "[query]" --quota 30` | Searches for a specific keyword and engages with matching tweets via API. |
| "Dry run" / "Test engagement" | `node x-api-engage.js --dry-run --verbose` | Previews what the engine *would* do without actually taking any actions on X. |

## Utility Commands

| User Request | Command to Execute | Description |
|---|---|---|
| "Stop all processes" / "Stop batch" | `taskkill /F /IM chrome.exe; taskkill /F /IM node.exe` | Immediately kills all Chromium browsers and Node instances running the engagement scripts. |
| "Check API Authentication" / "Test X API" | `node x-api-test.js me` | verifies that the credentials in `credentials.json` are valid and returns the authenticated user's profile. |
| "Post a tweet" | `node x-api-test.js tweet "Your text here"` | Posts a new standalone tweet using the X API. |

## News & Context Enrichment

| User Request | Command to Execute | Description |
|---|---|---|
| "Get tech headlines" | `node news.js headlines --category technology` | Fetches the latest breaking news using NewsAPI. |
| "Search news about [topic]" | `node news.js search --q "[topic]"` | Searches for specific news articles from the last 30 days. |

## Important Notes for Agents
1. **Automation (`x-feed-engage.js`)** requires a browser. **Do not** run this in headless environments that block UI, though it handles it automatically via Puppeteer.
2. **Hybrid & API (`x-api-engage.js`)** rely on `credentials.json`.
   - **Hybrid mode** bypasses paid API read limits but uses the generous free tier write limits.
   - **API Mode** requires the user to have explicitly purchased X API credits (otherwise the script will throw `402 CreditsDepleted`).
3. Per-Client Isolation: The API/Hybrid engine supports per-client configurations.
   - Run using: `node x-api-engage.js --mode hybrid --client-id <name> --credentials ./clients/<name>/keys.json`
4. The system automatically classifies tweets as SKIP, PASS, or SHILL based on `engagement-bait-filter.md`.
