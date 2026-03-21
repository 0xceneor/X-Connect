/**
 * x-connect x402 Unlock Server
 *
 * Runs as a cPanel Node.js app (Phusion Passenger).
 * LiteSpeed proxies /x-connect/* to this process via .htaccess ProxyPass.
 *
 * Endpoints:
 *   GET /x-connect/skill.md          → public skill manifest (agent entry point)
 *   GET /x-connect/api/unlock        → x402 paywall ($59 USDC, Base mainnet)
 *   GET /x-connect/api/download      → download x-connect.zip (requires API key)
 *   GET /x-connect/api/verify        → check if a key is valid
 *   GET /x-connect/api/health        → health check
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
const { facilitator: cdpFacilitator } = require('@coinbase/x402');

const app  = express();
const PORT = process.env.PORT || 3001;

// Fix #1 — trust LiteSpeed's X-Forwarded-Proto so req.protocol reports 'https'
// Without this, the 402 resource URL is http:// even when clients reach us over HTTPS
app.set('trust proxy', 1);

// ── Paths ─────────────────────────────────────────────────────────────────────
const KEYS_FILE    = path.join(__dirname, 'agentusers', 'keys.json');
const PACKAGE_ZIP  = path.join(__dirname, 'public', 'x-connect-fresh.zip');
const SKILL_MD     = path.join(__dirname, 'public', 'skill.md');

// ── Config ────────────────────────────────────────────────────────────────────
const RECEIVE_WALLET = process.env.RECEIVE_WALLET || '0x212816755ca6016F31DAa09cBf6814Ed49AF8579';

// Fix #6 — default to mainnet; must explicitly set USE_TESTNET=true to use testnet
const USE_TESTNET = process.env.USE_TESTNET === 'true';
const NETWORK     = USE_TESTNET ? 'eip155:84532' : 'eip155:8453';

const KEY_EXPIRY_MS    = 365 * 24 * 60 * 60 * 1000; // Fix #7 — 1 year expiry
const MAX_DOWNLOADS    = 10;                           // Fix #5 — max downloads per key

// ── Key store (JSON) ──────────────────────────────────────────────────────────
// Format: { "<walletOrSigId>": { apiKey, timestamp, ip, downloads, expiresAt } }

// Fix #4 — in-memory write lock; Node.js is single-threaded but guard the
//           read-modify-write cycle to prevent logical races on future async refactors
const _writeLock = new Set();

function loadKeys() {
    const dir = path.dirname(KEYS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(KEYS_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    } catch (_) {
        return {};
    }
}

function saveKeys(keys) {
    const dir = path.dirname(KEYS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Atomic write: write to temp file then rename
    const tmp = KEYS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(keys, null, 2));
    fs.renameSync(tmp, KEYS_FILE);
}

function isValidKey(apiKey) {
    if (!apiKey || !apiKey.startsWith('xc_')) return false;
    const keys = loadKeys();
    const entry = Object.values(keys).find(e => e.apiKey === apiKey);
    if (!entry) return false;
    // Fix #7 — reject expired keys
    if (entry.expiresAt && Date.now() > entry.expiresAt) return false;
    return true;
}

// Fix #2 — robust wallet extraction from x402 payment header
function extractWallet(req) {
    const header = req.headers['x-payment'] || req.headers['payment-signature'] || '';
    if (!header) return null;
    try {
        const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
        const wallet = decoded?.payload?.authorization?.from
                    || decoded?.authorization?.from
                    || decoded?.from
                    || decoded?.wallet;
        if (wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet)) return wallet.toLowerCase();
    } catch (_) {}
    // Fallback: use SHA-256 of the raw header as a stable dedup key
    // Same payment = same header = same key; prevents double-issuance
    return 'sig_' + crypto.createHash('sha256').update(header).digest('hex').slice(0, 16);
}

// ── Middleware ────────────────────────────────────────────────────────────────

// Fix #9 — explicit CORS config instead of wildcard
app.use(cors({
    origin: '*',                   // x402 agents call from any origin — keep open
    methods: ['GET'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'x-payment', 'payment-signature'],
    exposedHeaders: ['payment-required'],
}));

app.use(express.json());

// x402 paywall
const facilitatorClient = new HTTPFacilitatorClient(cdpFacilitator);
const resourceServer    = new x402ResourceServer(facilitatorClient)
    .register(NETWORK, new ExactEvmScheme());

app.use(
    paymentMiddleware(
        {
            'GET /x-connect/api/unlock': {
                accepts: [
                    {
                        scheme:  'exact',
                        price:   '$59',
                        network: NETWORK,
                        payTo:   RECEIVE_WALLET,
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
    if (!fs.existsSync(SKILL_MD)) return res.status(404).send('skill.md not found');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(SKILL_MD);
});

// Unlock — payment already verified by x402 middleware
app.get('/x-connect/api/unlock', (req, res) => {
    const walletId = extractWallet(req); // Fix #2

    if (!walletId) {
        return res.status(400).json({ error: 'Could not identify payment source.' });
    }

    // Fix #4 — lock this wallet for the duration of the check+save
    if (_writeLock.has(walletId)) {
        return res.status(429).json({ error: 'Concurrent request for same wallet. Retry shortly.' });
    }
    _writeLock.add(walletId);

    try {
        const keys = loadKeys();

        // Idempotency: return existing key if already paid
        if (keys[walletId]) {
            const entry = keys[walletId];
            if (!entry.expiresAt || Date.now() <= entry.expiresAt) {
                return res.json({
                    success:     true,
                    alreadyPaid: true,
                    apiKey:      entry.apiKey,
                    downloadUrl: `https://aptum.fun/x-connect/api/download?key=${entry.apiKey}`,
                    message:     'You already have an active key for this wallet.',
                });
            }
        }

        // Issue new key
        const apiKey    = 'xc_' + crypto.randomBytes(32).toString('hex');
        const now       = Date.now();
        const clientIp  = req.ip || req.headers['x-forwarded-for'] || 'unknown'; // Fix #8

        keys[walletId] = {
            apiKey,
            timestamp:  now,
            expiresAt:  now + KEY_EXPIRY_MS, // Fix #7
            ip:         clientIp,             // Fix #8
            downloads:  0,                    // Fix #5
        };

        saveKeys(keys);

        console.log(`[x402] New unlock — id: ${walletId.slice(0, 14)} | ip: ${clientIp} | key: ${apiKey.slice(0, 12)}...`);

        return res.json({
            success:     true,
            apiKey,
            downloadUrl: `https://aptum.fun/x-connect/api/download?key=${apiKey}`,
            instructions: [
                '1. Save your API key — it will not be shown again.',
                '2. Download: GET /x-connect/api/download?key=<YOUR_KEY>',
                '3. Extract and run: npm install && node scripts/x-feed-engage.js',
            ],
            docs: 'https://aptum.fun/x-connect/skill.md',
        });

    } finally {
        _writeLock.delete(walletId); // Fix #4 — always release lock
    }
});

// Download — requires valid API key, enforces download limit
app.get('/x-connect/api/download', (req, res) => {
    const { key } = req.query;

    if (!key || !key.startsWith('xc_')) {
        return res.status(401).json({
            error:    'Invalid or missing API key.',
            howToGet: 'Send GET /x-connect/api/unlock with $59 USDC on Base to receive your key.',
        });
    }

    const keys   = loadKeys();
    const entry  = Object.entries(keys).find(([, e]) => e.apiKey === key);

    if (!entry) {
        return res.status(401).json({ error: 'Key not found.' });
    }

    const [walletId, record] = entry;

    // Fix #7 — check expiry
    if (record.expiresAt && Date.now() > record.expiresAt) {
        return res.status(403).json({ error: 'Key has expired.' });
    }

    // Fix #5 — enforce download limit
    if (record.downloads >= MAX_DOWNLOADS) {
        return res.status(403).json({
            error: `Download limit reached (${MAX_DOWNLOADS}). Contact support if you need a re-download.`,
        });
    }

    if (!fs.existsSync(PACKAGE_ZIP)) {
        return res.status(503).json({ error: 'Package not yet built. Try again shortly.' });
    }

    // Increment download count atomically
    if (!_writeLock.has(walletId)) {
        _writeLock.add(walletId);
        try {
            const fresh = loadKeys();
            if (fresh[walletId]) {
                fresh[walletId].downloads = (fresh[walletId].downloads || 0) + 1;
                saveKeys(fresh);
            }
        } finally {
            _writeLock.delete(walletId);
        }
    }

    console.log(`[download] Key ${key.slice(0, 12)}... download #${record.downloads + 1}`);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="x-connect.zip"');
    fs.createReadStream(PACKAGE_ZIP).pipe(res);
});

// Verify key
app.get('/x-connect/api/verify', (req, res) => {
    const key = req.query.key || req.headers['x-api-key'];
    res.json({ valid: isValidKey(key) });
});

// Health check
app.get('/x-connect/api/health', (req, res) => {
    res.json({
        status:  'ok',
        network: USE_TESTNET ? 'base-sepolia (testnet)' : 'base-mainnet',
        price:   '$59 USDC',
        payTo:   RECEIVE_WALLET,
        agents:  Object.keys(loadKeys()).length,
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
