/**
 * x-connect x402 Unlock Server
 *
 * Runs as a cPanel Node.js app (Phusion Passenger).
 * Apache proxies /x-connect/* to this process.
 *
 * Endpoints:
 *   GET /x-connect/skill.md          → public skill manifest (agent entry point)
 *   GET /x-connect/api/unlock        → x402 paywall ($59 USDC, Base mainnet)
 *   GET /x-connect/api/download      → download x-connect.zip (requires API key)
 *   GET /x-connect/api/verify        → check if a key is valid
 */

'use strict';

require('dotenv').config({ path: __dirname + '/.env' });

const express    = require('express');
const cors       = require('cors');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');
const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { ExactEvmScheme }     = require('@x402/evm/exact/server');
const { HTTPFacilitatorClient } = require('@x402/core/server');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Paths ─────────────────────────────────────────────────────────────────────
const KEYS_FILE    = path.join(__dirname, 'agentusers', '.env');
const PACKAGE_ZIP  = path.join(__dirname, 'public', 'x-connect-fresh.zip');
const SKILL_MD     = path.join(__dirname, 'public', 'skill.md');

// ── Config ────────────────────────────────────────────────────────────────────
const RECEIVE_WALLET = process.env.RECEIVE_WALLET || '0x212816755ca6016F31DAa09cBf6814Ed49AF8579';
const USE_TESTNET    = process.env.USE_TESTNET !== 'false'; // default: testnet until flipped

const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://x402.org/facilitator';
const NETWORK         = USE_TESTNET ? 'eip155:84532' : 'eip155:8453';

// ── Key store ─────────────────────────────────────────────────────────────────
function loadKeys() {
    if (!fs.existsSync(KEYS_FILE)) return {};
    const lines = fs.readFileSync(KEYS_FILE, 'utf8').split('\n');
    const keys = {};
    for (const line of lines) {
        if (!line.startsWith('AGENT_')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) continue;
        const wallet = line.slice(6, eqIdx);         // strip 'AGENT_'
        const value  = line.slice(eqIdx + 1).trim();
        const [apiKey] = value.split(':');
        keys[wallet] = { apiKey, raw: value };
    }
    return keys;
}

function saveKey(wallet, apiKey) {
    const dir = path.dirname(KEYS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const entry = `AGENT_${wallet}=${apiKey}:${Date.now()}\n`;
    fs.appendFileSync(KEYS_FILE, entry);
}

function isValidKey(apiKey) {
    if (!apiKey || !apiKey.startsWith('xc_')) return false;
    const keys = loadKeys();
    return Object.values(keys).some(({ raw }) => raw.startsWith(apiKey + ':'));
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// x402 paywall — only on the unlock route
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer    = new x402ResourceServer(facilitatorClient)
    .register(NETWORK, new ExactEvmScheme());

app.use(
    paymentMiddleware(
        {
            'GET /x-connect/api/unlock': {
                accepts: [
                    {
                        scheme: 'exact',
                        price:  '$59',
                        network: NETWORK,
                        payTo:  RECEIVE_WALLET,
                    },
                ],
                description: 'One-time unlock for the x-connect AI engagement skill ($59 USDC on Base)',
            },
        },
        resourceServer
    )
);

// ── Routes ────────────────────────────────────────────────────────────────────

// Public skill manifest
app.get('/x-connect/skill.md', (req, res) => {
    if (!fs.existsSync(SKILL_MD)) {
        return res.status(404).send('skill.md not found');
    }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(SKILL_MD);
});

// Unlock — payment already verified by x402 middleware before reaching here
app.get('/x-connect/api/unlock', (req, res) => {
    // Extract paying wallet from x402 payment payload header
    let wallet = 'unknown';
    try {
        const sigHeader = req.headers['x-payment'] || req.headers['payment-signature'] || '';
        if (sigHeader) {
            const decoded = JSON.parse(Buffer.from(sigHeader, 'base64').toString('utf8'));
            wallet = decoded?.payload?.authorization?.from
                  || decoded?.from
                  || decoded?.wallet
                  || 'unknown';
        }
    } catch (_) { /* wallet stays unknown */ }

    if (wallet === 'unknown') {
        wallet = 'wallet_' + crypto.randomBytes(4).toString('hex');
    }

    // Check if this wallet already has a key (idempotent — won't double-charge)
    const existing = loadKeys();
    if (existing[wallet]) {
        return res.json({
            success:     true,
            alreadyPaid: true,
            apiKey:      existing[wallet].apiKey,
            downloadUrl: `https://aptum.fun/x-connect/api/download?key=${existing[wallet].apiKey}`,
            message:     'You already have an active key for this wallet.',
        });
    }

    // Generate fresh key
    const apiKey = 'xc_' + crypto.randomBytes(32).toString('hex');
    saveKey(wallet, apiKey);

    console.log(`[x402] New unlock — wallet: ${wallet} | key: ${apiKey.slice(0, 12)}...`);

    res.json({
        success:     true,
        apiKey,
        wallet,
        downloadUrl: `https://aptum.fun/x-connect/api/download?key=${apiKey}`,
        instructions: [
            '1. Save your API key — it will not be shown again.',
            '2. Download the module: GET /x-connect/api/download?key=<YOUR_KEY>',
            '3. Extract and run: npm install && node scripts/x-feed-engage.js',
        ],
        docs: 'https://aptum.fun/x-connect/skill.md',
    });
});

// Download — requires valid API key
app.get('/x-connect/api/download', (req, res) => {
    const { key } = req.query;

    if (!isValidKey(key)) {
        return res.status(401).json({
            error:   'Invalid or missing API key.',
            howToGet: 'Send GET /x-connect/api/unlock with $59 USDC on Base to receive your key.',
        });
    }

    if (!fs.existsSync(PACKAGE_ZIP)) {
        return res.status(503).json({
            error: 'Package not yet built. Please try again shortly or contact support.',
        });
    }

    console.log(`[download] Key ${key.slice(0, 12)}... downloading x-connect-fresh.zip`);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="x-connect.zip"');
    fs.createReadStream(PACKAGE_ZIP).pipe(res);
});

// Key verification — agents can check if their key is still valid
app.get('/x-connect/api/verify', (req, res) => {
    const key = req.query.key || req.headers['x-api-key'];
    res.json({ valid: isValidKey(key) });
});

// Health check
app.get('/x-connect/api/health', (req, res) => {
    res.json({
        status:    'ok',
        network:   USE_TESTNET ? 'base-sepolia (testnet)' : 'base-mainnet',
        price:     '$59 USDC',
        payTo:     RECEIVE_WALLET,
        agents:    Object.keys(loadKeys()).length,
    });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`x402 unlock server running on :${PORT}`);
    console.log(`  Network:    ${USE_TESTNET ? 'Base Sepolia (testnet)' : 'Base Mainnet'}`);
    console.log(`  Price:      $59 USDC`);
    console.log(`  Pay to:     ${RECEIVE_WALLET}`);
    console.log(`  Keys file:  ${KEYS_FILE}`);
    console.log(`  Zip ready:  ${fs.existsSync(PACKAGE_ZIP)}`);
});
