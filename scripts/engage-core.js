/**
 * engage-core.js — Shared AI pipeline for X engagement.
 *
 * Used by both x-feed-engage.js (Puppeteer) and x-api-engage.js (API).
 * Contains all model calls, classification, reply generation, and enrichment.
 *
 * Usage:
 *   const core = require('./engage-core');
 *   core.init({ dataDir, logFile });        // set per-client paths
 *   const cls = await core.classifyTweet(text, author);
 *   const reply = await core.generateReply(text, author, cls);
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const OpenAI = require('openai').default || require('openai');
const path = require('path');
const fs = require('fs');

let dune;
let news;
try { dune = require('../../dune-api/dune'); } catch (_) { dune = null; }
try { news = require('./news'); } catch (_) { news = null; }

// ── Config (overridable via init()) ──────────────────────────────────────
let DATA_DIR = path.join(__dirname, '..', 'debug');
let LOG_FILE = path.join(DATA_DIR, 'x-feed-engage.log');
let REPLIED_FILE = path.join(DATA_DIR, 'replied.json');

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
if (!NVIDIA_API_KEY) { console.error('❌ NVIDIA_API_KEY not set in .env'); process.exit(1); }

const openai = new OpenAI({
    apiKey: NVIDIA_API_KEY,
    baseURL: 'https://integrate.api.nvidia.com/v1',
    timeout: 120000,
    maxRetries: 3,
});

const NVIDIA_MODEL = 'moonshotai/kimi-k2-instruct-0905';
const VISION_MODEL = 'microsoft/phi-4-multimodal-instruct';

// ── Init (per-client isolation) ──────────────────────────────────────────

function init(opts = {}) {
    if (opts.dataDir) {
        DATA_DIR = opts.dataDir;
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    LOG_FILE = opts.logFile || path.join(DATA_DIR, 'x-feed-engage.log');
    REPLIED_FILE = opts.repliedFile || path.join(DATA_DIR, 'replied.json');
}

// ── Logging ──────────────────────────────────────────────────────────────

function log(level, msg) {
    const entry = `[${new Date().toISOString()}] [${level}] ${msg}`;
    console.log(entry);
    try { fs.appendFileSync(LOG_FILE, entry + '\n'); } catch (_) { /* ignore */ }
}

// ── Helpers ──────────────────────────────────────────────────────────────

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const randWait = (min, max) => wait(Math.floor(Math.random() * (max - min)) + min);

// ── Token tracking ───────────────────────────────────────────────────────

const tokenUsage = { calls: 0, prompt: 0, completion: 0, total: 0 };

function logTokenUsage() {
    log('INFO', `📈 Tokens — ${tokenUsage.total} total (${tokenUsage.calls} calls, ${tokenUsage.prompt} prompt, ${tokenUsage.completion} completion)`);
}

function getTokenUsage() { return { ...tokenUsage }; }

// ═══════════════════════════════════════════════════════════════════════════
// MODEL PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

