/**
 * news.js — NewsAPI client for enriching X replies with live headlines
 *
 * Usage (CLI):
 *   node news.js headlines --category technology
 *   node news.js search --q "bitcoin ETF"
 *   node news.js search --q "federal reserve" --from 2026-02-20 --sort publishedAt
 *
 * Usage (module):
 *   const news = require('./news');
 *   const articles = await news.headlines({ category: 'technology' });
 *   const articles = await news.search({ q: 'bitcoin', pageSize: 5 });
 *   const context  = await news.contextFor(tweetText);  // ← main enrichment entrypoint
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── Load .env ────────────────────────────────────────────────────────────
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

const API_KEY = process.env.NEWS_API_KEY || 'd5f89d89245b414ba594e76040efe4da';
const BASE_URL = 'newsapi.org';

// ── HTTP helper ──────────────────────────────────────────────────────────
function request(endpoint, params = {}) {
    if (!API_KEY) throw new Error('NEWS_API_KEY not set');

    const qs = new URLSearchParams({ ...params, apiKey: API_KEY }).toString();
    const reqPath = `/v2/${endpoint}?${qs}`;

    return new Promise((resolve, reject) => {
        const opts = {
            hostname: BASE_URL,
            path: reqPath,
            method: 'GET',
            headers: { 'User-Agent': 'newsbot/1.0' },
            timeout: 10000,
        };

        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.status !== 'ok') {
                        reject(new Error(`NewsAPI error: ${json.code} — ${json.message}`));
                    } else {
                        resolve(json);
                    }
                } catch {
                    reject(new Error(`Parse error: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('NewsAPI timeout')); });
        req.end();
    });
}

// ── Core API methods ─────────────────────────────────────────────────────

/**
 * Top breaking headlines.
 *
 * @param {object} opts
 * @param {string}  opts.category  - business | entertainment | general | health | science | sports | technology
 * @param {string}  opts.country   - 2-letter ISO code (default: 'us'). Cannot combine with sources.
 * @param {string}  opts.sources   - comma-separated source IDs. Cannot combine with country/category.
 * @param {string}  opts.q         - keyword search within headlines
 * @param {number}  opts.pageSize  - results to return (default: 5, max: 100)
 * @returns {Promise<Article[]>}
 */
async function headlines(opts = {}) {
    const { category, country = 'us', sources, q, pageSize = 5 } = opts;
    const params = { language: 'en', pageSize };

    // sources param cannot be mixed with country or category
    if (sources) {
        params.sources = sources;
    } else {
        params.country = country;
        if (category) params.category = category;
    }

    if (q) params.q = q;

    const res = await request('top-headlines', params);
    return res.articles || [];
}

/**
 * Search all articles (past ~1 month on free tier).
 *
 * @param {object} opts
 * @param {string}  opts.q         - required: keyword or phrase. Supports AND/OR/NOT.
 * @param {string}  opts.qinTitle  - search only in title
 * @param {string}  opts.sources   - comma-separated source IDs (max 20)
 * @param {string}  opts.domains   - comma-separated domains e.g. 'bbc.co.uk,techcrunch.com'
 * @param {string}  opts.from      - ISO 8601 date (e.g. '2026-02-20')
 * @param {string}  opts.to        - ISO 8601 date
 * @param {string}  opts.sortBy    - relevancy | popularity | publishedAt (default: publishedAt)
 * @param {number}  opts.pageSize  - results to return (default: 5, max: 100)
 * @returns {Promise<Article[]>}
 */
async function search(opts = {}) {
    const { q, qinTitle, sources, domains, from, to, sortBy = 'publishedAt', pageSize = 5 } = opts;
    if (!q && !sources && !domains) throw new Error('search() requires at least one of: q, sources, domains');

    const params = { language: 'en', sortBy, pageSize };
    if (q) params.q = q;
    if (qinTitle) params.qInTitle = qinTitle;
    if (sources) params.sources = sources;
    if (domains) params.domains = domains;
    if (from) params.from = from;
    if (to) params.to = to;

    const res = await request('everything', params);
    return res.articles || [];
}

