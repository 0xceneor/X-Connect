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

Edit `.env` and add your keys:

```env
NVIDIA_API_KEY=nvapi-...     # Required — LLM + vision calls
NEWS_API_KEY=...              # Optional — enriches replies with live news
```

Get a free NVIDIA API key at: https://build.nvidia.com

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

All commands run from the `scripts/` directory inside the extracted zip:

```bash
cd x-connect/scripts

# Basic run
node x-feed-engage.js --quota 100

# With reply-back (responds to people who replied to you)
node x-feed-engage.js --quota 100 --reply-back --rb-limit 10

# Non-headless (visible browser window)
node x-feed-engage.js --no-headless --quota 100

# Engage a specific X list instead of home feed
node x-feed-engage.js --list https://x.com/i/lists/YOUR_LIST_ID --quota 100

# Dry run — no actions taken, just previews what it would do
node x-feed-engage.js --dry-run --verbose

# Test cookies only — confirms login without running a full batch
node test-cookies.js
```

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
