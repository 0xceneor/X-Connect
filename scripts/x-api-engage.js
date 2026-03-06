/**
 * x-api-engage.js — X engagement via official API (v2)
 *
 * Three modes:
 *   api      — Full API read + write (requires paid credits)
 *   hybrid   — Puppeteer reads feed + API writes replies/likes (free tier)
 *   automation — Alias for existing x-feed-engage.js (runs that instead)
 *
 * Usage:
 *   node x-api-engage.js --mode api --quota 50                      Full API mode
 *   node x-api-engage.js --mode hybrid --quota 100                  Puppeteer read + API write
 *   node x-api-engage.js --mode api --search "bitcoin" --quota 30   Search-based API mode
 *   node x-api-engage.js --credentials ./client-keys.json           Per-client API keys
 *   node x-api-engage.js --client-id acme                           Per-client data isolation
 *   node x-api-engage.js --dry-run --verbose                        Preview mode
 *
 * Credential file format (JSON):
 *   { "consumer_key": "...", "consumer_secret": "...", "access_token": "...", "access_token_secret": "..." }
 */

const { TwitterApi } = require('twitter-api-v2');
const core = require('./engage-core');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ── Parse CLI args ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, fallback) {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const MODE = getArg('mode', 'api');          // api | hybrid
const DAILY_QUOTA = parseInt(getArg('quota', '50'), 10) || 50;
const MAX_AGE_MIN = parseInt(getArg('max-age', '180'), 10) || 180;
const MIN_PAUSE = (parseInt(getArg('min-pause', '25'), 10) || 25) * 1000;
const MAX_PAUSE = (parseInt(getArg('max-pause', '55'), 10) || 55) * 1000;
const SEARCH_QUERY = getArg('search', null);
const CREDS_PATH = getArg('credentials', path.join(__dirname, 'credentials.json'));
const CLIENT_ID = getArg('client-id', 'default');
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const LIKE_ONLY = args.includes('--like-only');
const LIST_URL = getArg('list', null);

// ── Validate mode ───────────────────────────────────────────────────────

if (MODE === 'automation') {
    console.log('ℹ️  Automation mode — use x-feed-engage.js directly.');
    process.exit(0);
}

if (!['api', 'hybrid'].includes(MODE)) {
    console.error(`❌ Unknown mode: ${MODE}. Use: api | hybrid | automation`);
    process.exit(1);
}

// ── Per-client data isolation ───────────────────────────────────────────

const CLIENT_DATA_DIR = path.join(__dirname, '..', 'clients', CLIENT_ID);
core.init({
    dataDir: CLIENT_DATA_DIR,
    logFile: path.join(CLIENT_DATA_DIR, 'engage.log'),
    repliedFile: path.join(CLIENT_DATA_DIR, 'replied.json'),
});

// ── Load X API credentials ──────────────────────────────────────────────

if (!fs.existsSync(CREDS_PATH)) {
    console.error(`❌ Credentials file not found: ${CREDS_PATH}`);
    process.exit(1);
}
const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));

let xClient;
if (creds.client_id && creds.client_secret && creds.access_token && creds.access_token_secret) {
    // Attempt OAuth 1.0a mapping (often users confuse Client ID/Secret with Consumer Key/Secret)
    xClient = new TwitterApi({
        appKey: creds.consumer_key || creds.client_id,
        appSecret: creds.consumer_secret || creds.client_secret,
        accessToken: creds.access_token,
        accessSecret: creds.access_token_secret,
    }).readWrite;
} else if (creds.consumer_key && creds.consumer_secret && creds.access_token && creds.access_token_secret) {
    xClient = new TwitterApi({
        appKey: creds.consumer_key,
        appSecret: creds.consumer_secret,
        accessToken: creds.access_token,
        accessSecret: creds.access_token_secret,
    }).readWrite;
} else {
    console.error("❌ Missing required OAuth 1.0a Access Tokens for write operations.");
    process.exit(1);
}

// ── Puppeteer (hybrid mode only) ────────────────────────────────────────