async function callModel(model, messages, temperature = 0.3, maxTokens = 200) {
    try {
        let fullContent = '';
        let usage = null;

        const stream = await openai.chat.completions.create({
            model, messages, temperature, top_p: 1.0, max_tokens: maxTokens,
            stream: true, stream_options: { include_usage: true },
        });

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) fullContent += delta;
            if (chunk.usage) usage = chunk.usage;
        }

        if (usage) {
            tokenUsage.calls++;
            tokenUsage.prompt += usage.prompt_tokens || 0;
            tokenUsage.completion += usage.completion_tokens || 0;
            tokenUsage.total += usage.total_tokens || 0;
        } else {
            tokenUsage.calls++;
        }

        return fullContent.trim() || null;
    } catch (err) {
        const status = err?.status || err?.statusCode;
        const message = err?.message || String(err);
        if (status === 429) log('WARN', `  ⚠️ Rate limited (429) after retries: ${message}`);
        else if (status === 400) log('WARN', `  ⚠️ Bad request (400): ${message}`);
        else if (status >= 500) log('WARN', `  ⚠️ Server error (${status}): ${message}`);
        else log('WARN', `  ⚠️ API error: ${message}`);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// VISION
// ═══════════════════════════════════════════════════════════════════════════

const VISION_SYSTEM_PROMPT = `You are a concise image analyst for a crypto/web3 social media bot.
Describe what you see in 1-2 sentences. Focus on: charts/price data, token names, memes, text overlays, people, news screenshots, or any crypto/finance context visible.
Be factual and terse. No preamble like "The image shows" — just describe directly.
If multiple images, describe each briefly separated by " | ".`;

async function describeImages(imageUrls) {
    if (!imageUrls || imageUrls.length === 0) return null;
    const urls = imageUrls.slice(0, 2);

    try {
        const content = [
            { type: 'text', text: 'Describe these tweet images for crypto/web3 context:' },
            ...urls.map(url => ({ type: 'image_url', image_url: { url } }))
        ];

        const response = await openai.chat.completions.create({
            model: VISION_MODEL,
            messages: [
                { role: 'system', content: VISION_SYSTEM_PROMPT },
                { role: 'user', content }
            ],
            temperature: 0.1, max_tokens: 120, stream: false,
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
        log('WARN', `  ⚠️ Vision model error: ${(err?.message || String(err)).substring(0, 100)}`);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSIFY
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
    for (const k of knownSet) { if (k.toLowerCase() === v) return k; }
    for (const k of knownSet) { if (k.toLowerCase().startsWith(v) || v.startsWith(k.toLowerCase())) return k; }
    return fallback;
}

function getEngageRate(topic, intent = '') {
    if (intent === 'shilling-ticker') return 0.95;
    return ENGAGEMENT_TIERS[topic] ?? 0.20;
}

async function classifyTweet(tweetText, author, imageDesc = null) {
    let userMsg = `@${author}: "${(tweetText || '').substring(0, 300)}"`;
    if (imageDesc) userMsg += `\n[IMAGE CONTEXT: ${imageDesc}]`;

    const result = await callModel(NVIDIA_MODEL, [
        { role: 'system', content: CLASSIFY_PROMPT },
        { role: 'user', content: userMsg }
    ], 0.1, 80);

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

    // Post-hoc keyword topic override
    if (out.topic === 'other') {
        const t = (tweetText || '').toLowerCase();
        if (/\b(breaking|war|explosion|missile|strike|attack|sanctions|invasion|ceasefire|airstrike|troops|military|nato|escalat|casualties)\b/i.test(t)) out.topic = 'news';
        else if (/\b(bitcoin|btc|ethereum|eth|solana|sol|memecoin|altcoin|token|dex|defi|nft|airdrop|staking|blockchain|web3|onchain|rug|honeypot|pump|dump|bags|sats|gwei|whale|hodl|degen)\b/i.test(t)) out.topic = 'crypto';
        else if (/\b(market|stocks|fed|interest rate|inflation|gdp|earnings|ipo|etf|bond|treasury|recession|bull|bear|rally|crash|dow|nasdaq|s&p|oil|gold)\b/i.test(t)) out.topic = 'finance';
        else if (/\b(ai |artificial intelligence|llm|gpt|neural|model|agent|autonomous|robotics|machine learning|deep learning|training|inference|compute)\b/i.test(t)) out.topic = 'ai';
    }

    return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// DUNE CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

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
        log('WARN', `  ⚠️ Dune query failed: ${e?.message || String(e)}`);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// NEWS CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

async function fetchNewsContext(tweetText, analysis) {
    if (!news || !analysis) return null;
    try {
        const ctx = await news.contextFor(tweetText, analysis);
        return ctx || null;
    } catch (e) {
        log('WARN', `  ⚠️ News context failed: ${e?.message || String(e)}`);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLEAN REPLY
// ═══════════════════════════════════════════════════════════════════════════

const BLOCKED_COINS = [
    'cardano', 'ada', 'solana', 'sol', 'polkadot', 'dot',
    'avalanche', 'avax', 'tron', 'trx', 'bnb', 'xrp', 'ripple',
    'dogecoin', 'doge', 'shiba', 'shib', 'litecoin', 'ltc',
    'toncoin', 'ton', 'cosmos', 'atom', 'near', 'algorand', 'algo',
    'fantom', 'ftm', 'hedera', 'hbar', 'sui', 'aptos', 'apt',
    'sei', 'injective', 'inj', 'kaspa', 'kas',
];
const blockedRe = new RegExp(`\\b(${BLOCKED_COINS.join('|')})\\b`, 'gi');

function cleanReply(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/\$([A-Za-z]{2,10})\b/g, (m, ticker) => /^a$/i.test(ticker) ? m : '')
        .replace(blockedRe, '')
        .replace(/^["'\u201C\u201D\u2018\u2019]+|["'\u201C\u201D\u2018\u2019]+$/g, '')
        .replace(/\s*[\u2014\u2014]+\s*/g, ', ')
        .replace(/, ,/g, ',')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/^(reply|response|here'?s? ?(my|the)? ?reply|answer)[:\s]*/i, '')
        .replace(/  +/g, ' ')
        .replace(/\b202[45]\b/g, '2026')
        .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// REPLY GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function loadReplyPrompt() {
    const p = path.join(__dirname, 'reply-prompt.md');
    try {
        if (fs.existsSync(p)) {
            let content = fs.readFileSync(p, 'utf8');
            content = content.replace(/^---[\s\S]*?^---\s*/m, '').trim();
            content = content.replace(/\n---\s*\n\*[^*]+\*\.?\s*$/, '').trim();
            return content;
        }
    } catch (_) { /* ignore */ }
    return null;
}

const REPLY_PROMPT_BASE = loadReplyPrompt();

const REPLY_SYSTEM_PROMPT_INLINE = `You are @aptum_ — a web3 builder and AI agent in the trenches. Casually sharp, never trying too hard. Crypto-native energy, zero performative hype. You just launched $A, an AI agent token on Clanker. The community lives at https://aptum.fun/ and the token is live: https://clanker.world/clanker/0xaa681b1D3dE076f2524c94Ceb2Db712878Bb6b07

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
- Mid-depth posts (crypto takes, market talk, news): 1-2 real sentences with actual substance.
- Deep posts (tech analysis, builder updates, AI/web3 discussions): 2-3 sentences. Engage meaningfully.
- Ticker shilling / "what should I buy" posts: 1-2 sentences. Mention $A naturally.

$A PROMOTION RULES:
- You are the creator of $A — an AI agent token that just launched on Clanker.
- When someone asks "what ticker" / "what to buy" / "shill me", work $A in naturally.
- Keep it subtle and organic.
- DON'T force $A into every reply. Only when the context fits.
- Maybe 1 in 3-4 crypto/shilling replies should mention $A.

TONE BY CATEGORY:
- Crypto / markets: Direct, lightly skeptical, builder-aware.
- Ticker shilling: Engage genuinely. Mention $A when it fits.
- Memes: Match the format — absurdist or dry.
- Market drama / scams / rugs: Sarcastic but knowing.
- Political: Neutral, dry observer. Never take sides.
- Religious: Human and warm. Never debate.

FINAL RULE: Match the depth of the post. If it doesn't feel like something you'd say in a builder group DM, don't post it.`;

function getReplySystemPrompt() {
    const dateLine = `\n\nCURRENT DATE: ${new Date().toISOString().slice(0, 10)} (the year is 2026 — never reference 2024 or 2025 as the current year)\n`;
    const outputLine = '\n\nRespond with ONLY your reply text. Nothing else. No quotes around it. No labels. Just the reply.';
    if (REPLY_PROMPT_BASE) return REPLY_PROMPT_BASE + dateLine + outputLine;
    return REPLY_SYSTEM_PROMPT_INLINE + outputLine;
}

async function generateReply(tweetText, author, analysis, imageDesc = null, duneContext = null, filterSignal = 'PASS', newsContext = null) {
    let systemPrompt = getReplySystemPrompt();
    if (filterSignal === 'SHILL') {
        systemPrompt += '\n\n[CURRENT POST CONTEXT: High-signal $A opportunity. Work $A and/or aptum.fun into your reply naturally.]';
    }

    let userText = `Tweet by @${author}:\n"${(tweetText || '').replace(/"/g, '\\"')}"`;
    if (imageDesc) userText += `\n\n[IMAGE CONTEXT: ${imageDesc}]`;
    if (analysis) userText += `\n\n[Context: topic=${analysis.topic}, tone=${analysis.tone}, intent=${analysis.intent}, recommended reply style=${analysis.replyStyle}]`;
    if (duneContext) userText += `\n\n${duneContext}\n[DATA RULES: You may reference ONE number from the data above ONLY if the tweet specifically discusses this exact topic. If casual crypto talk, IGNORE this data. Never fabricate prices or stats.]`;
    if (newsContext) {
        const newsAge = `(fetched ${new Date().toISOString().slice(11, 16)} UTC)`;
        userText += `\n\n${newsContext} ${newsAge}\n[NEWS RULES: If ONE headline is directly relevant, casually reference a specific detail. Never say "according to" or "news says". If no headline matches, IGNORE. Never fabricate news details.]`;
    }
    userText += `\n\n[CRITICAL: Never fabricate specific prices, market caps, or statistics. If you don't have real data, speak in general directional terms only.]`;

    let reply = await callModel(NVIDIA_MODEL, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText }
    ], 0.75, 100);

    if (reply && typeof reply === 'string') reply = cleanReply(reply);
    return reply && reply.length > 2 ? reply : null;
}

async function proofreadReply(reply, tweetText, author) {
    if (!reply || reply.length < 3) return null;

    const proofPrompt = `You are a strict proofreader for social media replies. Given a reply to a tweet, check for:

1. GRAMMAR: Fix any grammatical errors, orphaned quotes, broken punctuation
2. COHERENCE: Does the reply make sense as a response to the tweet? If not, return REJECT
3. FACTS: If the reply cites a specific price/number that seems made up, remove it or make it general
4. FORMATTING: No em dashes, no hashtags, no markdown. Lowercase is fine.
5. LENGTH: Under 280 chars. If too long, trim naturally.

Respond with ONLY the corrected reply text. If coherent and needs no changes, return it unchanged.
If completely nonsensical or irrelevant, respond with exactly: REJECT`;

    const userMsg = `Tweet by @${author}: "${(tweetText || '').substring(0, 200)}"\nReply to proofread: "${reply}"`;

    const result = await callModel(NVIDIA_MODEL, [
        { role: 'system', content: proofPrompt },
        { role: 'user', content: userMsg }
    ], 0.1, 120);

    if (!result || result.trim().toUpperCase() === 'REJECT') {
        log('WARN', `  ✂️  Proofread rejected: "${reply.substring(0, 60)}..."`);
        return null;
    }

    let cleaned = cleanReply(result);
    if (cleaned.length < 3 || cleaned.length > 280) return reply;
    return cleaned;
}

// ═══════════════════════════════════════════════════════════════════════════
// REPLY-BACK
// ═══════════════════════════════════════════════════════════════════════════

const REPLYBACK_SYSTEM_PROMPT = `You are @aptum_ — a web3 builder. Someone replied to one of your tweets. Write a short, natural follow-up reply.

Rules:
- Keep it SHORT: 1-15 words max.
- Be conversational and warm. Casual DM energy.
- Match their energy — if they agree, acknowledge. If they push back, engage briefly.
- Lowercase by default. No emojis unless they used them. No hashtags. No em dashes.
- NEVER fabricate prices, numbers, or statistics.
- Don't repeat what you or they already said.
- Don't be sycophantic or overly enthusiastic.

Respond with ONLY the reply text. Nothing else.`;

async function generateReplyBack(theirReply, theirAuthor) {
    const userMsg = `Someone (@${theirAuthor}) replied to your tweet:\n"${(theirReply || '').substring(0, 200)}"`;

    let reply = await callModel(NVIDIA_MODEL, [
        { role: 'system', content: REPLYBACK_SYSTEM_PROMPT },
        { role: 'user', content: userMsg }
    ], 0.6, 50);

    if (reply && typeof reply === 'string') reply = cleanReply(reply);
    return reply && reply.length > 1 && reply.length <= 200 ? reply : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// BOT DETECTION
// ═══════════════════════════════════════════════════════════════════════════

function isLikelyBot(author, text) {
    const t = (text || '').toLowerCase();
    const a = (author || '').toLowerCase();

    if (/bot|spam|promo|shill|airdrop|giveaway/i.test(a)) return true;
    if (t.length < 3) return true;
    if (/follow me|follow back|f4f|follow for follow|gain followers|say hi|drop your/i.test(t)) return true;
    if (/check (my|this) (bio|pin|profile)|dm me|link in bio|join my/i.test(t)) return true;

    const stripped = t.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]/gu, '');
    if (stripped.length < 2) return true;

    return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESS & DEDUP (per-client isolated)
// ═══════════════════════════════════════════════════════════════════════════

function getProgressFile() {
    const today = new Date().toISOString().slice(0, 10);
    return path.join(DATA_DIR, `feed-progress-${today}.json`);
}

function loadProgress(resume = false) {
    const today = new Date().toISOString().slice(0, 10);
    const pf = getProgressFile();
    if (resume && fs.existsSync(pf)) {
        try {
            const data = JSON.parse(fs.readFileSync(pf, 'utf8'));
            if (data.date === today) return data;
        } catch (_) { /* ignore */ }
    }
    return {
        date: today, liked: 0, commented: 0, skipped: 0, errors: 0,
        seenTweetIds: [], startedAt: new Date().toISOString(), lastAction: null,
    };
}

function saveProgress(progress) {
    if (progress.seenTweetIds.length > 5000) progress.seenTweetIds = progress.seenTweetIds.slice(-5000);
    progress.lastAction = new Date().toISOString();
    try { fs.writeFileSync(getProgressFile(), JSON.stringify(progress, null, 2)); } catch (_) { /* ignore */ }
}

function loadReplied() {
    if (fs.existsSync(REPLIED_FILE)) {
        try { return JSON.parse(fs.readFileSync(REPLIED_FILE, 'utf8')); } catch (_) { /* ignore */ }
    }
    return { version: 1, totalReplies: 0, entries: [] };
}

function saveReply(repliedData, entry) {
    repliedData.totalReplies++;
    repliedData.entries.push(entry);
    try { fs.writeFileSync(REPLIED_FILE, JSON.stringify(repliedData, null, 2)); } catch (_) { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    // Init
    init,
    log,
    wait,
    randWait,

    // Models
    callModel,
    describeImages,
    NVIDIA_MODEL,

    // Classify
    classifyTweet,
    getEngageRate,
    DUNE_TOPICS,
    DUNE_KEYWORDS,

    // Context
    fetchDuneContext,
    fetchNewsContext,

    // Reply
    cleanReply,
    generateReply,
    proofreadReply,
    generateReplyBack,
    getReplySystemPrompt,

    // Bot detection
    isLikelyBot,

    // Progress & dedup
    loadProgress,
    saveProgress,
    loadReplied,
    saveReply,

    // Token tracking
    logTokenUsage,
    getTokenUsage,
};
