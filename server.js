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
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'private-send-files';
const TRANSFER_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 35_000_000;

function requireConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
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

async function supabaseFetch(endpoint, init = {}) {
  requireConfig();
  return fetch(`${SUPABASE_URL}${endpoint}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init.headers || {})
    }
  });
}

async function uploadToStorage(objectPath, buffer, contentType) {
  const res = await supabaseFetch(`/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURI(objectPath)}`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'false'
    },
    body: buffer
  });

  if (!res.ok) throw new Error(`Storage upload failed: ${res.status}`);
}

async function deleteFromStorage(objectPath) {
  const res = await supabaseFetch(`/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [objectPath] })
  });

  if (!res.ok) throw new Error(`Storage delete failed: ${res.status}`);
}

async function downloadFromStorage(objectPath) {
  const res = await supabaseFetch(`/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURI(objectPath)}`, {
    method: 'GET'
  });

  if (!res.ok) throw new Error(`Storage download failed: ${res.status}`);
  return res;
}

async function findTransfer(code) {
  const res = await supabaseFetch(`/rest/v1/transfers?code=eq.${encodeURIComponent(code)}&select=code,object_path,original_name,content_type,created_at&limit=1`, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });

  if (!res.ok) throw new Error(`Transfer lookup failed: ${res.status}`);
  const rows = await res.json();
  return rows[0] || null;
}

async function insertTransfer(row) {
  const res = await supabaseFetch('/rest/v1/transfers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(row)
  });

  if (!res.ok) throw new Error(`Transfer create failed: ${res.status}`);
}

async function deleteTransfer(code) {
  const res = await supabaseFetch(`/rest/v1/transfers?code=eq.${encodeURIComponent(code)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });

  if (!res.ok) throw new Error(`Transfer delete failed: ${res.status}`);
}

async function createUniqueCode() {
  for (let i = 0; i < 20; i += 1) {
    const code = generateCode();
    const existing = await findTransfer(code);
    if (!existing) return code;
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

  const code = await createUniqueCode();
  const objectPath = `${crypto.randomUUID()}-${fileName}`;

  await uploadToStorage(objectPath, buffer, contentType);
  await insertTransfer({
    code,
    object_path: objectPath,
    original_name: fileName,
    content_type: contentType,
    created_at: new Date().toISOString()
  });

  return json(res, 200, { ok: true, code });
}

async function handleDownload(res, code) {
  if (!/^\d{6}$/.test(code)) return json(res, 400, { error: 'Code must be 6 digits' });

  const transfer = await findTransfer(code);
  if (!transfer) return json(res, 404, { error: 'Code not found or already used' });

  const createdAtMs = new Date(transfer.created_at).getTime();
  if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs > TRANSFER_TTL_MS) {
    await deleteFromStorage(transfer.object_path).catch(() => {});
    await deleteTransfer(code);
    return json(res, 404, { error: 'Code expired' });
  }

  const fileRes = await downloadFromStorage(transfer.object_path);
  const contentType = transfer.content_type || fileRes.headers.get('content-type') || 'application/octet-stream';
  const arrayBuffer = await fileRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await deleteFromStorage(transfer.object_path);
  await deleteTransfer(code);

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Content-Disposition': `attachment; filename="${String(transfer.original_name || 'download.bin').replace(/"/g, '')}"`
  });
  res.end(buffer);
}

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
