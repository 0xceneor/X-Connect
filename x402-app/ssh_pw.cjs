const { Client } = require('ssh2');
const fs = require('fs');

const privateKey = fs.readFileSync('C:/Users/admin/AppData/Local/Temp/x402_key_new_raw');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH connected');
  conn.exec('echo connected && whoami && ~/nodevenv/x402-app/20/bin/node /tmp/test_mainnet.cjs 2>&1', (err, stream) => {
    if (err) { console.error(err); conn.end(); return; }
    stream.on('close', () => conn.end());
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
  });
}).on('error', err => console.error('SSH error:', err))
.connect({ host: 'aptum.fun', port: 21098, username: 'tksfsiduut', privateKey, passphrase: '14785Sayeed@' });
