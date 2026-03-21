const { Client } = require('ssh2');
const fs = require('fs');

const privateKey = fs.readFileSync('C:/Users/admin/AppData/Local/Temp/x402_key_new_raw');
const appJs = fs.readFileSync('./app.js');

const conn = new Client();
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) { console.error('sftp err:', err); conn.end(); return; }
    const writeStream = sftp.createWriteStream('/home/tksfsiduut/x402-app/app.js');
    writeStream.on('close', () => {
      console.log('app.js uploaded');
      // Now clear the wallet entry
      conn.exec("printf '# x-connect Agent Keys\\n# Auto-generated. Do not edit manually.\\n# Format: AGENT_<wallet>=<api_key>:<unlocked_at_unix_ms>\\n' > ~/x402-app/agentusers/.env && echo 'wallet cleared'", (err2, stream) => {
        if (err2) { console.error(err2); conn.end(); return; }
        stream.on('close', () => conn.end());
        stream.on('data', d => process.stdout.write(d.toString()));
        stream.stderr.on('data', d => process.stderr.write(d.toString()));
      });
    });
    writeStream.write(appJs);
    writeStream.end();
  });
}).on('error', err => console.error('SSH error:', err))
.connect({ host: 'aptum.fun', port: 21098, username: 'tksfsiduut', privateKey, passphrase: '14785Sayeed@' });
