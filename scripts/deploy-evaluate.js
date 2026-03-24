/**
 * deploy-evaluate.js — Deploy evaluate.php + .htaccess to aptum.fun
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('ssh2');
const fs   = require('fs');
const path = require('path');

const SSH = {
    host:       'aptum.fun',
    port:       21098,
    username:   'tksfsiduut',
    privateKey: fs.readFileSync('C:/Users/admin/AppData/Local/Temp/aptum_key_new'),
    passphrase: '14785Sayeed@',
};

const WEB_ROOT = '/home/tksfsiduut/aptum.fun';
const LOCAL    = path.join(__dirname, '..');

function run(conn, cmd) {
    return new Promise((res, rej) => {
        conn.exec(cmd, (err, stream) => {
            if (err) return rej(err);
            let out = '', err2 = '';
            stream.on('data', d => out += d);
            stream.stderr.on('data', d => err2 += d);
            stream.on('close', code => {
                if (code !== 0 && err2) console.warn(`  [stderr] ${err2.trim()}`);
                res(out.trim());
            });
        });
    });
}

function upload(sftp, local, remote) {
    return new Promise((res, rej) => {
        sftp.fastPut(local, remote, err => err ? rej(err) : res());
    });
}

function getSftp(conn) {
    return new Promise((res, rej) => conn.sftp((err, s) => err ? rej(err) : res(s)));
}

(async () => {
    const conn = new Client();
    await new Promise((res, rej) => {
        conn.on('ready', res).on('error', rej).connect(SSH);
    });
    console.log('✅ SSH connected');

    // 1. ensure evaluations/ dir
    await run(conn, `mkdir -p ${WEB_ROOT}/evaluations && chmod 755 ${WEB_ROOT}/evaluations`);
    console.log('✅ evaluations/ dir ready');

    // 2. upload PHP files
    const sftp = await getSftp(conn);
    await upload(sftp, path.join(LOCAL, 'evaluate.php'), `${WEB_ROOT}/evaluate.php`);
    console.log('✅ evaluate.php uploaded');
    await upload(sftp, path.join(LOCAL, 'evaluate-queue.php'), `${WEB_ROOT}/evaluate-queue.php`);
    console.log('✅ evaluate-queue.php uploaded');
    if (fs.existsSync(path.join(LOCAL, 'evaluate-card.php'))) {
        await upload(sftp, path.join(LOCAL, 'evaluate-card.php'), `${WEB_ROOT}/evaluate-card.php`);
        console.log('✅ evaluate-card.php uploaded');
    }
    if (fs.existsSync(path.join(LOCAL, 'leaderboard.php'))) {
        await upload(sftp, path.join(LOCAL, 'leaderboard.php'), `${WEB_ROOT}/leaderboard.php`);
        console.log('✅ leaderboard.php uploaded');
    }

    // 3. read existing .htaccess and merge rules
    let existing = '';
    try {
        existing = await run(conn, `cat ${WEB_ROOT}/.htaccess`);
    } catch (_) {}

    const newRules = fs.readFileSync(path.join(LOCAL, 'feed.htaccess'), 'utf8');

    // Extract individual rules to check if already present
    const lines = newRules.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    const missing = lines.filter(l => !existing.includes(l.trim()));

    if (missing.length === 0) {
        console.log('ℹ️  .htaccess already up to date');
    } else {
        // Append new rules (comment + rules)
        const toAdd = '\n# ── Signal Feed + Evaluate rules ──\n' + lines.join('\n') + '\n';
        const tmpFile = '/tmp/htaccess_extra.txt';
        await run(conn, `echo '${toAdd.replace(/'/g, "'\\''")}' >> ${WEB_ROOT}/.htaccess`);
        console.log('✅ .htaccess updated');
    }

    // 4. verify evaluate.php is accessible
    const check = await run(conn, `curl -s -o /dev/null -w "%{http_code}" https://aptum.fun/evaluate`);
    console.log(`\n🌐 https://aptum.fun/evaluate → HTTP ${check}`);

    conn.end();
    console.log('\n✅ Deploy complete');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
