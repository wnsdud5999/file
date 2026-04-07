const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const DEFAULT_PASSWORD = 'wnsdud5999@';
const PASSWORD_SALT = process.env.PASSWORD_SALT || 'editor-static-salt-change-me';
const configuredHash = process.env.EDITOR_PASSWORD_HASH || '';
const sessionSecret = process.env.SESSION_SECRET || 'replace-this-with-a-long-random-string';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'personal-cloud';

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function derivePasswordHash(plainPassword) {
  return sha256(`${PASSWORD_SALT}:${plainPassword}`);
}

const effectivePasswordHash = configuredHash || derivePasswordHash(DEFAULT_PASSWORD);

function parseCookies(req) {
  const raw = req.headers.cookie;
  if (!raw) return {};
  return raw.split(';').reduce((acc, pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return acc;
    acc[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    return acc;
  }, {});
}

function signSession(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('hex');
}

function createSessionCookie() {
  const value = crypto.randomBytes(16).toString('hex');
  return `${value}.${signSession(value)}`;
}

function verifySessionCookie(cookieValue) {
  if (!cookieValue) return false;
  const [value, sig] = cookieValue.split('.');
  if (!value || !sig) return false;
  const expected = signSession(value);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function isAuthorized(req) {
  const cookies = parseCookies(req);
  return verifySessionCookie(cookies.editor_session);
}

function json(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(payload));
}

function readBody(req, maxBytes = 35_000_000) {
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

function serveStatic(req, res, pathname) {
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

function requireSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
}

function cleanFilePath(filePath) {
  const trimmed = String(filePath || '').trim();
  if (!trimmed || trimmed.length > 200) throw new Error('Invalid file path');
  if (trimmed.includes('..') || trimmed.startsWith('/')) throw new Error('Invalid file path');
  if (!/^[a-zA-Z0-9._\-/ ]+$/.test(trimmed)) throw new Error('Invalid file path');
  return trimmed.replace(/\\/g, '/');
}

async function supabaseFetch(endpoint, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${endpoint}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init.headers || {})
    }
  });

  return res;
}

async function listFiles() {
  const res = await supabaseFetch(`/storage/v1/object/list/${encodeURIComponent(SUPABASE_BUCKET)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      limit: 200,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' }
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`List failed: ${res.status} ${text}`);
  }

  const items = await res.json();
  return items
    .filter((item) => item && item.name && !item.id)
    .map((item) => ({
      name: item.name,
      size: item.metadata?.size || 0,
      updated_at: item.updated_at || item.created_at || null
    }));
}

async function uploadFile(filePath, buffer, contentType = 'application/octet-stream') {
  const endpoint = `/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURI(filePath)}`;
  const res = await supabaseFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'x-upsert': 'true'
    },
    body: buffer
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${res.status} ${text}`);
  }
}

async function downloadFile(filePath) {
  const endpoint = `/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodeURI(filePath)}`;
  const res = await supabaseFetch(endpoint, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Download failed: ${res.status} ${text}`);
  }
  return res;
}

async function deleteFile(filePath) {
  const res = await supabaseFetch(`/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [filePath] })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete failed: ${res.status} ${text}`);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'POST' && pathname === '/api/login') {
      const body = await readBody(req);
      const supplied = typeof body.password === 'string' ? body.password : '';
      const ok = derivePasswordHash(supplied) === effectivePasswordHash;
      if (!ok) return json(res, 401, { ok: false, error: 'Wrong password' });

      const token = createSessionCookie();
      return json(
        res,
        200,
        { ok: true },
        { 'Set-Cookie': `editor_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400` }
      );
    }

    if (req.method === 'POST' && pathname === '/api/logout') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'editor_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }

    if (pathname.startsWith('/api/')) {
      if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
      requireSupabaseConfig();
    }

    if (req.method === 'GET' && pathname === '/api/files') {
      const files = await listFiles();
      return json(res, 200, { files });
    }

    if (req.method === 'POST' && pathname === '/api/upload') {
      const body = await readBody(req);
      const fileName = cleanFilePath(body.fileName);
      const contentBase64 = String(body.contentBase64 || '');
      const contentType = typeof body.contentType === 'string' ? body.contentType : 'application/octet-stream';
      if (!contentBase64) return json(res, 400, { error: 'contentBase64 is required' });

      const buffer = Buffer.from(contentBase64, 'base64');
      await uploadFile(fileName, buffer, contentType);

      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/download') {
      const filePath = cleanFilePath(url.searchParams.get('path') || '');
      const fileRes = await downloadFile(filePath);
      const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
      const arrayBuffer = await fileRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        'Content-Disposition': `attachment; filename="${path.basename(filePath).replace(/"/g, '')}"`
      });
      res.end(buffer);
      return;
    }

    if (req.method === 'DELETE' && pathname === '/api/file') {
      const filePath = cleanFilePath(url.searchParams.get('path') || '');
      await deleteFile(filePath);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET') {
      return serveStatic(req, res, pathname);
    }

    res.writeHead(405);
    res.end('Method not allowed');
  } catch (error) {
    console.error(error);
    json(res, 500, { error: error.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Personal cloud running at http://localhost:${PORT}`);
});