let puppeteer, browser, page;
const USER_DATA_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw', 'x-profile-v2');
const COOKIES_PATH = path.join(__dirname, 'cookies.json');

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

// ── Tweet extraction (DOM, for hybrid mode) ─────────────────────────────

const MIN_TWEET_TEXT_LEN = 5;

async function extractTweetsFromPage(pg, maxAgeMin) {
    return await pg.evaluate((minLen, maxAge) => {
        const tweets = [];
        const articles = document.querySelectorAll('article[data-testid="tweet"], div[data-testid="tweet"]');

        for (const article of articles) {
            try {
                const textEl = article.querySelector('[data-testid="tweetText"]');
                const text = textEl ? textEl.innerText.trim() : '';
                if (text.length < minLen) continue;

                const handleEl = article.querySelector('a[role="link"][href*="/"]');
                let author = 'unknown';
                if (handleEl) {
                    const href = handleEl.getAttribute('href') || '';
                    const match = href.match(/^\/([^/]+)/);
                    if (match) author = match[1];
                }

                const timeEl = article.querySelector('time');
                let ageMin = 0;
                if (timeEl) {
                    const dt = new Date(timeEl.getAttribute('datetime'));
                    ageMin = Math.round((Date.now() - dt.getTime()) / 60000);
                }
                if (ageMin > maxAge) continue;

                // Tweet ID from link
                let id = null;
                const links = article.querySelectorAll('a[href*="/status/"]');
                for (const link of links) {
                    const m = (link.getAttribute('href') || '').match(/\/status\/(\d+)/);
                    if (m) { id = m[1]; break; }
                }
                if (!id) continue;

                // Images
                const imgEls = article.querySelectorAll('img[src*="pbs.twimg.com/media"]');
                const images = Array.from(imgEls).map(i => i.src).slice(0, 2);

                // Retweet check
                const isRetweet = !!article.querySelector('[data-testid="socialContext"]');

                tweets.push({ id, author, text, ageMin, images, isRetweet });
            } catch (_) { /* skip */ }
        }
        return tweets;
    }, MIN_TWEET_TEXT_LEN, maxAgeMin);
}

// ═══════════════════════════════════════════════════════════════════════════
// API READ — Fetch tweets via API (api mode)
// ═══════════════════════════════════════════════════════════════════════════

async function fetchTimelineTweets(maxResults = 20) {
    core.log('INFO', '📰 Fetching home timeline via API...');
    try {
        const timeline = await xClient.v2.homeTimeline({
            max_results: Math.min(maxResults, 100),
            'tweet.fields': ['created_at', 'public_metrics', 'author_id', 'text', 'attachments'],
            'user.fields': ['username', 'name'],
            expansions: ['author_id', 'attachments.media_keys'],
            'media.fields': ['url', 'preview_image_url', 'type'],
        });

        const users = {};
        if (timeline.includes?.users) {
            for (const u of timeline.includes.users) users[u.id] = u;
        }

        const media = {};
        if (timeline.includes?.media) {
            for (const m of timeline.includes.media) media[m.media_key] = m;
        }

        const tweets = [];
        for (const t of timeline.data?.data || []) {
            const user = users[t.author_id];
            const author = user ? user.username : 'unknown';
            const created = new Date(t.created_at);
            const ageMin = Math.round((Date.now() - created.getTime()) / 60000);
            if (ageMin > MAX_AGE_MIN) continue;

            // Extract images
            const images = [];
            if (t.attachments?.media_keys) {
                for (const mk of t.attachments.media_keys) {
                    const m = media[mk];
                    if (m && m.type === 'photo' && m.url) images.push(m.url);
                }
            }

            tweets.push({
                id: t.id, author, text: t.text, ageMin, images,
                metrics: t.public_metrics || {},
            });
        }

        core.log('INFO', `  📰 Got ${tweets.length} tweets from timeline`);
        return tweets;
    } catch (e) {
        core.log('ERROR', `❌ Timeline fetch failed: ${e.code || ''} ${e.data?.detail || e.message}`);
        return [];
    }
}

