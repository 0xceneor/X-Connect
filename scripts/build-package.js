/**
 * build-package.js
 *
 * Generates a clean, scrubbed x-connect-fresh.zip for distribution.
 * Output: x402-app/public/x-connect-fresh.zip
 *
 * Excludes:
 *   - .env (API keys)
 *   - cookies.json (session cookies)
 *   - credentials.json (X API OAuth tokens)
 *   - debug/ (logs and screenshots)
 *   - clients/ (per-client data)
 *   - agentusers/ (paid agent keys)
 *   - x402-app/ (the server itself)
 *   - node_modules/
 *   - .git/
 *
 * Includes .env.example and cookies.example.json so buyers know the format.
 *
 * Usage:
 *   node scripts/build-package.js
 */

'use strict';

const archiver = require('archiver');
const fs       = require('fs');
const path     = require('path');

const ROOT       = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'x402-app', 'public');
const OUTPUT_ZIP = path.join(OUTPUT_DIR, 'x-connect-fresh.zip');

// Paths/names to exclude (relative to ROOT)
const EXCLUDE_DIRS  = new Set(['node_modules', '.git', 'debug', 'clients', 'agentusers', 'x402-app']);
const EXCLUDE_FILES = new Set(['.env', 'cookies.json', 'credentials.json', 'package-lock.json']);

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const output  = fs.createWriteStream(OUTPUT_ZIP);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
    const mb = (archive.pointer() / 1024 / 1024).toFixed(2);
    console.log(`✅  Built x-connect-fresh.zip — ${mb} MB`);
    console.log(`    → ${OUTPUT_ZIP}`);
});

archive.on('warning', (err) => {
    if (err.code !== 'ENOENT') throw err;
    console.warn('⚠️ ', err.message);
});

archive.on('error', (err) => { throw err; });

archive.pipe(output);

// Walk the root directory and add allowed files
function addDirectory(srcDir, zipBase) {
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env.example' && entry.name !== '.gitignore') continue;

        const fullPath = path.join(srcDir, entry.name);
        const zipPath  = path.join(zipBase, entry.name);

        if (entry.isDirectory()) {
            if (EXCLUDE_DIRS.has(entry.name)) {
                console.log(`  ⛔ skip dir:  ${zipPath}`);
                continue;
            }
            addDirectory(fullPath, zipPath);
        } else {
            if (EXCLUDE_FILES.has(entry.name)) {
                console.log(`  ⛔ skip file: ${zipPath}`);
                continue;
            }
            archive.file(fullPath, { name: path.join('x-connect', zipPath) });
            console.log(`  ✓  ${path.join('x-connect', zipPath)}`);
        }
    }
}

console.log('Building x-connect-fresh.zip...\n');
addDirectory(ROOT, '');
archive.finalize();
