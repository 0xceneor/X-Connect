/**
 * evaluate-server.js — VPS poller for X account evaluations.
 *
 * Polls aptum.fun/evaluate-queue.php every POLL_INTERVAL seconds for pending jobs.
 * When a job appears, runs x-evaluate.js and pushes the result to evaluate.php.
 *
 * No inbound ports required — only outbound HTTP to aptum.fun.
 *
 * Usage: node scripts/evaluate-server.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');

const POLL_INTERVAL = 20_000; // 20 seconds
const QUEUE_BASE    = 'https://aptum.fun/evaluate-queue.php';
const CLAIM_URL     = QUEUE_BASE;
const SECRET        = process.env.FEED_PUSH_SECRET || '';
const EVAL_SCRIPT   = path.join(__dirname, 'x-evaluate.js');

if (!SECRET) { console.error('❌ FEED_PUSH_SECRET not set'); process.exit(1); }

const active = new Set(); // usernames currently being evaluated

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
        ...opts,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SECRET}`,
            ...(opts.headers || {}),
        },
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function claimJob(job_id) {
    return apiFetch(CLAIM_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'claim', job_id }),
    });
}

// ── Run x-evaluate.js for a job ───────────────────────────────────────────────
function runEvaluation(username) {
    return new Promise((res) => {
        console.log(`[eval] Starting @${username}...`);
        const child = spawn('node', [EVAL_SCRIPT, `@${username}`, '--push'], {
            cwd:   path.join(__dirname, '..'),
            env:   { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let tail = '';
        const onData = d => {
            const s = d.toString();
            process.stdout.write(s);
            tail = (tail + s).split('\n').slice(-5).join('\n');
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);

        child.on('close', code => {
            console.log(`[eval] @${username} → exit ${code}`);
            res(code === 0);
        });
    });
}

// ── Poll loop ─────────────────────────────────────────────────────────────────
async function poll() {
    try {
        const { jobs } = await apiFetch(`${QUEUE_BASE}?action=pending&s=${encodeURIComponent(SECRET)}`);
        for (const job of (jobs || [])) {
            if (active.has(job.username)) continue;

            const claimed = await claimJob(job.id);
            if (!claimed.ok) continue;

            active.add(job.username);
            runEvaluation(job.username).finally(() => active.delete(job.username));
        }
    } catch (e) {
        console.warn(`[poll] ${e.message}`);
    }
}

console.log(`\n${'═'.repeat(45)}`);
console.log(`  🔍 X-Evaluate VPS Poller`);
console.log(`  📡 Polling: ${QUEUE_BASE}`);
console.log(`  🔄 Interval: ${POLL_INTERVAL / 1000}s`);
console.log(`${'═'.repeat(45)}\n`);

poll(); // immediate first poll
setInterval(poll, POLL_INTERVAL);