async function fetchSearchTweets(query, maxResults = 20) {
    core.log('INFO', `🔎 Searching: "${query}"...`);
    try {
        const results = await xClient.v2.search(query, {
            max_results: Math.min(maxResults, 100),
            'tweet.fields': ['created_at', 'public_metrics', 'author_id', 'text', 'attachments'],
            'user.fields': ['username', 'name'],
            expansions: ['author_id', 'attachments.media_keys'],
            'media.fields': ['url', 'preview_image_url', 'type'],
        });

        const users = {};
        if (results.includes?.users) {
            for (const u of results.includes.users) users[u.id] = u;
        }

        const tweets = [];
        for (const t of results.data?.data || []) {
            const user = users[t.author_id];
            const author = user ? user.username : 'unknown';
            const created = new Date(t.created_at);
            const ageMin = Math.round((Date.now() - created.getTime()) / 60000);

            tweets.push({
                id: t.id, author, text: t.text, ageMin, images: [],
                metrics: t.public_metrics || {},
            });
        }

        core.log('INFO', `  🔎 Got ${tweets.length} results for "${query}"`);
        return tweets;
    } catch (e) {
        core.log('ERROR', `❌ Search failed: ${e.code || ''} ${e.data?.detail || e.message}`);
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// API WRITE — Post replies and likes via API
// ═══════════════════════════════════════════════════════════════════════════

async function apiLike(tweetId) {
    try {
        const me = await xClient.v2.me();
        await xClient.v2.like(me.data.id, tweetId);
        core.log('INFO', `  ❤️  Liked (API): ${tweetId}`);
        return true;
    } catch (e) {
        core.log('WARN', `  ⚠️ Like failed (API): ${e.data?.detail || e.message}`);
        return false;
    }
}

async function apiReply(tweetId, text) {
    try {
        const { data } = await xClient.v2.reply(text, tweetId);
        core.log('INFO', `  💬 Replied (API): ${data.id} — "${text.substring(0, 60)}..."`);
        return data;
    } catch (e) {
        core.log('WARN', `  ⚠️ Reply failed (API): ${e.data?.detail || e.message}`);
        return null;
    }
}

// Cache authenticated user ID
let _myUserId = null;
async function getMyUserId() {
    if (_myUserId) return _myUserId;
    const me = await xClient.v2.me();
    _myUserId = me.data.id;
    return _myUserId;
}

// ═══════════════════════════════════════════════════════════════════════════
// HYBRID — Puppeteer read + API write
// ═══════════════════════════════════════════════════════════════════════════

async function initHybridBrowser() {
    puppeteer = require('puppeteer-core');
    const CHROME_PATH = findChrome();
    if (!CHROME_PATH) {
        core.log('ERROR', '❌ Chrome not found for hybrid mode');
        process.exit(1);
    }

    core.log('INFO', `🌐 Launching Chrome for hybrid mode...`);
    browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        userDataDir: USER_DATA_DIR,
        headless: false,
        defaultViewport: null,
        ignoreDefaultArgs: ['--enable-automation'],
        args: ['--start-maximized', '--disable-infobars', '--disable-gpu'],
    });

    page = (await browser.pages())[0];
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    // Load cookies
    if (fs.existsSync(COOKIES_PATH)) {
        try {
            const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
            await page.setCookie(...cookies);
        } catch (_) { /* ignore */ }
    }

    // Navigate to feed
    const feedUrl = LIST_URL || 'https://x.com/home';
    core.log('INFO', `  🌐 Navigating to ${feedUrl}`);
    await page.goto(feedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await core.wait(3000);

    // Check login
    const isLoggedIn = await page.evaluate(() =>
        !!document.querySelector('[data-testid="primaryColumn"]') || !!document.querySelector('[data-testid="AppTabBar_Home_Link"]')
    );
    if (!isLoggedIn) {
        core.log('ERROR', '❌ Not logged in — check cookies');
        await browser.close();
        process.exit(1);
    }
    core.log('INFO', '✅ Logged in (hybrid browser)');
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENGAGEMENT LOOP
// ═══════════════════════════════════════════════════════════════════════════

(async () => {
    // Verify API credentials
    core.log('INFO', `\n${'═'.repeat(60)}`);
    core.log('INFO', `🚀 X API Engage — Mode: ${MODE.toUpperCase()} | Quota: ${DAILY_QUOTA} | Client: ${CLIENT_ID}`);
    core.log('INFO', `${'═'.repeat(60)}\n`);

    try {
        const me = await xClient.v2.me({ 'user.fields': ['username', 'public_metrics'] });
        core.log('INFO', `✅ Authenticated as @${me.data.username} (${me.data.public_metrics?.followers_count} followers)`);
    } catch (e) {
        core.log('ERROR', `❌ API auth failed: ${e.message}`);
        process.exit(1);
    }

    // Load progress
    const progress = core.loadProgress(true);
    const repliedData = core.loadReplied();
    const seenIds = new Set(progress.seenTweetIds || []);
    const repliedIds = new Set(repliedData.entries.map(e => e.tweetId));

    if (DRY_RUN) core.log('INFO', '🔍 DRY RUN — no actions will be taken\n');

    // Init hybrid browser if needed
    if (MODE === 'hybrid') await initHybridBrowser();

    // ── Main loop ────────────────────────────────────────────────────────

    let rounds = 0;
    const MAX_ROUNDS = 50;

    while (rounds < MAX_ROUNDS && progress.liked < DAILY_QUOTA) {
        rounds++;
        core.log('INFO', `\n── Round ${rounds} (${progress.liked}/${DAILY_QUOTA} engaged) ──`);

        // 1. FETCH TWEETS
        let tweets = [];
        if (MODE === 'api') {
            tweets = SEARCH_QUERY
                ? await fetchSearchTweets(SEARCH_QUERY, 20)
                : await fetchTimelineTweets(20);
        } else if (MODE === 'hybrid') {
            // Scroll + extract from DOM
            await page.evaluate(() => window.scrollBy(0, 600));
            await core.wait(2000);
            tweets = await extractTweetsFromPage(page, MAX_AGE_MIN);

            // Filter retweets (unless list mode)
            if (!LIST_URL) tweets = tweets.filter(t => !t.isRetweet);
        }

        // Filter already seen/replied
        const freshTweets = tweets.filter(t => !seenIds.has(t.id) && !repliedIds.has(t.id));
        core.log('INFO', `  📋 ${tweets.length} total → ${freshTweets.length} fresh`);

        if (freshTweets.length === 0) {
            if (MODE === 'hybrid') {
                // Scroll more
                core.log('DEBUG', '  📜 No fresh tweets, scrolling...');
                await page.evaluate(() => window.scrollBy(0, 1200));
                await core.wait(3000);

                // Try feed refresh every 5 empty rounds
                if (rounds % 5 === 0) {
                    core.log('INFO', '  🔄 Refreshing feed...');
                    await page.keyboard.press('.');
                    await core.wait(5000);
                }
                continue;
            } else {
                core.log('INFO', '  ⏳ No fresh tweets. Waiting before retry...');
                await core.wait(30000);
                continue;
            }
        }

        // 2. PROCESS EACH TWEET
        for (const tweet of freshTweets) {
            if (progress.liked >= DAILY_QUOTA) break;

            seenIds.add(tweet.id);
            progress.seenTweetIds.push(tweet.id);

            const snippet = (tweet.text || '').substring(0, 60).replace(/\n/g, ' ');
            core.log('INFO', `\n  🐦 @${tweet.author}: "${snippet}..." (${tweet.ageMin}m)`);

            // Vision (describe images if present)
            let imageDesc = null;
            if (tweet.images && tweet.images.length > 0) {
                imageDesc = await core.describeImages(tweet.images);
                if (VERBOSE && imageDesc) core.log('DEBUG', `  🖼️  Vision: ${imageDesc.substring(0, 80)}`);
            }

            // Classify
            core.log('INFO', `  🔍 Classifying...${imageDesc ? ' [+vision]' : ''}`);
            const classification = await core.classifyTweet(tweet.text, tweet.author, imageDesc);
            const { signal, topic, tone, intent, replyStyle } = classification;

            core.log('INFO', `  📊 ${signal} | ${topic} | ${tone} | ${intent} | ${replyStyle}`);

            if (signal === 'SKIP') {
                core.log('INFO', `  ⏭️  Skipped (bait/noise)`);
                progress.skipped++;
                core.saveProgress(progress);
                continue;
            }

            // Engagement rate roll
            const engageRate = core.getEngageRate(topic, intent);
            if (signal !== 'SHILL' && Math.random() > engageRate) {
                core.log('INFO', `  ⏭️  Skipped (tier roll: ${(engageRate * 100).toFixed(0)}%)`);
                progress.skipped++;
                core.saveProgress(progress);
                continue;
            }

            // 3. LIKE
            if (!DRY_RUN) {
                const liked = await apiLike(tweet.id);
                if (liked) {
                    progress.liked++;
                    core.saveProgress(progress);
                }
            } else {
                core.log('INFO', `  ❤️  [DRY RUN] Would like ${tweet.id}`);
                progress.liked++;
            }

            // 4. REPLY (unless like-only)
            if (!LIKE_ONLY && (tweet.text || '').length > 15) {
                // Enrich context
                let duneContext = null;
                if (core.DUNE_TOPICS.has(topic) && core.DUNE_KEYWORDS.test(tweet.text)) {
                    duneContext = await core.fetchDuneContext(tweet.text, classification);
                }
                const newsContext = await core.fetchNewsContext(tweet.text, classification);

                // Generate reply
                core.log('INFO', `  ✍️  Generating reply...`);
                let reply = await core.generateReply(tweet.text, tweet.author, classification, imageDesc, duneContext, signal, newsContext);

                if (reply) {
                    core.log('INFO', `  📝 Proofreading...`);
                    reply = await core.proofreadReply(reply, tweet.text, tweet.author);
                }

                if (reply && reply.length > 3 && reply.length <= 280) {
                    core.log('INFO', `  💬 Reply: "${reply}"`);

                    if (!DRY_RUN) {
                        const posted = await apiReply(tweet.id, reply);
                        if (posted) {
                            progress.commented++;
                            repliedIds.add(tweet.id);
                            core.saveReply(repliedData, {
                                tweetId: tweet.id,
                                author: tweet.author,
                                reply,
                                replyId: posted.id,
                                timestamp: new Date().toISOString(),
                                mode: MODE,
                                clientId: CLIENT_ID,
                            });
                        }
                    } else {
                        core.log('INFO', `  💬 [DRY RUN] Would reply: "${reply}"`);
                        progress.commented++;
                    }
                } else {
                    core.log('INFO', `  ⏭️  No suitable reply generated`);
                }
            }

            core.saveProgress(progress);

            // Pacing
            const pause = Math.floor(Math.random() * (MAX_PAUSE - MIN_PAUSE)) + MIN_PAUSE;
            core.log('INFO', `  ⏱️  Waiting ${(pause / 1000).toFixed(0)}s...`);
            await core.wait(pause);
        }

        // If API mode and out of tweets, wait before next batch
        if (MODE === 'api' && freshTweets.length === 0) {
            core.log('INFO', '  ⏳ Waiting 60s before next API fetch...');
            await core.wait(60000);
        }
    }

    // ── Done ─────────────────────────────────────────────────────────────

    core.log('INFO', `\n${'═'.repeat(60)}`);
    core.log('INFO', `✅ Session complete!`);
    core.log('INFO', `   Mode: ${MODE.toUpperCase()} | Client: ${CLIENT_ID}`);
    core.log('INFO', `   Liked: ${progress.liked} | Replied: ${progress.commented} | Skipped: ${progress.skipped} | Errors: ${progress.errors}`);
    core.logTokenUsage();
    core.log('INFO', `${'═'.repeat(60)}\n`);

    if (browser) await browser.close();
    process.exit(0);

})();
