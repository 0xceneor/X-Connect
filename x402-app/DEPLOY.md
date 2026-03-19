# cPanel Deployment Guide — x402 Unlock Server

## What goes where

```
cPanel file manager:
  ~/x402-app/               ← Node.js app root (OUTSIDE public_html)
    app.js
    package.json
    .env
    agentusers/.env
    public/
      skill.md
      x-connect-fresh.zip   ← built by: node scripts/build-package.js

  ~/public_html/x-connect/  ← Apache-served directory
    .htaccess               ← proxies /x-connect/* to the Node.js app
```

---

## Step 1 — Upload files

Upload the entire `x402-app/` folder to your cPanel home directory (NOT inside `public_html`).

```
~/x402-app/
```

---

## Step 2 — Set up Node.js App in cPanel

1. cPanel → **Setup Node.js App**
2. Click **Create Application**
3. Fill in:
   - **Node.js version:** 18 or 20
   - **Application mode:** Production
   - **Application root:** `/home/<username>/x402-app`
   - **Application URL:** `aptum.fun` (or subdomain)
   - **Application startup file:** `app.js`
4. Click **Create**
5. In the app panel, click **Run NPM Install** to install dependencies
6. Click **Start App**

cPanel assigns a port automatically via Phusion Passenger — you don't need to manage the port.

---

## Step 3 — Create the proxy directory in public_html

```bash
mkdir ~/public_html/x-connect
cp ~/x402-app/.htaccess ~/public_html/x-connect/.htaccess
```

Or create `public_html/x-connect/` in File Manager and upload `.htaccess`.

> **If Passenger is handling routing** (most cPanel setups), you may not need `.htaccess` at all — Passenger auto-proxies once the app URL is set in Step 2.

---

## Step 4 — Switch to mainnet when ready

In `~/x402-app/.env`, change:

```
USE_TESTNET=false
```

Then restart the Node.js app in cPanel.

Mainnet uses:
- Network: Base (`eip155:8453`)
- USDC: `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`
- Facilitator: `https://x402.org/facilitator` (free tier: 1,000 tx/month)

---

## Step 5 — Rebuild zip after updates

Whenever you update x-connect, rebuild the distribution zip:

```bash
# Local machine
cd skills/x-connect
node scripts/build-package.js

# Then re-upload x402-app/public/x-connect-fresh.zip to cPanel
```

---

## Verify it's working

```bash
# Health check
curl https://aptum.fun/x-connect/api/health

# Expected:
# { "status": "ok", "network": "base-sepolia (testnet)", "price": "$1.00 USDC", ... }

# Skill manifest
curl https://aptum.fun/x-connect/skill.md
```

---

## Agent flow (end-to-end test)

```js
import { wrapFetchWithPayment } from "@x402/fetch";
import { createEVMSigner } from "@x402/evm";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains"; // testnet

const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() });
const signer = createEVMSigner(walletClient);
const payingFetch = wrapFetchWithPayment(fetch, signer);

// 1. Pay and unlock
const unlockRes = await payingFetch("https://aptum.fun/x-connect/api/unlock");
const { apiKey, downloadUrl } = await unlockRes.json();
console.log("API Key:", apiKey);

// 2. Download module
const dlRes = await fetch(downloadUrl);
// Save dlRes.body as x-connect.zip
```

---

## Key storage

Agent keys are saved at `~/x402-app/agentusers/.env`:

```
# x-connect Agent Keys
AGENT_0xABC...=xc_a1b2c3...:1742345678
AGENT_0xDEF...=xc_d4e5f6...:1742345999
```

To revoke a key: delete its line from the file.
