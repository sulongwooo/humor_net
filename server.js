#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = 8000;
const HOST = 'localhost';

/* ---------- Visitor stats (cookie-based unique visitors, logged to disk) ---------- */

const VISITS_FILE = path.join(__dirname, '.visits.json');
const VISITOR_COOKIE = 'humor_net_visitor';
const VISITOR_BASE = 1565;   // displayed count starts at 1,566 (base + first visitor)
const DEDUPE_SECONDS = 24 * 60 * 60;
const VISITOR_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function loadVisits() {
    try {
        const parsed = JSON.parse(fs.readFileSync(VISITS_FILE, 'utf8'));
        if (parsed && Array.isArray(parsed.visits)) return parsed;
    } catch (err) {
        // First run (no file yet) or unreadable file: start with an empty log
    }
    return { visits: [] };
}

const visitLog = loadVisits();

function saveVisits() {
    // Write to a temp file then rename, so a crash can't leave a half-written log
    const tmpFile = VISITS_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(visitLog));
    fs.renameSync(tmpFile, VISITS_FILE);
}

function parseVisitorId(req) {
    const raw = req.headers.cookie || '';
    const match = raw.match(new RegExp('(?:^|;\\s*)' + VISITOR_COOKIE + '=([^;]+)'));
    if (!match) return null;

    let value = match[1];
    try {
        value = decodeURIComponent(value);
    } catch (err) {
        return null;
    }

    return VISITOR_ID_RE.test(value) ? value : null;
}

function sendJson(res, status, payload, headers) {
    res.writeHead(status, Object.assign({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    }, headers || {}));
    res.end(JSON.stringify(payload));
}

// GET /api/visit -> { visitors, today, counted }
// A long-lived cookie identifies each browser. The same browser is counted once
// per 24 hours, while every request is still appended to the visit log.
function handleVisit(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
    }

    let visitorId = parseVisitorId(req);
    let setCookie = null;
    if (!visitorId) {
        visitorId = crypto.randomUUID();
        setCookie = `${VISITOR_COOKIE}=${visitorId}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }

    const now = Math.floor(Date.now() / 1000);
    const lastVisit = visitLog.visits.reduce(
        (latest, visit) => (visit.visitorId === visitorId ? Math.max(latest, visit.at) : latest),
        0
    );
    const counted = lastVisit === 0 || now - lastVisit >= DEDUPE_SECONDS;

    visitLog.visits.push({
        visitorId,
        at: now,
        ip: req.socket.remoteAddress,
        userAgent: (req.headers['user-agent'] || '').slice(0, 500),
        path: req.url.split('?')[0],
        referer: (req.headers.referer || '').slice(0, 500),
        counted
    });

    try {
        saveVisits();
    } catch (err) {
        console.error('Failed to persist visit log:', err.message);
    }

    const visitors = VISITOR_BASE + new Set(visitLog.visits.map((visit) => visit.visitorId)).size;

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todayStart = Math.floor(dayStart.getTime() / 1000);
    const today = new Set(
        visitLog.visits
            .filter((visit) => visit.at >= todayStart)
            .map((visit) => visit.visitorId)
    ).size;

    sendJson(res, 200, { visitors, today, counted }, setCookie ? { 'Set-Cookie': setCookie } : null);

    if (counted) {
        console.log(`  +1 visitor · total ${visitors} · today ${today}`);
    }
}

const server = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];

    if (pathname === '/api/visit') {
        handleVisit(req, res);
        return;
    }

    // Never expose the visit log, the server code, or git internals
    if (pathname.startsWith('/.git/') || pathname === '/server.js' || pathname === '/.visits.json') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 - File Not Found');
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
    console.log('📊 Visit log:', VISITS_FILE);
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