/**
 * Format articles into a compact context string for the reply agent.
 * Output: "HEADLINE (source, age)" — one per line, max 3 items.
 */
function formatContext(articles, label = 'NEWS') {
    if (!articles || articles.length === 0) return null;

    const now = Date.now();
    const lines = articles.slice(0, 3).map(a => {
        const source = a.source?.name || 'unknown';
        const ageMs = now - new Date(a.publishedAt).getTime();
        const ageH = Math.round(ageMs / (1000 * 60 * 60));
        const age = ageH < 1 ? 'just now' : ageH < 24 ? `${ageH}h ago` : `${Math.round(ageH / 24)}d ago`;
        const text = a.description
            ? `${a.title} — ${a.description.substring(0, 100)}`
            : a.title;
        return `• ${text} (${source}, ${age})`;
    });

    return `[${label}]:\n${lines.join('\n')}`;
}

// ── Topic routing map ────────────────────────────────────────────────────
const TOPIC_ROUTES = {
    stocks: { category: 'business', q: 'stocks market trading' },
    finance: { category: 'business', q: 'finance economy' },
    crypto: { q: 'cryptocurrency bitcoin ethereum crypto', sortBy: 'publishedAt' },
    defi: { q: 'DeFi decentralized finance blockchain', sortBy: 'publishedAt' },
    web3: { q: 'web3 blockchain crypto', sortBy: 'publishedAt' },
    shilling: { q: 'crypto altcoin token launch', sortBy: 'publishedAt' },
    tech: { category: 'technology' },
    ai: { q: 'artificial intelligence AI LLM agents', category: 'technology' },
    news: { category: 'general', country: 'us' },
    politics: { q: 'politics government congress senate', category: 'general' },
    business: { category: 'business' },
};

// Keyword-level overrides — if tweet contains these phrases, use a targeted query
const KEYWORD_OVERRIDES = [
    { pattern: /\b(bitcoin|btc)\b/i, q: 'bitcoin BTC price' },
    { pattern: /\b(ethereum|eth)\b/i, q: 'ethereum ETH price' },
    { pattern: /\b(solana|sol)\b/i, q: 'Solana SOL crypto' },
    { pattern: /\b(federal reserve|fed rate|interest rate|fomc)\b/i, q: 'Federal Reserve interest rates FOMC' },
    { pattern: /\b(inflation|cpi|pce)\b/i, q: 'inflation CPI economy' },
    { pattern: /\b(tariff|trade war|import)\b/i, q: 'tariffs trade policy' },
    { pattern: /\b(nvidia|amd|intel|chip)\b/i, q: 'semiconductor chip AI nvidia' },
    { pattern: /\b(openai|gpt|chatgpt)\b/i, q: 'OpenAI GPT ChatGPT' },
    { pattern: /\b(apple|aapl)\b/i, q: 'Apple AAPL stock earnings' },
    { pattern: /\b(tesla|tsla)\b/i, q: 'Tesla TSLA stock' },
    { pattern: /\b(meta|facebook|zuckerberg)\b/i, q: 'Meta Facebook earnings' },
    { pattern: /\b(trump|biden|white house|congress)\b/i, q: 'Trump White House politics' },
    { pattern: /\b(sec|regulation|regulatory|lawsuit)\b/i, q: 'SEC regulation crypto finance' },
    { pattern: /\b(ipo|listing|public offering)\b/i, q: 'IPO stock listing' },
    { pattern: /\b(recession|gdp|growth)\b/i, q: 'recession GDP economic growth' },
    { pattern: /\b(nft|opensea|blur)\b/i, q: 'NFT market trading' },
    { pattern: /\b(layoffs?|firing|cuts)\b/i, q: 'tech layoffs job cuts' },
    { pattern: /\b(venture|startup|seed|series [ab])\b/i, q: 'startup funding venture capital' },
];

