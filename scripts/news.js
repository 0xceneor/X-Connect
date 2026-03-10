/**
 * news.js — NewsAPI client for enriching X replies with live headlines
 *
 * Usage (CLI):
 *   node news.js headlines --category technology
 *   node news.js search --q "bitcoin ETF"
 *   node news.js context --tweet "fed just hiked rates again"
 *
 * Usage (module):
 *   const news = require('./news');
 *   const context = await news.contextFor(tweetText, analysis);  // ← main entrypoint
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── Load .env ─────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const eq = line.indexOf('=');
        if (eq > 0) {
            const k = line.substring(0, eq).trim();
            const v = line.substring(eq + 1).trim();
            if (k && v) process.env[k] = v;
        }
    });
}

const API_KEY = process.env.NEWS_API_KEY;
const BASE_URL = 'newsapi.org';

// ── HTTP helper ───────────────────────────────────────────────────────────
function request(endpoint, params = {}) {
    if (!API_KEY) throw new Error('NEWS_API_KEY not set');
    const qs = new URLSearchParams({ ...params, apiKey: API_KEY }).toString();
    return new Promise((resolve, reject) => {
        const req = https.request(
            { hostname: BASE_URL, path: `/v2/${endpoint}?${qs}`, method: 'GET',
              headers: { 'User-Agent': 'newsbot/1.0' }, timeout: 10000 },
            (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.status !== 'ok') reject(new Error(`NewsAPI: ${json.code} — ${json.message}`));
                        else resolve(json);
                    } catch { reject(new Error(`Parse error: ${data.substring(0, 200)}`)); }
                });
            }
        );
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('NewsAPI timeout')); });
        req.end();
    });
}

// ── Time window helper ────────────────────────────────────────────────────
function hoursAgo(h) {
    return new Date(Date.now() - h * 60 * 60 * 1000).toISOString().slice(0, 16);
}

// ── Core API methods ──────────────────────────────────────────────────────
async function headlines(opts = {}) {
    const { category, country = 'us', sources, q, pageSize = 5 } = opts;
    const params = { language: 'en', pageSize };
    if (sources) { params.sources = sources; }
    else { params.country = country; if (category) params.category = category; }
    if (q) params.q = q;
    const res = await request('top-headlines', params);
    return res.articles || [];
}

async function search(opts = {}) {
    const { q, from, to, sortBy = 'publishedAt', pageSize = 5 } = opts;
    if (!q) throw new Error('search() requires q');
    const params = { language: 'en', q, sortBy, pageSize };
    if (from) params.from = from;
    if (to) params.to = to;
    const res = await request('everything', params);
    return res.articles || [];
}

// ── Ticker → full name map ─────────────────────────────────────────────────
// Used to expand $BTC → "bitcoin" etc. in query building
const TICKER_MAP = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple XRP',
    DOGE: 'dogecoin', BNB: 'BNB Binance', AVAX: 'Avalanche', MATIC: 'Polygon MATIC',
    LINK: 'Chainlink LINK', UNI: 'Uniswap', ARB: 'Arbitrum', OP: 'Optimism',
    APT: 'Aptos', SUI: 'Sui blockchain', HYPE: 'Hyperliquid', PEPE: 'PEPE memecoin',
    WIF: 'dogwifhat WIF', BONK: 'BONK memecoin', TRUMP: 'TRUMP memecoin',
    NVDA: 'Nvidia', AAPL: 'Apple', TSLA: 'Tesla', MSFT: 'Microsoft',
    AMZN: 'Amazon', META: 'Meta Facebook', GOOGL: 'Google Alphabet',
    SPY: 'S&P 500 stock market', QQQ: 'Nasdaq tech stocks',
};

// Stop words to strip before building a query
const STOP_WORDS = new Set([
    'the','and','for','are','but','not','you','all','can','her','was','one',
    'our','out','get','has','him','his','how','man','new','now','old','see',
    'two','way','who','boy','did','its','let','put','say','she','too','use',
    'that','this','with','have','from','they','will','been','just','into',
    'like','more','also','very','well','what','when','some','your','there',
    'their','than','then','them','even','most','only','over','such','make',
    'time','here','come','could','would','should','think','know','going',
    'really','going','still','back','good','need','want','take','look',
    'about','after','again','every','first','never','other','right','these',
    'where','which','while','whole','without','work','year','years','today',
    'lol','lmao','fr','tbh','imo','ngl','idk','wtf','omg','bruh','bro',
    'gm','gn','wagmi','ngmi','lfg','fud','hype','vibes','alpha','based',
    'literally','basically','actually','honestly','obviously',
]);

/**
 * Extract a search query from raw tweet text.
 * Handles: $TICKER symbols, @mentions, URLs, cashtags, capitalized entities, key phrases.
 * Returns a query string, or null if nothing useful was found.
 */
