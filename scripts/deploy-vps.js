/**
 * deploy-vps.js — Deploy x-evaluate stack to Oracle VPS
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('ssh2');
const fs   = require('fs');
const path = require('path');

const SSH = {
    host:       '80.225.244.120',
    port:       22,
    username:   'ubuntu',
    privateKey: fs.readFileSync('C:/Users/admin/AppData/Local/Temp/oracle_vps_key2'),
};

const REMOTE_DIR = '/home/ubuntu/x-connect';
const LOCAL      = path.join(__dirname, '..');

function run(conn, cmd) {
    return new Promise((res, rej) => {
        conn.exec(cmd, (err, stream) => {
            if (err) return rej(err);
            let out = '', e2 = '';
            stream.on('data', d => out += d);
            stream.stderr.on('data', d => e2 += d);
            stream.on('close', () => {
                if (e2.trim()) console.warn(`  stderr: ${e2.trim()}`);
                res(out.trim());
            });
        });
    });
}

function upload(sftp, local, remote) {
    return new Promise((res, rej) => sftp.fastPut(local, remote, e => e ? rej(e) : res()));
}

function getSftp(conn) {
    return new Promise((res, rej) => conn.sftp((e, s) => e ? rej(e) : res(s)));
}

(async () => {
    const conn = new Client();
    await new Promise((res, rej) => conn.on('ready', res).on('error', rej).connect(SSH));
    console.log('✅ Connected to Oracle VPS');

    const sftp = await getSftp(conn);

    // 1. Ensure dirs
    await run(conn, `mkdir -p ${REMOTE_DIR}/scripts ${REMOTE_DIR}/config ${REMOTE_DIR}/debug/evaluations`);
    console.log('✅ Directories ready');

    // 2. Upload scripts
    const scripts = ['x-evaluate.js', 'evaluate-server.js'];
    for (const s of scripts) {
        await upload(sftp, path.join(LOCAL, 'scripts', s), `${REMOTE_DIR}/scripts/${s}`);
        console.log(`✅ Uploaded scripts/${s}`);
    }

    // 3. Upload cookies (from local config)
    const cookiesSrc = path.join(LOCAL, 'config', 'cookies.json');
    if (fs.existsSync(cookiesSrc)) {
        await upload(sftp, cookiesSrc, `${REMOTE_DIR}/config/cookies.json`);
        console.log('✅ Uploaded config/cookies.json');
    }

    // 4. Write .env on VPS
    const envContent = [
        `NVIDIA_API_KEY=${process.env.NVIDIA_API_KEY}`,
        `FEED_PUSH_URL=https://aptum.fun/evaluate.php`,
        `FEED_PUSH_SECRET=${process.env.FEED_PUSH_SECRET}`,
        `EVAL_SERVER_PORT=3001`,
    ].join('\n') + '\n';

    await run(conn, `cat > ${REMOTE_DIR}/.env << 'ENVEOF'\n${envContent}ENVEOF`);
    console.log('✅ .env written');

    // 5. Install deps
    console.log('⏳ Installing npm dependencies...');
    const npmOut = await run(conn, `cd ${REMOTE_DIR} && npm install --omit=dev 2>&1 | tail -5`);
    console.log(`   ${npmOut}`);

    // 6. Install pm2 if needed
    const pm2Check = await run(conn, 'which pm2 2>/dev/null || echo missing');
    if (pm2Check.includes('missing')) {
        console.log('⏳ Installing pm2...');
        await run(conn, 'npm install -g pm2 2>&1 | tail -3');
        console.log('✅ pm2 installed');
    }

    // 7. Start/restart evaluate-server via pm2
    await run(conn, `cd ${REMOTE_DIR} && pm2 delete evaluate-server 2>/dev/null; pm2 start scripts/evaluate-server.js --name evaluate-server --no-autorestart 2>&1`);
    await run(conn, 'pm2 save 2>&1');
    console.log('✅ evaluate-server started via pm2');

    // 8. Health check
    await new Promise(r => setTimeout(r, 2000));
    const health = await run(conn, 'curl -s http://127.0.0.1:3001/health');
    console.log(`\n🔍 Health: ${health}`);

    // 9. Open firewall port 3001
    const fw = await run(conn, 'sudo ufw allow 3001/tcp 2>&1 || echo "ufw not active"');
    console.log(`🔓 Firewall: ${fw}`);

    // 10. pm2 status
    const status = await run(conn, 'pm2 list --no-color');
    console.log(`\n📊 pm2 status:\n${status}`);

    conn.end();
    console.log('\n✅ VPS deploy complete');
    console.log('   evaluate-server running on port 3001');
    console.log('   evaluate.php will auto-trigger evaluations on demand');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