/**
 * Main enrichment entrypoint — call this from x-feed-engage.js.
 */
async function contextFor(tweetText, analysis = {}, timeout = 8000) {
    const topic = analysis.topic || 'other';

    const SKIP_TOPICS = new Set(['motivational', 'lifestyle', 'religion', 'personal', 'humor']);
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
    // 1. Check keyword overrides first
    for (const { pattern, q } of KEYWORD_OVERRIDES) {
        if (pattern.test(tweetText)) {
            const from = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
            const articles = await search({ q, from, sortBy: 'publishedAt', pageSize: 3 });
            if (articles.length > 0) return formatContext(articles, 'NEWS');
        }
    }

    // 2. Fall back to topic route
    const route = TOPIC_ROUTES[topic];
    if (!route) return null;

    let articles;
    if (route.category && !route.q) {
        articles = await headlines({ category: route.category, pageSize: 3 });
    } else if (route.q) {
        const from = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
        articles = await search({ q: route.q, from, sortBy: 'publishedAt', pageSize: 3 });
    }

    if (!articles || articles.length === 0) return null;
    return formatContext(articles, 'NEWS');
}

// ── Exports ──────────────────────────────────────────────────────────────
module.exports = { headlines, search, contextFor, formatContext };

// ── CLI ──────────────────────────────────────────────────────────────────
if (require.main === module) {
    const args = process.argv.slice(2);
    const cmd = args[0];

    function getArg(name) {
        const idx = args.indexOf(`--${name}`);
        return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
    }

    if (!cmd) {
        console.log(`Usage:
  node news.js headlines --category technology
  node news.js headlines --q "bitcoin" --country us
  node news.js search --q "federal reserve" --from 2026-02-20
  node news.js search --q "AI agents" --sort relevancy --size 10
  node news.js context --tweet "bitcoin just broke 100k again"`);
        process.exit(0);
    }

    (async () => {
        try {
            if (cmd === 'headlines') {
                const articles = await headlines({
                    category: getArg('category'),
                    country: getArg('country') || 'us',
                    q: getArg('q'),
                    pageSize: parseInt(getArg('size') || '5'),
                });
                console.log(`✅ ${articles.length} headlines\n`);
                articles.forEach((a, i) => {
                    console.log(`[${i + 1}] ${a.title}`);
                    console.log(`    ${a.source?.name} — ${a.publishedAt}`);
                    if (a.description) console.log(`    ${a.description.substring(0, 120)}`);
                    console.log();
                });
            }
            else if (cmd === 'search') {
                const q = getArg('q');
                if (!q) { console.error('--q required for search'); process.exit(1); }
                const articles = await search({
                    q,
                    from: getArg('from'),
                    sortBy: getArg('sort') || 'publishedAt',
                    pageSize: parseInt(getArg('size') || '5'),
                });
                console.log(`✅ ${articles.length} articles\n`);
                articles.forEach((a, i) => {
                    console.log(`[${i + 1}] ${a.title}`);
                    console.log(`    ${a.source?.name} — ${a.publishedAt}`);
                    if (a.description) console.log(`    ${a.description.substring(0, 120)}`);
                    console.log();
                });
            }
            else if (cmd === 'context') {
                const tweet = getArg('tweet');
                if (!tweet) { console.error('--tweet required'); process.exit(1); }
                const topic = getArg('topic') || 'crypto';
                console.log(`⏳ Fetching context for: "${tweet}"\n`);
                const ctx = await contextFor(tweet, { topic });
                console.log(ctx || '(no relevant news found)');
            }
            else {
                console.error(`Unknown command: ${cmd}`);
            }
        } catch (e) {
            console.error('❌', e.message);
            process.exit(1);
        }
    })();
}