function extractQueryFromTweet(tweetText) {
    if (!tweetText) return null;
    const terms = [];

    // 1. Expand $TICKER symbols
    const tickerMatches = tweetText.match(/\$([A-Z]{2,6})\b/g) || [];
    for (const t of tickerMatches) {
        const sym = t.slice(1);
        if (TICKER_MAP[sym]) terms.push(TICKER_MAP[sym]);
        else terms.push(sym); // unknown ticker — keep as-is
    }

    // 2. Strip URLs, @mentions, emojis, punctuation
    let cleaned = tweetText
        .replace(/https?:\/\/\S+/g, '')
        .replace(/@\w+/g, '')
        .replace(/\$[A-Z]{2,6}/g, '')       // already handled above
        .replace(/[^\w\s'-]/g, ' ')
        .replace(/\b\d+(\.\d+)?[kKmMbB%]?\b/g, '') // strip lone numbers/percentages
        .trim();

    // 3. Extract capitalized multi-word phrases (likely named entities)
    const capitalizedPhrases = cleaned.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) || [];
    for (const phrase of capitalizedPhrases) {
        if (!STOP_WORDS.has(phrase.toLowerCase())) terms.push(phrase);
    }

    // 4. Extract single capitalized words (proper nouns, brands, orgs)
    const capitalizedWords = cleaned.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || [];
    for (const w of capitalizedWords) {
        if (!STOP_WORDS.has(w.toLowerCase()) && !terms.join(' ').includes(w)) {
            terms.push(w);
        }
    }

    // 5. Extract lowercase meaningful words if we still have nothing
    if (terms.length === 0) {
        const words = cleaned.toLowerCase().split(/\s+/)
            .filter(w => w.length > 4 && !STOP_WORDS.has(w));
        terms.push(...words.slice(0, 4));
    }

    if (terms.length === 0) return null;

    // Dedupe and limit to 5 terms
    const unique = [...new Set(terms)].slice(0, 5);
    return unique.join(' ');
}

// ── Relevance check ───────────────────────────────────────────────────────
function hasRelevantArticle(articles, tweetText) {
    if (!articles || articles.length === 0) return false;
    const tweetWords = new Set(
        (tweetText || '').toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3 && !STOP_WORDS.has(w))
    );
    for (const a of articles) {
        const content = ((a.title || '') + ' ' + (a.description || '')).toLowerCase();
        for (const word of tweetWords) {
            if (content.includes(word)) return true;
        }
    }
    return false;
}

// ── Format output ─────────────────────────────────────────────────────────
function formatContext(articles) {
    if (!articles || articles.length === 0) return null;
    const now = Date.now();
    const lines = articles.slice(0, 3).map(a => {
        const source = a.source?.name || 'unknown';
        const ageH = Math.round((now - new Date(a.publishedAt).getTime()) / 3600000);
        const age = ageH < 1 ? 'just now' : ageH < 24 ? `${ageH}h ago` : `${Math.round(ageH / 24)}d ago`;
        const desc = a.description ? ` — ${a.description.substring(0, 90)}` : '';
        return `• ${a.title}${desc} (${source}, ${age})`;
    });
    return `[NEWS]:\n${lines.join('\n')}`;
}

// ── Topics that should never get news enrichment ──────────────────────────
const SKIP_TOPICS = new Set(['motivational', 'lifestyle', 'religion', 'personal', 'humor', 'meme']);

/**
 * Main enrichment entrypoint.
 * Extracts a query directly from the tweet text — no hardcoded topic routing.
 * Falls back to broad category headlines if query extraction yields nothing useful.
 */
