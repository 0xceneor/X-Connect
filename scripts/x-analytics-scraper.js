const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const DEBUG_DIR = path.join(__dirname, '..', 'debug');
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

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function parseAnalytics(mainText) {
    const lines = mainText.split('\n').map(l => l.trim()).filter(Boolean);
    const metricsToCapture = [
        'Impressions', 'Engagement rate', 'Engagements', 'Profile visits',
        'Replies', 'Likes', 'Reposts', 'Bookmarks', 'Shares', 'Video views',
        'New followers'
    ];

    let stats = {};

    // Iterate backwards to prioritize summary cards at the bottom, avoiding graph legends
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (metricsToCapture.includes(line)) {
            const key = line.toLowerCase().replace(/ /g, '_');
            // Check if we hit the metric name
            if (!stats[key]) {
                const val = lines[i + 1];
                if (val && !['Select secondary metric', 'Daily', 'Bar'].includes(val)) {
                    stats[key] = val;
                }
            }
        }
    }

    return stats;
}

function pushStats(stats) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(stats);
        const url = new URL('https://aptum.fun/api/stats');
        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

(async () => {
    const CHROME_PATH = findChrome();
    if (!CHROME_PATH) {
        console.error('❌ Chrome not found');
        process.exit(1);
    }

    console.log(`\n🔄 X Analytics Scraper`);
    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: "new",
        defaultViewport: null,
        args: ['--start-maximized', '--disable-infobars', '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    });

    try {
        const page = (await browser.pages())[0];
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        if (fs.existsSync(COOKIES_PATH)) {
            try {
                const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
                const clean = (Array.isArray(cookies) ? cookies : []).map(c => ({
                    name: c.name, value: c.value, domain: c.domain || '.x.com',
                    path: c.path || '/', secure: c.secure !== false, httpOnly: c.httpOnly !== false
                })).filter(c => c.name && c.value);
                if (clean.length > 0) await page.setCookie(...clean);
            } catch (_) { /* ignore */ }
        }

        console.log('Navigating to analytics page...');
        await page.goto('https://x.com/i/account_analytics', { waitUntil: 'networkidle2', timeout: 60000 });
        await wait(6000); // give it time to load the React app

        const mainText = await page.evaluate(() => {
            const main = document.querySelector('main');
            return main ? main.innerText : null;
        });

        if (!mainText) {
            throw new Error('Could not find main element. Maybe logged out or page structure changed?');
        }

        console.log('Parsing analytics data...');
        const stats = parseAnalytics(mainText);
        stats.timestamp = new Date().toISOString();

        console.log('Extracted stats:');
        console.log(JSON.stringify(stats, null, 2));

        console.log('Pushing data to https://aptum.fun/api/stats.js ...');
        const response = await pushStats(stats);

        console.log(`Push response: HTTP ${response.status} =>`, response.data);

    } catch (e) {
        console.error('❌ Error during scraping:', e);
    } finally {
        await browser.close();
    }
})();
