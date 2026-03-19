/**
 * x-feed-engage.js — Scroll home feed, find fresh posts, like + comment, stop at daily quota.
 *
 * Usage:
 *   node x-feed-engage.js                          Default: 150 daily quota, 3hr max age
 *   node x-feed-engage.js --quota 200              Set daily quota
 *   node x-feed-engage.js --max-age 30             Max tweet age in minutes (default: 180)
 *   node x-feed-engage.js --like-only              Skip commenting, just like
 *   node x-feed-engage.js --dry-run                 Scroll and find tweets but don't engage
 *   node x-feed-engage.js --resume                  Resume from today's progress file
 *   node x-feed-engage.js --min-pause 10           Min pause between actions in seconds (default: 25)
 *   node x-feed-engage.js --max-pause 30           Max pause between actions in seconds (default: 55)
 *   node x-feed-engage.js --list URL               Engage from an X list instead of home feed
 *
 * Features:
 *   - Scrolls X.com/home feed naturally (human-like scroll pacing)
 *   - Filters tweets ≤3 hours old (configurable)
 *   - Likes via keyboard (L key) with verification
 *   - Generates AI replies via NVIDIA API
 *   - Tracks daily progress (persists across restarts)
 *   - Stops when daily quota is met
 *   - Full debug logging and screenshots on error
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const puppeteer = require('puppeteer-core');
const OpenAI = require('openai').default || require('openai');
let dune;
let news;
try { dune = require('../../dune-api/dune'); } catch (_) { dune = null; }
try { news = require('./news'); } catch (_) { news = null; }
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ── Config ──────────────────────────────────────────────────────────────
const USER_DATA_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw', 'x-profile-v2');
const DEBUG_DIR = path.join(__dirname, '..', 'debug');
const LOG_FILE = path.join(DEBUG_DIR, 'x-feed-engage.log');
const COOKIES_PATH = path.join(__dirname, 'cookies.json');
const REPLIED_FILE = path.join(DEBUG_DIR, 'replied.json');

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
if (!NVIDIA_API_KEY) { console.error('❌ NVIDIA_API_KEY not set in .env'); process.exit(1); }

// ── OpenAI SDK client pointed at NVIDIA ────────────────────────────────
const openai = new OpenAI({
    apiKey: NVIDIA_API_KEY,
    baseURL: 'https://integrate.api.nvidia.com/v1',
    timeout: 30000,         // 30s hard timeout (fast-fail)
    maxRetries: 1,          // single retry on failure
});

// kimi-k2-instruct: fastest working model on NIM (6s avg vs 73s+ for 0905 variant)
const NVIDIA_MODEL = 'moonshotai/kimi-k2-instruct';

if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

// ── Parse args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, fallback) {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const DAILY_QUOTA = parseInt(getArg('quota', '150'), 10) || 150;
const MAX_AGE_MIN = parseInt(getArg('max-age', '180'), 10) || 180;
const LIKE_ONLY = args.includes('--like-only');
const DRY_RUN = args.includes('--dry-run');
const RESUME = !args.includes('--no-resume');
const MIN_PAUSE = (parseInt(getArg('min-pause', '25'), 10) || 25) * 1000;
const MAX_PAUSE = (parseInt(getArg('max-pause', '60'), 10) || 60) * 1000;
const LIST_URL = getArg('list', null);
const FEED_URL = LIST_URL || 'https://x.com/home';
const REPLY_BACK = args.includes('--reply-back');
const RB_LIMIT = parseInt(getArg('rb-limit', '20'), 10) || 20;

// ── Progress tracking ───────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const PROGRESS_FILE = path.join(DEBUG_DIR, `feed-progress-${today}.json`);

function loadProgress() {
    if (RESUME && fs.existsSync(PROGRESS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
            if (data.date === today) return data;
        } catch (_) { /* ignore */ }
    }
    return {
        date: today,
        liked: 0,
        commented: 0,
        skipped: 0,
        errors: 0,
        seenTweetIds: [],
        startedAt: new Date().toISOString(),
        lastAction: null,
    };
}

function saveProgress(progress) {
    if (progress.seenTweetIds.length > 5000) {
        progress.seenTweetIds = progress.seenTweetIds.slice(-5000);
    }
    progress.lastAction = new Date().toISOString();
    try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2)); } catch (_) { /* ignore */ }
}

// ── Helpers ─────────────────────────────────────────────────────────────
function log(level, msg) {
    const entry = `[${new Date().toISOString()}] [${level}] ${msg}`;
    console.log(entry);
    try { fs.appendFileSync(LOG_FILE, entry + '\n'); } catch (_) { /* ignore */ }
}

function findChrome() {
    if (process.platform === 'linux') {
        const paths = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome-stable'];
        for (const p of paths) { if (fs.existsSync(p)) return p; }
        try { return execSync('which google-chrome').toString().trim(); } catch (_) { return null; }
    }
    const suffixes = ['\\Google\\Chrome\\Application\\chrome.exe', '\\Microsoft\\Edge\\Application\\msedge.exe'];
    const prefixes = [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']];
    for (const prefix of prefixes) {
        if (!prefix) continue;
        for (const suffix of suffixes) {
            const p = path.join(prefix, suffix);
            if (fs.existsSync(p)) return p;
        }
    }
    return null;
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const randWait = (min, max) => wait(Math.floor(Math.random() * (max - min)) + min);

// ── Anti-detection pools ─────────────────────────────────────────────────
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.140 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.116 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
];
const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
];
const SESSION_UA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const SESSION_VP = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];

