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
    const tweetSample = tweets.slice(0, 15).map((t, i) =>
        `${i + 1}. "${t.text.substring(0, 160)}" [❤️${t.likes ?? '?'} 🔁${t.reposts ?? '?'} 💬${t.replies ?? '?'}]`
    ).join('\n');

    const avgLikes   = tweets.length ? Math.round(tweets.reduce((s, t) => s + (t.likes || 0), 0) / tweets.length) : 0;
    const avgReposts = tweets.length ? Math.round(tweets.reduce((s, t) => s + (t.reposts || 0), 0) / tweets.length) : 0;

    const prompt = `You are an expert X (Twitter) account analyst. Evaluate this account and return ONLY valid JSON — no markdown, no backticks.

ACCOUNT DATA:
- Handle: @${profile.username}
- Display Name: ${profile.displayName || 'not set'}
- Bio: ${profile.bio || 'empty'}
- Website: ${profile.website || 'none'}
- Location: ${profile.location || 'none'}
- Followers: ${profile.followers ?? 'unknown'}
- Following: ${profile.following ?? 'unknown'}
- Total Tweets: ${profile.tweetCount ?? 'unknown'}
- Joined: ${profile.joinDate || 'unknown'}
- Pinned tweet: ${profile.pinnedTweet || 'none'}
- Visual assessment: ${visualDesc || 'not available'}
- Avg likes per post: ${avgLikes}
- Avg reposts per post: ${avgReposts}

RECENT TWEETS (sample):
${tweetSample || 'none available'}

Evaluate across these 5 dimensions (score 1-10) and return this exact JSON structure:
{
  "overall": <number 1-10 with one decimal>,
  "grade": <"A+" | "A" | "B+" | "B" | "C" | "D" | "F">,
  "summary": <2-3 sentence overall assessment>,
  "niche": <detected primary niche/topic in 2-4 words>,
  "dimensions": {
    "profile_setup":     { "score": <1-10>, "label": "Profile Setup",     "good": [<up to 2 things done well>], "fix": [<up to 3 specific improvements>] },
    "content_quality":   { "score": <1-10>, "label": "Content Quality",   "good": [<up to 2 things done well>], "fix": [<up to 3 specific improvements>] },
    "niche_authority":   { "score": <1-10>, "label": "Niche Authority",   "good": [<up to 2 things done well>], "fix": [<up to 3 specific improvements>] },
    "engagement_health": { "score": <1-10>, "label": "Engagement Health", "good": [<up to 2 things done well>], "fix": [<up to 3 specific improvements>] },
    "growth_signals":    { "score": <1-10>, "label": "Growth Signals",    "good": [<up to 2 things done well>], "fix": [<up to 3 specific improvements>] }
  },
  "top_actions": [<exactly 3 highest-impact actions, each under 12 words>]
}`;

    const res = await openai.chat.completions.create({
        model: TEXT_MODEL,
        messages: [
            { role: 'system', content: 'You are an expert social media strategist. Return only valid JSON.' },
            { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 8000,
        stream: false,
    });

    const raw = res.choices?.[0]?.message?.content?.trim() || '';
    // Strip markdown fences, extract the outermost JSON object
    let cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
    // Find first { and matching last }
    const start = cleaned.indexOf('{');
    const end   = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(cleaned);
    // Fix: if AI put top_actions inside dimensions, hoist it out
    if (!parsed.top_actions && parsed.dimensions?.top_actions) {
        parsed.top_actions = parsed.dimensions.top_actions;
        delete parsed.dimensions.top_actions;
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

        // Stats — robust multi-strategy extraction
        let followers = null, following = null, tweetCount = null;
        const firstNum = el => {
            if (!el) return null;
            for (const s of Array.from(el.querySelectorAll('span'))) {
                const t = s.innerText?.trim();
                if (t && /^[\d,.]+[KkMm]?$/.test(t) && t !== '0' || /^\d+$/.test(t)) return t;
            }
            return null;
        };
        document.querySelectorAll('a[href*="/followers"]').forEach(a => {
            if (followers) return;
            const n = firstNum(a);
            if (n) followers = n;
        });
        document.querySelectorAll('a[href*="/following"]').forEach(a => {
            if (following) return;
            const href = a.getAttribute('href') || '';
            if (href.includes('/followers')) return; // skip verified_followers link
            const n = firstNum(a);
            if (n) following = n;
        });

        // tweet count from header or profile stats area
        const headerText = getText('[data-testid="primaryColumn"] h2');
        if (headerText) {
            const m = headerText.match(/([\d,.]+[KkMm]?)\s+[Pp]ost/);
            if (m) tweetCount = m[1];
        }
        if (!tweetCount) {
            // fallback: look for "posts" text near a number in profile
            document.querySelectorAll('[data-testid="UserProfileHeader_Items"] span, [data-testid="primaryColumn"] span').forEach(s => {
                if (tweetCount) return;
                const t = s.innerText?.trim();
                if (t && /^[\d,.]+[KkMm]?$/.test(t)) {
                    const next = s.parentElement?.innerText?.toLowerCase();
                    if (next && next.includes('post')) tweetCount = t;
                }
            });
        }

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
