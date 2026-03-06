/**
 * instance-manager.js — Manages multiple x-connect child processes.
 *
 * Each customer session runs as an isolated child process.
 * This module handles spawning, tracking, killing, and log streaming.
 *
 * Usage:
 *   const im = require('./instance-manager');
 *   im.start('customer1', { mode: 'hybrid', quota: 100 });
 *   im.stop('customer1');
 *   im.getStatus('customer1');
 *   im.listAll();
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPTS_DIR = __dirname;
const CLIENTS_DIR = path.join(__dirname, '..', 'clients');
const MAX_INSTANCES = parseInt(process.env.MAX_INSTANCES || '10', 10);

// Active instances: Map<clientId, { proc, mode, quota, startedAt, pid, lastOutput }>
const instances = new Map();

/**
 * Start an engagement session for a client.
 * @param {string} clientId
 * @param {object} opts - { mode, quota, minPause, maxPause, search, likeOnly, listUrl, dryRun, verbose }
 * @returns {{ ok: boolean, message: string, pid?: number }}
 */
function start(clientId, opts = {}) {
    if (instances.has(clientId)) {
        const inst = instances.get(clientId);
        if (inst.proc && !inst.proc.killed) {
            return { ok: false, message: `Session already running (PID: ${inst.pid})` };
        }
        // Dead process — clean up
        instances.delete(clientId);
    }

    if (instances.size >= MAX_INSTANCES) {
        return { ok: false, message: `Max instances reached (${MAX_INSTANCES}). Stop one first.` };
    }

    const clientDir = path.join(CLIENTS_DIR, clientId);
    if (!fs.existsSync(clientDir)) {
        return { ok: false, message: `Client not found: ${clientId}` };
    }

    const mode = opts.mode || 'api';
    const quota = opts.quota || 50;
    const minPause = opts.minPause || 25;
    const maxPause = opts.maxPause || 55;

    // Build CLI args
    let script, args;

    if (mode === 'automation') {
        script = path.join(SCRIPTS_DIR, 'x-feed-engage.js');
        args = [
            script,
            '--quota', String(quota),
            '--min-pause', String(minPause),
            '--max-pause', String(maxPause),
        ];
    } else {
        script = path.join(SCRIPTS_DIR, 'x-api-engage.js');
        args = [
            script,
            '--mode', mode,
            '--client-id', clientId,
            '--quota', String(quota),
            '--min-pause', String(minPause),
            '--max-pause', String(maxPause),
        ];

        // Per-client credentials
        const clientCreds = path.join(clientDir, 'credentials.json');
        if (fs.existsSync(clientCreds)) {
            args.push('--credentials', clientCreds);
        }
    }

    if (opts.search) args.push('--search', opts.search);
    if (opts.likeOnly) args.push('--like-only');
    if (opts.dryRun) args.push('--dry-run');
    if (opts.verbose) args.push('--verbose');
    if (opts.listUrl) args.push('--list', opts.listUrl);

    // Spawn child process
    const proc = spawn('node', args, {
        cwd: path.join(SCRIPTS_DIR, '..'),
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
    });

    const logFile = path.join(clientDir, 'engage.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    const outputBuffer = [];
    const MAX_BUFFER_LINES = 100;

    const pushOutput = (line) => {
        outputBuffer.push(line);
        if (outputBuffer.length > MAX_BUFFER_LINES) outputBuffer.shift();
    };

    proc.stdout.on('data', (data) => {
        const text = data.toString();
        logStream.write(text);
        text.split('\n').filter(l => l.trim()).forEach(pushOutput);
    });

    proc.stderr.on('data', (data) => {
        const text = `[STDERR] ${data.toString()}`;
        logStream.write(text);
        text.split('\n').filter(l => l.trim()).forEach(pushOutput);
    });

    proc.on('exit', (code, signal) => {
        logStream.write(`\n[MANAGER] Process exited — code: ${code}, signal: ${signal}\n`);
        logStream.end();
        const inst = instances.get(clientId);
        if (inst) {
            inst.exitCode = code;
            inst.exitSignal = signal;
            inst.endedAt = new Date().toISOString();
            inst.status = code === 0 ? 'completed' : 'crashed';
        }
    });

    proc.on('error', (err) => {
        logStream.write(`\n[MANAGER] Process error: ${err.message}\n`);
        logStream.end();
        const inst = instances.get(clientId);
        if (inst) {
            inst.status = 'error';
            inst.error = err.message;
        }
    });

    const instance = {
        proc,
        pid: proc.pid,
        clientId,
        mode,
        quota,
        startedAt: new Date().toISOString(),
        status: 'running',
        exitCode: null,
        exitSignal: null,
        endedAt: null,
        error: null,
        outputBuffer,
    };

    instances.set(clientId, instance);

    return { ok: true, message: `Session started (PID: ${proc.pid})`, pid: proc.pid };
}

/**
 * Stop a running session.
 * @param {string} clientId
 * @returns {{ ok: boolean, message: string }}
 */
function stop(clientId) {
    const inst = instances.get(clientId);
    if (!inst) return { ok: false, message: 'No session found' };
    if (inst.status !== 'running') return { ok: false, message: `Session not running (status: ${inst.status})` };

    try {
        inst.proc.kill('SIGTERM');

        // Force kill after 5s if still alive
        setTimeout(() => {
            try {
                if (!inst.proc.killed) inst.proc.kill('SIGKILL');
            } catch (_) { /* already dead */ }
        }, 5000);

        inst.status = 'stopping';
        return { ok: true, message: `Stopping session (PID: ${inst.pid})` };
    } catch (err) {
        return { ok: false, message: `Failed to stop: ${err.message}` };
    }
}

/**
 * Get status of a client's session.
 * @param {string} clientId
 * @returns {object|null}
 */
function getStatus(clientId) {
    const inst = instances.get(clientId);
    if (!inst) return null;

    // Check if process is actually still alive
    if (inst.status === 'running' && inst.proc.killed) {
        inst.status = 'stopped';
    }

    return {
        clientId: inst.clientId,
        pid: inst.pid,
        mode: inst.mode,
        quota: inst.quota,
        status: inst.status,
        startedAt: inst.startedAt,
        endedAt: inst.endedAt,
        exitCode: inst.exitCode,
    };
}

/**
 * Get recent log output from a running session.
 * @param {string} clientId
 * @param {number} lines - Number of recent lines (default 50)
 * @returns {string[]}
 */
function getRecentOutput(clientId, lines = 50) {
    const inst = instances.get(clientId);
    if (!inst) return [];
    return inst.outputBuffer.slice(-lines);
}

/**
 * List all sessions (active and recently finished).
 * @returns {object[]}
 */
function listAll() {
    const results = [];
    for (const [id, inst] of instances) {
        results.push(getStatus(id));
    }
    return results;
}

/**
 * Clean up finished sessions from the map.
 */
function cleanup() {
    for (const [id, inst] of instances) {
        if (['completed', 'crashed', 'stopped', 'error'].includes(inst.status)) {
            instances.delete(id);
        }
    }
}

/**
 * Stop all running instances (for graceful shutdown).
 */
function stopAll() {
    for (const [id, inst] of instances) {
        if (inst.status === 'running') {
            try { inst.proc.kill('SIGTERM'); } catch (_) { }
        }
    }
}

module.exports = {
    start,
    stop,
    getStatus,
    getRecentOutput,
    listAll,
    cleanup,
    stopAll,
    MAX_INSTANCES,
};