// Simulate human mouse movement to random positions
async function humanMouseMove(page) {
    try {
        const steps = Math.floor(Math.random() * 3) + 2;
        for (let i = 0; i < steps; i++) {
            const x = Math.floor(Math.random() * (SESSION_VP.width - 200)) + 100;
            const y = Math.floor(Math.random() * (SESSION_VP.height - 200)) + 100;
            await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
            await wait(Math.random() * 200 + 50);
        }
    } catch (_) { /* ignore if page navigated */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL PIPELINE — Kimi K2 via OpenAI SDK (streaming to avoid timeouts)
// ═══════════════════════════════════════════════════════════════════════════

const tokenUsage = { calls: 0, prompt: 0, completion: 0, total: 0 };

function logTokenUsage() {
    log('INFO', `📈 Tokens — ${tokenUsage.total} total (${tokenUsage.calls} calls, ${tokenUsage.prompt} prompt, ${tokenUsage.completion} completion)`);
}

/**
 * Call the model using the OpenAI SDK with streaming.
 * Streaming prevents gateway timeouts on slow/large responses.
 * The SDK handles 429 retries automatically (up to maxRetries).
 */
async function callModel(model, messages, temperature = 0.3, maxTokens = 200) {
    try {
        let fullContent = '';
        let usage = null;

        const stream = await openai.chat.completions.create({
            model,
            messages,
            temperature,
            top_p: 0.9,
            max_tokens: maxTokens,
            stream: true,
            stream_options: { include_usage: true },
            // NOTE: chat_template_kwargs removed — caused 400 errors on this model
        });

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) fullContent += delta;

            // Usage comes in the final chunk when stream_options.include_usage is set
            if (chunk.usage) usage = chunk.usage;
        }

        if (usage) {
            tokenUsage.calls++;
            tokenUsage.prompt += usage.prompt_tokens || 0;
            tokenUsage.completion += usage.completion_tokens || 0;
            tokenUsage.total += usage.total_tokens || 0;
        } else {
            // Estimate if usage not returned
            tokenUsage.calls++;
        }

        return fullContent.trim() || null;

    } catch (err) {
        const status = err?.status || err?.statusCode;
        const message = err?.message || String(err);

        if (status === 429) {
            // SDK already retried maxRetries times; log and give up gracefully
            log('WARN', `  ⚠️ Rate limited (429) after retries: ${message}`);
        } else if (status === 400) {
            log('WARN', `  ⚠️ Bad request (400): ${message} — check model name and parameters`);
        } else if (status >= 500) {
            log('WARN', `  ⚠️ Server error (${status}): ${message}`);
        } else {
            log('WARN', `  ⚠️ API error: ${message}`);
        }
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// VISION — describe tweet images before classify/reply pipeline
// Uses a separate multimodal model so Kimi (text-only) never receives images.
// Result is a plain-text description injected as [IMAGE: ...] context.
// ═══════════════════════════════════════════════════════════════════════════

// phi-4-multimodal-instruct for vision (kimi-k2.5 vision is broken on NIM)
const VISION_MODEL = 'microsoft/phi-4-multimodal-instruct';

const VISION_SYSTEM_PROMPT = `You are a concise image analyst for a crypto/web3 social media bot.
Describe what you see in 1-2 sentences. Focus on: charts/price data, token names, memes, text overlays, people, news screenshots, or any crypto/finance context visible.
Be factual and terse. No preamble like "The image shows" — just describe directly.
If multiple images, describe each briefly separated by " | ".`;

/**
 * Calls the vision model to describe tweet images.
 * Returns a short string like "Price chart showing BTC dump to $58k | Meme of crying trader"
 * or null if no images, vision call fails, or images are non-informative.
 */
async function describeImages(imageUrls) {
    if (!imageUrls || imageUrls.length === 0) return null;
    const urls = imageUrls.slice(0, 2); // max 2 images per call

    try {
        const content = [
            { type: 'text', text: 'Describe these tweet images for crypto/web3 context:' },
            ...urls.map(url => ({ type: 'image_url', image_url: { url } }))
        ];

        // Vision model does NOT stream well with some NVIDIA endpoints — use non-streaming
        const response = await openai.chat.completions.create({
            model: VISION_MODEL,
            messages: [
                { role: 'system', content: VISION_SYSTEM_PROMPT },
                { role: 'user', content }
            ],
            temperature: 0.1,
            max_tokens: 120,
            stream: false,
        });

        const desc = response.choices?.[0]?.message?.content?.trim();
        if (response.usage) {
            tokenUsage.calls++;
            tokenUsage.prompt += response.usage.prompt_tokens || 0;
            tokenUsage.completion += response.usage.completion_tokens || 0;
            tokenUsage.total += response.usage.total_tokens || 0;
        }

        return desc && desc.length > 3 ? desc : null;
    } catch (err) {
        const msg = err?.message || String(err);
        // Don't hard-fail — vision is enhancement only
        log('WARN', `  ⚠️ Vision model error: ${msg.substring(0, 100)}`);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSIFY PIPELINE — single API call does bait filter + context analysis
// Kimi is TEXT-ONLY. Images are described by the vision model first,
// then injected as plain text context.
// ═══════════════════════════════════════════════════════════════════════════

const CLASSIFY_PROMPT = `You are a tweet classifier for an engagement bot. Given a tweet, output exactly 5 lines in this order. Use ONLY the listed values. No extra text.

SIGNAL: SKIP | PASS | SHILL
TOPIC: crypto | defi | web3 | finance | business | tech | ai | news | career | motivational | politics | religion | personal | humor | lifestyle | shilling | other
TONE: serious | funny | vulnerable | hype | angry | casual | informational | emotional | sarcastic
INTENT: genuine-expression | sharing-news | asking-question | venting | joking | promoting | inspiring | shilling-ticker
REPLY_STYLE: one-liner | short-warm | thoughtful-2-sentences

SIGNAL rules:
- SKIP — engagement bait, follow farming, "like if you agree", "RT if", obvious clout chase, no substance
- SHILL — clearly shilling a ticker, "what should I buy", "shill me" — high reply-opportunity
- PASS — everything else worth engaging

TOPIC hints:
- Memecoins, tokens, price dumps, bags, trading = crypto
- War, geopolitics, macro events = news (not politics, unless purely partisan)
- Solana, Ethereum, smart contracts, blockchain dev = tech or crypto
- Prediction markets, macro reactions = news or finance
- Use "other" ONLY when nothing fits`;

const ENGAGEMENT_TIERS = {
    crypto: 0.95, defi: 0.95, web3: 0.95,
    business: 0.95, finance: 0.90,
    tech: 0.90, ai: 0.90,
    shilling: 0.95,
    news: 0.95, career: 0.40,
    motivational: 0.10, lifestyle: 0.10,
    politics: 0.50, religion: 0.05, personal: 0.05,
    humor: 0.60, other: 0.70,
};

const KNOWN_SIGNALS = new Set(['SKIP', 'PASS', 'SHILL']);
const KNOWN_TOPICS = new Set(Object.keys(ENGAGEMENT_TIERS));
const KNOWN_TONES = new Set(['serious', 'funny', 'vulnerable', 'hype', 'angry', 'casual', 'informational', 'emotional', 'sarcastic']);
const KNOWN_INTENTS = new Set(['genuine-expression', 'sharing-news', 'asking-question', 'venting', 'joking', 'promoting', 'inspiring', 'shilling-ticker']);
const KNOWN_STYLES = new Set(['one-liner', 'short-warm', 'thoughtful-2-sentences']);

function normalizeVal(val, knownSet, fallback) {
    if (!val || typeof val !== 'string') return fallback;
    const v = val.toLowerCase().trim().replace(/\s+/g, '-');
    if (knownSet.has(v)) return v;
    // case-insensitive exact match (for SIGNAL which is uppercase)
    for (const k of knownSet) { if (k.toLowerCase() === v) return k; }
    // prefix match
    for (const k of knownSet) { if (k.toLowerCase().startsWith(v) || v.startsWith(k.toLowerCase())) return k; }
    return fallback;
}

function getEngageRate(topic, intent = '') {
    if (intent === 'shilling-ticker') return 0.95;
    return ENGAGEMENT_TIERS[topic] ?? 0.20;
}

/**
 * Single API call: bait filter + context classification combined.
 * Returns { signal, topic, tone, intent, replyStyle }
 * imageDesc is a plain-text description from the vision model (or null).
 * Raw image URLs are NEVER sent here — Kimi is text-only.
 */
async function classifyTweet(tweetText, author, imageDesc = null) {
    let userMsg = `@${author}: "${(tweetText || '').substring(0, 300)}"`;
    if (imageDesc) userMsg += `\n[IMAGE CONTEXT: ${imageDesc}]`;

    const result = await callModel(NVIDIA_MODEL, [
        { role: 'system', content: CLASSIFY_PROMPT },
        { role: 'user', content: userMsg }
    ], 0.1, 80);

    // Defaults
    const out = { signal: 'PASS', intentNote: null, topic: 'other', tone: 'casual', intent: 'genuine-expression', replyStyle: 'one-liner' };
    if (!result || typeof result !== 'string') return out;

    for (const line of result.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx <= 0) continue;
        const key = trimmed.substring(0, colonIdx).trim().toLowerCase().replace(/[_\s]/g, '');
        const rawVal = trimmed.substring(colonIdx + 1).trim();
        const firstToken = rawVal.split(/[\s,;|]+/)[0].replace(/[^a-zA-Z0-9_-]/g, '');
        switch (key) {
            case 'signal': out.signal = normalizeVal(firstToken, KNOWN_SIGNALS, 'PASS'); break;
            case 'topic': out.topic = normalizeVal(firstToken, KNOWN_TOPICS, 'other'); break;
            case 'tone': out.tone = normalizeVal(firstToken, KNOWN_TONES, 'casual'); break;
            case 'intent': out.intent = normalizeVal(firstToken, KNOWN_INTENTS, 'genuine-expression'); break;
            case 'replystyle':
            case 'reply_style': out.replyStyle = normalizeVal(firstToken, KNOWN_STYLES, 'one-liner'); break;
        }
    }

    // Post-hoc keyword topic override when model falls back to "other"
    if (out.topic === 'other') {
        const t = (tweetText || '').toLowerCase();
        if (/\b(breaking|war|explosion|missile|strike|attack|sanctions|invasion|ceasefire|airstrike|troops|military|nato|escalat|casualties)\b/i.test(t)) out.topic = 'news';
        else if (/\b(bitcoin|btc|ethereum|eth|solana|sol|memecoin|altcoin|token|dex|defi|nft|airdrop|staking|blockchain|web3|onchain|rug|honeypot|pump|dump|bags|sats|gwei|whale|hodl|degen)\b/i.test(t)) out.topic = 'crypto';
        else if (/\b(market|stocks|fed|interest rate|inflation|gdp|earnings|ipo|etf|bond|treasury|recession|bull|bear|rally|crash|dow|nasdaq|s&p|oil|gold)\b/i.test(t)) out.topic = 'finance';
        else if (/\b(ai |artificial intelligence|llm|gpt|neural|model|agent|autonomous|robotics|machine learning|deep learning|training|inference|compute)\b/i.test(t)) out.topic = 'ai';
    }

    return out;
}

// ── Dune ───────────────────────────────────────────────────────────────
const DUNE_TOPICS = new Set(['crypto', 'defi', 'web3', 'finance', 'shilling']);
const DUNE_KEYWORDS = /\b(dex|volume|tvl|liquidity|trading|swap|uniswap|aave|lido|market cap|whale|onchain|on-chain|defi|nft sales|gas|fees|gwei|solana|ethereum|arbitrum|base|layer 2|l2|market|price)\b/i;

async function fetchDuneContext(tweetText, analysis) {
    if (!dune || !analysis || !DUNE_TOPICS.has(analysis.topic)) return null;
    if (!DUNE_KEYWORDS.test(tweetText || '')) return null;

    try {
        log('INFO', `  📊 Querying Dune for onchain context...`);
        const text = (tweetText || '').toLowerCase();

        let sql, label;

        if (/\b(dex|volume|swap|uniswap|trading)\b/i.test(text)) {
            sql = `SELECT project, ROUND(sum(amount_usd)/1e6, 1) as volume_millions FROM dex.trades WHERE block_time > now() - interval '1' day AND blockchain = 'ethereum' GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;
            label = 'Top ETH DEX volume (24h)';
        } else if (/\b(gas|fees|gwei)\b/i.test(text)) {
            sql = `SELECT DATE_TRUNC('hour', block_time) as hour, ROUND(AVG(gas_price/1e9), 1) as avg_gwei FROM ethereum.transactions WHERE block_time > now() - interval '6' hour GROUP BY 1 ORDER BY 1 DESC LIMIT 6`;
            label = 'ETH gas prices (last 6h)';
        } else if (/\b(nft|opensea|blur|marketplace)\b/i.test(text)) {
            sql = `SELECT project, ROUND(sum(amount_usd)/1e6, 1) as volume_millions FROM nft.trades WHERE block_time > now() - interval '1' day GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;
            label = 'Top NFT marketplace volume (24h)';
        } else if (/\b(whale|large transfer|big move)\b/i.test(text)) {
            sql = `SELECT block_time, ROUND(value/1e18, 0) as eth_amount FROM ethereum.transactions WHERE block_time > now() - interval '4' hour AND value > 500 * 1e18 ORDER BY value DESC LIMIT 5`;
            label = 'Recent whale ETH transfers (>500 ETH)';
        } else if (/\b(solana|sol)\b/i.test(text)) {
            sql = `SELECT project, ROUND(sum(amount_usd)/1e6, 1) as volume_millions FROM dex.trades WHERE block_time > now() - interval '1' day AND blockchain = 'solana' GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;
            label = 'Top Solana DEX volume (24h)';
        } else if (/\b(arbitrum|arb)\b/i.test(text)) {
            sql = `SELECT project, ROUND(sum(amount_usd)/1e6, 1) as volume_millions FROM dex.trades WHERE block_time > now() - interval '1' day AND blockchain = 'arbitrum' GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;
            label = 'Top Arbitrum DEX volume (24h)';
        } else if (/\b(base)\b/i.test(text)) {
            sql = `SELECT project, ROUND(sum(amount_usd)/1e6, 1) as volume_millions FROM dex.trades WHERE block_time > now() - interval '1' day AND blockchain = 'base' GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;
            label = 'Top Base DEX volume (24h)';
        } else {
            sql = `SELECT blockchain, ROUND(sum(amount_usd)/1e9, 2) as volume_billions FROM dex.trades WHERE block_time > now() - interval '1' day GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;
            label = 'DEX volume by chain (24h)';
        }

        const rows = await dune.sql(sql, { limit: 5, performance: 'medium', timeout: 90000 });
        if (!rows || rows.length === 0) return null;

        const dataStr = rows.map(r => Object.values(r).join(': ')).join(' | ');
        const context = `[DUNE DATA - ${label}]: ${dataStr}`;
        log('INFO', `  📊 Dune: ${context.substring(0, 120)}...`);
        return context;
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        log('WARN', `  ⚠️ Dune query failed: ${msg}`);
        return null;
    }
}

/**
 * Clean reply text — strip competing tickers but keep coin names natural.
 * $A is always preserved. Other $TICKERS are stripped to avoid looking like
 * we're shilling someone else's token. Coin names (Bitcoin, Ethereum, etc.)
 * are kept as-is for natural reading.
 */
function cleanReply(text) {
    if (!text || typeof text !== 'string') return '';

    // Competing chain/coin names to strip — these should never appear in our replies
    const BLOCKED_COINS = [
        'cardano', 'ada', 'solana', 'sol', 'polkadot', 'dot',
        'avalanche', 'avax', 'tron', 'trx', 'bnb', 'xrp', 'ripple',
        'dogecoin', 'doge', 'shiba', 'shib', 'litecoin', 'ltc',
        'toncoin', 'ton', 'cosmos', 'atom', 'near', 'algorand', 'algo',
        'fantom', 'ftm', 'hedera', 'hbar', 'sui', 'aptos', 'apt',
        'sei', 'injective', 'inj', 'kaspa', 'kas',
    ];
    const blockedRe = new RegExp(
        `\\b(${BLOCKED_COINS.join('|')})\\b`,
        'gi'
    );

    return text
        // Strip $TICKERS that aren't $A (avoid shilling other tokens)
        .replace(/\$([A-Za-z]{2,10})\b/g, (m, ticker) => /^a$/i.test(ticker) ? m : '')
        // Strip competing chain/coin names
        .replace(blockedRe, '')
        // Clean up orphaned/mismatched quotes
        .replace(/^["'\u201C\u201D\u2018\u2019]+|["'\u201C\u201D\u2018\u2019]+$/g, '')
        // Remove em dashes -> comma or nothing
        .replace(/\s*[\u2014\u2014]+\s*/g, ', ')
        .replace(/, ,/g, ',')
        // Strip markdown formatting
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        // Strip model prefixes
        .replace(/^(reply|response|here'?s? ?(my|the)? ?reply|answer)[:\s]*/i, '')
        // Fix double spaces (from stripped words)
        .replace(/  +/g, ' ')
        // Fix year references
        .replace(/\b202[45]\b/g, '2026')
        .trim();
}

function loadReplied() {
    if (fs.existsSync(REPLIED_FILE)) {
        try { return JSON.parse(fs.readFileSync(REPLIED_FILE, 'utf8')); } catch (_) { /* ignore */ }
    }
    return { version: 1, totalReplies: 0, entries: [] };
}
const repliedData = loadReplied();

function saveReply(entry) {
    repliedData.totalReplies++;
    repliedData.entries.push(entry);
    try { fs.writeFileSync(REPLIED_FILE, JSON.stringify(repliedData, null, 2)); } catch (_) { /* ignore */ }
}

function loadReplyPrompt() {
    const p = path.join(__dirname, '..', 'reply-prompt.md');
    try {
        if (fs.existsSync(p)) {
            let content = fs.readFileSync(p, 'utf8');
            // Strip YAML frontmatter only if it starts at position 0 (no m flag — ^ = string start)
            content = content.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
            // Strip trailing pipeline note (last --- + italic line)
            content = content.replace(/\n---\s*\n\*[^*]+\*\.?\s*$/, '').trim();
            return content;
        }
    } catch (_) { /* ignore */ }
    return null;
}

const REPLY_PROMPT_BASE = loadReplyPrompt();

const REPLY_SYSTEM_PROMPT_INLINE = `You are @aptum_ — a web3 builder and AI agent. Casually sharp, never trying too hard. Crypto-native energy, zero performative hype. You built $A, a revenue-generating AI agent token on Base. 100B fixed supply, non-inflationary. Earns across skill sales, games, and social growth services — revenue flows back to holders through buybacks, burns, and airdrops. The community is at https://aptum.fun/ and the token is live on Base: CA 0xaa681b1D3dE076f2524c94Ceb2Db712878Bb6b07 | chart: https://www.geckoterminal.com/base/pools/0x23e52ed0f63f3663bc5a8b688ac0e1dbafabe928c5a2de552f5f67ac1b33cd4d

CURRENT DATE: ${new Date().toISOString().slice(0, 10)} (the year is 2026 — never reference 2024 or 2025 as the current year)

CORE RULES:
- Write like a builder who's seen it all — calm, dry, occasionally amused.
- Lowercase by default. Intentional misspellings for flair are fine (e.g., "gud tek," "insidoorssssss").
- Slang and web3 jargon are natural — use them where they fit, never force them.
- No emojis unless the original post used them.
- No motivational energy. No life-coach speak. No fake hype.
- Never start a reply trying to sound profound — you're not a thought leader, you're a builder.
- NEVER use em dashes (—)
- NEVER use hashtags
- NEVER promote, recommend, or mention competing L1 chains or their tokens by name (Cardano, Solana, Polkadot, Avalanche, XRP, Tron, Dogecoin, etc.). You only talk about Ethereum, Base, and $A. If someone asks about another chain, deflect or stay neutral without naming it.

REPLY DEPTH — match the weight of the post. NOT everything should be ultra-short:
- Shallow posts (GM, vibes, follow bait, memes): 1-5 words. "gm" / "lol" / "hi" / "no notes"
- Mid-depth posts (crypto takes, market talk, news): 1-2 real sentences with actual substance. Add a perspective or observation the post didn't cover.
- Deep posts (tech analysis, builder updates, AI/web3 discussions, interesting threads): 2-3 sentences. Engage meaningfully. Show you actually understand what they're talking about.
- Ticker shilling / "what should I buy" posts: 1-2 sentences. Mention $A naturally. Don't force it.

$A PROMOTION RULES (IMPORTANT):
- You are the creator of $A — an AI agent token that just launched on Clanker.
- The community is at https://aptum.fun/ — mention it occasionally when it fits naturally, not every time.
- When someone asks "what ticker" / "what to buy" / "shill me" / "which coin" / posts about AI agents or agent tokens, work $A into your reply naturally by casually mentioning it is live and dropping the address.
- Keep it subtle and organic. You're a builder casually mentioning your live token, not a desperate shill bot.
- DON'T force $A into every reply. Only when the context fits: ticker discussions, "what are you building", agent/AI talk, memecoin discussions.
- Good $A mentions: "just launched $A on base, agent token that actually earns: geckoterminal.com/base/pools/..." / "$A is live on base. CA: 0xaa681b1D3dE076f2524c94Ceb2Db712878Bb6b07" / "building $A — AI agent token, revenue goes back to holders. aptum.fun/whitepaper"
- Bad $A mentions: jamming it into unrelated posts, spamming it, making it the entire reply
- Maybe 1 in 3-4 crypto/shilling replies should mention $A. Keep it natural. Drop the aptum.fun URL even more sparingly — only when inviting someone specifically.

TONE BY CATEGORY:
- Follow bait / engagement farming: Dry, unbothered. Avoid trying too hard.
- Crypto / markets: Direct, lightly skeptical, builder-aware. Add real takes, not just vibes.
- Ticker shilling / "shill me" posts: Engage genuinely. Mention $A when it fits. Be a builder who casually drops their project.
- Motivational quotes: Honest — agree with substance or push back briefly. Avoid empty affirmations.
- GM / vibe posts: Chill, quick, natural ("gm pawnie" energy). Avoid over-explaining.
- Builder / tech updates: Observational, adds a layer. Show you understand the tech.
- Personal wins or struggles: Warm, real, short. Avoid unsolicited advice.
- Memes: Match the format — absurdist or dry. Avoid explaining the joke.
- Market drama / scams / rugs: Sarcastic but knowing ("bruh," "honeypot szn"). Avoid moralizing.
- Political: Neutral, dry observer. Never take sides.
- Religious: Human and warm. Never debate.

GOOD REPLIES — tone/style reference only. NEVER copy these. Every reply must be original:
- "GM future millionaires" → "gm, still building"
- "What ticker should I buy?" → "$A on base. agent token that earns: geckoterminal.com/base/pools/..."
- "Shill me a memecoin" → "$A just dropped on base. 0xaa681b1D3dE076f2524c94Ceb2Db712878Bb6b07"
- "AI agents are the future" → "been saying this. $A is live"
- Obvious insider pump → "insidoorssssss"
- Someone gets rugged → say nothing, or a single word of acknowledgment — never mock
- Follow farming post → "hi"
- Builder sharing traction → "potential" or 2-3 sentences engaging with what they built
- Good market analysis → 1-2 sentences adding to their take, "gud tek"
- Tech/AI news → 2-3 sentences with real substance
- Viral meme → "lol" or "no notes"
- Someone asks what you're building → "working on $A, agent token. community at aptum.fun if you want early access"

FINAL RULE: Match the depth of the post. Shallow posts get one-liners. Real content gets real replies. If it doesn't feel like something you'd say in a builder group DM, don't post it.`;

function getReplySystemPrompt() {
    const dateLine = `\n\nCURRENT DATE: ${new Date().toISOString().slice(0, 10)} (the year is 2026 — never reference 2024 or 2025 as the current year)\n`;
    const outputLine = '\n\nRespond with ONLY your reply text. Nothing else. No quotes around it. No labels. Just the reply.';
    if (REPLY_PROMPT_BASE) return REPLY_PROMPT_BASE + dateLine + outputLine;
    return REPLY_SYSTEM_PROMPT_INLINE + outputLine;
}

async function generateReply(tweetText, author, analysis, imageDesc = null, duneContext = null, filterSignal = 'PASS', newsContext = null) {
    let systemPrompt = getReplySystemPrompt();
    if (filterSignal === 'SHILL') {
        systemPrompt += '\n\n[CURRENT POST CONTEXT: High-signal $A opportunity. Work $A and/or aptum.fun into your reply naturally — not as the main point, but it should land in there.]';
    }

    let userText = `Tweet by @${author}:\n"${(tweetText || '').replace(/"/g, '\\"')}"`;
    if (imageDesc) userText += `\n\n[IMAGE CONTEXT: ${imageDesc}]`;
    if (analysis) userText += `\n\n[Context: topic=${analysis.topic}, tone=${analysis.tone}, intent=${analysis.intent}, recommended reply style=${analysis.replyStyle}]`;
    if (duneContext) userText += `\n\n${duneContext}\n[DATA RULES: You may reference ONE number from the data above ONLY if the tweet specifically discusses this exact topic (e.g., DEX volume, gas prices). If the tweet is casual crypto talk, vibes, or opinions, IGNORE this data completely. Never fabricate prices or stats not in this data.]`;
    if (newsContext) {
        const newsAge = `(fetched ${new Date().toISOString().slice(11, 16)} UTC)`;
        userText += `\n\n${newsContext} ${newsAge}\n[NEWS RULES: If ONE headline is directly relevant, casually reference a specific detail from it. Never say "according to" or "news says". If no headline matches, IGNORE all of this. Never fabricate news details or prices not explicitly stated above.]`;
    }
    userText += `\n\n[CRITICAL: Never fabricate specific prices, market caps, or statistics. If you don't have real data, speak in general directional terms only.]`;

    let reply = await callModel(NVIDIA_MODEL, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText }
    ], 0.75, 100);

    if (reply && typeof reply === 'string') {
        reply = cleanReply(reply);
    }
    return reply && reply.length > 2 ? reply : null;
}

/**
 * Proofread a generated reply for grammar, coherence, and factual issues.
 * Returns the cleaned reply or null if the reply is unfixable.
 */
async function proofreadReply(reply, tweetText, author) {
    if (!reply || reply.length < 3) return null;

    const proofPrompt = `You are a strict proofreader for social media replies. Given a reply to a tweet, check for:

1. GRAMMAR: Fix any grammatical errors, orphaned quotes, broken punctuation
2. COHERENCE: Does the reply make sense as a response to the tweet? If not, return REJECT
3. FACTS: If the reply cites a specific price/number that seems made up (not in tweet), remove it or make it general
4. FORMATTING: No em dashes, no hashtags, no markdown. Lowercase is fine.
5. LENGTH: Under 280 chars. If too long, trim naturally.

Respond with ONLY the corrected reply text. If the reply is coherent and needs no changes, return it unchanged.
If the reply is completely nonsensical or irrelevant, respond with exactly: REJECT`;

    const userMsg = `Tweet by @${author}: "${(tweetText || '').substring(0, 200)}"
Reply to proofread: "${reply}"`;

    const result = await callModel(NVIDIA_MODEL, [
        { role: 'system', content: proofPrompt },
        { role: 'user', content: userMsg }
    ], 0.1, 120);

    if (!result || result.trim().toUpperCase() === 'REJECT') {
        log('WARN', `  ✂️  Proofread rejected: "${reply.substring(0, 60)}..."`);
        return null;
    }

    let cleaned = cleanReply(result);
    if (cleaned.length < 3 || cleaned.length > 280) return reply; // fallback to original
    return cleaned;
}

// ── Tweet extraction (resilient DOM) ─────────────────────────────────────
const MIN_TWEET_TEXT_LEN = 5;

function extractTweetsFromPage(page, maxAgeMin) {
    return page.evaluate((maxAgeMin, minTextLen) => {
        const now = Date.now();
        const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"], div[data-testid="tweet"]'));
        const results = [];
        const seenIds = new Set();

        for (const article of articles) {
            try {
                const statusLink = Array.from(article.querySelectorAll('a')).find(a => {
                    const href = a.getAttribute('href') || '';
                    return href.includes('/status/');
                });
                if (!statusLink) continue;
                const href = statusLink.getAttribute('href') || '';
                const idMatch = href.match(/\/status\/(\d+)/);
                const id = idMatch ? idMatch[1] : (href.split('/status/')[1] || '').split(/[?/]/)[0];
                if (!id || seenIds.has(id)) continue;
                seenIds.add(id);

                let author = 'unknown';
                const allLinks = Array.from(article.querySelectorAll('a[role="link"]'));
                for (const a of allLinks) {
                    const h = (a.getAttribute('href') || '').trim();
                    if (/^\/[A-Za-z0-9_]{1,15}$/.test(h) && !h.includes('/status/') && !/^\/(i|search|hashtag|intent|home|explore|notifications|messages|settings)$/i.test(h)) {
                        author = h.substring(1);
                        break;
                    }
                }
                if (author === 'unknown') {
                    const urlLinks = article.querySelectorAll('a[href*="x.com/"], a[href*="twitter.com/"]');
                    for (const a of urlLinks) {
                        const h = (a.getAttribute('href') || '').trim();
                        if (h.includes('/status/') || h.includes('/i/')) continue;
                        const parts = h.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/').filter(Boolean);
                        const domain = (parts[0] || '').toLowerCase();
                        if ((domain === 'x.com' || domain === 'twitter.com') && parts[1] && !/^(status|i|search|hashtag|intent)$/.test(parts[1])) {
                            author = parts[1];
                            break;
                        }
                    }
                }

                let text = '';
                const textEl = article.querySelector('[data-testid="tweetText"]');
                if (textEl) text = (textEl.textContent || textEl.innerText || '').trim();
                if (!text || text.length < minTextLen) {
                    const spans = article.querySelectorAll('[data-testid="tweetText"] span');
                    if (spans.length) text = Array.from(spans).map(s => (s.textContent || '').trim()).join(' ').trim();
                }
                if (!text || text.length < minTextLen) {
                    const allText = (article.textContent || article.innerText || '').trim();
                    const lines = allText.split(/\n+/).map(l => l.trim()).filter(l => l.length > 10);
                    if (lines.length) text = lines[0];
                }
                if (!text || text.length < minTextLen) continue;

                const timeEl = article.querySelector('time[datetime]');
                const timeStr = timeEl ? timeEl.getAttribute('datetime') : null;
                if (!timeStr) continue;
                const tweetTime = Date.parse(timeStr);
                if (Number.isNaN(tweetTime)) continue;
                const ageMin = (now - tweetTime) / (1000 * 60);
                if (ageMin > maxAgeMin || ageMin < 0) continue;

                const innerText = (article.innerText || article.textContent || '').toLowerCase();
                const isRetweet = innerText.includes('reposted') || innerText.includes('retweeted') || innerText.includes('repost');
                const topOfCard = innerText.substring(0, 120);
                const isReply = topOfCard.includes('replying to');
                const isAd = !!article.querySelector('[data-testid="promotedIndicator"]') || innerText.includes('promoted');
                const alreadyLiked = !!article.querySelector('[data-testid="unlike"]');

                let imageUrls = [];
                const photoContainer = article.querySelector('[data-testid="tweetPhoto"]');
                if (photoContainer) {
                    imageUrls = Array.from(photoContainer.querySelectorAll('img')).map(img => img.src || img.getAttribute('src')).filter(src => src && src.includes('pbs.twimg.com/media/'));
                }
                if (imageUrls.length === 0) {
                    const imgs = article.querySelectorAll('img[src*="pbs.twimg.com/media/"]');
                    imageUrls = Array.from(imgs).map(img => img.src || '').filter(src => src && !src.includes('profile_images') && !src.includes('emoji') && !src.includes('hashflag'));
                }

                results.push({
                    id, author,
                    text: text.substring(0, 500),
                    ageMin: Math.round(ageMin),
                    isRetweet: !!isRetweet,
                    isReply: !!isReply,
                    isAd: !!isAd,
                    alreadyLiked: !!alreadyLiked,
                    imageUrls: imageUrls.slice(0, 4),
                });
            } catch (_) { /* skip this article */ }
        }
        return results;
    }, maxAgeMin, MIN_TWEET_TEXT_LEN);
}

// ═══════════════════════════════════════════════════════════════════════════
// REPLY-BACK — check notifications for replies to our tweets, respond
// ═══════════════════════════════════════════════════════════════════════════

const REPLYBACK_FILE = path.join(DEBUG_DIR, 'replyback-seen.json');

function loadReplyBackSeen() {
    try {
        if (fs.existsSync(REPLYBACK_FILE)) return JSON.parse(fs.readFileSync(REPLYBACK_FILE, 'utf8'));
    } catch (_) { /* ignore */ }
    return { seenIds: [], lastRun: null };
}

function saveReplyBackSeen(data) {
    if (data.seenIds.length > 2000) data.seenIds = data.seenIds.slice(-2000);
    data.lastRun = new Date().toISOString();
    try { fs.writeFileSync(REPLYBACK_FILE, JSON.stringify(data, null, 2)); } catch (_) { /* ignore */ }
}

/**
 * DOM function to extract reply notifications from the notifications page.
 * Returns array of { id, author, text, replyToText, ageMin }
 */
function extractNotificationRepliesDOM(maxAgeHours) {
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"], div[data-testid="tweet"]'));
    const results = [];
    const seenIds = new Set();

    for (const article of articles) {
        try {
            // Only want replies TO us — look for "Replying to @aptum_" or similar
            const innerText = (article.innerText || '').toLowerCase();
            if (!innerText.includes('replying to')) continue;

            // Get tweet ID
            const statusLink = Array.from(article.querySelectorAll('a')).find(a => {
                const href = a.getAttribute('href') || '';
                return href.includes('/status/');
            });
            if (!statusLink) continue;
            const href = statusLink.getAttribute('href') || '';
            const idMatch = href.match(/\/status\/(\d+)/);
            const id = idMatch ? idMatch[1] : '';
            if (!id || seenIds.has(id)) continue;
            seenIds.add(id);

            // Get author
            let author = 'unknown';
            for (const a of Array.from(article.querySelectorAll('a[role="link"]'))) {
                const h = (a.getAttribute('href') || '').trim();
                if (/^\/[A-Za-z0-9_]{1,15}$/.test(h) && !h.includes('/status/') &&
                    !/^\/(i|search|hashtag|intent|home|explore|notifications|messages|settings)$/i.test(h)) {
                    author = h.substring(1);
                    break;
                }
            }

            // Get reply text
            let text = '';
            const textEl = article.querySelector('[data-testid="tweetText"]');
            if (textEl) text = (textEl.textContent || textEl.innerText || '').trim();
            if (!text || text.length < 2) continue;

            // Age check
            const timeEl = article.querySelector('time[datetime]');
            const timeStr = timeEl ? timeEl.getAttribute('datetime') : null;
            if (!timeStr) continue;
            const tweetTime = Date.parse(timeStr);
            if (Number.isNaN(tweetTime)) continue;
            const ageMs = now - tweetTime;
            if (ageMs > maxAgeMs || ageMs < 0) continue;
            const ageMin = Math.round(ageMs / 60000);

            // Skip if already liked (we already replied)
            const alreadyLiked = !!article.querySelector('[data-testid="unlike"]');

            results.push({
                id,
                author,
                text: text.substring(0, 300),
                ageMin,
                alreadyLiked,
            });
        } catch (_) { /* skip */ }
    }
    return results;
}

/**
 * Check if a notification reply looks like a bot/spam account.
 */
function isLikelyBot(author, text) {
    const t = (text || '').toLowerCase();
    const a = (author || '').toLowerCase();

    // Bot name patterns
    if (/bot|spam|promo|shill|airdrop|giveaway/i.test(a)) return true;

    // Very short empty replies
    if (t.length < 3) return true;

    // Follow/engagement bait in reply
    if (/follow me|follow back|f4f|follow for follow|gain followers|say hi|drop your/i.test(t)) return true;

    // Generic spam patterns
    if (/check (my|this) (bio|pin|profile)|dm me|link in bio|join my/i.test(t)) return true;

    // Pure emoji replies (no real text)
    const stripped = t.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]/gu, '');
    if (stripped.length < 2) return true;

    return false;
}

const REPLYBACK_SYSTEM_PROMPT = `You are @aptum_ — a web3 builder. Someone replied to one of your tweets. Write a short, natural follow-up reply.

Rules:
- Keep it SHORT: 1-15 words max. This is a quick follow-up, not a thesis.
- Be conversational and warm. Think casual DM energy.
- Match their energy: if they agree, acknowledge. If they push back, engage briefly.
- Lowercase by default. No emojis unless they used them. No hashtags. No em dashes.
- NEVER fabricate prices, numbers, or statistics.
- If they asked a question, answer it directly and briefly.
- If they just agreed with you, a simple "appreciate it" / "exactly" / "real" is fine.
- Don't repeat what you or they already said.
- Don't be sycophantic or overly enthusiastic.

Good examples (tone reference only — never copy):
- "appreciate that" / "exactly" / "real" / "fair point"
- "yeah the timing was wild" / "lol been saying this"
- "appreciate you" / "thanks for the context"
- "haven't looked into it yet tbh" / "interesting angle"

Respond with ONLY the reply text. Nothing else.`;

/**
 * Generate a short reply-back to someone who replied to our tweet.
 */
async function generateReplyBack(theirReply, theirAuthor) {
    const userMsg = `Someone (@${theirAuthor}) replied to your tweet:\n"${(theirReply || '').substring(0, 200)}"`;

    let reply = await callModel(NVIDIA_MODEL, [
        { role: 'system', content: REPLYBACK_SYSTEM_PROMPT },
        { role: 'user', content: userMsg }
    ], 0.6, 50);

    if (reply && typeof reply === 'string') {
        reply = cleanReply(reply);
    }
    return reply && reply.length > 1 && reply.length <= 200 ? reply : null;
}

/**
 * Reply-back phase: navigate to notifications, find replies to us, respond.
 */
async function replyBackPhase(page, limit) {
    log('INFO', '\n━━━ Reply-Back Phase: Checking notifications ━━━');
    const rbSeen = loadReplyBackSeen();
    const seenSet = new Set(rbSeen.seenIds);
    let replied = 0;

    try {
        await page.goto('https://x.com/notifications', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await wait(5000);

        // Scroll a few times to load notifications — human paced
        for (let scroll = 0; scroll < 5; scroll++) {
            await humanMouseMove(page);
            await page.evaluate(() => window.scrollBy(0, Math.floor(Math.random() * 400) + 500));
            await wait(Math.random() * 1500 + 1500);
        }

        // Extract reply notifications (last 12 hours)
        const notifications = await page.evaluate(extractNotificationRepliesDOM, 12);
        log('INFO', `  Found ${notifications.length} reply notifications (last 12h)`);

        // Filter: unseen, not bots, not already liked
        const fresh = notifications.filter(n => {
            if (seenSet.has(n.id)) return false;
            if (n.alreadyLiked) return false;
            if (isLikelyBot(n.author, n.text)) {
                log('INFO', `  🤖 Bot skip: @${n.author} — "${n.text.substring(0, 40)}..."`);
                return false;
            }
            return true;
        });

        log('INFO', `  ${fresh.length} fresh non-bot replies to process (limit: ${limit})`);

        for (const notif of fresh.slice(0, limit)) {
            seenSet.add(notif.id);
            rbSeen.seenIds.push(notif.id);

            log('INFO', `  📩 @${notif.author} (${notif.ageMin}m ago): "${notif.text.substring(0, 60)}..."`);

            if (DRY_RUN) {
                log('INFO', `  [DRY RUN] Would reply back`);
                continue;
            }

            try {
                // Navigate to the reply tweet
                await page.goto(`https://x.com/i/status/${notif.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await wait(3000);

                // Like their reply first
                const alreadyLiked = await page.evaluate(() => !!document.querySelector('[data-testid="unlike"]'));
                if (!alreadyLiked) {
                    const focused = await page.evaluate(() => {
                        const article = document.querySelector('article[data-testid="tweet"]');
                        if (article) { article.focus(); article.click(); return true; }
                        return false;
                    });
                    if (focused) {
                        await wait(300);
                        await page.keyboard.press('l');
                        await wait(1000);
                        log('INFO', `  ❤️  Liked reply`);
                    }
                }

                // Generate reply-back
                log('INFO', `  ↩️  Generating reply-back...`);
                let reply = await generateReplyBack(notif.text, notif.author);

                // Proofread
                if (reply) {
                    log('INFO', `  📝 Proofreading...`);
                    reply = await proofreadReply(reply, notif.text, notif.author);
                }

                if (reply && reply.length > 1 && reply.length <= 200) {
                    // Open reply box
                    let replyBoxReady = await page.evaluate(() => {
                        const box = document.querySelector('[data-testid="tweetTextarea_0"]');
                        if (box) { box.click(); return true; }
                        return false;
                    });
                    await wait(800);

                    if (!replyBoxReady) {
                        await page.keyboard.press('r');
                        await wait(1000);
                        replyBoxReady = await page.evaluate(() => !!document.querySelector('[data-testid="tweetTextarea_0"]'));
                    }

                    const safeToReply = await page.evaluate(() => window.location.href.includes('/status/'));

                    if (replyBoxReady && safeToReply) {
                        // Type with human-like pacing
                        for (let i = 0; i < reply.length; i++) {
                            await page.keyboard.type(reply[i]);
                            let delay = Math.random() * 80 + 70;
                            if ('.!?,;:'.includes(reply[i])) delay += Math.random() * 300 + 150;
                            else if (reply[i] === ' ') delay += Math.random() * 100 + 30;
                            await wait(delay);
                        }
                        await wait(Math.random() * 400 + 300);

                        // Submit
                        await page.keyboard.down('Control');
                        await page.keyboard.press('Enter');
                        await page.keyboard.up('Control');
                        await wait(2000);

                        // Check success: textarea closed (modal) OR toast appeared (inline) OR textarea emptied
                        const checkSubmittedRB = () => page.evaluate(() => {
                            if (!document.querySelector('[data-testid="tweetTextarea_0"]')) return true;
                            const toast = document.querySelector('[data-testid="toast"]');
                            if (toast && toast.textContent.toLowerCase().includes('sent')) return true;
                            const ta = document.querySelector('[data-testid="tweetTextarea_0"]');
                            if (ta && (ta.textContent || '').trim() === '') return true;
                            return false;
                        }).catch(() => false);

                        let submitted = await checkSubmittedRB();
                        if (!submitted) {
                            try { await page.click('[data-testid="tweetButtonInline"]'); await wait(2500); } catch (_) { /* */ }
                            submitted = await checkSubmittedRB();
                        }

                        if (submitted) {
                            replied++;
                            log('INFO', `  ✅ Reply-back confirmed: "${reply.substring(0, 80)}"`);

                            saveReply({
                                tweetId: notif.id,
                                tweetAuthor: notif.author,
                                tweetText: notif.text,
                                tweetAge: notif.ageMin,
                                reply,
                                replyLength: reply.length,
                                filterSignal: 'REPLY_BACK',
                                timestamp: new Date().toISOString(),
                                model: NVIDIA_MODEL,
                            });
                        } else {
                            log('WARN', `  ❌ Reply-back FAILED to post on ${notif.id} — textarea still open`);
                            await page.screenshot({ path: require('path').join(require('path').join(__dirname, '..', 'debug'), `replyback-fail-${Date.now()}.png`) }).catch(() => {});
                            try { await page.keyboard.press('Escape'); await wait(500); } catch (_) {}
                        }
                    } else {
                        log('WARN', `  ⚠️  Reply box didn't open`);
                    }
                } else {
                    log('WARN', `  ⚠️  Reply-back generation failed`);
                }

                // Pause between reply-backs (shorter than feed engagement)
                const pauseMs = Math.floor(Math.random() * 15000) + 10000;
                log('INFO', `  💤 ${Math.round(pauseMs / 1000)}s pause...`);
                await wait(pauseMs);

            } catch (e) {
                log('ERROR', `  ❌ Reply-back error on ${notif.id}: ${e.message}`);
            }
        }

    } catch (e) {
        log('ERROR', `Reply-back phase error: ${e.message}`);
    }

    saveReplyBackSeen(rbSeen);
    log('INFO', `━━━ Reply-Back Phase complete: ${replied} replies sent ━━━\n`);
    return replied;
}

// ── Main ─────────────────────────────────────────────────────────────────
(async () => {
    const CHROME_PATH = findChrome();
    if (!CHROME_PATH) {
        console.error('❌ Chrome not found');
        process.exit(1);
    }

    const progress = loadProgress();
    const totalDone = progress.liked;

    console.log(`\n🔄 X Feed Engagement`);
    console.log(`   Source: ${LIST_URL ? `List (${LIST_URL})` : 'Home Feed'}`);
    console.log(`   Daily Quota: ${DAILY_QUOTA} tweets`);
    console.log(`   Max Tweet Age: ${MAX_AGE_MIN} minutes`);
    console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : LIKE_ONLY ? 'Like Only' : 'Like + Comment'}`);
    console.log(`   Today's progress: ${totalDone}/${DAILY_QUOTA} (${progress.liked} likes, ${progress.commented} comments)`);
    console.log(`   Model: ${NVIDIA_MODEL}`);
    if (REPLY_BACK) console.log(`   Reply-Back: ON (limit: ${RB_LIMIT})`);
    console.log(`   Pacing: ${Math.round(MIN_PAUSE / 60000)}-${Math.round(MAX_PAUSE / 60000)}min between actions`);
    if (totalDone >= DAILY_QUOTA) {
        console.log(`\n✅ Daily quota already met! (${totalDone} tweets/${DAILY_QUOTA})`);
        process.exit(0);
    }
    console.log('');

    // Clean up stale Chrome lock files before launch
    ['DevToolsActivePort', 'SingletonLock', 'SingletonSocket', 'SingletonCookie'].forEach(f => {
        try { require('fs').unlinkSync(path.join(USER_DATA_DIR, f)); } catch (_) {}
    });

    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        userDataDir: USER_DATA_DIR,
        headless: process.argv.includes('--no-headless') ? false : true,
        defaultViewport: { width: SESSION_VP.width, height: SESSION_VP.height },
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
            `--window-size=${SESSION_VP.width},${SESSION_VP.height}`,
            '--disable-infobars',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-popup-blocking',
            '--disable-translate',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--lang=en-US,en',
            '--disable-dev-shm-usage',
            // Linux VPS requirements
            ...(process.platform === 'linux' ? [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--password-store=basic',
                '--single-process',
            ] : []),
        ]
    });

    const page = (await browser.pages())[0];

    // ── Comprehensive stealth patches ────────────────────────────────────
    await page.evaluateOnNewDocument(() => {
        // 1. Remove webdriver flag
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

        // 2. Add chrome object (real Chrome has this)
        window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };

        // 3. Realistic plugins array
        Object.defineProperty(navigator, 'plugins', {
            get: () => {
                const arr = [
                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
                ];
                arr.__proto__ = PluginArray.prototype;
                return arr;
            }
        });

        // 4. Languages
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

        // 5. Platform
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });

        // 6. Hardware fingerprint values
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

        // 7. Notification permission
        if (window.Notification) {
            try { Object.defineProperty(Notification, 'permission', { get: () => 'default' }); } catch (_) {}
        }

        // 8. Navigator permissions — hide automation detection
        if (navigator.permissions) {
            const origQuery = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = (params) => {
                if (params.name === 'notifications') return Promise.resolve({ state: 'default' });
                if (params.name === 'clipboard-read') return Promise.resolve({ state: 'prompt' });
                if (params.name === 'clipboard-write') return Promise.resolve({ state: 'granted' });
                return origQuery(params);
            };
        }

        // 9. WebGL vendor/renderer spoofing
        try {
            const getParam = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                if (parameter === 37445) return 'Intel Inc.';
                if (parameter === 37446) return 'Intel(R) Iris(TM) Plus Graphics 640';
                return getParam.call(this, parameter);
            };
        } catch (_) {}

        // 10. Remove selenium/webdriver global artifacts
        const artifactsToDelete = [
            '__webdriver_evaluate', '__selenium_evaluate', '__webdriver_script_func',
            '__webdriver_script_fn', '__fxdriver_evaluate', '__driver_unwrapped',
            '__webdriverFunc', '__driver_evaluate', '__selenium_unwrapped',
            '__firebug_html_panel', 'callSelenium', '_Selenium_IDE_Recorder',
            '__selenium_vars', '__webdriver_unwrapped',
        ];
        for (const key of artifactsToDelete) { try { delete window[key]; } catch (_) {} }

        // 11. Canvas fingerprint — subtle pixel noise so the fingerprint hash differs each session
        try {
            const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function(type, ...args) {
                if (this.width > 0 && this.height > 0) {
                    const ctx = this.getContext('2d');
                    if (ctx) {
                        const img = ctx.getImageData(0, 0, 1, 1);
                        img.data[0] = img.data[0] ^ 1;
                        ctx.putImageData(img, 0, 0);
                    }
                }
                return origToDataURL.call(this, type, ...args);
            };
        } catch (_) {}

        // 12. outerHeight/outerWidth match real browser dimensions
        try {
            Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth });
            Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 74 });
        } catch (_) {}

        // 13. Connection info — real Chrome reports these
        if (navigator.connection) {
            try {
                Object.defineProperty(navigator.connection, 'rtt', { get: () => 100 });
                Object.defineProperty(navigator.connection, 'downlink', { get: () => 10 });
            } catch (_) {}
        }

        // 14. Max touch points — desktop Chrome reports 0
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
    });

    await page.setUserAgent(SESSION_UA);
    log('INFO', `Session UA: ${SESSION_UA.match(/Chrome\/([\d.]+)/)?.[0] || 'Chrome'} | Viewport: ${SESSION_VP.width}x${SESSION_VP.height}`);

    if (fs.existsSync(COOKIES_PATH)) {
        try {
            const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
            const sameSiteMap = { 'no_restriction': 'None', 'lax': 'Lax', 'strict': 'Strict' };
            const clean = (Array.isArray(cookies) ? cookies : []).map(c => {
                const mapped = {
                    name: c.name,
                    value: c.value,
                    domain: c.domain || '.x.com',
                    path: c.path || '/',
                    secure: c.secure !== false,
                    httpOnly: c.httpOnly === true,
                };
                const ss = sameSiteMap[(c.sameSite || '').toLowerCase()];
                if (ss) mapped.sameSite = ss;
                if (c.expirationDate) mapped.expires = c.expirationDate;
                return mapped;
            }).filter(c => c.name && c.value);
            if (clean.length > 0) {
                // Clear any stale cookies first to prevent logging into the wrong account
                const client = await page.createCDPSession();
                await client.send('Network.clearBrowserCookies');
                await client.detach();
                log('INFO', `Cleared old cookies, setting ${clean.length} fresh cookies...`);
                await page.setCookie(...clean);
            }
        } catch (e) { log('WARN', `Cookie load error: ${e.message}`); }
    }

    // Wait for React to render logged-in elements (up to maxMs), polling every 2s
    const waitForLogin = async (maxMs = 45000) => {
        const selectors = [
            '[data-testid="SideNav_AccountSwitcher_Button"]',
            '[data-testid="SideNav_NewTweet_Button"]',
            '[data-testid="AppTabBar_Profile_Link"]',
            '[data-testid="SideNav_NewTweet_Floating_Button"]',
            '[data-testid="primaryColumn"]',
        ];
        const deadline = Date.now() + maxMs;
        while (Date.now() < deadline) {
            try {
                const found = await page.evaluate((sels) => sels.some(s => !!document.querySelector(s)), selectors);
                if (found) return true;
            } catch (_) { /* page still loading */ }
            await wait(2000);
        }
        return false;
    };

    // Attempt 1: navigate directly to feed
    log('INFO', `Navigating to ${LIST_URL ? 'list' : 'home feed'}...`);
    await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => log('WARN', '⚠️ Initial nav timeout, proceeding anyway'));
    log('INFO', 'Waiting for React to hydrate (up to 45s)...');
    let loggedIn = await waitForLogin(45000);

    // Attempt 2: if not logged in, navigate to https://x.com root (triggers cookie handshake)
    if (!loggedIn) {
        log('WARN', 'Login check failed on first attempt, retrying via https://x.com ...');
        await page.goto('https://x.com', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        loggedIn = await waitForLogin(45000);
    }

    // Attempt 3: try https://x.com/home explicitly
    if (!loggedIn) {
        log('WARN', 'Login check failed on second attempt, retrying via https://x.com/home ...');
        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        loggedIn = await waitForLogin(45000);
    }

    if (!loggedIn) {
        log('ERROR', 'Not logged in after 3 attempts!');
        await page.screenshot({ path: path.join(DEBUG_DIR, `feed-not-logged-in-${Date.now()}.png`) });
        await browser.close();
        process.exit(1);
    }
    log('INFO', 'Logged in ✅');

    // ── Session warmup — browse profile briefly before feed ──────────────
    // Mimics natural user behaviour: land on profile, scroll, then go to feed
    log('INFO', 'Warming up session (profile browse)...');
    await humanMouseMove(page);
    await page.goto('https://x.com/aptum_', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await wait(Math.random() * 2500 + 1500);
    await humanMouseMove(page);
    await page.evaluate(() => window.scrollBy(0, Math.floor(Math.random() * 400) + 150));
    await wait(Math.random() * 1500 + 800);
    await page.evaluate(() => window.scrollBy(0, Math.floor(Math.random() * 300) + 100));
    await wait(Math.random() * 1000 + 500);
    log('INFO', 'Warmup done. Navigating to feed...');
    await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await wait(5000); // extra wait for React to hydrate feed
    await humanMouseMove(page);
    // Debug: screenshot + DOM check right after feed load
    await page.screenshot({ path: path.join(DEBUG_DIR, `feed-after-warmup-${Date.now()}.png`) }).catch(() => {});
    const feedDomCheck = await page.evaluate(() => {
        return {
            articles: document.querySelectorAll('article[data-testid="tweet"]').length,
            primaryCol: !!document.querySelector('[data-testid="primaryColumn"]'),
            newTweetsBar: document.querySelector('[data-testid="cellInnerDiv"]') ? 'yes' : 'no',
            title: document.title,
            url: window.location.href,
        };
    }).catch(() => ({}));
    log('INFO', `Feed DOM check: ${JSON.stringify(feedDomCheck)}`);

    // ── Reply-Back Phase (before feed engagement) ─────────────────────
    if (REPLY_BACK) {
        const rbCount = await replyBackPhase(page, RB_LIMIT);
        log('INFO', `Reply-back phase done: ${rbCount} replies sent`);
        // Navigate back to feed for the main engagement loop
        log('INFO', `Navigating back to ${LIST_URL ? 'list' : 'home feed'}...`);
        await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
        await wait(3000);
    }

    let scrollCycles = 0;
    const maxScrollCycles = 500;
    let consecutiveEmpty = 0;
    const seenIds = new Set(progress.seenTweetIds);

    while (scrollCycles < maxScrollCycles) {
        const currentTotal = progress.liked;
        if (currentTotal >= DAILY_QUOTA) {
            log('INFO', `🎯 DAILY QUOTA MET! ${currentTotal} tweets/${DAILY_QUOTA}`);
            console.log(`\n🎯 Daily quota met! ${currentTotal} tweets — ${progress.liked} likes, ${progress.commented} comments`);
            break;
        }

        scrollCycles++;

        let tweets = [];
        try {
            tweets = await extractTweetsFromPage(page, MAX_AGE_MIN);
        } catch (e) {
            log('WARN', `Tweet extraction failed: ${e.message}`);
        }

        const freshTweets = tweets.filter(t => {
            if (seenIds.has(t.id)) return false;
            if (t.isAd) return false;
            if (t.alreadyLiked && !LIST_URL) return false;
            if (t.isReply) return false;
            if (t.isRetweet && !LIST_URL) return false;
            return true;
        });

        if (tweets.length === 0) {
            consecutiveEmpty++;
            log('DEBUG', '  📋 0 tweets visible — feed may still be loading');
        } else if (freshTweets.length === 0) {
            log('DEBUG', `  📋 ${tweets.length} tweets visible, 0 fresh (${tweets.filter(t => seenIds.has(t.id)).length} seen, ${tweets.filter(t => t.alreadyLiked).length} liked, ${tweets.filter(t => t.isRetweet).length} RT, ${tweets.filter(t => t.isReply).length} reply)`);
            consecutiveEmpty++;
            if (consecutiveEmpty >= 3 && consecutiveEmpty % 3 === 0) {
                await humanMouseMove(page);
                await page.keyboard.press('.');
                await wait(2500);
            }
            if (consecutiveEmpty > 15) {
                const waitSec = Math.floor(Math.random() * 25) + 45;
                log('INFO', `🔄 No fresh tweets after ${consecutiveEmpty} scrolls. Refreshing, waiting ${waitSec}s...`);
                await humanMouseMove(page);
                await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
                await wait(waitSec * 1000);
                await humanMouseMove(page);
                await page.keyboard.press('.');
                await wait(5000);
                await page.evaluate(() => window.scrollBy(0, Math.floor(Math.random() * 400) + 300));
                await wait(2000);
                consecutiveEmpty = 0;
            }
        } else {
            consecutiveEmpty = 0;
        }

        for (const tweet of freshTweets) {
            if (progress.liked >= DAILY_QUOTA) break;

            seenIds.add(tweet.id);
            progress.seenTweetIds.push(tweet.id);

            const snippet = (tweet.text || '').substring(0, 60).replace(/\n/g, ' ');
            log('INFO', `[${progress.liked + progress.commented + 1}/${DAILY_QUOTA}] @${tweet.author} (${tweet.ageMin}m ago): "${snippet}..."`);

            if (DRY_RUN) {
                log('INFO', `  [DRY RUN] Would like + comment`);
                progress.skipped++;
                saveProgress(progress);
                continue;
            }

            const images = tweet.imageUrls || [];
            const cleanText = cleanReply(tweet.text || '');

            // ── Vision: describe images before classify/reply ──────────────
            let imageDesc = null;
            if (images.length > 0) {
                log('INFO', `  👁️  Vision model describing ${images.length} image(s)...`);
                log('DEBUG', `  📷 URLs: ${images.join(' | ')}`);
                imageDesc = await describeImages(images);
                if (imageDesc) log('INFO', `  🖼️  Image: ${imageDesc.substring(0, 100)}${imageDesc.length > 100 ? '...' : ''}`);
            }

            log('INFO', `  🔍 Classifying...${imageDesc ? ' [+vision]' : ''}`);
            const classification = await classifyTweet(cleanText, tweet.author, imageDesc);
            const filterSignal = classification.signal;
            const analysis = classification; // same shape — topic/tone/intent/replyStyle all present
            log('INFO', `  🛡️ ${filterSignal} | topic=${analysis.topic} tone=${analysis.tone} intent=${analysis.intent} style=${analysis.replyStyle}`);

            if (filterSignal === 'SKIP') {
                log('INFO', `  ⏭️  Skipping (engagement bait)`);
                progress.skipped++;
                saveProgress(progress);
                continue;
            }

            const engageRate = getEngageRate(analysis.topic, analysis.intent);
            const tierLabel = engageRate >= 0.90 ? '🟢 T1' : engageRate >= 0.30 ? '🟡 T2' : '🔴 T3';
            log('INFO', `  ${tierLabel} (${Math.round(engageRate * 100)}% engage rate)`);

            if (filterSignal !== 'SHILL' && Math.random() > engageRate) {
                log('INFO', `  ⏭️  Skipping (tier roll)`);
                progress.skipped++;
                saveProgress(progress);
                continue;
            }

            try {
                await humanMouseMove(page);
                await page.goto(`https://x.com/i/status/${tweet.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await wait(Math.random() * 1000 + 1500);
                await humanMouseMove(page);

                const alreadyLiked = await page.evaluate(() => !!document.querySelector('[data-testid="unlike"]'));
                if (!alreadyLiked) {
                    // Human pause before interacting — like reading the tweet
                    await wait(Math.random() * 2000 + 800);
                    await humanMouseMove(page);
                    const focused = await page.evaluate(() => {
                        const article = document.querySelector('article[data-testid="tweet"], div[data-testid="tweet"]');
                        if (article) { article.focus(); article.click(); return true; }
                        return false;
                    });

                    if (focused) {
                        await wait(Math.random() * 500 + 200);
                        await page.keyboard.press('l');
                        await wait(Math.random() * 600 + 800);

                        const likeVerified = await page.evaluate(() => !!document.querySelector('[data-testid="unlike"]'));
                        if (likeVerified) {
                            progress.liked++;
                            log('INFO', `  ❤️  Liked (keyboard L, verified)`);
                        } else {
                            try {
                                await page.click('[data-testid="like"]');
                                await wait(1000);
                                progress.liked++;
                                log('INFO', `  ❤️  Liked (click fallback)`);
                            } catch (_) {
                                log('WARN', `  ⚠️  Like failed`);
                                progress.errors++;
                            }
                        }
                    }
                } else {
                    log('INFO', `  ✅ Already liked`);
                }

                if (!LIKE_ONLY && (tweet.text || '').length > 15) {
                    let duneContext = null;
                    if (analysis && DUNE_TOPICS.has(analysis.topic)) {
                        duneContext = await fetchDuneContext(tweet.text, analysis);
                    }

                    let newsContext = null;
                    if (analysis && typeof news?.contextFor === 'function') {
                        try {
                            newsContext = await news.contextFor(tweet.text, analysis, 8000);
                            if (newsContext) log('INFO', `  📰 News: ${newsContext.substring(0, 120)}...`);
                        } catch (_) { /* ignore */ }
                    }

                    log('INFO', `  🤖 Generating reply...${imageDesc ? ' [+vision]' : ''}${duneContext ? ' [+dune]' : ''}${newsContext ? ' [+news]' : ''}${filterSignal === 'SHILL' ? ' [SHILL]' : ''}`);
                    let reply = await generateReply(cleanText, tweet.author, analysis, imageDesc, duneContext, filterSignal, newsContext);

                    // Proofread step — catches grammar, coherence, hallucinated numbers
                    if (reply) {
                        log('INFO', `  📝 Proofreading...`);
                        reply = await proofreadReply(reply, tweet.text, tweet.author);
                    }

                    if (reply && reply.length > 3 && reply.length <= 280) {
                        let replyBoxReady = false;

                        // Human pause before opening reply box — like thinking before typing
                        await wait(Math.random() * 1500 + 500);
                        await humanMouseMove(page);

                        replyBoxReady = await page.evaluate(() => {
                            const replyBox = document.querySelector('[data-testid="tweetTextarea_0"]');
                            if (replyBox) { replyBox.click(); return true; }
                            const placeholder = Array.from(document.querySelectorAll('[data-text="true"]')).find(el => el.closest && el.closest('[data-testid="tweetTextarea_0"]'));
                            if (placeholder) { placeholder.click(); return true; }
                            return false;
                        });
                        await wait(Math.random() * 400 + 600);

                        if (!replyBoxReady) {
                            try {
                                await page.click('[data-testid="reply"]');
                                await wait(Math.random() * 500 + 800);
                                replyBoxReady = await page.evaluate(() => !!document.querySelector('[data-testid="tweetTextarea_0"]'));
                            } catch (_) { /* ignore */ }
                        }

                        if (!replyBoxReady) {
                            const onTweetPage = await page.evaluate(() => window.location.href.includes('/status/'));
                            if (onTweetPage) {
                                await page.keyboard.press('r');
                                await wait(1000);
                                replyBoxReady = await page.evaluate(() => !!document.querySelector('[data-testid="tweetTextarea_0"]'));
                            }
                        }

                        const safeToReply = await page.evaluate(() => window.location.href.includes('/status/'));

                        if (replyBoxReady && safeToReply) {
                            for (let i = 0; i < reply.length; i++) {
                                const char = reply[i];
                                await page.keyboard.type(char);
                                let delay = Math.random() * 80 + 70;
                                if ('.!?,;:'.includes(char)) delay += Math.random() * 400 + 200;
                                else if (char === ' ') delay += Math.random() * 120 + 40;
                                if (Math.random() < 0.03) delay += Math.random() * 800 + 400;
                                await wait(delay);
                            }
                            await wait(Math.random() * 600 + 400);

                            await page.keyboard.down('Control');
                            await page.keyboard.press('Enter');
                            await page.keyboard.up('Control');
                            await wait(2000);

                            // Check success: textarea closed (modal) OR toast appeared (inline on tweet page) OR textarea emptied
                            const checkSubmitted = () => page.evaluate(() => {
                                if (!document.querySelector('[data-testid="tweetTextarea_0"]')) return true;
                                const toast = document.querySelector('[data-testid="toast"]');
                                if (toast && toast.textContent.toLowerCase().includes('sent')) return true;
                                const ta = document.querySelector('[data-testid="tweetTextarea_0"]');
                                if (ta && (ta.textContent || '').trim() === '') return true;
                                return false;
                            }).catch(() => false);

                            let submitted = await checkSubmitted();

                            if (!submitted) {
                                // Textarea still open — try button fallback
                                try {
                                    await page.click('[data-testid="tweetButtonInline"]');
                                    await wait(2500);
                                    submitted = await checkSubmitted();
                                } catch (_) {
                                    log('WARN', `  ⚠️ Submit fallback click failed`);
                                }
                            }

                            if (submitted) {
                                // Secondary: grab the posted reply URL from the thread
                                await wait(1000);
                                const replyUrl = await page.evaluate(() => {
                                    try {
                                        const tweets = document.querySelectorAll('[data-testid="tweet"]');
                                        if (!tweets.length) return null;
                                        const last = tweets[tweets.length - 1];
                                        const timeEl = last.querySelector('time');
                                        if (!timeEl) return null;
                                        const link = timeEl.closest('a[href*="/status/"]');
                                        return link ? link.href : null;
                                    } catch (_) { return null; }
                                }).catch(() => null);

                                progress.commented++;
                                const urlNote = replyUrl ? ` → ${replyUrl}` : '';
                                log('INFO', `  ✅ Reply confirmed: "${reply.substring(0, 80)}..."${urlNote}`);

                                saveReply({
                                    tweetId: tweet.id,
                                    tweetAuthor: tweet.author,
                                    tweetText: tweet.text,
                                    tweetAge: tweet.ageMin,
                                    reply,
                                    replyLength: reply.length,
                                    filterSignal,
                                    timestamp: new Date().toISOString(),
                                    model: NVIDIA_MODEL,
                                    replyUrl: replyUrl || null,
                                });
                            } else {
                                log('WARN', `  ❌ Reply FAILED to post on tweet ${tweet.id} — textarea still open after fallback`);
                                await page.screenshot({ path: require('path').join(require('path').join(__dirname, '..', 'debug'), `reply-fail-${Date.now()}.png`) }).catch(() => {});
                                try { await page.keyboard.press('Escape'); await wait(500); } catch (_) {}
                            }
                        } else if (replyBoxReady && !safeToReply) {
                            log('WARN', `  🚫 Not on tweet page — aborting reply`);
                            await page.keyboard.press('Escape');
                            await wait(500);
                        } else {
                            log('WARN', `  ⚠️  Reply dialog didn't open`);
                            await page.screenshot({ path: path.join(DEBUG_DIR, `feed-reply-fail-${Date.now()}.png`) });
                        }
                    } else {
                        log('WARN', `  ⚠️  Reply generation failed or too long`);
                    }
                    
                    const pauseMs = Math.floor(Math.random() * (MAX_PAUSE - MIN_PAUSE)) + MIN_PAUSE;
                    log('INFO', `  💤 ${Math.round(pauseMs / 1000)}s pause...`);
                    await wait(pauseMs);
                }

                saveProgress(progress);

            } catch (e) {
                log('ERROR', `  ❌ Error on tweet ${tweet.id}: ${e.message}`);
                progress.errors++;
                await page.screenshot({ path: path.join(DEBUG_DIR, `feed-error-${Date.now()}.png`) }).catch(() => { });
                saveProgress(progress);
            }

            // Human pause after action before going back to feed
            await wait(Math.random() * 1200 + 600);
            await humanMouseMove(page);
            try {
                await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
            } catch (_) {
                log('WARN', '  ⚠️ Nav timeout returning to feed — retrying...');
                await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
            }
            // Variable wait after returning to feed — like glancing at the page before scrolling
            await wait(Math.random() * 2500 + 1500);
        }

        // Variable scroll distance and speed — no two scrolls the same
        const scrollPx = Math.floor(Math.random() * 900) + 400;
        await page.evaluate(async (amt) => {
            const steps = Math.floor(Math.random() * 5) + 3;
            const stepAmt = amt / steps;
            for (let i = 0; i < steps; i++) {
                window.scrollBy(0, stepAmt + (Math.random() * 20 - 10));
                await new Promise(r => setTimeout(r, Math.random() * 120 + 40));
            }
        }, scrollPx).catch(() => { /* page navigated mid-scroll — harmless, continue */ });

        // Occasional mid-scroll pause — like pausing to read something
        if (Math.random() < 0.25) {
            await wait(Math.random() * 2000 + 1000);
            await humanMouseMove(page);
        }

        await randWait(1500, 4000);

        if (scrollCycles % 5 === 0) {
            log('INFO', `📊 Progress: ${progress.liked}/${DAILY_QUOTA} (${progress.liked} likes, ${progress.commented} comments, ${progress.errors} errors) | scroll #${scrollCycles}`);
            logTokenUsage();
        }

        if (scrollCycles % 15 === 0 && scrollCycles > 0) {
            await humanMouseMove(page);
            await page.keyboard.press('.');
            await wait(2500);
            log('INFO', 'Loaded new tweets (. key)');
        }

        const total = progress.liked + progress.commented;
        if (total > 0 && total % 30 === 0 && freshTweets.length > 0) {
            const breakMs = Math.floor(Math.random() * 1200000) + 1200000; // 20-40 min break
            log('INFO', `☕ Long break (${Math.round(breakMs / 60000)}min) after ${total} actions to avoid spam detection...`);
            await wait(breakMs);
            await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
            await wait(3000);
        }
    }

    if (scrollCycles >= maxScrollCycles) {
        log('WARN', `⚠️  Max scroll cycles (${maxScrollCycles}) reached before quota met`);
    }

    const finalTotal = progress.liked + progress.commented;
    progress.finishedAt = new Date().toISOString();
    saveProgress(progress);

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`📊 Feed Engagement Report — ${today}`);
    console.log(`${'═'.repeat(50)}`);
    console.log(`   ❤️  Liked:     ${progress.liked}`);
    console.log(`   💬 Commented:  ${progress.commented}`);
    console.log(`   ⏭️  Skipped:   ${progress.skipped}`);
    console.log(`   ❌ Errors:     ${progress.errors}`);
    console.log(`   📜 Seen:       ${seenIds.size} tweets`);
    console.log(`   🎯 Total:      ${finalTotal}/${DAILY_QUOTA}`);
    console.log(`   🕐 Duration:   ${progress.startedAt} → ${progress.finishedAt}`);
    console.log(`${'═'.repeat(50)}\n`);

    log('INFO', `Session complete: ${finalTotal}/${DAILY_QUOTA} (${progress.liked} likes, ${progress.commented} comments)`);
    logTokenUsage();

    await browser.close();
})();