async function contextFor(tweetText, analysis = {}, timeout = 8000) {
    const topic = (analysis.topic || '').toLowerCase();
    if (SKIP_TOPICS.has(topic)) return null;

    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('News context timeout')), timeout)
    );

    try {
        return await Promise.race([_fetchContext(tweetText, topic), timeoutPromise]);
    } catch {
        return null;
    }
}

async function _fetchContext(tweetText, topic) {
    // 1. Extract query from the tweet itself
    const query = extractQueryFromTweet(tweetText);

    if (query) {
        // Try recent articles first (12h), then widen to 48h if nothing
        for (const window of [12, 48]) {
            const articles = await search({
                q: query, from: hoursAgo(window), sortBy: 'publishedAt', pageSize: 5
            }).catch(() => []);

            const relevant = articles.filter(a =>
                a.title && !a.title.includes('[Removed]')
            );

            if (relevant.length > 0 && hasRelevantArticle(relevant, tweetText)) {
                return formatContext(relevant);
            }
        }
    }

    // 2. Fallback: pull top headlines for broad topic categories
    const categoryMap = {
        crypto: 'business', finance: 'business', markets: 'business',
        tech: 'technology', ai: 'technology', politics: 'general', news: 'general',
    };
    const category = categoryMap[topic];
    if (category) {
        const articles = await headlines({ category, pageSize: 3 }).catch(() => []);
        if (articles.length > 0 && hasRelevantArticle(articles, tweetText)) {
            return formatContext(articles);
        }
    }

    return null;
}

// ── Exports ───────────────────────────────────────────────────────────────
module.exports = { headlines, search, contextFor, formatContext, extractQueryFromTweet };

// ── CLI ───────────────────────────────────────────────────────────────────
if (require.main === module) {
    const args = process.argv.slice(2);
    const cmd = args[0];
    const getArg = name => { const i = args.indexOf(`--${name}`); return i !== -1 && args[i + 1] ? args[i + 1] : null; };

    if (!cmd) {
        console.log(`Usage:
  node news.js headlines --category technology
  node news.js headlines --q "bitcoin" --country us
  node news.js search --q "federal reserve" --from 2026-02-20 --sort publishedAt
  node news.js context --tweet "bitcoin just broke 100k again"
  node news.js extract --tweet "fed hiked rates and BTC dumped"`);
        process.exit(0);
    }

    (async () => {
        try {
            if (cmd === 'headlines') {
                const articles = await headlines({
                    category: getArg('category'), country: getArg('country') || 'us',
                    q: getArg('q'), pageSize: parseInt(getArg('size') || '5'),
                });
                console.log(`✅ ${articles.length} headlines\n`);
                articles.forEach((a, i) => {
                    console.log(`[${i + 1}] ${a.title}`);
                    console.log(`    ${a.source?.name} — ${a.publishedAt}`);
                    if (a.description) console.log(`    ${a.description.substring(0, 120)}`);
                    console.log();
                });
            } else if (cmd === 'search') {
                const q = getArg('q');
                if (!q) { console.error('--q required'); process.exit(1); }
                const articles = await search({
                    q, from: getArg('from'), sortBy: getArg('sort') || 'publishedAt',
                    pageSize: parseInt(getArg('size') || '5'),
                });
                console.log(`✅ ${articles.length} articles\n`);
                articles.forEach((a, i) => {
                    console.log(`[${i + 1}] ${a.title}`);
                    console.log(`    ${a.source?.name} — ${a.publishedAt}`);
                    if (a.description) console.log(`    ${a.description.substring(0, 120)}`);
                    console.log();
                });
            } else if (cmd === 'context') {
                const tweet = getArg('tweet');
                if (!tweet) { console.error('--tweet required'); process.exit(1); }
                console.log(`⏳ Fetching context for: "${tweet}"\n`);
                const ctx = await contextFor(tweet, { topic: getArg('topic') || 'crypto' });
                console.log(ctx || '(no relevant news found)');
            } else if (cmd === 'extract') {
                const tweet = getArg('tweet');
                if (!tweet) { console.error('--tweet required'); process.exit(1); }
                console.log(`Query extracted: "${extractQueryFromTweet(tweet)}"`);
            } else {
                console.error(`Unknown command: ${cmd}`);
            }
        } catch (e) {
            console.error('❌', e.message);
            process.exit(1);
        }
    })();
}
