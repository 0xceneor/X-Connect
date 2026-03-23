/**
 * x-evaluate.js — Evaluate an X account and generate actionable feedback.
 *
 * Usage:
 *   node scripts/x-evaluate.js @username
 *   node scripts/x-evaluate.js username --push       (also POST to evaluate.php)
 *   node scripts/x-evaluate.js @username --headless  (headless mode)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const puppeteer = require('puppeteer-core');
const OpenAI    = require('openai').default || require('openai');
const path      = require('path');
const fs        = require('fs');

// ── Config ──────────────────────────────────────────────────────────────────
const COOKIES_PATH = path.join(__dirname, '..', 'config', 'cookies.json');
const DEBUG_DIR    = path.join(__dirname, '..', 'debug');
const EVAL_DIR     = path.join(DEBUG_DIR, 'evaluations');
const USER_DATA_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw', 'x-profile-v2');

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
if (!NVIDIA_API_KEY) { console.error('❌ NVIDIA_API_KEY not set in .env'); process.exit(1); }

const TEXT_MODEL   = 'moonshotai/kimi-k2-instruct';
const VISION_MODEL = 'microsoft/phi-4-multimodal-instruct';

const openai = new OpenAI({
    apiKey:     NVIDIA_API_KEY,
    baseURL:    'https://integrate.api.nvidia.com/v1',
    timeout:    60000,
    maxRetries: 1,
});

const args     = process.argv.slice(2);
const rawUser  = args.find(a => !a.startsWith('--')) || '';
const username = rawUser.replace(/^@/, '').trim();
const PUSH     = args.includes('--push');
const HEADLESS = !args.includes('--no-headless');

if (!username) { console.error('Usage: node x-evaluate.js @username'); process.exit(1); }

if (!fs.existsSync(EVAL_DIR)) fs.mkdirSync(EVAL_DIR, { recursive: true });

// ── Helpers ─────────────────────────────────────────────────────────────────
const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
    red: '\x1b[31m', white: '\x1b[37m', gray: '\x1b[90m',
    bg: '\x1b[40m',
};

function log(msg) { console.log(`${C.gray}[eval]${C.reset} ${msg}`); }
function bar(score, width = 20) {
    const filled = Math.round((score / 10) * width);
    const color  = score >= 7 ? C.green : score >= 5 ? C.yellow : C.red;
    return color + '█'.repeat(filled) + C.gray + '░'.repeat(width - filled) + C.reset;
}
function grade(score) {
    if (score >= 9) return `${C.green}A+${C.reset}`;
    if (score >= 8) return `${C.green}A${C.reset}`;
    if (score >= 7) return `${C.cyan}B+${C.reset}`;
    if (score >= 6) return `${C.cyan}B${C.reset}`;
    if (score >= 5) return `${C.yellow}C${C.reset}`;
    if (score >= 4) return `${C.yellow}D${C.reset}`;
    return `${C.red}F${C.reset}`;
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function findChrome() {
    if (process.platform === 'linux') {
        for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']) {
            if (fs.existsSync(p)) return p;
        }
    }
    const win = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const p of win) { if (fs.existsSync(p)) return p; }
    const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(mac)) return mac;
    return null;
}

function parseStatNum(str) {
    if (!str) return null;
    const s = str.replace(/,/g, '').trim();
    if (/k$/i.test(s)) return Math.round(parseFloat(s) * 1000);
    if (/m$/i.test(s)) return Math.round(parseFloat(s) * 1000000);
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
}

// ── Vision: describe profile pic + banner ────────────────────────────────────
async function describeVisuals(pfpUrl, bannerUrl) {
    const images = [pfpUrl, bannerUrl].filter(Boolean).slice(0, 2);
    if (images.length === 0) return null;
    try {
        const content = [
            { type: 'text', text: 'Evaluate this X (Twitter) account\'s visual identity. Profile pic first, then banner if present. Be brief (2-3 sentences total): assess professionalism, clarity, brand alignment, and memorability.' },
            ...images.map(url => ({ type: 'image_url', image_url: { url } })),
        ];
        const res = await openai.chat.completions.create({
            model: VISION_MODEL,
            messages: [
                { role: 'system', content: 'You are a social media brand analyst. Be concise and specific.' },
                { role: 'user', content },
            ],
            temperature: 0.2,
            max_tokens: 150,
            stream: false,
        });
        return res.choices?.[0]?.message?.content?.trim() || null;
    } catch (e) {
        log(`Vision error: ${e.message}`);
        return null;
    }
}

// ── Kimi-K2: full account evaluation ────────────────────────────────────────
async function evaluateAccount(profile, tweets, visualDesc) {
    const tweetSample = tweets.slice(0, 20).map((t, i) =>
        `${i + 1}. "${t.text.substring(0, 200)}" [❤️${t.likes ?? '?'} 🔁${t.reposts ?? '?'} 💬${t.replies ?? '?'}]`
    ).join('\n');

    const avgLikes   = tweets.length ? (tweets.reduce((s, t) => s + (t.likes || 0), 0) / tweets.length).toFixed(1) : 0;
    const avgReposts = tweets.length ? (tweets.reduce((s, t) => s + (t.reposts || 0), 0) / tweets.length).toFixed(1) : 0;
    const avgReplies = tweets.length ? (tweets.reduce((s, t) => s + (t.replies || 0), 0) / tweets.length).toFixed(1) : 0;

    // Proxy weighted ER (no impressions — estimate impressions ≈ followers × 8%)
    const followersN = parseStatNum(profile.followers) || 1000;
    const estImpressions = followersN * 0.08;
    const weightedER = tweets.length
        ? ((avgLikes * 1 + avgReposts * 20 + avgReplies * 13.5) / estImpressions * 100).toFixed(2)
        : null;

    const SYSTEM = `You are an elite X (formerly Twitter) Account Intelligence Analyst in March 2026. Your evaluations are known for exceptional depth, data precision, and brutally honest, life-changing feedback. You treat data as the ultimate competitive edge.

CORE 2026 REALITIES (apply relentlessly):
• Grok/xAI transformer (fully live Jan 2026) semantically reads every post for relevance, insight density, emotional tone, and constructive value. Weights: early engagement velocity (first 15–60 min critical), reply depth, bookmarks (10×), replies (13.5×), reposts (20×), dwell time. Negativity/polarization heavily penalized.
• Premium/Verified accounts: 2–4× visibility multiplier. External links: 30–50% reach drop.
• Median ER benchmarks: Micro <5K: Good 2–5%, Excellent >5% | Small/Mid 5K–50K: Good 1–3%, Excellent >4% | Large 50K–500K: Good 0.5–2%, Excellent >2% | Massive >500K: Good 0.2–1%, Excellent >1%
• Optimal posting: 3–7/day baseline, up to 8–10/day viable for high-signal KOLs if spaced 1–3h and velocity stable. Bursts <30 min trigger suppression.
• Weighted ER = [(Likes×1)+(Reposts×20)+(Replies×13.5)+(Quotes×15)+(Bookmarks×10)] / Impressions × 100
• Account Types: Brand (corporate/product), KOL/Influencer (sponsorships/affiliates), Creator/Individual (organic/community)

Return ONLY valid JSON — no markdown, no backticks, no commentary outside JSON.`;

    const USER = `Evaluate this X account using the 2026 Intelligence Framework. Return ONLY the JSON structure below.

ACCOUNT DATA:
Handle: @${profile.username} | Display: ${profile.displayName || 'not set'} | Bio: ${profile.bio || 'empty'}
Website: ${profile.website || 'none'} | Location: ${profile.location || 'none'} | Joined: ${profile.joinDate || 'unknown'}
Followers: ${profile.followers ?? 'unknown'} | Following: ${profile.following ?? 'unknown'} | Total Posts: ${profile.tweetCount ?? 'unknown'}
Pinned: ${profile.pinnedTweet?.substring(0, 120) || 'none'} | Visual: ${visualDesc || 'not available'}
Sample avg: ❤️${avgLikes} 🔁${avgReposts} 💬${avgReplies} per post | Est. weighted ER: ${weightedER ?? 'unknown'}% (proxy: followers×8% impressions)

RECENT POSTS (${tweets.length} collected):
${tweetSample || 'none available'}

OUTPUT this exact JSON (no other text):
{
  "overall": <number 1.0–10.0, one decimal — weighted average of all 5 dimension scores>,
  "grade": <"A+" | "A" | "B+" | "B" | "C" | "D" | "F">,
  "summary": <2–3 sentence brutally honest assessment citing specific data points>,
  "niche": <primary niche in 2–4 words>,
  "dimensions": {
    "algo_fit":     { "score": <1–10>, "label": "Algo Fit",        "good": [<1–2 specific strengths>], "fix": [<2–3 specific data-backed improvements>] },
    "authenticity": { "score": <1–10>, "label": "Authenticity",    "good": [<1–2 specific strengths>], "fix": [<2–3 specific data-backed improvements>] },
    "content":      { "score": <1–10>, "label": "Content Quality", "good": [<1–2 specific strengths>], "fix": [<2–3 specific data-backed improvements>] },
    "growth":       { "score": <1–10>, "label": "Growth Signal",   "good": [<1–2 specific strengths>], "fix": [<2–3 possible growth directions worth exploring, framed as opportunities not obligations>] },
    "monetization": { "score": <1–10>, "label": "Monetization",    "good": [<1–2 specific strengths>], "fix": [<2–3 possible monetization paths that could fit this account's style, framed as options not requirements>] }
  },
  "top_actions": [<exactly 3 highest-ROI actions, each under 15 words, data-referenced>],
  "card": {
    "style": <cyber|neon|iridescent|glitch|cosmic|analog|minimal|liquid|fire|nature|gold|manga — cyber=crypto/hacker, neon=gaming/EDM, iridescent=NFT/web3, glitch=meme/viral, cosmic=AI/tech/dev, analog=music/film, minimal=writing/essays, liquid=art/design, fire=trading/alpha, nature=eco, gold=elite overall>=8.5 only, manga=anime>,
    "rarity": <common|uncommon|rare|epic|legendary — legendary=top 1% reach, epic=top 5% strong+growing, rare=solid established, uncommon=decent growing, common=early/low-engagement>,
    "title": <2–5 word creative archetype e.g. "The Signal Caller", "Chaos Meme Lord", "On-Chain Archaeologist">,
    "subtitle": <6–10 word footer phrase e.g. "Calling DeFi alpha since 2019 · daily signals">
  },
  "report": {
    "account_type": <"Brand Account" | "KOL/Influencer" | "Creator/Individual">,
    "weighted_er_pct": <estimated weighted ER as string e.g. "1.24%" or "unknown">,
    "er_percentile": <e.g. "Top 18% for mid-size creators" — be specific>,
    "algo_risk_score": <0–100, higher = more suppression risk>,
    "algo_risk_flags": [<2–4 specific suppression signals observed>],
    "velocity_insight": <1–2 sentence finding on engagement velocity pattern>,
    "quick_wins": [<2–3 low-effort experiments worth trying in 1–7 days — frame as "could try X to potentially see Y", not commands>],
    "strategy_fixes": [<2–3 medium-term directions worth exploring over 14–30 days — frame as possibilities and trade-offs, not mandates>],
    "long_term": [<2–3 compounding habits that tend to work for accounts like this over 30–90 days — frame as patterns, not rules>],
    "kpis": [<exactly 3 weekly KPIs to track>],
    "verdict": <1 sentence executive verdict: core strength + primary risk + overall potential>
  }
}`;

    const res = await openai.chat.completions.create({
        model: TEXT_MODEL,
        messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user',   content: USER },
        ],
        temperature: 0.25,
        max_tokens: 12000,
        stream: false,
    });

    const raw = res.choices?.[0]?.message?.content?.trim() || '';
    // Strip markdown fences
    let cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
    // Extract from first { onward
    const start = cleaned.indexOf('{');
    if (start !== -1) cleaned = cleaned.slice(start);
    // Attempt parse; if it fails, try closing unclosed braces/brackets
    let parsed;
    for (let extra = 0; extra <= 6; extra++) {
        try {
            parsed = JSON.parse(cleaned + '}'.repeat(extra));
            break;
        } catch (_) {}
    }
    if (!parsed) throw new Error('Could not repair AI JSON response');
    // Hoist top_actions if AI nested it inside dimensions
    if (!parsed.top_actions && parsed.dimensions?.top_actions) {
        parsed.top_actions = parsed.dimensions.top_actions;
        delete parsed.dimensions.top_actions;
    }
    if (!parsed.top_actions && parsed.dimensions) {
        for (const key of Object.keys(parsed.dimensions)) {
            if (parsed.dimensions[key]?.top_actions) {
                parsed.top_actions = parsed.dimensions[key].top_actions;
                delete parsed.dimensions[key].top_actions;
                break;
            }
        }
    }
    // Hoist card block if AI nested it inside dimensions
    if (!parsed.card && parsed.dimensions?.card) {
        parsed.card = parsed.dimensions.card;
        delete parsed.dimensions.card;
    }
    // Hoist report block if AI nested it inside dimensions
    if (!parsed.report && parsed.dimensions?.report) {
        parsed.report = parsed.dimensions.report;
        delete parsed.dimensions.report;
    }
    // Remove any non-dimension keys that leaked into dimensions (no label = not a dimension)
    if (parsed.dimensions) {
        for (const key of Object.keys(parsed.dimensions)) {
            if (!parsed.dimensions[key]?.label) delete parsed.dimensions[key];
        }
    }
    return parsed;
}

// ── Scrape profile ───────────────────────────────────────────────────────────
async function scrapeProfile(page, uname) {
    log(`Navigating to @${uname} profile...`);
    await page.goto(`https://x.com/${uname}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(2500);

    return page.evaluate(() => {
        const getText = sel => document.querySelector(sel)?.innerText?.trim() || null;
        const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || null;

        // Name + bio
        const displayName = getText('[data-testid="UserName"] span:first-child') ||
                            getText('h2[role="heading"] span');
        const bio = getText('[data-testid="UserDescription"]');
        const website = getText('[data-testid="UserUrl"] a') ||
                        getAttr('[data-testid="UserUrl"] a', 'href');
        const location = getText('[data-testid="UserLocation"]');
        const joinDate  = getText('[data-testid="UserJoinDate"]');

        // Stats — DOM link approach + text-based fallback
        let followers = null, following = null, tweetCount = null;
        const firstNum = el => {
            if (!el) return null;
            for (const s of Array.from(el.querySelectorAll('span'))) {
                const t = s.innerText?.trim();
                if (t && /^[\d,.]+[KkMm]?$/.test(t) && t !== '0') return t;
            }
            return null;
        };
        document.querySelectorAll('a[href*="/followers"]').forEach(a => {
            if (followers) return;
            const href = a.getAttribute('href') || '';
            if (href.endsWith('/following')) return;
            const n = firstNum(a);
            if (n) followers = n;
        });
        document.querySelectorAll('a[href*="/following"]').forEach(a => {
            if (following) return;
            const href = a.getAttribute('href') || '';
            if (href.includes('/followers')) return;
            const n = firstNum(a);
            if (n) following = n;
        });

        // Text-based fallback — scan full page text for "N Followers", "N Following", "N Posts"
        const pageText = document.body.innerText;
        if (!followers) { const m = pageText.match(/([\d,.]+[KkMm]?)\s+Followers/i); if (m) followers = m[1]; }
        if (!following) { const m = pageText.match(/([\d,.]+[KkMm]?)\s+Following/i); if (m) following = m[1]; }
        if (!tweetCount) { const m = pageText.match(/([\d,.]+[KkMm]?)\s+[Pp]osts?(?:\s|$)/); if (m) tweetCount = m[1]; }

        // profile pic + banner
        const pfpEl = document.querySelector('a[href$="/photo"] img, [data-testid="UserAvatar-Container"] img');
        let pfpUrl = pfpEl?.src || null;
        if (pfpUrl && pfpUrl.includes('_normal')) pfpUrl = pfpUrl.replace('_normal', '_400x400');

        const bannerEl = document.querySelector('[data-testid="UserProfileHeader_Items"] img, img[src*="profile_banners"]') ||
                         document.querySelector('img[src*="profile_banners"]');
        const bannerUrl = bannerEl?.src || null;

        // pinned tweet
        const pinned = document.querySelector('[data-testid="tweet"] [data-testid="tweetText"]');
        const pinnedTweet = pinned?.innerText?.trim()?.substring(0, 200) || null;

        return { displayName, bio, website, location, joinDate, followers, following, tweetCount, pfpUrl, bannerUrl, pinnedTweet };
    });
}

// ── Scrape recent tweets ─────────────────────────────────────────────────────
async function scrapeTweets(page) {
    log('Collecting recent tweets...');
    // scroll a few times to load more
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 1200));
        await wait(1200);
    }

    return page.evaluate(() => {
        const results = [];
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        articles.forEach(article => {
            try {
                const text = article.querySelector('[data-testid="tweetText"]')?.innerText?.trim();
                if (!text) return;
                const getStatN = (testId) => {
                    const btn = article.querySelector(`[data-testid="${testId}"]`);
                    if (!btn) return null;
                    const label = btn.getAttribute('aria-label') || '';
                    const m = label.match(/([\d,]+)/);
                    if (m) return parseInt(m[1].replace(/,/g, ''), 10);
                    const spans = btn.querySelectorAll('span');
                    for (const s of spans) {
                        const t = s.textContent.trim();
                        if (/^\d/.test(t)) return parseInt(t.replace(/,/g, ''), 10) || 0;
                    }
                    return null;
                };
                results.push({
                    text: text.substring(0, 280),
                    likes:   getStatN('like'),
                    reposts: getStatN('retweet'),
                    replies: getStatN('reply'),
                });
            } catch (_) {}
        });
        return results.slice(0, 20);
    });
}

// ── Print report ─────────────────────────────────────────────────────────────
function printReport(profile, evaluation) {
    const w = 60;
    const line = C.gray + '─'.repeat(w) + C.reset;
    console.log('\n' + C.bold + C.white + '═'.repeat(w) + C.reset);
    console.log(C.bold + ` X ACCOUNT EVALUATION — @${profile.username}` + C.reset);
    console.log(C.bold + C.white + '═'.repeat(w) + C.reset);

    // header stats
    console.log(`\n  ${C.gray}Followers${C.reset}  ${C.bold}${profile.followers ?? '?'}${C.reset}  ` +
                `${C.gray}Following${C.reset}  ${C.bold}${profile.following ?? '?'}${C.reset}  ` +
                `${C.gray}Posts${C.reset}  ${C.bold}${profile.tweetCount ?? '?'}${C.reset}`);
    if (profile.bio) console.log(`\n  ${C.dim}"${profile.bio.substring(0, 100)}"${C.reset}`);

    // overall score
    const overall = evaluation.overall || 0;
    console.log(`\n${line}`);
    console.log(`  ${C.bold}OVERALL SCORE${C.reset}   ${bar(overall, 28)}  ${C.bold}${overall}/10${C.reset}  ${grade(overall)}  ${C.gray}[${evaluation.niche || ''}]${C.reset}`);
    console.log(`\n  ${evaluation.summary}`);
    console.log(line);

    // dimensions
    console.log(`\n  ${C.bold}DIMENSIONS${C.reset}\n`);
    for (const [, dim] of Object.entries(evaluation.dimensions || {})) {
        if (!dim?.label) continue;  // skip any non-dimension entries that leaked in
        const s = dim.score || 0;
        const color = s >= 7 ? C.green : s >= 5 ? C.yellow : C.red;
        console.log(`  ${C.bold}${dim.label.padEnd(20)}${C.reset} ${bar(s, 16)}  ${color}${s}/10${C.reset}`);
        if (dim.good?.length) {
            dim.good.forEach(g => console.log(`    ${C.green}✓${C.reset} ${C.dim}${g}${C.reset}`));
        }
        if (dim.fix?.length) {
            dim.fix.forEach(f => console.log(`    ${C.yellow}→${C.reset} ${f}`));
        }
        console.log();
    }

    // top actions
    if (evaluation.top_actions?.length) {
        console.log(line);
        console.log(`\n  ${C.bold}TOP 3 ACTIONS${C.reset}\n`);
        evaluation.top_actions.forEach((a, i) => {
            console.log(`  ${C.bold}${C.cyan}${i + 1}.${C.reset} ${a}`);
        });
    }

    // report section
    const r = evaluation.report;
    if (r) {
        console.log('\n' + line);
        console.log(`\n  ${C.bold}INTELLIGENCE REPORT${C.reset}  ${C.gray}${r.account_type || ''}${C.reset}\n`);
        if (r.verdict) console.log(`  ${C.bold}Verdict:${C.reset} ${r.verdict}\n`);
        if (r.weighted_er_pct) console.log(`  ${C.gray}Weighted ER:${C.reset} ${C.bold}${r.weighted_er_pct}${C.reset}  ${C.gray}${r.er_percentile || ''}${C.reset}`);
        if (r.algo_risk_score != null) {
            const riskColor = r.algo_risk_score >= 60 ? C.red : r.algo_risk_score >= 35 ? C.yellow : C.green;
            console.log(`  ${C.gray}Algo Risk:${C.reset} ${riskColor}${r.algo_risk_score}/100${C.reset}  ${C.dim}${(r.algo_risk_flags || []).join(' · ')}${C.reset}`);
        }
        if (r.velocity_insight) console.log(`\n  ${C.dim}${r.velocity_insight}${C.reset}`);
        if (r.quick_wins?.length) {
            console.log(`\n  ${C.bold}Quick Wins (1–7 days)${C.reset}`);
            r.quick_wins.forEach(a => console.log(`    ${C.green}→${C.reset} ${a}`));
        }
        if (r.kpis?.length) {
            console.log(`\n  ${C.bold}Track Weekly:${C.reset} ${r.kpis.join('  ·  ')}`);
        }
    }

    console.log('\n' + C.bold + C.white + '═'.repeat(w) + C.reset + '\n');
}

// ── Push to evaluate.php ─────────────────────────────────────────────────────
async function pushEvaluation(data) {
    const url    = process.env.FEED_PUSH_URL?.replace('/feed.php', '/evaluate.php');
    const secret = process.env.FEED_PUSH_SECRET;
    if (!url || !secret) { log('No FEED_PUSH_URL/SECRET set, skipping push'); return; }
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret, ...data }),
            signal: AbortSignal.timeout(10000),
        });
        const json = await res.json();
        log(`Pushed to evaluate.php: ${JSON.stringify(json)}`);
    } catch (e) {
        log(`Push failed: ${e.message}`);
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
    const CHROME_PATH = findChrome();
    if (!CHROME_PATH) { console.error('❌ Chrome not found'); process.exit(1); }

    console.log(`\n${C.bold}${C.cyan} X-EVALUATE${C.reset}  scanning @${username}...\n`);

    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        userDataDir:    USER_DATA_DIR,
        headless:       HEADLESS,
        defaultViewport: { width: 1280, height: 800 },
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36');

    // load cookies
    if (fs.existsSync(COOKIES_PATH)) {
        try {
            const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
            const sameSiteMap = { 'no_restriction': 'None', 'lax': 'Lax', 'strict': 'Strict' };
            const clean = (Array.isArray(cookies) ? cookies : []).map(c => ({
                ...c,
                sameSite: sameSiteMap[c.sameSite] || c.sameSite || 'Lax',
            })).filter(c => c.name && c.value && c.domain);
            await page.setCookie(...clean);
            log(`Loaded ${clean.length} cookies`);
        } catch (e) { log(`Cookie load error: ${e.message}`); }
    }

    try {
        // 1. scrape profile
        const profile = await scrapeProfile(page, username);
        profile.username = username;
        log(`Profile: ${profile.displayName} | ${profile.followers} followers | ${profile.tweetCount} posts`);

        // 2. scrape tweets
        const tweets = await scrapeTweets(page);
        log(`Collected ${tweets.length} tweets`);

        // 3. vision analysis
        log('Running vision analysis on profile visuals...');
        const visualDesc = await describeVisuals(profile.pfpUrl, profile.bannerUrl);
        if (visualDesc) log(`Visual: ${visualDesc.substring(0, 80)}...`);

        // 4. AI evaluation
        log('Running AI evaluation (Kimi-K2)...');
        const evaluation = await evaluateAccount(profile, tweets, visualDesc);

        // 5. print
        printReport(profile, evaluation);

        // 6. save
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const outPath = path.join(EVAL_DIR, `${username}-${timestamp}.json`);
        const payload = {
            username,
            profile,
            evaluation,
            tweetCount: tweets.length,
            visualDesc,
            scannedAt: new Date().toISOString(),
        };
        fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
        log(`Saved → ${outPath}`);

        // 7. push
        if (PUSH) await pushEvaluation(payload);

    } finally {
        await browser.close();
    }
})();
