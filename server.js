#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8000;
const HOST = 'localhost';

/* ---------- Visitor counter (unique browsers, persisted to disk) ---------- */

const VIEWS_FILE = path.join(__dirname, '.views.json');
const VISITOR_ID_RE = /^[A-Za-z0-9-]{6,80}$/;

// Displayed count starts from this offset, then grows with real unique visitors
const VIEWS_BASE = 100;

function loadViews() {
    try {
        const parsed = JSON.parse(fs.readFileSync(VIEWS_FILE, 'utf8'));
        if (parsed && parsed.visitors && typeof parsed.visitors === 'object') return parsed;
    } catch (err) {
        // First run (no file yet) or unreadable file: start from an empty registry
    }
    return { visitors: {} };
}

const views = loadViews();

function saveViews() {
    // Write to a temp file then rename, so a crash can't leave a half-written counter
    const tmpFile = VIEWS_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(views));
    fs.renameSync(tmpFile, VIEWS_FILE);
}

function countViews() {
    return VIEWS_BASE + Object.keys(views.visitors).length;
}

function sendJson(res, status, payload) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(payload));
}

// POST /api/views  { visitor: "<id>" } -> { count }
// Counting is idempotent per visitor id, so reloads and extra tabs don't inflate it.
function handleViews(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    let body = '';
    req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2048) req.destroy();
    });

    req.on('end', () => {
        let visitor = '';
        try {
            visitor = String(JSON.parse(body || '{}').visitor || '');
        } catch (err) {
            sendJson(res, 400, { error: 'Invalid JSON body' });
            return;
        }

        if (!VISITOR_ID_RE.test(visitor)) {
            sendJson(res, 400, { error: 'Invalid visitor id' });
            return;
        }

        if (!views.visitors[visitor]) {
            views.visitors[visitor] = 1;
            try {
                saveViews();
            } catch (err) {
                console.error('Failed to persist visitor count:', err.message);
            }
        }

        sendJson(res, 200, { count: countViews() });
    });
}

const server = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];

    if (pathname === '/api/views') {
        handleViews(req, res);
        return;
    }

    // Default to index.html
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, filePath);
    
    // Get file extension
    const ext = path.extname(filePath).toLowerCase();
    
    // Set content types
    const contentTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4'
    };
    
    // Read and serve file
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('<h1>404 - File Not Found</h1>');
        } else {
            res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
            res.end(data);
        }
    });
});

server.listen(PORT, HOST, () => {
    console.log('\n🎉 Random Joke Generator');
    console.log('========================\n');
    console.log(`✅ Server running at http://${HOST}:${PORT}`);
    console.log('\n📂 Serving files from:', __dirname);
    console.log('\n⌨️  Press Ctrl+C to stop the server\n');
    
    // Auto-open browser
    const start = (process.platform == 'darwin' ? 'open' : process.platform == 'win32' ? 'start' : 'xdg-open');
    require('child_process').exec(start + ' http://' + HOST + ':' + PORT);
});

// Handle errors
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use.`);
        process.exit(1);
    }
});
