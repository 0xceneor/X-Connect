# x-connect Update Log — 2026-03-16/17

## Files Modified

| File | Type |
|------|------|
| `scripts/x-feed-engage.js` | Main engagement script — all fixes and enhancements |
| `scripts/cookies.json` | Session cookies — replaced with fresh auth_token |

---

## Issue 1: Login Failing Consistently

**Symptom:** Script logged "Not logged in after 3 attempts!" on every run. Debug screenshots showed X.com's loading spinner — React never finished hydrating.

**Root cause:** All navigation calls used `waitUntil: 'networkidle2'`. X.com's SPA never reaches ≤2 active network connections, so Puppeteer timed out at 60s every time — before React could render the logged-in UI.

**Fix:** Replaced all 6 occurrences of `networkidle2` with `domcontentloaded` so navigation completes as soon as the HTML is parsed, then waits for React separately.

---

## Issue 2: Login Check Firing Before React Renders

**Symptom:** Even after switching to `domcontentloaded`, the fixed 15–20s waits weren't reliably long enough. X.com's React bundle sometimes took longer, especially after repeated automation attempts.

**Root cause:** Fixed `await wait(15000)` / `await wait(20000)` calls don't adapt to actual page state.

**Fix:** Replaced fixed waits with a `waitForLogin()` polling function that checks every 2s for up to 45s for any of:
- `[data-testid="SideNav_NewTweet_Button"]`
- `[data-testid="AppTabBar_Profile_Link"]`
- `[data-testid="SideNav_NewTweet_Floating_Button"]`
- `[data-testid="primaryColumn"]`

Returns `true` the moment any selector is found, or `false` after 45s timeout.

---

## Issue 3: `headless: 'new'` Deprecated in Puppeteer-Core v23

**Symptom:** Warning on launch, potential behaviour differences.

**Fix:** Changed `headless: 'new'` → `headless: true` (correct value for v23+).

---

## Issue 4: Feed Showing 0 Tweets After Login (Anti-Bot Detection)

**Symptom:** Login succeeded but `article[data-testid="tweet"]` elements never appeared in the DOM. The page loaded visually but the feed content was withheld. Debug DOM check confirmed `articles: 0` even after 90+ scroll cycles.

**Root cause:** X.com's server-side bot detection identified the Puppeteer session and served an empty feed shell. Detection signals included: `navigator.webdriver = true`, missing `window.chrome` object, 0 browser plugins, canvas/WebGL fingerprints matching headless Chrome, and automation artifacts in `window.*`.

**Fix — Comprehensive stealth layer added to `evaluateOnNewDocument`:**
1. `navigator.webdriver = undefined` (was present, kept)
2. `window.chrome = { runtime, loadTimes, csi, app }` — real Chrome always has this
3. `navigator.plugins` — fake 3-entry PluginArray (headless has 0; real Chrome has 3)
4. `navigator.languages = ['en-US', 'en']`
5. `navigator.platform = 'Win32'`
6. `navigator.hardwareConcurrency = 8`
7. `navigator.deviceMemory = 8`
8. `Notification.permission = 'default'`
9. `navigator.permissions.query` override — returns realistic states instead of automation markers
10. WebGL `getParameter` override — spoofs vendor/renderer to `Intel Inc. / Intel Iris Plus Graphics 640`
11. Canvas fingerprint noise — XOR 1 bit per call so fingerprint hash differs each session
12. 14 selenium/webdriver global window artifacts deleted
13. `outerWidth / outerHeight` patched to match real viewport
14. `navigator.maxTouchPoints = 0` (desktop Chrome)
15. `navigator.connection.rtt / downlink` set to realistic values

**Fix — Chrome launch args cleaned up:**
- Removed `--enable-automation` via `ignoreDefaultArgs`
- Added `--no-first-run`, `--no-default-browser-check`, `--disable-popup-blocking`, `--disable-translate`
- Added `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`
- Added `--lang=en-US,en`
- **Removed** `--disable-blink-features=AutomationControlled` — this flag itself shows a Chrome warning banner ("unsupported command line flag") that X.com can detect. The `evaluateOnNewDocument` patch handles this instead.
- **Removed** `--use-mock-keychain` (macOS-only, showed warning on Windows), `--password-store=basic`, `--metrics-recording-only`, `--disable-ipc-flooding-protection` (deprecated/unsupported flags)

**Fix — Random session fingerprint per run:**
- UA rotated from pool of 6 realistic Chrome versions (129–132)
- Viewport randomized from 5 common resolutions (1280×800 to 1920×1080)

---

## Issue 5: Chrome Showing "Unsupported command-line flag" Banner

**Symptom:** Chrome displayed a yellow warning bar: *"You are using an unsupported command-line flag: --disable-blink-features=AutomationControlled. Stability and security will suffer."*

**Root cause:** `--disable-blink-features=AutomationControlled` is an internal Chromium flag not intended for end users. Newer Chrome versions show a warning banner for it.

**Fix:** Removed the flag entirely. `navigator.webdriver` is already patched via `evaluateOnNewDocument` so the flag is redundant.

---

## Enhancement: Session Warmup

**Problem:** Navigating directly to `x.com/home` immediately after cookie injection looks robotic — real users don't deep-link straight to the feed from a cold start.

**Fix:** After login, the script now browses `x.com/aptum_` (own profile) for 3–6 seconds with scrolling and mouse movement before navigating to the feed. This mimics a natural "check my profile → go to feed" flow.

**Result:** DOM check after warmup confirmed `articles: 4` on first feed load — tweets populated immediately vs 0 articles without warmup.

---

## Enhancement: Human-Paced Mouse Movement

Added `humanMouseMove(page)` helper — moves the mouse to 2–4 random positions with realistic step counts and inter-move delays. Called at:
- After every login / warmup page
- Before pressing the `.` key to load new tweets
- Before each tweet navigation
- After landing on a tweet page
- Before opening the reply box
- After each engagement action before returning to feed
- Every 15 scroll cycles
- During empty-feed refresh cycles

---

## Enhancement: Human-Paced Actions

All engagement actions now use randomized timing:

| Action | Before fix | After fix |
|--------|-----------|-----------|
| Before like (reading time) | 300ms fixed | 800–2800ms random |
| Like keypress hold | fixed | 200–700ms random |
| After like confirm | 1200ms fixed | 800–1400ms random |
| Before reply box open | 800ms fixed | 500–2000ms random |
| Reply box settle | 800ms fixed | 600–1000ms random |
| After engagement, before feed nav | none | 600–1800ms random |
| After returning to feed | 2000ms fixed | 1500–4000ms random |
| Scroll px per cycle | 600–1400px | 400–1300px |
| Scroll step timing | 30–110ms | 40–160ms ±10px wobble |
| Mid-scroll read pause | never | 25% chance, 1–3s |
| Notifications scroll | 800px fixed / 2000ms | 500–900px / 1500–3000ms |

---

## Enhancement: Feed DOM Debug Check

Added a post-warmup DOM snapshot logged at every session start:
```
Feed DOM check: {"articles":4,"primaryCol":true,"newTweetsBar":"yes","title":"(4) Home / X","url":"https://x.com/home"}
```
Also saves a screenshot to `debug/feed-after-warmup-{timestamp}.png` for visual inspection when needed.

---

## Cookies Updated

Replaced `scripts/cookies.json` with a fresh set of 15 cookies including a new `auth_token` for account `u=1977051196126117893`. Expiry: ~2026-09-12.
