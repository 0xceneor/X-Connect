const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

const COOKIES_PATH = path.join(__dirname, 'cookies.json');

(async () => {
    const chromePath = findChrome();
    if (!chromePath) {
        console.error('❌ Chrome not found');
        process.exit(1);
    }

    let browser;
    try {
        browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
        const page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

        if (!fs.existsSync(COOKIES_PATH)) {
            console.error(`❌ cookies.json not found at ${COOKIES_PATH}`);
            process.exit(1);
        }
        const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));

        const allCookies = [];
        for (const c of cookies) {
            if (!c.name || !c.value) continue;
            allCookies.push({
                name: c.name, value: c.value, domain: '.x.com',
                path: c.path || '/', secure: c.secure !== false, httpOnly: c.httpOnly !== false
            });
            allCookies.push({
                name: c.name, value: c.value, domain: '.twitter.com',
                path: c.path || '/', secure: c.secure !== false, httpOnly: c.httpOnly !== false
            });
        }

        await page.setCookie(...allCookies);
        await page.goto('https://x.com/home', { waitUntil: 'networkidle2' });

        await new Promise(r => setTimeout(r, 4000));

        const url = await page.evaluate(() => window.location.href);
        const loggedIn = await page.evaluate(() => {
            return !!document.querySelector('[data-testid="SideNav_NewTweet_Button"]') ||
                !!document.querySelector('[data-testid="AppTabBar_Profile_Link"]') ||
                !!document.querySelector('[data-testid="SideNav_NewTweet_Floating_Button"]');
        });

        console.log("Current URL:", url);
        console.log("Logged In elements found:", loggedIn);

    } catch (e) {
        console.error("Fatal:", e);
    } finally {
        if (browser) await browser.close();
    }
})();
