# User Behavior — Batch Commands

How the user communicates to start, stop, and manage runs.
Read this before asking for clarification on batch intent.

---

## Starting a Batch

| What user says | What it means |
|---|---|
| "run", "run batch", "start", "go" | Start a normal batch. Use default flags: `node x-feed-engage.js --no-headless --quota 100 --reply-back --rb-limit 10` |
| "run non-headless", "show browser", "visible" | Start in visible browser mode (use Xvfb on VPS). Same default flags. |
| "dry run", "test run", "preview" | Start with `--dry-run`. Scrolls and finds tweets but does NOT like or reply. |
| "like only", "likes only" | Start with `--like-only`. Likes tweets, skips replies. |
| "100 quota", "quota 100", "run N" | Start with `--quota N`. Override default quota. |
| "slow run", "stealth", "be careful" | Start with `--min-pause 120 --max-pause 300`. Slower/safer pace. |
| "list run", "engage list" | Prompt user: which list URL? Then start with `--list <URL>`. |
| "test cookies", "check login" | Run a test login only — launch browser, load cookies, check if logged in, screenshot, then exit. Do NOT start the full engagement loop. |
| "test batch", "quick test", "run 5" | Run with `--quota 5`. Quick 5-tweet test to confirm everything works. |

---

## Stopping a Batch

| What user says | What it means |
|---|---|
| "stop", "kill", "stop it", "cancel" | Kill the node process running `x-feed-engage.js`. Browser closes too. |
| "stop all", "kill everything", "full stop" | Kill node + Chrome + clear profile lock files. Full teardown. |
| "stop keep browser", "keep browser open" | Kill only the node process. Leave the Chrome window open so user can inspect the page state manually. |
| "pause" | Not a real pause — the script has no pause flag. Instead: stop the batch, save progress is automatic. User can resume with "resume" later (progress file persists). |

---

## Checking Status

| What user says | What it means |
|---|---|
| "status", "what's happening" | Run `tail -50 debug/x-feed-engage.log` and show the last 30 lines. |
| "progress", "how many", "count" | Read today's progress JSON and show: liked, commented, skipped, errors. |
| "check logs", "show logs" | Run `tail -f debug/x-feed-engage.log` |
| "is it running", "still going" | Run `pgrep -a node` (Linux) or `tasklist | findstr node` (Windows) — print PID if running, nothing if stopped. |

---

## Cookie / Login Management

| What user says | What it means |
|---|---|
| "here are my cookies" + pastes JSON | Replace `scripts/cookies.json` with the pasted content. Do NOT run a batch automatically — wait for "run". |
| "check cookies", "are cookies fresh" | Acknowledge. Run pre-flight cookie check, report expiry dates, then wait for "run". |
| "verify cookies", "test login" | Run `node test-cookies.js` and report `auth_token` / `ct0` / `twid` status and expiry. |

---

## Resume / Reset

| What user says | What it means |
|---|---|
| "resume", "continue", "keep going" | Start a new batch — progress auto-loads from today's file (`--resume` is on by default). Same default flags. |
| "reset", "fresh start", "start over" | Delete today's progress file (`debug/feed-progress-YYYY-MM-DD.json`), then wait for "run". Do NOT auto-start. |
| "full reset" | Follow section 16 of `debug.md` exactly. Confirm with user before deleting Chrome profile. |

---

## Default Flags Reference

When no flags are specified, always use:

```bash
node x-feed-engage.js --no-headless --quota 100 --reply-back --rb-limit 10
```

On VPS with Xvfb:

```bash
DISPLAY=:99 node x-feed-engage.js --no-headless --quota 100 --reply-back --rb-limit 10
```

---

## Rules for Agents

1. Never start a batch automatically without the user saying one of the start phrases above.
2. Never change flags unless the user says so — default flags are in the table above.
3. After "stop keep browser", do NOT kill Chrome. Only kill the node process.
4. After any batch ends (quota hit or error), report: liked count, commented count, errors. Do not start another run.
5. If the script exits with an error, check `debug.md` Quick Reference before doing anything. Do not improvise fixes.
