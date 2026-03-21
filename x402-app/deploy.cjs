'use strict';
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const privateKey = fs.readFileSync('C:/Users/admin/AppData/Local/Temp/x402_key_new_raw');
const appJs = fs.readFileSync(path.join(__dirname, 'app.js'));

const migrateScript = `
const fs = require('fs');
const oldFile = '/home/tksfsiduut/x402-app/agentusers/.env';
const newFile = '/home/tksfsiduut/x402-app/agentusers/keys.json';
const KEY_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;
if (!fs.existsSync(oldFile)) { console.log('No old keys file'); process.exit(0); }
if (fs.existsSync(newFile)) { console.log('keys.json already exists, skipping'); process.exit(0); }
const lines = fs.readFileSync(oldFile, 'utf8').split('\\n');
const keys = {};
for (const line of lines) {
  if (!line.startsWith('AGENT_')) continue;
  const eq = line.indexOf('=');
  if (eq === -1) continue;
  const wallet = line.slice(6, eq);
  const parts  = line.slice(eq + 1).trim().split(':');
  const apiKey = parts[0];
  const ts     = parseInt(parts[1]) || Date.now();
  keys[wallet] = { apiKey, timestamp: ts, expiresAt: ts + KEY_EXPIRY_MS, ip: 'migrated', downloads: 0 };
}
fs.writeFileSync(newFile, JSON.stringify(keys, null, 2));
console.log('Migrated ' + Object.keys(keys).length + ' keys to keys.json');
`;

const conn = new Client();

conn.on('ready', () => {
    conn.sftp((err, sftp) => {
        if (err) { console.error('sftp error:', err); conn.end(); return; }

        let uploaded = 0;
        const onUploaded = () => {
            uploaded++;
            if (uploaded < 2) return;
            // Run migration then done
            conn.exec('mkdir -p ~/x402-app/agentusers && ~/nodevenv/x402-app/20/bin/node /tmp/migrate_keys.cjs 2>&1', (e, stream) => {
                if (e) { console.error(e); conn.end(); return; }
                stream.on('close', () => { console.log('Done'); conn.end(); });
                stream.on('data', d => process.stdout.write(d.toString()));
                stream.stderr.on('data', d => process.stderr.write(d.toString()));
            });
        };

        const w1 = sftp.createWriteStream('/home/tksfsiduut/x402-app/app.js');
        w1.on('close', () => { console.log('app.js uploaded'); onUploaded(); });
        w1.write(appJs); w1.end();

        const w2 = sftp.createWriteStream('/tmp/migrate_keys.cjs');
        w2.on('close', () => { console.log('migrate_keys.cjs uploaded'); onUploaded(); });
        w2.write(migrateScript); w2.end();
    });
}).on('error', err => console.error('SSH error:', err))
.connect({ host: 'aptum.fun', port: 21098, username: 'tksfsiduut', privateKey, passphrase: '14785Sayeed@' });
