const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const TRANSFERS_FILE = path.join(DATA_DIR, 'transfers.json');

const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || 'upload123!';
const MAX_BODY_BYTES = 35_000_000;
const TRANSFER_TTL_MS = 24 * 60 * 60 * 1000;

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(TRANSFERS_FILE)) fs.writeFileSync(TRANSFERS_FILE, JSON.stringify([], null, 2));
}

function readTransfers() {
  return JSON.parse(fs.readFileSync(TRANSFERS_FILE, 'utf8'));
}

function writeTransfers(items) {
  fs.writeFileSync(TRANSFERS_FILE, JSON.stringify(items, null, 2));
}

function cleanupExpiredTransfers() {
  const now = Date.now();
  const transfers = readTransfers();
  const kept = [];

  transfers.forEach((item) => {
    const expired = now - new Date(item.createdAt).getTime() > TRANSFER_TTL_MS;
    if (expired) {
      const absolute = path.join(UPLOADS_DIR, item.storedName);
      if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
    } else {
      kept.push(item);
    }
  });

  if (kept.length !== transfers.length) writeTransfers(kept);
}

function json(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(payload));
}

function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function mimeType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(requested).replace(/^([.][.][/\\])+/, '');
  const absolute = path.join(PUBLIC_DIR, safePath);

  if (!absolute.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  res.writeHead(200, { 'Content-Type': mimeType(absolute) });
  fs.createReadStream(absolute).pipe(res);
}

function sanitizeFileName(name) {
  const base = path.basename(String(name || '').trim());
  if (!base) throw new Error('Invalid file name');
  if (!/^[a-zA-Z0-9._\- ()]+$/.test(base)) throw new Error('Invalid file name');
  return base;
}

function generateCode() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

function createUniqueCode(existing) {
  for (let i = 0; i < 20; i += 1) {
    const code = generateCode();
    if (!existing.some((item) => item.code === code)) return code;
  }
  throw new Error('Could not generate transfer code');
}

async function handleUpload(req, res) {
  const body = await readBody(req);
  const uploadPassword = String(body.uploadPassword || '');
  if (uploadPassword !== UPLOAD_PASSWORD) return json(res, 401, { error: 'Wrong upload password' });

  const fileName = sanitizeFileName(body.fileName);
  const contentBase64 = String(body.contentBase64 || '');
  const contentType = typeof body.contentType === 'string' ? body.contentType : 'application/octet-stream';
  if (!contentBase64) return json(res, 400, { error: 'contentBase64 is required' });

  const buffer = Buffer.from(contentBase64, 'base64');
  if (!buffer.length) return json(res, 400, { error: 'File is empty' });

  const transfers = readTransfers();
  const code = createUniqueCode(transfers);
  const storedName = `${crypto.randomUUID()}-${fileName}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, storedName), buffer);

  transfers.push({
    code,
    originalName: fileName,
    storedName,
    contentType,
    createdAt: new Date().toISOString()
  });
  writeTransfers(transfers);

  return json(res, 200, { ok: true, code });
}

async function handleDownload(res, code) {
  if (!/^\d{6}$/.test(code)) return json(res, 400, { error: 'Code must be 6 digits' });

  const transfers = readTransfers();
  const idx = transfers.findIndex((item) => item.code === code);
  if (idx === -1) return json(res, 404, { error: 'Code not found or already used' });

  const transfer = transfers[idx];
  const absolute = path.join(UPLOADS_DIR, transfer.storedName);
  if (!fs.existsSync(absolute)) {
    transfers.splice(idx, 1);
    writeTransfers(transfers);
    return json(res, 404, { error: 'File no longer exists' });
  }

  const fileBuffer = fs.readFileSync(absolute);

  fs.unlinkSync(absolute);
  transfers.splice(idx, 1);
  writeTransfers(transfers);

  res.writeHead(200, {
    'Content-Type': transfer.contentType || 'application/octet-stream',
    'Content-Length': fileBuffer.length,
    'Content-Disposition': `attachment; filename="${transfer.originalName.replace(/"/g, '')}"`
  });
  res.end(fileBuffer);
}

ensureStorage();
cleanupExpiredTransfers();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'POST' && pathname === '/api/upload') {
      return await handleUpload(req, res);
    }

    if (req.method === 'GET' && pathname === '/api/download') {
      const code = String(url.searchParams.get('code') || '').trim();
      return await handleDownload(res, code);
    }

    if (req.method === 'GET') {
      return serveStatic(res, pathname);
    }

    res.writeHead(405);
    res.end('Method not allowed');
  } catch (error) {
    console.error(error);
    json(res, 500, { error: error.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Private file transfer running at http://localhost:${PORT}`);
});
