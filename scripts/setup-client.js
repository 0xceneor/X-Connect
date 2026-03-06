/**
 * setup-client.js — CLI tool to onboard a new customer.
 *
 * Usage:
 *   node scripts/setup-client.js --id customer1 --name "Acme Corp"
 *   node scripts/setup-client.js --id customer1 --name "Acme Corp" --credentials ./keys.json
 *
 * Creates:
 *   clients/<id>/config.json   — API key + settings
 *   clients/<id>/credentials.json (if --credentials provided)
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const CLIENTS_DIR = path.join(__dirname, '..', 'clients');

const args = process.argv.slice(2);
function getArg(name, fallback) {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const clientId = getArg('id', null);
const name = getArg('name', clientId);
const credsSource = getArg('credentials', null);

if (!clientId) {
    console.log('Usage: node setup-client.js --id <client-id> --name "Display Name" [--credentials path/to/keys.json]');
    process.exit(1);
}

if (!/^[a-zA-Z0-9_-]{2,30}$/.test(clientId)) {
    console.error('❌ Client ID must be 2-30 chars, alphanumeric/dash/underscore');
    process.exit(1);
}

const clientDir = path.join(CLIENTS_DIR, clientId);
const configPath = path.join(clientDir, 'config.json');

if (fs.existsSync(configPath)) {
    console.error(`❌ Client ${clientId} already exists at ${clientDir}`);
    process.exit(1);
}

// Create client directory
fs.mkdirSync(clientDir, { recursive: true });

// Generate API key
const apiKey = 'xc_' + crypto.randomBytes(20).toString('hex');

// Write config
const config = {
    apiKey,
    name: name || clientId,
    defaultMode: 'api',
    defaultQuota: 50,
    minPause: 25,
    maxPause: 55,
    createdAt: new Date().toISOString(),
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

// Copy credentials if provided
if (credsSource) {
    if (!fs.existsSync(credsSource)) {
        console.error(`❌ Credentials file not found: ${credsSource}`);
    } else {
        fs.copyFileSync(credsSource, path.join(clientDir, 'credentials.json'));
        console.log(`✅ Credentials copied from ${credsSource}`);
    }
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`  ✅ Client registered: ${clientId}`);
console.log(`  📁 Directory: ${clientDir}`);
console.log(`  🔑 API Key: ${apiKey}`);
console.log(`${'═'.repeat(50)}`);
console.log(`\n⚠️  Save this API key — it won't be shown again.`);

if (!credsSource) {
    console.log(`\n📝 Next: Add X API credentials:`);
    console.log(`   cp /path/to/keys.json ${path.join(clientDir, 'credentials.json')}`);
    console.log(`   or via API: POST /api/clients/${clientId}/credentials`);
}
console.log('');
