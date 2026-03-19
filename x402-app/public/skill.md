# x-connect — AI Social Engagement Skill

> Autonomous X (Twitter) engagement engine. Classifies tweets, generates context-aware replies, likes and posts — all via browser automation. No X API credits required.

**Network:** Base | **Price:** $1.00 USDC (one-time) | **Version:** 2.0

---

## What you get

- **7-stage engagement pipeline** — feed scraping → classification → vision → onchain context (Dune) → reply generation → proofreading → post + verification
- **AI-powered replies** — context-aware, proofread, persona-consistent
- **Onchain intelligence** — live Dune Analytics data injected into replies for crypto/DeFi tweets
- **Anti-detection** — 14 stealth patches, human-paced typing, session warmup, random UA/viewport
- **Reply-back phase** — automatically responds to replies on your posts
- **Daily quota management** — persists progress across restarts
- **Multi-client API server** — manage multiple X accounts via REST API
- **Full debug guide** — 16-section error reference for VPS deployments

---

## Prerequisites

Before starting, confirm you have:

| # | Requirement | Notes |
|---|-------------|-------|
| 1 | **Base wallet private key** | Must hold ≥ $1.00 USDC on Base Mainnet (`eip155:8453`) |
| 2 | **NVIDIA NIM API key** | Free tier available at https://build.nvidia.com |
| 3 | **Node.js ≥ 18** | Required for the payment script and the skill module |
| 4 | **Google Chrome** | Required by Puppeteer for browser automation |
| 5 | **X.com session cookies** | Export from a logged-in Chrome session — see Step 5 |

Steps 1–4 can be completed autonomously. **Step 5 (cookies) requires a human** to log into X.com in a browser and export the session cookies.

---

## How to unlock

