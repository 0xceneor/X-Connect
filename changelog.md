# X-Connect Changelog

Most recent changes at the top.

---

## 2026-03-19 — Toast Verification + Login Selector + Lock Fix + Pacing

### `scripts/x-feed-engage.js`

| Change | Detail |
|--------|--------|
| **Reply verification v2** | Old check (`!textarea exists`) fails on tweet detail pages where the composer is a permanent layout element — it never closes after submitting. New check adds: toast detection (`[data-testid="toast"]` containing "sent") and empty-textarea detection. Replies now correctly register as confirmed even on inline composers. Both main feed and reply-back sections updated. |
| **Login selector** | Added `[data-testid="SideNav_AccountSwitcher_Button"]` as the first (highest priority) selector in `waitForLogin`. More reliable than the previous selectors on current X.com layout. |
| **Chrome lock auto-cleanup** | Lock files (`DevToolsActivePort`, `SingletonLock`, `SingletonSocket`, `SingletonCookie`) are now deleted automatically before every launch. Eliminates "browser already running" crashes after abrupt kills. |
| **Default pause** | Changed from 420–720s (7–12 min) to **25–60s**. The old default was designed for stealth but made normal batches 10–20 hours long. Stealth pace is now an explicit flag: `--min-pause 120 --max-pause 300` or higher. |

### New files

| File | Purpose |
|------|---------|
| `context.md` | Pitch context — x-connect as social layer of Base agent, public API products, Base integration scope, evaluator conversation log |

### `documentation.md` updates

- Directory structure fully rebuilt — all 21 root files, `config/`, `.env.example`, `cookies.example.json`, `credentials.example.json` now listed
- `stats.php` (doesn't exist) replaced with `dashboard.html` / `dashboard.php` section
- Default pause values corrected throughout (420/720 → 25/60)

### `operations.md` updates

- Default pause updated from 420–720s → 25–60s in pacing table and examples
- Pacing table row renamed from "Stealth (default)" → "Default"

---

## 2026-03-18 — Reply Verification + Documentation Overhaul

### `scripts/x-feed-engage.js` — Reply verification fix

**Problem:** Script logged `💬 Replied: "..."` and counted the reply regardless of whether it actually posted. The `replied.json` file showed 99 entries but replies were not visible on X.com. Detached frame errors during submission still incremented the counter.

**Root cause:** After `Ctrl+Enter`, the script only checked if the textarea was *still open* (to trigger a fallback click). It never checked the inverse — that the textarea *closed* — as the success signal. `progress.commented++` and `saveReply()` ran unconditionally.

**Fix (main feed reply — lines ~1577):**
- `await wait(1500)` → `await wait(2000)` after Ctrl+Enter
- Added `submitted` boolean: `!document.querySelector('[data-testid="tweetTextarea_0"]')` — textarea closing = success
- Fallback button click now also re-checks `submitted` after 2.5s
- `progress.commented++` and `saveReply()` moved inside `if (submitted)` block — only fires on confirmed post
- On success: logs `✅ Reply confirmed: "..."  → https://x.com/.../status/...` (with reply URL when available)
- On failure: logs `❌ Reply FAILED to post on tweet <id>`, saves screenshot to `debug/reply-fail-<ts>.png`, presses Escape to close the stuck textarea
- `replyUrl` field added to `saveReply()` payload

**Fix (reply-back section — lines ~1027):**
- Same `submitted` verification pattern applied
- `replied++` and `saveReply()` only on confirmed
- On failure: logs `❌ Reply-back FAILED`, saves screenshot to `debug/replyback-fail-<ts>.png`

---

### New files added

| File | Purpose |
|------|---------|
| `debug.md` | 16-section VPS debug guide — every error, exact fix, quick reference table. Includes AGENT RULES to prevent AI agents from improvising. |
| `user-behavior.md` | Lookup table for how the user communicates: start/stop/status/cookie/reset phrases and what each means. Prevents agents asking "what flags?" every run. |
| `changelog.md` | This file. |

---

### `operations.md` updates

| Section | Change |
|---------|--------|
| Observed User Behaviour | Replaced verbose duplicate docs with pointer to `user-behavior.md` + condensed defaults table |
| Step 7 — VPS Run | Changed "always run headless" → "always use `--no-headless` with Xvfb". Added `run.sh` creation block. Pure headless is consistently detected on datacenter IPs. |
| VPS Troubleshooting table | Replaced inline 7-row fix table with section number pointers to `debug.md` |

### `SKILL.md` updates

- Added `user-behavior.md` and `debug.md` as doc references at the top
- Added Linux/VPS stop command (`pkill -f x-feed-engage.js; pkill chrome; pkill Xvfb`) alongside existing Windows `taskkill`

---

## 2026-03-16/17 — Anti-Detection + VPS Compatibility

*Full details in `updatedlog.md`. Summary:*

### `scripts/x-feed-engage.js`

| Change | Detail |
|--------|--------|
| `networkidle2` → `domcontentloaded` | X.com's SPA never reaches ≤2 active connections. Fixed login timeout. |
| `waitForLogin` polling loop | Replaced `waitForSelector` with 3-attempt polling for `[data-testid="SideNav_AccountSwitcher_Button"]` |
| `headless: 'new'` | Replaced deprecated boolean `headless: true` |
| User agent pool (6 Chrome versions) | Random UA per session |
| Viewport pool (5 resolutions) | Random viewport per session |
| `humanMouseMove()` helper | Random mouse movement between actions |
| Comprehensive stealth patches (14) | `navigator.webdriver`, `window.chrome`, plugins, languages, platform, hardwareConcurrency, deviceMemory, Notification, permissions, WebGL, canvas noise, window artifacts, outerWidth/Height, maxTouchPoints |
| Removed `--disable-blink-features=AutomationControlled` | Caused Chrome warning banner visible to X.com. JS patches make it redundant. |
| Linux-only args block | `--no-sandbox`, `--disable-setuid-sandbox`, `--password-store=basic`, `--single-process` conditionally added via `process.platform === 'linux'` |
| Session warmup | Navigates to profile page before feed — proved to be key trigger for tweets loading (articles: 0 → articles: 4) |
| Feed DOM check log | `{"articles": N, "primaryCol": true/false, ...}` logged after warmup for instant diagnosis |
| Human-paced actions | Random delays before like, reply box, engagement, scroll; 25% chance mid-scroll pause |

### `scripts/cookies.json`
- Replaced with 15 fresh cookies including new `auth_token`, expiry ~2026-09-12

### `operations.md`
- Added VPS Automation Mode section (Steps 1–10)
- Added Infinity Loading Fix section with 13 techniques (Xvfb, stealth plugin, residential proxy, profile warmup, Chrome profile export, CDP timezone/geo, client hints headers, WebRTC disable, Battery/Gamepad/AudioContext spoofing, profile rotation, font installation, Chrome launch flags, session cool-down)

---

## File Index

| File | What it's for |
|------|---------------|
| `scripts/x-feed-engage.js` | Main automation script |
| `scripts/cookies.json` | X.com session cookies |
| `SKILL.md` | Agent entry point — modes, quick start, scripts list |
| `operations.md` | Full operating guide — pre-flight, VPS setup, run commands |
| `user-behavior.md` | How user communicates start/stop/status — agent command reference |
| `debug.md` | VPS error guide — 16 sections, quick reference table |
| `documentation.md` | Full technical reference |
| `context.md` | Pitch context — API products, Base integration scope |
| `updatedlog.md` | Detailed log of 2026-03-16/17 session changes |
| `changelog.md` | This file — summary of all changes by date |
