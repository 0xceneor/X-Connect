/**
 * api-server.js — REST API server for multi-tenant x-connect.
 *
 * Endpoints:
 *   POST   /api/clients/register       Register a new client
 *   POST   /api/sessions/start         Start engagement session
 *   POST   /api/sessions/stop          Stop engagement session
 *   GET    /api/sessions/status         Get session status
 *   GET    /api/sessions/list           List all active sessions
 *   GET    /api/clients/:id/logs        Get recent logs
 *   GET    /api/clients/:id/stats       Get engagement stats
 *
 * Usage:
 *   node scripts/api-server.js
 *   node scripts/api-server.js --port 3000
 *
 * Auth:
 *   All endpoints require Authorization: Bearer <api-key>
 *   The master key (MASTER_API_KEY in .env) can access all clients.
 *   Per-client keys are generated on registration and stored in config.json.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const im = require('./instance-manager');

const app = express();
app.use(cors());
app.use(express.json());

const CLIENTS_DIR = path.join(__dirname, '..', 'clients');
const PORT = parseInt(process.argv.includes('--port') ?
    process.argv[process.argv.indexOf('--port') + 1] : (process.env.API_PORT || '3000'), 10);
const MASTER_KEY = process.env.MASTER_API_KEY || crypto.randomBytes(24).toString('hex');

if (!process.env.MASTER_API_KEY) {
    console.log(`\n⚠️  No MASTER_API_KEY in .env — generated one for this session:`);
    console.log(`   ${MASTER_KEY}`);
    console.log(`   Add MASTER_API_KEY=${MASTER_KEY} to .env to persist it.\n`);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function generateApiKey() {
    return 'xc_' + crypto.randomBytes(20).toString('hex');
}

function loadClientConfig(clientId) {
    const configPath = path.join(CLIENTS_DIR, clientId, 'config.json');
    if (!fs.existsSync(configPath)) return null;
    try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (_) { return null; }
}

function saveClientConfig(clientId, config) {
    const dir = path.join(CLIENTS_DIR, clientId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
}

// ── Auth middleware ──────────────────────────────────────────────────────

function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

    // Master key — full access
    if (token === MASTER_KEY) {
        req.isMaster = true;
        return next();
    }

    // Per-client key — extract clientId from request
    const clientId = req.body?.clientId || req.query?.clientId || req.params?.id;
    if (!clientId) return res.status(401).json({ error: 'Invalid API key' });

    const config = loadClientConfig(clientId);
    if (!config || config.apiKey !== token) {
        return res.status(401).json({ error: 'Invalid API key' });
    }

    req.clientId = clientId;
    req.clientConfig = config;
    return next();
}

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// ── Register a new client ────────────────────────────────────────────────

app.post('/api/clients/register', auth, (req, res) => {
    if (!req.isMaster) return res.status(403).json({ error: 'Only master key can register clients' });

    const { clientId, name } = req.body;
    if (!clientId || !/^[a-zA-Z0-9_-]{2,30}$/.test(clientId)) {
        return res.status(400).json({ error: 'clientId must be 2-30 chars, alphanumeric/dash/underscore' });
    }

    const existing = loadClientConfig(clientId);
    if (existing) return res.status(409).json({ error: `Client ${clientId} already exists` });

    const apiKey = generateApiKey();
    const config = {
        apiKey,
        name: name || clientId,
        defaultMode: 'api',
        defaultQuota: 50,
        minPause: 25,
        maxPause: 55,
        createdAt: new Date().toISOString(),
    };

    saveClientConfig(clientId, config);

    res.json({
        ok: true,
        clientId,
        apiKey,
        message: `Client registered. Save this API key — it won't be shown again.`,
    });
});

// ── Save client credentials ──────────────────────────────────────────────

app.post('/api/clients/:id/credentials', auth, (req, res) => {
    const clientId = req.params.id;
    const clientDir = path.join(CLIENTS_DIR, clientId);
    if (!fs.existsSync(clientDir)) return res.status(404).json({ error: 'Client not found' });

    // Allow master or the client itself
    if (!req.isMaster && req.clientId !== clientId) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const { consumer_key, consumer_secret, access_token, access_token_secret, bearer_token } = req.body;
    if (!consumer_key || !consumer_secret || !access_token || !access_token_secret) {
        return res.status(400).json({ error: 'Missing required fields: consumer_key, consumer_secret, access_token, access_token_secret' });
    }

    const creds = { consumer_key, consumer_secret, access_token, access_token_secret };
    if (bearer_token) creds.bearer_token = bearer_token;

    fs.writeFileSync(path.join(clientDir, 'credentials.json'), JSON.stringify(creds, null, 4));
    res.json({ ok: true, message: 'Credentials saved' });
});

// ── Save client cookies ──────────────────────────────────────────────────

app.post('/api/clients/:id/cookies', auth, (req, res) => {
    const clientId = req.params.id;
    const clientDir = path.join(CLIENTS_DIR, clientId);
    if (!fs.existsSync(clientDir)) return res.status(404).json({ error: 'Client not found' });

    if (!req.isMaster && req.clientId !== clientId) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const cookies = req.body.cookies;
    if (!Array.isArray(cookies)) {
        return res.status(400).json({ error: 'cookies must be an array' });
    }

    fs.writeFileSync(path.join(clientDir, 'cookies.json'), JSON.stringify(cookies, null, 2));
    res.json({ ok: true, message: `${cookies.length} cookies saved` });
});

// ── Start session ────────────────────────────────────────────────────────

app.post('/api/sessions/start', auth, (req, res) => {
    const clientId = req.body.clientId;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    if (!req.isMaster && req.clientId !== clientId) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    // Check credentials exist
    const credsPath = path.join(CLIENTS_DIR, clientId, 'credentials.json');
    if (!fs.existsSync(credsPath)) {
        return res.status(400).json({ error: 'No credentials found. Upload X API keys first via POST /api/clients/:id/credentials' });
    }

    const config = loadClientConfig(clientId) || {};
    const opts = {
        mode: req.body.mode || config.defaultMode || 'api',
        quota: req.body.quota || config.defaultQuota || 50,
        minPause: req.body.minPause || config.minPause || 25,
        maxPause: req.body.maxPause || config.maxPause || 55,
        search: req.body.search || null,
        likeOnly: req.body.likeOnly || false,
        dryRun: req.body.dryRun || false,
        verbose: req.body.verbose || false,
        listUrl: req.body.listUrl || null,
    };

    const result = im.start(clientId, opts);
    res.status(result.ok ? 200 : 409).json(result);
});

// ── Stop session ─────────────────────────────────────────────────────────

app.post('/api/sessions/stop', auth, (req, res) => {
    const clientId = req.body.clientId;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    if (!req.isMaster && req.clientId !== clientId) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const result = im.stop(clientId);
    res.status(result.ok ? 200 : 404).json(result);
});

// ── Session status ───────────────────────────────────────────────────────

app.get('/api/sessions/status', auth, (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) return res.status(400).json({ error: 'clientId query param required' });
    if (!req.isMaster && req.clientId !== clientId) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const status = im.getStatus(clientId);
    if (!status) return res.status(404).json({ error: 'No session found' });
    res.json(status);
});

// ── List all sessions (master only) ──────────────────────────────────────

app.get('/api/sessions/list', auth, (req, res) => {
    if (!req.isMaster) return res.status(403).json({ error: 'Master key required' });
    res.json({ sessions: im.listAll(), maxInstances: im.MAX_INSTANCES });
});

// ── Client logs ──────────────────────────────────────────────────────────

app.get('/api/clients/:id/logs', auth, (req, res) => {
    const clientId = req.params.id;
    if (!req.isMaster && req.clientId !== clientId) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const lines = parseInt(req.query.lines || '50', 10);

    // First try live output buffer
    const liveLines = im.getRecentOutput(clientId, lines);
    if (liveLines.length > 0) {
        return res.json({ source: 'live', lines: liveLines });
    }

    // Fall back to log file
    const logFile = path.join(CLIENTS_DIR, clientId, 'engage.log');
    if (!fs.existsSync(logFile)) return res.status(404).json({ error: 'No logs found' });

    try {
        const content = fs.readFileSync(logFile, 'utf8');
        const allLines = content.split('\n').filter(l => l.trim());
        return res.json({ source: 'file', lines: allLines.slice(-lines) });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to read logs' });
    }
});

// ── Client stats ─────────────────────────────────────────────────────────

app.get('/api/clients/:id/stats', auth, (req, res) => {
    const clientId = req.params.id;
    if (!req.isMaster && req.clientId !== clientId) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const clientDir = path.join(CLIENTS_DIR, clientId);
    if (!fs.existsSync(clientDir)) return res.status(404).json({ error: 'Client not found' });

    // Today's progress
    const today = new Date().toISOString().slice(0, 10);
    const progressFile = path.join(clientDir, `feed-progress-${today}.json`);
    let todayStats = { liked: 0, commented: 0, skipped: 0, errors: 0 };
    if (fs.existsSync(progressFile)) {
        try { todayStats = JSON.parse(fs.readFileSync(progressFile, 'utf8')); } catch (_) { }
    }

    // Replied data
    const repliedFile = path.join(clientDir, 'replied.json');
    let totalReplies = 0;
    if (fs.existsSync(repliedFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(repliedFile, 'utf8'));
            totalReplies = data.totalReplies || data.entries?.length || 0;
        } catch (_) { }
    }

    // Session status
    const session = im.getStatus(clientId);

    res.json({
        clientId,
        today: {
            date: today,
            liked: todayStats.liked || 0,
            commented: todayStats.commented || 0,
            skipped: todayStats.skipped || 0,
            errors: todayStats.errors || 0,
        },
        totalReplies,
        session: session || { status: 'inactive' },
    });
});

// ── List all clients (master only) ───────────────────────────────────────

app.get('/api/clients', auth, (req, res) => {
    if (!req.isMaster) return res.status(403).json({ error: 'Master key required' });

    if (!fs.existsSync(CLIENTS_DIR)) return res.json({ clients: [] });

    const clients = [];
    for (const dir of fs.readdirSync(CLIENTS_DIR)) {
        const config = loadClientConfig(dir);
        if (config) {
            clients.push({
                clientId: dir,
                name: config.name,
                createdAt: config.createdAt,
                hasCredentials: fs.existsSync(path.join(CLIENTS_DIR, dir, 'credentials.json')),
                hasCookies: fs.existsSync(path.join(CLIENTS_DIR, dir, 'cookies.json')),
                session: im.getStatus(dir) || { status: 'inactive' },
            });
        }
    }

    res.json({ clients });
});

// ── Health check ─────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        activeSessions: im.listAll().filter(s => s.status === 'running').length,
        maxInstances: im.MAX_INSTANCES,
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// SERVE DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.html');

// Serve dashboard at root
app.get('/', (req, res) => {
    res.sendFile(DASHBOARD_PATH);
});

app.get('/dashboard', (req, res) => {
    res.sendFile(DASHBOARD_PATH);
});

// ═══════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down — stopping all sessions...');
    im.stopAll();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down — stopping all sessions...');
    im.stopAll();
    process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  🚀 X-Connect API Server`);
    console.log(`  📡 Port: ${PORT}`);
    console.log(`  🔑 Master Key: ${MASTER_KEY.slice(0, 8)}...`);
    console.log(`  📁 Clients Dir: ${CLIENTS_DIR}`);
    console.log(`  🧵 Max Instances: ${im.MAX_INSTANCES}`);
    console.log(`${'═'.repeat(50)}\n`);
});