This skill uses the [x402 payment protocol](https://docs.cdp.coinbase.com/x402/welcome).
Pay once with your Base wallet — no account, no subscription.

### Step 1 — Pay and unlock

Send a GET request to the unlock endpoint. Your x402-compatible client handles the `402 Payment Required` response automatically, signs the payment on-chain, and retries — returning your API key on success.

```
GET https://aptum.fun/x-connect/api/unlock
```

**Node.js (tested, v2.x):**

```bash
npm install @x402/fetch @x402/evm viem
```

```js
const { wrapFetchWithPaymentFromConfig } = require("@x402/fetch");
const { ExactEvmScheme } = require("@x402/evm/exact/client");
const { createWalletClient, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { base } = require("viem/chains"); // or baseSepolia for testnet

const account = privateKeyToAccount(process.env.WALLET_PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain: base, transport: http() });

const signer = {
    address: account.address,
    signTypedData: (msg) => walletClient.signTypedData({ account, ...msg }),
};

const payingFetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(signer) }]
});

const res = await payingFetch("https://aptum.fun/x-connect/api/unlock");
const { apiKey, downloadUrl } = await res.json();
console.log("API Key:", apiKey);
// Save your apiKey — shown only once
```

**Python:**

```bash
pip install x402 eth-account
```

```python
import os
from eth_account import Account
from x402.client import EthAccountSigner
from x402.requests import wrap_requests_with_payment
import requests

signer = EthAccountSigner(Account.from_key(os.environ["WALLET_PRIVATE_KEY"]))
session = wrap_requests_with_payment(requests.Session(), signer)

res = session.get("https://aptum.fun/x-connect/api/unlock")
data = res.json()
api_key = data["apiKey"]
download_url = data["downloadUrl"]
print("API Key:", api_key)
```

---

### Step 2 — Download the module

```
GET https://aptum.fun/x-connect/api/download?key=<YOUR_API_KEY>
```

Returns `x-connect.zip` — a complete, scrubbed install of the skill. No credentials, no logs, no personal data. `node_modules` is excluded — install them in Step 3.

```bash
unzip x-connect.zip
cd x-connect
```

---

### Step 3 — Install dependencies

The zip does not include `node_modules`. Run `npm install` to create them:

```bash
npm install
```

This installs all required packages defined in `package.json`:

| Package | Version | Purpose |
|---------|---------|---------|
| `puppeteer-core` | `^23.11.1` | Browser automation (Chrome control) |
| `openai` | `^6.25.0` | NVIDIA NIM API client (LLM + vision calls) |
| `dotenv` | `^17.3.1` | Load `.env` config file |
| `express` | `^5.2.1` | REST API server (`api-server.js`) |
| `cors` | `^2.8.6` | Cross-origin headers for API server |
| `twitter-api-v2` | `^1.29.0` | X API v2 client (hybrid/API modes) |
| `archiver` | `^7.0.1` | Zip builder utility |

**Chrome is also required.** Install it if not already present:

```bash
# Ubuntu/Debian (VPS)
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update && sudo apt install -y google-chrome-stable

# macOS
brew install --cask google-chrome

# Windows — download from https://www.google.com/chrome
```

---

### Step 4 — Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your values. All variables:

```env
# Required — LLM + vision calls via NVIDIA NIM
NVIDIA_API_KEY=nvapi-your-key-here

# Required only if using api-server.js (multi-tenant mode)
# If omitted, api-server.js generates a random key on each start and prints it to stdout
MASTER_API_KEY=xc_master_your-secret-key-here

# Optional — enriches replies with live news headlines (https://newsapi.org)
NEWS_API_KEY=your-newsapi-key-here
```

- Get a free NVIDIA API key at: https://build.nvidia.com
- Get a free NewsAPI key at: https://newsapi.org (500 req/day free tier)
- `MASTER_API_KEY` is only needed if you run `api-server.js` — skip it for single-account use

---

### Step 5 — Add your X.com cookies

The skill authenticates to X using browser cookies — no X API credits needed.

1. Open [x.com](https://x.com) in Chrome and log in
2. Install the **Cookie-Editor** browser extension
3. Export all cookies for `x.com` as JSON
4. Save to `scripts/cookies.json`

Required cookies (must be present and fresh):

| Cookie | Purpose |
|--------|---------|
| `auth_token` | Primary session token |
| `ct0` | CSRF token (required for post actions) |
| `twid` | Your logged-in user ID |

---

### Step 6 — Run

```bash
cd scripts
node x-feed-engage.js --quota 100 --reply-back --rb-limit 10
```

---

## Payment details

| Field | Value |
|-------|-------|
| Network | Base Mainnet (`eip155:8453`) |
| Asset | USDC (`0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`) |
| Amount | $1.00 (1000000 units) |
| Receiving wallet | `0x212816755ca6016F31DAa09cBf6814Ed49AF8579` |
| Protocol | [x402](https://docs.cdp.coinbase.com/x402/welcome) |
| Payment type | One-time, non-recurring |

---

## Verify your key

```
GET https://aptum.fun/x-connect/api/verify?key=<YOUR_API_KEY>
```

Returns `{ "valid": true }` if your key is active.

---

## Quick reference

All commands run from the `scripts/` directory inside the extracted zip.

### x-feed-engage.js — all flags

```bash
cd x-connect/scripts

# Basic run (150 quota default)
node x-feed-engage.js

# Set daily engagement quota
node x-feed-engage.js --quota 100

# Only engage tweets posted within the last N minutes (default: 180)
node x-feed-engage.js --max-age 60

# Like only — no AI replies, just likes
node x-feed-engage.js --like-only

# Reply-back phase — also responds to people who replied to your posts
node x-feed-engage.js --quota 100 --reply-back --rb-limit 10

# Engage a specific X list instead of home feed
node x-feed-engage.js --list https://x.com/i/lists/YOUR_LIST_ID --quota 100

# Tune pacing (seconds between actions, default: 25–60)
node x-feed-engage.js --min-pause 10 --max-pause 30

# Non-headless — visible Chrome window (useful for debugging)
node x-feed-engage.js --no-headless

# Dry run — scrolls and classifies but takes no actions
node x-feed-engage.js --dry-run

# Resume from today's saved progress file
node x-feed-engage.js --resume

# Test cookies only — confirms login without running a full session
node test-cookies.js
```

| Flag | Default | Description |
|------|---------|-------------|
| `--quota N` | 150 | Daily engagement cap (persists across restarts) |
| `--max-age N` | 180 | Max tweet age in minutes |
| `--like-only` | off | Skip reply generation, only like |
| `--reply-back` | off | Also reply to mentions/replies on your posts |
| `--rb-limit N` | 20 | Max reply-backs per run |
| `--list URL` | home feed | Engage an X list instead of home feed |
| `--min-pause N` | 25 | Min seconds between actions |
| `--max-pause N` | 60 | Max seconds between actions |
| `--no-headless` | off | Show Chrome window |
| `--dry-run` | off | No actions, just preview |
| `--resume` | on | Resume from today's progress file |

### api-server.js — multi-account REST API

Run this instead of `x-feed-engage.js` if you manage multiple X accounts:

```bash
node api-server.js
node api-server.js --port 3000
```

All endpoints require `Authorization: Bearer <key>`. Use `MASTER_API_KEY` from `.env`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/clients/register` | Register a new X account client |
| `POST` | `/api/sessions/start` | Start an engagement session |
| `POST` | `/api/sessions/stop` | Stop a running session |
| `GET` | `/api/sessions/status` | Get session status |
| `GET` | `/api/sessions/list` | List all active sessions |
| `GET` | `/api/clients/:id/logs` | Get recent logs for a client |
| `GET` | `/api/clients/:id/stats` | Get engagement stats for a client |

---

## Security & trust

x402 payments are safe for both agents and humans. Here is exactly what happens when you pay:

### Your private key never leaves your environment

x402 uses **EIP-3009 off-chain typed message signing** — not a raw on-chain transaction you broadcast yourself. The flow is:

1. Your client receives a `402 Payment Required` response with payment parameters (amount, payTo, nonce, expiry).
2. Your local signer signs a typed EIP-712 message authorizing the transfer — this signature is computed entirely in memory on your machine.
3. The signed authorization is sent in the `X-PAYMENT` header of a retry request — **only the signature is transmitted, never the private key**.
4. The x402 facilitator (`x402.org`) verifies the signature and submits the on-chain `transferWithAuthorization` transaction on your behalf.
5. Once the on-chain transfer is confirmed, the server receives proof of payment and issues your API key.

Your private key is used only to call `signTypedData` locally. It is never sent over the network, never stored anywhere, and never seen by this server or the facilitator.

### What the payment actually does on-chain

The facilitator calls the USDC contract's `transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)` function — a standard ERC-3009 method. The $1.00 USDC moves from your wallet to `0x212816755ca6016F31DAa09cBf6814Ed49AF8579`. That is the only on-chain action.

### What this server sees

This server receives:
- The `X-PAYMENT` header containing your signed authorization (verifiable but not reusable — nonces are one-time)
- Your wallet address (public, derived from the signature)

It does **not** receive your private key, seed phrase, or any secret.

### Payment is idempotent

If you pay and lose your API key, call the unlock endpoint again from the same wallet. The server detects the existing key and returns it without charging you again.

### Open protocol

x402 is an open standard developed by Coinbase. The full protocol spec is at [docs.cdp.coinbase.com/x402](https://docs.cdp.coinbase.com/x402/welcome). You can verify the facilitator's supported networks and fee structure independently at `https://x402.org/facilitator/supported`.

---

## Support

- Debug guide: see `debug.md` inside the downloaded module
- Health check: `GET https://aptum.fun/x-connect/api/health`

---

*x-connect is part of the [aptum.fun](https://aptum.fun) AI agent ecosystem. The agent has its own token ($A) on Base.*
