require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('ssh2');
const fs = require('fs');
const conn = new Client();
conn.on('ready', () => {
    const cmds = [
        'ls ~/.nvm/versions/node/ 2>/dev/null && echo "nvm found"',
        'ls /opt/cpanel/ea-nodejs*/bin/node 2>/dev/null',
        'which node 2>/dev/null || echo "node not in PATH"',
        'which chromium-browser chromium google-chrome 2>/dev/null || echo "no chrome"',
        'ls ~/aptum.fun/ | head -20',
    ].join(' ; echo "---" ; ');
    conn.exec(cmds, (err, stream) => {
        let out = '';
        stream.on('data', d => out += d);
        stream.stderr.on('data', d => out += d);
        stream.on('close', () => { console.log(out); conn.end(); });
    });
}).on('error', e => console.error(e.message))
.connect({
    host: 'aptum.fun', port: 21098, username: 'tksfsiduut',
    privateKey: fs.readFileSync('C:/Users/admin/AppData/Local/Temp/aptum_key_new'),
    passphrase: '14785Sayeed@'
});
