const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'analytics.json');

const server = http.createServer((req, res) => {
    // Set CORS headers if needed
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Only allow POST to stats endpoints
    if (req.method === 'POST' && (req.url === '/api/stats' || req.url === '/api/stats.js' || req.url === '/stats.js')) {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                // Parse incoming JSON data
                const newData = JSON.parse(body);

                // Add server-side timestamp
                newData.serverReceivedAt = new Date().toISOString();

                // Load existing data
                let analyticsData = [];
                if (fs.existsSync(DATA_FILE)) {
                    const fileContent = fs.readFileSync(DATA_FILE, 'utf8');
                    if (fileContent) {
                        try {
                            analyticsData = JSON.parse(fileContent);
                        } catch (e) {
                            console.error('Error parsing analytics.json:', e);
                        }
                    }
                }

                // Append new data
                analyticsData.push(newData);

                // Save back to file
                fs.writeFileSync(DATA_FILE, JSON.stringify(analyticsData, null, 2));

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Data saved successfully' }));

            } catch (error) {
                console.error('Error processing request:', error);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
            }
        });
    } else {
        // Handle 404 for other routes
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

server.listen(PORT, () => {
    console.log(`Analytics server running on port ${PORT}`);
    console.log(`Saving data to ${DATA_FILE}`);
});
